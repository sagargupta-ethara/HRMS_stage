"""merge_heads_aadhaar_name

Revision ID: ca152206751b
Revises: 2c6d4ef53e22, a1b2c3d4e5f6
Create Date: 2026-05-14 19:55:07.410393
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa



# revision identifiers, used by Alembic.
revision: str = 'ca152206751b'
down_revision: str | None = ('2c6d4ef53e22', 'a1b2c3d4e5f6')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

