from enum import StrEnum

from app.db.models import Role


class Permission(StrEnum):
    AUTHENTICATED = "authenticated"
    CANDIDATES_READ = "candidates:read"
    CANDIDATES_WRITE = "candidates:write"
    REPORTS_READ = "reports:read"
    POSITIONS_READ = "positions:read"
    POSITIONS_WRITE = "positions:write"
    VENDORS_READ = "vendors:read"
    VENDORS_WRITE = "vendors:write"
    COLLEGES_READ = "colleges:read"
    COLLEGES_WRITE = "colleges:write"
    USERS_READ = "users:read"
    USERS_WRITE = "users:write"
    ESCALATIONS_READ = "escalations:read"
    ESCALATIONS_WRITE = "escalations:write"
    NOTIFICATIONS_READ = "notifications:read"
    NOTIFICATIONS_WRITE = "notifications:write"
    DOCUMENTS_READ = "documents:read"
    DOCUMENTS_WRITE = "documents:write"
    IT_REQUESTS_READ = "it_requests:read"
    IT_REQUESTS_WRITE = "it_requests:write"
    AUDIT_LOGS_READ = "audit_logs:read"
    EVALUATIONS_READ = "evaluations:read"
    EVALUATIONS_WRITE = "evaluations:write"
    SELECTION_FORMS_READ = "selection_forms:read"
    SELECTION_FORMS_WRITE = "selection_forms:write"
    CONTRACTS_READ = "contracts:read"
    CONTRACTS_WRITE = "contracts:write"
    COMPLIANCE_READ = "compliance:read"
    COMPLIANCE_WRITE = "compliance:write"
    SETTINGS_READ = "settings:read"
    SETTINGS_WRITE = "settings:write"
    SCREENING_RUN = "screening:run"
    LEAVE_READ = "leave:read"
    LEAVE_WRITE = "leave:write"
    LEAVE_APPROVE = "leave:approve"
    ATTENDANCE_READ = "attendance:read"
    ATTENDANCE_WRITE = "attendance:write"
    REIMBURSEMENTS_READ = "reimbursements:read"
    REIMBURSEMENTS_WRITE = "reimbursements:write"
    REIMBURSEMENTS_REVIEW = "reimbursements:review"
    REIMBURSEMENTS_ADMIN = "reimbursements:admin"
    DINNER_REQUESTS_READ = "dinner_requests:read"
    DINNER_REQUESTS_WRITE = "dinner_requests:write"
    DINNER_REQUESTS_REVIEW = "dinner_requests:review"
    ASSETS_READ = "assets:read"
    ASSETS_WRITE = "assets:write"
    TEAM_READ = "team:read"
    OFFBOARDING_WRITE = "offboarding:write"
    EMPLOYEES_READ = "employees:read"
    EMPLOYEES_WRITE = "employees:write"
    ASSESSMENT_PLATFORM_READ = "assessment_platform:read"
    ASSESSMENT_PLATFORM_MANAGE = "assessment_platform:manage"
    ASSESSMENT_PLATFORM_GRADE = "assessment_platform:grade"
    RESOURCE_SEGREGATION_READ = "resource_segregation:read"
    RESOURCE_SEGREGATION_WRITE = "resource_segregation:write"
    BANK_VERIFICATION_READ = "bank_verification:read"
    BANK_VERIFICATION_WRITE = "bank_verification:write"
    # Project Governance & Budget Management
    PROJECTS_READ = "projects:read"
    PROJECTS_CREATE = "projects:create"
    PROJECTS_WRITE = "projects:write"
    PROJECTS_ADMIN = "projects:admin"
    PROJECTS_BUDGET_PROPOSE = "projects:budget_propose"
    PROJECTS_BUDGET_APPROVE_FUNCTIONAL = "projects:budget_approve_functional"
    PROJECTS_BUDGET_APPROVE_LEADERSHIP = "projects:budget_approve_leadership"


ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.SUPER_ADMIN: set(Permission),
    Role.LEADERSHIP: set(Permission),
    Role.ADMIN: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.CANDIDATES_WRITE,
        Permission.REPORTS_READ,
        Permission.POSITIONS_READ,
        Permission.POSITIONS_WRITE,
        Permission.VENDORS_READ,
        Permission.VENDORS_WRITE,
        Permission.COLLEGES_READ,
        Permission.COLLEGES_WRITE,
        Permission.USERS_READ,
        Permission.USERS_WRITE,
        Permission.ESCALATIONS_READ,
        Permission.ESCALATIONS_WRITE,
        Permission.NOTIFICATIONS_READ,
        Permission.NOTIFICATIONS_WRITE,
        Permission.DOCUMENTS_READ,
        Permission.DOCUMENTS_WRITE,
        Permission.IT_REQUESTS_READ,
        Permission.IT_REQUESTS_WRITE,
        Permission.AUDIT_LOGS_READ,
        Permission.EVALUATIONS_READ,
        Permission.EVALUATIONS_WRITE,
        Permission.SELECTION_FORMS_READ,
        Permission.SELECTION_FORMS_WRITE,
        Permission.CONTRACTS_READ,
        Permission.CONTRACTS_WRITE,
        Permission.COMPLIANCE_READ,
        Permission.COMPLIANCE_WRITE,
        Permission.SETTINGS_READ,
        Permission.SETTINGS_WRITE,
        Permission.SCREENING_RUN,
        Permission.LEAVE_READ,
        Permission.LEAVE_WRITE,
        Permission.LEAVE_APPROVE,
        Permission.ATTENDANCE_READ,
        Permission.ATTENDANCE_WRITE,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.REIMBURSEMENTS_REVIEW,
        Permission.REIMBURSEMENTS_ADMIN,
        Permission.DINNER_REQUESTS_READ,
        Permission.DINNER_REQUESTS_WRITE,
        Permission.DINNER_REQUESTS_REVIEW,
        Permission.ASSETS_READ,
        Permission.ASSETS_WRITE,
        Permission.TEAM_READ,
        Permission.OFFBOARDING_WRITE,
        Permission.EMPLOYEES_READ,
        Permission.EMPLOYEES_WRITE,
        Permission.ASSESSMENT_PLATFORM_READ,
        Permission.ASSESSMENT_PLATFORM_MANAGE,
        Permission.ASSESSMENT_PLATFORM_GRADE,
        Permission.RESOURCE_SEGREGATION_READ,
        Permission.RESOURCE_SEGREGATION_WRITE,
        Permission.BANK_VERIFICATION_READ,
        Permission.BANK_VERIFICATION_WRITE,
        Permission.PROJECTS_READ,
        Permission.PROJECTS_CREATE,
        Permission.PROJECTS_WRITE,
        Permission.PROJECTS_ADMIN,
        Permission.PROJECTS_BUDGET_PROPOSE,
        Permission.PROJECTS_BUDGET_APPROVE_FUNCTIONAL,
        Permission.PROJECTS_BUDGET_APPROVE_LEADERSHIP,
    },
    Role.HR: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.CANDIDATES_WRITE,
        Permission.REPORTS_READ,
        Permission.POSITIONS_READ,
        Permission.POSITIONS_WRITE,
        Permission.VENDORS_READ,
        Permission.COLLEGES_READ,
        Permission.USERS_READ,
        Permission.ESCALATIONS_READ,
        Permission.ESCALATIONS_WRITE,
        Permission.NOTIFICATIONS_READ,
        Permission.NOTIFICATIONS_WRITE,
        Permission.DOCUMENTS_READ,
        Permission.DOCUMENTS_WRITE,
        Permission.IT_REQUESTS_READ,
        Permission.IT_REQUESTS_WRITE,
        Permission.AUDIT_LOGS_READ,
        Permission.EVALUATIONS_READ,
        Permission.EVALUATIONS_WRITE,
        Permission.SELECTION_FORMS_READ,
        Permission.SELECTION_FORMS_WRITE,
        Permission.CONTRACTS_READ,
        Permission.CONTRACTS_WRITE,
        Permission.COMPLIANCE_READ,
        Permission.COMPLIANCE_WRITE,
        Permission.SETTINGS_READ,
        Permission.SCREENING_RUN,
        Permission.LEAVE_READ,
        Permission.LEAVE_WRITE,
        Permission.LEAVE_APPROVE,
        Permission.ATTENDANCE_READ,
        Permission.ATTENDANCE_WRITE,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.REIMBURSEMENTS_REVIEW,
        Permission.DINNER_REQUESTS_READ,
        Permission.DINNER_REQUESTS_WRITE,
        Permission.DINNER_REQUESTS_REVIEW,
        Permission.ASSETS_READ,
        Permission.EMPLOYEES_READ,
        Permission.EMPLOYEES_WRITE,
        Permission.OFFBOARDING_WRITE,
        Permission.TEAM_READ,
        Permission.ASSESSMENT_PLATFORM_READ,
        Permission.ASSESSMENT_PLATFORM_MANAGE,
        Permission.ASSESSMENT_PLATFORM_GRADE,
        # HR sees the Resource Segregation board read-only (writes stay with
        # managers / PL-TPM / admins).
        Permission.RESOURCE_SEGREGATION_READ,
        Permission.BANK_VERIFICATION_READ,
        Permission.PROJECTS_READ,
    },
    Role.TA: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.CANDIDATES_WRITE,
        Permission.REPORTS_READ,
        Permission.POSITIONS_READ,
        Permission.POSITIONS_WRITE,
        Permission.VENDORS_READ,
        Permission.COLLEGES_READ,
        Permission.USERS_READ,
        Permission.ESCALATIONS_READ,
        Permission.ESCALATIONS_WRITE,
        Permission.NOTIFICATIONS_READ,
        Permission.NOTIFICATIONS_WRITE,
        Permission.DOCUMENTS_READ,
        Permission.DOCUMENTS_WRITE,
        Permission.IT_REQUESTS_READ,
        Permission.IT_REQUESTS_WRITE,
        Permission.AUDIT_LOGS_READ,
        Permission.EVALUATIONS_READ,
        Permission.EVALUATIONS_WRITE,
        Permission.SELECTION_FORMS_READ,
        Permission.SELECTION_FORMS_WRITE,
        Permission.CONTRACTS_READ,
        Permission.CONTRACTS_WRITE,
        Permission.COMPLIANCE_READ,
        Permission.COMPLIANCE_WRITE,
        Permission.SCREENING_RUN,
        Permission.LEAVE_READ,
        Permission.LEAVE_WRITE,
        Permission.LEAVE_APPROVE,
        Permission.ATTENDANCE_READ,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.ASSETS_READ,
        Permission.EMPLOYEES_READ,
        Permission.EMPLOYEES_WRITE,
        Permission.OFFBOARDING_WRITE,
        Permission.TEAM_READ,
        Permission.ASSESSMENT_PLATFORM_READ,
        Permission.ASSESSMENT_PLATFORM_MANAGE,
        Permission.ASSESSMENT_PLATFORM_GRADE,
    },
    Role.EMPLOYEE: {
        Permission.AUTHENTICATED,
        Permission.NOTIFICATIONS_READ,
        Permission.POSITIONS_READ,
        Permission.LEAVE_READ,
        Permission.LEAVE_WRITE,
        Permission.ATTENDANCE_READ,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.RESOURCE_SEGREGATION_READ,
    },
    Role.VENDOR: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.CANDIDATES_WRITE,
        Permission.POSITIONS_READ,
        Permission.VENDORS_READ,
        Permission.NOTIFICATIONS_READ,
        Permission.DOCUMENTS_READ,
        Permission.SELECTION_FORMS_READ,
    },
    Role.EMPLOYEE_REFERRER: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.CANDIDATES_WRITE,
        Permission.POSITIONS_READ,
        Permission.NOTIFICATIONS_READ,
        # Referrers are employees first — they apply for leave like any employee.
        Permission.LEAVE_READ,
        Permission.LEAVE_WRITE,
        Permission.ATTENDANCE_READ,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.RESOURCE_SEGREGATION_READ,
    },
    Role.EVALUATOR: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.POSITIONS_READ,
        Permission.USERS_READ,
        Permission.NOTIFICATIONS_READ,
        Permission.EVALUATIONS_READ,
        Permission.EVALUATIONS_WRITE,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.ATTENDANCE_READ,
        Permission.ASSESSMENT_PLATFORM_READ,
        Permission.ASSESSMENT_PLATFORM_GRADE,
    },
    Role.IT_TEAM: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.NOTIFICATIONS_READ,
        Permission.ESCALATIONS_READ,
        Permission.IT_REQUESTS_READ,
        Permission.IT_REQUESTS_WRITE,
        Permission.DOCUMENTS_READ,
        Permission.ASSETS_READ,
        Permission.ASSETS_WRITE,
        Permission.EMPLOYEES_READ,
        Permission.EMPLOYEES_WRITE,
        Permission.OFFBOARDING_WRITE,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.ATTENDANCE_READ,
        # IT team's nav includes the Settings page (read-only; writes stay admin).
        Permission.SETTINGS_READ,
    },
    Role.COMPLIANCE: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.NOTIFICATIONS_READ,
        Permission.DOCUMENTS_READ,
        Permission.COMPLIANCE_READ,
        Permission.COMPLIANCE_WRITE,
        Permission.AUDIT_LOGS_READ,
        Permission.EMPLOYEES_READ,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.ATTENDANCE_READ,
    },
    Role.CANDIDATE: {
        Permission.AUTHENTICATED,
        Permission.NOTIFICATIONS_READ,
        Permission.DOCUMENTS_READ,
        Permission.DOCUMENTS_WRITE,
        Permission.SELECTION_FORMS_READ,
        Permission.SELECTION_FORMS_WRITE,
        Permission.CONTRACTS_READ,
        Permission.COMPLIANCE_READ,
        Permission.COMPLIANCE_WRITE,
    },
    Role.MANAGER: {
        Permission.AUTHENTICATED,
        Permission.NOTIFICATIONS_READ,
        Permission.NOTIFICATIONS_WRITE,
        Permission.EMPLOYEES_READ,
        Permission.TEAM_READ,
        Permission.LEAVE_READ,
        Permission.LEAVE_APPROVE,
        Permission.ATTENDANCE_READ,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.REIMBURSEMENTS_REVIEW,
        Permission.DINNER_REQUESTS_READ,
        Permission.DINNER_REQUESTS_WRITE,
        Permission.DOCUMENTS_READ,
        Permission.AUDIT_LOGS_READ,
        Permission.RESOURCE_SEGREGATION_READ,
        Permission.RESOURCE_SEGREGATION_WRITE,
        # Project Governance — Managers create & own projects (scoped to their own).
        Permission.PROJECTS_READ,
        Permission.PROJECTS_CREATE,
        Permission.PROJECTS_WRITE,
        Permission.PROJECTS_BUDGET_PROPOSE,
    },
    Role.OFFICE_ADMIN: {
        Permission.AUTHENTICATED,
        Permission.CANDIDATES_READ,
        Permission.NOTIFICATIONS_READ,
        Permission.NOTIFICATIONS_WRITE,
        Permission.EMPLOYEES_READ,
        Permission.ASSETS_READ,
        Permission.OFFBOARDING_WRITE,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.REIMBURSEMENTS_REVIEW,
        Permission.DINNER_REQUESTS_READ,
        Permission.DINNER_REQUESTS_WRITE,
        Permission.DINNER_REQUESTS_REVIEW,
        Permission.ATTENDANCE_READ,
        Permission.AUDIT_LOGS_READ,
        Permission.BANK_VERIFICATION_READ,
        Permission.BANK_VERIFICATION_WRITE,
        Permission.PROJECTS_READ,
    },
    Role.PL_TPM: {
        Permission.AUTHENTICATED,
        Permission.NOTIFICATIONS_READ,
        Permission.NOTIFICATIONS_WRITE,
        Permission.DINNER_REQUESTS_READ,
        Permission.DINNER_REQUESTS_WRITE,
        Permission.REIMBURSEMENTS_READ,
        Permission.REIMBURSEMENTS_WRITE,
        Permission.RESOURCE_SEGREGATION_READ,
        Permission.RESOURCE_SEGREGATION_WRITE,
        # Project Governance — PL views ONLY assigned projects and may propose
        # budgets / request approval. PLs do NOT create or edit projects (the
        # Manager creates the project).
        Permission.PROJECTS_READ,
        Permission.PROJECTS_BUDGET_PROPOSE,
    },
}


def permissions_for_role(role: Role) -> set[Permission]:
    return ROLE_PERMISSIONS.get(role, {Permission.AUTHENTICATED})
