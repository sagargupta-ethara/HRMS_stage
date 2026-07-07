from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.services import workflows


@celery_app.task(name="app.tasks.screening.process_resume_screening")
def process_resume_screening(candidate_id: str, job_description: str | None = None) -> dict:
    with SessionLocal() as db:
        candidate = workflows.run_resume_screening(db, candidate_id=candidate_id, job_description=job_description)
        db.commit()
        return {
            "candidateId": candidate.id,
            "resumeScore": candidate.resume_score,
            "currentStage": candidate.current_stage.value,
        }

