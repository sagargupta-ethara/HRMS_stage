"""Add portfolio URL to career applications

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-06-03 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "e9f0a1b2c3d4"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "career_applications",
        sa.Column("portfolioUrl", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("career_applications", "portfolioUrl")
