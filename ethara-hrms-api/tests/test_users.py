from datetime import UTC, datetime

from sqlalchemy import select

from app.core.security import hash_password
from app.db.models import Role, User


def test_admin_can_reset_user_password_and_email_temp_password(
    client, db_session, auth_headers, monkeypatch
):
    sent: dict[str, str] = {}

    def capture_email(self, *, to_email, subject, body_text, body_html=None, cc_emails=None):
        sent["to_email"] = to_email
        sent["subject"] = subject
        sent["body_text"] = body_text

    monkeypatch.setattr("app.api.routes.config.EmailService.send_email", capture_email)

    hr_user = db_session.scalar(select(User).where(User.email == "hr@ethara.ai"))
    assert hr_user is not None

    response = client.post(f"/api/v1/users/{hr_user.id}/reset-password", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["email"] == "hr@ethara.ai"
    assert sent["to_email"] == "hr@ethara.ai"
    assert "Temporary password:" in sent["body_text"]

    temp_password = sent["body_text"].split("Temporary password: ", 1)[1].split("\n", 1)[0]

    old_login = client.post("/api/v1/auth/login", json={"email": "hr@ethara.ai", "password": "hr123"})
    assert old_login.status_code == 401

    new_login = client.post(
        "/api/v1/auth/login",
        json={"email": "hr@ethara.ai", "password": temp_password},
    )
    assert new_login.status_code == 200, new_login.text
    assert new_login.json()["user"]["mustChangePassword"] is True


def test_users_list_includes_registered_candidates(client, db_session, auth_headers):
    now = datetime.now(UTC)
    candidate_user = User(
        id="usr-candidate-visible",
        email="candidate-visible@example.com",
        password_hash=hash_password("candidate123"),
        name="Candidate Visible",
        role=Role.CANDIDATE,
        roles=[Role.CANDIDATE.value],
        is_active=True,
        email_verified_at=now,
    )
    db_session.add(candidate_user)
    db_session.commit()

    response = client.get("/api/v1/users", headers=auth_headers)

    assert response.status_code == 200, response.text
    users = response.json()
    visible = next((user for user in users if user["id"] == candidate_user.id), None)
    assert visible is not None
    assert visible["role"] == Role.CANDIDATE.value
    assert visible["roles"] == [Role.CANDIDATE.value]


def test_admin_can_update_same_privilege_member_roles(client, db_session, auth_headers):
    now = datetime.now(UTC)
    peer_admin = User(
        id="usr-admin-peer",
        email="admin-peer@ethara.ai",
        password_hash=hash_password("admin123"),
        name="Peer Admin",
        role=Role.ADMIN,
        roles=[Role.ADMIN.value],
        is_active=True,
        email_verified_at=now,
    )
    db_session.add(peer_admin)
    db_session.commit()

    response = client.patch(
        f"/api/v1/users/{peer_admin.id}",
        headers=auth_headers,
        json={
            "name": peer_admin.name,
            "email": peer_admin.email,
            "role": Role.ADMIN.value,
            "roles": [Role.ADMIN.value, Role.HR.value],
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["role"] == Role.ADMIN.value
    assert response.json()["roles"] == [Role.ADMIN.value, Role.HR.value]


def test_leadership_can_assign_higher_member_role(client, db_session):
    now = datetime.now(UTC)
    leader = User(
        id="usr-leadership-role-admin",
        email="leadership-role-admin@ethara.ai",
        password_hash=hash_password("leader123"),
        name="Leadership Role Admin",
        role=Role.LEADERSHIP,
        roles=[Role.LEADERSHIP.value],
        is_active=True,
        email_verified_at=now,
    )
    target = User(
        id="usr-role-target",
        email="role-target@ethara.ai",
        password_hash=hash_password("target123"),
        name="Role Target",
        role=Role.EMPLOYEE,
        roles=[Role.EMPLOYEE.value],
        is_active=True,
        email_verified_at=now,
    )
    db_session.add_all([leader, target])
    db_session.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": leader.email, "password": "leader123"},
    )
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    response = client.patch(
        f"/api/v1/users/{target.id}",
        headers=headers,
        json={
            "name": target.name,
            "email": target.email,
            "role": Role.SUPER_ADMIN.value,
            "roles": [Role.SUPER_ADMIN.value],
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["role"] == Role.SUPER_ADMIN.value
    assert response.json()["roles"] == [Role.SUPER_ADMIN.value]
