"""career_application referral fields + nullable resume

Revision ID: dbe34f567a89
Revises: cae12b34d56f
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "dbe34f567a89"
down_revision: str | None = "cae12b34d56f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("career_applications", sa.Column("referredById", sa.String(32), nullable=True))
    op.add_column("career_applications", sa.Column("referredByName", sa.String(255), nullable=True))
    op.create_index(
        "ix_career_applications_referredById", "career_applications", ["referredById"]
    )
    op.create_foreign_key(
        "fk_career_applications_referredById_users",
        "career_applications",
        "users",
        ["referredById"],
        ["id"],
    )
    op.alter_column("career_applications", "resumeFileName", existing_type=sa.String(255), nullable=True)
    op.alter_column("career_applications", "resumeUrl", existing_type=sa.String(500), nullable=True)


def downgrade() -> None:
    op.alter_column("career_applications", "resumeUrl", existing_type=sa.String(500), nullable=False)
    op.alter_column("career_applications", "resumeFileName", existing_type=sa.String(255), nullable=False)
    op.drop_constraint("fk_career_applications_referredById_users", "career_applications", type_="foreignkey")
    op.drop_index("ix_career_applications_referredById", table_name="career_applications")
    op.drop_column("career_applications", "referredByName")
    op.drop_column("career_applications", "referredById")
