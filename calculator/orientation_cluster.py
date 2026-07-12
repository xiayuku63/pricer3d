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
MAX_RETURN_CLUSTERS = 64


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


def _build_hull_coplanar_planes(conv_hull, exact_eps: float = 1e-3):
    """OrcaSlicer-style convex-hull coplanar clustering.

    Mirrors GLGizmoFlatten.cpp ``update_planes()``: BFS-cluster the convex-hull
    triangles by edge adjacency using **exact component-wise** normal match
    (``|a-b| < exact_eps``), then emit one plane per coplanar group.  Because the
    clustering happens ON the hull, cavity / internal faces are excluded at the
    source and can never become candidate planes.

    Returns ``(plane_normals[K,3], plane_offsets[K])`` (offset = signed distance
    of the plane from origin) or ``None`` on failure.
    """
    hfaces = np.asarray(conv_hull.faces)
    hverts = np.asarray(conv_hull.vertices, dtype=np.float64)
    nf = len(hfaces)
    if nf == 0:
        return None
    v0 = hverts[hfaces[:, 0]]
    v1 = hverts[hfaces[:, 1]]
    v2 = hverts[hfaces[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    areas = np.linalg.norm(cross, axis=1) * 0.5
    norms = np.zeros_like(cross)
    valid = areas > 1e-12
    norms[valid] = cross[valid] / (areas[valid, np.newaxis] * 2.0)
    centers = (v0 + v1 + v2) / 3.0
    offs = np.einsum("ij,ij->i", norms, centers)

    # edge adjacency among hull triangles
    edge_to_faces: dict = {}
    for fi, (a, b, c) in enumerate(hfaces):
        for e in (
            (min(a, b), max(a, b)),
            (min(b, c), max(b, c)),
            (min(c, a), max(c, a)),
        ):
            edge_to_faces.setdefault(e, []).append(fi)
    adj: list[list] = [[] for _ in range(nf)]
    for fl in edge_to_faces.values():
        for i in range(len(fl)):
            for j in range(i + 1, len(fl)):
                adj[fl[i]].append(fl[j])
                adj[fl[j]].append(fl[i])

    plane_normals = []
    plane_offsets = []
    visited = np.zeros(nf, dtype=bool)
    for s in range(nf):
        if visited[s]:
            continue
        seed_normal = norms[s]
        stack = [s]
        visited[s] = True
        grp = []
        while stack:
            fi = stack.pop()
            grp.append(fi)
            for nj in adj[fi]:
                if visited[nj]:
                    continue
                # exact component-wise match (OrcaSlicer |a-b| < 0.001)
                if np.max(np.abs(norms[nj] - seed_normal)) < exact_eps:
                    visited[nj] = True
                    stack.append(nj)
        g = np.array(grp, dtype=int)
        w = areas[g]
        wsum = float(w.sum())
        if wsum < 1e-12:
            continue
        nrm = (norms[g] * w[:, np.newaxis]).sum(axis=0) / wsum
        nlen = float(np.linalg.norm(nrm))
        if nlen < 1e-9:
            continue
        nrm /= nlen
        off = float((offs[g] * w).sum() / wsum)
        plane_normals.append(nrm)
        plane_offsets.append(off)
    if not plane_normals:
        return None
    return np.array(plane_normals), np.array(plane_offsets)


def cluster_coplanar_faces(
    mesh: trimesh.Trimesh,
    include_upward_faces: bool = False,
) -> list[dict]:
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

    # ── Step 4.5: filter internal faces ──
    # 参考 OrcaSlicer/BambuStudio GLGizmoFlatten.cpp update_planes():
    #   1) 构造模型凸包 ch = convex_hull_3d()
    #   2) 在凸包三角面集上 BFS 邻接聚类, 法向量分量级精确匹配 |a-b|<1e-3
    #   3) 仅凸包面保留为候选 → 凹腔/内部面从源头剔除
    # 本实现: 先用 _build_hull_coplanar_planes() 在凸包上 BFS 聚类得到「凸包平面集」,
    # 再要求每个原始候选簇与某凸包平面真正共面 (法向对齐 cos>=0.999 且平面偏移在
    # 【紧】容差内). 紧容差彻底拒绝浅凹内部面:
    #   - 凸包边界面 (真外表面): 偏移差 ≈ 0 (1e-9级) → 通过
    #   - 凹腔/内部面: 偏移差 = 腔深 (mm级) → 被滤除
    # v0.40.0 旧偏移容差 max(diag*0.01, 0.5) 过松, 使 0.3~3mm 浅凹内部面误判为
    # 外表面而被高亮 — 这正是「内部面还是被高亮」的根因.
    # model_diag 已在前面计算
    test_offset = max(model_diag * 0.02, 5.0)  # 动态偏移，最小5mm
    convex_hull_thresh = model_diag * 0.05  # 旧方法4阈值

    # 过滤A阈值 (OrcaSlicer 凸包聚类做法)
    HULL_NORMAL_COS_THRESHOLD = 0.999        # 候选簇法向 vs 凸包平面法向 (夹角 < 2.56°)
    # 紧容差: 0.1% 模型对角线, 最小 0.05mm. 仅真正共面通过; 浅凹内部面被拒.
    HULL_PLANE_OFFSET_TOL_TIGHT = max(model_diag * 0.001, 0.05)
    # 兜底容差 (v0.40.0 旧值): 紧过滤 0 候选时降级使用, 保证不返回空列表
    HULL_PLANE_OFFSET_TOL_FALLBACK = max(model_diag * 0.01, 0.5)
    # 过滤B阈值: normal.z > NORMAL_Z_MAX 视为朝上面 → 拒绝 (即与 +Z 夹角 < 84°)
    NORMAL_Z_MAX = 0.1

    # 预计算凸包 — 过滤A(凸包表面)与原方法4都需要
    conv_hull = None
    try:
        conv_hull = mesh.convex_hull
    except Exception:
        conv_hull = None

    # 过滤A: 在凸包上 BFS 邻接聚类建立「凸包平面集」(OrcaSlicer 做法)
    # 失败仅跳过A, 降级到仅方法4等补充过滤
    hull_planes = None
    if conv_hull is not None and len(conv_hull.faces) > 0:
        try:
            hull_planes = _build_hull_coplanar_planes(conv_hull, exact_eps=1e-3)
        except Exception:
            hull_planes = None
    hull_available = (
        hull_planes is not None
        and len(hull_planes[0]) > 0
    )

    def _run_internal_face_filter(offset_tol: float) -> list[dict]:
        """Run filter A (hull coplanarity at given offset tol) + B + 4 safety nets.

        Returns the list of surviving merged clusters.  ``offset_tol`` controls
        how strictly filter A requires the candidate plane to coincide with a
        convex-hull plane.
        """
        hp_n, hp_o = (hull_planes[0], hull_planes[1]) if hull_available else (None, None)
        out: list[dict] = []
        for mc in merged:
            cf = mc["faces"]
            if not cf:
                continue
            cn = np.array(mc["normal"], dtype=np.float64)
            cv = vertices[np.unique(faces[cf].flatten())]
            if len(cv) < 3:
                continue
            centroid = cv.mean(axis=0)

            # ── 过滤A: 凸包表面筛选 (主过滤手段) ──
            # 候选面簇若不在凸包表面上 → 内部/凹腔面 → 直接过滤, 无需后续射线检测
            if hull_available:
                # 1) 法向量匹配: 候选簇法向量须与某凸包平面法向量高度对齐
                cos_sims = np.nan_to_num(
                    hp_n @ cn, nan=-2.0, posinf=1.0, neginf=-2.0
                )
                max_cos = float(cos_sims.max())
                if max_cos < HULL_NORMAL_COS_THRESHOLD:
                    logger.debug(
                        f"过滤内部面[A-法向不匹配]: area={mc['area']:.1f}mm², "
                        f"max_cos={max_cos:.4f}, threshold={HULL_NORMAL_COS_THRESHOLD}"
                    )
                    continue
                # 2) 平面偏移匹配: 候选簇平面到匹配凸包平面须真正共面 (紧容差)
                matching = np.where(cos_sims >= HULL_NORMAL_COS_THRESHOLD)[0]
                plane_off_cluster = float(np.dot(cn, centroid))
                min_offset_diff = float(
                    np.min(np.abs(hp_o[matching] - plane_off_cluster))
                )
                if min_offset_diff > offset_tol:
                    logger.debug(
                        f"过滤内部面[A-平面偏移不匹配]: area={mc['area']:.1f}mm², "
                        f"min_offset_diff={min_offset_diff:.3f}mm, "
                        f"tol={offset_tol:.3f}mm"
                    )
                    continue

            # ── 过滤B: 法向量方向过滤 ──
            # 自动朝向时默认仍跳过朝上的面，避免候选过多；
            # 但手动摆放需要把这类外表面也暴露给前端供用户点选。
            if (not include_upward_faces) and float(cn[2]) > NORMAL_Z_MAX:
                logger.debug(
                    f"过滤朝上面[B-法向朝上]: area={mc['area']:.1f}mm², "
                    f"normal_z={float(cn[2]):.3f}, threshold={NORMAL_Z_MAX}"
                )
                continue

            # ── 补充防护: 原4道内部面过滤 ──
            # (此时已通过过滤A的凸包表面验证; 此4道为补充防护, 极少触发)
            inside_reason = None

            # 方法1: contains() 检测空腔内部面
            test_pt_main = centroid + cn * test_offset
            try:
                if bool(mesh.contains([test_pt_main])[0]):
                    inside_reason = "contains"
            except Exception:
                pass

            # 方法2: 射线投射检测面向实体内部的假面
            if inside_reason is None:
                try:
                    ray_origin = centroid + cn * 0.01
                    locations, _, _ = mesh.ray.intersects_location(
                        ray_origins=np.array([ray_origin]),
                        ray_directions=np.array([cn])
                    )
                    if len(locations) > 0:
                        dist = float(np.linalg.norm(locations[0] - ray_origin))
                        if dist < 1.0:
                            inside_reason = "ray"
                except Exception:
                    pass

            # 方法3: 双向射线投射 — 正负法向两侧首次命中都<2mm 说明被夹在实体之间
            # 起点分别偏到面两侧 0.01mm，避免命中候选面自身
            if inside_reason is None:
                try:
                    origin_pos = centroid + cn * 0.01
                    origin_neg = centroid - cn * 0.01
                    loc_pos, _, _ = mesh.ray.intersects_location(
                        ray_origins=np.array([origin_pos]),
                        ray_directions=np.array([cn])
                    )
                    loc_neg, _, _ = mesh.ray.intersects_location(
                        ray_origins=np.array([origin_neg]),
                        ray_directions=np.array([-cn])
                    )
                    dist_pos = float(np.linalg.norm(loc_pos[0] - origin_pos)) if len(loc_pos) > 0 else float("inf")
                    dist_neg = float(np.linalg.norm(loc_neg[0] - origin_neg)) if len(loc_neg) > 0 else float("inf")
                    if dist_pos < 2.0 and dist_neg < 2.0:
                        inside_reason = "dual_ray"
                except Exception:
                    pass

            # 方法4: 凸包测试 — 面在凹腔内部则其质心距凸包表面较远
            if inside_reason is None and conv_hull is not None:
                try:
                    _, dist_arr, _ = conv_hull.nearest.on_surface([centroid])
                    if float(dist_arr[0]) > convex_hull_thresh:
                        inside_reason = "convex_hull"
                except Exception:
                    pass

            if inside_reason is not None:
                logger.debug(
                    f"过滤内部面[补充4道]: area={mc['area']:.1f}mm², 原因={inside_reason}"
                )
                continue
            out.append(mc)
        return out

    # 紧容差过滤 (仅真正在凸包表面的外表面通过 → 内部面被剔除)
    filtered = _run_internal_face_filter(HULL_PLANE_OFFSET_TOL_TIGHT)
    # 兜底: 紧容差若 0 候选 (极端几何, 如无平面的纯曲面凸包), 降级到旧容差
    # (v0.40.0 行为) 保证不返回空列表 — 宁可降级也不要让 UI 拿到 0 个候选.
    if not filtered and hull_available:
        logger.debug(
            f"凸包紧过滤后 0 候选, 降级 offset_tol={HULL_PLANE_OFFSET_TOL_FALLBACK:.3f}mm"
        )
        filtered = _run_internal_face_filter(HULL_PLANE_OFFSET_TOL_FALLBACK)
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
    return result[:MAX_RETURN_CLUSTERS]
