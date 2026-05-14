"""Simple in-memory rate limiter."""

import threading
import time
from collections import defaultdict, deque


class SimpleRateLimiter:
    def __init__(self):
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def is_allowed(self, key: str, limit: int, window_seconds: int = 60) -> bool:
        now = time.time()
        with self._lock:
            bucket = self._buckets[key]
            while bucket and (now - bucket[0]) > window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True
