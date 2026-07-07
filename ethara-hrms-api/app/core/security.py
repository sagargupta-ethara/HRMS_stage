import hmac
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any

import bcrypt
import jwt
from fastapi import HTTPException, status

from app.core.config import get_settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def hash_token(token: str) -> str:
    return sha256(token.encode()).hexdigest()


def verify_token_hash(token: str, stored_hash: str) -> bool:
    return secrets.compare_digest(sha256(token.encode()).hexdigest(), stored_hash)


def fingerprint_identifier(value: str) -> str:
    settings = get_settings()
    pepper = settings.aadhaar_pepper or settings.jwt_secret
    normalized = "".join(ch for ch in value if ch.isalnum()).lower()
    return hmac.new(pepper.encode(), normalized.encode(), sha256).hexdigest()


def create_token(
    *,
    subject: str,
    secret: str,
    expires_delta: timedelta,
    token_type: str,
    extra: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
        "type": token_type,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token: str, *, secret: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


# NOTE: email/role are intentionally NOT embedded in the token. Authorization
# always resolves the live role from the database (see app/api/deps.py), so a
# role claim here would be stale the moment a user is reassigned or switches
# role. The parameters are kept for call-site compatibility.
#
# tv = the user's current token_version. deps.get_current_user rejects an access
# token whose "tv" no longer matches the live user.token_version, which lets us
# revoke outstanding access tokens (logout, password change/reset).
def create_access_token(subject: str, *, email: str, role: str, tv: int = 0) -> str:
    settings = get_settings()
    return create_token(
        subject=subject,
        secret=settings.jwt_secret,
        expires_delta=timedelta(minutes=settings.jwt_expires_in_minutes),
        token_type="access",
        extra={"tv": tv},
    )


def create_refresh_token(subject: str, *, email: str, role: str) -> str:
    settings = get_settings()
    return create_token(
        subject=subject,
        secret=settings.jwt_refresh_secret,
        expires_delta=timedelta(days=settings.jwt_refresh_expires_in_days),
        token_type="refresh",
    )
