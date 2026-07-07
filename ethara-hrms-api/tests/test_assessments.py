from datetime import UTC, datetime

from app.core.security import hash_password
from app.db.models import Candidate, CandidateStage, Evaluation, Role, SourceType, User


def _login(client, email: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def test_level_2_submission_is_allowed_when_workflow_is_already_in_progress(client, db_session):
    candidate_user = User(
        id="usr-candidate-assessment-level2",
        email="candidate.level2@ethara.ai",
        password_hash=hash_password("candidate123"),
        name="Assessment Level 2 Candidate",
        role=Role.CANDIDATE,
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    candidate = Candidate(
        id="cand-assessment-level2",
        candidate_code="ETH-ASMT-201",
        full_name="Assessment Level 2 Candidate",
        personal_email="candidate.level2@ethara.ai",
        phone="9000000021",
        portal_user_id=candidate_user.id,
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.EVALUATION_IN_PROGRESS,
        current_status="Level 1 Passed",
    )
    db_session.add_all([candidate_user, candidate])
    db_session.commit()

    headers = _login(client, "candidate.level2@ethara.ai", "candidate123")
    response = client.post(
        "/api/v1/assessments/me/level/2/submit",
        data={"promptResponse": "Completed the Level 2 communication task."},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["level"] == 2
    assert response.json()["status"] == "submitted"


def test_evals_submission_is_allowed_when_candidate_is_already_on_selection_form(client, db_session):
    candidate_user = User(
        id="usr-candidate-assessment-level3",
        email="candidate.level3@ethara.ai",
        password_hash=hash_password("candidate123"),
        name="Assessment Level 3 Candidate",
        role=Role.CANDIDATE,
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    candidate = Candidate(
        id="cand-assessment-level3",
        candidate_code="ETH-ASMT-301",
        full_name="Assessment Level 3 Candidate",
        personal_email="candidate.level3@ethara.ai",
        phone="9000000022",
        portal_user_id=candidate_user.id,
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.SELECTION_FORM_SENT,
        current_status="Selection Form Sent",
    )
    db_session.add_all([candidate_user, candidate])
    db_session.commit()

    headers = _login(client, "candidate.level3@ethara.ai", "candidate123")
    response = client.post(
        "/api/v1/assessments/me/level/3/submit",
        data={"promptResponse": "Completed the final evals assessment."},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["level"] == 3
    assert response.json()["status"] == "submitted"


def test_hr_can_update_pms_score_and_admin_can_view_it(client, db_session):
    candidate = Candidate(
        id="cand-assessment-pms",
        candidate_code="ETH-ASMT-401",
        full_name="PMS Candidate",
        personal_email="pms.candidate@ethara.ai",
        phone="9000000023",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-fe",
        current_stage=CandidateStage.SELECTION_FORM_SENT,
        current_status="Selection Form Sent",
    )
    evaluation = Evaluation(
        id="eval-pms-001",
        candidate_id=candidate.id,
        evaluator_id="usr-evaluator",
        total_score=84,
        recommendation="strong_hire",
        pi_score=78,
        interview_status="completed",
    )
    db_session.add_all([candidate, evaluation])
    db_session.commit()

    hr_headers = _login(client, "hr@ethara.ai", "hr123")
    update_response = client.patch(
        "/api/v1/evaluations/eval-pms-001/pms-score",
        json={"pmsScore": 91},
        headers=hr_headers,
    )

    assert update_response.status_code == 200
    assert update_response.json()["pmsScore"] == 91

    admin_headers = _login(client, "admin@ethara.ai", "admin123")
    report_response = client.get("/api/v1/assessments/evaluator-view", headers=admin_headers)

    assert report_response.status_code == 200
    row = next(item for item in report_response.json() if item["candidateId"] == candidate.id)
    assert row["evaluation"]["pmsScore"] == 91
    assert row["piInterview"] is not None
    assert row["piInterview"]["status"] == "completed"
    assert row["piInterview"]["score"] == 78
    assert len(row["piRounds"]) == 1


def test_evaluator_cannot_update_pms_score(client, db_session):
    candidate = Candidate(
        id="cand-assessment-pms-denied",
        candidate_code="ETH-ASMT-402",
        full_name="PMS Restricted Candidate",
        personal_email="pms.denied@ethara.ai",
        phone="9000000024",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-fe",
        current_stage=CandidateStage.EVALUATION_PASSED,
        current_status="Evals Passed",
    )
    evaluation = Evaluation(
        id="eval-pms-002",
        candidate_id=candidate.id,
        evaluator_id="usr-evaluator",
        total_score=79,
    )
    db_session.add_all([candidate, evaluation])
    db_session.commit()

    evaluator_headers = _login(client, "evaluator@ethara.ai", "evaluator123")
    response = client.patch(
        "/api/v1/evaluations/eval-pms-002/pms-score",
        json={"pmsScore": 73},
        headers=evaluator_headers,
    )

    assert response.status_code == 403


def test_multi_round_pi_history_and_final_no_further_pi_required_are_reported(client, db_session):
    second_evaluator = User(
        id="usr-evaluator-2",
        email="panel.two@ethara.ai",
        password_hash=hash_password("paneltwo123"),
        name="Panel Evaluator Two",
        role=Role.EVALUATOR,
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    candidate = Candidate(
        id="cand-assessment-pi-rounds",
        candidate_code="ETH-PI-501",
        full_name="PI Journey Candidate",
        personal_email="pi.journey@example.com",
        phone="9000000025",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-fe",
        current_stage=CandidateStage.SELECTION_FORM_SENT,
        current_status="Selection Form Sent",
    )
    evaluation = Evaluation(
        id="eval-pi-rounds-001",
        candidate_id=candidate.id,
        evaluator_id="usr-evaluator",
        total_score=8.4,
        recommendation="passed",
    )
    db_session.add_all([second_evaluator, candidate, evaluation])
    db_session.commit()

    evaluator_headers = _login(client, "evaluator@ethara.ai", "evaluator123")
    second_evaluator_headers = _login(client, "panel.two@ethara.ai", "paneltwo123")

    round_1_schedule = client.patch(
        f"/api/v1/evaluations/{evaluation.id}/schedule",
        json={
            "subject": "PI Round 1",
            "scheduledAt": datetime(2026, 5, 29, 10, 0, tzinfo=UTC).isoformat(),
            "mode": "google_meet",
            "durationMinutes": 60,
            "evaluatorId": "usr-evaluator",
            "panelLabel": "Technical Panel",
            "panelMembers": ["Evaluator User", "Tech Lead"],
            "notes": "Round 1 intro and technical fit.",
        },
        headers=evaluator_headers,
    )

    assert round_1_schedule.status_code == 200
    round_1_payload = round_1_schedule.json()
    assert round_1_payload["interviewStatus"] == "scheduled"
    assert round_1_payload["interviewScheduledAt"] is not None
    round_1 = round_1_payload["piRounds"][0]
    assert round_1["roundNumber"] == 1
    assert round_1["panelLabel"] == "Technical Panel"
    assert round_1["panelMembers"] == ["Evaluator User", "Tech Lead"]

    round_1_complete = client.patch(
        f"/api/v1/evaluations/{evaluation.id}/complete",
        json={
          "decision": "proceed_to_next_round",
          "roundId": round_1["id"],
          "roundNumber": 1,
          "piScore": 81,
          "notes": "Good fundamentals. Proceed to the next PI round.",
        },
        headers=evaluator_headers,
    )

    assert round_1_complete.status_code == 200
    round_1_completed = round_1_complete.json()["piRounds"][0]
    assert round_1_completed["status"] == "completed"
    assert round_1_completed["score"] == 81
    assert round_1_completed["remarks"] == "Good fundamentals. Proceed to the next PI round."
    assert round_1_completed["roundDecision"] == "proceed_to_next_round"

    round_2_schedule = client.patch(
        f"/api/v1/evaluations/{evaluation.id}/schedule",
        json={
            "subject": "PI Round 2",
            "scheduledAt": datetime(2026, 5, 30, 11, 30, tzinfo=UTC).isoformat(),
            "mode": "offline",
            "durationMinutes": 45,
            "roundNumber": 2,
            "evaluatorId": "usr-evaluator-2",
            "panelLabel": "Business + HR Panel",
            "panelMembers": ["Panel Evaluator Two", "HR User"],
            "notes": "Final PI round for business and HR alignment.",
        },
        headers=evaluator_headers,
    )

    assert round_2_schedule.status_code == 200
    round_2_payload = round_2_schedule.json()
    assert round_2_payload["evaluatorId"] == "usr-evaluator-2"
    round_2 = round_2_payload["piRounds"][1]
    assert round_2["roundNumber"] == 2
    assert round_2["evaluatorId"] == "usr-evaluator-2"
    assert round_2["status"] == "scheduled"

    round_2_complete = client.patch(
        f"/api/v1/evaluations/{evaluation.id}/complete",
        json={
          "decision": "selected",
          "roundId": round_2["id"],
          "roundNumber": 2,
          "piScore": 89,
          "notes": "Panel selected the candidate. No further PI required.",
          "noFurtherPiRequired": True,
          "finalVerdict": "selected",
        },
        headers=second_evaluator_headers,
    )

    assert round_2_complete.status_code == 200
    payload = round_2_complete.json()
    final_round = payload["piRounds"][1]
    assert payload["piScore"] == 89
    assert final_round["status"] == "no_further_pi_required"
    assert final_round["finalVerdict"] == "selected"
    assert final_round["noFurtherPiRequired"] is True
    assert final_round["evaluatorId"] == "usr-evaluator-2"
    assert final_round["remarks"] == "Panel selected the candidate. No further PI required."

    admin_headers = _login(client, "admin@ethara.ai", "admin123")
    report_response = client.get("/api/v1/assessments/evaluator-view", headers=admin_headers)

    assert report_response.status_code == 200
    row = next(item for item in report_response.json() if item["candidateId"] == candidate.id)
    assert row["finalDecision"] == "pass"
    assert row["piInterview"]["roundNumber"] == 2
    assert row["piInterview"]["finalVerdict"] == "selected"
    assert row["piInterview"]["status"] == "no_further_pi_required"
    assert len(row["piRounds"]) == 2
    assert row["piRounds"][0]["score"] == 81
    assert row["piRounds"][0]["remarks"] == "Good fundamentals. Proceed to the next PI round."
    assert row["piRounds"][1]["evaluatorName"] == "Panel Evaluator Two"
    assert row["piRounds"][1]["panelMembers"] == ["Panel Evaluator Two", "HR User"]

    db_session.refresh(candidate)
    db_session.refresh(evaluation)
    assert candidate.current_stage == CandidateStage.SELECTION_FORM_VALIDATED
    assert candidate.current_status == "Selected after PI Round 2"
    assert evaluation.evaluator_id == "usr-evaluator-2"
