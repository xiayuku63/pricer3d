import pytest
"""Shared test bootstrap — runs before any test module is imported.

pydantic-settings resolves DB_PATH when ``app.config`` is first imported,
and the module-level engine in ``app.db`` binds to whatever that resolves
to. Setting the variable here keeps every test process on in-memory
SQLite.

History: this used to live at the top of test_auth.py, which lost the
import race to test_3mf_entities.py (alphabetically first, imports the
app package) — the engine bound to the developer's real app.db and the
per-test drop_all fixture then wiped it.
"""

import os

os.environ.setdefault("DB_PATH", ":memory:")


@pytest.fixture(autouse=True)
def _isolated_model_cache(tmp_path, monkeypatch):
    """Point the shared normalized-mesh cache at a per-test directory.

    The production cache is cross-process by design; tests must not see (or
    leave) entries from other runs, or fixture models with identical bytes
    would silently hit a stale conversion instead of the fake converter.
    """
    import parser.model_pipeline as _mp

    monkeypatch.setattr(_mp, "_MODEL_CACHE_ROOT", tmp_path / "model_cache")
