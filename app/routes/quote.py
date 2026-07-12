"""Quote HTTP routes.

Thin layer that validates request parameters and delegates to app.services.quote.
"""

import logging
from typing import List, Optional

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from app.deps import get_current_user
from app.services.export import (
    PdfInlineRequest,
    export_pdf_inline,
    export_quote_history,
    export_quote_pdf,
)
from app.services.quote import build_quote_payload, save_quote_history
from app.services.history import delete_quote_history, clear_quote_history, quote_history
from calculator.cost import FORMULA_ALIAS_TO_CANONICAL, validate_formula_expression

logger = logging.getLogger(__name__)


class FormulaValidateRequest(BaseModel):
    unit_cost_formula: str = Field(..., min_length=1, max_length=800)
    total_cost_formula: str = Field(..., min_length=1, max_length=800)


async def get_quote(
    request: Request,
    files: List[UploadFile] = File(...),
    material: str = Form("PLA", min_length=1, max_length=40),
    layer_height: float = Form(0.2, ge=0.05, le=1.0),
    infill: int = Form(20, ge=0, le=100),
    wall_count: int = Form(3, ge=1, le=20),
    slicer_preset_id: Optional[int] = Form(default=None),
    quantity: int = Form(1, ge=1, le=5000),
    color: str = Form("White", min_length=1, max_length=40),
    use_prusaslicer: Optional[bool] = Form(default=None),
    printer_model: Optional[str] = Form(default=None),
    auto_orient: Optional[bool] = Form(default=False),
    orient_x: Optional[float] = Form(default=None),
    orient_y: Optional[float] = Form(default=None),
    orient_z: Optional[float] = Form(default=None),
    current_user=Depends(get_current_user),
):
    logger.warning("ROUTE_DEBUG auto_orient=%s type=%s", auto_orient, type(auto_orient).__name__)
    try:
        return await build_quote_payload(
            request=request,
            files=files,
            material=material,
            layer_height=layer_height,
            infill=infill,
            wall_count=wall_count,
            slicer_preset_id=slicer_preset_id,
            quantity=quantity,
            color=color,
            use_prusaslicer=use_prusaslicer,
            printer_model=printer_model,
            auto_orient=auto_orient,
            orient_x=orient_x,
            orient_y=orient_y,
            orient_z=orient_z,
            current_user=current_user,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"处理报价请求失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"INTERNAL_ERROR: 报价请求失败 ({str(e)})")


async def validate_formula(payload: FormulaValidateRequest, current_user=Depends(get_current_user)):
    unit_ok, unit_err, unit_vars = validate_formula_expression(payload.unit_cost_formula)
    total_ok, total_err, total_vars = validate_formula_expression(payload.total_cost_formula)
    ok = unit_ok and total_ok
    return {
        "ok": ok,
        "unit": {"ok": unit_ok, "error": unit_err, "used_vars": unit_vars},
        "total": {"ok": total_ok, "error": total_err, "used_vars": total_vars},
        "aliases": FORMULA_ALIAS_TO_CANONICAL,
    }
