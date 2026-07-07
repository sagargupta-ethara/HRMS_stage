from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.db.models import Role
from app.schemas.common import ORMModel
from app.schemas.resources import UserRead, validate_password_strength


class LoginRequest(ORMModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_login_email(cls, value: str) -> str:
        return value.strip().lower()


class LoginResponse(ORMModel):
    user: UserRead
    access_token: str = Field(alias="accessToken")


class RefreshResponse(ORMModel):
    access_token: str = Field(alias="accessToken")


class AuthCodeRequest(ORMModel):
    email: EmailStr = Field(max_length=255)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_request_email(cls, value: str) -> str:
        return value.strip().lower()


class AuthCodeResponse(ORMModel):
    message: str
    development_code: str | None = Field(alias="developmentCode", default=None)
    expires_at: datetime | None = Field(alias="expiresAt", default=None)


class PasswordResetConfirmRequest(ORMModel):
    email: EmailStr = Field(max_length=255)
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(alias="newPassword", min_length=8, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_reset_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("new_password")
    @classmethod
    def validate_reset_password(cls, value: str) -> str:
        return validate_password_strength(value)


class EmailVerificationConfirmRequest(ORMModel):
    code: str = Field(min_length=4, max_length=12)


class PublicEmailVerificationConfirmRequest(ORMModel):
    email: EmailStr = Field(max_length=255)
    code: str = Field(min_length=4, max_length=12)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_public_email(cls, value: str) -> str:
        return value.strip().lower()


class ChangePasswordRequest(ORMModel):
    old_password: str = Field(alias="oldPassword", min_length=1, max_length=128)
    new_password: str = Field(alias="newPassword", min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_change_password(cls, value: str) -> str:
        return validate_password_strength(value)


class ChangePasswordOtpConfirmRequest(ORMModel):
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(alias="newPassword", min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_change_otp_password(cls, value: str) -> str:
        return validate_password_strength(value)


class SwitchRoleRequest(ORMModel):
    role: Role
