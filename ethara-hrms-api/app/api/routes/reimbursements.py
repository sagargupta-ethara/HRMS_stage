from __future__ import annotations

import csv
import io
import re
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import get_current_user, require_permissions
from app.core.database import get_db
from app.core.exports import csv_safe_row
from app.core.permissions import Permission
from app.db.models import (
    AdminSetting,
    EmployeeProfile,
    NotificationType,
    Project,
    ReimbursementActionLog,
    ReimbursementRequest,
    Role,
    User,
    generate_id,
)
from app.services.audit import log_audit
from app.services.integrations import StorageService
from app.services.workflows import create_notification

router = APIRouter(prefix="/reimbursements", tags=["reimbursements"])

DEFAULT_REIMBURSEMENT_CATEGORIES = [
    "Urgent Project Purchases",
    "Food & Logistics",
    "Transportation",
    "Other",
]
DEFAULT_REIMBURSEMENT_CONFIG = {
    "categories": DEFAULT_REIMBURSEMENT_CATEGORIES,
    "approvalRules": "Reporting manager approval followed by HR/Office admin approval.",
    "expenseLimit": None,
    "defaultCurrency": "INR",
}

CONFIG_NAMESPACE = "reimbursements"
CONFIG_KEY = "reimbursements:config"
EDITABLE_STATUSES = {
    "draft", "missing_information", "returned_by_manager",
    "returned_by_hr", "returned_by_leadership", "returned_by_finance",
}
REVOCABLE_STATUSES = {
    "draft",
    "missing_information",
    "pending_manager_review",
    "returned_by_manager",
    "manager_approved",
    "returned_by_finance",
    "approved_for_payment",
}
DELETABLE_STATUSES = {
    "draft",
    "submitted",
    "missing_information",
    "pending_manager_review",
    "returned_by_manager",
    "returned_by_finance",
    "manager_rejected",
    "finance_rejected",
    "revoked",
}
MANAGER_REVIEW_STATUSES = {"pending_manager_review"}
# "manager_approved" kept so any in-flight requests from the old flow still flow through HR.
HR_REVIEW_STATUSES = {"pending_hr_review", "manager_approved"}
LEADERSHIP_REVIEW_STATUSES = {"pending_leadership_review"}
FINANCE_REVIEW_STATUSES = {"manager_approved"}  # legacy; superseded by HR/Leadership stages
PAYMENT_STATUSES = {"approved_for_payment"}
FINANCE_ROLES = {Role.HR, Role.OFFICE_ADMIN}
HR_ROLES = {Role.HR}
LEADERSHIP_ROLES = {Role.LEADERSHIP}
PAYMENT_ROLES = {Role.OFFICE_ADMIN}
OVERRIDE_ROLES = {Role.ADMIN, Role.SUPER_ADMIN}
ADMIN_ROLES = {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}

STATUS_LABELS = {
    "draft": "Draft",
    "submitted": "Submitted",
    "missing_information": "Missing Information",
    "pending_manager_review": "Pending Manager Review",
    "returned_by_manager": "Returned by Manager",
    "manager_approved": "Manager Approved",
    "manager_rejected": "Manager Rejected",
    "pending_hr_review": "Pending HR Review",
    "returned_by_hr": "Returned by HR",
    "hr_approved": "HR Approved",
    "hr_rejected": "HR Rejected",
    "pending_leadership_review": "Pending Leadership Review",
    "returned_by_leadership": "Returned by Leadership",
    "leadership_approved": "Leadership Approved",
    "leadership_rejected": "Leadership Rejected",
    "pending_finance_review": "Pending HRs/Office admin Review",
    "returned_by_finance": "Returned by HRs/Office admin",
    "finance_approved": "HRs/Office admin Approved",
    "finance_rejected": "HRs/Office admin Rejected",
    "approved_for_payment": "Approved for Payment",
    "paid": "Paid — Please Acknowledge",
    "acknowledged": "Acknowledged",
    "revoked": "Revoked",
}


class ReimbursementActionRequest(BaseModel):
    action: str
    comment: str | None = None


class ReimbursementConfigUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    categories: list[str] | None = None
    approval_rules: str | None = Field(default=None, alias="approvalRules")
    expense_limit: float | None = Field(default=None, alias="expenseLimit")
    default_currency: str | None = Field(default=None, alias="defaultCurrency")


def _role_value(role: Role | str) -> str:
    return role.value if isinstance(role, Role) else str(role)


def _user_roles(user: User) -> set[str]:
    values = {_role_value(user.role)}
    for role in user.roles or []:
        values.add(str(role))
    return values


def _has_any_role(user: User, roles: set[Role]) -> bool:
    allowed = {_role_value(role) for role in roles}
    return bool(_user_roles(user) & allowed)


def _is_finance_reviewer(user: User) -> bool:
    return _has_any_role(user, FINANCE_ROLES | ADMIN_ROLES)


def _is_admin(user: User) -> bool:
    return _has_any_role(user, ADMIN_ROLES)


def _profile_for_user(db: Session, user: User) -> EmployeeProfile:
    profile = db.scalar(
        select(EmployeeProfile).where(
            or_(
                EmployeeProfile.user_id == user.id,
                EmployeeProfile.ethara_email == user.email,
            )
        )
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Employee profile not found for this user.")
    return profile


def _load_request(db: Session, request_id: str) -> ReimbursementRequest:
    reimbursement = db.scalar(
        select(ReimbursementRequest)
        .where(ReimbursementRequest.id == request_id)
        .options(
            joinedload(ReimbursementRequest.employee_profile),
            joinedload(ReimbursementRequest.manager),
            joinedload(ReimbursementRequest.manager_reviewer),
            joinedload(ReimbursementRequest.finance_reviewer),
            joinedload(ReimbursementRequest.payer),
            selectinload(ReimbursementRequest.actions),
        )
    )
    if not reimbursement:
        raise HTTPException(status_code=404, detail="Reimbursement request not found.")
    return reimbursement


def _can_view(reimbursement: ReimbursementRequest, user: User) -> bool:
    if _is_finance_reviewer(user):
        return True
    if reimbursement.employee_profile and reimbursement.employee_profile.user_id == user.id:
        return True
    if reimbursement.manager_id == user.id:
        return True
    return False


def _ensure_can_view(reimbursement: ReimbursementRequest, user: User) -> None:
    if not _can_view(reimbursement, user):
        raise HTTPException(status_code=403, detail="Not authorized for this reimbursement request.")


def _get_config(db: Session) -> dict[str, Any]:
    record = db.scalar(select(AdminSetting).where(AdminSetting.key == CONFIG_KEY))
    if not record or not isinstance(record.value, dict):
        return dict(DEFAULT_REIMBURSEMENT_CONFIG)
    config = dict(DEFAULT_REIMBURSEMENT_CONFIG)
    config.update(record.value)
    categories = config.get("categories")
    if not isinstance(categories, list) or not categories:
        config["categories"] = DEFAULT_REIMBURSEMENT_CATEGORIES
    return config


def _normalize_text(value: str | None) -> str | None:
    cleaned = (value or "").strip()
    return cleaned or None


def _parse_expense_date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Expense date must be in YYYY-MM-DD format.") from exc


def _parse_amount(value: str | float | int | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        amount = float(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Expense amount must be a valid number.") from exc
    return amount


def _file_size(upload: UploadFile) -> int | None:
    try:
        upload.file.seek(0, 2)
        size = upload.file.tell()
        upload.file.seek(0)
        return int(size)
    except Exception:
        return None


def _read_upload_bytes(upload: UploadFile) -> bytes:
    try:
        upload.file.seek(0)
        content = upload.file.read() or b""
        upload.file.seek(0)
        return content
    except Exception:
        return b""


def _unique_text_blocks(blocks: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for block in blocks:
        cleaned = "\n".join(line.strip() for line in block.splitlines() if line.strip())
        key = re.sub(r"\s+", " ", cleaned).lower()
        if cleaned and key not in seen:
            seen.add(key)
            unique.append(cleaned)
    return unique


def _extract_receipt_text(receipt: UploadFile) -> str:
    content = _read_upload_bytes(receipt)
    if not content:
        return ""

    text_passes: list[str] = []
    suffix = Path(receipt.filename or "").suffix.lower()
    content_type = (receipt.content_type or "").split(";", maxsplit=1)[0].lower()

    try:
        from app.api.routes.candidates import (
            _document_image_ocr_payloads,
            _extract_text_with_rapidocr,
            extract_pdf_text,
            extract_text_with_pymupdf_ocr,
            is_image_upload,
            resolve_pymupdf_filetype,
        )

        if suffix == ".pdf" or content_type == "application/pdf":
            pdf_text = extract_pdf_text(content)
            if pdf_text.strip():
                text_passes.append(pdf_text)

        if is_image_upload(receipt):
            for payload in _document_image_ocr_payloads(content):
                text_passes.extend(_extract_text_with_rapidocr(payload, image_upload=True))
        elif suffix == ".pdf" or content_type == "application/pdf":
            text_passes.extend(_extract_text_with_rapidocr(content, image_upload=False, max_pages=2))

        filetype = resolve_pymupdf_filetype(receipt)
        if filetype:
            pymupdf_text = extract_text_with_pymupdf_ocr(content, filetype=filetype, full_ocr=True)
            if pymupdf_text.strip():
                text_passes.append(pymupdf_text)
    except Exception:
        pass

    if not text_passes:
        try:
            text_passes.append(content.decode("utf-8", errors="ignore"))
        except Exception:
            return ""

    return "\n".join(_unique_text_blocks(text_passes)).strip()


def _money_value(value: str) -> float | None:
    cleaned = value.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        amount = float(cleaned)
    except ValueError:
        return None
    if amount <= 0 or amount > 10_000_000:
        return None
    return round(amount, 2)


def _extract_amount_candidates(text: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    amount_pattern = re.compile(
        r"(?:rs\.?|inr|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.\d{1,2})?|[0-9]+(?:\.\d{1,2})?)",
        re.IGNORECASE,
    )
    high_priority = ("grand total", "total amount", "amount payable", "net payable", "invoice total", "balance due")
    medium_priority = ("total", "amount", "subtotal", "taxable", "paid")

    for line in text.splitlines():
        compact = re.sub(r"\s+", " ", line).strip()
        if not compact:
            continue
        lower = compact.lower()
        if any(skip in lower for skip in ("gstin", "phone", "mobile", "invoice no", "bill no")):
            priority = 0
        elif any(label in lower for label in high_priority):
            priority = 3
        elif any(label in lower for label in medium_priority):
            priority = 2
        else:
            priority = 1
        for match in amount_pattern.finditer(compact):
            amount = _money_value(match.group(1))
            if amount is None:
                continue
            candidates.append({"amount": amount, "line": compact[:160], "priority": priority})

    candidates.sort(key=lambda item: (item["priority"], item["amount"]), reverse=True)
    deduped: list[dict[str, Any]] = []
    seen: set[float] = set()
    for candidate in candidates:
        amount = candidate["amount"]
        if amount in seen:
            continue
        seen.add(amount)
        deduped.append(candidate)
        if len(deduped) >= 6:
            break
    return deduped


def _extract_invoice_date(text: str) -> str | None:
    patterns = [
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
        r"\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4}\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(0)
    return None


def _extract_vendor(lines: list[str]) -> str | None:
    ignored = ("invoice", "tax invoice", "receipt", "bill of supply", "cash memo")
    for line in lines[:8]:
        cleaned = re.sub(r"\s+", " ", line).strip(" -:|")
        lower = cleaned.lower()
        if len(cleaned) < 3 or not re.search(r"[A-Za-z]", cleaned):
            continue
        if any(label == lower for label in ignored):
            continue
        if any(skip in lower for skip in ("gstin", "date", "invoice no", "phone", "mobile")):
            continue
        return cleaned[:120]
    return None


def _with_receipt_amount_validation(
    payload: dict[str, Any],
    *,
    expected_amount: float | None,
    currency: str | None,
) -> dict[str, Any]:
    ocr_amount = payload.get("amount")
    if expected_amount is None or not ocr_amount:
        payload["validationStatus"] = "needs_review"
        payload["validationMessage"] = "OCR amount could not be compared with the claimed amount."
        return payload

    difference = round(abs(float(ocr_amount) - float(expected_amount)), 2)
    tolerance = max(1.0, round(float(expected_amount) * 0.01, 2))
    if difference <= tolerance:
        payload["validationStatus"] = "matched"
        payload["validationMessage"] = (
            f"OCR amount matches the claimed {currency or 'INR'} {float(expected_amount):.2f} within tolerance."
        )
    else:
        payload["validationStatus"] = "mismatch"
        payload["validationMessage"] = (
            f"OCR found {currency or 'INR'} {float(ocr_amount):.2f}, "
            f"but the claimed amount is {currency or 'INR'} {float(expected_amount):.2f}."
        )
    payload["claimedAmount"] = round(float(expected_amount), 2)
    payload["amountDifference"] = difference
    return payload


def _analyze_receipt_upload(
    receipt: UploadFile,
    *,
    expected_amount: float | None,
    currency: str | None,
) -> dict[str, Any]:
    text = _extract_receipt_text(receipt)
    if not text:
        return _with_receipt_amount_validation(
            {
                "status": "needs_review",
                "summary": "Receipt OCR could not read text from this attachment.",
                "vendor": None,
                "invoiceDate": None,
                "amount": None,
                "amountCandidates": [],
                "textSnippet": "",
            },
            expected_amount=expected_amount,
            currency=currency,
        )

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    amount_candidates = _extract_amount_candidates(text)
    amount = amount_candidates[0]["amount"] if amount_candidates else None
    vendor = _extract_vendor(lines)
    invoice_date = _extract_invoice_date(text)
    summary_bits = [
        f"Vendor: {vendor or 'Not detected'}",
        f"Date: {invoice_date or 'Not detected'}",
        f"Amount: {(currency or 'INR')} {amount:.2f}" if amount else "Amount: Not detected",
    ]
    payload = {
        "status": "extracted" if amount or vendor or invoice_date else "needs_review",
        "summary": "; ".join(summary_bits),
        "vendor": vendor,
        "invoiceDate": invoice_date,
        "amount": amount,
        "amountCandidates": amount_candidates,
        "lineCount": len(lines),
        "textSnippet": "\n".join(lines[:20])[:2000],
    }
    return _with_receipt_amount_validation(payload, expected_amount=expected_amount, currency=currency)


def _missing_fields(reimbursement: ReimbursementRequest) -> list[str]:
    missing: list[str] = []
    checks = [
        ("Employee Name", reimbursement.employee_name),
        ("Employee ID", reimbursement.employee_code),
        ("Department", reimbursement.department),
        ("Project Name", reimbursement.project_name),
        ("Reimbursement Category", reimbursement.category),
        ("Expense Date", reimbursement.expense_date),
        ("Expense Amount", reimbursement.expense_amount),
        ("Reason for Expense", reimbursement.reason),
        ("Payment Method", reimbursement.payment_method),
        ("Receipt/Invoice Upload", reimbursement.receipt_file_url),
        ("Official Expense Declaration", reimbursement.declaration_accepted),
        ("Reporting Manager", reimbursement.manager_id),
    ]
    for label, value in checks:
        if value is None or value is False or value == "":
            missing.append(label)
    if reimbursement.expense_amount is not None and reimbursement.expense_amount <= 0:
        missing.append("Expense Amount must be greater than 0")
    return missing


def _next_submit_status(current_status: str, missing: list[str]) -> str:
    if missing:
        return "missing_information"
    if current_status == "returned_by_finance":
        return "manager_approved"
    return "pending_manager_review"


def _log_action(
    db: Session,
    *,
    reimbursement: ReimbursementRequest,
    actor: User,
    action: str,
    from_status: str | None,
    to_status: str | None,
    comment: str | None = None,
) -> None:
    db.add(
        ReimbursementActionLog(
            id=generate_id(),
            reimbursement_id=reimbursement.id,
            action=action,
            from_status=from_status,
            to_status=to_status,
            comment=comment,
            performed_by=actor.id,
            performed_by_name=actor.name,
            performed_by_role=_role_value(actor.role),
        )
    )


def _notify_user(
    db: Session,
    *,
    user: User | None,
    title: str,
    message: str,
    type_: NotificationType = NotificationType.INFO,
) -> None:
    if not user:
        return
    create_notification(db, user_id=user.id, title=title, message=message, type_=type_)


def _reimbursement_details(reimbursement: ReimbursementRequest) -> str:
    """A detailed text block (amount, category, reason, receipt link) appended to
    each approval-stage in-app notification so approvers see the request context."""
    from app.core.config import get_settings

    settings = get_settings()
    base = settings.frontend_url.rstrip("/")
    amount = f"{reimbursement.currency} {reimbursement.expense_amount or 0:.2f}"
    lines = [
        f"Employee: {reimbursement.employee_name} ({reimbursement.employee_code})",
        f"Department: {reimbursement.department or '—'}",
        f"Project: {reimbursement.project_name or '—'}",
        f"Category: {reimbursement.category or '—'}",
        f"Expense date: {reimbursement.expense_date.isoformat() if reimbursement.expense_date else '—'}",
        f"Amount: {amount}",
        f"Reason: {reimbursement.reason or '—'}",
    ]
    if reimbursement.receipt_file_url:
        url = reimbursement.receipt_file_url
        if url.startswith("/"):
            url = f"{base}{url}"
        lines.append(f"Receipt: {url}")
    lines.append(f"Review in HRMS: {base}/dashboard/reimbursements")
    return "\n".join(lines)


def _notify_roles(
    db: Session,
    *,
    roles: set[Role],
    title: str,
    message: str,
    type_: NotificationType = NotificationType.INFO,
) -> None:
    seen: set[str] = set()
    for user in db.scalars(select(User).where(User.is_active.is_(True))):
        if user.id in seen or not _has_any_role(user, roles):
            continue
        seen.add(user.id)
        _notify_user(db, user=user, title=title, message=message, type_=type_)


def _serialize(reimbursement: ReimbursementRequest) -> dict[str, Any]:
    actions = sorted(reimbursement.actions or [], key=lambda item: item.created_at)
    return {
        "id": reimbursement.id,
        "employeeProfileId": reimbursement.employee_profile_id,
        "employeeName": reimbursement.employee_name,
        "employeeId": reimbursement.employee_code,
        "employeeCode": reimbursement.employee_code,
        "department": reimbursement.department,
        "projectName": reimbursement.project_name,
        "projectId": reimbursement.project_id,
        "category": reimbursement.category,
        "expenseDate": reimbursement.expense_date.isoformat() if reimbursement.expense_date else None,
        "expenseAmount": reimbursement.expense_amount,
        "currency": reimbursement.currency,
        "reason": reimbursement.reason,
        "paymentMethod": reimbursement.payment_method,
        "receiptFileName": reimbursement.receipt_file_name,
        "receiptFileUrl": reimbursement.receipt_file_url,
        "receiptMimeType": reimbursement.receipt_mime_type,
        "receiptFileSize": reimbursement.receipt_file_size,
        "receiptOcr": reimbursement.receipt_ocr,
        "declarationAccepted": reimbursement.declaration_accepted,
        "status": reimbursement.status,
        "statusLabel": STATUS_LABELS.get(reimbursement.status, reimbursement.status),
        "missingFields": reimbursement.missing_fields or [],
        "managerId": reimbursement.manager_id,
        "managerName": reimbursement.manager.name if reimbursement.manager else None,
        "managerReviewedBy": reimbursement.manager_reviewer.name if reimbursement.manager_reviewer else None,
        "managerReviewedAt": reimbursement.manager_reviewed_at.isoformat() if reimbursement.manager_reviewed_at else None,
        "managerComments": reimbursement.manager_comments,
        "financeReviewedBy": reimbursement.finance_reviewer.name if reimbursement.finance_reviewer else None,
        "financeReviewedAt": reimbursement.finance_reviewed_at.isoformat() if reimbursement.finance_reviewed_at else None,
        "financeComments": reimbursement.finance_comments,
        "hrReviewedBy": reimbursement.hr_reviewer.name if reimbursement.hr_reviewer else None,
        "hrReviewedAt": reimbursement.hr_reviewed_at.isoformat() if reimbursement.hr_reviewed_at else None,
        "hrComments": reimbursement.hr_comments,
        "leadershipReviewedBy": reimbursement.leadership_reviewer.name if reimbursement.leadership_reviewer else None,
        "leadershipReviewedAt": reimbursement.leadership_reviewed_at.isoformat() if reimbursement.leadership_reviewed_at else None,
        "leadershipComments": reimbursement.leadership_comments,
        "acknowledgedAt": reimbursement.acknowledged_at.isoformat() if reimbursement.acknowledged_at else None,
        "paidBy": reimbursement.payer.name if reimbursement.payer else None,
        "paidAt": reimbursement.paid_at.isoformat() if reimbursement.paid_at else None,
        "submittedAt": reimbursement.submitted_at.isoformat() if reimbursement.submitted_at else None,
        "createdAt": reimbursement.created_at.isoformat() if reimbursement.created_at else None,
        "updatedAt": reimbursement.updated_at.isoformat() if reimbursement.updated_at else None,
        "auditTrail": [
            {
                "id": action.id,
                "action": action.action,
                "fromStatus": action.from_status,
                "toStatus": action.to_status,
                "comment": action.comment,
                "performedBy": action.performed_by_name,
                "performedByRole": action.performed_by_role,
                "createdAt": action.created_at.isoformat() if action.created_at else None,
            }
            for action in actions
        ],
    }


def _base_query():
    return select(ReimbursementRequest).options(
        joinedload(ReimbursementRequest.employee_profile),
        joinedload(ReimbursementRequest.manager),
        joinedload(ReimbursementRequest.manager_reviewer),
        joinedload(ReimbursementRequest.finance_reviewer),
        joinedload(ReimbursementRequest.payer),
        selectinload(ReimbursementRequest.actions),
    )


def _scoped_requests(db: Session, current_user: User, *, status_filter: str | None = None) -> list[ReimbursementRequest]:
    query = _base_query()
    if _is_finance_reviewer(current_user):
        pass
    elif _has_any_role(current_user, {Role.MANAGER}):
        profile = db.scalar(select(EmployeeProfile).where(EmployeeProfile.user_id == current_user.id))
        filters = [ReimbursementRequest.manager_id == current_user.id]
        if profile:
            filters.append(ReimbursementRequest.employee_profile_id == profile.id)
        query = query.where(or_(*filters))
    else:
        profile = _profile_for_user(db, current_user)
        query = query.where(ReimbursementRequest.employee_profile_id == profile.id)
    if status_filter:
        query = query.where(ReimbursementRequest.status == status_filter)
    query = query.order_by(ReimbursementRequest.updated_at.desc(), ReimbursementRequest.created_at.desc())
    return list(db.scalars(query).unique())


def _apply_form_values(
    db: Session,
    *,
    reimbursement: ReimbursementRequest,
    profile: EmployeeProfile,
    employee_name: str | None,
    employee_id: str | None,
    department: str | None,
    project_name: str | None,
    category: str | None,
    expense_date: str | None,
    expense_amount: str | None,
    currency: str | None,
    reason: str | None,
    payment_method: str | None,
    declaration_accepted: bool,
    receipt: UploadFile | None,
    project_id: str | None = None,
) -> None:
    config = _get_config(db)
    reimbursement.employee_name = _normalize_text(employee_name) or profile.full_name
    reimbursement.employee_code = _normalize_text(employee_id) or profile.employee_code
    reimbursement.department = _normalize_text(department) or profile.department
    # Link to a real Project; the free-text projectName mirrors the project name
    # for display/back-compat (and is what the submit validation checks).
    project_id = _normalize_text(project_id)
    if project_id:
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=422, detail="Selected project does not exist.")
        reimbursement.project_id = project.id
        reimbursement.project_name = project.internal_name
    else:
        reimbursement.project_id = None
        reimbursement.project_name = _normalize_text(project_name)
    reimbursement.category = _normalize_text(category)
    reimbursement.expense_date = _parse_expense_date(expense_date)
    reimbursement.expense_amount = _parse_amount(expense_amount)
    reimbursement.currency = (_normalize_text(currency) or str(config.get("defaultCurrency") or "INR")).upper()
    reimbursement.reason = _normalize_text(reason)
    reimbursement.payment_method = _normalize_text(payment_method)
    reimbursement.declaration_accepted = declaration_accepted
    reimbursement.manager_id = profile.manager_id

    if receipt and receipt.filename:
        file_url, _storage_path = StorageService().save_upload(
            receipt,
            folder="reimbursements/receipts",
            allowed_content_types={
                "application/pdf",
                "image/jpeg",
                "image/png",
                "image/webp",
            },
        )
        reimbursement.receipt_file_name = receipt.filename
        reimbursement.receipt_file_url = file_url
        reimbursement.receipt_mime_type = receipt.content_type
        reimbursement.receipt_file_size = _file_size(receipt)
        reimbursement.receipt_ocr = _analyze_receipt_upload(
            receipt,
            expected_amount=reimbursement.expense_amount,
            currency=reimbursement.currency,
        )
    elif reimbursement.receipt_ocr:
        reimbursement.receipt_ocr = _with_receipt_amount_validation(
            dict(reimbursement.receipt_ocr),
            expected_amount=reimbursement.expense_amount,
            currency=reimbursement.currency,
        )


@router.get("/config")
def get_reimbursement_config(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_READ))],
) -> dict[str, Any]:
    return _get_config(db)


@router.put("/config")
def update_reimbursement_config(
    payload: ReimbursementConfigUpdate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_ADMIN))],
) -> dict[str, Any]:
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only admins can configure reimbursements.")
    current = _get_config(db)
    if payload.categories is not None:
        categories = [item.strip() for item in payload.categories if item and item.strip()]
        if not categories:
            raise HTTPException(status_code=422, detail="At least one reimbursement category is required.")
        current["categories"] = categories
    if payload.approval_rules is not None:
        current["approvalRules"] = payload.approval_rules.strip()
    if payload.expense_limit is not None:
        if payload.expense_limit <= 0:
            raise HTTPException(status_code=422, detail="Expense limit must be greater than 0.")
        current["expenseLimit"] = payload.expense_limit
    if payload.default_currency is not None:
        current["defaultCurrency"] = payload.default_currency.strip().upper() or "INR"

    record = db.scalar(select(AdminSetting).where(AdminSetting.key == CONFIG_KEY))
    if record is None:
        record = AdminSetting(
            namespace=CONFIG_NAMESPACE,
            key=CONFIG_KEY,
            value=current,
            description="Reimbursement category, rule, and limit configuration.",
            updated_by=current_user.id,
        )
    else:
        record.value = current
        record.updated_by = current_user.id
    db.add(record)
    log_audit(
        db,
        entity_type="reimbursement_config",
        entity_id=record.id,
        action="config_updated",
        actor=current_user,
        request=request,
        new_value=current,
    )
    db.commit()
    return current


@router.get("/categories")
def list_reimbursement_categories(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_READ))],
) -> list[str]:
    return list(_get_config(db)["categories"])


@router.get("/export")
def export_reimbursements(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_READ))],
):
    if not _is_finance_reviewer(current_user):
        raise HTTPException(status_code=403, detail="Only Finance/Admin reviewers can export reimbursement reports.")
    rows = _scoped_requests(db, current_user)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Request ID",
            "Employee Name",
            "Employee ID",
            "Department",
            "Project Name",
            "Category",
            "Expense Date",
            "Currency",
            "Amount",
            "Payment Method",
            "Status",
            "Manager",
            "Manager Comments",
            "HR/Office Admin Comments",
            "Paid At",
            "Receipt URL",
            "Created At",
            "Updated At",
        ]
    )
    for row in rows:
        writer.writerow(
            csv_safe_row([
                row.id,
                row.employee_name,
                row.employee_code,
                row.department or "",
                row.project_name or "",
                row.category or "",
                row.expense_date.isoformat() if row.expense_date else "",
                row.currency,
                row.expense_amount if row.expense_amount is not None else "",
                row.payment_method or "",
                STATUS_LABELS.get(row.status, row.status),
                row.manager.name if row.manager else "",
                row.manager_comments or "",
                row.finance_comments or "",
                row.paid_at.isoformat() if row.paid_at else "",
                row.receipt_file_url or "",
                row.created_at.isoformat() if row.created_at else "",
                row.updated_at.isoformat() if row.updated_at else "",
            ])
        )
    output.seek(0)
    filename = f"reimbursement_report_{datetime.now(UTC).date().isoformat()}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("")
def list_reimbursements(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_READ))],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> list[dict[str, Any]]:
    return [_serialize(item) for item in _scoped_requests(db, current_user, status_filter=status_filter)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_reimbursement(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_WRITE))],
    employee_name: Annotated[str | None, Form(alias="employeeName")] = None,
    employee_id: Annotated[str | None, Form(alias="employeeId")] = None,
    department: Annotated[str | None, Form(alias="department")] = None,
    project_name: Annotated[str | None, Form(alias="projectName")] = None,
    project_id: Annotated[str | None, Form(alias="projectId")] = None,
    category: Annotated[str | None, Form(alias="category")] = None,
    expense_date: Annotated[str | None, Form(alias="expenseDate")] = None,
    expense_amount: Annotated[str | None, Form(alias="expenseAmount")] = None,
    currency: Annotated[str | None, Form(alias="currency")] = None,
    reason: Annotated[str | None, Form(alias="reason")] = None,
    payment_method: Annotated[str | None, Form(alias="paymentMethod")] = None,
    declaration_accepted: Annotated[bool, Form(alias="declarationAccepted")] = False,
    save_as_draft: Annotated[bool, Form(alias="saveAsDraft")] = False,
    receipt: Annotated[UploadFile | None, File(alias="receipt")] = None,
) -> dict[str, Any]:
    profile = _profile_for_user(db, current_user)
    reimbursement = ReimbursementRequest(
        id=generate_id(),
        employee_profile_id=profile.id,
        employee_name=profile.full_name,
        employee_code=profile.employee_code,
        department=profile.department,
        project_name=None,
        category=None,
        expense_date=None,
        expense_amount=None,
        currency=str(_get_config(db).get("defaultCurrency") or "INR"),
        reason=None,
        payment_method=None,
        declaration_accepted=False,
        status="draft",
        manager_id=profile.manager_id,
        missing_fields=[],
    )
    _apply_form_values(
        db,
        reimbursement=reimbursement,
        profile=profile,
        employee_name=employee_name,
        employee_id=employee_id,
        department=department,
        project_name=project_name,
        project_id=project_id,
        category=category,
        expense_date=expense_date,
        expense_amount=expense_amount,
        currency=currency,
        reason=reason,
        payment_method=payment_method,
        declaration_accepted=declaration_accepted,
        receipt=receipt,
    )
    missing = _missing_fields(reimbursement)
    reimbursement.missing_fields = missing
    reimbursement.status = "draft" if save_as_draft else _next_submit_status(reimbursement.status, missing)
    if reimbursement.status != "draft":
        reimbursement.submitted_at = datetime.now(UTC)

    db.add(reimbursement)
    db.flush()
    _log_action(
        db,
        reimbursement=reimbursement,
        actor=current_user,
        action="draft_saved" if save_as_draft else reimbursement.status,
        from_status=None,
        to_status=reimbursement.status,
        comment="; ".join(missing) if missing else None,
    )
    log_audit(
        db,
        entity_type="reimbursement_request",
        entity_id=reimbursement.id,
        action="created",
        actor=current_user,
        request=request,
        user_id=current_user.id,
        new_value={"status": reimbursement.status, "amount": reimbursement.expense_amount},
    )

    if reimbursement.status == "pending_manager_review":
        _notify_user(
            db,
            user=reimbursement.manager,
            title="Reimbursement request pending review",
            message=f"{reimbursement.employee_name} submitted a reimbursement request for {reimbursement.currency} {reimbursement.expense_amount:.2f}.",
            type_=NotificationType.ACTION,
        )
    elif reimbursement.status == "missing_information":
        _notify_user(
            db,
            user=current_user,
            title="Reimbursement request needs information",
            message=f"Please update missing fields: {', '.join(missing)}.",
            type_=NotificationType.WARNING,
        )
    db.commit()
    return _serialize(_load_request(db, reimbursement.id))


@router.get("/{request_id}")
def get_reimbursement(
    request_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_READ))],
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    _ensure_can_view(reimbursement, current_user)
    return _serialize(reimbursement)


@router.post("/{request_id}/revoke")
def revoke_reimbursement(
    request_id: str,
    payload: ReimbursementActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_WRITE))],
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    profile = reimbursement.employee_profile
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the employee can revoke this reimbursement request.")
    if reimbursement.status not in REVOCABLE_STATUSES:
        raise HTTPException(status_code=400, detail="This reimbursement request can no longer be revoked.")

    old_status = reimbursement.status
    comment = (payload.comment or "").strip() or "Revoked by employee"
    reimbursement.status = "revoked"
    reimbursement.missing_fields = []
    db.add(reimbursement)
    db.flush()

    _log_action(
        db,
        reimbursement=reimbursement,
        actor=current_user,
        action="revoked",
        from_status=old_status,
        to_status=reimbursement.status,
        comment=comment,
    )
    log_audit(
        db,
        entity_type="reimbursement_request",
        entity_id=reimbursement.id,
        action="revoked",
        actor=current_user,
        request=request,
        user_id=current_user.id,
        old_value={"status": old_status},
        new_value={"status": reimbursement.status},
    )

    if old_status == "pending_manager_review" and reimbursement.manager:
        _notify_user(
            db,
            user=reimbursement.manager,
            title="Reimbursement request revoked",
            message=f"{reimbursement.employee_name} revoked a reimbursement request.",
            type_=NotificationType.INFO,
        )
    elif old_status in {"manager_approved", "approved_for_payment"}:
        _notify_roles(
            db,
            roles=FINANCE_ROLES | ADMIN_ROLES,
            title="Reimbursement request revoked",
            message=f"{reimbursement.employee_name} revoked a reimbursement request.",
            type_=NotificationType.INFO,
        )

    db.commit()
    return _serialize(_load_request(db, reimbursement.id))


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reimbursement(
    request_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_WRITE))],
) -> None:
    reimbursement = _load_request(db, request_id)
    profile = reimbursement.employee_profile
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the employee can delete this reimbursement request.")
    if reimbursement.status not in DELETABLE_STATUSES:
        raise HTTPException(status_code=400, detail="This reimbursement request can no longer be deleted.")

    old_value = {
        "status": reimbursement.status,
        "projectName": reimbursement.project_name,
        "amount": reimbursement.expense_amount,
        "currency": reimbursement.currency,
    }
    log_audit(
        db,
        entity_type="reimbursement_request",
        entity_id=reimbursement.id,
        action="deleted",
        actor=current_user,
        request=request,
        user_id=current_user.id,
        old_value=old_value,
    )
    db.delete(reimbursement)
    db.commit()
    return None


@router.patch("/{request_id}")
def update_reimbursement(
    request_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_WRITE))],
    employee_name: Annotated[str | None, Form(alias="employeeName")] = None,
    employee_id: Annotated[str | None, Form(alias="employeeId")] = None,
    department: Annotated[str | None, Form(alias="department")] = None,
    project_name: Annotated[str | None, Form(alias="projectName")] = None,
    project_id: Annotated[str | None, Form(alias="projectId")] = None,
    category: Annotated[str | None, Form(alias="category")] = None,
    expense_date: Annotated[str | None, Form(alias="expenseDate")] = None,
    expense_amount: Annotated[str | None, Form(alias="expenseAmount")] = None,
    currency: Annotated[str | None, Form(alias="currency")] = None,
    reason: Annotated[str | None, Form(alias="reason")] = None,
    payment_method: Annotated[str | None, Form(alias="paymentMethod")] = None,
    declaration_accepted: Annotated[bool, Form(alias="declarationAccepted")] = False,
    save_as_draft: Annotated[bool, Form(alias="saveAsDraft")] = False,
    receipt: Annotated[UploadFile | None, File(alias="receipt")] = None,
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    profile = reimbursement.employee_profile
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the employee can update this reimbursement request.")
    if reimbursement.status not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="This reimbursement request can no longer be edited.")

    old_status = reimbursement.status
    _apply_form_values(
        db,
        reimbursement=reimbursement,
        profile=profile,
        employee_name=employee_name,
        employee_id=employee_id,
        department=department,
        project_name=project_name,
        project_id=project_id,
        category=category,
        expense_date=expense_date,
        expense_amount=expense_amount,
        currency=currency,
        reason=reason,
        payment_method=payment_method,
        declaration_accepted=declaration_accepted,
        receipt=receipt,
    )
    missing = _missing_fields(reimbursement)
    reimbursement.missing_fields = missing
    reimbursement.status = "draft" if save_as_draft else _next_submit_status(old_status, missing)
    if reimbursement.status != "draft" and not reimbursement.submitted_at:
        reimbursement.submitted_at = datetime.now(UTC)
    db.add(reimbursement)
    db.flush()

    _log_action(
        db,
        reimbursement=reimbursement,
        actor=current_user,
        action="draft_saved" if save_as_draft else "resubmitted",
        from_status=old_status,
        to_status=reimbursement.status,
        comment="; ".join(missing) if missing else None,
    )
    log_audit(
        db,
        entity_type="reimbursement_request",
        entity_id=reimbursement.id,
        action="updated",
        actor=current_user,
        request=request,
        user_id=current_user.id,
        old_value={"status": old_status},
        new_value={"status": reimbursement.status, "amount": reimbursement.expense_amount},
    )

    if reimbursement.status == "pending_manager_review":
        _notify_user(
            db,
            user=reimbursement.manager,
            title="Reimbursement clarification submitted",
            message=f"{reimbursement.employee_name} updated a reimbursement request for manager review.",
            type_=NotificationType.ACTION,
        )
    elif reimbursement.status == "manager_approved":
        _notify_roles(
            db,
            roles=FINANCE_ROLES | ADMIN_ROLES,
            title="Reimbursement clarification submitted",
            message=f"{reimbursement.employee_name} updated a reimbursement request for HR/Office admin review.",
            type_=NotificationType.ACTION,
        )
    db.commit()
    return _serialize(_load_request(db, reimbursement.id))


@router.post("/{request_id}/manager-action")
def manager_action(
    request_id: str,
    payload: ReimbursementActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_REVIEW))],
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    if not (_is_admin(current_user) or reimbursement.manager_id == current_user.id):
        raise HTTPException(status_code=403, detail="Only the reporting manager can review this request.")
    if reimbursement.status not in MANAGER_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Request is not pending manager review.")
    action = payload.action.strip().lower()
    if action not in {"approve", "reject", "return"}:
        raise HTTPException(status_code=422, detail="Action must be approve, reject, or return.")
    comment = (payload.comment or "").strip()
    if action in {"reject", "return"} and not comment:
        raise HTTPException(status_code=422, detail="Manager comments are required for return/rejection.")

    old_status = reimbursement.status
    now = datetime.now(UTC)
    if action == "approve":
        reimbursement.status = "pending_hr_review"
        reimbursement.manager_comments = comment or "Approved"
    elif action == "reject":
        reimbursement.status = "manager_rejected"
        reimbursement.manager_comments = comment
    else:
        reimbursement.status = "returned_by_manager"
        reimbursement.manager_comments = comment
    reimbursement.manager_reviewed_by = current_user.id
    reimbursement.manager_reviewed_at = now
    reimbursement.missing_fields = []
    db.add(reimbursement)
    db.flush()

    _log_action(
        db,
        reimbursement=reimbursement,
        actor=current_user,
        action=f"manager_{action}",
        from_status=old_status,
        to_status=reimbursement.status,
        comment=reimbursement.manager_comments,
    )
    log_audit(
        db,
        entity_type="reimbursement_request",
        entity_id=reimbursement.id,
        action=f"manager_{action}",
        actor=current_user,
        request=request,
        user_id=reimbursement.employee_profile.user_id,
        old_value={"status": old_status},
        new_value={"status": reimbursement.status},
    )

    owner = reimbursement.employee_profile.user if reimbursement.employee_profile else None
    if action == "approve":
        _notify_roles(
            db,
            roles=HR_ROLES,
            title="Reimbursement pending HR review",
            message=(
                f"{reimbursement.employee_name}'s reimbursement was approved by the manager "
                f"and needs HR review.\n\n{_reimbursement_details(reimbursement)}"
            ),
            type_=NotificationType.ACTION,
        )
    _notify_user(
        db,
        user=owner,
        title="Reimbursement manager review updated",
        message=f"Your reimbursement request is now {STATUS_LABELS.get(reimbursement.status, reimbursement.status)}.",
        type_=NotificationType.SUCCESS if action == "approve" else NotificationType.WARNING,
    )
    db.commit()
    return _serialize(_load_request(db, reimbursement.id))


@router.post("/{request_id}/hr-action")
def hr_action(
    request_id: str,
    payload: ReimbursementActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_REVIEW))],
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    if not _has_any_role(current_user, HR_ROLES | OVERRIDE_ROLES):
        raise HTTPException(status_code=403, detail="Only HR can act on this request.")
    if reimbursement.status not in HR_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Request is not pending HR review.")
    action = payload.action.strip().lower()
    if action not in {"approve", "reject", "return"}:
        raise HTTPException(status_code=422, detail="Action must be approve, reject, or return.")
    comment = (payload.comment or "").strip()
    if action in {"reject", "return"} and not comment:
        raise HTTPException(status_code=422, detail="HR comments are required for return/rejection.")

    old_status = reimbursement.status
    now = datetime.now(UTC)
    if action == "approve":
        reimbursement.status = "pending_leadership_review"
        reimbursement.hr_comments = comment or "Approved"
    elif action == "reject":
        reimbursement.status = "hr_rejected"
        reimbursement.hr_comments = comment
    else:
        reimbursement.status = "returned_by_hr"
        reimbursement.hr_comments = comment
    reimbursement.hr_reviewed_by = current_user.id
    reimbursement.hr_reviewed_at = now
    reimbursement.missing_fields = []
    db.add(reimbursement)
    db.flush()

    _log_action(db, reimbursement=reimbursement, actor=current_user, action=f"hr_{action}",
                from_status=old_status, to_status=reimbursement.status, comment=reimbursement.hr_comments)
    log_audit(db, entity_type="reimbursement_request", entity_id=reimbursement.id, action=f"hr_{action}",
              actor=current_user, request=request, user_id=reimbursement.employee_profile.user_id,
              old_value={"status": old_status}, new_value={"status": reimbursement.status})

    owner = reimbursement.employee_profile.user if reimbursement.employee_profile else None
    if action == "approve":
        _notify_roles(
            db,
            roles=LEADERSHIP_ROLES,
            title="Reimbursement pending Leadership review",
            message=(
                f"{reimbursement.employee_name}'s reimbursement was approved by HR and needs "
                f"Leadership approval.\n\n{_reimbursement_details(reimbursement)}"
            ),
            type_=NotificationType.ACTION,
        )
    _notify_user(db, user=owner, title="Reimbursement HR review updated",
                 message=f"Your reimbursement request is now {STATUS_LABELS.get(reimbursement.status, reimbursement.status)}.",
                 type_=NotificationType.SUCCESS if action == "approve" else NotificationType.WARNING)
    db.commit()
    return _serialize(_load_request(db, reimbursement.id))


@router.post("/{request_id}/leadership-action")
def leadership_action(
    request_id: str,
    payload: ReimbursementActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_REVIEW))],
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    if not _has_any_role(current_user, LEADERSHIP_ROLES | OVERRIDE_ROLES):
        raise HTTPException(status_code=403, detail="Only Leadership can act on this request.")
    if reimbursement.status not in LEADERSHIP_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Request is not pending Leadership review.")
    action = payload.action.strip().lower()
    if action not in {"approve", "reject", "return"}:
        raise HTTPException(status_code=422, detail="Action must be approve, reject, or return.")
    comment = (payload.comment or "").strip()
    if action in {"reject", "return"} and not comment:
        raise HTTPException(status_code=422, detail="Leadership comments are required for return/rejection.")

    old_status = reimbursement.status
    now = datetime.now(UTC)
    if action == "approve":
        reimbursement.status = "approved_for_payment"
        reimbursement.leadership_comments = comment or "Approved for payment"
    elif action == "reject":
        reimbursement.status = "leadership_rejected"
        reimbursement.leadership_comments = comment
    else:
        reimbursement.status = "returned_by_leadership"
        reimbursement.leadership_comments = comment
    reimbursement.leadership_reviewed_by = current_user.id
    reimbursement.leadership_reviewed_at = now
    reimbursement.missing_fields = []
    db.add(reimbursement)
    db.flush()

    _log_action(db, reimbursement=reimbursement, actor=current_user, action=f"leadership_{action}",
                from_status=old_status, to_status=reimbursement.status, comment=reimbursement.leadership_comments)
    log_audit(db, entity_type="reimbursement_request", entity_id=reimbursement.id, action=f"leadership_{action}",
              actor=current_user, request=request, user_id=reimbursement.employee_profile.user_id,
              old_value={"status": old_status}, new_value={"status": reimbursement.status})

    owner = reimbursement.employee_profile.user if reimbursement.employee_profile else None
    if action == "approve":
        _notify_roles(
            db,
            roles=PAYMENT_ROLES,
            title="Reimbursement approved — please pay",
            message=(
                f"{reimbursement.employee_name}'s reimbursement is fully approved. Office Admin to "
                f"process payment.\n\n{_reimbursement_details(reimbursement)}"
            ),
            type_=NotificationType.ACTION,
        )
    _notify_user(db, user=owner, title="Reimbursement Leadership review updated",
                 message=f"Your reimbursement request is now {STATUS_LABELS.get(reimbursement.status, reimbursement.status)}.",
                 type_=NotificationType.SUCCESS if action == "approve" else NotificationType.WARNING)
    db.commit()
    return _serialize(_load_request(db, reimbursement.id))


@router.post("/{request_id}/finance-action")
def finance_action(
    request_id: str,
    payload: ReimbursementActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_REVIEW))],
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    if not _is_finance_reviewer(current_user):
        raise HTTPException(status_code=403, detail="Only HR/Office admin reviewers can act on this request.")
    if reimbursement.status not in FINANCE_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Request is not pending HR/Office admin review.")
    action = payload.action.strip().lower()
    if action not in {"approve", "reject", "return"}:
        raise HTTPException(status_code=422, detail="Action must be approve, reject, or return.")
    comment = (payload.comment or "").strip()
    if action in {"reject", "return"} and not comment:
        raise HTTPException(status_code=422, detail="HR/Office admin comments are required for return/rejection.")

    old_status = reimbursement.status
    now = datetime.now(UTC)
    if action == "approve":
        reimbursement.status = "approved_for_payment"
        reimbursement.finance_comments = comment or "Approved for payment"
    elif action == "reject":
        reimbursement.status = "finance_rejected"
        reimbursement.finance_comments = comment
    else:
        reimbursement.status = "returned_by_finance"
        reimbursement.finance_comments = comment
    reimbursement.finance_reviewed_by = current_user.id
    reimbursement.finance_reviewed_at = now
    reimbursement.missing_fields = []
    db.add(reimbursement)
    db.flush()

    _log_action(
        db,
        reimbursement=reimbursement,
        actor=current_user,
        action=f"finance_{action}",
        from_status=old_status,
        to_status=reimbursement.status,
        comment=reimbursement.finance_comments,
    )
    log_audit(
        db,
        entity_type="reimbursement_request",
        entity_id=reimbursement.id,
        action=f"finance_{action}",
        actor=current_user,
        request=request,
        user_id=reimbursement.employee_profile.user_id,
        old_value={"status": old_status},
        new_value={"status": reimbursement.status},
    )

    owner = reimbursement.employee_profile.user if reimbursement.employee_profile else None
    _notify_user(
        db,
        user=owner,
        title="Reimbursement HR/Office admin review updated",
        message=f"Your reimbursement request is now {STATUS_LABELS.get(reimbursement.status, reimbursement.status)}.",
        type_=NotificationType.SUCCESS if action == "approve" else NotificationType.WARNING,
    )
    db.commit()
    return _serialize(_load_request(db, reimbursement.id))


@router.post("/{request_id}/mark-paid")
def mark_reimbursement_paid(
    request_id: str,
    payload: ReimbursementActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.REIMBURSEMENTS_REVIEW))],
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    if not _has_any_role(current_user, PAYMENT_ROLES | OVERRIDE_ROLES):
        raise HTTPException(status_code=403, detail="Only Office Admin can mark reimbursements paid.")
    if reimbursement.status != "approved_for_payment":
        raise HTTPException(status_code=400, detail="Only approved-for-payment requests can be marked paid.")

    old_status = reimbursement.status
    reimbursement.status = "paid"
    reimbursement.paid_by = current_user.id
    reimbursement.paid_at = datetime.now(UTC)
    db.add(reimbursement)
    db.flush()
    _log_action(
        db,
        reimbursement=reimbursement,
        actor=current_user,
        action="paid",
        from_status=old_status,
        to_status=reimbursement.status,
        comment=(payload.comment or "").strip() or None,
    )
    log_audit(
        db,
        entity_type="reimbursement_request",
        entity_id=reimbursement.id,
        action="paid",
        actor=current_user,
        request=request,
        user_id=reimbursement.employee_profile.user_id,
        old_value={"status": old_status},
        new_value={"status": reimbursement.status},
    )
    owner = reimbursement.employee_profile.user if reimbursement.employee_profile else None
    _notify_user(
        db,
        user=owner,
        title="Reimbursement paid — please acknowledge",
        message=(
            f"Your reimbursement of {reimbursement.currency} {reimbursement.expense_amount or 0:.2f} "
            "has been paid. Please open Reimbursement Requests and acknowledge receipt."
        ),
        type_=NotificationType.SUCCESS,
    )
    db.commit()
    return _serialize(_load_request(db, reimbursement.id))


@router.post("/{request_id}/acknowledge")
def acknowledge_reimbursement(
    request_id: str,
    payload: ReimbursementActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    reimbursement = _load_request(db, request_id)
    owner = reimbursement.employee_profile.user if reimbursement.employee_profile else None
    if not owner or owner.id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the employee can acknowledge this reimbursement.")
    if reimbursement.status != "paid":
        raise HTTPException(status_code=400, detail="Only a paid reimbursement can be acknowledged.")

    old_status = reimbursement.status
    reimbursement.status = "acknowledged"
    reimbursement.acknowledged_at = datetime.now(UTC)
    db.add(reimbursement)
    db.flush()
    _log_action(db, reimbursement=reimbursement, actor=current_user, action="acknowledged",
                from_status=old_status, to_status=reimbursement.status,
                comment=(payload.comment or "").strip() or None)
    log_audit(db, entity_type="reimbursement_request", entity_id=reimbursement.id, action="acknowledged",
              actor=current_user, request=request, user_id=current_user.id,
              old_value={"status": old_status}, new_value={"status": reimbursement.status})
    _notify_roles(
        db,
        roles=PAYMENT_ROLES,
        title="Reimbursement acknowledged",
        message=f"{reimbursement.employee_name} acknowledged receipt of their paid reimbursement.",
        type_=NotificationType.SUCCESS,
    )
    db.commit()
    return _serialize(_load_request(db, reimbursement.id))
