"""add roles list to users (multiple roles per account)

Revision ID: d7e9a1c3b5f2
Revises: e6b7f4a1c2d3
Create Date: 2026-06-01

"""
from alembic import op
import sqlalchemy as sa

revision = "d7e9a1c3b5f2"
down_revision = "e6b7f4a1c2d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("roles", sa.JSON(), nullable=True))
    # Backfill existing accounts so each holds its current role as the single
    # assigned role.
    op.execute("UPDATE users SET roles = json_build_array(role) WHERE roles IS NULL")


def downgrade() -> None:
    op.drop_column("users", "roles")
