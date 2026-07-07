import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.permissions import permissions_for_role
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_token,
    verify_password,
    verify_token_hash,
)
from app.db.models import ApAssignment, ApAttempt, Candidate, Role, SourceType, User
from app.services import employees as employee_service

logger = logging.getLogger(__name__)

# Account lockout (#17): after this many consecutive failed password attempts the
# account is temporarily locked. A successful login resets the counter.
MAX_FAILED_LOGINS = 10
LOCKOUT_MINUTES = 15

# Constant-time dummy hash (#43): used to perform a throwaway bcrypt verification
# when the email is unknown so unknown-user login timing matches known-user timing
# and cannot be used for account enumeration.
_DUMMY_PASSWORD_HASH = "$2b$12$a5TrLUQoZMOub9SRf7zzhusCTg3TNETqiglSh9Evz7.hkElrBNzKq"


@dataclass
class AuthSession:
    access_token: str
    refresh_token: str
    user: User


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalized_user_query(email: str):
    return select(User).where(func.lower(func.trim(User.email)) == normalize_email(email))


def _normalize_user_record(user: User | None, *, normalized_email: str) -> User | None:
    if user is not None and user.email != normalized_email:
        user.email = normalized_email
    return user


def _verify_password_safely(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return verify_password(password, password_hash)
    except Exception:
        logger.warning("Encountered invalid stored password hash during login verification.")
        return False


def user_permissions(user: User) -> list[str]:
    role_values = [user.role] + list(user.roles or [])
    permissions: set[str] = set()
    for role_value in role_values:
        try:
            role = role_value if isinstance(role_value, Role) else Role(str(role_value))
        except ValueError:
            continue
        permissions.update(permission.value for permission in permissions_for_role(role))
    permissions.update(user.permission_overrides or [])
    return sorted(permissions)


def _role_value(value: Role | str) -> str:
    return value.value if isinstance(value, Role) else str(value)


def _user_role_values(user: User) -> set[str]:
    return {_role_value(user.role)} | {_role_value(role) for role in (user.roles or [])}


def user_to_dict(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "roles": user.roles or [user.role],
        "phone": user.phone,
        "isActive": user.is_active,
        "mustChangePassword": user.must_change_password,
        "emailVerified": bool(user.email_verified_at),
        "emailVerifiedAt": user.email_verified_at,
        "lastLoginAt": user.last_login_at,
        "createdAt": user.created_at,
        "updatedAt": user.updated_at,
        "permissions": user_permissions(user),
    }


def resolve_profile(db: Session, *, user: User) -> dict | None:
    user_roles = _user_role_values(user)
    if user_roles & {Role.EMPLOYEE.value, Role.EMPLOYEE_REFERRER.value}:
        profile = employee_service.get_employee_profile_for_user(db, user)
        data = employee_service.serialize_employee_profile(profile)
        if data is not None:
            # Expose the avatar photo endpoint so the global top-bar/profile avatar
            # can render the uploaded photo (not just initials).
            data["profilePhotoEndpoint"] = employee_service.get_profile_photo_endpoint(db, profile)
        return data

    if Role.CANDIDATE.value in user_roles:
        candidate = db.scalar(
            select(Candidate)
            .where(
                (Candidate.portal_user_id == user.id)
                | (func.lower(func.trim(Candidate.personal_email)) == normalize_email(user.email))
            )
            .order_by(Candidate.created_at.desc())
        )
        if candidate is None:
            return None
        campus_lock = candidate.source_type == SourceType.CAMPUS_HIRE and not candidate.resume_url
        campus_assessment_passed = False
        if campus_lock:
            campus_assessment_passed = db.scalar(
                select(ApAttempt.id)
                .join(ApAssignment, ApAttempt.assignment_id == ApAssignment.id)
                .where(
                    ApAssignment.user_id == user.id,
                    ApAttempt.result_status == "pass",
                    ApAttempt.result_released_at.isnot(None),
                )
                .limit(1)
            ) is not None
        return {
            "type": "candidate",
            "id": candidate.id,
            "candidateCode": candidate.candidate_code,
            "fullName": candidate.full_name,
            "personalEmail": candidate.personal_email,
            "etharaEmail": candidate.ethara_email,
            "currentStage": candidate.current_stage.value,
            "currentStatus": candidate.current_status,
            # Campus-drive registrants are locked to the assessment-only view (no
            # sidebar / other portal modules) until they pass and complete the full
            # registration. resume_url is the same "already completed" marker that
            # notify_campus_pass uses.
            "campusLock": campus_lock,
            "campusAssessmentPassed": campus_assessment_passed,
            "campusNextRoute": (
                "/candidate/complete-registration"
                if campus_assessment_passed
                else "/portal/my-assessments"
            ) if campus_lock else None,
        }

    if Role.VENDOR.value in user_roles and user.vendor is not None:
        return {
            "type": "vendor",
            "id": user.vendor.id,
            "name": user.vendor.name,
            "contactEmail": user.vendor.contact_email,
            "contactPhone": user.vendor.contact_phone,
        }

    return None


def resolve_profile_photo_endpoint(db: Session, *, user: User) -> str | None:
    profile = employee_service.get_employee_profile_for_user(db, user)
    return employee_service.get_profile_photo_endpoint(db, profile)


def auth_payload(db: Session, *, user: User, access_token: str | None = None) -> dict:
    profile = resolve_profile(db, user=user)
    if profile and profile.get("type") == "employee":
        profile_photo_endpoint = profile.get("profilePhotoEndpoint")
    else:
        profile_photo_endpoint = resolve_profile_photo_endpoint(db, user=user)

    user_data = user_to_dict(user)
    user_data["profilePhotoEndpoint"] = profile_photo_endpoint

    payload = {
        "user": user_data,
        "profile": profile,
    }
    if access_token is not None:
        payload["accessToken"] = access_token
    return payload


def authenticate_user(db: Session, *, email: str, password: str) -> User:
    normalized_email = normalize_email(email)
    employee_service.repair_employee_auth_record_for_login(db, email=normalized_email)
    user = _normalize_user_record(
        db.scalar(_normalized_user_query(normalized_email).with_for_update()),
        normalized_email=normalized_email,
    )
    if user is None:
        # User-enumeration timing defence (#43): perform an equivalent dummy bcrypt
        # verification so the response time for an unknown email matches that of a
        # known email with a wrong password.
        _verify_password_safely(password, _DUMMY_PASSWORD_HASH)
        logger.warning("Failed login attempt for unknown email: %s", normalized_email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Account lockout (#17): block while a lock is active, before checking the
    # password, so repeated guessing on a locked account does nothing.
    if user.locked_until is not None and _ensure_utc(user.locked_until) > datetime.now(UTC):
        logger.warning("Login attempt on temporarily locked account: %s", normalized_email)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account temporarily locked due to repeated failed login attempts. Please try again later.",
        )

    if not user.is_active:
        logger.warning("Failed login attempt for inactive user: %s", normalized_email)
        # Surface a clear prompt so the frontend can show the OTP verification UI
        # instead of a generic "invalid credentials" message.
        if not user.email_verified_at:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="EMAIL_NOT_VERIFIED")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not _verify_password_safely(password, user.password_hash):
        _register_failed_login(db, user=user)
        logger.warning("Failed login attempt due to password mismatch: %s", normalized_email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    # Active legacy employee accounts may predate email-verification fields but
    # have a valid registration audit/profile. Repair only after the password is
    # verified; inactive new registrations still return EMAIL_NOT_VERIFIED above.
    employee_service.post_login_sync_employee(db, user=user)
    pending_candidate = employee_service.pending_candidate_onboarding_for_employee_user(db, user=user)
    if pending_candidate is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Candidate onboarding pending. Please complete candidate onboarding before using employee login.",
        )
    if not user.email_verified_at:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="EMAIL_NOT_VERIFIED",
        )
    # Successful authentication: clear any failed-attempt bookkeeping.
    if user.failed_login_count or user.locked_until is not None:
        user.failed_login_count = 0
        user.locked_until = None
        db.add(user)
    return user


def _ensure_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _register_failed_login(db: Session, *, user: User) -> None:
    """Increment the failed-attempt counter and lock the account once it crosses
    the threshold (#17)."""
    user.failed_login_count = (user.failed_login_count or 0) + 1
    if user.failed_login_count >= MAX_FAILED_LOGINS:
        user.locked_until = datetime.now(UTC) + timedelta(minutes=LOCKOUT_MINUTES)
    db.add(user)
    db.flush()


def create_auth_session(db: Session, user: User) -> AuthSession:
    access_token = create_access_token(
        user.id, email=user.email, role=user.role.value, tv=user.token_version or 0
    )
    refresh_token = create_refresh_token(user.id, email=user.email, role=user.role.value)
    user.refresh_token_hash = hash_token(refresh_token)
    user.last_login_at = datetime.now(UTC)
    db.add(user)
    db.flush()
    return AuthSession(access_token=access_token, refresh_token=refresh_token, user=user)


def login(db: Session, *, email: str, password: str) -> AuthSession:
    user = authenticate_user(db, email=email, password=password)
    return create_auth_session(db, user)


def logout(db: Session, *, user: User) -> None:
    user.refresh_token_hash = None
    # Revoke any outstanding access tokens (#16) by bumping the token version.
    user.token_version = (user.token_version or 0) + 1
    db.add(user)
    db.flush()


def refresh_session(db: Session, *, user: User, refresh_token: str) -> AuthSession:
    locked_user = db.scalar(select(User).where(User.id == user.id).with_for_update())
    if locked_user is None or not locked_user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")
    if not locked_user.refresh_token_hash or not verify_token_hash(refresh_token, locked_user.refresh_token_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    return create_auth_session(db, locked_user)
