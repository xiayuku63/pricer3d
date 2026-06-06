"""
打印机参数管理 API
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone

from .db import get_db_session
from .models_orm import PrinterParam
from .deps import get_current_user


router = APIRouter(prefix="/api/printer-params", tags=["printer-params"])


class PrinterParamResponse(BaseModel):
    id: int
    printer_id: str
    nozzle: float
    max_speed: float
    max_acceleration: float
    jerk_limit: float
    speed_enabled: bool
    created_at: str
    updated_at: str


class PrinterParamUpdate(BaseModel):
    max_speed: Optional[float] = None
    max_acceleration: Optional[float] = None
    jerk_limit: Optional[float] = None
    speed_enabled: Optional[bool] = None


@router.get("/{printer_id}/{nozzle}", response_model=PrinterParamResponse)
async def get_printer_param(printer_id: str, nozzle: float):
    """获取打印机参数"""
    with get_db_session() as db:
        param = db.query(PrinterParam).filter(
            PrinterParam.printer_id == printer_id,
            PrinterParam.nozzle == nozzle
        ).first()
        if not param:
            raise HTTPException(status_code=404, detail="打印机参数不存在")
        
        return PrinterParamResponse(
            id=param.id,
            printer_id=param.printer_id,
            nozzle=param.nozzle,
            max_speed=param.max_speed,
            max_acceleration=param.max_acceleration,
            jerk_limit=param.jerk_limit,
            speed_enabled=bool(param.speed_enabled),
            created_at=param.created_at,
            updated_at=param.updated_at,
        )


@router.get("/{printer_id}", response_model=List[PrinterParamResponse])
async def get_printer_params_by_model(printer_id: str):
    """获取打印机所有喷嘴的参数"""
    with get_db_session() as db:
        params = db.query(PrinterParam).filter(
            PrinterParam.printer_id == printer_id
        ).order_by(PrinterParam.nozzle).all()
        
        return [
            PrinterParamResponse(
                id=p.id,
                printer_id=p.printer_id,
                nozzle=p.nozzle,
                max_speed=p.max_speed,
                max_acceleration=p.max_acceleration,
                jerk_limit=p.jerk_limit,
                speed_enabled=bool(p.speed_enabled),
                created_at=p.created_at,
                updated_at=p.updated_at,
            )
            for p in params
        ]


@router.put("/{printer_id}/{nozzle}", response_model=PrinterParamResponse)
async def update_printer_param(
    printer_id: str,
    nozzle: float,
    data: PrinterParamUpdate,
    user: dict = Depends(get_current_user)
):
    """更新打印机参数（需要登录）"""
    now = datetime.now(timezone.utc).isoformat()
    
    with get_db_session() as db:
        param = db.query(PrinterParam).filter(
            PrinterParam.printer_id == printer_id,
            PrinterParam.nozzle == nozzle
        ).first()
        if not param:
            raise HTTPException(status_code=404, detail="打印机参数不存在")
        
        if data.max_speed is not None:
            param.max_speed = data.max_speed
        if data.max_acceleration is not None:
            param.max_acceleration = data.max_acceleration
        if data.jerk_limit is not None:
            param.jerk_limit = data.jerk_limit
        if data.speed_enabled is not None:
            param.speed_enabled = 1 if data.speed_enabled else 0
        
        param.updated_at = now
        db.commit()
        
        return PrinterParamResponse(
            id=param.id,
            printer_id=param.printer_id,
            nozzle=param.nozzle,
            max_speed=param.max_speed,
            max_acceleration=param.max_acceleration,
            jerk_limit=param.jerk_limit,
            speed_enabled=bool(param.speed_enabled),
            created_at=param.created_at,
            updated_at=param.updated_at,
        )


@router.post("/{printer_id}/{nozzle}", response_model=PrinterParamResponse)
async def create_printer_param(
    printer_id: str,
    nozzle: float,
    data: PrinterParamUpdate,
    user: dict = Depends(get_current_user)
):
    """创建打印机参数（需要登录）"""
    now = datetime.now(timezone.utc).isoformat()
    
    with get_db_session() as db:
        existing = db.query(PrinterParam).filter(
            PrinterParam.printer_id == printer_id,
            PrinterParam.nozzle == nozzle
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="打印机参数已存在")
        
        param = PrinterParam(
            printer_id=printer_id,
            nozzle=nozzle,
            max_speed=data.max_speed or 500,
            max_acceleration=data.max_acceleration or 10000,
            jerk_limit=data.jerk_limit or 0.04,
            speed_enabled=1 if data.speed_enabled else 0,
            created_at=now,
            updated_at=now,
        )
        db.add(param)
        db.commit()
        
        return PrinterParamResponse(
            id=param.id,
            printer_id=param.printer_id,
            nozzle=param.nozzle,
            max_speed=param.max_speed,
            max_acceleration=param.max_acceleration,
            jerk_limit=param.jerk_limit,
            speed_enabled=bool(param.speed_enabled),
            created_at=param.created_at,
            updated_at=param.updated_at,
        )
