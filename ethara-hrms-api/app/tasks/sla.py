from datetime import UTC, datetime

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.db.models import User
from app.services.integrations import EmailService
from app.services import workflows


@celery_app.task(name="app.tasks.sla.run_sla_checks")
def run_sla_checks() -> dict:
    sent_emails = 0
    with SessionLocal() as db:
        escalations = workflows.run_sla_checks(db)
        email_service = EmailService()
        for escalation in escalations:
            responsible = db.get(User, escalation.responsible_user_id)
            if responsible:
                email_service.send_email(
                    to_email=responsible.email,
                    subject=f"Ethara HRMS SLA alert: {escalation.stage}",
                    body_text=(
                        f"Candidate {escalation.candidate_id} is delayed in {escalation.stage} "
                        f"by {escalation.delayed_by}."
                    ),
                )
                escalation.email_sent_at = datetime.now(UTC)
                db.add(escalation)
                sent_emails += 1
        db.commit()
        return {"createdEscalations": len(escalations), "emailNotifications": sent_emails}
