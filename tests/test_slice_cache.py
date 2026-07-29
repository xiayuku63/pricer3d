import concurrent.futures
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from parser import prusa_slicer
from parser.slice_cache import slicer_identity, store_cached_slice_analysis


def _write_fake_gcode(path, *, seconds=62):
    path.write_text(
        f"; estimated printing time (normal mode) = 1m {seconds - 60}s\n; total filament used [g] = 1.5\n",
        encoding="utf-8",
    )


def test_repeated_identical_slice_reuses_cached_gcode(tmp_path, monkeypatch):
    model_path = tmp_path / "model.stl"
    model_path.write_bytes(b"solid cached-model\nendsolid cached-model\n")
    first_output = tmp_path / "first.gcode"
    second_output = tmp_path / "second.gcode"
    monkeypatch.setenv("PRUSA_SLICE_CACHE_DIR", str(tmp_path / "cache"))
    slicer_identity.cache_clear()
    calls = 0

    def fake_run(command, **kwargs):
        nonlocal calls
        calls += 1
        output_path = Path(command[command.index("--output") + 1])
        _write_fake_gcode(output_path)
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    with patch.object(prusa_slicer, "prusa_executable", return_value="fake-prusa-slicer"):
        with patch.object(prusa_slicer.subprocess, "run", side_effect=fake_run):
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

    def fake_run(command, **kwargs):
        nonlocal calls
        calls += 1
        output_path = Path(command[command.index("--output") + 1])
        _write_fake_gcode(output_path)
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    with patch.object(prusa_slicer, "prusa_executable", return_value="fake-prusa-slicer"):
        with patch.object(prusa_slicer.subprocess, "run", side_effect=fake_run):
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

    def fake_run(command, **kwargs):
        nonlocal calls
        with calls_lock:
            calls += 1
        time.sleep(0.1)
        output_path = Path(command[command.index("--output") + 1])
        _write_fake_gcode(output_path)
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    def slice_one(index):
        return prusa_slicer.run_prusa_slice(str(model_path), str(tmp_path / f"result-{index}.gcode"))

    with patch.object(prusa_slicer, "prusa_executable", return_value="fake-prusa-slicer"):
        with patch.object(prusa_slicer.subprocess, "run", side_effect=fake_run):
            with patch("parser.slice_cache.slicer_identity", return_value="fake-prusa-slicer|1.0"):
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                    results = list(executor.map(slice_one, range(4)))

    assert calls == 1
    assert sum(bool(result["cache_hit"]) for result in results) == 3
    assert all(result["time_s"] == 62 for result in results)
