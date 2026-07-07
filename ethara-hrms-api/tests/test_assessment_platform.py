"""End-to-end tests for the Assessment Platform module.

Covers: builder CRUD + publish immutability, bulk assignment (link + provision),
the invite-only/assignment-gated access guarantee, the taker flow (start →
autosave → submit), auto-scoring math, manual grading + finalize, and results +
CSV export. The harness is SQLite + create_all (see conftest), so these exercise
the real ORM models and route logic.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import (
    ApAssessment,
    ApAssessmentStatus,
    ApAssignment,
    ApAssignmentStatus,
    ApAttempt,
    Candidate,
    CandidateStage,
    Role,
    SourceType,
    User,
)

API = "/api/v1/assessment-platform"


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['accessToken']}"}


@pytest.fixture()
def hr_headers(client: TestClient) -> dict[str, str]:
    return _login(client, "hr@ethara.ai", "hr123")


@pytest.fixture()
def evaluator_headers(client: TestClient) -> dict[str, str]:
    return _login(client, "evaluator@ethara.ai", "evaluator123")


@pytest.fixture()
def candidate(db_session: Session) -> User:
    user = User(
        id="usr-cand-ap",
        email="taker@example.com",
        password_hash=hash_password("taker123"),
        name="Taker One",
        role=Role.CANDIDATE,
        roles=[Role.CANDIDATE.value],
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    db_session.add(user)
    db_session.commit()
    return user


def _build_full_assessment(client: TestClient, headers: dict[str, str]) -> dict:
    """Create a published assessment with one of every scorable type + survey types."""
    resp = client.post(
        f"{API}/assessments",
        headers=headers,
        json={
            "title": "Backend Developer Test",
            "instructions": "Answer all questions.",
            "passPercentage": 50,
            "negativeMarking": True,
            "negativeFactor": 0.25,
            "showResultsToCandidate": True,
            "timeLimitMinutes": 60,
        },
    )
    assert resp.status_code == 201, resp.text
    assessment_id = resp.json()["id"]

    sec = client.post(
        f"{API}/assessments/{assessment_id}/sections",
        headers=headers,
        json={"title": "Mixed"},
    )
    assert sec.status_code == 201, sec.text
    section_id = sec.json()["id"]

    questions = [
        {"type": "mcq_single", "prompt": "Pick A", "marks": 2,
         "config": {"options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}], "correctOptionId": "a"}},
        {"type": "mcq_multi", "prompt": "Pick X and Y", "marks": 3,
         "config": {"options": [{"id": "x", "text": "X"}, {"id": "y", "text": "Y"}, {"id": "z", "text": "Z"}],
                    "correctOptionIds": ["x", "y"]}},
        {"type": "true_false", "prompt": "Sky is blue", "marks": 1, "config": {"correct": True}},
        {"type": "short_answer", "prompt": "Capital of France", "marks": 2,
         "config": {"acceptedAnswers": ["Paris"], "matchMode": "exact"}},
        {"type": "long_answer", "prompt": "Explain REST", "marks": 5, "config": {"rubric": "clarity"}},
        {"type": "url_submission", "prompt": "Your GitHub", "marks": 3, "config": {}},
        {"type": "rating", "prompt": "Rate difficulty", "marks": 0, "config": {"scaleMin": 1, "scaleMax": 5}},
    ]
    by_type: dict[str, str] = {}
    for q in questions:
        r = client.post(
            f"{API}/assessments/{assessment_id}/sections/{section_id}/questions",
            headers=headers,
            json=q,
        )
        assert r.status_code == 201, r.text
        by_type[q["type"]] = r.json()["id"]

    pub = client.post(f"{API}/assessments/{assessment_id}/publish", headers=headers)
    assert pub.status_code == 200, pub.text
    assert pub.json()["status"] == "published"
    assert pub.json()["totalMarks"] == 16  # 2+3+1+2+5+3 (rating unscored)
    return {"assessmentId": assessment_id, "sectionId": section_id, "byType": by_type}


def test_question_types_requires_permission(client: TestClient, hr_headers, candidate):
    assert client.get(f"{API}/question-types").status_code == 401
    cand = _login(client, "taker@example.com", "taker123")
    assert client.get(f"{API}/question-types", headers=cand).status_code == 403
    ok = client.get(f"{API}/question-types", headers=hr_headers)
    assert ok.status_code == 200
    assert any(t["type"] == "mcq_single" and t["autoScored"] for t in ok.json())


def test_publish_requires_questions(client: TestClient, hr_headers):
    resp = client.post(f"{API}/assessments", headers=hr_headers, json={"title": "Empty"})
    aid = resp.json()["id"]
    pub = client.post(f"{API}/assessments/{aid}/publish", headers=hr_headers)
    assert pub.status_code == 400
    assert "question" in pub.json()["detail"].lower()


def test_published_is_immutable(client: TestClient, hr_headers):
    built = _build_full_assessment(client, hr_headers)
    aid = built["assessmentId"]
    # editing a published assessment is blocked
    resp = client.patch(f"{API}/assessments/{aid}", headers=hr_headers, json={"title": "Changed"})
    assert resp.status_code == 400
    # but cloning produces an editable draft
    clone = client.post(f"{API}/assessments/{aid}/clone", headers=hr_headers)
    assert clone.status_code == 201
    assert clone.json()["status"] == "draft"
    assert clone.json()["title"].startswith("Copy of")
    assert clone.json()["questionCount"] == 7


def test_full_flow_assign_take_score_grade(client: TestClient, hr_headers, evaluator_headers, candidate, db_session):
    built = _build_full_assessment(client, hr_headers)
    aid = built["assessmentId"]
    q = built["byType"]

    # ── assign to an existing user (linked, no provisioning) ──
    assign = client.post(
        f"{API}/assessments/{aid}/assignments",
        headers=hr_headers,
        json={"emails": ["taker@example.com", "not-an-email"]},
    )
    assert assign.status_code == 201, assign.text
    body = assign.json()
    assert body["invited"] == 1 and body["linked"] == 1
    assert body["skipped"] and body["skipped"][0]["email"] == "not-an-email"

    cand = _login(client, "taker@example.com", "taker123")

    # ── candidate sees only their assignment (not browsable) ──
    mine = client.get(f"{API}/me/assignments", headers=cand)
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assignment_id = mine.json()[0]["assignmentId"]

    # candidate cannot use the staff builder list (no READ permission)
    assert client.get(f"{API}/assessments", headers=cand).status_code == 403

    # ── start: snapshot must NOT leak answer keys ──
    start = client.post(f"{API}/me/assignments/{assignment_id}/start", headers=cand)
    assert start.status_code == 200, start.text
    attempt = start.json()
    attempt_id = attempt["attemptId"]
    snap_questions = {qq["id"]: qq for s in attempt["sections"] for qq in s["questions"]}
    mcq = snap_questions[q["mcq_single"]]
    assert "correctOptionId" not in mcq["config"]
    assert {o["id"] for o in mcq["config"]["options"]} == {"a", "b"}

    # ── autosave answers ──
    def save(qid: str, response: dict, rev: int = 1):
        r = client.patch(
            f"{API}/me/attempts/{attempt_id}/answers/{qid}",
            headers=cand,
            json={"response": response, "clientRev": rev},
        )
        assert r.status_code == 200, r.text
        assert "remainingSeconds" in r.json()

    save(q["mcq_single"], {"optionId": "a"})
    save(q["mcq_multi"], {"optionIds": ["x", "y"]})
    save(q["true_false"], {"value": True})
    save(q["short_answer"], {"text": "Paris"})
    save(q["long_answer"], {"text": "REST is an architectural style."})
    save(q["url_submission"], {"url": "https://github.com/me/project"})
    save(q["rating"], {"value": 4})

    # stale autosave (lower rev) must not clobber
    client.patch(
        f"{API}/me/attempts/{attempt_id}/answers/{q['mcq_single']}",
        headers=cand,
        json={"response": {"optionId": "b"}, "clientRev": 0},
    )

    # ── submit ──
    submit = client.post(f"{API}/me/attempts/{attempt_id}/submit", headers=cand)
    assert submit.status_code == 200, submit.text
    # candidate's own view reveals NOTHING until HR releases the result
    cand_result = submit.json()["result"]
    assert cand_result["released"] is False and cand_result["resultStatus"] is None
    assert "autoScore" not in cand_result and "overallFeedback" not in cand_result
    # HR sees the auto score (mcq_single 2 + mcq_multi 3 + true_false 1 + short 2 = 8)
    sc = client.get(f"{API}/attempts/{attempt_id}/scorecard", headers=hr_headers).json()["attempt"]
    assert sc["autoScore"] == 8 and sc["resultStatus"] == "pending" and sc["maxScore"] == 16

    # ── grading: evaluator sees it in the queue ──
    queue = client.get(f"{API}/grading/queue", headers=evaluator_headers)
    assert queue.status_code == 200
    assert any(a["id"] == attempt_id for a in queue.json())

    # a candidate cannot grade
    assert client.get(f"{API}/grading/queue", headers=cand).status_code == 403

    # grade the two manual answers
    g1 = client.patch(
        f"{API}/grading/attempts/{attempt_id}/answers/{q['long_answer']}",
        headers=evaluator_headers,
        json={"marks": 4, "feedback": "Good"},
    )
    assert g1.status_code == 200, g1.text
    client.patch(
        f"{API}/grading/attempts/{attempt_id}/answers/{q['url_submission']}",
        headers=evaluator_headers,
        json={"marks": 3},
    )
    fin = client.post(f"{API}/grading/attempts/{attempt_id}/finalize", headers=evaluator_headers)
    assert fin.status_code == 200, fin.text
    final = fin.json()["attempt"]
    assert final["totalScore"] == 15  # 8 auto + 4 + 3
    assert final["resultStatus"] == "pass"  # 15/16 = 93.75% >= 50

    # ── results + CSV ──
    results = client.get(f"{API}/assessments/{aid}/results", headers=hr_headers)
    assert results.status_code == 200
    assert results.json()["total"] == 1
    csv = client.get(f"{API}/assessments/{aid}/results/export", headers=hr_headers)
    assert csv.status_code == 200
    assert "text/csv" in csv.headers["content-type"]
    assert "taker@example.com" in csv.text


def test_provisioning_creates_account(client: TestClient, hr_headers, db_session):
    built = _build_full_assessment(client, hr_headers)
    aid = built["assessmentId"]
    resp = client.post(
        f"{API}/assessments/{aid}/assignments",
        headers=hr_headers,
        json={"emails": ["brand-new@example.com"]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["created"] == 1
    user = db_session.query(User).filter(User.email == "brand-new@example.com").one_or_none()
    assert user is not None and user.role == Role.CANDIDATE
    assignment = db_session.query(ApAssignment).filter(ApAssignment.email == "brand-new@example.com").one()
    assert assignment.provisioned is True


def test_cannot_access_others_assignment(client: TestClient, hr_headers, candidate, db_session):
    built = _build_full_assessment(client, hr_headers)
    aid = built["assessmentId"]
    # assign to a DIFFERENT person
    client.post(f"{API}/assessments/{aid}/assignments", headers=hr_headers, json={"emails": ["other@example.com"]})
    other_assignment = db_session.query(ApAssignment).filter(ApAssignment.email == "other@example.com").one()

    cand = _login(client, "taker@example.com", "taker123")
    # taker has no assignment → empty list, and cannot start someone else's
    assert client.get(f"{API}/me/assignments", headers=cand).json() == []
    blocked = client.post(f"{API}/me/assignments/{other_assignment.id}/start", headers=cand)
    assert blocked.status_code == 404


def test_bulk_bypass_candidates_from_csv_moves_pass_rows_to_selection_form(
    client: TestClient,
    hr_headers,
    db_session: Session,
):
    assessment = ApAssessment(
        id="ap-bulk-bypass",
        title="Bulk Bypass Assessment",
        status=ApAssessmentStatus.PUBLISHED,
        total_marks=100,
        created_by="usr-hr",
    )
    with_assignment = Candidate(
        id="cand-bulk-pass",
        candidate_code="CAND-BULK-001",
        full_name="Bulk Pass",
        personal_email="bulk-pass@example.com",
        phone="9876500011",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.EVALUATION_ASSIGNED,
        current_status="Evaluation Assigned",
    )
    no_assignment = Candidate(
        id="cand-bulk-no-assignment",
        candidate_code="CAND-BULK-002",
        full_name="Bulk No Assignment",
        personal_email="bulk-no-assignment@example.com",
        phone="9876500012",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.EVALUATION_ASSIGNED,
        current_status="Evaluation Assigned",
    )
    assignment = ApAssignment(
        id="assign-bulk-pass",
        assessment_id=assessment.id,
        candidate_id=with_assignment.id,
        email=with_assignment.personal_email,
        status=ApAssignmentStatus.INVITED,
        invited_by="usr-hr",
    )
    db_session.add_all([assessment, with_assignment, no_assignment, assignment])
    db_session.commit()

    csv_body = (
        "email,result\n"
        "bulk-pass@example.com,Pass\n"
        "bulk-no-assignment@example.com,Pass\n"
        "missing@example.com,Pass\n"
        "bulk-fail@example.com,Fail\n"
    )
    response = client.post(
        f"{API}/candidates/bulk-bypass",
        headers=hr_headers,
        files={"file": ("bulk-bypass.csv", csv_body, "text/csv")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["processed"] == 4
    assert body["advanced"] == 2
    assert body["failed"] == 2

    db_session.refresh(with_assignment)
    db_session.refresh(no_assignment)
    db_session.refresh(assignment)
    assert with_assignment.current_stage == CandidateStage.SELECTION_FORM_SENT
    assert no_assignment.current_stage == CandidateStage.SELECTION_FORM_SENT
    assert assignment.status == ApAssignmentStatus.GRADED

    attempt = db_session.query(ApAttempt).filter(ApAttempt.assignment_id == assignment.id).one()
    assert attempt.result_status == "pass"
    assert attempt.percentage == 100
    assert {row["status"] for row in body["results"]} == {"advanced", "failed"}


def test_import_export_round_trip(client: TestClient, hr_headers):
    spec = {
        "title": "Coded Test",
        "timeLimitMinutes": 30,
        "passPercentage": 50,
        "negativeMarking": True,
        "negativeFactor": 0.25,
        "sections": [
            {"title": "MCQ", "cutoffMark": 3, "questions": [
                {"type": "mcq_single", "prompt": "2+2?", "marks": 2, "options": ["3", "4", "5"], "answer": "4"},
                {"type": "mcq_multi", "prompt": "Primes", "marks": 3, "options": ["2", "3", "4"], "answers": ["2", "3"]},
                {"type": "true_false", "prompt": "Sky is blue", "answer": True},
                {"type": "short_answer", "prompt": "Capital of France", "accept": ["Paris"], "match": "exact"},
            ]},
            {"title": "Open", "questions": [
                {"type": "long_answer", "prompt": "Explain REST", "marks": 5},
                {"type": "rating", "prompt": "Rate it", "scaleMin": 1, "scaleMax": 5},
            ]},
        ],
    }
    r = client.post(f"{API}/assessments/import", headers=hr_headers, json=spec)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["status"] == "draft"
    assert created["questionCount"] == 6
    assert created["totalMarks"] == 12  # 2+3+1+1+5 (rating unscored)

    # export round-trips: answer keys come back as text
    ex = client.get(f"{API}/assessments/{created['id']}/export", headers=hr_headers)
    assert ex.status_code == 200, ex.text
    spec2 = ex.json()
    assert spec2["title"] == "Coded Test"
    assert len(spec2["sections"]) == 2
    assert spec2["sections"][0]["questions"][0]["answer"] == "4"
    assert spec2["sections"][0]["questions"][1]["answers"] == ["2", "3"]

    # re-importing the exported spec reproduces the same structure
    r2 = client.post(f"{API}/assessments/import", headers=hr_headers, json=spec2)
    assert r2.status_code == 201
    assert r2.json()["questionCount"] == 6


def test_import_rejects_bad_answer(client: TestClient, hr_headers):
    spec = {"title": "X", "sections": [{"title": "S", "questions": [
        {"type": "mcq_single", "prompt": "Q", "options": ["A", "B"], "answer": "C"},
    ]}]}
    r = client.post(f"{API}/assessments/import", headers=hr_headers, json=spec)
    assert r.status_code == 422
    assert "not one of the options" in r.json()["detail"]


def test_assign_requires_published(client: TestClient, hr_headers):
    resp = client.post(f"{API}/assessments", headers=hr_headers, json={"title": "Draft only"})
    aid = resp.json()["id"]
    assign = client.post(f"{API}/assessments/{aid}/assignments", headers=hr_headers, json={"emails": ["a@b.com"]})
    assert assign.status_code == 400
    assert "publish" in assign.json()["detail"].lower()


def test_bulk_results_csv_import(client: TestClient, hr_headers, candidate):
    built = _build_full_assessment(client, hr_headers)  # max 16 marks, pass 50%
    aid = built["assessmentId"]
    client.post(f"{API}/assessments/{aid}/assignments", headers=hr_headers, json={"emails": ["taker@example.com"]})
    cand = _login(client, "taker@example.com", "taker123")
    assignment_id = client.get(f"{API}/me/assignments", headers=cand).json()[0]["assignmentId"]
    attempt_id = client.post(f"{API}/me/assignments/{assignment_id}/start", headers=cand).json()["attemptId"]
    client.post(f"{API}/me/attempts/{attempt_id}/submit", headers=cand)

    # first upload sets the final score (12/16 = 75% >= 50 -> pass)
    r1 = client.post(
        f"{API}/assessments/{aid}/results/upload", headers=hr_headers,
        files={"file": ("r.csv", "Email,Score,Feedback\ntaker@example.com,12,Solid answers\n", "text/csv")},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["updated"] == 1

    # re-upload with a different score -> skipped (first upload wins / idempotent)
    r2 = client.post(
        f"{API}/assessments/{aid}/results/upload", headers=hr_headers,
        files={"file": ("r.csv", "Email,Score\ntaker@example.com,3\n", "text/csv")},
    )
    assert r2.json()["updated"] == 0 and r2.json()["skippedFinalized"] == 1

    # unknown email -> not found
    r3 = client.post(
        f"{API}/assessments/{aid}/results/upload", headers=hr_headers,
        files={"file": ("r.csv", "Email,Score\nnobody@example.com,5\n", "text/csv")},
    )
    assert r3.json()["notFound"] == 1

    row = client.get(f"{API}/assessments/{aid}/results", headers=hr_headers).json()["data"][0]
    assert row["totalScore"] == 12 and row["resultStatus"] == "pass" and row["overallFeedback"] == "Solid answers"


def test_release_gate_and_verdict_override(client: TestClient, hr_headers, candidate):
    built = _build_full_assessment(client, hr_headers)  # showResultsToCandidate=True, pass 50%
    aid = built["assessmentId"]
    client.post(f"{API}/assessments/{aid}/assignments", headers=hr_headers, json={"emails": ["taker@example.com"]})
    cand = _login(client, "taker@example.com", "taker123")
    assignment_id = client.get(f"{API}/me/assignments", headers=cand).json()[0]["assignmentId"]
    attempt_id = client.post(f"{API}/me/assignments/{assignment_id}/start", headers=cand).json()["attemptId"]
    client.post(f"{API}/me/attempts/{attempt_id}/submit", headers=cand)

    # CSV sets score 15/16 (=93% -> would compute pass) but verdict Fail overrides
    client.post(
        f"{API}/assessments/{aid}/results/upload", headers=hr_headers,
        files={"file": ("r.csv", "email,score,verdict\ntaker@example.com,15,Fail\n", "text/csv")},
    )

    # before release: candidate sees nothing
    mine = client.get(f"{API}/me/assignments", headers=cand).json()[0]["attempt"]
    assert mine["released"] is False and mine["resultStatus"] is None and mine["totalScore"] is None

    rel = client.post(f"{API}/assessments/{aid}/results/release", headers=hr_headers)
    assert rel.status_code == 200 and rel.json()["released"] == 1

    # after release: verdict visible (Fail, from the override); score visible (showResults=True)
    mine2 = client.get(f"{API}/me/assignments", headers=cand).json()[0]["attempt"]
    assert mine2["released"] is True and mine2["resultStatus"] == "fail" and mine2["totalScore"] == 15


def test_released_result_can_show_verdict_without_score_when_score_visibility_is_off(
    client: TestClient,
    hr_headers,
    candidate,
):
    built = _build_full_assessment(client, hr_headers)
    aid = built["assessmentId"]
    settings = client.patch(
        f"{API}/assessments/{aid}/settings",
        headers=hr_headers,
        json={"showResultsToCandidate": False},
    )
    assert settings.status_code == 200, settings.text
    assert settings.json()["showResultsToCandidate"] is False

    client.post(f"{API}/assessments/{aid}/assignments", headers=hr_headers, json={"emails": ["taker@example.com"]})
    cand = _login(client, "taker@example.com", "taker123")
    assignment_id = client.get(f"{API}/me/assignments", headers=cand).json()[0]["assignmentId"]
    attempt_id = client.post(f"{API}/me/assignments/{assignment_id}/start", headers=cand).json()["attemptId"]
    client.post(f"{API}/me/attempts/{attempt_id}/submit", headers=cand)
    upload = client.post(
        f"{API}/assessments/{aid}/results/upload",
        headers=hr_headers,
        files={"file": ("r.csv", "email,score,verdict\ntaker@example.com,13,Pass\n", "text/csv")},
    )
    assert upload.status_code == 200, upload.text

    released = client.post(f"{API}/assessments/{aid}/results/release", headers=hr_headers)
    assert released.status_code == 200

    mine = client.get(f"{API}/me/assignments", headers=cand).json()[0]["attempt"]
    assert mine["released"] is True
    assert mine["resultStatus"] == "pass"
    assert mine["totalScore"] is None
    assert mine["maxScore"] is None
    assert mine["percentage"] is None


def test_campus_light_registration(client: TestClient, db_session, hr_headers):
    from app.db.models import AdminSetting, Candidate, SourceType

    form = {
        "fullName": "Campus Student",
        "personalEmail": "campus@example.com",
        "phone": "9876543210",
        "password": "Test@1234",
    }
    # disabled by default -> 403
    assert client.post("/api/v1/candidates/campus/register", data=form).status_code == 403
    assert client.get("/api/v1/candidates/campus/config").json()["enabled"] is False

    db_session.add(
        AdminSetting(namespace="recruitment", key="campus_drive", value={"enabled": True})
    )
    db_session.commit()
    assert client.get("/api/v1/candidates/campus/config").json()["enabled"] is True

    r = client.post("/api/v1/candidates/campus/register", data=form)
    assert r.status_code == 200, r.text
    cand = db_session.query(Candidate).filter(
        Candidate.personal_email == "campus@example.com"
    ).one()
    assert (
        cand.source_type == SourceType.CAMPUS_HIRE
        and cand.portal_user_id
        and cand.resume_url is None
    )

    # The campus candidate can log in immediately (no email-verify gate) and load
    # the candidate portal APIs. They start locked to the assessment-only portal.
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "campus@example.com", "password": "Test@1234"},
    )
    assert login.status_code == 200
    session = login.json()
    assert session["user"]["role"] == "candidate"
    assert "candidate" in session["user"]["roles"]
    assert session["profile"]["campusLock"] is True
    assert session["profile"]["campusAssessmentPassed"] is False
    assert session["profile"]["campusNextRoute"] == "/portal/my-assessments"
    headers = {"Authorization": f"Bearer {session['accessToken']}"}

    portal = client.get("/api/v1/candidates/me", headers=headers)
    assert portal.status_code == 200
    assert portal.json()["currentApplication"]["sourceType"] == "campus_hire"
    assert client.get(f"{API}/me/assignments", headers=headers).status_code == 200

    # Once HR releases a passing assessment result, a fresh login/profile tells
    # the frontend to send the candidate to the full-registration continuation.
    built = _build_full_assessment(client, hr_headers)
    aid = built["assessmentId"]
    client.post(
        f"{API}/assessments/{aid}/assignments",
        headers=hr_headers,
        json={"emails": ["campus@example.com"]},
    )
    assignment_id = client.get(f"{API}/me/assignments", headers=headers).json()[0][
        "assignmentId"
    ]
    attempt_id = client.post(
        f"{API}/me/assignments/{assignment_id}/start", headers=headers
    ).json()["attemptId"]
    client.post(f"{API}/me/attempts/{attempt_id}/submit", headers=headers)
    uploaded = client.post(
        f"{API}/assessments/{aid}/results/upload",
        headers=hr_headers,
        files={"file": ("r.csv", "Email,Score\ncampus@example.com,12\n", "text/csv")},
    )
    assert uploaded.status_code == 200, uploaded.text
    released = client.post(f"{API}/assessments/{aid}/results/release", headers=hr_headers)
    assert released.status_code == 200

    relogin = client.post(
        "/api/v1/auth/login",
        json={"email": "campus@example.com", "password": "Test@1234"},
    )
    assert relogin.status_code == 200
    profile = relogin.json()["profile"]
    assert profile["campusLock"] is True
    assert profile["campusAssessmentPassed"] is True
    assert profile["campusNextRoute"] == "/candidate/complete-registration"


def test_results_upload_requires_columns(client: TestClient, hr_headers):
    aid = _build_full_assessment(client, hr_headers)["assessmentId"]
    r = client.post(
        f"{API}/assessments/{aid}/results/upload", headers=hr_headers,
        files={"file": ("r.csv", "name,note\nx,y\n", "text/csv")},
    )
    assert r.status_code == 400
    assert "email" in r.json()["detail"].lower()
