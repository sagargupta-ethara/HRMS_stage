from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import User
from app.services import reports as report_service


router = APIRouter(prefix="/reports", tags=["reports"])


def _validate_date_range(created_from: date | None, created_to: date | None) -> None:
    if created_from and created_to and created_to < created_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="createdTo must be on or after createdFrom.",
        )


@router.get("/summary")
def summary(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.REPORTS_READ))],
    created_from: date | None = Query(default=None, alias="createdFrom"),
    created_to: date | None = Query(default=None, alias="createdTo"),
):
    _validate_date_range(created_from, created_to)
    data = report_service.get_dashboard_summary(db, created_from=created_from, created_to=created_to)
    return {
        "totalCandidates": data["total_candidates"],
        "thisMonth": data["this_month"],
        "joined": data["joined"],
        "activeEscalations": data["active_escalations"],
        "pendingEvaluations": data["pending_evaluations"],
        "stageBreakdown": data["stage_breakdown"],
        "sourceBreakdown": data["source_breakdown"],
    }


@router.get("/funnel")
def funnel(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.REPORTS_READ))],
    created_from: date | None = Query(default=None, alias="createdFrom"),
    created_to: date | None = Query(default=None, alias="createdTo"),
):
    _validate_date_range(created_from, created_to)
    return report_service.get_hiring_funnel(db, created_from=created_from, created_to=created_to)


@router.get("/escalations")
def escalations(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.REPORTS_READ))],
):
    return report_service.get_escalation_metrics(db)


@router.get("/pi-summary")
def pi_summary(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.REPORTS_READ))],
):
    return report_service.get_pi_summary(db)


@router.get("/positions")
def positions(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.REPORTS_READ))],
):
    return report_service.get_position_wise_report(db)


@router.get("/domains")
def domains(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.REPORTS_READ))],
):
    return report_service.get_domain_wise_report(db)
