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

import os
import re
import subprocess
import logging
import tempfile
import uuid
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
    fine_tune_orientation,
    evaluate_orientation,
    get_stable_faces,
)
from calculator.orientation_cluster import (
    COPLANAR_ANGLE_TOLERANCE_DEG,
    COPLANAR_COS_THRESHOLD,
    MIN_COPLANAR_AREA_MM2,
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
            capture_output=True,
            text=True,
            timeout=120,
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
        if not hasattr(mesh, "face_normals") or mesh.face_normals is None or len(mesh.face_normals) == 0:
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
            capture_output=True,
            text=True,
            timeout=120,
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


def get_best_face_for_slicing(
    model_path: str,
    method: str = "coplanar",
    sa_config: Optional[dict] = None,
) -> dict:
    """Auto-select the best print-bed face using coplanar clustering or SA.

    Strategy (method="coplanar", default):
    1. Coplanar clustering to find all flat candidate faces
    2. Score each candidate (support / time / adhesion)
    3. Pick highest-scoring face
    4. Export rotated STL for slicing

    Strategy (method="sa"):
    1. Simulated Annealing in SO(3) space with Shapely bed stability
    2. Global optimum search, not limited to flat faces
    3. Export rotated STL for slicing

    Args:
        model_path: Path to STL/3MF model file
        method: "coplanar" (default) or "sa" for simulated annealing
        sa_config: Optional kwargs dict passed to optimize_orientation_sa()
                   (only used when method="sa")

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
            # SA-only fields: cost, cost_components, sa_history
        }
    """
    if method == "sa":
        from calculator.orientation_sa import optimize_orientation_sa

        return optimize_orientation_sa(model_path, **(sa_config or {}))

    if method == "learned":
        return _learned_best_face(model_path)

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
        candidates.append(
            {
                "face": cluster,
                "score": eval_result["score"],
                "metrics": eval_result["metrics"],
                "euler_angles_deg": eval_result["euler_angles_deg"],
            }
        )

    # Step 3: fallback to stable faces if no coplanar clusters found
    if not candidates:
        faces_result = get_stable_faces(model_path)
        for f in faces_result.get("faces", []):
            contact = float(f.get("metrics", {}).get("contact_area", 0))
            overhang = float(f.get("metrics", {}).get("overhang_ratio", 0))
            score = contact * (1.0 - overhang) * 0.5
            candidates.append(
                {
                    "face": {"normal": f.get("normal", [0, 0, 0]), "area": f.get("area", 0)},
                    "score": round(score, 2),
                    "metrics": {
                        "contact_area": contact,
                        "overhang_ratio": overhang,
                        "z_height": f.get("metrics", {}).get("z_height", 0),
                    },
                    "euler_angles_deg": {"x": 0, "y": 0, "z": 0},
                }
            )

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


# ── PrusaSlicer 切片解析 ──


def slice_with_prusaslicer(model_path: str, timeout: int = 30) -> dict:
    """调用 PrusaSlicer CLI 切片并解析 G-code 统计信息。

    Args:
        model_path: STL/3MF 文件路径
        timeout: 超时秒数

    Returns:
        {
            "filament_mm": float,   # 总耗材长度 (mm)
            "filament_cm3": float,  # 总耗材体积 (cm3)
            "print_time_s": int,    # 打印时间 (秒)
            "gcode_lines": int,     # G-code 行数
            "success": bool,
        }
    """
    if not os.path.exists(model_path):
        return {"success": False, "error": "文件不存在"}

    try:
        tmp_gcode = os.path.join(tempfile.gettempdir(), f"p3d_slice_{uuid.uuid4().hex[:8]}.gcode")

        result = subprocess.run(
            [
                "prusa-slicer",
                "--export-gcode",
                "--output",
                tmp_gcode,
                "--center",
                "125,125",
                model_path,
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        if result.returncode != 0 or not os.path.exists(tmp_gcode):
            return {"success": False, "error": result.stderr[:200]}

        # 解析 G-code 头部注释
        filament_mm = 0.0
        filament_cm3 = 0.0
        print_time_s = 0
        gcode_lines = 0

        with open(tmp_gcode, "r") as f:
            for line in f:
                gcode_lines += 1
                m = re.search(r"; filament used \[mm\] = ([\d.]+)", line)
                if m:
                    filament_mm = float(m.group(1))
                m = re.search(r"; filament used \[cm3\] = ([\d.]+)", line)
                if m:
                    filament_cm3 = float(m.group(1))
                m = re.search(r"; estimated printing time \(normal mode\) = (.+)", line)
                if m:
                    time_str = m.group(1).strip()
                    # 解析 "3h 36m 52s" 格式
                    total_seconds = 0
                    hm = re.findall(r"(\d+)h", time_str)
                    mm = re.findall(r"(\d+)m", time_str)
                    ss = re.findall(r"(\d+)s", time_str)
                    if hm:
                        total_seconds += int(hm[0]) * 3600
                    if mm:
                        total_seconds += int(mm[0]) * 60
                    if ss:
                        total_seconds += int(ss[0])
                    if "s" in time_str and not re.search(r"\d+h|\d+m", time_str):
                        # 只有秒数
                        s_only = re.findall(r"(\d+)s", time_str)
                        if s_only:
                            total_seconds = int(s_only[0])
                    print_time_s = total_seconds

        # 清理
        try:
            os.unlink(tmp_gcode)
        except OSError:
            pass

        return {
            "success": True,
            "filament_mm": round(filament_mm, 2),
            "filament_cm3": round(filament_cm3, 2),
            "print_time_s": print_time_s,
            "gcode_lines": gcode_lines,
        }

    except subprocess.TimeoutExpired:
        return {"success": False, "error": "切片超时"}
    except Exception as e:
        return {"success": False, "error": str(e)[:200]}


def _learned_best_face(model_path: str) -> dict:
    """类 OrcaSlicer 自动摆放：多源候选 + 复合评分 + 稳定性检查。

    候选来源（三路）:
      1. coplanar 聚类面 (已有)
      2. 凸包面 + 大面 (get_stable_faces)
      3. Fibonacci 球面采样 (有机形状回退)

    评分公式模仿 OrcaSlicer:
      score = base_area * (1 - overhang_ratio) / max(z_height, 1)

    Args:
        model_path: 模型文件路径

    Returns:
        同 get_best_face_for_slicing() 的返回结构
    """
    import os as _os
    from calculator.orientation_learner import (
        OrientationLearner,
        FaceFeatureExtractor,
    )
    from calculator.orientation_scoring import (
        get_stable_faces,
        evaluate_orientation,
    )

    mesh = _load_mesh(model_path)
    best_overall = None
    best_score = -1e9

    # ── 数据目录 (LR 模型) ──
    data_dir = _os.path.join(
        _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
        "data",
    )
    learner = OrientationLearner(data_dir=data_dir)
    extractor = FaceFeatureExtractor()

    # ── 已使用的 up_vector 去重 ──
    used_ups = set()  # set of (round(x,2), round(y,2), round(z,2))

    def _up_key(v: np.ndarray) -> tuple:
        return tuple(np.round(v / max(float(np.linalg.norm(v)), 1e-9), 2))

    # ── 辅助：给候选面评分 ──
    def _score_candidate(normal: np.ndarray, cluster: dict = None, label: str = "") -> None:
        nonlocal best_overall, best_score
        up = -np.array(normal, dtype=np.float64)
        n_up = float(np.linalg.norm(up))
        if n_up < 1e-8:
            return
        up = up / n_up
        if up[2] < 0:
            up = -up
        key = _up_key(up)
        if key in used_ups:
            return
        used_ups.add(key)

        # 计算旋转 + 评分指标
        R = rotation_from_up_vector(up)
        metrics = evaluate_orientation(mesh, R)
        m = metrics["metrics"]
        z_h = float(m.get("z_height", 1))
        o_r = float(m.get("overhang_ratio", 1))
        c_a = float(m.get("base_contact_area", 0))

        # ── 类 OrcaSlicer 复合评分 ──
        # 核心: 接触面积^1.5(越大越好) × (1-悬垂)²(越少越好) / z_height(越矮越好)
        # 接触面积是 FDM 成败的第一要素
        score = (c_a**1.5) * ((1.0 - o_r) ** 2) / max(z_h, 1.0)

        # ── 最小接触面积过滤 (拒绝接触面积过小的朝向) ──
        bottom_area = c_a
        if bottom_area < 200:  # <200mm² 接触面太小，打印必倒
            return
        if bottom_area < 500:
            score *= 0.3  # <500mm² 很小，重罚

        # ── LR 模型加分 (仅 coplanar 面有, 当前样本不足仅微调) ──
        lr_prob = None
        if cluster is not None and learner.is_trained():
            try:
                feat = extractor.extract(mesh, cluster)
                feat_batch = feat.reshape(1, -1)
                prob = float(learner.predict_proba(feat_batch)[0])
                lr_prob = prob
                # LR 模型作为微弱 bonus: 最多加 5% (当前仅 20 正样本)
                score *= 0.95 + 0.05 * prob
            except Exception:
                pass

        # ── 稳定性检查 (CoG 在底面凸包内) ──
        stable = True
        try:
            vertices_r = np.asarray(mesh.vertices, dtype=np.float64) @ R[:3, :3].T
            z_all = vertices_r[:, 2]
            z_min = float(z_all.min())
            eps_b = max(0.5, z_h * 0.02)
            bottom_mask = z_all < z_min + eps_b
            bottom_xy = vertices_r[bottom_mask, :2]
            if len(bottom_xy) >= 3:
                cog = np.asarray(mesh.center_mass, dtype=np.float64) @ R[:3, :3].T
                cog_xy = cog[:2]
                from scipy.spatial import ConvexHull, Delaunay

                hull = ConvexHull(bottom_xy)
                tri = Delaunay(bottom_xy[hull.vertices])
                stable = tri.find_simplex(cog_xy) >= 0
                if not stable:
                    score *= 0.8
        except Exception:
            pass

        candidate = {
            "face": cluster or {"normal": normal.tolist(), "area": 0},
            "score": round(score, 4),
            "metrics": m,
            "euler_angles_deg": metrics["euler_angles_deg"],
            "learned_prob": lr_prob,
            "label": label,
            "stable": stable,
        }

        if score > best_score:
            best_score = score
            best_overall = candidate

    # ══════════════════════════════════════════════
    # 候选源 1: coplanar 聚类面
    # ══════════════════════════════════════════════
    try:
        clusters = cluster_coplanar_faces(mesh)
        for i, cluster in enumerate(clusters):
            normal = np.array(cluster.get("normal", [0, 0, 1]), dtype=np.float64)
            _score_candidate(normal, cluster=cluster, label=f"共面_{i}")
    except Exception as e:
        logger.warning("coplanar 聚类失败: %s", e)

    # ══════════════════════════════════════════════
    # 候选源 2: 凸包面 + 大面 (get_stable_faces)
    # ══════════════════════════════════════════════
    try:
        stable_result = get_stable_faces(model_path)
        for face in stable_result.get("faces", []):
            normal = np.array(face.get("normal", [0, 0, 1]), dtype=np.float64)
            _score_candidate(normal, label=face.get("label", "稳定面"))
    except Exception as e:
        logger.warning("get_stable_faces 失败: %s", e)

    # ══════════════════════════════════════════════
    # 候选源 3: Fibonacci 球面采样 (稠密覆盖)
    # ══════════════════════════════════════════════
    try:
        from calculator.orientation_math import fibonacci_sphere_sampling

        samples = fibonacci_sphere_sampling(128)
        for i in range(samples.shape[0]):
            normal = samples[i].copy()
            _score_candidate(normal, label=f"采样_{i}")
            if len(used_ups) >= 200:  # 上限
                break
    except Exception as e:
        logger.warning("Fibonacci 采样失败: %s", e)

    # ── 无候选回退 ──
    if best_overall is None:
        logger.warning("所有候选源均无结果，返回原始朝向")
        return {
            "oriented_path": model_path,
            "original_path": model_path,
            "rotation_matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            "euler_angles_deg": {"x": 0, "y": 0, "z": 0},
            "score": 0,
            "face": None,
            "all_candidates": [],
            "method_used": "learned",
            "fallback": True,
        }

    logger.info(
        "智能摆放: 候选 %d 个, 最佳得分=%.2f (label=%s, 稳定=%s, lr=%s)",
        len(used_ups),
        best_score,
        best_overall.get("label"),
        best_overall.get("stable"),
        best_overall.get("learned_prob"),
    )

    # ══════════════════════════════════════════════
    # PrusaSlicer 精确验证: 对前 3 候选做真实切片
    # ══════════════════════════════════════════════
    # 收集所有候选，取前 3
    # (由于 _score_candidate 直接更新 best_overall，我们重新收集)
    # 用 fast_score 收集到的最近 50 个 = used_ups 数量
    # 简化: 只对 best_overall 做切片验证（1次切片 ~0.5-2秒）
    prusa_info = {}
    prusa_normal = np.array(best_overall["face"]["normal"], dtype=np.float64)
    try:
        up_tmp = -prusa_normal
        n_tmp = float(np.linalg.norm(up_tmp))
        if n_tmp > 1e-8:
            up_tmp = up_tmp / n_tmp
            if up_tmp[2] < 0:
                up_tmp = -up_tmp
        R_tmp = rotation_from_up_vector(up_tmp)
        # 微调前的旋转
        tune_tmp = fine_tune_orientation(mesh, R_tmp[:3, :3])
        R_final = tune_tmp["R"]
        # 导出临时 STL
        tmp_rotated = os.path.join(tempfile.gettempdir(), f"p3d_orient_{uuid.uuid4().hex[:8]}.stl")
        mesh_rotated = mesh.copy()
        mesh_rotated.vertices = np.asarray(mesh.vertices) @ R_final.T
        mesh_rotated.export(tmp_rotated)
        # PrusaSlicer 切片
        slice_result = slice_with_prusaslicer(tmp_rotated, timeout=30)
        if slice_result["success"]:
            prusa_info = slice_result
            logger.info(
                "PrusaSlicer 验证: filament=%.1fmm, time=%ds",
                slice_result["filament_mm"],
                slice_result["print_time_s"],
            )
        # 清理
        try:
            os.unlink(tmp_rotated)
        except OSError:
            pass
    except Exception as e:
        logger.warning("PrusaSlicer 验证失败: %s", e)

    # ── 应用最佳旋转 + 导出（跳过 Z 轴微调，无实际意义） ──
    best_normal = np.array(best_overall["face"]["normal"], dtype=np.float64)
    up = -best_normal
    n_up = float(np.linalg.norm(up))
    if n_up < 1e-8:
        up = np.array([0.0, 0.0, 1.0])
    else:
        up = up / n_up
        if up[2] < 0:
            up = -up

    R = rotation_from_up_vector(up)
    R_opt = R[:3, :3]
    euler = rotation_to_euler(R_opt)

    oriented_path = apply_orientation_to_mesh(model_path, R_opt)

    result = {
        "oriented_path": oriented_path,
        "original_path": model_path,
        "rotation_matrix": [[round(float(R_opt[i, j]), 6) for j in range(3)] for i in range(3)],
        "euler_angles_deg": euler,
        "score": best_overall["score"],
        "face": best_overall["face"],
        "tune_report": "方向已最优（Z轴归零）",
        "all_candidates": [],
        "method_used": "learned",
        "fallback": False,
        "n_candidates": len(used_ups),
        "best_label": best_overall.get("label", ""),
    }
    if prusa_info.get("success"):
        result["prusa"] = prusa_info
    return result
