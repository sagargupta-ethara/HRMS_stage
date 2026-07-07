"""candidate_id_card_forms

Revision ID: f5a8c3d1e2b4
Revises: c4d2e8b1f5a7
Create Date: 2026-05-18 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f5a8c3d1e2b4"
down_revision: str | None = "c4d2e8b1f5a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "candidate_id_card_forms",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("candidateId", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("employeeId", sa.String(length=64), nullable=True),
        sa.Column("bloodGroup", sa.String(length=10), nullable=True),
        sa.Column("emergencyNo", sa.String(length=30), nullable=True),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submittedBy", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["candidateId"],
            ["candidates.id"],
            name=op.f("fk_candidate_id_card_forms_candidateId_candidates"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_candidate_id_card_forms")),
        sa.UniqueConstraint("candidateId", name=op.f("uq_candidate_id_card_forms_candidateId")),
    )
    op.create_index(
        op.f("ix_candidate_id_card_forms_candidateId"),
        "candidate_id_card_forms",
        ["candidateId"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_candidate_id_card_forms_candidateId"), table_name="candidate_id_card_forms")
    op.drop_table("candidate_id_card_forms")
