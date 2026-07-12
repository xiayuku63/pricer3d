"""Quote business services.

This module contains the core logic for single-file quoting and quote history
persistence. It is intentionally decoupled from HTTP request handling.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, UploadFile

from app.config import (
    DEFAULT_MATERIALS,
    DEFAULT_PRICING_CONFIG,
    FREE_TOTAL_MODEL_LIMIT,
    MAX_FILES_PER_REQUEST,
    MEMBER_DISCOUNT_PERCENT,
    QUOTE_CONCURRENCY,
)
from app.db import get_db_session
from app.deps import get_membership_effective, is_member_user
from app.models_orm import QuoteHistory, User
from calculator.cost import FORMULA_ALIAS_TO_CANONICAL, process_single_file

logger = logging.getLogger(__name__)


async def build_quote_payload(
    request,
    files: List[UploadFile],
    material: str,
    layer_height: float,
    infill: int,
    wall_count: int,
    slicer_preset_id: Optional[int],
    quantity: int,
    color: str,
    use_prusaslicer: Optional[bool],
    printer_model: Optional[str],
    auto_orient: Optional[bool],
    orient_x: Optional[float],
    orient_y: Optional[float],
    orient_z: Optional[float],
    current_user: dict,
):
    """Validate inputs, process files, apply membership discount and persist history.

    Returns the dict payload that the route will send back to the client.
    """
    from app.audit import (
        get_idempotency_key_from_request,
        save_idempotent_response,
        try_get_idempotent_response,
        write_audit_event,
    )
    from app.slicer_presets import get_slicer_preset_by_id
    from sqlalchemy import func as sqlfunc

    idem_key = get_idempotency_key_from_request(request)
    if idem_key:
        cached = try_get_idempotent_response(int(current_user["id"]), request, idem_key)
        if cached:
            status_code, payload = cached
            write_audit_event(
                action="quote.replay",
                request=request,
                user=current_user,
                idempotency_key=idem_key,
                detail={"status_code": status_code},
            )
            return payload

    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一个模型文件")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"单次上传文件数量不能超过 {MAX_FILES_PER_REQUEST} 个")

    # 免费用户累计模型总数限制（不限制单次数量）
    if not is_member_user(current_user):
        with get_db_session() as db:
            existing_count = db.query(sqlfunc.count(QuoteHistory.id)).filter(
                QuoteHistory.user_id == current_user["id"],
                QuoteHistory.status == "success",
            ).scalar() or 0
        if existing_count >= FREE_TOTAL_MODEL_LIMIT:
            raise HTTPException(status_code=400, detail=f"免费用户最多累计 {FREE_TOTAL_MODEL_LIMIT} 个模型，升级会员无限制")

    with get_db_session() as db:
        row = db.query(User.materials, User.pricing_config).filter(User.id == current_user["id"]).first()
    user_materials = json.loads(row.materials) if row and row.materials else DEFAULT_MATERIALS
    pricing_config = json.loads(row.pricing_config) if row and row.pricing_config else DEFAULT_PRICING_CONFIG

    if use_prusaslicer is not None:
        pricing_config["use_prusaslicer"] = use_prusaslicer
    if printer_model is not None:
        pricing_config["printer_model"] = printer_model

    material_names = {str(m.get("name")) for m in user_materials if isinstance(m, dict)}
    if material not in material_names:
        raise HTTPException(status_code=400, detail="材料参数不合法")

    selected_material = next((m for m in user_materials if isinstance(m, dict) and str(m.get("name")) == material), None)
    allowed_colors = []
    if selected_material:
        raw_colors = selected_material.get("colors", [])
        if isinstance(raw_colors, list):
            for c in raw_colors:
                if isinstance(c, dict):
                    allowed_colors.append(str(c.get("hex", "")).strip())
                    allowed_colors.append(str(c.get("name", "")).strip())
                else:
                    allowed_colors.append(str(c).strip())
            allowed_colors = [a for a in allowed_colors if a]
    if allowed_colors and color not in allowed_colors:
        raise HTTPException(status_code=400, detail="颜色参数不合法")

    slicer_preset = None
    if slicer_preset_id is not None:
        sid = int(slicer_preset_id)
        if sid > 0:
            slicer_preset = get_slicer_preset_by_id(int(current_user["id"]), sid)
            if slicer_preset is None:
                raise HTTPException(status_code=400, detail="切片预设不存在或无权限")

    _semaphore = asyncio.Semaphore(max(1, QUOTE_CONCURRENCY))

    async def process_one(file):
        async with _semaphore:
            try:
                return await asyncio.to_thread(
                    _process_single_file_sync,
                    file, material, layer_height, infill, quantity, color,
                    user_materials, pricing_config, slicer_preset, wall_count, current_user,
                    auto_orient, orient_x, orient_y, orient_z, applied_orientation,
                )
            except Exception as e:
                fname = file.filename or "unknown"
                logger.error(f"处理文件 {fname} 时发生未捕获的错误: {str(e)}", exc_info=True)
                return {
                    "filename": fname,
                    "status": "failed",
                    "error": f"INTERNAL_ERROR: {str(e)}",
                    "cost_cny": 0, "weight_g": 0, "estimated_time_h": 0,
                }

    tasks = [process_one(f) for f in files]
    results = await asyncio.gather(*tasks)

    success_items = [item for item in results if item.get("status") == "success"]
    failed_items = [item for item in results if item.get("status") == "failed"]

    membership_level, membership_expires_at = get_membership_effective(current_user)
    discount_percent = float(MEMBER_DISCOUNT_PERCENT or 0.0)
    if discount_percent < 0:
        discount_percent = 0.0
    if discount_percent > 90:
        discount_percent = 90.0
    if membership_level == "member" and discount_percent > 0 and success_items:
        for item in success_items:
            try:
                original = float(item.get("cost_cny") or 0.0)
            except Exception:
                original = 0.0
            discounted = round(original * (1.0 - (discount_percent / 100.0)), 2)
            item["cost_cny_original"] = round(original, 2)
            item["cost_cny"] = discounted
            breakdown = item.get("cost_breakdown")
            if isinstance(breakdown, dict):
                breakdown["member_discount_percent"] = round(discount_percent, 2)
                breakdown["member_discount_cny"] = round(max(0.0, original - discounted), 2)

    payload = {
        "total_files": len(results),
        "success_count": len(success_items),
        "failed_count": len(failed_items),
        "summary_total_cost_cny": round(sum(item.get("cost_cny", 0) for item in success_items), 2),
        "summary_total_weight_g": round(sum(item.get("weight_g", 0) for item in success_items), 2),
        "summary_total_time_h": round(sum(item.get("estimated_time_h", 0) for item in success_items), 2),
        "results": results,
        "membership_level": membership_level,
        "membership_expires_at": membership_expires_at,
        "member_discount_percent": round(discount_percent, 2) if membership_level == "member" else 0.0,
    }
    write_audit_event(
        action="quote.create",
        request=request,
        user=current_user,
        idempotency_key=idem_key,
        detail={
            "files": len(results),
            "success": len(success_items),
            "failed": len(failed_items),
            "material": material,
            "quantity": quantity,
        },
    )
    if idem_key:
        save_idempotent_response(int(current_user["id"]), request, idem_key, 200, payload)
    save_quote_history(int(current_user["id"]), results)
    return payload


def _process_single_file_sync(
    file: UploadFile,
    material: str,
    layer_height: float,
    infill: int,
    quantity: int,
    color: str,
    user_materials: List[dict],
    pricing_config: dict,
    slicer_preset: Optional[dict] = None,
    perimeters: Optional[int] = None,
    current_user: Optional[dict] = None,
    auto_orient: bool = False,
    orient_x: Optional[float] = None,
    orient_y: Optional[float] = None,
    orient_z: Optional[float] = None,
    applied_orientation: Optional[dict] = None,
):
    """Synchronous wrapper for process_single_file — runs in thread pool.

    Resolves printer data from the app layer and passes it to the
    calculator layer (keeping calculator free of ``from app`` imports).
    """
    # Build printer bed resolver + speed params from app layer
    printer_model_id = pricing_config.get("printer_model") if pricing_config else None
    printer_bed_resolver = None
    speed_params_override = None
    printer_profile_path = None
    if printer_model_id:
        try:
            from app.printers import resolve_printer, PRINTER_MODELS
            pm = resolve_printer(str(printer_model_id))
            if pm:
                printer_bed_resolver = {printer_model_id: pm}
                printer_profile_path = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    pm["profile"],
                ) if pm.get("profile") else None

            # Look up DB speed params
            _base_printer_id = pm["id"] if pm else str(printer_model_id)
            from app.db import get_db_session
            from app.models_orm import PrinterParam
            with get_db_session() as _db:
                pp = _db.query(PrinterParam).filter(
                    PrinterParam.printer_id == _base_printer_id
                ).first()
                if pp and pp.speed_enabled:
                    speed_params_override = {
                        "max_speed": float(pp.max_speed or 500),
                        "max_acceleration": float(pp.max_acceleration or 10000),
                        "jerk_limit": float(pp.jerk_limit or 0.04),
                    }
        except Exception:
            logger.warning(f"Failed to resolve printer {printer_model_id} for dimension check")

    return asyncio.run(
        process_single_file(
            file, material, layer_height, infill, quantity, color,
            user_materials, pricing_config, slicer_preset, perimeters, current_user,
            auto_orient, orient_x, orient_y, orient_z, applied_orientation,
            printer_bed_resolver=printer_bed_resolver,
            speed_params_override=speed_params_override,
            printer_profile_path=printer_profile_path,
        )
    )


def save_quote_history(user_id: int, results: list) -> None:
    """Save quote results to history table."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_session() as db:
        for item in results:
            raw_pm = item.get("_printer_model") or item.get("printer_model") or ""
            slicer_preset_id = item.get("_slicer_preset_id") or item.get("slicer_preset_id")

            breakdown = item.get("cost_breakdown")
            gcode_summary = (breakdown or {}).get("gcode_summary") or {}
            core_params = gcode_summary.get("core_params") or {}

            nozzle_diameter = None
            if core_params.get("nozzle_diameter") is not None:
                try:
                    nozzle_diameter = float(core_params["nozzle_diameter"])
                except (ValueError, TypeError):
                    pass

            m = re.match(r'^(.+?)_(\d{2})$', raw_pm) if raw_pm else None
            if m:
                printer_model = m.group(1)
                try:
                    from app.printers import PRINTER_MODELS
                    for pm_def in PRINTER_MODELS:
                        if pm_def["id"] == printer_model:
                            printer_model = pm_def["name"]
                            break
                except Exception:
                    pass
                if nozzle_diameter is None:
                    nozzle_diameter = float(m.group(2)) / 10.0
            else:
                printer_model = raw_pm or None
                if printer_model:
                    try:
                        from app.printers import PRINTER_MODELS, resolve_printer
                        rp = resolve_printer(printer_model)
                        if rp:
                            printer_model = rp.get("name", printer_model)
                    except Exception:
                        pass

            layer_height_val = item.get("layer_height")
            try:
                layer_height_val = float(layer_height_val) if layer_height_val is not None else None
            except (ValueError, TypeError):
                layer_height_val = None

            wall_count = None
            if core_params.get("perimeters") is not None:
                try:
                    wall_count = int(core_params["perimeters"])
                except (ValueError, TypeError):
                    pass

            infill_val = None
            raw_fill = core_params.get("fill_density")
            if raw_fill is not None:
                try:
                    infill_val = int(float(str(raw_fill).replace("%", "")))
                except (ValueError, TypeError):
                    pass

            brand = item.get("brand") or ""
            cost_breakdown_str = json.dumps(breakdown) if isinstance(breakdown, dict) else None

            entry = QuoteHistory(
                user_id=user_id,
                filename=str(item.get("filename") or "")[:200],
                material=str(item.get("material") or "")[:40],
                color=str(item.get("color") or "")[:40],
                quantity=int(item.get("quantity") or 1),
                volume_cm3=round(float(item.get("volume_cm3") or 0), 2),
                weight_g=round(float(item.get("weight_g") or 0), 2),
                estimated_time_h=round(float(item.get("estimated_time_h") or 0), 2),
                cost_cny=round(float(item.get("cost_cny") or 0), 2),
                dimensions=str(item.get("dimensions") or "")[:80],
                status=str(item.get("status") or "success")[:20],
                error_msg=str(item.get("error") or "")[:300] if item.get("status") != "success" else None,
                created_at=now,
                printer_model=str(printer_model)[:50] if printer_model else None,
                slicer_preset_id=int(slicer_preset_id) if slicer_preset_id is not None else None,
                nozzle_diameter=round(float(nozzle_diameter), 2) if nozzle_diameter is not None else None,
                layer_height=round(float(layer_height_val), 2) if layer_height_val is not None else None,
                wall_count=wall_count,
                infill=infill_val,
                brand=str(brand)[:40] if brand else None,
                cost_breakdown=cost_breakdown_str,
            )
            db.add(entry)
