"""position approval workflow and PI rounds

Revision ID: c8e1f7a9b4d2
Revises: aa7c4e8d1f22
Create Date: 2026-05-26 13:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c8e1f7a9b4d2"
down_revision: str | None = "aa7c4e8d1f22"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("positions", sa.Column("experienceYears", sa.Integer(), nullable=True))
    op.add_column("positions", sa.Column("salaryBracket", sa.String(length=255), nullable=True))
    op.add_column(
        "positions",
        sa.Column("approvalStatus", sa.String(length=50), nullable=False, server_default="approved"),
    )
    op.add_column("positions", sa.Column("approvalRequestedAt", sa.DateTime(timezone=True), nullable=True))
    op.add_column("positions", sa.Column("approvalDecidedAt", sa.DateTime(timezone=True), nullable=True))
    op.add_column("positions", sa.Column("requestedBy", sa.String(length=32), nullable=True))
    op.add_column("positions", sa.Column("approvedBy", sa.String(length=32), nullable=True))
    op.add_column("positions", sa.Column("rejectionReason", sa.Text(), nullable=True))
    op.add_column("positions", sa.Column("approvalEmailSentAt", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key("fk_positions_requestedBy_users", "positions", "users", ["requestedBy"], ["id"])
    op.create_foreign_key("fk_positions_approvedBy_users", "positions", "users", ["approvedBy"], ["id"])
    op.create_index(op.f("ix_positions_approvalStatus"), "positions", ["approvalStatus"], unique=False)

    op.create_table(
        "pi_interview_rounds",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("evaluationId", sa.String(length=32), nullable=False),
        sa.Column("candidateId", sa.String(length=32), nullable=False),
        sa.Column("evaluatorId", sa.String(length=32), nullable=True),
        sa.Column("roundNumber", sa.Integer(), nullable=False),
        sa.Column("panelLabel", sa.String(length=255), nullable=True),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("scheduledAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("mode", sa.String(length=50), nullable=True),
        sa.Column("durationMinutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("roundDecision", sa.String(length=50), nullable=True),
        sa.Column("noFurtherPiRequired", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("finalVerdict", sa.String(length=50), nullable=True),
        sa.Column("panelMembers", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["candidateId"], ["candidates.id"]),
        sa.ForeignKeyConstraint(["evaluationId"], ["evaluations.id"]),
        sa.ForeignKeyConstraint(["evaluatorId"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pi_interview_rounds_candidateId"), "pi_interview_rounds", ["candidateId"], unique=False)
    op.create_index(op.f("ix_pi_interview_rounds_evaluatorId"), "pi_interview_rounds", ["evaluatorId"], unique=False)
    op.create_index(op.f("ix_pi_interview_rounds_evaluationId"), "pi_interview_rounds", ["evaluationId"], unique=False)
    op.create_index(op.f("ix_pi_interview_rounds_status"), "pi_interview_rounds", ["status"], unique=False)

    op.alter_column("positions", "approvalStatus", server_default=None)
    op.alter_column("pi_interview_rounds", "durationMinutes", server_default=None)
    op.alter_column("pi_interview_rounds", "noFurtherPiRequired", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_pi_interview_rounds_status"), table_name="pi_interview_rounds")
    op.drop_index(op.f("ix_pi_interview_rounds_evaluationId"), table_name="pi_interview_rounds")
    op.drop_index(op.f("ix_pi_interview_rounds_evaluatorId"), table_name="pi_interview_rounds")
    op.drop_index(op.f("ix_pi_interview_rounds_candidateId"), table_name="pi_interview_rounds")
    op.drop_table("pi_interview_rounds")

    op.drop_index(op.f("ix_positions_approvalStatus"), table_name="positions")
    op.drop_constraint("fk_positions_approvedBy_users", "positions", type_="foreignkey")
    op.drop_constraint("fk_positions_requestedBy_users", "positions", type_="foreignkey")
    op.drop_column("positions", "approvalEmailSentAt")
    op.drop_column("positions", "rejectionReason")
    op.drop_column("positions", "approvedBy")
    op.drop_column("positions", "requestedBy")
    op.drop_column("positions", "approvalDecidedAt")
    op.drop_column("positions", "approvalRequestedAt")
    op.drop_column("positions", "approvalStatus")
    op.drop_column("positions", "salaryBracket")
    op.drop_column("positions", "experienceYears")
