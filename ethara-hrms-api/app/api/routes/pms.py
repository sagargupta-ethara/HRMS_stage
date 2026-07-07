import re
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.db.models import (
    Candidate,
    CandidateAssessment,
    EmployeeProfile,
    Evaluation,
    PmsEvaluation,
    PmsMeeting,
    Role,
    User,
    generate_id,
)
from app.services.audit import log_audit

router = APIRouter(prefix="/pms-evaluations", tags=["pms"])

# PMS scores are restricted to HR (admins retain access as superusers).
_PMS_ALLOWED_ROLES = {str(Role.HR), str(Role.ADMIN), str(Role.SUPER_ADMIN), str(Role.LEADERSHIP)}


def require_hr(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    user_roles = {str(current_user.role)} | {str(r) for r in (current_user.roles or [])}
    if not (user_roles & _PMS_ALLOWED_ROLES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="PMS is restricted to HR."
        )
    return current_user


PMS_METRICS = [
    "verbalClarity",
    "conciseness",
    "fluency",
    "vocabulary",
    "pronunciation",
    "nonverbalConfidence",
    "introBackground",
    "etharaAwareness",
    "currentAffairs",
    "instagramFamiliarity",
    "promptEngineering",
    "videoEditing",
]

COLUMN_MAP = {
    "verbalClarity": "verbal_clarity",
    "conciseness": "conciseness",
    "fluency": "fluency",
    "vocabulary": "vocabulary",
    "pronunciation": "pronunciation",
    "nonverbalConfidence": "nonverbal_confidence",
    "introBackground": "intro_background",
    "etharaAwareness": "ethara_awareness",
    "currentAffairs": "current_affairs",
    "instagramFamiliarity": "instagram_familiarity",
    "promptEngineering": "prompt_engineering",
    "videoEditing": "video_editing",
}

VALID_RATINGS = (
    "unsatisfactory",
    "needs_improvement",
    "average",
    "meets_expectations",
    "exceeds_expectations",
)


def _serialize(ev: PmsEvaluation) -> dict:
    candidate = ev.candidate
    employee = ev.employee
    evaluator = ev.evaluator
    scores = {metric: getattr(ev, COLUMN_MAP[metric]) for metric in PMS_METRICS}
    # PMS targets employees; fall back to candidate for legacy rows. Keep candidateName/
    # candidateCode populated with the subject so existing UI keeps working.
    subject_name = employee.full_name if employee else (candidate.full_name if candidate else None)
    subject_code = (
        employee.employee_code if employee else (candidate.candidate_code if candidate else None)
    )
    subject_title = (
        employee.designation
        if employee
        else (candidate.position.title if candidate and candidate.position else None)
    )
    return {
        "id": ev.id,
        "candidateId": ev.candidate_id,
        "employeeId": ev.employee_id,
        "evaluatorId": ev.evaluator_id,
        "candidateName": subject_name,
        "candidateCode": subject_code,
        "employeeName": employee.full_name if employee else None,
        "etharaId": subject_code,
        "positionTitle": subject_title,
        "evaluatorName": evaluator.name if evaluator else None,
        "scores": scores,
        "metricRemarks": ev.metric_remarks or {},
        "totalScore": ev.total_score,
        "averageScore": ev.average_score,
        "overallRating": ev.overall_rating,
        "remarks": ev.remarks,
        "submittedAt": ev.submitted_at.isoformat() if ev.submitted_at else None,
        "createdAt": ev.created_at.isoformat() if ev.created_at else None,
        "updatedAt": ev.updated_at.isoformat() if ev.updated_at else None,
    }


def _compute_totals(scores: dict[str, float | None]) -> tuple[float, float]:
    valid = [v for v in scores.values() if v is not None]
    if not valid:
        return 0.0, 0.0
    total = round(sum(valid), 4)
    avg = round(total / len(valid), 4)
    return total, avg


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _assessment_summary(assessment: CandidateAssessment) -> dict:
    return {
        "id": assessment.id,
        "level": assessment.level,
        "status": assessment.status,
        "autoScore": assessment.auto_score,
        "evaluatorScore": assessment.evaluator_score,
        "totalScore": assessment.total_score,
        "decision": assessment.decision,
        "feedback": assessment.feedback,
        "submittedAt": _iso(assessment.submitted_at),
        "evaluatedAt": _iso(assessment.evaluated_at),
        "evaluatorName": assessment.evaluator.name if assessment.evaluator else None,
    }


def _evaluation_summary(evaluation: Evaluation) -> dict:
    return {
        "id": evaluation.id,
        "totalScore": evaluation.total_score,
        "recommendation": evaluation.recommendation,
        "notes": evaluation.notes,
        "technicalSkills": evaluation.technical_skills,
        "communication": evaluation.communication,
        "problemSolving": evaluation.problem_solving,
        "culturalFit": evaluation.cultural_fit,
        "attitude": evaluation.attitude,
        "piScore": evaluation.pi_score,
        "completedAt": _iso(evaluation.completed_at),
        "interviewStatus": evaluation.interview_status,
        "interviewNotes": evaluation.interview_notes,
        "evaluatorName": evaluation.evaluator.name if evaluation.evaluator else None,
    }


class PmsScorePayload(BaseModel):
    candidate_id: str | None = Field(alias="candidateId", default=None)
    employee_id: str | None = Field(alias="employeeId", default=None)
    scores: dict[str, float | None] = Field(default_factory=dict)
    metric_remarks: dict[str, str] = Field(alias="metricRemarks", default_factory=dict)
    overall_rating: str | None = Field(alias="overallRating", default=None)
    remarks: str | None = None

    class Config:
        populate_by_name = True


@router.get("")
def list_pms_evaluations(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_hr)],
    candidate_id: str | None = Query(default=None, alias="candidateId"),
    employee_id: str | None = Query(default=None, alias="employeeId"),
) -> list[dict]:
    q = (
        select(PmsEvaluation)
        .options(
            joinedload(PmsEvaluation.candidate).joinedload(Candidate.position),
            joinedload(PmsEvaluation.employee),
            joinedload(PmsEvaluation.evaluator),
        )
        .order_by(PmsEvaluation.created_at.desc())
    )
    if candidate_id:
        q = q.where(PmsEvaluation.candidate_id == candidate_id)
    if employee_id:
        q = q.where(PmsEvaluation.employee_id == employee_id)
    return [_serialize(ev) for ev in db.scalars(q).unique()]


@router.get("/employee-report/{employee_id}")
def get_employee_performance_report(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_hr)],
) -> dict:
    profile = db.scalar(
        select(EmployeeProfile)
        .options(joinedload(EmployeeProfile.user))
        .where(EmployeeProfile.id == employee_id)
    )
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    pms_records = list(
        db.scalars(
            select(PmsEvaluation)
            .where(PmsEvaluation.employee_id == employee_id)
            .options(joinedload(PmsEvaluation.employee), joinedload(PmsEvaluation.evaluator))
            .order_by(PmsEvaluation.submitted_at.desc(), PmsEvaluation.created_at.desc())
        ).unique()
    )

    profile_emails = {
        email.strip().lower()
        for email in (profile.personal_email, profile.ethara_email)
        if email and email.strip()
    }
    conditions = []
    if profile.employee_code:
        conditions.append(Candidate.candidate_code == profile.employee_code)
    if profile.aadhaar_hash:
        conditions.append(Candidate.aadhaar_hash == profile.aadhaar_hash)
    if profile_emails:
        conditions.extend(
            [
                func.lower(func.coalesce(Candidate.personal_email, "")).in_(profile_emails),
                func.lower(func.coalesce(Candidate.ethara_email, "")).in_(profile_emails),
            ]
        )

    matched_candidates: list[Candidate] = []
    if conditions:
        candidates = list(
            db.scalars(
                select(Candidate)
                .where(or_(*conditions))
                .options(
                    joinedload(Candidate.position),
                    selectinload(Candidate.assessments).joinedload(CandidateAssessment.evaluator),
                    selectinload(Candidate.evaluations).joinedload(Evaluation.evaluator),
                )
                .order_by(Candidate.created_at.desc())
            ).unique()
        )

        def _matches(candidate: Candidate) -> bool:
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

        matched_candidates = [candidate for candidate in candidates if _matches(candidate)]

    candidate_records = []
    for candidate in matched_candidates:
        assessments_by_level: dict[int, CandidateAssessment] = {}
        for assessment in candidate.assessments or []:
            existing = assessments_by_level.get(assessment.level)
            existing_time = existing.updated_at or existing.created_at if existing else datetime.min
            assessment_time = assessment.updated_at or assessment.created_at or datetime.min
            if existing is None or assessment_time > existing_time:
                assessments_by_level[assessment.level] = assessment

        evaluations = sorted(
            candidate.evaluations or [],
            key=lambda item: item.created_at or datetime.min,
            reverse=True,
        )
        candidate_records.append(
            {
                "candidateId": candidate.id,
                "candidateCode": candidate.candidate_code,
                "fullName": candidate.full_name,
                "personalEmail": candidate.personal_email,
                "etharaEmail": candidate.ethara_email,
                "positionTitle": candidate.position.title if candidate.position else None,
                "currentStage": candidate.current_stage.value,
                "assessments": [
                    _assessment_summary(assessment)
                    for assessment in sorted(
                        assessments_by_level.values(), key=lambda item: item.level
                    )
                ],
                "evaluations": [_evaluation_summary(evaluation) for evaluation in evaluations],
            }
        )

    return {
        "employee": {
            "id": profile.id,
            "name": profile.full_name,
            "employeeCode": profile.employee_code,
            "etharaEmail": profile.ethara_email,
            "personalEmail": profile.personal_email,
            "department": profile.department,
            "designation": profile.designation,
        },
        "pmsRecords": [_serialize(record) for record in pms_records],
        "candidateRecords": candidate_records,
    }


@router.get("/{pms_id}")
def get_pms_evaluation(
    pms_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_hr)],
) -> dict:
    ev = db.scalar(
        select(PmsEvaluation)
        .options(
            joinedload(PmsEvaluation.candidate).joinedload(Candidate.position),
            joinedload(PmsEvaluation.employee),
            joinedload(PmsEvaluation.evaluator),
        )
        .where(PmsEvaluation.id == pms_id)
    )
    if ev is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PMS evaluation not found"
        )
    return _serialize(ev)


@router.post("", status_code=201)
def create_pms_evaluation(
    payload: PmsScorePayload,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_hr)],
) -> dict:
    # PMS targets employees; exactly one of employeeId / candidateId (legacy) must be set.
    if bool(payload.employee_id) == bool(payload.candidate_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide exactly one of employeeId or candidateId",
        )
    if payload.employee_id:
        if db.get(EmployeeProfile, payload.employee_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    elif db.get(Candidate, payload.candidate_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    if payload.overall_rating and payload.overall_rating not in VALID_RATINGS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"overall_rating must be one of: {', '.join(VALID_RATINGS)}",
        )

    total, avg = _compute_totals(payload.scores)
    ev_id = generate_id()
    ev = PmsEvaluation(
        id=ev_id,
        candidate_id=payload.candidate_id,
        employee_id=payload.employee_id,
        evaluator_id=current_user.id,
        metric_remarks=payload.metric_remarks or None,
        total_score=total,
        average_score=avg,
        overall_rating=payload.overall_rating,
        remarks=payload.remarks,
        submitted_at=datetime.now(UTC),
    )
    for metric in PMS_METRICS:
        col = COLUMN_MAP[metric]
        setattr(ev, col, payload.scores.get(metric))

    db.add(ev)
    db.flush()
    log_audit(
        db,
        entity_type="pms_evaluation",
        entity_id=ev.id,
        action="pms_evaluation_created",
        actor=current_user,
        request=request,
        candidate_id=payload.candidate_id,
        new_value={"totalScore": total, "overallRating": payload.overall_rating},
    )
    db.commit()
    ev = db.scalar(
        select(PmsEvaluation)
        .options(
            joinedload(PmsEvaluation.candidate).joinedload(Candidate.position),
            joinedload(PmsEvaluation.employee),
            joinedload(PmsEvaluation.evaluator),
        )
        .where(PmsEvaluation.id == ev.id)
    )
    return _serialize(ev)


@router.patch("/{pms_id}")
def update_pms_evaluation(
    pms_id: str,
    payload: PmsScorePayload,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_hr)],
) -> dict:
    ev = db.scalar(
        select(PmsEvaluation)
        .options(
            joinedload(PmsEvaluation.candidate).joinedload(Candidate.position),
            joinedload(PmsEvaluation.employee),
            joinedload(PmsEvaluation.evaluator),
        )
        .where(PmsEvaluation.id == pms_id)
    )
    if ev is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PMS evaluation not found"
        )

    if payload.overall_rating and payload.overall_rating not in VALID_RATINGS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"overall_rating must be one of: {', '.join(VALID_RATINGS)}",
        )

    for metric in PMS_METRICS:
        if metric in payload.scores:
            setattr(ev, COLUMN_MAP[metric], payload.scores[metric])

    if payload.metric_remarks:
        existing = dict(ev.metric_remarks or {})
        existing.update(payload.metric_remarks)
        ev.metric_remarks = existing

    all_scores = {metric: getattr(ev, COLUMN_MAP[metric]) for metric in PMS_METRICS}
    total, avg = _compute_totals(all_scores)
    ev.total_score = total
    ev.average_score = avg

    if payload.overall_rating is not None:
        ev.overall_rating = payload.overall_rating
    if payload.remarks is not None:
        ev.remarks = payload.remarks

    ev.submitted_at = datetime.now(UTC)
    ev.evaluator_id = current_user.id

    db.add(ev)
    log_audit(
        db,
        entity_type="pms_evaluation",
        entity_id=ev.id,
        action="pms_evaluation_updated",
        actor=current_user,
        request=request,
        candidate_id=ev.candidate_id,
        new_value={"totalScore": total, "overallRating": ev.overall_rating},
    )
    db.commit()
    ev = db.scalar(
        select(PmsEvaluation)
        .options(
            joinedload(PmsEvaluation.candidate).joinedload(Candidate.position),
            joinedload(PmsEvaluation.employee),
            joinedload(PmsEvaluation.evaluator),
        )
        .where(PmsEvaluation.id == ev.id)
    )
    return _serialize(ev)


# ─────────────────────────────────────────────────────────────────────────────
# PMS review meetings — schedule an (online) calendar invite or log an offline
# review. The organizer (the HR account scheduling) is always added to the call;
# extra attendees can be added by email. Offline meetings are recorded but send
# no invite.
# ─────────────────────────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
VALID_MEETING_MODES = {"online", "offline"}


def _employee_email(employee: EmployeeProfile | None) -> str | None:
    if employee is None:
        return None
    return employee.ethara_email or employee.personal_email


def _serialize_meeting(m: PmsMeeting) -> dict:
    organizer = m.organizer
    employee = m.employee
    return {
        "id": m.id,
        "employeeId": m.employee_id,
        "employeeName": employee.full_name if employee else None,
        "employeeEmail": _employee_email(employee),
        "organizerId": m.organizer_id,
        "organizerName": organizer.name if organizer else None,
        "organizerEmail": organizer.email if organizer else None,
        "title": m.title,
        "mode": m.mode,
        "scheduledAt": _iso(m.scheduled_at),
        "durationMinutes": m.duration_minutes,
        "location": m.location,
        "attendees": m.attendees or [],
        "inviteEmployee": m.invite_employee,
        "notes": m.notes,
        "status": m.status,
        "createdAt": _iso(m.created_at),
    }


class PmsMeetingPayload(BaseModel):
    employee_id: str = Field(alias="employeeId")
    title: str
    mode: str = "online"
    scheduled_at: datetime | None = Field(alias="scheduledAt", default=None)
    duration_minutes: int = Field(alias="durationMinutes", default=60)
    location: str | None = None
    attendees: list[str] = Field(default_factory=list)
    invite_employee: bool = Field(alias="inviteEmployee", default=True)
    notes: str | None = None

    class Config:
        populate_by_name = True


@router.get("/meetings")
def list_pms_meetings(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_hr)],
    employee_id: str | None = Query(default=None, alias="employeeId"),
) -> list[dict]:
    q = (
        select(PmsMeeting)
        .options(joinedload(PmsMeeting.employee), joinedload(PmsMeeting.organizer))
        .order_by(PmsMeeting.created_at.desc())
    )
    if employee_id:
        q = q.where(PmsMeeting.employee_id == employee_id)
    return [_serialize_meeting(m) for m in db.scalars(q).unique()]


@router.post("/meetings", status_code=201)
def create_pms_meeting(
    payload: PmsMeetingPayload,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_hr)],
) -> dict:
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Meeting title is required.",
        )

    mode = (payload.mode or "online").strip().lower()
    if mode not in VALID_MEETING_MODES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="mode must be 'online' or 'offline'.",
        )

    employee = db.get(EmployeeProfile, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    # De-duplicate and validate any extra attendee emails.
    attendees: list[str] = []
    for raw in payload.attendees or []:
        email = (raw or "").strip()
        if not email:
            continue
        if not _EMAIL_RE.match(email):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid attendee email: {email}",
            )
        if email not in attendees:
            attendees.append(email)

    scheduled_at = payload.scheduled_at
    if mode == "online" and scheduled_at is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Date & time is required to schedule an online meeting.",
        )

    duration = payload.duration_minutes if payload.duration_minutes and payload.duration_minutes > 0 else 60
    location = (payload.location or "").strip() or None
    # Online meeting: if no link was pasted, auto-generate a Google Meet link via the
    # service account. Falls back to requiring a manual link if generation isn't set up.
    if mode == "online" and not location and scheduled_at is not None:
        from app.services.google_calendar import create_meet_event

        location = create_meet_event(
            organizer_email=current_user.email,
            title=title,
            scheduled_at=scheduled_at,
            duration_minutes=duration,
        )
    if mode == "online" and not location:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not auto-generate a meeting link — please paste a Meet/Zoom link.",
        )
    notes = (payload.notes or "").strip() or None

    meeting = PmsMeeting(
        id=generate_id(),
        employee_id=employee.id,
        organizer_id=current_user.id,
        title=title,
        mode=mode,
        scheduled_at=scheduled_at,
        duration_minutes=duration,
        location=location,
        attendees=attendees or None,
        invite_employee=payload.invite_employee,
        notes=notes,
        status="scheduled",
    )
    db.add(meeting)
    db.flush()

    # Only online meetings send a calendar invite; offline reviews are just logged.
    notified: list[str] = []
    if mode == "online" and scheduled_at is not None:
        from app.services.workflows import send_pms_meeting_invites

        notified = send_pms_meeting_invites(
            meeting_id=meeting.id,
            title=title,
            scheduled_at=scheduled_at,
            duration_minutes=duration,
            location=location,
            notes=notes,
            organizer=current_user,
            employee_name=employee.full_name,
            employee_email=_employee_email(employee),
            invite_employee=payload.invite_employee,
            extra_attendees=attendees,
        )

    log_audit(
        db,
        entity_type="pms_meeting",
        entity_id=meeting.id,
        action="pms_meeting_scheduled",
        actor=current_user,
        request=request,
        new_value={"mode": mode, "title": title, "notified": notified},
    )
    db.commit()

    meeting = db.scalar(
        select(PmsMeeting)
        .options(joinedload(PmsMeeting.employee), joinedload(PmsMeeting.organizer))
        .where(PmsMeeting.id == meeting.id)
    )
    result = _serialize_meeting(meeting)
    result["notifiedEmails"] = notified
    return result


@router.delete("/meetings/{meeting_id}", status_code=204)
def delete_pms_meeting(
    meeting_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_hr)],
) -> None:
    meeting = db.get(PmsMeeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    log_audit(
        db,
        entity_type="pms_meeting",
        entity_id=meeting.id,
        action="pms_meeting_deleted",
        actor=current_user,
        request=request,
        old_value={"title": meeting.title, "mode": meeting.mode},
    )
    db.delete(meeting)
    db.commit()
