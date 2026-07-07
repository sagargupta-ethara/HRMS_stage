#!/usr/bin/env python
"""Pre-load existing employees from the HR Google Sheet into staging.

Reads the all-employee Google Sheet, downloads each employee's documents from their
Google Drive links, and writes one `employee_import_staging` row per employee. NOTHING
here creates a User account or sends any email — the data is merged into an EmployeeProfile
later, when the employee self-registers (see employee_service.apply_employee_import_staging).

PREREQUISITES (do these in Google first):
  * Share the Google Sheet (Viewer is enough) with the service-account email
    (the `client_email` in GOOGLE_SERVICE_ACCOUNT_JSON*, e.g. your-service-account@your-gcp-project.iam...).
  * Share the Drive folder(s) holding the Aadhaar/PAN/photo/qualification files with the
    same email. Files that aren't shared are skipped + logged (the row is still staged).

USAGE:
    .venv/bin/python -m scripts.import_employees_from_sheet --sheet-id <ID> --tab "<Tab>" --dry-run
    .venv/bin/python -m scripts.import_employees_from_sheet --sheet-id <ID> --tab "<Tab>" --limit 3
    .venv/bin/python -m scripts.import_employees_from_sheet --sheet-id <ID> --tab "<Tab>"
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [employee-import] %(message)s",
)
logger = logging.getLogger("import_employees_from_sheet")


# ── Sheet column -> meaning. Lookup is whitespace/case/punctuation tolerant. ────────────
def _norm_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (key or "").lower())


def _row_getter(row: dict[str, Any]):
    normalized = {_norm_key(k): v for k, v in row.items()}

    def get(*names: str) -> str:
        for name in names:
            value = normalized.get(_norm_key(name))
            if value not in (None, ""):
                return str(value).strip()
        return ""

    return get


def _clean_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else digits


# Sheet column header -> (employee Drive link, EmployeeDocument type)
_DOCUMENT_COLUMNS = [
    ("Passport Size Photo Link", "photo"),
    ("Highest Educational Qualification Link", "highest_qualification"),
    ("Aadhaar Card Link", "aadhaar"),
    ("PAN Card Link", "pan"),
]


def _build_profile_fields(get) -> dict[str, Any]:
    return {
        "full_name": get("Employee Name"),
        "ethara_email": get("Official Email"),
        "personal_email": get("Personal Email"),
        "employee_code": get("E.Code", "ECode", "Employee Code"),
        "phone": _clean_phone(get("Contact Number")),
        "department": get("Department"),
        "designation": get("Designation"),
        "gender": get("Gender"),
        "date_of_birth": get("DOB", "Date Of Birth"),
        "blood_group": get("Blood Group"),
        "emergency_contact_name": get("Emergency Contact's Name", "Emergency Contacts Name"),
        "emergency_contact_phone": _clean_phone(get("Emergency Contact")),
        "emergency_contact_relation": get("Emergency Contact's Relation", "Emergency Contacts Relation"),
        # HR/admin-only fields:
        "vendor": get("Vendor"),
        "employment_status": get("Status"),
        "work_mode": get("Work Mode"),
        "date_of_joining": get("Date Of Joining", "Date of Joining", "DOJ"),
    }


def _build_form_data(get) -> dict[str, Any]:
    """Selection-form payload (keys match the existing employee form schema)."""
    data = {
        "employeeCode": get("E.Code", "ECode", "Employee Code"),
        "employeeName": get("Employee Name"),
        "department": get("Department"),
        "designation": get("Designation"),
        "dateOfBirth": get("DOB", "Date Of Birth"),
        "gender": get("Gender"),
        "contactNumber": _clean_phone(get("Contact Number")),
        "maritalStatus": get("Marital Status"),
        "bloodGroup": get("Blood Group"),
        "highestQualification": get("Educational Qualification", "Highest Educational Qualification"),
        "personalEmail": get("Personal Email"),
        "officialEmail": get("Official Email"),
        "fatherName": get("Father's Name", "Fathers Name"),
        "fatherDateOfBirth": get("Father's DOB", "Fathers DOB"),
        "motherName": get("Mother's Name", "Mothers Name"),
        "motherDateOfBirth": get("Mother's DOB", "Mothers DOB"),
        "currentAddress": get("Present Address"),
        "permanentAddress": get("Permanent Address"),
        "emergencyContactName": get("Emergency Contact's Name", "Emergency Contacts Name"),
        "emergencyContactPhone": _clean_phone(get("Emergency Contact")),
        "emergencyContactRelation": get("Emergency Contact's Relation", "Emergency Contacts Relation"),
        # Full Aadhaar/PAN stored verbatim (per HR requirement). Aadhaar digits only (spaces
        # stripped); PAN upper-cased.
        "aadhaarNumber": re.sub(r"\s", "", get("Aadhaar Number")),
        "panNumber": get("PAN").upper(),
        "uanNumber": get("UAN Number"),
        "bankName": get("Bank Name"),
        "bankAccount": get("Bank Account Number"),
        "ifscCode": get("Bank IFSC"),
        # Family (conditional):
        "spouseName": get("Spouse Name"),
        "spouseGender": get("Spouse Gender"),
        "spouseDateOfBirth": get("Spouse DOB"),
        "child1Name": get("Child Name 1"),
        "child1Gender": get("Child Name 1 Gender"),
        "child1DateOfBirth": get("Child Name 1 DOB"),
        "child2Name": get("Child Name 2"),
        "child2Gender": get("Child Name 2 Gender"),
        "child2DateOfBirth": get("Child Name 2 DOB"),
        # Extra HR context (no dedicated form field; kept for reference):
        "dateOfJoining": get("Date Of Joining"),
        "workMode": get("Work Mode"),
        "vendor": get("Vendor"),
        "status": get("Status"),
        "totalExperience": get("Total Experience"),
        "lastOrganization": get("Last Organization"),
        "lastDesignation": get("Last Designation"),
        "form11": get("Form-11", "Form 11"),
    }
    return {k: v for k, v in data.items() if v not in (None, "")}


def _download_documents(get, *, dry_run: bool) -> tuple[list[dict[str, Any]], list[str]]:
    """Returns (documents, skipped_messages)."""
    from app.services import sheets as sheets_service
    from app.services.integrations import StorageService

    documents: list[dict[str, Any]] = []
    skipped: list[str] = []
    for column, doc_type in _DOCUMENT_COLUMNS:
        link = get(column)
        if not link:
            continue
        if dry_run:
            file_id = sheets_service.extract_drive_file_id(link)
            if file_id:
                logger.info("    [dry-run] would download %s (id=%s)", doc_type, file_id)
            else:
                skipped.append(f"{doc_type}: unparseable link {link!r}")
            continue
        try:
            content, mime_type, filename = sheets_service.download_drive_file(link)
            file_url, _path = StorageService().save_bytes(
                content,
                folder="employee_documents",
                filename=filename or f"{doc_type}",
                content_type=mime_type,
            )
            documents.append(
                {
                    "type": doc_type,
                    "file_url": file_url,
                    "file_name": filename or f"{doc_type}",
                    "mime_type": mime_type,
                    "file_size": len(content),
                }
            )
            logger.info("    downloaded %s -> %s (%d bytes)", doc_type, file_url, len(content))
        except Exception as exc:  # noqa: BLE001 - skip a single unreachable doc, keep the row
            skipped.append(f"{doc_type}: {exc}")
            logger.warning("    SKIP %s (%s): %s", doc_type, column, exc)
    return documents, skipped


def _upsert_staging(db, *, profile_fields, form_data, aadhaar_hash, aadhaar_last4, documents, source_row):
    from sqlalchemy import func, select

    from app.db.models import EmployeeImportStaging

    ethara = (profile_fields.get("ethara_email") or "").strip().lower() or None
    personal = (profile_fields.get("personal_email") or "").strip().lower() or None
    phone = (profile_fields.get("phone") or "").strip() or None
    code = (profile_fields.get("employee_code") or "").strip() or None

    row = None
    if ethara:
        row = db.scalar(
            select(EmployeeImportStaging).where(
                func.lower(func.trim(EmployeeImportStaging.ethara_email)) == ethara
            )
        )
    if row is None and code:
        row = db.scalar(
            select(EmployeeImportStaging).where(EmployeeImportStaging.employee_code == code)
        )

    if row is None:
        row = EmployeeImportStaging(status="pending")
        db.add(row)
    elif row.status == "consumed":
        logger.info("    already consumed (employee registered) — leaving as-is")
        return row

    row.ethara_email = ethara
    row.personal_email = personal
    row.phone = phone
    row.employee_code = code
    row.profile_fields = profile_fields
    row.form_data = form_data
    row.aadhaar_hash = aadhaar_hash
    row.aadhaar_last4 = aadhaar_last4
    row.documents = documents
    row.source_row = source_row
    row.status = "pending"
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description="Import employees from the HR Google Sheet into staging.")
    parser.add_argument("--sheet-id", required=True, help="Google Sheet ID (from the sheet URL).")
    parser.add_argument("--tab", default=None, help="Worksheet/tab name (default: first sheet).")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N rows.")
    parser.add_argument("--dry-run", action="store_true", help="Parse + report only; no downloads, no DB writes.")
    args = parser.parse_args()

    from app.core.database import SessionLocal
    from app.core.security import fingerprint_identifier
    from app.services import sheets as sheets_service

    try:
        rows = sheets_service.read_sheet_records(args.sheet_id, args.tab)
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not read the sheet (is it shared with the service account?): %s", exc)
        return 1

    if args.limit:
        rows = rows[: args.limit]

    logger.info("Read %d data row(s) from sheet %s%s", len(rows), args.sheet_id,
                f" / tab {args.tab!r}" if args.tab else "")

    total = staged = docs_ok = docs_skipped = errors = 0

    db = None if args.dry_run else SessionLocal()
    try:
        for idx, row in enumerate(rows, start=1):
            get = _row_getter(row)
            name = get("Employee Name")
            ethara = get("Official Email")
            if not name and not ethara:
                continue  # blank row
            total += 1
            logger.info("[%d] %s <%s>", idx, name or "(no name)", ethara or "(no official email)")

            try:
                profile_fields = _build_profile_fields(get)
                form_data = _build_form_data(get)

                aadhaar_raw = re.sub(r"\D", "", get("Aadhaar Number"))
                aadhaar_hash = fingerprint_identifier(aadhaar_raw) if len(aadhaar_raw) == 12 else None
                aadhaar_last4 = aadhaar_raw[-4:] if len(aadhaar_raw) >= 4 else None

                documents, skipped = _download_documents(get, dry_run=args.dry_run)
                docs_ok += len(documents)
                docs_skipped += len(skipped)

                if args.dry_run:
                    logger.info("    [dry-run] profile_fields=%s", {k: v for k, v in profile_fields.items() if v})
                    logger.info("    [dry-run] form_data keys=%s", sorted(form_data.keys()))
                    staged += 1
                    continue

                _upsert_staging(
                    db,
                    profile_fields=profile_fields,
                    form_data=form_data,
                    aadhaar_hash=aadhaar_hash,
                    aadhaar_last4=aadhaar_last4,
                    documents=documents,
                    source_row=row,
                )
                db.commit()
                staged += 1
            except Exception as exc:  # noqa: BLE001
                errors += 1
                if db is not None:
                    db.rollback()
                logger.exception("[%d] FAILED: %s", idx, exc)
    finally:
        if db is not None:
            db.close()

    logger.info(
        "Done. rows=%d staged=%d docs_downloaded=%d docs_skipped=%d errors=%d%s",
        total, staged, docs_ok, docs_skipped, errors, "  (DRY RUN — no writes)" if args.dry_run else "",
    )
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
