"""Authentication – JWT, password hashing, user CRUD, verification codes, SMTP email."""

import time
import re
import ssl
import smtplib
import hashlib
import logging
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import jwt
from fastapi import HTTPException

from .config import (
    JWT_SECRET_KEY,
    JWT_ALGORITHM,
    JWT_EXPIRE_HOURS,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASSWORD,
    SMTP_FROM,
    SMTP_USE_SSL,
    SMTP_USE_TLS,
    RESEND_API_KEY,
    VERIFY_CODE_TTL_SECONDS,
    VERIFY_CODE_TTL_SECONDS,
    VERIFY_CODE_MAX_ATTEMPTS,
    VERIFY_SEND_COOLDOWN_SECONDS,
)
from .db import get_db_session
from .models_orm import User, VerificationCode, LoginFailure
from .database import get_app_defaults
from .utils import (
    normalize_email,
    normalize_phone,
    validate_username_or_raise,
    hash_verify_code,
    generate_numeric_code,
)
from .config import DEFAULT_MATERIALS, DEFAULT_COLORS, DEFAULT_PRICING_CONFIG

_logger = logging.getLogger(__name__)


def _user_to_dict(user) -> dict:
    """Convert a User ORM object to a dict with string keys."""
    if user is None:
        return None
    return {
        "id": user.id,
        "username": user.username,
        "password_hash": user.password_hash,
        "created_at": user.created_at,
        "materials": user.materials,
        "colors": user.colors,
        "pricing_config": user.pricing_config,
        "email": user.email,
        "phone": user.phone,
        "email_verified": user.email_verified,
        "phone_verified": user.phone_verified,
        "membership_level": user.membership_level,
        "membership_expires_at": user.membership_expires_at,
        "terms_accepted_at": user.terms_accepted_at,
        "privacy_accepted_at": user.privacy_accepted_at,
        "terms_version": user.terms_version,
        "privacy_version": user.privacy_version,
        "default_printer_id": user.default_printer_id,
        "default_nozzle": user.default_nozzle,
        "default_slicer_preset_id": user.default_slicer_preset_id,
        "default_material": user.default_material,
        "default_color": user.default_color,
    }


# ---------- password ----------

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))


# ---------- JWT ----------

def create_access_token(user_id: int, username: str, expire_hours: Optional[int] = None) -> str:
    hours = expire_hours if expire_hours is not None else JWT_EXPIRE_HOURS
    expire = datetime.now(timezone.utc) + timedelta(hours=hours)
    payload = {"sub": str(user_id), "username": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


# ---------- user queries ----------

def get_user_by_username(username: str):
    with get_db_session() as db:
        user = db.query(User).filter(User.username == username).first()
        return _user_to_dict(user)


def get_user_by_email(email: str):
    with get_db_session() as db:
        user = db.query(User).filter(User.email == email).first()
        return _user_to_dict(user)


def get_user_by_phone(phone: str):
    with get_db_session() as db:
        user = db.query(User).filter(User.phone == phone).first()
        return _user_to_dict(user)


def get_user_by_identifier(identifier: str):
    raw = (identifier or "").strip()
    if not raw:
        return None
    if "@" in raw:
        return get_user_by_email(normalize_email(raw))
    if re.fullmatch(r"[\d\+\-\s\(\)]+", raw or ""):
        return get_user_by_phone(normalize_phone(raw))
    return get_user_by_username(validate_username_or_raise(raw))


def get_user_by_id(user_id: int):
    with get_db_session() as db:
        user = db.query(User).filter(User.id == user_id).first()
        return _user_to_dict(user)


def authenticate_user(identifier: str, password: str):
    user = get_user_by_identifier(identifier)
    if not user:
        raise HTTPException(status_code=401, detail="账号不存在")
    if not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="密码错误")
    return user


# ---------- verification codes ----------

def create_verification_code(channel: str, target: str) -> tuple[str, int]:
    code = generate_numeric_code(6)
    now = time.time()
    expires_at = now + VERIFY_CODE_TTL_SECONDS
    created_at = datetime.now(timezone.utc).isoformat()
    with get_db_session() as db:
        vc = VerificationCode(
            channel=channel,
            target=target,
            code_hash=hash_verify_code(code),
            expires_at=expires_at,
            created_at=created_at,
            used_at=None,
            attempts=0,
        )
        db.add(vc)
        db.flush()
        row_id = vc.id
    return code, row_id


def delete_verification_code_row(row_id: int) -> None:
    rid = int(row_id or 0)
    if rid <= 0:
        return
    with get_db_session() as db:
        db.query(VerificationCode).filter(VerificationCode.id == rid).delete()


def consume_verification_code(channel: str, target: str, code: str) -> bool:
    now = time.time()
    now_iso = datetime.now(timezone.utc).isoformat()
    supplied = hash_verify_code(code)
    with get_db_session() as db:
        row = (
            db.query(VerificationCode)
            .filter(
                VerificationCode.channel == channel,
                VerificationCode.target == target,
                VerificationCode.used_at.is_(None),
            )
            .order_by(VerificationCode.id.desc())
            .first()
        )
        if not row:
            return False
        try:
            expires_at = float(row.expires_at)
        except Exception as e:
            _logger.debug("auth: failed to parse verification code expires_at: %s", e)
            return False
        if now > expires_at:
            row.used_at = now_iso
            return False
        attempts = int(row.attempts or 0) + 1
        if attempts > VERIFY_CODE_MAX_ATTEMPTS:
            row.attempts = attempts
            row.used_at = now_iso
            return False
        if supplied != str(row.code_hash or ""):
            row.attempts = attempts
            return False
        row.attempts = attempts
        row.used_at = now_iso
        return True


# ---------- SMTP email ----------

def is_smtp_configured() -> bool:
    if RESEND_API_KEY:
        return True
    if not SMTP_HOST:
        return False
    if SMTP_USE_SSL and SMTP_PORT <= 0:
        return False
    if SMTP_USE_TLS and SMTP_PORT <= 0:
        return False
    return True


def send_email_via_resend(to_email: str, code: str) -> tuple[bool, str]:
    """Send via Resend API. Returns (ok, error_message)."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        html_body = f"""\
<div style="max-width:480px;margin:0 auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb">
  <h2 style="color:#4f46e5;margin:0 0 16px">3D打印自动报价系统</h2>
  <p style="color:#374151;font-size:14px;line-height:1.6">您正在进行邮箱验证，验证码如下：</p>
  <div style="background:#eef2ff;border-radius:8px;padding:20px;text-align:center;margin:20px 0">
    <span style="font-size:28px;font-weight:700;letter-spacing:6px;color:#4f46e5;font-family:'Courier New',monospace">{code}</span>
  </div>
  <p style="color:#6b7280;font-size:12px;line-height:1.6">有效期：{int(VERIFY_CODE_TTL_SECONDS)} 秒<br>如非本人操作，请忽略本邮件。</p>
</div>"""
        resend.Emails.send({
            "from": "noreply@pricer3d.top",
            "to": [to_email],
            "subject": "邮箱验证码 - 3D打印自动报价系统",
            "html": html_body,
        })
        return True, ""
    except Exception as e:
        msg = str(e)[:200]
        logger.error(f"Resend send failed to {to_email}: {e}")
        return False, msg


def send_email_verification_code(to_email: str, code: str) -> None:
    import os
    # Resend 优先
    if RESEND_API_KEY:
        ok, err = send_email_via_resend(to_email, code)
        if not ok:
            raise RuntimeError(err or "邮件发送失败，请稍后重试")
        return
    if not is_smtp_configured():
        raise RuntimeError("SMTP 未配置")
    from_addr = (SMTP_FROM or SMTP_USER or "").strip()
    if not from_addr:
        raise RuntimeError("SMTP_FROM 未配置")
    msg = EmailMessage()
    msg["Subject"] = "邮箱验证码 - 3D打印自动报价系统"
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.set_content(
        "\n".join(
            [
                "您正在注册 3D打印自动报价系统。",
                f"本次邮箱验证码：{code}",
                f"有效期：{int(VERIFY_CODE_TTL_SECONDS)} 秒",
                "",
                "如非本人操作，请忽略本邮件。",
            ]
        )
    )
    timeout_s = float(os.getenv("SMTP_TIMEOUT_SECONDS", "10") or "10")
    if SMTP_USE_SSL:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=timeout_s, context=context) as server:
            if SMTP_USER and SMTP_PASSWORD:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        return
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=timeout_s) as server:
        server.ehlo()
        if SMTP_USE_TLS:
            context = ssl.create_default_context()
            server.starttls(context=context)
            server.ehlo()
        if SMTP_USER and SMTP_PASSWORD:
            server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
    return


# ---------- user creation ----------

def create_user(username: str, password: str, email: Optional[str], phone: Optional[str], email_verified: int, phone_verified: int):
    import json
    # Hard guard: block duplicates at application layer
    if get_user_by_username(username):
        raise HTTPException(status_code=409, detail="用户名已存在")
    if email and get_user_by_email(email):
        raise HTTPException(status_code=409, detail="邮箱已存在")
    if phone and get_user_by_phone(phone):
        raise HTTPException(status_code=409, detail="手机号已存在")

    password_hash = get_password_hash(password)
    created_at = datetime.now(timezone.utc).isoformat()
    defaults = get_app_defaults()
    materials_json = json.dumps(defaults.get("materials") or DEFAULT_MATERIALS)
    colors_json = json.dumps(defaults.get("colors") or DEFAULT_COLORS)
    pricing_json = json.dumps(defaults.get("pricing_config") or DEFAULT_PRICING_CONFIG)
    membership_level = "free"
    membership_expires_at = None
    accepted_at = datetime.now(timezone.utc).isoformat()
    try:
        with get_db_session() as db:
            user = User(
                username=username,
                password_hash=password_hash,
                created_at=created_at,
                materials=materials_json,
                colors=colors_json,
                pricing_config=pricing_json,
                email=email,
                phone=phone,
                email_verified=email_verified,
                phone_verified=phone_verified,
                membership_level=membership_level,
                membership_expires_at=membership_expires_at,
                terms_accepted_at=accepted_at,
                privacy_accepted_at=accepted_at,
                terms_version="v1",
                privacy_version="v1",
            )
            db.add(user)
            db.flush()
            result = {"id": user.id, "username": user.username, "created_at": user.created_at}
    except Exception:
        raise HTTPException(status_code=409, detail="用户名或邮箱/手机号已存在")
    if not result:
        raise HTTPException(status_code=500, detail="REGISTRATION_FAILED")
    return result


# ---------- login failure tracking ----------

def _login_failure_key_hash(identifier: str) -> str:
    raw = (identifier or "").strip().lower()
    return hashlib.sha256((raw + "|" + JWT_SECRET_KEY).encode("utf-8")).hexdigest()


def is_login_locked(identifier: str) -> tuple[bool, int]:
    key_hash = _login_failure_key_hash(identifier)
    now = time.time()
    with get_db_session() as db:
        row = db.query(LoginFailure).filter(LoginFailure.key_hash == key_hash).first()
    if not row:
        return False, 0
    try:
        locked_until = float(row.locked_until or 0)
    except Exception as e:
        _logger.debug("auth: failed to parse locked_until in is_login_locked: %s", e)
        locked_until = 0.0
    if locked_until and now < locked_until:
        return True, max(1, int(locked_until - now))
    return False, 0


def clear_login_failures(identifier: str) -> None:
    key_hash = _login_failure_key_hash(identifier)
    with get_db_session() as db:
        db.query(LoginFailure).filter(LoginFailure.key_hash == key_hash).delete()


def record_login_failure(identifier: str) -> tuple[bool, int]:
    from .config import LOGIN_FAILED_MAX_ATTEMPTS, LOGIN_FAILED_WINDOW_SECONDS, LOGIN_LOCK_SECONDS
    key_hash = _login_failure_key_hash(identifier)
    now = time.time()
    now_iso = datetime.now(timezone.utc).isoformat()
    window_start = now - LOGIN_FAILED_WINDOW_SECONDS
    with get_db_session() as db:
        row = db.query(LoginFailure).filter(LoginFailure.key_hash == key_hash).first()
        if row:
            try:
                first_failed_at = float(row.first_failed_at or 0)
            except Exception as e:
                _logger.debug("auth: failed to parse first_failed_at: %s", e)
                first_failed_at = 0.0
            try:
                locked_until = float(row.locked_until or 0)
            except Exception as e:
                _logger.debug("auth: failed to parse locked_until in record_login_failure: %s", e)
                locked_until = 0.0
            if locked_until and now < locked_until:
                return True, max(1, int(locked_until - now))
            if not first_failed_at or first_failed_at < window_start:
                fail_count = 1
                first_failed_at = now
            else:
                fail_count = int(row.fail_count or 0) + 1
            locked = False
            remaining = 0
            new_locked_until = 0.0
            if fail_count >= LOGIN_FAILED_MAX_ATTEMPTS:
                locked = True
                new_locked_until = now + LOGIN_LOCK_SECONDS
                remaining = int(LOGIN_LOCK_SECONDS)
            row.fail_count = int(fail_count)
            row.first_failed_at = first_failed_at
            row.last_failed_at = now
            row.locked_until = new_locked_until
            return locked, remaining
        else:
            lf = LoginFailure(
                created_at=now_iso,
                key_hash=key_hash,
                fail_count=1,
                first_failed_at=now,
                last_failed_at=now,
                locked_until=0.0,
            )
            db.add(lf)
            return False, 0
