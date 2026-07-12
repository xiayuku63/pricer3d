"""Quote history read/delete/clear services."""

import json
import logging
from typing import Optional

from fastapi import HTTPException, Request

from app.audit import write_audit_event
from app.db import get_db_session
from app.deps import get_membership_effective, is_member_user
from app.models_orm import QuoteHistory

logger = logging.getLogger(__name__)


def quote_history(limit: int = 20, offset: int = 0, current_user: dict = None):
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
            items.append({
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
            })
    return {"items": items, "total": total, "limit": safe_limit, "offset": safe_offset}


def delete_quote_history(id: int, request: Request, current_user: dict = None):
    """Delete a single quote history record by id."""
    uid = int(current_user["id"])
    try:
        with get_db_session() as db:
            row = db.query(QuoteHistory).filter(
                QuoteHistory.id == int(id),
                QuoteHistory.user_id == uid,
            ).first()
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


def clear_quote_history(request: Request, current_user: dict = None):
    """Delete all quote history records for the current user."""
    uid = int(current_user["id"])
    try:
        with get_db_session() as db:
            count = db.query(QuoteHistory).filter(QuoteHistory.user_id == uid).delete()
        logger.info(f"用户 {uid} 清理全部报价记录，共删除 {count} 条")
        write_audit_event(
            action="quote.history.clear",
            request=request,
            user=current_user,
            detail={"deleted_count": count},
        )
        return {"status": "ok", "deleted": count}
    except Exception as e:
        logger.error(f"清理报价记录失败: user_id={uid} error={str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"清理失败: {str(e)}")
