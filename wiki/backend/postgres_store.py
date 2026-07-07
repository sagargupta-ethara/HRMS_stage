import copy
import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import psycopg
from psycopg.types.json import Jsonb

try:
    from .local_store import (
        DeleteResult,
        InsertOneResult,
        LocalCursor,
        UpdateResult,
        _apply_projection,
        _extract_equality_fields,
        _generate_id,
        _json_default,
        _matches_query,
        _run_pipeline,
        _set_value,
    )
except ImportError:
    from local_store import (
        DeleteResult,
        InsertOneResult,
        LocalCursor,
        UpdateResult,
        _apply_projection,
        _extract_equality_fields,
        _generate_id,
        _json_default,
        _matches_query,
        _run_pipeline,
        _set_value,
    )


def _jsonb_payload(document: Dict[str, Any]) -> Jsonb:
    return Jsonb(document, dumps=lambda value: json.dumps(value, default=_json_default))


class PostgresCollection:
    def __init__(self, database: "PostgresDatabase", name: str):
        self._database = database
        self._name = name

    def find_one(self, query: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, int]] = None):
        query = query or {}
        with self._database.lock:
            for document in self._database._load_collection(self._name):
                if _matches_query(document, query):
                    return _apply_projection(copy.deepcopy(document), projection)
        return None

    def find(self, query: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, int]] = None):
        query = query or {}
        with self._database.lock:
            documents = [
                _apply_projection(copy.deepcopy(document), projection)
                for document in self._database._load_collection(self._name)
                if _matches_query(document, query)
            ]
        return LocalCursor(documents)

    def insert_one(self, document: Dict[str, Any]):
        stored = copy.deepcopy(document)
        stored.setdefault("_id", _generate_id())
        with self._database.lock:
            self._database._write_document(self._name, stored)
        return InsertOneResult(inserted_id=stored["_id"])

    def update_one(self, query: Dict[str, Any], update: Dict[str, Any], upsert: bool = False):
        if set(update.keys()) - {"$set"}:
            raise ValueError("Only $set updates are supported by the PostgreSQL store")

        update_fields = update.get("$set", {})

        with self._database.lock:
            documents = self._database._load_collection(self._name)
            for document in documents:
                if not _matches_query(document, query):
                    continue

                before = json.dumps(document, default=_json_default, sort_keys=True)
                updated = copy.deepcopy(document)
                for key, value in update_fields.items():
                    _set_value(updated, key, copy.deepcopy(value))
                after = json.dumps(updated, default=_json_default, sort_keys=True)
                self._database._write_document(self._name, updated)
                return UpdateResult(
                    matched_count=1,
                    modified_count=1 if before != after else 0,
                )

            if not upsert:
                return UpdateResult()

            inserted = {
                "_id": _generate_id(),
                **_extract_equality_fields(query),
            }
            for key, value in update_fields.items():
                _set_value(inserted, key, copy.deepcopy(value))
            self._database._write_document(self._name, inserted)
            return UpdateResult(upserted_id=inserted["_id"])

    def delete_one(self, query: Dict[str, Any]):
        with self._database.lock:
            for document in self._database._load_collection(self._name):
                if _matches_query(document, query):
                    self._database._delete_document(self._name, document["_id"])
                    return DeleteResult(deleted_count=1)
        return DeleteResult()

    def count_documents(self, query: Optional[Dict[str, Any]] = None):
        query = query or {}
        with self._database.lock:
            return sum(1 for document in self._database._load_collection(self._name) if _matches_query(document, query))

    def aggregate(self, pipeline: List[Dict[str, Any]]):
        with self._database.lock:
            snapshot = copy.deepcopy(self._database._load_collection(self._name))
        return _run_pipeline(snapshot, pipeline)

    def create_index(self, *_args, **_kwargs):
        return None


class PostgresDatabase:
    TABLE_NAME = "wiki_documents"

    def __init__(self, dsn: str):
        self.dsn = dsn
        self.lock = threading.RLock()
        self._ensure_schema()

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return PostgresCollection(self, name)

    def import_local_json(self, path: str):
        source = Path(path)
        if not source.exists():
            return False
        if self._count_all_documents() > 0:
            return False

        raw = source.read_text(encoding="utf-8").strip()
        if not raw:
            return False

        payload = json.loads(raw)
        with self.lock:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    for collection_name, documents in payload.items():
                        if not isinstance(documents, list):
                            continue
                        for document in documents:
                            stored = copy.deepcopy(document)
                            stored.setdefault("_id", _generate_id())
                            cur.execute(
                                f"""
                                INSERT INTO {self.TABLE_NAME} (collection_name, document_id, payload, updated_at)
                                VALUES (%s, %s, %s, NOW())
                                ON CONFLICT (collection_name, document_id)
                                DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                                """,
                                (collection_name, str(stored["_id"]), _jsonb_payload(stored)),
                            )
        return True

    def _connect(self):
        return psycopg.connect(self.dsn)

    def _ensure_schema(self):
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {self.TABLE_NAME} (
                        collection_name TEXT NOT NULL,
                        document_id TEXT NOT NULL,
                        payload JSONB NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        PRIMARY KEY (collection_name, document_id)
                    )
                    """
                )
                cur.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS idx_{self.TABLE_NAME}_collection
                    ON {self.TABLE_NAME} (collection_name)
                    """
                )
                cur.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS idx_{self.TABLE_NAME}_payload_gin
                    ON {self.TABLE_NAME}
                    USING GIN (payload)
                    """
                )

    def _count_all_documents(self) -> int:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) FROM {self.TABLE_NAME}")
                row = cur.fetchone()
                return int(row[0] if row else 0)

    def _load_collection(self, collection_name: str):
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT payload
                    FROM {self.TABLE_NAME}
                    WHERE collection_name = %s
                    ORDER BY document_id
                    """,
                    (collection_name,),
                )
                rows = cur.fetchall()
        return [self._normalize_payload(row[0]) for row in rows]

    def _write_document(self, collection_name: str, document: Dict[str, Any]):
        stored = copy.deepcopy(document)
        stored.setdefault("_id", _generate_id())
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO {self.TABLE_NAME} (collection_name, document_id, payload, updated_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (collection_name, document_id)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                    """,
                    (collection_name, str(stored["_id"]), _jsonb_payload(stored)),
                )

    def _delete_document(self, collection_name: str, document_id: str):
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM {self.TABLE_NAME} WHERE collection_name = %s AND document_id = %s",
                    (collection_name, str(document_id)),
                )

    @staticmethod
    def _normalize_payload(value: Any):
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            return json.loads(value)
        raise TypeError(f"Unsupported payload type returned from PostgreSQL: {type(value).__name__}")
