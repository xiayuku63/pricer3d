"""Upload limits and short-lived preview sessions for ZIP quoting."""

import time
import uuid

from fastapi import HTTPException, UploadFile


class PreviewSessionStore:
    """In-memory, one-time storage for parsed ZIP preview data."""

    def __init__(self, ttl_seconds: int = 600):
        self._ttl_seconds = ttl_seconds
        self._sessions = {}

    def store(self, data: dict) -> str:
        session_id = uuid.uuid4().hex
        self._sessions[session_id] = {
            "data": data,
            "expires_at": time.time() + self._ttl_seconds,
        }
        self._purge_expired()
        return session_id

    def get(self, session_id: str):
        entry = self._sessions.get(session_id)
        if not entry:
            return None
        if entry["expires_at"] < time.time():
            self._sessions.pop(session_id, None)
            return None
        return entry["data"]

    def consume(self, session_id: str):
        data = self.get(session_id)
        if data is not None:
            self._sessions.pop(session_id, None)
        return data

    def _purge_expired(self) -> None:
        now = time.time()
        expired = [key for key, value in self._sessions.items() if value["expires_at"] < now]
        for key in expired:
            self._sessions.pop(key, None)


async def read_upload_limited(file: UploadFile, max_size_bytes: int, chunk_bytes: int = 1024 * 1024) -> bytes:
    """Read an upload without allocating beyond the configured size limit."""
    chunks = []
    total = 0
    while True:
        chunk = await file.read(chunk_bytes)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"ZIP \u6587\u4ef6\u4e0d\u80fd\u8d85\u8fc7 {max_size_bytes // (1024 * 1024)}MB",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def read_upload_file_limited(file: UploadFile, max_size_bytes: int) -> bytes:
    """Read the underlying spooled file for the synchronous fallback path."""
    if not getattr(file, "file", None):
        raise HTTPException(status_code=400, detail="ZIP \u6587\u4ef6\u65e0\u6cd5\u8bfb\u53d6")
    try:
        file.file.seek(0)
        content = file.file.read(max_size_bytes + 1)
        file.file.seek(0)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"ZIP \u6587\u4ef6\u65e0\u6cd5\u8bfb\u53d6\uff1a{exc}") from exc
    if len(content) > max_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP \u6587\u4ef6\u4e0d\u80fd\u8d85\u8fc7 {max_size_bytes // (1024 * 1024)}MB",
        )
    return content


def validate_free_zip_capacity(existing_count: int, incoming_count: int, limit: int) -> None:
    if existing_count + incoming_count <= limit:
        return
    remaining = max(0, limit - existing_count)
    raise HTTPException(
        status_code=400,
        detail=f"\u514d\u8d39\u7528\u6237\u6700\u591a\u7d2f\u8ba1 {limit} \u4e2a\u6a21\u578b\uff0c\u5f53\u524d\u8fd8\u53ef\u4e0a\u4f20 {remaining} \u4e2a\uff0c\u672c\u6b21 ZIP \u5305\u542b {incoming_count} \u4e2a",
    )
