"""
Pricing calculation utilities for Pricer3D.

Pure functions — no dependencies on app.* or calculator.*
Contains: weight/time estimation, config merging, cost breakdown building.
"""

import logging
from typing import Optional

from calculator.formula import (
    DEFAULT_UNIT_COST_FORMULA,
    DEFAULT_TOTAL_COST_FORMULA,
)

logger = logging.getLogger(__name__)

# ── Default pricing config (must match app.config.DEFAULT_PRICING_CONFIG) ──

DEFAULT_PRICING_CONFIG = {
    "machine_hourly_rate_cny": 15.0,
    "setup_fee_cny": 0.0,
    "min_job_fee_cny": 0.0,
    "material_waste_percent": 5.0,
    "support_percent_of_model": 3.0,
    "post_process_fee_per_part_cny": 0.0,
    "prusa_time_correction": 1.0,
    "use_prusaslicer": 1,
    "support_mode": "on",
    "support_price_per_g": 0.0,
    "time_overhead_min": 5.0,
    "time_vol_min_per_cm3": 0.8,
    "time_area_min_per_cm2": 0.0,
    "time_ref_layer_height_mm": 0.2,
    "time_layer_height_exponent": 1.0,
    "time_ref_infill_percent": 20.0,
    "time_infill_coefficient": 1.0,
    "unit_cost_formula": DEFAULT_UNIT_COST_FORMULA,
    "total_cost_formula": DEFAULT_TOTAL_COST_FORMULA,
}

# ── Default materials ──

DEFAULT_MATERIALS = [
    {"name": "PLA", "density": 1.24, "price_per_kg": 60.0, "hotend_temp": 220, "bed_temp": 55, "max_volumetric_speed": 21.0},
    {"name": "PETG", "density": 1.27, "price_per_kg": 80.0, "hotend_temp": 240, "bed_temp": 70, "max_volumetric_speed": 12.0},
    {"name": "ABS", "density": 1.04, "price_per_kg": 90.0, "hotend_temp": 250, "bed_temp": 90, "max_volumetric_speed": 14.0},
    {"name": "ASA", "density": 1.04, "price_per_kg": 100.0, "hotend_temp": 260, "bed_temp": 100, "max_volumetric_speed": 14.0},
    {"name": "TPU", "density": 1.20, "price_per_kg": 120.0, "hotend_temp": 220, "bed_temp": 50, "max_volumetric_speed": 6.0},
    {"name": "PA", "density": 1.14, "price_per_kg": 100.0, "hotend_temp": 270, "bed_temp": 100, "max_volumetric_speed": 9.0},
    {"name": "PC", "density": 1.20, "price_per_kg": 150.0, "hotend_temp": 290, "bed_temp": 90, "max_volumetric_speed": 10.0},
    {"name": "PLA+", "density": 1.24, "price_per_kg": 70.0, "hotend_temp": 220, "bed_temp": 55, "max_volumetric_speed": 20.0},
    {"name": "Flexible", "density": 1.20, "price_per_kg": 110.0, "hotend_temp": 220, "bed_temp": 50, "max_volumetric_speed": 6.0},
]

DEFAULT_SUPPORTED_EXTENSIONS = {".stl", ".stp", ".step", ".obj", ".3mf"}
DEFAULT_MAX_FILE_SIZE_BYTES = 256 * 1024 * 1024  # 256 MB


def calculate_weight(volume_mm3: float, material_density: float) -> float:
    """Calculate model weight in grams."""
    return volume_mm3 * material_density / 1000.0


def merge_pricing_config(raw_config: Optional[dict]) -> dict:
    """Merge user pricing config with system defaults."""
    if not raw_config:
        return dict(DEFAULT_PRICING_CONFIG)
    merged = dict(DEFAULT_PRICING_CONFIG)
    for k, v in raw_config.items():
        merged[k] = v
    return merged


def estimate_print_time_hours(
    volume_mm3: float,
    surface_area_mm2: float,
    layer_height_mm: float,
    infill_percent: int,
    pricing_config: dict,
) -> float:
    """Estimate print time in hours from geometry + config.

    This is the non-slicer (analytical) estimation used when PrusaSlicer
    is not available or not enabled.
    """
    cfg = merge_pricing_config(pricing_config)
    vol_cm3 = volume_mm3 / 1000.0
    area_cm2 = surface_area_mm2 / 100.0
    overhead_min = float(cfg.get("time_overhead_min") or 0.0)
    vol_min_per_cm3 = float(cfg.get("time_vol_min_per_cm3") or 0.0)
    area_min_per_cm2 = float(cfg.get("time_area_min_per_cm2") or 0.0)
    ref_layer = float(cfg.get("time_ref_layer_height_mm") or 0.2)
    layer_exp = float(cfg.get("time_layer_height_exponent") or 1.0)
    ref_infill = float(cfg.get("time_ref_infill_percent") or 20.0)
    infill_coeff = float(cfg.get("time_infill_coefficient") or 1.0)

    layer_factor = (ref_layer / max(layer_height_mm, 0.01)) ** layer_exp
    infill_factor = 1.0 + infill_coeff * max(0.0, (infill_percent - ref_infill) / 100.0)
    total_min = (
        overhead_min + (vol_cm3 * vol_min_per_cm3 * layer_factor * infill_factor) + (area_cm2 * area_min_per_cm2)
    )
    return max(0.0, total_min / 60.0)


def normalize_materials(user_materials: list) -> list:
    """Normalize user material specs to a standard list format.

    Accepts either the app's ORM format or raw dict format.
    Returns a list of dicts with keys: name, density, price_per_kg.
    Falls back to DEFAULT_MATERIALS if input is empty/invalid.
    """
    if not user_materials:
        return list(DEFAULT_MATERIALS)

    result = []
    for m in user_materials:
        if isinstance(m, str):
            # Legacy: material name string → lookup in defaults
            matched = next(
                (d for d in DEFAULT_MATERIALS if d["name"] == m),
                None,
            )
            if matched:
                result.append(dict(matched))
            continue
        if not isinstance(m, dict):
            continue

        name = str(m.get("name", m.get("material_name", "")))
        if not name:
            continue

        density = m.get("density") or m.get("density_g_cm3")
        try:
            density = float(density)
        except (TypeError, ValueError):
            matched = next(
                (d for d in DEFAULT_MATERIALS if d["name"] == name),
                None,
            )
            density = matched["density"] if matched else 1.24

        price = m.get("price_per_kg") or m.get("price_per_unit")
        try:
            price = float(price)
        except (TypeError, ValueError):
            matched = next(
                (d for d in DEFAULT_MATERIALS if d["name"] == name),
                None,
            )
            price = matched["price_per_kg"] if matched else 60.0

        _ht = m.get("hotend_temp") or m.get("hotend_temp_min") or m.get("hotend_temp_max")
        _bt = m.get("bed_temp") or m.get("bed_temp_min") or m.get("bed_temp_max")
        _mvs = m.get("max_volumetric_speed") or m.get("max_flow_speed") or m.get("max_flow")
        if not _ht:
            _ht = next((d.get("hotend_temp", 220) for d in DEFAULT_MATERIALS if d["name"] == name), 220)
        if not _bt:
            _bt = next((d.get("bed_temp", 55) for d in DEFAULT_MATERIALS if d["name"] == name), 55)
        if _mvs is None:
            _mvs = next((d.get("max_volumetric_speed") for d in DEFAULT_MATERIALS if d["name"] == name), None)

        result.append(
            {
                "name": name,
                "density": density,
                "price_per_kg": price,
                "hotend_temp": int(float(_ht)),
                "bed_temp": int(float(_bt)),
                "max_volumetric_speed": float(_mvs) if _mvs is not None else None,
            }
        )

    return (
        result
        if result
        else [
            {**d, "hotend_temp": d.get("hotend_temp", 220), "bed_temp": d.get("bed_temp", 55)}
            for d in DEFAULT_MATERIALS
        ]
    )
