from __future__ import annotations

from app.core.database import SessionLocal
from app.services.employees import repair_employee_auth_records


def main() -> None:
    with SessionLocal() as session:
        repaired = repair_employee_auth_records(session)
        session.commit()
        print(f"Repaired {repaired} employee auth/profile record(s).")


if __name__ == "__main__":
    main()
