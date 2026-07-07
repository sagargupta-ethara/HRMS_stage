import csv
import io
from datetime import UTC, date, datetime

from app.core.security import hash_password
from app.db.models import (
    AttendanceRecord,
    AttendanceSource,
    AttendanceStatus,
    EmployeeProfile,
    Role,
    User,
)
from app.services.attendance_sync import upsert_attendance_rows


def _login(client, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["accessToken"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed_other_employee(db_session) -> None:
    now = datetime.now(UTC)
    db_session.add(
        User(
            id="usr-employee-2",
            email="employee2@ethara.ai",
            password_hash=hash_password("employee123"),
            name="Employee Two",
            role=Role.EMPLOYEE,
            is_active=True,
            email_verified_at=now,
        )
    )
    db_session.add(
        EmployeeProfile(
            id="emp-002",
            user_id="usr-employee-2",
            full_name="Employee Two",
            ethara_email="employee2@ethara.ai",
            personal_email="employee2.personal@example.com",
            employee_code="EMP-002",
            department="Operations",
            designation="Coordinator",
        )
    )
    db_session.commit()


def _seed_attendance(db_session) -> None:
    db_session.add_all(
        [
            AttendanceRecord(
                id="att-001",
                employee_profile_id="emp-001",
                employee_code="EMP-001",
                employee_name="Employee User",
                department="Engineering",
                attendance_date=date(2026, 6, 1),
                in_time=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
                out_time=datetime(2026, 6, 1, 18, 0, tzinfo=UTC),
                worked_hours=9,
                status=AttendanceStatus.PRESENT,
                source=AttendanceSource.BIOMETRIC,
                original_in_time=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
                original_out_time=datetime(2026, 6, 1, 18, 0, tzinfo=UTC),
                original_status=AttendanceStatus.PRESENT,
                is_final=True,
            ),
            AttendanceRecord(
                id="att-002",
                employee_profile_id="emp-002",
                employee_code="EMP-002",
                employee_name="Employee Two",
                department="Operations",
                attendance_date=date(2026, 6, 1),
                status=AttendanceStatus.ABSENT,
                source=AttendanceSource.BIOMETRIC,
                original_status=AttendanceStatus.ABSENT,
                is_final=True,
            ),
            AttendanceRecord(
                id="att-003",
                employee_profile_id=None,
                employee_code="ESSL-999",
                employee_name="Biometric Only",
                department=None,
                attendance_date=date(2026, 6, 1),
                status=AttendanceStatus.PRESENT,
                source=AttendanceSource.BIOMETRIC,
                original_status=AttendanceStatus.PRESENT,
                is_final=True,
            ),
        ]
    )
    db_session.commit()


def test_hr_can_list_all_attendance_and_employee_only_sees_own(client, db_session):
    _seed_other_employee(db_session)
    _seed_attendance(db_session)

    hr_token = _login(client, "hr@ethara.ai", "hr123")
    employee_token = _login(client, "employee@ethara.ai", "employee123")

    all_response = client.get(
        "/api/v1/attendance/list?from=2026-06-01&to=2026-06-01",
        headers=_auth(hr_token),
    )
    assert all_response.status_code == 200
    assert all_response.json()["total"] == 3

    my_response = client.get(
        "/api/v1/attendance/me?from=2026-06-01&to=2026-06-01",
        headers=_auth(employee_token),
    )
    assert my_response.status_code == 200
    assert my_response.json()["total"] == 1
    assert my_response.json()["data"][0]["employeeCode"] == "EMP-001"
    assert all(row["employeeCode"] != "ESSL-999" for row in my_response.json()["data"])

    blocked_response = client.get(
        "/api/v1/attendance/list?from=2026-06-01&to=2026-06-01",
        headers=_auth(employee_token),
    )
    assert blocked_response.status_code == 403


def test_attendance_matrix_is_date_column_scoped_and_omits_out_time(client, db_session):
    _seed_other_employee(db_session)
    _seed_attendance(db_session)

    hr_token = _login(client, "hr@ethara.ai", "hr123")
    employee_token = _login(client, "employee@ethara.ai", "employee123")

    staff_response = client.get(
        "/api/v1/attendance/matrix?from=2026-06-01&to=2026-06-01",
        headers=_auth(hr_token),
    )
    assert staff_response.status_code == 200
    staff_payload = staff_response.json()
    assert staff_payload["dates"] == ["2026-06-01"]
    assert staff_payload["total"] == 3

    unmapped = next(
        row for row in staff_payload["data"] if row["employeeCode"] == "ESSL-999"
    )
    assert unmapped["employeeProfileId"] is None
    assert "outTime" not in unmapped["dates"]["2026-06-01"]

    my_response = client.get(
        "/api/v1/attendance/me/matrix?from=2026-06-01&to=2026-06-01",
        headers=_auth(employee_token),
    )
    assert my_response.status_code == 200
    my_payload = my_response.json()
    assert my_payload["dates"] == ["2026-06-01"]
    assert my_payload["total"] == 1
    assert my_payload["data"][0]["employeeCode"] == "EMP-001"
    assert "outTime" not in my_payload["data"][0]["dates"]["2026-06-01"]

    blocked_response = client.get(
        "/api/v1/attendance/matrix?from=2026-06-01&to=2026-06-01",
        headers=_auth(employee_token),
    )
    assert blocked_response.status_code == 403


def test_hr_edit_requires_reason_and_preserves_original_biometric_values(client, db_session):
    _seed_other_employee(db_session)
    _seed_attendance(db_session)
    hr_token = _login(client, "hr@ethara.ai", "hr123")

    missing_reason = client.patch(
        "/api/v1/attendance/att-001",
        headers=_auth(hr_token),
        json={"inTime": "10:00", "outTime": "18:30", "status": "present", "reason": ""},
    )
    assert missing_reason.status_code == 422

    response = client.patch(
        "/api/v1/attendance/att-001",
        headers=_auth(hr_token),
        json={
            "inTime": "10:00",
            "outTime": "18:30",
            "status": "half_day",
            "reason": "Late biometric correction",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "half_day"
    assert payload["source"] == "manual"
    assert payload["isEdited"] is True
    assert payload["originalStatus"] == "present"
    assert payload["originalInTime"].startswith("2026-06-01T09:00:00")
    assert payload["workedHours"] == 8.5


def test_attendance_exports_staff_filters_and_employee_scope(client, db_session):
    _seed_other_employee(db_session)
    _seed_attendance(db_session)

    hr_token = _login(client, "hr@ethara.ai", "hr123")
    employee_token = _login(client, "employee@ethara.ai", "employee123")

    staff_response = client.get(
        "/api/v1/attendance/export?from=2026-06-01&to=2026-06-01&status=present",
        headers=_auth(hr_token),
    )
    assert staff_response.status_code == 200
    assert "text/csv" in staff_response.headers["content-type"]
    staff_rows = list(csv.reader(io.StringIO(staff_response.text)))
    assert staff_rows[0][4] == "Jun"
    assert staff_rows[1][:5] == [
        "Employee Code",
        "Employee Name",
        "Department",
        "Designation",
        "01/06/2026",
    ]
    assert "Out Time" not in staff_rows[1]
    assert "Worked Hours" not in staff_rows[1]
    emp_001 = next(row for row in staff_rows[2:] if row[0] == "EMP-001")
    assert emp_001[4] == "Present"
    assert all(row[0] != "EMP-002" for row in staff_rows[2:])

    my_response = client.get(
        "/api/v1/attendance/me/export?from=2026-06-01&to=2026-06-01",
        headers=_auth(employee_token),
    )
    assert my_response.status_code == 200
    my_rows = list(csv.reader(io.StringIO(my_response.text)))
    assert my_rows[0][4] == "Jun"
    assert my_rows[1][4] == "01/06/2026"
    assert my_rows[2][0] == "EMP-001"
    assert my_rows[2][4] == "Present"
    assert all(row[0] != "EMP-002" for row in my_rows[2:])


def test_hr_can_sync_year_to_date(monkeypatch, client, db_session):
    monkeypatch.setattr(
        "app.api.routes.attendance.attendance_today",
        lambda: date(2026, 1, 3),
    )

    def fake_fetch(sync_date: date) -> list[dict]:
        if sync_date != date(2026, 1, 2):
            return []
        return [
            {
                "EmployeeCode": "EMP-001",
                "EmployeeName": "Employee User",
                "AttendanceDate": sync_date,
                "InTime": datetime(2026, 1, 2, 9, 0),
                "OutTime": datetime(2026, 1, 2, 18, 15),
                "Status": "Present",
            },
            {
                "EmployeeCode": "MISSING",
                "EmployeeName": "Missing User",
                "AttendanceDate": sync_date,
                "Status": "Absent",
            },
        ]

    monkeypatch.setattr("app.services.attendance_sync.fetch_essl_summary", fake_fetch)
    hr_token = _login(client, "hr@ethara.ai", "hr123")

    response = client.post(
        "/api/v1/attendance/sync-year?year=2026",
        headers=_auth(hr_token),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["from"] == "2026-01-01"
    assert payload["to"] == "2026-01-03"
    assert payload["days"] == 3
    assert payload["rowsSeen"] == 2
    assert payload["rowsSynced"] == 2
    assert payload["unmappedCodes"] == ["MISSING"]

    record = (
        db_session.query(AttendanceRecord)
        .filter_by(attendance_date=date(2026, 1, 2), employee_code="EMP-001")
        .one()
    )
    assert record.employee_profile_id == "emp-001"
    assert record.worked_hours == 9.25
    unmapped_record = (
        db_session.query(AttendanceRecord)
        .filter_by(attendance_date=date(2026, 1, 2), employee_code="MISSING")
        .one()
    )
    assert unmapped_record.employee_profile_id is None
    assert unmapped_record.employee_name == "Missing User"


def test_attendance_upsert_maps_by_employee_code_and_reports_unmapped(db_session):
    rows_synced, unmapped = upsert_attendance_rows(
        db_session,
        sync_date=date(2026, 6, 2),
        rows=[
            {
                "EmployeeCode": "EMP-001",
                "EmployeeName": "Employee User",
                "AttendanceDate": date(2026, 6, 2),
                "InTime": datetime(2026, 6, 2, 9, 15),
                "OutTime": datetime(2026, 6, 2, 18, 0),
                "Status": "Present ",
            },
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 2),
                "Status": "Absent ",
            },
        ],
    )
    db_session.commit()

    assert rows_synced == 2
    assert unmapped == ["UNKNOWN"]
    record = db_session.query(AttendanceRecord).filter_by(employee_code="EMP-001").one()
    assert record is not None
    assert record.employee_profile_id == "emp-001"
    assert record.status == AttendanceStatus.PRESENT
    assert record.worked_hours == 8.75
    unmapped_record = db_session.query(AttendanceRecord).filter_by(employee_code="UNKNOWN").one()
    assert unmapped_record.employee_profile_id is None
    assert unmapped_record.employee_name == "Missing Person"
    assert unmapped_record.status == AttendanceStatus.ABSENT


def test_attendance_upsert_collapses_duplicate_employee_code_rows(db_session):
    rows_synced, unmapped = upsert_attendance_rows(
        db_session,
        sync_date=date(2026, 6, 3),
        rows=[
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 3),
                "Status": "Absent",
            },
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 3),
                "InTime": datetime(2026, 6, 3, 9, 30),
                "OutTime": datetime(2026, 6, 3, 18, 15),
                "Status": "Present",
            },
        ],
    )
    db_session.commit()

    assert rows_synced == 1
    assert unmapped == ["UNKNOWN"]
    record = db_session.query(AttendanceRecord).filter_by(employee_code="UNKNOWN").one()
    assert record.employee_profile_id is None
    assert record.status == AttendanceStatus.PRESENT
    assert record.worked_hours == 8.75


def test_attendance_upsert_merges_duplicate_source_rows_to_first_in_last_out(db_session):
    rows_synced, unmapped = upsert_attendance_rows(
        db_session,
        sync_date=date(2026, 6, 3),
        rows=[
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 3),
                "InTime": datetime(2026, 6, 3, 10, 30),
                "OutTime": datetime(2026, 6, 3, 17, 45),
                "Status": "Present",
            },
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 3),
                "InTime": datetime(2026, 6, 3, 9, 15),
                "Status": "Present",
            },
        ],
    )
    db_session.commit()

    assert rows_synced == 1
    assert unmapped == ["UNKNOWN"]
    record = db_session.query(AttendanceRecord).filter_by(employee_code="UNKNOWN").one()
    assert record.in_time.hour == 9
    assert record.in_time.minute == 15
    assert record.out_time.hour == 17
    assert record.out_time.minute == 45
    assert record.worked_hours == 8.5


def test_attendance_upsert_keeps_earliest_in_time_across_intraday_syncs(db_session):
    upsert_attendance_rows(
        db_session,
        sync_date=date(2026, 6, 3),
        rows=[
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 3),
                "InTime": datetime(2026, 6, 3, 9, 15),
                "Status": "Present",
            },
        ],
        is_final=False,
    )
    db_session.commit()

    rows_synced, unmapped = upsert_attendance_rows(
        db_session,
        sync_date=date(2026, 6, 3),
        rows=[
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 3),
                "InTime": datetime(2026, 6, 3, 10, 30),
                "OutTime": datetime(2026, 6, 3, 18, 0),
                "Status": "Present",
            },
        ],
        is_final=False,
    )
    db_session.commit()

    assert rows_synced == 1
    assert unmapped == ["UNKNOWN"]
    record = db_session.query(AttendanceRecord).filter_by(employee_code="UNKNOWN").one()
    assert record.in_time.hour == 9
    assert record.in_time.minute == 15
    assert record.out_time.hour == 18
    assert record.out_time.minute == 0
    assert record.worked_hours == 8.75


def test_attendance_upsert_marks_punch_in_without_punch_out_as_present(db_session):
    rows_synced, unmapped = upsert_attendance_rows(
        db_session,
        sync_date=date(2026, 6, 4),
        rows=[
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 4),
                "InTime": datetime(2026, 6, 4, 9, 45),
                "OutTime": None,
                "Status": "Absent",
            },
        ],
    )
    db_session.commit()

    assert rows_synced == 1
    assert unmapped == ["UNKNOWN"]
    record = db_session.query(AttendanceRecord).filter_by(employee_code="UNKNOWN").one()
    assert record.status == AttendanceStatus.PRESENT
    assert record.worked_hours is None


def test_attendance_upsert_marks_punch_in_half_day_as_present(db_session):
    rows_synced, unmapped = upsert_attendance_rows(
        db_session,
        sync_date=date(2026, 6, 5),
        rows=[
            {
                "EmployeeCode": "UNKNOWN",
                "EmployeeName": "Missing Person",
                "AttendanceDate": date(2026, 6, 5),
                "InTime": datetime(2026, 6, 5, 9, 45),
                "OutTime": None,
                "Status": "Half Day",
            },
        ],
    )
    db_session.commit()

    assert rows_synced == 1
    assert unmapped == ["UNKNOWN"]
    record = db_session.query(AttendanceRecord).filter_by(employee_code="UNKNOWN").one()
    assert record.status == AttendanceStatus.PRESENT
    assert record.original_status == AttendanceStatus.PRESENT
