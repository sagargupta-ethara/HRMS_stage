from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, date, datetime, time
from io import BytesIO
import concurrent.futures
import html
import logging
import mimetypes
import re
from pathlib import Path
from secrets import token_urlsafe
from typing import Any
from urllib.parse import quote, urlparse

from fastapi import UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.core.config import get_settings
from app.core.security import fingerprint_identifier, hash_password
from app.core.signed_urls import make_signed_upload_url
from app.db.models import (
    AdminSetting,
    AttendanceRecord,
    AuditLog,
    Candidate,
    CandidateIdCardForm,
    CandidateStage,
    CareerApplication,
    ContractStatus,
    DocumensoSignedProfile,
    EmployeeComplianceForm,
    EmployeeContract,
    EmployeeDocument,
    EmployeeImportStaging,
    EmployeeLeaveBalance,
    EmployeeProfile,
    EmployeeSelectionForm,
    EmployeeSeparation,
    ITRequest,
    ReimbursementRequest,
    Notification,
    NotificationType,
    Position,
    Role,
    SourceType,
    User,
)
from app.services import candidates as candidate_service
from app.services import vertex_ai
from app.services.audit import log_audit
from app.services.integrations import EmailService, StorageService


logger = logging.getLogger(__name__)

EMPLOYEE_REGISTRATION_ENTITY = "employee_registration"
EMPLOYEE_DATE_INPUT_FORMATS = (
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%d-%b-%Y",
    "%d %b %Y",
    "%d-%B-%Y",
    "%m/%d/%Y",
)
EMPLOYEE_STAFF_ROLES = {
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.LEADERSHIP,
    Role.HR,
    Role.TA,
    Role.IT_TEAM,
    Role.COMPLIANCE,
    Role.OFFICE_ADMIN,
}
EMPLOYEE_SELF_ROLES = {Role.EMPLOYEE, Role.EMPLOYEE_REFERRER}
EMPLOYEE_REQUIRED_DOCUMENTS: list[tuple[str, str]] = [
    ("resume", "Resume"),
    ("photo", "Passport Size Photo"),
    ("aadhaar", "Aadhaar Card"),
    ("pan", "PAN Card"),
    ("education_10th", "10th Marksheet / Certificate"),
    ("education_12th", "12th / Diploma Marksheet / Certificate"),
    ("highest_qualification", "Highest Qualification Certificate"),
    ("cancelled_cheque", "Cancelled Cheque / Passbook Photo"),
    ("permanent_address_proof", "Permanent Address Proof"),
]
EMPLOYEE_REFERENCE_DEPARTMENTS = [
    "Accounts & Admin",
    "Communications and Partnerships",
    "Engineering",
    "Growth",
    "Human Resources",
    "IT",
    "Operations - Technical",
    "Operations - Generalist",
    "R&D",
]
EMPLOYEE_REFERENCE_DESIGNATIONS = [
    "AI Research Engineer",
    "AI Researcher",
    "Assistant Manager - IT",
    "Communications & Partnerships Lead",
    "CTO",
    "DevOps",
    "F&A Executive",
    "Frontend Engineer",
    "Graphic Designer",
    "Graphic/UI UX",
    "Growth Associate",
    "Head of Operations",
    "Head-Recruitment",
    "HR Consultant",
    "HR Executive",
    "HR Manager",
    "HR Ops - Lead",
    "HR Ops - Specialist",
    "IT Head",
    "Jr. Flutter Developer",
    "LLM Post Training- Intern",
    "Manager-HR",
    "Odoo Developer",
    "Project Lead",
    "Project Manager",
    "QA Tester",
    "Quality Lead",
    "Quality Reviewer",
    "Research Lead",
    "Senior Executive",
    "Senior Growth Analyst",
    "Senior Manager-Growth",
    "Software Engineer",
    "Sr Growth Lead",
    "Sr. Exe-Communications and Partnerships",
    "System Admin",
    "System and Network Support Engineer",
    "System IT Admin",
    "TA Lead",
    "TA Specialist",
    "Technical Recruiter",
    "TPM",
]
EMPLOYEE_DOCUMENT_TYPE_ALIASES: dict[str, str] = {
    "passport_photo": "photo",
    "passport_size_photo": "photo",
    "selection_form_passport_size_photo": "photo",
    "profile_photo": "photo",
    "photograph": "photo",
    "aadhar": "aadhaar",
    "aadhar_card": "aadhaar",
    "aadhaar_card": "aadhaar",
    "aadhaar_doc": "aadhaar",
    "aadhaar_document": "aadhaar",
    "candidate_aadhaar": "aadhaar",
    "selection_form_aadhaar_doc": "aadhaar",
    "adhar": "aadhaar",
    "pan_card": "pan",
    "pancard": "pan",
    "pan_doc": "pan",
    "pan_document": "pan",
    "selection_form_pan_doc": "pan",
    "selection_form_pan_document": "pan",
    "marksheet_10th": "education_10th",
    "selection_form_marksheet_10th": "education_10th",
    "10th": "education_10th",
    "10th_marksheet": "education_10th",
    "class_10": "education_10th",
    "class_10th": "education_10th",
    "education_10": "education_10th",
    "education_10th_certificate": "education_10th",
    "ssc": "education_10th",
    "marksheet_12th": "education_12th",
    "selection_form_marksheet_12th": "education_12th",
    "12th": "education_12th",
    "12th_marksheet": "education_12th",
    "class_12": "education_12th",
    "class_12th": "education_12th",
    "education_12": "education_12th",
    "education_12th_certificate": "education_12th",
    "hsc": "education_12th",
    "graduation": "highest_qualification",
    "post_graduation": "highest_qualification",
    "selection_form_graduation": "highest_qualification",
    "selection_form_post_graduation": "highest_qualification",
    "degree": "highest_qualification",
    "qualification": "highest_qualification",
    "education": "highest_qualification",
    "education_certificate": "highest_qualification",
    "educational_certificate": "highest_qualification",
    "education_document": "highest_qualification",
    "educational_document": "highest_qualification",
    "educational_details": "highest_qualification",
    "highest_education": "highest_qualification",
    "highest_qualification_certificate": "highest_qualification",
    "highest_qualification_doc": "highest_qualification",
    "highest_qualification_document": "highest_qualification",
    "cancelled_check": "cancelled_cheque",
    "canceled_cheque": "cancelled_cheque",
    "cancelled_cheque_photo": "cancelled_cheque",
    "selection_form_cancelled_cheque": "cancelled_cheque",
    "cheque": "cancelled_cheque",
    "passbook": "cancelled_cheque",
    "passbook_photo": "cancelled_cheque",
    "bank_document": "cancelled_cheque",
    "address": "permanent_address_proof",
    "address_proof": "permanent_address_proof",
    "addressproof": "permanent_address_proof",
    "address_document": "permanent_address_proof",
    "permanent_address": "permanent_address_proof",
    "permanent_address_doc": "permanent_address_proof",
    "permanent_address_document": "permanent_address_proof",
    "permanent_addressproof": "permanent_address_proof",
    "selection_form_permanent_address_proof": "permanent_address_proof",
    "current_address": "current_address_proof",
    "current_address_doc": "current_address_proof",
    "current_address_document": "current_address_proof",
    "current_addressproof": "current_address_proof",
    "current_address_proof": "current_address_proof",
    "selection_form_current_address_proof": "current_address_proof",
}
# Compliance is handled entirely via Documenso e-sign forms (Form 11 / Form 2 / Form F),
# sent to the employee's Ethara email by HR (see app/services/compliance_documenso.py).
# The old in-app fill-forms are disabled so the Compliance tab shows the Documenso forms only.
EMPLOYEE_COMPLIANCE_TEMPLATES: list[tuple[str, str]] = []
EMPLOYEE_UAN_LENGTH = 12
EMPLOYEE_UAN_PREFIX = "10"
EMPLOYEE_EDIT_ACCESS_NAMESPACE = "employee_edit_access"
EMPLOYEE_REFERENCE_NAMESPACE = "employee_reference"
EMPLOYEE_DEPARTMENT_ADMINS_KEY = "employee_department_admins"
EMPLOYEE_PHONE_PATTERN = re.compile(r"^[6-9]\d{9}$")
EMPLOYEE_PERSONAL_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
EMPLOYEE_AADHAAR_PATTERN = re.compile(r"^\d{12}$")
EMPLOYEE_ACCOUNT_NUMBER_PATTERN = re.compile(r"^\d{9,18}$")
EMPLOYEE_IFSC_CODE_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
EMPLOYEE_PF_ACCOUNT_MAX_LENGTH = 30
EMPLOYEE_PF_ACCOUNT_PATTERN = re.compile(r"^[A-Z0-9/]{7,30}$")
EMPLOYEE_COMPLETION_STAGES = {
    "basic_profile",
    "selection_form",
    "documents",
    "contract",
    "compliance",
}


def _normalize_aadhaar_number(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _valid_aadhaar_number(value: Any) -> str:
    digits = _normalize_aadhaar_number(value)
    return digits if EMPLOYEE_AADHAAR_PATTERN.fullmatch(digits) else ""


EMPLOYEE_BLACKLIST_SEPARATION_TYPES = {"termination", "no_show", "absconding"}


def _employee_status_from_separation(db: Session, profile: EmployeeProfile, user: User | None) -> str:
    latest_blacklist = db.scalar(
        select(EmployeeSeparation)
        .where(
            EmployeeSeparation.employee_profile_id == profile.id,
            EmployeeSeparation.separation_type.in_(EMPLOYEE_BLACKLIST_SEPARATION_TYPES),
            EmployeeSeparation.status == "approved",
        )
        .order_by(EmployeeSeparation.created_at.desc())
    )
    if latest_blacklist:
        label = latest_blacklist.separation_type.replace("_", " ").replace("-", " ").title()
        return f"Blacklisted: {label}"
    return "active" if user and user.is_active else "offboarded"


def normalize_email_value(email: str) -> str:
    return email.strip().lower()


def normalize_employee_code(code: str) -> str:
    # Canonicalize by dropping spaces/hyphens so "GRP-1252" / "GRP 1252" collapse to "GRP1252".
    # That format drift previously let a code silently double-assign and split the attendance feed
    # (the profile held "GRP-1252" while biometric rows arrived as "GRP1252").
    return re.sub(r"[\s\-]+", "", code or "").upper()


# Blood group is stored in a short column (see EmployeeProfile.blood_group). Various entry
# points are free-text (HR id-card capture, OCR), so values like "A- (NEGATIVE)" arrive and
# overflow the column, aborting the whole save with a 500. Canonicalize to the standard short
# code (e.g. "A-"), and length-cap anything we cannot parse so a write can never overflow.
_BLOOD_GROUP_MAX = 32
_BLOOD_GROUP_TYPE_RE = re.compile(r"AB|A|B|O", re.IGNORECASE)


def normalize_blood_group(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    upper = text.upper()
    type_match = _BLOOD_GROUP_TYPE_RE.search(upper)
    if type_match:
        group = type_match.group(0)
        if "+" in upper or "POS" in upper:
            sign = "+"
        elif "-" in upper or "NEG" in upper:
            sign = "-"
        else:
            sign = ""
        if sign:
            return f"{group}{sign}"
    return text[:_BLOOD_GROUP_MAX]


# Sequential employee-code (GRP) allocator.
# Existing codes look like ``GRP1554``. We find the highest number currently in use across
# every place a code can live (employee profiles, import staging, candidates, and submitted
# ID-card forms) and hand out the next one, skipping any number already taken.
EMPLOYEE_CODE_PREFIX = "GRP"
# Floor so the very first generated code stays in the established 4-digit GRP1xxx range even
# if every existing code were somehow removed.
_EMPLOYEE_CODE_FLOOR = 1000
_GRP_CODE_RE = re.compile(r"^GRP0*(\d+)$", re.IGNORECASE)
# Persisted high-water mark for the sequence. It only ever moves UP, so deleting an employee
# (even the most-recent one) never lets its number be handed out again — important because
# attendance/reimbursement rows are keyed by employee code and must not collide with a reused one.
EMPLOYEE_CODE_SEQ_KEY = "employee_code_seq"


def _grp_number(code: str | None) -> int | None:
    if not code:
        return None
    match = _GRP_CODE_RE.match(code.strip())
    return int(match.group(1)) if match else None


def _employee_code_exists(db: Session, code: str) -> bool:
    """True if ``code`` is already used as an employee/candidate/ID-card code anywhere."""
    norm = code.strip().upper()
    sources = (
        EmployeeProfile.employee_code,
        EmployeeImportStaging.employee_code,
        Candidate.employee_code,
        CandidateIdCardForm.employee_id,
    )
    for column in sources:
        if db.scalar(select(column).where(func.upper(column) == norm).limit(1)) is not None:
            return True
    return False


def _employee_code_seq_setting(db: Session, *, lock: bool = False) -> AdminSetting | None:
    stmt = select(AdminSetting).where(AdminSetting.key == EMPLOYEE_CODE_SEQ_KEY)
    if lock:
        # Serialise concurrent allocations (two contract-signs at once) by locking the
        # counter row, so they can't read the same high-water mark and mint the same code.
        stmt = stmt.with_for_update()
    return db.scalar(stmt)


def _high_water_mark(db: Session, *, lock: bool = False) -> int:
    """Highest GRP number ever reached: the max of the persisted counter and any code that
    currently exists in the data (covers imported codes that predate the counter)."""
    highest = _EMPLOYEE_CODE_FLOOR
    setting = _employee_code_seq_setting(db, lock=lock)
    if setting is not None and isinstance(setting.value, (int, float)):
        highest = max(highest, int(setting.value))
    for column in (
        EmployeeProfile.employee_code,
        EmployeeImportStaging.employee_code,
        Candidate.employee_code,
        CandidateIdCardForm.employee_id,
    ):
        for value in db.scalars(select(column).where(column.is_not(None))).all():
            number = _grp_number(value)
            if number is not None and number > highest:
                highest = number
    return highest


def _bump_employee_code_seq(db: Session, number: int) -> None:
    """Persist the high-water mark so the sequence never moves backward (even after a delete)."""
    setting = _employee_code_seq_setting(db)
    if setting is None:
        setting = AdminSetting(
            namespace="system",
            key=EMPLOYEE_CODE_SEQ_KEY,
            description="High-water mark for sequential GRP employee codes. Only ever increases.",
        )
        db.add(setting)
    current = int(setting.value) if isinstance(setting.value, (int, float)) else 0
    setting.value = max(current, int(number))
    db.flush()


def generate_employee_code(db: Session) -> str:
    """Allocate the next sequential GRP employee code, guaranteed unique across every table
    that stores one AND never reused once handed out (a persisted counter only moves up).
    Safe to call repeatedly — never returns a code already in use."""
    # Lock the counter row for the duration of this transaction so concurrent allocations
    # serialise instead of racing to the same number.
    candidate_number = _high_water_mark(db, lock=True) + 1
    while _employee_code_exists(db, f"{EMPLOYEE_CODE_PREFIX}{candidate_number}"):
        candidate_number += 1
    _bump_employee_code_seq(db, candidate_number)
    return f"{EMPLOYEE_CODE_PREFIX}{candidate_number}"


def assign_candidate_employee_code(db: Session, candidate: Candidate) -> str:
    """Idempotently assign a sequential GRP employee code to a candidate (called when the
    contract is signed). Returns the existing code unchanged if one is already set."""
    if candidate.employee_code:
        return candidate.employee_code
    code = generate_employee_code(db)
    candidate.employee_code = code
    db.add(candidate)
    db.flush()
    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate.id,
        action="employee_code_assigned",
        actor=None,
        candidate_id=candidate.id,
        new_value={"employeeCode": code},
    )
    return code


def find_employee_code_holder(
    db: Session,
    code: str,
    *,
    exclude_profile_id: str | None = None,
    exclude_candidate_id: str | None = None,
) -> dict[str, Any] | None:
    """Return details of whoever currently holds ``code`` (an employee profile, an active
    candidate, or pre-registration import staging), or ``None`` if the code is free.

    Used to surface a meaningful conflict ("already assigned to X") when someone edits an
    employee/candidate code, so the UI can offer to edit the other record's code instead."""
    norm = normalize_employee_code(code or "")
    if not norm:
        return None

    profile = db.scalar(
        select(EmployeeProfile).where(func.upper(EmployeeProfile.employee_code) == norm).limit(1)
    )
    if profile is not None and profile.id != exclude_profile_id:
        return {
            "type": "employee",
            "id": profile.id,
            "employeeCode": profile.employee_code,
            "name": profile.full_name,
            "email": profile.ethara_email or profile.personal_email,
            "employmentStatus": profile.employment_status,
        }

    candidate = db.scalar(
        select(Candidate)
        .where(func.upper(Candidate.employee_code) == norm)
        .where(Candidate.is_removed.is_(False))
        .limit(1)
    )
    if candidate is not None and candidate.id != exclude_candidate_id:
        return {
            "type": "candidate",
            "id": candidate.id,
            "employeeCode": candidate.employee_code,
            "name": candidate.full_name,
            "email": candidate.ethara_email or candidate.personal_email,
            "currentStatus": candidate.current_status,
        }

    staging = db.scalar(
        select(EmployeeImportStaging)
        .where(func.upper(EmployeeImportStaging.employee_code) == norm)
        .limit(1)
    )
    if staging is not None:
        staging_email = getattr(staging, "company_email", None) or getattr(
            staging, "ethara_email", None
        )
        return {
            "type": "import_staging",
            "id": staging.id,
            "employeeCode": staging.employee_code,
            "name": getattr(staging, "full_name", None),
            "email": staging_email,
        }
    return None


def find_identity_conflicts(
    db: Session,
    *,
    ethara_email: str | None = None,
    employee_code: str | None = None,
    exclude_profile_id: str | None = None,
    exclude_candidate_id: str | None = None,
) -> list[dict[str, Any]]:
    """List every existing owner (employee profile, active candidate, user login, import
    staging) of the given Ethara email or GRP employee code. An empty list means the values
    are free to assign.

    This is the guard against the 2026 document cross-link root cause: stamping one person's
    Ethara ID / GRP code onto another candidate/employee, which then dragged their documents
    across profiles. Callers should refuse the assignment when this returns any conflict for a
    DIFFERENT person."""
    out: list[dict[str, Any]] = []
    email_norm = (ethara_email or "").strip().lower()
    if email_norm:
        prof = db.scalar(
            select(EmployeeProfile)
            .where(func.lower(func.trim(EmployeeProfile.ethara_email)) == email_norm)
            .limit(1)
        )
        if prof is not None and prof.id != exclude_profile_id:
            out.append({"field": "etharaEmail", "value": email_norm, "type": "employee",
                        "id": prof.id, "name": prof.full_name, "employeeCode": prof.employee_code})
        cand = db.scalar(
            select(Candidate)
            .where(func.lower(func.trim(Candidate.ethara_email)) == email_norm)
            .where(Candidate.is_removed.is_(False))
            .limit(1)
        )
        if cand is not None and cand.id != exclude_candidate_id:
            out.append({"field": "etharaEmail", "value": email_norm, "type": "candidate",
                        "id": cand.id, "name": cand.full_name, "employeeCode": cand.employee_code})
        usr = db.scalar(select(User).where(func.lower(func.trim(User.email)) == email_norm).limit(1))
        if usr is not None:
            out.append({"field": "etharaEmail", "value": email_norm, "type": "user",
                        "id": usr.id, "name": getattr(usr, "name", None) or usr.email, "employeeCode": None})
    holder = find_employee_code_holder(
        db, employee_code or "",
        exclude_profile_id=exclude_profile_id, exclude_candidate_id=exclude_candidate_id,
    )
    if holder is not None:
        out.append({"field": "employeeCode", **holder})
    return out


def scan_identity_collisions(db: Session) -> dict[str, Any]:
    """Detective report for the document cross-link root cause: any GRP employee code or
    Ethara email that is shared by records belonging to DIFFERENT people (the name AND the
    other identifier disagree). Read-only — safe to call anytime for monitoring.

    Mirrors the manual audit used to find/fix the 2026-06/07 incident, so a clean run
    (``total == 0``) means no candidate/employee is carrying another person's identity."""
    from sqlalchemy import text

    code_sql = text(
        """
        SELECT c."employeeCode" AS value,
               c."fullName" AS "candidateName", c."candidateCode" AS "candidateCode",
               p."fullName" AS "employeeName",
               c."etharaEmail" AS "candidateEthara", p."etharaEmail" AS "employeeEthara"
        FROM candidates c
        JOIN employee_profiles p ON p."employeeCode" = c."employeeCode"
        WHERE c."isRemoved" = false
          AND lower(regexp_replace(c."fullName", '\\s+', ' ', 'g'))
              <> lower(regexp_replace(p."fullName", '\\s+', ' ', 'g'))
          AND lower(coalesce(c."etharaEmail", '')) <> lower(coalesce(p."etharaEmail", ''))
        ORDER BY c."employeeCode"
        """
    )
    email_sql = text(
        """
        SELECT c."etharaEmail" AS value,
               c."fullName" AS "candidateName", c."candidateCode" AS "candidateCode",
               p."fullName" AS "employeeName", p."employeeCode" AS "employeeCode"
        FROM candidates c
        JOIN employee_profiles p ON lower(p."etharaEmail") = lower(c."etharaEmail")
        WHERE c."isRemoved" = false AND c."etharaEmail" IS NOT NULL AND c."etharaEmail" <> ''
          AND lower(regexp_replace(c."fullName", '\\s+', ' ', 'g'))
              <> lower(regexp_replace(p."fullName", '\\s+', ' ', 'g'))
          AND upper(coalesce(c."employeeCode", '')) <> upper(coalesce(p."employeeCode", ''))
        ORDER BY c."etharaEmail"
        """
    )
    code_rows = [dict(r._mapping) for r in db.execute(code_sql)]
    email_rows = [dict(r._mapping) for r in db.execute(email_sql)]
    return {
        "employeeCodeCollisions": code_rows,
        "etharaEmailCollisions": email_rows,
        "total": len(code_rows) + len(email_rows),
    }


def _linked_candidate_for_profile(db: Session, profile: EmployeeProfile) -> Candidate | None:
    """Best-effort match of the candidate record for an employee profile (no FK exists);
    matched by ethara email then personal email."""
    if profile.ethara_email:
        cand = db.scalar(
            select(Candidate)
            .where(func.lower(Candidate.ethara_email) == profile.ethara_email.strip().lower())
            .where(Candidate.is_removed.is_(False))
            .limit(1)
        )
        if cand is not None:
            return cand
    if profile.personal_email:
        cand = db.scalar(
            select(Candidate)
            .where(func.lower(Candidate.personal_email) == profile.personal_email.strip().lower())
            .where(Candidate.is_removed.is_(False))
            .limit(1)
        )
        if cand is not None:
            return cand
    return None


def _apply_employee_code_to_downstream(db: Session, old_code: str, new_code: str) -> dict[str, int]:
    """Rename the code string in every module keyed by employee code — leave balances,
    attendance, reimbursements and submitted ID-card forms. Returns rows touched per table.
    No-op when there is no old code or it already equals the new code."""
    old_norm = normalize_employee_code(old_code or "")
    new_norm = normalize_employee_code(new_code or "")
    touched: dict[str, int] = {}
    if not old_norm or old_norm == new_norm:
        return touched
    for label, model in (
        ("leaveBalances", EmployeeLeaveBalance),
        ("attendance", AttendanceRecord),
        ("reimbursements", ReimbursementRequest),
    ):
        rows = db.scalars(select(model).where(func.upper(model.employee_code) == old_norm)).all()
        for row in rows:
            row.employee_code = new_norm
        if rows:
            touched[label] = len(rows)
    forms = db.scalars(
        select(CandidateIdCardForm).where(func.upper(CandidateIdCardForm.employee_id) == old_norm)
    ).all()
    for form in forms:
        form.employee_id = new_norm
    if forms:
        touched["idCardForms"] = len(forms)
    return touched


def _realign_candidate_id_card(db: Session, candidate_id: str, new_code: str) -> int:
    """Force a candidate's submitted ID-card form to carry ``new_code`` (covers a stale code
    that differed from the one being renamed)."""
    forms = db.scalars(
        select(CandidateIdCardForm).where(CandidateIdCardForm.candidate_id == candidate_id)
    ).all()
    changed = 0
    for form in forms:
        if normalize_employee_code(form.employee_id or "") != normalize_employee_code(new_code):
            form.employee_id = normalize_employee_code(new_code)
            changed += 1
    return changed


def rename_employee_code(
    db: Session,
    *,
    profile: EmployeeProfile,
    new_code: str,
    actor: User | None = None,
    request=None,
) -> dict[str, Any]:
    """Authoritatively rename an employee's code and propagate it everywhere the string is
    stored: the linked candidate record, ID-card form, leave balances, attendance and
    reimbursements — so the modules never drift.

    The caller MUST first verify the code is free (see ``find_employee_code_holder``).
    Does not commit."""
    new_norm = normalize_employee_code(new_code or "")
    old_code = profile.employee_code or ""
    old_norm = normalize_employee_code(old_code)
    summary: dict[str, Any] = {"old": old_code or None, "new": new_norm, "touched": {}}
    if not new_norm or new_norm == old_norm:
        return summary

    profile.employee_code = new_norm
    db.add(profile)
    summary["touched"].update(_apply_employee_code_to_downstream(db, old_norm, new_norm))

    candidate = _linked_candidate_for_profile(db, profile)
    if candidate is not None:
        if normalize_employee_code(candidate.employee_code or "") != new_norm:
            candidate.employee_code = new_norm
            db.add(candidate)
            summary["touched"]["candidate"] = 1
        idcards = _realign_candidate_id_card(db, candidate.id, new_norm)
        if idcards:
            summary["touched"]["idCardForms"] = summary["touched"].get("idCardForms", 0) + idcards

    number = _grp_number(new_norm)
    if number is not None:
        _bump_employee_code_seq(db, number)

    db.flush()
    log_audit(
        db,
        entity_type="employee_profile",
        entity_id=profile.id,
        action="employee_code_changed",
        actor=actor,
        request=request,
        user_id=profile.user_id,
        old_value={"employeeCode": old_code or None},
        new_value={"employeeCode": new_norm, "propagated": summary["touched"]},
    )
    return summary


def sync_employee_code_from_candidate(
    db: Session,
    *,
    candidate: Candidate,
    old_code: str | None,
    new_code: str | None,
    actor: User | None = None,
    request=None,
) -> dict[str, Any] | None:
    """When a candidate's employee code is edited, push it to the linked employee profile (if
    any) and all code-keyed modules so candidate and employee never drift. Does not commit.
    Returns a summary, or ``None`` when there was nothing to propagate."""
    new_norm = normalize_employee_code(new_code or "")
    if not new_norm:
        return None

    profile = None
    if candidate.ethara_email:
        cand_ethara = candidate.ethara_email.strip().lower()
        profile = db.scalar(
            select(EmployeeProfile)
            .where(func.lower(EmployeeProfile.ethara_email) == cand_ethara)
            .limit(1)
        )
    if profile is None and candidate.personal_email:
        cand_personal = candidate.personal_email.strip().lower()
        profile = db.scalar(
            select(EmployeeProfile)
            .where(func.lower(EmployeeProfile.personal_email) == cand_personal)
            .limit(1)
        )

    idcards = _realign_candidate_id_card(db, candidate.id, new_norm)

    if profile is None or normalize_employee_code(profile.employee_code or "") == new_norm:
        touched = _apply_employee_code_to_downstream(db, old_code or "", new_norm)
        if idcards:
            touched["idCardForms"] = touched.get("idCardForms", 0) + idcards
        return {"employeeUpdated": False, "touched": touched} if touched else None

    old_profile_code = profile.employee_code or ""
    profile.employee_code = new_norm
    db.add(profile)
    touched = _apply_employee_code_to_downstream(db, old_profile_code, new_norm)
    if idcards:
        touched["idCardForms"] = touched.get("idCardForms", 0) + idcards
    number = _grp_number(new_norm)
    if number is not None:
        _bump_employee_code_seq(db, number)
    db.flush()
    log_audit(
        db,
        entity_type="employee_profile",
        entity_id=profile.id,
        action="employee_code_synced_from_candidate",
        actor=actor,
        request=request,
        user_id=profile.user_id,
        candidate_id=candidate.id,
        old_value={"employeeCode": old_profile_code or None},
        new_value={"employeeCode": new_norm, "propagated": touched},
    )
    return {"employeeUpdated": True, "employeeProfileId": profile.id, "touched": touched}


def _normalize_employee_epf_form_data(form_data: dict[str, Any]) -> dict[str, Any]:
    normalized_form_data = dict(form_data)
    uan_number = "".join(ch for ch in str(form_data.get("uanNumber", "") or "") if ch.isdigit())
    pf_account_number = "".join(
        ch for ch in str(form_data.get("pfAccountNumber", "") or "").upper() if not ch.isspace()
    )
    normalized_form_data["uanNumber"] = uan_number
    normalized_form_data["pfAccountNumber"] = pf_account_number
    return normalized_form_data


def _normalize_employee_bank_details_form_data(form_data: dict[str, Any]) -> dict[str, Any]:
    normalized_form_data = dict(form_data)
    bank_name = str(form_data.get("bankName", "") or "").strip()
    account_number = "".join(ch for ch in str(form_data.get("accountNumber", "") or "") if ch.isdigit())
    ifsc_code = "".join(
        ch for ch in str(form_data.get("ifscCode", "") or "").upper() if not ch.isspace()
    )
    normalized_form_data["bankName"] = bank_name
    normalized_form_data["accountNumber"] = account_number
    normalized_form_data["ifscCode"] = ifsc_code
    return normalized_form_data


def _validate_employee_compliance_form(form_type: str, form_data: dict[str, Any]) -> dict[str, Any]:
    normalized_form_data = dict(form_data)

    from fastapi import HTTPException as _HTTPException

    if form_type == "epf":
        normalized_form_data = _normalize_employee_epf_form_data(form_data)
        uan_number = str(normalized_form_data.get("uanNumber", "") or "")
        pf_account_number = str(normalized_form_data.get("pfAccountNumber", "") or "")

        if not uan_number or not pf_account_number:
            raise _HTTPException(
                status_code=422,
                detail="UAN Number and PF Account Number are required for EPF enrollment.",
            )

        if len(uan_number) != EMPLOYEE_UAN_LENGTH:
            raise _HTTPException(
                status_code=422,
                detail=f"UAN Number must be exactly {EMPLOYEE_UAN_LENGTH} digits.",
            )

        if not uan_number.startswith(EMPLOYEE_UAN_PREFIX):
            raise _HTTPException(
                status_code=422,
                detail=f"UAN Number must start with {EMPLOYEE_UAN_PREFIX}.",
            )

        if not EMPLOYEE_PF_ACCOUNT_PATTERN.fullmatch(pf_account_number):
            raise _HTTPException(
                status_code=422,
                detail="PF Account Number must be 7 to 30 characters using only letters, numbers, and /.",
            )

        return normalized_form_data

    if form_type == "bank_details":
        normalized_form_data = _normalize_employee_bank_details_form_data(form_data)
        bank_name = str(normalized_form_data.get("bankName", "") or "")
        account_number = str(normalized_form_data.get("accountNumber", "") or "")
        ifsc_code = str(normalized_form_data.get("ifscCode", "") or "")

        if not bank_name or not account_number or not ifsc_code:
            raise _HTTPException(
                status_code=422,
                detail="Bank Name, Account Number, and IFSC Code are required for bank details submission.",
            )

        if not EMPLOYEE_ACCOUNT_NUMBER_PATTERN.fullmatch(account_number):
            raise _HTTPException(
                status_code=422,
                detail="Account Number must be 9 to 18 digits.",
            )

        if not EMPLOYEE_IFSC_CODE_PATTERN.fullmatch(ifsc_code):
            raise _HTTPException(
                status_code=422,
                detail="Enter a valid IFSC code (e.g. HDFC0001234).",
            )

        return normalized_form_data

    return normalized_form_data


def parse_optional_datetime(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    raw = value.strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = datetime.combine(date.fromisoformat(raw), time.min)
        except ValueError:
            for fmt in EMPLOYEE_DATE_INPUT_FORMATS:
                try:
                    parsed = datetime.strptime(raw, fmt)
                    break
                except ValueError:
                    continue
            else:
                raise
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _generate_candidate_temp_password() -> str:
    return f"Et#{token_urlsafe(10)}1"


def _candidate_login_url(email: str) -> str:
    settings = get_settings()
    return f"{settings.frontend_url.rstrip('/')}/login?email={quote(email)}"


def _send_employee_referral_email(
    *,
    candidate_name: str,
    personal_email: str,
    position_title: str,
    referrer_name: str,
    temporary_password: str | None,
) -> None:
    login_url = _candidate_login_url(personal_email)
    if temporary_password:
        subject = "Your Ethara candidate portal credentials are ready"
        body_text = (
            f"Hi {candidate_name},\n\n"
            f"You have been referred to Ethara for the role of {position_title} by {referrer_name}.\n\n"
            "You can log in to the Ethara candidate portal using these demo credentials:\n"
            f"Login email: {personal_email}\n"
            f"Demo password: {temporary_password}\n"
            f"Portal login: {login_url}\n\n"
            "You can change this password after you log in to the portal.\n"
            "If you did not expect this referral, please ignore this email.\n"
        )
        body_html = (
            f"<p>Hi {candidate_name},</p>"
            f"<p>You have been referred to <strong>Ethara</strong> for the role of <strong>{position_title}</strong> by {referrer_name}.</p>"
            "<p>You can log in to the Ethara candidate portal using these demo credentials:</p>"
            f"<p><strong>Login email:</strong> {personal_email}<br />"
            f"<strong>Demo password:</strong> {temporary_password}</p>"
            f"<p><a href=\"{login_url}\">Sign in to your Ethara candidate portal</a></p>"
            "<p>You can change this password after you log in to the portal.</p>"
        )
    else:
        subject = "Your Ethara candidate portal referral is live"
        body_text = (
            f"Hi {candidate_name},\n\n"
            f"You have been referred to Ethara for the role of {position_title} by {referrer_name}.\n\n"
            "We found that you already have an Ethara candidate portal account.\n"
            f"Login email: {personal_email}\n"
            f"Portal login: {login_url}\n\n"
            "You can sign in with your existing password. If needed, use Forgot password on the login page to reset it.\n"
        )
        body_html = (
            f"<p>Hi {candidate_name},</p>"
            f"<p>You have been referred to <strong>Ethara</strong> for the role of <strong>{position_title}</strong> by {referrer_name}.</p>"
            "<p>We found that you already have an Ethara candidate portal account.</p>"
            f"<p><strong>Login email:</strong> {personal_email}</p>"
            f"<p><a href=\"{login_url}\">Sign in to your Ethara candidate portal</a></p>"
            "<p>You can sign in with your existing password, or use the Forgot password option if needed.</p>"
        )
    EmailService().send_email(
        to_email=personal_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
    )


def serialize_employee_profile(profile: EmployeeProfile | None) -> dict[str, Any] | None:
    if profile is None:
        return None
    return {
        "type": "employee",
        "id": profile.id,
        "userId": profile.user_id,
        "fullName": profile.full_name,
        "name": profile.full_name,
        "etharaEmail": profile.ethara_email,
        "personalEmail": profile.personal_email,
        "employeeCode": profile.employee_code,
        "phone": profile.phone,
        "department": profile.department,
        "designation": profile.designation,
        "gender": profile.gender,
        "aadhaarLast4": profile.aadhaar_last4,
        "aadhaarOcrStatus": profile.aadhaar_ocr_status,
        "aadhaarOcrMatch": profile.aadhaar_ocr_match,
        "dateOfBirth": profile.date_of_birth.isoformat() if profile.date_of_birth else None,
        "aadhaarPath": profile.aadhaar_path,
        "resumePath": profile.resume_path,
        "createdAt": profile.created_at.isoformat() if profile.created_at else None,
        "updatedAt": profile.updated_at.isoformat() if profile.updated_at else None,
    }


def employee_staff_roles() -> set[Role]:
    return set(EMPLOYEE_STAFF_ROLES)


def employee_self_roles() -> set[Role]:
    return set(EMPLOYEE_SELF_ROLES)


def employee_required_documents() -> list[tuple[str, str]]:
    return list(EMPLOYEE_REQUIRED_DOCUMENTS)


def _normalize_reference_values(values: Iterable[Any], defaults: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = str(raw or "").strip()
        if not value:
            continue
        key = value.casefold()
        if key == "others":
            continue
        if key in seen:
            continue
        seen.add(key)
        normalized.append(value)
    for default in defaults:
        key = default.casefold()
        if key not in seen:
            seen.add(key)
            normalized.append(default)
    return normalized


def _department_key(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def _normalize_department_admin_ids(value: Any) -> list[str]:
    raw_values = value if isinstance(value, list) else [value]
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in raw_values:
        user_id = str(raw_value or "").strip()
        if not user_id or user_id in seen:
            continue
        seen.add(user_id)
        normalized.append(user_id)
    return normalized


def _department_admin_setting_value(db: Session) -> dict[str, list[str]]:
    record = db.scalar(
        select(AdminSetting).where(
            AdminSetting.namespace == EMPLOYEE_REFERENCE_NAMESPACE,
            AdminSetting.key == EMPLOYEE_DEPARTMENT_ADMINS_KEY,
        )
    )
    if record is None or not isinstance(record.value, dict):
        return {}
    result: dict[str, list[str]] = {}
    for raw_department, raw_user_ids in record.value.items():
        department_key = _department_key(str(raw_department))
        user_ids = _normalize_department_admin_ids(raw_user_ids)
        if department_key and user_ids:
            result[department_key] = user_ids
    return result


def _employee_user_refs(db: Session, user_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = [user_id for user_id in dict.fromkeys(user_ids) if user_id]
    if not ids:
        return {}
    users = db.scalars(select(User).where(User.id.in_(ids), User.is_active.is_(True))).all()
    emails = [user.email.lower() for user in users if user.email]
    profiles = db.scalars(
        select(EmployeeProfile).where(
            or_(
                EmployeeProfile.user_id.in_(ids),
                func.lower(EmployeeProfile.ethara_email).in_(emails),
            )
        )
    ).all()
    profile_by_user_id = {profile.user_id: profile for profile in profiles if profile.user_id}
    profile_by_email = {profile.ethara_email.lower(): profile for profile in profiles if profile.ethara_email}
    refs: dict[str, dict[str, Any]] = {}
    for user in users:
        profile = profile_by_user_id.get(user.id) or profile_by_email.get(user.email.lower())
        refs[user.id] = {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value if isinstance(user.role, Role) else str(user.role),
            "department": profile.department if profile else None,
            "designation": profile.designation if profile else None,
        }
    return refs


def _department_admin_refs(db: Session, departments: list[str]) -> dict[str, list[dict[str, Any]]]:
    configured = _department_admin_setting_value(db)
    refs = _employee_user_refs(
        db,
        (user_id for user_ids in configured.values() for user_id in user_ids),
    )
    result: dict[str, list[dict[str, Any]]] = {}
    for department in departments:
        user_ids = configured.get(_department_key(department), [])
        result[department] = [refs[user_id] for user_id in user_ids if user_id in refs]
    return result


def department_admin_user_ids(db: Session) -> set[str]:
    return {
        user_id
        for user_ids in _department_admin_setting_value(db).values()
        for user_id in user_ids
    }


def department_admin_departments_for_user(db: Session, user_id: str) -> set[str]:
    configured = _department_admin_setting_value(db)
    return {
        department_key
        for department_key, admin_user_ids in configured.items()
        if user_id in admin_user_ids
    }


def _reference_setting_value(db: Session, *, key: str, defaults: list[str]) -> list[str]:
    record = db.scalar(
        select(AdminSetting).where(
            AdminSetting.namespace == EMPLOYEE_REFERENCE_NAMESPACE,
            AdminSetting.key == key,
        )
    )
    if record is None or not isinstance(record.value, list):
        return _normalize_reference_values([], defaults)
    return _normalize_reference_values(record.value, defaults)


def employee_reference_options(db: Session, *, include_department_admins: bool = False) -> dict[str, Any]:
    profile_departments = list(
        db.scalars(
            select(EmployeeProfile.department).where(
                EmployeeProfile.department.is_not(None),
                func.trim(EmployeeProfile.department) != "",
            )
        )
    )
    profile_designations = list(
        db.scalars(
            select(EmployeeProfile.designation).where(
                EmployeeProfile.designation.is_not(None),
                func.trim(EmployeeProfile.designation) != "",
            )
        )
    )
    configured_departments = _reference_setting_value(
        db,
        key="employee_departments",
        defaults=EMPLOYEE_REFERENCE_DEPARTMENTS,
    )
    configured_designations = _reference_setting_value(
        db,
        key="employee_designations",
        defaults=EMPLOYEE_REFERENCE_DESIGNATIONS,
    )
    departments = _normalize_reference_values(
        [*configured_departments, *profile_departments],
        EMPLOYEE_REFERENCE_DEPARTMENTS,
    )
    designations = _normalize_reference_values(
        [*configured_designations, *profile_designations],
        EMPLOYEE_REFERENCE_DESIGNATIONS,
    )
    result: dict[str, Any] = {
        "departments": departments,
        "designations": designations,
    }
    if include_department_admins:
        result["departmentAdmins"] = _department_admin_refs(db, departments)
    return result


def upsert_employee_reference_options(
    db: Session,
    *,
    departments: list[Any] | None,
    designations: list[Any] | None,
    department_admins: dict[str, Any] | None = None,
    actor: User,
) -> dict[str, Any]:
    current = employee_reference_options(db)
    next_departments = (
        _normalize_reference_values(departments, EMPLOYEE_REFERENCE_DEPARTMENTS)
        if departments is not None
        else current["departments"]
    )
    next_designations = (
        _normalize_reference_values(designations, EMPLOYEE_REFERENCE_DESIGNATIONS)
        if designations is not None
        else current["designations"]
    )

    for key, value, description in (
        ("employee_departments", next_departments, "Employee department dropdown options"),
        ("employee_designations", next_designations, "Employee designation dropdown options"),
    ):
        record = db.scalar(
            select(AdminSetting).where(
                AdminSetting.namespace == EMPLOYEE_REFERENCE_NAMESPACE,
                AdminSetting.key == key,
            )
        )
        if record is None:
            record = AdminSetting(
                namespace=EMPLOYEE_REFERENCE_NAMESPACE,
                key=key,
                value=value,
                description=description,
                updated_by=actor.id,
            )
        else:
            record.value = value
            record.description = record.description or description
            record.updated_by = actor.id
        db.add(record)

    next_department_admins = _department_admin_setting_value(db)
    if department_admins is not None:
        valid_departments = {_department_key(department) for department in next_departments}
        submitted_user_ids = {
            str(user_id).strip()
            for raw_user_ids in department_admins.values()
            for user_id in _normalize_department_admin_ids(raw_user_ids)
        }
        existing_user_ids = set()
        if submitted_user_ids:
            existing_user_ids = set(
                db.scalars(select(User.id).where(User.id.in_(submitted_user_ids), User.is_active.is_(True))).all()
            )

        next_department_admins = {}
        for department, raw_user_ids in department_admins.items():
            department_key = _department_key(department)
            user_ids = _normalize_department_admin_ids(raw_user_ids)
            if not department_key or department_key not in valid_departments or not user_ids:
                continue
            missing_user_ids = [user_id for user_id in user_ids if user_id not in existing_user_ids]
            if missing_user_ids:
                raise ValueError(f"Department admin user not found for {department}.")
            next_department_admins[department_key] = user_ids

        record = db.scalar(
            select(AdminSetting).where(
                AdminSetting.namespace == EMPLOYEE_REFERENCE_NAMESPACE,
                AdminSetting.key == EMPLOYEE_DEPARTMENT_ADMINS_KEY,
            )
        )
        if record is None:
            record = AdminSetting(
                namespace=EMPLOYEE_REFERENCE_NAMESPACE,
                key=EMPLOYEE_DEPARTMENT_ADMINS_KEY,
                value=next_department_admins,
                description="Employee department head/admin user mapping",
                updated_by=actor.id,
            )
        else:
            record.value = next_department_admins
            record.description = record.description or "Employee department head/admin user mapping"
            record.updated_by = actor.id
        db.add(record)

    log_audit(
        db,
        entity_type="employee_reference",
        entity_id="employee_reference_options",
        action="employee_reference_options_updated",
        actor=actor,
        new_value={
            "departments": next_departments,
            "designations": next_designations,
            "departmentAdmins": next_department_admins,
        },
    )
    return {
        "departments": next_departments,
        "designations": next_designations,
        "departmentAdmins": _department_admin_refs(db, next_departments),
    }


def _employee_edit_access_key(profile_id: str) -> str:
    return f"employee_edit_access:{profile_id}"


def employee_edit_access_enabled(db: Session, profile: EmployeeProfile) -> bool:
    record = db.scalar(
        select(AdminSetting).where(
            AdminSetting.namespace == EMPLOYEE_EDIT_ACCESS_NAMESPACE,
            AdminSetting.key == _employee_edit_access_key(profile.id),
        )
    )
    if record is None:
        return True
    return bool(record.value)


def set_employee_edit_access(
    db: Session,
    *,
    profile: EmployeeProfile,
    enabled: bool,
    actor: User,
) -> bool:
    key = _employee_edit_access_key(profile.id)
    record = db.scalar(
        select(AdminSetting).where(
            AdminSetting.namespace == EMPLOYEE_EDIT_ACCESS_NAMESPACE,
            AdminSetting.key == key,
        )
    )
    if record is None:
        record = AdminSetting(
            namespace=EMPLOYEE_EDIT_ACCESS_NAMESPACE,
            key=key,
            value=enabled,
            description="Controls whether the employee can edit their submitted employee detail form.",
            updated_by=actor.id,
        )
    else:
        record.value = enabled
        record.updated_by = actor.id
    db.add(record)
    log_audit(
        db,
        entity_type="employee_profile",
        entity_id=profile.id,
        action="employee_edit_access_enabled" if enabled else "employee_edit_access_disabled",
        actor=actor,
        user_id=profile.user_id,
        new_value={"editAccessEnabled": enabled},
    )
    return enabled


def update_employee_hr_fields(
    db: Session,
    *,
    profile: EmployeeProfile,
    actor: User,
    vendor: str | None = None,
    employment_status: str | None = None,
    work_mode: str | None = None,
    date_of_joining: str | datetime | None = None,
    fields_provided: set[str] | None = None,
) -> EmployeeProfile:
    """Update the HR/admin-only fields (vendor / employment_status / work_mode / date_of_joining).

    Only the keys present in ``fields_provided`` are touched, so a PATCH can update one
    field without clearing the others. Writes an audit log of the changes.
    """
    provided = fields_provided or {"vendor", "employment_status", "work_mode", "date_of_joining"}
    changes: dict[str, Any] = {}
    if "vendor" in provided:
        new_value = (vendor or "").strip() or None
        if new_value != profile.vendor:
            changes["vendor"] = new_value
            profile.vendor = new_value
    if "employment_status" in provided:
        new_value = (employment_status or "").strip() or None
        if new_value != profile.employment_status:
            changes["employmentStatus"] = new_value
            profile.employment_status = new_value
    if "work_mode" in provided:
        new_value = (work_mode or "").strip() or None
        if new_value != profile.work_mode:
            changes["workMode"] = new_value
            profile.work_mode = new_value
    if "date_of_joining" in provided:
        parsed = _safe_parse_sheet_date(date_of_joining) if date_of_joining else None
        if parsed != profile.date_of_joining:
            changes["dateOfJoining"] = parsed.isoformat() if parsed else None
            profile.date_of_joining = parsed

    if changes:
        db.add(profile)
        log_audit(
            db,
            entity_type="employee_profile",
            entity_id=profile.id,
            action="employee_hr_fields_updated",
            actor=actor,
            user_id=profile.user_id,
            new_value=changes,
        )
    return profile


# ── ID Card Details ──────────────────────────────────────────────────────────
# (camelCase API key -> EmployeeProfile attr -> selection-form fallback key)
ID_CARD_FIELD_MAP: list[tuple[str, str, str]] = [
    ("bloodGroup", "blood_group", "bloodGroup"),
    ("emergencyContactName", "emergency_contact_name", "emergencyContactName"),
    ("emergencyContactPhone", "emergency_contact_phone", "emergencyContactPhone"),
    ("emergencyContactRelation", "emergency_contact_relation", "emergencyContactRelation"),
    ("fatherName", "father_name", "fatherName"),
    ("motherName", "mother_name", "motherName"),
    ("maritalStatus", "marital_status", "maritalStatus"),
    ("currentAddress", "current_address", "currentAddress"),
    ("permanentAddress", "permanent_address", "permanentAddress"),
]


def _employee_selection_form_value(profile: EmployeeProfile, key: str) -> str:
    sf = getattr(profile, "selection_form", None)
    form_data = getattr(sf, "form_data", None)
    if isinstance(form_data, dict):
        value = form_data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def employee_id_card_applicable(profile: EmployeeProfile) -> bool:
    """True only for employees onboarded through the HRMS — i.e. those who joined
    on/after ID_CARD_FLAG_FROM. Older employees already have physical ID cards, so
    the ID Card Details module is hidden for them. Uses date_of_joining only (an
    old employee whose record was merely created in HRMS recently still has an old
    joining date), so they are correctly excluded."""
    raw = (get_settings().id_card_flag_from or "").strip()
    try:
        cutoff = date.fromisoformat(raw) if raw else None
    except ValueError:
        cutoff = None
    joined = profile.date_of_joining
    if cutoff is None or joined is None:
        return False
    return joined.date() >= cutoff


def employee_id_card_incomplete(profile: EmployeeProfile) -> bool:
    """Applicable (newly-onboarded) employee still missing the blood group, which
    is required for the ID card and which no onboarding step captures."""
    return employee_id_card_applicable(profile) and not (
        profile.blood_group and str(profile.blood_group).strip()
    )


def employee_id_card_payload(profile: EmployeeProfile) -> dict[str, Any]:
    """Read the ID-card fields (profile column first, selection-form fallback) plus
    submission + completeness state."""
    result: dict[str, Any] = {}
    for api_key, attr, form_key in ID_CARD_FIELD_MAP:
        value = getattr(profile, attr, None)
        text = str(value).strip() if value is not None and str(value).strip() else ""
        # Blood group is never in the selection form — only the column holds it.
        if not text and api_key != "bloodGroup":
            text = _employee_selection_form_value(profile, form_key)
        result[api_key] = text
    # Read-only display fields shown on the card (printed on the physical ID card).
    result["name"] = profile.full_name or ""
    result["employeeId"] = profile.employee_code or ""
    result["submittedAt"] = profile.id_card_submitted_at
    result["submittedBy"] = profile.id_card_submitted_by
    result["bloodGroupMissing"] = not result["bloodGroup"]
    result["applicable"] = employee_id_card_applicable(profile)
    result["incomplete"] = employee_id_card_incomplete(profile)
    return result


def save_employee_id_card_details(
    db: Session, *, profile: EmployeeProfile, actor: User, data: dict[str, Any]
) -> dict[str, Any]:
    """Persist the ID-card fields onto the employee profile (used by both the
    employee self-service form and the HR-side editor)."""
    changes: dict[str, Any] = {}
    for api_key, attr, _form_key in ID_CARD_FIELD_MAP:
        if api_key not in data:
            continue
        raw = data.get(api_key)
        new_value = raw.strip() if isinstance(raw, str) else raw
        new_value = new_value or None
        if new_value != getattr(profile, attr, None):
            setattr(profile, attr, new_value)
            changes[api_key] = new_value
    profile.id_card_submitted_at = datetime.now(UTC)
    profile.id_card_submitted_by = actor.id
    db.add(profile)
    db.flush()
    log_audit(
        db,
        entity_type="employee_id_card",
        entity_id=profile.id,
        action="employee_id_card_details_saved",
        actor=actor,
        user_id=profile.user_id,
        new_value=changes,
    )
    return employee_id_card_payload(profile)


def update_imported_hr_fields(
    db: Session,
    *,
    staging_id: str,
    actor: User,
    vendor: str | None = None,
    employment_status: str | None = None,
    work_mode: str | None = None,
    date_of_joining: str | datetime | None = None,
    fields_provided: set[str] | None = None,
) -> EmployeeImportStaging:
    """HR/admin edit of the HR-only fields for a NOT-yet-registered (imported) employee.
    Writes onto the staging row's profile_fields so the values persist and apply on registration."""
    staging = db.get(EmployeeImportStaging, staging_id)
    if staging is None:
        raise ValueError("Imported employee not found")
    provided = fields_provided or {"vendor", "employment_status", "work_mode", "date_of_joining"}
    pf = dict(staging.profile_fields or {})
    if "vendor" in provided:
        pf["vendor"] = (vendor or "").strip() or None
    if "employment_status" in provided:
        pf["employment_status"] = (employment_status or "").strip() or None
    if "work_mode" in provided:
        pf["work_mode"] = (work_mode or "").strip() or None
    if "date_of_joining" in provided:
        parsed = _safe_parse_sheet_date(date_of_joining) if date_of_joining else None
        pf["date_of_joining"] = parsed.isoformat() if parsed else None
    staging.profile_fields = pf
    db.add(staging)
    log_audit(
        db,
        entity_type="employee_import_staging",
        entity_id=staging.id,
        action="imported_hr_fields_updated",
        actor=actor,
        new_value={k: pf.get(k) for k in ("vendor", "employment_status", "work_mode", "date_of_joining")},
    )
    return staging


def list_pending_imported_employees(db: Session, *, search: str | None = None) -> list[dict[str, Any]]:
    """Employees pre-loaded from the HR sheet who have NOT registered yet.

    Surfaced in the admin/HR roster as read-only 'pending registration' rows so HR can see
    the full headcount before each person activates their account. Excludes rows already
    consumed (registered) or whose Ethara email already has a real EmployeeProfile.
    """
    # Exclude a staging row only when the person already shows in the employee roster — same
    # filter as GET /list (any account with a profile except leadership). This keeps the total
    # headcount correct: admin/HR accounts that are also listed employees show once (in the
    # roster), and aren't double-counted as pending.
    existing_emails = {
        (email or "").strip().lower()
        for (email,) in db.execute(
            select(EmployeeProfile.ethara_email)
            .join(User, EmployeeProfile.user_id == User.id)
            .where(User.role != Role.LEADERSHIP)
        ).all()
        if email
    }
    rows = list(
        db.scalars(
            select(EmployeeImportStaging)
            .where(EmployeeImportStaging.status == "pending")
            .order_by(EmployeeImportStaging.created_at.desc())
        )
    )
    results: list[dict[str, Any]] = []
    needle = (search or "").strip().lower()
    for row in rows:
        if row.ethara_email and row.ethara_email.strip().lower() in existing_emails:
            continue
        pf = row.profile_fields or {}
        haystack = " ".join(
            str(v) for v in [pf.get("full_name"), row.ethara_email, row.personal_email,
                             row.employee_code, pf.get("department"), pf.get("designation")] if v
        ).lower()
        if needle and needle not in haystack:
            continue
        manager_summary = _imported_manager_summary(db, pf)
        date_of_joining = _safe_parse_sheet_date(
            pf.get("date_of_joining") or (row.form_data or {}).get("dateOfJoining")
        )
        results.append(
            {
                "id": f"import:{row.id}",
                "stagingId": row.id,
                "accessLevel": "imported",
                "canOpenDetail": True,
                "registrationStatus": "imported_pending",
                "userId": None,
                # name/etharaEmail must never be null — the frontend calls .toLowerCase() on them.
                "name": pf.get("full_name") or row.ethara_email or row.employee_code or "(unnamed)",
                "etharaEmail": row.ethara_email or "",
                "personalEmail": row.personal_email,
                "phone": pf.get("phone") or row.phone,
                "employeeCode": row.employee_code,
                "department": pf.get("department"),
                "designation": pf.get("designation"),
                "gender": pf.get("gender"),
                "vendor": pf.get("vendor"),
                "employmentStatus": pf.get("employment_status"),
                "workMode": pf.get("work_mode"),
                "dateOfJoining": date_of_joining.isoformat() if date_of_joining else None,
                "aadhaarLast4": row.aadhaar_last4,
                "aadhaarPath": None,
                "isActive": False,
                "editAccessEnabled": False,
                "aadhaarOcrStatus": pf.get("aadhaar_ocr_status") or pf.get("aadhaar_validation_status"),
                "aadhaarValidationStatus": pf.get("aadhaar_validation_status"),
                "aadhaarMismatchReason": pf.get("aadhaar_mismatch_reason"),
                "selectionFormStatus": "not_started",
                "selectionFormSubmittedAt": None,
                "createdAt": row.created_at.isoformat() if row.created_at else None,
                **manager_summary,
            }
        )
    return results


def get_imported_employee_detail(db: Session, *, staging_id: str) -> dict[str, Any]:
    """Build an EmployeeDetailRead-shaped payload for a pre-loaded (not-yet-registered)
    employee, so HR/Admin can open and review the imported data using the normal detail page.
    Read-only — these are staging rows, not real profiles."""
    staging = db.get(EmployeeImportStaging, staging_id)
    if staging is None or staging.status != "pending":
        raise ValueError("Imported employee not found")

    pf = staging.profile_fields or {}
    doc_labels = dict(EMPLOYEE_REQUIRED_DOCUMENTS)
    documents = []
    for idx, doc in enumerate(staging.documents or []):
        dtype = _normalize_employee_document_type(doc.get("type"))
        file_url = doc.get("file_url")
        mime = doc.get("mime_type") or _employee_document_mime(
            file_name=doc.get("file_name"), file_url=file_url
        )
        base = f"/api/v1/employees/import/{staging.id}/documents/{idx}"
        documents.append(
            {
                "id": f"import-doc:{staging.id}:{idx}",
                "type": dtype,
                "label": doc_labels.get(dtype, dtype.replace("_", " ").title()),
                "fileName": doc.get("file_name"),
                "mimeType": mime,
                "uploadedAt": None,
                "verificationStatus": "uploaded",
                "remarks": None,
                "missing": not bool(file_url),
                "canPreview": bool(file_url) and _employee_document_can_preview(mime),
                "previewEndpoint": f"{base}/preview" if file_url else None,
                "downloadEndpoint": f"{base}/download" if file_url else None,
            }
        )
    resume_document = next((d for d in documents if d["type"] == "resume"), None)

    return {
        "id": f"import:{staging.id}",
        "userId": None,
        "fullName": pf.get("full_name") or staging.ethara_email or "(unnamed)",
        "etharaEmail": staging.ethara_email or "",
        "personalEmail": staging.personal_email,
        "employeeCode": staging.employee_code or "",
        "phone": pf.get("phone") or staging.phone,
        "department": pf.get("department"),
        "designation": pf.get("designation"),
        "gender": pf.get("gender"),
        "vendor": pf.get("vendor"),
        "employmentStatus": pf.get("employment_status"),
        "workMode": pf.get("work_mode"),
        "dateOfJoining": _safe_parse_sheet_date(pf.get("date_of_joining") or (staging.form_data or {}).get("dateOfJoining")),
        "bloodGroup": pf.get("blood_group"),
        "emergencyContactName": pf.get("emergency_contact_name"),
        "emergencyContactPhone": pf.get("emergency_contact_phone"),
        "emergencyContactRelation": pf.get("emergency_contact_relation"),
        "aadhaarLast4": staging.aadhaar_last4,
        "aadhaarOcrStatus": pf.get("aadhaar_ocr_status") or pf.get("aadhaar_validation_status"),
        "aadhaarOcrMatch": pf.get("aadhaar_ocr_match"),
        "dateOfBirth": _safe_parse_sheet_date(pf.get("date_of_birth")),
        "registrationStatus": "imported_pending",
        "currentEmployeeStatus": pf.get("employment_status") or "Imported (pending registration)",
        "isActive": False,
        **_imported_manager_summary(db, pf),
        "documentCompletionStatus": {},
        "resumeDocument": resume_document,
        "documents": documents,
        "missingDocuments": [],
        "selectionForm": {
            "id": "",
            "status": "prefilled",
            "formData": staging.form_data or {},
            "editAccessEnabled": False,
        },
        "contracts": [],
        "complianceForms": [],
        "referralActivity": [],
        "profileJourney": [],
        "profileCompletionPercentage": 0,
        "nextRequiredAction": "Employee has not registered yet. Data maps automatically when they sign up with this Ethara email / employee code.",
        "auditLogs": [],
        "timeline": [],
        "createdAt": staging.created_at,
        "updatedAt": staging.updated_at,
    }


def get_imported_document_for_download(
    db: Session, *, staging_id: str, index: int
) -> tuple[Path | str | None, str | None, str | None]:
    """Resolve one pre-loaded (imported) document to a servable file reference."""
    staging = db.get(EmployeeImportStaging, staging_id)
    if staging is None:
        return None, None, None
    docs = staging.documents or []
    if index < 0 or index >= len(docs):
        return None, None, None
    doc = docs[index]
    reference = _resolve_employee_file_reference(doc.get("file_url"))
    file_name = doc.get("file_name") or _file_name_from_reference(doc.get("file_url"), reference)
    mime_type = doc.get("mime_type") or _employee_document_mime(
        file_name=file_name, file_url=doc.get("file_url")
    )
    return reference, file_name, mime_type


def _normalize_employee_document_type(document_type: str | None) -> str:
    normalized = re.sub(r"[\s-]+", "_", (document_type or "").strip().lower())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return EMPLOYEE_DOCUMENT_TYPE_ALIASES.get(normalized, normalized)


# Maps a normalized internal document type to the AI verification "expected
# category" understood by vertex_ai.verify_and_extract. Types absent here
# (e.g. relieving letters, payslips) have no reliable visual signature, so we
# skip AI verification for them rather than produce noisy mismatches.
_DOCUMENT_AI_CATEGORY: dict[str, str] = {
    "aadhaar": "aadhaar",
    "pan": "pan",
    "cancelled_cheque": "bank_proof",
    "education_10th": "educational",
    "education_12th": "educational",
    "highest_qualification": "educational",
    "permanent_address_proof": "address_proof",
    "current_address_proof": "address_proof",
    "photo": "photo",
}


def document_ai_expected_category(document_type: str | None) -> str | None:
    """Return the AI verification category for a document type, or None when the
    type should not be AI-verified."""
    return _DOCUMENT_AI_CATEGORY.get(_normalize_employee_document_type(document_type))


def _is_system_generated_document(normalized_type: str) -> bool:
    """System-produced artifacts (Documenso-signed contracts, generated compliance
    forms) — not candidate uploads, so the bulk verifier skips them."""
    return normalized_type.startswith(("signed_", "compliance_form"))


def verification_category_any(document_type: str | None) -> str:
    """Expected AI category for the bulk 'Verify documents' action, which checks
    EVERY uploaded document. Known types use their precise category; anything else
    is verified generically against its own human label (e.g. 'Relieving Letter')."""
    normalized = _normalize_employee_document_type(document_type)
    mapped = _DOCUMENT_AI_CATEGORY.get(normalized)
    if mapped:
        return mapped
    return _employee_document_label(normalized.removeprefix("selection_form_"))


def _apply_document_ai_verification(
    record: EmployeeDocument,
    *,
    document_type: str,
    content: bytes | None,
    mime_type: str | None,
) -> dict[str, Any] | None:
    """Run Vertex AI document-type verification on an uploaded employee document
    and record the verdict on the row. Non-blocking: a type mismatch sets
    ocr_status to "needs_review" (for HR follow-up) but the upload still succeeds.
    Returns the verdict (or None when skipped/failed). No-op when Vertex is
    disabled, the type isn't AI-verifiable, or the file is empty — so behaviour is
    unchanged unless VERTEX_AI_ENABLED=true."""
    expected_category = document_ai_expected_category(document_type)
    if not expected_category or not content or not vertex_ai.is_enabled():
        return None

    verdict = vertex_ai.verify_and_extract(content, mime_type, expected_category)
    if not verdict.get("ok"):
        return None  # AI call failed — leave the prior verdict and move on.

    record.ocr_provider = "vertex_gemini"
    # Persist the verdict WITHOUT extracted_fields, which can hold raw Aadhaar/PAN/
    # account numbers. HR only needs the type-match outcome + notes for triage.
    record.verification_data = {k: v for k, v in verdict.items() if k != "extracted_fields"}
    matched = verdict.get("matches_expected_category")
    if matched is True:
        record.ocr_status = "extracted"
    else:
        record.ocr_status = "needs_review"
        detected = verdict.get("detected_document_type") or "an unrecognised document"
        note = f"⚠ AI check: looks like {detected}, expected {expected_category}."
        record.remarks = f"{record.remarks} {note}".strip() if record.remarks else note
    return verdict


def verify_all_employee_documents(db: Session, *, employee_id: str) -> dict[str, Any]:
    """Re-run AI document-type verification across all of an employee's uploaded
    documents (HR "Verify documents" button). Updates each row's ocr_status /
    verification_data and returns a summary. Vertex calls run concurrently; the DB
    updates are applied on the calling thread (the session is not thread-safe)."""
    profile = db.get(EmployeeProfile, employee_id)
    if profile is None:
        raise ValueError("Employee not found")

    if not vertex_ai.is_enabled():
        return {
            "enabled": False,
            "total": 0, "verified": 0, "needsReview": 0, "skipped": 0, "failed": 0,
            "results": [],
            "message": "AI verification is not enabled.",
        }

    records = list(
        db.scalars(
            select(EmployeeDocument)
            .where(EmployeeDocument.employee_profile_id == profile.id)
            .order_by(EmployeeDocument.created_at.desc(), EmployeeDocument.updated_at.desc())
        )
    )
    # Verify the latest upload of EVERY candidate-uploaded document type (bank
    # proof, all educational docs, resume, relieving/experience letters, payslips,
    # certifications, etc.) — excluding system-generated artifacts (signed
    # contracts, generated compliance forms).
    latest_by_type: dict[str, EmployeeDocument] = {}
    for record in records:
        normalized = _normalize_employee_document_type(record.type)
        if normalized not in latest_by_type and not _is_system_generated_document(normalized):
            latest_by_type[normalized] = record
    targets = list(latest_by_type.values())

    def _read(record: EmployeeDocument) -> bytes | None:
        reference = _resolve_employee_file_reference(record.file_url)
        if isinstance(reference, Path) and reference.exists():
            try:
                return reference.read_bytes()
            except OSError:
                return None
        return None

    def _verify(record: EmployeeDocument) -> dict[str, Any] | None:
        content = _read(record)
        if not content:
            return None
        return vertex_ai.verify_and_extract(
            content, record.mime_type, verification_category_any(record.type)
        )

    # Run the (I/O-bound) Vertex calls concurrently, then apply DB writes on this thread.
    verdicts: list[tuple[EmployeeDocument, dict[str, Any] | None]] = []
    if targets:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(targets))) as ex:
            verdicts = list(zip(targets, ex.map(_verify, targets)))

    summary = {"verified": 0, "needsReview": 0, "failed": 0}
    results: list[dict[str, Any]] = []
    for record, verdict in verdicts:
        normalized_type = _normalize_employee_document_type(record.type)
        label = _employee_document_label(normalized_type)
        if not verdict or not verdict.get("ok"):
            summary["failed"] += 1
            results.append({"type": record.type, "label": label, "status": "failed",
                            "detected": None, "message": "Could not read or verify this file."})
            continue
        record.ocr_provider = "vertex_gemini"
        record.verification_data = {k: v for k, v in verdict.items() if k != "extracted_fields"}
        matched = verdict.get("matches_expected_category")
        detected = verdict.get("detected_document_type")
        if matched is True:
            record.ocr_status = "extracted"
            summary["verified"] += 1
            status = "verified"
            if normalized_type == "aadhaar":
                profile.aadhaar_ocr_status = "extracted"
                profile.aadhaar_validation_status = "passed"
                profile.aadhaar_mismatch_reason = None
                profile.aadhaar_ocr_match = True
                db.add(profile)
        else:
            record.ocr_status = "needs_review"
            summary["needsReview"] += 1
            status = "needs_review"
            if normalized_type == "aadhaar":
                profile.aadhaar_ocr_status = "needs_review"
                profile.aadhaar_validation_status = "needs_review"
                profile.aadhaar_mismatch_reason = verdict.get("validation_notes") or "Aadhaar document needs HR review."
                profile.aadhaar_ocr_match = False
                db.add(profile)
        db.add(record)
        results.append({"type": record.type, "label": label, "status": status,
                        "detected": detected, "message": verdict.get("validation_notes") or ""})

    db.flush()
    return {
        "enabled": True,
        "total": len(targets),
        "verified": summary["verified"],
        "needsReview": summary["needsReview"],
        "skipped": 0,
        "failed": summary["failed"],
        "results": results,
    }


def verify_document_content(
    *,
    content: bytes | None,
    mime_type: str | None,
    document_type: str,
) -> dict[str, Any]:
    """Run the lightweight document-type verifier for arbitrary file bytes.

    Used both by the candidate selection-form file picker (stateless) and by HR
    reviewing already-attached selection-form documents.
    """
    expected_category = document_ai_expected_category(document_type)
    skip = {
        "detectedDocumentType": None,
        "matchesExpectedCategory": None,
        "ocrStatus": "skipped",
        "message": "",
    }
    if not expected_category or not vertex_ai.is_enabled():
        return skip
    if not content:
        return skip

    label = _employee_document_label(_normalize_employee_document_type(document_type))
    try:
        verdict = vertex_ai.verify_and_extract(content, mime_type, expected_category)
    except Exception:
        logger.exception("Selection-form document verification failed for %s", document_type)
        return {
            "detectedDocumentType": None,
            "matchesExpectedCategory": None,
            "ocrStatus": "needs_review",
            "message": f"Could not auto-verify this {label}. HR will review it manually.",
        }
    if not verdict.get("ok"):
        return {
            "detectedDocumentType": None,
            "matchesExpectedCategory": None,
            "ocrStatus": "needs_review",
            "message": f"Could not auto-verify this {label}. You can still upload it.",
        }
    detected = verdict.get("detected_document_type")
    if verdict.get("matches_expected_category") is True:
        return {
            "detectedDocumentType": detected,
            "matchesExpectedCategory": True,
            "ocrStatus": "extracted",
            "message": f"Looks like a valid {label}.",
        }
    return {
        "detectedDocumentType": detected,
        "matchesExpectedCategory": False,
        "ocrStatus": "needs_review",
        "message": (
            f"This doesn't look like the expected {label} "
            f"(detected: {detected or 'unknown'}). Please double-check the file."
        ),
    }


def verify_document_type(*, file: UploadFile, document_type: str) -> dict[str, Any]:
    """Stateless AI document-type check used on file-select in the selection form
    (no DB write). Returns a small verdict the frontend shows as a non-blocking
    hint. No-op (status 'skipped', empty message) when the type isn't AI-verifiable
    or Vertex is disabled, so the form behaves exactly as before when off."""
    content = file.file.read()
    file.file.seek(0)
    return verify_document_content(
        content=content,
        mime_type=file.content_type,
        document_type=document_type,
    )


# EmployeeProfile attributes the import is allowed to set. The HR-only fields are always
# applied (the registrant cannot supply them); everything else only fills a blank field so a
# value the employee typed at registration is never overwritten.
_IMPORT_PROFILE_ALWAYS_FIELDS = {"vendor", "employment_status", "work_mode", "date_of_joining"}
# Fields whose value in profile_fields is a date string needing parse → datetime.
_IMPORT_PROFILE_DATE_FIELDS = {"date_of_birth", "date_of_joining"}
_IMPORT_PROFILE_FILL_IF_EMPTY_FIELDS = {
    "full_name",
    "personal_email",
    "phone",
    "department",
    "designation",
    "gender",
    "date_of_birth",
    "blood_group",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relation",
}
def _normalized_person_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def _role_value(value: Any) -> str:
    return value.value if isinstance(value, Role) else str(value)


def _user_has_any_role(user: User, roles: set[Role]) -> bool:
    values = {_role_value(user.role)} | {_role_value(role) for role in (user.roles or [])}
    return bool(values & {_role_value(role) for role in roles})


def _ensure_user_role(user: User, role: Role) -> bool:
    values = [_role_value(item) for item in (user.roles or [user.role])]
    if role.value in values:
        return False
    if _role_value(user.role) not in values:
        values.insert(0, _role_value(user.role))
    values.append(role.value)
    user.roles = values
    return True


def _resolve_imported_manager_user(db: Session, profile_fields: dict[str, Any]) -> User | None:
    manager_id = profile_fields.get("manager_id") or profile_fields.get("managerId")
    if manager_id:
        manager = db.get(User, str(manager_id))
        if manager is not None:
            return manager

    manager_code = normalize_employee_code(
        str(profile_fields.get("manager_employee_code") or profile_fields.get("managerEmployeeCode") or "")
    )
    manager_name = profile_fields.get("manager_name") or profile_fields.get("managerName")
    if manager_code:
        manager_profile = db.scalar(
            select(EmployeeProfile).where(
                func.upper(EmployeeProfile.employee_code) == manager_code
            )
        )
        if manager_profile and (
            not manager_name
            or _normalized_person_name(manager_profile.full_name) == _normalized_person_name(manager_name)
        ):
            return db.get(User, manager_profile.user_id) if manager_profile.user_id else None

    manager_email = normalize_email_value(str(profile_fields.get("manager_email") or ""))
    if manager_email:
        return db.scalar(
            select(User).where(func.lower(func.trim(User.email)) == manager_email)
        )
    return None


def _imported_manager_summary(db: Session, profile_fields: dict[str, Any]) -> dict[str, str | None]:
    manager = _resolve_imported_manager_user(db, profile_fields)
    if manager is not None:
        return {"managerId": manager.id, "managerName": manager.name, "managerEmail": manager.email}
    return {
        "managerId": profile_fields.get("manager_id") or profile_fields.get("managerId"),
        "managerName": profile_fields.get("manager_name") or profile_fields.get("managerName"),
        "managerEmail": profile_fields.get("manager_email") or profile_fields.get("managerEmail"),
    }


def _safe_parse_sheet_date(value: Any) -> datetime | None:
    """Parse a date from the HR sheet, tolerating ISO, DD-MM-YYYY, DD/MM/YYYY and DD-Mon-YYYY.
    Returns None on anything unparseable (never raises)."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    raw = str(value).strip()
    try:
        return parse_optional_datetime(raw)
    except Exception:
        pass
    for fmt in EMPLOYEE_DATE_INPUT_FORMATS:
        try:
            from datetime import datetime as _dt

            return _dt.strptime(raw, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def find_employee_import_staging(
    db: Session,
    *,
    ethara_email: str | None = None,
    employee_code: str | None = None,
    personal_email: str | None = None,
    phone: str | None = None,
) -> EmployeeImportStaging | None:
    """Find a pending staging row. Matches in priority order on the keys an employee uses to
    register: Ethara email -> employee code -> personal email -> phone."""
    candidates_keys = [
        (EmployeeImportStaging.ethara_email, normalize_email_value(ethara_email) if ethara_email else None),
        (EmployeeImportStaging.employee_code, normalize_employee_code(employee_code) if employee_code else None),
        (EmployeeImportStaging.personal_email, normalize_email_value(personal_email) if personal_email else None),
        (EmployeeImportStaging.phone, (phone or "").strip() or None),
    ]
    for column, value in candidates_keys:
        if not value:
            continue
        row = db.scalar(
            select(EmployeeImportStaging)
            .where(func.lower(func.trim(column)) == value, EmployeeImportStaging.status == "pending")
            .order_by(EmployeeImportStaging.created_at.asc())
        )
        if row is not None:
            return row
    return None


def apply_employee_import_staging(
    db: Session,
    *,
    profile: EmployeeProfile,
    ethara_email: str | None = None,
    employee_code: str | None = None,
    personal_email: str | None = None,
    phone: str | None = None,
    actor: User | None = None,
) -> EmployeeImportStaging | None:
    """Merge a matching pre-loaded staging row into a freshly created EmployeeProfile.

    Fills profile columns (HR-only fields always; others only when blank), pre-fills the
    selection form with the staged data, attaches the already-downloaded documents, and marks
    the staging row consumed. Sends NO email and creates NO account. No-op if nothing matches.
    """
    staging = find_employee_import_staging(
        db,
        ethara_email=ethara_email,
        employee_code=employee_code,
        personal_email=personal_email,
        phone=phone,
    )
    if staging is None:
        return None

    profile_fields = staging.profile_fields or {}
    profile_user = db.get(User, profile.user_id) if profile.user_id else None
    if profile_user is not None and profile_fields.get("is_reporting_manager"):
        if _ensure_user_role(profile_user, Role.MANAGER):
            db.add(profile_user)

    for field, value in profile_fields.items():
        if value in (None, ""):
            continue
        if field in _IMPORT_PROFILE_ALWAYS_FIELDS:
            if field in _IMPORT_PROFILE_DATE_FIELDS:
                parsed = _safe_parse_sheet_date(value)
                if parsed is not None:
                    setattr(profile, field, parsed)
            else:
                setattr(profile, field, value)
        elif field in _IMPORT_PROFILE_FILL_IF_EMPTY_FIELDS and not getattr(profile, field, None):
            if field in _IMPORT_PROFILE_DATE_FIELDS:
                parsed = _safe_parse_sheet_date(value)
                if parsed is not None:
                    setattr(profile, field, parsed)
            else:
                setattr(profile, field, value)

    manager_user = _resolve_imported_manager_user(db, profile_fields)
    if manager_user is not None and manager_user.id != profile.user_id:
        profile.manager_id = manager_user.id

    # Aadhaar: only adopt the staged hash/last4 if the registrant didn't provide their own.
    if staging.aadhaar_hash and not profile.aadhaar_hash:
        profile.aadhaar_hash = staging.aadhaar_hash
    if staging.aadhaar_last4 and not profile.aadhaar_last4:
        profile.aadhaar_last4 = staging.aadhaar_last4
    # Carry the imported Aadhaar OCR result onto the profile (only if not already verified
    # by the registrant uploading their own Aadhaar at signup).
    if not profile.aadhaar_ocr_status:
        if profile_fields.get("aadhaar_ocr_status"):
            profile.aadhaar_ocr_status = profile_fields.get("aadhaar_ocr_status")
        if profile_fields.get("aadhaar_ocr_match") is not None:
            profile.aadhaar_ocr_match = profile_fields.get("aadhaar_ocr_match")
        if profile_fields.get("aadhaar_ocr_name"):
            profile.aadhaar_ocr_name = profile_fields.get("aadhaar_ocr_name")
        if profile_fields.get("aadhaar_validation_status"):
            profile.aadhaar_validation_status = profile_fields.get("aadhaar_validation_status")
        if profile_fields.get("aadhaar_mismatch_reason"):
            profile.aadhaar_mismatch_reason = profile_fields.get("aadhaar_mismatch_reason")
        if profile_fields.get("aadhaar_extracted"):
            profile.aadhaar_extracted = profile_fields.get("aadhaar_extracted")
    db.add(profile)

    # Pre-fill the selection form; staged values fill gaps, never clobber submitted answers.
    if staging.form_data:
        form = ensure_employee_selection_form(db, profile=profile)
        merged = dict(staging.form_data)
        merged.update(form.form_data or {})  # existing/submitted values win
        form.form_data = merged
        if form.status not in {"submitted", "verified"}:
            form.status = "prefilled"
        db.add(form)

    # Attach pre-downloaded documents (skip a type that already has a document row).
    existing_types = {
        doc.type
        for doc in db.scalars(
            select(EmployeeDocument).where(EmployeeDocument.employee_profile_id == profile.id)
        )
    }
    attached: list[str] = []
    for doc in staging.documents or []:
        doc_type = _normalize_employee_document_type(doc.get("type"))
        if not doc_type or not doc.get("file_url") or doc_type in existing_types:
            continue
        db.add(
            EmployeeDocument(
                employee_profile_id=profile.id,
                type=doc_type,
                file_name=doc.get("file_name") or f"{doc_type}",
                file_url=doc["file_url"],
                file_size=doc.get("file_size"),
                mime_type=doc.get("mime_type"),
                status="uploaded",
                uploaded_by=actor.id if actor else None,
            )
        )
        existing_types.add(doc_type)
        attached.append(doc_type)
        # Mirror to the denormalized profile paths used elsewhere.
        if doc_type == "aadhaar" and not profile.aadhaar_path:
            profile.aadhaar_path = doc["file_url"]
        if doc_type == "resume" and not profile.resume_path:
            profile.resume_path = doc["file_url"]

    staging.status = "consumed"
    staging.consumed_by_profile_id = profile.id
    staging.consumed_at = datetime.now(UTC)
    db.add(staging)

    log_audit(
        db,
        entity_type="employee_profile",
        entity_id=profile.id,
        action="employee_import_merged",
        actor=actor,
        user_id=profile.user_id,
        new_value={
            "stagingId": staging.id,
            "documentsAttached": attached,
            "prefilledSelectionForm": bool(staging.form_data),
        },
    )
    return staging


def get_profile_photo_endpoint(db: Session, profile: EmployeeProfile | None) -> str | None:
    """Authenticated preview endpoint for the employee's uploaded passport photo
    (EmployeeDocument type='photo'), used by the dashboard avatar and the global
    top-bar/profile avatar. Returns None when no photo has been uploaded."""
    if profile is None:
        return None
    photo_doc = _latest_employee_document_record(db, profile=profile, document_type="photo")
    if photo_doc and photo_doc.file_url:
        return f"/api/v1/employees/me/documents/{photo_doc.id}/preview"
    return None


def get_employee_profile_for_user(db: Session, user: User) -> EmployeeProfile | None:
    profile = db.scalar(select(EmployeeProfile).where(EmployeeProfile.user_id == user.id))
    if profile is not None:
        return profile
    return db.scalar(
        select(EmployeeProfile).where(
            func.lower(func.trim(EmployeeProfile.ethara_email)) == normalize_email_value(user.email)
        )
    )


def get_employee_profile_or_404(db: Session, *, employee_id: str) -> EmployeeProfile:
    profile = db.get(EmployeeProfile, employee_id)
    if profile is not None:
        return profile
    raise ValueError("Employee profile not found")


def _employee_registration_audit(db: Session, user_id: str) -> AuditLog | None:
    return db.scalar(
        select(AuditLog)
        .where(
            AuditLog.user_id == user_id,
            AuditLog.entity_type == EMPLOYEE_REGISTRATION_ENTITY,
        )
        .order_by(AuditLog.created_at.desc())
    )


def _profile_lookup(
    db: Session,
    *,
    user: User | None = None,
    ethara_email: str | None = None,
    employee_code: str | None = None,
) -> EmployeeProfile | None:
    if user is not None:
        profile = db.scalar(select(EmployeeProfile).where(EmployeeProfile.user_id == user.id))
        if profile is not None:
            return profile

    normalized_email = normalize_email_value(ethara_email) if ethara_email else None
    if normalized_email:
        profile = db.scalar(
            select(EmployeeProfile).where(
                func.lower(func.trim(EmployeeProfile.ethara_email)) == normalized_email
            )
        )
        if profile is not None:
            return profile

    normalized_code = normalize_employee_code(employee_code) if employee_code else None
    if normalized_code:
        profile = db.scalar(
            select(EmployeeProfile).where(EmployeeProfile.employee_code == normalized_code)
        )
        if profile is not None:
            return profile
    return None


def ensure_employee_profile(
    db: Session,
    *,
    user: User | None,
    activate_user: bool = False,
    full_name: str | None = None,
    ethara_email: str | None = None,
    personal_email: str | None = None,
    employee_code: str | None = None,
    phone: str | None = None,
    department: str | None = None,
    designation: str | None = None,
    gender: str | None = None,
    aadhaar_hash: str | None = None,
    aadhaar_last4: str | None = None,
    date_of_birth: str | datetime | None = None,
    aadhaar_path: str | None = None,
    resume_path: str | None = None,
    aadhaar_ocr_status: str | None = None,
    aadhaar_ocr_match: bool | None = None,
    aadhaar_ocr_name: str | None = None,
    aadhaar_validation_status: str | None = None,
    aadhaar_mismatch_reason: str | None = None,
    aadhaar_extracted: dict | None = None,
) -> EmployeeProfile:
    normalized_ethara = normalize_email_value(ethara_email or (user.email if user else ""))
    normalized_personal = normalize_email_value(personal_email) if personal_email else None
    normalized_code = normalize_employee_code(employee_code) if employee_code else None
    resolved_name = (full_name or (user.name if user else "")).strip()
    resolved_phone = (phone or (user.phone if user else None) or None)
    parsed_dob = parse_optional_datetime(date_of_birth)

    profile = _profile_lookup(
        db,
        user=user,
        ethara_email=normalized_ethara or None,
        employee_code=normalized_code,
    )

    # A candidate's GRP code (allocated at contract signing) must never be claimed by a
    # DIFFERENT person through conversion/sync/registration-completion — doing so hijacks that
    # candidate's attendance/leave/reimbursement rows (all keyed by employee code) and is how
    # codes ended up double-assigned. We only guard a *new* assignment: a profile that already
    # owns this code, or the same person matched by email, is always allowed — otherwise an
    # idempotent re-ensure (load/sync) of a legitimately code-sharing profile would 500.
    profile_owns_code = (
        profile is not None
        and normalize_employee_code(profile.employee_code or "") == normalized_code
    )
    if normalized_code and not profile_owns_code:
        clashing_candidate = db.scalar(
            select(Candidate)
            .where(func.upper(Candidate.employee_code) == normalized_code)
            .where(Candidate.is_removed.is_(False))
            .limit(1)
        )
        if clashing_candidate is not None:
            clash_emails = {
                normalize_email_value(e)
                for e in (clashing_candidate.ethara_email, clashing_candidate.personal_email)
                if e
            }
            profile_emails = {
                normalize_email_value(e)
                for e in (
                    normalized_ethara,
                    normalized_personal,
                    profile.ethara_email if profile else None,
                    profile.personal_email if profile else None,
                )
                if e
            }
            if clash_emails and not (clash_emails & profile_emails):
                clash_label = (
                    clashing_candidate.full_name
                    or clashing_candidate.ethara_email
                    or clashing_candidate.personal_email
                )
                raise ValueError(
                    f"Employee code {normalized_code} is already assigned to candidate "
                    f"{clash_label}; it cannot be reused for {normalized_ethara or resolved_name}."
                )

    if profile is None:
        if not normalized_ethara or not normalized_code or not resolved_name:
            raise ValueError("Employee profile requires employee name, company email, and employee code.")
        profile = EmployeeProfile(
            user_id=user.id if user else None,
            full_name=resolved_name,
            ethara_email=normalized_ethara,
            personal_email=normalized_personal,
            employee_code=normalized_code,
        )

    if user is not None:
        profile.user_id = user.id
        user.email = normalized_ethara or user.email
        user.name = resolved_name or user.name
        user.phone = resolved_phone
        if user.role == Role.EMPLOYEE_REFERRER:
            user.role = Role.EMPLOYEE
        else:
            user.role = Role.EMPLOYEE
        if activate_user:
            user.is_active = True
        user.email_verified_at = user.email_verified_at or datetime.now(UTC)
        db.add(user)

    profile.full_name = resolved_name or profile.full_name
    profile.ethara_email = normalized_ethara or profile.ethara_email
    profile.personal_email = normalized_personal or profile.personal_email
    profile.employee_code = normalized_code or profile.employee_code
    profile.phone = resolved_phone or profile.phone
    profile.department = department.strip() if department else profile.department
    profile.designation = designation.strip() if designation else profile.designation
    profile.gender = gender.strip() if gender else profile.gender
    profile.aadhaar_hash = aadhaar_hash or profile.aadhaar_hash
    profile.aadhaar_last4 = aadhaar_last4 or profile.aadhaar_last4
    profile.date_of_birth = parsed_dob or profile.date_of_birth
    profile.aadhaar_path = aadhaar_path or profile.aadhaar_path
    profile.resume_path = resume_path or profile.resume_path
    profile.aadhaar_ocr_status = aadhaar_ocr_status or profile.aadhaar_ocr_status
    if aadhaar_ocr_match is not None:
        profile.aadhaar_ocr_match = aadhaar_ocr_match
    if aadhaar_ocr_name is not None:
        profile.aadhaar_ocr_name = aadhaar_ocr_name
    if aadhaar_validation_status is not None:
        profile.aadhaar_validation_status = aadhaar_validation_status
    if aadhaar_mismatch_reason is not None:
        profile.aadhaar_mismatch_reason = aadhaar_mismatch_reason
    if aadhaar_extracted:
        profile.aadhaar_extracted = aadhaar_extracted

    db.add(profile)
    db.flush()
    return profile


def create_employee_account(
    db: Session,
    *,
    full_name: str,
    ethara_email: str,
    personal_email: str,
    employee_code: str,
    phone: str,
    department: str,
    designation: str,
    gender: str,
    password: str,
    aadhaar_hash: str | None = None,
    aadhaar_last4: str | None = None,
    date_of_birth: str | datetime | None = None,
    aadhaar_path: str | None = None,
    resume_path: str | None = None,
    aadhaar_ocr_status: str | None = None,
    aadhaar_ocr_match: bool | None = None,
    aadhaar_ocr_name: str | None = None,
    aadhaar_validation_status: str | None = None,
    aadhaar_mismatch_reason: str | None = None,
    aadhaar_extracted: dict | None = None,
) -> tuple[User, EmployeeProfile]:
    user = User(
        email=normalize_email_value(ethara_email),
        password_hash=hash_password(password),
        name=full_name.strip(),
        phone=phone.strip(),
        role=Role.EMPLOYEE,
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()

    profile = ensure_employee_profile(
        db,
        user=user,
        full_name=full_name,
        ethara_email=ethara_email,
        personal_email=personal_email,
        employee_code=employee_code,
        phone=phone,
        department=department,
        designation=designation,
        gender=gender,
        aadhaar_hash=aadhaar_hash,
        aadhaar_last4=aadhaar_last4,
        date_of_birth=date_of_birth,
        aadhaar_path=aadhaar_path,
        resume_path=resume_path,
        aadhaar_ocr_status=aadhaar_ocr_status,
        aadhaar_ocr_match=aadhaar_ocr_match,
        aadhaar_ocr_name=aadhaar_ocr_name,
        aadhaar_validation_status=aadhaar_validation_status,
        aadhaar_mismatch_reason=aadhaar_mismatch_reason,
        aadhaar_extracted=aadhaar_extracted,
    )
    prefill_employee_selection_form_from_profile(db, profile=profile)
    return user, profile


def _find_candidate_for_employee_profile(db: Session, profile: EmployeeProfile) -> Candidate | None:
    normalized_code = normalize_employee_code(profile.employee_code) if profile.employee_code else None
    normalized_ethara = normalize_email_value(profile.ethara_email) if profile.ethara_email else None
    normalized_personal = normalize_email_value(profile.personal_email) if profile.personal_email else None

    if normalized_personal:
        candidate = db.scalar(
            select(Candidate)
            .where(
                func.lower(func.trim(Candidate.personal_email)) == normalized_personal,
                Candidate.is_removed.is_(False),
            )
            .order_by(Candidate.created_at.asc())
        )
        if candidate is not None:
            return candidate

    if normalized_code:
        candidate = db.scalar(
            select(Candidate)
            .where(
                func.upper(func.trim(Candidate.employee_code)) == normalized_code,
                Candidate.is_removed.is_(False),
            )
            .order_by(Candidate.created_at.asc())
        )
        if candidate is not None:
            return candidate

    if normalized_ethara:
        candidate = db.scalar(
            select(Candidate)
            .where(
                func.lower(func.trim(func.coalesce(Candidate.ethara_email, ""))) == normalized_ethara,
                Candidate.is_removed.is_(False),
            )
            .order_by(Candidate.created_at.asc())
        )
        if candidate is not None:
            return candidate

        return db.scalar(
            select(Candidate)
            .join(ITRequest, ITRequest.candidate_id == Candidate.id)
            .where(
                Candidate.is_removed.is_(False),
                or_(
                    func.lower(func.trim(ITRequest.suggested_email)) == normalized_ethara,
                    func.lower(func.trim(func.coalesce(ITRequest.created_email, ""))) == normalized_ethara,
                ),
            )
            .order_by(ITRequest.created_at.asc())
        )

    return None


def reconcile_candidate_it_request_for_employee_profile(
    db: Session,
    *,
    profile: EmployeeProfile,
    actor: User | None = None,
) -> dict[str, Any]:
    """Map a bulk-created employee profile back to its candidate IT email request."""
    candidate = _find_candidate_for_employee_profile(db, profile)
    if candidate is None:
        return {
            "candidateId": None,
            "emailMapped": False,
            "employeeCodeMapped": False,
            "itRequestCompleted": False,
            "backfilledDocumentCount": 0,
            "employeeSelectionFormStatus": None,
        }

    normalized_email = normalize_email_value(profile.ethara_email) if profile.ethara_email else None
    normalized_code = normalize_employee_code(profile.employee_code) if profile.employee_code else None

    email_mapped = False
    employee_code_mapped = False
    if normalized_email and normalize_email_value(candidate.ethara_email or "") != normalized_email:
        candidate.ethara_email = normalized_email
        email_mapped = True

    if normalized_code and not candidate.employee_code:
        existing_candidate_id = db.scalar(
            select(Candidate.id)
            .where(
                func.upper(func.trim(Candidate.employee_code)) == normalized_code,
                Candidate.id != candidate.id,
            )
            .limit(1)
        )
        if existing_candidate_id is None:
            candidate.employee_code = normalized_code
            employee_code_mapped = True

    if candidate.current_stage in {
        CandidateStage.CONTRACT_SIGNED,
        CandidateStage.INDUCTION_COMPLETED,
    }:
        candidate.current_stage = CandidateStage.IT_EMAIL_CREATED
        candidate.current_status = "IT Email Created"

    db.add(candidate)

    it_request_completed = False
    request = db.scalar(select(ITRequest).where(ITRequest.candidate_id == candidate.id))
    if request is not None:
        if normalized_email and request.created_email != normalized_email:
            request.created_email = normalized_email
        if request.status != "completed":
            request.status = "completed"
            request.completed_at = datetime.now(UTC)
            it_request_completed = True
        elif request.completed_at is None:
            request.completed_at = datetime.now(UTC)
        db.add(request)

    added_documents = backfill_candidate_documents_to_employee(
        db,
        candidate=candidate,
        profile=profile,
        actor=actor,
    )
    candidate_form = candidate.selection_form
    mark_employee_form_submitted = bool(
        candidate_form is not None and (candidate_form.submitted_at or candidate_form.validated_at)
    )
    employee_form = prefill_employee_selection_form_from_candidate(
        db,
        candidate=candidate,
        profile=profile,
        actor=actor,
        mark_submitted=mark_employee_form_submitted,
    )

    if email_mapped or employee_code_mapped or it_request_completed:
        log_audit(
            db,
            entity_type="it_request",
            entity_id=request.id if request is not None else candidate.id,
            action="employee_profile_it_request_reconciled",
            actor=actor,
            candidate_id=candidate.id,
            user_id=profile.user_id,
            new_value={
                "employeeProfileId": profile.id,
                "etharaEmail": normalized_email,
                "employeeCode": normalized_code,
                "emailMapped": email_mapped,
                "employeeCodeMapped": employee_code_mapped,
                "itRequestCompleted": it_request_completed,
                "backfilledDocumentCount": len(added_documents),
                "employeeSelectionFormStatus": employee_form.status,
            },
        )

    return {
        "candidateId": candidate.id,
        "emailMapped": email_mapped,
        "employeeCodeMapped": employee_code_mapped,
        "itRequestCompleted": it_request_completed,
        "backfilledDocumentCount": len(added_documents),
        "employeeSelectionFormStatus": employee_form.status,
    }


def _employee_registration_selection_form_data(profile: EmployeeProfile) -> dict[str, str]:
    date_of_birth = profile.date_of_birth.date().isoformat() if profile.date_of_birth else ""
    contact_number = "".join(ch for ch in str(profile.phone or "") if ch.isdigit())
    return {
        "employeeCode": profile.employee_code or "",
        "employeeName": profile.full_name or "",
        "department": profile.department or "",
        "designation": profile.designation or "",
        "dateOfBirth": date_of_birth,
        "gender": profile.gender or "",
        "contactNumber": contact_number,
        "personalEmail": profile.personal_email or "",
        "officialEmail": profile.ethara_email or "",
        "aadhaarNumber": f"**** **** {profile.aadhaar_last4}" if profile.aadhaar_last4 else "",
    }


def prefill_employee_selection_form_from_profile(
    db: Session,
    *,
    profile: EmployeeProfile,
) -> EmployeeSelectionForm:
    record = ensure_employee_selection_form(db, profile=profile)
    form_data = dict(record.form_data or {})
    changed = False

    for key, value in _employee_registration_selection_form_data(profile).items():
        if not value:
            continue
        existing = form_data.get(key)
        if existing is None or (isinstance(existing, str) and not existing.strip()):
            form_data[key] = value
            changed = True

    if changed:
        record.form_data = form_data
        if record.status not in {"submitted", "verified"}:
            record.status = "prefilled"
        db.add(record)
        db.flush()
    return record


def _candidate_selection_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _candidate_selection_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            text = value.strip()
        elif isinstance(value, datetime):
            text = value.date().isoformat()
        elif isinstance(value, date):
            text = value.isoformat()
        else:
            text = str(value).strip()
        if text:
            return text
    return ""


def _candidate_selection_date_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        text = _candidate_selection_text(value)
        if not text:
            continue
        parsed = _safe_parse_sheet_date(text)
        return parsed.date().isoformat() if parsed else text
    return ""


def _candidate_selection_yes_no(value: Any) -> str:
    text = _candidate_selection_text(value).strip().lower()
    if text in {"yes", "y", "true", "1"}:
        return "yes"
    if text in {"no", "n", "false", "0"}:
        return "no"
    return text


def _candidate_selection_marital_status(value: Any) -> str:
    text = _candidate_selection_text(value).strip().lower().replace("-", "_")
    if text in {"unmarried", "single"}:
        return "single"
    return text


def _candidate_selection_gender(value: Any) -> str:
    text = _candidate_selection_text(value).strip().lower().replace("-", "_").replace(" ", "_")
    return text


def _selection_upload_file_name(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("fileName", "file_name", "filename", "name", "originalName"):
            text = _candidate_selection_text(value.get(key))
            if text:
                return text
        file_url = _candidate_selection_text(
            value.get("fileUrl"),
            value.get("file_url"),
            value.get("url"),
        )
        if file_url:
            return _backfilled_file_name(file_url, "")
        return ""
    return _candidate_selection_text(value)


def _candidate_selection_uploaded_documents(form_data: dict[str, Any]) -> dict[str, str]:
    uploads: dict[str, str] = {}
    for key in ("documentsUploaded", "uploadedDocuments"):
        raw_uploads = form_data.get(key)
        if not isinstance(raw_uploads, dict):
            continue
        for raw_type, raw_file in raw_uploads.items():
            document_type = _normalize_employee_document_type(str(raw_type))
            file_name = _selection_upload_file_name(raw_file)
            if document_type and file_name:
                uploads[document_type] = file_name
    return uploads


def _employee_selection_form_data_from_candidate(
    db: Session,
    *,
    candidate: Candidate,
    profile: EmployeeProfile,
) -> dict[str, Any]:
    selection_form = candidate.selection_form
    source = (
        selection_form.form_data
        if selection_form is not None and isinstance(selection_form.form_data, dict)
        else {}
    )
    basic = _candidate_selection_record(source.get("basicDetails"))
    personal = _candidate_selection_record(source.get("personalDetails"))
    identity = _candidate_selection_record(source.get("identityDetails"))
    address = _candidate_selection_record(source.get("addressDetails"))
    emergency = _candidate_selection_record(source.get("emergencyContact"))
    bank = _candidate_selection_record(source.get("bankDetails"))
    aadhaar_extracted = (
        candidate.aadhaar_extracted if isinstance(candidate.aadhaar_extracted, dict) else {}
    )
    id_card_form = db.scalar(
        select(CandidateIdCardForm).where(CandidateIdCardForm.candidate_id == candidate.id)
    )
    position = candidate.position
    aadhaar_number = _candidate_selection_text(
        identity.get("aadhaarNumber"),
        personal.get("aadhaarNumber"),
        aadhaar_extracted.get("aadhaarNumber"),
    )
    if not aadhaar_number and candidate.aadhaar_last4:
        aadhaar_number = f"**** **** {candidate.aadhaar_last4}"

    has_uan_number = _candidate_selection_yes_no(
        identity.get("hasUanNumber", personal.get("hasUanNumber"))
    )
    uan_number = _candidate_selection_text(identity.get("uanNumber"), personal.get("uanNumber"))
    if not has_uan_number and uan_number:
        has_uan_number = "yes"

    has_savings = _candidate_selection_yes_no(bank.get("hasSavingsAccount"))
    has_salary = _candidate_selection_yes_no(bank.get("hasSalaryAccount"))
    bank_account = _candidate_selection_text(bank.get("accountNumber"), bank.get("bankAccount"))
    bank_name = _candidate_selection_text(bank.get("bankName"))
    ifsc_code = _candidate_selection_text(bank.get("ifsc"), bank.get("ifscCode")).upper()
    if not has_savings and (bank_account or bank_name or ifsc_code):
        has_savings = "yes"
    if not has_salary and (bank_account or bank_name or ifsc_code):
        has_salary = "yes"

    kids_count_text = _candidate_selection_text(personal.get("kidsCount"))
    try:
        kids_count = int(kids_count_text) if kids_count_text else 0
    except ValueError:
        kids_count = 0

    data: dict[str, Any] = {
        "employeeCode": _candidate_selection_text(
            profile.employee_code,
            candidate.employee_code,
            candidate.candidate_code,
        ),
        "employeeName": _candidate_selection_text(
            basic.get("fullName"),
            candidate.full_name,
            profile.full_name,
        ),
        "department": _candidate_selection_text(
            profile.department,
            getattr(position, "department", None) if position else None,
        ),
        "designation": _candidate_selection_text(
            profile.designation,
            getattr(position, "title", None) if position else None,
        ),
        "dateOfBirth": _candidate_selection_date_text(
            basic.get("dateOfBirth"),
            candidate.date_of_birth,
            aadhaar_extracted.get("dateOfBirth"),
            aadhaar_extracted.get("dob"),
        ),
        "gender": _candidate_selection_gender(personal.get("gender") or candidate.gender),
        "contactNumber": "".join(
            ch
            for ch in _candidate_selection_text(
                basic.get("contactNumber"),
                candidate.phone,
                profile.phone,
            )
            if ch.isdigit()
        ),
        "personalEmail": normalize_email_value(
            _candidate_selection_text(basic.get("email"), candidate.personal_email, profile.personal_email)
        ),
        "officialEmail": normalize_email_value(
            _candidate_selection_text(candidate.ethara_email, profile.ethara_email)
        ),
        "aadhaarNumber": aadhaar_number,
        "maritalStatus": _candidate_selection_marital_status(personal.get("maritalStatus")),
        "marriageDate": _candidate_selection_date_text(personal.get("anniversaryDate")),
        "spouseName": _candidate_selection_text(personal.get("spouseName")),
        "hasKids": "yes" if kids_count > 0 else "no",
        "bloodGroup": _candidate_selection_text(
            profile.blood_group,
            id_card_form.blood_group if id_card_form else None,
        ),
        "highestQualification": _candidate_selection_text(basic.get("qualification")),
        "fatherName": _candidate_selection_text(personal.get("fatherName")),
        "motherName": _candidate_selection_text(personal.get("motherName")),
        "currentAddress": _candidate_selection_text(address.get("currentAddress")),
        "permanentAddress": _candidate_selection_text(address.get("permanentAddress")),
        "emergencyContactName": _candidate_selection_text(
            emergency.get("name"),
            profile.emergency_contact_name,
        ),
        "emergencyContactPhone": "".join(
            ch for ch in _candidate_selection_text(
                emergency.get("phone"),
                id_card_form.emergency_no if id_card_form else None,
                profile.emergency_contact_phone,
            )
            if ch.isdigit()
        )[:10],
        "emergencyContactRelation": _candidate_selection_text(
            emergency.get("relation"),
            profile.emergency_contact_relation,
        ),
        "panNumber": _candidate_selection_text(identity.get("panNumber"), personal.get("pan")).upper(),
        "hasUanNumber": has_uan_number,
        "uanNumber": "".join(ch for ch in uan_number if ch.isdigit()),
        "hasSavingsAccount": has_savings,
        "hasSalaryAccount": has_salary,
        "bankName": bank_name,
        "bankAccount": "".join(ch for ch in bank_account if ch.isdigit()),
        "accountNumber": "".join(ch for ch in bank_account if ch.isdigit()),
        "ifscCode": ifsc_code,
        "salaryAccountInstruction": _candidate_selection_text(bank.get("salaryAccountInstruction")),
    }
    uploaded_documents = _candidate_selection_uploaded_documents(source)
    if uploaded_documents:
        data["documentsUploaded"] = uploaded_documents
    return {key: value for key, value in data.items() if value not in (None, "")}


def _merge_employee_selection_form_data(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> tuple[dict[str, Any], bool]:
    merged = dict(current)
    changed = False
    for key, value in incoming.items():
        if value in (None, ""):
            continue
        if key == "documentsUploaded" and isinstance(value, dict):
            existing_uploads = merged.get(key) if isinstance(merged.get(key), dict) else {}
            next_uploads = dict(existing_uploads)
            for doc_type, file_name in value.items():
                if not _selection_upload_file_name(next_uploads.get(doc_type)):
                    next_uploads[doc_type] = file_name
            if next_uploads != existing_uploads:
                merged[key] = next_uploads
                changed = True
            continue
        existing = merged.get(key)
        if existing is None or (isinstance(existing, str) and not existing.strip()):
            merged[key] = value
            changed = True
    return merged, changed


def _sync_employee_profile_from_selection_data(
    profile: EmployeeProfile,
    form_data: dict[str, Any],
) -> bool:
    changed = False

    def fill_text(attr: str, *keys: str, normalize=None) -> None:
        nonlocal changed
        current = getattr(profile, attr)
        if current not in (None, ""):
            return
        value = _candidate_selection_text(*(form_data.get(key) for key in keys))
        if normalize is not None:
            value = normalize(value)
        if value:
            setattr(profile, attr, value)
            changed = True

    fill_text("full_name", "employeeName")
    fill_text("personal_email", "personalEmail", normalize=normalize_email_value)
    fill_text(
        "phone",
        "contactNumber",
        normalize=lambda value: "".join(ch for ch in value if ch.isdigit()),
    )
    fill_text("department", "department")
    fill_text("designation", "designation")
    fill_text("gender", "gender")
    fill_text("blood_group", "bloodGroup", normalize=normalize_blood_group)
    fill_text("emergency_contact_name", "emergencyContactName")
    fill_text(
        "emergency_contact_phone",
        "emergencyContactPhone",
        normalize=lambda value: "".join(ch for ch in value if ch.isdigit())[:10],
    )
    fill_text("emergency_contact_relation", "emergencyContactRelation")

    if profile.date_of_birth is None:
        parsed_dob = _safe_parse_sheet_date(form_data.get("dateOfBirth"))
        if parsed_dob is not None:
            profile.date_of_birth = parsed_dob
            changed = True

    if not profile.aadhaar_last4:
        aadhaar_digits = "".join(
            ch
            for ch in _candidate_selection_text(form_data.get("aadhaarNumber"))
            if ch.isdigit()
        )
        if len(aadhaar_digits) >= 4:
            profile.aadhaar_last4 = aadhaar_digits[-4:]
            changed = True

    return changed


def prefill_employee_selection_form_from_candidate(
    db: Session,
    *,
    candidate: Candidate,
    profile: EmployeeProfile,
    actor: User | None = None,
    mark_submitted: bool = False,
) -> EmployeeSelectionForm:
    record = ensure_employee_selection_form(db, profile=profile)
    candidate_data = _employee_selection_form_data_from_candidate(
        db,
        candidate=candidate,
        profile=profile,
    )
    current_data = record.form_data if isinstance(record.form_data, dict) else {}
    merged_data, changed = _merge_employee_selection_form_data(current_data, candidate_data)
    profile_changed = _sync_employee_profile_from_selection_data(profile, merged_data)

    candidate_form = candidate.selection_form
    submitted_at = (
        candidate_form.submitted_at
        if candidate_form is not None and candidate_form.submitted_at is not None
        else candidate_form.validated_at
        if candidate_form is not None and candidate_form.validated_at is not None
        else datetime.now(UTC)
    )
    status_changed = False
    if mark_submitted and record.status != "submitted":
        record.status = "submitted"
        record.submitted_at = record.submitted_at or submitted_at
        status_changed = True
    elif mark_submitted and record.submitted_at is None:
        record.submitted_at = submitted_at
        status_changed = True

    if changed:
        record.form_data = merged_data
    if changed or status_changed:
        db.add(record)
    if profile_changed:
        db.add(profile)
    if changed or status_changed or profile_changed:
        log_audit(
            db,
            entity_type="employee_selection_form",
            entity_id=record.id,
            action="employee_selection_form_prefilled_from_candidate",
            actor=actor,
            candidate_id=candidate.id,
            user_id=profile.user_id,
            new_value={
                "status": record.status,
                "employeeProfileId": profile.id,
                "prefilledFields": sorted(candidate_data.keys()),
                "profileSynced": profile_changed,
            },
        )
        db.flush()
    return record


def repair_completed_candidate_employee_onboarding(
    db: Session,
    *,
    profile: EmployeeProfile,
    actor: User | None = None,
) -> bool:
    candidate = _find_candidate_for_employee_profile(db, profile)
    if candidate is None or candidate.current_stage != CandidateStage.ONBOARDING_COMPLETED:
        return False
    before_form = db.scalar(
        select(EmployeeSelectionForm).where(EmployeeSelectionForm.employee_profile_id == profile.id)
    )
    before_status = before_form.status if before_form is not None else None
    before_profile_values = (
        profile.date_of_birth,
        profile.gender,
        profile.blood_group,
        profile.emergency_contact_phone,
    )
    added_documents = backfill_candidate_documents_to_employee(
        db,
        candidate=candidate,
        profile=profile,
        actor=actor,
    )
    record = prefill_employee_selection_form_from_candidate(
        db,
        candidate=candidate,
        profile=profile,
        actor=actor,
        mark_submitted=True,
    )
    after_profile_values = (
        profile.date_of_birth,
        profile.gender,
        profile.blood_group,
        profile.emergency_contact_phone,
    )
    return bool(
        added_documents
        or before_status != record.status
        or before_profile_values != after_profile_values
    )


def _derive_ethara_email(full_name: str, personal_email: str | None) -> str:
    base = re.sub(r"[^a-z0-9]+", ".", (full_name or "").strip().lower()).strip(".")
    if not base and personal_email:
        base = personal_email.split("@", 1)[0].lower()
    return f"{base or 'employee'}@ethara.ai"


def _send_employee_credentials_email(
    *, employee_name: str, login_email: str, temporary_password: str, ethara_id: str,
    recipient_email: str | None = None,
) -> None:
    settings = get_settings()
    login_url = f"{settings.frontend_url.rstrip('/')}/login?email={quote(login_email)}"
    subject = "Welcome to Ethara — your employee login is ready"
    body_text = (
        f"Hi {employee_name},\n\n"
        "Congratulations and welcome to Ethara! Your employee account has been created.\n\n"
        f"Ethara ID: {ethara_id}\n"
        f"Login email: {login_email}\n"
        f"Temporary password: {temporary_password}\n"
        f"Employee login: {login_url}\n\n"
        "Please sign in and change your password. This login is separate from your candidate portal login.\n"
    )
    body_html = (
        f"<p>Hi {employee_name},</p>"
        "<p>Congratulations and welcome to <strong>Ethara</strong>! Your employee account has been created.</p>"
        f"<p><strong>Ethara ID:</strong> {ethara_id}<br />"
        f"<strong>Login email:</strong> {login_email}<br />"
        f"<strong>Temporary password:</strong> {temporary_password}</p>"
        f"<p><a href=\"{login_url}\">Sign in to your Ethara employee portal</a></p>"
        "<p>Please change your password after signing in. This login is separate from your candidate portal login.</p>"
    )
    EmailService().send_email(
        # Send to the PERSONAL email — the employee can't access the new Ethara inbox yet,
        # so the login + temp password must reach an inbox they already have.
        to_email=recipient_email or login_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
    )


# Roles trusted to force a manual onboarding (e.g. a direct hire) even when the Documenso
# compliance forms aren't all signed. Mirrors the stage-override set in candidates.py.
_ONBOARDING_OVERRIDE_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR}


def _onboarding_prerequisites_met(candidate: Candidate) -> bool:
    """True only when the candidate genuinely finished onboarding: at least one statutory
    compliance form exists and every one is signed. This is the same predicate the
    candidate-side completion uses, so the legitimate flow always passes."""
    forms = candidate.compliance_forms or []
    return bool(forms) and all((f.status or "").lower() == "signed" for f in forms)


def _actor_can_force_onboarding(actor: User | None) -> bool:
    if actor is None:
        return False
    if getattr(actor, "role", None) in _ONBOARDING_OVERRIDE_ROLES:
        return True
    override_values = {str(r) for r in _ONBOARDING_OVERRIDE_ROLES}
    return any(str(r) in override_values for r in (getattr(actor, "roles", None) or []))


def _backfilled_file_name(file_url: str | None, fallback: str) -> str:
    if file_url:
        parsed = urlparse(str(file_url))
        name = Path(parsed.path or str(file_url)).name
        if name:
            return name
    return fallback


# Candidate selection-form documents are stored as "pending" (awaiting verification on the
# candidate side). Once they're backfilled onto the employee they ARE present files, so they
# should surface as "uploaded" — the same status used by the résumé backfill and by HR-side
# uploads (upload_employee_document_for_profile). Inheriting "pending" made backfilled docs
# show a misleading "Pending" badge and excluded them from the verified/uploaded completion
# count. We keep any genuine verification decision the candidate-side record already carries.
_BACKFILL_DECIDED_STATUSES = {"verified", "rejected", "needs_correction"}


def _backfilled_present_status(candidate_status: str | None) -> str:
    normalized = (candidate_status or "").strip().lower()
    return normalized if normalized in _BACKFILL_DECIDED_STATUSES else "uploaded"


def _backfill_employee_document(
    db: Session,
    *,
    profile: EmployeeProfile,
    existing_urls: set[str],
    document_type: str | None,
    file_url: str | None,
    file_name: str | None,
    file_size: int | None = None,
    mime_type: str | None = None,
    status: str | None = None,
    remarks: str | None = None,
    uploaded_by: str | None = None,
    verified_by: str | None = None,
    verified_at: datetime | None = None,
) -> EmployeeDocument | None:
    normalized_type = _normalize_employee_document_type(document_type)
    if not normalized_type or not file_url or file_url in existing_urls:
        return None

    resolved_name = file_name or _backfilled_file_name(file_url, f"{normalized_type}")
    resolved_mime = mime_type or _employee_document_mime(
        file_name=resolved_name,
        file_url=file_url,
    )
    record = EmployeeDocument(
        employee_profile_id=profile.id,
        type=normalized_type,
        file_name=resolved_name,
        file_url=file_url,
        file_size=file_size,
        mime_type=resolved_mime,
        status=status or "uploaded",
        remarks=remarks or "Backfilled from candidate onboarding records.",
        uploaded_by=uploaded_by,
        verified_by=verified_by,
        verified_at=verified_at,
    )
    db.add(record)
    existing_urls.add(file_url)

    if normalized_type == "resume" and not profile.resume_path:
        profile.resume_path = file_url
    elif normalized_type == "aadhaar" and not profile.aadhaar_path:
        profile.aadhaar_path = file_url
        profile.aadhaar_ocr_status = profile.aadhaar_ocr_status or "uploaded"
    db.add(profile)
    return record


def _candidate_matches_profile(candidate: Candidate, profile: EmployeeProfile) -> bool:
    """Guard against cross-linking one person's documents onto another's profile.
    Allow only when an identifier matches (employee code / personal / ethara email);
    block a candidate whose identifiers exist but none match the profile. A candidate
    with no identifiers at all cannot be proven a mismatch, so it is allowed (keeps
    legitimate sparse-data flows working)."""

    def _n(value: str | None) -> str:
        return (value or "").strip().lower()

    cc = normalize_employee_code(candidate.employee_code) if candidate.employee_code else None
    pc = normalize_employee_code(profile.employee_code) if profile.employee_code else None
    if cc and pc and cc == pc:
        return True
    if _n(candidate.personal_email) and _n(candidate.personal_email) == _n(profile.personal_email):
        return True
    if _n(candidate.ethara_email) and _n(candidate.ethara_email) == _n(profile.ethara_email):
        return True
    has_identifiers = bool(cc or _n(candidate.personal_email) or _n(candidate.ethara_email))
    return not has_identifiers


def backfill_candidate_documents_to_employee(
    db: Session,
    *,
    candidate: Candidate,
    profile: EmployeeProfile,
    actor: User | None = None,
) -> list[EmployeeDocument]:
    if not _candidate_matches_profile(candidate, profile):
        logger.warning(
            "Refusing document backfill: candidate %s (%s) does not match profile %s (%s)",
            candidate.id,
            candidate.employee_code,
            profile.id,
            profile.employee_code,
        )
        return []
    existing_urls = {
        file_url
        for file_url in db.scalars(
            select(EmployeeDocument.file_url).where(EmployeeDocument.employee_profile_id == profile.id)
        )
        if file_url
    }
    uploaded_by = actor.id if actor else None
    added: list[EmployeeDocument] = []

    for document in candidate.documents or []:
        added_record = _backfill_employee_document(
            db,
            profile=profile,
            existing_urls=existing_urls,
            document_type=document.type,
            file_url=document.file_url,
            file_name=document.file_name,
            file_size=document.file_size,
            mime_type=document.mime_type,
            status=_backfilled_present_status(document.status),
            uploaded_by=uploaded_by,
            verified_by=document.verified_by,
            verified_at=document.verified_at,
        )
        if added_record is not None:
            added.append(added_record)

    if candidate.resume_url:
        added_record = _backfill_employee_document(
            db,
            profile=profile,
            existing_urls=existing_urls,
            document_type="resume",
            file_url=candidate.resume_url,
            file_name=_backfilled_file_name(candidate.resume_url, "Resume"),
            status="uploaded",
            uploaded_by=uploaded_by,
        )
        if added_record is not None:
            added.append(added_record)

    contract = candidate.contract
    if contract:
        contract_status = getattr(contract.status, "value", str(contract.status or "signed"))
        signed_items = contract.signed_items or []
        if signed_items:
            # A Documenso envelope bundles several signed PDFs (Offer Letter, NDA, Employment
            # Agreement). Surface each as its own employee document instead of a single
            # merged "Signed Contract".
            for item in signed_items:
                file_url = item.get("url")
                if not file_url:
                    continue
                title = item.get("title") or "Signed document"
                file_name = title if title.lower().endswith(".pdf") else f"{title}.pdf"
                added_record = _backfill_employee_document(
                    db,
                    profile=profile,
                    existing_urls=existing_urls,
                    document_type=item.get("type") or "signed_contract",
                    file_url=file_url,
                    file_name=file_name,
                    mime_type="application/pdf",
                    status=contract_status,
                    uploaded_by=uploaded_by,
                )
                if added_record is not None:
                    added.append(added_record)
        elif contract.pdf_url:
            added_record = _backfill_employee_document(
                db,
                profile=profile,
                existing_urls=existing_urls,
                document_type="signed_contract",
                file_url=contract.pdf_url,
                file_name="Signed Contract.pdf",
                mime_type="application/pdf",
                status=contract_status,
                uploaded_by=uploaded_by,
            )
            if added_record is not None:
                added.append(added_record)

    for form in candidate.compliance_forms or []:
        if not form.pdf_url:
            continue
        form_type = _normalize_employee_document_type(form.form_type or "compliance_form")
        added_record = _backfill_employee_document(
            db,
            profile=profile,
            existing_urls=existing_urls,
            document_type=f"compliance_{form_type}",
            file_url=form.pdf_url,
            file_name=f"{form.form_title or form.form_type or 'Compliance form'}.pdf",
            mime_type="application/pdf",
            status=form.status or "signed",
            uploaded_by=uploaded_by,
            verified_at=form.verified_at or form.signed_at,
        )
        if added_record is not None:
            added.append(added_record)

    if candidate.aadhaar_extracted and not profile.aadhaar_extracted:
        profile.aadhaar_extracted = candidate.aadhaar_extracted
    if candidate.aadhaar_ocr_name and not profile.aadhaar_ocr_name:
        profile.aadhaar_ocr_name = candidate.aadhaar_ocr_name
    if candidate.aadhaar_validation_status and not profile.aadhaar_validation_status:
        profile.aadhaar_validation_status = candidate.aadhaar_validation_status
    if candidate.aadhaar_mismatch_reason and not profile.aadhaar_mismatch_reason:
        profile.aadhaar_mismatch_reason = candidate.aadhaar_mismatch_reason
    db.add(profile)
    db.flush()
    return added


def convert_candidate_to_employee(
    db: Session, *, candidate: Candidate, actor: User | None = None
) -> EmployeeProfile | None:
    """Idempotently convert a fully-onboarded candidate into an employee with a SEPARATE
    employee login (its own password). Reuses the candidate's ETH-… code as the Ethara ID
    and maps the two identities via employee_code/aadhaar/personal_email.

    Credentials are issued ONLY when the statutory compliance forms are all signed — so a
    stage jump straight to ONBOARDING_COMPLETED (e.g. by a recruiter) cannot mint an
    employee account. Admin/HR may still force a manual onboarding (logged)."""
    # The candidate's GRP employee code (allocated at contract signing) becomes the
    # employee's permanent code. Fall back to allocating one now for legacy candidates that
    # were converted before the code-on-signing flow existed.
    employee_code = candidate.employee_code or assign_candidate_employee_code(db, candidate)

    # Already converted? Match on the strongest identifiers available.
    match_conditions = [
        EmployeeProfile.employee_code == employee_code,
        EmployeeProfile.employee_code == candidate.candidate_code,
    ]
    if candidate.aadhaar_hash:
        match_conditions.append(EmployeeProfile.aadhaar_hash == candidate.aadhaar_hash)
    if candidate.personal_email:
        match_conditions.append(
            func.lower(EmployeeProfile.personal_email) == candidate.personal_email.lower()
        )
    existing = db.scalar(select(EmployeeProfile).where(or_(*match_conditions)))
    if existing is not None:
        backfill_candidate_documents_to_employee(
            db,
            candidate=candidate,
            profile=existing,
            actor=actor,
        )
        prefill_employee_selection_form_from_candidate(
            db,
            candidate=candidate,
            profile=existing,
            actor=actor,
            mark_submitted=True,
        )
        return existing

    # NC1 guard: never issue HRMS credentials unless onboarding is genuinely complete
    # (all statutory compliance forms signed). Blocks the stage-jump credential-issuance
    # bypass. Admin/HR can still force a legitimate manual onboarding.
    if not _onboarding_prerequisites_met(candidate):
        if _actor_can_force_onboarding(actor):
            logger.warning(
                "convert_candidate_to_employee: prerequisites NOT met for candidate %s, but "
                "actor %s is Admin/HR — proceeding with manual onboarding.",
                candidate.id, getattr(actor, "id", None),
            )
        else:
            logger.warning(
                "convert_candidate_to_employee: refusing to issue credentials for candidate %s "
                "— compliance forms are not all signed (actor=%s).",
                candidate.id, getattr(actor, "id", None),
            )
            return None

    # Employee login email = the candidate's ethara email (or a derived one), kept unique.
    ethara_email = candidate.ethara_email or _derive_ethara_email(candidate.full_name, candidate.personal_email)
    if db.scalar(select(User).where(func.lower(User.email) == ethara_email.lower())):
        local, _, domain = ethara_email.partition("@")
        suffix = candidate.candidate_code.rsplit("-", 1)[-1].lower()
        ethara_email = f"{local}.{suffix}@{domain or 'ethara.ai'}"

    temporary_password = _generate_candidate_temp_password()
    position_title = candidate.position.title if candidate.position else ""
    user, profile = create_employee_account(
        db,
        full_name=candidate.full_name,
        ethara_email=ethara_email,
        personal_email=candidate.personal_email,
        employee_code=employee_code,  # sequential GRP code from contract signing
        phone=candidate.phone or "",
        department="",
        designation=position_title,
        gender="",
        password=temporary_password,
        aadhaar_hash=candidate.aadhaar_hash,
        aadhaar_last4=candidate.aadhaar_last4,
        date_of_birth=candidate.date_of_birth,
        resume_path=candidate.resume_url,
    )
    user.must_change_password = True
    db.add(user)
    db.flush()
    backfilled_documents = backfill_candidate_documents_to_employee(
        db,
        candidate=candidate,
        profile=profile,
        actor=actor,
    )
    prefill_employee_selection_form_from_candidate(
        db,
        candidate=candidate,
        profile=profile,
        actor=actor,
        mark_submitted=True,
    )

    log_audit(
        db,
        entity_type="employee",
        entity_id=profile.id,
        action="candidate_converted_to_employee",
        actor=actor,
        candidate_id=candidate.id,
        user_id=user.id,
        new_value={
            "employeeProfileId": profile.id,
            "etharaId": profile.employee_code,
            "loginEmail": user.email,
            "fromCandidateId": candidate.id,
            "backfilledDocuments": [document.type for document in backfilled_documents],
        },
    )
    try:
        _send_employee_credentials_email(
            employee_name=candidate.full_name,
            login_email=ethara_email,
            temporary_password=temporary_password,
            ethara_id=employee_code,
            recipient_email=candidate.personal_email,
        )
    except Exception:
        logger.warning("Failed to send employee credentials email for candidate %s", candidate.id, exc_info=True)
    return profile


def update_employee_self_profile(
    db: Session,
    *,
    user: User,
    full_name: str,
    personal_email: str,
    employee_code: str,
    phone: str,
    department: str,
    designation: str,
    gender: str,
) -> EmployeeProfile:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")

    # NOTE on finding #69 (Low / data-integrity): employee_code, department and
    # designation are intentionally settable here because new hires fill these in
    # themselves during profile completion (onboarding) — this is a tested,
    # supported flow. Locking them broke onboarding, so it was reverted. No
    # security boundary is crossed (role/manager/status/salary are NOT settable).
    # If integrity hardening is wanted later, prefer freezing these fields only
    # AFTER HR has verified the profile, rather than blocking the initial fill.
    normalized_name = full_name.strip()
    normalized_personal_email = normalize_email_value(personal_email)
    normalized_employee_code = normalize_employee_code(employee_code)
    normalized_phone = "".join(ch for ch in phone if ch.isdigit())
    normalized_department = department.strip()
    normalized_designation = designation.strip()
    normalized_gender = gender.strip()

    if not normalized_name:
        raise ValueError("Full name is required.")
    if not normalized_personal_email or not EMPLOYEE_PERSONAL_EMAIL_PATTERN.fullmatch(normalized_personal_email):
        raise ValueError("Enter a valid personal email address.")
    if not normalized_employee_code:
        raise ValueError("Employee code is required.")
    if not EMPLOYEE_PHONE_PATTERN.fullmatch(normalized_phone):
        raise ValueError("Phone must be a valid 10-digit Indian mobile number.")
    if not normalized_department:
        raise ValueError("Department is required.")
    if not normalized_designation:
        raise ValueError("Designation is required.")
    if not normalized_gender:
        raise ValueError("Gender is required.")

    duplicate_profile = db.scalar(
        select(EmployeeProfile).where(
            EmployeeProfile.employee_code == normalized_employee_code,
            EmployeeProfile.id != profile.id,
        )
    )
    if duplicate_profile is not None:
        raise ValueError("An employee with this employee code already exists.")

    old_value = serialize_employee_profile(profile)

    profile.user_id = user.id
    profile.full_name = normalized_name
    profile.personal_email = normalized_personal_email
    profile.employee_code = normalized_employee_code
    profile.phone = normalized_phone
    profile.department = normalized_department
    profile.designation = normalized_designation
    profile.gender = normalized_gender

    user.name = normalized_name
    user.phone = normalized_phone

    db.add(user)
    db.add(profile)
    db.flush()

    log_audit(
        db,
        entity_type="employee_profile",
        entity_id=profile.id,
        action="employee_profile_updated_by_self",
        actor=user,
        user_id=user.id,
        old_value=old_value,
        new_value=serialize_employee_profile(profile),
    )

    return profile


def repair_employee_profile_from_audit(
    db: Session,
    *,
    user: User,
    audit: AuditLog,
) -> EmployeeProfile:
    payload = audit.new_value or {}
    # Never let stale registration-audit data revert a (possibly hand-corrected) employee code:
    # keep the current profile's code when a profile already exists; only fall back to the audit
    # code when the profile is being created fresh.
    existing = _profile_lookup(db, user=user, ethara_email=normalize_email_value(user.email))
    employee_code = (
        existing.employee_code
        if existing is not None and existing.employee_code
        else payload.get("employeeCode")
    )
    return ensure_employee_profile(
        db,
        user=user,
        full_name=user.name,
        ethara_email=user.email,
        personal_email=payload.get("personalEmail"),
        employee_code=employee_code,
        phone=user.phone,
        department=payload.get("department"),
        designation=payload.get("designation"),
        gender=payload.get("gender"),
        aadhaar_hash=payload.get("aadhaarHash"),
        aadhaar_last4=payload.get("aadhaarLast4"),
        date_of_birth=payload.get("dateOfBirth"),
        aadhaar_path=payload.get("aadhaarPath"),
        resume_path=payload.get("resumePath"),
        aadhaar_ocr_status=payload.get("ocrStatus"),
        aadhaar_ocr_match=payload.get("ocrAadhaarMatch"),
    )


def repair_employee_auth_record_for_login(
    db: Session,
    *,
    email: str,
) -> User | None:
    """Read-only pre-authentication lookup.

    This function runs BEFORE credentials are verified.  It must never write to
    the database — doing so would allow an unauthenticated caller to mutate
    records by supplying a known employee email.  All writes are deferred to
    post_login_sync_employee (called only after successful authentication).
    """
    normalized_email = normalize_email_value(email)
    user = db.scalar(
        select(User).where(func.lower(func.trim(User.email)) == normalized_email)
    )

    if user is None:
        profile = _profile_lookup(db, user=None, ethara_email=normalized_email)
        if profile is not None:
            logger.warning(
                "Employee profile exists without a linked user auth record for %s. "
                "Run the repair script or recreate the auth user through an admin workflow.",
                normalized_email,
            )
    return user


def post_login_sync_employee(db: Session, *, user: User) -> None:
    """Post-authentication profile sync.  Safe to write because the caller has
    already verified the user's password and confirmed the User record exists.
    """
    normalized_email = normalize_email_value(user.email)
    repaired = False

    if user.email != normalized_email:
        user.email = normalized_email
        repaired = True

    profile = _profile_lookup(db, user=user, ethara_email=normalized_email)
    audit = _employee_registration_audit(db, user.id)

    if profile is None and audit is not None:
        profile = repair_employee_profile_from_audit(db, user=user, audit=audit)
        repaired = True

    if profile is not None:
        if user.role not in {Role.EMPLOYEE, Role.EMPLOYEE_REFERRER}:
            user.role = Role.EMPLOYEE
            repaired = True
        if not user.email_verified_at:
            user.email_verified_at = datetime.now(UTC)
            repaired = True
        synced_profile = ensure_employee_profile(
            db,
            user=user,
            full_name=profile.full_name,
            ethara_email=profile.ethara_email,
            personal_email=profile.personal_email,
            employee_code=profile.employee_code,
            phone=profile.phone,
            department=profile.department,
            designation=profile.designation,
            gender=profile.gender,
            aadhaar_hash=profile.aadhaar_hash,
            aadhaar_last4=profile.aadhaar_last4,
            date_of_birth=profile.date_of_birth,
            aadhaar_path=profile.aadhaar_path,
            resume_path=profile.resume_path,
            aadhaar_ocr_status=profile.aadhaar_ocr_status,
            aadhaar_ocr_match=profile.aadhaar_ocr_match,
        )
        repaired = bool(synced_profile) or repaired

    if repaired:
        db.add(user)
        db.flush()


_EMPLOYEE_PORTAL_ROLE_VALUES = {Role.EMPLOYEE.value, Role.EMPLOYEE_REFERRER.value}
_STAFF_PORTAL_ROLE_VALUES = {
    Role.SUPER_ADMIN.value,
    Role.ADMIN.value,
    Role.LEADERSHIP.value,
    Role.HR.value,
    Role.TA.value,
    Role.IT_TEAM.value,
    Role.COMPLIANCE.value,
    Role.MANAGER.value,
    Role.OFFICE_ADMIN.value,
    Role.PL_TPM.value,
}


def pending_candidate_onboarding_for_employee_user(db: Session, *, user: User) -> Candidate | None:
    role_values = {str(user.role)} | {str(role) for role in (user.roles or [])}
    if not (role_values & _EMPLOYEE_PORTAL_ROLE_VALUES) or role_values & _STAFF_PORTAL_ROLE_VALUES:
        return None

    profile = _profile_lookup(db, user=user, ethara_email=normalize_email_value(user.email))
    if profile is None:
        return None
    candidate = _employee_lifecycle_candidate_for_profile(db, profile)
    if candidate is not None and candidate.current_stage != CandidateStage.ONBOARDING_COMPLETED:
        return candidate
    return None


def repair_employee_auth_records(db: Session) -> int:
    repaired = 0
    settings = get_settings()
    users = list(
        db.scalars(
            select(User)
            .join(AuditLog, AuditLog.user_id == User.id)
            .where(AuditLog.entity_type == EMPLOYEE_REGISTRATION_ENTITY)
        )
    )
    for user in users:
        audit = _employee_registration_audit(db, user.id)
        if audit is None:
            continue
        before = (
            user.role,
            user.is_active,
            user.email,
            bool(get_employee_profile_for_user(db, user)),
        )
        # Isolate each user in a savepoint so one un-repairable record (e.g. an employee whose
        # code now clashes with a candidate) can never 500 the entire employees list.
        sp = db.begin_nested()
        try:
            repair_employee_profile_from_audit(db, user=user, audit=audit)
            sp.commit()
        except Exception:
            sp.rollback()
            logger.warning("Skipped employee auth repair for %s", user.email, exc_info=True)
            continue
        after = (
            user.role,
            user.is_active,
            user.email,
            True,
        )
        if before != after:
            repaired += 1

    dangling_profiles = list(
        db.scalars(select(EmployeeProfile).where(EmployeeProfile.user_id.is_(None)))
    )
    for profile in dangling_profiles:
        user = db.scalar(
            select(User).where(
                func.lower(func.trim(User.email)) == normalize_email_value(profile.ethara_email)
            )
        )
        if user is not None:
            ensure_employee_profile(
                db,
                user=user,
                full_name=profile.full_name,
                ethara_email=profile.ethara_email,
                personal_email=profile.personal_email,
                employee_code=profile.employee_code,
                phone=profile.phone,
                department=profile.department,
                designation=profile.designation,
                gender=profile.gender,
                aadhaar_hash=profile.aadhaar_hash,
                aadhaar_last4=profile.aadhaar_last4,
                date_of_birth=profile.date_of_birth,
                aadhaar_path=profile.aadhaar_path,
                resume_path=profile.resume_path,
                aadhaar_ocr_status=profile.aadhaar_ocr_status,
                aadhaar_ocr_match=profile.aadhaar_ocr_match,
            )
            repaired += 1
            continue
        if settings.is_development:
            # Use a unique random password (never the shared default) and force a
            # reset on first login, so an auto-repaired account is not a known-
            # credential backdoor even if this ever runs outside local dev.
            recreated_user = User(
                email=normalize_email_value(profile.ethara_email),
                password_hash=hash_password(token_urlsafe(18)),
                name=profile.full_name,
                phone=profile.phone,
                role=Role.EMPLOYEE,
                is_active=True,
                must_change_password=True,
                email_verified_at=datetime.now(UTC),
            )
            db.add(recreated_user)
            db.flush()
            profile.user_id = recreated_user.id
            db.add(profile)
            repaired += 1
            logger.warning(
                "Created a development employee auth record for %s with a random one-time "
                "password (reset required on first login).",
                profile.ethara_email,
            )
    return repaired


def ensure_employee_selection_form(db: Session, *, profile: EmployeeProfile) -> EmployeeSelectionForm:
    record = db.scalar(
        select(EmployeeSelectionForm).where(EmployeeSelectionForm.employee_profile_id == profile.id)
    )
    if record is not None:
        return record
    record = EmployeeSelectionForm(
        employee_profile_id=profile.id,
        status="draft",
        form_data={},
    )
    db.add(record)
    db.flush()
    return record


def ensure_employee_compliance_forms(
    db: Session,
    *,
    profile: EmployeeProfile,
) -> list[EmployeeComplianceForm]:
    existing = {
        record.form_type: record
        for record in db.scalars(
            select(EmployeeComplianceForm)
            .where(EmployeeComplianceForm.employee_profile_id == profile.id)
            .order_by(EmployeeComplianceForm.created_at.asc())
        )
    }
    records: list[EmployeeComplianceForm] = []
    for form_type, form_title in EMPLOYEE_COMPLIANCE_TEMPLATES:
        record = existing.get(form_type)
        if record is None:
            record = EmployeeComplianceForm(
                employee_profile_id=profile.id,
                form_type=form_type,
                form_title=form_title,
                status="pending",
                form_data={},
            )
            db.add(record)
            db.flush()
        records.append(record)
    for record in existing.values():
        if record not in records:
            records.append(record)
    records.sort(key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC))
    return records


def ensure_default_employee_contract(
    db: Session,
    *,
    profile: EmployeeProfile,
) -> list[EmployeeContract]:
    records = list(
        db.scalars(
            select(EmployeeContract)
            .where(EmployeeContract.employee_profile_id == profile.id)
            .order_by(EmployeeContract.created_at.desc())
        )
    )
    if records:
        return records
    record = EmployeeContract(
        employee_profile_id=profile.id,
        title="Employment Agreement",
        status=ContractStatus.DRAFT,
        remarks="Awaiting HR contract assignment.",
        uploaded_by=profile.user_id,
    )
    db.add(record)
    db.flush()
    return [record]


def _employee_display_name(profile: EmployeeProfile | None, user: User | None) -> str:
    if profile and profile.full_name:
        return profile.full_name
    if user and user.name:
        return user.name
    return "Employee"


def _notify_roles(
    db: Session,
    *,
    roles: set[Role],
    title: str,
    message: str,
    type_: NotificationType = NotificationType.INFO,
) -> None:
    recipients = [
        user
        for user in db.scalars(select(User).where(User.is_active.is_(True))).all()
        if _user_has_any_role(user, roles)
    ]
    for recipient in recipients:
        db.add(
            Notification(
                user_id=recipient.id,
                title=title,
                message=message,
                type=type_,
            )
        )


def _latest_registration_audit(db: Session, *, profile: EmployeeProfile) -> AuditLog | None:
    return db.scalar(
        select(AuditLog)
        .where(
            AuditLog.entity_type == EMPLOYEE_REGISTRATION_ENTITY,
            AuditLog.entity_id == profile.id,
        )
        .order_by(AuditLog.created_at.desc())
    )


def _employee_audits(db: Session, *, profile: EmployeeProfile, user: User | None) -> list[AuditLog]:
    conditions = [
        (AuditLog.entity_type == EMPLOYEE_REGISTRATION_ENTITY) & (AuditLog.entity_id == profile.id)
    ]
    if user is not None:
        conditions.append(AuditLog.user_id == user.id)
    if profile.user_id:
        for entity_type in (
            "employee_selection_form",
            "employee_document",
            "employee_contract",
            "employee_compliance",
            "employee_referral",
        ):
            conditions.append(
                (AuditLog.entity_type == entity_type)
                & (AuditLog.entity_id.is_not(None))
                & (AuditLog.user_id == profile.user_id)
            )
    query = select(AuditLog).where(or_(*conditions)).order_by(AuditLog.created_at.desc())
    return list(db.scalars(query).unique())


def _timeline_event(
    *,
    event_id: str,
    title: str,
    occurred_at: datetime | None,
    status: str,
    description: str | None = None,
) -> dict[str, Any] | None:
    if occurred_at is None:
        return None
    return {
        "id": event_id,
        "title": title,
        "description": description,
        "status": status,
        "occurredAt": occurred_at,
    }


def _resolve_employee_file_path(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    settings = get_settings()
    raw_value = str(path_value)
    candidates: list[Path] = []
    if raw_value.startswith("/uploads/"):
        candidates.append(settings.local_storage_path / raw_value.removeprefix("/uploads/"))
    raw = Path(raw_value)
    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.extend(
            [
                Path.cwd() / raw,
                settings.local_storage_path / raw,
            ]
        )

    for candidate_path in candidates:
        try:
            resolved = candidate_path.resolve()
        except FileNotFoundError:
            continue
        if resolved.exists():
            return resolved
    return None


def _resolve_employee_file_reference(path_value: str | None) -> Path | str | None:
    path = _resolve_employee_file_path(path_value)
    if path is not None:
        return path
    if not path_value:
        return None
    return StorageService().presigned_download_url(str(path_value))


def _file_name_from_reference(path_value: str | None, reference: Path | str | None) -> str | None:
    if isinstance(reference, Path):
        return reference.name
    if path_value:
        parsed = urlparse(str(path_value))
        name = Path(parsed.path or str(path_value)).name
        if name:
            return name
    return None


def _employee_document_mime(*, file_name: str | None, file_url: str | None) -> str | None:
    inferred = mimetypes.guess_type(file_name or file_url or "")[0]
    return inferred


def _employee_document_can_preview(mime_type: str | None) -> bool:
    return bool(mime_type and (mime_type == "application/pdf" or mime_type.startswith("image/")))


_EXTRA_DOCUMENT_LABELS: dict[str, str] = {
    "signed_offer_letter": "Signed Offer Letter",
    "signed_employment_agreement": "Signed Employment Agreement",
    "signed_nda": "Signed NDA",
    "signed_contract": "Signed Contract",
}
_SIGNED_EMPLOYEE_CONTRACT_DOCUMENT_TITLES: dict[str, str] = {
    "signed_employment_agreement": "Employment Agreement",
    "signed_contract": "Employment Agreement",
    "signed_nda": "NDA",
    "signed_offer_letter": "Offer Letter",
}
_SIGNED_EMPLOYEE_CONTRACT_DOCUMENT_PRIORITY = (
    "signed_employment_agreement",
    "signed_contract",
    "signed_nda",
    "signed_offer_letter",
)
_SIGNED_EMPLOYEE_CONTRACT_DOCUMENT_STATUSES = {"signed", "verified", "uploaded"}
_EMPLOYEE_CONTRACT_PLACEHOLDER_TITLES = {
    "employment agreement",
    "employment contract",
    "signed contract",
}
_STATUTORY_DOCUMENSO_TITLE_PREFIXES = ("form 11", "form 2", "form f")
OLD_EMPLOYEE_DOCUMENSO_CONTRACT_TEMPLATE_ID = 13785
OLD_EMPLOYEE_DOCUMENSO_CONTRACT_TEMPLATE_TITLE = "NDA & Employment Contract - Ethara.pdf New"


def _employee_document_label(document_type: str) -> str:
    document_type = _normalize_employee_document_type(document_type)
    for key, label in EMPLOYEE_REQUIRED_DOCUMENTS:
        if key == document_type:
            return label
    if document_type in _EXTRA_DOCUMENT_LABELS:
        return _EXTRA_DOCUMENT_LABELS[document_type]
    return document_type.replace("_", " ").title()


def _contract_sync_setattr(record: EmployeeContract, attr: str, value: Any) -> bool:
    if getattr(record, attr) == value:
        return False
    setattr(record, attr, value)
    return True


def _documenso_signed_profile_is_old_employee_contract(profile: DocumensoSignedProfile) -> bool:
    title = (profile.template_title or "").strip().lower()
    return (
        profile.template_id == OLD_EMPLOYEE_DOCUMENSO_CONTRACT_TEMPLATE_ID
        or title == OLD_EMPLOYEE_DOCUMENSO_CONTRACT_TEMPLATE_TITLE.lower()
    )


def _employee_contract_title_from_documenso_title(title: str | None) -> str:
    raw_title = (title or "").strip()
    normalized = raw_title.lower()
    has_nda = "nda" in normalized or "non-disclosure" in normalized or "non disclosure" in normalized
    has_offer = "offer" in normalized
    has_contract = any(
        token in normalized
        for token in ("contract", "agreement", "appointment", "internship")
    )
    if has_offer and has_nda and has_contract:
        return "Offer Letter, NDA & Employment Contract"
    if has_nda and has_contract:
        return "Employment Agreement and NDA"
    if has_nda:
        return "NDA"
    if has_offer:
        return "Offer Letter"
    if has_contract:
        return "Employment Agreement"
    return raw_title or "Signed Contract"


def _employee_contract_file_name(*, title: str, file_url: str | None) -> str | None:
    if file_url:
        return _backfilled_file_name(file_url, f"{title}.pdf")
    return f"{title}.pdf"


def _select_employee_contract_for_sync(
    contracts: list[EmployeeContract],
    *,
    title: str,
    file_url: str | None,
    documenso_doc_id: int | None,
    prefer_placeholder: bool,
) -> EmployeeContract | None:
    if file_url:
        for record in contracts:
            if record.file_url == file_url:
                return record

    if documenso_doc_id is not None:
        marker = f"Documenso document {documenso_doc_id}"
        for record in contracts:
            if marker in (record.remarks or ""):
                return record

    title_key = title.strip().lower()
    for record in contracts:
        if (
            (record.title or "").strip().lower() == title_key
            and not record.file_url
            and record.status != ContractStatus.SIGNED
        ):
            return record

    if prefer_placeholder:
        for record in contracts:
            record_title = (record.title or "").strip().lower()
            if (
                record_title in _EMPLOYEE_CONTRACT_PLACEHOLDER_TITLES
                and not record.file_url
                and record.status != ContractStatus.SIGNED
            ):
                return record

    return None


def _apply_employee_contract_sync(
    db: Session,
    *,
    profile: EmployeeProfile,
    contracts: list[EmployeeContract],
    title: str,
    file_name: str | None,
    file_url: str | None,
    mime_type: str | None,
    issued_at: datetime | None,
    completed_at: datetime | None,
    remarks: str,
    uploaded_by: str | None,
    documenso_doc_id: int | None = None,
    prefer_placeholder: bool = False,
) -> bool:
    record = _select_employee_contract_for_sync(
        contracts,
        title=title,
        file_url=file_url,
        documenso_doc_id=documenso_doc_id,
        prefer_placeholder=prefer_placeholder,
    )
    if record is None:
        record = EmployeeContract(employee_profile_id=profile.id, title=title)
        contracts.append(record)

    changed = False
    changed |= _contract_sync_setattr(record, "title", title)
    changed |= _contract_sync_setattr(record, "status", ContractStatus.SIGNED)
    changed |= _contract_sync_setattr(record, "file_name", file_name)
    changed |= _contract_sync_setattr(record, "file_url", file_url)
    changed |= _contract_sync_setattr(
        record,
        "mime_type",
        mime_type or _employee_document_mime(file_name=file_name, file_url=file_url),
    )
    if issued_at and record.issued_at is None:
        changed |= _contract_sync_setattr(record, "issued_at", issued_at)
    changed |= _contract_sync_setattr(
        record,
        "completed_at",
        completed_at or record.completed_at or datetime.now(UTC),
    )
    changed |= _contract_sync_setattr(record, "remarks", remarks)
    changed |= _contract_sync_setattr(record, "uploaded_by", uploaded_by or record.uploaded_by or profile.user_id)
    if changed or record.id is None:
        db.add(record)
    return changed


def sync_employee_contracts_from_signed_documents(
    db: Session,
    *,
    profile: EmployeeProfile,
) -> bool:
    contracts = list(
        db.scalars(
            select(EmployeeContract)
            .where(EmployeeContract.employee_profile_id == profile.id)
            .order_by(EmployeeContract.created_at.asc())
        )
    )
    changed = False

    documents = list(
        db.scalars(
            select(EmployeeDocument)
            .where(
                EmployeeDocument.employee_profile_id == profile.id,
                EmployeeDocument.type.in_(set(_SIGNED_EMPLOYEE_CONTRACT_DOCUMENT_TITLES)),
            )
            .order_by(EmployeeDocument.created_at.desc(), EmployeeDocument.updated_at.desc())
        )
    )
    latest_documents: dict[str, EmployeeDocument] = {}
    for document in documents:
        document_type = _normalize_employee_document_type(document.type)
        if document_type not in _SIGNED_EMPLOYEE_CONTRACT_DOCUMENT_TITLES:
            continue
        if document_type in latest_documents:
            continue
        if not document.file_url:
            continue
        if (document.status or "").strip().lower() not in _SIGNED_EMPLOYEE_CONTRACT_DOCUMENT_STATUSES:
            continue
        latest_documents[document_type] = document

    for document_type in _SIGNED_EMPLOYEE_CONTRACT_DOCUMENT_PRIORITY:
        if document_type == "signed_contract" and "signed_employment_agreement" in latest_documents:
            continue
        document = latest_documents.get(document_type)
        if document is None:
            continue
        title = _SIGNED_EMPLOYEE_CONTRACT_DOCUMENT_TITLES[document_type]
        changed |= _apply_employee_contract_sync(
            db,
            profile=profile,
            contracts=contracts,
            title=title,
            file_name=document.file_name,
            file_url=document.file_url,
            mime_type=document.mime_type,
            issued_at=document.created_at,
            completed_at=document.verified_at or document.updated_at or document.created_at,
            remarks=f"Synced from signed employee document {document.id}.",
            uploaded_by=document.uploaded_by,
            prefer_placeholder=document_type in {"signed_employment_agreement", "signed_contract"},
        )

    employee_email = normalize_email_value(profile.ethara_email or "")
    if employee_email:
        signed_profiles = list(
            db.scalars(
                select(DocumensoSignedProfile)
                .where(
                    func.lower(DocumensoSignedProfile.recipient_email) == employee_email,
                    or_(
                        DocumensoSignedProfile.template_id == OLD_EMPLOYEE_DOCUMENSO_CONTRACT_TEMPLATE_ID,
                        func.lower(DocumensoSignedProfile.template_title)
                        == OLD_EMPLOYEE_DOCUMENSO_CONTRACT_TEMPLATE_TITLE.lower(),
                    ),
                )
                .order_by(DocumensoSignedProfile.completed_at.desc().nulls_last())
            )
        )
        for signed_profile in signed_profiles:
            if not _documenso_signed_profile_is_old_employee_contract(signed_profile):
                continue
            title = "NDA & Employment Contract"
            raw_title = (signed_profile.template_title or title).strip()
            remarks = f"Synced from signed Documenso old employee contract document {signed_profile.documenso_doc_id}"
            if raw_title:
                remarks = f"{remarks} ({raw_title})."
            else:
                remarks = f"{remarks}."
            changed |= _apply_employee_contract_sync(
                db,
                profile=profile,
                contracts=contracts,
                title=title,
                file_name=_employee_contract_file_name(title=title, file_url=signed_profile.pdf_url),
                file_url=signed_profile.pdf_url,
                mime_type="application/pdf",
                issued_at=signed_profile.created_at,
                completed_at=signed_profile.completed_at or signed_profile.synced_at,
                remarks=remarks,
                uploaded_by=profile.user_id,
                documenso_doc_id=signed_profile.documenso_doc_id,
                prefer_placeholder=title != "NDA",
            )

    if changed:
        db.flush()
    return changed


def _legacy_employee_document_payload(
    *,
    profile: EmployeeProfile,
    document_type: str,
    uploaded_at: datetime | None,
    verification_status: str,
    remarks: str | None,
    endpoint_scope: str,
) -> dict[str, Any]:
    path_value = profile.resume_path if document_type == "resume" else profile.aadhaar_path
    resolved = _resolve_employee_file_path(path_value)
    file_name = resolved.name if resolved else None
    mime_type = _employee_document_mime(file_name=file_name, file_url=path_value)
    can_preview = _employee_document_can_preview(mime_type)
    base_endpoint = (
        f"/api/v1/employees/me/documents/{document_type}"
        if endpoint_scope == "self"
        else f"/api/v1/employees/{profile.id}/documents/{document_type}"
    )
    return {
        "id": document_type,
        "type": document_type,
        "label": _employee_document_label(document_type),
        "fileName": file_name,
        "mimeType": mime_type,
        "uploadedAt": uploaded_at,
        "verificationStatus": verification_status,
        "remarks": remarks,
        "missing": resolved is None,
        "canPreview": can_preview,
        "previewEndpoint": f"{base_endpoint}/preview" if resolved and can_preview else None,
        "downloadEndpoint": f"{base_endpoint}/download" if resolved else None,
    }


def _employee_document_payload(
    *,
    profile: EmployeeProfile,
    record: EmployeeDocument,
    endpoint_scope: str,
    document_type: str | None = None,
) -> dict[str, Any]:
    resolved_document_type = document_type or _normalize_employee_document_type(record.type)
    mime_type = record.mime_type or _employee_document_mime(
        file_name=record.file_name,
        file_url=record.file_url,
    )
    can_preview = _employee_document_can_preview(mime_type)
    base_endpoint = (
        f"/api/v1/employees/me/documents/{record.id}"
        if endpoint_scope == "self"
        else f"/api/v1/employees/{profile.id}/documents/{record.id}"
    )
    return {
        "id": record.id,
        "type": resolved_document_type,
        "label": _employee_document_label(resolved_document_type),
        "fileName": record.file_name,
        "mimeType": mime_type,
        "uploadedAt": record.created_at,
        "verificationStatus": record.status,
        "remarks": record.remarks,
        "ocrStatus": record.ocr_status,
        "needsReview": record.ocr_status == "needs_review",
        "verification": record.verification_data,
        "missing": False,
        "canPreview": can_preview,
        "previewEndpoint": f"{base_endpoint}/preview" if can_preview else None,
        "downloadEndpoint": f"{base_endpoint}/download",
    }


def list_employee_documents(
    db: Session,
    *,
    profile: EmployeeProfile,
    endpoint_scope: str = "staff",
) -> list[dict[str, Any]]:
    records = list(
        db.scalars(
            select(EmployeeDocument)
            .where(EmployeeDocument.employee_profile_id == profile.id)
            .order_by(EmployeeDocument.created_at.desc(), EmployeeDocument.updated_at.desc())
        )
    )
    latest_by_type: dict[str, EmployeeDocument] = {}
    for record in records:
        normalized_type = _normalize_employee_document_type(record.type)
        if normalized_type not in latest_by_type:
            latest_by_type[normalized_type] = record

    documents: list[dict[str, Any]] = []
    seen_types: set[str] = set()
    for document_type, label in EMPLOYEE_REQUIRED_DOCUMENTS:
        record = latest_by_type.get(document_type)
        if record is not None:
            documents.append(
                _employee_document_payload(
                    profile=profile,
                    record=record,
                    endpoint_scope=endpoint_scope,
                    document_type=document_type,
                )
            )
        elif document_type == "resume":
            documents.append(
                _legacy_employee_document_payload(
                    profile=profile,
                    document_type="resume",
                    uploaded_at=profile.updated_at if profile.resume_path else None,
                    verification_status="uploaded" if profile.resume_path else "missing",
                    remarks=(
                        "Resume available for review."
                        if profile.resume_path
                        else "Resume not uploaded yet."
                    ),
                    endpoint_scope=endpoint_scope,
                )
            )
        elif document_type == "aadhaar":
            aadhaar_status = profile.aadhaar_ocr_status or (
                "uploaded" if profile.aadhaar_path else "missing"
            )
            documents.append(
                _legacy_employee_document_payload(
                    profile=profile,
                    document_type="aadhaar",
                    uploaded_at=profile.updated_at if profile.aadhaar_path else None,
                    verification_status=aadhaar_status,
                    remarks=(
                        "Aadhaar OCR matched the submitted details."
                        if profile.aadhaar_ocr_match
                        else "Aadhaar requires manual review."
                        if profile.aadhaar_path
                        else "Aadhaar document not uploaded yet."
                    ),
                    endpoint_scope=endpoint_scope,
                )
            )
        else:
            documents.append(
                {
                    "id": document_type,
                    "type": document_type,
                    "label": label,
                    "fileName": None,
                    "mimeType": None,
                    "uploadedAt": None,
                    "verificationStatus": "missing",
                    "remarks": f"{label} is still required.",
                    "missing": True,
                    "canPreview": False,
                    "previewEndpoint": None,
                    "downloadEndpoint": None,
                }
            )
        seen_types.add(document_type)

    if "resume" not in seen_types and profile.resume_path:
        documents.append(
            _legacy_employee_document_payload(
                profile=profile,
                document_type="resume",
                uploaded_at=profile.updated_at,
                verification_status="uploaded",
                remarks="Resume available for review.",
                endpoint_scope=endpoint_scope,
            )
        )
        seen_types.add("resume")

    for record in records:
        normalized_type = _normalize_employee_document_type(record.type)
        if normalized_type in seen_types:
            continue
        documents.append(
            _employee_document_payload(
                profile=profile,
                record=record,
                endpoint_scope=endpoint_scope,
                document_type=normalized_type,
            )
        )
        seen_types.add(normalized_type)

    return documents


def _send_employee_document_correction_email(
    *,
    profile: EmployeeProfile,
    document_label: str,
    remarks: str,
) -> None:
    settings = get_settings()
    portal_url = f"{settings.frontend_url.rstrip('/')}/dashboard/employee/documents"
    recipient = (profile.ethara_email or "").strip().lower()
    cc_emails = []
    personal_email = (profile.personal_email or "").strip().lower()
    if personal_email and personal_email != recipient:
        cc_emails.append(personal_email)
    if not recipient and personal_email:
        recipient = personal_email
        cc_emails = []
    if not recipient:
        raise RuntimeError("Employee email is missing.")

    safe_name = html.escape(profile.full_name or "employee")
    safe_label = html.escape(document_label)
    safe_remarks = html.escape(remarks)
    safe_url = html.escape(portal_url, quote=True)
    subject = f"Action required: {document_label} needs correction"
    body_text = (
        f"Dear {profile.full_name or 'employee'},\n\n"
        f"HR reviewed your {document_label} and marked it for correction.\n\n"
        f"Reason: {remarks}\n\n"
        f"Please upload the corrected document in Ethara HRMS: {portal_url}\n\n"
        "Regards,\nEthara HR Team"
    )
    body_html = f"""
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;color:#1f2937">
  <h2 style="margin:0 0 8px;color:#111827">Document correction required</h2>
  <p>Dear {safe_name},</p>
  <p>HR reviewed your <strong>{safe_label}</strong> and marked it for correction.</p>
  <p><strong>Reason:</strong> {safe_remarks}</p>
  <p style="margin:24px 0">
    <a href="{safe_url}" style="display:inline-block;border-radius:8px;background:#7c3aed;color:#fff;padding:10px 16px;text-decoration:none;font-weight:600">Upload corrected document</a>
  </p>
</div>
"""
    EmailService().send_email(
        to_email=recipient,
        cc_emails=cc_emails,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
    )


def _employee_document_review_payload(
    *,
    profile: EmployeeProfile,
    record: EmployeeDocument | None,
    document_type: str,
) -> dict[str, Any]:
    if record is not None:
        return _employee_document_payload(
            profile=profile,
            record=record,
            endpoint_scope="staff",
            document_type=document_type,
        )
    if document_type == "resume":
        return _legacy_employee_document_payload(
            profile=profile,
            document_type="resume",
            uploaded_at=profile.updated_at if profile.resume_path else None,
            verification_status="verified" if profile.resume_path else "missing",
            remarks="Resume manually validated." if profile.resume_path else "Resume not uploaded yet.",
            endpoint_scope="staff",
        )
    return _legacy_employee_document_payload(
        profile=profile,
        document_type="aadhaar",
        uploaded_at=profile.updated_at if profile.aadhaar_path else None,
        verification_status=profile.aadhaar_validation_status or profile.aadhaar_ocr_status or ("uploaded" if profile.aadhaar_path else "missing"),
        remarks=profile.aadhaar_mismatch_reason or ("Aadhaar manually reviewed." if profile.aadhaar_path else "Aadhaar document not uploaded yet."),
        endpoint_scope="staff",
    )


def review_employee_document(
    db: Session,
    *,
    profile: EmployeeProfile,
    actor: User,
    document_ref: str,
    status_value: str,
    remarks: str | None = None,
) -> dict[str, Any]:
    normalized_status = (status_value or "").strip().lower().replace("-", "_")
    if normalized_status in {"validated", "verified", "approved"}:
        outcome = "validated"
    elif normalized_status in {"incorrect", "rejected", "needs_correction"}:
        outcome = "incorrect"
    else:
        raise ValueError("Status must be validated or incorrect.")

    record = db.get(EmployeeDocument, document_ref)
    if record is not None and record.employee_profile_id != profile.id:
        raise ValueError("Document not found")
    document_type = (
        _normalize_employee_document_type(record.type)
        if record is not None
        else _normalize_employee_document_type(document_ref)
    )
    if record is None:
        record = _latest_employee_document_record(
            db, profile=profile, document_type=document_type
        )
    if record is None and document_type not in {"resume", "aadhaar"}:
        raise ValueError("Document not found")
    if record is None and document_type == "resume" and not profile.resume_path:
        raise ValueError("Document not found")
    if record is None and document_type == "aadhaar" and not profile.aadhaar_path:
        raise ValueError("Document not found")

    label = _employee_document_label(document_type)
    clean_remarks = (remarks or "").strip()
    now = datetime.now(UTC)
    old_value = {
        "documentType": document_type,
        "status": record.status if record else None,
        "ocrStatus": record.ocr_status if record else None,
        "aadhaarOcrStatus": profile.aadhaar_ocr_status if document_type == "aadhaar" else None,
        "aadhaarValidationStatus": profile.aadhaar_validation_status if document_type == "aadhaar" else None,
    }

    if outcome == "validated":
        review_remarks = clean_remarks or f"{label} manually validated by HR/Admin."
        if record is not None:
            record.status = "verified"
            record.ocr_status = "extracted"
            record.remarks = review_remarks
            record.verified_by = actor.id
            record.verified_at = now
            db.add(record)
        if document_type == "aadhaar":
            profile.aadhaar_ocr_status = "extracted"
            profile.aadhaar_validation_status = "passed"
            profile.aadhaar_mismatch_reason = None
            profile.aadhaar_ocr_match = True
            db.add(profile)
        action = f"employee_document_validated:{document_type}"
    else:
        review_remarks = clean_remarks or f"{label} was marked incorrect by HR/Admin. Please upload a corrected document."
        if record is not None:
            record.status = "needs_correction"
            record.ocr_status = "needs_review"
            record.remarks = review_remarks
            db.add(record)
        if document_type == "aadhaar":
            profile.aadhaar_ocr_status = "needs_review"
            profile.aadhaar_validation_status = "failed"
            profile.aadhaar_mismatch_reason = review_remarks
            profile.aadhaar_ocr_match = False
            db.add(profile)
        if profile.user_id:
            db.add(
                Notification(
                    user_id=profile.user_id,
                    title=f"{label} correction required",
                    message=(
                        f"HR reviewed your {label} and marked it for correction. "
                        f"Reason: {review_remarks}"
                    ),
                    type=NotificationType.WARNING,
                    entity_type="employee_document",
                    entity_id=record.id if record is not None else profile.id,
                    payload={
                        "documentType": document_type,
                        "employeeId": profile.id,
                        "status": "needs_correction",
                    },
                )
            )
        _send_employee_document_correction_email(
            profile=profile,
            document_label=label,
            remarks=review_remarks,
        )
        action = f"employee_document_marked_incorrect:{document_type}"

    log_audit(
        db,
        entity_type="employee_document",
        entity_id=record.id if record is not None else f"{profile.id}:{document_type}",
        action=action,
        actor=actor,
        user_id=profile.user_id,
        old_value=old_value,
        new_value={
            "documentType": document_type,
            "outcome": outcome,
            "remarks": review_remarks,
            "emailSent": outcome == "incorrect",
        },
    )
    db.flush()
    return _employee_document_review_payload(
        profile=profile,
        record=record,
        document_type=document_type,
    )


def _document_completion_status(documents: list[dict[str, Any]]) -> dict[str, Any]:
    completed = len([document for document in documents if not document["missing"]])
    ready = len(
        [
            document
            for document in documents
            if not document["missing"]
            and document["verificationStatus"]
            in {"uploaded", "verified", "submitted", "extracted", "signed"}
        ]
    )
    missing = [document["label"] for document in documents if document["missing"]]
    total = len(documents)
    return {
        "completed": completed,
        "total": total,
        "verifiedOrUploaded": ready,
        "missing": missing,
        "percentage": int((completed / total) * 100) if total else 0,
    }


def _selection_form_uploaded_documents(selection_form: EmployeeSelectionForm | None) -> dict[str, str]:
    if selection_form is None or not isinstance(selection_form.form_data, dict):
        return {}
    uploads: dict[str, str] = {}
    for key in ("documentsUploaded", "uploadedDocuments"):
        raw_uploads = selection_form.form_data.get(key)
        if not isinstance(raw_uploads, dict):
            continue
        for raw_type, raw_file_name in raw_uploads.items():
            document_type = _normalize_employee_document_type(str(raw_type))
            file_name = _selection_upload_file_name(raw_file_name)
            if document_type and file_name:
                uploads[document_type] = file_name
    return uploads


def _apply_selection_form_document_fallbacks(
    documents: list[dict[str, Any]],
    selection_form: EmployeeSelectionForm | None,
) -> list[dict[str, Any]]:
    uploads = _selection_form_uploaded_documents(selection_form)
    if not uploads:
        return documents
    for document in documents:
        if not document.get("missing"):
            continue
        file_name = uploads.get(_normalize_employee_document_type(str(document.get("type") or "")))
        if not file_name:
            continue
        document.update(
            {
                "fileName": file_name,
                "verificationStatus": "uploaded",
                "remarks": "Uploaded with the employee detail form.",
                "missing": False,
                "canPreview": False,
                "previewEndpoint": None,
                "downloadEndpoint": None,
            }
        )
    return documents


def _employee_selection_form_defaults(profile: EmployeeProfile | None) -> dict[str, Any]:
    emergency_contact_phone = ""
    if profile and profile.emergency_contact_phone:
        emergency_contact_phone = "".join(ch for ch in profile.emergency_contact_phone if ch.isdigit())[:10]

    return {
        "employeeCode": profile.employee_code if profile and profile.employee_code else "",
        "employeeName": profile.full_name if profile and profile.full_name else "",
        "department": profile.department if profile and profile.department else "",
        "designation": profile.designation if profile and profile.designation else "",
        "dateOfBirth": profile.date_of_birth.date().isoformat() if profile and profile.date_of_birth else "",
        "gender": profile.gender if profile and profile.gender else "",
        "contactNumber": profile.phone if profile and profile.phone else "",
        "personalEmail": profile.personal_email if profile and profile.personal_email else "",
        "officialEmail": profile.ethara_email if profile and profile.ethara_email else "",
        "aadhaarNumber": f"**** **** {profile.aadhaar_last4}" if profile and profile.aadhaar_last4 else "",
        "maritalStatus": "",
        "marriageDate": "",
        "spouseName": "",
        "spouseDateOfBirth": "",
        "spouseGender": "",
        "hasKids": "no",
        "child1Name": "",
        "child1DateOfBirth": "",
        "child1Gender": "",
        "child2Name": "",
        "child2DateOfBirth": "",
        "child2Gender": "",
        "bloodGroup": profile.blood_group if profile and profile.blood_group else "",
        "class10ScoreType": "percentage",
        "class10Score": "",
        "class12ScoreType": "percentage",
        "class12Score": "",
        "highestQualification": "",
        "highestQualificationScoreType": "percentage",
        "highestQualificationScore": "",
        "fatherName": "",
        "fatherDateOfBirth": "",
        "motherName": "",
        "motherDateOfBirth": "",
        "currentAddress": "",
        "permanentAddress": "",
        "emergencyContactName": profile.emergency_contact_name if profile and profile.emergency_contact_name else "",
        "emergencyContactPhone": emergency_contact_phone,
        "emergencyContactRelation": profile.emergency_contact_relation if profile and profile.emergency_contact_relation else "",
        "panNumber": "",
        "hasUanNumber": "",
        "uanNumber": "",
        "hasSavingsAccount": "",
        "hasSalaryAccount": "",
        "bankName": "",
        "bankAccount": "",
        "ifscCode": "",
        "salaryAccountInstruction": "",
    }


def _merge_prefilled_form_data(*, defaults: dict[str, Any], form_data: Any) -> dict[str, Any]:
    merged = dict(defaults)
    if not isinstance(form_data, dict):
        return merged

    for key, value in form_data.items():
        if key in defaults and value is None:
            continue
        if key in defaults and isinstance(value, str) and not value.strip():
            continue
        merged[key] = value
    return merged


def _serialize_selection_form(
    record: EmployeeSelectionForm | None,
    *,
    profile: EmployeeProfile | None = None,
    edit_access_enabled: bool = True,
) -> dict[str, Any]:
    defaults = _employee_selection_form_defaults(profile)
    if record is None:
        return {
            "id": None,
            "status": "draft",
            "formData": defaults,
            "editAccessEnabled": edit_access_enabled,
            "submittedAt": None,
            "reviewedAt": None,
            "reviewedBy": None,
            "remarks": None,
            "createdAt": None,
            "updatedAt": None,
        }
    return {
        "id": record.id,
        "status": record.status,
        "formData": _merge_prefilled_form_data(defaults=defaults, form_data=record.form_data),
        "editAccessEnabled": edit_access_enabled,
        "submittedAt": record.submitted_at,
        "reviewedAt": record.reviewed_at,
        "reviewedBy": record.reviewed_by,
        "remarks": record.remarks,
        "createdAt": record.created_at,
        "updatedAt": record.updated_at,
    }


def _serialize_contract(profile: EmployeeProfile, record: EmployeeContract) -> dict[str, Any]:
    mime_type = record.mime_type or _employee_document_mime(
        file_name=record.file_name,
        file_url=record.file_url,
    )
    can_preview = _employee_document_can_preview(mime_type)
    return {
        "id": record.id,
        "title": record.title,
        "status": record.status.value if isinstance(record.status, ContractStatus) else str(record.status),
        "fileName": record.file_name,
        "fileUrl": None,
        "mimeType": mime_type,
        "issuedAt": record.issued_at,
        "completedAt": record.completed_at,
        "remarks": record.remarks,
        "createdAt": record.created_at,
        "updatedAt": record.updated_at,
        "canPreview": bool(record.file_url and can_preview),
        "previewEndpoint": (
            f"/api/v1/employees/me/contracts/{record.id}/preview"
            if record.file_url and can_preview
            else None
        ),
        "downloadEndpoint": (
            f"/api/v1/employees/me/contracts/{record.id}/download" if record.file_url else None
        ),
    }


def _serialize_compliance_form(record: EmployeeComplianceForm) -> dict[str, Any]:
    form_data = record.form_data or {}
    if record.form_type == "epf" and isinstance(form_data, dict):
        form_data = _normalize_employee_epf_form_data(form_data)
    return {
        "id": record.id,
        "formType": record.form_type,
        "formTitle": record.form_title,
        "status": record.status,
        "formData": form_data,
        "submittedAt": record.submitted_at,
        "verifiedAt": record.verified_at,
        "reviewedBy": record.reviewed_by,
        "remarks": record.remarks,
        # Documenso e-sign compliance forms (Form 11 / Form 2 / Form F)
        "documensoId": record.documenso_id,
        "signedUrl": record.signed_url,
        "pdfUrl": make_signed_upload_url(record.pdf_url, absolute=False)
        if record.pdf_url and record.pdf_url.startswith("/uploads/")
        else record.pdf_url,
        "sentAt": record.sent_at,
        "signedAt": record.signed_at,
        "createdAt": record.created_at,
        "updatedAt": record.updated_at,
    }


def _candidate_referral_matches(profile: EmployeeProfile, user: User | None) -> Iterable[str]:
    values = {profile.id, profile.ethara_email}
    if profile.personal_email:
        values.add(profile.personal_email)
    if profile.user_id:
        values.add(profile.user_id)
    if user is not None:
        values.add(user.id)
        values.add(user.email)
    return values


def _list_referral_candidates(
    db: Session,
    *,
    profile: EmployeeProfile,
    user: User | None,
) -> list[Candidate]:
    return list(
        db.scalars(
            select(Candidate)
            .where(
                Candidate.source_type == SourceType.EMPLOYEE_REFERRAL,
                Candidate.source_id.in_(list(_candidate_referral_matches(profile, user))),
            )
            .order_by(Candidate.created_at.desc())
        )
    )


def _serialize_referral_activity(candidate: Candidate) -> dict[str, Any]:
    return {
        "candidateId": candidate.id,
        "candidateName": candidate.full_name,
        "positionTitle": candidate.position.title if candidate.position else None,
        "currentStage": candidate.current_stage.value,
        "currentStatus": candidate.current_status,
        "createdAt": candidate.created_at,
    }


def _journey_stage(
    *,
    key: str,
    title: str,
    status: str,
    description: str,
) -> dict[str, Any]:
    return {
        "key": key,
        "title": title,
        "status": status,
        "description": description,
    }


def _build_profile_journey(
    *,
    profile: EmployeeProfile | None,
    selection_form: EmployeeSelectionForm | None,
    documents: list[dict[str, Any]],
    contracts: list[EmployeeContract],
    compliance_forms: list[EmployeeComplianceForm],
) -> tuple[list[dict[str, Any]], int, str | None]:
    basic_complete = bool(
        profile
        and profile.full_name
        and profile.ethara_email
        and profile.employee_code
    )

    selection_status = "completed" if selection_form and selection_form.status == "submitted" else "pending"

    required_documents = [
        document for document in documents if any(document["type"] == key for key, _ in EMPLOYEE_REQUIRED_DOCUMENTS)
    ]
    missing_documents = [document for document in required_documents if document["missing"]]
    rejected_documents = [
        document
        for document in required_documents
        if document["verificationStatus"] in {"rejected", "needs_correction"}
    ]
    if rejected_documents:
        document_status = "warning"
    elif missing_documents:
        document_status = "pending"
    else:
        document_status = "completed"

    if any(record.status == ContractStatus.SIGNED for record in contracts):
        contract_status = "completed"
    elif any(record.status == ContractStatus.EXPIRED for record in contracts):
        contract_status = "warning"
    else:
        contract_status = "pending"

    rejected_compliance = [
        record for record in compliance_forms if record.status in {"rejected", "needs_correction"}
    ]
    pending_compliance = [
        record for record in compliance_forms if record.status not in {"submitted", "verified", "signed"}
    ]
    if rejected_compliance:
        compliance_status = "warning"
    elif pending_compliance:
        compliance_status = "pending"
    else:
        compliance_status = "completed"

    stages = [
        _journey_stage(
            key="basic_profile",
            title="Basic profile completed",
            status="completed" if basic_complete else "pending",
            description="Your company profile and contact details are available.",
        ),
        _journey_stage(
            key="selection_form",
            title="Employee detail form submitted",
            status=selection_status,
            description="Complete the employee detail form so Admin and HR can review it.",
        ),
        _journey_stage(
            key="documents",
            title="Documents uploaded",
            status=document_status,
            description="Upload the required onboarding documents.",
        ),
        _journey_stage(
            key="contract",
            title="Contract completed",
            status=contract_status,
            description="Review and complete your assigned employment contract.",
        ),
        _journey_stage(
            key="compliance",
            title="Compliance submitted",
            status=compliance_status,
            description="Submit all compliance forms for review.",
        ),
        _journey_stage(
            key="referral",
            title="Referral module available",
            status="completed",
            description="You can refer candidates directly from this dashboard.",
        ),
    ]

    completed_required = len(
        [
            stage
            for stage in stages
            if stage["key"] in EMPLOYEE_COMPLETION_STAGES and stage["status"] == "completed"
        ]
    )
    percentage = int((completed_required / len(EMPLOYEE_COMPLETION_STAGES)) * 100)
    all_required_completed = completed_required == len(EMPLOYEE_COMPLETION_STAGES)
    stages.append(
        _journey_stage(
            key="profile_completed",
            title="Profile completed",
            status="completed" if all_required_completed else "pending",
            description=(
                "All required employee onboarding modules are complete."
                if all_required_completed
                else "Complete the remaining employee onboarding modules to finish your profile."
            ),
        )
    )

    next_action = next(
        (
            stage["title"]
            for stage in stages
            if stage["key"] in EMPLOYEE_COMPLETION_STAGES and stage["status"] != "completed"
        ),
        None,
    )
    return stages, percentage, next_action


def _workspace_context(
    db: Session,
    *,
    profile: EmployeeProfile,
    user: User | None,
    endpoint_scope: str,
) -> dict[str, Any]:
    repair_completed_candidate_employee_onboarding(db, profile=profile, actor=user)
    selection_form = ensure_employee_selection_form(db, profile=profile)
    backfill_employee_aadhaar_from_uploaded_document(
        db,
        profile=profile,
        selection_form=selection_form,
    )
    sync_employee_contracts_from_signed_documents(db, profile=profile)
    contracts = ensure_default_employee_contract(db, profile=profile)
    compliance_forms = ensure_employee_compliance_forms(db, profile=profile)
    documents = list_employee_documents(db, profile=profile, endpoint_scope=endpoint_scope)
    documents = _apply_selection_form_document_fallbacks(documents, selection_form)
    career_referral_activity = list_employee_referrals_for_user(db, user=user) if user is not None else []
    referral_candidates = _list_referral_candidates(db, profile=profile, user=user)
    referral_activity = [
        *career_referral_activity,
        *[_serialize_referral_activity(candidate) for candidate in referral_candidates],
    ]
    document_completion = _document_completion_status(documents)
    journey, completion_percentage, next_action = _build_profile_journey(
        profile=profile,
        selection_form=selection_form,
        documents=documents,
        contracts=contracts,
        compliance_forms=compliance_forms,
    )

    return {
        "selectionForm": _serialize_selection_form(
            selection_form,
            profile=profile,
            edit_access_enabled=employee_edit_access_enabled(db, profile),
        ),
        "documents": documents,
        "documentCompletionStatus": document_completion,
        "missingDocuments": document_completion["missing"],
        "contracts": [_serialize_contract(profile, contract) for contract in contracts],
        "complianceForms": [_serialize_compliance_form(record) for record in compliance_forms],
        "referralActivity": referral_activity,
        "profileJourney": journey,
        "profileCompletionPercentage": completion_percentage,
        "nextRequiredAction": next_action,
    }


def get_employee_dashboard(db: Session, *, user: User) -> dict[str, Any]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        return {
            "employee": {
                "id": None,
                "fullName": user.name,
                "etharaEmail": normalize_email_value(user.email),
                "personalEmail": None,
                "employeeCode": None,
                "phone": user.phone,
                "department": None,
                "designation": None,
                "managerId": None,
                "managerName": None,
                "managerEmail": None,
                "aadhaarOcrStatus": None,
            },
            "selectionForm": _serialize_selection_form(None),
            "documents": [
                {
                    "id": document_type,
                    "type": document_type,
                    "label": label,
                    "fileName": None,
                    "mimeType": None,
                    "uploadedAt": None,
                    "verificationStatus": "missing",
                    "remarks": f"{label} will appear once your employee profile is provisioned.",
                    "missing": True,
                    "canPreview": False,
                    "previewEndpoint": None,
                    "downloadEndpoint": None,
                }
                for document_type, label in EMPLOYEE_REQUIRED_DOCUMENTS
            ],
            "documentCompletionStatus": {
                "completed": 0,
                "total": len(EMPLOYEE_REQUIRED_DOCUMENTS),
                "verifiedOrUploaded": 0,
                "missing": [label for _, label in EMPLOYEE_REQUIRED_DOCUMENTS],
                "percentage": 0,
            },
            "missingDocuments": [label for _, label in EMPLOYEE_REQUIRED_DOCUMENTS],
            "contracts": [],
            "complianceForms": [],
            "referralActivity": [],
            "profileJourney": [
                _journey_stage(
                    key="basic_profile",
                    title="Basic profile completed",
                    status="pending",
                    description="Your employee profile is still being provisioned.",
                ),
                _journey_stage(
                    key="selection_form",
                    title="Employee detail form submitted",
                    status="pending",
                    description="Employee detail form becomes available after profile provisioning.",
                ),
                _journey_stage(
                    key="documents",
                    title="Documents uploaded",
                    status="pending",
                    description="Document upload becomes available after profile provisioning.",
                ),
                _journey_stage(
                    key="contract",
                    title="Contract completed",
                    status="pending",
                    description="Contracts will appear after HR assigns them.",
                ),
                _journey_stage(
                    key="compliance",
                    title="Compliance submitted",
                    status="pending",
                    description="Compliance forms will appear after profile provisioning.",
                ),
                _journey_stage(
                    key="referral",
                    title="Referral module available",
                    status="completed",
                    description="You can already start referring candidates.",
                ),
                _journey_stage(
                    key="profile_completed",
                    title="Profile completed",
                    status="pending",
                    description="Complete the employee provisioning steps first.",
                ),
            ],
            "profileCompletionPercentage": 0,
            "nextRequiredAction": "Basic profile completed",
        }

    workspace = _workspace_context(db, profile=profile, user=user, endpoint_scope="self")
    manager = db.get(User, profile.manager_id) if profile.manager_id else None

    # Expose the profile photo preview endpoint so the dashboard can display it.
    photo_doc = _latest_employee_document_record(db, profile=profile, document_type="photo")
    profile_photo_endpoint: str | None = None
    if photo_doc and photo_doc.file_url:
        profile_photo_endpoint = f"/api/v1/employees/me/documents/{photo_doc.id}/preview"

    return {
        "employee": {
            "id": profile.id,
            "userId": profile.user_id,
            "fullName": profile.full_name,
            "etharaEmail": profile.ethara_email,
            "personalEmail": profile.personal_email,
            "employeeCode": profile.employee_code,
            "phone": profile.phone,
            "department": profile.department,
            "designation": profile.designation,
            "gender": profile.gender,
            # Date of Joining — HR-set, shown read-only to the employee.
            "dateOfJoining": profile.date_of_joining,
            "bloodGroup": profile.blood_group,
            "emergencyContactName": profile.emergency_contact_name,
            "emergencyContactPhone": profile.emergency_contact_phone,
            "emergencyContactRelation": profile.emergency_contact_relation,
            "managerId": profile.manager_id,
            "managerName": manager.name if manager else None,
            "managerEmail": manager.email if manager else None,
            "aadhaarLast4": profile.aadhaar_last4,
            "aadhaarOcrStatus": profile.aadhaar_ocr_status,
            "aadhaarOcrMatch": profile.aadhaar_ocr_match,
            "dateOfBirth": profile.date_of_birth,
            "isActive": user.is_active,
            "profilePhotoEndpoint": profile_photo_endpoint,
            "createdAt": profile.created_at,
            "updatedAt": profile.updated_at,
        },
        # ID Card Details module only applies to employees onboarded via HRMS.
        "idCardApplicable": employee_id_card_applicable(profile),
        "idCardIncomplete": employee_id_card_incomplete(profile),
        **workspace,
    }


def get_employee_selection_form_for_user(db: Session, *, user: User) -> dict[str, Any]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")
    repair_completed_candidate_employee_onboarding(db, profile=profile, actor=user)
    record = ensure_employee_selection_form(db, profile=profile)
    backfill_employee_aadhaar_from_uploaded_document(
        db,
        profile=profile,
        selection_form=record,
    )
    return _serialize_selection_form(
        record,
        profile=profile,
        edit_access_enabled=employee_edit_access_enabled(db, profile),
    )


_SELECTION_FORM_MANDATORY = [
    "employeeCode",
    "employeeName",
    "department",
    "designation",
    "dateOfBirth",
    "gender",
    "contactNumber",
    "maritalStatus",
    "bloodGroup",
    "class10ScoreType",
    "class10Score",
    "class12ScoreType",
    "class12Score",
    "highestQualification",
    "highestQualificationScoreType",
    "highestQualificationScore",
    "personalEmail",
    "officialEmail",
    "fatherName",
    "fatherDateOfBirth",
    "motherName",
    "motherDateOfBirth",
    "currentAddress",
    "permanentAddress",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
    "aadhaarNumber",
    "panNumber",
    "hasUanNumber",
    "hasSavingsAccount",
]

_MARITAL_STATUS_OPTIONS = {"single", "unmarried", "married", "divorced", "widowed", "separated"}
_GENDER_OPTIONS = {"male", "female", "non_binary", "prefer_not_to_say"}
_EDUCATION_SCORE_TYPES = {"cgpa", "percentage"}


def _normalize_short_decimal(value: Any) -> str:
    return re.sub(r"[^0-9.]", "", str(value or "")).strip()[:5]


def _validate_education_score(*, label: str, score_type: str, score_value: str) -> None:
    from fastapi import HTTPException as _HTTPException

    if score_type not in _EDUCATION_SCORE_TYPES:
        raise _HTTPException(status_code=422, detail=f"{label} must specify CGPA or Percentage.")
    if len(score_value) > 5 or not re.fullmatch(r"\d{1,3}(?:\.\d{1,2})?", score_value):
        raise _HTTPException(
            status_code=422,
            detail=f"{label} must be a number up to 5 characters (e.g. 10.12).",
        )
    numeric_value = float(score_value)
    if numeric_value <= 0:
        raise _HTTPException(status_code=422, detail=f"{label} must be greater than 0.")
    if score_type == "percentage" and numeric_value > 100:
        raise _HTTPException(status_code=422, detail=f"{label} percentage cannot exceed 100.")
    if score_type == "cgpa" and numeric_value > 10.12:
        raise _HTTPException(status_code=422, detail=f"{label} CGPA cannot exceed 10.12.")


def submit_employee_selection_form(
    db: Session,
    *,
    user: User,
    form_data: dict[str, Any],
) -> dict[str, Any]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")
    if not employee_edit_access_enabled(db, profile):
        from fastapi import HTTPException as _HTTPException

        raise _HTTPException(
            status_code=403,
            detail="Employee edit access is disabled after HR/Admin verification.",
        )

    normalized_form_data = dict(form_data)
    normalized_form_data["employeeCode"] = str(
        normalized_form_data.get("employeeCode", "") or profile.employee_code or ""
    ).strip().upper()
    normalized_form_data["employeeName"] = str(
        normalized_form_data.get("employeeName", "") or profile.full_name or ""
    ).strip()
    normalized_form_data["department"] = str(normalized_form_data.get("department", "") or "").strip()
    normalized_form_data["designation"] = str(normalized_form_data.get("designation", "") or "").strip()
    normalized_form_data["dateOfBirth"] = str(normalized_form_data.get("dateOfBirth", "") or "").strip()
    normalized_form_data["gender"] = str(normalized_form_data.get("gender", "") or "").strip()
    normalized_form_data["contactNumber"] = "".join(
        ch for ch in str(normalized_form_data.get("contactNumber", "") or "") if ch.isdigit()
    )
    normalized_form_data["personalEmail"] = normalize_email_value(
        str(normalized_form_data.get("personalEmail", "") or "")
    )
    normalized_form_data["officialEmail"] = normalize_email_value(
        str(normalized_form_data.get("officialEmail", "") or profile.ethara_email or "")
    )
    normalized_form_data["currentAddress"] = str(
        normalized_form_data.get("currentAddress", "") or ""
    ).strip()
    normalized_form_data["permanentAddress"] = str(
        normalized_form_data.get("permanentAddress", "") or ""
    ).strip()
    normalized_form_data["maritalStatus"] = str(normalized_form_data.get("maritalStatus", "") or "").strip().lower()
    normalized_form_data["hasKids"] = str(normalized_form_data.get("hasKids", "no") or "no").strip().lower()
    for key in (
        "marriageDate",
        "spouseName",
        "spouseDateOfBirth",
        "spouseGender",
        "child1Name",
        "child1DateOfBirth",
        "child1Gender",
        "child2Name",
        "child2DateOfBirth",
        "child2Gender",
        "fatherName",
        "fatherDateOfBirth",
        "motherName",
        "motherDateOfBirth",
        "bloodGroup",
        "highestQualification",
        "emergencyContactName",
        "emergencyContactRelation",
    ):
        normalized_form_data[key] = str(normalized_form_data.get(key, "") or "").strip()
    for type_key, score_key in (
        ("class10ScoreType", "class10Score"),
        ("class12ScoreType", "class12Score"),
        ("highestQualificationScoreType", "highestQualificationScore"),
    ):
        normalized_form_data[type_key] = str(
            normalized_form_data.get(type_key, "percentage") or "percentage"
        ).strip().lower()
        normalized_form_data[score_key] = _normalize_short_decimal(normalized_form_data.get(score_key))
    normalized_form_data["panNumber"] = "".join(
        ch for ch in str(normalized_form_data.get("panNumber", "") or "").upper() if not ch.isspace()
    )
    normalized_form_data["aadhaarNumber"] = _normalize_aadhaar_number(
        normalized_form_data.get("aadhaarNumber", "")
    )
    if not _valid_aadhaar_number(normalized_form_data["aadhaarNumber"]):
        record_for_backfill = ensure_employee_selection_form(db, profile=profile)
        if backfill_employee_aadhaar_from_uploaded_document(
            db,
            profile=profile,
            selection_form=record_for_backfill,
        ):
            backfilled_data = record_for_backfill.form_data if isinstance(record_for_backfill.form_data, dict) else {}
            backfilled_aadhaar = _valid_aadhaar_number(backfilled_data.get("aadhaarNumber"))
            if backfilled_aadhaar:
                normalized_form_data["aadhaarNumber"] = backfilled_aadhaar
    normalized_form_data["uanNumber"] = "".join(
        ch for ch in str(normalized_form_data.get("uanNumber", "") or "") if ch.isdigit()
    )
    normalized_form_data["hasUanNumber"] = str(
        normalized_form_data.get("hasUanNumber", "") or ""
    ).strip().lower()
    if not normalized_form_data["hasUanNumber"] and normalized_form_data["uanNumber"]:
        normalized_form_data["hasUanNumber"] = "yes"
    normalized_form_data["hasSavingsAccount"] = str(
        normalized_form_data.get("hasSavingsAccount", "") or ""
    ).strip().lower()
    normalized_form_data["hasSalaryAccount"] = str(
        normalized_form_data.get("hasSalaryAccount", "") or ""
    ).strip().lower()
    normalized_form_data["bankName"] = str(normalized_form_data.get("bankName", "") or "").strip()
    normalized_form_data["bankAccount"] = "".join(
        ch
        for ch in str(
            normalized_form_data.get("bankAccount", "")
            or normalized_form_data.get("accountNumber", "")
            or ""
        )
        if ch.isdigit()
    )
    normalized_form_data["ifscCode"] = "".join(
        ch for ch in str(normalized_form_data.get("ifscCode", "") or "").upper() if not ch.isspace()
    )
    has_bank_details = bool(
        normalized_form_data["bankName"]
        or normalized_form_data["bankAccount"]
        or normalized_form_data["ifscCode"]
    )
    if not normalized_form_data["hasSavingsAccount"] and has_bank_details:
        normalized_form_data["hasSavingsAccount"] = "yes"
    if not normalized_form_data["hasSalaryAccount"] and has_bank_details:
        normalized_form_data["hasSalaryAccount"] = "yes"

    # Backend guard: reject incomplete submissions so the DB never stores partial forms.
    missing = [
        f for f in _SELECTION_FORM_MANDATORY
        if not str(normalized_form_data.get(f, "") or "").strip()
    ]
    if normalized_form_data["hasUanNumber"] == "yes" and not normalized_form_data["uanNumber"]:
        missing.append("uanNumber")
    if normalized_form_data["hasSavingsAccount"] == "yes":
        if not normalized_form_data["hasSalaryAccount"]:
            missing.append("hasSalaryAccount")
        elif normalized_form_data["hasSalaryAccount"] == "yes":
            for bank_key in ("bankName", "bankAccount", "ifscCode"):
                if not str(normalized_form_data.get(bank_key, "") or "").strip():
                    missing.append(bank_key)
    if missing:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(
            status_code=422,
            detail=f"Mandatory fields are missing or empty: {', '.join(missing)}",
        )

    if normalized_form_data["maritalStatus"] not in _MARITAL_STATUS_OPTIONS:
        from fastapi import HTTPException as _HTTPException

        raise _HTTPException(status_code=422, detail="Select a valid marital status.")

    if normalized_form_data["maritalStatus"] == "married":
        for conditional_key in ("marriageDate", "spouseName", "spouseDateOfBirth", "spouseGender"):
            if not str(normalized_form_data.get(conditional_key, "") or "").strip():
                from fastapi import HTTPException as _HTTPException
                raise _HTTPException(
                    status_code=422,
                    detail="Marriage Date, Spouse Name, Spouse DOB, and Spouse Gender are required when Marital Status is Married.",
                )
        if normalized_form_data["spouseGender"] not in _GENDER_OPTIONS:
            from fastapi import HTTPException as _HTTPException

            raise _HTTPException(status_code=422, detail="Select a valid spouse gender.")

    if normalized_form_data["hasKids"] == "yes":
        child_1_complete = all(
            str(normalized_form_data.get(key, "") or "").strip()
            for key in ("child1Name", "child1DateOfBirth", "child1Gender")
        )
        child_2_values = [
            str(normalized_form_data.get(key, "") or "").strip()
            for key in ("child2Name", "child2DateOfBirth", "child2Gender")
        ]
        child_2_has_any = any(child_2_values)
        child_2_complete = all(child_2_values)
        if not child_1_complete:
            from fastapi import HTTPException as _HTTPException
            raise _HTTPException(
                status_code=422,
                detail="At least one child entry with Name, DOB, and Gender is required when Kids is Yes.",
            )
        if child_2_has_any and not child_2_complete:
            from fastapi import HTTPException as _HTTPException

            raise _HTTPException(
                status_code=422,
                detail="Complete Child 2 Name, DOB, and Gender, or leave Child 2 blank.",
            )
        for gender_key in ("child1Gender", "child2Gender"):
            gender_value = str(normalized_form_data.get(gender_key, "") or "").strip()
            if gender_value and gender_value not in _GENDER_OPTIONS:
                from fastapi import HTTPException as _HTTPException

                raise _HTTPException(status_code=422, detail="Select a valid child gender.")
    elif normalized_form_data["hasKids"] not in {"no", "yes"}:
        from fastapi import HTTPException as _HTTPException

        raise _HTTPException(status_code=422, detail="Kids must be Yes or No.")

    for label, type_key, score_key in (
        ("10th score", "class10ScoreType", "class10Score"),
        ("12th / Diploma score", "class12ScoreType", "class12Score"),
        ("Highest qualification score", "highestQualificationScoreType", "highestQualificationScore"),
    ):
        _validate_education_score(
            label=label,
            score_type=str(normalized_form_data[type_key]),
            score_value=str(normalized_form_data[score_key]),
        )

    if not EMPLOYEE_PERSONAL_EMAIL_PATTERN.fullmatch(normalized_form_data["personalEmail"]):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Enter a valid personal email address.")

    if not re.fullmatch(r"^[^\s@]+@ethara\.ai$", normalized_form_data["officialEmail"]):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Official email must be an @ethara.ai address.")

    if normalized_form_data["officialEmail"] != normalize_email_value(profile.ethara_email):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Official email cannot be changed from the employee detail form.")

    if not EMPLOYEE_PHONE_PATTERN.fullmatch(normalized_form_data["contactNumber"]):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Contact number must be a valid 10-digit Indian mobile number.")

    if not EMPLOYEE_AADHAAR_PATTERN.fullmatch(normalized_form_data["aadhaarNumber"]):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Aadhaar Number must be exactly 12 digits.")

    emergency_phone = "".join(ch for ch in str(normalized_form_data.get("emergencyContactPhone", "") or "") if ch.isdigit())
    if len(emergency_phone) != 10:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(
            status_code=422,
            detail="Emergency contact phone must be exactly 10 digits.",
        )

    normalized_form_data["emergencyContactPhone"] = emergency_phone

    if not re.fullmatch(r"^[A-Z]{5}[0-9]{4}[A-Z]$", normalized_form_data["panNumber"]):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Enter a valid PAN number (e.g. ABCDE1234F).")

    if normalized_form_data["hasUanNumber"] not in {"yes", "no"}:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Select Yes or No for UAN number availability.")

    if normalized_form_data["hasSavingsAccount"] not in {"yes", "no"}:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Select Yes or No for savings account availability.")

    if normalized_form_data["hasUanNumber"] == "yes" and len(normalized_form_data["uanNumber"]) != EMPLOYEE_UAN_LENGTH:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail=f"UAN Number must be exactly {EMPLOYEE_UAN_LENGTH} digits.")

    if normalized_form_data["hasUanNumber"] == "yes" and not normalized_form_data["uanNumber"].startswith(EMPLOYEE_UAN_PREFIX):
        from fastapi import HTTPException as _HTTPException

        raise _HTTPException(status_code=422, detail=f"UAN Number must start with {EMPLOYEE_UAN_PREFIX}.")
    if normalized_form_data["hasUanNumber"] == "no":
        normalized_form_data["uanNumber"] = ""

    has_salary_bank_details = (
        normalized_form_data["hasSavingsAccount"] == "yes"
        and normalized_form_data["hasSalaryAccount"] == "yes"
    )
    if normalized_form_data["hasSavingsAccount"] == "yes" and normalized_form_data["hasSalaryAccount"] not in {"yes", "no"}:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Select Yes or No for salary account availability.")

    if has_salary_bank_details and not EMPLOYEE_ACCOUNT_NUMBER_PATTERN.fullmatch(normalized_form_data["bankAccount"]):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Bank account number must be 9 to 18 digits.")

    if has_salary_bank_details and not EMPLOYEE_IFSC_CODE_PATTERN.fullmatch(normalized_form_data["ifscCode"]):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="Enter a valid IFSC code (e.g. HDFC0001234).")
    if has_salary_bank_details:
        normalized_form_data["accountNumber"] = normalized_form_data["bankAccount"]
        normalized_form_data["salaryAccountInstruction"] = "ready_for_salary_eligibility_validation"
    else:
        normalized_form_data["bankName"] = ""
        normalized_form_data["bankAccount"] = ""
        normalized_form_data["accountNumber"] = ""
        normalized_form_data["ifscCode"] = ""
        normalized_form_data["salaryAccountInstruction"] = "open_or_convert_hdfc_salary_account"

    duplicate_profile = db.scalar(
        select(EmployeeProfile).where(
            EmployeeProfile.employee_code == normalized_form_data["employeeCode"],
            EmployeeProfile.id != profile.id,
        )
    )
    if duplicate_profile is not None:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=409, detail="An employee with this employee code already exists.")

    profile.full_name = normalized_form_data["employeeName"]
    profile.personal_email = normalized_form_data["personalEmail"]
    profile.employee_code = normalized_form_data["employeeCode"]
    profile.phone = normalized_form_data["contactNumber"]
    profile.department = normalized_form_data["department"]
    profile.designation = normalized_form_data["designation"]
    profile.gender = normalized_form_data["gender"]
    profile.date_of_birth = parse_optional_datetime(normalized_form_data["dateOfBirth"]) or profile.date_of_birth
    profile.blood_group = normalize_blood_group(normalized_form_data.get("bloodGroup"))
    profile.emergency_contact_name = str(normalized_form_data.get("emergencyContactName", "") or "").strip()
    profile.emergency_contact_phone = emergency_phone
    profile.emergency_contact_relation = str(
        normalized_form_data.get("emergencyContactRelation", "") or ""
    ).strip()
    profile.aadhaar_hash = fingerprint_identifier(normalized_form_data["aadhaarNumber"])
    profile.aadhaar_last4 = normalized_form_data["aadhaarNumber"][-4:]
    profile_aadhaar_ocr = profile.aadhaar_extracted if isinstance(profile.aadhaar_extracted, dict) else {}
    profile_ocr_number = _valid_aadhaar_number(profile_aadhaar_ocr.get("aadhaarNumber"))
    if profile_ocr_number:
        profile.aadhaar_ocr_match = profile_ocr_number == normalized_form_data["aadhaarNumber"]
        if profile.aadhaar_ocr_match:
            profile.aadhaar_validation_status = profile.aadhaar_validation_status or "matched"
            profile.aadhaar_mismatch_reason = None
        else:
            profile.aadhaar_validation_status = "needs_review"
            profile.aadhaar_mismatch_reason = "Aadhaar OCR number differs from employee-entered number."
    elif profile.aadhaar_path:
        profile.aadhaar_ocr_status = profile.aadhaar_ocr_status or "manual_entry"
    user.name = profile.full_name
    user.phone = profile.phone
    db.add(user)
    db.add(profile)

    missing_documents: list[str] = []
    for document_type, label in EMPLOYEE_REQUIRED_DOCUMENTS:
        if document_type == "cancelled_cheque" and not has_salary_bank_details:
            continue
        latest_doc = _latest_employee_document_record(db, profile=profile, document_type=document_type)
        # Legacy profiles store the resume/aadhaar file on the profile itself without an
        # EmployeeDocument row; the dashboard shows those as uploaded, so accept them here too.
        has_legacy = (document_type == "aadhaar" and bool(profile.aadhaar_path)) or (
            document_type == "resume" and bool(profile.resume_path)
        )
        if latest_doc is None and not has_legacy:
            missing_documents.append(label)
    if missing_documents:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(
            status_code=422,
            detail=f"Mandatory documents are missing: {', '.join(missing_documents)}",
        )

    record = ensure_employee_selection_form(db, profile=profile)
    record.form_data = normalized_form_data
    record.status = "submitted"
    record.submitted_at = datetime.now(UTC)
    record.reviewed_at = None
    record.reviewed_by = None
    db.add(record)
    log_audit(
        db,
        entity_type="employee_selection_form",
        entity_id=record.id,
        action="employee_selection_form_submitted",
        actor=user,
        user_id=user.id,
        new_value={"status": record.status},
    )
    _notify_roles(
        db,
        roles={Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA},
        title="Employee detail form submitted",
        message=f"{_employee_display_name(profile, user)} submitted the employee detail form.",
        type_=NotificationType.ACTION,
    )
    return _serialize_selection_form(
        record,
        profile=profile,
        edit_access_enabled=employee_edit_access_enabled(db, profile),
    )


def save_employee_selection_form_draft(
    db: Session,
    *,
    user: User,
    form_data: dict[str, Any],
) -> dict[str, Any]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")
    if not employee_edit_access_enabled(db, profile):
        from fastapi import HTTPException as _HTTPException

        raise _HTTPException(
            status_code=403,
            detail="Employee edit access is disabled after HR/Admin verification.",
        )

    draft_data = {
        key: value.strip() if isinstance(value, str) else value
        for key, value in dict(form_data).items()
    }
    draft_data["employeeCode"] = str(
        draft_data.get("employeeCode", "") or profile.employee_code or ""
    ).strip().upper()
    draft_data["employeeName"] = str(
        draft_data.get("employeeName", "") or profile.full_name or ""
    ).strip()
    draft_data["officialEmail"] = normalize_email_value(
        str(draft_data.get("officialEmail", "") or profile.ethara_email or "")
    )
    if draft_data.get("contactNumber"):
        draft_data["contactNumber"] = "".join(
            ch for ch in str(draft_data.get("contactNumber", "") or "") if ch.isdigit()
        )
    if draft_data.get("emergencyContactPhone"):
        draft_data["emergencyContactPhone"] = "".join(
            ch for ch in str(draft_data.get("emergencyContactPhone", "") or "") if ch.isdigit()
        )
    if draft_data.get("panNumber"):
        draft_data["panNumber"] = "".join(
            ch for ch in str(draft_data.get("panNumber", "") or "").upper() if not ch.isspace()
        )
    if draft_data.get("aadhaarNumber"):
        draft_data["aadhaarNumber"] = _normalize_aadhaar_number(draft_data.get("aadhaarNumber"))
    if draft_data.get("uanNumber"):
        draft_data["uanNumber"] = "".join(
            ch for ch in str(draft_data.get("uanNumber", "") or "") if ch.isdigit()
        )
    if draft_data.get("bankAccount"):
        draft_data["bankAccount"] = "".join(
            ch for ch in str(draft_data.get("bankAccount", "") or "") if ch.isdigit()
        )
    if draft_data.get("ifscCode"):
        draft_data["ifscCode"] = "".join(
            ch for ch in str(draft_data.get("ifscCode", "") or "").upper() if not ch.isspace()
        )

    record = ensure_employee_selection_form(db, profile=profile)
    record.form_data = draft_data
    if record.status != "submitted":
        record.status = "draft"
    db.add(record)
    log_audit(
        db,
        entity_type="employee_selection_form",
        entity_id=record.id,
        action="employee_selection_form_draft_saved",
        actor=user,
        user_id=user.id,
        new_value={"status": record.status},
    )
    return _serialize_selection_form(
        record,
        profile=profile,
        edit_access_enabled=employee_edit_access_enabled(db, profile),
    )


def _save_employee_upload(file: UploadFile, *, folder: str) -> tuple[str, str]:
    storage = StorageService()
    file_url, storage_path = storage.save_upload(file, folder=folder)
    return file_url, storage_path


def _file_referenced_elsewhere(db: Session, file_url: str | None) -> bool:
    """True if any other DB record still points at this stored file, so the file
    must NOT be physically removed. Onboarding shares the SAME physical file across
    the candidate ``documents`` row and one or more ``employee_documents``/contract
    rows; deleting one record must never destroy a file another record still needs.
    Fails SAFE (treats the file as referenced) on any query error."""
    if not file_url:
        return False
    from sqlalchemy import text as _sql_text

    checks = (
        'SELECT 1 FROM employee_documents WHERE "fileUrl" = :u LIMIT 1',
        'SELECT 1 FROM documents WHERE "fileUrl" = :u LIMIT 1',
        'SELECT 1 FROM employee_contracts WHERE "fileUrl" = :u LIMIT 1',
        'SELECT 1 FROM employee_profiles WHERE "resumePath" = :u OR "aadhaarPath" = :u LIMIT 1',
        'SELECT 1 FROM contracts WHERE "pdfUrl" = :u OR "signedUrl" = :u LIMIT 1',
    )
    for sql in checks:
        try:
            if db.execute(_sql_text(sql), {"u": file_url}).first() is not None:
                return True
        except Exception:
            logger.warning("Reference check failed for %s; keeping file", file_url, exc_info=True)
            return True
    return False


def _delete_employee_storage_file(db: Session, file_url: str | None) -> None:
    if not file_url:
        return
    try:
        if _file_referenced_elsewhere(db, file_url):
            logger.info("Keeping file still referenced by another record: %s", file_url)
            return
        resolved = _resolve_employee_file_path(file_url)
        if resolved:
            resolved.unlink(missing_ok=True)
    except Exception:
        logger.warning("Failed to remove employee document file: %s", file_url, exc_info=True)


def _latest_employee_document_record(
    db: Session,
    *,
    profile: EmployeeProfile,
    document_type: str,
) -> EmployeeDocument | None:
    normalized_document_type = _normalize_employee_document_type(document_type)
    records = list(
        db.scalars(
            select(EmployeeDocument)
            .where(EmployeeDocument.employee_profile_id == profile.id)
            .order_by(EmployeeDocument.created_at.desc(), EmployeeDocument.updated_at.desc())
        )
    )
    return next(
        (
            record
            for record in records
            if _normalize_employee_document_type(record.type) == normalized_document_type
        ),
        None,
    )


def _extract_employee_aadhaar_from_document(record: EmployeeDocument) -> dict[str, Any]:
    resolved = _resolve_employee_file_path(record.file_url)
    if resolved is None or not resolved.exists():
        return {}
    try:
        content = resolved.read_bytes()
    except OSError:
        return {}
    if not content:
        return {}

    from app.api.routes.candidates import extract_aadhaar_fields

    upload = UploadFile(
        file=BytesIO(content),
        filename=record.file_name or "aadhaar.pdf",
        headers=Headers({"content-type": record.mime_type or "application/pdf"}),
    )
    try:
        return extract_aadhaar_fields(upload)
    except Exception:
        logger.warning(
            "Failed to OCR employee Aadhaar document %s for profile %s",
            record.id,
            record.employee_profile_id,
            exc_info=True,
        )
        return {}


def _apply_employee_aadhaar_ocr_result(
    db: Session,
    *,
    profile: EmployeeProfile,
    selection_form: EmployeeSelectionForm | None,
    ocr_result: dict[str, Any],
    fill_form: bool,
) -> bool:
    changed = False
    aadhaar_number = _valid_aadhaar_number(ocr_result.get("aadhaarNumber"))

    if ocr_result:
        profile.aadhaar_extracted = ocr_result
        profile.aadhaar_ocr_status = str(
            ocr_result.get("ocrStatus") or ("extracted" if aadhaar_number else "needs_review")
        )
        if ocr_result.get("cardHolderName"):
            profile.aadhaar_ocr_name = str(ocr_result.get("cardHolderName"))
        changed = True

    if aadhaar_number and fill_form and selection_form is not None:
        form_data = dict(selection_form.form_data or {})
        existing = _valid_aadhaar_number(form_data.get("aadhaarNumber"))
        if not existing:
            form_data["aadhaarNumber"] = aadhaar_number
            selection_form.form_data = form_data
            db.add(selection_form)
            changed = True

    if changed:
        db.add(profile)
    return changed


def backfill_employee_aadhaar_from_uploaded_document(
    db: Session,
    *,
    profile: EmployeeProfile,
    selection_form: EmployeeSelectionForm | None,
) -> bool:
    form_data = selection_form.form_data if selection_form and isinstance(selection_form.form_data, dict) else {}
    if _valid_aadhaar_number(form_data.get("aadhaarNumber")):
        return False

    existing_ocr = profile.aadhaar_extracted if isinstance(profile.aadhaar_extracted, dict) else {}
    if _valid_aadhaar_number(existing_ocr.get("aadhaarNumber")):
        return _apply_employee_aadhaar_ocr_result(
            db,
            profile=profile,
            selection_form=selection_form,
            ocr_result=existing_ocr,
            fill_form=True,
        )

    if profile.aadhaar_ocr_status == "needs_review":
        return False

    record = _latest_employee_document_record(db, profile=profile, document_type="aadhaar")
    if record is None:
        return False
    ocr_result = _extract_employee_aadhaar_from_document(record)
    if not ocr_result:
        profile.aadhaar_ocr_status = "needs_review"
        db.add(profile)
        return True
    return _apply_employee_aadhaar_ocr_result(
        db,
        profile=profile,
        selection_form=selection_form,
        ocr_result=ocr_result,
        fill_form=True,
    )


def _sync_employee_profile_document_fields(
    db: Session,
    *,
    profile: EmployeeProfile,
    document_type: str,
) -> None:
    document_type = _normalize_employee_document_type(document_type)
    latest = _latest_employee_document_record(db, profile=profile, document_type=document_type)
    if document_type == "resume":
        profile.resume_path = latest.file_url if latest else None
    elif document_type == "aadhaar":
        profile.aadhaar_path = latest.file_url if latest else None
        if latest:
            profile.aadhaar_ocr_status = profile.aadhaar_ocr_status or "uploaded"
        else:
            profile.aadhaar_ocr_status = None
            profile.aadhaar_ocr_match = None
            profile.aadhaar_ocr_name = None
            profile.aadhaar_validation_status = None
            profile.aadhaar_mismatch_reason = None
    db.add(profile)
    db.flush()


def upload_employee_document_for_profile(
    db: Session,
    *,
    profile: EmployeeProfile,
    actor: User,
    file: UploadFile,
    type_: str,
    endpoint_scope: str,
) -> dict[str, Any]:
    document_type = _normalize_employee_document_type(type_)
    file_url, storage_path = _save_employee_upload(file, folder="employee_documents")
    file.file.seek(0)
    content = file.file.read()
    file.file.seek(0)
    source_label = "employee" if actor.id == profile.user_id else "staff"

    record = EmployeeDocument(
        employee_profile_id=profile.id,
        type=document_type,
        file_name=Path(file.filename or f"{document_type}.bin").name,
        file_url=file_url,
        file_size=len(content) if content else None,
        mime_type=(file.content_type or None),
        status="uploaded",
        remarks=f"{_employee_document_label(document_type)} uploaded by {source_label}.",
        uploaded_by=actor.id,
    )
    _apply_document_ai_verification(
        record, document_type=document_type, content=content, mime_type=file.content_type
    )
    db.add(record)

    if document_type == "resume":
        profile.resume_path = file_url
    if document_type == "aadhaar":
        profile.aadhaar_path = file_url
        profile.aadhaar_ocr_status = profile.aadhaar_ocr_status or "uploaded"
    db.add(profile)
    db.flush()

    log_audit(
        db,
        entity_type="employee_document",
        entity_id=record.id,
        action=f"employee_document_uploaded:{document_type}",
        actor=actor,
        user_id=profile.user_id,
        new_value={"type": document_type, "fileUrl": file_url, "storagePath": storage_path},
    )
    _notify_roles(
        db,
        roles={Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA, Role.IT_TEAM},
        title="Employee document uploaded",
        message=f"{_employee_display_name(profile, actor)} uploaded {_employee_document_label(document_type)}.",
        type_=NotificationType.INFO,
    )
    return _employee_document_payload(profile=profile, record=record, endpoint_scope=endpoint_scope)


def upload_employee_document(
    db: Session,
    *,
    user: User,
    file: UploadFile,
    type_: str,
) -> dict[str, Any]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")
    return upload_employee_document_for_profile(
        db,
        profile=profile,
        actor=user,
        file=file,
        type_=type_,
        endpoint_scope="self",
    )


def delete_employee_document(
    db: Session,
    *,
    profile: EmployeeProfile,
    actor: User,
    document_ref: str,
) -> None:
    record = db.get(EmployeeDocument, document_ref)
    if record is not None and record.employee_profile_id == profile.id:
        document_type = _normalize_employee_document_type(record.type)
        file_url = record.file_url
        old_value = {
            "type": record.type,
            "normalizedType": document_type,
            "fileName": record.file_name,
            "fileUrl": record.file_url,
        }
        db.delete(record)
        db.flush()
        if document_type in {"resume", "aadhaar"}:
            _sync_employee_profile_document_fields(db, profile=profile, document_type=document_type)
        _delete_employee_storage_file(db, file_url)
        log_audit(
            db,
            entity_type="employee_document",
            entity_id=record.id,
            action=f"employee_document_deleted:{document_type}",
            actor=actor,
            user_id=profile.user_id,
            old_value=old_value,
        )
        return

    document_type = _normalize_employee_document_type(document_ref)
    if document_type not in {"resume", "aadhaar"}:
        raise ValueError("Document not found")

    file_url = profile.resume_path if document_type == "resume" else profile.aadhaar_path
    if not file_url:
        raise ValueError("Document not found")

    old_value = {"type": document_type, "fileUrl": file_url, "legacy": True}
    if document_type == "resume":
        profile.resume_path = None
    else:
        profile.aadhaar_path = None
        profile.aadhaar_ocr_status = None
        profile.aadhaar_ocr_match = None
        profile.aadhaar_ocr_name = None
        profile.aadhaar_validation_status = None
        profile.aadhaar_mismatch_reason = None
    db.add(profile)
    db.flush()
    _delete_employee_storage_file(db, file_url)
    log_audit(
        db,
        entity_type="employee_document",
        entity_id=f"{profile.id}:{document_type}",
        action=f"employee_document_deleted:{document_type}",
        actor=actor,
        user_id=profile.user_id,
        old_value=old_value,
    )


def get_employee_document_for_download(
    db: Session,
    *,
    profile: EmployeeProfile,
    document_ref: str,
) -> tuple[Path | str | None, str | None, str | None]:
    record = db.get(EmployeeDocument, document_ref)
    if record is not None and record.employee_profile_id == profile.id:
        reference = _resolve_employee_file_reference(record.file_url)
        return reference, record.file_name, record.mime_type

    normalized_document_ref = _normalize_employee_document_type(document_ref)
    record = _latest_employee_document_record(db, profile=profile, document_type=normalized_document_ref)
    if record is not None:
        reference = _resolve_employee_file_reference(record.file_url)
        return reference, record.file_name, record.mime_type

    if normalized_document_ref == "resume":
        reference = _resolve_employee_file_reference(profile.resume_path)
        file_name = _file_name_from_reference(profile.resume_path, reference)
        return reference, file_name, _employee_document_mime(file_name=file_name, file_url=profile.resume_path)
    if normalized_document_ref == "aadhaar":
        reference = _resolve_employee_file_reference(profile.aadhaar_path)
        file_name = _file_name_from_reference(profile.aadhaar_path, reference)
        return reference, file_name, _employee_document_mime(file_name=file_name, file_url=profile.aadhaar_path)
    return None, None, None


def get_employee_contract_records(db: Session, *, user: User) -> list[dict[str, Any]]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")
    repair_completed_candidate_employee_onboarding(db, profile=profile, actor=user)
    sync_employee_contracts_from_signed_documents(db, profile=profile)
    contracts = ensure_default_employee_contract(db, profile=profile)
    return [_serialize_contract(profile, record) for record in contracts]


def get_employee_contract_download(
    db: Session,
    *,
    user: User,
    contract_id: str,
) -> tuple[EmployeeProfile, EmployeeContract, Path | None]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")
    record = db.scalar(
        select(EmployeeContract).where(
            EmployeeContract.employee_profile_id == profile.id,
            EmployeeContract.id == contract_id,
        )
    )
    if record is None:
        raise ValueError("Contract not found")
    return profile, record, _resolve_employee_file_path(record.file_url)


def get_employee_compliance_records(db: Session, *, user: User) -> list[dict[str, Any]]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")
    records = ensure_employee_compliance_forms(db, profile=profile)
    return [_serialize_compliance_form(record) for record in records]


def submit_employee_compliance_form(
    db: Session,
    *,
    user: User,
    form_id: str,
    form_data: dict[str, Any],
) -> dict[str, Any]:
    profile = get_employee_profile_for_user(db, user)
    if profile is None:
        raise ValueError("Employee profile not found")
    record = db.scalar(
        select(EmployeeComplianceForm).where(
            EmployeeComplianceForm.employee_profile_id == profile.id,
            EmployeeComplianceForm.id == form_id,
        )
    )
    if record is None:
        raise ValueError("Compliance form not found")
    normalized_form_data = _validate_employee_compliance_form(record.form_type, form_data)
    record.form_data = normalized_form_data
    record.status = "submitted"
    record.submitted_at = datetime.now(UTC)
    db.add(record)
    log_audit(
        db,
        entity_type="employee_compliance",
        entity_id=record.id,
        action="employee_compliance_submitted",
        actor=user,
        user_id=user.id,
        new_value={"status": record.status, "formType": record.form_type},
    )
    _notify_roles(
        db,
        roles={Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA, Role.COMPLIANCE},
        title="Employee compliance submitted",
        message=f"{_employee_display_name(profile, user)} submitted {record.form_title}.",
        type_=NotificationType.ACTION,
    )
    return _serialize_compliance_form(record)


def review_employee_compliance_form(
    db: Session,
    *,
    actor: User,
    employee_id: str,
    form_id: str,
    status_value: str,
    remarks: str | None,
) -> dict[str, Any]:
    profile = get_employee_profile_or_404(db, employee_id=employee_id)
    record = db.scalar(
        select(EmployeeComplianceForm).where(
            EmployeeComplianceForm.employee_profile_id == profile.id,
            EmployeeComplianceForm.id == form_id,
        )
    )
    if record is None:
        raise ValueError("Compliance form not found")
    normalized_status = status_value.strip().lower()
    record.status = normalized_status
    record.remarks = remarks
    record.reviewed_by = actor.id
    if normalized_status == "verified":
        record.verified_at = datetime.now(UTC)
    db.add(record)
    log_audit(
        db,
        entity_type="employee_compliance",
        entity_id=record.id,
        action=f"employee_compliance_reviewed:{normalized_status}",
        actor=actor,
        user_id=profile.user_id,
        new_value={"status": normalized_status, "remarks": remarks},
    )
    return _serialize_compliance_form(record)


def list_all_employee_compliance_records(db: Session) -> list[dict[str, Any]]:
    rows = list(
        db.scalars(
            select(EmployeeComplianceForm).order_by(EmployeeComplianceForm.updated_at.desc())
        )
    )
    results = []
    for record in rows:
        profile = db.get(EmployeeProfile, record.employee_profile_id)
        if profile is None:
            continue
        payload = _serialize_compliance_form(record)
        payload["employeeId"] = profile.id
        payload["employeeName"] = profile.full_name
        payload["employeeCode"] = profile.employee_code
        payload["etharaEmail"] = profile.ethara_email
        results.append(payload)
    return results


def _normalize_referral_link(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    link = value.strip()
    if "://" not in link:
        link = f"https://{link}"
    return link[:500]


def _serialize_career_referral(application: CareerApplication) -> dict[str, Any]:
    return {
        "candidateId": application.id,
        "candidateName": application.full_name,
        "positionTitle": "Resume Database",
        "currentStage": "submitted",
        "currentStatus": application.status or "new",
        "createdAt": application.created_at,
    }


def create_employee_referral(
    db: Session,
    *,
    user: User,
    full_name: str,
    personal_email: str,
    phone: str,
    resume_file_name: str,
    resume_url: str,
    resume_storage_path: str,
    resume_mime_type: str | None,
    resume_size: int,
    linkedin_url: str | None = None,
    portfolio_url: str | None = None,
    github_url: str | None = None,
    position_id: str | None = None,  # retained for backward-compat; referrals land in the dropbox
) -> dict[str, Any]:
    del position_id
    profile = get_employee_profile_for_user(db, user)
    referrer_name = _employee_display_name(profile, user)
    normalized_email = normalize_email_value(personal_email)
    normalized_full_name = full_name.strip()
    normalized_phone = phone.strip()
    if len(normalized_full_name) < 2:
        raise ValueError("Enter the candidate's full name")
    if not normalized_email:
        raise ValueError("Enter the candidate's email")
    if not resume_url:
        raise ValueError("Resume upload is required.")

    # Referrals go straight to the dropbox / Resume Database — no pipeline candidate,
    # no portal account, tagged with who referred them.
    application = CareerApplication(
        full_name=normalized_full_name,
        email=normalized_email,
        phone=normalized_phone,
        linkedin_url=_normalize_referral_link(linkedin_url),
        portfolio_url=_normalize_referral_link(portfolio_url),
        github_url=_normalize_referral_link(github_url),
        resume_file_name=resume_file_name,
        resume_url=resume_url,
        resume_storage_path=resume_storage_path,
        resume_mime_type=resume_mime_type,
        resume_size=resume_size,
        status="new",
        referred_by_id=user.id,
        referred_by_name=referrer_name,
    )
    db.add(application)
    db.flush()

    log_audit(
        db,
        entity_type="career_application",
        entity_id=application.id,
        action="employee_referral_created",
        actor=user,
        user_id=user.id,
        new_value={
            "applicationId": application.id,
            "candidateName": application.full_name,
            "referredById": user.id,
            "referredByName": referrer_name,
        },
    )
    _notify_roles(
        db,
        roles={Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA},
        title="New referral in Resume Database",
        message=f"{referrer_name} referred {application.full_name} to the Resume Database.",
        type_=NotificationType.ACTION,
    )
    return _serialize_career_referral(application)


def list_employee_referrals_for_user(db: Session, *, user: User) -> list[dict[str, Any]]:
    applications = db.scalars(
        select(CareerApplication)
        .where(CareerApplication.referred_by_id == user.id)
        .order_by(CareerApplication.created_at.desc())
    )
    return [_serialize_career_referral(application) for application in applications]


def _registration_candidate_for_profile(db: Session, profile: EmployeeProfile) -> Candidate | None:
    """The candidate record this employee was registered as, matched by GRP code /
    Aadhaar hash / email — used to compare registration-time vs onboarding identity."""
    conditions = []
    if profile.employee_code:
        conditions.append(Candidate.employee_code == profile.employee_code)
        conditions.append(Candidate.candidate_code == profile.employee_code)
    if profile.aadhaar_hash:
        conditions.append(Candidate.aadhaar_hash == profile.aadhaar_hash)
    for email in (profile.personal_email, profile.ethara_email):
        if email and email.strip():
            conditions.append(func.lower(func.coalesce(Candidate.personal_email, "")) == email.strip().lower())
            conditions.append(func.lower(func.coalesce(Candidate.ethara_email, "")) == email.strip().lower())
    if not conditions:
        return None
    return db.scalar(
        select(Candidate).where(or_(*conditions)).order_by(Candidate.created_at.desc())
    )


def validate_employee_identity(db: Session, *, profile: EmployeeProfile) -> dict[str, Any]:
    """Compare an employee's onboarding identity (EmployeeProfile) against the
    identity captured at registration (Candidate): Name + Aadhaar (by secure hash).
    Flags any divergence so HR can catch typos / wrong-document onboarding.
    PAN is not stored as a number, so it cannot be number-compared here."""
    candidate = _registration_candidate_for_profile(db, profile)
    if candidate is None:
        return {"status": "not_linked", "reason": "No registration record found to compare against.", "checks": []}

    def _norm(value: str | None) -> str:
        return " ".join((value or "").strip().lower().split())

    checks: list[dict[str, Any]] = []
    if _norm(profile.full_name) and _norm(candidate.full_name):
        checks.append({
            "field": "Name",
            "match": _norm(profile.full_name) == _norm(candidate.full_name),
            "registration": candidate.full_name,
            "onboarding": profile.full_name,
        })
    if profile.aadhaar_hash and candidate.aadhaar_hash:
        checks.append({
            "field": "Aadhaar",
            "match": profile.aadhaar_hash == candidate.aadhaar_hash,
            "registration": f"••••{candidate.aadhaar_last4}" if candidate.aadhaar_last4 else "on file",
            "onboarding": f"••••{profile.aadhaar_last4}" if profile.aadhaar_last4 else "on file",
        })

    mismatches = [c for c in checks if not c["match"]]
    if not checks:
        status, reason = "insufficient", "Not enough identity data on file to compare."
    elif mismatches:
        status = "mismatch"
        reason = ", ".join(f"{c['field']} differs between registration and onboarding" for c in mismatches)
    else:
        status, reason = "verified", None
    return {"status": status, "reason": reason, "checks": checks, "candidateId": candidate.id}


def _employee_lifecycle_candidate_for_profile(
    db: Session,
    profile: EmployeeProfile,
) -> Candidate | None:
    conditions = []
    if profile.employee_code:
        normalized_code = normalize_employee_code(profile.employee_code)
        conditions.extend(
            [
                func.upper(func.trim(func.coalesce(Candidate.employee_code, ""))) == normalized_code,
                func.upper(func.trim(func.coalesce(Candidate.candidate_code, ""))) == normalized_code,
            ]
        )
    if profile.ethara_email:
        normalized_email = normalize_email_value(profile.ethara_email)
        conditions.append(
            func.lower(func.trim(func.coalesce(Candidate.ethara_email, ""))) == normalized_email
        )
    if not conditions:
        return None
    return db.scalar(
        select(Candidate)
        .where(Candidate.is_removed.is_(False), or_(*conditions))
        .order_by(Candidate.created_at.desc())
    )


def get_employee_detail(db: Session, *, employee_id: str) -> dict[str, Any]:
    profile = get_employee_profile_or_404(db, employee_id=employee_id)
    user = db.scalar(select(User).where(User.id == profile.user_id)) if profile.user_id else None
    linked_candidate = _employee_lifecycle_candidate_for_profile(db, profile)
    candidate_onboarding_pending = bool(
        linked_candidate and linked_candidate.current_stage != CandidateStage.ONBOARDING_COMPLETED
    )
    registration_status = (
        "candidate_onboarding_pending"
        if candidate_onboarding_pending
        else "completed"
        if user and user.is_active and user.email_verified_at
        else "account_activation_pending"
        if user
        else "needs_repair"
    )
    current_employee_status = (
        "Candidate Onboarding Pending"
        if candidate_onboarding_pending
        else _employee_status_from_separation(db, profile, user)
    )
    audits = _employee_audits(db, profile=profile, user=user)
    workspace = _workspace_context(db, profile=profile, user=user, endpoint_scope="staff")
    next_required_action = workspace["nextRequiredAction"]
    if candidate_onboarding_pending:
        next_required_action = (
            f"Candidate onboarding is currently {linked_candidate.current_status}. "
            "Complete candidate onboarding before marking this employee active."
        )
    resume_document = next(
        (document for document in workspace["documents"] if document["type"] == "resume"),
        None,
    )

    timeline = [
        event
        for event in [
            _timeline_event(
                event_id=f"{profile.id}:registered",
                title="Employee registered",
                occurred_at=profile.created_at,
                status="completed",
                description="Profile and authentication records were created.",
            ),
            _timeline_event(
                event_id=f"{profile.id}:selection-form",
                title="Employee detail form submitted",
                occurred_at=workspace["selectionForm"].get("submittedAt"),
                status="completed" if workspace["selectionForm"].get("status") == "submitted" else "pending",
                description="Employee submitted the employee detail form.",
            ),
            _timeline_event(
                event_id=f"{profile.id}:resume",
                title="Resume uploaded",
                occurred_at=resume_document.get("uploadedAt") if resume_document else None,
                status="completed" if resume_document and not resume_document["missing"] else "pending",
                description=resume_document.get("remarks") if resume_document else None,
            ),
            _timeline_event(
                event_id=f"{profile.id}:aadhaar",
                title="Aadhaar submitted",
                occurred_at=profile.updated_at if profile.aadhaar_path else None,
                status=(
                    "completed"
                    if profile.aadhaar_ocr_match
                    else "needs_review"
                    if profile.aadhaar_path
                    else "pending"
                ),
                description=(
                    "Aadhaar OCR matched the submitted details."
                    if profile.aadhaar_ocr_match
                    else "Aadhaar requires manual review."
                    if profile.aadhaar_path
                    else "Aadhaar document not uploaded yet."
                ),
            ),
            _timeline_event(
                event_id=f"{profile.id}:activation",
                title="Employee account active" if user and user.is_active else "Employee account pending",
                occurred_at=(user.updated_at if user and user.updated_at else user.created_at) if user else None,
                status="completed" if user and user.is_active else "pending",
                description="Admin or HR can activate or offboard the employee from the auth record.",
            ),
        ]
        if event is not None
    ]

    for contract in workspace["contracts"]:
        timeline.append(
            {
                "id": f"{profile.id}:contract:{contract['id']}",
                "title": f"Contract {str(contract['status']).replace('_', ' ').replace('-', ' ').title()}",
                "description": contract.get("remarks"),
                "status": "completed" if contract["status"] == "signed" else "pending",
                "occurredAt": contract.get("completedAt") or contract.get("issuedAt") or contract.get("createdAt"),
            }
        )
    for compliance_form in workspace["complianceForms"]:
        if compliance_form.get("submittedAt") or compliance_form.get("verifiedAt"):
            timeline.append(
                {
                    "id": f"{profile.id}:compliance:{compliance_form['id']}",
                    "title": compliance_form["formTitle"],
                    "description": compliance_form.get("remarks"),
                    "status": compliance_form["status"],
                    "occurredAt": compliance_form.get("verifiedAt") or compliance_form.get("submittedAt"),
                }
            )
    for audit in audits:
        timeline.append(
            {
                "id": audit.id,
                "title": audit.action.replace("_", " ").replace(":", " ").title(),
                "description": audit.performed_by_name or audit.performed_by_role or "System",
                "status": "completed",
                "occurredAt": audit.created_at,
            }
        )
    normalized_timeline = []
    for item in timeline:
        occurred_at = parse_optional_datetime(item.get("occurredAt"))
        if occurred_at is None:
            continue
        item["occurredAt"] = occurred_at
        normalized_timeline.append(item)
    normalized_timeline.sort(key=lambda item: item["occurredAt"], reverse=True)
    timeline = normalized_timeline

    return {
        "id": profile.id,
        "userId": user.id if user else profile.user_id,
        "fullName": profile.full_name,
        "etharaEmail": profile.ethara_email,
        "personalEmail": profile.personal_email,
        "employeeCode": profile.employee_code,
        "identityValidation": validate_employee_identity(db, profile=profile),
        # The employee's originating candidate record — carries the Documenso contract, so the
        # employee profile's Contracts tab can send / replace contracts through the same flow.
        "linkedCandidateId": linked_candidate.id if linked_candidate else None,
        "linkedCandidateStage": (
            linked_candidate.current_stage.value
            if linked_candidate and linked_candidate.current_stage
            else None
        ),
        "phone": profile.phone,
        "department": profile.department,
        "designation": profile.designation,
        "gender": profile.gender,
        "vendor": profile.vendor,
        "employmentStatus": profile.employment_status,
        "workMode": profile.work_mode,
        "dateOfJoining": profile.date_of_joining,
        "bloodGroup": profile.blood_group,
        "emergencyContactName": profile.emergency_contact_name,
        "emergencyContactPhone": profile.emergency_contact_phone,
        "emergencyContactRelation": profile.emergency_contact_relation,
        "aadhaarLast4": profile.aadhaar_last4,
        "aadhaarOcrStatus": profile.aadhaar_ocr_status,
        "aadhaarOcrMatch": profile.aadhaar_ocr_match,
        "dateOfBirth": profile.date_of_birth,
        "registrationStatus": registration_status,
        "currentEmployeeStatus": current_employee_status,
        "isActive": bool(user and user.is_active),
        "documentCompletionStatus": workspace["documentCompletionStatus"],
        "resumeDocument": resume_document,
        "documents": workspace["documents"],
        "missingDocuments": workspace["missingDocuments"],
        "selectionForm": workspace["selectionForm"],
        "contracts": workspace["contracts"],
        "complianceForms": workspace["complianceForms"],
        "referralActivity": workspace["referralActivity"],
        "profileJourney": workspace["profileJourney"],
        "profileCompletionPercentage": workspace["profileCompletionPercentage"],
        "nextRequiredAction": next_required_action,
        "auditLogs": [
            {
                "id": audit.id,
                "entityType": audit.entity_type,
                "entityId": audit.entity_id,
                "action": audit.action,
                "performedBy": audit.performed_by,
                "performedByName": audit.performed_by_name,
                "performedByRole": audit.performed_by_role,
                "candidateId": audit.candidate_id,
                "userId": audit.user_id,
                "ipAddress": audit.ip_address,
                "userAgent": audit.user_agent,
                "oldValue": audit.old_value,
                "newValue": audit.new_value,
                "createdAt": audit.created_at,
            }
            for audit in audits
        ],
        "timeline": timeline,
        "createdAt": profile.created_at,
        "updatedAt": profile.updated_at,
    }
