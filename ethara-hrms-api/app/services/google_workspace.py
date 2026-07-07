"""Create @ethara.ai Google Workspace accounts via the Admin SDK Directory API,
using the service account with domain-wide delegation (impersonating a super-admin).

ONE-TIME SETUP:
  1. Cloud Console → enable "Admin SDK API" in project your-gcp-project.
  2. Workspace Admin (admin.google.com) → Domain-wide Delegation → authorise the
     service account client ID for scope
     https://www.googleapis.com/auth/admin.directory.user
  3. Set GOOGLE_ADMIN_USER=<a super-admin @ethara.ai> in the backend .env.

Until that's done, create_workspace_user() returns None (caller handles it).
Creating a user CONSUMES A WORKSPACE LICENSE — call deliberately.
"""

from __future__ import annotations

import logging
import re
import secrets
import string

logger = logging.getLogger(__name__)

_DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user"
_USERS_URL = "https://admin.googleapis.com/admin/directory/v1/users"


def _slug(value: str) -> str:
    """Lowercase alnum-only token for the email local part (e.g. 'Sagar' -> 'sagar')."""
    return re.sub(r"[^a-z0-9]", "", (value or "").strip().lower())


def _generate_temp_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    core = "".join(secrets.choice(alphabet) for _ in range(length - 2))
    # Guarantee at least one digit and one uppercase to satisfy Workspace policy.
    return f"{secrets.choice(string.ascii_uppercase)}{core}{secrets.choice(string.digits)}"


def _user_exists(token: str, email: str) -> bool:
    import requests

    r = requests.get(f"{_USERS_URL}/{email}", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    return r.status_code == 200


def create_workspace_user(
    *,
    first_name: str,
    last_name: str | None = None,
) -> dict | None:
    """Create firstname.lastname@<domain> and return {"email", "tempPassword"}.

    Handles local-part collisions (.1, .2 …). Returns None on any failure (missing
    config, delegation not authorised, API error) so callers can surface a message.
    """
    from app.core.config import get_settings
    from app.services.google_calendar import _delegated_token

    settings = get_settings()
    info = settings.google_service_account_info
    admin_subject = getattr(settings, "google_admin_user", None)
    domain = getattr(settings, "google_workspace_domain", None) or "ethara.ai"
    if not info or not admin_subject:
        return None

    first = _slug(first_name)
    last = _slug(last_name or "")
    if not first:
        return None
    base_local = f"{first}.{last}" if last else first

    try:
        import requests

        token = _delegated_token(info, _DIRECTORY_SCOPE, admin_subject)
        if not token:
            return None

        email = f"{base_local}@{domain}"
        for attempt in range(1, 25):
            if not _user_exists(token, email):
                break
            email = f"{base_local}.{attempt}@{domain}"
        else:
            logger.warning("Could not find a free %s address for %s", domain, base_local)
            return None

        temp_password = _generate_temp_password()
        body = {
            "primaryEmail": email,
            "name": {
                "givenName": first_name.strip() or first,
                "familyName": (last_name or first_name).strip() or first,
            },
            "password": temp_password,
            "changePasswordAtNextLogin": True,
        }
        response = requests.post(
            _USERS_URL, headers={"Authorization": f"Bearer {token}"}, json=body, timeout=20
        )
        if response.status_code not in (200, 201):
            logger.warning("Workspace user create failed (%s): %s", response.status_code, response.text[:300])
            return None
        return {"email": email, "tempPassword": temp_password}
    except Exception as exc:  # noqa: BLE001 — never crash onboarding on provisioning failure
        logger.warning("Workspace user create error: %s", exc)
        return None
