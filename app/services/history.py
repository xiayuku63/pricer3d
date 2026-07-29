"""Quote history read/delete/clear services."""

import json
import logging
import os
import re
import shutil

from fastapi import Depends, HTTPException, Request

from app.audit import write_audit_event
from app.db import get_db_session
from app.deps import get_current_user, is_member_user
from app.models_orm import QuoteHistory

logger = logging.getLogger(__name__)


def _quote_artifact_directories(current_user: dict) -> list[tuple[str, str]]:
    """Return (allowed parent, target) pairs for current-user quote artifacts.

    Quote files have existed in two layouts over the lifetime of the app:
    direct quotes under ``data/uploads/<user>`` (G-code is stored beside the
    normalized model), and ZIP/legacy jobs under ``USER_DATA_DIR/<user>``.
    Configs and every other user-owned directory are intentionally excluded.
    """
    from app.utils import _user_base_dir

    username = str(current_user["username"])
    if not username or username in {".", ".."} or "/" in username or "\\" in username:
        raise RuntimeError("Refusing unsafe username in quote artifact path")
    user_folder = f"user_{int(current_user['id'])}_{username}"
    direct_base = os.path.abspath(os.path.join("data", "uploads"))
    user_root = os.path.abspath(os.path.join(_user_base_dir(), user_folder))
    return [
        (direct_base, os.path.join(direct_base, user_folder)),
        (user_root, os.path.join(user_root, "uploads")),
        (user_root, os.path.join(user_root, "outputs")),
    ]


def _safe_remove_quote_artifact_dir(allowed_parent: str, path: str) -> tuple[int, int]:
    """Delete one approved user artifact root and return (roots, files)."""
    parent = os.path.realpath(os.path.abspath(allowed_parent))
    target = os.path.realpath(os.path.abspath(path))
    try:
        contained = os.path.commonpath([parent, target]) == parent
    except ValueError:
        contained = False
    # Never delete the allowed parent itself, anything outside it, or a symlink
    # target. This keeps recursive deletion within the exact quote-only roots.
    if not contained or target == parent:
        raise RuntimeError(f"Refusing unsafe quote artifact path: {path}")
    if os.path.islink(os.path.abspath(path)):
        raise RuntimeError(f"Refusing symlink quote artifact path: {path}")
    if not os.path.exists(target):
        return 0, 0
    if not os.path.isdir(target):
        raise RuntimeError(f"Quote artifact path is not a directory: {path}")

    file_count = 0
    for _, _, filenames in os.walk(target, followlinks=False):
        file_count += len(filenames)
    shutil.rmtree(target)
    return 1, file_count


def _clear_quote_artifacts(current_user: dict) -> dict[str, int]:
    """Remove current-user uploaded models and G-code, and nothing else."""
    summary = {"roots_deleted": 0, "files_deleted": 0}
    seen: set[str] = set()
    for allowed_parent, path in _quote_artifact_directories(current_user):
        key = os.path.normcase(os.path.realpath(os.path.abspath(path)))
        if key in seen:
            continue
        seen.add(key)
        roots, files = _safe_remove_quote_artifact_dir(allowed_parent, path)
        summary["roots_deleted"] += roots
        summary["files_deleted"] += files
    return summary

def quote_history(limit: int = 20, offset: int = 0, current_user=Depends(get_current_user)):
    """Get quote history for current user."""
    safe_limit = max(1, min(int(limit), 100))
    safe_offset = max(0, int(offset))
    if not is_member_user(current_user):
        safe_limit = min(safe_limit, 10)
    uid = int(current_user["id"])
    with get_db_session() as db:
        total = db.query(QuoteHistory).filter(QuoteHistory.user_id == uid).count()
        rows = (
            db.query(QuoteHistory)
            .filter(QuoteHistory.user_id == uid)
            .order_by(QuoteHistory.id.desc())
            .offset(safe_offset)
            .limit(safe_limit)
            .all()
        )
        items = []
        for r in rows:
            items.append(
                {
                    "id": r.id,
                    "filename": r.filename,
                    "material": r.material,
                    "color": r.color,
                    "quantity": r.quantity,
                    "volume_cm3": round(float(r.volume_cm3 or 0), 2),
                    "weight_g": round(float(r.weight_g or 0), 2),
                    "estimated_time_h": round(float(r.estimated_time_h or 0), 2),
                    "cost_cny": round(float(r.cost_cny or 0), 2),
                    "dimensions": r.dimensions,
                    "status": r.status,
                    "error_msg": r.error_msg,
                    "created_at": r.created_at,
                    "printer_model": r.printer_model,
                    "slicer_preset_id": r.slicer_preset_id,
                    "nozzle_diameter": round(float(r.nozzle_diameter), 2) if r.nozzle_diameter is not None else None,
                    "layer_height": round(float(r.layer_height), 2) if r.layer_height is not None else None,
                    "wall_count": r.wall_count,
                    "infill": r.infill,
                    "brand": r.brand,
                    "cost_breakdown": json.loads(r.cost_breakdown) if r.cost_breakdown else None,
                }
            )
    return {"items": items, "total": total, "limit": safe_limit, "offset": safe_offset}


def delete_quote_history(id: int, request: Request, current_user=Depends(get_current_user)):
    """Delete a single quote history record by id."""
    uid = int(current_user["id"])
    try:
        with get_db_session() as db:
            row = (
                db.query(QuoteHistory)
                .filter(
                    QuoteHistory.id == int(id),
                    QuoteHistory.user_id == uid,
                )
                .first()
            )
            if row is None:
                raise HTTPException(status_code=404, detail="报价记录不存在或无权限删除")
            db.delete(row)
        logger.info(f"用户 {uid} 删除报价记录 id={id}")
        write_audit_event(
            action="quote.history.delete",
            request=request,
            user=current_user,
            detail={"deleted_id": int(id)},
        )
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除报价记录失败: user_id={uid} id={id} error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


def clear_quote_history(request: Request, current_user=Depends(get_current_user)):
    """Delete current-user history together with uploaded models and G-code."""
    uid = int(current_user["id"])
    try:
        with get_db_session() as db:
            count = db.query(QuoteHistory).filter(QuoteHistory.user_id == uid).delete()
            # Keep the DB delete in the same transaction scope as filesystem
            # cleanup. A filesystem error raises here and rolls back history so
            # the user can retry instead of silently leaving orphaned files.
            artifacts = _clear_quote_artifacts(current_user)
        logger.info(
            "Cleared quote history for user %s: records=%s files=%s roots=%s",
            uid,
            count,
            artifacts["files_deleted"],
            artifacts["roots_deleted"],
        )
        write_audit_event(
            action="quote.history.clear",
            request=request,
            user=current_user,
            detail={"deleted_count": count, **artifacts},
        )
        return {"status": "ok", "deleted": count, "artifacts": artifacts}
    except Exception as e:
        logger.error(f"Failed to clear quote history: user_id={uid} error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Clear failed: {str(e)}")


def save_quote_history(user_id: int, results: list) -> None:
    """Save quote results to history table."""
    from datetime import datetime, timezone

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
