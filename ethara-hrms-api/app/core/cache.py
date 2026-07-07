"""Optional Redis-backed read cache.

Disabled by default (CACHE_ENABLED=false) so behaviour is unchanged unless a
deployment opts in. Every operation degrades to a no-op when caching is off or
Redis is unreachable, so the cache can never break a request — a cache failure
simply falls through to the underlying source.

Typical use for a read-heavy, low-volatility endpoint::

    from app.core.cache import cache

    data = cache.get_json("positions:list")
    if data is None:
        data = expensive_query()
        cache.set_json("positions:list", data, ttl=120)
    # invalidate on write:
    cache.delete("positions:list")
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class _Cache:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._client = None
        self._init_attempted = False

    @property
    def enabled(self) -> bool:
        return bool(self._settings.cache_enabled)

    def _redis(self):
        if not self.enabled:
            return None
        if self._init_attempted:
            return self._client
        self._init_attempted = True
        try:
            import redis

            self._client = redis.Redis.from_url(
                self._settings.redis_url,
                socket_connect_timeout=2,
                socket_timeout=2,
                decode_responses=True,
            )
            self._client.ping()
        except Exception as exc:  # pragma: no cover - environment dependent
            logger.warning("Redis cache unavailable, falling back to no-op: %s", exc)
            self._client = None
        return self._client

    def get_json(self, key: str) -> Any | None:
        client = self._redis()
        if client is None:
            return None
        try:
            raw = client.get(key)
            return json.loads(raw) if raw is not None else None
        except Exception:
            return None

    def set_json(self, key: str, value: Any, *, ttl: int | None = None) -> None:
        client = self._redis()
        if client is None:
            return
        try:
            client.set(
                key,
                json.dumps(value, default=str),
                ex=ttl or self._settings.cache_default_ttl_seconds,
            )
        except Exception:
            pass

    def delete(self, *keys: str) -> None:
        client = self._redis()
        if client is None or not keys:
            return
        try:
            client.delete(*keys)
        except Exception:
            pass


cache = _Cache()
