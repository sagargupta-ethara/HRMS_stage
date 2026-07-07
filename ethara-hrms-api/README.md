# Ethara HRMS API

Python 3.12+ backend for the Ethara Hiring & Onboarding Management System.

## Stack

- FastAPI
- PostgreSQL
- SQLAlchemy 2.0 ORM
- Alembic migrations
- Pydantic v2
- JWT access + refresh tokens
- Role-based + permission-based access control
- Celery + Redis
- AWS S3 / local file storage
- SMTP / AWS SES email adapters
- OCR adapters for Textract / Google Document AI / Tesseract / mock
- LLM adapters for resume screening and document extraction
- Pytest
- Docker / Docker Compose

## Backend Structure

```text
ethara-hrms-api/
├── app/
│   ├── api/
│   │   ├── deps.py
│   │   ├── router.py
│   │   └── routes/
│   │       ├── auth.py
│   │       ├── candidates.py
│   │       ├── config.py
│   │       ├── reports.py
│   │       └── workflows.py
│   ├── core/
│   │   ├── celery_app.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── permissions.py
│   │   └── security.py
│   ├── db/
│   │   ├── base.py
│   │   ├── models.py
│   │   └── seed.py
│   ├── schemas/
│   │   ├── auth.py
│   │   ├── candidate.py
│   │   ├── common.py
│   │   ├── report.py
│   │   ├── resources.py
│   │   └── workflow.py
│   ├── services/
│   │   ├── audit.py
│   │   ├── auth.py
│   │   ├── candidates.py
│   │   ├── integrations.py
│   │   ├── reference_data.py
│   │   ├── reports.py
│   │   └── workflows.py
│   ├── tasks/
│   │   ├── documents.py
│   │   ├── notifications.py
│   │   ├── screening.py
│   │   └── sla.py
│   └── main.py
├── alembic/
│   ├── env.py
│   └── versions/
├── tests/
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml
└── .env.example
```

## API Compatibility

The backend keeps the frontend-facing `/api/v1` contract intact for:

- `/auth`
- `/candidates`
- `/reports`
- `/positions`
- `/vendors`
- `/colleges`
- `/users`
- `/documents`
- `/notifications`
- `/escalations`
- `/it-requests`
- `/audit-logs`

Additional workflow endpoints were added for:

- `/evaluations`
- `/selection-forms`
- `/contracts`
- `/compliance`
- `/screening`
- `/settings`

## Local Setup

1. Create env file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
uv sync --all-extras
brew install tesseract
brew install tesseract-lang
```

PyMuPDF handles document parsing while Tesseract provides local OCR for scanned PDFs and image uploads such as Aadhaar photos.
For bilingual Aadhaar cards, set `OCR_LANGUAGES=eng+hin`.
If you want Aadhaar OCR to work on machines without a local Tesseract install, set `GEMINI_API_KEY`
and keep `GEMINI_OCR_FALLBACK=true` so scanned Aadhaar PDFs/images can fall back to Gemini Vision.

3. Start infrastructure:

```bash
docker compose up -d postgres redis
```

4. Run migrations:

```bash
uv run alembic upgrade head
```

5. Seed demo data:

```bash
uv run python -m app.db.seed
```

6. Start API:

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 3001
```

7. Start worker and scheduler:

```bash
uv run celery -A app.core.celery_app.celery_app worker --loglevel=info
uv run celery -A app.core.celery_app.celery_app beat --loglevel=info
```

## Docker

Bring up the full backend stack:

```bash
docker-compose up --build
```

Services:

- API: `http://localhost:3001`
- Swagger: `http://localhost:3001/api/docs`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Environment Variables

See `.env.example` for the full list. Key groups:

- App: `APP_ENV`, `APP_DEBUG`, `PORT`, `FRONTEND_URL`
- Database: `DATABASE_URL`
- Queue: `REDIS_URL`, `CELERY_TASK_ALWAYS_EAGER`
- JWT: `JWT_SECRET`, `JWT_REFRESH_SECRET`, TTL settings
- Storage: `STORAGE_BACKEND`, `AWS_*`, `LOCAL_STORAGE_PATH`
- Email: `EMAIL_BACKEND`, `SMTP_*`, `AWS_SES_REGION`
- OCR: `OCR_BACKEND`, Textract / Google Document AI / Tesseract settings
- LLM: `LLM_BACKEND`, `OPENAI_API_KEY`, `OPENAI_MODEL`

## Background Jobs

- `app.tasks.screening.process_resume_screening`
  Resume scoring, screening summary, shortlist/reject decision.

- `app.tasks.documents.process_document_ocr`
  OCR pass plus LLM-based structured extraction for uploaded documents.

- `app.tasks.notifications.send_email_notification`
  Email adapter dispatch for workflow notifications.

- `app.tasks.sla.run_sla_checks`
  Scheduled SLA scan, escalation creation, and escalation email dispatch.

## Testing

Run tests:

```bash
uv run pytest
```

Current automated coverage verifies:

- login and `/auth/me`
- candidate creation and duplicate detection
- candidate stage advancement with selection-form side effects
- document upload queue wiring
- dashboard reports summary

## Manual Verification Checklist

- Login, refresh token rotation, logout, and role-based `/auth/me`
- Candidate creation, source tagging, duplicate detection, and reapplication rules
- Resume upload, screening queue dispatch, and LLM result persistence
- Document upload, OCR extraction, and HR verification
- Evaluation assignment/submission
- Selection form send, submit, and validate flow
- Contract create/update/sign flow
- IT request completion and Ethara email mapping
- Compliance form generation, submit, and verify flow
- Notifications, escalations, and SLA scheduler
- Dashboard counts, reports, and audit trail records
