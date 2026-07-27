from __future__ import annotations

import asyncio
import io
import subprocess
import zipfile
from pathlib import Path

import numpy as np
import trimesh
from fastapi import UploadFile

from app.routes_orientation import list_coplanar_clusters
from calculator.orientation import _load_mesh, apply_orientation_to_mesh
from calculator.orientation_scoring import get_stable_faces


_NSMAP = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"


def _cube_model_xml() -> bytes:
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
  <build><item objectid="1"/></build>
</model>'''.encode("utf-8")


def _write_3mf(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("3D/Objects/3dmodel.model", _cube_model_xml())



def _fake_step_converter(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr("parser.model_pipeline.prusa_executable", lambda: "fake-prusa-slicer")

    def fake_run(command, **kwargs):
        calls.append(command)
        output_path = Path(command[command.index("--output") + 1])
        trimesh.creation.box(extents=[10, 20, 30]).export(output_path, file_type="stl")
        return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")

    monkeypatch.setattr("parser.model_pipeline.subprocess.run", fake_run)
    return calls

def test_orientation_loader_normalizes_3mf_to_usable_mesh(tmp_path: Path):
    source = tmp_path / "cube.3mf"
    _write_3mf(source)

    mesh = _load_mesh(str(source))

    assert isinstance(mesh, trimesh.Trimesh)
    assert len(mesh.faces) == 12
    assert mesh.extents.tolist() == [10.0, 10.0, 10.0]


def test_orientation_loader_uses_shared_step_converter(tmp_path: Path, monkeypatch):
    source = tmp_path / "part.stp"
    source.write_text("ISO-10303-21; ORIENTATION-LOADER", encoding="ascii")
    calls: list[list[str]] = []

    monkeypatch.setattr("parser.model_pipeline.prusa_executable", lambda: "fake-prusa-slicer")

    def fake_run(command, **kwargs):
        calls.append(command)
        output_path = Path(command[command.index("--output") + 1])
        trimesh.creation.box(extents=[10, 20, 30]).export(output_path, file_type="stl")
        return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")

    monkeypatch.setattr("parser.model_pipeline.subprocess.run", fake_run)

    mesh = _load_mesh(str(source))

    assert calls and calls[0][0] == "fake-prusa-slicer"
    assert mesh.extents.tolist() == [10.0, 20.0, 30.0]


def test_manual_coplanar_route_accepts_3mf(tmp_path: Path):
    source = tmp_path / "cube.3mf"
    _write_3mf(source)
    upload = UploadFile(filename="cube.3mf", file=io.BytesIO(source.read_bytes()))

    result = asyncio.run(list_coplanar_clusters(request=None, file=upload, current_user=object()))

    assert result["filename"] == "cube.3mf"
    assert result["clusters"]


def test_stable_face_discovery_uses_shared_step_converter(tmp_path: Path, monkeypatch):
    source = tmp_path / "part.stp"
    source.write_text("ISO-10303-21; STABLE-FACES", encoding="ascii")
    calls = _fake_step_converter(monkeypatch)

    result = get_stable_faces(str(source))

    assert calls and result["faces"]


def test_smart_orientation_exports_a_step_mesh_after_normalization(tmp_path: Path, monkeypatch):
    source = tmp_path / "part.stp"
    source.write_text("ISO-10303-21; APPLY-ORIENTATION", encoding="ascii")
    calls = _fake_step_converter(monkeypatch)

    output = apply_orientation_to_mesh(str(source), np.eye(3))
    try:
        assert calls
        assert Path(output).exists()
        assert Path(output).stat().st_size > 0
    finally:
        Path(output).unlink(missing_ok=True)


def test_repeated_step_normalization_reuses_cached_stl(tmp_path: Path, monkeypatch):
    source = tmp_path / "cached-part.stp"
    source.write_text("ISO-10303-21; CACHE-REUSE", encoding="ascii")
    calls = _fake_step_converter(monkeypatch)

    first = _load_mesh(str(source))
    second = _load_mesh(str(source))

    assert calls and len(calls) == 1
    assert first.extents.tolist() == second.extents.tolist()
