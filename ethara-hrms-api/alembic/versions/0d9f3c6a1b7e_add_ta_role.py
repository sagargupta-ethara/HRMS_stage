"""add talent acquisition role

Revision ID: 0d9f3c6a1b7e
Revises: 4ad034192586
Create Date: 2026-05-27 10:56:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0d9f3c6a1b7e"
down_revision: str | Sequence[str] | None = "4ad034192586"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


OLD_ROLE_ENUM = sa.Enum(
    "super_admin",
    "admin",
    "hr",
    "employee",
    "vendor",
    "employee_referrer",
    "evaluator",
    "it_team",
    "compliance",
    "candidate",
    "manager",
    "office_admin",
    name="role",
    native_enum=False,
)

NEW_ROLE_ENUM = sa.Enum(
    "super_admin",
    "admin",
    "hr",
    "ta",
    "employee",
    "vendor",
    "employee_referrer",
    "evaluator",
    "it_team",
    "compliance",
    "candidate",
    "manager",
    "office_admin",
    name="role",
    native_enum=False,
)


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "role",
            existing_type=OLD_ROLE_ENUM,
            type_=NEW_ROLE_ENUM,
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "role",
            existing_type=NEW_ROLE_ENUM,
            type_=OLD_ROLE_ENUM,
            existing_nullable=False,
        )
