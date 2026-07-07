"""Add reimbursement receipt OCR payload.

Revision ID: e4f6a8b0c2d4
Revises: d12e34f56a78
Create Date: 2026-06-09
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "e4f6a8b0c2d4"
down_revision = "d12e34f56a78"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reimbursement_requests", sa.Column("receiptOcr", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("reimbursement_requests", "receiptOcr")
