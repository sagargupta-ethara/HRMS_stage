"""careers_portal_and_auth_codes

Revision ID: c3b8e2f4d913
Revises: 9d2a7e4b6c31
Create Date: 2026-05-11 13:30:00.000000
"""

from collections.abc import Sequence
import re

import sqlalchemy as sa
from alembic import op


revision: str = "c3b8e2f4d913"
down_revision: str | None = "9d2a7e4b6c31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return slug or "job-opening"


def upgrade() -> None:
    op.add_column("users", sa.Column("emailVerifiedAt", sa.DateTime(timezone=True), nullable=True))

    op.add_column("positions", sa.Column("slug", sa.String(length=255), nullable=True))
    op.add_column("positions", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("positions", sa.Column("location", sa.String(length=255), nullable=True))
    op.add_column("positions", sa.Column("employmentType", sa.String(length=100), nullable=True))
    op.add_column("positions", sa.Column("workMode", sa.String(length=100), nullable=True))
    op.add_column("positions", sa.Column("experienceLevel", sa.String(length=100), nullable=True))
    op.add_column("positions", sa.Column("responsibilities", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("positions", sa.Column("requirements", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("positions", sa.Column("preferredSkills", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("positions", sa.Column("benefits", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("positions", sa.Column("featured", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("positions", sa.Column("openings", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("positions", sa.Column("postedAt", sa.DateTime(timezone=True), nullable=True))

    op.add_column("candidates", sa.Column("portalUserId", sa.String(length=32), nullable=True))
    op.create_foreign_key(
        op.f("fk_candidates_portalUserId_users"),
        "candidates",
        "users",
        ["portalUserId"],
        ["id"],
    )
    op.create_index(op.f("ix_candidates_portalUserId"), "candidates", ["portalUserId"], unique=False)

    op.create_table(
        "auth_codes",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("userId", sa.String(length=32), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column(
            "purpose",
            sa.Enum(
                "email_verification",
                "password_reset",
                name="auth_code_purpose",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("codeHash", sa.String(length=64), nullable=False),
        sa.Column("expiresAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["userId"], ["users.id"], name=op.f("fk_auth_codes_userId_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_codes")),
    )
    op.create_index(op.f("ix_auth_codes_codeHash"), "auth_codes", ["codeHash"], unique=False)
    op.create_index(op.f("ix_auth_codes_email"), "auth_codes", ["email"], unique=False)
    op.create_index(op.f("ix_auth_codes_purpose"), "auth_codes", ["purpose"], unique=False)

    bind = op.get_bind()

    bind.execute(
        sa.text(
            """
            UPDATE users
            SET "emailVerifiedAt" = COALESCE("lastLoginAt", created_at, CURRENT_TIMESTAMP)
            WHERE "emailVerifiedAt" IS NULL
            """
        )
    )

    positions = bind.execute(sa.text('SELECT id, title, created_at FROM positions')).mappings().all()
    seen_slugs: set[str] = set()
    for row in positions:
        base_slug = _slugify(row["title"])
        slug = base_slug
        suffix = 2
        while slug in seen_slugs:
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        seen_slugs.add(slug)
        bind.execute(
            sa.text(
                """
                UPDATE positions
                SET slug = :slug,
                    summary = COALESCE(summary, description),
                    location = COALESCE(location, 'Bengaluru, India'),
                    "employmentType" = COALESCE("employmentType", 'Full-time'),
                    "workMode" = COALESCE("workMode", 'Hybrid'),
                    "experienceLevel" = COALESCE("experienceLevel", 'Mid-Senior'),
                    "postedAt" = COALESCE("postedAt", created_at, CURRENT_TIMESTAMP)
                WHERE id = :position_id
                """
            ),
            {"slug": slug, "position_id": row["id"]},
        )

    bind.execute(
        sa.text(
            """
            UPDATE candidates
            SET "portalUserId" = (
                SELECT users.id
                FROM users
                WHERE lower(users.email) = lower(candidates."personalEmail")
                LIMIT 1
            )
            WHERE "portalUserId" IS NULL
            """
        )
    )

    op.alter_column("positions", "slug", existing_type=sa.String(length=255), nullable=False)
    op.create_index(op.f("ix_positions_slug"), "positions", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_positions_slug"), table_name="positions")
    op.drop_index(op.f("ix_candidates_portalUserId"), table_name="candidates")
    op.drop_constraint(op.f("fk_candidates_portalUserId_users"), "candidates", type_="foreignkey")

    op.drop_index(op.f("ix_auth_codes_purpose"), table_name="auth_codes")
    op.drop_index(op.f("ix_auth_codes_email"), table_name="auth_codes")
    op.drop_index(op.f("ix_auth_codes_codeHash"), table_name="auth_codes")
    op.drop_table("auth_codes")

    op.drop_column("candidates", "portalUserId")

    op.drop_column("positions", "postedAt")
    op.drop_column("positions", "openings")
    op.drop_column("positions", "featured")
    op.drop_column("positions", "benefits")
    op.drop_column("positions", "preferredSkills")
    op.drop_column("positions", "requirements")
    op.drop_column("positions", "responsibilities")
    op.drop_column("positions", "experienceLevel")
    op.drop_column("positions", "workMode")
    op.drop_column("positions", "employmentType")
    op.drop_column("positions", "location")
    op.drop_column("positions", "summary")
    op.drop_column("positions", "slug")

    op.drop_column("users", "emailVerifiedAt")
