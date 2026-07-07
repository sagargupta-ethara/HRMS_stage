"""Add employee_leave_balances (greytHR leave balances).

Revision ID: 7b3e9c1a2f48
Revises: d6e7f8a9b0c1
Create Date: 2026-06-27
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "7b3e9c1a2f48"
down_revision: str | None = "d6e7f8a9b0c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "employee_leave_balances",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeCode", sa.String(length=64), nullable=False),
        sa.Column("leaveCode", sa.String(length=32), nullable=False),
        sa.Column("leaveType", sa.String(length=120), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("opening", sa.Float(), nullable=False, server_default="0"),
        sa.Column("granted", sa.Float(), nullable=False, server_default="0"),
        sa.Column("availed", sa.Float(), nullable=False, server_default="0"),
        sa.Column("applied", sa.Float(), nullable=False, server_default="0"),
        sa.Column("lapsed", sa.Float(), nullable=False, server_default="0"),
        sa.Column("deducted", sa.Float(), nullable=False, server_default="0"),
        sa.Column("encashed", sa.Float(), nullable=False, server_default="0"),
        sa.Column("balance", sa.Float(), nullable=False, server_default="0"),
        sa.Column("syncedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employeeCode", "leaveCode", "year", name="uq_emp_leave_balance_code_year"),
    )
    op.create_index("ix_employee_leave_balances_employeeCode", "employee_leave_balances", ["employeeCode"])
    op.create_index("ix_employee_leave_balances_leaveCode", "employee_leave_balances", ["leaveCode"])
    op.create_index("ix_employee_leave_balances_year", "employee_leave_balances", ["year"])


def downgrade() -> None:
    op.drop_index("ix_employee_leave_balances_year", table_name="employee_leave_balances")
    op.drop_index("ix_employee_leave_balances_leaveCode", table_name="employee_leave_balances")
    op.drop_index("ix_employee_leave_balances_employeeCode", table_name="employee_leave_balances")
    op.drop_table("employee_leave_balances")
