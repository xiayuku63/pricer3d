"""迁移：添加新打印机参数（拓竹P2/H2/X2系列 + 创想K系列）

基于官方规格：
- Bambu Lab P2S: 600mm/s, 20000mm/s²
- Bambu Lab H2D/H2D Pro: 1000mm/s, 20000mm/s²
- Bambu Lab X2D: 1000mm/s, 20000mm/s²
- Creality K1/K1C/K1 Max/K1 SE: 600mm/s, 20000mm/s²
- Creality K2 Plus: 600mm/s, 30000mm/s²
"""

import sqlite3
import os


def migrate(db_path: str = None):
    if db_path is None:
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "app.db")
    if not os.path.exists(db_path):
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app.db")

    print(f"添加新打印机参数到: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 新打印机参数
    # (printer_id, nozzle, max_speed, max_acceleration, jerk_limit)
    new_printer_params = [
        # ── Bambu Lab P2S ──
        ("bambu_p2s", 0.4, 600, 20000, 0.06),
        ("bambu_p2s", 0.2, 300, 20000, 0.06),
        ("bambu_p2s", 0.6, 600, 20000, 0.06),
        ("bambu_p2s", 0.8, 500, 20000, 0.06),
        # ── Bambu Lab H2D (1000mm/s max, dual-nozzle) ──
        ("bambu_h2d", 0.4, 1000, 20000, 0.06),
        ("bambu_h2d", 0.2, 500, 20000, 0.06),
        ("bambu_h2d", 0.6, 800, 20000, 0.06),
        ("bambu_h2d", 0.8, 600, 20000, 0.06),
        # ── Bambu Lab H2D Pro ──
        ("bambu_h2d_pro", 0.4, 1000, 20000, 0.06),
        ("bambu_h2d_pro", 0.2, 500, 20000, 0.06),
        ("bambu_h2d_pro", 0.6, 800, 20000, 0.06),
        ("bambu_h2d_pro", 0.8, 600, 20000, 0.06),
        # ── Bambu Lab X2D (1000mm/s max, dual-nozzle) ──
        ("bambu_x2d", 0.4, 1000, 20000, 0.06),
        ("bambu_x2d", 0.2, 500, 20000, 0.06),
        ("bambu_x2d", 0.6, 800, 20000, 0.06),
        ("bambu_x2d", 0.8, 600, 20000, 0.06),
        # ── Creality K1 (600mm/s, 20000mm/s²) ──
        ("creality_k1", 0.4, 600, 20000, 0.06),
        ("creality_k1", 0.6, 500, 20000, 0.06),
        ("creality_k1", 0.8, 400, 20000, 0.06),
        # ── Creality K1C (600mm/s, 20000mm/s², all-metal hotend) ──
        ("creality_k1c", 0.4, 600, 20000, 0.06),
        ("creality_k1c", 0.6, 500, 20000, 0.06),
        ("creality_k1c", 0.8, 400, 20000, 0.06),
        # ── Creality K1 Max (600mm/s, 20000mm/s²) ──
        ("creality_k1_max", 0.4, 600, 20000, 0.06),
        ("creality_k1_max", 0.6, 500, 20000, 0.06),
        ("creality_k1_max", 0.8, 400, 20000, 0.06),
        # ── Creality K1 SE (600mm/s, 20000mm/s²) ──
        ("creality_k1_se", 0.4, 600, 20000, 0.06),
        ("creality_k1_se", 0.6, 500, 20000, 0.06),
        ("creality_k1_se", 0.8, 400, 20000, 0.06),
        # ── Creality K2 Plus (600mm/s, 30000mm/s²) ──
        ("creality_k2_plus", 0.4, 600, 30000, 0.08),
        ("creality_k2_plus", 0.6, 500, 30000, 0.08),
        ("creality_k2_plus", 0.8, 400, 30000, 0.08),
    ]

    from datetime import datetime

    now = datetime.utcnow().isoformat()

    inserted = 0
    for pid, nozzle, speed, accel, jerk in new_printer_params:
        try:
            cursor.execute(
                "INSERT OR IGNORE INTO printer_params (printer_id, nozzle, max_speed, max_acceleration, jerk_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (pid, nozzle, speed, accel, jerk, now, now),
            )
            if cursor.rowcount > 0:
                inserted += 1
        except Exception as e:
            print(f"  ⚠ {pid} {nozzle}mm: {e}")

    conn.commit()
    print(f"  ✓ 插入 {inserted} 条新打印机参数（共 {len(new_printer_params)} 条）")

    # 验证
    cursor.execute(
        "SELECT printer_id, nozzle, max_speed, max_acceleration FROM printer_params ORDER BY printer_id, nozzle"
    )
    rows = cursor.fetchall()
    print(f"\n当前数据库中共 {len(rows)} 条打印机参数:")
    current_pid = None
    for pid, nozzle, speed, accel in rows:
        if pid != current_pid:
            print(f"  {pid}:")
            current_pid = pid
        print(f"    {nozzle}mm: {speed}mm/s, {accel}mm/s²")

    conn.close()
    print("\n迁移完成！")


if __name__ == "__main__":
    migrate()
