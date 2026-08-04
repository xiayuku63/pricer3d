import json
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

def test_free_user_pricing_save_preserves_locked_formulas():
    """Free users may save numeric pricing settings without submitting formulas."""
    user = SimpleNamespace(
        id=1,
        username="free-user",
        materials="[]",
        pricing_config=json.dumps(
            {
                "machine_hourly_rate_cny": 15,
                "unit_cost_formula": "1",
                "total_cost_formula": "unit_cost_cny * quantity",
            }
        ),
    )

    @contextmanager
    def db_session_stub():
        class _Query:
            def filter(self, *args, **kwargs):
                return self

            def first(self):
                return user

        class _Db:
            def query(self, *args, **kwargs):
                return _Query()

        yield _Db()

    payload = UserSettingsUpdate(
        materials=[
            MaterialItem(
                name="PLA",
                brand="Generic",
                density=1.24,
                price_per_kg=80,
                color=ColorItem(name="black", hex="#000000"),
            )
        ],
        # PricingConfig supplies blank formula defaults when a free user only
        # sends the editable numeric settings.
        pricing_config=routes_user.PricingConfig(machine_hourly_rate_cny=23),
    )

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(routes_user, "get_db_session", db_session_stub)
        mp.setattr(routes_user, "write_audit_event", lambda **kwargs: None)
        result = asyncio.run(
            update_user_settings(
                payload,
                _request_stub(),
                {"id": 1, "username": "free-user", "membership_level": "free"},
            )
        )

    saved_pricing = json.loads(user.pricing_config)
    assert result["status"] == "success"
    assert saved_pricing["machine_hourly_rate_cny"] == 23
    assert saved_pricing["unit_cost_formula"] == "1"
    assert saved_pricing["total_cost_formula"] == "unit_cost_cny * quantity"
