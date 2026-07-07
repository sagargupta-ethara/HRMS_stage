"""merge_employee_and_screening_heads

Revision ID: e6f3a1b7c2d4
Revises: 87f282719d49, b9c9d1a2f4ab
Create Date: 2026-05-13 15:05:00.000000
"""

from collections.abc import Sequence


revision: str = "e6f3a1b7c2d4"
down_revision: tuple[str, str] = ("87f282719d49", "b9c9d1a2f4ab")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
