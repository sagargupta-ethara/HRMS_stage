"""employee_profiles_and_auth_roles

Revision ID: b9c9d1a2f4ab
Revises: c3b8e2f4d913
Create Date: 2026-05-13 14:30:00.000000
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime, time
from uuid import uuid4

import sqlalchemy as sa
from alembic import op


revision: str = "b9c9d1a2f4ab"
down_revision: str | None = "c3b8e2f4d913"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _normalize_email(value: str | None) -> str | None:
    return value.strip().lower() if value else value


def _normalize_employee_code(value: str | None) -> str | None:
    return value.strip().upper() if value else value


def _parse_optional_datetime(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    raw = str(value).strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        parsed = datetime.combine(date.fromisoformat(raw), time.min)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def upgrade() -> None:
    op.create_table(
        "employee_profiles",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("userId", sa.String(length=32), nullable=True),
        sa.Column("fullName", sa.String(length=255), nullable=False),
        sa.Column("etharaEmail", sa.String(length=255), nullable=False),
        sa.Column("personalEmail", sa.String(length=255), nullable=True),
        sa.Column("employeeCode", sa.String(length=64), nullable=False),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("department", sa.String(length=255), nullable=True),
        sa.Column("designation", sa.String(length=255), nullable=True),
        sa.Column("gender", sa.String(length=30), nullable=True),
        sa.Column("aadhaarLast4", sa.String(length=4), nullable=True),
        sa.Column("aadhaarHash", sa.String(length=64), nullable=True),
        sa.Column("dateOfBirth", sa.DateTime(timezone=True), nullable=True),
        sa.Column("aadhaarPath", sa.String(length=500), nullable=True),
        sa.Column("resumePath", sa.String(length=500), nullable=True),
        sa.Column("aadhaarOcrStatus", sa.String(length=50), nullable=True),
        sa.Column("aadhaarOcrMatch", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["userId"], ["users.id"], name=op.f("fk_employee_profiles_userId_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_employee_profiles")),
        sa.UniqueConstraint("employeeCode", name=op.f("uq_employee_profiles_employeeCode")),
        sa.UniqueConstraint("userId", name=op.f("uq_employee_profiles_userId")),
        sa.UniqueConstraint("etharaEmail", name=op.f("uq_employee_profiles_etharaEmail")),
        sa.UniqueConstraint("aadhaarHash", name=op.f("uq_employee_profiles_aadhaarHash")),
    )
    op.create_index(op.f("ix_employee_profiles_etharaEmail"), "employee_profiles", ["etharaEmail"], unique=False)
    op.create_index(op.f("ix_employee_profiles_employeeCode"), "employee_profiles", ["employeeCode"], unique=False)
    op.create_index(op.f("ix_employee_profiles_personalEmail"), "employee_profiles", ["personalEmail"], unique=False)

    bind = op.get_bind()
    metadata = sa.MetaData()
    users = sa.Table("users", metadata, autoload_with=bind)
    audit_logs = sa.Table("audit_logs", metadata, autoload_with=bind)
    employee_profiles = sa.Table("employee_profiles", metadata, autoload_with=bind)

    employee_rows = bind.execute(
        sa.select(
            users.c.id,
            users.c.email,
            users.c.name,
            users.c.phone,
            users.c.role,
            users.c.created_at,
            users.c.updated_at,
            users.c.isActive,
            users.c.emailVerifiedAt,
            audit_logs.c.newValue,
        )
        .select_from(users.join(audit_logs, audit_logs.c.userId == users.c.id))
        .where(audit_logs.c.entityType == "employee_registration")
        .order_by(audit_logs.c.createdAt.asc())
    ).mappings()

    seen_emails: set[str] = set()
    seen_codes: set[str] = set()

    for row in employee_rows:
        meta = row["newValue"] or {}
        normalized_email = _normalize_email(meta.get("etharaEmail") or row["email"])
        if not normalized_email or normalized_email in seen_emails:
            continue

        employee_code = _normalize_employee_code(meta.get("employeeCode")) or f"EMP-{row['id'][:6].upper()}"
        suffix = 2
        base_code = employee_code
        while employee_code in seen_codes:
            employee_code = f"{base_code}-{suffix}"
            suffix += 1

        bind.execute(
            employee_profiles.insert().values(
                id=uuid4().hex,
                userId=row["id"],
                fullName=(meta.get("fullName") or row["name"] or "Employee").strip(),
                etharaEmail=normalized_email,
                personalEmail=_normalize_email(meta.get("personalEmail")),
                employeeCode=employee_code,
                phone=(meta.get("phone") or row["phone"]),
                department=meta.get("department"),
                designation=meta.get("designation"),
                gender=meta.get("gender"),
                aadhaarLast4=meta.get("aadhaarLast4"),
                aadhaarHash=meta.get("aadhaarHash"),
                dateOfBirth=_parse_optional_datetime(meta.get("dateOfBirth")),
                aadhaarPath=meta.get("aadhaarPath"),
                resumePath=meta.get("resumePath"),
                aadhaarOcrStatus=meta.get("ocrStatus"),
                aadhaarOcrMatch=meta.get("ocrAadhaarMatch"),
                created_at=row["created_at"] or datetime.now(UTC),
                updated_at=row["updated_at"] or row["created_at"] or datetime.now(UTC),
            )
        )

        bind.execute(
            users.update()
            .where(users.c.id == row["id"])
            .values(
                email=normalized_email,
                role="employee",
                isActive=True,
                emailVerifiedAt=row["emailVerifiedAt"] or row["created_at"] or datetime.now(UTC),
            )
        )

        seen_emails.add(normalized_email)
        seen_codes.add(employee_code)

    bind.execute(
        users.update().values(email=sa.func.lower(sa.func.trim(users.c.email)))
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_profiles_personalEmail"), table_name="employee_profiles")
    op.drop_index(op.f("ix_employee_profiles_employeeCode"), table_name="employee_profiles")
    op.drop_index(op.f("ix_employee_profiles_etharaEmail"), table_name="employee_profiles")
    op.drop_table("employee_profiles")
