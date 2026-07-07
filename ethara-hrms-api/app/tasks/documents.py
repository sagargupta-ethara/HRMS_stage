from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.db.models import SelectionForm, User
from app.services import workflows


@celery_app.task(name="app.tasks.documents.process_document_ocr")
def process_document_ocr(document_id: str) -> dict:
    with SessionLocal() as db:
        document = workflows.run_document_ocr(db, document_id=document_id)
        db.commit()
        return {
            "documentId": document.id,
            "ocrStatus": document.ocr_status,
            "ocrProvider": document.ocr_provider,
        }


@celery_app.task(name="app.tasks.documents.process_selection_form_verification")
def process_selection_form_verification(selection_form_id: str, actor_id: str) -> dict:
    with SessionLocal() as db:
        record = db.get(SelectionForm, selection_form_id)
        actor = db.get(User, actor_id)
        if record is None:
            return {"selectionFormId": selection_form_id, "status": "not_found"}
        if actor is None:
            workflows.set_selection_form_verification_queue_state(
                record,
                status_value="failed",
                message="Document checks could not start because the submitting user was not found.",
            )
            db.commit()
            return {"selectionFormId": selection_form_id, "status": "failed"}
        if record.validated_at is not None:
            workflows.set_selection_form_verification_queue_state(
                record,
                status_value="validated",
                message="Document checks are complete and the form is validated.",
            )
            db.commit()
            return {"selectionFormId": selection_form_id, "status": "validated"}

        workflows.set_selection_form_verification_queue_state(
            record,
            status_value="processing",
            message="Document checks are running. Please wait while we verify the uploaded files.",
        )
        db.commit()
        db.refresh(record)

        try:
            result = workflows.process_selection_form_document_verification(
                db,
                selection_form=record,
                actor=actor,
            )
            db.commit()
            return {"selectionFormId": selection_form_id, **result}
        except Exception:
            db.rollback()
            record = db.get(SelectionForm, selection_form_id)
            if record is not None:
                workflows.set_selection_form_verification_queue_state(
                    record,
                    status_value="failed",
                    message="Document checks failed unexpectedly. HR will review the form.",
                )
                db.commit()
            raise
