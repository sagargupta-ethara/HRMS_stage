"""manager_leave_assets_offboarding

Revision ID: c4d2e8b1f5a7
Revises: b2f4e1c9d7a3
Create Date: 2026-05-16 10:00:00.000000

Adds manager/office_admin roles, leave management, IT assets, offboarding checklist,
and new fields on employee_profiles (manager_id, blood_group, emergency contact).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4d2e8b1f5a7"
down_revision: str = "e2f3a4b5c6d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employee_profiles", sa.Column("managerId", sa.String(32), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("employee_profiles", sa.Column("bloodGroup", sa.String(10), nullable=True))
    op.add_column("employee_profiles", sa.Column("emergencyContactName", sa.String(255), nullable=True))
    op.add_column("employee_profiles", sa.Column("emergencyContactPhone", sa.String(30), nullable=True))
    op.add_column("employee_profiles", sa.Column("emergencyContactRelation", sa.String(100), nullable=True))
    op.create_index("ix_employee_profiles_managerId", "employee_profiles", ["managerId"])

    op.create_table(
        "leave_balances",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("employeeProfileId", sa.String(32), sa.ForeignKey("employee_profiles.id"), nullable=False),
        sa.Column("leaveType", sa.String(50), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("totalDays", sa.Float(), nullable=False, server_default="0"),
        sa.Column("usedDays", sa.Float(), nullable=False, server_default="0"),
        sa.Column("pendingDays", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_leave_balances_employeeProfileId", "leave_balances", ["employeeProfileId"])
    op.create_index("ix_leave_balances_leaveType", "leave_balances", ["leaveType"])

    op.create_table(
        "leave_requests",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("employeeProfileId", sa.String(32), sa.ForeignKey("employee_profiles.id"), nullable=False),
        sa.Column("leaveType", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("startDate", sa.DateTime(timezone=True), nullable=False),
        sa.Column("endDate", sa.DateTime(timezone=True), nullable=False),
        sa.Column("days", sa.Float(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("managerId", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("managerAction", sa.String(30), nullable=True),
        sa.Column("managerActionAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("managerRemarks", sa.Text(), nullable=True),
        sa.Column("hrReviewedBy", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("hrReviewedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hrRemarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_leave_requests_employeeProfileId", "leave_requests", ["employeeProfileId"])
    op.create_index("ix_leave_requests_leaveType", "leave_requests", ["leaveType"])
    op.create_index("ix_leave_requests_status", "leave_requests", ["status"])

    op.create_table(
        "employee_assets",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("employeeProfileId", sa.String(32), sa.ForeignKey("employee_profiles.id"), nullable=False),
        sa.Column("assetType", sa.String(100), nullable=False),
        sa.Column("model", sa.String(255), nullable=True),
        sa.Column("serialNumber", sa.String(255), nullable=True),
        sa.Column("chargerIssued", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("assetTag", sa.String(100), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="assigned"),
        sa.Column("assignedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignedBy", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("returnedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returnCondition", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_employee_assets_employeeProfileId", "employee_assets", ["employeeProfileId"])
    op.create_index("ix_employee_assets_assetType", "employee_assets", ["assetType"])
    op.create_index("ix_employee_assets_status", "employee_assets", ["status"])

    op.create_table(
        "offboarding_checklists",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("separationId", sa.String(32), sa.ForeignKey("employee_separations.id"), nullable=False),
        sa.Column("employeeProfileId", sa.String(32), sa.ForeignKey("employee_profiles.id"), nullable=False),
        sa.Column("laptopReturned", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("laptopReturnDate", sa.DateTime(timezone=True), nullable=True),
        sa.Column("laptopCondition", sa.String(255), nullable=True),
        sa.Column("idCardReturned", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("idCardReturnDate", sa.DateTime(timezone=True), nullable=True),
        sa.Column("itClearedBy", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("itClearedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("officeAdminClearedBy", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("officeAdminClearedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hrClearedBy", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("hrClearedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_offboarding_checklists_separationId", "offboarding_checklists", ["separationId"], unique=True)
    op.create_index("ix_offboarding_checklists_employeeProfileId", "offboarding_checklists", ["employeeProfileId"])
    op.create_index("ix_offboarding_checklists_status", "offboarding_checklists", ["status"])


def downgrade() -> None:
    op.drop_table("offboarding_checklists")
    op.drop_table("employee_assets")
    op.drop_table("leave_requests")
    op.drop_table("leave_balances")
    op.drop_index("ix_employee_profiles_managerId", table_name="employee_profiles")
    op.drop_column("employee_profiles", "emergencyContactRelation")
    op.drop_column("employee_profiles", "emergencyContactPhone")
    op.drop_column("employee_profiles", "emergencyContactName")
    op.drop_column("employee_profiles", "bloodGroup")
    op.drop_column("employee_profiles", "managerId")
