"""assessment_platform_tables

Revision ID: f7e9d1c3a5b8
Revises: e5f7a9b1c3d4
Create Date: 2026-06-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f7e9d1c3a5b8"
down_revision: str | None = "e5f7a9b1c3d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ASSESSMENT_STATUS = sa.Enum("draft", "published", "archived", name="ap_assessment_status", native_enum=False)
QUESTION_TYPE = sa.Enum(
    "mcq_single", "mcq_multi", "true_false", "short_answer", "long_answer", "file_upload",
    "url_submission", "rating", "form_text", "form_date", "form_dropdown", "consent",
    name="ap_question_type", native_enum=False,
)
ASSIGNMENT_STATUS = sa.Enum(
    "invited", "started", "submitted", "graded", "revoked", "expired",
    name="ap_assignment_status", native_enum=False,
)
ATTEMPT_STATUS = sa.Enum("in_progress", "submitted", "graded", name="ap_attempt_status", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "ap_assessments",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("consentText", sa.Text(), nullable=True),
        sa.Column("status", ASSESSMENT_STATUS, nullable=False),
        sa.Column("timeLimitMinutes", sa.Integer(), nullable=True),
        sa.Column("attemptsAllowed", sa.Integer(), nullable=False),
        sa.Column("randomizeSections", sa.Boolean(), nullable=False),
        sa.Column("randomizeQuestions", sa.Boolean(), nullable=False),
        sa.Column("shuffleOptions", sa.Boolean(), nullable=False),
        sa.Column("negativeMarking", sa.Boolean(), nullable=False),
        sa.Column("negativeFactor", sa.Float(), nullable=False),
        sa.Column("passPercentage", sa.Float(), nullable=True),
        sa.Column("totalMarks", sa.Float(), nullable=False),
        sa.Column("showResultsToCandidate", sa.Boolean(), nullable=False),
        sa.Column("availableFrom", sa.DateTime(timezone=True), nullable=True),
        sa.Column("availableUntil", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settings", sa.JSON(), nullable=True),
        sa.Column("positionId", sa.String(length=32), nullable=True),
        sa.Column("createdBy", sa.String(length=32), nullable=True),
        sa.Column("isRemoved", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["positionId"], ["positions.id"]),
        sa.ForeignKeyConstraint(["createdBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ap_assessments_title", "ap_assessments", ["title"])
    op.create_index("ix_ap_assessments_status", "ap_assessments", ["status"])
    op.create_index("ix_ap_assessments_positionId", "ap_assessments", ["positionId"])
    op.create_index("ix_ap_assessments_isRemoved", "ap_assessments", ["isRemoved"])

    op.create_table(
        "ap_question_bank",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("type", QUESTION_TYPE, nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("defaultMarks", sa.Float(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("difficulty", sa.String(length=30), nullable=True),
        sa.Column("skill", sa.String(length=100), nullable=True),
        sa.Column("isArchived", sa.Boolean(), nullable=False),
        sa.Column("createdBy", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["createdBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ap_question_bank_type", "ap_question_bank", ["type"])
    op.create_index("ix_ap_question_bank_difficulty", "ap_question_bank", ["difficulty"])
    op.create_index("ix_ap_question_bank_skill", "ap_question_bank", ["skill"])
    op.create_index("ix_ap_question_bank_isArchived", "ap_question_bank", ["isArchived"])

    op.create_table(
        "ap_sections",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("assessmentId", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("orderIndex", sa.Integer(), nullable=False),
        sa.Column("timeLimitMinutes", sa.Integer(), nullable=True),
        sa.Column("cutoffMark", sa.Float(), nullable=True),
        sa.Column("weightage", sa.Float(), nullable=True),
        sa.Column("lockAfterLeave", sa.Boolean(), nullable=False),
        sa.Column("randomizeQuestions", sa.Boolean(), nullable=False),
        sa.Column("pickCount", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assessmentId"], ["ap_assessments.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ap_sections_assessmentId", "ap_sections", ["assessmentId"])

    op.create_table(
        "ap_questions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("assessmentId", sa.String(length=32), nullable=False),
        sa.Column("sectionId", sa.String(length=32), nullable=False),
        sa.Column("bankQuestionId", sa.String(length=32), nullable=True),
        sa.Column("type", QUESTION_TYPE, nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("marks", sa.Float(), nullable=False),
        sa.Column("negativeMarks", sa.Float(), nullable=False),
        sa.Column("orderIndex", sa.Integer(), nullable=False),
        sa.Column("isRequired", sa.Boolean(), nullable=False),
        sa.Column("mediaUrl", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assessmentId"], ["ap_assessments.id"]),
        sa.ForeignKeyConstraint(["sectionId"], ["ap_sections.id"]),
        sa.ForeignKeyConstraint(["bankQuestionId"], ["ap_question_bank.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ap_questions_assessmentId", "ap_questions", ["assessmentId"])
    op.create_index("ix_ap_questions_sectionId", "ap_questions", ["sectionId"])
    op.create_index("ix_ap_questions_bankQuestionId", "ap_questions", ["bankQuestionId"])
    op.create_index("ix_ap_questions_type", "ap_questions", ["type"])

    op.create_table(
        "ap_assignments",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("assessmentId", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("userId", sa.String(length=32), nullable=True),
        sa.Column("candidateId", sa.String(length=32), nullable=True),
        sa.Column("status", ASSIGNMENT_STATUS, nullable=False),
        sa.Column("invitedBy", sa.String(length=32), nullable=True),
        sa.Column("invitedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lastInvitedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expiresAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attemptsUsed", sa.Integer(), nullable=False),
        sa.Column("provisioned", sa.Boolean(), nullable=False),
        sa.Column("inviteTokenHash", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assessmentId"], ["ap_assessments.id"]),
        sa.ForeignKeyConstraint(["userId"], ["users.id"]),
        sa.ForeignKeyConstraint(["candidateId"], ["candidates.id"]),
        sa.ForeignKeyConstraint(["invitedBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assessmentId", "email", name="uq_ap_assignments_assessmentId_email"),
    )
    op.create_index("ix_ap_assignments_assessmentId", "ap_assignments", ["assessmentId"])
    op.create_index("ix_ap_assignments_email", "ap_assignments", ["email"])
    op.create_index("ix_ap_assignments_userId", "ap_assignments", ["userId"])
    op.create_index("ix_ap_assignments_candidateId", "ap_assignments", ["candidateId"])
    op.create_index("ix_ap_assignments_status", "ap_assignments", ["status"])

    op.create_table(
        "ap_attempts",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("assignmentId", sa.String(length=32), nullable=False),
        sa.Column("assessmentId", sa.String(length=32), nullable=False),
        sa.Column("userId", sa.String(length=32), nullable=False),
        sa.Column("status", ATTEMPT_STATUS, nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("startedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submittedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expiresAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("autoScore", sa.Float(), nullable=True),
        sa.Column("manualScore", sa.Float(), nullable=True),
        sa.Column("totalScore", sa.Float(), nullable=True),
        sa.Column("maxScore", sa.Float(), nullable=True),
        sa.Column("percentage", sa.Float(), nullable=True),
        sa.Column("resultStatus", sa.String(length=20), nullable=True),
        sa.Column("gradedBy", sa.String(length=32), nullable=True),
        sa.Column("gradedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assignmentId"], ["ap_assignments.id"]),
        sa.ForeignKeyConstraint(["assessmentId"], ["ap_assessments.id"]),
        sa.ForeignKeyConstraint(["userId"], ["users.id"]),
        sa.ForeignKeyConstraint(["gradedBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ap_attempts_assignmentId", "ap_attempts", ["assignmentId"])
    op.create_index("ix_ap_attempts_assessmentId", "ap_attempts", ["assessmentId"])
    op.create_index("ix_ap_attempts_userId", "ap_attempts", ["userId"])
    op.create_index("ix_ap_attempts_status", "ap_attempts", ["status"])

    op.create_table(
        "ap_answers",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("attemptId", sa.String(length=32), nullable=False),
        sa.Column("questionId", sa.String(length=32), nullable=False),
        sa.Column("response", sa.JSON(), nullable=True),
        sa.Column("clientRev", sa.Integer(), nullable=False),
        sa.Column("isCorrect", sa.Boolean(), nullable=True),
        sa.Column("autoMarks", sa.Float(), nullable=True),
        sa.Column("manualMarks", sa.Float(), nullable=True),
        sa.Column("awardedMarks", sa.Float(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("gradedBy", sa.String(length=32), nullable=True),
        sa.Column("gradedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fileName", sa.String(length=255), nullable=True),
        sa.Column("fileUrl", sa.String(length=500), nullable=True),
        sa.Column("filePath", sa.String(length=500), nullable=True),
        sa.Column("fileSize", sa.Integer(), nullable=True),
        sa.Column("fileMime", sa.String(length=255), nullable=True),
        sa.Column("savedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["attemptId"], ["ap_attempts.id"]),
        sa.ForeignKeyConstraint(["questionId"], ["ap_questions.id"]),
        sa.ForeignKeyConstraint(["gradedBy"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attemptId", "questionId", name="uq_ap_answers_attemptId_questionId"),
    )
    op.create_index("ix_ap_answers_attemptId", "ap_answers", ["attemptId"])
    op.create_index("ix_ap_answers_questionId", "ap_answers", ["questionId"])


def downgrade() -> None:
    op.drop_index("ix_ap_answers_questionId", table_name="ap_answers")
    op.drop_index("ix_ap_answers_attemptId", table_name="ap_answers")
    op.drop_table("ap_answers")

    op.drop_index("ix_ap_attempts_status", table_name="ap_attempts")
    op.drop_index("ix_ap_attempts_userId", table_name="ap_attempts")
    op.drop_index("ix_ap_attempts_assessmentId", table_name="ap_attempts")
    op.drop_index("ix_ap_attempts_assignmentId", table_name="ap_attempts")
    op.drop_table("ap_attempts")

    op.drop_index("ix_ap_assignments_status", table_name="ap_assignments")
    op.drop_index("ix_ap_assignments_candidateId", table_name="ap_assignments")
    op.drop_index("ix_ap_assignments_userId", table_name="ap_assignments")
    op.drop_index("ix_ap_assignments_email", table_name="ap_assignments")
    op.drop_index("ix_ap_assignments_assessmentId", table_name="ap_assignments")
    op.drop_table("ap_assignments")

    op.drop_index("ix_ap_questions_type", table_name="ap_questions")
    op.drop_index("ix_ap_questions_bankQuestionId", table_name="ap_questions")
    op.drop_index("ix_ap_questions_sectionId", table_name="ap_questions")
    op.drop_index("ix_ap_questions_assessmentId", table_name="ap_questions")
    op.drop_table("ap_questions")

    op.drop_index("ix_ap_sections_assessmentId", table_name="ap_sections")
    op.drop_table("ap_sections")

    op.drop_index("ix_ap_question_bank_isArchived", table_name="ap_question_bank")
    op.drop_index("ix_ap_question_bank_skill", table_name="ap_question_bank")
    op.drop_index("ix_ap_question_bank_difficulty", table_name="ap_question_bank")
    op.drop_index("ix_ap_question_bank_type", table_name="ap_question_bank")
    op.drop_table("ap_question_bank")

    op.drop_index("ix_ap_assessments_isRemoved", table_name="ap_assessments")
    op.drop_index("ix_ap_assessments_positionId", table_name="ap_assessments")
    op.drop_index("ix_ap_assessments_status", table_name="ap_assessments")
    op.drop_index("ix_ap_assessments_title", table_name="ap_assessments")
    op.drop_table("ap_assessments")
