from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import get_settings


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in {429, 500, 502, 503, 504}
    return isinstance(exc, (httpx.TimeoutException, httpx.ConnectError))


def _build_headers() -> dict[str, str]:
    settings = get_settings()
    return {
        "Authorization": settings.documenso_api_key or "",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _rate_limit_sleep() -> None:
    settings = get_settings()
    time.sleep(settings.documenso_rate_limit_delay_ms / 1000.0)


@retry(
    retry=retry_if_exception(_is_retryable),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    settings = get_settings()
    url = f"{settings.documenso_base_url}{path}"
    with httpx.Client(timeout=30) as client:
        resp = client.get(url, headers=_build_headers(), params=params)
        resp.raise_for_status()
    _rate_limit_sleep()
    return resp.json()


@retry(
    retry=retry_if_exception(_is_retryable),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _post(path: str, body: dict[str, Any]) -> Any:
    settings = get_settings()
    url = f"{settings.documenso_base_url}{path}"
    with httpx.Client(timeout=30) as client:
        resp = client.post(url, headers=_build_headers(), json=body)
        resp.raise_for_status()
    _rate_limit_sleep()
    return resp.json()


@retry(
    retry=retry_if_exception(_is_retryable),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _delete(path: str) -> Any:
    settings = get_settings()
    url = f"{settings.documenso_base_url}{path}"
    with httpx.Client(timeout=30) as client:
        resp = client.delete(url, headers=_build_headers())
        resp.raise_for_status()
    _rate_limit_sleep()
    if not resp.content:
        return {"success": True}
    return resp.json()


@retry(
    retry=retry_if_exception(_is_retryable),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _download_bytes(path: str) -> bytes:
    settings = get_settings()
    url = f"{settings.documenso_base_url}{path}"
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        resp = client.get(url, headers=_build_headers())
        resp.raise_for_status()
    _rate_limit_sleep()
    return resp.content


def list_templates(page: int = 1, per_page: int = 100) -> dict[str, Any]:
    return _get("/template", {"page": page, "perPage": per_page})


def get_template(template_id: int) -> dict[str, Any]:
    resp = _get("/template", {"templateId": template_id})
    items: list[dict[str, Any]] = resp.get("data") or []
    if not items:
        raise ValueError(f"Template {template_id} not found")
    return items[0]


def list_documents(
    page: int = 1,
    per_page: int = 50,
    status: str | None = None,
    order_dir: str = "asc",
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "page": page,
        "perPage": per_page,
        "orderByColumn": "createdAt",
        "orderByDirection": order_dir,
    }
    if status:
        params["status"] = status
    return _get("/document", params)


def get_document(document_id: int) -> dict[str, Any]:
    resp = _get("/document", {"documentId": document_id})
    items: list[dict[str, Any]] = resp.get("data") or []
    if not items:
        raise ValueError(f"Document {document_id} not found")
    return items[0]


def get_document_with_fields(document_id: int) -> dict[str, Any]:
    return _get(f"/document/{document_id}")


def create_document_from_template(
    template_id: int,
    title: str,
    recipients: list[dict[str, Any]],
    prefill_fields: list[dict[str, Any]] | None = None,
    distribute: bool = True,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "templateId": template_id,
        "recipients": recipients,
        "distributeDocument": distribute,
    }
    if prefill_fields:
        body["prefillFields"] = prefill_fields
    if title:
        body["override"] = {"title": title}
    return _post("/template/use", body)


def download_document_pdf(document_id: int) -> bytes:
    return _download_bytes(f"/document/{document_id}/download")


def delete_document(document_id_or_envelope_id: int | str) -> dict[str, Any]:
    """Delete/cancel a non-completed Documenso document.

    Current Documenso v2 exposes this as ``POST /envelope/delete`` with an
    ``envelopeId`` body. Older/self-hosted API variants expose document deletion
    as ``DELETE /document/{id}``, so keep that fallback for local deployments.
    """
    raw_id = str(document_id_or_envelope_id)
    try:
        result = _post("/envelope/delete", {"envelopeId": raw_id})
        return result if isinstance(result, dict) else {"success": True}
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code not in {400, 404, 405}:
            raise
    result = _delete(f"/document/{raw_id}")
    return result if isinstance(result, dict) else {"success": True}


def get_envelope(envelope_id: str) -> dict[str, Any]:
    return _get(f"/envelope/{envelope_id}")


def get_envelope_items_for_document(document_id: int) -> tuple[str | None, list[dict[str, Any]]]:
    """Return (envelope_id, items) for a document.

    Documenso v2 bundles several signed PDFs (e.g. Offer Letter, NDA, Employment Agreement)
    as separate *envelope items* under one document/envelope. `/document/{id}/download` only
    returns the envelope's primary item, so to capture every signed document we must list the
    items here and download each one individually via `download_envelope_item_pdf`.
    Each item carries `id`, `title` and `order`. Items are returned sorted by `order`.
    """
    doc = get_document_with_fields(document_id)
    envelope_id = doc.get("envelopeId")
    if not envelope_id:
        return None, []
    envelope = get_envelope(str(envelope_id))
    items = [it for it in (envelope.get("envelopeItems") or []) if it.get("id")]
    items.sort(key=lambda it: it.get("order") or 0)
    return str(envelope_id), items


def download_envelope_item_pdf(envelope_item_id: str) -> bytes:
    return _download_bytes(f"/envelope/item/{envelope_item_id}/download")


def build_signing_url(token: str) -> str:
    settings = get_settings()
    return f"{settings.documenso_signing_base_url}/{token}"


def build_document_view_url(document_id: int) -> str:
    settings = get_settings()
    # signing_base_url is e.g. "https://app.documenso.com/sign"
    # strip the "/sign" suffix to get the app base for the document viewer
    app_base = settings.documenso_signing_base_url.rsplit("/sign", 1)[0].rstrip("/")
    return f"{app_base}/documents/{document_id}"


def extract_signing_token(template_use_response: dict[str, Any]) -> str | None:
    for r in template_use_response.get("recipients") or []:
        token = r.get("token")
        if token:
            return token
    return None


def extract_document_id(template_use_response: dict[str, Any]) -> int | None:
    # Documenso v2 returns "documentId"; older or self-hosted versions may use "id".
    # Some versions wrap the result in a "document" key.
    raw = (
        template_use_response.get("id")
        or template_use_response.get("documentId")
        or (template_use_response.get("document") or {}).get("id")
        or (template_use_response.get("document") or {}).get("documentId")
    )
    return int(raw) if raw is not None else None


_FIELD_TYPE_MAP: dict[str, str] = {
    "TEXT": "text",
    "NUMBER": "number",
    "DATE": "date",
    "CHECKBOX": "checkbox",
    "DROPDOWN": "dropdown",
    "RADIO": "radio",
    "EMAIL": "text",
    "INITIALS": "text",
    "NAME": "text",
    "FREE_SIGNATURE": "text",
}

_PREFILLABLE_TYPES = {"TEXT", "NUMBER", "DATE", "CHECKBOX", "DROPDOWN", "RADIO", "EMAIL", "NAME"}


def map_candidate_fields(
    candidate: Any,
    contract: Any,
    template_fields: list[dict[str, Any]],
    extra_fields: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    position = getattr(candidate, "position", None)
    joining_formatted = (
        contract.joining_date.strftime("%d/%m/%Y") if contract.joining_date else ""
    )
    base_mapping: dict[str, str] = {
        "full name": candidate.full_name,
        "candidate name": candidate.full_name,
        "employee name": candidate.full_name,
        "name": candidate.full_name,
        "email": candidate.personal_email,
        "personal email": candidate.personal_email,
        "phone": candidate.phone or "",
        "mobile": candidate.phone or "",
        "phone number": candidate.phone or "",
        "salary": str(int(contract.ctc)) if contract.ctc else "",
        "ctc": str(int(contract.ctc)) if contract.ctc else "",
        "annual ctc": str(int(contract.ctc)) if contract.ctc else "",
        "cost to company": str(int(contract.ctc)) if contract.ctc else "",
        "joining date": joining_formatted,
        "start date": joining_formatted,
        "start date (dd/mm/yyyy)": joining_formatted,
        "department": position.department if position else "",
        "position": position.title if position else "",
        "job title": position.title if position else "",
        "designation": position.title if position else "",
    }

    # Pull identity / statutory / bank details from the candidate's selection form + Aadhaar OCR
    # so contract fields like Aadhaar / PAN / bank / address auto-fill (no manual entry).
    form_data: dict[str, Any] = {}
    selection_form = getattr(candidate, "selection_form", None)
    if selection_form is not None and getattr(selection_form, "form_data", None):
        form_data = selection_form.form_data or {}
    aadhaar_extracted = getattr(candidate, "aadhaar_extracted", None) or {}

    def _first(*vals: Any) -> str:
        for v in vals:
            if v not in (None, ""):
                return str(v)
        return ""

    aadhaar_number = _first(
        aadhaar_extracted.get("aadhaarNumber"),
        form_data.get("aadhaarNumber"),
        f"XXXX XXXX {candidate.aadhaar_last4}" if getattr(candidate, "aadhaar_last4", None) else "",
    )
    pan_number = _first(form_data.get("panNumber"))
    dob = _first(form_data.get("dateOfBirth"))
    base_mapping.update(
        {
            "aadhaar": aadhaar_number,
            "aadhaar number": aadhaar_number,
            "aadhaar card": aadhaar_number,
            "aadhaar no": aadhaar_number,
            "pan": pan_number,
            "pan number": pan_number,
            "pan card": pan_number,
            "pan no": pan_number,
            "date of birth": dob,
            "dob": dob,
            "uan": _first(form_data.get("uanNumber")),
            "uan number": _first(form_data.get("uanNumber")),
            "bank name": _first(form_data.get("bankName")),
            "bank account": _first(form_data.get("bankAccount")),
            "bank account number": _first(form_data.get("bankAccount")),
            "account number": _first(form_data.get("bankAccount")),
            "ifsc": _first(form_data.get("ifscCode")),
            "ifsc code": _first(form_data.get("ifscCode")),
            "current address": _first(form_data.get("currentAddress")),
            "present address": _first(form_data.get("currentAddress")),
            "permanent address": _first(form_data.get("permanentAddress")),
            "address": _first(form_data.get("currentAddress"), form_data.get("permanentAddress")),
            "father name": _first(form_data.get("fatherName")),
            "father's name": _first(form_data.get("fatherName")),
        }
    )

    if extra_fields:
        for k, v in extra_fields.items():
            base_mapping[k.lower().strip()] = v

    prefill: list[dict[str, Any]] = []
    for field in template_fields:
        fid = field.get("id")
        raw_type = (field.get("type") or "").upper()
        if not fid or raw_type not in _PREFILLABLE_TYPES:
            continue
        field_meta = field.get("fieldMeta") or {}
        label = (field_meta.get("label") or "").lower().strip()
        if not label:
            continue
        value = base_mapping.get(label, "")
        if not value:
            continue
        api_type = _FIELD_TYPE_MAP.get(raw_type, "text")
        prefill.append({"id": fid, "type": api_type, "value": value})
    return prefill


def extract_fields_from_doc(doc: dict[str, Any]) -> list[dict[str, Any]]:
    results = []
    recipients_by_id: dict[int, str] = {
        r.get("id", 0): r.get("email", "")
        for r in (doc.get("recipients") or [])
    }
    for field in doc.get("fields") or []:
        field_meta = field.get("fieldMeta") or {}
        label = field_meta.get("label") or ""
        ftype = field.get("type", "")
        value = field.get("customText") or field_meta.get("text") or ""
        recipient_email = recipients_by_id.get(field.get("recipientId", 0), "")
        results.append({
            "label": label,
            "type": ftype,
            "value": value,
            "recipientEmail": recipient_email,
        })
    return results


def verify_webhook_signature(body: bytes, signature_header: str, secret: str) -> bool:
    if not signature_header or not secret:
        return False
    mac = hmac.new(secret.encode(), body, hashlib.sha256)
    expected = mac.hexdigest()
    parts = {
        kv.split("=")[0]: kv.split("=")[1]
        for kv in signature_header.split(",")
        if "=" in kv
    }
    received = parts.get("v1", signature_header)
    return hmac.compare_digest(expected, received)
