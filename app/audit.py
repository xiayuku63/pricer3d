"""Audit event logging and idempotency support."""

import json
import time
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import Request

from .db import get_db_session
from .models_orm import AuditEvent, IdempotencyResponse
from .config import IDEMPOTENCY_TTL_SECONDS
from .utils import get_client_ip

_logger = logging.getLogger(__name__)


def write_audit_event(
    action: str,
    request: Optional[Request] = None,
    user=None,
    detail: Optional[dict] = None,
    idempotency_key: Optional[str] = None,
) -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    user_id = None
    username = None
    if user is not None:
        try:
            user_id = int(user["id"])
        except Exception as e:
            _logger.debug("audit: failed to parse user_id from user: %s", e)
            user_id = None
        username = str(user.get("username") if hasattr(user, "get") else user["username"]) if user is not None else None
    ip = get_client_ip(request) if request is not None else None
    method = request.method if request is not None else None
    path = request.url.path if request is not None else None
    request_id = getattr(getattr(request, "state", None), "request_id", None) if request is not None else None
    detail_json = json.dumps(detail or {}, ensure_ascii=False)
    with get_db_session() as db:
        event = AuditEvent(
            created_at=created_at,
            user_id=user_id,
            username=username,
            action=action,
            ip=ip,
            method=method,
            path=path,
            request_id=request_id,
            idempotency_key=idempotency_key,
            detail_json=detail_json,
        )
        db.add(event)


def get_idempotency_key_from_request(request: Request) -> Optional[str]:
    raw = request.headers.get("Idempotency-Key") or request.headers.get("X-Idempotency-Key")
    if not raw:
        return None
    key = raw.strip()
    if not key:
        return None
    if len(key) > 120:
        return None
    return key


def try_get_idempotent_response(user_id: int, request: Request, idem_key: str) -> Optional[tuple[int, dict]]:
    now = time.time()
    with get_db_session() as db:
        row = (
            db.query(IdempotencyResponse)
            .filter(
                IdempotencyResponse.user_id == int(user_id),
                IdempotencyResponse.method == request.method,
                IdempotencyResponse.path == request.url.path,
                IdempotencyResponse.idem_key == idem_key,
            )
            .first()
        )
    if not row:
        return None
    try:
        expires_at = float(row.expires_at)
    except Exception as e:
        _logger.debug("audit: failed to parse expires_at from idempotency row: %s", e)
        return None
    if now > expires_at:
        return None
    try:
        payload = json.loads(row.response_json)
    except Exception as e:
        _logger.debug("audit: failed to parse response_json from idempotency row: %s", e)
        return None
    return int(row.status_code), payload


def save_idempotent_response(user_id: int, request: Request, idem_key: str, status_code: int, payload: dict) -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    expires_at = str(time.time() + IDEMPOTENCY_TTL_SECONDS)
    response_json = json.dumps(payload, ensure_ascii=False)
    with get_db_session() as db:
        # Delete existing entry if any (equivalent to INSERT OR REPLACE)
        existing = (
            db.query(IdempotencyResponse)
            .filter(
                IdempotencyResponse.user_id == int(user_id),
                IdempotencyResponse.method == request.method,
                IdempotencyResponse.path == request.url.path,
                IdempotencyResponse.idem_key == idem_key,
            )
            .first()
        )
        if existing:
            existing.created_at = created_at
            existing.expires_at = expires_at
            existing.status_code = int(status_code)
            existing.response_json = response_json
        else:
            entry = IdempotencyResponse(
                created_at=created_at,
                expires_at=expires_at,
                user_id=int(user_id),
                method=request.method,
                path=request.url.path,
                idem_key=idem_key,
                status_code=int(status_code),
                response_json=response_json,
            )
            db.add(entry)
