"""Geometry calculations for supported 3D model files.

All non-STL formats are normalized through :mod:`parser.model_pipeline` before
being loaded by trimesh.  Keeping this module focused on geometry calculations
prevents preview, quotation, and slicing from implementing different parsers.
"""

from __future__ import annotations

import trimesh

from parser.model_pipeline import ModelNormalizationError, normalize_model


def calculate_geometry(model_path: str):
    """Calculate volume, surface area, and dimensions in millimetres."""
    normalized = None
    try:
        normalized = normalize_model(model_path)
        mesh = trimesh.load(normalized.mesh_path, force="mesh")

        if isinstance(mesh, trimesh.Scene):
            geometry = list(mesh.geometry.values())
            if not geometry:
                return 0, 0, {"x": 0, "y": 0, "z": 0}
            mesh = trimesh.util.concatenate(geometry)
        if not isinstance(mesh, trimesh.Trimesh) or len(mesh.vertices) == 0:
            return 0, 0, {"x": 0, "y": 0, "z": 0}

        # Triangle winding can be globally reversed in valid 3MF/STL meshes.
        # Signed volume changes sign, but physical material volume does not.
        volume = abs(float(mesh.volume))
        surface_area = float(mesh.area)
        extents = mesh.extents
        dimensions = {
            "x": round(float(extents[0]), 2),
            "y": round(float(extents[1]), 2),
            "z": round(float(extents[2]), 2),
        }

        if volume <= 0:
            hull_volume = float(mesh.convex_hull.volume)
            volume = hull_volume if hull_volume > 0 else 0.0

        return volume, surface_area, dimensions
    except (ModelNormalizationError, OSError, ValueError):
        return 0, 0, {"x": 0, "y": 0, "z": 0}
    except Exception:
        return 0, 0, {"x": 0, "y": 0, "z": 0}
    finally:
        if normalized is not None:
            normalized.cleanup()


__all__ = ["calculate_geometry"]
