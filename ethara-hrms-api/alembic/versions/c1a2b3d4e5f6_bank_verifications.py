"""bank_verifications (penny-drop bank account verification)

Revision ID: c1a2b3d4e5f6
Revises: b7d4e2f9a1c8
Create Date: 2026-06-10 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c1a2b3d4e5f6"
down_revision: str | None = "b7d4e2f9a1c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bank_verifications",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column(
            "employeeProfileId",
            sa.String(length=32),
            sa.ForeignKey("employee_profiles.id"),
            nullable=False,
        ),
        sa.Column("etharaEmail", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("exportedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validatedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updatedBy", sa.String(length=32), nullable=True),
        sa.Column("updatedByName", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_unique_constraint(
        "uq_bank_verifications_employeeProfileId", "bank_verifications", ["employeeProfileId"]
    )
    op.create_index(
        "ix_bank_verifications_etharaEmail", "bank_verifications", ["etharaEmail"]
    )
    op.create_index("ix_bank_verifications_status", "bank_verifications", ["status"])


def downgrade() -> None:
    op.drop_index("ix_bank_verifications_status", table_name="bank_verifications")
    op.drop_index("ix_bank_verifications_etharaEmail", table_name="bank_verifications")
    op.drop_constraint(
        "uq_bank_verifications_employeeProfileId", "bank_verifications", type_="unique"
    )
    op.drop_table("bank_verifications")
