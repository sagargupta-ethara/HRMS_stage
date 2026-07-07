"""candidate compliance forms Documenso e-sign fields

Revision ID: f4d5e6a7b8c9
Revises: f3c4d5e6a7b8
Create Date: 2026-06-07 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f4d5e6a7b8c9"
down_revision: str | None = "f3c4d5e6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("compliance_forms", sa.Column("documensoId", sa.String(length=255), nullable=True))
    op.add_column("compliance_forms", sa.Column("documensoTemplateId", sa.Integer(), nullable=True))
    op.add_column("compliance_forms", sa.Column("signedUrl", sa.String(length=500), nullable=True))
    op.add_column("compliance_forms", sa.Column("pdfUrl", sa.String(length=500), nullable=True))
    op.add_column("compliance_forms", sa.Column("sentAt", sa.DateTime(timezone=True), nullable=True))
    op.add_column("compliance_forms", sa.Column("signedAt", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_compliance_forms_documensoId", "compliance_forms", ["documensoId"])


def downgrade() -> None:
    op.drop_index("ix_compliance_forms_documensoId", table_name="compliance_forms")
    op.drop_column("compliance_forms", "signedAt")
    op.drop_column("compliance_forms", "sentAt")
    op.drop_column("compliance_forms", "pdfUrl")
    op.drop_column("compliance_forms", "signedUrl")
    op.drop_column("compliance_forms", "documensoTemplateId")
    op.drop_column("compliance_forms", "documensoId")
