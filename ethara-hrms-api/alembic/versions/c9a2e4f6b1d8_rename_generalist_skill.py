"""normalize legacy 'generalist' skill tags to 'generalist_foundation'

Revision ID: c9a2e4f6b1d8
Revises: a1d7c3e9f2b4
Create Date: 2026-07-02

Data-only cleanup, applied WITH the Employee Evaluation code deploy (not before).
Until it runs, the new code aliases 'generalist' -> 'generalist_foundation' on read,
so nothing depends on this having been applied. It just tidies the stored keys.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c9a2e4f6b1d8"
down_revision = "a1d7c3e9f2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Drop legacy 'generalist' rows for employees who ALSO already have a
    # 'generalist_foundation' row (the unique (employee, skill) constraint would
    # otherwise block the rename).
    bind.execute(
        sa.text(
            'DELETE FROM employee_skill_tags legacy '
            'WHERE legacy.skill = \'generalist\' '
            'AND EXISTS (SELECT 1 FROM employee_skill_tags cur '
            '            WHERE cur."employeeProfileId" = legacy."employeeProfileId" '
            '            AND cur.skill = \'generalist_foundation\')'
        )
    )
    bind.execute(
        sa.text("UPDATE employee_skill_tags SET skill = 'generalist_foundation' WHERE skill = 'generalist'")
    )


def downgrade() -> None:
    # One-way normalization; nothing to safely restore (originals are indistinguishable).
    pass
