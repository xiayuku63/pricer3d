"""Expand user materials/colors using the latest defaults without overwriting custom pricing."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.material_seed import DEFAULT_COLOR_PALETTE, DEFAULT_MATERIALS  # noqa: E402


def _color_key(color) -> tuple[str, str]:
    if isinstance(color, dict):
        return ((color.get("name") or "").strip().lower(), (color.get("hex") or "").strip().lower())
    raw = str(color or "").strip().lower()
    return (raw, "")


def merge_colors(existing, default_colors):
    merged = []
    seen = set()
    for source in (existing or [], default_colors or []):
        for color in source:
            key = _color_key(color)
            if key in seen:
                continue
            seen.add(key)
            merged.append(color)
    return merged


def merge_material(existing: dict, default: dict) -> dict:
    merged = dict(existing)
    merged["name"] = existing.get("name") or default.get("name")
    merged["brand"] = existing.get("brand") or default.get("brand")
    merged["density"] = existing.get("density") if existing.get("density") not in (None, "") else default.get("density")
    merged["price_per_kg"] = (
        existing.get("price_per_kg") if existing.get("price_per_kg") not in (None, "") else default.get("price_per_kg")
    )
    merged["hotend_temp"] = (
        existing.get("hotend_temp") if existing.get("hotend_temp") not in (None, "") else default.get("hotend_temp")
    )
    merged["bed_temp"] = (
        existing.get("bed_temp") if existing.get("bed_temp") not in (None, "") else default.get("bed_temp")
    )
    merged["colors"] = merge_colors(existing.get("colors"), default.get("colors"))
    return merged


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    args = parser.parse_args()

    default_map = {str(item.get("name")).strip().lower(): item for item in DEFAULT_MATERIALS}
    conn = sqlite3.connect(args.db)
    rows = conn.execute(
        "SELECT id, materials, colors, default_material, default_brand, default_color FROM users"
    ).fetchall()
    updated = 0
    for user_id, materials_json, colors_json, default_material, default_brand, default_color in rows:
        try:
            materials = json.loads(materials_json) if materials_json else []
        except Exception:
            materials = []
        if not isinstance(materials, list):
            materials = []

        merged_by_name = {}
        order = []
        for item in materials:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            key = name.lower()
            merged_by_name[key] = item
            order.append(key)

        for key, default_item in default_map.items():
            existing = merged_by_name.get(key)
            if existing:
                merged_by_name[key] = merge_material(existing, default_item)
            else:
                merged_by_name[key] = json.loads(json.dumps(default_item, ensure_ascii=False))
                order.append(key)

        merged_materials = [merged_by_name[key] for key in order if key in merged_by_name]
        merged_colors = merge_colors(json.loads(colors_json) if colors_json else [], DEFAULT_COLOR_PALETTE)
        next_default_material = default_material or (merged_materials[0]["name"] if merged_materials else None)
        next_default_brand = default_brand or (merged_materials[0].get("brand") if merged_materials else None)
        next_default_color = default_color
        if not next_default_color and merged_colors:
            first = merged_colors[0]
            next_default_color = first.get("hex") if isinstance(first, dict) else str(first)

        conn.execute(
            "UPDATE users SET materials = ?, colors = ?, default_material = ?, default_brand = ?, default_color = ? WHERE id = ?",
            (
                json.dumps(merged_materials, ensure_ascii=False),
                json.dumps(merged_colors, ensure_ascii=False),
                next_default_material,
                next_default_brand,
                next_default_color,
                user_id,
            ),
        )
        updated += 1

    conn.commit()
    conn.close()
    print(
        {
            "updated_users": updated,
            "default_material_count": len(DEFAULT_MATERIALS),
            "default_color_count": len(DEFAULT_COLOR_PALETTE),
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
