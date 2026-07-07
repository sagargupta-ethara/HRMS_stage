#!/usr/bin/env python
"""Seed demo data for the Project Governance & Budget Management module.

Idempotent and DEV-ONLY (never wired into prod startup). Populates ~9 projects
(the sheet rows + extras across Technical/Generalist and all statuses), seeds
custom-column values, TPM/PL leads (resolving sheet names to users, creating
lightweight placeholder pl_tpm users where unmatched), budgets in every state
of the two-stage workflow, and a few project-linked reimbursements/dinners so
the analytics dashboards have real numbers. Sends NO email.

Usage:
    .venv/bin/python -m scripts.seed_project_governance
"""

from __future__ import annotations

import argparse
import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select, update

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.db.models import (
    DinnerRequest,
    EmployeeProfile,
    Project,
    ProjectBudget,
    ProjectBudgetActionLog,
    ProjectLead,
    ReimbursementRequest,
    Role,
    User,
    generate_id,
)
from app.services import project_governance as pg

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("seed-project-governance")

NOW = datetime.now(UTC)


def _email_for(name: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "." for ch in name).strip(".")
    while ".." in slug:
        slug = slug.replace("..", ".")
    return f"{slug}@demo.ethara.ai"


def get_or_create_user(db, name, *, role=Role.PL_TPM, overrides=None):
    existing = db.scalar(select(User).where(func.lower(User.name) == name.lower()))
    if existing:
        if overrides:
            merged = sorted(set(existing.permission_overrides or []) | set(overrides))
            existing.permission_overrides = merged
        return existing
    user = User(
        id=generate_id(),
        email=_email_for(name),
        password_hash=hash_password("Demo@12345"),
        name=name,
        role=role,
        roles=[role.value],
        is_active=True,
        permission_overrides=list(overrides or []),
    )
    db.add(user)
    db.flush()
    log.info("  created demo user %s (%s)", name, role.value)
    return user


def upsert_project(db, *, internal_name, **fields):
    project = db.scalar(select(Project).where(func.lower(Project.internal_name) == internal_name.lower()))
    if project is None:
        project = Project(id=generate_id(), internal_name=internal_name)
        db.add(project)
    for key, value in fields.items():
        setattr(project, key, value)
    project.internal_name = internal_name
    db.flush()
    return project


def set_leads(db, project, *, tpm: User | None, pls: list[User]):
    for lead in list(db.scalars(select(ProjectLead).where(ProjectLead.project_id == project.id))):
        db.delete(lead)
    db.flush()
    if tpm:
        project.tpm_user_id = tpm.id
        db.add(ProjectLead(id=generate_id(), project_id=project.id, user_id=tpm.id, role="tpm"))
    for pl in pls:
        db.add(ProjectLead(id=generate_id(), project_id=project.id, user_id=pl.id, role="pl"))
    db.flush()


def ensure_budget(db, project, *, amount, status, proposer, functional_approver, approve_amount=False):
    """Create one demo budget for a project if it has none yet (idempotent)."""
    if db.scalar(select(func.count()).select_from(ProjectBudget).where(ProjectBudget.project_id == project.id)):
        return None
    budget = ProjectBudget(
        id=generate_id(),
        project_id=project.id,
        version=1,
        amount=amount,
        currency="INR",
        period="overall",
        justification=f"Initial budget proposal for {project.internal_name}.",
        status=status,
        proposed_by=proposer.id if proposer else None,
        submitted_at=NOW - timedelta(days=3) if status != pg.STATUS_DRAFT else None,
        functional_approver_id=functional_approver.id if functional_approver else None,
    )
    if status in {pg.STATUS_PENDING_LEADERSHIP, pg.STATUS_APPROVED}:
        budget.functional_decision = "approved"
        budget.functional_decided_by = functional_approver.id if functional_approver else None
        budget.functional_decided_at = NOW - timedelta(days=2)
    if status == pg.STATUS_APPROVED:
        budget.leadership_decision = "approved"
        budget.leadership_decided_at = NOW - timedelta(days=1)
        if approve_amount:
            project.approved_budget = amount
    if status == pg.STATUS_REJECTED:
        budget.functional_decision = "rejected"
        budget.functional_decided_by = functional_approver.id if functional_approver else None
        budget.functional_decided_at = NOW - timedelta(days=2)
        budget.functional_comment = "Scope too broad for the quarter; resubmit with phased plan."
    db.add(budget)
    db.flush()
    db.add(
        ProjectBudgetActionLog(
            id=generate_id(), budget_id=budget.id, action="seeded", stage="proposal",
            from_status=None, to_status=status, performed_by="system", performed_by_name="Seed",
        )
    )
    return budget


DEMO_DOMAIN = "@demo.ethara.ai"


def _purge(db) -> dict[str, int]:
    """Remove ALL seeded demo data, FK-safe. Caller commits."""
    demo_users = list(db.scalars(select(User).where(User.email.like(f"%{DEMO_DOMAIN}"))))
    demo_ids = [u.id for u in demo_users]

    # 1) Seeded expenses first (they reference projects + demo users).
    reimb = list(db.scalars(select(ReimbursementRequest).where(ReimbursementRequest.reason.like("[seed]%"))))
    for r in reimb:
        db.delete(r)
    dinners = list(db.scalars(select(DinnerRequest).where(DinnerRequest.reviewer_comments.like("[seed]%"))))
    for d in dinners:
        db.delete(d)
    db.flush()

    # 2) Seeded projects via ORM delete -> cascades leads/budgets/action-logs.
    projects = [p for p in db.scalars(select(Project)) if (p.custom_fields or {}).get("_seed")]
    for p in projects:
        db.delete(p)
    db.flush()

    # 3) Null/clear any *remaining* references to demo users (e.g. if a demo user
    #    was attached to a hand-created project) so the user delete is FK-safe.
    if demo_ids:
        for lead in db.scalars(select(ProjectLead).where(ProjectLead.user_id.in_(demo_ids))):
            db.delete(lead)
        db.execute(update(Project).where(Project.tpm_user_id.in_(demo_ids)).values(tpm_user_id=None))
        db.execute(update(Project).where(Project.created_by.in_(demo_ids)).values(created_by=None))
        for col in ("proposed_by", "functional_approver_id", "functional_decided_by", "leadership_decided_by"):
            db.execute(update(ProjectBudget).where(getattr(ProjectBudget, col).in_(demo_ids)).values({col: None}))
        db.flush()
        # Drop the approver config if it pointed at demo users.
        cfg = pg.get_approver_config(db)
        if cfg.get("technical") in demo_ids or cfg.get("generalist") in demo_ids:
            pg.set_setting_value(db, key=pg.APPROVERS_KEY, value={"technical": None, "generalist": None}, actor=None)

    # 4) Finally delete the demo users themselves.
    for u in demo_users:
        db.delete(u)
    db.flush()
    return {"users": len(demo_ids), "projects": len(projects), "reimbursements": len(reimb), "dinners": len(dinners)}


def purge() -> None:
    db = SessionLocal()
    try:
        log.info("Purging Project Governance demo data...")
        counts = _purge(db)
        db.commit()
        log.info(
            "Purged: %d demo users, %d seeded projects, %d reimbursements, %d dinners. Nothing demo remains.",
            counts["users"], counts["projects"], counts["reimbursements"], counts["dinners"],
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    db = SessionLocal()
    try:
        log.info("Seeding Project Governance demo data...")

        # --- approver users (CTO / COO) — functional approvers, identity-gated ---
        cto = get_or_create_user(
            db, "Sarvesh Jatasra", role=Role.MANAGER,
            overrides=["projects:read", "projects:budget_approve_functional"],
        )
        coo = get_or_create_user(
            db, "Ashutosh", role=Role.MANAGER,
            overrides=["projects:read", "projects:budget_approve_functional"],
        )
        pg.set_setting_value(db, key=pg.APPROVERS_KEY, value={"technical": cto.id, "generalist": coo.id}, actor=None)
        pg.set_setting_value(
            db, key=pg.SLA_KEY,
            value={"budgetApprovalSlaHours": 48, "expenseApprovalSlaHours": 48}, actor=None,
        )

        # ensure at least one leadership user for stage-2 approvals
        leader = db.scalar(select(User).where(User.role == Role.LEADERSHIP, User.is_active.is_(True)))
        if leader is None:
            leader = get_or_create_user(db, "Leadership Demo", role=Role.LEADERSHIP)

        # --- TPM / PL users from the sheet ---
        navya = get_or_create_user(db, "Navya Arora")
        shreeyank = get_or_create_user(db, "Shreeyank Doliya")
        khushi = get_or_create_user(db, "Khushi Tomar")
        swarnim = get_or_create_user(db, "Swarnim Jain")
        ram = get_or_create_user(db, "Ram Lalit Chaudhary")
        meera = get_or_create_user(db, "Meera Nair")
        arjun = get_or_create_user(db, "Arjun Sethi")

        cf = lambda **kw: {**kw, "_seed": True}  # noqa: E731

        specs = [
            dict(internal_name="Talos", external_name="OpenClaw SFT Main", client="OpenClaw",
                 platform="Internal", project_type="technical", rfp_status="production",
                 delivery_status="ongoing", appsheet_approval="Partial", trajectory_cost_approval="Pending",
                 aht=5.0, target_volume=5000, delivered_volume=1000, date_of_delivery=date(2026, 5, 21),
                 fte_demand=5, fte_count=61, intern_count=5, total_members=66,
                 custom_fields=cf(claude_subscriptions="7"),
                 tpm=navya, pls=[shreeyank, khushi],
                 budget=(5_000_000, pg.STATUS_APPROVED)),
            dict(internal_name="Talos Safety", external_name="Openclaw SFT - Safety", client="OpenClaw",
                 platform="Internal", project_type="technical", rfp_status="rfp",
                 delivery_status="ongoing", appsheet_approval="No", aht=3.5,
                 fte_demand=3, fte_count=12, intern_count=4, total_members=16,
                 custom_fields=cf(claude_subscriptions="2"),
                 tpm=navya, pls=[shreeyank, khushi],
                 budget=(1_200_000, pg.STATUS_PENDING_FUNCTIONAL)),
            dict(internal_name="Skoll", external_name="Openclaw SFT - MultiAgent", client="OpenClaw",
                 platform="Internal", project_type="technical", rfp_status="rfp",
                 delivery_status="ongoing", appsheet_approval="Yes", aht=4.0,
                 fte_demand=4, fte_count=32, intern_count=4, total_members=36,
                 custom_fields=cf(claude_subscriptions="2", open_router="1"),
                 tpm=navya, pls=[swarnim, ram],
                 budget=(2_400_000, pg.STATUS_PENDING_LEADERSHIP)),
            dict(internal_name="Helios", external_name="Acme Support Ops", client="Acme Corp",
                 platform="Client", project_type="generalist", rfp_status="production",
                 delivery_status="ongoing", aht=6.0, target_volume=8000, delivered_volume=6200,
                 fte_demand=20, fte_count=18, intern_count=2, total_members=20,
                 custom_fields=cf(fiverr="45000"),
                 tpm=meera, pls=[arjun],
                 budget=(3_600_000, pg.STATUS_APPROVED)),
            dict(internal_name="Atlas", external_name="Nimbus Data Labeling", client="Nimbus",
                 platform="Client", project_type="generalist", rfp_status="rfp",
                 delivery_status="ongoing", aht=2.5,
                 fte_demand=10, fte_count=6, intern_count=8, total_members=14,
                 custom_fields=cf(no_of_submissions="320"),
                 tpm=meera, pls=[arjun],
                 budget=(900_000, pg.STATUS_DRAFT)),
            dict(internal_name="Orion", external_name="Vertex RLHF", client="Vertex AI",
                 platform="Client", project_type="technical", rfp_status="delivered",
                 delivery_status="completed", aht=4.5, target_volume=3000, delivered_volume=3000,
                 date_of_delivery=date(2026, 4, 10), fte_demand=8, fte_count=8, intern_count=0,
                 total_members=8, custom_fields=cf(open_ai="3"),
                 tpm=navya, pls=[swarnim],
                 budget=(2_000_000, pg.STATUS_REJECTED)),
            dict(internal_name="Lyra", external_name="Internal Tooling", client=None,
                 platform="Internal", project_type="generalist", rfp_status="production",
                 delivery_status="ongoing", aht=1.5, fte_demand=4, fte_count=4, intern_count=1,
                 total_members=5, custom_fields=cf(mm_submissions="58"),
                 tpm=meera, pls=[khushi],
                 budget=(750_000, pg.STATUS_APPROVED)),
            dict(internal_name="Phoenix", external_name="Stellar Annotation", client="Stellar",
                 platform="Client", project_type="generalist", rfp_status="delivered",
                 delivery_status="completed", aht=3.0, target_volume=10000, delivered_volume=10000,
                 date_of_delivery=date(2026, 3, 1), fte_demand=15, fte_count=14, intern_count=3,
                 total_members=17, custom_fields=cf(fiverr="120000"),
                 tpm=meera, pls=[arjun, ram],
                 budget=(4_200_000, pg.STATUS_APPROVED)),
        ]

        projects: list[Project] = []
        for spec in specs:
            tpm = spec.pop("tpm")
            pls = spec.pop("pls")
            amount, status = spec.pop("budget")
            project = upsert_project(db, created_by=(tpm.id if tpm else None), currency="INR", **spec)
            set_leads(db, project, tpm=tpm, pls=pls)
            approver = cto if project.project_type == "technical" else coo
            ensure_budget(
                db, project, amount=amount, status=status, proposer=tpm,
                functional_approver=approver, approve_amount=True,
            )
            projects.append(project)

        by_name = {p.internal_name: p for p in projects}

        # --- project-linked reimbursements (paid) so consumed budget > 0 ---
        profile = db.scalar(select(EmployeeProfile))
        if profile is not None and not db.scalar(
            select(func.count()).select_from(ReimbursementRequest).where(ReimbursementRequest.reason.like("[seed]%"))
        ):
            paid_specs = [
                ("Talos", 42000.0, "GPU credits top-up"),
                ("Helios", 18500.0, "Team offsite travel"),
                ("Phoenix", 27000.0, "Annotation tooling licenses"),
                ("Lyra", 9500.0, "Software subscription"),
            ]
            for pname, amount, reason in paid_specs:
                project = by_name.get(pname)
                if not project:
                    continue
                db.add(
                    ReimbursementRequest(
                        id=generate_id(),
                        employee_profile_id=profile.id,
                        employee_name=profile.full_name,
                        employee_code=profile.employee_code,
                        department=profile.department,
                        project_id=project.id,
                        project_name=project.internal_name,
                        category="Software & Tools",
                        expense_date=(NOW - timedelta(days=10)).date(),
                        expense_amount=amount,
                        currency="INR",
                        reason=f"[seed] {reason}",
                        payment_method="Bank Transfer",
                        declaration_accepted=True,
                        status="paid",
                        paid_at=NOW - timedelta(days=2),
                        submitted_at=NOW - timedelta(days=9),
                    )
                )
            log.info("  seeded paid reimbursements for spend rollups")
        elif profile is None:
            log.info("  (no employee profile found — skipping reimbursement seed)")

        # --- project-linked dinners (completed, with amount) ---
        if not db.scalar(select(func.count()).select_from(DinnerRequest).where(DinnerRequest.reviewer_comments.like("[seed]%"))):
            dinner_specs = [("Talos", navya, 8200.0), ("Helios", meera, 6400.0)]
            for pname, requester, amount in dinner_specs:
                project = by_name.get(pname)
                if not project:
                    continue
                db.add(
                    DinnerRequest(
                        id=generate_id(),
                        requester_user_id=requester.id,
                        requester_name=requester.name,
                        requester_type="project_lead",
                        dinner_date=(NOW - timedelta(days=5)).date(),
                        project_id=project.id,
                        project_name=project.internal_name,
                        amount=amount,
                        team_member_count=12,
                        team_member_emails=[],
                        status="completed",
                        reviewer_comments="[seed] approved",
                        completed_at=NOW - timedelta(days=4),
                        submitted_at=NOW - timedelta(days=6),
                    )
                )
            log.info("  seeded completed dinners for spend rollups")

        db.flush()
        for project in projects:
            pg.recompute_project_spend(db, project.id)

        db.commit()
        log.info("Done. %d projects seeded/updated.", len(projects))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed or completely remove Project Governance demo data.")
    parser.add_argument("--purge", action="store_true", help="Remove ALL seeded demo data + demo users, then exit.")
    args = parser.parse_args()
    if args.purge:
        purge()
    else:
        main()
