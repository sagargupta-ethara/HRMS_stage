from datetime import UTC, date, datetime

import pytest

from app.core.security import hash_password
from app.db.models import EmployeeProfile, Role, User


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


def _assign_employee_manager(db_session, manager_id: str) -> EmployeeProfile:
    employee_profile = db_session.get(EmployeeProfile, "emp-001")
    assert employee_profile is not None
    employee_profile.manager_id = manager_id
    db_session.add(employee_profile)
    db_session.commit()
    return employee_profile


def test_employee_leave_apply_requires_manager_assignment(client):
    token = _login(client, "employee@ethara.ai", "employee123")

    response = client.post(
        "/api/v1/leave/apply",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "leave_type": "casual",
            "start_date": date(2026, 5, 22).isoformat(),
            "end_date": date(2026, 5, 23).isoformat(),
            "reason": "Personal work",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "No reporting manager is assigned to your employee profile. Please contact HR."


def test_employee_leave_apply_routes_to_manager_and_manager_can_approve(client, db_session):
    _create_manager(db_session, user_id="usr-manager", email="manager@ethara.ai")
    _assign_employee_manager(db_session, "usr-manager")

    employee_token = _login(client, "employee@ethara.ai", "employee123")

    apply_response = client.post(
        "/api/v1/leave/apply",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "leave_type": "casual",
            "start_date": date(2026, 5, 22).isoformat(),
            "end_date": date(2026, 5, 23).isoformat(),
            "reason": "Family function",
        },
    )
    assert apply_response.status_code == 201
    leave_request = apply_response.json()
    assert leave_request["status"] == "pending"
    assert leave_request["managerId"] == "usr-manager"
    assert leave_request["managerName"] == "Manager User"

    manager_token = _login(client, "manager@ethara.ai", "manager123")

    inbox_response = client.get(
        "/api/v1/leave/manager/inbox",
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert inbox_response.status_code == 200
    inbox = inbox_response.json()
    assert len(inbox) == 1
    assert inbox[0]["id"] == leave_request["id"]
    assert inbox[0]["managerId"] == "usr-manager"

    action_response = client.patch(
        f"/api/v1/leave/{leave_request['id']}/manager-action",
        headers={"Authorization": f"Bearer {manager_token}"},
        json={"action": "approved", "remarks": "Approved"},
    )
    assert action_response.status_code == 200
    assert action_response.json()["status"] == "manager_approved"
    assert action_response.json()["managerAction"] == "approved"

    my_requests_response = client.get(
        "/api/v1/leave/my",
        headers={"Authorization": f"Bearer {employee_token}"},
    )
    assert my_requests_response.status_code == 200
    my_requests = my_requests_response.json()
    assert len(my_requests) == 1
    assert my_requests[0]["status"] == "manager_approved"
    assert my_requests[0]["managerName"] == "Manager User"


@pytest.mark.parametrize("action, expected_status", [("approved", "approved"), ("rejected", "rejected")])
def test_admin_can_action_any_pending_leave_and_employee_dashboard_reflects_status(
    client,
    db_session,
    action,
    expected_status,
):
    _create_manager(db_session, user_id="usr-manager", email="manager@ethara.ai")
    _assign_employee_manager(db_session, "usr-manager")

    employee_token = _login(client, "employee@ethara.ai", "employee123")
    admin_token = _login(client, "admin@ethara.ai", "admin123")

    apply_response = client.post(
        "/api/v1/leave/apply",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "leave_type": "casual",
            "start_date": date(2026, 5, 22).isoformat(),
            "end_date": date(2026, 5, 23).isoformat(),
            "reason": "Admin routing test",
        },
    )
    assert apply_response.status_code == 201
    leave_request = apply_response.json()

    admin_action_response = client.patch(
        f"/api/v1/leave/{leave_request['id']}/hr-action",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"action": action, "remarks": f"Admin {action}"},
    )
    assert admin_action_response.status_code == 200
    assert admin_action_response.json()["status"] == expected_status
    assert admin_action_response.json()["hrReviewedBy"] == "usr-admin"

    my_requests_response = client.get(
        "/api/v1/leave/my",
        headers={"Authorization": f"Bearer {employee_token}"},
    )
    assert my_requests_response.status_code == 200
    my_requests = my_requests_response.json()
    assert len(my_requests) == 1
    assert my_requests[0]["status"] == expected_status
    assert my_requests[0]["managerName"] == "Manager User"


def test_only_tagged_manager_can_action_leave_request(client, db_session):
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
    other_manager_token = _login(client, "other-manager@ethara.ai", "other123")

    apply_response = client.post(
        "/api/v1/leave/apply",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "leave_type": "casual",
            "start_date": date(2026, 5, 22).isoformat(),
            "end_date": date(2026, 5, 23).isoformat(),
            "reason": "Manager authorization test",
        },
    )
    assert apply_response.status_code == 201
    leave_request = apply_response.json()

    action_response = client.patch(
        f"/api/v1/leave/{leave_request['id']}/manager-action",
        headers={"Authorization": f"Bearer {other_manager_token}"},
        json={"action": "approved", "remarks": "Should not work"},
    )
    assert action_response.status_code == 403
    assert action_response.json()["detail"] == "Not authorized"


def test_manager_cannot_use_global_hr_action_endpoint(client, db_session):
    _create_manager(db_session, user_id="usr-manager", email="manager@ethara.ai")
    _assign_employee_manager(db_session, "usr-manager")

    employee_token = _login(client, "employee@ethara.ai", "employee123")
    manager_token = _login(client, "manager@ethara.ai", "manager123")

    apply_response = client.post(
        "/api/v1/leave/apply",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "leave_type": "casual",
            "start_date": date(2026, 5, 22).isoformat(),
            "end_date": date(2026, 5, 23).isoformat(),
            "reason": "Global approval restriction test",
        },
    )
    assert apply_response.status_code == 201
    leave_request = apply_response.json()

    action_response = client.patch(
        f"/api/v1/leave/{leave_request['id']}/hr-action",
        headers={"Authorization": f"Bearer {manager_token}"},
        json={"action": "approved", "remarks": "Should not work"},
    )
    assert action_response.status_code == 403
    assert action_response.json()["detail"] == "Not authorized"
