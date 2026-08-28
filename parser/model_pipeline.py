"""Unified model normalization for pricing, preview, and slicing.

The application accepts several 3D formats, but downstream operations need one
predictable triangulated mesh.  This module keeps the uploaded source intact and
creates a temporary STL representation for OBJ/3MF/STEP when necessary.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import posixpath
import subprocess
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape as xml_escape
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import trimesh

from parser.prusa_slicer import (
    _executable_command,
    prusa_executable,
    prusa_execution_lock,
    translate_path_for_executable,
)

logger = logging.getLogger(__name__)

SUPPORTED_MODEL_EXTENSIONS = {".stl", ".stp", ".step", ".obj", ".3mf"}
_STEP_EXTENSIONS = {".stp", ".step"}
_3MF_MESH_EXTENSIONS = {".stl", ".obj", ".ply", ".off"}

# STEP conversion is the dominant cost of non-STL preview.  Preview, quote,
# orientation, and slicing can all request the same uploaded bytes, so keep a
# normalized STL cache keyed by source content. The cache lives under the
# system temp directory and is intentionally not returned as a temporary
# artifact owned by one request. It is shared across processes: cache keys
# are content-addressed and entries are written atomically (temp dir +
# os.replace), so concurrent servers/workers can safely reuse it.
_MODEL_CACHE_ROOT = Path(tempfile.gettempdir()) / "pricer3d_model_cache"
_MODEL_CACHE_GUARD = threading.Lock()
_MODEL_CACHE_LOCKS: dict[str, threading.Lock] = {}
_STALE_CACHE_DIR_PREFIX = "pricer3d_model_cache_"
_STALE_CACHE_DIR_MAX_AGE_S = 7 * 24 * 3600


def _cleanup_stale_model_cache_dirs() -> None:
    """Best-effort removal of superseded per-PID cache directories left by
    older builds (pricer3d_model_cache_<pid>), which were never cleaned."""
    try:
        now = time.time()
        for entry in Path(tempfile.gettempdir()).glob(f"{_STALE_CACHE_DIR_PREFIX}*"):
            try:
                if now - entry.stat().st_mtime > _STALE_CACHE_DIR_MAX_AGE_S:
                    shutil.rmtree(entry, ignore_errors=True)
            except OSError:
                continue
    except OSError:
        pass


_cleanup_stale_model_cache_dirs()


def _model_cache_lock(key: str) -> threading.Lock:
    with _MODEL_CACHE_GUARD:
        return _MODEL_CACHE_LOCKS.setdefault(key, threading.Lock())


def _source_digest(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _cached_mesh_path(path: str, extension: str) -> tuple[str, str]:
    source_key = _source_digest(path)
    converter_key = prusa_executable() if extension in _STEP_EXTENSIONS else "native-3mf"
    cache_key = hashlib.sha256(
        f"{extension}\0{converter_key}\0{source_key}".encode("utf-8")
    ).hexdigest()
    return cache_key, str(_MODEL_CACHE_ROOT / f"{cache_key}.stl")


class ModelNormalizationError(RuntimeError):
    """Raised when an uploaded model cannot be converted to a usable mesh."""

    def __init__(self, message: str, *, code: str = "MODEL_NORMALIZATION_FAILED") -> None:
        super().__init__(message)
        self.code = code


@dataclass
class NormalizedModel:
    """Source and derived paths for one model-processing operation."""

    source_path: str
    mesh_path: str
    source_extension: str
    normalized_extension: str = ".stl"
    temporary_paths: list[str] = field(default_factory=list)
    temporary_dirs: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def cleanup(self) -> None:
        """Remove derived temporary artifacts, but never remove the source."""
        for path in self.temporary_paths:
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except OSError:
                logger.warning("Failed to clean normalized model artifact: %s", path)
        self.temporary_paths.clear()
        for directory in self.temporary_dirs:
            try:
                if directory and os.path.isdir(directory):
                    os.rmdir(directory)
            except OSError:
                logger.debug("Normalized model temp directory was not empty: %s", directory)
        self.temporary_dirs.clear()


_UNIT_TO_MM = {
    "micron": 0.001,
    "millimeter": 1.0,
    "centimeter": 10.0,
    "inch": 25.4,
    "foot": 304.8,
    "meter": 1000.0,
}


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in list(element) if _local_name(child.tag) == name]


def _first_child(element: ET.Element, name: str) -> Optional[ET.Element]:
    for child in list(element):
        if _local_name(child.tag) == name:
            return child
    return None


def _parse_float(value: Optional[str], default: float = 0.0) -> float:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _parse_3mf_transform(raw: Optional[str]) -> np.ndarray:
    """Return a homogeneous matrix for the 3MF twelve-value transform."""
    if not raw:
        return np.eye(4, dtype=np.float64)
    try:
        values = [float(part) for part in raw.split()]
    except (TypeError, ValueError):
        return np.eye(4, dtype=np.float64)
    if len(values) != 12:
        return np.eye(4, dtype=np.float64)

    # 3MF stores the 3x3 matrix followed by translation (row-major groups).
    return np.array(
        [
            [values[0], values[1], values[2], values[9]],
            [values[3], values[4], values[5], values[10]],
            [values[6], values[7], values[8], values[11]],
            [0.0, 0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


def _apply_transform(vertices: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    if vertices.size == 0:
        return vertices
    homogeneous = np.concatenate(
        [vertices, np.ones((len(vertices), 1), dtype=np.float64)], axis=1
    )
    return (homogeneous @ matrix.T)[:, :3]


def _mesh_arrays_from_object(object_element: ET.Element, unit_scale: float) -> Optional[tuple[np.ndarray, np.ndarray]]:
    mesh_element = _first_child(object_element, "mesh")
    if mesh_element is None:
        return None
    vertices_element = _first_child(mesh_element, "vertices")
    triangles_element = _first_child(mesh_element, "triangles")
    if vertices_element is None or triangles_element is None:
        return None

    vertices: list[list[float]] = []
    for vertex in _children(vertices_element, "vertex"):
        vertices.append(
            [
                _parse_float(vertex.attrib.get("x")) * unit_scale,
                _parse_float(vertex.attrib.get("y")) * unit_scale,
                _parse_float(vertex.attrib.get("z")) * unit_scale,
            ]
        )
    if not vertices:
        return None

    faces: list[list[int]] = []
    for triangle in _children(triangles_element, "triangle"):
        try:
            face = [
                int(triangle.attrib["v1"]),
                int(triangle.attrib["v2"]),
                int(triangle.attrib["v3"]),
            ]
        except (KeyError, TypeError, ValueError):
            continue
        if all(0 <= index < len(vertices) for index in face) and len(set(face)) == 3:
            faces.append(face)
    if not faces:
        return None
    return np.asarray(vertices, dtype=np.float64), np.asarray(faces, dtype=np.int64)


def _parse_3mf_model(xml_data: bytes) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Parse 3MF objects and build items, including component transforms."""
    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError as exc:
        raise ModelNormalizationError("3MF 模型 XML 无法解析", code="3MF_XML_INVALID") from exc

    unit = (root.attrib.get("unit") or "millimeter").lower()
    unit_scale = _UNIT_TO_MM.get(unit, 1.0)
    if unit not in _UNIT_TO_MM and unit:
        logger.warning("Unknown 3MF unit '%s'; treating values as millimeters", unit)

    resources = _first_child(root, "resources")
    if resources is None:
        return [], []

    objects: dict[str, ET.Element] = {}
    for object_element in _children(resources, "object"):
        object_id = object_element.attrib.get("id")
        if object_id:
            objects[object_id] = object_element

    def resolve_object(object_id: str, transform: np.ndarray, stack: tuple[str, ...] = ()) -> list[tuple[np.ndarray, np.ndarray]]:
        if object_id in stack:
            raise ModelNormalizationError("3MF 组件引用存在循环", code="3MF_COMPONENT_CYCLE")
        object_element = objects.get(object_id)
        if object_element is None:
            return []

        resolved: list[tuple[np.ndarray, np.ndarray]] = []
        arrays = _mesh_arrays_from_object(object_element, unit_scale)
        if arrays is not None:
            vertices, faces = arrays
            resolved.append((_apply_transform(vertices, transform), faces))

        components = _first_child(object_element, "components")
        if components is not None:
            for component in _children(components, "component"):
                component_id = component.attrib.get("objectid")
                if not component_id:
                    continue
                child_transform = transform @ _parse_3mf_transform(component.attrib.get("transform"))
                resolved.extend(resolve_object(component_id, child_transform, stack + (object_id,)))
        return resolved

    build_items: list[ET.Element] = []
    build = _first_child(root, "build")
    if build is not None:
        build_items = _children(build, "item")

    resolved_parts: list[tuple[np.ndarray, np.ndarray]] = []
    if build_items:
        for item in build_items:
            object_id = item.attrib.get("objectid")
            if object_id:
                resolved_parts.extend(
                    resolve_object(object_id, _parse_3mf_transform(item.attrib.get("transform")))
                )
    else:
        # Some producers omit <build>; keep a useful fallback for standalone
        # object models instead of returning an empty mesh.
        for object_id in objects:
            resolved_parts.extend(resolve_object(object_id, np.eye(4, dtype=np.float64)))

    vertices_out: list[np.ndarray] = []
    faces_out: list[np.ndarray] = []
    vertex_offset = 0
    for vertices, faces in resolved_parts:
        vertices_out.append(vertices)
        faces_out.append(faces + vertex_offset)
        vertex_offset += len(vertices)
    return vertices_out, faces_out



@dataclass
class ThreeMFEntity:
    entity_id: str
    name: str
    vertices: np.ndarray
    faces: np.ndarray
    color: Optional[str] = None
    source_object_id: str = ""


def _attribute_by_local_name(element: ET.Element, name: str) -> Optional[str]:
    for key, value in element.attrib.items():
        if _local_name(key) == name:
            return value
    return None


def _normalize_3mf_color(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    value = raw.strip().upper()
    if not value.startswith("#"):
        value = f"#{value}"
    if len(value) == 9:
        value = value[:7]
    if len(value) != 7:
        return None
    try:
        int(value[1:], 16)
    except ValueError:
        return None
    return value


def _parse_3mf_property_colors(resources: Optional[ET.Element]) -> dict[tuple[str, int], str]:
    colors: dict[tuple[str, int], str] = {}
    if resources is None:
        return colors
    for group in list(resources):
        group_name = _local_name(group.tag)
        if group_name not in {"basematerials", "colorgroup"}:
            continue
        resource_id = group.attrib.get("id")
        if not resource_id:
            continue
        for index, item in enumerate(list(group)):
            raw_color = item.attrib.get("displaycolor") or item.attrib.get("color")
            color = _normalize_3mf_color(raw_color)
            if color:
                colors[(resource_id, index)] = color
    return colors


def _metadata_value(element: ET.Element, key: str) -> Optional[str]:
    for child in _children(element, "metadata"):
        if child.attrib.get("key") == key:
            return child.attrib.get("value")
    return None


def _parse_bambu_3mf_parts(archive: zipfile.ZipFile) -> dict[str, dict[str, object]]:
    filament_colors: list[Optional[str]] = []
    if "Metadata/project_settings.config" in archive.namelist():
        try:
            settings = json.loads(archive.read("Metadata/project_settings.config").decode("utf-8-sig"))
            filament_colors = [
                _normalize_3mf_color(str(raw))
                for raw in settings.get("filament_colour", [])
            ]
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
            filament_colors = []

    parts: dict[str, dict[str, object]] = {}
    if "Metadata/model_settings.config" not in archive.namelist():
        return parts
    try:
        root = ET.fromstring(archive.read("Metadata/model_settings.config"))
    except ET.ParseError:
        return parts

    for object_element in _children(root, "object"):
        object_extruder = _metadata_value(object_element, "extruder")
        for part in _children(object_element, "part"):
            part_id = part.attrib.get("id")
            if not part_id:
                continue
            name = _metadata_value(part, "name")
            raw_extruder = _metadata_value(part, "extruder") or object_extruder
            try:
                extruder = int(raw_extruder) if raw_extruder else None
            except ValueError:
                extruder = None
            color = None
            if extruder is not None and 1 <= extruder <= len(filament_colors):
                color = filament_colors[extruder - 1]
            parts[part_id] = {"name": name, "extruder": extruder, "color": color}
    return parts


def _normalized_package_path(raw: str, current_document: str) -> str:
    path = raw.replace("\\", "/")
    if path.startswith("/"):
        return posixpath.normpath(path.lstrip("/"))
    return posixpath.normpath(posixpath.join(posixpath.dirname(current_document), path))


def load_3mf_entities(path: str) -> list[ThreeMFEntity]:
    """Load build instances as separate transformed meshes with display colors."""
    try:
        with zipfile.ZipFile(path, "r") as archive:
            if archive.testzip() is not None:
                raise ModelNormalizationError("3MF archive is corrupt", code="3MF_ZIP_INVALID")
            document_names = [
                name.replace("\\", "/").lstrip("/")
                for name in archive.namelist()
                if name.lower().endswith(".model") and name.replace("\\", "/").startswith("3D/")
            ]
            if not document_names:
                raise ModelNormalizationError("3MF contains no model document", code="3MF_OBJECTS_MISSING")

            documents: dict[str, dict[str, object]] = {}
            for document_name in document_names:
                try:
                    root = ET.fromstring(archive.read(document_name))
                except ET.ParseError as exc:
                    raise ModelNormalizationError("3MF model XML is invalid", code="3MF_XML_INVALID") from exc
                resources = _first_child(root, "resources")
                objects: dict[str, ET.Element] = {}
                if resources is not None:
                    for object_element in _children(resources, "object"):
                        object_id = object_element.attrib.get("id")
                        if object_id:
                            objects[object_id] = object_element
                unit = (root.attrib.get("unit") or "millimeter").lower()
                documents[document_name] = {
                    "root": root,
                    "objects": objects,
                    "unit_scale": _UNIT_TO_MM.get(unit, 1.0),
                    "colors": _parse_3mf_property_colors(resources),
                }

            root_document = "3D/3dmodel.model" if "3D/3dmodel.model" in documents else document_names[0]
            bambu_parts = _parse_bambu_3mf_parts(archive)
            entities: list[ThreeMFEntity] = []
            instance_counts: dict[tuple[str, str], int] = {}

            def resolve_object(
                document_name: str,
                object_id: str,
                transform: np.ndarray,
                stack: tuple[tuple[str, str], ...] = (),
            ) -> None:
                key = (document_name, object_id)
                if key in stack:
                    raise ModelNormalizationError("3MF component cycle", code="3MF_COMPONENT_CYCLE")
                document = documents.get(document_name)
                if document is None:
                    return
                object_element = document["objects"].get(object_id)
                if object_element is None:
                    return

                arrays = _mesh_arrays_from_object(object_element, float(document["unit_scale"]))
                if arrays is not None:
                    vertices, faces = arrays
                    instance_key = (document_name, object_id)
                    instance_index = instance_counts.get(instance_key, 0) + 1
                    instance_counts[instance_key] = instance_index
                    part_metadata = bambu_parts.get(object_id, {})
                    entity_name = str(
                        part_metadata.get("name")
                        or object_element.attrib.get("name")
                        or f"Entity {len(entities) + 1}"
                    )

                    object_color = part_metadata.get("color")
                    if not object_color:
                        pid = object_element.attrib.get("pid")
                        raw_index = object_element.attrib.get("pindex")
                        if pid and raw_index is not None:
                            try:
                                object_color = document["colors"].get((pid, int(raw_index)))
                            except ValueError:
                                object_color = None

                    mesh_element = _first_child(object_element, "mesh")
                    triangles_element = _first_child(mesh_element, "triangles") if mesh_element is not None else None
                    triangle_colors: list[Optional[str]] = []
                    if triangles_element is not None:
                        for triangle in _children(triangles_element, "triangle"):
                            triangle_color = object_color
                            pid = triangle.attrib.get("pid")
                            raw_index = triangle.attrib.get("p1")
                            if pid and raw_index is not None:
                                try:
                                    triangle_color = document["colors"].get((pid, int(raw_index))) or triangle_color
                                except ValueError:
                                    pass
                            triangle_colors.append(str(triangle_color) if triangle_color else None)

                    distinct_colors = list(dict.fromkeys(triangle_colors))
                    if len(distinct_colors) <= 1:
                        groups = [(None, np.arange(len(faces), dtype=np.int64))]
                    else:
                        groups = [
                            (color, np.asarray([index for index, item in enumerate(triangle_colors) if item == color], dtype=np.int64))
                            for color in distinct_colors
                        ]

                    for group_index, (group_color, group_face_indices) in enumerate(groups):
                        if len(group_face_indices) == 0:
                            continue
                        group_faces = faces[group_face_indices]
                        used_vertices = np.unique(group_faces.reshape(-1))
                        remap = {int(old): index for index, old in enumerate(used_vertices)}
                        local_faces = np.asarray(
                            [[remap[int(vertex)] for vertex in face] for face in group_faces],
                            dtype=np.int64,
                        )
                        color = group_color or object_color
                        suffix = f":part{group_index + 1}" if len(groups) > 1 else ""
                        entities.append(
                            ThreeMFEntity(
                                entity_id=f"{document_name}:{object_id}:{instance_index}{suffix}",
                                name=entity_name + (f" ({color})" if len(groups) > 1 and color else ""),
                                vertices=_apply_transform(vertices[used_vertices], transform),
                                faces=local_faces,
                                color=str(color) if color else None,
                                source_object_id=object_id,
                            )
                        )

                components = _first_child(object_element, "components")
                if components is None:
                    return
                for component in _children(components, "component"):
                    component_id = component.attrib.get("objectid")
                    if not component_id:
                        continue
                    raw_path = _attribute_by_local_name(component, "path")
                    target_document = (
                        _normalized_package_path(raw_path, document_name)
                        if raw_path else document_name
                    )
                    child_transform = transform @ _parse_3mf_transform(component.attrib.get("transform"))
                    resolve_object(target_document, component_id, child_transform, stack + (key,))

            root_info = documents[root_document]
            build = _first_child(root_info["root"], "build")
            build_items = _children(build, "item") if build is not None else []
            if build_items:
                for item in build_items:
                    object_id = item.attrib.get("objectid")
                    if object_id:
                        resolve_object(
                            root_document,
                            object_id,
                            _parse_3mf_transform(item.attrib.get("transform")),
                        )
            else:
                for object_id in root_info["objects"]:
                    resolve_object(root_document, object_id, np.eye(4, dtype=np.float64))

            if not entities:
                raise ModelNormalizationError("3MF contains no mesh entities", code="3MF_MESH_MISSING")
            return entities
    except zipfile.BadZipFile as exc:
        raise ModelNormalizationError("3MF is not a valid ZIP archive", code="3MF_ZIP_INVALID") from exc

def _export_mesh_to_stl(vertices: Iterable[np.ndarray], faces: Iterable[np.ndarray], output_path: str) -> str:
    vertex_parts = list(vertices)
    face_parts = list(faces)
    if not vertex_parts or not face_parts:
        raise ModelNormalizationError("模型中没有可用的三角网格", code="MODEL_EMPTY")
    all_vertices = np.concatenate(vertex_parts, axis=0)
    all_faces = np.concatenate(face_parts, axis=0)
    mesh = trimesh.Trimesh(vertices=all_vertices, faces=all_faces, process=False)
    try:
        mesh.update_faces(mesh.nondegenerate_faces())
    except AttributeError:
        # Older trimesh releases expose remove_degenerate_faces instead.
        mesh.remove_degenerate_faces()
    mesh.remove_unreferenced_vertices()
    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise ModelNormalizationError("模型中没有可用的三角网格", code="MODEL_EMPTY")
    mesh.export(output_path, file_type="stl")
    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise ModelNormalizationError("标准化 STL 生成失败", code="MODEL_EXPORT_FAILED")
    return output_path


def normalize_3mf_entity_color(value: object, fallback: str = "#9CA3AF") -> str:
    """Normalize a UI / 3MF color value to a six-digit hex color."""
    raw = str(value or "").strip()
    if raw.startswith("#"):
        raw = raw[1:]
    if len(raw) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in raw):
        return f"#{raw.upper()}"
    return fallback


def _three_mf_rotation_matrix(euler_angles_deg: Optional[dict[str, float]]) -> np.ndarray:
    """Return the same XYZ Euler transform used by the quote-orientation path."""
    if not euler_angles_deg:
        return np.eye(4, dtype=np.float64)
    angles = [float(euler_angles_deg.get(axis) or 0.0) for axis in ("x", "y", "z")]
    if not any(angles):
        return np.eye(4, dtype=np.float64)
    try:
        from scipy.spatial.transform import Rotation

        matrix = np.eye(4, dtype=np.float64)
        matrix[:3, :3] = Rotation.from_euler("XYZ", angles, degrees=True).as_matrix()
        return matrix
    except Exception as exc:  # pragma: no cover - scipy is a project dependency
        raise ModelNormalizationError("?????????????", code="3MF_ORIENTATION_FAILED") from exc


def build_prusaslicer_multicolor_3mf(
    source_path: str,
    output_path: str,
    *,
    entity_colors: Optional[dict[str, object]] = None,
    default_color: str = "#9CA3AF",
    euler_angles_deg: Optional[dict[str, float]] = None,
) -> dict[str, object]:
    """Build a PrusaSlicer project retaining one printable object per 3MF entity.

    PrusaSlicer's project extension stores per-object / per-volume options in
    ``Metadata/Slic3r_PE_model.config``.  Unlike an STL, this preserves the
    extruder assignment required for a multi-color toolpath.  The return value
    contains the resolved slots and is safe to return to the quote UI.
    """
    entities = load_3mf_entities(source_path)
    if len(entities) < 2:
        raise ModelNormalizationError("3MF ????????????????", code="3MF_MULTICOLOR_NEEDS_ENTITIES")

    raw_assignments = entity_colors if isinstance(entity_colors, dict) else {}
    fallback = normalize_3mf_entity_color(default_color)
    transform = _three_mf_rotation_matrix(euler_angles_deg)
    resolved_entities: list[tuple[ThreeMFEntity, str]] = []
    palette: list[str] = []
    for entity in entities:
        requested = raw_assignments.get(entity.entity_id)
        if isinstance(requested, dict):
            requested = requested.get("color")
        color = normalize_3mf_entity_color(requested or entity.color, fallback)
        if color not in palette:
            palette.append(color)
        resolved_entities.append((entity, color))

    # A stock Prusa MMU profile supports five tools.  PrusaSlicer itself can
    # handle more, but a higher limit here would generate G-code that standard
    # MMU / AMS workflows cannot fulfil safely.
    if len(palette) > 5:
        raise ModelNormalizationError("???????? 5 ????????????", code="3MF_MULTICOLOR_TOO_MANY_COLORS")

    def package_xml() -> tuple[str, str]:
        objects: list[str] = []
        build_items: list[str] = []
        config_objects: list[str] = []
        for index, (entity, color) in enumerate(resolved_entities, start=1):
            vertices = _apply_transform(entity.vertices, transform)
            vertices_xml = "".join(
                f'<vertex x="{float(vertex[0]):.9g}" y="{float(vertex[1]):.9g}" z="{float(vertex[2]):.9g}"/>'
                for vertex in vertices
            )
            triangles_xml = "".join(
                f'<triangle v1="{int(face[0])}" v2="{int(face[1])}" v3="{int(face[2])}"/>'
                for face in entity.faces
            )
            objects.append(
                f'<object id="{index}" type="model"><mesh><vertices>{vertices_xml}</vertices>'
                f'<triangles>{triangles_xml}</triangles></mesh></object>'
            )
            build_items.append(f'<item objectid="{index}" printable="1"/>')
            slot = palette.index(color) + 1
            entity_name = xml_escape(entity.name or f"?? {index}", {'"': '&quot;'})
            last_face = max(0, len(entity.faces) - 1)
            config_objects.append(
                f'<object id="{index}" instances_count="1">'
                f'<metadata type="object" key="name" value="{entity_name}"/>'
                f'<metadata type="object" key="extruder" value="{slot}"/>'
                f'<volume firstid="0" lastid="{last_face}">'
                f'<metadata type="volume" key="name" value="{entity_name}"/>'
                '<metadata type="volume" key="volume_type" value="ModelPart"/>'
                f'<metadata type="volume" key="extruder" value="{slot}"/>'
                '<mesh edges_fixed="0" degenerate_facets="0" facets_removed="0" '
                'facets_reversed="0" backwards_edges="0"/>'
                '</volume></object>'
            )

        model_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<model unit="millimeter" xml:lang="en-US" '
            'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
            'xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">'
            '<metadata name="slic3rpe:Version3mf">1</metadata>'
            '<metadata name="Application">Pricer3D</metadata><resources>'
            f'{"".join(objects)}</resources><build>{"".join(build_items)}</build></model>'
        )
        config_xml = (
            '<?xml version="1.0" encoding="UTF-8"?><config>'
            f'{"".join(config_objects)}</config>'
        )
        return model_xml, config_xml

    model_xml, config_xml = package_xml()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        '</Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel-1" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("3D/3dmodel.model", model_xml)
        archive.writestr("Metadata/Slic3r_PE_model.config", config_xml)

    return {
        "path": output_path,
        "entity_count": len(resolved_entities),
        "colors": palette,
        "slots": [
            {"entity_id": entity.entity_id, "name": entity.name, "color": color, "extruder": palette.index(color) + 1}
            for entity, color in resolved_entities
        ],
    }


def _normalize_3mf(path: str, output_dir: str) -> str:
    try:
        with zipfile.ZipFile(path, "r") as archive:
            if archive.testzip() is not None:
                raise ModelNormalizationError("3MF 压缩包已损坏", code="3MF_ZIP_INVALID")
            object_names = [
                name for name in archive.namelist()
                if name.startswith("3D/Objects/") and name.lower().endswith(".model")
            ]
            if not object_names:
                raise ModelNormalizationError("3MF 中没有找到模型对象", code="3MF_OBJECTS_MISSING")

            vertices: list[np.ndarray] = []
            faces: list[np.ndarray] = []
            try:
                native_entities = load_3mf_entities(path)
            except ModelNormalizationError as exc:
                if exc.code not in {"3MF_MESH_MISSING", "3MF_OBJECTS_MISSING"}:
                    raise
                native_entities = []
            if native_entities:
                vertex_offset = 0
                for entity in native_entities:
                    vertices.append(entity.vertices)
                    faces.append(entity.faces + vertex_offset)
                    vertex_offset += len(entity.vertices)

            if not vertices:
                # Compatibility fallback for 3MF packages embedding another
                # mesh format rather than native model XML.
                for name in archive.namelist():
                    extension = Path(name).suffix.lower()
                    if extension in _3MF_MESH_EXTENSIONS:
                        fd, embedded_path = tempfile.mkstemp(
                            prefix="p3d_3mf_",
                            suffix=extension,
                            dir=output_dir,
                        )
                        os.close(fd)
                        with open(embedded_path, "wb") as target:
                            target.write(archive.read(name))
                        if extension == ".stl":
                            return embedded_path
                        try:
                            mesh = trimesh.load(embedded_path, force="mesh")
                            if isinstance(mesh, trimesh.Scene):
                                mesh = trimesh.util.concatenate(mesh.dump())
                            if not isinstance(mesh, trimesh.Trimesh):
                                raise ModelNormalizationError(
                                    "3MF ????????",
                                    code="3MF_MESH_INVALID",
                                )
                            output_path = os.path.join(
                                output_dir,
                                f"{Path(path).stem}_{uuid.uuid4().hex[:8]}_normalized.stl",
                            )
                            mesh.export(output_path, file_type="stl")
                            return output_path
                        finally:
                            try:
                                os.unlink(embedded_path)
                            except OSError:
                                pass
                raise ModelNormalizationError("3MF ??????????", code="3MF_MESH_MISSING")


            output_path = os.path.join(output_dir, f"{Path(path).stem}_{uuid.uuid4().hex[:8]}_normalized.stl")
            return _export_mesh_to_stl(vertices, faces, output_path)
    except zipfile.BadZipFile as exc:
        raise ModelNormalizationError("3MF 不是有效的 ZIP 文件", code="3MF_ZIP_INVALID") from exc


def _command_prefix(executable: str) -> list[str]:
    """Split native/WSL executable settings without losing Windows slashes."""
    return _executable_command(executable)


def _normalize_step(path: str, output_dir: str) -> str:
    executable = prusa_executable()
    if not executable:
        raise ModelNormalizationError(
            "未找到 PrusaSlicer，无法转换 STEP 文件",
            code="STEP_CONVERTER_UNAVAILABLE",
        )

    output_path = os.path.join(output_dir, f"{Path(path).stem}_{uuid.uuid4().hex[:8]}_normalized.stl")
    # On Windows the project intentionally uses the existing WSL PrusaSlicer.
    # PrusaSlicer runs inside Linux, so both the source and destination must be
    # expressed as /mnt/<drive>/... paths. Passing Windows paths makes the
    # converter exit successfully without producing a usable STL (or fail with
    # a misleading "file not found" error).
    command = _command_prefix(executable) + [
        "--export-stl",
        "--output",
        translate_path_for_executable(output_path, executable),
        translate_path_for_executable(path, executable),
    ]
    try:
        with prusa_execution_lock(executable):
            result = subprocess.run(
                command,
                capture_output=True,
                text=False,
                timeout=120,
                check=False,
            )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ModelNormalizationError(
            "STEP 文件转换超时或转换器无法启动",
            code="STEP_CONVERSION_FAILED",
        ) from exc

    def _decode_output(data: bytes | str | None) -> str:
        if not data:
            return ""
        if isinstance(data, str):
            return data.strip()
        try:
            return data.decode("utf-8").strip()
        except UnicodeDecodeError:
            return data.replace(b"\x00", b"").decode("utf-8", errors="replace").strip()

    if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        detail = (_decode_output(result.stderr) or _decode_output(result.stdout)).replace("\n", " ")[:240]
        logger.warning("STEP to STL conversion failed: %s", detail)
        try:
            os.unlink(output_path)
        except OSError:
            pass
        raise ModelNormalizationError(
            "STEP 文件转换失败" + (f": {detail}" if detail else ""),
            code="STEP_CONVERSION_FAILED",
        )
    return output_path


def normalize_model(path: str, *, output_dir: Optional[str] = None) -> NormalizedModel:
    """Normalize a supported model into a triangulated STL representation."""
    source_path = os.path.abspath(path)
    extension = Path(source_path).suffix.lower()
    if extension not in SUPPORTED_MODEL_EXTENSIONS:
        raise ModelNormalizationError(
            f"不支持的文件格式: {extension}",
            code="MODEL_FORMAT_UNSUPPORTED",
        )
    if not os.path.isfile(source_path):
        raise ModelNormalizationError("模型文件不存在", code="MODEL_NOT_FOUND")

    created_temp_dir = output_dir is None
    temp_dir = output_dir or tempfile.mkdtemp(prefix="p3d_model_")
    os.makedirs(temp_dir, exist_ok=True)
    temporary_paths: list[str] = []
    try:
        if extension == ".stl":
            mesh_path = source_path
        elif extension == ".obj":
            output_path = os.path.join(temp_dir, f"{Path(source_path).stem}_{uuid.uuid4().hex[:8]}_normalized.stl")
            mesh = trimesh.load(source_path, force="mesh")
            if isinstance(mesh, trimesh.Scene):
                mesh = trimesh.util.concatenate(mesh.dump())
            if not isinstance(mesh, trimesh.Trimesh) or len(mesh.vertices) == 0:
                raise ModelNormalizationError("OBJ 文件中没有可用的三角网格", code="OBJ_MESH_INVALID")
            mesh.export(output_path, file_type="stl")
            mesh_path = output_path
            temporary_paths.append(output_path)
        elif extension in _STEP_EXTENSIONS or extension == ".3mf":
            cache_key, cached_path = _cached_mesh_path(source_path, extension)
            cache_lock = _model_cache_lock(cache_key)
            with cache_lock:
                if not os.path.isfile(cached_path) or os.path.getsize(cached_path) == 0:
                    os.makedirs(_MODEL_CACHE_ROOT, exist_ok=True)
                    cache_work_dir = tempfile.mkdtemp(prefix=f".{cache_key}_", dir=_MODEL_CACHE_ROOT)
                    try:
                        if extension == ".3mf":
                            generated_path = _normalize_3mf(source_path, cache_work_dir)
                        else:
                            generated_path = _normalize_step(source_path, cache_work_dir)
                        os.replace(generated_path, cached_path)
                    finally:
                        shutil.rmtree(cache_work_dir, ignore_errors=True)
                mesh_path = cached_path
        else:
            raise ModelNormalizationError(
                f"Unsupported model format: {extension}",
                code="MODEL_FORMAT_UNSUPPORTED",
            )
        return NormalizedModel(
            source_path=source_path,
            mesh_path=mesh_path,
            source_extension=extension,
            temporary_paths=temporary_paths,
            temporary_dirs=[temp_dir] if created_temp_dir else [],
        )
    except Exception:
        for temp_path in temporary_paths:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
        if output_dir is None:
            try:
                os.rmdir(temp_dir)
            except OSError:
                pass
        raise
