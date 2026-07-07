#!/usr/bin/env python
from __future__ import annotations

import argparse
from datetime import date

from app.core.database import SessionLocal
from app.services.attendance_sync import (
    attendance_today,
    is_attendance_day_final,
    sync_attendance_for_date,
    sync_attendance_range,
)


def _parse_date(value: str | None) -> date:
    if not value:
        return attendance_today()
    return date.fromisoformat(value)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync ESSL biometric attendance into HRMS.")
    parser.add_argument(
        "--date",
        help=(
            "Attendance date to sync, YYYY-MM-DD. "
            "Defaults to today in ATTENDANCE_BUSINESS_TIMEZONE."
        ),
    )
    parser.add_argument(
        "--year",
        type=int,
        help="Backfill a full year up to today when the year is current.",
    )
    parser.add_argument(
        "--from",
        dest="from_date",
        help="Start date for a range sync, YYYY-MM-DD.",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        help="End date for a range sync, YYYY-MM-DD.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-pull even if the date was already final.",
    )
    parser.add_argument(
        "--intraday",
        action="store_true",
        help="Mark the synced date as non-final for today/live refreshes.",
    )
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.year:
            today = attendance_today()
            if args.year > today.year:
                raise SystemExit("Cannot sync attendance for a future year.")
            start = date(args.year, 1, 1)
            end = min(date(args.year, 12, 31), today)
            result = sync_attendance_range(
                db,
                start_date=start,
                end_date=end,
                force=args.force,
                is_final=not args.intraday,
                final_resolver=None if args.intraday else is_attendance_day_final,
            )
            print(
                f"{start.isoformat()}..{end.isoformat()}: days={result['days']} "
                f"seen={result['rowsSeen']} synced={result['rowsSynced']} "
                f"unmapped={result['unmappedCount']}"
            )
            return

        if args.from_date or args.to_date:
            if not args.from_date or not args.to_date:
                raise SystemExit("Both --from and --to are required for a range sync.")
            start = date.fromisoformat(args.from_date)
            end = date.fromisoformat(args.to_date)
            result = sync_attendance_range(
                db,
                start_date=start,
                end_date=end,
                force=args.force,
                is_final=not args.intraday,
                final_resolver=None if args.intraday else is_attendance_day_final,
            )
            print(
                f"{start.isoformat()}..{end.isoformat()}: days={result['days']} "
                f"seen={result['rowsSeen']} synced={result['rowsSynced']} "
                f"unmapped={result['unmappedCount']}"
            )
            return

        sync_date = _parse_date(args.date)
        log = sync_attendance_for_date(
            db,
            sync_date=sync_date,
            force=args.force,
            is_final=False if args.intraday else is_attendance_day_final(sync_date),
        )
        status_value = log.status.value if hasattr(log.status, "value") else log.status
        print(
            f"{sync_date.isoformat()} {status_value}: "
            f"seen={log.rows_seen} synced={log.rows_synced} unmapped={log.unmapped_count}"
        )


if __name__ == "__main__":
    main()
