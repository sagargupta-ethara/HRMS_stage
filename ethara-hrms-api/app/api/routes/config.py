import csv
import html
import io
import re
import secrets
import string
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_permissions, user_has_any_role, user_role_values
from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import Permission
from app.core.security import create_token, decode_token, hash_token, verify_token_hash
from app.db.models import College, Position, Role, SourceType, User, Vendor
from app.schemas.resources import (
    AdminSettingRead,
    AdminSettingWrite,
    CollegeCreate,
    CollegeRead,
    CollegeUpdate,
    PositionApprovalActionRequest,
    PositionCreate,
    PositionRead,
    PositionUpdate,
    UserCreate,
    UserRead,
    UserUpdate,
    VendorCreate,
    VendorRead,
    VendorUpdate,
)
from app.services import auth as auth_service
from app.services import candidates as candidate_service
from app.services import reference_data, workflows
from app.services.audit import log_audit
from app.services.integrations import EmailService

router = APIRouter(tags=["configuration"])

VENDOR_BULK_HEADER_ALIASES: dict[str, set[str]] = {
    "name": {"name", "full name", "full_name", "candidate name"},
    "email": {"email", "personal email", "personal_email"},
    "number": {"number", "phone", "phone number", "mobile", "mobile number"},
    "aadhaar": {"aadhaar", "aadhaar card", "aadhaar number", "aadhar", "aadhar card", "aadhar number"},
    "college": {"college", "college name", "college optional"},
    "resume_url": {"resume", "resume url", "resume link", "resume url link"},
}
VENDOR_BULK_REQUIRED_COLUMNS = ("name", "email", "number", "aadhar card", "resume (URL)")
PENDING_LEADERSHIP_APPROVAL = "pending_leadership_approval"
PUBLIC_POSITION_STATUSES = {"approved", "posted"}


def _generate_user_temp_password() -> str:
    uppers = string.ascii_uppercase
    lowers = string.ascii_lowercase
    digits = string.digits
    specials = "!@#$%^&*"
    pool = uppers + lowers + digits + specials

    chars = [
        secrets.choice(uppers),
        secrets.choice(lowers),
        secrets.choice(digits),
        secrets.choice(specials),
    ]
    chars += [secrets.choice(pool) for _ in range(10)]
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)


def _send_user_password_reset_email(*, user: User, temp_password: str) -> None:
    settings = get_settings()
    portal_url = settings.frontend_url.rstrip("/")
    login_url = f"{portal_url}/login"
    escaped_password = html.escape(temp_password)
    escaped_login_url = html.escape(login_url)
    escaped_name = html.escape(user.name)
    escaped_email = html.escape(user.email)
    EmailService().send_email(
        to_email=user.email,
        subject="Your Ethara password has been reset",
        body_text=(
            f"Hi {user.name},\n\n"
            "An administrator reset your Ethara account password.\n\n"
            f"Portal: {login_url}\n"
            f"Email: {user.email}\n"
            f"Temporary password: {temp_password}\n\n"
            "Please sign in and change this temporary password immediately.\n\n"
            "If you did not expect this reset, contact HR or your system administrator."
        ),
        body_html=(
            f"<p>Hi <strong>{escaped_name}</strong>,</p>"
            "<p>An administrator reset your Ethara account password.</p>"
            "<table style='width:100%;border-collapse:collapse;margin:18px 0;"
            "border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;'>"
            "<tr style='background:#f8fafc'>"
            "<td style='padding:10px 14px;font-weight:600;'>Portal</td>"
            f"<td style='padding:10px 14px;'><a href='{escaped_login_url}'>{escaped_login_url}</a></td>"
            "</tr>"
            "<tr>"
            "<td style='padding:10px 14px;font-weight:600;'>Email</td>"
            f"<td style='padding:10px 14px;'>{escaped_email}</td>"
            "</tr>"
            "<tr style='background:#f8fafc'>"
            "<td style='padding:10px 14px;font-weight:600;'>Temporary password</td>"
            f"<td style='padding:10px 14px;font-family:monospace;font-weight:700;'>{escaped_password}</td>"
            "</tr>"
            "</table>"
            "<p>Please sign in and change this temporary password immediately.</p>"
            "<p style='font-size:12px;color:#64748b;'>If you did not expect this reset, "
            "contact HR or your system administrator.</p>"
        ),
    )


def _assert_position_approver(current_user: User) -> None:
    if not user_has_any_role(current_user, {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authorized approvers can approve or reject job descriptions.",
        )


def _get_leadership_recipient(db: Session) -> tuple[str, str, User | None]:
    settings = get_settings()
    email = auth_service.normalize_email(settings.leadership_approval_email)
    approver_user = db.scalar(select(User).where(func.lower(User.email) == email))
    approver_name = (
        approver_user.name
        if approver_user
        else email.split("@", maxsplit=1)[0].replace(".", " ").replace("_", " ").title()
    )
    return email, approver_name, approver_user


def _position_approval_link(*, token: str) -> str:
    settings = get_settings()
    return f"{settings.frontend_url.rstrip('/')}/api/v1/public/positions/approval?token={token}"


def _position_view_link(*, token: str) -> str:
    settings = get_settings()
    return f"{settings.frontend_url.rstrip('/')}/api/v1/public/positions/preview?token={token}"


def _approver_display_name(db: Session, email: str) -> str:
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if user and user.name:
        return user.name
    return email.split("@", maxsplit=1)[0].replace(".", " ").replace("_", " ").title()


def _send_position_approval_emails(
    db: Session,
    *,
    position: Position,
    requester: User,
) -> None:
    settings = get_settings()
    approver_emails = settings.position_approver_email_list
    cc_emails = [
        email
        for email in settings.position_approval_cc_email_list
        if email not in approver_emails
    ]
    if not approver_emails:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No JD approver email is configured.",
        )

    email_service = EmailService()
    requested_at = position.approval_requested_at or datetime.now(UTC)
    expires_delta = timedelta(days=settings.leadership_approval_token_expires_in_days)
    expires_at = requested_at + expires_delta
    request_id = uuid4().hex

    # A single request id (and its hash) is shared by every approver link so any
    # of them can act on behalf of the team; each approver's token only differs
    # by the approver email it carries.
    position.approval_recipient_email = ",".join(approver_emails + cc_emails)
    position.approval_token_hash = hash_token(request_id)
    position.approval_token_expires_at = expires_at

    view_token = create_token(
        subject=position.id,
        secret=settings.jwt_secret,
        expires_delta=expires_delta,
        token_type="position_view",
        extra={"requestId": request_id},
    )
    view_link = _position_view_link(token=view_token)

    subject = f"JD approval required: {position.title}"
    for approver_email in approver_emails:
        approver_name = _approver_display_name(db, approver_email)
        approve_token = create_token(
            subject=position.id,
            secret=settings.jwt_secret,
            expires_delta=expires_delta,
            token_type="position_approval",
            extra={"approverEmail": approver_email, "action": "approve", "requestId": request_id},
        )
        reject_token = create_token(
            subject=position.id,
            secret=settings.jwt_secret,
            expires_delta=expires_delta,
            token_type="position_approval",
            extra={"approverEmail": approver_email, "action": "reject", "requestId": request_id},
        )
        approve_link = _position_approval_link(token=approve_token)
        reject_link = _position_approval_link(token=reject_token)
        body_text = (
            f"Hi {approver_name},\n\n"
            f"{requester.name} created or updated the JD for {position.title} and it is awaiting approval.\n\n"
            f"Department: {position.department}\n"
            f"Location: {position.location or 'Not specified'}\n"
            f"Requested at: {requested_at.strftime('%d %b %Y, %I:%M %p UTC')}\n"
            f"This approval link expires on: {expires_at.strftime('%d %b %Y, %I:%M %p UTC')}\n\n"
            f"View the full JD: {view_link}\n\n"
            f"Approve: {approve_link}\n"
            f"Reject: {reject_link}\n"
            "A rejection reason is required before the JD is rejected.\n\n"
            "This JD will be posted automatically on the careers page after approval.\n"
            "This link can be used only once.\n"
        )
        body_html = (
            f"<p>Hi <strong>{approver_name}</strong>,</p>"
            f"<p><strong>{requester.name}</strong> created or updated the JD for "
            f"<strong>{position.title}</strong> and it is awaiting approval.</p>"
            "<table style='border-collapse:collapse;'>"
            f"<tr><td style='padding:4px 8px;font-weight:bold;'>Department</td><td style='padding:4px 8px;'>{position.department}</td></tr>"
            f"<tr><td style='padding:4px 8px;font-weight:bold;'>Location</td><td style='padding:4px 8px;'>{position.location or 'Not specified'}</td></tr>"
            f"<tr><td style='padding:4px 8px;font-weight:bold;'>Requested at</td><td style='padding:4px 8px;'>{requested_at.strftime('%d %b %Y, %I:%M %p UTC')}</td></tr>"
            f"<tr><td style='padding:4px 8px;font-weight:bold;'>Link expires</td><td style='padding:4px 8px;'>{expires_at.strftime('%d %b %Y, %I:%M %p UTC')}</td></tr>"
            "</table>"
            f"<p><a href='{view_link}' style='display:inline-block;padding:10px 14px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;'>View full JD</a></p>"
            f"<p><a href='{approve_link}' style='display:inline-block;padding:10px 14px;border-radius:8px;background:#16a34a;color:#fff;text-decoration:none;margin-right:8px;'>Approve JD</a>"
            f"<a href='{reject_link}' style='display:inline-block;padding:10px 14px;border-radius:8px;background:#dc2626;color:#fff;text-decoration:none;'>Reject JD</a></p>"
            "<p>A rejection reason is required before the JD is rejected.</p>"
            "<p>You can review the complete job description using the “View full JD” link before deciding. "
            "This JD will be posted automatically on the careers page after approval. The link can be used only once.</p>"
        )
        try:
            email_service.send_email(
                to_email=approver_email,
                subject=subject,
                body_text=body_text,
                body_html=body_html,
                cc_emails=cc_emails,
            )
        except Exception:
            # Don't let one approver's delivery failure block the others.
            pass

    position.approval_email_sent_at = datetime.now(UTC)
    db.add(position)
    workflows.notify_roles(
        db,
        roles={Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP},
        title="Job description approval requested",
        message=f"{requester.name} requested approval for {position.title}.",
        type_=workflows.NotificationType.ACTION,
    )
    log_audit(
        db,
        entity_type="position",
        entity_id=position.id,
        action="position_approval_email_sent",
        actor=requester,
        new_value={
            "approvalStatus": position.approval_status,
            "approvalRecipientEmail": position.approval_recipient_email,
            "approvalTokenExpiresAt": expires_at.isoformat(),
        },
    )


def _notify_position_stakeholders(
    db: Session,
    *,
    position: Position,
    requester_id: str | None,
    approver_email: str,
    approved: bool,
    reason: str | None = None,
) -> None:
    title = "Job description approved" if approved else "Job description rejected"
    message = (
        f"{position.title} was approved by {approver_email} and posted automatically."
        if approved
        else f"{position.title} was rejected by {approver_email}."
    )
    if reason and not approved:
        message = f"{message} Reason: {reason}"

    requester = db.get(User, requester_id) if requester_id else None
    if requester and not user_has_any_role(requester, {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}):
        workflows.create_notification(
            db,
            user_id=requester.id,
            title=title,
            message=message,
            type_=workflows.NotificationType.SUCCESS if approved else workflows.NotificationType.WARNING,
        )

    workflows.notify_roles(
        db,
        roles={Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP},
        title=title,
        message=message,
        type_=workflows.NotificationType.SUCCESS if approved else workflows.NotificationType.WARNING,
    )


def _approval_result_html(*, title: str, message: str, tone: str) -> str:
    badge_bg = "#166534" if tone == "success" else "#991b1b"
    badge_text = "#dcfce7" if tone == "success" else "#fee2e2"
    # title/message embed dynamic, user-controlled values (e.g. the JD title via
    # position.title) and are rendered straight into an HTML page returned to the
    # browser, so they MUST be HTML-escaped to prevent reflected XSS.
    title = html.escape(str(title))
    message = html.escape(str(message))
    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title}</title>
    <style>
      body {{
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b0b16;
        color: #e8eaf6;
        display: flex;
        min-height: 100vh;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }}
      .card {{
        width: min(560px, 100%);
        background: rgba(25, 24, 44, 0.92);
        border: 1px solid rgba(144, 141, 206, 0.18);
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      }}
      .badge {{
        display: inline-flex;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: {badge_bg};
        color: {badge_text};
      }}
      h1 {{ margin: 16px 0 10px; font-size: 28px; }}
      p {{ margin: 0; line-height: 1.6; color: rgba(232, 234, 246, 0.72); }}
    </style>
  </head>
  <body>
    <div class="card">
      <span class="badge">{title}</span>
      <h1>{title}</h1>
      <p>{message}</p>
    </div>
  </body>
</html>
"""


def _position_rejection_reason_html(*, position: Position, token: str) -> str:
    title = html.escape(position.title)
    token = html.escape(token)
    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Reject JD: {title}</title>
    <style>
      body {{
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b0b16;
        color: #e8eaf6;
        display: flex;
        min-height: 100vh;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }}
      main {{
        width: min(560px, 100%);
        background: rgba(25, 24, 44, 0.92);
        border: 1px solid rgba(144, 141, 206, 0.18);
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      }}
      textarea {{
        box-sizing: border-box;
        width: 100%;
        min-height: 140px;
        margin-top: 14px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(8,8,18,0.88);
        color: #e8eaf6;
        padding: 12px;
        resize: vertical;
      }}
      button {{
        margin-top: 16px;
        border: 0;
        border-radius: 999px;
        background: #dc2626;
        color: #fff;
        font-weight: 700;
        padding: 11px 18px;
        cursor: pointer;
      }}
      p {{ color: rgba(232,234,246,0.72); line-height: 1.6; }}
    </style>
  </head>
  <body>
    <main>
      <h1>Reject JD</h1>
      <p>Please enter the reason for rejecting <strong>{title}</strong>. The requester will see this reason.</p>
      <form method="get" action="/api/v1/public/positions/approval">
        <input type="hidden" name="token" value="{token}" />
        <textarea name="reason" required minlength="3" placeholder="Enter rejection reason"></textarea>
        <button type="submit">Reject JD</button>
      </form>
    </main>
  </body>
</html>
"""


def _normalize_vendor_bulk_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.strip().lower()).strip()


def _resolve_vendor_bulk_columns(fieldnames: list[str]) -> dict[str, str]:
    resolved: dict[str, str] = {}
    for canonical, aliases in VENDOR_BULK_HEADER_ALIASES.items():
        for field_name in fieldnames:
            if _normalize_vendor_bulk_header(field_name) in aliases:
                resolved[canonical] = field_name
                break

    missing = [
        column
        for column, canonical in (
            ("name", "name"),
            ("email", "email"),
            ("number", "number"),
            ("aadhar card", "aadhaar"),
            ("resume (URL)", "resume_url"),
        )
        if canonical not in resolved
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "CSV must include the columns: "
                + ", ".join(VENDOR_BULK_REQUIRED_COLUMNS)
                + ". college (Optional) is allowed."
            ),
        )
    return resolved


def _vendor_bulk_value(row: dict[str, str | None], column_map: dict[str, str], key: str) -> str:
    source_column = column_map.get(key)
    if not source_column:
        return ""
    return str(row.get(source_column) or "").strip()


@router.get("/positions", response_model=list[PositionRead])
def list_positions(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.POSITIONS_READ))],
):
    return reference_data.list_positions(db)


@router.get("/public/positions", response_model=list[PositionRead])
def list_public_positions(
    db: Annotated[Session, Depends(get_db)],
    search: str | None = Query(default=None),
    department: str | None = Query(default=None),
    location: str | None = Query(default=None),
    featured: bool | None = Query(default=None),
):
    positions = [
        position
        for position in reference_data.list_positions(db)
        if position.is_active and position.approval_status in PUBLIC_POSITION_STATUSES
    ]
    if search:
        term = search.strip().lower()
        positions = [
            position
            for position in positions
            if term in position.title.lower()
            or term in (position.department or "").lower()
            or term in (position.location or "").lower()
            or term in (position.summary or position.description or "").lower()
        ]
    if department:
        positions = [
            position for position in positions if position.department.lower() == department.strip().lower()
        ]
    if location:
        positions = [
            position for position in positions if location.strip().lower() in (position.location or "").lower()
        ]
    if featured is not None:
        positions = [position for position in positions if position.featured is featured]
    return positions


@router.get("/public/positions/approval", response_class=HTMLResponse)
def handle_position_approval_link(
    token: str = Query(...),
    reason: str | None = Query(default=None),
    db: Annotated[Session, Depends(get_db)] = None,
):
    settings = get_settings()
    try:
        payload = decode_token(token, secret=settings.jwt_secret)
    except HTTPException:
        return HTMLResponse(
            content=_approval_result_html(
                title="Approval link expired",
                message="This approval link is invalid or expired. Ask TA to resend the job post for approval.",
                tone="warning",
            ),
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    if payload.get("type") != "position_approval":
        return HTMLResponse(
            content=_approval_result_html(
                title="Invalid approval link",
                message="This approval link is not valid.",
                tone="warning",
            ),
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    action = str(payload.get("action") or "").strip().lower()
    approver_email = auth_service.normalize_email(str(payload.get("approverEmail") or "").strip())
    request_id = str(payload.get("requestId") or "").strip()
    position_id = str(payload.get("sub") or "").strip()
    if action not in {"approve", "reject"} or not approver_email or not request_id or not position_id:
        return HTMLResponse(
            content=_approval_result_html(
                title="Invalid approval link",
                message="This approval link is missing the required approval details.",
                tone="warning",
            ),
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    position = db.get(Position, position_id)
    if position is None:
        return HTMLResponse(
            content=_approval_result_html(
                title="Position not found",
                message="This job description no longer exists.",
                tone="warning",
            ),
            status_code=status.HTTP_404_NOT_FOUND,
        )

    authorized_emails = settings.position_approver_email_list
    if approver_email not in authorized_emails:
        return HTMLResponse(
            content=_approval_result_html(
                title="Unauthorized approver",
                message="This approval link is not authorized for your mailbox.",
                tone="warning",
            ),
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    issued_recipients = [
        auth_service.normalize_email(e)
        for e in (position.approval_recipient_email or "").split(",")
        if e.strip()
    ]
    if issued_recipients and approver_email not in issued_recipients:
        return HTMLResponse(
            content=_approval_result_html(
                title="Unauthorized approver",
                message="This approval link was issued for a different approver email.",
                tone="warning",
            ),
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    if not position.approval_token_hash or not position.approval_token_expires_at:
        return HTMLResponse(
            content=_approval_result_html(
                title="Approval already processed",
                message="This approval request has already been processed or is no longer active.",
                tone="warning",
            ),
            status_code=status.HTTP_409_CONFLICT,
        )

    expires_at = position.approval_token_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    if expires_at < datetime.now(UTC):
        return HTMLResponse(
            content=_approval_result_html(
                title="Approval link expired",
                message="This approval request has expired. Ask TA to resend the job post for approval.",
                tone="warning",
            ),
            status_code=status.HTTP_410_GONE,
        )

    if not verify_token_hash(request_id, position.approval_token_hash):
        return HTMLResponse(
            content=_approval_result_html(
                title="Invalid approval link",
                message="This approval link is invalid or has already been used.",
                tone="warning",
            ),
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    if position.approval_status not in {"pending_approval", PENDING_LEADERSHIP_APPROVAL, "draft"}:
        is_posted = position.approval_status in {"approved", "posted"}
        status_title = "Already approved" if is_posted else "Already reviewed"
        status_label = position.approval_status.replace("_", " ").replace("-", " ").title()
        status_message = f"{position.title} has already been {status_label}."
        return HTMLResponse(
            content=_approval_result_html(
                title=status_title,
                message=status_message,
                tone="success" if is_posted else "warning",
            )
        )

    approver = db.scalar(select(User).where(func.lower(User.email) == approver_email))
    if approver is not None and not user_has_any_role(approver, {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}):
        approver = None

    if action == "approve":
        updated = reference_data.approve_position(
            db,
            position=position,
            actor=approver,
            approver_email=approver_email,
        )
        _notify_position_stakeholders(
            db,
            position=updated,
            requester_id=updated.requested_by,
            approver_email=approver_email,
            approved=True,
        )
        title = "JD approved and posted"
        message = f"{updated.title} has been approved and posted successfully."
        tone = "success"
    else:
        rejection_reason = (reason or "").strip()
        if not rejection_reason:
            return HTMLResponse(content=_position_rejection_reason_html(position=position, token=token))
        updated = reference_data.reject_position(
            db,
            position=position,
            actor=approver,
            reason=rejection_reason,
            approver_email=approver_email,
        )
        _notify_position_stakeholders(
            db,
            position=updated,
            requester_id=updated.requested_by,
            approver_email=approver_email,
            approved=False,
            reason=rejection_reason,
        )
        title = "JD rejected"
        message = f"{updated.title} has been rejected. The requester can revise and resend it."
        tone = "warning"

    db.commit()
    return HTMLResponse(content=_approval_result_html(title=title, message=message, tone=tone))


def _position_preview_html(position: Position) -> str:
    def esc(value: object) -> str:
        return html.escape(str(value)) if value not in (None, "") else "—"

    def experience_years_label(value: int | None) -> str:
        if value is None:
            return ""
        brackets = [
            (0, "0-1"),
            (1, "1-2"),
            (2, "2-3"),
            (3, "3-5"),
            (5, "5-8"),
            (8, "8-12"),
            (12, "12-15"),
            (15, "15+"),
        ]
        label = brackets[0][1]
        for minimum, bracket_label in brackets:
            if value >= minimum:
                label = bracket_label
        return label

    def urgency_label(value: int | None) -> str:
        if value is None:
            return "P1"
        if value >= 3:
            return "P0"
        if value <= 1:
            return "P2"
        return "P1"

    def bullet_section(heading: str, items: list[str] | None) -> str:
        items = [i for i in (items or []) if str(i).strip()]
        if not items:
            return ""
        lis = "".join(f"<li style='margin:4px 0;'>{html.escape(str(i))}</li>" for i in items)
        return (
            f"<h3 style='margin:20px 0 6px;font-size:15px;color:#111827;'>{html.escape(heading)}</h3>"
            f"<ul style='margin:0;padding-left:20px;color:#374151;font-size:14px;'>{lis}</ul>"
        )

    description_html = (
        f"<p style='white-space:pre-wrap;color:#374151;font-size:14px;line-height:1.6;'>{html.escape(position.description)}</p>"
        if position.description else ""
    )
    summary_html = (
        f"<p style='color:#4b5563;font-size:14px;font-style:italic;'>{html.escape(position.summary)}</p>"
        if position.summary else ""
    )
    experience_years = experience_years_label(position.experience_years)
    experience_value = esc(position.experience_level)
    if experience_years:
        experience_value = f"{experience_value} · {html.escape(experience_years)}"
    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>JD preview: {html.escape(position.title)}</title>
  </head>
  <body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:720px;margin:32px auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;">Job description preview</p>
      <h1 style="margin:0 0 12px;font-size:24px;color:#111827;">{html.escape(position.title)}</h1>
      {summary_html}
      <table style="border-collapse:collapse;margin:12px 0 4px;font-size:14px;color:#374151;">
        <tr><td style="padding:3px 10px 3px 0;font-weight:bold;">Department</td><td style="padding:3px 0;">{esc(position.department)}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;font-weight:bold;">Location</td><td style="padding:3px 0;">{esc(position.location)}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;font-weight:bold;">Employment type</td><td style="padding:3px 0;">{esc(position.employment_type)}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;font-weight:bold;">Work mode</td><td style="padding:3px 0;">{esc(position.work_mode)}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;font-weight:bold;">Experience</td><td style="padding:3px 0;">{experience_value}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;font-weight:bold;">Urgency</td><td style="padding:3px 0;">{urgency_label(position.urgency_level)}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;font-weight:bold;">Salary</td><td style="padding:3px 0;">{esc(position.salary_bracket)}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;font-weight:bold;">Openings</td><td style="padding:3px 0;">{esc(position.openings)}</td></tr>
      </table>
      {('<h3 style="margin:20px 0 6px;font-size:15px;color:#111827;">About the role</h3>' + description_html) if description_html else ''}
      {bullet_section("Key Job Responsibilities", position.responsibilities)}
      {bullet_section("Required Skill Set", position.requirements)}
      {bullet_section("Additional Skill Keywords", position.preferred_skills)}
      {bullet_section("Benefits", position.benefits)}
      <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;">
        Return to your email to Approve or Reject this JD. Approving will post it automatically to the careers page.
      </p>
    </div>
  </body>
</html>
"""


@router.get("/public/positions/preview", response_class=HTMLResponse)
def preview_position_jd(
    token: str = Query(...),
    db: Annotated[Session, Depends(get_db)] = None,
):
    settings = get_settings()
    try:
        payload = decode_token(token, secret=settings.jwt_secret)
    except HTTPException:
        return HTMLResponse(
            content=_approval_result_html(
                title="Preview link expired",
                message="This JD preview link is invalid or expired. Ask TA to resend the job post.",
                tone="warning",
            ),
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    if payload.get("type") != "position_view":
        return HTMLResponse(
            content=_approval_result_html(
                title="Invalid preview link",
                message="This preview link is not valid.",
                tone="warning",
            ),
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    position_id = str(payload.get("sub") or "").strip()
    position = db.get(Position, position_id)
    if position is None:
        return HTMLResponse(
            content=_approval_result_html(
                title="Position not found",
                message="This job description no longer exists.",
                tone="warning",
            ),
            status_code=status.HTTP_404_NOT_FOUND,
        )

    return HTMLResponse(content=_position_preview_html(position))


@router.get("/public/positions/{slug}", response_model=PositionRead)
def get_public_position(slug: str, db: Annotated[Session, Depends(get_db)]):
    position = db.scalar(
        select(Position).where(
            Position.is_active.is_(True),
            Position.approval_status.in_(PUBLIC_POSITION_STATUSES),
            (Position.slug == slug) | (Position.id == slug),
        )
    )
    if position is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")
    return position


@router.post("/positions", response_model=PositionRead)
def create_position(
    payload: PositionCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.POSITIONS_WRITE))],
):
    position = reference_data.create_position(db, payload=payload.model_dump(), actor=current_user)
    _send_position_approval_emails(db, position=position, requester=current_user)
    db.commit()
    db.refresh(position)
    return position


@router.patch("/positions/{position_id}", response_model=PositionRead)
def update_position(
    position_id: str,
    payload: PositionUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.POSITIONS_WRITE))],
):
    position = db.get(Position, position_id)
    if position is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")
    updated = reference_data.update_position(
        db,
        position=position,
        payload=payload.model_dump(exclude_none=True),
        actor=current_user,
    )
    if updated.approval_status == PENDING_LEADERSHIP_APPROVAL:
        _send_position_approval_emails(db, position=updated, requester=current_user)
    db.commit()
    db.refresh(updated)
    return updated


@router.post("/positions/{position_id}/approval", response_model=PositionRead)
def approve_or_reject_position(
    position_id: str,
    payload: PositionApprovalActionRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.POSITIONS_WRITE))],
):
    _assert_position_approver(current_user)
    position = db.get(Position, position_id)
    if position is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")

    action = payload.action.strip().lower()
    if action not in {"approve", "reject"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="action must be either approve or reject",
        )

    if position.approval_status not in {"pending_approval", PENDING_LEADERSHIP_APPROVAL, "draft"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This job description is already {position.approval_status.replace('_', ' ').replace('-', ' ').title()}.",
        )

    if action == "approve":
        updated = reference_data.approve_position(
            db,
            position=position,
            actor=current_user,
            approver_email=current_user.email,
        )
        _notify_position_stakeholders(
            db,
            position=updated,
            requester_id=updated.requested_by,
            approver_email=current_user.email,
            approved=True,
        )
    else:
        rejection_reason = (payload.reason or "").strip()
        if not rejection_reason:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Rejection reason is required.",
            )
        updated = reference_data.reject_position(
            db,
            position=position,
            actor=current_user,
            reason=rejection_reason,
            approver_email=current_user.email,
        )
        _notify_position_stakeholders(
            db,
            position=updated,
            requester_id=updated.requested_by,
            approver_email=current_user.email,
            approved=False,
            reason=rejection_reason,
        )

    db.commit()
    db.refresh(updated)
    return updated


@router.delete("/positions/{position_id}")
def delete_position(
    position_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.POSITIONS_WRITE))],
):
    position = db.get(Position, position_id)
    if position is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")
    updated = reference_data.delete_position(db, position=position, actor=current_user)
    db.commit()
    db.refresh(updated)
    return {"message": "Position deleted successfully"}


@router.get("/vendors", response_model=list[VendorRead])
def list_vendors(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.VENDORS_READ))],
):
    return reference_data.list_vendors(db)


@router.post("/vendors", response_model=VendorRead)
def create_vendor(
    payload: VendorCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.VENDORS_WRITE))],
):
    vendor = reference_data.create_vendor(db, payload=payload.model_dump(), actor=current_user)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/vendors/bulk-upload")
def bulk_upload_vendor_candidates(
    request: Request,
    file: Annotated[UploadFile, File(...)],
    position_id: Annotated[str, Form(alias="positionId")],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.CANDIDATES_WRITE))],
):
    if not user_has_any_role(current_user, {Role.VENDOR}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Vendor account required")
    if not current_user.vendor_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor account is not linked to a vendor profile.",
        )

    position = db.scalar(select(Position).where(Position.id == position_id, Position.is_active.is_(True)))
    if position is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")

    try:
        csv_text = file.file.read().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="CSV file must be UTF-8 encoded.",
        ) from exc

    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="CSV file is missing a header row.",
        )

    column_map = _resolve_vendor_bulk_columns(reader.fieldnames)
    summary = {"total": 0, "saved": 0, "failed": 0, "errors": []}

    for row_number, row in enumerate(reader, start=2):
        if not row or all(not str(value or "").strip() for value in row.values()):
            continue

        summary["total"] += 1

        try:
            full_name = _vendor_bulk_value(row, column_map, "name")
            email = _vendor_bulk_value(row, column_map, "email").lower()
            phone = _vendor_bulk_value(row, column_map, "number")
            aadhaar_number = re.sub(r"\D", "", _vendor_bulk_value(row, column_map, "aadhaar"))
            college_name = _vendor_bulk_value(row, column_map, "college")
            resume_url = _vendor_bulk_value(row, column_map, "resume_url")

            missing_fields = [
                label
                for label, value in (
                    ("name", full_name),
                    ("email", email),
                    ("number", phone),
                    ("aadhar card", aadhaar_number),
                    ("resume (URL)", resume_url),
                )
                if not value
            ]
            if missing_fields:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Missing required value(s): {', '.join(missing_fields)}.",
                )

            if len(aadhaar_number) != 12:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Aadhaar number must be 12 digits.",
                )

            college_id: str | None = None
            if college_name:
                normalized_college = college_name.lower()
                college = db.scalar(
                    select(College).where(
                        College.is_active.is_(True),
                        or_(
                            func.lower(College.name) == normalized_college,
                            func.lower(College.short_name) == normalized_college,
                        ),
                    )
                )
                college_id = college.id if college is not None else None

            payload = {
                "full_name": full_name,
                "personal_email": email,
                "phone": phone,
                "aadhaar_number": aadhaar_number,
                "aadhaar_last4": aadhaar_number[-4:],
                "source_type": SourceType.VENDOR,
                "position_id": position.id,
                "college_id": college_id,
                "resume_url": resume_url,
            }

            with db.begin_nested():
                candidate_service.create_candidate(
                    db,
                    payload=payload,
                    actor=current_user,
                    request=request,
                )
            summary["saved"] += 1
        except HTTPException as exc:
            summary["failed"] += 1
            summary["errors"].append(f"Row {row_number}: {exc.detail}")
        except IntegrityError:
            summary["failed"] += 1
            summary["errors"].append(
                f"Row {row_number}: A candidate with this email or Aadhaar number already exists."
            )
        except Exception:
            summary["failed"] += 1
            summary["errors"].append(f"Row {row_number}: Could not import this candidate.")

    db.commit()
    return summary


@router.patch("/vendors/{vendor_id}", response_model=VendorRead)
def update_vendor(
    vendor_id: str,
    payload: VendorUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.VENDORS_WRITE))],
):
    vendor = db.get(Vendor, vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    updated = reference_data.update_vendor(
        db,
        vendor=vendor,
        payload=payload.model_dump(exclude_none=True),
        actor=current_user,
    )
    db.commit()
    db.refresh(updated)
    return updated


@router.get("/colleges", response_model=list[CollegeRead])
def list_colleges(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.COLLEGES_READ))],
):
    return reference_data.list_colleges(db)


@router.get("/public/colleges", response_model=list[CollegeRead])
def list_public_colleges(db: Annotated[Session, Depends(get_db)]):
    return [college for college in reference_data.list_colleges(db) if college.is_active]


@router.post("/colleges", response_model=CollegeRead)
def create_college(
    payload: CollegeCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COLLEGES_WRITE))],
):
    record = reference_data.create_college(db, payload=payload.model_dump(), actor=current_user)
    db.commit()
    db.refresh(record)
    return record


@router.patch("/colleges/{college_id}", response_model=CollegeRead)
def update_college(
    college_id: str,
    payload: CollegeUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.COLLEGES_WRITE))],
):
    record = db.get(College, college_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="College not found")
    updated = reference_data.update_college(
        db,
        record=record,
        payload=payload.model_dump(exclude_none=True),
        actor=current_user,
    )
    db.commit()
    db.refresh(updated)
    return updated


@router.get("/users", response_model=list[UserRead])
def list_users(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.USERS_READ))],
):
    return [auth_service.user_to_dict(user) for user in reference_data.list_users(db)]


@router.post("/users", response_model=UserRead)
def create_user(
    payload: UserCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.USERS_WRITE))],
):
    user = reference_data.create_user(db, payload=payload.model_dump(exclude_none=True), actor=current_user)
    db.commit()
    db.refresh(user)
    return auth_service.user_to_dict(user)


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: str,
    payload: UserUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.USERS_WRITE))],
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    updated = reference_data.update_user(
        db,
        user=user,
        payload=payload.model_dump(exclude_none=True),
        actor=current_user,
    )
    db.commit()
    db.refresh(updated)
    return auth_service.user_to_dict(updated)


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.USERS_WRITE))],
) -> dict[str, str]:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    temp_password = _generate_user_temp_password()
    updated = reference_data.reset_user_password(
        db,
        user=user,
        new_password=temp_password,
        actor=current_user,
    )
    try:
        _send_user_password_reset_email(user=updated, temp_password=temp_password)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Password was not reset because the email could not be sent.",
        ) from exc
    db.commit()
    return {
        "message": "Password reset successfully. A temporary password was emailed to the user.",
        "email": updated.email,
    }


@router.get("/settings", response_model=list[AdminSettingRead])
def list_settings(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permissions(Permission.SETTINGS_READ))],
    namespace: str | None = Query(default=None),
):
    return reference_data.list_settings(db, namespace=namespace)


# Namespaces (and matching key prefixes) that are managed exclusively by their own
# admin-gated endpoints (PUT /role-modules/* and /role-modules/users/*). The generic
# settings writer must NOT be a side door into the authorization model, so writes
# touching these are rejected here.
_RESERVED_SETTINGS_NAMESPACES = frozenset({"role_modules", "user_modules"})


@router.put("/settings", response_model=AdminSettingRead)
def upsert_setting(
    payload: AdminSettingWrite,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permissions(Permission.SETTINGS_WRITE))],
):
    namespace = (payload.namespace or "").strip()
    key = (payload.key or "").strip()
    if namespace in _RESERVED_SETTINGS_NAMESPACES or any(
        key.startswith(f"{reserved}:") for reserved in _RESERVED_SETTINGS_NAMESPACES
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This settings namespace is managed through its dedicated "
                "role/user module access endpoints and cannot be written here."
            ),
        )
    record = reference_data.upsert_setting(db, payload=payload.model_dump(), actor=current_user)
    db.commit()
    db.refresh(record)
    return record


# ── Role → module access (admin / super-admin only) ───────────────────────────
def _require_module_admin(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    roles = user_role_values(current_user)
    if not (roles & {str(Role.ADMIN), str(Role.SUPER_ADMIN), str(Role.LEADERSHIP)}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


class RoleModulesWrite(BaseModel):
    modules: list[str]


@router.get("/role-modules")
def get_role_modules(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_module_admin)],
) -> dict:
    from app.core.modules import MODULE_REGISTRY

    return {"modules": MODULE_REGISTRY, "roles": reference_data.get_all_role_modules(db)}


@router.put("/role-modules/{role}")
def put_role_modules(
    role: str,
    payload: RoleModulesWrite,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_module_admin)],
) -> dict:
    if role not in {str(r) for r in Role}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown role")
    reference_data.set_enabled_modules_for_role(db, role=role, modules=payload.modules, actor=current_user)
    db.commit()
    return {"role": role, "enabled": sorted(set(payload.modules))}


@router.get("/role-modules/me")
def get_my_modules(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    from app.core.modules import ALL_MODULE_KEYS, FULL_ACCESS_ROLES

    if user_role_values(current_user) & set(FULL_ACCESS_ROLES):
        return {"enabled": list(ALL_MODULE_KEYS)}
    # Effective = per-user override if set, else role-level.
    return {"enabled": sorted(reference_data.get_enabled_modules_for_user(db, current_user))}


@router.get("/role-modules/users/{user_id}")
def get_user_modules(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(_require_module_admin)],
) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {
        "userId": user.id,
        "name": user.name,
        "role": str(user.role),
        "hasOverride": reference_data.has_user_module_config(db, user_id),
        "roleDefault": sorted(reference_data.get_enabled_modules_for_role(db, str(user.role))),
        "enabled": sorted(reference_data.get_enabled_modules_for_user(db, user)),
    }


@router.put("/role-modules/users/{user_id}")
def put_user_modules(
    user_id: str,
    payload: RoleModulesWrite,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_module_admin)],
) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    reference_data.set_enabled_modules_for_user(db, user_id=user_id, modules=payload.modules, actor=current_user)
    db.commit()
    return {"userId": user_id, "enabled": sorted(set(payload.modules))}


@router.delete("/role-modules/users/{user_id}")
def delete_user_modules(
    user_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_module_admin)],
) -> dict:
    reference_data.clear_user_module_override(db, user_id=user_id, actor=current_user)
    db.commit()
    return {"userId": user_id, "cleared": True}
