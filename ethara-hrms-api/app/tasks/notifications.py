from app.core.celery_app import celery_app
from app.services.integrations import EmailService


@celery_app.task(name="app.tasks.notifications.send_email_notification")
def send_email_notification(
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    cc_emails: list[str] | None = None,
) -> dict:
    # _allow_async=False so the worker actually delivers inline here instead of
    # re-enqueueing (which would recurse). cc_emails is carried through so the
    # offloaded path matches the inline path exactly.
    EmailService().send_email(
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        cc_emails=cc_emails,
        _allow_async=False,
    )
    return {"sent": True, "to": to_email, "subject": subject}
