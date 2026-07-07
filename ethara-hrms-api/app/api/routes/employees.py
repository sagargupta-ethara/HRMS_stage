from __future__ import annotations

import concurrent.futures
import csv
import html
import io
import json
import logging
import os
import re
import secrets
import string
import tempfile
import zipfile
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_permissions
from app.core.database import get_db
from app.core.exports import csv_safe_mapping
from app.core.limiter import limiter
from app.core.permissions import Permission
from app.core.security import fingerprint_identifier
from app.core.timezone import app_date_stamp, format_app_datetime, to_app_timezone
from app.db.models import (
    AuditLog,
    Candidate,
    CandidateStage,
    EmployeeDocument,
    EmployeeImportStaging,
    EmployeeProfile,
    NotificationType,
    Role,
    User,
)
from app.schemas.resources import validate_password_strength
from app.schemas.workflow import (
    EmployeeComplianceFormRead,
    EmployeeComplianceReviewRequest,
    EmployeeContractRead,
    EmployeeDetailRead,
    EmployeeDocumentRead,
    EmployeeJourneyStageRead,
    EmployeeReferralActivityRead,
    EmployeeSelectionFormRead,
    EmployeeSelectionFormSubmitRequest,
)
from app.services import account_security
from app.services import compliance_documenso as compliance_esign
from app.services import employees as employee_service
from app.services import workflows

router = APIRouter(prefix="/employees", tags=["employees"])

logger = logging.getLogger(__name__)

ETHARA_EMAIL_DOMAIN = "@ethara.ai"
EMPLOYEE_DOCUMENT_OCR_TIMEOUT_SECONDS = 50
EMPLOYEE_FULL_DETAIL_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.TA}
EMPLOYEE_EDIT_ACCESS_ROLES = EMPLOYEE_FULL_DETAIL_ROLES | {Role.IT_TEAM}
EMPLOYEE_USER_EXPORT_ROLES = EMPLOYEE_FULL_DETAIL_ROLES | {Role.IT_TEAM}

# Bulk import guardrails
MAX_BULK_CSV_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_BULK_ROWS = 1000


def _role_value(value: Role | str) -> str:
    return value.value if isinstance(value, Role) else str(value)


def _user_role_values(user: User) -> set[str]:
    return {_role_value(user.role)} | {_role_value(role) for role in (user.roles or [])}


def _has_any_role(user: User, roles: set[Role]) -> bool:
    allowed = {_role_value(role) for role in roles}
    return bool(_user_role_values(user) & allowed)


def _display_label(value: str | None) -> str:
    return str(value or "").replace("_", " ").replace("-", " ").title()


def _run_employee_document_ocr(extractor, upload: UploadFile, fallback: dict) -> dict:
    from app.api.routes.candidates import _ocr_executor

    try:
        future = _ocr_executor.submit(extractor, upload)
        return future.result(timeout=EMPLOYEE_DOCUMENT_OCR_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError:
        return {
            **fallback,
            "ocrStatus": "needs_review",
            "message": "OCR timed out. Please upload a clearer document or enter the details manually.",
        }
    except Exception:
        return fallback


class EmployeeEmailVerifyRequest(BaseModel):
    email: str
    code: str


class EmployeeResendVerificationRequest(BaseModel):
    email: str


class EmployeeReferenceOptionsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    departments: list[str] | None = None
    designations: list[str] | None = None
    department_admins: dict[str, str | list[str] | None] | None = Field(default=None, alias="departmentAdmins")


class EmployeeEditAccessRequest(BaseModel):
    enabled: bool


class EmployeeHrFieldsRequest(BaseModel):
    """HR/admin-only employee fields, not part of the employee self-form."""

    vendor: str | None = None
    employment_status: str | None = Field(default=None, alias="employmentStatus")
    work_mode: str | None = Field(default=None, alias="workMode")
    # Date of Joining — accepted as an ISO date string (or "" to clear); HR/admin only.
    date_of_joining: str | None = Field(default=None, alias="dateOfJoining")

    model_config = {"populate_by_name": True}


class EmployeeCodeUpdateRequest(BaseModel):
    """Change an employee's GRP code from the profile screen."""

    employee_code: str = Field(alias="employeeCode")

    model_config = {"populate_by_name": True}


class EmployeeIdCardDetailsRequest(BaseModel):
    """ID Card Details — blood group, emergency contact, family, addresses.
    All optional; only fields actually sent are updated (PATCH semantics)."""

    blood_group: str | None = Field(default=None, alias="bloodGroup")
    emergency_contact_name: str | None = Field(default=None, alias="emergencyContactName")
    emergency_contact_phone: str | None = Field(default=None, alias="emergencyContactPhone")
    emergency_contact_relation: str | None = Field(default=None, alias="emergencyContactRelation")
    father_name: str | None = Field(default=None, alias="fatherName")
    mother_name: str | None = Field(default=None, alias="motherName")
    marital_status: str | None = Field(default=None, alias="maritalStatus")
    current_address: str | None = Field(default=None, alias="currentAddress")
    permanent_address: str | None = Field(default=None, alias="permanentAddress")

    model_config = {"populate_by_name": True}


class EmployeeBulkEditAccessRequest(BaseModel):
    employee_ids: list[str] | None = None
    employeeIds: list[str] | None = None
    enabled: bool

    @property
    def ids(self) -> list[str]:
        return self.employee_ids or self.employeeIds or []


class EmployeeIssueReminderRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    employee_ids: list[str] = Field(default_factory=list, alias="employeeIds")
    issue: str
    message: str | None = None


class EmployeeDocumentReviewRequest(BaseModel):
    status: str
    remarks: str | None = None


ALLOWED_AADHAAR_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/plain",
}
ALLOWED_RESUME_MIME = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_RESUME_EXTENSIONS = {".pdf", ".doc", ".docx"}
MAX_FILE_BYTES = 10 * 1024 * 1024

EMPLOYEE_ISSUE_REMINDERS = {
    "selection_form_pending": {
        "title": "Employee selection form pending",
        "message": (
            "Please complete your employee selection form in Ethara HRMS. "
            "HR needs these details to keep your employee records complete."
        ),
        "entity_type": "employee_selection_form",
    },
    "aadhaar_not_submitted": {
        "title": "Aadhaar document pending",
        "message": (
            "Please upload your Aadhaar document in Ethara HRMS so HR can complete document verification."
        ),
        "entity_type": "employee_document",
    },
}

AADHAAR_OK_STATUSES = {
    "complete",
    "completed",
    "extracted",
    "matched",
    "approved",
    "pass",
    "passed",
    "selection form",
    "success",
    "valid",
    "verified",
}
AADHAAR_REVIEW_STATUSES = {
    "failed",
    "invalid",
    "mismatch",
    "needs correction",
    "needs review",
    "rejected",
}
EMPLOYEE_LIFECYCLE_FILTERS = {"all", "active", "pending_activation", "offboarded"}
EMPLOYEE_ISSUE_FILTERS = {
    "all",
    "selection_form_pending",
    "aadhaar_needs_review",
    "aadhaar_not_submitted",
}
EMPLOYEE_SORT_OPTIONS = {"joining_desc", "joining_asc", "created_desc", "name_asc"}
OFFBOARDED_STATUS_TERMS = {
    "offboard",
    "resign",
    "terminated",
    "termination",
    "no show",
    "no_show",
    "abscond",
    "blacklist",
    "separated",
    "inactive",
}


def _normalized_status(value: str | None) -> str:
    return re.sub(r"[\s_-]+", " ", str(value or "").strip().lower())


def _selection_form_status(profile: EmployeeProfile) -> str:
    selection_form = profile.selection_form
    return selection_form.status if selection_form else "not_started"


def _employee_selection_form_pending(profile: EmployeeProfile) -> bool:
    return _normalized_status(_selection_form_status(profile)) != "submitted"


def _employee_aadhaar_needs_review(profile: EmployeeProfile) -> bool:
    statuses = [
        _normalized_status(profile.aadhaar_validation_status),
        _normalized_status(profile.aadhaar_ocr_status),
    ]
    if any(status in AADHAAR_OK_STATUSES for status in statuses):
        return False
    return any(status in AADHAAR_REVIEW_STATUSES for status in statuses)


def _employee_aadhaar_not_submitted(profile: EmployeeProfile) -> bool:
    status = _normalized_status(profile.aadhaar_ocr_status or profile.aadhaar_validation_status)
    return (
        not profile.aadhaar_path
        and not profile.aadhaar_last4
        and (not status or status == "not submitted")
    )


def _employee_matches_issue(profile: EmployeeProfile, issue: str) -> bool:
    if issue == "selection_form_pending":
        return _employee_selection_form_pending(profile)
    if issue == "aadhaar_needs_review":
        return _employee_aadhaar_needs_review(profile)
    if issue == "aadhaar_not_submitted":
        return _employee_aadhaar_not_submitted(profile)
    return False


def _employee_has_offboarded_status(profile: EmployeeProfile) -> bool:
    status_text = _normalized_status(profile.employment_status)
    return any(_normalized_status(term) in status_text for term in OFFBOARDED_STATUS_TERMS)


def _linked_candidate_for_employee_profile(db: Session, profile: EmployeeProfile) -> Candidate | None:
    conditions = []
    if profile.employee_code:
        normalized_code = employee_service.normalize_employee_code(profile.employee_code)
        conditions.extend(
            [
                func.upper(func.trim(func.coalesce(Candidate.employee_code, ""))) == normalized_code,
                func.upper(func.trim(func.coalesce(Candidate.candidate_code, ""))) == normalized_code,
            ]
        )
    if profile.ethara_email:
        normalized_email = employee_service.normalize_email_value(profile.ethara_email)
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


def _candidate_onboarding_pending(candidate: Candidate | None) -> bool:
    return bool(candidate and candidate.current_stage != CandidateStage.ONBOARDING_COMPLETED)


def _employee_registration_status(
    user: User | None,
    linked_candidate: Candidate | None = None,
) -> str:
    if _candidate_onboarding_pending(linked_candidate):
        return "candidate_onboarding_pending"
    if user is None:
        return "needs_repair"
    if not user.is_active or user.email_verified_at is None:
        return "account_activation_pending"
    return "completed"


def _employee_lifecycle(
    profile: EmployeeProfile,
    user: User | None,
    linked_candidate: Candidate | None = None,
) -> str:
    if _employee_has_offboarded_status(profile):
        return "offboarded"
    if (
        user is None
        or not profile.user_id
        or not user.is_active
        or user.email_verified_at is None
        or _candidate_onboarding_pending(linked_candidate)
    ):
        return "pending_activation"
    return "active"


def _parse_export_filter_date(value: str | None):
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            return None


def _date_only(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        return _parse_export_filter_date(value)
    return None


def _export_profile_joining_date(profile: EmployeeProfile):
    return _date_only(profile.date_of_joining)


def _export_filter_key(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("_", " ").replace("-", " ").strip().lower())


def _export_filter_values_match(left: str | None, right: str | None) -> bool:
    return _export_filter_key(left) == _export_filter_key(right)


def _parse_employee_id_filter(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def _employee_matches_export_issue(
    profile: EmployeeProfile,
    user: User | None,
    issue: str,
    linked_candidate: Candidate | None = None,
) -> bool:
    if issue == "all":
        return True
    if issue == "selection_form_pending":
        return (
            _employee_lifecycle(profile, user, linked_candidate) == "active"
            and _employee_selection_form_pending(profile)
        )
    return _employee_matches_issue(profile, issue)


def _employee_matches_export_filters(
    db: Session,
    profile: EmployeeProfile,
    user: User | None,
    *,
    lifecycle: str,
    department: str | None,
    work_mode: str | None,
    issue: str,
    joining_from,
    joining_to,
) -> bool:
    linked_candidate = _linked_candidate_for_employee_profile(db, profile)
    if lifecycle != "all" and _employee_lifecycle(profile, user, linked_candidate) != lifecycle:
        return False
    if department and department != "all" and not _export_filter_values_match(
        _employee_profile_text(profile, "department", "department"),
        department,
    ):
        return False
    if work_mode and work_mode != "all" and not _export_filter_values_match(profile.work_mode, work_mode):
        return False
    if not _employee_matches_export_issue(profile, user, issue, linked_candidate):
        return False
    joining_date = _export_profile_joining_date(profile)
    if joining_from and (joining_date is None or joining_date < joining_from):
        return False
    if joining_to and (joining_date is None or joining_date > joining_to):
        return False
    return True


def _imported_row_lifecycle(row: dict) -> str:
    status_text = _normalized_status(row.get("employmentStatus"))
    if any(_normalized_status(term) in status_text for term in OFFBOARDED_STATUS_TERMS):
        return "offboarded"
    return "pending_activation"


def _imported_row_matches_issue(row: dict, issue: str) -> bool:
    if issue == "all":
        return True
    if issue == "selection_form_pending":
        return _imported_row_lifecycle(row) == "active" and _normalized_status(row.get("selectionFormStatus")) != "submitted"
    statuses = [
        _normalized_status(row.get("aadhaarValidationStatus")),
        _normalized_status(row.get("aadhaarOcrStatus")),
    ]
    if issue == "aadhaar_needs_review":
        if any(status in AADHAAR_OK_STATUSES for status in statuses):
            return False
        return any(status in AADHAAR_REVIEW_STATUSES for status in statuses)
    if issue == "aadhaar_not_submitted":
        status_text = _normalized_status(row.get("aadhaarOcrStatus") or row.get("aadhaarValidationStatus"))
        return (
            not row.get("aadhaarPath")
            and not row.get("aadhaarLast4")
            and (not status_text or status_text == "not submitted")
        )
    return False


def _imported_row_matches_export_filters(
    row: dict,
    *,
    lifecycle: str,
    department: str | None,
    work_mode: str | None,
    issue: str,
    joining_from,
    joining_to,
) -> bool:
    row_lifecycle = _imported_row_lifecycle(row)
    if lifecycle != "all" and row_lifecycle != lifecycle:
        return False
    if department and department != "all" and not _export_filter_values_match(row.get("department"), department):
        return False
    if work_mode and work_mode != "all" and not _export_filter_values_match(row.get("workMode"), work_mode):
        return False
    if not _imported_row_matches_issue(row, issue):
        return False
    joining_date = _date_only(row.get("dateOfJoining"))
    if joining_from and (joining_date is None or joining_date < joining_from):
        return False
    if joining_to and (joining_date is None or joining_date > joining_to):
        return False
    return True


def _sort_employee_profiles(profiles: list[EmployeeProfile], sort_by: str) -> list[EmployeeProfile]:
    if sort_by == "name_asc":
        return sorted(
            profiles,
            key=lambda profile: _employee_profile_text(profile, "full_name", "employeeName").lower(),
        )
    if sort_by == "created_desc":
        return sorted(
            profiles,
            key=lambda profile: profile.created_at or datetime.min.replace(tzinfo=UTC),
            reverse=True,
        )

    def sortable_timestamp(value: datetime | None) -> float:
        if value is None:
            return 0
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.timestamp()

    def joining_key(profile: EmployeeProfile):
        missing = _export_profile_joining_date(profile) is None
        timestamp_value = sortable_timestamp(profile.date_of_joining)
        comparable = timestamp_value if sort_by == "joining_asc" else -timestamp_value
        return (
            missing,
            comparable,
            _employee_profile_text(profile, "full_name", "employeeName").lower(),
        )

    return sorted(profiles, key=joining_key)


def _selection_form_uploaded_document_types(selection_form) -> set[str]:
    form_data = getattr(selection_form, "form_data", None)
    if not isinstance(form_data, dict):
        return set()
    uploaded: set[str] = set()
    for key in ("documentsUploaded", "uploadedDocuments"):
        raw_uploads = form_data.get(key)
        if not isinstance(raw_uploads, dict):
            continue
        for raw_type, raw_file in raw_uploads.items():
            if raw_file:
                uploaded.add(employee_service._normalize_employee_document_type(str(raw_type)))
    return uploaded


def _employee_export_document_status(
    profile: EmployeeProfile,
    documents: list[EmployeeDocument],
) -> tuple[bool, list[str], list[str]]:
    required_labels = dict(employee_service.EMPLOYEE_REQUIRED_DOCUMENTS)
    required_types = set(required_labels)
    uploaded_types: set[str] = set()
    review_labels: list[str] = []
    review_statuses = {"rejected", "needs correction", "needs review", "failed", "invalid", "mismatch"}

    for document in documents:
        document_type = employee_service._normalize_employee_document_type(document.type)
        if document_type not in required_types:
            continue
        uploaded_types.add(document_type)
        statuses = {
            _normalized_status(getattr(document, "status", None)),
            _normalized_status(getattr(document, "ocr_status", None)),
        }
        if statuses & review_statuses:
            review_labels.append(required_labels[document_type])

    uploaded_types.update(_selection_form_uploaded_document_types(profile.selection_form) & required_types)
    if profile.resume_path:
        uploaded_types.add("resume")
    if profile.aadhaar_path or profile.aadhaar_last4:
        uploaded_types.add("aadhaar")

    missing_labels = [
        label for document_type, label in employee_service.EMPLOYEE_REQUIRED_DOCUMENTS
        if document_type not in uploaded_types
    ]
    return not missing_labels and not review_labels, missing_labels, sorted(set(review_labels))


def _employee_export_contract_complete(contracts) -> tuple[bool, bool]:
    statuses = {_normalized_status(_enum_export_value(contract.status)) for contract in contracts}
    return "signed" in statuses, bool(statuses & {"expired", "cancelled"})


def _employee_export_compliance_status(compliance_forms) -> tuple[bool, bool]:
    if not compliance_forms:
        return False, False
    statuses = {_normalized_status(form.status) for form in compliance_forms}
    has_warning = bool(statuses & {"rejected", "needs correction", "needs review"})
    is_complete = all(status in {"submitted", "verified", "signed"} for status in statuses)
    return is_complete, has_warning


def _enum_export_value(value) -> str:
    return str(getattr(value, "value", value or "")).strip()


def _employee_export_state(
    *,
    profile: EmployeeProfile,
    user: User | None,
    linked_candidate: Candidate | None = None,
    documents: list[EmployeeDocument],
    contracts,
    compliance_forms,
) -> dict[str, str | int]:
    lifecycle = _employee_lifecycle(profile, user, linked_candidate)
    if lifecycle == "offboarded":
        return {
            "stage": "offboarded",
            "state": "Offboarded",
            "nextAction": "",
            "completion": 0,
        }
    if lifecycle == "pending_activation":
        if _candidate_onboarding_pending(linked_candidate):
            return {
                "stage": "candidate_onboarding",
                "state": "Candidate Onboarding Pending",
                "nextAction": "Complete candidate onboarding before marking the employee active",
                "completion": 20,
            }
        has_account = bool(profile.user_id and user is not None)
        return {
            "stage": "account_activation" if has_account else "registration",
            "state": "Account Activation Pending" if has_account else "Employee Registration Pending",
            "nextAction": "Employee should verify and activate account" if has_account else "Employee should complete registration",
            "completion": 20 if has_account else 0,
        }

    completed = 1  # Active employee profile exists: registered/basic profile is available.
    selection_form = profile.selection_form
    if not selection_form or selection_form.status != "submitted":
        return {
            "stage": "employee_detail_form",
            "state": "Employee Detail Form Pending",
            "nextAction": "Employee should submit employee detail form",
            "completion": int((completed / 5) * 100),
        }
    completed += 1

    docs_complete, missing_documents, review_documents = _employee_export_document_status(profile, documents)
    if review_documents:
        return {
            "stage": "documents",
            "state": "Employee Documents Need Review",
            "nextAction": "HR should review: " + ", ".join(review_documents[:5]),
            "completion": int((completed / 5) * 100),
        }
    if not docs_complete:
        return {
            "stage": "documents",
            "state": "Employee Documents Pending",
            "nextAction": "Employee should upload: " + ", ".join(missing_documents[:5]),
            "completion": int((completed / 5) * 100),
        }
    completed += 1

    contract_complete, contract_warning = _employee_export_contract_complete(contracts)
    if not contract_complete:
        return {
            "stage": "contract",
            "state": "Employee Contract Needs Attention" if contract_warning else "Employee Contract Pending",
            "nextAction": "HR should resend or review contract" if contract_warning else "Employee should complete contract",
            "completion": int((completed / 5) * 100),
        }
    completed += 1

    compliance_complete, compliance_warning = _employee_export_compliance_status(compliance_forms)
    if not compliance_complete:
        return {
            "stage": "compliance",
            "state": "Compliance Forms Need Review" if compliance_warning else "Compliance Forms Pending",
            "nextAction": "HR should review compliance forms" if compliance_warning else "Employee should complete compliance forms",
            "completion": int((completed / 5) * 100),
        }

    return {
        "stage": "profile_completed",
        "state": "Profile Completed",
        "nextAction": "",
        "completion": 100,
    }


def _imported_row_export_state(row: dict) -> dict[str, str | int]:
    if _imported_row_lifecycle(row) == "offboarded":
        return {
            "stage": "offboarded",
            "state": "Offboarded",
            "nextAction": "",
            "completion": 0,
        }
    return {
        "stage": "registration",
        "state": "Employee Registration Pending",
        "nextAction": "Employee should complete registration",
        "completion": 0,
    }


def _employee_issue_action_path(issue: str) -> str:
    if issue == "selection_form_pending":
        return "/dashboard/employee/selection-form"
    if issue in {"aadhaar_needs_review", "aadhaar_not_submitted"}:
        return "/dashboard/employee/documents"
    return "/dashboard/employee"


def _send_employee_issue_reminder_email(
    *,
    profile: EmployeeProfile,
    user: User,
    issue: str,
    title: str,
    message: str,
) -> None:
    from app.core.config import get_settings
    from app.services.integrations import EmailService

    recipient = (user.email or profile.ethara_email or "").strip().lower()
    if not recipient:
        raise RuntimeError("Employee email is missing.")

    settings_obj = get_settings()
    portal_url = (
        f"{settings_obj.frontend_url.rstrip('/')}{_employee_issue_action_path(issue)}"
        if settings_obj.frontend_url
        else _employee_issue_action_path(issue)
    )
    safe_name = html.escape(profile.full_name or user.name or "employee")
    safe_title = html.escape(title)
    safe_message = html.escape(message)
    safe_url = html.escape(portal_url, quote=True)

    body_text = (
        f"Dear {profile.full_name or user.name or 'employee'},\n\n"
        f"{message}\n\n"
        f"Open HRMS: {portal_url}\n\n"
        "Please complete this at the earliest. If you have already completed it, you can ignore this reminder.\n\n"
        "Regards,\nEthara HR Team"
    )
    body_html = f"""
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;color:#1f2937">
  <h2 style="margin:0 0 8px;color:#111827">{safe_title}</h2>
  <p>Dear {safe_name},</p>
  <p>{safe_message}</p>
  <p style="margin:24px 0">
    <a href="{safe_url}" style="display:inline-block;border-radius:8px;background:#7c3aed;color:#fff;padding:10px 16px;text-decoration:none;font-weight:600">Open HRMS</a>
  </p>
  <p style="font-size:13px;color:#6b7280">If you have already completed it, you can ignore this reminder.</p>
</div>
"""
    EmailService().send_email(
        to_email=recipient,
        subject=title,
        body_text=body_text,
        body_html=body_html,
    )


def _save_upload(upload: UploadFile, subdir: str) -> str:
    from app.services.integrations import StorageService

    file_url, _storage_path = StorageService().save_upload(upload, folder=subdir)
    upload.file.seek(0)
    return file_url


def _validate_required_resume_upload(upload: UploadFile) -> tuple[int, str]:
    if not upload.filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Resume upload is required.",
        )
    content_type = (upload.content_type or "").split(";", maxsplit=1)[0].strip().lower()
    extension = Path(upload.filename).suffix.lower()
    if content_type not in ALLOWED_RESUME_MIME or extension not in ALLOWED_RESUME_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only PDF, DOC, and DOCX resumes are allowed.",
        )
    upload.file.seek(0, os.SEEK_END)
    size = upload.file.tell()
    upload.file.seek(0)
    if size == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Resume file is empty.",
        )
    if size > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Resume must be 10 MB or smaller.",
        )
    return size, content_type


def _save_required_resume_upload(upload: UploadFile) -> tuple[str, str]:
    from app.services.integrations import StorageService

    return StorageService().save_upload(
        upload,
        folder="career_applications",
        allowed_content_types=ALLOWED_RESUME_MIME,
        max_size_bytes=MAX_FILE_BYTES,
    )


def _assert_employee_staff(current_user: User) -> None:
    if not _has_any_role(current_user, employee_service.employee_staff_roles()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to employee records.",
        )


def _has_employee_full_detail_access(current_user: User) -> bool:
    return _has_any_role(current_user, EMPLOYEE_FULL_DETAIL_ROLES)


def _assert_employee_full_detail_access(current_user: User) -> None:
    if _has_employee_full_detail_access(current_user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only Admin, HR, and TA users can open full employee details.",
    )


def _assert_employee_user_export_access(current_user: User) -> None:
    if _has_any_role(current_user, EMPLOYEE_USER_EXPORT_ROLES):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only Admin, HR, TA, and IT users can export employee user details.",
    )


def _assert_employee_edit_access_admin(current_user: User) -> None:
    if _has_any_role(current_user, EMPLOYEE_EDIT_ACCESS_ROLES):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only Admin, HR, TA, and IT users can manage employee edit access.",
    )


def _assert_employee_self(current_user: User) -> None:
    if not _has_any_role(current_user, employee_service.employee_self_roles()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Employee access is required for this action.",
        )


# Only these content types are ever safe to render inline in a browser. Active
# content (svg/html/xml/js) is deliberately excluded — serving such a document
# inline would let stored markup execute in the app's origin (stored XSS), so it
# is forced to download via the route whitelist below.
_SAFE_INLINE_MIME = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
}

_EXTENSION_INLINE_MIME = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _inline_preview_mime(path: Path, preferred_mime: str | None = None) -> str:
    """Derive a conservative content type for inline preview.

    The served type is derived from the file extension first; a caller-supplied
    ``preferred_mime`` is only honoured when it is itself in the safe-inline
    whitelist. SVG/HTML/XML and any other non-whitelisted type collapse to
    ``application/octet-stream`` so the preview routes (which require a
    whitelisted type) reject them and never render active content inline.
    """
    normalized_preferred = (preferred_mime or "").split(";")[0].strip().lower()
    extension_mime = _EXTENSION_INLINE_MIME.get(path.suffix.lower())
    if extension_mime:
        # Trust the extension-derived type; honour a matching safe preferred type.
        if normalized_preferred in _SAFE_INLINE_MIME:
            return normalized_preferred
        return extension_mime
    # No recognised safe extension. Only honour a preferred type that is itself
    # safe to render inline; otherwise force a download.
    if normalized_preferred in _SAFE_INLINE_MIME:
        return normalized_preferred
    return "application/octet-stream"


@router.get("/check-duplicate")
def check_duplicate(
    db: Session = Depends(get_db),
    email: str | None = None,
    code: str | None = None,
) -> dict:
    """Check if email or employee code already exists. Returns 409 if duplicate found."""
    if email:
        normalized = email.strip().lower()
        exists_user = db.scalar(select(User).where(func.lower(User.email) == normalized))
        exists_profile = db.scalar(
            select(EmployeeProfile).where(func.lower(EmployeeProfile.ethara_email) == normalized)
        )
        if exists_user or exists_profile:
            raise HTTPException(
                status_code=409, detail="An account with this email already exists."
            )

    if code:
        # Check every place a code can live (employee, active candidate, import staging), not
        # just employee profiles — a code already allocated to a candidate is NOT free.
        holder = employee_service.find_employee_code_holder(db, code)
        if holder is not None:
            who = holder.get("name") or holder.get("email") or "another record"
            kind = "candidate" if holder.get("type") == "candidate" else "employee"
            raise HTTPException(
                status_code=409,
                detail=f"Employee code already assigned to {who} ({kind}).",
            )

    return {"available": True}


@router.get("/reference-options")
def get_employee_reference_options(
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    return employee_service.employee_reference_options(db)


@router.get("/reference-options/admin")
def get_employee_reference_options_admin(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    _assert_employee_staff(current_user)
    return employee_service.employee_reference_options(db, include_department_admins=True)


@router.put("/reference-options")
def update_employee_reference_options(
    payload: EmployeeReferenceOptionsRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    _assert_employee_staff(current_user)
    try:
        options = employee_service.upsert_employee_reference_options(
            db,
            departments=payload.departments,
            designations=payload.designations,
            department_admins=payload.department_admins,
            actor=current_user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.commit()
    return options


EMPLOYEE_BULK_UPDATE_TEMPLATE_ROWS = [
    (
        "Employee Code",
        "Email",
        "Department",
        "Designation",
        "Date of Joining",
        "Vendor",
        "Work Mode",
        "New Employee Code",
    ),
    (
        "GRP1001",
        "",
        "Operations - Generalist",
        "Associate - LLM Post Training",
        "2026-06-16",
        "Ethara AI",
        "Hybrid",
        "",
    ),
    ("GRP1002", "", "Engineering", "Software Engineer", "", "", "Remote", ""),
    ("", "employee@ethara.ai", "Data & AI", "Data Analyst", "16/06/2026", "Ethara AI", "Onsite", "GRP1003"),
]


@router.get("/bulk-update/template")
def employee_bulk_update_template(
    _: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
):
    buffer = io.StringIO()
    csv.writer(buffer).writerows(EMPLOYEE_BULK_UPDATE_TEMPLATE_ROWS)
    return PlainTextResponse(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="employee_update_template.csv"'},
    )


def _bulk_update_column(row: dict, *names: str) -> str:
    lowered = {str(key or "").strip().lower(): value for key, value in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _employee_selection_form_text(profile: EmployeeProfile, key: str) -> str:
    selection_form = getattr(profile, "selection_form", None)
    form_data = getattr(selection_form, "form_data", None)
    if not isinstance(form_data, dict):
        return ""
    value = form_data.get(key)
    return str(value or "").strip() if value is not None else ""


def _employee_profile_text(profile: EmployeeProfile, attr: str, form_key: str) -> str:
    value = getattr(profile, attr, None)
    if value is not None and str(value).strip():
        return str(value).strip()
    return _employee_selection_form_text(profile, form_key)


def _employee_profile_date(profile: EmployeeProfile, attr: str, form_key: str) -> datetime | None:
    value = getattr(profile, attr, None)
    if isinstance(value, datetime):
        return value
    raw = _employee_selection_form_text(profile, form_key)
    return employee_service._safe_parse_sheet_date(raw) if raw else None


EMPLOYEE_CODE_PATTERN = re.compile(r"^GRP\d+$")


@router.post("/bulk-update")
async def bulk_update_employees(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
    file: Annotated[UploadFile, File(...)],
):
    _assert_employee_staff(current_user)
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload a UTF-8 CSV file (use the provided template).",
        ) from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The file has no header row.")

    employees = db.scalars(select(EmployeeProfile)).all()
    by_code = {str(e.employee_code or "").strip().lower(): e for e in employees if e.employee_code}
    by_email: dict[str, EmployeeProfile] = {}
    for employee in employees:
        for email in (employee.ethara_email, employee.personal_email):
            if email:
                by_email.setdefault(email.strip().lower(), employee)

    results: list[dict] = []
    updated = rejected = 0
    for index, row in enumerate(reader, start=2):
        code = _bulk_update_column(row, "Employee Code", "Code", "Emp Code")
        email = _bulk_update_column(row, "Email", "Ethara Email", "Official Email", "Personal Email")
        department = _bulk_update_column(row, "Department", "Dept", "Role")
        designation = _bulk_update_column(row, "Designation", "Title", "Job Title")
        date_of_joining = _bulk_update_column(
            row,
            "Date of Joining",
            "Joining Date",
            "DOJ",
            "DateOfJoining",
            "dateOfJoining",
        )
        vendor = _bulk_update_column(row, "Vendor", "Vendor Name", "Agency")
        work_mode = _bulk_update_column(
            row,
            "Work Mode",
            "WorkMode",
            "workMode",
            "Mode",
            "Location Mode",
        )
        new_code = (
            _bulk_update_column(row, "New Employee Code", "New Code")
            .upper()
            .replace(" ", "")
        )
        identifier = code or email or "(blank)"

        def reject(
            reason: str,
            *,
            row_index: int = index,
            row_identifier: str = identifier,
        ) -> None:
            nonlocal rejected
            rejected += 1
            results.append(
                {
                    "row": row_index,
                    "identifier": row_identifier,
                    "status": "rejected",
                    "reason": reason,
                }
            )

        if not any((code, email, department, designation, date_of_joining, vendor, work_mode, new_code)):
            continue
        employee = by_code.get(code.lower()) if code else None
        if employee is None and email:
            employee = by_email.get(email.lower())
        if employee is None:
            reject("Employee not found by code or email.")
            continue
        if not department and not designation and not date_of_joining and not vendor and not work_mode and not new_code:
            reject(
                "Nothing to update — provide Department, Designation, Date of Joining, "
                "Vendor, Work Mode, or New Employee Code."
            )
            continue
        parsed_joining_date = None
        if date_of_joining:
            parsed_joining_date = employee_service._safe_parse_sheet_date(date_of_joining)
            if parsed_joining_date is None:
                reject(
                    "Invalid Date of Joining. Use YYYY-MM-DD, DD/MM/YYYY, or DD-Mon-YYYY."
                )
                continue
        if new_code:
            if not EMPLOYEE_CODE_PATTERN.match(new_code):
                reject(
                    f"Invalid employee code '{new_code}' — expected format GRPXXXX "
                    "with no spaces."
                )
                continue
            existing = by_code.get(new_code.lower())
            if existing and existing.id != employee.id:
                reject(f"Employee code {new_code} is already in use by {existing.full_name}.")
                continue
            # Also reject if an active candidate / pre-registration row (other than this
            # employee's own linked candidate) already holds the code.
            own_candidate = employee_service._linked_candidate_for_profile(db, employee)
            holder = employee_service.find_employee_code_holder(
                db,
                new_code,
                exclude_profile_id=employee.id,
                exclude_candidate_id=own_candidate.id if own_candidate else None,
            )
            if holder is not None:
                reject(
                    f"Employee code {new_code} is already assigned to "
                    f"{holder.get('name') or holder.get('email') or 'another record'}."
                )
                continue

        changes: list[str] = []
        if department:
            employee.department = department
            changes.append(f"department={department}")
        if designation:
            employee.designation = designation
            changes.append(f"designation={designation}")
        if (
            parsed_joining_date is not None
            and parsed_joining_date != employee.date_of_joining
        ):
            employee.date_of_joining = parsed_joining_date
            changes.append(f"dateOfJoining={parsed_joining_date.date().isoformat()}")
        if vendor and vendor != (employee.vendor or ""):
            employee.vendor = vendor
            changes.append(f"vendor={vendor}")
        if work_mode and work_mode != (employee.work_mode or ""):
            employee.work_mode = work_mode
            changes.append(f"workMode={work_mode}")
        if new_code and new_code != (employee.employee_code or ""):
            old_code = str(employee.employee_code or "").strip().lower()
            if old_code:
                by_code.pop(old_code, None)
            # Route through the shared rename so the code propagates to the linked candidate
            # and every code-keyed module (ID card, leave, attendance, reimbursements) — a bare
            # assignment here is exactly what let candidate/employee codes drift apart before.
            employee_service.rename_employee_code(
                db, profile=employee, new_code=new_code, actor=current_user, request=None
            )
            by_code[new_code.lower()] = employee
            changes.append(f"employeeCode={new_code}")
        db.add(employee)
        updated += 1
        results.append({
            "row": index,
            "identifier": employee.employee_code or employee.full_name,
            "status": "updated",
            "reason": "; ".join(changes),
        })
    db.commit()
    return {"total": updated + rejected, "updated": updated, "rejected": rejected, "results": results}


@router.post("/aadhaar/ocr")
@limiter.limit("60/minute")
def extract_employee_aadhaar_card(
    request: Request,
    aadhaar_card: Annotated[UploadFile, File(alias="aadhaarCard")],
) -> dict:
    # Keep employee registration OCR behavior in lockstep with candidate registration.
    from app.api.routes.candidates import extract_aadhaar_fields

    return _run_employee_document_ocr(
        extract_aadhaar_fields,
        aadhaar_card,
        {
            "aadhaarNumber": None,
            "dateOfBirth": None,
            "cardHolderName": None,
            "ocrStatus": "needs_review",
            "message": "Could not process document. Please enter your Aadhaar details manually.",
        },
    )


@router.post("/pan/ocr")
@limiter.limit("60/minute")
def extract_employee_pan_card(
    request: Request,
    pan_card: Annotated[UploadFile, File(alias="panCard")],
) -> dict:
    # Keep employee PAN OCR behavior in lockstep with the shared document parsers.
    from app.api.routes.candidates import extract_pan_fields

    return _run_employee_document_ocr(
        extract_pan_fields,
        pan_card,
        {
            "panNumber": None,
            "ocrStatus": "needs_review",
            "message": "PAN details could not be extracted. Please upload a clearer PAN card image or enter the PAN manually.",
        },
    )


@router.post("/cheque/ocr")
@limiter.limit("60/minute")
def extract_employee_cancelled_cheque(
    request: Request,
    cancelled_cheque: Annotated[UploadFile, File(alias="cancelledCheque")],
) -> dict:
    from app.api.routes.candidates import extract_cheque_fields

    return _run_employee_document_ocr(
        extract_cheque_fields,
        cancelled_cheque,
        {
            "accountNumber": None,
            "ifscCode": None,
            "accountHolderName": None,
            "bankName": None,
            "ocrStatus": "needs_review",
            "message": "Could not extract bank details from this cheque. Please upload a clearer image or enter details manually.",
        },
    )


@router.post("/address/ocr")
@limiter.limit("60/minute")
def extract_employee_address_proof(
    request: Request,
    address_proof: Annotated[UploadFile, File(alias="addressProof")],
) -> dict:
    from app.api.routes.candidates import extract_address_fields

    return _run_employee_document_ocr(
        extract_address_fields,
        address_proof,
        {
            "address": None,
            "addressLines": [],
            "postalCode": None,
            "ocrStatus": "needs_review",
            "message": "Could not extract address from this document. Please upload a clearer address proof or enter the address manually.",
        },
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def register_employee(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    full_name: str = Form(alias="fullName"),
    ethara_email: str = Form(alias="etharaEmail"),
    personal_email: str = Form(alias="personalEmail"),
    employee_code: str = Form(alias="employeeCode"),
    phone: str = Form(),
    department: str = Form(),
    designation: str = Form(),
    gender: str = Form(),
    password: str = Form(min_length=8, max_length=128),
    aadhaar_number: str = Form(alias="aadhaarNumber"),
    date_of_birth: str | None = Form(default=None, alias="dateOfBirth"),
    aadhaar_card: Annotated[UploadFile | None, File(alias="aadhaarCard")] = None,
    resume: Annotated[UploadFile | None, File()] = None,
) -> dict:
    # Enforce the same password-strength rules used by reset/change flows (#45).
    try:
        validate_password_strength(password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    normalized_ethara = employee_service.normalize_email_value(ethara_email)
    normalized_personal = employee_service.normalize_email_value(personal_email)
    normalized_code = employee_service.normalize_employee_code(employee_code)
    normalized_aadhaar = aadhaar_number.replace(" ", "").replace("-", "")

    if not re.fullmatch(r"^[^\s@]+@ethara\.ai$", normalized_ethara):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Employee email must end with {ETHARA_EMAIL_DOMAIN}",
        )

    if not employee_service.EMPLOYEE_PERSONAL_EMAIL_PATTERN.fullmatch(normalized_personal):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid personal email address.",
        )

    if not normalized_code:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Employee code is required.",
        )

    if not re.match(r"^[6-9]\d{9}$", phone.replace(" ", "")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Phone must be a valid 10-digit Indian mobile number.",
        )

    if not re.match(r"^\d{12}$", normalized_aadhaar):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Aadhaar number must be exactly 12 digits.",
        )

    if len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters.",
        )

    if not department or not department.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Department is required.",
        )

    if not designation or not designation.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Designation is required.",
        )

    existing = db.scalar(select(User).where(func.lower(func.trim(User.email)) == normalized_ethara))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this Ethara email already exists.",
        )
    existing_profile = db.scalar(
        select(EmployeeProfile).where(
            (func.lower(func.trim(EmployeeProfile.ethara_email)) == normalized_ethara)
            | (EmployeeProfile.employee_code == normalized_code)
        )
    )
    if existing_profile:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An employee with this company email or employee code already exists.",
        )

    # A GRP code allocated to a candidate (at contract signing) must not be claimable by a
    # self-registering employee — otherwise it would hijack that candidate's conversion and
    # their attendance/reimbursement records (which key on employee code). Import-staging
    # codes are intentionally NOT rejected here: that's how a pre-loaded employee re-claims
    # their own code on registration.
    from app.db.models import Candidate as _Candidate

    if normalized_code and db.scalar(
        select(_Candidate.id).where(func.upper(_Candidate.employee_code) == normalized_code).limit(1)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This employee code is already assigned. Contact HR if you believe this is an error.",
        )

    ocr_result: dict = {}
    aadhaar_path: str | None = None
    aadhaar_validation: dict = {
        "validationStatus": "not_submitted",
        "ocrName": None,
        "mismatchReason": None,
    }

    if aadhaar_card and aadhaar_card.filename:
        content_type = (aadhaar_card.content_type or "").split(";")[0].lower()
        if content_type not in ALLOWED_AADHAAR_MIME:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid Documents — Aadhaar must be a PDF, JPG, PNG, or WEBP.",
            )
        doc_bytes = aadhaar_card.file.read()
        if len(doc_bytes) == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid Documents — Aadhaar file is empty.",
            )
        if len(doc_bytes) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid Documents — Aadhaar file must be under 10 MB.",
            )
        aadhaar_card.file.seek(0)

        try:
            from app.api.routes.candidates import extract_aadhaar_fields, validate_aadhaar_identity

            ocr_result = extract_aadhaar_fields(aadhaar_card)
        except Exception:
            ocr_result = {"ocrStatus": "needs_review"}

        aadhaar_validation = validate_aadhaar_identity(
            entered_name=full_name,
            entered_aadhaar=normalized_aadhaar,
            entered_dob=date_of_birth,
            ocr_result=ocr_result,
        )
        # For employee registration, HR has already verified identity.
        # A "failed" OCR match is flagged for manual review rather than blocking registration.
        # Only hard-block on number mismatch when the OCR clearly reads a different Aadhaar number.
        if aadhaar_validation["validationStatus"] == "failed":
            reason = aadhaar_validation.get("mismatchReason", "")
            if "aadhaar number" in reason.lower():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid Documents — Aadhaar number on the uploaded document does not match the entered number.",
                )
            # Name/DOB mismatches are flagged for HR review but do not block registration

        aadhaar_card.file.seek(0)
        try:
            aadhaar_path = _save_upload(aadhaar_card, "employee_aadhaar")
        except Exception:
            aadhaar_path = None

    resolved_date_of_birth = date_of_birth or ocr_result.get("dateOfBirth")

    resume_path: str | None = None
    if resume and resume.filename:
        content_type_r = (resume.content_type or "").split(";")[0].lower()
        if content_type_r not in ALLOWED_RESUME_MIME:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Resume must be a PDF or Word document.",
            )
        res_bytes = resume.file.read()
        if len(res_bytes) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Resume must be under 10 MB.",
            )
        resume.file.seek(0)
        try:
            resume_path = _save_upload(resume, "employee_resumes")
        except Exception:
            resume_path = None

    aadhaar_hash = fingerprint_identifier(normalized_aadhaar)

    try:
        user, profile = employee_service.create_employee_account(
            db,
            full_name=full_name,
            ethara_email=normalized_ethara,
            personal_email=normalized_personal,
            employee_code=normalized_code,
            phone=phone,
            department=department,
            designation=designation,
            gender=gender,
            password=password,
            aadhaar_hash=aadhaar_hash,
            aadhaar_last4=normalized_aadhaar[-4:],
            date_of_birth=resolved_date_of_birth,
            aadhaar_path=aadhaar_path,
            resume_path=resume_path,
            aadhaar_ocr_status=ocr_result.get("ocrStatus", "not_submitted"),
            aadhaar_ocr_match=bool(
                re.sub(r"\D", "", ocr_result.get("aadhaarNumber") or "") == normalized_aadhaar
                and normalized_aadhaar
            ),
            aadhaar_ocr_name=aadhaar_validation.get("ocrName"),
            aadhaar_validation_status=aadhaar_validation.get("validationStatus"),
            aadhaar_mismatch_reason=aadhaar_validation.get("mismatchReason"),
            aadhaar_extracted=ocr_result or None,
        )

        # Merge any pre-loaded HR sheet data (profile fields, selection form, documents,
        # vendor/status/work-mode) for this employee. No-op if nothing was staged. Creates
        # no account and sends no email.
        try:
            employee_service.apply_employee_import_staging(
                db,
                profile=profile,
                ethara_email=normalized_ethara,
                employee_code=normalized_code,
                personal_email=normalized_personal,
                phone=phone,
                actor=user,
            )
        except Exception:
            logger.exception("Failed to merge employee import staging for %s", normalized_ethara)

        # Require email verification before the account is active
        user.is_active = False
        user.email_verified_at = None
        db.add(user)

        audit = AuditLog(
            entity_type="employee_registration",
            entity_id=profile.id,
            action="registered",
            performed_by=user.id,
            performed_by_name=full_name.strip(),
            user_id=user.id,
            new_value={
                "fullName": full_name.strip(),
                "etharaEmail": normalized_ethara,
                "employeeCode": normalized_code,
                "personalEmail": normalized_personal,
                "phone": phone.strip(),
                "department": department.strip(),
                "designation": designation.strip(),
                "gender": gender.strip(),
                "resumePath": resume_path,
                "aadhaarPath": aadhaar_path,
                "aadhaarHash": aadhaar_hash,
                "aadhaarLast4": normalized_aadhaar[-4:],
                "dateOfBirth": resolved_date_of_birth,
                "ocrStatus": ocr_result.get("ocrStatus", "not_submitted"),
                "ocrAadhaarMatch": bool(
                    re.sub(r"\D", "", ocr_result.get("aadhaarNumber") or "") == normalized_aadhaar
                    and normalized_aadhaar
                ),
            },
        )
        db.add(audit)

        otp_result = account_security.request_email_verification(db, user=user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    return {
        "message": "Registration successful. Please verify your email to activate your account.",
        "requiresVerification": True,
        "email": normalized_ethara,
        "employeeCode": normalized_code,
        "developmentCode": otp_result.development_code,
        "expiresAt": otp_result.expires_at.isoformat() if otp_result.expires_at else None,
    }


def _generate_employee_temp_password() -> str:
    """Generate a 12-char temporary password with no predictable prefix.

    Guarantees at least one upper, one lower, one digit and one special
    character, then shuffles using a CSPRNG so the position of each class is
    not fixed.
    """
    uppers = string.ascii_uppercase
    lowers = string.ascii_lowercase
    digits = string.digits
    specials = "!@#$%^&*"
    pool = uppers + lowers + digits + specials

    chars = [
        secrets.choice(uppers),
        secrets.choice(lowers),
        secrets.choice(digits),
        secrets.choice(specials),
    ]
    chars += [secrets.choice(pool) for _ in range(8)]  # total length: 12
    # Fisher–Yates shuffle driven by secrets.randbelow (no fixed positions)
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)


def _send_employee_welcome_email(
    *,
    name: str,
    login_email: str,
    recipient_email: str,
    employee_code: str,
    temp_password: str,
) -> bool:
    """Send onboarding credentials to the employee's Ethara login email.

    Returns True on success, False on failure (logged).
    """
    from app.services.integrations import EmailService

    settings_obj = None
    try:
        from app.core.config import get_settings as _gs

        settings_obj = _gs()
    except Exception:
        pass

    portal_url = (
        getattr(settings_obj, "frontend_url", "https://app.ethara.ai")
        if settings_obj
        else "https://app.ethara.ai"
    )

    subject = "Welcome to Ethara - Your Login Credentials"
    body_text = (
        f"Hi {name},\n\n"
        f"Your Ethara employee account has been created. Here are your login credentials:\n\n"
        f"  Portal:           {portal_url}\n"
        f"  Email:            {login_email}\n"
        f"  Employee Code:    {employee_code}\n"
        f"  Temporary Demo Password: {temp_password}\n\n"
        f"Please log in and change your password immediately.\n\n"
        f"Best regards,\nEthara HR Team"
    )
    body_html = f"""
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a2e">
  <h2 style="margin-bottom:4px;color:#1a1a2e">Welcome to Ethara, {name}!</h2>
  <p style="color:#555;margin-top:0">Your employee account is ready. Use the credentials below to log in.</p>
  <table style="width:100%;border-collapse:collapse;margin:24px 0;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">
    <tr style="background:#f8fafc">
      <td style="padding:10px 16px;font-weight:600;color:#374151;font-size:13px;border-bottom:1px solid #e2e8f0">Portal URL</td>
      <td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e2e8f0"><a href="{portal_url}" style="color:#7c3aed">{portal_url}</a></td>
    </tr>
    <tr>
      <td style="padding:10px 16px;font-weight:600;color:#374151;font-size:13px;border-bottom:1px solid #e2e8f0">Email</td>
      <td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e2e8f0">{login_email}</td>
    </tr>
    <tr style="background:#f8fafc">
      <td style="padding:10px 16px;font-weight:600;color:#374151;font-size:13px;border-bottom:1px solid #e2e8f0">Employee Code</td>
      <td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e2e8f0">{employee_code}</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;font-weight:600;color:#374151;font-size:13px">Temporary Demo Password</td>
      <td style="padding:10px 16px;font-size:13px;font-family:monospace;letter-spacing:1px;font-weight:700;color:#7c3aed">{temp_password}</td>
    </tr>
  </table>
  <p style="font-size:13px;color:#ef4444;font-weight:600">Please change your password immediately after your first login.</p>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px">If you did not expect this email, please contact your HR department.</p>
</div>
"""
    try:
        EmailService().send_email(
            to_email=recipient_email,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
        )
        return True
    except Exception as exc:
        logger.warning(
            "Welcome email to %s (employee %s) failed: %s", recipient_email, employee_code, exc
        )
        return False


def _dispatch_welcome_emails(emails: list[tuple[str, str, str, str, str]]) -> None:
    """Background worker — send all welcome emails outside the request cycle."""
    sent = 0
    for name, login_email, recipient_email, emp_code, temp_password in emails:
        if _send_employee_welcome_email(
            name=name,
            login_email=login_email,
            recipient_email=recipient_email,
            employee_code=emp_code,
            temp_password=temp_password,
        ):
            sent += 1
    logger.info("Bulk welcome emails dispatched: %d/%d succeeded", sent, len(emails))


def _send_imported_employee_registration_reminder(*, row: EmployeeImportStaging) -> bool:
    from app.core.config import get_settings
    from app.services.integrations import EmailService

    recipient = (row.ethara_email or "").strip().lower()
    if not recipient:
        return False

    settings_obj = get_settings()
    registration_url = f"{settings_obj.frontend_url.rstrip('/')}/employee/register"
    profile_fields = row.profile_fields or {}
    name = str(profile_fields.get("full_name") or row.ethara_email or "employee").strip()
    employee_code = str(row.employee_code or "").strip()
    safe_name = html.escape(name)
    safe_email = html.escape(recipient)
    safe_code = html.escape(employee_code)
    safe_url = html.escape(registration_url, quote=True)

    body_text = (
        f"Dear {name},\n\n"
        "This is a gentle reminder to complete your registration on the Ethara HRMS portal.\n\n"
        f"Registration link: {registration_url}\n"
        f"Ethara email: {recipient}\n"
        + (f"Employee code: {employee_code}\n" if employee_code else "")
        + "\nCompleting your registration is mandatory to enable HR to verify your details and activate your portal access. "
        "Once activated, you will be able to access the HRMS dashboard and other employee services.\n\n"
        "We request you to complete the registration at the earliest to avoid any delays in accessing the platform.\n\n"
        "If you face any issues during the registration process, please fill the feedback form.\n\n"
        "Thank you for your cooperation.\n\n"
        "Regards,\nEthara HR Team"
    )
    body_html = f"""
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;color:#1f2937">
  <h2 style="margin:0 0 8px;color:#111827">Complete your Ethara HRMS registration</h2>
  <p>Dear {safe_name},</p>
  <p>This is a gentle reminder to complete your registration on the Ethara HRMS portal.</p>
  <p style="margin:24px 0">
    <a href="{safe_url}" style="display:inline-block;border-radius:8px;background:#7c3aed;color:#fff;padding:10px 16px;text-decoration:none;font-weight:600">Register on HRMS</a>
  </p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb">
    <tr>
      <td style="padding:10px 12px;background:#f9fafb;font-weight:600">Ethara email</td>
      <td style="padding:10px 12px">{safe_email}</td>
    </tr>
    <tr>
      <td style="padding:10px 12px;background:#f9fafb;font-weight:600">Employee code</td>
      <td style="padding:10px 12px">{safe_code or "-"}</td>
    </tr>
  </table>
  <p>Completing your registration is mandatory to enable HR to verify your details and activate your portal access. Once activated, you will be able to access the HRMS dashboard and other employee services.</p>
  <p>We request you to complete the registration at the earliest to avoid any delays in accessing the platform.</p>
  <p>If you face any issues during the registration process, please fill the feedback form.</p>
  <p>Thank you for your cooperation.</p>
</div>
"""
    try:
        EmailService().send_email(
            to_email=recipient,
            subject="Gentle reminder: Complete your Ethara HRMS registration",
            body_text=body_text,
            body_html=body_html,
        )
        return True
    except Exception as exc:
        logger.warning(
            "Employee registration reminder to %s (staging %s) failed: %s",
            recipient,
            row.id,
            exc,
        )
        return False


def _parse_csv_header(raw: str) -> str:
    return raw.strip().lower().replace(" ", "_").replace("-", "_").replace("/", "_")


def _pick(row: dict[str, str], *keys: str) -> str:
    for k in keys:
        v = row.get(k, "").strip()
        if v:
            return v
    return ""


@router.get("/identity-collisions")
def identity_collisions_report(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
) -> dict:
    """Monitoring report for the document cross-link root cause: any GRP employee code or
    Ethara email carried by more than one person (a candidate vs an employee whose name AND
    other identifier disagree). ``total == 0`` means the directory is clean."""
    return employee_service.scan_identity_collisions(db)


@router.post("/bulk-register", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def bulk_register_employees(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
    csv_file: Annotated[UploadFile, File(alias="csvFile")],
) -> dict:
    raw_bytes = csv_file.file.read()
    if len(raw_bytes) == 0:
        raise HTTPException(status_code=422, detail="CSV file is empty.")
    if len(raw_bytes) > MAX_BULK_CSV_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"CSV file is too large. Maximum allowed size is {MAX_BULK_CSV_BYTES // (1024 * 1024)} MB.",
        )
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=422, detail="CSV file appears empty or has no header row.")

    rows = [
        {_parse_csv_header(k): (v or "").strip() for k, v in row.items() if k} for row in reader
    ]

    if not rows:
        raise HTTPException(status_code=422, detail="CSV has no data rows.")
    if len(rows) > MAX_BULK_ROWS:
        raise HTTPException(
            status_code=422,
            detail=f"Too many rows ({len(rows)}). Please split the file into batches of at most {MAX_BULK_ROWS}.",
        )

    created_summaries: list[dict] = []
    failed_summaries: list[dict] = []
    # (name, login_email, recipient_email, employee_code, temp_password)
    emails_to_send: list[tuple[str, str, str, str, str]] = []
    seen_ethara: dict[str, int] = {}  # normalized company email -> first row number in this file
    seen_code: dict[str, int] = {}    # normalized employee code -> first row number in this file

    for idx, row in enumerate(rows):
        row_num = idx + 2

        name = _pick(row, "name", "full_name", "fullname", "employee_name")
        ethara_email = _pick(row, "company_email", "ethara_email", "email", "work_email")
        emp_code = _pick(row, "employee_code", "emp_code", "code", "employee_id")
        personal = _pick(row, "personal_email", "personal", "private_email")
        phone = _pick(row, "phone", "phone_number", "mobile", "contact")
        department = _pick(row, "department", "dept", "team")
        designation = _pick(row, "designation", "job_title", "title", "position", "role")
        gender = _pick(row, "gender", "sex")

        errors: list[str] = []
        if not name:
            errors.append("Name is required")
        if not ethara_email:
            errors.append("Company email is required")
        elif not re.fullmatch(r"^[^\s@]+@ethara\.ai$", ethara_email.strip().lower()):
            errors.append(f"Company email must end with {ETHARA_EMAIL_DOMAIN}")
        if not emp_code:
            errors.append("Employee code is required")

        if errors:
            failed_summaries.append(
                {
                    "row": row_num,
                    "name": name,
                    "email": ethara_email,
                    "employeeCode": emp_code,
                    "errors": errors,
                }
            )
            continue

        normalized_email = ethara_email.lower().strip()
        normalized_code = employee_service.normalize_employee_code(emp_code)

        # Reject rows that repeat a company email / employee code already used earlier in the
        # SAME file — otherwise the second row would collide at the DB unique constraint or
        # (worse) two people would fight over one identity.
        dup_errors: list[str] = []
        if normalized_email in seen_ethara:
            dup_errors.append(f"Duplicate company email in this file (see row {seen_ethara[normalized_email]})")
        if normalized_code in seen_code:
            dup_errors.append(f"Duplicate employee code in this file (see row {seen_code[normalized_code]})")
        if dup_errors:
            failed_summaries.append(
                {"row": row_num, "name": name, "email": ethara_email,
                 "employeeCode": emp_code, "errors": dup_errors}
            )
            continue
        seen_ethara[normalized_email] = row_num
        seen_code[normalized_code] = row_num

        temp_password = _generate_employee_temp_password()

        try:
            sp = db.begin_nested()

            existing_user = db.scalar(
                select(User).where(func.lower(func.trim(User.email)) == normalized_email)
            )
            if existing_user:
                raise ValueError("An account with this email already exists")

            existing_profile = db.scalar(
                select(EmployeeProfile).where(
                    (func.lower(EmployeeProfile.ethara_email) == normalized_email)
                    | (func.upper(func.trim(EmployeeProfile.employee_code)) == normalized_code)
                )
            )
            if existing_profile:
                raise ValueError("An employee with this email or employee code already exists")

            # Cross-link guard: refuse when this company email / GRP code is already tied to a
            # DIFFERENT person's candidate record. This is the exact root cause of the 2026
            # document cross-link incident — one person's Ethara ID stamped onto another.
            conflict_cand = db.scalar(
                select(Candidate).where(
                    (func.lower(func.trim(Candidate.ethara_email)) == normalized_email)
                    | (func.upper(func.trim(Candidate.employee_code)) == normalized_code)
                ).where(Candidate.is_removed.is_(False))
            )
            if conflict_cand is not None:
                row_name = " ".join((name or "").lower().split())
                cand_name = " ".join((conflict_cand.full_name or "").lower().split())
                row_personal = (personal or "").strip().lower()
                cand_personal = (conflict_cand.personal_email or "").strip().lower()
                same_person = (
                    (row_personal and row_personal == cand_personal)
                    or (row_name and row_name == cand_name)
                )
                if not same_person:
                    raise ValueError(
                        "Company email or employee code already belongs to a different person's "
                        f"candidate record: {conflict_cand.full_name} ({conflict_cand.candidate_code})"
                    )

            user, profile = employee_service.create_employee_account(
                db,
                full_name=name,
                ethara_email=normalized_email,
                personal_email=personal.lower() if personal else "",
                employee_code=normalized_code,
                phone=phone or "",
                department=department or "",
                designation=designation or "",
                gender=gender or "",
                password=temp_password,
            )
            user.must_change_password = True
            db.add(user)

            db.add(
                AuditLog(
                    entity_type="employee_registration",
                    entity_id=profile.id,
                    action="bulk_registered",
                    performed_by=current_user.id,
                    performed_by_name=current_user.name or current_user.email,
                    user_id=user.id,
                    new_value={
                        "fullName": name,
                        "etharaEmail": normalized_email,
                        "employeeCode": normalized_code,
                        "department": department,
                        "designation": designation,
                        "bulkImport": True,
                    },
                )
            )
            reconciliation = employee_service.reconcile_candidate_it_request_for_employee_profile(
                db,
                profile=profile,
                actor=current_user,
            )
            db.flush()
            sp.commit()

            # Bulk-imported employees receive credentials on the same
            # @ethara.ai account they must use to log in.
            recipient_email = normalized_email
            emails_to_send.append(
                (name, normalized_email, recipient_email, normalized_code, temp_password)
            )
            created_summaries.append(
                {
                    "name": name,
                    "email": normalized_email,
                    "employeeCode": normalized_code,
                    "department": department or "",
                    "designation": designation or "",
                    "candidateId": reconciliation["candidateId"],
                    "itRequestCompleted": reconciliation["itRequestCompleted"],
                    "backfilledDocumentCount": reconciliation["backfilledDocumentCount"],
                    "employeeSelectionFormStatus": reconciliation["employeeSelectionFormStatus"],
                    "credentialsSentTo": recipient_email,
                }
            )

        except IntegrityError:
            sp.rollback()
            failed_summaries.append(
                {
                    "row": row_num,
                    "name": name,
                    "email": ethara_email,
                    "employeeCode": emp_code,
                    "errors": ["A duplicate email or employee code was detected"],
                }
            )
        except ValueError as exc:
            sp.rollback()
            failed_summaries.append(
                {
                    "row": row_num,
                    "name": name,
                    "email": ethara_email,
                    "employeeCode": emp_code,
                    "errors": [str(exc)],
                }
            )
        except Exception as exc:
            sp.rollback()
            failed_summaries.append(
                {
                    "row": row_num,
                    "name": name,
                    "email": ethara_email,
                    "employeeCode": emp_code,
                    "errors": [str(exc)],
                }
            )

    db.commit()

    # Send credentials off the request thread so a large batch can't time the
    # HTTP request out. Failures are logged inside the worker.
    if emails_to_send:
        background_tasks.add_task(_dispatch_welcome_emails, emails_to_send)

    return {
        "total": len(rows),
        "created": len(created_summaries),
        "failed": len(failed_summaries),
        "emailsQueued": len(emails_to_send),
        "results": created_summaries,
        "errors": failed_summaries,
    }


@router.post("/verify-email")
@limiter.limit("10/minute")
def verify_employee_email(
    request: Request,
    payload: EmployeeEmailVerifyRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Verify the OTP sent to an employee's Ethara email and activate their account."""
    from app.services.auth import normalize_email as _normalize_email

    normalized = _normalize_email(payload.email)
    user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == normalized))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found for this email address.",
        )
    if user.is_active and user.email_verified_at:
        return {"message": "Email is already verified. You can log in."}

    account_security.confirm_email_verification(db, user=user, code=payload.code)
    user.is_active = True
    db.add(user)
    db.commit()

    return {"message": "Email verified successfully. Your account is now active."}


@router.post("/resend-verification")
@limiter.limit("5/minute")
def resend_employee_verification(
    request: Request,
    payload: EmployeeResendVerificationRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Resend the email verification OTP for an employee who has not yet verified their account."""
    from app.services.auth import normalize_email as _normalize_email

    normalized = _normalize_email(payload.email)
    user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == normalized))
    if user is None:
        # Avoid email enumeration — silently succeed
        return {"message": "If that email is registered, a verification code has been sent."}
    if user.email_verified_at:
        return {"message": "This email address is already verified. You can log in."}

    otp_result = account_security.request_email_verification(db, user=user)
    db.commit()

    return {
        "message": otp_result.message,
        "developmentCode": otp_result.development_code,
        "expiresAt": otp_result.expires_at.isoformat() if otp_result.expires_at else None,
    }


@router.post("/pending-activation/reminders")
@limiter.limit("3/minute")
def send_pending_employee_activation_reminders(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)

    sent = 0
    failed = 0
    skipped = 0
    pending_accounts = 0
    pending_imports = 0

    account_rows = db.execute(
        select(EmployeeProfile, User)
        .join(User, EmployeeProfile.user_id == User.id)
        .where(
            User.role != Role.LEADERSHIP,
            (User.is_active.is_(False)) | (User.email_verified_at.is_(None)),
        )
        .order_by(EmployeeProfile.created_at.desc())
    ).all()
    for _profile, user in account_rows:
        if not user.email:
            skipped += 1
            continue
        if user.email_verified_at:
            skipped += 1
            continue
        pending_accounts += 1
        try:
            account_security.request_email_verification(db, user=user)
            db.commit()
            sent += 1
        except Exception as exc:
            db.rollback()
            failed += 1
            logger.warning("Employee activation reminder to %s failed: %s", user.email, exc)

    existing_emails = {
        (email or "").strip().lower()
        for (email,) in db.execute(
            select(EmployeeProfile.ethara_email)
            .join(User, EmployeeProfile.user_id == User.id)
            .where(User.role != Role.LEADERSHIP)
        ).all()
        if email
    }
    import_rows = db.scalars(
        select(EmployeeImportStaging)
        .where(EmployeeImportStaging.status == "pending")
        .order_by(EmployeeImportStaging.created_at.desc())
    ).all()
    for row in import_rows:
        email = (row.ethara_email or "").strip().lower()
        if not email or email in existing_emails:
            skipped += 1
            continue
        pending_imports += 1
        if _send_imported_employee_registration_reminder(row=row):
            sent += 1
        else:
            failed += 1

    return {
        "message": f"Sent {sent} reminder{'' if sent == 1 else 's'}.",
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
        "pendingAccounts": pending_accounts,
        "pendingImports": pending_imports,
    }


@router.post("/issue-reminders")
@limiter.limit("10/minute")
def send_employee_issue_reminders(
    request: Request,
    payload: EmployeeIssueReminderRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)

    issue = payload.issue.strip().lower()
    config = EMPLOYEE_ISSUE_REMINDERS.get(issue)
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported reminder issue. Use one of: {', '.join(sorted(EMPLOYEE_ISSUE_REMINDERS))}.",
        )

    employee_ids: list[str] = []
    seen: set[str] = set()
    for raw_id in payload.employee_ids:
        employee_id = str(raw_id or "").strip()
        if employee_id and employee_id not in seen:
            seen.add(employee_id)
            employee_ids.append(employee_id)
    if not employee_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Select at least one employee.",
        )

    custom_message = (payload.message or "").strip()
    message = custom_message or str(config["message"])
    sent = 0
    skipped = 0
    failed = 0
    emails_sent = 0
    results: list[dict[str, str | None]] = []

    for employee_id in employee_ids:
        if employee_id.startswith("import:"):
            skipped += 1
            results.append(
                {
                    "employeeId": employee_id,
                    "status": "skipped",
                    "reason": "Employee has not activated an account yet. Use pending activation reminders.",
                }
            )
            continue

        profile = db.scalar(
            select(EmployeeProfile)
            .options(selectinload(EmployeeProfile.selection_form))
            .where(EmployeeProfile.id == employee_id)
        )
        if profile is None:
            skipped += 1
            results.append(
                {
                    "employeeId": employee_id,
                    "status": "skipped",
                    "reason": "Employee not found.",
                }
            )
            continue

        user = db.get(User, profile.user_id) if profile.user_id else None
        if user is None:
            skipped += 1
            results.append(
                {
                    "employeeId": employee_id,
                    "status": "skipped",
                    "reason": "Employee account is not active yet.",
                }
            )
            continue
        if not user.is_active or user.email_verified_at is None:
            skipped += 1
            results.append(
                {
                    "employeeId": employee_id,
                    "status": "skipped",
                    "reason": "Employee account is pending activation.",
                }
            )
            continue
        if not _employee_matches_issue(profile, issue):
            skipped += 1
            results.append(
                {
                    "employeeId": employee_id,
                    "status": "skipped",
                    "reason": "Employee no longer matches this issue.",
                }
            )
            continue

        entity_id = profile.id
        if issue == "selection_form_pending" and profile.selection_form is not None:
            entity_id = profile.selection_form.id

        try:
            title = str(config["title"])
            workflows.create_notification(
                db,
                user_id=user.id,
                title=title,
                message=message,
                type_=NotificationType.WARNING,
                entity_type=str(config["entity_type"]),
                entity_id=entity_id,
                payload={
                    "issue": issue,
                    "employeeId": profile.id,
                    "employeeCode": profile.employee_code,
                },
            )
            _send_employee_issue_reminder_email(
                profile=profile,
                user=user,
                issue=issue,
                title=title,
                message=message,
            )
            db.add(
                AuditLog(
                    entity_type="employee_issue_reminder",
                    entity_id=profile.id,
                    action="issue_reminder_sent",
                    performed_by=current_user.id,
                    performed_by_name=current_user.name or current_user.email,
                    user_id=user.id,
                    new_value={
                        "issue": issue,
                        "title": title,
                        "emailSent": True,
                        "emailTo": user.email or profile.ethara_email,
                    },
                )
            )
            db.commit()
            sent += 1
            emails_sent += 1
            results.append(
                {
                    "employeeId": employee_id,
                    "status": "sent",
                    "reason": None,
                }
            )
        except Exception as exc:
            db.rollback()
            failed += 1
            logger.warning("Employee issue reminder to %s failed: %s", profile.ethara_email, exc)
            results.append(
                {
                    "employeeId": employee_id,
                    "status": "failed",
                    "reason": "Could not send email reminder.",
                }
            )

    return {
        "message": f"Sent {sent} reminder{'' if sent == 1 else 's'}.",
        "issue": issue,
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
        "emailsSent": emails_sent,
        "results": results,
    }


@router.get("/compliance/forms")
def list_all_employee_compliance_forms(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_READ))],
):
    _assert_employee_staff(current_user)
    return employee_service.list_all_employee_compliance_records(db)


@router.get("/me/dashboard")
def employee_dashboard_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    payload = employee_service.get_employee_dashboard(db, user=current_user)
    db.commit()
    return payload


@router.get("/me/journey", response_model=list[EmployeeJourneyStageRead])
def employee_profile_journey(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    payload = employee_service.get_employee_dashboard(db, user=current_user)
    db.commit()
    return payload["profileJourney"]


@router.get("/me/selection-form", response_model=EmployeeSelectionFormRead)
def get_employee_selection_form(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    payload = employee_service.get_employee_selection_form_for_user(db, user=current_user)
    db.commit()
    return payload


@router.post("/me/selection-form", response_model=EmployeeSelectionFormRead)
def submit_employee_selection_form(
    payload: EmployeeSelectionFormSubmitRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    try:
        updated = employee_service.submit_employee_selection_form(
            db,
            user=current_user,
            form_data=payload.form_data,
        )
        db.commit()
        return updated
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/me/selection-form/draft", response_model=EmployeeSelectionFormRead)
def save_employee_selection_form_draft(
    payload: EmployeeSelectionFormSubmitRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    try:
        updated = employee_service.save_employee_selection_form_draft(
            db,
            user=current_user,
            form_data=payload.form_data,
        )
        db.commit()
        return updated
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/me/profile")
def update_my_employee_profile(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    full_name: str = Form(alias="fullName"),
    personal_email: str = Form(alias="personalEmail"),
    employee_code: str = Form(alias="employeeCode"),
    phone: str = Form(),
    department: str = Form(),
    designation: str = Form(),
    gender: str = Form(),
    resume: Annotated[UploadFile | None, File()] = None,
):
    _assert_employee_self(current_user)
    try:
        profile = employee_service.update_employee_self_profile(
            db,
            user=current_user,
            full_name=full_name,
            personal_email=personal_email,
            employee_code=employee_code,
            phone=phone,
            department=department,
            designation=designation,
            gender=gender,
        )

        if resume and resume.filename:
            content_type = (resume.content_type or "").split(";")[0].lower()
            if content_type not in ALLOWED_RESUME_MIME:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Resume must be a PDF or Word document.",
                )
            resume_bytes = resume.file.read()
            if len(resume_bytes) == 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Resume file appears to be empty.",
                )
            if len(resume_bytes) > MAX_FILE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Resume must be under 10 MB.",
                )
            resume.file.seek(0)
            employee_service.upload_employee_document_for_profile(
                db,
                profile=profile,
                actor=current_user,
                file=resume,
                type_="resume",
                endpoint_scope="self",
            )

        db.commit()
        db.refresh(current_user)
        db.refresh(profile)
        return employee_service.serialize_employee_profile(profile)
    except ValueError as exc:
        db.rollback()
        detail = str(exc)
        if detail == "Employee profile not found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
        if "already exists" in detail:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail
        ) from exc


@router.get("/me/documents", response_model=list[EmployeeDocumentRead])
def list_my_documents(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    profile = employee_service.get_employee_profile_for_user(db, current_user)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found"
        )
    return employee_service.list_employee_documents(db, profile=profile, endpoint_scope="self")


@router.post("/me/documents/upload", response_model=EmployeeDocumentRead)
def upload_my_document(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    type: Annotated[str, Form()],
    file: UploadFile = File(...),
):
    _assert_employee_self(current_user)
    try:
        document = employee_service.upload_employee_document(
            db,
            user=current_user,
            file=file,
            type_=type,
        )
        db.commit()
        return document
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/me/documents/verify")
@limiter.limit("60/minute")
def verify_my_document(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    document_type: Annotated[str, Form(alias="documentType")],
    file: UploadFile = File(...),
) -> dict:
    # Stateless AI document-type check shown as a non-blocking hint when a file is
    # selected on the selection form (does not store anything).
    _assert_employee_self(current_user)
    return employee_service.verify_document_type(file=file, document_type=document_type)


@router.get("/me/documents/{document_id}/preview")
def preview_my_document(
    document_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    profile = employee_service.get_employee_profile_for_user(db, current_user)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found"
        )
    path, file_name, mime_type = employee_service.get_employee_document_for_download(
        db,
        profile=profile,
        document_ref=document_id,
    )
    if path is None or file_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if isinstance(path, str):
        resolved_mime = _inline_preview_mime(Path(file_name), mime_type)
        if resolved_mime not in _SAFE_INLINE_MIME:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This document type cannot be previewed inline.",
            )
        return RedirectResponse(path)
    resolved_mime = _inline_preview_mime(path, mime_type)
    if resolved_mime not in {"application/pdf", "image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This document type cannot be previewed inline.",
        )
    return FileResponse(
        path=str(path),
        media_type=resolved_mime,
        filename=file_name,
        content_disposition_type="inline",
    )


@router.get("/me/documents/{document_id}/download")
def download_my_document(
    document_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    profile = employee_service.get_employee_profile_for_user(db, current_user)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found"
        )
    path, file_name, mime_type = employee_service.get_employee_document_for_download(
        db,
        profile=profile,
        document_ref=document_id,
    )
    if path is None or file_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if isinstance(path, str):
        return RedirectResponse(path)
    return FileResponse(
        path=str(path),
        filename=file_name,
        media_type="application/octet-stream",
    )


@router.delete("/me/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_document(
    document_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Delete an employee's own document (removes the file record and the stored file)."""
    _assert_employee_self(current_user)
    profile = employee_service.get_employee_profile_for_user(db, current_user)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found"
        )
    # Guardrail: an employee may delete only documents they uploaded themselves,
    # never system-/HR-backfilled onboarding records (these belong to the org and
    # may share files with the candidate record). Legacy resume/aadhaar refs are
    # profile fields rather than document rows, so db.get returns None and they
    # remain self-manageable. HR/admin deletion goes through a separate route.
    _existing = db.get(EmployeeDocument, document_id)
    if (
        _existing is not None
        and _existing.employee_profile_id == profile.id
        and _existing.uploaded_by != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete documents you uploaded. Please contact HR to change other documents.",
        )
    try:
        employee_service.delete_employee_document(
            db,
            profile=profile,
            actor=current_user,
            document_ref=document_id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/me/contracts", response_model=list[EmployeeContractRead])
def list_my_contracts(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    try:
        contracts = employee_service.get_employee_contract_records(db, user=current_user)
        db.commit()
        return contracts
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/me/contracts/{contract_id}/preview")
def preview_my_contract(
    contract_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    try:
        _, record, path = employee_service.get_employee_contract_download(
            db,
            user=current_user,
            contract_id=contract_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract file not found")
    resolved_mime = _inline_preview_mime(path, record.mime_type)
    if resolved_mime not in {"application/pdf", "image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This contract cannot be previewed inline.",
        )
    return FileResponse(
        path=str(path),
        media_type=resolved_mime,
        filename=record.file_name or path.name,
        content_disposition_type="inline",
    )


@router.get("/me/contracts/{contract_id}/download")
def download_my_contract(
    contract_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    try:
        _, record, path = employee_service.get_employee_contract_download(
            db,
            user=current_user,
            contract_id=contract_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract file not found")
    return FileResponse(
        path=str(path),
        filename=record.file_name or path.name,
        media_type=record.mime_type or "application/octet-stream",
    )


@router.get("/me/compliance", response_model=list[EmployeeComplianceFormRead])
def list_my_compliance_forms(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    try:
        forms = employee_service.get_employee_compliance_records(db, user=current_user)
        db.commit()
        return forms
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/me/compliance/refresh-esign", response_model=list[EmployeeComplianceFormRead])
def refresh_my_compliance_esign(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Employee pulls the latest signing status of their Documenso compliance forms."""
    _assert_employee_self(current_user)
    profile = employee_service.get_employee_profile_for_user(db, current_user)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found")
    # Refresh signing status and, if all forms are signed, advance the journey
    # (compliance verified → onboarding completed).
    compliance_esign.sync_and_advance(db, profile=profile)
    db.commit()
    return employee_service.get_employee_compliance_records(db, user=current_user)


@router.post(
    "/{employee_id}/compliance/send-esign",
    response_model=list[EmployeeComplianceFormRead],
)
def send_employee_compliance_esign(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    """HR/Admin: send the Documenso statutory compliance forms (Form 11 / Form 2 / Form F)
    to the employee's Ethara email for e-signature. Requires the Ethara email to exist."""
    _assert_employee_staff(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    try:
        forms = compliance_esign.send_compliance_forms(db, profile=profile, actor_id=current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("compliance e-sign send failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Documenso error: {exc}") from exc
    db.commit()
    return [employee_service._serialize_compliance_form(f) for f in forms]


@router.post("/me/compliance/{form_id}/submit", response_model=EmployeeComplianceFormRead)
def submit_my_compliance_form(
    form_id: str,
    payload: EmployeeSelectionFormSubmitRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    try:
        updated = employee_service.submit_employee_compliance_form(
            db,
            user=current_user,
            form_id=form_id,
            form_data=payload.form_data,
        )
        db.commit()
        return updated
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/me/referrals", response_model=list[EmployeeReferralActivityRead])
def list_my_referrals(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _assert_employee_self(current_user)
    return employee_service.list_employee_referrals_for_user(db, user=current_user)


@router.post("/me/referrals", response_model=EmployeeReferralActivityRead)
def create_my_referral(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    full_name: Annotated[str, Form(alias="fullName")],
    personal_email: Annotated[str, Form(alias="personalEmail")],
    phone: Annotated[str, Form()],
    resume: Annotated[UploadFile, File()],
    linkedin_url: Annotated[str | None, Form(alias="linkedinUrl")] = None,
    portfolio_url: Annotated[str | None, Form(alias="portfolioUrl")] = None,
    github_url: Annotated[str | None, Form(alias="githubUrl")] = None,
    position_id: Annotated[str | None, Form(alias="positionId")] = None,
):
    _assert_employee_self(current_user)
    resume_size, resume_mime_type = _validate_required_resume_upload(resume)
    resume_url, resume_storage_path = _save_required_resume_upload(resume)
    try:
        referral = employee_service.create_employee_referral(
            db,
            user=current_user,
            full_name=full_name,
            personal_email=personal_email,
            phone=phone,
            linkedin_url=linkedin_url,
            portfolio_url=portfolio_url,
            github_url=github_url,
            position_id=position_id,
            resume_file_name=Path(resume.filename or "resume").name,
            resume_url=resume_url,
            resume_storage_path=resume_storage_path,
            resume_mime_type=resume_mime_type,
            resume_size=resume_size,
        )
        db.commit()
        return referral
    except ValueError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get("/list")
def list_employees(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
    search: str | None = None,
) -> list[dict]:
    _assert_employee_staff(current_user)
    repaired = employee_service.repair_employee_auth_records(db)
    if repaired:
        db.commit()

    query = (
        select(EmployeeProfile, User)
        .join(
            User,
            EmployeeProfile.user_id == User.id,
            isouter=True,
        )
        .options(selectinload(EmployeeProfile.selection_form))
        # Show every account that has an employee profile EXCEPT leadership (e.g. an
        # admin/HR who is also a listed employee should appear here; leadership is hidden).
        .where(User.role != Role.LEADERSHIP)
    )

    if search:
        q = f"%{search.lower()}%"
        query = query.where(
            func.lower(EmployeeProfile.full_name).like(q)
            | func.lower(EmployeeProfile.ethara_email).like(q)
            | func.lower(func.coalesce(EmployeeProfile.personal_email, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employee_code, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.department, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.designation, "")).like(q)
        )

    rows = db.execute(query.order_by(EmployeeProfile.created_at.desc())).unique().all()

    results = []
    for profile_row, user_row in rows:
        linked_candidate = _linked_candidate_for_employee_profile(db, profile_row)
        date_of_birth = _employee_profile_date(profile_row, "date_of_birth", "dateOfBirth")
        selection_form = profile_row.selection_form
        results.append(
            {
                "id": profile_row.id,
                "accessLevel": "full",
                "canOpenDetail": True,
                "userId": user_row.id if user_row else None,
                "name": _employee_profile_text(profile_row, "full_name", "employeeName"),
                "etharaEmail": profile_row.ethara_email,
                "personalEmail": _employee_profile_text(profile_row, "personal_email", "personalEmail"),
                "phone": _employee_profile_text(profile_row, "phone", "contactNumber"),
                "employeeCode": profile_row.employee_code,
                "department": _employee_profile_text(profile_row, "department", "department"),
                "designation": _employee_profile_text(profile_row, "designation", "designation"),
                "gender": _employee_profile_text(profile_row, "gender", "gender"),
                "aadhaarLast4": profile_row.aadhaar_last4,
                "aadhaarPath": profile_row.aadhaar_path,
                "aadhaarOcrStatus": profile_row.aadhaar_ocr_status,
                "aadhaarValidationStatus": profile_row.aadhaar_validation_status,
                "aadhaarMismatchReason": profile_row.aadhaar_mismatch_reason,
                "dateOfBirth": date_of_birth.isoformat() if date_of_birth else None,
                "resumePath": profile_row.resume_path,
                "isActive": user_row.is_active if user_row else False,
                "registrationStatus": _employee_registration_status(user_row, linked_candidate),
                "candidateStage": (
                    linked_candidate.current_stage.value
                    if linked_candidate and hasattr(linked_candidate.current_stage, "value")
                    else str(linked_candidate.current_stage)
                    if linked_candidate
                    else None
                ),
                "candidateStatus": linked_candidate.current_status if linked_candidate else None,
                "editAccessEnabled": employee_service.employee_edit_access_enabled(db, profile_row),
                "selectionFormStatus": selection_form.status if selection_form else "not_started",
                "selectionFormSubmittedAt": selection_form.submitted_at.isoformat()
                if selection_form and selection_form.submitted_at
                else None,
                "createdAt": profile_row.created_at.isoformat() if profile_row.created_at else None,
                "managerId": profile_row.manager_id,
                "bloodGroup": _employee_profile_text(profile_row, "blood_group", "bloodGroup"),
                "emergencyContactName": _employee_profile_text(
                    profile_row,
                    "emergency_contact_name",
                    "emergencyContactName",
                ),
                "emergencyContactPhone": _employee_profile_text(
                    profile_row,
                    "emergency_contact_phone",
                    "emergencyContactPhone",
                ),
                "vendor": profile_row.vendor,
                "employmentStatus": profile_row.employment_status,
                "workMode": profile_row.work_mode,
                "dateOfJoining": profile_row.date_of_joining.isoformat()
                if profile_row.date_of_joining
                else None,
            }
        )

    for r in results:
        mgr_id = r.get("managerId")
        if mgr_id:
            mgr = db.get(User, mgr_id)
            r["managerName"] = mgr.name if mgr else None
            r["managerEmail"] = mgr.email if mgr else None
        else:
            r["managerName"] = None
            r["managerEmail"] = None

    # Pre-loaded (sheet-imported) employees who haven't registered yet, shown as read-only
    # "pending registration" rows so the roster reflects the full headcount.
    imported_pending = employee_service.list_pending_imported_employees(db, search=search)
    results.extend(imported_pending)

    if not _has_employee_full_detail_access(current_user):
        allowed_preview_fields = {
            "id",
            "accessLevel",
            "canOpenDetail",
            "userId",
            "name",
            "etharaEmail",
            "phone",
            "employeeCode",
            "department",
            "designation",
            "isActive",
            "editAccessEnabled",
            "aadhaarOcrStatus",
            "aadhaarValidationStatus",
            "selectionFormStatus",
            "selectionFormSubmittedAt",
            "createdAt",
            "registrationStatus",
            "candidateStage",
            "candidateStatus",
            "dateOfJoining",
            "workMode",
            "employmentStatus",
        }
        if _has_any_role(current_user, EMPLOYEE_USER_EXPORT_ROLES):
            allowed_preview_fields.add("personalEmail")
        results = [
            {
                **{key: value for key, value in row.items() if key in allowed_preview_fields},
                "accessLevel": "preview" if row.get("accessLevel") != "imported" else "imported",
                "canOpenDetail": False,
            }
            for row in results
        ]

    return results


@router.get("/export/users")
def export_employee_user_details_csv(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
    search: str | None = None,
    lifecycle: Annotated[str, Query(pattern="^(all|active|pending_activation|offboarded)$")] = "all",
    department: str | None = None,
    work_mode: Annotated[str | None, Query(alias="workMode")] = None,
    issue: Annotated[str, Query(pattern="^(all|selection_form_pending|aadhaar_needs_review|aadhaar_not_submitted)$")] = "all",
    joining_from: Annotated[str | None, Query(alias="joiningFrom")] = None,
    joining_to: Annotated[str | None, Query(alias="joiningTo")] = None,
    sort_by: Annotated[str, Query(alias="sortBy", pattern="^(joining_desc|joining_asc|created_desc|name_asc)$")] = "joining_desc",
    employee_ids: Annotated[str | None, Query(alias="employeeIds")] = None,
):
    """Export user provisioning details without document/Aadhaar/PMS payloads."""
    import csv as _csv
    from io import StringIO

    from fastapi.responses import Response
    from sqlalchemy.orm import joinedload, selectinload

    _assert_employee_staff(current_user)
    _assert_employee_user_export_access(current_user)
    repaired = employee_service.repair_employee_auth_records(db)
    if repaired:
        db.commit()

    def _csv_safe(value):
        text = "" if value is None else str(value)
        if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
            return "'" + text
        return text

    def _fmt_dt(value):
        return format_app_datetime(value) if value else ""

    query = (
        select(EmployeeProfile)
        .join(User, EmployeeProfile.user_id == User.id, isouter=True)
        .options(
            joinedload(EmployeeProfile.user),
            selectinload(EmployeeProfile.selection_form),
        )
        .where(or_(User.id.is_(None), User.role != Role.LEADERSHIP))
        .order_by(EmployeeProfile.created_at.desc())
    )
    if search:
        q = f"%{search.lower()}%"
        query = query.where(
            func.lower(EmployeeProfile.full_name).like(q)
            | func.lower(EmployeeProfile.ethara_email).like(q)
            | func.lower(func.coalesce(EmployeeProfile.personal_email, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employee_code, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.department, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.designation, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.vendor, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.work_mode, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employment_status, "")).like(q)
        )

    selected_employee_ids = _parse_employee_id_filter(employee_ids)
    if selected_employee_ids:
        query = query.where(EmployeeProfile.id.in_(selected_employee_ids))

    joining_from_date = _parse_export_filter_date(joining_from)
    joining_to_date = _parse_export_filter_date(joining_to)
    profiles = [
        profile
        for profile in db.scalars(query).unique()
        if _employee_matches_export_filters(
            db,
            profile,
            profile.user,
            lifecycle=lifecycle,
            department=department,
            work_mode=work_mode,
            issue=issue,
            joining_from=joining_from_date,
            joining_to=joining_to_date,
        )
    ]
    profiles = _sort_employee_profiles(profiles, sort_by)
    imported_pending_rows = (
        [
            row
            for row in employee_service.list_pending_imported_employees(db, search=search)
            if _imported_row_matches_export_filters(
                row,
                lifecycle=lifecycle,
                department=department,
                work_mode=work_mode,
                issue=issue,
                joining_from=joining_from_date,
                joining_to=joining_to_date,
            )
        ]
        if not selected_employee_ids and lifecycle in {"all", "pending_activation", "offboarded"}
        else []
    )

    header = [
        "Name",
        "Company Email",
        "Employee Code",
        "Personal Email",
        "Phone",
        "Department",
        "Designation",
        "Gender",
        "Registration Status",
        "Lifecycle",
        "Candidate Stage",
        "Candidate Status",
        "User Active",
        "Date of Joining",
        "Work Mode",
        "Employment Status",
        "Created",
    ]
    buffer = StringIO()
    writer = _csv.writer(buffer)
    writer.writerow([_csv_safe(col) for col in header])

    for profile in profiles:
        user = profile.user
        linked_candidate = _linked_candidate_for_employee_profile(db, profile)
        row = [
            _employee_profile_text(profile, "full_name", "employeeName"),
            profile.ethara_email or "",
            profile.employee_code or "",
            _employee_profile_text(profile, "personal_email", "personalEmail"),
            _employee_profile_text(profile, "phone", "contactNumber"),
            _employee_profile_text(profile, "department", "department"),
            _employee_profile_text(profile, "designation", "designation"),
            _employee_profile_text(profile, "gender", "gender"),
            _employee_registration_status(user, linked_candidate),
            _employee_lifecycle(profile, user, linked_candidate),
            (
                linked_candidate.current_stage.value
                if linked_candidate and hasattr(linked_candidate.current_stage, "value")
                else str(linked_candidate.current_stage)
                if linked_candidate
                else ""
            ),
            linked_candidate.current_status if linked_candidate else "",
            "Yes" if user and user.is_active else "No",
            _fmt_dt(profile.date_of_joining),
            profile.work_mode or "",
            profile.employment_status or "",
            _fmt_dt(profile.created_at),
        ]
        writer.writerow([_csv_safe(cell) for cell in row])

    for row_data in imported_pending_rows:
        row = [
            row_data.get("name"),
            row_data.get("etharaEmail"),
            row_data.get("employeeCode"),
            row_data.get("personalEmail"),
            row_data.get("phone"),
            row_data.get("department"),
            row_data.get("designation"),
            row_data.get("gender"),
            row_data.get("registrationStatus") or "imported_pending",
            _imported_row_lifecycle(row_data),
            "",
            "",
            "No",
            row_data.get("dateOfJoining"),
            row_data.get("workMode"),
            row_data.get("employmentStatus"),
            row_data.get("createdAt"),
        ]
        writer.writerow([_csv_safe(cell) for cell in row])

    filename = f"employee_users_{app_date_stamp()}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store, no-cache, must-revalidate",
        },
    )


@router.get("/managers")
def list_available_managers(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
) -> list[dict]:
    assignable = {Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}
    assignable_values = {role.value for role in assignable}
    users = db.scalars(
        select(User)
        .where(User.is_active.is_(True))
        .order_by(User.name)
    ).all()
    managers = []
    for user in users:
        user_roles = {user.role.value if isinstance(user.role, Role) else str(user.role)}
        user_roles.update(str(role.value if isinstance(role, Role) else role) for role in (user.roles or []))
        if not (user_roles & assignable_values):
            continue
        display_role = next((role for role in ("manager", "leadership", "hr", "ta", "admin", "super_admin") if role in user_roles), str(user.role.value if isinstance(user.role, Role) else user.role))
        managers.append({"id": user.id, "name": user.name, "email": user.email, "role": display_role})
    return managers


@router.patch("/{employee_id}/compliance/{form_id}", response_model=EmployeeComplianceFormRead)
def review_employee_compliance(
    employee_id: str,
    form_id: str,
    payload: EmployeeComplianceReviewRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    _assert_employee_staff(current_user)
    try:
        updated = employee_service.review_employee_compliance_form(
            db,
            actor=current_user,
            employee_id=employee_id,
            form_id=form_id,
            status_value=payload.status,
            remarks=payload.remarks,
        )
        db.commit()
        return updated
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


def _send_document_escalation_email(
    db: Session,
    employee_profile: EmployeeProfile,
    pending_docs: list[EmployeeDocument],
) -> int:
    """Send escalation emails for an employee's overdue pending documents.

    Returns the number of email recipients successfully notified.
    """
    from app.services.integrations import EmailService

    if not pending_docs:
        return 0

    doc_names = ", ".join(doc.type for doc in pending_docs)
    employee_name = employee_profile.full_name
    employee_email = employee_profile.ethara_email

    subject = f"[Action Required] Pending Document Escalation – {employee_name}"
    body_text = (
        f"Hi,\n\n"
        f"This is an escalation notice for {employee_name} ({employee_email}).\n\n"
        f"The following document(s) have been in 'pending' status for more than 7 days:\n"
        f"  {doc_names}\n\n"
        "Please review and take the necessary action as soon as possible.\n\n"
        "– Ethara HRMS"
    )
    body_html = (
        f"<p>Hi,</p>"
        f"<p>This is an escalation notice for <strong>{employee_name}</strong> ({employee_email}).</p>"
        f"<p>The following document(s) have been in <strong>pending</strong> status for more than 7 days:</p>"
        f"<ul>{''.join(f'<li>{doc.type}</li>' for doc in pending_docs)}</ul>"
        "<p>Please review and take the necessary action as soon as possible.</p>"
        "<p>– Ethara HRMS</p>"
    )

    email_service = EmailService()
    recipients: list[str] = []

    # Employee
    if employee_email:
        recipients.append(employee_email)

    # All HR and Admin users
    staff_users = db.scalars(
        select(User).where(
            User.role.in_([Role.HR, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP]),
            User.is_active.is_(True),
        )
    ).all()
    for u in staff_users:
        if u.email and u.email not in recipients:
            recipients.append(u.email)

    # Manager (via EmployeeProfile.manager_id)
    if employee_profile.manager_id:
        manager = db.get(User, employee_profile.manager_id)
        if manager and manager.email and manager.email not in recipients:
            recipients.append(manager.email)

    sent = 0
    for email_addr in recipients:
        try:
            email_service.send_email(
                to_email=email_addr,
                subject=subject,
                body_text=body_text,
                body_html=body_html,
            )
            sent += 1
        except Exception:
            pass

    return sent


@router.post("/{employee_id}/check-document-escalation")
def check_document_escalation(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ESCALATIONS_WRITE))],
) -> dict:
    """Check for pending documents older than 7 days and send escalation emails.

    Requires HR or Admin role.
    """
    _assert_employee_staff(current_user)

    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)

    try:
        pending_docs = db.scalars(
            select(EmployeeDocument).where(
                EmployeeDocument.employee_profile_id == profile.id,
                EmployeeDocument.status == "pending",
                EmployeeDocument.created_at < cutoff,
            )
        ).all()

        escalation_count = 0
        if pending_docs:
            escalation_count = _send_document_escalation_email(db, profile, list(pending_docs))

        return {
            "employeeId": employee_id,
            "pendingDocumentsFound": len(list(pending_docs)) if pending_docs else 0,
            "escalationsTriggered": escalation_count,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process document escalation: {exc}",
        ) from exc


@router.get("/export")
def export_employees_csv(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
    search: str | None = None,
    lifecycle: Annotated[str, Query(pattern="^(all|active|pending_activation|offboarded)$")] = "all",
    department: str | None = None,
    work_mode: Annotated[str | None, Query(alias="workMode")] = None,
    issue: Annotated[str, Query(pattern="^(all|selection_form_pending|aadhaar_needs_review|aadhaar_not_submitted)$")] = "all",
    joining_from: Annotated[str | None, Query(alias="joiningFrom")] = None,
    joining_to: Annotated[str | None, Query(alias="joiningTo")] = None,
    sort_by: Annotated[str, Query(alias="sortBy", pattern="^(joining_desc|joining_asc|created_desc|name_asc)$")] = "joining_desc",
    employee_ids: Annotated[str | None, Query(alias="employeeIds")] = None,
):
    """Server-side CSV export of employees with EVERY profile field plus signed,
    openable links to each uploaded document (resume, Aadhaar, contracts, and any
    other documents). Staff-only, mirroring the employee list."""
    import csv as _csv
    import json as _json
    from io import StringIO

    from fastapi.responses import Response
    from sqlalchemy import or_
    from sqlalchemy.orm import joinedload, selectinload

    from app.core.signed_urls import make_signed_upload_url
    from app.db.models import Candidate, CandidateAssessment, Evaluation, PmsEvaluation

    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    repaired = employee_service.repair_employee_auth_records(db)
    if repaired:
        db.commit()

    # This export contains full profile fields and document links, so it follows
    # the same Admin / HR / TA full-detail gate as the employee detail page.
    aadhaar_full_allowed = _has_employee_full_detail_access(current_user)
    pms_export_allowed = _has_any_role(current_user, {Role.SUPER_ADMIN, Role.ADMIN, Role.HR})
    evaluation_export_allowed = _has_any_role(current_user, {
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.LEADERSHIP,
        Role.HR,
        Role.TA,
    })

    # Spreadsheet/CSV-injection defence: if a string cell begins with a formula
    # trigger character, prefix a single quote so the value is treated as text
    # when opened in Excel / Google Sheets / LibreOffice.
    def _csv_safe(value):
        text = "" if value is None else str(value)
        if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
            return "'" + text
        return text

    query = (
        select(EmployeeProfile)
        .join(User, EmployeeProfile.user_id == User.id, isouter=True)
        .options(
            joinedload(EmployeeProfile.user),
            selectinload(EmployeeProfile.documents),
            selectinload(EmployeeProfile.contracts),
            selectinload(EmployeeProfile.compliance_forms),
            selectinload(EmployeeProfile.selection_form),
            selectinload(EmployeeProfile.separations),
            selectinload(EmployeeProfile.leave_balances),
            selectinload(EmployeeProfile.assets),
            joinedload(EmployeeProfile.manager),
        )
        .order_by(EmployeeProfile.created_at.desc())
    )
    if search:
        q = f"%{search.lower()}%"
        query = query.where(
            func.lower(EmployeeProfile.full_name).like(q)
            | func.lower(EmployeeProfile.ethara_email).like(q)
            | func.lower(func.coalesce(EmployeeProfile.personal_email, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employee_code, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.department, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.designation, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.vendor, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.work_mode, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employment_status, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.aadhaar_ocr_status, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.aadhaar_validation_status, "")).like(q)
        )
    selected_employee_ids = _parse_employee_id_filter(employee_ids)
    if selected_employee_ids:
        query = query.where(EmployeeProfile.id.in_(selected_employee_ids))
    joining_from_date = _parse_export_filter_date(joining_from)
    joining_to_date = _parse_export_filter_date(joining_to)
    profiles = [
        profile
        for profile in db.scalars(query).unique()
        if _employee_matches_export_filters(
            db,
            profile,
            profile.user,
            lifecycle=lifecycle,
            department=department,
            work_mode=work_mode,
            issue=issue,
            joining_from=joining_from_date,
            joining_to=joining_to_date,
        )
    ]
    profiles = _sort_employee_profiles(profiles, sort_by)
    include_imported_rows = not selected_employee_ids and lifecycle in {"all", "pending_activation", "offboarded"}
    imported_pending_rows = (
        [
            row
            for row in employee_service.list_pending_imported_employees(db, search=search)
            if _imported_row_matches_export_filters(
                row,
                lifecycle=lifecycle,
                department=department,
                work_mode=work_mode,
                issue=issue,
                joining_from=joining_from_date,
                joining_to=joining_to_date,
            )
        ]
        if include_imported_rows
        else []
    )

    profile_ids = [p.id for p in profiles]

    pms_by_employee: dict[str, list[PmsEvaluation]] = {p.id: [] for p in profiles}
    if pms_export_allowed and profile_ids:
        pms_rows = db.scalars(
            select(PmsEvaluation)
            .where(PmsEvaluation.employee_id.in_(profile_ids))
            .options(joinedload(PmsEvaluation.evaluator))
            .order_by(PmsEvaluation.submitted_at.desc(), PmsEvaluation.created_at.desc())
        ).unique()
        for ev in pms_rows:
            if ev.employee_id:
                pms_by_employee.setdefault(ev.employee_id, []).append(ev)

    candidates_by_employee: dict[str, list[Candidate]] = {p.id: [] for p in profiles}
    if evaluation_export_allowed and profiles:
        employee_codes = [p.employee_code for p in profiles if p.employee_code]
        aadhaar_hashes = [p.aadhaar_hash for p in profiles if p.aadhaar_hash]
        emails = {
            email.strip().lower()
            for p in profiles
            for email in (p.personal_email, p.ethara_email)
            if email and email.strip()
        }
        candidate_conditions = []
        if employee_codes:
            candidate_conditions.append(Candidate.candidate_code.in_(employee_codes))
        if aadhaar_hashes:
            candidate_conditions.append(Candidate.aadhaar_hash.in_(aadhaar_hashes))
        if emails:
            candidate_conditions.extend(
                [
                    func.lower(func.coalesce(Candidate.personal_email, "")).in_(emails),
                    func.lower(func.coalesce(Candidate.ethara_email, "")).in_(emails),
                ]
            )

        candidate_rows: list[Candidate] = []
        if candidate_conditions:
            candidate_rows = list(
                db.scalars(
                    select(Candidate)
                    .where(or_(*candidate_conditions))
                    .options(
                        joinedload(Candidate.position),
                        selectinload(Candidate.evaluations).joinedload(Evaluation.evaluator),
                        selectinload(Candidate.evaluations).selectinload(Evaluation.pi_rounds),
                        selectinload(Candidate.assessments).joinedload(
                            CandidateAssessment.evaluator
                        ),
                    )
                    .order_by(Candidate.created_at.desc())
                ).unique()
            )

        def _candidate_matches_profile(candidate: Candidate, profile: EmployeeProfile) -> bool:
            profile_emails = {
                email.strip().lower()
                for email in (profile.personal_email, profile.ethara_email)
                if email and email.strip()
            }
            candidate_emails = {
                email.strip().lower()
                for email in (candidate.personal_email, candidate.ethara_email)
                if email and email.strip()
            }
            return any(
                [
                    bool(
                        profile.employee_code and candidate.candidate_code == profile.employee_code
                    ),
                    bool(profile.aadhaar_hash and candidate.aadhaar_hash == profile.aadhaar_hash),
                    bool(profile_emails & candidate_emails),
                ]
            )

        for profile in profiles:
            candidates_by_employee[profile.id] = [
                candidate
                for candidate in candidate_rows
                if _candidate_matches_profile(candidate, profile)
            ]

    def _signed(url):
        if not url:
            return ""
        try:
            return make_signed_upload_url(url)
        except Exception:
            return ""

    def _fmt_dt(value):
        return format_app_datetime(value) if value else ""

    def _fmt_date(value):
        # Date-only (e.g. for Date of Birth) — no noisy time/timezone suffix.
        return value.date().isoformat() if value else ""

    def _enum_value(value):
        if value is None:
            return ""
        return getattr(value, "value", str(value))

    def _json_cell(value):
        if value in (None, "", [], {}):
            return ""
        try:
            return _json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)
        except Exception:
            return str(value)

    def _joined(values):
        return " | ".join(str(v) for v in values if v not in (None, ""))

    def _latest(items):
        if not items:
            return None
        return max(
            items,
            key=lambda item: item.updated_at or item.created_at or datetime.min.replace(tzinfo=UTC),
        )

    def _doc_type_label(raw):
        key = (raw or "document").strip().lower()
        return {"aadhaar_card": "aadhaar"}.get(key, key)

    def _stored_aadhaar_number(profile):
        # Read the full Aadhaar number OCR'd and stored at registration — no
        # re-OCR at export time.
        ocr = profile.aadhaar_extracted if isinstance(profile.aadhaar_extracted, dict) else {}
        return ocr.get("aadhaarNumber") or ""

    # Build a {doc-type -> file_url} map per employee, and collect the union of all
    # document types so each document gets its OWN column (one link per cell).
    per_emp_docs: dict[str, dict[str, str]] = {}
    doc_types: set[str] = {"resume", "aadhaar"} if aadhaar_full_allowed else {"resume"}
    for p in profiles:
        type_map: dict[str, str] = {}
        if p.resume_path:
            type_map["resume"] = p.resume_path
        # Aadhaar document link is restricted to HR/Admin/Super-Admin.
        if p.aadhaar_path and aadhaar_full_allowed:
            type_map["aadhaar"] = p.aadhaar_path
        for d in p.documents or []:
            if not d.file_url:
                continue
            label = _doc_type_label(d.type)
            # Aadhaar document links are restricted to HR/Admin/Super-Admin.
            if label == "aadhaar" and not aadhaar_full_allowed:
                continue
            type_map.setdefault(label, d.file_url)
            doc_types.add(label)
        for idx, ct in enumerate(c for c in (p.contracts or []) if c.file_url):
            label = "contract" if idx == 0 else f"contract_{idx + 1}"
            type_map[label] = ct.file_url
            doc_types.add(label)
        per_emp_docs[p.id] = type_map

    base_doc_order = ["resume", "aadhaar"] if aadhaar_full_allowed else ["resume"]
    ordered_types = base_doc_order + sorted(t for t in doc_types if t not in {"resume", "aadhaar"})
    doc_columns = [f"{t.replace('_', ' ').title()} Link" for t in ordered_types]

    header = [
        "Employee ID",
        "Lifecycle",
        "Registration Status",
        "User ID",
        "User Role",
        "User Active",
        "Name",
        "Employee Code",
        "Ethara Email",
        "Personal Email",
        "Phone",
        "Department",
        "Designation",
        "Date of Joining",
        "Vendor",
        "Work Mode",
        "Employment Status",
        "Gender",
        "Date of Birth",
        "Blood Group",
        "Father Name",
        "Mother Name",
        "Marital Status",
        "Has Kids",
        "Highest Qualification",
        "Current Address",
        "Permanent Address",
        "PAN Number",
        "Has Salary Account",
        "Has Savings Account",
        "Has UAN Number",
        "Salary Account Instruction",
    ]
    if aadhaar_full_allowed:
        header.append("Aadhaar Number (OCR)")
    header.extend(
        [
            "Aadhaar Last4",
            "Aadhaar Name (OCR)",
            "Aadhaar OCR Status",
            "Aadhaar Validation",
            "Aadhaar OCR Match",
            "Aadhaar Mismatch Reason",
            "Manager",
            "Manager Email",
            "Manager ID",
            "Emergency Contact",
            "Emergency Phone",
            "Emergency Relation",
            "Current Employee Status",
            "Created",
            "Updated",
            "Employee Detail Form Status",
            "Employee Detail Form Submitted At",
            "Employee Detail Form Reviewed At",
            "Employee Detail Form Reviewer",
            "Employee Detail Form Remarks",
            "Employee Detail Form Data",
            "Document Count",
            "Uploaded Document Types",
            "Document Detail Summary",
            "Contract Count",
            "Latest Contract Title",
            "Latest Contract Status",
            "Latest Contract Issued At",
            "Latest Contract Completed At",
            "Contract Summary",
            "Compliance Form Count",
            "Compliance Summary",
            "Active Separation Status",
            "Separation Summary",
            "Asset Count",
            "Asset Summary",
            "Leave Balance Summary",
        ]
    )
    if pms_export_allowed:
        header.extend(
            [
                "PMS Evaluation Count",
                "Latest PMS Total Score",
                "Latest PMS Average Score",
                "Latest PMS Overall Rating",
                "Latest PMS Remarks",
                "Latest PMS Submitted At",
                "Latest PMS Evaluator",
                "Latest PMS Metric Remarks",
                "PMS Verbal Clarity",
                "PMS Conciseness",
                "PMS Fluency",
                "PMS Vocabulary",
                "PMS Pronunciation",
                "PMS Nonverbal Confidence",
                "PMS Intro Background",
                "PMS Ethara Awareness",
                "PMS Current Affairs",
                "PMS Instagram Familiarity",
                "PMS Prompt Engineering",
                "PMS Video Editing",
                "All PMS Evaluations",
            ]
        )
    if evaluation_export_allowed:
        header.extend(
            [
                "Matched Candidate Codes",
                "Matched Candidate Stages",
                "Matched Candidate Roles",
                "Candidate Evaluation Count",
                "Latest Evaluation Total Score",
                "Latest Evaluation Recommendation",
                "Latest Evaluation Notes",
                "Latest Evaluation PI Score",
                "Latest Evaluation PMS Score",
                "Latest Evaluation Completed At",
                "Latest Evaluation Evaluator",
                "All Candidate Evaluations",
                "PI Round Summary",
                "Assessment Summary",
                "Assessment Feedback",
            ]
        )
    header.extend(doc_columns)

    buffer = StringIO()
    writer = _csv.writer(buffer)
    writer.writerow([_csv_safe(col) for col in header])

    for p in profiles:
        type_map = per_emp_docs.get(p.id, {})
        user = p.user
        linked_candidate = _linked_candidate_for_employee_profile(db, p)
        selection_form = p.selection_form
        documents = list(p.documents or [])
        contracts = list(p.contracts or [])
        compliance_forms = list(p.compliance_forms or [])
        separations = list(p.separations or [])
        assets = list(p.assets or [])
        leave_balances = list(p.leave_balances or [])
        latest_contract = _latest(contracts)
        latest_separation = _latest(separations)
        date_of_birth = _employee_profile_date(p, "date_of_birth", "dateOfBirth")
        active_separation = next(
            (
                sep
                for sep in sorted(
                    separations,
                    key=lambda item: (
                        item.updated_at or item.created_at or datetime.min.replace(tzinfo=UTC)
                    ),
                    reverse=True,
                )
                if sep.status not in {"approved", "rejected", "cancelled"}
            ),
            latest_separation,
        )
        row = [
            p.id,
            _employee_lifecycle(p, user, linked_candidate),
            _employee_registration_status(user, linked_candidate),
            p.user_id or "",
            _enum_value(user.role) if user else "",
            "Yes" if user and user.is_active else "No",
            _employee_profile_text(p, "full_name", "employeeName"),
            p.employee_code or "",
            p.ethara_email or "",
            _employee_profile_text(p, "personal_email", "personalEmail"),
            _employee_profile_text(p, "phone", "contactNumber"),
            _employee_profile_text(p, "department", "department"),
            _employee_profile_text(p, "designation", "designation"),
            _fmt_dt(p.date_of_joining),
            p.vendor or "",
            p.work_mode or "",
            p.employment_status or "",
            _employee_profile_text(p, "gender", "gender"),
            _fmt_date(date_of_birth),
            _employee_profile_text(p, "blood_group", "bloodGroup"),
            _employee_profile_text(p, "father_name", "fatherName"),
            _employee_profile_text(p, "mother_name", "motherName"),
            _employee_profile_text(p, "marital_status", "maritalStatus"),
            _employee_profile_text(p, "has_kids", "hasKids"),
            _employee_profile_text(p, "highest_qualification", "highestQualification"),
            _employee_profile_text(p, "current_address", "currentAddress"),
            _employee_profile_text(p, "permanent_address", "permanentAddress"),
            _employee_profile_text(p, "pan_number", "panNumber"),
            _employee_profile_text(p, "has_salary_account", "hasSalaryAccount"),
            _employee_profile_text(p, "has_savings_account", "hasSavingsAccount"),
            _employee_profile_text(p, "has_uan_number", "hasUanNumber"),
            _employee_profile_text(p, "salary_account_instruction", "salaryAccountInstruction"),
        ]
        # Full Aadhaar number is restricted to HR/Admin/Super-Admin.
        if aadhaar_full_allowed:
            row.append(_stored_aadhaar_number(p))
        row.extend(
            [
                p.aadhaar_last4 or "",
                p.aadhaar_ocr_name or "",
                p.aadhaar_ocr_status or "",
                p.aadhaar_validation_status or "",
                "Yes" if p.aadhaar_ocr_match else ("No" if p.aadhaar_ocr_match is False else ""),
                p.aadhaar_mismatch_reason or "",
                (p.manager.name if p.manager else ""),
                (p.manager.email if p.manager else ""),
                p.manager_id or "",
                _employee_profile_text(p, "emergency_contact_name", "emergencyContactName"),
                _employee_profile_text(p, "emergency_contact_phone", "emergencyContactPhone"),
                _employee_profile_text(p, "emergency_contact_relation", "emergencyContactRelation"),
                employee_service._employee_status_from_separation(db, p, user),
                _fmt_dt(p.created_at),
                _fmt_dt(p.updated_at),
                selection_form.status if selection_form else "",
                _fmt_dt(selection_form.submitted_at) if selection_form else "",
                _fmt_dt(selection_form.reviewed_at) if selection_form else "",
                selection_form.reviewed_by if selection_form else "",
                selection_form.remarks if selection_form else "",
                _json_cell(selection_form.form_data if selection_form else None),
                len(documents),
                _joined(sorted({_doc_type_label(d.type) for d in documents})),
                _joined(
                    f"{_doc_type_label(doc.type)}: status={doc.status}; uploaded={_fmt_dt(doc.created_at)}; updated={_fmt_dt(doc.updated_at)}; remarks={doc.remarks or ''}"
                    for doc in sorted(
                        documents,
                        key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
                    )
                ),
                len(contracts),
                latest_contract.title if latest_contract else "",
                _enum_value(latest_contract.status) if latest_contract else "",
                _fmt_dt(latest_contract.issued_at) if latest_contract else "",
                _fmt_dt(latest_contract.completed_at) if latest_contract else "",
                _joined(
                    f"{contract.title}:{_enum_value(contract.status)}"
                    for contract in sorted(
                        contracts,
                        key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
                    )
                ),
                len(compliance_forms),
                _joined(
                    f"{form.form_title}:{form.status}; submitted={_fmt_dt(form.submitted_at)}; verified={_fmt_dt(form.verified_at)}; remarks={form.remarks or ''}; data={_json_cell(form.form_data)}"
                    for form in sorted(
                        compliance_forms,
                        key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
                    )
                ),
                active_separation.status if active_separation else "",
                _joined(
                    f"{sep.separation_type}:{sep.status}; reason={sep.reason or ''}; manager={sep.manager_action or ''}; remarks={sep.remarks or sep.manager_remarks or ''}"
                    for sep in sorted(
                        separations,
                        key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
                    )
                ),
                len(assets),
                _joined(
                    f"{_display_label(asset.asset_type)}; model={asset.model or ''}; serial={asset.serial_number or ''}; tag={asset.asset_tag or ''}; status={_display_label(asset.status)}"
                    for asset in sorted(
                        assets, key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC)
                    )
                ),
                _joined(
                    f"{_display_label(balance.leave_type)} {balance.year}: total={balance.total_days}; used={balance.used_days}; pending={balance.pending_days}"
                    for balance in sorted(
                        leave_balances, key=lambda item: (item.year, item.leave_type)
                    )
                ),
            ]
        )
        if pms_export_allowed:
            pms_records = pms_by_employee.get(p.id, [])
            latest_pms = pms_records[0] if pms_records else None
            pms_metric_attrs = [
                "verbal_clarity",
                "conciseness",
                "fluency",
                "vocabulary",
                "pronunciation",
                "nonverbal_confidence",
                "intro_background",
                "ethara_awareness",
                "current_affairs",
                "instagram_familiarity",
                "prompt_engineering",
                "video_editing",
            ]
            row.extend(
                [
                    len(pms_records),
                    latest_pms.total_score if latest_pms else "",
                    latest_pms.average_score if latest_pms else "",
                    latest_pms.overall_rating if latest_pms else "",
                    latest_pms.remarks if latest_pms else "",
                    _fmt_dt(latest_pms.submitted_at) if latest_pms else "",
                    latest_pms.evaluator.name if latest_pms and latest_pms.evaluator else "",
                    _json_cell(latest_pms.metric_remarks if latest_pms else None),
                ]
            )
            row.extend(getattr(latest_pms, attr) if latest_pms else "" for attr in pms_metric_attrs)
            row.append(
                _joined(
                    f"{_fmt_dt(ev.submitted_at)}; evaluator={ev.evaluator.name if ev.evaluator else ''}; total={ev.total_score}; avg={ev.average_score}; rating={ev.overall_rating or ''}; remarks={ev.remarks or ''}; metricRemarks={_json_cell(ev.metric_remarks)}"
                    for ev in pms_records
                )
            )
        if evaluation_export_allowed:
            matched_candidates = candidates_by_employee.get(p.id, [])
            candidate_evaluations = sorted(
                [
                    evaluation
                    for candidate in matched_candidates
                    for evaluation in (candidate.evaluations or [])
                ],
                key=lambda item: (
                    item.completed_at
                    or item.updated_at
                    or item.created_at
                    or datetime.min.replace(tzinfo=UTC)
                ),
                reverse=True,
            )
            latest_eval = candidate_evaluations[0] if candidate_evaluations else None
            pi_rounds = [
                pi_round
                for evaluation in candidate_evaluations
                for pi_round in (evaluation.pi_rounds or [])
            ]
            assessments = [
                assessment
                for candidate in matched_candidates
                for assessment in (candidate.assessments or [])
            ]
            row.extend(
                [
                    _joined(candidate.candidate_code for candidate in matched_candidates),
                    _joined(
                        _enum_value(candidate.current_stage) for candidate in matched_candidates
                    ),
                    _joined(
                        candidate.position.title if candidate.position else ""
                        for candidate in matched_candidates
                    ),
                    len(candidate_evaluations),
                    latest_eval.total_score if latest_eval else "",
                    latest_eval.recommendation if latest_eval else "",
                    latest_eval.notes if latest_eval else "",
                    latest_eval.pi_score if latest_eval else "",
                    latest_eval.pms_score if latest_eval else "",
                    _fmt_dt(latest_eval.completed_at) if latest_eval else "",
                    latest_eval.evaluator.name if latest_eval and latest_eval.evaluator else "",
                    _joined(
                        f"{_fmt_dt(ev.completed_at)}; evaluator={ev.evaluator.name if ev.evaluator else ''}; total={ev.total_score}; recommendation={ev.recommendation or ''}; technical={ev.technical_skills}; communication={ev.communication}; problemSolving={ev.problem_solving}; culturalFit={ev.cultural_fit}; attitude={ev.attitude}; piScore={ev.pi_score}; pmsScore={ev.pms_score}; notes={ev.notes or ''}; interviewStatus={ev.interview_status or ''}; interviewNotes={ev.interview_notes or ''}"
                        for ev in candidate_evaluations
                    ),
                    _joined(
                        f"round={round_item.round_number}; status={round_item.status}; score={round_item.score}; decision={round_item.round_decision or ''}; verdict={round_item.final_verdict or ''}; remarks={round_item.remarks or ''}"
                        for round_item in sorted(
                            pi_rounds,
                            key=lambda item: (
                                item.created_at or datetime.min.replace(tzinfo=UTC),
                                item.round_number,
                            ),
                        )
                    ),
                    _joined(
                        f"level={assessment.level}; status={assessment.status}; auto={assessment.auto_score}; evaluator={assessment.evaluator_score}; total={assessment.total_score}; decision={assessment.decision or ''}"
                        for assessment in sorted(
                            assessments,
                            key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
                        )
                    ),
                    _joined(assessment.feedback for assessment in assessments),
                ]
            )
        row.extend(_signed(type_map.get(t)) for t in ordered_types)
        writer.writerow([_csv_safe(cell) for cell in row])

    header_index = {name: index for index, name in enumerate(header)}

    def _write_imported_row(row_data: dict):
        row = [""] * len(header)

        def set_cell(column: str, value):
            index = header_index.get(column)
            if index is not None:
                row[index] = value or ""

        set_cell("Employee ID", row_data.get("id"))
        set_cell("Lifecycle", _imported_row_lifecycle(row_data))
        set_cell("Registration Status", row_data.get("registrationStatus") or "imported_pending")
        set_cell("User Active", "No")
        set_cell("Name", row_data.get("name"))
        set_cell("Employee Code", row_data.get("employeeCode"))
        set_cell("Ethara Email", row_data.get("etharaEmail"))
        set_cell("Personal Email", row_data.get("personalEmail"))
        set_cell("Phone", row_data.get("phone"))
        set_cell("Department", row_data.get("department"))
        set_cell("Designation", row_data.get("designation"))
        set_cell("Date of Joining", row_data.get("dateOfJoining"))
        set_cell("Vendor", row_data.get("vendor"))
        set_cell("Work Mode", row_data.get("workMode"))
        set_cell("Employment Status", row_data.get("employmentStatus"))
        set_cell("Gender", row_data.get("gender"))
        set_cell("Aadhaar Last4", row_data.get("aadhaarLast4"))
        set_cell("Aadhaar OCR Status", row_data.get("aadhaarOcrStatus"))
        set_cell("Aadhaar Validation", row_data.get("aadhaarValidationStatus"))
        set_cell("Aadhaar Mismatch Reason", row_data.get("aadhaarMismatchReason"))
        set_cell("Manager", row_data.get("managerName"))
        set_cell("Manager Email", row_data.get("managerEmail"))
        set_cell("Current Employee Status", "Pending Activation")
        set_cell("Created", row_data.get("createdAt"))
        set_cell("Employee Detail Form Status", row_data.get("selectionFormStatus"))
        set_cell("Document Count", "0")
        writer.writerow([_csv_safe(cell) for cell in row])

    for imported_row in imported_pending_rows:
        _write_imported_row(imported_row)

    filename = f"employees_{app_date_stamp()}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Always serve a fresh export — never a stale browser-cached download.
            "Cache-Control": "no-store, no-cache, must-revalidate",
        },
    )


@router.get("/export/status")
def export_employee_status_csv(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
    search: str | None = None,
    lifecycle: Annotated[str, Query(pattern="^(all|active|pending_activation|offboarded)$")] = "all",
    department: str | None = None,
    work_mode: Annotated[str | None, Query(alias="workMode")] = None,
    issue: Annotated[str, Query(pattern="^(all|selection_form_pending|aadhaar_needs_review|aadhaar_not_submitted)$")] = "all",
    joining_from: Annotated[str | None, Query(alias="joiningFrom")] = None,
    joining_to: Annotated[str | None, Query(alias="joiningTo")] = None,
    sort_by: Annotated[str, Query(alias="sortBy", pattern="^(joining_desc|joining_asc|created_desc|name_asc)$")] = "joining_desc",
    employee_ids: Annotated[str | None, Query(alias="employeeIds")] = None,
):
    """Export the current employee onboarding/offboarding state for the selected view."""
    import csv as _csv
    from io import StringIO

    from fastapi.responses import Response
    from sqlalchemy.orm import joinedload, selectinload

    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)

    def _csv_safe(value):
        text = "" if value is None else str(value)
        if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
            return "'" + text
        return text

    def _fmt_dt(value):
        return format_app_datetime(value) if value else ""

    def _latest(items):
        if not items:
            return None
        return max(
            items,
            key=lambda item: item.updated_at or item.created_at or datetime.min.replace(tzinfo=UTC),
        )

    query = (
        select(EmployeeProfile)
        .join(User, EmployeeProfile.user_id == User.id, isouter=True)
        .options(
            joinedload(EmployeeProfile.user),
            selectinload(EmployeeProfile.documents),
            selectinload(EmployeeProfile.contracts),
            selectinload(EmployeeProfile.compliance_forms),
            selectinload(EmployeeProfile.selection_form),
            joinedload(EmployeeProfile.manager),
        )
        .order_by(EmployeeProfile.created_at.desc())
    )
    if search:
        q = f"%{search.lower()}%"
        query = query.where(
            func.lower(EmployeeProfile.full_name).like(q)
            | func.lower(EmployeeProfile.ethara_email).like(q)
            | func.lower(func.coalesce(EmployeeProfile.personal_email, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employee_code, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.department, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.designation, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.vendor, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.work_mode, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employment_status, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.aadhaar_ocr_status, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.aadhaar_validation_status, "")).like(q)
        )

    selected_employee_ids = _parse_employee_id_filter(employee_ids)
    if selected_employee_ids:
        query = query.where(EmployeeProfile.id.in_(selected_employee_ids))

    joining_from_date = _parse_export_filter_date(joining_from)
    joining_to_date = _parse_export_filter_date(joining_to)
    profiles = [
        profile
        for profile in db.scalars(query).unique()
        if _employee_matches_export_filters(
            db,
            profile,
            profile.user,
            lifecycle=lifecycle,
            department=department,
            work_mode=work_mode,
            issue=issue,
            joining_from=joining_from_date,
            joining_to=joining_to_date,
        )
    ]
    profiles = _sort_employee_profiles(profiles, sort_by)
    imported_pending_rows = (
        [
            row
            for row in employee_service.list_pending_imported_employees(db, search=search)
            if _imported_row_matches_export_filters(
                row,
                lifecycle=lifecycle,
                department=department,
                work_mode=work_mode,
                issue=issue,
                joining_from=joining_from_date,
                joining_to=joining_to_date,
            )
        ]
        if not selected_employee_ids and lifecycle in {"all", "pending_activation", "offboarded"}
        else []
    )

    header = [
        "Employee ID",
        "Lifecycle",
        "Registration Status",
        "Current Employee Stage",
        "Current Employee State",
        "Next Required Action",
        "Status Completion %",
        "Name",
        "Employee Code",
        "Ethara Email",
        "Personal Email",
        "Department",
        "Designation",
        "Date of Joining",
        "Vendor",
        "Work Mode",
        "Employment Status",
        "User Active",
        "Employee Detail Form Status",
        "Document Status",
        "Missing Documents",
        "Documents Needing Review",
        "Latest Contract Status",
        "Compliance Status",
        "Manager",
        "Manager Email",
        "Created",
        "Updated",
    ]
    buffer = StringIO()
    writer = _csv.writer(buffer)
    writer.writerow([_csv_safe(col) for col in header])

    for profile in profiles:
        user = profile.user
        linked_candidate = _linked_candidate_for_employee_profile(db, profile)
        documents = list(profile.documents or [])
        contracts = list(profile.contracts or [])
        compliance_forms = list(profile.compliance_forms or [])
        export_state = _employee_export_state(
            profile=profile,
            user=user,
            linked_candidate=linked_candidate,
            documents=documents,
            contracts=contracts,
            compliance_forms=compliance_forms,
        )
        docs_complete, missing_documents, review_documents = _employee_export_document_status(profile, documents)
        latest_contract = _latest(contracts)
        compliance_complete, compliance_warning = _employee_export_compliance_status(compliance_forms)
        document_status = (
            "Needs Review"
            if review_documents
            else ("Complete" if docs_complete else "Pending")
        )
        compliance_status = (
            "Needs Review"
            if compliance_warning
            else ("Complete" if compliance_complete else "Pending")
        )
        row = [
            profile.id,
            _employee_lifecycle(profile, user, linked_candidate),
            _employee_registration_status(user, linked_candidate),
            export_state["stage"],
            export_state["state"],
            export_state["nextAction"],
            export_state["completion"],
            _employee_profile_text(profile, "full_name", "employeeName"),
            profile.employee_code or "",
            profile.ethara_email or "",
            _employee_profile_text(profile, "personal_email", "personalEmail"),
            _employee_profile_text(profile, "department", "department"),
            _employee_profile_text(profile, "designation", "designation"),
            _fmt_dt(profile.date_of_joining),
            profile.vendor or "",
            profile.work_mode or "",
            profile.employment_status or "",
            "Yes" if user and user.is_active else "No",
            profile.selection_form.status if profile.selection_form else "not_started",
            document_status,
            " | ".join(missing_documents),
            " | ".join(review_documents),
            _enum_export_value(latest_contract.status) if latest_contract else "",
            compliance_status,
            profile.manager.name if profile.manager else "",
            profile.manager.email if profile.manager else "",
            _fmt_dt(profile.created_at),
            _fmt_dt(profile.updated_at),
        ]
        writer.writerow([_csv_safe(cell) for cell in row])

    for row_data in imported_pending_rows:
        export_state = _imported_row_export_state(row_data)
        row = [
            row_data.get("id"),
            _imported_row_lifecycle(row_data),
            row_data.get("registrationStatus") or "imported_pending",
            export_state["stage"],
            export_state["state"],
            export_state["nextAction"],
            export_state["completion"],
            row_data.get("name"),
            row_data.get("employeeCode"),
            row_data.get("etharaEmail"),
            row_data.get("personalEmail"),
            row_data.get("department"),
            row_data.get("designation"),
            row_data.get("dateOfJoining"),
            row_data.get("vendor"),
            row_data.get("workMode"),
            row_data.get("employmentStatus"),
            "No",
            row_data.get("selectionFormStatus") or "not_started",
            "Pending",
            "",
            "",
            "",
            "Pending",
            row_data.get("managerName"),
            row_data.get("managerEmail"),
            row_data.get("createdAt"),
            "",
        ]
        writer.writerow([_csv_safe(cell) for cell in row])

    filename = f"employee_status_{app_date_stamp()}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store, no-cache, must-revalidate",
        },
    )


@router.get("/export/package")
def export_employees_package(
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
    search: str | None = None,
    lifecycle: Annotated[str, Query(pattern="^(all|active|pending_activation|offboarded)$")] = "all",
    department: str | None = None,
    work_mode: Annotated[str | None, Query(alias="workMode")] = None,
    issue: Annotated[str, Query(pattern="^(all|selection_form_pending|aadhaar_needs_review|aadhaar_not_submitted)$")] = "all",
    joining_from: Annotated[str | None, Query(alias="joiningFrom")] = None,
    joining_to: Annotated[str | None, Query(alias="joiningTo")] = None,
    sort_by: Annotated[str, Query(alias="sortBy", pattern="^(joining_desc|joining_asc|created_desc|name_asc)$")] = "joining_desc",
    employee_ids: Annotated[str | None, Query(alias="employeeIds")] = None,
):
    """Export employee data and uploaded documents as a folder-structured ZIP."""
    from sqlalchemy.orm import joinedload, selectinload

    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)

    query = (
        select(EmployeeProfile)
        .join(User, EmployeeProfile.user_id == User.id, isouter=True)
        .options(
            joinedload(EmployeeProfile.user),
            joinedload(EmployeeProfile.manager),
            selectinload(EmployeeProfile.documents),
            selectinload(EmployeeProfile.contracts),
            selectinload(EmployeeProfile.compliance_forms),
            selectinload(EmployeeProfile.selection_form),
        )
        .order_by(EmployeeProfile.created_at.desc())
    )
    if search:
        q = f"%{search.lower()}%"
        query = query.where(
            func.lower(EmployeeProfile.full_name).like(q)
            | func.lower(EmployeeProfile.ethara_email).like(q)
            | func.lower(func.coalesce(EmployeeProfile.personal_email, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employee_code, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.department, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.designation, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.vendor, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.work_mode, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.employment_status, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.aadhaar_ocr_status, "")).like(q)
            | func.lower(func.coalesce(EmployeeProfile.aadhaar_validation_status, "")).like(q)
        )

    selected_employee_ids = _parse_employee_id_filter(employee_ids)
    if selected_employee_ids:
        query = query.where(EmployeeProfile.id.in_(selected_employee_ids))

    joining_from_date = _parse_export_filter_date(joining_from)
    joining_to_date = _parse_export_filter_date(joining_to)
    profiles = [
        profile
        for profile in db.scalars(query).unique()
        if _employee_matches_export_filters(
            db,
            profile,
            profile.user,
            lifecycle=lifecycle,
            department=department,
            work_mode=work_mode,
            issue=issue,
            joining_from=joining_from_date,
            joining_to=joining_to_date,
        )
    ]
    profiles = _sort_employee_profiles(profiles, sort_by)
    include_imported_rows = not selected_employee_ids and lifecycle in {"all", "pending_activation", "offboarded"}
    imported_pending_rows = (
        [
            row
            for row in employee_service.list_pending_imported_employees(db, search=search)
            if _imported_row_matches_export_filters(
                row,
                lifecycle=lifecycle,
                department=department,
                work_mode=work_mode,
                issue=issue,
                joining_from=joining_from_date,
                joining_to=joining_to_date,
            )
        ]
        if include_imported_rows
        else []
    )

    def _safe_part(value: str | None, fallback: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", (value or "").strip()).strip(" ._")
        return cleaned[:90] or fallback

    def _profile_folder(profile: EmployeeProfile) -> str:
        code = _safe_part(profile.employee_code, "employee")
        name = _safe_part(profile.full_name, profile.id)
        return f"{code}_{name}_{profile.id[:8]}"

    def _json_default(value):
        if isinstance(value, datetime):
            return to_app_timezone(value).isoformat()
        return str(value)

    def _read_file_bytes(file_url: str | None) -> tuple[bytes | None, str | None]:
        if not file_url:
            return None, "No file URL recorded."
        try:
            reference = employee_service._resolve_employee_file_reference(file_url)
            if isinstance(reference, Path):
                return reference.read_bytes(), None
            if isinstance(reference, str) and reference.startswith(("http://", "https://")):
                import httpx

                response = httpx.get(reference, timeout=20.0)
                response.raise_for_status()
                return response.content, None
        except Exception as exc:
            return None, str(exc)
        return None, "File could not be resolved from storage."

    temp_file = tempfile.NamedTemporaryFile(
        prefix="employees_with_documents_",
        suffix=".zip",
        delete=False,
    )
    temp_path = Path(temp_file.name)
    temp_file.close()
    manifest: list[dict[str, str | None]] = []

    try:
        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            summary_rows: list[dict[str, str | None]] = []
            for profile in profiles:
                folder = _profile_folder(profile)
                user = profile.user
                linked_candidate = _linked_candidate_for_employee_profile(db, profile)
                selection_form = profile.selection_form
                date_of_birth = _employee_profile_date(profile, "date_of_birth", "dateOfBirth")
                documents = list(profile.documents or [])
                contracts = list(profile.contracts or [])
                compliance_forms = list(profile.compliance_forms or [])
                profile_payload = {
                    "id": profile.id,
                    "userId": profile.user_id,
                    "userActive": bool(user and user.is_active),
                    "registrationStatus": _employee_registration_status(user, linked_candidate),
                    "lifecycle": _employee_lifecycle(profile, user, linked_candidate),
                    "candidateStage": (
                        linked_candidate.current_stage.value
                        if linked_candidate and hasattr(linked_candidate.current_stage, "value")
                        else str(linked_candidate.current_stage)
                        if linked_candidate
                        else None
                    ),
                    "candidateStatus": linked_candidate.current_status if linked_candidate else None,
                    "name": _employee_profile_text(profile, "full_name", "employeeName"),
                    "employeeCode": profile.employee_code,
                    "etharaEmail": profile.ethara_email,
                    "personalEmail": _employee_profile_text(profile, "personal_email", "personalEmail"),
                    "phone": _employee_profile_text(profile, "phone", "contactNumber"),
                    "department": _employee_profile_text(profile, "department", "department"),
                    "designation": _employee_profile_text(profile, "designation", "designation"),
                    "gender": _employee_profile_text(profile, "gender", "gender"),
                    "dateOfBirth": date_of_birth,
                    "bloodGroup": _employee_profile_text(profile, "blood_group", "bloodGroup"),
                    "manager": profile.manager.name if profile.manager else None,
                    "managerEmail": profile.manager.email if profile.manager else None,
                    "emergencyContactName": _employee_profile_text(
                        profile,
                        "emergency_contact_name",
                        "emergencyContactName",
                    ),
                    "emergencyContactPhone": _employee_profile_text(
                        profile,
                        "emergency_contact_phone",
                        "emergencyContactPhone",
                    ),
                    "emergencyContactRelation": _employee_profile_text(
                        profile,
                        "emergency_contact_relation",
                        "emergencyContactRelation",
                    ),
                    "aadhaarLast4": profile.aadhaar_last4,
                    "aadhaarOcrStatus": profile.aadhaar_ocr_status,
                    "aadhaarOcrMatch": profile.aadhaar_ocr_match,
                    "selectionForm": {
                        "status": selection_form.status if selection_form else None,
                        "submittedAt": selection_form.submitted_at if selection_form else None,
                        "reviewedAt": selection_form.reviewed_at if selection_form else None,
                        "formData": selection_form.form_data if selection_form else None,
                        "editAccessEnabled": employee_service.employee_edit_access_enabled(db, profile),
                    },
                    "documents": [
                        {
                            "id": document.id,
                            "type": document.type,
                            "fileName": document.file_name,
                            "status": document.status,
                            "remarks": document.remarks,
                            "uploadedAt": document.created_at,
                        }
                        for document in (profile.documents or [])
                    ],
                    "contracts": [
                        {
                            "id": contract.id,
                            "title": contract.title,
                            "status": contract.status.value if hasattr(contract.status, "value") else str(contract.status),
                            "fileName": contract.file_name,
                            "issuedAt": contract.issued_at,
                            "completedAt": contract.completed_at,
                        }
                        for contract in (profile.contracts or [])
                    ],
                    "complianceForms": [
                        {
                            "id": form.id,
                            "formType": form.form_type,
                            "formTitle": form.form_title,
                            "status": form.status,
                            "formData": form.form_data,
                            "submittedAt": form.submitted_at,
                            "verifiedAt": form.verified_at,
                            "remarks": form.remarks,
                        }
                        for form in (profile.compliance_forms or [])
                    ],
                    "createdAt": profile.created_at,
                    "updatedAt": profile.updated_at,
                }
                archive.writestr(
                    f"{folder}/profile.json",
                    json.dumps(profile_payload, ensure_ascii=True, indent=2, default=_json_default),
                )

                summary_rows.append(
                    {
                        "Employee ID": profile.id,
                        "Employee Code": profile.employee_code,
                        "Name": _employee_profile_text(profile, "full_name", "employeeName"),
                        "Ethara Email": profile.ethara_email,
                        "Department": _employee_profile_text(profile, "department", "department"),
                        "Designation": _employee_profile_text(profile, "designation", "designation"),
                        "Date of Birth": date_of_birth.date().isoformat()
                        if date_of_birth
                        else None,
                        "Registration Status": _employee_registration_status(user, linked_candidate),
                    }
                )

                file_entries: list[tuple[str, str | None, str | None]] = [
                    ("resume", profile.resume_path, "resume"),
                    ("aadhaar", profile.aadhaar_path, "aadhaar"),
                ]
                file_entries.extend(
                    (
                        f"documents/{employee_service._normalize_employee_document_type(document.type)}",
                        document.file_url,
                        document.file_name,
                    )
                    for document in (profile.documents or [])
                )
                file_entries.extend(
                    (
                        f"contracts/{idx + 1}_{_safe_part(contract.title, 'contract')}",
                        contract.file_url,
                        contract.file_name or "contract.pdf",
                    )
                    for idx, contract in enumerate(profile.contracts or [])
                    if contract.file_url
                )

                for entry_type, file_url, file_name in file_entries:
                    if not file_url:
                        continue
                    file_bytes, error = _read_file_bytes(file_url)
                    archive_name = (
                        f"{folder}/{entry_type}/"
                        f"{_safe_part(file_name or Path(str(file_url)).name, 'document.bin')}"
                    )
                    if file_bytes:
                        archive.writestr(archive_name, file_bytes)
                        manifest.append(
                            {"employeeId": profile.id, "type": entry_type, "file": archive_name, "status": "included", "error": None}
                        )
                    else:
                        manifest.append(
                            {"employeeId": profile.id, "type": entry_type, "file": archive_name, "status": "skipped", "error": error}
                        )

            for row_data in imported_pending_rows:
                staging_id = str(row_data.get("stagingId") or "").strip()
                staging = db.get(EmployeeImportStaging, staging_id) if staging_id else None
                folder = (
                    f"pending_{_safe_part(row_data.get('employeeCode'), 'employee')}_"
                    f"{_safe_part(row_data.get('name'), staging_id or 'pending')}_"
                    f"{(staging_id or 'import')[:8]}"
                )
                profile_payload = {
                    "id": row_data.get("id"),
                    "stagingId": staging_id,
                    "registrationStatus": row_data.get("registrationStatus") or "imported_pending",
                    "lifecycle": _imported_row_lifecycle(row_data),
                    "name": row_data.get("name"),
                    "employeeCode": row_data.get("employeeCode"),
                    "etharaEmail": row_data.get("etharaEmail"),
                    "personalEmail": row_data.get("personalEmail"),
                    "phone": row_data.get("phone"),
                    "department": row_data.get("department"),
                    "designation": row_data.get("designation"),
                    "gender": row_data.get("gender"),
                    "vendor": row_data.get("vendor"),
                    "employmentStatus": row_data.get("employmentStatus"),
                    "workMode": row_data.get("workMode"),
                    "dateOfJoining": row_data.get("dateOfJoining"),
                    "aadhaarLast4": row_data.get("aadhaarLast4"),
                    "aadhaarOcrStatus": row_data.get("aadhaarOcrStatus"),
                    "aadhaarValidationStatus": row_data.get("aadhaarValidationStatus"),
                    "manager": row_data.get("managerName"),
                    "managerEmail": row_data.get("managerEmail"),
                    "selectionFormStatus": row_data.get("selectionFormStatus"),
                    "createdAt": row_data.get("createdAt"),
                    "documents": staging.documents if staging and staging.documents else [],
                    "sourceRow": staging.source_row if staging else None,
                    "notes": staging.notes if staging else None,
                }
                archive.writestr(
                    f"{folder}/profile.json",
                    json.dumps(profile_payload, ensure_ascii=True, indent=2, default=_json_default),
                )
                summary_rows.append(
                    {
                        "Employee ID": row_data.get("id"),
                        "Employee Code": row_data.get("employeeCode"),
                        "Name": row_data.get("name"),
                        "Ethara Email": row_data.get("etharaEmail"),
                        "Department": row_data.get("department"),
                        "Designation": row_data.get("designation"),
                        "Date of Birth": None,
                        "Registration Status": row_data.get("registrationStatus") or "imported_pending",
                    }
                )
                for idx, document in enumerate((staging.documents if staging else []) or []):
                    entry_type = employee_service._normalize_employee_document_type(document.get("type"))
                    file_url = document.get("file_url")
                    if not file_url:
                        continue
                    file_bytes, error = _read_file_bytes(file_url)
                    archive_name = (
                        f"{folder}/documents/{idx + 1}_{entry_type}/"
                        f"{_safe_part(document.get('file_name') or Path(str(file_url)).name, 'document.bin')}"
                    )
                    if file_bytes:
                        archive.writestr(archive_name, file_bytes)
                        manifest.append(
                            {"employeeId": row_data.get("id"), "type": entry_type, "file": archive_name, "status": "included", "error": None}
                        )
                    else:
                        manifest.append(
                            {"employeeId": row_data.get("id"), "type": entry_type, "file": archive_name, "status": "skipped", "error": error}
                        )

            if summary_rows:
                csv_buffer = io.StringIO()
                writer = csv.DictWriter(csv_buffer, fieldnames=list(summary_rows[0].keys()))
                writer.writeheader()
                writer.writerows(csv_safe_mapping(row) for row in summary_rows)
                archive.writestr("employees_summary.csv", csv_buffer.getvalue())
            archive.writestr(
                "document_manifest.json",
                json.dumps(manifest, ensure_ascii=True, indent=2),
            )
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    filename = f"employees_with_documents_{app_date_stamp()}.zip"
    background_tasks.add_task(temp_path.unlink, missing_ok=True)
    return FileResponse(
        path=temp_path,
        media_type="application/zip",
        filename=filename,
        background=background_tasks,
    )


@router.post("/edit-access/bulk")
def bulk_update_employee_edit_access(
    payload: EmployeeBulkEditAccessRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    _assert_employee_staff(current_user)
    _assert_employee_edit_access_admin(current_user)
    employee_ids = [employee_id for employee_id in payload.ids if employee_id]
    if not employee_ids:
        raise HTTPException(status_code=422, detail="Select at least one employee.")
    profiles = list(db.scalars(select(EmployeeProfile).where(EmployeeProfile.id.in_(employee_ids))))
    found_ids = {profile.id for profile in profiles}
    missing_ids = [employee_id for employee_id in employee_ids if employee_id not in found_ids]
    for profile in profiles:
        employee_service.set_employee_edit_access(
            db,
            profile=profile,
            enabled=payload.enabled,
            actor=current_user,
        )
    db.commit()
    return {
        "updated": len(profiles),
        "missing": missing_ids,
        "editAccessEnabled": payload.enabled,
    }


@router.patch("/{employee_id}/edit-access")
def update_employee_edit_access(
    employee_id: str,
    payload: EmployeeEditAccessRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    _assert_employee_staff(current_user)
    _assert_employee_edit_access_admin(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    employee_service.set_employee_edit_access(
        db,
        profile=profile,
        enabled=payload.enabled,
        actor=current_user,
    )
    db.commit()
    return {"employeeId": profile.id, "editAccessEnabled": payload.enabled}


@router.patch("/{employee_id}/hr-fields")
def update_employee_hr_fields(
    employee_id: str,
    payload: EmployeeHrFieldsRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    """HR/admin-only: set Vendor / Status / Work Mode / Date of Joining. Not exposed to the employee."""
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    # Only update the keys the caller actually sent (PATCH semantics).
    provided = set(payload.model_dump(exclude_unset=True).keys())

    # Pre-loaded (not-yet-registered) employee → write onto the staging row.
    if employee_id.startswith("import:"):
        try:
            staging = employee_service.update_imported_hr_fields(
                db,
                staging_id=employee_id.split(":", 1)[1],
                actor=current_user,
                vendor=payload.vendor,
                employment_status=payload.employment_status,
                work_mode=payload.work_mode,
                date_of_joining=payload.date_of_joining,
                fields_provided=provided,
            )
            db.commit()
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        pf = staging.profile_fields or {}
        return {
            "employeeId": employee_id,
            "vendor": pf.get("vendor"),
            "employmentStatus": pf.get("employment_status"),
            "workMode": pf.get("work_mode"),
            "dateOfJoining": pf.get("date_of_joining"),
        }

    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    employee_service.update_employee_hr_fields(
        db,
        profile=profile,
        actor=current_user,
        vendor=payload.vendor,
        employment_status=payload.employment_status,
        work_mode=payload.work_mode,
        date_of_joining=payload.date_of_joining,
        fields_provided=provided,
    )
    db.commit()
    return {
        "employeeId": profile.id,
        "vendor": profile.vendor,
        "employmentStatus": profile.employment_status,
        "workMode": profile.work_mode,
        "dateOfJoining": profile.date_of_joining.isoformat() if profile.date_of_joining else None,
    }


@router.patch("/{employee_id}/employee-code")
def update_employee_code(
    employee_id: str,
    payload: EmployeeCodeUpdateRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    """HR/admin-only: change an employee's GRP code from the profile screen.

    The new code is propagated to the linked candidate record and every code-keyed module
    (ID card, leave balances, attendance, reimbursements) so nothing drifts. If the code is
    already assigned, responds 409 with the conflicting record's details so the UI can offer
    to edit that other record's code instead."""
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)

    new_code = employee_service.normalize_employee_code(payload.employee_code or "")
    if not EMPLOYEE_CODE_PATTERN.match(new_code):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Employee code must look like GRP1234 (GRP followed by digits, no spaces).",
        )
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    if employee_service.normalize_employee_code(profile.employee_code or "") == new_code:
        return {
            "employeeId": profile.id,
            "employeeCode": profile.employee_code,
            "changed": False,
            "propagated": {},
        }

    # Exclude this employee's own linked candidate so aligning the code to the candidate's
    # value is never flagged as a "conflict" with itself.
    own_candidate = employee_service._linked_candidate_for_profile(db, profile)
    holder = employee_service.find_employee_code_holder(
        db,
        new_code,
        exclude_profile_id=profile.id,
        exclude_candidate_id=own_candidate.id if own_candidate else None,
    )
    if holder is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    f"Employee code {new_code} is already assigned to "
                    f"{holder.get('name') or holder.get('email') or 'another record'}."
                ),
                "conflict": holder,
            },
        )

    summary = employee_service.rename_employee_code(
        db, profile=profile, new_code=new_code, actor=current_user, request=request
    )
    db.commit()
    return {
        "employeeId": profile.id,
        "employeeCode": profile.employee_code,
        "changed": True,
        "previousCode": summary.get("old"),
        "propagated": summary.get("touched", {}),
    }


# ── ID Card Details (self-service + HR) ──────────────────────────────────────
# NOTE: /me/* routes are declared before /{employee_id}/* so "me" is never
# captured as an employee_id.
@router.get("/me/id-card-details")
def get_my_id_card_details(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    _assert_employee_self(current_user)
    profile = employee_service.get_employee_profile_for_user(db, current_user)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found")
    return employee_service.employee_id_card_payload(profile)


@router.post("/me/id-card-details")
def save_my_id_card_details(
    payload: EmployeeIdCardDetailsRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    _assert_employee_self(current_user)
    profile = employee_service.get_employee_profile_for_user(db, current_user)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found")
    data = payload.model_dump(exclude_unset=True, by_alias=True)
    result = employee_service.save_employee_id_card_details(
        db, profile=profile, actor=current_user, data=data
    )
    db.commit()
    return result


@router.get("/{employee_id}/id-card-details")
def get_employee_id_card_details_staff(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
) -> dict:
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return employee_service.employee_id_card_payload(profile)


@router.post("/{employee_id}/id-card-details")
def save_employee_id_card_details_staff(
    employee_id: str,
    payload: EmployeeIdCardDetailsRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    data = payload.model_dump(exclude_unset=True, by_alias=True)
    result = employee_service.save_employee_id_card_details(
        db, profile=profile, actor=current_user, data=data
    )
    db.commit()
    return result


@router.get("/{employee_id}", response_model=EmployeeDetailRead)
def get_employee_detail(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
) -> dict:
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        if employee_id.startswith("import:"):
            # Pre-loaded (not-yet-registered) employee — read-only review for HR/Admin.
            return employee_service.get_imported_employee_detail(
                db, staging_id=employee_id.split(":", 1)[1]
            )
        payload = employee_service.get_employee_detail(db, employee_id=employee_id)
        db.commit()
        return payload
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{employee_id}/documents/upload", response_model=EmployeeDocumentRead)
def upload_employee_document_for_staff(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
    type: Annotated[str, Form()],
    file: UploadFile = File(...),
):
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
        document = employee_service.upload_employee_document_for_profile(
            db,
            profile=profile,
            actor=current_user,
            file=file,
            type_=type,
            endpoint_scope="staff",
        )
        db.commit()
        return document
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{employee_id}/documents/verify-all")
@limiter.limit("12/minute")
def verify_all_employee_documents_route(
    request: Request,
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    # HR "Verify documents" button: re-run AI document-type verification across all
    # of this employee's uploaded documents and update their needs-review flags.
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        result = employee_service.verify_all_employee_documents(db, employee_id=employee_id)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{employee_id}/documents/{document_ref}/review")
@limiter.limit("30/minute")
def review_employee_document_route(
    request: Request,
    employee_id: str,
    document_ref: str,
    payload: EmployeeDocumentReviewRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
) -> dict:
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
        result = employee_service.review_employee_document(
            db,
            profile=profile,
            actor=current_user,
            document_ref=document_ref,
            status_value=payload.status,
            remarks=payload.remarks,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        logger.warning("Employee document review failed for %s/%s: %s", employee_id, document_ref, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not complete document review.") from exc


@router.get("/{employee_id}/documents/{document_ref}/preview")
def preview_employee_document(
    employee_id: str,
    document_ref: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
):
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    path, file_name, mime_type = employee_service.get_employee_document_for_download(
        db,
        profile=profile,
        document_ref=document_ref,
    )
    if path is None or file_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if isinstance(path, str):
        resolved_mime = _inline_preview_mime(Path(file_name), mime_type)
        if resolved_mime not in _SAFE_INLINE_MIME:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This document type cannot be previewed inline.",
            )
        return RedirectResponse(path)
    resolved_mime = _inline_preview_mime(path, mime_type)
    if resolved_mime not in {"application/pdf", "image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This document type cannot be previewed inline.",
        )
    return FileResponse(
        path=str(path),
        media_type=resolved_mime,
        filename=file_name,
        content_disposition_type="inline",
    )


@router.get("/{employee_id}/documents/{document_ref}/download")
def download_employee_document(
    employee_id: str,
    document_ref: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
):
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    path, file_name, mime_type = employee_service.get_employee_document_for_download(
        db,
        profile=profile,
        document_ref=document_ref,
    )
    if path is None or file_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if isinstance(path, str):
        return RedirectResponse(path)
    return FileResponse(
        path=str(path),
        filename=file_name,
        media_type="application/octet-stream",
    )


@router.get("/import/{staging_id}/documents/{index}/preview")
def preview_imported_document(
    staging_id: str,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
):
    """Inline preview of a pre-loaded (imported, not-yet-registered) employee document."""
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    path, file_name, mime_type = employee_service.get_imported_document_for_download(
        db, staging_id=staging_id, index=index
    )
    if path is None or file_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if isinstance(path, str):
        return RedirectResponse(path)
    resolved_mime = _inline_preview_mime(path, mime_type)
    if resolved_mime not in {"application/pdf", "image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This document type cannot be previewed inline.",
        )
    return FileResponse(
        path=str(path),
        media_type=resolved_mime,
        filename=file_name,
        content_disposition_type="inline",
    )


@router.get("/import/{staging_id}/documents/{index}/download")
def download_imported_document(
    staging_id: str,
    index: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
):
    """Download a pre-loaded (imported) employee document."""
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    path, file_name, _mime = employee_service.get_imported_document_for_download(
        db, staging_id=staging_id, index=index
    )
    if path is None or file_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if isinstance(path, str):
        return RedirectResponse(path)
    return FileResponse(path=str(path), filename=file_name, media_type="application/octet-stream")


@router.delete("/{employee_id}/documents/{document_ref}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee_document_for_staff(
    employee_id: str,
    document_ref: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
):
    _assert_employee_staff(current_user)
    _assert_employee_full_detail_access(current_user)
    try:
        profile = employee_service.get_employee_profile_or_404(db, employee_id=employee_id)
        employee_service.delete_employee_document(
            db,
            profile=profile,
            actor=current_user,
            document_ref=document_ref,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
