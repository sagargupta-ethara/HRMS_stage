from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.timezone import format_app_datetime

logger = logging.getLogger(__name__)

_SPREADSHEET_ID = "1x0HZjOTK-21QNGhoc7SLyCbLjxmNAVAnm93VDKGGngc"
_SHEET_NAME = "HRMS Input"
_SERVICE_ACCOUNT_PATH = Path(__file__).parent / "service_account.json"

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

_HEADERS = [
    "Timestamp",
    "Assessment",
    "Candidate Name",
    "Email",
    "Phone",
    "Position",
    "Department",
    "Candidate Code",
    "Current Stage",
    "Deployed URL",
    "Repo / Git URL",
    "README Uploaded",
    "Explanation Video Uploaded",
    "Communication Video Uploaded",
    "Prompt Response",
    "Submitted At",
    "Sheet Link",
]


def _get_client():
    import gspread

    settings = get_settings()
    service_account_info = settings.google_service_account_info
    if service_account_info:
        return gspread.service_account_from_dict(service_account_info, scopes=_SCOPES)

    return gspread.service_account(filename=str(_SERVICE_ACCOUNT_PATH), scopes=_SCOPES)


def read_sheet_records(spreadsheet_id: str, tab_name: str | None = None) -> list[dict[str, Any]]:
    """Return every data row of a worksheet as a list of dicts keyed by the header row.

    Uses the same Drive+Sheets-scoped service account as the rest of this module, so the
    target spreadsheet must be shared (Viewer is enough) with the service-account email.
    """
    gc = _get_client()
    sheet = gc.open_by_key(spreadsheet_id)
    ws = sheet.worksheet(tab_name) if tab_name else sheet.sheet1
    # get_all_records() uses the first row as headers and skips blank trailing rows.
    return ws.get_all_records()


_DRIVE_ID_PATTERNS = [
    re.compile(r"/file/d/([a-zA-Z0-9_-]+)"),
    re.compile(r"[?&]id=([a-zA-Z0-9_-]+)"),
    re.compile(r"/d/([a-zA-Z0-9_-]+)"),
]


def extract_drive_file_id(link: str) -> str | None:
    """Pull the Drive file id out of a share link (…/file/d/<ID>/view, …?id=<ID>, …)."""
    value = (link or "").strip()
    if not value:
        return None
    for pattern in _DRIVE_ID_PATTERNS:
        match = pattern.search(value)
        if match:
            return match.group(1)
    # Bare id (no URL wrapper)
    if re.fullmatch(r"[a-zA-Z0-9_-]{20,}", value):
        return value
    return None


def download_drive_file(link: str, *, timeout: float = 60.0) -> tuple[bytes, str | None, str | None]:
    """Download a Google Drive file referenced by a share link using the service account.

    Returns (content_bytes, content_type, filename). Raises on any failure (caller decides
    whether to skip). The file (or its parent folder) must be shared with the service-account
    email; otherwise Drive returns 403/404.
    """
    import httpx

    file_id = extract_drive_file_id(link)
    if not file_id:
        raise ValueError(f"Could not parse a Drive file id from: {link!r}")

    gc = _get_client()
    # gspread authorizes a google.auth credentials object; reuse its bearer token for Drive.
    # gspread 6.x exposes it at gc.http_client.auth; older versions used gc.auth / gc.credentials.
    creds = (
        getattr(getattr(gc, "http_client", None), "auth", None)
        or getattr(gc, "auth", None)
        or getattr(gc, "credentials", None)
    )
    if creds is None:
        raise RuntimeError("Could not obtain service-account credentials from gspread client")

    from google.auth.transport.requests import Request as GoogleAuthRequest

    if not getattr(creds, "valid", False):
        creds.refresh(GoogleAuthRequest())
    token = creds.token

    # First fetch metadata (name + mimeType), then the media bytes.
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        meta_resp = client.get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            params={"fields": "name,mimeType", "supportsAllDrives": "true"},
            headers=headers,
        )
        meta_resp.raise_for_status()
        meta = meta_resp.json()
        filename = meta.get("name")
        mime_type = meta.get("mimeType")

        media_resp = client.get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            params={"alt": "media", "supportsAllDrives": "true"},
            headers=headers,
        )
        media_resp.raise_for_status()
        return media_resp.content, mime_type, filename


def _google_error_detail(exc: BaseException) -> str:
    """Return the useful Google API message even when gspread wraps it blankly."""
    messages: list[str] = []
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        text = str(current).strip()
        if text and text not in messages:
            messages.append(text)

        response = getattr(current, "response", None)
        if response is not None:
            try:
                body = response.json()
            except Exception:
                body = getattr(response, "text", "")
            if isinstance(body, dict):
                error = body.get("error")
                if isinstance(error, dict):
                    detail = error.get("message") or error.get("status")
                    if detail and str(detail) not in messages:
                        messages.append(str(detail))
            elif body:
                body_text = str(body).strip()
                if body_text and body_text not in messages:
                    messages.append(body_text)

        current = current.__cause__ or current.__context__
    return " | ".join(messages) or exc.__class__.__name__


def _get_or_create_worksheet(gc):
    try:
        sheet = gc.open_by_key(_SPREADSHEET_ID)
    except Exception as exc:
        logger.error(
            "Could not open spreadsheet %s: %s",
            _SPREADSHEET_ID,
            _google_error_detail(exc),
        )
        raise

    try:
        ws = sheet.worksheet(_SHEET_NAME)
    except Exception:
        ws = sheet.add_worksheet(title=_SHEET_NAME, rows=1000, cols=20)

    existing = ws.get_all_values()
    if not existing or existing[0] != _HEADERS:
        ws.update("A1", [_HEADERS])
        ws.format("A1:Q1", {"textFormat": {"bold": True}})

    return ws, sheet.url


def append_assessment_row(
    *,
    level: int,
    candidate_name: str,
    email: str,
    phone: str | None,
    position: str | None,
    department: str | None,
    candidate_code: str | None,
    current_stage: str | None,
    deployed_url: str | None,
    repo_url: str | None,
    readme_path: str | None,
    explanation_video_path: str | None,
    communication_video_path: str | None,
    prompt_response: str | None,
    submitted_at: datetime | None,
) -> str | None:
    try:
        gc = _get_client()
        ws, sheet_url = _get_or_create_worksheet(gc)

        row: list[Any] = [
            format_app_datetime(datetime.now(UTC)),
            f"Level {level}",
            candidate_name,
            email,
            phone or "",
            position or "",
            department or "",
            candidate_code or "",
            (current_stage or "").replace("_", " ").title(),
            deployed_url or "",
            repo_url or "",
            "Yes" if readme_path else "No",
            "Yes" if explanation_video_path else "No",
            "Yes" if communication_video_path else "No",
            prompt_response or "",
            format_app_datetime(submitted_at, "%Y-%m-%d %H:%M") if submitted_at else "",
            sheet_url,
        ]
        # RAW (not USER_ENTERED) so Google Sheets stores candidate-supplied strings
        # verbatim and never interprets a leading "=", "+", "-" or "@" as a formula.
        # This blocks spreadsheet/CSV formula-injection via fields like name, prompt
        # response, deployed/repo URL, etc. Dates/numbers we write are already
        # pre-formatted strings, so RAW does not change their displayed value.
        ws.append_row(row, value_input_option="RAW")
        logger.info("Appended Level %d assessment for %s to Google Sheets", level, email)
        return sheet_url
    except Exception as exc:
        logger.error("Google Sheets append failed: %s", _google_error_detail(exc))
        return None


def _col_letter(n: int) -> str:
    """1 -> A, 26 -> Z, 27 -> AA (for the header formatting range)."""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _is_blank_sheet(values: list[list[Any]]) -> bool:
    return not values or all(not any(str(cell).strip() for cell in row) for row in values)


def _same_submission(left: list[Any], right: list[Any]) -> bool:
    if len(left) < 2 or len(right) < 2:
        return False
    return [str(v).strip() for v in left[:2]] == [str(v).strip() for v in right[:2]]


def append_dynamic_row(
    *, spreadsheet_id: str, tab_name: str, headers: list[str], row: list[Any],
    raise_on_error: bool = False,
) -> str | None:
    """Append one row to an arbitrary spreadsheet + tab (per-assessment sheet sync).

    Writes the header row only when the tab is empty (so an existing form-linked tab
    is never clobbered). Best-effort by default: returns the sheet URL on success, None
    on any failure (logged), so a sheet problem never blocks a candidate's submission.
    Pass raise_on_error=True (manual backfill) to surface the real error to the caller.
    """
    try:
        gc = _get_client()
        sheet = gc.open_by_key(spreadsheet_id)
        try:
            ws = sheet.worksheet(tab_name)
        except Exception:
            ws = sheet.add_worksheet(
                title=tab_name or "Responses",
                rows=1000,
                cols=max(26, len(headers) + 2),
            )
        existing = ws.get_all_values()
        if _is_blank_sheet(existing):
            ws.update("A1", [headers])
            ws.format(f"A1:{_col_letter(len(headers))}1", {"textFormat": {"bold": True}})
            existing = [headers]
        elif existing[0] == headers:
            for row_number, existing_row in enumerate(existing[1:], start=2):
                if _same_submission(existing_row, row):
                    ws.update(f"A{row_number}", [row], value_input_option="RAW")
                    return sheet.url
        # RAW so candidate-supplied text is stored verbatim (blocks formula injection).
        ws.append_row(row, value_input_option="RAW")
        return sheet.url
    except Exception as exc:
        detail = _google_error_detail(exc)
        logger.error(
            "Google Sheets dynamic append failed (%s / %s): %s",
            spreadsheet_id,
            tab_name,
            detail,
        )
        if raise_on_error:
            raise RuntimeError(detail) from exc
        return None
