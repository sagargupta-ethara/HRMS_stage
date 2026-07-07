from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from app.core.config import get_settings
from app.core.security import create_token, decode_token, hash_password, hash_token
from app.db.models import AuditLog, Notification, Position, Role, User
from app.services.integrations import EmailService


def _login(client, *, email: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _create_ta_user(db_session) -> User:
    now = datetime.now(UTC)
    user = User(
        id="usr-ta",
        email="ta@ethara.ai",
        password_hash=hash_password("ta123"),
        name="Talent Acquisition",
        role=Role.TA,
        is_active=True,
        email_verified_at=now,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _extract_link(body_text: str, label: str) -> str:
    match = re.search(rf"{label}:\s+(https?://\S+)", body_text)
    assert match, f"Missing {label} link in email body: {body_text}"
    return match.group(1)


APPROVER_EMAILS = {"approver1@example.com", "approver2@example.com"}
CC_EMAILS = ["cc1@example.com", "cc2@example.com"]


def test_ta_job_post_creation_sends_approval_email_to_configured_recipients(
    client, db_session, monkeypatch
):
    _create_ta_user(db_session)
    ta_headers = _login(client, email="ta@ethara.ai", password="ta123")

    sent_messages: list[dict[str, str]] = []

    def fake_send_email(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str | None = None,
        cc_emails: list[str] | None = None,
    ) -> None:
        sent_messages.append(
            {
                "to_email": to_email,
                "subject": subject,
                "body_text": body_text,
                "body_html": body_html or "",
                "cc_emails": ",".join(cc_emails or []),
            }
        )

    monkeypatch.setattr(EmailService, "send_email", fake_send_email)

    response = client.post(
        "/api/v1/positions",
        headers=ta_headers,
        json={
            "title": "Principal Platform Architect",
            "department": "Engineering",
            "urgencyLevel": 4,
            "description": "Lead platform architecture across hiring workflows.",
            "summary": "Own the core platform architecture.",
            "location": "Bengaluru, India",
            "employmentType": "Full-time",
            "workMode": "Hybrid",
            "experienceLevel": "Principal",
            "experienceYears": 12,
            "salaryBracket": "45-60 LPA",
            "openings": 1,
            "requirements": ["Distributed systems"],
            "responsibilities": ["Own architecture"],
            "preferredSkills": ["FastAPI"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["approvalStatus"] == "pending_leadership_approval"
    assert payload["isActive"] is False
    assert payload["salaryBracket"] == "45-60 LPA"
    assert payload["experienceYears"] == 12

    assert {message["to_email"] for message in sent_messages} == APPROVER_EMAILS
    for message in sent_messages:
        assert message["cc_emails"] == ",".join(CC_EMAILS)
        assert "JD approval required" in message["subject"]
        assert "leadership" not in message["subject"].lower()
        assert "leadership" not in message["body_text"].lower()
        assert "Approve:" in message["body_text"]
        assert "Reject:" in message["body_text"]

    position = db_session.get(Position, payload["id"])
    assert position is not None
    assert set(position.approval_recipient_email.split(",")) == APPROVER_EMAILS.union(CC_EMAILS)
    assert position.approval_token_hash
    assert position.approval_token_expires_at is not None
    assert position.approval_email_sent_at is not None

    audit_actions = {
        row.action
        for row in db_session.query(AuditLog).filter(AuditLog.entity_id == position.id).all()
    }
    assert "position_created" in audit_actions
    assert "position_approval_requested" in audit_actions
    assert "position_approval_email_sent" in audit_actions


def test_public_approval_link_posts_job_and_invalidates_token(client, db_session, monkeypatch):
    _create_ta_user(db_session)
    ta_headers = _login(client, email="ta@ethara.ai", password="ta123")

    sent_messages: list[dict[str, str]] = []

    def fake_send_email(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str | None = None,
        cc_emails: list[str] | None = None,
    ) -> None:
        sent_messages.append({"to_email": to_email, "subject": subject, "body_text": body_text})

    monkeypatch.setattr(EmailService, "send_email", fake_send_email)

    response = client.post(
        "/api/v1/positions",
        headers=ta_headers,
        json={
            "title": "Growth Analytics Lead",
            "department": "Data & AI",
            "urgencyLevel": 3,
            "description": "Lead growth analytics.",
            "experienceYears": 8,
            "salaryBracket": "35-42 LPA",
        },
    )
    assert response.status_code == 200
    position_id = response.json()["id"]

    approve_link = _extract_link(sent_messages[0]["body_text"], "Approve")
    approve_url = urlparse(approve_link)
    approve_response = client.get(f"{approve_url.path}?{approve_url.query}")
    assert approve_response.status_code == 200
    assert "approved and posted" in approve_response.text.lower()

    position = db_session.get(Position, position_id)
    assert position is not None
    assert position.approval_status == "posted"
    assert position.is_active is True
    assert position.posted_at is not None
    assert position.reviewed_by_email == sent_messages[0]["to_email"]
    assert position.approval_token_hash is None
    assert position.approval_token_expires_at is None

    second_response = client.get(f"{approve_url.path}?{approve_url.query}")
    assert second_response.status_code == 409
    assert "already been processed" in second_response.text.lower()

    notifications = db_session.query(Notification).filter(Notification.title == "Job description approved").all()
    user_ids = {notification.user_id for notification in notifications}
    assert "usr-ta" in user_ids
    assert "usr-admin" in user_ids

    audit_actions = {
        row.action
        for row in db_session.query(AuditLog).filter(AuditLog.entity_id == position.id).all()
    }
    assert "position_approved" in audit_actions
    assert "position_posted" in audit_actions


def test_reactivating_deactivated_job_requires_approval(client, db_session, monkeypatch):
    _create_ta_user(db_session)
    ta_headers = _login(client, email="ta@ethara.ai", password="ta123")

    sent_messages: list[dict[str, str]] = []

    def fake_send_email(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str | None = None,
        cc_emails: list[str] | None = None,
    ) -> None:
        sent_messages.append({"to_email": to_email, "subject": subject, "body_text": body_text})

    monkeypatch.setattr(EmailService, "send_email", fake_send_email)

    position = Position(
        id="pos-reactivation-approval",
        title="Reactivation Approval Role",
        slug="reactivation-approval-role",
        department="Operations - Generalist",
        is_active=False,
        approval_status="posted",
        posted_at=datetime.now(UTC) - timedelta(days=1),
    )
    db_session.add(position)
    db_session.commit()

    response = client.patch(
        f"/api/v1/positions/{position.id}",
        headers=ta_headers,
        json={"isActive": True},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["isActive"] is False
    assert payload["approvalStatus"] == "pending_leadership_approval"
    assert {message["to_email"] for message in sent_messages} == APPROVER_EMAILS

    db_session.refresh(position)
    assert position.is_active is False
    assert position.approval_status == "pending_leadership_approval"
    assert position.approval_token_hash


def test_delete_job_removes_it_from_positions_list(client, db_session):
    admin_headers = _login(client, email="admin@ethara.ai", password="admin123")
    position = Position(
        id="pos-delete-jd",
        title="Delete JD Role",
        slug="delete-jd-role",
        department="Engineering",
        is_active=True,
        approval_status="posted",
        posted_at=datetime.now(UTC),
    )
    db_session.add(position)
    db_session.commit()

    response = client.delete(f"/api/v1/positions/{position.id}", headers=admin_headers)

    assert response.status_code == 200
    db_session.refresh(position)
    assert position.is_active is False
    assert position.approval_status == "deleted"
    list_response = client.get("/api/v1/positions", headers=admin_headers)
    assert list_response.status_code == 200
    assert position.id not in {row["id"] for row in list_response.json()}

    audit_actions = {
        row.action
        for row in db_session.query(AuditLog).filter(AuditLog.entity_id == position.id).all()
    }
    assert "position_deleted" in audit_actions


def test_public_approval_link_rejects_unauthorized_or_expired_requests(client, db_session, monkeypatch):
    _create_ta_user(db_session)
    ta_headers = _login(client, email="ta@ethara.ai", password="ta123")

    sent_messages: list[dict[str, str]] = []

    def fake_send_email(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str | None = None,
        cc_emails: list[str] | None = None,
    ) -> None:
        sent_messages.append({"to_email": to_email, "subject": subject, "body_text": body_text})

    monkeypatch.setattr(EmailService, "send_email", fake_send_email)

    create_response = client.post(
        "/api/v1/positions",
        headers=ta_headers,
        json={
            "title": "Lifecycle Operations Manager",
            "department": "Operations",
            "urgencyLevel": 2,
            "description": "Own lifecycle operations.",
            "experienceYears": 6,
            "salaryBracket": "18-24 LPA",
        },
    )
    assert create_response.status_code == 200
    position_id = create_response.json()["id"]
    position = db_session.get(Position, position_id)
    assert position is not None

    settings = get_settings()
    reject_link = _extract_link(sent_messages[0]["body_text"], "Reject")
    reject_url = urlparse(reject_link)
    original_token = reject_url.query.split("token=", maxsplit=1)[1]
    original_payload = decode_token(original_token, secret=settings.jwt_secret)
    request_id = original_payload["requestId"]

    unauthorized_token = create_token(
        subject=position.id,
        secret=settings.jwt_secret,
        expires_delta=timedelta(days=1),
        token_type="position_approval",
        extra={
            "approverEmail": "someoneelse@ethara.ai",
            "action": "reject",
            "requestId": request_id,
        },
    )
    unauthorized_response = client.get(f"/api/v1/public/positions/approval?token={unauthorized_token}")
    assert unauthorized_response.status_code == 401
    assert "unauthorized approver" in unauthorized_response.text.lower()

    reject_form_response = client.get(f"{reject_url.path}?{reject_url.query}")
    assert reject_form_response.status_code == 200
    assert "enter rejection reason" in reject_form_response.text.lower()

    reject_response = client.get(f"{reject_url.path}?{reject_url.query}&reason=Role%20scope%20changed")
    assert reject_response.status_code == 200
    assert "has been rejected" in reject_response.text.lower()

    db_session.refresh(position)
    assert position.approval_status == "rejected"
    assert position.reviewed_by_email == sent_messages[0]["to_email"]
    assert position.rejection_reason == "Role scope changed"

    expired_position = Position(
        id="pos-expired-approval",
        title="Expired Approval Role",
        slug="expired-approval-role",
        department="Operations",
        urgency_level=1,
        is_active=False,
        approval_status="pending_leadership_approval",
        requested_by="usr-ta",
        approval_recipient_email="approver1@example.com",
        approval_requested_at=datetime.now(UTC) - timedelta(days=2),
        approval_token_hash=hash_token("expired-request-id"),
        approval_token_expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    db_session.add(expired_position)
    db_session.commit()

    expired_token = create_token(
        subject=expired_position.id,
        secret=settings.jwt_secret,
        expires_delta=timedelta(days=1),
        token_type="position_approval",
        extra={
            "approverEmail": "approver1@example.com",
            "action": "reject",
            "requestId": "expired-request-id",
        },
    )
    expired_response = client.get(f"/api/v1/public/positions/approval?token={expired_token}")
    assert expired_response.status_code == 410
    assert "approval request has expired" in expired_response.text.lower()

    notifications = db_session.query(Notification).filter(Notification.title == "Job description rejected").all()
    user_ids = {notification.user_id for notification in notifications}
    assert "usr-ta" in user_ids
    assert "usr-admin" in user_ids
