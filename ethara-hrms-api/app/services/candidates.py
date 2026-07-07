from __future__ import annotations

import logging
from datetime import UTC, datetime
from secrets import token_hex, token_urlsafe
from urllib.parse import quote

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.config import get_settings
from app.core.security import fingerprint_identifier, hash_password
from app.db.models import (
    AuthCode,
    Candidate,
    CandidateStage,
    CandidateIdCardForm,
    Evaluation,
    EmployeeImportStaging,
    EmployeeProfile,
    PiInterviewRound,
    Position,
    Role,
    SourceType,
    StageLog,
    User,
)
from app.services.audit import log_audit
from app.services.integrations import EmailService
from app.services.workflows import apply_stage_side_effects, stage_bucket, stage_to_status

logger = logging.getLogger(__name__)


def generate_candidate_code(now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    return f"ETH-{now.strftime('%b').upper()}{now.strftime('%y')}-{token_hex(3).upper()}"


def _referral_owner_identifiers(user: User) -> list[str]:
    """Identifiers a referral's `source_id` may have been stamped with for THIS
    referrer (the new-candidate form stores the referrer's lowercased email;
    fall back to the user id). Must stay in sync with the referral-matching set
    in employees._candidate_referral_matches."""
    identifiers = [user.id]
    if user.email:
        identifiers.append(user.email.strip().lower())
    return identifiers


def _role_value(value: Role | str) -> str:
    return value.value if isinstance(value, Role) else str(value)


def _user_role_values(user: User) -> set[str]:
    return {_role_value(user.role)} | {_role_value(role) for role in (user.roles or [])}


def _has_any_role(user: User, roles: set[Role]) -> bool:
    allowed = {_role_value(role) for role in roles}
    return bool(_user_role_values(user) & allowed)


_CANDIDATE_FULL_ACCESS_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}


def build_candidate_access_scope(user: User):
    if _has_any_role(user, _CANDIDATE_FULL_ACCESS_ROLES):
        return None
    if _has_any_role(user, {Role.VENDOR}):
        if not user.vendor_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Vendor account is not linked to a vendor profile.",
            )
        return and_(
            Candidate.source_type == SourceType.VENDOR,
            Candidate.vendor_id == user.vendor_id,
        )
    # Employee referrers hold CANDIDATES_READ/WRITE so they can submit referrals,
    # but they must only see/act on candidates THEY referred — not the whole org.
    if _has_any_role(user, {Role.EMPLOYEE_REFERRER}):
        return and_(
            Candidate.source_type == SourceType.EMPLOYEE_REFERRAL,
            Candidate.source_id.in_(_referral_owner_identifiers(user)),
        )
    return None


def _stage_filter_values(stage: str | None) -> list[CandidateStage]:
    if not stage:
        return []
    values: list[CandidateStage] = []
    for raw in stage.split(","):
        candidate_stage = raw.strip()
        if not candidate_stage:
            continue
        try:
            values.append(CandidateStage(candidate_stage))
        except ValueError:
            continue
    return values


def _blacklisted_candidate_condition():
    return or_(
        Candidate.is_reapplication_blocked.is_(True),
        Candidate.current_status == "Blacklisted",
    )


def enforce_candidate_access(*, candidate: Candidate, user: User) -> Candidate:
    scope = build_candidate_access_scope(user)
    if scope is None:
        return candidate
    if _has_any_role(user, {Role.VENDOR}):
        if candidate.source_type != SourceType.VENDOR or candidate.vendor_id != user.vendor_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        return candidate
    if _has_any_role(user, {Role.EMPLOYEE_REFERRER}):
        if (
            candidate.source_type != SourceType.EMPLOYEE_REFERRAL
            or candidate.source_id not in _referral_owner_identifiers(user)
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        return candidate
    return candidate


def get_candidate_or_404(db: Session, candidate_id: str, *, current_user: User | None = None) -> Candidate:
    candidate = db.scalar(
        select(Candidate)
        .options(
            joinedload(Candidate.position),
            joinedload(Candidate.college),
            joinedload(Candidate.vendor),
            selectinload(Candidate.stage_logs),
            selectinload(Candidate.documents),
            selectinload(Candidate.compliance_forms),
            selectinload(Candidate.escalations),
            selectinload(Candidate.notifications),
            selectinload(Candidate.audit_logs),
            selectinload(Candidate.evaluations).joinedload(Evaluation.evaluator),
            selectinload(Candidate.evaluations).selectinload(Evaluation.pi_rounds).joinedload(PiInterviewRound.evaluator),
            joinedload(Candidate.contract),
            joinedload(Candidate.it_request),
            joinedload(Candidate.selection_form),
        )
        .where(Candidate.id == candidate_id)
    )
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    if current_user is not None:
        enforce_candidate_access(candidate=candidate, user=current_user)
    return candidate


def _generate_vendor_candidate_temp_password() -> str:
    return f"Et#{token_urlsafe(10)}1"


def _candidate_login_url(email: str) -> str:
    settings = get_settings()
    return f"{settings.frontend_url.rstrip('/')}/login?email={quote(email)}"


def _send_candidate_portal_email(
    *,
    candidate_name: str,
    personal_email: str,
    position_title: str,
    temporary_password: str | None,
) -> None:
    login_url = _candidate_login_url(personal_email)
    if temporary_password:
        subject = "Your Ethara candidate portal credentials are ready"
        body_text = (
            f"Hi {candidate_name},\n\n"
            f"Your profile has been submitted to Ethara for the role of {position_title}.\n\n"
            "You can log in to the Ethara candidate portal using these demo credentials:\n"
            f"Login email: {personal_email}\n"
            f"Demo password: {temporary_password}\n"
            f"Portal login: {login_url}\n\n"
            "You can change this password after you log in to the portal.\n"
            "If you did not expect this submission, please ignore this email.\n"
        )
        body_html = (
            f"<p>Hi {candidate_name},</p>"
            f"<p>Your profile has been submitted to <strong>Ethara</strong> for the role of <strong>{position_title}</strong>.</p>"
            "<p>You can log in to the Ethara candidate portal using these demo credentials:</p>"
            f"<p><strong>Login email:</strong> {personal_email}<br />"
            f"<strong>Demo password:</strong> {temporary_password}</p>"
            f"<p><a href=\"{login_url}\">Sign in to your Ethara candidate portal</a></p>"
            "<p>You can change this password after you log in to the portal.</p>"
        )
    else:
        subject = "Your Ethara candidate portal submission is live"
        body_text = (
            f"Hi {candidate_name},\n\n"
            f"Your profile has been submitted to Ethara for the role of {position_title}.\n\n"
            "We found that you already have an Ethara candidate portal account.\n"
            f"Login email: {personal_email}\n"
            f"Portal login: {login_url}\n\n"
            "You can sign in with your existing password. If needed, use Forgot password on the login page to reset it.\n"
        )
        body_html = (
            f"<p>Hi {candidate_name},</p>"
            f"<p>Your profile has been submitted to <strong>Ethara</strong> for the role of <strong>{position_title}</strong>.</p>"
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


def create_candidate(db: Session, *, payload: dict, actor: User | None, request=None) -> Candidate:
    email = payload["personal_email"].strip().lower()
    aadhaar_number = payload.pop("aadhaar_number", None)
    portal_password = payload.pop("portal_password", None)
    actor_role_values = _user_role_values(actor) if actor is not None else set()
    vendor_portal_submission = actor is not None and Role.VENDOR.value in actor_role_values
    # HR/recruiter/admin adding a candidate from the candidates tab. Like vendor
    # submissions, these candidates are provisioned a portal login and emailed
    # their credentials so they can sign in immediately.
    staff_portal_submission = (
        actor is not None
        and not vendor_portal_submission
        and bool(actor_role_values - {Role.VENDOR.value, Role.CANDIDATE.value})
    )
    portal_submission = vendor_portal_submission or staff_portal_submission
    existing_portal_user = db.scalar(
        select(User).where(func.lower(func.trim(User.email)) == email)
    )
    if (
        portal_submission
        and existing_portal_user is not None
        and not _has_any_role(existing_portal_user, {Role.CANDIDATE})
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already linked to a non-candidate account.",
        )
    created_portal_password: str | None = None
    if portal_submission and existing_portal_user is None:
        portal_password = portal_password or _generate_vendor_candidate_temp_password()
        created_portal_password = portal_password
    aadhaar_hash = fingerprint_identifier(aadhaar_number) if aadhaar_number else None
    aadhaar_last4 = (aadhaar_number or payload.get("aadhaar_last4") or "")[-4:] or None
    duplicate_filters = [func.lower(Candidate.personal_email) == email]
    if aadhaar_hash:
        duplicate_filters.append(Candidate.aadhaar_hash == aadhaar_hash)
    existing = db.scalar(
        select(Candidate)
        .where(or_(*duplicate_filters))
        .where(Candidate.current_status != "Removed")  # removed candidates can re-register
        .order_by(Candidate.created_at.desc())
    )

    # The reapplication block must be evaluated across ALL records — including soft-removed
    # ones — so that deleting a blocked candidate's record cannot be used to wipe the block.
    blocked = db.scalar(
        select(Candidate.id)
        .where(or_(*duplicate_filters))
        .where(Candidate.is_reapplication_blocked.is_(True))
        .limit(1)
    )
    if blocked or (existing and existing.is_reapplication_blocked):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This candidate is blocked from reapplication.",
        )

    # Public self-registration should fail fast with a useful message instead of
    # bubbling up a database integrity error on duplicate Aadhaar submissions.
    if existing and actor is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A candidate with this email or Aadhaar number already exists.",
        )

    candidate_payload = payload.copy()
    if vendor_portal_submission:
        if not actor.vendor_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Vendor account is not linked to a vendor profile.",
            )
        candidate_payload["source_type"] = SourceType.VENDOR
        candidate_payload["vendor_id"] = actor.vendor_id
    if candidate_payload.get("source_type") == SourceType.VENDOR and not candidate_payload.get("vendor_id"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Vendor candidates must be tagged to a vendor.",
        )
    candidate_payload["personal_email"] = email
    candidate_payload["aadhaar_hash"] = aadhaar_hash
    candidate_payload["aadhaar_last4"] = aadhaar_last4
    candidate_payload["candidate_code"] = generate_candidate_code()
    candidate_payload["is_duplicate"] = bool(existing)
    candidate_payload["duplicate_reason"] = (
        f"Duplicate of {existing.candidate_code}" if existing else None
    )
    candidate_payload["last_applied_at"] = datetime.now(UTC)
    candidate_payload["current_status"] = stage_to_status(CandidateStage.NEW_APPLICATION)

    candidate = Candidate(**candidate_payload)
    db.add(candidate)
    db.flush()
    user = ensure_candidate_user(db, candidate=candidate, password=portal_password)
    if portal_submission:
        user.name = candidate.full_name
        user.phone = candidate.phone
        if not user.email_verified_at:
            user.email_verified_at = datetime.now(UTC)
        if created_portal_password:
            user.must_change_password = True
        db.add(user)
    candidate.portal_user_id = user.id
    db.add(candidate)
    if portal_submission:
        position_title = "the selected role"
        if candidate.position_id:
            position = db.get(Position, candidate.position_id)
            if position is not None and position.title:
                position_title = position.title
        try:
            _send_candidate_portal_email(
                candidate_name=candidate.full_name,
                personal_email=user.email,
                position_title=position_title,
                temporary_password=created_portal_password,
            )
        except RuntimeError as exc:
            # Vendor portal submissions treat a failed credential email as fatal
            # (the vendor relies on the candidate getting access). For internal
            # staff additions we don't want a transient email/SES problem to block
            # the candidate from being created — log it and continue instead.
            if vendor_portal_submission:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=str(exc),
                ) from exc
            logger.warning(
                "Could not email portal credentials to candidate %s (%s): %s",
                candidate.candidate_code,
                user.email,
                exc,
            )
    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate.id,
        action="candidate_created",
        actor=actor,
        request=request,
        candidate_id=candidate.id,
        new_value={
            "candidateCode": candidate.candidate_code,
            "isDuplicate": candidate.is_duplicate,
        },
    )
    return candidate


def ensure_candidate_user(db: Session, *, candidate: Candidate, password: str | None = None) -> User:
    email = candidate.personal_email.strip().lower()
    existing = db.scalar(select(User).where(func.lower(func.trim(User.email)) == email))
    if existing:
        existing_roles = existing.roles or []
        if existing.role == Role.CANDIDATE and Role.CANDIDATE.value not in existing_roles:
            existing.roles = [*(existing.roles or []), Role.CANDIDATE.value]
            db.add(existing)
        if not candidate.portal_user_id:
            candidate.portal_user_id = existing.id
            db.add(candidate)
        return existing
    temp_password = password or token_urlsafe(16)
    user = User(
        email=email,
        password_hash=hash_password(temp_password),
        name=candidate.full_name,
        phone=candidate.phone,
        role=Role.CANDIDATE,
        roles=[Role.CANDIDATE.value],
        is_active=True,
    )
    db.add(user)
    db.flush()
    candidate.portal_user_id = user.id
    db.add(candidate)
    return user


# ───────────────────────────── campus drive ──────────────────────────────────


def create_campus_candidate(
    db: Session,
    *,
    full_name: str,
    personal_email: str,
    phone: str,
    password: str,
    college_id: str | None = None,
    position_id: str | None = None,
    source_id: str | None = None,
    request=None,
) -> Candidate:
    """Lightweight campus registration — no Aadhaar/resume/experience/OCR/screening.
    Tagged campus_hire (= Direct hire + campus); portal account is auto-verified so
    they go straight to the assessment page."""
    email = personal_email.strip().lower()
    existing_user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == email))
    if existing_user is not None and not _has_any_role(existing_user, {Role.CANDIDATE}):
        raise HTTPException(
            status_code=409,
            detail="This email is already linked to a non-candidate account.",
        )
    existing = db.scalar(
        select(Candidate).where(
            func.lower(Candidate.personal_email) == email, Candidate.current_status != "Removed"
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="A candidate with this email already exists.")

    candidate = Candidate(
        candidate_code=generate_candidate_code(),
        full_name=full_name.strip(),
        personal_email=email,
        phone=phone.strip(),
        source_type=SourceType.CAMPUS_HIRE,
        source_id=source_id,
        college_id=college_id,
        position_id=position_id,
        current_stage=CandidateStage.NEW_APPLICATION,
        current_status="Campus Drive — Assessment Pending",
        last_applied_at=datetime.now(UTC),
    )
    db.add(candidate)
    db.flush()
    user = ensure_candidate_user(db, candidate=candidate, password=password)
    user.name = candidate.full_name
    user.phone = candidate.phone
    user.email_verified_at = user.email_verified_at or datetime.now(UTC)
    db.add(user)
    candidate.portal_user_id = user.id
    db.add(candidate)
    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate.id,
        action="campus_registered",
        actor=None,
        request=request,
        candidate_id=candidate.id,
        new_value={"candidateCode": candidate.candidate_code, "source": "campus_hire"},
    )
    return candidate


def get_campus_candidate_for_user(db: Session, user: User) -> Candidate | None:
    return db.scalar(
        select(Candidate).where(
            Candidate.portal_user_id == user.id,
            Candidate.source_type == SourceType.CAMPUS_HIRE,
            Candidate.current_status != "Removed",
        )
    )


def complete_campus_candidate(
    db: Session, *, candidate: Candidate, fields: dict, request=None
) -> Candidate:
    """Upgrade a campus candidate to a full record (Aadhaar/resume/experience filled
    by the normal pipeline). The campus assessment is already done, so they jump to
    EVALUATION_PASSED and continue the normal flow."""
    for key, value in fields.items():
        setattr(candidate, key, value)
    candidate.current_stage = CandidateStage.EVALUATION_PASSED
    candidate.current_status = stage_to_status(CandidateStage.EVALUATION_PASSED)
    candidate.last_applied_at = datetime.now(UTC)
    db.add(candidate)
    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate.id,
        action="campus_completed",
        actor=None,
        request=request,
        candidate_id=candidate.id,
    )
    return candidate


def notify_campus_pass(db: Session, *, user_id: str) -> None:
    """On a released PASS, email the campus candidate a link to finish full registration."""
    candidate = db.scalar(
        select(Candidate).where(
            Candidate.portal_user_id == user_id, Candidate.source_type == SourceType.CAMPUS_HIRE
        )
    )
    if candidate is None or candidate.resume_url:  # missing candidate or already completed
        return
    settings = get_settings()
    link = f"{settings.frontend_url.rstrip('/')}/candidate/complete-registration"
    login_url = _candidate_login_url(candidate.personal_email)
    try:
        EmailService().send_email(
            to_email=candidate.personal_email,
            subject="You're through — complete your Ethara registration",
            body_text=(
                f"Hi {candidate.full_name},\n\n"
                "Congratulations — you've cleared the campus assessment! "
                "Complete your registration to continue the process:\n"
                f"{link}\n\n"
                f"Sign in with your existing portal credentials: {login_url}\n"
            ),
            body_html=(
                f"<p>Hi {candidate.full_name},</p>"
                "<p>Congratulations — you've cleared the campus assessment! "
                "Complete your registration to continue:</p>"
                f"<p><a href=\"{link}\">Complete my registration</a></p>"
                "<p>Sign in with your existing portal credentials: "
                f"<a href=\"{login_url}\">{login_url}</a></p>"
            ),
        )
    except Exception:  # noqa: BLE001 — email is best-effort
        logger.warning("Could not email campus-pass notice to %s", candidate.personal_email)


def list_candidates(
    db: Session,
    *,
    current_user: User | None = None,
    search: str | None = None,
    source_type: str | None = None,
    stage: str | None = None,
    position_id: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    blacklisted: bool | None = None,
    page: int = 1,
    limit: int = 20,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
) -> tuple[list[Candidate], int]:
    query = select(Candidate).options(
        joinedload(Candidate.position),
        joinedload(Candidate.college),
        joinedload(Candidate.vendor),
        joinedload(Candidate.contract),
    )
    count_query = select(func.count()).select_from(Candidate)
    # Hide soft-deleted (removed) candidates from active lists. Blacklisted
    # candidates are also hidden by default and shown only by the explicit
    # blacklist view, so they cannot leak into contracts or other stage tabs.
    query = query.where(Candidate.is_removed.is_(False))
    count_query = count_query.where(Candidate.is_removed.is_(False))
    blacklist_condition = _blacklisted_candidate_condition()
    if blacklisted is True:
        query = query.where(blacklist_condition)
        count_query = count_query.where(blacklist_condition)
    else:
        query = query.where(~blacklist_condition)
        count_query = count_query.where(~blacklist_condition)
    vendor_scope = build_candidate_access_scope(current_user) if current_user is not None else None
    if vendor_scope is not None:
        query = query.where(vendor_scope)
        count_query = count_query.where(vendor_scope)

    if search:
        term = f"%{search.lower()}%"
        condition = or_(
            func.lower(Candidate.full_name).like(term),
            func.lower(Candidate.personal_email).like(term),
            func.lower(Candidate.candidate_code).like(term),
            func.lower(func.coalesce(Candidate.employee_code, "")).like(term),
        )
        query = query.where(condition)
        count_query = count_query.where(condition)
    if source_type:
        query = query.where(Candidate.source_type == source_type)
        count_query = count_query.where(Candidate.source_type == source_type)
    stage_values = _stage_filter_values(stage)
    if stage_values:
        query = query.where(Candidate.current_stage.in_(stage_values))
        count_query = count_query.where(Candidate.current_stage.in_(stage_values))
    if position_id:
        query = query.where(Candidate.position_id == position_id)
        count_query = count_query.where(Candidate.position_id == position_id)
    if created_from:
        query = query.where(Candidate.created_at >= created_from)
        count_query = count_query.where(Candidate.created_at >= created_from)
    if created_to:
        query = query.where(Candidate.created_at <= created_to)
        count_query = count_query.where(Candidate.created_at <= created_to)

    sort_column = {
        "createdAt": Candidate.created_at,
        "created_at": Candidate.created_at,
        "fullName": Candidate.full_name,
        "full_name": Candidate.full_name,
        "priorityScore": Candidate.priority_score,
        "priority_score": Candidate.priority_score,
    }.get(sort_by, Candidate.created_at)
    query = query.order_by(sort_column.asc() if sort_dir == "asc" else sort_column.desc())

    total = db.scalar(count_query) or 0
    items = list(db.scalars(query.offset((page - 1) * limit).limit(limit)))
    return items, total


# Pipeline-controlled fields that only recruiting staff may change via PATCH. Stops a
# vendor (who holds CANDIDATES_WRITE for their own candidates) from self-advancing a
# stage, inflating scores, or re-tagging the source/vendor.
_PRIVILEGED_CANDIDATE_FIELDS = frozenset({
    "current_stage", "current_status", "priority_score", "resume_score", "resume_summary",
    "source_type", "vendor_id", "is_reapplication_blocked", "is_duplicate", "is_removed",
    "duplicate_reason", "employee_code",
})
_PIPELINE_STAFF_ROLES = frozenset({Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP, Role.HR, Role.TA})
_REQUIRED_PROFILE_FIELDS = {
    "full_name": "Full name is required.",
    "personal_email": "Personal email is required.",
    "phone": "Phone number is required.",
}


def _normalize_candidate_update_payload(payload: dict) -> dict:
    normalized = payload.copy()
    for field, message in _REQUIRED_PROFILE_FIELDS.items():
        if field not in normalized:
            continue
        value = normalized[field]
        if value is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message)
        normalized_value = str(value).strip()
        if not normalized_value:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message)
        normalized[field] = normalized_value
    for field in ("personal_email", "ethara_email"):
        if field in normalized and normalized[field] is not None:
            normalized[field] = str(normalized[field]).strip().lower()
    if "employee_code" in normalized:
        raw_code = normalized["employee_code"]
        normalized["employee_code"] = (
            str(raw_code).strip().upper() if raw_code is not None and str(raw_code).strip() else None
        )
    return normalized


def _assert_candidate_employee_code_available(
    db: Session,
    *,
    candidate: Candidate,
    employee_code: str | None,
) -> None:
    if not employee_code or employee_code == candidate.employee_code:
        return

    existing_candidate = db.scalar(
        select(Candidate.id)
        .where(func.upper(Candidate.employee_code) == employee_code)
        .where(Candidate.id != candidate.id)
        .limit(1)
    )
    if existing_candidate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This employee code is already assigned to another candidate.",
        )

    for column in (
        EmployeeProfile.employee_code,
        EmployeeImportStaging.employee_code,
    ):
        if db.scalar(select(column).where(func.upper(column) == employee_code).limit(1)) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This employee code is already in use.",
            )

    existing_id_card = db.scalar(
        select(CandidateIdCardForm.id)
        .where(func.upper(CandidateIdCardForm.employee_id) == employee_code)
        .where(CandidateIdCardForm.candidate_id != candidate.id)
        .limit(1)
    )
    if existing_id_card is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This employee code is already in use.",
        )


def _sync_candidate_portal_user(db: Session, *, candidate: Candidate, payload: dict) -> None:
    if not candidate.portal_user_id:
        return
    user = db.get(User, candidate.portal_user_id)
    if user is None:
        return
    if user.role != Role.CANDIDATE and Role.CANDIDATE.value not in (user.roles or []):
        return
    if "personal_email" in payload:
        next_email = payload.get("personal_email")
        if next_email:
            existing = db.scalar(
                select(User).where(
                    func.lower(func.trim(User.email)) == next_email,
                    User.id != user.id,
                )
            )
            if existing is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This email is already linked to another account.",
                )
            user.email = next_email
    if "full_name" in payload and payload["full_name"]:
        user.name = payload["full_name"]
    if "phone" in payload:
        user.phone = payload["phone"]
    db.add(user)


def update_candidate(
    db: Session, *, candidate: Candidate, payload: dict, actor: User | None, request=None
) -> Candidate:
    payload = _normalize_candidate_update_payload(payload)
    if actor is not None and not _has_any_role(actor, set(_PIPELINE_STAFF_ROLES)):
        payload = {k: v for k, v in payload.items() if k not in _PRIVILEGED_CANDIDATE_FIELDS}
    if payload.get("current_status") == "Blacklisted":
        payload["is_reapplication_blocked"] = True
    if payload.get("is_reapplication_blocked") is True and not payload.get("current_status"):
        payload["current_status"] = "Blacklisted"
    if payload.get("is_reapplication_blocked") is False and (
        candidate.current_status == "Blacklisted" or payload.get("current_status") == "Blacklisted"
    ):
        payload["current_status"] = stage_to_status(candidate.current_stage)
    if "employee_code" in payload:
        _assert_candidate_employee_code_available(
            db,
            candidate=candidate,
            employee_code=payload["employee_code"],
        )
    _sync_candidate_portal_user(db, candidate=candidate, payload=payload)
    old_values = {field: getattr(candidate, field) for field in payload}
    for field, value in payload.items():
        setattr(candidate, field, value)
    # Keep the linked employee profile (and every code-keyed module) in lock-step when a
    # candidate's employee code is edited — otherwise candidate and employee silently drift.
    if "employee_code" in payload and old_values.get("employee_code") != candidate.employee_code:
        from app.services import employees as employee_service

        employee_service.sync_employee_code_from_candidate(
            db,
            candidate=candidate,
            old_code=old_values.get("employee_code"),
            new_code=candidate.employee_code,
            actor=actor,
            request=request,
        )
    if "current_stage" in payload and candidate.current_stage:
        candidate.current_status = stage_to_status(candidate.current_stage)
        apply_stage_side_effects(db, candidate, actor=actor)
    if candidate.is_reapplication_blocked:
        candidate.current_status = "Blacklisted"
    db.add(candidate)
    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate.id,
        action="candidate_updated",
        actor=actor,
        request=request,
        candidate_id=candidate.id,
        old_value=jsonable_encoder(old_values),
        new_value=jsonable_encoder(payload),
    )
    return candidate


def backfill_signed_candidate_employee_codes(db: Session, *, actor: User | None, request=None) -> list[Candidate]:
    """Assign missing employee codes for candidates whose contracts are already signed."""
    from app.db.models import Contract, ContractStatus
    from app.services.employees import assign_candidate_employee_code

    candidates = list(
        db.scalars(
            select(Candidate)
            .join(Contract, Contract.candidate_id == Candidate.id)
            .where(Contract.status == ContractStatus.SIGNED)
            .where(Candidate.employee_code.is_(None))
            .order_by(Contract.signed_at.asc().nullslast(), Candidate.created_at.asc())
        )
    )
    for candidate in candidates:
        code = assign_candidate_employee_code(db, candidate)
        log_audit(
            db,
            entity_type="candidate",
            entity_id=candidate.id,
            action="employee_code_backfilled",
            actor=actor,
            request=request,
            candidate_id=candidate.id,
            new_value={"employeeCode": code},
        )
    return candidates


# Pipeline bucket ordering/gating uses stage_bucket() from app.services.workflows, the single
# source of truth for the milestone buckets. A non-privileged actor may move within the current
# bucket or advance by at most ONE bucket — never skip ahead.
_STAGE_OVERRIDE_ROLES = {str(Role.SUPER_ADMIN), str(Role.ADMIN), str(Role.LEADERSHIP), str(Role.HR)}


def _actor_can_override_stage(actor: User) -> bool:
    roles: set[str] = set()
    if getattr(actor, "role", None) is not None:
        roles.add(str(actor.role))
    for r in (getattr(actor, "roles", None) or []):
        roles.add(str(r))
    return bool(roles & _STAGE_OVERRIDE_ROLES)


def _assert_stage_transition_allowed(*, current: CandidateStage, to: CandidateStage, actor: User) -> None:
    """Enforce sequential bucket progression unless the actor is Admin/HR (override)."""
    if current == to or _actor_can_override_stage(actor):
        return
    cur_b = stage_bucket(current)
    to_b = stage_bucket(to)
    # Unknown stage → don't block; otherwise allow same/earlier bucket or one bucket forward.
    if cur_b is None or to_b is None or to_b <= cur_b + 1:
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "Stages must be completed in order — a candidate cannot skip ahead. "
            "Complete the current stage first (Admin/HR can override)."
        ),
    )


def soft_delete_candidate(
    db: Session,
    *,
    candidate: Candidate,
    actor: User,
    request=None,
) -> Candidate:
    """Soft-delete: hide from active lists but keep the record. Removal does NOT block
    reapplication — the person can register again later (use Blacklist to block)."""
    previous_status = candidate.current_status
    portal_user = db.get(User, candidate.portal_user_id) if candidate.portal_user_id else None
    released_email: str | None = None
    candidate.current_status = "Removed"
    candidate.is_removed = True
    # Free the unique Aadhaar so the same person can register again later — BUT keep it for
    # reapplication-blocked candidates, otherwise removing the record would silently wipe the
    # block and let a blocked person re-register with a fresh clean record.
    if not candidate.is_reapplication_blocked:
        candidate.aadhaar_hash = None
    if portal_user and _user_role_values(portal_user) == {Role.CANDIDATE.value}:
        old_email = portal_user.email
        released_email = old_email
        replacement_email = f"deleted+{candidate.id[:8]}+{portal_user.id[:8]}@deleted.local"
        while db.scalar(select(User.id).where(func.lower(User.email) == replacement_email.lower())):
            replacement_email = f"deleted+{candidate.id[:8]}+{token_hex(3)}@deleted.local"
        now = datetime.now(UTC)
        candidate.portal_user_id = None
        portal_user.email = replacement_email
        portal_user.is_active = False
        portal_user.refresh_token_hash = None
        portal_user.token_version = (portal_user.token_version or 0) + 1
        portal_user.email_verified_at = None
        portal_user.must_change_password = True
        for auth_code in db.scalars(
            select(AuthCode).where(AuthCode.user_id == portal_user.id, AuthCode.consumed_at.is_(None))
        ):
            auth_code.consumed_at = now
            db.add(auth_code)
        db.add(portal_user)
    db.add(candidate)
    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate.id,
        action="candidate_removed",
        actor=actor,
        request=request,
        candidate_id=candidate.id,
        old_value={"status": previous_status},
        new_value={"status": "Removed", "portalAccount": "released" if released_email else "unchanged"},
    )
    return candidate


def advance_stage(
    db: Session,
    *,
    candidate: Candidate,
    to_stage: CandidateStage,
    notes: str | None,
    actor: User,
    request=None,
) -> Candidate:
    if candidate.is_reapplication_blocked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Blacklisted candidates cannot be advanced. Remove them from the blacklist first.",
        )
    previous_stage = candidate.current_stage
    _assert_stage_transition_allowed(current=previous_stage, to=to_stage, actor=actor)
    # Reaching ONBOARDING_COMPLETED mints an employee account + login credentials. A
    # non-override actor (e.g. a recruiter) must not jump a candidate there unless the
    # statutory compliance forms are genuinely all signed — otherwise it's a credential-
    # issuance bypass. The legitimate candidate-side completion sets this stage directly
    # (not via this path), so this guard does not affect it. Admin/HR may still override.
    if (
        to_stage == CandidateStage.ONBOARDING_COMPLETED
        and previous_stage != CandidateStage.ONBOARDING_COMPLETED
        and not _actor_can_override_stage(actor)
    ):
        forms = candidate.compliance_forms or []
        if not (forms and all((f.status or "").lower() == "signed" for f in forms)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Onboarding can only be marked complete after all statutory compliance "
                    "forms are signed."
                ),
            )
    candidate.current_stage = to_stage
    candidate.current_status = stage_to_status(to_stage)
    db.add(candidate)
    db.flush()
    db.add(
        StageLog(
            candidate_id=candidate.id,
            from_stage=previous_stage,
            to_stage=to_stage,
            changed_by=actor.id,
            changed_by_name=actor.name,
            notes=notes,
        )
    )
    apply_stage_side_effects(db, candidate, actor=actor)
    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate.id,
        action=f"stage_advanced:{previous_stage.value}->{to_stage.value}",
        actor=actor,
        request=request,
        candidate_id=candidate.id,
        old_value={"stage": previous_stage.value},
        new_value={"stage": to_stage.value, "notes": notes},
    )
    return candidate


def get_pipeline_stats(
    db: Session,
    *,
    current_user: User | None = None,
) -> dict:
    month_start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Exclude soft-deleted and blacklisted candidates so stats match the active list view.
    active_candidate_filter = and_(
        Candidate.is_removed.is_(False),
        ~_blacklisted_candidate_condition(),
    )
    stage_query = (
        select(Candidate.current_stage, func.count())
        .where(active_candidate_filter)
        .group_by(Candidate.current_stage)
    )
    total_query = select(func.count()).select_from(Candidate).where(active_candidate_filter)
    month_query = (
        select(func.count())
        .select_from(Candidate)
        .where(active_candidate_filter)
        .where(Candidate.created_at >= month_start)
    )
    vendor_scope = build_candidate_access_scope(current_user) if current_user is not None else None
    if vendor_scope is not None:
        stage_query = stage_query.where(vendor_scope)
        total_query = total_query.where(vendor_scope)
        month_query = month_query.where(vendor_scope)
    stages = [
        {"currentStage": stage, "_count": count}
        for stage, count in db.execute(stage_query).all()
    ]
    total = db.scalar(total_query) or 0
    this_month = db.scalar(month_query) or 0
    return {"stages": stages, "total": total, "this_month": this_month}


def list_portal_candidates(db: Session, *, user: User) -> list[Candidate]:
    email = user.email.strip().lower()
    return list(
        db.scalars(
            select(Candidate)
            .options(joinedload(Candidate.position), joinedload(Candidate.college))
            .where(
                or_(
                    Candidate.portal_user_id == user.id,
                    func.lower(Candidate.personal_email) == email,
                )
            )
            .order_by(Candidate.created_at.desc())
        )
    )


def get_latest_portal_candidate(db: Session, *, user: User) -> Candidate | None:
    candidates = list_portal_candidates(db, user=user)
    if not candidates:
        return None
    latest = candidates[0]
    if latest.portal_user_id != user.id:
        latest.portal_user_id = user.id
        db.add(latest)
    return latest


def get_portal_candidate_detail(db: Session, *, user: User) -> Candidate | None:
    latest = get_latest_portal_candidate(db, user=user)
    if latest is None:
        return None
    return get_candidate_or_404(db, latest.id)


def update_portal_profile(db: Session, *, user: User, payload: dict) -> Candidate:
    candidate = get_latest_portal_candidate(db, user=user)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate profile not found")

    allowed_fields = {
        "full_name",
        "phone",
        "gender",
        "experience_type",
        "experience_years",
        "current_company",
        "current_ctc",
        "expected_ctc",
        "notice_period",
        "college_id",
        "date_of_birth",
        "marital_status",
    }
    for field, value in payload.items():
        if field in allowed_fields:
            setattr(candidate, field, value)

    user.name = candidate.full_name
    user.phone = candidate.phone
    db.add(user)
    db.add(candidate)
    return candidate


def apply_to_position(db: Session, *, user: User, position_id: str, request=None) -> Candidate:
    candidate = get_latest_portal_candidate(db, user=user)
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate profile not found")

    position = db.get(Position, position_id)
    if position is None or not position.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")

    if candidate.position_id == position.id:
        return candidate

    if candidate.position_id and candidate.current_stage != CandidateStage.NEW_APPLICATION:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an active application in progress.",
        )

    previous_position_id = candidate.position_id
    candidate.position_id = position.id
    candidate.last_applied_at = datetime.now(UTC)
    db.add(candidate)
    log_audit(
        db,
        entity_type="candidate",
        entity_id=candidate.id,
        action="candidate_portal_apply",
        actor=user,
        request=request,
        candidate_id=candidate.id,
        old_value={"positionId": previous_position_id},
        new_value={"positionId": position.id, "positionTitle": position.title},
    )
    return candidate
