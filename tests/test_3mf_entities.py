import asyncio
import json
import struct
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import UploadFile

from app import routes_preview
from parser.model_pipeline import build_prusaslicer_multicolor_3mf, load_3mf_entities, normalize_model


CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROD_NS = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"


def _tetra_mesh(offset_x: float = 0) -> str:
    return f"""
    <mesh>
      <vertices>
        <vertex x="{offset_x}" y="0" z="0"/>
        <vertex x="{offset_x + 10}" y="0" z="0"/>
        <vertex x="{offset_x}" y="10" z="0"/>
        <vertex x="{offset_x}" y="0" z="10"/>
      </vertices>
      <triangles>
        <triangle v1="0" v2="2" v3="1"/>
        <triangle v1="0" v2="1" v3="3"/>
        <triangle v1="0" v2="3" v3="2"/>
        <triangle v1="1" v2="2" v3="3"/>
      </triangles>
    </mesh>
    """


def _write_multi_entity_3mf(path: Path) -> None:
    root_model = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="{CORE_NS}" xmlns:p="{PROD_NS}" requiredextensions="p">
  <resources>
    <object id="10" type="model">
      <components>
        <component objectid="1" p:path="/3D/Objects/parts.model"/>
        <component objectid="2" p:path="/3D/Objects/parts.model" transform="1 0 0 0 1 0 0 0 1 25 0 0"/>
      </components>
    </object>
  </resources>
  <build><item objectid="10" transform="1 0 0 0 1 0 0 0 1 5 7 9"/></build>
</model>'''
    parts_model = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="{CORE_NS}">
  <resources>
    <object id="1" type="model">{_tetra_mesh()}</object>
    <object id="2" type="model">{_tetra_mesh()}</object>
  </resources>
</model>'''
    model_settings = '''<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="10">
    <metadata key="extruder" value="1"/>
    <part id="1"><metadata key="name" value="Body"/><metadata key="extruder" value="1"/></part>
    <part id="2"><metadata key="name" value="Label"/><metadata key="extruder" value="2"/></part>
  </object>
</config>'''
    project_settings = json.dumps({"filament_colour": ["#112233", "#AABBCC"]})

    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("3D/3dmodel.model", root_model)
        archive.writestr("3D/Objects/parts.model", parts_model)
        archive.writestr("Metadata/model_settings.config", model_settings)
        archive.writestr("Metadata/project_settings.config", project_settings)


def _glb_json(payload: bytes) -> dict:
    assert payload[:4] == b"glTF"
    offset = 12
    while offset < len(payload):
        chunk_length, chunk_type = struct.unpack_from("<II", payload, offset)
        offset += 8
        chunk = payload[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            return json.loads(chunk.rstrip(b" \0"))
    raise AssertionError("GLB JSON chunk missing")


def test_load_3mf_entities_preserves_external_components_names_colors_and_transforms(tmp_path):
    source = tmp_path / "multi.3mf"
    _write_multi_entity_3mf(source)

    entities = load_3mf_entities(str(source))

    assert [entity.name for entity in entities] == ["Body", "Label"]
    assert [entity.color for entity in entities] == ["#112233", "#AABBCC"]
    assert entities[0].vertices.min(axis=0).tolist() == pytest.approx([5, 7, 9])
    assert entities[1].vertices.min(axis=0).tolist() == pytest.approx([30, 7, 9])
    assert all(len(entity.faces) == 4 for entity in entities)
    assert len({entity.entity_id for entity in entities}) == 2


def test_3mf_scene_preview_exports_one_named_glb_mesh_per_entity(tmp_path):
    source = tmp_path / "multi.3mf"
    _write_multi_entity_3mf(source)
    upload = UploadFile(filename="multi.3mf", file=BytesIO(source.read_bytes()))

    response = asyncio.run(routes_preview.preview_3mf_scene(upload))
    gltf = _glb_json(response.body)

    assert response.media_type == "model/gltf-binary"
    assert response.headers["x-3mf-entity-count"] == "2"
    extras = [mesh.get("extras", {}) for mesh in gltf["meshes"]]
    assert {item["entity_name"] for item in extras} == {"Body", "Label"}
    assert {item["source_color"] for item in extras} == {"#112233", "#AABBCC"}
    assert len(gltf["meshes"]) == 2

def test_normalization_uses_the_same_transformed_entities_as_3mf_preview(tmp_path):
    source = tmp_path / "multi.3mf"
    _write_multi_entity_3mf(source)

    normalized = normalize_model(str(source))
    try:
        import trimesh

        mesh = trimesh.load(normalized.mesh_path, force="mesh", process=False)
        assert mesh.bounds[:, 0].tolist() == pytest.approx([5, 40])
        assert mesh.bounds[:, 1].tolist() == pytest.approx([7, 17])
        assert mesh.bounds[:, 2].tolist() == pytest.approx([9, 19])
    finally:
        normalized.cleanup()

def test_load_3mf_entities_splits_triangle_material_colors(tmp_path):
    source = tmp_path / "triangle-colors.3mf"
    model = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="{CORE_NS}">
  <resources>
    <basematerials id="7">
      <base name="Red" displaycolor="#FF0000FF"/>
      <base name="Blue" displaycolor="#0000FFFF"/>
    </basematerials>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/>
          <vertex x="0" y="0" z="10"/><vertex x="10" y="10" z="0"/><vertex x="10" y="0" z="10"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" pid="7" p1="0"/>
          <triangle v1="3" v2="4" v3="5" pid="7" p1="1"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>'''
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("3D/3dmodel.model", model)

    entities = load_3mf_entities(str(source))

    assert len(entities) == 2
    assert [entity.color for entity in entities] == ["#FF0000", "#0000FF"]
    assert [len(entity.faces) for entity in entities] == [1, 1]


def test_multicolor_prusa_project_preserves_entities_colors_and_extruder_slots(tmp_path):
    source = tmp_path / "multi.3mf"
    output = tmp_path / "multicolor-project.3mf"
    _write_multi_entity_3mf(source)

    result = build_prusaslicer_multicolor_3mf(
        str(source),
        str(output),
        entity_colors={
            "3D/Objects/parts.model:1:1": {"color": "#CC0000"},
            "3D/Objects/parts.model:2:1": {"color": "#0000CC"},
        },
        euler_angles_deg={"x": 0, "y": 0, "z": 90},
    )

    assert output.exists()
    assert result["entity_count"] == 2
    assert result["colors"] == ["#CC0000", "#0000CC"]
    assert [item["extruder"] for item in result["slots"]] == [1, 2]
    with zipfile.ZipFile(output) as archive:
        config = archive.read("Metadata/Slic3r_PE_model.config").decode("utf-8")
        model = archive.read("3D/3dmodel.model").decode("utf-8")
    assert 'key="extruder" value="1"' in config
    assert 'key="extruder" value="2"' in config
    assert model.count('<object id=') == 2
    # The first tetrahedron was at x=5..15 / y=7..17.  A 90-degree Z rotation
    # changes the plane; this proves the project carries manual placement too.
    assert 'vertex x="-7" y="5" z="9"' in model
