from fastapi import APIRouter, Depends

from app.api.deps import enforce_module_access
from app.api.routes import (
    assessment_platform,
    assessment_templates,
    assessments,
    assets,
    attendance,
    auth,
    bank_verification,
    candidates,
    career_applications,
    config,
    dinner_requests,
    documenso,
    employee_evaluation,
    employees,
    leave,
    logs,
    manager,
    pms,
    projects,
    reimbursements,
    reports,
    resource_segregation,
    separation,
    skills,
    workflows,
)
from app.core.config import get_settings

settings = get_settings()

# Module-access enforcement runs as a router-level dependency (reuses the request's
# decoded auth + DB session) instead of a BaseHTTPMiddleware. See enforce_module_access.
api_router = APIRouter(prefix=settings.api_prefix, dependencies=[Depends(enforce_module_access)])
api_router.include_router(auth.router)
api_router.include_router(candidates.router)
api_router.include_router(career_applications.router)
api_router.include_router(employees.router)
api_router.include_router(reports.router)
api_router.include_router(logs.router)
api_router.include_router(config.router)
api_router.include_router(workflows.router)
api_router.include_router(documenso.router)
api_router.include_router(separation.router)
api_router.include_router(leave.router)
api_router.include_router(assets.router)
api_router.include_router(attendance.router)
api_router.include_router(manager.router)
api_router.include_router(assessments.router)
api_router.include_router(assessment_templates.router)
api_router.include_router(assessment_platform.router)
api_router.include_router(pms.router)
api_router.include_router(employee_evaluation.router)
api_router.include_router(reimbursements.router)
api_router.include_router(dinner_requests.router)
api_router.include_router(resource_segregation.router)
api_router.include_router(skills.router)
api_router.include_router(bank_verification.router)
api_router.include_router(projects.router)
api_router.include_router(projects.public_router)
