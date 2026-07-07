#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_APP_DIR="$(cd "${BACKEND_DIR}/../.." && pwd)"
HRMS_ENV_FILE="${MAIN_APP_DIR}/ethara-hrms-api/.env"

if [[ ! -f "${HRMS_ENV_FILE}" ]]; then
  echo "Missing HRMS environment file: ${HRMS_ENV_FILE}" >&2
  exit 1
fi

DATABASE_URL="$(
  HRMS_ENV_FILE="${HRMS_ENV_FILE}" python3 - <<'PY'
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

env_file = Path(os.environ["HRMS_ENV_FILE"])
database_url = ""
for raw_line in env_file.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == "DATABASE_URL":
        database_url = value.strip().strip('"').strip("'")
        break

if not database_url:
    raise SystemExit("DATABASE_URL is not set in the HRMS environment file")

parts = urlsplit(database_url)
scheme = parts.scheme.split("+", 1)[0]
print(urlunsplit((scheme, parts.netloc, "/ethara_wiki", parts.query, parts.fragment)))
PY
)"

export DATABASE_URL
export DB_BACKEND="${DB_BACKEND:-postgres}"
export IMPORT_LOCAL_JSON_TO_POSTGRES="${IMPORT_LOCAL_JSON_TO_POSTGRES:-true}"
export PUBLIC_WIKI_MODE="${PUBLIC_WIKI_MODE:-false}"
export ENABLE_SELF_SERVICE_REGISTRATION="${ENABLE_SELF_SERVICE_REGISTRATION:-false}"
export ENABLE_SELF_SERVICE_PASSWORD_RESET="${ENABLE_SELF_SERVICE_PASSWORD_RESET:-false}"
export HRMS_API_ORIGIN="${HRMS_API_ORIGIN:-http://127.0.0.1:3001}"
export LOCAL_ALLOWED_ORIGINS="${LOCAL_ALLOWED_ORIGINS:-https://hrms.ethara.ai,http://127.0.0.1:3000,http://localhost:3000}"
export LOCAL_ALLOWED_ORIGIN_REGEX="${LOCAL_ALLOWED_ORIGIN_REGEX:-^https?://(hrms\\.ethara\\.ai|localhost|127\\.0\\.0\\.1|\\[::1\\])(?::[0-9]+)?$}"

cd "${BACKEND_DIR}"
exec "${BACKEND_DIR}/.venv/bin/uvicorn" server:app --host 127.0.0.1 --port 8001 --timeout-keep-alive 5 --timeout-graceful-shutdown 10
