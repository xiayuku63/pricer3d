"""Database connection and initialization.

Provides init_db() for schema migrations + seed data,
get_app_defaults() / merge_pricing_config() as utility functions.
"""

import sqlite3
import json
from datetime import datetime, timezone

from .config import (
    DB_PATH,
    DEFAULT_MATERIALS,
    DEFAULT_PRICING_CONFIG,
    APP_DEFAULTS_KEY,
)
from .utils import normalize_materials


def get_db_conn() -> sqlite3.Connection:
    """Raw sqlite3 connection — kept only for backup.py compatibility."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize schema via ORM + run ALTER TABLE migrations + seed data.

    Called once at startup. The ORM's create_all() handles CREATE TABLE;
    this function handles column migrations and seed data for existing DBs.
    """
    from .db import init_orm, get_db_session, engine
    from .models_orm import (
        MembershipPlan,
    )

    # Step 1: Create all tables from ORM models
    init_orm()

    # Step 2: ALTER TABLE migrations for columns added after initial schema
    with engine.connect() as conn:
        _safe_add_column(conn, "users", "materials", "TEXT")
        _safe_add_column(conn, "users", "colors", "TEXT")
        _safe_add_column(conn, "users", "pricing_config", "TEXT")
        _safe_add_column(conn, "users", "email", "TEXT")
        _safe_add_column(conn, "users", "phone", "TEXT")
        _safe_add_column(conn, "users", "email_verified", "INTEGER")
        _safe_add_column(conn, "users", "phone_verified", "INTEGER")
        _safe_add_column(conn, "users", "membership_level", "TEXT")
        _safe_add_column(conn, "users", "membership_expires_at", "TEXT")
        _safe_add_column(conn, "users", "terms_accepted_at", "TEXT")
        _safe_add_column(conn, "users", "privacy_accepted_at", "TEXT")
        _safe_add_column(conn, "users", "terms_version", "TEXT")
        _safe_add_column(conn, "users", "privacy_version", "TEXT")
        _safe_add_column(conn, "users", "default_printer_id", "TEXT")
        _safe_add_column(conn, "users", "default_nozzle", "TEXT")
        _safe_add_column(conn, "users", "default_slicer_preset_id", "INTEGER")
        _safe_add_column(conn, "users", "default_material", "TEXT")
        _safe_add_column(conn, "users", "default_color", "TEXT")
        _safe_add_column(conn, "users", "default_brand", "TEXT")
        _safe_add_column(conn, "quote_history", "printer_model", "TEXT")
        _safe_add_column(conn, "quote_history", "slicer_preset_id", "INTEGER")
        _safe_add_column(conn, "quote_history", "nozzle_diameter", "REAL")
        _safe_add_column(conn, "quote_history", "layer_height", "REAL")
        _safe_add_column(conn, "quote_history", "wall_count", "INTEGER")
        _safe_add_column(conn, "quote_history", "infill", "INTEGER")
        _safe_add_column(conn, "quote_history", "brand", "TEXT")
        _safe_add_column(conn, "quote_history", "cost_breakdown", "TEXT")
        _safe_add_column(conn, "quote_history", "slicer_fallback", "INTEGER")
        _safe_add_column(conn, "quote_history", "slicer_error", "TEXT")
        _safe_add_column(conn, "quote_history", "slicer_estimated_time_s", "REAL")
        conn.commit()

    # Step 2b: Collapse the legacy per-material color palettes into one color
    # per material. This is idempotent and also clears the obsolete global
    # users.colors palette so it cannot be loaded back into the UI.
    raw_conn = engine.raw_connection()
    try:
        _migrate_legacy_material_colors(raw_conn)
    finally:
        raw_conn.close()

    # Step 3: Seed membership plans if empty
    with get_db_session() as db:
        plans_count = db.query(MembershipPlan).count()
        if plans_count == 0:
            now_iso = datetime.now(timezone.utc).isoformat()
            db.add(
                MembershipPlan(
                    code="member_month",
                    name="会员（月）",
                    price_cny=99.0,
                    currency="CNY",
                    duration_days=30,
                    active=1,
                    created_at=now_iso,
                )
            )
            db.add(
                MembershipPlan(
                    code="member_year",
                    name="会员（年）",
                    price_cny=999.0,
                    currency="CNY",
                    duration_days=365,
                    active=1,
                    created_at=now_iso,
                )
            )


def _safe_add_column(conn, table: str, column: str, col_type: str) -> None:
    """Add a column if it doesn't exist. Uses text() for SQLAlchemy 2.0 compat."""
    import logging
    from sqlalchemy import text as _text

    _log = logging.getLogger(__name__)
    try:
        conn.execute(_text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
        conn.commit()
        _log.debug("ALTER TABLE %s ADD COLUMN %s %s — ok", table, column, col_type)
    except Exception as e:
        err = str(e).lower()
        if "duplicate column" in err or "already exists" in err:
            _log.debug("Column %s.%s already exists, skip", table, column)
        else:
            _log.warning("ALTER TABLE %s ADD COLUMN %s %s failed: %s", table, column, col_type, e)


def _migrate_legacy_material_colors(conn: sqlite3.Connection | None = None) -> None:
    """Normalize stored materials to the single-color format."""
    owns_connection = conn is None
    if conn is None:
        conn = get_db_conn()
    try:
        rows = conn.execute("SELECT id, materials FROM users").fetchall()
        for row in rows:
            try:
                raw_materials = json.loads(row[1]) if row[1] else DEFAULT_MATERIALS
            except (TypeError, ValueError, json.JSONDecodeError):
                raw_materials = DEFAULT_MATERIALS
            materials = _dedupe_materials(normalize_materials(raw_materials))
            conn.execute(
                "UPDATE users SET materials = ?, colors = '[]' WHERE id = ?",
                (json.dumps(materials, ensure_ascii=False), row[0]),
            )
        for row in conn.execute("SELECT key, value_json FROM app_defaults").fetchall():
            try:
                raw = json.loads(row[1] or "{}")
            except (TypeError, ValueError, json.JSONDecodeError):
                raw = {}
            raw["materials"] = _dedupe_materials(normalize_materials(raw.get("materials") or DEFAULT_MATERIALS))
            raw["colors"] = []
            conn.execute(
                "UPDATE app_defaults SET value_json = ? WHERE key = ?",
                (json.dumps(raw, ensure_ascii=False), row[0]),
            )

        _merge_legacy_brand_rows(conn)
        conn.commit()
    finally:
        if owns_connection:
            conn.close()


def _merge_legacy_brand_rows(conn: sqlite3.Connection) -> None:
    """Merge placeholder/legacy brands into Generic in the catalog tables."""
    generic_row = conn.execute("SELECT id FROM material_brands WHERE name = ?", ("Generic",)).fetchone()
    if generic_row is None:
        generic_row = conn.execute(
            "SELECT id FROM material_brands WHERE name = ? COLLATE NOCASE",
            ("generic",),
        ).fetchone()
    if generic_row is None:
        now_iso = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO material_brands (name, logo_url, website, sort_order, active, created_at) VALUES (?, NULL, NULL, 99, 1, ?)",
            ("Generic", now_iso),
        )
        generic_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    else:
        generic_id = generic_row[0]

    legacy_rows = conn.execute(
        "SELECT id, name FROM material_brands WHERE name IN (?, ?, ?)",
        ("通用", "??", "?"),
    ).fetchall()
    for legacy_id, _legacy_name in legacy_rows:
        if legacy_id == generic_id:
            continue
        material_rows = conn.execute(
            "SELECT id, type_id, name FROM materials WHERE brand_id = ? ORDER BY id",
            (legacy_id,),
        ).fetchall()
        for material_id, type_id, material_name in material_rows:
            duplicate = conn.execute(
                "SELECT id FROM materials WHERE brand_id = ? AND type_id = ? AND name = ? AND id <> ?",
                (generic_id, type_id, material_name, material_id),
            ).fetchone()
            if duplicate:
                conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))
            else:
                conn.execute("UPDATE materials SET brand_id = ? WHERE id = ?", (generic_id, material_id))

        remaining_refs = conn.execute("SELECT COUNT(*) FROM materials WHERE brand_id = ?", (legacy_id,)).fetchone()[0]
        if remaining_refs == 0:
            conn.execute("DELETE FROM material_brands WHERE id = ?", (legacy_id,))
        else:
            conn.execute("UPDATE material_brands SET active = 0 WHERE id = ?", (legacy_id,))


def _dedupe_materials(materials: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for material in materials:
        color = material.get("color") or {}
        key = (
            str(material.get("brand") or "Generic").strip().lower(),
            str(material.get("name") or "").strip().lower(),
            str(color.get("hex") or color.get("name") or "").strip().lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(material)
    return result


def get_app_defaults() -> dict:
    from .db import get_db_session
    from .models_orm import AppDefault

    with get_db_session() as db:
        row = db.query(AppDefault).filter(AppDefault.key == APP_DEFAULTS_KEY).first()
    if not row or not row.value_json:
        return {
            "materials": normalize_materials(DEFAULT_MATERIALS),
            "colors": [],
            "pricing_config": dict(DEFAULT_PRICING_CONFIG),
        }
    raw = json.loads(row.value_json)
    raw_materials = raw.get("materials")
    raw_pricing = raw.get("pricing_config")
    materials = _dedupe_materials(
        normalize_materials(raw_materials)
        if isinstance(raw_materials, list)
        else normalize_materials(DEFAULT_MATERIALS)
    )
    pricing = merge_pricing_config(raw_pricing) if isinstance(raw_pricing, dict) else dict(DEFAULT_PRICING_CONFIG)
    return {
        "materials": materials,
        "colors": [],
        "pricing_config": pricing,
    }


def merge_pricing_config(raw_config):
    if not raw_config:
        return dict(DEFAULT_PRICING_CONFIG)
    merged = dict(DEFAULT_PRICING_CONFIG)
    for k, v in raw_config.items():
        merged[k] = v
    return merged
