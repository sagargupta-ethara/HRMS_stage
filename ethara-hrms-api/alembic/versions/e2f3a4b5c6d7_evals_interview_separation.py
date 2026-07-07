"""evals_interview_separation

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-05-17 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "e2f3a4b5c6d7"
down_revision: str | None = "d1e2f3a4b5c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("evaluations") as batch_op:
        batch_op.add_column(sa.Column("interviewMode", sa.String(50), nullable=True))
        batch_op.add_column(sa.Column("piScore", sa.Float(), nullable=True))

    op.create_table(
        "employee_separations",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("employeeProfileId", sa.String(32), sa.ForeignKey("employee_profiles.id"), nullable=False),
        sa.Column("separationType", sa.String(30), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("earlyRelievingRequested", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("appliedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lastWorkingDay", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effectiveDate", sa.DateTime(timezone=True), nullable=True),
        sa.Column("managerId", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("managerRemarks", sa.Text(), nullable=True),
        sa.Column("managerAction", sa.String(30), nullable=True),
        sa.Column("managerActionAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewedBy", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_employee_separations_employeeProfileId", "employee_separations", ["employeeProfileId"])
    op.create_index("ix_employee_separations_status", "employee_separations", ["status"])
    op.create_index("ix_employee_separations_separationType", "employee_separations", ["separationType"])


def downgrade() -> None:
    op.drop_index("ix_employee_separations_separationType", table_name="employee_separations")
    op.drop_index("ix_employee_separations_status", table_name="employee_separations")
    op.drop_index("ix_employee_separations_employeeProfileId", table_name="employee_separations")
    op.drop_table("employee_separations")

    with op.batch_alter_table("evaluations") as batch_op:
        batch_op.drop_column("piScore")
        batch_op.drop_column("interviewMode")
