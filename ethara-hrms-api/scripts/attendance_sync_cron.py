#!/usr/bin/env python
"""Periodic attendance sync for deployments that do not run Celery beat.

This mirrors the Celery attendance task but runs inline so system cron can call
it every 10 minutes:

    */10 * * * * cd /home/ec2-user/ethara-job-portal/main-app/ethara-hrms-api && \
        .venv/bin/python -m scripts.attendance_sync_cron >> .deploy-logs/attendance-cron.log 2>&1
"""
from __future__ import annotations

import fcntl
import logging
import sys
from datetime import timedelta
from pathlib import Path

from fastapi import HTTPException

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [attendance-cron] %(message)s",
)
logger = logging.getLogger("attendance_sync_cron")

LOCK_PATH = Path("/tmp/ethara-attendance-sync-cron.lock")


def main() -> int:
    from app.core.database import SessionLocal
    from app.services.attendance_sync import (
        attendance_local_now,
        is_attendance_day_final,
        sync_attendance_for_date,
    )

    with LOCK_PATH.open("w") as lock_file:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            logger.info("attendance sync already running; skipping this tick")
            return 0

        local_now = attendance_local_now()
        targets = [(local_now.date(), is_attendance_day_final(local_now.date(), local_now))]
        if local_now.hour < 2:
            targets.append((local_now.date() - timedelta(days=1), True))

        failures = 0
        with SessionLocal() as db:
            for sync_date, is_final in targets:
                try:
                    log = sync_attendance_for_date(
                        db,
                        sync_date=sync_date,
                        force=True,
                        is_final=is_final,
                    )
                    status = log.status.value if hasattr(log.status, "value") else log.status
                    logger.info(
                        "date=%s status=%s seen=%s synced=%s unmapped=%s final=%s",
                        sync_date.isoformat(),
                        status,
                        log.rows_seen,
                        log.rows_synced,
                        log.unmapped_count,
                        log.is_final,
                    )
                except HTTPException as exc:
                    if exc.status_code == 503:
                        logger.warning(
                            "date=%s skipped: %s",
                            sync_date.isoformat(),
                            exc.detail,
                        )
                        continue
                    failures += 1
                    logger.exception("date=%s attendance sync failed", sync_date.isoformat())
                except Exception:
                    failures += 1
                    logger.exception("date=%s attendance sync failed", sync_date.isoformat())

        return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
