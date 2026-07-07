from datetime import UTC, date, datetime

from app.core.security import hash_password
from app.db.models import EmployeeAsset, EmployeeProfile, Role, User
from app.api.routes import separation as separation_routes


def _login(client, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["accessToken"]


def _create_manager(
    db_session,
    *,
    user_id: str,
    email: str,
    password: str = "manager123",
    name: str = "Manager User",
):
    db_session.add(
        User(
            id=user_id,
            email=email,
            password_hash=hash_password(password),
            name=name,
            role=Role.MANAGER,
            is_active=True,
            email_verified_at=datetime.now(UTC),
        )
    )
    db_session.commit()


def _assign_employee_manager(db_session, manager_id: str) -> EmployeeProfile:
    employee_profile = db_session.get(EmployeeProfile, "emp-001")
    assert employee_profile is not None
    employee_profile.manager_id = manager_id
    db_session.add(employee_profile)
    db_session.commit()
    return employee_profile


def test_employee_resignation_requires_manager_assignment(client):
    token = _login(client, "employee@ethara.ai", "employee123")

    response = client.post(
        "/api/v1/separation/resign",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "reason": "Personal Reasons",
            "early_relieving_requested": False,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "No reporting manager is assigned to your employee profile. Please contact HR."


def test_employee_resignation_routes_to_same_assigned_manager_as_leave(client, db_session, monkeypatch):
    monkeypatch.setattr(separation_routes.EmailService, "send_email", lambda self, **kwargs: None)

    _create_manager(db_session, user_id="usr-manager", email="manager@ethara.ai")
    _create_manager(
        db_session,
        user_id="usr-other-manager",
        email="other-manager@ethara.ai",
        password="other123",
        name="Other Manager",
    )
    _assign_employee_manager(db_session, "usr-manager")

    employee_token = _login(client, "employee@ethara.ai", "employee123")
    manager_token = _login(client, "manager@ethara.ai", "manager123")
    other_manager_token = _login(client, "other-manager@ethara.ai", "other123")

    leave_response = client.post(
        "/api/v1/leave/apply",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "leave_type": "casual",
            "start_date": date(2026, 6, 3).isoformat(),
            "end_date": date(2026, 6, 4).isoformat(),
            "reason": "Family event",
        },
    )
    assert leave_response.status_code == 201
    leave_request = leave_response.json()
    assert leave_request["managerId"] == "usr-manager"

    resignation_response = client.post(
        "/api/v1/separation/resign",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "reason": "Better Opportunity / Higher Pay",
            "remarks": "Moving to a new role.",
            "manager_id": "usr-other-manager",
        },
    )
    assert resignation_response.status_code == 201
    resignation = resignation_response.json()
    assert resignation["managerId"] == "usr-manager"
    assert resignation["managerName"] == "Manager User"
    assert resignation["managerId"] == leave_request["managerId"]

    manager_inbox = client.get(
        "/api/v1/separation/manager",
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert manager_inbox.status_code == 200
    assert len(manager_inbox.json()) == 1
    assert manager_inbox.json()[0]["id"] == resignation["id"]

    other_manager_inbox = client.get(
        "/api/v1/separation/manager",
        headers={"Authorization": f"Bearer {other_manager_token}"},
    )
    assert other_manager_inbox.status_code == 200
    assert other_manager_inbox.json() == []


def test_hr_classifies_resignation_reason_before_manager_approval(client, db_session, monkeypatch):
    monkeypatch.setattr(separation_routes.EmailService, "send_email", lambda self, **kwargs: None)

    _create_manager(db_session, user_id="usr-manager", email="manager@ethara.ai")
    _assign_employee_manager(db_session, "usr-manager")

    employee_token = _login(client, "employee@ethara.ai", "employee123")
    manager_token = _login(client, "manager@ethara.ai", "manager123")
    hr_token = _login(client, "hr@ethara.ai", "hr123")

    resignation_response = client.post(
        "/api/v1/separation/resign",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "remarks": "I am applying for resignation due to personal circumstances.",
            "early_relieving_requested": False,
        },
    )
    assert resignation_response.status_code == 201
    resignation = resignation_response.json()
    assert resignation["reason"] is None
    assert resignation["remarks"] == "I am applying for resignation due to personal circumstances."

    blocked_approval = client.patch(
        f"/api/v1/separation/{resignation['id']}/manager-action",
        headers={"Authorization": f"Bearer {manager_token}"},
        json={"action": "approve"},
    )
    assert blocked_approval.status_code == 409

    classified = client.patch(
        f"/api/v1/separation/{resignation['id']}/reason",
        headers={"Authorization": f"Bearer {hr_token}"},
        json={"reason": "Personal Reasons"},
    )
    assert classified.status_code == 200
    assert classified.json()["reason"] == "Personal Reasons"

    approved = client.patch(
        f"/api/v1/separation/{resignation['id']}/manager-action",
        headers={"Authorization": f"Bearer {manager_token}"},
        json={"action": "approve"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "manager_approved"


def test_no_show_deactivates_employee_and_marks_blacklisted_status(client, db_session, auth_headers):
    db_session.add(
        EmployeeAsset(
            id="asset-001",
            employee_profile_id="emp-001",
            asset_type="laptop",
            model="ThinkPad",
            status="assigned",
        )
    )
    db_session.commit()

    response = client.post(
        "/api/v1/separation/terminate",
        headers=auth_headers,
        json={
            "employee_profile_id": "emp-001",
            "separation_type": "no_show",
            "reason": "Employee did not report after joining confirmation.",
            "effective_date": date(2026, 6, 5).isoformat(),
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["separationType"] == "no_show"
    assert body["separationTypeLabel"] == "No Show"

    employee_user = db_session.get(User, "usr-employee")
    assert employee_user is not None
    assert employee_user.is_active is False

    asset = db_session.get(EmployeeAsset, "asset-001")
    assert asset is not None
    assert asset.status == "deactivation_required"

    detail = client.get("/api/v1/employees/emp-001", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["currentEmployeeStatus"] == "Blacklisted: No Show"
