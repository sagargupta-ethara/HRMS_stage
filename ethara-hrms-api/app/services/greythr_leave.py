"""greytHR leave-balance integration.

The source of truth for leave balances is greytHR. This module owns:

* the storage layer — idempotent upsert / read of ``employee_leave_balances``
  keyed by ``(employee_code, leave_code, year)``;
* ``GreytHRClient`` — the 3-call API contract (token → directory → balance) with
  a cached token (refresh-on-401) and a directory cache (employeeNo → employeeId);
* sync orchestration — ``sync_employee`` / ``sync_all_active`` used by the daily
  cron and the on-demand "refresh now" endpoint.

The client stays INERT until ``settings.greythr_configured`` (creds in env). Until
then the Leave screen renders whatever the storage layer holds — e.g. the verified
GRP1074 seed applied by :func:`apply_seed_balances`.
"""

from __future__ import annotations

import base64
import logging
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import EmployeeLeaveBalance, EmployeeProfile, generate_id, utcnow

logger = logging.getLogger(__name__)

# Canonical display order for the leave types greytHR returns; unknown codes sort
# after these, alphabetically.
LEAVE_CODE_ORDER = ["EL", "SL", "CL", "MAL", "PL", "BL", "WFH", "RH", "COF"]

# Fallback human labels used ONLY when greytHR's own ``description`` is absent
# (e.g. for seeded rows). A live sync always overwrites ``leave_type`` with the
# tenant's actual description.
LEAVE_CODE_LABELS = {
    "EL": "Earned Leave",
    "SL": "Sick Leave",
    "CL": "Casual Leave",
    "MAL": "Maternity Leave",
    "PL": "Paternity Leave",
    "BL": "Bereavement Leave",
    "WFH": "Work From Home",
    "RH": "Restricted Holiday",
    "COF": "Comp Off",
}

# Verified live sample (GRP1074, year 2026). Interim seed so the Leave screen shows
# real numbers before the cron runs; the daily sync overwrites these in place.
# Only ``balance`` is authoritative from the sample, so granted mirrors it and the
# remaining ledger fields stay 0 until greytHR provides them.
SEED_BALANCES: dict[str, dict[str, dict[str, float]]] = {
    "GRP1074": {
        "2026": {
            "EL": 24,
            "SL": 11.58,
            "CL": 4.16,
            "MAL": 5,
            "PL": 5,
            "BL": 3,
            "WFH": 2,
            "RH": 2,
            "COF": 0,
        }
    }
}


def _dec(value: Any) -> float:
    """Coerce a greytHR numeric field to float; balances are decimals, never ints."""
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _order_key(leave_code: str) -> tuple[int, str]:
    code = (leave_code or "").upper()
    if code in LEAVE_CODE_ORDER:
        return (LEAVE_CODE_ORDER.index(code), code)
    return (len(LEAVE_CODE_ORDER), code)


def normalize_balance_row(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map one greytHR balance ``list[]`` entry to ``employee_leave_balances`` fields."""
    category = item.get("leaveTypeCategory") or {}
    code = (category.get("code") or "").strip()
    if not code:
        return None
    description = (category.get("description") or "").strip() or LEAVE_CODE_LABELS.get(code, code)
    return {
        "leave_code": code,
        "leave_type": description,
        "opening": _dec(item.get("ob")),
        "granted": _dec(item.get("grant")),
        "availed": _dec(item.get("availed")),
        "applied": _dec(item.get("applied")),
        "lapsed": _dec(item.get("lapsed")),
        "deducted": _dec(item.get("deducted")),
        "encashed": _dec(item.get("encashed")),
        "balance": _dec(item.get("balance")),
    }


# ── Storage layer ────────────────────────────────────────────────────────────
def upsert_balances(
    db: Session,
    *,
    employee_code: str,
    year: int,
    rows: list[dict[str, Any]],
    synced_at: datetime | None = None,
) -> int:
    """Idempotently upsert normalized rows for one employee/year. Returns row count.

    Keyed on the ``(employee_code, leave_code, year)`` unique constraint so a re-run
    updates in place instead of duplicating.
    """
    stamp = synced_at or utcnow()
    existing = {
        b.leave_code: b
        for b in db.scalars(
            select(EmployeeLeaveBalance).where(
                EmployeeLeaveBalance.employee_code == employee_code,
                EmployeeLeaveBalance.year == year,
            )
        )
    }
    for row in rows:
        record = existing.get(row["leave_code"])
        if record is None:
            record = EmployeeLeaveBalance(
                id=generate_id(),
                employee_code=employee_code,
                leave_code=row["leave_code"],
                year=year,
            )
            db.add(record)
        record.leave_type = row["leave_type"]
        record.opening = row["opening"]
        record.granted = row["granted"]
        record.availed = row["availed"]
        record.applied = row["applied"]
        record.lapsed = row["lapsed"]
        record.deducted = row["deducted"]
        record.encashed = row["encashed"]
        record.balance = row["balance"]
        record.synced_at = stamp
    db.flush()
    return len(rows)


def get_balances(db: Session, *, employee_code: str, year: int) -> list[EmployeeLeaveBalance]:
    """All stored balances for one employee/year, in canonical leave-type order."""
    rows = list(
        db.scalars(
            select(EmployeeLeaveBalance).where(
                EmployeeLeaveBalance.employee_code == employee_code,
                EmployeeLeaveBalance.year == year,
            )
        )
    )
    rows.sort(key=lambda b: _order_key(b.leave_code))
    return rows


def serialize_balance(b: EmployeeLeaveBalance) -> dict[str, Any]:
    return {
        "code": b.leave_code,
        "type": b.leave_type,
        "year": b.year,
        "opening": b.opening,
        "granted": b.granted,
        "availed": b.availed,
        "applied": b.applied,
        "lapsed": b.lapsed,
        "deducted": b.deducted,
        "encashed": b.encashed,
        "balance": b.balance,
        "syncedAt": b.synced_at.isoformat() if b.synced_at else None,
    }


def apply_seed_balances(db: Session) -> int:
    """Upsert the verified interim seed (currently GRP1074, 2026). Idempotent.

    Each leave type stores ``balance`` as the authoritative remaining days, with
    ``granted`` mirrored to it so the UI denominator is sensible; the live sync
    replaces all of this with greytHR's real ledger.
    """
    count = 0
    for employee_code, by_year in SEED_BALANCES.items():
        for year_str, by_code in by_year.items():
            rows = [
                {
                    "leave_code": code,
                    "leave_type": LEAVE_CODE_LABELS.get(code, code),
                    "opening": 0.0,
                    "granted": float(bal),
                    "availed": 0.0,
                    "applied": 0.0,
                    "lapsed": 0.0,
                    "deducted": 0.0,
                    "encashed": 0.0,
                    "balance": float(bal),
                }
                for code, bal in by_code.items()
            ]
            count += upsert_balances(db, employee_code=employee_code, year=int(year_str), rows=rows)
    return count


# ── greytHR API client (inert until configured) ──────────────────────────────
class GreytHRNotConfigured(RuntimeError):
    """Raised when a live greytHR call is attempted without credentials in env."""


# NOTE: paths below follow the documented contract; confirm against the live
# tenant when wiring the cron (the directory path in particular).
_DIRECTORY_PATH = "/employee/v2/employees"
_BALANCE_PATH = "/leave/v2/employee/{employee_id}/years/{year}/balance"


class GreytHRClient:
    """Encapsulates the 3-call greytHR contract with a cached token + directory.

    One token serves a whole sync run (refresh-on-401). The directory (employeeNo →
    {employeeId, name, leftorg}) is fetched once and cached for the client's life.
    """

    def __init__(self, *, timeout: float = 30.0) -> None:
        settings = get_settings()
        if not settings.greythr_configured:
            raise GreytHRNotConfigured(
                "greytHR credentials are not set (GREYTHR_API_USERNAME / PASSWORD / DOMAIN)."
            )
        self._username = settings.greythr_api_username or ""
        self._password = settings.greythr_api_password or ""
        self._domain = (settings.greythr_domain or "").strip()
        self._base_url = settings.greythr_base_url.rstrip("/")
        self._timeout = timeout
        self._token: str | None = None
        self._directory: dict[str, dict[str, Any]] | None = None
        self._http = httpx.Client(timeout=timeout)

    def __enter__(self) -> GreytHRClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    # Call 1 — token (HTTP Basic). Short-lived; cached and reused across the run.
    def _fetch_token(self) -> str:
        basic = base64.b64encode(f"{self._username}:{self._password}".encode()).decode()
        headers = {"Authorization": f"Basic {basic}", "Accept": "application/json"}
        params = {"grant_type": "client_credentials"}
        hosts = [
            f"https://{self._domain}/uas/v1/oauth2/client-token",
            "https://api.greythr.com/uas/v1/oauth2/client-token",
        ]
        last_exc: Exception | None = None
        for url in hosts:
            try:
                resp = self._http.post(url, headers=headers, params=params)
                if resp.status_code == 404:
                    continue  # try the fallback gateway host
                resp.raise_for_status()
                token = resp.json().get("access_token")
                if token:
                    return token
            except httpx.HTTPError as exc:  # noqa: PERF203 — small, explicit fallback loop
                last_exc = exc
        raise RuntimeError(f"greytHR token request failed: {last_exc}")

    def _token_value(self) -> str:
        if self._token is None:
            self._token = self._fetch_token()
        return self._token

    def _data_headers(self) -> dict[str, str]:
        return {
            "ACCESS-TOKEN": self._token_value(),
            "x-greythr-domain": self._domain,
            "Accept": "application/json",
        }

    def _get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
        """GET with a single refresh-on-401 retry using a fresh token."""
        resp = self._http.get(url, headers=self._data_headers(), params=params)
        if resp.status_code == 401:
            self._token = None  # force re-auth once
            resp = self._http.get(url, headers=self._data_headers(), params=params)
        resp.raise_for_status()
        return resp

    # Call 2 — directory (resolve employeeNo → numeric employeeId). Loops all pages.
    def directory(self) -> dict[str, dict[str, Any]]:
        if self._directory is not None:
            return self._directory
        mapping: dict[str, dict[str, Any]] = {}
        page = 0
        while True:
            resp = self._get(f"{self._base_url}{_DIRECTORY_PATH}", params={"page": page, "size": 500})
            body = resp.json()
            for emp in body.get("data", []):
                employee_no = (emp.get("employeeNo") or "").strip()
                if not employee_no:
                    continue
                mapping[employee_no] = {
                    "employeeId": emp.get("employeeId"),
                    "name": emp.get("name"),
                    "leftorg": bool(emp.get("leftorg")),
                }
            pages = body.get("pages") or {}
            if not pages.get("hasNext"):
                break
            page += 1
        self._directory = mapping
        return mapping

    # Call 3 — leave balance for one numeric employeeId / year.
    def get_balance(self, *, employee_id: int | str, year: int) -> list[dict[str, Any]]:
        url = f"{self._base_url}{_BALANCE_PATH.format(employee_id=employee_id, year=year)}"
        body = self._get(url).json()
        rows = []
        for item in body.get("list", []):
            row = normalize_balance_row(item)
            if row is not None:
                rows.append(row)
        return rows


# ── Sync orchestration ───────────────────────────────────────────────────────
def sync_employee(db: Session, *, employee_code: str, year: int | None = None) -> dict[str, Any]:
    """Fetch + upsert one employee's balances. Reuses one client/token."""
    year = year or datetime.now(UTC).year
    with GreytHRClient() as client:
        return _sync_one(db, client, employee_code=employee_code, year=year)


def _sync_one(db: Session, client: GreytHRClient, *, employee_code: str, year: int) -> dict[str, Any]:
    entry = client.directory().get(employee_code)
    if not entry or entry.get("employeeId") is None:
        raise ValueError(f"employeeNo {employee_code} not found in greytHR directory")
    rows = client.get_balance(employee_id=entry["employeeId"], year=year)
    count = upsert_balances(db, employee_code=employee_code, year=year, rows=rows)
    return {"employeeCode": employee_code, "year": year, "rows": count}


def sync_all_active(db: Session, *, year: int | None = None) -> dict[str, Any]:
    """Daily sweep: upsert balances for every active (non-leftorg) employee.

    Per-employee try/catch so one bad record never aborts the run. Returns a summary
    suitable for logging. Only employees whose ``employeeCode`` exists in the HRMS
    AND in the greytHR directory (and not leftorg) are synced.
    """
    year = year or datetime.now(UTC).year
    summary: dict[str, Any] = {"year": year, "synced": 0, "skipped": 0, "failed": 0, "failures": []}
    with GreytHRClient() as client:
        directory = client.directory()
        hrms_codes = {
            (code or "").strip()
            for code in db.scalars(select(EmployeeProfile.employee_code))
            if (code or "").strip()
        }
        for employee_code in sorted(hrms_codes):
            entry = directory.get(employee_code)
            if not entry or entry.get("leftorg") or entry.get("employeeId") is None:
                summary["skipped"] += 1
                continue
            try:
                _sync_one(db, client, employee_code=employee_code, year=year)
                db.commit()
                summary["synced"] += 1
            except Exception as exc:  # noqa: BLE001 — isolate one bad employee
                db.rollback()
                summary["failed"] += 1
                summary["failures"].append({"employeeCode": employee_code, "error": str(exc)})
                logger.warning("greytHR leave sync failed for %s: %s", employee_code, exc)
    logger.info("greytHR leave sync complete: %s", summary)
    return summary
