"""
Cost calculation — the core pricing engine for Pricer3D.

This module is the bridge between pure formulas/pricing math and file processing.
It contains the main ``calculate_cost()`` and ``process_single_file()`` functions.

NOTE: This module no longer imports from ``app.*``. All app-layer dependencies
(material lookup, printer resolution, DB queries) are passed as parameters.
"""

import os
import json
import logging
import shutil
import tempfile
import time
import uuid
from typing import Dict, List, Optional

import numpy as np
from fastapi import UploadFile

from calculator.formula import (
    FORMULA_ALIAS_TO_CANONICAL,
    FORMULA_CANONICAL_VARS,
    DEFAULT_UNIT_COST_FORMULA,
    DEFAULT_TOTAL_COST_FORMULA,
    safe_eval_formula,
    with_formula_aliases,
    validate_formula_expression,
)
from calculator.pricing import (
    DEFAULT_PRICING_CONFIG,
    DEFAULT_MATERIALS,
    DEFAULT_SUPPORTED_EXTENSIONS,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    calculate_weight,
    estimate_print_time_hours,
    merge_pricing_config,
    normalize_materials,
)
from parser.prusa_slicer import run_prusa_slice

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════
# Re-exports for backward compatibility (imported by app layer)
# ═══════════════════════════════════════════════════════════════════

# From calculator.formula
from calculator.formula import (
    FORMULA_ALIAS_TO_CANONICAL as FORMULA_ALIAS_TO_CANONICAL,
    FORMULA_CANONICAL_VARS as FORMULA_CANONICAL_VARS,
    DEFAULT_UNIT_COST_FORMULA as DEFAULT_UNIT_COST_FORMULA,
    DEFAULT_TOTAL_COST_FORMULA as DEFAULT_TOTAL_COST_FORMULA,
    safe_eval_formula as safe_eval_formula,
    with_formula_aliases as with_formula_aliases,
    validate_formula_expression as validate_formula_expression,
)

# From calculator.pricing
from calculator.pricing import (
    DEFAULT_MATERIALS as DEFAULT_MATERIALS,
    DEFAULT_PRICING_CONFIG as DEFAULT_PRICING_CONFIG,
)

__all__ = [
    # Pure functions (re-exports)
    "FORMULA_ALIAS_TO_CANONICAL",
    "FORMULA_CANONICAL_VARS",
    "DEFAULT_UNIT_COST_FORMULA",
    "DEFAULT_TOTAL_COST_FORMULA",
    "DEFAULT_PRICING_CONFIG",
    "DEFAULT_MATERIALS",
    "safe_eval_formula",
    "validate_formula_expression",
    "with_formula_aliases",
    "calculate_weight",
    "estimate_print_time_hours",
    "merge_pricing_config",
    "normalize_materials",
    # Core business logic
    "calculate_cost",
    "process_single_file",
    "process_single_file_sync",
    "resolve_printer_params",
]


# ═══════════════════════════════════════════════════════════════════
# Printer param resolution helper (standalone, no app deps)
# ═══════════════════════════════════════════════════════════════════

def resolve_printer_params(
    printer_model_id: str,
    resolvers: Dict[str, dict] = None,
    speed_params_override: dict = None,
) -> tuple:
    """Resolve printer bed dimensions and speed params.

    Args:
        printer_model_id: e.g. ``bambu_a1_mini_04``
        resolvers: A dict of ``{printer_id: {name, bed_width, bed_depth, bed_height, ...}}``
                   or None (dimension check skipped).
        speed_params_override: Pre-resolved speed parameters (max_speed, etc.)
                               from the app layer.

    Returns:
        (printer_bed_info dict or None, speed_params dict)
    """
    printer_bed = None
    speed_params = speed_params_override or {}

    if printer_model_id and resolvers:
        pm = resolvers.get(printer_model_id)
        if pm:
            printer_bed = {
                "name": pm.get("name", ""),
                "bed_width": float(pm.get("bed_width", 0)),
                "bed_depth": float(pm.get("bed_depth", 0)),
                "bed_height": float(pm.get("bed_height", 0)),
            }

    return printer_bed, speed_params


def _check_model_vs_printer_bed(
    dimensions: dict,
    printer_bed: dict,
) -> Optional[str]:
    """Check if model dimensions exceed printer bed. Returns error string or None."""
    if not printer_bed or not dimensions:
        return None

    dx = float(dimensions.get("x", 0))
    dy = float(dimensions.get("y", 0))
    dz = float(dimensions.get("z", 0))
    bw = printer_bed["bed_width"]
    bd = printer_bed["bed_depth"]
    bh = printer_bed["bed_height"]

    if dx > bw or dy > bd or dz > bh:
        return (
            f"模型尺寸 ({dx:.1f}×{dy:.1f}×{dz:.1f}mm) 超出打印机 "
            f"{printer_bed['name']} 的打印范围 ({bw:.0f}×{bd:.0f}×{bh:.0f}mm)"
        )
    return None


# ═══════════════════════════════════════════════════════════════════
# Core cost calculation (no app deps)
# ═══════════════════════════════════════════════════════════════════

def calculate_cost(
    volume_mm3: float,
    surface_area_mm2: float,
    material: str,
    layer_height_mm: float,
    infill_percent: int,
    user_materials: list,
    pricing_config: dict,
    quantity: int,
    model_path: Optional[str] = None,
    slicer_preset: Optional[dict] = None,
    perimeters: Optional[int] = None,
    current_user: Optional[dict] = None,
    auto_orient: bool = False,
    top_shell_layers: Optional[int] = None,
    bottom_shell_layers: Optional[int] = None,
    model_dimensions: Optional[dict] = None,
    _resolved_printer: Optional[dict] = None,        # pre-resolved printer info
    _speed_params: Optional[dict] = None,              # pre-resolved speed params
    _printer_profile_path: Optional[str] = None,       # pre-resolved profile path
):
    """Calculate cost for a single model from geometry + material + config.

    This is a pure calculation function. All data (materials, pricing, printer info)
    is passed in as parameters — no ``from app.*`` imports are used.
    """
    materials = normalize_materials(user_materials)
    spec = next((m for m in materials if m["name"] == material), None) or DEFAULT_MATERIALS[0]
    cfg = merge_pricing_config(pricing_config)

    model_weight_g = calculate_weight(volume_mm3, material_density=spec["density"])
    waste_percent = float(cfg.get("material_waste_percent") or 0.0)
    support_percent = float(cfg.get("support_percent_of_model") or 0.0)
    effective_weight_g = model_weight_g * (1.0 + max(0.0, waste_percent) / 100.0 + max(0.0, support_percent) / 100.0)
    material_cost = effective_weight_g * (float(spec.get("price_per_kg") or 0.0) / 1000.0)

    unit_time_h = estimate_print_time_hours(volume_mm3, surface_area_mm2, layer_height_mm, infill_percent, cfg)
    machine_hourly_rate = float(cfg.get("machine_hourly_rate_cny") or 0.0)
    machine_cost = unit_time_h * machine_hourly_rate

    setup_fee = float(cfg.get("setup_fee_cny") or 0.0)
    post_per_part = float(cfg.get("post_process_fee_per_part_cny") or 0.0)
    min_job_fee = float(cfg.get("min_job_fee_cny") or 0.0)

    base_unit_cost = material_cost + machine_cost + post_per_part
    difficulty_multiplier = 1.0

    # ── 自动朝向优化 (Lay on Face) ──
    orientation_info: dict = {}
    _oriented_tmp_path: Optional[str] = None
    if auto_orient and model_path and os.path.exists(model_path):
        try:
            from calculator.orientation import get_best_face_for_slicing

            _learned_model = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "data", "orientation_model.pkl",
            )
            _orient_method = "learned" if os.path.exists(_learned_model) else "coplanar"
            orient_result = get_best_face_for_slicing(model_path, method=_orient_method)
            oriented_path = orient_result.get("oriented_path")
            if oriented_path and oriented_path != model_path:
                _oriented_tmp_path = oriented_path
                logger.info(
                    "自动朝向优化: 得分=%.1f 旋转=%s → %s",
                    orient_result.get("score", 0),
                    orient_result.get("euler_angles_deg", {}),
                    os.path.basename(oriented_path),
                )
                orientation_info = {
                    "auto_orient_score": orient_result.get("score"),
                    "euler_angles_deg": orient_result.get("euler_angles_deg"),
                    "selected_face_area": (
                        orient_result.get("face", {}).get("area")
                        if orient_result.get("face") else None
                    ),
                    "tune_report": orient_result.get("tune_report"),
                }
                model_path = oriented_path
        except Exception as e:
            logger.warning("自动朝向优化失败，使用原始朝向: %s", e, exc_info=True)

    # Determine whether to use PrusaSlicer
    raw_prusa = cfg.get("use_prusaslicer")
    use_prusaslicer = False
    try:
        use_prusaslicer = bool(int(raw_prusa))
    except Exception:
        use_prusaslicer = str(raw_prusa or "").strip().lower() in {"1", "true", "yes", "y", "on"}

    support_mode = str(cfg.get("support_mode") or "diff").strip().lower() or "diff"

    slicer_time_s = None
    slicer_filament_g_per_part = None
    preset_used = None
    slicer_error_msg = None
    prusaslicer_used = False
    support_weight_g_per_part = 0.0
    output_gcode = None

    # ── PrusaSlicer ──
    if use_prusaslicer and model_path and os.path.exists(model_path):
        try:
            logger.info(f"PrusaSlicer enabled, slicing: {model_path}")
            prusaslicer_used = True

            # Convert 3MF to STL for PrusaSlicer
            actual_slice_path = model_path
            _tmp_3mf_stl = None
            if model_path.lower().endswith(".3mf"):
                from parser.geometry import _extract_geometry_from_3mf
                _tmp_3mf_stl = _extract_geometry_from_3mf(model_path)
                if _tmp_3mf_stl:
                    actual_slice_path = _tmp_3mf_stl
                    logger.info(f"3MF converted to STL for slicing: {_tmp_3mf_stl}")

            # Use pre-resolved printer profile path if available
            _printer_profile = _printer_profile_path
            logger.info(f"PrusaSlicer params: _printer_profile={_printer_profile!r} _resolved_printer={_resolved_printer.get('name') if _resolved_printer else None}")

            # Pre-check model height vs printer max_print_height
            _printer_max_z = None
            _printer_name = None
            if _resolved_printer:
                _printer_max_z = float(_resolved_printer.get("bed_height", 0))
                _printer_name = str(_resolved_printer.get("name", ""))
            if not _printer_max_z or _printer_max_z <= 0:
                _printer_max_z = 256.0
                _printer_name = _printer_name or "系统默认"
            if model_dimensions:
                model_z = float(model_dimensions.get("z", 0))
                if model_z > _printer_max_z > 0:
                    slicer_error_msg = "超出打印面积，请换打印机或拆分模型"
                    logger.warning(
                        f"PrusaSlicer skipped: model_z={model_z:.1f} > "
                        f"printer_max_z={_printer_max_z:.0f} ({_printer_name})"
                    )
                    raise RuntimeError(slicer_error_msg)

            # Get the base save path for outputs
            # (model_path already resolved; we write gcode alongside it)
            base_name = os.path.splitext(os.path.basename(model_path))[0]
            outputs_dir = os.path.dirname(model_path)  # same dir as model
            output_gcode = os.path.join(outputs_dir, f"{base_name}.gcode")

            speed_kwargs = {}
            if _speed_params:
                if _speed_params.get("max_speed"):
                    speed_kwargs["max_speed"] = float(_speed_params["max_speed"])
                if _speed_params.get("max_acceleration"):
                    speed_kwargs["max_acceleration"] = float(_speed_params["max_acceleration"])
                if _speed_params.get("jerk_limit"):
                    speed_kwargs["jerk_limit"] = float(_speed_params["jerk_limit"])

            stats = run_prusa_slice(
                actual_slice_path, output_gcode,
                layer_height=layer_height_mm,
                infill_percent=infill_percent,
                perimeters=perimeters or 3,
                material_density=spec["density"],
                slicer_preset=slicer_preset,
                enable_supports=True,
                printer_profile_path=_printer_profile,
                top_shell_layers=top_shell_layers,
                bottom_shell_layers=bottom_shell_layers,
                hotend_temp=spec.get("hotend_temp"),
                bed_temp=spec.get("bed_temp"),
                **speed_kwargs,
            )
            if stats.get("time_s", 0) > 0:
                correction = float(cfg.get("prusa_time_correction") or 1.0)
                slicer_time_s = max(1, int(stats["time_s"] * correction))
                logger.info(f"PrusaSlicer raw={stats['time_s']}s × corr={correction} = {slicer_time_s}s")
            if stats.get("filament_g", 0) > 0:
                slicer_filament_g_per_part = stats["filament_g"]
            elif stats.get("filament_cm3", 0) > 0:
                filament_cm3 = stats["filament_cm3"]
                slicer_filament_g_per_part = filament_cm3 * spec["density"]
            if not preset_used and stats.get("preset_used"):
                preset_used = str(stats["preset_used"])

            # Copy G-code to desktop output dir
            desktop_dir = "/app/desktop_outputs"
            if os.path.isdir(desktop_dir):
                try:
                    dest = os.path.join(desktop_dir, os.path.basename(output_gcode))
                    shutil.copy2(output_gcode, dest)
                    logger.info(f"G-code copied to desktop: {dest}")
                except Exception as e:
                    logger.warning(f"Failed to copy gcode to desktop: {e}")

        except Exception as e:
            logger.error(f"PrusaSlicer failed for {model_path}: {e}")
            slicer_time_s = None
            slicer_filament_g_per_part = None
            slicer_error_msg = str(e)
            if _tmp_3mf_stl and os.path.exists(_tmp_3mf_stl):
                try:
                    os.unlink(_tmp_3mf_stl)
                except OSError:
                    pass

    # ── Adjust estimates with slicer results ──
    if slicer_filament_g_per_part is not None and slicer_filament_g_per_part > 0:
        support_percent = 0.0
        effective_weight_g = float(slicer_filament_g_per_part) * (1.0 + max(0.0, waste_percent) / 100.0)
        material_cost = effective_weight_g * (float(spec.get("price_per_kg") or 0.0) / 1000.0)
    if slicer_time_s is not None and slicer_time_s > 0:
        unit_time_h = float(slicer_time_s) / 3600.0
        machine_cost = unit_time_h * machine_hourly_rate
        base_unit_cost = material_cost + machine_cost + post_per_part

    # ── Support cost ──
    support_price_per_g = float(cfg.get("support_price_per_g") or 0.0)
    support_price_per_g = max(0.0, min(support_price_per_g, 1000.0))
    support_cost_per_part_cny = float(support_weight_g_per_part) * support_price_per_g

    # ── Build variables dict ──
    variables = {
        "effective_weight_g": float(effective_weight_g),
        "model_weight_g": float(model_weight_g),
        "price_per_kg": float(spec.get("price_per_kg") or 0.0),
        "density": float(spec.get("density") or 1.0),
        "unit_time_h": float(unit_time_h),
        "machine_hourly_rate_cny": float(machine_hourly_rate),
        "post_process_fee_per_part_cny": float(post_per_part),
        "support_weight_g": float(support_weight_g_per_part),
        "support_price_per_g": float(support_price_per_g),
        "support_cost_per_part_cny": float(support_cost_per_part_cny),
        "quantity": float(quantity),
        "setup_fee_cny": float(setup_fee),
        "min_job_fee_cny": float(min_job_fee),
        "material_waste_percent": float(waste_percent),
        "support_percent_of_model": float(support_percent),
        "material_cost_cny": float(material_cost),
        "machine_cost_cny": float(machine_cost),
        "volume_mm3": float(volume_mm3),
        "surface_area_mm2": float(surface_area_mm2),
    }

    # ── Apply formula ──
    unit_formula = str(cfg.get("unit_cost_formula") or DEFAULT_UNIT_COST_FORMULA).strip()
    total_formula = str(cfg.get("total_cost_formula") or DEFAULT_TOTAL_COST_FORMULA).strip()

    unit_cost = safe_eval_formula(unit_formula, variables)
    if unit_cost is None or unit_cost < 0:
        unit_cost = base_unit_cost + float(support_cost_per_part_cny)

    subtotal = (unit_cost * quantity) + setup_fee
    variables["unit_cost_cny"] = float(unit_cost)
    variables["subtotal_cny"] = float(subtotal)
    variables = with_formula_aliases(variables)

    total = safe_eval_formula(total_formula, variables)
    if total is None or total < 0:
        total = max(subtotal, min_job_fee)

    total_time_h = unit_time_h * quantity

    # ── Build breakdown ──
    breakdown = {
        "material_cost_cny": round(material_cost, 2),
        "machine_cost_cny": round(machine_cost, 2),
        "post_process_cost_per_part_cny": round(post_per_part, 2),
        "support_weight_g_per_part": round(support_weight_g_per_part, 3),
        "support_price_per_g": round(support_price_per_g, 4),
        "support_cost_per_part_cny": round(support_cost_per_part_cny, 2),
        "prusaslicer_used": bool(prusaslicer_used and slicer_time_s is not None),
        "slicer_used": "prusaslicer" if (prusaslicer_used and slicer_time_s is not None) else None,
        "slicer_fallback": bool(use_prusaslicer and (slicer_time_s is None or slicer_time_s <= 0)),
        "slicer_error": slicer_error_msg,
        "slicer_filament_g_per_part": (
            round(float(slicer_filament_g_per_part), 3)
            if slicer_filament_g_per_part is not None else None
        ),
        "slicer_preset_used": preset_used,
        "slicer_estimated_time_s": int(slicer_time_s) if slicer_time_s is not None else None,
        "prusa_time_correction": float(cfg.get("prusa_time_correction") or 1.0),
        "setup_fee_cny": round(setup_fee, 2),
        "min_job_fee_cny": round(min_job_fee, 2),
        "subtotal_cny": round(subtotal, 2),
        "unit_cost_formula": unit_formula,
        "total_cost_formula": total_formula,
        **(orientation_info if orientation_info else {}),
    }

    # ── G-code analysis ──
    from calculator.gcode_utils import analyze_gcode_output
    gcode_summary = None
    if prusaslicer_used and output_gcode and os.path.exists(output_gcode):
        gcode_summary = analyze_gcode_output(output_gcode)

    # Cleanup temp oriented model
    if _oriented_tmp_path and os.path.exists(_oriented_tmp_path):
        try:
            os.unlink(_oriented_tmp_path)
        except OSError:
            pass

    if gcode_summary:
        breakdown["gcode_summary"] = gcode_summary

    return (
        round(unit_cost, 2),
        round(model_weight_g, 2),
        round(unit_time_h, 3),
        round(total, 2),
        round(effective_weight_g, 2),
        round(total_time_h, 3),
        breakdown,
    )


# ═══════════════════════════════════════════════════════════════════
# File-processing orchestration
# ═══════════════════════════════════════════════════════════════════

async def process_single_file(
    file: UploadFile,
    material: str,
    layer_height: float,
    infill: int,
    quantity: int,
    color: str,
    user_materials: List[dict],
    pricing_config: dict,
    slicer_preset: Optional[dict] = None,
    perimeters: Optional[int] = None,
    current_user: Optional[dict] = None,
    auto_orient: bool = False,
    orient_x: Optional[float] = None,
    orient_y: Optional[float] = None,
    orient_z: Optional[float] = None,
    supported_extensions: set = DEFAULT_SUPPORTED_EXTENSIONS,
    max_file_size: int = DEFAULT_MAX_FILE_SIZE_BYTES,
    printer_bed_resolver: Optional[dict] = None,
    speed_params_override: Optional[dict] = None,
    printer_profile_path: Optional[str] = None,
):
    """Process a single uploaded file: save, calculate geometry, compute cost.

    Args:
        file: Uploaded file object.
        material: Material name (must match a key in user_materials).
        layer_height: Layer height in mm.
        infill: Infill percentage (0-100).
        quantity: Number of copies.
        color: Color hex or name.
        user_materials: List of material dicts.
        pricing_config: Pricing configuration dict.
        slicer_preset: Optional user preset.
        perimeters: Wall count.
        current_user: User dict (for file path scoping).
        auto_orient: Enable auto-orientation.
        orient_x/y/z: Manual orientation angles.
        supported_extensions: Set of allowed file extensions (no app import needed).
        max_file_size: Max file size in bytes.
        printer_bed_resolver: Dict of {printer_id: printer_info} for dimension checks.
        speed_params_override: Pre-queried printer speed params.
        printer_profile_path: Pre-resolved path to printer profile INI.
    """
    from parser.geometry import calculate_geometry

    filename = file.filename or "unnamed_file"
    _, ext = os.path.splitext(filename.lower())
    if ext not in supported_extensions:
        return {
            "filename": filename,
            "status": "failed",
            "error": f"不支持的文件格式: {ext}。支持: {', '.join(sorted(supported_extensions))}",
        }

    file_content = await file.read()
    if len(file_content) >= max_file_size:
        return {
            "filename": filename,
            "status": "failed",
            "error": f"文件大小必须小于 {max_file_size // (1024*1024)}MB",
        }

    try:
        # We need a save location. Use a temp dir when current_user is None.
        if current_user:
            user_folder = f"user_{current_user['id']}_{current_user['username']}"
            uploads_day_dir = os.path.join(
                "data", "uploads", user_folder,
                _date_folder_utc(),
                f"{uuid.uuid4().hex[:8]}_{os.path.splitext(os.path.basename(filename))[0]}",
            )
            os.makedirs(uploads_day_dir, exist_ok=True)
            saved_name = f"{uuid.uuid4().hex[:8]}_{_sanitize_filename(os.path.splitext(os.path.basename(filename))[0])}{ext}"
            model_saved_path = os.path.join(uploads_day_dir, saved_name)
        else:
            # Anonymous: use temp
            model_saved_path = os.path.join(
                tempfile.mkdtemp(prefix="pricer3d_"),
                os.path.basename(filename),
            )

        with open(model_saved_path, "wb") as f:
            f.write(bytes(file_content))

        # ── Apply manual orientation ──
        if any(v is not None for v in [orient_x, orient_y, orient_z]):
            _apply_manual_orientation(model_saved_path, orient_x, orient_y, orient_z)
            auto_orient = False  # don't double-orient

        # ── Geometry ──
        volume, surface_area, dimensions = calculate_geometry(model_saved_path)
        if volume == 0:
            return {
                "filename": filename,
                "status": "failed",
                "error": "无法读取或计算模型体积，可能文件已损坏",
                "_saved_path": model_saved_path,
            }

        # ── Printer dimension check ──
        printer_model_id = pricing_config.get("printer_model")
        _printer_bed = None
        _speed_params = speed_params_override or {}
        _printer_profile = printer_profile_path

        if printer_model_id and printer_bed_resolver:
            pm = printer_bed_resolver.get(printer_model_id)
            if pm:
                _printer_bed = {
                    "name": pm.get("name", ""),
                    "bed_width": float(pm.get("bed_width", 0)),
                    "bed_depth": float(pm.get("bed_depth", 0)),
                    "bed_height": float(pm.get("bed_height", 0)),
                }

        # If speed_params_override wasn't provided, check resolver for default
        if not speed_params_override and printer_model_id and printer_bed_resolver:
            pm = printer_bed_resolver.get(printer_model_id)
            if pm and pm.get("_speed_params"):
                _speed_params = pm["_speed_params"]

        # Dimension overflow check
        if _printer_bed and dimensions:
            dx = float(dimensions.get("x", 0))
            dy = float(dimensions.get("y", 0))
            dz = float(dimensions.get("z", 0))
            bw = _printer_bed["bed_width"]
            bd = _printer_bed["bed_depth"]
            bh = _printer_bed["bed_height"]
            if dx > bw or dy > bd or dz > bh:
                dimensions_str = f"{dx} × {dy} × {dz} mm"
                return {
                    "filename": filename,
                    "status": "failed",
                    "error": (
                        f"模型尺寸 ({dx}×{dy}×{dz}mm) 超出打印机 "
                        f"{_printer_bed['name']} 的打印范围 ({bw}×{bd}×{bh}mm)"
                    ),
                    "volume_cm3": round(volume / 1000, 2),
                    "surface_area_cm2": round(surface_area / 100, 2),
                    "dimensions": dimensions_str,
                    "weight_g": 0,
                    "estimated_time_h": 0,
                    "unit_time_h": 0,
                    "cost_cny": 0,
                    "unit_cost_cny": 0,
                    "quantity": quantity,
                    "color": color,
                    "material": material,
                    "_printer_model": pricing_config.get("printer_model"),
                    "_saved_path": model_saved_path,
                }

        # Inject speed params into pricing_config (for PrusaSlicer)
        if _speed_params:
            pricing_config["_printer_max_speed"] = _speed_params.get("max_speed", 500)
            pricing_config["_printer_max_acceleration"] = _speed_params.get("max_acceleration", 10000)
            pricing_config["_printer_jerk_limit"] = _speed_params.get("jerk_limit", 0.04)

        # ── Calculate cost ──
        unit_cost, model_weight_g, unit_print_time_h, total_cost, effective_weight_g, total_print_time_h, breakdown = calculate_cost(
            volume,
            surface_area,
            material,
            layer_height,
            infill,
            user_materials,
            pricing_config,
            quantity,
            model_path=model_saved_path,
            slicer_preset=slicer_preset,
            perimeters=perimeters,
            current_user=current_user,
            auto_orient=auto_orient,
            model_dimensions=dimensions,
            _resolved_printer=_printer_bed,
            _speed_params=_speed_params,
            _printer_profile_path=_printer_profile,
        )

        # ── Build result ──
        total_weight = round(model_weight_g * quantity, 2)
        try:
            filament_g = None
            if isinstance(breakdown, dict):
                filament_g = breakdown.get("slicer_filament_g_per_part")
            if filament_g is not None:
                total_weight = round(float(filament_g) * quantity, 2)
        except Exception:
            pass

        dimensions_str = f"{dimensions['x']} × {dimensions['y']} × {dimensions['z']} mm"

        # Pull real values from G-code analysis
        actual_layer_height = layer_height
        actual_infill = infill
        gcode_summary = (breakdown or {}).get("gcode_summary", {})
        if gcode_summary and gcode_summary.get("core_params"):
            cp = gcode_summary["core_params"]
            try:
                gh = cp.get("layer_height")
                if gh is not None:
                    actual_layer_height = float(gh)
            except (ValueError, TypeError):
                pass
            try:
                gf = cp.get("fill_density")
                if gf is not None:
                    actual_infill = int(float(gf))
            except (ValueError, TypeError):
                pass

        return {
            "filename": filename,
            "status": "success",
            "volume_cm3": round(volume / 1000, 2),
            "surface_area_cm2": round(surface_area / 100, 2),
            "dimensions": dimensions_str,
            "weight_g": total_weight,
            "estimated_time_h": total_print_time_h,
            "unit_time_h": round(float((breakdown or {}).get("unit_time_h") or 0), 3),
            "cost_cny": total_cost,
            "unit_cost_cny": unit_cost,
            "quantity": quantity,
            "color": color,
            "material": material,
            "layer_height": actual_layer_height,
            "infill": actual_infill,
            "_slicer_preset_id": slicer_preset.get("id") if slicer_preset else None,
            "_printer_model": pricing_config.get("printer_model") if pricing_config else None,
            "_saved_path": model_saved_path,
            "cost_breakdown": breakdown,
            "effective_weight_g": round(effective_weight_g * quantity, 2),
            "_printer_speed_params": _speed_params if _speed_params else None,
        }

    except Exception as e:
        msg = str(e or "").strip()
        if len(msg) > 200:
            msg = msg[:200]
        return {
            "filename": filename,
            "status": "failed",
            "error": msg or "处理失败",
        }


def process_single_file_sync(
    file: UploadFile,
    material: str,
    layer_height: float,
    infill: int,
    quantity: int,
    color: str,
    user_materials: List[dict],
    pricing_config: dict,
    slicer_preset: Optional[dict] = None,
    perimeters: Optional[int] = None,
    current_user: Optional[dict] = None,
    auto_orient: bool = False,
    orient_x: Optional[float] = None,
    orient_y: Optional[float] = None,
    orient_z: Optional[float] = None,
):
    """Synchronous wrapper for process_single_file — used in thread pool."""
    import asyncio
    # This is a thin sync adapter. The actual deps are resolved upstream
    # in app/services/quote.py before calling.
    return asyncio.run(
        process_single_file(
            file, material, layer_height, infill, quantity, color,
            user_materials, pricing_config, slicer_preset, perimeters,
            current_user, auto_orient, orient_x, orient_y, orient_z,
        )
    )


# ═══════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════


def _apply_manual_orientation(path: str, orient_x, orient_y, orient_z):
    """Apply manual Euler-angle rotation to a mesh file in-place."""
    try:
        import trimesh as _tm
        mobj = _tm.load(path, force="mesh")
        if isinstance(mobj, _tm.Scene):
            mobj = _tm.util.concatenate(mobj.dump())
        if isinstance(mobj, _tm.Trimesh) and mobj.vertices.shape[0] > 0:
            rx = np.deg2rad(orient_x or 0)
            ry = np.deg2rad(orient_y or 0)
            rz = np.deg2rad(orient_z or 0)
            from scipy.spatial.transform import Rotation as _R
            r = _R.from_euler("xyz", [rx, ry, rz])
            Rmat = np.eye(4)
            Rmat[:3, :3] = r.as_matrix()
            mobj.apply_transform(Rmat)
            mobj.export(path)
    except Exception as e:
        logger.warning("应用朝向失败: %s", e)


def _sanitize_filename(stem: str, fallback: str = "model", max_len: int = 40) -> str:
    """Sanitize a filename stem (replaces unsafe chars)."""
    safe = re.sub(r'[^a-zA-Z0-9_\-.()\u4e00-\u9fff]', '_', stem)
    safe = safe[:max_len]
    return safe if safe.strip("._-") else fallback


def _date_folder_utc() -> str:
    """Return UTC date folder path: YYYY/MM/DD."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y/%m/%d")


import re
