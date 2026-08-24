import sys
from unittest.mock import patch

from parser import prusa_slicer


def test_wsl_wrapper_command_is_split_into_argv_items():
    assert prusa_slicer._executable_command("wsl.exe -d Ubuntu prusa-slicer") == [
        "wsl.exe",
        "-d",
        "Ubuntu",
        "prusa-slicer",
    ]


def test_windows_prefers_wsl_command_from_env():
    with patch("sys.platform", "win32"):
        with patch("parser.prusa_slicer.os.getenv", return_value="wsl.exe -d Ubuntu prusa-slicer"):
            with patch("parser.prusa_slicer._env_file_prusa_executable", return_value=""):
                with patch("parser.prusa_slicer.shutil.which", return_value=r"C:\Windows\System32\wsl.exe"):
                    with patch("parser.prusa_slicer.os.path.isfile", return_value=False):
                        with patch("parser.prusa_slicer.os.path.expandvars", side_effect=lambda v: v):
                            assert prusa_slicer.prusa_executable() == "wsl.exe -d Ubuntu prusa-slicer"


def test_windows_auto_detects_wsl_when_env_missing():
    def fake_which(name):
        if name == "wsl.exe":
            return r"C:\Windows\System32\wsl.exe"
        return None

    with patch("sys.platform", "win32"):
        with patch("parser.prusa_slicer.os.getenv", return_value=""):
            with patch("parser.prusa_slicer._env_file_prusa_executable", return_value=""):
                with patch("parser.prusa_slicer.shutil.which", side_effect=fake_which):
                    with patch("parser.prusa_slicer.os.path.isfile", return_value=False):
                        with patch("parser.prusa_slicer.os.path.expandvars", side_effect=lambda v: v):
                            assert prusa_slicer.prusa_executable() == r"C:\Windows\System32\wsl.exe -- prusa-slicer"


def test_windows_ignores_native_prusaslicer_path():
    def fake_isfile(path):
        return path == r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer.exe"

    with patch("sys.platform", "win32"):
        with patch(
            "parser.prusa_slicer.os.getenv", return_value=r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer.exe"
        ):
            with patch("parser.prusa_slicer._env_file_prusa_executable", return_value=""):
                with patch("parser.prusa_slicer.shutil.which", return_value=None):
                    with patch("parser.prusa_slicer.os.path.isfile", side_effect=fake_isfile):
                        with patch("parser.prusa_slicer.os.path.expandvars", side_effect=lambda v: v):
                            assert prusa_slicer.prusa_executable() is None


def test_diagnostics_uses_wsl_command_argv():
    exe = "wsl.exe -d Ubuntu prusa-slicer"

    with patch.object(prusa_slicer.subprocess, "check_output", return_value=b"PrusaSlicer-2.9.6\n") as check_output:
        with patch.object(prusa_slicer, "prusa_executable", return_value=exe):
            result = prusa_slicer.prusa_executable_diagnostics()

    assert result["found"] is True
    assert result["version"] == "PrusaSlicer-2.9.6"
    check_output.assert_called_once()
    assert check_output.call_args.args[0] == ["wsl.exe", "-d", "Ubuntu", "prusa-slicer", "--help"]


def test_slice_command_does_not_use_unsupported_headless_option(tmp_path):
    output_path = tmp_path / "test.gcode"
    captured = {}

    class FakePopen:
        def __init__(self, command, **kwargs):
            captured["command"] = command
            output_path.write_text(
                "; estimated printing time (normal mode) = 1m 2s\n; total filament used [g] = 1.5\n",
                encoding="utf-8",
            )
            self.returncode = 0
            self.pid = 12345

        def communicate(self, timeout=None):
            return b"", b""

        def poll(self):
            return 0

        def kill(self):
            pass

    with patch.object(prusa_slicer, "prusa_executable", return_value="/usr/bin/prusa-slicer"):
        with patch.object(prusa_slicer.subprocess, "Popen", FakePopen):
            result = prusa_slicer.run_prusa_slice(
                "tests/fixtures/test_cube.stl",
                str(output_path),
                use_cache=False,
            )

    command = captured["command"]
    assert "--headless" not in command
    assert result["time_s"] == 62
    assert result["filament_g"] == 1.5


def test_absolute_windows_wsl_wrapper_is_split_into_argv_items():
    assert prusa_slicer._executable_command(r"C:\Windows\System32\wsl.exe -- prusa-slicer") == [
        r"C:\Windows\System32\wsl.exe",
        "--",
        "prusa-slicer",
    ]


def test_wsl_wrapper_translates_windows_model_paths():
    exe = r"C:\Windows\System32\wsl.exe -- prusa-slicer"
    with patch.object(sys, "platform", "win32"):
        assert (
            prusa_slicer.translate_path_for_executable(
                r"D:\Projects\pricer3d\data\part.step",
                exe,
            )
            == "/mnt/d/Projects/pricer3d/data/part.step"
        )


def test_wsl_absolute_windows_path_does_not_use_host_abspath():
    exe = r"C:\Windows\System32\wsl.exe -- prusa-slicer"
    with patch.object(sys, "platform", "win32"):
        with patch.object(
            prusa_slicer.os.path,
            "abspath",
            return_value="/home/runner/work/pricer3d/pricer3d/D:/Projects/pricer3d/data/part.step",
        ) as abspath:
            translated = prusa_slicer.translate_path_for_executable(
                r"D:\Projects\pricer3d\data\part.step",
                exe,
            )

    assert translated == "/mnt/d/Projects/pricer3d/data/part.step"
    abspath.assert_not_called()


def test_appimage_uses_fuse_free_extraction_mode():
    with patch.object(prusa_slicer.os.path, "isfile", return_value=True):
        with patch.object(prusa_slicer.os.path, "realpath", return_value="/usr/local/bin/prusa-slicer.AppImage"):
            assert prusa_slicer._executable_command("/usr/local/bin/prusa-slicer") == [
                "/usr/local/bin/prusa-slicer",
                "--appimage-extract-and-run",
            ]


def test_extracted_appimage_dir_wins_without_appimage_lock(tmp_path, monkeypatch):
    """A pre-extracted AppImage dir resolves to the AppRun binary and must not
    trigger the AppImage execution lock."""
    from parser import prusa_slicer

    extracted = tmp_path / "extracted"
    (extracted / "usr" / "bin").mkdir(parents=True)
    app_run = extracted / "AppRun"
    app_run.write_text("#!/bin/sh\nexit 0\n")

    monkeypatch.setenv("PRUSA_EXTRACTED_APPIMAGE_DIR", str(extracted))
    resolved = prusa_slicer.prusa_executable()
    assert resolved == str(app_run)
    assert prusa_slicer._executable_command(resolved) == [str(app_run)]
    assert prusa_slicer._uses_appimage(resolved) is False


def test_invalid_extracted_appimage_dir_falls_back(monkeypatch):
    from parser import prusa_slicer

    monkeypatch.setenv("PRUSA_EXTRACTED_APPIMAGE_DIR", "/nonexistent-prusa-dir")
    # Must not raise; falls through to platform auto-detection.
    prusa_slicer.prusa_executable()


def test_slice_timeout_scales_with_model_size(tmp_path, monkeypatch):
    from parser.prusa_slicer import _slice_timeout_for

    monkeypatch.setenv("PRUSA_SLICE_TIMEOUT", "120")
    monkeypatch.setenv("PRUSA_SLICE_TIMEOUT_PER_MB", "2")
    monkeypatch.setenv("PRUSA_SLICE_TIMEOUT_MAX", "900")

    small = tmp_path / "small.stl"
    small.write_bytes(b"x" * 1024)
    assert _slice_timeout_for(str(small)) == 120

    big = tmp_path / "big.stl"
    big.write_bytes(b"x" * (60 * 1024 * 1024))
    assert _slice_timeout_for(str(big)) == 120 + 120

    huge = tmp_path / "huge.stl"
    huge.write_bytes(b"x" * (1024 * 1024 * 1024))
    assert _slice_timeout_for(str(huge)) == 900  # capped


def test_kill_slicer_process_tree_terminates_child():
    """The tree-kill helper must actually stop a spawned process."""
    import sys
    import time as _time

    from parser import prusa_slicer

    kwargs = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = __import__("subprocess").CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    proc = __import__("subprocess").Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        stdout=__import__("subprocess").PIPE,
        stderr=__import__("subprocess").PIPE,
        **kwargs,
    )
    _time.sleep(0.3)
    assert proc.poll() is None

    prusa_slicer._kill_slicer_process_tree(proc, [sys.executable, "-c"], "marker.gcode")

    for _ in range(40):
        if proc.poll() is not None:
            break
        _time.sleep(0.1)
    assert proc.poll() is not None
