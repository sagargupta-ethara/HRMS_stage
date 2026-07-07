#!/usr/bin/env python
"""Batch Aadhaar OCR for pre-loaded (imported) employees.

Runs the SAME Aadhaar OCR + identity validation the employee registration form runs
(extract_aadhaar_fields + validate_aadhaar_identity), against each imported employee's
already-downloaded Aadhaar document, and writes the result back onto the staging row so
the HR/Admin detail page shows OCR status / match (instead of "Not Submitted") and the
data is intact when the employee later registers.

Deliberately run SEPARATELY from the import and in small batches with a pause between
batches, so OCR (CPU-heavy, local RapidOCR) doesn't spike load on the host.

USAGE:
    .venv/bin/python -m scripts.ocr_imported_employees --dry-run
    .venv/bin/python -m scripts.ocr_imported_employees --batch-size 25 --sleep 3
    .venv/bin/python -m scripts.ocr_imported_employees --reprocess        # redo all, even done ones
"""
from __future__ import annotations

import argparse
import io
import logging
import re
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [employee-ocr] %(message)s",
)
logger = logging.getLogger("ocr_imported_employees")


class _BytesUpload:
    """Minimal UploadFile stand-in: extract_aadhaar_fields only touches .file/.filename/.content_type."""

    def __init__(self, data: bytes, filename: str | None, content_type: str | None) -> None:
        self.file = io.BytesIO(data)
        self.filename = filename or "aadhaar"
        self.content_type = content_type or "application/octet-stream"


def _doc_of_type(documents: list[dict] | None, doc_type: str) -> dict | None:
    for doc in documents or []:
        if (doc.get("type") or "").strip().lower() == doc_type and doc.get("file_url"):
            return doc
    return None


def _aadhaar_doc(documents: list[dict] | None) -> dict | None:
    return _doc_of_type(documents, "aadhaar")


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch Aadhaar OCR for imported employees.")
    parser.add_argument("--batch-size", type=int, default=25, help="Rows per commit batch.")
    parser.add_argument("--sleep", type=float, default=3.0, help="Seconds to pause between batches.")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N rows.")
    parser.add_argument("--reprocess", action="store_true", help="Re-OCR rows already processed.")
    parser.add_argument("--dry-run", action="store_true", help="Report only; no DB writes.")
    args = parser.parse_args()

    from sqlalchemy import select

    from app.api.routes.candidates import (
        extract_aadhaar_fields,
        extract_pan_fields,
        validate_aadhaar_identity,
    )
    from app.core.database import SessionLocal
    from app.db.models import EmployeeImportStaging
    from app.services.employees import _resolve_employee_file_reference

    def _read_doc(doc):
        ref = _resolve_employee_file_reference(doc.get("file_url"))
        if ref is None or isinstance(ref, str):
            raise RuntimeError(f"file not resolvable locally: {doc.get('file_url')}")
        return _BytesUpload(ref.read_bytes(), doc.get("file_name"), doc.get("mime_type"))

    with SessionLocal() as db:
        rows = list(
            db.scalars(
                select(EmployeeImportStaging)
                .where(EmployeeImportStaging.status == "pending")
                .order_by(EmployeeImportStaging.created_at.asc())
            )
        )

    # Rows with an Aadhaar and/or PAN document and (unless --reprocess) not yet OCR'd.
    todo = []
    for row in rows:
        pf = row.profile_fields or {}
        if not args.reprocess and pf.get("ocr_processed"):
            continue
        if _doc_of_type(row.documents, "aadhaar") is None and _doc_of_type(row.documents, "pan") is None:
            continue
        todo.append(row.id)
    if args.limit:
        todo = todo[: args.limit]

    logger.info("Rows needing OCR (Aadhaar/PAN): %d (of %d pending)%s", len(todo), len(rows),
                "  (DRY RUN)" if args.dry_run else "")

    processed = matched = needs_review = errors = 0
    for batch_start in range(0, len(todo), args.batch_size):
        batch_ids = todo[batch_start : batch_start + args.batch_size]
        with SessionLocal() as db:
            for staging_id in batch_ids:
                row = db.get(EmployeeImportStaging, staging_id)
                if row is None:
                    continue
                pf = dict(row.profile_fields or {})
                fd = row.form_data or {}
                name = pf.get("full_name") or ""
                entered_aadhaar = re.sub(r"\D", "", fd.get("aadhaarNumber") or "")
                entered_dob = pf.get("date_of_birth")
                entered_pan = (fd.get("panNumber") or "").upper().strip()
                aadhaar_doc = _doc_of_type(row.documents, "aadhaar")
                pan_doc = _doc_of_type(row.documents, "pan")
                did_any = False
                try:
                    # ── Aadhaar ──────────────────────────────────────────────
                    if aadhaar_doc is not None:
                        ocr_result = extract_aadhaar_fields(_read_doc(aadhaar_doc))
                        validation = validate_aadhaar_identity(
                            entered_name=name,
                            entered_aadhaar=entered_aadhaar,
                            entered_dob=entered_dob,
                            ocr_result=ocr_result,
                        )
                        ocr_digits = re.sub(r"\D", "", ocr_result.get("aadhaarNumber") or "")
                        ocr_match = bool(entered_aadhaar and ocr_digits == entered_aadhaar)
                        if not args.dry_run:
                            pf["aadhaar_ocr_status"] = ocr_result.get("ocrStatus", "needs_review")
                            pf["aadhaar_ocr_match"] = ocr_match
                            pf["aadhaar_ocr_name"] = validation.get("ocrName")
                            pf["aadhaar_validation_status"] = validation.get("validationStatus")
                            pf["aadhaar_mismatch_reason"] = validation.get("mismatchReason")
                            pf["aadhaar_extracted"] = ocr_result
                            if not row.aadhaar_last4 and len(entered_aadhaar) >= 4:
                                row.aadhaar_last4 = entered_aadhaar[-4:]
                        did_any = True
                        if ocr_match:
                            matched += 1
                        if (validation.get("validationStatus") or "") in ("needs_review", "failed", "partial"):
                            needs_review += 1
                        logger.info("  %s (%s) aadhaar: ocr=%s match=%s",
                                    name, row.employee_code, ocr_result.get("ocrStatus"), ocr_match)

                    # ── PAN ──────────────────────────────────────────────────
                    if pan_doc is not None:
                        pan_result = extract_pan_fields(_read_doc(pan_doc))
                        ocr_pan = (pan_result.get("panNumber") or "").upper().strip()
                        pan_match = bool(entered_pan and ocr_pan == entered_pan)
                        if not args.dry_run:
                            pf["pan_ocr_status"] = pan_result.get("ocrStatus", "needs_review")
                            pf["pan_ocr_number"] = ocr_pan or None
                            pf["pan_ocr_match"] = pan_match
                            pf["pan_extracted"] = pan_result
                        did_any = True
                        logger.info("  %s (%s) pan: ocr=%s match=%s",
                                    name, row.employee_code, pan_result.get("ocrStatus"), pan_match)

                    if did_any and not args.dry_run:
                        pf["ocr_processed"] = True
                        row.profile_fields = pf
                        db.add(row)
                    if did_any:
                        processed += 1
                except Exception as exc:  # noqa: BLE001
                    errors += 1
                    logger.warning("  FAILED %s (%s): %s", name, row.employee_code, exc)
            if not args.dry_run:
                db.commit()
        logger.info("  batch done: %d/%d processed (matched=%d, review=%d, errors=%d)",
                    min(batch_start + args.batch_size, len(todo)), len(todo), matched, needs_review, errors)
        if args.sleep and batch_start + args.batch_size < len(todo):
            time.sleep(args.sleep)

    logger.info("Done. processed=%d matched=%d needs_review=%d errors=%d%s",
                processed, matched, needs_review, errors, "  (DRY RUN — no writes)" if args.dry_run else "")
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
