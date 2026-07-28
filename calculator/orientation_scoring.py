"""Fast geometric scoring and stable-face discovery for print orientation."""

import logging
import math

import numpy as np
import trimesh

from calculator.orientation_math import (
    fibonacci_sphere_sampling,
    rotation_from_bed_normal,
    rotation_from_up_vector,
    rotation_to_euler,
)

logger = logging.getLogger(__name__)

OVERHANG_ANGLE_DEG = 45.0
NUM_FIBONACCI_SAMPLES = 64
NUM_LARGE_FACE_SAMPLES = 8
TOP_N_RESULTS = 5
SUPPORT_WEIGHT = 0.45
TIME_WEIGHT = 0.10
ADHESION_WEIGHT = 0.20
STABILITY_WEIGHT = 0.25
FINE_TUNE_Z_RANGE = (-30, 30)
FINE_TUNE_STEP = 1.0


def _bed_plane_tolerance(rotated_vertices: np.ndarray) -> float:
    bounds = np.ptp(rotated_vertices, axis=0)
    model_diag = float(np.linalg.norm(bounds))
    return max(1e-5, min(0.01, model_diag * 1e-6))


def _bed_contact_mask(rotated_vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    if rotated_vertices.size == 0 or len(faces) == 0:
        return np.zeros(len(faces), dtype=bool)
    z_min = float(rotated_vertices[:, 2].min())
    plane_tol = _bed_plane_tolerance(rotated_vertices)
    triangle_z = rotated_vertices[faces, 2]
    return np.max(np.abs(triangle_z - z_min), axis=1) <= plane_tol


def _bed_contact_area(
    rotated_vertices: np.ndarray,
    faces: np.ndarray,
    face_areas: np.ndarray,
) -> float:
    """Return actual triangle area on the minimum-Z bed plane."""
    mask = _bed_contact_mask(rotated_vertices, faces)
    return float(np.sum(face_areas[mask]))


def _count_face_components(mesh: trimesh.Trimesh, mask: np.ndarray) -> int:
    active = np.flatnonzero(mask)
    if len(active) == 0:
        return 0
    parent = np.arange(len(mask), dtype=np.int64)

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = int(parent[x])
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for a, b in np.asarray(mesh.face_adjacency, dtype=np.int64):
        if mask[a] and mask[b]:
            union(int(a), int(b))
    return len({find(int(i)) for i in active})




def _score_orientation_3x3(
    mesh: trimesh.Trimesh,
    R: np.ndarray,
    include_support_islands: bool = True,
) -> dict:
    """Compute fast, slicer-free geometric metrics for one rotation."""
    R = np.asarray(R, dtype=np.float64)[:3, :3]
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    rotated_verts = vertices @ R.T
    rotated_normals = np.asarray(mesh.face_normals, dtype=np.float64) @ R.T
    face_areas = np.asarray(mesh.area_faces, dtype=np.float64)
    total_area = float(np.sum(face_areas))
    if total_area < 1e-9 or rotated_verts.size == 0:
        return {
            "overhang_ratio": 1.0,
            "effective_overhang_area": 0.0,
            "contact_area": 0.0,
            "z_height": 0.0,
            "support_volume": 0.0,
            "support_island_count": 0,
            "stability_margin": -1e9,
            "stable": False,
        }

    z_all = rotated_verts[:, 2]
    z_min = float(z_all.min())
    z_max = float(z_all.max())
    z_height = z_max - z_min
    contact_mask = _bed_contact_mask(rotated_verts, faces)
    contact_area = float(np.sum(face_areas[contact_mask]))

    dot_z = rotated_normals[:, 2]
    threshold_cos = math.cos(math.radians(OVERHANG_ANGLE_DEG))
    angle_overhang = (dot_z < 0.0) & (-dot_z > threshold_cos)
    effective_overhang = angle_overhang & ~contact_mask
    overhang_area = float(np.sum(face_areas[effective_overhang]))
    overhang_ratio = overhang_area / total_area

    support_volume = 0.0
    if np.any(effective_overhang):
        centers = np.asarray(mesh.triangles_center, dtype=np.float64) @ R.T
        heights = np.maximum(centers[effective_overhang, 2] - z_min, 0.0)
        support_volume = float(np.sum(face_areas[effective_overhang] * heights)) * 0.3
    support_islands = _count_face_components(mesh, effective_overhang) if include_support_islands else 0

    footprint_size = np.ptp(rotated_verts[:, :2], axis=0)
    footprint_area = float(footprint_size[0] * footprint_size[1])

    stability_margin = -1e9
    stable = False
    support_polygon_area = 0.0
    cog = np.asarray(mesh.center_mass, dtype=np.float64)
    if not np.all(np.isfinite(cog)):
        cog = np.asarray(mesh.centroid, dtype=np.float64)
    cog_r = cog @ R.T
    cog_height = float(cog_r[2] - z_min)
    try:
        contact_indices = np.unique(faces[contact_mask].reshape(-1))
        contact_xy = rotated_verts[contact_indices, :2]
        if len(contact_xy) >= 3:
            from scipy.spatial import ConvexHull

            hull = ConvexHull(contact_xy)
            support_polygon_area = float(hull.volume)
            equations = np.asarray(hull.equations, dtype=np.float64)
            distances = -(equations[:, :2] @ cog_r[:2] + equations[:, 2])
            distances /= np.maximum(np.linalg.norm(equations[:, :2], axis=1), 1e-12)
            stability_margin = float(np.min(distances))
            stable = stability_margin >= -_bed_plane_tolerance(rotated_verts)
    except Exception:
        pass

    return {
        "overhang_ratio": round(overhang_ratio, 6),
        "effective_overhang_area": round(overhang_area, 2),
        "overhang_area": round(overhang_area, 2),
        "contact_area": round(contact_area, 2),
        "z_height": round(z_height, 2),
        "support_volume": round(support_volume, 2),
        "support_island_count": int(support_islands),
        "stability_margin": round(stability_margin, 4),
        "stable": bool(stable),
        "support_polygon_area": round(support_polygon_area, 2),
        "cog_height": round(cog_height, 2),
        "xy_footprint": round(footprint_area, 2),
        "total_area": round(total_area, 2),
    }


def fine_tune_orientation(
    mesh: trimesh.Trimesh,
    R_base: np.ndarray,
    z_range: tuple = FINE_TUNE_Z_RANGE,
    step: float = FINE_TUNE_STEP,
) -> dict:
    """Keep the aligned face orientation without arbitrary Z rotation."""
    del z_range, step
    metrics = _score_orientation_3x3(mesh, R_base)
    return {
        "R": np.asarray(R_base, dtype=np.float64).copy(),
        "angle": 0.0,
        "metrics": metrics,
        "report": "Kept the aligned face without an arbitrary Z-axis rotation",
    }


def evaluate_orientation(
    mesh: trimesh.Trimesh,
    rotation: np.ndarray,
    include_support_islands: bool = True,
) -> dict:
    """Evaluate one orientation using fast geometric metrics only."""
    R3 = np.asarray(rotation, dtype=np.float64)[:3, :3]
    raw = _score_orientation_3x3(mesh, R3, include_support_islands=include_support_islands)
    volume = max(abs(float(mesh.volume)), 1.0)
    footprint = max(float(raw.get("xy_footprint", 0.0)), 1e-9)
    contact_area = float(raw.get("contact_area", 0.0))
    support_volume = float(raw.get("support_volume", 0.0))
    overhang_ratio = float(raw.get("overhang_ratio", 1.0))
    stability_margin = float(raw.get("stability_margin", -1e9))
    cog_height = max(float(raw.get("cog_height", 0.0)), 1e-9)

    support_penalty = min(1.0, 0.55 * min(overhang_ratio / 0.35, 1.0) + 0.45 * min(support_volume / volume, 1.0))
    support_score = 100.0 * (1.0 - support_penalty)
    adhesion_score = min(100.0, contact_area / footprint * 100.0)
    stability_score = 0.0 if stability_margin < 0 else min(100.0, stability_margin / max(cog_height * 0.5, 1e-9) * 100.0)
    extents = np.ptp(np.asarray(mesh.vertices) @ R3.T, axis=0)
    z_ratio = float(raw.get("z_height", 0.0)) / max(float(np.max(extents)), 1e-9)
    time_score = max(0.0, 100.0 * (1.0 - z_ratio))
    overall = (
        support_score * SUPPORT_WEIGHT
        + stability_score * STABILITY_WEIGHT
        + adhesion_score * ADHESION_WEIGHT
        + time_score * TIME_WEIGHT
    )

    metrics = {
        "overhang_area": raw["overhang_area"],
        "effective_overhang_area": raw["effective_overhang_area"],
        "overhang_ratio": raw["overhang_ratio"],
        "support_volume_estimate": raw["support_volume"],
        "support_island_count": raw["support_island_count"],
        "z_height": raw["z_height"],
        "base_contact_area": raw["contact_area"],
        "xy_footprint": raw["xy_footprint"],
        "support_polygon_area": raw["support_polygon_area"],
        "stability_margin": raw["stability_margin"],
        "stable": raw["stable"],
        "cog_height": raw["cog_height"],
        "support_score": round(support_score, 2),
        "stability_score": round(stability_score, 2),
        "time_score": round(time_score, 2),
        "adhesion_score": round(adhesion_score, 2),
    }
    return {
        "score": round(overall, 2),
        "metrics": metrics,
        "rotation_matrix": np.asarray(rotation).tolist(),
        "euler_angles_deg": rotation_to_euler(rotation),
    }


def get_stable_faces(model_path: str) -> dict:
    """Find candidate stable faces on a model for lay-on-face placement.

    Searches via three strategies (in order):
    1. Largest faces by area
    2. Convex hull faces
    3. Fibonacci sphere sampling (fallback for organic shapes)
    """
    from parser.model_pipeline import ModelNormalizationError, normalize_model

    normalized = None
    try:
        normalized = normalize_model(model_path)
        mesh = trimesh.load(normalized.mesh_path, force="mesh")
    except ModelNormalizationError as exc:
        logger.warning("get_stable_faces normalization failed: %s", exc)
        return {"faces": []}
    finally:
        if normalized is not None:
            normalized.cleanup()

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
        norm_val = float(np.linalg.norm(normal))
        if norm_val < 1e-8:
            return
        up = -normal / norm_val
        key = tuple(np.round(up, 2))
        if key in used_up_keys:
            return
        used_up_keys.add(key)
        R = rotation_from_bed_normal(normal)
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
