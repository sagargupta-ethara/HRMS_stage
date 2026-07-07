"""ap_attempt_final_result

Revision ID: a2c4e6f8b1d3
Revises: f3a7c9e1d5b8
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a2c4e6f8b1d3"
down_revision: str | None = "f3a7c9e1d5b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ap_attempts", sa.Column("overallFeedback", sa.Text(), nullable=True))
    op.add_column("ap_attempts", sa.Column("resultFinalizedAt", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("ap_attempts", "resultFinalizedAt")
    op.drop_column("ap_attempts", "overallFeedback")
