"""candidate_assessments

Revision ID: d1e2f3a4b5c6
Revises: b2f4e1c9d7a3
Create Date: 2026-05-16 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "d1e2f3a4b5c6"
down_revision: str | None = "b2f4e1c9d7a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "candidate_assessments",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("candidateId", sa.String(32), sa.ForeignKey("candidates.id"), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("deployedUrl", sa.String(500), nullable=True),
        sa.Column("repoUrl", sa.String(500), nullable=True),
        sa.Column("readmePath", sa.String(500), nullable=True),
        sa.Column("explanationVideoPath", sa.String(500), nullable=True),
        sa.Column("communicationVideoPath", sa.String(500), nullable=True),
        sa.Column("promptResponse", sa.Text(), nullable=True),
        sa.Column("autoScore", sa.Float(), nullable=True),
        sa.Column("evaluatorScore", sa.Float(), nullable=True),
        sa.Column("totalScore", sa.Float(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("decision", sa.String(20), nullable=True),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evaluatedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evaluatorId", sa.String(32), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_candidate_assessments_candidateId", "candidate_assessments", ["candidateId"])
    op.create_index("ix_candidate_assessments_level", "candidate_assessments", ["level"])
    op.create_index("ix_candidate_assessments_status", "candidate_assessments", ["status"])


def downgrade() -> None:
    op.drop_index("ix_candidate_assessments_status", table_name="candidate_assessments")
    op.drop_index("ix_candidate_assessments_level", table_name="candidate_assessments")
    op.drop_index("ix_candidate_assessments_candidateId", table_name="candidate_assessments")
    op.drop_table("candidate_assessments")
