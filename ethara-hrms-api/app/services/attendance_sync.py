from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import (
    AttendanceRecord,
    AttendanceSource,
    AttendanceStatus,
    AttendanceSyncLog,
    AttendanceSyncStatus,
    EmployeeProfile,
    User,
    utcnow,
)

ESSL_SUMMARY_QUERY = """
SELECT e.EmployeeCode, e.EmployeeName, a.AttendanceDate,
       a.InTime, a.OutTime, a.Status
FROM dbo.AttendanceLogs a
LEFT JOIN dbo.Employees e ON a.EmployeeId = e.EmployeeId
WHERE a.AttendanceDate = %s
"""


def attendance_timezone() -> ZoneInfo:
    settings = get_settings()
    try:
        return ZoneInfo(settings.attendance_business_timezone)
    except ZoneInfoNotFoundError:
        return UTC


def attendance_local_now(now: datetime | None = None) -> datetime:
    timezone = attendance_timezone()
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return current.astimezone(timezone)


def attendance_today(now: datetime | None = None) -> date:
    return attendance_local_now(now).date()


def is_attendance_day_final(sync_date: date, now: datetime | None = None) -> bool:
    local_now = attendance_local_now(now)
    if sync_date < local_now.date():
        return True
    if sync_date > local_now.date():
        return False
    return local_now.hour >= get_settings().attendance_finalize_after_hour


def normalize_status(value: Any) -> AttendanceStatus:
    if isinstance(value, AttendanceStatus):
        return value
    text = str(value or "").strip().lower().replace(" ", "").replace("-", "").replace("_", "")
    if text in {"present", "p"}:
        return AttendanceStatus.PRESENT
    if text in {"absent", "a"}:
        return AttendanceStatus.ABSENT
    if text in {"½present", "1/2present", "halfpresent", "halfday", "half"}:
        return AttendanceStatus.HALF_DAY
    if text in {"holiday", "hol"}:
        return AttendanceStatus.HOLIDAY
    if text in {"weekoff", "weeklyoff", "wo", "off"}:
        return AttendanceStatus.WEEKOFF
    return AttendanceStatus.ABSENT


def compute_worked_hours(in_time: datetime | None, out_time: datetime | None) -> float | None:
    if not in_time or not out_time:
        return None
    start = _datetime_comparison_value(in_time)
    end = _datetime_comparison_value(out_time)
    if end < start:
        return None
    seconds = (end - start).total_seconds()
    return round(seconds / 3600, 2)


def derive_status(value: Any, in_time: datetime | None) -> AttendanceStatus:
    if in_time is not None:
        return AttendanceStatus.PRESENT
    return normalize_status(value)


def _earliest_datetime(*values: datetime | None) -> datetime | None:
    parsed = [value for value in values if value is not None]
    return min(parsed, key=_datetime_comparison_value) if parsed else None


def _latest_datetime(*values: datetime | None) -> datetime | None:
    parsed = [value for value in values if value is not None]
    return max(parsed, key=_datetime_comparison_value) if parsed else None


def _datetime_comparison_value(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=attendance_timezone())


def _status_priority(value: AttendanceStatus) -> int:
    return {
        AttendanceStatus.PRESENT: 4,
        AttendanceStatus.HALF_DAY: 3,
        AttendanceStatus.HOLIDAY: 2,
        AttendanceStatus.WEEKOFF: 2,
        AttendanceStatus.ABSENT: 1,
    }[value]


def _merged_status(
    current: Any,
    incoming: Any,
    *,
    in_time: datetime | None,
) -> AttendanceStatus:
    if in_time is not None:
        return AttendanceStatus.PRESENT
    current_status = normalize_status(current)
    incoming_status = normalize_status(incoming)
    return (
        incoming_status
        if _status_priority(incoming_status) >= _status_priority(current_status)
        else current_status
    )


def _jsonable(value: Any) -> Any:
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    return value


def _coerce_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Attendance date is invalid.") from exc


def _coerce_datetime(value: Any, attendance_date: date) -> datetime | None:
    if value in (None, ""):
        return None
    parsed: datetime
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, time):
        parsed = datetime.combine(attendance_date, value)
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%H:%M:%S", "%H:%M"):
                try:
                    parsed = datetime.strptime(text, fmt)
                    if fmt.startswith("%H"):
                        parsed = datetime.combine(attendance_date, parsed.time())
                    break
                except ValueError:
                    parsed = None  # type: ignore[assignment]
            if parsed is None:
                return None

    if parsed.date() <= date(1900, 1, 1) and parsed.time() == time(0, 0):
        return None
    if parsed.year == 1900:
        parsed = datetime.combine(attendance_date, parsed.time())
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=attendance_timezone())
    return parsed


def _attendance_row_quality(row: dict[str, Any], row_date: date) -> int:
    in_time = _coerce_datetime(row.get("InTime"), row_date)
    out_time = _coerce_datetime(row.get("OutTime"), row_date)
    status_score = {
        AttendanceStatus.PRESENT: 3,
        AttendanceStatus.HALF_DAY: 2,
        AttendanceStatus.HOLIDAY: 1,
        AttendanceStatus.WEEKOFF: 1,
        AttendanceStatus.ABSENT: 0,
    }[derive_status(row.get("Status"), in_time)]
    return (
        (4 if in_time else 0)
        + (4 if out_time else 0)
        + status_score
        + (1 if row.get("EmployeeName") or row.get("employeeName") else 0)
        + (1 if row.get("Department") or row.get("department") else 0)
    )


def _dedupe_attendance_rows(
    rows: list[dict[str, Any]], sync_date: date
) -> list[dict[str, Any]]:
    selected: dict[tuple[str, date], tuple[int, dict[str, Any]]] = {}
    for index, row in enumerate(rows):
        employee_code = str(row.get("EmployeeCode") or row.get("employeeCode") or "").strip()
        if not employee_code:
            continue
        row_date = _coerce_date(row.get("AttendanceDate") or sync_date)
        key = (employee_code.lower(), row_date)
        current = selected.get(key)
        if current is None:
            selected[key] = (index, dict(row))
            continue

        merged = current[1]
        existing_in = _coerce_datetime(merged.get("InTime"), row_date)
        incoming_in = _coerce_datetime(row.get("InTime"), row_date)
        existing_out = _coerce_datetime(merged.get("OutTime"), row_date)
        incoming_out = _coerce_datetime(row.get("OutTime"), row_date)
        merged_in = _earliest_datetime(existing_in, incoming_in)
        merged_out = _latest_datetime(existing_out, incoming_out)
        merged["InTime"] = merged_in
        merged["OutTime"] = merged_out
        merged["Status"] = _merged_status(
            merged.get("Status"),
            row.get("Status"),
            in_time=merged_in,
        )
        for field in ("EmployeeName", "employeeName", "Department", "department"):
            if not merged.get(field) and row.get(field):
                merged[field] = row[field]

        if _attendance_row_quality(row, row_date) > _attendance_row_quality(merged, row_date):
            for field in row:
                if field not in {"InTime", "OutTime", "Status"} and row.get(field) not in (None, ""):
                    merged[field] = row[field]

    return [entry[1] for entry in sorted(selected.values(), key=lambda item: item[0])]


def _profile_by_code(db: Session, employee_code: str) -> EmployeeProfile | None:
    return db.scalar(
        select(EmployeeProfile)
        .where(func.lower(EmployeeProfile.employee_code) == employee_code.strip().lower())
        .limit(1)
    )


def _ensure_essl_settings() -> None:
    settings = get_settings()
    missing = [
        key
        for key, value in {
            "ESSL_DB_HOST": settings.essl_db_host,
            "ESSL_DB_NAME": settings.essl_db_name,
            "ESSL_DB_USER": settings.essl_db_user,
            "ESSL_DB_PASSWORD": settings.essl_db_password,
        }.items()
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Attendance sync is not configured. Missing env: {', '.join(missing)}.",
        )


def fetch_essl_summary(sync_date: date) -> list[dict[str, Any]]:
    _ensure_essl_settings()
    settings = get_settings()
    try:
        import pymssql
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="pymssql is not installed. Run backend dependency sync before attendance sync.",
        ) from exc

    try:
        with pymssql.connect(
            server=settings.essl_db_host,
            port=settings.essl_db_port,
            user=settings.essl_db_user,
            password=settings.essl_db_password,
            database=settings.essl_db_name,
            login_timeout=settings.essl_login_timeout_seconds,
            timeout=settings.essl_query_timeout_seconds,
            tds_version=settings.essl_tds_version,
            charset="UTF-8",
        ) as connection:
            with connection.cursor(as_dict=True) as cursor:
                cursor.execute(ESSL_SUMMARY_QUERY, (sync_date,))
                return [dict(row) for row in cursor.fetchall()]
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to read ESSL attendance summary: {exc}",
        ) from exc


def upsert_attendance_rows(
    db: Session,
    *,
    sync_date: date,
    rows: list[dict[str, Any]],
    actor: User | None = None,
    is_final: bool = True,
) -> tuple[int, list[str]]:
    rows_synced = 0
    unmapped_codes: list[str] = []

    for row in _dedupe_attendance_rows(rows, sync_date):
        employee_code = str(row.get("EmployeeCode") or row.get("employeeCode") or "").strip()
        if not employee_code:
            continue
        profile = _profile_by_code(db, employee_code)
        if profile is None:
            if employee_code not in unmapped_codes:
                unmapped_codes.append(employee_code)

        row_date = _coerce_date(row.get("AttendanceDate") or sync_date)
        in_time = _coerce_datetime(row.get("InTime"), row_date)
        out_time = _coerce_datetime(row.get("OutTime"), row_date)
        normalized_status = derive_status(row.get("Status"), in_time)
        worked_hours = compute_worked_hours(in_time, out_time)
        raw_payload = {str(key): _jsonable(value) for key, value in row.items()}
        employee_name = (
            profile.full_name
            if profile
            else str(row.get("EmployeeName") or row.get("employeeName") or "").strip() or None
        )
        department = (
            profile.department
            if profile
            else str(row.get("Department") or row.get("department") or "").strip() or None
        )
        stored_employee_code = profile.employee_code if profile else employee_code

        record = db.scalar(
            select(AttendanceRecord)
            .where(
                func.lower(AttendanceRecord.employee_code) == employee_code.lower(),
                AttendanceRecord.attendance_date == row_date,
            )
            .limit(1)
        )
        if record is None and profile is not None:
            record = db.scalar(
                select(AttendanceRecord)
                .where(
                    AttendanceRecord.employee_profile_id == profile.id,
                    AttendanceRecord.attendance_date == row_date,
                )
                .limit(1)
            )

        if record is None:
            record = AttendanceRecord(
                employee_profile_id=profile.id if profile else None,
                employee_code=stored_employee_code,
                employee_name=employee_name,
                department=department,
                attendance_date=row_date,
                in_time=in_time,
                out_time=out_time,
                worked_hours=worked_hours,
                status=normalized_status,
                source=AttendanceSource.BIOMETRIC,
                original_in_time=in_time,
                original_out_time=out_time,
                original_status=normalized_status,
                is_final=is_final,
                raw_payload=raw_payload,
            )
            db.add(record)
        else:
            stable_in_time = _earliest_datetime(record.in_time, in_time)
            stable_out_time = out_time or record.out_time
            stable_status = derive_status(normalized_status, stable_in_time)
            record.employee_profile_id = profile.id if profile else record.employee_profile_id
            record.employee_code = stored_employee_code
            record.employee_name = employee_name or record.employee_name
            record.department = department or record.department
            record.original_in_time = stable_in_time
            record.original_out_time = stable_out_time
            record.original_status = stable_status
            record.is_final = is_final
            record.raw_payload = raw_payload
            if not record.is_edited:
                record.in_time = stable_in_time
                record.out_time = stable_out_time
                record.worked_hours = compute_worked_hours(stable_in_time, stable_out_time)
                record.status = stable_status
                record.source = AttendanceSource.BIOMETRIC
        rows_synced += 1

    return rows_synced, unmapped_codes


def sync_attendance_for_date(
    db: Session,
    *,
    sync_date: date,
    actor: User | None = None,
    force: bool = False,
    is_final: bool = True,
) -> AttendanceSyncLog:
    existing = db.scalar(select(AttendanceSyncLog).where(AttendanceSyncLog.sync_date == sync_date))
    if (
        existing
        and existing.status == AttendanceSyncStatus.COMPLETED
        and existing.is_final
        and (existing.rows_seen or 0) <= (existing.rows_synced or 0)
        and not force
    ):
        return existing

    log = existing or AttendanceSyncLog(sync_date=sync_date)
    log.status = AttendanceSyncStatus.RUNNING
    log.started_at = utcnow()
    log.finished_at = None
    log.rows_seen = 0
    log.rows_synced = 0
    log.unmapped_count = 0
    log.unmapped_codes = []
    log.error = None
    log.is_final = is_final
    db.add(log)
    db.commit()

    try:
        rows = fetch_essl_summary(sync_date)
        rows_synced, unmapped_codes = upsert_attendance_rows(
            db,
            sync_date=sync_date,
            rows=rows,
            actor=actor,
            is_final=is_final,
        )
        log.status = AttendanceSyncStatus.COMPLETED
        log.rows_seen = len(rows)
        log.rows_synced = rows_synced
        log.unmapped_count = len(unmapped_codes)
        log.unmapped_codes = unmapped_codes
        log.finished_at = utcnow()
        db.add(log)
        db.commit()
        db.refresh(log)
        return log
    except HTTPException as exc:
        db.rollback()
        failed = db.scalar(
            select(AttendanceSyncLog).where(AttendanceSyncLog.sync_date == sync_date)
        )
        if failed is None:
            failed = AttendanceSyncLog(sync_date=sync_date)
        failed.status = AttendanceSyncStatus.FAILED
        failed.finished_at = utcnow()
        failed.error = str(exc.detail)
        failed.is_final = is_final
        db.add(failed)
        db.commit()
        raise
    except Exception as exc:
        db.rollback()
        failed = db.scalar(
            select(AttendanceSyncLog).where(AttendanceSyncLog.sync_date == sync_date)
        )
        if failed is None:
            failed = AttendanceSyncLog(sync_date=sync_date)
        failed.status = AttendanceSyncStatus.FAILED
        failed.finished_at = utcnow()
        failed.error = str(exc)
        failed.is_final = is_final
        db.add(failed)
        db.commit()
        raise


def sync_attendance_range(
    db: Session,
    *,
    start_date: date,
    end_date: date,
    actor: User | None = None,
    force: bool = False,
    is_final: bool = True,
    final_resolver: Callable[[date], bool] | None = None,
) -> dict[str, Any]:
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="To date cannot be before from date.")
    if (end_date - start_date).days > 366:
        raise HTTPException(status_code=422, detail="Attendance sync range cannot exceed 367 days.")

    logs: list[AttendanceSyncLog] = []
    rows_seen = 0
    rows_synced = 0
    unmapped_codes: list[str] = []
    current = start_date
    while current <= end_date:
        log = sync_attendance_for_date(
            db,
            sync_date=current,
            actor=actor,
            force=force,
            is_final=final_resolver(current) if final_resolver else is_final,
        )
        logs.append(log)
        rows_seen += log.rows_seen or 0
        rows_synced += log.rows_synced or 0
        for code in log.unmapped_codes or []:
            if code not in unmapped_codes:
                unmapped_codes.append(code)
        current += timedelta(days=1)

    return {
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "days": len(logs),
        "rowsSeen": rows_seen,
        "rowsSynced": rows_synced,
        "unmappedCount": len(unmapped_codes),
        "unmappedCodes": unmapped_codes,
        "logs": logs,
    }
