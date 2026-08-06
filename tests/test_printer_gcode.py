from pathlib import Path

import pytest

from app.printer_gcode import (
    DEFAULT_BEFORE_LAYER_GCODE,
    DEFAULT_END_GCODE,
    DEFAULT_START_GCODE,
    PrinterLifecycleGcode,
    decode_ini_gcode,
    default_lifecycle_values,
    encode_ini_gcode,
    extract_lifecycle_from_profile,
    normalize_lifecycle_gcode,
)
from app.printer_presets import _generate_printer_profile
from app.routes_printer import api_get_printer_gcode_defaults
from parser.prusa_slicer import generate_slice_config


def _read_flat_config(path: str) -> dict[str, str]:
    settings: dict[str, str] = {}
    for raw_line in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(";") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        settings[key.strip()] = value.strip()
    return settings


def test_default_start_gcode_heats_homes_then_waits() -> None:
    lines = [line.split(";", 1)[0].strip() for line in DEFAULT_START_GCODE.splitlines()]
    lines = [line for line in lines if line]

    assert lines.index("M140 S[first_layer_bed_temperature]") < lines.index("G28")
    assert lines.index("M104 S[first_layer_temperature]") < lines.index("G28")
    assert lines.index("G28") < lines.index("M190 S[first_layer_bed_temperature]")
    assert lines.index("G28") < lines.index("M109 S[first_layer_temperature]")
    assert "M82" in lines
    assert "M83" not in lines
    assert "G29" not in lines


def test_default_before_layer_gcode_updates_printer_progress_display() -> None:
    assert "M117 Layer [layer_num] Z[layer_z]" in DEFAULT_BEFORE_LAYER_GCODE
    assert "[layer_num]" in DEFAULT_BEFORE_LAYER_GCODE
    assert "[layer_z]" in DEFAULT_BEFORE_LAYER_GCODE


def test_default_end_gcode_uses_safe_shutdown_without_universal_parking_assumptions() -> None:
    assert "M400" in DEFAULT_END_GCODE
    assert "M104 S0" in DEFAULT_END_GCODE
    assert "M140 S0" in DEFAULT_END_GCODE
    assert "M107" in DEFAULT_END_GCODE
    assert "M84" in DEFAULT_END_GCODE
    assert not any(line.lstrip().startswith("G1 X") for line in DEFAULT_END_GCODE.splitlines())


def test_ini_gcode_round_trip_preserves_multiline_text() -> None:
    source = "; start\r\nG28\rM104 S0"
    encoded = encode_ini_gcode(source)

    assert encoded == "; start\\nG28\\nM104 S0"
    assert decode_ini_gcode(encoded) == "; start\nG28\nM104 S0"


def test_normalize_lifecycle_rejects_nul_bytes() -> None:
    with pytest.raises(ValueError, match="NUL"):
        normalize_lifecycle_gcode("G28\x00M104 S0", default="")


def test_generated_custom_printer_profile_contains_all_lifecycle_hooks() -> None:
    profile = _generate_printer_profile(
        220,
        220,
        250,
        lifecycle=PrinterLifecycleGcode.build(
            gcode_flavor="klipper",
            start_gcode="START_PRINT BED_TEMP=[first_layer_bed_temperature]",
            before_layer_gcode="; before [layer_num]",
            layer_gcode="; after [layer_num]",
            end_gcode="END_PRINT",
        ),
    )
    lifecycle = extract_lifecycle_from_profile(profile)

    assert lifecycle == {
        "gcode_flavor": "klipper",
        "start_gcode": "START_PRINT BED_TEMP=[first_layer_bed_temperature]",
        "before_layer_gcode": "; before [layer_num]",
        "layer_gcode": "; after [layer_num]",
        "end_gcode": "END_PRINT",
    }


def test_generate_slice_config_preserves_profile_lifecycle_hooks(tmp_path: Path) -> None:
    profile = tmp_path / "printer.ini"
    profile.write_text(
        _generate_printer_profile(
            220,
            220,
            250,
            lifecycle=PrinterLifecycleGcode.build(
                gcode_flavor="marlin2",
                start_gcode="G90\nG28",
                before_layer_gcode="; before [layer_z]",
                layer_gcode="; after [layer_z]",
                end_gcode="M104 S0\nM84",
            ),
        ),
        encoding="utf-8",
    )

    config_path = generate_slice_config(printer_profile_path=str(profile))
    try:
        settings = _read_flat_config(config_path)
    finally:
        Path(config_path).unlink(missing_ok=True)

    assert settings["gcode_flavor"] == "marlin2"
    assert decode_ini_gcode(settings["start_gcode"]) == "G90\nG28"
    assert decode_ini_gcode(settings["before_layer_gcode"]) == "; before [layer_z]"
    assert decode_ini_gcode(settings["layer_gcode"]) == "; after [layer_z]"
    assert decode_ini_gcode(settings["end_gcode"]) == "M104 S0\nM84"


def test_generate_slice_config_backfills_lifecycle_for_legacy_profiles(tmp_path: Path) -> None:
    profile = tmp_path / "legacy.ini"
    profile.write_text(
        "[machine:legacy]\nbed_shape = 0x0,220x0,220x220,0x220\nnozzle_diameter = 0.4\n",
        encoding="utf-8",
    )

    config_path = generate_slice_config(printer_profile_path=str(profile))
    try:
        settings = _read_flat_config(config_path)
    finally:
        Path(config_path).unlink(missing_ok=True)

    assert settings["gcode_flavor"] == "marlin2"
    assert decode_ini_gcode(settings["start_gcode"]) == DEFAULT_START_GCODE
    assert decode_ini_gcode(settings["before_layer_gcode"]) == DEFAULT_BEFORE_LAYER_GCODE
    assert decode_ini_gcode(settings["end_gcode"]) == DEFAULT_END_GCODE


def test_builtin_profiles_define_flavor_without_copying_lifecycle_defaults() -> None:
    profile_dir = Path("profiles/prusa/printers")
    for profile_path in profile_dir.glob("*.ini"):
        profile_text = profile_path.read_text(encoding="utf-8")
        lifecycle = extract_lifecycle_from_profile(profile_text)
        expected_flavor = "klipper" if profile_path.name == "voron_v2_250.ini" else "marlin2"
        assert lifecycle["gcode_flavor"] == expected_flavor, profile_path.name
        assert "start_gcode =" not in profile_text, profile_path.name
        assert "before_layer_gcode =" not in profile_text, profile_path.name
        assert "layer_gcode =" not in profile_text, profile_path.name
        assert "end_gcode =" not in profile_text, profile_path.name


def test_generate_slice_config_preserves_existing_firmware_flavor(tmp_path: Path) -> None:
    profile = tmp_path / "third-party.ini"
    profile.write_text(
        "[machine:third-party]\ngcode_flavor = smoothie\nnozzle_diameter = 0.4\n",
        encoding="utf-8",
    )

    config_path = generate_slice_config(printer_profile_path=str(profile))
    try:
        settings = _read_flat_config(config_path)
    finally:
        Path(config_path).unlink(missing_ok=True)

    assert settings["gcode_flavor"] == "smoothie"
    assert decode_ini_gcode(settings["start_gcode"]) == DEFAULT_START_GCODE


def test_defaults_endpoint_returns_canonical_multiline_values() -> None:
    import asyncio

    response = asyncio.run(api_get_printer_gcode_defaults())

    assert response == {"defaults": default_lifecycle_values()}
    assert "M117 Layer" in response["defaults"]["before_layer_gcode"]
