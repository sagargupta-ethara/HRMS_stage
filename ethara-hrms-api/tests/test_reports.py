def test_reports_summary_and_positions(client, auth_headers):
    client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Meera Iyer",
            "personalEmail": "meera.iyer@gmail.com",
            "phone": "9876543212",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )

    summary = client.get("/api/v1/reports/summary", headers=auth_headers)
    assert summary.status_code == 200
    assert summary.json()["totalCandidates"] >= 1

    positions = client.get("/api/v1/reports/positions", headers=auth_headers)
    assert positions.status_code == 200
    assert positions.json()[0]["title"] == "Senior Frontend Developer"
