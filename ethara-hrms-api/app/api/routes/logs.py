from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, func, select, text
from sqlalchemy.orm import Session

from app.api.deps import require_permissions, user_has_any_role
from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import Permission
from app.db.models import AuditLog, Role, User


router = APIRouter(prefix="/logs", tags=["logs"])


def _assert_log_admin(user: User) -> None:
    if not user_has_any_role(user, {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users can view system logs.",
        )


def _project_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _observability_dir() -> Path:
    settings = get_settings()
    path = settings.observability_log_dir
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _api_dir() -> Path:
    return _project_root() / "ethara-hrms-api"


def _frontend_dir() -> Path:
    return _project_root() / "ethara-hrms"


LOG_STREAMS: dict[str, dict[str, Any]] = {
    "auth": {"label": "Login/Auth", "group": "Events", "patterns": [lambda: _observability_dir() / "auth.log"]},
    "email": {"label": "Email / SES", "group": "Events", "patterns": [lambda: _observability_dir() / "email.log"]},
    "llm-usage": {"label": "Gemini / LLM Usage", "group": "Events", "patterns": [lambda: _observability_dir() / "llm-usage.log"]},
    "cron-events": {"label": "Cron Events", "group": "Events", "patterns": [lambda: _observability_dir() / "cron.log"]},
    "code-changes": {"label": "Code Changes", "group": "Code", "patterns": [lambda: _observability_dir() / "code-changes.log"]},
    "backend": {"label": "Backend", "group": "App", "patterns": [lambda: _observability_dir() / "backend.log"]},
    "frontend": {"label": "Frontend", "group": "App", "patterns": [lambda: _observability_dir() / "frontend.log"]},
    "build": {"label": "Build", "group": "App", "patterns": [lambda: str(_observability_dir() / "build-*.log")]},
    "npm": {"label": "NPM", "group": "App", "patterns": [lambda: str(_frontend_dir() / ".npm-cache" / "_logs" / "*.log")]},
    "documenso-cron": {"label": "Documenso Cron", "group": "Cron", "patterns": [lambda: str(_api_dir() / ".deploy-logs" / "*.log")]},
    "journal": {"label": "EC2 Journal", "group": "System", "patterns": [lambda: Path("/var/log/ethara-journal.log")]},
    "cloud-init": {"label": "Cloud Init", "group": "System", "patterns": [lambda: Path("/var/log/cloud-init.log"), lambda: Path("/var/log/cloud-init-output.log")]},
    "packages": {"label": "Packages", "group": "System", "patterns": [lambda: Path("/var/log/dnf.log"), lambda: Path("/var/log/dnf.rpm.log"), lambda: Path("/var/log/dnf.librepo.log"), lambda: Path("/var/log/hawkey.log")]},
    "audit-file": {"label": "Linux Audit", "group": "System", "patterns": [lambda: Path("/var/log/audit/audit.log")]},
    "ssm": {"label": "SSM Agent", "group": "System", "patterns": [lambda: Path("/var/log/amazon/ssm/amazon-ssm-agent.log"), lambda: Path("/var/log/amazon/ssm/errors.log"), lambda: str(Path("/var/log/amazon/ssm/audits") / "*.log")]},
    "cloudwatch-agent": {"label": "CloudWatch Agent", "group": "Agent", "patterns": [lambda: Path("/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log")]},
}


LLM_PRICE_PER_1M_TOKENS: dict[str, dict[str, float]] = {
    # Operational estimate only. Provider billing pages remain the source of truth.
    "vertex": {"prompt": 0.10, "completion": 0.40, "cached": 0.025, "thoughts": 0.40},
    "gemini": {"prompt": 0.10, "completion": 0.40, "cached": 0.025, "thoughts": 0.40},
    "openai": {"prompt": 0.40, "completion": 1.60, "cached": 0.10, "thoughts": 1.60},
}
SES_ESTIMATED_COST_PER_MESSAGE = 0.0001


def _humanize(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "Unknown"
    return raw.replace("_", " ").replace("-", " ").title()


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _round_money(value: float) -> float:
    if value <= 0:
        return 0.0
    return round(value, 6)


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _timeline_bucket(value: Any) -> tuple[str, str] | None:
    parsed = _parse_timestamp(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    bucket = parsed.replace(minute=0, second=0, microsecond=0)
    return bucket.isoformat(), bucket.strftime("%d %b, %H:00")


def _event_is_error(entry: dict[str, Any]) -> bool:
    haystack = " ".join(
        str(value or "")
        for value in (
            entry.get("level"),
            entry.get("event"),
            entry.get("message"),
            (entry.get("fields") or {}).get("error"),
        )
    ).lower()
    return any(marker in haystack for marker in ("error", "failed", "failure", "critical", "exception"))


def _event_is_success(entry: dict[str, Any]) -> bool:
    haystack = " ".join(str(value or "") for value in (entry.get("level"), entry.get("event"), entry.get("message"))).lower()
    return any(marker in haystack for marker in ("success", "completed", "verified", "sent", "ok"))


def _llm_cost(fields: dict[str, Any]) -> float:
    provider = str(fields.get("provider") or "").strip().lower()
    rates = LLM_PRICE_PER_1M_TOKENS.get(provider, LLM_PRICE_PER_1M_TOKENS["gemini"])
    prompt = _safe_int(fields.get("promptTokens"))
    completion = _safe_int(fields.get("completionTokens"))
    cached = _safe_int(fields.get("cachedTokens"))
    thoughts = _safe_int(fields.get("thoughtsTokens"))
    return _round_money(
        (prompt / 1_000_000) * rates["prompt"]
        + (completion / 1_000_000) * rates["completion"]
        + (cached / 1_000_000) * rates["cached"]
        + (thoughts / 1_000_000) * rates["thoughts"]
    )


def _entry_cost(stream: str, entry: dict[str, Any]) -> float:
    fields = entry.get("fields") or {}
    if stream == "llm-usage":
        return _llm_cost(fields)
    if stream == "email" and str(entry.get("event") or "").lower().endswith("success"):
        return SES_ESTIMATED_COST_PER_MESSAGE
    return 0.0


def _entry_title(entry: dict[str, Any]) -> str:
    event = entry.get("event") or entry.get("level")
    return _humanize(event)


def _is_test_client(fields: dict[str, Any]) -> bool:
    return str(fields.get("clientIp") or "").lower() == "testclient" or str(fields.get("userAgent") or "").lower() == "testclient"


def _client_label(fields: dict[str, Any]) -> str:
    if _is_test_client(fields):
        return "Automated test client"
    return str(fields.get("clientIp") or fields.get("ipAddress") or "unknown client")


def _entry_description(stream: str, entry: dict[str, Any]) -> str:
    fields = entry.get("fields") or {}
    if stream == "auth":
        email = fields.get("email") or fields.get("userId") or "unknown user"
        role = fields.get("role")
        path = fields.get("path")
        return " · ".join(str(part) for part in (email, role, _client_label(fields), path) if part)
    if stream == "email":
        subject = fields.get("subject") or "No subject"
        recipient = fields.get("toEmail") or fields.get("recipient") or "unknown recipient"
        backend = fields.get("backend") or "mail"
        return f"{subject} · {recipient} · {backend}"
    if stream == "llm-usage":
        provider = fields.get("provider") or "llm"
        model = fields.get("model") or "model unknown"
        operation = fields.get("operation") or entry.get("event")
        tokens = fields.get("totalTokens")
        token_text = f" · {tokens} tokens" if tokens else ""
        error_text = fields.get("errorDetail") or fields.get("error")
        error_suffix = f" · {str(error_text)[:180]}" if _event_is_error(entry) and error_text else ""
        return f"{provider} · {model} · {operation}{token_text}{error_suffix}"
    if stream == "audit-db":
        actor = fields.get("performedByName") or fields.get("performedByRole") or "System"
        entity = fields.get("entityType") or "record"
        entity_id = fields.get("entityId")
        return " · ".join(str(part) for part in (actor, entity, entity_id) if part)
    return str(entry.get("message") or entry.get("raw") or "")[:240]


def _decorate_entry(stream: str, entry: dict[str, Any]) -> dict[str, Any]:
    fields = entry.get("fields") or {}
    cost = _entry_cost(stream, entry)
    structured = {
        "title": _entry_title(entry),
        "description": _entry_description(stream, entry),
        "status": "error" if _event_is_error(entry) else "success" if _event_is_success(entry) else "info",
        "costUsd": cost,
    }
    if stream == "llm-usage":
        structured.update(
            {
                "provider": fields.get("provider"),
                "model": fields.get("model"),
                "operation": fields.get("operation"),
                "promptTokens": fields.get("promptTokens"),
                "completionTokens": fields.get("completionTokens"),
                "totalTokens": fields.get("totalTokens"),
                "errorDetail": fields.get("errorDetail"),
                "httpStatus": fields.get("httpStatus"),
            }
        )
    if stream == "email":
        structured.update(
            {
                "recipient": fields.get("toEmail") or fields.get("recipient"),
                "subject": fields.get("subject"),
                "backend": fields.get("backend"),
            }
        )
    if stream == "auth":
        structured.update(
            {
                "email": fields.get("email"),
                "role": fields.get("role"),
                "ipAddress": fields.get("clientIp") or fields.get("ipAddress"),
                "clientLabel": _client_label(fields),
                "isTestClient": _is_test_client(fields),
            }
        )
    return {**entry, "costUsd": cost, "structured": structured}


def _top_items(counter: Counter[str], *, limit: int = 6) -> list[dict[str, Any]]:
    return [{"label": label, "value": count} for label, count in counter.most_common(limit) if label]


def _timeline(rows: list[dict[str, Any]], stream: str) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for entry in rows:
        bucket = _timeline_bucket(entry.get("timestamp"))
        if bucket is None:
            continue
        key, label = bucket
        current = buckets.setdefault(key, {"time": key, "label": label, "events": 0, "errors": 0, "costUsd": 0.0})
        current["events"] += 1
        if _event_is_error(entry):
            current["errors"] += 1
        current["costUsd"] = _round_money(current["costUsd"] + _entry_cost(stream, entry))
    return [buckets[key] for key in sorted(buckets.keys())[-24:]]


def _stream_insights(stream: str, rows: list[dict[str, Any]], *, total_bytes: int | None = None) -> dict[str, Any]:
    total = len(rows)
    errors = sum(1 for row in rows if _event_is_error(row))
    successes = sum(1 for row in rows if _event_is_success(row))
    cost = _round_money(sum(_entry_cost(stream, row) for row in rows))
    duration_values = [_safe_float((row.get("fields") or {}).get("durationMs")) for row in rows]
    duration_values = [value for value in duration_values if value > 0]
    avg_duration = round(sum(duration_values) / len(duration_values), 1) if duration_values else None
    fields = [row.get("fields") or {} for row in rows]

    cards: list[dict[str, Any]] = [
        {"label": "Events", "value": total, "detail": "matching selected search", "tone": "info"},
        {"label": "Success", "value": successes, "detail": "successful or completed events", "tone": "success"},
        {"label": "Errors", "value": errors, "detail": "failed/error events", "tone": "danger" if errors else "success"},
    ]
    breakdown: list[dict[str, Any]] = []
    searchable_fields = ["event", "message", "raw", "source"]
    cost_note = None

    if stream == "llm-usage":
        provider_counter = Counter(str(item.get("provider") or "unknown") for item in fields)
        model_counter = Counter(str(item.get("model") or "unknown") for item in fields)
        operation_counter = Counter(str(item.get("operation") or "unknown") for item in fields)
        prompt_tokens = sum(_safe_int(item.get("promptTokens")) for item in fields)
        completion_tokens = sum(_safe_int(item.get("completionTokens")) for item in fields)
        total_tokens = sum(_safe_int(item.get("totalTokens")) for item in fields)
        cards.extend(
            [
                {"label": "Tokens", "value": total_tokens, "detail": f"{prompt_tokens} in · {completion_tokens} out", "tone": "info"},
                {"label": "Estimated Spend", "value": cost, "format": "currency", "detail": "logged successful token usage", "tone": "cost"},
                {"label": "Avg Latency", "value": avg_duration, "format": "duration", "detail": "successful and failed calls", "tone": "info"},
            ]
        )
        breakdown = [
            {"label": "Providers", "items": _top_items(provider_counter)},
            {"label": "Models", "items": _top_items(model_counter)},
            {"label": "Operations", "items": _top_items(operation_counter)},
        ]
        searchable_fields.extend(["provider", "model", "operation", "error", "errorDetail", "httpStatus", "promptTokens", "completionTokens", "totalTokens"])
        cost_note = "Estimated from logged successful token usage only. Exact spend by API key requires the provider billing API/console and is not exposed by the key itself."
    elif stream == "email":
        backend_counter = Counter(str(item.get("backend") or "unknown") for item in fields)
        subject_counter = Counter(str(item.get("subject") or "No subject") for item in fields)
        recipient_count = len({str(item.get("toEmail") or item.get("recipient") or "") for item in fields if item.get("toEmail") or item.get("recipient")})
        cards.extend(
            [
                {"label": "Recipients", "value": recipient_count, "detail": "unique destination emails", "tone": "info"},
                {"label": "Estimated SES Cost", "value": cost, "format": "currency", "detail": "success events only", "tone": "cost"},
            ]
        )
        breakdown = [
            {"label": "Backends", "items": _top_items(backend_counter)},
            {"label": "Subjects", "items": _top_items(subject_counter)},
        ]
        searchable_fields.extend(["backend", "toEmail", "ccEmails", "subject", "smtpHost", "error"])
        cost_note = "Estimated at $0.0001 per successful email event. AWS SES billing remains the source of truth."
    elif stream == "auth":
        role_counter = Counter(str(item.get("role") or "unknown") for item in fields)
        email_counter = Counter(str(item.get("email") or item.get("userId") or "unknown") for item in fields)
        ip_counter = Counter(_client_label(item) for item in fields)
        test_client_count = sum(1 for item in fields if _is_test_client(item))
        cards.extend(
            [
                {"label": "Unique Users", "value": len(email_counter), "detail": "emails or user ids", "tone": "info"},
                {"label": "Roles", "value": len(role_counter), "detail": "roles seen in auth stream", "tone": "info"},
                {"label": "Automated Tests", "value": test_client_count, "detail": "FastAPI/TestClient logins", "tone": "info"},
            ]
        )
        breakdown = [
            {"label": "Roles", "items": _top_items(role_counter)},
            {"label": "Users", "items": _top_items(email_counter)},
            {"label": "IP Addresses", "items": _top_items(ip_counter)},
        ]
        searchable_fields.extend(["email", "userId", "role", "clientIp", "path", "userAgent"])
    elif stream == "audit-db":
        actor_counter = Counter(str(item.get("performedByName") or item.get("performedByRole") or "System") for item in fields)
        entity_counter = Counter(str(item.get("entityType") or "unknown") for item in fields)
        action_counter = Counter(str(row.get("event") or "unknown") for row in rows)
        cards.extend(
            [
                {"label": "Actors", "value": len(actor_counter), "detail": "people or roles acting", "tone": "info"},
                {"label": "Entity Types", "value": len(entity_counter), "detail": "records touched", "tone": "info"},
            ]
        )
        breakdown = [
            {"label": "Actions", "items": _top_items(action_counter)},
            {"label": "Actors", "items": _top_items(actor_counter)},
            {"label": "Entities", "items": _top_items(entity_counter)},
        ]
        searchable_fields.extend(["entityType", "entityId", "performedByName", "performedByRole", "ipAddress"])
    else:
        level_counter = Counter(str(row.get("level") or "info") for row in rows)
        event_counter = Counter(str(row.get("event") or "log") for row in rows)
        cards.extend(
            [
                {"label": "Storage", "value": total_bytes or 0, "format": "bytes", "detail": "selected stream files", "tone": "info"},
                {"label": "Avg Latency", "value": avg_duration, "format": "duration", "detail": "when durationMs is logged", "tone": "info"},
            ]
        )
        breakdown = [
            {"label": "Events", "items": _top_items(event_counter)},
            {"label": "Levels", "items": _top_items(level_counter)},
        ]

    return {
        "cards": cards,
        "breakdown": breakdown,
        "timeline": _timeline(rows, stream),
        "cost": {"estimatedUsd": cost, "currency": "USD", "note": cost_note},
        "searchableFields": sorted(set(searchable_fields)),
    }


def _expand_paths(stream: str) -> list[Path]:
    config = LOG_STREAMS.get(stream)
    if config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown log stream.")
    paths: list[Path] = []
    for pattern_factory in config["patterns"]:
        pattern = pattern_factory()
        if isinstance(pattern, Path):
            matches = [pattern]
        else:
            matches = [Path(path) for path in glob.glob(pattern)]
        for path in matches:
            try:
                resolved = path.resolve()
                if resolved.exists() and resolved.is_file():
                    paths.append(resolved)
            except OSError:
                continue
    return sorted(set(paths), key=lambda item: str(item))


def _parse_line(line: str, *, path: Path, index: int) -> dict[str, Any]:
    raw = line.rstrip("\n")
    payload: dict[str, Any] | None = None
    if raw.startswith("{") and raw.endswith("}"):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                payload = parsed
        except json.JSONDecodeError:
            payload = None
    timestamp = None
    level = None
    event = None
    message = raw
    fields: dict[str, Any] = {}
    if payload is not None:
        timestamp = payload.get("timestamp") or payload.get("time") or payload.get("createdAt")
        level = payload.get("level") or payload.get("severity")
        event = payload.get("event") or payload.get("action")
        message = str(payload.get("message") or payload.get("summary") or event or raw)
        fields = payload
    else:
        parts = raw.split(maxsplit=3)
        if parts and (parts[0].startswith("20") or parts[0].startswith("INFO:") or parts[0].startswith("ERROR:")):
            timestamp = parts[0] if parts[0].startswith("20") else None
        for candidate in ("ERROR", "WARNING", "WARN", "INFO", "DEBUG", "CRITICAL"):
            if candidate in raw:
                level = candidate
                break
    return {
        "id": f"{path.name}:{index}",
        "timestamp": timestamp,
        "level": level,
        "event": event,
        "message": message,
        "raw": raw,
        "source": str(path),
        "fields": fields,
    }


def _read_stream(stream: str, *, search: str | None, page: int, limit: int) -> dict[str, Any]:
    paths = _expand_paths(stream)
    rows: list[dict[str, Any]] = []
    query = search.strip().lower() if search else ""
    total_bytes = 0
    last_modified: datetime | None = None
    for path in paths:
        try:
            stat = path.stat()
            total_bytes += stat.st_size
            modified = datetime.fromtimestamp(stat.st_mtime, tz=UTC)
            if last_modified is None or modified > last_modified:
                last_modified = modified
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for index, line in enumerate(lines, start=1):
            if query and query not in line.lower():
                continue
            rows.append(_parse_line(line, path=path, index=index))
    rows.reverse()
    rows = [_decorate_entry(stream, row) for row in rows]
    total = len(rows)
    offset = max(page - 1, 0) * limit
    config = LOG_STREAMS[stream]
    return {
        "stream": stream,
        "label": config["label"],
        "group": config["group"],
        "data": rows[offset : offset + limit],
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit if limit else 1,
        "files": [str(path) for path in paths],
        "bytes": total_bytes,
        "lastModified": last_modified,
        "insights": _stream_insights(stream, rows, total_bytes=total_bytes),
    }


def _audit_stream(db: Session, *, search: str | None, page: int, limit: int) -> dict[str, Any]:
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if search:
        like = f"%{search.lower()}%"
        query = query.where(
            func.lower(AuditLog.action).like(like)
            | func.lower(AuditLog.entity_type).like(like)
            | func.lower(func.coalesce(AuditLog.performed_by_name, "")).like(like)
            | func.lower(func.coalesce(AuditLog.performed_by_role, "")).like(like)
            | func.lower(func.coalesce(AuditLog.entity_id, "")).like(like)
            | func.lower(func.coalesce(AuditLog.user_id, "")).like(like)
            | func.lower(func.coalesce(AuditLog.candidate_id, "")).like(like)
            | func.lower(func.coalesce(AuditLog.ip_address, "")).like(like)
            | func.lower(func.coalesce(cast(AuditLog.old_value, String), "")).like(like)
            | func.lower(func.coalesce(cast(AuditLog.new_value, String), "")).like(like)
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = list(db.scalars(query.offset((page - 1) * limit).limit(limit)))
    entries = [
        _decorate_entry(
            "audit-db",
            {
                "id": row.id,
                "timestamp": row.created_at,
                "level": "INFO",
                "event": row.action,
                "message": f"{row.action.replace('_', ' ').replace('-', ' ').title()} · {row.entity_type.replace('_', ' ').replace('-', ' ').title()}",
                "raw": json.dumps(
                    {
                        "id": row.id,
                        "entityType": row.entity_type,
                        "entityId": row.entity_id,
                        "action": row.action,
                        "performedByName": row.performed_by_name,
                        "performedByRole": row.performed_by_role,
                        "ipAddress": row.ip_address,
                        "userId": row.user_id,
                        "candidateId": row.candidate_id,
                        "createdAt": row.created_at.isoformat() if row.created_at else None,
                    },
                    default=str,
                ),
                "source": "database:audit_logs",
                "fields": {
                    "entityType": row.entity_type,
                    "entityId": row.entity_id,
                    "performedByName": row.performed_by_name,
                    "performedByRole": row.performed_by_role,
                    "ipAddress": row.ip_address,
                    "userId": row.user_id,
                    "candidateId": row.candidate_id,
                },
            },
        )
        for row in rows
    ]
    return {
        "stream": "audit-db",
        "label": "Audit DB",
        "group": "Events",
        "data": entries,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit if limit else 1,
        "files": [],
        "bytes": None,
        "lastModified": rows[0].created_at if rows else None,
        "insights": _stream_insights("audit-db", entries),
    }


@router.get("/summary")
def logs_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUDIT_LOGS_READ))],
):
    _assert_log_admin(current_user)
    streams = []
    total_lines = 0
    total_bytes = 0
    for key, config in LOG_STREAMS.items():
        paths = _expand_paths(key)
        line_count = 0
        byte_count = 0
        last_modified: datetime | None = None
        for path in paths:
            try:
                stat = path.stat()
                byte_count += stat.st_size
                modified = datetime.fromtimestamp(stat.st_mtime, tz=UTC)
                if last_modified is None or modified > last_modified:
                    last_modified = modified
                with path.open("rb") as handle:
                    line_count += sum(1 for _ in handle)
            except OSError:
                continue
        total_lines += line_count
        total_bytes += byte_count
        streams.append(
            {
                "key": key,
                "label": config["label"],
                "group": config["group"],
                "lines": line_count,
                "bytes": byte_count,
                "files": len(paths),
                "lastModified": last_modified,
            }
        )
    audit_total = db.scalar(select(func.count()).select_from(AuditLog)) or 0
    audit_latest = db.scalar(select(AuditLog.created_at).order_by(AuditLog.created_at.desc()).limit(1))
    streams.insert(
        0,
        {
            "key": "audit-db",
            "label": "Audit DB",
            "group": "Events",
            "lines": audit_total,
            "bytes": None,
            "files": 1,
            "lastModified": audit_latest,
        },
    )
    return {
        "streams": streams,
        "totals": {
            "streams": len(streams),
            "events": total_lines + audit_total,
            "bytes": total_bytes,
            "files": sum(int(stream["files"] or 0) for stream in streams),
        },
    }


# ── System status / performance (stdlib only — no psutil dependency) ──────────
def _role_value(role: Any) -> str:
    return str(getattr(role, "value", role))


def _cpu_sample() -> tuple[float, float] | None:
    """Return (total_jiffies, idle_jiffies) from /proc/stat, or None."""
    try:
        with open("/proc/stat", encoding="utf-8") as handle:
            fields = handle.readline().split()[1:]
        nums = [float(value) for value in fields]
        idle = nums[3] + (nums[4] if len(nums) > 4 else 0.0)  # idle + iowait
        return sum(nums), idle
    except (OSError, ValueError, IndexError):
        return None


def _cpu_percent_sample() -> float | None:
    first = _cpu_sample()
    if first is None:
        return None
    time.sleep(0.25)
    second = _cpu_sample()
    if second is None:
        return None
    delta_total = second[0] - first[0]
    delta_idle = second[1] - first[1]
    if delta_total <= 0:
        return None
    return round(max(0.0, min(100.0, 100.0 * (1.0 - delta_idle / delta_total))), 1)


def _cpu_load_percent(load1: float | None, cores: int | None) -> float | None:
    if load1 is None or not cores or cores <= 0:
        return None
    return round(max(0.0, min(100.0, (load1 / cores) * 100.0)), 1)


def _cpu_metric(load1: float | None, cores: int | None) -> dict[str, Any]:
    sample_percent = _cpu_percent_sample()
    load_percent = _cpu_load_percent(load1, cores)
    if sample_percent is None:
        return {"percent": load_percent, "source": "load"}
    if sample_percent <= 0.0 and load_percent and load_percent > 0:
        return {"percent": load_percent, "source": "load"}
    return {"percent": sample_percent, "source": "sample"}


def _memory() -> dict[str, Any] | None:
    try:
        info: dict[str, int] = {}
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, _, rest = line.partition(":")
                info[key.strip()] = int(rest.split()[0]) * 1024  # kB → bytes
        total = info["MemTotal"]
        available = info.get("MemAvailable", info.get("MemFree", 0))
        used = total - available
        return {
            "totalBytes": total,
            "usedBytes": used,
            "availableBytes": available,
            "percent": round(100.0 * used / total, 1) if total else None,
        }
    except (OSError, ValueError, KeyError):
        return None


def _disk() -> dict[str, Any] | None:
    try:
        usage = shutil.disk_usage("/")
        return {
            "totalBytes": usage.total,
            "usedBytes": usage.used,
            "freeBytes": usage.free,
            "percent": round(100.0 * usage.used / usage.total, 1) if usage.total else None,
        }
    except OSError:
        return None


def _system_uptime_seconds() -> float | None:
    try:
        with open("/proc/uptime", encoding="utf-8") as handle:
            return round(float(handle.readline().split()[0]), 0)
    except (OSError, ValueError, IndexError):
        return None


def _process_rss_bytes() -> int | None:
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def _top_processes(limit: int = 8) -> list[dict[str, Any]]:
    try:
        result = subprocess.run(
            ["ps", "-eo", "pid,pcpu,pmem,rss,comm,args", "--sort=-pcpu"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except Exception:
        return []
    if result.returncode != 0:
        return []
    rows: list[dict[str, Any]] = []
    for line in result.stdout.splitlines()[1 : limit + 1]:
        parts = line.split(None, 5)
        if len(parts) < 6:
            continue
        pid, cpu, mem, rss, command, args = parts
        rows.append(
            {
                "pid": _safe_int(pid),
                "cpuPercent": round(_safe_float(cpu), 1),
                "memoryPercent": round(_safe_float(mem), 1),
                "rssBytes": _safe_int(rss) * 1024,
                "command": command,
                "args": args[:220],
            }
        )
    return rows


def _tcp_reachable(host: str | None, port: int, timeout: float = 2.0) -> tuple[bool, float | None]:
    """Cheap TCP-connect reachability probe. Returns (ok, latencyMs). Never raises."""
    if not host:
        return False, None
    import socket

    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, round((time.perf_counter() - started) * 1000, 1)
    except Exception:
        return False, None


def _integrations_health() -> list[dict[str, Any]]:
    """Best-effort health of the external resources the platform depends on, for the admin
    System Health tab. Connectivity is checked with a cheap TCP connect (no API calls, no
    cost); paid AI + credential-gated APIs report only their configured state. Never raises,
    so the health panel can't 500 the endpoint."""
    from urllib.parse import urlparse

    s = get_settings()
    out: list[dict[str, Any]] = []

    # Email (SMTP / SES) — real connectivity probe
    if (s.email_backend or "").lower() == "smtp" and s.smtp_host:
        ok, latency = _tcp_reachable(s.smtp_host, s.smtp_port or 587)
        out.append({"key": "email", "label": "Email (SMTP / SES)", "configured": True,
                    "ok": ok, "latencyMs": latency, "detail": f"{s.smtp_host}:{s.smtp_port or 587}"})
    else:
        out.append({"key": "email", "label": "Email (SMTP / SES)", "configured": False,
                    "ok": None, "detail": f"backend={s.email_backend}"})

    # Documenso e-sign — real connectivity probe (no auth, no document calls)
    if s.documenso_api_key:
        host = urlparse(s.documenso_base_url).hostname
        ok, latency = _tcp_reachable(host, 443)
        out.append({"key": "documenso", "label": "Documenso e-sign", "configured": True,
                    "ok": ok, "latencyMs": latency, "detail": host})
    else:
        out.append({"key": "documenso", "label": "Documenso e-sign", "configured": False,
                    "ok": None, "detail": "no api key"})

    # Vertex AI (paid) — report configured state only, don't burn quota
    out.append({"key": "vertex_ai", "label": "Vertex AI (OCR / screening)",
                "configured": bool(s.vertex_ai_enabled and s.vertex_ai_api_key), "ok": None,
                "detail": s.vertex_ai_model if s.vertex_ai_enabled else "disabled"})

    # Gemini (AI Studio) — configured state only
    out.append({"key": "gemini", "label": "Gemini (AI Studio)",
                "configured": bool(s.gemini_api_key), "ok": None, "detail": s.gemini_model})

    # greytHR — configured state only (auth'd API)
    out.append({"key": "greythr", "label": "greytHR (leave sync)",
                "configured": bool(s.greythr_configured), "ok": None,
                "detail": s.greythr_domain or "not configured"})

    # Storage
    backend = s.storage_backend or "local"
    if backend == "s3":
        out.append({"key": "storage", "label": "Storage (S3)", "configured": bool(s.aws_s3_bucket),
                    "ok": None, "detail": s.aws_s3_bucket or "no bucket"})
    else:
        out.append({"key": "storage", "label": "Storage (local disk)", "configured": True,
                    "ok": True, "detail": "local disk"})

    return out


@router.get("/system-status")
def system_status(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUDIT_LOGS_READ))],
):
    """Live performance, active-user and platform stats for the admin system-log view.
    Every metric is best-effort (failures degrade to null) so the panel never 500s."""
    _assert_log_admin(current_user)
    from app.db.models import Candidate, EmployeeContract, EmployeeProfile, Evaluation, ITRequest

    now = datetime.now(UTC)

    load1 = load5 = load15 = None
    try:
        load1, load5, load15 = (round(value, 2) for value in os.getloadavg())
    except (OSError, AttributeError):
        pass

    cores = os.cpu_count()
    cpu = _cpu_metric(load1, cores)

    performance = {
        "cpu": {
            "percent": cpu["percent"],
            "source": cpu["source"],
            "cores": cores,
            "load1": load1,
            "load5": load5,
            "load15": load15,
        },
        "memory": _memory(),
        "disk": _disk(),
        "uptimeSeconds": _system_uptime_seconds(),
        "processRssBytes": _process_rss_bytes(),
    }

    # ── Services health ──
    db_ok, db_latency = False, None
    try:
        started = time.perf_counter()
        db.execute(text("select 1"))
        db_latency = round((time.perf_counter() - started) * 1000, 1)
        db_ok = True
    except Exception:
        db_ok = False
    redis_ok = False
    try:
        import redis  # provided by celery[redis]

        client = redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1)
        redis_ok = bool(client.ping())
        client.close()
    except Exception:
        redis_ok = False
    services = {"database": {"ok": db_ok, "latencyMs": db_latency}, "redis": {"ok": redis_ok}}

    # ── Active users ──
    def _count(stmt) -> int:
        try:
            return db.scalar(stmt) or 0
        except Exception:
            return 0

    live_sessions = _count(
        select(func.count()).select_from(User).where(User.refresh_token_hash.is_not(None), User.is_active.is_(True))
    )
    active_15m = _count(select(func.count()).select_from(User).where(User.last_login_at >= now - timedelta(minutes=15)))
    active_24h = _count(select(func.count()).select_from(User).where(User.last_login_at >= now - timedelta(hours=24)))
    recent_users: list[dict[str, Any]] = []
    try:
        for user in db.scalars(
            select(User).where(User.last_login_at.is_not(None)).order_by(User.last_login_at.desc()).limit(8)
        ):
            recent_users.append(
                {
                    "name": user.name,
                    "email": user.email,
                    "role": _role_value(user.role),
                    "lastLoginAt": user.last_login_at,
                    "hasSession": user.refresh_token_hash is not None,
                }
            )
    except Exception:
        recent_users = []

    active_users = {
        "liveSessions": live_sessions,
        "activeLast15m": active_15m,
        "activeLast24h": active_24h,
        "recent": recent_users,
    }

    # ── Platform stats ──
    by_role: list[dict[str, Any]] = []
    try:
        for role_value, count in db.execute(
            select(User.role, func.count()).where(User.is_active.is_(True)).group_by(User.role)
        ).all():
            by_role.append({"role": _role_value(role_value), "count": count})
        by_role.sort(key=lambda item: item["count"], reverse=True)
    except Exception:
        by_role = []

    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    stats = {
        "usersTotal": _count(select(func.count()).select_from(User)),
        "usersActive": _count(select(func.count()).select_from(User).where(User.is_active.is_(True))),
        "byRole": by_role,
        "candidatesTotal": _count(select(func.count()).select_from(Candidate).where(Candidate.is_removed.is_(False))),
        "candidatesThisMonth": _count(
            select(func.count()).select_from(Candidate).where(
                Candidate.is_removed.is_(False), Candidate.created_at >= month_start
            )
        ),
        "employeesTotal": _count(select(func.count()).select_from(EmployeeProfile)),
        "itRequestsOpen": _count(select(func.count()).select_from(ITRequest).where(ITRequest.status != "completed")),
        "evaluationsPending": _count(
            select(func.count()).select_from(Evaluation).where(Evaluation.completed_at.is_(None))
        ),
        "contractsSigned": _count(
            select(func.count()).select_from(EmployeeContract).where(EmployeeContract.completed_at.is_not(None))
        ),
        "auditEvents": _count(select(func.count()).select_from(AuditLog)),
    }

    return {
        "generatedAt": now,
        "performance": performance,
        "services": services,
        "activeUsers": active_users,
        "stats": stats,
        "processes": {"topCpu": _top_processes()},
        "integrations": _integrations_health(),
    }


@router.get("/{stream}")
def log_stream(
    stream: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.AUDIT_LOGS_READ))],
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
):
    _assert_log_admin(current_user)
    if stream == "audit-db":
        return _audit_stream(db, search=search, page=page, limit=limit)
    return _read_stream(stream, search=search, page=page, limit=limit)
