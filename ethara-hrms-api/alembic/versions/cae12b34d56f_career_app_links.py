"""career_application linkedin + github links

Revision ID: cae12b34d56f
Revises: f8a1c2d3e4b5
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "cae12b34d56f"
down_revision: str | None = "f8a1c2d3e4b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("career_applications", sa.Column("linkedinUrl", sa.String(500), nullable=True))
    op.add_column("career_applications", sa.Column("githubUrl", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("career_applications", "githubUrl")
    op.drop_column("career_applications", "linkedinUrl")
