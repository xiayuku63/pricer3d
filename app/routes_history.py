"""Quote history read/delete/clear services."""

import json
import logging
import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, Request

from app.audit import write_audit_event
from app.db import get_db_session
from app.schemas.common import PaginatedData
from app.schemas.quote import QuoteHistoryItem
from app.deps import get_current_user, is_member_user
from app.models_orm import QuoteHistory

logger = logging.getLogger(__name__)


router = APIRouter()

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

@router.get("/api/quote/history", response_model=PaginatedData[QuoteHistoryItem])
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


@router.delete("/api/quote/history/{id}")
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


@router.delete("/api/quote/history")
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
