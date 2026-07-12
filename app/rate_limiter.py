"""Database-backed rate limiter with in-memory cache for performance."""

import time
import logging
import threading
import datetime as _dt
from collections import defaultdict, deque

_logger = logging.getLogger(__name__)

class PersistentRateLimiter:
    """Hybrid rate limiter: fast in-memory check + optional DB persistence."""

    def __init__(self):
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._flush_interval = 60  # seconds between DB flushes
        self._last_flush: dict[str, float] = {}

    def is_allowed(self, key: str, limit: int, window_seconds: int = 60) -> bool:
        now = time.time()
        with self._lock:
            bucket = self._buckets[key]
            while bucket and (now - bucket[0]) > window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                # Persist blocked event
                self._maybe_persist(key, limit, window_seconds, len(bucket))
                return False
            bucket.append(now)
            self._maybe_persist(key, limit, window_seconds, len(bucket))
            return True

    def _maybe_persist(self, key: str, limit: int, window: int, count: int) -> None:
        """Flush state to DB periodically."""
        now = time.time()
        last = self._last_flush.get(key, 0)
        if now - last < self._flush_interval and count < limit:
            return
        self._last_flush[key] = now
        try:
            from .db import get_db_session
            from .models_orm import RateLimitState
            with get_db_session() as db:
                existing = db.query(RateLimitState).filter(RateLimitState.rate_key == key[:200]).first()
                bucket_json = f'{{"count":{count},"limit":{limit},"window":{window}}}'
                updated_at = _dt.datetime.now(_dt.timezone.utc)
                if existing:
                    existing.bucket_json = bucket_json
                    existing.updated_at = updated_at
                else:
                    rls = RateLimitState(
                        rate_key=key[:200],
                        bucket_json=bucket_json,
                        updated_at=updated_at,
                    )
                    db.add(rls)
        except Exception as e:
            _logger.warning("rate_limiter: failed to persist state for key=%s: %s", key, e)

    def restore_state(self) -> None:
        """Restore rate limit state from DB on startup."""
        try:
            from .db import get_db_session
            from .models_orm import RateLimitState
            now = time.time()
            with get_db_session() as db:
                rows = db.query(RateLimitState).all()
                row_data = [(r.rate_key, r.bucket_json) for r in rows]
            with self._lock:
                for rate_key, bucket_json in row_data:
                    try:
                        import json
                        data = json.loads(bucket_json)
                        count = int(data.get("count", 0))
                        if count > 0:
                            key = rate_key
                            bucket = self._buckets[key]
                            spacing = float(data.get("window", 60)) / max(count, 1)
                            for i in range(count):
                                bucket.append(now - (count - i) * spacing)
                    except Exception as e:
                        _logger.debug("rate_limiter: failed to restore state for row key=%s: %s", rate_key, e)
        except Exception as e:
            _logger.warning("rate_limiter: failed to restore state from DB: %s", e)

    def get_state(self, key: str) -> dict:
        """Get current state for a key (for monitoring)."""
        now = time.time()
        with self._lock:
            bucket = self._buckets.get(key, deque())
            return {"key": key, "count": len(bucket), "pending": list(bucket)[:10]}
