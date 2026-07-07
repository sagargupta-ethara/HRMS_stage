from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from secrets import randbelow

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import fingerprint_identifier, hash_password
from app.db.models import AuthCode, AuthCodePurpose, User
from app.services.auth import normalize_email
from app.services.integrations import EmailService

OTP_TTL_MINUTES = 10
# Max wrong guesses against a single OTP before it is invalidated (#46).
MAX_OTP_ATTEMPTS = 5
# Cumulative cap on wrong guesses for one account per rolling hour, across ALL codes — so
# requesting fresh codes can't multiply the per-code guess budget into a feasible brute force.
MAX_OTP_FAILURES_PER_HOUR = 10
# Per-account anti-bombing cap: max verification/reset codes issued to a single
# email (per purpose) within the rolling window, on top of the per-IP rate limit.
MAX_CODE_REQUESTS_PER_HOUR = 5


@dataclass
class CodeDispatchResult:
    message: str
    development_code: str | None = None
    expires_at: datetime | None = None


def _build_code_hash(*, email: str, purpose: AuthCodePurpose, code: str) -> str:
    return fingerprint_identifier(f"{normalize_email(email)}:{purpose.value}:{code}")


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _development_code(code: str) -> str | None:
    settings = get_settings()
    if settings.is_development and settings.email_backend == "console":
        return code
    return None


def _generate_otp() -> str:
    return f"{randbelow(1_000_000):06d}"


def _send_auth_code_email(*, email: str, purpose: AuthCodePurpose, code: str) -> None:
    subject = (
        "Verify your Ethara candidate account"
        if purpose == AuthCodePurpose.EMAIL_VERIFICATION
        else "Reset your Ethara password"
    )
    body_text = (
        f"Your verification code is: {code}\n\n"
        f"This code expires in {OTP_TTL_MINUTES} minutes.\n\n"
        "If you did not request this, you can safely ignore this email."
    )
    body_html = (
        f"<p>Your one-time verification code is:</p>"
        f"<h2 style='letter-spacing:8px;font-size:32px;font-family:monospace'>{code}</h2>"
        f"<p>This code expires in <strong>{OTP_TTL_MINUTES} minutes</strong>.</p>"
        f"<p style='color:#888;font-size:12px'>If you did not request this, ignore this email.</p>"
    )
    try:
        EmailService().send_email(
            to_email=email,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


def _create_auth_code(
    db: Session,
    *,
    email: str,
    purpose: AuthCodePurpose,
    user: User | None,
) -> CodeDispatchResult:
    normalized = normalize_email(email)
    now = datetime.now(UTC)

    # Per-account throttle (anti-bombing): cap how many codes a single email can be
    # issued per hour, independent of the per-IP limit. Counts created_at history,
    # so prior codes are invalidated by marking them consumed (below), not deleted.
    recent_count = db.scalar(
        select(func.count())
        .select_from(AuthCode)
        .where(
            func.lower(AuthCode.email) == normalized,
            AuthCode.purpose == purpose,
            AuthCode.created_at >= now - timedelta(hours=1),
        )
    ) or 0
    if recent_count >= MAX_CODE_REQUESTS_PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification codes requested for this account. Please try again later.",
        )

    code = _generate_otp()
    expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)

    # Invalidate any still-active code for this email+purpose (latest code wins),
    # keeping the row so the per-account throttle above can see the full history.
    db.execute(
        update(AuthCode)
        .where(
            func.lower(AuthCode.email) == normalized,
            AuthCode.purpose == purpose,
            AuthCode.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    db.add(
        AuthCode(
            user_id=user.id if user else None,
            email=normalized,
            purpose=purpose,
            code_hash=_build_code_hash(email=normalized, purpose=purpose, code=code),
            expires_at=expires_at,
        )
    )
    _send_auth_code_email(email=normalized, purpose=purpose, code=code)
    return CodeDispatchResult(
        message="A verification code has been sent to your email address.",
        development_code=_development_code(code),
        expires_at=expires_at,
    )


def _resolve_user_or_404(db: Session, *, email: str) -> User:
    user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == normalize_email(email)))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _consume_valid_code(
    db: Session,
    *,
    email: str,
    purpose: AuthCodePurpose,
    code: str,
) -> AuthCode:
    normalized = normalize_email(email)
    now = datetime.now(UTC)
    # Cumulative brute-force cap: total wrong guesses for this email+purpose over the last
    # hour (summed across every code) must stay under the limit, independent of how many
    # fresh codes were requested.
    recent_failures = db.scalar(
        select(func.coalesce(func.sum(AuthCode.attempt_count), 0)).where(
            func.lower(AuthCode.email) == normalized,
            AuthCode.purpose == purpose,
            AuthCode.created_at >= now - timedelta(hours=1),
        )
    ) or 0
    if recent_failures >= MAX_OTP_FAILURES_PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts for this account. Please try again later.",
        )
    record = db.scalar(
        select(AuthCode)
        .where(
            func.lower(AuthCode.email) == normalized,
            AuthCode.purpose == purpose,
            AuthCode.code_hash == _build_code_hash(email=normalized, purpose=purpose, code=code),
            AuthCode.consumed_at.is_(None),
        )
        .order_by(AuthCode.created_at.desc())
        .with_for_update()
    )
    if record is not None:
        if _ensure_utc(record.expires_at) < now:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Verification code has expired. Please request a new code.",
            )
        record.consumed_at = now
        db.add(record)
        return record

    active = db.scalar(
        select(AuthCode)
        .where(
            func.lower(AuthCode.email) == normalized,
            AuthCode.purpose == purpose,
            AuthCode.consumed_at.is_(None),
        )
        .order_by(AuthCode.created_at.desc())
        .with_for_update()
    )
    if active is not None and _ensure_utc(active.expires_at) < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please request a new code.",
        )

    # Wrong guess. Charge an attempt against the live unconsumed code for this
    # email+purpose and invalidate it once the limit is reached so it can't be
    # brute-forced further (#46).
    if active is not None:
        _register_failed_otp_attempt(db, email=normalized, purpose=purpose)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid verification code.",
    )


def _register_failed_otp_attempt(
    db: Session,
    *,
    email: str,
    purpose: AuthCodePurpose,
) -> None:
    """Increment the attempt counter on the current unconsumed code for this
    email+purpose; once attempts cross the limit, consume the code so it cannot
    be guessed again (#46)."""
    active = db.scalar(
        select(AuthCode)
        .where(
            func.lower(AuthCode.email) == email,
            AuthCode.purpose == purpose,
            AuthCode.consumed_at.is_(None),
        )
        .order_by(AuthCode.created_at.desc())
        .with_for_update()
    )
    if active is None:
        return
    active.attempt_count = (active.attempt_count or 0) + 1
    if active.attempt_count >= MAX_OTP_ATTEMPTS:
        active.consumed_at = datetime.now(UTC)
    db.add(active)
    # Persist immediately: the calling endpoint raises an HTTPException right after
    # this (the guess was wrong), so without committing here the counter would be
    # rolled back when the request's session closes — defeating the brute-force
    # protection (#46). Best-effort: never mask the original validation error.
    try:
        db.commit()
    except Exception:
        db.rollback()


def request_password_reset(db: Session, *, email: str) -> CodeDispatchResult:
    normalized = normalize_email(email)
    user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == normalized))
    if user is None or not user.is_active:
        return CodeDispatchResult(
            message="If an account exists for this email, a verification code has been sent.",
        )
    return _create_auth_code(
        db,
        email=normalized,
        purpose=AuthCodePurpose.PASSWORD_RESET,
        user=user,
    )


def confirm_password_reset(db: Session, *, email: str, code: str, new_password: str) -> User:
    user = _resolve_user_or_404(db, email=email)
    _consume_valid_code(
        db,
        email=user.email,
        purpose=AuthCodePurpose.PASSWORD_RESET,
        code=code,
    )
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.refresh_token_hash = None
    # Revoke outstanding access tokens after a password reset (#16).
    user.token_version = (user.token_version or 0) + 1
    db.add(user)
    return user


def request_email_verification(db: Session, *, user: User) -> CodeDispatchResult:
    if user.email_verified_at:
        return CodeDispatchResult(message="This email address is already verified.")
    return _create_auth_code(
        db,
        email=user.email,
        purpose=AuthCodePurpose.EMAIL_VERIFICATION,
        user=user,
    )


def request_email_verification_by_email(db: Session, *, email: str) -> CodeDispatchResult:
    """Public variant — looks up user by email, then dispatches verification OTP."""
    normalized = normalize_email(email)
    user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == normalized))
    if user is None:
        # Silently succeed to avoid email enumeration
        return CodeDispatchResult(
            message="If that email is registered, a verification code has been sent.",
        )
    if user.email_verified_at:
        return CodeDispatchResult(message="This email address is already verified.")
    return _create_auth_code(
        db,
        email=normalized,
        purpose=AuthCodePurpose.EMAIL_VERIFICATION,
        user=user,
    )


def confirm_email_verification(db: Session, *, user: User, code: str) -> User:
    if user.email_verified_at:
        return user
    _consume_valid_code(
        db,
        email=user.email,
        purpose=AuthCodePurpose.EMAIL_VERIFICATION,
        code=code,
    )
    user.email_verified_at = datetime.now(UTC)
    db.add(user)
    return user


def confirm_email_verification_by_email(db: Session, *, email: str, code: str) -> User:
    """Public variant — verifies OTP for a given email without prior authentication."""
    user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == normalize_email(email)))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.email_verified_at:
        # SECURITY: the public endpoint mints an authenticated session on whatever this
        # returns, so it must NEVER return without validating a fresh OTP. An already-verified
        # account cannot be issued a new code (see request_email_verification_by_email), so it
        # must not obtain a session here either — returning the user unchecked was an
        # unauthenticated account-takeover: anyone knowing a verified email could get a
        # session for it. Verified users sign in with their password instead.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email is already verified. Please sign in.",
        )
    _consume_valid_code(
        db,
        email=user.email,
        purpose=AuthCodePurpose.EMAIL_VERIFICATION,
        code=code,
    )
    user.email_verified_at = datetime.now(UTC)
    user.is_active = True
    db.add(user)
    return user
