"""documenso_integration

Revision ID: a3c1d9e7f820
Revises: f4c3b2a1d9e8
Create Date: 2026-05-15 12:00:00.000000

Adds:
- documenso_template_cache
- documenso_sync_state
- documenso_sync_logs
- documenso_contract_fields
- contracts.templateId
- contracts.pdfUrl
- contracts.pdfStorageKey
- index on contracts.documensoId
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3c1d9e7f820"
down_revision: str = "ca152206751b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "documenso_template_cache",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("templateId", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("fields", sa.JSON(), nullable=True),
        sa.Column("recipients", sa.JSON(), nullable=True),
        sa.Column("syncedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_documenso_template_cache_templateId",
        "documenso_template_cache",
        ["templateId"],
        unique=True,
    )

    op.create_table(
        "documenso_sync_state",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("lastSyncedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lastDocumentId", sa.Integer(), nullable=True),
        sa.Column("syncStatus", sa.String(50), nullable=False, server_default="idle"),
        sa.Column("errorMessage", sa.Text(), nullable=True),
        sa.Column("documentsProcessed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "documenso_sync_logs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("logType", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("documentId", sa.Integer(), nullable=True),
        sa.Column(
            "candidateId",
            sa.String(32),
            sa.ForeignKey("candidates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("extra", sa.JSON(), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_documenso_sync_logs_logType", "documenso_sync_logs", ["logType"])
    op.create_index("ix_documenso_sync_logs_status", "documenso_sync_logs", ["status"])
    op.create_index("ix_documenso_sync_logs_documentId", "documenso_sync_logs", ["documentId"])
    op.create_index("ix_documenso_sync_logs_candidateId", "documenso_sync_logs", ["candidateId"])
    op.create_index("ix_documenso_sync_logs_createdAt", "documenso_sync_logs", ["createdAt"])

    op.create_table(
        "documenso_contract_fields",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "contractId",
            sa.String(32),
            sa.ForeignKey("contracts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "candidateId",
            sa.String(32),
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("fieldName", sa.String(255), nullable=False),
        sa.Column("fieldType", sa.String(100), nullable=False),
        sa.Column("fieldValue", sa.Text(), nullable=True),
        sa.Column("recipientEmail", sa.String(255), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_documenso_contract_fields_contractId",
        "documenso_contract_fields",
        ["contractId"],
    )
    op.create_index(
        "ix_documenso_contract_fields_candidateId",
        "documenso_contract_fields",
        ["candidateId"],
    )

    op.add_column("contracts", sa.Column("templateId", sa.Integer(), nullable=True))
    op.add_column("contracts", sa.Column("pdfUrl", sa.String(500), nullable=True))
    op.add_column("contracts", sa.Column("pdfStorageKey", sa.String(500), nullable=True))

    op.create_index(
        "ix_contracts_documensoId",
        "contracts",
        ["documensoId"],
    )


def downgrade() -> None:
    op.drop_index("ix_contracts_documensoId", table_name="contracts")
    op.drop_column("contracts", "pdfStorageKey")
    op.drop_column("contracts", "pdfUrl")
    op.drop_column("contracts", "templateId")

    op.drop_table("documenso_contract_fields")
    op.drop_table("documenso_sync_logs")
    op.drop_table("documenso_sync_state")
    op.drop_table("documenso_template_cache")
