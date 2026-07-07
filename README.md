# Ethara HRMS

Ethara HRMS is a full-stack Hiring and Resource Management System for Ethara.ai. It manages the complete journey from careers-page applications, candidate sourcing, resume screening, assessments, interviews, selection forms, contracts, onboarding, employee records, PMS, leave, reimbursements, dinner requests, assets, compliance, attendance, and separation.

The platform is built for multiple user groups: candidates, vendors, employee referrers, TA, HR, evaluators, managers, IT, compliance, office admin, admin, and super admin. Each role sees only the modules required for their work, and the backend enforces permissions server-side.

## Table Of Contents

- [Quick Summary](#quick-summary)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Platform Sections](#platform-sections)
- [Navigation And Dashboard Notes](#navigation-and-dashboard-notes)
- [Hiring Lifecycle](#hiring-lifecycle)
- [Employee Lifecycle](#employee-lifecycle)
- [Roles, Responsibilities, Requirements, And Steps](#roles-responsibilities-requirements-and-steps)
- [Default Module Access](#default-module-access)
- [Core Data And Files](#core-data-and-files)
- [Authentication And Security](#authentication-and-security)
- [Notifications And Emails](#notifications-and-emails)
- [Background Jobs, OCR, And AI](#background-jobs-ocr-and-ai)
- [Local Development](#local-development)
- [Environment Configuration](#environment-configuration)
- [Production Deployment](#production-deployment)
- [Database Backup And Restore](#database-backup-and-restore)
- [Testing And Quality Checks](#testing-and-quality-checks)
- [Common Operations](#common-operations)
- [Troubleshooting](#troubleshooting)

## Quick Summary

| Area | Details |
|---|---|
| Frontend | Next.js App Router, React, Tailwind, shadcn-style UI, React Query |
| Backend | FastAPI, SQLAlchemy, Alembic, PostgreSQL |
| Auth | JWT access tokens, refresh tokens, role-based permissions |
| Storage | Local uploads by default, optional S3 settings available |
| OCR | Local OCR for Aadhaar and documents, with optional cloud fallback settings |
| AI | Resume/JD screening through configured LLM backend |
| Background work | Celery/Redis support for async jobs and scheduled work |
| Deployment | Host-based EC2 scripts are provided; Docker Compose supports local infra and full-profile containers |

## Architecture

```text
Browser
  |
  | http://<host>:3000
  v
Next.js frontend
  |
  | /api/* and /uploads/* reverse proxy
  v
FastAPI backend on 127.0.0.1:3001
  |
  +--> PostgreSQL
  +--> Redis
  +--> Local uploads or configured object storage
  +--> Email provider
  +--> OCR/LLM/Documenso integrations
```

Key architecture rules:

- The frontend is the public web entry point.
- The backend should stay private behind the frontend or a reverse proxy.
- `/api/*` traffic is handled by FastAPI.
- `/uploads/*` is served through auth-gated backend routes, not a public static folder.
- PostgreSQL is the source of truth for users, candidates, employees, workflows, evaluations, documents, leave, assets, contracts, and audit data.
- Redis supports background jobs and optional cache-related workloads.

## Repository Layout

```text
main-app/
|-- README.md
|-- run-dev.sh
|-- ec2-deploy.sh
|-- ec2-stop.sh
|-- ethara-hrms/
|   |-- package.json
|   `-- src/
|       |-- app/
|       |   |-- dashboard/
|       |   |-- portal/
|       |   |-- candidate/register/
|       |   `-- employee/register/
|       `-- lib/
`-- ethara-hrms-api/
    |-- pyproject.toml
    |-- docker-compose.yml
    |-- alembic/
    |-- app/
    |   |-- api/routes/
    |   |-- core/
    |   |-- db/
    |   |-- schemas/
    |   `-- services/
    |-- scripts/
    `-- uploads/
```

## Platform Sections

| Section | Purpose | Primary Users | Main Output |
|---|---|---|---|
| Careers page | Public job discovery and compact profile submission | Candidates | Applications and resumes |
| Applications | General resumes submitted from the careers page, with export support | Admin, HR, TA | Application queue and applicant export |
| Dashboard | Role-specific overview and actions. The admin "Evaluations Pending" KPI only counts open evaluations for candidates still in Evaluation Assigned or Evaluation In Progress stages. | All signed-in roles | Work summary and quick actions |
| Candidates | Candidate list, filters, profile, inline document preview, Admin/HR name correction, stage movement | Admin, HR, TA, Vendor, Referrer | Candidate records |
| Positions | Job roles, requirements, approval, hiring metadata | Admin, TA, HR | Active job roles |
| Vendors | Vendor records and vendor candidate tracking | Admin, TA, HR, Vendor | Vendor submissions |
| Colleges | College/master data for candidate metadata | Admin, HR, TA | Clean dropdown values |
| Resume Screening | Resume parsing, score, recommendation, shortlist/reject decision | Admin, HR, TA | Screening score and stage update |
| Assessments | Assessment templates, candidate tests, scoring, bypass | Admin, HR, TA, Evaluator, Candidate | Assessment results |
| Assessment Platform | Question bank, assessment setup, assignments, candidate delivery, and review | Admin, HR, TA, Evaluator | Structured assessment programs |
| Evaluations | Personal interview scheduling with meeting title, invitation, and evaluation | Admin, HR, TA, Evaluator | PI score, feedback, decision |
| PMS Evaluation | Employee performance scoring and feedback | Admin, HR, Manager where enabled | PMS record |
| Performance Report | Candidate or employee performance summary | Admin, HR, TA, Evaluator, Manager where enabled | Report view |
| Attendance | Employee attendance visibility and imported attendance records | Employee, HR, Admin, Manager where enabled | Attendance history |
| Selection Forms | Candidate selection details and HR validation | Candidate, HR, TA, Admin | Validated joining data |
| Contracts | Offer/contract generation, signing, signed file tracking | HR, TA, Admin, Candidate, Employee | Signed contract |
| Employees | Employee directory, profile, documents, manager, status | Admin, HR, Manager, IT, Office Admin | Employee master record |
| Manager Mapping | Reporting manager assignment | Admin, HR, TA, Manager | Manager hierarchy |
| Leave | Leave request, manager approval, HR/admin approval | Employee, Manager, HR, Admin | Leave status and balance |
| Documents | Resume, Aadhaar, PAN, passport photo, address proof, certificates, contracts | Candidate, Employee, HR, Compliance, IT | Uploaded and verified files with preview/download |
| IT Requests | Onboarding/offboarding IT tasks | IT Team, HR, Admin | Email/access/device task status |
| IT Assets | Asset inventory, bulk import/export, and employee asset assignment | IT Team, Admin | Asset register |
| Reimbursement Requests | Employee expense reimbursement submission, manager review, HR/Office Admin approval, payment, export, and revoke | Employee, Manager, HR, Office Admin, Admin | Reimbursement workflow |
| Dinner Requests | Project dinner request submission, review, export, completion, and requester delete before closure | Project Leads, TPMs, Admin, HR, Office Admin | Dinner request workflow |
| Compliance | Statutory/compliance forms and document verification | Compliance, HR, Admin, Candidate, Employee | Compliance decision |
| Separation | Resignation, termination, no-show, absconding, offboarding checklist | Employee, Manager, HR, Admin, IT | Exit workflow |
| Reports | Hiring and workforce reports | Admin, HR, TA | Exportable reporting |
| Notifications | In-app action and status notifications | All signed-in users | Task awareness |
| Users And Roles | User creation, multi-role assignment, active role switching, and separate Staff, Employees, and Candidates tabs | Admin, Super Admin | Platform access |
| Role Module Access | Per-role and per-user module visibility | Admin, Super Admin | Access matrix |
| Settings | Platform configuration | Admin, HR, IT Team where enabled | System configuration |
| Audit Logs | Traceable activity history | Admin, Super Admin | Audit trail |

## Navigation And Dashboard Notes

The HRMS sidebar is grouped by business function so users can find modules by ownership instead of scanning one long flat list.

| Navigation Group | Typical Modules |
|---|---|
| Workspace | Dashboard, Applications, Candidates, Employees |
| Talent Acquisition & Recruitment | Positions, Resume Screening, Assessment Platform, Evaluations, Selection Forms, Contracts, Signed Contracts, Vendors, Colleges |
| Employee Lifecycle | Employee Directory, Attendance, Leave Management, Compliance, Manager Mapping, Separation, Employee Referrals |
| Performance & Development | PMS Evaluation, Performance Reports, Learning & Development placeholder |
| IT Operations & Support | IT Assets Allocation, IT Requests, Helpdesk/Tickets |
| Finance | Reimbursement Requests, Dinner Requests |
| Administration & Configuration | Departments & Designations, Users & Roles, Module Access, Ticket Settings, Assessment Configuration, Settings |
| Analytics & Reporting | Reports, Export Center placeholder, Audit & Activity Logs, Escalations |

Navigation visibility is still controlled by role and module access. Admin/Super Admin can see and configure the full system; other roles only see enabled sections and modules relevant to their work.

Dashboard counters should represent the current workflow state, not stale historical records. For example, a candidate with an incomplete old evaluation record is not counted as pending once the candidate has moved to statutory forms, contract, or onboarding-completed stages.

## Hiring Lifecycle

1. Position setup
   - Admin, HR, or TA creates a position with title, description, requirements, screening guidance, source details, and approval data.
   - Optional supporting data such as colleges and vendors is configured before sourcing starts.

2. Candidate sourcing
   - Candidates can apply from the careers page.
   - TA/HR/Admin can add candidates directly.
   - Vendors can submit candidates against open roles.
   - Employees or employee referrers can submit referrals.

3. Candidate registration and documents
   - Candidate provides personal details and uploads required documents.
   - Resume and Aadhaar/document uploads are stored in the configured upload storage.
   - Email verification and document checks are used where applicable.
   - Admin, HR, and Super Admin can manually correct the candidate/member name from the Candidates module when submitted data needs cleanup.
   - Stored PDF/image documents can be previewed from the candidate profile without redirecting away; download remains available from the preview.

4. Resume screening
   - Resume text is extracted.
   - The configured AI backend compares the resume with the job description and screening guidance.
   - The platform records the score, summary, recommendation, and screening context.
   - Candidate stage moves to Shortlisted, Rejected, or Review/Pending based on the result and staff action.

5. Assessments
   - TA/HR/Admin assigns assessment templates where required.
   - Candidate completes the assessment in the portal.
   - Evaluator or authorized staff reviews scores and decides whether to continue.
   - Assessment Platform can be used for reusable question banks, assessment setup, and assignment tracking where enabled.

6. Personal interview and evaluation
   - Evaluator or authorized staff schedules PI rounds.
   - The scheduler captures a meeting title; the same title is shown in candidate invitations and calendar summaries.
   - Each round can record interviewer, schedule, marks, notes, decision, and feedback.
   - Passing candidates move forward; rejected candidates are closed with reason.

7. Selection form
   - Candidate receives the selection form.
   - Candidate submits joining, compensation, identity, and required onboarding information.
   - HR/TA/Admin validates the form.

8. Contract
   - HR/TA/Admin generates or sends the contract.
   - Candidate signs through the configured signing flow.
   - Signed contract is synced back to the candidate/employee record.

9. Onboarding
   - IT creates email/access and assigns assets where required.
   - Compliance verifies statutory forms and documents.
   - HR completes final onboarding checks.
   - Candidate becomes an employee when onboarding is complete.

## Employee Lifecycle

1. Employee creation
   - Employees can be created from completed hiring workflows or imported in bulk.
   - Bulk-imported employees should receive credentials by email on their Ethara.ai email address.

2. First login
   - Employee signs in with the provided credentials.
   - Employee changes the temporary password.
   - Employee verifies profile details and uploads missing documents.

3. Employee operations
   - Employee can manage documents, leave, reimbursements, contracts, compliance forms, referrals, attendance, and separation requests based on module access.
   - Manager can review team data and approve/reject leave.
   - HR/Admin maintains employee details, reporting manager, documents, PMS, and lifecycle state.

4. PMS and performance
   - PMS belongs to the employee lifecycle.
   - HR/Admin records employee PMS scores and feedback.
   - Performance Report shows relevant assessment, evaluation, PMS, and feedback records where available.

5. Offboarding
   - Employee, manager, HR, Admin, IT, and Office Admin complete their respective separation and asset tasks.
   - Employee resignation requests can be revoked before final HR approval.
   - Final exit state is recorded for audit and reporting.

## Roles, Responsibilities, Requirements, And Steps

### Super Admin

Responsibilities:

- Own complete platform access and emergency recovery.
- Manage users, roles, module access, settings, audit logs, and production-level controls.
- Ensure security-critical configuration is present before production use.

Requirements:

- Super admin account.
- Access to production `.env`, deployment host, database, logs, and backups.
- Understanding of role permissions and module access.

Steps:

1. Confirm environment secrets and production configuration are valid.
2. Create or verify Admin and HR users.
3. Configure default module access and any per-user overrides.
4. Review audit logs and sync logs regularly.
5. Confirm database backups and restore process are working.
6. Use production deployment scripts only after backup and smoke checks.

### Admin

Responsibilities:

- Operate the full HRMS platform across hiring and employee workflows.
- Manage users, positions, vendors, colleges, candidates, employees, reports, and settings.
- Manage reimbursement categories, request reports, dinner-request reports, and exported operational data.
- Resolve cross-module issues and monitor dashboards.

Requirements:

- Admin account with full module access.
- Valid understanding of hiring stages, employee lifecycle, and export rules.

Steps:

1. Configure positions, vendors, colleges, and role access as needed.
2. Monitor dashboards, applications, candidates, evaluations, contracts, and employee records.
3. Review exceptions such as rejected documents, overdue stages, missing forms, and failed emails.
4. Correct candidate/member names from Candidates when submitted data is wrong, and use inline document preview before document validation.
5. Export data only for approved business needs.
6. Use audit logs to trace important actions.

### HR

Responsibilities:

- Manage employee lifecycle, HR documentation, leave, reimbursements, dinner-request reviews, compliance, PMS, contracts, and separation.
- Support hiring after TA handoff.
- Validate selection forms and employee records.

Requirements:

- HR account.
- Access to Candidates, Employees, Documents, Contracts, Leave, Compliance, PMS, Selection Forms, and Separation modules.
- SMTP/email configuration must work for credential and notification flows.

Steps:

1. Review new hires and selection forms.
2. Validate candidate/employee documents and required joining details.
3. Correct candidate/member names from Candidates when submitted data is wrong, and use inline document preview before document validation.
4. Send or track contracts.
5. Complete onboarding checks with IT and Compliance.
6. Maintain employee profiles, reporting data, leave records, and PMS records.
7. Review reimbursement/dinner requests where assigned and update payment/completion status.
8. Process separation requests with manager and IT inputs.

### Talent Acquisition

Responsibilities:

- Own candidate sourcing, role pipeline, resume screening, assessments, interview coordination, and candidate handoff.
- Keep candidate stages and rejection/shortlist reasons clear.

Requirements:

- TA account.
- Access to Candidates, Applications, Positions, Vendors, Screening, Assessments, Evaluations where enabled, Selection Forms, Documents, and Contracts.

Steps:

1. Create or confirm the hiring position.
2. Add candidates from direct applications, vendors, referrals, lateral hiring, or internal hiring.
3. Upload or verify resumes and required candidate data.
4. Run or review resume screening.
5. Assign assessments and evaluators.
6. Move shortlisted candidates through PI, selection form, and contract stages.
7. Keep candidate stage filters, notes, and reasons updated.

### Evaluator

Responsibilities:

- Review assigned candidates and assessment results.
- Conduct PI rounds and submit objective scores, decisions, and feedback.

Requirements:

- Evaluator account.
- Candidate assignment or access to evaluation queues.
- Clear scoring criteria from the position or hiring team.

Steps:

1. Open the Evaluations or Assessments module.
2. Review assigned candidate profile, resume scores, assessment data, and role context.
3. Schedule or complete the interview round, including a clear meeting title for the candidate invitation.
4. Enter score, decision, and feedback.
5. Mark Pass, Select, or Reject according to the hiring decision.

### Candidate

Responsibilities:

- Submit accurate application details and complete required hiring tasks.
- Upload valid documents and respond to forms, assessments, and contracts.

Requirements:

- Candidate account or application submission.
- Valid email, phone number, resume, and requested identity/onboarding documents.

Steps:

1. Apply from the careers page or use the candidate portal link.
2. Verify email when prompted.
3. Upload resume and required documents.
4. Complete assigned assessments.
5. Attend interviews and track status.
6. Submit selection form after selection.
7. Sign contract and complete compliance/onboarding tasks.

### Vendor

Responsibilities:

- Submit candidates against open positions.
- Track vendor candidate progress and provide missing information when requested.

Requirements:

- Vendor account.
- Access to the vendor dashboard and candidate submission workflow.
- Candidate consent and accurate resume/profile data.

Steps:

1. Sign in to the vendor dashboard.
2. Select the correct open role.
3. Submit candidate details and resume.
4. Track stage, status, and feedback.
5. Update missing details when TA/HR requests clarification.

### Employee

Responsibilities:

- Maintain personal profile, documents, leave requests, reimbursement claims, contracts, compliance tasks, attendance visibility, referrals, and separation requests.

Requirements:

- Employee account, usually created by HR/Admin or bulk import.
- Ethara.ai email and temporary password for first login.

Steps:

1. Sign in with the emailed credentials.
2. Change the temporary password.
3. Verify profile information and date of birth.
4. Upload missing documents such as PAN, Aadhaar, passport photo, address proof, certificates, or resume if required.
5. Use Leave for leave requests.
6. Use Reimbursement Requests for official company/project expenses.
7. Use Referrals to submit candidates where enabled.
8. Use Separation when initiating, tracking, or revoking exit workflows before final HR approval.

### Employee Referrer

Responsibilities:

- Refer candidates for open roles while retaining normal employee self-service responsibilities.

Requirements:

- Employee referrer role or employee account with referral access.
- Candidate consent and accurate candidate details.

Steps:

1. Open Referrals or Candidate submission.
2. Select the relevant position.
3. Submit candidate details and resume.
4. Track referral status from the dashboard.
5. Respond if TA/HR needs more information.

### Manager

Responsibilities:

- Review team information, approve/reject leave, review reimbursement requests, support dinner/separation workflows, and provide manager-side feedback when required.

Requirements:

- Manager account.
- Employees mapped to the manager in Manager Mapping.

Steps:

1. Open Manager Dashboard.
2. Review team list and employee details.
3. Approve or reject leave and reimbursement requests with a clear reason.
4. Raise or review dinner requests where assigned.
5. Participate in separation/offboarding steps when assigned.
6. Escalate data corrections to HR/Admin.

### IT Team

Responsibilities:

- Handle IT onboarding/offboarding requests, assets, access, email creation, bulk asset import/export, and ID-card or document support where enabled.

Requirements:

- IT Team account.
- Access to IT Requests, IT Assets, Employees, Documents, and Settings where enabled.

Steps:

1. Open IT Requests queue.
2. Complete assigned onboarding tasks such as email/access creation.
3. Assign, update, import, export, or recover assets.
4. Update request status with clear notes.
5. Complete offboarding IT tasks during separation.

### Compliance

Responsibilities:

- Verify compliance documents, statutory forms, identity-related documents, and approval/rejection reasons.

Requirements:

- Compliance account.
- Access to Compliance, Candidates, Employees, and Documents modules.

Steps:

1. Open Compliance queue.
2. Review submitted forms and uploaded documents.
3. Compare document status, OCR status, and workflow state.
4. Approve, reject, or request correction with a clear reason.
5. Keep records complete for audit.

### Office Admin

Responsibilities:

- Support employee administration, document visibility, office-side onboarding/offboarding, employee export, ID-card status, reimbursement review, dinner request review, and operational checks.

Requirements:

- Office Admin account.
- Access to Employees and any enabled office/admin support modules.

Steps:

1. Open Office Admin dashboard.
2. Review employee details required for office operations.
3. Coordinate with HR and IT for missing documents, assets, or ID-card status.
4. Review reimbursement and dinner requests where assigned.
5. Support offboarding tasks assigned to office administration.

## Default Module Access

Admin and Super Admin always have full access. Other roles receive default module access as listed below, and Admin/Super Admin can adjust module access by role or by user.

| Role | Default Modules |
|---|---|
| Super Admin | All modules |
| Admin | All modules |
| HR | Dashboard, Candidates, Employees, Resume Screening, Assessments, PMS Evaluation, Selection Forms, Documents, Contracts, Manager Mapping, Leave Management, Reimbursement Requests, Dinner Requests, Compliance, Separation, Settings |
| Talent Acquisition | Dashboard, Candidates, Employees, Resume Screening, Assessments, Selection Forms, Documents, Contracts, Positions, Manager Mapping, Leave Management, Compliance, Separation |
| Evaluator | Dashboard, Assessments, Evaluations |
| IT Team | Dashboard, IT Requests, IT Assets, Employees, Documents, Settings |
| Compliance | Dashboard, Candidates, Employees, Documents, Compliance |
| Manager | Dashboard, Employees, Leave Management, Reimbursement Requests, Dinner Requests, Separation |
| Office Admin | Dashboard, Employees, Reimbursement Requests, Dinner Requests |
| Vendor | Dashboard, Candidates |
| Employee | Dashboard, Selection Forms, Leave Management, Reimbursement Requests, Documents, Contracts, Attendance, Compliance, Separation |
| Employee Referrer | Dashboard, Selection Forms, Leave Management, Reimbursement Requests, Documents, Contracts, Attendance, Compliance, Separation |
| Candidate | Dashboard, Documents, Selection Forms, Assessments, Contracts, Compliance |

Implementation references:

- Module registry: `ethara-hrms-api/app/core/modules.py`
- Permission mapping: `ethara-hrms-api/app/core/permissions.py`
- Role labels and stage labels: `ethara-hrms/src/lib/utils.ts`

## Core Data And Files

### Main Records

- Users: login identity, role, multi-role membership, active status, password data.
- Candidates: personal data, source, position, stage, status, screening result, evaluations, documents, forms, contracts, and authorized manual name corrections.
- Applications: careers-page profile submissions and resumes.
- Employees: employee master data, contact details, manager, department, documents, contracts, leave, PMS, separation state.
- Reimbursement requests: employee expense data, receipts, manager/HR or Office Admin approvals, payment status, revoke history, comments, and audit trail.
- Dinner requests: requester, project, date, team member count, email list validation, approval/completion status, comments, export, and audit trail.
- Attendance records: imported attendance data and employee visibility where enabled.
- Positions: job title, role requirements, description, screening guidance, approval status.
- Vendors and colleges: master data used in candidate sourcing and profile metadata.
- Documents: upload metadata, stored file reference, OCR state, verification status, rejection reason, inline preview/download access, and signed URLs for export.
- IT assets: asset inventory, assignment history, employee mapping, bulk import/export data, return state, and notes.
- Notifications: role/user-specific messages and actions.
- Audit logs: important user actions and system events.

### Uploads

Allowed file families include PDF, DOC, DOCX, JPG, PNG, and WEBP. Upload size is controlled by `MAX_UPLOAD_SIZE_MB`.

Documents should always be interpreted through both their document status and workflow context. For example, a resume can be shortlisted by screening even if file OCR is still pending; those are different checks and should be explained clearly in the UI and review notes.

Candidate profile document actions should use the stored document record to fetch the file blob. PDF and image files open in an in-page preview modal with a download action; unsupported file types should remain downloadable rather than redirecting staff away from the candidate profile.

## Authentication And Security

The security model uses:

- JWT access tokens and refresh tokens.
- Separate access and refresh secrets.
- Hashed and rotated refresh tokens.
- Role-based backend permissions on protected endpoints.
- Module access middleware for enabled/disabled modules.
- Object-level scoping for low-privilege users such as candidates, vendors, employees, and referrers.
- Auth-gated upload access.
- Short-lived signed document links for exports.
- Aadhaar fingerprinting using a secret pepper.
- Rate limits on sensitive flows such as login, OTP, and OCR-related actions.

Production requirements:

- Set `APP_ENV=production`.
- Use strong `JWT_SECRET` and `JWT_REFRESH_SECRET`.
- Set `AADHAAR_PEPPER`.
- Change `DEFAULT_TEMP_PASSWORD`.
- Configure trusted frontend origin through `FRONTEND_URL`.
- Configure real email delivery before using OTP or bulk-credential flows.
- Keep `.env`, uploads, backups, and logs out of git.

## Notifications And Emails

The platform uses notifications and email for:

- OTP verification and password reset.
- Candidate and staff workflow updates.
- Interview and evaluator coordination, including candidate invite emails that show the configured meeting title.
- Selection form and contract actions.
- Bulk employee import credentials.
- Reimbursement, dinner request, IT, compliance, attendance, and separation task awareness.

For production, configure one of the supported email backends:

- SMTP through `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_USE_TLS`.
- AWS SES through the configured SES settings.
- Console email only for development.

Bulk employee import expectation:

1. HR/Admin imports employees with valid Ethara.ai email addresses.
2. Platform creates or updates employee user accounts.
3. Platform sends login email with email address and temporary password.
4. Employee logs in and changes the temporary password.

## Background Jobs, OCR, And AI

### Background Jobs

Celery and Redis are available for asynchronous work:

- Worker service: background tasks.
- Beat service: scheduled tasks.
- Redis: broker/result/cache support depending on configuration.

Important settings:

- `REDIS_URL`
- `CELERY_TASK_ALWAYS_EAGER`
- `CELERY_RESULT_BACKEND`
- `RESUME_SCREENING_INLINE_ON_UPLOAD`
- `SLA_CHECK_CRON`

For small single-node deployments, resume screening can run inline on upload. For production-scale usage, run dedicated Celery workers and avoid long OCR/AI work inside web requests.

### OCR

OCR is used for document extraction and identity/document review. Local OCR dependencies are included in the backend project. Optional cloud OCR settings are available through Google Document AI, Textract, and Gemini fallback fields.

Important settings:

- `OCR_BACKEND`
- `OCR_LANGUAGES`
- `OCR_DPI`
- `TESSERACT_COMMAND`
- `GEMINI_OCR_FALLBACK`
- Google/Textract settings if cloud OCR is used

### AI Screening

Resume screening uses the configured LLM backend. The system stores screening score, summary, recommendation, and context for traceability.

Important settings:

- `LLM_BACKEND`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `LLM_REDACT_PII`

Enable PII redaction when candidate consent and data-processing requirements are in place.

## Local Development

### One-command launcher

```bash
cd main-app
./run-dev.sh
```

The launcher starts local infrastructure when needed, prepares the backend schema, and runs backend and frontend services.

### Manual backend setup

```bash
cd main-app/ethara-hrms-api
uv sync --all-extras
docker compose up -d postgres redis
uv run alembic upgrade head
uv run python -m app.db.seed
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 3001
```

### Manual frontend setup

```bash
cd main-app/ethara-hrms
npm install
npm run dev
```

Frontend local URL:

```text
http://localhost:3000
```

Backend local health URL:

```text
http://localhost:3001/healthz
```

## Environment Configuration

Create and maintain `main-app/ethara-hrms-api/.env`. The backend reads configuration through `ethara-hrms-api/app/core/config.py`.

Common required or important keys:

| Key | Purpose |
|---|---|
| `APP_ENV` | `development` or `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Access token signing secret |
| `JWT_REFRESH_SECRET` | Refresh token signing secret |
| `DEFAULT_TEMP_PASSWORD` | Temporary password for generated accounts |
| `AADHAAR_PEPPER` | Secret pepper for Aadhaar fingerprints |
| `FRONTEND_URL` | Allowed frontend origin |
| `EXTRA_ALLOWED_ORIGINS` | Additional CORS origins for local/LAN use |
| `EMAIL_BACKEND` | `console`, SMTP, or SES-style backend |
| `EMAIL_FROM` | From address for outbound mail |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_USE_TLS` | SMTP delivery |
| `AWS_SES_REGION` | SES delivery region |
| `STORAGE_BACKEND` | Local or object storage mode |
| `LOCAL_STORAGE_PATH` | Local upload path |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` | S3 upload storage |
| `OCR_BACKEND`, `OCR_LANGUAGES`, `OCR_DPI` | OCR behavior |
| `LLM_BACKEND`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | AI screening |
| `DOCUMENSO_API_KEY`, `DOCUMENSO_BASE_URL`, `DOCUMENSO_WEBHOOK_SECRET` | Contract signing integration |
| `MAX_UPLOAD_SIZE_MB` | Upload size limit |
| `CACHE_ENABLED`, `CACHE_DEFAULT_TTL_SECONDS` | Optional read cache |
| `WEB_CONCURRENCY`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` | Production capacity tuning |

Never commit `.env`, uploads, backups, or generated logs.

## Production Deployment

Production scripts are provided for host-based EC2 deployment:

```bash
cd main-app
./ec2-deploy.sh
./ec2-stop.sh
```

Expected production shape:

- Frontend listens publicly on port `3000`.
- Backend listens privately on `127.0.0.1:3001`.
- Frontend proxies API and upload requests to the backend.
- PostgreSQL and Redis must be available and backed up.
- Upload storage must be persistent.
- Email, OCR, AI, and Documenso integrations must be configured before live workflows.

Deployment notes:

- Frontend changes require `npm run build` before production start.
- Database migrations must be applied with Alembic.
- Deployment should take a database backup first.
- Logs are written under `.deploy-logs/`.
- Increase `WEB_CONCURRENCY` and database pool values carefully; keep total DB connections below PostgreSQL limits.

## Database Backup And Restore

Backup:

```bash
cd main-app
./ethara-hrms-api/scripts/db_backup.sh
```

Restore:

```bash
cd main-app
./ethara-hrms-api/scripts/db_restore.sh ethara-hrms-api/backups/<file>.dump
```

Restore is destructive. Stop the backend before restoring production data.

Recommended production practice:

- Daily automated backups.
- Pre-deployment backup.
- Periodic restore test on a non-production database.
- Keep backups encrypted and access-controlled.

## Testing And Quality Checks

Backend tests:

```bash
cd main-app/ethara-hrms-api
uv run pytest -q
```

Frontend lint:

```bash
cd main-app/ethara-hrms
npm run lint
```

Frontend build:

```bash
cd main-app/ethara-hrms
npm run build
```

Recommended smoke checks after changes:

1. Login as Admin.
2. Login as HR.
3. Login as TA.
4. Open Candidates and apply role/stage filters.
5. Open Users And Roles and verify Staff, Employees, and Candidates tabs load.
6. Open one candidate detail page and verify Admin/HR member-name edit, document preview/download, scores, stages, and export.
7. Open the admin dashboard and confirm pending evaluation counts match candidates currently in evaluation stages.
8. Open Employees and verify employee detail/export.
9. Submit a test careers-page application.
10. Confirm emails are sent or visible through console email in development.

## Common Operations

| Task | Command Or Location |
|---|---|
| Start full local development | `./run-dev.sh` |
| Start local Postgres and Redis | `cd ethara-hrms-api && docker compose up -d postgres redis` |
| Run backend migrations | `cd ethara-hrms-api && uv run alembic upgrade head` |
| Create backend migration | `cd ethara-hrms-api && uv run alembic revision -m "description"` |
| Seed development data | `cd ethara-hrms-api && uv run python -m app.db.seed` |
| Run backend | `cd ethara-hrms-api && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 3001` |
| Run frontend | `cd ethara-hrms && npm run dev` |
| Build frontend | `cd ethara-hrms && npm run build` |
| Deploy production | `./ec2-deploy.sh` |
| Stop production services | `./ec2-stop.sh` |
| Backend logs | `.deploy-logs/backend.log` |
| Frontend logs | `.deploy-logs/frontend.log` |
| Module access configuration | Dashboard -> Config -> Role Modules |
| User management | Dashboard -> Config -> Users |
| Position management | Dashboard -> Config -> Positions |
| Vendor management | Dashboard -> Config -> Vendors |
| College management | Dashboard -> Config -> Colleges |

## Troubleshooting

### Login refreshes or returns to login

Check:

- Backend is running on port `3001`.
- Frontend proxy points to the backend.
- `JWT_SECRET` and `JWT_REFRESH_SECRET` are stable and at least 32 characters.
- Browser has not kept stale tokens from another environment.
- User is active and has a valid role.
- `FRONTEND_URL` and CORS origins match the URL being used.

### Emails are not received

Check:

- `EMAIL_BACKEND` is not `console` in production.
- SMTP or SES settings are valid.
- `EMAIL_FROM` is allowed by the email provider.
- Bulk-imported employees have valid Ethara.ai email addresses.
- Backend logs for send failures.

### Uploads do not open

Check:

- File exists in `LOCAL_STORAGE_PATH` or configured storage.
- The user is logged in and has permission to view the file.
- Signed export link has not expired.
- Backend upload route is reachable through `/uploads/*`.

### OCR or resume screening is slow

Check:

- Large files and OCR work may be running inline.
- Configure Celery workers for production-scale processing.
- Confirm Redis is running.
- Confirm OCR and LLM API settings are valid.
- Review backend logs for API timeouts or OCR dependency errors.

### Filters show missing candidates

Check:

- Candidate stage value matches the stage filter.
- Display labels may group multiple internal stages under one user-facing label.
- Role/source filters are using configured position and source values.
- Current user has permission to view that candidate.

### Evaluations Pending looks too high

Check:

- The dashboard should count only incomplete evaluations for candidates in `evaluation_assigned` or `evaluation_in_progress`.
- Candidates already in selection form, contract, statutory forms, or onboarding-completed stages should not be counted as pending even if an older evaluation row is still incomplete.
- If the number is stale immediately after a stage change, allow the short dashboard cache to expire or refresh the page after the backend update.

### Exports miss fields

Check:

- The source data exists in PostgreSQL.
- Related records such as documents, evaluations, PMS, contracts, and feedback are joined by the export endpoint.
- The requesting user has permission to export those details.
- Signed document links have not expired when opened from the spreadsheet.

## Related Documentation

- Frontend notes: `ethara-hrms/README.md`
- Backend notes: `ethara-hrms-api/README.md`
- Backend configuration: `ethara-hrms-api/app/core/config.py`
- Permissions: `ethara-hrms-api/app/core/permissions.py`
- Module access: `ethara-hrms-api/app/core/modules.py`
