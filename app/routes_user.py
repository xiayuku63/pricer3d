"""User settings routes."""

import json
import logging
import os
import uuid
from typing import List, Optional

from fastapi import Request, Depends, HTTPException
from pydantic import BaseModel, Field

from .config import DEFAULT_MATERIALS, DEFAULT_COLORS, DEFAULT_PRICING_CONFIG
from .db import get_db_session
from .models_orm import User
from .deps import get_current_user, is_member_user
from .utils import normalize_materials
from .audit import write_audit_event
from .database import merge_pricing_config
from calculator.cost import validate_formula_expression

logger = logging.getLogger(__name__)


class ColorItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    hex: str = Field(default="", max_length=7)


class MaterialItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    brand: Optional[str] = Field(default="Generic", max_length=40)
    density: float = Field(..., gt=0, le=10)
    price_per_kg: float = Field(..., ge=0, le=100000)
    colors: List = Field(default_factory=list, max_length=30)  # List[ColorItem|str]


class PricingConfig(BaseModel):
    machine_hourly_rate_cny: float = 15.0
    setup_fee_cny: float = 0.0
    min_job_fee_cny: float = 0.0
    material_waste_percent: float = 5.0
    support_percent_of_model: float = 0.0
    post_process_fee_per_part_cny: float = 0.0
    use_prusaslicer: int = 0
    prusaslicer_support_mode: str = "on"
    support_price_per_g: float = 0.0
    time_overhead_min: float = 5.0
    time_vol_min_per_cm3: float = 0.8
    time_area_min_per_cm2: float = 0.0
    time_ref_layer_height_mm: float = 0.2
    time_layer_height_exponent: float = 1.0
    time_ref_infill_percent: float = 20.0
    time_infill_coefficient: float = 1.0
    unit_cost_formula: str = ""
    total_cost_formula: str = ""


class UserSettingsUpdate(BaseModel):
    materials: List[MaterialItem] = Field(..., min_length=1, max_length=100)
    colors: Optional[List[str]] = Field(default=None, max_length=100)
    pricing_config: Optional[PricingConfig] = None
    default_printer_id: Optional[str] = None
    default_nozzle: Optional[str] = None
    default_slicer_preset_id: Optional[int] = None
    default_material: Optional[str] = None
    default_color: Optional[str] = None
    default_brand: Optional[str] = None


async def get_user_settings(current_user=Depends(get_current_user)):
    try:
        with get_db_session() as db:
            row = db.query(User).filter(User.id == current_user["id"]).first()

            if not row:
                raise HTTPException(status_code=404, detail="USER_NOT_FOUND: 用户不存在")

            raw_materials = json.loads(row.materials) if row and row.materials else DEFAULT_MATERIALS
            colors = json.loads(row.colors) if row and row.colors else DEFAULT_COLORS
            raw_pricing = json.loads(row.pricing_config) if row and row.pricing_config else DEFAULT_PRICING_CONFIG
            default_printer_id = row.default_printer_id or None
            default_nozzle = row.default_nozzle or None
            default_slicer_preset_id = (
                int(row.default_slicer_preset_id) if row.default_slicer_preset_id is not None else None
            )
            default_material = row.default_material or None
            default_color = row.default_color or None
            default_brand = row.default_brand or None

        materials = normalize_materials(raw_materials, fallback_colors=colors)
        pricing_config = merge_pricing_config(raw_pricing)
        derived_colors = []
        for m in materials:
            for c in m.get("colors", []):
                if c not in derived_colors:
                    derived_colors.append(c)
        return {
            "materials": materials,
            "colors": derived_colors,
            "pricing_config": pricing_config,
            "default_printer_id": default_printer_id,
            "default_nozzle": default_nozzle,
            "default_slicer_preset_id": default_slicer_preset_id,
            "default_material": default_material,
            "default_color": default_color,
            "default_brand": default_brand,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取用户配置失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"INTERNAL_ERROR: 获取用户配置失败 ({str(e)})")


async def update_user_settings(payload: UserSettingsUpdate, request: Request, current_user=Depends(get_current_user)):
    seen_material_names = set()
    for item in payload.materials:
        normalized_name = item.name.strip()
        if not normalized_name:
            raise HTTPException(status_code=400, detail="材料名称不能为空")
        name_key = normalized_name.lower()
        if name_key in seen_material_names:
            raise HTTPException(status_code=400, detail=f"材料名称重复：{normalized_name}")
        seen_material_names.add(name_key)

    materials_json = json.dumps([m.model_dump() for m in payload.materials])
    if payload.colors is not None:
        derived_colors = payload.colors
    else:
        derived_colors = []
        for m in payload.materials:
            for c in m.colors:
                if c not in derived_colors:
                    derived_colors.append(c)
    colors_json = json.dumps(derived_colors)
    pricing_json = None
    if payload.pricing_config is not None:
        unit_ok, unit_err, _ = validate_formula_expression(payload.pricing_config.unit_cost_formula)
        total_ok, total_err, _ = validate_formula_expression(payload.pricing_config.total_cost_formula)
        if not unit_ok or not total_ok:
            messages = []
            if not unit_ok:
                messages.append(f"单件公式：{unit_err or '无效'}")
            if not total_ok:
                messages.append(f"总价公式：{total_err or '无效'}")
            raise HTTPException(status_code=400, detail="；".join(messages) or "公式无效")
        pricing_json = json.dumps(payload.pricing_config.model_dump())
    with get_db_session() as db:
        user = db.query(User).filter(User.id == current_user["id"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        user.materials = materials_json
        user.colors = colors_json
        if pricing_json is not None:
            user.pricing_config = pricing_json
        user.default_printer_id = payload.default_printer_id
        user.default_nozzle = payload.default_nozzle
        user.default_slicer_preset_id = payload.default_slicer_preset_id
        user.default_material = payload.default_material
        user.default_color = payload.default_color
        user.default_brand = payload.default_brand
    write_audit_event(
        action="user.settings.update",
        request=request,
        user=current_user,
        detail={"materials_count": len(payload.materials), "has_pricing_config": payload.pricing_config is not None},
    )
    return {"status": "success"}


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=100)
    new_password: str = Field(..., min_length=6, max_length=100)
    captcha_id: Optional[str] = Field(default=None, max_length=80)
    captcha_code: Optional[str] = Field(default=None, max_length=10)


async def change_password(req: ChangePasswordRequest, request: Request, current_user=Depends(get_current_user)):
    from .auth import verify_password, get_password_hash, get_user_by_id
    from .utils import validate_password_or_raise

    # 验证码为可选：仅在前端提供了 captcha_id+captcha_code 时才校验
    if req.captcha_id and req.captcha_code:
        from .captcha import verify_captcha_or_raise

        verify_captcha_or_raise(req.captcha_id, req.captcha_code)
    new_password = validate_password_or_raise(req.new_password)

    full_user = get_user_by_id(int(current_user["id"]))
    if not full_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # Need the full user record with password_hash
    with get_db_session() as db:
        full_row = db.query(User.password_hash).filter(User.id == current_user["id"]).first()
    if not full_row:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not verify_password(req.old_password, full_row.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")

    new_hash = get_password_hash(new_password)
    with get_db_session() as db:
        user = db.query(User).filter(User.id == current_user["id"]).first()
        if user:
            user.password_hash = new_hash

    write_audit_event(action="user.change_password", request=request, user=current_user)
    return {"status": "ok"}


# ── Export settings ──
async def export_user_settings(current_user=Depends(get_current_user)):
    """Export all user settings as a JSON file for backup."""
    try:
        with get_db_session() as db:
            row = db.query(User).filter(User.id == current_user["id"]).first()
            if not row:
                raise HTTPException(status_code=404, detail="用户不存在")

            raw_materials = json.loads(row.materials) if row.materials else DEFAULT_MATERIALS
            colors = json.loads(row.colors) if row.colors else DEFAULT_COLORS
            raw_pricing = json.loads(row.pricing_config) if row.pricing_config else DEFAULT_PRICING_CONFIG

        materials = normalize_materials(raw_materials, fallback_colors=colors)
        pricing_config = merge_pricing_config(raw_pricing)

        export_data = {
            "version": 1,
            "exported_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            "materials": materials,
            "colors": colors,
            "pricing_config": pricing_config,
            "default_printer_id": row.default_printer_id,
            "default_nozzle": row.default_nozzle,
            "default_slicer_preset_id": row.default_slicer_preset_id,
        }
        return export_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出用户配置失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


class ImportSettingsRequest(BaseModel):
    materials: Optional[List[MaterialItem]] = None
    colors: Optional[List[str]] = None
    pricing_config: Optional[PricingConfig] = None
    default_printer_id: Optional[str] = None
    default_nozzle: Optional[str] = None
    default_slicer_preset_id: Optional[int] = None


async def import_user_settings(
    payload: ImportSettingsRequest, request: Request, current_user=Depends(get_current_user)
):
    """Import user settings from a previously exported JSON."""
    try:
        with get_db_session() as db:
            user = db.query(User).filter(User.id == current_user["id"]).first()
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")

            if payload.materials is not None:
                if len(payload.materials) < 1:
                    raise HTTPException(status_code=400, detail="至少需要一个材料")
                materials_json = json.dumps([m.model_dump() for m in payload.materials])
                user.materials = materials_json

                if payload.colors is not None:
                    user.colors = json.dumps(payload.colors)
                else:
                    derived = []
                    for m in payload.materials:
                        for c in m.colors:
                            if c not in derived:
                                derived.append(c)
                    user.colors = json.dumps(derived)

            if payload.pricing_config is not None:
                unit_ok, unit_err, _ = validate_formula_expression(payload.pricing_config.unit_cost_formula)
                total_ok, total_err, _ = validate_formula_expression(payload.pricing_config.total_cost_formula)
                if not unit_ok or not total_ok:
                    messages = []
                    if not unit_ok:
                        messages.append(f"单件公式：{unit_err or '无效'}")
                    if not total_ok:
                        messages.append(f"总价公式：{total_err or '无效'}")
                    raise HTTPException(status_code=400, detail="；".join(messages) or "公式无效")
                user.pricing_config = json.dumps(payload.pricing_config.model_dump())

            if payload.default_printer_id is not None:
                user.default_printer_id = payload.default_printer_id
            if payload.default_nozzle is not None:
                user.default_nozzle = payload.default_nozzle
            if payload.default_slicer_preset_id is not None:
                user.default_slicer_preset_id = payload.default_slicer_preset_id

        write_audit_event(
            action="user.settings.import",
            request=request,
            user=current_user,
            detail={"has_materials": payload.materials is not None, "has_pricing": payload.pricing_config is not None},
        )
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导入用户配置失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


# ── Reset section to defaults ──
class ResetSectionRequest(BaseModel):
    section: str = Field(..., pattern="^(materials|pricing|printer|slicer|all)$")


async def reset_user_section(payload: ResetSectionRequest, request: Request, current_user=Depends(get_current_user)):
    """Reset one or all sections of user settings to system defaults."""
    try:
        with get_db_session() as db:
            user = db.query(User).filter(User.id == current_user["id"]).first()
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")

            section = payload.section
            if section in ("materials", "all"):
                user.materials = json.dumps(DEFAULT_MATERIALS)
                user.colors = json.dumps(DEFAULT_COLORS)
            if section in ("pricing", "all"):
                user.pricing_config = json.dumps(DEFAULT_PRICING_CONFIG)
            if section in ("printer", "all"):
                user.default_printer_id = None
                user.default_nozzle = None
            if section in ("slicer", "all"):
                user.default_slicer_preset_id = None

        write_audit_event(
            action="user.settings.reset",
            request=request,
            user=current_user,
            detail={"section": section},
        )
        return {"status": "success", "section": section}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"重置用户配置失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"重置失败: {str(e)}")


# ── 品牌定制 ──


class BrandSettingsResponse(BaseModel):
    brand_name: Optional[str] = None
    brand_logo_url: Optional[str] = None
    brand_phone: Optional[str] = None
    brand_contact_email: Optional[str] = None
    brand_address: Optional[str] = None
    brand_note: Optional[str] = None


class BrandSettingsUpdate(BaseModel):
    brand_name: Optional[str] = Field(default=None, max_length=100)
    brand_logo_url: Optional[str] = Field(default=None, max_length=500)
    brand_phone: Optional[str] = Field(default=None, max_length=20)
    brand_contact_email: Optional[str] = Field(default=None, max_length=200)
    brand_address: Optional[str] = Field(default=None, max_length=300)
    brand_note: Optional[str] = Field(default=None, max_length=1000)


async def get_brand_settings(current_user=Depends(get_current_user)):
    """获取当前用户的品牌定制设置"""
    try:
        with get_db_session() as db:
            row = db.query(User).filter(User.id == current_user["id"]).first()
            if not row:
                raise HTTPException(status_code=404, detail="用户不存在")
            return {
                "brand_name": row.brand_name or "",
                "brand_logo_url": row.brand_logo_url or "",
                "brand_phone": row.brand_phone or "",
                "brand_contact_email": row.brand_contact_email or "",
                "brand_address": row.brand_address or "",
                "brand_note": row.brand_note or "",
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取品牌设置失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取品牌设置失败 ({str(e)})")


async def update_brand_settings(payload: BrandSettingsUpdate, request: Request, current_user=Depends(get_current_user)):
    """更新品牌定制设置（仅会员可用）"""
    if not is_member_user(current_user):
        raise HTTPException(status_code=403, detail="品牌定制功能仅限会员使用，请先升级会员")
    try:
        with get_db_session() as db:
            user = db.query(User).filter(User.id == current_user["id"]).first()
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")
            if payload.brand_name is not None:
                user.brand_name = payload.brand_name
            if payload.brand_logo_url is not None:
                user.brand_logo_url = payload.brand_logo_url
            if payload.brand_phone is not None:
                user.brand_phone = payload.brand_phone
            if payload.brand_contact_email is not None:
                user.brand_contact_email = payload.brand_contact_email
            if payload.brand_address is not None:
                user.brand_address = payload.brand_address
            if payload.brand_note is not None:
                user.brand_note = payload.brand_note
        write_audit_event(
            action="user.brand.update",
            request=request,
            user=current_user,
            detail={"fields_updated": [k for k, v in payload.model_dump(exclude_none=True).items()]},
        )
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新品牌设置失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"更新品牌设置失败 ({str(e)})")


# 允许的 Logo 图片类型
_ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/svg+xml"}
_MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024  # 2MB


async def upload_brand_logo(request: Request, current_user=Depends(get_current_user)):
    """上传品牌 Logo 图片（仅会员可用）"""
    if not is_member_user(current_user):
        raise HTTPException(status_code=403, detail="品牌定制功能仅限会员使用，请先升级会员")

    # 从 request 中获取上传文件
    form = await request.form()
    file = form.get("file")
    if not file or not hasattr(file, "filename") or not file.filename:
        raise HTTPException(status_code=400, detail="请上传 Logo 图片文件")

    # 校验文件类型
    content_type = getattr(file, "content_type", "") or ""
    if content_type not in _ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 PNG、JPEG、SVG 格式的图片")

    # 读取文件内容并校验大小
    content = await file.read()
    if len(content) > _MAX_LOGO_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Logo 文件大小不能超过 2MB")

    # 生成唯一文件名：user_{id}_{uuid}.{ext}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".svg"):
        ext = ".png"
    unique_name = f"user_{current_user['id']}_{uuid.uuid4().hex[:8]}{ext}"

    # 保存到 static/uploads/logos/
    logos_dir = os.path.join("static", "uploads", "logos")
    os.makedirs(logos_dir, exist_ok=True)
    file_path = os.path.join(logos_dir, unique_name)
    with open(file_path, "wb") as f:
        f.write(content)

    url = f"/static/uploads/logos/{unique_name}"

    # 更新用户的 brand_logo_url
    with get_db_session() as db:
        user = db.query(User).filter(User.id == current_user["id"]).first()
        if user:
            user.brand_logo_url = url

    write_audit_event(
        action="user.brand.logo_upload",
        request=request,
        user=current_user,
        detail={"filename": unique_name, "size": len(content)},
    )
    return {"url": url}


async def delete_brand_logo(request: Request, current_user=Depends(get_current_user)):
    """删除品牌 Logo（仅会员可用）"""
    if not is_member_user(current_user):
        raise HTTPException(status_code=403, detail="品牌定制功能仅限会员使用，请先升级会员")
    try:
        with get_db_session() as db:
            user = db.query(User).filter(User.id == current_user["id"]).first()
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")
            user.brand_logo_url = ""
        write_audit_event(
            action="user.brand.logo_delete",
            request=request,
            user=current_user,
        )
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除品牌Logo失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除Logo失败 ({str(e)})")
