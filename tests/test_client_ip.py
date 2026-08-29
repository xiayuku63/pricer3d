"""Client IP resolution — TRUST_PROXY / X-Forwarded-For handling."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import Request

from app import utils


def _make_request(headers: dict, client_host: str = "127.0.0.1") -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (client_host, 50000),
        "query_string": b"",
        "server": ("testserver", 80),
        "scheme": "http",
    }
    return Request(scope)


def test_trust_proxy_uses_last_xff_entry(monkeypatch):
    """First XFF entry is client-controlled; behind a single appending proxy the
    real peer is the LAST entry, so the leftmost value must never win."""
    monkeypatch.setattr(utils, "TRUST_PROXY", True)
    req = _make_request({"X-Forwarded-For": "1.2.3.4, 10.0.0.1"}, client_host="10.0.0.1")
    assert utils.get_client_ip(req) == "10.0.0.1"


def test_trust_proxy_prefers_x_real_ip(monkeypatch):
    monkeypatch.setattr(utils, "TRUST_PROXY", True)
    req = _make_request(
        {"X-Real-IP": "9.9.9.9", "X-Forwarded-For": "1.2.3.4, 10.0.0.1"},
        client_host="10.0.0.1",
    )
    assert utils.get_client_ip(req) == "9.9.9.9"


def test_trust_proxy_falls_back_to_socket_ip(monkeypatch):
    monkeypatch.setattr(utils, "TRUST_PROXY", True)
    req = _make_request({}, client_host="192.168.1.5")
    assert utils.get_client_ip(req) == "192.168.1.5"


def test_no_trust_proxy_ignores_forwarded_headers(monkeypatch):
    """Direct exposure: forged X-Real-IP/XFF must not bypass rate limiting."""
    monkeypatch.setattr(utils, "TRUST_PROXY", False)
    req = _make_request(
        {"X-Real-IP": "9.9.9.9", "X-Forwarded-For": "1.2.3.4"},
        client_host="203.0.113.7",
    )
    assert utils.get_client_ip(req) == "203.0.113.7"
