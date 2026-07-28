import numpy as np
import trimesh

from calculator.orientation_cluster import cluster_coplanar_faces


def test_manual_placement_accepts_a_single_large_triangle_face():
    vertices = np.array(
        [
            [0.0, 0.0, 0.0],
            [20.0, 0.0, 0.0],
            [0.0, 20.0, 0.0],
            [0.0, 0.0, 20.0],
        ]
    )
    faces = np.array(
        [
            [0, 2, 1],
            [0, 1, 3],
            [0, 3, 2],
            [1, 2, 3],
        ]
    )
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)

    clusters = cluster_coplanar_faces(mesh, include_upward_faces=True)

    assert len(clusters) == 4
    assert max(cluster["area"] for cluster in clusters) > 300.0


def test_manual_placement_scales_the_minimum_face_area_for_small_models():
    mesh = trimesh.creation.box(extents=[2.0, 2.0, 2.0])

    manual_clusters = cluster_coplanar_faces(mesh, include_upward_faces=True)
    automatic_clusters = cluster_coplanar_faces(mesh, include_upward_faces=False)

    assert len(manual_clusters) == 6
    assert automatic_clusters == []
