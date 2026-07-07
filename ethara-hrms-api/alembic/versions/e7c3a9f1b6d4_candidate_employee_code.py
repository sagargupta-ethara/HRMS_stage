"""candidate sequential employee code (GRP)

Revision ID: e7c3a9f1b6d4
Revises: f4d5e6a7b8c9
Create Date: 2026-06-07

Adds the nullable, unique ``employeeCode`` column to ``candidates``. The GRP code is
allocated when a candidate's contract is signed and carried over to the employee profile
on conversion.
"""

from alembic import op
import sqlalchemy as sa


revision = "e7c3a9f1b6d4"
down_revision = "f4d5e6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column("employeeCode", sa.String(length=64), nullable=True),
    )
    op.create_index(
        op.f("ix_candidates_employeeCode"), "candidates", ["employeeCode"], unique=True
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_candidates_employeeCode"), table_name="candidates")
    op.drop_column("candidates", "employeeCode")
