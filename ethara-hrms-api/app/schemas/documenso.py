from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field, field_validator

from app.db.models import CandidateStage
from app.schemas.common import ORMModel, PaginatedResponse
from app.schemas.resources import PositionRead


def _sign_uploads_pdf(value: str | None) -> str | None:
    """Turn a stored '/uploads/...' contract PDF path into a signed, login-free URL so a
    browser <a download> works for both staff and the candidate (who has no auth token)."""
    if value and value.startswith("/uploads/"):
        from app.core.signed_urls import make_signed_upload_url

        return make_signed_upload_url(value, absolute=False)
    return value


class DocumensoTemplateFieldSchema(ORMModel):
    id: int
    type: str
    label: str | None = None
    page: int | None = None
    required: bool = False


class DocumensoTemplateRecipientSchema(ORMModel):
    id: int
    name: str
    email: str
    role: str = "SIGNER"


class TemplateCacheRead(ORMModel):
    id: str
    template_id: int = Field(alias="templateId")
    title: str
    description: str | None = None
    fields: list[Any] | None = None
    recipients: list[Any] | None = None
    synced_at: datetime = Field(alias="syncedAt")


class SendContractRequest(ORMModel):
    # Either a single template or several at once: every selected template is issued
    # as its own Documenso document in one request. The first one is the primary
    # contract the Contract row tracks (documenso_id / signing url).
    template_id: int | None = Field(alias="templateId", default=None)
    template_ids: list[int] | None = Field(alias="templateIds", default=None)
    ctc: float | None = None
    joining_date: datetime | None = Field(alias="joiningDate", default=None)
    extra_fields: dict[str, str] | None = Field(alias="extraFields", default=None)
    send_immediately: bool = Field(alias="sendImmediately", default=True)


class BulkSendContractRequest(ORMModel):
    candidate_ids: list[str] = Field(alias="candidateIds")
    template_id: int | None = Field(alias="templateId", default=None)
    template_ids: list[int] | None = Field(alias="templateIds", default=None)
    ctc: float | None = None
    joining_date: datetime | None = Field(alias="joiningDate", default=None)
    send_immediately: bool = Field(alias="sendImmediately", default=True)


class CancelContractRequest(ORMModel):
    reason: str | None = None
    # Explicit opt-in to cancel an already-SIGNED contract so it can be replaced. Default
    # False keeps the safe behaviour (signed contracts are protected) unchanged.
    force: bool = False


class ContractRead(ORMModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    status: str
    documenso_id: str | None = Field(alias="documensoId", default=None)
    template_id: int | None = Field(alias="templateId", default=None)
    template_title: str | None = Field(alias="templateTitle", default=None)
    signed_url: str | None = Field(alias="signedUrl", default=None)
    pdf_url: str | None = Field(alias="pdfUrl", default=None)
    sent_at: datetime | None = Field(alias="sentAt", default=None)
    viewed_at: datetime | None = Field(alias="viewedAt", default=None)
    signed_at: datetime | None = Field(alias="signedAt", default=None)
    expires_at: datetime | None = Field(alias="expiresAt", default=None)
    ctc: float | None = None
    joining_date: datetime | None = Field(alias="joiningDate", default=None)
    sent_documents: list[dict[str, Any]] | None = Field(alias="sentDocuments", default=None)
    # Each bundled signed PDF in the Documenso envelope (Offer Letter, NDA, Employment
    # Agreement): [{itemId, title, order, type, url}]. URLs are signed for browser access.
    signed_items: list[dict[str, Any]] | None = Field(alias="signedItems", default=None)
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    _sign_pdf = field_validator("pdf_url", mode="after")(_sign_uploads_pdf)

    @field_validator("signed_items", mode="after")
    @classmethod
    def _sign_signed_items(cls, value: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
        if not value:
            return value
        signed: list[dict[str, Any]] = []
        for item in value:
            entry = {k: item.get(k) for k in ("itemId", "title", "order", "type")}
            entry["url"] = _sign_uploads_pdf(item.get("url"))
            signed.append(entry)
        signed.sort(key=lambda i: i.get("order") or 0)
        return signed


class ContractFieldRead(ORMModel):
    id: str
    contract_id: str = Field(alias="contractId")
    field_name: str = Field(alias="fieldName")
    field_type: str = Field(alias="fieldType")
    field_value: str | None = Field(alias="fieldValue", default=None)
    recipient_email: str | None = Field(alias="recipientEmail", default=None)
    created_at: datetime = Field(alias="createdAt")


class SyncStateRead(ORMModel):
    id: str
    last_synced_at: datetime | None = Field(alias="lastSyncedAt", default=None)
    last_document_id: int | None = Field(alias="lastDocumentId", default=None)
    sync_status: str = Field(alias="syncStatus")
    error_message: str | None = Field(alias="errorMessage", default=None)
    documents_processed: int = Field(alias="documentsProcessed")
    updated_at: datetime = Field(alias="updatedAt")


class SyncLogRead(ORMModel):
    id: str
    log_type: str = Field(alias="logType")
    status: str
    message: str
    document_id: int | None = Field(alias="documentId", default=None)
    candidate_id: str | None = Field(alias="candidateId", default=None)
    extra: dict[str, Any] | None = None
    created_at: datetime = Field(alias="createdAt")


SyncLogListResponse = PaginatedResponse[SyncLogRead]


class WebhookRecipient(ORMModel):
    id: int | None = None
    email: str
    name: str
    role: str = "SIGNER"
    signing_status: str = Field(alias="signingStatus", default="NOT_SIGNED")
    signed_at: datetime | None = Field(alias="signedAt", default=None)
    token: str | None = None


class WebhookField(ORMModel):
    id: int
    type: str
    label: str | None = None
    value: str | None = None
    recipient_email: str | None = Field(alias="recipientEmail", default=None)


class DocumensoWebhookPayload(ORMModel):
    event: str
    created_at: datetime | None = Field(alias="createdAt", default=None)
    data: dict[str, Any] = Field(default_factory=dict)


class SignedProfileCandidateRead(ORMModel):
    id: str
    candidate_code: str = Field(alias="candidateCode")
    full_name: str = Field(alias="fullName")
    personal_email: str = Field(alias="personalEmail")
    ethara_email: str | None = Field(alias="etharaEmail", default=None)
    phone: str
    current_stage: CandidateStage = Field(alias="currentStage")
    current_status: str = Field(alias="currentStatus")
    position: PositionRead | None = None


class SignedProfileRead(ORMModel):
    id: str
    documenso_doc_id: int = Field(alias="documensoDocId")
    template_id: int | None = Field(alias="templateId", default=None)
    template_title: str | None = Field(alias="templateTitle", default=None)
    recipient_email: str = Field(alias="recipientEmail")
    recipient_name: str | None = Field(alias="recipientName", default=None)
    completed_at: datetime | None = Field(alias="completedAt", default=None)
    field_values: dict[str, Any] | None = Field(alias="fieldValues", default=None)
    pdf_url: str | None = Field(alias="pdfUrl", default=None)
    candidate_id: str | None = Field(alias="candidateId", default=None)
    candidate: SignedProfileCandidateRead | None = None
    synced_at: datetime = Field(alias="syncedAt")
    created_at: datetime = Field(alias="createdAt")


SignedProfileListResponse = PaginatedResponse[SignedProfileRead]


class SignedProfileOpenUrlRead(ORMModel):
    url: str


class ProfileSyncStateRead(ORMModel):
    id: str
    sync_status: str = Field(alias="syncStatus")
    last_synced_at: datetime | None = Field(alias="lastSyncedAt", default=None)
    last_document_id: int | None = Field(alias="lastDocumentId", default=None)
    documents_processed: int = Field(alias="documentsProcessed")
    updated_at: datetime = Field(alias="updatedAt")


class SyncJobRunRead(ORMModel):
    id: str
    job_name: str = Field(alias="jobName")
    trigger: str
    status: str
    started_at: datetime = Field(alias="startedAt")
    finished_at: datetime | None = Field(alias="finishedAt", default=None)
    duration_seconds: int | None = Field(alias="durationSeconds", default=None)
    documents_processed: int = Field(alias="documentsProcessed")
    errors: int
    message: str | None = None
