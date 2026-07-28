import os

import numpy as np
import pytest
import trimesh

from calculator.orientation import get_best_face_for_slicing
from calculator.orientation_cluster import get_convex_hull_candidate_planes
from calculator.orientation_scoring import evaluate_orientation


def test_convex_hull_candidates_cover_all_box_supporting_planes():
    mesh = trimesh.creation.box(extents=[20.0, 30.0, 10.0])

    planes = get_convex_hull_candidate_planes(mesh)

    assert len(planes) == 6
    assert planes[0]["area"] == pytest.approx(600.0, abs=0.01)


def test_bed_contact_faces_are_not_counted_as_effective_overhang():
    mesh = trimesh.creation.box(extents=[20.0, 30.0, 10.0])

    result = evaluate_orientation(mesh, np.eye(4))
    metrics = result["metrics"]

    assert metrics["overhang_area"] == pytest.approx(0.0, abs=0.01)
    assert metrics["support_volume_estimate"] == pytest.approx(0.0, abs=0.01)
    assert metrics["support_island_count"] == 0


def test_support_island_count_tracks_disconnected_overhang_regions():
    base = trimesh.creation.box(extents=[30.0, 20.0, 2.0])
    base.apply_translation([0.0, 0.0, 1.0])
    left = trimesh.creation.box(extents=[5.0, 5.0, 2.0])
    left.apply_translation([-8.0, 0.0, 6.0])
    right = trimesh.creation.box(extents=[5.0, 5.0, 2.0])
    right.apply_translation([8.0, 0.0, 6.0])
    mesh = trimesh.util.concatenate([base, left, right])

    metrics = evaluate_orientation(mesh, np.eye(4))["metrics"]

    assert metrics["support_island_count"] == 2
    assert metrics["support_volume_estimate"] > 0


def test_stability_margin_is_positive_for_centered_box():
    mesh = trimesh.creation.box(extents=[20.0, 30.0, 10.0])

    metrics = evaluate_orientation(mesh, np.eye(4))["metrics"]

    assert metrics["stability_margin"] == pytest.approx(10.0, abs=0.01)
    assert metrics["stable"] is True


def test_small_models_are_ranked_instead_of_rejected_by_absolute_contact_area(tmp_path, monkeypatch):
    model_path = tmp_path / "small-cube.stl"
    trimesh.creation.box(extents=[10.0, 10.0, 10.0]).export(model_path)
    called = False

    def unexpected_slice(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("smart placement must not run a real slicer")

    monkeypatch.setattr("calculator.orientation.slice_with_prusaslicer", unexpected_slice)

    result = get_best_face_for_slicing(str(model_path), method="learned")

    assert result["fallback"] is False
    assert result["score"] > 0
    assert called is False
    assert result["all_candidates"]
    assert all("face_vertices" not in item["face"] for item in result["all_candidates"])

    oriented_path = result.get("oriented_path")
    if oriented_path and oriented_path != str(model_path) and os.path.exists(oriented_path):
        os.unlink(oriented_path)
