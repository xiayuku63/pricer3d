import asyncio
import io

import pytest
from fastapi import HTTPException, UploadFile

import app.services.zip_quote_session as zip_session
from app.services.zip_quote_session import PreviewSessionStore, read_upload_limited, validate_free_zip_capacity


def test_preview_session_store_is_one_time():
    store = PreviewSessionStore(ttl_seconds=60)
    session_id = store.store({"models": ["part.stl"]})

    assert store.get(session_id) == {"models": ["part.stl"]}
    assert store.consume(session_id) == {"models": ["part.stl"]}
    assert store.get(session_id) is None


def test_preview_session_store_expires(monkeypatch):
    now = 1000.0
    monkeypatch.setattr(zip_session.time, "time", lambda: now)
    store = PreviewSessionStore(ttl_seconds=10)
    session_id = store.store({"ok": True})

    monkeypatch.setattr(zip_session.time, "time", lambda: now + 11)
    assert store.get(session_id) is None


def test_read_upload_limited_rejects_over_limit():
    upload = UploadFile(filename="models.zip", file=io.BytesIO(b"12345"))

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(read_upload_limited(upload, max_size_bytes=4, chunk_bytes=2))
    assert exc_info.value.status_code == 400
    assert "400" not in str(exc_info.value.detail)


def test_validate_free_zip_capacity_keeps_limit_message():
    with pytest.raises(HTTPException) as exc_info:
        validate_free_zip_capacity(existing_count=9, incoming_count=2, limit=10)
    assert exc_info.value.status_code == 400
    assert "1" in exc_info.value.detail
    assert "2" in exc_info.value.detail

