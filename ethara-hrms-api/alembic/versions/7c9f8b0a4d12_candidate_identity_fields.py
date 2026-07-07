"""candidate_identity_fields

Revision ID: 7c9f8b0a4d12
Revises: 2158f2d70ea1
Create Date: 2026-05-06 09:05:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "7c9f8b0a4d12"
down_revision: str | None = "2158f2d70ea1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("candidates", sa.Column("aadhaarHash", sa.String(length=64), nullable=True))
    op.add_column("candidates", sa.Column("gender", sa.String(length=30), nullable=True))
    op.create_unique_constraint(op.f("uq_candidates_aadhaarHash"), "candidates", ["aadhaarHash"])


def downgrade() -> None:
    op.drop_constraint(op.f("uq_candidates_aadhaarHash"), "candidates", type_="unique")
    op.drop_column("candidates", "gender")
    op.drop_column("candidates", "aadhaarHash")
