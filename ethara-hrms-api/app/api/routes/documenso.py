from __future__ import annotations

import hmac
import logging
import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_permissions, user_has_any_role
from app.core.config import get_settings
from app.core.database import SessionLocal, get_db
from app.core.permissions import Permission
from app.core.signed_urls import make_signed_upload_url
from app.db.models import (
    Candidate,
    CandidateStage,
    Contract,
    ContractStatus,
    DocumensoContractField,
    DocumensoSignedProfile,
    DocumensoSyncLog,
    DocumensoTemplateCache,
    Role,
    User,
)
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.documenso import (
    BulkSendContractRequest,
    CancelContractRequest,
    ContractFieldRead,
    ContractRead,
    ProfileSyncStateRead,
    SendContractRequest,
    SignedProfileOpenUrlRead,
    SignedProfileListResponse,
    SignedProfileRead,
    SyncJobRunRead,
    SyncLogRead,
    SyncStateRead,
    TemplateCacheRead,
)
from app.services import candidates as candidate_service
from app.services import documenso as ds_client
from app.services import documenso_profiles as profiles_svc
from app.services import documenso_sync as sync_svc
from app.services.workflows import ensure_contract

logger = logging.getLogger(__name__)

router = APIRouter(tags=["documenso"])

_CONTRACT_SENT_AND_LATER_STAGES = {
    CandidateStage.CONTRACT_SENT,
    CandidateStage.CONTRACT_SIGNED,
    CandidateStage.INDUCTION_COMPLETED,
    CandidateStage.IT_EMAIL_CREATED,
    CandidateStage.WELCOME_MAIL_SENT,
    CandidateStage.STATUTORY_FORMS_SENT,
    CandidateStage.STATUTORY_FORMS_SUBMITTED,
    CandidateStage.COMPLIANCE_VERIFIED,
    CandidateStage.ONBOARDING_COMPLETED,
}


def _contract_document_ids(contract: Contract) -> list[str]:
    seen: set[str] = set()
    ids: list[str] = []

    def _add(raw: object) -> None:
        value = str(raw or "").strip()
        if not value or value == "0" or value in seen:
            return
        seen.add(value)
        ids.append(value)

    _add(contract.documenso_id)
    for doc in contract.sent_documents or []:
        _add(doc.get("documensoId") or doc.get("documentId"))
    return ids


def _mark_sent_documents_cancelled(contract: Contract, *, cancelled_at: datetime) -> None:
    if not contract.sent_documents:
        return
    cancelled_iso = cancelled_at.isoformat()
    updated: list[dict] = []
    for doc in contract.sent_documents:
        item = dict(doc)
        if str(item.get("status") or "").lower() not in {"signed", "completed"}:
            item["status"] = "cancelled"
            item["cancelledAt"] = cancelled_iso
        updated.append(item)
    contract.sent_documents = updated


def _contract_read(contract: Contract) -> ContractRead:
    return ContractRead.model_validate(contract, from_attributes=True)


def _run_incremental_sync_background(trigger: str = "manual") -> None:
    with SessionLocal() as db:
        run = sync_svc.start_sync_job_run(db, job_name="incremental_contract_sync", trigger=trigger)
        db.commit()
        try:
            result = sync_svc.run_incremental_sync(db)
            db.commit()
            sync_svc.finish_sync_job_run(
                db, run,
                status="completed",
                documents_processed=result.get("processed", 0),
                errors=result.get("errors", 0),
                message=f"processed={result.get('processed', 0)} errors={result.get('errors', 0)}",
            )
            db.commit()
            logger.info("Incremental contract sync finished inline: %s", result)
        except Exception:
            logger.exception("Incremental contract sync crashed")
            db.rollback()
            try:
                sync_svc.finish_sync_job_run(db, run, status="failed", message="crashed — see server logs")
                db.commit()
            except Exception:
                pass


def _run_signed_profiles_sync_background(trigger: str = "manual") -> None:
    total_synced = 0
    total_errors = 0
    iterations = 0

    with SessionLocal() as db:
        run = profiles_svc.start_profile_sync_job(db, trigger=trigger)
        db.commit()
        try:
            while True:
                iterations += 1
                result = profiles_svc.sync_signed_profiles(db)
                db.commit()

                total_synced += result.get("synced", 0)
                total_errors += result.get("errors", 0)

                if result.get("done") or result.get("skipped"):
                    old_contract_result = profiles_svc.sync_old_employee_contract_documents(db)
                    db.commit()
                    logger.info(
                        "Signed profiles background sync finished: synced=%s errors=%s iterations=%s done=%s skipped=%s old_contracts=%s",
                        total_synced,
                        total_errors,
                        iterations,
                        result.get("done"),
                        result.get("skipped"),
                        old_contract_result,
                    )
                    profiles_svc.finish_profile_sync_job(
                        db, run,
                        status="completed",
                        documents_processed=total_synced,
                        errors=total_errors,
                        message=(
                            f"iterations={iterations} synced={total_synced} errors={total_errors} "
                            f"old_contracts={old_contract_result.get('updated', 0)}"
                        ),
                    )
                    db.commit()
                    break

                # Keep the import moving forward in-process without forcing the UI
                # request to stay open for the entire multi-page sync.
                time.sleep(2)
        except Exception:
            logger.exception(
                "Signed profiles background sync crashed: synced=%s errors=%s iterations=%s",
                total_synced,
                total_errors,
                iterations,
            )
            db.rollback()
            try:
                profiles_svc.finish_profile_sync_job(db, run, status="failed", message="crashed — see server logs")
                db.commit()
            except Exception:
                pass
            # Reset the sync state so future sync calls are not permanently blocked.
            try:
                from app.db.models import DocumensoSyncState

                state = db.get(DocumensoSyncState, "profiles")
                if state and state.sync_status == "running":
                    state.sync_status = "error"
                    db.add(state)
                    db.commit()
            except Exception:
                logger.exception("Failed to reset sync state after crash")


def _documenso_run_inline() -> bool:
    settings = get_settings()
    return settings.is_development or settings.celery_task_always_eager


def _require_api_key() -> None:
    settings = get_settings()
    if not settings.documenso_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Documenso integration is not configured",
        )


def _require_contract_staff(
    current_user: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_READ))],
) -> User:
    """Contract administration here (Documenso sync, signed-profile lookups, and
    every candidate_id-/profile_id-addressed contract read) is STAFF-ONLY.
    Candidates hold CONTRACTS_READ only so they can view their OWN contract via
    the scoped `/contracts/{candidate_id}` route (enforced by
    `_get_accessible_candidate`). Without this gate, a candidate could read any
    other candidate's contract / signed document URL by id (IDOR)."""
    if user_has_any_role(current_user, {Role.CANDIDATE}) and not user_has_any_role(
        current_user,
        {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.TA},
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Candidates cannot access contract administration.",
        )
    return current_user


@router.get("/documenso/templates", response_model=list[TemplateCacheRead])
def list_templates(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
    refresh: bool = Query(default=False),
):
    _require_api_key()
    if refresh:
        sync_svc.refresh_template_cache(db)
        db.commit()
    rows = list(db.scalars(select(DocumensoTemplateCache).order_by(DocumensoTemplateCache.title)))
    return [TemplateCacheRead.model_validate(r, from_attributes=True) for r in rows]


@router.post("/documenso/templates/refresh", response_model=MessageResponse)
def refresh_templates(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    _require_api_key()
    count = sync_svc.refresh_template_cache(db)
    db.commit()
    return MessageResponse(message=f"Refreshed {count} templates")


@router.post(
    "/documenso/contracts/{candidate_id}/send",
    response_model=ContractRead,
)
def send_contract(
    candidate_id: str,
    payload: SendContractRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    _require_api_key()

    candidate = db.scalar(
        select(Candidate)
        .options(joinedload(Candidate.position))
        .where(Candidate.id == candidate_id)
    )
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    contract = ensure_contract(db, candidate_id)

    # Terminal-state guard: once a contract is SIGNED, re-sending would create a
    # brand-new Documenso document and overwrite documenso_id / signed_url,
    # orphaning the completed signature and its stored PDF.
    if contract.status == ContractStatus.SIGNED or candidate.current_stage == CandidateStage.CONTRACT_SIGNED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This contract is already signed. Do not send another contract for this candidate.",
        )

    # Active-state guard: while a contract is already out for signature, creating
    # another Documenso document makes HRMS track the newest envelope and can hide
    # the one the candidate already signed.
    if contract.status in {ContractStatus.SENT, ContractStatus.VIEWED} and (
        contract.documenso_id or contract.signed_url
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This contract has already been sent. Use Check Status instead of sending another contract.",
        )

    # Resolve every selected template (multi-select sends each as its own document);
    # the first one is the primary contract tracked on the Contract row.
    template_ids: list[int] = [tid for tid in (payload.template_ids or []) if tid]
    if payload.template_id and payload.template_id not in template_ids:
        template_ids.insert(0, payload.template_id)
    if not template_ids:
        raise HTTPException(status_code=400, detail="Select at least one template.")

    template_rows: list[DocumensoTemplateCache] = []
    for tid in template_ids:
        row = db.scalar(
            select(DocumensoTemplateCache).where(DocumensoTemplateCache.template_id == tid)
        )
        if row is None:
            raise HTTPException(
                status_code=404,
                detail=f"Template {tid} not found in cache. Run refresh first.",
            )
        template_rows.append(row)
    template_row = template_rows[0]

    contract.template_id = template_row.template_id
    if payload.ctc is not None:
        contract.ctc = payload.ctc
    if payload.joining_date is not None:
        contract.joining_date = payload.joining_date
    db.add(contract)
    db.flush()

    def _recipients_for(template_recipients: list) -> list[dict]:
        recipients_payload = [
            {
                "id": r.get("id"),
                "name": candidate.full_name,
                "email": candidate.personal_email,
            }
            for r in template_recipients
            if r.get("role") in {"SIGNER", "VIEWER", None}
        ]
        if not recipients_payload and template_recipients:
            first = template_recipients[0]
            recipients_payload = [
                {
                    "id": first.get("id"),
                    "name": candidate.full_name,
                    "email": candidate.personal_email,
                }
            ]
        return recipients_payload

    # Create every document in Documenso BEFORE touching contract state, so a failure
    # part-way never leaves the contract pointing at a document that was never created.
    created_docs: list[tuple[DocumensoTemplateCache, int, str | None]] = []
    for row in template_rows:
        prefill = ds_client.map_candidate_fields(
            candidate,
            contract,
            row.fields or [],
            extra_fields=payload.extra_fields,
        )
        try:
            doc_resp = ds_client.create_document_from_template(
                template_id=row.template_id,
                title=f"{row.title} - {candidate.full_name}",
                recipients=_recipients_for(row.recipients or []),
                prefill_fields=prefill,
                distribute=payload.send_immediately,
            )
        except Exception as exc:
            logger.exception("create_document_from_template failed for template %s", row.template_id)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    f"Could not create the document for template '{row.title}' in Documenso. "
                    "Please try again or check the server logs."
                ),
            ) from exc

        doc_id: int = ds_client.extract_document_id(doc_resp) or 0
        token = ds_client.extract_signing_token(doc_resp)
        if not doc_id:
            logger.warning(
                "Could not extract document ID from Documenso response for candidate %s. "
                "Response keys: %s",
                candidate_id,
                list(doc_resp.keys()) if isinstance(doc_resp, dict) else type(doc_resp),
            )
        created_docs.append((row, doc_id, token))

    sent_at = datetime.now(UTC)
    primary_doc_id, primary_token = created_docs[0][1], created_docs[0][2]
    contract.documenso_id = str(primary_doc_id) if primary_doc_id else None
    contract.signed_url = ds_client.build_signing_url(primary_token) if primary_token else None
    contract.pdf_url = None
    contract.pdf_storage_key = None
    contract.signed_items = None
    contract.signed_at = None
    contract.viewed_at = None
    contract.expires_at = None
    contract.sent_documents = [
        {
            "documensoId": str(doc_id) if doc_id else None,
            "templateId": row.template_id,
            "templateTitle": row.title,
            "signingUrl": ds_client.build_signing_url(token) if token else None,
            "status": "sent" if payload.send_immediately else "draft",
            "sentAt": sent_at.isoformat(),
            "primary": index == 0,
        }
        for index, (row, doc_id, token) in enumerate(created_docs)
    ]

    if payload.send_immediately:
        if candidate.current_stage not in _CONTRACT_SENT_AND_LATER_STAGES:
            candidate_service.advance_stage(
                db,
                candidate=candidate,
                to_stage=CandidateStage.CONTRACT_SENT,
                notes="Contract sent via Documenso.",
                actor=current_user,
                request=request,
            )
        elif contract.status in {
            ContractStatus.DRAFT,
            ContractStatus.EXPIRED,
            ContractStatus.CANCELLED,
        }:
            contract.status = ContractStatus.SENT
            contract.sent_at = sent_at

    db.add(contract)

    from app.services.audit import log_audit

    log_audit(
        db,
        entity_type="contract",
        entity_id=contract.id,
        action="contract_sent_via_documenso",
        actor=current_user,
        request=request,
        candidate_id=candidate_id,
        new_value={
            "documenso_id": str(primary_doc_id),
            "template_id": template_row.template_id,
            "documenso_ids": [str(d) for _, d, _ in created_docs],
            "template_ids": [r.template_id for r, _, _ in created_docs],
            "status": contract.status.value,
        },
    )

    db.commit()
    db.refresh(contract)
    return _contract_read(contract)


@router.get(
    "/documenso/contracts/{candidate_id}",
    response_model=ContractRead,
)
def get_contract_details(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
):
    contract = db.scalar(select(Contract).where(Contract.candidate_id == candidate_id))
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    return _contract_read(contract)


@router.post(
    "/documenso/contracts/{candidate_id}/cancel",
    response_model=ContractRead,
)
def cancel_contract(
    candidate_id: str,
    payload: CancelContractRequest | None,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    contract = db.scalar(select(Contract).where(Contract.candidate_id == candidate_id))
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    candidate = db.get(Candidate, candidate_id)
    force = bool(payload and getattr(payload, "force", False))
    is_signed = contract.status == ContractStatus.SIGNED or (
        candidate is not None and candidate.current_stage == CandidateStage.CONTRACT_SIGNED
    )
    # By default a SIGNED contract is protected. Cancelling it (to replace with a different
    # one) requires an explicit force opt-in — this preserves the existing safe behaviour and
    # only unlocks the replace path when the caller deliberately asks for it.
    if is_signed and not force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This contract is already signed and cannot be cancelled. Use Replace to override.",
        )
    # Replace is allowed both for candidates still at the contract stage AND for onboarded
    # employees (re-issuing a contract). It is safe because the stage rollback below only fires
    # for CONTRACT_SENT/CONTRACT_SIGNED, and the send flow skips the stage advance once a
    # candidate is CONTRACT_SENT-or-later — so an onboarded employee is never regressed.

    remote_errors: list[str] = []
    settings = get_settings()
    if settings.documenso_api_key:
        for document_id in _contract_document_ids(contract):
            delete_target: str | int = document_id
            try:
                if document_id.isdigit():
                    doc = ds_client.get_document_with_fields(int(document_id))
                    delete_target = doc.get("envelopeId") or document_id
                ds_client.delete_document(delete_target)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Documenso delete failed for document %s", document_id)
                remote_errors.append(f"{document_id}: {exc}")

    # Resilient cancel: a remote-delete failure (most commonly the document was
    # already removed in Documenso, so the API 404s) must NOT block the local
    # cancellation — otherwise the contract is stuck on "sent" forever and staff can
    # neither see it as cancelled nor issue a replacement. Mark it cancelled locally
    # regardless and record any remote errors on the audit trail for follow-up.
    if remote_errors:
        logger.warning(
            "Contract %s cancelled locally despite Documenso delete issues: %s",
            contract.id,
            "; ".join(remote_errors),
        )

    cancelled_at = datetime.now(UTC)
    contract.status = ContractStatus.CANCELLED
    contract.signed_url = None
    contract.expires_at = cancelled_at
    _mark_sent_documents_cancelled(contract, cancelled_at=cancelled_at)
    db.add(contract)

    if candidate is not None and candidate.current_stage in {
        CandidateStage.CONTRACT_SENT,
        CandidateStage.CONTRACT_SIGNED,
    }:
        candidate_service.advance_stage(
            db,
            candidate=candidate,
            to_stage=CandidateStage.SELECTION_FORM_VALIDATED,
            notes=(
                "Signed contract cancelled to allow a replacement."
                if is_signed
                else "Contract cancelled in Documenso."
            ),
            actor=current_user,
            request=request,
        )

    from app.services.audit import log_audit

    log_audit(
        db,
        entity_type="contract",
        entity_id=contract.id,
        action="contract_cancelled_via_documenso",
        actor=current_user,
        request=request,
        candidate_id=candidate_id,
        new_value={
            "status": ContractStatus.CANCELLED.value,
            "documenso_ids": _contract_document_ids(contract),
            "reason": payload.reason if payload else None,
            "remote_errors": remote_errors or None,
            "forcedSignedCancel": bool(is_signed and force),
        },
    )

    db.commit()
    db.refresh(contract)
    return _contract_read(contract)


@router.post("/documenso/contracts/bulk-send")
def bulk_send_contracts(
    payload: BulkSendContractRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    """Send one template to many candidates at once. Reuses the single-send flow per candidate
    so prefill/stage-advance/guards behave identically; reports per-candidate success/failure."""
    _require_api_key()
    results: list[dict] = []
    sent = 0
    failed = 0
    for cid in payload.candidate_ids:
        one = SendContractRequest.model_validate(
            {
                "templateId": payload.template_id,
                "templateIds": payload.template_ids,
                "ctc": payload.ctc,
                "joiningDate": payload.joining_date,
                "sendImmediately": payload.send_immediately,
            }
        )
        try:
            send_contract(cid, one, request, db, current_user)
            results.append({"candidateId": cid, "status": "sent"})
            sent += 1
        except HTTPException as exc:
            db.rollback()
            results.append({"candidateId": cid, "status": "failed", "error": str(exc.detail)})
            failed += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("bulk send failed for candidate %s", cid)
            results.append({"candidateId": cid, "status": "failed", "error": "Send failed (see server logs)."})
            failed += 1
    return {"sent": sent, "failed": failed, "results": results}


@router.post(
    "/documenso/contracts/{candidate_id}/refresh",
    response_model=ContractRead,
)
def refresh_contract_status(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    """On-demand: pull this candidate's contract status straight from Documenso and update it.

    Lets HR click 'Check Status' for one candidate instead of waiting for the periodic sync —
    marks the contract signed (+ stores PDF, advances the candidate, adds it to Signed Contracts)
    or viewed, as appropriate.
    """
    _require_api_key()
    contract = db.scalar(select(Contract).where(Contract.candidate_id == candidate_id))
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    if not contract.documenso_id or contract.documenso_id == "0":
        raise HTTPException(
            status_code=400,
            detail="This contract hasn't been sent for signing yet, so there's no status to check.",
        )
    try:
        doc = ds_client.get_document_with_fields(int(contract.documenso_id))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to fetch Documenso document status for contract %s", contract.id)
        raise HTTPException(status_code=502, detail="Could not reach Documenso. Please try again shortly.") from exc

    doc_status = (doc.get("status") or "").upper()
    reconciled_signed = False
    if doc_status == "COMPLETED":
        sync_svc._process_completed_document(db, contract=contract, doc_data=doc)
        reconciled_signed = True
        # Also make it appear in Signed Contracts (signed-profile repository).
        try:
            profiles_svc.sync_profile_document(db, int(contract.documenso_id))
        except Exception:
            logger.exception("Signed-profile upsert failed for doc %s", contract.documenso_id)
    else:
        candidate = db.get(Candidate, contract.candidate_id)
        if candidate is not None:
            try:
                signed_profile, signed_doc = profiles_svc.sync_latest_contract_profile_for_candidate(
                    db,
                    candidate=candidate,
                )
            except Exception:
                logger.exception("Signed-profile reconciliation failed for candidate %s", candidate.id)
                signed_profile, signed_doc = None, None
            if signed_profile is not None:
                contract.documenso_id = str(signed_profile.documenso_doc_id)
                if signed_profile.pdf_url and not contract.pdf_url:
                    contract.pdf_url = signed_profile.pdf_url
                db.add(contract)
                db.flush()
                if signed_doc is None:
                    try:
                        signed_doc = ds_client.get_document_with_fields(signed_profile.documenso_doc_id)
                    except Exception:
                        logger.exception(
                            "Failed to fetch reconciled signed Documenso document %s",
                            signed_profile.documenso_doc_id,
                        )
                if signed_doc is not None:
                    sync_svc._process_completed_document(db, contract=contract, doc_data=signed_doc)
                    reconciled_signed = True
    if not reconciled_signed and any(
        (r.get("readStatus") or "").upper() == "OPENED" for r in (doc.get("recipients") or [])
    ):
        contract.viewed_at = contract.viewed_at or datetime.now(UTC)
        if contract.status == ContractStatus.SENT:
            contract.status = ContractStatus.VIEWED
        sync_svc._mark_sent_document_status(
            contract,
            contract.documenso_id,
            "viewed",
            timestamp_field="viewedAt",
            at=contract.viewed_at,
        )
        db.add(contract)

    db.commit()
    db.refresh(contract)
    return _contract_read(contract)


@router.get(
    "/documenso/contracts/{candidate_id}/fields",
    response_model=list[ContractFieldRead],
)
def get_contract_fields(
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
):
    contract = db.scalar(select(Contract).where(Contract.candidate_id == candidate_id))
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    rows = list(
        db.scalars(
            select(DocumensoContractField).where(
                DocumensoContractField.contract_id == contract.id
            )
        )
    )
    return [ContractFieldRead.model_validate(r, from_attributes=True) for r in rows]


@router.post("/webhooks/documenso")
async def documenso_webhook(request: Request, db: Annotated[Session, Depends(get_db)]):
    settings = get_settings()
    body = await request.body()

    # Fail closed: if no webhook secret is configured we cannot verify the
    # sender, so refuse to process attacker-controllable contract/signature
    # events rather than trusting them.
    if not settings.documenso_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Documenso webhook secret is not configured",
        )

    # Two authentication schemes are supported:
    #  1) Shared secret — the hosted app.documenso.com sends the configured secret
    #     verbatim in the `X-Documenso-Secret` header. Compare it constant-time.
    #  2) HMAC signature — some (self-hosted) deployments instead HMAC-SHA256 the
    #     raw body and send it in a signature header. Kept as a fallback.
    secret_header = request.headers.get("x-documenso-secret") or ""
    authenticated = bool(secret_header) and hmac.compare_digest(
        secret_header, settings.documenso_webhook_secret
    )
    sig_header = (
        request.headers.get("x-documenso-signature")
        or request.headers.get("documenso-signature")
        or request.headers.get("x-webhook-signature")
        or ""
    )
    if not authenticated and sig_header:
        authenticated = ds_client.verify_webhook_signature(
            body, sig_header, settings.documenso_webhook_secret
        )
    if not authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )

    try:
        import json

        raw = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON") from None

    event: str = raw.get("event") or raw.get("type") or raw.get("eventType") or ""
    doc_data: dict = raw.get("payload") or raw.get("data") or raw.get("document") or raw

    # Replay guard: a captured, validly-signed delivery must not be re-processable. Record
    # each exact (body+signature) delivery once with a TTL and skip duplicates. Fails OPEN —
    # a dedup-store hiccup never blocks a legitimate webhook (CWE-294).
    try:
        import hashlib
        import redis as _redis

        _r = _redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
        _key = "documenso:wh:" + hashlib.sha256(body + sig_header.encode()).hexdigest()
        if not _r.set(_key, "1", nx=True, ex=86400):
            logger.info("Skipping duplicate Documenso webhook delivery for event=%s", event)
            return {"received": True, "event": event, "duplicate": True}
    except Exception:
        pass  # fail open — never block a real webhook on a dedup-store error

    if _documenso_run_inline():
        # Process synchronously in dev/test — no Celery worker needed.
        try:
            sync_svc.process_webhook_event(db, event=event, doc_data=doc_data)
            db.commit()
        except Exception:
            logger.exception("Inline webhook processing failed for event=%s", event)
            db.rollback()
    else:
        from app.tasks.documenso import process_webhook_event as _wh_task

        _wh_task.delay(event, doc_data)

    return {"received": True, "event": event}


@router.get("/documenso/sync/historical/state", response_model=SyncStateRead)
def get_historical_sync_state(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
):
    state = sync_svc.get_or_create_historical_state(db)
    db.commit()
    return SyncStateRead.model_validate(state, from_attributes=True)


@router.post("/documenso/sync/historical", response_model=MessageResponse)
def trigger_historical_sync(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    _require_api_key()
    from app.tasks.documenso import run_historical_sync

    run_historical_sync.delay()
    return MessageResponse(message="Historical import queued — processing 1,000 documents per run")


@router.post("/documenso/sync/historical/reset", response_model=MessageResponse)
def reset_historical_sync(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    sync_svc.reset_historical_sync(db)
    db.commit()
    return MessageResponse(message="Historical sync cursor reset — next trigger starts from page 1")


@router.get("/documenso/sync/state", response_model=SyncStateRead)
def get_sync_state(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
):
    state = sync_svc.get_or_create_sync_state(db)
    db.commit()
    return SyncStateRead.model_validate(state, from_attributes=True)


@router.post("/documenso/sync/trigger", response_model=MessageResponse)
def trigger_sync(
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    _require_api_key()

    if _documenso_run_inline():
        background_tasks.add_task(_run_incremental_sync_background, "manual")
        return MessageResponse(message="Sync started — processing in background")

    from app.tasks.documenso import run_incremental_sync

    run_incremental_sync.delay(trigger="manual")
    return MessageResponse(message="Sync job queued")


@router.get("/documenso/sync/job-runs", response_model=list[SyncJobRunRead])
def list_sync_job_runs(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
    job_name: str | None = Query(default=None, alias="jobName"),
    limit: int = Query(default=50, le=200),
):
    runs = sync_svc.list_sync_job_runs(db, job_name=job_name, limit=limit)
    return [SyncJobRunRead.model_validate(r, from_attributes=True) for r in runs]


@router.post("/documenso/sync/templates", response_model=MessageResponse)
def trigger_template_refresh(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    _require_api_key()
    from app.tasks.documenso import refresh_template_cache

    refresh_template_cache.delay()
    return MessageResponse(message="Template refresh queued")


@router.get(
    "/documenso/sync/logs",
    response_model=PaginatedResponse[SyncLogRead],
)
def list_sync_logs(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, le=200),
    log_type: str | None = Query(default=None, alias="logType"),
    log_status: str | None = Query(default=None, alias="status"),
    candidate_id: str | None = Query(default=None, alias="candidateId"),
):
    q = select(DocumensoSyncLog).order_by(DocumensoSyncLog.created_at.desc())
    if log_type:
        q = q.where(DocumensoSyncLog.log_type == log_type)
    if log_status:
        q = q.where(DocumensoSyncLog.status == log_status)
    if candidate_id:
        q = q.where(DocumensoSyncLog.candidate_id == candidate_id)

    from sqlalchemy import func

    total_q = select(func.count()).select_from(q.subquery())
    total = db.scalar(total_q) or 0

    rows = list(db.scalars(q.offset((page - 1) * limit).limit(limit)))
    return PaginatedResponse(
        data=[SyncLogRead.model_validate(r, from_attributes=True) for r in rows],
        total=total,
        page=page,
        limit=limit,
        total_pages=max(1, -(-total // limit)),
    )


@router.get("/documenso/signed-profiles", response_model=SignedProfileListResponse)
def list_signed_profiles(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, le=200),
    q: str | None = Query(default=None),
    template_id: int | None = Query(default=None, alias="templateId"),
    # "contracts" hides statutory Form 11/2/F docs (they belong to the compliance view);
    # "compliance" returns only those forms.
    doc_class: str = Query(default="contracts", alias="docClass", pattern="^(contracts|compliance|all)$"),
):
    rows, total = profiles_svc.search_profiles(
        db, q=q, template_id=template_id, page=page, limit=limit, doc_class=doc_class
    )
    return SignedProfileListResponse(
        data=[SignedProfileRead.model_validate(r, from_attributes=True) for r in rows],
        total=total,
        page=page,
        limit=limit,
        total_pages=max(1, -(-total // limit)),
    )


@router.get(
    "/documenso/signed-profiles/{profile_id}/open-url",
    response_model=SignedProfileOpenUrlRead,
)
def get_signed_profile_open_url(
    profile_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
):
    _require_api_key()

    profile = db.get(DocumensoSignedProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Signed profile not found")

    linked_contract = db.scalar(
        select(Contract).where(Contract.documenso_id == str(profile.documenso_doc_id))
    )

    def _open_url_for_stored_pdf(stored: str) -> str:
        # Locally stored PDFs (/uploads/...) are served through the signed-URL
        # mechanism so the link is openable but time-limited and tamper-evident.
        # Already-absolute (S3 / external) URLs are returned as-is.
        if stored.startswith("/uploads/"):
            try:
                return make_signed_upload_url(stored)
            except Exception:
                logger.exception("Failed to sign stored PDF URL for signed profile %s", profile_id)
        return stored

    # Prefer the stored, completed PDF. For a completed document this is the
    # authoritative artifact and avoids handing out a live recipient
    # signing-token URL (which is a bearer credential for the signing flow).
    stored_pdf = profile.pdf_url or (linked_contract.pdf_url if linked_contract else None)
    if stored_pdf:
        return SignedProfileOpenUrlRead(url=_open_url_for_stored_pdf(stored_pdf))

    # No stored PDF yet — try to fetch/sync it from Documenso so we can serve the
    # completed document rather than a raw signing-token URL.
    try:
        refreshed_profile, full_doc = profiles_svc.sync_profile_document(
            db, profile.documenso_doc_id
        )
        db.commit()
        synced_pdf = (
            (refreshed_profile.pdf_url if refreshed_profile else None)
            or profile.pdf_url
            or (linked_contract.pdf_url if linked_contract else None)
        )
        if synced_pdf:
            return SignedProfileOpenUrlRead(url=_open_url_for_stored_pdf(synced_pdf))
    except Exception:
        logger.exception("Failed to fetch Documenso document for open URL")

    # signed_url is the Documenso signing-flow URL stored at contract creation.
    # For completed documents it renders a "document completed" page with
    # download and works without a Documenso login. Used only when no stored PDF
    # is available.
    if linked_contract and linked_contract.signed_url:
        return SignedProfileOpenUrlRead(url=linked_contract.signed_url)

    # Last resort: the authenticated document viewer (requires a Documenso login).
    # We deliberately do NOT mint a fresh live recipient signing-token URL here.
    return SignedProfileOpenUrlRead(
        url=ds_client.build_document_view_url(profile.documenso_doc_id)
    )


@router.get("/documenso/signed-profiles/export")
def export_signed_profiles_csv(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
    q: str | None = Query(default=None),
    template_id: int | None = Query(default=None, alias="templateId"),
    doc_class: str = Query(default="contracts", alias="docClass", pattern="^(contracts|compliance|all)$"),
):
    from fastapi.responses import StreamingResponse

    csv_data = profiles_svc.export_profiles_csv(db, q=q, template_id=template_id, doc_class=doc_class)
    filename = f"signed_contracts_{datetime.now(UTC).strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([csv_data]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/documenso/signed-profiles/sync-state", response_model=ProfileSyncStateRead)
def get_profile_sync_state(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
):
    from app.db.models import DocumensoSyncState

    state = db.get(DocumensoSyncState, "profiles")
    if state is None:
        from datetime import UTC, datetime

        state = DocumensoSyncState(
            id="profiles",
            sync_status="idle",
            documents_processed=0,
            updated_at=datetime.now(UTC),
        )
        db.add(state)
        db.commit()
    return ProfileSyncStateRead.model_validate(state, from_attributes=True)


@router.post("/documenso/signed-profiles/sync", response_model=MessageResponse)
def trigger_profile_sync(
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    _require_api_key()

    if _documenso_run_inline():
        background_tasks.add_task(_run_signed_profiles_sync_background, "manual")
        return MessageResponse(message="Profile sync started — processing in background")

    from app.tasks.documenso import sync_signed_profiles

    sync_signed_profiles.delay(trigger="manual")
    return MessageResponse(message="Profile sync queued — processing 500 docs per run")


@router.post("/documenso/signed-profiles/sync/all", response_model=MessageResponse)
def sync_all_signed_profiles(
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    _require_api_key()
    from app.db.models import DocumensoSyncState

    state = db.get(DocumensoSyncState, "profiles")
    if state is None:
        state = DocumensoSyncState(
            id="profiles",
            sync_status="idle",
            documents_processed=0,
        )
        db.add(state)
    else:
        state.last_document_id = None
        state.sync_status = "idle"
        state.documents_processed = 0
        db.add(state)
    db.commit()

    # Always offload to a background task — the sync can take minutes due to
    # Documenso API rate limiting (300 ms/request × hundreds of documents).
    # Running it inline in the request handler causes the Next.js proxy to
    # ECONNRESET before the response ever arrives.
    if _documenso_run_inline():
        background_tasks.add_task(_run_signed_profiles_sync_background, "manual")
        return MessageResponse(message="Full sync started in background — check sync logs for progress")

    from app.tasks.documenso import sync_signed_profiles

    sync_signed_profiles.delay(trigger="manual")
    return MessageResponse(message="Full sync queued — will process all documents automatically")


@router.get("/documenso/signed-profiles/job-runs", response_model=list[SyncJobRunRead])
def list_profile_job_runs(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_contract_staff)],
    limit: int = Query(default=50, le=200),
):
    runs = sync_svc.list_sync_job_runs(db, job_name="signed_profiles_sync", limit=limit)
    return [SyncJobRunRead.model_validate(r, from_attributes=True) for r in runs]


@router.post("/documenso/signed-profiles/enrich-fields", response_model=MessageResponse)
def trigger_field_enrichment(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    _require_api_key()

    if _documenso_run_inline():
        result = profiles_svc.enrich_profile_fields(db, limit=200)
        db.commit()
        return MessageResponse(
            message=f"Enriched {result['enriched']} profiles. {result.get('remaining', 0)} still pending."
        )

    from app.tasks.documenso import enrich_profile_fields

    enrich_profile_fields.delay()
    return MessageResponse(message="Field enrichment queued — fetches individual document fields in background")


@router.post("/documenso/signed-profiles/sync/reset", response_model=MessageResponse)
def reset_profile_sync(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.CONTRACTS_WRITE))],
):
    from app.db.models import DocumensoSyncState

    state = db.get(DocumensoSyncState, "profiles")
    if state:
        state.last_document_id = None
        state.sync_status = "idle"
        state.documents_processed = 0
        state.last_synced_at = None
        db.add(state)
        db.commit()
    return MessageResponse(message="Profile sync reset — next run starts from page 1")
