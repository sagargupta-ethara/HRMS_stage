from datetime import UTC, date, datetime, time

from pydantic import EmailStr, Field, field_validator

from app.db.models import CandidateStage, SourceType
from app.schemas.common import ORMModel, PaginatedResponse, TimestampedModel
from app.schemas.resources import CollegeRead, PositionRead, UserRead, VendorRead
from app.schemas.workflow import (
    AuditLogRead,
    ComplianceFormRead,
    ContractRead,
    DocumentRead,
    EscalationRead,
    ITRequestRead,
    NotificationRead,
    PiInterviewRoundRead,
    SelectionFormRead,
)


def _parse_date_time(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=UTC)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            if len(raw) == 10:
                return datetime.combine(date.fromisoformat(raw), time.min, tzinfo=UTC)
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return value
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return value


class CreateCandidateRequest(ORMModel):
    full_name: str = Field(alias="fullName")
    personal_email: EmailStr = Field(alias="personalEmail")
    phone: str
    source_type: SourceType = Field(alias="sourceType")
    position_id: str | None = Field(alias="positionId", default=None)
    college_id: str | None = Field(alias="collegeId", default=None)
    vendor_id: str | None = Field(alias="vendorId", default=None)
    source_id: str | None = Field(alias="sourceId", default=None)
    experience_type: str | None = Field(alias="experienceType", default=None)
    experience_years: int | None = Field(alias="experienceYears", default=None)
    current_company: str | None = Field(alias="currentCompany", default=None)
    current_ctc: float | None = Field(alias="currentCTC", default=None)
    expected_ctc: float | None = Field(alias="expectedCTC", default=None)
    notice_period: int | None = Field(alias="noticePeriod", default=None)
    aadhaar_last4: str | None = Field(alias="aadhaarLast4", default=None)
    aadhaar_number: str | None = Field(alias="aadhaarNumber", default=None)
    gender: str | None = None
    resume_url: str | None = Field(alias="resumeUrl", default=None)
    date_of_birth: datetime | None = Field(alias="dateOfBirth", default=None)
    marital_status: str | None = Field(alias="maritalStatus", default=None)

    @field_validator("date_of_birth", mode="before")
    @classmethod
    def parse_date_of_birth(cls, value):
        return _parse_date_time(value)


class UpdateCandidateRequest(ORMModel):
    full_name: str | None = Field(alias="fullName", default=None)
    personal_email: EmailStr | None = Field(alias="personalEmail", default=None)
    ethara_email: EmailStr | None = Field(alias="etharaEmail", default=None)
    employee_code: str | None = Field(alias="employeeCode", default=None)
    phone: str | None = None
    aadhaar_last4: str | None = Field(alias="aadhaarLast4", default=None)
    aadhaar_number: str | None = Field(alias="aadhaarNumber", default=None)
    gender: str | None = None
    date_of_birth: datetime | None = Field(alias="dateOfBirth", default=None)
    marital_status: str | None = Field(alias="maritalStatus", default=None)
    experience_type: str | None = Field(alias="experienceType", default=None)
    experience_years: int | None = Field(alias="experienceYears", default=None)
    current_company: str | None = Field(alias="currentCompany", default=None)
    current_ctc: float | None = Field(alias="currentCTC", default=None)
    expected_ctc: float | None = Field(alias="expectedCTC", default=None)
    notice_period: int | None = Field(alias="noticePeriod", default=None)
    source_type: SourceType | None = Field(alias="sourceType", default=None)
    source_id: str | None = Field(alias="sourceId", default=None)
    position_id: str | None = Field(alias="positionId", default=None)
    college_id: str | None = Field(alias="collegeId", default=None)
    vendor_id: str | None = Field(alias="vendorId", default=None)
    current_stage: CandidateStage | None = Field(alias="currentStage", default=None)
    current_status: str | None = Field(alias="currentStatus", default=None)
    priority_score: int | None = Field(alias="priorityScore", default=None)
    is_duplicate: bool | None = Field(alias="isDuplicate", default=None)
    duplicate_reason: str | None = Field(alias="duplicateReason", default=None)
    is_reapplication_blocked: bool | None = Field(alias="isReapplicationBlocked", default=None)
    resume_url: str | None = Field(alias="resumeUrl", default=None)
    resume_score: float | None = Field(alias="resumeScore", default=None)
    resume_summary: str | None = Field(alias="resumeSummary", default=None)

    @field_validator("date_of_birth", mode="before")
    @classmethod
    def parse_date_of_birth(cls, value):
        return _parse_date_time(value)


class PortalProfileUpdateRequest(ORMModel):
    full_name: str | None = Field(alias="fullName", default=None)
    phone: str | None = None
    gender: str | None = None
    date_of_birth: datetime | None = Field(alias="dateOfBirth", default=None)
    marital_status: str | None = Field(alias="maritalStatus", default=None)
    experience_type: str | None = Field(alias="experienceType", default=None)
    experience_years: int | None = Field(alias="experienceYears", default=None)
    current_company: str | None = Field(alias="currentCompany", default=None)
    current_ctc: float | None = Field(alias="currentCTC", default=None)
    expected_ctc: float | None = Field(alias="expectedCTC", default=None)
    notice_period: int | None = Field(alias="noticePeriod", default=None)
    college_id: str | None = Field(alias="collegeId", default=None)

    @field_validator("date_of_birth", mode="before")
    @classmethod
    def parse_date_of_birth(cls, value):
        return _parse_date_time(value)


class PortalApplyRequest(ORMModel):
    position_id: str = Field(alias="positionId")


class AdvanceStageRequest(ORMModel):
    to_stage: CandidateStage = Field(alias="toStage")
    notes: str | None = None


class StageLogRead(ORMModel):
    id: str
    candidate_id: str = Field(alias="candidateId")
    from_stage: CandidateStage = Field(alias="fromStage")
    to_stage: CandidateStage = Field(alias="toStage")
    changed_by: str = Field(alias="changedBy")
    changed_by_name: str | None = Field(alias="changedByName", default=None)
    notes: str | None = None
    created_at: datetime = Field(alias="createdAt")


class CandidateSummary(TimestampedModel):
    id: str
    access_level: str = Field(alias="accessLevel", default="full")
    can_open_detail: bool = Field(alias="canOpenDetail", default=True)
    candidate_code: str = Field(alias="candidateCode")
    employee_code: str | None = Field(alias="employeeCode", default=None)
    full_name: str = Field(alias="fullName")
    # Response-only: keep these as plain str (not EmailStr). FastAPI validates the
    # OUTGOING response, so a single legacy/placeholder row (e.g. a name typed into
    # personalEmail, or a soft-delete "...@deleted.local" address) would otherwise
    # raise ResponseValidationError and 500 the ENTIRE list. Input is still validated
    # by CreateCandidateRequest/UpdateCandidateRequest (which keep EmailStr).
    personal_email: str = Field(alias="personalEmail")
    ethara_email: str | None = Field(alias="etharaEmail", default=None)
    phone: str
    aadhaar_last4: str | None = Field(alias="aadhaarLast4", default=None)
    gender: str | None = None
    source_type: SourceType = Field(alias="sourceType")
    source_id: str | None = Field(alias="sourceId", default=None)
    position_id: str | None = Field(alias="positionId", default=None)
    college_id: str | None = Field(alias="collegeId", default=None)
    vendor_id: str | None = Field(alias="vendorId", default=None)
    current_stage: CandidateStage = Field(alias="currentStage")
    current_status: str = Field(alias="currentStatus")
    priority_score: int = Field(alias="priorityScore")
    is_duplicate: bool = Field(alias="isDuplicate")
    duplicate_reason: str | None = Field(alias="duplicateReason", default=None)
    is_reapplication_blocked: bool = Field(alias="isReapplicationBlocked")
    last_applied_at: datetime | None = Field(alias="lastAppliedAt", default=None)
    resume_url: str | None = Field(alias="resumeUrl", default=None)
    resume_score: float | None = Field(alias="resumeScore", default=None)
    resume_summary: str | None = Field(alias="resumeSummary", default=None)
    resume_text: str | None = Field(alias="resumeText", default=None)
    resume_key_points: list[str] | None = Field(alias="resumeKeyPoints", default=None)
    screening_payload: dict | None = Field(alias="screeningPayload", default=None)
    llm_status: str | None = Field(alias="llmStatus", default=None)
    aadhaar_extracted: dict | None = Field(alias="aadhaarExtracted", default=None)
    experience_type: str | None = Field(alias="experienceType", default=None)
    experience_years: int | None = Field(alias="experienceYears", default=None)
    current_company: str | None = Field(alias="currentCompany", default=None)
    current_ctc: float | None = Field(alias="currentCTC", default=None)
    expected_ctc: float | None = Field(alias="expectedCTC", default=None)
    notice_period: int | None = Field(alias="noticePeriod", default=None)
    position: PositionRead | None = None
    college: CollegeRead | None = None
    vendor: VendorRead | None = None
    contract: ContractRead | None = None


class EvaluationRead(ORMModel):
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
    interview_subject: str | None = Field(alias="interviewSubject", default=None)
    interview_scheduled_at: datetime | None = Field(alias="interviewScheduledAt", default=None)
    interview_status: str | None = Field(alias="interviewStatus", default=None)
    interview_notes: str | None = Field(alias="interviewNotes", default=None)
    interview_mode: str | None = Field(alias="interviewMode", default=None)
    pi_score: float | None = Field(alias="piScore", default=None)
    pms_score: float | None = Field(alias="pmsScore", default=None)
    pi_rounds: list[PiInterviewRoundRead] = Field(alias="piRounds", default_factory=list)
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    evaluator: UserRead | None = None


class CandidateDetail(CandidateSummary):
    date_of_birth: datetime | None = Field(alias="dateOfBirth", default=None)
    stage_logs: list[StageLogRead] = Field(alias="stageLogs", default_factory=list)
    evaluations: list[EvaluationRead] = []
    documents: list[DocumentRead] = []
    contract: ContractRead | None = None
    compliance_forms: list[ComplianceFormRead] = Field(alias="complianceForms", default_factory=list)
    escalations: list[EscalationRead] = []
    notifications: list[NotificationRead] = []
    it_request: ITRequestRead | None = Field(alias="itRequest", default=None)
    selection_form: SelectionFormRead | None = Field(alias="selectionForm", default=None)
    audit_logs: list[AuditLogRead] = Field(alias="auditLogs", default_factory=list)


# Top-level serialized (camelCase alias) keys that vendors / employee referrers must
# not see on candidate list / detail / export responses. Scrubbed by post-filtering the
# already-serialized output so STAFF responses are completely unchanged.
_VENDOR_HIDDEN_CANDIDATE_KEYS = frozenset({
    "resumeScore",
    "resumeSummary",
    "resumeText",
    "resumeKeyPoints",
    "screeningPayload",
    "llmStatus",
    "aadhaarExtracted",
    "auditLogs",
    "escalations",
    "currentCTC",
    "expectedCTC",
})
# Per-evaluation keys (notes + numeric scores) hidden from vendors / referrers; the
# evaluations array itself is preserved (trimmed) so the shape stays stable.
_VENDOR_HIDDEN_EVALUATION_KEYS = frozenset({
    "technicalSkills",
    "communication",
    "problemSolving",
    "culturalFit",
    "attitude",
    "totalScore",
    "recommendation",
    "notes",
    "interviewNotes",
    "piScore",
    "pmsScore",
    "piRounds",
})


def scrub_internal_candidate_fields(serialized: dict) -> dict:
    """Remove internal recruiting fields from an already-serialized candidate payload
    (summary or detail) for vendor / employee-referrer consumers. Mutates and returns
    the dict. Staff payloads never pass through here, so staff output is unchanged."""
    for key in _VENDOR_HIDDEN_CANDIDATE_KEYS:
        serialized.pop(key, None)
    evaluations = serialized.get("evaluations")
    if isinstance(evaluations, list):
        for evaluation in evaluations:
            if isinstance(evaluation, dict):
                for key in _VENDOR_HIDDEN_EVALUATION_KEYS:
                    evaluation.pop(key, None)
    return serialized


_PREVIEW_ALLOWED_CANDIDATE_KEYS = frozenset({
    "id",
    "accessLevel",
    "canOpenDetail",
    "candidateCode",
    "fullName",
    "personalEmail",
    "etharaEmail",
    "phone",
    "sourceType",
    "positionId",
    "currentStage",
    "currentStatus",
    "lastAppliedAt",
    "createdAt",
    "updatedAt",
    "position",
})
_PREVIEW_ALLOWED_POSITION_KEYS = frozenset({"id", "title", "department"})


def scrub_candidate_preview_fields(serialized: dict) -> dict:
    """Return the non-recruiting staff preview of a candidate.

    This keeps operational identity/contact/status data while removing documents,
    compensation, Aadhaar/OCR, screening, evaluation, audit, vendor/college, and
    workflow-detail payloads.
    """
    preview = {key: value for key, value in serialized.items() if key in _PREVIEW_ALLOWED_CANDIDATE_KEYS}
    position = preview.get("position")
    if isinstance(position, dict):
        preview["position"] = {
            key: value for key, value in position.items() if key in _PREVIEW_ALLOWED_POSITION_KEYS
        }
    preview["accessLevel"] = "preview"
    preview["canOpenDetail"] = False
    return preview


class CandidatePortalApplication(ORMModel):
    """Candidate-SAFE projection of an application for the portal's GET /candidates/me.

    Exposes ONLY what the candidate-facing portal pages read (stage/status, position,
    dates, id-card fields, contract status, Aadhaar last-4). Deliberately omits staff/
    internal fields the staff CandidateDetail carries: evaluations, audit_logs,
    escalations, notifications, screening_payload, resume_score/summary/text/key_points,
    llm_status, aadhaar_extracted (which embeds the full Aadhaar number), priority_score,
    and CTC/salary. The portal never reads those, so dropping them is non-breaking."""

    id: str
    candidate_code: str = Field(alias="candidateCode")
    full_name: str = Field(alias="fullName")
    # Response-only: plain str, not EmailStr (see CandidateSummary note above) so a
    # single bad/placeholder address can't 500 the candidate-portal detail.
    personal_email: str = Field(alias="personalEmail")
    ethara_email: str | None = Field(alias="etharaEmail", default=None)
    phone: str
    aadhaar_last4: str | None = Field(alias="aadhaarLast4", default=None)
    gender: str | None = None
    date_of_birth: datetime | None = Field(alias="dateOfBirth", default=None)
    marital_status: str | None = Field(alias="maritalStatus", default=None)
    experience_type: str | None = Field(alias="experienceType", default=None)
    experience_years: int | None = Field(alias="experienceYears", default=None)
    source_type: SourceType = Field(alias="sourceType")
    position_id: str | None = Field(alias="positionId", default=None)
    college_id: str | None = Field(alias="collegeId", default=None)
    current_stage: CandidateStage = Field(alias="currentStage")
    current_status: str = Field(alias="currentStatus")
    is_duplicate: bool = Field(alias="isDuplicate")
    is_reapplication_blocked: bool = Field(alias="isReapplicationBlocked")
    last_applied_at: datetime | None = Field(alias="lastAppliedAt", default=None)
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    position: PositionRead | None = None
    college: CollegeRead | None = None
    contract: ContractRead | None = None
    compliance_forms: list[ComplianceFormRead] = Field(alias="complianceForms", default_factory=list)


class CandidateListResponse(PaginatedResponse[CandidateSummary]):
    pass


class CandidateStatsResponse(ORMModel):
    stages: list[dict]
    total: int
    this_month: int = Field(alias="thisMonth")


class CandidatePortalOverview(ORMModel):
    current_application: CandidateDetail | None = Field(alias="currentApplication", default=None)
    applications: list[CandidateSummary] = Field(default_factory=list)
    email_verified: bool = Field(alias="emailVerified")
    email_verified_at: datetime | None = Field(alias="emailVerifiedAt", default=None)


class CandidatePortalSelfOverview(ORMModel):
    """Candidate-SAFE overview returned by GET /candidates/me. Uses the trimmed
    CandidatePortalApplication projection (no evaluations/audit_logs/escalations/
    screening_payload/resume scores/full Aadhaar) instead of the staff CandidateDetail."""

    current_application: CandidatePortalApplication | None = Field(alias="currentApplication", default=None)
    applications: list[CandidatePortalApplication] = Field(default_factory=list)
    email_verified: bool = Field(alias="emailVerified")
    email_verified_at: datetime | None = Field(alias="emailVerifiedAt", default=None)
