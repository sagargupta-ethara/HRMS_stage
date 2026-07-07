from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_permissions, user_has_any_role
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import AssessmentTemplate, Candidate, CandidateAssessment, Position, Role, User

router = APIRouter(prefix="/assessment-templates", tags=["assessment-templates"])

# Staff roles that may manage (create/update/delete) assessment templates. Evaluators
# hold EVALUATIONS_* for grading and keep read access, but template management is
# staff-only. Mirrors the convention in routes/workflows.py and routes/assessments.py.
_STAFF_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}


def _require_template_management(user: User) -> None:
    if not user_has_any_role(user, _STAFF_ROLES):
        raise HTTPException(
            status_code=403,
            detail="Only administrators may manage assessment templates.",
        )


def _serialize_template(template: AssessmentTemplate) -> dict:
    return {
        "id": template.id,
        "title": template.title,
        "description": template.description,
        "instructions": template.instructions,
        "level": template.level,
        "positionId": template.position_id,
        "positionTitle": template.position.title if template.position else None,
        "isActive": template.is_active,
        "createdAt": template.created_at.isoformat() if template.created_at else None,
        "updatedAt": template.updated_at.isoformat() if template.updated_at else None,
    }


@router.get("")
def list_assessment_templates(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_READ))],
    position_id: str | None = Query(default=None, alias="positionId"),
    level: int | None = Query(default=None),
    is_active: bool | None = Query(default=None, alias="isActive"),
) -> list[dict]:
    query = select(AssessmentTemplate)
    if position_id is not None:
        query = query.where(AssessmentTemplate.position_id == position_id)
    if level is not None:
        query = query.where(AssessmentTemplate.level == level)
    if is_active is not None:
        query = query.where(AssessmentTemplate.is_active.is_(is_active))
    templates = db.scalars(query.order_by(AssessmentTemplate.created_at.desc())).all()
    return [_serialize_template(t) for t in templates]


@router.post("", status_code=201)
def create_assessment_template(
    payload: dict,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
) -> dict:
    _require_template_management(current_user)
    title = str(payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title is required")

    level = payload.get("level")
    if level is not None:
        try:
            level = int(level)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="level must be an integer")

    position_id = payload.get("positionId") or payload.get("position_id")
    if position_id:
        position = db.get(Position, position_id)
        if position is None:
            raise HTTPException(status_code=404, detail="Position not found")

    template = AssessmentTemplate(
        title=title,
        description=str(payload.get("description") or "").strip() or None,
        instructions=str(payload.get("instructions") or "").strip() or None,
        level=level,
        position_id=position_id or None,
        is_active=bool(payload.get("isActive", payload.get("is_active", True))),
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return _serialize_template(template)


@router.get("/for-candidate/{candidate_id}")
def get_templates_for_candidate(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_READ))],
) -> list[dict]:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Find levels the candidate has already completed
    completed_levels: set[int] = set(
        db.scalars(
            select(CandidateAssessment.level).where(
                CandidateAssessment.candidate_id == candidate_id,
                CandidateAssessment.status.in_(["submitted", "passed", "failed"]),
            )
        ).all()
    )

    # Query templates matching candidate's position and not yet completed
    query = (
        select(AssessmentTemplate)
        .where(
            AssessmentTemplate.is_active.is_(True),
            AssessmentTemplate.position_id == candidate.position_id,
        )
        .order_by(AssessmentTemplate.level)
    )
    templates = db.scalars(query).all()

    return [
        _serialize_template(t)
        for t in templates
        if t.level not in completed_levels
    ]


@router.get("/{template_id}")
def get_assessment_template(
    template_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_READ))],
) -> dict:
    template = db.get(AssessmentTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Assessment template not found")
    return _serialize_template(template)


@router.patch("/{template_id}")
def update_assessment_template(
    template_id: str,
    payload: dict,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
) -> dict:
    _require_template_management(current_user)
    template = db.get(AssessmentTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Assessment template not found")

    if "title" in payload:
        title = str(payload["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="title cannot be empty")
        template.title = title

    if "description" in payload:
        template.description = str(payload["description"] or "").strip() or None

    if "instructions" in payload:
        template.instructions = str(payload["instructions"] or "").strip() or None

    if "level" in payload:
        level = payload["level"]
        if level is not None:
            try:
                level = int(level)
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail="level must be an integer")
        template.level = level

    position_id_key = "positionId" if "positionId" in payload else "position_id" if "position_id" in payload else None
    if position_id_key is not None:
        position_id = payload[position_id_key]
        if position_id:
            position = db.get(Position, position_id)
            if position is None:
                raise HTTPException(status_code=404, detail="Position not found")
        template.position_id = position_id or None

    is_active_key = "isActive" if "isActive" in payload else "is_active" if "is_active" in payload else None
    if is_active_key is not None:
        template.is_active = bool(payload[is_active_key])

    db.add(template)
    db.commit()
    db.refresh(template)
    return _serialize_template(template)


@router.delete("/{template_id}")
def delete_assessment_template(
    template_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.EVALUATIONS_WRITE))],
) -> dict:
    _require_template_management(current_user)
    template = db.get(AssessmentTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Assessment template not found")
    template.is_active = False
    db.add(template)
    db.commit()
    return {"message": "Assessment template archived successfully"}
