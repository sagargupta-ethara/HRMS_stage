"""One-off repair: some candidates were sent the statutory compliance forms (Form 11 /
Form 2 / Form F) TWICE, creating two Documenso documents per form type. They signed only
one copy of each, so the duplicate UNSIGNED rows keep ``all(status == "signed")`` false and
the candidate is stuck at ``statutory_forms_sent`` even though onboarding is really done.

Fix per affected candidate:
  * Delete the duplicate UNSIGNED rows, keeping the signed copy per form type.
  * If a candidate has duplicate SIGNED rows (both copies happened to get signed), keep the
    earliest-signed copy and delete the later duplicate.
  * Then run the normal ``sync_candidate_compliance`` path so ``verified_at`` is set and the
    stage advances to ``onboarding_completed`` exactly as a real completion would.
    (Employee conversion is idempotent — these candidates already have employee profiles.)

After deleting the unsigned dupes every remaining form is already ``signed``, so the sync
makes NO Documenso API calls (it only refreshes forms whose status != "signed").

Run from the API root:  python -m scripts.fix_duplicate_compliance_forms
"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select

from app.core.database import SessionLocal
from app.db.models import Candidate, ComplianceForm
from app.services.compliance_documenso import sync_candidate_compliance

# Candidates identified by the read-only audit (duplicate compliance_forms rows per formType).
AFFECTED_CANDIDATE_IDS = [
    "72bb09af77ce454ba750205a90cf3e31",  # Himanshu Arya  — 1 signed + 1 sent per form (stuck)
    "b2a57a2234324f1787fec9557843dc09",  # Nikhil Nambiar — 1 signed + 1 sent per form (stuck)
    "8cf90acd1fb74574a5ac1443db43cff5",  # Bhipendar Kumar — 2 signed per form (already complete)
]


def _dupes_to_delete(forms: list[ComplianceForm]) -> list[ComplianceForm]:
    """Given all compliance rows for one candidate, return the duplicate rows to delete.

    Keep exactly one row per form_type:
      * prefer a signed row; among signed rows keep the earliest signed_at.
      * if no signed row exists, keep the most recently sent (shouldn't happen here).
    """
    by_type: dict[str, list[ComplianceForm]] = defaultdict(list)
    for f in forms:
        by_type[f.form_type].append(f)

    to_delete: list[ComplianceForm] = []
    for _form_type, group in by_type.items():
        if len(group) <= 1:
            continue
        signed = [f for f in group if f.status == "signed"]
        if signed:
            # Keep the earliest-signed signed row; delete every other row of this type.
            keeper = min(signed, key=lambda f: (f.signed_at is None, f.signed_at))
        else:
            # No signed row — keep the latest sent, delete the rest (defensive; not expected).
            keeper = max(group, key=lambda f: (f.sent_at is None, f.sent_at))
        to_delete.extend(f for f in group if f.id != keeper.id)
    return to_delete


def main() -> None:
    with SessionLocal() as session:
        for cid in AFFECTED_CANDIDATE_IDS:
            candidate = session.get(Candidate, cid)
            if candidate is None:
                print(f"[skip] candidate {cid} not found")
                continue

            forms = list(
                session.scalars(
                    select(ComplianceForm).where(ComplianceForm.candidate_id == cid)
                )
            )
            dupes = _dupes_to_delete(forms)
            print(
                f"\n{candidate.full_name} ({cid})\n"
                f"  stage before: {candidate.current_stage}\n"
                f"  total form rows: {len(forms)}  duplicates to delete: {len(dupes)}"
            )
            for f in dupes:
                print(f"    DELETE  {f.id}  {f.form_type}  status={f.status}  documenso={f.documenso_id}")
                session.delete(f)

            session.flush()

            # Re-evaluate completion via the real service path (sets verified_at, advances
            # stage, idempotent employee conversion). No Documenso calls — all remaining
            # forms are already signed.
            sync_candidate_compliance(session, candidate=candidate)
            session.refresh(candidate)
            print(f"  stage after:  {candidate.current_stage}  ({candidate.current_status})")

        session.commit()
        print("\nDone — committed.")


if __name__ == "__main__":
    main()
