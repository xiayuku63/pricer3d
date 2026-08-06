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


def test_manual_profile_skips_outline_work_for_curved_tessellation_fragments(monkeypatch):
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=10.0)
    calls = 0
    original = orientation_cluster._extract_cluster_outline_p3d

    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(orientation_cluster, "_extract_cluster_outline_p3d", counted)

    clusters = orientation_cluster.cluster_coplanar_faces(mesh, include_upward_faces=True)

    assert clusters == []
    assert calls == 0


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


def test_manual_profile_discards_tessellated_curve_bands():
    mesh = trimesh.creation.cylinder(radius=10.0, height=20.0, sections=256)

    clusters = orientation_cluster.cluster_coplanar_faces(mesh, include_upward_faces=True)

    assert len(clusters) == 2
    assert all(cluster["area"] > 300.0 for cluster in clusters)


def test_manual_compact_geometry_uses_shared_vertices_and_triangle_indices():
    mesh = trimesh.creation.box(extents=[20.0, 30.0, 40.0])

    clusters = orientation_cluster.cluster_coplanar_faces(
        mesh,
        include_upward_faces=True,
        compact_geometry=True,
    )

    assert len(clusters) == 6
    assert all("face_vertices" not in cluster for cluster in clusters)
    assert all(len(cluster["patch_vertices"]) == 4 for cluster in clusters)
    assert all(len(cluster["patch_indices"]) == 6 for cluster in clusters)


def test_manual_profile_prunes_small_satellite_patch_from_large_support_plane():
    large = trimesh.creation.box(extents=[20.0, 20.0, 2.0])
    large.apply_translation([0.0, 0.0, 1.0])
    satellite = trimesh.creation.box(extents=[6.0, 6.0, 2.0])
    satellite.apply_translation([15.0, 0.0, 1.0])
    mesh = trimesh.util.concatenate([large, satellite])

    clusters = orientation_cluster.cluster_coplanar_faces(
        mesh,
        include_upward_faces=True,
        compact_geometry=True,
    )

    support_planes = [cluster for cluster in clusters if cluster["normal"][2] != 0.0]
    assert len(support_planes) == 2
    assert all(cluster["area"] == 400.0 for cluster in support_planes)
    assert all(len(cluster["patch_vertices"]) == 4 for cluster in support_planes)


def test_manual_profile_keeps_equal_sized_disconnected_feet():
    left = trimesh.creation.box(extents=[10.0, 10.0, 2.0])
    left.apply_translation([-7.0, 0.0, 1.0])
    right = trimesh.creation.box(extents=[10.0, 10.0, 2.0])
    right.apply_translation([7.0, 0.0, 1.0])
    mesh = trimesh.util.concatenate([left, right])

    clusters = orientation_cluster.cluster_coplanar_faces(
        mesh,
        include_upward_faces=True,
        compact_geometry=True,
    )

    support_planes = [cluster for cluster in clusters if cluster["normal"][2] != 0.0]
    assert len(support_planes) == 2
    assert all(cluster["area"] == 200.0 for cluster in support_planes)
    assert all(len(cluster["patch_vertices"]) == 8 for cluster in support_planes)
