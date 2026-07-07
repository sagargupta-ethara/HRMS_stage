"""Shared helpers for safe CSV/spreadsheet exports.

Spreadsheet apps (Excel, Google Sheets, LibreOffice) treat a cell whose text
starts with ``= + - @`` (or a leading tab/CR) as a formula. When that text comes
from user-controlled fields (names, emails, free-text), an attacker can smuggle a
formula into an export that executes in whoever opens it (CSV/formula injection,
CWE-1236). Prefix such string cells with a single quote so they render as literal
text. Mirrors the inline ``_csv_safe`` used in the candidate/employee exports.
"""

from __future__ import annotations

from typing import Any

_DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe_cell(value: Any) -> Any:
    """Return ``value`` unchanged unless it is a formula-triggering string, in
    which case it is prefixed with a single quote. Non-strings pass through."""
    if not isinstance(value, str) or not value:
        return value
    if value[0] in _DANGEROUS_PREFIXES:
        return "'" + value
    return value


def csv_safe_row(row: list[Any]) -> list[Any]:
    """Apply :func:`csv_safe_cell` to every cell in a row."""
    return [csv_safe_cell(cell) for cell in row]


def csv_safe_mapping(row: dict[str, Any]) -> dict[str, Any]:
    """Apply :func:`csv_safe_cell` to every value in a dict row (for DictWriter)."""
    return {key: csv_safe_cell(val) for key, val in row.items()}
