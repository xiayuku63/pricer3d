"""Preview routes — converts supported models to GLB for Three.js."""

import os
import shutil
import tempfile
import logging

import trimesh
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response

from parser.model_pipeline import (
    ModelNormalizationError,
    SUPPORTED_MODEL_EXTENSIONS,
    normalize_model,
    load_3mf_entities,
)

logger = logging.getLogger(__name__)

router = APIRouter()

SUPPORTED_EXT = SUPPORTED_MODEL_EXTENSIONS
MAX_SIZE = 100 * 1024 * 1024


@router.post("/api/preview/glb")
async def preview_as_glb(file: UploadFile = File(...)):
    """Accept any supported model and return a GLB generated from its normalized mesh."""
    ext = os.path.splitext(file.filename or "model.stl")[1].lower()
    if ext not in SUPPORTED_EXT:
        raise HTTPException(400, f"不支持: {ext}")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "文件太大")

    work_dir = tempfile.mkdtemp(prefix="p3d_glb_")
    source_path = os.path.join(work_dir, f"source{ext}")
    normalized = None
    try:
        with open(source_path, "wb") as output:
            output.write(content)

        normalized = normalize_model(
            source_path,
            output_dir=os.path.join(work_dir, "normalized"),
        )
        mesh = trimesh.load(normalized.mesh_path, force="mesh")
        if isinstance(mesh, trimesh.Scene):
            meshes = list(mesh.geometry.values())
            if not meshes:
                raise ModelNormalizationError("模型中没有可预览的网格", code="MODEL_EMPTY")
            mesh = trimesh.util.concatenate(meshes)
        if not isinstance(mesh, trimesh.Trimesh) or len(mesh.vertices) == 0:
            raise ModelNormalizationError("模型中没有可预览的网格", code="MODEL_EMPTY")

        glb_bytes = mesh.export(file_type="glb")
        return Response(content=glb_bytes, media_type="model/gltf-binary")
    except ModelNormalizationError as exc:
        status_code = 503 if exc.code == "STEP_CONVERTER_UNAVAILABLE" else 400
        logger.warning("Model preview normalization failed: %s (%s)", exc, exc.code)
        raise HTTPException(status_code, f"{exc.code}: {exc}") from exc
    except Exception as exc:
        logger.error("GLB conversion failed: %s", exc, exc_info=True)
        raise HTTPException(500, f"转换失败: {exc}") from exc
    finally:
        if normalized is not None:
            normalized.cleanup()
        shutil.rmtree(work_dir, ignore_errors=True)


@router.post("/api/preview/3mf-scene")
async def preview_3mf_scene(file: UploadFile = File(...)):
    """Return a GLB that preserves each 3MF build entity as a separate mesh."""
    ext = os.path.splitext(file.filename or "model.3mf")[1].lower()
    if ext != ".3mf":
        raise HTTPException(400, "This endpoint accepts 3MF files only")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "File is too large")

    work_dir = tempfile.mkdtemp(prefix="p3d_3mf_scene_")
    source_path = os.path.join(work_dir, "source.3mf")
    try:
        with open(source_path, "wb") as output:
            output.write(content)
        entities = load_3mf_entities(source_path)
        scene = trimesh.Scene()
        for entity in entities:
            mesh = trimesh.Trimesh(
                vertices=entity.vertices,
                faces=entity.faces,
                process=False,
            )
            color = entity.color or "#9CA3AF"
            rgba = [int(color[index:index + 2], 16) for index in (1, 3, 5)] + [255]
            material = trimesh.visual.material.PBRMaterial(
                name=entity.name,
                baseColorFactor=rgba,
                metallicFactor=0.0,
                roughnessFactor=0.65,
            )
            mesh.visual = trimesh.visual.TextureVisuals(material=material)
            mesh.metadata = {
                "entity_id": entity.entity_id,
                "entity_name": entity.name,
                "source_color": entity.color or "",
                "source_object_id": entity.source_object_id,
            }
            scene.add_geometry(
                mesh,
                node_name=f"entity-{entity.entity_id}",
                geom_name=f"entity-{entity.entity_id}",
            )
        glb_bytes = scene.export(file_type="glb")
        return Response(
            content=glb_bytes,
            media_type="model/gltf-binary",
            headers={"X-3MF-Entity-Count": str(len(entities))},
        )
    except ModelNormalizationError as exc:
        logger.warning("3MF scene extraction failed: %s (%s)", exc, exc.code)
        raise HTTPException(400, f"{exc.code}: {exc}") from exc
    except Exception as exc:
        logger.error("3MF scene export failed: %s", exc, exc_info=True)
        raise HTTPException(500, f"3MF scene export failed: {exc}") from exc
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@router.post("/api/preview/stl")
async def preview_as_stl(file: UploadFile = File(...)):
    """Return the normalized STL used by analysis/slicing for the main 3D viewer."""
    ext = os.path.splitext(file.filename or "model.stl")[1].lower()
    if ext not in SUPPORTED_EXT:
        raise HTTPException(400, f"Unsupported format: {ext}")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "File is too large")

    work_dir = tempfile.mkdtemp(prefix="p3d_stl_")
    source_path = os.path.join(work_dir, f"source{ext}")
    normalized = None
    try:
        with open(source_path, "wb") as output:
            output.write(content)

        normalized = normalize_model(
            source_path,
            output_dir=os.path.join(work_dir, "normalized"),
        )
        with open(normalized.mesh_path, "rb") as normalized_file:
            stl_bytes = normalized_file.read()
        if not stl_bytes:
            raise ModelNormalizationError("The normalized model is empty", code="MODEL_EMPTY")
        return Response(content=stl_bytes, media_type="model/stl")
    except ModelNormalizationError as exc:
        status_code = 503 if exc.code == "STEP_CONVERTER_UNAVAILABLE" else 400
        logger.warning("STL preview normalization failed: %s (%s)", exc, exc.code)
        raise HTTPException(status_code, f"{exc.code}: {exc}") from exc
    except Exception as exc:
        logger.error("STL preview normalization failed: %s", exc, exc_info=True)
        raise HTTPException(500, f"Conversion failed: {exc}") from exc
    finally:
        if normalized is not None:
            normalized.cleanup()
        shutil.rmtree(work_dir, ignore_errors=True)
