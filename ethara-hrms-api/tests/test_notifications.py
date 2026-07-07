from datetime import UTC, datetime

from app.core.security import hash_password
from app.db.models import Candidate, Notification, NotificationType, Role, SourceType, User


def _login(client, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["accessToken"]


def test_employee_notifications_include_leave_dashboard_route(client, db_session):
    db_session.add(
        Notification(
            user_id="usr-employee",
            title="Leave Approved",
            message="Your casual leave has been fully approved",
            type=NotificationType.SUCCESS,
        )
    )
    db_session.commit()

    token = _login(client, "employee@ethara.ai", "employee123")
    response = client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["route"] == "/dashboard/employee/leave"


def test_manager_notifications_include_manager_leave_route(client, db_session):
    db_session.add(
        User(
            id="usr-manager",
            email="manager@ethara.ai",
            password_hash=hash_password("manager123"),
            name="Manager User",
            role=Role.MANAGER,
            is_active=True,
            email_verified_at=datetime.now(UTC),
        )
    )
    db_session.add(
        Notification(
            user_id="usr-manager",
            title="Leave Request Pending",
            message="Employee User applied for 2 day(s) casual leave",
            type=NotificationType.ACTION,
        )
    )
    db_session.commit()

    token = _login(client, "manager@ethara.ai", "manager123")
    response = client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["route"] == "/dashboard/manager/leaves"


def test_admin_candidate_notifications_include_candidate_detail_route(client, db_session):
    candidate = Candidate(
        id="cand-notif-admin",
        candidate_code="CAND-NOTIF-001",
        full_name="Notification Candidate",
        personal_email="candidate.notification@example.com",
        phone="9999999999",
        source_type=SourceType.DIRECT_APPLICATION,
        current_status="New Application",
    )
    db_session.add(candidate)
    db_session.add(
        Notification(
            user_id="usr-admin",
            candidate_id=candidate.id,
            title="Evaluation Assigned",
            message="A candidate has been assigned to you for evaluation.",
            type=NotificationType.ACTION,
        )
    )
    db_session.commit()

    token = _login(client, "admin@ethara.ai", "admin123")
    response = client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["candidateId"] == candidate.id
    assert payload[0]["candidateName"] == "Notification Candidate"
    assert payload[0]["route"] == f"/dashboard/candidates/{candidate.id}"


def test_candidate_notifications_include_portal_route(client, db_session):
    db_session.add(
        User(
            id="usr-candidate",
            email="candidate@ethara.ai",
            password_hash=hash_password("candidate123"),
            name="Portal Candidate",
            role=Role.CANDIDATE,
            is_active=True,
            email_verified_at=datetime.now(UTC),
        )
    )
    candidate = Candidate(
        id="cand-notif-portal",
        candidate_code="CAND-NOTIF-002",
        full_name="Portal Candidate",
        personal_email="candidate@ethara.ai",
        phone="8888888888",
        source_type=SourceType.DIRECT_APPLICATION,
        portal_user_id="usr-candidate",
        current_status="Contract Sent",
    )
    db_session.add(candidate)
    db_session.add(
        Notification(
            user_id="usr-candidate",
            candidate_id=candidate.id,
            title="Contract Awaiting Signature",
            message="Your offer letter is ready for signature.",
            type=NotificationType.WARNING,
        )
    )
    db_session.commit()

    token = _login(client, "candidate@ethara.ai", "candidate123")
    response = client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["route"] == "/portal/contract"
