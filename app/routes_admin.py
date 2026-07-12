"""Admin routes."""

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Request, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .config import DEFAULT_MATERIALS, DEFAULT_COLORS, DEFAULT_PRICING_CONFIG, APP_DEFAULTS_KEY, AUDIT_RETENTION_DAYS
from .db import get_db_session
from .models_orm import User, AppDefault, AuditEvent, VerificationCode, IdempotencyResponse, LoginFailure
from sqlalchemy import or_, func, cast, Float, and_
from .deps import get_current_user, is_admin_user, require_admin, mask_email, mask_phone
from .utils import normalize_materials
from .audit import write_audit_event
from .middleware import metrics
from .database import merge_pricing_config
from .auth import get_user_by_id
from .backup import create_backup, list_backups, cleanup_old_backups
from calculator.cost import validate_formula_expression


class AdminMembershipUpdateRequest(BaseModel):
    membership_level: str = Field(..., min_length=3, max_length=30)
    membership_expires_at: Optional[str] = None


# ---------- Defaults ----------

async def admin_get_defaults(current_user=Depends(get_current_user)):
    require_admin(current_user)
    from .database import get_app_defaults
    return get_app_defaults()


async def admin_set_defaults_from_me(request: Request, current_user=Depends(get_current_user)):
    require_admin(current_user)
    with get_db_session() as db:
        row = db.query(User.materials, User.colors, User.pricing_config).filter(User.id == current_user["id"]).first()
    raw_materials = json.loads(row.materials) if row and row.materials else DEFAULT_MATERIALS
    colors = json.loads(row.colors) if row and row.colors else DEFAULT_COLORS
    materials = normalize_materials(raw_materials, fallback_colors=colors)
    derived_colors = []
    for m in materials:
        for c in m.get("colors", []):
            if c not in derived_colors:
                derived_colors.append(c)
    raw_pricing = json.loads(row.pricing_config) if row and row.pricing_config else DEFAULT_PRICING_CONFIG
    pricing_config = merge_pricing_config(raw_pricing)
    unit_ok, unit_err, _ = validate_formula_expression(str(pricing_config.get("unit_cost_formula") or "").strip())
    total_ok, total_err, _ = validate_formula_expression(str(pricing_config.get("total_cost_formula") or "").strip())
    if not unit_ok or not total_ok:
        messages = []
        if not unit_ok:
            messages.append(f"单件公式：{unit_err or '无效'}")
        if not total_ok:
            messages.append(f"总价公式：{total_err or '无效'}")
        raise HTTPException(status_code=400, detail="；".join(messages) or "公式无效")
    payload = {"materials": materials, "colors": derived_colors, "pricing_config": pricing_config}
    now_iso = datetime.now(timezone.utc).isoformat()
    value_json = json.dumps(payload, ensure_ascii=False)
    with get_db_session() as db:
        existing = db.query(AppDefault).filter(AppDefault.key == APP_DEFAULTS_KEY).first()
        if existing:
            existing.value_json = value_json
            existing.updated_at = now_iso
            existing.updated_by = int(current_user["id"])
            existing.updated_by_username = str(current_user["username"])
        else:
            ad = AppDefault(
                key=APP_DEFAULTS_KEY,
                value_json=value_json,
                updated_at=now_iso,
                updated_by=int(current_user["id"]),
                updated_by_username=str(current_user["username"]),
            )
            db.add(ad)
    write_audit_event(
        action="admin.defaults.update",
        request=request,
        user=current_user,
        detail={"key": APP_DEFAULTS_KEY, "materials_count": len(materials), "colors_count": len(derived_colors)},
    )
    return {"status": "ok", "key": APP_DEFAULTS_KEY, "updated_at": now_iso}


# ---------- Users ----------

async def admin_list_users(
    q: str = "",
    limit: int = 50,
    offset: int = 0,
    current_user=Depends(get_current_user),
):
    require_admin(current_user)
    safe_limit = max(1, min(int(limit), 200))
    safe_offset = max(0, int(offset))
    keyword = f"%{(q or '').strip()}%"
    with get_db_session() as db:
        total = (
            db.query(func.count(User.id))
            .filter(
                or_(
                    User.username.like(keyword),
                    func.ifnull(User.email, "").like(keyword),
                    func.ifnull(User.phone, "").like(keyword),
                )
            )
            .scalar()
        )
        rows = (
            db.query(User)
            .filter(
                or_(
                    User.username.like(keyword),
                    func.ifnull(User.email, "").like(keyword),
                    func.ifnull(User.phone, "").like(keyword),
                )
            )
            .order_by(User.id.desc())
            .offset(safe_offset)
            .limit(safe_limit)
            .all()
        )
        items = []
        for row in rows:
            items.append(
                {
                    "id": row.id,
                    "username": row.username,
                    "email_masked": mask_email(row.email),
                    "phone_masked": mask_phone(row.phone),
                    "email_verified": bool(row.email_verified or 0),
                    "phone_verified": bool(row.phone_verified or 0),
                    "membership_level": (str(row.membership_level or "free").strip().lower() or "free"),
                    "membership_expires_at": row.membership_expires_at,
                    "created_at": row.created_at,
                }
            )
    return {"total": total or 0, "limit": safe_limit, "offset": safe_offset, "items": items}


async def admin_update_user_membership(
    user_id: int,
    payload: AdminMembershipUpdateRequest,
    request: Request,
    current_user=Depends(get_current_user),
):
    require_admin(current_user)
    safe_id = int(user_id)
    level = (payload.membership_level or "").strip().lower()
    if level not in {"free", "member"}:
        raise HTTPException(status_code=400, detail="membership_level 仅支持 free / member")
    with get_db_session() as db:
        row = db.query(User).filter(User.id == safe_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        target_username = row.username
        row.membership_level = level
        if payload.membership_expires_at is not None:
            row.membership_expires_at = payload.membership_expires_at
    write_audit_event(
        action="admin.user.membership.update",
        request=request,
        user=current_user,
        detail={
            "target_user_id": safe_id,
            "target_username": target_username,
            "membership_level": level,
        },
    )
    return {"status": "ok", "user_id": safe_id, "membership_level": level}


# ---------- Audit ----------

async def admin_list_audit(
    q: str = "",
    action: str = "",
    username: str = "",
    limit: int = 100,
    offset: int = 0,
    current_user=Depends(get_current_user),
):
    require_admin(current_user)
    safe_limit = max(1, min(int(limit), 200))
    safe_offset = max(0, int(offset))
    keyword = f"%{(q or '').strip()}%"
    action_kw = f"%{(action or '').strip()}%"
    user_kw = f"%{(username or '').strip()}%"
    with get_db_session() as db:
        # Build base filter
        base_filter = (
            AuditEvent.action.like(action_kw),
            func.ifnull(AuditEvent.username, "").like(user_kw),
        )
        keyword_filter = or_(
            keyword == "%%",
            AuditEvent.action.like(keyword),
            func.ifnull(AuditEvent.username, "").like(keyword),
            func.ifnull(AuditEvent.ip, "").like(keyword),
            func.ifnull(AuditEvent.method, "").like(keyword),
            func.ifnull(AuditEvent.path, "").like(keyword),
            func.ifnull(AuditEvent.request_id, "").like(keyword),
        )
        total = (
            db.query(func.count(AuditEvent.id))
            .filter(*base_filter, keyword_filter)
            .scalar()
        )
        rows = (
            db.query(AuditEvent)
            .filter(*base_filter, keyword_filter)
            .order_by(AuditEvent.id.desc())
            .offset(safe_offset)
            .limit(safe_limit)
            .all()
        )
        items = []
        for row in rows:
            detail = {}
            try:
                detail = json.loads(row.detail_json or "{}")
                if not isinstance(detail, dict):
                    detail = {"_": detail}
            except Exception:
                detail = {}
            items.append(
                {
                    "id": row.id,
                    "created_at": row.created_at,
                    "user_id": row.user_id,
                    "username": row.username,
                    "action": row.action,
                    "ip": row.ip,
                    "method": row.method,
                    "path": row.path,
                    "request_id": row.request_id,
                    "idempotency_key": row.idempotency_key,
                    "detail": detail,
                }
            )
    return {"total": total or 0, "limit": safe_limit, "offset": safe_offset, "items": items}


# ---------- Metrics ----------

async def admin_metrics(current_user=Depends(get_current_user)):
    require_admin(current_user)
    return metrics.snapshot()


# ---------- Cleanup ----------

async def admin_cleanup(request: Request, current_user=Depends(get_current_user)):
    require_admin(current_user)
    now = time.time()
    from .config import LOGIN_FAILED_WINDOW_SECONDS
    cutoff_audit = datetime.now(timezone.utc) - timedelta(days=max(1, AUDIT_RETENTION_DAYS))
    deleted = {"verification_codes": 0, "idempotency_responses": 0, "login_failures": 0, "audit_events": 0}
    with get_db_session() as db:
        # Delete expired/used verification codes
        count = (
            db.query(VerificationCode)
            .filter(
                or_(
                    VerificationCode.used_at.isnot(None),
                    cast(VerificationCode.expires_at, Float) < float(now),
                )
            )
            .delete(synchronize_session=False)
        )
        deleted["verification_codes"] = count

        # Delete expired idempotency responses
        count = (
            db.query(IdempotencyResponse)
            .filter(cast(IdempotencyResponse.expires_at, Float) < float(now))
            .delete(synchronize_session=False)
        )
        deleted["idempotency_responses"] = count

        # Delete old login failures
        count = (
            db.query(LoginFailure)
            .filter(
                and_(
                    cast(LoginFailure.locked_until, Float) < float(now),
                    cast(LoginFailure.last_failed_at, Float) < float(now - max(3600, LOGIN_FAILED_WINDOW_SECONDS)),
                )
            )
            .delete(synchronize_session=False)
        )
        deleted["login_failures"] = count

        # Delete old audit events
        count = (
            db.query(AuditEvent)
            .filter(AuditEvent.created_at < cutoff_audit)
            .delete(synchronize_session=False)
        )
        deleted["audit_events"] = count

    write_audit_event(action="admin.maintenance.cleanup", request=request, user=current_user, detail={"deleted": deleted})
    return {"status": "ok", "deleted": deleted, "audit_retention_days": AUDIT_RETENTION_DAYS}


# ---------- Backup ----------

async def admin_backup_create(request: Request, current_user=Depends(get_current_user)):
    require_admin(current_user)
    try:
        info = create_backup()
        write_audit_event(action="admin.backup.create", request=request, user=current_user, detail=info)
        return {"status": "ok", **info}
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"备份失败: {str(e)}")


async def admin_backup_list(current_user=Depends(get_current_user)):
    require_admin(current_user)
    return {"items": list_backups()}


async def admin_backup_cleanup(request: Request, current_user=Depends(get_current_user)):
    require_admin(current_user)
    deleted = cleanup_old_backups()
    write_audit_event(action="admin.backup.cleanup", request=request, user=current_user, detail={"deleted": deleted})
    return {"status": "ok", "deleted": deleted}
