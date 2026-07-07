"""production_readiness_indexes

Add indexes for high-volume dashboard, document, notification, audit and workflow
queries. These are additive only and do not change application data.

Revision ID: c6d7e8f9a0b1
Revises: b3d4f6a8c2e1
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c6d7e8f9a0b1"
down_revision: str | None = "b3d4f6a8c2e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INDEXES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("ix_users_vendor_id", "users", ("vendor_id",)),
    ("ix_candidates_positionId", "candidates", ("positionId",)),
    ("ix_candidates_portalUserId", "candidates", ("portalUserId",)),
    ("ix_candidates_collegeId", "candidates", ("collegeId",)),
    ("ix_candidates_vendorId", "candidates", ("vendorId",)),
    ("ix_candidates_llm_status", "candidates", ("llm_status",)),
    ("ix_candidates_isRemoved_currentStage", "candidates", ("isRemoved", "currentStage")),
    ("ix_candidates_positionId_isRemoved", "candidates", ("positionId", "isRemoved")),
    ("ix_candidates_updated_at_isRemoved", "candidates", ("updated_at", "isRemoved")),
    ("ix_stage_logs_candidateId", "stage_logs", ("candidateId",)),
    ("ix_stage_logs_createdAt", "stage_logs", ("createdAt",)),
    ("ix_evaluations_candidateId", "evaluations", ("candidateId",)),
    ("ix_evaluations_evaluatorId", "evaluations", ("evaluatorId",)),
    ("ix_documents_candidateId", "documents", ("candidateId",)),
    ("ix_documents_status", "documents", ("status",)),
    ("ix_documents_created_at", "documents", ("created_at",)),
    ("ix_documents_candidateId_type", "documents", ("candidateId", "type")),
    ("ix_compliance_forms_candidateId", "compliance_forms", ("candidateId",)),
    ("ix_compliance_forms_status", "compliance_forms", ("status",)),
    ("ix_escalations_candidateId", "escalations", ("candidateId",)),
    ("ix_escalations_responsibleUserId", "escalations", ("responsibleUserId",)),
    ("ix_escalations_status", "escalations", ("status",)),
    ("ix_escalations_slaDeadline", "escalations", ("slaDeadline",)),
    ("ix_notifications_userId", "notifications", ("userId",)),
    ("ix_notifications_candidateId", "notifications", ("candidateId",)),
    ("ix_notifications_isRead", "notifications", ("isRead",)),
    ("ix_notifications_createdAt", "notifications", ("createdAt",)),
    ("ix_it_requests_assignedToId", "it_requests", ("assignedToId",)),
    ("ix_it_requests_status", "it_requests", ("status",)),
    ("ix_audit_logs_entityId", "audit_logs", ("entityId",)),
    ("ix_audit_logs_candidateId", "audit_logs", ("candidateId",)),
    ("ix_audit_logs_userId", "audit_logs", ("userId",)),
    ("ix_audit_logs_createdAt", "audit_logs", ("createdAt",)),
)


def _existing_indexes(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    seen: dict[str, set[str]] = {}
    for name, table_name, columns in INDEXES:
        existing = seen.setdefault(table_name, _existing_indexes(table_name))
        if name in existing:
            continue
        op.create_index(name, table_name, list(columns), unique=False)
        existing.add(name)


def downgrade() -> None:
    seen: dict[str, set[str]] = {}
    for name, table_name, _columns in reversed(INDEXES):
        existing = seen.setdefault(table_name, _existing_indexes(table_name))
        if name not in existing:
            continue
        op.drop_index(name, table_name=table_name)
        existing.discard(name)
