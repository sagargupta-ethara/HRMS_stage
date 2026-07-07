from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.services.attendance_sync import (
    attendance_local_now,
    is_attendance_day_final,
    sync_attendance_for_date,
)


@celery_app.task(
    name="app.tasks.attendance.refresh_today_attendance",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def refresh_today_attendance(self) -> dict:
    local_now = attendance_local_now()
    sync_targets = [(local_now.date(), is_attendance_day_final(local_now.date(), local_now))]

    # If the worker was down around close of business, this catches up yesterday
    # shortly after midnight instead of leaving it non-final.
    if local_now.hour < 2:
        yesterday = local_now.date() - timedelta(days=1)
        sync_targets.append((yesterday, True))

    results = []
    with SessionLocal() as db:
        for sync_date, is_final in sync_targets:
            try:
                log = sync_attendance_for_date(
                    db,
                    sync_date=sync_date,
                    force=True,
                    is_final=is_final,
                )
            except HTTPException as exc:
                if exc.status_code == 503:
                    results.append(
                        {
                            "date": sync_date.isoformat(),
                            "status": "skipped",
                            "reason": str(exc.detail),
                        }
                    )
                    continue
                raise self.retry(exc=exc) from exc

            status_value = log.status.value if hasattr(log.status, "value") else log.status
            results.append(
                {
                    "date": sync_date.isoformat(),
                    "status": status_value,
                    "rowsSeen": log.rows_seen,
                    "rowsSynced": log.rows_synced,
                    "unmappedCount": log.unmapped_count,
                    "isFinal": log.is_final,
                }
            )
    return {"timezoneNow": local_now.isoformat(), "results": results}
