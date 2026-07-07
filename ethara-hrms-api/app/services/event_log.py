from __future__ import annotations

import json
import logging
import os
import socket
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import Request

from app.core.config import get_settings
from app.core.timezone import to_app_timezone

logger = logging.getLogger(__name__)


_HOSTNAME = socket.gethostname()


def _json_default(value: object) -> str:
    if isinstance(value, datetime):
        return to_app_timezone(value).isoformat()
    return str(value)


def _log_path(stream: str) -> Path:
    safe_stream = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in stream)
    settings = get_settings()
    log_dir = settings.observability_log_dir
    if not log_dir.is_absolute():
        log_dir = Path.cwd() / log_dir
    return log_dir / f"{safe_stream}.log"


def request_context(request: Request | None) -> dict[str, Any]:
    if request is None:
        return {}
    forwarded_for = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded_for.split(",", maxsplit=1)[0].strip()
    if not client_ip and request.client is not None:
        client_ip = request.client.host
    return {
        "method": request.method,
        "path": request.url.path,
        "clientIp": client_ip or None,
        "userAgent": request.headers.get("user-agent"),
    }


def log_event(stream: str, event: str, **fields: Any) -> None:
    payload: dict[str, Any] = {
        "timestamp": to_app_timezone(datetime.now(UTC)).isoformat(),
        "stream": stream,
        "event": event,
        "hostname": _HOSTNAME,
        "pid": os.getpid(),
    }
    payload.update({key: value for key, value in fields.items() if value is not None})

    try:
        path = _log_path(stream)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, default=_json_default, ensure_ascii=False) + "\n")
    except Exception:
        logger.warning("Failed to write observability event stream=%s event=%s", stream, event, exc_info=True)
