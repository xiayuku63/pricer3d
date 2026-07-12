"""
G-code analysis utilities.

Extracted from calculator/cost.py to keep cost module focused on pricing logic.
"""

import os
import json
import importlib.util
import logging

logger = logging.getLogger(__name__)


def analyze_gcode_output(output_gcode: str) -> dict | None:
    """Analyze a G-code file and return a summary dict with layer info, filament usage, and time.

    Returns None if analysis fails or the file doesn't exist.
    """
    if not output_gcode or not os.path.exists(output_gcode):
        return None

    try:
        _ga_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tools", "gcode_analyzer.py")
        _ga_spec = importlib.util.spec_from_file_location("gcode_analyzer", _ga_path)
        _ga = importlib.util.module_from_spec(_ga_spec)
        _ga_spec.loader.exec_module(_ga)
        parsed = _ga.parse_gcode(output_gcode)
        logger.info(f"Gcode analysis parsed: layers={parsed.get('layer_count')}, error={parsed.get('error', 'none')}")
        if "error" in parsed:
            return None

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
                val = val[: -len(suffix)]
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
        return gcode_summary
    except Exception as e:
        logger.warning(f"G-code analysis skipped: {e}")
        return None
