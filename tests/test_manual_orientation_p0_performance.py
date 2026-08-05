import numpy as np
import trimesh

import calculator.orientation_cluster as orientation_cluster


def test_manual_hull_filter_skips_per_cluster_ray_safety_checks(monkeypatch):
    mesh = trimesh.creation.box(extents=[20.0, 20.0, 20.0])
    contains_calls = 0
    ray_calls = 0

    def counted_contains(*_args, **_kwargs):
        nonlocal contains_calls
        contains_calls += 1
        return np.array([False])

    def counted_ray(*_args, **_kwargs):
        nonlocal ray_calls
        ray_calls += 1
        return np.empty((0, 3)), np.empty(0, dtype=int), np.empty(0, dtype=int)

    monkeypatch.setattr(trimesh.Trimesh, "contains", counted_contains)
    monkeypatch.setattr(trimesh.ray.ray_triangle.RayMeshIntersector, "intersects_location", counted_ray)

    clusters = orientation_cluster.cluster_coplanar_faces(mesh, include_upward_faces=True)

    assert len(clusters) == 6
    assert contains_calls == 0
    assert ray_calls == 0


def test_manual_output_is_trimmed_before_outline_extraction(monkeypatch):
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=10.0)
    calls = 0
    original = orientation_cluster._extract_cluster_outline_p3d

    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(orientation_cluster, "_extract_cluster_outline_p3d", counted)

    clusters = orientation_cluster.cluster_coplanar_faces(mesh, include_upward_faces=True)

    assert len(clusters) == orientation_cluster.MAX_RETURN_CLUSTERS
    assert calls == orientation_cluster.MAX_RETURN_CLUSTERS


def test_plane_bucket_merge_keeps_disconnected_coplanar_fragments_together():
    vertices = np.array(
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [10.0, 0.0, 0.0],
            [11.0, 0.0, 0.0],
            [10.0, 1.0, 0.0],
        ]
    )
    faces = np.array([[0, 1, 2], [3, 4, 5]])
    clusters = [
        {
            "faces": [0],
            "normal": [0.0, 0.0, 1.0],
            "area": 0.5,
            "centroid": [1 / 3, 1 / 3, 0.0],
            "plane_offset": 0.0,
            "vert_indices": [0, 1, 2],
        },
        {
            "faces": [1],
            "normal": [0.0, 0.0, 1.0],
            "area": 0.5,
            "centroid": [10 + 1 / 3, 1 / 3, 0.0],
            "plane_offset": 0.0,
            "vert_indices": [3, 4, 5],
        },
    ]

    merged = orientation_cluster._merge_planar_clusters_internal(
        clusters,
        vertices,
        faces,
        orientation_cluster.COPLANAR_COS_THRESHOLD,
        0.05,
    )

    assert len(merged) == 1
    assert merged[0]["faces"] == [0, 1]
    assert merged[0]["area"] == 1.0
