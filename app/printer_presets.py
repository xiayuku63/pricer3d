"""Printer preset management (DB operations)."""

import json
import base64
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from .database import get_db_conn

PRINTER_PRESET_NAME_MAX_LEN = 60


def list_printer_presets(user_id: int) -> list[dict]:
    uid = int(user_id or 0)
    if uid <= 0:
        return []
    with get_db_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, bed_width, bed_depth, bed_height, nozzle, nozzles, created_at "
            "FROM printer_presets WHERE user_id = ? ORDER BY id DESC",
            (uid,),
        ).fetchall()
    out = []
    for r in rows or []:
        try:
            nozzles = json.loads(str(r["nozzles"] or "[]"))
        except Exception:
            nozzles = [0.4]
        out.append({
            "id": int(r["id"]),
            "name": str(r["name"] or ""),
            "bed_width": float(r["bed_width"]),
            "bed_depth": float(r["bed_depth"]),
            "bed_height": float(r["bed_height"]),
            "nozzle": float(r["nozzle"]),
            "nozzles": nozzles,
            "created_at": str(r["created_at"] or ""),
        })
    return out


def get_printer_preset_by_id(user_id: int, preset_id: int) -> Optional[dict]:
    uid = int(user_id or 0)
    pid = int(preset_id or 0)
    if uid <= 0 or pid <= 0:
        return None
    with get_db_conn() as conn:
        row = conn.execute(
            "SELECT id, name, bed_width, bed_depth, bed_height, nozzle, nozzles, profile_b64, created_at "
            "FROM printer_presets WHERE id = ? AND user_id = ?",
            (pid, uid),
        ).fetchone()
    if not row:
        return None
    try:
        nozzles = json.loads(str(row["nozzles"] or "[]"))
    except Exception:
        nozzles = [0.4]
    try:
        profile = base64.b64decode(str(row["profile_b64"] or "").encode("ascii"), validate=False)
    except Exception:
        profile = b""
    return {
        "id": int(row["id"]),
        "name": str(row["name"] or ""),
        "bed_width": float(row["bed_width"]),
        "bed_depth": float(row["bed_depth"]),
        "bed_height": float(row["bed_height"]),
        "nozzle": float(row["nozzle"]),
        "nozzles": nozzles,
        "profile": bytes(profile),
        "created_at": str(row["created_at"] or ""),
    }


def _generate_printer_profile(bed_width: float, bed_depth: float, bed_height: float,
                               nozzle: float = 0.4, acceleration: int = 10000,
                               speed: int = 250) -> str:
    """Generate INI content for a printer profile."""
    return f"""# {int(bed_width)}x{int(bed_depth)}x{int(bed_height)}mm printer profile
bed_shape = 0x0,{int(bed_width)}x0,{int(bed_width)}x{int(bed_depth)},0x{int(bed_depth)}
bed_temperature = 55
first_layer_bed_temperature = 55
bridge_acceleration = 5000
bridge_speed = 60
default_acceleration = {acceleration}
external_perimeter_acceleration = {acceleration // 2}
external_perimeter_speed = {speed}
first_layer_acceleration = 5000
first_layer_speed = 50
infill_acceleration = {acceleration}
infill_speed = {speed + 50}
machine_max_acceleration_e = 5000
machine_max_acceleration_extruding = 20000
machine_max_acceleration_x = 20000
machine_max_acceleration_y = 20000
machine_max_acceleration_z = 1500
machine_max_feedrate_e = 32
machine_max_feedrate_x = 500
machine_max_feedrate_y = 500
machine_max_feedrate_z = 30
machine_max_jerk_e = 5
machine_max_jerk_x = 10
machine_max_jerk_y = 10
machine_max_jerk_z = 3
max_print_height = {int(bed_height)}
perimeter_acceleration = {acceleration}
perimeter_speed = {speed}
solid_infill_speed = {speed + 20}
temperature = 220
first_layer_temperature = 220
top_solid_infill_speed = {speed}
travel_acceleration = 20000
travel_speed = 500
nozzle_diameter = {nozzle}
filament_diameter = 1.75
layer_height = 0.2
first_layer_height = 0.35
"""


def upsert_printer_preset(user_id: int, name: str, bed_width: float, bed_depth: float,
                           bed_height: float, nozzle: float, nozzles: list[float]) -> dict:
    uid = int(user_id or 0)
    if uid <= 0:
        raise HTTPException(status_code=401, detail="未登录")
    preset_name = (name or "").strip()[:PRINTER_PRESET_NAME_MAX_LEN]
    if not preset_name:
        raise HTTPException(status_code=400, detail="打印机名称不能为空")
    bw = max(50.0, min(1000.0, float(bed_width or 256)))
    bd = max(50.0, min(1000.0, float(bed_depth or 256)))
    bh = max(50.0, min(1000.0, float(bed_height or 256)))
    nz = max(0.1, min(2.0, float(nozzle or 0.4)))
    nzs = [max(0.1, min(2.0, float(n))) for n in (nozzles or [nz])]
    if not nzs:
        nzs = [nz]

    profile = _generate_printer_profile(bw, bd, bh, nozzle=nz)
    b64 = base64.b64encode(profile.encode("utf-8")).decode("ascii")
    created_at = datetime.now(timezone.utc).isoformat()
    nozzles_json = json.dumps(nzs)

    with get_db_conn() as conn:
        conn.execute(
            """
            INSERT INTO printer_presets (user_id, name, bed_width, bed_depth, bed_height,
                nozzle, nozzles, profile_b64, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, name) DO UPDATE SET
                bed_width = excluded.bed_width,
                bed_depth = excluded.bed_depth,
                bed_height = excluded.bed_height,
                nozzle = excluded.nozzle,
                nozzles = excluded.nozzles,
                profile_b64 = excluded.profile_b64,
                created_at = excluded.created_at
            """,
            (uid, preset_name, bw, bd, bh, nz, nozzles_json, b64, created_at),
        )
        row = conn.execute(
            "SELECT id, name, bed_width, bed_depth, bed_height, nozzle, nozzles, created_at "
            "FROM printer_presets WHERE user_id = ? AND name = ?",
            (uid, preset_name),
        ).fetchone()
        conn.commit()
    if not row:
        raise HTTPException(status_code=500, detail="打印机预设保存失败")
    try:
        saved_nozzles = json.loads(str(row["nozzles"] or "[]"))
    except Exception:
        saved_nozzles = [0.4]
    return {
        "id": int(row["id"]),
        "name": str(row["name"]),
        "bed_width": float(row["bed_width"]),
        "bed_depth": float(row["bed_depth"]),
        "bed_height": float(row["bed_height"]),
        "nozzle": float(row["nozzle"]),
        "nozzles": saved_nozzles,
        "created_at": str(row["created_at"]),
    }


def delete_printer_preset(user_id: int, preset_id: int) -> bool:
    uid = int(user_id or 0)
    pid = int(preset_id or 0)
    if uid <= 0 or pid <= 0:
        return False
    with get_db_conn() as conn:
        cur = conn.execute("DELETE FROM printer_presets WHERE id = ? AND user_id = ?", (pid, uid))
        conn.commit()
        return int(cur.rowcount or 0) > 0


def download_printer_profile(user_id: int, preset_id: int) -> Optional[bytes]:
    preset = get_printer_preset_by_id(user_id, preset_id)
    if not preset:
        return None
    return preset["profile"]
