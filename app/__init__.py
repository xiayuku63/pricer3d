"""Application factory for pricer3d."""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from .config import ALLOWED_ORIGINS, APP_ENV
from .middleware import security_middleware
from .logging_config import setup_logging
from .errors import register_exception_handlers

logger = logging.getLogger("uvicorn.error")


class StaticAssetsCacheMiddleware(BaseHTTPMiddleware):
    """Long-cache versioned static assets; revalidate everything else.

    Templates reference assets as `main.js?v=101` — a content bump ships a new
    URL, so versioned requests can be cached immutably for a year. Unversioned
    requests (e.g. intra-module ES imports) keep revalidating via ETag/304 so
    mixed ES module revisions can't happen. Replaces the previous blanket
    no-store that re-downloaded the 1.2MB three.js on every page load.
    """

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            if request.query_params.get("v"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "no-cache"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    # Startup
    from .database import init_db
    from .db import init_orm
    from .utils import _uploads_base_dir, _outputs_base_dir

    pricer_logger = setup_logging()
    pricer_logger.info("event=startup env=%s", APP_ENV)
    init_db()
    init_orm()
    _uploads_base_dir()
    _outputs_base_dir()
    # Restore rate limit state from DB
    try:
        from .middleware import rate_limiter

        rate_limiter.restore_state()
    except Exception as e:
        logger.warning("startup: failed to restore rate limiter state: %s", e)
    logger.info("pricer3d startup complete, env=%s", APP_ENV)

    # Log PrusaSlicer availability for diagnostics
    try:
        from parser.prusa_slicer import prusa_executable_diagnostics

        diag = prusa_executable_diagnostics()
        if diag["found"]:
            logger.info("PrusaSlicer: found path=%s version=%s", diag["path"], str(diag.get("version", "?")))
        else:
            logger.warning("PrusaSlicer: NOT FOUND — falling back to formula estimation")
    except Exception as e:
        logger.warning("PrusaSlicer diagnostics error: %s", e)

    yield  # App runs here

    # Shutdown
    pricer_logger.info("event=shutdown")
    logger.info("pricer3d shutting down")


def create_app() -> FastAPI:
    app = FastAPI(title="pricer3d — 3D Printing Quoting System", lifespan=lifespan)
    app.add_middleware(StaticAssetsCacheMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    # exception handlers (unified {code, message, data} format)
    register_exception_handlers(app)

    # static files
    os.makedirs("static", exist_ok=True)
    app.mount("/static", StaticFiles(directory="static"), name="static")

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
    )

    # security middleware
    app.middleware("http")(security_middleware)

    # ─── register routes ───
    # Each route module owns an APIRouter with its paths; the factory only
    # assembles them. New endpoints no longer need to touch this file.
    from .routes_auth import router as auth_router
    from .routes_user import router as user_router
    from .routes_slicer import router as slicer_router
    from .routes_printer import router as printer_router
    from .routes_admin import router as admin_router
    from .routes_billing import router as billing_router
    from .routes.quote import router as quote_router
    from .routes_history import router as history_router
    from .routes_export import router as export_router
    from .routes.zip_quote import router as zip_quote_router
    from .routes_preview import router as preview_router
    from .routes_printer_params import router as printer_params_router
    from .routes_materials import router as materials_router
    from .todo_api import router as todo_router
    from .routes_orientation import router as orientation_router
    from .routes_pages import router as pages_router

    for module_router in (
        auth_router,
        user_router,
        slicer_router,
        printer_router,
        admin_router,
        billing_router,
        quote_router,
        history_router,
        export_router,
        zip_quote_router,
        preview_router,
        printer_params_router,
        materials_router,
        todo_router,
        orientation_router,
        pages_router,
    ):
        app.include_router(module_router)

    return app
