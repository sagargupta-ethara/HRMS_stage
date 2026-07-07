from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import _resolve_permissions, get_current_user, require_permissions, user_has_any_role
from app.core.database import get_db
from app.core.permissions import Permission
from app.services.candidates import enforce_candidate_access
from app.db.models import Candidate, CandidateAssessment, CandidateStage, Evaluation, PiInterviewRound, Role, User
from app.services.audit import log_audit
from app.services.integrations import StorageService
from app.services import workflows

router = APIRouter(prefix="/assessments", tags=["assessments"])

ALLOWED_VIDEO_MIME = {
    "video/mp4", "video/webm", "video/quicktime", "video/avi",
    "video/x-msvideo", "video/x-matroska",
}
ALLOWED_DOC_MIME = {
    "text/plain", "application/pdf", "text/markdown",
    "application/octet-stream",
}
MAX_VIDEO_BYTES = 100 * 1024 * 1024
MAX_DOC_BYTES = 10 * 1024 * 1024

LEVEL_2_OVERRIDE_STAGES = {
    CandidateStage.EVALUATION_IN_PROGRESS,
    CandidateStage.EVALUATION_PASSED,
    CandidateStage.SELECTION_FORM_SENT,
    CandidateStage.SELECTION_FORM_SUBMITTED,
    CandidateStage.SELECTION_FORM_VALIDATED,
    CandidateStage.CONTRACT_SENT,
    CandidateStage.CONTRACT_SIGNED,
    CandidateStage.INDUCTION_COMPLETED,
    CandidateStage.IT_EMAIL_CREATED,
    CandidateStage.WELCOME_MAIL_SENT,
    CandidateStage.STATUTORY_FORMS_SENT,
    CandidateStage.STATUTORY_FORMS_SUBMITTED,
    CandidateStage.COMPLIANCE_VERIFIED,
    CandidateStage.ONBOARDING_COMPLETED,
}

LEVEL_3_OVERRIDE_STAGES = {
    CandidateStage.EVALUATION_PASSED,
    CandidateStage.SELECTION_FORM_SENT,
    CandidateStage.SELECTION_FORM_SUBMITTED,
    CandidateStage.SELECTION_FORM_VALIDATED,
    CandidateStage.CONTRACT_SENT,
    CandidateStage.CONTRACT_SIGNED,
    CandidateStage.INDUCTION_COMPLETED,
    CandidateStage.IT_EMAIL_CREATED,
    CandidateStage.WELCOME_MAIL_SENT,
    CandidateStage.STATUTORY_FORMS_SENT,
    CandidateStage.STATUTORY_FORMS_SUBMITTED,
    CandidateStage.COMPLIANCE_VERIFIED,
    CandidateStage.ONBOARDING_COMPLETED,
}

# A candidate may only be bypassed while still in the assessment phase. Once the
# selection form has been sent (or the candidate is further along), bypassing
# would regress an already-advanced pipeline state and is rejected.
BYPASS_ALLOWED_STAGES = {
    CandidateStage.RESUME_SHORTLISTED,
    CandidateStage.EVALUATION_ASSIGNED,
    CandidateStage.EVALUATION_IN_PROGRESS,
    CandidateStage.EVALUATION_PASSED,
    CandidateStage.EVALUATION_FAILED,
}

# Staff roles that may view/act on ANY candidate's assessments. Other roles holding
# EVALUATIONS_* (i.e. EVALUATOR) are scoped to candidates assigned to them via an
# Evaluation assignment. Mirrors workflows._EVAL_STAFF_ROLES.
_STAFF_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}

# Assessment statuses considered terminal — grading is locked once reached unless a
# staff member reopens (re-grades) the assessment.
_TERMINAL_ASSESSMENT_STATUSES = {"passed", "failed", "bypassed"}


def _evaluator_is_assigned(db: Session, *, candidate_id: str, evaluator_id: str) -> bool:
    """True if the evaluator has an Evaluation assignment for this candidate."""
    return db.scalar(
        select(Evaluation.id).where(
            Evaluation.candidate_id == candidate_id,
            Evaluation.evaluator_id == evaluator_id,
        ).limit(1)
    ) is not None


def _is_staff_user(user: User) -> bool:
    return user_has_any_role(user, _STAFF_ROLES)


def _is_plain_evaluator(user: User) -> bool:
    return user_has_any_role(user, {Role.EVALUATOR}) and not _is_staff_user(user)


def _assigned_candidate_ids(db: Session, evaluator_id: str) -> set[str]:
    """Candidate ids the evaluator is assigned to via an Evaluation assignment."""
    return set(
        db.scalars(
            select(Evaluation.candidate_id).where(
                Evaluation.evaluator_id == evaluator_id,
            )
        ).all()
    )


def _upload_size(upload: UploadFile) -> int:
    upload.file.seek(0, 2)
    size = upload.file.tell()
    upload.file.seek(0)
    return size


def _save_file(
    upload: UploadFile,
    subdir: str,
    *,
    allowed_content_types: set[str],
    max_size_bytes: int,
) -> str:
    file_url, _storage_path = StorageService().save_upload(
        upload,
        folder=subdir,
        allowed_content_types=allowed_content_types,
        max_size_bytes=max_size_bytes,
    )
    upload.file.seek(0)
    return file_url


def _serialize(a: CandidateAssessment) -> dict:
    return {
        "id": a.id,
        "candidateId": a.candidate_id,
        "level": a.level,
        "status": a.status,
        "deployedUrl": a.deployed_url,
        "repoUrl": a.repo_url,
        "readmePath": a.readme_path,
        "explanationVideoPath": a.explanation_video_path,
        "communicationVideoPath": a.communication_video_path,
        "promptResponse": a.prompt_response,
        "autoScore": a.auto_score,
        "evaluatorScore": a.evaluator_score,
        "totalScore": a.total_score,
        "feedback": a.feedback,
        "decision": a.decision,
        "submittedAt": a.submitted_at.isoformat() if a.submitted_at else None,
        "evaluatedAt": a.evaluated_at.isoformat() if a.evaluated_at else None,
        "evaluatorId": a.evaluator_id,
        "evaluatorName": a.evaluator.name if a.evaluator else None,
        "createdAt": a.created_at.isoformat() if a.created_at else None,
    }


def _serialize_pi_round(round_record: PiInterviewRound) -> dict:
    return {
        "id": round_record.id,
        "evaluationId": round_record.evaluation_id,
        "candidateId": round_record.candidate_id,
        "evaluatorId": round_record.evaluator_id,
        "roundNumber": round_record.round_number,
        "panelLabel": round_record.panel_label,
        "subject": round_record.subject,
        "scheduledAt": round_record.scheduled_at.isoformat() if round_record.scheduled_at else None,
        "completedAt": round_record.completed_at.isoformat() if round_record.completed_at else None,
        "status": round_record.status,
        "mode": round_record.mode,
        "durationMinutes": round_record.duration_minutes,
        "score": round_record.score,
        "remarks": round_record.remarks,
        "notes": round_record.remarks,
        "roundDecision": round_record.round_decision,
        "noFurtherPiRequired": round_record.no_further_pi_required,
        "finalVerdict": round_record.final_verdict,
        "panelMembers": round_record.panel_members or [],
        "evaluatorName": round_record.evaluator.name if round_record.evaluator else None,
    }


def _legacy_pi_summary(ev: Evaluation) -> dict | None:
    if not any([
        ev.interview_subject,
        ev.interview_scheduled_at is not None,
        ev.interview_status,
        ev.interview_notes,
        ev.pi_score is not None,
    ]):
        return None
    return {
        "id": ev.id,
        "evaluationId": ev.id,
        "candidateId": ev.candidate_id,
        "evaluatorId": ev.evaluator_id,
        "roundNumber": 1,
        "panelLabel": None,
        "subject": ev.interview_subject,
        "scheduledAt": ev.interview_scheduled_at.isoformat() if ev.interview_scheduled_at else None,
        "completedAt": ev.completed_at.isoformat() if ev.completed_at else None,
        "status": ev.interview_status,
        "mode": ev.interview_mode,
        "durationMinutes": 60,
        "score": ev.pi_score,
        "remarks": ev.interview_notes,
        "notes": ev.interview_notes,
        "roundDecision": workflows._normalize_pi_round_decision(ev.recommendation),
        "noFurtherPiRequired": workflows._normalize_pi_final_verdict(ev.recommendation) is not None,
        "finalVerdict": workflows._normalize_pi_final_verdict(ev.recommendation),
        "panelMembers": [],
        "evaluatorName": ev.evaluator.name if ev.evaluator else None,
    }


def _serialized_pi_rounds(ev: Evaluation) -> list[dict]:
    rounds = sorted(ev.pi_rounds or [], key=lambda item: item.round_number)
    if rounds:
        return [_serialize_pi_round(round_record) for round_record in rounds]
    legacy = _legacy_pi_summary(ev)
    return [legacy] if legacy else []


def _latest_pi_round_summary(ev: Evaluation) -> dict | None:
    rounds = _serialized_pi_rounds(ev)
    return rounds[-1] if rounds else None


def _resolve_final_decision(candidate: Candidate, latest_pi_round: dict | None) -> str | None:
    final_verdict = (latest_pi_round or {}).get("finalVerdict")
    if final_verdict == "selected":
        return "pass"
    if final_verdict == "rejected":
        return "fail"
    if candidate.current_stage == CandidateStage.EVALUATION_PASSED:
        return "pass"
    if candidate.current_stage == CandidateStage.EVALUATION_FAILED:
        return "fail"
    return None


def _get_or_create(db: Session, candidate_id: str, level: int) -> CandidateAssessment:
    assessment = db.scalar(
        select(CandidateAssessment).where(
            CandidateAssessment.candidate_id == candidate_id,
            CandidateAssessment.level == level,
        )
    )
    if assessment is None:
        assessment = CandidateAssessment(
            candidate_id=candidate_id,
            level=level,
            status="pending",
        )
        db.add(assessment)
        db.flush()
    return assessment


@router.get("/candidate/{candidate_id}")
def list_for_candidate(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    can_read_evaluations = Permission.EVALUATIONS_READ.value in _resolve_permissions(current_user)
    if not can_read_evaluations:
        if not user_has_any_role(current_user, {Role.CANDIDATE}):
            raise HTTPException(status_code=403, detail="Access denied")
        candidate = db.scalar(select(Candidate).where(
            Candidate.id == candidate_id,
            Candidate.portal_user_id == current_user.id,
        ))
        if not candidate:
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        # Non-candidate callers must hold evaluations:read (blocks employee/manager/
        # office_admin/etc.), and vendors are limited to their own candidates.
        candidate = db.get(Candidate, candidate_id)
        if candidate is None:
            raise HTTPException(status_code=404, detail="Candidate not found")
        enforce_candidate_access(candidate=candidate, user=current_user)
        # A plain evaluator may only read assessments for candidates they are
        # assigned to (via an Evaluation assignment); staff retain full visibility.
        if _is_plain_evaluator(current_user) and not _evaluator_is_assigned(
            db, candidate_id=candidate_id, evaluator_id=current_user.id
        ):
            raise HTTPException(status_code=403, detail="Access denied")
    rows = db.scalars(
        select(CandidateAssessment)
        .where(CandidateAssessment.candidate_id == candidate_id)
        .order_by(CandidateAssessment.level)
    ).all()
    return [_serialize(r) for r in rows]


@router.get("/me")
def my_assessments(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    if not user_has_any_role(current_user, {Role.CANDIDATE}):
        raise HTTPException(status_code=403, detail="Candidate access required")
    candidate = db.scalar(
        select(Candidate).where(Candidate.portal_user_id == current_user.id)
        .order_by(Candidate.created_at.desc())
    )
    if not candidate:
        return []
    rows = db.scalars(
        select(CandidateAssessment)
        .where(CandidateAssessment.candidate_id == candidate.id)
        .order_by(CandidateAssessment.level)
    ).all()
    return [_serialize(r) for r in rows]


@router.post("/me/level/{level}/submit")
def submit_assessment(
    level: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    deployed_url: str | None = Form(default=None, alias="deployedUrl"),
    repo_url: str | None = Form(default=None, alias="repoUrl"),
    prompt_response: str | None = Form(default=None, alias="promptResponse"),
    readme: Annotated[UploadFile | None, File()] = None,
    explanation_video: Annotated[UploadFile | None, File(alias="explanationVideo")] = None,
    communication_video: Annotated[UploadFile | None, File(alias="communicationVideo")] = None,
) -> dict:
    if level not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Level must be 1, 2, or 3")
    if not user_has_any_role(current_user, {Role.CANDIDATE}):
        raise HTTPException(status_code=403, detail="Candidate access required")

    candidate = db.scalar(
        select(Candidate).where(Candidate.portal_user_id == current_user.id)
        .order_by(Candidate.created_at.desc())
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate profile not found")

    shortlisted_stages = {
        CandidateStage.RESUME_SHORTLISTED,
        CandidateStage.EVALUATION_ASSIGNED,
        CandidateStage.EVALUATION_IN_PROGRESS,
        CandidateStage.EVALUATION_PASSED,
        CandidateStage.SELECTION_FORM_SENT,
        CandidateStage.SELECTION_FORM_SUBMITTED,
        CandidateStage.SELECTION_FORM_VALIDATED,
        CandidateStage.CONTRACT_SENT,
        CandidateStage.CONTRACT_SIGNED,
        CandidateStage.ONBOARDING_COMPLETED,
        CandidateStage.INDUCTION_COMPLETED,
        CandidateStage.IT_EMAIL_CREATED,
        CandidateStage.WELCOME_MAIL_SENT,
        CandidateStage.STATUTORY_FORMS_SENT,
        CandidateStage.STATUTORY_FORMS_SUBMITTED,
        CandidateStage.COMPLIANCE_VERIFIED,
    }
    if candidate.current_stage not in shortlisted_stages:
        stage_label = candidate.current_stage.value.replace("_", " ").replace("-", " ").title()
        raise HTTPException(
            status_code=400,
            detail=f"Assessment not available at stage '{stage_label}'. "
                   "Resume must be shortlisted first.",
        )

    if level == 2:
        l1 = db.scalar(
            select(CandidateAssessment).where(
                CandidateAssessment.candidate_id == candidate.id,
                CandidateAssessment.level == 1,
                CandidateAssessment.decision == "pass",
            )
        )
        if not l1 and candidate.current_stage not in LEVEL_2_OVERRIDE_STAGES:
            raise HTTPException(status_code=400, detail="The previous assessment must be passed first.")

    if level == 3:
        l2 = db.scalar(
            select(CandidateAssessment).where(
                CandidateAssessment.candidate_id == candidate.id,
                CandidateAssessment.level == 2,
                CandidateAssessment.decision == "pass",
            )
        )
        if not l2 and candidate.current_stage not in LEVEL_3_OVERRIDE_STAGES:
            raise HTTPException(status_code=400, detail="The previous assessment must be passed first.")

    assessment = _get_or_create(db, candidate.id, level)

    if assessment.status in ("submitted", "passed", "failed"):
        raise HTTPException(status_code=400, detail="Assessment already submitted")

    if deployed_url:
        assessment.deployed_url = deployed_url.strip()
    if repo_url:
        assessment.repo_url = repo_url.strip()
    if prompt_response:
        assessment.prompt_response = prompt_response.strip()

    if readme and readme.filename:
        if (readme.content_type or "").split(";")[0] not in ALLOWED_DOC_MIME:
            raise HTTPException(status_code=400, detail="README must be a .txt or .pdf file")
        if _upload_size(readme) > MAX_DOC_BYTES:
            raise HTTPException(status_code=400, detail="README must be under 10 MB")
        assessment.readme_path = _save_file(
            readme,
            f"assessments/{candidate.id}/readme",
            allowed_content_types=ALLOWED_DOC_MIME,
            max_size_bytes=MAX_DOC_BYTES,
        )

    if explanation_video and explanation_video.filename:
        ct = (explanation_video.content_type or "").split(";")[0]
        if ct not in ALLOWED_VIDEO_MIME:
            raise HTTPException(status_code=400, detail="Explanation video must be MP4/WebM/MOV")
        if _upload_size(explanation_video) > MAX_VIDEO_BYTES:
            raise HTTPException(status_code=400, detail="Video must be under 100 MB")
        assessment.explanation_video_path = _save_file(
            explanation_video,
            f"assessments/{candidate.id}/explanation",
            allowed_content_types=ALLOWED_VIDEO_MIME,
            max_size_bytes=MAX_VIDEO_BYTES,
        )

    if communication_video and communication_video.filename:
        ct = (communication_video.content_type or "").split(";")[0]
        if ct not in ALLOWED_VIDEO_MIME:
            raise HTTPException(status_code=400, detail="Communication video must be MP4/WebM/MOV")
        if _upload_size(communication_video) > MAX_VIDEO_BYTES:
            raise HTTPException(status_code=400, detail="Video must be under 100 MB")
        assessment.communication_video_path = _save_file(
            communication_video,
            f"assessments/{candidate.id}/communication",
            allowed_content_types=ALLOWED_VIDEO_MIME,
            max_size_bytes=MAX_VIDEO_BYTES,
        )

    assessment.status = "submitted"
    assessment.submitted_at = datetime.now(UTC)

    if candidate.current_stage == CandidateStage.RESUME_SHORTLISTED:
        candidate.current_stage = CandidateStage.EVALUATION_ASSIGNED
        candidate.current_status = "Assessment Submitted"
        db.add(candidate)

    log_audit(
        db, entity_type="assessment", entity_id=assessment.id,
        action=f"level_{level}_submitted", actor=current_user, request=request,
        candidate_id=candidate.id,
    )
    db.commit()
    db.refresh(assessment)

    try:
        from app.services.sheets import append_assessment_row
        position = candidate.position
        append_assessment_row(
            level=level,
            candidate_name=candidate.full_name,
            email=candidate.personal_email,
            phone=candidate.phone,
            position=position.title if position else None,
            department=position.department if position else None,
            candidate_code=candidate.candidate_code,
            current_stage=candidate.current_stage.value,
            deployed_url=assessment.deployed_url,
            repo_url=assessment.repo_url,
            readme_path=assessment.readme_path,
            explanation_video_path=assessment.explanation_video_path,
            communication_video_path=assessment.communication_video_path,
            prompt_response=assessment.prompt_response,
            submitted_at=assessment.submitted_at,
        )
    except Exception as exc:
        import logging as _log
        _log.getLogger(__name__).warning("Sheets sync non-fatal error: %s", exc)

    return _serialize(assessment)


@router.patch("/{assessment_id}/evaluate")
def evaluate_assessment(
    assessment_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
    score: float = Form(),
    decision: str = Form(),
    feedback: str | None = Form(default=None),
) -> dict:
    assessment = db.get(CandidateAssessment, assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if decision not in ("pass", "fail"):
        raise HTTPException(status_code=400, detail="decision must be 'pass' or 'fail'")

    is_staff = _is_staff_user(current_user)

    # (a) Per-record scoping: a non-staff evaluator may only grade candidates they
    # are actually assigned to (an Evaluation exists for them on this candidate).
    if not is_staff and not _evaluator_is_assigned(
        db, candidate_id=assessment.candidate_id, evaluator_id=current_user.id
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not assigned to evaluate this candidate.",
        )

    # (b) Terminal guard: once an assessment is passed/failed/bypassed it is locked.
    # Only staff may reopen and re-grade it.
    if assessment.status in _TERMINAL_ASSESSMENT_STATUSES and not is_staff:
        raise HTTPException(
            status_code=409,
            detail=(
                "This assessment has already been finalized and can only be "
                "re-graded by an administrator."
            ),
        )

    assessment.evaluator_id = current_user.id
    assessment.evaluator_score = score
    assessment.total_score = score
    assessment.decision = decision
    assessment.feedback = feedback
    assessment.evaluated_at = datetime.now(UTC)
    assessment.status = "passed" if decision == "pass" else "failed"

    candidate = db.get(Candidate, assessment.candidate_id)
    if candidate:
        if decision == "pass" and assessment.level == 1:
            candidate.current_stage = CandidateStage.EVALUATION_IN_PROGRESS
            candidate.current_status = "Assessment Passed"
        elif decision == "fail" and assessment.level == 1:
            candidate.current_stage = CandidateStage.EVALUATION_FAILED
            candidate.current_status = "Assessment Failed"
        elif decision == "pass" and assessment.level == 2:
            candidate.current_status = "Assessment Passed"
        elif decision == "fail" and assessment.level == 2:
            candidate.current_stage = CandidateStage.EVALUATION_FAILED
            candidate.current_status = "Assessment Failed"
        elif decision == "pass" and assessment.level == 3:
            candidate.current_stage = CandidateStage.EVALUATION_PASSED
            candidate.current_status = "Evals Passed"
        elif decision == "fail" and assessment.level == 3:
            candidate.current_stage = CandidateStage.EVALUATION_FAILED
            candidate.current_status = "Evals Failed"
        db.add(candidate)

    log_audit(
        db, entity_type="assessment", entity_id=assessment.id,
        action=f"level_{assessment.level}_evaluated",
        actor=current_user, request=request,
        candidate_id=assessment.candidate_id,
        new_value={"decision": decision, "score": score},
    )
    db.commit()
    db.refresh(assessment)
    return _serialize(assessment)


class _BypassEntry(BaseModel):
    level: int
    score: float
    feedback: str | None = None


class _BypassRequest(BaseModel):
    bypasses: list[_BypassEntry]
    notes: str | None = None


@router.post("/candidate/{candidate_id}/bypass")
def bypass_assessments(
    candidate_id: str,
    payload: _BypassRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
) -> dict:
    """
    Admin / evaluator can bypass one or both assessment levels for a candidate,
    entering scores on their behalf. If level 2 is included, the candidate is
    immediately advanced to Selection Form Sent (skipping the Evals assessment
    requirement).
    """
    # Bypassing assessment levels is a staff-only privilege. A plain EVALUATOR holds
    # EVALUATIONS_WRITE for grading but must not skip levels on a candidate's behalf.
    if not _is_staff_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Only administrators may bypass assessment levels.",
        )

    if not payload.bypasses:
        raise HTTPException(status_code=400, detail="At least one assessment level must be provided.")

    for entry in payload.bypasses:
        if entry.level not in (1, 2):
            raise HTTPException(status_code=400, detail="level must be 1 or 2.")
        if not (0 <= entry.score <= 100):
            raise HTTPException(status_code=400, detail="score must be between 0 and 100.")

    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    if candidate.current_stage not in BYPASS_ALLOWED_STAGES:
        raise HTTPException(
            status_code=409,
            detail=(
                "Assessments can only be bypassed while the candidate is in the "
                "assessment phase. This candidate has already advanced past it."
            ),
        )

    now = datetime.now(UTC)
    serialized: list[dict] = []

    for entry in payload.bypasses:
        asmt = _get_or_create(db, candidate_id, entry.level)
        asmt.evaluator_id = current_user.id
        asmt.evaluator_score = entry.score
        asmt.total_score = entry.score
        asmt.decision = "pass"
        asmt.feedback = entry.feedback or (payload.notes if payload.notes else "Assessment bypassed by administrator.")
        asmt.evaluated_at = now
        asmt.submitted_at = asmt.submitted_at or now
        asmt.status = "bypassed"
        db.add(asmt)

        log_audit(
            db,
            entity_type="assessment",
            entity_id=asmt.id,
            action=f"level_{entry.level}_bypassed",
            actor=current_user,
            request=request,
            candidate_id=candidate_id,
            new_value={
                "score": entry.score,
                "decision": "pass",
                "bypassedBy": current_user.name or current_user.email,
                "notes": payload.notes,
            },
        )
        serialized.append(_serialize(asmt))

    # Determine stage advancement based on highest level bypassed
    bypassed_levels = {e.level for e in payload.bypasses}
    if 2 in bypassed_levels:
        # Skip the remaining assessment requirement and advance straight to the
        # selection form. EVALUATION_PASSED has no side effects of its own, so
        # we set the final stage once and trigger its side effects.
        candidate.current_stage = CandidateStage.SELECTION_FORM_SENT
        candidate.current_status = "Selection Form Sent (Assessment Bypassed)"
        db.add(candidate)
        db.flush()
        workflows.apply_stage_side_effects(db, candidate, actor=current_user)
    elif 1 in bypassed_levels:
        candidate.current_stage = CandidateStage.EVALUATION_IN_PROGRESS
        candidate.current_status = "Assessment Bypassed"
        db.add(candidate)

    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate_id,
        action="assessment_bypassed",
        actor=current_user,
        request=request,
        candidate_id=candidate_id,
        new_value={
            "bypassedLevels": sorted(bypassed_levels),
            "newStage": candidate.current_stage,
            "notes": payload.notes,
        },
    )

    db.commit()

    return {
        "success": True,
        "assessments": serialized,
        "newStage": candidate.current_stage,
        "newStatus": candidate.current_status,
    }


@router.get("/me/interviews")
def my_pi_interviews(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    if not user_has_any_role(current_user, {Role.CANDIDATE}):
        raise HTTPException(status_code=403, detail="Candidate access required")
    candidate = db.scalar(
        select(Candidate).where(Candidate.portal_user_id == current_user.id)
        .order_by(Candidate.created_at.desc())
    )
    if not candidate:
        return []
    rows = db.scalars(
        select(Evaluation)
        .options(
            selectinload(Evaluation.evaluator),
            selectinload(Evaluation.pi_rounds).joinedload(PiInterviewRound.evaluator),
        )
        .where(Evaluation.candidate_id == candidate.id)
        .order_by(Evaluation.created_at.desc())
    ).all()
    result = []
    for ev in rows:
        for round_payload in _serialized_pi_rounds(ev):
            result.append({
                "id": round_payload["id"],
                "evaluationId": ev.id,
                "roundNumber": round_payload["roundNumber"],
                "panelLabel": round_payload["panelLabel"],
                "subject": round_payload["subject"],
                "scheduledAt": round_payload["scheduledAt"],
                "status": round_payload["status"],
                "mode": round_payload["mode"],
                "notes": round_payload["remarks"],
                "remarks": round_payload["remarks"],
                "score": round_payload["score"],
                "finalVerdict": round_payload["finalVerdict"],
                "noFurtherPiRequired": round_payload["noFurtherPiRequired"],
                "panelMembers": round_payload["panelMembers"],
                "evaluatorName": round_payload["evaluatorName"],
                "completedAt": round_payload["completedAt"],
            })
    result.sort(key=lambda item: item["scheduledAt"] or "", reverse=True)
    return result


@router.get("/evaluator-view")
def evaluator_candidate_view(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_READ))],
    position_id: str | None = None,
    stage: str | None = None,
    pass_fail: str | None = None,
    pi_scheduled: str | None = None,
) -> list[dict]:
    candidate_query = (
        select(Candidate)
        .options(
            selectinload(Candidate.assessments),
            joinedload(Candidate.position),
            selectinload(Candidate.evaluations).joinedload(Evaluation.evaluator),
            selectinload(Candidate.evaluations).selectinload(Evaluation.pi_rounds).joinedload(PiInterviewRound.evaluator),
        )
        .where(
            Candidate.current_stage.in_([
                CandidateStage.RESUME_SHORTLISTED,
                CandidateStage.EVALUATION_ASSIGNED,
                CandidateStage.EVALUATION_IN_PROGRESS,
                CandidateStage.EVALUATION_PASSED,
                CandidateStage.EVALUATION_FAILED,
                CandidateStage.SELECTION_FORM_SENT,
                CandidateStage.SELECTION_FORM_SUBMITTED,
                CandidateStage.SELECTION_FORM_VALIDATED,
            ])
        )
        .where(Candidate.is_removed.is_(False))
        .order_by(Candidate.updated_at.desc())
    )
    if position_id:
        candidate_query = candidate_query.where(Candidate.position_id == position_id)
    if stage:
        try:
            candidate_query = candidate_query.where(Candidate.current_stage == CandidateStage(stage))
        except ValueError:
            pass

    # A plain evaluator's worklist is limited to candidates assigned to them via an
    # Evaluation assignment; staff roles keep org-wide visibility.
    if _is_plain_evaluator(current_user):
        assigned_ids = _assigned_candidate_ids(db, current_user.id)
        if not assigned_ids:
            return []
        candidate_query = candidate_query.where(Candidate.id.in_(assigned_ids))

    candidates = list(db.scalars(candidate_query).unique())

    results = []
    for c in candidates:
        assessments_by_level: dict[int, CandidateAssessment] = {}
        for a in (c.assessments or []):
            if a.level not in assessments_by_level:
                assessments_by_level[a.level] = a
            elif (a.updated_at or a.created_at) > (assessments_by_level[a.level].updated_at or assessments_by_level[a.level].created_at):
                assessments_by_level[a.level] = a

        l1 = assessments_by_level.get(1)
        l2 = assessments_by_level.get(2)
        l3 = assessments_by_level.get(3)

        latest_eval = None
        latest_pi_round = None
        latest_pi_rounds: list[dict] = []
        for ev in sorted(c.evaluations or [], key=lambda e: e.created_at or datetime.min, reverse=True):
            if latest_eval is None:
                latest_eval = ev
            round_payloads = _serialized_pi_rounds(ev)
            if round_payloads and not latest_pi_rounds:
                latest_pi_rounds = round_payloads
                latest_pi_round = round_payloads[-1]

        def _asmt_summary(a: CandidateAssessment | None) -> dict | None:
            if a is None:
                return None
            return {
                "id": a.id,
                "status": a.status,
                "autoScore": a.auto_score,
                "evaluatorScore": a.evaluator_score,
                "totalScore": a.total_score,
                "decision": a.decision,
                "feedback": a.feedback,
                "submittedAt": a.submitted_at.isoformat() if a.submitted_at else None,
                "evaluatedAt": a.evaluated_at.isoformat() if a.evaluated_at else None,
                "evaluatorName": a.evaluator.name if a.evaluator else None,
            }

        final_decision = _resolve_final_decision(c, latest_pi_round)
        pi_scheduled_flag = bool(latest_pi_rounds)

        row = {
            "candidateId": c.id,
            "candidateCode": c.candidate_code,
            "fullName": c.full_name,
            "personalEmail": c.personal_email,
            "positionId": c.position_id,
            "positionTitle": c.position.title if c.position else None,
            "currentStage": c.current_stage.value,
            "currentStatus": c.current_status,
            "assessment1": _asmt_summary(l1),
            "assessment2": _asmt_summary(l2),
            "evalsAssessment": _asmt_summary(l3),
            "piInterview": latest_pi_round,
            "piRounds": latest_pi_rounds,
            "piScheduled": pi_scheduled_flag,
            "evaluation": {
                "id": latest_eval.id,
                "totalScore": latest_eval.total_score,
                "recommendation": latest_eval.recommendation,
                "notes": latest_eval.notes,
                "pmsScore": latest_eval.pms_score,
                "completedAt": latest_eval.completed_at.isoformat() if latest_eval.completed_at else None,
                "evaluatorName": latest_eval.evaluator.name if latest_eval.evaluator else None,
            } if latest_eval else None,
            "finalDecision": final_decision,
            "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
        }

        if pass_fail == "pass" and final_decision != "pass":
            continue
        if pass_fail == "fail" and final_decision != "fail":
            continue
        if pass_fail == "pending" and final_decision is not None:
            continue
        if pi_scheduled == "yes" and not pi_scheduled_flag:
            continue
        if pi_scheduled == "no" and pi_scheduled_flag:
            continue

        results.append(row)

    return results


@router.get("/pending")
def list_pending_for_evaluator(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_READ))],
) -> list[dict]:
    pending_query = (
        select(CandidateAssessment)
        .where(CandidateAssessment.status == "submitted")
        .order_by(CandidateAssessment.submitted_at)
    )
    # A plain evaluator only sees pending work for candidates assigned to them;
    # staff roles keep org-wide visibility.
    if _is_plain_evaluator(current_user):
        assigned_ids = _assigned_candidate_ids(db, current_user.id)
        if not assigned_ids:
            return []
        pending_query = pending_query.where(
            CandidateAssessment.candidate_id.in_(assigned_ids)
        )
    rows = db.scalars(pending_query).all()
    results = []
    for a in rows:
        d = _serialize(a)
        if a.candidate:
            d["candidateCode"] = a.candidate.candidate_code
            d["positionTitle"] = (
                a.candidate.position.title if a.candidate.position else a.candidate.position_id
            )
            d["currentStage"] = a.candidate.current_stage.value if a.candidate.current_stage else None
        results.append(d)
    return results
