"""candidate_profile_without_position

Revision ID: 9d2a7e4b6c31
Revises: 7c9f8b0a4d12
Create Date: 2026-05-06 11:25:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9d2a7e4b6c31"
down_revision: str | None = "7c9f8b0a4d12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("candidates", "positionId", existing_type=sa.String(length=32), nullable=True)


def downgrade() -> None:
    op.alter_column("candidates", "positionId", existing_type=sa.String(length=32), nullable=False)
