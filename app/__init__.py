"""Application factory for pricer3d."""

import os
import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from .config import ALLOWED_ORIGINS, IS_PRODUCTION, APP_ENV
from .middleware import security_middleware

logger = logging.getLogger("uvicorn.error")


def create_app() -> FastAPI:
    app = FastAPI(title="3D Printing Quoting System DEMO")

    # exception handlers
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request, exc):
        return JSONResponse(
            status_code=422,
            content={"detail": "输入参数不合法，请检查后重试"},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request, exc):
        from fastapi import HTTPException, Request
        if isinstance(exc, HTTPException):
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        logger.exception("Unhandled server error on path %s", request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": f"服务器内部错误: {str(exc)}"},
        )

    # static files
    os.makedirs("static", exist_ok=True)
    app.mount("/static", StaticFiles(directory="static"), name="static")

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
    )

    # security middleware
    app.middleware("http")(security_middleware)

    # startup
    @app.on_event("startup")
    def on_startup():
        from .database import init_db
        from .utils import _uploads_base_dir, _outputs_base_dir
        init_db()
        _uploads_base_dir()
        _outputs_base_dir()

    # ─── register routes ───
    from .routes_auth import (
        get_captcha, get_captcha_image, send_verify_code, confirm_verify_code,
        check_register_exists, register, login, auth_me,
    )
    from .routes_user import get_user_settings, update_user_settings, change_password
    from .routes_slicer import (
        api_list_slicer_presets, api_generate_slicer_preset, api_upsert_slicer_preset,
        api_download_slicer_preset, api_delete_slicer_preset,
    )
    from .routes_admin import (
        admin_get_defaults, admin_set_defaults_from_me, admin_list_users,
        admin_update_user_membership, admin_list_audit, admin_metrics, admin_cleanup,
    )
    from .routes_billing import (
        billing_plans, billing_checkout, billing_orders, billing_mock_complete, billing_webhook,
    )
    from .routes_quote import get_quote, validate_formula
    from .routes_pages import (
        index, register_page, legal_terms, legal_privacy, admin_users_page,
        pay_mock, healthz, readyz,
    )

    # auth
    app.get("/api/auth/captcha")(get_captcha)
    app.get("/api/auth/captcha/image/{captcha_id}")(get_captcha_image)
    app.post("/api/auth/verify/send")(send_verify_code)
    app.post("/api/auth/verify/confirm")(confirm_verify_code)
    app.post("/api/auth/register/check")(check_register_exists)
    app.post("/api/auth/register")(register)
    app.post("/api/auth/login")(login)
    app.get("/api/auth/me")(auth_me)

    # user
    app.get("/api/user/settings")(get_user_settings)
    app.put("/api/user/settings")(update_user_settings)
    app.post("/api/users/change-password")(change_password)

    # slicer
    app.get("/api/slicer/presets")(api_list_slicer_presets)
    app.post("/api/slicer/presets/generate")(api_generate_slicer_preset)
    app.post("/api/slicer/presets")(api_upsert_slicer_preset)
    app.get("/api/slicer/presets/{preset_id}/download")(api_download_slicer_preset)
    app.delete("/api/slicer/presets/{preset_id}")(api_delete_slicer_preset)

    # admin
    app.get("/api/admin/defaults")(admin_get_defaults)
    app.post("/api/admin/defaults/from-me")(admin_set_defaults_from_me)
    app.get("/api/admin/users")(admin_list_users)
    app.post("/api/admin/users/{user_id}/membership")(admin_update_user_membership)
    app.get("/api/admin/audit")(admin_list_audit)
    app.get("/api/admin/metrics")(admin_metrics)
    app.post("/api/admin/maintenance/cleanup")(admin_cleanup)

    # billing
    app.get("/api/billing/plans")(billing_plans)
    app.post("/api/billing/checkout")(billing_checkout)
    app.get("/api/billing/orders")(billing_orders)
    app.post("/api/billing/mock/complete")(billing_mock_complete)
    app.post("/api/billing/webhook")(billing_webhook)

    # quote
    app.post("/api/quote")(get_quote)
    app.post("/api/formula/validate")(validate_formula)

    # pages
    app.get("/", response_class="text/html")(index)
    app.get("/register", response_class="text/html")(register_page)
    app.get("/legal/terms", response_class="text/html")(legal_terms)
    app.get("/legal/privacy", response_class="text/html")(legal_privacy)
    app.get("/admin/users", response_class="text/html")(admin_users_page)
    app.get("/pay/mock", response_class="text/html")(pay_mock)

    # health
    app.get("/healthz")(healthz)
    app.get("/readyz")(readyz)

    return app
