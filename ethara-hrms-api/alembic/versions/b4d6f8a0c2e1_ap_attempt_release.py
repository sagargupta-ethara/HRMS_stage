"""ap_attempt_release

Revision ID: b4d6f8a0c2e1
Revises: a2c4e6f8b1d3
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "b4d6f8a0c2e1"
down_revision: str | None = "a2c4e6f8b1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ap_attempts", sa.Column("resultReleasedAt", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("ap_attempts", "resultReleasedAt")
