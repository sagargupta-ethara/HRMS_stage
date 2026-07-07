"""employee-level evaluation score fields (candidate eval / assessment / PI)

Revision ID: e5c1a9d3f7b2
Revises: b8f3a1c9d2e7
Create Date: 2026-07-02

Additive-only. Adds nullable employee-level override columns so the bulk template
can populate Candidate Evaluation Score, Assessment score/verdict and PI
score/verdict per employee (blank cells are left untouched). The profile shows
the employee value when set, otherwise falls back to the linked candidate's
recruitment record. Safe to apply to the shared prod DB while the app runs.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e5c1a9d3f7b2"
down_revision = "b8f3a1c9d2e7"
branch_labels = None
depends_on = None

_COLUMNS = [
    ("candidateEvaluationScore", sa.Float()),
    ("assessmentScore", sa.Float()),
    ("assessmentVerdict", sa.String(length=50)),
    ("piScore", sa.Float()),
    ("piVerdict", sa.String(length=50)),
]


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("employee_profiles")}
    for name, coltype in _COLUMNS:
        if name not in existing:
            op.add_column("employee_profiles", sa.Column(name, coltype, nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("employee_profiles")}
    for name, _ in reversed(_COLUMNS):
        if name in existing:
            op.drop_column("employee_profiles", name)
