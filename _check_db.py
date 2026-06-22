import sqlite3, json, os

db = sqlite3.connect('/app/data/app.db')

# Check what tables exist
tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print('Tables:', [t[0] for t in tables])

# Check quote_history if it exists
cols = db.execute("PRAGMA table_info(quote_history)").fetchall()
print('quote_history columns:')
for c in cols:
    print(f'  {c[1]} ({c[2]})')

# Get recent records
try:
    rows = db.execute("SELECT * FROM quote_history ORDER BY id DESC LIMIT 10").fetchall()
    print(f'\n{len(rows)} records:')
    for r in rows:
        print(f'  id={r[0]} file={r[1] if len(r)>1 else "?"}')
except Exception as e:
    print(f'Error: {e}')

db.close()
