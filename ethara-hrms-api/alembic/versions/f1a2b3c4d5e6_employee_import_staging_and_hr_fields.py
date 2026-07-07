"""employee_import_staging and HR-only profile fields

Revision ID: f1a2b3c4d5e6
Revises: c9e8f7a6b5d4
Create Date: 2026-06-06 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "c9e8f7a6b5d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # HR/admin-only EmployeeProfile fields (editable only via PATCH /employees/{id}/hr-fields)
    op.add_column("employee_profiles", sa.Column("vendor", sa.String(length=255), nullable=True))
    op.add_column("employee_profiles", sa.Column("employmentStatus", sa.String(length=50), nullable=True))
    op.add_column("employee_profiles", sa.Column("workMode", sa.String(length=50), nullable=True))

    # Pre-loaded employee data staged for merge-on-self-registration (no auth account here).
    op.create_table(
        "employee_import_staging",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("etharaEmail", sa.String(length=255), nullable=True),
        sa.Column("personalEmail", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("employeeCode", sa.String(length=64), nullable=True),
        sa.Column("profileFields", sa.JSON(), nullable=True),
        sa.Column("formData", sa.JSON(), nullable=True),
        sa.Column("aadhaarHash", sa.String(length=64), nullable=True),
        sa.Column("aadhaarLast4", sa.String(length=4), nullable=True),
        sa.Column("documents", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("consumedByProfileId", sa.String(length=32), nullable=True),
        sa.Column("consumedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sourceRow", sa.JSON(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_employee_import_staging_etharaEmail", "employee_import_staging", ["etharaEmail"])
    op.create_index("ix_employee_import_staging_personalEmail", "employee_import_staging", ["personalEmail"])
    op.create_index("ix_employee_import_staging_phone", "employee_import_staging", ["phone"])
    op.create_index("ix_employee_import_staging_employeeCode", "employee_import_staging", ["employeeCode"])
    op.create_index("ix_employee_import_staging_status", "employee_import_staging", ["status"])


def downgrade() -> None:
    op.drop_index("ix_employee_import_staging_status", table_name="employee_import_staging")
    op.drop_index("ix_employee_import_staging_employeeCode", table_name="employee_import_staging")
    op.drop_index("ix_employee_import_staging_phone", table_name="employee_import_staging")
    op.drop_index("ix_employee_import_staging_personalEmail", table_name="employee_import_staging")
    op.drop_index("ix_employee_import_staging_etharaEmail", table_name="employee_import_staging")
    op.drop_table("employee_import_staging")

    op.drop_column("employee_profiles", "workMode")
    op.drop_column("employee_profiles", "employmentStatus")
    op.drop_column("employee_profiles", "vendor")
