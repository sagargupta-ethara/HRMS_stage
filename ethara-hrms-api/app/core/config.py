from functools import lru_cache
from pathlib import Path
import base64
import json

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Tokens that must NOT be used in production — indicative of unconfigured .env
_INSECURE_DEFAULTS: set[str] = {
    "change-me-access-secret-key-32-chars",
    "change-me-refresh-secret-key-32chars",
}

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Ethara HRMS API"
    app_env: str = "development"
    app_debug: bool = False
    port: int = 3001

    # Real connection string comes from the DATABASE_URL env var (.env). This default is a
    # non-secret placeholder for local/test only — it carries NO real credentials.
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/ethara_hrms"
    redis_url: str = "redis://localhost:6379/0"

    # SQLAlchemy connection-pool tuning (per process). Keep
    # web_concurrency * (db_pool_size + db_max_overflow) under the Postgres
    # max_connections limit. Defaults are safe for a single EC2 instance.
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800

    # Gunicorn worker count. 0 => auto ((2 * CPU) + 1), computed in
    # gunicorn_conf.py. Override with WEB_CONCURRENCY in the environment.
    web_concurrency: int = 0

    # Optional Redis-backed read cache (opt-in; see app/core/cache.py).
    cache_enabled: bool = False
    cache_default_ttl_seconds: int = 60

    frontend_url: str = "http://localhost:3000"
    # Comma-separated extra origins allowed by CORS — set by run-dev.sh to
    # include the LAN IP so other devices on the same network can access the app.
    # Example: EXTRA_ALLOWED_ORIGINS=http://192.168.1.5:3000
    extra_allowed_origins: str = ""

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.frontend_url]
        if self.extra_allowed_origins:
            for o in self.extra_allowed_origins.split(","):
                o = o.strip()
                if o and o not in origins:
                    origins.append(o)
        return origins

    @property
    def position_approver_email_list(self) -> list[str]:
        seen: list[str] = []
        for raw in self.position_approver_emails.split(","):
            email = raw.strip().lower()
            if email and email not in seen:
                seen.append(email)
        return seen

    @property
    def position_approval_cc_email_list(self) -> list[str]:
        seen: list[str] = []
        for raw in self.position_approval_cc_emails.split(","):
            email = raw.strip().lower()
            if email and email not in seen:
                seen.append(email)
        return seen

    jwt_secret: str = "change-me-access-secret-key-32-chars"
    jwt_refresh_secret: str = "change-me-refresh-secret-key-32chars"
    jwt_expires_in_minutes: int = 60
    jwt_refresh_expires_in_days: int = 7
    # Shared temporary password for admin-created / auto-provisioned accounts.
    # Sourced from the DEFAULT_TEMP_PASSWORD env var (kept out of the codebase so
    # no credential is committed); production refuses to start until it is set.
    default_temp_password: str = ""
    aadhaar_pepper: str | None = None

    storage_backend: str = "local"
    local_storage_path: Path = Path("uploads")
    aws_region: str = "ap-south-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_s3_bucket: str | None = None

    email_backend: str = "console"
    email_from: str = "noreply@ethara.ai"
    leadership_approval_email: str = "approver@example.com"
    # Recipients of JD/position approval emails. Comma-separated; each gets their
    # own approve/reject link and may approve on behalf of the team.
    # Configure via POSITION_APPROVER_EMAILS / POSITION_APPROVAL_CC_EMAILS in .env.
    position_approver_emails: str = "approver1@example.com,approver2@example.com"
    position_approval_cc_emails: str = "cc1@example.com,cc2@example.com"
    leadership_approval_token_expires_in_days: int = 7
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    aws_ses_region: str | None = None

    ocr_backend: str = "local"
    ocr_languages: str = "eng+hin"
    ocr_dpi: int = 300
    textract_bucket: str | None = None
    google_service_account_json: str | None = None
    google_service_account_json_base64: str | None = None
    # Workspace user the service account impersonates to mint Google Meet links
    # (domain-wide delegation). If unset, the meeting organiser is impersonated.
    google_calendar_user: str | None = None
    # Super-admin the service account impersonates to CREATE @ethara.ai Workspace
    # accounts via the Admin SDK Directory API. Required for email auto-provisioning.
    google_admin_user: str | None = None
    google_workspace_domain: str = "ethara.ai"
    google_document_ai_project_id: str | None = None
    google_document_ai_location: str | None = None
    google_document_ai_processor_id: str | None = None
    tesseract_command: str | None = None

    llm_backend: str = "openai"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"

    # Gemini (Google) – set LLM_BACKEND=gemini and add GEMINI_API_KEY
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash-lite"
    # Whether to also use Gemini Vision as an Aadhaar OCR fallback. Off by
    # default: OCR runs on the local RapidOCR library only, with no external
    # API dependency. Set GEMINI_OCR_FALLBACK=true to re-enable the cloud path.
    gemini_ocr_fallback: bool = False

    # Vertex AI Gemini — single unified key for document OCR + document-type
    # verification AND resume parsing/screening. When enabled it becomes the
    # PRIMARY backend for every Gemini-family call (the AI-Studio GEMINI_API_KEY
    # path above and OpenAI are kept only as fallbacks). Uses the Vertex publisher
    # REST endpoint with an API key (aiplatform.googleapis.com), which differs from
    # the google-genai SDK endpoint. Off by default so behaviour is unchanged until
    # VERTEX_AI_ENABLED=true and VERTEX_AI_API_KEY are set.
    vertex_ai_enabled: bool = False
    vertex_ai_api_key: str | None = None
    vertex_ai_project_id: str = "your-gcp-project-id"
    vertex_ai_location: str = "global"
    vertex_ai_model: str = "gemini-3.1-flash-lite"
    # Kept under the registration OCR endpoints' 50s thread-pool budget so a slow
    # Vertex call surfaces as "enter manually" rather than a hung request.
    vertex_ai_timeout_seconds: int = 45

    # greytHR leave integration (source of truth for leave balances). Server-only;
    # never exposed to the browser. The daily cron / refresh-now stay inert until
    # GREYTHR_API_USERNAME + GREYTHR_API_PASSWORD are set (API user needs Leave READ).
    #   username = API user Client ID, password = Client Secret (greytHR Admin →
    #   Integrations → API); domain = <tenant>.greythr.com; base_url = data gateway.
    greythr_api_username: str | None = None
    greythr_api_password: str | None = None
    greythr_domain: str | None = None
    greythr_base_url: str = "https://api.greythr.com"

    @property
    def greythr_configured(self) -> bool:
        return bool(self.greythr_api_username and self.greythr_api_password and self.greythr_domain)

    # ID Card Details: only employees who joined on/after this date are flagged as
    # "ID card details incomplete" (older employees already have physical ID cards,
    # so they are never flagged). ISO date; adjust as onboarding cohorts change.
    id_card_flag_from: str = "2026-06-01"

    # When true, mask obvious direct identifiers (email, phone, Aadhaar-like
    # numbers) in resume/JD text BEFORE sending it to an external LLM
    # (OpenAI/Gemini) for parsing/screening. Off by default so existing
    # screening behaviour/quality is unchanged; enable once candidate consent
    # and a data-processing agreement are in place (audit finding #32).
    llm_redact_pii: bool = False

    celery_task_always_eager: bool = False
    celery_result_backend: str | None = None
    # When False (default), the pipeline will NOT auto-allocate an employee code or
    # auto-convert a candidate into an employee on contract-signing / compliance
    # completion. Candidates instead stay at ONBOARDING_COMPLETED and an employee
    # (with Ethara ID + GRP code) is created ONLY via the IT-dashboard bulk-register
    # upload. Set AUTO_EMPLOYEE_PROVISIONING=true to restore the old automatic flow.
    auto_employee_provisioning: bool = False
    # Keep uploads self-contained for small/single-node deployments. Set
    # RESUME_SCREENING_INLINE_ON_UPLOAD=false when Celery workers are guaranteed.
    resume_screening_inline_on_upload: bool = True
    observability_log_dir: Path = Path("../.deploy-logs")

    documenso_api_key: str | None = None
    documenso_base_url: str = "https://app.documenso.com/api/v2"
    documenso_webhook_secret: str | None = None
    documenso_signing_base_url: str = "https://app.documenso.com/sign"
    documenso_sync_batch_size: int = 50
    documenso_rate_limit_delay_ms: int = 300

    # Optional ESSL biometric attendance source. Keep these values in .env or
    # process-level secrets; dashboards never use this connection directly.
    essl_db_host: str | None = None
    essl_db_port: int = 1433
    essl_db_name: str | None = None
    essl_db_user: str | None = None
    essl_db_password: str | None = None
    essl_tds_version: str = "7.0"
    essl_login_timeout_seconds: int = 15
    essl_query_timeout_seconds: int = 60
    attendance_business_timezone: str = "Asia/Kolkata"
    attendance_finalize_after_hour: int = 22

    docs_url: str = "/api/docs"
    openapi_url: str = "/api/openapi.json"
    # Interactive API docs / OpenAPI schema are OFF by default (they leak the full
    # API surface). Set ENABLE_API_DOCS=true to expose them, and never in production.
    enable_api_docs: bool = False
    api_prefix: str = "/api/v1"

    max_upload_size_mb: int = 10
    sla_check_cron: str = "*/30 * * * *"
    contract_signing_base_url: str = "https://contracts.ethara.local"
    admin_settings_namespace: str = "system"
    allowed_file_types: list[str] = Field(
        default_factory=lambda: [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg",
            "image/png",
            "image/webp",
        ],
    )

    @field_validator("jwt_secret", "jwt_refresh_secret", mode="after")
    @classmethod
    def _validate_secret_length(cls, value: str) -> str:
        if len(value) < 32:
            raise ValueError("JWT secrets must be at least 32 characters long")
        return value

    @model_validator(mode="after")
    def _block_insecure_secrets_in_production(self) -> "Settings":
        if self.app_env == "production":
            if self.jwt_secret in _INSECURE_DEFAULTS:
                raise ValueError(
                    "JWT_SECRET must be changed from the default value before running in production. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
                )
            if self.jwt_refresh_secret in _INSECURE_DEFAULTS:
                raise ValueError(
                    "JWT_REFRESH_SECRET must be changed from the default value before running in production. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
                )
            # Aadhaar (national-ID) fingerprints must be peppered with a secret
            # that is independent of the JWT signing key, so rotating one never
            # affects the other. To preserve fingerprints created before this
            # was enforced, set AADHAAR_PEPPER to the value previously used as
            # the pepper (the JWT secret, since it was the fallback).
            if not self.aadhaar_pepper:
                raise ValueError(
                    "AADHAAR_PEPPER must be set in production (independent of JWT_SECRET). "
                    "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\". "
                    "To preserve existing Aadhaar fingerprints, set it to the JWT_SECRET value used so far."
                )
            if not self.default_temp_password:
                raise ValueError(
                    "DEFAULT_TEMP_PASSWORD must be set (via the environment) before running in production."
                )
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"

    @property
    def google_service_account_info(self) -> dict | None:
        raw = self.google_service_account_json
        if not raw and self.google_service_account_json_base64:
            try:
                raw = base64.b64decode(self.google_service_account_json_base64).decode("utf-8")
            except Exception as exc:
                raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64") from exc

        if not raw:
            return None

        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("Google service account JSON in env is invalid") from exc


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.local_storage_path.mkdir(parents=True, exist_ok=True)
    return settings
