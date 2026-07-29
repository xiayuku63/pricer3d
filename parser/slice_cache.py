from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import weakref
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

_CACHE_SCHEMA_VERSION = 1
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_CACHE_ROOT = _PROJECT_ROOT / "data" / "slicer_cache"
_CACHE_LOCKS_GUARD = threading.Lock()
_CACHE_LOCKS: weakref.WeakValueDictionary[str, threading.Lock] = weakref.WeakValueDictionary()
_CACHE_CLEANUP_GUARD = threading.Lock()
_LAST_CACHE_CLEANUP = 0.0


def slice_cache_enabled(explicit: Optional[bool] = None) -> bool:
    """Return whether content-addressed slice caching is enabled."""
    if explicit is not None:
        return bool(explicit)
    raw = os.getenv("PRUSA_SLICE_CACHE", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def slice_cache_root() -> Path:
    configured = os.getenv("PRUSA_SLICE_CACHE_DIR", "").strip()
    return Path(configured).expanduser() if configured else _DEFAULT_CACHE_ROOT


def _hash_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@lru_cache(maxsize=8)
def slicer_identity(command: tuple[str, ...]) -> str:
    """Build a stable cache namespace for the active PrusaSlicer binary.

    Native binaries are fingerprinted from their file metadata. Wrapper commands
    (notably WSL) are queried once per process so upgrading PrusaSlicer naturally
    invalidates older cache entries.
    """
    if not command:
        return "unknown"

    executable = command[0]
    if os.path.isfile(executable):
        try:
            stat = os.stat(executable)
            return f"{' '.join(command)}|{os.path.realpath(executable)}|{stat.st_size}|{stat.st_mtime_ns}"
        except OSError:
            pass

    version = ""
    try:
        output = subprocess.check_output(
            list(command) + ["--help"],
            stderr=subprocess.STDOUT,
            timeout=10,
            shell=False,
        )
        text = output.replace(b"\x00", b"").decode("utf-8", errors="replace")
        version = next(
            (line.strip() for line in text.splitlines() if "PrusaSlicer-" in line or "based on Slic3r" in line),
            "",
        )
    except Exception:
        logger.debug("Unable to fingerprint PrusaSlicer version for cache", exc_info=True)

    namespace = os.getenv("PRUSA_SLICE_CACHE_NAMESPACE", "v1").strip() or "v1"
    return f"{' '.join(command)}|{version}|{namespace}"


def build_slice_cache_key(
    model_path: str,
    config_path: str,
    *,
    command: list[str],
    enable_supports: bool,
) -> str:
    """Hash every input that can affect generated G-code."""
    payload = {
        "schema": _CACHE_SCHEMA_VERSION,
        "model_sha256": _hash_file(model_path),
        "model_suffix": Path(model_path).suffix.lower(),
        "config_sha256": _hash_file(config_path),
        "slicer": slicer_identity(tuple(command)),
        "enable_supports": bool(enable_supports),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _cache_paths(key: str) -> tuple[Path, Path]:
    root = slice_cache_root()
    return root / f"{key}.json", root / f"{key}.gcode"


@contextmanager
def slice_cache_lock(key: str) -> Iterator[None]:
    """Collapse concurrent identical slices into a single PrusaSlicer run."""
    with _CACHE_LOCKS_GUARD:
        lock = _CACHE_LOCKS.setdefault(key, threading.Lock())
    with lock:
        yield


def load_cached_slice(key: str, output_gcode_path: str) -> Optional[dict]:
    """Restore cached G-code and return cached stats, or None on a miss."""
    metadata_path, gcode_path = _cache_paths(key)
    if not metadata_path.is_file() or not gcode_path.is_file():
        return None
    try:
        if gcode_path.stat().st_size <= 0:
            return None
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("schema") != _CACHE_SCHEMA_VERSION or not isinstance(metadata.get("stats"), dict):
            return None

        output_path = Path(output_gcode_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(gcode_path, output_path)
        now = time.time()
        os.utime(metadata_path, (now, now))
        os.utime(gcode_path, (now, now))
        stats = dict(metadata["stats"])
        stats["cache_hit"] = True
        stats["_slice_cache_key"] = key
        if isinstance(metadata.get("gcode_summary"), dict):
            stats["gcode_summary"] = metadata["gcode_summary"]
        return stats
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        logger.warning("Ignoring invalid PrusaSlicer cache entry: %s", key, exc_info=True)
        return None


def store_cached_slice(key: str, output_gcode_path: str, stats: dict) -> None:
    """Atomically persist G-code and stats for future identical requests."""
    output_path = Path(output_gcode_path)
    if not output_path.is_file() or output_path.stat().st_size <= 0:
        return

    metadata_path, gcode_path = _cache_paths(key)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    temp_gcode: Optional[Path] = None
    temp_metadata: Optional[Path] = None
    try:
        fd, temp_gcode_raw = tempfile.mkstemp(prefix=f".{key}.", suffix=".gcode.tmp", dir=metadata_path.parent)
        os.close(fd)
        temp_gcode = Path(temp_gcode_raw)
        shutil.copyfile(output_path, temp_gcode)
        os.replace(temp_gcode, gcode_path)
        temp_gcode = None

        fd, temp_metadata_raw = tempfile.mkstemp(prefix=f".{key}.", suffix=".json.tmp", dir=metadata_path.parent)
        temp_metadata = Path(temp_metadata_raw)
        with os.fdopen(fd, "w", encoding="utf-8") as metadata_file:
            json.dump(
                {
                    "schema": _CACHE_SCHEMA_VERSION,
                    "created_at": int(time.time()),
                    "stats": {**stats, "cache_hit": False},
                },
                metadata_file,
                ensure_ascii=False,
                separators=(",", ":"),
            )
        os.replace(temp_metadata, metadata_path)
        temp_metadata = None
    except OSError:
        logger.warning("Failed to store PrusaSlicer cache entry: %s", key, exc_info=True)
    finally:
        for temp_path in (temp_gcode, temp_metadata):
            if temp_path is not None:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    _cleanup_cache_if_due()


def store_cached_slice_analysis(key: str, gcode_summary: dict) -> None:
    """Attach parsed G-code summary to an existing cache entry."""
    if not key or not isinstance(gcode_summary, dict):
        return
    metadata_path, gcode_path = _cache_paths(key)
    if not metadata_path.is_file() or not gcode_path.is_file():
        return

    with slice_cache_lock(key):
        temp_metadata: Optional[Path] = None
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata.get("schema") != _CACHE_SCHEMA_VERSION or not isinstance(metadata.get("stats"), dict):
                return
            metadata["gcode_summary"] = gcode_summary
            fd, temp_metadata_raw = tempfile.mkstemp(
                prefix=f".{key}.",
                suffix=".json.tmp",
                dir=metadata_path.parent,
            )
            temp_metadata = Path(temp_metadata_raw)
            with os.fdopen(fd, "w", encoding="utf-8") as metadata_file:
                json.dump(metadata, metadata_file, ensure_ascii=False, separators=(",", ":"))
            os.replace(temp_metadata, metadata_path)
            temp_metadata = None
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            logger.warning("Failed to store cached G-code analysis: %s", key, exc_info=True)
        finally:
            if temp_metadata is not None:
                try:
                    temp_metadata.unlink(missing_ok=True)
                except OSError:
                    pass


def _cleanup_cache_if_due() -> None:
    """Bound persistent cache size and age without scanning on every hit."""
    global _LAST_CACHE_CLEANUP
    now = time.time()
    with _CACHE_CLEANUP_GUARD:
        if now - _LAST_CACHE_CLEANUP < 60:
            return
        _LAST_CACHE_CLEANUP = now

    root = slice_cache_root()
    if not root.is_dir():
        return
    try:
        max_bytes = max(0, int(float(os.getenv("PRUSA_SLICE_CACHE_MAX_MB", "1024")) * 1024 * 1024))
        max_age_seconds = max(0, int(float(os.getenv("PRUSA_SLICE_CACHE_MAX_AGE_DAYS", "30")) * 86400))
    except ValueError:
        max_bytes = 1024 * 1024 * 1024
        max_age_seconds = 30 * 86400

    entries: list[tuple[float, int, Path, Path]] = []
    for metadata_path in root.glob("*.json"):
        gcode_path = metadata_path.with_suffix(".gcode")
        try:
            if not gcode_path.is_file():
                metadata_path.unlink(missing_ok=True)
                continue
            last_used = max(metadata_path.stat().st_mtime, gcode_path.stat().st_mtime)
            size = metadata_path.stat().st_size + gcode_path.stat().st_size
            if max_age_seconds and now - last_used > max_age_seconds:
                metadata_path.unlink(missing_ok=True)
                gcode_path.unlink(missing_ok=True)
                continue
            entries.append((last_used, size, metadata_path, gcode_path))
        except OSError:
            continue

    total_bytes = sum(item[1] for item in entries)
    if not max_bytes or total_bytes <= max_bytes:
        return
    for _last_used, size, metadata_path, gcode_path in sorted(entries, key=lambda item: item[0]):
        try:
            metadata_path.unlink(missing_ok=True)
            gcode_path.unlink(missing_ok=True)
            total_bytes -= size
        except OSError:
            continue
        if total_bytes <= max_bytes:
            break
