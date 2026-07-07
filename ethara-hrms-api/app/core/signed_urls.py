"""Signed, time-limited URLs for uploaded files.

`/uploads/*` is normally Bearer-auth + per-user object-level access. That is
correct for in-app viewing, but it means a bare URL pasted into a CSV (or opened
directly in a browser) gets a 401 — it can't carry an Authorization header.

These helpers let a STAFF-gated export embed a short-lived, HMAC-signed link that
`serve_upload` accepts without a Bearer token. The signature is the authorization:
it is generated server-side from a secret derived from the JWT secret, so it
cannot be forged, and it expires. Only staff-gated code generates them.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from app.core.config import get_settings

# Default link lifetime for exported document URLs. Reduced from 7 days to 24h to
# bound exposure of unauthenticated, shareable links to sensitive PII (Aadhaar /
# contracts / resumes). The signature scheme is unchanged, so links already issued
# under the longer TTL keep verifying until their own embedded `exp` lapses — this
# only shortens the lifetime of NEWLY generated links.
DEFAULT_EXPIRY_SECONDS = 24 * 3600

# An even shorter lifetime callers may opt into for one-off, time-sensitive access
# (e.g. a link clicked immediately rather than left sitting in a spreadsheet).
SENSITIVE_EXPIRY_SECONDS = 3600


def _signing_key() -> bytes:
    # Domain-separated from the JWT secret so an upload-URL signature can never be
    # confused with (or used as) a session token.
    return hashlib.sha256(("upload-url-sign:v1:" + get_settings().jwt_secret).encode()).digest()


def _normalize_path(file_url_or_path: str) -> str:
    """Reduce a stored file reference to the path segment under the uploads root.

    Stored values are inconsistent across the codebase — candidate URLs look like
    "/uploads/candidates/..", but some employee paths are stored as
    "uploads/employee_aadhaar/.." (no leading slash). Both must reduce to the
    same segment ("candidates/.." / "employee_aadhaar/..") so the generated URL is
    a single "/uploads/<segment>" and the signature matches what serve_upload
    verifies (serve_upload passes the part already after "/uploads/")."""
    value = file_url_or_path.strip().lstrip("/")
    if value.startswith("uploads/"):
        value = value[len("uploads/"):]
    return value


def _sign(path: str, expires_at: int) -> str:
    msg = f"{path}|{expires_at}".encode()
    return hmac.new(_signing_key(), msg, hashlib.sha256).hexdigest()


def make_signed_upload_url(
    file_url: str,
    *,
    expires_in: int = DEFAULT_EXPIRY_SECONDS,
    absolute: bool = True,
) -> str:
    """Return a signed URL for an uploaded file.

    `file_url` is the stored value (e.g. Candidate.resume_url = "/uploads/...").
    When `absolute`, the URL is prefixed with the public frontend origin so it is
    clickable from a downloaded file; the frontend proxies /uploads to the backend.
    """
    path = _normalize_path(file_url)
    exp = int(time.time()) + max(60, int(expires_in))
    sig = _sign(path, exp)
    relative = f"/uploads/{path}?exp={exp}&sig={sig}"
    if not absolute:
        return relative
    base = get_settings().frontend_url.rstrip("/")
    return f"{base}{relative}"


def verify_signed_upload(file_path: str, exp: str | None, sig: str | None) -> bool:
    """True if (exp, sig) is a valid, unexpired signature for file_path."""
    if not exp or not sig:
        return False
    try:
        expires_at = int(exp)
    except (TypeError, ValueError):
        return False
    if expires_at < int(time.time()):
        return False
    expected = _sign(_normalize_path(file_path), expires_at)
    return hmac.compare_digest(expected, sig)
