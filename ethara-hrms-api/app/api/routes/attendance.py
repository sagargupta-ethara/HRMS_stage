from __future__ import annotations

import csv
import io
from datetime import date, datetime, time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload
from starlette.responses import StreamingResponse

from app.api.deps import require_permissions
from app.core.database import get_db
from app.core.exports import csv_safe_mapping, csv_safe_row
from app.core.permissions import Permission
from app.db.models import (
    AttendanceRecord,
    AttendanceSource,
    AttendanceStatus,
    AttendanceSyncLog,
    EmployeeProfile,
    Role,
    User,
    utcnow,
)
from app.services.attendance_sync import (
    attendance_today,
    attendance_timezone,
    compute_worked_hours,
    is_attendance_day_final,
    normalize_status,
    sync_attendance_for_date,
    sync_attendance_range,
)
from app.services.audit import log_audit

router = APIRouter(prefix="/attendance", tags=["attendance"])

ATTENDANCE_ADMIN_ROLES = {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP, Role.HR}
VALID_STATUSES = {status.value for status in AttendanceStatus}


class AttendanceEditRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    in_time: str | None = Field(default=None, alias="inTime")
    out_time: str | None = Field(default=None, alias="outTime")
    status: str
    reason: str


def _role_value(role: Role | str) -> str:
    return role.value if isinstance(role, Role) else str(role)


def _user_roles(user: User) -> set[str]:
    values = {_role_value(user.role)}
    for role in user.roles or []:
        values.add(str(role))
    return values


def _is_attendance_admin(user: User) -> bool:
    allowed = {_role_value(role) for role in ATTENDANCE_ADMIN_ROLES}
    return bool(_user_roles(user) & allowed)


def _ensure_attendance_admin(user: User) -> None:
    if not _is_attendance_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized.")


def _profile_for_user(db: Session, user: User) -> EmployeeProfile:
    profile = db.scalar(
        select(EmployeeProfile).where(
            or_(
                EmployeeProfile.user_id == user.id,
                func.lower(EmployeeProfile.ethara_email) == user.email.strip().lower(),
            )
        )
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee profile not found for this user.",
        )
    return profile


def _default_from() -> date:
    today = attendance_today()
    return today.replace(day=1)


def _default_to() -> date:
    return attendance_today()


def _serialize(record: AttendanceRecord) -> dict[str, Any]:
    status_value = (
        record.status.value if isinstance(record.status, AttendanceStatus) else record.status
    )
    source_value = (
        record.source.value if isinstance(record.source, AttendanceSource) else record.source
    )
    return {
        "id": record.id,
        "employeeProfileId": record.employee_profile_id,
        "employeeCode": record.employee_code,
        "employeeName": record.employee_name
        or (record.employee_profile.full_name if record.employee_profile else None),
        "department": record.department
        or (record.employee_profile.department if record.employee_profile else None),
        "designation": record.employee_profile.designation if record.employee_profile else None,
        "attendanceDate": record.attendance_date.isoformat() if record.attendance_date else None,
        "inTime": record.in_time.isoformat() if record.in_time else None,
        "outTime": record.out_time.isoformat() if record.out_time else None,
        "workedHours": record.worked_hours,
        "status": status_value,
        "source": source_value,
        "isEdited": record.is_edited,
        "originalInTime": record.original_in_time.isoformat() if record.original_in_time else None,
        "originalOutTime": (
            record.original_out_time.isoformat() if record.original_out_time else None
        ),
        "originalStatus": (
            record.original_status.value
            if isinstance(record.original_status, AttendanceStatus)
            else record.original_status
        ),
        "editedBy": record.editor.name if record.editor else None,
        "editedAt": record.edited_at.isoformat() if record.edited_at else None,
        "editReason": record.edit_reason,
        "isFinal": record.is_final,
        "createdAt": record.created_at.isoformat() if record.created_at else None,
        "updatedAt": record.updated_at.isoformat() if record.updated_at else None,
    }


def _date_columns(start: date, end: date) -> list[str]:
    columns: list[str] = []
    current = start
    while current <= end:
        columns.append(current.isoformat())
        current = date.fromordinal(current.toordinal() + 1)
    return columns


def _matrix_key(record: AttendanceRecord) -> str:
    if record.employee_profile_id:
        return f"profile:{record.employee_profile_id}"
    return f"code:{(record.employee_code or '').strip().lower()}"


def _serialize_matrix_cell(record: AttendanceRecord) -> dict[str, Any]:
    status_value = (
        record.status.value if isinstance(record.status, AttendanceStatus) else record.status
    )
    source_value = (
        record.source.value if isinstance(record.source, AttendanceSource) else record.source
    )
    return {
        "id": record.id,
        "attendanceDate": record.attendance_date.isoformat() if record.attendance_date else None,
        "inTime": record.in_time.isoformat() if record.in_time else None,
        "status": status_value,
        "source": source_value,
        "isEdited": record.is_edited,
        "isFinal": record.is_final,
    }


def _matrix_response(
    db: Session,
    query: Any,
    *,
    start: date,
    end: date,
    page: int,
    limit: int,
) -> dict[str, Any]:
    records = list(
        db.scalars(
            query.order_by(
                AttendanceRecord.employee_name.asc(),
                AttendanceRecord.employee_code.asc(),
                AttendanceRecord.attendance_date.asc(),
            )
        )
    )
    grouped: dict[str, dict[str, Any]] = {}
    for record in records:
        key = _matrix_key(record)
        if key not in grouped:
            grouped[key] = {
                "employeeProfileId": record.employee_profile_id,
                "employeeCode": record.employee_code,
                "employeeName": record.employee_name
                or (record.employee_profile.full_name if record.employee_profile else None),
                "department": record.department
                or (record.employee_profile.department if record.employee_profile else None),
                "designation": (
                    record.employee_profile.designation if record.employee_profile else None
                ),
                "dates": {},
            }
        if record.attendance_date:
            grouped[key]["dates"][record.attendance_date.isoformat()] = _serialize_matrix_cell(
                record
            )

    rows = sorted(
        grouped.values(),
        key=lambda item: (
            str(item.get("employeeName") or "").lower(),
            str(item.get("employeeCode") or "").lower(),
        ),
    )
    total = len(rows)
    start_index = (page - 1) * limit
    paged_rows = rows[start_index : start_index + limit]
    return {
        "dates": _date_columns(start, end),
        "data": paged_rows,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit if limit else 1,
    }


def _serialize_sync_log(log: AttendanceSyncLog) -> dict[str, Any]:
    return {
        "id": log.id,
        "syncDate": log.sync_date.isoformat() if log.sync_date else None,
        "source": log.source,
        "status": log.status.value if hasattr(log.status, "value") else log.status,
        "startedAt": log.started_at.isoformat() if log.started_at else None,
        "finishedAt": log.finished_at.isoformat() if log.finished_at else None,
        "rowsSeen": log.rows_seen,
        "rowsSynced": log.rows_synced,
        "unmappedCount": log.unmapped_count,
        "unmappedCodes": log.unmapped_codes or [],
        "error": log.error,
        "isFinal": log.is_final,
    }


def _date_window(*, from_date: date | None, to_date: date | None) -> tuple[date, date]:
    start = from_date or _default_from()
    end = to_date or _default_to()
    if end < start:
        raise HTTPException(status_code=422, detail="To date cannot be before from date.")
    return start, end


def _base_query(
    *,
    from_date: date | None,
    to_date: date | None,
) -> Any:
    start, end = _date_window(from_date=from_date, to_date=to_date)
    return (
        select(AttendanceRecord)
        .where(AttendanceRecord.attendance_date >= start, AttendanceRecord.attendance_date <= end)
        .options(joinedload(AttendanceRecord.employee_profile), joinedload(AttendanceRecord.editor))
    )


def _apply_staff_filters(
    query: Any,
    *,
    employee_id: str | None,
    department: str | None,
    status_filter: str | None,
    search: str | None,
    mapped: bool | None = None,
) -> Any:
    if mapped is True:
        # Only biometric rows that resolved to a registered employee profile.
        query = query.where(AttendanceRecord.employee_profile_id.isnot(None))
    elif mapped is False:
        query = query.where(AttendanceRecord.employee_profile_id.is_(None))
    if employee_id:
        query = query.where(AttendanceRecord.employee_profile_id == employee_id)
    if department:
        query = query.where(func.lower(AttendanceRecord.department) == department.strip().lower())
    if status_filter:
        normalized = normalize_status(status_filter).value
        query = query.where(AttendanceRecord.status == normalized)
    if search:
        like = f"%{search.strip().lower()}%"
        query = query.where(
            func.lower(func.coalesce(AttendanceRecord.employee_name, "")).like(like)
            | func.lower(func.coalesce(AttendanceRecord.employee_code, "")).like(like)
            | func.lower(func.coalesce(AttendanceRecord.department, "")).like(like)
        )
    return query


def _summary_for_query(db: Session, query: Any) -> dict[str, Any]:
    rows = list(db.scalars(query))
    total = len(rows)
    counts = {status.value: 0 for status in AttendanceStatus}
    edited = 0
    worked_values: list[float] = []
    for row in rows:
        key = row.status.value if isinstance(row.status, AttendanceStatus) else str(row.status)
        counts[key] = counts.get(key, 0) + 1
        if row.is_edited:
            edited += 1
        if row.worked_hours is not None:
            worked_values.append(float(row.worked_hours))
    return {
        "total": total,
        "present": counts.get(AttendanceStatus.PRESENT.value, 0),
        "absent": counts.get(AttendanceStatus.ABSENT.value, 0),
        "halfDay": counts.get(AttendanceStatus.HALF_DAY.value, 0),
        "holiday": counts.get(AttendanceStatus.HOLIDAY.value, 0),
        "weekoff": counts.get(AttendanceStatus.WEEKOFF.value, 0),
        "edited": edited,
        "averageWorkedHours": (
            round(sum(worked_values) / len(worked_values), 2) if worked_values else None
        ),
    }


def _parse_time_for_date(value: str | None, attendance_date: date) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        if "T" in text:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        else:
            parsed_time = time.fromisoformat(text)
            parsed = datetime.combine(attendance_date, parsed_time)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="Time must be HH:MM or an ISO datetime.",
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=attendance_timezone())
    return parsed


def _enum_value(value: Any) -> str:
    return str(value.value if hasattr(value, "value") else value or "")


def _title_value(value: Any) -> str:
    text = _enum_value(value)
    return text.replace("_", " ").title() if text else ""


def _date_value(value: date | None) -> str:
    return value.isoformat() if value else ""


def _time_value(value: datetime | None) -> str:
    return value.strftime("%H:%M") if value else ""


def _datetime_value(value: datetime | None) -> str:
    return value.isoformat() if value else ""


def _export_date_columns(start: date, end: date) -> list[date]:
    columns: list[date] = []
    current = start
    while current <= end:
        columns.append(current)
        current = date.fromordinal(current.toordinal() + 1)
    return columns


def _export_date_label(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def _export_month_row(date_columns: list[date], fixed_columns: int) -> list[str]:
    row = [""] * fixed_columns
    previous_month: tuple[int, int] | None = None
    for column in date_columns:
        month_key = (column.year, column.month)
        row.append(column.strftime("%b") if month_key != previous_month else "")
        previous_month = month_key
    return row


def _attendance_matrix_export_response(
    filename: str,
    records: list[AttendanceRecord],
    *,
    start: date,
    end: date,
) -> StreamingResponse:
    date_columns = _export_date_columns(start, end)
    fixed_headers = ["Employee Code", "Employee Name", "Department", "Designation"]
    grouped: dict[str, dict[str, Any]] = {}
    for record in records:
        key = _matrix_key(record)
        if key not in grouped:
            grouped[key] = {
                "employeeCode": record.employee_code or "",
                "employeeName": record.employee_name
                or (record.employee_profile.full_name if record.employee_profile else ""),
                "department": record.department
                or (record.employee_profile.department if record.employee_profile else ""),
                "designation": record.employee_profile.designation
                if record.employee_profile and record.employee_profile.designation
                else "",
                "dates": {},
            }
        if record.attendance_date:
            grouped[key]["dates"][record.attendance_date] = _title_value(record.status)

    employee_rows = sorted(
        grouped.values(),
        key=lambda item: (
            str(item.get("employeeName") or "").lower(),
            str(item.get("employeeCode") or "").lower(),
        ),
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(_export_month_row(date_columns, len(fixed_headers)))
    writer.writerow([*fixed_headers, *[_export_date_label(column) for column in date_columns]])
    for row in employee_rows:
        status_by_date = row["dates"]
        writer.writerow(
            csv_safe_row([
                row["employeeCode"],
                row["employeeName"],
                row["department"],
                row["designation"],
                *[status_by_date.get(column, "") for column in date_columns],
            ])
        )
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _attendance_export_rows(records: list[AttendanceRecord]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for record in records:
        rows.append(
            {
                "Employee Code": record.employee_code or "",
                "Employee Name": record.employee_name
                or (record.employee_profile.full_name if record.employee_profile else ""),
                "Department": record.department
                or (record.employee_profile.department if record.employee_profile else ""),
                "Designation": record.employee_profile.designation
                if record.employee_profile and record.employee_profile.designation
                else "",
                "Attendance Date": _date_value(record.attendance_date),
                "In Time": _time_value(record.in_time),
                "Out Time": _time_value(record.out_time),
                "Worked Hours": "" if record.worked_hours is None else str(record.worked_hours),
                "Status": _title_value(record.status),
                "Source": _title_value(record.source),
                "Edited": "Yes" if record.is_edited else "No",
                "Original In Time": _time_value(record.original_in_time),
                "Original Out Time": _time_value(record.original_out_time),
                "Original Status": _title_value(record.original_status),
                "Edited By": record.editor.name if record.editor else "",
                "Edited At": _datetime_value(record.edited_at),
                "Edit Reason": record.edit_reason or "",
                "Final": "Yes" if record.is_final else "No",
            }
        )
    return rows


def _csv_response(filename: str, rows: list[dict[str, str]]) -> StreamingResponse:
    fieldnames = [
        "Employee Code",
        "Employee Name",
        "Department",
        "Designation",
        "Attendance Date",
        "In Time",
        "Out Time",
        "Worked Hours",
        "Status",
        "Source",
        "Edited",
        "Original In Time",
        "Original Out Time",
        "Original Status",
        "Edited By",
        "Edited At",
        "Edit Reason",
        "Final",
    ]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(csv_safe_mapping(row) for row in rows)
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _serialize_range_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        **result,
        "logs": [_serialize_sync_log(log) for log in result.get("logs", [])],
    }


@router.get("/list")
def list_attendance(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    employee_id: Annotated[str | None, Query(alias="employeeId")] = None,
    department: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    search: str | None = None,
    mapped: Annotated[bool | None, Query()] = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=200),
):
    _ensure_attendance_admin(current_user)
    query = _apply_staff_filters(
        _base_query(from_date=from_date, to_date=to_date),
        employee_id=employee_id,
        department=department,
        status_filter=status_filter,
        search=search,
        mapped=mapped,
    )
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    rows = list(
        db.scalars(
            query.order_by(
                AttendanceRecord.attendance_date.desc(),
                AttendanceRecord.employee_name.asc(),
            )
            .offset((page - 1) * limit)
            .limit(limit)
        )
    )
    return {
        "data": [_serialize(row) for row in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit if limit else 1,
    }


@router.get("/matrix")
def attendance_matrix(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    employee_id: Annotated[str | None, Query(alias="employeeId")] = None,
    department: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    search: str | None = None,
    mapped: Annotated[bool | None, Query()] = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
):
    _ensure_attendance_admin(current_user)
    start, end = _date_window(from_date=from_date, to_date=to_date)
    query = _apply_staff_filters(
        _base_query(from_date=from_date, to_date=to_date),
        employee_id=employee_id,
        department=department,
        status_filter=status_filter,
        search=search,
        mapped=mapped,
    )
    return _matrix_response(db, query, start=start, end=end, page=page, limit=limit)


@router.get("/summary")
def attendance_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    employee_id: Annotated[str | None, Query(alias="employeeId")] = None,
    department: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    search: str | None = None,
    mapped: Annotated[bool | None, Query()] = None,
):
    _ensure_attendance_admin(current_user)
    query = _apply_staff_filters(
        _base_query(from_date=from_date, to_date=to_date),
        employee_id=employee_id,
        department=department,
        status_filter=status_filter,
        search=search,
        mapped=mapped,
    )
    return _summary_for_query(db, query)


@router.get("/export")
def export_attendance(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    employee_id: Annotated[str | None, Query(alias="employeeId")] = None,
    department: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    search: str | None = None,
    mapped: Annotated[bool | None, Query()] = None,
):
    _ensure_attendance_admin(current_user)
    start, end = _date_window(from_date=from_date, to_date=to_date)
    query = _apply_staff_filters(
        _base_query(from_date=from_date, to_date=to_date),
        employee_id=employee_id,
        department=department,
        status_filter=status_filter,
        search=search,
        mapped=mapped,
    )
    records = list(
        db.scalars(
            query.order_by(
                AttendanceRecord.employee_name.asc(),
                AttendanceRecord.employee_code.asc(),
                AttendanceRecord.attendance_date.asc(),
            )
        )
    )
    return _attendance_matrix_export_response(
        f"attendance_{start.isoformat()}_{end.isoformat()}.csv",
        records,
        start=start,
        end=end,
    )


@router.get("/me")
def my_attendance(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=31, ge=1, le=120),
):
    profile = _profile_for_user(db, current_user)
    query = _base_query(from_date=from_date, to_date=to_date).where(
        AttendanceRecord.employee_profile_id == profile.id
    )
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    rows = list(
        db.scalars(
            query.order_by(AttendanceRecord.attendance_date.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
    )
    return {
        "data": [_serialize(row) for row in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit if limit else 1,
    }


@router.get("/me/matrix")
def my_attendance_matrix(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
):
    profile = _profile_for_user(db, current_user)
    start, end = _date_window(from_date=from_date, to_date=to_date)
    query = _base_query(from_date=from_date, to_date=to_date).where(
        AttendanceRecord.employee_profile_id == profile.id
    )
    return _matrix_response(db, query, start=start, end=end, page=1, limit=1)


@router.get("/me/summary")
def my_attendance_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
):
    profile = _profile_for_user(db, current_user)
    query = _base_query(from_date=from_date, to_date=to_date).where(
        AttendanceRecord.employee_profile_id == profile.id
    )
    return _summary_for_query(db, query)


@router.get("/me/export")
def export_my_attendance(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
):
    profile = _profile_for_user(db, current_user)
    start, end = _date_window(from_date=from_date, to_date=to_date)
    query = _base_query(from_date=from_date, to_date=to_date).where(
        AttendanceRecord.employee_profile_id == profile.id
    )
    records = list(
        db.scalars(
            query.order_by(
                AttendanceRecord.employee_name.asc(),
                AttendanceRecord.employee_code.asc(),
                AttendanceRecord.attendance_date.asc(),
            )
        )
    )
    return _attendance_matrix_export_response(
        f"my_attendance_{start.isoformat()}_{end.isoformat()}.csv",
        records,
        start=start,
        end=end,
    )


@router.post("/sync-year")
def sync_attendance_year(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_WRITE))],
    year: Annotated[int | None, Query(ge=2000, le=2100)] = None,
    force: bool = False,
):
    _ensure_attendance_admin(current_user)
    today = attendance_today()
    selected_year = year or today.year
    if selected_year > today.year:
        raise HTTPException(status_code=422, detail="Cannot sync attendance for a future year.")
    start = date(selected_year, 1, 1)
    end = min(date(selected_year, 12, 31), today)
    result = sync_attendance_range(
        db,
        start_date=start,
        end_date=end,
        actor=current_user,
        force=force,
        final_resolver=is_attendance_day_final,
    )
    return _serialize_range_result(result)


@router.post("/sync-range")
def sync_attendance_date_range(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_WRITE))],
    from_date: Annotated[date, Query(alias="from")],
    to_date: Annotated[date, Query(alias="to")],
    force: bool = False,
):
    _ensure_attendance_admin(current_user)
    result = sync_attendance_range(
        db,
        start_date=from_date,
        end_date=to_date,
        actor=current_user,
        force=force,
        final_resolver=is_attendance_day_final,
    )
    return _serialize_range_result(result)


@router.patch("/{record_id}")
def edit_attendance(
    record_id: str,
    payload: AttendanceEditRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_WRITE))],
):
    _ensure_attendance_admin(current_user)
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Edit reason is required.")
    record = db.scalar(
        select(AttendanceRecord)
        .where(AttendanceRecord.id == record_id)
        .options(joinedload(AttendanceRecord.employee_profile), joinedload(AttendanceRecord.editor))
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Attendance record not found.")
    old_value = _serialize(record)
    if not record.is_edited:
        record.original_in_time = record.original_in_time or record.in_time
        record.original_out_time = record.original_out_time or record.out_time
        record.original_status = record.original_status or record.status
    new_status = normalize_status(payload.status)
    record.in_time = _parse_time_for_date(payload.in_time, record.attendance_date)
    record.out_time = _parse_time_for_date(payload.out_time, record.attendance_date)
    record.status = new_status
    record.worked_hours = compute_worked_hours(record.in_time, record.out_time)
    record.source = AttendanceSource.MANUAL
    record.is_edited = True
    record.edited_by = current_user.id
    record.edited_at = utcnow()
    record.edit_reason = reason
    db.add(record)
    db.flush()
    log_audit(
        db,
        entity_type="attendance",
        entity_id=record.id,
        action="attendance_edited",
        actor=current_user,
        request=request,
        user_id=record.employee_profile.user_id if record.employee_profile else None,
        old_value=old_value,
        new_value=_serialize(record),
    )
    db.commit()
    db.refresh(record)
    return _serialize(record)


@router.post("/sync")
def sync_attendance(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_WRITE))],
    sync_date: Annotated[date, Query(alias="date")],
    force: bool = False,
    final: bool | None = None,
):
    _ensure_attendance_admin(current_user)
    log = sync_attendance_for_date(
        db,
        sync_date=sync_date,
        actor=current_user,
        force=force,
        is_final=is_attendance_day_final(sync_date) if final is None else final,
    )
    return _serialize_sync_log(log)


@router.get("/sync-logs")
def attendance_sync_logs(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ATTENDANCE_READ))],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    _ensure_attendance_admin(current_user)
    query = select(AttendanceSyncLog).order_by(AttendanceSyncLog.sync_date.desc())
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    rows = list(db.scalars(query.offset((page - 1) * limit).limit(limit)))
    return {
        "data": [_serialize_sync_log(row) for row in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit if limit else 1,
    }
