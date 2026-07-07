"""enable_reimbursement_modules

Revision ID: b2c4d6e8f0a1
Revises: a2b4c6d8e0f1
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "b2c4d6e8f0a1"
down_revision: str | None = "a2b4c6d8e0f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ROLE_DEFAULTS = {
    "hr",
    "ta",
    "evaluator",
    "it_team",
    "compliance",
    "manager",
    "office_admin",
    "employee",
    "employee_referrer",
}


def upgrade() -> None:
    admin_settings = sa.table(
        "admin_settings",
        sa.column("key", sa.String),
        sa.column("namespace", sa.String),
        sa.column("value", sa.JSON),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(admin_settings.c.key, admin_settings.c.value).where(
            admin_settings.c.namespace == "role_modules",
            admin_settings.c.key.like("role_modules:%"),
        )
    ).mappings()
    for row in rows:
        role = row["key"].split(":", 1)[1]
        value = row["value"]
        if role not in ROLE_DEFAULTS or not isinstance(value, dict):
            continue
        enabled = value.get("enabled")
        if not isinstance(enabled, list) or "reimbursements" in enabled:
            continue
        bind.execute(
            sa.update(admin_settings)
            .where(admin_settings.c.key == row["key"])
            .values(value={**value, "enabled": [*enabled, "reimbursements"]})
        )


def downgrade() -> None:
    admin_settings = sa.table(
        "admin_settings",
        sa.column("key", sa.String),
        sa.column("namespace", sa.String),
        sa.column("value", sa.JSON),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(admin_settings.c.key, admin_settings.c.value).where(
            admin_settings.c.namespace == "role_modules",
            admin_settings.c.key.like("role_modules:%"),
        )
    ).mappings()
    for row in rows:
        value = row["value"]
        enabled = value.get("enabled") if isinstance(value, dict) else None
        if not isinstance(enabled, list) or "reimbursements" not in enabled:
            continue
        bind.execute(
            sa.update(admin_settings)
            .where(admin_settings.c.key == row["key"])
            .values(value={**value, "enabled": [item for item in enabled if item != "reimbursements"]})
        )
