#!/usr/bin/env python
"""Bulk-load reporting-manager assignments from a pasted text/TSV table.

The script sends no email and creates no accounts. It updates real EmployeeProfile rows
when both sides already have users, and stores pending manager metadata on
EmployeeImportStaging rows so the assignment is applied when the employee activates.

Usage:
    .venv/bin/python -m scripts.import_manager_mapping --source /path/to/pasted-text.txt
    .venv/bin/python -m scripts.import_manager_mapping --source /path/to/pasted-text.txt --apply
"""
from __future__ import annotations

import argparse
import logging
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.db.models import EmployeeImportStaging, EmployeeProfile, Role, User

logger = logging.getLogger("manager-mapping-import")

EMPLOYEE_CODE_PATTERN = r"GR(?:T)?P\w*\d+"
ROW_RE = re.compile(rf"^({EMPLOYEE_CODE_PATTERN})\s+(.+?)\s+({EMPLOYEE_CODE_PATTERN})\s+(.+?)\s*$")
ASSIGNABLE_MANAGER_ROLES = {
    Role.MANAGER.value,
    Role.ADMIN.value,
    Role.SUPER_ADMIN.value,
    Role.LEADERSHIP.value,
    Role.HR.value,
    Role.TA.value,
}
MANAGER_CODE_USER_EMAIL_ALIASES = {
    # Leadership users can exist without EmployeeProfile rows. The HR sheet still
    # uses their historical employee codes, so resolve those codes through their
    # active login accounts.
    "GRP1141": "scindia@ethara.ai",
    "GRP1142": "suryansh@ethara.ai",
}


@dataclass(frozen=True)
class MappingRow:
    employee_code: str
    employee_name: str
    manager_code: str
    manager_name: str


@dataclass
class PersonMatch:
    kind: str
    code: str | None
    name: str
    email: str | None
    profile: EmployeeProfile | None = None
    staging: EmployeeImportStaging | None = None
    user: User | None = None


def norm_code(value: Any) -> str:
    return str(value or "").strip().upper()


def norm_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


def role_value(value: Any) -> str:
    return value.value if isinstance(value, Role) else str(value)


def parse_rows(source: Path) -> list[MappingRow]:
    rows: list[MappingRow] = []
    for line in source.read_text(encoding="utf-8").splitlines():
        cleaned = line.replace("\u2028", " ").replace("\ufeff", "").strip()
        match = ROW_RE.match(cleaned)
        if not match:
            continue
        employee_code, employee_name, manager_code, manager_name = (
            part.strip() for part in match.groups()
        )
        rows.append(
            MappingRow(
                employee_code=norm_code(employee_code),
                employee_name=employee_name,
                manager_code=norm_code(manager_code),
                manager_name=manager_name,
            )
        )
    return rows


def staging_name(row: EmployeeImportStaging) -> str:
    return str((row.profile_fields or {}).get("full_name") or "").strip()


def staging_email(row: EmployeeImportStaging) -> str | None:
    return norm_email(row.ethara_email) or None


def user_role_values(user: User) -> set[str]:
    return {role_value(user.role)} | {role_value(item) for item in (user.roles or [])}


def ensure_user_role(user: User, role: Role) -> bool:
    values = [role_value(item) for item in (user.roles or [user.role])]
    if role.value in values:
        return False
    current = role_value(user.role)
    if current not in values:
        values.insert(0, current)
    values.append(role.value)
    user.roles = values
    return True


def find_by_code_and_name(
    *,
    code: str,
    name: str,
    profiles_by_code: dict[str, EmployeeProfile],
    staging_by_code: dict[str, EmployeeImportStaging],
    users_by_id: dict[str, User],
    allow_name_mismatch: bool = False,
) -> tuple[PersonMatch | None, str | None]:
    profile = profiles_by_code.get(code)
    if profile is not None:
        if not allow_name_mismatch and norm_name(profile.full_name) != norm_name(name):
            return None, f"name_mismatch(profile={profile.full_name!r}, sheet={name!r})"
        return (
            PersonMatch(
                kind="profile",
                code=profile.employee_code,
                name=profile.full_name,
                email=profile.ethara_email,
                profile=profile,
                user=users_by_id.get(profile.user_id) if profile.user_id else None,
            ),
            None,
        )

    staged = staging_by_code.get(code)
    if staged is not None:
        staged_full_name = staging_name(staged)
        if not allow_name_mismatch and norm_name(staged_full_name) != norm_name(name):
            return None, f"name_mismatch(staging={staged_full_name!r}, sheet={name!r})"
        return (
            PersonMatch(
                kind="staging",
                code=staged.employee_code,
                name=staged_full_name,
                email=staging_email(staged),
                staging=staged,
            ),
            None,
        )

    return None, "code_not_found"


def find_user_by_exact_name(db: Session, name: str) -> User | None:
    matches = [
        user
        for user in db.scalars(select(User).where(func.lower(func.trim(User.name)) == norm_name(name)))
        if norm_name(user.name) == norm_name(name)
    ]
    return matches[0] if len(matches) == 1 else None


def find_manager_alias_user(db: Session, manager_code: str) -> User | None:
    email = MANAGER_CODE_USER_EMAIL_ALIASES.get(norm_code(manager_code))
    if not email:
        return None
    user = db.scalar(select(User).where(func.lower(func.trim(User.email)) == norm_email(email)))
    if user is None:
        return None
    if not user_role_values(user).intersection(ASSIGNABLE_MANAGER_ROLES):
        return None
    return user


def resolve_manager(
    db: Session,
    row: MappingRow,
    *,
    profiles_by_code: dict[str, EmployeeProfile],
    staging_by_code: dict[str, EmployeeImportStaging],
    users_by_id: dict[str, User],
) -> tuple[PersonMatch | None, str | None]:
    manager, reason = find_by_code_and_name(
        code=row.manager_code,
        name=row.manager_name,
        profiles_by_code=profiles_by_code,
        staging_by_code=staging_by_code,
        users_by_id=users_by_id,
    )
    if manager is not None:
        return manager, None

    alias_user = find_manager_alias_user(db, row.manager_code)
    if alias_user is not None:
        return (
            PersonMatch(
                kind="user",
                code=row.manager_code,
                name=alias_user.name,
                email=alias_user.email,
                user=alias_user,
            ),
            None,
        )

    # Some leadership/manager accounts exist without employee-code profiles. Use an
    # exact user-name fallback only for the manager side; employee rows stay strict.
    user = find_user_by_exact_name(db, row.manager_name)
    if user is not None and user_role_values(user).intersection(ASSIGNABLE_MANAGER_ROLES):
        return (
            PersonMatch(
                kind="user",
                code=row.manager_code,
                name=user.name,
                email=user.email,
                user=user,
            ),
            None,
        )
    return None, f"manager_{reason or 'not_found'}"


def mark_staged_reporting_manager(staging: EmployeeImportStaging, *, dry_run: bool) -> bool:
    profile_fields = dict(staging.profile_fields or {})
    if profile_fields.get("is_reporting_manager") is True:
        return False
    profile_fields["is_reporting_manager"] = True
    if not dry_run:
        staging.profile_fields = profile_fields
    return True


def store_pending_manager(
    staging: EmployeeImportStaging,
    row: MappingRow,
    manager: PersonMatch,
    *,
    dry_run: bool,
) -> bool:
    profile_fields = dict(staging.profile_fields or {})
    previous = {
        key: profile_fields.get(key)
        for key in (
            "manager_id",
            "manager_employee_code",
            "manager_name",
            "manager_email",
        )
    }
    profile_fields["manager_employee_code"] = row.manager_code
    profile_fields["manager_name"] = manager.name or row.manager_name
    if manager.user is not None:
        profile_fields["manager_id"] = manager.user.id
        profile_fields["manager_email"] = manager.user.email
    else:
        profile_fields.pop("manager_id", None)
        if manager.email:
            profile_fields["manager_email"] = manager.email
        else:
            profile_fields.pop("manager_email", None)
    changed = previous != {
        key: profile_fields.get(key)
        for key in (
            "manager_id",
            "manager_employee_code",
            "manager_name",
            "manager_email",
        )
    }
    if changed and not dry_run:
        staging.profile_fields = profile_fields
    return changed


def apply_mapping(source: Path, *, dry_run: bool, trust_employee_code: bool = False) -> Counter:
    rows = parse_rows(source)
    stats: Counter[str] = Counter(parsed_rows=len(rows))
    all_codes = {row.employee_code for row in rows} | {row.manager_code for row in rows}

    with SessionLocal() as db:
        profiles_by_code = {
            norm_code(profile.employee_code): profile
            for profile in db.scalars(
                select(EmployeeProfile).where(
                    func.upper(EmployeeProfile.employee_code).in_(all_codes)
                )
            )
        }
        staging_by_code = {
            norm_code(staging.employee_code): staging
            for staging in db.scalars(
                select(EmployeeImportStaging).where(
                    func.upper(EmployeeImportStaging.employee_code).in_(all_codes)
                )
            )
            if staging.employee_code
        }
        users_by_id = {user.id: user for user in db.scalars(select(User))}
        skipped: list[tuple[MappingRow, str]] = []

        manager_rows = {(row.manager_code, norm_name(row.manager_name)) for row in rows}
        for manager_code, manager_name_key in manager_rows:
            manager_row = next(
                row
                for row in rows
                if row.manager_code == manager_code and norm_name(row.manager_name) == manager_name_key
            )
            manager, reason = resolve_manager(
                db,
                manager_row,
                profiles_by_code=profiles_by_code,
                staging_by_code=staging_by_code,
                users_by_id=users_by_id,
            )
            if manager is None:
                stats[f"manager_marker_skipped_{reason}"] += 1
                continue
            if manager.user is not None:
                if ensure_user_role(manager.user, Role.MANAGER):
                    stats["manager_roles_added"] += 1
                    if not dry_run:
                        db.add(manager.user)
            elif manager.staging is not None:
                if mark_staged_reporting_manager(manager.staging, dry_run=dry_run):
                    stats["staged_managers_marked"] += 1
                    if not dry_run:
                        db.add(manager.staging)

        for row in rows:
            employee, employee_reason = find_by_code_and_name(
                code=row.employee_code,
                name=row.employee_name,
                profiles_by_code=profiles_by_code,
                staging_by_code=staging_by_code,
                users_by_id=users_by_id,
                allow_name_mismatch=trust_employee_code,
            )
            if employee is None:
                stats[f"skipped_employee_{employee_reason}"] += 1
                skipped.append((row, f"employee_{employee_reason}"))
                continue
            if norm_name(employee.name) != norm_name(row.employee_name):
                stats["employee_name_mismatch_accepted"] += 1

            manager, manager_reason = resolve_manager(
                db,
                row,
                profiles_by_code=profiles_by_code,
                staging_by_code=staging_by_code,
                users_by_id=users_by_id,
            )
            if manager is None:
                stats[f"skipped_{manager_reason}"] += 1
                skipped.append((row, manager_reason or "manager_not_found"))
                continue

            if manager.user is not None:
                if ensure_user_role(manager.user, Role.MANAGER):
                    stats["manager_roles_added"] += 1
                    if not dry_run:
                        db.add(manager.user)

            if employee.profile is not None:
                if manager.user is None:
                    stats["skipped_profile_manager_pending"] += 1
                    skipped.append((row, "profile_employee_manager_pending"))
                    continue
                if employee.profile.user_id == manager.user.id:
                    stats["skipped_self_manager"] += 1
                    skipped.append((row, "self_manager"))
                    continue
                if employee.profile.manager_id == manager.user.id:
                    stats["profiles_already_mapped"] += 1
                else:
                    stats["profiles_mapped"] += 1
                    if not dry_run:
                        employee.profile.manager_id = manager.user.id
                        db.add(employee.profile)
                continue

            if employee.staging is not None:
                if store_pending_manager(employee.staging, row, manager, dry_run=dry_run):
                    stats["staging_mapped"] += 1
                    if not dry_run:
                        db.add(employee.staging)
                else:
                    stats["staging_already_mapped"] += 1

        if dry_run:
            db.rollback()
        else:
            db.commit()

    for row, reason in skipped[:50]:
        logger.warning(
            "skipped %s %s -> %s %s: %s",
            row.employee_code,
            row.employee_name,
            row.manager_code,
            row.manager_name,
            reason,
        )
    if len(skipped) > 50:
        logger.warning("... %d more skipped rows", len(skipped) - 50)
    stats["skipped_total"] = len(skipped)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Import reporting-manager assignments.")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="Commit changes. Defaults to dry-run.")
    parser.add_argument(
        "--trust-employee-code",
        action="store_true",
        help="Map by employee code even if the sheet name differs from the DB name.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
    stats = apply_mapping(args.source, dry_run=not args.apply, trust_employee_code=args.trust_employee_code)
    logger.info("%s", "APPLIED" if args.apply else "DRY RUN")
    for key in sorted(stats):
        logger.info("%s=%s", key, stats[key])


if __name__ == "__main__":
    main()
