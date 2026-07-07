"""add sync_job_runs table

Revision ID: d9f2e5c8b1a4
Revises: 41fd8cc2f7e7
Create Date: 2026-05-30

"""
from alembic import op
import sqlalchemy as sa

revision = "d9f2e5c8b1a4"
down_revision = "41fd8cc2f7e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_job_runs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("jobName", sa.String(100), nullable=False),
        sa.Column("trigger", sa.String(50), nullable=False, server_default="cron"),
        sa.Column("status", sa.String(50), nullable=False, server_default="running"),
        sa.Column("startedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finishedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("durationSeconds", sa.Integer, nullable=True),
        sa.Column("documentsProcessed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("errors", sa.Integer, nullable=False, server_default="0"),
        sa.Column("message", sa.Text, nullable=True),
    )
    op.create_index("ix_sync_job_runs_jobName", "sync_job_runs", ["jobName"])
    op.create_index("ix_sync_job_runs_startedAt", "sync_job_runs", ["startedAt"])


def downgrade() -> None:
    op.drop_table("sync_job_runs")
