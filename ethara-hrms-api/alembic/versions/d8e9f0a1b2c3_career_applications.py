"""career_applications

Revision ID: d8e9f0a1b2c3
Revises: c6d7e8f9a0b1
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d8e9f0a1b2c3"
down_revision: str | None = "c6d7e8f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "career_applications",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("fullName", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=30), nullable=False),
        sa.Column("resumeFileName", sa.String(length=255), nullable=False),
        sa.Column("resumeUrl", sa.String(length=500), nullable=False),
        sa.Column("resumeStoragePath", sa.String(length=500), nullable=True),
        sa.Column("resumeMimeType", sa.String(length=100), nullable=True),
        sa.Column("resumeSize", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_career_applications_email", "career_applications", ["email"])
    op.create_index("ix_career_applications_fullName", "career_applications", ["fullName"])
    op.create_index("ix_career_applications_status", "career_applications", ["status"])
    op.create_index(
        "ix_career_applications_status_created_at",
        "career_applications",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_career_applications_status_created_at", table_name="career_applications")
    op.drop_index("ix_career_applications_status", table_name="career_applications")
    op.drop_index("ix_career_applications_fullName", table_name="career_applications")
    op.drop_index("ix_career_applications_email", table_name="career_applications")
    op.drop_table("career_applications")
