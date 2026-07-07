from __future__ import annotations

import csv
import io
import re
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_permissions
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import (
    AttendanceRecord,
    AttendanceStatus,
    EmployeeProfile,
    Notification,
    NotificationType,
    ResourceAssignment,
    ResourceProject,
    ResourceProjectLead,
    ResourceTransferRequest,
    Role,
    User,
    utcnow,
)
from app.services.attendance_sync import attendance_today
from app.services.audit import log_audit

router = APIRouter(prefix="/resource-segregation", tags=["resource-segregation"])

RS_ADMIN_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR}
RS_MANAGER_ROLES = RS_ADMIN_ROLES | {Role.MANAGER}
RS_LEAD_ROLES = RS_MANAGER_ROLES | {Role.PL_TPM}


class ProjectCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    code: str | None = None
    description: str | None = None
    manager_id: str | None = Field(default=None, alias="managerId")
    start_date: date | None = Field(default=None, alias="startDate")
    end_date: date | None = Field(default=None, alias="endDate")


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    code: str | None = None
    description: str | None = None
    manager_id: str | None = Field(default=None, alias="managerId")
    status: str | None = None
    start_date: date | None = Field(default=None, alias="startDate")
    end_date: date | None = Field(default=None, alias="endDate")


class LeadUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_ids: list[str] = Field(alias="userIds")
    role_label: str = Field(default="pl_tpm", alias="roleLabel")


class TransferAction(BaseModel):
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


def _is_pl_tpm_designation(value: str | None) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()
    if not normalized:
        return False
    return (
        normalized in {"tpm", "pl"}
        or "project lead" in normalized
        or "technical project manager" in normalized
        or "technical program manager" in normalized
    )


def _ensure_user_role(user: User, role: Role) -> bool:
    roles = [_role_value(item) for item in (user.roles or [user.role])]
    if role.value in roles:
        return False
    current = _role_value(user.role)
    if current not in roles:
        roles.insert(0, current)
    roles.append(role.value)
    user.roles = roles
    return True


def _profile_for_user(db: Session, user: User) -> EmployeeProfile | None:
    return db.scalar(
        select(EmployeeProfile).where(
            or_(
                EmployeeProfile.user_id == user.id,
                func.lower(func.trim(EmployeeProfile.ethara_email)) == user.email.strip().lower(),
            )
        )
    )


def _is_project_lead(db: Session, user: User, project_id: str) -> bool:
    return bool(
        db.scalar(
            select(ResourceProjectLead.id)
            .where(ResourceProjectLead.project_id == project_id, ResourceProjectLead.user_id == user.id)
            .limit(1)
        )
    )


def _can_manage_project(db: Session, user: User, project: ResourceProject) -> bool:
    return _has_any_role(user, RS_ADMIN_ROLES) or project.manager_id == user.id


def _can_assign_project(db: Session, user: User, project: ResourceProject) -> bool:
    return _can_manage_project(db, user, project) or _is_project_lead(db, user, project.id)


def _load_project(db: Session, project_id: str) -> ResourceProject:
    project = db.get(ResourceProject, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _ensure_project_visible(db: Session, user: User, project: ResourceProject) -> None:
    if _can_assign_project(db, user, project):
        return
    profile = _profile_for_user(db, user)
    if profile and db.scalar(
        select(ResourceAssignment.id)
        .where(
            ResourceAssignment.project_id == project.id,
            ResourceAssignment.employee_profile_id == profile.id,
            ResourceAssignment.status == "active",
        )
        .limit(1)
    ):
        return
    raise HTTPException(status_code=403, detail="Not authorized for this project.")


def _notify_in_app(
    db: Session,
    *,
    user_id: str | None,
    title: str,
    message: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> None:
    if not user_id:
        return
    db.add(
        Notification(
            user_id=user_id,
            title=title,
            message=message,
            type=NotificationType.ACTION,
            entity_type=entity_type,
            entity_id=entity_id,
            payload={"route": "/dashboard/resource-segregation"},
        )
    )


def _serialize_user(user: User, profile: EmployeeProfile | None = None) -> dict[str, Any]:
    roles = set(_user_roles(user))
    designation_matches_pl_tpm = _is_pl_tpm_designation(profile.designation if profile else None)
    if designation_matches_pl_tpm:
        roles.add(Role.PL_TPM.value)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": _role_value(user.role),
        "roles": sorted(roles),
        "isActive": user.is_active,
        "employeeProfileId": profile.id if profile else None,
        "employeeCode": profile.employee_code if profile else None,
        "employeeEmail": profile.ethara_email if profile else None,
        "department": profile.department if profile else None,
        "designation": profile.designation if profile else None,
        "designationMatchesPlTpm": designation_matches_pl_tpm,
    }


def _serialize_profile(profile: EmployeeProfile | None) -> dict[str, Any] | None:
    if profile is None:
        return None
    return {
        "id": profile.id,
        "userId": profile.user_id,
        "fullName": profile.full_name,
        "employeeCode": profile.employee_code,
        "etharaEmail": profile.ethara_email,
        "department": profile.department,
        "designation": profile.designation,
    }


def _attendance_state(db: Session, profile: EmployeeProfile, day: date) -> str:
    record = db.scalar(
        select(AttendanceRecord)
        .where(
            AttendanceRecord.employee_profile_id == profile.id,
            AttendanceRecord.attendance_date == day,
        )
        .limit(1)
    )
    if record is None:
        record = db.scalar(
            select(AttendanceRecord)
            .where(
                func.upper(AttendanceRecord.employee_code) == profile.employee_code.upper(),
                AttendanceRecord.attendance_date == day,
            )
            .limit(1)
        )
    if record is None:
        return "absent"
    status_value = record.status.value if isinstance(record.status, AttendanceStatus) else str(record.status)
    return "present" if status_value in {"present", "half_day"} else "absent"


def _serialize_assignment(db: Session, assignment: ResourceAssignment, *, day: date) -> dict[str, Any]:
    profile = assignment.employee_profile
    return {
        "id": assignment.id,
        "projectId": assignment.project_id,
        "projectName": assignment.project.name if assignment.project else None,
        "employee": _serialize_profile(profile),
        "reportingMember": _serialize_profile(assignment.reporting_member),
        "assignedAt": assignment.assigned_at.isoformat() if assignment.assigned_at else None,
        "status": assignment.status,
        "state": _attendance_state(db, profile, day),
    }


def _serialize_project(db: Session, project: ResourceProject, *, day: date) -> dict[str, Any]:
    active_assignments = [assignment for assignment in project.assignments if assignment.status == "active"]
    present = sum(1 for assignment in active_assignments if _attendance_state(db, assignment.employee_profile, day) == "present")
    return {
        "id": project.id,
        "name": project.name,
        "code": project.code,
        "description": project.description,
        "managerId": project.manager_id,
        "managerName": project.manager.name if project.manager else None,
        "status": project.status,
        "startDate": project.start_date.isoformat() if project.start_date else None,
        "endDate": project.end_date.isoformat() if project.end_date else None,
        "leads": [
            {
                "id": lead.id,
                "userId": lead.user_id,
                "name": lead.user.name if lead.user else None,
                "email": lead.user.email if lead.user else None,
                "roleLabel": lead.role_label,
            }
            for lead in project.leads
        ],
        "analytics": {
            "tagged": len(active_assignments),
            "present": present,
            "absent": max(0, len(active_assignments) - present),
        },
        "createdAt": project.created_at.isoformat() if project.created_at else None,
    }


def _serialize_transfer(request: ResourceTransferRequest) -> dict[str, Any]:
    return {
        "id": request.id,
        "employee": _serialize_profile(request.employee_profile),
        "fromProjectId": request.from_project_id,
        "fromProjectName": request.from_project.name if request.from_project else None,
        "toProjectId": request.to_project_id,
        "toProjectName": request.to_project.name if request.to_project else None,
        "reportingMember": _serialize_profile(request.reporting_member),
        "requestedBy": request.requester.name if request.requester else None,
        "reviewerId": request.reviewer_id,
        "reviewerName": request.reviewer.name if request.reviewer else None,
        "status": request.status,
        "reason": request.reason,
        "decisionComment": request.decision_comment,
        "createdAt": request.created_at.isoformat() if request.created_at else None,
        "decidedAt": request.decided_at.isoformat() if request.decided_at else None,
    }


def _visible_project_query(db: Session, user: User):
    base = (
        select(ResourceProject)
        .options(
            joinedload(ResourceProject.manager),
            joinedload(ResourceProject.leads).joinedload(ResourceProjectLead.user),
            joinedload(ResourceProject.assignments).joinedload(ResourceAssignment.employee_profile),
            joinedload(ResourceProject.assignments).joinedload(ResourceAssignment.reporting_member),
        )
        .order_by(ResourceProject.created_at.desc())
    )
    if _has_any_role(user, RS_ADMIN_ROLES):
        return base
    lead_project_ids = select(ResourceProjectLead.project_id).where(ResourceProjectLead.user_id == user.id)
    profile = _profile_for_user(db, user)
    conditions = [ResourceProject.manager_id == user.id, ResourceProject.id.in_(lead_project_ids)]
    if profile is not None:
        assigned_project_ids = select(ResourceAssignment.project_id).where(
            ResourceAssignment.employee_profile_id == profile.id,
            ResourceAssignment.status == "active",
        )
        conditions.append(ResourceProject.id.in_(assigned_project_ids))
    return base.where(or_(*conditions))


def _find_employee_by_email(db: Session, email: str) -> EmployeeProfile | None:
    normalized = email.strip().lower()
    if not normalized:
        return None
    return db.scalar(
        select(EmployeeProfile)
        .join(User, EmployeeProfile.user_id == User.id, isouter=True)
        .where(
            or_(
                func.lower(func.trim(EmployeeProfile.ethara_email)) == normalized,
                func.lower(func.trim(EmployeeProfile.personal_email)) == normalized,
                func.lower(func.trim(User.email)) == normalized,
            )
        )
        .limit(1)
    )


def _find_reporting_member(db: Session, raw: str) -> EmployeeProfile | None:
    """The reporting member must be given as an EMAIL so the manager is identified
    unambiguously — names can collide between employees. Non-email values return None."""
    value = raw.strip()
    if not value or "@" not in value:
        return None
    return _find_employee_by_email(db, value)


def _reader_for_upload(content: bytes) -> list[dict[str, str]]:
    text = content.decode("utf-8-sig")
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    return list(csv.DictReader(io.StringIO(text), dialect=dialect))


def _get_column(row: dict[str, str], *names: str) -> str:
    normalized = {re.sub(r"[^a-z0-9]", "", key.lower()): value for key, value in row.items()}
    for name in names:
        value = normalized.get(re.sub(r"[^a-z0-9]", "", name.lower()))
        if value:
            return str(value).strip()
    return ""


@router.get("/dashboard")
def dashboard(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.RESOURCE_SEGREGATION_READ))],
    day: date | None = None,
):
    target_day = day or attendance_today()
    projects = list(db.scalars(_visible_project_query(db, current_user)).unique())
    project_ids = [project.id for project in projects]
    assignments: list[ResourceAssignment] = []
    transfers: list[ResourceTransferRequest] = []
    if project_ids:
        assignments = list(
            db.scalars(
                select(ResourceAssignment)
                .options(
                    joinedload(ResourceAssignment.project),
                    joinedload(ResourceAssignment.employee_profile),
                    joinedload(ResourceAssignment.reporting_member),
                )
                .where(ResourceAssignment.project_id.in_(project_ids), ResourceAssignment.status == "active")
                .order_by(ResourceAssignment.assigned_at.desc())
            )
        )
        transfers = list(
            db.scalars(
                select(ResourceTransferRequest)
                .options(
                    joinedload(ResourceTransferRequest.employee_profile),
                    joinedload(ResourceTransferRequest.from_project),
                    joinedload(ResourceTransferRequest.to_project),
                    joinedload(ResourceTransferRequest.reporting_member),
                    joinedload(ResourceTransferRequest.requester),
                    joinedload(ResourceTransferRequest.reviewer),
                )
                .where(
                    or_(
                        ResourceTransferRequest.from_project_id.in_(project_ids),
                        ResourceTransferRequest.to_project_id.in_(project_ids),
                        ResourceTransferRequest.reviewer_id == current_user.id,
                    )
                )
                .order_by(ResourceTransferRequest.created_at.desc())
            )
        )
    visible_assignments = assignments
    profile = _profile_for_user(db, current_user)
    if profile and not _has_any_role(current_user, RS_LEAD_ROLES):
        visible_assignments = [item for item in assignments if item.employee_profile_id == profile.id]
    elif profile and not _has_any_role(current_user, RS_MANAGER_ROLES):
        # Project leads (PL/TPM) see EVERY member of the projects they lead or manage —
        # not only the ones who report directly to them — plus their own assignment.
        # (Roster members may report to other managers, or to no one, so a reporting-member
        # filter alone would hide them from the lead who tagged them.)
        led_project_ids = {
            project.id
            for project in projects
            if project.manager_id == current_user.id
            or any(lead.user_id == current_user.id for lead in (project.leads or []))
        }
        visible_assignments = [
            item
            for item in assignments
            if item.project_id in led_project_ids
            or item.reporting_member_profile_id == profile.id
            or item.employee_profile_id == profile.id
        ]
    present = sum(1 for assignment in visible_assignments if _attendance_state(db, assignment.employee_profile, target_day) == "present")
    return {
        "date": target_day.isoformat(),
        "summary": {
            "projects": len(projects),
            "tagged": len(visible_assignments),
            "present": present,
            "absent": max(0, len(visible_assignments) - present),
            "pendingTransfers": len([request for request in transfers if request.status == "pending"]),
        },
        "projects": [_serialize_project(db, project, day=target_day) for project in projects],
        "assignments": [_serialize_assignment(db, assignment, day=target_day) for assignment in visible_assignments],
        "transferRequests": [_serialize_transfer(request) for request in transfers],
    }


@router.get("/people")
def people(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.RESOURCE_SEGREGATION_READ))],
):
    if not _has_any_role(current_user, RS_LEAD_ROLES):
        raise HTTPException(status_code=403, detail="Only managers and project leads can view resource people.")
    users = list(db.scalars(select(User).order_by(User.name.asc())))
    profiles = list(db.scalars(select(EmployeeProfile).order_by(EmployeeProfile.full_name.asc())))
    profiles_by_user_id = {profile.user_id: profile for profile in profiles if profile.user_id}
    profiles_by_email: dict[str, EmployeeProfile] = {}
    for profile in profiles:
        for email in (profile.ethara_email, profile.personal_email):
            if email:
                profiles_by_email.setdefault(email.strip().lower(), profile)
    return {
        "users": [
            _serialize_user(
                user,
                profiles_by_user_id.get(user.id) or profiles_by_email.get(user.email.strip().lower()),
            )
            for user in users
        ],
        "employees": [_serialize_profile(profile) for profile in profiles],
    }


@router.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.RESOURCE_SEGREGATION_WRITE))],
):
    if not _has_any_role(current_user, RS_MANAGER_ROLES):
        raise HTTPException(status_code=403, detail="Only reporting managers can create projects.")
    manager_id = payload.manager_id if _has_any_role(current_user, RS_ADMIN_ROLES) and payload.manager_id else current_user.id
    manager = db.get(User, manager_id)
    if manager is None:
        raise HTTPException(status_code=422, detail="Manager user not found.")
    project = ResourceProject(
        name=payload.name.strip(),
        code=payload.code.strip().upper() if payload.code else None,
        description=payload.description,
        manager_id=manager.id,
        status="active",
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(project)
    db.flush()
    log_audit(db, entity_type="resource_project", entity_id=project.id, action="created", actor=current_user)
    db.commit()
    db.refresh(project)
    return _serialize_project(db, _load_project(db, project.id), day=attendance_today())


@router.patch("/projects/{project_id}")
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.RESOURCE_SEGREGATION_WRITE))],
):
    project = _load_project(db, project_id)
    if not _can_manage_project(db, current_user, project):
        raise HTTPException(status_code=403, detail="Only the reporting manager can update this project.")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "manager_id" and value and not _has_any_role(current_user, RS_ADMIN_ROLES):
            continue
        if field == "code" and isinstance(value, str):
            value = value.strip().upper() or None
        if field == "name" and isinstance(value, str):
            value = value.strip()
        setattr(project, field, value)
    db.add(project)
    log_audit(db, entity_type="resource_project", entity_id=project.id, action="updated", actor=current_user, new_value=data)
    db.commit()
    return _serialize_project(db, _load_project(db, project.id), day=attendance_today())


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.RESOURCE_SEGREGATION_WRITE))],
):
    project = _load_project(db, project_id)
    if not _can_manage_project(db, current_user, project):
        raise HTTPException(status_code=403, detail="Only the reporting manager can delete this project.")
    transfer_requests = db.scalars(
        select(ResourceTransferRequest).where(
            or_(
                ResourceTransferRequest.from_project_id == project.id,
                ResourceTransferRequest.to_project_id == project.id,
            )
        )
    ).all()
    log_audit(
        db,
        entity_type="resource_project",
        entity_id=project.id,
        action="deleted",
        actor=current_user,
        old_value={
            "name": project.name,
            "code": project.code,
            "transferRequests": len(transfer_requests),
            "assignments": len(project.assignments),
            "leads": len(project.leads),
        },
    )
    for request in transfer_requests:
        db.delete(request)
    db.delete(project)
    db.commit()
    return {"message": "Project deleted successfully."}


@router.post("/projects/{project_id}/leads")
def set_project_leads(
    project_id: str,
    payload: LeadUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.RESOURCE_SEGREGATION_WRITE))],
):
    project = _load_project(db, project_id)
    if not _can_manage_project(db, current_user, project):
        raise HTTPException(status_code=403, detail="Only the reporting manager can assign PL/TPM users.")
    selected = [db.get(User, user_id) for user_id in payload.user_ids]
    missing = [user_id for user_id, user in zip(payload.user_ids, selected, strict=False) if user is None]
    if missing:
        raise HTTPException(status_code=422, detail=f"Users not found: {', '.join(missing)}")
    existing = {
        lead.user_id: lead
        for lead in db.scalars(select(ResourceProjectLead).where(ResourceProjectLead.project_id == project.id))
    }
    desired = {user.id for user in selected if user is not None}
    for user in selected:
        if user is None:
            continue
        if _ensure_user_role(user, Role.PL_TPM):
            db.add(user)
        if user.id not in existing:
            db.add(ResourceProjectLead(project_id=project.id, user_id=user.id, role_label=payload.role_label))
        else:
            existing[user.id].role_label = payload.role_label
            db.add(existing[user.id])
    for user_id, lead in existing.items():
        if user_id not in desired:
            db.delete(lead)
    log_audit(db, entity_type="resource_project", entity_id=project.id, action="leads_updated", actor=current_user, new_value={"userIds": list(desired)})
    db.commit()
    return _serialize_project(db, _load_project(db, project.id), day=attendance_today())


def _reviewer_for_project(db: Session, project: ResourceProject) -> str | None:
    lead = db.scalar(
        select(ResourceProjectLead)
        .where(ResourceProjectLead.project_id == project.id)
        .order_by(ResourceProjectLead.created_at.asc())
        .limit(1)
    )
    return lead.user_id if lead else project.manager_id


def _request_transfer(
    db: Session,
    *,
    employee: EmployeeProfile,
    current_assignment: ResourceAssignment,
    target_project: ResourceProject,
    reporting_member: EmployeeProfile | None,
    current_user: User,
) -> ResourceTransferRequest:
    existing = db.scalar(
        select(ResourceTransferRequest)
        .where(
            ResourceTransferRequest.employee_profile_id == employee.id,
            ResourceTransferRequest.from_project_id == current_assignment.project_id,
            ResourceTransferRequest.to_project_id == target_project.id,
            ResourceTransferRequest.status == "pending",
        )
        .limit(1)
    )
    if existing is not None:
        return existing
    request = ResourceTransferRequest(
        employee_profile_id=employee.id,
        from_project_id=current_assignment.project_id,
        to_project_id=target_project.id,
        reporting_member_profile_id=reporting_member.id if reporting_member else None,
        requested_by=current_user.id,
        reviewer_id=_reviewer_for_project(db, current_assignment.project),
        status="pending",
        reason=f"{employee.full_name} is already tagged to {current_assignment.project.name}.",
    )
    db.add(request)
    db.flush()
    _notify_in_app(
        db,
        user_id=request.reviewer_id,
        title="Resource transfer approval needed",
        message=f"{employee.full_name} is requested for {target_project.name}.",
        entity_type="resource_transfer_request",
        entity_id=request.id,
    )
    return request


@router.post("/projects/{project_id}/assignments/upload")
async def upload_assignments(
    project_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.RESOURCE_SEGREGATION_WRITE))],
    file: UploadFile = File(...),
):
    project = _load_project(db, project_id)
    if not _can_assign_project(db, current_user, project):
        raise HTTPException(status_code=403, detail="Only the manager or project PL/TPM can tag employees.")
    content = await file.read()
    rows = _reader_for_upload(content)
    results: list[dict[str, Any]] = []
    accepted = rejected = transfer_requested = 0
    for index, row in enumerate(rows, start=2):
        name = _get_column(row, "Name", "Employee Name")
        email = _get_column(row, "Email", "Official Email", "Employee Email")
        reporting_raw = _get_column(
            row,
            "Reporting Member", "Reporting Manager", "Reporting Manager Email",
            "Reporting Manager Mail", "Reporting Email", "Reporting Mail",
            "Manager Email", "Reporting", "QL", "QR",
        )
        result = {"row": index, "name": name, "email": email, "status": "rejected", "reason": ""}
        if not email or "@" not in email:
            result["reason"] = "Email is missing or invalid."
            rejected += 1
            results.append(result)
            continue
        employee = _find_employee_by_email(db, email)
        if employee is None:
            result["reason"] = "No employee profile found for this email."
            rejected += 1
            results.append(result)
            continue
        if name and re.sub(r"\s+", " ", employee.full_name).casefold() != re.sub(r"\s+", " ", name).casefold():
            result["reason"] = f"Name mismatch for email. DB has {employee.full_name}."
            rejected += 1
            results.append(result)
            continue
        reporting_member = None
        if reporting_raw:
            if "@" not in reporting_raw:
                result["reason"] = "Reporting member must be an email address."
                rejected += 1
                results.append(result)
                continue
            reporting_member = _find_reporting_member(db, reporting_raw)
            if reporting_member is None:
                result["reason"] = "Reporting member email not found."
                rejected += 1
                results.append(result)
                continue
        current_assignment = db.scalar(
            select(ResourceAssignment)
            .options(joinedload(ResourceAssignment.project))
            .where(ResourceAssignment.employee_profile_id == employee.id, ResourceAssignment.status == "active")
            .order_by(ResourceAssignment.assigned_at.desc())
            .limit(1)
        )
        if current_assignment and current_assignment.project_id != project.id:
            transfer = _request_transfer(
                db,
                employee=employee,
                current_assignment=current_assignment,
                target_project=project,
                reporting_member=reporting_member,
                current_user=current_user,
            )
            result.update(status="transfer_requested", reason=f"Transfer request created: {transfer.id}")
            transfer_requested += 1
            results.append(result)
            continue
        assignment = current_assignment or db.scalar(
            select(ResourceAssignment).where(
                ResourceAssignment.employee_profile_id == employee.id,
                ResourceAssignment.project_id == project.id,
                ResourceAssignment.status == "active",
            )
        )
        if assignment is None:
            assignment = ResourceAssignment(
                project_id=project.id,
                employee_profile_id=employee.id,
                assigned_by=current_user.id,
                assigned_at=utcnow(),
                status="active",
            )
        assignment.reporting_member_profile_id = reporting_member.id if reporting_member else None
        db.add(assignment)
        result.update(status="accepted", reason="Tagged to project.")
        accepted += 1
        results.append(result)
    log_audit(db, entity_type="resource_project", entity_id=project.id, action="assignments_uploaded", actor=current_user, new_value={"accepted": accepted, "rejected": rejected, "transferRequested": transfer_requested})
    db.commit()
    return {
        "total": len(results),
        "accepted": accepted,
        "rejected": rejected,
        "transferRequested": transfer_requested,
        "results": results,
    }


@router.post("/transfer-requests/{request_id}/action")
def transfer_action(
    request_id: str,
    payload: TransferAction,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.RESOURCE_SEGREGATION_WRITE))],
):
    request = db.get(ResourceTransferRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Transfer request not found.")
    if request.status != "pending":
        raise HTTPException(status_code=400, detail="Transfer request is already closed.")
    if not (
        _has_any_role(current_user, RS_ADMIN_ROLES)
        or request.reviewer_id == current_user.id
        or _can_manage_project(db, current_user, request.from_project)
        or _is_project_lead(db, current_user, request.from_project_id)
    ):
        raise HTTPException(status_code=403, detail="Only current project owners can review this transfer.")
    action = payload.action.strip().lower()
    if action not in {"approve", "reject"}:
        raise HTTPException(status_code=422, detail="Action must be approve or reject.")
    comment = (payload.comment or "").strip()
    if action == "reject" and not comment:
        raise HTTPException(status_code=422, detail="Rejection reason is required.")
    now = datetime.now(UTC)
    if action == "approve":
        for assignment in db.scalars(
            select(ResourceAssignment).where(
                ResourceAssignment.employee_profile_id == request.employee_profile_id,
                ResourceAssignment.status == "active",
            )
        ):
            assignment.status = "released"
            db.add(assignment)
        db.add(
            ResourceAssignment(
                project_id=request.to_project_id,
                employee_profile_id=request.employee_profile_id,
                reporting_member_profile_id=request.reporting_member_profile_id,
                assigned_by=request.requested_by,
                assigned_at=now,
                status="active",
            )
        )
        request.status = "approved"
    else:
        request.status = "rejected"
    request.decided_at = now
    request.decision_comment = comment or None
    db.add(request)
    notification_message = f"{request.employee_profile.full_name}'s transfer to {request.to_project.name} was {request.status}."
    if comment:
        notification_message = f"{notification_message} Reason: {comment}"
    _notify_in_app(
        db,
        user_id=request.requested_by,
        title="Resource transfer updated",
        message=notification_message,
        entity_type="resource_transfer_request",
        entity_id=request.id,
    )
    log_audit(db, entity_type="resource_transfer_request", entity_id=request.id, action=f"transfer_{action}", actor=current_user)
    db.commit()
    return _serialize_transfer(request)
