"""Orientation optimization routes.

POST /api/orientation/optimize — 接收上传文件，返回最优方向建议。
POST /api/orientation/faces    — 返回模型可摆放面列表。
POST /api/orientation/train    — 自学习标记训练样本。
"""

import os
import uuid
import json
import logging
from datetime import datetime, timezone
from fastapi import Depends, UploadFile, File, HTTPException, Request, Form

from .config import MAX_FILE_SIZE_BYTES, SUPPORTED_EXTENSIONS
from .deps import get_current_user
from calculator.orientation import analyze_orientation, get_stable_faces, cluster_coplanar_faces, get_best_face_for_slicing

logger = logging.getLogger(__name__)


async def optimize_orientation(
    request: Request,
    file: UploadFile = File(...),
    face_normal: str = Form(default=""),
    current_user=Depends(get_current_user),
):
    filename = file.filename or "unnamed"
    _, ext = os.path.splitext(filename.lower())
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}。支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) >= MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="文件大小超过限制 (100MB)")

    normal = None
    if face_normal and face_normal.strip():
        try:
            parsed = json.loads(face_normal)
            if isinstance(parsed, list) and len(parsed) == 3:
                normal = [float(parsed[0]), float(parsed[1]), float(parsed[2])]
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            raise HTTPException(status_code=400, detail=f"face_normal 格式错误: {str(e)[:100]}")

    tmp_dir = "/tmp/pricer3d_orient"
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}{ext}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(content)

        result = analyze_orientation(tmp_path, face_normal=normal)
        result["filename"] = filename
        return result
    except Exception as e:
        logger.error("方向分析失败 %s: %s", filename, e)
        raise HTTPException(status_code=500, detail=f"方向分析失败: {str(e)[:200]}")
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass


async def list_stable_faces(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """返回模型所有可摆放面（稳定平面）的法向量、面积和面索引。"""
    filename = file.filename or "unnamed"
    _, ext = os.path.splitext(filename.lower())
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}。支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) >= MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="文件大小超过限制 (100MB)")

    tmp_dir = "/tmp/pricer3d_orient"
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}{ext}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(content)

        result = get_stable_faces(tmp_path)
        result["filename"] = filename
        return result
    except Exception as e:
        logger.error("可摆放面分析失败 %s: %s", filename, e)
        raise HTTPException(status_code=500, detail=f"面分析失败: {str(e)[:200]}")
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass


async def list_coplanar_clusters(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """返回模型的共面面片聚类结果（Lay on Face 候选区域）。

    与 /api/orientation/faces 的区别：
    - /faces 返回单个大面和凸包面
    - /coplanar 返回基于法向量聚类（<3°容差）的相邻共面区域
    """
    filename = file.filename or "unnamed"
    _, ext = os.path.splitext(filename.lower())
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}。支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) >= MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="文件大小超过限制 (100MB)")

    tmp_dir = "/tmp/pricer3d_orient"
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}{ext}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(content)

        import trimesh
        mesh = trimesh.load(tmp_path, force="mesh")
        if isinstance(mesh, trimesh.Scene):
            meshes = mesh.dump()
            mesh = trimesh.util.concatenate(meshes)
        if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
            return {"filename": filename, "clusters": []}

        clusters = cluster_coplanar_faces(mesh)
        return {"filename": filename, "clusters": clusters}
    except Exception as e:
        logger.error("共面聚类分析失败 %s: %s", filename, e)
        raise HTTPException(status_code=500, detail=f"共面分析失败: {str(e)[:200]}")
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass


async def train_sample(
    request: Request,
    file: UploadFile = File(...),
    x: float = Form(...),
    y: float = Form(...),
    z: float = Form(...),
    current_user=Depends(get_current_user),
):
    """自学习标记：将用户确认最优的方向保存为训练样本。"""
    filename = file.filename or "unnamed"
    _, ext = os.path.splitext(filename.lower())
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}。支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) >= MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="文件大小超过限制 (100MB)")

    tmp_dir = "/tmp/pricer3d_orient"
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}{ext}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(content)

        try:
            import trimesh
            mesh = trimesh.load(tmp_path, force="mesh")
            if isinstance(mesh, trimesh.Scene):
                meshes = mesh.dump()
                mesh = trimesh.util.concatenate(meshes)
            volume = float(mesh.volume) if hasattr(mesh, 'volume') else 0.0
            surface_area = float(mesh.area) if hasattr(mesh, 'area') else 0.0
            bbox = mesh.bounds
            z_height = float(bbox[1, 2] - bbox[0, 2])
        except Exception:
            volume = 0.0
            surface_area = 0.0
            z_height = 0.0

        sample = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "filename": filename,
            "user_id": getattr(current_user, "id", None),
            "euler_angles_deg": {"x": round(x, 1), "y": round(y, 1), "z": round(z, 1)},
            "features": {
                "volume_mm3": round(volume, 2),
                "surface_area_mm2": round(surface_area, 2),
                "z_height_mm": round(z_height, 2),
            },
        }

        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
        os.makedirs(data_dir, exist_ok=True)
        jsonl_path = os.path.join(data_dir, "training_samples.jsonl")
        with open(jsonl_path, "a") as f:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")

        logger.info("训练样本已保存: %s (%.1f, %.1f, %.1f)", filename, x, y, z)
        return {"status": "ok", "message": "已标记"}
    except Exception as e:
        logger.error("训练样本保存失败 %s: %s", filename, e)
        raise HTTPException(status_code=500, detail=f"标记失败: {str(e)[:200]}")
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass
