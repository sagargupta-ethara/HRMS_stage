from datetime import datetime
from typing import Any

from pydantic import Field, field_validator

from app.db.models import ContractStatus, EscalationStatus, NotificationType
from app.schemas.common import ORMModel, PaginatedResponse, TimestampedModel


def _sign_uploads_pdf(value: str | None) -> str | None:
    """Sign a stored '/uploads/...' contract PDF path so a browser download works without auth."""
    if value and value.startswith("/uploads/"):
        from app.core.signed_urls import make_signed_upload_url

        return make_signed_upload_url(value, absolute=False)
    return value


class NotificationRead(ORMModel):
    id: str
    user_id: str = Field(alias="userId")
    candidate_id: str | None = Field(alias="candidateId", default=None)
    title: str
    message: str
    type: NotificationType
    is_read: bool = Field(alias="isRead")
    entity_type: str | None = Field(alias="entityType", default=None)
    entity_id: str | None = Field(alias="entityId", default=None)
    payload: dict[str, Any] | None = None
    created_at: datetime = Field(alias="createdAt")
    candidate_name: str | None = Field(alias="candidateName", default=None)
    route: str | None = None


class EscalationRead(TimestampedModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    stage: str
    responsible_user_id: str = Field(alias="responsibleUserId")
    sla_deadline: datetime = Field(alias="slaDeadline")
    delayed_by: str = Field(alias="delayedBy")
    escalation_level: int = Field(alias="escalationLevel")
    status: EscalationStatus
    email_sent_at: datetime | None = Field(alias="emailSentAt", default=None)
    resolved_at: datetime | None = Field(alias="resolvedAt", default=None)
    resolved_by: str | None = Field(alias="resolvedBy", default=None)
    notes: str | None = None
    candidate_name: str | None = Field(alias="candidateName", default=None)
    responsible_name: str | None = Field(alias="responsibleName", default=None)
    candidate: dict | None = None
    responsible_user: dict | None = Field(alias="responsibleUser", default=None)


class EscalationActionRequest(ORMModel):
    notes: str | None = None


class DocumentRead(TimestampedModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    type: str
    file_name: str = Field(alias="fileName")
    file_url: str = Field(alias="fileUrl")
    file_size: int | None = Field(alias="fileSize", default=None)
    mime_type: str | None = Field(alias="mimeType", default=None)
    status: str
    verified_by: str | None = Field(alias="verifiedBy", default=None)
    verified_at: datetime | None = Field(alias="verifiedAt", default=None)
    ocr_status: str = Field(alias="ocrStatus")
    ocr_provider: str | None = Field(alias="ocrProvider", default=None)
    extracted_data: dict[str, Any] | None = Field(alias="extractedData", default=None)
    llm_extracted_data: dict[str, Any] | None = Field(alias="llmExtractedData", default=None)


class DocumentVerifyRequest(ORMModel):
    status: str


class ITRequestRead(TimestampedModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    requested_by: str = Field(alias="requestedBy")
    assigned_to_id: str | None = Field(alias="assignedToId", default=None)
    suggested_email: str = Field(alias="suggestedEmail")
    created_email: str | None = Field(alias="createdEmail", default=None)
    status: str
    completed_at: datetime | None = Field(alias="completedAt", default=None)
    candidate_name: str | None = Field(alias="candidateName", default=None)
    candidate_personal_email: str | None = Field(alias="candidatePersonalEmail", default=None)


class ITRequestCompleteRequest(ORMModel):
    created_email: str = Field(alias="createdEmail")


class AuditLogRead(ORMModel):
    id: str
    entity_type: str = Field(alias="entityType")
    entity_id: str = Field(alias="entityId")
    action: str
    performed_by: str = Field(alias="performedBy")
    performed_by_name: str | None = Field(alias="performedByName", default=None)
    performed_by_role: str | None = Field(alias="performedByRole", default=None)
    candidate_id: str | None = Field(alias="candidateId", default=None)
    user_id: str | None = Field(alias="userId", default=None)
    ip_address: str | None = Field(alias="ipAddress", default=None)
    user_agent: str | None = Field(alias="userAgent", default=None)
    old_value: dict | None = Field(alias="oldValue", default=None)
    new_value: dict | None = Field(alias="newValue", default=None)
    created_at: datetime = Field(alias="createdAt")


class AuditLogListResponse(PaginatedResponse[AuditLogRead]):
    pass


class EvaluationRead(TimestampedModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    evaluator_id: str = Field(alias="evaluatorId")
    technical_skills: int | None = Field(alias="technicalSkills", default=None)
    communication: int | None = None
    problem_solving: int | None = Field(alias="problemSolving", default=None)
    cultural_fit: int | None = Field(alias="culturalFit", default=None)
    attitude: int | None = None
    total_score: float | None = Field(alias="totalScore", default=None)
    recommendation: str | None = None
    notes: str | None = None
    completed_at: datetime | None = Field(alias="completedAt", default=None)
    # Interview scheduling
    interview_subject: str | None = Field(alias="interviewSubject", default=None)
    interview_scheduled_at: datetime | None = Field(alias="interviewScheduledAt", default=None)
    interview_status: str | None = Field(alias="interviewStatus", default=None)
    interview_notes: str | None = Field(alias="interviewNotes", default=None)
    interview_mode: str | None = Field(alias="interviewMode", default=None)
    pi_score: float | None = Field(alias="piScore", default=None)
    pms_score: float | None = Field(alias="pmsScore", default=None)
    pi_rounds: list["PiInterviewRoundRead"] = Field(alias="piRounds", default_factory=list)
    # Nested
    candidate: dict | None = None
    evaluator: dict | None = None


class EvaluationCreateRequest(ORMModel):
    candidate_id: str = Field(alias="candidateId")
    evaluator_id: str | None = Field(alias="evaluatorId", default=None)


class EvaluationSubmitRequest(ORMModel):
    technical_skills: int | None = Field(alias="technicalSkills", default=None)
    communication: int | None = None
    problem_solving: int | None = Field(alias="problemSolving", default=None)
    cultural_fit: int | None = Field(alias="culturalFit", default=None)
    attitude: int | None = None
    total_score: float | None = Field(alias="totalScore", default=None)
    recommendation: str | None = None
    notes: str | None = None


class InterviewScheduleRequest(ORMModel):
    subject: str
    scheduled_at: datetime = Field(alias="scheduledAt")
    notes: str | None = None
    mode: str | None = None
    duration_minutes: int = Field(alias="durationMinutes", default=60)
    round_number: int | None = Field(alias="roundNumber", default=None)
    evaluator_id: str | None = Field(alias="evaluatorId", default=None)
    panel_label: str | None = Field(alias="panelLabel", default=None)
    panel_members: list[str] | None = Field(alias="panelMembers", default=None)


class InterviewCompleteRequest(ORMModel):
    decision: str
    round_id: str | None = Field(alias="roundId", default=None)
    round_number: int | None = Field(alias="roundNumber", default=None)
    notes: str | None = None
    pi_score: float | None = Field(alias="piScore", default=None)
    no_further_pi_required: bool = Field(alias="noFurtherPiRequired", default=False)
    final_verdict: str | None = Field(alias="finalVerdict", default=None)


class PiBypassRequest(ORMModel):
    final_verdict: str = Field(alias="finalVerdict")
    notes: str | None = None
    pi_score: float | None = Field(alias="piScore", default=None)


class PiInterviewRoundRead(TimestampedModel):
    id: str
    evaluation_id: str = Field(alias="evaluationId")
    candidate_id: str = Field(alias="candidateId")
    evaluator_id: str | None = Field(alias="evaluatorId", default=None)
    round_number: int = Field(alias="roundNumber")
    panel_label: str | None = Field(alias="panelLabel", default=None)
    subject: str | None = None
    scheduled_at: datetime | None = Field(alias="scheduledAt", default=None)
    completed_at: datetime | None = Field(alias="completedAt", default=None)
    status: str
    mode: str | None = None
    duration_minutes: int = Field(alias="durationMinutes", default=60)
    score: float | None = None
    remarks: str | None = None
    round_decision: str | None = Field(alias="roundDecision", default=None)
    no_further_pi_required: bool = Field(alias="noFurtherPiRequired", default=False)
    final_verdict: str | None = Field(alias="finalVerdict", default=None)
    panel_members: list[str] | None = Field(alias="panelMembers", default=None)
    evaluator_name: str | None = Field(alias="evaluatorName", default=None)


class EvaluationPmsScoreUpdateRequest(ORMModel):
    pms_score: float = Field(alias="pmsScore")


class CandidateIdCardFormRead(ORMModel):
    id: str | None = None
    candidate_id: str = Field(alias="candidateId")
    name: str | None = None
    employee_id: str | None = Field(alias="employeeId", default=None)
    blood_group: str | None = Field(alias="bloodGroup", default=None)
    emergency_no: str | None = Field(alias="emergencyNo", default=None)
    submitted_at: datetime | None = Field(alias="submittedAt", default=None)
    submitted_by: str | None = Field(alias="submittedBy", default=None)
    it_completed_at: datetime | None = Field(alias="itCompletedAt", default=None)
    it_completed_by: str | None = Field(alias="itCompletedBy", default=None)
    created_at: datetime | None = Field(alias="createdAt", default=None)
    updated_at: datetime | None = Field(alias="updatedAt", default=None)


class CandidateIdCardFormSubmitRequest(ORMModel):
    name: str
    # System-generated; accepted for backwards-compatibility but ignored server-side.
    employee_id: str | None = Field(alias="employeeId", default=None)
    blood_group: str = Field(alias="bloodGroup")
    emergency_no: str = Field(alias="emergencyNo")


class CandidateIdCardQueueItemRead(ORMModel):
    candidate_id: str = Field(alias="candidateId")
    candidate_name: str = Field(alias="candidateName")
    personal_email: str | None = Field(alias="personalEmail", default=None)
    ethara_email: str | None = Field(alias="etharaEmail", default=None)
    current_stage: str | None = Field(alias="currentStage", default=None)
    current_status: str | None = Field(alias="currentStatus", default=None)
    designation: str | None = None
    photo_url: str | None = Field(alias="photoUrl", default=None)
    name: str | None = None
    employee_id: str | None = Field(alias="employeeId", default=None)
    blood_group: str | None = Field(alias="bloodGroup", default=None)
    emergency_no: str | None = Field(alias="emergencyNo", default=None)
    submitted_at: datetime | None = Field(alias="submittedAt", default=None)
    submitted_by: str | None = Field(alias="submittedBy", default=None)
    it_completed_at: datetime | None = Field(alias="itCompletedAt", default=None)
    it_completed_by: str | None = Field(alias="itCompletedBy", default=None)
    status: str
    can_mark_done: bool = Field(alias="canMarkDone")


class CandidateIdCardBatchCompleteRequest(ORMModel):
    candidate_ids: list[str] = Field(alias="candidateIds")


class CandidateIdCardBatchCompleteResponse(ORMModel):
    updated_count: int = Field(alias="updatedCount")
    updated_candidate_ids: list[str] = Field(alias="updatedCandidateIds")


class SelectionFormRead(TimestampedModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    sent_at: datetime | None = Field(alias="sentAt", default=None)
    submitted_at: datetime | None = Field(alias="submittedAt", default=None)
    validated_at: datetime | None = Field(alias="validatedAt", default=None)
    form_data: dict[str, Any] | None = Field(alias="formData", default=None)
    verification_status: str | None = Field(alias="verificationStatus", default=None)
    verification_message: str | None = Field(alias="verificationMessage", default=None)
    verification_task_id: str | None = Field(alias="verificationTaskId", default=None)
    verification_queued_at: str | None = Field(alias="verificationQueuedAt", default=None)
    verification_started_at: str | None = Field(alias="verificationStartedAt", default=None)
    verification_completed_at: str | None = Field(alias="verificationCompletedAt", default=None)
    verification_required_documents: int = Field(alias="verificationRequiredDocuments", default=0)
    verification_submitted_documents: int = Field(alias="verificationSubmittedDocuments", default=0)
    verification_missing_documents: int = Field(alias="verificationMissingDocuments", default=0)


class SelectionFormSubmitRequest(ORMModel):
    form_data: dict[str, Any] = Field(alias="formData")


class ContractRead(TimestampedModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    status: ContractStatus
    documenso_id: str | None = Field(alias="documensoId", default=None)
    template_id: int | None = Field(alias="templateId", default=None)
    signed_url: str | None = Field(alias="signedUrl", default=None)
    pdf_url: str | None = Field(alias="pdfUrl", default=None)
    sent_at: datetime | None = Field(alias="sentAt", default=None)
    viewed_at: datetime | None = Field(alias="viewedAt", default=None)
    signed_at: datetime | None = Field(alias="signedAt", default=None)
    expires_at: datetime | None = Field(alias="expiresAt", default=None)
    ctc: float | None = None
    joining_date: datetime | None = Field(alias="joiningDate", default=None)
    # Each bundled signed PDF in the Documenso envelope (Offer Letter, NDA, Employment
    # Agreement): [{itemId, title, order, type, url}]. URLs are signed for browser access.
    signed_items: list[dict[str, Any]] | None = Field(alias="signedItems", default=None)

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


class ContractUpdateRequest(ORMModel):
    status: ContractStatus | None = None
    signed_url: str | None = Field(alias="signedUrl", default=None)
    ctc: float | None = None
    joining_date: datetime | None = Field(alias="joiningDate", default=None)
    expires_at: datetime | None = Field(alias="expiresAt", default=None)


class ComplianceFormRead(TimestampedModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    form_type: str = Field(alias="formType")
    form_title: str = Field(alias="formTitle")
    status: str
    form_data: dict[str, Any] | None = Field(alias="formData", default=None)
    submitted_at: datetime | None = Field(alias="submittedAt", default=None)
    verified_at: datetime | None = Field(alias="verifiedAt", default=None)
    documenso_id: str | None = Field(alias="documensoId", default=None)
    signed_url: str | None = Field(alias="signedUrl", default=None)
    pdf_url: str | None = Field(alias="pdfUrl", default=None)
    sent_at: datetime | None = Field(alias="sentAt", default=None)
    signed_at: datetime | None = Field(alias="signedAt", default=None)

    _sign_pdf = field_validator("pdf_url", mode="after")(_sign_uploads_pdf)


class ComplianceFormSubmitRequest(ORMModel):
    form_data: dict[str, Any] = Field(alias="formData")


class ComplianceFormDraftRequest(ORMModel):
    form_data: dict[str, Any] = Field(alias="formData")


class ManualScreeningRequest(ORMModel):
    job_description: str | None = Field(alias="jobDescription", default=None)


class ScreeningResumeDocumentRead(ORMModel):
    id: str
    type: str
    file_name: str = Field(alias="fileName")
    mime_type: str | None = Field(alias="mimeType", default=None)
    status: str
    uploaded_at: datetime | None = Field(alias="uploadedAt", default=None)


class ScreeningRecordRead(ORMModel):
    candidate_id: str = Field(alias="candidateId")
    candidate_code: str = Field(alias="candidateCode")
    candidate_name: str = Field(alias="candidateName")
    personal_email: str = Field(alias="personalEmail")
    phone: str | None = None
    position_id: str | None = Field(alias="positionId", default=None)
    position_title: str | None = Field(alias="positionTitle", default=None)
    current_stage: str = Field(alias="currentStage")
    current_status: str = Field(alias="currentStatus")
    screening_status: str = Field(alias="screeningStatus")
    llm_status: str | None = Field(alias="llmStatus", default=None)
    screening_score: float | None = Field(alias="screeningScore", default=None)
    match_score: float | None = Field(alias="matchScore", default=None)
    recommendation: str | None = None
    screening_summary: str | None = Field(alias="screeningSummary", default=None)
    parsed_resume_details: dict[str, Any] | None = Field(alias="parsedResumeDetails", default=None)
    screening_payload: dict[str, Any] | None = Field(alias="screeningPayload", default=None)
    manual_override: dict[str, Any] | None = Field(alias="manualOverride", default=None)
    resume_uploaded_at: datetime | None = Field(alias="resumeUploadedAt", default=None)
    last_screened_at: datetime | None = Field(alias="lastScreenedAt", default=None)
    updated_at: datetime | None = Field(alias="updatedAt", default=None)
    created_at: datetime | None = Field(alias="createdAt", default=None)
    resume_document: ScreeningResumeDocumentRead | None = Field(alias="resumeDocument", default=None)


class ScreeningListResponse(PaginatedResponse[ScreeningRecordRead]):
    pass


class ScreeningOverrideRequest(ORMModel):
    recommendation: str
    reason: str


class EmployeeSelectionFormSubmitRequest(ORMModel):
    form_data: dict[str, Any] = Field(alias="formData")


class EmployeeComplianceReviewRequest(ORMModel):
    status: str
    remarks: str | None = None


class EmployeeReferralCreateRequest(ORMModel):
    full_name: str = Field(alias="fullName")
    personal_email: str = Field(alias="personalEmail")
    phone: str
    linkedin_url: str | None = Field(alias="linkedinUrl", default=None)
    portfolio_url: str | None = Field(alias="portfolioUrl", default=None)
    github_url: str | None = Field(alias="githubUrl", default=None)
    # Retained for backward-compat; referrals now land in the dropbox, not a role.
    position_id: str | None = Field(alias="positionId", default=None)


class EmployeeDocumentRead(ORMModel):
    id: str
    type: str
    label: str
    file_name: str | None = Field(alias="fileName", default=None)
    mime_type: str | None = Field(alias="mimeType", default=None)
    uploaded_at: datetime | None = Field(alias="uploadedAt", default=None)
    verification_status: str = Field(alias="verificationStatus")
    remarks: str | None = None
    # AI document-type verification (Vertex AI). needs_review=True when the upload
    # did not match its expected type; verification holds the full verdict.
    ocr_status: str | None = Field(alias="ocrStatus", default=None)
    needs_review: bool = Field(alias="needsReview", default=False)
    verification: dict[str, Any] | None = None
    missing: bool = False
    can_preview: bool = Field(alias="canPreview")
    preview_endpoint: str | None = Field(alias="previewEndpoint", default=None)
    download_endpoint: str | None = Field(alias="downloadEndpoint", default=None)


class EmployeeSelectionFormRead(ORMModel):
    id: str | None = None
    status: str
    form_data: dict[str, Any] | None = Field(alias="formData", default=None)
    edit_access_enabled: bool = Field(alias="editAccessEnabled", default=True)
    submitted_at: datetime | None = Field(alias="submittedAt", default=None)
    reviewed_at: datetime | None = Field(alias="reviewedAt", default=None)
    reviewed_by: str | None = Field(alias="reviewedBy", default=None)
    remarks: str | None = None
    created_at: datetime | None = Field(alias="createdAt", default=None)
    updated_at: datetime | None = Field(alias="updatedAt", default=None)


class EmployeeContractRead(ORMModel):
    id: str
    title: str
    status: str
    file_name: str | None = Field(alias="fileName", default=None)
    file_url: str | None = Field(alias="fileUrl", default=None)
    mime_type: str | None = Field(alias="mimeType", default=None)
    issued_at: datetime | None = Field(alias="issuedAt", default=None)
    completed_at: datetime | None = Field(alias="completedAt", default=None)
    remarks: str | None = None
    created_at: datetime | None = Field(alias="createdAt", default=None)
    updated_at: datetime | None = Field(alias="updatedAt", default=None)
    can_preview: bool = Field(alias="canPreview")
    preview_endpoint: str | None = Field(alias="previewEndpoint", default=None)
    download_endpoint: str | None = Field(alias="downloadEndpoint", default=None)


class EmployeeComplianceFormRead(ORMModel):
    id: str
    form_type: str = Field(alias="formType")
    form_title: str = Field(alias="formTitle")
    status: str
    form_data: dict[str, Any] | None = Field(alias="formData", default=None)
    submitted_at: datetime | None = Field(alias="submittedAt", default=None)
    verified_at: datetime | None = Field(alias="verifiedAt", default=None)
    reviewed_by: str | None = Field(alias="reviewedBy", default=None)
    remarks: str | None = None
    documenso_id: str | None = Field(alias="documensoId", default=None)
    signed_url: str | None = Field(alias="signedUrl", default=None)
    pdf_url: str | None = Field(alias="pdfUrl", default=None)
    sent_at: datetime | None = Field(alias="sentAt", default=None)
    signed_at: datetime | None = Field(alias="signedAt", default=None)
    created_at: datetime | None = Field(alias="createdAt", default=None)
    updated_at: datetime | None = Field(alias="updatedAt", default=None)


class EmployeeReferralActivityRead(ORMModel):
    candidate_id: str = Field(alias="candidateId")
    candidate_name: str = Field(alias="candidateName")
    position_title: str | None = Field(alias="positionTitle", default=None)
    current_stage: str = Field(alias="currentStage")
    current_status: str = Field(alias="currentStatus")
    created_at: datetime = Field(alias="createdAt")


class EmployeeTimelineEventRead(ORMModel):
    id: str
    title: str
    description: str | None = None
    status: str
    occurred_at: datetime = Field(alias="occurredAt")


class EmployeeJourneyStageRead(ORMModel):
    key: str
    title: str
    status: str
    description: str


class EmployeeDetailRead(ORMModel):
    id: str
    user_id: str | None = Field(alias="userId", default=None)
    full_name: str = Field(alias="fullName")
    ethara_email: str = Field(alias="etharaEmail")
    personal_email: str | None = Field(alias="personalEmail", default=None)
    employee_code: str = Field(alias="employeeCode")
    linked_candidate_id: str | None = Field(alias="linkedCandidateId", default=None)
    linked_candidate_stage: str | None = Field(alias="linkedCandidateStage", default=None)
    phone: str | None = None
    department: str | None = None
    designation: str | None = None
    gender: str | None = None
    vendor: str | None = None
    employment_status: str | None = Field(alias="employmentStatus", default=None)
    work_mode: str | None = Field(alias="workMode", default=None)
    date_of_joining: datetime | None = Field(alias="dateOfJoining", default=None)
    blood_group: str | None = Field(alias="bloodGroup", default=None)
    emergency_contact_name: str | None = Field(alias="emergencyContactName", default=None)
    emergency_contact_phone: str | None = Field(alias="emergencyContactPhone", default=None)
    emergency_contact_relation: str | None = Field(alias="emergencyContactRelation", default=None)
    aadhaar_last4: str | None = Field(alias="aadhaarLast4", default=None)
    aadhaar_ocr_status: str | None = Field(alias="aadhaarOcrStatus", default=None)
    aadhaar_ocr_match: bool | None = Field(alias="aadhaarOcrMatch", default=None)
    date_of_birth: datetime | None = Field(alias="dateOfBirth", default=None)
    registration_status: str = Field(alias="registrationStatus")
    current_employee_status: str = Field(alias="currentEmployeeStatus")
    is_active: bool = Field(alias="isActive")
    document_completion_status: dict[str, Any] = Field(alias="documentCompletionStatus")
    resume_document: EmployeeDocumentRead | None = Field(alias="resumeDocument", default=None)
    documents: list[EmployeeDocumentRead] = Field(default_factory=list)
    missing_documents: list[str] = Field(alias="missingDocuments", default_factory=list)
    selection_form: EmployeeSelectionFormRead = Field(alias="selectionForm")
    contracts: list[EmployeeContractRead] = Field(default_factory=list)
    compliance_forms: list[EmployeeComplianceFormRead] = Field(
        alias="complianceForms",
        default_factory=list,
    )
    referral_activity: list[EmployeeReferralActivityRead] = Field(alias="referralActivity", default_factory=list)
    profile_journey: list[EmployeeJourneyStageRead] = Field(alias="profileJourney", default_factory=list)
    profile_completion_percentage: int = Field(alias="profileCompletionPercentage")
    next_required_action: str | None = Field(alias="nextRequiredAction", default=None)
    audit_logs: list[AuditLogRead] = Field(alias="auditLogs", default_factory=list)
    timeline: list[EmployeeTimelineEventRead] = Field(default_factory=list)
    created_at: datetime | None = Field(alias="createdAt", default=None)
    updated_at: datetime | None = Field(alias="updatedAt", default=None)
