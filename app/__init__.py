"""Application factory for pricer3d."""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from .config import ALLOWED_ORIGINS, APP_ENV
from .middleware import security_middleware
from .logging_config import setup_logging
from .errors import register_exception_handlers

logger = logging.getLogger("uvicorn.error")


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
    from .routes_auth import (
        get_captcha,
        get_captcha_image,
        send_verify_code,
        confirm_verify_code,
        check_register_exists,
        register,
        login,
        admin_login,
        auth_me,
        password_reset_request,
        password_reset_confirm,
    )
    from .routes_user import (
        get_user_settings,
        update_user_settings,
        change_password,
        export_user_settings,
        import_user_settings,
        reset_user_section,
        get_brand_settings,
        update_brand_settings,
        upload_brand_logo,
        delete_brand_logo,
    )
    from .routes_slicer import (
        api_list_slicer_presets,
        api_get_slicer_preset,
        api_generate_slicer_preset,
        api_upsert_slicer_preset,
        api_download_slicer_preset,
        api_delete_slicer_preset,
        api_list_printers,
    )
    from .routes_printer import (
        api_list_printer_presets,
        api_get_printer_preset,
        api_create_printer_preset,
        api_delete_printer_preset,
        api_download_printer_profile,
    )
    from .routes_admin import (
        admin_get_defaults,
        admin_set_defaults_from_me,
        admin_list_users,
        admin_update_user_membership,
        admin_list_audit,
        admin_metrics,
        admin_cleanup,
        admin_backup_create,
        admin_backup_list,
        admin_backup_cleanup,
    )
    from .routes_billing import (
        billing_plans,
        billing_checkout,
        billing_orders,
        billing_mock_complete,
        billing_webhook,
    )
    from .routes.quote import get_quote, validate_formula
    from .routes.zip_quote import zip_quote, zip_preview, download_zip_model, download_zip_template
    from .services.history import quote_history, delete_quote_history, clear_quote_history
    from .services.export import export_quote_history, export_quote_pdf, export_pdf_inline
    from .routes_orientation import (
        optimize_orientation,
        list_stable_faces,
        list_coplanar_clusters,
        train_sample,
        model_status,
        admin_train_model,
        auto_learned_orient,
    )
    from .routes_pages import (
        index,
        register_page,
        legal_terms,
        legal_privacy,
        admin_users_page,
        pay_mock,
        healthz,
        readyz,
        version,
        printer_params_page,
        materials_page,
        quote_page,
    )
    from .schemas.quote import QuoteResponse, QuoteHistoryItem
    from .schemas.common import PaginatedData
    from .schemas.user import BillingOrder

    # auth
    app.get("/api/auth/captcha")(get_captcha)
    app.get("/api/auth/captcha/image/{captcha_id}")(get_captcha_image)
    app.post("/api/auth/verify/send")(send_verify_code)
    app.post("/api/auth/verify/confirm")(confirm_verify_code)
    app.post("/api/auth/register/check")(check_register_exists)
    app.post("/api/auth/register")(register)
    app.post("/api/auth/login")(login)
    app.post("/api/auth/admin-login")(admin_login)
    app.get("/api/auth/me", response_model=dict)(auth_me)
    app.post("/api/auth/password/reset/request")(password_reset_request)
    app.post("/api/auth/password/reset/confirm")(password_reset_confirm)

    # user
    app.get("/api/user/settings")(get_user_settings)
    app.put("/api/user/settings")(update_user_settings)
    app.post("/api/users/change-password")(change_password)
    app.get("/api/user/settings/export")(export_user_settings)
    app.post("/api/user/settings/import")(import_user_settings)
    app.post("/api/user/settings/reset")(reset_user_section)

    # brand customization
    app.get("/api/user/brand-settings")(get_brand_settings)
    app.put("/api/user/brand-settings")(update_brand_settings)
    app.post("/api/user/brand-logo")(upload_brand_logo)
    app.delete("/api/user/brand-logo")(delete_brand_logo)

    # slicer
    app.get("/api/slicer/presets")(api_list_slicer_presets)
    app.get("/api/slicer/presets/{preset_id}")(api_get_slicer_preset)
    app.post("/api/slicer/presets/generate")(api_generate_slicer_preset)
    app.post("/api/slicer/presets")(api_upsert_slicer_preset)
    app.get("/api/slicer/presets/{preset_id}/download")(api_download_slicer_preset)
    app.delete("/api/slicer/presets/{preset_id}")(api_delete_slicer_preset)
    app.get("/api/slicer/printers")(api_list_printers)

    # printer presets
    app.get("/api/printer/presets")(api_list_printer_presets)
    app.get("/api/printer/presets/{preset_id}")(api_get_printer_preset)
    app.post("/api/printer/presets")(api_create_printer_preset)
    app.delete("/api/printer/presets/{preset_id}")(api_delete_printer_preset)
    app.get("/api/printer/presets/{preset_id}/download")(api_download_printer_profile)

    # admin
    app.get("/api/admin/defaults")(admin_get_defaults)
    app.post("/api/admin/defaults/from-me")(admin_set_defaults_from_me)
    app.get("/api/admin/users")(admin_list_users)
    app.post("/api/admin/users/{user_id}/membership")(admin_update_user_membership)
    app.get("/api/admin/audit")(admin_list_audit)
    app.get("/api/admin/metrics")(admin_metrics)
    app.post("/api/admin/maintenance/cleanup")(admin_cleanup)
    app.post("/api/admin/maintenance/backup")(admin_backup_create)
    app.get("/api/admin/maintenance/backup")(admin_backup_list)
    app.post("/api/admin/maintenance/backup/cleanup")(admin_backup_cleanup)

    # billing
    app.get("/api/billing/plans")(billing_plans)
    app.post("/api/billing/checkout", response_model=dict)(billing_checkout)
    app.get("/api/billing/orders", response_model=PaginatedData[BillingOrder])(billing_orders)
    app.post("/api/billing/mock/complete")(billing_mock_complete)
    app.post("/api/billing/webhook")(billing_webhook)

    # quote
    app.post("/api/quote", response_model=QuoteResponse)(get_quote)
    app.get("/api/quote/history", response_model=PaginatedData[QuoteHistoryItem])(quote_history)
    app.delete("/api/quote/history/{id}")(delete_quote_history)
    app.delete("/api/quote/history")(clear_quote_history)
    app.get("/api/quote/export")(export_quote_history)
    app.get("/api/quote/export-pdf")(export_quote_pdf)
    app.post("/api/quote/export-pdf-inline")(export_pdf_inline)
    app.post("/api/formula/validate", response_model=dict)(validate_formula)

    # zip quote
    app.post("/api/quote/zip/preview")(zip_preview)
    app.post("/api/quote/zip")(zip_quote)
    app.get("/api/quote/zip/file")(download_zip_model)
    app.get("/api/quote/zip/template")(download_zip_template)

    # preview
    from .routes_preview import router as preview_router

    app.include_router(preview_router)

    # printer params
    from .routes_printer_params import router as printer_params_router

    app.include_router(printer_params_router)

    # materials
    from .routes_materials import router as materials_router

    app.include_router(materials_router)

    # todo
    from .todo_api import router as todo_router

    app.include_router(todo_router)

    # orientation
    app.post("/api/orientation/optimize")(optimize_orientation)
    app.post("/api/orientation/faces")(list_stable_faces)
    app.post("/api/orientation/coplanar")(list_coplanar_clusters)
    app.post("/api/orientation/train")(train_sample)
    app.get("/api/orientation/model/status")(model_status)
    app.post("/api/admin/orientation/train")(admin_train_model)
    app.post("/api/orientation/auto-learned")(auto_learned_orient)

    # todo
    from .routes_todo import (
        list_categories,
        create_category,
        delete_category,
        list_todos,
        get_todo,
        create_todo,
        update_todo,
        delete_todo,
    )

    app.get("/api/categories")(list_categories)
    app.post("/api/categories")(create_category)
    app.delete("/api/categories/{category_id}")(delete_category)
    app.get("/api/todos")(list_todos)
    app.get("/api/todos/{todo_id}")(get_todo)
    app.post("/api/todos")(create_todo)
    app.put("/api/todos/{todo_id}")(update_todo)
    app.delete("/api/todos/{todo_id}")(delete_todo)

    # pages
    app.get("/", response_class=HTMLResponse)(index)
    app.get("/register", response_class=HTMLResponse)(register_page)
    app.get("/legal/terms", response_class=HTMLResponse)(legal_terms)
    app.get("/legal/privacy", response_class=HTMLResponse)(legal_privacy)
    app.get("/admin/users", response_class=HTMLResponse)(admin_users_page)
    app.get("/pay/mock", response_class=HTMLResponse)(pay_mock)

    # health
    app.get("/healthz")(healthz)
    app.get("/readyz")(readyz)
    app.get("/api/version")(version)

    # new management pages
    app.get("/printer-params", response_class=HTMLResponse)(printer_params_page)
    app.get("/materials", response_class=HTMLResponse)(materials_page)
    app.get("/quote", response_class=HTMLResponse)(quote_page)

    return app
