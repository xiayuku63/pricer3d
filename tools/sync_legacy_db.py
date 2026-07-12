"""Sync legacy user/account data from an older SQLite DB into the active local DB.

Usage:
  python tools/sync_legacy_db.py --src data/pricer3d_sync.db --dst app.db
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


def table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def fetch_all(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    return conn.execute(sql, params).fetchall()


def sync_users(src: sqlite3.Connection, dst: sqlite3.Connection) -> dict[int, int]:
    src_users = fetch_all(src, "SELECT * FROM users ORDER BY id")
    dst_cols = set(table_columns(dst, "users"))
    src_cols = table_columns(src, "users")
    shared = [c for c in src_cols if c in dst_cols and c != "id"]
    user_id_map: dict[int, int] = {}

    for row in src_users:
        data = dict(row)
        existing = dst.execute("SELECT id FROM users WHERE username = ?", (data["username"],)).fetchone()
        payload = {k: data.get(k) for k in shared}
        if existing:
            dst.execute(
                "UPDATE users SET " + ", ".join(f"{k} = ?" for k in payload.keys()) + " WHERE id = ?",
                tuple(payload.values()) + (existing[0],),
            )
            user_id_map[data["id"]] = existing[0]
        else:
            insert_cols = list(payload.keys())
            dst.execute(
                f"INSERT INTO users ({', '.join(insert_cols)}) VALUES ({', '.join('?' for _ in insert_cols)})",
                tuple(payload[c] for c in insert_cols),
            )
            user_id_map[data["id"]] = dst.execute("SELECT last_insert_rowid()").fetchone()[0]
    return user_id_map


def sync_quote_history(src: sqlite3.Connection, dst: sqlite3.Connection, user_id_map: dict[int, int]) -> int:
    src_cols = table_columns(src, "quote_history")
    dst_cols = table_columns(dst, "quote_history")
    shared = [c for c in src_cols if c in dst_cols and c != "id"]
    inserted = 0
    for row in fetch_all(src, "SELECT * FROM quote_history ORDER BY id"):
        data = dict(row)
        old_user_id = data["user_id"]
        if old_user_id not in user_id_map:
            continue
        data["user_id"] = user_id_map[old_user_id]
        exists = dst.execute(
            "SELECT 1 FROM quote_history WHERE user_id = ? AND filename = ? AND created_at = ? AND COALESCE(status,'') = COALESCE(?, '') LIMIT 1",
            (data["user_id"], data.get("filename"), data.get("created_at"), data.get("status")),
        ).fetchone()
        if exists:
            continue
        insert_cols = [c for c in shared if c in data]
        dst.execute(
            f"INSERT INTO quote_history ({', '.join(insert_cols)}) VALUES ({', '.join('?' for _ in insert_cols)})",
            tuple(data.get(c) for c in insert_cols),
        )
        inserted += 1
    return inserted


def sync_payment_orders(src: sqlite3.Connection, dst: sqlite3.Connection, user_id_map: dict[int, int]) -> int:
    src_cols = table_columns(src, "payment_orders")
    dst_cols = table_columns(dst, "payment_orders")
    shared = [c for c in src_cols if c in dst_cols and c != "id"]
    inserted = 0
    for row in fetch_all(src, "SELECT * FROM payment_orders ORDER BY id"):
        data = dict(row)
        if data["user_id"] not in user_id_map:
            continue
        data["user_id"] = user_id_map[data["user_id"]]
        exists = dst.execute("SELECT 1 FROM payment_orders WHERE order_no = ? LIMIT 1", (data["order_no"],)).fetchone()
        if exists:
            continue
        insert_cols = [c for c in shared if c in data]
        dst.execute(
            f"INSERT INTO payment_orders ({', '.join(insert_cols)}) VALUES ({', '.join('?' for _ in insert_cols)})",
            tuple(data.get(c) for c in insert_cols),
        )
        inserted += 1
    return inserted


def sync_slicer_presets(src: sqlite3.Connection, dst: sqlite3.Connection, user_id_map: dict[int, int]) -> int:
    src_cols = table_columns(src, "slicer_presets")
    dst_cols = table_columns(dst, "slicer_presets")
    shared = [c for c in src_cols if c in dst_cols and c != "id"]
    inserted = 0
    for row in fetch_all(src, "SELECT * FROM slicer_presets ORDER BY id"):
        data = dict(row)
        if data["user_id"] not in user_id_map:
            continue
        data["user_id"] = user_id_map[data["user_id"]]
        exists = dst.execute(
            "SELECT 1 FROM slicer_presets WHERE user_id = ? AND name = ? LIMIT 1",
            (data["user_id"], data["name"]),
        ).fetchone()
        if exists:
            continue
        insert_cols = [c for c in shared if c in data]
        dst.execute(
            f"INSERT INTO slicer_presets ({', '.join(insert_cols)}) VALUES ({', '.join('?' for _ in insert_cols)})",
            tuple(data.get(c) for c in insert_cols),
        )
        inserted += 1
    return inserted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True)
    parser.add_argument("--dst", required=True)
    args = parser.parse_args()

    src_path = Path(args.src)
    dst_path = Path(args.dst)
    if not src_path.exists():
        raise SystemExit(f"Source DB not found: {src_path}")
    if not dst_path.exists():
        raise SystemExit(f"Destination DB not found: {dst_path}")

    src = sqlite3.connect(str(src_path))
    dst = sqlite3.connect(str(dst_path))
    try:
        dst.execute("PRAGMA foreign_keys = OFF")
        user_id_map = sync_users(src, dst)
        quotes = sync_quote_history(src, dst, user_id_map)
        orders = sync_payment_orders(src, dst, user_id_map)
        presets = sync_slicer_presets(src, dst, user_id_map)
        dst.commit()
        print({
            "user_id_map": user_id_map,
            "quote_history_inserted": quotes,
            "payment_orders_inserted": orders,
            "slicer_presets_inserted": presets,
        })
    finally:
        dst.close()
        src.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
