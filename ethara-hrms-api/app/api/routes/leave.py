from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_permissions, user_has_any_role
from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import (
    EmployeeProfile,
    LeaveBalance,
    LeaveRequest,
    NotificationType,
    Role,
    User,
    generate_id,
)
from app.services import greythr_leave
from app.services.audit import log_audit
from app.services.greythr_leave import GreytHRNotConfigured
from app.services.workflows import create_notification

router = APIRouter(prefix="/leave", tags=["leave"])

LEAVE_ALLOCATION: dict[str, float] = {
    "casual": 12,
    "sick": 12,
    "earned": 15,
    "maternity": 180,
    "paternity": 5,
    "unpaid": 0,
    "compensatory": 0,
}

LEAVE_TYPE_LABELS: dict[str, str] = {
    "casual": "Casual Leave",
    "sick": "Sick Leave",
    "earned": "Earned Leave",
    "maternity": "Maternity Leave",
    "paternity": "Paternity Leave",
    "unpaid": "Unpaid Leave",
    "compensatory": "Compensatory Leave",
}

GLOBAL_LEAVE_APPROVER_ROLES = {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}


def _profile_for_user(db: Session, user: User) -> EmployeeProfile:
    profile = db.scalar(select(EmployeeProfile).where(EmployeeProfile.user_id == user.id))
    if not profile:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return profile


def _require_global_leave_approver(user: User) -> None:
    if not user_has_any_role(user, GLOBAL_LEAVE_APPROVER_ROLES):
        raise HTTPException(status_code=403, detail="Not authorized")


def _leave_type_label(value: str) -> str:
    return LEAVE_TYPE_LABELS.get(value, value.replace("_", " ").replace("-", " ").title())


def _serialize_balance(b: LeaveBalance) -> dict:
    return {
        "id": b.id,
        "leaveType": b.leave_type,
        "year": b.year,
        "totalDays": b.total_days,
        "usedDays": b.used_days,
        "pendingDays": b.pending_days,
        "availableDays": b.total_days - b.used_days - b.pending_days,
    }


def _serialize_request(r: LeaveRequest) -> dict:
    ep = r.employee_profile
    return {
        "id": r.id,
        "employeeProfileId": r.employee_profile_id,
        "employeeName": ep.full_name if ep else None,
        "employeeCode": ep.employee_code if ep else None,
        "department": ep.department if ep else None,
        "leaveType": r.leave_type,
        "status": r.status,
        "startDate": r.start_date.isoformat() if r.start_date else None,
        "endDate": r.end_date.isoformat() if r.end_date else None,
        "days": r.days,
        "reason": r.reason,
        "managerId": r.manager_id,
        "managerName": r.manager.name if r.manager else None,
        "managerAction": r.manager_action,
        "managerActionAt": r.manager_action_at.isoformat() if r.manager_action_at else None,
        "managerRemarks": r.manager_remarks,
        "hrReviewedBy": r.hr_reviewed_by,
        "hrReviewedAt": r.hr_reviewed_at.isoformat() if r.hr_reviewed_at else None,
        "hrRemarks": r.hr_remarks,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
    }


def _ensure_balances(db: Session, employee_profile_id: str, year: int) -> list[LeaveBalance]:
    existing = {
        b.leave_type: b
        for b in db.scalars(
            select(LeaveBalance).where(
                LeaveBalance.employee_profile_id == employee_profile_id,
                LeaveBalance.year == year,
            )
        )
    }
    result = []
    for lt, days in LEAVE_ALLOCATION.items():
        if lt in existing:
            result.append(existing[lt])
        else:
            b = LeaveBalance(
                id=generate_id(),
                employee_profile_id=employee_profile_id,
                leave_type=lt,
                year=year,
                total_days=days,
                used_days=0,
                pending_days=0,
            )
            db.add(b)
            result.append(b)
    db.flush()
    return result


class ApplyLeaveRequest(BaseModel):
    leave_type: str
    start_date: str
    end_date: str
    reason: str | None = None


class LeaveActionRequest(BaseModel):
    action: str
    remarks: str | None = None


def _validate_leave_action(action: str) -> None:
    if action not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="action must be either 'approved' or 'rejected'")


def _reject_self_leave_review(leave: LeaveRequest, current_user: User) -> None:
    # Prevent self-approval/rejection: the acting reviewer must not be the same
    # person as the leave applicant, regardless of how privileged their role is.
    ep = leave.employee_profile
    if ep and ep.user_id and ep.user_id == current_user.id:
        raise HTTPException(
            status_code=403,
            detail="You cannot review your own leave request.",
        )


@router.get("/balances")
def get_my_balances(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_READ))],
    year: int = Query(default=0),
):
    profile = _profile_for_user(db, current_user)
    if not year:
        year = datetime.now(UTC).year
    balances = _ensure_balances(db, profile.id, year)
    db.commit()
    return [_serialize_balance(b) for b in balances]


def _resolve_leave_employee_code(
    db: Session, current_user: User, employee_code: str | None
) -> str:
    """Return the employee_code whose greytHR balances the caller may view.

    Default is the caller's own code. A different code is allowed only for global
    leave approvers (HR/admin/leadership/TA) — an ordinary employee can never read
    someone else's balances.
    """
    requested = (employee_code or "").strip()
    # Global approvers (HR/admin/leadership/TA) may view anyone by code and need no
    # employee profile of their own.
    if requested and user_has_any_role(current_user, GLOBAL_LEAVE_APPROVER_ROLES):
        return requested
    # Otherwise resolve to the caller's own profile; a non-approver asking for a
    # different code is rejected.
    own_profile = _profile_for_user(db, current_user)
    if not requested or requested.casefold() == (own_profile.employee_code or "").casefold():
        return own_profile.employee_code
    raise HTTPException(status_code=403, detail="Not authorized")


def _greythr_balances_payload(db: Session, *, employee_code: str, year: int) -> dict:
    rows = greythr_leave.get_balances(db, employee_code=employee_code, year=year)
    synced_at = max((b.synced_at for b in rows if b.synced_at), default=None)
    return {
        "employeeCode": employee_code,
        "year": year,
        "syncedAt": synced_at.isoformat() if synced_at else None,
        "balances": [greythr_leave.serialize_balance(b) for b in rows],
    }


@router.get("/greythr-balances")
def get_greythr_balances(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_READ))],
    year: int = Query(default=0),
    employee_code: str | None = Query(default=None, alias="employeeCode"),
):
    """greytHR leave balances (source of truth) for the caller's own employee code.

    Reads stored balances only — fast and resilient if greytHR is unreachable. The
    ``syncedAt`` timestamp tells the UI how fresh the numbers are.
    """
    target_code = _resolve_leave_employee_code(db, current_user, employee_code)
    if not year:
        year = datetime.now(UTC).year
    return _greythr_balances_payload(db, employee_code=target_code, year=year)


@router.post("/greythr-balances/refresh")
def refresh_greythr_balances(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_READ))],
    year: int = Query(default=0),
    employee_code: str | None = Query(default=None, alias="employeeCode"),
):
    """On-demand 'refresh now' — pull one employee's balances from greytHR and upsert.

    Returns 503 until greytHR credentials are configured in env.
    """
    target_code = _resolve_leave_employee_code(db, current_user, employee_code)
    if not year:
        year = datetime.now(UTC).year
    if not get_settings().greythr_configured:
        raise HTTPException(
            status_code=503,
            detail="greytHR sync is not configured yet. Balances will refresh once the integration is enabled.",
        )
    try:
        greythr_leave.sync_employee(db, employee_code=target_code, year=year)
        db.commit()
    except GreytHRNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — surface upstream failures as 502
        db.rollback()
        raise HTTPException(status_code=502, detail=f"greytHR sync failed: {exc}") from exc
    return _greythr_balances_payload(db, employee_code=target_code, year=year)


@router.post("/apply", status_code=201)
def apply_for_leave(
    payload: ApplyLeaveRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_WRITE))],
):
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
            detail="Your assigned reporting manager cannot approve leave requests. Please contact HR.",
        )

    start = datetime.fromisoformat(payload.start_date).replace(tzinfo=UTC)
    end = datetime.fromisoformat(payload.end_date).replace(tzinfo=UTC)
    if end < start:
        raise HTTPException(status_code=400, detail="end_date must be >= start_date")
    days = max(1.0, (end - start).days + 1)

    year = start.year
    balances = _ensure_balances(db, profile.id, year)
    bal = next((b for b in balances if b.leave_type == payload.leave_type), None)
    if bal and payload.leave_type != "unpaid":
        available = bal.total_days - bal.used_days - bal.pending_days
        if days > available:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient balance: {available} days available",
            )
        bal.pending_days += days
        db.add(bal)

    leave = LeaveRequest(
        id=generate_id(),
        employee_profile_id=profile.id,
        leave_type=payload.leave_type,
        status="pending",
        start_date=start,
        end_date=end,
        days=days,
        reason=payload.reason,
        manager_id=manager_id,
    )
    db.add(leave)
    db.flush()

    if manager_id:
        create_notification(
            db,
            user_id=manager_id,
            title="Leave Request Pending",
            message=f"{profile.full_name} applied for {days:.0f} day(s) of {_leave_type_label(payload.leave_type)}.",
            type_=NotificationType.ACTION,
            candidate_id=None,
        )

    log_audit(
        db,
        entity_type="leave_request",
        entity_id=leave.id,
        action="leave_applied",
        actor=current_user,
        new_value={"leaveType": payload.leave_type, "days": days},
    )
    db.commit()
    db.refresh(leave)
    return _serialize_request(leave)


@router.get("/my")
def my_leave_requests(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_READ))],
):
    profile = _profile_for_user(db, current_user)
    rows = list(
        db.scalars(
            select(LeaveRequest)
            .options(joinedload(LeaveRequest.employee_profile), joinedload(LeaveRequest.manager))
            .where(LeaveRequest.employee_profile_id == profile.id)
            .order_by(LeaveRequest.created_at.desc())
        )
    )
    return [_serialize_request(r) for r in rows]


@router.get("/manager/inbox")
def manager_leave_inbox(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_APPROVE))],
):
    rows = list(
        db.scalars(
            select(LeaveRequest)
            .options(joinedload(LeaveRequest.employee_profile), joinedload(LeaveRequest.manager))
            .where(LeaveRequest.manager_id == current_user.id, LeaveRequest.status == "pending")
            .order_by(LeaveRequest.created_at.desc())
        )
    )
    return [_serialize_request(r) for r in rows]


@router.patch("/{leave_id}/manager-action")
def manager_leave_action(
    leave_id: str,
    payload: LeaveActionRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_APPROVE))],
):
    _validate_leave_action(payload.action)

    leave = db.scalar(
        select(LeaveRequest)
        .options(joinedload(LeaveRequest.employee_profile))
        .where(LeaveRequest.id == leave_id)
    )
    if not leave:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if leave.manager_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    _reject_self_leave_review(leave, current_user)
    if leave.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending leave requests can be actioned by the reporting manager")

    leave.manager_action = payload.action
    leave.manager_remarks = payload.remarks
    leave.manager_action_at = datetime.now(UTC)

    if payload.action == "approved":
        leave.status = "manager_approved"
        if leave.employee_profile and leave.employee_profile.user_id:
            create_notification(
                db,
                user_id=leave.employee_profile.user_id,
                title="Leave Approved by Manager",
                message=f"Your {_leave_type_label(leave.leave_type)} has been approved by your manager.",
                type_=NotificationType.SUCCESS,
                candidate_id=None,
            )
    elif payload.action == "rejected":
        leave.status = "rejected"
        bal = db.scalar(
            select(LeaveBalance).where(
                LeaveBalance.employee_profile_id == leave.employee_profile_id,
                LeaveBalance.leave_type == leave.leave_type,
                LeaveBalance.year == leave.start_date.year,
            )
        )
        if bal:
            bal.pending_days = max(0, bal.pending_days - leave.days)
            db.add(bal)
        if leave.employee_profile and leave.employee_profile.user_id:
            create_notification(
                db,
                user_id=leave.employee_profile.user_id,
                title="Leave Rejected",
                message=f"Your {_leave_type_label(leave.leave_type)} request was rejected.",
                type_=NotificationType.WARNING,
                candidate_id=None,
            )

    db.add(leave)
    log_audit(db, entity_type="leave_request", entity_id=leave.id, action=f"manager_{payload.action}", actor=current_user)
    db.commit()
    db.refresh(leave)
    return _serialize_request(leave)


@router.get("/list")
def list_leave_requests(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_READ))],
    status_filter: str | None = Query(default=None, alias="status"),
    employee_id: str | None = Query(default=None, alias="employeeId"),
):
    _require_global_leave_approver(current_user)

    q = (
        select(LeaveRequest)
        .options(joinedload(LeaveRequest.employee_profile), joinedload(LeaveRequest.manager))
        .order_by(LeaveRequest.created_at.desc())
    )
    if status_filter:
        q = q.where(LeaveRequest.status == status_filter)
    if employee_id:
        q = q.where(LeaveRequest.employee_profile_id == employee_id)
    rows = list(db.scalars(q))
    return [_serialize_request(r) for r in rows]


@router.patch("/{leave_id}/hr-action")
def hr_leave_action(
    leave_id: str,
    payload: LeaveActionRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_APPROVE))],
):
    _require_global_leave_approver(current_user)
    _validate_leave_action(payload.action)

    leave = db.scalar(
        select(LeaveRequest)
        .options(joinedload(LeaveRequest.employee_profile))
        .where(LeaveRequest.id == leave_id)
    )
    if not leave:
        raise HTTPException(status_code=404, detail="Leave request not found")
    _reject_self_leave_review(leave, current_user)
    if leave.status not in {"pending", "manager_approved"}:
        raise HTTPException(status_code=400, detail="Only pending or manager-approved leave requests can be actioned by admin or HR")

    leave.hr_reviewed_by = current_user.id
    leave.hr_reviewed_at = datetime.now(UTC)
    leave.hr_remarks = payload.remarks

    if payload.action == "approved":
        leave.status = "approved"
        bal = db.scalar(
            select(LeaveBalance).where(
                LeaveBalance.employee_profile_id == leave.employee_profile_id,
                LeaveBalance.leave_type == leave.leave_type,
                LeaveBalance.year == leave.start_date.year,
            )
        )
        if bal:
            bal.used_days += leave.days
            bal.pending_days = max(0, bal.pending_days - leave.days)
            db.add(bal)
        if leave.employee_profile and leave.employee_profile.user_id:
            create_notification(
                db,
                user_id=leave.employee_profile.user_id,
                title="Leave Approved",
                message=f"Your {_leave_type_label(leave.leave_type)} has been fully approved.",
                type_=NotificationType.SUCCESS,
                candidate_id=None,
            )
    elif payload.action == "rejected":
        leave.status = "rejected"
        bal = db.scalar(
            select(LeaveBalance).where(
                LeaveBalance.employee_profile_id == leave.employee_profile_id,
                LeaveBalance.leave_type == leave.leave_type,
                LeaveBalance.year == leave.start_date.year,
            )
        )
        if bal:
            bal.pending_days = max(0, bal.pending_days - leave.days)
            db.add(bal)
        if leave.employee_profile and leave.employee_profile.user_id:
            create_notification(
                db,
                user_id=leave.employee_profile.user_id,
                title="Leave Rejected",
                message=f"Your {_leave_type_label(leave.leave_type)} request was rejected.",
                type_=NotificationType.WARNING,
                candidate_id=None,
            )

    db.add(leave)
    log_audit(db, entity_type="leave_request", entity_id=leave.id, action=f"hr_{payload.action}", actor=current_user)
    db.commit()
    db.refresh(leave)
    return _serialize_request(leave)
