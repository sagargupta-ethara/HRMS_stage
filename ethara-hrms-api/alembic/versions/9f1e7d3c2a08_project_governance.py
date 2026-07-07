"""project governance & budget management

Revision ID: 9f1e7d3c2a08
Revises: a3b4c5d6e7f8
Create Date: 2026-06-15
"""

from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa


revision: str = "9f1e7d3c2a08"
down_revision: str | None = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- projects (Project Master) ---------------------------------------
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("internalName", sa.String(length=255), nullable=False),
        sa.Column("externalName", sa.String(length=255), nullable=True),
        sa.Column("client", sa.String(length=255), nullable=True),
        sa.Column("platform", sa.String(length=120), nullable=True),
        sa.Column("projectType", sa.String(length=20), nullable=False, server_default="technical"),
        sa.Column("rfpStatus", sa.String(length=20), nullable=False, server_default="rfp"),
        sa.Column("deliveryStatus", sa.String(length=20), nullable=False, server_default="ongoing"),
        sa.Column("appsheetApproval", sa.String(length=40), nullable=True),
        sa.Column("trajectoryCostApproval", sa.String(length=40), nullable=True),
        sa.Column("aht", sa.Float(), nullable=True),
        sa.Column("targetVolume", sa.Integer(), nullable=True),
        sa.Column("deliveredVolume", sa.Integer(), nullable=True),
        sa.Column("dateOfDelivery", sa.Date(), nullable=True),
        sa.Column("tpmUserId", sa.String(length=32), nullable=True),
        sa.Column("fteDemand", sa.Integer(), nullable=True),
        sa.Column("fteCount", sa.Integer(), nullable=True),
        sa.Column("internCount", sa.Integer(), nullable=True),
        sa.Column("totalMembers", sa.Integer(), nullable=True),
        sa.Column("approvedBudget", sa.Float(), nullable=True),
        sa.Column("consumedBudget", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="INR"),
        sa.Column("isArchived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("customFields", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("createdBy", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tpmUserId"], ["users.id"], name="fk_projects_tpmUserId_users"),
        sa.ForeignKeyConstraint(["createdBy"], ["users.id"], name="fk_projects_createdBy_users"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_projects_internalName"), "projects", ["internalName"])
    op.create_index(op.f("ix_projects_client"), "projects", ["client"])
    op.create_index(op.f("ix_projects_projectType"), "projects", ["projectType"])
    op.create_index(op.f("ix_projects_rfpStatus"), "projects", ["rfpStatus"])
    op.create_index(op.f("ix_projects_deliveryStatus"), "projects", ["deliveryStatus"])
    op.create_index(op.f("ix_projects_tpmUserId"), "projects", ["tpmUserId"])
    op.create_index(op.f("ix_projects_isArchived"), "projects", ["isArchived"])
    op.create_index("ix_projects_type_status", "projects", ["projectType", "rfpStatus"])

    # --- project_leads (TPM/PL ownership) --------------------------------
    op.create_table(
        "project_leads",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("projectId", sa.String(length=32), nullable=False),
        sa.Column("userId", sa.String(length=32), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="pl"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["projectId"], ["projects.id"], name="fk_project_leads_projectId_projects"),
        sa.ForeignKeyConstraint(["userId"], ["users.id"], name="fk_project_leads_userId_users"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("projectId", "userId", "role", name="uq_project_leads_project_user_role"),
    )
    op.create_index(op.f("ix_project_leads_projectId"), "project_leads", ["projectId"])
    op.create_index(op.f("ix_project_leads_userId"), "project_leads", ["userId"])
    op.create_index("ix_project_leads_user", "project_leads", ["userId"])

    # --- project_field_defs (configurable columns) -----------------------
    op.create_table(
        "project_field_defs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("dataType", sa.String(length=20), nullable=False, server_default="text"),
        sa.Column("options", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("orderIndex", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("group", sa.String(length=80), nullable=True),
        sa.Column("isActive", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("createdBy", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_project_field_defs_key"),
    )
    op.create_index(op.f("ix_project_field_defs_key"), "project_field_defs", ["key"])
    op.create_index(op.f("ix_project_field_defs_orderIndex"), "project_field_defs", ["orderIndex"])
    op.create_index(op.f("ix_project_field_defs_isActive"), "project_field_defs", ["isActive"])

    # --- project_budgets (proposals + two-stage approval) ----------------
    op.create_table(
        "project_budgets",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("projectId", sa.String(length=32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="INR"),
        sa.Column("period", sa.String(length=40), nullable=True),
        sa.Column("justification", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="draft"),
        sa.Column("proposedBy", sa.String(length=32), nullable=True),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("functionalApproverId", sa.String(length=32), nullable=True),
        sa.Column("functionalDecidedBy", sa.String(length=32), nullable=True),
        sa.Column("functionalDecidedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("functionalDecision", sa.String(length=20), nullable=True),
        sa.Column("functionalComment", sa.Text(), nullable=True),
        sa.Column("functionalTokenHash", sa.String(length=128), nullable=True),
        sa.Column("functionalTokenExpiresAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("leadershipDecidedBy", sa.String(length=32), nullable=True),
        sa.Column("leadershipDecidedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("leadershipDecision", sa.String(length=20), nullable=True),
        sa.Column("leadershipComment", sa.Text(), nullable=True),
        sa.Column("leadershipTokenHash", sa.String(length=128), nullable=True),
        sa.Column("leadershipTokenExpiresAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["projectId"], ["projects.id"], name="fk_project_budgets_projectId_projects"),
        sa.ForeignKeyConstraint(["proposedBy"], ["users.id"], name="fk_project_budgets_proposedBy_users"),
        sa.ForeignKeyConstraint(["functionalApproverId"], ["users.id"], name="fk_project_budgets_functionalApproverId_users"),
        sa.ForeignKeyConstraint(["functionalDecidedBy"], ["users.id"], name="fk_project_budgets_functionalDecidedBy_users"),
        sa.ForeignKeyConstraint(["leadershipDecidedBy"], ["users.id"], name="fk_project_budgets_leadershipDecidedBy_users"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_project_budgets_projectId"), "project_budgets", ["projectId"])
    op.create_index(op.f("ix_project_budgets_status"), "project_budgets", ["status"])
    op.create_index("ix_project_budgets_project_status", "project_budgets", ["projectId", "status"])

    # --- project_budget_action_logs (approval audit trail) ---------------
    op.create_table(
        "project_budget_action_logs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("budgetId", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("stage", sa.String(length=40), nullable=True),
        sa.Column("fromStatus", sa.String(length=40), nullable=True),
        sa.Column("toStatus", sa.String(length=40), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("performedBy", sa.String(length=32), nullable=False),
        sa.Column("performedByName", sa.String(length=255), nullable=True),
        sa.Column("performedByRole", sa.String(length=100), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["budgetId"], ["project_budgets.id"], name="fk_project_budget_action_logs_budgetId_project_budgets"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_project_budget_action_logs_budgetId"), "project_budget_action_logs", ["budgetId"])
    op.create_index(op.f("ix_project_budget_action_logs_action"), "project_budget_action_logs", ["action"])
    op.create_index(op.f("ix_project_budget_action_logs_createdAt"), "project_budget_action_logs", ["createdAt"])

    # --- expense linkage: reimbursement & dinner -> project --------------
    op.add_column("reimbursement_requests", sa.Column("projectId", sa.String(length=32), nullable=True))
    op.create_foreign_key(
        "fk_reimbursement_requests_projectId_projects",
        "reimbursement_requests", "projects", ["projectId"], ["id"],
    )
    op.create_index(op.f("ix_reimbursement_requests_projectId"), "reimbursement_requests", ["projectId"])

    op.add_column("dinner_requests", sa.Column("projectId", sa.String(length=32), nullable=True))
    op.add_column("dinner_requests", sa.Column("amount", sa.Float(), nullable=True))
    op.create_foreign_key(
        "fk_dinner_requests_projectId_projects",
        "dinner_requests", "projects", ["projectId"], ["id"],
    )
    op.create_index(op.f("ix_dinner_requests_projectId"), "dinner_requests", ["projectId"])

    # --- seed configurable columns for the sheet's volatile metrics ------
    now = datetime.now(UTC)
    field_defs = sa.table(
        "project_field_defs",
        sa.column("id", sa.String),
        sa.column("key", sa.String),
        sa.column("label", sa.String),
        sa.column("dataType", sa.String),
        sa.column("options", sa.JSON),
        sa.column("orderIndex", sa.Integer),
        sa.column("group", sa.String),
        sa.column("isActive", sa.Boolean),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    seeded = [
        ("claude_subscriptions", "Claude Subscriptions", "number"),
        ("open_router", "Open Router", "number"),
        ("open_ai", "Open AI", "number"),
        ("fiverr", "Fiverr", "currency"),
        ("no_of_submissions", "No. of Submissions", "number"),
        ("mm_submissions", "MM Submissions", "number"),
    ]
    op.bulk_insert(
        field_defs,
        [
            {
                "id": f"seedfield{idx:023d}",
                "key": key,
                "label": label,
                "dataType": dtype,
                "options": [],
                "orderIndex": idx + 1,
                "group": "Costs & Metrics",
                "isActive": True,
                "created_at": now,
                "updated_at": now,
            }
            for idx, (key, label, dtype) in enumerate(seeded)
        ],
    )

    # --- best-effort backfill of project_id from the old free-text name --
    op.execute(
        """
        UPDATE reimbursement_requests r
        SET "projectId" = p.id
        FROM projects p
        WHERE r."projectId" IS NULL AND r."projectName" IS NOT NULL
          AND (
            lower(btrim(r."projectName")) = lower(btrim(p."internalName"))
            OR lower(btrim(r."projectName")) = lower(btrim(p."externalName"))
          )
        """
    )
    op.execute(
        """
        UPDATE dinner_requests d
        SET "projectId" = p.id
        FROM projects p
        WHERE d."projectId" IS NULL AND d."projectName" IS NOT NULL
          AND (
            lower(btrim(d."projectName")) = lower(btrim(p."internalName"))
            OR lower(btrim(d."projectName")) = lower(btrim(p."externalName"))
          )
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_dinner_requests_projectId"), table_name="dinner_requests")
    op.drop_constraint("fk_dinner_requests_projectId_projects", "dinner_requests", type_="foreignkey")
    op.drop_column("dinner_requests", "amount")
    op.drop_column("dinner_requests", "projectId")

    op.drop_index(op.f("ix_reimbursement_requests_projectId"), table_name="reimbursement_requests")
    op.drop_constraint("fk_reimbursement_requests_projectId_projects", "reimbursement_requests", type_="foreignkey")
    op.drop_column("reimbursement_requests", "projectId")

    op.drop_table("project_budget_action_logs")
    op.drop_table("project_budgets")
    op.drop_table("project_field_defs")
    op.drop_table("project_leads")
    op.drop_table("projects")
