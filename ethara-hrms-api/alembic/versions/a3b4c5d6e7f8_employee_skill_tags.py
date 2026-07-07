"""employee skill tags

Revision ID: a3b4c5d6e7f8
Revises: c1a2b3d4e5f6
Create Date: 2026-06-11
"""

from alembic import op
import sqlalchemy as sa


revision: str = "a3b4c5d6e7f8"
down_revision: str | None = "c1a2b3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employee_skill_tags",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("skill", sa.String(length=50), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("taggedBy", sa.String(length=32), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"]),
        sa.ForeignKeyConstraint(["taggedBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employeeProfileId", "skill", name="uq_employee_skill_tags_employee_skill"),
    )
    op.create_index(op.f("ix_employee_skill_tags_employeeProfileId"), "employee_skill_tags", ["employeeProfileId"])
    op.create_index(op.f("ix_employee_skill_tags_skill"), "employee_skill_tags", ["skill"])


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_skill_tags_skill"), table_name="employee_skill_tags")
    op.drop_index(op.f("ix_employee_skill_tags_employeeProfileId"), table_name="employee_skill_tags")
    op.drop_table("employee_skill_tags")
