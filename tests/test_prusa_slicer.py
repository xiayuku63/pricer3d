from unittest.mock import patch
from types import SimpleNamespace

from parser import prusa_slicer


def test_native_windows_executable_path_with_spaces_stays_one_argv_item():
    exe = r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe"

    with patch.object(prusa_slicer.subprocess, "check_output", return_value=b"PrusaSlicer-2.9.6\n") as check_output:
        with patch.object(prusa_slicer, "prusa_executable", return_value=exe):
            result = prusa_slicer.prusa_executable_diagnostics()

    assert result["found"] is True
    assert result["version"] == "PrusaSlicer-2.9.6"
    check_output.assert_called_once()
    assert check_output.call_args.args[0] == [exe, "--help"]


def test_wsl_wrapper_command_is_split_into_argv_items():
    assert prusa_slicer._executable_command("wsl.exe -d Ubuntu prusa-slicer") == [
        "wsl.exe",
        "-d",
        "Ubuntu",
        "prusa-slicer",
    ]


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
