"""Material, color, and printer parameter resolution for ZIP quotes."""

import json
import logging
import re
from typing import Optional

from fastapi import HTTPException

from app.config import DEFAULT_COLORS, DEFAULT_MATERIALS
from app.db import get_db_session
from app.material_resolver import merge_user_material_with_catalog
from app.models_orm import User
from app.printers import PRINTER_MODELS, resolve_printer

logger = logging.getLogger(__name__)

_COLOR_NAME_TO_HEX = {
    item["name"].strip(): item["hex"].strip()
    for item in DEFAULT_COLORS
    if isinstance(item, dict) and item.get("name") and item.get("hex")
}
_COLOR_NAME_TO_HEX.update(
    {
        "White": "#ffffff",
        "Black": "#000000",
        "Gray": "#808080",
        "Grey": "#808080",
        "Red": "#dc2626",
        "Blue": "#2563eb",
        "Green": "#16a34a",
        "Yellow": "#ca8a04",
        "Orange": "#ea580c",
        "Purple": "#9333ea",
        "Pink": "#db2777",
    }
)


def match_selected_material(
    user_materials: list,
    material_name: str,
    brand: str = "",
    color: str = "",
) -> Optional[dict]:
    material_name = str(material_name or "").strip()
    brand = str(brand or "").strip()
    color = str(color or "").strip().lower()
    if not material_name:
        return None

    candidates = [
        material
        for material in user_materials
        if isinstance(material, dict)
        and str(material.get("name") or "").strip() == material_name
        and (not brand or str(material.get("brand") or "Generic").strip() == brand)
    ]
    if not candidates:
        return merge_user_material_with_catalog(None, material_name, brand, color)
    if color:
        for candidate in candidates:
            raw_color = candidate.get("color")
            values = []
            if isinstance(raw_color, dict):
                values.extend([raw_color.get("hex"), raw_color.get("name")])
            elif raw_color:
                values.append(raw_color)
            if any(str(value or "").strip().lower() == color for value in values):
                return merge_user_material_with_catalog(candidate, material_name, brand, color)
    return merge_user_material_with_catalog(candidates[0], material_name, brand, color)


def resolve_color_hex(color_str: str, fallback: str = "") -> str:
    """Convert a color name or hex to a valid printable color value."""
    value = str(color_str or "").strip()
    if not value:
        return fallback
    if re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return value
    exact = _COLOR_NAME_TO_HEX.get(value)
    if exact:
        return exact
    lowered = value.lower()
    for name, color_hex in _COLOR_NAME_TO_HEX.items():
        if name.lower() in lowered or lowered in name.lower():
            return color_hex
    return fallback or value


def color_tokens(value) -> set[str]:
    values = (value.get("name"), value.get("hex")) if isinstance(value, dict) else (value,)
    return {str(item or "").strip().lower() for item in values if str(item or "").strip()}


def parse_checklist_color_mapping(raw_mapping) -> dict[str, dict[str, str]]:
    if not raw_mapping:
        return {}
    try:
        parsed = json.loads(raw_mapping) if isinstance(raw_mapping, str) else raw_mapping
    except (TypeError, ValueError, json.JSONDecodeError):
        logger.warning("Ignoring invalid checklist color mapping payload")
        return {}
    if not isinstance(parsed, dict):
        return {}

    normalized = {}
    for source, target in parsed.items():
        source_key = str(source or "").strip().lower()
        if not source_key:
            continue
        if isinstance(target, dict):
            target_name = str(target.get("name") or target.get("hex") or "").strip()
            target_hex = str(target.get("hex") or "").strip()
        else:
            target_name = str(target or "").strip()
            target_hex = target_name if re.fullmatch(r"#[0-9a-fA-F]{6}", target_name) else ""
        if not target_name:
            continue
        resolved = resolve_color_hex(target_hex or target_name)
        if re.fullmatch(r"#[0-9a-fA-F]{6}", resolved or ""):
            target_hex = resolved.lower()
        elif target_hex:
            continue
        normalized[source_key] = {"name": target_name, "hex": target_hex}
    return normalized


def apply_checklist_color_mapping(checklist: Optional[list], raw_mapping) -> Optional[list]:
    if not checklist:
        return checklist
    mapping = parse_checklist_color_mapping(raw_mapping)
    required_colors = {
        str(item.get("color") or "").strip().lower()
        for item in checklist
        if isinstance(item, dict) and str(item.get("color") or "").strip()
    }
    missing_colors = sorted(color for color in required_colors if color not in mapping)
    if missing_colors:
        raise HTTPException(
            status_code=400,
            detail=(
                "Every checklist color must be manually mapped before slicing. "
                f"Missing: {', '.join(missing_colors)}"
            ),
        )

    mapped_checklist = []
    for item in checklist:
        if not isinstance(item, dict):
            mapped_checklist.append(item)
            continue
        source_color = str(item.get("color") or "").strip()
        target = mapping.get(source_color.lower())
        if not target:
            mapped_checklist.append(item)
            continue
        updated = dict(item)
        updated["_original_color"] = source_color
        updated["color"] = target["name"] or target["hex"]
        updated["_mapped_color"] = target
        mapped_checklist.append(updated)
    return mapped_checklist


def build_missing_checklist_materials(user_materials: list, checklist: Optional[list]) -> list:
    if not checklist:
        return []

    materials = [item for item in user_materials if isinstance(item, dict)]
    created = []
    for item in checklist:
        mapped_color = item.get("_mapped_color") if isinstance(item.get("_mapped_color"), dict) else {}
        color_name = str(mapped_color.get("name") or item.get("color") or "").strip()
        if not color_name:
            continue
        material_name = str(item.get("material_type") or "").strip() or "PLA"
        resolved_color = str(mapped_color.get("hex") or "").strip() or resolve_color_hex(color_name)
        color_hex = resolved_color if re.fullmatch(r"#[0-9a-fA-F]{6}", resolved_color or "") else ""
        wanted_tokens = color_tokens({"name": color_name, "hex": color_hex})

        exists = any(
            str(material.get("brand") or "Generic").strip().lower() == "generic"
            and str(material.get("name") or "").strip().lower() == material_name.lower()
            and bool(color_tokens(material.get("color")) & wanted_tokens)
            for material in [*materials, *created]
        )
        if exists:
            continue

        base = next(
            (
                material
                for material in materials
                if str(material.get("brand") or "Generic").strip().lower() == "generic"
                and str(material.get("name") or "").strip().lower() == material_name.lower()
            ),
            None,
        )
        if base is None:
            base = next(
                (
                    material
                    for material in materials
                    if str(material.get("name") or "").strip().lower() == material_name.lower()
                ),
                None,
            )
        if base is None:
            base = next(
                (
                    material
                    for material in DEFAULT_MATERIALS
                    if str(material.get("name") or "").strip().lower() == material_name.lower()
                ),
                None,
            )
        if base is None:
            base = next(
                (material for material in DEFAULT_MATERIALS if str(material.get("name") or "").upper() == "PLA"),
                {},
            )

        new_material = {key: value for key, value in dict(base).items() if key not in {"name", "brand", "color"}}
        new_material.update(
            {"name": material_name, "brand": "Generic", "color": {"name": color_name, "hex": color_hex}}
        )
        created.append(new_material)
    return created


def ensure_checklist_material_colors(
    user_id: int,
    user_materials: list,
    checklist: Optional[list],
    *,
    db_session_factory=None,
) -> list:
    created = build_missing_checklist_materials(user_materials, checklist)
    if not created:
        return []

    user_materials.extend(created)
    with (db_session_factory or get_db_session)() as db:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        user.materials = json.dumps(user_materials, ensure_ascii=False)
    logger.info(
        "ZIP material library updated: user_id=%s created=%s",
        user_id,
        [{"brand": item.get("brand"), "name": item.get("name"), "color": item.get("color")} for item in created],
    )
    return created


def resolved_nozzle(printer_id: Optional[str]) -> Optional[float]:
    if not printer_id:
        return None
    resolved = resolve_printer(str(printer_id))
    if not resolved or resolved.get("_nozzle") is None:
        return None
    return float(resolved["_nozzle"])


def lookup_printer(printer_name, nozzle_str, fallback_nozzle=None):
    if not printer_name or not str(printer_name).strip():
        return None
    name_lower = str(printer_name).strip().lower()
    for printer in PRINTER_MODELS:
        if printer.get("name", "").lower() != name_lower:
            continue
        printer_id = printer["id"]
        nozzle = fallback_nozzle
        if nozzle_str and str(nozzle_str).strip():
            try:
                nozzle = float(str(nozzle_str).strip())
            except (ValueError, TypeError):
                pass
        resolved = resolve_printer(printer_id, nozzle)
        return (resolved.get("_compound_id") if resolved else None) or printer_id
    return None


def resolve_checklist_printer(default_compound_id: Optional[str], printer_name: str = "", nozzle_str: str = "") -> Optional[str]:
    printer_name = str(printer_name or "").strip()
    nozzle_str = str(nozzle_str or "").strip()
    default_nozzle = resolved_nozzle(default_compound_id)

    if printer_name:
        return lookup_printer(printer_name, nozzle_str, default_nozzle) or default_compound_id
    if not nozzle_str or not default_compound_id:
        return default_compound_id

    try:
        requested_nozzle = float(nozzle_str)
    except (TypeError, ValueError):
        return default_compound_id
    default_printer = resolve_printer(default_compound_id)
    if not default_printer:
        return default_compound_id
    resolved = resolve_printer(default_printer["id"], requested_nozzle)
    return (resolved.get("_compound_id") if resolved else None) or default_compound_id
