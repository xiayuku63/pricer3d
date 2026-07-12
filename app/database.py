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
    DEFAULT_COLORS,
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


def get_app_defaults() -> dict:
    from .db import get_db_session
    from .models_orm import AppDefault

    with get_db_session() as db:
        row = db.query(AppDefault).filter(AppDefault.key == APP_DEFAULTS_KEY).first()
    if not row or not row.value_json:
        return {
            "materials": list(DEFAULT_MATERIALS),
            "colors": list(DEFAULT_COLORS),
            "pricing_config": dict(DEFAULT_PRICING_CONFIG),
        }
    raw = json.loads(row.value_json)
    raw_materials = raw.get("materials")
    colors = raw.get("colors")
    raw_pricing = raw.get("pricing_config")
    materials = (
        normalize_materials(raw_materials, fallback_colors=(colors or DEFAULT_COLORS))
        if isinstance(raw_materials, list)
        else DEFAULT_MATERIALS
    )
    derived_colors: list[str] = []
    for m in materials:
        for c in m.get("colors", []):
            if c not in derived_colors:
                derived_colors.append(c)
    pricing = merge_pricing_config(raw_pricing) if isinstance(raw_pricing, dict) else dict(DEFAULT_PRICING_CONFIG)
    return {
        "materials": materials,
        "colors": derived_colors or (colors or list(DEFAULT_COLORS)),
        "pricing_config": pricing,
    }


def merge_pricing_config(raw_config):
    if not raw_config:
        return dict(DEFAULT_PRICING_CONFIG)
    merged = dict(DEFAULT_PRICING_CONFIG)
    for k, v in raw_config.items():
        merged[k] = v
    return merged
