from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import get_settings

_settings = get_settings()


def _client_ip(request: Request) -> str:
    """Derive the real client IP for rate-limiting.

    The backend binds 127.0.0.1 and is reachable ONLY through the Next.js `/api`
    proxy on the same host, so `request.client.host` is always 127.0.0.1 and
    every caller would otherwise share one rate-limit bucket (a single attacker
    could lock everyone out, and per-IP brute-force limits on login/OTP/OCR would
    not actually apply).

    nginx sets `X-Real-IP` to the real client socket address and OVERWRITES any
    client-supplied value, so it is the single most trustworthy source — prefer
    it. Fall back to the LAST `X-Forwarded-For` entry (the value the trusted proxy
    appends, which a client cannot control), then the socket peer.
    """
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        parts = [part.strip() for part in forwarded.split(",") if part.strip()]
        if parts:
            return parts[-1]
    return get_remote_address(request)


limiter = Limiter(
    key_func=_client_ip,
    storage_uri=_settings.redis_url,
)
