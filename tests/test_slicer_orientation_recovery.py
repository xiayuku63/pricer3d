from pathlib import Path

import trimesh

from calculator.cost import _is_first_layer_extrusion_error, _retry_slice_with_axis_orientations


def test_axis_orientation_recovery_retries_with_a_temporary_stl(tmp_path, monkeypatch):
    source = tmp_path / "edge_contact.stl"
    trimesh.creation.box(extents=[10, 20, 30]).export(source, file_type="stl")
    calls: list[str] = []

    def fake_run(model_path, output_gcode_path, **kwargs):
        calls.append(model_path)
        return {"time_s": 60, "filament_g": 1.0}

    monkeypatch.setattr("calculator.cost.run_prusa_slice", fake_run)

    recovered = _retry_slice_with_axis_orientations(
        str(source),
        str(tmp_path / "result.gcode"),
        {"layer_height": 0.2},
    )

    assert recovered is not None
    stats, euler = recovered
    assert stats["time_s"] == 60
    assert euler == {"x": 0.0, "y": 90.0, "z": 0.0}
    assert len(calls) == 1
    assert not Path(calls[0]).exists()


def test_first_layer_error_is_the_only_recoverable_slicer_error():
    assert _is_first_layer_extrusion_error(RuntimeError("There is an object with no extrusions in the first layer."))
    assert not _is_first_layer_extrusion_error(RuntimeError("No such file"))
