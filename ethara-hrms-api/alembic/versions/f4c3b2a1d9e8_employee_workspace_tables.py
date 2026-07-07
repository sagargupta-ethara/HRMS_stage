"""employee_workspace_tables

Revision ID: f4c3b2a1d9e8
Revises: e6f3a1b7c2d4
Create Date: 2026-05-13 20:10:00.000000
"""

from collections.abc import Sequence
from pathlib import Path
from uuid import uuid4

import sqlalchemy as sa
from alembic import op


revision: str = "f4c3b2a1d9e8"
down_revision: str | None = "e6f3a1b7c2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    contract_status_enum = sa.Enum(
        "draft",
        "sent",
        "viewed",
        "signed",
        "expired",
        name="contract_status",
        native_enum=False,
    )

    op.create_table(
        "employee_selection_forms",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("formData", sa.JSON(), nullable=True),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewedBy", sa.String(length=32), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"], name=op.f("fk_employee_selection_forms_employeeProfileId_employee_profiles")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_employee_selection_forms")),
        sa.UniqueConstraint("employeeProfileId", name=op.f("uq_employee_selection_forms_employeeProfileId")),
    )
    op.create_index(op.f("ix_employee_selection_forms_status"), "employee_selection_forms", ["status"], unique=False)

    op.create_table(
        "employee_documents",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("fileName", sa.String(length=255), nullable=False),
        sa.Column("fileUrl", sa.String(length=500), nullable=False),
        sa.Column("fileSize", sa.Integer(), nullable=True),
        sa.Column("mimeType", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("uploadedBy", sa.String(length=32), nullable=True),
        sa.Column("verifiedBy", sa.String(length=32), nullable=True),
        sa.Column("verifiedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"], name=op.f("fk_employee_documents_employeeProfileId_employee_profiles")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_employee_documents")),
    )
    op.create_index(op.f("ix_employee_documents_employeeProfileId"), "employee_documents", ["employeeProfileId"], unique=False)
    op.create_index(op.f("ix_employee_documents_status"), "employee_documents", ["status"], unique=False)
    op.create_index(op.f("ix_employee_documents_type"), "employee_documents", ["type"], unique=False)

    op.create_table(
        "employee_contracts",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", contract_status_enum, nullable=False),
        sa.Column("fileName", sa.String(length=255), nullable=True),
        sa.Column("fileUrl", sa.String(length=500), nullable=True),
        sa.Column("mimeType", sa.String(length=255), nullable=True),
        sa.Column("issuedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("uploadedBy", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"], name=op.f("fk_employee_contracts_employeeProfileId_employee_profiles")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_employee_contracts")),
    )
    op.create_index(op.f("ix_employee_contracts_employeeProfileId"), "employee_contracts", ["employeeProfileId"], unique=False)

    op.create_table(
        "employee_compliance_forms",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("employeeProfileId", sa.String(length=32), nullable=False),
        sa.Column("formType", sa.String(length=50), nullable=False),
        sa.Column("formTitle", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("formData", sa.JSON(), nullable=True),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verifiedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewedBy", sa.String(length=32), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["employeeProfileId"], ["employee_profiles.id"], name=op.f("fk_employee_compliance_forms_employeeProfileId_employee_profiles")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_employee_compliance_forms")),
    )
    op.create_index(op.f("ix_employee_compliance_forms_employeeProfileId"), "employee_compliance_forms", ["employeeProfileId"], unique=False)
    op.create_index(op.f("ix_employee_compliance_forms_formType"), "employee_compliance_forms", ["formType"], unique=False)
    op.create_index(op.f("ix_employee_compliance_forms_status"), "employee_compliance_forms", ["status"], unique=False)

    bind = op.get_bind()
    metadata = sa.MetaData()
    employee_profiles = sa.Table("employee_profiles", metadata, autoload_with=bind)
    employee_documents = sa.Table("employee_documents", metadata, autoload_with=bind)

    rows = bind.execute(
        sa.select(
            employee_profiles.c.id,
            employee_profiles.c.userId,
            employee_profiles.c.resumePath,
            employee_profiles.c.aadhaarPath,
            employee_profiles.c.aadhaarOcrStatus,
            employee_profiles.c.created_at,
            employee_profiles.c.updated_at,
        )
    ).mappings()

    for row in rows:
        for document_type, path_value, status_value, remarks in [
            (
                "resume",
                row["resumePath"],
                "uploaded" if row["resumePath"] else None,
                "Backfilled from legacy employee profile resume path.",
            ),
            (
                "aadhaar",
                row["aadhaarPath"],
                row["aadhaarOcrStatus"] or ("uploaded" if row["aadhaarPath"] else None),
                "Backfilled from legacy employee profile Aadhaar path.",
            ),
        ]:
            if not path_value:
                continue
            bind.execute(
                employee_documents.insert().values(
                    id=uuid4().hex,
                    employeeProfileId=row["id"],
                    type=document_type,
                    fileName=Path(path_value).name or f"{document_type}.bin",
                    fileUrl=path_value,
                    fileSize=None,
                    mimeType=None,
                    status=status_value or "uploaded",
                    remarks=remarks,
                    uploadedBy=row["userId"],
                    created_at=row["updated_at"] or row["created_at"],
                    updated_at=row["updated_at"] or row["created_at"],
                )
            )


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_compliance_forms_status"), table_name="employee_compliance_forms")
    op.drop_index(op.f("ix_employee_compliance_forms_formType"), table_name="employee_compliance_forms")
    op.drop_index(op.f("ix_employee_compliance_forms_employeeProfileId"), table_name="employee_compliance_forms")
    op.drop_table("employee_compliance_forms")

    op.drop_index(op.f("ix_employee_contracts_employeeProfileId"), table_name="employee_contracts")
    op.drop_table("employee_contracts")

    op.drop_index(op.f("ix_employee_documents_type"), table_name="employee_documents")
    op.drop_index(op.f("ix_employee_documents_status"), table_name="employee_documents")
    op.drop_index(op.f("ix_employee_documents_employeeProfileId"), table_name="employee_documents")
    op.drop_table("employee_documents")

    op.drop_index(op.f("ix_employee_selection_forms_status"), table_name="employee_selection_forms")
    op.drop_table("employee_selection_forms")
