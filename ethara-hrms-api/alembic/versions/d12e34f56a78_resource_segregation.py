"""resource segregation projects and assignments

Revision ID: d12e34f56a78
Revises: c0ffee9a8b7d
Create Date: 2026-06-09 12:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "d12e34f56a78"
down_revision = "c0ffee9a8b7d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_projects",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("managerId", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("startDate", sa.Date(), nullable=True),
        sa.Column("endDate", sa.Date(), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["managerId"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resource_projects_code", "resource_projects", ["code"], unique=True)
    op.create_index("ix_resource_projects_name", "resource_projects", ["name"], unique=False)
    op.create_index("ix_resource_projects_status", "resource_projects", ["status"], unique=False)
    op.create_index("ix_resource_projects_managerId", "resource_projects", ["managerId"], unique=False)
    op.create_index(
        "ix_resource_projects_manager_status",
        "resource_projects",
        ["managerId", "status"],
        unique=False,
    )

    op.create_table(
        "resource_project_leads",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("projectId", sa.String(length=32), nullable=False),
        sa.Column("userId", sa.String(length=32), nullable=False),
        sa.Column("roleLabel", sa.String(length=30), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["projectId"], ["resource_projects.id"]),
        sa.ForeignKeyConstraint(["userId"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("projectId", "userId", name="uq_resource_project_lead_user"),
    )
    op.create_index(
        "ix_resource_project_leads_projectId",
        "resource_project_leads",
        ["projectId"],
        unique=False,
    )
    op.create_index(
        "ix_resource_project_leads_userId",
        "resource_project_leads",
        ["userId"],
        unique=False,
    )
    op.create_index(
        "ix_resource_project_leads_user_project",
        "resource_project_leads",
        ["userId", "projectId"],
        unique=False,
    )

    op.create_table(
        "resource_assignments",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("projectId", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("reportingMemberProfileId", sa.String(length=32), nullable=True),
        sa.Column("assignedBy", sa.String(length=32), nullable=True),
        sa.Column("assignedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assignedBy"], ["users.id"]),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"]),
        sa.ForeignKeyConstraint(["projectId"], ["resource_projects.id"]),
        sa.ForeignKeyConstraint(["reportingMemberProfileId"], ["employee_profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "employeeProfileId",
            "projectId",
            "status",
            name="uq_resource_assignment_employee_project_status",
        ),
    )
    op.create_index(
        "ix_resource_assignments_employeeProfileId",
        "resource_assignments",
        ["employeeProfileId"],
        unique=False,
    )
    op.create_index(
        "ix_resource_assignments_projectId",
        "resource_assignments",
        ["projectId"],
        unique=False,
    )
    op.create_index(
        "ix_resource_assignments_status",
        "resource_assignments",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_resource_assignments_project_status",
        "resource_assignments",
        ["projectId", "status"],
        unique=False,
    )
    op.create_index(
        "ix_resource_assignments_reporting_member",
        "resource_assignments",
        ["reportingMemberProfileId"],
        unique=False,
    )

    op.create_table(
        "resource_transfer_requests",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("fromProjectId", sa.String(length=32), nullable=False),
        sa.Column("toProjectId", sa.String(length=32), nullable=False),
        sa.Column("reportingMemberProfileId", sa.String(length=32), nullable=True),
        sa.Column("requestedBy", sa.String(length=32), nullable=False),
        sa.Column("reviewerId", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("decidedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decisionComment", sa.Text(), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"]),
        sa.ForeignKeyConstraint(["fromProjectId"], ["resource_projects.id"]),
        sa.ForeignKeyConstraint(["reportingMemberProfileId"], ["employee_profiles.id"]),
        sa.ForeignKeyConstraint(["requestedBy"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewerId"], ["users.id"]),
        sa.ForeignKeyConstraint(["toProjectId"], ["resource_projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_resource_transfer_requests_employeeProfileId",
        "resource_transfer_requests",
        ["employeeProfileId"],
        unique=False,
    )
    op.create_index(
        "ix_resource_transfer_requests_fromProjectId",
        "resource_transfer_requests",
        ["fromProjectId"],
        unique=False,
    )
    op.create_index(
        "ix_resource_transfer_requests_toProjectId",
        "resource_transfer_requests",
        ["toProjectId"],
        unique=False,
    )
    op.create_index(
        "ix_resource_transfer_requests_requestedBy",
        "resource_transfer_requests",
        ["requestedBy"],
        unique=False,
    )
    op.create_index(
        "ix_resource_transfer_requests_reviewerId",
        "resource_transfer_requests",
        ["reviewerId"],
        unique=False,
    )
    op.create_index(
        "ix_resource_transfer_requests_status",
        "resource_transfer_requests",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_resource_transfer_requests_status_reviewer",
        "resource_transfer_requests",
        ["status", "reviewerId"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_resource_transfer_requests_status_reviewer", table_name="resource_transfer_requests")
    op.drop_index("ix_resource_transfer_requests_status", table_name="resource_transfer_requests")
    op.drop_index("ix_resource_transfer_requests_reviewerId", table_name="resource_transfer_requests")
    op.drop_index("ix_resource_transfer_requests_requestedBy", table_name="resource_transfer_requests")
    op.drop_index("ix_resource_transfer_requests_toProjectId", table_name="resource_transfer_requests")
    op.drop_index("ix_resource_transfer_requests_fromProjectId", table_name="resource_transfer_requests")
    op.drop_index("ix_resource_transfer_requests_employeeProfileId", table_name="resource_transfer_requests")
    op.drop_table("resource_transfer_requests")

    op.drop_index("ix_resource_assignments_reporting_member", table_name="resource_assignments")
    op.drop_index("ix_resource_assignments_project_status", table_name="resource_assignments")
    op.drop_index("ix_resource_assignments_status", table_name="resource_assignments")
    op.drop_index("ix_resource_assignments_projectId", table_name="resource_assignments")
    op.drop_index("ix_resource_assignments_employeeProfileId", table_name="resource_assignments")
    op.drop_table("resource_assignments")

    op.drop_index("ix_resource_project_leads_user_project", table_name="resource_project_leads")
    op.drop_index("ix_resource_project_leads_userId", table_name="resource_project_leads")
    op.drop_index("ix_resource_project_leads_projectId", table_name="resource_project_leads")
    op.drop_table("resource_project_leads")

    op.drop_index("ix_resource_projects_manager_status", table_name="resource_projects")
    op.drop_index("ix_resource_projects_managerId", table_name="resource_projects")
    op.drop_index("ix_resource_projects_status", table_name="resource_projects")
    op.drop_index("ix_resource_projects_name", table_name="resource_projects")
    op.drop_index("ix_resource_projects_code", table_name="resource_projects")
    op.drop_table("resource_projects")
