import asyncio

import numpy as np
import pytest
import trimesh

from app.routes_orientation import auto_learned_orient
from calculator.cost import _apply_manual_orientation
from scipy.spatial.transform import Rotation

from calculator.orientation import get_smart_orientation_for_slicing
from calculator.orientation_math import (
    rotation_from_bed_normal,
    rotation_from_up_vector,
    rotation_to_euler,
)
from calculator.orientation_scoring import evaluate_orientation, fine_tune_orientation


def test_shared_smart_orientation_path_always_uses_geometry_v2(monkeypatch):
    calls = []

    def fake_best_face(model_path, method):
        calls.append((model_path, method))
        return {"status": "ok"}

    monkeypatch.setattr("calculator.orientation.get_best_face_for_slicing", fake_best_face)

    result = get_smart_orientation_for_slicing("part.stl")

    assert result == {"status": "ok"}
    assert calls == [("part.stl", "geometry_v2")]


def test_quote_and_preview_use_the_shared_smart_orientation_path():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    cost_source = (root / "calculator" / "cost.py").read_text(encoding="utf-8")
    route_source = (root / "app" / "routes_orientation.py").read_text(encoding="utf-8")

    assert "get_smart_orientation_for_slicing(model_path)" in cost_source
    assert "get_smart_orientation_for_slicing, tmp_path" in route_source  # asyncio.to_thread call


@pytest.mark.parametrize(
    "normal",
    [
        [0.0, 0.0, 1.0],
        [0.0, 0.0, -1.0],
        [1.0, 0.0, 0.2],
        [-0.3, 0.4, 0.866],
    ],
)
def test_bed_face_normal_is_always_rotated_toward_negative_z(normal):
    normal_arr = np.asarray(normal, dtype=np.float64)
    normal_arr /= np.linalg.norm(normal_arr)

    rotation = rotation_from_bed_normal(normal_arr)[:3, :3]

    assert rotation @ normal_arr == pytest.approx([0.0, 0.0, -1.0], abs=1e-7)


def test_rotation_euler_values_round_trip_with_threejs_xyz_convention():
    up = np.asarray([0.3, 0.4, 0.866], dtype=np.float64)
    up /= np.linalg.norm(up)
    rotation = rotation_from_up_vector(up)[:3, :3]

    euler = rotation_to_euler(rotation)
    rebuilt = Rotation.from_euler(
        "XYZ",
        [euler["x"], euler["y"], euler["z"]],
        degrees=True,
    ).as_matrix()

    assert rebuilt == pytest.approx(rotation, abs=2e-3)


def test_contact_area_excludes_empty_space_between_separate_feet():
    left = trimesh.creation.box(extents=[10.0, 10.0, 10.0])
    left.apply_translation([-15.0, 0.0, 0.0])
    right = trimesh.creation.box(extents=[10.0, 10.0, 10.0])
    right.apply_translation([15.0, 0.0, 0.0])
    mesh = trimesh.util.concatenate([left, right])

    result = evaluate_orientation(mesh, np.eye(4))

    assert result["metrics"]["base_contact_area"] == pytest.approx(200.0, abs=0.01)


def test_contact_area_does_not_depend_on_stl_triangle_winding():
    mesh = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    mesh.invert()

    result = evaluate_orientation(mesh, np.eye(4))

    assert result["metrics"]["base_contact_area"] == pytest.approx(200.0, abs=0.01)


def test_fine_tune_does_not_add_arbitrary_z_rotation_when_score_is_invariant():
    mesh = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    base_rotation = rotation_from_bed_normal(np.asarray([1.0, 0.0, 0.0]))[:3, :3]

    result = fine_tune_orientation(mesh, base_rotation)

    assert result["angle"] == 0.0
    assert result["R"] == pytest.approx(base_rotation, abs=1e-9)


def test_saved_threejs_xyz_angles_reproduce_the_preview_rotation(tmp_path):
    mesh = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    source_vertices = np.asarray(mesh.vertices, dtype=np.float64).copy()
    model_path = tmp_path / "manual-orientation.stl"
    mesh.export(model_path)
    angles = {"x": -135.0, "y": 35.2643897, "z": 75.0}

    _apply_manual_orientation(
        str(model_path),
        angles["x"],
        angles["y"],
        angles["z"],
    )

    rotated = trimesh.load(model_path, force="mesh")
    expected_rotation = Rotation.from_euler(
        "XYZ",
        [angles["x"], angles["y"], angles["z"]],
        degrees=True,
    ).as_matrix()
    expected_vertices = source_vertices @ expected_rotation.T

    actual_sorted = np.asarray(sorted(map(tuple, np.round(rotated.vertices, 4))))
    expected_sorted = np.asarray(sorted(map(tuple, np.round(expected_vertices, 4))))
    assert actual_sorted == pytest.approx(expected_sorted, abs=1e-3)


def test_auto_orientation_endpoint_returns_the_scored_rotation_matrix(monkeypatch):
    expected_matrix = [
        [0.0, 0.0, -1.0],
        [0.0, 1.0, 0.0],
        [1.0, 0.0, 0.0],
    ]

    class Upload:
        filename = "part.stl"

        async def read(self):
            return b"solid part\nendsolid part\n"

    def fake_best_face(model_path, method):
        assert method == "geometry_v2"
        return {
            "rotation_matrix": expected_matrix,
            "euler_angles_deg": {"x": 0.0, "y": -90.0, "z": 0.0},
            "score": 42.0,
            "face": {"normal": [1.0, 0.0, 0.0]},
        }

    monkeypatch.setattr("calculator.orientation.get_best_face_for_slicing", fake_best_face)

    response = asyncio.run(auto_learned_orient(request=None, file=Upload(), current_user=object()))

    assert response["rotation_matrix"] == expected_matrix
