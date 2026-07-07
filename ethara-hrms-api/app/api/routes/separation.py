from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_permissions, user_has_any_role
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import (
    EmployeeAsset,
    EmployeeProfile,
    EmployeeSeparation,
    NotificationType,
    OffboardingChecklist,
    Role,
    User,
    generate_id,
)
from app.services.audit import log_audit
from app.services.integrations import EmailService
from app.services.workflows import create_notification

router = APIRouter(prefix="/separation", tags=["separation"])

NOTICE_PERIOD_DAYS = 90
EARLY_RELIEVING_NOTICE_DAYS = {30, 60}

VALID_RESIGNATION_REASONS = {
    "Personal Reasons",
    "Better Opportunity / Higher Pay",
    "Relocation",
    "Work-Life Balance",
    "Lack of Career Growth",
    "Management / Culture Fit",
    "Health Reasons",
    "Further Studies",
    "Family Commitments",
    "Retirement",
    "Other",
}

INVOLUNTARY_SEPARATION_TYPES = {"termination", "no_show", "absconding"}

INVOLUNTARY_SEPARATION_LABELS = {
    "termination": "Terminated",
    "no_show": "No Show",
    "absconding": "Absconding",
}

REVOCABLE_RESIGNATION_STATUSES = {"pending", "on_hold", "manager_approved"}
EMPLOYEE_SELF_ROLES = {Role.EMPLOYEE, Role.EMPLOYEE_REFERRER}
LWD_GLOBAL_ROLES = {Role.HR, Role.TA, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}


def _profile_for_user(db: Session, user: User) -> EmployeeProfile:
    profile = db.scalar(
        select(EmployeeProfile).where(EmployeeProfile.user_id == user.id)
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return profile


def _serialize(s: EmployeeSeparation) -> dict:
    ep = s.employee_profile
    return {
        "id": s.id,
        "employeeProfileId": s.employee_profile_id,
        "separationType": s.separation_type,
        "separationTypeLabel": INVOLUNTARY_SEPARATION_LABELS.get(s.separation_type, s.separation_type),
        "status": s.status,
        "reason": s.reason,
        "remarks": s.remarks,
        "earlyRelievingRequested": s.early_relieving_requested,
        "appliedAt": s.applied_at.isoformat() if s.applied_at else None,
        "lastWorkingDay": s.last_working_day.isoformat() if s.last_working_day else None,
        "effectiveDate": s.effective_date.isoformat() if s.effective_date else None,
        "managerId": s.manager_id,
        "managerName": s.manager.name if s.manager else None,
        "managerEmail": s.manager.email if s.manager else None,
        "managerRemarks": s.manager_remarks,
        "managerAction": s.manager_action,
        "managerActionAt": s.manager_action_at.isoformat() if s.manager_action_at else None,
        "reviewedBy": s.reviewed_by,
        "reviewedAt": s.reviewed_at.isoformat() if s.reviewed_at else None,
        "employeeName": ep.full_name if ep else None,
        "employeeCode": ep.employee_code if ep else None,
        "department": ep.department if ep else None,
        "designation": ep.designation if ep else None,
        "etharaEmail": ep.ethara_email if ep else None,
        "personalEmail": ep.personal_email if ep else None,
        "phone": ep.phone if ep else None,
        "bloodGroup": ep.blood_group if ep else None,
        "emergencyContactName": ep.emergency_contact_name if ep else None,
        "emergencyContactPhone": ep.emergency_contact_phone if ep else None,
        "createdAt": s.created_at.isoformat() if s.created_at else None,
        "updatedAt": s.updated_at.isoformat() if s.updated_at else None,
    }


class ResignRequest(BaseModel):
    reason: str | None = None
    early_relieving_requested: bool = False
    requested_notice_days: int | None = None
    remarks: str | None = None
    manager_id: str | None = None


class ManagerActionRequest(BaseModel):
    action: str
    remarks: str | None = None
    suggested_lwd: str | None = None


class HrReasonRequest(BaseModel):
    reason: str
    remarks: str | None = None


class RevokeSeparationRequest(BaseModel):
    remarks: str | None = None


class TerminateRequest(BaseModel):
    employee_profile_id: str
    reason: str
    remarks: str | None = None
    effective_date: str
    separation_type: str = "termination"


@router.post("/resign", status_code=201)
def submit_resignation(
    payload: ResignRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if not user_has_any_role(current_user, EMPLOYEE_SELF_ROLES):
        raise HTTPException(status_code=403, detail="Employee access required")

    profile = _profile_for_user(db, current_user)
    manager_id = profile.manager_id
    manager = db.get(User, manager_id) if manager_id else None
    if not manager_id or manager is None:
        raise HTTPException(
            status_code=400,
            detail="No reporting manager is assigned to your employee profile. Please contact HR.",
        )
    if not user_has_any_role(manager, {Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}):
        raise HTTPException(
            status_code=400,
            detail="Your assigned reporting manager cannot review resignation requests. Please contact HR.",
        )

    existing = db.scalar(
        select(EmployeeSeparation).where(
            EmployeeSeparation.employee_profile_id == profile.id,
            EmployeeSeparation.separation_type == "resignation",
            EmployeeSeparation.status.not_in(("rejected", "cancelled")),
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="A resignation request already exists")

    now = datetime.now(UTC)
    notice_days = NOTICE_PERIOD_DAYS
    if payload.early_relieving_requested:
        notice_days = payload.requested_notice_days or 30
        if notice_days not in EARLY_RELIEVING_NOTICE_DAYS:
            raise HTTPException(status_code=422, detail="Early relieving notice period must be 30 or 60 days.")
    lwd = now + timedelta(days=notice_days)

    separation = EmployeeSeparation(
        employee_profile_id=profile.id,
        separation_type="resignation",
        status="pending",
        reason=None,
        remarks=payload.remarks,
        early_relieving_requested=payload.early_relieving_requested,
        applied_at=now,
        last_working_day=lwd,
        manager_id=manager_id,
    )
    db.add(separation)
    db.flush()

    if manager_id:
        create_notification(
            db,
            user_id=manager_id,
            candidate_id=None,
            title="Resignation Request",
            message=f"{profile.full_name} has submitted a resignation request. Please review.",
            type_=NotificationType.ACTION,
        )
        if manager.email:
            try:
                EmailService().send_email(
                    to_email=manager.email,
                    subject=f"New Resignation Request from {profile.full_name}",
                    body_text=(
                        f"Dear {manager.name},\n\n"
                        f"{profile.full_name} ({profile.employee_code}) has submitted a resignation request.\n\n"
                        + (f"Employee remarks: {payload.remarks}\n" if payload.remarks else "")
                        + f"Early relieving requested: {'Yes' if payload.early_relieving_requested else 'No'}\n\n"
                        + "Please log in to the HRMS portal to review and take action.\n\nRegards,\nEthara HRMS"
                    ),
                )
            except Exception:
                pass

    _notify_hr_admin(
        db, title="Resignation Submitted",
        message=f"{profile.full_name} ({profile.employee_code}) has submitted a resignation.",
        type_=NotificationType.INFO,
    )

    hr_admin_users = db.scalars(
        select(User).where(
            User.role.in_(("hr", "admin", "super_admin", "leadership")),
            User.is_active.is_(True),
        )
    ).all()
    for u in hr_admin_users:
        if u.email:
            try:
                EmailService().send_email(
                    to_email=u.email,
                    subject="Resignation Submitted",
                    body_text=(
                        f"Dear {u.name},\n\n"
                        f"{profile.full_name} ({profile.employee_code}) has submitted a resignation request.\n\n"
                        + (f"Employee remarks: {payload.remarks}\n" if payload.remarks else "")
                        + f"Early relieving requested: {'Yes' if payload.early_relieving_requested else 'No'}\n\n"
                        + "Please log in to the HRMS portal to review.\n\nRegards,\nEthara HRMS"
                    ),
                )
            except Exception:
                pass

    log_audit(
        db, entity_type="separation", entity_id=separation.id,
        action="resignation_submitted", actor=current_user, request=request,
        new_value={"remarks": payload.remarks, "lwd": lwd.isoformat()},
    )
    db.commit()
    db.refresh(separation)
    return _serialize(separation)


@router.get("/mine")
def my_separation(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    if not user_has_any_role(current_user, EMPLOYEE_SELF_ROLES):
        raise HTTPException(status_code=403, detail="Employee access required")
    profile = _profile_for_user(db, current_user)
    rows = db.scalars(
        select(EmployeeSeparation)
        .where(EmployeeSeparation.employee_profile_id == profile.id)
        .order_by(EmployeeSeparation.created_at.desc())
    ).all()
    return [_serialize(r) for r in rows]


@router.post("/{separation_id}/revoke")
def revoke_resignation(
    separation_id: str,
    payload: RevokeSeparationRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if not user_has_any_role(current_user, EMPLOYEE_SELF_ROLES):
        raise HTTPException(status_code=403, detail="Employee access required")
    profile = _profile_for_user(db, current_user)
    separation = db.get(EmployeeSeparation, separation_id)
    if not separation or separation.employee_profile_id != profile.id:
        raise HTTPException(status_code=404, detail="Resignation request not found")
    if separation.separation_type != "resignation":
        raise HTTPException(status_code=400, detail="Only resignation requests can be revoked by employees.")
    if separation.status not in REVOCABLE_RESIGNATION_STATUSES:
        raise HTTPException(status_code=400, detail="This resignation can no longer be revoked.")

    old_status = separation.status
    comment = (payload.remarks or "").strip()
    separation.status = "cancelled"
    separation.manager_action = "cancelled"
    separation.manager_action_at = datetime.now(UTC)
    if comment:
        separation.remarks = f"{separation.remarks}\nRevoked: {comment}" if separation.remarks else f"Revoked: {comment}"
    db.add(separation)

    if separation.manager_id:
        create_notification(
            db,
            user_id=separation.manager_id,
            candidate_id=None,
            title="Resignation Revoked",
            message=f"{profile.full_name} has revoked the resignation request.",
            type_=NotificationType.INFO,
        )

    _notify_hr_admin(
        db,
        title="Resignation Revoked",
        message=f"{profile.full_name} ({profile.employee_code}) has revoked the resignation request.",
        type_=NotificationType.INFO,
    )

    log_audit(
        db,
        entity_type="separation",
        entity_id=separation.id,
        action="resignation_revoked",
        actor=current_user,
        request=request,
        old_value={"status": old_status},
        new_value={"status": separation.status, "remarks": comment or None},
    )
    db.commit()
    db.refresh(separation)
    return _serialize(separation)


@router.get("/list")
def list_separations(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.OFFBOARDING_WRITE))],
    sep_type: str | None = None,
    sep_status: str | None = None,
) -> list[dict]:
    query = select(EmployeeSeparation)
    if sep_type:
        query = query.where(EmployeeSeparation.separation_type == sep_type)
    if sep_status:
        query = query.where(EmployeeSeparation.status == sep_status)
    query = query.order_by(EmployeeSeparation.created_at.desc())
    rows = db.scalars(query).all()
    return [_serialize(r) for r in rows]


@router.get("/manager")
def manager_inbox(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict]:
    rows = db.scalars(
        select(EmployeeSeparation)
        .where(EmployeeSeparation.manager_id == current_user.id)
        .order_by(EmployeeSeparation.created_at.desc())
    ).all()
    return [_serialize(r) for r in rows]


def _validate_resignation_reason(reason: str) -> str:
    normalized = reason.strip()
    reason_base = normalized.split(":")[0].strip()
    if not reason_base or reason_base not in VALID_RESIGNATION_REASONS:
        raise HTTPException(status_code=422, detail="Please select a valid reason for resignation.")
    return normalized


def _ensure_resignation_reason_selected(separation: EmployeeSeparation) -> None:
    if separation.separation_type == "resignation" and not (separation.reason or "").strip():
        raise HTTPException(
            status_code=409,
            detail="HR must select the resignation reason before approval or rejection.",
        )


def _reject_self_review(separation: EmployeeSeparation, current_user: User) -> None:
    # An employee must never approve/reject/hold their own separation, regardless
    # of how privileged their role is (e.g. an HR/manager separating themselves).
    ep = separation.employee_profile
    if ep and ep.user_id and ep.user_id == current_user.id:
        raise HTTPException(
            status_code=403,
            detail="You cannot review your own separation request.",
        )


@router.patch("/{separation_id}/reason")
def update_resignation_reason(
    separation_id: str,
    payload: HrReasonRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.OFFBOARDING_WRITE))],
) -> dict:
    separation = db.get(EmployeeSeparation, separation_id)
    if not separation:
        raise HTTPException(status_code=404, detail="Not found")
    if separation.separation_type != "resignation":
        raise HTTPException(status_code=400, detail="Reason classification is only available for resignations")

    previous_reason = separation.reason
    separation.reason = _validate_resignation_reason(payload.reason)
    if payload.remarks:
        existing = separation.manager_remarks or ""
        separation.manager_remarks = existing + f"\nHR reason note: {payload.remarks}"

    db.add(separation)

    emp_name = separation.employee_profile.full_name if separation.employee_profile else "Employee"
    if separation.manager_id:
        create_notification(
            db,
            user_id=separation.manager_id,
            candidate_id=None,
            title="Resignation Reason Classified",
            message=f"HR classified {emp_name}'s resignation reason as {separation.reason}. You may proceed with review.",
            type_=NotificationType.INFO,
        )

    _notify_hr_admin(
        db,
        title="Resignation Reason Updated",
        message=f"{current_user.name} classified {emp_name}'s resignation reason as {separation.reason}.",
        type_=NotificationType.INFO,
    )

    log_audit(
        db,
        entity_type="separation",
        entity_id=separation.id,
        action="resignation_reason_classified",
        actor=current_user,
        request=request,
        old_value={"reason": previous_reason},
        new_value={"reason": separation.reason, "remarks": payload.remarks},
    )
    db.commit()
    db.refresh(separation)
    return _serialize(separation)


@router.patch("/{separation_id}/manager-action")
def manager_action(
    separation_id: str,
    payload: ManagerActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if payload.action not in ("approve", "reject", "hold"):
        raise HTTPException(status_code=400, detail="action must be approve / reject / hold")
    separation = db.get(EmployeeSeparation, separation_id)
    if not separation:
        raise HTTPException(status_code=404, detail="Not found")
    if separation.manager_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not assigned to you")
    # Don't allow acting on an already-finalised separation (prevents replay / status downgrade).
    if separation.status not in {"pending", "on_hold", "manager_approved"}:
        raise HTTPException(
            status_code=409,
            detail=f"This separation is already finalised (status: {separation.status}) and can't be actioned.",
        )
    _reject_self_review(separation, current_user)
    if payload.action in {"approve", "reject"}:
        _ensure_resignation_reason_selected(separation)

    separation.manager_action = payload.action
    separation.manager_remarks = payload.remarks
    separation.manager_action_at = datetime.now(UTC)

    if payload.action == "approve":
        separation.status = "manager_approved"
        if payload.suggested_lwd:
            try:
                separation.last_working_day = datetime.fromisoformat(payload.suggested_lwd).replace(tzinfo=UTC)
            except ValueError:
                pass
    elif payload.action == "reject":
        separation.status = "rejected"
    else:
        separation.status = "on_hold"

    db.add(separation)

    action_label = "approved" if payload.action == "approve" else ("rejected" if payload.action == "reject" else "put on hold")
    emp_profile = separation.employee_profile
    emp_name = emp_profile.full_name if emp_profile else "Employee"

    # Email to the employee
    if emp_profile and emp_profile.user_id:
        emp_user = db.get(User, emp_profile.user_id)
        if emp_user and emp_user.email:
            try:
                EmailService().send_email(
                    to_email=emp_user.email,
                    subject=f"Your resignation has been {action_label} by your manager",
                    body_text=(
                        f"Dear {emp_name},\n\n"
                        f"Your resignation request has been {action_label} by your manager {current_user.name}.\n\n"
                        + (f"Manager remarks: {payload.remarks}\n\n" if payload.remarks else "")
                        + "Please log in to the HRMS portal for further details.\n\nRegards,\nEthara HRMS"
                    ),
                )
            except Exception:
                pass

    # Email to all HR/admin users
    hr_admin_users = db.scalars(
        select(User).where(
            User.role.in_(("hr", "admin", "super_admin", "leadership")),
            User.is_active.is_(True),
        )
    ).all()
    for u in hr_admin_users:
        if u.email:
            try:
                EmailService().send_email(
                    to_email=u.email,
                    subject=f"Manager has {action_label} {emp_name}'s resignation",
                    body_text=(
                        f"Dear {u.name},\n\n"
                        f"Manager {current_user.name} has {action_label} the resignation request from {emp_name}.\n\n"
                        + (f"Manager remarks: {payload.remarks}\n\n" if payload.remarks else "")
                        + "Please log in to the HRMS portal to take further action.\n\nRegards,\nEthara HRMS"
                    ),
                )
            except Exception:
                pass

    log_audit(
        db, entity_type="separation", entity_id=separation.id,
        action=f"manager_{payload.action}", actor=current_user, request=request,
        new_value={"action": payload.action, "remarks": payload.remarks},
    )
    db.commit()
    db.refresh(separation)
    return _serialize(separation)


@router.patch("/{separation_id}/hr-action")
def hr_action(
    separation_id: str,
    payload: ManagerActionRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.OFFBOARDING_WRITE))],
) -> dict:
    if payload.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be approve or reject")
    separation = db.get(EmployeeSeparation, separation_id)
    if not separation:
        raise HTTPException(status_code=404, detail="Not found")
    # Don't allow acting on an already-finalised separation (prevents replay / status downgrade).
    if separation.status not in {"pending", "on_hold", "manager_approved"}:
        raise HTTPException(
            status_code=409,
            detail=f"This separation is already finalised (status: {separation.status}) and can't be actioned.",
        )
    _reject_self_review(separation, current_user)
    _ensure_resignation_reason_selected(separation)

    separation.reviewed_by = current_user.id
    separation.reviewed_at = datetime.now(UTC)
    separation.manager_remarks = (separation.manager_remarks or "") + (f"\nHR: {payload.remarks}" if payload.remarks else "")
    separation.status = "approved" if payload.action == "approve" else "rejected"

    if payload.action == "approve" and separation.separation_type == "resignation":
        profile = db.get(EmployeeProfile, separation.employee_profile_id)
        if profile and profile.user_id:
            create_notification(
                db, user_id=profile.user_id, candidate_id=None,
                title="Resignation Approved",
                message=f"Your resignation has been approved. LWD: {separation.last_working_day.strftime('%d %b %Y') if separation.last_working_day else 'TBD'}",
                type_=NotificationType.INFO,
            )

        existing_checklist = db.scalar(
            select(OffboardingChecklist).where(
                OffboardingChecklist.separation_id == separation.id
            )
        )
        if not existing_checklist:
            checklist = OffboardingChecklist(
                id=generate_id(),
                separation_id=separation.id,
                employee_profile_id=separation.employee_profile_id,
                status="pending",
            )
            db.add(checklist)
            db.flush()

        active_users = db.scalars(select(User).where(User.is_active.is_(True))).all()
        it_users = [user for user in active_users if user_has_any_role(user, {Role.IT_TEAM})]
        office_admins = [user for user in active_users if user_has_any_role(user, {Role.OFFICE_ADMIN})]
        emp_name = separation.employee_profile.full_name if separation.employee_profile else "Employee"
        lwd_str = separation.last_working_day.strftime("%d %b %Y") if separation.last_working_day else "TBD"

        for u in it_users:
            create_notification(
                db, user_id=u.id, candidate_id=None,
                title="IT Offboarding Required",
                message=f"{emp_name} is leaving. LWD: {lwd_str}. Please collect laptop and deactivate accounts.",
                type_=NotificationType.ACTION,
            )
        for u in office_admins:
            create_notification(
                db, user_id=u.id, candidate_id=None,
                title="ID Card Offboarding Required",
                message=f"{emp_name} is leaving. LWD: {lwd_str}. Please collect ID card.",
                type_=NotificationType.ACTION,
            )

    hr_action_label = "approved" if payload.action == "approve" else "rejected"
    hr_emp_profile = separation.employee_profile
    hr_emp_name = hr_emp_profile.full_name if hr_emp_profile else "Employee"

    # Email to the employee
    if hr_emp_profile and hr_emp_profile.user_id:
        hr_emp_user = db.get(User, hr_emp_profile.user_id)
        if hr_emp_user and hr_emp_user.email:
            try:
                EmailService().send_email(
                    to_email=hr_emp_user.email,
                    subject=f"Your separation request has been {hr_action_label}",
                    body_text=(
                        f"Dear {hr_emp_name},\n\n"
                        f"Your separation request has been {hr_action_label} by HR.\n\n"
                        + (f"Remarks: {payload.remarks}\n\n" if payload.remarks else "")
                        + "Please log in to the HRMS portal for further details.\n\nRegards,\nEthara HRMS"
                    ),
                )
            except Exception:
                pass

    # Email to the manager
    if separation.manager_id:
        manager_user = db.get(User, separation.manager_id)
        if manager_user and manager_user.email:
            try:
                EmailService().send_email(
                    to_email=manager_user.email,
                    subject=f"Final decision on {hr_emp_name}'s separation request",
                    body_text=(
                        f"Dear {manager_user.name},\n\n"
                        f"HR has {hr_action_label} the separation request for {hr_emp_name}.\n\n"
                        + (f"HR remarks: {payload.remarks}\n\n" if payload.remarks else "")
                        + "Please log in to the HRMS portal for further details.\n\nRegards,\nEthara HRMS"
                    ),
                )
            except Exception:
                pass

    # Email to leadership
    try:
        EmailService().send_email(
            to_email="Leadership@ethara.ai",
            subject=f"Separation request {hr_action_label}: {hr_emp_name}",
            body_text=(
                f"Dear Leadership,\n\n"
                f"This is to inform you that the separation request for {hr_emp_name} has been {hr_action_label} by HR ({current_user.name}).\n\n"
                + (f"Remarks: {payload.remarks}\n\n" if payload.remarks else "")
                + "Please log in to the HRMS portal for full details.\n\nRegards,\nEthara HRMS"
            ),
        )
    except Exception:
        pass

    db.add(separation)
    log_audit(
        db, entity_type="separation", entity_id=separation.id,
        action=f"hr_{payload.action}", actor=current_user, request=request,
    )
    db.commit()
    db.refresh(separation)
    return _serialize(separation)


class UpdateLwdRequest(BaseModel):
    last_working_day: str
    remarks: str | None = None


@router.patch("/{separation_id}/update-lwd")
def update_lwd(
    separation_id: str,
    payload: UpdateLwdRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    has_global_lwd_access = user_has_any_role(current_user, LWD_GLOBAL_ROLES)
    if not has_global_lwd_access and not user_has_any_role(current_user, {Role.MANAGER}):
        raise HTTPException(status_code=403, detail="Not authorised to update LWD")

    separation = db.get(EmployeeSeparation, separation_id)
    if not separation:
        raise HTTPException(status_code=404, detail="Not found")

    # A manager may only adjust the LWD for their own team's separations — mirror
    # the ownership check already enforced on /manager-action. HR/TA/admin tiers
    # are global approvers and skip this.
    if (
        not has_global_lwd_access
        and user_has_any_role(current_user, {Role.MANAGER})
        and separation.manager_id != current_user.id
    ):
        raise HTTPException(status_code=403, detail="You can only update separations for your own team")

    try:
        new_lwd = datetime.fromisoformat(payload.last_working_day).replace(tzinfo=UTC)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format — use ISO 8601 (YYYY-MM-DD)")

    old_lwd = separation.last_working_day
    separation.last_working_day = new_lwd
    if payload.remarks:
        existing = separation.remarks or ""
        tag = f"\n[LWD updated by {current_user.name}: {payload.remarks}]"
        separation.remarks = existing + tag

    db.add(separation)
    log_audit(
        db, entity_type="separation", entity_id=separation.id,
        action="lwd_updated", actor=current_user, request=request,
        old_value={"lastWorkingDay": old_lwd.isoformat() if old_lwd else None},
        new_value={"lastWorkingDay": new_lwd.isoformat()},
    )

    if separation.employee_profile and separation.employee_profile.user_id:
        create_notification(
            db,
            user_id=separation.employee_profile.user_id,
            candidate_id=None,
            title="Last Working Day Updated",
            message=f"Your Last Working Day has been updated to {new_lwd.strftime('%d %b %Y')} by {current_user.name}.",
            type_=NotificationType.INFO,
        )

    db.commit()
    db.refresh(separation)
    return _serialize(separation)


# Destructive separation (terminate / mark no-show / abscond) deactivates and
# blacklists an employee. This must be restricted to HR/Admin/Super-Admin even
# though it_team / office_admin also hold OFFBOARDING_WRITE for their checklist /
# asset duties. OFFBOARDING_WRITE alone must not reach this action.
TERMINATE_ALLOWED_ROLES = {Role.HR, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}


@router.post("/terminate", status_code=201)
def terminate_employee(
    payload: TerminateRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.OFFBOARDING_WRITE))],
) -> dict:
    if not user_has_any_role(current_user, TERMINATE_ALLOWED_ROLES):
        raise HTTPException(
            status_code=403,
            detail="Only HR or Admin can terminate, deactivate, or blacklist an employee.",
        )
    profile = db.get(EmployeeProfile, payload.employee_profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    separation_type = payload.separation_type.strip().lower()
    if separation_type not in INVOLUNTARY_SEPARATION_TYPES:
        raise HTTPException(status_code=422, detail="separation_type must be termination, no_show, or absconding")

    try:
        eff_date = datetime.fromisoformat(payload.effective_date).replace(tzinfo=UTC)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid effective_date format (use ISO 8601)")

    separation = EmployeeSeparation(
        employee_profile_id=profile.id,
        separation_type=separation_type,
        status="approved",
        reason=payload.reason,
        remarks=payload.remarks,
        effective_date=eff_date,
        applied_at=datetime.now(UTC),
        reviewed_by=current_user.id,
        reviewed_at=datetime.now(UTC),
    )
    db.add(separation)
    db.flush()

    outcome_label = INVOLUNTARY_SEPARATION_LABELS[separation_type]
    if profile.user_id:
        user = db.get(User, profile.user_id)
        if user:
            user.is_active = False
            db.add(user)
            create_notification(
                db, user_id=profile.user_id, candidate_id=None,
                title=f"Employment {outcome_label}",
                message=f"Your employment status has been marked as {outcome_label} effective {eff_date.strftime('%d %b %Y')}. Reason: {payload.reason}",
                type_=NotificationType.WARNING,
            )

    _notify_hr_admin(
        db, title=f"Employee {outcome_label}",
        message=f"{profile.full_name} ({profile.employee_code}) has been marked as {outcome_label} by {current_user.name}. Access is deactivated and the record is blacklisted.",
        type_=NotificationType.ACTION,
    )

    _mark_employee_blacklisted(db, profile, separation, outcome_label)
    _create_it_deactivation_task(db, profile, current_user)

    log_audit(
        db, entity_type="separation", entity_id=separation.id,
        action=f"{separation_type}_initiated", actor=current_user, request=request,
        new_value={"reason": payload.reason, "effectiveDate": eff_date.isoformat(), "separationType": separation_type},
    )
    db.commit()
    db.refresh(separation)
    return _serialize(separation)


def _mark_employee_blacklisted(
    db: Session,
    profile: EmployeeProfile,
    separation: EmployeeSeparation,
    outcome_label: str,
) -> None:
    now = datetime.now(UTC)
    assets = db.scalars(
        select(EmployeeAsset).where(
            EmployeeAsset.employee_profile_id == profile.id,
            EmployeeAsset.status == "assigned",
        )
    ).all()
    for asset in assets:
        asset.status = "deactivation_required"
        note = f"Access/asset deactivation required after {outcome_label} on {now.date().isoformat()}."
        asset.notes = f"{asset.notes}\n{note}" if asset.notes else note
        db.add(asset)

    checklist = db.scalar(
        select(OffboardingChecklist).where(
            OffboardingChecklist.separation_id == separation.id
        )
    )
    if not checklist:
        checklist = OffboardingChecklist(
            id=generate_id(),
            separation_id=separation.id,
            employee_profile_id=profile.id,
            status="pending",
        )
    checklist.it_cleared_at = now
    checklist.office_admin_cleared_at = now
    checklist.hr_cleared_at = now
    checklist.it_cleared_by = separation.reviewed_by
    checklist.office_admin_cleared_by = separation.reviewed_by
    checklist.hr_cleared_by = separation.reviewed_by
    db.add(checklist)


def _notify_hr_admin(db: Session, *, title: str, message: str, type_: NotificationType) -> None:
    from sqlalchemy import select as _sel
    hr_admin_users = [
        user
        for user in db.scalars(_sel(User).where(User.is_active.is_(True))).all()
        if user_has_any_role(user, {Role.HR, Role.TA, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP})
    ]
    for u in hr_admin_users:
        create_notification(db, user_id=u.id, candidate_id=None, title=title, message=message, type_=type_)


def _create_it_deactivation_task(db: Session, profile: EmployeeProfile, actor: User) -> None:
    from sqlalchemy import select as _sel
    it_users = [
        user
        for user in db.scalars(_sel(User).where(User.is_active.is_(True))).all()
        if user_has_any_role(user, {Role.IT_TEAM})
    ]
    for u in it_users:
            create_notification(
                db, user_id=u.id, candidate_id=None,
                title="Deactivate Employee Access",
                message=f"ACTION REQUIRED: Deactivate all system access for {profile.full_name} ({profile.ethara_email or profile.employee_code}). Separation effective immediately.",
                type_=NotificationType.ACTION,
            )
