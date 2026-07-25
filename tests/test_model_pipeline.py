"""Smoke tests for the unified model normalization pipeline."""

from __future__ import annotations

import subprocess
import zipfile
from pathlib import Path

import pytest
import trimesh

from parser.geometry import calculate_geometry
from parser.model_pipeline import ModelNormalizationError, normalize_model


_NSMAP = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"


def _cube_model_xml(*, transform: str | None = None) -> bytes:
    transform_attr = f' transform="{transform}"' if transform else ""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="{_NSMAP}">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/>
          <vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="0"/>
          <vertex x="0" y="0" z="10"/><vertex x="10" y="0" z="10"/>
          <vertex x="10" y="10" z="10"/><vertex x="0" y="10" z="10"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="3"/>
          <triangle v1="4" v2="6" v3="5"/><triangle v1="4" v2="7" v3="6"/>
          <triangle v1="0" v2="4" v3="5"/><triangle v1="0" v2="5" v3="1"/>
          <triangle v1="1" v2="5" v3="6"/><triangle v1="1" v2="6" v3="2"/>
          <triangle v1="2" v2="6" v3="7"/><triangle v1="2" v2="7" v3="3"/>
          <triangle v1="4" v2="0" v3="3"/><triangle v1="4" v2="3" v3="7"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"{transform_attr}/></build>
</model>'''.encode("utf-8")


def _write_3mf(path: Path, xml: bytes) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("3D/Objects/3dmodel.model", xml)


def test_native_3mf_normalizes_to_stl_and_calculates_geometry(tmp_path: Path):
    source = tmp_path / "cube.3mf"
    _write_3mf(source, _cube_model_xml())

    normalized = normalize_model(str(source))
    try:
        assert normalized.source_extension == ".3mf"
        assert normalized.normalized_extension == ".stl"
        assert Path(normalized.mesh_path).exists()
        volume, surface_area, dimensions = calculate_geometry(str(source))
    finally:
        normalized.cleanup()

    assert volume == pytest.approx(1000.0, rel=0.001)
    assert surface_area == pytest.approx(600.0, rel=0.001)
    assert dimensions == {"x": 10.0, "y": 10.0, "z": 10.0}


def test_3mf_build_transform_is_applied(tmp_path: Path):
    source = tmp_path / "translated.3mf"
    _write_3mf(source, _cube_model_xml(transform="1 0 0 0 1 0 0 0 1 20 30 40"))

    volume, _, dimensions = calculate_geometry(str(source))

    assert volume == pytest.approx(1000.0, rel=0.001)
    assert dimensions == {"x": 10.0, "y": 10.0, "z": 10.0}


def test_invalid_3mf_returns_structured_error(tmp_path: Path):
    source = tmp_path / "broken.3mf"
    source.write_bytes(b"not a zip")

    with pytest.raises(ModelNormalizationError) as exc_info:
        normalize_model(str(source))

    assert exc_info.value.code == "3MF_ZIP_INVALID"


def test_step_uses_detected_prusaslicer_and_preserves_source(tmp_path: Path, monkeypatch):
    source = tmp_path / "part.step"
    source.write_text("ISO-10303-21;", encoding="ascii")
    calls: list[list[str]] = []

    monkeypatch.setattr("parser.model_pipeline.prusa_executable", lambda: "fake-prusa-slicer")

    def fake_run(command, **kwargs):
        calls.append(command)
        output_path = Path(command[command.index("--output") + 1])
        trimesh.creation.box(extents=[10, 10, 10]).export(output_path, file_type="stl")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr("parser.model_pipeline.subprocess.run", fake_run)

    normalized = normalize_model(str(source))
    try:
        assert calls[0][0] == "fake-prusa-slicer"
        assert "--export-stl" in calls[0]
        assert Path(normalized.mesh_path).exists()
        assert source.read_text(encoding="ascii") == "ISO-10303-21;"
    finally:
        normalized.cleanup()
