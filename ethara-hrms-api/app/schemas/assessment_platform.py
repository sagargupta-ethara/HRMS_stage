"""Request schemas for the Assessment Platform.

Responses are hand-serialized in app/services/assessment_platform.py so that
answer keys can be stripped from candidate-facing payloads. These models only
validate inbound request bodies (camelCase aliases, snake_case attributes).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from app.db.models import ApQuestionType
from app.schemas.common import ORMModel


class AssessmentCreate(ORMModel):
    title: str
    description: str | None = None
    instructions: str | None = None
    consent_text: str | None = Field(default=None, alias="consentText")
    time_limit_minutes: int | None = Field(default=None, alias="timeLimitMinutes")
    attempts_allowed: int = Field(default=1, alias="attemptsAllowed")
    randomize_sections: bool = Field(default=False, alias="randomizeSections")
    randomize_questions: bool = Field(default=False, alias="randomizeQuestions")
    shuffle_options: bool = Field(default=False, alias="shuffleOptions")
    negative_marking: bool = Field(default=False, alias="negativeMarking")
    negative_factor: float = Field(default=0.0, alias="negativeFactor")
    pass_percentage: float | None = Field(default=None, alias="passPercentage")
    show_results_to_candidate: bool = Field(default=False, alias="showResultsToCandidate")
    available_from: datetime | None = Field(default=None, alias="availableFrom")
    available_until: datetime | None = Field(default=None, alias="availableUntil")
    settings: dict[str, Any] | None = None
    position_id: str | None = Field(default=None, alias="positionId")


class AssessmentUpdate(ORMModel):
    title: str | None = None
    description: str | None = None
    instructions: str | None = None
    consent_text: str | None = Field(default=None, alias="consentText")
    time_limit_minutes: int | None = Field(default=None, alias="timeLimitMinutes")
    attempts_allowed: int | None = Field(default=None, alias="attemptsAllowed")
    randomize_sections: bool | None = Field(default=None, alias="randomizeSections")
    randomize_questions: bool | None = Field(default=None, alias="randomizeQuestions")
    shuffle_options: bool | None = Field(default=None, alias="shuffleOptions")
    negative_marking: bool | None = Field(default=None, alias="negativeMarking")
    negative_factor: float | None = Field(default=None, alias="negativeFactor")
    pass_percentage: float | None = Field(default=None, alias="passPercentage")
    show_results_to_candidate: bool | None = Field(default=None, alias="showResultsToCandidate")
    available_from: datetime | None = Field(default=None, alias="availableFrom")
    available_until: datetime | None = Field(default=None, alias="availableUntil")
    settings: dict[str, Any] | None = None
    position_id: str | None = Field(default=None, alias="positionId")


class AssessmentSettingsUpdate(ORMModel):
    """Operational settings (Google Sheet sync, proctoring, result visibility) that
    are safe to change AFTER publish — they don't alter the question snapshot."""

    settings: dict[str, Any] | None = None
    show_results_to_candidate: bool | None = Field(default=None, alias="showResultsToCandidate")


class SectionCreate(ORMModel):
    title: str
    instructions: str | None = None
    order_index: int | None = Field(default=None, alias="orderIndex")
    time_limit_minutes: int | None = Field(default=None, alias="timeLimitMinutes")
    cutoff_mark: float | None = Field(default=None, alias="cutoffMark")
    weightage: float | None = None
    lock_after_leave: bool = Field(default=False, alias="lockAfterLeave")
    randomize_questions: bool = Field(default=False, alias="randomizeQuestions")
    pick_count: int | None = Field(default=None, alias="pickCount")


class SectionUpdate(ORMModel):
    title: str | None = None
    instructions: str | None = None
    order_index: int | None = Field(default=None, alias="orderIndex")
    time_limit_minutes: int | None = Field(default=None, alias="timeLimitMinutes")
    cutoff_mark: float | None = Field(default=None, alias="cutoffMark")
    weightage: float | None = None
    lock_after_leave: bool | None = Field(default=None, alias="lockAfterLeave")
    randomize_questions: bool | None = Field(default=None, alias="randomizeQuestions")
    pick_count: int | None = Field(default=None, alias="pickCount")


class QuestionCreate(ORMModel):
    type: ApQuestionType
    prompt: str
    config: dict[str, Any] = Field(default_factory=dict)
    marks: float = 1.0
    negative_marks: float = Field(default=0.0, alias="negativeMarks")
    order_index: int | None = Field(default=None, alias="orderIndex")
    is_required: bool = Field(default=True, alias="isRequired")
    media_url: str | None = Field(default=None, alias="mediaUrl")
    bank_question_id: str | None = Field(default=None, alias="bankQuestionId")


class QuestionUpdate(ORMModel):
    type: ApQuestionType | None = None
    prompt: str | None = None
    config: dict[str, Any] | None = None
    marks: float | None = None
    negative_marks: float | None = Field(default=None, alias="negativeMarks")
    order_index: int | None = Field(default=None, alias="orderIndex")
    is_required: bool | None = Field(default=None, alias="isRequired")
    media_url: str | None = Field(default=None, alias="mediaUrl")


class ReorderRequest(ORMModel):
    ordered_ids: list[str] = Field(alias="orderedIds")


class QuestionBankCreate(ORMModel):
    type: ApQuestionType
    prompt: str
    config: dict[str, Any] = Field(default_factory=dict)
    default_marks: float = Field(default=1.0, alias="defaultMarks")
    tags: list[str] = Field(default_factory=list)
    difficulty: str | None = None
    skill: str | None = None


class QuestionBankUpdate(ORMModel):
    type: ApQuestionType | None = None
    prompt: str | None = None
    config: dict[str, Any] | None = None
    default_marks: float | None = Field(default=None, alias="defaultMarks")
    tags: list[str] | None = None
    difficulty: str | None = None
    skill: str | None = None
    is_archived: bool | None = Field(default=None, alias="isArchived")


class AddFromBankRequest(ORMModel):
    bank_question_ids: list[str] = Field(alias="bankQuestionIds")
    section_id: str = Field(alias="sectionId")


class AssignEmailsRequest(ORMModel):
    emails: list[str]
    expires_in_days: int | None = Field(default=None, alias="expiresInDays")


class AssessmentBypassEntry(ORMModel):
    assignment_id: str = Field(alias="assignmentId")
    score: float
    feedback: str | None = None


class AssessmentBypassRequest(ORMModel):
    assignments: list[AssessmentBypassEntry]
    notes: str | None = None
    manual_pass: bool = Field(default=False, alias="manualPass")


class AnswerSaveRequest(ORMModel):
    response: dict[str, Any] | None = None
    client_rev: int = Field(default=0, alias="clientRev")


class GradeAnswerRequest(ORMModel):
    marks: float
    feedback: str | None = None


class ProctoringEventRequest(ORMModel):
    type: str
