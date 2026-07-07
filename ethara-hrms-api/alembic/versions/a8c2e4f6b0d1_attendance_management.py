"""attendance_management

Revision ID: a8c2e4f6b0d1
Revises: f7e9d1c3a5b8
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a8c2e4f6b0d1"
down_revision: str | None = "f7e9d1c3a5b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ATTENDANCE_MODULE_ROLES = {
    "leadership",
    "hr",
    "ta",
    "evaluator",
    "it_team",
    "compliance",
    "manager",
    "employee",
    "employee_referrer",
}


def _add_attendance_to_saved_role_modules() -> None:
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
        if role not in ATTENDANCE_MODULE_ROLES or not isinstance(value, dict):
            continue
        enabled = value.get("enabled")
        if not isinstance(enabled, list) or "attendance" in enabled:
            continue
        bind.execute(
            sa.update(admin_settings)
            .where(admin_settings.c.key == row["key"])
            .values(value={**value, "enabled": [*enabled, "attendance"]})
        )


def _remove_attendance_from_saved_role_modules() -> None:
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
        if not isinstance(enabled, list) or "attendance" not in enabled:
            continue
        bind.execute(
            sa.update(admin_settings)
            .where(admin_settings.c.key == row["key"])
            .values(value={**value, "enabled": [item for item in enabled if item != "attendance"]})
        )


def upgrade() -> None:
    attendance_status = sa.Enum(
        "present",
        "absent",
        "half_day",
        "holiday",
        "weekoff",
        name="attendance_status",
        native_enum=False,
    )
    attendance_source = sa.Enum(
        "biometric",
        "manual",
        name="attendance_source",
        native_enum=False,
    )
    attendance_sync_status = sa.Enum(
        "running",
        "completed",
        "failed",
        "skipped",
        name="attendance_sync_status",
        native_enum=False,
    )

    op.create_table(
        "attendance_records",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("employeeCode", sa.String(length=64), nullable=False),
        sa.Column("employeeName", sa.String(length=255), nullable=True),
        sa.Column("department", sa.String(length=255), nullable=True),
        sa.Column("attendanceDate", sa.Date(), nullable=False),
        sa.Column("inTime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outTime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workedHours", sa.Float(), nullable=True),
        sa.Column("status", attendance_status, nullable=False),
        sa.Column("source", attendance_source, nullable=False),
        sa.Column("isEdited", sa.Boolean(), nullable=False),
        sa.Column("originalInTime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("originalOutTime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("originalStatus", attendance_status, nullable=True),
        sa.Column("editedBy", sa.String(length=32), nullable=True),
        sa.Column("editedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("editReason", sa.Text(), nullable=True),
        sa.Column("isFinal", sa.Boolean(), nullable=False),
        sa.Column("rawPayload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["editedBy"], ["users.id"]),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employeeProfileId", "attendanceDate", name="uq_attendance_employee_date"),
    )
    op.create_index("ix_attendance_records_attendanceDate", "attendance_records", ["attendanceDate"])
    op.create_index("ix_attendance_records_date_status", "attendance_records", ["attendanceDate", "status"])
    op.create_index("ix_attendance_records_department", "attendance_records", ["department"])
    op.create_index(
        "ix_attendance_records_department_status", "attendance_records", ["department", "status"]
    )
    op.create_index("ix_attendance_records_employeeCode", "attendance_records", ["employeeCode"])
    op.create_index(
        "ix_attendance_records_employee_date",
        "attendance_records",
        ["employeeProfileId", "attendanceDate"],
    )
    op.create_index("ix_attendance_records_employeeProfileId", "attendance_records", ["employeeProfileId"])
    op.create_index("ix_attendance_records_isEdited", "attendance_records", ["isEdited"])
    op.create_index("ix_attendance_records_isFinal", "attendance_records", ["isFinal"])
    op.create_index("ix_attendance_records_source", "attendance_records", ["source"])
    op.create_index("ix_attendance_records_status", "attendance_records", ["status"])

    op.create_table(
        "attendance_sync_logs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("syncDate", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("status", attendance_sync_status, nullable=False),
        sa.Column("startedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finishedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rowsSeen", sa.Integer(), nullable=False),
        sa.Column("rowsSynced", sa.Integer(), nullable=False),
        sa.Column("unmappedCount", sa.Integer(), nullable=False),
        sa.Column("unmappedCodes", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("isFinal", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("syncDate", name="uq_attendance_sync_logs_sync_date"),
    )
    op.create_index("ix_attendance_sync_logs_isFinal", "attendance_sync_logs", ["isFinal"])
    op.create_index("ix_attendance_sync_logs_status", "attendance_sync_logs", ["status"])
    op.create_index(
        "ix_attendance_sync_logs_status_date", "attendance_sync_logs", ["status", "syncDate"]
    )
    op.create_index("ix_attendance_sync_logs_syncDate", "attendance_sync_logs", ["syncDate"])

    _add_attendance_to_saved_role_modules()


def downgrade() -> None:
    _remove_attendance_from_saved_role_modules()

    op.drop_index("ix_attendance_sync_logs_syncDate", table_name="attendance_sync_logs")
    op.drop_index("ix_attendance_sync_logs_status_date", table_name="attendance_sync_logs")
    op.drop_index("ix_attendance_sync_logs_status", table_name="attendance_sync_logs")
    op.drop_index("ix_attendance_sync_logs_isFinal", table_name="attendance_sync_logs")
    op.drop_table("attendance_sync_logs")

    op.drop_index("ix_attendance_records_status", table_name="attendance_records")
    op.drop_index("ix_attendance_records_source", table_name="attendance_records")
    op.drop_index("ix_attendance_records_isFinal", table_name="attendance_records")
    op.drop_index("ix_attendance_records_isEdited", table_name="attendance_records")
    op.drop_index("ix_attendance_records_employeeProfileId", table_name="attendance_records")
    op.drop_index("ix_attendance_records_employee_date", table_name="attendance_records")
    op.drop_index("ix_attendance_records_employeeCode", table_name="attendance_records")
    op.drop_index("ix_attendance_records_department_status", table_name="attendance_records")
    op.drop_index("ix_attendance_records_department", table_name="attendance_records")
    op.drop_index("ix_attendance_records_date_status", table_name="attendance_records")
    op.drop_index("ix_attendance_records_attendanceDate", table_name="attendance_records")
    op.drop_table("attendance_records")
