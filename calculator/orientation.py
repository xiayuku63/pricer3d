"""3D打印件智能方向优化 — orientation optimizer.

分析 STL/3MF 模型文件，根据用户指定的"放置平面"自动确定最佳打印朝向。

Usage:
    from calculator.orientation import analyze_orientation, get_stable_faces
    result = analyze_orientation("model.stl", face_normal=[0, 0, 1])
"""

import math
import os
import logging
import numpy as np
import trimesh
from typing import Optional, Union, Sequence

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


def fibonacci_sphere_sampling(n: int) -> np.ndarray:
    points = np.zeros((n, 3))
    phi = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        y = 1.0 - (i / max(n - 1, 1)) * 2.0
        r = math.sqrt(1.0 - y * y)
        theta = phi * i
        points[i] = [r * math.cos(theta), r * math.sin(theta), y]
    return points


def rodrigues_rotation(axis: np.ndarray, angle: float) -> np.ndarray:
    axis = np.asarray(axis, dtype=np.float64)
    axis_norm = float(np.linalg.norm(axis))
    if axis_norm < 1e-12:
        return np.eye(3)
    axis = axis / axis_norm
    K = np.array([
        [0.0, -axis[2], axis[1]],
        [axis[2], 0.0, -axis[0]],
        [-axis[1], axis[0], 0.0],
    ], dtype=np.float64)
    c = math.cos(angle)
    s = math.sin(angle)
    R = np.eye(3, dtype=np.float64) + s * K + (1.0 - c) * (K @ K)
    return R


def align_face_to_z(normal: np.ndarray) -> np.ndarray:
    normal = np.asarray(normal, dtype=np.float64)
    n2 = float(np.linalg.norm(normal))
    if n2 < 1e-12:
        return np.eye(3)
    normal = normal / n2
    z_axis = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    v = np.cross(normal, z_axis)
    s = float(np.linalg.norm(v))
    c = float(np.clip(np.dot(normal, z_axis), -1.0, 1.0))
    if s < 1e-8:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    return rodrigues_rotation(v / s, math.acos(c))


def rotation_to_euler(R: np.ndarray) -> dict:
    if R.shape == (4, 4):
        R3 = R[:3, :3].astype(np.float64)
    else:
        R3 = np.asarray(R, dtype=np.float64)[:3, :3]
    sy = math.sqrt(float(R3[0, 0]) ** 2 + float(R3[1, 0]) ** 2)
    singular = sy < 1e-6
    if not singular:
        x = math.atan2(float(R3[2, 1]), float(R3[2, 2]))
        y = math.atan2(-float(R3[2, 0]), sy)
        z = math.atan2(float(R3[1, 0]), float(R3[0, 0]))
    else:
        x = math.atan2(-float(R3[1, 2]), float(R3[1, 1]))
        y = math.atan2(-float(R3[2, 0]), sy)
        z = 0.0
    return {
        "x": round(math.degrees(x), 1),
        "y": round(math.degrees(y), 1),
        "z": round(math.degrees(z), 1),
    }


def _score_orientation_3x3(mesh: trimesh.Trimesh, R: np.ndarray) -> dict:
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
        "report": "，" .join(report_parts) if "".join(report_parts) else "方向已最优",
    }


def rotation_from_up_vector(up: np.ndarray) -> np.ndarray:
    z = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    up = np.asarray(up, dtype=np.float64)
    norm = float(np.linalg.norm(up))
    if norm < 1e-12:
        return np.eye(4)
    up = up / norm
    v = np.cross(up, z)
    s = float(np.linalg.norm(v))
    c = float(np.dot(up, z))
    if s < 1e-8:
        R3 = np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    else:
        R3 = rodrigues_rotation(v / s, math.acos(c))
    result = np.eye(4)
    result[:3, :3] = R3
    return result


def evaluate_orientation(mesh: trimesh.Trimesh, rotation: np.ndarray) -> dict:
    rotated_points = mesh.vertices @ rotation[:3, :3].T + rotation[:3, 3]
    rotated_faces = mesh.faces
    rotated = trimesh.Trimesh(
        vertices=rotated_points, faces=rotated_faces,
        process=False, validate=False,
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
        support_volume = float(np.sum(
            face_areas[overhang_mask] * np.maximum(heights, 0.0)
        )) * 0.3

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

    overall = (
        support_score * SUPPORT_WEIGHT
        + time_score * TIME_WEIGHT
        + adhesion_score * ADHESION_WEIGHT
    )

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
    mesh = trimesh.load(model_path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        meshes = mesh.dump()
        mesh = trimesh.util.concatenate(meshes)
    if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
        return {"faces": []}

    if not hasattr(mesh, 'face_normals') or mesh.face_normals is None or len(mesh.face_normals) == 0:
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
        faces_result.append({
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
            }
        })

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
                fv = np.array([
                    [x_min, y_min, z_plane],
                    [x_max, y_min, z_plane],
                    [x_max, y_max, z_plane],
                    [x_min, y_max, z_plane],
                ], dtype=float)
                fv_orig = fv @ R[:3, :3]
                normal_rot = np.array([0.0, 0.0, -1.0])
                normal_orig = normal_rot @ R[:3, :3]
                poly_area = (x_max - x_min) * (y_max - y_min)
                verts_list = [[round(float(v[0]), 6), round(float(v[1]), 6), round(float(v[2]), 6)] for v in fv_orig]
                faces_result.append({
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
                    }
                })
            except Exception as e:
                logger.debug("Fibonacci fallback face %d failed: %s", i, e)
                continue
            if len(faces_result) >= 12:
                break

    return {"faces": faces_result}


def _load_mesh(model_path: str) -> trimesh.Trimesh:
    mesh = trimesh.load(model_path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        meshes = mesh.dump()
        mesh = trimesh.util.concatenate(meshes)
    if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
        raise ValueError("无法加载模型: {}".format(model_path))
    if not hasattr(mesh, 'face_normals') or mesh.face_normals is None or len(mesh.face_normals) == 0:
        mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=True, validate=True)
    return mesh


def analyze_orientation(
    model_path: str,
    face_normal: Optional[Sequence[float]] = None,
) -> dict:
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


# ── 共面聚类 + 模型旋转 + 自动最佳面选择 ──

COPLANAR_ANGLE_TOLERANCE_DEG = 3.0
COPLANAR_ANGLE_TOLERANCE_RAD = math.radians(COPLANAR_ANGLE_TOLERANCE_DEG)
COPLANAR_COS_THRESHOLD = math.cos(COPLANAR_ANGLE_TOLERANCE_RAD)
MIN_COPLANAR_AREA_MM2 = 10.0


def cluster_coplanar_faces(mesh: trimesh.Trimesh) -> list[dict]:
    """
    改进版共面面簇聚类 —— 参照 PrusaSlicer 的 Lay on Face 算法。

    改进点：
      1. 使用完整平面方程 (n·x = d) 判断共面，而非仅法向量
      2. BFS 聚类改用迭代平均法向量（而非固定种子法向量）
      3. PCA 重拟合平面法向量（更鲁棒）
      4. 后合并相邻且平面方程相近的簇
      5. 过滤内部面（法向量指向模型内腔的面）
      6. 返回 face_vertices 供前端 Three.js 高亮渲染

    Returns:
        [{normal, area, face_count, centroid, vertices, stability,
          face_vertices, ...}, ...]
    """
    faces = mesh.faces
    vertices = mesh.vertices.astype(np.float64)
    n_faces = len(faces)

    if n_faces < 3:
        return []

    # ── Step 1: 计算每个三角面的法向量、平面偏移 d、面积 ──
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    areas = np.linalg.norm(cross, axis=1) * 0.5
    norms = np.zeros_like(cross)
    valid = areas > 1e-12
    norms[valid] = cross[valid] / (areas[valid, np.newaxis] * 2.0)

    # 平面偏移 d = n · face_center
    face_centers = (v0 + v1 + v2) / 3.0
    plane_offsets = np.einsum('ij,ij->i', norms, face_centers)

    # ── Step 2: 构建边邻接图 ──
    edge_to_faces: dict[tuple, list] = {}
    for fi, (f0, f1, f2) in enumerate(faces):
        for edge in [(min(f0, f1), max(f0, f1)),
                     (min(f1, f2), max(f1, f2)),
                     (min(f2, f0), max(f2, f0))]:
            edge_to_faces.setdefault(edge, []).append(fi)

    adj = [set() for _ in range(n_faces)]
    for face_list in edge_to_faces.values():
        for i in range(len(face_list)):
            for j in range(i + 1, len(face_list)):
                a, b = face_list[i], face_list[j]
                adj[a].add(b)
                adj[b].add(a)

    # ── Step 3: 迭代平均法向量 + 平面偏移 BFS ──
    model_diag = float(np.linalg.norm(vertices.max(axis=0) - vertices.min(axis=0)))
    offset_tol = max(min(model_diag * 0.002, 0.5), 0.05)
    cos_threshold = COPLANAR_COS_THRESHOLD

    order = np.argsort(-areas)
    visited = np.zeros(n_faces, dtype=bool)
    initial_clusters: list[dict] = []

    for seed_idx in order:
        if visited[seed_idx] or areas[seed_idx] < 1e-6:
            continue

        cluster_normal = norms[seed_idx].copy()
        cluster_n = 1.0
        cluster_offset_sum = float(plane_offsets[seed_idx])

        queue = [int(seed_idx)]
        cluster_faces: list[int] = []
        visited[seed_idx] = True

        while queue:
            fi = queue.pop(0)
            cluster_faces.append(fi)
            w = float(areas[fi]) + 1e-9
            cluster_normal = (cluster_normal * cluster_n + norms[fi] * w) / (cluster_n + w)
            cluster_normal /= float(np.linalg.norm(cluster_normal))
            cluster_offset_sum += float(plane_offsets[fi]) * w
            cluster_n += w

            for ni in adj[fi]:
                if visited[ni] or areas[ni] < 1e-6:
                    continue
                dot = float(np.dot(cluster_normal, norms[ni]))
                if dot < cos_threshold:
                    continue
                if abs(float(plane_offsets[ni]) - cluster_offset_sum / cluster_n) > offset_tol:
                    continue
                visited[ni] = True
                queue.append(ni)

        if len(cluster_faces) < 2:
            continue
        cluster_area = float(np.sum(areas[cluster_faces]))
        if cluster_area < MIN_COPLANAR_AREA_MM2:
            continue

        cluster_face_indices = faces[cluster_faces]
        cluster_verts_flat = vertices[cluster_face_indices].reshape(-1, 3)
        centroid = cluster_verts_flat.mean(axis=0)

        # PCA 重拟合法向量
        try:
            centered = cluster_verts_flat - centroid
            cov = centered.T @ centered
            eigenvalues, eigenvectors = np.linalg.eigh(cov)
            refined = eigenvectors[:, 0]
            if np.dot(refined, cluster_normal) < 0:
                refined = -refined
            refined /= float(np.linalg.norm(refined))
            cluster_normal = refined
        except Exception:
            pass

        initial_clusters.append({
            "faces": cluster_faces,
            "normal": cluster_normal.tolist(),
            "area": float(cluster_area),
            "centroid": centroid.tolist(),
            "plane_offset": float(cluster_offset_sum / cluster_n),
            "vert_indices": np.unique(cluster_face_indices.flatten()).tolist(),
        })

    # ── Step 4: 后合并相邻同面簇 ──
    merged = _merge_planar_clusters_internal(initial_clusters, vertices, faces, cos_threshold, offset_tol)

    # ── Step 4.5: 过滤内部面（法向量指向腔体内的不可摆放面） ──
    #   策略：沿法向量偏移 1.5mm 检测是否在模型外部
    #   仅在面积大的簇上执行（小簇跳过过滤避免误杀）
    filtered = []
    for mc in merged:
        cf = mc["faces"]
        if not cf:
            continue
        cn = np.array(mc["normal"])
        ca = mc["area"]
        cv = vertices[np.unique(faces[cf].flatten())]
        if len(cv) < 3:
            continue
        centroid = cv.mean(axis=0)
        # 沿法向量向外偏移 2mm 测试是否在模型外部
        test_pt = centroid + cn * 2.0
        try:
            # 采样多个点取多数票（更鲁棒）
            test_pts = [centroid + cn * 2.0]
            # 额外在顶点附近采点
            for vi in cv[:min(5, len(cv))]:
                test_pts.append(vertices[vi] + cn * 2.0)
            inside_count = 0
            for tp in test_pts:
                inside_count += int(mesh.contains([tp])[0])
            inside = inside_count > len(test_pts) * 0.5
        except Exception:
            inside = False  # 无法判断时保留此面
        if inside:
            logger.debug(f"过滤内部面: area={ca:.1f}mm²")
            continue
        filtered.append(mc)
    merged = filtered

    # ── Step 5: 生成输出 ──
    result = []
    for mc in merged:
        cf = mc["faces"]
        ca = mc["area"]
        cn = np.array(mc["normal"])
        cc = np.array(mc["centroid"])

        cluster_verts = np.unique(faces[cf].flatten())
        cluster_points = vertices[cluster_verts]

        # 包围盒
        bbox_min = cluster_points.min(axis=0)
        bbox_max = cluster_points.max(axis=0)
        bbox_diag = float(np.linalg.norm(bbox_max - bbox_min))
        stability = min(1.0, ca / max(bbox_diag * bbox_diag, 1e-9) * 10.0)

        # 三角形顶点数据（供前端 Three.js 高亮渲染）
        fv = vertices[faces[cf]].reshape(-1, 3).tolist()
        fv_clean = [[_clean_value(v) for v in p] for p in fv]

        # 边界多边形顶点（用于显示轮廓）
        poly3d, poly2d = _extract_cluster_outline_p3d(cluster_points, cn, cc)
        poly3d_clean = [[_clean_value(v) for v in p] for p in poly3d]

        result.append({
            "normal": [_clean_value(v) for v in cn],
            "area": round(_clean_value(ca), 2),
            "face_count": len(cf),
            "centroid": [_clean_value(v) for v in cc],
            "bbox_size": [round(float(bbox_max[i] - bbox_min[i]), 2) for i in range(3)],
            "stability": round(stability, 4),
            "vertices": poly3d_clean,           # 边界多边形
            "face_vertices": fv_clean,           # 全部三角形顶点（前端高亮用）
        })

    result.sort(key=lambda c: c["area"], reverse=True)
    return result[:20]


def _clean_value(v: float) -> float:
    if math.isnan(v) or math.isinf(v):
        return 0.0
    return round(v, 6)


def _merge_planar_clusters_internal(
    clusters: list[dict],
    vertices: np.ndarray,
    faces: np.ndarray,
    cos_threshold: float,
    offset_tol: float,
) -> list[dict]:
    """合并相邻且平面方程相近的簇，然后合并所有同平面碎片。"""
    n = len(clusters)
    if n <= 1:
        return clusters

    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py

    # 通过共享边建立簇间邻接
    edge_clusters: dict[tuple, set[int]] = {}
    for ci, c in enumerate(clusters):
        for fi in c["faces"]:
            f0, f1, f2 = faces[fi]
            for e in [(min(f0, f1), max(f0, f1)),
                      (min(f1, f2), max(f1, f2)),
                      (min(f2, f0), max(f2, f0))]:
                edge_clusters.setdefault(e, set()).add(ci)

    for cs in edge_clusters.values():
        clist = list(cs)
        for i in range(len(clist)):
            for j in range(i + 1, len(clist)):
                a, b = clist[i], clist[j]
                if find(a) == find(b):
                    continue
                na = np.array(clusters[a]["normal"])
                nb = np.array(clusters[b]["normal"])
                if float(np.dot(na, nb)) >= cos_threshold:
                    da = clusters[a]["plane_offset"]
                    db = clusters[b]["plane_offset"]
                    if abs(da - db) <= offset_tol * 2:
                        union(a, b)

    # 第二遍：合并所有同平面的碎片（不要求邻接）
    for i in range(n):
        for j in range(i + 1, n):
            if find(i) == find(j):
                continue
            na = np.array(clusters[i]["normal"])
            nb = np.array(clusters[j]["normal"])
            if float(np.dot(na, nb)) >= cos_threshold:
                da = clusters[i]["plane_offset"]
                db = clusters[j]["plane_offset"]
                if abs(da - db) <= offset_tol * 2:
                    union(i, j)

    # 构建合并后的群组
    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    merged = []
    for indices in groups.values():
        if len(indices) == 1:
            merged.append(clusters[indices[0]])
        else:
            all_faces = []
            total_area = 0.0
            w_normal = np.zeros(3, dtype=np.float64)
            w_offset = 0.0
            w_sum = 0.0
            for idx in indices:
                c = clusters[idx]
                all_faces.extend(c["faces"])
                total_area += c["area"]
                w = c["area"] + 1e-9
                w_normal += np.array(c["normal"]) * w
                w_offset += c["plane_offset"] * w
                w_sum += w
            w_normal /= w_sum
            n_len = float(np.linalg.norm(w_normal))
            if n_len > 1e-8:
                w_normal /= n_len

            all_faces_concat = []
            for idx in indices:
                f = clusters[idx]["faces"]
                if f:
                    all_faces_concat.extend(f)
            if all_faces_concat:
                vi_f = faces[np.array(all_faces_concat)]
                all_verts = vertices[np.unique(vi_f.flatten())]
                merged_centroid = all_verts.mean(axis=0).tolist()
                out_vi = np.unique(vi_f.flatten()).tolist()
            else:
                merged_centroid = [0.0, 0.0, 0.0]
                out_vi = []

            merged.append({
                "faces": all_faces,
                "normal": w_normal.tolist(),
                "area": total_area,
                "centroid": merged_centroid,
                "plane_offset": float(w_offset / w_sum),
                "vert_indices": out_vi,
            })

    return merged


def _extract_cluster_outline_p3d(
    verts: np.ndarray,
    normal: np.ndarray,
    centroid: np.ndarray,
) -> tuple[list[list[float]], list[list[float]]]:
    """提取簇的 2D 轮廓凸包多边形。"""
    z_axis = np.array([0.0, 0.0, 1.0])
    if abs(np.dot(normal, z_axis)) > 0.999:
        x_axis = np.array([1.0, 0.0, 0.0])
    else:
        x_axis = np.cross(normal, z_axis)
        x_axis /= np.linalg.norm(x_axis)
    y_axis = np.cross(normal, x_axis)

    proj = np.column_stack([
        (verts - centroid) @ x_axis,
        (verts - centroid) @ y_axis,
    ])

    try:
        from scipy.spatial import ConvexHull
        if len(proj) >= 3:
            hull = ConvexHull(proj[:, :2])
            hull_verts_2d = proj[hull.vertices, :2]
            hull_verts_3d = [
                (centroid + x_axis * v[0] + y_axis * v[1]).tolist()
                for v in hull_verts_2d
            ]
            return hull_verts_3d, hull_verts_2d.tolist()
    except Exception:
        pass

    all_3d = [v.tolist() for v in verts]
    all_2d = [[float((v - centroid) @ x_axis), float((v - centroid) @ y_axis)] for v in verts]
    return all_3d, all_2d


def apply_orientation_to_mesh(
    model_path: str,
    rotation_matrix: np.ndarray,
    translation: Optional[Sequence[float]] = None,
    output_dir: Optional[str] = None,
) -> str:
    """
    对模型应用旋转变换，将结果保存为临时 STL 文件供切片使用。

    Args:
        model_path: 原始模型路径
        rotation_matrix: 3×3 旋转矩阵
        translation: [x, y, z] 平移向量，默认贴合Z=0
        output_dir: 输出目录，默认临时目录

    Returns:
        旋转后模型文件的路径
    """
    mesh = trimesh.load(model_path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        meshes = mesh.dump()
        mesh = trimesh.util.concatenate(meshes)

    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError("无法加载模型: {}".format(model_path))

    # 应用旋转
    R = np.asarray(rotation_matrix, dtype=np.float64)
    if R.shape != (3, 3):
        R = R[:3, :3]

    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    rotated_verts = vertices @ R.T

    # 应用平移（默认贴合Z=0）
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

    # 保存为 STL
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


def get_best_face_for_slicing(model_path: str) -> dict:
    """
    自动选择模型的最佳打印底面（Lay on Face），返回旋转后模型路径和元信息。

    策略：
    1. 共面聚类找到所有平坦候选面
    2. 对每个候选面评估朝向得分（支撑/时间/粘附）
    3. 选取得分最高的面作为打印底面
    4. 生成旋转后的 STL 文件供切片使用

    Returns:
        {
            "oriented_path": "/tmp/xxx.stl",       # 旋转后模型路径
            "original_path": "original.stl",        # 原始路径
            "rotation_matrix": [[...], ...],
            "euler_angles_deg": {"x": ..., "y": ..., "z": ...},
            "score": 85.5,
            "face": {...},                          # 选中的面信息
            "all_candidates": [...],                # 所有候选面（用于前端展示）
        }
    """
    mesh = _load_mesh(model_path)

    # Step 1: 共面聚类
    coplanar_clusters = cluster_coplanar_faces(mesh)

    # Step 2: 对每个簇评估朝向
    candidates = []
    for cluster in coplanar_clusters:
        normal = np.array(cluster["normal"], dtype=np.float64)
        # 面法向量指向外部，打印底面需要法向量朝下（-Z）
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

    # Step 3: 如果没有共面簇，回退到大面 + 凸包面
    if not candidates:
        faces_result = get_stable_faces(model_path)
        for f in faces_result.get("faces", []):
            # 手动评分：越大接触面积 + 越低悬垂 = 越好
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

    # Step 4: 按得分排序
    candidates.sort(key=lambda c: c["score"], reverse=True)

    if not candidates:
        # 完全无法找到面 — 返回原始模型
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

    # Step 5: 计算旋转矩阵并保存旋转后模型
    up = -best_normal
    up_norm = float(np.linalg.norm(up))
    if up_norm < 1e-8:
        up = np.array([0.0, 0.0, 1.0])
    else:
        up = up / up_norm
        if up[2] < 0:
            up = -up

    R = rotation_from_up_vector(up)
    # 微调
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
