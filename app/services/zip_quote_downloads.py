"""Download adapters for ZIP-generated files and templates."""

import json
import os
from collections.abc import Callable

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse

from app.config import JWT_ALGORITHM, JWT_SECRET_KEY
from app.db import get_db_session
from app.models_orm import User


def safe_model_download(file_path: str, current_user: dict, user_base_dir: Callable[[], str]):
    """Return a model only when it resolves inside the user's uploads directory."""
    user_folder = f"user_{current_user['id']}_{current_user['username']}"
    allowed_dir = os.path.realpath(os.path.join(user_base_dir(), user_folder, "uploads"))
    absolute_path = os.path.realpath(file_path)
    try:
        is_allowed = os.path.commonpath([absolute_path, allowed_dir]) == allowed_dir
    except ValueError:
        is_allowed = False
    if not is_allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.isfile(absolute_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(absolute_path, filename=os.path.basename(absolute_path))


def get_template_user_brands(
    request: Request,
    *,
    db_session_factory=get_db_session,
    user_model=User,
) -> list[str]:
    """Read the authenticated user's material brands, with a stable fallback."""
    authorization = request.headers.get("authorization")
    if authorization:
        try:
            from jose import jwt as jose_jwt

            token = authorization.replace("Bearer ", "")
            payload = jose_jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
            user_id = int(payload.get("sub", "0"))
            if user_id > 0:
                with db_session_factory() as db:
                    user = db.query(user_model.materials).filter(user_model.id == user_id).first()
                if user and user.materials:
                    materials = json.loads(user.materials)
                    brands = sorted(
                        {
                            material.get("brand", "Generic")
                            for material in materials
                            if isinstance(material, dict) and material.get("brand")
                        }
                    )
                    if brands:
                        return brands
        except Exception:
            pass
    return ["eSUN", "Generic", "Hatchbox", "Polymaker", "Sunlu"]
