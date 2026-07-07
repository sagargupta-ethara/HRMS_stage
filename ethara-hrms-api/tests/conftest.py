from collections.abc import Generator
from datetime import UTC, datetime
from io import BytesIO
import os

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@db.example.invalid:5432/ethara_hrms_test")

import pytest
from fastapi.testclient import TestClient
from limits.storage import MemoryStorage
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.limiter import limiter
from app.core.security import hash_password
from app.db.base import Base
from app.db.models import EmployeeProfile, Position, Role, User, Vendor
from app.main import app


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(engine)

    with TestingSessionLocal() as session:
        now = datetime.now(UTC)
        vendor = Vendor(
            id="ven-demo",
            name="Vendor Demo",
            contact_email="vendor-demo@example.com",
            contact_phone="9876500000",
            is_active=True,
        )
        session.add(vendor)
        session.add(
            User(
                id="usr-admin",
                email="admin@ethara.ai",
                password_hash=hash_password("admin123"),
                name="Admin User",
                role=Role.ADMIN,
                is_active=True,
                email_verified_at=now,
            )
        )
        session.add_all(
            [
                User(
                    id="usr-hr",
                    email="hr@ethara.ai",
                    password_hash=hash_password("hr123"),
                    name="HR User",
                    role=Role.HR,
                    is_active=True,
                    email_verified_at=now,
                ),
                User(
                    id="usr-vendor",
                    email="vendor@ethara.ai",
                    password_hash=hash_password("vendor123"),
                    name="Vendor User",
                    role=Role.VENDOR,
                    vendor_id=vendor.id,
                    is_active=True,
                    email_verified_at=now,
                ),
                User(
                    id="usr-referrer",
                    email="referrer@ethara.ai",
                    password_hash=hash_password("referrer123"),
                    name="Referrer User",
                    role=Role.EMPLOYEE_REFERRER,
                    is_active=True,
                    email_verified_at=now,
                ),
                User(
                    id="usr-evaluator",
                    email="evaluator@ethara.ai",
                    password_hash=hash_password("evaluator123"),
                    name="Evaluator User",
                    role=Role.EVALUATOR,
                    is_active=True,
                    email_verified_at=now,
                ),
                User(
                    id="usr-it",
                    email="it@ethara.ai",
                    password_hash=hash_password("it123"),
                    name="IT User",
                    role=Role.IT_TEAM,
                    is_active=True,
                    email_verified_at=now,
                ),
                User(
                    id="usr-compliance",
                    email="compliance@ethara.ai",
                    password_hash=hash_password("compliance123"),
                    name="Compliance User",
                    role=Role.COMPLIANCE,
                    is_active=True,
                    email_verified_at=now,
                ),
                User(
                    id="usr-employee",
                    email="employee@ethara.ai",
                    password_hash=hash_password("employee123"),
                    name="Employee User",
                    role=Role.EMPLOYEE,
                    is_active=True,
                    email_verified_at=now,
                    phone="9876543212",
                ),
            ]
        )
        session.add(
            EmployeeProfile(
                id="emp-001",
                user_id="usr-employee",
                full_name="Employee User",
                ethara_email="employee@ethara.ai",
                personal_email="employee.personal@example.com",
                employee_code="EMP-001",
                phone="9876543212",
                department="Engineering",
                designation="Software Engineer",
                gender="prefer_not_to_say",
                aadhaar_last4="1234",
                aadhaar_ocr_status="extracted",
            )
        )
        session.add(
            Position(
                id="pos-fe",
                title="Senior Frontend Developer",
                slug="senior-frontend-developer",
                department="Engineering",
                urgency_level=5,
                is_active=True,
                approval_status="posted",
                posted_at=now,
                approval_decided_at=now,
            )
        )
        session.add(
            Position(
                id="pos-be",
                title="Backend Engineer",
                slug="backend-engineer",
                department="Engineering",
                urgency_level=4,
                is_active=True,
                approval_status="posted",
                posted_at=now,
                approval_decided_at=now,
            )
        )
        session.commit()
        yield session

    Base.metadata.drop_all(engine)


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def reset_rate_limiter() -> Generator[None, None, None]:
    original_storage = limiter._storage
    original_runtime_storage = limiter.limiter.storage
    try:
        limiter._storage.reset()
    except RedisConnectionError:
        memory_storage = MemoryStorage()
        limiter._storage = memory_storage
        limiter.limiter.storage = memory_storage
        memory_storage.reset()
    try:
        yield
    finally:
        limiter._storage.reset()
        limiter._storage = original_storage
        limiter.limiter.storage = original_runtime_storage


@pytest.fixture()
def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": "admin@ethara.ai", "password": "admin123"})
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def pdf_file() -> tuple[str, BytesIO, str]:
    return ("resume.pdf", BytesIO(b"%PDF-1.4 test pdf"), "application/pdf")
