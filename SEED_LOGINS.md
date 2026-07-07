# Seed / Dummy Logins

The backend seed (`ethara-hrms-api/app/db/seed.py`) creates one account per role
so you can test every part of the app. **No real employee data** is included.

## How to create them

```bash
cd ethara-hrms-api
uv run alembic upgrade head        # build the schema first
# set a password for the accounts (otherwise each gets a random one):
export SEED_ADMIN_PASSWORD=ethara123 SEED_HR_PASSWORD=ethara123 SEED_TA_PASSWORD=ethara123 \
       SEED_IT_PASSWORD=ethara123 SEED_MANAGER_PASSWORD=ethara123 SEED_EVALUATOR_PASSWORD=ethara123 \
       SEED_COMPLIANCE_PASSWORD=ethara123 SEED_OFFICE_ADMIN_PASSWORD=ethara123 \
       SEED_REFERRER_PASSWORD=ethara123 SEED_EMPLOYEE_PASSWORD=ethara123
uv run python -m app.db.seed
```

> Re-running the seed never changes an existing account's password. To reset a
> password, change it from the app (or delete the user and re-seed).

## Accounts

On the Ethara **stage** instance every account below uses the password **`ethara123`**.
(When you seed your own database, the password is whatever you set in the
`SEED_<ROLE>_PASSWORD` variables above.)

| Email | Role | Purpose |
|---|---|---|
| `admin@ethara.ai` | admin | Full access |
| `superadmin@ethara.ai` | super_admin | Highest privilege |
| `leadership@ethara.ai` | leadership | Leadership views |
| `hr@ethara.ai` | hr | HR workflows |
| `ta@ethara.ai` | ta | Talent Acquisition / recruiting |
| `it@ethara.ai` | it_team | IT requests / provisioning |
| `manager@ethara.ai` | manager | Team management / approvals |
| `evaluator@ethara.ai` | evaluator | Candidate evaluations |
| `compliance@ethara.ai` | compliance | Compliance / statutory forms |
| `officeadmin@ethara.ai` | office_admin | Office administration |
| `referrer@ethara.ai` | employee_referrer | Employee referrals |
| `pltpm@ethara.ai` | pl_tpm | Project Lead / TPM |
| `vendor@ethara.ai` | vendor | Vendor portal |
| `employee@ethara.ai` | employee | Standard employee |
| `employee.demo@ethara.ai` | employee | Demo employee |
| `employee.documents@ethara.ai` | employee | Employee-documents demo |
| `arjun.demo@gmail.com` | candidate | Demo candidate (portal) |

> These are throwaway test accounts. **Never** enable them or reuse `ethara123`
> in a production environment.
