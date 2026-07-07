from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.db.models import Role
from app.schemas.common import ORMModel, TimestampedModel


# Passwords that are clearly weak regardless of length/character mix. Matched
# case-insensitively against the whole value.
_WEAK_PASSWORDS = frozenset(
    {
        "password",
        "password1",
        "password123",
        "passw0rd",
        "12345678",
        "123456789",
        "1234567890",
        "qwerty123",
        "admin123",
        "changeme",
        "changeme1",
        "letmein1",
        "welcome1",
        "iloveyou",
    }
)


def validate_password_strength(value: str) -> str:
    """Shared complexity check for passwords being SET or CHANGED (#45).

    Requires a minimum length, at least one letter and one digit, and rejects a
    small set of obviously weak passwords. Intentionally only applied where a new
    password is chosen — never on login — so existing valid passwords keep working.
    """
    if value is None:
        return value
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    if not any(ch.isalpha() for ch in value):
        raise ValueError("Password must contain at least one letter.")
    if not any(ch.isdigit() for ch in value):
        raise ValueError("Password must contain at least one number.")
    if value.lower() in _WEAK_PASSWORDS:
        raise ValueError("Password is too common. Please choose a stronger password.")
    return value


class PositionBase(ORMModel):
    title: str
    slug: str | None = None
    department: str
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    employment_type: str | None = Field(alias="employmentType", default=None)
    work_mode: str | None = Field(alias="workMode", default=None)
    experience_level: str | None = Field(alias="experienceLevel", default=None)
    experience_years: int | None = Field(alias="experienceYears", default=None)
    salary_bracket: str | None = Field(alias="salaryBracket", default=None)
    responsibilities: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(alias="preferredSkills", default_factory=list)
    benefits: list[str] = Field(default_factory=list)
    featured: bool = False
    openings: int = 1
    posted_at: datetime | None = Field(alias="postedAt", default=None)
    urgency_level: int = Field(alias="urgencyLevel", default=3)
    is_active: bool = Field(alias="isActive", default=True)
    screening_prompt: str | None = Field(alias="screeningPrompt", default=None)


class PositionCreate(PositionBase):
    pass


class PositionUpdate(ORMModel):
    title: str | None = None
    slug: str | None = None
    department: str | None = None
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    employment_type: str | None = Field(alias="employmentType", default=None)
    work_mode: str | None = Field(alias="workMode", default=None)
    experience_level: str | None = Field(alias="experienceLevel", default=None)
    experience_years: int | None = Field(alias="experienceYears", default=None)
    salary_bracket: str | None = Field(alias="salaryBracket", default=None)
    responsibilities: list[str] | None = None
    requirements: list[str] | None = None
    preferred_skills: list[str] | None = Field(alias="preferredSkills", default=None)
    benefits: list[str] | None = None
    featured: bool | None = None
    openings: int | None = None
    posted_at: datetime | None = Field(alias="postedAt", default=None)
    urgency_level: int | None = Field(alias="urgencyLevel", default=None)
    is_active: bool | None = Field(alias="isActive", default=None)
    screening_prompt: str | None = Field(alias="screeningPrompt", default=None)


class PositionRead(PositionBase, TimestampedModel):
    id: str
    candidate_count: int | None = Field(alias="candidateCount", default=None)
    approval_status: str = Field(alias="approvalStatus", default="draft")
    approval_requested_at: datetime | None = Field(alias="approvalRequestedAt", default=None)
    approval_decided_at: datetime | None = Field(alias="approvalDecidedAt", default=None)
    requested_by: str | None = Field(alias="requestedBy", default=None)
    approved_by: str | None = Field(alias="approvedBy", default=None)
    approval_recipient_email: str | None = Field(alias="approvalRecipientEmail", default=None)
    reviewed_by_email: str | None = Field(alias="reviewedByEmail", default=None)
    rejection_reason: str | None = Field(alias="rejectionReason", default=None)
    approval_email_sent_at: datetime | None = Field(alias="approvalEmailSentAt", default=None)


class PositionApprovalActionRequest(ORMModel):
    action: str
    reason: str | None = None


class VendorBase(ORMModel):
    name: str
    contact_email: EmailStr = Field(alias="contactEmail")
    contact_phone: str | None = Field(alias="contactPhone", default=None)
    is_active: bool = Field(alias="isActive", default=True)


class VendorCreate(VendorBase):
    pass


class VendorUpdate(ORMModel):
    name: str | None = None
    contact_email: EmailStr | None = Field(alias="contactEmail", default=None)
    contact_phone: str | None = Field(alias="contactPhone", default=None)
    is_active: bool | None = Field(alias="isActive", default=None)


class VendorRead(VendorBase, TimestampedModel):
    id: str
    candidate_count: int | None = Field(alias="candidateCount", default=None)


class CollegeBase(ORMModel):
    name: str
    short_name: str | None = Field(alias="shortName", default=None)
    is_active: bool = Field(alias="isActive", default=True)


class CollegeCreate(CollegeBase):
    pass


class CollegeUpdate(ORMModel):
    name: str | None = None
    short_name: str | None = Field(alias="shortName", default=None)
    is_active: bool | None = Field(alias="isActive", default=None)


class CollegeRead(CollegeBase, TimestampedModel):
    id: str


class UserBase(ORMModel):
    # Response-only base (UserRead): plain str, not EmailStr. FastAPI validates the
    # outgoing response, so one legacy/placeholder row (e.g. a name in the email
    # column, or a soft-delete "...@deleted.local" address) would otherwise raise
    # ResponseValidationError and 500 the entire /users list. Input stays validated
    # by UserCreate/UserUpdate (which keep EmailStr).
    email: str
    name: str
    role: Role
    roles: list[Role] = []
    phone: str | None = None
    is_active: bool = Field(alias="isActive", default=True)
    email_verified_at: datetime | None = Field(alias="emailVerifiedAt", default=None)
    last_login_at: datetime | None = Field(alias="lastLoginAt", default=None)


class UserCreate(ORMModel):
    email: EmailStr
    name: str
    role: Role
    roles: list[Role] | None = None
    phone: str | None = None
    vendor_id: str | None = Field(alias="vendorId", default=None)
    password: str | None = None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_create_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("password")
    @classmethod
    def validate_create_password(cls, value: str | None) -> str | None:
        # Only enforce complexity when an explicit password is supplied; when None
        # the account falls back to the temporary password + forced rotation.
        if value is None:
            return value
        return validate_password_strength(value)


class UserUpdate(ORMModel):
    email: EmailStr | None = None
    name: str | None = None
    role: Role | None = None
    roles: list[Role] | None = None
    phone: str | None = None
    is_active: bool | None = Field(alias="isActive", default=None)
    vendor_id: str | None = Field(alias="vendorId", default=None)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_update_email(cls, value: str | None) -> str | None:
        return value.strip().lower() if value else value


class UserRead(UserBase, TimestampedModel):
    id: str
    permissions: list[str] = []


class AdminSettingRead(TimestampedModel):
    id: str
    namespace: str
    key: str
    value: dict | list | str | int | float | bool | None
    description: str | None = None
    updated_by: str | None = Field(alias="updatedBy", default=None)


class AdminSettingWrite(ORMModel):
    namespace: str = "system"
    key: str
    value: dict | list | str | int | float | bool | None
    description: str | None = None
