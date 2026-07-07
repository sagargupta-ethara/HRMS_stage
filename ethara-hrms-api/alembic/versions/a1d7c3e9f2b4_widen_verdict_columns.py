"""widen employee assessment/PI verdict columns to text

Revision ID: a1d7c3e9f2b4
Revises: e5c1a9d3f7b2
Create Date: 2026-07-02

The bulk template's Assessment Verdict / PI Verdict cells can carry longer,
free-text values than the original varchar(50). Widen both to TEXT so the upload
accepts whatever is in the CSV. varchar->text is a metadata-only change in
Postgres (no table rewrite) and only relaxes the constraint, so it is safe to
apply to the shared prod DB while the app runs.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a1d7c3e9f2b4"
down_revision = "e5c1a9d3f7b2"
branch_labels = None
depends_on = None

_COLUMNS = ("assessmentVerdict", "piVerdict")


def upgrade() -> None:
    for name in _COLUMNS:
        op.alter_column(
            "employee_profiles",
            name,
            type_=sa.Text(),
            existing_type=sa.String(length=50),
            existing_nullable=True,
        )


def downgrade() -> None:
    for name in _COLUMNS:
        op.alter_column(
            "employee_profiles",
            name,
            type_=sa.String(length=50),
            existing_type=sa.Text(),
            existing_nullable=True,
        )
