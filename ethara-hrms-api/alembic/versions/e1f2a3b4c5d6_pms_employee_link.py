"""pms_employee_link

Add employeeId to pms_evaluations and make candidateId nullable so PMS can target
employees (candidates who have been converted to employees) instead of candidates.

Revision ID: e1f2a3b4c5d6
Revises: d7e9a1c3b5f2
Create Date: 2026-06-02 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "d7e9a1c3b5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("pms_evaluations", sa.Column("employeeId", sa.String(32), nullable=True))
    op.create_index("ix_pms_evaluations_employeeId", "pms_evaluations", ["employeeId"])
    op.create_foreign_key(
        "fk_pms_evaluations_employeeId_employee_profiles",
        "pms_evaluations",
        "employee_profiles",
        ["employeeId"],
        ["id"],
    )
    op.alter_column("pms_evaluations", "candidateId", existing_type=sa.String(32), nullable=True)


def downgrade() -> None:
    op.alter_column("pms_evaluations", "candidateId", existing_type=sa.String(32), nullable=False)
    op.drop_constraint(
        "fk_pms_evaluations_employeeId_employee_profiles", "pms_evaluations", type_="foreignkey"
    )
    op.drop_index("ix_pms_evaluations_employeeId", table_name="pms_evaluations")
    op.drop_column("pms_evaluations", "employeeId")
