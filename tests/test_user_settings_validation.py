import os
import sys
import asyncio
from types import SimpleNamespace
from contextlib import contextmanager

import pytest
from fastapi import HTTPException


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


import app.routes_user as routes_user  # noqa: E402
from app.routes_user import ColorItem, MaterialItem, UserSettingsUpdate, update_user_settings  # noqa: E402


def _request_stub():
    return SimpleNamespace(
        method="PUT",
        url=SimpleNamespace(path="/api/user/settings"),
        state=SimpleNamespace(request_id="test-request-id"),
        headers={},
        client=SimpleNamespace(host="127.0.0.1"),
    )


@contextmanager
def _db_session_stub():
    class _Query:
        def filter(self, *args, **kwargs):
            return self

        def first(self):
            return SimpleNamespace(id=1, username="tester")

    class _Db:
        def query(self, *args, **kwargs):
            return _Query()

    yield _Db()


def test_update_user_settings_allows_same_brand_material_different_colors():
    payload = UserSettingsUpdate(
        materials=[
            MaterialItem(
                name="PLA",
                brand="Eryone",
                density=1.24,
                price_per_kg=80,
                color=ColorItem(name="蓝色", hex="#2563eb"),
            ),
            MaterialItem(
                name="PLA",
                brand="Eryone",
                density=1.24,
                price_per_kg=80,
                color=ColorItem(name="橙色", hex="#d58f2a"),
            ),
        ]
    )

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(routes_user, "get_db_session", _db_session_stub)
        mp.setattr(routes_user, "write_audit_event", lambda **kwargs: None)
        result = asyncio.run(update_user_settings(payload, _request_stub(), {"id": 1, "username": "tester"}))

    assert result["status"] == "success"
    assert result["default_nozzle"] is None


def test_update_user_settings_rejects_exact_duplicate_brand_material_color():
    payload = UserSettingsUpdate(
        materials=[
            MaterialItem(
                name="PLA",
                brand="Eryone",
                density=1.24,
                price_per_kg=80,
                color=ColorItem(name="蓝色", hex="#2563eb"),
            ),
            MaterialItem(
                name="PLA",
                brand="Eryone",
                density=1.24,
                price_per_kg=80,
                color=ColorItem(name="蓝色", hex="#2563eb"),
            ),
        ]
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(update_user_settings(payload, _request_stub(), {"id": 1, "username": "tester"}))

    assert exc.value.status_code == 400
    assert "材料重复：Eryone / PLA / #2563eb" in str(exc.value.detail)
