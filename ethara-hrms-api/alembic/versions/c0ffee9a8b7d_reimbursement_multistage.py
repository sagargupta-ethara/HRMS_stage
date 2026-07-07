"""reimbursement multi-stage approval (HR + Leadership + acknowledge)

Revision ID: c0ffee9a8b7d
Revises: dbe34f567a89
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c0ffee9a8b7d"
down_revision: str | None = "dbe34f567a89"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reimbursement_requests", sa.Column("hrReviewedBy", sa.String(32), nullable=True))
    op.add_column("reimbursement_requests", sa.Column("hrReviewedAt", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reimbursement_requests", sa.Column("hrComments", sa.Text(), nullable=True))
    op.add_column("reimbursement_requests", sa.Column("leadershipReviewedBy", sa.String(32), nullable=True))
    op.add_column("reimbursement_requests", sa.Column("leadershipReviewedAt", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reimbursement_requests", sa.Column("leadershipComments", sa.Text(), nullable=True))
    op.add_column("reimbursement_requests", sa.Column("acknowledgedAt", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key("fk_reimb_hrReviewedBy_users", "reimbursement_requests", "users", ["hrReviewedBy"], ["id"])
    op.create_foreign_key("fk_reimb_leadershipReviewedBy_users", "reimbursement_requests", "users", ["leadershipReviewedBy"], ["id"])


def downgrade() -> None:
    op.drop_constraint("fk_reimb_leadershipReviewedBy_users", "reimbursement_requests", type_="foreignkey")
    op.drop_constraint("fk_reimb_hrReviewedBy_users", "reimbursement_requests", type_="foreignkey")
    op.drop_column("reimbursement_requests", "acknowledgedAt")
    op.drop_column("reimbursement_requests", "leadershipComments")
    op.drop_column("reimbursement_requests", "leadershipReviewedAt")
    op.drop_column("reimbursement_requests", "leadershipReviewedBy")
    op.drop_column("reimbursement_requests", "hrComments")
    op.drop_column("reimbursement_requests", "hrReviewedAt")
    op.drop_column("reimbursement_requests", "hrReviewedBy")
