from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.db.models import AuditLog, User


def log_audit(
    db: Session,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor: User | None,
    request: Request | None = None,
    candidate_id: str | None = None,
    user_id: str | None = None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> AuditLog:
    audit = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        performed_by=actor.id if actor else "system",
        performed_by_name=actor.name if actor else "System",
        performed_by_role=actor.role.value if actor else "system",
        candidate_id=candidate_id,
        user_id=user_id,
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        old_value=old_value,
        new_value=new_value,
    )
    db.add(audit)
    db.flush()
    return audit

