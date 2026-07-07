from types import SimpleNamespace

from sqlalchemy import select

from app.db.models import (
    Candidate,
    CandidateStage,
    ContractStatus,
    DocumensoSignedProfile,
    DocumensoSyncLog,
    DocumensoSyncState,
    EmployeeContract,
    EmployeeProfile,
    SourceType,
)
from app.services import documenso_profiles as profiles_svc


def test_list_signed_profiles_includes_candidate_details(client, auth_headers, db_session):
    candidate = Candidate(
        id="cand-signed-001",
        candidate_code="ETH-SIGNED-001",
        full_name="Signed Candidate",
        personal_email="signed.candidate@example.com",
        ethara_email="signed.candidate@ethara.ai",
        phone="9876543209",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
        position_id="pos-fe",
    )
    profile = DocumensoSignedProfile(
        id="signed-prof-001",
        documenso_doc_id=4567,
        template_id=101,
        template_title="Offer Letter",
        recipient_email="signed.candidate@example.com",
        recipient_name="Signed Candidate",
        candidate_id=candidate.id,
        field_values={"Department": "Engineering"},
    )
    db_session.add_all([candidate, profile])
    db_session.commit()

    response = client.get("/api/v1/documenso/signed-profiles", headers=auth_headers)

    assert response.status_code == 200
    row = next(item for item in response.json()["data"] if item["id"] == profile.id)
    assert row["candidateId"] == candidate.id
    assert row["candidate"] is not None
    assert row["candidate"]["candidateCode"] == "ETH-SIGNED-001"
    assert row["candidate"]["currentStage"] == "contract_signed"
    assert row["candidate"]["currentStatus"] == "Contract Signed"
    assert row["candidate"]["position"]["title"] == "Senior Frontend Developer"


def test_export_signed_profiles_csv_contains_candidate_details(client, auth_headers, db_session):
    candidate = Candidate(
        id="cand-signed-002",
        candidate_code="ETH-SIGNED-002",
        full_name="Export Candidate",
        personal_email="export.candidate@example.com",
        ethara_email="export.candidate@ethara.ai",
        phone="9876543218",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SENT,
        current_status="Contract Sent",
        position_id="pos-be",
    )
    profile = DocumensoSignedProfile(
        id="signed-prof-002",
        documenso_doc_id=8901,
        template_id=202,
        template_title="Joining Agreement",
        recipient_email="export.candidate@example.com",
        recipient_name="Export Candidate",
        candidate_id=candidate.id,
        field_values={"Department": "Engineering"},
    )
    db_session.add_all([candidate, profile])
    db_session.commit()

    response = client.get("/api/v1/documenso/signed-profiles/export", headers=auth_headers)

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    body = response.text
    assert "candidate_code" in body
    assert "candidate_current_status" in body
    assert "ETH-SIGNED-002" in body
    assert "Contract Sent" in body


def test_sync_signed_profiles_updates_state_and_imports_multiple_documents(db_session, monkeypatch):
    monkeypatch.setattr(
        "app.services.documenso_profiles.get_settings",
        lambda: SimpleNamespace(documenso_api_key="doc-key", documenso_rate_limit_delay_ms=0),
    )
    monkeypatch.setattr(
        "app.services.documenso_profiles.ds_client.list_documents",
        lambda **kwargs: {
            "data": [{"id": 787349}, {"id": 787350}, {"id": 787353}, {"id": 787354}],
            "totalPages": 1,
        },
    )

    def fake_get_document_with_fields(document_id: int) -> dict:
        return {
            "id": document_id,
            "templateId": 11796,
            "title": f"Offer Letter {document_id}",
            "completedAt": "2026-05-14T20:35:14.905Z",
            "recipients": [
                {
                    "email": f"user{document_id}@example.com",
                    "name": f"User {document_id}",
                    "signingStatus": "SIGNED",
                }
            ],
            "fields": [
                {
                    "type": "TEXT",
                    "customText": f"Value {document_id}",
                    "fieldMeta": {"label": "Department"},
                }
            ],
        }

    monkeypatch.setattr(
        "app.services.documenso_profiles.ds_client.get_document_with_fields",
        fake_get_document_with_fields,
    )

    result = profiles_svc.sync_signed_profiles(db_session)
    db_session.commit()

    assert result == {
        "synced": 4,
        "errors": 0,
        "pages_done": 1,
        "total_pages": 1,
        "done": True,
    }

    state = db_session.get(DocumensoSyncState, "profiles")
    assert state is not None
    assert state.sync_status == "completed"
    assert state.documents_processed == 4
    assert state.last_document_id is None
    assert state.error_message is None
    assert state.last_synced_at is not None

    profiles = list(db_session.scalars(select(DocumensoSignedProfile)))
    assert len(profiles) == 4
    assert all(profile.field_values == {"Department": f"Value {profile.documenso_doc_id}"} for profile in profiles)

    logs = list(
        db_session.scalars(
            select(DocumensoSyncLog).where(DocumensoSyncLog.log_type == "profile_sync")
        )
    )
    assert len(logs) == 1
    assert "synced=4 errors=0" in logs[0].message


def test_sync_old_employee_contract_documents_maps_pending_target_template(db_session, monkeypatch):
    profile = db_session.get(EmployeeProfile, "emp-001")
    draft_contract = EmployeeContract(
        id="old-employee-contract-draft",
        employee_profile_id=profile.id,
        title="Employment Agreement",
        status=ContractStatus.DRAFT,
        remarks="Awaiting HR contract assignment.",
        uploaded_by=profile.user_id,
    )
    db_session.add(draft_contract)
    db_session.commit()

    monkeypatch.setattr(
        "app.services.documenso_profiles.ds_client.list_documents",
        lambda **kwargs: {
            "data": [
                {
                    "id": 1421604,
                    "status": "PENDING",
                    "title": profiles_svc.OLD_EMPLOYEE_CONTRACT_TEMPLATE_TITLE,
                    "templateId": profiles_svc.OLD_EMPLOYEE_CONTRACT_TEMPLATE_ID,
                    "createdAt": "2026-06-08T11:02:04.129Z",
                    "recipients": [
                        {
                            "email": profile.ethara_email,
                            "name": profile.full_name,
                            "readStatus": "OPENED",
                            "signingStatus": "NOT_SIGNED",
                            "sendStatus": "SENT",
                        }
                    ],
                },
                {
                    "id": 1311820,
                    "status": "COMPLETED",
                    "title": "New 6M Internship Contracts & NDA-Ethara AI Remote",
                    "templateId": 999,
                    "recipients": [{"email": profile.ethara_email, "signingStatus": "SIGNED"}],
                },
            ],
            "totalPages": 1,
        },
    )
    monkeypatch.setattr(
        "app.services.documenso_profiles._download_signed_profile_pdf_url",
        lambda *args, **kwargs: "/uploads/contracts/documenso_profiles/1421604.pdf",
    )

    result = profiles_svc.sync_old_employee_contract_documents(db_session, max_pages=1)
    db_session.commit()

    assert result == {"processed": 2, "matched": 1, "updated": 1, "errors": 0}
    db_session.expire_all()
    refreshed = db_session.get(EmployeeContract, draft_contract.id)
    assert refreshed.title == profiles_svc.OLD_EMPLOYEE_CONTRACT_DISPLAY_TITLE
    assert refreshed.status == ContractStatus.VIEWED
    assert refreshed.file_url == "/uploads/contracts/documenso_profiles/1421604.pdf"
    assert "Documenso old employee contract document 1421604" in refreshed.remarks
