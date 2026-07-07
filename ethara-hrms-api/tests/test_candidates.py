import csv
import io
import shutil
from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from starlette.datastructures import Headers, UploadFile

from app.api.routes.candidates import (
    _parse_aadhaar_text_passes,
    _parse_address_text,
    _parse_cheque_text,
    _parse_pan_text_passes,
    extract_aadhaar_fields,
    extract_aadhaar_numbers_from_text,
    extract_address_fields,
    extract_cheque_fields,
    extract_pan_fields,
    extract_pan_numbers_from_text,
    validate_aadhaar_identity,
)
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import (
    Candidate,
    CandidateStage,
    College,
    ComplianceForm,
    Contract,
    ContractStatus,
    Document,
    DocumensoTemplateCache,
    Evaluation,
    ITRequest,
    Role,
    SelectionForm,
    SourceType,
    User,
    Vendor,
)
from app.services import candidates as candidate_service
from app.services import employees as employee_service
from app.services import ocr as ocr_service
from app.services import workflows as workflow_service


def _login(client, email: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _add_candidate_compliance_templates(db_session) -> None:
    db_session.add_all(
        [
            DocumensoTemplateCache(
                id="candidate-tpl-form-11",
                template_id=2101,
                title="Form 11",
                description=None,
                fields=[{"id": "field-name", "type": "TEXT", "fieldMeta": {"label": "Full Name"}}],
                recipients=[{"id": "recipient-1", "role": "SIGNER"}],
            ),
            DocumensoTemplateCache(
                id="candidate-tpl-form-2",
                template_id=2102,
                title="Form 2",
                description=None,
                fields=[],
                recipients=[{"id": "recipient-1", "role": "SIGNER"}],
            ),
            DocumensoTemplateCache(
                id="candidate-tpl-form-f",
                template_id=2103,
                title="Form F",
                description=None,
                fields=[],
                recipients=[{"id": "recipient-1", "role": "SIGNER"}],
            ),
        ]
    )
    db_session.commit()


def _mock_candidate_compliance_send(monkeypatch, created_payloads: list[dict]) -> None:
    def fake_create_document_from_template(**kwargs):
        created_payloads.append(kwargs)
        return {"documentId": kwargs["template_id"] + 7000, "token": f"candidate-token-{kwargs['template_id']}"}

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


def test_aadhaar_ocr_is_public_and_returns_manual_review_for_images(client):
    response = client.post(
        "/api/v1/candidates/aadhaar/ocr",
        files={"aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ocrStatus"] == "needs_review"
    assert "manual" in body["message"].lower() or "reviewed" in body["message"].lower()


def test_candidate_register_allows_manual_review_when_aadhaar_photo_is_unreadable(client, pdf_file):
    response = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "Manual Review Candidate",
            "gender": "female",
            "experienceType": "fresher",
            "personalEmail": "manual.review@gmail.com",
            "phone": "9876543200",
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

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "manual.review@gmail.com"
    assert body["candidateId"]
    assert "verify your email" in body["message"].lower()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "manual.review@gmail.com", "password": "candidate123"},
    )
    assert login.status_code == 403
    assert login.json()["detail"] == "EMAIL_NOT_VERIFIED"


def test_candidate_register_allows_manual_review_when_aadhaar_ocr_mismatches(
    client, db_session, pdf_file, monkeypatch
):
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_aadhaar_fields",
        lambda _file: {
            "aadhaarNumber": "999988887777",
            "dateOfBirth": "1999-12-31",
            "cardHolderName": "Wrong OCR Name",
            "ocrStatus": "extracted",
            "message": "Aadhaar number extracted successfully.",
        },
    )

    response = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "OCR Mismatch Candidate",
            "gender": "female",
            "experienceType": "fresher",
            "personalEmail": "ocr.mismatch.candidate@gmail.com",
            "phone": "9876543212",
            "password": "candidate123",
            "aadhaarNumber": "456745674567",
            "dateOfBirth": "2000-01-15",
            "collegeId": "",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )

    assert response.status_code == 200
    candidate = db_session.scalar(
        select(Candidate).where(Candidate.personal_email == "ocr.mismatch.candidate@gmail.com")
    )
    assert candidate is not None
    assert candidate.aadhaar_validation_status == "needs_review"
    assert "account creation allowed" in (candidate.aadhaar_mismatch_reason or "")


def test_candidate_register_records_resume_and_aadhaar_documents(client, db_session, pdf_file):
    response = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "Stored Aadhaar Candidate",
            "gender": "female",
            "experienceType": "fresher",
            "personalEmail": "stored.aadhaar@gmail.com",
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

    assert response.status_code == 200
    candidate_id = response.json()["candidateId"]
    documents = db_session.scalars(select(Document).where(Document.candidate_id == candidate_id)).all()
    docs_by_type = {document.type: document for document in documents}
    assert {"resume", "aadhaar_card"}.issubset(docs_by_type)
    assert docs_by_type["resume"].file_name == "resume.pdf"
    assert docs_by_type["resume"].file_url.startswith("/uploads/resumes/")
    assert docs_by_type["aadhaar_card"].file_name == "aadhaar-front.jpg"
    assert docs_by_type["aadhaar_card"].file_url.startswith("/uploads/aadhaar/")
    assert docs_by_type["aadhaar_card"].status == "uploaded"


def test_candidate_register_succeeds_when_verification_email_fails(
    client, db_session, pdf_file, monkeypatch
):
    def fail_send_email(*args, **kwargs):
        raise RuntimeError("SMTP unavailable")

    monkeypatch.setattr("app.services.account_security.EmailService.send_email", fail_send_email)

    response = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "Email Failure Candidate",
            "gender": "female",
            "experienceType": "fresher",
            "personalEmail": "email.failure@gmail.com",
            "phone": "9876543220",
            "password": "candidate123",
            "aadhaarNumber": "123412341239",
            "dateOfBirth": "2000-01-15",
            "collegeId": "",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )

    assert response.status_code == 200
    assert "resend otp" in response.json()["message"].lower()

    candidate = db_session.scalar(
        select(Candidate).where(Candidate.personal_email == "email.failure@gmail.com")
    )
    assert candidate is not None
    assert candidate.portal_user_id is not None


def test_candidate_register_succeeds_when_post_registration_screening_fails(
    client, db_session, pdf_file, monkeypatch
):
    def fail_screening(*args, **kwargs):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(
        "app.services.workflows.run_resume_screening",
        fail_screening,
    )

    response = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "Screening Failure Candidate",
            "gender": "female",
            "experienceType": "fresher",
            "personalEmail": "screening.failure@gmail.com",
            "phone": "9876543221",
            "password": "candidate123",
            "aadhaarNumber": "123412341238",
            "dateOfBirth": "2000-01-15",
            "collegeId": "",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )

    assert response.status_code == 200
    assert "verify your email" in response.json()["message"].lower()

    candidate = db_session.scalar(
        select(Candidate).where(Candidate.personal_email == "screening.failure@gmail.com")
    )
    assert candidate is not None
    assert candidate.portal_user_id is not None


def test_candidate_register_backfills_date_of_birth_from_aadhaar_ocr(client, db_session, pdf_file, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_aadhaar_fields",
        lambda _file: {
            "aadhaarNumber": "123412341234",
            "dateOfBirth": "2000-02-01",
            "cardHolderName": "OCR Candidate",
            "ocrStatus": "extracted",
        },
    )

    response = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "OCR Candidate",
            "gender": "female",
            "experienceType": "fresher",
            "personalEmail": "ocr.backfill@gmail.com",
            "phone": "9876543205",
            "password": "candidate123",
            "aadhaarNumber": "123412341234",
            "collegeId": "",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )

    assert response.status_code == 200

    candidate = db_session.scalar(
        select(Candidate).where(Candidate.personal_email == "ocr.backfill@gmail.com")
    )
    assert candidate is not None
    assert candidate.date_of_birth is not None
    assert candidate.date_of_birth.date().isoformat() == "2000-02-01"


def test_candidate_register_persists_experience_years_for_experienced_candidate(client, db_session, pdf_file):
    response = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "Experienced Candidate",
            "gender": "female",
            "experienceType": "experienced",
            "experienceYears": "4",
            "personalEmail": "experienced.candidate@gmail.com",
            "phone": "9876543206",
            "password": "candidate123",
            "aadhaarNumber": "123412341235",
            "dateOfBirth": "2000-01-15",
            "collegeId": "",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )

    assert response.status_code == 200

    candidate = db_session.scalar(
        select(Candidate).where(Candidate.personal_email == "experienced.candidate@gmail.com")
    )
    assert candidate is not None
    assert candidate.experience_type == "experienced"
    assert candidate.experience_years == 4


def test_candidate_register_requires_experience_years_for_experienced_candidate(client, pdf_file):
    response = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "Missing Experience Candidate",
            "gender": "female",
            "experienceType": "experienced",
            "personalEmail": "missing.experience@gmail.com",
            "phone": "9876543207",
            "password": "candidate123",
            "aadhaarNumber": "123412341236",
            "dateOfBirth": "2000-01-15",
            "collegeId": "",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )

    assert response.status_code == 422
    assert "experience years" in response.json()["detail"].lower()


def test_candidate_register_rejects_duplicate_public_registration(client, pdf_file):
    payload = {
        "fullName": "First Candidate",
        "gender": "female",
        "experienceType": "fresher",
        "personalEmail": "duplicate.public@gmail.com",
        "phone": "9876543201",
        "password": "candidate123",
        "aadhaarNumber": "999988887777",
        "dateOfBirth": "2000-01-15",
        "collegeId": "",
    }
    files = {
        "resume": pdf_file,
        "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
    }

    first = client.post("/api/v1/candidates/register", data=payload, files=files)
    assert first.status_code == 200

    second = client.post("/api/v1/candidates/register", data=payload, files=files)
    assert second.status_code == 409
    assert "already exists" in second.json()["detail"].lower()


def test_aadhaar_ocr_extracts_from_pdf_and_image_when_tesseract_available():
    pymupdf = pytest.importorskip("pymupdf")
    if not shutil.which("tesseract"):
        pytest.skip("tesseract is not installed")

    text = "Government of India\nDOB: 01/02/2000\n1234 5678 9012\n"

    pdf = pymupdf.open()
    page = pdf.new_page(width=595, height=842)
    page.insert_text((72, 120), text, fontsize=20)
    pdf_bytes = pdf.tobytes()
    pdf.close()

    pdf_upload = UploadFile(
        filename="aadhaar.pdf",
        file=BytesIO(pdf_bytes),
        headers=Headers({"content-type": "application/pdf"}),
    )
    pdf_result = extract_aadhaar_fields(pdf_upload)
    assert pdf_result["aadhaarNumber"] == "123456789012"
    assert pdf_result["dateOfBirth"] == "2000-02-01"

    pdf_doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    pix = pdf_doc[0].get_pixmap(dpi=220, alpha=False)
    png_bytes = pix.tobytes("png")
    pdf_doc.close()

    image_upload = UploadFile(
        filename="aadhaar-front.png",
        file=BytesIO(png_bytes),
        headers=Headers({"content-type": "image/png"}),
    )
    image_result = extract_aadhaar_fields(image_upload)
    assert image_result["aadhaarNumber"] == "123456789012"
    assert image_result["dateOfBirth"] == "2000-02-01"


def test_aadhaar_text_parser_keeps_full_12_digit_numbers():
    numbers = extract_aadhaar_numbers_from_text("Government of India\nUIDAI\n1234 5678 9012\n")

    assert numbers == {"123456789012"}


def test_aadhaar_text_parser_extracts_card_holder_name_from_single_line():
    numbers, date_of_birth, card_holder_name = _parse_aadhaar_text_passes([
        "Government of India\nAadhaar\nArjun Sharma\nDOB: 15/08/1995\n1234 5678 9012"
    ])

    assert numbers == ["123456789012"]
    assert date_of_birth == "1995-08-15"
    assert card_holder_name == "Arjun Sharma"


def test_aadhaar_text_parser_normalizes_noisy_dob_ocr():
    numbers, date_of_birth, card_holder_name = _parse_aadhaar_text_passes([
        "Government of India\nAadhaar\nRidhima Namdev\nD0B 15 1O 2OO2\n6888 3517 4993"
    ])

    assert numbers == ["688835174993"]
    assert date_of_birth == "2002-10-15"
    assert card_holder_name == "Ridhima Namdev"


def test_aadhaar_service_ocr_normalizes_noisy_dob():
    date_of_birth = ocr_service._extract_dob(  # noqa: SLF001
        ["Government of India", "Ridhima Namdev", "D0B 15 1O 2OO2", "6888 3517 4993"],
        "Government of India\nRidhima Namdev\nD0B 15 1O 2OO2\n6888 3517 4993",
    )

    assert date_of_birth == "2002-10-15"


def test_aadhaar_text_parser_prioritizes_aadhaar_context_over_reference_numbers():
    numbers, date_of_birth, card_holder_name = _parse_aadhaar_text_passes(
        [
            "Reference No: 1111 1111 1111\n"
            "Government of India\n"
            "Aadhaar\n"
            "Arjun Sharma\n"
            "DOB: 15/08/1995\n"
            "6888 3517 4993\n"
        ]
    )

    assert numbers[0] == "688835174993"
    assert "111111111111" in numbers
    assert date_of_birth == "1995-08-15"
    assert card_holder_name == "Arjun Sharma"


def test_aadhaar_validation_accepts_entered_number_from_ocr_candidates():
    result = validate_aadhaar_identity(
        entered_name="Arjun Sharma",
        entered_aadhaar="688835174993",
        entered_dob="1995-08-15",
        ocr_result={
            "aadhaarNumber": "111111111111",
            "aadhaarNumberCandidates": ["111111111111", "688835174993"],
            "dateOfBirth": "1995-08-15",
            "cardHolderName": "Arjun Sharma",
            "ocrStatus": "extracted",
        },
    )

    assert result["validationStatus"] == "passed"


def test_pan_text_parser_extracts_strict_alphanumeric_format():
    numbers = extract_pan_numbers_from_text(
        "INCOME TAX DEPARTMENT\nPermanent Account Number\nabcde 1234 f\n"
    )

    assert numbers == {"ABCDE1234F"}


def test_pan_text_parser_tolerates_common_ocr_digit_substitutions():
    numbers = extract_pan_numbers_from_text(
        "Permanent Account Number\nABCDE I23S F\n"
    )

    assert numbers == {"ABCDE1235F"}


def test_pan_text_parser_prioritizes_real_pan_over_birth_date_noise():
    numbers = _parse_pan_text_passes(
        [
            "GOVT. OF INDIA\n"
            "INCOME TAX DEPARTMENT\n"
            "PERMANENT ACCOUNT NUMBER CARD\n"
            "ABCDE1234F\n"
            "DATE OF BIRTH\n"
            "02/03/2002\n"
        ]
    )

    assert numbers[0] == "ABCDE1234F"
    assert "BIRTH0203Z" not in numbers


def test_pan_text_parser_does_not_infer_pan_from_bank_text_without_context():
    numbers = extract_pan_numbers_from_text(
        "AXIS BANK LTD\nA/C.NO. 924010061461255\nSALBR 000160\nIFSCODE UTIB0001527\n"
    )

    assert numbers == set()


def test_pan_ocr_extracts_from_plain_text_upload():
    upload = UploadFile(
        file=BytesIO(b"Permanent Account Number\nABCDE-1234-F\n"),
        filename="pan.txt",
        headers=Headers({"content-type": "text/plain"}),
    )

    result = extract_pan_fields(upload)

    assert result["panNumber"] == "ABCDE1234F"
    assert result["ocrStatus"] == "extracted"


def test_pan_ocr_uses_rapidocr_first_for_image_upload(monkeypatch):
    calls: list[bool] = []

    def fake_rapidocr(content: bytes, *, image_upload: bool, max_pages: int = 2) -> list[str]:
        calls.append(image_upload)
        return ["INCOME TAX DEPARTMENT\nPermanent Account Number\nABCDE1234F\n"]

    monkeypatch.setattr("app.api.routes.candidates._extract_text_with_rapidocr", fake_rapidocr)

    upload = UploadFile(
        file=BytesIO(b"fake-image"),
        filename="pan.jpeg",
        headers=Headers({"content-type": "image/jpeg"}),
    )

    result = extract_pan_fields(upload)

    assert result["panNumber"] == "ABCDE1234F"
    assert result["ocrStatus"] == "extracted"
    assert calls == [True]


def test_pan_ocr_tries_enhanced_image_payloads(monkeypatch):
    payloads = [b"raw-image", b"enhanced-image"]
    calls: list[bytes] = []

    monkeypatch.setattr("app.api.routes.candidates._pan_image_ocr_payloads", lambda _content: payloads)

    def fake_rapidocr(content: bytes, *, image_upload: bool, max_pages: int = 2) -> list[str]:
        assert image_upload is True
        calls.append(content)
        if content == b"enhanced-image":
            return ["INCOME TAX DEPARTMENT\nPermanent Account Number\nABCDE1234F\n"]
        return []

    monkeypatch.setattr("app.api.routes.candidates._extract_text_with_rapidocr", fake_rapidocr)

    upload = UploadFile(
        file=BytesIO(b"fake-image"),
        filename="pan.jpeg",
        headers=Headers({"content-type": "image/jpeg"}),
    )

    result = extract_pan_fields(upload)

    assert result["panNumber"] == "ABCDE1234F"
    assert calls == payloads


def test_aadhaar_text_parser_ignores_vid_numbers():
    numbers = extract_aadhaar_numbers_from_text(
        "Government of India\n6888 3517 4993\nVID: 9116 1782 0912 5054\n"
    )

    assert numbers == {"688835174993"}


def test_cancelled_cheque_parser_extracts_account_holder_after_full_label():
    parsed = _parse_cheque_text(
        "HDFC Bank\n"
        "CANCELLED CHEQUE\n"
        "Account Holder Name: Arjun Sharma\n"
        "A/C No. 123456789012\n"
        "IFSC Code: HDFC0001234\n"
    )

    assert parsed == {
        "accountNumber": "123456789012",
        "ifscCode": "HDFC0001234",
        "accountHolderName": "Arjun Sharma",
        "bankName": "HDFC Bank",
    }


def test_cancelled_cheque_ocr_uses_rapidocr_first_for_image_upload(monkeypatch):
    calls: list[bool] = []

    def fake_rapidocr(content: bytes, *, image_upload: bool, max_pages: int = 2) -> list[str]:
        calls.append(image_upload)
        return ["HDFC Bank\nA/C No. 123456789012\nIFSC Code: HDFC0001234\n"]

    monkeypatch.setattr("app.api.routes.candidates._extract_text_with_rapidocr", fake_rapidocr)

    upload = UploadFile(
        file=BytesIO(b"fake-image"),
        filename="cheque.jpeg",
        headers=Headers({"content-type": "image/jpeg"}),
    )

    result = extract_cheque_fields(upload)

    assert result["accountNumber"] == "123456789012"
    assert result["ifscCode"] == "HDFC0001234"
    assert result["ocrStatus"] == "extracted"
    assert calls == [True]


def test_address_parser_extracts_lines_after_address_label():
    parsed = _parse_address_text(
        "Unique Identification Authority of India\n"
        "Address:\n"
        "S/O Test Parent, House 12\n"
        "MG Road, Bengaluru\n"
        "Karnataka 560001\n"
        "VID: 1234 5678 9012 3456\n"
    )

    assert parsed["address"] == "S/O Test Parent, House 12, MG Road, Bengaluru, Karnataka 560001"
    assert parsed["postalCode"] == "560001"


def test_address_ocr_extracts_from_plain_text_upload():
    upload = UploadFile(
        file=BytesIO(
            b"Address:\n"
            b"S/O Test Parent, House 12\n"
            b"MG Road, Bengaluru\n"
            b"Karnataka 560001\n"
        ),
        filename="address.txt",
        headers=Headers({"content-type": "text/plain"}),
    )

    result = extract_address_fields(upload)

    assert result["address"] == "S/O Test Parent, House 12, MG Road, Bengaluru, Karnataka 560001"
    assert result["postalCode"] == "560001"
    assert result["ocrStatus"] == "extracted"


def test_aadhaar_ocr_does_not_use_gemini_fallback_for_scanned_pdf(monkeypatch):
    pymupdf = pytest.importorskip("pymupdf")

    pdf = pymupdf.open()
    pdf.new_page(width=595, height=842)
    pdf_bytes = pdf.tobytes()
    pdf.close()

    called = False

    class FakeLLMService:
        def extract_aadhaar_via_vision(self, image_bytes: bytes, mime_type: str) -> dict:
            nonlocal called
            called = True
            raise AssertionError("Gemini OCR fallback must not be used")

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_OCR_FALLBACK", "true")
    monkeypatch.setattr("app.services.ocr.is_available", lambda: False)
    monkeypatch.setattr("app.api.routes.candidates.extract_pdf_text", lambda content: "")
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_text_with_pymupdf_ocr",
        lambda *args, **kwargs: "",
    )
    monkeypatch.setattr("app.services.integrations.LLMService", FakeLLMService)

    pdf_upload = UploadFile(
        filename="aadhaar-scan.pdf",
        file=BytesIO(pdf_bytes),
        headers=Headers({"content-type": "application/pdf"}),
    )

    result = extract_aadhaar_fields(pdf_upload)

    assert called is False
    assert result["aadhaarNumber"] is None
    assert result["ocrStatus"] == "needs_review"
    assert "gemini" not in (result.get("message") or "").lower()


def test_aadhaar_number_parser_accepts_twelve_digit_values_starting_with_one():
    numbers = extract_aadhaar_numbers_from_text("Aadhaar: 1234 5678 9012")

    assert "123456789012" in numbers


def test_aadhaar_ocr_uses_rapidocr_fallback_when_tesseract_is_unavailable(monkeypatch):
    monkeypatch.setattr("app.services.ocr.is_available", lambda: False)
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_text_with_pymupdf_ocr",
        lambda *args, **kwargs: "",
    )
    monkeypatch.setattr(
        "app.api.routes.candidates._extract_text_with_rapidocr",
        lambda *args, **kwargs: [
            "Government of India\nRidhima Namdev\nDOB: 15/10/2002\n6888 3517 4993"
        ],
    )

    image_upload = UploadFile(
        filename="aadhaar-front.jpg",
        file=BytesIO(b"fake-image"),
        headers=Headers({"content-type": "image/jpeg"}),
    )

    result = extract_aadhaar_fields(image_upload)

    assert result["aadhaarNumber"] == "688835174993"
    assert result["dateOfBirth"] == "2002-10-15"
    assert result["ocrStatus"] == "extracted"


def test_aadhaar_ocr_tries_enhanced_image_payloads(monkeypatch):
    payloads = [b"raw-image", b"enhanced-image"]
    calls: list[bytes] = []

    monkeypatch.setattr(
        "app.api.routes.candidates._aadhaar_image_ocr_payloads", lambda _content: payloads
    )

    def fake_rapidocr(content: bytes, *, image_upload: bool, max_pages: int = 2) -> list[str]:
        assert image_upload is True
        calls.append(content)
        if content == b"enhanced-image":
            return ["Government of India\nArjun Sharma\nDOB: 15/08/1995\n6888 3517 4993"]
        return []

    monkeypatch.setattr("app.api.routes.candidates._extract_text_with_rapidocr", fake_rapidocr)

    image_upload = UploadFile(
        filename="aadhaar-front.jpg",
        file=BytesIO(b"fake-image"),
        headers=Headers({"content-type": "image/jpeg"}),
    )

    result = extract_aadhaar_fields(image_upload)

    assert result["aadhaarNumber"] == "688835174993"
    assert result["dateOfBirth"] == "1995-08-15"
    assert result["ocrStatus"] == "extracted"
    assert calls == payloads


def test_aadhaar_ocr_uses_apple_vision_fallback_when_other_local_ocr_is_empty(monkeypatch):
    monkeypatch.setattr("app.services.ocr.is_available", lambda: False)
    monkeypatch.setattr(
        "app.api.routes.candidates.extract_text_with_pymupdf_ocr",
        lambda *args, **kwargs: "",
    )
    monkeypatch.setattr(
        "app.api.routes.candidates._extract_text_with_rapidocr",
        lambda *args, **kwargs: [],
    )
    monkeypatch.setattr(
        "app.api.routes.candidates._extract_text_with_apple_vision",
        lambda *args, **kwargs: [
            "Government of India\nRidhima Namdev\nDOB: 15/10/2002\n6888 3517 4993"
        ],
    )

    image_upload = UploadFile(
        filename="aadhaar-front.jpg",
        file=BytesIO(b"fake-image"),
        headers=Headers({"content-type": "image/jpeg"}),
    )

    result = extract_aadhaar_fields(image_upload)

    assert result["aadhaarNumber"] == "688835174993"
    assert result["dateOfBirth"] == "2002-10-15"
    assert result["ocrStatus"] == "extracted"


def test_candidate_duplicate_detection(client, auth_headers):
    payload = {
        "fullName": "Priya Nair",
        "personalEmail": "priya.nair@gmail.com",
        "phone": "9876543210",
        "sourceType": "direct_application",
        "positionId": "pos-fe",
    }
    first = client.post("/api/v1/candidates", json=payload, headers=auth_headers)
    assert first.status_code == 200
    assert first.json()["isDuplicate"] is False

    second = client.post("/api/v1/candidates", json=payload, headers=auth_headers)
    assert second.status_code == 200
    assert second.json()["isDuplicate"] is True
    assert "Duplicate of" in second.json()["duplicateReason"]


def test_blacklisted_candidates_are_isolated_and_can_be_restored(client, auth_headers):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Blacklist Flow Candidate",
            "personalEmail": "blacklist.flow.candidate.20260622@gmail.com",
            "phone": "9876504321",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]

    moved_to_contracts = client.patch(
        f"/api/v1/candidates/{candidate_id}",
        json={"currentStage": "contract_sent"},
        headers=auth_headers,
    )
    assert moved_to_contracts.status_code == 200
    assert moved_to_contracts.json()["currentStage"] == "contract_sent"

    blacklisted = client.patch(
        f"/api/v1/candidates/{candidate_id}",
        json={"currentStatus": "Blacklisted", "isReapplicationBlocked": True},
        headers=auth_headers,
    )
    assert blacklisted.status_code == 200
    assert blacklisted.json()["currentStatus"] == "Blacklisted"
    assert blacklisted.json()["isReapplicationBlocked"] is True

    active_list = client.get("/api/v1/candidates?limit=100", headers=auth_headers)
    assert active_list.status_code == 200
    assert candidate_id not in {row["id"] for row in active_list.json()["data"]}

    contract_list = client.get("/api/v1/candidates?stage=contract_sent&limit=100", headers=auth_headers)
    assert contract_list.status_code == 200
    assert candidate_id not in {row["id"] for row in contract_list.json()["data"]}

    blacklist_list = client.get("/api/v1/candidates?blacklisted=true&limit=100", headers=auth_headers)
    assert blacklist_list.status_code == 200
    assert candidate_id in {row["id"] for row in blacklist_list.json()["data"]}

    blocked_advance = client.post(
        f"/api/v1/candidates/{candidate_id}/advance-stage",
        json={"toStage": "contract_signed", "notes": "Should be blocked"},
        headers=auth_headers,
    )
    assert blocked_advance.status_code == 400
    assert blocked_advance.json()["detail"] == (
        "Blacklisted candidates cannot be advanced. Remove them from the blacklist first."
    )

    restored = client.patch(
        f"/api/v1/candidates/{candidate_id}",
        json={"isReapplicationBlocked": False},
        headers=auth_headers,
    )
    assert restored.status_code == 200
    assert restored.json()["isReapplicationBlocked"] is False
    assert restored.json()["currentStatus"] != "Blacklisted"

    active_after_restore = client.get(
        "/api/v1/candidates?stage=contract_sent&limit=100",
        headers=auth_headers,
    )
    assert active_after_restore.status_code == 200
    assert candidate_id in {row["id"] for row in active_after_restore.json()["data"]}

    blacklist_after_restore = client.get(
        "/api/v1/candidates?blacklisted=true&limit=100",
        headers=auth_headers,
    )
    assert blacklist_after_restore.status_code == 200
    assert candidate_id not in {row["id"] for row in blacklist_after_restore.json()["data"]}


def test_vendor_only_sees_their_tagged_candidates(client, db_session):
    db_session.add(
        Vendor(
            id="ven-other",
            name="Other Vendor",
            contact_email="other.vendor@example.com",
            contact_phone="9000000001",
            is_active=True,
        )
    )
    db_session.add_all(
        [
            Candidate(
                id="cand-vendor-own",
                candidate_code="ETH-VENDOR-001",
                full_name="Vendor Owned Candidate",
                personal_email="vendor.owned@example.com",
                phone="9999999990",
                source_type=SourceType.VENDOR,
                vendor_id="ven-demo",
                current_status="New Application",
            ),
            Candidate(
                id="cand-vendor-other",
                candidate_code="ETH-VENDOR-002",
                full_name="Other Vendor Candidate",
                personal_email="other.vendor.candidate@example.com",
                phone="9999999991",
                source_type=SourceType.VENDOR,
                vendor_id="ven-other",
                current_status="New Application",
            ),
            Candidate(
                id="cand-direct-hidden",
                candidate_code="ETH-DIRECT-001",
                full_name="Direct Candidate",
                personal_email="direct.hidden@example.com",
                phone="9999999992",
                source_type=SourceType.DIRECT_APPLICATION,
                current_status="New Application",
            ),
        ]
    )
    db_session.commit()

    headers = _login(client, "vendor@ethara.ai", "vendor123")

    response = client.get("/api/v1/candidates", headers=headers)

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["data"]] == ["cand-vendor-own"]

    stats_response = client.get("/api/v1/candidates/stats", headers=headers)
    assert stats_response.status_code == 200
    assert stats_response.json()["total"] == 1


def test_vendor_can_only_open_their_own_candidates(client, db_session):
    db_session.add(
        Candidate(
            id="cand-vendor-visible",
            candidate_code="ETH-VENDOR-003",
            full_name="Visible Vendor Candidate",
            personal_email="visible.vendor@example.com",
            phone="9999999993",
            source_type=SourceType.VENDOR,
            vendor_id="ven-demo",
            current_status="Selection Form Sent",
        )
    )
    db_session.add(
        Candidate(
            id="cand-direct-private",
            candidate_code="ETH-DIRECT-002",
            full_name="Private Direct Candidate",
            personal_email="private.direct@example.com",
            phone="9999999994",
            source_type=SourceType.DIRECT_APPLICATION,
            current_status="Resume Shortlisted",
        )
    )
    db_session.commit()

    headers = _login(client, "vendor@ethara.ai", "vendor123")

    own_candidate = client.get("/api/v1/candidates/cand-vendor-visible", headers=headers)
    hidden_candidate = client.get("/api/v1/candidates/cand-direct-private", headers=headers)
    hidden_documents = client.get(
        "/api/v1/documents",
        params={"candidateId": "cand-direct-private"},
        headers=headers,
    )

    assert own_candidate.status_code == 200
    assert own_candidate.json()["currentStage"] == "new_application"
    assert hidden_candidate.status_code == 403
    assert hidden_candidate.json()["detail"] == "Access denied"
    assert hidden_documents.status_code == 403
    assert hidden_documents.json()["detail"] == "Access denied"


def test_internal_non_recruiting_role_gets_candidate_preview_only(client, db_session):
    db_session.add(
        Candidate(
            id="cand-preview-only",
            candidate_code="ETH-PREVIEW-001",
            full_name="Preview Only Candidate",
            personal_email="preview.only@example.com",
            ethara_email="preview.only@ethara.ai",
            phone="9999999995",
            source_type=SourceType.DIRECT_APPLICATION,
            current_status="Resume Shortlisted",
            resume_score=92,
            resume_summary="Strong internal screening summary.",
            aadhaar_last4="0123",
            current_ctc=12.5,
            expected_ctc=16.0,
            position_id="pos-fe",
        )
    )
    db_session.add(
        Document(
            id="doc-preview-only",
            candidate_id="cand-preview-only",
            type="aadhaar_card",
            file_name="aadhaar.pdf",
            file_url="/uploads/aadhaar.pdf",
            file_size=123,
            mime_type="application/pdf",
            status="pending",
            ocr_status="extracted",
            extracted_data={"aadhaarNumber": "123456789012"},
        )
    )
    db_session.commit()

    headers = _login(client, "it@ethara.ai", "it123")

    list_response = client.get("/api/v1/candidates", headers=headers)
    detail_response = client.get("/api/v1/candidates/cand-preview-only", headers=headers)
    documents_response = client.get(
        "/api/v1/documents",
        params={"candidateId": "cand-preview-only"},
        headers=headers,
    )

    assert list_response.status_code == 200
    row = next(item for item in list_response.json()["data"] if item["id"] == "cand-preview-only")
    assert row["accessLevel"] == "preview"
    assert row["canOpenDetail"] is False
    assert row["candidateCode"] == "ETH-PREVIEW-001"
    assert row["personalEmail"] == "preview.only@example.com"
    assert row["phone"] == "9999999995"
    assert "resumeScore" not in row
    assert "resumeSummary" not in row
    assert "aadhaarLast4" not in row
    assert "currentCTC" not in row
    assert "expectedCTC" not in row
    assert detail_response.status_code == 403
    assert detail_response.json()["detail"] == "Only Admin, HR, and TA users can open full candidate details."
    assert documents_response.status_code == 403


def test_global_search_is_scoped_to_openable_candidates(client, db_session):
    db_session.add(
        Candidate(
            id="cand-search-vendor",
            candidate_code="ETH-SEARCH-VEN",
            full_name="Searchable Vendor Person",
            personal_email="searchable.vendor@example.com",
            phone="9999990001",
            source_type=SourceType.VENDOR,
            vendor_id="ven-demo",
            current_status="Selection Form Sent",
        )
    )
    db_session.add(
        Candidate(
            id="cand-search-direct",
            candidate_code="ETH-SEARCH-DIR",
            full_name="Searchable Direct Person",
            personal_email="searchable.direct@example.com",
            phone="9999990002",
            source_type=SourceType.DIRECT_APPLICATION,
            current_status="Resume Shortlisted",
        )
    )
    db_session.commit()

    def search(headers):
        response = client.get("/api/v1/search", params={"q": "searchable"}, headers=headers)
        assert response.status_code == 200
        return response.json()["candidates"]

    # HR can open everyone → both hits, all flagged openable.
    hr_candidates = search(_login(client, "hr@ethara.ai", "hr123"))
    hr_ids = {c["id"] for c in hr_candidates}
    assert {"cand-search-vendor", "cand-search-direct"} <= hr_ids
    assert all(c["canOpenDetail"] for c in hr_candidates)

    # Vendor is narrowed to their own candidate (never the direct one).
    vendor_candidates = search(_login(client, "vendor@ethara.ai", "vendor123"))
    vendor_ids = {c["id"] for c in vendor_candidates}
    assert vendor_ids == {"cand-search-vendor"}
    assert all(c["canOpenDetail"] for c in vendor_candidates)

    # IT holds candidates:read but cannot open any candidate → zero candidate hits
    # (no roster leak), never canOpenDetail True.
    it_candidates = search(_login(client, "it@ethara.ai", "it123"))
    assert it_candidates == []


def test_vendor_created_candidates_are_auto_tagged(client):
    headers = _login(client, "vendor@ethara.ai", "vendor123")

    response = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Vendor Uploaded Candidate",
            "personalEmail": "vendor.uploaded@example.com",
            "phone": "9876500010",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["sourceType"] == "vendor"
    assert body["vendorId"] == "ven-demo"


def test_vendor_submission_emails_candidate_portal_credentials(client, db_session, monkeypatch):
    headers = _login(client, "vendor@ethara.ai", "vendor123")
    sent_email: dict[str, str] = {}

    def _capture_email(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str | None = None,
    ) -> None:
        sent_email["to_email"] = to_email
        sent_email["subject"] = subject
        sent_email["body_text"] = body_text
        sent_email["body_html"] = body_html or ""

    monkeypatch.setattr(candidate_service.EmailService, "send_email", _capture_email)

    response = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Vendor Portal Candidate",
            "personalEmail": "vendor.portal@example.com",
            "phone": "9876500022",
            "sourceType": "vendor",
            "positionId": "pos-fe",
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert sent_email["to_email"] == "vendor.portal@example.com"
    assert sent_email["subject"] == "Your Ethara candidate portal credentials are ready"
    assert "demo credentials" in sent_email["body_text"]
    assert "Login email: vendor.portal@example.com" in sent_email["body_text"]
    assert "Demo password:" in sent_email["body_text"]
    assert "change this password after you log in to the portal" in sent_email["body_text"]

    created_user = db_session.scalar(
        select(User).where(User.email == "vendor.portal@example.com")
    )
    assert created_user is not None
    assert created_user.role == Role.CANDIDATE
    assert created_user.must_change_password is True
    assert created_user.email_verified_at is not None


def test_vendor_bulk_upload_creates_candidates_from_csv(client, db_session, monkeypatch):
    db_session.add(
        College(
            id="col-iitd",
            name="IIT Delhi",
            short_name="IITD",
            is_active=True,
        )
    )
    db_session.commit()

    headers = _login(client, "vendor@ethara.ai", "vendor123")
    sent_emails: list[str] = []

    def _capture_email(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str | None = None,
    ) -> None:
        sent_emails.append(to_email)

    monkeypatch.setattr(candidate_service.EmailService, "send_email", _capture_email)

    csv_content = "\n".join(
        [
            "name,email,number,aadhar card,college (Optional),resume (URL)",
            "Aarav Sharma,aarav.sharma@example.com,9876543210,234567890123,IIT Delhi,https://example.com/resumes/aarav.pdf",
            "Meera Iyer,meera.iyer@example.com,9876543211,23456789012,,https://example.com/resumes/meera.pdf",
        ]
    )

    response = client.post(
        "/api/v1/vendors/bulk-upload",
        data={"positionId": "pos-fe"},
        files={"file": ("vendor-candidates.csv", BytesIO(csv_content.encode("utf-8")), "text/csv")},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["saved"] == 1
    assert body["failed"] == 1
    assert any("Aadhaar number must be 12 digits" in error for error in body["errors"])

    saved_candidate = db_session.query(Candidate).filter_by(personal_email="aarav.sharma@example.com").one()
    assert saved_candidate.source_type == SourceType.VENDOR
    assert saved_candidate.vendor_id == "ven-demo"
    assert saved_candidate.position_id == "pos-fe"
    assert saved_candidate.college_id == "col-iitd"
    assert saved_candidate.resume_url == "https://example.com/resumes/aarav.pdf"
    assert saved_candidate.aadhaar_last4 == "0123"
    assert sent_emails == ["aarav.sharma@example.com"]

    created_user = db_session.scalar(
        select(User).where(User.email == "aarav.sharma@example.com")
    )
    assert created_user is not None
    assert created_user.must_change_password is True
    assert created_user.email_verified_at is not None


def test_vendor_candidates_must_be_tagged_to_a_vendor(client, auth_headers):
    response = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Unassigned Vendor Candidate",
            "personalEmail": "unassigned.vendor@example.com",
            "phone": "9876500011",
            "sourceType": "vendor",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Vendor candidates must be tagged to a vendor."


def test_evaluation_assignment_defaults_to_seeded_evaluator(client, auth_headers, db_session):
    candidate = Candidate(
        id="cand-default-evaluator",
        candidate_code="ETH-EVAL-001",
        full_name="Default Evaluator Candidate",
        personal_email="default.evaluator@example.com",
        phone="9000000010",
        source_type=SourceType.DIRECT_APPLICATION,
        current_status="Resume Shortlisted",
    )
    db_session.add(candidate)
    db_session.commit()

    first = client.post(
        "/api/v1/evaluations",
        json={"candidateId": candidate.id},
        headers=auth_headers,
    )
    second = client.post(
        "/api/v1/evaluations",
        json={"candidateId": candidate.id},
        headers=auth_headers,
    )

    assert first.status_code == 200
    assert first.json()["evaluatorId"] == "usr-evaluator"
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]


def test_evaluations_list_includes_candidate_details_for_assigned_module(client, db_session):
    candidate = Candidate(
        id="cand-eval-list-details",
        candidate_code="ETH-EVAL-DETAIL-001",
        full_name="Assigned Candidate Detail",
        personal_email="assigned.detail@example.com",
        phone="9000000099",
        source_type=SourceType.DIRECT_APPLICATION,
        position_id="pos-fe",
        current_stage=CandidateStage.EVALUATION_ASSIGNED,
        current_status="Evaluation Assigned",
    )
    evaluation = Evaluation(
        id="eval-list-details-001",
        candidate_id=candidate.id,
        evaluator_id="usr-evaluator",
        interview_status="scheduled",
    )
    db_session.add_all([candidate, evaluation])
    db_session.commit()

    headers = _login(client, "evaluator@ethara.ai", "evaluator123")
    response = client.get("/api/v1/evaluations", headers=headers)

    assert response.status_code == 200
    row = next(item for item in response.json() if item["id"] == evaluation.id)
    assert row["candidate"] is not None
    assert row["candidate"]["fullName"] == "Assigned Candidate Detail"
    assert row["candidate"]["candidateCode"] == "ETH-EVAL-DETAIL-001"
    assert row["candidate"]["personalEmail"] == "assigned.detail@example.com"
    assert row["candidate"]["position"]["title"] == "Senior Frontend Developer"


def test_candidate_id_card_form_is_staff_only_and_shared_with_it_hr_admin(client, auth_headers, db_session):
    candidate = Candidate(
        id="cand-id-card-visible",
        candidate_code="ETH-IDCARD-001",
        full_name="ID Card Candidate",
        personal_email="id.card@example.com",
        ethara_email="id.card@ethara.ai",
        phone="9000000011",
        source_type=SourceType.DIRECT_APPLICATION,
        current_status="IT Email Created",
    )
    db_session.add(candidate)
    db_session.commit()

    initial = client.get(f"/api/v1/id-card-forms/{candidate.id}", headers=auth_headers)
    saved = client.post(
        f"/api/v1/id-card-forms/{candidate.id}",
        json={
            "name": "ID Card Candidate",
            "employeeId": "EMP-ID-001",
            "bloodGroup": "O+",
            "emergencyNo": "9988776655",
        },
        headers=auth_headers,
    )
    it_headers = _login(client, "it@ethara.ai", "it123")
    it_view = client.get(f"/api/v1/id-card-forms/{candidate.id}", headers=it_headers)
    evaluator_headers = _login(client, "evaluator@ethara.ai", "evaluator123")
    evaluator_view = client.get(f"/api/v1/id-card-forms/{candidate.id}", headers=evaluator_headers)

    assert initial.status_code == 200
    assert initial.json()["name"] == "ID Card Candidate"
    assert saved.status_code == 200
    assert saved.json()["employeeId"] == "GRP1001"
    assert it_view.status_code == 200
    assert it_view.json()["bloodGroup"] == "O+"
    assert evaluator_view.status_code == 403
    assert "Only Admin, HR, IT, and Office Admin users can view candidate ID card forms." in evaluator_view.json()["detail"]


def test_candidate_id_card_form_requires_ethara_email(client, auth_headers, db_session):
    candidate = Candidate(
        id="cand-id-card-blocked",
        candidate_code="ETH-IDCARD-002",
        full_name="Blocked ID Card Candidate",
        personal_email="blocked.id.card@example.com",
        phone="9000000012",
        source_type=SourceType.DIRECT_APPLICATION,
        current_status="Contract Signed",
    )
    db_session.add(candidate)
    db_session.commit()

    response = client.post(
        f"/api/v1/id-card-forms/{candidate.id}",
        json={
            "name": "Blocked ID Card Candidate",
            "employeeId": "EMP-ID-002",
            "bloodGroup": "A+",
            "emergencyNo": "9988776656",
        },
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Create the Ethara email ID before submitting the ID card form."


def test_staff_can_see_search_and_edit_candidate_employee_code(client, auth_headers, db_session):
    candidate = Candidate(
        id="cand-employee-code-edit",
        candidate_code="ETH-EMP-CODE-EDIT",
        employee_code="GRP1888",
        full_name="Employee Code Candidate",
        personal_email="employee.code.candidate@example.com",
        phone="9000000018",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    db_session.add(candidate)
    db_session.commit()

    list_response = client.get(
        "/api/v1/candidates",
        params={"search": "grp1888"},
        headers=auth_headers,
    )
    assert list_response.status_code == 200
    row = next(item for item in list_response.json()["data"] if item["id"] == candidate.id)
    assert row["employeeCode"] == "GRP1888"

    update_response = client.patch(
        f"/api/v1/candidates/{candidate.id}",
        json={"employeeCode": "grp1999"},
        headers=auth_headers,
    )

    assert update_response.status_code == 200
    assert update_response.json()["employeeCode"] == "GRP1999"
    db_session.expire_all()
    assert db_session.get(Candidate, candidate.id).employee_code == "GRP1999"


def test_staff_can_backfill_employee_codes_for_signed_candidates(client, auth_headers, db_session):
    signed_candidate = Candidate(
        id="cand-employee-code-backfill",
        candidate_code="ETH-EMP-CODE-BACKFILL",
        full_name="Backfill Employee Code Candidate",
        personal_email="backfill.employee.code@example.com",
        phone="9000000019",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    unsigned_candidate = Candidate(
        id="cand-employee-code-unsigned",
        candidate_code="ETH-EMP-CODE-UNSIGNED",
        full_name="Unsigned Employee Code Candidate",
        personal_email="unsigned.employee.code@example.com",
        phone="9000000020",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SENT,
        current_status="Contract Sent",
    )
    signed_contract = Contract(
        id="ctr-employee-code-backfill",
        candidate_id=signed_candidate.id,
        status=ContractStatus.SIGNED,
        signed_at=datetime.now(UTC),
    )
    sent_contract = Contract(
        id="ctr-employee-code-unsigned",
        candidate_id=unsigned_candidate.id,
        status=ContractStatus.SENT,
    )
    db_session.add_all([signed_candidate, unsigned_candidate, signed_contract, sent_contract])
    db_session.commit()

    response = client.post(
        "/api/v1/candidates/employee-codes/backfill-signed",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Assigned employee codes to 1 signed candidate(s)."
    db_session.expire_all()
    assert db_session.get(Candidate, signed_candidate.id).employee_code == "GRP1001"
    assert db_session.get(Candidate, unsigned_candidate.id).employee_code is None


def test_candidate_can_fill_own_id_card_form_after_signed_contract(client, auth_headers, db_session):
    candidate_user = User(
        id="usr-candidate-id-card",
        email="candidate.id.card@ethara.ai",
        password_hash=hash_password("candidate123"),
        name="Portal ID Card Candidate",
        role=Role.CANDIDATE,
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    candidate = Candidate(
        id="cand-id-card-portal",
        candidate_code="ETH-IDCARD-003",
        full_name="Portal ID Card Candidate",
        personal_email="candidate.id.card@ethara.ai",
        ethara_email="portal.id.card@ethara.ai",
        phone="9000000013",
        source_type=SourceType.DIRECT_APPLICATION,
        portal_user_id=candidate_user.id,
        current_stage="contract_signed",
        current_status="Contract Signed",
    )
    contract = Contract(
        id="contract-id-card-portal",
        candidate_id=candidate.id,
        status=ContractStatus.SIGNED,
    )
    db_session.add_all([candidate_user, candidate, contract])
    db_session.commit()

    candidate_headers = _login(client, "candidate.id.card@ethara.ai", "candidate123")

    initial = client.get("/api/v1/candidates/me/id-card-form", headers=candidate_headers)
    saved = client.post(
        "/api/v1/candidates/me/id-card-form",
        json={
            "name": "Portal ID Card Candidate",
            "employeeId": "EMP-CAND-001",
            "bloodGroup": "B+",
            "emergencyNo": "9988776600",
        },
        headers=candidate_headers,
    )
    admin_view = client.get(f"/api/v1/id-card-forms/{candidate.id}", headers=auth_headers)

    assert initial.status_code == 200
    assert initial.json()["name"] == "Portal ID Card Candidate"
    assert saved.status_code == 200
    assert saved.json()["employeeId"] == "GRP1001"
    assert saved.json()["submittedBy"] == candidate_user.id
    assert admin_view.status_code == 200
    assert admin_view.json()["bloodGroup"] == "B+"


def test_it_id_card_queue_supports_batch_mark_done(client, auth_headers, db_session):
    ready_candidate = Candidate(
        id="cand-id-card-queue-ready",
        candidate_code="ETH-IDCARD-005",
        full_name="Ready ID Card Candidate",
        personal_email="ready.id.card@example.com",
        ethara_email="ready.id.card@ethara.ai",
        phone="9000000015",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.IT_EMAIL_CREATED,
        current_status="IT Email Created",
    )
    awaiting_candidate = Candidate(
        id="cand-id-card-queue-awaiting",
        candidate_code="ETH-IDCARD-006",
        full_name="Awaiting ID Card Candidate",
        personal_email="awaiting.id.card@example.com",
        ethara_email="awaiting.id.card@ethara.ai",
        phone="9000000016",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.IT_EMAIL_CREATED,
        current_status="IT Email Created",
    )
    db_session.add_all([ready_candidate, awaiting_candidate])
    db_session.commit()

    saved = client.post(
        f"/api/v1/id-card-forms/{ready_candidate.id}",
        json={
            "name": "Ready ID Card Candidate",
            "employeeId": "EMP-ID-READY",
            "bloodGroup": "AB+",
            "emergencyNo": "9988776611",
        },
        headers=auth_headers,
    )
    assert saved.status_code == 200

    it_headers = _login(client, "it@ethara.ai", "it123")

    queue = client.get("/api/v1/id-card-forms", headers=it_headers)
    assert queue.status_code == 200
    items = {item["candidateId"]: item for item in queue.json()}
    assert items[ready_candidate.id]["status"] == "ready"
    assert items[ready_candidate.id]["personalEmail"] == "ready.id.card@example.com"
    assert items[ready_candidate.id]["canMarkDone"] is True
    assert items[awaiting_candidate.id]["status"] == "awaiting_details"
    assert items[awaiting_candidate.id]["personalEmail"] == "awaiting.id.card@example.com"
    assert items[awaiting_candidate.id]["canMarkDone"] is False

    awaiting_response = client.post(
        "/api/v1/id-card-forms/mark-done",
        json={"candidateIds": [awaiting_candidate.id]},
        headers=it_headers,
    )
    assert awaiting_response.status_code == 409
    assert awaiting_response.json()["detail"] == "Only submitted ID card forms can be marked as done."

    marked_done = client.post(
        "/api/v1/id-card-forms/mark-done",
        json={"candidateIds": [ready_candidate.id]},
        headers=it_headers,
    )
    assert marked_done.status_code == 200
    assert marked_done.json()["updatedCount"] == 1
    assert marked_done.json()["updatedCandidateIds"] == [ready_candidate.id]

    queue_after = client.get("/api/v1/id-card-forms", headers=it_headers)
    assert queue_after.status_code == 200
    queue_items_after = {item["candidateId"]: item for item in queue_after.json()}
    assert queue_items_after[ready_candidate.id]["status"] == "done"
    assert queue_items_after[ready_candidate.id]["canMarkDone"] is False
    assert queue_items_after[ready_candidate.id]["itCompletedAt"] is not None


def test_id_card_status_sheet_upload_marks_done_and_pending(client, auth_headers, db_session):
    ready_candidate = Candidate(
        id="cand-id-card-sheet-ready",
        candidate_code="ETH-IDCARD-SHEET-1",
        full_name="Sheet Ready Candidate",
        personal_email="sheet.ready@example.com",
        ethara_email="sheet.ready@ethara.ai",
        phone="9000000021",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.IT_EMAIL_CREATED,
        current_status="IT Email Created",
    )
    awaiting_candidate = Candidate(
        id="cand-id-card-sheet-awaiting",
        candidate_code="ETH-IDCARD-SHEET-2",
        full_name="Sheet Awaiting Candidate",
        personal_email="sheet.awaiting@example.com",
        ethara_email="sheet.awaiting@ethara.ai",
        phone="9000000022",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.IT_EMAIL_CREATED,
        current_status="IT Email Created",
    )
    db_session.add_all([ready_candidate, awaiting_candidate])
    db_session.commit()

    saved = client.post(
        f"/api/v1/id-card-forms/{ready_candidate.id}",
        json={
            "name": "Sheet Ready Candidate",
            "employeeId": "EMP-SHEET-READY",
            "bloodGroup": "O+",
            "emergencyNo": "9988776622",
        },
        headers=auth_headers,
    )
    assert saved.status_code == 200

    # Template downloads as CSV with the documented Email/Status header.
    template = client.get("/api/v1/id-card-forms/status-template", headers=auth_headers)
    assert template.status_code == 200
    assert template.text.splitlines()[0] == "Email,Status"

    # Upload: Done for a submitted card, Done for an un-submitted card (skipped),
    # and an unknown email (not matched).
    csv_body = (
        "Email,Status\n"
        "sheet.ready@ethara.ai,Done\n"
        "sheet.awaiting@ethara.ai,Done\n"
        "nobody@ethara.ai,Done\n"
    ).encode("utf-8")
    upload = client.post(
        "/api/v1/id-card-forms/status/upload",
        files={"file": ("status.csv", csv_body, "text/csv")},
        headers=auth_headers,
    )
    assert upload.status_code == 200, upload.text
    summary = upload.json()
    assert summary["markedDone"] == 1
    assert summary["notFound"] == ["nobody@ethara.ai"]
    assert {s["email"] for s in summary["skipped"]} == {"sheet.awaiting@ethara.ai"}

    queue = {item["candidateId"]: item for item in client.get("/api/v1/id-card-forms", headers=auth_headers).json()}
    assert queue[ready_candidate.id]["status"] == "done"

    # Re-upload Pending reverts the issued card back to outstanding ("ready").
    revert = client.post(
        "/api/v1/id-card-forms/status/upload",
        files={"file": ("status.csv", b"Email,Status\nsheet.ready@ethara.ai,Pending\n", "text/csv")},
        headers=auth_headers,
    )
    assert revert.status_code == 200, revert.text
    assert revert.json()["markedPending"] == 1
    queue_after = {item["candidateId"]: item for item in client.get("/api/v1/id-card-forms", headers=auth_headers).json()}
    assert queue_after[ready_candidate.id]["status"] == "ready"
    assert queue_after[ready_candidate.id]["itCompletedAt"] is None


def test_candidate_id_card_form_stays_locked_until_contract_is_signed(client, db_session):
    candidate_user = User(
        id="usr-candidate-id-card-locked",
        email="candidate.id.card.locked@ethara.ai",
        password_hash=hash_password("candidate123"),
        name="Locked ID Card Candidate",
        role=Role.CANDIDATE,
        is_active=True,
        email_verified_at=datetime.now(UTC),
    )
    candidate = Candidate(
        id="cand-id-card-locked",
        candidate_code="ETH-IDCARD-004",
        full_name="Locked ID Card Candidate",
        personal_email="candidate.id.card.locked@ethara.ai",
        ethara_email="locked.id.card@ethara.ai",
        phone="9000000014",
        source_type=SourceType.DIRECT_APPLICATION,
        portal_user_id=candidate_user.id,
        current_stage="contract_sent",
        current_status="Contract Sent",
    )
    contract = Contract(
        id="contract-id-card-locked",
        candidate_id=candidate.id,
        status=ContractStatus.SENT,
    )
    db_session.add_all([candidate_user, candidate, contract])
    db_session.commit()

    candidate_headers = _login(client, "candidate.id.card.locked@ethara.ai", "candidate123")

    response = client.get("/api/v1/candidates/me/id-card-form", headers=candidate_headers)

    assert response.status_code == 409
    assert response.json()["detail"] == "ID card details are available after your contract and NDA are signed."


def test_advance_stage_creates_selection_form(client, auth_headers):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Rahul Sharma",
            "personalEmail": "rahul.sharma@gmail.com",
            "phone": "9876543211",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    candidate_id = created.json()["id"]

    advanced = client.post(
        f"/api/v1/candidates/{candidate_id}/advance-stage",
        json={"toStage": "selection_form_sent", "notes": "Ready for the next step"},
        headers=auth_headers,
    )
    assert advanced.status_code == 200
    assert advanced.json()["currentStage"] == "selection_form_sent"

    fetched = client.get(f"/api/v1/candidates/{candidate_id}", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["selectionForm"] is not None


def test_candidate_export_uses_selection_form_profile_fallbacks(client, db_session, auth_headers):
    candidate = Candidate(
        id="cand-export-fallback",
        candidate_code="CAND-EXPORT-FALLBACK",
        full_name="",
        personal_email="",
        phone="",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.SELECTION_FORM_SUBMITTED,
        current_status="Selection Form Submitted",
        aadhaar_extracted={"aadhaarNumber": "123412341234"},
    )
    selection_form = SelectionForm(
        id="sf-export-fallback",
        candidate_id=candidate.id,
        submitted_at=datetime.now(UTC),
        form_data={
            "basicDetails": {
                "fullName": "Export Fallback Candidate",
                "email": "export.fallback@example.com",
                "contactNumber": "9876501111",
                "dateOfBirth": "1999-05-04",
                "experienceType": "fresher",
            },
            "personalDetails": {
                "gender": "female",
                "maritalStatus": "single",
                "aadhaarNumber": "1234 1234 1234",
            },
        },
    )
    db_session.add_all([candidate, selection_form])
    db_session.commit()

    response = client.get("/api/v1/candidates/export", headers=auth_headers)

    assert response.status_code == 200
    rows = list(csv.DictReader(io.StringIO(response.text.lstrip("\ufeff"))))
    row = next(item for item in rows if item["Candidate Id"] == candidate.id)
    assert row["Name"] == "Export Fallback Candidate"
    assert row["Personal Email"] == "export.fallback@example.com"
    assert row["Phone"] == "9876501111"
    assert row["Gender"] == "female"
    assert row["Date of Birth"].startswith("1999-05-04")
    assert row["Marital Status"] == "single"
    assert row["Aadhaar Last4"] == "1234"
    assert row["Experience Type"] == "fresher"


def test_selection_form_rejects_reference_phone_longer_than_ten_digits(client, auth_headers):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Selection Form Candidate",
            "personalEmail": "selection.form.candidate@gmail.com",
            "phone": "9876543201",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    candidate_id = created.json()["id"]

    response = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={
            "formData": {
                "references": [
                    {
                        "name": "Reference One",
                        "email": "reference.one@example.com",
                        "phone": "98765432101",
                        "linkedin": "linkedin.com/in/reference-one",
                    }
                ]
            }
        },
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Reference 1 phone number must be exactly 10 digits."


def test_delete_candidate_releases_candidate_portal_account(client, db_session, auth_headers):
    email = "delete.release.candidate@example.com"
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Delete Release Candidate",
            "personalEmail": email,
            "phone": "9876543290",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]
    db_session.expire_all()
    candidate = db_session.get(Candidate, candidate_id)
    portal_user_id = candidate.portal_user_id
    assert portal_user_id

    deleted = client.delete(f"/api/v1/candidates/{candidate_id}", headers=auth_headers)
    assert deleted.status_code == 204

    db_session.expire_all()
    removed = db_session.get(Candidate, candidate_id)
    released_user = db_session.get(User, portal_user_id)
    assert removed.is_removed is True
    assert removed.current_status == "Removed"
    assert removed.portal_user_id is None
    assert released_user.is_active is False
    assert released_user.email.startswith("deleted+")
    assert released_user.refresh_token_hash is None

    recreated = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Delete Release Candidate Again",
            "personalEmail": email,
            "phone": "9876543291",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert recreated.status_code == 200
    assert recreated.json()["personalEmail"] == email


def test_selection_form_document_preview_and_download(client, db_session, auth_headers):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Selection Document Candidate",
            "personalEmail": "selection.document.candidate@gmail.com",
            "phone": "9876543202",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]

    storage_path = get_settings().local_storage_path / "selection-forms" / "selection-preview-test.pdf"
    storage_path.parent.mkdir(parents=True, exist_ok=True)
    storage_path.write_bytes(b"%PDF-1.4 selection form document")
    file_url = "/uploads/selection-forms/selection-preview-test.pdf"
    document = Document(
        id="doc-selection-form-preview",
        candidate_id=candidate_id,
        type="selection_form_marksheet_10th",
        file_name="Class 10 Marksheet.pdf",
        file_url=file_url,
        mime_type="application/pdf",
        file_size=storage_path.stat().st_size,
    )
    db_session.add(document)
    db_session.commit()

    submitted = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={
            "formData": {
                "documentsUploaded": {
                    "marksheet_10th": {
                        "fileName": "Class 10 Marksheet.pdf",
                        "documentId": document.id,
                        "fileUrl": file_url,
                        "mimeType": "application/pdf",
                    }
                }
            }
        },
        headers=auth_headers,
    )
    assert submitted.status_code == 200
    assert submitted.json()["formData"]["documentsUploaded"]["marksheet_10th"]["fileAvailable"] is True

    preview = client.get(
        f"/api/v1/selection-forms/{candidate_id}/documents/marksheet_10th/preview",
        headers=auth_headers,
    )
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith("application/pdf")
    assert "inline" in preview.headers["content-disposition"]
    assert preview.content == b"%PDF-1.4 selection form document"

    download = client.get(
        f"/api/v1/selection-forms/{candidate_id}/documents/marksheet_10th/download",
        headers=auth_headers,
    )
    assert download.status_code == 200
    assert "attachment" in download.headers["content-disposition"]
    assert download.content == b"%PDF-1.4 selection form document"


def test_selection_form_document_verify_uses_ai_document_type_api(client, auth_headers, monkeypatch):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Selection Document Verify Candidate",
            "personalEmail": "selection.document.verify@gmail.com",
            "phone": "9876543208",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]
    seen: dict[str, str] = {}

    def fake_verify_document_type(*, file, document_type):
        seen["document_type"] = document_type
        seen["file_name"] = file.filename
        return {
            "detectedDocumentType": "education certificate",
            "matchesExpectedCategory": True,
            "ocrStatus": "extracted",
            "message": "Looks like a valid 10th Marksheet / Certificate.",
        }

    monkeypatch.setattr(employee_service, "verify_document_type", fake_verify_document_type)

    response = client.post(
        f"/api/v1/selection-forms/{candidate_id}/documents/marksheet_10th/verify",
        files={"file": ("Class X Marksheet.pdf", BytesIO(b"%PDF-1.4 verify me"), "application/pdf")},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert seen == {
        "document_type": "selection_form_marksheet_10th",
        "file_name": "Class X Marksheet.pdf",
    }
    assert response.json()["matchesExpectedCategory"] is True


def test_selection_form_attached_document_verify_persists_status(client, db_session, auth_headers, monkeypatch):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Selection Attached Verify Candidate",
            "personalEmail": "selection.attached.verify@gmail.com",
            "phone": "9876543209",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]

    storage_path = get_settings().local_storage_path / "selection-forms" / "selection-attached-verify.pdf"
    storage_path.parent.mkdir(parents=True, exist_ok=True)
    storage_path.write_bytes(b"%PDF-1.4 verify attached document")
    file_url = "/uploads/selection-forms/selection-attached-verify.pdf"
    document = Document(
        id="doc-selection-form-attached-verify",
        candidate_id=candidate_id,
        type="selection_form_marksheet_10th",
        file_name="Attached Class 10 Marksheet.pdf",
        file_url=file_url,
        mime_type="application/pdf",
        file_size=storage_path.stat().st_size,
        status="uploaded",
    )
    db_session.add(document)
    db_session.commit()

    submitted = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={
            "formData": {
                "documentsUploaded": {
                    "marksheet_10th": {
                        "fileName": "Attached Class 10 Marksheet.pdf",
                        "documentId": document.id,
                        "fileUrl": file_url,
                        "mimeType": "application/pdf",
                    }
                }
            }
        },
        headers=auth_headers,
    )
    assert submitted.status_code == 200
    seen: dict[str, object] = {}

    def fake_verify_document_content(*, content, mime_type, document_type):
        seen["content"] = content
        seen["mime_type"] = mime_type
        seen["document_type"] = document_type
        return {
            "detectedDocumentType": "education certificate",
            "matchesExpectedCategory": True,
            "ocrStatus": "extracted",
            "message": "Looks like a valid 10th Marksheet / Certificate.",
        }

    monkeypatch.setattr(employee_service, "verify_document_content", fake_verify_document_content)

    response = client.post(
        f"/api/v1/selection-forms/{candidate_id}/documents/marksheet_10th/verify",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert seen == {
        "content": b"%PDF-1.4 verify attached document",
        "mime_type": "application/pdf",
        "document_type": "selection_form_marksheet_10th",
    }
    payload = response.json()
    assert payload["result"]["matchesExpectedCategory"] is True
    entry = payload["form"]["formData"]["documentsUploaded"]["marksheet_10th"]
    assert entry["fileAvailable"] is True
    assert entry["verificationStatus"] == "verified"
    assert entry["needsReview"] is False
    assert entry["matchesExpectedCategory"] is True
    assert entry["verifiedBy"] == "usr-admin"

    db_session.expire_all()
    refreshed = db_session.get(Document, document.id)
    assert refreshed.status == "verified"
    assert refreshed.ocr_status == "extracted"
    assert refreshed.verified_by == "usr-admin"
    assert refreshed.extracted_data["detectedDocumentType"] == "education certificate"


REQUIRED_SELECTION_FORM_DOCUMENT_KEYS = [
    "passport_size_photo",
    "marksheet_10th",
    "marksheet_12th",
    "graduation",
    "pan_doc",
    "aadhaar_doc",
    "permanent_address_proof",
]


def test_selection_form_current_address_proof_uses_address_ai_category():
    assert (
        employee_service.document_ai_expected_category("selection_form_current_address_proof")
        == "address_proof"
    )


def _create_selection_form_document_payload(db_session, *, candidate_id: str, prefix: str) -> dict[str, dict[str, str | None]]:
    payload: dict[str, dict[str, str | None]] = {}
    documents = []
    for index, document_key in enumerate(REQUIRED_SELECTION_FORM_DOCUMENT_KEYS):
        storage_path = get_settings().local_storage_path / "selection-forms" / f"{prefix}-{document_key}.pdf"
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        storage_path.write_bytes(f"%PDF-1.4 {prefix} {document_key}".encode())
        file_url = f"/uploads/selection-forms/{prefix}-{document_key}.pdf"
        document = Document(
            id=f"doc-{prefix}-{index}",
            candidate_id=candidate_id,
            type=f"selection_form_{document_key}",
            file_name=f"{document_key}.pdf",
            file_url=file_url,
            mime_type="application/pdf",
            file_size=storage_path.stat().st_size,
            status="uploaded",
        )
        documents.append(document)
        payload[document_key] = {
            "fileName": document.file_name,
            "documentId": document.id,
            "fileUrl": file_url,
            "mimeType": "application/pdf",
        }
    db_session.add_all(documents)
    db_session.commit()
    return payload


def _capture_selection_form_queue(monkeypatch) -> list[tuple[str, list[str] | None]]:
    queued: list[tuple[str, list[str] | None]] = []

    def fake_send_task(name: str, args: list[str] | None = None):
        queued.append((name, args))
        return SimpleNamespace(id="selection-form-task")

    monkeypatch.setattr("app.api.routes.workflows.celery_app.send_task", fake_send_task)
    return queued


def test_selection_form_submit_auto_validates_when_documents_pass(client, db_session, auth_headers, monkeypatch):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Auto Validated Selection Candidate",
            "personalEmail": "selection.auto.validated@gmail.com",
            "phone": "9876543219",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]
    documents_payload = _create_selection_form_document_payload(
        db_session,
        candidate_id=candidate_id,
        prefix="auto-pass",
    )
    queued = _capture_selection_form_queue(monkeypatch)
    verified_document_types: list[str] = []

    def fake_verify_document_content(*, content, mime_type, document_type):
        assert content
        assert mime_type == "application/pdf"
        verified_document_types.append(document_type)
        return {
            "detectedDocumentType": document_type,
            "matchesExpectedCategory": True,
            "ocrStatus": "extracted",
            "message": "Looks valid.",
        }

    monkeypatch.setattr(employee_service, "verify_document_content", fake_verify_document_content)

    response = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={
            "formData": {
                "basicDetails": {"experienceType": "fresher"},
                "documentsUploaded": documents_payload,
            }
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["submittedAt"] is not None
    assert body["validatedAt"] is None
    assert body["verificationStatus"] == "queued"
    assert queued == [
        ("app.tasks.documents.process_selection_form_verification", [body["id"], "usr-admin"])
    ]
    assert verified_document_types == []

    db_session.expire_all()
    record = db_session.get(SelectionForm, body["id"])
    actor = db_session.get(User, "usr-admin")
    result = workflow_service.process_selection_form_document_verification(
        db_session,
        selection_form=record,
        actor=actor,
    )
    db_session.commit()

    assert result["status"] == "validated"
    assert set(verified_document_types) == {
        f"selection_form_{document_key}" for document_key in REQUIRED_SELECTION_FORM_DOCUMENT_KEYS
    }
    db_session.expire_all()
    record = db_session.get(SelectionForm, body["id"])
    uploaded = record.form_data["documentsUploaded"]
    assert all(uploaded[key]["verificationStatus"] == "verified" for key in REQUIRED_SELECTION_FORM_DOCUMENT_KEYS)

    candidate = db_session.get(Candidate, candidate_id)
    assert candidate.current_stage == CandidateStage.SELECTION_FORM_VALIDATED
    assert candidate.current_status == "Selection Form Validated"


def test_selection_form_submit_stays_manual_when_document_needs_review(client, db_session, auth_headers, monkeypatch):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Manual Review Selection Candidate",
            "personalEmail": "selection.manual.review@gmail.com",
            "phone": "9876543220",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]
    documents_payload = _create_selection_form_document_payload(
        db_session,
        candidate_id=candidate_id,
        prefix="manual-review",
    )
    queued = _capture_selection_form_queue(monkeypatch)

    def fake_verify_document_content(*, content, mime_type, document_type):
        if document_type == "selection_form_aadhaar_doc":
            return {
                "detectedDocumentType": "unknown",
                "matchesExpectedCategory": False,
                "ocrStatus": "needs_review",
                "message": "Please double-check the file.",
            }
        return {
            "detectedDocumentType": document_type,
            "matchesExpectedCategory": True,
            "ocrStatus": "extracted",
            "message": "Looks valid.",
        }

    monkeypatch.setattr(employee_service, "verify_document_content", fake_verify_document_content)

    response = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={
            "formData": {
                "basicDetails": {"experienceType": "fresher"},
                "documentsUploaded": documents_payload,
            }
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["submittedAt"] is not None
    assert body["validatedAt"] is None
    assert body["verificationStatus"] == "queued"
    assert queued == [
        ("app.tasks.documents.process_selection_form_verification", [body["id"], "usr-admin"])
    ]

    db_session.expire_all()
    record = db_session.get(SelectionForm, body["id"])
    actor = db_session.get(User, "usr-admin")
    result = workflow_service.process_selection_form_document_verification(
        db_session,
        selection_form=record,
        actor=actor,
    )
    db_session.commit()

    assert result["status"] == "needs_review"
    db_session.expire_all()
    record = db_session.get(SelectionForm, body["id"])
    aadhaar_entry = record.form_data["documentsUploaded"]["aadhaar_doc"]
    assert aadhaar_entry["verificationStatus"] == "needs_review"
    assert aadhaar_entry["needsReview"] is True

    candidate = db_session.get(Candidate, candidate_id)
    assert candidate.current_stage == CandidateStage.SELECTION_FORM_SUBMITTED
    assert candidate.current_status == "Selection Form Submitted"


def test_selection_form_submit_stays_manual_when_bank_proof_missing(client, db_session, auth_headers, monkeypatch):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Bank Proof Missing Selection Candidate",
            "personalEmail": "selection.bank.proof@gmail.com",
            "phone": "9876543222",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]
    documents_payload = _create_selection_form_document_payload(
        db_session,
        candidate_id=candidate_id,
        prefix="bank-proof-missing",
    )
    queued = _capture_selection_form_queue(monkeypatch)

    def fake_verify_document_content(*, content, mime_type, document_type):
        return {
            "detectedDocumentType": document_type,
            "matchesExpectedCategory": True,
            "ocrStatus": "extracted",
            "message": "Looks valid.",
        }

    monkeypatch.setattr(employee_service, "verify_document_content", fake_verify_document_content)

    response = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={
            "formData": {
                "basicDetails": {"experienceType": "fresher"},
                "bankDetails": {
                    "bankName": "HDFC Bank",
                    "accountHolderName": "Bank Proof Missing Selection Candidate",
                    "accountNumber": "123456789012",
                    "ifsc": "HDFC0000001",
                },
                "documentsUploaded": documents_payload,
            }
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["submittedAt"] is not None
    assert body["validatedAt"] is None
    assert body["verificationStatus"] == "queued"
    assert queued == [
        ("app.tasks.documents.process_selection_form_verification", [body["id"], "usr-admin"])
    ]

    db_session.expire_all()
    record = db_session.get(SelectionForm, body["id"])
    actor = db_session.get(User, "usr-admin")
    result = workflow_service.process_selection_form_document_verification(
        db_session,
        selection_form=record,
        actor=actor,
    )
    db_session.commit()

    assert result["status"] == "needs_review"
    assert result["missingKeys"] == ["cancelled_cheque"]

    db_session.expire_all()
    candidate = db_session.get(Candidate, candidate_id)
    assert candidate.current_stage == CandidateStage.SELECTION_FORM_SUBMITTED


def test_selection_form_submit_stays_manual_when_document_verifier_errors(client, db_session, auth_headers, monkeypatch):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Verifier Error Selection Candidate",
            "personalEmail": "selection.verifier.error@gmail.com",
            "phone": "9876543223",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]
    documents_payload = _create_selection_form_document_payload(
        db_session,
        candidate_id=candidate_id,
        prefix="verifier-error",
    )
    queued = _capture_selection_form_queue(monkeypatch)

    def fake_verify_document_content(*, content, mime_type, document_type):
        if document_type == "selection_form_aadhaar_doc":
            raise RuntimeError("temporary verifier outage")
        return {
            "detectedDocumentType": document_type,
            "matchesExpectedCategory": True,
            "ocrStatus": "extracted",
            "message": "Looks valid.",
        }

    monkeypatch.setattr(employee_service, "verify_document_content", fake_verify_document_content)

    response = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={
            "formData": {
                "basicDetails": {"experienceType": "fresher"},
                "documentsUploaded": documents_payload,
            }
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["submittedAt"] is not None
    assert body["validatedAt"] is None
    assert body["verificationStatus"] == "queued"
    assert queued == [
        ("app.tasks.documents.process_selection_form_verification", [body["id"], "usr-admin"])
    ]

    db_session.expire_all()
    record = db_session.get(SelectionForm, body["id"])
    actor = db_session.get(User, "usr-admin")
    result = workflow_service.process_selection_form_document_verification(
        db_session,
        selection_form=record,
        actor=actor,
    )
    db_session.commit()

    assert result["status"] == "needs_review"
    assert result["failed"] == 1

    db_session.expire_all()
    candidate = db_session.get(Candidate, candidate_id)
    assert candidate.current_stage == CandidateStage.SELECTION_FORM_SUBMITTED


def test_selection_form_legacy_filename_document_is_marked_unavailable(client, auth_headers):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Legacy Selection Document Candidate",
            "personalEmail": "legacy.selection.document@gmail.com",
            "phone": "9876543203",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]

    submitted = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={"formData": {"documentsUploaded": {"marksheet_10th": "Class X Marksheet.pdf"}}},
        headers=auth_headers,
    )
    assert submitted.status_code == 200
    document_entry = submitted.json()["formData"]["documentsUploaded"]["marksheet_10th"]
    assert document_entry["fileName"] == "Class X Marksheet.pdf"
    assert document_entry["fileAvailable"] is False

    download = client.get(
        f"/api/v1/selection-forms/{candidate_id}/documents/marksheet_10th/download",
        headers=auth_headers,
    )
    assert download.status_code == 404


def test_selection_form_legacy_document_can_be_attached(client, auth_headers):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Attach Legacy Selection Document",
            "personalEmail": "attach.legacy.selection.document@gmail.com",
            "phone": "9876543204",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]

    submitted = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={"formData": {"documentsUploaded": {"marksheet_10th": "Class X Marksheet.pdf"}}},
        headers=auth_headers,
    )
    assert submitted.status_code == 200
    assert submitted.json()["formData"]["documentsUploaded"]["marksheet_10th"]["fileAvailable"] is False

    attached = client.post(
        f"/api/v1/selection-forms/{candidate_id}/documents/marksheet_10th/upload",
        files={"file": ("Class X Marksheet.pdf", BytesIO(b"%PDF-1.4 attached legacy document"), "application/pdf")},
        headers=auth_headers,
    )
    assert attached.status_code == 200
    attached_entry = attached.json()["formData"]["documentsUploaded"]["marksheet_10th"]
    assert attached_entry["fileName"] == "Class X Marksheet.pdf"
    assert attached_entry["fileAvailable"] is True
    assert attached_entry["documentId"]

    preview = client.get(
        f"/api/v1/selection-forms/{candidate_id}/documents/marksheet_10th/preview",
        headers=auth_headers,
    )
    assert preview.status_code == 200
    assert preview.content == b"%PDF-1.4 attached legacy document"


def test_selection_form_reopen_retains_saved_answers(client, auth_headers):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Reopen Selection Form Candidate",
            "personalEmail": "reopen.selection.form@gmail.com",
            "phone": "9876543205",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    candidate_id = created.json()["id"]

    submitted = client.post(
        f"/api/v1/selection-forms/{candidate_id}/submit",
        json={
            "formData": {
                "basicDetails": {
                    "fullName": "Reopen Selection Form Candidate",
                    "email": "reopen.selection.form@gmail.com",
                },
                "bankDetails": {"bankName": "SBI Bank"},
                "documentsUploaded": {"marksheet_10th": "Class X Marksheet.pdf"},
            }
        },
        headers=auth_headers,
    )
    assert submitted.status_code == 200
    assert submitted.json()["submittedAt"] is not None

    reopened = client.patch(
        f"/api/v1/selection-forms/{candidate_id}/reopen",
        headers=auth_headers,
    )
    assert reopened.status_code == 200
    body = reopened.json()
    assert body["submittedAt"] is None
    assert body["validatedAt"] is None
    assert body["formData"]["basicDetails"]["fullName"] == "Reopen Selection Form Candidate"
    assert body["formData"]["bankDetails"]["bankName"] == "SBI Bank"
    assert body["formData"]["documentsUploaded"]["marksheet_10th"]["fileName"] == "Class X Marksheet.pdf"
    assert body["formData"]["documentsUploaded"]["marksheet_10th"]["fileAvailable"] is False

    fetched = client.get(f"/api/v1/candidates/{candidate_id}", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["currentStage"] == "selection_form_sent"
    assert fetched.json()["currentStatus"] == "Selection Form Sent"


def test_compliance_list_does_not_send_candidate_documenso_forms(client, auth_headers, db_session, monkeypatch):
    candidate = Candidate(
        id="cand-compliance-list-readonly",
        candidate_code="ETH-COMP-READ",
        full_name="Compliance List Read Only",
        personal_email="compliance.list.readonly@example.com",
        phone="9000000101",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    contract = Contract(
        id="contract-compliance-list-readonly",
        candidate_id=candidate.id,
        status=ContractStatus.SIGNED,
    )
    db_session.add_all([candidate, contract])
    db_session.commit()
    _add_candidate_compliance_templates(db_session)
    created_payloads: list[dict] = []
    _mock_candidate_compliance_send(monkeypatch, created_payloads)

    response = client.get(
        "/api/v1/compliance",
        params={"candidateId": candidate.id},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json() == []
    assert created_payloads == []
    assert db_session.scalars(select(ComplianceForm).where(ComplianceForm.candidate_id == candidate.id)).all() == []


def test_admin_can_send_candidate_compliance_after_contract_signed(client, auth_headers, db_session, monkeypatch):
    candidate = Candidate(
        id="cand-compliance-send",
        candidate_code="ETH-COMP-SEND",
        full_name="Compliance Send Candidate",
        personal_email="compliance.send@example.com",
        phone="9000000102",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    contract = Contract(
        id="contract-compliance-send",
        candidate_id=candidate.id,
        status=ContractStatus.SIGNED,
    )
    db_session.add_all([candidate, contract])
    db_session.commit()
    _add_candidate_compliance_templates(db_session)
    created_payloads: list[dict] = []
    _mock_candidate_compliance_send(monkeypatch, created_payloads)

    response = client.post(
        f"/api/v1/compliance/send-esign/{candidate.id}",
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert {item["formType"] for item in body} == {"form_11", "form_2", "form_f"}
    assert all(item["status"] == "sent" for item in body)
    assert len(created_payloads) == 3
    assert created_payloads[0]["recipients"][0]["email"] == "compliance.send@example.com"
    db_session.expire_all()
    refreshed = db_session.get(Candidate, candidate.id)
    assert refreshed.current_stage == CandidateStage.STATUTORY_FORMS_SENT
    assert refreshed.current_status == "Statutory Forms Sent"

    second = client.post(
        f"/api/v1/compliance/send-esign/{candidate.id}",
        headers=auth_headers,
    )
    assert second.status_code == 200
    assert len(second.json()) == 3
    assert len(created_payloads) == 3


def test_admin_can_resend_one_unsigned_candidate_compliance_form(client, auth_headers, db_session, monkeypatch):
    candidate = Candidate(
        id="cand-compliance-resend",
        candidate_code="ETH-COMP-RESEND",
        full_name="Compliance Resend Candidate",
        personal_email="compliance.resend@example.com",
        phone="9000000104",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.STATUTORY_FORMS_SENT,
        current_status="Statutory Forms Sent",
    )
    form = ComplianceForm(
        candidate_id=candidate.id,
        form_type="form_f",
        form_title="Form F",
        status="rejected",
        documenso_id="old-documenso-id",
        signed_url="https://documenso.example/sign/old",
        pdf_url="/uploads/compliance/old-form-f.pdf",
        signed_at=datetime.now(UTC),
        verified_at=datetime.now(UTC),
    )
    db_session.add_all([candidate, form])
    db_session.commit()
    _add_candidate_compliance_templates(db_session)
    created_payloads: list[dict] = []
    _mock_candidate_compliance_send(monkeypatch, created_payloads)

    response = client.post(
        f"/api/v1/compliance/{form.id}/resend-esign",
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["formType"] == "form_f"
    assert body["formTitle"] == "Form F"
    assert body["status"] == "sent"
    assert body["documensoId"] == "9103"
    assert body["signedUrl"] == "https://documenso.example/sign/candidate-token-2103"
    assert body["pdfUrl"] is None
    assert body["signedAt"] is None
    assert len(created_payloads) == 1
    assert created_payloads[0]["template_id"] == 2103
    assert created_payloads[0]["recipients"][0]["email"] == "compliance.resend@example.com"

    db_session.expire_all()
    refreshed_form = db_session.get(ComplianceForm, form.id)
    assert refreshed_form.status == "sent"
    assert refreshed_form.documenso_id == "9103"
    assert refreshed_form.pdf_url is None
    assert refreshed_form.signed_at is None
    assert refreshed_form.verified_at is None
    assert refreshed_form.sent_at is not None


def test_it_completion_does_not_send_or_downgrade_statutory_forms(client, db_session, monkeypatch):
    candidate = Candidate(
        id="cand-it-parallel-compliance",
        candidate_code="ETH-IT-PAR",
        full_name="IT Parallel Compliance",
        personal_email="it.parallel.compliance@example.com",
        phone="9000000103",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.STATUTORY_FORMS_SENT,
        current_status="Statutory Forms Sent",
    )
    request = ITRequest(
        id="it-request-parallel-compliance",
        candidate_id=candidate.id,
        requested_by="usr-admin",
        suggested_email="it.parallel.compliance@ethara.ai",
        status="pending",
    )
    form = ComplianceForm(
        candidate_id=candidate.id,
        form_type="form_11",
        form_title="Form 11",
        status="sent",
        documenso_id="9101",
    )
    db_session.add_all([candidate, request, form])
    db_session.commit()

    def fail_send(*args, **kwargs):
        raise AssertionError("IT completion must not send compliance forms")

    monkeypatch.setattr(
        "app.services.compliance_documenso.send_candidate_compliance_forms",
        fail_send,
    )
    it_headers = _login(client, "it@ethara.ai", "it123")

    response = client.patch(
        f"/api/v1/it-requests/{request.id}/complete",
        json={"createdEmail": "it.parallel.compliance@ethara.ai"},
        headers=it_headers,
    )

    assert response.status_code == 200
    assert response.json()["candidatePersonalEmail"] == "it.parallel.compliance@example.com"
    listing = client.get("/api/v1/it-requests?status=completed", headers=it_headers)
    assert listing.status_code == 200
    completed_row = next(row for row in listing.json() if row["id"] == request.id)
    assert completed_row["candidatePersonalEmail"] == "it.parallel.compliance@example.com"
    db_session.expire_all()
    refreshed = db_session.get(Candidate, candidate.id)
    assert refreshed.ethara_email == "it.parallel.compliance@ethara.ai"
    assert refreshed.current_stage == CandidateStage.STATUTORY_FORMS_SENT
    assert refreshed.current_status == "Statutory Forms Sent"


def test_document_upload_creates_screening_flow(client, auth_headers, pdf_file, monkeypatch):
    queued = []
    monkeypatch.setattr("app.api.routes.workflows.celery_app.send_task", lambda name, args=None: queued.append((name, args)))

    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Amit Singh",
            "personalEmail": "amit.singh@gmail.com",
            "phone": "9876543222",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    candidate_id = created.json()["id"]

    uploaded = client.post(
        "/api/v1/documents/upload",
        data={"candidateId": candidate_id, "type": "resume"},
        files={"file": pdf_file},
        headers=auth_headers,
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["type"] == "resume"

    screening = client.get("/api/v1/screening", headers=auth_headers)
    assert screening.status_code == 200
    records = screening.json()["data"]
    record = next(item for item in records if item["candidateId"] == candidate_id)
    assert record["resumeDocument"]["id"] == uploaded.json()["id"]
    assert record["screeningStatus"] in {"pending", "completed"}
    if queued:
        assert queued[0][0] == "app.tasks.screening.process_resume_screening"
    else:
        assert record["screeningStatus"] == "completed"
        assert record["recommendation"] == "needs_review"


def test_resume_extraction_uses_rapidocr_for_scanned_pdf(monkeypatch):
    from app.api.routes import candidates as candidate_routes

    monkeypatch.setattr(candidate_routes, "extract_pdf_text", lambda content: "")
    monkeypatch.setattr(candidate_routes, "extract_text_with_pymupdf_ocr", lambda *args, **kwargs: "")
    monkeypatch.setattr(
        candidate_routes,
        "_extract_text_with_rapidocr",
        lambda content, *, image_upload, max_pages=2: ["Aarav Mehta\nPython\nReact\nMachine Learning"],
    )

    text = candidate_routes._extract_resume_text(
        b"%PDF-1.4 scanned resume",
        ".pdf",
        "application/pdf",
    )

    assert "Aarav Mehta" in text
    assert "Machine Learning" in text


def test_screening_override_updates_screening_record(client, auth_headers, pdf_file):
    created = client.post(
        "/api/v1/candidates",
        json={
            "fullName": "Screening Override Candidate",
            "personalEmail": "screening.override@gmail.com",
            "phone": "9876543223",
            "sourceType": "direct_application",
            "positionId": "pos-fe",
        },
        headers=auth_headers,
    )
    candidate_id = created.json()["id"]

    uploaded = client.post(
        "/api/v1/documents/upload",
        data={"candidateId": candidate_id, "type": "resume"},
        files={"file": pdf_file},
        headers=auth_headers,
    )
    assert uploaded.status_code == 200

    override_response = client.post(
        f"/api/v1/screening/{candidate_id}/override",
        json={"recommendation": "rejected", "reason": "Missing required role fit."},
        headers=auth_headers,
    )
    assert override_response.status_code == 200
    body = override_response.json()
    assert body["recommendation"] == "rejected"
    assert body["currentStage"] == "resume_rejected"
    assert body["manualOverride"]["reason"] == "Missing required role fit."


def test_public_position_detail_is_available_by_slug(client):
    response = client.get("/api/v1/public/positions/senior-frontend-developer")

    assert response.status_code == 200
    assert response.json()["title"] == "Senior Frontend Developer"


def test_candidate_can_apply_for_role_from_portal(client, pdf_file, monkeypatch):
    monkeypatch.setattr("app.services.account_security._generate_otp", lambda: "112233")

    registered = client.post(
        "/api/v1/candidates/register",
        data={
            "fullName": "Portal Apply Candidate",
            "gender": "female",
            "experienceType": "experienced",
            "experienceYears": "6",
            "personalEmail": "portal.apply@example.com",
            "phone": "9876543215",
            "password": "candidate123",
            "aadhaarNumber": "111122223333",
            "dateOfBirth": "2000-01-15",
            "collegeId": "",
        },
        files={
            "resume": pdf_file,
            "aadhaarCard": ("aadhaar-front.jpg", BytesIO(b"fake-image"), "image/jpeg"),
        },
    )
    assert registered.status_code == 200

    confirmed = client.post(
        "/api/v1/auth/email-verification/confirm-public",
        json={"email": "portal.apply@example.com", "code": "112233"},
    )
    assert confirmed.status_code == 200

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "portal.apply@example.com", "password": "candidate123"},
    )
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    apply_response = client.post(
        "/api/v1/candidates/me/apply",
        json={"positionId": "pos-fe"},
        headers=headers,
    )
    assert apply_response.status_code == 200
    assert apply_response.json()["positionId"] == "pos-fe"

    overview = client.get("/api/v1/candidates/me", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["currentApplication"]["position"]["title"] == "Senior Frontend Developer"
