"""
?????????????????????
"""

import sqlite3
from datetime import datetime, timezone

from .material_seed import DEFAULT_MATERIAL_BRANDS, DEFAULT_MATERIAL_TYPES


def migrate(db_path: str = "data/app.db"):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print("??????????????????...")

    # 1. ????????
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS printer_params (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            printer_id TEXT NOT NULL,
            nozzle REAL NOT NULL,
            max_speed REAL DEFAULT 500,
            max_acceleration REAL DEFAULT 10000,
            jerk_limit REAL DEFAULT 0.04,
            speed_enabled INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(printer_id, nozzle)
        )
    """)
    print("  ? ?? printer_params ?")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS material_brands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            logo_url TEXT,
            website TEXT,
            sort_order INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )
    """)
    print("  ? ?? material_brands ?")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS material_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            density REAL DEFAULT 1.24,
            description TEXT,
            sort_order INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )
    """)
    print("  ? ?? material_types ?")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_id INTEGER NOT NULL,
            type_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            color TEXT,
            density REAL,
            price_per_kg REAL,
            hotend_temp_min INTEGER,
            hotend_temp_max INTEGER,
            bed_temp_min INTEGER,
            bed_temp_max INTEGER,
            print_speed_max REAL,
            description TEXT,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (brand_id) REFERENCES material_brands(id),
            FOREIGN KEY (type_id) REFERENCES material_types(id),
            UNIQUE(brand_id, type_id, name)
        )
    """)
    print("  ? ?? materials ?")

    now = datetime.now(timezone.utc).isoformat()
    for brand in DEFAULT_MATERIAL_BRANDS:
        cursor.execute(
            "INSERT OR IGNORE INTO material_brands (name, website, sort_order, active, created_at) VALUES (?, ?, ?, 1, ?)",
            (brand["name"], brand.get("website"), brand.get("sort_order", 999), now),
        )
    print("  ? ????????")

    for mat_type in DEFAULT_MATERIAL_TYPES:
        cursor.execute(
            "INSERT OR IGNORE INTO material_types (name, display_name, density, description, sort_order, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
            (
                mat_type["name"],
                mat_type["display_name"],
                mat_type["density"],
                mat_type.get("description"),
                mat_type.get("sort_order", 999),
                now,
            ),
        )
    print("  ? ????????")

    printer_params = [
        ("bambu_a1_mini", 0.4, 500, 10000, 0.04),
        ("bambu_a1_mini", 0.2, 300, 10000, 0.04),
        ("bambu_a1_mini", 0.6, 500, 10000, 0.04),
        ("bambu_a1", 0.4, 500, 10000, 0.04),
        ("bambu_a1", 0.2, 300, 10000, 0.04),
        ("bambu_a1", 0.6, 500, 10000, 0.04),
        ("bambu_a1", 0.8, 400, 10000, 0.04),
        ("bambu_p1p", 0.4, 500, 20000, 0.06),
        ("bambu_p1p", 0.2, 300, 20000, 0.06),
        ("bambu_p1p", 0.6, 500, 20000, 0.06),
        ("bambu_p1p", 0.8, 400, 20000, 0.06),
        ("bambu_p1s", 0.4, 500, 20000, 0.06),
        ("bambu_p1s", 0.2, 300, 20000, 0.06),
        ("bambu_p1s", 0.6, 500, 20000, 0.06),
        ("bambu_p1s", 0.8, 400, 20000, 0.06),
        ("bambu_x1c", 0.4, 500, 20000, 0.06),
        ("bambu_x1c", 0.2, 300, 20000, 0.06),
        ("bambu_x1c", 0.6, 500, 20000, 0.06),
        ("bambu_x1c", 0.8, 400, 20000, 0.06),
        ("bambu_x1e", 0.4, 500, 20000, 0.06),
        ("bambu_x1e", 0.2, 300, 20000, 0.06),
        ("bambu_x1e", 0.6, 500, 20000, 0.06),
        ("bambu_x1e", 0.8, 400, 20000, 0.06),
        ("voron_v2_250", 0.4, 500, 20000, 0.08),
        ("prusa_mk4", 0.4, 500, 10000, 0.04),
    ]
    for pid, nozzle, speed, accel, jerk in printer_params:
        cursor.execute(
            "INSERT OR IGNORE INTO printer_params (printer_id, nozzle, max_speed, max_acceleration, jerk_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (pid, nozzle, speed, accel, jerk, now, now),
        )
    print("  ? ?????????")

    conn.commit()
    conn.close()
    print("?????")


if __name__ == "__main__":
    migrate()
