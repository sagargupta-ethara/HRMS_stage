from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.timezone import APP_TIME_ZONE


settings = get_settings()

# QueuePool tuning only applies to real server databases (Postgres). SQLite —
# used in tests or simple setups — does not support these args, so we pass them
# only for non-SQLite URLs to keep behaviour identical there.
_engine_kwargs: dict = {"pool_pre_ping": True, "future": True}
if not settings.database_url.startswith("sqlite"):
    _engine_kwargs.update(
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        pool_recycle=settings.db_pool_recycle,
    )

engine = create_engine(settings.database_url, **_engine_kwargs)

if settings.database_url.startswith(("postgresql", "postgres")):
    @event.listens_for(engine, "connect")
    def _set_postgres_timezone(dbapi_connection, _connection_record) -> None:
        with dbapi_connection.cursor() as cursor:
            cursor.execute(f"SET TIME ZONE '{APP_TIME_ZONE.key}'")

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
