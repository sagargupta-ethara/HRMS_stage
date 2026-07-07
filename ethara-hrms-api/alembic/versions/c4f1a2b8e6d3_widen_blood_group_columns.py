"""Widen bloodGroup columns from varchar(10) to varchar(32).

Free-text / OCR blood-group entry produces values like "A- (NEGATIVE)" (13 chars)
that overflow the original varchar(10) column, aborting the whole save with a 500
("Could not save the employee detail form."). Widen the column so writes never
truncate; values are also canonicalized to short codes in the service layer.

Revision ID: c4f1a2b8e6d3
Revises: 2c3d4e5f6a01
Create Date: 2026-06-23
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "c4f1a2b8e6d3"
down_revision = "2c3d4e5f6a01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "employee_profiles",
        "bloodGroup",
        existing_type=sa.String(length=10),
        type_=sa.String(length=32),
        existing_nullable=True,
    )
    op.alter_column(
        "candidate_id_card_forms",
        "bloodGroup",
        existing_type=sa.String(length=10),
        type_=sa.String(length=32),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "candidate_id_card_forms",
        "bloodGroup",
        existing_type=sa.String(length=32),
        type_=sa.String(length=10),
        existing_nullable=True,
    )
    op.alter_column(
        "employee_profiles",
        "bloodGroup",
        existing_type=sa.String(length=32),
        type_=sa.String(length=10),
        existing_nullable=True,
    )
