"""Mint Google Meet links via the service account with domain-wide delegation.

Tries the Google Meet REST API (spaces.create) first, then falls back to the
Calendar API (event with conferenceData). Uses the already-installed google-auth
+ requests (no google-api-python-client dependency).

ONE-TIME SETUP (Google Workspace Admin → admin.google.com → Security → Access and
data control → API controls → Domain-wide Delegation → Add new):
  Client ID: the service account's OAuth client_id
  Scopes:    https://www.googleapis.com/auth/meetings.space.created,
             https://www.googleapis.com/auth/calendar.events
Enabling the APIs in the Cloud console is NOT enough — the delegation above is what
authorises the service account to act as a Workspace user. Until it's done, every
call returns None and callers fall back to a manually-pasted link.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.created"
_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
_MEET_SPACES_URL = "https://meet.googleapis.com/v2/spaces"
_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1"


def _delegated_token(info: dict, scope: str, subject: str) -> str | None:
    import google.auth.transport.requests as google_requests
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_info(
        info, scopes=[scope], subject=subject
    )
    creds.refresh(google_requests.Request())
    return creds.token


def _create_via_meet_api(info: dict, subject: str) -> str | None:
    import requests

    token = _delegated_token(info, _MEET_SCOPE, subject)
    if not token:
        return None
    response = requests.post(
        _MEET_SPACES_URL, headers={"Authorization": f"Bearer {token}"}, json={}, timeout=20
    )
    if response.status_code not in (200, 201):
        logger.warning("Meet spaces.create failed (%s): %s", response.status_code, response.text[:300])
        return None
    return response.json().get("meetingUri") or None


def _create_via_calendar_api(
    info: dict, subject: str, title: str, scheduled_at: datetime, duration_minutes: int
) -> str | None:
    import requests

    token = _delegated_token(info, _CALENDAR_SCOPE, subject)
    if not token:
        return None
    end_dt = scheduled_at + timedelta(minutes=duration_minutes or 60)
    event = {
        "summary": title,
        "start": {"dateTime": scheduled_at.isoformat(), "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_dt.isoformat(), "timeZone": "Asia/Kolkata"},
        "conferenceData": {
            "createRequest": {
                "requestId": str(uuid.uuid4()),
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }
    response = requests.post(
        _CALENDAR_EVENTS_URL, headers={"Authorization": f"Bearer {token}"}, json=event, timeout=20
    )
    if response.status_code not in (200, 201):
        logger.warning("Calendar event create failed (%s): %s", response.status_code, response.text[:300])
        return None
    data = response.json()
    link = data.get("hangoutLink")
    if not link and isinstance(data.get("conferenceData"), dict):
        entry_points = data["conferenceData"].get("entryPoints", []) or []
        link = next(
            (ep.get("uri") for ep in entry_points if ep.get("entryPointType") == "video"), None
        ) or (entry_points[0].get("uri") if entry_points else None)
    return link or None


def create_meet_event(
    *,
    organizer_email: str | None,
    title: str,
    scheduled_at: datetime,
    duration_minutes: int,
) -> str | None:
    """Return a Google Meet join URL, or None on any failure (missing service
    account, delegation not authorised, API error) so the caller can fall back to
    a manually-pasted link."""
    from app.core.config import get_settings

    settings = get_settings()
    info = settings.google_service_account_info
    if not info:
        return None
    subject = getattr(settings, "google_calendar_user", None) or organizer_email
    if not subject:
        return None

    try:
        return _create_via_meet_api(info, subject)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Meet API error (subject=%s): %s", subject, exc)
    try:
        return _create_via_calendar_api(info, subject, title, scheduled_at, duration_minutes)
    except Exception as exc:  # noqa: BLE001 — never block scheduling on Meet creation
        logger.warning("Calendar fallback error (subject=%s): %s", subject, exc)
        return None
