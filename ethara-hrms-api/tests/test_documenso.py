from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import select

from app.db.models import (
    Candidate,
    CandidateStage,
    Contract,
    ContractStatus,
    DocumensoSignedProfile,
    DocumensoTemplateCache,
    EmployeeProfile,
    SourceType,
    StageLog,
)
from app.services import documenso_sync as sync_svc


def test_send_contract_advances_candidate_stage(client, auth_headers, db_session, monkeypatch):
    candidate = Candidate(
        id="cand-doc-001",
        candidate_code="ETH-TEST-DOC001",
        full_name="Documenso Candidate",
        personal_email="documenso.candidate@example.com",
        phone="9876543299",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.SELECTION_FORM_VALIDATED,
        current_status="Selection Form Validated",
    )
    template = DocumensoTemplateCache(
        id="tpl-cache-001",
        template_id=12314,
        title="Senior Engineer Offer Letter",
        description="Offer letter template",
        fields=[],
        recipients=[],
    )
    db_session.add_all([candidate, template])
    db_session.commit()

    monkeypatch.setattr("app.api.routes.documenso._require_api_key", lambda: None)
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.map_candidate_fields",
        lambda *args, **kwargs: {},
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.create_document_from_template",
        lambda **kwargs: {"documentId": 8801, "token": "doc-token-123"},
    )
    monkeypatch.setattr("app.api.routes.documenso.ds_client.extract_document_id", lambda payload: 8801)
    monkeypatch.setattr("app.api.routes.documenso.ds_client.extract_signing_token", lambda payload: "doc-token-123")
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.build_signing_url",
        lambda token: f"https://sign.example.com/{token}",
    )

    response = client.post(
        f"/api/v1/documenso/contracts/{candidate.id}/send",
        json={"templateId": 12314, "sendImmediately": True},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "sent"
    assert body["templateId"] == 12314
    assert body["templateTitle"] == "Senior Engineer Offer Letter"
    assert body["documensoId"] == "8801"
    assert body["sentDocuments"] == [
        {
            "documensoId": "8801",
            "templateId": 12314,
            "templateTitle": "Senior Engineer Offer Letter",
            "signingUrl": "https://sign.example.com/doc-token-123",
            "status": "sent",
            "sentAt": body["sentDocuments"][0]["sentAt"],
            "primary": True,
        }
    ]

    db_session.expire_all()

    updated_candidate = db_session.get(Candidate, candidate.id)
    assert updated_candidate is not None
    assert updated_candidate.current_stage == CandidateStage.CONTRACT_SENT
    assert updated_candidate.current_status == "Contract Sent"

    contract = db_session.scalar(select(Contract).where(Contract.candidate_id == candidate.id))
    assert contract is not None
    assert contract.status == ContractStatus.SENT
    assert contract.documenso_id == "8801"

    stage_log = db_session.scalar(
        select(StageLog)
        .where(StageLog.candidate_id == candidate.id)
        .order_by(StageLog.created_at.desc())
    )
    assert stage_log is not None
    assert stage_log.from_stage == CandidateStage.SELECTION_FORM_VALIDATED
    assert stage_log.to_stage == CandidateStage.CONTRACT_SENT
    assert stage_log.notes == "Contract sent via Documenso."


def test_send_contract_allows_precreated_employee_profile(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    candidate = Candidate(
        id="cand-doc-precreated-employee",
        candidate_code="ETH-TEST-DOCPREEMP",
        employee_code="GRP1803",
        full_name="Precreated Profile Candidate",
        personal_email="precreated.profile@example.com",
        ethara_email="precreated.profile@ethara.ai",
        phone="9876543290",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.SELECTION_FORM_VALIDATED,
        current_status="Selection Form Validated",
    )
    profile = EmployeeProfile(
        id="emp-precreated-candidate",
        full_name=candidate.full_name,
        ethara_email=candidate.ethara_email,
        personal_email=candidate.personal_email,
        employee_code=candidate.employee_code,
        phone=candidate.phone,
        department="",
        designation="Generalist",
        gender="",
    )
    template = DocumensoTemplateCache(
        id="tpl-cache-precreated-employee",
        template_id=14473,
        title="29 GN Offer Letter, NDA & Employment Contract - Ethara Generalist 29th June 2026",
        description="Offer letter template",
        fields=[],
        recipients=[],
    )
    db_session.add_all([candidate, profile, template])
    db_session.commit()

    monkeypatch.setattr("app.api.routes.documenso._require_api_key", lambda: None)
    monkeypatch.setattr("app.api.routes.documenso.ds_client.map_candidate_fields", lambda *args, **kwargs: {})
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.create_document_from_template",
        lambda **kwargs: {"documentId": 8804, "token": "doc-token-8804"},
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.extract_document_id",
        lambda payload: 8804,
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.extract_signing_token",
        lambda payload: "doc-token-8804",
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.build_signing_url",
        lambda token: f"https://sign.example.com/{token}",
    )

    response = client.post(
        f"/api/v1/documenso/contracts/{candidate.id}/send",
        json={"templateId": 14473, "sendImmediately": True},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "sent"
    assert body["templateId"] == 14473
    assert body["documensoId"] == "8804"

    db_session.expire_all()
    updated_candidate = db_session.get(Candidate, candidate.id)
    assert updated_candidate is not None
    assert updated_candidate.current_stage == CandidateStage.CONTRACT_SENT


def test_send_contract_blocks_active_contract_resend(client, auth_headers, db_session, monkeypatch):
    candidate = Candidate(
        id="cand-doc-active-resend",
        candidate_code="ETH-TEST-DOCRESEND",
        full_name="Active Contract Candidate",
        personal_email="active.contract@example.com",
        phone="9876543296",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SENT,
        current_status="Contract Sent",
    )
    contract = Contract(
        id="ctr-doc-active-resend",
        candidate_id=candidate.id,
        status=ContractStatus.SENT,
        documenso_id="8802",
        signed_url="https://sign.example.com/doc-token-8802",
    )
    db_session.add_all([candidate, contract])
    db_session.commit()

    monkeypatch.setattr("app.api.routes.documenso._require_api_key", lambda: None)
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.create_document_from_template",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("should not create a duplicate document")),
    )

    response = client.post(
        f"/api/v1/documenso/contracts/{candidate.id}/send",
        json={"templateId": 12314, "sendImmediately": True},
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "This contract has already been sent. Use Check Status instead of sending another contract."
    )


def test_cancel_contract_unlocks_resend(client, auth_headers, db_session, monkeypatch):
    candidate = Candidate(
        id="cand-doc-cancel-resend",
        candidate_code="ETH-TEST-DOCCANCEL",
        full_name="Cancel Resend Candidate",
        personal_email="cancel.resend@example.com",
        phone="9876543294",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SENT,
        current_status="Contract Sent",
    )
    contract = Contract(
        id="ctr-doc-cancel-resend",
        candidate_id=candidate.id,
        status=ContractStatus.SENT,
        documenso_id="8802",
        template_id=12314,
        signed_url="https://sign.example.com/doc-token-8802",
        sent_documents=[
            {
                "documensoId": "8802",
                "templateId": 12314,
                "templateTitle": "Wrong Offer Letter",
                "signingUrl": "https://sign.example.com/doc-token-8802",
                "status": "sent",
                "sentAt": datetime.now(UTC).isoformat(),
                "primary": True,
            }
        ],
    )
    template = DocumensoTemplateCache(
        id="tpl-cache-cancel-resend",
        template_id=12315,
        title="Correct Offer Letter",
        description="Correct template",
        fields=[],
        recipients=[],
    )
    db_session.add_all([candidate, contract, template])
    db_session.commit()

    deleted: list[str] = []
    monkeypatch.setattr(
        "app.api.routes.documenso.get_settings",
        lambda: SimpleNamespace(documenso_api_key="api_test_key"),
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.get_document_with_fields",
        lambda document_id: {"id": document_id, "envelopeId": f"env-{document_id}"},
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.delete_document",
        lambda document_id: deleted.append(str(document_id)) or {"success": True},
    )

    cancel_response = client.post(
        f"/api/v1/documenso/contracts/{candidate.id}/cancel",
        json={"reason": "Wrong template"},
        headers=auth_headers,
    )

    assert cancel_response.status_code == 200
    cancel_body = cancel_response.json()
    assert cancel_body["status"] == "cancelled"
    assert cancel_body["signedUrl"] is None
    assert cancel_body["sentDocuments"][0]["status"] == "cancelled"
    assert deleted == ["env-8802"]

    db_session.expire_all()
    cancelled_candidate = db_session.get(Candidate, candidate.id)
    cancelled_contract = db_session.get(Contract, contract.id)
    assert cancelled_candidate.current_stage == CandidateStage.SELECTION_FORM_VALIDATED
    assert cancelled_candidate.current_status == "Selection Form Validated"
    assert cancelled_contract.status == ContractStatus.CANCELLED

    monkeypatch.setattr("app.api.routes.documenso._require_api_key", lambda: None)
    monkeypatch.setattr("app.api.routes.documenso.ds_client.map_candidate_fields", lambda *args, **kwargs: {})
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.create_document_from_template",
        lambda **kwargs: {"documentId": 8803, "token": "doc-token-8803"},
    )
    monkeypatch.setattr("app.api.routes.documenso.ds_client.extract_document_id", lambda payload: 8803)
    monkeypatch.setattr("app.api.routes.documenso.ds_client.extract_signing_token", lambda payload: "doc-token-8803")
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.build_signing_url",
        lambda token: f"https://sign.example.com/{token}",
    )

    resend_response = client.post(
        f"/api/v1/documenso/contracts/{candidate.id}/send",
        json={"templateId": 12315, "sendImmediately": True},
        headers=auth_headers,
    )

    assert resend_response.status_code == 200
    resend_body = resend_response.json()
    assert resend_body["status"] == "sent"
    assert resend_body["documensoId"] == "8803"
    assert resend_body["templateTitle"] == "Correct Offer Letter"


def test_candidate_list_includes_contract_summary(client, auth_headers, db_session):
    candidate = Candidate(
        id="cand-doc-002",
        candidate_code="ETH-TEST-DOC002",
        full_name="Contract Summary Candidate",
        personal_email="contract.summary@example.com",
        phone="9876543298",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SENT,
        current_status="Contract Sent",
    )
    contract = Contract(
        id="ctr-doc-002",
        candidate_id=candidate.id,
        status=ContractStatus.SENT,
        documenso_id="991122",
    )
    db_session.add_all([candidate, contract])
    db_session.commit()

    response = client.get(
        "/api/v1/candidates",
        params={"stage": "contract_sent", "limit": 20},
        headers=auth_headers,
    )

    assert response.status_code == 200
    records = response.json()["data"]
    row = next(item for item in records if item["id"] == candidate.id)
    assert row["contract"] is not None
    assert row["contract"]["status"] == "sent"
    assert row["contract"]["documensoId"] == "991122"


def test_webhook_nested_opened_updates_contract_status_immediately(db_session):
    candidate = Candidate(
        id="cand-doc-webhook-open",
        candidate_code="ETH-TEST-DOCWHOPEN",
        full_name="Webhook Open Candidate",
        personal_email="webhook.open@example.com",
        phone="9876543293",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SENT,
        current_status="Contract Sent",
    )
    contract = Contract(
        id="ctr-doc-webhook-open",
        candidate_id=candidate.id,
        status=ContractStatus.SENT,
        documenso_id="9900",
        sent_documents=[
            {
                "documensoId": "9900",
                "templateId": 12314,
                "templateTitle": "Offer Letter",
                "status": "sent",
                "sentAt": datetime.now(UTC).isoformat(),
                "primary": True,
            }
        ],
    )
    db_session.add_all([candidate, contract])
    db_session.commit()

    sync_svc.process_webhook_event(
        db_session,
        event="document.opened",
        doc_data={"document": {"id": 9900, "recipients": []}},
    )
    db_session.commit()

    db_session.expire_all()
    refreshed = db_session.get(Contract, contract.id)
    assert refreshed.status == ContractStatus.VIEWED
    assert refreshed.viewed_at is not None
    assert refreshed.sent_documents[0]["status"] == "viewed"


def test_webhook_nested_completed_marks_contract_signed_immediately(db_session, monkeypatch):
    completed_at = datetime.now(UTC)
    candidate = Candidate(
        id="cand-doc-webhook-complete",
        candidate_code="ETH-TEST-DOCWHDONE",
        full_name="Webhook Complete Candidate",
        personal_email="webhook.complete@example.com",
        phone="9876543292",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SENT,
        current_status="Contract Sent",
    )
    contract = Contract(
        id="ctr-doc-webhook-complete",
        candidate_id=candidate.id,
        status=ContractStatus.SENT,
        documenso_id="9901",
        sent_documents=[
            {
                "documensoId": "9901",
                "templateId": 12314,
                "templateTitle": "Offer Letter",
                "status": "sent",
                "sentAt": completed_at.isoformat(),
                "primary": True,
            }
        ],
    )
    db_session.add_all([candidate, contract])
    db_session.commit()

    monkeypatch.setattr(
        "app.services.documenso_sync.ds_client.download_document_pdf",
        lambda document_id: b"%PDF-1.4 signed contract",
    )
    monkeypatch.setattr(
        "app.services.documenso_sync.ds_client.get_envelope_items_for_document",
        lambda document_id: (None, []),
    )

    sync_svc.process_webhook_event(
        db_session,
        event="document.completed",
        doc_data={
            "document": {
                "id": 9901,
                "status": "COMPLETED",
                "completedAt": completed_at.isoformat(),
                "recipients": [],
                "fields": [],
            }
        },
    )
    db_session.commit()

    db_session.expire_all()
    refreshed_candidate = db_session.get(Candidate, candidate.id)
    refreshed_contract = db_session.get(Contract, contract.id)
    assert refreshed_candidate.current_stage == CandidateStage.CONTRACT_SIGNED
    assert refreshed_contract.status == ContractStatus.SIGNED
    assert refreshed_contract.pdf_url
    assert refreshed_contract.sent_documents[0]["status"] == "signed"


def test_refresh_contract_status_reconciles_signed_profile_after_resend(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    completed_at = datetime.now(UTC)
    candidate = Candidate(
        id="cand-doc-reconcile-signed",
        candidate_code="ETH-TEST-DOCREC",
        full_name="Reconciled Signed Candidate",
        personal_email="reconciled.signed@example.com",
        phone="9876543295",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SENT,
        current_status="Contract Sent",
    )
    contract = Contract(
        id="ctr-doc-reconcile-signed",
        candidate_id=candidate.id,
        status=ContractStatus.SENT,
        documenso_id="9902",
        signed_url="https://sign.example.com/latest-unsiged",
    )
    signed_profile = DocumensoSignedProfile(
        id="signed-prof-reconcile",
        documenso_doc_id=9901,
        template_id=12314,
        template_title="Offer Letter",
        recipient_email=candidate.personal_email,
        recipient_name=candidate.full_name,
        completed_at=completed_at,
        candidate_id=candidate.id,
    )
    db_session.add_all([candidate, contract, signed_profile])
    db_session.commit()

    monkeypatch.setattr("app.api.routes.documenso._require_api_key", lambda: None)

    def fake_get_document_with_fields(document_id: int):
        if document_id == 9902:
            return {"id": 9902, "status": "PENDING", "recipients": [], "fields": []}
        if document_id == 9901:
            return {
                "id": 9901,
                "status": "COMPLETED",
                "completedAt": completed_at.isoformat(),
                "recipients": [
                    {
                        "email": candidate.personal_email,
                        "name": candidate.full_name,
                        "signingStatus": "SIGNED",
                    }
                ],
                "fields": [],
            }
        raise AssertionError(f"unexpected document id {document_id}")

    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.get_document_with_fields",
        fake_get_document_with_fields,
    )
    monkeypatch.setattr(
        "app.services.documenso_sync.ds_client.download_document_pdf",
        lambda document_id: b"%PDF-1.4 signed contract",
    )
    monkeypatch.setattr(
        "app.services.documenso_sync.ds_client.get_envelope_items_for_document",
        lambda document_id: (None, []),
    )

    response = client.post(
        f"/api/v1/documenso/contracts/{candidate.id}/refresh",
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "signed"
    assert body["documensoId"] == "9901"
    assert body["pdfUrl"]

    db_session.expire_all()
    refreshed_candidate = db_session.get(Candidate, candidate.id)
    refreshed_contract = db_session.get(Contract, contract.id)
    assert refreshed_candidate.current_stage == CandidateStage.CONTRACT_SIGNED
    assert refreshed_candidate.current_status == "Contract Signed"
    assert refreshed_contract.status == ContractStatus.SIGNED
    assert refreshed_contract.documenso_id == "9901"


def test_refresh_signed_contract_backfills_missing_employee_code(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    candidate = Candidate(
        id="cand-doc-employee-code",
        candidate_code="ETH-TEST-DOCEMP",
        full_name="Signed Employee Code Candidate",
        personal_email="signed.employee.code@example.com",
        phone="9876543297",
        source_type=SourceType.DIRECT_APPLICATION,
        current_stage=CandidateStage.CONTRACT_SIGNED,
        current_status="Contract Signed",
    )
    contract = Contract(
        id="ctr-doc-employee-code",
        candidate_id=candidate.id,
        status=ContractStatus.SIGNED,
        documenso_id="992244",
        pdf_url="/uploads/contracts/cand-doc-employee-code/992244.pdf",
    )
    db_session.add_all([candidate, contract])
    db_session.commit()

    monkeypatch.setattr("app.api.routes.documenso._require_api_key", lambda: None)
    monkeypatch.setattr(
        "app.services.documenso_sync.get_settings",
        lambda: SimpleNamespace(auto_employee_provisioning=True),
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.get_document_with_fields",
        lambda document_id: {
            "id": document_id,
            "status": "COMPLETED",
            "recipients": [],
            "fields": [],
        },
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.profiles_svc.sync_profile_document",
        lambda db, document_id: None,
    )

    response = client.post(
        f"/api/v1/documenso/contracts/{candidate.id}/refresh",
        headers=auth_headers,
    )

    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.get(Candidate, candidate.id).employee_code == "GRP1001"


def test_trigger_profile_sync_starts_inline_background_runner_in_development(client, auth_headers, monkeypatch):
    calls = []

    monkeypatch.setattr("app.api.routes.documenso._require_api_key", lambda: None)
    monkeypatch.setattr("app.api.routes.documenso._documenso_run_inline", lambda: True)
    monkeypatch.setattr(
        "app.api.routes.documenso._run_signed_profiles_sync_background",
        lambda trigger="manual": calls.append(trigger),
    )

    response = client.post("/api/v1/documenso/signed-profiles/sync", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["message"] == "Profile sync started — processing in background"
    assert calls == ["manual"]


def test_get_signed_profile_open_url_returns_working_documenso_link(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    profile = DocumensoSignedProfile(
        id="signed-prof-open-001",
        documenso_doc_id=1332362,
        recipient_email="signed.candidate@example.com",
        recipient_name="Signed Candidate",
        template_title="Offer Letter",
    )
    db_session.add(profile)
    db_session.commit()

    monkeypatch.setattr("app.api.routes.documenso._require_api_key", lambda: None)
    def fake_sync_profile_document(db, document_id):
        assert document_id == 1332362
        profile.field_values = {"Department": "Engineering"}
        db.add(profile)
        return profile, {"id": document_id}

    monkeypatch.setattr(
        "app.api.routes.documenso.profiles_svc.sync_profile_document",
        fake_sync_profile_document,
    )
    monkeypatch.setattr(
        "app.api.routes.documenso.ds_client.build_document_view_url",
        lambda document_id: f"https://app.documenso.com/documents/{document_id}",
    )

    response = client.get(
        f"/api/v1/documenso/signed-profiles/{profile.id}/open-url",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"url": "https://app.documenso.com/documents/1332362"}

    db_session.expire_all()
    refreshed_profile = db_session.get(DocumensoSignedProfile, profile.id)
    assert refreshed_profile is not None
    assert refreshed_profile.field_values == {"Department": "Engineering"}
