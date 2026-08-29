"""Ownership-checked cleanup for direct-upload quote artifacts.

Each direct-upload quote stores its model and G-code under
``data/uploads/user_<id>_<name>/<YYYYMMDD>/<job>/``. When a user deletes a
quote row (or clears all rows) the frontend passes back that row's
``saved_path``; these helpers validate ownership before deleting anything.
"""

import logging
import os
import shutil

logger = logging.getLogger(__name__)


def _uploads_base() -> str:
    # Must match calculator/cost.py's save location ("data/uploads", relative
    # to the server working directory).
    return os.path.abspath(os.path.join("data", "uploads"))


def resolve_job_dir(saved_path: str, user_id: int) -> str | None:
    """Return the job directory containing ``saved_path`` when it provably
    belongs to ``user_id``; None otherwise. Never returns the base itself."""
    raw = str(saved_path or "").strip()
    if not raw:
        return None
    base = _uploads_base()
    target = os.path.abspath(raw)
    if not target.startswith(base + os.sep):
        return None
    rel_parts = os.path.relpath(target, base).split(os.sep)
    if len(rel_parts) < 3:  # <user>/…/file — need at least user/date/job/file depth for the job dir
        return None
    if not rel_parts[0].startswith(f"user_{user_id}_"):
        return None
    job_dir = os.path.dirname(target)
    if job_dir == base or not job_dir.startswith(base + os.sep):
        return None
    return job_dir


def list_user_direct_upload_dirs(user_id: int) -> list[str]:
    """All direct-upload roots owned by ``user_id``."""
    base = _uploads_base()
    owner_prefix = f"user_{user_id}_"
    dirs: list[str] = []
    try:
        for name in os.listdir(base):
            path = os.path.abspath(os.path.join(base, name))
            if name.startswith(owner_prefix) and os.path.isdir(path):
                dirs.append(path)
    except OSError:
        pass
    return dirs


def delete_directories(dirs: list[str]) -> int:
    deleted = 0
    for directory in {os.path.abspath(d) for d in dirs}:
        # Defence in depth: re-verify containment at deletion time.
        if not os.path.abspath(directory).startswith(_uploads_base() + os.sep):
            logger.warning("artifact cleanup refused path outside uploads root: %s", directory)
            continue
        try:
            shutil.rmtree(directory, ignore_errors=True)
            deleted += 1
        except OSError as e:
            logger.warning("artifact cleanup failed for %s: %s", directory, e)
    if deleted:
        logger.info("artifact cleanup removed %d job dir(s)", deleted)
    return deleted
