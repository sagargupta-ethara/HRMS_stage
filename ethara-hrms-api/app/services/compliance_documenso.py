"""Documenso e-sign statutory compliance forms (Form 11 / Form 2 / Form F) for employees.

Mirrors the candidate-contract Documenso flow, but for employees: the form is sent to the
employee's ETHARA email for e-signature and tracked on EmployeeComplianceForm. Shown in the
employee dashboard's Compliance tab. Sending happens after onboarding completes / employee
credentials exist (the profile has an ethara_email).
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import (
    Candidate,
    CandidateStage,
    ComplianceForm,
    DocumensoTemplateCache,
    EmployeeComplianceForm,
    EmployeeProfile,
)
from app.services import documenso as ds_client

logger = logging.getLogger(__name__)

# Candidate stages BEFORE statutory forms — only advance from one of these when forms are sent.
_PRE_STATUTORY_STAGES = {
    CandidateStage.CONTRACT_SIGNED,
    CandidateStage.INDUCTION_COMPLETED,
    CandidateStage.IT_EMAIL_CREATED,
    CandidateStage.WELCOME_MAIL_SENT,
}


def _linked_candidate(db: Session, profile: EmployeeProfile) -> Candidate | None:
    """The pipeline candidate behind an employee (matched by personal email / code)."""
    conds = []
    if profile.personal_email:
        conds.append(func.lower(Candidate.personal_email) == profile.personal_email.lower())
    if profile.employee_code:
        conds.append(Candidate.candidate_code == profile.employee_code)
        conds.append(Candidate.employee_code == profile.employee_code)
    if not conds:
        return None
    return db.scalar(select(Candidate).where(or_(*conds)))

# Statutory compliance forms delivered via Documenso. Templates are resolved from the cache
# by title (so the actual Documenso template id can change without a code edit).
COMPLIANCE_FORMS: list[tuple[str, str]] = [
    ("form_11", "Form 11"),
    ("form_2", "Form 2"),
    ("form_f", "Form F"),
]


def resolve_compliance_templates(db: Session) -> list[tuple[str, str, int]]:
    """Return [(form_type, title, template_id)] for each compliance form found in the cache."""
    resolved: list[tuple[str, str, int]] = []
    for form_type, title in COMPLIANCE_FORMS:
        row = db.scalar(
            select(DocumensoTemplateCache).where(
                DocumensoTemplateCache.title.ilike(title)
            )
        )
        if row is None:
            # tolerate "Form 11 ..." style titles
            row = db.scalar(
                select(DocumensoTemplateCache).where(
                    DocumensoTemplateCache.title.ilike(f"{title}%")
                )
            )
        if row is not None:
            resolved.append((form_type, row.title, row.template_id))
        else:
            logger.warning("Compliance template %r not found in cache", title)
    return resolved


def _employee_prefill(profile: EmployeeProfile, template_fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map employee data onto the template's labelled fields (name/email/aadhaar/pan/bank/uan/...)."""
    fd: dict[str, Any] = {}
    sf = getattr(profile, "selection_form", None)
    if sf is not None and getattr(sf, "form_data", None):
        fd = sf.form_data or {}
    extracted = profile.aadhaar_extracted or {}

    def first(*vals: Any) -> str:
        for v in vals:
            if v not in (None, ""):
                return str(v)
        return ""

    mapping = {
        "name": profile.full_name,
        "full name": profile.full_name,
        "employee name": profile.full_name,
        "email": profile.ethara_email,
        "ethara email": profile.ethara_email,
        "employee code": profile.employee_code or "",
        "employee id": profile.employee_code or "",
        "department": profile.department or "",
        "designation": profile.designation or "",
        "date of birth": first(fd.get("dateOfBirth"), profile.date_of_birth.strftime("%d/%m/%Y") if profile.date_of_birth else ""),
        "dob": first(fd.get("dateOfBirth")),
        "father name": first(fd.get("fatherName")),
        "father's name": first(fd.get("fatherName")),
        "aadhaar": first(extracted.get("aadhaarNumber"), fd.get("aadhaarNumber")),
        "aadhaar number": first(extracted.get("aadhaarNumber"), fd.get("aadhaarNumber")),
        "pan": first(fd.get("panNumber")),
        "pan number": first(fd.get("panNumber")),
        "uan": first(fd.get("uanNumber")),
        "uan number": first(fd.get("uanNumber")),
        "bank name": first(fd.get("bankName")),
        "bank account": first(fd.get("bankAccount")),
        "account number": first(fd.get("bankAccount")),
        "ifsc": first(fd.get("ifscCode")),
        "ifsc code": first(fd.get("ifscCode")),
        "current address": first(fd.get("currentAddress")),
        "permanent address": first(fd.get("permanentAddress")),
        "mobile": profile.phone or "",
        "phone": profile.phone or "",
    }

    _PREFILLABLE = {"TEXT", "EMAIL", "NUMBER", "DATE"}
    prefill: list[dict[str, Any]] = []
    for field in template_fields or []:
        fid = field.get("id")
        rtype = (field.get("type") or "").upper()
        if not fid or rtype not in _PREFILLABLE:
            continue
        label = ((field.get("fieldMeta") or {}).get("label") or "").lower().strip()
        value = mapping.get(label, "")
        if value:
            prefill.append({"id": fid, "type": "text", "value": value})
    return prefill


def send_compliance_forms(
    db: Session, *, profile: EmployeeProfile, actor_id: str | None = None
) -> list[EmployeeComplianceForm]:
    """Create + send the Documenso compliance forms to the employee's Ethara email. Idempotent:
    a form already sent (has documenso_id) is not re-sent."""
    settings = get_settings()
    if not settings.documenso_api_key:
        raise ValueError("Documenso is not configured (missing API key).")
    if not profile.ethara_email:
        raise ValueError("Employee has no Ethara email yet — create the email/ID first.")

    templates = resolve_compliance_templates(db)
    if not templates:
        raise ValueError("No compliance templates (Form 11 / Form 2 / Form F) found. Refresh templates.")

    existing = {
        f.form_type: f
        for f in db.scalars(
            select(EmployeeComplianceForm).where(
                EmployeeComplianceForm.employee_profile_id == profile.id
            )
        )
    }

    out: list[EmployeeComplianceForm] = []
    for form_type, title, template_id in templates:
        record = existing.get(form_type)
        if record is not None and record.documenso_id:
            out.append(record)  # already sent
            continue

        tpl = db.scalar(
            select(DocumensoTemplateCache).where(DocumensoTemplateCache.template_id == template_id)
        )
        template_fields = (tpl.fields if tpl else None) or []
        template_recipients = (tpl.recipients if tpl else None) or []

        prefill = _employee_prefill(profile, template_fields)
        recipients = [
            {"id": r.get("id"), "name": profile.full_name, "email": profile.ethara_email}
            for r in template_recipients
            if r.get("role") in {"SIGNER", "VIEWER", None}
        ] or [{"name": profile.full_name, "email": profile.ethara_email}]

        doc_resp = ds_client.create_document_from_template(
            template_id=template_id,
            title=f"{title} - {profile.full_name}",
            recipients=recipients,
            prefill_fields=prefill,
            distribute=True,
        )
        doc_id = ds_client.extract_document_id(doc_resp) or 0
        token = ds_client.extract_signing_token(doc_resp)

        if record is None:
            record = EmployeeComplianceForm(
                employee_profile_id=profile.id,
                form_type=form_type,
                form_title=title,
            )
            db.add(record)
        record.documenso_template_id = template_id
        record.documenso_id = str(doc_id) if doc_id else None
        record.signed_url = ds_client.build_signing_url(token) if token else None
        record.status = "sent"
        record.sent_at = datetime.now(UTC)
        db.flush()
        out.append(record)

    # Advance the linked candidate's journey: statutory/compliance forms sent.
    cand = _linked_candidate(db, profile)
    if cand is not None and cand.current_stage in _PRE_STATUTORY_STAGES:
        cand.current_stage = CandidateStage.STATUTORY_FORMS_SENT
        cand.current_status = "Statutory Forms Sent"
        db.add(cand)

    return out


def sync_and_advance(db: Session, *, profile: EmployeeProfile) -> list[EmployeeComplianceForm]:
    """Refresh every Documenso compliance form's status; when ALL are signed, mark them
    verified and advance the candidate journey to compliance-verified → onboarding-completed.
    This is what "compliance verified = the 3 forms are signed" means."""
    forms = [f for f in (profile.compliance_forms or []) if f.documenso_id]
    if not forms:
        return forms
    for f in forms:
        if f.status != "signed":
            try:
                refresh_compliance_form(db, form=f)
            except Exception:
                logger.exception("compliance refresh failed for form %s", f.id)

    if forms and all(f.status == "signed" for f in forms):
        now = datetime.now(UTC)
        for f in forms:
            f.verified_at = f.verified_at or now
            db.add(f)
        cand = _linked_candidate(db, profile)
        if cand is not None and cand.current_stage not in {
            CandidateStage.COMPLIANCE_VERIFIED,
            CandidateStage.ONBOARDING_COMPLETED,
        }:
            # All statutory forms signed → compliance verified → onboarding complete.
            cand.current_stage = CandidateStage.ONBOARDING_COMPLETED
            cand.current_status = "Onboarding Completed"
            db.add(cand)
            logger.info("Candidate %s onboarding completed (all compliance forms signed)", cand.id)
    return forms


# ── Candidate-side compliance (signed on the candidate dashboard, BEFORE employee creation) ──

def _candidate_prefill(candidate: Candidate, template_fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fd: dict[str, Any] = {}
    sf = getattr(candidate, "selection_form", None)
    if sf is not None and getattr(sf, "form_data", None):
        fd = sf.form_data or {}
    extracted = candidate.aadhaar_extracted or {}

    def first(*vals: Any) -> str:
        for v in vals:
            if v not in (None, ""):
                return str(v)
        return ""

    mapping = {
        "name": candidate.full_name, "full name": candidate.full_name, "employee name": candidate.full_name,
        "email": candidate.ethara_email or candidate.personal_email,
        "ethara email": candidate.ethara_email or "",
        "personal email": candidate.personal_email,
        "phone": candidate.phone or "", "mobile": candidate.phone or "",
        "date of birth": first(fd.get("dateOfBirth")), "dob": first(fd.get("dateOfBirth")),
        "father name": first(fd.get("fatherName")), "father's name": first(fd.get("fatherName")),
        "aadhaar": first(extracted.get("aadhaarNumber"), fd.get("aadhaarNumber")),
        "aadhaar number": first(extracted.get("aadhaarNumber"), fd.get("aadhaarNumber")),
        "pan": first(fd.get("panNumber")), "pan number": first(fd.get("panNumber")),
        "uan": first(fd.get("uanNumber")), "uan number": first(fd.get("uanNumber")),
        "bank name": first(fd.get("bankName")), "bank account": first(fd.get("bankAccount")),
        "account number": first(fd.get("bankAccount")),
        "ifsc": first(fd.get("ifscCode")), "ifsc code": first(fd.get("ifscCode")),
        "current address": first(fd.get("currentAddress")),
        "permanent address": first(fd.get("permanentAddress")),
    }
    _PREFILLABLE = {"TEXT", "EMAIL", "NUMBER", "DATE"}
    prefill: list[dict[str, Any]] = []
    for field in template_fields or []:
        fid = field.get("id")
        if not fid or (field.get("type") or "").upper() not in _PREFILLABLE:
            continue
        label = ((field.get("fieldMeta") or {}).get("label") or "").lower().strip()
        value = mapping.get(label, "")
        if value:
            prefill.append({"id": fid, "type": "text", "value": value})
    return prefill


def _candidate_recipient_email(candidate: Candidate) -> str:
    recipient_email = candidate.ethara_email or candidate.personal_email
    if not recipient_email:
        raise ValueError("Candidate has no email address for Documenso delivery.")
    return recipient_email


def _create_candidate_compliance_document(
    db: Session,
    *,
    candidate: Candidate,
    title: str,
    template_id: int,
) -> tuple[str | None, str | None]:
    tpl = db.scalar(select(DocumensoTemplateCache).where(DocumensoTemplateCache.template_id == template_id))
    recipient_email = _candidate_recipient_email(candidate)
    prefill = _candidate_prefill(candidate, (tpl.fields if tpl else None) or [])
    recipients_meta = (tpl.recipients if tpl else None) or []
    recipients = [
        {"id": r.get("id"), "name": candidate.full_name, "email": recipient_email}
        for r in recipients_meta if r.get("role") in {"SIGNER", "VIEWER", None}
    ] or [{"name": candidate.full_name, "email": recipient_email}]
    doc_resp = ds_client.create_document_from_template(
        template_id=template_id,
        title=f"{title} - {candidate.full_name}",
        recipients=recipients,
        prefill_fields=prefill,
        distribute=True,
    )
    doc_id = ds_client.extract_document_id(doc_resp) or 0
    token = ds_client.extract_signing_token(doc_resp)
    return str(doc_id) if doc_id else None, ds_client.build_signing_url(token) if token else None


def _parse_documenso_datetime(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _documenso_signed_at(doc: dict[str, Any]) -> datetime | None:
    for recipient in doc.get("recipients") or []:
        signed_at = _parse_documenso_datetime(recipient.get("signedAt"))
        if signed_at is not None:
            return signed_at
    return _parse_documenso_datetime(doc.get("completedAt") or doc.get("signedAt"))


def _resolve_candidate_compliance_template(
    db: Session,
    *,
    form: ComplianceForm,
) -> tuple[str, str, int]:
    form_type = form.form_type
    title = form.form_title or form.form_type or "Compliance form"

    if form.documenso_template_id:
        row = db.scalar(
            select(DocumensoTemplateCache).where(
                DocumensoTemplateCache.template_id == form.documenso_template_id
            )
        )
        return form_type, row.title if row and row.title else title, form.documenso_template_id

    for resolved_type, resolved_title, template_id in resolve_compliance_templates(db):
        if resolved_type == form_type or resolved_title.lower() == title.lower():
            return resolved_type, resolved_title, template_id

    raise ValueError(f"No Documenso template found for {title}. Refresh templates.")


def send_candidate_compliance_forms(db: Session, *, candidate: Candidate) -> list[ComplianceForm]:
    """Create + send the Documenso statutory forms (Form 11/2/F) for a CANDIDATE. The signing
    links appear on the candidate dashboard. Idempotent. Advances stage to statutory_forms_sent."""
    settings = get_settings()
    if not settings.documenso_api_key:
        raise ValueError("Documenso is not configured.")
    templates = resolve_compliance_templates(db)
    if not templates:
        raise ValueError("No compliance templates (Form 11 / Form 2 / Form F) found.")

    db.execute(select(Candidate.id).where(Candidate.id == candidate.id).with_for_update())
    existing = {
        f.form_type: f
        for f in db.scalars(select(ComplianceForm).where(ComplianceForm.candidate_id == candidate.id))
    }
    out: list[ComplianceForm] = []
    for form_type, title, template_id in templates:
        record = existing.get(form_type)
        if record is not None and record.documenso_id:
            out.append(record)
            continue
        doc_id, signed_url = _create_candidate_compliance_document(
            db,
            candidate=candidate,
            title=title,
            template_id=template_id,
        )
        if record is None:
            record = ComplianceForm(candidate_id=candidate.id, form_type=form_type, form_title=title)
            db.add(record)
        record.documenso_template_id = template_id
        record.documenso_id = doc_id
        record.signed_url = signed_url
        record.status = "sent"
        record.sent_at = datetime.now(UTC)
        db.flush()
        out.append(record)

    if candidate.current_stage in _PRE_STATUTORY_STAGES:
        candidate.current_stage = CandidateStage.STATUTORY_FORMS_SENT
        candidate.current_status = "Statutory Forms Sent"
        db.add(candidate)
    return out


def resend_candidate_compliance_form(db: Session, *, form: ComplianceForm) -> ComplianceForm:
    """Create a fresh Documenso document for one candidate statutory form."""
    settings = get_settings()
    if not settings.documenso_api_key:
        raise ValueError("Documenso is not configured.")

    candidate = form.candidate or db.get(Candidate, form.candidate_id)
    if candidate is None:
        raise ValueError("Candidate not found for this compliance form.")

    form_type, title, template_id = _resolve_candidate_compliance_template(db, form=form)
    doc_id, signed_url = _create_candidate_compliance_document(
        db,
        candidate=candidate,
        title=title,
        template_id=template_id,
    )

    form.form_type = form_type
    form.form_title = title
    form.documenso_template_id = template_id
    form.documenso_id = doc_id
    form.signed_url = signed_url
    form.status = "sent"
    form.sent_at = datetime.now(UTC)
    form.signed_at = None
    form.verified_at = None
    form.pdf_url = None
    db.add(form)

    if candidate.current_stage != CandidateStage.ONBOARDING_COMPLETED:
        candidate.current_stage = CandidateStage.STATUTORY_FORMS_SENT
        candidate.current_status = "Statutory Forms Sent"
        db.add(candidate)

    db.flush()
    return form


def cancel_candidate_compliance_form(db: Session, *, form: ComplianceForm) -> ComplianceForm | None:
    """Cancel one candidate statutory form.

    Deletes the underlying Documenso document (best-effort — a remote delete failure,
    e.g. the doc was already removed, must NOT block the local cancel). Then: if this is
    a DUPLICATE (another non-cancelled form of the SAME type exists for the candidate —
    the "sent twice" case) the row is removed entirely; otherwise it is marked
    ``cancelled`` so staff can re-send it. Returns the form, or None if it was deleted.
    """
    settings = get_settings()
    if form.documenso_id and settings.documenso_api_key:
        try:
            ds_client.delete_document(form.documenso_id)
        except Exception:  # noqa: BLE001 — remote cleanup is best-effort
            logger.warning(
                "Documenso delete failed for compliance form %s (%s) — cancelling locally anyway",
                form.id, form.documenso_id, exc_info=True,
            )

    duplicate_exists = db.scalar(
        select(ComplianceForm.id).where(
            ComplianceForm.candidate_id == form.candidate_id,
            ComplianceForm.form_type == form.form_type,
            ComplianceForm.id != form.id,
            ComplianceForm.status != "cancelled",
        )
    ) is not None

    if duplicate_exists:
        db.delete(form)
        db.flush()
        return None

    form.status = "cancelled"
    form.documenso_id = None
    form.signed_url = None
    form.signed_at = None
    form.pdf_url = None
    db.add(form)
    db.flush()
    return form


def remind_candidate_compliance_form(db: Session, *, form: ComplianceForm) -> ComplianceForm:
    """Email the candidate the EXISTING signing link as a reminder.

    Deliberately does NOT create a new Documenso document (unlike resend) so reminders
    never produce duplicate forms. Requires the form to still be awaiting signature.
    """
    if form.status in ("signed", "verified"):
        raise ValueError("This form is already signed.")
    if not form.signed_url:
        raise ValueError("No signing link is available for this form — re-send it instead.")

    candidate = form.candidate or db.get(Candidate, form.candidate_id)
    if candidate is None:
        raise ValueError("Candidate not found for this compliance form.")
    recipient = _candidate_recipient_email(candidate)
    title = form.form_title or form.form_type or "statutory form"

    from app.services.integrations import EmailService

    EmailService().send_email(
        to_email=recipient,
        subject=f"Reminder: please sign your {title}",
        body_text=(
            f"Hi {candidate.full_name},\n\n"
            f"This is a friendly reminder to sign your statutory form \"{title}\". "
            "Please open the link below to review and sign it:\n\n"
            f"{form.signed_url}\n\n"
            "If you have already signed, please ignore this email.\n\nThank you."
        ),
    )
    return form


def _refresh_candidate_form(db: Session, *, form: ComplianceForm) -> ComplianceForm:
    if not form.documenso_id:
        return form
    doc = ds_client.get_document_with_fields(int(form.documenso_id))
    if (doc.get("status") or "").upper() == "COMPLETED" and form.status != "signed":
        form.status = "signed"
        form.signed_at = _documenso_signed_at(doc) or datetime.now(UTC)
        try:
            from app.services.integrations import StorageService

            pdf = ds_client.download_document_pdf(int(form.documenso_id))
            url, _k = StorageService().save_bytes(
                pdf, folder=f"compliance/{form.candidate_id}", filename=f"{form.form_type}.pdf",
                content_type="application/pdf",
            )
            form.pdf_url = url
        except Exception:
            logger.exception("Failed to store signed candidate compliance PDF for %s", form.id)
        db.add(form)
        db.flush()
    return form


def sync_candidate_compliance(db: Session, *, candidate: Candidate) -> list[ComplianceForm]:
    """Refresh the candidate's Documenso compliance forms. When ALL are signed → mark onboarding
    completed AND create the employee account / send HRMS credentials (to the personal email)."""
    # Serialise concurrent syncs for the same candidate (double-click, or candidate + staff
    # both syncing at once) so onboarding-completion and employee conversion run exactly once.
    db.execute(select(Candidate.id).where(Candidate.id == candidate.id).with_for_update())
    forms = [f for f in (candidate.compliance_forms or []) if f.documenso_id]
    if not forms:
        return forms
    for f in forms:
        if f.status != "signed":
            try:
                _refresh_candidate_form(db, form=f)
            except Exception:
                logger.exception("candidate compliance refresh failed for %s", f.id)

    if forms and all(f.status == "signed" for f in forms):
        now = datetime.now(UTC)
        for f in forms:
            f.verified_at = f.verified_at or now
            db.add(f)
        if candidate.current_stage != CandidateStage.ONBOARDING_COMPLETED:
            candidate.current_stage = CandidateStage.ONBOARDING_COMPLETED
            candidate.current_status = "Onboarding Completed"
            db.add(candidate)
            db.flush()
            # All statutory forms signed. Auto-conversion to an employee is gated off
            # by default — the candidate stays at ONBOARDING_COMPLETED and HR creates
            # the employee (Ethara ID + GRP code) via the IT bulk-register upload.
            # Set AUTO_EMPLOYEE_PROVISIONING=true to restore automatic credentialing.
            if get_settings().auto_employee_provisioning:
                try:
                    from app.services import employees as employee_service

                    employee_service.convert_candidate_to_employee(db, candidate=candidate, actor=None)
                except Exception:
                    logger.exception("Failed to create employee account after compliance for %s", candidate.id)
    return forms


def refresh_compliance_form(db: Session, *, form: EmployeeComplianceForm) -> EmployeeComplianceForm:
    """Pull the latest signing status for one compliance form from Documenso."""
    if not form.documenso_id:
        return form
    doc = ds_client.get_document_with_fields(int(form.documenso_id))
    if (doc.get("status") or "").upper() == "COMPLETED" and form.status != "signed":
        form.status = "signed"
        form.signed_at = _documenso_signed_at(doc) or datetime.now(UTC)
        try:
            from app.services.integrations import StorageService

            pdf = ds_client.download_document_pdf(int(form.documenso_id))
            url, _key = StorageService().save_bytes(
                pdf,
                folder=f"compliance/{form.employee_profile_id}",
                filename=f"{form.form_type}.pdf",
                content_type="application/pdf",
            )
            form.pdf_url = url
        except Exception:
            logger.exception("Failed to store signed compliance PDF for form %s", form.id)
        db.add(form)
        db.flush()
    return form
