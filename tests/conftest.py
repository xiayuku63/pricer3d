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
