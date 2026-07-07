"""Add AI document-type verification columns to employee_documents.

Revision ID: 1b2c3d4e5f60
Revises: 9f1e7d3c2a08
Create Date: 2026-06-17
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "1b2c3d4e5f60"
down_revision = "9f1e7d3c2a08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_documents",
        sa.Column("ocrStatus", sa.String(length=50), nullable=False, server_default="pending"),
    )
    op.add_column(
        "employee_documents",
        sa.Column("ocrProvider", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "employee_documents",
        sa.Column("verificationData", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employee_documents", "verificationData")
    op.drop_column("employee_documents", "ocrProvider")
    op.drop_column("employee_documents", "ocrStatus")
