#!/usr/bin/env python
"""Periodic Documenso sync — pulls completed/signed documents into the local DB.

WHY THIS EXISTS
---------------
The production deployment does not run a Celery worker or beat scheduler, so the
beat schedule declared in ``app.core.celery_app`` never fires and the webhook/
manual-trigger paths that ``.delay()`` to Celery never execute. Signed documents
therefore never get pulled from Documenso into the local database.

This script runs the *same* sync routines the API uses inline (in development
mode), directly in-process — no Celery, no HTTP, no broker. It is meant to be
invoked by system cron every 8 hours:

    0 */8 * * * cd /home/ec2-user/ethara-job-portal/main-app/ethara-hrms-api && \
        .venv/bin/python -m scripts.documenso_sync_cron >> .deploy-logs/documenso-cron.log 2>&1

It can also be run by hand at any time to force an immediate sync / backfill.

Exit code is 0 on full success, 1 if any stage failed (each stage is isolated so
one failure does not block the others).
"""
from __future__ import annotations

import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [documenso-cron] %(message)s",
)
logger = logging.getLogger("documenso_sync_cron")


def _sync_candidate_compliance_forms() -> dict[str, int]:
    """Refresh candidate statutory Documenso forms that the contract sync does not track."""
    from sqlalchemy import func, or_, select
    from sqlalchemy.orm import selectinload

    from app.core.database import SessionLocal
    from app.db.models import Candidate, CandidateStage, ComplianceForm
    from app.services.compliance_documenso import sync_candidate_compliance

    with SessionLocal() as db:
        candidate_ids = [
            row[0]
            for row in db.execute(
                select(Candidate.id, func.min(Candidate.updated_at).label("first_updated"))
                .join(ComplianceForm, ComplianceForm.candidate_id == Candidate.id)
                .where(ComplianceForm.documenso_id.isnot(None))
                .where(
                    or_(
                        ComplianceForm.status != "signed",
                        ComplianceForm.verified_at.is_(None),
                        Candidate.current_stage != CandidateStage.ONBOARDING_COMPLETED,
                    )
                )
                .group_by(Candidate.id)
                .order_by(func.min(Candidate.updated_at).asc())
            ).all()
        ]

    result = {
        "checked": 0,
        "forms_signed": 0,
        "forms_verified": 0,
        "candidates_completed": 0,
        "errors": 0,
    }
    for candidate_id in candidate_ids:
        try:
            with SessionLocal() as db:
                candidate = db.scalar(
                    select(Candidate)
                    .where(Candidate.id == candidate_id)
                    .options(selectinload(Candidate.compliance_forms))
                )
                if candidate is None:
                    continue

                forms = [form for form in candidate.compliance_forms if form.documenso_id]
                before_status = {form.id: form.status for form in forms}
                before_verified = {form.id: form.verified_at for form in forms}
                before_stage = candidate.current_stage

                sync_candidate_compliance(db, candidate=candidate)
                db.commit()

                refreshed = db.scalar(
                    select(Candidate)
                    .where(Candidate.id == candidate_id)
                    .options(selectinload(Candidate.compliance_forms))
                )
                if refreshed is None:
                    continue
                refreshed_forms = [form for form in refreshed.compliance_forms if form.documenso_id]
                result["checked"] += 1
                result["forms_signed"] += sum(
                    1
                    for form in refreshed_forms
                    if before_status.get(form.id) != "signed" and form.status == "signed"
                )
                result["forms_verified"] += sum(
                    1
                    for form in refreshed_forms
                    if before_verified.get(form.id) is None and form.verified_at is not None
                )
                if (
                    before_stage != CandidateStage.ONBOARDING_COMPLETED
                    and refreshed.current_stage == CandidateStage.ONBOARDING_COMPLETED
                ):
                    result["candidates_completed"] += 1
        except Exception:
            result["errors"] += 1
            logger.exception("candidate compliance sync failed for candidate %s", candidate_id)

    return result


def main() -> int:
    from app.core.config import get_settings
    from app.core.database import SessionLocal
    from app.services.event_log import log_event
    from app.services import documenso_sync as sync_svc

    # The route module owns the proven "run this sync inline with job-run
    # bookkeeping + crash recovery" helpers; reuse them so cron behaviour stays
    # identical to the API's inline path instead of duplicating that logic.
    from app.api.routes import documenso as routes

    settings = get_settings()
    log_event("cron", "documenso_cron_started")
    if not settings.documenso_api_key:
        logger.warning("DOCUMENSO_API_KEY not configured — nothing to sync")
        log_event("cron", "documenso_cron_skipped", reason="DOCUMENSO_API_KEY not configured")
        return 0

    failures = 0

    # 1) Completed contracts -> contracts table (+ download signed PDFs).
    try:
        routes._run_incremental_sync_background("cron")
        logger.info("incremental contract sync done")
        log_event("cron", "documenso_cron_stage_success", stage="incremental_contract_sync")
    except Exception:
        failures += 1
        logger.exception("incremental contract sync failed")
        log_event("cron", "documenso_cron_stage_failed", stage="incremental_contract_sync")

    # 2) Signed-profile repository (paginates internally until done).
    try:
        routes._run_signed_profiles_sync_background("cron")
        logger.info("signed-profiles sync done")
        log_event("cron", "documenso_cron_stage_success", stage="signed_profiles_sync")
    except Exception:
        failures += 1
        logger.exception("signed-profiles sync failed")
        log_event("cron", "documenso_cron_stage_failed", stage="signed_profiles_sync")

    # 3) Re-download any signed contracts whose PDF fetch failed earlier.
    try:
        with SessionLocal() as db:
            result = sync_svc.retry_failed_pdf_downloads(db)
            db.commit()
            logger.info("retry_failed_pdf_downloads: %s", result)
            log_event("cron", "documenso_cron_stage_success", stage="retry_failed_pdf_downloads", result=result)
    except Exception:
        failures += 1
        logger.exception("retry_failed_pdf_downloads failed")
        log_event("cron", "documenso_cron_stage_failed", stage="retry_failed_pdf_downloads")

    # 4) Poll contracts still marked pending (catches docs completed without a
    #    webhook ever reaching us).
    try:
        with SessionLocal() as db:
            result = sync_svc.poll_pending_contract_statuses(db)
            db.commit()
            logger.info("poll_pending_contract_statuses: %s", result)
            log_event("cron", "documenso_cron_stage_success", stage="poll_pending_contract_statuses", result=result)
    except Exception:
        failures += 1
        logger.exception("poll_pending_contract_statuses failed")
        log_event("cron", "documenso_cron_stage_failed", stage="poll_pending_contract_statuses")

    # 5) Candidate statutory forms (Form 11 / Form 2 / Form F). These are stored
    #    on compliance_forms, not contracts, so the contract sync above cannot
    #    advance candidates who sign from the onboarding portal.
    try:
        result = _sync_candidate_compliance_forms()
        logger.info("candidate_compliance_forms_sync: %s", result)
        log_event("cron", "documenso_cron_stage_success", stage="candidate_compliance_forms_sync", result=result)
        if result.get("errors"):
            failures += 1
    except Exception:
        failures += 1
        logger.exception("candidate_compliance_forms_sync failed")
        log_event("cron", "documenso_cron_stage_failed", stage="candidate_compliance_forms_sync")

    logger.info("documenso cron finished (failures=%s)", failures)
    log_event("cron", "documenso_cron_finished", failures=failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
