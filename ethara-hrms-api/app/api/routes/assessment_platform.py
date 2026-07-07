"""Assessment Platform — a generic, reusable test/quiz engine.

Separate from the recruitment-pipeline assessment routes (`/assessments`,
`/assessment-templates`). Everything here is namespaced under `/assessment-platform`
and gated by the `assessment_platform:*` permissions + the `assessment_platform`
module. Taker endpoints live under `/assessment-platform/me/...` (auto-exempt from
module gating; access is enforced by assignment ownership instead).
"""

from __future__ import annotations

import csv
import io
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import get_current_user, require_permissions, user_has_any_role
from app.core.config import get_settings
from app.core.database import get_db
from app.core.exports import csv_safe_row
from app.core.permissions import Permission
from app.core.security import hash_password
from app.db.models import (
    ApAnswer,
    ApAssessment,
    ApAssessmentStatus,
    ApAssignment,
    ApAssignmentStatus,
    ApAttempt,
    ApAttemptStatus,
    ApQuestion,
    ApQuestionBank,
    ApQuestionType,
    ApSection,
    Candidate,
    CandidateStage,
    NotificationType,
    Role,
    SelectionForm,
    User,
    generate_id,
)
from app.schemas.assessment_platform import (
    AddFromBankRequest,
    AnswerSaveRequest,
    AssessmentBypassRequest,
    AssessmentCreate,
    AssessmentSettingsUpdate,
    AssessmentUpdate,
    AssignEmailsRequest,
    GradeAnswerRequest,
    QuestionBankCreate,
    QuestionBankUpdate,
    ProctoringEventRequest,
    QuestionCreate,
    QuestionUpdate,
    ReorderRequest,
    SectionCreate,
    SectionUpdate,
)
from app.services import assessment_platform as svc
from app.services import sheets
from app.services.audit import log_audit
from app.services.integrations import EmailService, StorageService
from app.services.workflows import apply_stage_side_effects, create_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assessment-platform", tags=["assessment-platform"])

ReadDep = Annotated[User, Depends(require_permissions(Permission.ASSESSMENT_PLATFORM_READ))]
ManageDep = Annotated[User, Depends(require_permissions(Permission.ASSESSMENT_PLATFORM_MANAGE))]
GradeDep = Annotated[User, Depends(require_permissions(Permission.ASSESSMENT_PLATFORM_GRADE))]
DbDep = Annotated[Session, Depends(get_db)]

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MAX_BULK_EMAILS = 2000
_MAX_CSV_BYTES = 5 * 1024 * 1024

AUTO_SCORED_TYPES = svc.AUTO_KEY_TYPES
MANUAL_TYPES: frozenset[ApQuestionType] = frozenset(
    {ApQuestionType.LONG_ANSWER, ApQuestionType.FILE_UPLOAD, ApQuestionType.URL_SUBMISSION}
)
_QUESTION_TYPE_LABELS: dict[ApQuestionType, str] = {
    ApQuestionType.MCQ_SINGLE: "Single-choice MCQ",
    ApQuestionType.MCQ_MULTI: "Multiple-choice MCQ",
    ApQuestionType.TRUE_FALSE: "True / False",
    ApQuestionType.SHORT_ANSWER: "Short answer",
    ApQuestionType.LONG_ANSWER: "Long answer / Essay",
    ApQuestionType.FILE_UPLOAD: "File upload",
    ApQuestionType.URL_SUBMISSION: "URL submission",
    ApQuestionType.RATING: "Rating / Likert scale",
    ApQuestionType.FORM_TEXT: "Text field",
    ApQuestionType.FORM_DATE: "Date field",
    ApQuestionType.FORM_DROPDOWN: "Dropdown",
    ApQuestionType.CONSENT: "Consent checkbox",
}


def _now() -> datetime:
    return datetime.now(UTC)


# ──────────────────────────────── helpers ────────────────────────────────────


def _load_assessment(db: Session, assessment_id: str, *, with_structure: bool = True) -> ApAssessment:
    stmt = select(ApAssessment).where(
        ApAssessment.id == assessment_id, ApAssessment.is_removed.is_(False)
    )
    if with_structure:
        stmt = stmt.options(selectinload(ApAssessment.sections).selectinload(ApSection.questions))
    assessment = db.scalar(stmt)
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return assessment


def _ensure_draft(assessment: ApAssessment) -> None:
    if assessment.status is not ApAssessmentStatus.DRAFT:
        raise HTTPException(
            status_code=400,
            detail="Published assessments are immutable. Clone it to make changes.",
        )


def _load_section(db: Session, assessment: ApAssessment, section_id: str) -> ApSection:
    section = db.scalar(
        select(ApSection).where(
            ApSection.id == section_id, ApSection.assessment_id == assessment.id
        )
    )
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    return section


def _load_question(db: Session, assessment: ApAssessment, question_id: str) -> ApQuestion:
    question = db.scalar(
        select(ApQuestion).where(
            ApQuestion.id == question_id, ApQuestion.assessment_id == assessment.id
        )
    )
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return question


def _next_order(items: list[Any]) -> int:
    return (max((i.order_index for i in items), default=-1)) + 1


def _paginate_params(page: int, limit: int) -> tuple[int, int]:
    page = max(1, page)
    limit = max(1, min(limit, 200))
    return page, limit


def _parse_emails(raw_emails: list[str]) -> tuple[list[str], list[dict[str, str]]]:
    valid: list[str] = []
    skipped: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in raw_emails:
        email = (raw or "").strip().lower()
        if not email:
            continue
        if not _EMAIL_RE.match(email):
            skipped.append({"email": raw, "reason": "invalid email"})
            continue
        if email in seen:
            continue
        seen.add(email)
        valid.append(email)
    return valid, skipped


def _emails_from_csv(raw: bytes) -> list[str]:
    if len(raw) > _MAX_CSV_BYTES:
        raise HTTPException(status_code=400, detail="CSV file too large (max 5MB)")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="ignore")
    emails: list[str] = []
    for row in csv.reader(io.StringIO(text)):
        for cell in row:
            candidate = (cell or "").strip()
            if _EMAIL_RE.match(candidate.lower()):
                emails.append(candidate)
    return emails


def _bulk_bypass_rows_from_csv(raw: bytes) -> list[dict[str, Any]]:
    if len(raw) > _MAX_CSV_BYTES:
        raise HTTPException(status_code=400, detail="CSV file too large (max 5MB)")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="ignore")

    csv_rows = [
        (line_number, row)
        for line_number, row in enumerate(csv.reader(io.StringIO(text)), start=1)
        if any((cell or "").strip() for cell in row)
    ]
    if not csv_rows:
        raise HTTPException(status_code=400, detail="CSV file is empty.")
    if len(csv_rows) > _MAX_BULK_EMAILS + 1:
        raise HTTPException(status_code=400, detail=f"CSV can contain at most {_MAX_BULK_EMAILS} rows.")

    def key(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())

    email_headers = {
        "email",
        "emailaddress",
        "candidateemail",
        "candidateemailaddress",
        "personalemail",
        "personalemailaddress",
    }
    result_headers = {"result", "status", "decision", "outcome", "assessmentresult", "pass"}
    first_cells = csv_rows[0][1]
    first_keys = [key(cell) for cell in first_cells]
    has_header = bool(first_keys) and (
        first_keys[0] in email_headers
        or any(header in email_headers for header in first_keys)
    )

    email_index = 0
    result_index = 1
    data_rows = csv_rows
    if has_header:
        email_index = next(
            (idx for idx, header in enumerate(first_keys) if header in email_headers),
            -1,
        )
        result_index = next(
            (idx for idx, header in enumerate(first_keys) if header in result_headers),
            -1,
        )
        if email_index < 0:
            raise HTTPException(status_code=400, detail="CSV must include an email column.")
        if result_index < 0 and len(first_cells) > 1:
            result_index = 1
        data_rows = csv_rows[1:]

    parsed: list[dict[str, Any]] = []
    for line_number, row in data_rows:
        email = row[email_index].strip().lower() if len(row) > email_index else ""
        result = row[result_index].strip().lower() if result_index >= 0 and len(row) > result_index else ""
        parsed.append({"row": line_number, "email": email, "result": result})
    return parsed


def _staff_only(current_user: User) -> None:
    """Belt-and-braces: provisioning + grading are never for candidate/vendor accounts."""
    if user_has_any_role(current_user, {Role.CANDIDATE, Role.VENDOR}) and not user_has_any_role(
        current_user,
        {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA, Role.EVALUATOR},
    ):
        raise HTTPException(status_code=403, detail="Not permitted")


# ════════════════════════════════ META ═══════════════════════════════════════


@router.get("/question-types")
def list_question_types(_: ReadDep) -> list[dict]:
    """Catalog of supported question types + their scoring mode (drives the builder)."""
    return [
        {
            "type": qtype.value,
            "label": _QUESTION_TYPE_LABELS[qtype],
            "autoScored": qtype in AUTO_SCORED_TYPES,
            "manualOnly": qtype in MANUAL_TYPES,
        }
        for qtype in ApQuestionType
    ]


# ═══════════════════════════════ BUILDER ══════════════════════════════════════


@router.get("/assessments")
def list_assessments(
    db: DbDep,
    current_user: ReadDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    search: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query()] = 1,
    limit: Annotated[int, Query()] = 50,
) -> dict[str, Any]:
    page, limit = _paginate_params(page, limit)
    stmt = select(ApAssessment).where(ApAssessment.is_removed.is_(False))
    if status_filter:
        stmt = stmt.where(ApAssessment.status == status_filter)
    if search:
        stmt = stmt.where(ApAssessment.title.ilike(f"%{search.strip()}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.options(selectinload(ApAssessment.sections).selectinload(ApSection.questions))
        .order_by(ApAssessment.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()
    # assignment counts in one grouped query
    ids = [a.id for a in rows]
    counts: dict[str, int] = {}
    if ids:
        for aid, cnt in db.execute(
            select(ApAssignment.assessment_id, func.count(ApAssignment.id))
            .where(ApAssignment.assessment_id.in_(ids))
            .group_by(ApAssignment.assessment_id)
        ).all():
            counts[aid] = cnt
    data = []
    for assessment in rows:
        serialized = svc.serialize_assessment(assessment)
        serialized["assignmentCount"] = counts.get(assessment.id, 0)
        data.append(serialized)
    return {
        "data": data,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit,
    }


@router.post("/assessments", status_code=201)
def create_assessment(
    payload: AssessmentCreate, db: DbDep, current_user: ManageDep, request: Request
) -> dict[str, Any]:
    assessment = ApAssessment(
        title=payload.title.strip(),
        description=payload.description,
        instructions=payload.instructions,
        consent_text=payload.consent_text,
        time_limit_minutes=payload.time_limit_minutes,
        attempts_allowed=max(1, payload.attempts_allowed),
        randomize_sections=payload.randomize_sections,
        randomize_questions=payload.randomize_questions,
        shuffle_options=payload.shuffle_options,
        negative_marking=payload.negative_marking,
        negative_factor=payload.negative_factor,
        pass_percentage=payload.pass_percentage,
        show_results_to_candidate=payload.show_results_to_candidate,
        available_from=payload.available_from,
        available_until=payload.available_until,
        settings=payload.settings,
        position_id=payload.position_id,
        created_by=current_user.id,
    )
    db.add(assessment)
    db.flush()
    log_audit(
        db, entity_type="ap_assessment", entity_id=assessment.id, action="created",
        actor=current_user, request=request, new_value={"title": assessment.title},
    )
    db.commit()
    db.refresh(assessment)
    return svc.serialize_assessment(assessment, include_structure=True)


@router.post("/assessments/import", status_code=201)
def import_assessment(
    payload: dict, db: DbDep, current_user: ManageDep, request: Request
) -> dict[str, Any]:
    """Form-as-code: build a draft assessment from a JSON spec (Apps-Script style)."""
    assessment = svc.spec_to_assessment(db, payload, actor=current_user)
    log_audit(
        db, entity_type="ap_assessment", entity_id=assessment.id, action="imported",
        actor=current_user, request=request, new_value={"title": assessment.title},
    )
    db.commit()
    assessment = _load_assessment(db, assessment.id)
    return svc.serialize_assessment(assessment, include_structure=True)


@router.get("/assessments/{assessment_id}")
def get_assessment(assessment_id: str, db: DbDep, current_user: ReadDep) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    return svc.serialize_assessment(assessment, include_structure=True)


@router.get("/assessments/{assessment_id}/export")
def export_assessment(assessment_id: str, db: DbDep, current_user: ReadDep) -> dict[str, Any]:
    """Dump an assessment back to the editable code/JSON spec (round-trips with import)."""
    assessment = _load_assessment(db, assessment_id)
    return svc.assessment_to_spec(assessment)


@router.patch("/assessments/{assessment_id}")
def update_assessment(
    assessment_id: str,
    payload: AssessmentUpdate,
    db: DbDep,
    current_user: ManageDep,
    request: Request,
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    _ensure_draft(assessment)
    updates = payload.model_dump(exclude_unset=True, by_alias=False)
    field_map = {
        "title": "title", "description": "description", "instructions": "instructions",
        "consent_text": "consent_text", "time_limit_minutes": "time_limit_minutes",
        "attempts_allowed": "attempts_allowed", "randomize_sections": "randomize_sections",
        "randomize_questions": "randomize_questions", "shuffle_options": "shuffle_options",
        "negative_marking": "negative_marking", "negative_factor": "negative_factor",
        "pass_percentage": "pass_percentage", "show_results_to_candidate": "show_results_to_candidate",
        "available_from": "available_from", "available_until": "available_until",
        "settings": "settings", "position_id": "position_id",
    }
    for key, attr in field_map.items():
        if key in updates:
            setattr(assessment, attr, updates[key])
    db.add(assessment)
    log_audit(
        db, entity_type="ap_assessment", entity_id=assessment.id, action="updated",
        actor=current_user, request=request, new_value=updates,
    )
    db.commit()
    db.refresh(assessment)
    return svc.serialize_assessment(assessment, include_structure=True)


@router.patch("/assessments/{assessment_id}/settings")
def update_assessment_settings(
    assessment_id: str,
    payload: AssessmentSettingsUpdate,
    db: DbDep,
    current_user: ManageDep,
    request: Request,
) -> dict[str, Any]:
    """Update operational settings (Google Sheet sync, proctoring, result visibility)
    that are safe to change AFTER publish — unlike the structure/snapshot fields, these
    don't affect in-flight or finished attempts, so no draft-only guard."""
    assessment = _load_assessment(db, assessment_id)
    updates = payload.model_dump(exclude_unset=True, by_alias=False)
    if updates.get("settings") is not None:
        # Shallow-merge so we don't clobber other keys already in settings.
        assessment.settings = {**(assessment.settings or {}), **updates["settings"]}
    if updates.get("show_results_to_candidate") is not None:
        assessment.show_results_to_candidate = updates["show_results_to_candidate"]
    db.add(assessment)
    log_audit(
        db, entity_type="ap_assessment", entity_id=assessment.id, action="settings_updated",
        actor=current_user, request=request, new_value=updates,
    )
    db.commit()
    db.refresh(assessment)
    return svc.serialize_assessment(assessment, include_structure=True)


@router.delete("/assessments/{assessment_id}", status_code=200)
def delete_assessment(
    assessment_id: str, db: DbDep, current_user: ManageDep, request: Request
) -> dict[str, str]:
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    assessment.is_removed = True
    db.add(assessment)
    log_audit(
        db, entity_type="ap_assessment", entity_id=assessment.id, action="deleted",
        actor=current_user, request=request,
    )
    db.commit()
    return {"message": "Assessment archived"}


@router.post("/assessments/{assessment_id}/clone", status_code=201)
def clone_assessment(
    assessment_id: str, db: DbDep, current_user: ManageDep, request: Request
) -> dict[str, Any]:
    source = _load_assessment(db, assessment_id)
    clone = ApAssessment(
        title=f"Copy of {source.title}",
        description=source.description,
        instructions=source.instructions,
        consent_text=source.consent_text,
        status=ApAssessmentStatus.DRAFT,
        time_limit_minutes=source.time_limit_minutes,
        attempts_allowed=source.attempts_allowed,
        randomize_sections=source.randomize_sections,
        randomize_questions=source.randomize_questions,
        shuffle_options=source.shuffle_options,
        negative_marking=source.negative_marking,
        negative_factor=source.negative_factor,
        pass_percentage=source.pass_percentage,
        total_marks=source.total_marks,
        show_results_to_candidate=source.show_results_to_candidate,
        available_from=source.available_from,
        available_until=source.available_until,
        settings=source.settings,
        position_id=source.position_id,
        created_by=current_user.id,
    )
    db.add(clone)
    db.flush()
    for section in sorted(source.sections, key=lambda s: s.order_index):
        new_section = ApSection(
            assessment_id=clone.id,
            title=section.title,
            instructions=section.instructions,
            order_index=section.order_index,
            time_limit_minutes=section.time_limit_minutes,
            cutoff_mark=section.cutoff_mark,
            weightage=section.weightage,
            lock_after_leave=section.lock_after_leave,
            randomize_questions=section.randomize_questions,
            pick_count=section.pick_count,
        )
        db.add(new_section)
        db.flush()
        for question in sorted(section.questions, key=lambda q: q.order_index):
            db.add(
                ApQuestion(
                    assessment_id=clone.id,
                    section_id=new_section.id,
                    bank_question_id=question.bank_question_id,
                    type=question.type,
                    prompt=question.prompt,
                    config=dict(question.config or {}),
                    marks=question.marks,
                    negative_marks=question.negative_marks,
                    order_index=question.order_index,
                    is_required=question.is_required,
                    media_url=question.media_url,
                )
            )
    log_audit(
        db, entity_type="ap_assessment", entity_id=clone.id, action="cloned",
        actor=current_user, request=request, new_value={"sourceId": source.id},
    )
    db.commit()
    clone = _load_assessment(db, clone.id)
    return svc.serialize_assessment(clone, include_structure=True)


@router.post("/assessments/{assessment_id}/publish")
def publish_assessment(
    assessment_id: str, db: DbDep, current_user: ManageDep, request: Request
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    if assessment.status is ApAssessmentStatus.PUBLISHED:
        return svc.serialize_assessment(assessment, include_structure=True)
    question_count = sum(len(s.questions) for s in assessment.sections)
    if question_count == 0:
        raise HTTPException(status_code=400, detail="Add at least one question before publishing")
    empty_sections = [s.title for s in assessment.sections if not s.questions]
    if empty_sections:
        raise HTTPException(
            status_code=400,
            detail=f"These sections have no questions: {', '.join(empty_sections)}",
        )
    assessment.total_marks = svc.question_marks_total(assessment)
    assessment.status = ApAssessmentStatus.PUBLISHED
    db.add(assessment)
    log_audit(
        db, entity_type="ap_assessment", entity_id=assessment.id, action="published",
        actor=current_user, request=request,
    )
    db.commit()
    db.refresh(assessment)
    return svc.serialize_assessment(assessment, include_structure=True)


@router.post("/assessments/{assessment_id}/unpublish")
def unpublish_assessment(
    assessment_id: str, db: DbDep, current_user: ManageDep, request: Request
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    attempts = db.scalar(
        select(func.count(ApAttempt.id)).where(ApAttempt.assessment_id == assessment.id)
    )
    if attempts:
        raise HTTPException(
            status_code=400,
            detail="Cannot unpublish — candidates have already started this assessment. Clone it instead.",
        )
    assessment.status = ApAssessmentStatus.DRAFT
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return svc.serialize_assessment(assessment, include_structure=True)


# ─────────────────────────────── sections ────────────────────────────────────


@router.post("/assessments/{assessment_id}/sections", status_code=201)
def create_section(
    assessment_id: str, payload: SectionCreate, db: DbDep, current_user: ManageDep
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    _ensure_draft(assessment)
    section = ApSection(
        assessment_id=assessment.id,
        title=payload.title.strip(),
        instructions=payload.instructions,
        order_index=payload.order_index if payload.order_index is not None else _next_order(assessment.sections),
        time_limit_minutes=payload.time_limit_minutes,
        cutoff_mark=payload.cutoff_mark,
        weightage=payload.weightage,
        lock_after_leave=payload.lock_after_leave,
        randomize_questions=payload.randomize_questions,
        pick_count=payload.pick_count,
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return svc.serialize_section(section)


@router.patch("/assessments/{assessment_id}/sections/{section_id}")
def update_section(
    assessment_id: str, section_id: str, payload: SectionUpdate, db: DbDep, current_user: ManageDep
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    _ensure_draft(assessment)
    section = _load_section(db, assessment, section_id)
    updates = payload.model_dump(exclude_unset=True, by_alias=False)
    for key, value in updates.items():
        setattr(section, key, value)
    db.add(section)
    db.commit()
    db.refresh(section)
    return svc.serialize_section(section)


@router.delete("/assessments/{assessment_id}/sections/{section_id}", status_code=200)
def delete_section(
    assessment_id: str, section_id: str, db: DbDep, current_user: ManageDep
) -> dict[str, str]:
    assessment = _load_assessment(db, assessment_id)
    _ensure_draft(assessment)
    section = _load_section(db, assessment, section_id)
    db.delete(section)
    db.flush()
    assessment.total_marks = svc.question_marks_total(_load_assessment(db, assessment_id))
    db.commit()
    return {"message": "Section deleted"}


@router.post("/assessments/{assessment_id}/sections/reorder")
def reorder_sections(
    assessment_id: str, payload: ReorderRequest, db: DbDep, current_user: ManageDep
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    _ensure_draft(assessment)
    order = {sid: idx for idx, sid in enumerate(payload.ordered_ids)}
    for section in assessment.sections:
        if section.id in order:
            section.order_index = order[section.id]
    db.commit()
    assessment = _load_assessment(db, assessment_id)
    return svc.serialize_assessment(assessment, include_structure=True)


# ─────────────────────────────── questions ───────────────────────────────────


@router.post("/assessments/{assessment_id}/sections/{section_id}/questions", status_code=201)
def create_question(
    assessment_id: str,
    section_id: str,
    payload: QuestionCreate,
    db: DbDep,
    current_user: ManageDep,
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    _ensure_draft(assessment)
    section = _load_section(db, assessment, section_id)
    config = svc.validate_question_config(payload.type, payload.config)
    question = ApQuestion(
        assessment_id=assessment.id,
        section_id=section.id,
        bank_question_id=payload.bank_question_id,
        type=payload.type,
        prompt=payload.prompt.strip(),
        config=config,
        marks=payload.marks,
        negative_marks=payload.negative_marks,
        order_index=payload.order_index if payload.order_index is not None else _next_order(section.questions),
        is_required=payload.is_required,
        media_url=payload.media_url,
    )
    db.add(question)
    db.flush()
    assessment.total_marks = svc.question_marks_total(_load_assessment(db, assessment_id))
    db.commit()
    db.refresh(question)
    return svc.serialize_question(question)


@router.patch("/assessments/{assessment_id}/questions/{question_id}")
def update_question(
    assessment_id: str,
    question_id: str,
    payload: QuestionUpdate,
    db: DbDep,
    current_user: ManageDep,
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    _ensure_draft(assessment)
    question = _load_question(db, assessment, question_id)
    updates = payload.model_dump(exclude_unset=True, by_alias=False)
    if "type" in updates and updates["type"] is not None:
        question.type = updates["type"]
    for attr in ("prompt", "marks", "negative_marks", "order_index", "is_required", "media_url"):
        if attr in updates and updates[attr] is not None:
            setattr(question, attr, updates[attr])
    if "config" in updates and updates["config"] is not None:
        question.config = svc.validate_question_config(question.type, updates["config"])
    db.add(question)
    db.flush()
    assessment.total_marks = svc.question_marks_total(_load_assessment(db, assessment_id))
    db.commit()
    db.refresh(question)
    return svc.serialize_question(question)


@router.delete("/assessments/{assessment_id}/questions/{question_id}", status_code=200)
def delete_question(
    assessment_id: str, question_id: str, db: DbDep, current_user: ManageDep
) -> dict[str, str]:
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    _ensure_draft(assessment)
    question = _load_question(db, assessment, question_id)
    db.delete(question)
    db.flush()
    assessment.total_marks = svc.question_marks_total(_load_assessment(db, assessment_id))
    db.commit()
    return {"message": "Question deleted"}


@router.post("/assessments/{assessment_id}/sections/{section_id}/questions/reorder")
def reorder_questions(
    assessment_id: str,
    section_id: str,
    payload: ReorderRequest,
    db: DbDep,
    current_user: ManageDep,
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    _ensure_draft(assessment)
    section = _load_section(db, assessment, section_id)
    order = {qid: idx for idx, qid in enumerate(payload.ordered_ids)}
    for question in section.questions:
        if question.id in order:
            question.order_index = order[question.id]
    db.commit()
    assessment = _load_assessment(db, assessment_id)
    return svc.serialize_assessment(assessment, include_structure=True)


@router.post("/assessments/{assessment_id}/questions/from-bank", status_code=201)
def add_questions_from_bank(
    assessment_id: str, payload: AddFromBankRequest, db: DbDep, current_user: ManageDep
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id)
    _ensure_draft(assessment)
    section = _load_section(db, assessment, payload.section_id)
    items = db.scalars(
        select(ApQuestionBank).where(ApQuestionBank.id.in_(payload.bank_question_ids))
    ).all()
    next_order = _next_order(section.questions)
    for item in items:
        db.add(
            ApQuestion(
                assessment_id=assessment.id,
                section_id=section.id,
                bank_question_id=item.id,
                type=item.type,
                prompt=item.prompt,
                config=dict(item.config or {}),
                marks=item.default_marks,
                order_index=next_order,
                is_required=True,
            )
        )
        next_order += 1
    db.flush()
    assessment.total_marks = svc.question_marks_total(_load_assessment(db, assessment_id))
    db.commit()
    assessment = _load_assessment(db, assessment_id)
    return svc.serialize_assessment(assessment, include_structure=True)


# ═══════════════════════════════ QUESTION BANK ════════════════════════════════


@router.get("/question-bank")
def list_question_bank(
    db: DbDep,
    current_user: ReadDep,
    search: Annotated[str | None, Query()] = None,
    tag: Annotated[str | None, Query()] = None,
    include_archived: Annotated[bool, Query(alias="includeArchived")] = False,
) -> list[dict[str, Any]]:
    stmt = select(ApQuestionBank)
    if not include_archived:
        stmt = stmt.where(ApQuestionBank.is_archived.is_(False))
    if search:
        stmt = stmt.where(ApQuestionBank.prompt.ilike(f"%{search.strip()}%"))
    rows = db.scalars(stmt.order_by(ApQuestionBank.created_at.desc())).all()
    items = [svc.serialize_question_bank(item) for item in rows]
    if tag:
        items = [i for i in items if tag in (i.get("tags") or [])]
    return items


@router.post("/question-bank", status_code=201)
def create_bank_question(
    payload: QuestionBankCreate, db: DbDep, current_user: ManageDep
) -> dict[str, Any]:
    config = svc.validate_question_config(payload.type, payload.config)
    item = ApQuestionBank(
        type=payload.type,
        prompt=payload.prompt.strip(),
        config=config,
        default_marks=payload.default_marks,
        tags=payload.tags,
        difficulty=payload.difficulty,
        skill=payload.skill,
        created_by=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return svc.serialize_question_bank(item)


@router.patch("/question-bank/{item_id}")
def update_bank_question(
    item_id: str, payload: QuestionBankUpdate, db: DbDep, current_user: ManageDep
) -> dict[str, Any]:
    item = db.get(ApQuestionBank, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Question not found")
    updates = payload.model_dump(exclude_unset=True, by_alias=False)
    if "type" in updates and updates["type"] is not None:
        item.type = updates["type"]
    for attr in ("prompt", "default_marks", "tags", "difficulty", "skill", "is_archived"):
        if attr in updates and updates[attr] is not None:
            setattr(item, attr, updates[attr])
    if "config" in updates and updates["config"] is not None:
        item.config = svc.validate_question_config(item.type, updates["config"])
    db.add(item)
    db.commit()
    db.refresh(item)
    return svc.serialize_question_bank(item)


@router.delete("/question-bank/{item_id}", status_code=200)
def archive_bank_question(item_id: str, db: DbDep, current_user: ManageDep) -> dict[str, str]:
    item = db.get(ApQuestionBank, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Question not found")
    item.is_archived = True
    db.add(item)
    db.commit()
    return {"message": "Question archived"}


# ═══════════════════════════ ASSIGNMENTS + INVITES ════════════════════════════


def _dispatch_invites(invites: list[dict[str, Any]], assessment_title: str) -> None:
    """Runs in a BackgroundTask (no DB). One email per invitee, isolated failures."""
    settings = get_settings()
    base = settings.frontend_url.rstrip("/")
    email_service = EmailService()
    for inv in invites:
        try:
            login_url = f"{base}/login?email={quote(inv['email'])}"
            name = inv.get("name") or "there"
            if inv.get("tempPassword"):
                subject = f"You're invited to an assessment: {assessment_title}"
                body_text = (
                    f"Hi {name},\n\n"
                    f"You've been invited to complete the assessment \"{assessment_title}\".\n\n"
                    "An Ethara portal account has been created for you:\n"
                    f"Login email: {inv['email']}\n"
                    f"Temporary password: {inv['tempPassword']}\n"
                    f"Sign in: {login_url}\n\n"
                    "After signing in, open \"My Assessments\" to begin. "
                    "Please change your password after your first login.\n"
                )
                body_html = (
                    f"<p>Hi {name},</p>"
                    f"<p>You've been invited to complete the assessment <strong>{assessment_title}</strong>.</p>"
                    "<p>An Ethara portal account has been created for you:</p>"
                    f"<p><strong>Login email:</strong> {inv['email']}<br />"
                    f"<strong>Temporary password:</strong> {inv['tempPassword']}</p>"
                    f"<p><a href=\"{login_url}\">Sign in to Ethara</a> and open "
                    "<strong>My Assessments</strong> to begin.</p>"
                    "<p>Please change your password after your first login.</p>"
                )
            else:
                subject = f"New assessment assigned: {assessment_title}"
                body_text = (
                    f"Hi {name},\n\n"
                    f"You've been assigned the assessment \"{assessment_title}\".\n\n"
                    f"Sign in: {login_url}\n"
                    "Open \"My Assessments\" in your portal to begin.\n"
                )
                body_html = (
                    f"<p>Hi {name},</p>"
                    f"<p>You've been assigned the assessment <strong>{assessment_title}</strong>.</p>"
                    f"<p><a href=\"{login_url}\">Sign in to Ethara</a> and open "
                    "<strong>My Assessments</strong> to begin.</p>"
                )
            email_service.send_email(
                to_email=inv["email"], subject=subject, body_text=body_text, body_html=body_html
            )
        except Exception:  # noqa: BLE001 — one bad address must not abort the batch
            logger.exception("assessment-platform: failed to send invite to %s", inv.get("email"))


def _assign_one(
    db: Session, assessment: ApAssessment, email: str, actor: User, expires_at: datetime | None
) -> tuple[ApAssignment, dict[str, Any], str]:
    """Link-or-provision a portal account + upsert the assignment. Returns (assignment, invite, kind)."""
    user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == email))
    temp_password: str | None = None
    provisioned = False
    kind = "linked"
    if user is None:
        temp_password = f"Et#{generate_id()[:10]}1"
        user = User(
            email=email,
            password_hash=hash_password(temp_password),
            name=email.split("@", 1)[0],
            role=Role.CANDIDATE,
            roles=[Role.CANDIDATE.value],
            is_active=True,
            must_change_password=True,
        )
        db.add(user)
        db.flush()
        provisioned = True
        kind = "created"
    candidate = db.scalar(select(Candidate).where(Candidate.portal_user_id == user.id))

    assignment = db.scalar(
        select(ApAssignment).where(
            ApAssignment.assessment_id == assessment.id, ApAssignment.email == email
        )
    )
    if assignment is None:
        assignment = ApAssignment(
            assessment_id=assessment.id,
            email=email,
            user_id=user.id,
            candidate_id=candidate.id if candidate else None,
            status=ApAssignmentStatus.INVITED,
            invited_by=actor.id,
            expires_at=expires_at,
            provisioned=provisioned,
        )
        db.add(assignment)
    else:
        assignment.user_id = user.id
        assignment.candidate_id = candidate.id if candidate else assignment.candidate_id
        if assignment.status in (ApAssignmentStatus.REVOKED, ApAssignmentStatus.EXPIRED):
            assignment.status = ApAssignmentStatus.INVITED
        assignment.expires_at = expires_at
        assignment.last_invited_at = _now()
        kind = "reinvited"

    invite = {"email": email, "name": user.name, "tempPassword": temp_password, "userId": user.id}
    return assignment, invite, kind


def _bulk_assign(
    db: Session,
    assessment: ApAssessment,
    emails: list[str],
    skipped: list[dict[str, str]],
    actor: User,
    expires_in_days: int | None,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    if assessment.status is not ApAssessmentStatus.PUBLISHED:
        raise HTTPException(status_code=400, detail="Publish the assessment before assigning it")
    if len(emails) > _MAX_BULK_EMAILS:
        raise HTTPException(status_code=400, detail=f"Too many emails (max {_MAX_BULK_EMAILS})")
    expires_at = _now() + timedelta(days=expires_in_days) if expires_in_days else None
    result = {"created": 0, "linked": 0, "reinvited": 0, "invited": 0, "skipped": skipped}
    invites: list[dict[str, Any]] = []
    for email in emails:
        assignment, invite, kind = _assign_one(db, assessment, email, actor, expires_at)
        result[kind] = result.get(kind, 0) + 1
        result["invited"] += 1
        invites.append(invite)
        if invite["userId"]:
            create_notification(
                db,
                user_id=invite["userId"],
                title="New assessment assigned",
                message=f'You have been assigned "{assessment.title}". Open My Assessments to begin.',
                type_=NotificationType.ACTION,
            )
    db.commit()
    background_tasks.add_task(_dispatch_invites, invites, assessment.title)
    return result


@router.get("/assessments/{assessment_id}/assignments")
def list_assignments(assessment_id: str, db: DbDep, current_user: ReadDep) -> list[dict[str, Any]]:
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    rows = db.scalars(
        select(ApAssignment)
        .where(ApAssignment.assessment_id == assessment.id)
        .options(joinedload(ApAssignment.user), joinedload(ApAssignment.candidate))
        .order_by(ApAssignment.invited_at.desc())
    ).all()
    # attach latest attempt status per assignment
    assignment_ids = [a.id for a in rows]
    latest_attempt: dict[str, ApAttempt] = {}
    if assignment_ids:
        for attempt in db.scalars(
            select(ApAttempt).where(ApAttempt.assignment_id.in_(assignment_ids))
            .order_by(ApAttempt.created_at.desc())
        ).all():
            latest_attempt.setdefault(attempt.assignment_id, attempt)
    out = []
    for assignment in rows:
        data = svc.serialize_assignment(assignment)
        attempt = latest_attempt.get(assignment.id)
        data["attempt"] = svc.serialize_attempt_summary(attempt) if attempt else None
        out.append(data)
    return out


@router.post("/assessments/{assessment_id}/assignments", status_code=201)
def assign_by_emails(
    assessment_id: str,
    payload: AssignEmailsRequest,
    db: DbDep,
    current_user: ManageDep,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    _staff_only(current_user)
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    emails, skipped = _parse_emails(payload.emails)
    if not emails:
        raise HTTPException(status_code=400, detail="No valid email addresses provided")
    return _bulk_assign(db, assessment, emails, skipped, current_user, payload.expires_in_days, background_tasks)


@router.post("/assessments/{assessment_id}/assignments/bulk", status_code=201)
def assign_by_csv(
    assessment_id: str,
    db: DbDep,
    current_user: ManageDep,
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    _staff_only(current_user)
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    raw = file.file.read()
    emails, skipped = _parse_emails(_emails_from_csv(raw))
    if not emails:
        raise HTTPException(status_code=400, detail="No valid email addresses found in the CSV")
    return _bulk_assign(db, assessment, emails, skipped, current_user, None, background_tasks)


@router.post("/assignments/{assignment_id}/resend")
def resend_invite(
    assignment_id: str, db: DbDep, current_user: ManageDep, background_tasks: BackgroundTasks
) -> dict[str, str]:
    assignment = db.get(ApAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    assessment = db.get(ApAssessment, assignment.assessment_id)
    assignment.last_invited_at = _now()
    user = db.get(User, assignment.user_id) if assignment.user_id else None
    db.commit()
    background_tasks.add_task(
        _dispatch_invites,
        [{"email": assignment.email, "name": user.name if user else None, "tempPassword": None, "userId": assignment.user_id}],
        assessment.title if assessment else "your assessment",
    )
    return {"message": "Invite re-sent"}


@router.post("/assignments/{assignment_id}/revoke")
def revoke_assignment(assignment_id: str, db: DbDep, current_user: ManageDep) -> dict[str, str]:
    assignment = db.get(ApAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    assignment.status = ApAssignmentStatus.REVOKED
    db.add(assignment)
    db.commit()
    return {"message": "Assignment revoked"}


@router.get("/candidates/{candidate_id}/assignments")
def candidate_assignments(candidate_id: str, db: DbDep, current_user: ReadDep) -> list[dict[str, Any]]:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    rows = db.scalars(
        select(ApAssignment)
        .where(
            ApAssignment.candidate_id == candidate_id,
            ApAssignment.status != ApAssignmentStatus.REVOKED,
        )
        .options(
            joinedload(ApAssignment.user),
            joinedload(ApAssignment.candidate),
            joinedload(ApAssignment.assessment),
        )
        .order_by(ApAssignment.invited_at.desc())
    ).all()
    assignment_ids = [assignment.id for assignment in rows]
    latest_attempt: dict[str, ApAttempt] = {}
    if assignment_ids:
        for attempt in db.scalars(
            select(ApAttempt)
            .where(ApAttempt.assignment_id.in_(assignment_ids))
            .order_by(ApAttempt.created_at.desc())
        ):
            latest_attempt.setdefault(attempt.assignment_id, attempt)

    out: list[dict[str, Any]] = []
    for assignment in rows:
        assessment = assignment.assessment
        if assessment is None or assessment.is_removed:
            continue
        data = svc.serialize_assignment(assignment)
        data["assessmentTitle"] = assessment.title
        data["assessmentStatus"] = assessment.status.value
        data["totalMarks"] = assessment.total_marks
        attempt = latest_attempt.get(assignment.id)
        data["attempt"] = svc.serialize_attempt_summary(attempt) if attempt else None
        out.append(data)
    return out


@router.post("/candidates/bulk-bypass")
def bulk_bypass_candidate_assessments(
    request: Request,
    db: DbDep,
    current_user: GradeDep,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    raw = file.file.read()
    rows = _bulk_bypass_rows_from_csv(raw)
    results: list[dict[str, Any]] = []
    seen_emails: set[str] = set()
    advanced_count = 0
    failed_count = 0

    for row in rows:
        row_number = int(row["row"])
        email = str(row["email"])
        result = str(row["result"]).strip().lower()
        if not email or not _EMAIL_RE.match(email):
            failed_count += 1
            results.append(
                {
                    "row": row_number,
                    "email": email,
                    "status": "failed",
                    "message": "Missing or invalid email.",
                }
            )
            continue
        if email in seen_emails:
            failed_count += 1
            results.append(
                {
                    "row": row_number,
                    "email": email,
                    "status": "skipped",
                    "message": "Duplicate email in CSV.",
                }
            )
            continue
        seen_emails.add(email)
        if result not in {"pass", "passed"}:
            failed_count += 1
            results.append(
                {
                    "row": row_number,
                    "email": email,
                    "status": "failed",
                    "message": "Result must be Pass.",
                }
            )
            continue

        candidate = db.scalar(
            select(Candidate)
            .where(func.lower(Candidate.personal_email) == email, Candidate.is_removed.is_(False))
            .order_by(Candidate.updated_at.desc())
        )
        if candidate is None:
            failed_count += 1
            results.append(
                {
                    "row": row_number,
                    "email": email,
                    "status": "failed",
                    "message": "Candidate not found.",
                }
            )
            continue

        assignment_ids = list(
            db.scalars(
                select(ApAssignment.id).where(
                    ApAssignment.candidate_id == candidate.id,
                    ApAssignment.status != ApAssignmentStatus.REVOKED,
                )
            )
        )
        payload = AssessmentBypassRequest.model_validate(
            {
                "assignments": [
                    {
                        "assignmentId": assignment_id,
                        "score": 100,
                        "feedback": "Marked as pass from bulk CSV.",
                    }
                    for assignment_id in assignment_ids
                ],
                "notes": "Marked as pass from bulk CSV.",
                "manualPass": True,
            }
        )

        try:
            bypass_result = bypass_candidate_assessments(candidate.id, payload, request, db, current_user)
        except HTTPException as exc:
            db.rollback()
            failed_count += 1
            results.append(
                {
                    "row": row_number,
                    "email": email,
                    "candidateId": candidate.id,
                    "status": "failed",
                    "message": str(exc.detail),
                }
            )
            continue

        advanced = bool(bypass_result.get("advanced"))
        if advanced:
            advanced_count += 1
        results.append(
            {
                "row": row_number,
                "email": email,
                "candidateId": candidate.id,
                "status": "advanced" if advanced else "updated",
                "message": (
                    "Moved to Selection Form."
                    if advanced
                    else "Assessment bypass recorded; candidate stage was not changed."
                ),
                "advanced": advanced,
                "assignments": len(assignment_ids),
            }
        )

    return {
        "processed": len(rows),
        "advanced": advanced_count,
        "failed": failed_count,
        "results": results,
    }


# Stages a candidate can be auto-advanced FROM to Selection Form when their
# assessments are bypassed / marked-pass. This intentionally includes the whole
# resume phase (resume_screening_pending, resume_rejected, etc.) so a single bypass
# "shortlists then bypasses" a candidate who never reached assessments — the most
# common ask (e.g. a resume-rejected candidate the team wants to fast-track).
# Stages at/after selection_form_sent are already past assessments and are left
# untouched so a bypass can never regress an in-flight onboarding.
_BYPASS_ADVANCE_STAGES = frozenset({
    CandidateStage.NEW_APPLICATION,
    CandidateStage.SOURCE_TAGGED,
    CandidateStage.RESUME_UPLOADED,
    CandidateStage.RESUME_SCREENING_PENDING,
    CandidateStage.RESUME_SHORTLISTED,
    CandidateStage.RESUME_REJECTED,
    CandidateStage.EVALUATION_ASSIGNED,
    CandidateStage.EVALUATION_IN_PROGRESS,
    CandidateStage.EVALUATION_PASSED,
    CandidateStage.EVALUATION_FAILED,
})


@router.post("/candidates/{candidate_id}/bypass")
def bypass_candidate_assessments(
    candidate_id: str,
    payload: AssessmentBypassRequest,
    request: Request,
    db: DbDep,
    current_user: GradeDep,
) -> dict[str, Any]:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not payload.assignments and not (payload.notes or "").strip():
        raise HTTPException(status_code=400, detail="Enter remarks before bypassing assessments.")

    assignment_ids = [entry.assignment_id for entry in payload.assignments]
    if len(set(assignment_ids)) != len(assignment_ids):
        raise HTTPException(status_code=400, detail="Duplicate assessment assignments are not allowed.")

    for entry in payload.assignments:
        if entry.score < 0 or entry.score > 100:
            raise HTTPException(status_code=400, detail="Assessment score must be between 0 and 100.")

    assignments: list[ApAssignment] = []
    if assignment_ids:
        assignments = list(
            db.scalars(
                select(ApAssignment)
                .where(
                    ApAssignment.id.in_(assignment_ids),
                    ApAssignment.candidate_id == candidate_id,
                    ApAssignment.status != ApAssignmentStatus.REVOKED,
                )
                .options(
                    joinedload(ApAssignment.assessment).selectinload(ApAssessment.sections).selectinload(ApSection.questions),
                    selectinload(ApAssignment.attempts).joinedload(ApAttempt.user),
                    joinedload(ApAssignment.user),
                    joinedload(ApAssignment.candidate),
                )
            )
        )
    if len(assignments) != len(assignment_ids):
        raise HTTPException(
            status_code=404,
            detail="One or more assessment assignments were not found for this candidate.",
        )

    now = _now()
    by_id = {assignment.id: assignment for assignment in assignments}
    updated: list[dict[str, Any]] = []
    max_score = 100.0

    for entry in payload.assignments:
        assignment = by_id[entry.assignment_id]
        assessment = assignment.assessment
        if assessment is None or assessment.is_removed:
            raise HTTPException(status_code=404, detail="Assigned assessment is no longer available.")

        attempts = sorted(assignment.attempts or [], key=lambda attempt: attempt.created_at, reverse=True)
        attempt = attempts[0] if attempts else None
        if attempt is None:
            attempt = ApAttempt(
                assignment_id=assignment.id,
                assessment_id=assignment.assessment_id,
                user_id=assignment.user_id or candidate.portal_user_id or current_user.id,
                status=ApAttemptStatus.GRADED,
                snapshot=svc.build_snapshot(assessment),
                started_at=now,
                submitted_at=now,
            )
            db.add(attempt)
            assignment.attempts.append(attempt)
            if assignment.attempts_used <= 0:
                assignment.attempts_used = 1
        elif not attempt.snapshot:
            attempt.snapshot = svc.build_snapshot(assessment)

        score = round(float(entry.score), 4)
        feedback = (
            entry.feedback
            or payload.notes
            or (
                "Marked as pass manually. Test was not conducted on the platform."
                if payload.manual_pass
                else "Assessment bypassed with external score."
            )
        )
        attempt.status = ApAttemptStatus.GRADED
        attempt.submitted_at = attempt.submitted_at or now
        attempt.manual_score = score
        attempt.total_score = score
        attempt.max_score = max_score
        attempt.percentage = score
        attempt.result_status = "pass"
        attempt.graded_by = current_user.id
        attempt.graded_at = now
        attempt.result_finalized_at = now
        attempt.overall_feedback = feedback
        assignment.status = ApAssignmentStatus.GRADED
        db.add(assignment)
        db.add(attempt)

        log_audit(
            db,
            entity_type="ap_assignment",
            entity_id=assignment.id,
            action="assessment_manual_pass" if payload.manual_pass else "assessment_bypassed",
            actor=current_user,
            request=request,
            candidate_id=candidate_id,
            new_value={
                "assessmentId": assignment.assessment_id,
                "assessmentTitle": assessment.title,
                "score": score,
                "decision": "pass",
                "notes": payload.notes,
            },
        )
        row = svc.serialize_assignment(assignment)
        row["assessmentTitle"] = assessment.title
        row["assessmentStatus"] = assessment.status.value
        row["totalMarks"] = assessment.total_marks
        row["attempt"] = svc.serialize_attempt_summary(attempt)
        updated.append(row)

    db.flush()
    active_assignments = list(
        db.scalars(
            select(ApAssignment)
            .where(
                ApAssignment.candidate_id == candidate_id,
                ApAssignment.status != ApAssignmentStatus.REVOKED,
            )
            .options(selectinload(ApAssignment.attempts))
        )
    )
    all_cleared = True
    for assignment in active_assignments:
        attempts = sorted(assignment.attempts or [], key=lambda attempt: attempt.created_at, reverse=True)
        latest = attempts[0] if attempts else None
        if latest is None or latest.result_status != "pass":
            all_cleared = False
            break

    # Defensive no-regress: if this candidate has already submitted their selection
    # form, never reset them to "Selection Form Sent" (which would re-prompt them to
    # submit and hide them from the submitted/validated views). This is belt-and-
    # suspenders alongside the manual-screening-override no-regress guard.
    selection_already_submitted = db.scalar(
        select(SelectionForm.submitted_at).where(SelectionForm.candidate_id == candidate_id)
    ) is not None

    advanced = False
    if all_cleared and candidate.current_stage in _BYPASS_ADVANCE_STAGES and not selection_already_submitted:
        candidate.current_stage = CandidateStage.SELECTION_FORM_SENT
        candidate.current_status = (
            "Selection Form Sent (Assessments Marked as Pass)"
            if payload.manual_pass
            else "Selection Form Sent (Assessments Bypassed)"
        )
        db.add(candidate)
        db.flush()
        apply_stage_side_effects(db, candidate, actor=current_user)
        advanced = True
    elif candidate.current_stage in {
        CandidateStage.RESUME_SHORTLISTED,
        CandidateStage.EVALUATION_ASSIGNED,
        CandidateStage.EVALUATION_IN_PROGRESS,
    }:
        candidate.current_stage = CandidateStage.EVALUATION_IN_PROGRESS
        candidate.current_status = "Assessments Partially Bypassed"
        db.add(candidate)

    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate_id,
        action="assessment_platform_bypass",
        actor=current_user,
        request=request,
        candidate_id=candidate_id,
        new_value={
            "assignmentIds": assignment_ids,
            "manualPass": payload.manual_pass,
            "advanced": advanced,
            "newStage": candidate.current_stage,
            "notes": payload.notes,
        },
    )

    db.commit()
    return {"updated": updated, "advanced": advanced, "allCleared": all_cleared}


# ════════════════════════════════ TAKER (/me) ═════════════════════════════════


def _load_owned_assignment(db: Session, assignment_id: str, user: User) -> ApAssignment:
    assignment = db.get(ApAssignment, assignment_id)
    if assignment is None or assignment.user_id != user.id:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assignment.status is ApAssignmentStatus.REVOKED:
        raise HTTPException(status_code=403, detail="This assessment is no longer available")
    return assignment


def _load_owned_attempt(db: Session, attempt_id: str, user: User) -> ApAttempt:
    attempt = db.scalar(
        select(ApAttempt)
        .where(ApAttempt.id == attempt_id, ApAttempt.user_id == user.id)
        .options(selectinload(ApAttempt.answers), joinedload(ApAttempt.assignment))
    )
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return attempt


def _finalize_attempt(attempt: ApAttempt) -> None:
    attempt.submitted_at = attempt.submitted_at or _now()
    svc.apply_auto_scoring(attempt)
    svc.recompute_attempt_totals(attempt)
    if attempt.assignment is not None:
        attempt.assignment.status = (
            ApAssignmentStatus.GRADED
            if attempt.result_status != "pending"
            else ApAssignmentStatus.SUBMITTED
        )


def _auto_submit_if_expired(db: Session, attempt: ApAttempt) -> bool:
    if attempt.status is ApAttemptStatus.IN_PROGRESS and svc.is_expired(attempt):
        _finalize_attempt(attempt)
        db.commit()
        return True
    return False


@router.get("/me/assignments")
def my_assignments(db: DbDep, current_user: Annotated[User, Depends(get_current_user)]) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(ApAssignment)
        .where(
            ApAssignment.user_id == current_user.id,
            ApAssignment.status != ApAssignmentStatus.REVOKED,
        )
        .order_by(ApAssignment.invited_at.desc())
    ).all()
    out = []
    for assignment in rows:
        assessment = db.get(ApAssessment, assignment.assessment_id)
        if assessment is None or assessment.is_removed or assessment.status is not ApAssessmentStatus.PUBLISHED:
            continue
        attempt = db.scalar(
            select(ApAttempt)
            .where(ApAttempt.assignment_id == assignment.id)
            .order_by(ApAttempt.created_at.desc())
        )
        out.append(
            {
                "assignmentId": assignment.id,
                "assessmentId": assessment.id,
                "title": assessment.title,
                "description": assessment.description,
                "timeLimitMinutes": assessment.time_limit_minutes,
                "attemptsAllowed": assessment.attempts_allowed,
                "attemptsUsed": assignment.attempts_used,
                "status": assignment.status.value,
                "availableUntil": assessment.available_until.isoformat() if assessment.available_until else None,
                "showResultsToCandidate": assessment.show_results_to_candidate,
                "attempt": svc.serialize_my_attempt(attempt) if attempt else None,
            }
        )
    return out


@router.post("/me/assignments/{assignment_id}/start")
def start_attempt(
    assignment_id: str, db: DbDep, current_user: Annotated[User, Depends(get_current_user)]
) -> dict[str, Any]:
    assignment = _load_owned_assignment(db, assignment_id, current_user)
    # Serialise concurrent starts for this assignment so two parallel requests can't each
    # create an in-progress attempt and bypass the attempt limit.
    db.execute(select(ApAssignment.id).where(ApAssignment.id == assignment.id).with_for_update())
    assessment = _load_assessment(db, assignment.assessment_id)
    if assessment.status is not ApAssessmentStatus.PUBLISHED:
        raise HTTPException(status_code=400, detail="This assessment is not currently available")
    now = _now()
    if assessment.available_from and now < svc.ensure_aware(assessment.available_from):
        raise HTTPException(status_code=400, detail="This assessment is not open yet")
    if assessment.available_until and now > svc.ensure_aware(assessment.available_until):
        raise HTTPException(status_code=400, detail="This assessment has closed")

    existing = db.scalar(
        select(ApAttempt)
        .where(
            ApAttempt.assignment_id == assignment.id,
            ApAttempt.status == ApAttemptStatus.IN_PROGRESS,
        )
        .options(selectinload(ApAttempt.answers), joinedload(ApAttempt.assignment))
    )
    if existing is not None:
        if _auto_submit_if_expired(db, existing):
            # Time ran out → it's now submitted; resume into the submitted/result view
            # instead of erroring the candidate out of their own page.
            done = _load_owned_attempt(db, existing.id, current_user)
            return svc.serialize_taker_attempt(done)
        return svc.serialize_taker_attempt(existing)

    # No in-progress attempt. If they've already used their attempt(s) (e.g. the test
    # was submitted / auto-submitted / passed), resume into that finished attempt so the
    # player shows "submitted / under review / result" — never a dead-end error.
    if assignment.attempts_used >= assessment.attempts_allowed:
        latest = db.scalar(
            select(ApAttempt)
            .where(ApAttempt.assignment_id == assignment.id)
            .order_by(ApAttempt.created_at.desc())
            .options(selectinload(ApAttempt.answers), joinedload(ApAttempt.assignment))
        )
        if latest is not None:
            return svc.serialize_taker_attempt(latest)
        raise HTTPException(status_code=400, detail="You have no attempts remaining")

    snapshot = svc.build_snapshot(assessment)
    expires_at = None
    if assessment.time_limit_minutes:
        expires_at = now + timedelta(minutes=assessment.time_limit_minutes)
    if assessment.available_until:
        close_at = svc.ensure_aware(assessment.available_until)
        if expires_at is None or close_at < expires_at:
            expires_at = close_at
    attempt = ApAttempt(
        assignment_id=assignment.id,
        assessment_id=assessment.id,
        user_id=current_user.id,
        status=ApAttemptStatus.IN_PROGRESS,
        snapshot=snapshot,
        started_at=now,
        expires_at=expires_at,
    )
    db.add(attempt)
    assignment.attempts_used += 1
    assignment.status = ApAssignmentStatus.STARTED
    db.flush()
    db.refresh(attempt)
    db.commit()
    attempt = _load_owned_attempt(db, attempt.id, current_user)
    return svc.serialize_taker_attempt(attempt)


@router.patch("/me/attempts/{attempt_id}/answers/{question_id}")
def save_answer(
    attempt_id: str,
    question_id: str,
    payload: AnswerSaveRequest,
    db: DbDep,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    attempt = _load_owned_attempt(db, attempt_id, current_user)
    if attempt.status is not ApAttemptStatus.IN_PROGRESS:
        raise HTTPException(status_code=409, detail="This attempt is already submitted")
    if _auto_submit_if_expired(db, attempt):
        raise HTTPException(status_code=409, detail="Your time for this attempt has ended")

    answer = next((a for a in attempt.answers if a.question_id == question_id), None)
    if answer is None:
        answer = ApAnswer(
            attempt_id=attempt.id, question_id=question_id, response=payload.response, client_rev=payload.client_rev
        )
        db.add(answer)
    elif payload.client_rev >= answer.client_rev:
        answer.response = payload.response
        answer.client_rev = payload.client_rev
    # else: stale autosave — keep the newer value, just echo timer below
    db.commit()
    return {
        "saved": True,
        "questionId": question_id,
        "clientRev": answer.client_rev,
        "remainingSeconds": svc.remaining_seconds(attempt),
    }


@router.post("/me/attempts/{attempt_id}/answers/{question_id}/file")
def upload_answer_file(
    attempt_id: str,
    question_id: str,
    db: DbDep,
    current_user: Annotated[User, Depends(get_current_user)],
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    attempt = _load_owned_attempt(db, attempt_id, current_user)
    if attempt.status is not ApAttemptStatus.IN_PROGRESS:
        raise HTTPException(status_code=409, detail="This attempt is already submitted")
    if _auto_submit_if_expired(db, attempt):
        raise HTTPException(status_code=409, detail="Your time for this attempt has ended")

    snap_q = next(
        (
            q
            for section in (attempt.snapshot or {}).get("sections", [])
            for q in section.get("questions", [])
            if q["id"] == question_id
        ),
        None,
    )
    if snap_q is None or snap_q["type"] != ApQuestionType.FILE_UPLOAD.value:
        raise HTTPException(status_code=400, detail="This question does not accept file uploads")
    cfg = snap_q.get("config") or {}
    max_mb = cfg.get("maxSizeMb")
    allowed = set(cfg.get("allowedTypes") or []) or None
    file_url, file_path = StorageService().save_upload(
        file,
        folder=f"assessment-platform/{attempt.id}",
        allowed_content_types=allowed,
        max_size_bytes=int(max_mb) * 1024 * 1024 if max_mb else None,
    )

    answer = next((a for a in attempt.answers if a.question_id == question_id), None)
    if answer is None:
        answer = ApAnswer(attempt_id=attempt.id, question_id=question_id)
        db.add(answer)
    answer.file_name = file.filename
    answer.file_url = file_url
    answer.file_path = file_path
    answer.file_mime = file.content_type
    answer.response = {"fileName": file.filename}
    db.commit()
    return {
        "saved": True,
        "fileName": file.filename,
        "fileUrl": file_url,
        "remainingSeconds": svc.remaining_seconds(attempt),
    }


@router.get("/me/attempts/{attempt_id}/remaining")
def attempt_remaining(
    attempt_id: str, db: DbDep, current_user: Annotated[User, Depends(get_current_user)]
) -> dict[str, Any]:
    attempt = _load_owned_attempt(db, attempt_id, current_user)
    _auto_submit_if_expired(db, attempt)
    return {"remainingSeconds": svc.remaining_seconds(attempt), "status": attempt.status.value}


def _queue_sheet_sync(db: Session, attempt: ApAttempt, background_tasks: BackgroundTasks) -> None:
    """If the assessment has Google Sheet sync on, append this submission's row
    (built now, sent off-thread so a sheet hiccup never blocks the candidate)."""
    assessment = db.scalar(
        select(ApAssessment)
        .where(ApAssessment.id == attempt.assessment_id)
        .options(selectinload(ApAssessment.sections).selectinload(ApSection.questions))
    )
    if assessment is None:
        return
    cfg = svc.sheet_sync_config(assessment.settings)
    if not cfg["enabled"]:
        return
    headers, row = svc.build_sheet_payload(attempt, assessment)
    background_tasks.add_task(
        sheets.append_dynamic_row,
        spreadsheet_id=cfg["spreadsheetId"],
        tab_name=cfg["tabName"],
        headers=headers,
        row=row,
    )


@router.post("/me/attempts/{attempt_id}/submit")
def submit_attempt(
    attempt_id: str,
    db: DbDep,
    current_user: Annotated[User, Depends(get_current_user)],
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    attempt = _load_owned_attempt(db, attempt_id, current_user)
    if attempt.status is not ApAttemptStatus.IN_PROGRESS:
        return svc.serialize_taker_attempt(attempt)
    _finalize_attempt(attempt)
    db.commit()
    attempt = _load_owned_attempt(db, attempt_id, current_user)
    _queue_sheet_sync(db, attempt, background_tasks)
    return svc.serialize_taker_attempt(attempt)


@router.post("/assessments/{assessment_id}/sheet-sync")
def resync_sheet(
    assessment_id: str, db: DbDep, current_user: ManageDep
) -> dict[str, Any]:
    """Manually (re)push every submitted attempt to the configured Google Sheet.

    Used to backfill submissions made BEFORE the sheet was wired up (sync normally only
    runs at submit time). Runs synchronously so the real Sheets error (sheet not shared
    with the service account, bad credentials, wrong tab) is surfaced to HR."""
    assessment = db.scalar(
        select(ApAssessment)
        .where(ApAssessment.id == assessment_id, ApAssessment.is_removed.is_(False))
        .options(selectinload(ApAssessment.sections).selectinload(ApSection.questions))
    )
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    cfg = svc.sheet_sync_config(assessment.settings)
    if not cfg["enabled"]:
        raise HTTPException(
            status_code=400,
            detail="Google Sheet sync isn't configured. Add the sheet link (and tab name), tick the sync checkbox, and save first.",
        )
    attempts = db.scalars(
        select(ApAttempt)
        .where(
            ApAttempt.assessment_id == assessment_id,
            ApAttempt.status != ApAttemptStatus.IN_PROGRESS,
        )
        .options(selectinload(ApAttempt.answers))
        .order_by(ApAttempt.submitted_at.asc().nullslast())
    ).all()
    if not attempts:
        return {"synced": 0, "total": 0}
    synced = 0
    first_error: str | None = None
    for attempt in attempts:
        headers, row = svc.build_sheet_payload(attempt, assessment)
        try:
            sheets.append_dynamic_row(
                spreadsheet_id=cfg["spreadsheetId"], tab_name=cfg["tabName"],
                headers=headers, row=row, raise_on_error=True,
            )
            synced += 1
        except Exception as exc:  # noqa: BLE001
            if first_error is None:
                first_error = str(exc)
    if synced == 0 and first_error is not None:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not write to the Google Sheet. Make sure it's shared (Editor) with "
                "your-service-account@your-project.iam.gserviceaccount.com and the link is correct. "
                f"Details: {first_error[:300]}"
            ),
        )
    return {"synced": synced, "total": len(attempts), "error": first_error}


_PROCTOR_EVENT_TYPES = frozenset({"tab_switch", "fullscreen_exit", "copy", "blur"})


@router.post("/me/attempts/{attempt_id}/proctoring")
def record_proctoring(
    attempt_id: str,
    payload: ProctoringEventRequest,
    db: DbDep,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    """Record an anti-cheat violation (tab switch / fullscreen exit / copy / blur)."""
    attempt = _load_owned_attempt(db, attempt_id, current_user)
    if attempt.status is not ApAttemptStatus.IN_PROGRESS:
        return {"counts": svc.proctoring_counts(attempt)}
    if payload.type not in _PROCTOR_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown proctoring event")
    counts = svc.record_proctoring_event(attempt, payload.type)
    db.commit()
    return {"counts": counts}


# ═══════════════════════════════ GRADING ══════════════════════════════════════


def _load_attempt_for_staff(db: Session, attempt_id: str) -> ApAttempt:
    attempt = db.scalar(
        select(ApAttempt)
        .where(ApAttempt.id == attempt_id)
        .options(
            selectinload(ApAttempt.answers),
            joinedload(ApAttempt.assignment),
            joinedload(ApAttempt.user),
        )
    )
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return attempt


@router.get("/grading/queue")
def grading_queue(
    db: DbDep,
    current_user: GradeDep,
    assessment_id: Annotated[str | None, Query(alias="assessmentId")] = None,
) -> list[dict[str, Any]]:
    stmt = (
        select(ApAttempt)
        .where(ApAttempt.status == ApAttemptStatus.SUBMITTED, ApAttempt.result_status == "pending")
        .options(joinedload(ApAttempt.assignment), joinedload(ApAttempt.user))
        .order_by(ApAttempt.submitted_at.asc())
    )
    if assessment_id:
        stmt = stmt.where(ApAttempt.assessment_id == assessment_id)
    rows = db.scalars(stmt).all()
    out = []
    for attempt in rows:
        assessment = db.get(ApAssessment, attempt.assessment_id)
        data = svc.serialize_attempt_summary(attempt)
        data["assessmentTitle"] = assessment.title if assessment else None
        out.append(data)
    return out


@router.get("/grading/attempts/{attempt_id}")
def get_attempt_for_grading(attempt_id: str, db: DbDep, current_user: GradeDep) -> dict[str, Any]:
    attempt = _load_attempt_for_staff(db, attempt_id)
    return svc.serialize_scorecard(attempt)


@router.patch("/grading/attempts/{attempt_id}/answers/{question_id}")
def grade_answer(
    attempt_id: str,
    question_id: str,
    payload: GradeAnswerRequest,
    db: DbDep,
    current_user: GradeDep,
    request: Request,
) -> dict[str, Any]:
    attempt = _load_attempt_for_staff(db, attempt_id)
    snap_q = next(
        (
            q
            for section in (attempt.snapshot or {}).get("sections", [])
            for q in section.get("questions", [])
            if q["id"] == question_id
        ),
        None,
    )
    if snap_q is None:
        raise HTTPException(status_code=404, detail="Question not part of this attempt")
    qtype = ApQuestionType(snap_q["type"])
    if qtype in svc.UNSCORED_TYPES or svc.is_auto_scored(qtype, snap_q.get("config", {})):
        raise HTTPException(status_code=400, detail="This question is auto-scored and cannot be graded manually")
    max_marks = float(snap_q.get("marks") or 0.0)
    marks = max(0.0, min(payload.marks, max_marks))

    answer = next((a for a in attempt.answers if a.question_id == question_id), None)
    if answer is None:
        answer = ApAnswer(attempt_id=attempt.id, question_id=question_id)
        db.add(answer)
        attempt.answers.append(answer)
    answer.manual_marks = marks
    answer.awarded_marks = marks
    answer.feedback = payload.feedback
    answer.graded_by = current_user.id
    answer.graded_at = _now()
    svc.recompute_attempt_totals(attempt)
    if attempt.assignment is not None and attempt.result_status != "pending":
        attempt.assignment.status = ApAssignmentStatus.GRADED
    log_audit(
        db, entity_type="ap_attempt", entity_id=attempt.id, action="graded_answer",
        actor=current_user, request=request, new_value={"questionId": question_id, "marks": marks},
    )
    db.commit()
    attempt = _load_attempt_for_staff(db, attempt_id)
    return svc.serialize_scorecard(attempt)


@router.post("/grading/attempts/{attempt_id}/finalize")
def finalize_grading(
    attempt_id: str, db: DbDep, current_user: GradeDep, request: Request
) -> dict[str, Any]:
    attempt = _load_attempt_for_staff(db, attempt_id)
    if svc.attempt_has_pending_manual(attempt):
        raise HTTPException(status_code=400, detail="Grade all manual answers before finalizing")
    svc.recompute_attempt_totals(attempt)
    if attempt.assignment is not None:
        attempt.assignment.status = ApAssignmentStatus.GRADED
    attempt.graded_by = current_user.id
    attempt.graded_at = _now()
    log_audit(
        db, entity_type="ap_attempt", entity_id=attempt.id, action="grading_finalized",
        actor=current_user, request=request,
    )
    db.commit()
    attempt = _load_attempt_for_staff(db, attempt_id)
    return svc.serialize_scorecard(attempt)


# ═══════════════════════════════ RESULTS ══════════════════════════════════════


@router.get("/assessments/{assessment_id}/results")
def assessment_results(
    assessment_id: str,
    db: DbDep,
    current_user: ReadDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    page: Annotated[int, Query()] = 1,
    limit: Annotated[int, Query()] = 50,
) -> dict[str, Any]:
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    page, limit = _paginate_params(page, limit)
    stmt = (
        select(ApAttempt)
        .where(ApAttempt.assessment_id == assessment.id)
        .options(joinedload(ApAttempt.assignment), joinedload(ApAttempt.user))
    )
    if status_filter:
        stmt = stmt.where(ApAttempt.status == status_filter)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(ApAttempt.submitted_at.desc().nullslast(), ApAttempt.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()
    return {
        "data": [svc.serialize_attempt_summary(a) for a in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit,
        "assessment": svc.serialize_assessment(assessment),
    }


@router.get("/attempts/{attempt_id}/scorecard")
def attempt_scorecard(attempt_id: str, db: DbDep, current_user: ReadDep) -> dict[str, Any]:
    attempt = _load_attempt_for_staff(db, attempt_id)
    return svc.serialize_scorecard(attempt)


@router.get("/attempts/{attempt_id}/answers/{question_id}/file")
def download_answer_file(
    attempt_id: str, question_id: str, db: DbDep, current_user: ReadDep
):
    answer = db.scalar(
        select(ApAnswer).where(ApAnswer.attempt_id == attempt_id, ApAnswer.question_id == question_id)
    )
    if answer is None or not answer.file_url:
        raise HTTPException(status_code=404, detail="No file submitted for this question")
    if answer.file_url.startswith("http"):
        presigned = StorageService().presigned_download_url(answer.file_url)
        return RedirectResponse(url=presigned or answer.file_url)
    settings = get_settings()
    return RedirectResponse(url=f"{settings.frontend_url.rstrip('/')}{answer.file_url}")


@router.get("/assessments/{assessment_id}/results/export")
def export_results_csv(assessment_id: str, db: DbDep, current_user: ReadDep) -> StreamingResponse:
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    rows = db.scalars(
        select(ApAttempt)
        .where(ApAttempt.assessment_id == assessment.id)
        .options(joinedload(ApAttempt.assignment), joinedload(ApAttempt.user))
        .order_by(ApAttempt.submitted_at.desc().nullslast())
    ).all()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["Email", "Name", "Status", "Started", "Submitted", "Auto Score",
         "Manual Score", "Total Score", "Max Score", "Percentage", "Result"]
    )
    for attempt in rows:
        pending = attempt.result_status == "pending"
        result_label = "grading_pending" if pending else (attempt.result_status or "")
        writer.writerow(
            csv_safe_row([
                attempt.assignment.email if attempt.assignment else (attempt.user.email if attempt.user else ""),
                attempt.user.name if attempt.user else "",
                attempt.status.value,
                attempt.started_at.isoformat() if attempt.started_at else "",
                attempt.submitted_at.isoformat() if attempt.submitted_at else "",
                attempt.auto_score if attempt.auto_score is not None else "",
                "" if pending else (attempt.manual_score if attempt.manual_score is not None else ""),
                "" if pending else (attempt.total_score if attempt.total_score is not None else ""),
                attempt.max_score if attempt.max_score is not None else "",
                "" if pending else (attempt.percentage if attempt.percentage is not None else ""),
                result_label,
            ])
        )
    buffer.seek(0)
    filename = f"assessment_results_{assessment.id}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _parse_results_csv(raw: bytes) -> list[dict[str, Any]]:
    if len(raw) > _MAX_CSV_BYTES:
        raise HTTPException(status_code=400, detail="CSV file too large (max 5MB)")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="The CSV has no header row")
    norm = {(h or "").strip().lower(): h for h in reader.fieldnames}

    def pick(*aliases: str) -> str | None:
        for alias in aliases:
            if alias in norm:
                return norm[alias]
        return None

    email_col = pick("email", "email address", "personal email", "personalemail", "emailaddress", "candidate email")
    score_col = pick("score", "final score", "finalscore", "marks", "total", "total score")
    fb_col = pick("feedback", "overall feedback", "overallfeedback", "remarks", "comments", "comment")
    verdict_col = pick("verdict", "result", "pass/fail", "pass / fail", "passfail", "decision", "outcome")
    if not email_col or not score_col:
        raise HTTPException(
            status_code=400, detail="CSV must include an 'email' column and a 'score' column"
        )
    out: list[dict[str, Any]] = []
    for row in reader:
        email = (row.get(email_col) or "").strip().lower()
        raw_score = (row.get(score_col) or "").strip()
        if not email or not _EMAIL_RE.match(email):
            continue
        try:
            score = float(raw_score)
        except ValueError:
            continue
        verdict_raw = (row.get(verdict_col) or "").strip().lower() if verdict_col else ""
        verdict = (
            "pass" if verdict_raw in ("pass", "passed", "p", "yes", "y", "true", "1")
            else "fail" if verdict_raw in ("fail", "failed", "f", "no", "n", "false", "0")
            else None
        )
        out.append(
            {
                "email": email,
                "score": score,
                "feedback": (row.get(fb_col) or "").strip() if fb_col else None,
                "verdict": verdict,
            }
        )
    return out


@router.post("/assessments/{assessment_id}/results/upload", status_code=200)
def upload_results(
    assessment_id: str,
    db: DbDep,
    current_user: ManageDep,
    request: Request,
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    """Bulk-import HR's final score + overall feedback from a CSV (email, score, feedback).

    Matches by email; the latest submitted attempt wins. Candidates whose result is
    already finalized are skipped (first upload wins, re-uploads are safe).
    """
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    parsed = _parse_results_csv(file.file.read())
    result = {"total": len(parsed), "updated": 0, "skippedFinalized": 0, "notFound": 0}
    for entry in parsed:
        attempt = db.scalar(
            select(ApAttempt)
            .join(ApAssignment, ApAttempt.assignment_id == ApAssignment.id)
            .where(
                ApAttempt.assessment_id == assessment.id,
                func.lower(ApAssignment.email) == entry["email"],
                ApAttempt.status != ApAttemptStatus.IN_PROGRESS,
            )
            .options(joinedload(ApAttempt.assignment))
            .order_by(ApAttempt.submitted_at.desc().nullslast())
        )
        if attempt is None:
            result["notFound"] += 1
            continue
        if attempt.result_finalized_at is not None:
            result["skippedFinalized"] += 1
            continue
        svc.apply_final_result(
            attempt, score=entry["score"], feedback=entry["feedback"],
            actor=current_user, verdict=entry.get("verdict"),
        )
        result["updated"] += 1
    log_audit(
        db, entity_type="ap_assessment", entity_id=assessment.id, action="results_uploaded",
        actor=current_user, request=request, new_value=result,
    )
    db.commit()
    return result


@router.post("/assessments/{assessment_id}/results/release")
def release_all_results(
    assessment_id: str, db: DbDep, current_user: ManageDep, request: Request
) -> dict[str, Any]:
    """Release every graded (non-pending) result for an assessment so candidates can
    finally see their verdict and progress. Attempts still pending grading are skipped."""
    assessment = _load_assessment(db, assessment_id, with_structure=False)
    attempts = db.scalars(
        select(ApAttempt).where(
            ApAttempt.assessment_id == assessment.id,
            ApAttempt.status != ApAttemptStatus.IN_PROGRESS,
            ApAttempt.result_released_at.is_(None),
        )
    ).all()
    released = 0
    pass_user_ids: list[str] = []
    for attempt in attempts:
        if attempt.result_status and attempt.result_status != "pending":
            attempt.result_released_at = _now()
            released += 1
            if attempt.result_status == "pass":
                pass_user_ids.append(attempt.user_id)
    log_audit(
        db, entity_type="ap_assessment", entity_id=assessment.id, action="results_released",
        actor=current_user, request=request, new_value={"released": released},
    )
    db.commit()
    _notify_campus_passers(db, pass_user_ids)
    return {"released": released, "skippedPending": len(attempts) - released}


@router.post("/attempts/{attempt_id}/release")
def release_attempt_result(
    attempt_id: str, db: DbDep, current_user: ManageDep, request: Request
) -> dict[str, Any]:
    """Release a single attempt's result."""
    attempt = _load_attempt_for_staff(db, attempt_id)
    if not attempt.result_status or attempt.result_status == "pending":
        raise HTTPException(status_code=400, detail="Grade and finalize this result before releasing it")
    attempt.result_released_at = _now()
    is_pass = attempt.result_status == "pass"
    user_id = attempt.user_id
    log_audit(
        db, entity_type="ap_attempt", entity_id=attempt.id, action="result_released",
        actor=current_user, request=request,
    )
    db.commit()
    if is_pass:
        _notify_campus_passers(db, [user_id])
    attempt = _load_attempt_for_staff(db, attempt_id)
    return svc.serialize_attempt_summary(attempt)


def _notify_campus_passers(db: Session, user_ids: list[str]) -> None:
    """Best-effort: email any campus-hire passers a link to finish full registration."""
    if not user_ids:
        return
    from app.services import candidates as candidate_service
    for user_id in user_ids:
        try:
            candidate_service.notify_campus_pass(db, user_id=user_id)
        except Exception:  # noqa: BLE001
            logger.warning("campus-pass notify failed for user %s", user_id)
