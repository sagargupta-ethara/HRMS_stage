"""aadhaar_name_validation

Revision ID: a1b2c3d4e5f6
Revises: f4c3b2a1d9e8
Create Date: 2026-05-15 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "f4c3b2a1d9e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.add_column(sa.Column("aadhaarOcrName", sa.String(255), nullable=True))
        batch_op.add_column(sa.Column("aadhaarValidationStatus", sa.String(50), nullable=True))
        batch_op.add_column(sa.Column("aadhaarMismatchReason", sa.Text(), nullable=True))

    with op.batch_alter_table("employee_profiles") as batch_op:
        batch_op.add_column(sa.Column("aadhaarOcrName", sa.String(255), nullable=True))
        batch_op.add_column(sa.Column("aadhaarValidationStatus", sa.String(50), nullable=True))
        batch_op.add_column(sa.Column("aadhaarMismatchReason", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("employee_profiles") as batch_op:
        batch_op.drop_column("aadhaarMismatchReason")
        batch_op.drop_column("aadhaarValidationStatus")
        batch_op.drop_column("aadhaarOcrName")

    with op.batch_alter_table("candidates") as batch_op:
        batch_op.drop_column("aadhaarMismatchReason")
        batch_op.drop_column("aadhaarValidationStatus")
        batch_op.drop_column("aadhaarOcrName")
