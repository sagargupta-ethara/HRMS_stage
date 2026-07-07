from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.security import hash_password
from app.db.models import (
    AdminSetting,
    AuditLog,
    AuthCode,
    AuthCodePurpose,
    Candidate,
    CandidateStage,
    EmployeeProfile,
    EmployeeSelectionForm,
    Role,
    SourceType,
    User,
)


def test_login_and_get_profile(client):
    login = client.post("/api/v1/auth/login", json={"email": "admin@ethara.ai", "password": "admin123"})
    assert login.status_code == 200
    body = login.json()
    assert body["user"]["email"] == "admin@ethara.ai"
    assert body["profile"] is None
    assert "accessToken" in body

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['accessToken']}"})
    assert me.status_code == 200
    assert me.json()["user"]["role"] == "admin"
    assert me.json()["profile"] is None


@pytest.mark.parametrize(
    ("email", "password", "role", "profile_type"),
    [
        ("admin@ethara.ai", "admin123", "admin", None),
        ("hr@ethara.ai", "hr123", "hr", None),
        ("vendor@ethara.ai", "vendor123", "vendor", "vendor"),
        ("referrer@ethara.ai", "referrer123", "employee_referrer", None),
        ("evaluator@ethara.ai", "evaluator123", "evaluator", None),
        ("it@ethara.ai", "it123", "it_team", None),
        ("compliance@ethara.ai", "compliance123", "compliance", None),
        ("employee@ethara.ai", "employee123", "employee", "employee"),
    ],
)
def test_seeded_roles_can_login_with_normalized_email(client, email, password, role, profile_type):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": f"  {email.upper()}  ", "password": password},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == email
    assert body["user"]["role"] == role
    if profile_type is None:
        assert body["profile"] is None
    else:
        assert body["profile"]["type"] == profile_type


def test_wrong_password_fails(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@ethara.ai", "password": "wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_employee_login_blocked_while_linked_candidate_onboarding_pending(client, db_session):
    user = User(
        id="usr-pending-candidate-login",
        email="pending.candidate.employee@ethara.ai",
        password_hash=hash_password("Pending123"),
        name="Pending Candidate Employee",
        role=Role.EMPLOYEE,
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    profile = EmployeeProfile(
        id="emp-pending-candidate-login",
        user_id=user.id,
        full_name="Pending Candidate Employee",
        ethara_email="pending.candidate.employee@ethara.ai",
        personal_email="pending.candidate@example.com",
        employee_code="GRP-PENDING-AUTH",
        phone="9876543222",
        department="Operations",
        designation="Associate",
        gender="female",
        aadhaar_last4="1234",
    )
    candidate = Candidate(
        id="cand-pending-employee-login",
        candidate_code="ETH-PENDING-AUTH",
        employee_code="GRP-PENDING-AUTH",
        full_name="Pending Candidate Employee",
        personal_email="pending.candidate@example.com",
        ethara_email="pending.candidate.employee@ethara.ai",
        phone="9876543222",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.ONBOARDING_COMPLETED,
        current_status="Onboarding Completed",
    )
    db_session.add_all([user, profile, candidate])
    db_session.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "pending.candidate.employee@ethara.ai", "password": "Pending123"},
    )
    assert login.status_code == 200
    token = login.json()["accessToken"]

    candidate.current_stage = CandidateStage.STATUTORY_FORMS_SENT
    candidate.current_status = "Statutory Forms Sent"
    db_session.add(candidate)
    db_session.commit()

    existing_session = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert existing_session.status_code == 403
    assert existing_session.json()["detail"] == (
        "Candidate onboarding pending. Please complete candidate onboarding before using employee login."
    )

    blocked_login = client.post(
        "/api/v1/auth/login",
        json={"email": "pending.candidate.employee@ethara.ai", "password": "Pending123"},
    )
    assert blocked_login.status_code == 403
    assert blocked_login.json()["detail"] == (
        "Candidate onboarding pending. Please complete candidate onboarding before using employee login."
    )


def test_password_reset_with_otp(client, monkeypatch):
    monkeypatch.setattr("app.services.account_security._generate_otp", lambda: "123456")

    requested = client.post("/api/v1/auth/password-reset/request", json={"email": " Admin@Ethara.AI "})
    assert requested.status_code == 200

    reset = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={
            "email": "ADMIN@ETHARA.AI",
            "code": "123456",
            "newPassword": "newadmin123",
        },
    )
    assert reset.status_code == 200

    old_login = client.post("/api/v1/auth/login", json={"email": "admin@ethara.ai", "password": "admin123"})
    assert old_login.status_code == 401

    new_login = client.post(
        "/api/v1/auth/login",
        json={"email": "  ADMIN@ETHARA.AI ", "password": "newadmin123"},
    )
    assert new_login.status_code == 200


def test_change_password_otp_rejects_wrong_code_without_calling_it_expired(client, monkeypatch):
    monkeypatch.setattr("app.services.account_security._generate_otp", lambda: "111111")
    monkeypatch.setattr(
        "app.services.account_security.EmailService.send_email",
        lambda *args, **kwargs: None,
    )

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@ethara.ai", "password": "admin123"},
    )
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    requested = client.post("/api/v1/auth/change-password-otp/request", headers=headers)
    assert requested.status_code == 200

    wrong = client.post(
        "/api/v1/auth/change-password-otp/confirm",
        headers=headers,
        json={"code": "000000", "newPassword": "Changed123"},
    )
    assert wrong.status_code == 400
    assert wrong.json()["detail"] == "Invalid verification code."

    correct = client.post(
        "/api/v1/auth/change-password-otp/confirm",
        headers=headers,
        json={"code": "111111", "newPassword": "Changed123"},
    )
    assert correct.status_code == 200


def test_change_password_otp_reports_expired_latest_code(client, db_session, monkeypatch):
    monkeypatch.setattr("app.services.account_security._generate_otp", lambda: "222222")
    monkeypatch.setattr(
        "app.services.account_security.EmailService.send_email",
        lambda *args, **kwargs: None,
    )

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@ethara.ai", "password": "admin123"},
    )
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    requested = client.post("/api/v1/auth/change-password-otp/request", headers=headers)
    assert requested.status_code == 200

    code = db_session.scalar(
        select(AuthCode)
        .where(
            AuthCode.email == "admin@ethara.ai",
            AuthCode.purpose == AuthCodePurpose.PASSWORD_RESET,
            AuthCode.consumed_at.is_(None),
        )
        .order_by(AuthCode.created_at.desc())
    )
    assert code is not None
    code.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db_session.add(code)
    db_session.commit()

    expired = client.post(
        "/api/v1/auth/change-password-otp/confirm",
        headers=headers,
        json={"code": "222222", "newPassword": "Changed123"},
    )
    assert expired.status_code == 400
    assert expired.json()["detail"] == "Verification code has expired. Please request a new code."


def test_candidate_registration_verification_then_login(client, pdf_file, monkeypatch):
    monkeypatch.setattr("app.services.account_security._generate_otp", lambda: "654321")
    monkeypatch.setattr("app.services.account_security.EmailService.send_email", lambda *args, **kwargs: None)

    registered = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "Portal Candidate",
            "gender": "female",
            "experienceType": "experienced",
            "experienceYears": "5",
            "personalEmail": "portal.candidate@example.com",
            "phone": "9876543209",
            "password": "candidate123",
            "aadhaarNumber": "123412341234",
            "dateOfBirth": "2000-01-15",
            "collegeId": "",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )
    assert registered.status_code == 200

    blocked_login = client.post(
        "/api/v1/auth/login",
        json={"email": " portal.candidate@EXAMPLE.com ", "password": "candidate123"},
    )
    assert blocked_login.status_code == 403
    assert blocked_login.json()["detail"] == "EMAIL_NOT_VERIFIED"

    requested = client.post(
        "/api/v1/auth/email-verification/request-public",
        json={"email": "PORTAL.CANDIDATE@EXAMPLE.COM"},
    )
    assert requested.status_code == 200

    confirmed = client.post(
        "/api/v1/auth/email-verification/confirm-public",
        json={"email": "portal.candidate@example.com", "code": "654321"},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["user"]["emailVerified"] is True
    assert confirmed.json()["profile"]["type"] == "candidate"

    me = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {confirmed.json()['accessToken']}"},
    )
    assert me.status_code == 200
    assert me.json()["user"]["emailVerified"] is True
    assert me.json()["profile"]["type"] == "candidate"

    verified_login = client.post(
        "/api/v1/auth/login",
        json={"email": " PORTAL.CANDIDATE@example.com ", "password": "candidate123"},
    )
    assert verified_login.status_code == 200


def test_public_email_verification_resends_for_inactive_unverified_user(client, db_session, monkeypatch):
    monkeypatch.setattr("app.services.account_security._generate_otp", lambda: "789012")
    monkeypatch.setattr("app.services.account_security.EmailService.send_email", lambda *args, **kwargs: None)
    pending_user = User(
        id="usr-pending-candidate",
        email="pending.candidate@example.com",
        password_hash=hash_password("Candidate123"),
        name="Pending Candidate",
        role=Role.CANDIDATE,
        roles=[Role.CANDIDATE.value],
        is_active=False,
        email_verified_at=None,
    )
    db_session.add(pending_user)
    db_session.commit()

    requested = client.post(
        "/api/v1/auth/email-verification/request-public",
        json={"email": "PENDING.CANDIDATE@EXAMPLE.COM"},
    )
    assert requested.status_code == 200

    confirmed = client.post(
        "/api/v1/auth/email-verification/confirm-public",
        json={"email": "pending.candidate@example.com", "code": "789012"},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["user"]["emailVerified"] is True

    db_session.refresh(pending_user)
    assert pending_user.is_active is True
    assert pending_user.email_verified_at is not None


def test_public_email_verification_rejects_already_verified_account(client, db_session, monkeypatch):
    # Regression: the public confirm endpoint used to return a session for ANY already-verified
    # account WITHOUT validating the OTP → unauthenticated account takeover (anyone knowing a
    # verified email could mint a session for it). It must now refuse and issue no token.
    monkeypatch.setattr("app.services.account_security.EmailService.send_email", lambda *args, **kwargs: None)
    victim = User(
        id="usr-verified-victim",
        email="verified.victim@example.com",
        password_hash=hash_password("Victim123"),
        name="Verified Victim",
        role=Role.ADMIN,
        roles=[Role.ADMIN.value],
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    db_session.add(victim)
    db_session.commit()

    attempt = client.post(
        "/api/v1/auth/email-verification/confirm-public",
        json={"email": "verified.victim@example.com", "code": "000000"},
    )
    assert attempt.status_code == 400
    assert "accessToken" not in attempt.json()


def test_employee_registration_verify_email_then_login_uses_company_email(client, pdf_file, monkeypatch):
    monkeypatch.setattr("app.services.account_security._generate_otp", lambda: "123456")

    registered = client.post(
        "/api/v1/employees/register",
        data={
            "fullName": "New Employee",
            "etharaEmail": "New.Employee@Ethara.AI",
            "personalEmail": "new.employee@example.com",
            "employeeCode": "emp-777",
            "phone": "9876543219",
            "department": "Engineering",
            "designation": "Platform Engineer",
            "gender": "prefer_not_to_say",
            "password": "Employee123",
            "aadhaarNumber": "111122223333",
            "dateOfBirth": "1997-06-15",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )

    assert registered.status_code == 201
    body = registered.json()
    assert body["email"] == "new.employee@ethara.ai"
    assert body["employeeCode"] == "EMP-777"

    blocked_login = client.post(
        "/api/v1/auth/login",
        json={"email": "  NEW.EMPLOYEE@ETHARA.AI ", "password": "Employee123"},
    )
    assert blocked_login.status_code == 403
    assert blocked_login.json()["detail"] == "EMAIL_NOT_VERIFIED"

    verified = client.post(
        "/api/v1/employees/verify-email",
        json={"email": "new.employee@ethara.ai", "code": "123456"},
    )
    assert verified.status_code == 200

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "  NEW.EMPLOYEE@ETHARA.AI ", "password": "Employee123"},
    )
    assert login.status_code == 200
    login_body = login.json()
    assert login_body["user"]["email"] == "new.employee@ethara.ai"
    assert login_body["user"]["role"] == "employee"
    assert login_body["profile"]["type"] == "employee"
    assert login_body["profile"]["employeeCode"] == "EMP-777"
    assert login_body["profile"]["etharaEmail"] == "new.employee@ethara.ai"


def test_employee_aadhaar_ocr_reuses_candidate_extractor(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_aadhaar_fields",
        lambda _file: {
            "aadhaarNumber": "111122223333",
            "dateOfBirth": "1997-06-15",
            "cardHolderName": "Shared OCR Employee",
            "ocrStatus": "extracted",
            "message": "Aadhaar details extracted successfully.",
        },
    )

    response = client.post(
        "/api/v1/employees/aadhaar/ocr",
        files={"aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "aadhaarNumber": "111122223333",
        "dateOfBirth": "1997-06-15",
        "cardHolderName": "Shared OCR Employee",
        "ocrStatus": "extracted",
        "message": "Aadhaar details extracted successfully.",
    }


def test_employee_pan_ocr_reuses_shared_extractor(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_pan_fields",
        lambda _file: {
            "panNumber": "ABCDE1234F",
            "ocrStatus": "extracted",
            "message": "PAN number extracted successfully.",
        },
    )

    response = client.post(
        "/api/v1/employees/pan/ocr",
        files={"panCard": ("pan-card.jpg", BytesIO(b"fake-image"), "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "panNumber": "ABCDE1234F",
        "ocrStatus": "extracted",
        "message": "PAN number extracted successfully.",
    }


def test_employee_address_ocr_reuses_shared_extractor(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_address_fields",
        lambda _file: {
            "address": "House 12, MG Road, Bengaluru, Karnataka 560001",
            "addressLines": ["House 12", "MG Road", "Bengaluru", "Karnataka 560001"],
            "postalCode": "560001",
            "ocrStatus": "extracted",
            "message": "Address extracted from document.",
        },
    )

    response = client.post(
        "/api/v1/employees/address/ocr",
        files={"addressProof": ("aadhaar-back.jpg", BytesIO(b"fake-image"), "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "address": "House 12, MG Road, Bengaluru, Karnataka 560001",
        "addressLines": ["House 12", "MG Road", "Bengaluru", "Karnataka 560001"],
        "postalCode": "560001",
        "ocrStatus": "extracted",
        "message": "Address extracted from document.",
    }


def test_employee_document_ocr_helpers_bypass_employee_module_gate(client, db_session, monkeypatch):
    db_session.add(
        AdminSetting(
            namespace="role_modules",
            key="role_modules:employee",
            value={"enabled": ["dashboard", "selection_forms"]},
            updated_by="usr-admin",
        )
    )
    db_session.commit()

    login = client.post("/api/v1/auth/login", json={"email": "employee@ethara.ai", "password": "employee123"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    monkeypatch.setattr(
        "app.api.routes.candidates.extract_pan_fields",
        lambda _file: {
            "panNumber": "ABCDE1234F",
            "ocrStatus": "extracted",
            "message": "PAN number extracted successfully.",
        },
    )
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_cheque_fields",
        lambda _file: {
            "accountNumber": "50100686613898",
            "ifscCode": "HDFC0006228",
            "accountHolderName": None,
            "bankName": "HDFC Bank",
            "ocrStatus": "extracted",
            "message": "Bank details extracted successfully.",
        },
    )
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_address_fields",
        lambda _file: {
            "address": "S/O Sanjeev Gupta, new darpan colony, Gwalior, Madhya Pradesh 474011",
            "addressLines": ["S/O Sanjeev Gupta", "new darpan colony", "Gwalior", "Madhya Pradesh 474011"],
            "postalCode": "474011",
            "ocrStatus": "extracted",
            "message": "Address extracted from document.",
        },
    )

    pan = client.post(
        "/api/v1/employees/pan/ocr",
        headers=headers,
        files={"panCard": ("pan-card.jpg", BytesIO(b"fake-image"), "image/jpeg")},
    )
    cheque = client.post(
        "/api/v1/employees/cheque/ocr",
        headers=headers,
        files={"cancelledCheque": ("cheque.jpg", BytesIO(b"fake-image"), "image/jpeg")},
    )
    address = client.post(
        "/api/v1/employees/address/ocr",
        headers=headers,
        files={"addressProof": ("aadhaar-back.jpg", BytesIO(b"fake-image"), "image/jpeg")},
    )

    assert pan.status_code == 200
    assert pan.json()["panNumber"] == "ABCDE1234F"
    assert cheque.status_code == 200
    assert cheque.json()["ifscCode"] == "HDFC0006228"
    assert address.status_code == 200
    assert address.json()["postalCode"] == "474011"


def test_employee_register_backfills_date_of_birth_from_aadhaar_ocr(client, db_session, pdf_file, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_aadhaar_fields",
        lambda _file: {
            "aadhaarNumber": "111122223333",
            "dateOfBirth": "1997-06-15",
            "cardHolderName": "OCR Backfill Employee",
            "ocrStatus": "extracted",
            "message": "Aadhaar details extracted successfully.",
        },
    )

    response = client.post(
        "/api/v1/employees/register",
        data={
            "fullName": "OCR Backfill Employee",
            "etharaEmail": "dob.backfill@ethara.ai",
            "personalEmail": "dob.backfill@example.com",
            "employeeCode": "emp-778",
            "phone": "9876543218",
            "department": "Engineering",
            "designation": "Platform Engineer",
            "gender": "female",
            "password": "Employee123",
            "aadhaarNumber": "111122223333",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )

    assert response.status_code == 201

    profile = db_session.scalar(
        select(EmployeeProfile).where(EmployeeProfile.ethara_email == "dob.backfill@ethara.ai")
    )
    assert profile is not None
    assert profile.date_of_birth is not None
    assert profile.date_of_birth.date().isoformat() == "1997-06-15"
    assert profile.aadhaar_ocr_status == "extracted"

    selection_form = db_session.scalar(
        select(EmployeeSelectionForm).where(EmployeeSelectionForm.employee_profile_id == profile.id)
    )
    assert selection_form is not None
    assert selection_form.status == "prefilled"
    assert selection_form.form_data["employeeName"] == "OCR Backfill Employee"
    assert selection_form.form_data["employeeCode"] == "EMP-778"
    assert selection_form.form_data["department"] == "Engineering"
    assert selection_form.form_data["designation"] == "Platform Engineer"
    assert selection_form.form_data["gender"] == "female"
    assert selection_form.form_data["contactNumber"] == "9876543218"
    assert selection_form.form_data["personalEmail"] == "dob.backfill@example.com"
    assert selection_form.form_data["officialEmail"] == "dob.backfill@ethara.ai"
    assert selection_form.form_data["dateOfBirth"] == "1997-06-15"
    assert selection_form.form_data["aadhaarNumber"] == "**** **** 3333"


def test_legacy_employee_registration_is_repaired_on_login(client, db_session):
    legacy_user = User(
        id="usr-legacy-employee",
        email="legacy.employee@ethara.ai",
        password_hash=hash_password("Legacy123"),
        name="Legacy Employee",
        phone="9876543220",
        role=Role.EMPLOYEE_REFERRER,
        is_active=True,
    )
    db_session.add(legacy_user)
    db_session.add(
        AuditLog(
            id="audit-legacy-employee",
            entity_type="employee_registration",
            entity_id=legacy_user.id,
            action="registered",
            performed_by=legacy_user.id,
            performed_by_name=legacy_user.name,
            user_id=legacy_user.id,
            new_value={
                "fullName": "Legacy Employee",
                "etharaEmail": "legacy.employee@ethara.ai",
                "personalEmail": "legacy.employee@example.com",
                "phone": "9876543220",
                "employeeCode": "EMP-LEGACY",
                "department": "Operations",
                "designation": "Analyst",
                "gender": "female",
                "aadhaarLast4": "9876",
                "ocrStatus": "needs_review",
            },
        )
    )
    db_session.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": " LEGACY.EMPLOYEE@ETHARA.AI ", "password": "Legacy123"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "employee"
    assert login.json()["profile"]["type"] == "employee"

    repaired_user = db_session.get(User, legacy_user.id)
    repaired_profile = db_session.scalar(
        select(EmployeeProfile).where(EmployeeProfile.user_id == legacy_user.id)
    )
    assert repaired_user is not None
    assert repaired_user.role == Role.EMPLOYEE
    assert repaired_profile is not None
    assert repaired_profile.employee_code == "EMP-LEGACY"


def test_employee_profile_without_user_login_rejected(client, db_session):
    db_session.add(
        EmployeeProfile(
            id="emp-profile-only",
            user_id=None,
            full_name="Profile Only Employee",
            ethara_email="profile.only@ethara.ai",
            personal_email="profile.only@example.com",
            employee_code="EMP-PROFILE",
            phone="9876543221",
            department="Finance",
            designation="Associate",
            gender="male",
            aadhaar_last4="1234",
            aadhaar_ocr_status="needs_review",
        )
    )
    db_session.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": " profile.only@ethara.ai ", "password": "AnyPassword1"},
    )
    assert login.status_code == 401

    no_user = db_session.scalar(
        select(User).where(User.email == "profile.only@ethara.ai")
    )
    assert no_user is None, (
        "Pre-authentication login attempt must not create a User record; "
        "doing so would allow an unauthenticated caller to set the account password."
    )
