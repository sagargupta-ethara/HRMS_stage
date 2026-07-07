from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_from_token
from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.db.models import Role, User
from app.schemas.auth import (
    AuthCodeRequest,
    AuthCodeResponse,
    ChangePasswordOtpConfirmRequest,
    ChangePasswordRequest,
    EmailVerificationConfirmRequest,
    LoginRequest,
    PasswordResetConfirmRequest,
    PublicEmailVerificationConfirmRequest,
    SwitchRoleRequest,
)
from app.services import account_security
from app.services import auth as auth_service
from app.services.audit import log_audit
from app.services.event_log import log_event, request_context


router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    is_prod = settings.app_env == "production"
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=is_prod,
        samesite="lax",
        max_age=settings.jwt_refresh_expires_in_days * 24 * 60 * 60,
        path="/api/v1/auth",
    )


@router.post("/login")
@limiter.limit("10/minute")
def login(
    request: Request,
    payload: LoginRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    normalized_email = auth_service.normalize_email(payload.email)
    try:
        session = auth_service.login(db, email=payload.email, password=payload.password)
    except HTTPException as exc:
        log_event(
            "auth",
            "login_failed",
            email=normalized_email,
            statusCode=exc.status_code,
            detail=exc.detail,
            **request_context(request),
        )
        # Persist the failed-login bookkeeping (failed_login_count / locked_until,
        # see authenticate_user #17); the success path commits, so the failure path
        # must too or the increment is rolled back when the session closes.
        try:
            db.commit()
        except Exception:
            db.rollback()
        raise
    except Exception as exc:
        log_event(
            "auth",
            "login_error",
            email=normalized_email,
            error=type(exc).__name__,
            **request_context(request),
        )
        raise
    log_audit(
        db,
        entity_type="user",
        entity_id=session.user.id,
        action="user_login",
        actor=session.user,
        request=request,
        user_id=session.user.id,
        new_value={"email": session.user.email, "role": session.user.role.value},
    )
    log_event(
        "auth",
        "login_success",
        userId=session.user.id,
        email=session.user.email,
        role=session.user.role.value,
        **request_context(request),
    )
    db.commit()
    _set_refresh_cookie(response, session.refresh_token)
    return auth_service.auth_payload(db, user=session.user, access_token=session.access_token)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    log_audit(
        db,
        entity_type="user",
        entity_id=current_user.id,
        action="user_logout",
        actor=current_user,
        request=request,
        user_id=current_user.id,
    )
    log_event(
        "auth",
        "logout",
        userId=current_user.id,
        email=current_user.email,
        role=current_user.role.value,
        **request_context(request),
    )
    auth_service.logout(db, user=current_user)
    db.commit()
    response.delete_cookie("refresh_token", path="/api/v1/auth")
    return {"message": "Logged out successfully"}


@router.post("/refresh")
@limiter.limit("30/minute")
def refresh(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    refresh_token: str | None = Cookie(default=None, alias="refresh_token"),
) -> dict:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    settings = get_settings()
    user = get_current_user_from_token(db, refresh_token, secret=settings.jwt_refresh_secret)
    session = auth_service.refresh_session(db, user=user, refresh_token=refresh_token)
    db.commit()
    _set_refresh_cookie(response, session.refresh_token)
    return {"accessToken": session.access_token}


@router.get("/me")
def me(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    return auth_service.auth_payload(db, user=current_user)


@router.post("/me/switch-role")
def switch_role(
    payload: SwitchRoleRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    target = payload.role
    assigned = current_user.roles or [current_user.role.value]
    if target.value not in assigned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to that role.",
        )
    previous_role = current_user.role
    if previous_role != target:
        current_user.role = target
        db.add(current_user)
        log_audit(
            db,
            entity_type="user",
            entity_id=current_user.id,
            action="user_role_switched",
            actor=current_user,
            request=request,
            user_id=current_user.id,
            old_value={"role": previous_role.value},
            new_value={"role": target.value},
        )
        db.commit()
        db.refresh(current_user)
    return auth_service.auth_payload(db, user=current_user)


@router.post("/password-reset/request", response_model=AuthCodeResponse)
@limiter.limit("5/minute")
def request_password_reset(
    request: Request,
    payload: AuthCodeRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    result = account_security.request_password_reset(db, email=payload.email)
    db.commit()
    return {
        "message": result.message,
        "developmentCode": result.development_code,
        "expiresAt": result.expires_at,
    }


@router.post("/password-reset/confirm")
@limiter.limit("5/minute")
def confirm_password_reset(
    request: Request,
    payload: PasswordResetConfirmRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    account_security.confirm_password_reset(
        db,
        email=payload.email,
        code=payload.code,
        new_password=payload.new_password,
    )
    db.commit()
    return {"message": "Password reset successful. You can now sign in with your new password."}


@router.post("/email-verification/request", response_model=AuthCodeResponse)
@limiter.limit("5/minute")
def request_email_verification(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    result = account_security.request_email_verification(db, user=current_user)
    db.commit()
    return {
        "message": result.message,
        "developmentCode": result.development_code,
        "expiresAt": result.expires_at,
    }


@router.post("/email-verification/confirm")
@limiter.limit("10/minute")
def confirm_email_verification(
    request: Request,
    payload: EmailVerificationConfirmRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    updated = account_security.confirm_email_verification(db, user=current_user, code=payload.code)
    db.commit()
    db.refresh(updated)
    return {
        "message": "Email verified successfully.",
        "user": auth_service.user_to_dict(updated),
        "profile": auth_service.resolve_profile(db, user=updated),
    }


# ── Public (unauthenticated) OTP endpoints for post-registration flow ─────────


@router.post("/change-password")
@limiter.limit("5/minute")
def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    from app.core.security import hash_password, verify_password
    if not verify_password(payload.old_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    current_user.password_hash = hash_password(payload.new_password)
    current_user.must_change_password = False
    # Align with the reset path (#42): invalidate the stored refresh token and
    # revoke outstanding access tokens (#16) so old sessions can't continue.
    current_user.refresh_token_hash = None
    current_user.token_version = (current_user.token_version or 0) + 1
    db.add(current_user)
    log_audit(
        db,
        entity_type="user",
        entity_id=current_user.id,
        action="password_changed",
        actor=current_user,
        request=request,
        user_id=current_user.id,
    )
    session = auth_service.create_auth_session(db, current_user)
    db.commit()
    _set_refresh_cookie(response, session.refresh_token)
    return {
        "message": "Password changed successfully.",
        **auth_service.auth_payload(db, user=session.user, access_token=session.access_token),
    }


@router.post("/email-verification/request-public", response_model=AuthCodeResponse)
@limiter.limit("5/minute")
def request_email_verification_public(
    request: Request,
    payload: AuthCodeRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Resend verification OTP without authentication. Used after candidate registration."""
    result = account_security.request_email_verification_by_email(db, email=payload.email)
    db.commit()
    return {
        "message": result.message,
        "developmentCode": result.development_code,
        "expiresAt": result.expires_at,
    }


@router.post("/email-verification/confirm-public")
@limiter.limit("10/minute")
def confirm_email_verification_public(
    request: Request,
    payload: PublicEmailVerificationConfirmRequest,
    db: Annotated[Session, Depends(get_db)],
    response: Response,
) -> dict:
    """Verify OTP and activate account. Returns access token on success."""
    updated = account_security.confirm_email_verification_by_email(
        db, email=payload.email, code=payload.code
    )
    session = auth_service.create_auth_session(db, updated)
    db.commit()
    _set_refresh_cookie(response, session.refresh_token)
    return {
        "message": "Email verified successfully. Welcome aboard!",
        **auth_service.auth_payload(db, user=session.user, access_token=session.access_token),
    }


from pydantic import BaseModel as _BaseModel

class _UpdateProfileRequest(_BaseModel):
    name: str | None = None
    phone: str | None = None


@router.patch("/me/profile")
def update_profile(
    payload: _UpdateProfileRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    request: Request,
) -> dict:
    changed = False
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name cannot be empty.")
        current_user.name = name
        changed = True
    if payload.phone is not None:
        current_user.phone = payload.phone.strip() or None
        changed = True
    if changed:
        db.add(current_user)
        log_audit(
            db,
            entity_type="user",
            entity_id=current_user.id,
            action="profile_updated",
            actor=current_user,
            request=request,
            user_id=current_user.id,
        )
        db.commit()
        db.refresh(current_user)
    return auth_service.auth_payload(db, user=current_user)


@router.post("/change-password-otp/request", response_model=AuthCodeResponse)
@limiter.limit("5/minute")
def request_change_password_otp(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    from app.db.models import AuthCodePurpose
    result = account_security._create_auth_code(
        db,
        email=current_user.email,
        purpose=AuthCodePurpose.PASSWORD_RESET,
        user=current_user,
    )
    log_audit(
        db,
        entity_type="user",
        entity_id=current_user.id,
        action="change_password_otp_requested",
        actor=current_user,
        request=request,
        user_id=current_user.id,
    )
    db.commit()
    return {
        "message": result.message,
        "developmentCode": result.development_code,
        "expiresAt": result.expires_at,
    }


@router.post("/change-password-otp/confirm")
@limiter.limit("5/minute")
def confirm_change_password_otp(
    request: Request,
    payload: ChangePasswordOtpConfirmRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    from app.db.models import AuthCodePurpose
    from app.core.security import hash_password
    account_security._consume_valid_code(
        db,
        email=current_user.email,
        purpose=AuthCodePurpose.PASSWORD_RESET,
        code=payload.code,
    )
    current_user.password_hash = hash_password(payload.new_password)
    current_user.must_change_password = False
    current_user.refresh_token_hash = None
    # Revoke outstanding access tokens after an OTP-confirmed password change (#16).
    current_user.token_version = (current_user.token_version or 0) + 1
    db.add(current_user)
    log_audit(
        db,
        entity_type="user",
        entity_id=current_user.id,
        action="password_changed_via_otp",
        actor=current_user,
        request=request,
        user_id=current_user.id,
    )
    session = auth_service.create_auth_session(db, current_user)
    db.commit()
    _set_refresh_cookie(response, session.refresh_token)
    return {
        "message": "Password changed successfully.",
        **auth_service.auth_payload(db, user=session.user, access_token=session.access_token),
    }
