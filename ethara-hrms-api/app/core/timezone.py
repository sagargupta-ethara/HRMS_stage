from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

APP_TIME_ZONE = ZoneInfo("Asia/Kolkata")
APP_TIME_ZONE_LABEL = "IST"


def apply_process_timezone() -> None:
    """Pin the OS process clock to IST so every log timestamp emitted by the
    stdlib logger, Uvicorn, and Gunicorn (access + error logs) renders in
    Asia/Kolkata. Idempotent.

    Only wall-clock/log rendering is affected. Database writes go through
    utcnow() / explicit ``datetime.now(UTC)`` and stay UTC, which is intentional.
    """
    os.environ["TZ"] = str(APP_TIME_ZONE)
    if hasattr(time, "tzset"):  # POSIX only; prod is Linux
        time.tzset()


def to_app_timezone(value: datetime) -> datetime:
    aware = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return aware.astimezone(APP_TIME_ZONE)


def format_app_datetime(value: datetime | None, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    if value is None:
        return ""
    return f"{to_app_timezone(value).strftime(fmt)} {APP_TIME_ZONE_LABEL}"


def app_date_stamp(value: datetime | None = None) -> str:
    return to_app_timezone(value or datetime.now(UTC)).strftime("%Y%m%d")
