"""pms_evaluations_table

Revision ID: b1c2d3e4f5a6
Revises: aa7c4e8d1f22
Create Date: 2026-05-21 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "b1c2d3e4f5a6"
down_revision: str | None = "aa7c4e8d1f22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pms_evaluations",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("candidateId", sa.String(32), sa.ForeignKey("candidates.id"), nullable=False, index=True),
        sa.Column("evaluatorId", sa.String(32), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("verbalClarity", sa.Float(), nullable=True),
        sa.Column("conciseness", sa.Float(), nullable=True),
        sa.Column("fluency", sa.Float(), nullable=True),
        sa.Column("vocabulary", sa.Float(), nullable=True),
        sa.Column("pronunciation", sa.Float(), nullable=True),
        sa.Column("nonverbalConfidence", sa.Float(), nullable=True),
        sa.Column("introBackground", sa.Float(), nullable=True),
        sa.Column("etharaAwareness", sa.Float(), nullable=True),
        sa.Column("currentAffairs", sa.Float(), nullable=True),
        sa.Column("instagramFamiliarity", sa.Float(), nullable=True),
        sa.Column("promptEngineering", sa.Float(), nullable=True),
        sa.Column("videoEditing", sa.Float(), nullable=True),
        sa.Column("metricRemarks", sa.JSON(), nullable=True),
        sa.Column("totalScore", sa.Float(), nullable=True),
        sa.Column("averageScore", sa.Float(), nullable=True),
        sa.Column("overallRating", sa.String(50), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("pms_evaluations")
