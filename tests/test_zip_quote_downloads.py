import json
from types import SimpleNamespace

from starlette.requests import Request

from app.services.zip_quote_downloads import get_template_user_brands


def test_download_module_uses_fallback_brands_without_authentication():
    request = Request({"type": "http", "headers": []})

    assert get_template_user_brands(request) == ["eSUN", "Generic", "Hatchbox", "Polymaker", "Sunlu"]


def test_download_module_reads_authenticated_user_brands_with_injected_db():
    from jose import jwt
    from app.config import JWT_ALGORITHM, JWT_SECRET_KEY

    user = SimpleNamespace(materials=json.dumps([{"brand": "Brand Z"}, {"brand": "Brand A"}]))

    class Query:
        def filter(self, *_args):
            return self

        def first(self):
            return user

    class Database:
        def query(self, *_args):
            return Query()

    def session_factory():
        class Context:
            def __enter__(self):
                return Database()

            def __exit__(self, *_args):
                return False

        return Context()

    token = jwt.encode({"sub": "1"}, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    request = Request({"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]})

    assert get_template_user_brands(request, db_session_factory=session_factory) == ["Brand A", "Brand Z"]
