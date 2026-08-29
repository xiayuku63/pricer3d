import concurrent.futures
import threading
import time
from pathlib import Path
from unittest.mock import patch

from parser import prusa_slicer
from parser.slice_cache import slicer_identity, store_cached_slice_analysis


def _write_fake_gcode(path, *, seconds=62):
    path.write_text(
        f"; estimated printing time (normal mode) = 1m {seconds - 60}s\n; total filament used [g] = 1.5\n",
        encoding="utf-8",
    )


class FakeSlicerPopen:
    """Popen stub: writes the fake G-code on spawn, mimics a successful run."""

    def __init__(self, command, **kwargs):
        output_path = Path(command[command.index("--output") + 1])
        _write_fake_gcode(output_path)
        self.returncode = 0
        self.pid = 424242

    def communicate(self, timeout=None):
        return b"", b""

    def poll(self):
        return 0

    def kill(self):
        pass


def test_repeated_identical_slice_reuses_cached_gcode(tmp_path, monkeypatch):
    model_path = tmp_path / "model.stl"
    model_path.write_bytes(b"solid cached-model\nendsolid cached-model\n")
    first_output = tmp_path / "first.gcode"
    second_output = tmp_path / "second.gcode"
    monkeypatch.setenv("PRUSA_SLICE_CACHE_DIR", str(tmp_path / "cache"))
    slicer_identity.cache_clear()
    calls = 0

    class CountingPopen(FakeSlicerPopen):
        def __init__(self, command, **kwargs):
            nonlocal calls
            calls += 1
            super().__init__(command, **kwargs)

    with patch.object(prusa_slicer, "prusa_executable", return_value="fake-prusa-slicer"):
        with patch.object(prusa_slicer.subprocess, "Popen", CountingPopen):
            with patch("parser.slice_cache.slicer_identity", return_value="fake-prusa-slicer|1.0"):
                first = prusa_slicer.run_prusa_slice(str(model_path), str(first_output))
                store_cached_slice_analysis(first["_slice_cache_key"], {"layer_count": 49})
                second = prusa_slicer.run_prusa_slice(str(model_path), str(second_output))

    assert calls == 1
    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert first["time_s"] == second["time_s"] == 62
    assert second["gcode_summary"] == {"layer_count": 49}
    assert first_output.read_bytes() == second_output.read_bytes()


def test_slice_cache_key_changes_with_effective_config(tmp_path, monkeypatch):
    model_path = tmp_path / "model.stl"
    model_path.write_bytes(b"solid config-sensitive\nendsolid config-sensitive\n")
    monkeypatch.setenv("PRUSA_SLICE_CACHE_DIR", str(tmp_path / "cache"))
    calls = 0

    class CountingPopen(FakeSlicerPopen):
        def __init__(self, command, **kwargs):
            nonlocal calls
            calls += 1
            super().__init__(command, **kwargs)

    with patch.object(prusa_slicer, "prusa_executable", return_value="fake-prusa-slicer"):
        with patch.object(prusa_slicer.subprocess, "Popen", CountingPopen):
            with patch("parser.slice_cache.slicer_identity", return_value="fake-prusa-slicer|1.0"):
                prusa_slicer.run_prusa_slice(str(model_path), str(tmp_path / "20.gcode"), infill_percent=20)
                prusa_slicer.run_prusa_slice(str(model_path), str(tmp_path / "30.gcode"), infill_percent=30)

    assert calls == 2


def test_concurrent_identical_slices_are_collapsed_to_one_process(tmp_path, monkeypatch):
    model_path = tmp_path / "model.stl"
    model_path.write_bytes(b"solid concurrent\nendsolid concurrent\n")
    monkeypatch.setenv("PRUSA_SLICE_CACHE_DIR", str(tmp_path / "cache"))
    calls = 0
    calls_lock = threading.Lock()

    class CountingPopen(FakeSlicerPopen):
        def __init__(self, command, **kwargs):
            nonlocal calls
            with calls_lock:
                calls += 1
            time.sleep(0.1)
            super().__init__(command, **kwargs)

    def slice_one(index):
        return prusa_slicer.run_prusa_slice(str(model_path), str(tmp_path / f"result-{index}.gcode"))

    with patch.object(prusa_slicer, "prusa_executable", return_value="fake-prusa-slicer"):
        with patch.object(prusa_slicer.subprocess, "Popen", CountingPopen):
            with patch("parser.slice_cache.slicer_identity", return_value="fake-prusa-slicer|1.0"):
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                    results = list(executor.map(slice_one, range(4)))

    assert calls == 1
    assert sum(bool(result["cache_hit"]) for result in results) == 3
    assert all(result["time_s"] == 62 for result in results)


def test_orientation_cache_roundtrip(tmp_path, monkeypatch):
    """Store → lookup returns the same analysis with a private oriented copy."""

    from calculator import orientation_cache as oc

    cache_root = tmp_path / "orient_cache"
    monkeypatch.setenv("ORIENTATION_CACHE_DIR", str(cache_root))

    model = tmp_path / "model.stl"
    model.write_bytes(b"model-bytes")
    oriented = tmp_path / "oriented.stl"
    oriented.write_bytes(b"oriented-bytes")

    result = {
        "oriented_path": str(oriented),
        "original_path": str(model),
        "score": 91.5,
        "euler_angles_deg": {"x": 1.0, "y": -2.0, "z": 0.0},
        "face": {"area": 123.4},
        "all_candidates": [{"score": 91.5}],
    }
    oc.orientation_cache_store(str(model), result)
    assert list(cache_root.glob("*.json")), "cache entry written"

    hit = oc.orientation_cache_lookup(str(model))
    assert hit is not None
    assert hit["orientation_cache_hit"] is True
    assert hit["score"] == 91.5
    assert hit["euler_angles_deg"] == {"x": 1.0, "y": -2.0, "z": 0.0}
    # oriented_path must be a private copy, not the cache-owned file
    assert hit["oriented_path"] != str(oriented)
    with open(hit["oriented_path"], "rb") as f:
        assert f.read() == b"oriented-bytes"


def test_orientation_cache_identity_orientation_hits_model_path(tmp_path, monkeypatch):
    from calculator import orientation_cache as oc

    monkeypatch.setenv("ORIENTATION_CACHE_DIR", str(tmp_path / "oc"))
    model = tmp_path / "same.stl"
    model.write_bytes(b"same")

    oc.orientation_cache_store(str(model), {"oriented_path": str(model), "score": 1.0})
    hit = oc.orientation_cache_lookup(str(model))
    assert hit is not None
    assert hit["oriented_path"] == str(model)


def test_orientation_cache_disabled(tmp_path, monkeypatch):
    from calculator import orientation_cache as oc

    monkeypatch.setenv("ORIENTATION_CACHE", "0")
    model = tmp_path / "m.stl"
    model.write_bytes(b"x")
    oc.orientation_cache_store(str(model), {"score": 1.0})
    assert oc.orientation_cache_lookup(str(model)) is None
