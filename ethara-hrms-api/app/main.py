from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.api.router import api_router
from app.core.config import get_settings
from app.core.database import engine
from app.core.limiter import limiter
from app.core.timezone import apply_process_timezone

# Pin the process clock to IST so all log timestamps (stdlib, Uvicorn, Gunicorn)
# render in Asia/Kolkata. Runs at import, before the first request is logged, so
# it applies under every launcher (uvicorn, gunicorn workers, manual restart).
# DB writes use explicit UTC (see app.db.models.utcnow) and are unaffected.
apply_process_timezone()

settings = get_settings()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: object) -> Response:
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        # The legacy XSS Auditor this header toggled was removed from modern
        # browsers and itself introduced cross-site leak bugs; current guidance
        # (OWASP / Chrome) is to disable it explicitly and rely on CSP instead.
        response.headers["X-XSS-Protection"] = "0"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # Keep authenticated API responses and uploaded files (PII) out of shared/
        # browser caches. Static frontend assets are served by Next.js, not here.
        path = request.url.path
        if path.startswith("/api") or path.startswith("/uploads"):
            response.headers["Cache-Control"] = "no-store"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app = FastAPI(
    title="Ethara HRMS API",
    version="1.0.0",
    # Docs/OpenAPI exposed only when explicitly enabled AND not in production.
    docs_url=settings.docs_url if (settings.enable_api_docs and not settings.is_production) else None,
    openapi_url=settings.openapi_url if (settings.enable_api_docs and not settings.is_production) else None,
    redoc_url=None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)

app.include_router(api_router)


@app.on_event("startup")
def _warm_ocr_engine() -> None:
    """Load the RapidOCR (Aadhaar OCR) model once per worker at startup so the
    first upload doesn't pay the cold-start cost — which under load can exceed
    the OCR request timeout and look like a failure. Best-effort: never blocks
    the app from serving if the engine can't be initialised."""
    try:
        from app.api.routes.candidates import warm_ocr_engine

        warm_ocr_engine()
    except Exception:
        pass


# Staff roles that legitimately view documents across users (mirrors the
# access the dedicated, per-record download endpoints already grant). Everyone
# else may only read files that belong to their own records.
#
# NOTE: 'evaluator' is intentionally EXCLUDED. An evaluator is often an external
# interviewer and must not be able to enumerate every Aadhaar/contract/resume via
# the bare /uploads route. Evaluators still read the candidate files they are
# assigned through the dedicated, scope-checked per-record endpoint
# (GET /candidates/{id}/resume/download → get_candidate_or_404(current_user=...)),
# so this is not a regression for their legitimate flow.
_UPLOAD_STAFF_ROLES = frozenset(
    {
        "admin",
        "super_admin",
        "leadership",
        "hr",
        "ta",
        "it_team",
        "compliance",
        "manager",
        "office_admin",
    }
)


# Substrings that mark a served upload as sensitive PII (Aadhaar / contracts /
# resumes). A successful authorized serve of these is audited so an actor who
# pulls another user's documents is attributable after the fact.
_SENSITIVE_UPLOAD_MARKERS = ("aadhaar", "aadhar", "contract", "resume")


def _user_owns_upload(db: object, user: object, requested_url: str) -> bool:
    """True if the file is referenced by a record owned by this user."""
    from sqlalchemy import select

    from app.db.models import Candidate, EmployeeContract, EmployeeDocument, EmployeeProfile

    profile = db.scalar(select(EmployeeProfile).where(EmployeeProfile.user_id == user.id))
    if profile is not None:
        if requested_url in {profile.resume_path, profile.aadhaar_path}:
            return True
        if db.scalar(
            select(EmployeeDocument.id).where(
                EmployeeDocument.employee_profile_id == profile.id,
                EmployeeDocument.file_url == requested_url,
            )
        ):
            return True
        if db.scalar(
            select(EmployeeContract.id).where(
                EmployeeContract.employee_profile_id == profile.id,
                EmployeeContract.file_url == requested_url,
            )
        ):
            return True
    if db.scalar(
        select(Candidate.id).where(
            Candidate.portal_user_id == user.id,
            Candidate.resume_url == requested_url,
        )
    ):
        return True
    return False


@app.get("/uploads/{file_path:path}")
async def serve_upload(
    file_path: str,
    request: Request,
) -> FileResponse:
    from app.api.deps import bearer_scheme, get_current_user
    from app.core.database import get_db
    from app.core.signed_urls import verify_signed_upload

    # A valid signed link (generated only by staff-gated exports) authorizes
    # access on its own, so a document URL embedded in an exported CSV opens
    # directly in the browser without an Authorization header. The HMAC signature
    # is unforgeable and time-limited; path-traversal containment below still runs.
    signed_ok = verify_signed_upload(
        file_path,
        request.query_params.get("exp"),
        request.query_params.get("sig"),
    )

    actor_label = "signed-link"
    if not signed_ok:
        credentials = await bearer_scheme(request)
        if credentials is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

        db_gen = get_db()
        db = next(db_gen)
        try:
            user = get_current_user(request=request, db=db, credentials=credentials)
            # Object-level authorization: staff may read any document; everyone else
            # only files referenced by their own records. Prevents an authenticated
            # user from enumerating other people's resumes / Aadhaar / contracts.
            role_value = getattr(user.role, "value", user.role)
            if role_value not in _UPLOAD_STAFF_ROLES:
                requested_url = f"/uploads/{file_path}"
                if not _user_owns_upload(db, user, requested_url):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            actor_label = getattr(user, "id", None) or "unknown"
        except HTTPException:
            raise
        finally:
            try:
                next(db_gen)
            except StopIteration:
                pass

    target = settings.local_storage_path / file_path
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    resolved = target.resolve()
    storage_root = settings.local_storage_path.resolve()
    # Use path-relative containment rather than a string prefix so a sibling
    # directory ("uploads_x") cannot satisfy the check.
    if not resolved.is_relative_to(storage_root):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Best-effort audit of authorized access to sensitive PII (Aadhaar / contracts /
    # resumes). Records actor (user id or 'signed-link') + path + client IP so a
    # bulk pull is attributable. Wrapped so logging never breaks the download.
    try:
        lowered = file_path.lower()
        if any(marker in lowered for marker in _SENSITIVE_UPLOAD_MARKERS):
            from app.services.event_log import log_event, request_context

            log_event(
                "file-access",
                "sensitive_upload_served",
                actor=str(actor_label),
                authVia="signed-link" if signed_ok else "bearer",
                filePath=f"/uploads/{file_path}",
                **request_context(request),
            )
    except Exception:
        pass

    return FileResponse(resolved)


@app.get("/healthz")
def healthz() -> dict:
    """Liveness probe — process is up and can reach the database."""
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        ) from exc

    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> dict:
    """Readiness probe — checks the dependencies a request actually needs
    (database + Redis). Used by the load balancer / orchestrator to decide
    whether to route traffic to this instance."""
    checks: dict[str, str] = {}

    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
        checks["database"] = "ok"
    except SQLAlchemyError:
        checks["database"] = "unavailable"

    try:
        import redis  # provided by celery[redis]

        client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        client.close()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unavailable"

    if any(value != "ok" for value in checks.values()):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "not_ready", "checks": checks},
        )

    return {"status": "ready", "checks": checks}
