"""ZIP archive parsing and checklist/model matching.

This module owns the archive safety checks and the hand-off to the existing
Excel checklist parser.  The public seam is intentionally small so callers do
not need to know how archive entries are classified or matched.
"""

import io
import logging
import os
import zipfile
from collections.abc import Collection
from typing import Optional

from fastapi import HTTPException

from app.zip_parser import _match_checklist_to_models, _parse_excel_checklist

logger = logging.getLogger(__name__)


def parse_zip_contents(
    file_bytes: bytes,
    *,
    max_size_bytes: int,
    max_files: int,
    supported_extensions: Collection[str],
) -> dict:
    """Parse a ZIP upload into model files, an optional checklist, and matches."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="无效的 ZIP 文件，请检查文件完整性") from exc

    excel_bytes: Optional[bytes] = None
    excel_filename: Optional[str] = None
    model_files = []
    model_keys = set()

    with archive as zf:
        entries = [entry for entry in zf.infolist() if not entry.is_dir()]
        expanded_size = sum(entry.file_size for entry in entries)
        if expanded_size > max_size_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"ZIP 解压后总大小不能超过 {max_size_bytes // (1024 * 1024)}MB",
            )

        for entry in entries:
            if entry.flag_bits & 0x1:
                raise HTTPException(status_code=400, detail="ZIP 中不能包含加密文件")
            if entry.file_size > max_size_bytes:
                raise HTTPException(
                    status_code=400,
                    detail=f"ZIP 中单个文件解压后不能超过 {max_size_bytes // (1024 * 1024)}MB",
                )
            if entry.file_size and entry.compress_size == 0:
                raise HTTPException(status_code=400, detail="ZIP 中包含异常压缩条目")

        for entry in entries:
            basename = os.path.basename(entry.filename)
            path_parts = entry.filename.replace("\\", "/").split("/")
            if basename.startswith(".") or "__MACOSX" in path_parts or basename.startswith("~$"):
                continue

            entry_bytes = zf.read(entry)
            lower_name = basename.lower()
            if lower_name.endswith((".xlsx", ".xls")):
                if excel_bytes is not None:
                    raise HTTPException(status_code=400, detail="ZIP 中只能包含一个 Excel 清单")
                excel_bytes = entry_bytes
                excel_filename = basename
                logger.info("ZIP: found Excel checklist: %s", basename)
                continue

            extension = os.path.splitext(lower_name)[1]
            if extension not in supported_extensions:
                continue

            stem = os.path.splitext(lower_name)[0]
            if stem in model_keys:
                raise HTTPException(
                    status_code=400,
                    detail=f"ZIP 中存在重名模型：{basename}。模型文件名（不含扩展名）必须唯一",
                )
            model_keys.add(stem)
            model_files.append(
                {
                    "filename": basename,
                    "name_stem": stem,
                    "file_bytes": entry_bytes,
                    "ext": extension,
                }
            )
            logger.info("ZIP: found model file: %s (stem=%s)", basename, stem)

    if not model_files:
        raise HTTPException(status_code=400, detail="ZIP 中未找到支持的模型文件（.stl/.stp/.step/.obj/.3mf）")
    if len(model_files) > max_files:
        raise HTTPException(status_code=400, detail=f"ZIP 中模型文件数量不能超过 {max_files} 个")

    try:
        checklist = _parse_excel_checklist(excel_bytes, excel_filename) if excel_bytes else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    match_result = (
        _match_checklist_to_models(checklist, model_files)
        if checklist
        else {
            "matched": [],
            "checklist_only": [],
            "stl_only": model_files,
            "match_mode": "none",
        }
    )

    return {
        "excel_bytes": excel_bytes,
        "excel_filename": excel_filename,
        "stl_files": model_files,
        "checklist": checklist,
        "match_result": match_result,
    }
