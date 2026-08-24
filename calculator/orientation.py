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
import math
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
    rotation_from_bed_normal,
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
    get_convex_hull_candidate_planes,
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
    "rotation_from_bed_normal",
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
    """Load a supported model through the shared normalization pipeline.

    Orientation operations need the same triangulated STL representation as
    preview, geometry calculation, and slicing.  In particular, trimesh does
    not provide a reliable STEP loader and direct 3MF loading can preserve a
    scene instead of the assembled build geometry.  Normalizing here keeps
    smart placement and the manual lay-on-face flow consistent for STL, 3MF,
    and STEP files.
    """
    from parser.model_pipeline import ModelNormalizationError, normalize_model

    normalized = None
    try:
        normalized = normalize_model(model_path)
        mesh = trimesh.load(normalized.mesh_path, force="mesh")
        if isinstance(mesh, trimesh.Scene):
            meshes = mesh.dump()
            mesh = trimesh.util.concatenate(meshes)
        if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
            raise ValueError("model could not be loaded: {}".format(model_path))
        if not hasattr(mesh, "face_normals") or mesh.face_normals is None or len(mesh.face_normals) == 0:
            mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=True, validate=True)
        return mesh
    except ModelNormalizationError:
        raise
    finally:
        if normalized is not None:
            normalized.cleanup()


def _rotation_for_bed_candidate(
    mesh: trimesh.Trimesh,
    normal: np.ndarray,
    face_vertices: Optional[Sequence[Sequence[float]]] = None,
) -> np.ndarray:
    """Choose the normal sign that puts the selected geometric face on the bed.

    STL winding is not reliable.  When candidate face points are available,
    evaluate both normal directions and retain the rotation for which the whole
    selected face is closest to the model's global minimum Z plane.
    """
    normal = np.asarray(normal, dtype=np.float64)
    if float(np.linalg.norm(normal)) < 1e-8:
        return np.eye(4)

    primary = rotation_from_bed_normal(normal)
    if face_vertices is None:
        return primary

    points = np.asarray(face_vertices, dtype=np.float64)
    if points.ndim != 2 or points.shape[0] < 3 or points.shape[1] < 3:
        return primary
    points = points[:, :3]
    mesh_vertices = np.asarray(mesh.vertices, dtype=np.float64)

    def face_gap(rotation: np.ndarray) -> float:
        R3 = rotation[:3, :3]
        model_min_z = float((mesh_vertices @ R3.T)[:, 2].min())
        face_z = (points @ R3.T)[:, 2]
        return float(np.max(np.abs(face_z - model_min_z)))

    opposite = rotation_from_bed_normal(-normal)
    return min((primary, opposite), key=face_gap)


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

    R_align = rotation_from_bed_normal(face_normal)[:3, :3]

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
    from parser.model_pipeline import normalize_model

    normalized = normalize_model(model_path)
    try:
        mesh = trimesh.load(normalized.mesh_path, force="mesh")

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
        normalized.cleanup()


def get_smart_orientation_for_slicing(model_path: str) -> dict:
    """Run the canonical smart-placement strategy used by preview and quoting.

    Results are content-address cached (calculator.orientation_cache): the
    hull-clustering + candidate scoring costs seconds and is deterministic
    for identical geometry, so re-quotes with different print params skip it.
    """
    from calculator.orientation_cache import orientation_cache_lookup, orientation_cache_store

    cached = orientation_cache_lookup(model_path)
    if cached is not None:
        logger.info("朝向缓存命中: %s", os.path.basename(model_path))
        return cached
    result = get_best_face_for_slicing(model_path, method="geometry_v2")
    orientation_cache_store(model_path, result)
    return result


def get_best_face_for_slicing(
    model_path: str,
    method: str = "coplanar",
    sa_config: Optional[dict] = None,
) -> dict:
    """Auto-select a print orientation using geometry V2, coplanar, or SA.

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
        method: "geometry_v2"/"auto" for the fast automatic strategy,
                "coplanar" for the legacy strategy, or "sa".
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

    if method in {"learned", "geometry_v2", "auto"}:
        return _geometry_best_face(model_path)

    mesh = _load_mesh(model_path)

    # Step 1: coplanar clustering
    coplanar_clusters = cluster_coplanar_faces(mesh)

    # Step 2: score each cluster
    candidates = []
    for cluster in coplanar_clusters:
        normal = np.array(cluster["normal"], dtype=np.float64)
        if float(np.linalg.norm(normal)) < 1e-8:
            continue
        R = _rotation_for_bed_candidate(mesh, normal, cluster.get("face_vertices"))
        eval_result = evaluate_orientation(mesh, R)
        candidates.append(
            {
                "face": cluster,
                "score": eval_result["score"],
                "metrics": eval_result["metrics"],
                "euler_angles_deg": eval_result["euler_angles_deg"],
                "rotation_matrix": R[:3, :3].tolist(),
            }
        )

    # Step 3: fallback to stable faces if no coplanar clusters found
    if not candidates:
        faces_result = get_stable_faces(model_path)
        for f in faces_result.get("faces", []):
            contact = float(f.get("metrics", {}).get("contact_area", 0))
            overhang = float(f.get("metrics", {}).get("overhang_ratio", 0))
            score = contact * (1.0 - overhang) * 0.5
            fallback_normal = np.asarray(f.get("normal", [0, 0, 0]), dtype=np.float64)
            fallback_rotation = _rotation_for_bed_candidate(mesh, fallback_normal, f.get("vertices"))
            candidates.append(
                {
                    "face": {"normal": fallback_normal.tolist(), "area": f.get("area", 0)},
                    "score": round(score, 2),
                    "metrics": {
                        "contact_area": contact,
                        "overhang_ratio": overhang,
                        "z_height": f.get("metrics", {}).get("z_height", 0),
                    },
                    "euler_angles_deg": rotation_to_euler(fallback_rotation),
                    "rotation_matrix": fallback_rotation[:3, :3].tolist(),
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

    # Step 5: compute rotation + fine-tune + export
    R = np.asarray(best.get("rotation_matrix"), dtype=np.float64)
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


def _geometry_best_face(model_path: str) -> dict:
    """Fully automatic, slicer-free orientation ranking.

    The optimizer evaluates exterior planar faces first, then principal axes and
    a small spherical fallback only when the model has no useful flat contact.
    Scores combine effective overhang/support demand, bed adhesion, CoG stability,
    and print height.  No real slicing is performed, keeping response time bounded.
    """
    from calculator.orientation_scoring import evaluate_orientation

    mesh = _load_mesh(model_path)
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    model_diag = max(float(np.linalg.norm(np.ptp(vertices, axis=0))), 1e-9)
    model_volume = max(abs(float(mesh.volume)), model_diag**3 * 1e-6, 1.0)

    candidates_by_rotation: dict[tuple, dict] = {}

    def _clamp01(value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    def _score_components(metrics: dict) -> dict:
        contact_area = max(float(metrics.get("base_contact_area", 0.0)), 0.0)
        footprint_area = max(float(metrics.get("xy_footprint", 0.0)), 1e-9)
        contact_ratio = _clamp01(contact_area / footprint_area)
        adhesion = math.sqrt(contact_ratio)

        margin = float(metrics.get("stability_margin", -1e9))
        cog_height = max(float(metrics.get("cog_height", 0.0)), 1e-9)
        stability_target = max(cog_height * 0.25, model_diag * 0.02, 0.1)
        stability = 0.0 if margin < 0 else _clamp01(margin / stability_target)

        overhang_ratio = max(float(metrics.get("overhang_ratio", 1.0)), 0.0)
        overhang_quality = 1.0 - _clamp01(overhang_ratio / 0.35)
        support_volume = max(float(metrics.get("support_volume_estimate", 0.0)), 0.0)
        support_volume_quality = 1.0 - _clamp01(support_volume / max(model_volume * 0.5, 1.0))
        support_islands = max(int(metrics.get("support_island_count", 0)), 0)
        support_island_quality = 1.0 / (1.0 + math.log1p(support_islands) * 0.5)
        support = (
            overhang_quality * 0.45
            + support_volume_quality * 0.40
            + support_island_quality * 0.15
        )

        z_height = max(float(metrics.get("z_height", model_diag)), 0.0)
        height = 1.0 - _clamp01(z_height / model_diag)
        total = (
            support * 0.42
            + adhesion * 0.26
            + stability * 0.22
            + height * 0.10
        )
        if not bool(metrics.get("stable", False)):
            total *= 0.35
        if contact_area <= max(model_diag * model_diag * 1e-8, 1e-5):
            total *= 0.25
        return {
            "support": support,
            "adhesion": adhesion,
            "stability": stability,
            "height": height,
            "total": total,
        }

    def _add_candidate(
        *,
        label: str,
        normal: Optional[np.ndarray] = None,
        rotation: Optional[np.ndarray] = None,
        face: Optional[dict] = None,
        face_vertices: Optional[Sequence[Sequence[float]]] = None,
    ) -> None:
        if rotation is None:
            if normal is None:
                return
            normal = np.asarray(normal, dtype=np.float64)
            if float(np.linalg.norm(normal)) < 1e-8:
                return
            rotation = _rotation_for_bed_candidate(mesh, normal, face_vertices)
        R3 = np.asarray(rotation, dtype=np.float64)[:3, :3]
        key = tuple(np.round(R3.reshape(-1), 5))

        evaluated = evaluate_orientation(mesh, R3, include_support_islands=False)
        metrics = evaluated["metrics"]
        components = _score_components(metrics)
        candidate_face = face or {
            "normal": np.asarray(normal if normal is not None else [0, 0, 0], dtype=float).tolist(),
            "area": 0.0,
        }
        candidate = {
            "face": candidate_face,
            "score": round(components["total"] * 100.0, 4),
            "score_components": {k: round(v * 100.0, 2) for k, v in components.items() if k != "total"},
            "metrics": metrics,
            "euler_angles_deg": evaluated["euler_angles_deg"],
            "learned_prob": None,
            "label": label,
            "stable": bool(metrics.get("stable", False)),
            "rotation_matrix": R3.tolist(),
        }
        existing = candidates_by_rotation.get(key)
        if existing is None or candidate["score"] > existing["score"]:
            candidates_by_rotation[key] = candidate
        elif existing.get("face", {}).get("area", 0) == 0 and candidate_face.get("area", 0) > 0:
            existing["face"] = candidate_face
            existing["label"] = label

    # Preserve the uploaded orientation as a valid baseline.
    _add_candidate(label="source", rotation=np.eye(3), face={"normal": [0, 0, -1], "area": 0.0})

    # Automatic placement only needs supporting planes of the convex hull.
    # This is substantially faster than the full interactive coplanar workflow.
    hull_planes = get_convex_hull_candidate_planes(mesh, max_planes=32)
    for index, plane in enumerate(hull_planes):
        normal = np.asarray(plane.get("normal", [0, 0, 1]), dtype=np.float64)
        _add_candidate(label=f"hull_{index}", normal=normal, face=plane)

    # Principal inertia axes provide six meaningful fallback directions for
    # rounded or organic models at negligible cost.
    try:
        axes = np.asarray(mesh.principal_inertia_vectors, dtype=np.float64)
        for axis_index, axis in enumerate(axes):
            for sign in (-1.0, 1.0):
                normal = axis * sign
                _add_candidate(label=f"principal_{axis_index}_{'pos' if sign > 0 else 'neg'}", normal=normal)
    except Exception as exc:
        logger.debug("principal-axis candidates unavailable: %s", exc)

    candidates = list(candidates_by_rotation.values())
    useful_contact = max(
        (
            float(item["metrics"].get("base_contact_area", 0.0))
            / max(float(item["metrics"].get("xy_footprint", 0.0)), 1e-9)
            for item in candidates
        ),
        default=0.0,
    )

    # Dense sampling is only needed when no useful plane/axis contact exists.
    if len(candidates) < 6 or useful_contact < 0.01:
        for index, normal in enumerate(fibonacci_sphere_sampling(32)):
            _add_candidate(label=f"sample_{index}", normal=normal)
        candidates = list(candidates_by_rotation.values())

    candidates.sort(key=lambda item: item["score"], reverse=True)

    # Support-component counting is the most expensive per-candidate metric.
    # Recompute it only for a coarse shortlist, then perform the final ranking.
    total_candidate_count = len(candidates)
    shortlist_size = min(12, total_candidate_count)
    finalists = candidates[:shortlist_size]
    for candidate in finalists:
        R3 = np.asarray(candidate["rotation_matrix"], dtype=np.float64)
        evaluated = evaluate_orientation(mesh, R3, include_support_islands=True)
        candidate["metrics"] = evaluated["metrics"]
        candidate["euler_angles_deg"] = evaluated["euler_angles_deg"]
        components = _score_components(candidate["metrics"])
        candidate["score"] = round(components["total"] * 100.0, 4)
        candidate["score_components"] = {
            key: round(value * 100.0, 2)
            for key, value in components.items()
            if key != "total"
        }
    finalists.sort(key=lambda item: item["score"], reverse=True)
    candidates = finalists
    if not candidates:
        return {
            "oriented_path": model_path,
            "original_path": model_path,
            "rotation_matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            "euler_angles_deg": {"x": 0, "y": 0, "z": 0},
            "score": 0,
            "face": None,
            "all_candidates": [],
            "method_used": "geometry_v2",
            "fallback": True,
        }

    best = candidates[0]
    R_opt = np.asarray(best["rotation_matrix"], dtype=np.float64)
    oriented_path = apply_orientation_to_mesh(model_path, R_opt)

    def _compact_face(face: dict) -> dict:
        return {
            key: face[key]
            for key in ("normal", "area", "face_count", "centroid", "bbox_size", "stability")
            if key in face
        }

    top_candidates = []
    for item in candidates[:TOP_N_RESULTS]:
        public_item = dict(item)
        public_item["face"] = _compact_face(item.get("face") or {})
        top_candidates.append(public_item)
    best_face = _compact_face(best.get("face") or {})
    logger.info(
        "geometry_v2 orientation: candidates=%d best=%.2f label=%s support=%.1f adhesion=%.1f stability=%.1f",
        len(candidates),
        best["score"],
        best["label"],
        best["score_components"]["support"],
        best["score_components"]["adhesion"],
        best["score_components"]["stability"],
    )
    return {
        "oriented_path": oriented_path,
        "original_path": model_path,
        "rotation_matrix": [[round(float(R_opt[i, j]), 6) for j in range(3)] for i in range(3)],
        "euler_angles_deg": rotation_to_euler(R_opt),
        "score": best["score"],
        "face": best_face,
        "tune_report": "Geometry-only optimization across support, adhesion, stability, and height",
        "all_candidates": top_candidates,
        "method_used": "geometry_v2",
        "fallback": False,
        "n_candidates": total_candidate_count,
        "best_label": best["label"],
        "score_components": best["score_components"],
        "metrics": best["metrics"],
    }
