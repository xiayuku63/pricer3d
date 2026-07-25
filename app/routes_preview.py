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
