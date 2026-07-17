"""Regression tests for lay-on-face coplanar clustering."""

from pathlib import Path

import trimesh

from calculator.orientation_cluster import cluster_coplanar_faces


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_reversed_winding_cube_keeps_all_outer_contact_planes():
    """Convex-hull filtering must not depend on STL triangle winding."""
    mesh = trimesh.load(PROJECT_ROOT / "static" / "test_cube.stl", force="mesh")

    clusters = cluster_coplanar_faces(mesh, include_upward_faces=True)

    assert len(clusters) == 6
    assert [cluster["area"] for cluster in clusters] == [1600.0] * 6
