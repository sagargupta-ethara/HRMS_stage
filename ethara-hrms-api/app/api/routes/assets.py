from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_permissions, user_has_any_role
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import (
    EmployeeAsset,
    EmployeeProfile,
    OffboardingChecklist,
    Role,
    User,
    generate_id,
)
from app.services.audit import log_audit

router = APIRouter(prefix="/assets", tags=["assets"])

MAX_ASSET_BULK_CSV_BYTES = 5 * 1024 * 1024
MAX_ASSET_BULK_ROWS = 1000
VALID_ASSET_STATUSES = {"assigned", "returned", "damaged"}

# Admin tiers can sign off on any clearance flag. Otherwise each offboarding
# clearance flag is bound to the role responsible for that clearance, so e.g.
# an it_team member cannot mark HR clearance or office-admin clearance.
_OFFBOARDING_ADMIN_ROLES = {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}
_CLEARANCE_ALLOWED_ROLES = {
    "it_cleared": {Role.IT_TEAM, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP},
    "office_admin_cleared": {Role.OFFICE_ADMIN, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP},
    "hr_cleared": {Role.HR, Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP},
}
_CLEARANCE_LABELS = {
    "it_cleared": "IT clearance",
    "office_admin_cleared": "office-admin clearance",
    "hr_cleared": "HR clearance",
}


def _parse_csv_header(raw: str) -> str:
    return raw.strip().lower().replace(" ", "_").replace("-", "_").replace("/", "_")


def _pick(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = row.get(key, "").strip()
        if value:
            return value
    return ""


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "issued", "included"}


def _parse_optional_datetime(value: str) -> datetime | None:
    text = value.strip()
    if not text:
        return None
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                parsed = None
        if parsed is None:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _find_employee_profile(db: Session, *, employee_code: str, employee_email: str) -> EmployeeProfile | None:
    filters = []
    if employee_code:
        filters.append(EmployeeProfile.employee_code == employee_code)
    if employee_email:
        filters.append(func.lower(EmployeeProfile.ethara_email) == employee_email.lower())
    if not filters:
        return None
    return db.scalar(select(EmployeeProfile).where(or_(*filters)).limit(1))


def _ensure_clearance_role(flag: str, current_user: User) -> None:
    allowed = _CLEARANCE_ALLOWED_ROLES[flag]
    if not user_has_any_role(current_user, allowed):
        raise HTTPException(
            status_code=403,
            detail=f"Your role is not authorized to set {_CLEARANCE_LABELS[flag]}.",
        )


def _serialize(a: EmployeeAsset) -> dict:
    ep = a.employee_profile
    return {
        "id": a.id,
        "employeeProfileId": a.employee_profile_id,
        "employeeName": ep.full_name if ep else None,
        "employeeCode": ep.employee_code if ep else None,
        "assetType": a.asset_type,
        "model": a.model,
        "serialNumber": a.serial_number,
        "chargerIssued": a.charger_issued,
        "assetTag": a.asset_tag,
        "status": a.status,
        "assignedAt": a.assigned_at.isoformat() if a.assigned_at else None,
        "returnedAt": a.returned_at.isoformat() if a.returned_at else None,
        "returnCondition": a.return_condition,
        "notes": a.notes,
        "createdAt": a.created_at.isoformat() if a.created_at else None,
    }


def _serialize_checklist(c: OffboardingChecklist) -> dict:
    return {
        "id": c.id,
        "separationId": c.separation_id,
        "employeeProfileId": c.employee_profile_id,
        "laptopReturned": c.laptop_returned,
        "laptopReturnDate": c.laptop_return_date.isoformat() if c.laptop_return_date else None,
        "laptopCondition": c.laptop_condition,
        "idCardReturned": c.id_card_returned,
        "idCardReturnDate": c.id_card_return_date.isoformat() if c.id_card_return_date else None,
        "itClearedBy": c.it_cleared_by,
        "itClearedAt": c.it_cleared_at.isoformat() if c.it_cleared_at else None,
        "officeAdminClearedBy": c.office_admin_cleared_by,
        "officeAdminClearedAt": c.office_admin_cleared_at.isoformat() if c.office_admin_cleared_at else None,
        "hrClearedBy": c.hr_cleared_by,
        "hrClearedAt": c.hr_cleared_at.isoformat() if c.hr_cleared_at else None,
        "status": c.status,
        "createdAt": c.created_at.isoformat() if c.created_at else None,
        "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
    }


class AssignAssetRequest(BaseModel):
    employee_profile_id: str
    asset_type: str
    model: str | None = None
    serial_number: str | None = None
    charger_issued: bool = False
    asset_tag: str | None = None
    notes: str | None = None


class UpdateAssetRequest(BaseModel):
    employee_profile_id: str | None = None
    model: str | None = None
    serial_number: str | None = None
    charger_issued: bool | None = None
    asset_tag: str | None = None
    notes: str | None = None
    status: str | None = None
    return_condition: str | None = None


class OffboardingUpdateRequest(BaseModel):
    laptop_returned: bool | None = None
    laptop_condition: str | None = None
    id_card_returned: bool | None = None
    it_cleared: bool | None = None
    office_admin_cleared: bool | None = None
    hr_cleared: bool | None = None


@router.post("/bulk-import", status_code=status.HTTP_201_CREATED)
def bulk_import_assets(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ASSETS_WRITE))],
    csv_file: Annotated[UploadFile, File(alias="csvFile")],
) -> dict:
    raw_bytes = csv_file.file.read()
    if len(raw_bytes) == 0:
        raise HTTPException(status_code=422, detail="CSV file is empty.")
    if len(raw_bytes) > MAX_ASSET_BULK_CSV_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"CSV file is too large. Maximum allowed size is {MAX_ASSET_BULK_CSV_BYTES // (1024 * 1024)} MB.",
        )
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=422, detail="CSV file appears empty or has no header row.")

    rows = [
        {_parse_csv_header(k): (v or "").strip() for k, v in row.items() if k}
        for row in reader
    ]
    if not rows:
        raise HTTPException(status_code=422, detail="CSV has no data rows.")
    if len(rows) > MAX_ASSET_BULK_ROWS:
        raise HTTPException(
            status_code=422,
            detail=f"Too many rows ({len(rows)}). Please split the file into batches of at most {MAX_ASSET_BULK_ROWS}.",
        )

    imported: list[dict] = []
    failed: list[dict] = []

    for idx, row in enumerate(rows):
        row_num = idx + 2
        employee_code = _pick(row, "employee_code", "emp_code", "code", "employee_id")
        employee_email = _pick(row, "employee_email", "ethara_email", "company_email", "email", "work_email")
        asset_type = _pick(row, "asset_type", "type", "asset")
        model = _pick(row, "model", "asset_model", "device_model")
        serial_number = _pick(row, "serial_number", "serial", "serial_no", "serial_number_imei")
        asset_tag = _pick(row, "asset_tag", "tag", "inventory_tag")
        notes = _pick(row, "notes", "remarks")
        return_condition = _pick(row, "return_condition", "condition")
        asset_status = (_pick(row, "status") or "assigned").lower()
        assigned_at = _parse_optional_datetime(_pick(row, "assigned_at", "assigned_date"))
        returned_at = _parse_optional_datetime(_pick(row, "returned_at", "returned_date"))

        errors: list[str] = []
        if not employee_code and not employee_email:
            errors.append("Employee code or employee email is required")
        if not asset_type:
            errors.append("Asset type is required")
        if asset_status not in VALID_ASSET_STATUSES:
            errors.append("Status must be assigned, returned, or damaged")

        profile = _find_employee_profile(
            db,
            employee_code=employee_code,
            employee_email=employee_email,
        )
        if not profile:
            errors.append("Employee profile not found")

        duplicate_filters = []
        if serial_number:
            duplicate_filters.append(func.lower(EmployeeAsset.serial_number) == serial_number.lower())
        if asset_tag:
            duplicate_filters.append(func.lower(EmployeeAsset.asset_tag) == asset_tag.lower())
        if duplicate_filters and db.scalar(select(EmployeeAsset.id).where(or_(*duplicate_filters)).limit(1)):
            errors.append("An asset with this serial number or asset tag already exists")

        if errors:
            failed.append(
                {
                    "row": row_num,
                    "employeeCode": employee_code,
                    "employeeEmail": employee_email,
                    "assetType": asset_type,
                    "serialNumber": serial_number,
                    "assetTag": asset_tag,
                    "errors": errors,
                }
            )
            continue

        try:
            sp = db.begin_nested()
            asset = EmployeeAsset(
                id=generate_id(),
                employee_profile_id=profile.id,
                employee_profile=profile,
                asset_type=asset_type,
                model=model or None,
                serial_number=serial_number or None,
                charger_issued=_parse_bool(_pick(row, "charger_issued", "charger", "charger_included")),
                asset_tag=asset_tag or None,
                status=asset_status,
                assigned_at=assigned_at or datetime.now(UTC),
                assigned_by=current_user.id,
                returned_at=returned_at or (datetime.now(UTC) if asset_status == "returned" else None),
                return_condition=return_condition or None,
                notes=notes or None,
            )
            db.add(asset)
            db.flush()
            log_audit(
                db,
                entity_type="employee_asset",
                entity_id=asset.id,
                action="asset_bulk_imported",
                actor=current_user,
                new_value={
                    "assetType": asset_type,
                    "employeeProfileId": profile.id,
                    "employeeCode": profile.employee_code,
                    "assetTag": asset_tag,
                    "serialNumber": serial_number,
                },
            )
            sp.commit()
            imported.append(
                {
                    "id": asset.id,
                    "employeeName": profile.full_name,
                    "employeeCode": profile.employee_code,
                    "assetType": asset.asset_type,
                    "serialNumber": asset.serial_number,
                    "assetTag": asset.asset_tag,
                }
            )
        except IntegrityError:
            sp.rollback()
            failed.append(
                {
                    "row": row_num,
                    "employeeCode": employee_code,
                    "employeeEmail": employee_email,
                    "assetType": asset_type,
                    "serialNumber": serial_number,
                    "assetTag": asset_tag,
                    "errors": ["A duplicate asset record was detected"],
                }
            )

    db.commit()
    return {
        "total": len(rows),
        "imported": len(imported),
        "failed": len(failed),
        "results": imported,
        "errors": failed,
    }


@router.post("/assign", status_code=201)
def assign_asset(
    payload: AssignAssetRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ASSETS_WRITE))],
):
    profile = db.get(EmployeeProfile, payload.employee_profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Employee profile not found")

    asset = EmployeeAsset(
        id=generate_id(),
        employee_profile_id=payload.employee_profile_id,
        asset_type=payload.asset_type,
        model=payload.model,
        serial_number=payload.serial_number,
        charger_issued=payload.charger_issued,
        asset_tag=payload.asset_tag,
        status="assigned",
        assigned_at=datetime.now(UTC),
        assigned_by=current_user.id,
        notes=payload.notes,
    )
    db.add(asset)
    log_audit(
        db,
        entity_type="employee_asset",
        entity_id=asset.id,
        action="asset_assigned",
        actor=current_user,
        new_value={"assetType": payload.asset_type, "employeeProfileId": payload.employee_profile_id},
    )
    db.commit()
    db.refresh(asset)
    return _serialize(asset)


@router.get("/list")
def list_assets(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.ASSETS_READ))],
    employee_id: str | None = Query(default=None, alias="employeeId"),
    asset_type: str | None = Query(default=None, alias="assetType"),
    status_filter: str | None = Query(default=None, alias="status"),
):
    q = (
        select(EmployeeAsset)
        .options(joinedload(EmployeeAsset.employee_profile))
        .order_by(EmployeeAsset.created_at.desc())
    )
    if employee_id:
        q = q.where(EmployeeAsset.employee_profile_id == employee_id)
    if asset_type:
        q = q.where(EmployeeAsset.asset_type == asset_type)
    if status_filter:
        q = q.where(EmployeeAsset.status == status_filter)
    return [_serialize(a) for a in db.scalars(q)]


@router.patch("/{asset_id}")
def update_asset(
    asset_id: str,
    payload: UpdateAssetRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.ASSETS_WRITE))],
):
    asset = db.get(EmployeeAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    is_reassignment = (
        payload.employee_profile_id is not None
        and payload.employee_profile_id != asset.employee_profile_id
    )

    if payload.employee_profile_id is not None:
        profile = db.get(EmployeeProfile, payload.employee_profile_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Target employee profile not found")
        previous_employee_id = asset.employee_profile_id
        asset.employee_profile_id = payload.employee_profile_id
        asset.status = "assigned"
        asset.assigned_at = datetime.now(UTC)
        asset.returned_at = None
        asset.return_condition = None

    for field, value in payload.model_dump(exclude_none=True, exclude={"employee_profile_id"}).items():
        setattr(asset, field, value)

    if payload.status == "returned" and payload.employee_profile_id is None:
        asset.returned_at = datetime.now(UTC)

    db.add(asset)
    action = "asset_reassigned" if is_reassignment else "asset_updated"
    extra = {}
    if is_reassignment:
        extra = {
            "previousEmployeeProfileId": previous_employee_id,
            "newEmployeeProfileId": payload.employee_profile_id,
        }
    log_audit(db, entity_type="employee_asset", entity_id=asset.id, action=action, actor=current_user, new_value=extra or None)
    db.commit()
    db.refresh(asset)
    return _serialize(asset)


@router.get("/employee/{employee_id}")
def get_employee_assets(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.ASSETS_READ))],
):
    rows = list(
        db.scalars(
            select(EmployeeAsset)
            .options(joinedload(EmployeeAsset.employee_profile))
            .where(EmployeeAsset.employee_profile_id == employee_id)
            .order_by(EmployeeAsset.created_at.desc())
        )
    )
    return [_serialize(a) for a in rows]


@router.get("/offboarding/{separation_id}")
def get_offboarding_checklist(
    separation_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.ASSETS_READ))],
):
    checklist = db.scalar(
        select(OffboardingChecklist).where(OffboardingChecklist.separation_id == separation_id)
    )
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist not found")
    return _serialize_checklist(checklist)


@router.patch("/offboarding/{checklist_id}")
def update_offboarding_checklist(
    checklist_id: str,
    payload: OffboardingUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.OFFBOARDING_WRITE))],
):
    checklist = db.get(OffboardingChecklist, checklist_id)
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist not found")

    now = datetime.now(UTC)
    if payload.laptop_returned is not None:
        checklist.laptop_returned = payload.laptop_returned
        if payload.laptop_returned:
            checklist.laptop_return_date = now
    if payload.laptop_condition is not None:
        checklist.laptop_condition = payload.laptop_condition
    if payload.id_card_returned is not None:
        checklist.id_card_returned = payload.id_card_returned
        if payload.id_card_returned:
            checklist.id_card_return_date = now
    if payload.it_cleared:
        _ensure_clearance_role("it_cleared", current_user)
        checklist.it_cleared_by = current_user.id
        checklist.it_cleared_at = now
    if payload.office_admin_cleared:
        _ensure_clearance_role("office_admin_cleared", current_user)
        checklist.office_admin_cleared_by = current_user.id
        checklist.office_admin_cleared_at = now
    if payload.hr_cleared:
        _ensure_clearance_role("hr_cleared", current_user)
        checklist.hr_cleared_by = current_user.id
        checklist.hr_cleared_at = now

    if (
        checklist.laptop_returned
        and checklist.id_card_returned
        and checklist.it_cleared_at
        and checklist.office_admin_cleared_at
    ):
        checklist.status = "completed"

    db.add(checklist)
    log_audit(db, entity_type="offboarding_checklist", entity_id=checklist.id, action="checklist_updated", actor=current_user)
    db.commit()
    db.refresh(checklist)
    return _serialize_checklist(checklist)
