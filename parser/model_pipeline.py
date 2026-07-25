"""Unified model normalization for pricing, preview, and slicing.

The application accepts several 3D formats, but downstream operations need one
predictable triangulated mesh.  This module keeps the uploaded source intact and
creates a temporary STL representation for OBJ/3MF/STEP when necessary.
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import uuid
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import trimesh

from parser.prusa_slicer import (
    _executable_command,
    prusa_executable,
    translate_path_for_executable,
)

logger = logging.getLogger(__name__)

SUPPORTED_MODEL_EXTENSIONS = {".stl", ".stp", ".step", ".obj", ".3mf"}
_STEP_EXTENSIONS = {".stp", ".step"}
_3MF_MESH_EXTENSIONS = {".stl", ".obj", ".ply", ".off"}


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
            for name in object_names:
                parsed_vertices, parsed_faces = _parse_3mf_model(archive.read(name))
                vertices.extend(parsed_vertices)
                faces.extend(parsed_faces)

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
        elif extension == ".3mf":
            mesh_path = _normalize_3mf(source_path, temp_dir)
            if mesh_path != source_path:
                temporary_paths.append(mesh_path)
        else:
            mesh_path = _normalize_step(source_path, temp_dir)
            temporary_paths.append(mesh_path)
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
