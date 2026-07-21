"""Utility functions – filenames, dirs, email/phone normalization, materials."""

import os
import re
import hashlib
import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, Request

from .config import (
    JWT_SECRET_KEY,
    DEFAULT_MATERIALS,
    DEFAULT_COLORS,
    EMAIL_PATTERN,
    PHONE_PATTERN,
    USERNAME_PATTERN,
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
)

FILENAME_DISALLOWED_CHARS = set('\\/:*?"<>|')


def _sanitize_filename_component(value: str, fallback: str, max_len: int = 120) -> str:
    raw = (value or "").strip()
    if not raw:
        return fallback
    out_chars: list[str] = []
    for ch in raw:
        code = ord(ch)
        if code < 32 or code == 127:
            out_chars.append("_")
            continue
        if ch in FILENAME_DISALLOWED_CHARS:
            out_chars.append("_")
            continue
        out_chars.append(ch)
    cleaned = re.sub(r"\s+", " ", "".join(out_chars)).strip()
    if not cleaned:
        cleaned = fallback
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip()
    return cleaned or fallback


def _user_base_dir() -> str:
    return _ensure_dir(os.getenv("USER_DATA_DIR", "user").strip() or "user")


def _ensure_dir(path: str) -> str:
    p = str(path or "").strip() or "."
    os.makedirs(p, exist_ok=True)
    return p


def _date_folder_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def _uploads_base_dir() -> str:
    return _ensure_dir(os.getenv("UPLOADS_DIR", "uploads").strip() or "uploads")


def _outputs_base_dir() -> str:
    return _ensure_dir(os.getenv("OUTPUTS_DIR", "outputs").strip() or "outputs")


def _configs_base_dir() -> str:
    return _ensure_dir(os.getenv("CONFIGS_DIR", "configs").strip() or "configs")


def normalize_email(value: str) -> str:
    email = (value or "").strip().lower()
    if not email or len(email) > 254 or not EMAIL_PATTERN.match(email) or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="邮箱格式不合法")
    return email


def normalize_phone(value: str) -> str:
    raw = (value or "").strip()
    cleaned = re.sub(r"[\s\-\(\)]", "", raw)
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned or not PHONE_PATTERN.match(cleaned):
        raise HTTPException(status_code=400, detail="手机号格式不合法")
    return cleaned


def hash_verify_code(code: str) -> str:
    return hashlib.sha256((str(code).strip() + JWT_SECRET_KEY).encode("utf-8")).hexdigest()


def generate_numeric_code(length: int = 6) -> str:
    length = max(4, min(int(length), 8))
    upper = 10**length
    return str(secrets.randbelow(upper)).zfill(length)


def get_client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def validate_username_or_raise(username: str) -> str:
    cleaned = (username or "").strip()
    if not USERNAME_PATTERN.match(cleaned):
        raise HTTPException(
            status_code=400,
            detail="用户名仅支持字母/数字/._-，长度 3-50",
        )
    return cleaned


def validate_password_or_raise(password: str) -> str:
    raw = password or ""
    if not (PASSWORD_MIN_LENGTH <= len(raw) <= PASSWORD_MAX_LENGTH):
        raise HTTPException(
            status_code=400,
            detail=f"密码长度必须在 {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} 位之间",
        )
    if not re.search(r"[A-Za-z]", raw) or not re.search(r"\d", raw):
        raise HTTPException(status_code=400, detail="密码必须包含字母和数字")
    return password


def _normalize_color_value(value, fallback=None):
    """Return one material color as {name, hex}; accept legacy values once."""
    known_hex = {
        "white": "#ffffff",
        "black": "#000000",
        "gray": "#808080",
        "grey": "#808080",
        "red": "#dc2626",
        "blue": "#2563eb",
        "green": "#16a34a",
        "yellow": "#ca8a04",
        "orange": "#ea580c",
        "purple": "#9333ea",
        "pink": "#db2777",
        "白色": "#ffffff",
        "黑色": "#000000",
        "灰色": "#808080",
        "红色": "#dc2626",
        "蓝色": "#2563eb",
        "绿色": "#16a34a",
        "黄色": "#ca8a04",
        "橙色": "#ea580c",
    }
    if isinstance(value, dict):
        name = str(value.get("name") or value.get("hex") or "").strip()
        hex_value = str(value.get("hex") or "").strip()
    else:
        name = str(value or "").strip()
        hex_value = name if name.startswith("#") else ""
    if not name and fallback is not None:
        return _normalize_color_value(fallback)
    if not hex_value:
        hex_value = known_hex.get(name.lower(), "")
    return {"name": name or "黑色", "hex": hex_value}


def normalize_materials(raw_materials, fallback_colors: Optional[List[str]] = None):
    if not raw_materials:
        return DEFAULT_MATERIALS
    defaults_by_name = {str(m.get("name") or "").strip(): m for m in DEFAULT_MATERIALS if isinstance(m, dict)}
    normalized = []
    for m in raw_materials:
        name = str(m.get("name") or "").strip()
        if not name:
            continue
        default_spec = defaults_by_name.get(name, {})
        density = float(m.get("density") or 0) or 1.0
        if "price_per_kg" in m:
            price_per_kg = float(m.get("price_per_kg") or 0) or 0.0
        else:
            price = float(m.get("price") or 0) or 0.0
            price_per_kg = price * 1000.0
        # The old format stored a palette in `colors`. Keep only its first
        # entry while reading old records, then emit the canonical `color`.
        raw_color = m.get("color")
        if raw_color is None:
            legacy_colors = m.get("colors")
            if isinstance(legacy_colors, list) and legacy_colors:
                raw_color = legacy_colors[0]
        fallback = (fallback_colors or DEFAULT_COLORS or ["黑色"])[0]
        color = _normalize_color_value(raw_color, fallback)
        hotend_temp = m.get("hotend_temp")
        if hotend_temp is None:
            hotend_temp = m.get("hotend_temp_min")
        if hotend_temp is None:
            hotend_temp = default_spec.get("hotend_temp")
        bed_temp = m.get("bed_temp")
        if bed_temp is None:
            bed_temp = m.get("bed_temp_min")
        if bed_temp is None:
            bed_temp = default_spec.get("bed_temp")
        max_volumetric_speed = m.get("max_volumetric_speed")
        if max_volumetric_speed is None:
            max_volumetric_speed = default_spec.get("max_volumetric_speed")
        normalized.append(
            {
                "name": name,
                "brand": _normalize_brand_name(m.get("brand", "Generic")),
                "density": density,
                "price_per_kg": price_per_kg,
                "color": color,
                "hotend_temp": int(float(hotend_temp)) if hotend_temp is not None else None,
                "bed_temp": int(float(bed_temp)) if bed_temp is not None else None,
                "max_volumetric_speed": (
                    float(max_volumetric_speed) if max_volumetric_speed is not None else None
                ),
            }
        )
    return normalized or DEFAULT_MATERIALS


def _normalize_brand_name(value) -> str:
    """Normalize legacy placeholder names without altering real custom brands."""
    brand = str(value or "Generic").strip()
    return "Generic" if brand in {"通用", "??", "?"} else (brand or "Generic")


def mask_email(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        local, domain = str(value).split("@", 1)
    except ValueError:
        return "***"
    if len(local) <= 2:
        masked = local[0] + "***"
    else:
        masked = local[0] + "***" + local[-1]
    return masked + "@" + domain


def mask_phone(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    s = str(value)
    if len(s) <= 4:
        return "***"
    return s[:3] + "****" + s[-4:]
