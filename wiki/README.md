# Company Wiki

This repo contains:

- `backend`: FastAPI API for auth, wiki pages, search, AI chat, birthdays, analytics, and document streaming
- `frontend`: React + CRACO app for the internal wiki UI

## Local setup

### Backend

```bash
brew install postgresql
brew services start postgresql
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
createdb ethara_wiki
export DATABASE_URL=postgresql://127.0.0.1:5432/ethara_wiki
export PUBLIC_WIKI_MODE=true
export ENABLE_SELF_SERVICE_REGISTRATION=false
export ENABLE_SELF_SERVICE_PASSWORD_RESET=false
export ADMIN_BOOTSTRAP_PASSWORD='change-me'
export HR_BOOTSTRAP_PASSWORD='change-me'
python server.py
```

The backend runs on `http://127.0.0.1:8001` and is bound to localhost only.
Application data is now stored in PostgreSQL by default.
On first startup, the backend will import `backend/data/local_store.json` into PostgreSQL automatically if the Postgres store is empty.

Useful backend env vars:

- `DB_BACKEND=postgres` to use PostgreSQL (default)
- `DATABASE_URL` for the PostgreSQL connection string
- `PUBLIC_WIKI_MODE=true` to allow the wiki to open directly on localhost via `/api/auth/local-session`
- `ENABLE_SELF_SERVICE_REGISTRATION=false` keeps public account creation off by default
- `ENABLE_SELF_SERVICE_PASSWORD_RESET=false` disables the old DOB-based reset flow until HRMS auth is integrated
- `ADMIN_BOOTSTRAP_PASSWORD`, `HR_BOOTSTRAP_PASSWORD`, `LEADERSHIP_BOOTSTRAP_PASSWORD`, and `LOCAL_ACCESS_PASSWORD` to set stable local credentials explicitly
- `IMPORT_LOCAL_JSON_TO_POSTGRES=false` to skip one-time import from the old JSON store
- `DB_BACKEND=local_json` to use the old file-backed store explicitly
- `LOCAL_DATA_FILE` to move the legacy local data file
- `AUTO_SEED_LOCAL_DATA=false` to start with a blank store
- `ALLOWED_EMAIL_DOMAINS=company.com,example.com` to restore domain-restricted signup when needed

### Frontend

```bash
cd frontend
npm install
npm start
```

The frontend runs on `http://127.0.0.1:3000` by default and is bound to localhost only.
Frontend API calls stay on same-origin `/api` paths and proxy to the backend on port `8001` during local development.

## Optional environment files

- `backend/.env.example`
- `frontend/.env.example`

## Local access

When `PUBLIC_WIKI_MODE=true`, the frontend can open directly on localhost without showing a login page.
The backend still creates local/demo users for testing, but shared default passwords are no longer kept.
Set the bootstrap password env vars above if you want stable admin or HR logins; otherwise the server generates one-time local passwords on first seed and prints them in the backend startup log.

Set `AUTO_SEED_LOCAL_DATA=false` if you want a blank local data store.
