"""Penny-drop bank-account verification.

Office Admin exports a bank "penny drop" sheet (fixed HDFC column layout) for the
onboarded employees, runs the penny drop with the bank, then uploads a result sheet
(Email / Status / Remark). Passing rows are marked validated; failing rows are marked
failed and the employee is notified to fix their bank details.

Bank details live ONLY on the candidate's selection form
(``SelectionForm.form_data['bankDetails']``); the employee is matched back to that
candidate via :func:`app.services.employees._registration_candidate_for_profile`.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exports import csv_safe_mapping
from app.db.models import (
    BankVerification,
    BankVerificationStatus,
    EmployeeProfile,
    NotificationType,
    User,
)
from app.services.employees import _registration_candidate_for_profile
from app.services.workflows import create_notification

# --- Bank sheet (export) -----------------------------------------------------

# Exact HDFC penny-drop column order. Most columns stay blank; only the ones the
# bank needs for an account validation are filled (see _sheet_row).
BANK_SHEET_COLUMNS: list[str] = [
    "Transaction Type (N – NFET, R – RTGS & I - Fund Transfer in HDFC Bank account)",
    "Beneficiary Code (Mandatory In case of Fund Transfer only)",
    "Beneficiary Account Number",
    "Instrument Amount",
    "Beneficiary Name (Upto 40 character without any special character)",
    "Drawee Location",
    "Print Location",
    "Bene Address 1",
    "Bene Address 2",
    "Bene Address 3",
    "Bene Address 4",
    "Bene Address 5",
    "Instruction Reference Number",
    "Customer Reference Number(Which needs to be reflected in statement upto character upto 20)",
    "Payment details 1",
    "Payment details 2",
    "Payment details 3",
    "Payment details 4",
    "Payment details 5",
    "Payment details 6",
    "Payment details 7",
    "Cheque Number",
    "Chq / Trn Date (DD/MM/YYYY)",
    "MICR Number",
    "IFSC Code",
    "Bene Bank Name",
    "Bene Bank Branch Name",
    "Beneficiary email id",
]

# Result-sheet (upload) template columns.
RESULT_COLUMNS: list[str] = ["Email", "Status", "Remark"]

_PASS_TOKENS = {"pass", "passed", "success", "successful", "validated", "valid", "true", "yes", "y", "p"}


def _bank_details_for_profile(db: Session, profile: EmployeeProfile) -> dict[str, str | None]:
    """Pull the bank details an employee entered on their selection form."""
    candidate = _registration_candidate_for_profile(db, profile)
    selection_form = candidate.selection_form if candidate else None
    data = (selection_form.form_data or {}) if selection_form else {}
    bank = data.get("bankDetails") if isinstance(data, dict) else None
    bank = bank if isinstance(bank, dict) else {}
    return {
        "accountNumber": (bank.get("accountNumber") or "").strip(),
        "ifsc": (bank.get("ifsc") or "").strip().upper(),
        "bankName": (bank.get("bankName") or "").strip(),
        "accountHolderName": (bank.get("accountHolderName") or "").strip(),
        "candidateId": candidate.id if candidate else None,
    }


def _is_hdfc(bank: dict[str, Any]) -> bool:
    ifsc = (bank.get("ifsc") or "")
    name = (bank.get("bankName") or "").lower()
    return ifsc.upper().startswith("HDFC") or "hdfc" in name


def _has_details(bank: dict[str, Any]) -> bool:
    return bool(bank.get("accountNumber") and bank.get("ifsc"))


def _sanitize_beneficiary_name(name: str | None) -> str:
    """Strip special characters (bank rule) and cap at 40 chars."""
    cleaned = re.sub(r"[^A-Za-z0-9 ]+", "", name or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:40]


def _sheet_row(profile: EmployeeProfile, bank: dict[str, Any]) -> dict[str, str]:
    cols = BANK_SHEET_COLUMNS
    row = {c: "" for c in cols}
    is_hdfc = _is_hdfc(bank)
    account = bank.get("accountNumber") or ""
    email = profile.ethara_email or ""
    row[cols[0]] = "I" if is_hdfc else "N"          # Transaction Type (I = internal HDFC, N = NEFT)
    row[cols[1]] = account if is_hdfc else ""        # Beneficiary Code (HDFC fund transfer only)
    row[cols[2]] = account                           # Beneficiary Account Number
    row[cols[4]] = _sanitize_beneficiary_name(profile.full_name)  # Beneficiary Name
    row[cols[13]] = email                            # Customer Reference Number = ethara email
    row[cols[24]] = bank.get("ifsc") or ""           # IFSC Code
    row[cols[25]] = bank.get("bankName") or ""       # Bene Bank Name
    row[cols[27]] = email                            # Beneficiary email id
    return row


def _record_map(db: Session) -> dict[str, BankVerification]:
    return {
        record.employee_profile_id: record
        for record in db.scalars(select(BankVerification)).all()
    }


def list_bank_verifications(db: Session) -> list[dict[str, Any]]:
    """One row per employee with their bank-details completeness + verification status."""
    profiles = db.scalars(
        select(EmployeeProfile).order_by(EmployeeProfile.created_at.desc())
    ).all()
    records = _record_map(db)
    out: list[dict[str, Any]] = []
    for profile in profiles:
        bank = _bank_details_for_profile(db, profile)
        has = _has_details(bank)
        record = records.get(profile.id)
        if not has:
            status = "missing_details"
        elif record is not None:
            status = record.status
        else:
            status = BankVerificationStatus.PENDING.value
        account = bank.get("accountNumber") or ""
        out.append(
            {
                "employeeProfileId": profile.id,
                "employeeCode": profile.employee_code,
                "name": profile.full_name,
                "etharaEmail": profile.ethara_email,
                "bankName": bank.get("bankName") or "",
                "ifsc": bank.get("ifsc") or "",
                "accountLast4": account[-4:] if account else "",
                "accountHolderName": bank.get("accountHolderName") or "",
                "hasBankDetails": has,
                "isHdfc": _is_hdfc(bank) if has else False,
                "status": status,
                "remark": record.remark if record else None,
                "exportedAt": record.exported_at.isoformat() if record and record.exported_at else None,
                "validatedAt": record.validated_at.isoformat() if record and record.validated_at else None,
            }
        )
    return out


def build_bank_sheet(
    db: Session,
    *,
    profile_ids: list[str] | None = None,
    include_validated: bool = False,
    actor: User | None = None,
) -> tuple[str, int]:
    """Build the penny-drop CSV and stamp the exported employees. Returns (csv, count)."""
    profiles = db.scalars(
        select(EmployeeProfile).order_by(EmployeeProfile.created_at.desc())
    ).all()
    records = _record_map(db)
    selected = set(profile_ids) if profile_ids else None
    now = datetime.now(UTC)
    rows: list[dict[str, str]] = []
    for profile in profiles:
        if selected is not None and profile.id not in selected:
            continue
        bank = _bank_details_for_profile(db, profile)
        if not _has_details(bank):
            continue
        record = records.get(profile.id)
        status = record.status if record else BankVerificationStatus.PENDING.value
        if status == BankVerificationStatus.VALIDATED.value and not include_validated:
            continue
        rows.append(_sheet_row(profile, bank))
        if record is None:
            record = BankVerification(
                employee_profile_id=profile.id,
                ethara_email=profile.ethara_email,
                status=BankVerificationStatus.PENDING.value,
            )
            db.add(record)
            records[profile.id] = record
        record.exported_at = now
        if actor is not None:
            record.updated_by = actor.id
            record.updated_by_name = actor.name
    return _rows_to_csv(rows), len(rows)


def _rows_to_csv(rows: list[dict[str, str]]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=BANK_SHEET_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(csv_safe_mapping(row))
    return buffer.getvalue()


# --- Result sheet (upload) ---------------------------------------------------


def parse_results_csv(raw: bytes) -> list[dict[str, str]]:
    """Parse an uploaded result sheet into [{email, status, remark}]. Raises ValueError."""
    if len(raw) > 5 * 1024 * 1024:
        raise ValueError("File too large (max 5MB).")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("The file appears to be empty or has no header row.")
    norm = {(header or "").strip().lower(): header for header in reader.fieldnames}

    def pick(*aliases: str) -> str | None:
        for alias in aliases:
            if alias in norm:
                return norm[alias]
        return None

    email_col = pick("email", "email id", "emailid", "email address", "ethara email", "beneficiary email id")
    status_col = pick("status", "result", "pass/fail", "pass / fail", "passfail", "verdict", "outcome")
    remark_col = pick("remark", "remarks", "reason", "failure reason", "comment", "comments", "note", "notes")
    if not email_col or not status_col:
        raise ValueError("The sheet must include an 'Email' column and a 'Status' (Pass/Fail) column.")
    rows: list[dict[str, str]] = []
    for raw_row in reader:
        rows.append(
            {
                "email": (raw_row.get(email_col) or "").strip(),
                "status": (raw_row.get(status_col) or "").strip(),
                "remark": (raw_row.get(remark_col) or "").strip() if remark_col else "",
            }
        )
    return rows


def apply_results(db: Session, *, rows: list[dict[str, str]], actor: User | None) -> dict[str, Any]:
    """Mark each employee validated/failed by the result rows; notify on failure."""
    profiles_by_email = {
        profile.ethara_email.lower(): profile
        for profile in db.scalars(select(EmployeeProfile)).all()
        if profile.ethara_email
    }
    records = _record_map(db)
    now = datetime.now(UTC)
    validated = 0
    failed = 0
    not_found: list[str] = []

    for row in rows:
        email = (row.get("email") or "").strip().lower()
        if not email:
            continue
        profile = profiles_by_email.get(email)
        if profile is None:
            not_found.append(row.get("email") or email)
            continue
        record = records.get(profile.id)
        if record is None:
            record = BankVerification(
                employee_profile_id=profile.id,
                ethara_email=profile.ethara_email,
                status=BankVerificationStatus.PENDING.value,
            )
            db.add(record)
            db.flush()
            records[profile.id] = record

        remark = (row.get("remark") or "").strip()
        is_pass = (row.get("status") or "").strip().lower() in _PASS_TOKENS
        if is_pass:
            record.status = BankVerificationStatus.VALIDATED.value
            record.validated_at = now
            record.remark = remark or None
            validated += 1
        else:
            record.status = BankVerificationStatus.FAILED.value
            record.remark = remark or "Penny drop verification failed."
            failed += 1
            if profile.user_id:
                detail = f": {remark}" if remark else ""
                create_notification(
                    db,
                    user_id=profile.user_id,
                    title="Bank account verification failed",
                    message=(
                        f"Your bank account could not be verified{detail}. "
                        "Please update your bank account details in the Employee Detail Form."
                    ),
                    type_=NotificationType.ACTION,
                    entity_type="bank_verification",
                    entity_id=record.id,
                )
        if actor is not None:
            record.updated_by = actor.id
            record.updated_by_name = actor.name

    return {"validated": validated, "failed": failed, "notFound": not_found}


def results_template_csv() -> str:
    """A tiny example result sheet for the office admin to fill in."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(RESULT_COLUMNS)
    writer.writerow(["jane.doe@ethara.ai", "Pass", ""])
    writer.writerow(["john.smith@ethara.ai", "Fail", "Account number / IFSC mismatch"])
    return buffer.getvalue()
