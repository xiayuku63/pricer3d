"""3D打印件智能方向优化 — orientation optimizer.

分析 STL/3MF 模型文件，根据用户指定的"放置平面"自动确定最佳打印朝向。

Public API:
    analyze_orientation(model_path, face_normal) → 最优朝向
    get_stable_faces(model_path)                → 候选放置面
    cluster_coplanar_faces(mesh)                → 共面簇（Lay on Face）
    get_best_face_for_slicing(model_path)       → 自动选面 + 旋转导出
    apply_orientation_to_mesh(model_path, R)    → 应用旋转保存 STL

Submodules:
    orientation_math    — 纯数学工具（旋转、采样、欧拉角转换）
    orientation_scoring — 朝向评分、微调、稳定面搜索
    orientation_cluster — 共面聚类（PrusaSlicer Lay on Face 算法）
"""

import math
import os
import logging
import numpy as np
import trimesh
from typing import Optional, Sequence

from calculator.orientation_math import (
    fibonacci_sphere_sampling,
    rodrigues_rotation,
    align_face_to_z,
    rotation_to_euler,
    rotation_from_up_vector,
)
from calculator.orientation_scoring import (
    OVERHANG_ANGLE_DEG,
    NUM_FIBONACCI_SAMPLES,
    NUM_LARGE_FACE_SAMPLES,
    TOP_N_RESULTS,
    SUPPORT_WEIGHT,
    TIME_WEIGHT,
    ADHESION_WEIGHT,
    FINE_TUNE_Z_RANGE,
    FINE_TUNE_STEP,
    _score_orientation_3x3,
    fine_tune_orientation,
    evaluate_orientation,
    get_stable_faces,
)
from calculator.orientation_cluster import (
    COPLANAR_ANGLE_TOLERANCE_DEG,
    COPLANAR_ANGLE_TOLERANCE_RAD,
    COPLANAR_COS_THRESHOLD,
    MIN_COPLANAR_AREA_MM2,
    _clean_value,
    _merge_planar_clusters_internal,
    _extract_cluster_outline_p3d,
    cluster_coplanar_faces,
)

logger = logging.getLogger(__name__)

# ── Re-export all public symbols for backward compatibility ──
__all__ = [
    # Public API
    "analyze_orientation",
    "get_stable_faces",
    "cluster_coplanar_faces",
    "get_best_face_for_slicing",
    "apply_orientation_to_mesh",
    # Math tools
    "fibonacci_sphere_sampling",
    "rodrigues_rotation",
    "align_face_to_z",
    "rotation_to_euler",
    "rotation_from_up_vector",
    # Scoring
    "evaluate_orientation",
    "fine_tune_orientation",
    # Constants
    "OVERHANG_ANGLE_DEG",
    "SUPPORT_WEIGHT",
    "TIME_WEIGHT",
    "ADHESION_WEIGHT",
    "FINE_TUNE_Z_RANGE",
    "FINE_TUNE_STEP",
    "NUM_FIBONACCI_SAMPLES",
    "NUM_LARGE_FACE_SAMPLES",
    "TOP_N_RESULTS",
    "COPLANAR_ANGLE_TOLERANCE_DEG",
    "COPLANAR_COS_THRESHOLD",
    "MIN_COPLANAR_AREA_MM2",
]


def _load_mesh(model_path: str) -> trimesh.Trimesh:
    """Load and validate a 3D model file (STL/3MF/STEP).

    STEP files are auto-converted to STL via PrusaSlicer before loading.
    """
    _tmp = None
    ext = os.path.splitext(model_path)[1].lower()
    if ext in (".stp", ".step"):
        import tempfile as _tempfile
        import subprocess as _subprocess
        fd, _tmp = _tempfile.mkstemp(suffix=".stl", prefix="p3d_orient_step_")
        os.close(fd)
        result = _subprocess.run(
            ["prusa-slicer", "--export-stl", "--output", _tmp, model_path],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0 or not os.path.exists(_tmp):
            if _tmp and os.path.exists(_tmp):
                os.unlink(_tmp)
            raise ValueError(f"STEP 文件转换失败: {os.path.basename(model_path)}")
        load_path = _tmp
    else:
        load_path = model_path

    try:
        mesh = trimesh.load(load_path, force="mesh")
        if isinstance(mesh, trimesh.Scene):
            meshes = mesh.dump()
            mesh = trimesh.util.concatenate(meshes)
        if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
            raise ValueError("无法加载模型: {}".format(model_path))
        if not hasattr(mesh, 'face_normals') or mesh.face_normals is None or len(mesh.face_normals) == 0:
            mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=True, validate=True)
        return mesh
    finally:
        if _tmp and os.path.exists(_tmp):
            try:
                os.unlink(_tmp)
            except OSError:
                pass


def analyze_orientation(
    model_path: str,
    face_normal: Optional[Sequence[float]] = None,
) -> dict:
    """Analyze and optimize print orientation for a given face normal.

    Args:
        model_path: Path to STL/3MF model file.
        face_normal: [x, y, z] normal of the face to place on the bed.
                     Defaults to [0, 0, 1] (Z-up).

    Returns:
        {rotation_matrix, translation, euler_angles_deg, report}
    """
    mesh = _load_mesh(model_path)

    if face_normal is None:
        face_normal = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    else:
        face_normal = np.asarray(face_normal, dtype=np.float64)

    R_align = align_face_to_z(face_normal)

    tune = fine_tune_orientation(mesh, R_align)
    R_opt = tune["R"]

    rotated_verts = np.asarray(mesh.vertices, dtype=np.float64) @ R_opt.T
    min_z = float(rotated_verts[:, 2].min())
    translation = [0.0, 0.0, -min_z]

    euler = rotation_to_euler(R_opt)

    return {
        "rotation_matrix": [[round(float(R_opt[i, j]), 6) for j in range(3)] for i in range(3)],
        "translation": [round(float(t), 4) for t in translation],
        "euler_angles_deg": euler,
        "report": tune["report"],
    }


def apply_orientation_to_mesh(
    model_path: str,
    rotation_matrix: np.ndarray,
    translation: Optional[Sequence[float]] = None,
    output_dir: Optional[str] = None,
) -> str:
    """Apply rotation to a mesh and save as a temporary STL file for slicing.

    Args:
        model_path: Original model path.
        rotation_matrix: 3×3 rotation matrix.
        translation: [x, y, z] translation vector. Default: flush to Z=0.
        output_dir: Output directory. Default: system temp.

    Returns:
        Path to the rotated STL file.
    """
    _tmp = None
    ext = os.path.splitext(model_path)[1].lower()
    if ext in (".stp", ".step"):
        import tempfile as _tempfile
        import subprocess as _subprocess
        fd, _tmp = _tempfile.mkstemp(suffix=".stl", prefix="p3d_orient_apply_")
        os.close(fd)
        result = _subprocess.run(
            ["prusa-slicer", "--export-stl", "--output", _tmp, model_path],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0 or not os.path.exists(_tmp):
            if _tmp and os.path.exists(_tmp):
                os.unlink(_tmp)
            raise ValueError(f"STEP 文件转换失败: {os.path.basename(model_path)}")
        load_path = _tmp
    else:
        load_path = model_path

    try:
        mesh = trimesh.load(load_path, force="mesh")
        if isinstance(mesh, trimesh.Scene):
            meshes = mesh.dump()
            mesh = trimesh.util.concatenate(meshes)

        if not isinstance(mesh, trimesh.Trimesh):
            raise ValueError("无法加载模型: {}".format(model_path))

        R = np.asarray(rotation_matrix, dtype=np.float64)
        if R.shape != (3, 3):
            R = R[:3, :3]

        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        rotated_verts = vertices @ R.T

        if translation is not None:
            T = np.asarray(translation, dtype=np.float64)[:3]
        else:
            T = np.array([0.0, 0.0, -float(rotated_verts[:, 2].min())])

        rotated_verts += T

        rotated_mesh = trimesh.Trimesh(
            vertices=rotated_verts,
            faces=mesh.faces,
            process=False,
            validate=False,
        )

        import tempfile
        fd, out_path = tempfile.mkstemp(suffix=".stl", prefix="p3d_orient_")
        os.close(fd)
        rotated_mesh.export(out_path, file_type="stl")
        logger.info(
            "模型已旋转保存: %s → %s (旋转角度: %s)",
            os.path.basename(model_path),
            os.path.basename(out_path),
            rotation_to_euler(R),
        )
        return out_path
    finally:
        if _tmp and os.path.exists(_tmp):
            try:
                os.unlink(_tmp)
            except OSError:
                pass


def get_best_face_for_slicing(model_path: str) -> dict:
    """Auto-select the best print-bed face using coplanar clustering + scoring.

    Strategy:
    1. Coplanar clustering to find all flat candidate faces
    2. Score each candidate (support / time / adhesion)
    3. Pick highest-scoring face
    4. Export rotated STL for slicing

    Returns:
        {
            oriented_path: str,     # Rotated model path
            original_path: str,     # Original model path
            rotation_matrix: [[...], ...],
            euler_angles_deg: {x, y, z},
            score: float,
            face: {...},            # Selected face info
            tune_report: str,
            all_candidates: [...],  # Top N candidates
        }
    """
    mesh = _load_mesh(model_path)

    # Step 1: coplanar clustering
    coplanar_clusters = cluster_coplanar_faces(mesh)

    # Step 2: score each cluster
    candidates = []
    for cluster in coplanar_clusters:
        normal = np.array(cluster["normal"], dtype=np.float64)
        up = -normal
        up_norm = float(np.linalg.norm(up))
        if up_norm < 1e-8:
            continue
        up = up / up_norm
        if up[2] < 0:
            up = -up

        R = rotation_from_up_vector(up)
        eval_result = evaluate_orientation(mesh, R)
        candidates.append({
            "face": cluster,
            "score": eval_result["score"],
            "metrics": eval_result["metrics"],
            "euler_angles_deg": eval_result["euler_angles_deg"],
        })

    # Step 3: fallback to stable faces if no coplanar clusters found
    if not candidates:
        faces_result = get_stable_faces(model_path)
        for f in faces_result.get("faces", []):
            contact = float(f.get("metrics", {}).get("contact_area", 0))
            overhang = float(f.get("metrics", {}).get("overhang_ratio", 0))
            score = contact * (1.0 - overhang) * 0.5
            candidates.append({
                "face": {"normal": f.get("normal", [0, 0, 0]), "area": f.get("area", 0)},
                "score": round(score, 2),
                "metrics": {
                    "contact_area": contact,
                    "overhang_ratio": overhang,
                    "z_height": f.get("metrics", {}).get("z_height", 0),
                },
                "euler_angles_deg": {"x": 0, "y": 0, "z": 0},
            })

    # Step 4: sort by score
    candidates.sort(key=lambda c: c["score"], reverse=True)

    if not candidates:
        return {
            "oriented_path": model_path,
            "original_path": model_path,
            "rotation_matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            "euler_angles_deg": {"x": 0, "y": 0, "z": 0},
            "score": 0,
            "face": None,
            "all_candidates": [],
        }

    best = candidates[0]
    best_normal = np.array(best["face"]["normal"], dtype=np.float64)

    # Step 5: compute rotation + fine-tune + export
    up = -best_normal
    up_norm = float(np.linalg.norm(up))
    if up_norm < 1e-8:
        up = np.array([0.0, 0.0, 1.0])
    else:
        up = up / up_norm
        if up[2] < 0:
            up = -up

    R = rotation_from_up_vector(up)
    tune = fine_tune_orientation(mesh, R[:3, :3])
    R_opt = tune["R"]
    euler = rotation_to_euler(R_opt)

    oriented_path = apply_orientation_to_mesh(model_path, R_opt)

    return {
        "oriented_path": oriented_path,
        "original_path": model_path,
        "rotation_matrix": [[round(float(R_opt[i, j]), 6) for j in range(3)] for i in range(3)],
        "euler_angles_deg": euler,
        "score": best["score"],
        "face": best["face"],
        "tune_report": tune["report"],
        "all_candidates": candidates[:TOP_N_RESULTS],
    }
