import copy
import json
import re
import threading
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4


_MISSING = object()


@dataclass
class InsertOneResult:
    inserted_id: str


@dataclass
class UpdateResult:
    matched_count: int = 0
    modified_count: int = 0
    upserted_id: Optional[str] = None


@dataclass
class DeleteResult:
    deleted_count: int = 0


class LocalCursor:
    def __init__(self, documents: List[Dict[str, Any]]):
        self._documents = documents

    def sort(self, field: str, direction: int):
        reverse = direction < 0
        self._documents.sort(
            key=lambda doc: _sort_key(_get_value(doc, field)),
            reverse=reverse,
        )
        return self

    def limit(self, limit: int):
        self._documents = self._documents[: max(limit, 0)]
        return self

    def __iter__(self):
        return iter(self._documents)


class LocalCollection:
    def __init__(self, database: "LocalDatabase", name: str):
        self._database = database
        self._name = name

    def find_one(self, query: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, int]] = None):
        query = query or {}
        with self._database.lock:
            for document in self._documents():
                if _matches_query(document, query):
                    return _apply_projection(copy.deepcopy(document), projection)
        return None

    def find(self, query: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, int]] = None):
        query = query or {}
        with self._database.lock:
            documents = [
                _apply_projection(copy.deepcopy(document), projection)
                for document in self._documents()
                if _matches_query(document, query)
            ]
        return LocalCursor(documents)

    def insert_one(self, document: Dict[str, Any]):
        stored = copy.deepcopy(document)
        stored.setdefault("_id", _generate_id())
        with self._database.lock:
            self._documents().append(stored)
            self._database.save()
        return InsertOneResult(inserted_id=stored["_id"])

    def update_one(self, query: Dict[str, Any], update: Dict[str, Any], upsert: bool = False):
        if set(update.keys()) - {"$set"}:
            raise ValueError("Only $set updates are supported by the local store")

        update_fields = update.get("$set", {})

        with self._database.lock:
            documents = self._documents()
            for index, document in enumerate(documents):
                if not _matches_query(document, query):
                    continue

                before = json.dumps(document, default=_json_default, sort_keys=True)
                updated = copy.deepcopy(document)
                for key, value in update_fields.items():
                    _set_value(updated, key, copy.deepcopy(value))
                after = json.dumps(updated, default=_json_default, sort_keys=True)
                documents[index] = updated
                self._database.save()
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
            documents.append(inserted)
            self._database.save()
            return UpdateResult(upserted_id=inserted["_id"])

    def delete_one(self, query: Dict[str, Any]):
        with self._database.lock:
            documents = self._documents()
            for index, document in enumerate(documents):
                if _matches_query(document, query):
                    documents.pop(index)
                    self._database.save()
                    return DeleteResult(deleted_count=1)
        return DeleteResult()

    def count_documents(self, query: Optional[Dict[str, Any]] = None):
        query = query or {}
        with self._database.lock:
            return sum(1 for document in self._documents() if _matches_query(document, query))

    def aggregate(self, pipeline: List[Dict[str, Any]]):
        with self._database.lock:
            snapshot = copy.deepcopy(self._documents())
        return _run_pipeline(snapshot, pipeline)

    def create_index(self, *_args, **_kwargs):
        return None

    def _documents(self):
        return self._database.data.setdefault(self._name, [])


class LocalDatabase:
    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.data = self._load()

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return LocalCollection(self, name)

    def save(self):
        payload = json.dumps(self.data, indent=2, sort_keys=True, default=_json_default)
        temp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        temp_path.write_text(payload + "\n", encoding="utf-8")
        temp_path.replace(self.path)

    def _load(self):
        if not self.path.exists():
            return {}
        raw = self.path.read_text(encoding="utf-8").strip()
        if not raw:
            return {}
        return json.loads(raw)


def _run_pipeline(documents: List[Dict[str, Any]], pipeline: List[Dict[str, Any]]):
    result = documents
    for stage in pipeline:
        operator, spec = next(iter(stage.items()))
        if operator == "$match":
            result = [document for document in result if _matches_query(document, spec)]
        elif operator == "$project":
            result = [_project_document(document, spec) for document in result]
        elif operator == "$group":
            result = _group_documents(result, spec)
        elif operator == "$sort":
            result = _sort_documents(result, spec)
        elif operator == "$limit":
            result = result[: max(int(spec), 0)]
        elif operator == "$count":
            result = [{spec: len(result)}]
        else:
            raise ValueError(f"Unsupported pipeline stage: {operator}")
    return result


def _group_documents(documents: List[Dict[str, Any]], spec: Dict[str, Any]):
    grouped: Dict[Any, Dict[str, Any]] = {}
    ordered_keys: List[Any] = []

    for document in documents:
        group_key = _evaluate_expression(spec.get("_id"), document)
        key_token = _hashable_key(group_key)
        if key_token not in grouped:
            grouped[key_token] = {"_id": group_key}
            ordered_keys.append(key_token)
            for field, accumulator in spec.items():
                if field == "_id":
                    continue
                grouped[key_token][field] = _initial_accumulator_state(accumulator)

        bucket = grouped[key_token]
        for field, accumulator in spec.items():
            if field == "_id":
                continue
            bucket[field] = _apply_accumulator(bucket[field], accumulator, document)

    output = []
    for key_token in ordered_keys:
        bucket = grouped[key_token]
        finalized = {"_id": bucket["_id"]}
        for field, accumulator in spec.items():
            if field == "_id":
                continue
            finalized[field] = _finalize_accumulator(bucket[field], accumulator)
        output.append(finalized)
    return output


def _sort_documents(documents: List[Dict[str, Any]], spec: Dict[str, int]):
    ordered = documents
    for field, direction in reversed(list(spec.items())):
        ordered = sorted(
            ordered,
            key=lambda document: _sort_key(_get_value(document, field)),
            reverse=direction < 0,
        )
    return ordered


def _project_document(document: Dict[str, Any], spec: Dict[str, Any]):
    projected: Dict[str, Any] = {}
    include_id = spec.get("_id", 1)
    if include_id and "_id" in document:
        projected["_id"] = copy.deepcopy(document["_id"])

    for field, expression in spec.items():
        if field == "_id" or expression in (0, False):
            continue
        if expression in (1, True):
            value = _get_value(document, field)
        else:
            value = _evaluate_expression(expression, document)
        if value is not _MISSING:
            _set_value(projected, field, copy.deepcopy(value))
    return projected


def _initial_accumulator_state(accumulator: Dict[str, Any]):
    operator = next(iter(accumulator.keys()))
    if operator == "$sum":
        return 0
    if operator == "$last":
        return None
    if operator == "$max":
        return None
    if operator == "$avg":
        return {"total": 0, "count": 0}
    raise ValueError(f"Unsupported accumulator: {operator}")


def _apply_accumulator(state: Any, accumulator: Dict[str, Any], document: Dict[str, Any]):
    operator, expression = next(iter(accumulator.items()))
    if operator == "$sum":
        value = _evaluate_expression(expression, document)
        return state + (value or 0)
    if operator == "$last":
        return _evaluate_expression(expression, document)
    if operator == "$max":
        value = _evaluate_expression(expression, document)
        if state is None:
            return value
        if value is None:
            return state
        return value if value > state else state
    if operator == "$avg":
        value = _evaluate_expression(expression, document)
        if value is None:
            return state
        return {"total": state["total"] + value, "count": state["count"] + 1}
    raise ValueError(f"Unsupported accumulator: {operator}")


def _finalize_accumulator(state: Any, accumulator: Dict[str, Any]):
    operator = next(iter(accumulator.keys()))
    if operator == "$avg":
        if not state["count"]:
            return 0
        return state["total"] / state["count"]
    return state


def _evaluate_expression(expression: Any, document: Dict[str, Any]):
    if isinstance(expression, str) and expression.startswith("$"):
        value = _get_value(document, expression[1:])
        return None if value is _MISSING else value

    if not isinstance(expression, dict):
        return expression

    if "$cond" in expression:
        condition, on_true, on_false = expression["$cond"]
        return _evaluate_expression(on_true, document) if _evaluate_condition(condition, document) else _evaluate_expression(on_false, document)

    if "$eq" in expression:
        left, right = expression["$eq"]
        return _evaluate_expression(left, document) == _evaluate_expression(right, document)

    if "$substr" in expression:
        source, start, length = expression["$substr"]
        value = _evaluate_expression(source, document)
        if value is None:
            return ""
        return str(value)[start : start + length]

    raise ValueError(f"Unsupported expression: {expression}")


def _evaluate_condition(condition: Any, document: Dict[str, Any]):
    result = _evaluate_expression(condition, document)
    return bool(result)


def _matches_query(document: Dict[str, Any], query: Dict[str, Any]):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches_query(document, item) for item in expected):
                return False
            continue

        if key == "$and":
            if not all(_matches_query(document, item) for item in expected):
                return False
            continue

        actual = _get_value(document, key)
        if not _matches_value(actual, expected):
            return False
    return True


def _matches_value(actual: Any, expected: Any):
    if not isinstance(expected, dict):
        if actual is _MISSING:
            return False
        return actual == expected

    for operator, operand in expected.items():
        if operator == "$options":
            continue
        if operator == "$exists":
            exists = actual is not _MISSING
            if bool(operand) != exists:
                return False
            continue
        if actual is _MISSING:
            return False
        if operator == "$gte" and not (actual >= operand):
            return False
        if operator == "$ne" and not (actual != operand):
            return False
        if operator == "$in" and actual not in operand:
            return False
        if operator == "$nin" and actual in operand:
            return False
        if operator == "$regex":
            flags = 0
            options = expected.get("$options", "")
            if "i" in options:
                flags |= re.IGNORECASE
            if not re.search(operand, str(actual), flags):
                return False
    return True


def _apply_projection(document: Dict[str, Any], projection: Optional[Dict[str, int]]):
    if not projection:
        return document

    include_fields = [field for field, value in projection.items() if field != "_id" and value]
    exclude_fields = [field for field, value in projection.items() if not value]

    if include_fields:
        result: Dict[str, Any] = {}
        if projection.get("_id", 1) and "_id" in document:
            result["_id"] = copy.deepcopy(document["_id"])
        for field in include_fields:
            value = _get_value(document, field)
            if value is not _MISSING:
                _set_value(result, field, copy.deepcopy(value))
        return result

    result = copy.deepcopy(document)
    for field in exclude_fields:
        _delete_value(result, field)
    return result


def _extract_equality_fields(query: Dict[str, Any]):
    extracted = {}
    for key, value in query.items():
        if key.startswith("$") or isinstance(value, dict):
            continue
        _set_value(extracted, key, copy.deepcopy(value))
    return extracted


def _get_value(document: Dict[str, Any], path: str):
    current: Any = document
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return _MISSING
        current = current[part]
    return current


def _set_value(document: Dict[str, Any], path: str, value: Any):
    current = document
    parts = path.split(".")
    for part in parts[:-1]:
        child = current.get(part)
        if not isinstance(child, dict):
            child = {}
            current[part] = child
        current = child
    current[parts[-1]] = value


def _delete_value(document: Dict[str, Any], path: str):
    current = document
    parts = path.split(".")
    for part in parts[:-1]:
        current = current.get(part)
        if not isinstance(current, dict):
            return
    if isinstance(current, dict):
        current.pop(parts[-1], None)


def _generate_id():
    return uuid4().hex


def _hashable_key(value: Any):
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    return json.dumps(value, sort_keys=True, default=_json_default)


def _sort_key(value: Any):
    if value is _MISSING or value is None:
        return (1, "")
    return (0, value)


def _json_default(value: Any):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")
