"""Canonical module registry + path→module resolution for role-based module access.

Admins/super-admins always have full access (never gated). For every other role, an
admin can enable/disable modules; disabled modules are hidden in the nav AND blocked
at the API by ModuleAccessMiddleware. Modules with empty `segments` are nav-only
(filtered in the sidebar but not API-gated, because they have no dedicated route prefix).
"""

from __future__ import annotations

MODULE_REGISTRY: list[dict] = [
    {"key": "dashboard", "label": "Dashboard", "segments": []},
    {"key": "applications", "label": "Applications", "segments": ["applications"]},
    {"key": "candidates", "label": "Candidates", "segments": ["candidates"]},
    {"key": "employees", "label": "Employees", "segments": ["employees"]},
    {"key": "screening", "label": "Resume Screening", "segments": []},
    {"key": "assessment_platform", "label": "Assessment Platform", "segments": ["assessment-platform"]},
    {"key": "evaluations", "label": "Evaluations", "segments": ["evaluations"]},
    {"key": "pms", "label": "PMS Evaluation", "segments": ["pms-evaluations"]},
    {"key": "employee_evaluation", "label": "Employee Evaluation", "segments": ["employee-evaluation"]},
    {"key": "selection_forms", "label": "Selection Forms", "segments": ["selection-forms"]},
    {"key": "contracts", "label": "Contracts", "segments": []},
    {"key": "manager_mapping", "label": "Manager Mapping", "segments": ["manager"]},
    {"key": "leave", "label": "Leave Management", "segments": ["leave"]},
    {"key": "attendance", "label": "Attendance Management", "segments": ["attendance"]},
    {"key": "resource_segregation", "label": "Resource Segregation", "segments": ["resource-segregation"]},
    {"key": "projects", "label": "Project Governance", "segments": ["projects"]},
    {"key": "skill_tags", "label": "Skill Tags", "segments": ["skills"]},
    {"key": "reimbursements", "label": "Reimbursement Requests", "segments": ["reimbursements"]},
    {"key": "dinner_requests", "label": "Dinner Requests", "segments": ["dinner-requests"]},
    {"key": "it_assets", "label": "IT Assets", "segments": ["assets"]},
    {"key": "it_requests", "label": "IT Requests", "segments": ["it-requests"]},
    {"key": "compliance", "label": "Compliance", "segments": []},
    {"key": "separation", "label": "Separation", "segments": ["separation"]},
    {"key": "reports", "label": "Reports", "segments": ["reports"]},
    {"key": "positions", "label": "Positions", "segments": ["positions"]},
    {"key": "vendors", "label": "Vendors", "segments": ["vendors"]},
    {"key": "colleges", "label": "Colleges", "segments": ["colleges"]},
    {"key": "users", "label": "Users & Roles", "segments": ["users"]},
    {"key": "settings", "label": "Settings", "segments": ["settings"]},
    {"key": "documents", "label": "Documents", "segments": ["documents"]},
    {"key": "bank_verification", "label": "Penny Drop / Bank Verification", "segments": ["bank-verification"]},
]

ALL_MODULE_KEYS: list[str] = [m["key"] for m in MODULE_REGISTRY]

# Roles that always have full access (never gated, can't be locked out).
FULL_ACCESS_ROLES = frozenset({"admin", "super_admin"})

# Path segments that are NEVER gated by module access.
_EXEMPT_SEGMENTS = frozenset({"auth", "notifications", "public", "role-modules"})

# Public/self-service employee helpers that live under /employees but are not
# staff employee-record APIs. Route-level permissions still protect writes.
_EXEMPT_PATHS = frozenset(
    {
        "employees/check-duplicate",
        "employees/reference-options",
        "employees/aadhaar/ocr",
        "employees/pan/ocr",
        "employees/cheque/ocr",
        "employees/address/ocr",
        "employees/register",
        "employees/verify-email",
        "employees/resend-verification",
        "candidates/campus/config",
        "candidates/campus/register",
        "candidates/campus/complete",
        # Project dropdown options for expense forms — any authenticated user
        # raising a reimbursement/dinner needs the active-project list.
        "projects/options",
    }
)

_SEGMENT_TO_MODULE: dict[str, str] = {
    segment: module["key"]
    for module in MODULE_REGISTRY
    for segment in module["segments"]
}

# Per-role DEFAULT modules — mirrors each role's existing navigation (what they saw
# "before" module access existed). Admin/super_admin get everything. This is the
# matrix's pre-checked state for an unconfigured role; enforcement only kicks in once
# an admin explicitly SAVES a config for the role (see ModuleAccessMiddleware).
DEFAULT_ROLE_MODULES: dict[str, list[str]] = {
    "super_admin": list(ALL_MODULE_KEYS),
    "admin": list(ALL_MODULE_KEYS),
    "leadership": list(ALL_MODULE_KEYS),
    "hr": ["dashboard", "applications", "candidates", "employees", "screening",
           "assessment_platform", "evaluations", "pms", "selection_forms", "documents", "contracts",
           "positions", "vendors", "colleges", "reports", "it_requests",
           "manager_mapping", "leave", "attendance", "reimbursements", "dinner_requests", "compliance",
           "projects", "skill_tags", "employee_evaluation", "separation", "settings", "bank_verification"],
    "ta": ["dashboard", "applications", "candidates", "employees", "screening",
           "assessment_platform", "evaluations", "selection_forms", "documents", "contracts", "positions",
           "vendors", "colleges", "reports", "it_requests",
           "manager_mapping", "leave", "attendance", "reimbursements", "compliance", "skill_tags", "separation"],
    "evaluator": ["dashboard", "assessment_platform", "evaluations", "candidates", "positions", "attendance", "reimbursements", "employee_evaluation"],
    "it_team": ["dashboard", "candidates", "it_requests", "it_assets", "employees", "documents", "attendance", "reimbursements", "separation", "settings"],
    "compliance": ["dashboard", "candidates", "employees", "documents", "compliance", "attendance", "reimbursements"],
    "manager": ["dashboard", "employees", "leave", "attendance", "projects", "skill_tags", "reimbursements", "dinner_requests", "separation"],
    "office_admin": ["dashboard", "candidates", "employees", "attendance", "it_assets", "projects", "reimbursements", "dinner_requests", "separation", "bank_verification"],
    "pl_tpm": ["dashboard", "projects", "dinner_requests", "reimbursements"],
    "vendor": ["dashboard", "candidates", "positions"],
    "employee": ["dashboard", "selection_forms", "leave", "attendance", "projects", "skill_tags", "reimbursements", "documents", "contracts", "compliance", "separation"],
    "employee_referrer": ["dashboard", "selection_forms", "leave", "attendance", "projects", "skill_tags", "reimbursements", "documents", "contracts", "compliance", "separation"],
    "candidate": ["dashboard", "documents", "selection_forms", "assessment_platform", "contracts", "compliance"],
}


def default_modules_for_role(role: str) -> list[str]:
    return DEFAULT_ROLE_MODULES.get(role, list(ALL_MODULE_KEYS))


def module_for_path(path: str, api_prefix: str) -> str | None:
    """Return the module key that owns this API path, or None if it isn't gated."""
    if api_prefix and path.startswith(api_prefix):
        rest = path[len(api_prefix):]
    else:
        rest = path
    rest = rest.lstrip("/")
    if not rest:
        return None
    normalized_path = rest.rstrip("/")
    if normalized_path in _EXEMPT_PATHS:
        return None
    parts = rest.split("/")
    segment = parts[0]
    if segment in _EXEMPT_SEGMENTS:
        return None
    # Self-service routes (/<segment>/me/...) are governed by record ownership, not
    # module access — never gate them, so portal users never get locked out.
    if len(parts) > 1 and parts[1] == "me":
        return None
    return _SEGMENT_TO_MODULE.get(segment)
