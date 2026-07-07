from pydantic import EmailStr, Field

from app.schemas.common import TimestampedModel


class CareerApplicationRead(TimestampedModel):
    id: str
    full_name: str = Field(alias="fullName")
    email: EmailStr
    phone: str
    linkedin_url: str | None = Field(alias="linkedinUrl", default=None)
    portfolio_url: str | None = Field(alias="portfolioUrl", default=None)
    github_url: str | None = Field(alias="githubUrl", default=None)
    resume_file_name: str | None = Field(alias="resumeFileName", default=None)
    resume_url: str | None = Field(alias="resumeUrl", default=None)
    resume_mime_type: str | None = Field(alias="resumeMimeType", default=None)
    resume_size: int | None = Field(alias="resumeSize", default=None)
    status: str
    referred_by_name: str | None = Field(alias="referredByName", default=None)
