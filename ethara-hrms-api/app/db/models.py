from __future__ import annotations

from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, event, func, inspect, select, update
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def generate_id() -> str:
    return uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class Role(StrEnum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    LEADERSHIP = "leadership"
    HR = "hr"
    TA = "ta"
    EMPLOYEE = "employee"
    VENDOR = "vendor"
    EMPLOYEE_REFERRER = "employee_referrer"
    EVALUATOR = "evaluator"
    IT_TEAM = "it_team"
    COMPLIANCE = "compliance"
    CANDIDATE = "candidate"
    MANAGER = "manager"
    OFFICE_ADMIN = "office_admin"
    PL_TPM = "pl_tpm"  # Project Lead / Technical Project Manager — raises dinner requests


class LeaveType(StrEnum):
    CASUAL = "casual"
    SICK = "sick"
    EARNED = "earned"
    MATERNITY = "maternity"
    PATERNITY = "paternity"
    UNPAID = "unpaid"
    COMPENSATORY = "compensatory"


class LeaveStatus(StrEnum):
    PENDING = "pending"
    MANAGER_APPROVED = "manager_approved"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class AttendanceStatus(StrEnum):
    PRESENT = "present"
    ABSENT = "absent"
    HALF_DAY = "half_day"
    HOLIDAY = "holiday"
    WEEKOFF = "weekoff"


class AttendanceSource(StrEnum):
    BIOMETRIC = "biometric"
    MANUAL = "manual"


class AttendanceSyncStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class AssetStatus(StrEnum):
    ASSIGNED = "assigned"
    RETURNED = "returned"
    DAMAGED = "damaged"


class SourceType(StrEnum):
    VENDOR = "vendor"
    INTERNAL_HIRING = "internal_hiring"
    LATERAL_HIRING = "lateral_hiring"
    EMPLOYEE_REFERRAL = "employee_referral"
    DIRECT_APPLICATION = "direct_application"
    CAMPUS_HIRE = "campus_hire"


class CandidateStage(StrEnum):
    NEW_APPLICATION = "new_application"
    SOURCE_TAGGED = "source_tagged"
    RESUME_UPLOADED = "resume_uploaded"
    RESUME_SCREENING_PENDING = "resume_screening_pending"
    RESUME_SHORTLISTED = "resume_shortlisted"
    RESUME_REJECTED = "resume_rejected"
    EVALUATION_ASSIGNED = "evaluation_assigned"
    EVALUATION_IN_PROGRESS = "evaluation_in_progress"
    EVALUATION_PASSED = "evaluation_passed"
    EVALUATION_FAILED = "evaluation_failed"
    SELECTION_FORM_SENT = "selection_form_sent"
    SELECTION_FORM_SUBMITTED = "selection_form_submitted"
    SELECTION_FORM_VALIDATED = "selection_form_validated"
    CONTRACT_SENT = "contract_sent"
    CONTRACT_SIGNED = "contract_signed"
    INDUCTION_COMPLETED = "induction_completed"
    IT_EMAIL_CREATED = "it_email_created"
    WELCOME_MAIL_SENT = "welcome_mail_sent"
    STATUTORY_FORMS_SENT = "statutory_forms_sent"
    STATUTORY_FORMS_SUBMITTED = "statutory_forms_submitted"
    COMPLIANCE_VERIFIED = "compliance_verified"
    ONBOARDING_COMPLETED = "onboarding_completed"


class EscalationStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class NotificationType(StrEnum):
    INFO = "info"
    WARNING = "warning"
    SUCCESS = "success"
    ERROR = "error"
    ACTION = "action"


class ContractStatus(StrEnum):
    DRAFT = "draft"
    SENT = "sent"
    VIEWED = "viewed"
    SIGNED = "signed"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class AuthCodePurpose(StrEnum):
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"


enum_kwargs = {"native_enum": False, "values_callable": lambda enum_cls: [item.value for item in enum_cls]}

enum_role = Enum(Role, name="role", **enum_kwargs)
enum_source = Enum(SourceType, name="source_type", **enum_kwargs)
enum_stage = Enum(CandidateStage, name="candidate_stage", **enum_kwargs)
enum_escalation_status = Enum(EscalationStatus, name="escalation_status", **enum_kwargs)
enum_notification_type = Enum(NotificationType, name="notification_type", **enum_kwargs)
enum_contract_status = Enum(ContractStatus, name="contract_status", **enum_kwargs)
enum_auth_code_purpose = Enum(AuthCodePurpose, name="auth_code_purpose", **enum_kwargs)
enum_attendance_status = Enum(AttendanceStatus, name="attendance_status", **enum_kwargs)
enum_attendance_source = Enum(AttendanceSource, name="attendance_source", **enum_kwargs)
enum_attendance_sync_status = Enum(
    AttendanceSyncStatus, name="attendance_sync_status", **enum_kwargs
)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column("password", String(255))
    name: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(enum_role, index=True)
    # All roles assigned to this user. `role` above is the currently active one
    # (always a member of this list). Lets a single account hold and switch
    # between multiple roles (e.g. HR + Talent Acquisition).
    roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[bool] = mapped_column("isActive", Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column("mustChangePassword", Boolean, default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        "emailVerifiedAt", DateTime(timezone=True)
    )
    last_login_at: Mapped[datetime | None] = mapped_column("lastLoginAt", DateTime(timezone=True))
    refresh_token_hash: Mapped[str | None] = mapped_column("refreshToken", String(255))
    # Monotonic counter embedded in access tokens (claim "tv"). Bumped on logout,
    # password change and password reset so previously-issued access tokens stop
    # validating (see app/api/deps.py).
    token_version: Mapped[int] = mapped_column(
        "tokenVersion", Integer, nullable=False, server_default="0", default=0
    )
    # Account-lockout bookkeeping. failed_login_count tracks consecutive failed
    # password attempts; locked_until temporarily blocks logins after a threshold.
    failed_login_count: Mapped[int] = mapped_column(
        "failedLoginCount", Integer, nullable=False, server_default="0", default=0
    )
    locked_until: Mapped[datetime | None] = mapped_column("lockedUntil", DateTime(timezone=True))
    permission_overrides: Mapped[list[str]] = mapped_column(JSON, default=list)
    vendor_id: Mapped[str | None] = mapped_column(ForeignKey("vendors.id"), nullable=True, index=True)

    vendor: Mapped[Vendor | None] = relationship(back_populates="users")
    employee_profile: Mapped[EmployeeProfile | None] = relationship(
        back_populates="user",
        primaryjoin="EmployeeProfile.user_id == User.id",
        foreign_keys="[EmployeeProfile.user_id]",
        uselist=False,
    )
    candidate_profiles: Mapped[list[Candidate]] = relationship(back_populates="portal_user")
    audit_logs: Mapped[list[AuditLog]] = relationship(back_populates="user")
    notifications: Mapped[list[Notification]] = relationship(back_populates="user")
    evaluations: Mapped[list[Evaluation]] = relationship(back_populates="evaluator")
    escalations: Mapped[list[Escalation]] = relationship(back_populates="responsible_user")
    it_requests: Mapped[list[ITRequest]] = relationship(back_populates="assigned_to")
    auth_codes: Mapped[list[AuthCode]] = relationship(back_populates="user")


class Vendor(Base, TimestampMixin):
    __tablename__ = "vendors"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String(255))
    contact_email: Mapped[str] = mapped_column("contactEmail", String(255), unique=True)
    contact_phone: Mapped[str | None] = mapped_column("contactPhone", String(30))
    is_active: Mapped[bool] = mapped_column("isActive", Boolean, default=True)

    users: Mapped[list[User]] = relationship(back_populates="vendor")
    candidates: Mapped[list[Candidate]] = relationship(back_populates="vendor")


class EmployeeProfile(Base, TimestampMixin):
    __tablename__ = "employee_profiles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    user_id: Mapped[str | None] = mapped_column("userId", ForeignKey("users.id"), unique=True)
    full_name: Mapped[str] = mapped_column("fullName", String(255))
    ethara_email: Mapped[str] = mapped_column("etharaEmail", String(255), unique=True, index=True)
    personal_email: Mapped[str | None] = mapped_column("personalEmail", String(255), index=True)
    employee_code: Mapped[str] = mapped_column("employeeCode", String(64), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    department: Mapped[str | None] = mapped_column(String(255))
    designation: Mapped[str | None] = mapped_column(String(255))
    gender: Mapped[str | None] = mapped_column(String(30))
    aadhaar_last4: Mapped[str | None] = mapped_column("aadhaarLast4", String(4))
    aadhaar_hash: Mapped[str | None] = mapped_column("aadhaarHash", String(64), unique=True)
    date_of_birth: Mapped[datetime | None] = mapped_column("dateOfBirth", DateTime(timezone=True))
    aadhaar_path: Mapped[str | None] = mapped_column("aadhaarPath", String(500))
    resume_path: Mapped[str | None] = mapped_column("resumePath", String(500))
    aadhaar_ocr_status: Mapped[str | None] = mapped_column("aadhaarOcrStatus", String(50))
    aadhaar_ocr_match: Mapped[bool | None] = mapped_column("aadhaarOcrMatch", Boolean)
    aadhaar_ocr_name: Mapped[str | None] = mapped_column("aadhaarOcrName", String(255))
    aadhaar_validation_status: Mapped[str | None] = mapped_column("aadhaarValidationStatus", String(50))
    aadhaar_mismatch_reason: Mapped[str | None] = mapped_column("aadhaarMismatchReason", Text)
    # Full Aadhaar OCR result (number, DOB, name, status), stored at registration
    # so the export reads it from the DB instead of re-OCRing. Mirrors
    # candidates.aadhaar_extracted.
    aadhaar_extracted: Mapped[dict[str, Any] | None] = mapped_column("aadhaarExtracted", JSON)
    manager_id: Mapped[str | None] = mapped_column(
        "managerId", ForeignKey("users.id"), nullable=True, index=True
    )
    blood_group: Mapped[str | None] = mapped_column("bloodGroup", String(32))
    emergency_contact_name: Mapped[str | None] = mapped_column("emergencyContactName", String(255))
    emergency_contact_phone: Mapped[str | None] = mapped_column("emergencyContactPhone", String(30))
    emergency_contact_relation: Mapped[str | None] = mapped_column("emergencyContactRelation", String(100))
    # ID-card detail fields (editable via the ID Card Details form — employee
    # self-service + HR). blood_group / emergency_contact_* above are shared.
    father_name: Mapped[str | None] = mapped_column("fatherName", String(255))
    mother_name: Mapped[str | None] = mapped_column("motherName", String(255))
    marital_status: Mapped[str | None] = mapped_column("maritalStatus", String(50))
    current_address: Mapped[str | None] = mapped_column("currentAddress", Text)
    permanent_address: Mapped[str | None] = mapped_column("permanentAddress", Text)
    id_card_submitted_at: Mapped[datetime | None] = mapped_column("idCardSubmittedAt", DateTime(timezone=True))
    id_card_submitted_by: Mapped[str | None] = mapped_column("idCardSubmittedBy", String(32))
    # HR/admin-only fields (not part of the employee self-form). Editable solely via
    # the staff-gated PATCH /employees/{id}/hr-fields endpoint; surfaced in the admin
    # employee-detail view but never in the employee's own selection-form payload.
    vendor: Mapped[str | None] = mapped_column(String(255))
    employment_status: Mapped[str | None] = mapped_column("employmentStatus", String(50))
    work_mode: Mapped[str | None] = mapped_column("workMode", String(50))
    # Date of Joining — set by HR/admin (profile edit or bulk Email+DOJ import); shown
    # read-only to the employee, never editable by them.
    date_of_joining: Mapped[datetime | None] = mapped_column("dateOfJoining", DateTime(timezone=True))
    # Performance & Development / Employee Evaluation module. training_score is
    # manually / CSV-entered; evaluation_verdict defaults to "pass" for existing
    # staff (already hired) and is set as new hires are evaluated.
    training_score: Mapped[float | None] = mapped_column("trainingScore", Float)
    evaluation_verdict: Mapped[str | None] = mapped_column("evaluationVerdict", String(50))
    # Employee-level evaluation overrides (bulk-template / manual). When set, these
    # win over the linked candidate's recruitment record; when null, the profile
    # falls back to the candidate-derived value.
    candidate_evaluation_score: Mapped[float | None] = mapped_column("candidateEvaluationScore", Float)
    assessment_score: Mapped[float | None] = mapped_column("assessmentScore", Float)
    assessment_verdict: Mapped[str | None] = mapped_column("assessmentVerdict", Text)
    pi_score: Mapped[float | None] = mapped_column("piScore", Float)
    pi_verdict: Mapped[str | None] = mapped_column("piVerdict", Text)

    user: Mapped[User | None] = relationship(
        back_populates="employee_profile",
        primaryjoin="EmployeeProfile.user_id == User.id",
        foreign_keys="[EmployeeProfile.user_id]",
    )
    manager: Mapped[User | None] = relationship(
        primaryjoin="EmployeeProfile.manager_id == User.id",
        foreign_keys="[EmployeeProfile.manager_id]",
    )
    selection_form: Mapped[EmployeeSelectionForm | None] = relationship(
        back_populates="employee_profile",
        uselist=False,
    )
    documents: Mapped[list[EmployeeDocument]] = relationship(back_populates="employee_profile")
    contracts: Mapped[list[EmployeeContract]] = relationship(back_populates="employee_profile")
    compliance_forms: Mapped[list[EmployeeComplianceForm]] = relationship(
        back_populates="employee_profile"
    )
    separations: Mapped[list[EmployeeSeparation]] = relationship(back_populates="employee_profile")
    leave_requests: Mapped[list[LeaveRequest]] = relationship(back_populates="employee_profile")
    leave_balances: Mapped[list[LeaveBalance]] = relationship(back_populates="employee_profile")
    attendance_records: Mapped[list[AttendanceRecord]] = relationship(back_populates="employee_profile")
    assets: Mapped[list[EmployeeAsset]] = relationship(back_populates="employee_profile")


class EmployeeSelectionForm(Base, TimestampMixin):
    __tablename__ = "employee_selection_forms"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), unique=True
    )
    status: Mapped[str] = mapped_column(String(50), default="draft", index=True)
    form_data: Mapped[dict[str, Any] | None] = mapped_column("formData", JSON)
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    reviewed_at: Mapped[datetime | None] = mapped_column("reviewedAt", DateTime(timezone=True))
    reviewed_by: Mapped[str | None] = mapped_column("reviewedBy", String(32))
    remarks: Mapped[str | None] = mapped_column(Text)

    employee_profile: Mapped[EmployeeProfile] = relationship(back_populates="selection_form")


class EmployeeDocument(Base, TimestampMixin):
    __tablename__ = "employee_documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    type: Mapped[str] = mapped_column(String(50), index=True)
    file_name: Mapped[str] = mapped_column("fileName", String(255))
    file_url: Mapped[str] = mapped_column("fileUrl", String(500))
    file_size: Mapped[int | None] = mapped_column("fileSize", Integer)
    mime_type: Mapped[str | None] = mapped_column("mimeType", String(255))
    status: Mapped[str] = mapped_column(String(50), default="uploaded", index=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[str | None] = mapped_column("uploadedBy", String(32))
    verified_by: Mapped[str | None] = mapped_column("verifiedBy", String(32))
    verified_at: Mapped[datetime | None] = mapped_column("verifiedAt", DateTime(timezone=True))
    # AI document-type verification (Vertex AI Gemini). "needs_review" when the
    # uploaded file does not match the expected type; verification_data holds the
    # full verdict (detected type, confidence, extracted fields, issues).
    ocr_status: Mapped[str] = mapped_column("ocrStatus", String(50), default="pending")
    ocr_provider: Mapped[str | None] = mapped_column("ocrProvider", String(50))
    verification_data: Mapped[dict[str, Any] | None] = mapped_column("verificationData", JSON)

    employee_profile: Mapped[EmployeeProfile] = relationship(back_populates="documents")


class EmployeeImportStaging(Base, TimestampMixin):
    """Pre-loaded employee data (from the bulk HR sheet) waiting to be merged into an
    EmployeeProfile when the employee self-registers. Holds NO auth account — it never
    creates a User and never triggers any email. Matched on registration by ethara_email
    -> personal_email -> phone, then consumed (status='consumed')."""

    __tablename__ = "employee_import_staging"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    # Match keys (stored normalized: lower-cased / trimmed)
    ethara_email: Mapped[str | None] = mapped_column("etharaEmail", String(255), index=True)
    personal_email: Mapped[str | None] = mapped_column("personalEmail", String(255), index=True)
    phone: Mapped[str | None] = mapped_column(String(30), index=True)
    employee_code: Mapped[str | None] = mapped_column("employeeCode", String(64), index=True)
    # Core EmployeeProfile columns to apply (incl. vendor/employment_status/work_mode)
    profile_fields: Mapped[dict[str, Any] | None] = mapped_column("profileFields", JSON)
    # Pre-built selection-form payload (spouse/children/parents/bank/UAN/addresses, ...)
    form_data: Mapped[dict[str, Any] | None] = mapped_column("formData", JSON)
    # Aadhaar privacy: only hash + last4 are stored, never the full number
    aadhaar_hash: Mapped[str | None] = mapped_column("aadhaarHash", String(64))
    aadhaar_last4: Mapped[str | None] = mapped_column("aadhaarLast4", String(4))
    # List of already-downloaded docs: {type, file_url, storage_path, file_name, mime_type, file_size}
    documents: Mapped[list[Any] | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    consumed_by_profile_id: Mapped[str | None] = mapped_column("consumedByProfileId", String(32))
    consumed_at: Mapped[datetime | None] = mapped_column("consumedAt", DateTime(timezone=True))
    source_row: Mapped[dict[str, Any] | None] = mapped_column("sourceRow", JSON)
    notes: Mapped[str | None] = mapped_column(Text)


class EmployeeContract(Base, TimestampMixin):
    __tablename__ = "employee_contracts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[ContractStatus] = mapped_column(enum_contract_status, default=ContractStatus.DRAFT)
    file_name: Mapped[str | None] = mapped_column("fileName", String(255))
    file_url: Mapped[str | None] = mapped_column("fileUrl", String(500))
    mime_type: Mapped[str | None] = mapped_column("mimeType", String(255))
    issued_at: Mapped[datetime | None] = mapped_column("issuedAt", DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column("completedAt", DateTime(timezone=True))
    remarks: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[str | None] = mapped_column("uploadedBy", String(32))

    employee_profile: Mapped[EmployeeProfile] = relationship(back_populates="contracts")


class EmployeeComplianceForm(Base, TimestampMixin):
    __tablename__ = "employee_compliance_forms"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    form_type: Mapped[str] = mapped_column("formType", String(50), index=True)
    form_title: Mapped[str] = mapped_column("formTitle", String(255))
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    form_data: Mapped[dict[str, Any] | None] = mapped_column("formData", JSON)
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column("verifiedAt", DateTime(timezone=True))
    reviewed_by: Mapped[str | None] = mapped_column("reviewedBy", String(32))
    remarks: Mapped[str | None] = mapped_column(Text)
    # Documenso e-sign compliance forms (Form 11 / Form 2 / Form F) — sent to the employee's
    # Ethara email for signature, tracked like contracts.
    documenso_id: Mapped[str | None] = mapped_column("documensoId", String(255), index=True)
    documenso_template_id: Mapped[int | None] = mapped_column("documensoTemplateId", Integer)
    signed_url: Mapped[str | None] = mapped_column("signedUrl", String(500))
    pdf_url: Mapped[str | None] = mapped_column("pdfUrl", String(500))
    sent_at: Mapped[datetime | None] = mapped_column("sentAt", DateTime(timezone=True))
    signed_at: Mapped[datetime | None] = mapped_column("signedAt", DateTime(timezone=True))

    employee_profile: Mapped[EmployeeProfile] = relationship(back_populates="compliance_forms")


class EmployeeSeparation(Base, TimestampMixin):
    __tablename__ = "employee_separations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    separation_type: Mapped[str] = mapped_column("separationType", String(30), index=True)
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    reason: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    early_relieving_requested: Mapped[bool] = mapped_column("earlyRelievingRequested", Boolean, default=False)
    applied_at: Mapped[datetime | None] = mapped_column("appliedAt", DateTime(timezone=True))
    last_working_day: Mapped[datetime | None] = mapped_column("lastWorkingDay", DateTime(timezone=True))
    effective_date: Mapped[datetime | None] = mapped_column("effectiveDate", DateTime(timezone=True))
    manager_id: Mapped[str | None] = mapped_column("managerId", ForeignKey("users.id"))
    manager_remarks: Mapped[str | None] = mapped_column("managerRemarks", Text)
    manager_action: Mapped[str | None] = mapped_column("managerAction", String(30))
    manager_action_at: Mapped[datetime | None] = mapped_column("managerActionAt", DateTime(timezone=True))
    reviewed_by: Mapped[str | None] = mapped_column("reviewedBy", ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column("reviewedAt", DateTime(timezone=True))

    employee_profile: Mapped[EmployeeProfile] = relationship(back_populates="separations")
    manager: Mapped[User | None] = relationship(foreign_keys=[manager_id])
    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewed_by])


class College(Base, TimestampMixin):
    __tablename__ = "colleges"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String(255), index=True)
    short_name: Mapped[str | None] = mapped_column("shortName", String(255))
    is_active: Mapped[bool] = mapped_column("isActive", Boolean, default=True)

    candidates: Mapped[list[Candidate]] = relationship(back_populates="college")


class Position(Base, TimestampMixin):
    __tablename__ = "positions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    title: Mapped[str] = mapped_column(String(255), index=True)
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    department: Mapped[str] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(255))
    employment_type: Mapped[str | None] = mapped_column("employmentType", String(100))
    work_mode: Mapped[str | None] = mapped_column("workMode", String(100))
    experience_level: Mapped[str | None] = mapped_column("experienceLevel", String(100))
    experience_years: Mapped[int | None] = mapped_column("experienceYears", Integer)
    salary_bracket: Mapped[str | None] = mapped_column("salaryBracket", String(255))
    responsibilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    requirements: Mapped[list[str]] = mapped_column(JSON, default=list)
    preferred_skills: Mapped[list[str]] = mapped_column("preferredSkills", JSON, default=list)
    benefits: Mapped[list[str]] = mapped_column(JSON, default=list)
    featured: Mapped[bool] = mapped_column(Boolean, default=False)
    openings: Mapped[int] = mapped_column(Integer, default=1)
    posted_at: Mapped[datetime | None] = mapped_column("postedAt", DateTime(timezone=True))
    urgency_level: Mapped[int] = mapped_column("urgencyLevel", Integer, default=3)
    is_active: Mapped[bool] = mapped_column("isActive", Boolean, default=True)
    approval_status: Mapped[str] = mapped_column("approvalStatus", String(50), default="draft", index=True)
    approval_requested_at: Mapped[datetime | None] = mapped_column("approvalRequestedAt", DateTime(timezone=True))
    approval_decided_at: Mapped[datetime | None] = mapped_column("approvalDecidedAt", DateTime(timezone=True))
    requested_by: Mapped[str | None] = mapped_column("requestedBy", ForeignKey("users.id"))
    approved_by: Mapped[str | None] = mapped_column("approvedBy", ForeignKey("users.id"))
    approval_recipient_email: Mapped[str | None] = mapped_column("approvalRecipientEmail", String(255))
    reviewed_by_email: Mapped[str | None] = mapped_column("reviewedByEmail", String(255))
    rejection_reason: Mapped[str | None] = mapped_column("rejectionReason", Text)
    approval_email_sent_at: Mapped[datetime | None] = mapped_column("approvalEmailSentAt", DateTime(timezone=True))
    approval_token_hash: Mapped[str | None] = mapped_column("approvalTokenHash", String(64))
    approval_token_expires_at: Mapped[datetime | None] = mapped_column("approvalTokenExpiresAt", DateTime(timezone=True))
    # LLM screening: custom system prompt for evaluating candidates against this role
    screening_prompt: Mapped[str | None] = mapped_column("screeningPrompt", Text)

    candidates: Mapped[list[Candidate]] = relationship(back_populates="position")
    requester: Mapped[User | None] = relationship(foreign_keys=[requested_by])
    approver: Mapped[User | None] = relationship(foreign_keys=[approved_by])


class CareerApplication(Base, TimestampMixin):
    __tablename__ = "career_applications"
    __table_args__ = (
        Index("ix_career_applications_status_created_at", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    full_name: Mapped[str] = mapped_column("fullName", String(255), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    phone: Mapped[str] = mapped_column(String(30))
    linkedin_url: Mapped[str | None] = mapped_column("linkedinUrl", String(500))
    portfolio_url: Mapped[str | None] = mapped_column("portfolioUrl", String(500))
    github_url: Mapped[str | None] = mapped_column("githubUrl", String(500))
    # Resume uploads are required by the public career form and employee referral API.
    resume_file_name: Mapped[str | None] = mapped_column("resumeFileName", String(255))
    resume_url: Mapped[str | None] = mapped_column("resumeUrl", String(500))
    resume_storage_path: Mapped[str | None] = mapped_column("resumeStoragePath", String(500))
    resume_mime_type: Mapped[str | None] = mapped_column("resumeMimeType", String(100))
    resume_size: Mapped[int | None] = mapped_column("resumeSize", Integer)
    status: Mapped[str] = mapped_column(String(50), default="new", index=True)
    # Set when an employee refers someone — the entry lands in the dropbox only.
    referred_by_id: Mapped[str | None] = mapped_column(
        "referredById", ForeignKey("users.id"), index=True, nullable=True
    )
    referred_by_name: Mapped[str | None] = mapped_column("referredByName", String(255))


class AssessmentTemplate(Base, TimestampMixin):
    __tablename__ = "assessment_templates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    title: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    level: Mapped[int] = mapped_column(Integer, default=1)  # 1=Assessment1, 2=Assessment2, 3=Evals
    position_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("positions.id"), index=True)
    is_active: Mapped[bool] = mapped_column("isActive", Boolean, default=True)
    created_by: Mapped[str | None] = mapped_column("createdBy", ForeignKey("users.id"))

    position: Mapped["Position | None"] = relationship()
    creator: Mapped["User | None"] = relationship(foreign_keys=[created_by])


class Candidate(Base, TimestampMixin):
    __tablename__ = "candidates"
    __table_args__ = (
        Index("ix_candidates_isRemoved_currentStage", "isRemoved", "currentStage"),
        Index("ix_candidates_positionId_isRemoved", "positionId", "isRemoved"),
        Index("ix_candidates_updated_at_isRemoved", "updated_at", "isRemoved"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_code: Mapped[str] = mapped_column("candidateCode", String(64), unique=True, index=True)
    # Sequential GRP employee code, allocated the moment the contract is signed and carried
    # over to the EmployeeProfile on conversion. Nullable until the contract is signed.
    employee_code: Mapped[str | None] = mapped_column("employeeCode", String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column("fullName", String(255), index=True)
    personal_email: Mapped[str] = mapped_column("personalEmail", String(255), index=True)
    ethara_email: Mapped[str | None] = mapped_column("etharaEmail", String(255))
    phone: Mapped[str] = mapped_column(String(30))
    aadhaar_last4: Mapped[str | None] = mapped_column("aadhaarLast4", String(4))
    aadhaar_hash: Mapped[str | None] = mapped_column("aadhaarHash", String(64), unique=True)
    gender: Mapped[str | None] = mapped_column(String(30))
    date_of_birth: Mapped[datetime | None] = mapped_column("dateOfBirth", DateTime(timezone=True))
    marital_status: Mapped[str | None] = mapped_column("maritalStatus", String(30))
    experience_type: Mapped[str | None] = mapped_column("experienceType", String(50))
    experience_years: Mapped[int | None] = mapped_column("experienceYears", Integer)
    current_company: Mapped[str | None] = mapped_column("currentCompany", String(255))
    current_ctc: Mapped[float | None] = mapped_column("currentCTC", Float)
    expected_ctc: Mapped[float | None] = mapped_column("expectedCTC", Float)
    notice_period: Mapped[int | None] = mapped_column("noticePeriod", Integer)
    source_type: Mapped[SourceType] = mapped_column("sourceType", enum_source, index=True)
    source_id: Mapped[str | None] = mapped_column("sourceId", String(32))
    position_id: Mapped[str | None] = mapped_column("positionId", ForeignKey("positions.id"), index=True)
    portal_user_id: Mapped[str | None] = mapped_column("portalUserId", ForeignKey("users.id"), index=True)
    college_id: Mapped[str | None] = mapped_column("collegeId", ForeignKey("colleges.id"), index=True)
    vendor_id: Mapped[str | None] = mapped_column("vendorId", ForeignKey("vendors.id"), index=True)
    current_stage: Mapped[CandidateStage] = mapped_column(
        "currentStage", enum_stage, default=CandidateStage.NEW_APPLICATION, index=True
    )
    current_status: Mapped[str] = mapped_column("currentStatus", String(255), default="New Application")
    priority_score: Mapped[int] = mapped_column("priorityScore", Integer, default=0)
    is_duplicate: Mapped[bool] = mapped_column("isDuplicate", Boolean, default=False)
    duplicate_reason: Mapped[str | None] = mapped_column("duplicateReason", Text)
    is_reapplication_blocked: Mapped[bool] = mapped_column(
        "isReapplicationBlocked", Boolean, default=False
    )
    # Dedicated soft-delete flag. Persists across workflow steps (re-screening, stage
    # changes) that overwrite current_status, so a removed candidate stays hidden.
    is_removed: Mapped[bool] = mapped_column("isRemoved", Boolean, default=False, index=True)
    last_applied_at: Mapped[datetime | None] = mapped_column("lastAppliedAt", DateTime(timezone=True))
    resume_url: Mapped[str | None] = mapped_column("resumeUrl", String(500))
    resume_score: Mapped[float | None] = mapped_column("resumeScore", Float)
    resume_summary: Mapped[str | None] = mapped_column("resumeSummary", Text)
    resume_text: Mapped[str | None] = mapped_column("resumeText", Text)
    resume_key_points: Mapped[list[str] | None] = mapped_column("resumeKeyPoints", JSON)
    screening_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    llm_status: Mapped[str | None] = mapped_column(String(50), index=True)
    aadhaar_extracted: Mapped[dict[str, Any] | None] = mapped_column("aadhaarExtracted", JSON)
    aadhaar_ocr_name: Mapped[str | None] = mapped_column("aadhaarOcrName", String(255))
    aadhaar_validation_status: Mapped[str | None] = mapped_column("aadhaarValidationStatus", String(50))
    aadhaar_mismatch_reason: Mapped[str | None] = mapped_column("aadhaarMismatchReason", Text)

    position: Mapped[Position | None] = relationship(back_populates="candidates")
    portal_user: Mapped[User | None] = relationship(back_populates="candidate_profiles")
    college: Mapped[College | None] = relationship(back_populates="candidates")
    vendor: Mapped[Vendor | None] = relationship(back_populates="candidates")
    stage_logs: Mapped[list[StageLog]] = relationship(back_populates="candidate")
    evaluations: Mapped[list[Evaluation]] = relationship(back_populates="candidate")
    documents: Mapped[list[Document]] = relationship(back_populates="candidate")
    contract: Mapped[Contract | None] = relationship(back_populates="candidate", uselist=False)
    compliance_forms: Mapped[list[ComplianceForm]] = relationship(back_populates="candidate")
    audit_logs: Mapped[list[AuditLog]] = relationship(back_populates="candidate")
    escalations: Mapped[list[Escalation]] = relationship(back_populates="candidate")
    notifications: Mapped[list[Notification]] = relationship(back_populates="candidate")
    it_request: Mapped[ITRequest | None] = relationship(back_populates="candidate", uselist=False)
    selection_form: Mapped[SelectionForm | None] = relationship(
        back_populates="candidate", uselist=False
    )
    assessments: Mapped[list[CandidateAssessment]] = relationship(back_populates="candidate")


class CandidateAssessment(Base, TimestampMixin):
    __tablename__ = "candidate_assessments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), index=True)
    level: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)

    deployed_url: Mapped[str | None] = mapped_column("deployedUrl", String(500))
    repo_url: Mapped[str | None] = mapped_column("repoUrl", String(500))
    readme_path: Mapped[str | None] = mapped_column("readmePath", String(500))
    explanation_video_path: Mapped[str | None] = mapped_column("explanationVideoPath", String(500))

    communication_video_path: Mapped[str | None] = mapped_column("communicationVideoPath", String(500))
    prompt_response: Mapped[str | None] = mapped_column("promptResponse", Text)

    auto_score: Mapped[float | None] = mapped_column("autoScore", Float)
    evaluator_score: Mapped[float | None] = mapped_column("evaluatorScore", Float)
    total_score: Mapped[float | None] = mapped_column("totalScore", Float)
    feedback: Mapped[str | None] = mapped_column(Text)
    decision: Mapped[str | None] = mapped_column(String(20))

    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    evaluated_at: Mapped[datetime | None] = mapped_column("evaluatedAt", DateTime(timezone=True))
    evaluator_id: Mapped[str | None] = mapped_column("evaluatorId", ForeignKey("users.id"))

    template_id: Mapped[str | None] = mapped_column("templateId", String(32), ForeignKey("assessment_templates.id"), nullable=True, index=True)

    candidate: Mapped[Candidate] = relationship(back_populates="assessments")
    evaluator: Mapped[User | None] = relationship()
    template: Mapped["AssessmentTemplate | None"] = relationship()


class StageLog(Base):
    __tablename__ = "stage_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), index=True)
    from_stage: Mapped[CandidateStage] = mapped_column("fromStage", enum_stage)
    to_stage: Mapped[CandidateStage] = mapped_column("toStage", enum_stage)
    changed_by: Mapped[str] = mapped_column("changedBy", String(32))
    changed_by_name: Mapped[str | None] = mapped_column("changedByName", String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), default=utcnow, index=True
    )

    candidate: Mapped[Candidate] = relationship(back_populates="stage_logs")


class Evaluation(Base, TimestampMixin):
    __tablename__ = "evaluations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), index=True)
    evaluator_id: Mapped[str] = mapped_column("evaluatorId", ForeignKey("users.id"), index=True)
    technical_skills: Mapped[int | None] = mapped_column("technicalSkills", Integer)
    communication: Mapped[int | None] = mapped_column(Integer)
    problem_solving: Mapped[int | None] = mapped_column("problemSolving", Integer)
    cultural_fit: Mapped[int | None] = mapped_column("culturalFit", Integer)
    attitude: Mapped[int | None] = mapped_column(Integer)
    total_score: Mapped[float | None] = mapped_column("totalScore", Float)
    recommendation: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column("completedAt", DateTime(timezone=True))
    # Interview scheduling
    interview_subject: Mapped[str | None] = mapped_column("interviewSubject", String(500))
    interview_scheduled_at: Mapped[datetime | None] = mapped_column("interviewScheduledAt", DateTime(timezone=True))
    interview_status: Mapped[str | None] = mapped_column("interviewStatus", String(50))
    interview_notes: Mapped[str | None] = mapped_column("interviewNotes", Text)
    interview_mode: Mapped[str | None] = mapped_column("interviewMode", String(50))
    pi_score: Mapped[float | None] = mapped_column("piScore", Float)
    pms_score: Mapped[float | None] = mapped_column("pmsScore", Float)

    candidate: Mapped[Candidate] = relationship(back_populates="evaluations")
    evaluator: Mapped[User] = relationship(back_populates="evaluations")
    pi_rounds: Mapped[list[PiInterviewRound]] = relationship(
        back_populates="evaluation",
        cascade="all, delete-orphan",
        order_by="PiInterviewRound.round_number.asc()",
    )


class PiInterviewRound(Base, TimestampMixin):
    __tablename__ = "pi_interview_rounds"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    evaluation_id: Mapped[str] = mapped_column("evaluationId", ForeignKey("evaluations.id"), index=True)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), index=True)
    evaluator_id: Mapped[str | None] = mapped_column("evaluatorId", ForeignKey("users.id"), index=True)
    round_number: Mapped[int] = mapped_column("roundNumber", Integer, default=1)
    panel_label: Mapped[str | None] = mapped_column("panelLabel", String(255))
    subject: Mapped[str | None] = mapped_column(String(500))
    scheduled_at: Mapped[datetime | None] = mapped_column("scheduledAt", DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column("completedAt", DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(50), default="scheduled", index=True)
    mode: Mapped[str | None] = mapped_column(String(50))
    duration_minutes: Mapped[int] = mapped_column("durationMinutes", Integer, default=60)
    score: Mapped[float | None] = mapped_column(Float)
    remarks: Mapped[str | None] = mapped_column(Text)
    round_decision: Mapped[str | None] = mapped_column("roundDecision", String(50))
    no_further_pi_required: Mapped[bool] = mapped_column("noFurtherPiRequired", Boolean, default=False)
    final_verdict: Mapped[str | None] = mapped_column("finalVerdict", String(50))
    panel_members: Mapped[list[str] | None] = mapped_column("panelMembers", JSON)

    evaluation: Mapped[Evaluation] = relationship(back_populates="pi_rounds")
    candidate: Mapped[Candidate] = relationship()
    evaluator: Mapped[User | None] = relationship()


class SelectionForm(Base, TimestampMixin):
    __tablename__ = "selection_forms"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), unique=True)
    sent_at: Mapped[datetime | None] = mapped_column("sentAt", DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    validated_at: Mapped[datetime | None] = mapped_column("validatedAt", DateTime(timezone=True))
    form_data: Mapped[dict[str, Any] | None] = mapped_column("formData", JSON)

    candidate: Mapped[Candidate] = relationship(back_populates="selection_form")


class CandidateIdCardForm(Base, TimestampMixin):
    __tablename__ = "candidate_id_card_forms"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column(
        "candidateId", ForeignKey("candidates.id"), unique=True, index=True
    )
    name: Mapped[str | None] = mapped_column(String(255))
    employee_id: Mapped[str | None] = mapped_column("employeeId", String(64))
    blood_group: Mapped[str | None] = mapped_column("bloodGroup", String(32))
    emergency_no: Mapped[str | None] = mapped_column("emergencyNo", String(30))
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    submitted_by: Mapped[str | None] = mapped_column("submittedBy", String(32))
    it_completed_at: Mapped[datetime | None] = mapped_column("itCompletedAt", DateTime(timezone=True))
    it_completed_by: Mapped[str | None] = mapped_column("itCompletedBy", String(32))


class Document(Base, TimestampMixin):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_candidateId_type", "candidateId", "type"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), index=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    file_name: Mapped[str] = mapped_column("fileName", String(255))
    file_url: Mapped[str] = mapped_column("fileUrl", String(500))
    file_size: Mapped[int | None] = mapped_column("fileSize", Integer)
    mime_type: Mapped[str | None] = mapped_column("mimeType", String(255))
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    verified_by: Mapped[str | None] = mapped_column("verifiedBy", String(32))
    verified_at: Mapped[datetime | None] = mapped_column("verifiedAt", DateTime(timezone=True))
    ocr_status: Mapped[str] = mapped_column(String(50), default="pending")
    ocr_provider: Mapped[str | None] = mapped_column(String(50))
    extracted_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    llm_extracted_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    candidate: Mapped[Candidate] = relationship(back_populates="documents")


class Contract(Base, TimestampMixin):
    __tablename__ = "contracts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), unique=True)
    status: Mapped[ContractStatus] = mapped_column(enum_contract_status, default=ContractStatus.DRAFT)
    documenso_id: Mapped[str | None] = mapped_column("documensoId", String(255), index=True)
    template_id: Mapped[int | None] = mapped_column("templateId", Integer)
    signed_url: Mapped[str | None] = mapped_column("signedUrl", String(500))
    pdf_url: Mapped[str | None] = mapped_column("pdfUrl", String(500))
    pdf_storage_key: Mapped[str | None] = mapped_column("pdfStorageKey", String(500))
    # Each completed Documenso envelope can bundle several signed PDFs (e.g. Offer Letter,
    # NDA, Employment Agreement). pdf_url keeps the primary item (the offer letter) for
    # backward compatibility; signed_items records every item so they surface as separate
    # documents: list of {itemId, title, order, type, url, storageKey}.
    signed_items: Mapped[list[dict[str, Any]] | None] = mapped_column("signedItems", JSON, nullable=True)
    # Documents issued in the current Documenso send attempt:
    # [{documensoId, templateId, templateTitle, signingUrl, status, sentAt, primary}].
    # This keeps the UI honest when HR sends several templates at once.
    sent_documents: Mapped[list[dict[str, Any]] | None] = mapped_column("sentDocuments", JSON, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column("sentAt", DateTime(timezone=True))
    viewed_at: Mapped[datetime | None] = mapped_column("viewedAt", DateTime(timezone=True))
    signed_at: Mapped[datetime | None] = mapped_column("signedAt", DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column("expiresAt", DateTime(timezone=True))
    ctc: Mapped[float | None] = mapped_column(Float)
    joining_date: Mapped[datetime | None] = mapped_column("joiningDate", DateTime(timezone=True))

    candidate: Mapped[Candidate] = relationship(back_populates="contract")
    documenso_fields: Mapped[list[DocumensoContractField]] = relationship(
        back_populates="contract", cascade="all, delete-orphan"
    )

    @property
    def template_title(self) -> str | None:
        sent_documents = self.sent_documents or []
        primary = next((doc for doc in sent_documents if doc.get("primary")), None)
        if primary is None and sent_documents:
            primary = sent_documents[0]
        return (primary or {}).get("templateTitle")


class ComplianceForm(Base, TimestampMixin):
    __tablename__ = "compliance_forms"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), index=True)
    form_type: Mapped[str] = mapped_column("formType", String(50))
    form_title: Mapped[str] = mapped_column("formTitle", String(255))
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    form_data: Mapped[dict[str, Any] | None] = mapped_column("formData", JSON)
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column("verifiedAt", DateTime(timezone=True))
    # Documenso e-sign statutory/compliance forms (Form 11 / Form 2 / Form F), signed by the
    # candidate from their dashboard before employee credentials are issued.
    documenso_id: Mapped[str | None] = mapped_column("documensoId", String(255), index=True)
    documenso_template_id: Mapped[int | None] = mapped_column("documensoTemplateId", Integer)
    signed_url: Mapped[str | None] = mapped_column("signedUrl", String(500))
    pdf_url: Mapped[str | None] = mapped_column("pdfUrl", String(500))
    sent_at: Mapped[datetime | None] = mapped_column("sentAt", DateTime(timezone=True))
    signed_at: Mapped[datetime | None] = mapped_column("signedAt", DateTime(timezone=True))

    candidate: Mapped[Candidate] = relationship(back_populates="compliance_forms")


class Escalation(Base, TimestampMixin):
    __tablename__ = "escalations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), index=True)
    stage: Mapped[str] = mapped_column(String(100))
    responsible_user_id: Mapped[str] = mapped_column(
        "responsibleUserId", ForeignKey("users.id"), index=True
    )
    sla_deadline: Mapped[datetime] = mapped_column(
        "slaDeadline", DateTime(timezone=True), index=True
    )
    delayed_by: Mapped[str] = mapped_column("delayedBy", String(100))
    escalation_level: Mapped[int] = mapped_column("escalationLevel", Integer, default=1)
    status: Mapped[EscalationStatus] = mapped_column(
        enum_escalation_status, default=EscalationStatus.OPEN, index=True
    )
    email_sent_at: Mapped[datetime | None] = mapped_column("emailSentAt", DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column("resolvedAt", DateTime(timezone=True))
    resolved_by: Mapped[str | None] = mapped_column("resolvedBy", String(32))
    notes: Mapped[str | None] = mapped_column(Text)

    candidate: Mapped[Candidate] = relationship(back_populates="escalations")
    responsible_user: Mapped[User] = relationship(back_populates="escalations")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("users.id"), index=True)
    candidate_id: Mapped[str | None] = mapped_column(
        "candidateId", ForeignKey("candidates.id"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    type: Mapped[NotificationType] = mapped_column(enum_notification_type, default=NotificationType.INFO)
    is_read: Mapped[bool] = mapped_column("isRead", Boolean, default=False, index=True)
    entity_type: Mapped[str | None] = mapped_column("entityType", String(100), nullable=True, index=True)
    entity_id: Mapped[str | None] = mapped_column("entityId", String(32), nullable=True, index=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), default=utcnow, index=True
    )

    user: Mapped[User] = relationship(back_populates="notifications")
    candidate: Mapped[Candidate | None] = relationship(back_populates="notifications")


class ITRequest(Base, TimestampMixin):
    __tablename__ = "it_requests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    candidate_id: Mapped[str] = mapped_column("candidateId", ForeignKey("candidates.id"), unique=True)
    requested_by: Mapped[str] = mapped_column("requestedBy", String(32))
    assigned_to_id: Mapped[str | None] = mapped_column(
        "assignedToId", ForeignKey("users.id"), index=True
    )
    suggested_email: Mapped[str] = mapped_column("suggestedEmail", String(255))
    created_email: Mapped[str | None] = mapped_column("createdEmail", String(255))
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    completed_at: Mapped[datetime | None] = mapped_column("completedAt", DateTime(timezone=True))

    candidate: Mapped[Candidate] = relationship(back_populates="it_request")
    assigned_to: Mapped[User | None] = relationship(back_populates="it_requests")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    entity_type: Mapped[str] = mapped_column("entityType", String(100), index=True)
    entity_id: Mapped[str] = mapped_column("entityId", String(32), index=True)
    action: Mapped[str] = mapped_column(String(255))
    performed_by: Mapped[str] = mapped_column("performedBy", String(32))
    performed_by_name: Mapped[str | None] = mapped_column("performedByName", String(255))
    performed_by_role: Mapped[str | None] = mapped_column("performedByRole", String(100))
    candidate_id: Mapped[str | None] = mapped_column(
        "candidateId", ForeignKey("candidates.id"), index=True
    )
    user_id: Mapped[str | None] = mapped_column("userId", ForeignKey("users.id"), index=True)
    ip_address: Mapped[str | None] = mapped_column("ipAddress", String(100))
    user_agent: Mapped[str | None] = mapped_column("userAgent", String(255))
    old_value: Mapped[dict[str, Any] | None] = mapped_column("oldValue", JSON)
    new_value: Mapped[dict[str, Any] | None] = mapped_column("newValue", JSON)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), default=utcnow, index=True
    )

    candidate: Mapped[Candidate | None] = relationship(back_populates="audit_logs")
    user: Mapped[User | None] = relationship(back_populates="audit_logs")


class AdminSetting(Base, TimestampMixin):
    __tablename__ = "admin_settings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    namespace: Mapped[str] = mapped_column(String(100), default="system", index=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    value: Mapped[dict[str, Any] | list[Any] | str | int | float | bool | None] = mapped_column(JSON)
    description: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[str | None] = mapped_column("updatedBy", String(32))


class AuthCode(Base):
    __tablename__ = "auth_codes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    user_id: Mapped[str | None] = mapped_column("userId", ForeignKey("users.id"))
    email: Mapped[str] = mapped_column(String(255), index=True)
    purpose: Mapped[AuthCodePurpose] = mapped_column(enum_auth_code_purpose, index=True)
    code_hash: Mapped[str] = mapped_column("codeHash", String(64), index=True)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column("consumedAt", DateTime(timezone=True))
    # Number of wrong-guess attempts against this code; once it crosses the limit
    # the code is consumed so it can't be brute-forced further.
    attempt_count: Mapped[int] = mapped_column(
        "attemptCount", Integer, nullable=False, server_default="0", default=0
    )
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow)

    user: Mapped[User | None] = relationship(back_populates="auth_codes")


class DocumensoTemplateCache(Base):
    __tablename__ = "documenso_template_cache"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    template_id: Mapped[int] = mapped_column("templateId", Integer, unique=True, index=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    fields: Mapped[list[Any] | None] = mapped_column(JSON)
    recipients: Mapped[list[Any] | None] = mapped_column(JSON)
    synced_at: Mapped[datetime] = mapped_column("syncedAt", DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class DocumensoSyncState(Base):
    __tablename__ = "documenso_sync_state"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    last_synced_at: Mapped[datetime | None] = mapped_column("lastSyncedAt", DateTime(timezone=True))
    last_document_id: Mapped[int | None] = mapped_column("lastDocumentId", Integer)
    sync_status: Mapped[str] = mapped_column("syncStatus", String(50), default="idle")
    error_message: Mapped[str | None] = mapped_column("errorMessage", Text)
    documents_processed: Mapped[int] = mapped_column("documentsProcessed", Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class DocumensoSyncLog(Base):
    __tablename__ = "documenso_sync_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    log_type: Mapped[str] = mapped_column("logType", String(50), index=True)
    status: Mapped[str] = mapped_column(String(50), index=True)
    message: Mapped[str] = mapped_column(Text)
    document_id: Mapped[int | None] = mapped_column("documentId", Integer, index=True)
    candidate_id: Mapped[str | None] = mapped_column(
        "candidateId", String(32), ForeignKey("candidates.id"), nullable=True, index=True
    )
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), default=utcnow, index=True
    )


class DocumensoContractField(Base):
    __tablename__ = "documenso_contract_fields"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    contract_id: Mapped[str] = mapped_column(
        "contractId", String(32), ForeignKey("contracts.id"), index=True
    )
    candidate_id: Mapped[str] = mapped_column(
        "candidateId", String(32), ForeignKey("candidates.id"), index=True
    )
    field_name: Mapped[str] = mapped_column("fieldName", String(255))
    field_type: Mapped[str] = mapped_column("fieldType", String(100))
    field_value: Mapped[str | None] = mapped_column("fieldValue", Text)
    recipient_email: Mapped[str | None] = mapped_column("recipientEmail", String(255))
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), default=utcnow
    )

    contract: Mapped[Contract] = relationship(back_populates="documenso_fields")


class DocumensoSignedProfile(Base):
    __tablename__ = "documenso_signed_profiles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    documenso_doc_id: Mapped[int] = mapped_column(
        "documensoDocId", Integer, unique=True, index=True
    )
    template_id: Mapped[int | None] = mapped_column("templateId", Integer, index=True)
    template_title: Mapped[str | None] = mapped_column("templateTitle", String(500))
    recipient_email: Mapped[str] = mapped_column("recipientEmail", String(255), index=True)
    recipient_name: Mapped[str | None] = mapped_column("recipientName", String(255))
    completed_at: Mapped[datetime | None] = mapped_column(
        "completedAt", DateTime(timezone=True), index=True
    )
    field_values: Mapped[dict[str, Any] | None] = mapped_column("fieldValues", JSON)
    raw_fields: Mapped[list[Any] | None] = mapped_column("rawFields", JSON)
    pdf_url: Mapped[str | None] = mapped_column("pdfUrl", String(500))
    candidate_id: Mapped[str | None] = mapped_column(
        "candidateId", String(32), ForeignKey("candidates.id"), nullable=True, index=True
    )
    candidate: Mapped[Candidate | None] = relationship()
    synced_at: Mapped[datetime] = mapped_column(
        "syncedAt", DateTime(timezone=True), default=utcnow
    )
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), default=utcnow
    )


class SyncJobRun(Base):
    """Persistent log of every scheduled / manual sync job run."""
    __tablename__ = "sync_job_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    job_name: Mapped[str] = mapped_column("jobName", String(100), index=True)
    trigger: Mapped[str] = mapped_column(String(50), default="cron")  # cron | manual
    status: Mapped[str] = mapped_column(String(50), default="running")  # running | completed | failed
    started_at: Mapped[datetime] = mapped_column("startedAt", DateTime(timezone=True), default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column("finishedAt", DateTime(timezone=True))
    duration_seconds: Mapped[int | None] = mapped_column("durationSeconds", Integer)
    documents_processed: Mapped[int] = mapped_column("documentsProcessed", Integer, default=0)
    errors: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)


class LeaveBalance(Base, TimestampMixin):
    __tablename__ = "leave_balances"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    leave_type: Mapped[str] = mapped_column("leaveType", String(50), index=True)
    year: Mapped[int] = mapped_column(Integer)
    total_days: Mapped[float] = mapped_column("totalDays", Float, default=0)
    used_days: Mapped[float] = mapped_column("usedDays", Float, default=0)
    pending_days: Mapped[float] = mapped_column("pendingDays", Float, default=0)

    employee_profile: Mapped[EmployeeProfile] = relationship(back_populates="leave_balances")


class EmployeeLeaveBalance(Base, TimestampMixin):
    """greytHR-sourced leave balances, the source of truth shown on the Leave screen.

    Keyed by greytHR ``employeeNo`` (== HRMS ``employeeCode``, e.g. GRP1074) rather
    than a profile FK, so a balance can be stored even before the employee record is
    linked. A daily cron upserts one row per (employee_code, leave_code, year). All
    day counts are decimals — greytHR returns fractional accruals (e.g. SL 11.58),
    never cast to int. ``balance`` is the authoritative "days remaining" to display.
    """

    __tablename__ = "employee_leave_balances"
    __table_args__ = (
        UniqueConstraint("employeeCode", "leaveCode", "year", name="uq_emp_leave_balance_code_year"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_code: Mapped[str] = mapped_column("employeeCode", String(64), index=True)
    leave_code: Mapped[str] = mapped_column("leaveCode", String(32), index=True)
    leave_type: Mapped[str] = mapped_column("leaveType", String(120))
    year: Mapped[int] = mapped_column(Integer, index=True)
    opening: Mapped[float] = mapped_column(Float, default=0)
    granted: Mapped[float] = mapped_column(Float, default=0)
    availed: Mapped[float] = mapped_column(Float, default=0)
    applied: Mapped[float] = mapped_column(Float, default=0)
    lapsed: Mapped[float] = mapped_column(Float, default=0)
    deducted: Mapped[float] = mapped_column(Float, default=0)
    encashed: Mapped[float] = mapped_column(Float, default=0)
    balance: Mapped[float] = mapped_column(Float, default=0)
    synced_at: Mapped[datetime] = mapped_column("syncedAt", DateTime(timezone=True), default=utcnow)


class LeaveRequest(Base, TimestampMixin):
    __tablename__ = "leave_requests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    leave_type: Mapped[str] = mapped_column("leaveType", String(50), index=True)
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    start_date: Mapped[datetime] = mapped_column("startDate", DateTime(timezone=True))
    end_date: Mapped[datetime] = mapped_column("endDate", DateTime(timezone=True))
    days: Mapped[float] = mapped_column(Float)
    reason: Mapped[str | None] = mapped_column(Text)
    manager_id: Mapped[str | None] = mapped_column(
        "managerId", ForeignKey("users.id"), nullable=True
    )
    manager_action: Mapped[str | None] = mapped_column("managerAction", String(30))
    manager_action_at: Mapped[datetime | None] = mapped_column("managerActionAt", DateTime(timezone=True))
    manager_remarks: Mapped[str | None] = mapped_column("managerRemarks", Text)
    hr_reviewed_by: Mapped[str | None] = mapped_column("hrReviewedBy", ForeignKey("users.id"))
    hr_reviewed_at: Mapped[datetime | None] = mapped_column("hrReviewedAt", DateTime(timezone=True))
    hr_remarks: Mapped[str | None] = mapped_column("hrRemarks", Text)

    employee_profile: Mapped[EmployeeProfile] = relationship(back_populates="leave_requests")
    manager: Mapped[User | None] = relationship(foreign_keys=[manager_id])
    hr_reviewer: Mapped[User | None] = relationship(foreign_keys=[hr_reviewed_by])


class AttendanceRecord(Base, TimestampMixin):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("employeeProfileId", "attendanceDate", name="uq_attendance_employee_date"),
        UniqueConstraint("employeeCode", "attendanceDate", name="uq_attendance_employee_code_date"),
        Index("ix_attendance_records_date_status", "attendanceDate", "status"),
        Index("ix_attendance_records_employee_date", "employeeProfileId", "attendanceDate"),
        Index("ix_attendance_records_department_status", "department", "status"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str | None] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True, nullable=True
    )
    employee_code: Mapped[str] = mapped_column("employeeCode", String(64), index=True)
    employee_name: Mapped[str | None] = mapped_column("employeeName", String(255), index=True)
    department: Mapped[str | None] = mapped_column(String(255), index=True)
    attendance_date: Mapped[date] = mapped_column("attendanceDate", Date, index=True)
    in_time: Mapped[datetime | None] = mapped_column("inTime", DateTime(timezone=True))
    out_time: Mapped[datetime | None] = mapped_column("outTime", DateTime(timezone=True))
    worked_hours: Mapped[float | None] = mapped_column("workedHours", Float)
    status: Mapped[AttendanceStatus] = mapped_column(
        enum_attendance_status, default=AttendanceStatus.ABSENT, index=True
    )
    source: Mapped[AttendanceSource] = mapped_column(
        enum_attendance_source, default=AttendanceSource.BIOMETRIC, index=True
    )
    is_edited: Mapped[bool] = mapped_column("isEdited", Boolean, default=False, index=True)
    original_in_time: Mapped[datetime | None] = mapped_column(
        "originalInTime", DateTime(timezone=True)
    )
    original_out_time: Mapped[datetime | None] = mapped_column(
        "originalOutTime", DateTime(timezone=True)
    )
    original_status: Mapped[AttendanceStatus | None] = mapped_column(
        "originalStatus", enum_attendance_status
    )
    edited_by: Mapped[str | None] = mapped_column("editedBy", ForeignKey("users.id"))
    edited_at: Mapped[datetime | None] = mapped_column("editedAt", DateTime(timezone=True))
    edit_reason: Mapped[str | None] = mapped_column("editReason", Text)
    is_final: Mapped[bool] = mapped_column("isFinal", Boolean, default=False, index=True)
    raw_payload: Mapped[dict[str, Any] | None] = mapped_column("rawPayload", JSON)

    employee_profile: Mapped[EmployeeProfile | None] = relationship(back_populates="attendance_records")
    editor: Mapped[User | None] = relationship(foreign_keys=[edited_by])


class AttendanceSyncLog(Base, TimestampMixin):
    __tablename__ = "attendance_sync_logs"
    __table_args__ = (
        UniqueConstraint("syncDate", name="uq_attendance_sync_logs_sync_date"),
        Index("ix_attendance_sync_logs_status_date", "status", "syncDate"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    sync_date: Mapped[date] = mapped_column("syncDate", Date, index=True)
    source: Mapped[str] = mapped_column(String(50), default="essl")
    status: Mapped[AttendanceSyncStatus] = mapped_column(
        enum_attendance_sync_status, default=AttendanceSyncStatus.RUNNING, index=True
    )
    started_at: Mapped[datetime] = mapped_column("startedAt", DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column("finishedAt", DateTime(timezone=True))
    rows_seen: Mapped[int] = mapped_column("rowsSeen", Integer, default=0)
    rows_synced: Mapped[int] = mapped_column("rowsSynced", Integer, default=0)
    unmapped_count: Mapped[int] = mapped_column("unmappedCount", Integer, default=0)
    unmapped_codes: Mapped[list[str]] = mapped_column("unmappedCodes", JSON, default=list)
    error: Mapped[str | None] = mapped_column(Text)
    is_final: Mapped[bool] = mapped_column("isFinal", Boolean, default=True, index=True)


class ResourceProject(Base, TimestampMixin):
    __tablename__ = "resource_projects"
    __table_args__ = (
        Index("ix_resource_projects_manager_status", "managerId", "status"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String(255), index=True)
    code: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    manager_id: Mapped[str] = mapped_column("managerId", ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    start_date: Mapped[date | None] = mapped_column("startDate", Date)
    end_date: Mapped[date | None] = mapped_column("endDate", Date)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    manager: Mapped[User] = relationship(foreign_keys=[manager_id])
    leads: Mapped[list["ResourceProjectLead"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    assignments: Mapped[list["ResourceAssignment"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ResourceProjectLead(Base, TimestampMixin):
    __tablename__ = "resource_project_leads"
    __table_args__ = (
        UniqueConstraint("projectId", "userId", name="uq_resource_project_lead_user"),
        Index("ix_resource_project_leads_user_project", "userId", "projectId"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    project_id: Mapped[str] = mapped_column("projectId", ForeignKey("resource_projects.id"), index=True)
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("users.id"), index=True)
    role_label: Mapped[str] = mapped_column("roleLabel", String(30), default="pl_tpm")
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    project: Mapped[ResourceProject] = relationship(back_populates="leads")
    user: Mapped[User] = relationship(foreign_keys=[user_id])


class ResourceAssignment(Base, TimestampMixin):
    __tablename__ = "resource_assignments"
    __table_args__ = (
        UniqueConstraint("employeeProfileId", "projectId", "status", name="uq_resource_assignment_employee_project_status"),
        Index("ix_resource_assignments_project_status", "projectId", "status"),
        Index("ix_resource_assignments_reporting_member", "reportingMemberProfileId"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    project_id: Mapped[str] = mapped_column("projectId", ForeignKey("resource_projects.id"), index=True)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    reporting_member_profile_id: Mapped[str | None] = mapped_column(
        "reportingMemberProfileId", ForeignKey("employee_profiles.id"), nullable=True
    )
    assigned_by: Mapped[str | None] = mapped_column("assignedBy", ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column("assignedAt", DateTime(timezone=True), default=utcnow, index=True)
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    project: Mapped[ResourceProject] = relationship(back_populates="assignments")
    employee_profile: Mapped[EmployeeProfile] = relationship(foreign_keys=[employee_profile_id])
    reporting_member: Mapped[EmployeeProfile | None] = relationship(foreign_keys=[reporting_member_profile_id])
    assigner: Mapped[User | None] = relationship(foreign_keys=[assigned_by])


class ResourceTransferRequest(Base, TimestampMixin):
    __tablename__ = "resource_transfer_requests"
    __table_args__ = (
        Index("ix_resource_transfer_requests_status_reviewer", "status", "reviewerId"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    from_project_id: Mapped[str] = mapped_column("fromProjectId", ForeignKey("resource_projects.id"), index=True)
    to_project_id: Mapped[str] = mapped_column("toProjectId", ForeignKey("resource_projects.id"), index=True)
    reporting_member_profile_id: Mapped[str | None] = mapped_column(
        "reportingMemberProfileId", ForeignKey("employee_profiles.id"), nullable=True
    )
    requested_by: Mapped[str] = mapped_column("requestedBy", ForeignKey("users.id"), index=True)
    reviewer_id: Mapped[str | None] = mapped_column("reviewerId", ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    reason: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column("decidedAt", DateTime(timezone=True))
    decision_comment: Mapped[str | None] = mapped_column("decisionComment", Text)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    employee_profile: Mapped[EmployeeProfile] = relationship(foreign_keys=[employee_profile_id])
    from_project: Mapped[ResourceProject] = relationship(foreign_keys=[from_project_id])
    to_project: Mapped[ResourceProject] = relationship(foreign_keys=[to_project_id])
    reporting_member: Mapped[EmployeeProfile | None] = relationship(foreign_keys=[reporting_member_profile_id])
    requester: Mapped[User] = relationship(foreign_keys=[requested_by])
    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewer_id])


# ---------------------------------------------------------------------------
# Project Governance & Budget Management
#
# Standalone project master that supersedes Resource Segregation. Reimbursement
# and dinner requests link to a Project (see project_id below) so spend is
# tracked per project. Budget proposals run a two-stage approval: functional
# (CTO for Technical / COO for Generalist, resolved from config) then Leadership.
# Admin-defined custom columns live in ProjectFieldDef; their values go in
# Project.custom_fields keyed by ProjectFieldDef.key.
# ---------------------------------------------------------------------------


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    __table_args__ = (
        Index("ix_projects_type_status", "projectType", "rfpStatus"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    internal_name: Mapped[str] = mapped_column("internalName", String(255), index=True)
    external_name: Mapped[str | None] = mapped_column("externalName", String(255))
    client: Mapped[str | None] = mapped_column(String(255), index=True)
    platform: Mapped[str | None] = mapped_column(String(120))
    # technical | generalist  (drives functional approver routing)
    project_type: Mapped[str] = mapped_column("projectType", String(20), default="technical", index=True)
    # rfp | production | delivered
    rfp_status: Mapped[str] = mapped_column("rfpStatus", String(20), default="rfp", index=True)
    # ongoing | completed
    delivery_status: Mapped[str] = mapped_column("deliveryStatus", String(20), default="ongoing", index=True)
    appsheet_approval: Mapped[str | None] = mapped_column("appsheetApproval", String(40))
    trajectory_cost_approval: Mapped[str | None] = mapped_column("trajectoryCostApproval", String(40))
    aht: Mapped[float | None] = mapped_column(Float)
    target_volume: Mapped[int | None] = mapped_column("targetVolume", Integer)
    delivered_volume: Mapped[int | None] = mapped_column("deliveredVolume", Integer)
    date_of_delivery: Mapped[date | None] = mapped_column("dateOfDelivery", Date)
    tpm_user_id: Mapped[str | None] = mapped_column("tpmUserId", ForeignKey("users.id"), index=True)
    fte_demand: Mapped[int | None] = mapped_column("fteDemand", Integer)
    fte_count: Mapped[int | None] = mapped_column("fteCount", Integer)
    intern_count: Mapped[int | None] = mapped_column("internCount", Integer)
    total_members: Mapped[int | None] = mapped_column("totalMembers", Integer)
    approved_budget: Mapped[float | None] = mapped_column("approvedBudget", Float)
    consumed_budget: Mapped[float | None] = mapped_column("consumedBudget", Float)
    currency: Mapped[str] = mapped_column(String(10), default="INR")
    is_archived: Mapped[bool] = mapped_column("isArchived", Boolean, default=False, index=True)
    # Values for admin-defined custom columns, keyed by ProjectFieldDef.key.
    custom_fields: Mapped[dict[str, Any]] = mapped_column("customFields", JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column("createdBy", ForeignKey("users.id"))

    tpm: Mapped[User | None] = relationship(foreign_keys=[tpm_user_id])
    creator: Mapped[User | None] = relationship(foreign_keys=[created_by])
    leads: Mapped[list["ProjectLead"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    budgets: Mapped[list["ProjectBudget"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class ProjectLead(Base, TimestampMixin):
    __tablename__ = "project_leads"
    __table_args__ = (
        UniqueConstraint("projectId", "userId", "role", name="uq_project_leads_project_user_role"),
        Index("ix_project_leads_user", "userId"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    project_id: Mapped[str] = mapped_column("projectId", ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="pl")  # tpm | pl

    project: Mapped[Project] = relationship(back_populates="leads")
    user: Mapped[User] = relationship(foreign_keys=[user_id])


class ProjectFieldDef(Base, TimestampMixin):
    """Admin-configurable custom column definition (restructurable headers)."""

    __tablename__ = "project_field_defs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(160))
    # text | number | currency | date | select | boolean
    data_type: Mapped[str] = mapped_column("dataType", String(20), default="text")
    options: Mapped[list[str]] = mapped_column(JSON, default=list)
    order_index: Mapped[int] = mapped_column("orderIndex", Integer, default=0, index=True)
    group: Mapped[str | None] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column("isActive", Boolean, default=True, index=True)
    created_by: Mapped[str | None] = mapped_column("createdBy", String(32))


class ProjectBudget(Base, TimestampMixin):
    """Budget proposal + revision history with two-stage approval."""

    __tablename__ = "project_budgets"
    __table_args__ = (
        Index("ix_project_budgets_project_status", "projectId", "status"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    project_id: Mapped[str] = mapped_column("projectId", ForeignKey("projects.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(10), default="INR")
    period: Mapped[str | None] = mapped_column(String(40))  # e.g. "2026-06", "Q2-2026", "overall"
    justification: Mapped[str | None] = mapped_column(Text)
    # draft | submitted | pending_functional_approval | functional_approved
    # | pending_leadership_approval | approved | rejected
    status: Mapped[str] = mapped_column(String(40), default="draft", index=True)
    proposed_by: Mapped[str | None] = mapped_column("proposedBy", ForeignKey("users.id"))
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))

    # Stage 1 — functional approval (CTO/COO by project type).
    functional_approver_id: Mapped[str | None] = mapped_column("functionalApproverId", ForeignKey("users.id"))
    functional_decided_by: Mapped[str | None] = mapped_column("functionalDecidedBy", ForeignKey("users.id"))
    functional_decided_at: Mapped[datetime | None] = mapped_column("functionalDecidedAt", DateTime(timezone=True))
    functional_decision: Mapped[str | None] = mapped_column("functionalDecision", String(20))
    functional_comment: Mapped[str | None] = mapped_column("functionalComment", Text)
    functional_token_hash: Mapped[str | None] = mapped_column("functionalTokenHash", String(128))
    functional_token_expires_at: Mapped[datetime | None] = mapped_column(
        "functionalTokenExpiresAt", DateTime(timezone=True)
    )

    # Stage 2 — leadership final approval.
    leadership_decided_by: Mapped[str | None] = mapped_column("leadershipDecidedBy", ForeignKey("users.id"))
    leadership_decided_at: Mapped[datetime | None] = mapped_column("leadershipDecidedAt", DateTime(timezone=True))
    leadership_decision: Mapped[str | None] = mapped_column("leadershipDecision", String(20))
    leadership_comment: Mapped[str | None] = mapped_column("leadershipComment", Text)
    leadership_token_hash: Mapped[str | None] = mapped_column("leadershipTokenHash", String(128))
    leadership_token_expires_at: Mapped[datetime | None] = mapped_column(
        "leadershipTokenExpiresAt", DateTime(timezone=True)
    )

    project: Mapped[Project] = relationship(back_populates="budgets")
    proposer: Mapped[User | None] = relationship(foreign_keys=[proposed_by])
    functional_approver: Mapped[User | None] = relationship(foreign_keys=[functional_approver_id])
    functional_decider: Mapped[User | None] = relationship(foreign_keys=[functional_decided_by])
    leadership_decider: Mapped[User | None] = relationship(foreign_keys=[leadership_decided_by])
    actions: Mapped[list["ProjectBudgetActionLog"]] = relationship(
        back_populates="budget", cascade="all, delete-orphan"
    )


class ProjectBudgetActionLog(Base):
    __tablename__ = "project_budget_action_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    budget_id: Mapped[str] = mapped_column("budgetId", ForeignKey("project_budgets.id"), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    stage: Mapped[str | None] = mapped_column(String(40))  # functional | leadership | proposal
    from_status: Mapped[str | None] = mapped_column("fromStatus", String(40))
    to_status: Mapped[str | None] = mapped_column("toStatus", String(40))
    comment: Mapped[str | None] = mapped_column(Text)
    performed_by: Mapped[str] = mapped_column("performedBy", String(32))
    performed_by_name: Mapped[str | None] = mapped_column("performedByName", String(255))
    performed_by_role: Mapped[str | None] = mapped_column("performedByRole", String(100))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow, index=True)

    budget: Mapped[ProjectBudget] = relationship(back_populates="actions")


class EmployeeSkillTag(Base):
    __tablename__ = "employee_skill_tags"
    __table_args__ = (
        UniqueConstraint("employeeProfileId", "skill", name="uq_employee_skill_tags_employee_skill"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    skill: Mapped[str] = mapped_column(String(50), index=True)
    # Star rating, 1-5.
    rating: Mapped[int] = mapped_column(Integer)
    tagged_by: Mapped[str | None] = mapped_column("taggedBy", ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    employee_profile: Mapped[EmployeeProfile] = relationship()
    tagger: Mapped[User | None] = relationship(foreign_keys=[tagged_by])


class SkillCatalog(Base):
    """Global, DB-backed catalog of skill tags (replaces the old hardcoded list).

    Users with Employee-Evaluation access can add new entries; every
    ``EmployeeSkillTag.skill`` references one of these keys.
    """

    __tablename__ = "skill_catalog"
    __table_args__ = (UniqueConstraint("key", name="uq_skill_catalog_key"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    key: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column("isActive", Boolean, default=True)
    created_by: Mapped[str | None] = mapped_column("createdBy", ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class ReimbursementRequest(Base, TimestampMixin):
    __tablename__ = "reimbursement_requests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    employee_name: Mapped[str] = mapped_column("employeeName", String(255))
    employee_code: Mapped[str] = mapped_column("employeeCode", String(64), index=True)
    department: Mapped[str | None] = mapped_column(String(255))
    project_name: Mapped[str | None] = mapped_column("projectName", String(255))
    project_id: Mapped[str | None] = mapped_column("projectId", ForeignKey("projects.id"), nullable=True, index=True)
    category: Mapped[str | None] = mapped_column(String(255), index=True)
    expense_date: Mapped[date | None] = mapped_column("expenseDate", Date)
    expense_amount: Mapped[float | None] = mapped_column("expenseAmount", Float)
    currency: Mapped[str] = mapped_column(String(10), default="INR")
    reason: Mapped[str | None] = mapped_column(Text)
    payment_method: Mapped[str | None] = mapped_column("paymentMethod", String(100))
    receipt_file_name: Mapped[str | None] = mapped_column("receiptFileName", String(255))
    receipt_file_url: Mapped[str | None] = mapped_column("receiptFileUrl", String(500))
    receipt_mime_type: Mapped[str | None] = mapped_column("receiptMimeType", String(255))
    receipt_file_size: Mapped[int | None] = mapped_column("receiptFileSize", Integer)
    receipt_ocr: Mapped[dict[str, Any] | None] = mapped_column("receiptOcr", JSON)
    declaration_accepted: Mapped[bool] = mapped_column("declarationAccepted", Boolean, default=False)
    status: Mapped[str] = mapped_column(String(80), default="draft", index=True)
    manager_id: Mapped[str | None] = mapped_column(
        "managerId", ForeignKey("users.id"), nullable=True, index=True
    )
    manager_reviewed_by: Mapped[str | None] = mapped_column("managerReviewedBy", ForeignKey("users.id"))
    manager_reviewed_at: Mapped[datetime | None] = mapped_column("managerReviewedAt", DateTime(timezone=True))
    manager_comments: Mapped[str | None] = mapped_column("managerComments", Text)
    finance_reviewed_by: Mapped[str | None] = mapped_column("financeReviewedBy", ForeignKey("users.id"))
    finance_reviewed_at: Mapped[datetime | None] = mapped_column("financeReviewedAt", DateTime(timezone=True))
    finance_comments: Mapped[str | None] = mapped_column("financeComments", Text)
    # Multi-stage approval: Manager -> HR -> Leadership -> Office Admin (pay) -> employee ack.
    hr_reviewed_by: Mapped[str | None] = mapped_column("hrReviewedBy", ForeignKey("users.id"))
    hr_reviewed_at: Mapped[datetime | None] = mapped_column("hrReviewedAt", DateTime(timezone=True))
    hr_comments: Mapped[str | None] = mapped_column("hrComments", Text)
    leadership_reviewed_by: Mapped[str | None] = mapped_column("leadershipReviewedBy", ForeignKey("users.id"))
    leadership_reviewed_at: Mapped[datetime | None] = mapped_column("leadershipReviewedAt", DateTime(timezone=True))
    leadership_comments: Mapped[str | None] = mapped_column("leadershipComments", Text)
    acknowledged_at: Mapped[datetime | None] = mapped_column("acknowledgedAt", DateTime(timezone=True))
    paid_by: Mapped[str | None] = mapped_column("paidBy", ForeignKey("users.id"))
    paid_at: Mapped[datetime | None] = mapped_column("paidAt", DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    missing_fields: Mapped[list[str]] = mapped_column("missingFields", JSON, default=list)

    employee_profile: Mapped[EmployeeProfile] = relationship()
    project: Mapped[Project | None] = relationship(foreign_keys=[project_id])
    manager: Mapped[User | None] = relationship(foreign_keys=[manager_id])
    manager_reviewer: Mapped[User | None] = relationship(foreign_keys=[manager_reviewed_by])
    finance_reviewer: Mapped[User | None] = relationship(foreign_keys=[finance_reviewed_by])
    hr_reviewer: Mapped[User | None] = relationship(foreign_keys=[hr_reviewed_by])
    leadership_reviewer: Mapped[User | None] = relationship(foreign_keys=[leadership_reviewed_by])
    payer: Mapped[User | None] = relationship(foreign_keys=[paid_by])
    actions: Mapped[list[ReimbursementActionLog]] = relationship(
        back_populates="reimbursement",
        cascade="all, delete-orphan",
    )


class ReimbursementActionLog(Base):
    __tablename__ = "reimbursement_action_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    reimbursement_id: Mapped[str] = mapped_column(
        "reimbursementId", ForeignKey("reimbursement_requests.id"), index=True
    )
    action: Mapped[str] = mapped_column(String(100), index=True)
    from_status: Mapped[str | None] = mapped_column("fromStatus", String(80))
    to_status: Mapped[str | None] = mapped_column("toStatus", String(80))
    comment: Mapped[str | None] = mapped_column(Text)
    performed_by: Mapped[str] = mapped_column("performedBy", ForeignKey("users.id"), index=True)
    performed_by_name: Mapped[str | None] = mapped_column("performedByName", String(255))
    performed_by_role: Mapped[str | None] = mapped_column("performedByRole", String(100))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow, index=True)

    reimbursement: Mapped[ReimbursementRequest] = relationship(back_populates="actions")
    actor: Mapped[User] = relationship(foreign_keys=[performed_by])


class DinnerRequest(Base, TimestampMixin):
    __tablename__ = "dinner_requests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    requester_user_id: Mapped[str] = mapped_column("requesterUserId", ForeignKey("users.id"), index=True)
    requester_employee_profile_id: Mapped[str | None] = mapped_column(
        "requesterEmployeeProfileId", ForeignKey("employee_profiles.id"), nullable=True, index=True
    )
    requester_name: Mapped[str] = mapped_column("requesterName", String(255))
    requester_type: Mapped[str] = mapped_column("requesterType", String(50), default="project_lead")
    dinner_date: Mapped[date | None] = mapped_column("dinnerDate", Date)
    project_name: Mapped[str | None] = mapped_column("projectName", String(255))
    project_id: Mapped[str | None] = mapped_column("projectId", ForeignKey("projects.id"), nullable=True, index=True)
    # Optional spend amount so dinners roll into project consumed budget.
    amount: Mapped[float | None] = mapped_column(Float)
    team_member_count: Mapped[int | None] = mapped_column("teamMemberCount", Integer)
    team_member_emails: Mapped[list[str]] = mapped_column("teamMemberEmails", JSON, default=list)
    status: Mapped[str] = mapped_column(String(50), default="draft", index=True)
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    reviewed_by: Mapped[str | None] = mapped_column("reviewedBy", ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column("reviewedAt", DateTime(timezone=True))
    reviewer_comments: Mapped[str | None] = mapped_column("reviewerComments", Text)
    completed_by: Mapped[str | None] = mapped_column("completedBy", ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column("completedAt", DateTime(timezone=True))
    missing_fields: Mapped[list[str]] = mapped_column("missingFields", JSON, default=list)

    requester: Mapped[User] = relationship(foreign_keys=[requester_user_id])
    project: Mapped[Project | None] = relationship(foreign_keys=[project_id])
    requester_employee_profile: Mapped[EmployeeProfile | None] = relationship(
        foreign_keys=[requester_employee_profile_id]
    )
    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewed_by])
    completer: Mapped[User | None] = relationship(foreign_keys=[completed_by])
    actions: Mapped[list[DinnerRequestActionLog]] = relationship(
        back_populates="dinner_request",
        cascade="all, delete-orphan",
    )


class DinnerRequestActionLog(Base):
    __tablename__ = "dinner_request_action_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    dinner_request_id: Mapped[str] = mapped_column(
        "dinnerRequestId", ForeignKey("dinner_requests.id"), index=True
    )
    action: Mapped[str] = mapped_column(String(100), index=True)
    from_status: Mapped[str | None] = mapped_column("fromStatus", String(50))
    to_status: Mapped[str | None] = mapped_column("toStatus", String(50))
    comment: Mapped[str | None] = mapped_column(Text)
    performed_by: Mapped[str] = mapped_column("performedBy", ForeignKey("users.id"), index=True)
    performed_by_name: Mapped[str | None] = mapped_column("performedByName", String(255))
    performed_by_role: Mapped[str | None] = mapped_column("performedByRole", String(100))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), default=utcnow, index=True)

    dinner_request: Mapped[DinnerRequest] = relationship(back_populates="actions")
    actor: Mapped[User] = relationship(foreign_keys=[performed_by])


class EmployeeAsset(Base, TimestampMixin):
    __tablename__ = "employee_assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    asset_type: Mapped[str] = mapped_column("assetType", String(100), index=True)
    model: Mapped[str | None] = mapped_column(String(255))
    serial_number: Mapped[str | None] = mapped_column("serialNumber", String(255))
    charger_issued: Mapped[bool] = mapped_column("chargerIssued", Boolean, default=False)
    asset_tag: Mapped[str | None] = mapped_column("assetTag", String(100))
    status: Mapped[str] = mapped_column(String(50), default="assigned", index=True)
    assigned_at: Mapped[datetime | None] = mapped_column("assignedAt", DateTime(timezone=True))
    assigned_by: Mapped[str | None] = mapped_column("assignedBy", ForeignKey("users.id"))
    returned_at: Mapped[datetime | None] = mapped_column("returnedAt", DateTime(timezone=True))
    return_condition: Mapped[str | None] = mapped_column("returnCondition", String(255))
    notes: Mapped[str | None] = mapped_column(Text)

    employee_profile: Mapped[EmployeeProfile] = relationship(back_populates="assets")
    assigned_by_user: Mapped[User | None] = relationship(foreign_keys=[assigned_by])


class OffboardingChecklist(Base, TimestampMixin):
    __tablename__ = "offboarding_checklists"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    separation_id: Mapped[str] = mapped_column(
        "separationId", ForeignKey("employee_separations.id"), unique=True, index=True
    )
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), index=True
    )
    laptop_returned: Mapped[bool] = mapped_column("laptopReturned", Boolean, default=False)
    laptop_return_date: Mapped[datetime | None] = mapped_column("laptopReturnDate", DateTime(timezone=True))
    laptop_condition: Mapped[str | None] = mapped_column("laptopCondition", String(255))
    id_card_returned: Mapped[bool] = mapped_column("idCardReturned", Boolean, default=False)
    id_card_return_date: Mapped[datetime | None] = mapped_column("idCardReturnDate", DateTime(timezone=True))
    it_cleared_by: Mapped[str | None] = mapped_column("itClearedBy", ForeignKey("users.id"))
    it_cleared_at: Mapped[datetime | None] = mapped_column("itClearedAt", DateTime(timezone=True))
    office_admin_cleared_by: Mapped[str | None] = mapped_column("officeAdminClearedBy", ForeignKey("users.id"))
    office_admin_cleared_at: Mapped[datetime | None] = mapped_column("officeAdminClearedAt", DateTime(timezone=True))
    hr_cleared_by: Mapped[str | None] = mapped_column("hrClearedBy", ForeignKey("users.id"))
    hr_cleared_at: Mapped[datetime | None] = mapped_column("hrClearedAt", DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)

    separation: Mapped[EmployeeSeparation] = relationship()
    employee_profile: Mapped[EmployeeProfile] = relationship(foreign_keys=[employee_profile_id])


class PmsEvaluation(Base, TimestampMixin):
    __tablename__ = "pms_evaluations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    # PMS now targets employees; candidate_id kept nullable for backward compatibility.
    candidate_id: Mapped[str | None] = mapped_column("candidateId", ForeignKey("candidates.id"), index=True, nullable=True)
    employee_id: Mapped[str | None] = mapped_column("employeeId", ForeignKey("employee_profiles.id"), index=True, nullable=True)
    evaluator_id: Mapped[str] = mapped_column("evaluatorId", ForeignKey("users.id"), index=True)

    verbal_clarity: Mapped[float | None] = mapped_column("verbalClarity", Float)
    conciseness: Mapped[float | None] = mapped_column(Float)
    fluency: Mapped[float | None] = mapped_column(Float)
    vocabulary: Mapped[float | None] = mapped_column(Float)
    pronunciation: Mapped[float | None] = mapped_column(Float)
    nonverbal_confidence: Mapped[float | None] = mapped_column("nonverbalConfidence", Float)
    intro_background: Mapped[float | None] = mapped_column("introBackground", Float)
    ethara_awareness: Mapped[float | None] = mapped_column("etharaAwareness", Float)
    current_affairs: Mapped[float | None] = mapped_column("currentAffairs", Float)
    instagram_familiarity: Mapped[float | None] = mapped_column("instagramFamiliarity", Float)
    prompt_engineering: Mapped[float | None] = mapped_column("promptEngineering", Float)
    video_editing: Mapped[float | None] = mapped_column("videoEditing", Float)

    metric_remarks: Mapped[dict | None] = mapped_column("metricRemarks", JSON)

    total_score: Mapped[float | None] = mapped_column("totalScore", Float)
    average_score: Mapped[float | None] = mapped_column("averageScore", Float)
    overall_rating: Mapped[str | None] = mapped_column("overallRating", String(50))
    remarks: Mapped[str | None] = mapped_column(Text)

    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))

    candidate: Mapped[Candidate | None] = relationship()
    employee: Mapped[EmployeeProfile | None] = relationship()
    evaluator: Mapped[User] = relationship()


class PmsMeeting(Base, TimestampMixin):
    """A PMS review meeting for an employee.

    Mode ``online`` sends a calendar (.ics) invite to the organizer, the
    employee (when ``invite_employee``) and any extra attendee emails. Mode
    ``offline`` is recorded for history but never sends an invite.
    """

    __tablename__ = "pms_meetings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_id: Mapped[str] = mapped_column(
        "employeeId", ForeignKey("employee_profiles.id"), index=True
    )
    # The account that set up the meeting; always added to the invite.
    organizer_id: Mapped[str] = mapped_column("organizerId", ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    mode: Mapped[str] = mapped_column(String(20), default="online")  # online | offline
    scheduled_at: Mapped[datetime | None] = mapped_column("scheduledAt", DateTime(timezone=True))
    duration_minutes: Mapped[int] = mapped_column("durationMinutes", Integer, default=60)
    # Optional venue (offline) or meeting link (online) pasted by HR.
    location: Mapped[str | None] = mapped_column(String(500))
    # Extra attendee emails added beyond the organizer/employee.
    attendees: Mapped[list[str] | None] = mapped_column(JSON)
    invite_employee: Mapped[bool] = mapped_column("inviteEmployee", Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="scheduled", index=True)

    employee: Mapped[EmployeeProfile] = relationship()
    organizer: Mapped[User] = relationship()


# ─────────────────────────────────────────────────────────────────────────────
# Assessment Platform — a generic, reusable test/quiz engine (builder, question
# bank, invite-only assignments, attempts, autosave, scoring, manual grading).
# Intentionally SEPARATE from the recruitment-pipeline AssessmentTemplate /
# CandidateAssessment models above, which are welded to CandidateStage levels.
# All tables are namespaced `ap_` to avoid collision with that legacy feature.
# ─────────────────────────────────────────────────────────────────────────────


class ApAssessmentStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class ApQuestionType(StrEnum):
    MCQ_SINGLE = "mcq_single"
    MCQ_MULTI = "mcq_multi"
    TRUE_FALSE = "true_false"
    SHORT_ANSWER = "short_answer"
    LONG_ANSWER = "long_answer"
    FILE_UPLOAD = "file_upload"
    URL_SUBMISSION = "url_submission"
    RATING = "rating"
    FORM_TEXT = "form_text"
    FORM_DATE = "form_date"
    FORM_DROPDOWN = "form_dropdown"
    CONSENT = "consent"


class ApAssignmentStatus(StrEnum):
    INVITED = "invited"
    STARTED = "started"
    SUBMITTED = "submitted"
    GRADED = "graded"
    REVOKED = "revoked"
    EXPIRED = "expired"


class ApAttemptStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    GRADED = "graded"


enum_ap_assessment_status = Enum(ApAssessmentStatus, name="ap_assessment_status", **enum_kwargs)
enum_ap_question_type = Enum(ApQuestionType, name="ap_question_type", **enum_kwargs)
enum_ap_assignment_status = Enum(ApAssignmentStatus, name="ap_assignment_status", **enum_kwargs)
enum_ap_attempt_status = Enum(ApAttemptStatus, name="ap_attempt_status", **enum_kwargs)


class ApAssessment(Base, TimestampMixin):
    __tablename__ = "ap_assessments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    title: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    consent_text: Mapped[str | None] = mapped_column("consentText", Text)
    status: Mapped[ApAssessmentStatus] = mapped_column(
        enum_ap_assessment_status, default=ApAssessmentStatus.DRAFT, index=True
    )
    time_limit_minutes: Mapped[int | None] = mapped_column("timeLimitMinutes", Integer)
    attempts_allowed: Mapped[int] = mapped_column("attemptsAllowed", Integer, default=1)
    randomize_sections: Mapped[bool] = mapped_column("randomizeSections", Boolean, default=False)
    randomize_questions: Mapped[bool] = mapped_column("randomizeQuestions", Boolean, default=False)
    shuffle_options: Mapped[bool] = mapped_column("shuffleOptions", Boolean, default=False)
    negative_marking: Mapped[bool] = mapped_column("negativeMarking", Boolean, default=False)
    negative_factor: Mapped[float] = mapped_column("negativeFactor", Float, default=0.0)
    pass_percentage: Mapped[float | None] = mapped_column("passPercentage", Float)
    total_marks: Mapped[float] = mapped_column("totalMarks", Float, default=0.0)
    show_results_to_candidate: Mapped[bool] = mapped_column(
        "showResultsToCandidate", Boolean, default=False
    )
    available_from: Mapped[datetime | None] = mapped_column("availableFrom", DateTime(timezone=True))
    available_until: Mapped[datetime | None] = mapped_column("availableUntil", DateTime(timezone=True))
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    position_id: Mapped[str | None] = mapped_column("positionId", ForeignKey("positions.id"), index=True)
    created_by: Mapped[str | None] = mapped_column("createdBy", ForeignKey("users.id"))
    is_removed: Mapped[bool] = mapped_column("isRemoved", Boolean, default=False, index=True)

    creator: Mapped[User | None] = relationship(foreign_keys=[created_by])
    position: Mapped[Position | None] = relationship(foreign_keys=[position_id])
    sections: Mapped[list[ApSection]] = relationship(
        back_populates="assessment",
        cascade="all, delete-orphan",
        order_by="ApSection.order_index",
    )
    # Read-only convenience view of every question across all sections (writes go
    # through ApSection.questions, which owns the delete-orphan cascade).
    questions: Mapped[list[ApQuestion]] = relationship(
        viewonly=True,
        order_by="ApQuestion.order_index",
    )


class ApSection(Base, TimestampMixin):
    __tablename__ = "ap_sections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    assessment_id: Mapped[str] = mapped_column(
        "assessmentId", ForeignKey("ap_assessments.id"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    instructions: Mapped[str | None] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column("orderIndex", Integer, default=0)
    time_limit_minutes: Mapped[int | None] = mapped_column("timeLimitMinutes", Integer)
    cutoff_mark: Mapped[float | None] = mapped_column("cutoffMark", Float)
    weightage: Mapped[float | None] = mapped_column(Float)
    lock_after_leave: Mapped[bool] = mapped_column("lockAfterLeave", Boolean, default=False)
    randomize_questions: Mapped[bool] = mapped_column("randomizeQuestions", Boolean, default=False)
    pick_count: Mapped[int | None] = mapped_column("pickCount", Integer)

    assessment: Mapped[ApAssessment] = relationship(back_populates="sections")
    questions: Mapped[list[ApQuestion]] = relationship(
        back_populates="section",
        cascade="all, delete-orphan",
        order_by="ApQuestion.order_index",
    )


class ApQuestion(Base, TimestampMixin):
    __tablename__ = "ap_questions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    assessment_id: Mapped[str] = mapped_column(
        "assessmentId", ForeignKey("ap_assessments.id"), index=True
    )
    section_id: Mapped[str] = mapped_column("sectionId", ForeignKey("ap_sections.id"), index=True)
    bank_question_id: Mapped[str | None] = mapped_column(
        "bankQuestionId", ForeignKey("ap_question_bank.id"), nullable=True, index=True
    )
    type: Mapped[ApQuestionType] = mapped_column(enum_ap_question_type, index=True)
    prompt: Mapped[str] = mapped_column(Text)
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    marks: Mapped[float] = mapped_column(Float, default=1.0)
    negative_marks: Mapped[float] = mapped_column("negativeMarks", Float, default=0.0)
    order_index: Mapped[int] = mapped_column("orderIndex", Integer, default=0)
    is_required: Mapped[bool] = mapped_column("isRequired", Boolean, default=True)
    media_url: Mapped[str | None] = mapped_column("mediaUrl", String(500))

    section: Mapped[ApSection] = relationship(back_populates="questions")


class ApQuestionBank(Base, TimestampMixin):
    __tablename__ = "ap_question_bank"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    type: Mapped[ApQuestionType] = mapped_column(enum_ap_question_type, index=True)
    prompt: Mapped[str] = mapped_column(Text)
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    default_marks: Mapped[float] = mapped_column("defaultMarks", Float, default=1.0)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    difficulty: Mapped[str | None] = mapped_column(String(30), index=True)
    skill: Mapped[str | None] = mapped_column(String(100), index=True)
    is_archived: Mapped[bool] = mapped_column("isArchived", Boolean, default=False, index=True)
    created_by: Mapped[str | None] = mapped_column("createdBy", ForeignKey("users.id"))

    creator: Mapped[User | None] = relationship(foreign_keys=[created_by])


class ApAssignment(Base, TimestampMixin):
    __tablename__ = "ap_assignments"
    __table_args__ = (
        UniqueConstraint("assessmentId", "email", name="uq_ap_assignments_assessmentId_email"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    assessment_id: Mapped[str] = mapped_column(
        "assessmentId", ForeignKey("ap_assessments.id"), index=True
    )
    email: Mapped[str] = mapped_column(String(255), index=True)
    user_id: Mapped[str | None] = mapped_column("userId", ForeignKey("users.id"), nullable=True, index=True)
    candidate_id: Mapped[str | None] = mapped_column(
        "candidateId", ForeignKey("candidates.id"), nullable=True, index=True
    )
    status: Mapped[ApAssignmentStatus] = mapped_column(
        enum_ap_assignment_status, default=ApAssignmentStatus.INVITED, index=True
    )
    invited_by: Mapped[str | None] = mapped_column("invitedBy", ForeignKey("users.id"))
    invited_at: Mapped[datetime] = mapped_column("invitedAt", DateTime(timezone=True), default=utcnow)
    last_invited_at: Mapped[datetime | None] = mapped_column("lastInvitedAt", DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column("expiresAt", DateTime(timezone=True))
    attempts_used: Mapped[int] = mapped_column("attemptsUsed", Integer, default=0)
    provisioned: Mapped[bool] = mapped_column(Boolean, default=False)
    invite_token_hash: Mapped[str | None] = mapped_column("inviteTokenHash", String(64))

    assessment: Mapped[ApAssessment] = relationship(foreign_keys=[assessment_id])
    user: Mapped[User | None] = relationship(foreign_keys=[user_id])
    candidate: Mapped[Candidate | None] = relationship(foreign_keys=[candidate_id])
    inviter: Mapped[User | None] = relationship(foreign_keys=[invited_by])
    attempts: Mapped[list[ApAttempt]] = relationship(
        back_populates="assignment",
        cascade="all, delete-orphan",
    )


class ApAttempt(Base, TimestampMixin):
    __tablename__ = "ap_attempts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    assignment_id: Mapped[str] = mapped_column(
        "assignmentId", ForeignKey("ap_assignments.id"), index=True
    )
    assessment_id: Mapped[str] = mapped_column(
        "assessmentId", ForeignKey("ap_assessments.id"), index=True
    )
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("users.id"), index=True)
    status: Mapped[ApAttemptStatus] = mapped_column(
        enum_ap_attempt_status, default=ApAttemptStatus.IN_PROGRESS, index=True
    )
    # Immutable snapshot frozen at start: resolved section/question order, shuffle
    # seed, per-question marks + answer keys, time limits. Scoring reads this, never
    # the live assessment, so later edits/clones can't corrupt in-flight attempts.
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime | None] = mapped_column("startedAt", DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column("submittedAt", DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column("expiresAt", DateTime(timezone=True))
    auto_score: Mapped[float | None] = mapped_column("autoScore", Float)
    manual_score: Mapped[float | None] = mapped_column("manualScore", Float)
    total_score: Mapped[float | None] = mapped_column("totalScore", Float)
    max_score: Mapped[float | None] = mapped_column("maxScore", Float)
    percentage: Mapped[float | None] = mapped_column(Float)
    result_status: Mapped[str | None] = mapped_column("resultStatus", String(20))
    graded_by: Mapped[str | None] = mapped_column("gradedBy", ForeignKey("users.id"))
    graded_at: Mapped[datetime | None] = mapped_column("gradedAt", DateTime(timezone=True))
    # Anti-cheat telemetry recorded during the attempt (tab switches, fullscreen
    # exits, copy/paste attempts, focus loss) + a capped event log.
    proctoring: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # HR's overall written feedback + when the final result was locked in (via the
    # bulk results CSV or in-app grade-finalize). Once set, bulk upload skips it.
    overall_feedback: Mapped[str | None] = mapped_column("overallFeedback", Text)
    result_finalized_at: Mapped[datetime | None] = mapped_column(
        "resultFinalizedAt", DateTime(timezone=True)
    )
    # Candidates see nothing (and can't progress) until HR releases the result.
    result_released_at: Mapped[datetime | None] = mapped_column(
        "resultReleasedAt", DateTime(timezone=True)
    )

    assignment: Mapped[ApAssignment] = relationship(back_populates="attempts", foreign_keys=[assignment_id])
    assessment: Mapped[ApAssessment] = relationship(foreign_keys=[assessment_id])
    user: Mapped[User] = relationship(foreign_keys=[user_id])
    grader: Mapped[User | None] = relationship(foreign_keys=[graded_by])
    answers: Mapped[list[ApAnswer]] = relationship(
        back_populates="attempt",
        cascade="all, delete-orphan",
    )


class ApAnswer(Base, TimestampMixin):
    __tablename__ = "ap_answers"
    __table_args__ = (
        UniqueConstraint("attemptId", "questionId", name="uq_ap_answers_attemptId_questionId"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    attempt_id: Mapped[str] = mapped_column("attemptId", ForeignKey("ap_attempts.id"), index=True)
    question_id: Mapped[str] = mapped_column("questionId", ForeignKey("ap_questions.id"), index=True)
    response: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    client_rev: Mapped[int] = mapped_column("clientRev", Integer, default=0)
    is_correct: Mapped[bool | None] = mapped_column("isCorrect", Boolean)
    auto_marks: Mapped[float | None] = mapped_column("autoMarks", Float)
    manual_marks: Mapped[float | None] = mapped_column("manualMarks", Float)
    awarded_marks: Mapped[float | None] = mapped_column("awardedMarks", Float)
    feedback: Mapped[str | None] = mapped_column(Text)
    graded_by: Mapped[str | None] = mapped_column("gradedBy", ForeignKey("users.id"))
    graded_at: Mapped[datetime | None] = mapped_column("gradedAt", DateTime(timezone=True))
    file_name: Mapped[str | None] = mapped_column("fileName", String(255))
    file_url: Mapped[str | None] = mapped_column("fileUrl", String(500))
    file_path: Mapped[str | None] = mapped_column("filePath", String(500))
    file_size: Mapped[int | None] = mapped_column("fileSize", Integer)
    file_mime: Mapped[str | None] = mapped_column("fileMime", String(255))
    saved_at: Mapped[datetime] = mapped_column(
        "savedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    attempt: Mapped[ApAttempt] = relationship(back_populates="answers", foreign_keys=[attempt_id])
    question: Mapped[ApQuestion] = relationship(foreign_keys=[question_id])
    grader: Mapped[User | None] = relationship(foreign_keys=[graded_by])


# ─────────────────────────────────────────────────────────────────────────────
# Attendance auto-link on employee activation.
#
# Biometric punches recorded BEFORE an employee exists in HRMS are stored with
# employee_profile_id = NULL (keyed only by the biometric employee_code). The
# moment that employee is activated — i.e. an EmployeeProfile is created, or its
# employee_code is (re)assigned — attach those historical rows to the profile so
# pre-activation and post-activation attendance show as a single person. Runs in
# the same transaction as the profile write, so it is atomic with activation.
# ─────────────────────────────────────────────────────────────────────────────


def _relink_orphan_attendance(connection, profile_id: str, employee_code: str | None) -> None:
    if not employee_code or not str(employee_code).strip():
        return
    code = str(employee_code).strip().lower()
    # uq_attendance_employee_date is UNIQUE(employeeProfileId, attendanceDate), so we must
    # never link an orphan onto a date the profile already has. That collision is real: an
    # employee can have rows under more than one biometric code on the same day (e.g. a code
    # change — old code GRP1575 + new code GRP1708 both punch on the switch-over day), and
    # the feed can also carry duplicate same-date rows. Guard both: skip dates already present
    # for this profile, and collapse same-date orphans to one row (DISTINCT ON). Without this
    # the blanket UPDATE aborts the whole transaction (and any read that triggers the repair).
    existing_dates = select(AttendanceRecord.attendance_date).where(
        AttendanceRecord.employee_profile_id == profile_id
    )
    candidate_ids = (
        select(AttendanceRecord.id)
        .where(
            AttendanceRecord.employee_profile_id.is_(None),
            func.lower(AttendanceRecord.employee_code) == code,
            AttendanceRecord.attendance_date.not_in(existing_dates),
        )
        .distinct(AttendanceRecord.attendance_date)
        .order_by(AttendanceRecord.attendance_date, AttendanceRecord.id)
    )
    connection.execute(
        update(AttendanceRecord)
        .where(AttendanceRecord.id.in_(candidate_ids))
        .values(employee_profile_id=profile_id)
    )


@event.listens_for(EmployeeProfile, "after_insert")
def _relink_attendance_after_profile_insert(_mapper, connection, target) -> None:
    _relink_orphan_attendance(connection, target.id, target.employee_code)


@event.listens_for(EmployeeProfile, "after_update")
def _relink_attendance_after_profile_update(_mapper, connection, target) -> None:
    # Only act when the employee_code actually changed (e.g. code assigned on
    # activation), so routine profile edits don't run a needless UPDATE.
    history = inspect(target).attrs.employee_code.history
    if history.has_changes():
        _relink_orphan_attendance(connection, target.id, target.employee_code)


class BankVerificationStatus(StrEnum):
    PENDING = "pending"
    VALIDATED = "validated"
    FAILED = "failed"


class BankVerification(Base, TimestampMixin):
    """Penny-drop verification state for an onboarded employee's bank account.

    The account details themselves live on the candidate's selection form
    (``SelectionForm.form_data['bankDetails']``); this row only tracks the
    verification lifecycle (pending → validated / failed) plus the failure remark.
    Stored as a plain string status (not a PG enum) to keep migrations simple.
    """

    __tablename__ = "bank_verifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    employee_profile_id: Mapped[str] = mapped_column(
        "employeeProfileId", ForeignKey("employee_profiles.id"), unique=True, index=True
    )
    ethara_email: Mapped[str | None] = mapped_column("etharaEmail", String(255), index=True)
    status: Mapped[str] = mapped_column(String(20), default=BankVerificationStatus.PENDING.value, index=True)
    remark: Mapped[str | None] = mapped_column(Text)
    exported_at: Mapped[datetime | None] = mapped_column("exportedAt", DateTime(timezone=True))
    validated_at: Mapped[datetime | None] = mapped_column("validatedAt", DateTime(timezone=True))
    updated_by: Mapped[str | None] = mapped_column("updatedBy", String(32))
    updated_by_name: Mapped[str | None] = mapped_column("updatedByName", String(255))
