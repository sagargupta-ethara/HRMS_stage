import csv
import io
import os
import re
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

from email_validator import EmailNotValidError, validate_email
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_permissions, user_has_any_role
from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.permissions import Permission
from app.db.models import CareerApplication, Role, User
from app.schemas.applications import CareerApplicationRead
from app.services.integrations import StorageService

router = APIRouter(prefix="/applications", tags=["applications"])

ALLOWED_RESUME_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_RESUME_EXTENSIONS = {".pdf", ".doc", ".docx"}
APPLICATION_STAFF_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA}


def _normalize_email(value: str) -> str:
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid email address.",
        ) from exc


def _normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if len(digits) != 10:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid 10-digit phone number.",
        )
    return digits


def _normalize_url(value: str | None, *, label: str, required: bool = False) -> str | None:
    if value is None or not value.strip():
        if required:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{label} is required.",
            )
        return None
    url = value.strip()
    if len(url) > 500:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label} must be 500 characters or fewer.",
        )
    if "://" not in url:
        url = f"https://{url}"
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Enter a valid {label}.",
        )
    return url


def _validate_resume_upload(upload: UploadFile) -> int:
    if not upload.filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Resume upload is required.",
        )

    content_type = (upload.content_type or "").split(";", maxsplit=1)[0].strip().lower()
    extension = Path(upload.filename).suffix.lower()
    if (
        content_type not in ALLOWED_RESUME_CONTENT_TYPES
        or extension not in ALLOWED_RESUME_EXTENSIONS
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only PDF, DOC, and DOCX resumes are allowed.",
        )

    max_bytes = get_settings().max_upload_size_mb * 1024 * 1024
    upload.file.seek(0, os.SEEK_END)
    size = upload.file.tell()
    upload.file.seek(0)
    if size == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Resume file is empty.",
        )
    if size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Resume exceeds the maximum upload size of "
                f"{get_settings().max_upload_size_mb} MB."
            ),
        )
    return size


def _assert_application_staff(current_user: User) -> None:
    if not user_has_any_role(current_user, APPLICATION_STAFF_ROLES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin, HR, and TA users can view applications.",
        )


@router.post("", response_model=CareerApplicationRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def submit_career_application(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    full_name: Annotated[str, Form(alias="fullName")],
    email: Annotated[str, Form()],
    phone: Annotated[str, Form()],
    resume: Annotated[UploadFile, File()],
    linkedin_url: Annotated[str, Form(alias="linkedinUrl")],
    portfolio_url: Annotated[str | None, Form(alias="portfolioUrl")] = None,
    github_url: Annotated[str | None, Form(alias="githubUrl")] = None,
):
    del request
    normalized_name = full_name.strip()
    if len(normalized_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter your full name.",
        )

    normalized_email = _normalize_email(email)
    normalized_phone = _normalize_phone(phone)
    normalized_linkedin_url = _normalize_url(linkedin_url, label="LinkedIn profile", required=True)
    normalized_portfolio_url = _normalize_url(portfolio_url, label="Portfolio URL")
    normalized_github_url = _normalize_url(github_url, label="GitHub profile")
    resume_size = _validate_resume_upload(resume)
    storage = StorageService()
    resume_url, storage_path = storage.save_upload(
        resume,
        folder="career_applications",
        allowed_content_types=ALLOWED_RESUME_CONTENT_TYPES,
    )

    application = CareerApplication(
        full_name=normalized_name,
        email=normalized_email,
        phone=normalized_phone,
        linkedin_url=normalized_linkedin_url,
        portfolio_url=normalized_portfolio_url,
        github_url=normalized_github_url,
        resume_file_name=Path(resume.filename or "resume").name,
        resume_url=resume_url,
        resume_storage_path=storage_path,
        resume_mime_type=(resume.content_type or "").split(";", maxsplit=1)[0].strip().lower()
        or None,
        resume_size=resume_size,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


@router.get("", response_model=list[CareerApplicationRead])
def list_career_applications(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_READ))],
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    _assert_application_staff(current_user)
    query = (
        select(CareerApplication)
        .order_by(CareerApplication.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(query))


@router.get("/export")
def export_career_applications_csv(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_READ))],
):
    _assert_application_staff(current_user)

    def safe_cell(value: object) -> str:
        text = "" if value is None else str(value)
        if text[:1] in {"=", "+", "-", "@", "\t", "\r"}:
            return f"'{text}"
        return text

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Full Name",
        "Email",
        "Phone",
        "LinkedIn URL",
        "Portfolio URL",
        "GitHub URL",
        "Resume File Name",
        "Resume URL",
        "Resume MIME Type",
        "Resume Size Bytes",
        "Status",
        "Submitted At",
        "Updated At",
    ])
    applications = db.scalars(select(CareerApplication).order_by(CareerApplication.created_at.desc()))
    for application in applications:
        writer.writerow([
            safe_cell(application.full_name),
            safe_cell(application.email),
            safe_cell(application.phone),
            safe_cell(application.linkedin_url),
            safe_cell(application.portfolio_url),
            safe_cell(application.github_url),
            safe_cell(application.resume_file_name),
            safe_cell(application.resume_url),
            safe_cell(application.resume_mime_type),
            safe_cell(application.resume_size),
            safe_cell(application.status),
            safe_cell(application.created_at.isoformat() if application.created_at else ""),
            safe_cell(application.updated_at.isoformat() if application.updated_at else ""),
        ])

    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="career_applications.csv"'},
    )


@router.get("/{application_id}/resume/download")
def download_application_resume(
    application_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_READ))],
):
    _assert_application_staff(current_user)
    application = db.get(CareerApplication, application_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    if not application.resume_url.startswith("/uploads/"):
        download_url = StorageService().presigned_download_url(application.resume_url)
        if download_url:
            return RedirectResponse(download_url)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Resume is stored externally and cannot be proxied from this server.",
        )

    settings = get_settings()
    relative = application.resume_url.removeprefix("/")
    local_path = settings.local_storage_path.parent / relative
    if not local_path.exists():
        local_path = settings.local_storage_path / relative.removeprefix("uploads/")
    if not local_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume file not found")

    return FileResponse(
        path=str(local_path),
        filename=application.resume_file_name or local_path.name,
        media_type=application.resume_mime_type or "application/octet-stream",
    )
