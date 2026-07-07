from __future__ import annotations

import logging

from app.core.celery_app import celery_app
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.greythr_leave import sync_all_active

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.greythr_leave.sync_leave_balances")
def sync_leave_balances() -> dict:
    """Daily refresh of every active employee's greytHR leave balance.

    Inert no-op until greytHR credentials are configured, so it is safe to register
    on the beat schedule before the API user is provisioned. Per-employee failures
    are isolated inside ``sync_all_active`` and reported in the returned summary.
    """
    if not get_settings().greythr_configured:
        logger.info("greytHR not configured — skipping leave-balance sync")
        return {"skipped": "not_configured"}

    with SessionLocal() as db:
        return sync_all_active(db)
