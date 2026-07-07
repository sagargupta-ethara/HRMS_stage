"""Business logic for Project Governance & Budget Management.

Covers project ownership checks, config-driven (CTO/COO) functional-approver
resolution, the two-stage budget approval state machine, project-wise spend
rollups, and the SLA escalation sweep.

Email dispatch is OFF by default (feature flag `project_email_enabled`). When
disabled, approvers are notified in-app only; the tokenized approve/reject email
links are still generated and stored so the public route works when email is
later enabled. Nothing is sent while the flag is off.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import role_value, user_has_any_role
from app.core.config import get_settings
from app.core.security import create_token, hash_token
from app.db.models import (
    AdminSetting,
    DinnerRequest,
    NotificationType,
    Project,
    ProjectBudget,
    ProjectBudgetActionLog,
    ProjectLead,
    ReimbursementRequest,
    Role,
    User,
    generate_id,
)
from app.services.integrations import EmailService
from app.services.workflows import create_notification

SETTINGS_NAMESPACE = "project_governance"
APPROVERS_KEY = "project_budget_approvers"  # {"technical": userId, "generalist": userId}
SLA_KEY = "project_sla"  # {"budgetApprovalSlaHours": int, "expenseApprovalSlaHours": int}
EMAIL_ENABLED_KEY = "project_email_enabled"  # bool — keep False (no real emails)

DEFAULT_BUDGET_SLA_HOURS = 48
DEFAULT_EXPENSE_SLA_HOURS = 48

FULL_ACCESS_ROLES = {Role.ADMIN, Role.SUPER_ADMIN, Role.LEADERSHIP}

# Budget approval states.
STATUS_DRAFT = "draft"
STATUS_PENDING_FUNCTIONAL = "pending_functional_approval"
STATUS_PENDING_LEADERSHIP = "pending_leadership_approval"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"


# --------------------------------------------------------------------------- #
# Settings helpers (admin_settings table)
# --------------------------------------------------------------------------- #
def get_setting_value(db: Session, key: str, default: Any = None) -> Any:
    record = db.scalar(select(AdminSetting).where(AdminSetting.key == key))
    return record.value if record else default


def set_setting_value(
    db: Session, *, key: str, value: Any, actor: User | None, description: str | None = None
) -> AdminSetting:
    record = db.scalar(select(AdminSetting).where(AdminSetting.key == key))
    if record:
        record.value = value
        record.updated_by = actor.id if actor else None
    else:
        record = AdminSetting(
            namespace=SETTINGS_NAMESPACE,
            key=key,
            value=value,
            description=description,
            updated_by=actor.id if actor else None,
        )
        db.add(record)
    db.flush()
    return record


def get_approver_config(db: Session) -> dict[str, str | None]:
    raw = get_setting_value(db, APPROVERS_KEY, {}) or {}
    return {
        "technical": raw.get("technical"),
        "generalist": raw.get("generalist"),
    }


def get_sla_config(db: Session) -> dict[str, int]:
    raw = get_setting_value(db, SLA_KEY, {}) or {}
    return {
        "budgetApprovalSlaHours": int(raw.get("budgetApprovalSlaHours") or DEFAULT_BUDGET_SLA_HOURS),
        "expenseApprovalSlaHours": int(raw.get("expenseApprovalSlaHours") or DEFAULT_EXPENSE_SLA_HOURS),
    }


def email_enabled(db: Session) -> bool:
    return bool(get_setting_value(db, EMAIL_ENABLED_KEY, False))


# --------------------------------------------------------------------------- #
# Ownership / authorization
# --------------------------------------------------------------------------- #
def is_full_access(user: User) -> bool:
    return user_has_any_role(user, FULL_ACCESS_ROLES)


# Roles that see EVERY project (org-wide oversight). Manager & PL/TPM are
# deliberately excluded — they only see projects they're tagged to. HR and
# Office-Admin are included as back-office finance/expense oversight.
VIEW_ALL_ROLES = {Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.OFFICE_ADMIN}


_VIEW_ALL_ROLE_VALUES = {r.value for r in VIEW_ALL_ROLES}


def can_view_all_projects(user: User) -> bool:
    """View-all keys off the user's ACTIVE (currently switched) role, not the
    union of all their roles — so a multi-role user (e.g. admin who also holds
    manager/pl_tpm) can switch role to preview the scoped, project-tagged view.
    Write/approval power (is_full_access) still uses the full role union."""
    return role_value(user.role) in _VIEW_ALL_ROLE_VALUES


def visible_project_ids(db: Session, user: User) -> set[str] | None:
    """Return the set of project ids this user may see, or None for "all".

    A scoped user (Manager / PL-TPM) sees only projects they're tagged to:
    as the project's TPM, its creator, or any assigned lead (TPM/PL)."""
    if can_view_all_projects(user):
        return None
    ids: set[str] = set(
        db.scalars(select(ProjectLead.project_id).where(ProjectLead.user_id == user.id))
    )
    ids.update(
        db.scalars(
            select(Project.id).where(
                (Project.tpm_user_id == user.id) | (Project.created_by == user.id)
            )
        )
    )
    return ids


def is_project_lead(db: Session, project_id: str, user_id: str) -> bool:
    return (
        db.scalar(
            select(ProjectLead.id).where(
                ProjectLead.project_id == project_id, ProjectLead.user_id == user_id
            )
        )
        is not None
    )


def can_act_on_project(db: Session, user: User, project: Project) -> bool:
    """A user may act on a project if they are admin/leadership, its creator,
    its TPM, or any assigned lead (TPM/PL)."""
    if is_full_access(user):
        return True
    if project.created_by == user.id or project.tpm_user_id == user.id:
        return True
    return is_project_lead(db, project.id, user.id)


def assert_can_act_on_project(db: Session, user: User, project: Project) -> None:
    if not can_act_on_project(db, user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project's assigned TPM/PL (or Admin/Leadership) can perform this action.",
        )


# --------------------------------------------------------------------------- #
# Approver resolution
# --------------------------------------------------------------------------- #
def resolve_functional_approver(db: Session, project: Project) -> User | None:
    """Stage-1 approver: CTO for Technical / COO for Generalist (config-driven).
    Falls back to the first active Leadership user so approvals never dead-end."""
    config = get_approver_config(db)
    key = "generalist" if (project.project_type or "").lower() == "generalist" else "technical"
    user_id = config.get(key)
    if user_id:
        approver = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
        if approver:
            return approver
    return db.scalar(
        select(User).where(User.role == Role.LEADERSHIP, User.is_active.is_(True)).order_by(User.created_at)
    )


def leadership_users(db: Session) -> list[User]:
    return list(
        db.scalars(
            select(User).where(User.role == Role.LEADERSHIP, User.is_active.is_(True)).order_by(User.created_at)
        )
    )


# --------------------------------------------------------------------------- #
# Spend rollups
# --------------------------------------------------------------------------- #
def compute_project_spend(db: Session, project_id: str) -> float:
    """Live consumed spend = paid reimbursements + completed dinner amounts."""
    reimb = db.scalar(
        select(func.coalesce(func.sum(ReimbursementRequest.expense_amount), 0.0)).where(
            ReimbursementRequest.project_id == project_id,
            ReimbursementRequest.status == "paid",
        )
    )
    dinner = db.scalar(
        select(func.coalesce(func.sum(DinnerRequest.amount), 0.0)).where(
            DinnerRequest.project_id == project_id,
            DinnerRequest.status == "completed",
            DinnerRequest.amount.isnot(None),
        )
    )
    return round(float(reimb or 0.0) + float(dinner or 0.0), 2)


def recompute_project_spend(db: Session, project_id: str) -> float:
    """Update and persist the cached consumed_budget for a project."""
    spend = compute_project_spend(db, project_id)
    project = db.get(Project, project_id)
    if project is not None:
        project.consumed_budget = spend
        db.add(project)
    return spend


# --------------------------------------------------------------------------- #
# Budget approval state machine
# --------------------------------------------------------------------------- #
def log_budget_action(
    db: Session,
    *,
    budget: ProjectBudget,
    actor: User | None,
    action: str,
    stage: str | None,
    from_status: str | None,
    to_status: str | None,
    comment: str | None = None,
) -> None:
    db.add(
        ProjectBudgetActionLog(
            id=generate_id(),
            budget_id=budget.id,
            action=action,
            stage=stage,
            from_status=from_status,
            to_status=to_status,
            comment=comment,
            performed_by=actor.id if actor else "system",
            performed_by_name=actor.name if actor else "System",
            performed_by_role=(actor.role.value if actor and actor.role else None),
        )
    )


def next_budget_version(db: Session, project_id: str) -> int:
    current = db.scalar(
        select(func.coalesce(func.max(ProjectBudget.version), 0)).where(ProjectBudget.project_id == project_id)
    )
    return int(current or 0) + 1


def _approval_link(token: str) -> str:
    base = get_settings().frontend_url.rstrip("/")
    return f"{base}/api/v1/public/projects/budget-approval?token={token}"


def _issue_stage_token(budget: ProjectBudget, *, stage: str, decision: str) -> str:
    """Create a signed, single-use approve/reject token for an email link and
    store its hash on the budget for the given stage."""
    request_id = generate_id()
    settings = get_settings()
    token = create_token(
        subject=budget.id,
        secret=settings.jwt_secret,
        expires_delta=timedelta(days=7),
        token_type="project_budget_approval",
        extra={"rid": request_id, "stage": stage, "decision": decision},
    )
    token_hash = hash_token(request_id)
    expires_at = datetime.now(UTC) + timedelta(days=7)
    if stage == "functional":
        budget.functional_token_hash = token_hash
        budget.functional_token_expires_at = expires_at
    else:
        budget.leadership_token_hash = token_hash
        budget.leadership_token_expires_at = expires_at
    return token


def _maybe_email_approver(
    db: Session, *, budget: ProjectBudget, project: Project, approver: User | None, stage: str
) -> None:
    """Generate tokenized approve/reject links and (only when the email flag is
    on) dispatch the email. Always a no-op send while email is disabled."""
    if approver is None:
        return
    approve_token = _issue_stage_token(budget, stage=stage, decision="approve")
    reject_token = _issue_stage_token(budget, stage=stage, decision="reject")
    if not email_enabled(db):
        return  # links stored; nothing sent
    approve_link = _approval_link(approve_token)
    reject_link = _approval_link(reject_token)
    stage_label = "Functional (CTO/COO)" if stage == "functional" else "Leadership"
    body = (
        f"Budget approval required for project '{project.internal_name}'.\n\n"
        f"Amount: {budget.currency} {budget.amount:,.2f}\n"
        f"Stage: {stage_label}\n\n"
        f"Approve: {approve_link}\nReject: {reject_link}\n"
    )
    EmailService().send_email(
        to_email=approver.email,
        subject=f"Budget approval required — {project.internal_name}",
        body_text=body,
        body_html=(
            f"<p>Budget approval required for <strong>{project.internal_name}</strong>.</p>"
            f"<p>Amount: {budget.currency} {budget.amount:,.2f}<br/>Stage: {stage_label}</p>"
            f"<p><a href='{approve_link}'>Approve</a> &nbsp;|&nbsp; <a href='{reject_link}'>Reject</a></p>"
        ),
    )


def submit_budget(db: Session, *, budget: ProjectBudget, project: Project, actor: User) -> None:
    """Draft → pending functional approval. Resolves the CTO/COO approver and
    notifies them in-app (+ email link if enabled)."""
    if budget.status not in {STATUS_DRAFT, STATUS_REJECTED}:
        raise HTTPException(status_code=400, detail="Only draft budgets can be submitted.")
    approver = resolve_functional_approver(db, project)
    from_status = budget.status
    budget.status = STATUS_PENDING_FUNCTIONAL
    budget.submitted_at = datetime.now(UTC)
    budget.proposed_by = budget.proposed_by or actor.id
    budget.functional_approver_id = approver.id if approver else None
    db.add(budget)
    log_budget_action(
        db, budget=budget, actor=actor, action="submitted", stage="proposal",
        from_status=from_status, to_status=STATUS_PENDING_FUNCTIONAL,
        comment=f"Submitted for {'COO' if (project.project_type or '').lower() == 'generalist' else 'CTO'} approval.",
    )
    _maybe_email_approver(db, budget=budget, project=project, approver=approver, stage="functional")
    if approver is not None:
        create_notification(
            db,
            user_id=approver.id,
            title="Budget approval required",
            message=(
                f"{actor.name} submitted a {budget.currency} {budget.amount:,.2f} budget for "
                f"'{project.internal_name}' awaiting your approval."
            ),
            type_=NotificationType.ACTION,
            entity_type="project_budget",
            entity_id=budget.id,
            payload={"projectId": project.id, "budgetId": budget.id, "stage": "functional"},
        )


def apply_functional_decision(
    db: Session, *, budget: ProjectBudget, project: Project, actor: User | None, approve: bool, comment: str | None
) -> None:
    if budget.status != STATUS_PENDING_FUNCTIONAL:
        raise HTTPException(status_code=400, detail="Budget is not pending functional approval.")
    now = datetime.now(UTC)
    budget.functional_decided_by = actor.id if actor else None
    budget.functional_decided_at = now
    budget.functional_comment = comment
    budget.functional_token_hash = None
    budget.functional_token_expires_at = None
    if approve:
        budget.functional_decision = "approved"
        budget.status = STATUS_PENDING_LEADERSHIP
        log_budget_action(
            db, budget=budget, actor=actor, action="functional_approved", stage="functional",
            from_status=STATUS_PENDING_FUNCTIONAL, to_status=STATUS_PENDING_LEADERSHIP, comment=comment,
        )
        # Notify Leadership for final approval.
        for leader in leadership_users(db):
            create_notification(
                db,
                user_id=leader.id,
                title="Budget pending final approval",
                message=(
                    f"Budget {budget.currency} {budget.amount:,.2f} for '{project.internal_name}' "
                    f"passed functional approval and needs your final sign-off."
                ),
                type_=NotificationType.ACTION,
                entity_type="project_budget",
                entity_id=budget.id,
                payload={"projectId": project.id, "budgetId": budget.id, "stage": "leadership"},
            )
        _maybe_email_approver(
            db, budget=budget, project=project,
            approver=(leadership_users(db)[0] if leadership_users(db) else None), stage="leadership",
        )
    else:
        budget.functional_decision = "rejected"
        budget.status = STATUS_REJECTED
        log_budget_action(
            db, budget=budget, actor=actor, action="functional_rejected", stage="functional",
            from_status=STATUS_PENDING_FUNCTIONAL, to_status=STATUS_REJECTED, comment=comment,
        )
        _notify_proposer(db, budget=budget, project=project, title="Budget rejected", outcome="rejected at functional review", comment=comment)


def apply_leadership_decision(
    db: Session, *, budget: ProjectBudget, project: Project, actor: User | None, approve: bool, comment: str | None
) -> None:
    if budget.status != STATUS_PENDING_LEADERSHIP:
        raise HTTPException(status_code=400, detail="Budget is not pending leadership approval.")
    now = datetime.now(UTC)
    budget.leadership_decided_by = actor.id if actor else None
    budget.leadership_decided_at = now
    budget.leadership_comment = comment
    budget.leadership_token_hash = None
    budget.leadership_token_expires_at = None
    if approve:
        budget.leadership_decision = "approved"
        budget.status = STATUS_APPROVED
        # Roll the approved amount onto the project master.
        project.approved_budget = budget.amount
        project.currency = budget.currency
        db.add(project)
        log_budget_action(
            db, budget=budget, actor=actor, action="leadership_approved", stage="leadership",
            from_status=STATUS_PENDING_LEADERSHIP, to_status=STATUS_APPROVED, comment=comment,
        )
        _notify_proposer(db, budget=budget, project=project, title="Budget approved", outcome="fully approved", comment=comment)
    else:
        budget.leadership_decision = "rejected"
        budget.status = STATUS_REJECTED
        log_budget_action(
            db, budget=budget, actor=actor, action="leadership_rejected", stage="leadership",
            from_status=STATUS_PENDING_LEADERSHIP, to_status=STATUS_REJECTED, comment=comment,
        )
        _notify_proposer(db, budget=budget, project=project, title="Budget rejected", outcome="rejected at leadership review", comment=comment)


def _notify_proposer(
    db: Session, *, budget: ProjectBudget, project: Project, title: str, outcome: str, comment: str | None
) -> None:
    if not budget.proposed_by:
        return
    msg = f"Your {budget.currency} {budget.amount:,.2f} budget for '{project.internal_name}' was {outcome}."
    if comment:
        msg += f" Remark: {comment}"
    create_notification(
        db,
        user_id=budget.proposed_by,
        title=title,
        message=msg,
        type_=NotificationType.SUCCESS if "approved" in outcome else NotificationType.WARNING,
        entity_type="project_budget",
        entity_id=budget.id,
        payload={"projectId": project.id, "budgetId": budget.id},
    )


# --------------------------------------------------------------------------- #
# SLA escalation sweep
# --------------------------------------------------------------------------- #
def run_escalation_sweep(db: Session) -> dict[str, int]:
    """Notify stakeholders (in-app) for budgets stuck past the configured SLA.

    Idempotent enough to run on a cron: it re-notifies each sweep, which is the
    intended 'nudge' behaviour. Returns counts for observability.
    """
    sla = get_sla_config(db)
    cutoff = datetime.now(UTC) - timedelta(hours=sla["budgetApprovalSlaHours"])
    pending = list(
        db.scalars(
            select(ProjectBudget).where(
                ProjectBudget.status.in_([STATUS_PENDING_FUNCTIONAL, STATUS_PENDING_LEADERSHIP]),
                ProjectBudget.submitted_at.isnot(None),
                ProjectBudget.submitted_at < cutoff,
            )
        )
    )
    escalated = 0
    for budget in pending:
        project = db.get(Project, budget.project_id)
        if project is None:
            continue
        stage = "functional (CTO/COO)" if budget.status == STATUS_PENDING_FUNCTIONAL else "leadership"
        recipients: set[str] = set()
        if budget.proposed_by:
            recipients.add(budget.proposed_by)
        if project.tpm_user_id:
            recipients.add(project.tpm_user_id)
        for lead in db.scalars(select(ProjectLead).where(ProjectLead.project_id == project.id)):
            recipients.add(lead.user_id)
        if budget.status == STATUS_PENDING_FUNCTIONAL and budget.functional_approver_id:
            recipients.add(budget.functional_approver_id)
        for leader in leadership_users(db):
            recipients.add(leader.id)
        for user in db.scalars(select(User).where(User.role.in_([Role.ADMIN, Role.SUPER_ADMIN]), User.is_active.is_(True))):
            recipients.add(user.id)
        for user_id in recipients:
            create_notification(
                db,
                user_id=user_id,
                title="Budget approval overdue (SLA breach)",
                message=(
                    f"Budget {budget.currency} {budget.amount:,.2f} for '{project.internal_name}' "
                    f"has been pending {stage} approval beyond the {sla['budgetApprovalSlaHours']}h SLA."
                ),
                type_=NotificationType.WARNING,
                entity_type="project_budget",
                entity_id=budget.id,
                payload={"projectId": project.id, "budgetId": budget.id, "escalation": True},
            )
        escalated += 1
    return {"pending": len(pending), "escalated": escalated}
