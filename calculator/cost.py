import os
import json
import ast
import math
import re
import time
import tempfile
import uuid
import hashlib
import logging
from typing import List, Optional
from fastapi import UploadFile, Request

from parser.prusa_slicer import run_prusa_slice

logger = logging.getLogger(__name__)

def calculate_weight(volume, material_density):
    """Calculate weight (unit: g)"""
    return volume * material_density / 1000  # mm³ -> cm³ -> g

def merge_pricing_config(raw_config):
    from app.config import DEFAULT_PRICING_CONFIG
    if not raw_config:
        return dict(DEFAULT_PRICING_CONFIG)
    merged = dict(DEFAULT_PRICING_CONFIG)
    for k, v in raw_config.items():
        merged[k] = v
    return merged


def estimate_print_time_hours(volume_mm3, surface_area_mm2, layer_height_mm, infill_percent, pricing_config):
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
    total_min = overhead_min + (vol_cm3 * vol_min_per_cm3 * layer_factor * infill_factor) + (area_cm2 * area_min_per_cm2)
    return max(0.0, total_min / 60.0)

def safe_eval_formula(expr: str, variables: dict) -> Optional[float]:
    if not expr:
        return None
    if len(expr) > 800:
        return None
    allowed_funcs = {"max": max, "min": min, "abs": abs, "round": round}
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        return None

    allowed_nodes = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Call,
        ast.Name,
        ast.Load,
        ast.Constant,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.Pow,
        ast.Mod,
        ast.UAdd,
        ast.USub,
    )

    for node in ast.walk(tree):
        if not isinstance(node, allowed_nodes):
            return None
        if isinstance(node, ast.Name):
            if node.id not in variables and node.id not in allowed_funcs:
                return None
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                return None
            if node.func.id not in allowed_funcs:
                return None
            if node.keywords:
                return None

    try:
        compiled = compile(tree, "<formula>", "eval")
        result = eval(compiled, {"__builtins__": {}, **allowed_funcs}, dict(variables))
    except Exception:
        return None
    if isinstance(result, bool):
        return None
    if isinstance(result, (int, float)):
        if not math.isfinite(float(result)):
            return None
        return float(result)
    return None

FORMULA_ALIAS_TO_CANONICAL = {
    "有效重量_g": "effective_weight_g",
    "材料单价_元每kg": "price_per_kg",
    "单件时间_h": "unit_time_h",
    "机台费_元每小时": "machine_hourly_rate_cny",
    "后处理费_元每件": "post_process_fee_per_part_cny",
    "数量": "quantity",
    "上机费": "setup_fee_cny",
    "最低起步价": "min_job_fee_cny",
    "单件成本": "unit_cost_cny",
    "小计": "subtotal_cny",
    "难度系数": "difficulty_coefficient",
    "表面积体积比": "surface_area_to_volume_ratio",
    "难度得分": "difficulty_score",
    "难度倍率": "difficulty_multiplier",
    "难度加价百分比": "difficulty_markup_percent",
    "支撑重量_g": "support_weight_g",
    "支撑单价_元每g": "support_price_per_g",
    "支撑费_元每件": "support_cost_per_part_cny",
}

FORMULA_CANONICAL_VARS = {
    "effective_weight_g",
    "model_weight_g",
    "price_per_kg",
    "density",
    "unit_time_h",
    "machine_hourly_rate_cny",
    "post_process_fee_per_part_cny",
    "difficulty_coefficient",
    "surface_area_to_volume_ratio",
    "difficulty_score",
    "difficulty_multiplier",
    "difficulty_markup_percent",
    "support_weight_g",
    "support_price_per_g",
    "support_cost_per_part_cny",
    "quantity",
    "setup_fee_cny",
    "min_job_fee_cny",
    "material_waste_percent",
    "support_percent_of_model",
    "material_cost_cny",
    "machine_cost_cny",
    "volume_mm3",
    "surface_area_mm2",
    "volume_cm3",
    "surface_area_cm2",
    "unit_cost_cny",
    "subtotal_cny",
}

def with_formula_aliases(variables: dict) -> dict:
    out = dict(variables)
    for alias, canonical in FORMULA_ALIAS_TO_CANONICAL.items():
        if canonical in out and alias not in out:
            out[alias] = out[canonical]
    return out

def validate_formula_expression(expr: str) -> tuple[bool, str, list[str]]:
    if not expr:
        return False, "公式不能为空", []
    if len(expr) > 800:
        return False, "公式过长", []

    allowed_funcs = {"max", "min", "abs", "round"}
    allowed_vars = set(FORMULA_CANONICAL_VARS) | set(FORMULA_ALIAS_TO_CANONICAL.keys())
    used_vars: set[str] = set()

    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        return False, "公式语法错误", []

    allowed_nodes = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Call,
        ast.Name,
        ast.Load,
        ast.Constant,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.Pow,
        ast.Mod,
        ast.UAdd,
        ast.USub,
    )

    for node in ast.walk(tree):
        if not isinstance(node, allowed_nodes):
            return False, "包含不支持的语法", []
        if isinstance(node, ast.Name):
            if node.id in allowed_funcs:
                continue
            if node.id not in allowed_vars:
                return False, f"未知变量：{node.id}", []
            used_vars.add(node.id)
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                return False, "仅支持调用 max/min/abs/round", []
            if node.func.id not in allowed_funcs:
                return False, f"不支持的函数：{node.func.id}", []
            if node.keywords:
                return False, "不支持关键字参数", []

    return True, "", sorted(used_vars)


def calculate_cost(
    volume_mm3,
    surface_area_mm2,
    material,
    layer_height_mm,
    infill_percent,
    user_materials,
    pricing_config,
    quantity,
    model_path: Optional[str] = None,
    slicer_preset: Optional[dict] = None,
    perimeters: Optional[int] = None,
    current_user: Optional[dict] = None,
    auto_orient: bool = False,
    top_shell_layers: Optional[int] = None,
    bottom_shell_layers: Optional[int] = None,
    model_dimensions: Optional[dict] = None,
):
    from app.utils import normalize_materials, _sanitize_filename_component, _user_base_dir, _date_folder_utc
    from app.config import DEFAULT_MATERIALS
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

    volume_cm3 = float(volume_mm3) / 1000.0
    surface_area_cm2 = float(surface_area_mm2) / 100.0
    surface_area_to_volume_ratio = 0.0
    if volume_cm3 > 0:
        surface_area_to_volume_ratio = surface_area_cm2 / max(volume_cm3, 1e-9)
    ratio_low = float(cfg.get("difficulty_ratio_low") or 0.0)
    ratio_high = float(cfg.get("difficulty_ratio_high") or 0.0)
    difficulty_score = 0.0
    if ratio_high > ratio_low:
        difficulty_score = (surface_area_to_volume_ratio - ratio_low) / (ratio_high - ratio_low)
    difficulty_score = max(0.0, min(1.0, float(difficulty_score)))
    difficulty_coefficient = float(cfg.get("difficulty_coefficient") or 0.0)
    if difficulty_coefficient < 0:
        difficulty_coefficient = 0.0
    if difficulty_coefficient > 3:
        difficulty_coefficient = 3.0
    difficulty_multiplier = 1.0 + (difficulty_coefficient * difficulty_score)
    difficulty_markup_percent = max(0.0, (difficulty_multiplier - 1.0) * 100.0)

    # ── 自动朝向优化 (Lay on Face) ──
    orientation_info: dict = {}
    _oriented_tmp_path: Optional[str] = None
    if auto_orient and model_path and os.path.exists(model_path):
        try:
            from calculator.orientation import get_best_face_for_slicing
            orient_result = get_best_face_for_slicing(model_path)
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
                    "selected_face_area": orient_result.get("face", {}).get("area") if orient_result.get("face") else None,
                    "tune_report": orient_result.get("tune_report"),
                }
                model_path = oriented_path
        except Exception as e:
            logger.warning("自动朝向优化失败，使用原始朝向: %s", e)

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
    output_gcode = None  # for gcode analysis later

    # ---- PrusaSlicer (preferred: no display needed) ----
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

            # Load printer profile for slicing
            _printer_profile = None
            rp = None
            printer_id = cfg.get("printer_model", "") or ""
            if printer_id:
                from app.printers import resolve_printer
                rp = resolve_printer(printer_id)
                if rp:
                    _printer_profile = os.path.join(os.path.dirname(os.path.dirname(__file__)), rp["profile"])

            # Pre-check: model height vs printer max_print_height
            _printer_max_z = None
            _printer_name = None
            if rp:
                _printer_max_z = float(rp.get("bed_height", 0))
                _printer_name = str(rp.get("name", ""))
            if not _printer_max_z or _printer_max_z <= 0:
                _printer_max_z = 256.0  # system default
                _printer_name = _printer_name or "系统默认"
            if model_dimensions:
                model_z = float(model_dimensions.get("z", 0))
                if model_z > _printer_max_z > 0:
                    slicer_error_msg = "模型尺寸超出打印机最大打印面积，请更换打印机或拆分模型"
                    logger.warning(f"PrusaSlicer skipped: model_z={model_z:.1f} > printer_max_z={_printer_max_z:.0f} ({_printer_name})")
                    raise RuntimeError(slicer_error_msg)
            base_name = os.path.splitext(os.path.basename(model_path))[0]
            output_prefix = _sanitize_filename_component(base_name, fallback="model", max_len=40)
            user_folder = f"user_{current_user['id']}_{current_user['username']}" if current_user else "anonymous"
            outputs_job_dir = os.path.join(_user_base_dir(), user_folder, "outputs", _date_folder_utc(), output_prefix)
            os.makedirs(outputs_job_dir, exist_ok=True)

            output_gcode = os.path.join(outputs_job_dir, f"{output_prefix}.gcode")
            # Always single slice with supports — no diff mode (too slow, 2x slicing)
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
            )
            if stats.get("time_s", 0) > 0:
                correction = float(cfg.get("prusa_time_correction") or 1.0)
                if correction <= 0 or correction > 5:
                    correction = 1.0
                slicer_time_s = max(1, int(stats["time_s"] * correction))
                logger.info(f"PrusaSlicer raw={stats['time_s']}s × corr={correction} = {slicer_time_s}s")
            if stats.get("filament_g", 0) > 0:
                slicer_filament_g_per_part = stats["filament_g"]
            elif stats.get("filament_cm3", 0) > 0:
                filament_cm3 = stats["filament_cm3"]
                slicer_filament_g_per_part = filament_cm3 * spec["density"]
            if not preset_used and stats.get("preset_used"):
                preset_used = str(stats["preset_used"])
        except Exception as e:
            logger.error(f"PrusaSlicer failed for {model_path}: {e}")
            slicer_time_s = None
            slicer_filament_g_per_part = None
            slicer_error_msg = f"PrusaSlicer: {e}"
            # Clean up 3MF temp STL
            if _tmp_3mf_stl and os.path.exists(_tmp_3mf_stl):
                try: os.unlink(_tmp_3mf_stl)
                except OSError: pass

    if slicer_filament_g_per_part is not None and slicer_filament_g_per_part > 0:
        support_percent = 0.0
        effective_weight_g = float(slicer_filament_g_per_part) * (1.0 + max(0.0, waste_percent) / 100.0)
        material_cost = effective_weight_g * (float(spec.get("price_per_kg") or 0.0) / 1000.0)
    if slicer_time_s is not None and slicer_time_s > 0:
        unit_time_h = float(slicer_time_s) / 3600.0
        machine_cost = unit_time_h * machine_hourly_rate
        base_unit_cost = material_cost + machine_cost + post_per_part

    support_price_per_g = float(cfg.get("support_price_per_g") or 0.0)
    if support_price_per_g < 0:
        support_price_per_g = 0.0
    if support_price_per_g > 1000:
        support_price_per_g = 1000.0
    support_cost_per_part_cny = float(support_weight_g_per_part) * float(support_price_per_g)

    variables = {
        "effective_weight_g": float(effective_weight_g),
        "model_weight_g": float(model_weight_g),
        "price_per_kg": float(spec.get("price_per_kg") or 0.0),
        "density": float(spec.get("density") or 1.0),
        "unit_time_h": float(unit_time_h),
        "machine_hourly_rate_cny": float(machine_hourly_rate),
        "post_process_fee_per_part_cny": float(post_per_part),
        "difficulty_coefficient": float(difficulty_coefficient),
        "surface_area_to_volume_ratio": float(surface_area_to_volume_ratio),
        "difficulty_score": float(difficulty_score),
        "difficulty_multiplier": float(difficulty_multiplier),
        "difficulty_markup_percent": float(difficulty_markup_percent),
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
        "volume_cm3": float(volume_cm3),
        "surface_area_cm2": float(surface_area_cm2),
    }

    unit_formula = str(cfg.get("unit_cost_formula") or DEFAULT_UNIT_COST_FORMULA).strip()
    total_formula = str(cfg.get("total_cost_formula") or DEFAULT_TOTAL_COST_FORMULA).strip()

    unit_cost = safe_eval_formula(unit_formula, variables)
    if unit_cost is None or unit_cost < 0:
        unit_cost = (base_unit_cost * float(difficulty_multiplier)) + float(support_cost_per_part_cny)

    unit_cost_before_difficulty = float(base_unit_cost)

    subtotal = (unit_cost * quantity) + setup_fee
    variables["unit_cost_cny"] = float(unit_cost)
    variables["subtotal_cny"] = float(subtotal)
    variables = with_formula_aliases(variables)

    total = safe_eval_formula(total_formula, variables)
    if total is None or total < 0:
        total = max(subtotal, min_job_fee)
    total_time_h = unit_time_h * quantity

    breakdown = {
        "material_cost_cny": round(material_cost, 2),
        "machine_cost_cny": round(machine_cost, 2),
        "post_process_cost_per_part_cny": round(post_per_part, 2),
        "difficulty_surface_area_to_volume_ratio": round(surface_area_to_volume_ratio, 6),
        "difficulty_score": round(difficulty_score, 4),
        "difficulty_coefficient": round(difficulty_coefficient, 4),
        "difficulty_multiplier": round(difficulty_multiplier, 6),
        "difficulty_markup_percent": round(max(0.0, (difficulty_multiplier - 1.0) * 100.0), 2),
        "unit_cost_before_difficulty_cny": round(unit_cost_before_difficulty, 2),
        "support_weight_g_per_part": round(support_weight_g_per_part, 3),
        "support_price_per_g": round(support_price_per_g, 4),
        "support_cost_per_part_cny": round(support_cost_per_part_cny, 2),
        "prusaslicer_used": bool(prusaslicer_used and slicer_time_s is not None),
        "slicer_used": "prusaslicer" if (prusaslicer_used and slicer_time_s is not None) else None,
        "slicer_error": slicer_error_msg,
        "slicer_filament_g_per_part": round(float(slicer_filament_g_per_part), 3) if slicer_filament_g_per_part is not None else None,
        "slicer_preset_used": preset_used,
        "slicer_estimated_time_s": int(slicer_time_s) if slicer_time_s is not None else None,
        "prusa_time_correction": float(cfg.get("prusa_time_correction") or 1.0),
        "setup_fee_cny": round(setup_fee, 2),
        "min_job_fee_cny": round(min_job_fee, 2),
        "subtotal_cny": round(subtotal, 2),
        "unit_cost_formula": unit_formula,
        "total_cost_formula": total_formula,
        **({k: v for k, v in orientation_info.items()} if orientation_info else {}),
    }

    # ── G-code 分析（切片完成后自动解析）──
    gcode_summary = None
    logger.info(f"Gcode analysis check: prusaslicer_used={prusaslicer_used}, output_gcode={output_gcode}, exists={os.path.exists(output_gcode) if output_gcode else 'N/A'}")
    if prusaslicer_used and output_gcode and os.path.exists(output_gcode):
        try:
            import importlib.util
            _ga_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tools", "gcode_analyzer.py")
            _ga_spec = importlib.util.spec_from_file_location("gcode_analyzer", _ga_path)
            _ga = importlib.util.module_from_spec(_ga_spec)
            _ga_spec.loader.exec_module(_ga)
            parsed = _ga.parse_gcode(output_gcode)
            logger.info(f"Gcode analysis parsed: layers={parsed.get('layer_count')}, error={parsed.get('error', 'none')}")
            if "error" not in parsed:
                settings = parsed.get("settings", {})
                fil = parsed.get("filament", {})
                t = parsed.get("time", {})

                # ── 核心切片参数（用户最关心的）──
                def _gs(keys):
                    for k in keys:
                        v = settings.get(k)
                        if v is not None:
                            return v
                    return None

                def _gs_strip(keys, suffix):
                    """Get setting and strip trailing suffix (e.g. '%' from fill_density)."""
                    val = _gs(keys)
                    if val is not None and isinstance(val, str) and val.endswith(suffix):
                        val = val[:-len(suffix)]
                    return val

                core_params = {
                    "layer_height": _gs(["layer_height"]),
                    "first_layer_height": _gs(["first_layer_height"]),
                    "nozzle_diameter": _gs(["nozzle_diameter"]),
                    "perimeters": _gs(["perimeters", "wall_loops"]),
                    "fill_density": _gs_strip(["fill_density"], "%"),
                    "top_shell_layers": _gs(["top_shell_layers", "top_solid_layers"]),
                    "bottom_shell_layers": _gs(["bottom_shell_layers", "bottom_solid_layers"]),
                    "brim_width": _gs(["brim_width"]),
                    "support_material": _gs(["support_material"]),
                }

                # 层高分布（Top 3）
                heights = parsed.get("heights", {})
                top_heights = sorted(heights.items(), key=lambda x: -x[1])[:3]
                height_bars = [{"height": float(h), "count": c} for h, c in top_heights]

                gcode_summary = {
                    "layer_count": parsed.get("layer_count", 0),
                    "core_params": core_params,
                    "heights": height_bars,
                    "filament_mm": round(fil.get("filament_mm", 0), 2) if fil.get("filament_mm") else None,
                    "filament_cm3": round(fil.get("filament_cm3", 0), 2) if fil.get("filament_cm3") else None,
                    "filament_g": round(fil.get("filament_g", 0), 2) if fil.get("filament_g") else None,
                    "time_display": t.get("display"),
                }
                logger.info(f"Gcode summary built: {json.dumps(gcode_summary, default=str)[:200]}")
        except Exception as e:
            logger.warning(f"G-code analysis skipped: {e}")

    # Cleanup temp oriented model
    if _oriented_tmp_path and os.path.exists(_oriented_tmp_path):
        try:
            os.unlink(_oriented_tmp_path)
        except OSError:
            pass

    if gcode_summary:
        breakdown["gcode_summary"] = gcode_summary

    return round(unit_cost, 2), round(model_weight_g, 2), round(unit_time_h, 3), round(total, 2), round(effective_weight_g, 2), round(total_time_h, 3), breakdown


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
):
    from app.config import SUPPORTED_EXTENSIONS, MAX_FILE_SIZE_BYTES
    from app.utils import _sanitize_filename_component, _user_base_dir, _date_folder_utc
    from parser.geometry import calculate_geometry

    filename = file.filename or "unnamed_file"
    _, ext = os.path.splitext(filename.lower())
    if ext not in SUPPORTED_EXTENSIONS:
        return {
            "filename": filename,
            "status": "failed",
            "error": f"不支持的文件格式: {ext}。支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        }

    file_content = await file.read()
    if len(file_content) >= MAX_FILE_SIZE_BYTES:
        return {
            "filename": filename,
            "status": "failed",
            "error": "文件大小必须小于 100MB"
        }

    try:
        safe_original = os.path.basename(filename)
        original_stem = os.path.splitext(safe_original)[0]
        safe_stem = _sanitize_filename_component(original_stem, fallback="model", max_len=40)
        job_id = uuid.uuid4().hex[:8]

        user_folder = f"user_{current_user['id']}_{current_user['username']}" if current_user else "anonymous"
        uploads_day_dir = os.path.join(_user_base_dir(), user_folder, "uploads", _date_folder_utc(), f"{job_id}_{safe_stem}")
        os.makedirs(uploads_day_dir, exist_ok=True)
        
        saved_name = f"{job_id}_{safe_stem}{ext}"
        model_saved_path = os.path.join(uploads_day_dir, saved_name)
        with open(model_saved_path, "wb") as f:
            f.write(bytes(file_content))

        volume, surface_area, dimensions = calculate_geometry(model_saved_path)
        if volume == 0:
            return {
                "filename": filename,
                "status": "failed",
                "error": "无法读取或计算模型体积，可能文件已损坏 (Failed to calculate volume)",
                "_saved_path": model_saved_path,
            }

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
        )
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

        # When a user preset was active, the form's layer_height/infill may differ from
        # what PrusaSlicer actually used. Pull the real values from G-code analysis.
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
            "surface_area_to_volume_ratio": round(float((breakdown or {}).get("difficulty_surface_area_to_volume_ratio") or 0.0), 6),
            "difficulty_score": round(float((breakdown or {}).get("difficulty_score") or 0.0), 4),
            "difficulty_multiplier": round(float((breakdown or {}).get("difficulty_multiplier") or 1.0), 6),
            "difficulty_markup_percent": round(float((breakdown or {}).get("difficulty_markup_percent") or 0.0), 2),
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
            "effective_weight_g": round(effective_weight_g * quantity, 2)
        }
    except Exception as e:
        msg = str(e or "").strip()
        if len(msg) > 200:
            msg = msg[:200]
        return {
            "filename": filename,
            "status": "failed",
            "error": msg or "处理失败"
        }
