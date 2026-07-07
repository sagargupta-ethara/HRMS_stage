import os
from pathlib import Path
from typing import Optional

try:
    from .local_store import LocalDatabase
    from .postgres_store import PostgresDatabase
except ImportError:
    from local_store import LocalDatabase
    from postgres_store import PostgresDatabase


def _as_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _redact_database_url(database_url: str) -> str:
    if "@" not in database_url or "://" not in database_url:
        return database_url
    scheme, remainder = database_url.split("://", 1)
    credentials, location = remainder.split("@", 1)
    if ":" not in credentials:
        return f"{scheme}://***@{location}"
    username = credentials.split(":", 1)[0]
    return f"{scheme}://{username}:***@{location}"


def create_database(base_dir: Optional[Path] = None):
    base_dir = Path(base_dir or Path(__file__).resolve().parent)
    backend = (os.getenv("DB_BACKEND") or "postgres").strip().lower()
    local_data_file = os.getenv("LOCAL_DATA_FILE", os.fspath(base_dir / "data" / "local_store.json"))

    if backend == "local_json":
        database = LocalDatabase(local_data_file)
        print(f"[Startup] Using local JSON store at {local_data_file}")
        return None, database, "local_json"

    if backend != "postgres":
        raise RuntimeError(f"Unsupported DB_BACKEND '{backend}'. Use 'postgres' or 'local_json'.")

    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set when DB_BACKEND=postgres")

    database = PostgresDatabase(database_url)
    imported = False
    if _as_bool(os.getenv("IMPORT_LOCAL_JSON_TO_POSTGRES"), default=True):
        imported = database.import_local_json(local_data_file)

    print(f"[Startup] Using PostgreSQL store at {_redact_database_url(database_url)}")
    if imported:
        print(f"[Startup] Imported local JSON data from {local_data_file}")
    return None, database, "postgres"
