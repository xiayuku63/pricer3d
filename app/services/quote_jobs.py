"""Asynchronous quote jobs (P2-15).

POST /api/quote/jobs spools uploaded files to disk, freezes the quote
parameters and returns a job id immediately. A shared worker pool executes
each file through the same _process_single_file_sync path as the synchronous
route; clients poll GET /api/quote/jobs/{id} for per-file progress.

The job id doubles as the quote-batch id, so the existing cancellation
protocol (and its hard-kill of in-flight slicing) applies unchanged.
"""

import json
import logging
import os
import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile

from app.config import FREE_TOTAL_MODEL_LIMIT, QUOTE_CONCURRENCY
from app.deps import is_member_user
from app.db import get_db_session
from app.models_orm import QuoteHistory, QuoteJob, QuoteJobItem
from app.quote_batch import batch_cancelled, register_batch, release_batch
from app.services.quote import (
    _load_user_quote_settings,
    _process_single_file_sync,
    _resolve_effective_printer_model,
    _resolve_effective_slicer_params,
    _resolve_effective_slicer_preset,
    merge_user_material_with_catalog,
    save_quote_history,
)

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(
    max_workers=max(1, QUOTE_CONCURRENCY), thread_name_prefix="quote-job"
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_dir(user_id: int, job_id: str) -> str:
    return os.path.join("data", "uploads", f"user_{user_id}", "jobs", job_id)


def create_quote_job(
    files: list[UploadFile],
    material: str,
    brand,
    layer_height: float,
    infill: int,
    wall_count: int,
    slicer_preset_id,
    quantity: int,
    color: str,
    use_prusaslicer,
    printer_model,
    auto_orient,
    entity_colors_json,
    current_user: dict,
) -> str:
    """Validate, spool, persist and enqueue a quote job. Returns the job id."""
    from sqlalchemy import func as sqlfunc

    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一个模型文件")

    user_id = int(current_user["id"])
    with get_db_session() as db:
        existing_count = (
            db.query(sqlfunc.count(QuoteHistory.id))
            .filter(QuoteHistory.user_id == user_id, QuoteHistory.status == "success")
            .scalar()
            or 0
        )
    if not is_member_user(current_user) and existing_count >= FREE_TOTAL_MODEL_LIMIT:
        raise HTTPException(
            status_code=400, detail=f"免费用户最多累计 {FREE_TOTAL_MODEL_LIMIT} 个模型，升级会员无限制"
        )

    # Same preparation as the synchronous route: resolve user materials,
    # pricing config and the effective slicer preset/params once, up front.
    (
        user_materials,
        pricing_config,
        default_printer_id,
        default_nozzle,
        default_slicer_preset_id,
    ) = _load_user_quote_settings(user_id)
    if use_prusaslicer is not None:
        pricing_config["use_prusaslicer"] = use_prusaslicer
    effective_printer_model = _resolve_effective_printer_model(printer_model, default_printer_id, default_nozzle)
    if effective_printer_model is not None:
        pricing_config["printer_model"] = effective_printer_model

    material_names = {str(m.get("name")) for m in user_materials if isinstance(m, dict)}
    if material not in material_names:
        raise HTTPException(status_code=400, detail="材料参数不合法")
    requested_brand = str(brand or "").strip()
    candidates = [
        m
        for m in user_materials
        if isinstance(m, dict)
        and str(m.get("name")) == material
        and (not requested_brand or str(m.get("brand") or "Generic").strip() == requested_brand)
    ]
    selected_material = merge_user_material_with_catalog(
        candidates[0] if candidates else None, material, requested_brand, color
    )
    if requested_brand and selected_material is None:
        raise HTTPException(status_code=400, detail="材料品牌参数不合法")
    materials_for_quote = (
        [selected_material] + [m for m in user_materials if m is not selected_material]
        if selected_material
        else user_materials
    )
    effective_preset_id, slicer_preset = _resolve_effective_slicer_preset(
        user_id, slicer_preset_id, default_slicer_preset_id
    )
    layer_height, wall_count, infill = _resolve_effective_slicer_params(
        layer_height, wall_count, infill, slicer_preset
    )

    # The preset's raw INI content is stored as bytes for the synchronous
    # path; both consumers accept str, and params_json needs it serializable.
    if isinstance(slicer_preset, dict) and isinstance(slicer_preset.get("content"), bytes):
        slicer_preset = {
            **slicer_preset,
            "content": slicer_preset["content"].decode("utf-8", errors="replace"),
        }

    params = {
        "material": material,
        "brand": str(selected_material.get("brand") or "Generic").strip() if selected_material else requested_brand,
        "layer_height": layer_height,
        "infill": infill,
        "wall_count": wall_count,
        "quantity": quantity,
        "color": color,
        "pricing_config": pricing_config,
        "slicer_preset": slicer_preset,
        "materials_for_quote": materials_for_quote,
        "selected_material": selected_material,
        "auto_orient": bool(auto_orient),
        "entity_colors": json.loads(entity_colors_json) if entity_colors_json else {},
        "user": {
            "id": user_id,
            "username": current_user.get("username"),
            "membership_level": current_user.get("membership_level"),
        },
    }

    job_id = str(uuid.uuid4())
    spool_dir = _job_dir(user_id, job_id)
    os.makedirs(spool_dir, exist_ok=True)

    entries = []
    try:
        for f in files:
            filename = os.path.basename(f.filename or "model.stl") or "model.stl"
            dest = os.path.join(spool_dir, filename)
            with open(dest, "wb") as out:
                out.write(f.file.read())
            entries.append({"filename": filename, "source_path": dest})
    except Exception:
        shutil.rmtree(spool_dir, ignore_errors=True)
        raise

    now = _utc_now()
    with get_db_session() as db:
        db.add(QuoteJob(
            id=job_id, user_id=user_id, status="pending", total_files=len(entries),
            params_json=json.dumps(params), created_at=now, updated_at=now,
        ))
        for e in entries:
            db.add(QuoteJobItem(
                job_id=job_id, filename=e["filename"], source_path=e["source_path"],
                status="pending", updated_at=now,
            ))

    register_batch(job_id, user_id)
    _executor.submit(_execute_job, job_id, user_id)
    return job_id


def _execute_job(job_id: str, user_id: int) -> None:
    from parser.prusa_slicer import set_slice_batch

    with get_db_session() as db:
        job = db.get(QuoteJob, job_id)
        if job is None or (job.status not in (None, "pending")):
            return
        job.status = "running"
        job.updated_at = _utc_now()
        items = db.query(QuoteJobItem).filter(QuoteJobItem.job_id == job_id).all()
        params = json.loads(job.params_json or "{}")
        pending = [(i.filename, i.source_path) for i in items if i.status == "pending"]
    set_slice_batch(job_id)
    try:
        # Serial within a job: a job item is a full quote pipeline (slicing
        # included) and per-item progress writes stay single-threaded, which
        # keeps the shared :memory: test DB and busy-file databases happy.
        # Cross-job parallelism comes from the shared executor instead.
        for filename, source_path in pending:
            _run_job_item(job_id, user_id, filename, source_path, params)
    finally:
        _finalize_job(job_id)
        release_batch(job_id)


def _run_job_item(job_id: str, user_id: int, filename: str, source_path: str, params: dict) -> None:
    from parser.prusa_slicer import set_slice_batch

    set_slice_batch(job_id)

    def _update(status: str, error=None, result=None):
        try:
            with get_db_session() as db:
                item = (
                    db.query(QuoteJobItem)
                    .filter(QuoteJobItem.job_id == job_id, QuoteJobItem.filename == filename)
                    .first()
                )
                if item is None:
                    return
                item.status = status
                item.error = error
                if result is not None:
                    item.result_json = json.dumps(result)
                item.updated_at = _utc_now()
        except Exception:  # noqa: BLE001 — a lost progress update must not kill the worker
            logger.warning("quote job %s: progress update failed for %s", job_id, filename, exc_info=True)

    # Queued behind a cancelled batch: skip without reading the file.
    if batch_cancelled(job_id, user_id):
        _update("cancelled", error="客户端已断开，报价已取消")
        _remove_spool(source_path)
        return

    _update("running")
    try:
        with open(source_path, "rb") as fh:
            fake = UploadFile(filename=filename, file=fh)
            result = _process_single_file_sync(
                fake,
                params["material"],
                params["layer_height"],
                params["infill"],
                params["quantity"],
                params["color"],
                params["materials_for_quote"],
                params["pricing_config"],
                slicer_preset=params.get("slicer_preset"),
                perimeters=params.get("wall_count"),
                current_user=params.get("user"),
                auto_orient=params.get("auto_orient", False),
                selected_material_spec=params.get("selected_material"),
                entity_colors=params.get("entity_colors") or {},
            )
        if isinstance(result, dict) and params.get("brand"):
            result["brand"] = params["brand"]
        # Cancelled while slicing (hard-killed): discard the result.
        if batch_cancelled(job_id, user_id):
            _update("cancelled", error="客户端已断开，报价已取消")
        else:
            _update(str((result or {}).get("status") or "failed"), result=result)
    except Exception as e:  # noqa: BLE001 — per-file isolation
        logger.error("quote job %s: file %s failed: %s", job_id, filename, e, exc_info=True)
        _update("failed", error=str(e)[:400])
    finally:
        _remove_spool(source_path)


def _remove_spool(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _finalize_job(job_id: str) -> None:
    results = []
    user_id = None
    with get_db_session() as db:
        job = db.get(QuoteJob, job_id)
        if job is None:
            return
        user_id = job.user_id
        items = db.query(QuoteJobItem).filter(QuoteJobItem.job_id == job_id).all()
        statuses = [i.status for i in items]
        for i in items:
            if i.result_json:
                try:
                    results.append(json.loads(i.result_json))
                except (TypeError, ValueError):
                    pass
        if "cancelled" in statuses or job.status == "cancelled":
            job.status = "cancelled"
        elif not statuses:
            job.status = "failed"
        elif all(s == "success" for s in statuses):
            job.status = "success"
        elif any(s == "success" for s in statuses):
            job.status = "partial"
        else:
            job.status = "failed"
        job.updated_at = _utc_now()
    if results:
        try:
            save_quote_history(user_id, results)
        except Exception:  # noqa: BLE001
            logger.error("quote job %s: history save failed", job_id, exc_info=True)
    shutil.rmtree(_job_dir(user_id, job_id), ignore_errors=True)


def get_quote_job(job_id: str, user_id: int) -> dict:
    with get_db_session() as db:
        job = db.get(QuoteJob, job_id)
        if job is None or job.user_id != user_id:
            raise HTTPException(status_code=404, detail="任务不存在")
        items = (
            db.query(QuoteJobItem)
            .filter(QuoteJobItem.job_id == job_id)
            .order_by(QuoteJobItem.id)
            .all()
        )
        return {
            "job_id": job.id,
            "status": job.status,
            "total_files": job.total_files,
            "created_at": job.created_at,
            "items": [
                {
                    "filename": i.filename,
                    "status": i.status,
                    "error": i.error,
                    "result": json.loads(i.result_json) if i.result_json else None,
                }
                for i in items
            ],
        }


def cancel_quote_job(job_id: str, user_id: int) -> bool:
    from app.quote_batch import cancel_batch

    with get_db_session() as db:
        job = db.get(QuoteJob, job_id)
        if job is None or job.user_id != user_id:
            raise HTTPException(status_code=404, detail="任务不存在")
    # A finished job cannot be cancelled — report no-op rather than error.
    return cancel_batch(job_id, user_id)
