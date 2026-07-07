import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
import pytz as _pytz
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field, field_validator

try:
    from .database import create_database
except ImportError:
    from database import create_database

load_dotenv()

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
DOCUMENTS_DIR = BASE_DIR / "assets" / "documents"
FRONTEND_BUILD_DIR = BASE_DIR.parent / "frontend" / "build"
FRONTEND_STATIC_DIR = FRONTEND_BUILD_DIR / "static"
IST = _pytz.timezone("Asia/Kolkata")


def _as_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _csv_env(name: str, default: List[str]) -> List[str]:
    raw = os.getenv(name)
    if raw is None:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


DEFAULT_LOCAL_SECRET_KEY = "local-dev-secret-key"
_configured_secret = (os.getenv("SECRET_KEY") or "").strip()
SECRET_KEY = _configured_secret if _configured_secret and _configured_secret != DEFAULT_LOCAL_SECRET_KEY else uuid4().hex
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))
AUTO_SEED_LOCAL_DATA = os.getenv("AUTO_SEED_LOCAL_DATA")
PUBLIC_WIKI_MODE = _as_bool(os.getenv("PUBLIC_WIKI_MODE"), default=True)
ENABLE_SELF_SERVICE_REGISTRATION = _as_bool(os.getenv("ENABLE_SELF_SERVICE_REGISTRATION"), default=False)
ENABLE_SELF_SERVICE_PASSWORD_RESET = _as_bool(os.getenv("ENABLE_SELF_SERVICE_PASSWORD_RESET"), default=False)
HRMS_API_ORIGIN = (os.getenv("HRMS_API_ORIGIN") or "http://127.0.0.1:3001").rstrip("/")
HRMS_WIKI_ACCESS_ROLES = set(
    _csv_env("HRMS_WIKI_ACCESS_ROLES", ["employee", "employee_referrer"])
)
ALLOWED_EMAIL_DOMAINS = [domain.lower() for domain in _csv_env("ALLOWED_EMAIL_DOMAINS", [])]
LOCAL_ALLOWED_ORIGINS = _csv_env(
    "LOCAL_ALLOWED_ORIGINS",
    [
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:3100",
        "http://localhost:3100",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
)
LOCAL_ALLOWED_ORIGIN_REGEX = os.getenv(
    "LOCAL_ALLOWED_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$",
)
ANALYTICS_ACTIVITY_TYPES = ["page_view", "login", "search", "page_duration"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_ALLOWED_ORIGINS,
    allow_origin_regex=LOCAL_ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_STATIC_DIR), name="frontend-static")

_client, db, _db_backend = create_database(BASE_DIR)

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
security = HTTPBearer()
_GENERATED_SECRETS: Dict[str, str] = {}
LOCAL_ACCESS_USER = {
    "email": "local.viewer@wiki.local",
    "name": "Local Viewer",
    "password_env": "LOCAL_ACCESS_PASSWORD",
    "legacy_password": "local-viewer-access",
    "role": "viewer",
    "dob": "1995-01-01",
    "company_id": "LOCAL-001",
    "company_doj": "2024-01-01",
}

PROFILE_PICTURE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def _is_loopback_host(host: Optional[str]) -> bool:
    return host in {"127.0.0.1", "::1", "localhost"}


def _assert_loopback_request(request: Request) -> None:
    client_host = request.client.host if request.client else None
    if not _is_loopback_host(client_host):
        raise HTTPException(status_code=403, detail="Local auto-access is restricted to localhost")


def _html_to_text(content_html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", content_html or "")).strip()


def _configured_env_value(name: str) -> Optional[str]:
    value = (os.getenv(name) or "").strip()
    return value or None


def _ephemeral_secret(name: str, token_bytes: int = 24) -> str:
    cached = _GENERATED_SECRETS.get(name)
    if cached:
        return cached
    generated = secrets.token_urlsafe(token_bytes)
    _GENERATED_SECRETS[name] = generated
    return generated


def _resolve_seed_password(existing_user: Optional[dict], env_name: str, legacy_password: Optional[str] = None):
    configured_password = _configured_env_value(env_name)
    if configured_password:
        return configured_password, False

    current_hash = existing_user.get("password_hash") if existing_user else None
    if not current_hash:
        return _ephemeral_secret(env_name), True

    if legacy_password and pwd_context.verify(legacy_password, current_hash):
        return _ephemeral_secret(env_name), True

    return None, False


def _announce_generated_password(email: str, env_name: str, password: str) -> None:
    print(
        f"[Startup] Generated bootstrap password for {email}. "
        f"Set {env_name} to keep it stable. Password: {password}"
    )


def _serialize_user(user: dict) -> dict:
    return {
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "dob": user.get("dob"),
        "company_doj": user.get("company_doj"),
        "company_id": user.get("company_id"),
        "ethara_email": user.get("ethara_email"),
        "personal_email": user.get("personal_email"),
        "phone": user.get("phone"),
        "department": user.get("department"),
        "designation": user.get("designation"),
        "gender": user.get("gender"),
        "hrms_profile_id": user.get("hrms_profile_id"),
        "hrms_synced_at": user.get("hrms_synced_at"),
        "profile_picture": user.get("profile_picture"),
    }


def _ensure_local_access_user() -> dict:
    email = LOCAL_ACCESS_USER["email"]
    existing_user = db.users.find_one({"email": email})
    local_password, _ = _resolve_seed_password(
        existing_user,
        LOCAL_ACCESS_USER["password_env"],
        LOCAL_ACCESS_USER["legacy_password"],
    )
    if existing_user:
        update_fields = {}
        if (
            existing_user.get("name") != LOCAL_ACCESS_USER["name"]
            or existing_user.get("role") != LOCAL_ACCESS_USER["role"]
            or existing_user.get("dob") != LOCAL_ACCESS_USER["dob"]
            or existing_user.get("company_id") != LOCAL_ACCESS_USER["company_id"]
            or existing_user.get("company_doj") != LOCAL_ACCESS_USER["company_doj"]
        ):
            update_fields.update(
                {
                    "name": LOCAL_ACCESS_USER["name"],
                    "role": LOCAL_ACCESS_USER["role"],
                    "dob": LOCAL_ACCESS_USER["dob"],
                    "company_id": LOCAL_ACCESS_USER["company_id"],
                    "company_doj": LOCAL_ACCESS_USER["company_doj"],
                }
            )
        if local_password:
            update_fields["password_hash"] = pwd_context.hash(local_password)
        if update_fields:
            db.users.update_one({"email": email}, {"$set": update_fields})
        refreshed = db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
        if refreshed:
            return refreshed

    now = datetime.now(timezone.utc).isoformat()
    db.users.insert_one(
        {
            "email": email,
            "name": LOCAL_ACCESS_USER["name"],
            "password_hash": pwd_context.hash(local_password or _ephemeral_secret(LOCAL_ACCESS_USER["password_env"])),
            "role": LOCAL_ACCESS_USER["role"],
            "dob": LOCAL_ACCESS_USER["dob"],
            "company_id": LOCAL_ACCESS_USER["company_id"],
            "company_doj": LOCAL_ACCESS_USER["company_doj"],
            "created_at": now,
        }
    )
    return db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})


def _role_values_from_hrms_user(hrms_user: dict) -> set[str]:
    values = set()
    role = hrms_user.get("role")
    if role:
        values.add(str(role))
    for role_value in hrms_user.get("roles") or []:
        if role_value:
            values.add(str(role_value))
    return values


def _first_value(*values: Any) -> Optional[str]:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _date_only(*values: Any) -> Optional[str]:
    text = _first_value(*values)
    if not text:
        return None
    return text[:10]


def _employee_from_dashboard(hrms_dashboard: Optional[dict]) -> dict:
    if not isinstance(hrms_dashboard, dict):
        return {}
    employee = hrms_dashboard.get("employee")
    return employee if isinstance(employee, dict) else {}


def _hrms_profile_fields(hrms_user: dict, hrms_profile: Optional[dict], hrms_dashboard: Optional[dict]) -> dict:
    profile = hrms_profile if isinstance(hrms_profile, dict) else {}
    employee = _employee_from_dashboard(hrms_dashboard)

    return {
        "name": _first_value(profile.get("fullName"), profile.get("name"), employee.get("fullName"), hrms_user.get("name")),
        "dob": _date_only(profile.get("dateOfBirth"), employee.get("dateOfBirth")),
        "company_doj": _date_only(employee.get("dateOfJoining"), profile.get("dateOfJoining")),
        "company_id": _first_value(profile.get("employeeCode"), employee.get("employeeCode")),
        "ethara_email": _first_value(profile.get("etharaEmail"), employee.get("etharaEmail"), hrms_user.get("email")),
        "personal_email": _first_value(profile.get("personalEmail"), employee.get("personalEmail")),
        "phone": _first_value(profile.get("phone"), employee.get("phone"), hrms_user.get("phone")),
        "department": _first_value(profile.get("department"), employee.get("department")),
        "designation": _first_value(profile.get("designation"), employee.get("designation")),
        "gender": _first_value(profile.get("gender"), employee.get("gender")),
        "hrms_profile_id": _first_value(profile.get("id"), employee.get("id")),
    }


def _ensure_hrms_wiki_viewer(hrms_user: dict, hrms_profile: Optional[dict] = None, hrms_dashboard: Optional[dict] = None) -> dict:
    email = (hrms_user.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=403, detail="HRMS user email is required")

    synced_fields = _hrms_profile_fields(hrms_user, hrms_profile, hrms_dashboard)
    name = (synced_fields.pop("name", None) or email).strip()
    existing_user = db.users.find_one({"email": email})
    update_fields = {
        "name": name,
        "role": "viewer",
        "profile_source": "hrms",
        "hrms_user_id": hrms_user.get("id"),
        "hrms_synced_at": datetime.now(timezone.utc).isoformat(),
    }
    update_fields.update(synced_fields)

    if existing_user:
        db.users.update_one({"email": email}, {"$set": update_fields})
    else:
        now = datetime.now(timezone.utc).isoformat()
        db.users.insert_one(
            {
                "email": email,
                "name": name,
                "password_hash": pwd_context.hash(_ephemeral_secret(f"HRMS_WIKI_{email}", 18)),
                "role": "viewer",
                "profile_source": "hrms",
                "hrms_user_id": hrms_user.get("id"),
                **synced_fields,
                "created_at": now,
                "hrms_synced_at": update_fields["hrms_synced_at"],
            }
        )

    user = db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=500, detail="Failed to prepare Wiki employee session")
    return user


async def _verify_hrms_wiki_session(access_token: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{HRMS_API_ORIGIN}/api/v1/auth/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Unable to verify HRMS session") from exc

    if response.status_code in {401, 403}:
        raise HTTPException(status_code=response.status_code, detail="HRMS session is not authorized for Wiki")
    if not response.is_success:
        raise HTTPException(status_code=502, detail="Unable to verify HRMS session")

    payload = response.json()
    hrms_user = payload.get("user") if isinstance(payload, dict) and "user" in payload else payload
    if not isinstance(hrms_user, dict):
        raise HTTPException(status_code=502, detail="Invalid HRMS session response")

    if not (_role_values_from_hrms_user(hrms_user) & HRMS_WIKI_ACCESS_ROLES):
        raise HTTPException(status_code=403, detail="Wiki access is available for employees only")

    return payload


async def _fetch_hrms_employee_dashboard(access_token: str) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{HRMS_API_ORIGIN}/api/v1/employees/me/dashboard",
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError:
        return None

    if not response.is_success:
        return None

    payload = response.json()
    return payload if isinstance(payload, dict) else None


def _should_seed_local_data() -> bool:
    if AUTO_SEED_LOCAL_DATA is not None:
        return _as_bool(AUTO_SEED_LOCAL_DATA)
    return True


def _seeded_dob(offset_days: int, year: int) -> str:
    day = (datetime.now(IST) + timedelta(days=offset_days)).date()
    return f"{year:04d}-{day.month:02d}-{day.day:02d}"


def seed_local_demo_data():
    if not _should_seed_local_data():
        return

    now = datetime.now(timezone.utc).isoformat()
    admin_email = "admin@ethara.ai"

    demo_users = [
        {
            "email": admin_email,
            "name": "Ethara Admin",
            "password_env": "ADMIN_BOOTSTRAP_PASSWORD",
            "legacy_password": "admin123",
            "role": "admin",
            "dob": "1990-05-15",
            "company_id": "ETH-001",
            "company_doj": "2024-01-08",
        },
        {
            "email": "hr@ethara.ai",
            "name": "HR Partner",
            "password_env": "HR_BOOTSTRAP_PASSWORD",
            "legacy_password": "Ethara@2026#Secure",
            "role": "hr",
            "dob": None,
            "company_id": "ETH-002",
            "company_doj": "2024-02-05",
        },
        {
            "email": "leadership@ethara.ai",
            "name": "Leadership Team",
            "password_env": "LEADERSHIP_BOOTSTRAP_PASSWORD",
            "legacy_password": "Ethara@2026#Secure",
            "role": "viewer",
            "dob": None,
            "company_id": "ETH-003",
            "company_doj": "2024-03-11",
        },
        {
            "email": "testuser@example.com",
            "name": "Test User",
            "password_env": "TEST_USER_BOOTSTRAP_PASSWORD",
            "legacy_password": "test123",
            "role": "viewer",
            "dob": None,
            "company_id": "ETH-004",
            "company_doj": "2024-04-15",
        },
    ]

    for user in demo_users:
        existing_user = db.users.find_one({"email": user["email"]})
        desired_password, announce_password = _resolve_seed_password(
            existing_user,
            user["password_env"],
            user.get("legacy_password"),
        )
        if existing_user:
            update_fields = {}
            for field in ["name", "role", "dob", "company_id", "company_doj"]:
                if existing_user.get(field) != user.get(field):
                    update_fields[field] = user.get(field)
            if desired_password:
                current_hash = existing_user.get("password_hash")
                if not current_hash or not pwd_context.verify(desired_password, current_hash):
                    update_fields["password_hash"] = pwd_context.hash(desired_password)
            if update_fields:
                db.users.update_one({"_id": existing_user["_id"]}, {"$set": update_fields})
                if announce_password and "password_hash" in update_fields:
                    _announce_generated_password(user["email"], user["password_env"], desired_password)
            continue
        effective_password = desired_password or _ephemeral_secret(user["password_env"])
        db.users.insert_one(
            {
                "email": user["email"],
                "name": user["name"],
                "password_hash": pwd_context.hash(effective_password),
                "role": user["role"],
                "dob": user["dob"],
                "company_id": user["company_id"],
                "company_doj": user["company_doj"],
                "created_at": now,
            }
        )
        if announce_password:
            _announce_generated_password(user["email"], user["password_env"], effective_password)

    local_pages = [
        {
            "slug": "core-values",
            "title": "Core Values",
            "category": "foundation",
            "subcategory": "Core Values",
            "content_html": """
                <h1>Core Values</h1>
                <p>These values guide how Ethara AI builds, collaborates, and ships.</p>
                <ul>
                  <li><strong>Quality First</strong> - We prefer durable solutions over rushed output.</li>
                  <li><strong>Innovation</strong> - We experiment with intention and turn ideas into systems.</li>
                  <li><strong>Customer Obsession</strong> - We stay close to user pain and business outcomes.</li>
                  <li><strong>Data-Driven</strong> - We validate instincts with evidence.</li>
                  <li><strong>Solution-Oriented</strong> - We bring fixes, not just flags.</li>
                  <li><strong>Constructive Conflict</strong> - We challenge ideas directly and respectfully.</li>
                </ul>
            """,
        },
        {
            "slug": "what-we-do",
            "title": "What We Do",
            "category": "foundation",
            "subcategory": "What We Do",
            "content_html": """
                <h1>What We Do</h1>
                <p>Ethara AI helps teams operationalize modern AI through applied research, workflow automation, and internal knowledge systems.</p>
                <p>Our work spans experimentation, deployment, evaluation, and the day-to-day tooling that keeps high-output teams moving.</p>
            """,
        },
        {
            "slug": "organization-chart",
            "title": "Organization Chart",
            "category": "foundation",
            "subcategory": "Organigram",
            "content_html": """
                <h1>Ethara AI Leadership</h1>
                <p>Leadership information for the local development workspace.</p>
            """,
        },
        {
            "slug": "leave-policy",
            "title": "Leave Policy",
            "category": "hr",
            "subcategory": "Leave Policy",
            "content_html": """
                <h1>Leave Policy</h1>
                <p>Employees should submit planned leave requests at least three working days in advance unless there is an emergency.</p>
                <p>Managers review requests based on workload, team coverage, and business continuity.</p>
            """,
        },
        {
            "slug": "code-of-conduct",
            "title": "Code of Conduct",
            "category": "hr",
            "subcategory": "Code of Conduct",
            "content_html": """
                <h1>Code of Conduct</h1>
                <p>Ethara AI expects respectful communication, responsible data handling, and professional behavior across every team and project.</p>
            """,
        },
        {
            "slug": "process-flow-overview",
            "title": "Process Flow Overview",
            "category": "operations",
            "subcategory": "Process Flow",
            "content_html": """
                <h1>Process Flow Overview</h1>
                <p>This page summarizes the internal workflow before you open the detailed process flow document.</p>
            """,
        },
    ]

    for page in local_pages:
        if db.wiki_pages.find_one({"slug": page["slug"]}):
            continue
        db.wiki_pages.insert_one(
            {
                **page,
                "content_text": _html_to_text(page["content_html"]),
                "created_by": admin_email,
                "updated_by": admin_email,
                "created_at": now,
                "updated_at": now,
                "show_bookmarks": False,
                "show_notes": False,
            }
        )

# --- Startup Data Migration ---
# Ensures wiki content is correct on every deployment
def run_startup_migrations():
    import re as _re
    now = datetime.now(timezone.utc).isoformat()

    # 1. Organigram: correct founder order (Suryansh 1st, Mahanaaryaman 2nd, Shubham 3rd) + no Org Structure section
    ORGANIGRAM_HTML = '<h1>Ethara AI Leadership</h1>\n<p>Meet the visionaries building Ethara AI into a force for AI excellence.</p>\n\n<hr>\n\n<h2>\U0001f535 Suryansh Rana</h2>\n<h3>Co-Founder & Chief Executive Officer</h3>\n<p><em>Research | Technical Vision | Operations Architecture</em></p>\n\n<p>Every AI system needs a brain. Suryansh builds it.</p>\n\n<p>As Co-Founder and CEO, he drives Ethara AI\u2019s research direction, technical architecture, and operational backbone. From model research and infrastructure design to system reliability and product depth, he ensures that every solution is technically rigorous and future-ready.</p>\n\n<p>He translates complex AI innovation into deployable, scalable systems\u2014bridging research excellence with real-world execution. Under his leadership, experimentation becomes infrastructure, and infrastructure becomes competitive advantage.</p>\n\n<p><strong>At Ethara, innovation is not an experiment. It\u2019s engineered.</strong></p>\n\n<hr>\n\n<h2>\U0001f7e2 Mahanaaryaman Rao Scindia</h2>\n<h3>Co-Founder & Chief Growth Officer</h3>\n<p><em>Growth | People | Culture | Scale</em></p>\n\n<p>If Ethara AI is expanding at velocity, Mahanaaryaman is the force shaping that trajectory.</p>\n\n<p>As Co-Founder and Chief Growth Officer, he leads the Growth and HR verticals\u2014designing the engine that powers Ethara\u2019s expansion across markets, clients, and talent ecosystems. From strategic partnerships to revenue acceleration, from hiring frameworks to organizational culture, he ensures that scale is intentional, sustainable, and people-first.</p>\n\n<p>He operates at the intersection of ambition and alignment\u2014building not just numbers, but teams that can carry those numbers forward.</p>\n\n<p><strong>At Ethara, growth isn\u2019t just about revenue curves. It\u2019s about building a high-performance culture. That\u2019s his arena.</strong></p>\n\n<hr>\n\n<h2>\U0001f7e3 Shubham Garg</h2>\n<h3>Co-Founder & Chief Financial Officer</h3>\n<p><em>Finance | Strategic Alliances | Capital Discipline</em></p>\n\n<p>Every bold vision needs structural strength. Shubham builds the foundation.</p>\n\n<p>As Co-Founder and CFO, he oversees Finance and Business Relationships\u2014ensuring that Ethara AI scales with financial precision and strategic discipline. From capital allocation to revenue optimization, from investor alignment to enterprise partnerships, he safeguards the company\u2019s long-term strength.</p>\n\n<p>He balances ambition with sustainability\u2014ensuring that every expansion move is financially intelligent and relationship-driven.</p>\n\n<p><strong>At Ethara, numbers tell a story. He ensures it\u2019s a powerful one.</strong></p>'

    org_page = db.wiki_pages.find_one({"slug": "organization-chart"})
    if org_page:
        db.wiki_pages.update_one({"slug": "organization-chart"}, {"$set": {"content_html": ORGANIGRAM_HTML, "updated_at": now}})
    
    # 2. Code of Conduct: remove Reporting & Grievance + Acknowledgement Required sections
    coc_page = db.wiki_pages.find_one({"slug": "code-of-conduct"})
    if coc_page:
        coc_html = coc_page.get("content_html", "")
        changed = False
        if "Reporting & Grievance" in coc_html:
            coc_html = _re.sub(r'<hr>\s*<h2>📢 Reporting & Grievance Mechanism</h2>.*?(?=<hr>)', '', coc_html, flags=_re.DOTALL)
            changed = True
        if "Acknowledgement Required" in coc_html:
            coc_html = _re.sub(r'<div class="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-5 mt-8">.*?</div>', '', coc_html, flags=_re.DOTALL)
            changed = True
        if changed:
            db.wiki_pages.update_one({"slug": "code-of-conduct"}, {"$set": {"content_html": coc_html, "updated_at": now}})

    # 3. FAQs page: seed if not exists
    FAQ_HTML = """<h1>Frequently Asked Questions</h1>
<p>The most commonly asked questions from new employees joining Ethara AI.</p>

<hr>

<h2>What are the working hours at Ethara AI?</h2>
<p>Standard hours are <strong>10:00 AM to 7:00 PM, Monday to Friday</strong>. Flexible arrangements may be discussed with your Team Lead / Reporting Manager.</p>

<hr>

<h2>Who do I contact for IT setup and access?</h2>
<p>Reach out to the IT Support team at <strong>it@ethara.ai</strong>. Submit a request on Day 1 for laptop, email, and tool access. Your Team Lead will also guide you through the process.</p>

<hr>

<h2>Where can I find company policies?</h2>
<p>All policies are available on the <strong>Company Wiki</strong> under the <strong>'HR'</strong> section.</p>

<hr>

<h2>How do I apply for leave?</h2>
<p>Leave must be applied via the HR management portal at least <strong>3 working days in advance</strong> (except emergencies). You may also connect with your Team Lead / Reporting Manager for the same.</p>

<hr>

<h2>Is there a dress code?</h2>
<p><strong>Business casual</strong> is the standard. Client-facing days require formal or smart casual attire.</p>

<hr>

<h2>How do I get added to relevant Slack channels and project tools?</h2>
<p>Your <strong>Reporting Manager / Team Lead</strong> will add you on Day 1.</p>

<hr>

<h2>Who do I report workplace concerns to?</h2>
<p>Raise concerns with your <strong>Reporting Manager / Team Lead</strong> first. If unresolved, contact HR at <strong>hr@ethara.ai</strong>. You can also submit your concerns at the <strong>"Submit Grievance"</strong> section in the company wiki.</p>

<hr>

<h2>Are there learning & development opportunities?</h2>
<p>Yes — Ethara AI has a variety of projects, which ensures that the learning graph of the employees goes up and beyond.</p>"""

    faq_page = db.wiki_pages.find_one({"slug": "faqs"})
    if not faq_page:
        import html as _html
        faq_text = _html.unescape(_re.sub(r'<[^>]+>', ' ', FAQ_HTML)).strip()
        faq_text = _re.sub(r'\s+', ' ', faq_text)
        db.wiki_pages.insert_one({
            "title": "FAQs",
            "slug": "faqs",
            "category": "hr",
            "subcategory": "FAQs",
            "content_html": FAQ_HTML,
            "content_text": faq_text,
            "created_by": "admin@ethara.ai",
            "created_at": now,
            "updated_at": now,
            "show_bookmarks": False,
            "show_notes": False
        })
        print("[Startup] FAQ page created")

    print("[Startup] Wiki content migrations applied")


def _local_doc(filename: str) -> Path:
    return DOCUMENTS_DIR / filename


seed_local_demo_data()
run_startup_migrations()

# Internal document URLs (not exposed to frontend)
INTERNAL_DOCS = {
    "psychology-of-prompting": _local_doc("psychology-of-prompting.pdf"),
    "process-flow": _local_doc("process-flow.pdf"),
    # Deep Learning - Benchmarks & Evaluation
    "software-engineering-testing-llm": "https://drive.google.com/uc?export=download&id=1tRMzGP4Ur46VP3xDS9_RFt5B0fQMZR_N",
    "hallulens-benchmark": "https://drive.google.com/uc?export=download&id=1Ey-hCDThjPwjkAha_lB8yAmhhE42VwpF",
    "humanitys-last-exam": "https://drive.google.com/uc?export=download&id=1Am5bzQvCkjEg36jcF5rHF66MqZb-_L8c",
    # Deep Learning - Coding Agents & Software Benchmarks
    "swe-bench-pro": "https://drive.google.com/uc?export=download&id=1Zw9c4n4S2vhAUPIAD7Z109h8fZL6n6FO",
    "swe-evo": "https://drive.google.com/uc?export=download&id=1yu39ZpxZgRWIzxncdWf0aS0pMEMqLF9X",
    # Deep Learning - Foundations & Post-Training
    "post-training-overview": "https://drive.google.com/uc?export=download&id=1fLzPzNzjr8lQtkAqHDZ6RVYX4nnNVmo4",
    # Deep Learning - Reinforcement Learning & Alignment
    "rubric-scaffolded-rl": "https://drive.google.com/uc?export=download&id=12bhLMAWYr0EzwJ-ipEytRmaYKj7C5bNb",
    # Deep Learning - Rubric-Based Evaluation
    "concept-based-rubrics": "https://drive.google.com/uc?export=download&id=1zzFcIrBNeFzivPxy2NIGsm2n2G9ndZh6",
    "open-rubrics": "https://drive.google.com/uc?export=download&id=17UYm7W1nUzrPZOylCRpdEGodKrZ467ig",
    "rubicon-evaluation": "https://drive.google.com/uc?export=download&id=19UgWwRMbFCn8aPLnYaibqKMzEUo1KXPR",
    "rubric-code-evaluation": "https://drive.google.com/uc?export=download&id=10483148kM7Elt1Dm9FeqPH1W6ijK0ZeT",
    # Deep Learning - Safety, Bias & Fairness
    "health-equity-toolbox": "https://drive.google.com/uc?export=download&id=1SXNsoFI9sLNGwMx9eXnVnnKPNwGGYWjl",
    # Deep Learning - Agentic RL
    "agentic-rl": _local_doc("agentic-rl.pdf"),
}

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class WikiPageCreate(BaseModel):
    title: str
    category: str
    subcategory: Optional[str] = None
    content_html: str
    content_text: str

class WikiPageUpdate(BaseModel):
    title: Optional[str] = None
    content_html: Optional[str] = None
    content_text: Optional[str] = None

class UserRoleUpdate(BaseModel):
    role: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    dob: str  # YYYY-MM-DD format

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    dob: str
    new_password: str

class ProfileUpdate(BaseModel):
    company_doj: Optional[str] = None
    company_id: Optional[str] = None
    dob: Optional[str] = None

# Bookmark and Notes Models
class BookmarkCreate(BaseModel):
    page_slug: str
    scroll_position: float  # Percentage of page scrolled (0-100)

class BookmarkUpdate(BaseModel):
    scroll_position: float

class NoteCreate(BaseModel):
    page_slug: str
    content: str

class NoteUpdate(BaseModel):
    content: str

# Feedback Models
class FeedbackCreate(BaseModel):
    page_slug: str
    comment: str

# Grievance Models
class GrievanceCreate(BaseModel):
    category: str
    description: str
    is_anonymous: bool = False

class GrievanceUpdate(BaseModel):
    status: str  # 'pending', 'in_review', 'addressed'
    hr_notes: Optional[str] = None

# Birthday Models
class BirthdayWishCreate(BaseModel):
    recipient_email: str = Field(..., min_length=3, max_length=200)
    message: str = Field(..., min_length=1, max_length=280)

    @field_validator("recipient_email")
    @classmethod
    def _validate_recipient(cls, v):
        v = v.strip()
        # Accept either real email shapes or synthetic roster ids (<ecode>@roster.local)
        if "@" not in v or v.startswith("@") or v.endswith("@") or len(v) > 200:
            raise ValueError("Invalid recipient identifier")
        return v

class BirthdaySettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    upcoming_window_days: Optional[int] = Field(None, ge=1, le=30)
    show_year_only_admin: Optional[bool] = None

class UserDOBUpdate(BaseModel):
    dob: str  # YYYY-MM-DD

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None

def _user_from_token(token: str) -> dict:
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.users.find_one({"email": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def _extract_bearer_token(request: Request) -> str:
    auth_header = (request.headers.get("authorization") or "").strip()
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    return token.strip()


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    return _user_from_token(credentials.credentials)

async def require_role(user: dict, allowed_roles: List[str]):
    if user["role"] not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.get("/api/documents/{doc_id}")
async def stream_document(doc_id: str, request: Request):
    """Stream internal documents without exposing the original URL"""
    _user_from_token(_extract_bearer_token(request))

    if doc_id not in INTERNAL_DOCS:
        raise HTTPException(status_code=404, detail="Document not found")
    
    doc_target = INTERNAL_DOCS[doc_id]
    if isinstance(doc_target, Path):
        if not doc_target.exists():
            raise HTTPException(status_code=404, detail="Document asset not found")
        return FileResponse(
            doc_target,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"inline; filename={doc_id}.pdf",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "X-Content-Type-Options": "nosniff",
            },
        )

    doc_url = doc_target
    
    # Handle Google Drive URLs - convert to direct download
    if 'drive.google.com' in doc_url:
        # Extract file ID and create direct download link
        if '/uc?' in doc_url:
            # Already a download URL, but might need confirmation bypass
            pass
        elif '/file/d/' in doc_url:
            file_id = doc_url.split('/file/d/')[1].split('/')[0]
            doc_url = f"https://drive.google.com/uc?export=download&id={file_id}&confirm=t"
    
    async def stream_pdf():
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            async with client.stream("GET", doc_url) as response:
                if response.status_code != 200:
                    raise HTTPException(status_code=response.status_code, detail="Failed to fetch document")
                async for chunk in response.aiter_bytes():
                    yield chunk
    
    return StreamingResponse(
        stream_pdf(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename={doc_id}.pdf",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "X-Content-Type-Options": "nosniff"
        }
    )

@app.post("/api/auth/register")
async def register(user_data: UserRegister, request: Request):
    if not ENABLE_SELF_SERVICE_REGISTRATION:
        raise HTTPException(status_code=403, detail="Self-service registration is disabled for this deployment")
    _assert_loopback_request(request)

    if ALLOWED_EMAIL_DOMAINS:
        email_domain = user_data.email.split("@")[-1].lower()
        if email_domain not in ALLOWED_EMAIL_DOMAINS:
            raise HTTPException(
                status_code=400,
                detail=f"Registration is restricted to these email domains: {', '.join(ALLOWED_EMAIL_DOMAINS)}",
            )
    
    existing_user = db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_count = db.users.count_documents({})
    role = "admin" if user_count == 0 else "viewer"
    
    user_doc = {
        "email": user_data.email,
        "name": user_data.name,
        "password_hash": hash_password(user_data.password),
        "role": role,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = db.users.insert_one(user_doc)
    _ = result  # Acknowledge insert result
    
    token = create_access_token({"sub": user_data.email})
    
    return {
        "token": token,
        "user": {
            "email": user_data.email,
            "name": user_data.name,
            "role": role,
            "dob": None
        }
    }

@app.post("/api/auth/login")
async def login(user_data: UserLogin):
    user = db.users.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    token = create_access_token({"sub": user_data.email})
    log_activity("login", user_data.email)
    
    return {
        "token": token,
        "user": _serialize_user(user)
    }


@app.post("/api/auth/local-session")
async def create_local_session(request: Request):
    if not PUBLIC_WIKI_MODE:
        raise HTTPException(status_code=403, detail="Local public access is disabled")
    _assert_loopback_request(request)

    user = _ensure_local_access_user()
    token = create_access_token({"sub": user["email"]})
    log_activity("login", user["email"], {"mode": "local_public"})

    return {
        "token": token,
        "user": _serialize_user(user),
    }


@app.post("/api/auth/hrms-session")
async def create_hrms_session(credentials: HTTPAuthorizationCredentials = Depends(security)):
    hrms_payload = await _verify_hrms_wiki_session(credentials.credentials)
    hrms_user = (
        hrms_payload.get("user")
        if isinstance(hrms_payload, dict) and "user" in hrms_payload
        else hrms_payload
    )
    hrms_profile = hrms_payload.get("profile") if isinstance(hrms_payload, dict) else None
    hrms_dashboard = await _fetch_hrms_employee_dashboard(credentials.credentials)
    user = _ensure_hrms_wiki_viewer(hrms_user, hrms_profile=hrms_profile, hrms_dashboard=hrms_dashboard)
    token = create_access_token({"sub": user["email"]})
    log_activity(
        "login",
        user["email"],
        {
            "mode": "hrms_employee",
            "hrms_roles": sorted(_role_values_from_hrms_user(hrms_user)),
        },
    )

    return {
        "token": token,
        "user": _serialize_user(user),
    }


@app.get("/api/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"user": user}

@app.post("/api/auth/forgot-password")
async def forgot_password(data: ForgotPasswordRequest):
    _ = data
    if not ENABLE_SELF_SERVICE_PASSWORD_RESET:
        raise HTTPException(
            status_code=403,
            detail="Self-service password reset is disabled for this deployment",
        )
    raise HTTPException(
        status_code=501,
        detail="Password reset requires an HRMS-integrated identity workflow",
    )

@app.post("/api/auth/reset-password")
async def reset_password(data: ResetPasswordRequest):
    _ = data
    if not ENABLE_SELF_SERVICE_PASSWORD_RESET:
        raise HTTPException(
            status_code=403,
            detail="Self-service password reset is disabled for this deployment",
        )
    raise HTTPException(
        status_code=501,
        detail="Password reset requires an HRMS-integrated identity workflow",
    )

@app.put("/api/auth/profile")
async def update_profile(data: ProfileUpdate, user: dict = Depends(get_current_user)):
    """Update user profile fields"""
    update_fields = {}
    
    if data.dob is not None:
        update_fields["dob"] = data.dob
    if data.company_doj is not None:
        update_fields["company_doj"] = data.company_doj
    if data.company_id is not None:
        update_fields["company_id"] = data.company_id.strip()
    
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    db.users.update_one({"email": user["email"]}, {"$set": update_fields})
    
    updated_user = db.users.find_one({"email": user["email"]}, {"_id": 0, "password_hash": 0})
    return {"user": updated_user, "message": "Profile updated successfully"}

@app.put("/api/auth/profile/role")
async def update_user_role(data: UserRoleUpdate, target_email: str, user: dict = Depends(get_current_user)):
    """Update a user's role - admin only"""
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can change roles")
    
    if data.role not in ["admin", "hr", "viewer"]:
        raise HTTPException(status_code=400, detail="Invalid role. Must be admin, hr, or viewer")
    
    result = db.users.update_one({"email": target_email}, {"$set": {"role": data.role}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": f"Role updated to {data.role}"}

UPLOAD_DIR = BASE_DIR / "uploads" / "profile_pictures"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/api/auth/profile/picture")
async def upload_profile_picture(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Upload profile picture"""
    if file.content_type not in PROFILE_PICTURE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images are allowed")
    
    max_size = 5 * 1024 * 1024  # 5MB
    contents = await file.read()
    if len(contents) > max_size:
        raise HTTPException(status_code=400, detail="File size must be less than 5MB")
    
    ext = PROFILE_PICTURE_EXTENSIONS[file.content_type]
    filename = f"{user['email'].replace('@', '_').replace('.', '_')}.{ext}"
    filepath = UPLOAD_DIR / filename
    
    with open(filepath, "wb") as f:
        f.write(contents)
    
    picture_url = f"/api/auth/profile/picture/{filename}"
    db.users.update_one({"email": user["email"]}, {"$set": {"profile_picture": picture_url}})
    
    return {"picture_url": picture_url, "message": "Profile picture updated"}

@app.get("/api/auth/profile/picture/{filename}")
async def get_profile_picture(filename: str):
    """Serve profile picture"""
    safe_filename = Path(filename).name
    if safe_filename != filename:
        raise HTTPException(status_code=400, detail="Invalid picture path")

    filepath = UPLOAD_DIR / safe_filename
    if filepath.suffix.lower().lstrip(".") not in PROFILE_PICTURE_EXTENSIONS.values():
        raise HTTPException(status_code=400, detail="Unsupported picture type")
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Picture not found")
    return FileResponse(
        filepath,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )

@app.get("/api/wiki/categories")
async def get_categories(user: dict = Depends(get_current_user)):
    categories = [
        {"id": "foundation", "name": "Foundation", "subcategories": ["Core Values", "What We Do", "Organigram"]},
        {"id": "operations", "name": "Operations", "subcategories": ["Process Flow"]},
        {"id": "hr", "name": "HR", "subcategories": ["Leave Policy", "Holiday Calendar", "Code of Conduct", "FAQs"]},
        {"id": "training", "name": "Training & Learning", "subcategories": ["Deep Learning", "Training: Get Started"]}
    ]
    
    for category in categories:
        count = db.wiki_pages.count_documents({"category": category["id"]})
        category["page_count"] = count
    
    return {"categories": categories}

@app.get("/api/wiki/pages")
async def get_pages(category: Optional[str] = None, subcategory: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {}
    if category:
        query["category"] = category
    if subcategory:
        query["subcategory"] = subcategory
    
    pages = list(db.wiki_pages.find(query, {"_id": 0}).sort("updated_at", -1).limit(100))
    return {"pages": pages}

# --- Universal Search ---
DOCUMENT_TITLES = {
    "psychology-of-prompting": {"title": "Psychology of Prompting", "type": "training", "route": "/training/get-started"},
    "process-flow": {"title": "Revised Process Flow", "type": "operations", "route": "/process-flow"},
    "software-engineering-testing-llm": {"title": "A Software Engineering Perspective on Testing Large Language Models", "type": "deep-learning", "route": "/training/deep-learning/software-engineering-testing-llm"},
    "hallulens-benchmark": {"title": "HalluLens: LLM Hallucination Benchmark", "type": "deep-learning", "route": "/training/deep-learning/hallulens-benchmark"},
    "humanitys-last-exam": {"title": "Humanity's Last Exam", "type": "deep-learning", "route": "/training/deep-learning/humanitys-last-exam"},
    "swe-bench-pro": {"title": "SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks", "type": "deep-learning", "route": "/training/deep-learning/swe-bench-pro"},
    "swe-evo": {"title": "SWE-EVO", "type": "deep-learning", "route": "/training/deep-learning/swe-evo"},
    "post-training-overview": {"title": "Post Training Overview", "type": "deep-learning", "route": "/training/deep-learning/post-training-overview"},
    "rubric-scaffolded-rl": {"title": "Breaking the Exploration Bottleneck: Rubric-Scaffolded Reinforcement Learning", "type": "deep-learning", "route": "/training/deep-learning/rubric-scaffolded-rl"},
    "concept-based-rubrics": {"title": "Concept-based Rubrics Improve LLM Formative Assessment", "type": "deep-learning", "route": "/training/deep-learning/concept-based-rubrics"},
    "open-rubrics": {"title": "OpenRubrics: Scalable Synthetic Rubric Generation for Reward Modeling", "type": "deep-learning", "route": "/training/deep-learning/open-rubrics"},
    "rubicon-evaluation": {"title": "RUBICON: Rubric-Based Evaluation of Domain-Specific Human", "type": "deep-learning", "route": "/training/deep-learning/rubicon-evaluation"},
    "rubric-code-evaluation": {"title": "Rubric Is All You Need: Enhancing LLM-based Code Evaluation", "type": "deep-learning", "route": "/training/deep-learning/rubric-code-evaluation"},
    "health-equity-toolbox": {"title": "A Toolbox for Surfacing Health Equity Harms", "type": "deep-learning", "route": "/training/deep-learning/health-equity-toolbox"},
    "agentic-rl": {"title": "Agentic RL", "type": "deep-learning", "route": "/training/deep-learning/agentic-rl"},
}

HOLIDAYS = [
    # Fixed (Gazetted) Holidays — 2026
    {"date": "2026-01-26", "day": "Monday", "occasion": "Republic Day", "type": "Gazetted Holiday"},
    {"date": "2026-03-21", "day": "Saturday", "occasion": "Id-ul-Fitr", "type": "Gazetted Holiday"},
    {"date": "2026-04-03", "day": "Friday", "occasion": "Good Friday", "type": "Gazetted Holiday"},
    {"date": "2026-05-27", "day": "Wednesday", "occasion": "Id-ul-Zuha (Bakrid)", "type": "Gazetted Holiday"},
    {"date": "2026-08-15", "day": "Saturday", "occasion": "Independence Day", "type": "Gazetted Holiday"},
    {"date": "2026-10-02", "day": "Friday", "occasion": "Mahatma Gandhi's Birthday", "type": "Gazetted Holiday"},
    {"date": "2026-10-20", "day": "Tuesday", "occasion": "Dussehra (Vijay Dashmi)", "type": "Gazetted Holiday"},
    {"date": "2026-11-08", "day": "Sunday", "occasion": "Diwali (Deepavali)", "type": "Gazetted Holiday"},
    {"date": "2026-11-24", "day": "Tuesday", "occasion": "Guru Nanak's Birthday", "type": "Gazetted Holiday"},
    {"date": "2026-12-25", "day": "Friday", "occasion": "Christmas Day", "type": "Gazetted Holiday"},
    # Restricted Holidays — 2026
    {"date": "2026-01-14", "day": "Wednesday", "occasion": "Pongal", "type": "Restricted Holiday"},
    {"date": "2026-01-23", "day": "Friday", "occasion": "Vasant Panchami", "type": "Restricted Holiday"},
    {"date": "2026-02-15", "day": "Sunday", "occasion": "Maha Shivaratri", "type": "Restricted Holiday"},
    {"date": "2026-03-19", "day": "Thursday", "occasion": "Ugadi / Gudi Padwa", "type": "Restricted Holiday"},
    {"date": "2026-03-26", "day": "Thursday", "occasion": "Ram Navami", "type": "Restricted Holiday"},
    {"date": "2026-03-31", "day": "Tuesday", "occasion": "Mahavir Jayanti", "type": "Restricted Holiday"},
    {"date": "2026-05-01", "day": "Friday", "occasion": "Buddha Purnima", "type": "Restricted Holiday"},
    {"date": "2026-06-26", "day": "Friday", "occasion": "Muharram", "type": "Restricted Holiday"},
    {"date": "2026-08-26", "day": "Wednesday", "occasion": "Prophet Mohammad's Birthday (Id-e-Milad)", "type": "Restricted Holiday"},
    {"date": "2026-08-26", "day": "Wednesday", "occasion": "Onam", "type": "Restricted Holiday"},
    {"date": "2026-08-28", "day": "Friday", "occasion": "Raksha Bandhan", "type": "Restricted Holiday"},
    {"date": "2026-09-04", "day": "Friday", "occasion": "Janmashtami", "type": "Restricted Holiday"},
    {"date": "2026-09-14", "day": "Monday", "occasion": "Ganesh Chaturthi", "type": "Restricted Holiday"},
    {"date": "2026-10-29", "day": "Thursday", "occasion": "Karva Chauth", "type": "Restricted Holiday"},
    {"date": "2026-11-09", "day": "Monday", "occasion": "Govardhan Puja", "type": "Restricted Holiday"},
    {"date": "2026-11-11", "day": "Wednesday", "occasion": "Bhai Dooj", "type": "Restricted Holiday"},
    {"date": "2026-11-15", "day": "Sunday", "occasion": "Chhath Puja", "type": "Restricted Holiday"},
    {"date": "2026-12-24", "day": "Thursday", "occasion": "Christmas Eve", "type": "Restricted Holiday"},
]

@app.get("/api/search")
async def universal_search(q: str, user: dict = Depends(get_current_user)):
    if not q or len(q.strip()) < 2:
        return {"results": []}
    
    query = q.strip().lower()
    log_activity("search", user.get("email"), {"query": query})
    results = []
    
    # 1. Search wiki pages (limited for performance)
    wiki_pages = list(db.wiki_pages.find({}, {"_id": 0, "title": 1, "slug": 1, "category": 1, "content_text": 1}).limit(200))
    for page in wiki_pages:
        title = (page.get("title") or "").lower()
        content = (page.get("content_text") or "").lower()
        if query in title or query in content:
            snippet = ""
            if query in content:
                idx = content.index(query)
                start = max(0, idx - 40)
                end = min(len(content), idx + len(query) + 60)
                snippet = ("..." if start > 0 else "") + content[start:end] + ("..." if end < len(content) else "")
            results.append({
                "type": "wiki",
                "title": page["title"],
                "subtitle": page.get("category", "").capitalize(),
                "snippet": snippet,
                "route": f"/wiki/page/{page['slug']}"
            })
    
    # 2. Search documents
    for doc_id, doc_info in DOCUMENT_TITLES.items():
        if query in doc_info["title"].lower():
            results.append({
                "type": "document",
                "title": doc_info["title"],
                "subtitle": doc_info["type"].replace("-", " ").title(),
                "snippet": "",
                "route": doc_info["route"]
            })
    
    # 3. Search holidays
    for h in HOLIDAYS:
        if query in h["occasion"].lower() or query in h["type"].lower() or query in h["date"]:
            results.append({
                "type": "holiday",
                "title": h["occasion"],
                "subtitle": f'{h["date"]} ({h["day"]}) - {h["type"]}',
                "snippet": "",
                "route": "/hr/holiday-calendar"
            })
    
    # 4. Search user's grievances
    user_email = user.get("email", "")
    grievances = list(db.grievances.find({"submitted_by": user_email}, {"_id": 0, "category": 1, "description": 1, "status": 1}))
    for g in grievances:
        desc = (g.get("description") or "").lower()
        cat = (g.get("category") or "").lower()
        if query in desc or query in cat:
            snippet = ""
            if query in desc:
                idx = desc.index(query)
                start = max(0, idx - 40)
                end = min(len(desc), idx + len(query) + 60)
                snippet = ("..." if start > 0 else "") + desc[start:end] + ("..." if end < len(desc) else "")
            results.append({
                "type": "grievance",
                "title": g.get("category", "Grievance"),
                "subtitle": f'Status: {g.get("status", "pending").replace("_", " ").title()}',
                "snippet": snippet,
                "route": "/grievances/submit"
            })
    
    return {"results": results[:20]}

@app.get("/api/wiki/pages/{slug}")
async def get_page(slug: str, user: dict = Depends(get_current_user)):
    page = db.wiki_pages.find_one({"slug": slug}, {"_id": 0})
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    log_activity("page_view", user.get("email"), {"page_slug": slug, "page_title": page.get("title", slug)})
    return {"page": page}

@app.post("/api/wiki/pages")
async def create_page(page_data: WikiPageCreate, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    
    slug = page_data.title.lower().replace(" ", "-").replace("/", "-")
    
    existing_page = db.wiki_pages.find_one({"slug": slug})
    if existing_page:
        slug = f"{slug}-{int(datetime.now(timezone.utc).timestamp())}"
    
    page_doc = {
        "slug": slug,
        "title": page_data.title,
        "category": page_data.category,
        "subcategory": page_data.subcategory,
        "content_html": page_data.content_html,
        "content_text": page_data.content_text,
        "created_by": user["email"],
        "updated_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    db.wiki_pages.insert_one(page_doc.copy())
    page_doc.pop("_id", None)
    
    return {"page": page_doc}

@app.put("/api/wiki/pages/{slug}")
async def update_page(slug: str, page_data: WikiPageUpdate, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    
    existing_page = db.wiki_pages.find_one({"slug": slug})
    if not existing_page:
        raise HTTPException(status_code=404, detail="Page not found")
    
    update_data = {"updated_by": user["email"], "updated_at": datetime.now(timezone.utc).isoformat()}
    
    if page_data.title is not None:
        update_data["title"] = page_data.title
    if page_data.content_html is not None:
        update_data["content_html"] = page_data.content_html
    if page_data.content_text is not None:
        update_data["content_text"] = page_data.content_text
    
    db.wiki_pages.update_one({"slug": slug}, {"$set": update_data})
    
    updated_page = db.wiki_pages.find_one({"slug": slug}, {"_id": 0})
    return {"page": updated_page}

@app.delete("/api/wiki/pages/{slug}")
async def delete_page(slug: str, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    
    result = db.wiki_pages.delete_one({"slug": slug})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Page not found")
    
    return {"message": "Page deleted successfully"}

@app.get("/api/users")
async def get_users(user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    
    users = list(db.users.find({}, {"_id": 0, "password_hash": 0}))
    return {"users": users}

@app.put("/api/users/{email}/role")
async def update_user_role(email: str, role_data: UserRoleUpdate, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    
    if role_data.role not in ["admin", "hr", "editor", "viewer"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    result = db.users.update_one({"email": email}, {"$set": {"role": role_data.role}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": "Role updated successfully"}

@app.delete("/api/users/{email}")
async def delete_user(email: str, user: dict = Depends(get_current_user)):
    await require_role(user, ["admin"])
    
    if email == user["email"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    result = db.users.delete_one({"email": email})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": "User deleted successfully"}
# ==================== BOOKMARK ENDPOINTS ====================

@app.post("/api/bookmarks")
async def create_bookmark(bookmark_data: BookmarkCreate, user: dict = Depends(get_current_user)):
    """Create or update a bookmark for a page"""
    existing_bookmark = db.bookmarks.find_one({
        "user_email": user["email"],
        "page_slug": bookmark_data.page_slug
    })
    
    if existing_bookmark:
        # Update existing bookmark
        db.bookmarks.update_one(
            {"user_email": user["email"], "page_slug": bookmark_data.page_slug},
            {"$set": {
                "scroll_position": bookmark_data.scroll_position,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        return {"message": "Bookmark updated", "scroll_position": bookmark_data.scroll_position}
    
    bookmark_doc = {
        "user_email": user["email"],
        "page_slug": bookmark_data.page_slug,
        "scroll_position": bookmark_data.scroll_position,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    db.bookmarks.insert_one(bookmark_doc)
    
    return {"message": "Bookmark created", "scroll_position": bookmark_data.scroll_position}

@app.get("/api/bookmarks/{page_slug}")
async def get_bookmark(page_slug: str, user: dict = Depends(get_current_user)):
    """Get bookmark for a specific page"""
    bookmark = db.bookmarks.find_one(
        {"user_email": user["email"], "page_slug": page_slug},
        {"_id": 0}
    )
    return {"bookmark": bookmark}

@app.get("/api/bookmarks")
async def get_all_bookmarks(user: dict = Depends(get_current_user)):
    """Get all bookmarks for the current user"""
    bookmarks = list(db.bookmarks.find(
        {"user_email": user["email"]},
        {"_id": 0}
    ).sort("updated_at", -1))
    return {"bookmarks": bookmarks}

@app.delete("/api/bookmarks/{page_slug}")
async def delete_bookmark(page_slug: str, user: dict = Depends(get_current_user)):
    """Delete a bookmark"""
    result = db.bookmarks.delete_one({
        "user_email": user["email"],
        "page_slug": page_slug
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return {"message": "Bookmark deleted"}

# ==================== NOTES ENDPOINTS ====================

@app.post("/api/notes")
async def create_note(note_data: NoteCreate, user: dict = Depends(get_current_user)):
    """Create a new note for a page"""
    note_doc = {
        "user_email": user["email"],
        "page_slug": note_data.page_slug,
        "content": note_data.content,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    result = db.notes.insert_one(note_doc)
    note_doc["id"] = str(result.inserted_id)
    note_doc.pop("_id", None)
    
    return {"note": note_doc}

@app.get("/api/notes/{page_slug}")
async def get_notes_for_page(page_slug: str, user: dict = Depends(get_current_user)):
    """Get all notes for a specific page"""
    notes = list(db.notes.find(
        {"user_email": user["email"], "page_slug": page_slug}
    ).sort("created_at", -1))
    
    # Normalize local store ids for the API response
    for note in notes:
        note["id"] = str(note["_id"])
        del note["_id"]
    
    return {"notes": notes}

@app.get("/api/notes")
async def get_all_notes(user: dict = Depends(get_current_user)):
    """Get all notes for the current user"""
    notes = list(db.notes.find(
        {"user_email": user["email"]}
    ).sort("created_at", -1))
    
    for note in notes:
        note["id"] = str(note["_id"])
        del note["_id"]
    
    return {"notes": notes}

@app.put("/api/notes/{note_id}")
async def update_note(note_id: str, note_data: NoteUpdate, user: dict = Depends(get_current_user)):
    """Update a note"""
    result = db.notes.update_one(
        {"_id": note_id, "user_email": user["email"]},
        {"$set": {
            "content": note_data.content,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    
    updated_note = db.notes.find_one({"_id": note_id})
    updated_note["id"] = str(updated_note["_id"])
    del updated_note["_id"]
    
    return {"note": updated_note}

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str, user: dict = Depends(get_current_user)):
    """Delete a note"""
    result = db.notes.delete_one({
        "_id": note_id,
        "user_email": user["email"]
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}

@app.get("/api/notes/{page_slug}/export")
async def export_notes_with_content(page_slug: str, user: dict = Depends(get_current_user)):
    """Export notes with the page content for PDF generation"""
    # Get the page content
    page = db.wiki_pages.find_one({"slug": page_slug}, {"_id": 0})
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Get the user's notes for this page
    notes = list(db.notes.find(
        {"user_email": user["email"], "page_slug": page_slug}
    ).sort("created_at", -1))
    
    for note in notes:
        note["id"] = str(note["_id"])
        del note["_id"]
    
    return {
        "page": {
            "title": page["title"],
            "category": page["category"],
            "subcategory": page.get("subcategory"),
            "content_text": page["content_text"]
        },
        "notes": notes,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_name": user["name"]
    }

# ==================== FEEDBACK ENDPOINTS ====================

@app.post("/api/feedback")
async def create_feedback(data: FeedbackCreate, user: dict = Depends(get_current_user)):
    """Submit feedback on a wiki page"""
    doc = {
        "page_slug": data.page_slug,
        "comment": data.comment,
        "user_email": user["email"],
        "user_name": user.get("name", "Anonymous"),
        "user_role": user.get("role", "viewer"),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = db.feedback.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return {"feedback": doc}

@app.get("/api/feedback/{page_slug}")
async def get_feedback(page_slug: str, user: dict = Depends(get_current_user)):
    """Get all feedback for a wiki page"""
    items = list(db.feedback.find({"page_slug": page_slug}, {"_id": 0}).sort("created_at", -1).limit(50))
    return {"feedback": items}

@app.delete("/api/feedback/{page_slug}/{timestamp}")
async def delete_feedback(page_slug: str, timestamp: str, user: dict = Depends(get_current_user)):
    """Delete feedback — own feedback or admin can delete any"""
    query = {"page_slug": page_slug, "created_at": timestamp}
    item = db.feedback.find_one(query)
    if not item:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if item["user_email"] != user["email"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Cannot delete others' feedback")
    db.feedback.delete_one(query)
    return {"message": "Feedback deleted"}

# ==================== GRIEVANCE ENDPOINTS ====================

GRIEVANCE_CATEGORIES = [
    "Workplace Harassment",
    "Discrimination",
    "Compensation & Benefits",
    "Work Environment",
    "Management Issues",
    "Policy Violations",
    "Safety Concerns",
    "Other"
]

@app.get("/api/grievances/categories")
async def get_grievance_categories(user: dict = Depends(get_current_user)):
    """Get list of grievance categories"""
    return {"categories": GRIEVANCE_CATEGORIES}

@app.post("/api/grievances")
async def create_grievance(grievance_data: GrievanceCreate, user: dict = Depends(get_current_user)):
    """Submit a grievance (can be anonymous)"""
    if grievance_data.category not in GRIEVANCE_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid grievance category")
    
    grievance_doc = {
        "category": grievance_data.category,
        "description": grievance_data.description,
        "is_anonymous": grievance_data.is_anonymous,
        "submitted_by": None if grievance_data.is_anonymous else user["email"],
        "submitted_by_name": None if grievance_data.is_anonymous else user["name"],
        "status": "pending",
        "hr_notes": None,
        "addressed_by": None,
        "addressed_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = db.grievances.insert_one(grievance_doc)
    grievance_doc["id"] = str(result.inserted_id)
    grievance_doc.pop("_id", None)
    
    return {"grievance": grievance_doc, "message": "Grievance submitted successfully"}

@app.get("/api/grievances/my")
async def get_my_grievances(user: dict = Depends(get_current_user)):
    """Get grievances submitted by current user (non-anonymous only)"""
    grievances = list(db.grievances.find(
        {"submitted_by": user["email"]}
    ).sort("created_at", -1))
    
    for g in grievances:
        g["id"] = str(g["_id"])
        del g["_id"]
    
    return {"grievances": grievances}

@app.get("/api/grievances")
async def get_all_grievances(user: dict = Depends(get_current_user)):
    """Get all grievances - HR only"""
    if user["role"] not in ["admin", "hr"]:
        raise HTTPException(status_code=403, detail="Only HR can access grievance management")
    
    grievances = list(db.grievances.find({}).sort("created_at", -1))
    
    for g in grievances:
        g["id"] = str(g["_id"])
        del g["_id"]
    
    # Get stats
    total = len(grievances)
    pending = len([g for g in grievances if g["status"] == "pending"])
    in_review = len([g for g in grievances if g["status"] == "in_review"])
    addressed = len([g for g in grievances if g["status"] == "addressed"])
    
    return {
        "grievances": grievances,
        "stats": {
            "total": total,
            "pending": pending,
            "in_review": in_review,
            "addressed": addressed
        }
    }

@app.put("/api/grievances/{grievance_id}")
async def update_grievance(grievance_id: str, update_data: GrievanceUpdate, user: dict = Depends(get_current_user)):
    """Update grievance status - HR only"""
    if user["role"] not in ["admin", "hr"]:
        raise HTTPException(status_code=403, detail="Only HR can manage grievances")
    
    if update_data.status not in ["pending", "in_review", "addressed"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    update_doc = {
        "status": update_data.status,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    if update_data.hr_notes:
        update_doc["hr_notes"] = update_data.hr_notes
    
    if update_data.status == "addressed":
        update_doc["addressed_by"] = user["email"]
        update_doc["addressed_at"] = datetime.now(timezone.utc).isoformat()
    
    result = db.grievances.update_one(
        {"_id": grievance_id},
        {"$set": update_doc}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Grievance not found")
    
    updated = db.grievances.find_one({"_id": grievance_id})
    updated["id"] = str(updated["_id"])
    del updated["_id"]
    
    return {"grievance": updated}

@app.delete("/api/grievances/{grievance_id}")
async def delete_grievance(grievance_id: str, user: dict = Depends(get_current_user)):
    """Delete a grievance - Admin only"""
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admin can delete grievances")
    
    result = db.grievances.delete_one({"_id": grievance_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Grievance not found")
    
    return {"message": "Grievance deleted"}


# ==================== ACTIVITY TRACKING ====================

def log_activity(event_type: str, user_email: str = None, metadata: dict = None):
    """Log an activity event for analytics"""
    doc = {
        "event_type": event_type,
        "user_email": user_email,
        "metadata": metadata or {},
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    try:
        db.activity_logs.insert_one(doc)
    except Exception:
        pass  # non-blocking


# ==================== ANALYTICS ENDPOINTS ====================

def require_admin(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


@app.get("/api/analytics/overview")
async def analytics_overview(user: dict = Depends(get_current_user)):
    """Get dashboard overview stats"""
    require_admin(user)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_ago = (now - timedelta(days=7)).isoformat()

    total_views = db.activity_logs.count_documents({"event_type": "page_view"})
    today_views = db.activity_logs.count_documents({"event_type": "page_view", "timestamp": {"$gte": today_start}})
    week_views = db.activity_logs.count_documents({"event_type": "page_view", "timestamp": {"$gte": week_ago}})

    total_logins = db.activity_logs.count_documents({"event_type": "login"})
    today_logins = db.activity_logs.count_documents({"event_type": "login", "timestamp": {"$gte": today_start}})

    total_searches = db.activity_logs.count_documents({"event_type": "search"})
    today_searches = db.activity_logs.count_documents({"event_type": "search", "timestamp": {"$gte": today_start}})

    total_users = db.users.count_documents({})
    active_today_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "event_type": {"$in": ANALYTICS_ACTIVITY_TYPES}}},
        {"$group": {"_id": "$user_email"}},
        {"$count": "count"}
    ]
    active_today_result = list(db.activity_logs.aggregate(active_today_pipeline))
    active_today = active_today_result[0]["count"] if active_today_result else 0

    return {
        "page_views": {"total": total_views, "today": today_views, "week": week_views},
        "logins": {"total": total_logins, "today": today_logins},
        "searches": {"total": total_searches, "today": today_searches},
        "users": {"total": total_users, "active_today": active_today}
    }


@app.get("/api/analytics/page-views")
async def analytics_page_views(user: dict = Depends(get_current_user)):
    """Get most viewed pages"""
    require_admin(user)
    pipeline = [
        {"$match": {"event_type": "page_view"}},
        {"$group": {"_id": "$metadata.page_slug", "title": {"$last": "$metadata.page_title"}, "count": {"$sum": 1}, "last_viewed": {"$max": "$timestamp"}}},
        {"$sort": {"count": -1}},
        {"$limit": 15}
    ]
    pages = list(db.activity_logs.aggregate(pipeline))
    return {"pages": [{"slug": p["_id"], "title": p.get("title", p["_id"]), "views": p["count"], "last_viewed": p.get("last_viewed")} for p in pages if p["_id"]]}


@app.get("/api/analytics/user-activity")
async def analytics_user_activity(user: dict = Depends(get_current_user)):
    """Get per-user activity summary"""
    require_admin(user)
    pipeline = [
        {"$match": {"user_email": {"$ne": None}, "event_type": {"$in": ANALYTICS_ACTIVITY_TYPES}}},
        {"$group": {
            "_id": "$user_email",
            "total_actions": {"$sum": 1},
            "page_views": {"$sum": {"$cond": [{"$eq": ["$event_type", "page_view"]}, 1, 0]}},
            "searches": {"$sum": {"$cond": [{"$eq": ["$event_type", "search"]}, 1, 0]}},
            "logins": {"$sum": {"$cond": [{"$eq": ["$event_type", "login"]}, 1, 0]}},
            "last_active": {"$max": "$timestamp"}
        }},
        {"$sort": {"total_actions": -1}},
        {"$limit": 20}
    ]
    users = list(db.activity_logs.aggregate(pipeline))
    # Enrich with user names
    result = []
    for u in users:
        user_doc = db.users.find_one({"email": u["_id"]}, {"_id": 0, "name": 1, "role": 1})
        result.append({
            "email": u["_id"],
            "name": user_doc["name"] if user_doc else u["_id"],
            "role": user_doc.get("role", "unknown") if user_doc else "unknown",
            "total_actions": u["total_actions"],
            "page_views": u["page_views"],
            "searches": u["searches"],
            "logins": u["logins"],
            "last_active": u["last_active"]
        })
    return {"users": result}


@app.get("/api/analytics/hourly")
async def analytics_hourly(user: dict = Depends(get_current_user)):
    """Get activity by hour of day (last 7 days)"""
    require_admin(user)
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    logs = list(db.activity_logs.find(
        {"timestamp": {"$gte": week_ago}, "event_type": {"$in": ANALYTICS_ACTIVITY_TYPES}},
        {"_id": 0, "timestamp": 1, "event_type": 1},
    ))

    hours = {h: {"page_view": 0, "login": 0, "search": 0} for h in range(24)}
    for log in logs:
        try:
            ts = datetime.fromisoformat(log["timestamp"].replace("Z", "+00:00"))
            h = ts.hour
            et = log["event_type"]
            if et in hours[h]:
                hours[h][et] += 1
        except Exception:
            pass

    return {"hours": [{"hour": hour, **counts} for hour, counts in hours.items()]}


@app.get("/api/analytics/search-queries")
async def analytics_search_queries(user: dict = Depends(get_current_user)):
    """Get top search queries"""
    require_admin(user)
    pipeline = [
        {"$match": {"event_type": "search"}},
        {"$group": {"_id": "$metadata.query", "count": {"$sum": 1}, "last_searched": {"$max": "$timestamp"}}},
        {"$sort": {"count": -1}},
        {"$limit": 15}
    ]
    queries = list(db.activity_logs.aggregate(pipeline))
    return {"queries": [{"query": q["_id"], "count": q["count"], "last_searched": q.get("last_searched")} for q in queries if q["_id"]]}


@app.get("/api/analytics/recent")
async def analytics_recent(user: dict = Depends(get_current_user)):
    """Get recent activity feed"""
    require_admin(user)
    logs = list(db.activity_logs.find(
        {"user_email": {"$ne": None}, "event_type": {"$in": ANALYTICS_ACTIVITY_TYPES}},
        {"_id": 0}
    ).sort("timestamp", -1).limit(30))
    # Enrich with names
    email_cache = {}
    for log in logs:
        email = log.get("user_email")
        if email and email not in email_cache:
            u = db.users.find_one({"email": email}, {"_id": 0, "name": 1})
            email_cache[email] = u["name"] if u else email
        log["user_name"] = email_cache.get(email, email)
    return {"events": logs}


@app.post("/api/activity/track-duration")
async def track_duration(request: Request, user: dict = Depends(get_current_user)):
    """Track time spent on a page"""
    data = await request.json()
    page_slug = data.get("page_slug", "")
    page_title = data.get("page_title", "")
    duration_seconds = data.get("duration_seconds", 0)
    if page_slug and duration_seconds > 0:
        log_activity("page_duration", user.get("email"), {
            "page_slug": page_slug,
            "page_title": page_title,
            "duration_seconds": round(duration_seconds)
        })
    return {"status": "ok"}


@app.get("/api/analytics/detail/{event_type}")
async def analytics_detail(event_type: str, user: dict = Depends(get_current_user)):
    """Get detailed breakdown for a specific event type with who engaged"""
    require_admin(user)
    valid_types = ["page_view", "login", "search"]
    if event_type not in valid_types:
        raise HTTPException(status_code=400, detail="Invalid event type")

    logs = list(db.activity_logs.find(
        {"event_type": event_type},
        {"_id": 0}
    ).sort("timestamp", -1).limit(100))

    email_cache = {}
    for log in logs:
        email = log.get("user_email")
        if email and email not in email_cache:
            u = db.users.find_one({"email": email}, {"_id": 0, "name": 1, "role": 1})
            email_cache[email] = {"name": u["name"] if u else email, "role": u.get("role", "unknown") if u else "unknown"}
        info = email_cache.get(email, {"name": email, "role": "unknown"})
        log["user_name"] = info["name"]
        log["user_role"] = info["role"]

    # Also compute per-page time spent if this is page_view
    time_data = []
    if event_type == "page_view":
        pipeline = [
            {"$match": {"event_type": "page_duration"}},
            {"$group": {
                "_id": "$metadata.page_slug",
                "title": {"$last": "$metadata.page_title"},
                "total_seconds": {"$sum": "$metadata.duration_seconds"},
                "view_count": {"$sum": 1},
                "avg_seconds": {"$avg": "$metadata.duration_seconds"}
            }},
            {"$sort": {"total_seconds": -1}},
            {"$limit": 20}
        ]
        time_data = [
            {"slug": t["_id"], "title": t.get("title", t["_id"]),
             "total_seconds": round(t["total_seconds"]),
             "avg_seconds": round(t["avg_seconds"]),
             "sessions": t["view_count"]}
            for t in db.activity_logs.aggregate(pipeline) if t["_id"]
        ]

    return {"events": logs, "time_spent": time_data}


@app.get("/api/analytics/user-detail/{email}")
async def analytics_user_detail(email: str, user: dict = Depends(get_current_user)):
    """Get full activity detail for a specific user"""
    require_admin(user)
    user_doc = db.users.find_one({"email": email}, {"_id": 0, "name": 1, "role": 1})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    # All events
    events = list(db.activity_logs.find(
        {"user_email": email, "event_type": {"$in": ANALYTICS_ACTIVITY_TYPES}},
        {"_id": 0}
    ).sort("timestamp", -1).limit(100))

    # Pages viewed with time spent
    page_time_pipeline = [
        {"$match": {"event_type": "page_duration", "user_email": email}},
        {"$group": {
            "_id": "$metadata.page_slug",
            "title": {"$last": "$metadata.page_title"},
            "total_seconds": {"$sum": "$metadata.duration_seconds"},
            "visits": {"$sum": 1},
            "avg_seconds": {"$avg": "$metadata.duration_seconds"}
        }},
        {"$sort": {"total_seconds": -1}}
    ]
    page_times = [
        {"slug": p["_id"], "title": p.get("title", p["_id"]),
         "total_seconds": round(p["total_seconds"]),
         "avg_seconds": round(p["avg_seconds"]),
         "visits": p["visits"]}
        for p in db.activity_logs.aggregate(page_time_pipeline) if p["_id"]
    ]

    # Total time spent
    total_pipeline = [
        {"$match": {"event_type": "page_duration", "user_email": email}},
        {"$group": {"_id": None, "total": {"$sum": "$metadata.duration_seconds"}}}
    ]
    total_result = list(db.activity_logs.aggregate(total_pipeline))
    total_time = round(total_result[0]["total"]) if total_result else 0

    return {
        "user": {"email": email, "name": user_doc["name"], "role": user_doc.get("role", "unknown")},
        "events": events,
        "page_times": page_times,
        "total_time_seconds": total_time
    }


# ==================== BIRTHDAY ENDPOINTS ====================
# All birthday operations run on Asia/Kolkata timezone.
# Notifications are emitted from 11:00 AM IST onwards on the birthday date.

NOTIFICATION_HOUR_IST = 11
DEFAULT_BIRTHDAY_SETTINGS = {
    "_id": "global",
    "enabled": True,
    "upcoming_window_days": 7,
}

FUN_TAGLINES = [
    "Powered by coffee & deadlines ☕",
    "Turning ideas into pixels since day one ✨",
    "Built different. Ships harder. 🚢",
    "Probably debugging right now 🐛",
    "Cake before code today 🎂",
    "The reason our standups are fun 🎤",
    "Bug whisperer & feature wizard 🪄",
    "Caffeine-fueled, deadline-defiant ⚡",
    "Making Mondays slightly less Monday 💜",
    "Plot twist: today's the main character 🌟",
]


def _ist_now():
    return datetime.now(IST)


def _get_birthday_settings():
    s = db.birthday_settings.find_one({"_id": "global"}, {"_id": 0})
    if not s:
        db.birthday_settings.insert_one(dict(DEFAULT_BIRTHDAY_SETTINGS))
        return {k: v for k, v in DEFAULT_BIRTHDAY_SETTINGS.items() if k != "_id"}
    return s


def _parse_dob(dob_str: str):
    """Parse YYYY-MM-DD safely. Return (month, day) or None."""
    if not dob_str or not isinstance(dob_str, str):
        return None
    try:
        parts = dob_str.split("-")
        if len(parts) != 3:
            return None
        return int(parts[1]), int(parts[2])
    except (ValueError, TypeError):
        return None


def _tagline_for(key: str) -> str:
    # Stable per-employee tagline (deterministic by key hash)
    return FUN_TAGLINES[hash(key) % len(FUN_TAGLINES)]


ROSTER_EMAIL_SUFFIX = "@roster.local"
DEMO_BIRTHDAY_USER_EMAILS = {
    "admin@ethara.ai",
    "hr@ethara.ai",
    "leadership@ethara.ai",
    "testuser@example.com",
    LOCAL_ACCESS_USER["email"],
}


def _roster_id_for(doc: dict) -> str:
    """Synthetic stable id used as `email` field for roster-sourced birthdays.
    Allows the existing wish/notification flow to work unchanged."""
    ecode = doc.get("ecode") or doc.get("email") or "unknown"
    if "@" in ecode:
        return ecode  # already a real email (login user)
    return f"{ecode}{ROSTER_EMAIL_SUFFIX}"


def _is_birthday_eligible_login_user(user_doc: dict) -> bool:
    """Only HRMS-backed login users should supplement the employee roster.
    Seeded/bootstrap wiki accounts are operational users, not employee birthdays."""
    email = (user_doc.get("email") or "").strip().lower()
    if email in DEMO_BIRTHDAY_USER_EMAILS:
        return False
    return bool(
        user_doc.get("profile_source") == "hrms"
        or user_doc.get("hrms_user_id")
        or user_doc.get("hrms_profile_id")
        or user_doc.get("ethara_email")
    )


def _build_birthday_user(u: dict, today_md=None, wish_count: int = 0):
    """Normalize either a roster doc or a user doc into the spotlight shape."""
    md = _parse_dob(u.get("dob"))
    is_roster = "ecode" in u
    rid = _roster_id_for(u)
    name = u.get("name") or rid
    return {
        "email": rid,  # synthetic for roster entries — used as stable id only
        "ecode": u.get("ecode"),
        "name": name,
        "role": u.get("role", "employee"),
        "department": u.get("department") or ("People Operations" if is_roster else u.get("role", "Team").capitalize()),
        "company_id": u.get("company_id") or u.get("ecode"),
        "company_doj": u.get("company_doj"),
        "tagline": _tagline_for(rid),
        "month": md[0] if md else None,
        "day": md[1] if md else None,
        "is_today": (md == today_md) if (md and today_md) else False,
        "profile_picture": u.get("profile_picture"),
        "wish_count": wish_count,
        "is_roster": is_roster,
    }


def _roster_source():
    """Yield birthday-eligible employee docs from the canonical roster + any
    login-users with their own dob set (deduped by ecode/email)."""
    seen_keys = set()
    # Primary: company roster
    for doc in db.employee_roster.find(
        {"dob": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0}
    ):
        seen_keys.add(_roster_id_for(doc))
        yield doc
    # Secondary: login-users with dob set who aren't already in roster
    for u in db.users.find(
        {"dob": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "password_hash": 0}
    ):
        if not _is_birthday_eligible_login_user(u):
            continue
        if u.get("email") in seen_keys:
            continue
        yield u


def _today_birthdays(today_ist=None):
    today_ist = today_ist or _ist_now()
    today_md = (today_ist.month, today_ist.day)
    date_key = today_ist.strftime("%Y-%m-%d")
    matches = []
    for doc in _roster_source():
        md = _parse_dob(doc.get("dob"))
        if md == today_md:
            rid = _roster_id_for(doc)
            wc = db.birthday_wishes.count_documents({"recipient_email": rid, "date_key": date_key})
            matches.append(_build_birthday_user(doc, today_md, wc))
    return matches


def _upcoming_birthdays(days: int = 7, today_ist=None):
    today_ist = today_ist or _ist_now()
    upcoming = []
    for doc in _roster_source():
        md = _parse_dob(doc.get("dob"))
        if not md:
            continue
        # Find next occurrence
        try:
            this_year = today_ist.replace(month=md[0], day=md[1], hour=0, minute=0, second=0, microsecond=0)
        except ValueError:
            # Feb 29 handling - fall back to Feb 28
            this_year = today_ist.replace(month=md[0], day=28, hour=0, minute=0, second=0, microsecond=0)
        if this_year.date() < today_ist.date():
            try:
                next_occ = this_year.replace(year=this_year.year + 1)
            except ValueError:
                next_occ = this_year.replace(year=this_year.year + 1, day=28)
        else:
            next_occ = this_year
        delta_days = (next_occ.date() - today_ist.date()).days
        if 0 < delta_days <= days:
            entry = _build_birthday_user(doc, (today_ist.month, today_ist.day))
            entry["days_until"] = delta_days
            entry["next_date"] = next_occ.strftime("%Y-%m-%d")
            upcoming.append(entry)
    upcoming.sort(key=lambda x: x["days_until"])
    return upcoming


def _birthday_recipient_ids_for_user(user_doc: dict) -> set[str]:
    """Return every birthday identifier that can represent the signed-in user."""
    ids: set[str] = set()

    def add_email(value: Optional[str]) -> None:
        text = (value or "").strip().lower()
        if text:
            ids.add(text)

    add_email(user_doc.get("email"))
    add_email(user_doc.get("ethara_email"))
    add_email(user_doc.get("personal_email"))

    company_id = (user_doc.get("company_id") or "").strip()
    if company_id:
        ids.add(company_id if "@" in company_id else f"{company_id}{ROSTER_EMAIL_SUFFIX}")

    names = {(user_doc.get("name") or "").strip().lower()}
    names.discard("")
    email_ids = {item for item in ids if "@" in item and not item.endswith(ROSTER_EMAIL_SUFFIX)}
    code_ids = {
        item[: -len(ROSTER_EMAIL_SUFFIX)].lower()
        for item in ids
        if item.endswith(ROSTER_EMAIL_SUFFIX)
    }

    for doc in db.employee_roster.find({}, {"_id": 0}):
        roster_id = _roster_id_for(doc)
        roster_id_lower = roster_id.lower()
        roster_code = str(doc.get("ecode") or doc.get("company_id") or "").strip().lower()
        roster_emails = {
            str(doc.get(field) or "").strip().lower()
            for field in ("email", "ethara_email", "personal_email")
            if doc.get(field)
        }
        roster_name = str(doc.get("name") or "").strip().lower()
        if (
            roster_id_lower in ids
            or (roster_code and roster_code in code_ids)
            or bool(roster_emails & email_ids)
            or (roster_name and roster_name in names)
        ):
            ids.add(roster_id)
            ids.add(roster_id_lower)

    return ids


@app.get("/api/birthdays/settings")
async def get_birthday_settings(user: dict = Depends(get_current_user)):
    """Get current birthday feature settings (any authenticated user can read)."""
    settings = _get_birthday_settings()
    return {"settings": settings}


@app.put("/api/birthdays/settings")
async def update_birthday_settings(data: BirthdaySettingsUpdate, user: dict = Depends(get_current_user)):
    """Update birthday feature settings - admin / hr only."""
    if user.get("role") not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Only admins or HR can update birthday settings")
    update = {k: v for k, v in data.dict().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields provided to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    update["updated_by"] = user["email"]
    db.birthday_settings.update_one({"_id": "global"}, {"$set": update}, upsert=True)
    log_activity("birthday_settings_updated", user["email"], {"fields": list(update.keys())})
    return {"settings": _get_birthday_settings(), "message": "Settings updated"}


@app.get("/api/birthdays/today")
async def birthdays_today(user: dict = Depends(get_current_user)):
    """Return all employees whose birthday is today (IST)."""
    settings = _get_birthday_settings()
    if not settings.get("enabled", True):
        return {"birthdays": [], "enabled": False, "ist_time": _ist_now().strftime("%Y-%m-%d %H:%M")}
    today_ist = _ist_now()
    return {
        "birthdays": _today_birthdays(today_ist),
        "enabled": True,
        "ist_time": today_ist.strftime("%Y-%m-%d %H:%M"),
        "notification_active": today_ist.hour >= NOTIFICATION_HOUR_IST,
    }


@app.get("/api/birthdays/upcoming")
async def birthdays_upcoming(days: int = 7, user: dict = Depends(get_current_user)):
    """Return upcoming birthdays in the next `days` days (IST)."""
    settings = _get_birthday_settings()
    if not settings.get("enabled", True):
        return {"upcoming": [], "enabled": False}
    window = min(max(days, 1), 30)
    return {"upcoming": _upcoming_birthdays(window), "enabled": True}


@app.post("/api/birthdays/wish")
async def post_birthday_wish(data: BirthdayWishCreate, user: dict = Depends(get_current_user)):
    """Post a birthday wish to a colleague (must be a birthday person today).
    Recipient can be either a real user email or a synthetic roster id
    (<ecode>@roster.local)."""
    settings = _get_birthday_settings()
    if not settings.get("enabled", True):
        raise HTTPException(status_code=403, detail="Birthday feature is disabled")
    if data.recipient_email == user["email"]:
        raise HTTPException(status_code=400, detail="You can't wish yourself — but enjoy your day! 🎉")

    # Look up recipient in roster or users
    recipient = None
    if data.recipient_email.endswith(ROSTER_EMAIL_SUFFIX):
        ecode = data.recipient_email[: -len(ROSTER_EMAIL_SUFFIX)]
        recipient = db.employee_roster.find_one({"ecode": ecode}, {"_id": 0})
    if not recipient:
        recipient = db.users.find_one({"email": data.recipient_email}, {"_id": 0, "password_hash": 0})
    if not recipient:
        raise HTTPException(status_code=404, detail="Employee not found")

    today_ist = _ist_now()
    md = _parse_dob(recipient.get("dob"))
    if md != (today_ist.month, today_ist.day):
        raise HTTPException(status_code=400, detail="It's not their birthday today — save the wish! 😉")
    date_key = today_ist.strftime("%Y-%m-%d")
    # Prevent duplicate wish per sender per day
    existing = db.birthday_wishes.find_one({
        "recipient_email": data.recipient_email,
        "sender_email": user["email"],
        "date_key": date_key
    })
    if existing:
        raise HTTPException(status_code=400, detail="You already sent a wish today — they got it! 💜")
    wish = {
        "id": uuid4().hex,
        "recipient_email": data.recipient_email,
        "recipient_name": recipient.get("name"),
        "sender_email": user["email"],
        "sender_name": user.get("name", user["email"]),
        "message": data.message.strip(),
        "date_key": date_key,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.birthday_wishes.insert_one(dict(wish))
    log_activity("birthday_wish_sent", user["email"], {"recipient": data.recipient_email})
    return {"wish": {k: v for k, v in wish.items() if k != "_id"}, "message": "Wish sent! 🎉"}


@app.get("/api/birthdays/wishes/{email}")
async def get_birthday_wishes(email: str, user: dict = Depends(get_current_user)):
    """Get all today's wishes for a specific recipient."""
    date_key = _ist_now().strftime("%Y-%m-%d")
    wishes = list(db.birthday_wishes.find(
        {"recipient_email": email, "date_key": date_key},
        {"_id": 0}
    ).sort("created_at", -1).limit(100))
    return {"wishes": wishes, "count": len(wishes)}


@app.put("/api/users/{email}/dob")
async def update_user_dob(email: str, data: UserDOBUpdate, user: dict = Depends(get_current_user)):
    """Admin/HR can set/edit a user's date of birth."""
    if user.get("role") not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Only admins or HR can edit employee birthdays")
    md = _parse_dob(data.dob)
    if not md or not (1 <= md[0] <= 12 and 1 <= md[1] <= 31):
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    result = db.users.update_one({"email": email}, {"$set": {"dob": data.dob}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    log_activity("user_dob_updated", user["email"], {"target": email})
    return {"message": "Date of birth updated"}


@app.get("/api/birthdays/roster/stats")
async def roster_stats(user: dict = Depends(get_current_user)):
    """Roster summary stats - HR/Admin only."""
    if user.get("role") not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Only admins or HR can view roster stats")
    total = db.employee_roster.count_documents({})
    with_dob = db.employee_roster.count_documents({"dob": {"$exists": True, "$nin": [None, ""]}})
    # birthdays per month (for sparkline)
    pipeline = [
        {"$match": {"dob": {"$exists": True, "$nin": [None, ""]}}},
        {"$project": {"month": {"$substr": ["$dob", 5, 2]}}},
        {"$group": {"_id": "$month", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    months = list(db.employee_roster.aggregate(pipeline))
    by_month = [{"month": m["_id"], "count": m["count"]} for m in months]
    return {"total": total, "with_dob": with_dob, "by_month": by_month}


@app.get("/api/birthdays/roster")
async def list_roster(search: Optional[str] = None, limit: int = 100, user: dict = Depends(get_current_user)):
    """Paginated list of roster entries - HR/Admin only."""
    if user.get("role") not in ("admin", "hr"):
        raise HTTPException(status_code=403, detail="Only admins or HR can view roster")
    q = {}
    if search:
        q = {"$or": [
            {"name": {"$regex": search, "$options": "i"}},
            {"ecode": {"$regex": search, "$options": "i"}},
        ]}
    limit = min(max(limit, 1), 500)
    docs = list(db.employee_roster.find(q, {"_id": 0}).sort("name", 1).limit(limit))
    return {"employees": docs, "count": len(docs)}


@app.get("/api/notifications")
async def get_notifications(user: dict = Depends(get_current_user)):
    """Return active notifications for the current user (birthday-based)."""
    settings = _get_birthday_settings()
    notifications = []
    if not settings.get("enabled", True):
        return {"notifications": [], "unread_count": 0}

    today_ist = _ist_now()
    if today_ist.hour < NOTIFICATION_HOUR_IST:
        return {"notifications": [], "unread_count": 0, "next_at": f"{NOTIFICATION_HOUR_IST}:00 IST"}

    date_key = today_ist.strftime("%Y-%m-%d")
    todays = _today_birthdays(today_ist)
    dismissed = set(
        d["notif_key"]
        for d in db.dismissed_notifications.find(
            {"user_email": user["email"]}, {"_id": 0, "notif_key": 1}
        )
    )
    # Also detect "self" celebration when the current user's name matches
    # a roster entry today (since roster ids are synthetic emails).
    user_name_lower = (user.get("name") or "").strip().lower()

    for b in todays:
        is_self = (
            b["email"] == user["email"]
            or (user_name_lower and user_name_lower == (b.get("name") or "").strip().lower())
        )
        if is_self:
            # Self-celebration notification
            notif_key = f"birthday-self-{date_key}"
            if notif_key in dismissed:
                continue
            notifications.append({
                "id": notif_key,
                "type": "birthday_self",
                "title": "🎂 Happy Birthday from all of us!",
                "body": f"Wishing you an amazing year ahead, {b['name'].split(' ')[0]}! 🎉",
                "recipient": b,
                "created_at": today_ist.isoformat(),
            })
        else:
            notif_key = f"birthday-{date_key}-{b['email']}"
            if notif_key in dismissed:
                continue
            first_name = b["name"].split(" ")[0]
            notifications.append({
                "id": notif_key,
                "type": "birthday",
                "title": f"🎉 Today's star is {first_name}!",
                "body": f"It's {b['name']}'s birthday — drop a wish and make their day special! 🎂",
                "recipient": b,
                "created_at": today_ist.isoformat(),
            })

    recipient_ids = _birthday_recipient_ids_for_user(user)
    if recipient_ids:
        wishes = db.birthday_wishes.find(
            {"recipient_email": {"$in": list(recipient_ids)}, "date_key": date_key},
            {"_id": 0},
        ).sort("created_at", -1).limit(50)
        for wish in wishes:
            wish_id = wish.get("id") or f"{wish.get('sender_email')}-{date_key}"
            notif_key = f"birthday-wish-{wish_id}"
            if notif_key in dismissed:
                continue
            sender_name = wish.get("sender_name") or wish.get("sender_email") or "A teammate"
            notifications.append({
                "id": notif_key,
                "type": "birthday_wish",
                "title": f"{sender_name} sent you birthday wishes",
                "body": wish.get("message", ""),
                "sender": {
                    "email": wish.get("sender_email"),
                    "name": sender_name,
                },
                "created_at": wish.get("created_at") or today_ist.isoformat(),
            })
    return {
        "notifications": notifications,
        "unread_count": len(notifications),
        "ist_time": today_ist.strftime("%Y-%m-%d %H:%M"),
    }


@app.post("/api/notifications/{notif_id}/dismiss")
async def dismiss_notification(notif_id: str, user: dict = Depends(get_current_user)):
    """Dismiss a notification for the current user."""
    db.dismissed_notifications.update_one(
        {"user_email": user["email"], "notif_key": notif_id},
        {"$set": {"dismissed_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"message": "Dismissed"}


@app.get("/", include_in_schema=False)
async def serve_frontend_root():
    index_path = FRONTEND_BUILD_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    raise HTTPException(status_code=404, detail="Frontend build not found")


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend_app(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    requested_path = (FRONTEND_BUILD_DIR / full_path).resolve()
    if requested_path.is_file() and requested_path.is_relative_to(FRONTEND_BUILD_DIR.resolve()):
        return FileResponse(requested_path)

    index_path = FRONTEND_BUILD_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    raise HTTPException(status_code=404, detail="Frontend build not found")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8001)
