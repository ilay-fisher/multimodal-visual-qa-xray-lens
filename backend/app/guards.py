"""In-memory cost guards for the paid VLM path: rate limit, daily cap and response cache."""

import time
from collections import OrderedDict, deque
from datetime import UTC, date, datetime
from typing import Any


class RateLimiter:
    """In-memory per-key sliding-window limiter."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int) -> bool:
        """Record a hit for ``key``; False when ``limit`` hits already fit the window."""
        now = time.monotonic()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= 60:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


class DailyBudget:
    """Counts paid requests per UTC day; the count resets at UTC midnight."""

    def __init__(self) -> None:
        self._day: date | None = None
        self._count = 0

    def take(self, cap: int) -> bool:
        """Consume one request from today's budget; False when the cap is reached."""
        today = datetime.now(UTC).date()
        if today != self._day:
            self._day, self._count = today, 0
        if self._count >= cap:
            return False
        self._count += 1
        return True


class ResponseCache(OrderedDict[str, dict[str, Any]]):
    """Small LRU cache of finished diagnoses."""

    def __init__(self, size: int = 256) -> None:
        super().__init__()
        self.size = size

    def lookup(self, key: str) -> dict[str, Any] | None:
        """Return a cached result and mark it recently used."""
        if key in self:
            self.move_to_end(key)
        return self.get(key)

    def store(self, key: str, value: dict[str, Any]) -> None:
        """Store a result, evicting the least recently used entry when full."""
        self[key] = value
        while len(self) > self.size:
            self.popitem(last=False)
