from __future__ import annotations

import logging

from app.core.celery_app import celery_app
from app.core.database import SessionLocal

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.tasks.documenso.poll_pending_contract_statuses",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def poll_pending_contract_statuses(self: object) -> dict:
    from app.services import documenso_sync as sync_svc

    with SessionLocal() as db:
        try:
            result = sync_svc.poll_pending_contract_statuses(db)
            db.commit()
            return result
        except Exception as exc:
            db.rollback()
            logger.exception("poll_pending_contract_statuses failed")
            raise self.retry(exc=exc)  # noqa: B904


@celery_app.task(
    name="app.tasks.documenso.refresh_template_cache",
    bind=True,
    max_retries=3,
    default_retry_delay=120,
)
def refresh_template_cache(self: object) -> dict:
    from app.services import documenso_sync as sync_svc

    with SessionLocal() as db:
        try:
            count = sync_svc.refresh_template_cache(db)
            db.commit()
            return {"status": "ok", "synced": count}
        except Exception as exc:
            db.rollback()
            logger.exception("refresh_template_cache failed")
            raise self.retry(exc=exc)  # noqa: B904


@celery_app.task(
    name="app.tasks.documenso.run_incremental_sync",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def run_incremental_sync(self: object, trigger: str = "cron") -> dict:
    from app.services import documenso_sync as sync_svc

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
            return result
        except Exception as exc:
            db.rollback()
            logger.exception("run_incremental_sync failed")
            try:
                sync_svc.finish_sync_job_run(db, run, status="failed", message=str(exc))
                db.commit()
            except Exception:
                pass
            raise self.retry(exc=exc)  # noqa: B904


@celery_app.task(
    name="app.tasks.documenso.process_webhook_event",
    bind=True,
    max_retries=5,
    default_retry_delay=60,
)
def process_webhook_event(self: object, event: str, doc_data: dict) -> dict:
    from app.services import documenso_sync as sync_svc

    with SessionLocal() as db:
        try:
            sync_svc.process_webhook_event(db, event=event, doc_data=doc_data)
            db.commit()
            return {"status": "ok", "event": event}
        except Exception as exc:
            db.rollback()
            logger.exception("process_webhook_event failed for event=%s", event)
            raise self.retry(exc=exc)  # noqa: B904


@celery_app.task(
    name="app.tasks.documenso.retry_failed_pdf_downloads",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def retry_failed_pdf_downloads(self: object) -> dict:
    from app.services import documenso_sync as sync_svc

    with SessionLocal() as db:
        try:
            result = sync_svc.retry_failed_pdf_downloads(db)
            db.commit()
            return result
        except Exception as exc:
            db.rollback()
            logger.exception("retry_failed_pdf_downloads failed")
            raise self.retry(exc=exc)  # noqa: B904


@celery_app.task(
    name="app.tasks.documenso.sync_signed_profiles",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=1800,
    time_limit=2100,
)
def sync_signed_profiles(self: object, trigger: str = "cron") -> dict:
    from app.services import documenso_profiles as profiles_svc

    with SessionLocal() as db:
        run = profiles_svc.start_profile_sync_job(db, trigger=trigger)
        db.commit()
        try:
            result = profiles_svc.sync_signed_profiles(db)
            old_contract_result = profiles_svc.sync_old_employee_contract_documents(db)
            db.commit()
            profiles_svc.finish_profile_sync_job(
                db, run,
                status="completed",
                documents_processed=result.get("synced", 0),
                errors=result.get("errors", 0),
                message=(
                    f"pages {result.get('pages_done', 0)}/{result.get('total_pages', '?')} "
                    f"synced={result.get('synced', 0)} errors={result.get('errors', 0)}"
                    f" old_contracts={old_contract_result.get('updated', 0)}"
                    + (" ✓ done" if result.get("done") else "")
                ),
            )
            db.commit()
            if not result.get("done") and not result.get("skipped"):
                sync_signed_profiles.apply_async(countdown=5)
            return result
        except Exception as exc:
            db.rollback()
            logger.exception("sync_signed_profiles failed")
            try:
                profiles_svc.finish_profile_sync_job(db, run, status="failed", message=str(exc))
                db.commit()
            except Exception:
                pass
            raise self.retry(exc=exc)  # noqa: B904


@celery_app.task(
    name="app.tasks.documenso.enrich_profile_fields",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=1800,
    time_limit=2100,
)
def enrich_profile_fields(self: object) -> dict:
    from app.services import documenso_profiles as profiles_svc

    with SessionLocal() as db:
        try:
            result = profiles_svc.enrich_profile_fields(db, limit=200)
            db.commit()
            if result.get("remaining", 0) > 0:
                enrich_profile_fields.apply_async(countdown=10)
            return result
        except Exception as exc:
            db.rollback()
            logger.exception("enrich_profile_fields failed")
            raise self.retry(exc=exc)  # noqa: B904


@celery_app.task(
    name="app.tasks.documenso.run_historical_sync",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=1800,
    time_limit=2100,
)
def run_historical_sync(self: object) -> dict:
    from app.services import documenso_sync as sync_svc

    with SessionLocal() as db:
        try:
            result = sync_svc.run_historical_sync(db)
            db.commit()
            if not result.get("done") and not result.get("skipped"):
                run_historical_sync.apply_async(countdown=5)
            return result
        except Exception as exc:
            db.rollback()
            logger.exception("run_historical_sync failed")
            raise self.retry(exc=exc)  # noqa: B904
