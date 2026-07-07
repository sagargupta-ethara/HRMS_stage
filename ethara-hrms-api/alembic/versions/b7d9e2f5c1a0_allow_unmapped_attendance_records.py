"""allow_unmapped_attendance_records

Revision ID: b7d9e2f5c1a0
Revises: a8c2e4f6b0d1
Create Date: 2026-06-05 12:35:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b7d9e2f5c1a0"
down_revision: str | None = "a8c2e4f6b0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "attendance_records",
        "employeeProfileId",
        existing_type=sa.String(length=32),
        nullable=True,
    )
    op.create_unique_constraint(
        "uq_attendance_employee_code_date",
        "attendance_records",
        ["employeeCode", "attendanceDate"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_attendance_employee_code_date",
        "attendance_records",
        type_="unique",
    )
    op.execute('DELETE FROM "attendance_records" WHERE "employeeProfileId" IS NULL')
    op.alter_column(
        "attendance_records",
        "employeeProfileId",
        existing_type=sa.String(length=32),
        nullable=False,
    )
