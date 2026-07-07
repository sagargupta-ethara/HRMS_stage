FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md alembic.ini gunicorn_conf.py ./
COPY app ./app
COPY alembic ./alembic

RUN pip install --upgrade pip \
    && pip install .

EXPOSE 3001

# Production: multi-worker Gunicorn driving Uvicorn workers so the instance
# uses all CPU cores. Override worker count with WEB_CONCURRENCY. For local
# dev with autoreload, run `uvicorn app.main:app --reload` directly instead.
CMD ["gunicorn", "app.main:app", "-c", "gunicorn_conf.py"]
