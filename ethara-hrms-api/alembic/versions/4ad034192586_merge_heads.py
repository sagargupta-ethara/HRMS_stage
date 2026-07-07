"""merge heads

Revision ID: 4ad034192586
Revises: b1c2d3e4f5a6, c8e1f7a9b4d2
Create Date: 2026-05-26 18:49:56.999403
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa



# revision identifiers, used by Alembic.
revision: str = '4ad034192586'
down_revision: str | None = ('b1c2d3e4f5a6', 'c8e1f7a9b4d2')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

