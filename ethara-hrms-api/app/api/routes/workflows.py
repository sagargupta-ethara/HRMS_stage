from datetime import UTC, datetime
import copy
import mimetypes
from pathlib import Path
from urllib.request import urlopen
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy import delete, desc, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_permissions
from app.core.celery_app import celery_app
from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import AuditLog, Candidate, CandidateStage, ComplianceForm, Document, Escalation, Evaluation, ITRequest, Notification, PiInterviewRound, Role, SelectionForm, User
from app.schemas.workflow import (
    AuditLogListResponse,
    CandidateIdCardBatchCompleteRequest,
    CandidateIdCardBatchCompleteResponse,
    CandidateIdCardFormRead,
    CandidateIdCardFormSubmitRequest,
    CandidateIdCardQueueItemRead,
    ComplianceFormRead,
    ComplianceFormSubmitRequest,
    ContractRead,
    ContractUpdateRequest,
    DocumentRead,
    DocumentVerifyRequest,
    EscalationRead,
    EscalationActionRequest,
    EvaluationRead,
    EvaluationCreateRequest,
    EvaluationPmsScoreUpdateRequest,
    EvaluationSubmitRequest,
    ScreeningListResponse,
    ScreeningOverrideRequest,
    ScreeningRecordRead,
    InterviewScheduleRequest,
    InterviewCompleteRequest,
    PiBypassRequest,
    ITRequestRead,
    ITRequestCompleteRequest,
    ManualScreeningRequest,
    NotificationRead,
    SelectionFormRead,
    SelectionFormSubmitRequest,
)
from app.services import candidates as candidate_service
from app.services import employees as employee_service
from app.services import workflows


router = APIRouter(tags=["workflows"])

SAFE_INLINE_PREVIEW_MIME_TYPES = {
    "application/pdf",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}


def _role_value(value: Role | str) -> str:
    return value.value if isinstance(value, Role) else str(value)


def _user_role_values(user: User) -> set[str]:
    return {_role_value(user.role)} | {_role_value(role) for role in (user.roles or [])}


def _has_any_role(user: User, roles: set[Role]) -> bool:
    allowed = {_role_value(role) for role in roles}
    return bool(_user_role_values(user) & allowed)


def _assert_staff_only(current_user: User, *, action: str) -> None:
    if _user_role_values(current_user) == {Role.CANDIDATE.value}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Candidates cannot {action}.")


def _assert_candidate_document_access(current_user: User, *, action: str) -> None:
    if _can_view_candidate_documents(current_user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Only Admin, HR, and TA users can {action}.",
    )


def _can_view_candidate_documents(current_user: User) -> bool:
    return _has_any_role(current_user, {
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.HR,
        Role.TA,
        Role.CANDIDATE,
        Role.VENDOR,
        Role.EMPLOYEE_REFERRER,
    })


def _clean_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _selection_form_document_metadata(raw_entry: Any) -> dict[str, str | None] | None:
    if isinstance(raw_entry, str):
        file_name = _clean_string(raw_entry)
        if file_name:
            return {"file_name": file_name, "file_url": None, "document_id": None}
    if isinstance(raw_entry, dict):
        file_name = (
            _clean_string(raw_entry.get("fileName"))
            or _clean_string(raw_entry.get("file_name"))
            or _clean_string(raw_entry.get("name"))
        )
        file_url = _clean_string(raw_entry.get("fileUrl")) or _clean_string(raw_entry.get("file_url"))
        document_id = _clean_string(raw_entry.get("documentId")) or _clean_string(raw_entry.get("document_id"))
        if file_name or file_url or document_id:
            return {"file_name": file_name, "file_url": file_url, "document_id": document_id}
    return None


def _selection_form_document_entry(record: SelectionForm, document_key: str) -> dict[str, str | None]:
    form_data = record.form_data if isinstance(record.form_data, dict) else {}
    documents = form_data.get("documentsUploaded")
    if not isinstance(documents, dict) or document_key not in documents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selection form document not found")

    metadata = _selection_form_document_metadata(documents.get(document_key))
    if metadata:
        return metadata
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selection form document not found")


def _lookup_selection_form_document(
    db: Session,
    *,
    candidate_id: str,
    document_key: str,
    metadata: dict[str, str | None],
) -> Document | None:
    document_id = metadata.get("document_id")
    if document_id:
        document = db.get(Document, document_id)
        if document and document.candidate_id == candidate_id:
            return document

    documents = list(
        db.scalars(
            select(Document)
            .where(Document.candidate_id == candidate_id)
            .order_by(Document.created_at.desc())
        )
    )

    file_url = metadata.get("file_url")
    if file_url:
        for document in documents:
            if document.file_url == file_url:
                return document

    file_name = metadata.get("file_name")
    if file_name:
        named_matches = [document for document in documents if document.file_name == file_name]
        preferred_types = {
            document_key,
            f"selection_form_{document_key}",
            f"selection-form-{document_key}",
            f"selection_{document_key}",
        }
        for document in named_matches:
            if document.type in preferred_types:
                return document
        if named_matches:
            return named_matches[0]

    return None


def _find_selection_form_document(
    db: Session,
    *,
    candidate_id: str,
    document_key: str,
    metadata: dict[str, str | None],
) -> Document:
    document = _lookup_selection_form_document(
        db,
        candidate_id=candidate_id,
        document_key=document_key,
        metadata=metadata,
    )
    if document is not None:
        return document
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded document file not found")


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _resolve_local_upload_path(file_url: str) -> Path | None:
    if not file_url.startswith("/uploads/"):
        return None

    relative_path = Path(file_url.removeprefix("/uploads/"))
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on server")

    settings = get_settings()
    bases = [settings.local_storage_path, Path.cwd() / "uploads"]
    seen: set[Path] = set()
    for base in bases:
        resolved_base = base.resolve()
        if resolved_base in seen:
            continue
        seen.add(resolved_base)
        candidate = (resolved_base / relative_path).resolve()
        if _is_relative_to(candidate, resolved_base) and candidate.exists():
            return candidate
    return None


def _document_media_type(document: Document) -> str:
    value = (document.mime_type or "").split(";", maxsplit=1)[0].strip().lower()
    if value:
        return value
    guessed, _ = mimetypes.guess_type(document.file_name or document.file_url or "")
    return guessed or "application/octet-stream"


def _document_file_available(document: Document) -> bool:
    file_url = document.file_url or ""
    if file_url.startswith("/uploads/"):
        return _resolve_local_upload_path(file_url) is not None
    return bool(file_url)


def _selection_form_read_payload(db: Session, record: SelectionForm) -> dict[str, Any]:
    payload = SelectionFormRead.model_validate(record).model_dump(by_alias=True)
    queue_state = workflows.selection_form_verification_queue_state(record)
    payload["verificationStatus"] = queue_state["status"]
    payload["verificationMessage"] = queue_state["message"]
    payload["verificationTaskId"] = queue_state.get("taskId")
    payload["verificationQueuedAt"] = queue_state.get("queuedAt")
    payload["verificationStartedAt"] = queue_state.get("startedAt")
    payload["verificationCompletedAt"] = queue_state.get("completedAt")
    payload["verificationRequiredDocuments"] = queue_state.get("required", 0)
    payload["verificationSubmittedDocuments"] = queue_state.get("submitted", 0)
    payload["verificationMissingDocuments"] = queue_state.get("missing", 0)
    form_data = payload.get("formData")
    if not isinstance(form_data, dict):
        return payload

    form_data = copy.deepcopy(form_data)
    documents = form_data.get("documentsUploaded")
    if not isinstance(documents, dict):
        payload["formData"] = form_data
        return payload

    enriched_documents: dict[str, Any] = {}
    for document_key, raw_entry in documents.items():
        metadata = _selection_form_document_metadata(raw_entry)
        if metadata is None:
            enriched_documents[document_key] = raw_entry
            continue

        document = _lookup_selection_form_document(
            db,
            candidate_id=record.candidate_id,
            document_key=document_key,
            metadata=metadata,
        )
        if isinstance(raw_entry, dict):
            entry = copy.deepcopy(raw_entry)
        else:
            entry = {}
        entry["fileName"] = (metadata.get("file_name") or document.file_name) if document else metadata.get("file_name")
        entry["documentId"] = document.id if document else metadata.get("document_id")
        entry["fileUrl"] = document.file_url if document else metadata.get("file_url")
        entry["mimeType"] = _document_media_type(document) if document else entry.get("mimeType")
        entry["fileAvailable"] = bool(document and _document_file_available(document))
        enriched_documents[document_key] = entry

    form_data["documentsUploaded"] = enriched_documents
    payload["formData"] = form_data
    return payload


def _serve_document_file(document: Document, *, inline: bool):
    file_url = document.file_url or ""
    media_type = _document_media_type(document)

    local_path = _resolve_local_upload_path(file_url)
    if local_path:
        if inline and media_type not in SAFE_INLINE_PREVIEW_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This document type cannot be previewed inline.",
            )
        return FileResponse(
            path=str(local_path),
            filename=document.file_name,
            media_type=media_type,
            content_disposition_type="inline" if inline else "attachment",
        )
    if file_url.startswith("/uploads/"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on server")

    from app.services.integrations import StorageService

    download_url = StorageService().presigned_download_url(file_url)
    if download_url:
        return RedirectResponse(download_url)
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Document is stored externally and cannot be proxied from this server.",
    )


def _read_document_content(document: Document) -> bytes | None:
    file_url = document.file_url or ""
    local_path = _resolve_local_upload_path(file_url)
    if local_path and local_path.exists():
        return local_path.read_bytes()

    from app.services.integrations import StorageService

    download_url = StorageService().presigned_download_url(file_url)
    if not download_url:
        return None
    try:
        with urlopen(download_url, timeout=30) as response:  # nosec B310 - generated S3 URL for stored upload.
            return response.read(15 * 1024 * 1024)
    except OSError:
        return None


def _selection_form_document_verification_update(result: dict[str, Any]) -> dict[str, Any]:
    ocr_status = str(result.get("ocrStatus") or "skipped")
    matched = result.get("matchesExpectedCategory")
    verification_status = (
        "verified"
        if matched is True or ocr_status == "extracted"
        else "needs_review"
        if matched is False or ocr_status == "needs_review"
        else ocr_status
    )
    return {
        "verificationStatus": verification_status,
        "ocrStatus": ocr_status,
        "needsReview": verification_status == "needs_review",
        "detectedDocumentType": result.get("detectedDocumentType"),
        "matchesExpectedCategory": matched,
        "verificationMessage": result.get("message") or "",
        "verifiedAt": datetime.now(UTC).isoformat(),
    }


def _persist_selection_form_document_verification(
    db: Session,
    *,
    record: SelectionForm,
    document_key: str,
    actor: User,
) -> dict[str, Any]:
    metadata = _selection_form_document_entry(record, document_key)
    document = _find_selection_form_document(
        db,
        candidate_id=record.candidate_id,
        document_key=document_key,
        metadata=metadata,
    )
    content = _read_document_content(document)
    result = employee_service.verify_document_content(
        content=content,
        mime_type=_document_media_type(document),
        document_type=f"selection_form_{document_key}",
    )
    verification = _selection_form_document_verification_update(result)
    if verification["verificationStatus"] == "verified":
        document.status = "verified"
        document.ocr_status = "extracted"
        document.verified_by = actor.id
        document.verified_at = datetime.now(UTC)
    elif verification["verificationStatus"] == "needs_review":
        document.status = "needs_review"
        document.ocr_status = "needs_review"
    document.extracted_data = {
        "detectedDocumentType": result.get("detectedDocumentType"),
        "matchesExpectedCategory": result.get("matchesExpectedCategory"),
        "message": result.get("message") or "",
        "verifiedAt": verification["verifiedAt"],
    }
    db.add(document)

    form_data = copy.deepcopy(record.form_data) if isinstance(record.form_data, dict) else {}
    documents = form_data.get("documentsUploaded")
    if not isinstance(documents, dict):
        documents = {}
    current_entry = documents.get(document_key)
    current_payload = copy.deepcopy(current_entry) if isinstance(current_entry, dict) else {}
    current_metadata = _selection_form_document_metadata(current_entry) or {}
    documents[document_key] = {
        **current_payload,
        "fileName": document.file_name or current_metadata.get("file_name") or metadata.get("file_name"),
        "documentId": document.id,
        "fileUrl": document.file_url,
        "mimeType": document.mime_type,
        **verification,
        "verifiedBy": actor.id,
    }
    form_data["documentsUploaded"] = documents
    record.form_data = form_data
    db.add(record)
    return {"result": result, "verification": verification, "document": document}


def _selection_form_required_document_keys(form_data: dict[str, Any]) -> set[str]:
    basic = form_data.get("basicDetails")
    basic_details = basic if isinstance(basic, dict) else {}
    experience_type = str(basic_details.get("experienceType") or "").strip().lower()
    bank = form_data.get("bankDetails")
    bank_details = bank if isinstance(bank, dict) else {}
    required = {
        "passport_size_photo",
        "marksheet_10th",
        "marksheet_12th",
        "graduation",
        "pan_doc",
        "aadhaar_doc",
        "permanent_address_proof",
    }
    if experience_type and experience_type not in {"fresher", "freshers", "entry_level"}:
        required.update({"experience_letter_1", "relieving_letter", "payslips"})
    has_bank_details = any(
        str(bank_details.get(key) or "").strip()
        for key in ("bankName", "accountHolderName", "accountNumber", "ifsc")
    )
    if has_bank_details:
        required.add("cancelled_cheque")
    return required


def _selection_form_documents_ready_for_auto_validation(
    db: Session,
    *,
    record: SelectionForm,
    actor: User,
) -> bool:
    form_data = record.form_data if isinstance(record.form_data, dict) else {}
    documents = form_data.get("documentsUploaded")
    if not isinstance(documents, dict):
        return False

    required_keys = _selection_form_required_document_keys(form_data)
    submitted_keys = {key for key, value in documents.items() if _selection_form_document_metadata(value)}
    if not required_keys.issubset(submitted_keys):
        return False

    all_ready = True
    for document_key in sorted(submitted_keys):
        try:
            outcome = _persist_selection_form_document_verification(
                db,
                record=record,
                document_key=document_key,
                actor=actor,
            )
        except HTTPException:
            all_ready = False
            continue
        except Exception:
            all_ready = False
            continue
        verification = outcome["verification"]
        if verification.get("verificationStatus") != "verified" or verification.get("matchesExpectedCategory") is not True:
            all_ready = False
    return all_ready


def _serve_file_url(
    *,
    file_url: str | None,
    file_name: str,
    media_type: str,
    inline: bool,
):
    if not file_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signed compliance PDF is not available yet.",
        )

    local_path = _resolve_local_upload_path(file_url)
    if local_path:
        if inline and media_type not in SAFE_INLINE_PREVIEW_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This document type cannot be previewed inline.",
            )
        return FileResponse(
            path=str(local_path),
            filename=file_name,
            media_type=media_type,
            content_disposition_type="inline" if inline else "attachment",
        )
    if file_url.startswith("/uploads/"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on server")

    from app.services.integrations import StorageService

    download_url = StorageService().presigned_download_url(file_url)
    if download_url:
        return RedirectResponse(download_url)
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Document is stored externally and cannot be proxied from this server.",
    )


def _assert_screening_staff(current_user: User, *, action: str) -> None:
    if not _has_any_role(current_user, {Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.TA}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only Admin, HR, and TA users can {action}.",
        )


def _assert_id_card_staff(current_user: User, *, action: str) -> None:
    if not _has_any_role(current_user, {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA, Role.IT_TEAM, Role.OFFICE_ADMIN}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only Admin, HR, IT, and Office Admin users can {action}.",
        )


def _assert_pms_staff(current_user: User, *, action: str) -> None:
    if not _has_any_role(current_user, {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only Admin and HR users can {action}.",
        )


def _assert_compliance_sender(current_user: User) -> None:
    if not _has_any_role(current_user, {Role.SUPER_ADMIN, Role.ADMIN, Role.HR}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin and HR users can send statutory forms.",
        )


def _assert_can_act_on_escalation(record: Escalation, current_user: User) -> None:
    # When an escalation is owned by a specific responsible user, only that user
    # (plus the admin tier) may acknowledge/resolve it — other ESCALATIONS_WRITE
    # holders must not act on someone else's escalation.
    if record.responsible_user_id and record.responsible_user_id != current_user.id and not _has_any_role(current_user, {
        Role.ADMIN,
        Role.SUPER_ADMIN,
        Role.LEADERSHIP,
    }):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This escalation is assigned to another user.",
        )


def _serialize_evaluation(evaluation: Evaluation) -> EvaluationRead:
    candidate = evaluation.candidate
    evaluator = evaluation.evaluator
    payload = {
        "id": evaluation.id,
        "candidateId": evaluation.candidate_id,
        "evaluatorId": evaluation.evaluator_id,
        "technicalSkills": evaluation.technical_skills,
        "communication": evaluation.communication,
        "problemSolving": evaluation.problem_solving,
        "culturalFit": evaluation.cultural_fit,
        "attitude": evaluation.attitude,
        "totalScore": evaluation.total_score,
        "recommendation": evaluation.recommendation,
        "notes": evaluation.notes,
        "completedAt": evaluation.completed_at,
        "interviewSubject": evaluation.interview_subject,
        "interviewScheduledAt": evaluation.interview_scheduled_at,
        "interviewStatus": evaluation.interview_status,
        "interviewNotes": evaluation.interview_notes,
        "interviewMode": evaluation.interview_mode,
        "piScore": evaluation.pi_score,
        "pmsScore": evaluation.pms_score,
        "piRounds": [workflows.serialize_pi_round(round_record) for round_record in sorted(evaluation.pi_rounds or [], key=lambda item: item.round_number)],
        "createdAt": evaluation.created_at,
        "updatedAt": evaluation.updated_at,
        "candidate": (
            {
                "id": candidate.id,
                "candidateCode": candidate.candidate_code,
                "fullName": candidate.full_name,
                "full_name": candidate.full_name,
                "personalEmail": candidate.personal_email,
                "currentStage": candidate.current_stage.value if candidate.current_stage else None,
                "currentStatus": candidate.current_status,
                "position": (
                    {
                        "id": candidate.position.id,
                        "title": candidate.position.title,
                    }
                    if candidate.position
                    else None
                ),
            }
            if candidate
            else None
        ),
        "evaluator": (
            {
                "id": evaluator.id,
                "name": evaluator.name,
                "email": evaluator.email,
                "role": evaluator.role.value,
            }
            if evaluator
            else None
        ),
    }
    return EvaluationRead.model_validate(payload)


def _screening_run_inline() -> bool:
    settings = get_settings()
    return (
        settings.resume_screening_inline_on_upload
        or settings.is_development
        or settings.celery_task_always_eager
    )


def _get_accessible_candidate(db: Session, *, current_user: User, candidate_id: str) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    if _user_role_values(current_user) != {Role.CANDIDATE.value}:
        return candidate_service.enforce_candidate_access(candidate=candidate, user=current_user)

    normalized_email = current_user.email.strip().lower()
    if candidate.portal_user_id != current_user.id and candidate.personal_email.strip().lower() != normalized_email:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return candidate


def _serialize_escalation(record: Escalation) -> dict:
    return {
        "id": record.id,
        "candidateId": record.candidate_id,
        "stage": record.stage,
        "responsibleUserId": record.responsible_user_id,
        "slaDeadline": record.sla_deadline,
        "delayedBy": record.delayed_by,
        "escalationLevel": record.escalation_level,
        "status": record.status,
        "emailSentAt": record.email_sent_at,
        "resolvedAt": record.resolved_at,
        "resolvedBy": record.resolved_by,
        "notes": record.notes,
        "createdAt": record.created_at,
        "updatedAt": record.updated_at,
        "candidateName": record.candidate.full_name if record.candidate else None,
        "responsibleName": record.responsible_user.name if record.responsible_user else None,
        "candidate": (
            {
                "id": record.candidate.id,
                "fullName": record.candidate.full_name,
                "personalEmail": record.candidate.personal_email,
            }
            if record.candidate
            else None
        ),
        "responsibleUser": (
            {
                "id": record.responsible_user.id,
                "name": record.responsible_user.name,
                "role": record.responsible_user.role.value,
            }
            if record.responsible_user
            else None
        ),
    }


def _serialize_it_request(record: ITRequest) -> dict:
    return {
        "id": record.id,
        "candidateId": record.candidate_id,
        "requestedBy": record.requested_by,
        "assignedToId": record.assigned_to_id,
        "suggestedEmail": record.suggested_email,
        "createdEmail": record.created_email,
        "status": record.status,
        "completedAt": record.completed_at,
        "createdAt": record.created_at,
        "updatedAt": record.updated_at,
        "candidateName": record.candidate.full_name if record.candidate else None,
        "candidatePersonalEmail": record.candidate.personal_email if record.candidate else None,
    }


@router.get("/notifications", response_model=list[NotificationRead])
def notifications(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.NOTIFICATIONS_READ))],
):
    return [
        workflows.serialize_notification(notification, user=current_user)
        for notification in workflows.list_notifications(db, user=current_user)
    ]


@router.patch("/notifications/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.NOTIFICATIONS_READ))],
):
    notification = db.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id)
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.is_read = True
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return workflows.serialize_notification(notification, user=current_user)


@router.patch("/notifications/read-all")
def mark_all_notifications_read(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.NOTIFICATIONS_READ))],
):
    items = workflows.list_notifications(db, user=current_user)
    for item in items:
        item.is_read = True
        db.add(item)
    db.commit()
    return {"message": "Notifications marked as read"}


@router.delete("/notifications", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_notifications(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.NOTIFICATIONS_READ))],
):
    db.execute(delete(Notification).where(Notification.user_id == current_user.id))
    db.commit()
    return None


@router.delete("/notifications/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.NOTIFICATIONS_READ))],
):
    notification = db.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id)
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    db.delete(notification)
    db.commit()
    return None


@router.get("/id-card-forms", response_model=list[CandidateIdCardQueueItemRead])
def list_candidate_id_card_queue(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUTHENTICATED))],
):
    _assert_id_card_staff(current_user, action="view the candidate ID card queue")
    return workflows.list_candidate_id_card_queue(db)


@router.post("/id-card-forms/mark-done", response_model=CandidateIdCardBatchCompleteResponse)
def mark_candidate_id_cards_done(
    payload: CandidateIdCardBatchCompleteRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUTHENTICATED))],
):
    _assert_id_card_staff(current_user, action="mark candidate ID cards as done")
    result = workflows.mark_candidate_id_card_forms_done(
        db,
        candidate_ids=payload.candidate_ids,
        actor=current_user,
    )
    db.commit()
    return result


# Declared BEFORE "/id-card-forms/{candidate_id}" (below) so the literal path segment
# is matched first instead of being captured as a candidate id.
@router.get("/id-card-forms/status-template")
def download_id_card_status_template(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUTHENTICATED))],
):
    _assert_id_card_staff(current_user, action="download the ID card status sheet template")
    return StreamingResponse(
        iter([workflows.id_card_status_template_csv()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="id_card_status_template.csv"'},
    )


@router.post("/id-card-forms/status/upload")
def upload_id_card_status(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUTHENTICATED))],
    file: Annotated[UploadFile, File()],
):
    _assert_id_card_staff(current_user, action="upload an ID card status sheet")
    raw = file.file.read()
    try:
        rows = workflows.parse_id_card_status_csv(raw)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    summary = workflows.apply_id_card_status_results(db, rows=rows, actor=current_user)
    db.commit()
    return summary


@router.get("/escalations", response_model=list[EscalationRead])
def list_escalations(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.ESCALATIONS_READ))],
    status_value: str | None = Query(default=None, alias="status"),
):
    return [_serialize_escalation(item) for item in workflows.list_escalations(db, status_filter=status_value)]


@router.patch("/escalations/{escalation_id}/acknowledge", response_model=EscalationRead)
def acknowledge_escalation(
    escalation_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ESCALATIONS_WRITE))],
    payload: EscalationActionRequest | None = None,
):
    record = db.get(Escalation, escalation_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Escalation not found")
    _assert_can_act_on_escalation(record, current_user)
    record.status = "acknowledged"
    record.notes = payload.notes if payload else record.notes
    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize_escalation(record)


@router.patch("/escalations/{escalation_id}/resolve", response_model=EscalationRead)
def resolve_escalation(
    escalation_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ESCALATIONS_WRITE))],
    payload: EscalationActionRequest | None = None,
):
    record = db.get(Escalation, escalation_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Escalation not found")
    _assert_can_act_on_escalation(record, current_user)
    record.status = "resolved"
    record.resolved_by = current_user.id
    record.resolved_at = datetime.now(UTC)
    record.notes = payload.notes if payload else record.notes
    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize_escalation(record)


@router.get("/documents/all")
def list_all_documents(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DOCUMENTS_READ))],
    search: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = 1,
    limit: int = 20,
):
    # Staff-only org-wide document list. Candidates have DOCUMENTS_READ for their
    # OWN documents (scoped /documents and /documents/{id}/download), but must not
    # enumerate every candidate's documents + OCR-extracted PII here.
    _assert_staff_only(current_user, action="list all documents")
    _assert_candidate_document_access(current_user, action="view candidate documents")
    query = (
        select(Document)
        .join(Candidate, Document.candidate_id == Candidate.id)
        .order_by(Document.created_at.desc())
    )
    candidate_scope = candidate_service.build_candidate_access_scope(current_user)
    if candidate_scope is not None:
        query = query.where(candidate_scope)
    if status_filter:
        query = query.where(Document.status == status_filter)
    if search:
        from sqlalchemy import or_, func as sqlfunc
        query = query.where(
            or_(
                sqlfunc.lower(Candidate.full_name).contains(search.lower()),
                sqlfunc.lower(Document.type).contains(search.lower()),
                sqlfunc.lower(Document.file_name).contains(search.lower()),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = list(db.scalars(query.offset((page - 1) * limit).limit(limit)))
    data = []
    for doc in items:
        candidate = db.get(Candidate, doc.candidate_id)
        data.append({
            "id": doc.id,
            "candidateId": doc.candidate_id,
            "type": doc.type,
            "fileName": doc.file_name,
            "fileUrl": doc.file_url,
            "fileSize": doc.file_size,
            "mimeType": doc.mime_type,
            "status": doc.status,
            "ocrStatus": doc.ocr_status,
            "extractedData": doc.extracted_data,
            "createdAt": doc.created_at,
            "updatedAt": doc.updated_at,
            "candidate": {"id": candidate.id, "fullName": candidate.full_name} if candidate else None,
        })
    return {"data": data, "total": total, "page": page, "limit": limit, "totalPages": (total + limit - 1) // limit}


@router.get("/documents/{document_id}/download")
def download_document(
    document_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DOCUMENTS_READ))],
):
    from pathlib import Path
    from fastapi.responses import FileResponse
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    _assert_candidate_document_access(current_user, action="download candidate documents")
    _get_accessible_candidate(db, current_user=current_user, candidate_id=document.candidate_id)
    file_url = document.file_url or ""
    if file_url.startswith("/uploads/"):
        from app.core.config import get_settings
        import os
        settings = get_settings()
        relative = file_url.lstrip("/")
        local_path = Path(os.getcwd()) / relative
        if not local_path.exists():
            local_path = settings.local_storage_path.parent / relative
        if not local_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on server")
        return FileResponse(
            path=str(local_path),
            filename=document.file_name,
            media_type=document.mime_type or "application/octet-stream",
        )
    from fastapi.responses import RedirectResponse

    from app.services.integrations import StorageService

    download_url = StorageService().presigned_download_url(file_url)
    if download_url:
        return RedirectResponse(download_url)
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="File stored externally; use direct URL")


@router.get("/documents", response_model=list[DocumentRead])
def list_documents(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DOCUMENTS_READ))],
    candidate_id: str = Query(alias="candidateId"),
):
    _assert_candidate_document_access(current_user, action="view candidate documents")
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    return workflows.list_documents(db, candidate_id=candidate_id)


@router.post("/documents/upload", response_model=DocumentRead)
def upload_document(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DOCUMENTS_WRITE))],
    candidate_id: Annotated[str, Form(alias="candidateId")],
    type: Annotated[str, Form()],
    file: UploadFile = File(...),
):
    _assert_candidate_document_access(current_user, action="upload candidate documents")
    candidate = _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    document = workflows.upload_document(
        db,
        candidate=candidate,
        file=file,
        type_=type,
        actor=current_user,
    )
    db.commit()
    db.refresh(document)
    if type == "resume":
        if _screening_run_inline():
            workflows.run_resume_screening(
                db,
                candidate_id=candidate.id,
                actor=current_user,
            )
            db.commit()
        else:
            celery_app.send_task("app.tasks.screening.process_resume_screening", args=[candidate.id, None])
    else:
        celery_app.send_task("app.tasks.documents.process_document_ocr", args=[document.id])
    return document


@router.patch("/documents/{document_id}/verify", response_model=DocumentRead)
def verify_document(
    document_id: str,
    payload: DocumentVerifyRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DOCUMENTS_WRITE))],
):
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    _assert_staff_only(current_user, action="verify documents")
    _assert_candidate_document_access(current_user, action="verify candidate documents")
    updated = workflows.verify_document(db, document=document, status_value=payload.status, actor=current_user)
    db.commit()
    db.refresh(updated)
    return updated


@router.get("/it-requests", response_model=list[ITRequestRead])
def list_it_requests(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.IT_REQUESTS_READ))],
    status_value: str | None = Query(default=None, alias="status"),
):
    return [_serialize_it_request(item) for item in workflows.list_it_requests(db, status_filter=status_value)]


@router.patch("/it-requests/{request_id}/complete", response_model=ITRequestRead)
def complete_it_request(
    request_id: str,
    payload: ITRequestCompleteRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.IT_REQUESTS_WRITE))],
):
    record = db.get(ITRequest, request_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IT request not found")
    # If the request is explicitly assigned, only that assignee (or an admin) may
    # complete it. Unassigned requests stay open to any IT_REQUESTS_WRITE holder.
    if record.assigned_to_id and record.assigned_to_id != current_user.id and not _has_any_role(current_user, {
        Role.ADMIN,
        Role.SUPER_ADMIN,
        Role.LEADERSHIP,
    }):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This IT request is assigned to another user.",
        )
    updated = workflows.complete_it_request(
        db,
        record=record,
        created_email=payload.created_email,
        actor=current_user,
    )
    db.commit()
    db.refresh(updated)
    return _serialize_it_request(updated)


@router.get("/audit-logs", response_model=AuditLogListResponse)
def list_audit_logs(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUDIT_LOGS_READ))],
    entity_type: str | None = Query(default=None, alias="entityType"),
    page: int = 1,
    limit: int = 20,
):
    # Audit logs expose cross-candidate PII plus actor ip_address / user_agent.
    # Restrict to the admin tier so this matches the stricter /logs/audit-db gate
    # (_assert_log_admin). Other AUDIT_LOGS_READ holders (HR/TA/compliance/manager/
    # office_admin) are intentionally blocked here.
    # TODO: if a scoped lower-role view is later required, return a candidate-scoped
    # query (build_candidate_access_scope) with ip_address/user_agent stripped from
    # the response instead of widening this gate.
    if not _has_any_role(current_user, {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users can view audit logs.",
        )
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = list(db.scalars(query.offset((page - 1) * limit).limit(limit)))
    return {"data": items, "total": total, "page": page, "limit": limit, "totalPages": (total + limit - 1) // limit}


# Staff roles that may view/act on ANY evaluation. Other roles holding EVALUATIONS_*
# (i.e. EVALUATOR) are scoped to evaluations assigned to them.
_EVAL_STAFF_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}


def _assert_can_act_on_evaluation(evaluation: Evaluation, actor: User) -> None:
    if _has_any_role(actor, _EVAL_STAFF_ROLES):
        return
    if evaluation.evaluator_id and evaluation.evaluator_id != actor.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This evaluation is assigned to another evaluator.",
        )


@router.get("/evaluations", response_model=list[EvaluationRead])
def list_evaluations(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_READ))],
):
    query = (
        select(Evaluation)
        .options(
            selectinload(Evaluation.candidate).selectinload(Candidate.position),
            selectinload(Evaluation.evaluator),
            selectinload(Evaluation.pi_rounds).joinedload(PiInterviewRound.evaluator),
        )
        .order_by(Evaluation.created_at.desc())
    )
    # Evaluators (and other non-staff with read access) see only their own assignments.
    if not _has_any_role(current_user, _EVAL_STAFF_ROLES):
        query = query.where(Evaluation.evaluator_id == current_user.id)
    rows = list(db.scalars(query))
    return [_serialize_evaluation(row) for row in rows]


@router.post("/evaluations", response_model=EvaluationRead)
def assign_evaluation(
    payload: EvaluationCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
):
    # Creating/assigning an evaluation is a staff action. A plain EVALUATOR holds
    # EVALUATIONS_WRITE so they can submit/score their own assignments, but must not
    # be able to create (and thereby self-assign) a brand-new Evaluation. The
    # supplied evaluator_id is validated against an active EVALUATOR inside the
    # service (ensure_evaluation_assignment).
    if not _has_any_role(current_user, _EVAL_STAFF_ROLES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin, HR, and TA users can assign evaluations.",
        )
    evaluation = workflows.ensure_evaluation_assignment(
        db,
        candidate_id=payload.candidate_id,
        evaluator_id=payload.evaluator_id,
        actor=current_user,
    )
    db.commit()
    db.refresh(evaluation)
    return _serialize_evaluation(evaluation)


@router.patch("/evaluations/{evaluation_id}/submit", response_model=EvaluationRead)
def submit_evaluation(
    evaluation_id: str,
    payload: EvaluationSubmitRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
):
    evaluation = db.get(Evaluation, evaluation_id)
    if evaluation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    _assert_can_act_on_evaluation(evaluation, current_user)
    updated = workflows.submit_evaluation(
        db,
        evaluation=evaluation,
        payload=payload.model_dump(exclude_none=True),
        actor=current_user,
    )
    db.commit()
    db.refresh(updated)
    return _serialize_evaluation(updated)


@router.patch("/evaluations/{evaluation_id}/schedule", response_model=EvaluationRead)
def schedule_interview(
    evaluation_id: str,
    payload: InterviewScheduleRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
):
    evaluation = db.get(Evaluation, evaluation_id)
    if evaluation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    _assert_can_act_on_evaluation(evaluation, current_user)
    updated = workflows.schedule_interview(
        db,
        evaluation=evaluation,
        subject=payload.subject,
        scheduled_at=payload.scheduled_at,
        notes=payload.notes,
        actor=current_user,
        mode=payload.mode,
        duration_minutes=payload.duration_minutes,
        round_number=payload.round_number,
        evaluator_id=payload.evaluator_id,
        panel_label=payload.panel_label,
        panel_members=payload.panel_members,
    )
    db.commit()
    db.refresh(updated)
    return _serialize_evaluation(updated)


@router.patch("/evaluations/{evaluation_id}/complete", response_model=EvaluationRead)
def complete_interview(
    evaluation_id: str,
    payload: InterviewCompleteRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
):
    evaluation = db.get(Evaluation, evaluation_id)
    if evaluation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    _assert_can_act_on_evaluation(evaluation, current_user)
    updated = workflows.complete_interview(
        db,
        evaluation=evaluation,
        decision=payload.decision,
        notes=payload.notes,
        actor=current_user,
        pi_score=payload.pi_score,
        round_id=payload.round_id,
        round_number=payload.round_number,
        no_further_pi_required=payload.no_further_pi_required,
        final_verdict=payload.final_verdict,
    )
    db.commit()
    db.refresh(updated)
    return _serialize_evaluation(updated)


@router.patch("/evaluations/{evaluation_id}/pi-bypass", response_model=EvaluationRead)
def bypass_pi_interview(
    evaluation_id: str,
    payload: PiBypassRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
):
    if not _has_any_role(current_user, {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.EVALUATOR, Role.HR, Role.TA}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin, HR, TA, Leadership, and Evaluator users can bypass PI.",
        )
    evaluation = db.get(Evaluation, evaluation_id)
    if evaluation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    _assert_can_act_on_evaluation(evaluation, current_user)
    updated = workflows.bypass_pi_interview(
        db,
        evaluation=evaluation,
        actor=current_user,
        final_verdict=payload.final_verdict,
        notes=payload.notes,
        pi_score=payload.pi_score,
    )
    db.commit()
    db.refresh(updated)
    return _serialize_evaluation(updated)


@router.patch("/candidates/{candidate_id}/pi-bypass", response_model=EvaluationRead)
def bypass_candidate_pi_interview(
    candidate_id: str,
    payload: PiBypassRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
):
    if not _has_any_role(current_user, {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.EVALUATOR, Role.HR, Role.TA}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin, HR, TA, Leadership, and Evaluator users can bypass PI.",
        )
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    candidate_service.enforce_candidate_access(candidate=candidate, user=current_user)

    evaluation = db.scalar(
        select(Evaluation)
        .where(Evaluation.candidate_id == candidate_id)
        .order_by(desc(Evaluation.created_at))
    )
    if evaluation is None:
        if _has_any_role(current_user, {Role.EVALUATOR}) and not _has_any_role(current_user, _EVAL_STAFF_ROLES):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No evaluation assignment is available for this candidate.",
            )
        evaluation = workflows.ensure_evaluation_assignment(
            db,
            candidate_id=candidate_id,
            actor=current_user,
        )
    _assert_can_act_on_evaluation(evaluation, current_user)
    updated = workflows.bypass_pi_interview(
        db,
        evaluation=evaluation,
        actor=current_user,
        final_verdict=payload.final_verdict,
        notes=payload.notes,
        pi_score=payload.pi_score,
    )
    db.commit()
    db.refresh(updated)
    return _serialize_evaluation(updated)


@router.patch("/evaluations/{evaluation_id}/pms-score", response_model=EvaluationRead)
def update_pms_score(
    evaluation_id: str,
    payload: EvaluationPmsScoreUpdateRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
):
    _assert_pms_staff(current_user, action="update PMS scores")
    evaluation = db.get(Evaluation, evaluation_id)
    if evaluation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    if payload.pms_score < 0 or payload.pms_score > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PMS score must be between 0 and 100")

    previous_score = evaluation.pms_score
    evaluation.pms_score = payload.pms_score
    db.add(evaluation)
    db.add(
        AuditLog(
            entity_type="evaluation",
            entity_id=evaluation.id,
            action="pms_score_updated",
            performed_by=current_user.id,
            performed_by_name=current_user.name,
            performed_by_role=current_user.role.value,
            candidate_id=evaluation.candidate_id,
            user_id=current_user.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            old_value={"pmsScore": previous_score},
            new_value={"pmsScore": payload.pms_score},
        )
    )
    db.commit()
    db.refresh(evaluation)
    return _serialize_evaluation(evaluation)


@router.get("/id-card-forms/{candidate_id}", response_model=CandidateIdCardFormRead)
def get_candidate_id_card_form(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_READ))],
):
    _assert_id_card_staff(current_user, action="view candidate ID card forms")
    candidate = _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    return workflows.get_candidate_id_card_form(db, candidate=candidate)


@router.post("/id-card-forms/{candidate_id}", response_model=CandidateIdCardFormRead)
def submit_candidate_id_card_form(
    candidate_id: str,
    payload: CandidateIdCardFormSubmitRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_READ))],
):
    _assert_id_card_staff(current_user, action="update candidate ID card forms")
    candidate = _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    updated = workflows.submit_candidate_id_card_form(
        db,
        candidate=candidate,
        actor=current_user,
        payload=payload.model_dump(),
    )
    db.commit()
    return updated


@router.get("/selection-forms/{candidate_id}", response_model=SelectionFormRead)
def get_selection_form(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SELECTION_FORMS_READ))],
):
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    record = workflows.get_or_create_selection_form(db, candidate_id=candidate_id)
    return _selection_form_read_payload(db, record)


@router.get("/selection-forms/{candidate_id}/documents/{document_key}/preview")
def preview_selection_form_document(
    candidate_id: str,
    document_key: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SELECTION_FORMS_READ))],
):
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    record = db.scalar(select(SelectionForm).where(SelectionForm.candidate_id == candidate_id))
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selection form not found")
    metadata = _selection_form_document_entry(record, document_key)
    document = _find_selection_form_document(
        db,
        candidate_id=candidate_id,
        document_key=document_key,
        metadata=metadata,
    )
    return _serve_document_file(document, inline=True)


@router.get("/selection-forms/{candidate_id}/documents/{document_key}/download")
def download_selection_form_document(
    candidate_id: str,
    document_key: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SELECTION_FORMS_READ))],
):
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    record = db.scalar(select(SelectionForm).where(SelectionForm.candidate_id == candidate_id))
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selection form not found")
    metadata = _selection_form_document_entry(record, document_key)
    document = _find_selection_form_document(
        db,
        candidate_id=candidate_id,
        document_key=document_key,
        metadata=metadata,
    )
    return _serve_document_file(document, inline=False)


@router.post("/selection-forms/{candidate_id}/documents/{document_key}/verify")
def verify_selection_form_document(
    candidate_id: str,
    document_key: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SELECTION_FORMS_WRITE))],
    file: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    document_type = f"selection_form_{document_key}"
    if file is not None:
        return employee_service.verify_document_type(
            file=file,
            document_type=document_type,
        )

    _assert_staff_only(current_user, action="verify selection form documents")
    record = db.scalar(select(SelectionForm).where(SelectionForm.candidate_id == candidate_id))
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selection form not found")
    outcome = _persist_selection_form_document_verification(
        db,
        record=record,
        document_key=document_key,
        actor=current_user,
    )
    db.commit()
    db.refresh(record)
    return {"result": outcome["result"], "form": _selection_form_read_payload(db, record)}


@router.post("/selection-forms/{candidate_id}/documents/{document_key}/upload", response_model=SelectionFormRead)
def upload_selection_form_document(
    candidate_id: str,
    document_key: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SELECTION_FORMS_WRITE))],
    file: UploadFile = File(...),
):
    _assert_staff_only(current_user, action="attach selection form documents")
    candidate = _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    record = workflows.get_or_create_selection_form(db, candidate_id=candidate_id)

    document = workflows.upload_document(
        db,
        candidate=candidate,
        file=file,
        type_=f"selection_form_{document_key}",
        actor=current_user,
    )

    form_data = copy.deepcopy(record.form_data) if isinstance(record.form_data, dict) else {}
    documents = form_data.get("documentsUploaded")
    if not isinstance(documents, dict):
        documents = {}
    current_entry = documents.get(document_key)
    current_metadata = _selection_form_document_metadata(current_entry) or {}
    documents[document_key] = {
        "fileName": document.file_name or current_metadata.get("file_name") or file.filename or "upload",
        "documentId": document.id,
        "fileUrl": document.file_url,
        "mimeType": document.mime_type,
    }
    form_data["documentsUploaded"] = documents
    record.form_data = form_data
    db.add(record)
    db.commit()
    db.refresh(record)
    return _selection_form_read_payload(db, record)


@router.patch("/selection-forms/{candidate_id}/reopen", response_model=SelectionFormRead)
def reopen_selection_form(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SELECTION_FORMS_WRITE))],
):
    _assert_staff_only(current_user, action="reopen selection forms")
    candidate = _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    record = workflows.get_or_create_selection_form(db, candidate_id=candidate_id)
    record.submitted_at = None
    record.validated_at = None
    record.sent_at = record.sent_at or datetime.now(UTC)
    workflows.clear_selection_form_verification_queue_state(record)
    candidate.current_stage = CandidateStage.SELECTION_FORM_SENT
    candidate.current_status = workflows.stage_to_status(CandidateStage.SELECTION_FORM_SENT)
    db.add(record)
    db.add(candidate)
    db.commit()
    db.refresh(record)
    return _selection_form_read_payload(db, record)


@router.post("/selection-forms/{candidate_id}/submit", response_model=SelectionFormRead)
def submit_selection_form(
    candidate_id: str,
    payload: SelectionFormSubmitRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SELECTION_FORMS_WRITE))],
):
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    record = workflows.get_or_create_selection_form(db, candidate_id=candidate_id)
    if record.submitted_at is not None:
        state = workflows.selection_form_verification_queue_state(record)
        detail = (
            "Your selection form is already submitted and document checks are in queue. "
            "Please wait while we finish processing it."
            if state.get("status") in {"queued", "processing", "submitted"}
            else "Your selection form is already submitted. Please wait for HR review."
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)

    updated = workflows.submit_selection_form(
        db,
        selection_form=record,
        form_data=payload.form_data,
        actor=current_user,
    )
    queue_verification = workflows.selection_form_has_documents_to_queue(updated)
    if queue_verification:
        workflows.set_selection_form_verification_queue_state(
            updated,
            status_value="queued",
            message="Document checks are queued. Please wait while we verify the uploaded files.",
        )
    db.commit()
    db.refresh(updated)
    if queue_verification:
        try:
            celery_app.send_task(
                "app.tasks.documents.process_selection_form_verification",
                args=[updated.id, current_user.id],
            )
        except Exception:
            workflows.set_selection_form_verification_queue_state(
                updated,
                status_value="failed",
                message="Document checks could not be queued automatically. HR will review the form.",
            )
            db.commit()
            db.refresh(updated)
    return _selection_form_read_payload(db, updated)


@router.patch("/selection-forms/{candidate_id}/validate", response_model=SelectionFormRead)
def validate_selection_form(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SELECTION_FORMS_WRITE))],
):
    _assert_staff_only(current_user, action="validate selection forms")
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    record = workflows.get_or_create_selection_form(db, candidate_id=candidate_id)
    updated = workflows.validate_selection_form(db, selection_form=record, actor=current_user)
    db.commit()
    db.refresh(updated)
    return _selection_form_read_payload(db, updated)


@router.get("/contracts/{candidate_id}", response_model=ContractRead)
def get_contract(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_READ))],
):
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    return workflows.ensure_contract(db, candidate_id)


@router.patch("/contracts/{candidate_id}", response_model=ContractRead)
def update_contract(
    candidate_id: str,
    payload: ContractUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    contract = workflows.ensure_contract(db, candidate_id)
    updated = workflows.update_contract(
        db,
        contract=contract,
        payload=payload.model_dump(exclude_none=True),
        actor=current_user,
    )
    db.commit()
    db.refresh(updated)
    return updated


@router.get("/compliance", response_model=list[ComplianceFormRead])
def list_compliance_forms(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_READ))],
    candidate_id: str = Query(alias="candidateId"),
):
    _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    return workflows.list_compliance_forms(db, candidate_id)


@router.post("/compliance/send-esign/{candidate_id}", response_model=list[ComplianceFormRead])
def send_candidate_compliance_forms(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    _assert_compliance_sender(current_user)
    candidate = _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    contract = candidate.contract
    if contract is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract must be signed before sending statutory forms.")
    if getattr(contract.status, "value", contract.status) != "signed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract must be signed before sending statutory forms.")
    from app.services import compliance_documenso as compliance_esign

    try:
        compliance_esign.send_candidate_compliance_forms(db, candidate=candidate)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.commit()
    return workflows.list_compliance_forms(db, candidate_id)


@router.post("/compliance/sync/{candidate_id}", response_model=list[ComplianceFormRead])
def sync_candidate_compliance_status(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    """Pull a candidate's Documenso compliance forms' signing status on demand (like the contract
    Check-Status). When all are signed, completes onboarding and issues the employee credentials."""
    candidate = _get_accessible_candidate(db, current_user=current_user, candidate_id=candidate_id)
    from app.services import compliance_documenso as compliance_esign

    compliance_esign.sync_candidate_compliance(db, candidate=candidate)
    db.commit()
    from app.db.models import ComplianceForm

    return list(
        db.scalars(select(ComplianceForm).where(ComplianceForm.candidate_id == candidate_id))
    )


def _get_accessible_compliance_form(
    db: Session,
    *,
    current_user: User,
    form_id: str,
) -> ComplianceForm:
    record = db.get(ComplianceForm, form_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Compliance form not found")
    _get_accessible_candidate(db, current_user=current_user, candidate_id=record.candidate_id)
    return record


@router.post("/compliance/{form_id}/resend-esign", response_model=ComplianceFormRead)
def resend_candidate_compliance_form(
    form_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    _assert_compliance_sender(current_user)
    record = _get_accessible_compliance_form(db, current_user=current_user, form_id=form_id)
    if record.status == "signed" and record.pdf_url:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This compliance form is already signed.",
        )

    from app.services import compliance_documenso as compliance_esign

    try:
        updated = compliance_esign.resend_candidate_compliance_form(db, form=record)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.commit()
    db.refresh(updated)
    return updated


@router.post("/compliance/{form_id}/cancel", response_model=list[ComplianceFormRead])
def cancel_candidate_compliance_form(
    form_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    """Cancel a statutory form (and remove it if it's a duplicate). Returns the
    candidate's remaining forms so the UI can refresh."""
    _assert_compliance_sender(current_user)
    record = _get_accessible_compliance_form(db, current_user=current_user, form_id=form_id)
    if record.status in ("signed", "verified") and record.pdf_url:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A signed form cannot be cancelled.",
        )
    candidate_id = record.candidate_id
    from app.services import compliance_documenso as compliance_esign

    compliance_esign.cancel_candidate_compliance_form(db, form=record)
    db.commit()
    return workflows.list_compliance_forms(db, candidate_id)


@router.post("/compliance/{form_id}/remind", response_model=ComplianceFormRead)
def remind_candidate_compliance_form(
    form_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    """Email the candidate the existing signing link (no new Documenso document)."""
    _assert_compliance_sender(current_user)
    record = _get_accessible_compliance_form(db, current_user=current_user, form_id=form_id)
    from app.services import compliance_documenso as compliance_esign

    try:
        updated = compliance_esign.remind_candidate_compliance_form(db, form=record)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.commit()
    db.refresh(updated)
    return updated


@router.get("/compliance/{form_id}/preview")
def preview_compliance_form(
    form_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_READ))],
):
    record = _get_accessible_compliance_form(db, current_user=current_user, form_id=form_id)
    return _serve_file_url(
        file_url=record.pdf_url,
        file_name=f"{record.form_title or record.form_type or 'Compliance form'}.pdf",
        media_type="application/pdf",
        inline=True,
    )


@router.get("/compliance/{form_id}/download")
def download_compliance_form(
    form_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_READ))],
):
    record = _get_accessible_compliance_form(db, current_user=current_user, form_id=form_id)
    return _serve_file_url(
        file_url=record.pdf_url,
        file_name=f"{record.form_title or record.form_type or 'Compliance form'}.pdf",
        media_type="application/pdf",
        inline=False,
    )


@router.post("/compliance/{form_id}/submit", response_model=ComplianceFormRead)
def submit_compliance_form(
    form_id: str,
    payload: ComplianceFormSubmitRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    record = db.get(ComplianceForm, form_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Compliance form not found")
    _get_accessible_candidate(db, current_user=current_user, candidate_id=record.candidate_id)
    updated = workflows.submit_compliance_form(db, record=record, form_data=payload.form_data, actor=current_user)
    db.commit()
    db.refresh(updated)
    return updated


@router.patch("/compliance/{form_id}/verify", response_model=ComplianceFormRead)
def verify_compliance_form(
    form_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COMPLIANCE_WRITE))],
):
    record = db.get(ComplianceForm, form_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Compliance form not found")
    _assert_staff_only(current_user, action="verify compliance forms")
    updated = workflows.verify_compliance_form(db, record=record, actor=current_user)
    db.commit()
    db.refresh(updated)
    return updated


@router.get("/screening", response_model=ScreeningListResponse)
def list_screening_records(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_READ))],
    search: str | None = None,
    recommendation: str | None = None,
    page: int = 1,
    limit: int = 25,
):
    _assert_screening_staff(current_user, action="view resume screening")
    records, total = workflows.list_screening_candidates(
        db,
        search=search,
        recommendation=recommendation,
        page=page,
        limit=limit,
    )
    return {
        "data": records,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit if limit else 1,
    }


@router.get("/screening/{candidate_id}", response_model=ScreeningRecordRead)
def get_screening_record(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_READ))],
):
    _assert_screening_staff(current_user, action="view screening details")
    candidate = workflows.get_screening_candidate_or_404(db, candidate_id=candidate_id)
    return workflows.build_screening_record(candidate)


@router.post("/screening/{candidate_id}/override", response_model=ScreeningRecordRead)
def override_screening_record(
    candidate_id: str,
    payload: ScreeningOverrideRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_WRITE))],
):
    _assert_screening_staff(current_user, action="override screening decisions")
    candidate = workflows.get_screening_candidate_or_404(db, candidate_id=candidate_id)
    updated = workflows.override_resume_screening(
        db,
        candidate=candidate,
        recommendation=payload.recommendation,
        reason=payload.reason,
        actor=current_user,
        request=request,
    )
    db.commit()
    db.refresh(updated)
    refreshed = workflows.get_screening_candidate_or_404(db, candidate_id=candidate_id)
    return workflows.build_screening_record(refreshed)


@router.get("/search")
def global_search(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_READ))],
    q: str = Query(min_length=1),
    limit: int = Query(default=10, le=20),
):
    from sqlalchemy import or_, func as sqlfunc
    like = q.lower()

    # Only surface candidates the caller may actually open. Roles that cannot open
    # ANY candidate detail (IT, Compliance, Evaluator, Office Admin, …) must get
    # zero candidate hits — otherwise global search leaks the entire candidate
    # roster (names, emails, codes, stages) to them. Full-access staff see
    # everyone; vendors / referrers are additionally narrowed to their own
    # candidates by build_candidate_access_scope.
    can_open_candidate_detail = _has_any_role(current_user, {
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.HR,
        Role.TA,
        Role.VENDOR,
        Role.EMPLOYEE_REFERRER,
    })
    candidate_scope = candidate_service.build_candidate_access_scope(current_user)

    candidates: list[Candidate] = []
    if can_open_candidate_detail:
        candidate_query = (
            select(Candidate)
            .where(
                or_(
                    sqlfunc.lower(Candidate.full_name).contains(like),
                    sqlfunc.lower(Candidate.personal_email).contains(like),
                    sqlfunc.lower(Candidate.candidate_code).contains(like),
                )
            )
            .limit(limit)
        )
        if candidate_scope is not None:
            candidate_query = candidate_query.where(candidate_scope)
        candidates = list(db.scalars(candidate_query))

    documents: list[Document] = []
    if _can_view_candidate_documents(current_user):
        doc_query = (
            select(Document)
            .join(Candidate, Document.candidate_id == Candidate.id)
            .where(
                or_(
                    sqlfunc.lower(Document.type).contains(like),
                    sqlfunc.lower(Document.file_name).contains(like),
                    sqlfunc.lower(Candidate.full_name).contains(like),
                )
            )
            .limit(limit)
        )
        if candidate_scope is not None:
            doc_query = doc_query.where(candidate_scope)
        documents = list(db.scalars(doc_query))

    return {
        "candidates": [
            {
                "id": c.id,
                "fullName": c.full_name,
                "candidateCode": c.candidate_code,
                "currentStage": c.current_stage.value,
                "position": {"title": c.position.title} if c.position else None,
                "canOpenDetail": can_open_candidate_detail,
            }
            for c in candidates
        ],
        "documents": [
            {
                "id": d.id,
                "type": d.type,
                "fileName": d.file_name,
                "candidateId": d.candidate_id,
                "candidateName": db.get(Candidate, d.candidate_id).full_name if db.get(Candidate, d.candidate_id) else None,
            }
            for d in documents
        ],
    }


@router.post("/screening/{candidate_id}/run", response_model=ScreeningRecordRead)
def run_screening(
    candidate_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SCREENING_RUN))],
    payload: ManualScreeningRequest | None = None,
):
    _assert_screening_staff(current_user, action="run screening")
    candidate = workflows.get_screening_candidate_or_404(db, candidate_id=candidate_id)
    updated = workflows.run_resume_screening(
        db,
        candidate_id=candidate.id,
        job_description=payload.job_description if payload else None,
        actor=current_user,
        request=request,
    )
    db.commit()
    db.refresh(updated)
    refreshed = workflows.get_screening_candidate_or_404(db, candidate_id=candidate_id)
    return workflows.build_screening_record(refreshed)
