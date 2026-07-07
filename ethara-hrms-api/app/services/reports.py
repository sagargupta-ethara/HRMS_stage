from datetime import UTC, date, datetime, time

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.core.cache import cache
from app.db.models import Candidate, CandidateStage, Escalation, Evaluation, PiInterviewRound, Position


SHORTLISTED_OR_LATER_STAGES = [
    CandidateStage.RESUME_SHORTLISTED,
    CandidateStage.EVALUATION_ASSIGNED,
    CandidateStage.EVALUATION_IN_PROGRESS,
    CandidateStage.EVALUATION_PASSED,
    CandidateStage.SELECTION_FORM_SENT,
    CandidateStage.SELECTION_FORM_SUBMITTED,
    CandidateStage.SELECTION_FORM_VALIDATED,
    CandidateStage.CONTRACT_SENT,
    CandidateStage.CONTRACT_SIGNED,
    CandidateStage.ONBOARDING_COMPLETED,
]

PENDING_EVALUATION_STAGES = [
    CandidateStage.EVALUATION_ASSIGNED,
    CandidateStage.EVALUATION_IN_PROGRESS,
]

REJECTED_STAGES = [
    CandidateStage.RESUME_REJECTED,
    CandidateStage.EVALUATION_FAILED,
]


def _date_bounds(created_from: date | None, created_to: date | None) -> tuple[datetime | None, datetime | None]:
    start = datetime.combine(created_from, time.min, tzinfo=UTC) if created_from else None
    end = datetime.combine(created_to, time.max, tzinfo=UTC) if created_to else None
    return start, end


def _candidate_date_filters(created_from: date | None, created_to: date | None) -> list:
    start, end = _date_bounds(created_from, created_to)
    filters = []
    if start is not None:
        filters.append(Candidate.created_at >= start)
    if end is not None:
        filters.append(Candidate.created_at <= end)
    return filters


def _active_candidate_filters(created_from: date | None, created_to: date | None) -> list:
    return [Candidate.is_removed.is_(False), *_candidate_date_filters(created_from, created_to)]


def get_dashboard_summary(db: Session, *, created_from: date | None = None, created_to: date | None = None) -> dict:
    ranged = created_from is not None or created_to is not None
    cache_key = "reports:dashboard_summary:v3"
    cached = None if ranged else cache.get_json(cache_key)
    if cached is not None:
        return cached

    month_start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    date_filters = _candidate_date_filters(created_from, created_to)
    candidate_filters = _active_candidate_filters(created_from, created_to)
    total_candidates = db.scalar(select(func.count()).select_from(Candidate).where(*candidate_filters)) or 0
    this_month = (
        db.scalar(select(func.count()).select_from(Candidate).where(Candidate.created_at >= month_start, *candidate_filters)) or 0
    )
    joined = (
        db.scalar(
            select(func.count()).select_from(Candidate).where(
                Candidate.current_stage == CandidateStage.ONBOARDING_COMPLETED,
                *candidate_filters,
            )
        )
        or 0
    )
    active_escalation_query = select(func.count()).select_from(Escalation).where(Escalation.status == "open")
    if date_filters:
        start, end = _date_bounds(created_from, created_to)
        if start is not None:
            active_escalation_query = active_escalation_query.where(Escalation.created_at >= start)
        if end is not None:
            active_escalation_query = active_escalation_query.where(Escalation.created_at <= end)
    active_escalations = db.scalar(active_escalation_query) or 0
    pending_evaluations_query = (
        select(func.count())
        .select_from(Evaluation)
        .join(Candidate, Evaluation.candidate_id == Candidate.id)
        .where(
            Evaluation.completed_at.is_(None),
            Candidate.current_stage.in_(PENDING_EVALUATION_STAGES),
            *candidate_filters,
        )
    )
    pending_evaluations = db.scalar(pending_evaluations_query) or 0
    stage_breakdown = [
        {"currentStage": stage, "_count": count}
        for stage, count in db.execute(
            select(Candidate.current_stage, func.count()).where(*candidate_filters).group_by(Candidate.current_stage)
        ).all()
    ]
    source_breakdown: list[dict] = []
    for source, count in db.execute(
        select(Candidate.source_type, func.count()).where(*candidate_filters).group_by(Candidate.source_type)
    ).all():
        shortlisted = db.scalar(
            select(func.count()).select_from(Candidate).where(
                Candidate.source_type == source,
                Candidate.current_stage.in_(SHORTLISTED_OR_LATER_STAGES),
                *candidate_filters,
            )
        ) or 0
        joined_for_source = db.scalar(
            select(func.count()).select_from(Candidate).where(
                Candidate.source_type == source,
                Candidate.current_stage == CandidateStage.ONBOARDING_COMPLETED,
                *candidate_filters,
            )
        ) or 0
        source_breakdown.append(
            {
                "sourceType": source,
                "_count": count,
                "applied": count,
                "shortlisted": shortlisted,
                "joined": joined_for_source,
            }
        )
    payload = {
        "total_candidates": total_candidates,
        "this_month": this_month,
        "joined": joined,
        "active_escalations": active_escalations,
        "pending_evaluations": pending_evaluations,
        "stage_breakdown": stage_breakdown,
        "source_breakdown": source_breakdown,
    }
    if not ranged:
        cache.set_json(cache_key, payload, ttl=30)
    return payload


def get_hiring_funnel(db: Session, *, created_from: date | None = None, created_to: date | None = None) -> list[dict]:
    ranged = created_from is not None or created_to is not None
    cache_key = "reports:hiring_funnel:v2"
    cached = None if ranged else cache.get_json(cache_key)
    if cached is not None:
        return cached

    now = datetime.combine(created_to, time.min, tzinfo=UTC) if created_to else datetime.now(UTC)
    earliest = datetime.combine(created_from, time.min, tzinfo=UTC) if created_from else None
    rows: list[dict] = []
    for offset in range(5, -1, -1):
        month = (now.month - offset - 1) % 12 + 1
        year = now.year + ((now.month - offset - 1) // 12)
        start = datetime(year, month, 1, tzinfo=UTC)
        end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=UTC)
        range_start = max(start, earliest) if earliest else start
        range_end = min(end, datetime.combine(created_to, time.max, tzinfo=UTC)) if created_to else end
        if range_start >= range_end:
            rows.append({"month": start.strftime("%b"), "applied": 0, "shortlisted": 0, "joined": 0})
            continue

        range_filters = [
            Candidate.is_removed.is_(False),
            Candidate.created_at >= range_start,
            Candidate.created_at < range_end,
        ]
        applied = db.scalar(
            select(func.count()).select_from(Candidate).where(*range_filters)
        ) or 0
        shortlisted = db.scalar(
            select(func.count()).select_from(Candidate).where(
                *range_filters,
                Candidate.current_stage.in_(
                    [
                        *SHORTLISTED_OR_LATER_STAGES,
                    ]
                ),
            )
        ) or 0
        joined = db.scalar(
            select(func.count()).select_from(Candidate).where(
                *range_filters,
                Candidate.current_stage == CandidateStage.ONBOARDING_COMPLETED,
            )
        ) or 0
        rows.append({"month": start.strftime("%b"), "applied": applied, "shortlisted": shortlisted, "joined": joined})
    if not ranged:
        cache.set_json(cache_key, rows, ttl=60)
    return rows


def get_escalation_metrics(db: Session) -> dict:
    cache_key = "reports:escalation_metrics:v1"
    cached = cache.get_json(cache_key)
    if cached is not None:
        return cached

    total = db.scalar(select(func.count()).select_from(Escalation)) or 0
    open_count = db.scalar(select(func.count()).select_from(Escalation).where(Escalation.status == "open")) or 0
    resolved = db.scalar(select(func.count()).select_from(Escalation).where(Escalation.status == "resolved")) or 0
    by_level = [
        {"escalationLevel": level, "_count": count}
        for level, count in db.execute(
            select(Escalation.escalation_level, func.count()).group_by(Escalation.escalation_level)
        ).all()
    ]
    payload = {"total": total, "open": open_count, "resolved": resolved, "byLevel": by_level}
    cache.set_json(cache_key, payload, ttl=30)
    return payload


def get_pi_summary(db: Session) -> dict:
    cache_key = "reports:pi_summary:v1"
    cached = cache.get_json(cache_key)
    if cached is not None:
        return cached

    total_rounds = db.scalar(select(func.count()).select_from(PiInterviewRound)) or 0
    scheduled = db.scalar(select(func.count()).select_from(PiInterviewRound).where(PiInterviewRound.status == "scheduled")) or 0
    completed = db.scalar(select(func.count()).select_from(PiInterviewRound).where(PiInterviewRound.status.in_(["completed", "no_further_pi_required"]))) or 0
    selected = db.scalar(select(func.count()).select_from(PiInterviewRound).where(PiInterviewRound.final_verdict == "selected")) or 0
    rejected = db.scalar(select(func.count()).select_from(PiInterviewRound).where(PiInterviewRound.final_verdict == "rejected")) or 0

    avg_score_row = db.scalar(select(func.avg(PiInterviewRound.score)).where(PiInterviewRound.score.isnot(None)))
    avg_score = round(float(avg_score_row), 1) if avg_score_row is not None else None

    by_round = [
        {"roundNumber": rn, "count": cnt}
        for rn, cnt in db.execute(
            select(PiInterviewRound.round_number, func.count()).group_by(PiInterviewRound.round_number).order_by(PiInterviewRound.round_number)
        ).all()
    ]

    payload = {
        "totalRounds": total_rounds,
        "scheduled": scheduled,
        "completed": completed,
        "selected": selected,
        "rejected": rejected,
        "avgScore": avg_score,
        "byRound": by_round,
    }
    cache.set_json(cache_key, payload, ttl=60)
    return payload


def get_position_wise_report(db: Session) -> list[dict]:
    cache_key = "reports:position_wise:v2"
    cached = cache.get_json(cache_key)
    if cached is not None:
        return cached

    payload = [
        {
            "id": position.id,
            "title": position.title,
            "department": position.department,
            "description": position.description,
            "urgencyLevel": position.urgency_level,
            "isActive": position.is_active,
            "createdAt": position.created_at,
            "candidateCount": count,
        }
        for position, count in db.execute(
            select(Position, func.count(Candidate.id))
            .outerjoin(
                Candidate,
                and_(
                    Candidate.position_id == Position.id,
                    Candidate.is_removed.is_(False),
                ),
            )
            .group_by(Position.id)
            .order_by(Position.urgency_level.desc(), Position.created_at.desc())
        ).all()
    ]
    cache.set_json(cache_key, payload, ttl=60)
    return payload


def get_domain_wise_report(db: Session) -> list[dict]:
    cache_key = "reports:domain_wise:v1"
    cached = cache.get_json(cache_key)
    if cached is not None:
        return cached

    position_rows = db.execute(
        select(
            Position.department,
            func.count(Position.id),
            func.sum(case((Position.is_active.is_(True), 1), else_=0)),
            func.coalesce(func.sum(Position.openings), 0),
        ).group_by(Position.department)
    ).all()

    stage_rows = db.execute(
        select(Position.department, Candidate.current_stage, func.count())
        .join(Candidate, Candidate.position_id == Position.id)
        .where(Candidate.is_removed.is_(False))
        .group_by(Position.department, Candidate.current_stage)
    ).all()

    unassigned_rows = db.execute(
        select(Candidate.current_stage, func.count())
        .where(Candidate.is_removed.is_(False), Candidate.position_id.is_(None))
        .group_by(Candidate.current_stage)
    ).all()

    shortlisted_or_later = {str(stage) for stage in SHORTLISTED_OR_LATER_STAGES}
    rejected_stages = {str(stage) for stage in REJECTED_STAGES}
    pending_eval_stages = {str(stage) for stage in PENDING_EVALUATION_STAGES}

    domains: dict[str, dict] = {}

    def bucket(department: str) -> dict:
        return domains.setdefault(
            department,
            {
                "department": department,
                "positions": 0,
                "activePositions": 0,
                "openings": 0,
                "candidates": 0,
                "inPipeline": 0,
                "shortlisted": 0,
                "inEvaluation": 0,
                "joined": 0,
                "rejected": 0,
            },
        )

    for department, total, active, openings in position_rows:
        entry = bucket(department or "Unassigned")
        entry["positions"] += int(total or 0)
        entry["activePositions"] += int(active or 0)
        entry["openings"] += int(openings or 0)

    def tally(entry: dict, stage: str, count: int) -> None:
        entry["candidates"] += count
        if stage == str(CandidateStage.ONBOARDING_COMPLETED):
            entry["joined"] += count
        elif stage in rejected_stages:
            entry["rejected"] += count
        else:
            entry["inPipeline"] += count
        if stage in shortlisted_or_later:
            entry["shortlisted"] += count
        if stage in pending_eval_stages:
            entry["inEvaluation"] += count

    for department, stage, count in stage_rows:
        tally(bucket(department or "Unassigned"), str(stage), int(count or 0))
    for stage, count in unassigned_rows:
        tally(bucket("Unassigned"), str(stage), int(count or 0))

    payload = sorted(domains.values(), key=lambda row: row["candidates"], reverse=True)
    for entry in payload:
        entry["conversionRate"] = round(entry["joined"] / entry["candidates"] * 100, 1) if entry["candidates"] else 0.0
    cache.set_json(cache_key, payload, ttl=60)
    return payload
