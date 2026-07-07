"""Assessment Platform service layer.

Holds the engine logic kept out of the route file: per-question-type config
validation, the immutable attempt snapshot builder, the auto/manual scoring
engine, and hand-written serializers (so answer keys can be stripped from
candidate-facing payloads). All DB writes/commits are owned by the route.
"""

from __future__ import annotations

import random
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status

from app.core.timezone import format_app_datetime
from app.db.models import (
    ApAnswer,
    ApAssessment,
    ApAssignment,
    ApAssignmentStatus,
    ApAttempt,
    ApAttemptStatus,
    ApQuestion,
    ApQuestionType,
    ApSection,
    generate_id,
)

# Survey/form types that never contribute to a score.
UNSCORED_TYPES: frozenset[ApQuestionType] = frozenset(
    {
        ApQuestionType.RATING,
        ApQuestionType.FORM_TEXT,
        ApQuestionType.FORM_DATE,
        ApQuestionType.FORM_DROPDOWN,
        ApQuestionType.CONSENT,
    }
)
# Types auto-scored purely from a stored answer key.
AUTO_KEY_TYPES: frozenset[ApQuestionType] = frozenset(
    {ApQuestionType.MCQ_SINGLE, ApQuestionType.MCQ_MULTI, ApQuestionType.TRUE_FALSE}
)
# Config keys that reveal the answer / grading guidance — stripped for takers.
_TAKER_HIDDEN_CONFIG_KEYS = frozenset(
    {"correctOptionId", "correctOptionIds", "correct", "acceptedAnswers", "matchMode", "rubric", "partialMarking"}
)

# ── proctoring / anti-cheat ──
_PROCTORING_DEFAULTS: dict[str, Any] = {
    "requireFullscreen": False,
    "blockTabSwitch": False,
    "blockCopyPaste": False,
    "maxWarnings": 0,
}
_PROCTOR_COUNT_KEY = {
    "tab_switch": "tabSwitches",
    "fullscreen_exit": "fullscreenExits",
    "copy": "copyAttempts",
    "blur": "blurEvents",
}


def proctoring_config(settings: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize the per-assessment anti-cheat settings (stored in assessment.settings.proctoring)."""
    raw = (settings or {}).get("proctoring") or {}
    cfg = {
        "requireFullscreen": bool(raw.get("requireFullscreen", _PROCTORING_DEFAULTS["requireFullscreen"])),
        "blockTabSwitch": bool(raw.get("blockTabSwitch", _PROCTORING_DEFAULTS["blockTabSwitch"])),
        "blockCopyPaste": bool(raw.get("blockCopyPaste", _PROCTORING_DEFAULTS["blockCopyPaste"])),
        "maxWarnings": int(raw.get("maxWarnings", _PROCTORING_DEFAULTS["maxWarnings"]) or 0),
    }
    cfg["enabled"] = cfg["requireFullscreen"] or cfg["blockTabSwitch"] or cfg["blockCopyPaste"]
    return cfg


def proctoring_counts(attempt: ApAttempt) -> dict[str, int]:
    counts = (attempt.proctoring or {}).get("counts") or {}
    return {key: int(counts.get(key, 0)) for key in _PROCTOR_COUNT_KEY.values()}


def record_proctoring_event(attempt: ApAttempt, event_type: str) -> dict[str, int]:
    """Increment the counter for a violation type + append to a capped event log."""
    data = dict(attempt.proctoring or {})
    counts = dict(data.get("counts") or {})
    key = _PROCTOR_COUNT_KEY.get(event_type)
    if key:
        counts[key] = int(counts.get(key, 0)) + 1
    events = [*(data.get("events") or []), {"type": event_type, "at": datetime.now(UTC).isoformat()}]
    data["counts"] = counts
    data["events"] = events[-200:]
    attempt.proctoring = data
    return {k: int(counts.get(k, 0)) for k in _PROCTOR_COUNT_KEY.values()}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    """Treat naive datetimes (as SQLite returns) as UTC so arithmetic never crashes."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def is_expired(attempt: ApAttempt) -> bool:
    return attempt.expires_at is not None and _utcnow() >= ensure_aware(attempt.expires_at)


# ─────────────────────────── question config validation ──────────────────────


def _opt_id() -> str:
    return generate_id()[:8]


def validate_question_config(qtype: ApQuestionType, config: dict[str, Any] | None) -> dict[str, Any]:
    """Validate + normalize a question's config for its type. Raises 422 on error."""
    cfg: dict[str, Any] = dict(config or {})

    def _fail(msg: str) -> None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=msg)

    if qtype in (ApQuestionType.MCQ_SINGLE, ApQuestionType.MCQ_MULTI):
        raw_options = cfg.get("options")
        if not isinstance(raw_options, list) or len(raw_options) < 2:
            _fail("Multiple-choice questions need at least 2 options")
        options: list[dict[str, Any]] = []
        for opt in raw_options:
            if isinstance(opt, str):
                opt = {"id": _opt_id(), "text": opt}
            elif isinstance(opt, dict):
                opt = {"id": str(opt.get("id") or _opt_id()), "text": str(opt.get("text", "")).strip()}
            else:
                _fail("Each option must be a string or {id, text} object")
            if not opt["text"]:
                _fail("Options cannot be empty")
            options.append(opt)
        ids = [o["id"] for o in options]
        if len(set(ids)) != len(ids):
            # de-dupe colliding ids
            seen: set[str] = set()
            for o in options:
                if o["id"] in seen:
                    o["id"] = _opt_id()
                seen.add(o["id"])
            ids = [o["id"] for o in options]
        cfg["options"] = options
        if qtype is ApQuestionType.MCQ_SINGLE:
            correct = cfg.get("correctOptionId")
            if correct is None or correct not in ids:
                _fail("Select the correct option")
            cfg["correctOptionId"] = correct
        else:
            correct_ids = cfg.get("correctOptionIds")
            if not isinstance(correct_ids, list) or not correct_ids:
                _fail("Select at least one correct option")
            if any(c not in ids for c in correct_ids):
                _fail("Correct options must be among the listed options")
            cfg["correctOptionIds"] = list(dict.fromkeys(correct_ids))
            cfg["partialMarking"] = bool(cfg.get("partialMarking", False))

    elif qtype is ApQuestionType.TRUE_FALSE:
        if "correct" not in cfg:
            _fail("Set the correct answer (true/false)")
        cfg["correct"] = bool(cfg["correct"])

    elif qtype is ApQuestionType.SHORT_ANSWER:
        accepted = cfg.get("acceptedAnswers")
        if accepted:
            if not isinstance(accepted, list):
                _fail("acceptedAnswers must be a list")
            cfg["acceptedAnswers"] = [str(a) for a in accepted if str(a).strip()]
            mode = cfg.get("matchMode", "exact")
            if mode not in ("exact", "fuzzy", "manual"):
                _fail("matchMode must be exact, fuzzy or manual")
            cfg["matchMode"] = mode
        else:
            cfg["matchMode"] = "manual"

    elif qtype is ApQuestionType.FILE_UPLOAD:
        if "maxSizeMb" in cfg and cfg["maxSizeMb"] is not None:
            try:
                cfg["maxSizeMb"] = max(1, int(cfg["maxSizeMb"]))
            except (TypeError, ValueError):
                _fail("maxSizeMb must be a number")
        if cfg.get("allowedTypes") is not None and not isinstance(cfg["allowedTypes"], list):
            _fail("allowedTypes must be a list")

    elif qtype is ApQuestionType.RATING:
        smin = int(cfg.get("scaleMin", 1))
        smax = int(cfg.get("scaleMax", 5))
        if smax <= smin:
            _fail("Rating scaleMax must be greater than scaleMin")
        cfg["scaleMin"], cfg["scaleMax"] = smin, smax

    elif qtype is ApQuestionType.FORM_DROPDOWN:
        opts = cfg.get("options")
        if not isinstance(opts, list) or not opts:
            _fail("Dropdown needs at least one option")
        cfg["options"] = [str(o) for o in opts]

    # long_answer, url_submission, form_text, form_date, consent — no required keys
    return cfg


def is_auto_scored(qtype: ApQuestionType, config: dict[str, Any] | None) -> bool:
    if qtype in AUTO_KEY_TYPES:
        return True
    if qtype is ApQuestionType.SHORT_ANSWER:
        cfg = config or {}
        return bool(cfg.get("acceptedAnswers")) and cfg.get("matchMode", "manual") != "manual"
    return False


def is_scored(qtype: ApQuestionType) -> bool:
    return qtype not in UNSCORED_TYPES


def question_marks_total(assessment: ApAssessment) -> float:
    """Sum of marks across scored questions (drives totalMarks)."""
    total = 0.0
    for section in assessment.sections:
        for question in section.questions:
            if is_scored(question.type):
                total += question.marks or 0.0
    return round(total, 4)


# ─────────────────── form-as-code: spec ⇆ assessment (import/export) ──────────
# A friendly, human-writable JSON definition (like Apps Script building a Google
# Form). Options are plain strings and the correct answer is given by its text
# (or 0-based index), so authors never manage option ids — the importer resolves
# them and runs the same validation as the builder.

_MAX_SPEC_SECTIONS = 50
_MAX_SPEC_QUESTIONS = 1000


def _spec_fail(msg: str) -> None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Spec error — {msg}")


# Friendly aliases so a code author can write the natural word for substring matching.
_MATCH_ALIASES = {"contains": "fuzzy", "substring": "fuzzy", "includes": "fuzzy", "partial": "fuzzy"}


def _normalize_match_mode(mode: Any) -> str:
    return _MATCH_ALIASES.get(str(mode).strip().lower(), str(mode).strip().lower())


def _resolve_option(answer: Any, options: list[dict[str, Any]], text_to_id: dict[str, str], where: str) -> str:
    if answer is None:
        _spec_fail(f"{where}: 'answer' is required")
    if isinstance(answer, bool):
        _spec_fail(f"{where}: answer must be option text or index, not a boolean")
    if isinstance(answer, int):
        if 0 <= answer < len(options):
            return options[answer]["id"]
        _spec_fail(f"{where}: answer index {answer} is out of range")
    key = str(answer)
    if key in text_to_id:
        return text_to_id[key]
    _spec_fail(f"{where}: answer '{key}' is not one of the options")
    return ""  # unreachable


def _spec_question_to_internal(q: dict[str, Any], where: str) -> tuple[ApQuestionType, str, dict[str, Any], float, float, bool]:
    if not isinstance(q, dict):
        _spec_fail(f"{where}: must be an object")
    try:
        qtype = ApQuestionType(q.get("type"))
    except ValueError:
        _spec_fail(f"{where}: unknown type '{q.get('type')}'")
        raise  # for type-checkers
    prompt = str(q.get("prompt", "")).strip()
    if not prompt:
        _spec_fail(f"{where}: 'prompt' is required")
    config: dict[str, Any] = {}

    if qtype in (ApQuestionType.MCQ_SINGLE, ApQuestionType.MCQ_MULTI):
        raw_options = q.get("options")
        if not isinstance(raw_options, list) or len(raw_options) < 2:
            _spec_fail(f"{where}: provide at least 2 'options'")
        options: list[dict[str, Any]] = []
        text_to_id: dict[str, str] = {}
        for opt in raw_options:
            text = str(opt.get("text") if isinstance(opt, dict) else opt)
            opt_id = generate_id()[:8]
            options.append({"id": opt_id, "text": text})
            text_to_id.setdefault(text, opt_id)
        config["options"] = options
        if qtype is ApQuestionType.MCQ_SINGLE:
            config["correctOptionId"] = _resolve_option(q.get("answer"), options, text_to_id, where)
        else:
            answers = q.get("answers")
            if answers is None and q.get("answer") is not None:
                answers = [q["answer"]]
            if not isinstance(answers, list) or not answers:
                _spec_fail(f"{where}: provide 'answers' (a list of correct option texts)")
            config["correctOptionIds"] = [_resolve_option(a, options, text_to_id, where) for a in answers]
            config["partialMarking"] = bool(q.get("partialMarking", False))

    elif qtype is ApQuestionType.TRUE_FALSE:
        if "answer" not in q:
            _spec_fail(f"{where}: 'answer' (true/false) is required")
        config["correct"] = bool(q["answer"])

    elif qtype is ApQuestionType.SHORT_ANSWER:
        accept = q.get("accept") or q.get("acceptedAnswers")
        if accept:
            config["acceptedAnswers"] = list(accept)
            config["matchMode"] = _normalize_match_mode(q.get("match") or q.get("matchMode") or "exact")
        else:
            config["matchMode"] = "manual"

    elif qtype is ApQuestionType.LONG_ANSWER:
        if q.get("rubric"):
            config["rubric"] = q["rubric"]

    elif qtype is ApQuestionType.FILE_UPLOAD:
        if q.get("maxSizeMb") is not None:
            config["maxSizeMb"] = q["maxSizeMb"]
        if q.get("allowedTypes"):
            config["allowedTypes"] = q["allowedTypes"]

    elif qtype is ApQuestionType.RATING:
        config["scaleMin"] = q.get("scaleMin", 1)
        config["scaleMax"] = q.get("scaleMax", 5)

    elif qtype is ApQuestionType.FORM_DROPDOWN:
        config["options"] = [str(o) for o in (q.get("options") or [])]

    elif qtype is ApQuestionType.CONSENT:
        config["statement"] = q.get("statement", "I agree.")

    try:
        config = validate_question_config(qtype, config)
    except HTTPException as exc:
        _spec_fail(f"{where}: {exc.detail}")
    default_marks = 0.0 if qtype in UNSCORED_TYPES else 1.0
    marks = float(q.get("marks", default_marks))
    negative = float(q.get("negativeMarks", 0.0))
    required = bool(q.get("required", q.get("isRequired", True)))
    return qtype, prompt, config, marks, negative, required


def spec_to_assessment(db: Any, spec: dict[str, Any], *, actor: Any) -> ApAssessment:
    """Build a draft assessment (sections + questions) from a code/JSON spec."""
    if not isinstance(spec, dict):
        _spec_fail("the spec must be a JSON object")
    title = str(spec.get("title", "")).strip()
    if not title:
        _spec_fail("'title' is required")
    raw_sections = spec.get("sections")
    if not isinstance(raw_sections, list) or not raw_sections:
        _spec_fail("provide at least one section in 'sections'")
    if len(raw_sections) > _MAX_SPEC_SECTIONS:
        _spec_fail(f"too many sections (max {_MAX_SPEC_SECTIONS})")

    assessment = ApAssessment(
        title=title,
        description=spec.get("description"),
        instructions=spec.get("instructions"),
        consent_text=spec.get("consentText"),
        time_limit_minutes=spec.get("timeLimitMinutes"),
        attempts_allowed=int(spec.get("attemptsAllowed", 1) or 1),
        randomize_sections=bool(spec.get("randomizeSections", False)),
        randomize_questions=bool(spec.get("randomizeQuestions", False)),
        shuffle_options=bool(spec.get("shuffleOptions", False)),
        negative_marking=bool(spec.get("negativeMarking", False)),
        negative_factor=float(spec.get("negativeFactor", 0.0) or 0.0),
        pass_percentage=spec.get("passPercentage"),
        show_results_to_candidate=bool(spec.get("showResultsToCandidate", False)),
        created_by=getattr(actor, "id", None),
    )
    db.add(assessment)
    db.flush()

    total_questions = 0
    for si, raw_section in enumerate(raw_sections):
        if not isinstance(raw_section, dict):
            _spec_fail(f"section {si + 1}: must be an object")
        section = ApSection(
            assessment_id=assessment.id,
            title=str(raw_section.get("title") or f"Section {si + 1}"),
            instructions=raw_section.get("instructions"),
            order_index=si,
            cutoff_mark=raw_section.get("cutoffMark"),
            weightage=raw_section.get("weightage"),
            lock_after_leave=bool(raw_section.get("lockAfterLeave", False)),
            randomize_questions=bool(raw_section.get("randomizeQuestions", False)),
            pick_count=raw_section.get("pickCount"),
        )
        db.add(section)
        db.flush()
        for qi, raw_q in enumerate(raw_section.get("questions") or []):
            total_questions += 1
            if total_questions > _MAX_SPEC_QUESTIONS:
                _spec_fail(f"too many questions (max {_MAX_SPEC_QUESTIONS})")
            qtype, prompt, config, marks, negative, required = _spec_question_to_internal(
                raw_q, f"section {si + 1} question {qi + 1}"
            )
            db.add(
                ApQuestion(
                    assessment_id=assessment.id,
                    section_id=section.id,
                    type=qtype,
                    prompt=prompt,
                    config=config,
                    marks=marks,
                    negative_marks=negative,
                    order_index=qi,
                    is_required=required,
                )
            )
    db.flush()
    assessment.total_marks = question_marks_total(assessment)
    return assessment


def _question_to_spec(question: ApQuestion) -> dict[str, Any]:
    cfg = question.config or {}
    out: dict[str, Any] = {"type": question.type.value, "prompt": question.prompt, "marks": question.marks}
    if not question.is_required:
        out["required"] = False
    if question.negative_marks:
        out["negativeMarks"] = question.negative_marks
    if question.type in (ApQuestionType.MCQ_SINGLE, ApQuestionType.MCQ_MULTI):
        options = cfg.get("options") or []
        id_to_text = {o["id"]: o["text"] for o in options}
        out["options"] = [o["text"] for o in options]
        if question.type is ApQuestionType.MCQ_SINGLE:
            out["answer"] = id_to_text.get(cfg.get("correctOptionId"))
        else:
            out["answers"] = [id_to_text.get(cid) for cid in (cfg.get("correctOptionIds") or [])]
            if cfg.get("partialMarking"):
                out["partialMarking"] = True
    elif question.type is ApQuestionType.TRUE_FALSE:
        out["answer"] = bool(cfg.get("correct"))
    elif question.type is ApQuestionType.SHORT_ANSWER:
        if cfg.get("acceptedAnswers"):
            out["accept"] = cfg["acceptedAnswers"]
            out["match"] = cfg.get("matchMode", "exact")
    elif question.type is ApQuestionType.LONG_ANSWER:
        if cfg.get("rubric"):
            out["rubric"] = cfg["rubric"]
    elif question.type is ApQuestionType.FILE_UPLOAD:
        if cfg.get("maxSizeMb"):
            out["maxSizeMb"] = cfg["maxSizeMb"]
        if cfg.get("allowedTypes"):
            out["allowedTypes"] = cfg["allowedTypes"]
    elif question.type is ApQuestionType.RATING:
        out["scaleMin"] = cfg.get("scaleMin", 1)
        out["scaleMax"] = cfg.get("scaleMax", 5)
    elif question.type is ApQuestionType.FORM_DROPDOWN:
        out["options"] = cfg.get("options") or []
    elif question.type is ApQuestionType.CONSENT:
        out["statement"] = cfg.get("statement")
    return out


def assessment_to_spec(assessment: ApAssessment) -> dict[str, Any]:
    """Dump an assessment back to the friendly code/JSON spec (round-trips with import)."""
    spec: dict[str, Any] = {"title": assessment.title}
    if assessment.description:
        spec["description"] = assessment.description
    if assessment.instructions:
        spec["instructions"] = assessment.instructions
    if assessment.consent_text:
        spec["consentText"] = assessment.consent_text
    if assessment.time_limit_minutes:
        spec["timeLimitMinutes"] = assessment.time_limit_minutes
    if assessment.attempts_allowed != 1:
        spec["attemptsAllowed"] = assessment.attempts_allowed
    if assessment.pass_percentage is not None:
        spec["passPercentage"] = assessment.pass_percentage
    if assessment.negative_marking:
        spec["negativeMarking"] = True
        spec["negativeFactor"] = assessment.negative_factor
    if assessment.shuffle_options:
        spec["shuffleOptions"] = True
    if assessment.randomize_sections:
        spec["randomizeSections"] = True
    if assessment.randomize_questions:
        spec["randomizeQuestions"] = True
    if assessment.show_results_to_candidate:
        spec["showResultsToCandidate"] = True
    spec["sections"] = []
    for section in sorted(assessment.sections, key=lambda s: s.order_index):
        sec_out: dict[str, Any] = {"title": section.title}
        if section.instructions:
            sec_out["instructions"] = section.instructions
        if section.cutoff_mark is not None:
            sec_out["cutoffMark"] = section.cutoff_mark
        if section.pick_count:
            sec_out["pickCount"] = section.pick_count
        if section.lock_after_leave:
            sec_out["lockAfterLeave"] = True
        sec_out["questions"] = [
            _question_to_spec(q) for q in sorted(section.questions, key=lambda q: q.order_index)
        ]
        spec["sections"].append(sec_out)
    return spec


# ───────────────────────────────── snapshot ──────────────────────────────────


def build_snapshot(assessment: ApAssessment) -> dict[str, Any]:
    """Freeze the resolved test (order, randomization, option shuffle, answer keys).

    Stored on the attempt; scoring + taker rendering read this, never the live
    assessment, so later edits/clones can't corrupt an in-flight attempt.
    """
    sections = sorted(assessment.sections, key=lambda s: s.order_index)
    snap_sections: list[dict[str, Any]] = []
    for section in sections:
        questions = sorted(section.questions, key=lambda q: q.order_index)
        if assessment.randomize_questions or section.randomize_questions:
            random.shuffle(questions)
        if section.pick_count and 0 < section.pick_count < len(questions):
            questions = questions[: section.pick_count]
        snap_questions: list[dict[str, Any]] = []
        for question in questions:
            cfg = dict(question.config or {})
            if (
                assessment.shuffle_options
                and question.type in (ApQuestionType.MCQ_SINGLE, ApQuestionType.MCQ_MULTI)
                and isinstance(cfg.get("options"), list)
            ):
                shuffled = list(cfg["options"])
                random.shuffle(shuffled)
                cfg["options"] = shuffled
            snap_questions.append(
                {
                    "id": question.id,
                    "type": question.type.value,
                    "prompt": question.prompt,
                    "marks": question.marks,
                    "negativeMarks": question.negative_marks,
                    "isRequired": question.is_required,
                    "mediaUrl": question.media_url,
                    "config": cfg,
                }
            )
        snap_sections.append(
            {
                "id": section.id,
                "title": section.title,
                "instructions": section.instructions,
                "timeLimitMinutes": section.time_limit_minutes,
                "cutoffMark": section.cutoff_mark,
                "weightage": section.weightage,
                "lockAfterLeave": section.lock_after_leave,
                "questions": snap_questions,
            }
        )
    if assessment.randomize_sections:
        random.shuffle(snap_sections)

    return {
        "assessmentId": assessment.id,
        "title": assessment.title,
        "description": assessment.description,
        "instructions": assessment.instructions,
        "consentText": assessment.consent_text,
        "timeLimitMinutes": assessment.time_limit_minutes,
        "attemptsAllowed": assessment.attempts_allowed,
        "negativeMarking": assessment.negative_marking,
        "negativeFactor": assessment.negative_factor,
        "passPercentage": assessment.pass_percentage,
        "showResultsToCandidate": assessment.show_results_to_candidate,
        "shuffleOptions": assessment.shuffle_options,
        "totalMarks": assessment.total_marks,
        "proctoring": proctoring_config(assessment.settings),
        "sections": snap_sections,
    }


# ───────────────────────────────── scoring ───────────────────────────────────


def _norm_text(value: Any) -> str:
    return " ".join(str(value).strip().lower().split())


def _effective_negative(snapshot: dict[str, Any], snap_q: dict[str, Any]) -> float:
    if not snapshot.get("negativeMarking"):
        return 0.0
    per_question = snap_q.get("negativeMarks")
    if per_question:
        return float(per_question)
    return float(snapshot.get("negativeFactor") or 0.0) * float(snap_q.get("marks") or 0.0)


def evaluate_answer(
    qtype: ApQuestionType,
    config: dict[str, Any],
    response: dict[str, Any] | None,
    marks: float,
    negative: float,
) -> dict[str, Any]:
    """Return {awarded, isCorrect, needsManual} for a single answer.

    awarded is None when manual grading is required. Unanswered scored questions
    award 0 with isCorrect None (no negative marking on blanks).
    """
    response = response or {}

    if qtype is ApQuestionType.MCQ_SINGLE:
        given = response.get("optionId")
        if not given:
            return {"awarded": 0.0, "isCorrect": None, "needsManual": False}
        correct = config.get("correctOptionId")
        if given == correct:
            return {"awarded": marks, "isCorrect": True, "needsManual": False}
        return {"awarded": -negative, "isCorrect": False, "needsManual": False}

    if qtype is ApQuestionType.MCQ_MULTI:
        selected = set(response.get("optionIds") or [])
        correct = set(config.get("correctOptionIds") or [])
        if not selected:
            return {"awarded": 0.0, "isCorrect": None, "needsManual": False}
        if selected == correct:
            return {"awarded": marks, "isCorrect": True, "needsManual": False}
        if config.get("partialMarking") and correct:
            per = marks / len(correct)
            raw = per * len(selected & correct) - per * len(selected - correct)
            return {"awarded": round(max(0.0, raw), 4), "isCorrect": False, "needsManual": False}
        return {"awarded": -negative, "isCorrect": False, "needsManual": False}

    if qtype is ApQuestionType.TRUE_FALSE:
        value = response.get("value")
        if value is None:
            return {"awarded": 0.0, "isCorrect": None, "needsManual": False}
        if bool(value) == bool(config.get("correct")):
            return {"awarded": marks, "isCorrect": True, "needsManual": False}
        return {"awarded": -negative, "isCorrect": False, "needsManual": False}

    if qtype is ApQuestionType.SHORT_ANSWER and is_auto_scored(qtype, config):
        text = response.get("text")
        if not text or not str(text).strip():
            return {"awarded": 0.0, "isCorrect": None, "needsManual": False}
        target = _norm_text(text)
        accepted = [_norm_text(a) for a in (config.get("acceptedAnswers") or [])]
        if config.get("matchMode") == "fuzzy":
            ok = any(a == target or a in target or target in a for a in accepted)
        else:
            ok = target in accepted
        if ok:
            return {"awarded": marks, "isCorrect": True, "needsManual": False}
        return {"awarded": -negative, "isCorrect": False, "needsManual": False}

    # long_answer, file_upload, url_submission, manual short_answer
    return {"awarded": None, "isCorrect": None, "needsManual": True}


def apply_auto_scoring(attempt: ApAttempt) -> None:
    """Score every auto-scorable answer in place; leave manual ones pending."""
    snapshot = attempt.snapshot or {}
    qindex = {
        q["id"]: q
        for section in snapshot.get("sections", [])
        for q in section.get("questions", [])
    }
    for answer in attempt.answers:
        snap_q = qindex.get(answer.question_id)
        if snap_q is None:
            continue
        qtype = ApQuestionType(snap_q["type"])
        if qtype in UNSCORED_TYPES:
            answer.is_correct = None
            answer.auto_marks = None
            continue
        negative = _effective_negative(snapshot, snap_q)
        result = evaluate_answer(qtype, snap_q.get("config", {}), answer.response, snap_q["marks"], negative)
        if result["needsManual"]:
            answer.is_correct = None
            answer.auto_marks = None
            # awarded_marks left as-is (None = pending, or an existing grade)
        else:
            answer.is_correct = result["isCorrect"]
            answer.auto_marks = result["awarded"]
            answer.awarded_marks = result["awarded"]


def recompute_attempt_totals(attempt: ApAttempt) -> list[dict[str, Any]]:
    """Recompute auto/manual/total/percentage/result_status + per-section breakdown.

    Used after auto-scoring (submit) and after each manual grade. Returns the
    section breakdown for the scorecard. Drives attempt.status (GRADED once no
    manual item is pending, else SUBMITTED).
    """
    from app.db.models import ApAttemptStatus

    snapshot = attempt.snapshot or {}
    answers_by_q = {a.question_id: a for a in attempt.answers}
    max_score = 0.0
    auto_sum = 0.0
    manual_sum = 0.0
    pending = False
    breakdown: list[dict[str, Any]] = []

    for section in snapshot.get("sections", []):
        sec_awarded = 0.0
        sec_max = 0.0
        sec_pending = False
        for snap_q in section.get("questions", []):
            qtype = ApQuestionType(snap_q["type"])
            if qtype in UNSCORED_TYPES:
                continue
            marks = float(snap_q.get("marks") or 0.0)
            max_score += marks
            sec_max += marks
            answer = answers_by_q.get(snap_q["id"])
            awarded = answer.awarded_marks if answer else None
            if is_auto_scored(qtype, snap_q.get("config", {})):
                value = awarded if awarded is not None else 0.0
                auto_sum += value
                sec_awarded += value
            elif awarded is None:
                pending = True
                sec_pending = True
            else:
                manual_sum += awarded
                sec_awarded += awarded
        cutoff = section.get("cutoffMark")
        breakdown.append(
            {
                "sectionId": section.get("id"),
                "title": section.get("title"),
                "awarded": round(sec_awarded, 4),
                "maxMarks": round(sec_max, 4),
                "cutoffMark": cutoff,
                "cutoffMet": True if cutoff is None else (sec_awarded >= cutoff),
                "pending": sec_pending,
            }
        )

    total = round(auto_sum + manual_sum, 4)
    attempt.auto_score = round(auto_sum, 4)
    attempt.manual_score = round(manual_sum, 4)
    attempt.max_score = round(max_score, 4)
    attempt.total_score = total
    attempt.percentage = round(total / max_score * 100, 2) if max_score > 0 else 0.0

    if pending:
        attempt.result_status = "pending"
    else:
        pass_pct = snapshot.get("passPercentage")
        cutoffs_ok = all(sb["cutoffMet"] for sb in breakdown)
        passed = (pass_pct is None or attempt.percentage >= pass_pct) and cutoffs_ok
        attempt.result_status = "pass" if passed else "fail"

    if attempt.submitted_at is not None:
        attempt.status = ApAttemptStatus.SUBMITTED if pending else ApAttemptStatus.GRADED
        if not pending and attempt.graded_at is None:
            attempt.graded_at = _utcnow()
    return breakdown


def attempt_has_pending_manual(attempt: ApAttempt) -> bool:
    snapshot = attempt.snapshot or {}
    answers_by_q = {a.question_id: a for a in attempt.answers}
    for section in snapshot.get("sections", []):
        for snap_q in section.get("questions", []):
            qtype = ApQuestionType(snap_q["type"])
            if qtype in UNSCORED_TYPES or is_auto_scored(qtype, snap_q.get("config", {})):
                continue
            answer = answers_by_q.get(snap_q["id"])
            if answer is None or answer.awarded_marks is None:
                return True
    return False


# ─────────────────────────────── serializers ─────────────────────────────────


def taker_safe_config(config: dict[str, Any] | None) -> dict[str, Any]:
    return {k: v for k, v in (config or {}).items() if k not in _TAKER_HIDDEN_CONFIG_KEYS}


def serialize_question(question: ApQuestion, *, include_answer_key: bool = True) -> dict[str, Any]:
    config = question.config or {}
    return {
        "id": question.id,
        "assessmentId": question.assessment_id,
        "sectionId": question.section_id,
        "bankQuestionId": question.bank_question_id,
        "type": question.type.value,
        "prompt": question.prompt,
        "config": config if include_answer_key else taker_safe_config(config),
        "marks": question.marks,
        "negativeMarks": question.negative_marks,
        "orderIndex": question.order_index,
        "isRequired": question.is_required,
        "mediaUrl": question.media_url,
        "autoScored": is_auto_scored(question.type, config),
    }


def serialize_section(section: ApSection, *, include_questions: bool = True) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": section.id,
        "assessmentId": section.assessment_id,
        "title": section.title,
        "instructions": section.instructions,
        "orderIndex": section.order_index,
        "timeLimitMinutes": section.time_limit_minutes,
        "cutoffMark": section.cutoff_mark,
        "weightage": section.weightage,
        "lockAfterLeave": section.lock_after_leave,
        "randomizeQuestions": section.randomize_questions,
        "pickCount": section.pick_count,
    }
    if include_questions:
        data["questions"] = [serialize_question(q) for q in sorted(section.questions, key=lambda q: q.order_index)]
    return data


def serialize_assessment(assessment: ApAssessment, *, include_structure: bool = False) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": assessment.id,
        "title": assessment.title,
        "description": assessment.description,
        "instructions": assessment.instructions,
        "consentText": assessment.consent_text,
        "status": assessment.status.value,
        "timeLimitMinutes": assessment.time_limit_minutes,
        "attemptsAllowed": assessment.attempts_allowed,
        "randomizeSections": assessment.randomize_sections,
        "randomizeQuestions": assessment.randomize_questions,
        "shuffleOptions": assessment.shuffle_options,
        "negativeMarking": assessment.negative_marking,
        "negativeFactor": assessment.negative_factor,
        "passPercentage": assessment.pass_percentage,
        "totalMarks": assessment.total_marks,
        "showResultsToCandidate": assessment.show_results_to_candidate,
        "availableFrom": assessment.available_from.isoformat() if assessment.available_from else None,
        "availableUntil": assessment.available_until.isoformat() if assessment.available_until else None,
        "settings": assessment.settings,
        "positionId": assessment.position_id,
        "createdBy": assessment.created_by,
        "createdAt": assessment.created_at.isoformat() if assessment.created_at else None,
        "updatedAt": assessment.updated_at.isoformat() if assessment.updated_at else None,
        "sectionCount": len(assessment.sections),
        "questionCount": sum(len(s.questions) for s in assessment.sections),
    }
    if include_structure:
        data["sections"] = [
            serialize_section(s) for s in sorted(assessment.sections, key=lambda s: s.order_index)
        ]
    return data


def serialize_question_bank(item: Any) -> dict[str, Any]:
    return {
        "id": item.id,
        "type": item.type.value,
        "prompt": item.prompt,
        "config": item.config or {},
        "defaultMarks": item.default_marks,
        "tags": item.tags or [],
        "difficulty": item.difficulty,
        "skill": item.skill,
        "isArchived": item.is_archived,
        "createdBy": item.created_by,
        "autoScored": is_auto_scored(item.type, item.config or {}),
        "createdAt": item.created_at.isoformat() if item.created_at else None,
    }


def serialize_assignment(assignment: ApAssignment) -> dict[str, Any]:
    user = assignment.user
    candidate = assignment.candidate
    return {
        "id": assignment.id,
        "assessmentId": assignment.assessment_id,
        "email": assignment.email,
        "userId": assignment.user_id,
        "candidateId": assignment.candidate_id,
        "name": (candidate.full_name if candidate else None) or (user.name if user else None),
        "status": assignment.status.value,
        "provisioned": assignment.provisioned,
        "attemptsUsed": assignment.attempts_used,
        "invitedAt": assignment.invited_at.isoformat() if assignment.invited_at else None,
        "lastInvitedAt": assignment.last_invited_at.isoformat() if assignment.last_invited_at else None,
        "expiresAt": assignment.expires_at.isoformat() if assignment.expires_at else None,
        "hasAccount": assignment.user_id is not None,
    }


def remaining_seconds(attempt: ApAttempt) -> int | None:
    if attempt.expires_at is None:
        return None
    delta = (ensure_aware(attempt.expires_at) - _utcnow()).total_seconds()
    return max(0, int(delta))


def serialize_answer(answer: ApAnswer, *, include_grading: bool = True) -> dict[str, Any]:
    data: dict[str, Any] = {
        "questionId": answer.question_id,
        "response": answer.response,
        "clientRev": answer.client_rev,
        "fileName": answer.file_name,
        "fileUrl": answer.file_url,
    }
    if include_grading:
        data.update(
            {
                "isCorrect": answer.is_correct,
                "autoMarks": answer.auto_marks,
                "manualMarks": answer.manual_marks,
                "awardedMarks": answer.awarded_marks,
                "feedback": answer.feedback,
                "gradedBy": answer.graded_by,
            }
        )
    return data


def serialize_attempt_summary(attempt: ApAttempt) -> dict[str, Any]:
    assignment = attempt.assignment
    user = attempt.user
    return {
        "id": attempt.id,
        "assignmentId": attempt.assignment_id,
        "assessmentId": attempt.assessment_id,
        "userId": attempt.user_id,
        "email": assignment.email if assignment else (user.email if user else None),
        "name": user.name if user else None,
        "status": attempt.status.value,
        "startedAt": attempt.started_at.isoformat() if attempt.started_at else None,
        "submittedAt": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
        "autoScore": attempt.auto_score,
        "manualScore": attempt.manual_score,
        "totalScore": attempt.total_score,
        "maxScore": attempt.max_score,
        "percentage": attempt.percentage,
        "resultStatus": attempt.result_status,
        "gradedAt": attempt.graded_at.isoformat() if attempt.graded_at else None,
        "proctoring": proctoring_counts(attempt),
        "overallFeedback": attempt.overall_feedback,
        "resultFinalized": attempt.result_finalized_at is not None,
        "resultReleased": attempt.result_released_at is not None,
    }


def serialize_my_attempt(attempt: ApAttempt) -> dict[str, Any]:
    """Candidate-facing attempt view. NOTHING about the result (score or verdict) is
    revealed until HR releases it; the score is shown only if the assessment also has
    'show results to candidate' on."""
    released = attempt.result_released_at is not None
    result_visible = released
    show_score = released and bool((attempt.snapshot or {}).get("showResultsToCandidate"))
    return {
        "id": attempt.id,
        "status": attempt.status.value,
        "startedAt": attempt.started_at.isoformat() if attempt.started_at else None,
        "submittedAt": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
        "released": released,
        "resultStatus": attempt.result_status if result_visible else None,
        "totalScore": attempt.total_score if show_score else None,
        "maxScore": attempt.max_score if show_score else None,
        "percentage": attempt.percentage if show_score else None,
    }


def serialize_taker_attempt(attempt: ApAttempt) -> dict[str, Any]:
    """Candidate-facing player payload — snapshot questions with answer keys stripped."""
    snapshot = attempt.snapshot or {}
    answers = {a.question_id: serialize_answer(a, include_grading=False) for a in attempt.answers}
    sections = []
    for section in snapshot.get("sections", []):
        questions = [
            {
                "id": q["id"],
                "type": q["type"],
                "prompt": q["prompt"],
                "marks": q["marks"],
                "isRequired": q["isRequired"],
                "mediaUrl": q.get("mediaUrl"),
                "config": taker_safe_config(q.get("config")),
            }
            for q in section.get("questions", [])
        ]
        sections.append(
            {
                "id": section.get("id"),
                "title": section.get("title"),
                "instructions": section.get("instructions"),
                "timeLimitMinutes": section.get("timeLimitMinutes"),
                "lockAfterLeave": section.get("lockAfterLeave"),
                "questions": questions,
            }
        )
    show_results = bool(snapshot.get("showResultsToCandidate"))
    # Release-gated candidate view: until HR releases the result, no score/verdict is
    # exposed (and HR-only fields like feedback/proctoring are never sent).
    candidate_result = (
        serialize_my_attempt(attempt) if attempt.status is not ApAttemptStatus.IN_PROGRESS else None
    )
    return {
        "attemptId": attempt.id,
        "assignmentId": attempt.assignment_id,
        "assessmentId": attempt.assessment_id,
        "title": snapshot.get("title"),
        "instructions": snapshot.get("instructions"),
        "consentText": snapshot.get("consentText"),
        "timeLimitMinutes": snapshot.get("timeLimitMinutes"),
        "status": attempt.status.value,
        "remainingSeconds": remaining_seconds(attempt),
        "showResultsToCandidate": show_results,
        "proctoring": snapshot.get("proctoring") or proctoring_config(None),
        "proctoringCounts": proctoring_counts(attempt),
        "sections": sections,
        "answers": answers,
        "result": candidate_result,
    }


def serialize_scorecard(attempt: ApAttempt) -> dict[str, Any]:
    """Staff scorecard / grading view — full per-question detail incl. answer keys."""
    snapshot = attempt.snapshot or {}
    answers = {a.question_id: a for a in attempt.answers}
    sections_out = []
    for section in snapshot.get("sections", []):
        questions_out = []
        sec_awarded = 0.0
        sec_max = 0.0
        for snap_q in section.get("questions", []):
            qtype = ApQuestionType(snap_q["type"])
            scored = qtype not in UNSCORED_TYPES
            auto = is_auto_scored(qtype, snap_q.get("config", {}))
            marks = float(snap_q.get("marks") or 0.0)
            answer = answers.get(snap_q["id"])
            awarded = answer.awarded_marks if answer else None
            if scored:
                sec_max += marks
                if awarded is not None:
                    sec_awarded += awarded
            questions_out.append(
                {
                    "id": snap_q["id"],
                    "type": snap_q["type"],
                    "prompt": snap_q["prompt"],
                    "marks": marks,
                    "scored": scored,
                    "autoScored": auto,
                    "config": snap_q.get("config", {}),
                    "response": answer.response if answer else None,
                    "fileName": answer.file_name if answer else None,
                    "fileUrl": answer.file_url if answer else None,
                    "awardedMarks": awarded,
                    "isCorrect": answer.is_correct if answer else None,
                    "feedback": answer.feedback if answer else None,
                    "needsManual": scored and not auto and awarded is None,
                }
            )
        cutoff = section.get("cutoffMark")
        sections_out.append(
            {
                "sectionId": section.get("id"),
                "title": section.get("title"),
                "awarded": round(sec_awarded, 4),
                "maxMarks": round(sec_max, 4),
                "cutoffMark": cutoff,
                "cutoffMet": True if cutoff is None else (sec_awarded >= cutoff),
                "questions": questions_out,
            }
        )
    return {"attempt": serialize_attempt_summary(attempt), "sections": sections_out}


# ──────────────── Google Sheet sync (responses) + bulk result import ──────────


def extract_spreadsheet_id(value: str | None) -> str:
    """Accept a full Google Sheets URL or a bare spreadsheet id."""
    if not value:
        return ""
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", value)
    return match.group(1) if match else value.strip()


def sheet_sync_config(settings: dict[str, Any] | None) -> dict[str, Any]:
    raw = (settings or {}).get("sheetSync") or {}
    spreadsheet_id = (raw.get("spreadsheetId") or "").strip() or extract_spreadsheet_id(raw.get("spreadsheetUrl"))
    return {
        "enabled": bool(raw.get("enabled")) and bool(spreadsheet_id),
        "spreadsheetId": spreadsheet_id,
        "spreadsheetUrl": raw.get("spreadsheetUrl"),
        "tabName": (raw.get("tabName") or "").strip() or "Form Responses",
    }


def _answer_display(qtype: ApQuestionType, config: dict[str, Any], answer: ApAnswer | None) -> str:
    """Human-readable answer text for a spreadsheet cell."""
    if answer is None:
        return ""
    if qtype is ApQuestionType.FILE_UPLOAD:
        return answer.file_url or answer.file_name or ""
    response = answer.response or {}
    options = config.get("options") if isinstance(config.get("options"), list) else []
    id_to_text = {o.get("id"): o.get("text") for o in options if isinstance(o, dict)}
    if qtype is ApQuestionType.MCQ_SINGLE:
        return str(id_to_text.get(response.get("optionId"), response.get("optionId") or ""))
    if qtype is ApQuestionType.MCQ_MULTI:
        return ", ".join(str(id_to_text.get(i, i)) for i in (response.get("optionIds") or []))
    if qtype is ApQuestionType.TRUE_FALSE:
        val = response.get("value")
        return "" if val is None else ("True" if val else "False")
    if qtype is ApQuestionType.URL_SUBMISSION:
        return str(response.get("url") or "")
    return str(response.get("text") or response.get("value") or "")


def build_sheet_payload(attempt: ApAttempt, assessment: ApAssessment) -> tuple[list[str], list[Any]]:
    """Google-Forms-style (headers, row): Timestamp, Email, Score, then one column
    per question (in the assessment's canonical order, so columns stay stable)."""
    questions: list[ApQuestion] = []
    for section in sorted(assessment.sections, key=lambda s: s.order_index):
        questions.extend(sorted(section.questions, key=lambda q: q.order_index))
    headers = ["Timestamp", "Email Address", "Score", *[q.prompt for q in questions]]
    answers = {a.question_id: a for a in attempt.answers}
    email = (attempt.assignment.email if attempt.assignment else None) or (attempt.user.email if attempt.user else "")
    submitted = attempt.submitted_at or _utcnow()
    score = attempt.total_score if attempt.total_score is not None else (attempt.auto_score or 0)
    row: list[Any] = [format_app_datetime(ensure_aware(submitted)), email, score]
    for question in questions:
        row.append(_answer_display(question.type, question.config or {}, answers.get(question.id)))
    return headers, row


def apply_final_result(
    attempt: ApAttempt, *, score: float, feedback: str | None, actor: Any, verdict: str | None = None
) -> None:
    """Lock in HR's final score + feedback (from the bulk CSV). The optional verdict
    ('pass'/'fail') overrides the pass-% computation; otherwise it's derived from the
    score. Marks the attempt graded + stamps result_finalized_at."""
    attempt.total_score = round(float(score), 4)
    if feedback is not None:
        attempt.overall_feedback = feedback
    max_score = attempt.max_score or 0.0
    attempt.percentage = round(attempt.total_score / max_score * 100, 2) if max_score else 0.0
    if verdict in ("pass", "fail"):
        attempt.result_status = verdict
    else:
        pass_pct = (attempt.snapshot or {}).get("passPercentage")
        attempt.result_status = "pass" if (pass_pct is None or attempt.percentage >= pass_pct) else "fail"
    attempt.status = ApAttemptStatus.GRADED
    attempt.graded_by = getattr(actor, "id", None)
    attempt.graded_at = _utcnow()
    attempt.result_finalized_at = _utcnow()
    if attempt.assignment is not None:
        attempt.assignment.status = ApAssignmentStatus.GRADED
