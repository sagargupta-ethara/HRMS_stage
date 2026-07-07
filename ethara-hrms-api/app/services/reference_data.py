import re
import secrets
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import AdminSetting, College, Position, Role, User, Vendor
from app.services import auth as auth_service
from app.services.audit import log_audit

PENDING_LEADERSHIP_APPROVAL = "pending_leadership_approval"
POSTED_STATUS = "posted"
DELETED_STATUS = "deleted"


POSITION_CONTENT_FIELDS = {
    "title",
    "slug",
    "department",
    "summary",
    "description",
    "location",
    "employment_type",
    "work_mode",
    "experience_level",
    "experience_years",
    "salary_bracket",
    "responsibilities",
    "requirements",
    "preferred_skills",
    "benefits",
    "featured",
    "openings",
    "urgency_level",
    "screening_prompt",
}


def list_positions(db: Session) -> list[Position]:
    return list(
        db.scalars(
            select(Position).where(
                or_(Position.approval_status.is_(None), Position.approval_status != DELETED_STATUS)
            ).order_by(
                Position.featured.desc(),
                Position.posted_at.desc().nullslast(),
                Position.urgency_level.desc(),
                Position.created_at.desc(),
            )
        )
    )


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "job-opening"


def _ensure_unique_slug(db: Session, *, title: str, candidate_slug: str | None, position_id: str | None = None) -> str:
    base_slug = _slugify(candidate_slug or title)
    slug = base_slug
    suffix = 2
    while True:
        existing = db.scalar(select(Position).where(Position.slug == slug))
        if existing is None or existing.id == position_id:
            return slug
        slug = f"{base_slug}-{suffix}"
        suffix += 1


def _normalize_position_payload(
    db: Session,
    *,
    payload: dict,
    position_id: str | None = None,
    apply_defaults: bool = False,
) -> dict:
    normalized = payload.copy()
    if "title" in normalized or "slug" in normalized:
        normalized["slug"] = _ensure_unique_slug(
            db,
            title=normalized.get("title") or "job-opening",
            candidate_slug=normalized.get("slug"),
            position_id=position_id,
        )
    if apply_defaults:
        normalized.setdefault("summary", normalized.get("description"))
        normalized.setdefault("location", "Bengaluru, India")
        normalized.setdefault("employment_type", "Full-time")
        normalized.setdefault("work_mode", "Hybrid")
        normalized.setdefault("experience_level", "Mid-Senior")
        normalized.setdefault("experience_years", 3)
        normalized.setdefault("responsibilities", [])
        normalized.setdefault("requirements", [])
        normalized.setdefault("preferred_skills", [])
        normalized.setdefault("benefits", [])
        normalized.setdefault("featured", False)
        normalized.setdefault("openings", 1)
        normalized.setdefault("approval_status", "draft")
        normalized.setdefault("posted_at", None)
    return normalized


def _mark_position_pending_approval(position: Position, *, actor: User) -> None:
    position.approval_status = PENDING_LEADERSHIP_APPROVAL
    position.approval_requested_at = datetime.now(UTC)
    position.approval_decided_at = None
    position.requested_by = actor.id
    position.approved_by = None
    position.approval_recipient_email = None
    position.reviewed_by_email = None
    position.rejection_reason = None
    position.approval_email_sent_at = None
    position.approval_token_hash = None
    position.approval_token_expires_at = None
    position.is_active = False
    position.posted_at = None


def create_position(db: Session, *, payload: dict, actor: User) -> Position:
    position = Position(**_normalize_position_payload(db, payload=payload, apply_defaults=True))
    _mark_position_pending_approval(position, actor=actor)
    db.add(position)
    db.flush()
    log_audit(db, entity_type="position", entity_id=position.id, action="position_created", actor=actor)
    log_audit(
        db,
        entity_type="position",
        entity_id=position.id,
        action="position_approval_requested",
        actor=actor,
        new_value={"approvalStatus": position.approval_status},
    )
    return position


def update_position(db: Session, *, position: Position, payload: dict, actor: User) -> Position:
    normalized_payload = _normalize_position_payload(
        db,
        payload=payload,
        position_id=position.id,
        apply_defaults=False,
    )
    content_changed = bool(POSITION_CONTENT_FIELDS.intersection(normalized_payload))
    activation_requested = normalized_payload.get("is_active") is True and not position.is_active
    deactivation_requested = normalized_payload.get("is_active") is False
    for field, value in normalized_payload.items():
        setattr(position, field, value)
    if content_changed or activation_requested:
        _mark_position_pending_approval(position, actor=actor)
    db.add(position)
    log_audit(db, entity_type="position", entity_id=position.id, action="position_updated", actor=actor)
    if content_changed or activation_requested:
        log_audit(
            db,
            entity_type="position",
            entity_id=position.id,
            action="position_approval_requested",
            actor=actor,
            new_value={
                "approvalStatus": position.approval_status,
                "reason": "activation" if activation_requested and not content_changed else "content_change",
            },
        )
    elif deactivation_requested:
        log_audit(
            db,
            entity_type="position",
            entity_id=position.id,
            action="position_deactivated",
            actor=actor,
            new_value={"isActive": False},
        )
    return position


def approve_position(
    db: Session,
    *,
    position: Position,
    actor: User | None,
    approver_email: str | None = None,
) -> Position:
    decided_at = datetime.now(UTC)
    reviewed_by_email = auth_service.normalize_email(approver_email) if approver_email else (
        auth_service.normalize_email(actor.email) if actor else None
    )
    position.approval_status = POSTED_STATUS
    position.approval_decided_at = decided_at
    position.approved_by = actor.id if actor else None
    position.reviewed_by_email = reviewed_by_email
    position.rejection_reason = None
    position.is_active = True
    position.posted_at = position.posted_at or decided_at
    position.approval_token_hash = None
    position.approval_token_expires_at = None
    db.add(position)
    log_audit(
        db,
        entity_type="position",
        entity_id=position.id,
        action="position_approved",
        actor=actor,
        new_value={
            "approvalStatus": "approved",
            "approverEmail": reviewed_by_email,
            "approvedAt": decided_at.isoformat(),
        },
    )
    log_audit(
        db,
        entity_type="position",
        entity_id=position.id,
        action="position_posted",
        actor=actor,
        new_value={
            "approvalStatus": position.approval_status,
            "approverEmail": reviewed_by_email,
            "postedAt": position.posted_at.isoformat() if position.posted_at else None,
        },
    )
    return position


def reject_position(
    db: Session,
    *,
    position: Position,
    actor: User | None,
    reason: str | None = None,
    approver_email: str | None = None,
) -> Position:
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("Rejection reason is required.")
    decided_at = datetime.now(UTC)
    reviewed_by_email = auth_service.normalize_email(approver_email) if approver_email else (
        auth_service.normalize_email(actor.email) if actor else None
    )
    position.approval_status = "rejected"
    position.approval_decided_at = decided_at
    position.approved_by = actor.id if actor else None
    position.reviewed_by_email = reviewed_by_email
    position.rejection_reason = reason
    position.is_active = False
    position.posted_at = None
    position.approval_token_hash = None
    position.approval_token_expires_at = None
    db.add(position)
    log_audit(
        db,
        entity_type="position",
        entity_id=position.id,
        action="position_rejected",
        actor=actor,
        new_value={
            "approvalStatus": position.approval_status,
            "reason": reason,
            "approverEmail": reviewed_by_email,
            "rejectedAt": decided_at.isoformat(),
        },
    )
    return position


def delete_position(db: Session, *, position: Position, actor: User) -> Position:
    position.is_active = False
    position.approval_status = DELETED_STATUS
    position.approval_requested_at = None
    position.approval_decided_at = datetime.now(UTC)
    position.approved_by = actor.id
    position.reviewed_by_email = auth_service.normalize_email(actor.email)
    position.rejection_reason = None
    position.posted_at = None
    position.approval_token_hash = None
    position.approval_token_expires_at = None
    db.add(position)
    log_audit(
        db,
        entity_type="position",
        entity_id=position.id,
        action="position_deleted",
        actor=actor,
        new_value={"approvalStatus": position.approval_status, "isActive": False},
    )
    return position


def list_vendors(db: Session) -> list[Vendor]:
    return list(db.scalars(select(Vendor).order_by(Vendor.name.asc())))


def create_vendor(db: Session, *, payload: dict, actor: User) -> Vendor:
    vendor = Vendor(**payload)
    db.add(vendor)
    db.flush()
    log_audit(db, entity_type="vendor", entity_id=vendor.id, action="vendor_created", actor=actor)
    return vendor


def update_vendor(db: Session, *, vendor: Vendor, payload: dict, actor: User) -> Vendor:
    for field, value in payload.items():
        setattr(vendor, field, value)
    db.add(vendor)
    log_audit(db, entity_type="vendor", entity_id=vendor.id, action="vendor_updated", actor=actor)
    return vendor


def list_colleges(db: Session) -> list[College]:
    return list(db.scalars(select(College).order_by(College.name.asc())))


def create_college(db: Session, *, payload: dict, actor: User) -> College:
    record = College(**payload)
    db.add(record)
    db.flush()
    log_audit(db, entity_type="college", entity_id=record.id, action="college_created", actor=actor)
    return record


def update_college(db: Session, *, record: College, payload: dict, actor: User) -> College:
    for field, value in payload.items():
        setattr(record, field, value)
    db.add(record)
    log_audit(db, entity_type="college", entity_id=record.id, action="college_updated", actor=actor)
    return record


def list_users(db: Session) -> list[User]:
    # Hide anonymized soft-deleted accounts. On deletion the email is scrambled to
    # ``removed-<id>@removed.local`` (or ``@deleted.local``) and the account deactivated; these
    # are dead shells (often the discarded half of a duplicate registration) that only clutter
    # the admin User & Role list and inflate the per-role counts.
    return list(
        db.scalars(
            select(User)
            .where(
                ~or_(
                    func.lower(User.email).like("%@removed.local"),
                    func.lower(User.email).like("%@deleted.local"),
                )
            )
            .order_by(User.created_at.desc())
        )
    )


# ── Role-hierarchy guards for user management (#8) ────────────────────────────
# Privilege rank: super_admin outranks admin, which outranks every other role.
# Higher number == more privileged. Used to stop a less-privileged actor from
# creating/elevating/modifying accounts above their own level.
_PRIVILEGE_RANK: dict[str, int] = {
    Role.SUPER_ADMIN.value: 3,
    Role.ADMIN.value: 2,
    Role.LEADERSHIP.value: 1,
}
_DEFAULT_PRIVILEGE_RANK = 1
_ROLE_MANAGEMENT_ADMINS = {
    Role.SUPER_ADMIN.value,
    Role.ADMIN.value,
    Role.LEADERSHIP.value,
}


def _privilege_rank(role: object) -> int:
    return _PRIVILEGE_RANK.get(_role_value(role), _DEFAULT_PRIVILEGE_RANK)


def _count_active_super_admins(db: Session) -> int:
    return sum(
        1
        for user in db.scalars(select(User).where(User.is_active.is_(True))).all()
        if Role.SUPER_ADMIN.value in _user_role_values(user)
    )


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _assert_can_assign_roles(actor: User, *, assigned_roles: list[str]) -> None:
    """An actor may assign roles at or below their own privilege level.

    Only super_admin may grant super_admin.
    """
    actor_rank = _user_privilege_rank(actor)
    if actor_rank >= _PRIVILEGE_RANK[Role.SUPER_ADMIN.value]:
        return  # super_admin may assign anything
    for role_value in assigned_roles:
        if _privilege_rank(role_value) > actor_rank:
            raise _forbidden(
                "You cannot grant a role above your own privilege level."
            )


def _assert_can_modify_target(actor: User, target: User) -> None:
    """Reject modifying/demoting/deactivating a user more privileged than (or, for
    non-super_admins, equal to) the actor."""
    actor_rank = _user_privilege_rank(actor)
    if actor_rank >= _PRIVILEGE_RANK[Role.SUPER_ADMIN.value]:
        return  # super_admin may modify anyone
    target_rank = _user_privilege_rank(target)
    if target_rank >= actor_rank:
        raise _forbidden(
            "You cannot modify a user with the same or higher privilege level."
        )


def _assert_not_demoting_last_super_admin(db: Session, *, target: User, payload: dict) -> None:
    """Block removing the super_admin role from, or deactivating, the LAST remaining
    active super_admin."""
    if Role.SUPER_ADMIN.value not in _user_role_values(target):
        return
    if _count_active_super_admins(db) > 1:
        return  # other active super_admins remain — safe

    # This target is the last active super_admin. Block deactivation.
    if payload.get("is_active") is False:
        raise _forbidden("Cannot deactivate the last remaining super admin.")

    # Block demotion (active role change) and stripping super_admin from roles.
    if "role" in payload and _role_value(payload["role"]) != Role.SUPER_ADMIN.value:
        raise _forbidden("Cannot demote the last remaining super admin.")
    if "roles" in payload and payload["roles"] is not None:
        new_roles = {_role_value(r) for r in payload["roles"]}
        if Role.SUPER_ADMIN.value not in new_roles:
            raise _forbidden("Cannot remove the super admin role from the last super admin.")


def _role_value(role: object) -> str:
    return role.value if isinstance(role, Role) else str(role)


def _user_role_values(user: User) -> set[str]:
    return {_role_value(user.role)} | {_role_value(role) for role in (user.roles or [])}


def _user_privilege_rank(user: User) -> int:
    return max((_privilege_rank(role) for role in _user_role_values(user)), default=_DEFAULT_PRIVILEGE_RANK)


def _can_manage_any_member_role(user: User) -> bool:
    return bool(_user_role_values(user) & _ROLE_MANAGEMENT_ADMINS)


def _normalize_roles(*, role: object, roles: object | None) -> tuple[object, list[str]]:
    """Return the active role and a de-duplicated list of assigned role values.

    The active role is always guaranteed to be present in the returned list.
    """
    active = role
    active_value = _role_value(active)
    raw = roles if roles is not None else [active]
    normalized: list[str] = []
    for item in raw:
        value = _role_value(item)
        if value not in normalized:
            normalized.append(value)
    if active_value not in normalized:
        normalized.insert(0, active_value)
    return active, normalized


def create_user(db: Session, *, payload: dict, actor: User) -> User:
    settings = get_settings()
    normalized_email = auth_service.normalize_email(payload["email"])
    active_role, assigned_roles = _normalize_roles(role=payload["role"], roles=payload.get("roles"))
    # Privilege-escalation guard (#8): an actor cannot grant a role above
    # their own level (only super_admin may grant super_admin).
    _assert_can_assign_roles(actor, assigned_roles=assigned_roles)
    # Forced rotation (#28): when no explicit password is supplied the account uses
    # the shared temporary password, so require the user to change it on first use
    # (the gate in deps.py then applies). An explicitly-set password is honoured.
    has_explicit_password = bool(payload.get("password"))
    user = User(
        email=normalized_email,
        name=payload["name"],
        role=active_role,
        roles=assigned_roles,
        phone=payload.get("phone"),
        vendor_id=payload.get("vendor_id"),
        # Never hash an empty string: if no explicit password and no configured shared
        # temp password, fall back to a random one (user is forced to reset on first use).
        password_hash=hash_password(
            payload.get("password") or settings.default_temp_password or secrets.token_urlsafe(18)
        ),
        is_active=True,
        must_change_password=not has_explicit_password,
        email_verified_at=datetime.now(UTC) if payload["role"] != Role.CANDIDATE else None,
    )
    db.add(user)
    db.flush()
    log_audit(db, entity_type="user", entity_id=user.id, action="user_created", actor=actor, user_id=user.id)
    return user


def update_user(db: Session, *, user: User, payload: dict, actor: User) -> User:
    if "email" in payload and payload["email"]:
        payload["email"] = auth_service.normalize_email(payload["email"])
    # Privilege-escalation guards (#8). Order matters: check target privilege and
    # last-super-admin protection before mutating the record.
    is_role_update = "roles" in payload or "role" in payload
    role_management_override = is_role_update and _can_manage_any_member_role(actor)
    if not role_management_override:
        _assert_can_modify_target(actor, user)
    _assert_not_demoting_last_super_admin(db, target=user, payload=payload)
    # Keep the active role and the assigned-roles list consistent whenever either
    # one is being updated.
    if is_role_update:
        active_role, assigned_roles = _normalize_roles(
            role=payload.get("role", user.role),
            roles=payload.get("roles", user.roles or None),
        )
        payload["role"] = active_role
        payload["roles"] = assigned_roles
        # Non role-management admins cannot elevate a user above their own level.
        if not role_management_override:
            _assert_can_assign_roles(actor, assigned_roles=assigned_roles)
    for field, value in payload.items():
        setattr(user, field, value)
    if user.role != Role.CANDIDATE and user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)
    db.add(user)
    log_audit(db, entity_type="user", entity_id=user.id, action="user_updated", actor=actor, user_id=user.id)
    return user


def reset_user_password(db: Session, *, user: User, new_password: str, actor: User) -> User:
    _assert_can_modify_target(actor, user)
    user.password_hash = hash_password(new_password)
    user.must_change_password = True
    user.refresh_token_hash = None
    user.token_version = (user.token_version or 0) + 1
    db.add(user)
    log_audit(
        db,
        entity_type="user",
        entity_id=user.id,
        action="user_password_reset",
        actor=actor,
        user_id=user.id,
    )
    db.flush()
    return user


def list_settings(db: Session, *, namespace: str | None = None) -> list[AdminSetting]:
    query = select(AdminSetting).order_by(AdminSetting.namespace.asc(), AdminSetting.key.asc())
    if namespace:
        query = query.where(AdminSetting.namespace == namespace)
    return list(db.scalars(query))


def upsert_setting(db: Session, *, payload: dict, actor: User) -> AdminSetting:
    record = db.scalar(select(AdminSetting).where(AdminSetting.key == payload["key"]))
    if record is None:
        record = AdminSetting(**payload, updated_by=actor.id)
        db.add(record)
    else:
        record.namespace = payload.get("namespace", record.namespace)
        record.value = payload["value"]
        record.description = payload.get("description")
        record.updated_by = actor.id
        db.add(record)
    db.flush()
    log_audit(db, entity_type="admin_setting", entity_id=record.id, action="setting_upserted", actor=actor)
    return record


# ── Role → module access ──────────────────────────────────────────────────────
# Stored in AdminSetting (namespace "role_modules", key "role_modules:<role>",
# value {"enabled": [moduleKeys]}). Absent setting = all modules enabled (default).

_ROLE_MODULES_NAMESPACE = "role_modules"


def _role_modules_key(role: str) -> str:
    return f"{_ROLE_MODULES_NAMESPACE}:{role}"


def has_role_module_config(db: Session, role: str) -> bool:
    """True if an admin has explicitly saved a module config for this role."""
    return db.scalar(select(AdminSetting.id).where(AdminSetting.key == _role_modules_key(role))) is not None


def get_enabled_modules_for_role(db: Session, role: str) -> set[str]:
    """Saved config if present, else the role's nav-derived default set."""
    from app.core.modules import ALL_MODULE_KEYS, default_modules_for_role

    record = db.scalar(select(AdminSetting).where(AdminSetting.key == _role_modules_key(role)))
    if record is None or not isinstance(record.value, dict) or not isinstance(record.value.get("enabled"), list):
        return set(default_modules_for_role(role))
    enabled = set(record.value["enabled"])
    if "assessments" in enabled or "assessment_templates" in enabled:
        enabled.discard("assessments")
        enabled.discard("assessment_templates")
        enabled.add("assessment_platform")
    return {module for module in enabled if module in ALL_MODULE_KEYS}


def get_all_role_modules(db: Session) -> dict[str, list[str]]:
    from app.core.modules import ALL_MODULE_KEYS, default_modules_for_role

    rows = list(db.scalars(select(AdminSetting).where(AdminSetting.namespace == _ROLE_MODULES_NAMESPACE)))
    valid_keys = set(ALL_MODULE_KEYS)

    def _clean_enabled(enabled: list[str]) -> list[str]:
        values = set(enabled)
        if "assessments" in values or "assessment_templates" in values:
            values.discard("assessments")
            values.discard("assessment_templates")
            values.add("assessment_platform")
        return sorted(value for value in values if value in valid_keys)

    configured = {
        r.key.split(":", 1)[1]: _clean_enabled(list(r.value["enabled"]))
        for r in rows
        if isinstance(r.value, dict) and isinstance(r.value.get("enabled"), list) and ":" in r.key
    }
    # Roles without an explicit config default to their nav-derived module set.
    return {str(role): configured.get(str(role), default_modules_for_role(str(role))) for role in Role}


def set_enabled_modules_for_role(db: Session, *, role: str, modules: list[str], actor: User) -> AdminSetting:
    from app.core.modules import ALL_MODULE_KEYS

    valid = [m for m in modules if m in ALL_MODULE_KEYS]
    record = db.scalar(select(AdminSetting).where(AdminSetting.key == _role_modules_key(role)))
    if record is None:
        record = AdminSetting(
            namespace=_ROLE_MODULES_NAMESPACE,
            key=_role_modules_key(role),
            value={"enabled": valid},
            updated_by=actor.id,
        )
        db.add(record)
    else:
        record.value = {"enabled": valid}
        record.updated_by = actor.id
        db.add(record)
    db.flush()
    log_audit(
        db, entity_type="role_modules", entity_id=record.id, action="role_modules_updated", actor=actor,
        new_value={"role": role, "enabled": valid},
    )
    return record


# ── Per-user (ID-based) module overrides ──────────────────────────────────────
# Stored in AdminSetting (key "user_modules:<user_id>", value {"enabled":[keys]}).
# A user override RESTRICTS that individual within their role; it never grants access
# beyond the role's API permissions (require_permissions still applies).
_USER_MODULES_NAMESPACE = "user_modules"


def _user_modules_key(user_id: str) -> str:
    return f"{_USER_MODULES_NAMESPACE}:{user_id}"


def get_user_module_override(db: Session, user_id: str) -> set[str] | None:
    record = db.scalar(select(AdminSetting).where(AdminSetting.key == _user_modules_key(user_id)))
    if record is None or not isinstance(record.value, dict) or not isinstance(record.value.get("enabled"), list):
        return None
    return set(record.value["enabled"])


def get_enabled_modules_for_user(db: Session, user: User) -> set[str]:
    """Effective modules for a specific user: per-user override if set, else all roles."""
    from app.core.modules import ALL_MODULE_KEYS, FULL_ACCESS_ROLES

    override = get_user_module_override(db, user.id)
    if override is not None:
        return override
    roles = list(dict.fromkeys(
        role for role in ([str(user.role)] + [str(item) for item in (user.roles or [])]) if role
    ))
    if any(role in FULL_ACCESS_ROLES for role in roles):
        return set(ALL_MODULE_KEYS)
    enabled: set[str] = set()
    for role in roles:
        enabled.update(get_enabled_modules_for_role(db, role))
    return enabled


def has_user_module_config(db: Session, user_id: str) -> bool:
    return db.scalar(select(AdminSetting.id).where(AdminSetting.key == _user_modules_key(user_id))) is not None


def set_enabled_modules_for_user(db: Session, *, user_id: str, modules: list[str], actor: User) -> AdminSetting:
    from app.core.modules import ALL_MODULE_KEYS

    valid = [m for m in modules if m in ALL_MODULE_KEYS]
    record = db.scalar(select(AdminSetting).where(AdminSetting.key == _user_modules_key(user_id)))
    if record is None:
        record = AdminSetting(
            namespace=_USER_MODULES_NAMESPACE, key=_user_modules_key(user_id),
            value={"enabled": valid}, updated_by=actor.id,
        )
        db.add(record)
    else:
        record.value = {"enabled": valid}
        record.updated_by = actor.id
        db.add(record)
    db.flush()
    log_audit(
        db, entity_type="user_modules", entity_id=record.id, action="user_modules_updated", actor=actor,
        user_id=user_id, new_value={"enabled": valid},
    )
    return record


def clear_user_module_override(db: Session, *, user_id: str, actor: User) -> None:
    record = db.scalar(select(AdminSetting).where(AdminSetting.key == _user_modules_key(user_id)))
    if record is not None:
        db.delete(record)
        db.flush()
        log_audit(db, entity_type="user_modules", entity_id=user_id, action="user_modules_cleared", actor=actor, user_id=user_id)
