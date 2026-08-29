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
from app.quote_batch import batch_cancelled
from calculator.cost import process_single_file
from app.material_resolver import merge_user_material_with_catalog

logger = logging.getLogger(__name__)


def _load_user_quote_settings(user_id: int) -> tuple[list, dict, Optional[str], Optional[str], Optional[int]]:
    """Load user materials, pricing config, and slicing defaults."""
    with get_db_session() as db:
        row = (
            db.query(
                User.materials,
                User.pricing_config,
                User.default_printer_id,
                User.default_nozzle,
                User.default_slicer_preset_id,
            )
            .filter(User.id == user_id)
            .first()
        )

    user_materials = json.loads(row.materials) if row and row.materials else DEFAULT_MATERIALS
    pricing_config = json.loads(row.pricing_config) if row and row.pricing_config else DEFAULT_PRICING_CONFIG
    default_printer_id = row.default_printer_id if row else None
    default_nozzle = row.default_nozzle if row else None
    default_slicer_preset_id = row.default_slicer_preset_id if row else None
    return user_materials, pricing_config, default_printer_id, default_nozzle, default_slicer_preset_id


def _extract_preset_core_params(preset: Optional[dict]) -> dict:
    """Read explicitly configured core print values from a user preset.

    The model-page form historically sent its fallback values (0.2 / 3 / 20)
    even when a different preset was selected. Core values explicitly present
    in that preset must therefore be authoritative before slicing starts.
    Missing keys are left untouched so an arbitrary uploaded preset that only
    changes secondary settings does not unexpectedly reset the form values.
    """
    if not isinstance(preset, dict):
        return {}
    raw = preset.get("content")
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", errors="replace")
    elif isinstance(raw, str):
        text = raw
    else:
        return {}

    values: dict = {}
    aliases = {
        "layer_height": "layer_height",
        "perimeters": "perimeters",
        "wall_loops": "perimeters",
        "fill_density": "infill",
        "sparse_infill_density": "infill",
    }
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith((";", "#", "[")) or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        target = aliases.get(key)
        if not target:
            continue
        value = value.rstrip("%").strip()
        try:
            if target == "layer_height":
                parsed = float(value)
                if 0.05 <= parsed <= 1.0:
                    values[target] = parsed
            elif target == "perimeters":
                parsed = int(float(value))
                if 1 <= parsed <= 20:
                    values[target] = parsed
            elif target == "infill":
                parsed = int(float(value))
                if 0 <= parsed <= 100:
                    values[target] = parsed
        except (TypeError, ValueError):
            continue
    return values


def _resolve_effective_slicer_params(
    layer_height: float,
    wall_count: int,
    infill: int,
    slicer_preset: Optional[dict],
) -> tuple[float, int, int]:
    """Resolve core slicer params with preset values taking precedence."""
    preset_params = _extract_preset_core_params(slicer_preset)
    return (
        preset_params.get("layer_height", float(layer_height or 0.2)),
        preset_params.get("perimeters", int(wall_count or 3)),
        preset_params.get("infill", int(infill or 20)),
    )


def _resolve_effective_slicer_preset(user_id: int, slicer_preset_id: Optional[int], default_slicer_preset_id: Optional[int]):
    """Resolve the active user slicer preset from request value or user defaults."""
    from app.slicer_presets import get_slicer_preset_by_id

    effective_preset_id = slicer_preset_id if slicer_preset_id is not None else default_slicer_preset_id
    if effective_preset_id is None:
        return None, None

    sid = int(effective_preset_id)
    if sid <= 0:
        return sid, None

    slicer_preset = get_slicer_preset_by_id(int(user_id), sid)
    if slicer_preset is None:
        raise HTTPException(status_code=400, detail="切片预设不存在或无权限")
    return sid, slicer_preset


def _resolve_effective_printer_model(printer_model: Optional[str], default_printer_id: Optional[str], default_nozzle: Optional[str]) -> Optional[str]:
    """Resolve the effective printer compound id from request value or user defaults."""
    from app.printers import resolve_printer

    if printer_model:
        resolved = resolve_printer(str(printer_model))
        return (resolved.get("_compound_id") or str(printer_model)) if resolved else str(printer_model)

    if default_printer_id:
        nozzle = None
        if default_nozzle not in (None, ""):
            try:
                nozzle = float(default_nozzle)
            except (TypeError, ValueError):
                nozzle = None
        resolved = resolve_printer(str(default_printer_id), nozzle)
        return (resolved.get("_compound_id") or str(default_printer_id)) if resolved else str(default_printer_id)

    return None


async def build_quote_payload(
    request,
    files: List[UploadFile],
    material: str,
    brand: Optional[str],
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
    entity_colors_json: Optional[str],
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

    entity_colors: dict[str, object] = {}
    if entity_colors_json:
        try:
            parsed_colors = json.loads(entity_colors_json)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="多色实体配置格式不正确") from exc
        if not isinstance(parsed_colors, dict) or len(parsed_colors) > 100:
            raise HTTPException(status_code=400, detail="多色实体配置格式不正确")
        entity_colors = parsed_colors

    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一个模型文件")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"单次上传文件数量不能超过 {MAX_FILES_PER_REQUEST} 个")

    # 免费用户累计模型总数限制（不限制单次数量）
    if not is_member_user(current_user):
        with get_db_session() as db:
            existing_count = (
                db.query(sqlfunc.count(QuoteHistory.id))
                .filter(
                    QuoteHistory.user_id == current_user["id"],
                    QuoteHistory.status == "success",
                )
                .scalar()
                or 0
            )
        if existing_count >= FREE_TOTAL_MODEL_LIMIT:
            raise HTTPException(
                status_code=400, detail=f"免费用户最多累计 {FREE_TOTAL_MODEL_LIMIT} 个模型，升级会员无限制"
            )

    (
        user_materials,
        pricing_config,
        default_printer_id,
        default_nozzle,
        default_slicer_preset_id,
    ) = _load_user_quote_settings(int(current_user["id"]))

    if use_prusaslicer is not None:
        pricing_config["use_prusaslicer"] = use_prusaslicer
    effective_printer_model = _resolve_effective_printer_model(printer_model, default_printer_id, default_nozzle)
    if effective_printer_model is not None:
        pricing_config["printer_model"] = effective_printer_model

    material_names = {str(m.get("name")) for m in user_materials if isinstance(m, dict)}
    if material not in material_names:
        raise HTTPException(status_code=400, detail="材料参数不合法")

    requested_brand = str(brand or "").strip()
    material_candidates = [
        m
        for m in user_materials
        if isinstance(m, dict)
        and str(m.get("name")) == material
        and (not requested_brand or str(m.get("brand") or "Generic").strip() == requested_brand)
    ]
    # Color is a preview-only concern. It should not block quoting or change
    # which material spec drives slicing speed/time.
    selected_material = material_candidates[0] if material_candidates else None
    selected_material = merge_user_material_with_catalog(selected_material, material, requested_brand, color)
    if requested_brand and selected_material is None:
        raise HTTPException(status_code=400, detail="材料品牌参数不合法")
    effective_brand = str(selected_material.get("brand") or "Generic").strip() if selected_material else requested_brand
    materials_for_quote = (
        [selected_material] + [m for m in user_materials if m is not selected_material]
        if selected_material
        else user_materials
    )
    effective_preset_id, slicer_preset = _resolve_effective_slicer_preset(
        int(current_user["id"]),
        slicer_preset_id,
        default_slicer_preset_id,
    )

    # A selected preset is the source of truth for its explicitly stored core
    # values. This protects the real slice from stale frontend fallback values
    # such as 0.20 / 3 / 20 when the page shows a 0.40 / 2 / 15% preset.
    layer_height, wall_count, infill = _resolve_effective_slicer_params(
        layer_height,
        wall_count,
        infill,
        slicer_preset,
    )
    if slicer_preset:
        logger.info(
            "Effective slicer preset params: preset_id=%s name=%s layer_height=%s perimeters=%s infill=%s",
            effective_preset_id,
            slicer_preset.get("name") if slicer_preset else None,
            layer_height,
            wall_count,
            infill,
        )

    _semaphore = asyncio.Semaphore(max(1, QUOTE_CONCURRENCY))

    batch_id = (request.headers.get("x-quote-batch-id") or "").strip() if request is not None else ""
    if batch_id:
        from app.quote_batch import register_batch
        register_batch(batch_id, int(current_user["id"]))

    async def process_one(file):
        async with _semaphore:
            if batch_id:
                from parser.prusa_slicer import set_slice_batch

                set_slice_batch(batch_id)
            # Stopped via the stop button / replaced by a newer batch (batch
            # flag) or disconnected? Skip this file and everything queued
            # behind it. In-flight slices are hard-killed by cancel_batch();
            # abandoned work must not start and must not reach history.
            batch_stopped = bool(batch_id) and batch_cancelled(batch_id, int(current_user["id"]))
            disconnected = False
            if not batch_stopped and request is not None:
                disconnected = await request.is_disconnected()
            if batch_stopped or disconnected:
                return {
                    "filename": file.filename or "unknown",
                    "status": "cancelled",
                    "error": "客户端已断开，报价已取消",
                    "cost_cny": 0,
                    "weight_g": 0,
                    "estimated_time_h": 0,
                }
            try:
                result = await asyncio.to_thread(
                    _process_single_file_sync,
                    file,
                    material,
                    layer_height,
                    infill,
                    quantity,
                    color,
                    materials_for_quote,
                    pricing_config,
                    slicer_preset,
                    wall_count,
                    current_user,
                    auto_orient,
                    orient_x,
                    orient_y,
                    orient_z,
                    selected_material,
                    entity_colors,
                )
                if isinstance(result, dict) and effective_brand:
                    result["brand"] = effective_brand
                # The slice may have been hard-killed mid-flight by a batch
                # cancel (stop button / replacing recalc). Never let a
                # killed-or-queued file's result — including the geometric
                # estimation fallback — count as success or reach history.
                if batch_id and batch_cancelled(batch_id, int(current_user["id"])):
                    return {
                        "filename": file.filename or "unknown",
                        "status": "cancelled",
                        "error": "客户端已断开，报价已取消",
                        "cost_cny": 0,
                        "weight_g": 0,
                        "estimated_time_h": 0,
                    }
                return result
            except Exception as e:
                fname = file.filename or "unknown"
                logger.error(f"处理文件 {fname} 时发生未捕获的错误: {str(e)}", exc_info=True)
                return {
                    "filename": fname,
                    "status": "failed",
                    "error": f"INTERNAL_ERROR: {str(e)}",
                    "cost_cny": 0,
                    "weight_g": 0,
                    "estimated_time_h": 0,
                }

    tasks = [process_one(f) for f in files]
    try:
        results = await asyncio.gather(*tasks)
    finally:
        if batch_id:
            from app.quote_batch import release_batch
            release_batch(batch_id)

    # Surface the smart-placement result on the item itself. The quote
    # checkbox and /api/orientation/auto-learned share
    # get_smart_orientation_for_slicing; exposing the same fields here lets
    # the frontend re-render thumbnails in the placed pose
    # (getResultOrientation reads top-level euler_angles_deg).
    for item in results:
        breakdown = item.get("cost_breakdown")
        if not isinstance(breakdown, dict):
            continue
        for key in ("euler_angles_deg", "rotation_matrix", "auto_orient_score", "selected_face_area"):
            if item.get(key) is None and breakdown.get(key) is not None:
                item[key] = breakdown[key]
        # Let the client ask the server to clean this file's artifacts when
        # the row is deleted (POST /api/quote/artifacts/delete).
        if item.get("saved_path") is None and item.get("_saved_path"):
            item["saved_path"] = item["_saved_path"]

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
    selected_material_spec: Optional[dict] = None,
    entity_colors: Optional[dict[str, object]] = None,
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
            from app.printers import resolve_printer

            pm = resolve_printer(str(printer_model_id))
            if pm:
                printer_bed_resolver = {printer_model_id: pm}
                printer_profile_path = (
                    os.path.join(
                        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                        pm["profile"],
                    )
                    if pm.get("profile")
                    else None
                )

            # Look up DB speed params
            _base_printer_id = pm["id"] if pm else str(printer_model_id)
            from app.db import get_db_session
            from app.models_orm import PrinterParam

            with get_db_session() as _db:
                pp = _db.query(PrinterParam).filter(PrinterParam.printer_id == _base_printer_id).first()
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
            file,
            material,
            layer_height,
            infill,
            quantity,
            color,
            user_materials,
            pricing_config,
            slicer_preset,
            perimeters,
            current_user,
            auto_orient,
            orient_x,
            orient_y,
            orient_z,
            selected_material_spec=selected_material_spec,
            entity_colors=entity_colors,
            printer_bed_resolver=printer_bed_resolver,
            speed_params_override=speed_params_override,
            printer_profile_path=printer_profile_path,
        )
    )


def save_quote_history(user_id: int, results: list) -> None:
    """Save quote results to history table. Cancelled items are skipped —
    work abandoned by a client disconnect is not a quote the user ever saw."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_session() as db:
        for item in results:
            if item.get("status") == "cancelled":
                continue
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

            m = re.match(r"^(.+?)_(\d{2})$", raw_pm) if raw_pm else None
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
                slicer_fallback=int(bool((breakdown or {}).get("slicer_fallback"))) if breakdown else 0,
                slicer_error=(breakdown or {}).get("slicer_error") if breakdown else None,
                slicer_estimated_time_s=float((breakdown or {}).get("slicer_estimated_time_s", 0) or 0)
                if (breakdown or {}).get("slicer_estimated_time_s")
                else None,
            )
            db.add(entry)
