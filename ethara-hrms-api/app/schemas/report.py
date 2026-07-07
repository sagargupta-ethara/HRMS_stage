from pydantic import Field

from app.schemas.common import ORMModel


class DashboardSummaryResponse(ORMModel):
    total_candidates: int = Field(alias="totalCandidates")
    this_month: int = Field(alias="thisMonth")
    joined: int
    active_escalations: int = Field(alias="activeEscalations")
    pending_evaluations: int = Field(alias="pendingEvaluations")
    stage_breakdown: list[dict] = Field(alias="stageBreakdown")
    source_breakdown: list[dict] = Field(alias="sourceBreakdown")
