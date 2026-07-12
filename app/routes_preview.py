"""Preview routes — converts uploaded 3D models to GLB for Three.js preview."""

import os
import uuid
import logging
import subprocess
import trimesh
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response

logger = logging.getLogger(__name__)

router = APIRouter()

SUPPORTED_EXT = {".stl", ".stp", ".step", ".obj", ".3mf"}
MAX_SIZE = 100 * 1024 * 1024
_STEP_EXTENSIONS = {".stp", ".step"}


@router.post("/api/preview/glb")
async def preview_as_glb(file: UploadFile = File(...)):
    """接受任何支持的 3D 文件，返回 GLB 格式的二进制数据。"""
    ext = os.path.splitext(file.filename or "model.stl")[1].lower()
    if ext not in SUPPORTED_EXT:
        raise HTTPException(400, f"不支持: {ext}")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "文件太大")

    tmp = f"/tmp/p3d_glb_{uuid.uuid4().hex}{ext}"
    tmp_stl = None
    try:
        with open(tmp, "wb") as f:
            f.write(content)

        # Convert STEP to STL via PrusaSlicer before trimesh loading
        load_path = tmp
        if ext in _STEP_EXTENSIONS:
            tmp_stl = f"/tmp/p3d_glb_{uuid.uuid4().hex}.stl"
            result = subprocess.run(
                ["prusa-slicer", "--export-stl", "--output", tmp_stl, tmp],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0 or not os.path.exists(tmp_stl):
                logger.warning("STEP→STL preview conversion failed: %s", result.stderr[:200])
                raise HTTPException(500, "STEP 文件转换失败")
            load_path = tmp_stl

        mesh = trimesh.load(load_path, force="mesh")
        if isinstance(mesh, trimesh.Scene):
            meshes = list(mesh.geometry.values())
            if len(meshes) == 0:
                raise ValueError("empty scene")
            mesh = trimesh.util.concatenate(meshes)
        if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
            raise ValueError("cannot load mesh")

        glb_bytes = mesh.export(file_type="glb")
        return Response(content=glb_bytes, media_type="model/gltf-binary")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("GLB conversion failed: %s", e)
        raise HTTPException(500, f"转换失败: {e}")
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass
        if tmp_stl:
            try:
                os.unlink(tmp_stl)
            except Exception:
                pass
