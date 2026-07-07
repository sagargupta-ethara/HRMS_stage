from __future__ import annotations

import csv
import io
import logging
from pathlib import Path
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.exports import csv_safe_mapping
from app.db.models import (
    Candidate,
    Contract,
    ContractStatus,
    DocumensoSignedProfile,
    DocumensoSyncLog,
    DocumensoSyncState,
    EmployeeContract,
    EmployeeProfile,
    SyncJobRun,
    generate_id,
)
from app.services import documenso as ds_client

logger = logging.getLogger(__name__)

_PROFILES_SYNC_ID = "profiles"
_PAGES_PER_RUN = 5   # 5 pages × ~1.9s/page ≈ 10s per commit → data visible quickly
_DOCS_PER_PAGE = 50
OLD_EMPLOYEE_CONTRACT_TEMPLATE_ID = 13785
OLD_EMPLOYEE_CONTRACT_TEMPLATE_TITLE = "NDA & Employment Contract - Ethara.pdf New"
OLD_EMPLOYEE_CONTRACT_DISPLAY_TITLE = "NDA & Employment Contract"
_OLD_EMPLOYEE_CONTRACT_SYNC_PAGES = 12
_SKIPPED_FIELD_TYPES = {"SIGNATURE", "INITIALS", "FREE_SIGNATURE"}
_STATUTORY_TITLE_PREFIXES = ("form 11", "form 2", "form f")
_FALLBACK_FIELD_LABELS = {
    "CHECKBOX": "Checkbox",
    "DATE": "Date",
    "DROPDOWN": "Dropdown",
    "EMAIL": "Email",
    "NAME": "Name",
    "NUMBER": "Number",
    "RADIO": "Radio",
    "TEXT": "Text",
}


def _emit_log(
    db: Session,
    *,
    status: str,
    message: str,
    document_id: int | None = None,
) -> None:
    db.add(
        DocumensoSyncLog(
            id=generate_id(),
            log_type="profile_sync",
            status=status,
            message=message,
            document_id=document_id,
        )
    )
    db.flush()


def _flatten_field_value(raw_value: Any) -> list[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, str):
        value = raw_value.strip()
        return [value] if value else []
    if isinstance(raw_value, bool):
        return ["Yes" if raw_value else "No"]
    if isinstance(raw_value, (int, float)):
        return [str(raw_value)]
    if isinstance(raw_value, list):
        flattened: list[str] = []
        for item in raw_value:
            flattened.extend(_flatten_field_value(item))
        return flattened
    if isinstance(raw_value, dict):
        flattened: list[str] = []
        for key in ("value", "values", "label", "name", "text", "title"):
            flattened.extend(_flatten_field_value(raw_value.get(key)))
        return flattened
    return []


def _extract_field_label(field: dict[str, Any]) -> str:
    field_meta = field.get("fieldMeta") or {}
    label = (field_meta.get("label") or field.get("label") or "").strip()
    if label:
        return label
    field_type = (
        (field.get("type") or field_meta.get("type") or "")
        .strip()
        .upper()
    )
    return _FALLBACK_FIELD_LABELS.get(field_type, "")


def _extract_field_value(field: dict[str, Any]) -> list[str]:
    field_meta = field.get("fieldMeta") or {}
    for candidate_value in (
        field.get("customText"),
        field.get("value"),
        field.get("values"),
        field.get("selectedValues"),
        field.get("selectedOptions"),
        field_meta.get("value"),
        field_meta.get("text"),
    ):
        flattened = _flatten_field_value(candidate_value)
        if flattened:
            return flattened
    return []


def _match_candidate_id(db: Session, email: str) -> str | None:
    normalized_email = email.strip().lower()
    if not normalized_email:
        return None
    candidate = db.scalar(
        select(Candidate).where(func.lower(Candidate.personal_email) == normalized_email)
    )
    return candidate.id if candidate else None


def _resolve_template_title(
    db: Session,
    *,
    template_id: int | None,
    fallback_title: str | None,
) -> str:
    title = (fallback_title or "").strip()
    if not template_id:
        return title

    from app.db.models import DocumensoTemplateCache

    template = db.scalar(
        select(DocumensoTemplateCache).where(
            DocumensoTemplateCache.template_id == template_id
        )
    )
    return template.title if template else title


def _resolve_profile_pdf_url(
    db: Session,
    *,
    documenso_doc_id: int,
    candidate_id: str | None,
) -> str | None:
    contract = db.scalar(
        select(Contract).where(Contract.documenso_id == str(documenso_doc_id))
    )
    if contract and contract.pdf_url:
        return contract.pdf_url

    if candidate_id:
        contract = db.scalar(
            select(Contract).where(Contract.candidate_id == candidate_id)
        )
        if contract and contract.pdf_url:
            return contract.pdf_url

    return None


def _signed_profile_title_is_contract(title: str | None) -> bool:
    normalized = (title or "").strip().lower()
    if not normalized:
        return True
    return not any(normalized.startswith(prefix) for prefix in _STATUTORY_TITLE_PREFIXES)


def find_latest_contract_profile_for_candidate(
    db: Session,
    *,
    candidate: Candidate,
) -> DocumensoSignedProfile | None:
    email = (candidate.personal_email or "").strip().lower()
    if not email:
        return None
    profiles = list(
        db.scalars(
            select(DocumensoSignedProfile)
            .where(
                or_(
                    DocumensoSignedProfile.candidate_id == candidate.id,
                    func.lower(DocumensoSignedProfile.recipient_email) == email,
                )
            )
            .where(DocumensoSignedProfile.completed_at.is_not(None))
            .order_by(DocumensoSignedProfile.completed_at.desc(), DocumensoSignedProfile.synced_at.desc())
        )
    )
    return next(
        (profile for profile in profiles if _signed_profile_title_is_contract(profile.template_title)),
        None,
    )


def sync_latest_contract_profile_for_candidate(
    db: Session,
    *,
    candidate: Candidate,
    max_pages: int = 5,
    per_page: int = _DOCS_PER_PAGE,
) -> tuple[DocumensoSignedProfile | None, dict[str, Any] | None]:
    existing = find_latest_contract_profile_for_candidate(db, candidate=candidate)
    if existing is not None:
        return existing, None

    email = (candidate.personal_email or "").strip().lower()
    if not email:
        return None, None

    for page in range(1, max_pages + 1):
        response = ds_client.list_documents(
            page=page,
            per_page=per_page,
            status="COMPLETED",
            order_dir="desc",
        )
        items: list[dict[str, Any]] = response.get("data") or []
        if not items:
            break
        for item in items:
            doc_id = item.get("id")
            if not doc_id:
                continue
            recipient_emails = {
                (recipient.get("email") or "").strip().lower()
                for recipient in (item.get("recipients") or [])
            }
            if email not in recipient_emails:
                continue
            template_title = _resolve_template_title(
                db,
                template_id=item.get("templateId"),
                fallback_title=item.get("title"),
            )
            if not _signed_profile_title_is_contract(template_title):
                continue
            profile, full_doc = sync_profile_document(db, int(doc_id))
            return profile, full_doc

        total_pages = response.get("totalPages") or response.get("total_pages")
        if total_pages and page >= int(total_pages):
            break

    return None, None


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return slug or "document"


def _store_signed_profile_pdf(
    pdf_bytes: bytes,
    *,
    documenso_doc_id: int,
    title: str | None,
) -> tuple[str, str]:
    storage_key = f"contracts/documenso_profiles/{documenso_doc_id}_{_slugify(title or 'signed_document')}.pdf"
    settings = get_settings()

    if settings.storage_backend == "s3":
        import boto3

        s3 = boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        s3.put_object(
            Bucket=settings.aws_s3_bucket,
            Key=storage_key,
            Body=pdf_bytes,
            ContentType="application/pdf",
        )
        url = f"https://{settings.aws_s3_bucket}.s3.{settings.aws_region}.amazonaws.com/{storage_key}"
    else:
        dest = settings.local_storage_path / storage_key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(pdf_bytes)
        url = f"/uploads/{storage_key}"

    return url, storage_key


def _download_signed_profile_pdf_url(
    db: Session,
    *,
    documenso_doc_id: int,
    title: str | None,
) -> str | None:
    if not _signed_profile_title_is_contract(title):
        return None
    try:
        pdf_bytes = ds_client.download_document_pdf(documenso_doc_id)
        pdf_url, storage_key = _store_signed_profile_pdf(
            pdf_bytes,
            documenso_doc_id=documenso_doc_id,
            title=title,
        )
        _emit_log(
            db,
            status="success",
            message=f"Signed profile PDF stored at {storage_key}",
            document_id=documenso_doc_id,
        )
        return pdf_url
    except Exception as exc:
        _emit_log(
            db,
            status="error",
            message=f"Signed profile PDF download failed: {exc}",
            document_id=documenso_doc_id,
        )
        return None


def ensure_signed_profile_pdf(db: Session, profile: DocumensoSignedProfile) -> bool:
    if profile.pdf_url or not _signed_profile_title_is_contract(profile.template_title):
        return False
    pdf_url = _download_signed_profile_pdf_url(
        db,
        documenso_doc_id=profile.documenso_doc_id,
        title=profile.template_title,
    )
    if not pdf_url:
        return False
    profile.pdf_url = pdf_url
    profile.synced_at = datetime.now(UTC)
    db.add(profile)
    db.flush()
    return True


def _parse_documenso_datetime(raw_value: Any) -> datetime | None:
    if not raw_value:
        return None
    if isinstance(raw_value, datetime):
        return raw_value
    try:
        return datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _is_old_employee_contract_doc(doc_summary: dict[str, Any]) -> bool:
    title = (doc_summary.get("title") or "").strip().lower()
    return (
        doc_summary.get("templateId") == OLD_EMPLOYEE_CONTRACT_TEMPLATE_ID
        or title.startswith(OLD_EMPLOYEE_CONTRACT_TEMPLATE_TITLE.lower())
    )


def _primary_documenso_recipient(doc_summary: dict[str, Any]) -> dict[str, Any]:
    recipients: list[dict[str, Any]] = doc_summary.get("recipients") or []
    return next(
        (r for r in recipients if r.get("signingStatus") == "SIGNED"),
        recipients[0] if recipients else {},
    )


def _old_employee_contract_status(
    doc_summary: dict[str, Any],
    recipient: dict[str, Any],
) -> ContractStatus:
    doc_status = str(doc_summary.get("status") or "").upper()
    signing_status = str(recipient.get("signingStatus") or "").upper()
    if doc_status == "COMPLETED" or signing_status == "SIGNED":
        return ContractStatus.SIGNED
    if str(recipient.get("readStatus") or "").upper() == "OPENED":
        return ContractStatus.VIEWED
    if str(recipient.get("sendStatus") or "").upper() == "SENT":
        return ContractStatus.SENT
    return ContractStatus.DRAFT


def _contract_file_name_from_url(title: str, file_url: str | None) -> str:
    if file_url:
        parsed = Path(str(file_url)).name
        if parsed:
            return parsed
    return f"{title}.pdf"


def _old_employee_contract_marker(documenso_doc_id: int) -> str:
    return f"Documenso old employee contract document {documenso_doc_id}"


def _find_old_employee_contract_record(
    db: Session,
    *,
    profile: EmployeeProfile,
    documenso_doc_id: int,
) -> EmployeeContract | None:
    marker = _old_employee_contract_marker(documenso_doc_id)
    records = list(
        db.scalars(
            select(EmployeeContract)
            .where(EmployeeContract.employee_profile_id == profile.id)
            .order_by(EmployeeContract.created_at.asc())
        )
    )
    for record in records:
        if marker in (record.remarks or ""):
            return record
    for record in records:
        title = (record.title or "").strip().lower()
        if (
            title in {"employment agreement", "employment contract", "signed contract"}
            and not record.file_url
            and record.status != ContractStatus.SIGNED
        ):
            return record
    return None


def _sync_old_employee_contract_doc(
    db: Session,
    *,
    doc_summary: dict[str, Any],
) -> bool:
    doc_id = doc_summary.get("id")
    if not doc_id or not _is_old_employee_contract_doc(doc_summary):
        return False
    recipient = _primary_documenso_recipient(doc_summary)
    recipient_email = (recipient.get("email") or "").strip().lower()
    if not recipient_email:
        return False

    profile = db.scalar(
        select(EmployeeProfile).where(func.lower(EmployeeProfile.ethara_email) == recipient_email)
    )
    if profile is None:
        return False

    record = _find_old_employee_contract_record(db, profile=profile, documenso_doc_id=int(doc_id))
    signed_profile = db.scalar(
        select(DocumensoSignedProfile).where(DocumensoSignedProfile.documenso_doc_id == int(doc_id))
    )
    file_url = record.file_url if record and record.file_url else None
    if not file_url:
        file_url = signed_profile.pdf_url if signed_profile and signed_profile.pdf_url else None
    if not file_url:
        file_url = _download_signed_profile_pdf_url(
            db,
            documenso_doc_id=int(doc_id),
            title=doc_summary.get("title") or OLD_EMPLOYEE_CONTRACT_TEMPLATE_TITLE,
        )
        if signed_profile is not None and file_url:
            signed_profile.pdf_url = file_url
            signed_profile.synced_at = datetime.now(UTC)
            db.add(signed_profile)

    if record is None:
        record = EmployeeContract(employee_profile_id=profile.id, title=OLD_EMPLOYEE_CONTRACT_DISPLAY_TITLE)

    status = _old_employee_contract_status(doc_summary, recipient)
    completed_at = _parse_documenso_datetime(doc_summary.get("completedAt") or recipient.get("signedAt"))
    issued_at = _parse_documenso_datetime(doc_summary.get("createdAt"))
    remarks = (
        f"Synced from {_old_employee_contract_marker(int(doc_id))} "
        f"({OLD_EMPLOYEE_CONTRACT_TEMPLATE_TITLE})."
    )

    changed = False
    for attr, value in (
        ("title", OLD_EMPLOYEE_CONTRACT_DISPLAY_TITLE),
        ("status", status),
        ("file_name", _contract_file_name_from_url(OLD_EMPLOYEE_CONTRACT_DISPLAY_TITLE, file_url)),
        ("file_url", file_url),
        ("mime_type", "application/pdf"),
        ("remarks", remarks),
        ("uploaded_by", profile.user_id),
    ):
        if getattr(record, attr) != value:
            setattr(record, attr, value)
            changed = True
    if issued_at and record.issued_at is None:
        record.issued_at = issued_at
        changed = True
    if status == ContractStatus.SIGNED:
        if record.completed_at != (completed_at or record.completed_at):
            record.completed_at = completed_at or record.completed_at or datetime.now(UTC)
            changed = True
    elif record.completed_at is not None:
        record.completed_at = None
        changed = True

    if changed or record.id is None:
        db.add(record)
    return changed


def sync_old_employee_contract_documents(
    db: Session,
    *,
    max_pages: int = _OLD_EMPLOYEE_CONTRACT_SYNC_PAGES,
    per_page: int = _DOCS_PER_PAGE,
) -> dict[str, int]:
    processed = 0
    matched = 0
    updated = 0
    errors = 0
    for page in range(1, max_pages + 1):
        try:
            response = ds_client.list_documents(
                page=page,
                per_page=per_page,
                status=None,
                order_dir="desc",
            )
        except Exception as exc:
            errors += 1
            _emit_log(
                db,
                status="error",
                message=f"Old employee contract sync list failed on page {page}: {exc}",
            )
            break
        items: list[dict[str, Any]] = response.get("data") or []
        if not items:
            break
        processed += len(items)
        for item in items:
            if not _is_old_employee_contract_doc(item):
                continue
            matched += 1
            try:
                if _sync_old_employee_contract_doc(db, doc_summary=item):
                    updated += 1
            except Exception as exc:
                errors += 1
                _emit_log(
                    db,
                    status="error",
                    message=f"Old employee contract sync failed for doc {item.get('id')}: {exc}",
                    document_id=item.get("id"),
                )
        total_pages = response.get("totalPages") or response.get("total_pages")
        if total_pages and page >= int(total_pages):
            break
    db.flush()
    return {"processed": processed, "matched": matched, "updated": updated, "errors": errors}


def _extract_field_values(fields: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field in fields:
        field_type = (
            (field.get("type") or (field.get("fieldMeta") or {}).get("type") or "")
            .strip()
            .upper()
        )
        if field_type in _SKIPPED_FIELD_TYPES:
            continue
        label = _extract_field_label(field)
        values = _extract_field_value(field)
        if not label or not values:
            continue
        for value in values:
            existing = result.get(label)
            if existing is None:
                result[label] = value
                continue
            if isinstance(existing, list):
                if value not in existing:
                    existing.append(value)
            elif existing != value:
                result[label] = [existing, value]
    return result


def start_profile_sync_job(db: Session, *, trigger: str = "cron") -> SyncJobRun:
    run = SyncJobRun(job_name="signed_profiles_sync", trigger=trigger, status="running", started_at=datetime.now(UTC))
    db.add(run)
    db.flush()
    return run


def finish_profile_sync_job(
    db: Session,
    run: SyncJobRun,
    *,
    status: str,
    documents_processed: int = 0,
    errors: int = 0,
    message: str | None = None,
) -> None:
    finished = datetime.now(UTC)
    run.status = status
    run.finished_at = finished
    run.duration_seconds = int((finished - run.started_at).total_seconds())
    run.documents_processed = documents_processed
    run.errors = errors
    run.message = message
    db.add(run)
    db.flush()


def _get_or_create_profile_state(db: Session) -> DocumensoSyncState:
    state = db.get(DocumensoSyncState, _PROFILES_SYNC_ID)
    if state is None:
        state = DocumensoSyncState(
            id=_PROFILES_SYNC_ID,
            sync_status="idle",
            documents_processed=0,
        )
        db.add(state)
        db.flush()
    return state


def _get_last_synced_page(db: Session) -> int:
    state = _get_or_create_profile_state(db)
    return state.last_document_id or 0 if state else 0


def _finish_profile_sync(
    db: Session,
    *,
    page: int,
    synced: int,
    is_done: bool,
    sync_status: str,
    error_message: str | None = None,
) -> None:
    state = _get_or_create_profile_state(db)
    state.last_document_id = None if is_done else page
    state.sync_status = sync_status
    state.error_message = error_message
    state.documents_processed += synced
    state.last_synced_at = datetime.now(UTC)
    db.add(state)
    db.flush()


def sync_signed_profiles(db: Session) -> dict[str, Any]:
    settings = get_settings()
    if not settings.documenso_api_key:
        return {"skipped": 1, "synced": 0, "errors": 0, "done": True}

    state = _get_or_create_profile_state(db)
    if state.sync_status == "running":
        return {"skipped": 1, "synced": 0, "errors": 0, "done": False}

    state.sync_status = "running"
    state.error_message = None
    db.add(state)
    db.flush()

    start_page = _get_last_synced_page(db) + 1
    synced = 0
    errors = 0
    last_page = start_page - 1
    total_pages = 1
    fatal_error_message: str | None = None

    for page_offset in range(_PAGES_PER_RUN):
        page = start_page + page_offset
        try:
            resp = ds_client.list_documents(
                page=page,
                per_page=_DOCS_PER_PAGE,
                status="COMPLETED",
                order_dir="asc",
            )
        except Exception as exc:
            errors += 1
            fatal_error_message = f"API error page {page}: {exc}"
            _emit_log(db, status="error", message=fatal_error_message)
            break

        total_pages = resp.get("totalPages") or resp.get("total_pages") or 1
        items: list[dict[str, Any]] = resp.get("data") or []

        # ── Bulk-import new docs (one batch INSERT per page) ────────────────
        # Phase 1: any doc not yet in DB → insert from summary (no per-doc
        # API call).  We use INSERT … ON CONFLICT DO NOTHING so concurrent
        # sync runs can never abort each other's transactions.
        page_doc_ids = [d.get("id") for d in items if d.get("id")]
        existing_ids: set[int] = set()

        if page_doc_ids:
            existing_ids = set(
                db.scalars(
                    select(DocumensoSignedProfile.documenso_doc_id).where(
                        DocumensoSignedProfile.documenso_doc_id.in_(page_doc_ids)
                    )
                )
            )

            # Pre-fetch template titles in one query
            template_ids = {d.get("templateId") for d in items if d.get("templateId")}
            from app.db.models import Candidate, DocumensoTemplateCache
            template_map: dict[int, str] = {}
            if template_ids:
                for tmpl in db.scalars(
                    select(DocumensoTemplateCache).where(
                        DocumensoTemplateCache.template_id.in_(template_ids)
                    )
                ):
                    template_map[tmpl.template_id] = tmpl.title

            # Pre-fetch candidate IDs by email in one query
            page_emails: set[str] = set()
            for d in items:
                for r in (d.get("recipients") or []):
                    e = (r.get("email") or "").strip().lower()
                    if e:
                        page_emails.add(e)
            email_to_candidate: dict[str, str] = {}
            if page_emails:
                for cand in db.scalars(
                    select(Candidate).where(
                        func.lower(Candidate.personal_email).in_(page_emails)
                    )
                ):
                    email_to_candidate[cand.personal_email.strip().lower()] = cand.id

            now = datetime.now(UTC)
            rows_to_insert: list[dict[str, Any]] = []
            for doc_summary in items:
                doc_id = doc_summary.get("id")
                if not doc_id or doc_id in existing_ids:
                    continue
                recipients: list[dict[str, Any]] = doc_summary.get("recipients") or []
                primary = next(
                    (r for r in recipients if r.get("signingStatus") == "SIGNED"),
                    recipients[0] if recipients else {},
                )
                email = (primary.get("email") or "").strip().lower()
                name = (primary.get("name") or "").strip()
                completed_at: datetime | None = None
                raw_ca = doc_summary.get("completedAt")
                if raw_ca:
                    try:
                        completed_at = datetime.fromisoformat(raw_ca.replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        pass
                template_id = doc_summary.get("templateId")
                template_title = (
                    template_map.get(template_id)
                    or (doc_summary.get("title") or "").strip()
                    or None
                )
                rows_to_insert.append({
                    "id": generate_id(),
                    "documenso_doc_id": doc_id,
                    "template_id": template_id,
                    "template_title": template_title,
                    "recipient_email": email,
                    "recipient_name": name or None,
                    "completed_at": completed_at,
                    "field_values": None,
                    "raw_fields": None,
                    "pdf_url": None,
                    "candidate_id": email_to_candidate.get(email),
                    "synced_at": now,
                    "created_at": now,
                })

            if rows_to_insert:
                db.execute(
                    pg_insert(DocumensoSignedProfile)
                    .values(rows_to_insert)
                    .on_conflict_do_nothing(
                        index_elements=[DocumensoSignedProfile.documenso_doc_id]
                    )
                )
                synced += len(rows_to_insert)

        # ── Phase 2: enrich all docs on this page missing field values ──────
        # Includes newly-inserted docs (from Phase 1) so fields are populated
        # in the same sync run. New inserts are already counted in `synced`
        # above, so only increment for docs that were pre-existing.
        for doc_summary in items:
            doc_id = doc_summary.get("id")
            if not doc_id:
                continue
            existing = db.scalar(
                select(DocumensoSignedProfile).where(
                    DocumensoSignedProfile.documenso_doc_id == doc_id
                )
            )
            if existing is None or (existing.field_values is not None and existing.pdf_url):
                continue
            try:
                sync_profile_document(db, doc_id)
                if doc_id in existing_ids:
                    synced += 1
            except Exception as exc:
                errors += 1
                _emit_log(
                    db,
                    status="error",
                    message=f"Failed to enrich doc {doc_id}: {exc}",
                    document_id=doc_id,
                )

        last_page = page
        db.flush()

        if page >= total_pages:
            break

    is_done = last_page >= total_pages
    _finish_profile_sync(
        db,
        page=max(last_page, 0),
        synced=synced,
        is_done=is_done,
        sync_status="error" if fatal_error_message else ("completed" if is_done else "idle"),
        error_message=fatal_error_message,
    )

    _emit_log(
        db,
        status="success",
        message=(
            f"Profile sync pages {start_page}–{last_page}/{total_pages}: "
            f"synced={synced} errors={errors}"
            + (" ✓ ALL DONE" if is_done else f" (next: page {last_page + 1})")
        ),
    )

    return {
        "synced": synced,
        "errors": errors,
        "pages_done": last_page,
        "total_pages": total_pages,
        "done": is_done,
    }


def _upsert_profile_from_summary(db: Session, doc_summary: dict[str, Any]) -> DocumensoSignedProfile:
    doc_id: int = doc_summary["id"]
    recipients: list[dict[str, Any]] = doc_summary.get("recipients") or []

    primary_recip = next(
        (r for r in recipients if r.get("signingStatus") == "SIGNED"),
        recipients[0] if recipients else {},
    )
    email = (primary_recip.get("email") or "").strip().lower()
    name = (primary_recip.get("name") or "").strip()

    completed_at: datetime | None = None
    raw_ca = doc_summary.get("completedAt")
    if raw_ca:
        try:
            completed_at = datetime.fromisoformat(raw_ca.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass

    template_id = doc_summary.get("templateId")
    template_title = _resolve_template_title(
        db,
        template_id=template_id,
        fallback_title=doc_summary.get("title"),
    )
    candidate_id = _match_candidate_id(db, email)
    pdf_url = _resolve_profile_pdf_url(
        db,
        documenso_doc_id=doc_id,
        candidate_id=candidate_id,
    )
    if not pdf_url and _is_old_employee_contract_doc(
        {"templateId": template_id, "title": template_title}
    ):
        pdf_url = _download_signed_profile_pdf_url(
            db,
            documenso_doc_id=doc_id,
            title=template_title,
        )

    now = datetime.now(UTC)
    profile = DocumensoSignedProfile(
        id=generate_id(),
        documenso_doc_id=doc_id,
        template_id=template_id,
        template_title=template_title,
        recipient_email=email,
        recipient_name=name,
        completed_at=completed_at,
        field_values=None,
        raw_fields=None,
        pdf_url=pdf_url,
        candidate_id=candidate_id,
        synced_at=now,
        created_at=now,
    )
    db.add(profile)
    db.flush()
    return profile


def sync_profile_document(
    db: Session,
    documenso_doc_id: int,
) -> tuple[DocumensoSignedProfile, dict[str, Any]]:
    full_doc = ds_client.get_document_with_fields(documenso_doc_id)
    return _upsert_profile(db, full_doc), full_doc


def enrich_profile_fields(db: Session, *, limit: int = 100) -> dict[str, Any]:
    settings = get_settings()
    if not settings.documenso_api_key:
        return {"skipped": 1, "enriched": 0}

    recent_profiles = list(
        db.scalars(
            select(DocumensoSignedProfile)
            .order_by(DocumensoSignedProfile.completed_at.desc())
        )
    )
    profiles_needing_fields = [
        profile
        for profile in recent_profiles
        if profile.field_values is None
        or (not profile.pdf_url and _signed_profile_title_is_contract(profile.template_title))
    ][:limit]

    enriched = 0
    errors = 0
    for profile in profiles_needing_fields:
        try:
            sync_profile_document(db, profile.documenso_doc_id)
            enriched += 1
        except Exception as exc:
            errors += 1
            _emit_log(
                db,
                status="error",
                message=f"Field enrichment failed for doc {profile.documenso_doc_id}: {exc}",
                document_id=profile.documenso_doc_id,
            )

    db.flush()
    return {"enriched": enriched, "errors": errors, "remaining": max(0, len(profiles_needing_fields) - enriched)}


def _upsert_profile(db: Session, full_doc: dict[str, Any]) -> DocumensoSignedProfile:
    doc_id: int = full_doc["id"]
    recipients: list[dict[str, Any]] = full_doc.get("recipients") or []
    fields: list[dict[str, Any]] = full_doc.get("fields") or []

    primary_recip = next(
        (r for r in recipients if r.get("signingStatus") == "SIGNED"),
        recipients[0] if recipients else {},
    )
    email = (primary_recip.get("email") or "").strip().lower()
    name = (primary_recip.get("name") or "").strip()

    completed_at: datetime | None = None
    raw_ca = full_doc.get("completedAt")
    if raw_ca:
        try:
            completed_at = datetime.fromisoformat(raw_ca.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass

    field_values = _extract_field_values(fields)
    template_id = full_doc.get("templateId")
    template_title = _resolve_template_title(
        db,
        template_id=template_id,
        fallback_title=full_doc.get("title"),
    )
    candidate_id = _match_candidate_id(db, email)
    pdf_url = _resolve_profile_pdf_url(
        db,
        documenso_doc_id=doc_id,
        candidate_id=candidate_id,
    )

    profile = db.scalar(
        select(DocumensoSignedProfile).where(
            DocumensoSignedProfile.documenso_doc_id == doc_id
        )
    )
    if not pdf_url and profile and profile.pdf_url:
        pdf_url = profile.pdf_url
    if not pdf_url and _is_old_employee_contract_doc(full_doc):
        pdf_url = _download_signed_profile_pdf_url(
            db,
            documenso_doc_id=doc_id,
            title=template_title,
        )
    now = datetime.now(UTC)

    if profile is None:
        profile = DocumensoSignedProfile(
            id=generate_id(),
            documenso_doc_id=doc_id,
            template_id=template_id,
            template_title=template_title,
            recipient_email=email,
            recipient_name=name,
            completed_at=completed_at,
            field_values=field_values,
            raw_fields=fields,
            pdf_url=pdf_url,
            candidate_id=candidate_id,
            synced_at=now,
            created_at=now,
        )
        db.add(profile)
    else:
        profile.template_id = template_id
        profile.template_title = template_title
        profile.recipient_email = email
        profile.field_values = field_values
        profile.raw_fields = fields
        profile.recipient_name = name
        profile.completed_at = completed_at
        profile.pdf_url = pdf_url
        profile.candidate_id = candidate_id
        profile.synced_at = now
        db.add(profile)

    db.flush()
    return profile


def _statutory_title_clause():
    title = func.lower(func.coalesce(DocumensoSignedProfile.template_title, ""))
    return or_(*[title.like(f"{prefix}%") for prefix in _STATUTORY_TITLE_PREFIXES])


def search_profiles(
    db: Session,
    *,
    q: str | None = None,
    template_id: int | None = None,
    page: int = 1,
    limit: int = 50,
    doc_class: str = "all",
) -> tuple[list[DocumensoSignedProfile], int]:
    query = (
        select(DocumensoSignedProfile)
        .options(
            joinedload(DocumensoSignedProfile.candidate).joinedload(Candidate.position)
        )
        .order_by(DocumensoSignedProfile.completed_at.desc().nulls_last())
    )
    if doc_class == "contracts":
        query = query.where(~_statutory_title_clause())
    elif doc_class == "compliance":
        query = query.where(_statutory_title_clause())
    if q:
        like = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(DocumensoSignedProfile.recipient_email).like(like),
                func.lower(DocumensoSignedProfile.recipient_name).like(like),
                func.lower(DocumensoSignedProfile.template_title).like(like),
            )
        )
    if template_id:
        query = query.where(DocumensoSignedProfile.template_id == template_id)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = list(db.scalars(query.offset((page - 1) * limit).limit(limit)))
    return rows, total


def export_profiles_csv(
    db: Session,
    *,
    q: str | None = None,
    template_id: int | None = None,
    doc_class: str = "all",
) -> str:
    rows, _ = search_profiles(db, q=q, template_id=template_id, page=1, limit=10000, doc_class=doc_class)

    all_field_keys: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for k in (row.field_values or {}):
            if k not in seen:
                seen.add(k)
                all_field_keys.append(k)

    base_cols = [
        "documenso_doc_id",
        "template_title",
        "recipient_name",
        "recipient_email",
        "completed_at",
        "candidate_id",
        "candidate_code",
        "candidate_full_name",
        "candidate_personal_email",
        "candidate_ethara_email",
        "candidate_phone",
        "candidate_current_stage",
        "candidate_current_status",
        "candidate_position_title",
        "pdf_url",
    ]
    headers = base_cols + all_field_keys

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()

    for row in rows:
        base: dict[str, Any] = {
            "documenso_doc_id": row.documenso_doc_id,
            "template_title": row.template_title or "",
            "recipient_name": row.recipient_name or "",
            "recipient_email": row.recipient_email,
            "completed_at": (
                row.completed_at.strftime("%Y-%m-%d %H:%M") if row.completed_at else ""
            ),
            "candidate_id": row.candidate_id or "",
            "candidate_code": row.candidate.candidate_code if row.candidate else "",
            "candidate_full_name": row.candidate.full_name if row.candidate else "",
            "candidate_personal_email": row.candidate.personal_email if row.candidate else "",
            "candidate_ethara_email": row.candidate.ethara_email if row.candidate else "",
            "candidate_phone": row.candidate.phone if row.candidate else "",
            "candidate_current_stage": row.candidate.current_stage.value if row.candidate else "",
            "candidate_current_status": row.candidate.current_status if row.candidate else "",
            "candidate_position_title": (
                row.candidate.position.title
                if row.candidate and row.candidate.position
                else ""
            ),
            "pdf_url": row.pdf_url or "",
        }
        fv = row.field_values or {}
        for k in all_field_keys:
            val = fv.get(k, "")
            base[k] = ", ".join(val) if isinstance(val, list) else (val or "")
        writer.writerow(csv_safe_mapping(base))

    return buf.getvalue()
