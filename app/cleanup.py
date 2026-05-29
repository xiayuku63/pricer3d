"""
Disk cleanup — automatically removes expired files.

- G-code outputs: 7-day retention
- Uploaded models (STL/STP/3MF): 30-day retention

Runs as `python3 -m app.cleanup` (from /app directory in Docker).
Configured via env vars: USER_DATA_DIR (default: user/ relative to /app/data).
Safe to run multiple times — checks file mtime, not directory names.
"""

import os
import time
import shutil
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [cleanup] %(message)s")
logger = logging.getLogger("cleanup")

GCODE_RETENTION_SECONDS = 7 * 24 * 3600    # 7 days
UPLOAD_RETENTION_SECONDS = 30 * 24 * 3600  # 30 days
DRY_RUN = os.getenv("CLEANUP_DRY_RUN", "").strip().lower() in ("1", "true", "yes")


def _now() -> float:
    return time.time()


def _get_data_dir() -> str:
    """Resolve the user data directory."""
    env = os.getenv("USER_DATA_DIR", "").strip()
    if env:
        return env
    # Default: relative to /app/data (Docker WORKDIR is /app)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "user")


def _dir_age_seconds(dirpath: str) -> float:
    """Return the age (in seconds) of the NEWEST file in the directory.
    If the directory is empty, return its own mtime.
    If it doesn't exist, return 0.
    """
    if not os.path.isdir(dirpath):
        return 0
    newest = 0.0
    try:
        for entry in os.scandir(dirpath):
            if entry.is_file():
                newest = max(newest, entry.stat().st_mtime)
            elif entry.is_dir():
                newest = max(newest, _dir_age_seconds(entry.path))
    except OSError:
        pass
    if newest == 0:
        newest = os.path.getmtime(dirpath)
    return _now() - newest


def _delete_dir(dirpath: str) -> bool:
    """Delete a directory tree. Returns True on success."""
    if DRY_RUN:
        logger.info("DRY-RUN would delete: %s", dirpath)
        return True
    try:
        shutil.rmtree(dirpath)
        logger.info("Deleted: %s", dirpath)
        return True
    except OSError as e:
        logger.warning("Failed to delete %s: %s", dirpath, e)
        return False


def _cleanup_expired_dirs(base_dir: str, retention_seconds: int, label: str) -> int:
    """Walk `base_dir` and delete leaf directories older than retention_seconds.

    Structure: base_dir/YYYYMMDD/job_dir/
    A directory is expired only if ALL files inside are older than retention.
    After cleanup, remove empty parent directories.
    """
    deleted = 0
    if not os.path.isdir(base_dir):
        return 0

    for date_dir in sorted(os.listdir(base_dir)):
        date_path = os.path.join(base_dir, date_dir)
        if not os.path.isdir(date_path):
            continue

        for job_dir in sorted(os.listdir(date_path)):
            job_path = os.path.join(date_path, job_dir)
            if not os.path.isdir(job_path):
                continue

            age = _dir_age_seconds(job_path)
            if age > retention_seconds:
                if _delete_dir(job_path):
                    deleted += 1

        # Clean up empty date directories
        try:
            remaining = [d for d in os.listdir(date_path) if os.path.isdir(os.path.join(date_path, d))]
            if not remaining:
                if DRY_RUN:
                    logger.info("DRY-RUN would delete empty dir: %s", date_path)
                else:
                    os.rmdir(date_path)
                    logger.info("Deleted empty dir: %s", date_path)
        except OSError:
            pass

    return deleted


def run_cleanup(data_dir: str | None = None) -> dict:
    """Main entry point. Returns summary dict."""
    if data_dir is None:
        data_dir = _get_data_dir()

    logger.info("Starting cleanup: data_dir=%s dry_run=%s", data_dir, DRY_RUN)

    result = {"outputs_deleted": 0, "uploads_deleted": 0}

    if not os.path.isdir(data_dir):
        logger.warning("Data directory not found: %s", data_dir)
        return result

    # Iterate user directories
    for user_dir in sorted(os.listdir(data_dir)):
        user_path = os.path.join(data_dir, user_dir)
        if not os.path.isdir(user_path):
            continue

        # Clean outputs (gcode) — 7 days
        outputs_base = os.path.join(user_path, "outputs")
        if os.path.isdir(outputs_base):
            n = _cleanup_expired_dirs(outputs_base, GCODE_RETENTION_SECONDS, "gcode")
            result["outputs_deleted"] += n

        # Clean uploads — 30 days
        uploads_base = os.path.join(user_path, "uploads")
        if os.path.isdir(uploads_base):
            n = _cleanup_expired_dirs(uploads_base, UPLOAD_RETENTION_SECONDS, "upload")
            result["uploads_deleted"] += n

    logger.info(
        "Cleanup done: %d gcode dirs, %d upload dirs deleted",
        result["outputs_deleted"],
        result["uploads_deleted"],
    )
    return result


if __name__ == "__main__":
    run_cleanup()
