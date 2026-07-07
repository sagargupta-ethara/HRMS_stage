from app.services import greythr_leave


def _login(client, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["accessToken"]


def _seed_emp001(db_session, *, year: int = 2026) -> int:
    rows = [
        {
            "leave_code": code,
            "leave_type": greythr_leave.LEAVE_CODE_LABELS.get(code, code),
            "opening": 0.0,
            "granted": float(bal),
            "availed": 0.0,
            "applied": 0.0,
            "lapsed": 0.0,
            "deducted": 0.0,
            "encashed": 0.0,
            "balance": float(bal),
        }
        for code, bal in {"EL": 24, "SL": 11.58, "CL": 4.16, "WFH": 2}.items()
    ]
    count = greythr_leave.upsert_balances(db_session, employee_code="EMP-001", year=year, rows=rows)
    db_session.commit()
    return count


def test_normalize_balance_row_maps_greythr_item():
    row = greythr_leave.normalize_balance_row(
        {
            "leaveTypeCategory": {"code": "EL", "description": "Earned Leave"},
            "ob": 0,
            "grant": 24,
            "availed": 0,
            "applied": 0,
            "lapsed": 0,
            "balance": 24,
        }
    )
    assert row == {
        "leave_code": "EL",
        "leave_type": "Earned Leave",
        "opening": 0.0,
        "granted": 24.0,
        "availed": 0.0,
        "applied": 0.0,
        "lapsed": 0.0,
        "deducted": 0.0,
        "encashed": 0.0,
        "balance": 24.0,
    }


def test_upsert_balances_is_idempotent_and_decimal(db_session):
    first = _seed_emp001(db_session)
    second = _seed_emp001(db_session)  # re-run must update in place, not duplicate
    assert first == second == 4

    rows = greythr_leave.get_balances(db_session, employee_code="EMP-001", year=2026)
    assert len(rows) == 4  # no duplicates from the second upsert
    by_code = {r.leave_code: r.balance for r in rows}
    assert by_code["SL"] == 11.58  # fractional accrual preserved, never cast to int
    # canonical order: EL, SL, CL, ... then WFH
    assert [r.leave_code for r in rows] == ["EL", "SL", "CL", "WFH"]


def test_employee_reads_own_greythr_balances_with_synced_at(client, db_session):
    _seed_emp001(db_session)
    token = _login(client, "employee@ethara.ai", "employee123")

    response = client.get(
        "/api/v1/leave/greythr-balances",
        params={"year": 2026},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["employeeCode"] == "EMP-001"
    assert body["year"] == 2026
    assert body["syncedAt"] is not None
    el = next(b for b in body["balances"] if b["code"] == "EL")
    assert el["balance"] == 24.0
    assert el["type"] == "Earned Leave"


def test_employee_cannot_read_another_employees_balances(client, db_session):
    _seed_emp001(db_session)
    token = _login(client, "employee@ethara.ai", "employee123")

    response = client.get(
        "/api/v1/leave/greythr-balances",
        params={"year": 2026, "employeeCode": "GRP9999"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403


def test_admin_can_read_other_employee_balances(client, db_session):
    _seed_emp001(db_session)
    token = _login(client, "admin@ethara.ai", "admin123")

    response = client.get(
        "/api/v1/leave/greythr-balances",
        params={"year": 2026, "employeeCode": "EMP-001"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["employeeCode"] == "EMP-001"


def test_refresh_now_returns_503_when_greythr_not_configured(client, db_session):
    token = _login(client, "employee@ethara.ai", "employee123")
    response = client.post(
        "/api/v1/leave/greythr-balances/refresh",
        params={"year": 2026},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 503
