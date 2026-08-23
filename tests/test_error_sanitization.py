"""5xx HTTPException details must not leak internals in production."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import config
from app.errors import register_exception_handlers


def _make_client() -> TestClient:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/boom")
    async def boom():
        raise HTTPException(
            status_code=500,
            detail="INTERNAL_ERROR: 报价请求失败 (OSError: C:\\secret\\path db=sqlite:///app.db)",
        )

    return TestClient(app, raise_server_exceptions=False)


def test_5xx_detail_kept_in_development(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION", False)
    resp = _make_client().get("/boom")
    assert resp.status_code == 500
    message = resp.json()["message"]
    assert "C:\\secret\\path" in message


def test_5xx_detail_sanitized_in_production(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION", True)
    resp = _make_client().get("/boom")
    assert resp.status_code == 500
    message = resp.json()["message"]
    assert message == "服务器内部错误"
    assert "secret" not in message


def test_4xx_detail_unchanged_in_production(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION", True)
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/nope")
    async def nope():
        raise HTTPException(status_code=404, detail="资源不存在")

    resp = TestClient(app).get("/nope")
    assert resp.status_code == 404
    assert resp.json()["message"] == "资源不存在"
