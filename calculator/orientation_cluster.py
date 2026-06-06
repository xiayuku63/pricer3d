"""Coplanar face clustering for automatic lay-on-face detection.

Clusters mesh triangles into coplanar groups that can serve as stable
print bed contact faces.  Based on PrusaSlicer's Lay on Face algorithm
with iterative normal averaging, PCA refinement, and post-merge passes.
"""

import math
import logging
import numpy as np
import trimesh

from calculator.orientation_math import rotation_from_up_vector
from calculator.orientation_scoring import evaluate_orientation

logger = logging.getLogger(__name__)

# ── 可调参数 ──
COPLANAR_ANGLE_TOLERANCE_DEG = 3.0
COPLANAR_ANGLE_TOLERANCE_RAD = math.radians(COPLANAR_ANGLE_TOLERANCE_DEG)
COPLANAR_COS_THRESHOLD = math.cos(COPLANAR_ANGLE_TOLERANCE_RAD)
MIN_COPLANAR_AREA_MM2 = 10.0


def _clean_value(v: float) -> float:
    """Sanitize a float value: NaN/Inf → 0.0, otherwise round to 6 decimal places."""
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
    """Merge adjacent clusters that share nearly-identical plane equations.

    Two-pass strategy:
    1. Union-Find on edge-adjacent clusters with matching plane equations
    2. Global merge of all same-plane fragments (not requiring adjacency)
    """
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

    # Build cluster adjacency via shared edges
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

    # Pass 2: global merge of all same-plane fragments
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

    # Build merged groups
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
    """Extract 2D convex hull outline of a coplanar vertex cluster.

    Returns (3d_outline_vertices, 2d_projected_outline).
    """
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


def cluster_coplanar_faces(mesh: trimesh.Trimesh) -> list[dict]:
    """Cluster mesh triangles into coplanar groups usable as print-bed contact faces.

    Algorithm (inspired by PrusaSlicer Lay on Face):
    1. Compute per-triangle normals, plane offsets, and areas
    2. Build edge-adjacency graph
    3. BFS clustering with iterative average normal (not fixed seed normal)
    4. PCA refinement of cluster normals
    5. Post-merge adjacent same-plane clusters
    6. Filter internal faces (normals pointing into cavities)
    7. Return clusters with face_vertices for Three.js highlighting

    Returns:
        [{normal, area, face_count, centroid, vertices, stability, face_vertices, ...}, ...]
        sorted by area descending, capped at 20 clusters.
    """
    faces = mesh.faces
    vertices = mesh.vertices.astype(np.float64)
    n_faces = len(faces)

    if n_faces < 3:
        return []

    # ── Step 1: per-triangle normals, plane offsets, areas ──
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    areas = np.linalg.norm(cross, axis=1) * 0.5
    norms = np.zeros_like(cross)
    valid = areas > 1e-12
    norms[valid] = cross[valid] / (areas[valid, np.newaxis] * 2.0)

    face_centers = (v0 + v1 + v2) / 3.0
    plane_offsets = np.einsum('ij,ij->i', norms, face_centers)

    # ── Step 2: edge-adjacency graph ──
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

    # ── Step 3: iterative-average-normal BFS ──
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

        # PCA refinement of normal
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

    # ── Step 4: post-merge adjacent same-plane clusters ──
    merged = _merge_planar_clusters_internal(initial_clusters, vertices, faces, cos_threshold, offset_tol)

    # ── Step 4.5: filter internal faces (normals pointing into cavities) ──
    filtered = []
    for mc in merged:
        cf = mc["faces"]
        if not cf:
            continue
        cn = np.array(mc["normal"])
        cv = vertices[np.unique(faces[cf].flatten())]
        if len(cv) < 3:
            continue
        centroid = cv.mean(axis=0)
        test_pt = centroid + cn * 2.0
        try:
            test_pts = [centroid + cn * 2.0]
            for vi in cv[:min(5, len(cv))]:
                test_pts.append(vertices[vi] + cn * 2.0)
            inside_count = 0
            for tp in test_pts:
                inside_count += int(mesh.contains([tp])[0])
            inside = inside_count > len(test_pts) * 0.5
        except Exception:
            inside = False
        if inside:
            logger.debug(f"过滤内部面: area={mc['area']:.1f}mm²")
            continue
        filtered.append(mc)
    merged = filtered

    # ── Step 5: generate output ──
    result = []
    for mc in merged:
        cf = mc["faces"]
        ca = mc["area"]
        cn = np.array(mc["normal"])
        cc = np.array(mc["centroid"])

        cluster_verts = np.unique(faces[cf].flatten())
        cluster_points = vertices[cluster_verts]

        bbox_min = cluster_points.min(axis=0)
        bbox_max = cluster_points.max(axis=0)
        bbox_diag = float(np.linalg.norm(bbox_max - bbox_min))
        stability = min(1.0, ca / max(bbox_diag * bbox_diag, 1e-9) * 10.0)

        # Triangle vertices for Three.js highlighting
        fv = vertices[faces[cf]].reshape(-1, 3).tolist()
        fv_clean = [[_clean_value(v) for v in p] for p in fv]

        # Outline polygon
        poly3d, poly2d = _extract_cluster_outline_p3d(cluster_points, cn, cc)
        poly3d_clean = [[_clean_value(v) for v in p] for p in poly3d]

        result.append({
            "normal": [_clean_value(v) for v in cn],
            "area": round(_clean_value(ca), 2),
            "face_count": len(cf),
            "centroid": [_clean_value(v) for v in cc],
            "bbox_size": [round(float(bbox_max[i] - bbox_min[i]), 2) for i in range(3)],
            "stability": round(stability, 4),
            "vertices": poly3d_clean,
            "face_vertices": fv_clean,
        })

    result.sort(key=lambda c: c["area"], reverse=True)
    return result[:20]
