from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_permissions
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import EmployeeProfile, LeaveRequest, Role, User
from app.services.audit import log_audit
from app.services.employees import normalize_blood_group

router = APIRouter(prefix="/manager", tags=["manager"])

ASSIGNABLE_MANAGER_ROLES = {Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}
ASSIGNABLE_MANAGER_ROLE_VALUES = {role.value for role in ASSIGNABLE_MANAGER_ROLES}


def _role_value(role: Role | str) -> str:
    return role.value if isinstance(role, Role) else str(role)


def _is_assignable_manager(user: User | None) -> bool:
    if user is None:
        return False
    user_roles = {_role_value(user.role)}
    user_roles.update(_role_value(role) for role in (user.roles or []))
    return bool(user_roles & ASSIGNABLE_MANAGER_ROLE_VALUES)


def _serialize_employee(ep: EmployeeProfile) -> dict:
    return {
        "id": ep.id,
        "fullName": ep.full_name,
        "employeeCode": ep.employee_code,
        "etharaEmail": ep.ethara_email,
        "personalEmail": ep.personal_email,
        "phone": ep.phone,
        "department": ep.department,
        "designation": ep.designation,
        "gender": ep.gender,
        "bloodGroup": ep.blood_group,
        "managerId": ep.manager_id,
        "createdAt": ep.created_at.isoformat() if ep.created_at else None,
    }


@router.get("/team")
def get_my_team(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.TEAM_READ))],
):
    team = list(
        db.scalars(
            select(EmployeeProfile)
            .where(EmployeeProfile.manager_id == current_user.id)
            .order_by(EmployeeProfile.full_name)
        )
    )
    return [_serialize_employee(ep) for ep in team]


@router.patch("/employee/{employee_id}/set-manager")
def set_employee_manager(
    employee_id: str,
    manager_id: str = Query(alias="managerId"),
    db: Annotated[Session, Depends(get_db)] = None,
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))] = None,
):
    profile = db.get(EmployeeProfile, employee_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Employee not found")
    # No self-management: an employee cannot be set as their own reporting manager.
    if profile.user_id and profile.user_id == manager_id:
        raise HTTPException(status_code=400, detail="An employee cannot be their own manager")
    manager = db.get(User, manager_id)
    if not _is_assignable_manager(manager):
        raise HTTPException(status_code=400, detail="Invalid manager user")
    profile.manager_id = manager_id
    db.add(profile)
    log_audit(db, entity_type="employee_profile", entity_id=employee_id, action="manager_assigned", actor=current_user, new_value={"managerId": manager_id})
    db.commit()
    return {"message": "Manager assigned", "managerId": manager_id}


@router.patch("/employee/{employee_id}/profile")
def update_employee_profile(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
    blood_group: str | None = Query(default=None, alias="bloodGroup"),
    emergency_contact_name: str | None = Query(default=None, alias="emergencyContactName"),
    emergency_contact_phone: str | None = Query(default=None, alias="emergencyContactPhone"),
    emergency_contact_relation: str | None = Query(default=None, alias="emergencyContactRelation"),
):
    profile = db.get(EmployeeProfile, employee_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Employee not found")
    if blood_group is not None:
        profile.blood_group = normalize_blood_group(blood_group)
    if emergency_contact_name is not None:
        profile.emergency_contact_name = emergency_contact_name
    if emergency_contact_phone is not None:
        profile.emergency_contact_phone = emergency_contact_phone
    if emergency_contact_relation is not None:
        profile.emergency_contact_relation = emergency_contact_relation
    db.add(profile)
    db.commit()
    return _serialize_employee(profile)


class UpdateProfileBody(BaseModel):
    blood_group: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relation: str | None = None
    manager_id: str | None = None


@router.patch("/employee/{employee_id}/update")
def update_employee_profile_body(
    employee_id: str,
    payload: UpdateProfileBody,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
):
    profile = db.get(EmployeeProfile, employee_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Employee not found")
    # Use exclude_unset so that explicitly-passed null values (e.g. manager_id=None
    # to remove a manager) are applied rather than silently skipped.
    updates = payload.model_dump(exclude_unset=True)
    if "manager_id" in updates and updates["manager_id"]:
        if profile.user_id and profile.user_id == updates["manager_id"]:
            raise HTTPException(status_code=400, detail="An employee cannot be their own manager")
        if not _is_assignable_manager(db.get(User, updates["manager_id"])):
            raise HTTPException(status_code=400, detail="Invalid manager user")
    for field, value in updates.items():
        setattr(profile, field, value)
    db.add(profile)
    log_audit(db, entity_type="employee_profile", entity_id=employee_id, action="profile_updated", actor=current_user)
    db.commit()
    return _serialize_employee(profile)


@router.get("/team/leave-requests")
def team_leave_requests(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.LEAVE_APPROVE))],
    status_filter: str | None = Query(default=None, alias="status"),
):
    q = (
        select(LeaveRequest)
        .options(joinedload(LeaveRequest.employee_profile), joinedload(LeaveRequest.manager))
        .where(LeaveRequest.manager_id == current_user.id)
        .order_by(LeaveRequest.created_at.desc())
    )
    if status_filter:
        q = q.where(LeaveRequest.status == status_filter)
    rows = list(db.scalars(q))

    def _s(r: LeaveRequest) -> dict:
        ep = r.employee_profile
        return {
            "id": r.id,
            "employeeName": ep.full_name if ep else None,
            "employeeCode": ep.employee_code if ep else None,
            "leaveType": r.leave_type,
            "status": r.status,
            "startDate": r.start_date.isoformat() if r.start_date else None,
            "endDate": r.end_date.isoformat() if r.end_date else None,
            "days": r.days,
            "reason": r.reason,
            "managerAction": r.manager_action,
            "managerActionAt": r.manager_action_at.isoformat() if r.manager_action_at else None,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
        }

    return [_s(r) for r in rows]
