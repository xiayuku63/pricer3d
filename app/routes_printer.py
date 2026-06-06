"""Printer preset API routes."""

import json
import logging
from typing import Optional

from fastapi import Request, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .deps import get_current_user
from .audit import write_audit_event
from .printer_presets import (
    list_printer_presets,
    get_printer_preset_by_id,
    upsert_printer_preset,
    delete_printer_preset,
    download_printer_profile,
)

logger = logging.getLogger(__name__)


class PrinterPresetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=60, description="打印机名称")
    bed_width: float = Field(256.0, ge=50.0, le=1000.0)
    bed_depth: float = Field(256.0, ge=50.0, le=1000.0)
    bed_height: float = Field(256.0, ge=50.0, le=1000.0)
    nozzle: float = Field(0.4, description="默认喷嘴直径(mm)")
    nozzles: list[float] = Field(default=[0.4], description="可用喷嘴列表")


async def api_list_printer_presets(current_user=Depends(get_current_user)):
    try:
        items = list_printer_presets(int(current_user["id"]))
        return {"items": items}
    except Exception as e:
        logger.error(f"获取打印机预设列表失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="操作失败，请稍后重试")


async def api_get_printer_preset(preset_id: int, current_user=Depends(get_current_user)):
    try:
        preset = get_printer_preset_by_id(int(current_user["id"]), int(preset_id))
        if not preset:
            raise HTTPException(status_code=404, detail="预设不存在或无权限")
        return {"preset": {**preset, "profile": None}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取打印机预设详情失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="操作失败，请稍后重试")


async def api_create_printer_preset(payload: PrinterPresetRequest, request: Request,
                                     current_user=Depends(get_current_user)):
    try:
        preset = upsert_printer_preset(
            int(current_user["id"]),
            payload.name.strip(),
            payload.bed_width,
            payload.bed_depth,
            payload.bed_height,
            payload.nozzle,
            payload.nozzles,
        )
        write_audit_event(
            action="printer.preset.create",
            request=request,
            user=current_user,
            detail={"preset_id": preset["id"], "name": preset["name"]},
        )
        return {"status": "ok", "preset": preset}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建打印机预设失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="操作失败，请稍后重试")


async def api_delete_printer_preset(preset_id: int, request: Request,
                                     current_user=Depends(get_current_user)):
    try:
        ok = delete_printer_preset(int(current_user["id"]), int(preset_id))
        if not ok:
            raise HTTPException(status_code=404, detail="预设不存在或无权限")
        write_audit_event(
            action="printer.preset.delete",
            request=request,
            user=current_user,
            detail={"preset_id": preset_id},
        )
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除打印机预设失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="操作失败，请稍后重试")


async def api_download_printer_profile(preset_id: int,
                                        current_user=Depends(get_current_user)):
    try:
        profile = download_printer_profile(int(current_user["id"]), int(preset_id))
        if not profile:
            raise HTTPException(status_code=404, detail="预设不存在或无权限")
        return PlainTextResponse(profile.decode("utf-8", errors="replace"),
                                  media_type="text/plain",
                                  headers={"Content-Disposition": f"attachment; filename=printer_{preset_id}.ini"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"下载打印机配置失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="操作失败，请稍后重试")
