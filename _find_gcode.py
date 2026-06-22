import sqlite3, os, glob

db = sqlite3.connect('/app/data/app.db')
rows = db.execute("SELECT id, filename, estimated_time_h, created_at FROM quote_history WHERE status='success' ORDER BY id DESC LIMIT 6").fetchall()
db.close()

print("Recent successful quotes:")
for r in rows:
    print(f"  #{r[0]} {r[1][:40]} time={r[2]}h at={r[3]}")

# Find G-code files
print("\nG-code files:")
for user_dir in sorted(glob.glob('/app/data/user/user_*')):
    outputs_dir = os.path.join(user_dir, 'outputs')
    if not os.path.isdir(outputs_dir):
        continue
    for date_dir in sorted(os.listdir(outputs_dir), reverse=True)[:2]:
        full_date = os.path.join(outputs_dir, date_dir)
        if not os.path.isdir(full_date):
            continue
        for d in sorted(os.listdir(full_date), reverse=True)[:5]:
            gcode = os.path.join(full_date, d, d + '.gcode')
            if os.path.isfile(gcode):
                size = os.path.getsize(gcode)
                print(f"  {gcode} ({size} bytes)")
