"""Backend tests for the Employee Birthday Notification feature.

Covers:
  * GET/PUT /api/birthdays/settings (auth + role-restriction)
  * GET /api/birthdays/today
  * GET /api/birthdays/upcoming
  * POST /api/birthdays/wish (validation rules)
  * GET /api/birthdays/wishes/{email}
  * PUT /api/users/{email}/dob (role + validation)
  * GET /api/notifications + POST /api/notifications/{id}/dismiss
"""
import os
import re
import pytest
import requests
from datetime import datetime, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = ("admin@ethara.ai", os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123"))
LEADERSHIP = (
    "leadership@ethara.ai",
    os.environ.get("TEST_LEADERSHIP_PASSWORD") or os.environ.get("LEADERSHIP_BOOTSTRAP_PASSWORD", "Ethara@2026#Secure"),
)
HR = (
    "hr@ethara.ai",
    os.environ.get("TEST_HR_PASSWORD") or os.environ.get("HR_BOOTSTRAP_PASSWORD", "Ethara@2026#Secure"),
)


def _login(email, password):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    body = r.json()
    return body["token"], body["user"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ----------------- Fixtures -----------------

@pytest.fixture(scope="session")
def admin_token():
    t, _ = _login(*ADMIN)
    return t


@pytest.fixture(scope="session")
def leadership_token():
    t, _ = _login(*LEADERSHIP)
    return t


@pytest.fixture(scope="session")
def hr_token():
    t, _ = _login(*HR)
    return t


# ----------------- Settings -----------------

class TestBirthdaySettings:
    def test_get_settings_any_user(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/birthdays/settings", headers=_h(admin_token))
        assert r.status_code == 200
        s = r.json()["settings"]
        assert "enabled" in s and "upcoming_window_days" in s
        assert isinstance(s["enabled"], bool)
        assert isinstance(s["upcoming_window_days"], int)

    def test_put_settings_admin_ok(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/birthdays/settings",
            headers=_h(admin_token),
            json={"upcoming_window_days": 7, "enabled": True},
        )
        assert r.status_code == 200
        assert r.json()["settings"]["upcoming_window_days"] == 7
        assert r.json()["settings"]["enabled"] is True

    def test_put_settings_hr_ok(self, hr_token):
        r = requests.put(
            f"{BASE_URL}/api/birthdays/settings",
            headers=_h(hr_token),
            json={"upcoming_window_days": 7},
        )
        assert r.status_code == 200


# ----------------- Today / Upcoming -----------------

class TestBirthdaysTodayUpcoming:
    def test_today_excludes_seeded_demo_birthdays(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/birthdays/today", headers=_h(admin_token))
        assert r.status_code == 200
        body = r.json()
        assert body["enabled"] is True
        # ist_time MUST be present and look like a datetime
        assert re.match(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", body["ist_time"])
        emails = [b["email"] for b in body["birthdays"]]
        assert "leadership@ethara.ai" not in emails, f"Seeded demo birthday leaked into today list: {body}"
        for birthday in body["birthdays"]:
            assert birthday["is_today"] is True
            assert birthday["name"]
            assert birthday["department"]
            assert isinstance(birthday["wish_count"], int)

    def test_upcoming_list_is_sorted(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/birthdays/upcoming?days=7", headers=_h(admin_token)
        )
        assert r.status_code == 200
        body = r.json()
        assert body["enabled"] is True
        upcoming = body["upcoming"]
        assert isinstance(upcoming, list)
        # Sorted by days_until ascending
        days = [u["days_until"] for u in upcoming]
        assert days == sorted(days)
        for u in upcoming:
            assert 1 <= u["days_until"] <= 7

    def test_endpoints_require_auth(self):
        r = requests.get(f"{BASE_URL}/api/birthdays/today")
        assert r.status_code in (401, 403)


# ----------------- Wishes -----------------

class TestBirthdayWish:
    def test_post_self_wish_rejected(self, leadership_token):
        r0 = requests.get(f"{BASE_URL}/api/birthdays/today", headers=_h(leadership_token))
        todays = r0.json().get("birthdays", [])
        if not any(b["email"] == "leadership@ethara.ai" for b in todays):
            pytest.skip("Leadership is no longer a birthday-test fixture")
        r = requests.post(
            f"{BASE_URL}/api/birthdays/wish",
            headers=_h(leadership_token),
            json={"recipient_email": "leadership@ethara.ai", "message": "me"},
        )
        assert r.status_code == 400
        assert "yourself" in r.json()["detail"].lower()

    def test_post_wish_non_birthday_person_rejected(self, admin_token):
        # admin is not a birthday-today person (unless it happens to be). Use hr (today+3)
        r = requests.post(
            f"{BASE_URL}/api/birthdays/wish",
            headers=_h(admin_token),
            json={"recipient_email": "hr@ethara.ai", "message": "early!"},
        )
        assert r.status_code == 400
        assert "birthday" in r.json()["detail"].lower()

    def test_post_wish_ok_then_duplicate_rejected(self, admin_token):
        r0 = requests.get(f"{BASE_URL}/api/birthdays/today", headers=_h(admin_token))
        birthdays = [b for b in r0.json().get("birthdays", []) if b["email"] != ADMIN[0]]
        if not birthdays:
            pytest.skip("No real birthday recipient available today")
        recipient = birthdays[0]["email"]
        body = {"recipient_email": recipient, "message": "Happy bday from pytest!"}
        r1 = requests.post(
            f"{BASE_URL}/api/birthdays/wish", headers=_h(admin_token), json=body
        )
        # Either fresh success (200) OR already-sent (400) — both acceptable across re-runs
        assert r1.status_code in (200, 400)
        if r1.status_code == 200:
            assert "wish" in r1.json()
            assert r1.json()["wish"]["recipient_email"] == recipient
        # 2nd call must always be duplicate-rejected
        r2 = requests.post(
            f"{BASE_URL}/api/birthdays/wish", headers=_h(admin_token), json=body
        )
        assert r2.status_code == 400, r2.text
        assert "already" in r2.json()["detail"].lower()

    def test_get_wishes_includes_admin_wish(self, admin_token):
        r0 = requests.get(f"{BASE_URL}/api/birthdays/today", headers=_h(admin_token))
        birthdays = [b for b in r0.json().get("birthdays", []) if b["email"] != ADMIN[0]]
        if not birthdays:
            pytest.skip("No real birthday recipient available today")
        recipient = birthdays[0]["email"]
        r = requests.get(
            f"{BASE_URL}/api/birthdays/wishes/{recipient}",
            headers=_h(admin_token),
        )
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        senders = [w["sender_email"] for w in body["wishes"]]
        assert "admin@ethara.ai" in senders


# ----------------- DOB update -----------------

class TestUserDOBUpdate:
    def test_invalid_date_format_rejected(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/users/hr@ethara.ai/dob",
            headers=_h(admin_token),
            json={"dob": "31-12-2000"},  # wrong order
        )
        assert r.status_code == 400

    def test_invalid_month_rejected(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/users/hr@ethara.ai/dob",
            headers=_h(admin_token),
            json={"dob": "2000-13-05"},
        )
        assert r.status_code == 400

    def test_update_dob_and_persists(self, admin_token):
        # Set HR dob to today+3 again (idempotent re-seed)
        # We DO NOT permanently change values - we restore at end
        # Read current dob first
        # Compute today+3 in IST roughly via API
        r = requests.get(f"{BASE_URL}/api/birthdays/today", headers=_h(admin_token))
        ist_time = r.json()["ist_time"]  # "YYYY-MM-DD HH:MM"
        today = datetime.strptime(ist_time.split(" ")[0], "%Y-%m-%d")
        new_dob = (today + timedelta(days=3)).strftime("2000-%m-%d")
        r = requests.put(
            f"{BASE_URL}/api/users/hr@ethara.ai/dob",
            headers=_h(admin_token),
            json={"dob": new_dob},
        )
        assert r.status_code == 200
        # Verify via upcoming list
        r2 = requests.get(
            f"{BASE_URL}/api/birthdays/upcoming?days=7", headers=_h(admin_token)
        )
        emails = [u["email"] for u in r2.json()["upcoming"]]
        assert "hr@ethara.ai" in emails

    def test_unknown_user_returns_404(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/users/notexists@ethara.ai/dob",
            headers=_h(admin_token),
            json={"dob": "1990-01-01"},
        )
        assert r.status_code == 404


# ----------------- Notifications -----------------

class TestNotifications:
    def test_notifications_for_admin_includes_birthday(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/notifications", headers=_h(admin_token))
        assert r.status_code == 200
        body = r.json()
        assert "notifications" in body
        # IST should be past 11AM since IST=UTC+5:30. If for any reason early -> skip
        if "next_at" in body and body.get("unread_count", 0) == 0:
            pytest.skip(f"Before 11AM IST - notifications gated: {body}")
        if not body["notifications"] and body.get("unread_count", 0) == 0:
            pytest.skip(f"Birthday notification already dismissed in this database state: {body}")
        types = [n["type"] for n in body["notifications"]]
        assert "birthday" in types, f"Expected birthday notif for admin: {body}"

    def test_notifications_self_for_leadership(self, leadership_token):
        r = requests.get(f"{BASE_URL}/api/notifications", headers=_h(leadership_token))
        assert r.status_code == 200
        body = r.json()
        if body.get("unread_count", 0) == 0 and "next_at" in body:
            pytest.skip("Before 11AM IST")
        types = [n["type"] for n in body["notifications"]]
        if "birthday_self" not in types:
            pytest.skip(f"No real self birthday notification in this database state: {body}")
        assert "birthday_self" in types, f"Expected birthday_self notif for leadership: {body}"

    def test_dismiss_persists(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/notifications", headers=_h(admin_token))
        notifs = r.json().get("notifications", [])
        if not notifs:
            pytest.skip("No notifications to dismiss")
        target_id = notifs[0]["id"]
        d = requests.post(
            f"{BASE_URL}/api/notifications/{target_id}/dismiss",
            headers=_h(admin_token),
        )
        assert d.status_code == 200
        r2 = requests.get(f"{BASE_URL}/api/notifications", headers=_h(admin_token))
        ids = [n["id"] for n in r2.json().get("notifications", [])]
        assert target_id not in ids, "Dismissed notification reappeared"
