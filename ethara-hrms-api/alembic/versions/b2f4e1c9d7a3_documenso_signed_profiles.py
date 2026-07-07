"""documenso_signed_profiles

Revision ID: b2f4e1c9d7a3
Revises: a3c1d9e7f820
Create Date: 2026-05-15 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2f4e1c9d7a3"
down_revision: str = "a3c1d9e7f820"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "documenso_signed_profiles",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("documensoDocId", sa.Integer(), nullable=False),
        sa.Column("templateId", sa.Integer(), nullable=True),
        sa.Column("templateTitle", sa.String(500), nullable=True),
        sa.Column("recipientEmail", sa.String(255), nullable=False),
        sa.Column("recipientName", sa.String(255), nullable=True),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fieldValues", sa.JSON(), nullable=True),
        sa.Column("rawFields", sa.JSON(), nullable=True),
        sa.Column("pdfUrl", sa.String(500), nullable=True),
        sa.Column(
            "candidateId",
            sa.String(32),
            sa.ForeignKey("candidates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("syncedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_documenso_signed_profiles_documensoDocId",
        "documenso_signed_profiles",
        ["documensoDocId"],
        unique=True,
    )
    op.create_index(
        "ix_documenso_signed_profiles_recipientEmail",
        "documenso_signed_profiles",
        ["recipientEmail"],
    )
    op.create_index(
        "ix_documenso_signed_profiles_templateId",
        "documenso_signed_profiles",
        ["templateId"],
    )
    op.create_index(
        "ix_documenso_signed_profiles_completedAt",
        "documenso_signed_profiles",
        ["completedAt"],
    )
    op.create_index(
        "ix_documenso_signed_profiles_candidateId",
        "documenso_signed_profiles",
        ["candidateId"],
    )


def downgrade() -> None:
    op.drop_table("documenso_signed_profiles")
