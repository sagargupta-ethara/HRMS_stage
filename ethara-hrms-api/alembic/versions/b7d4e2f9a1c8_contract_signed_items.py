"""Add contract signed_items (multi-document signed envelopes).

Revision ID: b7d4e2f9a1c8
Revises: e4f6a8b0c2d4
Create Date: 2026-06-09
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "b7d4e2f9a1c8"
down_revision = "e4f6a8b0c2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("contracts", sa.Column("signedItems", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("contracts", "signedItems")
