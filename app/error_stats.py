"""Error Statistics Module – tracks 4xx and 5xx HTTP errors.

Monitors all API responses and records error statistics including:
  - 4xx client errors (bad request, unauthorized, not found, etc.)
  - 5xx server errors (internal server error, etc.)

Features:
  - Per-status-code error counting
  - Per-URL error tracking
  - Error rate calculation (errors / total requests)
  - Time-window support (last 1h, 24h)
  - Thread-safe in-memory storage
"""

import time
import threading
import logging
from collections import defaultdict, deque
from typing import Optional

# Rolling window size for error history
ROLLING_WINDOW_SIZE = 10000

# Time window constants (seconds)
ONE_HOUR = 3600
ONE_DAY = 86400


class ErrorStats:
    """Tracks HTTP error statistics with time-window support."""

    def __init__(self):
        self._lock = threading.Lock()
        
        # Total request count
        self._total_requests = 0
        
        # Error counts by status code (e.g., {400: 15, 500: 3})
        self._error_by_code: dict[int, int] = defaultdict(int)
        
        # Error counts by URL (e.g., {"/api/quote": 5})
        self._error_by_url: dict[str, int] = defaultdict(int)
        
        # Error counts by URL+status (e.g., {("/api/quote", 500): 3})
        self._error_by_url_code: dict[tuple[str, int], int] = defaultdict(int)
        
        # Rolling window of (timestamp, status_code, url) for time-window queries
        self._error_history: deque = deque(maxlen=ROLLING_WINDOW_SIZE)
        
        # Rolling window of (timestamp, is_error) for time-window error rate
        self._request_history: deque = deque(maxlen=ROLLING_WINDOW_SIZE)
        
        # Logger
        self._logger = logging.getLogger("pricer3d.error_stats")

    def record(self, status_code: int, url: str):
        """Record a request's status code for error tracking."""
        now = time.time()
        is_error = status_code >= 400
        
        with self._lock:
            self._total_requests += 1
            self._request_history.append((now, is_error))
            
            if is_error:
                self._error_by_code[status_code] += 1
                self._error_by_url[url] += 1
                self._error_by_url_code[(url, status_code)] += 1
                self._error_history.append((now, status_code, url))
                
                # Log error occurrence
                if status_code >= 500:
                    self._logger.warning(
                        "SERVER_ERROR status=%d url=%s", status_code, url
                    )
                elif status_code >= 400:
                    self._logger.info(
                        "CLIENT_ERROR status=%d url=%s", status_code, url
                    )

    def _filter_by_time_window(self, window_seconds: int) -> dict:
        """Calculate error statistics for a specific time window."""
        now = time.time()
        cutoff = now - window_seconds
        
        with self._lock:
            # Filter requests in time window
            recent_requests = [
                (ts, is_err) for ts, is_err in self._request_history
                if ts >= cutoff
            ]
            total_in_window = len(recent_requests)
            errors_in_window = sum(1 for _, is_err in recent_requests if is_err)
            
            # Filter errors in time window
            recent_errors = [
                (ts, code, url) for ts, code, url in self._error_history
                if ts >= cutoff
            ]
            
            # Count by status code in window
            error_by_code = defaultdict(int)
            for _, code, _ in recent_errors:
                error_by_code[code] += 1
            
            # Count by URL in window
            error_by_url = defaultdict(int)
            for _, _, url in recent_errors:
                error_by_url[url] += 1
            
            # Top error URLs
            top_urls = sorted(
                error_by_url.items(), key=lambda x: x[1], reverse=True
            )[:10]
            
            # Error rate
            error_rate = (errors_in_window / total_in_window * 100.0) if total_in_window > 0 else 0.0
            
            return {
                "total_requests": total_in_window,
                "total_errors": errors_in_window,
                "error_rate_percent": round(error_rate, 2),
                "error_by_code": dict(sorted(error_by_code.items())),
                "top_error_urls": [
                    {"url": url, "count": count} for url, count in top_urls
                ],
            }

    def get_stats(self, window: str = "1h") -> dict:
        """Get error statistics for a time window.
        
        Args:
            window: Time window - "1h" for last hour, "24h" for last day, "all" for all time
        """
        if window == "1h":
            window_seconds = ONE_HOUR
        elif window == "24h":
            window_seconds = ONE_DAY
        else:
            window_seconds = None
        
        with self._lock:
            if window_seconds is None:
                # All time stats
                total = self._total_requests
                total_errors = sum(self._error_by_code.values())
                error_rate = (total_errors / total * 100.0) if total > 0 else 0.0
                
                top_urls = sorted(
                    self._error_by_url.items(), key=lambda x: x[1], reverse=True
                )[:10]
                
                return {
                    "window": "all",
                    "total_requests": total,
                    "total_errors": total_errors,
                    "error_rate_percent": round(error_rate, 2),
                    "error_by_code": dict(sorted(self._error_by_code.items())),
                    "top_error_urls": [
                        {"url": url, "count": count} for url, count in top_urls
                    ],
                }
        
        # Time-window based stats
        stats = self._filter_by_time_window(window_seconds)
        stats["window"] = window
        return stats

    def get_all_windows(self) -> dict:
        """Get error statistics for all time windows."""
        return {
            "last_1h": self.get_stats("1h"),
            "last_24h": self.get_stats("24h"),
            "all_time": self.get_stats("all"),
        }


# Singleton instance
error_stats = ErrorStats()
