"""candidate_is_removed

Dedicated soft-delete flag for candidates. Unlike current_status (which workflow steps
like re-screening overwrite), isRemoved persists, so a removed candidate stays hidden
from every module list.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-02 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f2a3b4c5d6e7"
down_revision: str | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column("isRemoved", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_candidates_isRemoved", "candidates", ["isRemoved"])


def downgrade() -> None:
    op.drop_index("ix_candidates_isRemoved", table_name="candidates")
    op.drop_column("candidates", "isRemoved")
