from celery import Celery

from app.core.config import get_settings


settings = get_settings()

celery_app = Celery(
    "ethara_hrms",
    broker=settings.redis_url,
    backend=settings.celery_result_backend or settings.redis_url,
    include=[
        "app.tasks.screening",
        "app.tasks.documents",
        "app.tasks.notifications",
        "app.tasks.sla",
        "app.tasks.documenso",
        "app.tasks.attendance",
    ],
)

celery_app.conf.update(
    task_always_eager=settings.celery_task_always_eager,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    # ── Reliability / resource guards ────────────────────────────────────────
    # Hard kill at 10 min, soft (raises SoftTimeLimitExceeded) at 9 min so a
    # hung OCR / Documenso / network call can't pin a worker indefinitely.
    task_time_limit=600,
    task_soft_time_limit=540,
    # Re-deliver a task if the worker crashes mid-execution (at-least-once).
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Don't let one worker hoard the queue — fairer distribution across workers.
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=200,
    # Sensible default retry/backoff for tasks that opt into autoretry.
    task_default_retry_delay=30,
    task_annotations={"*": {"max_retries": 3}},
    broker_connection_retry_on_startup=True,
    result_expires=3600,
    beat_schedule={
        "sla-check-every-30-minutes": {
            "task": "app.tasks.sla.run_sla_checks",
            "schedule": 1800.0,
        },
        "documenso-incremental-sync-every-8-hours": {
            "task": "app.tasks.documenso.run_incremental_sync",
            "schedule": 28800.0,
        },
        "documenso-signed-profiles-sync-every-8-hours": {
            "task": "app.tasks.documenso.sync_signed_profiles",
            "schedule": 28800.0,
        },
        "documenso-template-cache-every-12-hours": {
            "task": "app.tasks.documenso.refresh_template_cache",
            "schedule": 43200.0,
        },
        "documenso-retry-failed-pdfs-every-8-hours": {
            "task": "app.tasks.documenso.retry_failed_pdf_downloads",
            "schedule": 28800.0,
        },
        "documenso-poll-pending-contracts-every-2-hours": {
            "task": "app.tasks.documenso.poll_pending_contract_statuses",
            "schedule": 7200.0,
        },
        "attendance-refresh-every-10-minutes": {
            "task": "app.tasks.attendance.refresh_today_attendance",
            "schedule": 600.0,
        },
    },
)
