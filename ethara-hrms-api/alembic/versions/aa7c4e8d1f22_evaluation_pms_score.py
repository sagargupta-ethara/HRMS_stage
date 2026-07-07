"""evaluation_pms_score

Revision ID: aa7c4e8d1f22
Revises: f9d4c7a1b2e3
Create Date: 2026-05-20 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "aa7c4e8d1f22"
down_revision: str | None = "f9d4c7a1b2e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("pmsScore", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("evaluations", "pmsScore")
