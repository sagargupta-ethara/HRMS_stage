"""add_must_change_password_to_users

Revision ID: 2c6d4ef53e22
Revises: f4c3b2a1d9e8
Create Date: 2026-05-14 02:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "2c6d4ef53e22"
down_revision: str | None = "f4c3b2a1d9e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "mustChangePassword",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "mustChangePassword")
