"""Material parameter resolution for quoting and slicing.

Resolves a selected material against the catalog tables first, then merges in
user material pricing/color data so slicing-critical fields come from the
canonical material database whenever possible.
"""

from __future__ import annotations

from typing import Optional

from .db import get_db_session
from .models_orm import Material, MaterialBrand, MaterialType


def _normalize_color_token(value: str) -> str:
    return str(value or "").strip().lower()


def _pick_catalog_match(candidates: list, color: str = ""):
    if not candidates:
        return None
    color_norm = _normalize_color_token(color)
    if color_norm:
        for item in candidates:
            if _normalize_color_token(getattr(item, "color", "")) == color_norm:
                return item
    return candidates[0]


def resolve_catalog_material_spec(material_name: str, brand: str = "", color: str = "") -> Optional[dict]:
    """Resolve canonical material slicing parameters from the material catalog."""
    material_name = str(material_name or "").strip()
    brand = str(brand or "").strip()
    if not material_name:
        return None

    with get_db_session() as db:
        query = (
            db.query(Material, MaterialBrand, MaterialType)
            .join(MaterialBrand, Material.brand_id == MaterialBrand.id)
            .join(MaterialType, Material.type_id == MaterialType.id)
            .filter(Material.active == 1)
            .filter(MaterialType.name == material_name)
        )
        if brand:
            query = query.filter(MaterialBrand.name == brand)
        rows = query.order_by(MaterialBrand.sort_order, Material.id).all()

        chosen = _pick_catalog_match([m for m, _b, _t in rows], color)
        if chosen is None and brand:
            fallback_rows = (
                db.query(Material, MaterialBrand, MaterialType)
                .join(MaterialBrand, Material.brand_id == MaterialBrand.id)
                .join(MaterialType, Material.type_id == MaterialType.id)
                .filter(Material.active == 1)
                .filter(MaterialType.name == material_name)
                .order_by(MaterialBrand.sort_order, Material.id)
                .all()
            )
            chosen = _pick_catalog_match([m for m, _b, _t in fallback_rows], color)

        if chosen is None:
            return None

        hotend_temp = chosen.hotend_temp_min or chosen.hotend_temp_max
        bed_temp = chosen.bed_temp_min or chosen.bed_temp_max
        return {
            "name": material_name,
            "brand": brand or "Generic",
            "density": chosen.density,
            "price_per_kg": chosen.price_per_kg,
            "hotend_temp": hotend_temp,
            "bed_temp": bed_temp,
            "max_volumetric_speed": chosen.max_volumetric_speed,
            "max_print_speed": chosen.print_speed_max,
            "color": color or chosen.color,
        }


def merge_user_material_with_catalog(
    user_material: Optional[dict],
    material_name: str,
    brand: str = "",
    color: str = "",
) -> Optional[dict]:
    """Merge user-selected material with canonical catalog values.

    User-configurable business fields such as price and color stay intact, while
    slicing-critical fields prefer the catalog.
    """
    catalog = resolve_catalog_material_spec(material_name, brand, color) or {}
    if user_material is None and not catalog:
        return None
    merged = dict(user_material or {})

    for key in ("name", "brand", "color"):
        if not merged.get(key) and catalog.get(key) is not None:
            merged[key] = catalog[key]

    if merged.get("density") in (None, "") and catalog.get("density") is not None:
        merged["density"] = catalog["density"]
    if merged.get("price_per_kg") in (None, "") and catalog.get("price_per_kg") is not None:
        merged["price_per_kg"] = catalog["price_per_kg"]

    for key in ("hotend_temp", "bed_temp", "max_volumetric_speed", "max_print_speed"):
        if catalog.get(key) is not None:
            merged[key] = catalog[key]

    return merged
