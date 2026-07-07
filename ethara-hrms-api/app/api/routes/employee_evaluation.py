"""Employee Evaluation module.

Per-employee performance profile (Insight / PMS / Skills), bulk parameter updates
via CSV, filters/export, and dashboard insights. Access is limited to the Employee
Evaluation audience (super_admin, admin, leadership, hr, evaluator); regular
employees only ever see their own skill tags via ``/skills/me``.
"""

import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import require_roles
from app.api.routes.skills import (
    _canonical_skill,
    _csv_safe,
    _load_catalog,
    _normalize_skill,
    _serialize_tags,
)
from app.core.database import get_db
from app.db.models import (
    Candidate,
    EmployeeProfile,
    EmployeeSkillTag,
    Evaluation,
    PiInterviewRound,
    PmsEvaluation,
    Role,
    User,
)

router = APIRouter(prefix="/employee-evaluation", tags=["employee-evaluation"])

EVAL_ACCESS_ROLES = (Role.SUPER_ADMIN, Role.ADMIN, Role.LEADERSHIP, Role.HR, Role.EVALUATOR)
require_eval_access = require_roles(*EVAL_ACCESS_ROLES)


def _ts(value) -> float:
    """None-safe, tz-agnostic ordering key for datetimes."""
    try:
        return value.timestamp() if value else 0.0
    except (AttributeError, ValueError, OSError):
        return 0.0


def _matched_candidates(db: Session, profile: EmployeeProfile) -> list[Candidate]:
    """Best-effort link from an employee to their historical candidate record(s)."""
    profile_emails = {
        email.strip().lower()
        for email in (profile.personal_email, profile.ethara_email)
        if email and email.strip()
    }
    conditions = []
    if profile.employee_code:
        conditions.append(Candidate.candidate_code == profile.employee_code)
        conditions.append(Candidate.employee_code == profile.employee_code)
    if profile.aadhaar_hash:
        conditions.append(Candidate.aadhaar_hash == profile.aadhaar_hash)
    if profile_emails:
        conditions.append(func.lower(func.coalesce(Candidate.personal_email, "")).in_(profile_emails))
        conditions.append(func.lower(func.coalesce(Candidate.ethara_email, "")).in_(profile_emails))
    if profile.user_id:
        conditions.append(Candidate.portal_user_id == profile.user_id)
    if not conditions:
        return []
    return list(
        db.scalars(
            select(Candidate)
            .where(or_(*conditions))
            .options(
                joinedload(Candidate.position),
                selectinload(Candidate.assessments),
                selectinload(Candidate.evaluations),
            )
            .order_by(Candidate.created_at.desc())
        ).unique()
    )


def _latest_evaluation(candidates: list[Candidate]) -> Evaluation | None:
    """Most recent interview Evaluation (fallback source for the PI score)."""
    best: Evaluation | None = None
    for candidate in candidates:
        for evaluation in candidate.evaluations or []:
            if best is None or _ts(evaluation.created_at) > _ts(best.created_at):
                best = evaluation
    return best


def _build_profile(db: Session, employee_id: str) -> dict:
    profile = db.scalar(
        select(EmployeeProfile)
        .options(joinedload(EmployeeProfile.user))
        .where(EmployeeProfile.id == employee_id)
    )
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    _, label_map = _load_catalog(db)
    skill_tags = list(
        db.scalars(select(EmployeeSkillTag).where(EmployeeSkillTag.employee_profile_id == employee_id))
    )
    skills = _serialize_tags(skill_tags, label_map)

    candidates = _matched_candidates(db, profile)
    linked_candidate = candidates[0] if candidates else None
    best_eval = _latest_evaluation(candidates)

    # Latest assessment carrying a score + verdict (candidate-derived fallback).
    best_assessment = None
    for candidate in candidates:
        for assessment in candidate.assessments or []:
            if assessment.total_score is None and not assessment.decision:
                continue
            key = _ts(assessment.updated_at or assessment.created_at)
            if best_assessment is None or key > _ts(best_assessment.updated_at or best_assessment.created_at):
                best_assessment = assessment

    # Latest PI round (candidate-derived fallback for verdict + score).
    pi_round = None
    candidate_ids = [c.id for c in candidates]
    if candidate_ids:
        pi_round = db.scalar(
            select(PiInterviewRound)
            .where(PiInterviewRound.candidate_id.in_(candidate_ids))
            .order_by(PiInterviewRound.round_number.desc(), PiInterviewRound.created_at.desc())
        )

    # Effective values: the employee-level override wins; otherwise fall back to
    # the linked candidate's recruitment record.
    def _eff(override, fallback):
        return override if override is not None else fallback

    assessment_score = _eff(
        profile.assessment_score, best_assessment.total_score if best_assessment else None
    )
    assessment_verdict = _eff(
        profile.assessment_verdict, best_assessment.decision if best_assessment else None
    )
    pi_score = _eff(
        profile.pi_score,
        best_eval.pi_score if (best_eval and best_eval.pi_score is not None)
        else (pi_round.score if pi_round else None),
    )
    pi_verdict = _eff(profile.pi_verdict, pi_round.final_verdict if pi_round else None)

    assessment_out = (
        {"score": assessment_score, "verdict": assessment_verdict}
        if (assessment_score is not None or assessment_verdict)
        else None
    )

    # Latest PMS record for the employee.
    pms_record = db.scalar(
        select(PmsEvaluation)
        .where(PmsEvaluation.employee_id == employee_id)
        .order_by(PmsEvaluation.created_at.desc())
    )
    pms_out = (
        {
            "totalScore": pms_record.total_score,
            "averageScore": pms_record.average_score,
            "overallRating": pms_record.overall_rating,
            "submittedAt": pms_record.submitted_at.isoformat() if pms_record.submitted_at else None,
        }
        if pms_record
        else None
    )

    employee_out = {
        "id": profile.id,
        "name": profile.full_name,
        "employeeCode": profile.employee_code,
        "etharaEmail": profile.ethara_email,
        "personalEmail": profile.personal_email,
        "department": profile.department,
        "designation": profile.designation,
        "evaluationVerdict": profile.evaluation_verdict,
    }

    # Compact, PII-light payload for the AI insight prompt.
    ai_input = {
        "designation": profile.designation,
        "department": profile.department,
        "skills": [{"skill": s["label"], "rating": s["rating"]} for s in skills],
        "pmsScore": pms_out["totalScore"] if pms_out else None,
        "pmsRating": pms_out["overallRating"] if pms_out else None,
        "assessment": assessment_out,
        "piScore": pi_score,
        "piVerdict": pi_verdict,
        "finalVerdict": profile.evaluation_verdict,
    }

    return {
        "employee": employee_out,
        "linkedCandidateId": linked_candidate.id if linked_candidate else None,
        "assessment": assessment_out,
        "piScore": pi_score,
        "piVerdict": pi_verdict,
        "pms": pms_out,
        "skills": skills,
        "aiInput": ai_input,
    }


def _collect_rows(
    db: Session,
    *,
    search=None,
    department=None,
    designation=None,
    verdict=None,
    assessment_verdict=None,
    pi_verdict=None,
    skill=None,
    min_rating=None,
    has_skills=None,
) -> list[dict]:
    """Employee rows for the list/export, filtered on the stored employee-level
    evaluation fields (fast; no per-employee candidate reconciliation)."""
    _, label_map = _load_catalog(db)
    skills_by_emp: dict[str, list] = {}
    for tag in db.scalars(select(EmployeeSkillTag)).all():
        skills_by_emp.setdefault(tag.employee_profile_id, []).append(tag)
    employees = db.scalars(select(EmployeeProfile).order_by(EmployeeProfile.full_name.asc())).all()

    needle = (search or "").strip().lower()
    dept = (department or "").strip().lower()
    desig = (designation or "").strip().lower()
    fverdict = (verdict or "").strip().lower()
    averdict = (assessment_verdict or "").strip().lower()
    pverdict = (pi_verdict or "").strip().lower()
    # `skill` accepts a comma-separated list; an employee matches if they hold ANY
    # of the selected skills (min_rating applies to those matching tags).
    skill_keys: set[str] = set()
    for raw in (skill or "").split(","):
        key = _normalize_skill(raw, label_map) if raw.strip() else None
        if key:
            skill_keys.add(key)

    rows: list[dict] = []
    for e in employees:
        tags = skills_by_emp.get(e.id, [])
        if needle:
            hay = " ".join(
                filter(None, [e.full_name, e.employee_code, e.ethara_email, e.department, e.designation])
            ).lower()
            if needle not in hay:
                continue
        if dept and dept not in (e.department or "").lower():
            continue
        if desig and desig not in (e.designation or "").lower():
            continue
        if fverdict and (e.evaluation_verdict or "").lower() != fverdict:
            continue
        if averdict and averdict not in (e.assessment_verdict or "").lower():
            continue
        if pverdict and pverdict not in (e.pi_verdict or "").lower():
            continue
        if skill_keys:
            matching = [t for t in tags if _canonical_skill(t.skill) in skill_keys]
            if not matching:
                continue
            if min_rating and all(t.rating < min_rating for t in matching):
                continue
        elif min_rating and not any(t.rating >= min_rating for t in tags):
            continue
        if has_skills is True and not tags:
            continue
        if has_skills is False and tags:
            continue
        rows.append(
            {
                "id": e.id,
                "name": e.full_name,
                "employeeCode": e.employee_code,
                "department": e.department,
                "designation": e.designation,
                "evaluationVerdict": e.evaluation_verdict,
                "assessmentScore": e.assessment_score,
                "assessmentVerdict": e.assessment_verdict,
                "piScore": e.pi_score,
                "piVerdict": e.pi_verdict,
                "skillCount": len(tags),
                "skills": _serialize_tags(tags, label_map),
            }
        )
    return rows


# Shared filter query params for list + export.
def _filter_params(
    search: str | None = Query(default=None),
    department: str | None = Query(default=None),
    designation: str | None = Query(default=None),
    verdict: str | None = Query(default=None),
    assessment_verdict: str | None = Query(default=None, alias="assessmentVerdict"),
    pi_verdict: str | None = Query(default=None, alias="piVerdict"),
    skill: str | None = Query(default=None),
    min_rating: int | None = Query(default=None, alias="minRating", ge=1, le=5),
    has_skills: bool | None = Query(default=None, alias="hasSkills"),
) -> dict:
    return {
        "search": search,
        "department": department,
        "designation": designation,
        "verdict": verdict,
        "assessment_verdict": assessment_verdict,
        "pi_verdict": pi_verdict,
        "skill": skill,
        "min_rating": min_rating,
        "has_skills": has_skills,
    }


@router.get("/employees")
def list_employees(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_eval_access)],
    filters: Annotated[dict, Depends(_filter_params)],
):
    return _collect_rows(db, **filters)


@router.get("/export")
def export_employees(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_eval_access)],
    filters: Annotated[dict, Depends(_filter_params)],
):
    rows = _collect_rows(db, **filters)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "Employee Code", "Name", "Department", "Designation", "Final Verdict",
        "Assessment Score", "Assessment Verdict", "PI Score", "PI Verdict", "Skill Tags",
    ])
    for r in rows:
        skills_text = "; ".join(f"{s['label']} ({s['rating']}/5)" for s in r["skills"]) or ""
        writer.writerow([
            _csv_safe(r["employeeCode"]), _csv_safe(r["name"]), _csv_safe(r["department"]),
            _csv_safe(r["designation"]), _csv_safe(r["evaluationVerdict"]),
            _csv_safe(r["assessmentScore"]), _csv_safe(r["assessmentVerdict"]),
            _csv_safe(r["piScore"]), _csv_safe(r["piVerdict"]),
            _csv_safe(skills_text),
        ])
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="employee_evaluation_export.csv"'},
    )


@router.post("/{employee_id}/insight")
def employee_insight(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_eval_access)],
):
    profile = _build_profile(db, employee_id)
    from app.services.integrations import LLMService

    try:
        analysis = LLMService().analyze_employee_performance(profile["aiInput"])
    except Exception as exc:  # noqa: BLE001 -- surface a graceful 503 to the UI
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI analysis unavailable: {exc}",
        ) from exc
    return {"employeeId": employee_id, "analysis": analysis}


# ---------------------------------------------------------------------------
# Bulk employee-parameter update (CSV in -> annotated CSV out).
# ---------------------------------------------------------------------------

# Fixed columns. Skill columns ("Skill: <label>") are appended dynamically from
# the catalog. Every field is OPTIONAL: a blank cell is left untouched.
_BULK_BASE = [
    "Employee Code", "Email",
    "Assessment Score", "Assessment Verdict",
    "PI Verdict", "Final Verdict",
]
# header (lowercased) -> employee attribute, for the numeric 0-100 fields.
_NUMERIC_FIELDS = {
    "assessment score": "assessment_score",
}
# header (lowercased) -> employee attribute, for the verdict fields. "final
# verdict" is validated to pass/fail below.
_STRING_FIELDS = {
    "assessment verdict": "assessment_verdict",
    "pi verdict": "pi_verdict",
    "final verdict": "evaluation_verdict",
}


@router.get("/bulk-template")
def bulk_template(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_eval_access)],
):
    catalog, _lm = _load_catalog(db)
    skill_cols = [f"Skill: {item['label']}" for item in catalog]
    header = [*_BULK_BASE, *skill_cols]
    example = ["GRP1001", "", "78", "pass", "selected", "pass"] + ["" for _ in skill_cols]
    example2 = ["", "employee@ethara.ai", "", "", "", ""] + (["4"] + ["" for _ in skill_cols[1:]] if skill_cols else [])
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerow(example)
    writer.writerow(example2)
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="employee_evaluation_template.csv"'},
    )


def _get_column(row: dict, *names: str) -> str:
    lowered = {str(key or "").strip().lower(): value for key, value in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


@router.post("/bulk-upload")
async def bulk_upload_scores(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_eval_access)],
    file: Annotated[UploadFile, File(...)],
):
    """Partial-update every employee parameter from the template. Any blank cell is
    left untouched; scores/verdicts write to the employee-level fields and skill
    columns upsert star ratings. Final Verdict must be pass/fail. Returns an
    annotated result CSV (Status + Remark per row)."""
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload a UTF-8 CSV file (use the provided template).",
        ) from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The file has no header row.")

    _, label_map = _load_catalog(db)
    # Map "Skill: <name>" headers to canonical catalog keys.
    skill_columns: dict[str, str] = {}
    for header in reader.fieldnames:
        hl = str(header or "").strip().lower()
        if hl.startswith("skill:"):
            key = _normalize_skill(header.split(":", 1)[1], label_map)
            if key:
                skill_columns[header] = key

    employees = db.scalars(select(EmployeeProfile)).all()
    by_code = {str(e.employee_code or "").strip().lower(): e for e in employees if e.employee_code}
    by_email: dict[str, EmployeeProfile] = {}
    for e in employees:
        for email in (e.ethara_email, e.personal_email):
            if email:
                by_email.setdefault(email.strip().lower(), e)

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([*reader.fieldnames, "Status", "Remark"])
    counts = {"updated": 0, "skipped": 0, "failed": 0}

    for row in reader:
        values = [row.get(h, "") for h in reader.fieldnames]
        if not any(str(v).strip() for v in values):
            continue
        code = _get_column(row, "Employee Code", "Code", "Emp Code")
        email = _get_column(row, "Email", "Ethara Email", "Official Email", "Personal Email")

        def emit(statustext: str, remark: str) -> None:
            counts[statustext] = counts.get(statustext, 0) + 1
            writer.writerow([*[_csv_safe(v) for v in values], statustext, remark])

        employee = by_code.get(code.lower()) if code else None
        if employee is None and email:
            employee = by_email.get(email.lower())
        if employee is None:
            emit("failed", "Employee not found by code or email.")
            continue

        lowered = {str(k or "").strip().lower(): v for k, v in row.items()}
        applied: list[str] = []
        errors: list[str] = []

        # Each row runs in its own SAVEPOINT so a single bad value (bad length,
        # constraint violation, ...) is flagged for that row instead of 500-ing the
        # whole upload.
        try:
            with db.begin_nested():
                for header_l, attr in _NUMERIC_FIELDS.items():
                    v = lowered.get(header_l)
                    if v is None or not str(v).strip():
                        continue
                    try:
                        num = float(str(v).strip())
                    except ValueError:
                        errors.append(f"{header_l}: not a number")
                        continue
                    if num < 0 or num > 100:
                        errors.append(f"{header_l}: must be 0-100")
                        continue
                    setattr(employee, attr, num)
                    applied.append(header_l)

                for header_l, attr in _STRING_FIELDS.items():
                    v = lowered.get(header_l)
                    if v is None or not str(v).strip():
                        continue
                    val = str(v).strip()
                    if attr == "evaluation_verdict":
                        val = val.lower()
                        if val not in ("pass", "fail"):
                            errors.append(f"{header_l}: must be pass or fail")
                            continue
                    # assessment/pi verdict are free-text (TEXT columns) — accept as-is.
                    setattr(employee, attr, val)
                    applied.append(header_l)

                for header, key in skill_columns.items():
                    v = row.get(header)
                    if v is None or not str(v).strip():
                        continue
                    try:
                        rating = int(float(str(v).strip()))
                    except ValueError:
                        errors.append(f"{header}: not a number")
                        continue
                    if rating < 1 or rating > 5:
                        errors.append(f"{header}: rating must be 1-5")
                        continue
                    tag = db.scalar(
                        select(EmployeeSkillTag).where(
                            EmployeeSkillTag.employee_profile_id == employee.id,
                            EmployeeSkillTag.skill == key,
                        )
                    )
                    if tag:
                        tag.rating = rating
                        tag.tagged_by = current_user.id
                        db.add(tag)
                    else:
                        db.add(
                            EmployeeSkillTag(
                                employee_profile_id=employee.id,
                                skill=key,
                                rating=rating,
                                tagged_by=current_user.id,
                            )
                        )
                    applied.append(label_map.get(key, key))

                db.flush()
        except Exception as exc:  # noqa: BLE001 -- report per-row, never 500 the batch
            emit("failed", f"Could not save row ({type(exc).__name__}).")
            continue

        remark_parts = []
        if applied:
            remark_parts.append("Updated: " + ", ".join(applied))
        if errors:
            remark_parts.append("Errors: " + "; ".join(errors))
        if applied:
            emit("updated", " | ".join(remark_parts))
        elif errors:
            emit("failed", " | ".join(remark_parts))
        else:
            emit("skipped", "No fields to update (all blank).")

    db.commit()
    return Response(
        content="﻿" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="employee_evaluation_result.csv"',
            "X-Rows-Updated": str(counts["updated"]),
            "X-Rows-Failed": str(counts["failed"]),
            "X-Rows-Skipped": str(counts["skipped"]),
        },
    )


def _composite(row: dict) -> float | None:
    vals = [v for v in (row["assessmentScore"], row["piScore"]) if v is not None]
    return sum(vals) / len(vals) if vals else None


def _highlights(db: Session) -> dict:
    rows = _collect_rows(db)
    total = len(rows)
    verdict_dist: dict[str, int] = {}
    tagged = 0
    for r in rows:
        key = (r["evaluationVerdict"] or "unset").lower()
        verdict_dist[key] = verdict_dist.get(key, 0) + 1
        if r["skillCount"] > 0:
            tagged += 1

    ranked = [(r, c) for r in rows if (c := _composite(r)) is not None]
    ranked.sort(key=lambda pair: pair[1], reverse=True)

    def brief(pair):
        r, c = pair
        return {"id": r["id"], "name": r["name"], "employeeCode": r["employeeCode"], "score": round(c, 1)}

    return {
        "totalEmployees": total,
        "verdictDistribution": verdict_dist,
        "skillTaggedCount": tagged,
        "skillTaggedPct": round(tagged / total * 100) if total else 0,
        "scoredCount": len(ranked),
        "topPerformers": [brief(p) for p in ranked[:5]],
        "atRisk": [brief(p) for p in ranked[-5:][::-1]],
    }


@router.get("/insights/highlights")
def insight_highlights(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_eval_access)],
):
    return _highlights(db)


@router.post("/insights/overview")
def insight_overview(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_eval_access)],
):
    stats = _highlights(db)
    from app.services.integrations import LLMService

    try:
        overview = LLMService().summarize_team_performance(stats)
    except Exception as exc:  # noqa: BLE001 -- graceful 503 to the UI
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI overview unavailable: {exc}",
        ) from exc
    return {"stats": stats, "overview": overview}


# Parameterized catch-all defined LAST so literal paths (/employees, /bulk-*) win.
@router.get("/{employee_id}")
def get_employee_evaluation(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_eval_access)],
):
    return _build_profile(db, employee_id)
