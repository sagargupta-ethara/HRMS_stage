"""employee_aadhaar_extracted

Persist the full Aadhaar OCR result (number, DOB, name, status) on the employee
profile at registration — mirroring candidates.aadhaarExtracted. Previously only
last-4 + name were stored and the full number was discarded, forcing a re-OCR at
export time. Storing it once lets the export read it straight from the DB.

Revision ID: a7b8c9d0e1f2
Revises: f2a3b4c5d6e7
Create Date: 2026-06-02 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f2a3b4c5d6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("aadhaarExtracted", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employee_profiles", "aadhaarExtracted")
