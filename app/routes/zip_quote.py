"""ZIP quote HTTP routes.

Thin layer that validates request parameters and delegates to app.services.zip_quote.
"""

import logging
from typing import Optional

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile

from app.deps import get_current_user
from app.services.zip_quote import (
    build_zip_preview_response,
    build_zip_quote_response,
    download_zip_model as _download_zip_model,
    download_zip_template as _download_zip_template,
)

logger = logging.getLogger(__name__)


async def zip_preview(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """POST /api/quote/zip/preview"""
    try:
        return await build_zip_preview_response(file)
    except HTTPException as e:
        logger.warning(
            "ZIP preview rejected: filename=%s detail=%s",
            file.filename,
            e.detail,
        )
        raise
    except Exception as e:
        logger.error(f"ZIP preview failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"ZIP 预览失败 ({str(e)})")


async def zip_quote(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    material: str = Form("PLA"),
    color: str = Form("White"),
    quantity: int = Form(1),
    printer_model: Optional[str] = Form(default=None),
    slicer_preset_id: Optional[int] = Form(default=None),
    layer_height: float = Form(0.2),
    wall_count: int = Form(3),
    infill: int = Form(20),
    session_id: Optional[str] = Form(default=None),
    current_user=Depends(get_current_user),
):
    """POST /api/quote/zip"""
    try:
        return await build_zip_quote_response(
            request=request,
            file=file,
            material=material,
            color=color,
            quantity=quantity,
            printer_model=printer_model,
            slicer_preset_id=slicer_preset_id,
            layer_height=layer_height,
            wall_count=wall_count,
            infill=infill,
            session_id=session_id,
            current_user=current_user,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ZIP quote failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"INTERNAL_ERROR: ZIP 报价失败 ({str(e)})")


async def download_zip_model(
    file_path: str,
    current_user=Depends(get_current_user),
):
    """GET /api/quote/zip/file"""
    return _download_zip_model(file_path, current_user)


async def download_zip_template(request: Request):
    """GET /api/quote/zip/template"""
    return _download_zip_template(request)
