"""Content-addressed cache for smart orientation results.

Orientation analysis (convex-hull clustering + candidate scoring) costs
multiple seconds per model and is deterministic for identical geometry —
re-quoting the same file with different print params re-ran it every time.
This cache stores the analysis metadata (JSON) plus the rotated mesh next to
the slice cache, keyed by the model's content hash.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = 1
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_CACHE_ROOT = _PROJECT_ROOT / "data" / "orientation_cache"

_CLEANUP_GUARD = threading.Lock()
_LAST_CLEANUP = 0.0


def orientation_cache_enabled() -> bool:
    raw = os.getenv("ORIENTATION_CACHE", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def orientation_cache_root() -> Path:
    configured = os.getenv("ORIENTATION_CACHE_DIR", "").strip()
    return Path(configured).expanduser() if configured else _DEFAULT_CACHE_ROOT


def _max_cache_mb() -> int:
    try:
        return max(64, int(os.getenv("ORIENTATION_CACHE_MAX_MB", "512")))
    except ValueError:
        return 512


def _max_age_days() -> int:
    try:
        return max(1, int(os.getenv("ORIENTATION_CACHE_MAX_AGE_DAYS", "30")))
    except ValueError:
        return 30


def _hash_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _paths(key: str) -> tuple[Path, Path]:
    root = orientation_cache_root()
    return root / f"{key}.json", root / f"{key}.stl"


def _jsonable(value):
    """Recursively convert numpy scalars/arrays to plain JSON types."""
    import numpy as np

    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def orientation_cache_lookup(model_path: str) -> Optional[dict]:
    """Return a cached analysis result with a usable ``oriented_path``, or None.

    On a hit the cached rotated mesh is copied to a fresh temp file because
    callers (calculator.cost) delete ``oriented_path`` after slicing — the
    cache-owned copy must survive.
    """
    if not orientation_cache_enabled():
        return None
    try:
        key = _hash_file(model_path)
    except OSError:
        return None
    meta_path, mesh_path = _paths(key)
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, ValueError):
        return None
    if payload.get("schema") != _SCHEMA_VERSION:
        return None

    result = dict(payload.get("result") or {})
    if payload.get("oriented_same") or not result:
        result["oriented_path"] = model_path
    else:
        if not mesh_path.is_file():
            return None
        try:
            os.utime(mesh_path, None)
        except OSError:
            pass
        fd, tmp = tempfile.mkstemp(suffix=".stl", prefix="p3d_orient_cache_")
        os.close(fd)
        try:
            shutil.copyfile(mesh_path, tmp)
        except OSError:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            return None
        result["oriented_path"] = tmp
    result["original_path"] = model_path
    result["orientation_cache_hit"] = True
    return result


def orientation_cache_store(model_path: str, result: dict) -> None:
    """Persist an analysis result; any failure is logged and ignored."""
    if not orientation_cache_enabled() or not isinstance(result, dict):
        return
    oriented = result.get("oriented_path")
    oriented_same = (not oriented) or os.path.abspath(str(oriented)) == os.path.abspath(model_path)
    if not oriented_same and not os.path.isfile(str(oriented)):
        return

    try:
        key = _hash_file(model_path)
    except OSError:
        return
    meta_path, mesh_path = _paths(key)
    try:
        root = orientation_cache_root()
        root.mkdir(parents=True, exist_ok=True)
        if not oriented_same:
            tmp_mesh = mesh_path.with_suffix(".stl.tmp")
            shutil.copyfile(str(oriented), tmp_mesh)
            os.replace(tmp_mesh, mesh_path)
        payload = {
            "schema": _SCHEMA_VERSION,
            "oriented_same": oriented_same,
            "model_name": os.path.basename(model_path),
            "stored_at": time.time(),
            "result": _jsonable(
                {k: v for k, v in result.items() if k not in ("oriented_path", "original_path")}
            ),
        }
        tmp_meta = meta_path.with_suffix(".json.tmp")
        with open(tmp_meta, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp_meta, meta_path)
    except Exception:
        logger.debug("orientation cache store failed", exc_info=True)
        return
    _cleanup_if_due()


def _cleanup_if_due() -> None:
    global _LAST_CLEANUP
    with _CLEANUP_GUARD:
        if time.time() - _LAST_CLEANUP < 60:
            return
        _LAST_CLEANUP = time.time()
    try:
        _evict_expired()
    except Exception:
        logger.debug("orientation cache cleanup failed", exc_info=True)


def _evict_expired() -> None:
    root = orientation_cache_root()
    if not root.is_dir():
        return
    cutoff = time.time() - _max_age_days() * 86400
    entries: list[tuple[float, int, Path]] = []
    for meta in root.glob("*.json"):
        mesh = meta.with_suffix(".stl")
        try:
            stat = meta.stat()
        except OSError:
            continue
        size = stat.st_size + (mesh.stat().st_size if mesh.is_file() else 0)
        if stat.st_mtime < cutoff:
            meta.unlink(missing_ok=True)
            mesh.unlink(missing_ok=True)
            continue
        entries.append((stat.st_mtime, size, meta))
    budget = _max_cache_mb() * 1024 * 1024
    total = sum(size for _, size, _ in entries)
    for mtime, size, meta in sorted(entries):  # oldest first
        if total <= budget:
            break
        mesh = meta.with_suffix(".stl")
        meta.unlink(missing_ok=True)
        mesh.unlink(missing_ok=True)
        total -= size
