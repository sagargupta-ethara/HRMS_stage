import logging
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import Permission, permissions_for_role
from app.core.security import decode_token
from app.db.models import Role, User


bearer_scheme = HTTPBearer(auto_error=False)

# Endpoints a user with a pending forced password change may still reach.
_PASSWORD_CHANGE_ALLOWED_SUFFIXES = (
    "/auth/change-password",
    "/auth/change-password-otp/request",
    "/auth/change-password-otp/confirm",
    "/auth/logout",
    "/auth/me",
    "/auth/refresh",
)
_PENDING_CANDIDATE_ALLOWED_SUFFIXES = ("/auth/logout",)


def role_value(role: Role | str | None) -> str:
    if role is None:
        return ""
    return role.value if isinstance(role, Role) else str(role)


def user_role_values(user: User) -> set[str]:
    return {role_value(user.role)} | {role_value(role) for role in (user.roles or [])}


def user_has_any_role(
    user: User,
    roles: set[Role] | set[str] | tuple[Role | str, ...] | list[Role | str],
) -> bool:
    allowed = {role_value(role) for role in roles}
    return bool(user_role_values(user) & allowed)


def _resolve_permissions(user: User) -> set[str]:
    # A user may hold several roles (e.g. an employee who is ALSO HR). Grant the
    # UNION of every role's permissions — otherwise a secondary role (HR added on
    # top of a primary "employee") would be ignored and the user gets 403s on
    # actions that role should allow (e.g. the employee CSV export).
    role_values = [user.role] + list(user.roles or [])
    base_permissions: set[str] = set()
    for role_value in role_values:
        try:
            role_enum = role_value if isinstance(role_value, Role) else Role(str(role_value))
        except ValueError:
            continue
        base_permissions |= {permission.value for permission in permissions_for_role(role_enum)}
    base_permissions.update(user.permission_overrides or [])
    return base_permissions


def _resolve_bearer_user(
    request: Request,
    db: Session,
    credentials: HTTPAuthorizationCredentials | None,
) -> tuple[User | None, HTTPException | None]:
    """Decode the bearer token and load the user ONCE per request.

    The result (user OR the auth error to raise) is cached on ``request.state`` so
    every caller in the same request — ``get_current_user`` AND the module-access
    gate — reuses it. This is why the module gate no longer re-decodes the token or
    opens its own DB session. Never raises; callers that require auth raise the
    returned error when ``user`` is None.
    """
    if getattr(request.state, "_bearer_resolved", False):
        return request.state._bearer_user, request.state._bearer_error

    user: User | None = None
    error: HTTPException | None = None
    if credentials is None:
        error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    else:
        try:
            payload = decode_token(credentials.credentials, secret=get_settings().jwt_secret)
            if payload.get("type") != "access":
                error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
            else:
                candidate = db.scalar(select(User).where(User.id == payload["sub"]))
                if candidate is None or not candidate.is_active:
                    error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")
                # Access-token revocation: reject tokens whose embedded version no longer
                # matches the live value (bumped on logout / password change / reset). A
                # MISSING "tv" claim defaults to the user's current version so pre-existing
                # tokens issued before this feature still validate (no forced logout on deploy).
                elif payload.get("tv", candidate.token_version) != candidate.token_version:
                    error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")
                else:
                    user = candidate
        except HTTPException as exc:
            # decode_token raises 401 "Invalid or expired token" on a bad/expired JWT.
            error = exc

    request.state._bearer_user = user
    request.state._bearer_error = error
    request.state._bearer_resolved = True
    return user, error


def get_current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User:
    user, error = _resolve_bearer_user(request, db, credentials)
    if user is None:
        raise error  # type: ignore[misc]  # error is always set when user is None

    # Enforce a pending forced password change server-side. Scoped to staff /
    # employee accounts (candidates use a separate portal flow) and allows the
    # password-change, logout and identity endpoints through so the user can
    # actually resolve it.
    if user.must_change_password and user.role != Role.CANDIDATE:
        path = request.url.path
        if not any(path.endswith(suffix) for suffix in _PASSWORD_CHANGE_ALLOWED_SUFFIXES):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password change required. Please update your temporary password before continuing.",
            )

    if user.role != Role.CANDIDATE:
        from app.services import employees as employee_service

        pending_candidate = employee_service.pending_candidate_onboarding_for_employee_user(db, user=user)
        if pending_candidate is not None and not any(
            request.url.path.endswith(suffix) for suffix in _PENDING_CANDIDATE_ALLOWED_SUFFIXES
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Candidate onboarding pending. Please complete candidate onboarding before using employee login.",
            )
    return user


def enforce_module_access(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> None:
    """Block API calls to modules an admin has disabled for the caller's role.

    Runs as a router-level dependency (NOT a BaseHTTPMiddleware) so it reuses the
    request's already-resolved auth context and DB session — no second token decode,
    no second ``SessionLocal()`` (the old middleware's per-request session was a
    pool-pressure / fail-closed source). This is a SOFT visibility layer: the
    authoritative gate is each route's own ``require_permissions``. It therefore
    fails OPEN on any unexpected error and never gates unauthenticated requests
    (the route's own auth returns 401); it only returns a 403 when it has positively
    determined the module is disabled for every one of the caller's roles.
    """
    from app.core.modules import FULL_ACCESS_ROLES, module_for_path

    settings = get_settings()
    # Resolve the path→module first; non-gated paths skip auth/DB work entirely.
    module = module_for_path(request.url.path, settings.api_prefix)
    if module is None:
        return

    user, _ = _resolve_bearer_user(request, db, credentials)
    if user is None:
        return  # unauthenticated/invalid → let the route's own auth return 401

    roles = user_role_values(user)
    if any(r in FULL_ACCESS_ROLES for r in roles):
        return

    denied = HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This module is not enabled for your role.",
    )
    try:
        from app.services.reference_data import (
            get_enabled_modules_for_role,
            get_user_module_override,
            has_role_module_config,
        )

        # A per-user override RESTRICTS the individual within their role.
        override = get_user_module_override(db, user.id)
        if override is not None:
            if module in override:
                return
            raise denied
        # Allow if ANY of the caller's roles grants the module. A role with no saved
        # config is fail-open (enforcement is opt-in per role).
        for role in roles:
            if not has_role_module_config(db, role):
                return
            if module in get_enabled_modules_for_role(db, role):
                return
        raise denied
    except HTTPException:
        raise
    except Exception:
        logging.getLogger("module_access").exception(
            "module-access resolution errored for path=%s — failing open", request.url.path,
        )
        return  # fail open — route-level require_permissions remains the real gate


def get_current_user_from_token(
    db: Session,
    token: str,
    *,
    secret: str,
) -> User:
    payload = decode_token(token, secret=secret)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user = db.scalar(select(User).where(User.id == payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")
    if user.role != Role.CANDIDATE:
        from app.services import employees as employee_service

        if employee_service.pending_candidate_onboarding_for_employee_user(db, user=user) is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Candidate onboarding pending. Please complete candidate onboarding before using employee login.",
            )
    return user


def require_permissions(*permissions: Permission) -> Callable[[User], User]:
    def dependency(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        granted = _resolve_permissions(current_user)
        missing = [permission.value for permission in permissions if permission.value not in granted]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(missing)}",
            )
        return current_user

    return dependency


def require_roles(*roles: Role | str) -> Callable[[User], User]:
    """Dependency: allow only callers holding (any of) the given roles.

    Mirrors ``require_permissions`` but gates on role membership — used by
    features whose access is role-scoped rather than permission-scoped
    (e.g. the Employee Evaluation module).
    """
    allowed = {role_value(role) for role in roles}

    def dependency(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if not (user_role_values(current_user) & allowed):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This section is not available for your role.",
            )
        return current_user

    return dependency


def get_request_meta(request: Request) -> dict[str, str | None]:
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }
