"""
数据库迁移：添加打印机高级参数和材料分类表
"""

import sqlite3
import json
from datetime import datetime, timezone


def migrate(db_path: str = "data/app.db"):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("开始迁移：添加打印机参数和材料分类表...")
    
    # 1. 创建打印机参数表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS printer_params (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            printer_id TEXT NOT NULL,  -- 对应 printers.py 中的 id
            nozzle REAL NOT NULL,
            max_speed REAL DEFAULT 500,  -- 最大打印速度 mm/s
            max_acceleration REAL DEFAULT 10000,  -- 最大加速度 mm/s²
            jerk_limit REAL DEFAULT 0.04,  -- 抖动限制 mm/s
            speed_enabled INTEGER DEFAULT 0,  -- 是否启用高级速度参数
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(printer_id, nozzle)
        )
    """)
    print("  ✓ 创建 printer_params 表")
    
    # 2. 创建材料品牌表
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
    print("  ✓ 创建 material_brands 表")
    
    # 3. 创建材料类型表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS material_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            density REAL DEFAULT 1.24,  -- 密度 g/cm³
            description TEXT,
            sort_order INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )
    """)
    print("  ✓ 创建 material_types 表")
    
    # 4. 创建材料表（品牌+类型+具体参数）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_id INTEGER NOT NULL,
            type_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            color TEXT,
            density REAL,  -- 覆盖类型的默认密度
            price_per_kg REAL,  -- 每公斤价格
            hotend_temp_min INTEGER,
            hotend_temp_max INTEGER,
            bed_temp_min INTEGER,
            bed_temp_max INTEGER,
            print_speed_max REAL,  -- 建议最大打印速度
            description TEXT,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (brand_id) REFERENCES material_brands(id),
            FOREIGN KEY (type_id) REFERENCES material_types(id),
            UNIQUE(brand_id, type_id, name)
        )
    """)
    print("  ✓ 创建 materials 表")
    
    # 5. 插入默认材料品牌
    now = datetime.now(timezone.utc).isoformat()
    brands = [
        ("拓竹", "https://bambulab.com", 1),
        ("eSUN", "https://www.esun3d.com", 2),
        ("Polymaker", "https://polymaker.com", 3),
        ("Sunlu", "https://www.sunlu.com", 4),
        ("Creality", "https://www.creality.com", 5),
        ("通用", None, 99),
    ]
    for name, website, order in brands:
        cursor.execute(
            "INSERT OR IGNORE INTO material_brands (name, website, sort_order, created_at) VALUES (?, ?, ?, ?)",
            (name, website, order, now)
        )
    print("  ✓ 插入默认材料品牌")
    
    # 6. 插入默认材料类型
    types = [
        ("PLA", "PLA", 1.24, "最常用的3D打印材料，易打印，环保"),
        ("ABS", "ABS", 1.04, "高强度，耐热，需要封闭打印环境"),
        ("PETG", "PETG", 1.27, "兼具PLA和ABS优点，耐化学腐蚀"),
        ("TPU", "TPU", 1.21, "柔性材料，弹性好，耐磨"),
        ("ASA", "ASA", 1.07, "户外使用，抗紫外线，耐候性好"),
        ("PA", "尼龙 (PA)", 1.14, "高强度，耐磨，需要干燥环境"),
        ("PC", "聚碳酸酯 (PC)", 1.20, "高强度，耐高温，透明"),
        ("PVA", "PVA 水溶性", 1.23, "水溶性支撑材料"),
        ("PLA-CF", "PLA 碳纤维", 1.30, "碳纤维增强PLA，高强度"),
        ("ABS-CF", "ABS 碳纤维", 1.10, "碳纤维增强ABS"),
    ]
    for name, display, density, desc in types:
        cursor.execute(
            "INSERT OR IGNORE INTO material_types (name, display_name, density, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (name, display, density, desc, types.index((name, display, density, desc)), now)
        )
    print("  ✓ 插入默认材料类型")
    
    # 7. 插入打印机默认参数（基于拓竹官方数据）
    printer_params = [
        # (printer_id, nozzle, max_speed, max_acceleration, jerk_limit)
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
            (pid, nozzle, speed, accel, jerk, now, now)
        )
    print("  ✓ 插入打印机默认参数")
    
    conn.commit()
    conn.close()
    print("迁移完成！")


if __name__ == "__main__":
    migrate()
