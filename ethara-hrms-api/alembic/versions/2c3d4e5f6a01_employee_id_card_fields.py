"""Add ID-card detail columns to employee_profiles.

Revision ID: 2c3d4e5f6a01
Revises: 1b2c3d4e5f60
Create Date: 2026-06-18
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "2c3d4e5f6a01"
down_revision = "1b2c3d4e5f60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employee_profiles", sa.Column("fatherName", sa.String(length=255), nullable=True))
    op.add_column("employee_profiles", sa.Column("motherName", sa.String(length=255), nullable=True))
    op.add_column("employee_profiles", sa.Column("maritalStatus", sa.String(length=50), nullable=True))
    op.add_column("employee_profiles", sa.Column("currentAddress", sa.Text(), nullable=True))
    op.add_column("employee_profiles", sa.Column("permanentAddress", sa.Text(), nullable=True))
    # ID-card detail submission tracking
    op.add_column("employee_profiles", sa.Column("idCardSubmittedAt", sa.DateTime(timezone=True), nullable=True))
    op.add_column("employee_profiles", sa.Column("idCardSubmittedBy", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("employee_profiles", "idCardSubmittedBy")
    op.drop_column("employee_profiles", "idCardSubmittedAt")
    op.drop_column("employee_profiles", "permanentAddress")
    op.drop_column("employee_profiles", "currentAddress")
    op.drop_column("employee_profiles", "maritalStatus")
    op.drop_column("employee_profiles", "motherName")
    op.drop_column("employee_profiles", "fatherName")
