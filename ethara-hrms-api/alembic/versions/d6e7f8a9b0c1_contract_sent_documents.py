"""Add sent document metadata to contracts.

Revision ID: d6e7f8a9b0c1
Revises: c4f1a2b8e6d3
Create Date: 2026-06-24
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "d6e7f8a9b0c1"
down_revision: str | None = "c4f1a2b8e6d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("contracts", sa.Column("sentDocuments", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("contracts", "sentDocuments")
