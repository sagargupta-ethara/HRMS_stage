"""Pydantic schemas for the Project Governance & Budget Management module.

Request bodies accept camelCase (via field aliases) to match the frontend, and
also snake_case (populate_by_name). Responses are built as plain dicts in the
route layer (see app/api/routes/projects.py), mirroring the reimbursements module.
"""

from __future__ import annotations

from datetime import date

from pydantic import Field

from app.schemas.common import ORMModel


class ProjectLeadInput(ORMModel):
    user_id: str = Field(alias="userId")
    role: str = "pl"  # tpm | pl


class ProjectBase(ORMModel):
    internal_name: str | None = Field(alias="internalName", default=None)
    external_name: str | None = Field(alias="externalName", default=None)
    client: str | None = None
    platform: str | None = None
    project_type: str | None = Field(alias="projectType", default=None)  # technical | generalist
    rfp_status: str | None = Field(alias="rfpStatus", default=None)  # rfp | production | delivered
    delivery_status: str | None = Field(alias="deliveryStatus", default=None)  # ongoing | completed
    appsheet_approval: str | None = Field(alias="appsheetApproval", default=None)
    trajectory_cost_approval: str | None = Field(alias="trajectoryCostApproval", default=None)
    aht: float | None = None
    target_volume: int | None = Field(alias="targetVolume", default=None)
    delivered_volume: int | None = Field(alias="deliveredVolume", default=None)
    date_of_delivery: date | None = Field(alias="dateOfDelivery", default=None)
    tpm_user_id: str | None = Field(alias="tpmUserId", default=None)
    fte_demand: int | None = Field(alias="fteDemand", default=None)
    fte_count: int | None = Field(alias="fteCount", default=None)
    intern_count: int | None = Field(alias="internCount", default=None)
    total_members: int | None = Field(alias="totalMembers", default=None)
    approved_budget: float | None = Field(alias="approvedBudget", default=None)
    consumed_budget: float | None = Field(alias="consumedBudget", default=None)
    currency: str | None = None
    notes: str | None = None
    custom_fields: dict | None = Field(alias="customFields", default=None)
    # PL/TPM ownership; the creator is auto-added as a lead by the service.
    lead_user_ids: list[str] | None = Field(alias="leadUserIds", default=None)
    leads: list[ProjectLeadInput] | None = None


class ProjectCreate(ProjectBase):
    internal_name: str = Field(alias="internalName")
    project_type: str = Field(alias="projectType", default="technical")


class ProjectUpdate(ProjectBase):
    pass


class FieldDefCreate(ORMModel):
    key: str | None = None  # auto-slugged from label when omitted
    label: str
    data_type: str = Field(alias="dataType", default="text")
    options: list[str] = Field(default_factory=list)
    group: str | None = None
    order_index: int | None = Field(alias="orderIndex", default=None)


class FieldDefUpdate(ORMModel):
    label: str | None = None
    data_type: str | None = Field(alias="dataType", default=None)
    options: list[str] | None = None
    group: str | None = None
    order_index: int | None = Field(alias="orderIndex", default=None)
    is_active: bool | None = Field(alias="isActive", default=None)


class FieldDefReorder(ORMModel):
    ordered_ids: list[str] = Field(alias="orderedIds")


class BudgetCreate(ORMModel):
    amount: float
    currency: str = "INR"
    period: str | None = None
    justification: str | None = None


class BudgetUpdate(ORMModel):
    amount: float | None = None
    currency: str | None = None
    period: str | None = None
    justification: str | None = None


class BudgetDecision(ORMModel):
    action: str  # approve | reject
    comment: str | None = None


class ApproverConfigWrite(ORMModel):
    """Functional (stage-1) approver user ids by project type."""

    technical_user_id: str | None = Field(alias="technicalUserId", default=None)
    generalist_user_id: str | None = Field(alias="generalistUserId", default=None)


class SlaConfigWrite(ORMModel):
    budget_approval_sla_hours: int | None = Field(alias="budgetApprovalSlaHours", default=None)
    expense_approval_sla_hours: int | None = Field(alias="expenseApprovalSlaHours", default=None)
