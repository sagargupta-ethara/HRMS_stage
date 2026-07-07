"""simplify_reimbursement_categories

Revision ID: c3d5e7f9a1b2
Revises: b2c4d6e8f0a1
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c3d5e7f9a1b2"
down_revision: str | None = "b2c4d6e8f0a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


DEFAULT_CATEGORIES = [
    "Urgent Project Purchases",
    "Food & Logistics",
    "Transportation",
    "Other",
]
LEGACY_MAP = {
    "Urgent Project Purchases (materials, tools, supplies, services)": "Urgent Project Purchases",
    "Food & Logistics for Extended Working Hours": "Food & Logistics",
    "Transportation (Taxi, Public transport, Delivery, Project travel)": "Transportation",
}


def _normalize_categories(value: object) -> list[str]:
    result: list[str] = []
    values = value if isinstance(value, list) else []
    for item in [*DEFAULT_CATEGORIES, *values]:
        text = str(item).strip()
        if not text:
            continue
        text = LEGACY_MAP.get(text, text)
        if not any(existing.lower() == text.lower() for existing in result):
            result.append(text)
    return result


def upgrade() -> None:
    admin_settings = sa.table(
        "admin_settings",
        sa.column("key", sa.String),
        sa.column("namespace", sa.String),
        sa.column("value", sa.JSON),
    )
    bind = op.get_bind()
    row = bind.execute(
        sa.select(admin_settings.c.value).where(admin_settings.c.key == "reimbursements:config")
    ).first()
    if row is None:
        return
    value = row[0]
    if not isinstance(value, dict):
        return
    categories = _normalize_categories(value.get("categories"))
    bind.execute(
        sa.update(admin_settings)
        .where(admin_settings.c.key == "reimbursements:config")
        .values(value={**value, "categories": categories})
    )


def downgrade() -> None:
    pass
