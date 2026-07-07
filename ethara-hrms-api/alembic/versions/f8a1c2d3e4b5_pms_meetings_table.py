"""pms_meetings_table

Revision ID: f8a1c2d3e4b5
Revises: e7c3a9f1b6d4
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f8a1c2d3e4b5"
down_revision: str | None = "e7c3a9f1b6d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pms_meetings",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("employeeId", sa.String(32), sa.ForeignKey("employee_profiles.id"), nullable=False, index=True),
        sa.Column("organizerId", sa.String(32), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False, server_default="online"),
        sa.Column("scheduledAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("durationMinutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("location", sa.String(500), nullable=True),
        sa.Column("attendees", sa.JSON(), nullable=True),
        sa.Column("inviteEmployee", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="scheduled", index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("pms_meetings")
