"""ap_attempt_proctoring

Revision ID: f3a7c9e1d5b8
Revises: b7d9e2f5c1a0
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f3a7c9e1d5b8"
down_revision: str | None = "b7d9e2f5c1a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ap_attempts", sa.Column("proctoring", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("ap_attempts", "proctoring")
