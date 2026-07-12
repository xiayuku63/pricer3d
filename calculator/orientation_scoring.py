"""Orientation scoring, evaluation, and stable-face discovery.

Evaluates how good a candidate print orientation is by computing
overhang ratio, support volume, print time, and bed adhesion.
"""

import math
import os
import subprocess
import logging
import numpy as np
import trimesh

from calculator.orientation_math import (
    rodrigues_rotation,
    rotation_to_euler,
    rotation_from_up_vector,
    fibonacci_sphere_sampling,
)

logger = logging.getLogger(__name__)

# ── 可调参数 ──
OVERHANG_ANGLE_DEG = 45.0
NUM_FIBONACCI_SAMPLES = 64
NUM_LARGE_FACE_SAMPLES = 8
TOP_N_RESULTS = 5
SUPPORT_WEIGHT = 0.50
TIME_WEIGHT = 0.30
ADHESION_WEIGHT = 0.20
FINE_TUNE_Z_RANGE = (-30, 30)
FINE_TUNE_STEP = 1.0


def _score_orientation_3x3(mesh: trimesh.Trimesh, R: np.ndarray) -> dict:
    """Quick-scoring of a 3x3 rotation on the mesh (no full reconstruction)."""
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    rotated_verts = vertices @ R.T
    rotated_normals = np.asarray(mesh.face_normals, dtype=np.float64) @ R.T
    face_areas = np.asarray(mesh.area_faces, dtype=np.float64)
    total_area = float(np.sum(face_areas))
    if total_area < 1e-9:
        return {"overhang_ratio": 1.0, "contact_area": 0.0, "z_height": 0.0, "support_volume": 0.0}

    z_all = rotated_verts[:, 2]
    z_min = float(z_all.min())
    z_max = float(z_all.max())
    z_height = z_max - z_min

    dot_z = rotated_normals[:, 2]
    threshold_cos = math.cos(math.radians(OVERHANG_ANGLE_DEG))
    overhang_mask = (dot_z < 0.0) & (-dot_z > threshold_cos)
    overhang_area = float(np.sum(face_areas[overhang_mask]))
    overhang_ratio = overhang_area / total_area

    bottom_mask = dot_z < -0.95
    contact_area = float(np.sum(face_areas[bottom_mask]))

    support_volume = 0.0
    if overhang_area > 1e-9:
        try:
            tri_centers = mesh.triangles_center[overhang_mask]
            tri_centers_rot = tri_centers @ R.T
            heights = tri_centers_rot[:, 2] - z_min
            support_volume = float(np.sum(face_areas[overhang_mask] * np.maximum(heights, 0.0))) * 0.3
        except Exception:
            support_volume = overhang_area * z_height * 0.3

    return {
        "overhang_ratio": round(overhang_ratio, 6),
        "contact_area": round(contact_area, 2),
        "z_height": round(z_height, 2),
        "support_volume": round(support_volume, 2),
        "overhang_area": round(overhang_area, 2),
    }


def fine_tune_orientation(
    mesh: trimesh.Trimesh,
    R_base: np.ndarray,
    z_range: tuple = FINE_TUNE_Z_RANGE,
    step: float = FINE_TUNE_STEP,
) -> dict:
    """Fine-tune orientation by rotating ±30° around Z-axis to minimize overhangs."""
    best_overhang = float("inf")
    best_contact = 0.0
    best_angle = 0.0
    best_R = R_base
    best_metrics = None

    for angle_deg in np.arange(z_range[0], z_range[1] + step * 0.5, step):
        angle_rad = math.radians(float(angle_deg))
        R_z = rodrigues_rotation(np.array([0.0, 0.0, 1.0]), angle_rad)
        R_candidate = R_z @ R_base

        m = _score_orientation_3x3(mesh, R_candidate)
        overhang = m["overhang_ratio"]
        contact = m["contact_area"]

        # FDM flatness constraint: bottom face must be a real flat plane
        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        rotated_verts = vertices @ R_candidate.T
        z_all = rotated_verts[:, 2]
        z_min = float(z_all.min())
        z_range_val = float(z_all.max()) - z_min
        eps_flat = max(z_range_val * 0.005, 0.05)
        bottom_mask = z_all < z_min + eps_flat
        bottom_z = z_all[bottom_mask]
        if len(bottom_z) >= 3:
            z_variance = float(np.var(bottom_z))
            if z_variance >= 0.1:
                continue

        improved = False
        if overhang < best_overhang - 1e-6:
            improved = True
        elif abs(overhang - best_overhang) < 1e-6 and contact > best_contact + 1e-3:
            improved = True

        if improved:
            best_overhang = overhang
            best_contact = contact
            best_angle = float(angle_deg)
            best_R = R_candidate
            best_metrics = m

    if best_metrics is None:
        best_metrics = _score_orientation_3x3(mesh, R_base)

    report_parts = []
    if abs(best_angle) > 0.01:
        report_parts.append("绕Z轴微调{:.0f}度".format(best_angle))
        if best_metrics["overhang_ratio"] < 0.01:
            report_parts.append("消除悬垂")
        else:
            report_parts.append("降低悬垂面积")
    else:
        report_parts.append("保持对齐方向，悬垂已最小")

    return {
        "R": best_R,
        "angle": round(best_angle, 1),
        "metrics": best_metrics,
        "report": "，".join(report_parts) if "".join(report_parts) else "方向已最优",
    }


def evaluate_orientation(mesh: trimesh.Trimesh, rotation: np.ndarray) -> dict:
    """Full evaluation of a candidate orientation: score + detailed metrics."""
    rotated_points = mesh.vertices @ rotation[:3, :3].T + rotation[:3, 3]
    rotated_faces = mesh.faces
    rotated = trimesh.Trimesh(
        vertices=rotated_points,
        faces=rotated_faces,
        process=False,
        validate=False,
    )
    rotated.remove_unreferenced_vertices()

    min_z = float(rotated.bounds[0, 2])
    if abs(min_z) > 1e-6:
        translate = np.eye(4)
        translate[2, 3] = -min_z
        rotated.apply_transform(translate)

    face_normals = rotated.face_normals
    face_areas = rotated.area_faces
    total_area = float(np.sum(face_areas))
    bounds = rotated.bounds
    z_height = float(bounds[1, 2] - bounds[0, 2])

    dot_z = face_normals[:, 2]
    threshold_cos = math.cos(math.radians(OVERHANG_ANGLE_DEG))
    overhang_mask = (dot_z < 0) & (-dot_z > threshold_cos)
    overhang_area = float(np.sum(face_areas[overhang_mask]))
    overhang_ratio = overhang_area / max(total_area, 1e-9)

    support_volume = 0.0
    if np.any(overhang_mask):
        centroids = rotated.triangles_center[overhang_mask]
        heights = centroids[:, 2]
        support_volume = float(np.sum(face_areas[overhang_mask] * np.maximum(heights, 0.0))) * 0.3

    xy_area = float(np.sum(face_areas * np.abs(dot_z)))

    base_mask = dot_z < -0.95
    base_area = float(np.sum(face_areas[base_mask]))

    contact_area = base_area
    try:
        hull = rotated.convex_hull
        if hull is not None and isinstance(hull, trimesh.Trimesh):
            hull_verts = hull.vertices[hull.faces]
            hull_z_centers = hull_verts[:, :, 2].mean(axis=1)
            z_min_hull = float(hull.bounds[0, 2])
            bottom_mask_hull = hull_z_centers < z_min_hull + z_height * 0.05
            hull_areas = hull.area_faces
            contact_area = float(np.sum(hull_areas[bottom_mask_hull]))
    except Exception:
        contact_area = base_area

    support_score = max(0.0, (1.0 - overhang_ratio) * 100.0)
    avg_dim = float((bounds[1] - bounds[0]).mean())
    z_ratio = z_height / max(avg_dim, 1e-9)
    time_score = max(0.0, 100.0 * (1.0 - max(0.0, z_ratio - 0.3) / 1.7))
    max_contact = total_area * 0.5
    adhesion_score = min(100.0, contact_area / max(max_contact, 1e-9) * 100.0)

    overall = support_score * SUPPORT_WEIGHT + time_score * TIME_WEIGHT + adhesion_score * ADHESION_WEIGHT

    return {
        "score": round(overall, 2),
        "metrics": {
            "overhang_area": round(overhang_area, 2),
            "overhang_ratio": round(overhang_ratio, 4),
            "support_volume_estimate": round(support_volume, 2),
            "z_height": round(z_height, 2),
            "base_contact_area": round(contact_area, 2),
            "xy_footprint": round(xy_area, 2),
            "support_score": round(support_score, 2),
            "time_score": round(time_score, 2),
            "adhesion_score": round(adhesion_score, 2),
        },
        "rotation_matrix": rotation.tolist(),
        "euler_angles_deg": rotation_to_euler(rotation),
    }


def get_stable_faces(model_path: str) -> dict:
    """Find candidate stable faces on a model for lay-on-face placement.

    Searches via three strategies (in order):
    1. Largest faces by area
    2. Convex hull faces
    3. Fibonacci sphere sampling (fallback for organic shapes)
    """
    _tmp = None
    ext = os.path.splitext(model_path)[1].lower()
    if ext in (".stp", ".step"):
        import tempfile as _tempfile

        fd, _tmp = _tempfile.mkstemp(suffix=".stl", prefix="p3d_stable_")
        os.close(fd)
        result = subprocess.run(
            ["prusa-slicer", "--export-stl", "--output", _tmp, model_path],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0 or not os.path.exists(_tmp):
            if _tmp and os.path.exists(_tmp):
                os.unlink(_tmp)
            return {"faces": []}
        load_path = _tmp
    else:
        load_path = model_path

    try:
        mesh = trimesh.load(load_path, force="mesh")
    finally:
        if _tmp and os.path.exists(_tmp):
            try:
                os.unlink(_tmp)
            except OSError:
                pass

    if isinstance(mesh, trimesh.Scene):
        meshes = mesh.dump()
        mesh = trimesh.util.concatenate(meshes)
    if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
        return {"faces": []}

    if not hasattr(mesh, "face_normals") or mesh.face_normals is None or len(mesh.face_normals) == 0:
        mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=True, validate=True)

    used_up_keys = set()
    faces_result = []

    def _add_face(face_idx: int, normal: np.ndarray, area: float, label: str, face_vertices: np.ndarray):
        up = -normal
        norm_val = float(np.linalg.norm(up))
        if norm_val < 1e-8:
            return
        up = up / norm_val
        if up[2] < 0:
            up = -up
        key = tuple(np.round(up, 2))
        if key in used_up_keys:
            return
        used_up_keys.add(key)
        R = rotation_from_up_vector(up)
        metrics_result = evaluate_orientation(mesh, R)
        vertices = [[round(float(v[0]), 6), round(float(v[1]), 6), round(float(v[2]), 6)] for v in face_vertices]
        faces_result.append(
            {
                "face_index": int(face_idx),
                "normal": normal.tolist(),
                "area": round(float(area), 4),
                "up_vector": up.tolist(),
                "label": label,
                "vertices": vertices,
                "metrics": {
                    "contact_area": round(metrics_result["metrics"]["base_contact_area"], 2),
                    "overhang_ratio": round(metrics_result["metrics"]["overhang_ratio"], 4),
                    "z_height": round(metrics_result["metrics"]["z_height"], 2),
                },
            }
        )

    try:
        areas = mesh.area_faces
        normals = mesh.face_normals
        sorted_idx = np.argsort(-areas)
        seen = set()
        for idx in sorted_idx:
            n = normals[idx]
            rkey = tuple(np.round(n, 2))
            if rkey in seen:
                continue
            seen.add(rkey)
            _add_face(int(idx), n, areas[idx], "大面_{}".format(len(seen)), mesh.vertices[mesh.faces[idx]])
            if len(seen) >= NUM_LARGE_FACE_SAMPLES * 2:
                break
    except Exception as e:
        logger.debug("get_stable_faces 大面提取失败: %s", e)

    try:
        hull = mesh.convex_hull
        if hull is not None:
            h_areas = hull.area_faces
            h_normals = hull.face_normals
            sorted_idx = np.argsort(-h_areas)
            seen_h = set()
            for idx in sorted_idx:
                n = h_normals[idx]
                rkey = tuple(np.round(n, 2))
                if rkey in seen_h:
                    continue
                seen_h.add(rkey)
                _add_face(int(idx), n, h_areas[idx], "凸包面_{}".format(len(seen_h)), hull.vertices[hull.faces[idx]])
                if len(seen_h) >= 6:
                    break
    except Exception as e:
        logger.debug("get_stable_faces 凸包提取失败: %s", e)

    if len(faces_result) < 6:
        fib = fibonacci_sphere_sampling(NUM_FIBONACCI_SAMPLES)
        for i in range(fib.shape[0]):
            up = fib[i].copy()
            if up[2] < 0:
                up = -up
            key = tuple(np.round(up, 2))
            if key in used_up_keys:
                continue
            used_up_keys.add(key)
            try:
                R = rotation_from_up_vector(up)
                rv = mesh.vertices[:, :3] @ R[:3, :3].T
                z_all = rv[:, 2]
                z_min = float(z_all.min())
                z_max = float(z_all.max())
                z_range = z_max - z_min
                if z_range <= 0:
                    z_range = 1.0
                eps = z_range * 0.02
                bot_mask = z_all < z_min + eps
                bot = rv[bot_mask]
                if bot.shape[0] < 3:
                    continue
                x_min = float(bot[:, 0].min())
                x_max = float(bot[:, 0].max())
                y_min = float(bot[:, 1].min())
                y_max = float(bot[:, 1].max())
                z_plane = z_min
                fv = np.array(
                    [
                        [x_min, y_min, z_plane],
                        [x_max, y_min, z_plane],
                        [x_max, y_max, z_plane],
                        [x_min, y_max, z_plane],
                    ],
                    dtype=float,
                )
                fv_orig = fv @ R[:3, :3]
                normal_rot = np.array([0.0, 0.0, -1.0])
                normal_orig = normal_rot @ R[:3, :3]
                poly_area = (x_max - x_min) * (y_max - y_min)
                verts_list = [[round(float(v[0]), 6), round(float(v[1]), 6), round(float(v[2]), 6)] for v in fv_orig]
                faces_result.append(
                    {
                        "face_index": -1,
                        "normal": normal_orig.tolist(),
                        "area": round(poly_area, 4),
                        "up_vector": up.tolist(),
                        "label": "采样面_{}".format(len(faces_result) + 1),
                        "vertices": verts_list,
                        "metrics": {
                            "contact_area": round(poly_area, 2),
                            "overhang_ratio": 0.0,
                            "z_height": round(z_range, 2),
                        },
                    }
                )
            except Exception as e:
                logger.debug("Fibonacci fallback face %d failed: %s", i, e)
                continue
            if len(faces_result) >= 12:
                break

    return {"faces": faces_result}
