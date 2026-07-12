"""Database health check & migration utility.

Usage:
  python -m app.db_check          # check current state
  python -m app.db_check --sync   # sync schema + backfill NULLs
  python -m app.db_check --fix    # alias for --sync
"""

from typing import Optional

import sys
import json
import sqlite3
from datetime import datetime, timezone

from .database import init_db, get_db_conn, get_app_defaults
from .config import DEFAULT_MATERIALS, DEFAULT_COLORS, DEFAULT_PRICING_CONFIG


def _backfill_user(conn: sqlite3.Connection, uid: int, username: str) -> dict[str, bool]:
    """Backfill default values for a single user. Returns {column: was_fixed}."""
    row = conn.execute(
        "SELECT materials, colors, pricing_config, email_verified, phone_verified, "
        "membership_level, terms_accepted_at, privacy_accepted_at, terms_version, privacy_version "
        "FROM users WHERE id = ?",
        (uid,),
    ).fetchone()
    if not row:
        return {}

    defaults = get_app_defaults()
    fixed = {}

    # materials / colors / pricing_config
    if row["materials"] is None:
        conn.execute(
            "UPDATE users SET materials = ? WHERE id = ?",
            (json.dumps(defaults.get("materials") or DEFAULT_MATERIALS), uid),
        )
        fixed["materials"] = True

    if row["colors"] is None:
        conn.execute(
            "UPDATE users SET colors = ? WHERE id = ?", (json.dumps(defaults.get("colors") or DEFAULT_COLORS), uid)
        )
        fixed["colors"] = True

    if row["pricing_config"] is None:
        conn.execute(
            "UPDATE users SET pricing_config = ? WHERE id = ?",
            (json.dumps(defaults.get("pricing_config") or DEFAULT_PRICING_CONFIG), uid),
        )
        fixed["pricing_config"] = True

    # verification flags
    if row["email_verified"] is None:
        conn.execute("UPDATE users SET email_verified = 0 WHERE id = ?", (uid,))
        fixed["email_verified"] = True

    if row["phone_verified"] is None:
        conn.execute("UPDATE users SET phone_verified = 0 WHERE id = ?", (uid,))
        fixed["phone_verified"] = True

    # membership
    if row["membership_level"] is None:
        conn.execute("UPDATE users SET membership_level = 'free' WHERE id = ?", (uid,))
        fixed["membership_level"] = True

    # legal acceptance
    now_iso = datetime.now(timezone.utc).isoformat()
    if row["terms_accepted_at"] is None:
        conn.execute("UPDATE users SET terms_accepted_at = ?, terms_version = ? WHERE id = ?", (now_iso, "v1", uid))
        fixed["terms_accepted_at"] = True

    if row["privacy_accepted_at"] is None:
        conn.execute("UPDATE users SET privacy_accepted_at = ?, privacy_version = ? WHERE id = ?", (now_iso, "v1", uid))
        fixed["privacy_accepted_at"] = True

    return fixed


def check_db(conn: Optional[sqlite3.Connection] = None) -> dict:
    """Run health check, return summary dict."""
    own = conn is None
    if own:
        conn = get_db_conn()

    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]

    user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    null_ev = conn.execute("SELECT COUNT(*) FROM users WHERE email_verified IS NULL").fetchone()[0]

    null_membership = conn.execute("SELECT COUNT(*) FROM users WHERE membership_level IS NULL").fetchone()[0]

    null_materials = conn.execute("SELECT COUNT(*) FROM users WHERE materials IS NULL").fetchone()[0]

    # Count stale verification codes
    now = datetime.now(timezone.utc).timestamp()
    stale_codes = conn.execute(
        "SELECT COUNT(*) FROM verification_codes WHERE used_at IS NULL AND CAST(expires_at AS REAL) < ?", (now,)
    ).fetchone()[0]

    if own:
        conn.close()

    return {
        "tables": tables,
        "user_count": user_count,
        "null_email_verified": null_ev,
        "null_membership": null_membership,
        "null_materials": null_materials,
        "stale_verification_codes": stale_codes,
    }


def sync_db() -> int:
    """Run init + backfill. Returns number of users fixed."""
    init_db()

    conn = get_db_conn()
    users = conn.execute("SELECT id, username FROM users").fetchall()

    total_fixed = 0
    for u in users:
        fixed = _backfill_user(conn, u["id"], u["username"])
        if fixed:
            total_fixed += 1
            print(f"  [FIXED] id={u['id']} username={u['username']}: {list(fixed.keys())}")

    conn.commit()

    # Cleanup stale verification codes
    now = datetime.now(timezone.utc).timestamp()
    deleted = conn.execute(
        "DELETE FROM verification_codes WHERE used_at IS NULL AND CAST(expires_at AS REAL) < ?", (now,)
    ).rowcount
    if deleted:
        print(f"  [CLEAN] deleted {deleted} stale verification codes")

    conn.commit()
    conn.close()
    return total_fixed


if __name__ == "__main__":
    do_sync = "--sync" in sys.argv or "--fix" in sys.argv

    if do_sync:
        print("=== Database Sync ===")
        fixed = sync_db()
        print(f"\nDone. {fixed} user(s) backfilled.")
    else:
        print("=== Database Health Check ===")
        result = check_db()
        print(f"  Tables: {', '.join(result['tables']) or '(none)'}")
        print(f"  Users: {result['user_count']}")
        print(f"  NULL email_verified: {result['null_email_verified']}")
        print(f"  NULL membership: {result['null_membership']}")
        print(f"  NULL materials: {result['null_materials']}")
        print(f"  Stale verification codes: {result['stale_verification_codes']}")
        print("\n  Run with --sync to fix NULL values.")
