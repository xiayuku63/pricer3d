"""
Formula evaluation utilities for Pricer3D.

Pure functions — no dependencies on app.* or calculator.*
"""

import ast
import math
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── Formula variable definitions ──

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
    "unit_cost_cny",
    "subtotal_cny",
}

# ── Default formula strings ──

DEFAULT_UNIT_COST_FORMULA = (
    "material_cost_cny + machine_cost_cny"
    " + post_process_fee_per_part_cny"
    " + support_cost_per_part_cny"
)
DEFAULT_TOTAL_COST_FORMULA = "max(subtotal_cny, min_job_fee_cny)"


def safe_eval_formula(expr: str, variables: dict) -> Optional[float]:
    """Safely evaluate a mathematical formula expression.

    Restricted to basic arithmetic + allowed functions (max/min/abs/round).
    Variables are provided via the ``variables`` dict.
    Returns None on any error.
    """
    if not expr:
        return None
    if len(expr) > 800:
        return None

    allowed_funcs_dict = {"max": max, "min": min, "abs": abs, "round": round}

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
            if node.id not in variables and node.id not in allowed_funcs_dict:
                return None
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                return None
            if node.func.id not in allowed_funcs_dict:
                return None
            if node.keywords:
                return None

    try:
        compiled = compile(tree, "<formula>", "eval")
        result = eval(compiled, {"__builtins__": {}, **allowed_funcs_dict}, dict(variables))
    except Exception:
        return None
    if isinstance(result, bool):
        return None
    if isinstance(result, (int, float)):
        if not math.isfinite(float(result)):
            return None
        return float(result)
    return None


def with_formula_aliases(variables: dict) -> dict:
    """Add Chinese-alias keys for backward compatibility."""
    out = dict(variables)
    for alias, canonical in FORMULA_ALIAS_TO_CANONICAL.items():
        if canonical in out and alias not in out:
            out[alias] = out[canonical]
    return out


def validate_formula_expression(expr: str) -> tuple[bool, str, list[str]]:
    """Validate a formula expression, returning (ok, error_msg, used_vars)."""
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
