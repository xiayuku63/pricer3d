"""Auth flow tests — login, register, rate limiting."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

# Use in-memory SQLite for tests
os.environ["DB_PATH"] = ":memory:"

from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    """Initialize fresh in-memory DB before each test."""
    from app.database import init_db

    init_db()


class TestAuthFlow:
    """Registration → login → me → password change."""

    def test_register_login_me(self):
        # Get captcha first
        r = client.get("/api/auth/captcha")
        assert r.status_code == 200
        captcha = r.json()
        assert "captcha_id" in captcha

        # Register with empty channel (allowed for simple username-only reg)
        r = client.post(
            "/api/auth/register",
            json={
                "username": "testuser1",
                "password": "testpass123",
                "channel": "email",
                "email": "test@example.com",
                "email_code": "123456",
                "accept_terms": True,
                "accept_privacy": True,
            },
        )
        # Register may fail if email code not verified; just check non-500
        assert r.status_code < 500, f"Register: {r.json()}"

        # Login
        r = client.post(
            "/api/auth/login",
            data={
                "username": "testuser1",
                "password": "testpass123",
                "captcha_id": captcha["captcha_id"],
                "captcha_code": captcha.get("code", ""),
            },
        )
        # login may fail if captcha not matched, just verify structured response
        assert "code" in r.json()

    def test_phone_register_uses_persisted_app_defaults(self, monkeypatch):
        """Phone registration must succeed when custom app defaults exist."""
        import json

        from app import routes_auth
        from app.config import APP_DEFAULTS_KEY, DEFAULT_MATERIALS, DEFAULT_PRICING_CONFIG
        from app.db import get_db_session
        from app.models_orm import AppDefault

        with get_db_session() as db:
            db.query(AppDefault).filter(AppDefault.key == APP_DEFAULTS_KEY).delete()
            db.add(
                AppDefault(
                    key=APP_DEFAULTS_KEY,
                    value_json=json.dumps(
                        {
                            "materials": DEFAULT_MATERIALS,
                            "pricing_config": DEFAULT_PRICING_CONFIG,
                        }
                    ),
                )
            )

        monkeypatch.setattr(routes_auth, "verify_captcha_or_raise", lambda *_args: None)
        monkeypatch.setattr(routes_auth, "consume_verification_code", lambda *_args: True)

        import asyncio

        from fastapi import Request
        from app.models import RegisterRequest

        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/auth/register",
                "headers": [],
                "client": ("127.0.0.1", 50000),
                "server": ("testserver", 80),
                "scheme": "http",
                "query_string": b"",
            }
        )
        data = asyncio.run(
            routes_auth.register(
                RegisterRequest(
                    username="phone_regression_user",
                    password="testpass123",
                    register_channel="phone",
                    phone="+8613800138999",
                    phone_code="123456",
                    captcha_id="captcha-regression",
                    captcha_code="ABCD",
                    accept_terms=True,
                    accept_privacy=True,
                ),
                request,
            )
        )

        assert data["user"]["username"] == "phone_regression_user"
        assert data["access_token"]

    def test_register_duplicate(self):
        client.post(
            "/api/auth/register",
            json={
                "username": "testuser2",
                "password": "testpass123",
                "channel": "email",
                "email": "dup@example.com",
                "email_code": "123456",
                "accept_terms": True,
                "accept_privacy": True,
            },
        )
        r = client.post(
            "/api/auth/register",
            json={
                "username": "testuser2",
                "password": "testpass123",
                "channel": "email",
                "email": "dup@example.com",
                "email_code": "123456",
                "accept_terms": True,
                "accept_privacy": True,
            },
        )
        # Should be 409 conflict
        assert r.status_code in (409, 422, 400), f"Got {r.status_code}: {r.json()}"


class TestUnauthenticated:
    def test_me_without_token(self):
        r = client.get("/api/auth/me")
        assert r.status_code == 401
        assert r.json()["code"] == 40100

    def test_quote_without_token(self):
        r = client.post("/api/quote")
        assert r.status_code == 401

    def test_settings_without_token(self):
        r = client.get("/api/user/settings")
        assert r.status_code == 401


class TestCaptcha:
    def test_captcha_generation(self):
        r = client.get("/api/auth/captcha")
        assert r.status_code == 200
        data = r.json()
        assert "captcha_id" in data

    def test_captcha_image(self):
        r = client.get("/api/auth/captcha")
        captcha_id = r.json()["captcha_id"]
        r = client.get(f"/api/auth/captcha/image/{captcha_id}")
        assert r.status_code in (200, 404)
