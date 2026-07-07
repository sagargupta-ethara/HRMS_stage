from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import (
    Candidate,
    CandidateStage,
    Contract,
    ContractStatus,
    DocumensoContractField,
    DocumensoSyncLog,
    DocumensoSyncState,
    DocumensoTemplateCache,
    SyncJobRun,
    generate_id,
)
from app.services import documenso as ds_client
from app.services.audit import log_audit

logger = logging.getLogger(__name__)

_SINGLETON_SYNC_ID = "singleton"


def _emit_log(
    db: Session,
    *,
    log_type: str,
    status: str,
    message: str,
    document_id: int | None = None,
    candidate_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    db.add(
        DocumensoSyncLog(
            id=generate_id(),
            log_type=log_type,
            status=status,
            message=message,
            document_id=document_id,
            candidate_id=candidate_id,
            extra=extra,
        )
    )
    db.flush()


def get_or_create_sync_state(db: Session) -> DocumensoSyncState:
    state = db.get(DocumensoSyncState, _SINGLETON_SYNC_ID)
    if state is None:
        state = DocumensoSyncState(id=_SINGLETON_SYNC_ID, sync_status="idle")
        db.add(state)
        db.flush()
    return state


def start_sync_job_run(db: Session, *, job_name: str, trigger: str = "cron") -> SyncJobRun:
    run = SyncJobRun(job_name=job_name, trigger=trigger, status="running", started_at=datetime.now(UTC))
    db.add(run)
    db.flush()
    return run


def finish_sync_job_run(
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


def list_sync_job_runs(db: Session, *, job_name: str | None = None, limit: int = 50) -> list[SyncJobRun]:
    q = select(SyncJobRun).order_by(SyncJobRun.started_at.desc()).limit(limit)
    if job_name:
        q = q.where(SyncJobRun.job_name == job_name)
    return list(db.scalars(q))


def refresh_template_cache(db: Session) -> int:
    settings = get_settings()
    if not settings.documenso_api_key:
        return 0

    page = 1
    total_synced = 0
    while True:
        try:
            resp = ds_client.list_templates(page=page, per_page=100)
        except Exception as exc:
            _emit_log(
                db,
                log_type="template_sync",
                status="error",
                message=f"Failed to fetch templates page {page}: {exc}",
            )
            break

        items: list[dict[str, Any]] = resp.get("data") or resp.get("templates") or []
        if not items:
            break

        for raw in items:
            tid = raw.get("id")
            if not tid:
                continue
            existing = db.scalar(
                select(DocumensoTemplateCache).where(
                    DocumensoTemplateCache.template_id == tid
                )
            )
            if existing:
                existing.title = raw.get("title", "")
                existing.description = raw.get("description")
                existing.fields = raw.get("fields") or []
                existing.recipients = raw.get("recipients") or []
                existing.synced_at = datetime.now(UTC)
                db.add(existing)
            else:
                db.add(
                    DocumensoTemplateCache(
                        template_id=tid,
                        title=raw.get("title", ""),
                        description=raw.get("description"),
                        fields=raw.get("fields") or [],
                        recipients=raw.get("recipients") or [],
                        synced_at=datetime.now(UTC),
                    )
                )
            total_synced += 1

        total_pages = resp.get("totalPages") or resp.get("total_pages") or 1
        if page >= total_pages:
            break
        page += 1

    db.flush()
    _emit_log(
        db,
        log_type="template_sync",
        status="success",
        message=f"Template cache refreshed: {total_synced} templates synced",
    )
    return total_synced


def run_incremental_sync(db: Session) -> dict[str, int]:
    settings = get_settings()
    if not settings.documenso_api_key:
        return {"skipped": 1, "processed": 0, "errors": 0}

    state = get_or_create_sync_state(db)
    if state.sync_status == "running":
        return {"skipped": 1, "processed": 0, "errors": 0}

    state.sync_status = "running"
    state.error_message = None
    db.add(state)
    db.flush()

    _emit_log(db, log_type="sync", status="info", message="Incremental sync started")

    processed = 0
    errors = 0
    page = 1
    batch = settings.documenso_sync_batch_size

    try:
        while True:
            try:
                resp = ds_client.list_documents(
                    page=page,
                    per_page=batch,
                    status="COMPLETED",
                    order_dir="asc",
                )
            except Exception as exc:
                _emit_log(
                    db,
                    log_type="sync",
                    status="error",
                    message=f"API error fetching documents page {page}: {exc}",
                )
                errors += 1
                break

            items: list[dict[str, Any]] = resp.get("data") or []
            if not items:
                break

            for doc in items:
                doc_id = doc.get("id")
                if doc_id is None:
                    continue

                if state.last_document_id and doc_id <= state.last_document_id:
                    continue

                contract = db.scalar(
                    select(Contract).where(Contract.documenso_id == str(doc_id))
                )

                # Fallback: contracts sent before the document-ID extraction bug was
                # fixed may have documenso_id = "0" or NULL.  Try to match by the
                # primary signer's email so those contracts still get synced.
                if contract is None:
                    recipients: list[dict[str, Any]] = doc.get("recipients") or []
                    signer = next(
                        (r for r in recipients if r.get("role") in {"SIGNER", None}),
                        recipients[0] if recipients else None,
                    )
                    email = (signer.get("email") or "").strip().lower() if signer else ""
                    if email:
                        candidate = db.scalar(
                            select(Candidate).where(
                                func.lower(Candidate.personal_email) == email
                            )
                        )
                        if candidate:
                            contract = db.scalar(
                                select(Contract)
                                .where(Contract.candidate_id == candidate.id)
                                .where(Contract.status != ContractStatus.SIGNED)
                                .order_by(Contract.sent_at.desc().nullslast())
                            )
                            if contract:
                                # Repair the stored documenso_id so future lookups hit directly.
                                contract.documenso_id = str(doc_id)
                                db.add(contract)
                                db.flush()

                if contract is None:
                    continue

                try:
                    # Fetch the full document (with fields) one-by-one.
                    # list_documents returns summaries that have no field values;
                    # we need get_document_with_fields to populate them.
                    full_doc = ds_client.get_document_with_fields(doc_id)
                    _process_completed_document(db, contract=contract, doc_data=full_doc)
                    state.last_document_id = doc_id
                    state.documents_processed += 1
                    processed += 1
                    db.flush()
                except Exception as exc:
                    errors += 1
                    _emit_log(
                        db,
                        log_type="sync",
                        status="error",
                        message=f"Failed to process document {doc_id}: {exc}",
                        document_id=doc_id,
                        candidate_id=contract.candidate_id,
                    )

            total_pages = resp.get("totalPages") or resp.get("total_pages") or 1
            if page >= total_pages:
                break
            page += 1

        state.last_synced_at = datetime.now(UTC)
        state.sync_status = "idle"
        db.add(state)
        _emit_log(
            db,
            log_type="sync",
            status="success",
            message=f"Incremental sync complete. processed={processed} errors={errors}",
            extra={"processed": processed, "errors": errors},
        )

    except Exception as exc:
        state.sync_status = "failed"
        state.error_message = str(exc)
        db.add(state)
        _emit_log(
            db,
            log_type="sync",
            status="error",
            message=f"Sync crashed: {exc}",
            extra={"error": str(exc)},
        )
        raise

    return {"processed": processed, "errors": errors}


_COMPLETED_EVENTS = {"DOCUMENT_SIGNED", "DOCUMENT_COMPLETED"}
_OPENED_EVENTS = {"DOCUMENT_OPENED"}
_REJECTED_EVENTS = {"DOCUMENT_REJECTED"}
_CANCELLED_EVENTS = {"DOCUMENT_CANCELLED", "DOCUMENT_DELETED"}


def _normalize_webhook_event(event: str) -> str:
    normalized = (event or "").replace(".", "_").replace("-", "_").upper()
    aliases = {
        "DOCUMENT_COMPLETE": "DOCUMENT_COMPLETED",
        "ENVELOPE_COMPLETED": "DOCUMENT_COMPLETED",
        "ENVELOPE_SIGNED": "DOCUMENT_COMPLETED",
        "RECIPIENT_SIGNED": "DOCUMENT_SIGNED",
        "DOCUMENT_VIEWED": "DOCUMENT_OPENED",
        "ENVELOPE_OPENED": "DOCUMENT_OPENED",
        "ENVELOPE_REJECTED": "DOCUMENT_REJECTED",
        "ENVELOPE_CANCELLED": "DOCUMENT_CANCELLED",
        "ENVELOPE_DELETED": "DOCUMENT_DELETED",
    }
    return aliases.get(normalized, normalized)


def _extract_webhook_document(doc_data: dict[str, Any]) -> dict[str, Any]:
    data = doc_data or {}
    for key in ("document", "envelope", "data"):
        nested = data.get(key)
        if isinstance(nested, dict):
            return nested
    return data


def _doc_id_from_doc_data(doc_data: dict[str, Any]) -> str | None:
    raw = (
        doc_data.get("id")
        or doc_data.get("documentId")
        or doc_data.get("document_id")
        or (doc_data.get("document") or {}).get("id")
        or (doc_data.get("document") or {}).get("documentId")
    )
    return str(raw) if raw is not None else None


def _log_document_id(document_id: str | int | None) -> int | None:
    if document_id is None:
        return None
    value = str(document_id)
    return int(value) if value.isdigit() else None


def _sent_doc_id(doc: dict[str, Any]) -> str | None:
    raw = doc.get("documensoId") or doc.get("documentId")
    return str(raw) if raw is not None else None


def _mark_sent_document_status(
    contract: Contract,
    document_id: str | int | None,
    status: str,
    *,
    timestamp_field: str | None = None,
    at: datetime | None = None,
) -> bool:
    if not document_id or not contract.sent_documents:
        return False
    doc_id = str(document_id)
    timestamp = at or datetime.now(UTC)
    changed = False
    updated: list[dict[str, Any]] = []
    for doc in contract.sent_documents:
        item = dict(doc)
        if _sent_doc_id(item) == doc_id:
            if item.get("status") != status:
                item["status"] = status
                changed = True
            if timestamp_field and not item.get(timestamp_field):
                item[timestamp_field] = timestamp.isoformat()
                changed = True
        updated.append(item)
    if changed:
        contract.sent_documents = updated
    return changed


def _all_sent_documents_signed(contract: Contract) -> bool:
    docs = contract.sent_documents or []
    return bool(docs) and all(str(doc.get("status") or "").lower() in {"signed", "completed"} for doc in docs)


def _find_contract_by_sent_document(db: Session, document_id: str | int) -> Contract | None:
    doc_id = str(document_id)
    rows = db.scalars(select(Contract).where(Contract.sent_documents.isnot(None)))
    for contract in rows:
        if any(_sent_doc_id(doc) == doc_id for doc in contract.sent_documents or []):
            return contract
    return None


def _process_completed_document(
    db: Session,
    *,
    contract: Contract,
    doc_data: dict[str, Any],
) -> None:
    doc_id = _doc_id_from_doc_data(doc_data) or contract.documenso_id
    if doc_id:
        _mark_sent_document_status(
            contract,
            doc_id,
            "signed",
            timestamp_field="signedAt",
        )

    candidate = db.get(Candidate, contract.candidate_id)
    if candidate is not None and not candidate.employee_code and get_settings().auto_employee_provisioning:
        # Gated off by default — GRP codes are issued only via the IT bulk-register
        # upload, not automatically on contract signing. See AUTO_EMPLOYEE_PROVISIONING.
        try:
            from app.services.employees import assign_candidate_employee_code

            assign_candidate_employee_code(db, candidate)
        except Exception:
            logger.exception(
                "Failed to allocate employee code on contract signing for %s",
                contract.candidate_id,
            )

    if contract.status == ContractStatus.SIGNED and contract.pdf_url:
        return

    recipients: list[dict[str, Any]] = doc_data.get("recipients") or []
    fields: list[dict[str, Any]] = doc_data.get("fields") or []

    signed_at_raw = doc_data.get("completedAt") or doc_data.get("signedAt")
    signed_at: datetime | None = None
    if signed_at_raw:
        try:
            signed_at = datetime.fromisoformat(signed_at_raw.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            signed_at = None

    if not contract.pdf_url:
        try:
            pdf_bytes = ds_client.download_document_pdf(int(contract.documenso_id))
            pdf_url, storage_key = _store_pdf(
                pdf_bytes,
                candidate_id=contract.candidate_id,
                document_id=contract.documenso_id,
            )
            contract.pdf_url = pdf_url
            contract.pdf_storage_key = storage_key
            _emit_log(
                db,
                log_type="pdf_download",
                status="success",
                message=f"PDF stored at {storage_key}",
                document_id=int(contract.documenso_id),
                candidate_id=contract.candidate_id,
            )
        except Exception as exc:
            _emit_log(
                db,
                log_type="pdf_download",
                status="error",
                message=f"PDF download failed: {exc}",
                document_id=int(contract.documenso_id) if contract.documenso_id else None,
                candidate_id=contract.candidate_id,
            )

    # A Documenso envelope can bundle several signed PDFs (Offer Letter, NDA, Employment
    # Agreement). The download above only grabs the primary item, so fetch every envelope
    # item and record them on the contract for surfacing as separate documents.
    if not contract.signed_items:
        store_signed_envelope_items(db, contract=contract)

    _upsert_contract_fields(db, contract=contract, fields=fields, recipients=recipients)

    if contract.status != ContractStatus.SIGNED:
        contract.status = ContractStatus.SIGNED
        contract.signed_at = signed_at or datetime.now(UTC)

        if candidate and candidate.current_stage == CandidateStage.CONTRACT_SENT:
            candidate.current_stage = CandidateStage.CONTRACT_SIGNED
            candidate.current_status = "Contract Signed"
            db.add(candidate)

        # Hand the candidate off to IT for email/ID creation the moment the contract is
        # signed: create a pending IT request (shows in the IT dashboard) + notify IT.
        if candidate is not None:
            try:
                from app.db.models import NotificationType, Role
                from app.services import workflows as wf

                wf.ensure_it_request(db, candidate, requested_by="system")
                wf.notify_roles(
                    db,
                    roles={Role.IT_TEAM, Role.ADMIN},
                    title="New ID creation request",
                    message=f"{candidate.full_name} signed the contract — create their Ethara email/ID.",
                    type_=NotificationType.ACTION,
                    candidate_id=candidate.id,
                )
            except Exception:
                logger.exception("Failed to create IT request on contract signing for %s", contract.candidate_id)

        log_audit(
            db,
            entity_type="contract",
            entity_id=contract.id,
            action="contract_signed_via_documenso",
            actor=None,
            candidate_id=contract.candidate_id,
            new_value={"status": "signed", "documenso_id": contract.documenso_id},
        )

    db.add(contract)
    db.flush()


def _signed_item_doc_type(title: str | None, order: int) -> str:
    """Map a Documenso envelope-item title to a stable employee-document type."""
    text = (title or "").lower()
    if "nda" in text or "non-disclosure" in text or "non disclosure" in text:
        return "signed_nda"
    if "offer" in text:
        return "signed_offer_letter"
    if "employment" in text or "agreement" in text or "appointment" in text or "contract" in text:
        return "signed_employment_agreement"
    return f"signed_document_{order or 1}"


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return slug or "document"


def store_signed_envelope_items(db: Session, *, contract: Contract) -> list[dict[str, Any]]:
    """Download every signed item of the contract's Documenso envelope and record them on
    contract.signed_items as [{itemId, title, order, type, url, storageKey}, ...].

    Documenso's ``/document/{id}/download`` only returns the envelope's primary item (the
    offer letter), so this lists the envelope items and downloads each one individually.
    Idempotent-friendly: callers guard on ``contract.signed_items`` already being set.
    """
    if not contract.documenso_id:
        return contract.signed_items or []
    try:
        _envelope_id, items = ds_client.get_envelope_items_for_document(int(contract.documenso_id))
    except Exception as exc:
        _emit_log(
            db,
            log_type="pdf_download",
            status="error",
            message=f"Envelope item listing failed: {exc}",
            document_id=int(contract.documenso_id),
            candidate_id=contract.candidate_id,
        )
        return contract.signed_items or []

    stored: list[dict[str, Any]] = []
    for idx, item in enumerate(items):
        item_id = item.get("id")
        if not item_id:
            continue
        order = item.get("order") or (idx + 1)
        title = item.get("title") or f"Document {order}"
        try:
            pdf_bytes = ds_client.download_envelope_item_pdf(str(item_id))
            url, storage_key = _store_pdf(
                pdf_bytes,
                candidate_id=contract.candidate_id,
                document_id=f"{contract.documenso_id}_{order}_{_slugify(title)}",
            )
            stored.append(
                {
                    "itemId": str(item_id),
                    "title": title,
                    "order": order,
                    "type": _signed_item_doc_type(title, order),
                    "url": url,
                    "storageKey": storage_key,
                }
            )
        except Exception as exc:
            _emit_log(
                db,
                log_type="pdf_download",
                status="error",
                message=f"Envelope item {item_id} download failed: {exc}",
                document_id=int(contract.documenso_id),
                candidate_id=contract.candidate_id,
            )

    if stored:
        contract.signed_items = stored
        # Keep pdf_url on the primary item (offer letter, else lowest order) for back-compat.
        primary = next((s for s in stored if s["type"] == "signed_offer_letter"), stored[0])
        if not contract.pdf_url:
            contract.pdf_url = primary["url"]
            contract.pdf_storage_key = primary["storageKey"]
        db.add(contract)
        _emit_log(
            db,
            log_type="pdf_download",
            status="success",
            message=f"Stored {len(stored)} signed envelope item(s)",
            document_id=int(contract.documenso_id),
            candidate_id=contract.candidate_id,
        )
    return stored


def _store_pdf(pdf_bytes: bytes, *, candidate_id: str, document_id: str) -> tuple[str, str]:
    storage_key = f"contracts/{candidate_id}/{document_id}.pdf"
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


def _upsert_contract_fields(
    db: Session,
    *,
    contract: Contract,
    fields: list[dict[str, Any]],
    recipients: list[dict[str, Any]],
) -> None:
    existing_ids = {
        row.field_name: row
        for row in db.scalars(
            select(DocumensoContractField).where(
                DocumensoContractField.contract_id == contract.id
            )
        )
    }

    recipient_map: dict[str, str] = {}
    for r in recipients:
        rid = r.get("id")
        if rid:
            recipient_map[str(rid)] = r.get("email", "")

    for field in fields:
        field_meta = field.get("fieldMeta") or {}
        label = (field_meta.get("label") or field.get("label") or "").strip()
        ftype = field.get("type", "")
        value = (
            field.get("customText")
            or field_meta.get("text")
            or field.get("value")
            or ""
        ).strip()
        recipient_id = field.get("recipientId")
        recipient_email = recipient_map.get(str(recipient_id) if recipient_id else "", "")

        if not label:
            continue

        if label in existing_ids:
            row = existing_ids[label]
            row.field_value = str(value) if value else None
            row.recipient_email = recipient_email or None
            db.add(row)
        else:
            db.add(
                DocumensoContractField(
                    contract_id=contract.id,
                    candidate_id=contract.candidate_id,
                    field_name=label,
                    field_type=ftype,
                    field_value=str(value) if value else None,
                    recipient_email=recipient_email or None,
                )
            )

    db.flush()

    if fields:
        _emit_log(
            db,
            log_type="field_extraction",
            status="success",
            message=f"Extracted {len(fields)} fields for contract {contract.id}",
            document_id=int(contract.documenso_id) if contract.documenso_id else None,
            candidate_id=contract.candidate_id,
        )


def retry_failed_pdf_downloads(db: Session) -> dict[str, int]:
    settings = get_settings()
    if not settings.documenso_api_key:
        return {"retried": 0, "succeeded": 0, "errors": 0}

    contracts = list(
        db.scalars(
            select(Contract).where(
                Contract.documenso_id.isnot(None),
                Contract.status == ContractStatus.SIGNED,
                Contract.pdf_url.is_(None),
            )
        )
    )

    succeeded = 0
    errors = 0
    for contract in contracts:
        try:
            pdf_bytes = ds_client.download_document_pdf(int(contract.documenso_id))
            pdf_url, storage_key = _store_pdf(
                pdf_bytes,
                candidate_id=contract.candidate_id,
                document_id=contract.documenso_id,
            )
            contract.pdf_url = pdf_url
            contract.pdf_storage_key = storage_key
            db.add(contract)
            db.flush()
            succeeded += 1
        except Exception as exc:
            errors += 1
            _emit_log(
                db,
                log_type="pdf_download",
                status="error",
                message=f"Retry failed for contract {contract.id}: {exc}",
                document_id=int(contract.documenso_id),
                candidate_id=contract.candidate_id,
            )

    return {"retried": len(contracts), "succeeded": succeeded, "errors": errors}


def process_webhook_event(
    db: Session,
    *,
    event: str,
    doc_data: dict[str, Any],
) -> None:
    event = _normalize_webhook_event(event)
    doc_data = _extract_webhook_document(doc_data)
    doc_id = _doc_id_from_doc_data(doc_data)
    if doc_id is None:
        return
    log_doc_id = _log_document_id(doc_id)

    # ── Look up by documenso_id ────────────────────────────────────────────────
    contract = db.scalar(
        select(Contract).where(Contract.documenso_id == str(doc_id))
    )
    matched_sent_document = False
    if contract is None:
        contract = _find_contract_by_sent_document(db, doc_id)
        matched_sent_document = contract is not None

    # Fallback: contracts stored with the wrong documenso_id ("0" / NULL) can be
    # matched by the primary signer's email, same as run_incremental_sync does.
    if contract is None and event in (_OPENED_EVENTS | _COMPLETED_EVENTS):
        recipients: list[dict[str, Any]] = doc_data.get("recipients") or []
        signer = next(
            (r for r in recipients if r.get("role") in {"SIGNER", None}),
            recipients[0] if recipients else None,
        )
        email = (signer.get("email") or "").strip().lower() if signer else ""
        if email:
            candidate = db.scalar(
                select(Candidate).where(func.lower(Candidate.personal_email) == email)
            )
            if candidate:
                contract = db.scalar(
                    select(Contract)
                    .where(Contract.candidate_id == candidate.id)
                    .where(Contract.status != ContractStatus.SIGNED)
                    .order_by(Contract.sent_at.desc().nullslast())
                )
                if contract:
                    if not contract.documenso_id or contract.documenso_id == "0":
                        contract.documenso_id = str(doc_id)
                    db.add(contract)
                    db.flush()

    # ── Contract path ──────────────────────────────────────────────────────────
    if contract is not None:
        _emit_log(
            db,
            log_type="webhook",
            status="info",
            message=f"Webhook received: {event} for document {doc_id}",
            document_id=log_doc_id,
            candidate_id=contract.candidate_id,
        )

        if event in _OPENED_EVENTS:
            opened_at = datetime.now(UTC)
            if contract.viewed_at is None:
                contract.viewed_at = opened_at
            if contract.status == ContractStatus.SENT:
                contract.status = ContractStatus.VIEWED
            _mark_sent_document_status(
                contract,
                doc_id,
                "viewed",
                timestamp_field="viewedAt",
                at=opened_at,
            )
            db.add(contract)
            db.flush()

        elif event in _COMPLETED_EVENTS:
            is_primary_document = str(contract.documenso_id or "") == str(doc_id)
            if is_primary_document or not matched_sent_document:
                _process_completed_document(db, contract=contract, doc_data=doc_data)
            else:
                _mark_sent_document_status(
                    contract,
                    doc_id,
                    "signed",
                    timestamp_field="signedAt",
                )
                db.add(contract)
                db.flush()
                if _all_sent_documents_signed(contract) and contract.status != ContractStatus.SIGNED:
                    try:
                        primary_doc = ds_client.get_document_with_fields(int(contract.documenso_id))
                        if (primary_doc.get("status") or "").upper() == "COMPLETED":
                            _process_completed_document(db, contract=contract, doc_data=primary_doc)
                    except Exception:
                        logger.exception("Failed to reconcile primary contract document %s", contract.documenso_id)

        elif event in (_REJECTED_EVENTS | _CANCELLED_EVENTS):
            # SIGNED is a terminal state. A late / duplicate / out-of-order
            # rejection/cancellation webhook must NOT downgrade an already-signed
            # contract (that would discard a completed signature and
            # its stored PDF). Only non-terminal contracts can transition to
            # EXPIRED/CANCELLED. This also makes replayed events idempotent.
            if contract.status == ContractStatus.SIGNED:
                _emit_log(
                    db,
                    log_type="webhook",
                    status="info",
                    message=(
                        f"Ignored {event} for already-signed contract "
                        f"{contract.id} (document {doc_id}); SIGNED is terminal."
                    ),
                    document_id=log_doc_id,
                    candidate_id=contract.candidate_id,
                )
            else:
                new_status = (
                    ContractStatus.CANCELLED
                    if event in _CANCELLED_EVENTS
                    else ContractStatus.EXPIRED
                )
                _mark_sent_document_status(
                    contract,
                    doc_id,
                    new_status.value,
                    timestamp_field="cancelledAt" if new_status == ContractStatus.CANCELLED else "expiredAt",
                )
                contract.status = new_status
                db.add(contract)
                log_audit(
                    db,
                    entity_type="contract",
                    entity_id=contract.id,
                    action="contract_cancelled_via_documenso"
                    if new_status == ContractStatus.CANCELLED
                    else "contract_rejected_via_documenso",
                    actor=None,
                    candidate_id=contract.candidate_id,
                    new_value={"status": new_status.value, "event": event},
                )
                db.flush()
        return

    # ── Profile / non-contract document path ──────────────────────────────────
    # Any completed document that isn't a contract is treated as a signed profile
    # (NDA, onboarding form, statutory doc, etc.).  Extract fields immediately so
    # they're available without waiting for the next manual sync.
    if event in _COMPLETED_EVENTS:
        try:
            from app.services import documenso_profiles as profiles_svc

            profiles_svc.sync_profile_document(db, int(doc_id))
            _emit_log(
                db,
                log_type="webhook",
                status="success",
                message=f"Webhook {event}: signed profile synced for document {doc_id}",
                document_id=log_doc_id,
            )
        except Exception as exc:
            _emit_log(
                db,
                log_type="webhook",
                status="error",
                message=f"Webhook {event}: failed to sync profile for document {doc_id}: {exc}",
                document_id=log_doc_id,
            )

        # Old-employee employment contracts are NOT candidate-side Contracts, so the
        # contract path above never matches them. Sync the document straight to its
        # EmployeeContract (the same routine the 8-hour cron uses) so the webhook
        # updates OLD employees instantly too — not just new-hire/candidate contracts.
        try:
            from app.services import documenso_profiles as profiles_svc

            summary = ds_client.get_document(int(doc_id))
            if summary and profiles_svc._is_old_employee_contract_doc(summary):
                profiles_svc._sync_old_employee_contract_doc(db, doc_summary=summary)
                db.flush()
                _emit_log(
                    db,
                    log_type="webhook",
                    status="success",
                    message=f"Webhook {event}: old-employee contract synced for document {doc_id}",
                    document_id=log_doc_id,
                )
        except Exception as exc:
            _emit_log(
                db,
                log_type="webhook",
                status="error",
                message=f"Webhook {event}: old-employee contract sync failed for document {doc_id}: {exc}",
                document_id=log_doc_id,
            )
    else:
        _emit_log(
            db,
            log_type="webhook",
            status="info",
            message=f"Webhook {event} for non-contract document {doc_id} — no action needed",
            document_id=log_doc_id,
        )


_HISTORICAL_SYNC_ID = "historical"

_DOCS_PER_HISTORICAL_PAGE = 50
_PAGES_PER_RUN = 20


def get_or_create_historical_state(db: Session) -> DocumensoSyncState:
    state = db.get(DocumensoSyncState, _HISTORICAL_SYNC_ID)
    if state is None:
        state = DocumensoSyncState(
            id=_HISTORICAL_SYNC_ID,
            sync_status="idle",
            documents_processed=0,
        )
        db.add(state)
        db.flush()
    return state


def run_historical_sync(db: Session) -> dict[str, Any]:
    settings = get_settings()
    if not settings.documenso_api_key:
        return {"skipped": 1, "matched": 0, "errors": 0, "done": True}

    state = get_or_create_historical_state(db)
    if state.sync_status == "running":
        return {"skipped": 1, "matched": 0, "errors": 0, "done": False}

    state.sync_status = "running"
    state.error_message = None
    db.add(state)
    db.flush()

    start_page = (state.last_document_id or 0) + 1
    matched = 0
    errors = 0
    last_page_processed = start_page - 1
    total_pages = 1

    _emit_log(
        db,
        log_type="historical_sync",
        status="info",
        message=f"Historical sync run started from page {start_page}",
    )

    try:
        for page_offset in range(_PAGES_PER_RUN):
            page = start_page + page_offset

            try:
                resp = ds_client.list_documents(
                    page=page,
                    per_page=_DOCS_PER_HISTORICAL_PAGE,
                    status="COMPLETED",
                    order_dir="asc",
                )
            except Exception as exc:
                errors += 1
                _emit_log(
                    db,
                    log_type="historical_sync",
                    status="error",
                    message=f"API error on page {page}: {exc}",
                )
                break

            total_pages = resp.get("totalPages") or 1
            items: list[dict[str, Any]] = resp.get("data") or []

            for doc in items:
                try:
                    imported = _try_import_document(db, doc_data=doc)
                    if imported:
                        matched += 1
                        state.documents_processed += 1
                except Exception as exc:
                    errors += 1
                    _emit_log(
                        db,
                        log_type="historical_sync",
                        status="error",
                        message=f"Failed to import doc {doc.get('id')}: {exc}",
                        document_id=doc.get("id"),
                    )

            last_page_processed = page
            db.flush()

            if page >= total_pages:
                break

        is_done = last_page_processed >= total_pages
        state.last_document_id = None if is_done else last_page_processed
        state.last_synced_at = datetime.now(UTC)
        state.sync_status = "completed" if is_done else "idle"
        db.add(state)

        _emit_log(
            db,
            log_type="historical_sync",
            status="success",
            message=(
                f"Historical sync pages {start_page}–{last_page_processed}/{total_pages}: "
                f"matched={matched} errors={errors}"
                + (" ✓ ALL DONE" if is_done else f" (continue from page {last_page_processed + 1})")
            ),
            extra={
                "pages_done": last_page_processed,
                "total_pages": total_pages,
                "matched": matched,
                "errors": errors,
                "is_done": is_done,
            },
        )

    except Exception as exc:
        state.sync_status = "failed"
        state.error_message = str(exc)
        db.add(state)
        _emit_log(
            db,
            log_type="historical_sync",
            status="error",
            message=f"Historical sync crashed: {exc}",
        )
        raise

    return {
        "matched": matched,
        "errors": errors,
        "pages_done": last_page_processed,
        "total_pages": total_pages,
        "done": state.sync_status == "completed",
    }


def _try_import_document(db: Session, *, doc_data: dict[str, Any]) -> bool:
    doc_id = doc_data.get("id")
    if not doc_id:
        return False

    existing = db.scalar(select(Contract).where(Contract.documenso_id == str(doc_id)))
    if existing:
        return False

    doc_status = doc_data.get("status", "")
    recipients: list[dict[str, Any]] = doc_data.get("recipients") or []

    for recipient in recipients:
        email = (recipient.get("email") or "").strip().lower()
        if not email:
            continue

        candidate = db.scalar(
            select(Candidate).where(func.lower(Candidate.personal_email) == email)
        )
        if candidate is None:
            continue

        contract = db.scalar(select(Contract).where(Contract.candidate_id == candidate.id))
        if contract is None:
            from app.services.workflows import ensure_contract

            contract = ensure_contract(db, candidate.id)

        if contract.documenso_id and contract.documenso_id != str(doc_id):
            _emit_log(
                db,
                log_type="historical_sync",
                status="warning",
                message=(
                    f"Candidate {candidate.full_name} already has"
                    f" documenso_id={contract.documenso_id}, skipping doc {doc_id}"
                ),
                document_id=doc_id,
                candidate_id=candidate.id,
            )
            continue

        contract.documenso_id = str(doc_id)
        contract.template_id = doc_data.get("templateId")

        completed_at_raw = doc_data.get("completedAt")
        signed_at: datetime | None = None
        if completed_at_raw:
            try:
                signed_at = datetime.fromisoformat(completed_at_raw.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                pass

        if doc_status == "COMPLETED":
            contract.status = ContractStatus.SIGNED
            contract.signed_at = signed_at or datetime.now(UTC)
            if candidate.current_stage in {
                CandidateStage.CONTRACT_SENT,
                CandidateStage.SELECTION_FORM_VALIDATED,
                CandidateStage.SELECTION_FORM_SUBMITTED,
                CandidateStage.SELECTION_FORM_SENT,
            }:
                candidate.current_stage = CandidateStage.CONTRACT_SIGNED
                candidate.current_status = "Contract Signed"
                db.add(candidate)

            if not contract.pdf_url:
                try:
                    pdf_bytes = ds_client.download_document_pdf(doc_id)
                    pdf_url, storage_key = _store_pdf(
                        pdf_bytes,
                        candidate_id=candidate.id,
                        document_id=str(doc_id),
                    )
                    contract.pdf_url = pdf_url
                    contract.pdf_storage_key = storage_key
                    _emit_log(
                        db,
                        log_type="pdf_download",
                        status="success",
                        message=f"Downloaded PDF for doc {doc_id} ({candidate.full_name})",
                        document_id=doc_id,
                        candidate_id=candidate.id,
                    )
                except Exception as exc:
                    _emit_log(
                        db,
                        log_type="pdf_download",
                        status="error",
                        message=f"PDF download failed for doc {doc_id}: {exc}",
                        document_id=doc_id,
                        candidate_id=candidate.id,
                    )

        elif doc_status == "PENDING":
            if contract.status == ContractStatus.DRAFT:
                contract.status = ContractStatus.SENT
            token = recipient.get("token")
            if token and not contract.signed_url:
                contract.signed_url = ds_client.build_signing_url(token)

        db.add(contract)

        log_audit(
            db,
            entity_type="contract",
            entity_id=contract.id,
            action="contract_imported_from_documenso",
            actor=None,
            candidate_id=candidate.id,
            new_value={
                "documenso_id": str(doc_id),
                "status": contract.status.value,
                "source": "historical_import",
            },
        )
        _emit_log(
            db,
            log_type="historical_sync",
            status="success",
            message=f"Imported doc {doc_id} → {candidate.full_name} ({email}) [{doc_status}]",
            document_id=doc_id,
            candidate_id=candidate.id,
        )
        db.flush()
        return True

    return False


def poll_pending_contract_statuses(db: Session) -> dict[str, int]:
    settings = get_settings()
    if not settings.documenso_api_key:
        return {"skipped": 1, "updated": 0}

    pending_contracts = list(
        db.scalars(
            select(Contract).where(
                Contract.documenso_id.isnot(None),
                Contract.status.in_([ContractStatus.SENT, ContractStatus.VIEWED]),
            )
        )
    )
    updated = 0
    for contract in pending_contracts:
        try:
            doc = ds_client.get_document_with_fields(int(contract.documenso_id))
            doc_status = doc.get("status", "")
            if doc_status == "COMPLETED" and contract.status != ContractStatus.SIGNED:
                _process_completed_document(db, contract=contract, doc_data=doc)
                updated += 1
                db.flush()
            elif doc_status == "PENDING":
                recipients = doc.get("recipients") or []
                for r in recipients:
                    if r.get("readStatus") == "OPENED":
                        opened_at = contract.viewed_at or datetime.now(UTC)
                        contract.viewed_at = opened_at
                        if contract.status == ContractStatus.SENT:
                            contract.status = ContractStatus.VIEWED
                        _mark_sent_document_status(
                            contract,
                            contract.documenso_id,
                            "viewed",
                            timestamp_field="viewedAt",
                            at=opened_at,
                        )
                        db.add(contract)
                        db.flush()
                        break
        except Exception as exc:
            _emit_log(
                db,
                log_type="sync",
                status="error",
                message=f"Status poll failed for contract {contract.id}: {exc}",
                document_id=int(contract.documenso_id) if contract.documenso_id else None,
                candidate_id=contract.candidate_id,
            )
    return {"updated": updated, "checked": len(pending_contracts)}


def reset_historical_sync(db: Session) -> None:
    state = get_or_create_historical_state(db)
    state.sync_status = "idle"
    state.last_document_id = None
    state.last_synced_at = None
    state.documents_processed = 0
    state.error_message = None
    db.add(state)
    db.flush()
