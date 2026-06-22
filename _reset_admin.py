import sqlite3, sys
sys.path.insert(0, '/app')
from app.auth import get_password_hash

db = sqlite3.connect('/app/data/app.db')
u = db.execute("SELECT id, username, password_hash FROM users WHERE username='admin'").fetchone()
if u:
    new_hash = get_password_hash('admin')
    db.execute('UPDATE users SET password_hash = ? WHERE id = ?', (new_hash, u[0]))
    db.commit()
    print(f"Updated admin password hash")
else:
    print("No admin user found")
db.close()
