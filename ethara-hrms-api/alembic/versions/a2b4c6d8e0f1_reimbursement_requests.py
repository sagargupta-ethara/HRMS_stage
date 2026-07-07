"""reimbursement_requests

Revision ID: a2b4c6d8e0f1
Revises: e9f0a1b2c3d4
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a2b4c6d8e0f1"
down_revision: str | None = "e9f0a1b2c3d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reimbursement_requests",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("employeeName", sa.String(length=255), nullable=False),
        sa.Column("employeeCode", sa.String(length=64), nullable=False),
        sa.Column("department", sa.String(length=255), nullable=True),
        sa.Column("projectName", sa.String(length=255), nullable=True),
        sa.Column("category", sa.String(length=255), nullable=True),
        sa.Column("expenseDate", sa.Date(), nullable=True),
        sa.Column("expenseAmount", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("paymentMethod", sa.String(length=100), nullable=True),
        sa.Column("receiptFileName", sa.String(length=255), nullable=True),
        sa.Column("receiptFileUrl", sa.String(length=500), nullable=True),
        sa.Column("receiptMimeType", sa.String(length=255), nullable=True),
        sa.Column("receiptFileSize", sa.Integer(), nullable=True),
        sa.Column("declarationAccepted", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=80), nullable=False),
        sa.Column("managerId", sa.String(length=32), nullable=True),
        sa.Column("managerReviewedBy", sa.String(length=32), nullable=True),
        sa.Column("managerReviewedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("managerComments", sa.Text(), nullable=True),
        sa.Column("financeReviewedBy", sa.String(length=32), nullable=True),
        sa.Column("financeReviewedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("financeComments", sa.Text(), nullable=True),
        sa.Column("paidBy", sa.String(length=32), nullable=True),
        sa.Column("paidAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("missingFields", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"]),
        sa.ForeignKeyConstraint(["financeReviewedBy"], ["users.id"]),
        sa.ForeignKeyConstraint(["managerId"], ["users.id"]),
        sa.ForeignKeyConstraint(["managerReviewedBy"], ["users.id"]),
        sa.ForeignKeyConstraint(["paidBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reimbursement_requests_category", "reimbursement_requests", ["category"])
    op.create_index("ix_reimbursement_requests_employeeCode", "reimbursement_requests", ["employeeCode"])
    op.create_index("ix_reimbursement_requests_employeeProfileId", "reimbursement_requests", ["employeeProfileId"])
    op.create_index("ix_reimbursement_requests_managerId", "reimbursement_requests", ["managerId"])
    op.create_index("ix_reimbursement_requests_status", "reimbursement_requests", ["status"])

    op.create_table(
        "reimbursement_action_logs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("reimbursementId", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("fromStatus", sa.String(length=80), nullable=True),
        sa.Column("toStatus", sa.String(length=80), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("performedBy", sa.String(length=32), nullable=False),
        sa.Column("performedByName", sa.String(length=255), nullable=True),
        sa.Column("performedByRole", sa.String(length=100), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["performedBy"], ["users.id"]),
        sa.ForeignKeyConstraint(["reimbursementId"], ["reimbursement_requests.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reimbursement_action_logs_action", "reimbursement_action_logs", ["action"])
    op.create_index("ix_reimbursement_action_logs_createdAt", "reimbursement_action_logs", ["createdAt"])
    op.create_index("ix_reimbursement_action_logs_performedBy", "reimbursement_action_logs", ["performedBy"])
    op.create_index("ix_reimbursement_action_logs_reimbursementId", "reimbursement_action_logs", ["reimbursementId"])


def downgrade() -> None:
    op.drop_index("ix_reimbursement_action_logs_reimbursementId", table_name="reimbursement_action_logs")
    op.drop_index("ix_reimbursement_action_logs_performedBy", table_name="reimbursement_action_logs")
    op.drop_index("ix_reimbursement_action_logs_createdAt", table_name="reimbursement_action_logs")
    op.drop_index("ix_reimbursement_action_logs_action", table_name="reimbursement_action_logs")
    op.drop_table("reimbursement_action_logs")

    op.drop_index("ix_reimbursement_requests_status", table_name="reimbursement_requests")
    op.drop_index("ix_reimbursement_requests_managerId", table_name="reimbursement_requests")
    op.drop_index("ix_reimbursement_requests_employeeProfileId", table_name="reimbursement_requests")
    op.drop_index("ix_reimbursement_requests_employeeCode", table_name="reimbursement_requests")
    op.drop_index("ix_reimbursement_requests_category", table_name="reimbursement_requests")
    op.drop_table("reimbursement_requests")
