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

import numpy as np

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

        clusters = cluster_coplanar_faces(mesh, include_upward_faces=True)
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

        import trimesh
        mesh = trimesh.load(tmp_path, force="mesh")
        if isinstance(mesh, trimesh.Scene):
            meshes = mesh.dump()
            mesh = trimesh.util.concatenate(meshes)
        if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
            return {"status": "ok", "message": "已标记 (无面级数据)"}

        # ── 新版: 面级特征提取 ──
        from calculator.orientation_cluster import cluster_coplanar_faces
        from calculator.orientation_math import euler_to_up_vector
        from calculator.orientation_learner import (
            FaceFeatureExtractor,
            OrientationLearner,
            FEATURE_DIM,
        )

        # Step 1: coplanar 聚类 → 候选面列表
        clusters = cluster_coplanar_faces(mesh, include_upward_faces=True)
        if not clusters:
            # 无候选面时回退到全局特征 (兼容旧格式)
            logger.info("无 coplanar 候选面，写全局特征")
            volume = float(mesh.volume) if hasattr(mesh, 'volume') else 0.0
            surface_area = float(mesh.area) if hasattr(mesh, 'area') else 0.0
            bbox = mesh.bounds
            z_height = float(bbox[1, 2] - bbox[0, 2])
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
            logger.info("训练样本已保存(全局): %s", filename)
            return {"status": "ok", "message": "已标记 (全局特征)"}

        # Step 2: 欧拉角 → up_vector
        up_user = euler_to_up_vector(x, y, z)

        # Step 3: 找与用户 up_vector 匹配的面 (正样本)
        extractor = FaceFeatureExtractor()
        best_cos = -1.0
        best_cluster_idx = -1
        for i, cluster in enumerate(clusters):
            normal = np.array(cluster["normal"], dtype=np.float64)
            n_len = float(np.linalg.norm(normal))
            if n_len < 1e-8:
                continue
            normal = normal / n_len
            cos_sim = abs(float(np.dot(normal, up_user)))
            if cos_sim > best_cos:
                best_cos = cos_sim
                best_cluster_idx = i

        # 若 cos_sim < 0.98，无可靠正样本，跳过面级标注
        POSITIVE_COS_THRESHOLD = 0.98
        if best_cos < POSITIVE_COS_THRESHOLD or best_cluster_idx < 0:
            logger.info(
                "无可匹配正样本 (best_cos=%.3f < %.2f)，跳过面级标注: %s",
                best_cos, POSITIVE_COS_THRESHOLD, filename,
            )
            return {"status": "ok", "message": "已标记 (无匹配正样本)", "cos_sim": round(best_cos, 4)}

        # Step 4: 提取所有候选面特征，写入 JSONL
        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
        os.makedirs(data_dir, exist_ok=True)
        jsonl_path = os.path.join(data_dir, "training_samples.jsonl")

        timestamp = datetime.now(timezone.utc).isoformat()
        sample_id = uuid.uuid4().hex[:12]
        n_written = 0

        with open(jsonl_path, "a") as f:
            for i, cluster in enumerate(clusters):
                is_positive = (i == best_cluster_idx)
                try:
                    feat = extractor.extract(mesh, cluster)
                except Exception as e:
                    logger.warning("跳过面 %d (特征提取失败): %s", i, e)
                    continue

                sample = {
                    "timestamp": timestamp,
                    "sample_id": sample_id,
                    "filename": filename,
                    "user_id": getattr(current_user, "id", None),
                    "user_euler_deg": {"x": round(x, 1), "y": round(y, 1), "z": round(z, 1)},
                    "is_positive": is_positive,
                    "cluster_index": i,
                    "total_clusters": len(clusters),
                    "features": OrientationLearner.features_to_dict(feat),
                }
                f.write(json.dumps(sample, ensure_ascii=False) + "\n")
                n_written += 1

        logger.info(
            "训练样本已保存(面级): %s, clusters=%d, pos_idx=%d, cos=%.4f",
            filename, n_written, best_cluster_idx, best_cos,
        )

        # Step 5: 检查是否达到自动重训阈值 (如果配置开启)
        auto_retrain_triggered = False
        try:
            from .config import (
                ORIENT_LEARNING_AUTO_RETRAIN,
                ORIENT_LEARNING_MIN_NEW_SAMPLES,
            )
            if ORIENT_LEARNING_AUTO_RETRAIN:
                # 统计当前总样本行数
                with open(jsonl_path, "r") as f_sample:
                    total_lines = sum(1 for line in f_sample if line.strip())
                if total_lines >= ORIENT_LEARNING_MIN_NEW_SAMPLES:
                    learner = OrientationLearner(data_dir=data_dir)
                    loaded = learner.load_samples("training_samples.jsonl")
                    if loaded:
                        try:
                            acc = learner.train(loaded)
                            auto_retrain_triggered = True
                            logger.info("自动重训完成: accuracy=%.3f", acc)
                        except Exception as e:
                            logger.warning("自动重训失败: %s", e)
        except ImportError:
            pass  # 配置项不存在则跳过自动重训
        except Exception as e:
            logger.warning("自动重训检查失败: %s", e)

        return {
            "status": "ok",
            "message": "已标记 (面级)",
            "n_faces": n_written,
            "positive_cluster": best_cluster_idx,
            "cos_sim": round(best_cos, 4),
            "auto_trained": auto_retrain_triggered,
        }
    except Exception as e:
        logger.error("训练样本保存失败 %s: %s", filename, e)
        raise HTTPException(status_code=500, detail=f"标记失败: {str(e)[:200]}")
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass


async def model_status(
    request: Request,
    current_user=Depends(get_current_user),
):
    """获取朝向学习模型状态。

    GET /api/orientation/model/status
    → {trained, n_samples, n_positive, accuracy, last_trained, model_path}
    """
    from calculator.orientation_learner import OrientationLearner

    data_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
    )
    learner = OrientationLearner(data_dir=data_dir)

    last_trained = None
    model_path = os.path.join(data_dir, "orientation_model.pkl")
    if os.path.exists(model_path):
        last_trained = datetime.fromtimestamp(
            os.path.getmtime(model_path), tz=timezone.utc
        ).isoformat()

    return {
        "trained": learner.is_trained(),
        "n_samples": learner.n_samples,
        "n_positive": learner.n_positive,
        "accuracy": round(learner.accuracy, 4) if learner.accuracy is not None else None,
        "last_trained": last_trained,
        "model_path": model_path,
        "coef": (
            [round(float(c), 6) for c in learner.model.coef_[0]]
            if learner.is_trained() and hasattr(learner.model, "coef_")
            else None
        ),
    }


async def admin_train_model(
    request: Request,
    current_user=Depends(get_current_user),
):
    """管理员手动触发朝向模型训练。

    POST /api/admin/orientation/train
    → {status, n_samples, n_positive, accuracy, coef}
    """
    from .deps import require_admin
    require_admin(current_user)

    from calculator.orientation_learner import OrientationLearner

    data_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
    )
    learner = OrientationLearner(data_dir=data_dir)
    samples = learner.load_samples("training_samples.jsonl")

    if not samples:
        raise HTTPException(
            status_code=400, detail="无训练样本，请先通过 /api/orientation/train 提交样本"
        )

    n_positive = sum(1 for s in samples if s.get("is_positive"))
    if n_positive < 2:
        raise HTTPException(
            status_code=400,
            detail=f"正样本不足 (n_positive={n_positive})，至少需要 2 个正样本",
        )

    accuracy = learner.train(samples)

    coef = None
    if learner.is_trained() and hasattr(learner.model, "coef_"):
        coef = [round(float(c), 6) for c in learner.model.coef_[0]]

    return {
        "status": "ok",
        "n_samples": learner.n_samples,
        "n_positive": learner.n_positive,
        "accuracy": round(accuracy, 4),
        "coef": coef,
    }


async def auto_learned_orient(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """使用自学习模型自动摆放：接收文件，返回最优朝向。

    POST /api/orientation/auto-learned
    → {euler_angles_deg: {x,y,z}, score, method_used, face_normal, fallback}
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

        from calculator.orientation import get_best_face_for_slicing

        result = get_best_face_for_slicing(tmp_path, method="learned")
        euler = result.get("euler_angles_deg", {"x": 0, "y": 0, "z": 0})
        face = result.get("face") or {}
        normal = face.get("normal") if isinstance(face, dict) else None

        return {
            "status": "ok",
            "euler_angles_deg": euler,
            "score": result.get("score"),
            "method_used": result.get("method_used", "learned"),
            "fallback": result.get("fallback", False),
            "face_normal": normal,
            "n_candidates": result.get("n_candidates"),
            "best_label": result.get("best_label"),
            "prusa": result.get("prusa"),
        }
    except Exception as e:
        logger.error("自动摆放(学习模型)失败 %s: %s", filename, e)
        raise HTTPException(status_code=500, detail=f"自动摆放失败: {str(e)[:200]}")
    finally:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass
