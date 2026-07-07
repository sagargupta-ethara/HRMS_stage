def test_system_status_uses_load_estimate_when_cpu_sample_is_zero(
    client,
    auth_headers,
    monkeypatch,
):
    from app.api.routes import logs as logs_route

    monkeypatch.setattr(logs_route, "_cpu_percent_sample", lambda: 0.0)
    monkeypatch.setattr(logs_route.os, "getloadavg", lambda: (0.5, 0.25, 0.1))
    monkeypatch.setattr(logs_route.os, "cpu_count", lambda: 4)

    response = client.get("/api/v1/logs/system-status", headers=auth_headers)

    assert response.status_code == 200
    cpu = response.json()["performance"]["cpu"]
    assert cpu["percent"] == 12.5
    assert cpu["source"] == "load"


def test_llm_stream_insights_include_vertex_usage_and_estimated_spend():
    from app.api.routes import logs as logs_route

    row = logs_route._decorate_entry(
        "llm-usage",
        {
            "id": "llm-usage.log:1",
            "timestamp": "2026-06-25T17:00:00+05:30",
            "level": None,
            "event": "vertex_call_success",
            "message": "vertex_call_success",
            "raw": "{}",
            "source": "llm-usage.log",
            "fields": {
                "provider": "vertex",
                "operation": "doc_verify:aadhaar",
                "model": "gemini-3.1-flash-lite",
                "promptTokens": 1000,
                "completionTokens": 500,
                "totalTokens": 1500,
                "durationMs": 750,
            },
        },
    )

    insights = logs_route._stream_insights("llm-usage", [row])

    assert row["structured"]["provider"] == "vertex"
    assert row["structured"]["costUsd"] > 0
    assert insights["cost"]["estimatedUsd"] > 0
    assert any(section["label"] == "Providers" and section["items"][0]["label"] == "vertex" for section in insights["breakdown"])
    assert any(card["label"] == "Estimated Spend" for card in insights["cards"])


def test_llm_stream_failed_vertex_call_keeps_http_details():
    from app.api.routes import logs as logs_route

    row = logs_route._decorate_entry(
        "llm-usage",
        {
            "id": "llm-usage.log:2",
            "timestamp": "2026-06-25T17:00:00+05:30",
            "level": None,
            "event": "vertex_call_failed",
            "message": "vertex_call_failed",
            "raw": "{}",
            "source": "llm-usage.log",
            "fields": {
                "provider": "vertex",
                "operation": "doc_verify:pan",
                "model": "gemini-3.1-flash-lite",
                "error": "HTTPError",
                "httpStatus": 400,
                "errorDetail": "Failed to decode image data.",
            },
        },
    )

    insights = logs_route._stream_insights("llm-usage", [row])

    assert row["structured"]["status"] == "error"
    assert row["structured"]["httpStatus"] == 400
    assert row["structured"]["errorDetail"] == "Failed to decode image data."
    assert "errorDetail" in insights["searchableFields"]
    assert "httpStatus" in insights["searchableFields"]


def test_auth_stream_labels_fastapi_test_client_logins():
    from app.api.routes import logs as logs_route

    row = logs_route._decorate_entry(
        "auth",
        {
            "id": "auth.log:1",
            "timestamp": "2026-06-25T17:00:00+05:30",
            "level": None,
            "event": "login_success",
            "message": "login_success",
            "raw": "{}",
            "source": "auth.log",
            "fields": {
                "email": "employee@ethara.ai",
                "role": "employee",
                "clientIp": "testclient",
                "userAgent": "testclient",
            },
        },
    )

    insights = logs_route._stream_insights("auth", [row])
    automated_card = next(card for card in insights["cards"] if card["label"] == "Automated Tests")
    ip_breakdown = next(section for section in insights["breakdown"] if section["label"] == "IP Addresses")

    assert row["structured"]["clientLabel"] == "Automated test client"
    assert row["structured"]["isTestClient"] is True
    assert "Automated test client" in row["structured"]["description"]
    assert automated_card["value"] == 1
    assert ip_breakdown["items"][0]["label"] == "Automated test client"
