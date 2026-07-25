"""ZIP quote business services."""

import json
import logging
import os
import uuid
from typing import Optional

from fastapi import HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from app.audit import write_audit_event
from app.config import (
    FREE_TOTAL_MODEL_LIMIT,
    MAX_FILES_PER_REQUEST,
    MAX_ZIP_SIZE_BYTES,
    SUPPORTED_EXTENSIONS,
)
from app.db import get_db_session
from app.deps import is_member_user
from app.models_orm import QuoteHistory
from app.zip_parser import _collect_all_warnings
from app.services.quote import (
    _load_user_quote_settings,
    _process_single_file_sync,
    _resolve_effective_printer_model,
    _resolve_effective_slicer_params,
    _resolve_effective_slicer_preset,
    save_quote_history,
)
from app.services.zip_quote_downloads import get_template_user_brands, safe_model_download
from app.services.zip_quote_parameters import (
    apply_checklist_color_mapping as _apply_checklist_color_mapping,
    build_missing_checklist_materials,
    ensure_checklist_material_colors as _ensure_checklist_material_colors_impl,
    match_selected_material as _match_selected_material,
    resolve_checklist_printer as _resolve_checklist_printer,
    resolve_color_hex as _resolve_color_hex,
)
from app.services.zip_quote_parser import parse_zip_contents
from app.services.zip_quote_template import build_zip_template_bytes
from app.services.zip_quote_runner import ZipQuoteRunConfig, ZipQuoteRunner
from app.services.zip_quote_session import (
    PreviewSessionStore,
    read_upload_file_limited,
    read_upload_limited,
    validate_free_zip_capacity,
)
logger = logging.getLogger(__name__)


_preview_sessions = PreviewSessionStore()


def _build_missing_checklist_materials(user_materials: list, checklist: Optional[list]) -> list:
    """Compatibility adapter for checklist material synthesis."""
    return build_missing_checklist_materials(user_materials, checklist)


def _ensure_checklist_material_colors(user_id: int, user_materials: list, checklist: Optional[list]) -> list:
    """Compatibility adapter that keeps the service's injectable DB seam."""
    return _ensure_checklist_material_colors_impl(
        user_id,
        user_materials,
        checklist,
        db_session_factory=get_db_session,
    )


def _store_preview_session(data: dict) -> str:
    return _preview_sessions.store(data)


def _get_preview_session(session_id: str) -> Optional[dict]:
    return _preview_sessions.get(session_id)


def _consume_preview_session(session_id: str) -> Optional[dict]:
    return _preview_sessions.consume(session_id)


async def _read_upload_limited(file: UploadFile) -> bytes:
    return await read_upload_limited(file, MAX_ZIP_SIZE_BYTES)


def _read_upload_file_limited(file: UploadFile) -> bytes:
    return read_upload_file_limited(file, MAX_ZIP_SIZE_BYTES)


def _validate_free_zip_capacity(existing_count: int, incoming_count: int) -> None:
    return validate_free_zip_capacity(existing_count, incoming_count, FREE_TOTAL_MODEL_LIMIT)


def _parse_zip_contents(file_bytes: bytes) -> dict:
    """Compatibility adapter for archive parsing with service-level limits."""
    return parse_zip_contents(
        file_bytes,
        max_size_bytes=MAX_ZIP_SIZE_BYTES,
        max_files=MAX_FILES_PER_REQUEST,
        supported_extensions=SUPPORTED_EXTENSIONS,
    )


def _zip_preview_model_path(result: dict, model: dict) -> Optional[str]:
    """Return the ZIP-owned model path exposed by the authenticated download route."""
    return model.get("_pre_saved_path") or result.get("_saved_path")


async def build_zip_preview_response(file: UploadFile):
    """Parse ZIP and return match analysis without slicing."""
    fname = (file.filename or "").lower()
    if not fname.endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 .zip 压缩文件")

    content = await _read_upload_limited(file)

    parsed = _parse_zip_contents(content)
    match_result = parsed["match_result"]
    parsed["stl_files"]
    parsed["checklist"]

    matched_list = []
    for m in match_result["matched"]:
        matched_list.append(
            {
                "filename": m["stl"]["filename"],
                "checklist": m["checklist"],
            }
        )

    checklist_colors = []
    color_counts = {}
    color_sources = {}
    for item in parsed.get("checklist") or []:
        if not isinstance(item, dict):
            continue
        source = str(item.get("color") or "").strip()
        if not source:
            continue
        key = source.lower()
        color_counts[key] = color_counts.get(key, 0) + 1
        color_sources.setdefault(key, source)
    checklist_colors = [
        {"source": color_sources[key], "count": color_counts[key]}
        for key in color_counts
    ]

    bom_only_list = []
    for c in match_result["checklist_only"]:
        bom_only_list.append(
            {
                "filename": c.get("filename", c.get("filename_stem", "")),
                "reason": "清单中有但无对应模型",
            }
        )

    model_only_list = []
    for s in match_result["stl_only"]:
        model_only_list.append(
            {
                "filename": s["filename"],
                "reason": "模型不在清单中，将使用默认参数",
            }
        )

    session_id = _store_preview_session(
        {
            "file_bytes": content,
            "stl_files": parsed["stl_files"],
            "checklist": parsed["checklist"],
            "match_result": parsed["match_result"],
            "excel_bytes": parsed["excel_bytes"],
        }
    )

    return JSONResponse(
        {
            "matched": matched_list,
            "checklist_colors": checklist_colors,
            "bom_only": bom_only_list,
            "model_only": model_only_list,
            "match_summary": {
                "matched": len(matched_list),
                "bom_only": len(bom_only_list),
                "model_only": len(model_only_list),
            },
            "session_id": session_id,
        }
    )


def _resolve_zip_defaults(current_user: dict, file: Optional[UploadFile], session_id: Optional[str]):
    """Resolve preview session or parse uploaded file, plus user defaults."""

    if session_id:
        preview_data = _consume_preview_session(session_id)
        if not preview_data:
            raise HTTPException(status_code=400, detail="预览会话已过期或不存在，请重新上传")
        stl_files = preview_data["stl_files"]
        checklist = preview_data["checklist"]
        match_result = preview_data["match_result"]
        content = preview_data["file_bytes"]
    else:
        if not file:
            raise HTTPException(status_code=400, detail="请上传 .zip 压缩文件或提供 session_id")
        fname = (file.filename or "").lower()
        if not fname.endswith(".zip"):
            raise HTTPException(status_code=400, detail="请上传 .zip 压缩文件")

        content = _read_upload_file_limited(file)
        parsed = _parse_zip_contents(content)
        stl_files = parsed["stl_files"]
        checklist = parsed["checklist"]
        match_result = parsed["match_result"]

    (
        user_materials,
        pricing_config,
        default_printer_id,
        default_nozzle,
        default_slicer_preset_id,
    ) = _load_user_quote_settings(int(current_user["id"]))

    return (
        stl_files,
        checklist,
        match_result,
        content,
        user_materials,
        pricing_config,
        default_printer_id,
        default_nozzle,
        default_slicer_preset_id,
    )


async def build_zip_quote_response(
    request: Request,
    file: Optional[UploadFile],
    material: str,
    color: str,
    quantity: int,
    printer_model: Optional[str],
    slicer_preset_id: Optional[int],
    layer_height: float,
    wall_count: int,
    infill: int,
    session_id: Optional[str],
    current_user: dict,
    color_mapping: Optional[str] = None,
):
    """Generate ZIP quote streaming response."""
    from app.utils import _user_base_dir
    from sqlalchemy import func as sqlfunc

    (
        stl_files,
        checklist,
        match_result,
        content,
        user_materials,
        pricing_config,
        default_printer_id,
        default_nozzle,
        default_slicer_preset_id,
    ) = _resolve_zip_defaults(current_user, file, session_id)
    user_materials = [dict(material) for material in user_materials if isinstance(material, dict)]

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
        _validate_free_zip_capacity(existing_count, len(stl_files))

    checklist = _apply_checklist_color_mapping(checklist, color_mapping)
    if checklist and match_result.get("matched"):
        mapped_by_stem = {
            str(item.get("filename_stem") or item.get("filename") or "").strip().lower(): item
            for item in checklist
            if isinstance(item, dict)
        }
        for matched in match_result["matched"]:
            original = matched.get("checklist") or {}
            key = str(original.get("filename_stem") or original.get("filename") or "").strip().lower()
            if key in mapped_by_stem:
                matched["checklist"] = mapped_by_stem[key]

    created_materials = _ensure_checklist_material_colors(
        int(current_user["id"]),
        user_materials,
        checklist,
    )

    # Pre-save all model files to disk so thumbnails work even if slicing fails
    _user_folder = f"user_{current_user['id']}_{current_user['username']}"
    _zip_job_id = uuid.uuid4().hex[:8]
    _zip_uploads_dir = os.path.join(_user_base_dir(), _user_folder, "uploads", _zip_job_id)
    os.makedirs(_zip_uploads_dir, exist_ok=True)
    for _sf in stl_files:
        _saved = os.path.join(_zip_uploads_dir, _sf["filename"])
        with open(_saved, "wb") as _f:
            _f.write(_sf["file_bytes"])
        _sf["_pre_saved_path"] = _saved

    total_stl = len(stl_files)
    if match_result["match_mode"] == "all":
        match_msg = f"全部模型预设生效（{len(match_result['matched'])}/{total_stl} 个文件匹配）"
    elif match_result["match_mode"] == "partial":
        match_msg = f"部分模型预设生效，请检查清单（{len(match_result['matched'])} 匹配 / {len(match_result['checklist_only'])} 清单多余 / {len(match_result['stl_only'])} 无预设）"
    else:
        if checklist:
            match_msg = f"全部模型预设未生效，请检查清单（{len(stl_files)} 个模型均未匹配）"
        else:
            match_msg = "未包含 Excel 清单，使用默认参数"

    # Resolve defaults with the exact same precedence as direct uploads.
    _default_compound_id = _resolve_effective_printer_model(printer_model, default_printer_id, default_nozzle)
    _, _default_preset = _resolve_effective_slicer_preset(
        int(current_user["id"]),
        slicer_preset_id,
        default_slicer_preset_id,
    )

    # Keep ZIP uploads on the same parameter contract as normal uploads. A
    # preset's core values win over stale form fallbacks, while checklist
    # fields below can still override them per model.
    (
        effective_layer_height,
        effective_wall_count,
        effective_infill,
    ) = _resolve_effective_slicer_params(layer_height, wall_count, infill, _default_preset)

    files_to_process = []
    for matched in match_result["matched"]:
        files_to_process.append(("matched", matched))
    for stl in match_result["stl_only"]:
        files_to_process.append(("stl_only", stl))

    runner = ZipQuoteRunner(
        ZipQuoteRunConfig(
            material=material,
            color=color,
            quantity=quantity,
            user_materials=user_materials,
            pricing_config=pricing_config,
            default_compound_id=_default_compound_id,
            default_preset=_default_preset,
            effective_layer_height=effective_layer_height,
            effective_wall_count=effective_wall_count,
            effective_infill=effective_infill,
            current_user=current_user,
            process_single_file_sync=_process_single_file_sync,
            resolve_color_hex=_resolve_color_hex,
            match_selected_material=_match_selected_material,
            resolve_checklist_printer=_resolve_checklist_printer,
            zip_preview_model_path=_zip_preview_model_path,
        )
    )

    async def _generate():
        results = []
        async for event in runner.stream(request, files_to_process):
            if event["type"] == "cancelled":
                logger.info("ZIP processing cancelled by client")
                yield f"data: {json.dumps(event)}\n\n"
                return
            if event["type"] == "progress":
                yield f"data: {json.dumps(event)}\n\n"
                continue
            results = event["results"]

        success_items = [result for result in results if result.get("status") == "success"]
        failed_items = [result for result in results if result.get("status") == "failed"]

        payload = {
            "total_files": len(results),
            "success_count": len(success_items),
            "failed_count": len(failed_items),
            "summary_total_cost_cny": round(sum(result.get("cost_cny", 0) for result in success_items), 2),
            "summary_total_weight_g": round(sum(result.get("weight_g", 0) for result in success_items), 2),
            "summary_total_time_h": round(sum(result.get("estimated_time_h", 0) for result in success_items), 2),
            "results": results,
            "created_materials": created_materials,
            "match_status": {
                "mode": match_result["match_mode"],
                "message": match_msg,
                "matched_count": len(match_result["matched"]),
                "checklist_only_count": len(match_result["checklist_only"]),
                "stl_only_count": len(match_result["stl_only"]),
                "checklist_only_files": [
                    item.get("filename", item.get("filename_stem", "")) for item in match_result["checklist_only"]
                ],
                "warnings": _collect_all_warnings(checklist),
            },
        }

        save_quote_history(int(current_user["id"]), results)
        write_audit_event(
            action="quote.zip_upload",
            request=request,
            user=current_user,
            detail={
                "files": len(results),
                "success": len(success_items),
                "failed": len(failed_items),
                "match_mode": match_result["match_mode"],
                "material": material,
                "quantity": quantity,
            },
        )

        yield f"data: {json.dumps({'type': 'done', **payload})}\n\n"

    return StreamingResponse(_generate(), media_type="text/event-stream")

def download_zip_model(file_path: str, current_user: dict):
    """Compatibility adapter for authenticated ZIP model downloads."""
    from app.utils import _user_base_dir

    return safe_model_download(file_path, current_user, _user_base_dir)


def download_zip_template(request: Request):
    """Generate and return the ZIP import checklist template."""
    from io import BytesIO

    user_brands = get_template_user_brands(request, db_session_factory=get_db_session)
    return StreamingResponse(
        BytesIO(build_zip_template_bytes(user_brands)),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=zip_import_template.xlsx"},
    )
