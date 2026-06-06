"""API Performance Monitor – tracks response times for critical endpoints.

Monitors key API endpoints and logs performance data including:
  - /api/quote (POST) – 3D model quoting
  - /api/auth/login (POST) – user authentication

Features:
  - Per-endpoint latency tracking with rolling window
  - Slow request detection and warning logs
  - Periodic summary statistics
  - Dedicated performance log file
"""

import time
import logging
import logging.handlers
import os
import threading
from collections import deque
from typing import Optional

# Endpoints to monitor with their slow-request thresholds (ms)
MONITORED_ENDPOINTS = {
    "/api/quote": {"method": "POST", "slow_threshold_ms": 5000.0, "label": "报价接口"},
    "/api/auth/login": {"method": "POST", "slow_threshold_ms": 2000.0, "label": "登录接口"},
}

# Rolling window size for latency history
ROLLING_WINDOW_SIZE = 500

# Summary log interval (number of requests between summaries)
SUMMARY_LOG_INTERVAL = 50


class PerformanceMonitor:
    """Tracks and logs response times for critical API endpoints."""

    def __init__(self):
        self._lock = threading.Lock()
        self._latencies: dict[str, deque] = {}
        self._request_counts: dict[str, int] = {}
        self._slow_counts: dict[str, int] = {}
        self._total_ms: dict[str, float] = {}
        self._max_ms: dict[str, float] = {}
        self._min_ms: dict[str, float] = {}

        for endpoint in MONITORED_ENDPOINTS:
            self._latencies[endpoint] = deque(maxlen=ROLLING_WINDOW_SIZE)
            self._request_counts[endpoint] = 0
            self._slow_counts[endpoint] = 0
            self._total_ms[endpoint] = 0.0
            self._max_ms[endpoint] = 0.0
            self._min_ms[endpoint] = float("inf")

        # Set up dedicated performance logger
        self._perf_logger = logging.getLogger("pricer3d.performance")
        self._setup_perf_logger()

    def _setup_perf_logger(self):
        """Configure dedicated performance log file."""
        if self._perf_logger.handlers:
            return

        log_dir = os.getenv("LOG_DIR", "logs").strip() or "logs"
        os.makedirs(log_dir, exist_ok=True)

        perf_log_path = os.path.join(log_dir, "performance.log")
        handler = logging.handlers.RotatingFileHandler(
            perf_log_path,
            maxBytes=10 * 1024 * 1024,  # 10MB
            backupCount=5,
            encoding="utf-8",
        )
        handler.setLevel(logging.INFO)
        fmt = logging.Formatter(
            "%(asctime)s | %(levelname)-5s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(fmt)
        self._perf_logger.addHandler(handler)
        self._perf_logger.setLevel(logging.INFO)

    def is_monitored(self, path: str, method: str) -> bool:
        """Check if an endpoint is being monitored."""
        endpoint = MONITORED_ENDPOINTS.get(path)
        if endpoint and method.upper() == endpoint["method"]:
            return True
        return False

    def record(self, path: str, method: str, duration_ms: float, status_code: int, client_ip: str = "-", request_id: str = "-"):
        """Record a request's response time for a monitored endpoint."""
        config = MONITORED_ENDPOINTS.get(path)
        if not config or method.upper() != config["method"]:
            return

        label = config["label"]
        slow_threshold = config["slow_threshold_ms"]

        with self._lock:
            self._latencies[path].append(duration_ms)
            self._request_counts[path] += 1
            self._total_ms[path] += duration_ms
            if duration_ms > self._max_ms[path]:
                self._max_ms[path] = duration_ms
            if duration_ms < self._min_ms[path]:
                self._min_ms[path] = duration_ms
            is_slow = duration_ms > slow_threshold
            if is_slow:
                self._slow_counts[path] += 1
            count = self._request_counts[path]

        # Log individual request
        self._perf_logger.info(
            "endpoint=%s label=%s method=%s status=%d duration_ms=%.2f ip=%s rid=%s",
            path, label, method, status_code, duration_ms, client_ip, request_id,
        )

        # Log slow requests as warnings
        if is_slow:
            self._perf_logger.warning(
                "SLOW_REQUEST endpoint=%s label=%s duration_ms=%.2f threshold_ms=%.0f ip=%s rid=%s",
                path, label, duration_ms, slow_threshold, client_ip, request_id,
            )

        # Log periodic summary
        if count % SUMMARY_LOG_INTERVAL == 0:
            self._log_summary(path)

    def _log_summary(self, path: str):
        """Log performance summary for an endpoint."""
        with self._lock:
            count = self._request_counts[path]
            if count == 0:
                return
            avg_ms = self._total_ms[path] / count
            max_ms = self._max_ms[path]
            min_ms = self._min_ms[path] if self._min_ms[path] != float("inf") else 0.0
            slow_count = self._slow_counts[path]
            slow_rate = (slow_count / count) * 100.0

            # Calculate p95 from rolling window
            latencies = sorted(self._latencies[path])
            p95_idx = int(len(latencies) * 0.95)
            p95_ms = latencies[min(p95_idx, len(latencies) - 1)] if latencies else 0.0

            p50_idx = int(len(latencies) * 0.5)
            p50_ms = latencies[min(p50_idx, len(latencies) - 1)] if latencies else 0.0

        label = MONITORED_ENDPOINTS.get(path, {}).get("label", path)
        self._perf_logger.info(
            "SUMMARY endpoint=%s label=%s count=%d avg_ms=%.2f p50_ms=%.2f p95_ms=%.2f max_ms=%.2f min_ms=%.2f slow_count=%d slow_rate=%.1f%%",
            path, label, count, avg_ms, p50_ms, p95_ms, max_ms, min_ms, slow_count, slow_rate,
        )

    def get_stats(self, path: str) -> Optional[dict]:
        """Get current performance stats for an endpoint."""
        if path not in self._request_counts:
            return None

        with self._lock:
            count = self._request_counts[path]
            if count == 0:
                return None
            avg_ms = self._total_ms[path] / count
            max_ms = self._max_ms[path]
            min_ms = self._min_ms[path] if self._min_ms[path] != float("inf") else 0.0
            slow_count = self._slow_counts[path]

            latencies = sorted(self._latencies[path])
            p95_idx = int(len(latencies) * 0.95)
            p95_ms = latencies[min(p95_idx, len(latencies) - 1)] if latencies else 0.0
            p50_idx = int(len(latencies) * 0.5)
            p50_ms = latencies[min(p50_idx, len(latencies) - 1)] if latencies else 0.0

        config = MONITORED_ENDPOINTS.get(path, {})
        return {
            "endpoint": path,
            "label": config.get("label", path),
            "method": config.get("method", "POST"),
            "count": count,
            "avg_ms": round(avg_ms, 2),
            "p50_ms": round(p50_ms, 2),
            "p95_ms": round(p95_ms, 2),
            "max_ms": round(max_ms, 2),
            "min_ms": round(min_ms, 2),
            "slow_count": slow_count,
            "slow_threshold_ms": config.get("slow_threshold_ms", 0),
        }

    def get_all_stats(self) -> list[dict]:
        """Get stats for all monitored endpoints."""
        result = []
        for path in MONITORED_ENDPOINTS:
            stats = self.get_stats(path)
            if stats:
                result.append(stats)
        return result


# Singleton instance
performance_monitor = PerformanceMonitor()
