"""dinner_requests

Revision ID: d4e6f8a0b2c3
Revises: c3d5e7f9a1b2
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "d4e6f8a0b2c3"
down_revision: str | None = "c3d5e7f9a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dinner_requests",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("requesterUserId", sa.String(length=32), nullable=False),
        sa.Column("requesterEmployeeProfileId", sa.String(length=32), nullable=True),
        sa.Column("requesterName", sa.String(length=255), nullable=False),
        sa.Column("requesterType", sa.String(length=50), nullable=False),
        sa.Column("dinnerDate", sa.Date(), nullable=True),
        sa.Column("projectName", sa.String(length=255), nullable=True),
        sa.Column("teamMemberCount", sa.Integer(), nullable=True),
        sa.Column("teamMemberEmails", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewedBy", sa.String(length=32), nullable=True),
        sa.Column("reviewedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewerComments", sa.Text(), nullable=True),
        sa.Column("completedBy", sa.String(length=32), nullable=True),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("missingFields", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["completedBy"], ["users.id"]),
        sa.ForeignKeyConstraint(["requesterEmployeeProfileId"], ["employee_profiles.id"]),
        sa.ForeignKeyConstraint(["requesterUserId"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewedBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dinner_requests_requesterEmployeeProfileId", "dinner_requests", ["requesterEmployeeProfileId"])
    op.create_index("ix_dinner_requests_requesterUserId", "dinner_requests", ["requesterUserId"])
    op.create_index("ix_dinner_requests_status", "dinner_requests", ["status"])

    op.create_table(
        "dinner_request_action_logs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("dinnerRequestId", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("fromStatus", sa.String(length=50), nullable=True),
        sa.Column("toStatus", sa.String(length=50), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("performedBy", sa.String(length=32), nullable=False),
        sa.Column("performedByName", sa.String(length=255), nullable=True),
        sa.Column("performedByRole", sa.String(length=100), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["dinnerRequestId"], ["dinner_requests.id"]),
        sa.ForeignKeyConstraint(["performedBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dinner_request_action_logs_action", "dinner_request_action_logs", ["action"])
    op.create_index("ix_dinner_request_action_logs_createdAt", "dinner_request_action_logs", ["createdAt"])
    op.create_index("ix_dinner_request_action_logs_dinnerRequestId", "dinner_request_action_logs", ["dinnerRequestId"])
    op.create_index("ix_dinner_request_action_logs_performedBy", "dinner_request_action_logs", ["performedBy"])


def downgrade() -> None:
    op.drop_index("ix_dinner_request_action_logs_performedBy", table_name="dinner_request_action_logs")
    op.drop_index("ix_dinner_request_action_logs_dinnerRequestId", table_name="dinner_request_action_logs")
    op.drop_index("ix_dinner_request_action_logs_createdAt", table_name="dinner_request_action_logs")
    op.drop_index("ix_dinner_request_action_logs_action", table_name="dinner_request_action_logs")
    op.drop_table("dinner_request_action_logs")

    op.drop_index("ix_dinner_requests_status", table_name="dinner_requests")
    op.drop_index("ix_dinner_requests_requesterUserId", table_name="dinner_requests")
    op.drop_index("ix_dinner_requests_requesterEmployeeProfileId", table_name="dinner_requests")
    op.drop_table("dinner_requests")
