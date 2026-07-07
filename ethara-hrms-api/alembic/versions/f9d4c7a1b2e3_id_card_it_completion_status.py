"""id_card_it_completion_status

Revision ID: f9d4c7a1b2e3
Revises: f5a8c3d1e2b4
Create Date: 2026-05-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f9d4c7a1b2e3"
down_revision: str | None = "f5a8c3d1e2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "candidate_id_card_forms",
        sa.Column("itCompletedAt", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "candidate_id_card_forms",
        sa.Column("itCompletedBy", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("candidate_id_card_forms", "itCompletedBy")
    op.drop_column("candidate_id_card_forms", "itCompletedAt")
