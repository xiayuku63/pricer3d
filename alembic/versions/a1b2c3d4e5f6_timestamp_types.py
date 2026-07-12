"""Migrate timestamp columns from String to DateTime/Float

Revision ID: a1b2c3d4e5f6
Revises: 04e205d19794
Create Date: 2026-07-02 00:00:00

Changes:
- ISO datetime String columns -> DateTime (timezone-aware)
- Unix timestamp String columns -> Float

Uses SQLite batch mode (create new table + copy data + swap) since
SQLite does not support ALTER COLUMN.

The UTCDateTime/UnixTimestamp TypeDecorators in app/db.py provide
backward compatibility — existing ISO strings and numeric strings
are handled transparently on both read and write paths.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "04e205d19794"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade timestamp columns from String to DateTime/Float.

    SQLite batch mode recreates each table with the new column types.
    Data conversion is automatic via SQLite's type affinity:
    - TEXT -> TEXT (DateTime stored as ISO text): no-op
    - TEXT -> REAL (Float): numeric strings converted to float
    """
    conn = op.get_bind()

    # Helper: check if a table exists
    def table_exists(name: str) -> bool:
        r = conn.execute(
            sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
            {"n": name},
        ).fetchone()
        return r is not None

    # ── users ──
    if table_exists("users"):
        with op.batch_alter_table("users", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )
            batch_op.alter_column(
                "membership_expires_at", existing_type=sa.String(), type_=sa.Float(), existing_nullable=True
            )
            batch_op.alter_column(
                "terms_accepted_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )
            batch_op.alter_column(
                "privacy_accepted_at",
                existing_type=sa.String(),
                type_=sa.DateTime(timezone=True),
                existing_nullable=True,
            )

    # ── printer_presets ──
    if table_exists("printer_presets"):
        with op.batch_alter_table("printer_presets", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )

    # ── slicer_presets ──
    if table_exists("slicer_presets"):
        with op.batch_alter_table("slicer_presets", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )

    # ── verification_codes ──
    if table_exists("verification_codes"):
        with op.batch_alter_table("verification_codes", schema=None) as batch_op:
            batch_op.alter_column("expires_at", existing_type=sa.String(), type_=sa.Float(), existing_nullable=False)
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )
            batch_op.alter_column(
                "used_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )

    # ── audit_events ──
    if table_exists("audit_events"):
        with op.batch_alter_table("audit_events", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )

    # ── quote_history ──
    if table_exists("quote_history"):
        with op.batch_alter_table("quote_history", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )

    # ── payment_orders ──
    if table_exists("payment_orders"):
        with op.batch_alter_table("payment_orders", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )
            batch_op.alter_column(
                "paid_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )

    # ── membership_plans ──
    if table_exists("membership_plans"):
        with op.batch_alter_table("membership_plans", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )

    # ── login_failures ──
    if table_exists("login_failures"):
        with op.batch_alter_table("login_failures", schema=None) as batch_op:
            batch_op.alter_column("created_at", existing_type=sa.String(), type_=sa.Float(), existing_nullable=True)
            batch_op.alter_column(
                "first_failed_at", existing_type=sa.String(), type_=sa.Float(), existing_nullable=True
            )
            batch_op.alter_column("last_failed_at", existing_type=sa.String(), type_=sa.Float(), existing_nullable=True)
            batch_op.alter_column("locked_until", existing_type=sa.String(), type_=sa.Float(), existing_nullable=True)

    # ── idempotency_responses ──
    if table_exists("idempotency_responses"):
        with op.batch_alter_table("idempotency_responses", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )
            batch_op.alter_column("expires_at", existing_type=sa.String(), type_=sa.Float(), existing_nullable=True)

    # ── app_defaults ──
    if table_exists("app_defaults"):
        with op.batch_alter_table("app_defaults", schema=None) as batch_op:
            batch_op.alter_column(
                "updated_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )

    # ── rate_limit_state ──
    if table_exists("rate_limit_state"):
        with op.batch_alter_table("rate_limit_state", schema=None) as batch_op:
            batch_op.alter_column(
                "updated_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )

    # ── categories ──
    if table_exists("categories"):
        with op.batch_alter_table("categories", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )

    # ── todos ──
    if table_exists("todos"):
        with op.batch_alter_table("todos", schema=None) as batch_op:
            batch_op.alter_column(
                "due_date", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=True
            )
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )
            batch_op.alter_column(
                "updated_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )

    # ── printer_params ──
    if table_exists("printer_params"):
        with op.batch_alter_table("printer_params", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )
            batch_op.alter_column(
                "updated_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )

    # ── material_brands ──
    if table_exists("material_brands"):
        with op.batch_alter_table("material_brands", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )

    # ── material_types ──
    if table_exists("material_types"):
        with op.batch_alter_table("material_types", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )

    # ── materials ──
    if table_exists("materials"):
        with op.batch_alter_table("materials", schema=None) as batch_op:
            batch_op.alter_column(
                "created_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )
            batch_op.alter_column(
                "updated_at", existing_type=sa.String(), type_=sa.DateTime(timezone=True), existing_nullable=False
            )


def downgrade() -> None:
    """Revert DateTime/Float columns back to String.

    Not recommended — downgrading loses type safety. Provided for completeness.
    """
    conn = op.get_bind()

    def table_exists(name: str) -> bool:
        r = conn.execute(
            sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
            {"n": name},
        ).fetchone()
        return r is not None

    # Reverse all changes: DateTime -> String, Float -> String
    tables_and_cols = {
        "users": [
            ("created_at", False),
            ("membership_expires_at", True),
            ("terms_accepted_at", True),
            ("privacy_accepted_at", True),
        ],
        "printer_presets": [("created_at", False)],
        "slicer_presets": [("created_at", False)],
        "verification_codes": [("expires_at", False), ("created_at", False), ("used_at", True)],
        "audit_events": [("created_at", False)],
        "quote_history": [("created_at", True)],
        "payment_orders": [("created_at", True), ("paid_at", True)],
        "membership_plans": [("created_at", True)],
        "login_failures": [
            ("created_at", True),
            ("first_failed_at", True),
            ("last_failed_at", True),
            ("locked_until", True),
        ],
        "idempotency_responses": [("created_at", True), ("expires_at", True)],
        "app_defaults": [("updated_at", True)],
        "rate_limit_state": [("updated_at", True)],
        "categories": [("created_at", False)],
        "todos": [("due_date", True), ("created_at", False), ("updated_at", False)],
        "printer_params": [("created_at", False), ("updated_at", False)],
        "material_brands": [("created_at", False)],
        "material_types": [("created_at", False)],
        "materials": [("created_at", False), ("updated_at", False)],
    }

    for table_name, cols in tables_and_cols.items():
        if not table_exists(table_name):
            continue
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            for col_name, nullable in cols:
                batch_op.alter_column(
                    col_name, existing_type=sa.DateTime(timezone=True), type_=sa.String(), existing_nullable=nullable
                )
