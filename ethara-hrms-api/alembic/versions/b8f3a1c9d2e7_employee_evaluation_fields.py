"""employee evaluation fields: skill_catalog table, training score, evaluation verdict

Revision ID: b8f3a1c9d2e7
Revises: 7b3e9c1a2f48
Create Date: 2026-07-02

Additive-only migration for the Employee Evaluation module. Safe to apply to the
shared production database while the current app is running:

  * new table ``skill_catalog`` -- the running app uses its own hardcoded skill
    list and never touches this table;
  * two new NULLABLE columns on ``employee_profiles`` -- SQLAlchemy selects
    explicit column lists and inserts omit them, so old code is unaffected;
  * a one-time backfill marking every existing employee's evaluation verdict as
    "pass" (they are already employees).

It deliberately does NOT migrate the legacy ``generalist`` skill-tag rows; that
data change ships together with the new serialization code so the live app never
sees a skill key it does not understand.
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b8f3a1c9d2e7"
down_revision = "7b3e9c1a2f48"
branch_labels = None
depends_on = None


# (key, label) -- no "generalist"; that catalog entry is intentionally dropped.
SKILL_CATALOG_SEED = [
    ("git", "Git"),
    ("docker", "Docker"),
    ("python", "Python"),
    ("generalist_foundation", "Generalist Foundation"),
    ("evals", "Evals"),
    ("labeling", "Labeling"),
    ("prompt_writing", "Prompt Writing"),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. Global, DB-backed skill catalog.
    if not inspector.has_table("skill_catalog"):
        op.create_table(
            "skill_catalog",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("key", sa.String(length=50), nullable=False),
            sa.Column("label", sa.String(length=100), nullable=False),
            sa.Column(
                "isActive",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            sa.Column(
                "createdBy",
                sa.String(length=32),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
            sa.Column(
                "createdAt",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updatedAt",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint("key", name="uq_skill_catalog_key"),
        )

    # Seed the catalog (idempotent on key so re-runs / partial states are safe).
    catalog_tbl = sa.table(
        "skill_catalog",
        sa.column("id", sa.String),
        sa.column("key", sa.String),
        sa.column("label", sa.String),
    )
    existing_keys = {row[0] for row in bind.execute(sa.text("SELECT key FROM skill_catalog"))}
    to_insert = [
        {"id": uuid.uuid4().hex, "key": key, "label": label}
        for key, label in SKILL_CATALOG_SEED
        if key not in existing_keys
    ]
    if to_insert:
        op.bulk_insert(catalog_tbl, to_insert)

    # 2. Additive columns on employee_profiles.
    employee_cols = {col["name"] for col in inspector.get_columns("employee_profiles")}
    if "trainingScore" not in employee_cols:
        op.add_column(
            "employee_profiles",
            sa.Column("trainingScore", sa.Float(), nullable=True),
        )
    if "evaluationVerdict" not in employee_cols:
        op.add_column(
            "employee_profiles",
            sa.Column("evaluationVerdict", sa.String(length=50), nullable=True),
        )

    # 3. Backfill: existing employees are already hired -> verdict "pass".
    op.execute(
        sa.text(
            'UPDATE employee_profiles SET "evaluationVerdict" = \'pass\' '
            'WHERE "evaluationVerdict" IS NULL'
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    employee_cols = {col["name"] for col in inspector.get_columns("employee_profiles")}
    if "evaluationVerdict" in employee_cols:
        op.drop_column("employee_profiles", "evaluationVerdict")
    if "trainingScore" in employee_cols:
        op.drop_column("employee_profiles", "trainingScore")

    if inspector.has_table("skill_catalog"):
        op.drop_table("skill_catalog")
