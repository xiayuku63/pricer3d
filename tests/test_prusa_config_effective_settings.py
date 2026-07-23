import os

from parser.prusa_slicer import generate_slice_config
from app.printers import resolve_printer
from app.services.quote import _extract_preset_core_params, _resolve_effective_slicer_params


def test_selected_preset_core_params_are_extracted_from_ini():
    preset = {
        "content": b"layer_height = 0.40\nperimeters = 2\nfill_density = 15%\n",
    }
    assert _extract_preset_core_params(preset) == {
        "layer_height": 0.4,
        "perimeters": 2,
        "infill": 15,
    }


def test_preset_parser_supports_prusaslicer_aliases_without_defaults():
    preset = {
        "content": b"wall_loops = 4\nsparse_infill_density = 30%\n",
    }
    assert _extract_preset_core_params(preset) == {
        "perimeters": 4,
        "infill": 30,
    }


def test_effective_printer_and_material_settings_override_profile():
    path = generate_slice_config(
        printer_profile_path="profiles/prusa/printers/bambu_a1.ini",
        nozzle_diameter=0.8,
        max_print_speed=180,
        max_acceleration=7000,
        jerk_limit=8,
        max_volumetric_speed=18,
    )
    try:
        text = open(path, encoding="utf-8").read()
        assert "nozzle_diameter = 0.8" in text
        assert "max_print_speed = 180" in text
        assert "max_volumetric_speed = 18" in text
        assert "filament_max_volumetric_speed = 18" in text
        assert "machine_max_acceleration_extruding = 7000" in text
        assert "machine_max_jerk_x = 8" in text
    finally:
        os.unlink(path)


def test_display_name_compound_printer_writes_requested_nozzle():
    printer = resolve_printer("Bambu Lab A1_08")
    assert printer["_compound_id"] == "bambu_a1_08"

    path = generate_slice_config(
        printer_profile_path="profiles/prusa/printers/bambu_a1.ini",
        nozzle_diameter=printer["_nozzle"],
    )
    try:
        text = open(path, encoding="utf-8").read()
        assert "nozzle_diameter = 0.8" in text
    finally:
        os.unlink(path)


def test_nozzle_override_survives_flattening_without_printer_profile():
    path = generate_slice_config(
        printer_profile_path=None,
        nozzle_diameter=0.8,
    )
    try:
        text = open(path, encoding="utf-8").read()
        nozzle_lines = [line for line in text.splitlines() if line.startswith("nozzle_diameter =")]
        assert nozzle_lines == ["nozzle_diameter = 0.8"]
    finally:
        os.unlink(path)


def test_material_speed_and_temperature_settings_are_written_into_slice_config():
    path = generate_slice_config(
        printer_profile_path="profiles/prusa/printers/bambu_a1.ini",
        hotend_temp=245,
        bed_temp=80,
        max_volumetric_speed=10,
    )
    try:
        text = open(path, encoding="utf-8").read()
        assert "temperature = 245" in text
        assert "first_layer_temperature = 245" in text
        assert "bed_temperature = 80" in text
        assert "first_layer_bed_temperature = 80" in text
        assert "filament_max_volumetric_speed = 10" in text
    finally:
        os.unlink(path)


def test_model_page_parameters_override_selected_preset_parameters():
    preset = {
        "name": "0.20-2-15%",
        "content": b"layer_height = 0.20\nperimeters = 2\nfill_density = 15%\n",
    }
    path = generate_slice_config(
        layer_height=0.40,
        infill_percent=30,
        perimeters=4,
        slicer_preset=preset,
    )
    try:
        text = open(path, encoding="utf-8").read()
        assert "layer_height = 0.4" in text
        assert "perimeters = 4" in text
        assert "fill_density = 30%" in text
    finally:
        os.unlink(path)


def test_effective_slicer_params_use_preset_values_and_page_values_as_fallbacks():
    preset = {
        "content": b"layer_height = 0.40\nperimeters = 2\nfill_density = 15%\n",
    }
    assert _resolve_effective_slicer_params(0.2, 3, 20, preset) == (0.4, 2, 15)
    assert _resolve_effective_slicer_params(0.28, 4, 30, None) == (0.28, 4, 30)
