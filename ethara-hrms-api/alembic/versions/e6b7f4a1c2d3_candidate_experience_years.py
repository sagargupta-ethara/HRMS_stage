"""add candidate experience years

Revision ID: e6b7f4a1c2d3
Revises: d9f2e5c8b1a4
Create Date: 2026-06-01

"""
from alembic import op
import sqlalchemy as sa

revision = "e6b7f4a1c2d3"
down_revision = "d9f2e5c8b1a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("candidates", sa.Column("experienceYears", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("candidates", "experienceYears")
