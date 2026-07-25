"""Regression tests for the active ZIP quote route registration."""

from app import create_app


def test_zip_quote_routes_use_the_active_thin_route_module():
    application = create_app()
    expected_paths = {
        ("/api/quote/zip/preview", "POST"),
        ("/api/quote/zip", "POST"),
        ("/api/quote/zip/file", "GET"),
        ("/api/quote/zip/template", "GET"),
    }

    registered = {
        (route.path, method): route.endpoint.__module__
        for route in application.routes
        for method in (getattr(route, "methods", None) or ())
        if getattr(route, "path", "").startswith("/api/quote/zip")
    }

    assert set(registered) == expected_paths
    assert all(module == "app.routes.zip_quote" for module in registered.values())
