#!/usr/bin/env python
"""Bulk-set employees' Date of Joining from an Email + DOJ list.

Source can be a CSV file (--csv) or a Google Sheet (--sheet-id [--tab]). The sheet/CSV needs
two columns: an email (Official/Ethara email, or personal email) and a date of joining.
Header names are matched flexibly (email / official email / ethara email; date of joining / doj).

For each row:
  * if the person is a registered employee  -> sets EmployeeProfile.date_of_joining
  * else if they're a pre-loaded (imported) employee -> sets it on the staging row so it
    applies automatically when they register.

DOJ is HR-set only; this never touches anything the employee can edit.

USAGE:
    .venv/bin/python -m scripts.import_date_of_joining --csv /path/doj.csv --dry-run
    .venv/bin/python -m scripts.import_date_of_joining --sheet-id <ID> --tab "Sheet1"
"""
from __future__ import annotations

import argparse
import csv
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [doj-import] %(message)s")
logger = logging.getLogger("import_date_of_joining")

EMAIL_KEYS = ["official email", "ethara email", "email", "company email", "work email"]
DOJ_KEYS = ["date of joining", "doj", "joining date", "date_of_joining"]


def _norm(k: str) -> str:
    return " ".join((k or "").strip().lower().split())


def _pick(row: dict, keys: list[str]) -> str:
    norm = {_norm(k): v for k, v in row.items()}
    for k in keys:
        v = norm.get(k)
        if v not in (None, ""):
            return str(v).strip()
    return ""


def _load_rows(args) -> list[dict]:
    if args.csv:
        with open(args.csv, newline="") as f:
            return list(csv.DictReader(f))
    from app.services import sheets as sheets_service

    return sheets_service.read_sheet_records(args.sheet_id, args.tab)


def main() -> int:
    p = argparse.ArgumentParser(description="Bulk-set Date of Joining from Email+DOJ list.")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", help="Path to a CSV with email + date-of-joining columns.")
    src.add_argument("--sheet-id", help="Google Sheet ID (shared with the service account).")
    p.add_argument("--tab", default=None, help="Worksheet/tab name (with --sheet-id).")
    p.add_argument("--dry-run", action="store_true", help="Report only; no DB writes.")
    args = p.parse_args()

    from sqlalchemy import func, select

    from app.core.database import SessionLocal
    from app.db.models import EmployeeImportStaging, EmployeeProfile
    from app.services.employees import _safe_parse_sheet_date, normalize_email_value

    rows = _load_rows(args)
    logger.info("Loaded %d row(s)%s", len(rows), "  (DRY RUN)" if args.dry_run else "")

    updated_profiles = updated_staging = unmatched = bad_date = 0
    with SessionLocal() as db:
        for row in rows:
            email = normalize_email_value(_pick(row, EMAIL_KEYS))
            doj_raw = _pick(row, DOJ_KEYS)
            if not email or not doj_raw:
                continue
            doj = _safe_parse_sheet_date(doj_raw)
            if doj is None:
                bad_date += 1
                logger.warning("  unparseable DOJ %r for %s", doj_raw, email)
                continue

            prof = db.scalar(
                select(EmployeeProfile).where(
                    (func.lower(func.trim(EmployeeProfile.ethara_email)) == email)
                    | (func.lower(func.trim(EmployeeProfile.personal_email)) == email)
                )
            )
            if prof is not None:
                if not args.dry_run:
                    prof.date_of_joining = doj
                    db.add(prof)
                updated_profiles += 1
                logger.info("  profile  %s <- %s", email, doj.date())
                continue

            stg = db.scalar(
                select(EmployeeImportStaging).where(
                    (func.lower(func.trim(EmployeeImportStaging.ethara_email)) == email)
                    | (func.lower(func.trim(EmployeeImportStaging.personal_email)) == email)
                )
            )
            if stg is not None:
                if not args.dry_run:
                    pf = dict(stg.profile_fields or {})
                    pf["date_of_joining"] = doj.isoformat()
                    stg.profile_fields = pf
                    db.add(stg)
                updated_staging += 1
                logger.info("  staging  %s <- %s", email, doj.date())
                continue

            unmatched += 1
            logger.warning("  no employee/staging match for %s", email)

        if not args.dry_run:
            db.commit()

    logger.info(
        "Done. profiles=%d staging=%d unmatched=%d bad_date=%d%s",
        updated_profiles, updated_staging, unmatched, bad_date,
        "  (DRY RUN — no writes)" if args.dry_run else "",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
