"""
ZIP upload quote route — parse Excel checklist + STL models from .zip archive.

Excel checklist columns (header row, case-insensitive):
    filename | 打印机 | 喷嘴直径 | 层高 | 墙层数 | 填充密度
    filename | printer | nozzle | layer_height | wall_count | infill

Matching: compare checklist filename stem with STL filename stem (case-insensitive,
ignoring extension). Reports full / partial / none match status.
"""

import io
import json
import logging
import os
import uuid
import zipfile
from typing import List, Optional

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from openpyxl import load_workbook

from .config import (
    DEFAULT_MATERIALS,
    DEFAULT_PRICING_CONFIG,
    MAX_FILES_PER_REQUEST,
    MAX_FILE_SIZE_BYTES,
    SUPPORTED_EXTENSIONS,
    QUOTE_CONCURRENCY,
)
from .database import get_db_conn
from .deps import get_current_user, get_membership_effective
from .audit import write_audit_event

logger = logging.getLogger(__name__)

# Excel column name mapping (CN → EN canonical key)
_EXCEL_KEY_MAP = {
    "filename": "filename",
    "文件名": "filename",
    "打印机": "printer_model",
    "printer": "printer_model",
    "喷嘴直径": "nozzle",
    "nozzle": "nozzle",
    "层高": "layer_height",
    "layer_height": "layer_height",
    "墙层数": "wall_count",
    "perimeters": "wall_count",
    "wall_count": "wall_count",
    "填充密度": "infill",
    "infill": "infill",
    "infill_density": "infill",
}

# Max ZIP file size (200MB to be safe for many STLs)
MAX_ZIP_SIZE_BYTES = 200 * 1024 * 1024


def _parse_excel_checklist(file_bytes: bytes) -> Optional[List[dict]]:
    """Parse Excel checklist. Returns list of {filename, printer_model, nozzle, layer_height, wall_count, infill}
    or None if no checklist found / parse error."""
    try:
        wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    except Exception as e:
        logger.warning(f"Failed to open Excel workbook: {e}")
        return None

    ws = wb.active
    if not ws:
        return None

    rows = list(ws.iter_rows(min_row=1, max_row=min(ws.max_row or 1000, 1000), values_only=True))
    if len(rows) < 2:
        return None

    # Parse header
    header = [str(c).strip().lower() if c else "" for c in rows[0]]
    col_map = {}
    for idx, h in enumerate(header):
        canonical = _EXCEL_KEY_MAP.get(h)
        if canonical:
            col_map[idx] = canonical

    if "filename" not in col_map.values():
        logger.warning("Excel has no 'filename' column — not a valid checklist")
        return None

    items = []
    for row in rows[1:]:
        item = {}
        for col_idx, key in col_map.items():
            val = row[col_idx] if col_idx < len(row) else None
            if val is not None:
                item[key] = str(val).strip()
            else:
                item[key] = ""

        # Skip rows with no filename
        if not item.get("filename"):
            continue

        # Normalize filename — strip extension if present
        fn = item["filename"]
        dot_pos = fn.rfind(".")
        if dot_pos > 0:
            fn = fn[:dot_pos]
        item["filename_stem"] = fn.lower()

        # Parse numeric fields with validation
        for num_key in ("layer_height", "wall_count", "infill"):
            val = item.get(num_key, "")
            if val == "":
                continue
            try:
                if num_key == "layer_height":
                    item[num_key + "_parsed"] = float(val)
                elif num_key == "wall_count":
                    item[num_key + "_parsed"] = int(float(val))
                else:
                    item[num_key + "_parsed"] = int(float(val.replace("%", "")))
            except (ValueError, TypeError):
                pass

        items.append(item)

    wb.close()
    return items if items else None


def _match_checklist_to_models(
    checklist: List[dict],
    stl_files: List[dict],  # [{filename, name_stem, file_bytes}]
) -> dict:
    """
    Match checklist items to STL files by filename stem.
    Returns:
        {
            matched: [{checklist_item, stl_info}],      # full match
            checklist_only: [{...}],                    # in checklist but no STL
            stl_only: [{...}],                          # STL files with no checklist entry
            match_mode: "all" | "partial" | "none",
        }
    """
    # Build STL stem → info map
    stl_by_stem = {}
    for f in stl_files:
        stl_by_stem[f["name_stem"]] = f

    matched_stems = set()
    matched = []
    checklist_only = []

    for item in checklist:
        stem = item.get("filename_stem", "")
        if stem and stem in stl_by_stem:
            matched.append({
                "checklist": item,
                "stl": stl_by_stem[stem],
            })
            matched_stems.add(stem)
        else:
            checklist_only.append(item)

    # STL files not in checklist
    stl_only = [f for f in stl_files if f["name_stem"] not in matched_stems]

    # Determine match mode
    if len(matched) == len(stl_files) and len(checklist_only) == 0 and len(stl_only) == 0:
        match_mode = "all"
    elif len(matched) == 0:
        match_mode = "none"
    else:
        match_mode = "partial"

    return {
        "matched": matched,
        "checklist_only": checklist_only,
        "stl_only": stl_only,
        "match_mode": match_mode,
    }


async def zip_quote(
    request: Request,
    file: UploadFile = File(...),
    material: str = Form("PLA"),
    color: str = Form("White"),
    quantity: int = Form(1),
    current_user=Depends(get_current_user),
):
    """
    Upload a .zip file containing an Excel checklist (.xlsx/.xls) + STL model files.
    Returns match analysis + triggers slicing for matched models.

    Request: multipart/form-data with:
        file: the .zip file (required)
        material: default material (optional, default PLA)
        color: default color (optional, default White)
        quantity: default quantity (optional, default 1)
    """
    import asyncio

    try:
        # Validate file extension
        fname = (file.filename or "").lower()
        if not fname.endswith(".zip"):
            raise HTTPException(status_code=400, detail="请上传 .zip 压缩文件")

        # Read file content
        content = await file.read()
        if len(content) >= MAX_ZIP_SIZE_BYTES:
            raise HTTPException(status_code=400, detail=f"ZIP 文件必须小于 {MAX_ZIP_SIZE_BYTES // (1024*1024)}MB")

        # Parse ZIP
        try:
            zf = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="无效的 ZIP 文件，请检查文件完整性")

        # Separate Excel and STL files from ZIP
        excel_bytes = None
        stl_files = []  # [{filename, name_stem, file_bytes}]

        for entry in zf.infolist():
            # Skip directories and __MACOSX junk
            if entry.is_dir():
                continue
            bn = os.path.basename(entry.filename)
            if bn.startswith(".") or bn.startswith("__MACOSX") or bn.startswith("~$"):
                continue

            entry_bytes = zf.read(entry)

            lower = bn.lower()
            if lower.endswith((".xlsx", ".xls")):
                if excel_bytes is None:
                    excel_bytes = entry_bytes
                    logger.info(f"ZIP: found Excel checklist: {bn}")
            else:
                ext = os.path.splitext(lower)[1]
                if ext in SUPPORTED_EXTENSIONS:
                    stem = os.path.splitext(bn)[0].lower()
                    stl_files.append({
                        "filename": bn,
                        "name_stem": stem,
                        "file_bytes": entry_bytes,
                        "ext": ext,
                    })
                    logger.info(f"ZIP: found model file: {bn} (stem={stem})")

        zf.close()

        if not stl_files:
            raise HTTPException(status_code=400, detail="ZIP 中未找到支持的模型文件（.stl/.stp/.step/.obj/.3mf）")

        if len(stl_files) > MAX_FILES_PER_REQUEST:
            raise HTTPException(status_code=400, detail=f"ZIP 中模型文件数量不能超过 {MAX_FILES_PER_REQUEST} 个")

        # Parse Excel checklist
        checklist = _parse_excel_checklist(excel_bytes) if excel_bytes else None

        # Match checklist to models
        if checklist:
            match_result = _match_checklist_to_models(checklist, stl_files)
        else:
            match_result = {
                "matched": [],
                "checklist_only": [],
                "stl_only": stl_files,
                "match_mode": "none",
            }

        # Get user materials + pricing
        with get_db_conn() as conn:
            row = conn.execute(
                "SELECT materials, pricing_config FROM users WHERE id = ?",
                (current_user["id"],),
            ).fetchone()
        user_materials = json.loads(row["materials"]) if row and row["materials"] else DEFAULT_MATERIALS
        pricing_config = json.loads(row["pricing_config"]) if row and row["pricing_config"] else DEFAULT_PRICING_CONFIG

        # Build match status message
        total_stl = len(stl_files)
        if match_result["match_mode"] == "all":
            match_msg = f"✅ 全部模型预设生效（{len(match_result['matched'])}/{total_stl} 个文件匹配）"
        elif match_result["match_mode"] == "partial":
            match_msg = f"⚠️ 部分模型预设生效，请检查清单（{len(match_result['matched'])} 匹配 / {len(match_result['checklist_only'])} 清单多余 / {len(match_result['stl_only'])} 无预设）"
        else:
            if checklist:
                match_msg = f"❌ 全部模型预设未生效，请检查清单（{len(stl_files)} 个模型均未匹配）"
            else:
                match_msg = "ℹ️ 未包含 Excel 清单，使用默认参数"

        # Now process matched + stl_only files via slicing
        # For matched files: use checklist parameters
        # For stl_only files: use default parameters
        results = []

        from calculator.cost import process_single_file
        from .slicer_presets import get_slicer_preset_by_id

        # Process matched files with checklist params
        for m in match_result["matched"]:
            cl = m["checklist"]
            stl = m["stl"]

            # Build per-file options from checklist
            lh = cl.get("layer_height_parsed", 0.2)
            if isinstance(lh, str):
                try:
                    lh = float(lh)
                except (ValueError, TypeError):
                    lh = 0.2
            wc = cl.get("wall_count_parsed", 3)
            if isinstance(wc, str):
                try:
                    wc = int(float(wc))
                except (ValueError, TypeError):
                    wc = 3
            inf = cl.get("infill_parsed", 20)
            if isinstance(inf, str):
                try:
                    inf = int(float(inf))
                except (ValueError, TypeError):
                    inf = 20

            # Create a fake UploadFile for process_single_file
            fake_file = UploadFile(
                filename=stl["filename"],
                file=io.BytesIO(stl["file_bytes"]),
            )

            try:
                result = await process_single_file(
                    fake_file,
                    material=material,
                    layer_height=lh,
                    infill=inf,
                    quantity=quantity,
                    color=color,
                    user_materials=user_materials,
                    pricing_config=pricing_config,
                    slicer_preset=None,
                    perimeters=wc,
                    current_user=current_user,
                    auto_orient=False,
                )
                # Mark as checklist-driven
                result["_checklist_params"] = True
                result["_checklist_source"] = {
                    "layer_height": lh,
                    "wall_count": wc,
                    "infill": inf,
                }
                # Copy to non-underscore key for JSON serialization
                if result.get("_saved_path"):
                    result["checklist_file_path"] = result["_saved_path"]
            except Exception as e:
                result = {
                    "filename": stl["filename"],
                    "status": "failed",
                    "error": str(e),
                    "cost_cny": 0,
                    "weight_g": 0,
                    "estimated_time_h": 0,
                }

            results.append(result)

        # Process stl_only with defaults
        for stl in match_result["stl_only"]:
            fake_file = UploadFile(
                filename=stl["filename"],
                file=io.BytesIO(stl["file_bytes"]),
            )
            try:
                result = await process_single_file(
                    fake_file,
                    material=material,
                    layer_height=0.2,
                    infill=20,
                    quantity=quantity,
                    color=color,
                    user_materials=user_materials,
                    pricing_config=pricing_config,
                    slicer_preset=None,
                    perimeters=3,
                    current_user=current_user,
                    auto_orient=False,
                )
                result["_checklist_params"] = False
                if result.get("_saved_path"):
                    result["checklist_file_path"] = result["_saved_path"]
            except Exception as e:
                result = {
                    "filename": stl["filename"],
                    "status": "failed",
                    "error": str(e),
                    "cost_cny": 0,
                    "weight_g": 0,
                    "estimated_time_h": 0,
                }

            results.append(result)

        # Build response
        _has_saved = any(r.get("_saved_path") for r in results)
        logger.info(f"ZIP results has _saved_path: {_has_saved}")
        success_items = [r for r in results if r.get("status") == "success"]
        failed_items = [r for r in results if r.get("status") == "failed"]

        payload = {
            "total_files": len(results),
            "success_count": len(success_items),
            "failed_count": len(failed_items),
            "summary_total_cost_cny": round(sum(r.get("cost_cny", 0) for r in success_items), 2),
            "summary_total_weight_g": round(sum(r.get("weight_g", 0) for r in success_items), 2),
            "summary_total_time_h": round(sum(r.get("estimated_time_h", 0) for r in success_items), 2),
            "results": results,
            "match_status": {
                "mode": match_result["match_mode"],
                "message": match_msg,
                "matched_count": len(match_result["matched"]),
                "checklist_only_count": len(match_result["checklist_only"]),
                "stl_only_count": len(match_result["stl_only"]),
                "checklist_only_files": [c.get("filename", c.get("filename_stem", "")) for c in match_result["checklist_only"]],
            },
        }

        # Save quote history
        from .routes_quote import _save_quote_history
        _save_quote_history(int(current_user["id"]), results)

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

        return payload

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ZIP quote failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"INTERNAL_ERROR: ZIP 报价失败 ({str(e)})")


async def download_zip_model(
    file_path: str,
    current_user=Depends(get_current_user),
):
    """
    Download a model file that was saved during ZIP processing.
    Used by frontend to rebuild File objects for preview/re-quote.
    """
    from fastapi.responses import FileResponse
    import os as _os

    # Security: only allow paths under the user's upload directory
    from app.utils import _user_base_dir
    user_folder = f"user_{current_user['id']}_{current_user['username']}"
    allowed_prefix = _os.path.join(_user_base_dir(), user_folder, "uploads")

    abs_path = _os.path.abspath(file_path)
    if not abs_path.startswith(allowed_prefix):
        raise HTTPException(status_code=403, detail="Access denied")

    if not _os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(abs_path, filename=_os.path.basename(abs_path))
