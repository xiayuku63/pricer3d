import sqlite3
db = sqlite3.connect('/app/data/app.db')
rows = db.execute("SELECT id, filename, estimated_time_h, cost_cny, dimensions, status, created_at FROM quote_history ORDER BY id DESC LIMIT 10").fetchall()
for r in rows:
    fn = (r[1] or "?")[:30]
    t = r[2]
    c = r[3]
    d = r[4]
    s = r[5]
    at_s = (r[6] or "")[:19]
    print(f"#{r[0]} file={fn} time={t}h cost={c} dims={d} status={s} at={at_s}")
db.close()
