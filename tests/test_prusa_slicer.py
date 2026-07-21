from unittest.mock import patch
from types import SimpleNamespace

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
        with patch("parser.prusa_slicer.os.getenv", return_value=r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer.exe"):
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

    def fake_run(command, **kwargs):
        output_path.write_text(
            "; estimated printing time (normal mode) = 1m 2s\n; total filament used [g] = 1.5\n",
            encoding="utf-8",
        )
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    with patch.object(prusa_slicer, "prusa_executable", return_value="/usr/bin/prusa-slicer"):
        with patch.object(prusa_slicer.subprocess, "run", side_effect=fake_run) as run:
            result = prusa_slicer.run_prusa_slice(
                "static/test_cube.stl",
                str(output_path),
            )

    command = run.call_args.args[0]
    assert "--headless" not in command
    assert result["time_s"] == 62
    assert result["filament_g"] == 1.5
