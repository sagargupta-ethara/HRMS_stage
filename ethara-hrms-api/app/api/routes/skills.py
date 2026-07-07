"""Employee skill tagging: tag employees with rated skills and report against RS projects.

The skill catalog is DB-backed (``skill_catalog`` table). Users with Employee
Evaluation access can add new global skills. The legacy hardcoded ``generalist``
key is aliased to ``generalist_foundation`` on read so pre-existing tags keep
displaying correctly without a data migration.
"""

import csv
import io
import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_permissions, require_roles
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import (
    EmployeeProfile,
    EmployeeSkillTag,
    ResourceAssignment,
    Role,
    SkillCatalog,
    User,
)


router = APIRouter(prefix="/skills", tags=["skills"])

# Roles allowed to manage the global skill catalog (create new skills). Matches
# the Employee Evaluation module audience.
CATALOG_ADMIN_ROLES = (
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.LEADERSHIP,
    Role.HR,
    Role.EVALUATOR,
)

# Fallback used only if the skill_catalog table is somehow empty. No "generalist"
# entry — it was replaced by "generalist_foundation".
SEED_CATALOG: list[dict[str, str]] = [
    {"key": "python", "label": "Python"},
    {"key": "git", "label": "Git"},
    {"key": "docker", "label": "Docker"},
    {"key": "generalist_foundation", "label": "Generalist Foundation"},
    {"key": "evals", "label": "Evals"},
    {"key": "labeling", "label": "Labeling"},
    {"key": "prompt_writing", "label": "Prompt Writing"},
]

# Legacy skill keys mapped to their current catalog key on read.
LEGACY_SKILL_ALIASES = {"generalist": "generalist_foundation"}


class SkillEntry(BaseModel):
    skill: str
    rating: int = Field(ge=1, le=5)


class SkillUpdateRequest(BaseModel):
    skills: list[SkillEntry]


class SkillCatalogCreateRequest(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    key: str | None = Field(default=None, max_length=50)


def _canonical_skill(key: str) -> str:
    return LEGACY_SKILL_ALIASES.get(key, key)


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower()).strip("_")
    return slug[:50]


def _load_catalog(db: Session) -> tuple[list[dict[str, str]], dict[str, str]]:
    """Return (ordered catalog list, {key: label}) for active skills."""
    rows = db.scalars(
        select(SkillCatalog).where(SkillCatalog.is_active.is_(True)).order_by(SkillCatalog.label.asc())
    ).all()
    catalog = [{"key": row.key, "label": row.label} for row in rows] or list(SEED_CATALOG)
    label_map = {item["key"]: item["label"] for item in catalog}
    # Ensure alias targets resolve even if a legacy row lingers.
    for legacy, target in LEGACY_SKILL_ALIASES.items():
        if target in label_map:
            label_map[legacy] = label_map[target]
    return catalog, label_map


def _normalize_skill(raw: str | None, label_map: dict[str, str]) -> str | None:
    key = _canonical_skill((raw or "").strip().lower())
    return key if key in label_map else None


def _csv_safe(value: Any) -> str:
    text = "" if value is None else str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{text}"
    return text


def _active_projects_by_employee(db: Session) -> dict[str, dict[str, str | None]]:
    assignments = db.scalars(
        select(ResourceAssignment)
        .options(joinedload(ResourceAssignment.project))
        .where(ResourceAssignment.status == "active")
        .order_by(ResourceAssignment.assigned_at.asc())
    ).all()
    by_employee: dict[str, dict[str, str | None]] = {}
    # Ascending order means the latest assignment wins.
    for assignment in assignments:
        by_employee[assignment.employee_profile_id] = {
            "id": assignment.project_id,
            "name": assignment.project.name if assignment.project else None,
        }
    return by_employee


def _tags_by_employee(db: Session) -> dict[str, list[EmployeeSkillTag]]:
    grouped: dict[str, list[EmployeeSkillTag]] = {}
    for tag in db.scalars(select(EmployeeSkillTag)).all():
        grouped.setdefault(tag.employee_profile_id, []).append(tag)
    return grouped


def _serialize_tags(tags: list[EmployeeSkillTag], label_map: dict[str, str]) -> list[dict]:
    # Collapse legacy aliases to the canonical key, keeping the highest rating.
    best: dict[str, int] = {}
    for tag in tags:
        key = _canonical_skill(tag.skill)
        if key not in best or tag.rating > best[key]:
            best[key] = tag.rating
    ordered = sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))
    return [
        {"skill": key, "label": label_map.get(key, key.replace("_", " ").title()), "rating": rating}
        for key, rating in ordered
    ]


def _employee_rows(
    db: Session,
    label_map: dict[str, str],
    *,
    skill: str | None = None,
    min_rating: int | None = None,
    assignment: str = "all",
    search: str | None = None,
) -> list[dict]:
    employees = db.scalars(select(EmployeeProfile).order_by(EmployeeProfile.full_name.asc())).all()
    tags_map = _tags_by_employee(db)
    projects_map = _active_projects_by_employee(db)
    needle = (search or "").strip().lower()

    rows: list[dict] = []
    for employee in employees:
        tags = tags_map.get(employee.id, [])
        if skill:
            matching = [tag for tag in tags if _canonical_skill(tag.skill) == skill]
            if not matching:
                continue
            if min_rating and all(tag.rating < min_rating for tag in matching):
                continue
        elif min_rating:
            if not any(tag.rating >= min_rating for tag in tags):
                continue
        project = projects_map.get(employee.id)
        if assignment == "assigned" and not project:
            continue
        if assignment == "unassigned" and project:
            continue
        if needle:
            haystack = " ".join(
                filter(None, [employee.full_name, employee.employee_code, employee.ethara_email, employee.department])
            ).lower()
            if needle not in haystack:
                continue
        rows.append(
            {
                "employeeProfileId": employee.id,
                "name": employee.full_name,
                "employeeCode": employee.employee_code,
                "etharaEmail": employee.ethara_email,
                "department": employee.department,
                "designation": employee.designation,
                "skills": _serialize_tags(tags, label_map),
                "project": project,
            }
        )
    return rows


@router.get("/catalog")
def skill_catalog(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.AUTHENTICATED))],
):
    return _load_catalog(db)[0]


@router.post("/catalog", status_code=status.HTTP_201_CREATED)
def create_skill(
    payload: SkillCatalogCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(*CATALOG_ADMIN_ROLES))],
):
    label = payload.label.strip()
    key = _slugify(payload.key or label)
    if not key:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Provide a valid skill name.")
    existing = db.scalar(select(SkillCatalog).where(SkillCatalog.key == key))
    if existing:
        if not existing.is_active:
            existing.is_active = True
            existing.label = label
            db.commit()
            return {"key": existing.key, "label": existing.label}
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Skill '{label}' already exists.")
    entry = SkillCatalog(key=key, label=label, is_active=True, created_by=current_user.id)
    db.add(entry)
    db.commit()
    return {"key": entry.key, "label": entry.label}


@router.get("/employees")
def list_skill_tagged_employees(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
    skill: str | None = Query(default=None),
    min_rating: int | None = Query(default=None, alias="minRating", ge=1, le=5),
    assignment: str = Query(default="all", pattern="^(all|assigned|unassigned)$"),
    search: str | None = Query(default=None),
):
    _, label_map = _load_catalog(db)
    skill_key = _normalize_skill(skill, label_map) if skill else None
    if skill and not skill_key:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown skill tag.")
    return _employee_rows(db, label_map, skill=skill_key, min_rating=min_rating, assignment=assignment, search=search)


@router.put("/employees/{employee_profile_id}")
def set_employee_skills(
    employee_profile_id: str,
    payload: SkillUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
):
    employee = db.get(EmployeeProfile, employee_profile_id)
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    _, label_map = _load_catalog(db)
    desired: dict[str, int] = {}
    for entry in payload.skills:
        key = _normalize_skill(entry.skill, label_map)
        if not key:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown skill tag: {entry.skill}")
        desired[key] = entry.rating

    existing = {
        _canonical_skill(tag.skill): tag
        for tag in db.scalars(
            select(EmployeeSkillTag).where(EmployeeSkillTag.employee_profile_id == employee.id)
        ).all()
    }
    for skill_key, tag in existing.items():
        if skill_key not in desired:
            db.delete(tag)
    for skill_key, rating in desired.items():
        tag = existing.get(skill_key)
        if tag:
            tag.rating = rating
            tag.skill = skill_key  # normalize legacy aliases to canonical on write
            tag.tagged_by = current_user.id
            db.add(tag)
        else:
            db.add(
                EmployeeSkillTag(
                    employee_profile_id=employee.id,
                    skill=skill_key,
                    rating=rating,
                    tagged_by=current_user.id,
                )
            )
    db.commit()

    tags = db.scalars(select(EmployeeSkillTag).where(EmployeeSkillTag.employee_profile_id == employee.id)).all()
    return {"employeeProfileId": employee.id, "skills": _serialize_tags(list(tags), label_map)}


@router.get("/me")
def my_skills(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUTHENTICATED))],
):
    employee = db.scalar(select(EmployeeProfile).where(EmployeeProfile.user_id == current_user.id))
    if not employee:
        return {"skills": [], "project": None}
    _, label_map = _load_catalog(db)
    tags = db.scalars(select(EmployeeSkillTag).where(EmployeeSkillTag.employee_profile_id == employee.id)).all()
    project = _active_projects_by_employee(db).get(employee.id)
    return {"skills": _serialize_tags(list(tags), label_map), "project": project}


TEMPLATE_ROWS = [
    ("Employee Code", "Email", "Skill", "Rating"),
    ("GRP1001", "", "Python", "4"),
    ("GRP1001", "", "Git", "3"),
    ("", "employee@ethara.ai", "Docker", "5"),
    ("", "another.employee@ethara.ai", "Generalist Foundation", "2"),
]


@router.get("/template")
def bulk_template(
    _: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerows(TEMPLATE_ROWS)
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="skill_tags_template.csv"'},
    )


def _get_column(row: dict, *names: str) -> str:
    lowered = {str(key or "").strip().lower(): value for key, value in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


@router.post("/bulk-upload")
async def bulk_upload_skills(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_WRITE))],
    file: Annotated[UploadFile, File(...)],
):
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload a UTF-8 CSV file (use the provided template).",
        ) from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The file has no header row.")

    _, label_map = _load_catalog(db)
    employees = db.scalars(select(EmployeeProfile)).all()
    by_code = {str(e.employee_code or "").strip().lower(): e for e in employees if e.employee_code}
    by_email: dict[str, EmployeeProfile] = {}
    for e in employees:
        for email in (e.ethara_email, e.personal_email):
            if email:
                by_email.setdefault(email.strip().lower(), e)

    results: list[dict] = []
    created = updated = rejected = 0
    for index, row in enumerate(reader, start=2):
        code = _get_column(row, "Employee Code", "Code", "Emp Code")
        email = _get_column(row, "Email", "Ethara Email", "Official Email", "Personal Email")
        skill_raw = _get_column(row, "Skill", "Skill Tag", "Tag")
        rating_raw = _get_column(row, "Rating", "Stars", "Star Rating")
        identifier = code or email or "(blank)"

        def reject(reason: str) -> None:
            nonlocal rejected
            rejected += 1
            results.append({"row": index, "identifier": identifier, "skill": skill_raw, "status": "rejected", "reason": reason})

        if not code and not email and not skill_raw and not rating_raw:
            continue
        employee = by_code.get(code.lower()) if code else None
        if employee is None and email:
            employee = by_email.get(email.lower())
        if employee is None:
            reject("Employee not found by code or email.")
            continue
        skill_key = _normalize_skill(skill_raw, label_map)
        if not skill_key:
            reject(f"Unknown skill '{skill_raw}'. Allowed: {', '.join(label_map.values())}.")
            continue
        try:
            rating = int(float(rating_raw))
        except (TypeError, ValueError):
            reject("Rating must be a number from 1 to 5.")
            continue
        if rating < 1 or rating > 5:
            reject("Rating must be between 1 and 5.")
            continue

        tag = db.scalar(
            select(EmployeeSkillTag).where(
                EmployeeSkillTag.employee_profile_id == employee.id,
                EmployeeSkillTag.skill == skill_key,
            )
        )
        if tag:
            tag.rating = rating
            tag.tagged_by = current_user.id
            db.add(tag)
            updated += 1
            outcome = "updated"
        else:
            db.add(
                EmployeeSkillTag(
                    employee_profile_id=employee.id,
                    skill=skill_key,
                    rating=rating,
                    tagged_by=current_user.id,
                )
            )
            created += 1
            outcome = "created"
        results.append({
            "row": index,
            "identifier": employee.employee_code or employee.full_name,
            "skill": label_map[skill_key],
            "status": outcome,
            "reason": None,
        })
    db.commit()
    return {"total": created + updated + rejected, "created": created, "updated": updated, "rejected": rejected, "results": results}


@router.get("/export")
def export_skill_tags(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.EMPLOYEES_READ))],
    skill: str | None = Query(default=None),
    min_rating: int | None = Query(default=None, alias="minRating", ge=1, le=5),
    assignment: str = Query(default="all", pattern="^(all|assigned|unassigned)$"),
    search: str | None = Query(default=None),
):
    _, label_map = _load_catalog(db)
    skill_key = _normalize_skill(skill, label_map) if skill else None
    if skill and not skill_key:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown skill tag.")
    rows = _employee_rows(db, label_map, skill=skill_key, min_rating=min_rating, assignment=assignment, search=search)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "Employee Code", "Name", "Ethara Email", "Department", "Designation",
        "Skill Tags", "Current Project", "Project Status",
    ])
    for row in rows:
        skills_text = "; ".join(f"{item['label']} ({item['rating']}/5)" for item in row["skills"]) or "Untagged"
        project = row["project"]
        writer.writerow([
            _csv_safe(row["employeeCode"]),
            _csv_safe(row["name"]),
            _csv_safe(row["etharaEmail"]),
            _csv_safe(row["department"]),
            _csv_safe(row["designation"]),
            _csv_safe(skills_text),
            _csv_safe(project["name"] if project else ""),
            "Assigned" if project else "Not assigned",
        ])
    suffix = assignment if assignment != "all" else "all"
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="skill_tags_{suffix}.csv"'},
    )
