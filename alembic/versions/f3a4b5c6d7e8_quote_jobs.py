"""Quote job tables (P2-15 async quoting)

Revision ID: f3a4b5c6d7e8
Revises: a1b2c3d4e5f6
Create Date: 2026-08-29 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "quote_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False, index=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("total_files", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("params_json", sa.Text()),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.String(), nullable=False, index=True),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
    op.create_table(
        "quote_job_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(length=36), nullable=False, index=True),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("source_path", sa.String()),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text()),
        sa.Column("result_json", sa.Text()),
        sa.Column("updated_at", sa.String(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("quote_job_items")
    op.drop_table("quote_jobs")
