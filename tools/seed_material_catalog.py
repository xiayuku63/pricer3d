"""Seed the global material catalog from default seed data plus per-user JSON materials.

Usage:
  python tools/seed_material_catalog.py --db app.db
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.migration_printer_material import migrate  # noqa: E402
from app.material_seed import DEFAULT_MATERIALS  # noqa: E402


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_color_name(color):
    if isinstance(color, dict):
        return (color.get("name") or "").strip() or None
    if isinstance(color, str):
        c = color.strip()
        return c or None
    return None


def ensure_brand(conn: sqlite3.Connection, name: str) -> int:
    name = (name or "Generic").strip() or "Generic"
    row = conn.execute("SELECT id FROM material_brands WHERE name = ?", (name,)).fetchone()
    if row:
        return row[0]
    now = utcnow()
    conn.execute(
        "INSERT INTO material_brands (name, website, sort_order, active, created_at) VALUES (?, ?, ?, 1, ?)",
        (name, None, 999, now),
    )
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def ensure_type(conn: sqlite3.Connection, name: str, density: float | None) -> int:
    key = (name or "PLA").strip() or "PLA"
    row = conn.execute("SELECT id FROM material_types WHERE name = ?", (key,)).fetchone()
    if row:
        return row[0]
    now = utcnow()
    conn.execute(
        "INSERT INTO material_types (name, display_name, density, description, sort_order, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
        (key, key, float(density or 1.24), None, 999, now),
    )
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def upsert_material(conn: sqlite3.Connection, brand_id: int, type_id: int, item: dict) -> None:
    now = utcnow()
    material_name = (item.get("name") or "").strip()
    if not material_name:
        return
    density = item.get("density")
    price_per_kg = item.get("price_per_kg")
    colors = item.get("colors") or []
    first_color = None
    for c in colors:
        first_color = normalize_color_name(c)
        if first_color:
            break

    existing = conn.execute(
        "SELECT id FROM materials WHERE brand_id = ? AND type_id = ? AND name = ? LIMIT 1",
        (brand_id, type_id, material_name),
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE materials SET color = COALESCE(?, color), density = ?, price_per_kg = ?, updated_at = ?, active = 1 WHERE id = ?",
            (first_color, density, price_per_kg, now, existing[0]),
        )
    else:
        conn.execute(
            """INSERT INTO materials (
                brand_id, type_id, name, color, density, price_per_kg,
                hotend_temp_min, hotend_temp_max, bed_temp_min, bed_temp_max,
                print_speed_max, description, active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            (
                brand_id,
                type_id,
                material_name,
                first_color,
                density,
                price_per_kg,
                None,
                None,
                None,
                None,
                None,
                None,
                now,
                now,
            ),
        )


def seed_from_default_materials(conn: sqlite3.Connection) -> int:
    count = 0
    for item in DEFAULT_MATERIALS:
        brand_id = ensure_brand(conn, item.get("brand") or "Generic")
        type_id = ensure_type(conn, item.get("name") or "PLA", item.get("density"))
        before = conn.execute("SELECT COUNT(*) FROM materials").fetchone()[0]
        upsert_material(conn, brand_id, type_id, item)
        after = conn.execute("SELECT COUNT(*) FROM materials").fetchone()[0]
        count += max(0, after - before)
    return count


def normalize_active_flags(conn: sqlite3.Connection) -> None:
    for table in ("material_brands", "material_types", "materials"):
        conn.execute(f"UPDATE {table} SET active = 1 WHERE active IS NULL")


def seed_from_user_materials(conn: sqlite3.Connection) -> int:
    count = 0
    users = conn.execute(
        'SELECT username, materials FROM users WHERE materials IS NOT NULL AND materials != ""'
    ).fetchall()
    for username, materials_json in users:
        try:
            materials = json.loads(materials_json)
        except Exception:
            continue
        if not isinstance(materials, list):
            continue
        for item in materials:
            if not isinstance(item, dict):
                continue
            brand_id = ensure_brand(conn, item.get("brand") or "Generic")
            type_id = ensure_type(conn, item.get("name") or "PLA", item.get("density"))
            before = conn.execute("SELECT COUNT(*) FROM materials").fetchone()[0]
            upsert_material(conn, brand_id, type_id, item)
            after = conn.execute("SELECT COUNT(*) FROM materials").fetchone()[0]
            count += max(0, after - before)
    return count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    args = parser.parse_args()

    db_path = args.db
    migrate(db_path)
    conn = sqlite3.connect(db_path)
    try:
        inserted = seed_from_default_materials(conn)
        inserted += seed_from_user_materials(conn)
        normalize_active_flags(conn)
        conn.commit()
        print(
            {
                "material_brands": conn.execute("SELECT COUNT(*) FROM material_brands").fetchone()[0],
                "material_types": conn.execute("SELECT COUNT(*) FROM material_types").fetchone()[0],
                "materials": conn.execute("SELECT COUNT(*) FROM materials").fetchone()[0],
                "inserted_material_rows": inserted,
            }
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
