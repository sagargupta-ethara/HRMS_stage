from __future__ import annotations

import csv
import io
import re
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import require_permissions
from app.core.database import get_db
from app.core.exports import csv_safe_row
from app.core.permissions import Permission
from app.db.models import (
    DinnerRequest,
    DinnerRequestActionLog,
    EmployeeProfile,
    NotificationType,
    Project,
    Role,
    User,
    generate_id,
)
from app.services.audit import log_audit
from app.services.integrations import EmailService
from app.services.workflows import create_notification

router = APIRouter(prefix="/dinner-requests", tags=["dinner-requests"])

STATUS_LABELS = {
    "draft": "Draft",
    "submitted": "Submitted",
    "pending_review": "Pending Review",
    "returned": "Returned",
    "approved": "Approved",
    "rejected": "Rejected",
    "completed": "Completed",
}
EDITABLE_STATUSES = {"draft", "returned"}
DELETABLE_STATUSES = {"draft", "returned", "pending_review", "rejected"}
REVIEWER_ROLES = {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP, Role.HR, Role.OFFICE_ADMIN}
REQUESTER_ROLES = {
    Role.ADMIN,
    Role.SUPER_ADMIN,
    Role.LEADERSHIP,
    Role.MANAGER,
    Role.HR,
    Role.OFFICE_ADMIN,
    Role.PL_TPM,
}
# On submit, the request goes to Office Admin (to action) and HR (to be informed),
# with the full candidate list.
DINNER_NOTIFY_ROLES = {Role.OFFICE_ADMIN, Role.HR}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DinnerRequestUpsert(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    requester_name: str | None = Field(default=None, alias="requesterName")
    requester_type: str | None = Field(default="project_lead", alias="requesterType")
    dinner_date: str | None = Field(default=None, alias="dinnerDate")
    project_name: str | None = Field(default=None, alias="projectName")
    project_id: str | None = Field(default=None, alias="projectId")
    amount: float | None = Field(default=None)
    team_member_count: int | None = Field(default=None, alias="teamMemberCount")
    team_member_emails: list[str] = Field(default_factory=list, alias="teamMemberEmails")
    save_as_draft: bool = Field(default=False, alias="saveAsDraft")


class DinnerReviewRequest(BaseModel):
    action: str
    comment: str | None = None


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


def _is_reviewer(user: User) -> bool:
    return _has_any_role(user, REVIEWER_ROLES)


def _is_requester(user: User) -> bool:
    return _has_any_role(user, REQUESTER_ROLES)


def _profile_for_user(db: Session, user: User) -> EmployeeProfile | None:
    return db.scalar(
        select(EmployeeProfile).where(
            or_(
                EmployeeProfile.user_id == user.id,
                EmployeeProfile.ethara_email == user.email,
            )
        )
    )


def _load_request(db: Session, request_id: str) -> DinnerRequest:
    dinner_request = db.scalar(
        select(DinnerRequest)
        .where(DinnerRequest.id == request_id)
        .options(
            joinedload(DinnerRequest.requester),
            joinedload(DinnerRequest.requester_employee_profile),
            joinedload(DinnerRequest.reviewer),
            joinedload(DinnerRequest.completer),
            selectinload(DinnerRequest.actions),
        )
    )
    if not dinner_request:
        raise HTTPException(status_code=404, detail="Dinner request not found.")
    return dinner_request


def _normalize_text(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _parse_dinner_date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Dinner date must be in YYYY-MM-DD format.") from exc


def _normalize_emails(values: list[str]) -> list[str]:
    normalized: list[str] = []
    for item in values:
        for part in re.split(r"[\n,;]+", item or ""):
            email = part.strip().lower()
            if not email or email in normalized:
                continue
            normalized.append(email)
    return normalized


def _validate_submission(dinner_request: DinnerRequest) -> list[str]:
    missing: list[str] = []
    checks = [
        ("Project Lead/TPM Name", dinner_request.requester_name),
        ("Date", dinner_request.dinner_date),
        ("Project Name", dinner_request.project_name),
        ("Number of Team Members", dinner_request.team_member_count),
        ("Team Members' Email IDs", dinner_request.team_member_emails),
    ]
    for label, value in checks:
        if value is None or value == "" or value == []:
            missing.append(label)
    if dinner_request.dinner_date and dinner_request.dinner_date < datetime.now(UTC).date():
        missing.append("Date cannot be in the past")
    if dinner_request.team_member_count is not None and dinner_request.team_member_count <= 0:
        missing.append("Number of Team Members must be greater than 0")
    invalid_emails = [email for email in dinner_request.team_member_emails or [] if not EMAIL_RE.match(email)]
    if invalid_emails:
        missing.append(f"Invalid email IDs: {', '.join(invalid_emails)}")
    if (
        dinner_request.team_member_count
        and dinner_request.team_member_emails
        and dinner_request.team_member_count != len(dinner_request.team_member_emails)
    ):
        missing.append("Number of Team Members must match the number of email IDs")
    return missing


def _serialize(dinner_request: DinnerRequest) -> dict[str, Any]:
    actions = sorted(dinner_request.actions or [], key=lambda item: item.created_at)
    return {
        "id": dinner_request.id,
        "requesterUserId": dinner_request.requester_user_id,
        "requesterEmployeeProfileId": dinner_request.requester_employee_profile_id,
        "requesterName": dinner_request.requester_name,
        "requesterType": dinner_request.requester_type,
        "dinnerDate": dinner_request.dinner_date.isoformat() if dinner_request.dinner_date else None,
        "projectName": dinner_request.project_name,
        "projectId": dinner_request.project_id,
        "amount": dinner_request.amount,
        "teamMemberCount": dinner_request.team_member_count,
        "teamMemberEmails": dinner_request.team_member_emails or [],
        "status": dinner_request.status,
        "statusLabel": STATUS_LABELS.get(dinner_request.status, dinner_request.status),
        "submittedAt": dinner_request.submitted_at.isoformat() if dinner_request.submitted_at else None,
        "reviewedBy": dinner_request.reviewer.name if dinner_request.reviewer else None,
        "reviewedAt": dinner_request.reviewed_at.isoformat() if dinner_request.reviewed_at else None,
        "reviewerComments": dinner_request.reviewer_comments,
        "completedBy": dinner_request.completer.name if dinner_request.completer else None,
        "completedAt": dinner_request.completed_at.isoformat() if dinner_request.completed_at else None,
        "missingFields": dinner_request.missing_fields or [],
        "createdAt": dinner_request.created_at.isoformat() if dinner_request.created_at else None,
        "updatedAt": dinner_request.updated_at.isoformat() if dinner_request.updated_at else None,
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


def _log_action(
    db: Session,
    *,
    dinner_request: DinnerRequest,
    actor: User,
    action: str,
    from_status: str | None,
    to_status: str | None,
    comment: str | None = None,
) -> None:
    db.add(
        DinnerRequestActionLog(
            id=generate_id(),
            dinner_request_id=dinner_request.id,
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
    type_: NotificationType,
) -> None:
    if not user:
        return
    create_notification(db, user_id=user.id, title=title, message=message, type_=type_)
    if user.email:
        try:
            EmailService().send_email(to_email=user.email, subject=title, body_text=message)
        except Exception:
            pass


def _notify_reviewers(db: Session, *, title: str, message: str, roles: set[Role] | None = None) -> None:
    target_roles = roles or REVIEWER_ROLES
    seen: set[str] = set()
    for user in db.scalars(select(User).where(User.is_active.is_(True))):
        if user.id in seen or not _has_any_role(user, target_roles):
            continue
        seen.add(user.id)
        _notify_user(db, user=user, title=title, message=message, type_=NotificationType.ACTION)


def _dinner_details(dinner_request: DinnerRequest) -> str:
    """Detailed message for the Office Admin / HR notification: project, count, and
    the full candidate list (emails), so they have everything in the notification + email."""
    emails = dinner_request.team_member_emails or []
    candidate_lines = [f"  • {email}" for email in emails] if emails else ["  (none listed)"]
    count = dinner_request.team_member_count if dinner_request.team_member_count is not None else len(emails)
    lines = [
        f"Raised by: {dinner_request.requester_name}",
        f"Project: {dinner_request.project_name or '—'}",
        f"Dinner date: {dinner_request.dinner_date.isoformat() if dinner_request.dinner_date else '—'}",
        f"Number of people: {count}",
        "Candidates:",
        *candidate_lines,
    ]
    return "\n".join(lines)


def _base_query():
    return select(DinnerRequest).options(
        joinedload(DinnerRequest.requester),
        joinedload(DinnerRequest.requester_employee_profile),
        joinedload(DinnerRequest.reviewer),
        joinedload(DinnerRequest.completer),
        selectinload(DinnerRequest.actions),
    )


def _scoped_requests(db: Session, current_user: User, *, status_filter: str | None = None) -> list[DinnerRequest]:
    query = _base_query()
    if not _is_reviewer(current_user):
        query = query.where(DinnerRequest.requester_user_id == current_user.id)
    if status_filter:
        query = query.where(DinnerRequest.status == status_filter)
    query = query.order_by(DinnerRequest.updated_at.desc(), DinnerRequest.created_at.desc())
    return list(db.scalars(query).unique())


def _apply_payload(
    dinner_request: DinnerRequest,
    payload: DinnerRequestUpsert,
    *,
    db: Session,
    current_user: User,
    profile: EmployeeProfile | None,
) -> None:
    fallback_name = profile.full_name if profile else current_user.name
    dinner_request.requester_name = _normalize_text(payload.requester_name) or fallback_name
    dinner_request.requester_type = _normalize_text(payload.requester_type) or "project_lead"
    dinner_request.dinner_date = _parse_dinner_date(payload.dinner_date)
    # Link to a real Project; projectName mirrors it for display/back-compat.
    project_id = _normalize_text(payload.project_id)
    if project_id:
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=422, detail="Selected project does not exist.")
        dinner_request.project_id = project.id
        dinner_request.project_name = project.internal_name
    else:
        dinner_request.project_id = None
        dinner_request.project_name = _normalize_text(payload.project_name)
    dinner_request.amount = payload.amount
    dinner_request.team_member_count = payload.team_member_count
    dinner_request.team_member_emails = _normalize_emails(payload.team_member_emails)


@router.get("")
def list_dinner_requests(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DINNER_REQUESTS_READ))],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> list[dict[str, Any]]:
    return [_serialize(item) for item in _scoped_requests(db, current_user, status_filter=status_filter)]


@router.get("/export")
def export_dinner_requests(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DINNER_REQUESTS_REVIEW))],
):
    if not _is_reviewer(current_user):
        raise HTTPException(status_code=403, detail="Only Admin, HR, or Office Admin can export dinner requests.")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Request ID",
        "Project Lead/TPM Name",
        "Requester Type",
        "Dinner Date",
        "Project Name",
        "Team Member Count",
        "Team Member Emails",
        "Status",
        "Reviewer",
        "Reviewer Comments",
        "Completed At",
        "Created At",
        "Updated At",
    ])
    for row in _scoped_requests(db, current_user):
        writer.writerow(csv_safe_row([
            row.id,
            row.requester_name,
            row.requester_type,
            row.dinner_date.isoformat() if row.dinner_date else "",
            row.project_name or "",
            row.team_member_count or "",
            ", ".join(row.team_member_emails or []),
            STATUS_LABELS.get(row.status, row.status),
            row.reviewer.name if row.reviewer else "",
            row.reviewer_comments or "",
            row.completed_at.isoformat() if row.completed_at else "",
            row.created_at.isoformat() if row.created_at else "",
            row.updated_at.isoformat() if row.updated_at else "",
        ]))
    output.seek(0)
    filename = f"dinner_requests_{datetime.now(UTC).date().isoformat()}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", status_code=201)
def create_dinner_request(
    payload: DinnerRequestUpsert,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DINNER_REQUESTS_WRITE))],
) -> dict[str, Any]:
    if not _is_requester(current_user):
        raise HTTPException(status_code=403, detail="Only Project Lead/TPM users can raise dinner requests.")
    profile = _profile_for_user(db, current_user)
    dinner_request = DinnerRequest(
        id=generate_id(),
        requester_user_id=current_user.id,
        requester_employee_profile_id=profile.id if profile else None,
        requester_name=current_user.name,
        requester_type="project_lead",
        status="draft",
        team_member_emails=[],
        missing_fields=[],
    )
    _apply_payload(dinner_request, payload, db=db, current_user=current_user, profile=profile)
    missing = _validate_submission(dinner_request)
    if payload.save_as_draft:
        dinner_request.status = "draft"
        dinner_request.missing_fields = missing
    elif missing:
        raise HTTPException(status_code=422, detail="; ".join(missing))
    else:
        dinner_request.status = "pending_review"
        dinner_request.submitted_at = datetime.now(UTC)
        dinner_request.missing_fields = []

    db.add(dinner_request)
    db.flush()
    _log_action(
        db,
        dinner_request=dinner_request,
        actor=current_user,
        action="draft_saved" if payload.save_as_draft else "submitted",
        from_status=None,
        to_status=dinner_request.status,
        comment="; ".join(missing) if payload.save_as_draft and missing else None,
    )
    log_audit(
        db,
        entity_type="dinner_request",
        entity_id=dinner_request.id,
        action="created",
        actor=current_user,
        request=request,
        user_id=current_user.id,
        new_value={"status": dinner_request.status, "projectName": dinner_request.project_name},
    )
    if dinner_request.status == "pending_review":
        _notify_reviewers(
            db,
            title=f"Dinner request — {dinner_request.project_name or 'New'}",
            message=_dinner_details(dinner_request),
            roles=DINNER_NOTIFY_ROLES,
        )
    db.commit()
    return _serialize(_load_request(db, dinner_request.id))


@router.get("/{request_id}")
def get_dinner_request(
    request_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DINNER_REQUESTS_READ))],
) -> dict[str, Any]:
    dinner_request = _load_request(db, request_id)
    if not _is_reviewer(current_user) and dinner_request.requester_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized for this dinner request.")
    return _serialize(dinner_request)


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dinner_request(
    request_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DINNER_REQUESTS_WRITE))],
) -> None:
    dinner_request = _load_request(db, request_id)
    if dinner_request.requester_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the requester can delete this dinner request.")
    if dinner_request.status not in DELETABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Approved or completed dinner requests cannot be deleted.")

    old_value = {
        "status": dinner_request.status,
        "projectName": dinner_request.project_name,
        "dinnerDate": dinner_request.dinner_date.isoformat() if dinner_request.dinner_date else None,
    }
    log_audit(
        db,
        entity_type="dinner_request",
        entity_id=dinner_request.id,
        action="deleted",
        actor=current_user,
        request=request,
        user_id=current_user.id,
        old_value=old_value,
    )
    db.delete(dinner_request)
    db.commit()
    return None


@router.patch("/{request_id}")
def update_dinner_request(
    request_id: str,
    payload: DinnerRequestUpsert,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DINNER_REQUESTS_WRITE))],
) -> dict[str, Any]:
    dinner_request = _load_request(db, request_id)
    if dinner_request.requester_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the requester can update this dinner request.")
    if dinner_request.status not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="This dinner request can no longer be edited.")
    profile = _profile_for_user(db, current_user)
    old_status = dinner_request.status
    _apply_payload(dinner_request, payload, db=db, current_user=current_user, profile=profile)
    missing = _validate_submission(dinner_request)
    if payload.save_as_draft:
        dinner_request.status = "draft"
        dinner_request.missing_fields = missing
    elif missing:
        raise HTTPException(status_code=422, detail="; ".join(missing))
    else:
        dinner_request.status = "pending_review"
        dinner_request.submitted_at = dinner_request.submitted_at or datetime.now(UTC)
        dinner_request.missing_fields = []
    db.add(dinner_request)
    db.flush()
    _log_action(
        db,
        dinner_request=dinner_request,
        actor=current_user,
        action="draft_saved" if payload.save_as_draft else "resubmitted",
        from_status=old_status,
        to_status=dinner_request.status,
        comment="; ".join(missing) if payload.save_as_draft and missing else None,
    )
    log_audit(
        db,
        entity_type="dinner_request",
        entity_id=dinner_request.id,
        action="updated",
        actor=current_user,
        request=request,
        user_id=current_user.id,
        old_value={"status": old_status},
        new_value={"status": dinner_request.status},
    )
    if dinner_request.status == "pending_review":
        _notify_reviewers(
            db,
            title=f"Dinner request — {dinner_request.project_name or 'New'}",
            message=_dinner_details(dinner_request),
            roles=DINNER_NOTIFY_ROLES,
        )
    db.commit()
    return _serialize(_load_request(db, dinner_request.id))


@router.post("/{request_id}/review")
def review_dinner_request(
    request_id: str,
    payload: DinnerReviewRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DINNER_REQUESTS_REVIEW))],
) -> dict[str, Any]:
    if not _is_reviewer(current_user):
        raise HTTPException(status_code=403, detail="Only Admin, Office Admin, or HR can review dinner requests.")
    dinner_request = _load_request(db, request_id)
    if dinner_request.status != "pending_review":
        raise HTTPException(status_code=400, detail="Only pending-review dinner requests can be reviewed.")
    action = payload.action.strip().lower()
    if action not in {"approve", "reject", "return"}:
        raise HTTPException(status_code=422, detail="Action must be approve, reject, or return.")
    comment = (payload.comment or "").strip()
    if action in {"reject", "return"} and not comment:
        raise HTTPException(status_code=422, detail="Comments are required for return or rejection.")

    old_status = dinner_request.status
    if action == "approve":
        dinner_request.status = "approved"
        dinner_request.reviewer_comments = comment or "Approved"
    elif action == "reject":
        dinner_request.status = "rejected"
        dinner_request.reviewer_comments = comment
    else:
        dinner_request.status = "returned"
        dinner_request.reviewer_comments = comment
    dinner_request.reviewed_by = current_user.id
    dinner_request.reviewed_at = datetime.now(UTC)
    db.add(dinner_request)
    db.flush()
    _log_action(
        db,
        dinner_request=dinner_request,
        actor=current_user,
        action=action,
        from_status=old_status,
        to_status=dinner_request.status,
        comment=dinner_request.reviewer_comments,
    )
    log_audit(
        db,
        entity_type="dinner_request",
        entity_id=dinner_request.id,
        action=action,
        actor=current_user,
        request=request,
        user_id=dinner_request.requester_user_id,
        old_value={"status": old_status},
        new_value={"status": dinner_request.status},
    )
    _notify_user(
        db,
        user=dinner_request.requester,
        title="Dinner request reviewed",
        message=f"Your dinner request for {dinner_request.project_name} is now {STATUS_LABELS[dinner_request.status]}.",
        type_=NotificationType.SUCCESS if action == "approve" else NotificationType.WARNING,
    )
    db.commit()
    return _serialize(_load_request(db, dinner_request.id))


@router.post("/{request_id}/complete")
def complete_dinner_request(
    request_id: str,
    payload: DinnerReviewRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.DINNER_REQUESTS_REVIEW))],
) -> dict[str, Any]:
    if not _is_reviewer(current_user):
        raise HTTPException(status_code=403, detail="Only Admin, Office Admin, or HR can complete dinner requests.")
    dinner_request = _load_request(db, request_id)
    if dinner_request.status != "approved":
        raise HTTPException(status_code=400, detail="Only approved dinner requests can be completed.")
    old_status = dinner_request.status
    dinner_request.status = "completed"
    dinner_request.completed_by = current_user.id
    dinner_request.completed_at = datetime.now(UTC)
    db.add(dinner_request)
    db.flush()
    _log_action(
        db,
        dinner_request=dinner_request,
        actor=current_user,
        action="completed",
        from_status=old_status,
        to_status=dinner_request.status,
        comment=(payload.comment or "").strip() or None,
    )
    log_audit(
        db,
        entity_type="dinner_request",
        entity_id=dinner_request.id,
        action="completed",
        actor=current_user,
        request=request,
        user_id=dinner_request.requester_user_id,
        old_value={"status": old_status},
        new_value={"status": dinner_request.status},
    )
    _notify_user(
        db,
        user=dinner_request.requester,
        title="Dinner request completed",
        message=f"Your dinner request for {dinner_request.project_name} has been completed.",
        type_=NotificationType.SUCCESS,
    )
    db.commit()
    return _serialize(_load_request(db, dinner_request.id))
