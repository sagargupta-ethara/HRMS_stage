"""Penny-drop bank-account verification endpoints (Office Admin + HR/Admin view)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import User
from app.services import bank_verification as svc

router = APIRouter(prefix="/bank-verification", tags=["bank-verification"])

ReadUser = Annotated[User, Depends(require_permissions(Permission.BANK_VERIFICATION_READ))]
WriteUser = Annotated[User, Depends(require_permissions(Permission.BANK_VERIFICATION_WRITE))]
DbDep = Annotated[Session, Depends(get_db)]


@router.get("")
def list_bank_verifications(db: DbDep, current_user: ReadUser) -> list[dict[str, Any]]:
    return svc.list_bank_verifications(db)


@router.get("/export")
def export_bank_sheet(
    db: DbDep,
    current_user: WriteUser,
    include_validated: bool = False,
) -> StreamingResponse:
    csv_text, count = svc.build_bank_sheet(
        db, include_validated=include_validated, actor=current_user
    )
    if count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No employees with complete bank details are pending penny-drop verification.",
        )
    db.commit()
    filename = f"penny_drop_bank_sheet_{datetime.now(UTC).strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/results-template")
def download_results_template(db: DbDep, current_user: ReadUser) -> StreamingResponse:
    return StreamingResponse(
        iter([svc.results_template_csv()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="penny_drop_results_template.csv"'},
    )


@router.post("/results/upload")
def upload_results(
    db: DbDep,
    current_user: WriteUser,
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    raw = file.file.read()
    try:
        rows = svc.parse_results_csv(raw)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    summary = svc.apply_results(db, rows=rows, actor=current_user)
    db.commit()
    return summary
