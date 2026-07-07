"""Vertex AI Gemini client (publisher REST endpoint, API-key auth).

This is a thin, dependency-light client around the Vertex AI ``generateContent``
publisher endpoint — the exact call path verified against the production key
(``aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent?key=...``).
It is deliberately separate from the ``google-genai`` SDK path in
``integrations.py`` because the SDK targets the Google AI Studio endpoint, which
uses different keys/models.

When ``VERTEX_AI_ENABLED=true`` and ``VERTEX_AI_API_KEY`` is set, this becomes the
primary backend for every Gemini-family call:

* document OCR + document-type verification (``verify_and_extract``), and
* resume parsing / screening, via ``LLMService`` delegating to ``generate_json`` /
  ``generate_text``.

``generate_*`` raise ``RuntimeError`` on failure so existing callers fall back to
the local OCR / AI-Studio / OpenAI paths. ``verify_and_extract`` never raises — it
returns a verdict dict with ``ok=False`` so document callers can fall back to the
local OCR library.
"""

from __future__ import annotations

import base64
import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.core.config import get_settings
from app.services.event_log import log_event

try:  # certifi gives a reliable CA bundle; fall back to system defaults if absent.
    import certifi

    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except Exception:  # pragma: no cover - environment dependent
    _SSL_CONTEXT = ssl.create_default_context()


_DEFAULT_MAX_OUTPUT_TOKENS = 4096

_EXTRACTION_SYSTEM_PROMPT = (
    "You are a careful document inspection and extraction assistant. "
    "You verify whether an uploaded document matches an expected category and "
    "extract only clearly visible fields. Never invent values. Return valid JSON only."
)
_JSON_SYSTEM_PROMPT = (
    "You are a precise assistant. Follow the user's instructions exactly and "
    "return valid JSON only, with no surrounding prose or code fences."
)
_TEXT_SYSTEM_PROMPT = "You are a careful, concise assistant."

# Human-readable guidance per expected category, injected into the verification
# prompt so the model knows what a valid document of that category looks like.
_CATEGORY_GUIDANCE: dict[str, str] = {
    "aadhaar": "an Indian Aadhaar card (12-digit UIDAI number, often masked as XXXX XXXX 1234).",
    "pan": "an Indian PAN card (10-character alphanumeric PAN, e.g. ABCDE1234F).",
    "bank_proof": (
        "a bank account proof — a cancelled cheque, bank passbook, or bank statement "
        "showing account number, IFSC, account holder name and bank name."
    ),
    "educational": (
        "an educational/qualification document — a marksheet, certificate, or degree "
        "from a school, board, college or university."
    ),
    "address_proof": (
        "an address proof document (e.g. utility bill, Aadhaar, passport, rent "
        "agreement) clearly showing a postal address."
    ),
    "photo": "a passport-size photograph of a person's face.",
    "resume": "a candidate resume / CV.",
}


class VertexAIError(RuntimeError):
    """Raised when a Vertex AI call cannot produce usable text."""


def is_enabled() -> bool:
    settings = get_settings()
    return bool(settings.vertex_ai_enabled and settings.vertex_ai_api_key)


def _build_url(model: str, api_key: str) -> str:
    encoded_key = urllib.parse.quote(api_key, safe="")
    return (
        "https://aiplatform.googleapis.com/v1/publishers/google/models/"
        f"{model}:generateContent?key={encoded_key}"
    )


def _sniff_mime(file_bytes: bytes) -> str | None:
    """Detect the document MIME type from magic bytes — Vertex rejects inline data
    sent as application/octet-stream, and some clients omit the content type."""
    head = file_bytes[:16]
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    return None


def _inline_part(file_bytes: bytes, mime_type: str | None) -> dict[str, Any]:
    resolved = (mime_type or "").strip().lower()
    if not resolved or resolved == "application/octet-stream":
        resolved = _sniff_mime(file_bytes) or resolved or "application/octet-stream"
    return {
        "inlineData": {
            "mimeType": resolved,
            "data": base64.b64encode(file_bytes).decode("ascii"),
        }
    }


def _usage_payload(usage: dict[str, Any] | None) -> dict[str, int | None]:
    usage = usage or {}
    return {
        "promptTokens": usage.get("promptTokenCount"),
        "completionTokens": usage.get("candidatesTokenCount"),
        "totalTokens": usage.get("totalTokenCount"),
        "cachedTokens": usage.get("cachedContentTokenCount"),
        "thoughtsTokens": usage.get("thoughtsTokenCount"),
    }


def _extract_text(response: dict[str, Any]) -> str:
    candidates = response.get("candidates") or []
    if not candidates:
        raise VertexAIError("Vertex AI returned no candidates.")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text_parts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
    if not text_parts:
        finish = candidates[0].get("finishReason", "unknown")
        raise VertexAIError(f"Vertex AI returned no text (finishReason={finish}).")
    return "\n".join(text_parts).strip()


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop the opening ``` (or ```json) line and a trailing ``` if present.
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _post(
    contents: list[dict[str, Any]],
    *,
    system_prompt: str,
    temperature: float,
    operation: str,
    max_output_tokens: int = _DEFAULT_MAX_OUTPUT_TOKENS,
) -> str:
    settings = get_settings()
    api_key = settings.vertex_ai_api_key
    model = settings.vertex_ai_model
    if not api_key:
        raise VertexAIError("Vertex AI is not configured (VERTEX_AI_API_KEY).")

    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
        },
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url=_build_url(model, api_key),
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )

    started = time.perf_counter()
    try:
        with urllib.request.urlopen(
            request, timeout=settings.vertex_ai_timeout_seconds, context=_SSL_CONTEXT
        ) as response:
            data = json.loads(response.read().decode("utf-8"))
        text = _extract_text(data)
        log_event(
            "llm-usage",
            "vertex_call_success",
            provider="vertex",
            operation=operation,
            model=model,
            durationMs=round((time.perf_counter() - started) * 1000),
            **_usage_payload(data.get("usageMetadata")),
        )
        return text
    except Exception as exc:
        detail = exc
        http_status: int | None = None
        if isinstance(exc, urllib.error.HTTPError):
            http_status = exc.code
            try:
                detail = exc.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                detail = f"HTTP {exc.code}"
        detail_text = str(detail)
        log_event(
            "llm-usage",
            "vertex_call_failed",
            provider="vertex",
            operation=operation,
            model=model,
            durationMs=round((time.perf_counter() - started) * 1000),
            error=type(exc).__name__,
            httpStatus=http_status,
            errorDetail=detail_text[:500],
        )
        raise VertexAIError(f"Vertex AI call failed ({operation}): {detail_text}") from exc


# ── Generic generation (used by LLMService delegation) ────────────────────────

def generate_text(prompt: str, *, operation: str = "text") -> str:
    return _post(
        [{"role": "user", "parts": [{"text": prompt}]}],
        system_prompt=_TEXT_SYSTEM_PROMPT,
        temperature=0.2,
        operation=operation,
    )


def generate_json(prompt: str, *, operation: str = "json") -> dict:
    text = _strip_code_fences(
        _post(
            [{"role": "user", "parts": [{"text": prompt}]}],
            system_prompt=_JSON_SYSTEM_PROMPT,
            temperature=0.1,
            operation=operation,
        )
    )
    return json.loads(text)


def generate_vision(
    prompt: str, file_bytes: bytes, mime_type: str | None, *, operation: str = "vision"
) -> str:
    return _post(
        [{"role": "user", "parts": [_inline_part(file_bytes, mime_type), {"text": prompt}]}],
        system_prompt=_EXTRACTION_SYSTEM_PROMPT,
        temperature=0.0,
        operation=operation,
    )


# ── Document verification + extraction ────────────────────────────────────────

def _verification_prompt(expected_category: str) -> str:
    guidance = _CATEGORY_GUIDANCE.get(
        expected_category, f"a document of category '{expected_category}'."
    )
    return f"""
Expected document category: {expected_category}
A valid document of this category is {guidance}

Inspect the uploaded document (image or PDF) carefully and decide:
1. What kind of document it actually is.
2. Whether it matches the expected category above.
3. Any clearly visible identifying fields.

Return valid JSON only with exactly this shape:
{{
  "detected_document_type": "aadhaar | pan | bank_proof | educational | address_proof | photo | resume | other | unknown",
  "matches_expected_category": true,
  "confidence": 0.0,
  "extracted_fields": {{
    "name": null,
    "aadhaar_number": null,
    "pan_number": null,
    "date_of_birth": null,
    "account_number": null,
    "ifsc": null,
    "bank_name": null,
    "account_holder_name": null,
    "address": null,
    "postal_code": null,
    "institution": null,
    "qualification": null,
    "year": null
  }},
  "missing_fields": [],
  "issues": [],
  "validation_notes": "short explanation"
}}

Rules:
- Set matches_expected_category to false if the document is clearly a different type
  than expected, or if the expected category's defining content is absent
  (e.g. a "bank_proof" with no account number/IFSC, or an "educational" doc that is
  not a marksheet/certificate/degree).
- For masked Aadhaar (e.g. XXXX XXXX 1234) extract only the clearly visible digits.
- confidence is your confidence (0.0-1.0) that detected_document_type is correct.
- Use null for any field that is not clearly visible. Never invent or guess values.
- Return ONLY the JSON object, no explanation outside it.
""".strip()


def verify_and_extract(
    file_bytes: bytes, mime_type: str | None, expected_category: str
) -> dict[str, Any]:
    """Verify a document is the expected type and extract visible fields.

    Never raises: on any failure returns a verdict with ``ok=False`` and
    ``detected_document_type="unknown"`` so callers can fall back to local OCR.
    """
    try:
        raw = generate_vision(
            _verification_prompt(expected_category),
            file_bytes,
            mime_type,
            operation=f"doc_verify:{expected_category}",
        )
        result = json.loads(_strip_code_fences(raw))
        if not isinstance(result, dict):
            raise VertexAIError("Verification response was not a JSON object.")
        result.setdefault("detected_document_type", "unknown")
        result.setdefault("matches_expected_category", None)
        result.setdefault("extracted_fields", {})
        result.setdefault("missing_fields", [])
        result.setdefault("issues", [])
        result["expected_category"] = expected_category
        result["ok"] = True
        return result
    except Exception as exc:
        return {
            "ok": False,
            "expected_category": expected_category,
            "detected_document_type": "unknown",
            "matches_expected_category": None,
            "extracted_fields": {},
            "missing_fields": [],
            "issues": [],
            "validation_notes": "",
            "error": str(exc),
        }
