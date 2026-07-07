import csv
import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import select

from app.core.security import hash_password
from app.db.models import (
    Candidate,
    CandidateIdCardForm,
    CandidateStage,
    CareerApplication,
    ContractStatus,
    DocumensoSignedProfile,
    DocumensoTemplateCache,
    Document,
    EmployeeComplianceForm,
    EmployeeContract,
    EmployeeDocument,
    EmployeeImportStaging,
    EmployeeProfile,
    EmployeeSelectionForm,
    ITRequest,
    Role,
    SelectionForm,
    SourceType,
    User,
)
from app.services import compliance_documenso
from app.services import employees as employee_service


def _hr_headers(client) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": "hr@ethara.ai", "password": "hr123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _employee_headers(client) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "employee@ethara.ai", "password": "employee123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _compliance_headers(client) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "compliance@ethara.ai", "password": "compliance123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _it_headers(client) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "it@ethara.ai", "password": "it123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _add_employee_documenso_form(db_session, **overrides) -> EmployeeComplianceForm:
    values = {
        "employee_profile_id": "emp-001",
        "form_type": "form_11",
        "form_title": "Form 11",
        "status": "sent",
        "documenso_id": "9011",
        "signed_url": "https://documenso.example/sign/form-11",
        "sent_at": datetime.now(UTC),
    }
    values.update(overrides)
    record = EmployeeComplianceForm(**values)
    db_session.add(record)
    db_session.commit()
    return record


def test_parse_optional_datetime_accepts_employee_registration_dob_formats():
    assert employee_service.parse_optional_datetime("18/04/2004").date().isoformat() == "2004-04-18"
    assert employee_service.parse_optional_datetime("18-04-2004").date().isoformat() == "2004-04-18"
    assert employee_service.parse_optional_datetime("18-Apr-2004").date().isoformat() == "2004-04-18"


def _add_documenso_compliance_templates(db_session) -> None:
    db_session.add_all(
        [
            DocumensoTemplateCache(
                id="tpl-form-11",
                template_id=1101,
                title="Form 11",
                description=None,
                fields=[{"id": "field-name", "type": "TEXT", "fieldMeta": {"label": "Employee Name"}}],
                recipients=[{"id": "recipient-1", "role": "SIGNER"}],
            ),
            DocumensoTemplateCache(
                id="tpl-form-2",
                template_id=1102,
                title="Form 2",
                description=None,
                fields=[],
                recipients=[{"id": "recipient-1", "role": "SIGNER"}],
            ),
            DocumensoTemplateCache(
                id="tpl-form-f",
                template_id=1103,
                title="Form F",
                description=None,
                fields=[],
                recipients=[{"id": "recipient-1", "role": "SIGNER"}],
            ),
        ]
    )
    db_session.commit()


def _mock_documenso_compliance_send(monkeypatch, created_payloads: list[dict]) -> None:
    def fake_create_document_from_template(**kwargs):
        created_payloads.append(kwargs)
        return {"documentId": kwargs["template_id"] + 5000, "token": f"token-{kwargs['template_id']}"}

    monkeypatch.setattr(
        "app.services.compliance_documenso.get_settings",
        lambda: SimpleNamespace(documenso_api_key="test-key"),
    )
    monkeypatch.setattr(
        "app.services.compliance_documenso.ds_client.create_document_from_template",
        fake_create_document_from_template,
    )
    monkeypatch.setattr(
        "app.services.compliance_documenso.ds_client.extract_document_id",
        lambda payload: payload["documentId"],
    )
    monkeypatch.setattr(
        "app.services.compliance_documenso.ds_client.extract_signing_token",
        lambda payload: payload["token"],
    )
    monkeypatch.setattr(
        "app.services.compliance_documenso.ds_client.build_signing_url",
        lambda token: f"https://documenso.example/sign/{token}",
    )


def test_bulk_register_reconciles_candidate_it_request_and_profile_fields(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr("app.api.routes.employees._dispatch_welcome_emails", lambda emails: None)
    now = datetime.now(UTC)
    candidate = Candidate(
        id="cand-it-bulk-map",
        candidate_code="ETH-BULK-001",
        employee_code="GRP1888",
        full_name="Bulk IT Candidate",
        personal_email="bulk.it.candidate@example.com",
        ethara_email=None,
        phone="9876543218",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-fe",
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    request = ITRequest(
        id="it-bulk-map",
        candidate_id=candidate.id,
        requested_by="usr-admin",
        suggested_email="bulk.it@ethara.ai",
        status="pending",
    )
    selection_form = SelectionForm(
        id="selection-bulk-map",
        candidate_id=candidate.id,
        submitted_at=now,
        validated_at=now,
        form_data={
            "basicDetails": {
                "fullName": "Bulk IT Candidate",
                "email": "bulk.it.candidate@example.com",
                "contactNumber": "9876543218",
                "dateOfBirth": "1999-04-03",
                "qualification": "B.Com",
            },
            "personalDetails": {
                "gender": "female",
                "fatherName": "Bulk Father",
                "motherName": "Bulk Mother",
                "maritalStatus": "unmarried",
            },
            "identityDetails": {"aadhaarNumber": "123456789012"},
            "emergencyContact": {
                "name": "Bulk Emergency",
                "phone": "9988776655",
                "relation": "Parent",
            },
            "documentsUploaded": {
                "aadhaar_doc": {"fileName": "aadhaar.pdf", "fileAvailable": True}
            },
        },
    )
    aadhaar_doc = Document(
        id="doc-bulk-map-aadhaar",
        candidate_id=candidate.id,
        type="selection_form_aadhaar_doc",
        file_name="aadhaar.pdf",
        file_url="/uploads/candidates/cand-it-bulk-map/aadhaar.pdf",
        mime_type="application/pdf",
        status="verified",
    )
    db_session.add_all([candidate, request, selection_form, aadhaar_doc])
    db_session.commit()

    csv_body = (
        "name,company_email,employee_code,personal_email,phone,department,designation,gender\n"
        "Bulk IT Candidate,bulk.it@ethara.ai,grp1888,bulk.it.candidate@example.com,"
        "9876543218,Operations - Technical,Project Lead,female\n"
    )
    response = client.post(
        "/api/v1/employees/bulk-register",
        headers=auth_headers,
        files={"csvFile": ("it_user_import.csv", csv_body.encode(), "text/csv")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["created"] == 1
    assert body["failed"] == 0
    assert body["results"][0]["employeeCode"] == "GRP1888"
    assert body["results"][0]["department"] == "Operations - Technical"
    assert body["results"][0]["designation"] == "Project Lead"
    assert body["results"][0]["candidateId"] == candidate.id
    assert body["results"][0]["itRequestCompleted"] is True
    assert body["results"][0]["backfilledDocumentCount"] == 1
    assert body["results"][0]["employeeSelectionFormStatus"] == "submitted"

    db_session.expire_all()
    profile = db_session.scalar(
        select(EmployeeProfile).where(EmployeeProfile.ethara_email == "bulk.it@ethara.ai")
    )
    assert profile is not None
    assert profile.employee_code == "GRP1888"
    assert profile.department == "Operations - Technical"
    assert profile.designation == "Project Lead"
    assert profile.date_of_birth is not None
    assert profile.date_of_birth.date().isoformat() == "1999-04-03"
    assert profile.emergency_contact_phone == "9988776655"

    employee_form = db_session.scalar(
        select(EmployeeSelectionForm).where(EmployeeSelectionForm.employee_profile_id == profile.id)
    )
    assert employee_form is not None
    assert employee_form.status == "submitted"
    assert employee_form.submitted_at is not None
    assert employee_form.form_data["employeeName"] == "Bulk IT Candidate"
    assert employee_form.form_data["dateOfBirth"] == "1999-04-03"
    assert employee_form.form_data["documentsUploaded"]["aadhaar"] == "aadhaar.pdf"

    employee_doc = db_session.scalar(
        select(EmployeeDocument).where(
            EmployeeDocument.employee_profile_id == profile.id,
            EmployeeDocument.type == "aadhaar",
        )
    )
    assert employee_doc is not None
    assert employee_doc.file_url == "/uploads/candidates/cand-it-bulk-map/aadhaar.pdf"
    assert employee_doc.status == "verified"

    refreshed_candidate = db_session.get(Candidate, candidate.id)
    assert refreshed_candidate.ethara_email == "bulk.it@ethara.ai"
    assert refreshed_candidate.employee_code == "GRP1888"
    assert refreshed_candidate.current_stage == CandidateStage.IT_EMAIL_CREATED
    assert refreshed_candidate.current_status == "IT Email Created"

    refreshed_request = db_session.get(ITRequest, request.id)
    assert refreshed_request.status == "completed"
    assert refreshed_request.created_email == "bulk.it@ethara.ai"
    assert refreshed_request.completed_at is not None

    list_response = client.get("/api/v1/employees/list", headers=auth_headers)
    assert list_response.status_code == 200
    roster_row = next(row for row in list_response.json() if row["etharaEmail"] == "bulk.it@ethara.ai")
    assert roster_row["registrationStatus"] == "candidate_onboarding_pending"
    assert roster_row["candidateStage"] == "it_email_created"

    detail_response = client.get(f"/api/v1/employees/{profile.id}", headers=auth_headers)
    assert detail_response.status_code == 200
    assert detail_response.json()["registrationStatus"] == "candidate_onboarding_pending"
    assert detail_response.json()["currentEmployeeStatus"] == "Candidate Onboarding Pending"

    active_export = client.get("/api/v1/employees/export?lifecycle=active", headers=auth_headers)
    assert active_export.status_code == 200
    active_rows = list(csv.DictReader(io.StringIO(active_export.text)))
    assert "GRP1888" not in {row["Employee Code"] for row in active_rows}

    pending_export = client.get(
        "/api/v1/employees/export?lifecycle=pending_activation",
        headers=auth_headers,
    )
    assert pending_export.status_code == 200
    pending_rows = list(csv.DictReader(io.StringIO(pending_export.text)))
    pending_row = next(row for row in pending_rows if row["Employee Code"] == "GRP1888")
    assert pending_row["Registration Status"] == "candidate_onboarding_pending"


def test_bulk_register_backfills_legacy_candidate_employee_code_from_personal_email(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr("app.api.routes.employees._dispatch_welcome_emails", lambda emails: None)
    candidate = Candidate(
        id="cand-it-bulk-legacy",
        candidate_code="ETH-BULK-002",
        employee_code=None,
        full_name="Legacy Candidate",
        personal_email="legacy.candidate@example.com",
        ethara_email=None,
        phone="9876543217",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-be",
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    request = ITRequest(
        id="it-bulk-legacy",
        candidate_id=candidate.id,
        requested_by="usr-admin",
        suggested_email="legacy.candidate@ethara.ai",
        status="pending",
    )
    db_session.add_all([candidate, request])
    db_session.commit()

    csv_body = (
        "name,company_email,employee_code,personal_email,phone,department,designation,gender\n"
        "Legacy Candidate,legacy.candidate@ethara.ai,GRP1999,legacy.candidate@example.com,"
        "9876543217,Engineering,Backend Engineer,male\n"
    )
    response = client.post(
        "/api/v1/employees/bulk-register",
        headers=auth_headers,
        files={"csvFile": ("it_user_import.csv", csv_body.encode(), "text/csv")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["created"] == 1
    assert body["results"][0]["candidateId"] == candidate.id
    assert body["results"][0]["itRequestCompleted"] is True

    db_session.expire_all()
    refreshed_candidate = db_session.get(Candidate, candidate.id)
    assert refreshed_candidate.employee_code == "GRP1999"
    assert refreshed_candidate.ethara_email == "legacy.candidate@ethara.ai"
    assert refreshed_candidate.current_stage == CandidateStage.IT_EMAIL_CREATED


def test_bulk_register_prefers_personal_email_when_employee_code_points_to_another_candidate(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr("app.api.routes.employees._dispatch_welcome_emails", lambda emails: None)
    target_candidate = Candidate(
        id="cand-it-bulk-personal-wins",
        candidate_code="ETH-BULK-003",
        employee_code="GRP2001",
        full_name="Personal Email Match",
        personal_email="personal.wins@example.com",
        ethara_email=None,
        phone="9876543216",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-fe",
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    other_candidate = Candidate(
        id="cand-it-bulk-code-conflict",
        candidate_code="ETH-BULK-004",
        employee_code="GRP2002",
        full_name="Code Conflict",
        personal_email="code.conflict@example.com",
        ethara_email=None,
        phone="9876543215",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-be",
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    request = ITRequest(
        id="it-bulk-personal-wins",
        candidate_id=target_candidate.id,
        requested_by="usr-admin",
        suggested_email="personal.wins@ethara.ai",
        status="pending",
    )
    db_session.add_all([target_candidate, other_candidate, request])
    db_session.commit()

    csv_body = (
        "name,company_email,employee_code,personal_email,phone,department,designation,gender\n"
        "Personal Email Match,personal.wins@ethara.ai,GRP2002,personal.wins@example.com,"
        "9876543216,Engineering,QA Tester,female\n"
    )
    response = client.post(
        "/api/v1/employees/bulk-register",
        headers=auth_headers,
        files={"csvFile": ("it_user_import.csv", csv_body.encode(), "text/csv")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["created"] == 1
    assert body["results"][0]["candidateId"] == target_candidate.id
    assert body["results"][0]["itRequestCompleted"] is True

    db_session.expire_all()
    refreshed_target = db_session.get(Candidate, target_candidate.id)
    refreshed_other = db_session.get(Candidate, other_candidate.id)
    assert refreshed_target.ethara_email == "personal.wins@ethara.ai"
    assert refreshed_target.employee_code == "GRP2001"
    assert refreshed_other.ethara_email is None
    assert refreshed_other.employee_code == "GRP2002"


EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS = [
    "resume",
    "photo",
    "aadhaar",
    "pan",
    "education_10th",
    "education_12th",
    "highest_qualification",
    "cancelled_cheque",
    "permanent_address_proof",
]


def _employee_detail_form_payload(**overrides) -> dict:
    payload = {
        "employeeCode": "EMP-001",
        "employeeName": "Employee User",
        "department": "Engineering",
        "designation": "Software Engineer",
        "dateOfBirth": "1990-01-01",
        "gender": "prefer_not_to_say",
        "contactNumber": "9876543212",
        "maritalStatus": "single",
        "hasKids": "no",
        "bloodGroup": "O+",
        "class10ScoreType": "percentage",
        "class10Score": "85",
        "class12ScoreType": "percentage",
        "class12Score": "88",
        "highestQualification": "Bachelor's Degree",
        "highestQualificationScoreType": "cgpa",
        "highestQualificationScore": "8.4",
        "personalEmail": "employee.personal@example.com",
        "officialEmail": "employee@ethara.ai",
        "fatherName": "Test Father",
        "fatherDateOfBirth": "1965-01-01",
        "motherName": "Test Mother",
        "motherDateOfBirth": "1968-01-01",
        "currentAddress": "Current House, Bengaluru, Karnataka",
        "permanentAddress": "Permanent House, Mysuru, Karnataka",
        "emergencyContactName": "Test Contact",
        "emergencyContactPhone": "9988776655",
        "emergencyContactRelation": "Sibling",
        "aadhaarNumber": "123412341234",
        "panNumber": "ABCDE1234F",
        "uanNumber": "100200300400",
        "bankName": "HDFC Bank",
        "bankAccount": "1234567890",
        "ifscCode": "HDFC0001234",
    }
    payload.update(overrides)
    return payload


def _upload_required_employee_detail_documents(client, headers: dict[str, str]) -> None:
    for document_type in EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS:
        response = client.post(
            "/api/v1/employees/me/documents/upload",
            headers=headers,
            data={"type": document_type},
            files={
                "file": (
                    f"{document_type}.pdf",
                    b"%PDF-1.4 required employee detail document",
                    "application/pdf",
                )
            },
        )
        assert response.status_code == 200


def _upload_employee_detail_documents_except(
    client,
    headers: dict[str, str],
    excluded_types: set[str],
) -> None:
    for document_type in EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS:
        if document_type in excluded_types:
            continue
        response = client.post(
            "/api/v1/employees/me/documents/upload",
            headers=headers,
            data={"type": document_type},
            files={
                "file": (
                    f"{document_type}.pdf",
                    b"%PDF-1.4 required employee detail document",
                    "application/pdf",
                )
            },
        )
        assert response.status_code == 200


def _upload_employee_detail_documents_with_types(
    client,
    headers: dict[str, str],
    type_map: dict[str, str],
) -> None:
    for document_type in EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS:
        upload_type = type_map.get(document_type, document_type)
        response = client.post(
            "/api/v1/employees/me/documents/upload",
            headers=headers,
            data={"type": upload_type},
            files={
                "file": (
                    f"{upload_type}.pdf",
                    b"%PDF-1.4 required employee detail document",
                    "application/pdf",
                )
            },
        )
        assert response.status_code == 200
        assert response.json()["type"] == document_type


def _office_admin_headers(client, db_session) -> dict[str, str]:
    office_admin = db_session.scalar(select(User).where(User.email == "officeadmin@ethara.ai"))
    if office_admin is None:
        office_admin = User(
            id="usr-office-admin",
            email="officeadmin@ethara.ai",
            password_hash=hash_password("officeadmin123"),
            name="Office Admin",
            role=Role.OFFICE_ADMIN,
            is_active=True,
            email_verified_at=datetime.now(UTC),
        )
        db_session.add(office_admin)
        db_session.commit()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "officeadmin@ethara.ai", "password": "officeadmin123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def test_employee_detail_is_available_to_hr(client):
    headers = _hr_headers(client)

    response = client.get("/api/v1/employees/emp-001", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "emp-001"
    assert body["etharaEmail"] == "employee@ethara.ai"
    assert "documentCompletionStatus" in body
    assert "documents" in body
    assert "timeline" in body


def test_employee_module_is_available_to_office_admin(client, db_session):
    headers = _office_admin_headers(client, db_session)

    listing = client.get("/api/v1/employees/list", headers=headers)
    assert listing.status_code == 200
    row = next(employee for employee in listing.json() if employee["id"] == "emp-001")
    assert row["accessLevel"] == "preview"
    assert row["canOpenDetail"] is False
    assert row["employeeCode"] == "EMP-001"
    assert row["etharaEmail"] == "employee@ethara.ai"
    assert row["phone"] == "9876543212"
    assert "personalEmail" not in row
    assert "aadhaarLast4" not in row
    assert "dateOfBirth" not in row

    detail = client.get("/api/v1/employees/emp-001", headers=headers)
    assert detail.status_code == 403
    assert detail.json()["detail"] == "Only Admin, HR, and TA users can open full employee details."


def test_employee_detail_is_preview_only_for_compliance(client):
    headers = _compliance_headers(client)

    listing = client.get("/api/v1/employees/list", headers=headers)
    assert listing.status_code == 200
    row = next(employee for employee in listing.json() if employee["id"] == "emp-001")
    assert row["accessLevel"] == "preview"
    assert row["canOpenDetail"] is False

    response = client.get("/api/v1/employees/emp-001", headers=headers)
    assert response.status_code == 403


def test_it_can_manage_employee_edit_access_without_full_detail(client):
    headers = _it_headers(client)

    detail = client.get("/api/v1/employees/emp-001", headers=headers)
    assert detail.status_code == 403

    initial_listing = client.get("/api/v1/employees/list", headers=headers)
    assert initial_listing.status_code == 200
    initial_row = next(employee for employee in initial_listing.json() if employee["id"] == "emp-001")
    assert initial_row["accessLevel"] == "preview"
    assert initial_row["canOpenDetail"] is False
    assert initial_row["personalEmail"]

    user_export = client.get("/api/v1/employees/export/users", headers=headers)
    assert user_export.status_code == 200
    csv_text = user_export.text
    assert "Personal Email" in csv_text.splitlines()[0]
    assert initial_row["personalEmail"] in csv_text

    full_export = client.get("/api/v1/employees/export", headers=headers)
    assert full_export.status_code == 403

    toggle = client.patch(
        "/api/v1/employees/emp-001/edit-access",
        headers=headers,
        json={"enabled": False},
    )
    assert toggle.status_code == 200
    assert toggle.json()["editAccessEnabled"] is False

    listing = client.get("/api/v1/employees/list", headers=headers)
    row = next(employee for employee in listing.json() if employee["id"] == "emp-001")
    assert row["accessLevel"] == "preview"
    assert row["canOpenDetail"] is False
    assert row["editAccessEnabled"] is False


def test_employee_detail_returns_full_structure_for_sparse_employee(client, db_session):
    now = datetime.now(UTC)
    db_session.add(
        User(
            id="usr-sparse-employee",
            email="sparse.employee@ethara.ai",
            password_hash=hash_password("employee123"),
            name="Sparse Employee",
            role=Role.EMPLOYEE,
            is_active=True,
            email_verified_at=now,
        )
    )
    db_session.add(
        EmployeeProfile(
            id="emp-sparse",
            user_id="usr-sparse-employee",
            full_name="Sparse Employee",
            ethara_email="sparse.employee@ethara.ai",
            personal_email=None,
            employee_code="EMP-SPARSE",
            phone=None,
            department=None,
            designation=None,
            gender=None,
            aadhaar_last4=None,
            aadhaar_ocr_status=None,
        )
    )
    db_session.commit()

    response = client.get("/api/v1/employees/emp-sparse", headers=_hr_headers(client))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "emp-sparse"
    assert body["selectionForm"]["status"] == "draft"
    assert isinstance(body["selectionForm"]["formData"], dict)
    assert "personalEmail" in body["selectionForm"]["formData"]
    assert len(body["documents"]) >= 6
    assert any(document["type"] == "aadhaar" for document in body["documents"])
    assert any(document["type"] == "education_10th" for document in body["documents"])
    assert any(document["type"] == "cancelled_cheque" for document in body["documents"])
    assert body["documentCompletionStatus"]["completed"] == 0
    assert isinstance(body["missingDocuments"], list)
    assert isinstance(body["contracts"], list)
    assert isinstance(body["complianceForms"], list)
    assert isinstance(body["profileJourney"], list)
    assert "nextRequiredAction" in body
    assert isinstance(body["timeline"], list)


def test_employee_document_download_and_preview(client, db_session, auth_headers):
    uploads_dir = Path("uploads/employee_resumes")
    uploads_dir.mkdir(parents=True, exist_ok=True)
    resume_path = uploads_dir / "employee-test-resume.pdf"
    resume_path.write_bytes(b"%PDF-1.4 employee resume")

    profile = db_session.get(EmployeeProfile, "emp-001")
    assert profile is not None
    profile.resume_path = str(resume_path)
    db_session.add(profile)
    db_session.commit()

    detail = client.get("/api/v1/employees/emp-001", headers=auth_headers)
    assert detail.status_code == 200
    body = detail.json()
    assert body["resumeDocument"]["missing"] is False
    assert body["resumeDocument"]["downloadEndpoint"].endswith("/documents/resume/download")

    preview = client.get("/api/v1/employees/emp-001/documents/resume/preview", headers=auth_headers)
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith("application/pdf")

    download = client.get("/api/v1/employees/emp-001/documents/resume/download", headers=auth_headers)
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("application/octet-stream")


def test_employee_dashboard_actions_persist(client, db_session):
    headers = _employee_headers(client)

    dashboard = client.get("/api/v1/employees/me/dashboard", headers=headers)
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert body["employee"]["etharaEmail"] == "employee@ethara.ai"
    assert body["selectionForm"]["formData"]["personalEmail"] == "employee.personal@example.com"
    assert "selectionForm" in body
    assert "documents" in body
    assert "profileJourney" in body

    _upload_required_employee_detail_documents(client, headers)

    selection_submit = client.post(
        "/api/v1/employees/me/selection-form",
        headers=headers,
        json={"formData": _employee_detail_form_payload()},
    )
    assert selection_submit.status_code == 200
    assert selection_submit.json()["status"] == "submitted"

    referral_create = client.post(
        "/api/v1/employees/me/referrals",
        headers=headers,
        data={
            "fullName": "Referral Candidate",
            "personalEmail": "referral.candidate@example.com",
            "phone": "9898989898",
            "positionId": "pos-fe",
        },
        files={"resume": ("referral-resume.pdf", b"%PDF-1.4 referral resume", "application/pdf")},
    )
    assert referral_create.status_code == 200
    assert referral_create.json()["candidateName"] == "Referral Candidate"
    referral_application = db_session.scalar(
        select(CareerApplication).where(CareerApplication.email == "referral.candidate@example.com")
    )
    assert referral_application is not None
    assert referral_application.resume_file_name == "referral-resume.pdf"
    assert referral_application.resume_url

    referrals = client.get("/api/v1/employees/me/referrals", headers=headers)
    assert referrals.status_code == 200
    assert any(item["candidateName"] == "Referral Candidate" for item in referrals.json())

    refreshed = client.get("/api/v1/employees/me/dashboard", headers=headers)
    assert refreshed.status_code == 200
    refreshed_body = refreshed.json()
    assert refreshed_body["selectionForm"]["status"] == "submitted"
    assert refreshed_body["selectionForm"]["formData"]["personalEmail"] == "employee.personal@example.com"
    assert refreshed_body["selectionForm"]["formData"]["class10Score"] == "85"
    assert refreshed_body["employee"]["bloodGroup"] == "O+"
    assert any(item["candidateName"] == "Referral Candidate" for item in refreshed_body["referralActivity"])


def test_employee_referral_requires_resume(client):
    headers = _employee_headers(client)

    referral_create = client.post(
        "/api/v1/employees/me/referrals",
        headers=headers,
        data={
            "fullName": "Missing Resume Candidate",
            "personalEmail": "missing.resume@example.com",
            "phone": "9898989898",
            "linkedinUrl": "https://linkedin.com/in/missing-resume",
        },
    )

    assert referral_create.status_code == 422
    assert "resume" in str(referral_create.json()).lower()


def test_employee_detail_documents_count_legacy_document_type_aliases(client):
    headers = _employee_headers(client)

    _upload_employee_detail_documents_with_types(
        client,
        headers,
        {
            "photo": "passport_photo",
            "aadhaar": "aadhar_card",
            "pan": "pan_card",
            "education_10th": "marksheet_10th",
            "education_12th": "marksheet_12th",
            "highest_qualification": "graduation",
            "cancelled_cheque": "cancelled_check",
            "permanent_address_proof": "address_document",
        },
    )

    selection_submit = client.post(
        "/api/v1/employees/me/selection-form",
        headers=headers,
        json={"formData": _employee_detail_form_payload()},
    )
    assert selection_submit.status_code == 200

    dashboard = client.get("/api/v1/employees/me/dashboard", headers=headers)
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert body["documentCompletionStatus"]["completed"] == len(EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS)
    assert body["documentCompletionStatus"]["missing"] == []
    assert all(not document["missing"] for document in body["documents"] if document["type"] in EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS)


def test_employee_document_completion_total_includes_optional_uploaded_documents(client):
    headers = _employee_headers(client)
    _upload_required_employee_detail_documents(client, headers)

    optional_upload = client.post(
        "/api/v1/employees/me/documents/upload",
        headers=headers,
        data={"type": "current_address_proof"},
        files={
            "file": (
                "current_address_proof.pdf",
                b"%PDF-1.4 optional current address proof",
                "application/pdf",
            )
        },
    )
    assert optional_upload.status_code == 200
    assert optional_upload.json()["type"] == "current_address_proof"

    dashboard = client.get("/api/v1/employees/me/dashboard", headers=headers)

    assert dashboard.status_code == 200
    body = dashboard.json()
    assert any(document["type"] == "current_address_proof" for document in body["documents"])
    assert (
        body["documentCompletionStatus"]["completed"]
        == len(EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS) + 1
    )
    assert (
        body["documentCompletionStatus"]["total"]
        == len(EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS) + 1
    )
    assert body["documentCompletionStatus"]["missing"] == []


def test_employee_detail_form_submits_without_uan_or_salary_account(client):
    headers = _employee_headers(client)
    _upload_employee_detail_documents_except(client, headers, {"cancelled_cheque"})

    response = client.post(
        "/api/v1/employees/me/selection-form",
        headers=headers,
        json={
            "formData": _employee_detail_form_payload(
                hasUanNumber="no",
                uanNumber="",
                hasSavingsAccount="no",
                hasSalaryAccount="",
                bankName="",
                bankAccount="",
                accountNumber="",
                ifscCode="",
            )
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "submitted"
    assert body["formData"]["hasUanNumber"] == "no"
    assert body["formData"]["uanNumber"] == ""
    assert body["formData"]["hasSavingsAccount"] == "no"
    assert body["formData"]["bankAccount"] == ""
    assert body["formData"]["ifscCode"] == ""
    assert body["formData"]["salaryAccountInstruction"] == "open_or_convert_hdfc_salary_account"


def test_employee_reference_options_can_be_managed_by_hr(client):
    headers = _hr_headers(client)

    response = client.put(
        "/api/v1/employees/reference-options",
        headers=headers,
        json={
            "departments": ["Engineering", "People Operations"],
            "designations": ["Software Engineer", "Payroll Specialist"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "People Operations" in body["departments"]
    assert "Payroll Specialist" in body["designations"]
    assert "Others" not in body["departments"]
    assert "Others" not in body["designations"]


def test_employee_reference_options_include_existing_employee_values(client, db_session):
    profile = db_session.get(EmployeeProfile, "emp-001")
    assert profile is not None
    profile.department = "Field Operations"
    profile.designation = "Site Lead"
    db_session.add(profile)
    db_session.commit()

    response = client.get("/api/v1/employees/reference-options")

    assert response.status_code == 200
    body = response.json()
    assert "Field Operations" in body["departments"]
    assert "Site Lead" in body["designations"]


def test_employee_package_export_returns_structured_zip(client):
    headers = _hr_headers(client)

    response = client.get("/api/v1/employees/export/package", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")
    assert "employees_with_documents_" in response.headers["content-disposition"]

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        assert "employees_summary.csv" in names
        assert "document_manifest.json" in names
        profile_files = [name for name in names if name.endswith("/profile.json")]
        assert profile_files
        profile_payload = json.loads(archive.read(profile_files[0]))
        assert profile_payload["employeeCode"] == "EMP-001"
        manifest_payload = json.loads(archive.read("document_manifest.json"))
        assert isinstance(manifest_payload, list)


def test_employee_edit_access_toggle_blocks_employee_detail_form_submission(client):
    hr_headers = _hr_headers(client)
    employee_headers = _employee_headers(client)

    disable = client.patch(
        "/api/v1/employees/emp-001/edit-access",
        headers=hr_headers,
        json={"enabled": False},
    )
    assert disable.status_code == 200
    assert disable.json()["editAccessEnabled"] is False

    detail = client.get("/api/v1/employees/emp-001", headers=hr_headers)
    assert detail.status_code == 200
    assert detail.json()["selectionForm"]["editAccessEnabled"] is False

    blocked_submit = client.post(
        "/api/v1/employees/me/selection-form",
        headers=employee_headers,
        json={"formData": _employee_detail_form_payload()},
    )
    assert blocked_submit.status_code == 403

    bulk_enable = client.post(
        "/api/v1/employees/edit-access/bulk",
        headers=hr_headers,
        json={"employeeIds": ["emp-001"], "enabled": True},
    )
    assert bulk_enable.status_code == 200
    assert bulk_enable.json()["updated"] == 1
    assert bulk_enable.json()["editAccessEnabled"] is True


def test_employee_dashboard_counts_documents_recorded_on_submitted_detail_form(client, db_session):
    now = datetime.now(UTC)
    user = User(
        id="usr-document-fallback",
        email="document.fallback@ethara.ai",
        password_hash=hash_password("employee123"),
        name="Document Fallback",
        role=Role.EMPLOYEE,
        is_active=True,
        email_verified_at=now,
    )
    profile = EmployeeProfile(
        id="emp-document-fallback",
        user_id=user.id,
        full_name="Document Fallback",
        ethara_email=user.email,
        personal_email="document.fallback.personal@example.com",
        employee_code="EMP-DOC-FALLBACK",
    )
    db_session.add(user)
    db_session.add(profile)
    db_session.flush()
    selection_form = employee_service.ensure_employee_selection_form(db_session, profile=profile)
    selection_form.status = "submitted"
    selection_form.form_data = {
        "documentsUploaded": {
            **{
                document_type: {"fileName": f"{document_type}.pdf", "fileAvailable": True}
                for document_type in EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS
            },
            "education_certificate": {"fileName": "legacy-education.pdf"},
        }
    }
    db_session.add(selection_form)
    db_session.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "document.fallback@ethara.ai", "password": "employee123"},
    )
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    dashboard = client.get("/api/v1/employees/me/dashboard", headers=headers)

    assert dashboard.status_code == 200
    body = dashboard.json()
    assert body["documentCompletionStatus"]["completed"] == len(EMPLOYEE_DETAIL_REQUIRED_DOCUMENTS)
    assert body["documentCompletionStatus"]["missing"] == []


def test_employee_dashboard_repairs_completed_candidate_onboarding(client, db_session):
    now = datetime.now(UTC)
    user = User(
        id="usr-completed-candidate-employee",
        email="completed.candidate.employee@ethara.ai",
        password_hash=hash_password("employee123"),
        name="Completed Candidate Employee",
        role=Role.EMPLOYEE,
        is_active=True,
        email_verified_at=now,
    )
    profile = EmployeeProfile(
        id="emp-completed-candidate",
        user_id=user.id,
        full_name="Completed Candidate Employee",
        ethara_email=user.email,
        personal_email="completed.candidate.personal@example.com",
        employee_code="GRP3001",
    )
    candidate = Candidate(
        id="cand-completed-candidate",
        candidate_code="ETH-REPAIR-001",
        employee_code="GRP3001",
        full_name="Completed Candidate Employee",
        personal_email="completed.candidate.personal@example.com",
        ethara_email=user.email,
        phone="9876543210",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-fe",
        current_stage=CandidateStage.ONBOARDING_COMPLETED,
        current_status="Onboarding completed",
        is_removed=False,
    )
    selection_form = SelectionForm(
        id="sf-completed-candidate",
        candidate_id=candidate.id,
        submitted_at=now,
        form_data={
            "basicDetails": {
                "fullName": "Completed Candidate Employee",
                "email": "completed.candidate.personal@example.com",
                "contactNumber": "9876543210",
                "dateOfBirth": "2001-02-03",
                "qualification": "B.Tech",
            },
            "personalDetails": {
                "fatherName": "Repair Father",
                "motherName": "Repair Mother",
                "gender": "male",
                "maritalStatus": "unmarried",
                "pan": "ABCDE1234F",
                "aadhaarNumber": "123456789012",
                "hasUanNumber": "no",
            },
            "addressDetails": {
                "currentAddress": "Current Address",
                "permanentAddress": "Permanent Address",
            },
            "emergencyContact": {
                "name": "Emergency Person",
                "phone": "9988776655",
                "relation": "Sibling",
            },
            "bankDetails": {
                "hasSavingsAccount": "yes",
                "hasSalaryAccount": "no",
                "salaryAccountInstruction": "open_or_convert_hdfc_salary_account",
            },
            "documentsUploaded": {
                "aadhaar_doc": {"fileName": "aadhaar.pdf", "fileAvailable": True},
                "pan_doc": {"fileName": "pan.pdf", "fileAvailable": True},
            },
        },
    )
    id_card_form = CandidateIdCardForm(
        id="id-card-completed-candidate",
        candidate_id=candidate.id,
        blood_group="AB+",
        emergency_no="9988776655",
        submitted_at=now,
    )
    aadhaar_doc = Document(
        id="doc-completed-aadhaar",
        candidate_id=candidate.id,
        type="selection_form_aadhaar_doc",
        file_name="aadhaar.pdf",
        file_url="/uploads/candidates/cand-completed-candidate/aadhaar.pdf",
        mime_type="application/pdf",
        status="pending",
    )
    db_session.add_all([user, profile, candidate, selection_form, id_card_form, aadhaar_doc])
    db_session.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "employee123"},
    )
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    dashboard = client.get("/api/v1/employees/me/dashboard", headers=headers)

    assert dashboard.status_code == 200
    body = dashboard.json()
    assert body["selectionForm"]["status"] == "submitted"
    assert body["selectionForm"]["formData"]["dateOfBirth"] == "2001-02-03"
    assert body["selectionForm"]["formData"]["gender"] == "male"
    assert body["selectionForm"]["formData"]["bloodGroup"] == "AB+"
    assert body["employee"]["dateOfBirth"].startswith("2001-02-03")
    assert body["employee"]["gender"] == "male"
    assert body["employee"]["bloodGroup"] == "AB+"
    assert any(
        document["type"] == "aadhaar" and not document["missing"]
        for document in body["documents"]
    )


def test_employee_exports_use_selection_form_profile_field_fallbacks(client, db_session):
    profile = db_session.get(EmployeeProfile, "emp-001")
    profile.personal_email = None
    profile.phone = None
    profile.gender = None
    profile.date_of_birth = None
    profile.blood_group = None
    profile.emergency_contact_name = None
    profile.emergency_contact_phone = None
    profile.emergency_contact_relation = None
    selection_form = employee_service.ensure_employee_selection_form(db_session, profile=profile)
    selection_form.status = "submitted"
    selection_form.form_data = {
        "personalEmail": "form.employee@example.com",
        "contactNumber": "9000012345",
        "gender": "female",
        "dateOfBirth": "1998-07-06",
        "bloodGroup": "AB+",
        "emergencyContactName": "Form Emergency",
        "emergencyContactPhone": "9876501234",
        "emergencyContactRelation": "Parent",
    }
    db_session.add_all([profile, selection_form])
    db_session.commit()

    listing = client.get("/api/v1/employees/list", headers=_hr_headers(client))
    assert listing.status_code == 200
    list_row = next(row for row in listing.json() if row["id"] == "emp-001")
    assert list_row["personalEmail"] == "form.employee@example.com"
    assert list_row["phone"] == "9000012345"
    assert list_row["gender"] == "female"
    assert list_row["dateOfBirth"].startswith("1998-07-06")
    assert list_row["bloodGroup"] == "AB+"
    assert list_row["emergencyContactName"] == "Form Emergency"
    assert list_row["emergencyContactPhone"] == "9876501234"

    response = client.get("/api/v1/employees/export", headers=_hr_headers(client))

    assert response.status_code == 200
    csv_text = response.text
    rows = list(csv.reader(io.StringIO(csv_text)))
    header = rows[0]
    employee_row = next(row for row in rows if row[header.index("Employee ID")] == "emp-001")
    assert employee_row[header.index("Personal Email")] == "form.employee@example.com"
    assert employee_row[header.index("Phone")] == "9000012345"
    assert employee_row[header.index("Gender")] == "female"
    assert employee_row[header.index("Date of Birth")].startswith("1998-07-06")
    assert employee_row[header.index("Blood Group")] == "AB+"
    assert employee_row[header.index("Emergency Contact")] == "Form Emergency"
    assert employee_row[header.index("Emergency Phone")] == "9876501234"
    assert employee_row[header.index("Emergency Relation")] == "Parent"

    package = client.get("/api/v1/employees/export/package", headers=_hr_headers(client))
    assert package.status_code == 200
    with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
        summary = archive.read("employees_summary.csv").decode()
        summary_rows = list(csv.DictReader(io.StringIO(summary)))
        summary_row = next(row for row in summary_rows if row["Employee ID"] == "emp-001")
        assert summary_row["Date of Birth"] == "1998-07-06"
        profile_name = next(
            name
            for name in archive.namelist()
            if name.endswith("/profile.json") and "EMP-001" in name
        )
        profile_json = json.loads(archive.read(profile_name).decode())
        assert profile_json["dateOfBirth"].startswith("1998-07-06")
        assert profile_json["emergencyContactName"] == "Form Emergency"


def test_employee_export_respects_lifecycle_filters_and_pending_imports(client, db_session):
    db_session.add_all(
        [
            User(
                id="usr-export-pending",
                email="pending.export@ethara.ai",
                password_hash=hash_password("employee123"),
                name="Pending Export",
                role=Role.EMPLOYEE,
                roles=[Role.EMPLOYEE.value],
                is_active=False,
                email_verified_at=None,
            ),
            EmployeeProfile(
                id="emp-export-pending",
                user_id="usr-export-pending",
                full_name="Pending Export",
                ethara_email="pending.export@ethara.ai",
                personal_email="pending.export.personal@example.com",
                employee_code="EMP-PENDING-EXPORT",
                department="Operations",
                designation="Associate",
                work_mode="Remote",
                date_of_joining=datetime(2026, 6, 21, tzinfo=UTC),
            ),
            User(
                id="usr-export-offboarded",
                email="offboarded.export@ethara.ai",
                password_hash=hash_password("employee123"),
                name="Offboarded Export",
                role=Role.EMPLOYEE,
                roles=[Role.EMPLOYEE.value],
                is_active=False,
                email_verified_at=None,
            ),
            EmployeeProfile(
                id="emp-export-offboarded",
                user_id="usr-export-offboarded",
                full_name="Offboarded Export",
                ethara_email="offboarded.export@ethara.ai",
                personal_email="offboarded.export.personal@example.com",
                employee_code="EMP-OFFBOARDED-EXPORT",
                department="Operations",
                designation="Associate",
                employment_status="Terminated",
                work_mode="Remote",
                date_of_joining=datetime(2026, 6, 22, tzinfo=UTC),
            ),
            EmployeeProfile(
                id="emp-export-inactive-status",
                user_id=None,
                full_name="Inactive Status Export",
                ethara_email="inactive.status.export@ethara.ai",
                personal_email="inactive.status.export.personal@example.com",
                employee_code="EMP-INACTIVE-STATUS-EXPORT",
                department="Operations",
                designation="Associate",
                employment_status="Inactive",
                work_mode="Remote",
                date_of_joining=datetime(2026, 6, 22, tzinfo=UTC),
            ),
            EmployeeImportStaging(
                id="stage-export-pending",
                ethara_email="imported.pending@ethara.ai",
                personal_email="imported.pending.personal@example.com",
                phone="9876500011",
                employee_code="EMP-IMPORT-PENDING",
                profile_fields={
                    "full_name": "Imported Pending",
                    "department": "Operations",
                    "designation": "Associate",
                    "work_mode": "Remote",
                    "date_of_joining": "2026-06-23",
                },
                form_data={},
                documents=[],
                status="pending",
            ),
        ]
    )
    db_session.commit()
    headers = _hr_headers(client)

    def export_rows(query: str):
        response = client.get(f"/api/v1/employees/export{query}", headers=headers)
        assert response.status_code == 200
        return list(csv.DictReader(io.StringIO(response.text)))

    def status_rows(query: str):
        response = client.get(f"/api/v1/employees/export/status{query}", headers=headers)
        assert response.status_code == 200
        return list(csv.DictReader(io.StringIO(response.text)))

    active_rows = export_rows("?lifecycle=active")
    active_ids = {row["Employee ID"] for row in active_rows}
    assert "emp-001" in active_ids
    assert "emp-export-pending" not in active_ids
    assert "emp-export-offboarded" not in active_ids
    assert "emp-export-inactive-status" not in active_ids
    assert "import:stage-export-pending" not in active_ids
    assert "Current Employee Stage" not in (active_rows[0].keys() if active_rows else set())

    active_status_rows = status_rows("?lifecycle=active")
    active_emp = next(row for row in active_status_rows if row["Employee ID"] == "emp-001")
    assert active_emp["Current Employee Stage"] == "employee_detail_form"
    assert active_emp["Current Employee State"] == "Employee Detail Form Pending"
    assert active_emp["Next Required Action"] == "Employee should submit employee detail form"

    pending_rows = export_rows("?lifecycle=pending_activation&department=Operations&workMode=Remote")
    pending_ids = {row["Employee ID"] for row in pending_rows}
    assert "emp-export-pending" in pending_ids
    assert "import:stage-export-pending" in pending_ids
    assert "emp-export-offboarded" not in pending_ids
    assert "emp-export-inactive-status" not in pending_ids
    assert {row["Lifecycle"] for row in pending_rows} == {"pending_activation"}
    pending_status_rows = status_rows("?lifecycle=pending_activation&department=Operations&workMode=Remote")
    pending_profile = next(row for row in pending_status_rows if row["Employee ID"] == "emp-export-pending")
    assert pending_profile["Current Employee Stage"] == "account_activation"
    assert pending_profile["Current Employee State"] == "Account Activation Pending"
    imported_profile = next(row for row in pending_status_rows if row["Employee ID"] == "import:stage-export-pending")
    assert imported_profile["Current Employee Stage"] == "registration"
    assert imported_profile["Current Employee State"] == "Employee Registration Pending"

    package = client.get(
        "/api/v1/employees/export/package?lifecycle=pending_activation&department=Operations&workMode=Remote",
        headers=headers,
    )
    assert package.status_code == 200
    with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
        summary = archive.read("employees_summary.csv").decode()
        summary_rows = list(csv.DictReader(io.StringIO(summary)))
        summary_ids = {row["Employee ID"] for row in summary_rows}
        assert "emp-export-pending" in summary_ids
        assert "import:stage-export-pending" in summary_ids
        assert "emp-export-offboarded" not in summary_ids
        assert "emp-export-inactive-status" not in summary_ids
        assert "Current Employee State" not in summary_rows[0]
        assert any(name.endswith("/profile.json") and "pending_EMP-IMPORT-PENDING" in name for name in archive.namelist())

    offboarded_rows = export_rows("?lifecycle=offboarded")
    offboarded_ids = {row["Employee ID"] for row in offboarded_rows}
    assert "emp-export-offboarded" in offboarded_ids
    assert "emp-export-inactive-status" in offboarded_ids
    assert "emp-export-pending" not in offboarded_ids
    assert "import:stage-export-pending" not in offboarded_ids
    offboarded_status_rows = status_rows("?lifecycle=offboarded")
    offboarded_profile = next(row for row in offboarded_status_rows if row["Employee ID"] == "emp-export-offboarded")
    inactive_status_profile = next(row for row in offboarded_status_rows if row["Employee ID"] == "emp-export-inactive-status")
    assert offboarded_profile["Current Employee Stage"] == "offboarded"
    assert offboarded_profile["Current Employee State"] == "Offboarded"
    assert inactive_status_profile["Current Employee Stage"] == "offboarded"
    assert inactive_status_profile["Current Employee State"] == "Offboarded"


def test_employee_bulk_update_accepts_date_of_joining(client, db_session):
    csv_text = "Employee Code,Date of Joining,Vendor,Work Mode\nEMP-001,16/06/2026,Vendor Demo,Remote\n"

    response = client.post(
        "/api/v1/employees/bulk-update",
        headers=_hr_headers(client),
        files={"file": ("employee-update.csv", csv_text, "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["updated"] == 1
    db_session.expire_all()
    profile = db_session.get(EmployeeProfile, "emp-001")
    assert profile.date_of_joining.date().isoformat() == "2026-06-16"
    assert profile.vendor == "Vendor Demo"
    assert profile.work_mode == "Remote"


def test_employee_selection_form_rejects_emergency_phone_longer_than_ten_digits(client):
    headers = _employee_headers(client)

    response = client.post(
        "/api/v1/employees/me/selection-form",
        headers=headers,
        json={"formData": _employee_detail_form_payload(emergencyContactPhone="99887766554")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Emergency contact phone must be exactly 10 digits."


def test_employee_selection_form_persists_manual_aadhaar_number(client, db_session):
    headers = _employee_headers(client)
    _upload_required_employee_detail_documents(client, headers)

    response = client.post(
        "/api/v1/employees/me/selection-form",
        headers=headers,
        json={"formData": _employee_detail_form_payload(aadhaarNumber="1234 5678 9012")},
    )

    assert response.status_code == 200
    db_session.expire_all()
    profile = db_session.get(EmployeeProfile, "emp-001")
    assert profile.aadhaar_last4 == "9012"
    assert profile.aadhaar_hash
    selection_form = employee_service.ensure_employee_selection_form(db_session, profile=profile)
    assert selection_form.form_data["aadhaarNumber"] == "123456789012"


def test_employee_selection_form_rejects_incomplete_aadhaar_number(client):
    headers = _employee_headers(client)

    response = client.post(
        "/api/v1/employees/me/selection-form",
        headers=headers,
        json={"formData": _employee_detail_form_payload(aadhaarNumber="1234")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Aadhaar Number must be exactly 12 digits."


def test_employee_dashboard_backfills_aadhaar_number_from_uploaded_document(client, db_session, monkeypatch):
    profile = db_session.get(EmployeeProfile, "emp-001")
    selection_form = employee_service.ensure_employee_selection_form(db_session, profile=profile)
    selection_form.form_data = {"aadhaarNumber": ""}
    document = EmployeeDocument(
        id="doc-employee-aadhaar-backfill",
        employee_profile_id=profile.id,
        type="aadhaar",
        file_name="aadhaar.pdf",
        file_url="/uploads/employee_documents/aadhaar.pdf",
        mime_type="application/pdf",
        status="uploaded",
    )
    db_session.add_all([selection_form, document])
    db_session.commit()
    monkeypatch.setattr(
        employee_service,
        "_extract_employee_aadhaar_from_document",
        lambda _record: {"aadhaarNumber": "432143214321", "ocrStatus": "extracted"},
    )

    response = client.get("/api/v1/employees/me/dashboard", headers=_employee_headers(client))

    assert response.status_code == 200
    assert response.json()["selectionForm"]["formData"]["aadhaarNumber"] == "432143214321"
    db_session.expire_all()
    refreshed_form = employee_service.ensure_employee_selection_form(db_session, profile=profile)
    refreshed_profile = db_session.get(EmployeeProfile, "emp-001")
    assert refreshed_form.form_data["aadhaarNumber"] == "432143214321"
    assert refreshed_profile.aadhaar_extracted["aadhaarNumber"] == "432143214321"
    assert refreshed_profile.aadhaar_ocr_status == "extracted"


def test_employee_self_profile_update_persists_registration_fields_and_resume(client, db_session):
    headers = _employee_headers(client)

    response = client.patch(
        "/api/v1/employees/me/profile",
        headers=headers,
        data={
            "fullName": "Updated Employee",
            "personalEmail": "updated.employee.personal@example.com",
            "employeeCode": "EMP-UPDATED-001",
            "phone": "9876543210",
            "department": "Engineering",
            "designation": "Software Engineer",
            "gender": "female",
        },
        files={
            "resume": ("updated-resume.pdf", b"%PDF-1.4 updated employee resume", "application/pdf"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["fullName"] == "Updated Employee"
    assert body["personalEmail"] == "updated.employee.personal@example.com"
    assert body["employeeCode"] == "EMP-UPDATED-001"
    assert body["department"] == "Engineering"
    assert body["designation"] == "Software Engineer"
    assert body["gender"] == "female"
    assert body["phone"] == "9876543210"
    assert body["resumePath"]

    profile = db_session.get(EmployeeProfile, "emp-001")
    assert profile is not None
    assert profile.full_name == "Updated Employee"
    assert profile.personal_email == "updated.employee.personal@example.com"
    assert profile.employee_code == "EMP-UPDATED-001"
    assert profile.department == "Engineering"
    assert profile.designation == "Software Engineer"
    assert profile.gender == "female"
    assert profile.phone == "9876543210"
    assert profile.resume_path

    latest_resume = db_session.scalar(
        select(EmployeeDocument)
        .where(
            EmployeeDocument.employee_profile_id == profile.id,
            EmployeeDocument.type == "resume",
        )
        .order_by(EmployeeDocument.created_at.desc(), EmployeeDocument.updated_at.desc())
    )
    assert latest_resume is not None
    assert latest_resume.file_name == "updated-resume.pdf"

    auth_me = client.get("/api/v1/auth/me", headers=headers)
    assert auth_me.status_code == 200
    assert auth_me.json()["user"]["name"] == "Updated Employee"
    assert auth_me.json()["user"]["phone"] == "9876543210"
    assert auth_me.json()["profile"]["employeeCode"] == "EMP-UPDATED-001"


def test_employee_referral_creates_resume_database_entry(client, db_session):
    headers = _employee_headers(client)

    referral_create = client.post(
        "/api/v1/employees/me/referrals",
        headers=headers,
        data={
            "fullName": "Portal Candidate",
            "personalEmail": "portal.candidate@example.com",
            "phone": "9000011111",
            "linkedinUrl": "https://linkedin.com/in/portal-candidate",
            "positionId": "pos-fe",
        },
        files={"resume": ("portal-resume.pdf", b"%PDF-1.4 portal resume", "application/pdf")},
    )

    assert referral_create.status_code == 200
    application = db_session.scalar(
        select(CareerApplication).where(CareerApplication.email == "portal.candidate@example.com")
    )
    assert application is not None
    assert application.resume_file_name == "portal-resume.pdf"
    assert application.resume_url
    assert application.referred_by_id == "usr-employee"
    assert db_session.scalar(select(User).where(User.email == "portal.candidate@example.com")) is None


def test_employee_document_and_documenso_compliance_flow(client, db_session):
    employee_headers = _employee_headers(client)
    compliance_headers = _compliance_headers(client)

    upload = client.post(
        "/api/v1/employees/me/documents/upload",
        headers=employee_headers,
        files={"file": ("pan.pdf", b"%PDF-1.4 employee pan", "application/pdf")},
        data={"type": "pan"},
    )
    assert upload.status_code == 200
    upload_body = upload.json()
    assert upload_body["type"] == "pan"
    assert upload_body["downloadEndpoint"]

    compliance_list = client.get("/api/v1/employees/me/compliance", headers=employee_headers)
    assert compliance_list.status_code == 200
    assert compliance_list.json() == []

    form = _add_employee_documenso_form(db_session)

    assigned = client.get("/api/v1/employees/me/compliance", headers=employee_headers)
    assert assigned.status_code == 200
    assigned_body = assigned.json()
    assert len(assigned_body) == 1
    assert assigned_body[0]["id"] == form.id
    assert assigned_body[0]["formType"] == "form_11"
    assert assigned_body[0]["documensoId"] == "9011"
    assert assigned_body[0]["signedUrl"] == "https://documenso.example/sign/form-11"

    queue = client.get("/api/v1/employees/compliance/forms", headers=compliance_headers)
    assert queue.status_code == 200
    queue_item = next(item for item in queue.json() if item["id"] == form.id)
    assert queue_item["employeeId"] == "emp-001"


def test_employee_compliance_does_not_auto_create_legacy_forms(client):
    employee_headers = _employee_headers(client)

    compliance_list = client.get("/api/v1/employees/me/compliance", headers=employee_headers)
    assert compliance_list.status_code == 200
    form_types = {form["formType"] for form in compliance_list.json()}

    assert {"posh", "epf", "bank_details"}.isdisjoint(form_types)


def test_employee_cannot_submit_unassigned_legacy_compliance_form(client):
    employee_headers = _employee_headers(client)

    response = client.post(
        "/api/v1/employees/me/compliance/missing-epf-form/submit",
        headers=employee_headers,
        json={"formData": {"uanNumber": "102345678901"}},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Compliance form not found"


def test_employee_documenso_compliance_refresh_marks_signed(client, db_session, monkeypatch):
    employee_headers = _employee_headers(client)
    form = _add_employee_documenso_form(db_session, documenso_id="9012", status="sent")

    def fake_refresh(db, *, form):
        form.status = "signed"
        form.signed_at = datetime.now(UTC)
        form.pdf_url = "https://documenso.example/form-11.pdf"
        db.add(form)
        db.flush()
        return form

    monkeypatch.setattr(
        "app.services.compliance_documenso.refresh_compliance_form",
        fake_refresh,
    )

    response = client.post("/api/v1/employees/me/compliance/refresh-esign", headers=employee_headers)

    assert response.status_code == 200
    body = response.json()
    refreshed = next(item for item in body if item["id"] == form.id)
    assert refreshed["status"] == "signed"
    assert refreshed["pdfUrl"] == "https://documenso.example/form-11.pdf"


def test_employee_compliance_esign_send_creates_documenso_forms_idempotently(
    client,
    db_session,
    monkeypatch,
):
    compliance_headers = _compliance_headers(client)
    _add_documenso_compliance_templates(db_session)
    created_payloads = []
    _mock_documenso_compliance_send(monkeypatch, created_payloads)

    first = client.post("/api/v1/employees/emp-001/compliance/send-esign", headers=compliance_headers)
    assert first.status_code == 200
    first_body = first.json()
    assert {item["formType"] for item in first_body} == {"form_11", "form_2", "form_f"}
    assert all(item["status"] == "sent" for item in first_body)
    assert all(item["documensoId"] for item in first_body)
    assert all(item["signedUrl"].startswith("https://documenso.example/sign/") for item in first_body)
    assert len(created_payloads) == 3

    second = client.post("/api/v1/employees/emp-001/compliance/send-esign", headers=compliance_headers)
    assert second.status_code == 200
    assert len(second.json()) == 3
    assert len(created_payloads) == 3


def test_employee_compliance_esign_send_advances_linked_candidate_by_grp_code(
    client,
    db_session,
    monkeypatch,
):
    compliance_headers = _compliance_headers(client)
    profile = db_session.get(EmployeeProfile, "emp-001")
    profile.employee_code = "GRP2026"
    candidate = Candidate(
        id="cand-employee-compliance-link",
        candidate_code="ETH-LINK-001",
        employee_code="GRP2026",
        full_name="Linked Candidate",
        personal_email="linked.candidate@example.com",
        ethara_email="employee@ethara.ai",
        phone="9000000999",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    db_session.add_all([profile, candidate])
    db_session.commit()
    _add_documenso_compliance_templates(db_session)
    created_payloads = []
    _mock_documenso_compliance_send(monkeypatch, created_payloads)

    response = client.post("/api/v1/employees/emp-001/compliance/send-esign", headers=compliance_headers)

    assert response.status_code == 200
    db_session.expire_all()
    refreshed = db_session.get(Candidate, candidate.id)
    assert refreshed.current_stage == CandidateStage.STATUTORY_FORMS_SENT
    assert refreshed.current_status == "Statutory Forms Sent"
    assert len(created_payloads) == 3
    assert created_payloads[0]["recipients"][0]["email"] == "employee@ethara.ai"


def test_employee_compliance_sync_advances_linked_candidate_when_all_documenso_forms_signed(db_session):
    profile = db_session.get(EmployeeProfile, "emp-001")
    profile.employee_code = "GRP3030"
    candidate = Candidate(
        id="cand-employee-compliance-signed",
        candidate_code="ETH-LINK-002",
        employee_code="GRP3030",
        full_name="Signed Compliance Candidate",
        personal_email="signed.compliance@example.com",
        ethara_email="employee@ethara.ai",
        phone="9000000998",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.STATUTORY_FORMS_SENT,
        current_status="Statutory Forms Sent",
    )
    forms = [
        EmployeeComplianceForm(
            employee_profile_id="emp-001",
            form_type=form_type,
            form_title=title,
            status="signed",
            documenso_id=doc_id,
            signed_at=datetime.now(UTC),
        )
        for form_type, title, doc_id in [
            ("form_11", "Form 11", "9101"),
            ("form_2", "Form 2", "9102"),
            ("form_f", "Form F", "9103"),
        ]
    ]
    db_session.add_all([profile, candidate, *forms])
    db_session.commit()

    compliance_documenso.sync_and_advance(db_session, profile=profile)
    db_session.commit()

    db_session.expire_all()
    refreshed = db_session.get(Candidate, candidate.id)
    assert refreshed.current_stage == CandidateStage.ONBOARDING_COMPLETED
    assert refreshed.current_status == "Onboarding Completed"
    assert all(form.verified_at is not None for form in forms)


def test_employee_profile_journey_treats_signed_compliance_as_complete_and_sent_as_pending(db_session):
    profile = db_session.get(EmployeeProfile, "emp-001")
    documents = [
        {"type": key, "missing": False, "verificationStatus": "verified"}
        for key, _ in employee_service.EMPLOYEE_REQUIRED_DOCUMENTS
    ]
    contract = EmployeeContract(
        employee_profile_id="emp-001",
        title="Offer Letter",
        status=ContractStatus.SIGNED,
    )
    signed_form = EmployeeComplianceForm(
        employee_profile_id="emp-001",
        form_type="form_11",
        form_title="Form 11",
        status="signed",
        documenso_id="9201",
    )
    sent_form = EmployeeComplianceForm(
        employee_profile_id="emp-001",
        form_type="form_2",
        form_title="Form 2",
        status="sent",
        documenso_id="9202",
    )

    signed_journey, _, _ = employee_service._build_profile_journey(
        profile=profile,
        selection_form=None,
        documents=documents,
        contracts=[contract],
        compliance_forms=[signed_form],
    )
    sent_journey, _, _ = employee_service._build_profile_journey(
        profile=profile,
        selection_form=None,
        documents=documents,
        contracts=[contract],
        compliance_forms=[sent_form],
    )

    signed_compliance = next(item for item in signed_journey if item["key"] == "compliance")
    sent_compliance = next(item for item in sent_journey if item["key"] == "compliance")
    assert signed_compliance["status"] == "completed"
    assert sent_compliance["status"] == "pending"


def test_employee_contract_sync_marks_contract_signed_from_backfilled_document(db_session):
    profile = db_session.get(EmployeeProfile, "emp-001")
    draft_contract = EmployeeContract(
        id="contract-sync-draft",
        employee_profile_id=profile.id,
        title="Employment Agreement",
        status=ContractStatus.DRAFT,
        remarks="Awaiting HR contract assignment.",
        uploaded_by=profile.user_id,
    )
    signed_document = EmployeeDocument(
        id="doc-signed-contract-sync",
        employee_profile_id=profile.id,
        type="signed_employment_agreement",
        file_name="Employment Agreement - Ethara.pdf",
        file_url="/uploads/contracts/emp-001/agreement.pdf",
        mime_type="application/pdf",
        status="signed",
        verified_at=datetime(2026, 6, 15, tzinfo=UTC),
    )
    db_session.add_all([draft_contract, signed_document])
    db_session.commit()

    changed = employee_service.sync_employee_contracts_from_signed_documents(db_session, profile=profile)
    db_session.commit()

    assert changed is True
    db_session.expire_all()
    refreshed = db_session.get(EmployeeContract, draft_contract.id)
    assert refreshed.status == ContractStatus.SIGNED
    assert refreshed.file_url == "/uploads/contracts/emp-001/agreement.pdf"
    assert refreshed.file_name == "Employment Agreement - Ethara.pdf"
    assert refreshed.completed_at.replace(tzinfo=UTC) == datetime(2026, 6, 15, tzinfo=UTC)


def test_employee_contract_sync_prefers_split_agreement_over_generic_signed_contract(db_session):
    profile = db_session.get(EmployeeProfile, "emp-001")
    generic_document = EmployeeDocument(
        id="doc-generic-signed-contract-sync",
        employee_profile_id=profile.id,
        type="signed_contract",
        file_name="Signed Contract.pdf",
        file_url="/uploads/contracts/emp-001/merged.pdf",
        mime_type="application/pdf",
        status="signed",
    )
    agreement_document = EmployeeDocument(
        id="doc-split-employment-agreement-sync",
        employee_profile_id=profile.id,
        type="signed_employment_agreement",
        file_name="Employment Agreement - Ethara.pdf",
        file_url="/uploads/contracts/emp-001/agreement.pdf",
        mime_type="application/pdf",
        status="signed",
    )
    db_session.add_all([generic_document, agreement_document])
    db_session.commit()

    changed = employee_service.sync_employee_contracts_from_signed_documents(db_session, profile=profile)
    db_session.commit()

    assert changed is True
    contracts = list(
        db_session.scalars(
            select(EmployeeContract).where(EmployeeContract.employee_profile_id == profile.id)
        )
    )
    assert len([contract for contract in contracts if contract.title == "Employment Agreement"]) == 1
    assert contracts[0].file_url == "/uploads/contracts/emp-001/agreement.pdf"


def test_employee_contract_sync_maps_documenso_profile_sent_to_ethara_email(db_session):
    profile = db_session.get(EmployeeProfile, "emp-001")
    draft_contract = EmployeeContract(
        id="contract-sync-documenso-draft",
        employee_profile_id=profile.id,
        title="Employment Agreement",
        status=ContractStatus.DRAFT,
        remarks="Awaiting HR contract assignment.",
        uploaded_by=profile.user_id,
    )
    signed_profile = DocumensoSignedProfile(
        id="documenso-profile-contract-sync",
        documenso_doc_id=1421604,
        template_id=employee_service.OLD_EMPLOYEE_DOCUMENSO_CONTRACT_TEMPLATE_ID,
        template_title=employee_service.OLD_EMPLOYEE_DOCUMENSO_CONTRACT_TEMPLATE_TITLE,
        recipient_email=profile.ethara_email,
        recipient_name=profile.full_name,
        completed_at=datetime(2026, 5, 14, 20, 35, tzinfo=UTC),
        pdf_url=None,
    )
    db_session.add_all([draft_contract, signed_profile])
    db_session.commit()

    changed = employee_service.sync_employee_contracts_from_signed_documents(db_session, profile=profile)
    db_session.commit()

    assert changed is True
    db_session.expire_all()
    refreshed = db_session.get(EmployeeContract, draft_contract.id)
    assert refreshed.status == ContractStatus.SIGNED
    assert refreshed.title == "NDA & Employment Contract"
    assert refreshed.file_url is None
    assert refreshed.file_name == "NDA & Employment Contract.pdf"
    assert "Documenso old employee contract document 1421604" in refreshed.remarks


def test_employee_contract_sync_ignores_non_old_employee_documenso_template(db_session):
    profile = db_session.get(EmployeeProfile, "emp-001")
    draft_contract = EmployeeContract(
        id="contract-sync-non-old-documenso-draft",
        employee_profile_id=profile.id,
        title="Employment Agreement",
        status=ContractStatus.DRAFT,
        remarks="Awaiting HR contract assignment.",
        uploaded_by=profile.user_id,
    )
    signed_profile = DocumensoSignedProfile(
        id="documenso-profile-non-old-contract-sync",
        documenso_doc_id=1311820,
        template_title="New 6M Internship Contracts & NDA-Ethara AI Remote",
        recipient_email=profile.ethara_email,
        recipient_name=profile.full_name,
        completed_at=datetime(2026, 5, 14, 20, 35, tzinfo=UTC),
        pdf_url="/uploads/contracts/documenso_profiles/1311820.pdf",
    )
    db_session.add_all([draft_contract, signed_profile])
    db_session.commit()

    changed = employee_service.sync_employee_contracts_from_signed_documents(db_session, profile=profile)
    db_session.commit()

    assert changed is False
    db_session.expire_all()
    refreshed = db_session.get(EmployeeContract, draft_contract.id)
    assert refreshed.status == ContractStatus.DRAFT
    assert refreshed.file_url is None


def test_employee_staff_can_upload_preview_download_and_delete_document(client, db_session, pdf_file):
    headers = _hr_headers(client)

    upload = client.post(
        "/api/v1/employees/emp-001/documents/upload",
        headers=headers,
        files={"file": pdf_file},
        data={"type": "pan"},
    )
    assert upload.status_code == 200
    upload_body = upload.json()
    assert upload_body["type"] == "pan"
    assert upload_body["previewEndpoint"].endswith(f"/documents/{upload_body['id']}/preview")
    assert upload_body["downloadEndpoint"].endswith(f"/documents/{upload_body['id']}/download")

    preview = client.get(upload_body["previewEndpoint"], headers=headers)
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith("application/pdf")

    download = client.get(upload_body["downloadEndpoint"], headers=headers)
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("application/octet-stream")

    detail = client.get("/api/v1/employees/emp-001", headers=headers)
    assert detail.status_code == 200
    pan_doc = next(document for document in detail.json()["documents"] if document["type"] == "pan")
    assert pan_doc["missing"] is False
    assert pan_doc["id"] == upload_body["id"]

    delete_response = client.delete(
        f"/api/v1/employees/emp-001/documents/{upload_body['id']}",
        headers=headers,
    )
    assert delete_response.status_code == 204
    assert db_session.get(EmployeeDocument, upload_body["id"]) is None

    detail_after_delete = client.get("/api/v1/employees/emp-001", headers=headers)
    assert detail_after_delete.status_code == 200
    pan_after_delete = next(
        document for document in detail_after_delete.json()["documents"] if document["type"] == "pan"
    )
    assert pan_after_delete["missing"] is True
