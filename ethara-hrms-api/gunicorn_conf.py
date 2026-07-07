"""Gunicorn configuration for the Ethara HRMS API.

Runs the FastAPI app under multiple Uvicorn workers so the box uses all of its
CPU cores (a single Uvicorn process is GIL-bound to one core). Worker count is
driven by WEB_CONCURRENCY, defaulting to (2 * CPU) + 1.

Launch:
    gunicorn app.main:app -c gunicorn_conf.py
"""

import multiprocessing
import os
import time

# ── Timezone ─────────────────────────────────────────────────────────────────
# Render Gunicorn's access/error log timestamps in IST. Set in the master before
# workers fork so they inherit it; app.core.timezone.apply_process_timezone()
# repeats this inside the app for the Uvicorn/dev/manual path. DB writes use
# explicit UTC and are unaffected.
os.environ["TZ"] = "Asia/Kolkata"
if hasattr(time, "tzset"):
    time.tzset()

# ── Networking ───────────────────────────────────────────────────────────────
bind = f"127.0.0.1:{os.getenv('PORT', '3001')}"

# ── Worker model ─────────────────────────────────────────────────────────────
# UvicornWorker serves the ASGI app. Sync route handlers are offloaded to each
# worker's AnyIO threadpool automatically, so no gunicorn threads are needed.
worker_class = "uvicorn.workers.UvicornWorker"

_web_concurrency = os.getenv("WEB_CONCURRENCY", "").strip()
if _web_concurrency.isdigit() and int(_web_concurrency) > 0:
    workers = int(_web_concurrency)
else:
    workers = multiprocessing.cpu_count() * 2 + 1

# ── Timeouts ─────────────────────────────────────────────────────────────────
# Aadhaar / cheque OCR runs synchronously inside the request and can take tens
# of seconds on a cold path; keep the worker timeout generous so legitimate OCR
# requests are not killed. Tune down once OCR is moved fully off the request.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))

# ── Worker recycling (guards against slow memory growth, e.g. OCR libs) ───────
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("GUNICORN_MAX_REQUESTS_JITTER", "100"))

# ── Logging ──────────────────────────────────────────────────────────────────
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("GUNICORN_LOGLEVEL", "info")
