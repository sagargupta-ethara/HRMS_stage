from __future__ import annotations

import os
import secrets as _secrets
from io import BytesIO
from datetime import UTC, datetime

from sqlalchemy import delete, select, update

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.db.models import (
    AuditLog,
    Candidate,
    CandidateAssessment,
    CandidateStage,
    College,
    ComplianceForm,
    Contract,
    DocumensoContractField,
    DocumensoSignedProfile,
    DocumensoSyncLog,
    Document,
    EmployeeDocument,
    EmployeeProfile,
    Escalation,
    Evaluation,
    ITRequest,
    Notification,
    PiInterviewRound,
    Position,
    Role,
    SelectionForm,
    SourceType,
    StageLog,
    User,
    Vendor,
)


def upsert(session, model, pk: str, values: dict):
    row = session.get(model, pk)
    if row is None:
        row = model(id=pk, **values)
        session.add(row)
    else:
        for field, value in values.items():
            setattr(row, field, value)
        session.add(row)
    session.flush()
    return row


def _seed_password(env_key: str) -> str:
    """Resolve a seed account's password WITHOUT committing any credential.

    Read from the named environment variable; if unset, a strong random password
    is generated (operators then recover access via the password-reset flow). No
    password literal lives in the codebase or its future git history.
    """
    value = os.environ.get(env_key)
    return value if value else _secrets.token_urlsafe(18)


def upsert_user(session, pk: str, values: dict):
    """Like upsert() for the User model, but NEVER changes an existing user's
    ``password_hash``/``must_change_password``. Passwords are set only when the
    account is first created, so re-running the seed can never alter a live
    account's credentials."""
    row = session.get(User, pk)
    if row is None:
        row = User(id=pk, **values)
        session.add(row)
    else:
        for field, value in values.items():
            if field in ("password_hash", "must_change_password"):
                continue
            setattr(row, field, value)
        session.add(row)
    session.flush()
    return row


def _build_demo_pdf_bytes() -> bytes:
    from pypdf import PdfWriter

    buffer = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.write(buffer)
    return buffer.getvalue()


def _build_demo_png_bytes(color: tuple[int, int, int]) -> bytes:
    from PIL import Image

    buffer = BytesIO()
    image = Image.new("RGB", (1200, 800), color)
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _seed_upload(relative_path: str, content: bytes) -> str:
    settings = get_settings()
    target = settings.local_storage_path / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return f"/uploads/{relative_path}"


def main() -> None:
    now = datetime.now(UTC)
    demo_candidate_id = "cand-selform-demo"
    with SessionLocal() as session:
        # Reset any activity created while exploring the demo candidate so we
        # can deterministically restore the account back to Selection Form
        # stage on every seed run.
        session.execute(delete(AuditLog).where(AuditLog.candidate_id == demo_candidate_id))
        session.execute(delete(CandidateAssessment).where(CandidateAssessment.candidate_id == demo_candidate_id))
        session.execute(delete(ComplianceForm).where(ComplianceForm.candidate_id == demo_candidate_id))
        session.execute(delete(DocumensoContractField).where(DocumensoContractField.candidate_id == demo_candidate_id))
        session.execute(delete(DocumensoSignedProfile).where(DocumensoSignedProfile.candidate_id == demo_candidate_id))
        session.execute(delete(DocumensoSyncLog).where(DocumensoSyncLog.candidate_id == demo_candidate_id))
        session.execute(delete(Document).where(Document.candidate_id == demo_candidate_id))
        session.execute(delete(Escalation).where(Escalation.candidate_id == demo_candidate_id))
        session.execute(delete(PiInterviewRound).where(PiInterviewRound.candidate_id == demo_candidate_id))
        session.execute(delete(Evaluation).where(Evaluation.candidate_id == demo_candidate_id))
        session.execute(delete(ITRequest).where(ITRequest.candidate_id == demo_candidate_id))
        session.execute(delete(Notification).where(Notification.candidate_id == demo_candidate_id))
        session.execute(delete(Notification).where(Notification.id == "notif-demo"))
        session.execute(delete(SelectionForm).where(SelectionForm.candidate_id == demo_candidate_id))
        session.execute(delete(StageLog).where(StageLog.candidate_id == demo_candidate_id))
        session.execute(delete(Contract).where(Contract.candidate_id == demo_candidate_id))
        talentbridge_vendor_ids = select(Vendor.id).where(Vendor.name == "TalentBridge Solutions")
        session.execute(update(Candidate).where(Candidate.vendor_id.in_(talentbridge_vendor_ids)).values(vendor_id=None))
        session.execute(delete(User).where(User.vendor_id.in_(talentbridge_vendor_ids)))
        session.execute(update(Candidate).where(Candidate.vendor_id == "ven-tb").values(vendor_id=None))
        session.execute(delete(User).where(User.vendor_id == "ven-tb"))
        session.execute(delete(User).where(User.id == "usr-vendor"))
        session.execute(delete(User).where(User.email == "vendor@ethara.ai"))
        session.execute(delete(Vendor).where(Vendor.id == "ven-tb"))
        session.execute(delete(Vendor).where(Vendor.name == "TalentBridge Solutions"))

        positions = [
            upsert(
                session,
                Position,
                "pos-fe",
                {
                    "title": "Senior Frontend Developer",
                    "slug": "senior-frontend-developer",
                    "department": "Engineering",
                    "summary": "Build polished candidate and employer experiences across Ethara's hiring products.",
                    "location": "Bengaluru, India",
                    "employment_type": "Full-time",
                    "work_mode": "Hybrid",
                    "experience_level": "4-7 years",
                    "responsibilities": [
                        "Own major UI surfaces for candidate onboarding and recruiter workflows.",
                        "Collaborate closely with product, design, and backend teams to ship features quickly.",
                        "Raise the bar on accessibility, performance, and design quality across the web app.",
                    ],
                    "requirements": [
                        "Strong React and TypeScript fundamentals in production systems.",
                        "Experience building design-system driven interfaces with clean state management.",
                        "Comfort translating fuzzy product goals into reliable frontend architecture.",
                    ],
                    "preferred_skills": [
                        "Next.js app router experience.",
                        "Animation and micro-interaction design sense.",
                        "Familiarity with hiring, HRMS, or workflow products.",
                    ],
                    "benefits": [
                        "Hybrid team with focused collaboration days.",
                        "Equipment budget and learning stipend.",
                        "High ownership on product direction and UI quality.",
                    ],
                    "featured": True,
                    "openings": 2,
                    "approval_status": "posted",
                    "approval_decided_at": now,
                    "posted_at": now,
                    "urgency_level": 5,
                    "description": (
                        "Join Ethara to craft a premium candidate experience and a fast, reliable recruiter platform. "
                        "You'll work on modern frontend systems that sit at the center of our hiring and onboarding stack."
                    ),
                    "is_active": True,
                },
            ),
            upsert(
                session,
                Position,
                "pos-be",
                {
                    "title": "Backend Engineer",
                    "slug": "backend-engineer",
                    "department": "Engineering",
                    "summary": "Design resilient APIs and workflow engines that power the hiring lifecycle.",
                    "location": "Bengaluru, India",
                    "employment_type": "Full-time",
                    "work_mode": "Hybrid",
                    "experience_level": "3-6 years",
                    "responsibilities": [
                        "Build FastAPI services for hiring workflows, automation, and integrations.",
                        "Design clean schemas and background jobs for candidate lifecycle events.",
                        "Improve observability, security, and reliability across backend systems.",
                    ],
                    "requirements": [
                        "Strong Python backend experience with SQL and API design.",
                        "Hands-on understanding of async workflows, queues, and auth patterns.",
                        "Ability to own features from data model through production rollout.",
                    ],
                    "preferred_skills": [
                        "FastAPI or Django experience.",
                        "PostgreSQL performance tuning.",
                        "Exposure to OCR, workflow, or document-processing platforms.",
                    ],
                    "benefits": [
                        "Ownership over business-critical systems.",
                        "Mentorship from senior product and platform leaders.",
                        "Flexible hybrid work model.",
                    ],
                    "featured": True,
                    "openings": 3,
                    "approval_status": "posted",
                    "approval_decided_at": now,
                    "posted_at": now,
                    "urgency_level": 4,
                    "description": (
                        "Work on the services that connect candidate registration, HR operations, screening, and onboarding. "
                        "This role is ideal for engineers who enjoy pragmatic architecture and product depth."
                    ),
                    "is_active": True,
                },
            ),
            upsert(
                session,
                Position,
                "pos-ds",
                {
                    "title": "Data Scientist",
                    "slug": "data-scientist",
                    "department": "Data & AI",
                    "summary": "Turn hiring and onboarding data into better screening, forecasting, and automation.",
                    "location": "Remote, India",
                    "employment_type": "Full-time",
                    "work_mode": "Remote",
                    "experience_level": "2-5 years",
                    "responsibilities": [
                        "Prototype and productionize ML models for screening and operations insights.",
                        "Partner with product teams on measurable AI-assisted workflows.",
                        "Build experimentation and reporting layers for model quality and fairness.",
                    ],
                    "requirements": [
                        "Strong Python and applied ML fundamentals.",
                        "Experience cleaning real-world datasets and shipping measurable models.",
                        "Solid communication around tradeoffs, metrics, and experimentation.",
                    ],
                    "preferred_skills": [
                        "LLM-assisted extraction or ranking systems.",
                        "Analytics dashboards and stakeholder reporting.",
                        "Prior work in talent, marketplace, or ops platforms.",
                    ],
                    "benefits": [
                        "Remote-first collaboration with in-person meetups.",
                        "Wide scope across AI, product, and operations.",
                        "Learning budget for conferences and courses.",
                    ],
                    "featured": False,
                    "openings": 1,
                    "approval_status": "posted",
                    "approval_decided_at": now,
                    "posted_at": now,
                    "urgency_level": 3,
                    "description": (
                        "Help Ethara blend operational rigor with applied AI. You'll work on ranking, extraction, and "
                        "decision-support systems that make our hiring workflows sharper and faster."
                    ),
                    "is_active": True,
                },
            ),
        ]

        [
            upsert(session, College, "col-iitd", {"name": "IIT Delhi", "short_name": "IIT Delhi", "is_active": True}),
            upsert(session, College, "col-bits", {"name": "BITS Pilani", "short_name": "BITS", "is_active": True}),
            upsert(session, College, "col-iiit", {"name": "IIIT Hyderabad", "short_name": "IIIT Hyd", "is_active": True}),
        ]

        [
            upsert_user(session, "usr-admin", {"email": "admin@ethara.ai", "password_hash": hash_password(_seed_password("SEED_ADMIN_PASSWORD")), "name": "Ethara Admin", "role": Role.ADMIN, "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-hr", {"email": "hr@ethara.ai", "password_hash": hash_password(_seed_password("SEED_HR_PASSWORD")), "name": "Ethara HR", "role": Role.HR, "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-referrer", {"email": "referrer@ethara.ai", "password_hash": hash_password(_seed_password("SEED_REFERRER_PASSWORD")), "name": "Employee Referrer", "role": Role.EMPLOYEE_REFERRER, "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-eval", {"email": "evaluator@ethara.ai", "password_hash": hash_password(_seed_password("SEED_EVALUATOR_PASSWORD")), "name": "Ethara Evaluator", "role": Role.EVALUATOR, "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-it", {"email": "it@ethara.ai", "password_hash": hash_password(_seed_password("SEED_IT_PASSWORD")), "name": "Ethara IT", "role": Role.IT_TEAM, "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-compliance", {"email": "compliance@ethara.ai", "password_hash": hash_password(_seed_password("SEED_COMPLIANCE_PASSWORD")), "name": "Compliance Lead", "role": Role.COMPLIANCE, "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-employee", {"email": "employee@ethara.ai", "password_hash": hash_password(_seed_password("SEED_EMPLOYEE_PASSWORD")), "name": "Ethara Employee", "role": Role.EMPLOYEE, "phone": "9876543299", "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-employee-demo-login", {"email": "employee.demo@ethara.ai", "password_hash": hash_password(_seed_password("SEED_EMPLOYEE_DEMO_PASSWORD")), "name": "Niharika Demo", "role": Role.EMPLOYEE, "phone": "9876543277", "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-manager", {"email": "manager@ethara.ai", "password_hash": hash_password(_seed_password("SEED_MANAGER_PASSWORD")), "name": "Team Manager", "role": Role.MANAGER, "is_active": True, "email_verified_at": now}),
            upsert_user(session, "usr-office-admin", {"email": "officeadmin@ethara.ai", "password_hash": hash_password(_seed_password("SEED_OFFICE_ADMIN_PASSWORD")), "name": "Office Admin", "role": Role.OFFICE_ADMIN, "is_active": True, "email_verified_at": now}),
        ]

        upsert(
            session,
            EmployeeProfile,
            "emp-demo-001",
            {
                "user_id": "usr-employee",
                "full_name": "Ethara Employee",
                "ethara_email": "employee@ethara.ai",
                "personal_email": "employee.personal@example.com",
                "employee_code": "EMP-001",
                "phone": "9876543299",
                "department": "Engineering",
                "designation": "Software Engineer",
                "manager_id": "usr-manager",
                "gender": "prefer_not_to_say",
                "aadhaar_last4": "4321",
                "aadhaar_ocr_status": "extracted",
            },
        )

        upsert(
            session,
            EmployeeProfile,
            "emp-demo-login-001",
            {
                "user_id": "usr-employee-demo-login",
                "full_name": "Niharika Demo",
                "ethara_email": "employee.demo@ethara.ai",
                "personal_email": "niharika.demo@example.com",
                "employee_code": "EMP-DEMO-LOGIN-001",
                "phone": "9876543277",
                "department": "Operations",
                "designation": "Senior Executive",
                "manager_id": "usr-manager",
                "gender": "female",
                "aadhaar_last4": "7788",
                "aadhaar_ocr_status": "pending",
            },
        )

        demo_docs_root = "seed/employee_documents/emp-docs-001"
        demo_resume_url = _seed_upload(
            f"{demo_docs_root}/resume.pdf",
            _build_demo_pdf_bytes(),
        )
        demo_aadhaar_url = _seed_upload(
            f"{demo_docs_root}/aadhaar-card.png",
            _build_demo_png_bytes((236, 242, 255)),
        )
        demo_pan_url = _seed_upload(
            f"{demo_docs_root}/pan-card.pdf",
            _build_demo_pdf_bytes(),
        )
        demo_photo_url = _seed_upload(
            f"{demo_docs_root}/passport-photo.png",
            _build_demo_png_bytes((221, 234, 254)),
        )
        demo_address_proof_url = _seed_upload(
            f"{demo_docs_root}/address-proof.pdf",
            _build_demo_pdf_bytes(),
        )
        demo_education_url = _seed_upload(
            f"{demo_docs_root}/education-certificate.pdf",
            _build_demo_pdf_bytes(),
        )

        upsert_user(
            session,
            "usr-employee-docs-demo",
            {
                "email": "employee.documents@ethara.ai",
                "password_hash": hash_password(_seed_password("SEED_EMPLOYEE_DOCS_PASSWORD")),
                "name": "Employee Documents Demo",
                "role": Role.EMPLOYEE,
                "phone": "9876543288",
                "is_active": True,
                "email_verified_at": now,
            },
        )

        upsert(
            session,
            EmployeeProfile,
            "emp-docs-001",
            {
                "user_id": "usr-employee-docs-demo",
                "full_name": "Employee Documents Demo",
                "ethara_email": "employee.documents@ethara.ai",
                "personal_email": "employee.documents@example.com",
                "employee_code": "EMP-DOCS-001",
                "phone": "9876543288",
                "department": "Operations",
                "designation": "Operations Specialist",
                "manager_id": "usr-manager",
                "gender": "female",
                "aadhaar_last4": "4567",
                "aadhaar_path": demo_aadhaar_url,
                "resume_path": demo_resume_url,
                "aadhaar_ocr_status": "extracted",
                "aadhaar_ocr_match": True,
                "aadhaar_ocr_name": "Employee Documents Demo",
            },
        )

        for document_id, document_type, file_name, file_url, mime_type in [
            ("empdoc-demo-resume", "resume", "resume.pdf", demo_resume_url, "application/pdf"),
            ("empdoc-demo-aadhaar", "aadhaar", "aadhaar-card.png", demo_aadhaar_url, "image/png"),
            ("empdoc-demo-pan", "pan", "pan-card.pdf", demo_pan_url, "application/pdf"),
            ("empdoc-demo-photo", "photo", "passport-photo.png", demo_photo_url, "image/png"),
            ("empdoc-demo-address", "permanent_address_proof", "address-proof.pdf", demo_address_proof_url, "application/pdf"),
            ("empdoc-demo-education", "education_certificate", "education-certificate.pdf", demo_education_url, "application/pdf"),
        ]:
            upsert(
                session,
                EmployeeDocument,
                document_id,
                {
                    "employee_profile_id": "emp-docs-001",
                    "type": document_type,
                    "file_name": file_name,
                    "file_url": file_url,
                    "file_size": len((get_settings().local_storage_path / file_url.removeprefix("/uploads/")).read_bytes()),
                    "mime_type": mime_type,
                    "status": "verified",
                    "remarks": "Seeded demo document for employee detail testing.",
                    "uploaded_by": "usr-hr",
                    "verified_by": "usr-hr",
                    "verified_at": now,
                },
            )

        demo_candidate_user = upsert_user(
            session,
            "usr-cand-selform",
            {
                "email": "arjun.demo@gmail.com",
                "password_hash": hash_password(_seed_password("SEED_DEMO_CANDIDATE_PASSWORD")),
                "name": "Arjun Sharma",
                "role": Role.CANDIDATE,
                "is_active": True,
                "email_verified_at": now,
            },
        )

        demo_candidate = upsert(
            session,
            Candidate,
            demo_candidate_id,
            {
                "candidate_code": "ETH-DEMO-SELFORM",
                "full_name": "Arjun Sharma",
                "personal_email": "arjun.demo@gmail.com",
                "phone": "9876543210",
                "gender": "male",
                "experience_type": "experienced",
                "source_type": SourceType.DIRECT_APPLICATION,
                "position_id": positions[0].id,
                "portal_user_id": demo_candidate_user.id,
                "current_stage": CandidateStage.EVALUATION_ASSIGNED,
                "current_status": "Assessments Assigned",
                "priority_score": 88,
                "last_applied_at": now,
                "resume_score": 87.5,
                "resume_summary": "Experienced frontend engineer with 5 years of React/TypeScript expertise.",
                "aadhaar_last4": "1234",
            },
        )

        for idx, stage_pair in enumerate([
            (CandidateStage.NEW_APPLICATION, CandidateStage.NEW_APPLICATION, "Application received"),
            (CandidateStage.NEW_APPLICATION, CandidateStage.RESUME_SCREENING_PENDING, "Resume uploaded"),
            (CandidateStage.RESUME_SCREENING_PENDING, CandidateStage.RESUME_SHORTLISTED, "Resume shortlisted — score 87"),
            (CandidateStage.RESUME_SHORTLISTED, CandidateStage.EVALUATION_ASSIGNED, "Evaluation assigned"),
        ]):
            from_s, to_s, notes = stage_pair
            log_id = f"sdlog{idx:03d}"
            existing = session.get(StageLog, log_id)
            if existing is None:
                log = StageLog(
                    id=log_id,
                    candidate_id=demo_candidate.id,
                    from_stage=from_s,
                    to_stage=to_s,
                    changed_by="usr-admin",
                    changed_by_name="Ethara Admin",
                    notes=notes,
                )
                session.add(log)

        session.commit()
        print("Seed completed.")
        if get_settings().is_development:
            print("Dev seed accounts (passwords are NOT printed):")
            print("  Set SEED_<ROLE>_PASSWORD env vars before seeding to choose passwords;")
            print("  otherwise each freshly-created account gets a random password — recover")
            print("  access via the password-reset flow. Existing accounts are never modified.")
            for label, email in (
                ("Admin", "admin@ethara.ai"),
                ("HR", "hr@ethara.ai"),
                ("Referrer", "referrer@ethara.ai"),
                ("Evaluator", "evaluator@ethara.ai"),
                ("IT Team", "it@ethara.ai"),
                ("Manager", "manager@ethara.ai"),
                ("OfficeAdm", "officeadmin@ethara.ai"),
                ("Demo Emp", "employee.demo@ethara.ai"),
                ("Emp Docs", "employee.documents@ethara.ai"),
                ("Demo Cand", "arjun.demo@gmail.com"),
            ):
                print(f"  {label:<10} {email}")


if __name__ == "__main__":
    main()
