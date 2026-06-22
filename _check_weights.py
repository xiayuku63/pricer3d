import sqlite3
db = sqlite3.connect('/app/data/app.db')
rows = db.execute("SELECT id, filename, weight_g, infill, wall_count, layer_height, created_at FROM quote_history WHERE status='success' AND weight_g > 0 ORDER BY id DESC LIMIT 8").fetchall()
for r in rows:
    print(f"#{r[0]} {r[1][:30]:30s} weight={r[2]:>8.2f}g infill={r[3]} walls={r[4]} lh={r[5]} at={r[6][:19]}")
db.close()
