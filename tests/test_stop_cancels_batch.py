"""Stop-button semantics: files that never started must be cancelled and
must not reach quote history (integration through build_quote_payload)."""

import asyncio
import sys
import os
import time
from io import BytesIO

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import init_orm
init_orm()


def test_stop_cancels_queued_files_and_skips_history(tmp_path, monkeypatch):
    from fastapi import UploadFile

    from app import quote_batch
    from app.db import get_db_session
    from app.models_orm import QuoteHistory
    from app.services.quote import build_quote_payload, save_quote_history

    started = []

    def fake_sync(file, *args, **kwargs):
        started.append(file.filename)
        time.sleep(1.0)  # in-flight slice window
        return {
            "filename": file.filename, "status": "success", "cost_cny": 1.0,
            "weight_g": 1.0, "estimated_time_h": 0.1, "quantity": 1,
            "volume_cm3": 1.0, "surface_area_cm2": 1.0, "dimensions": "d",
            "cost_breakdown": {},
        }

    monkeypatch.setattr("app.services.quote._process_single_file_sync", fake_sync)

    class FakeHeaders:
        def get(self, key, default=None):
            return {"x-quote-batch-id": batch_id}.get(key, default)

    from types import SimpleNamespace
    class FakeRequest:
        headers = FakeHeaders()
        client = None
        method = "POST"
        url = SimpleNamespace(path="/api/quote")
        async def is_disconnected(self):
            return False

    files = [
        UploadFile(filename=f"p{i}.stl", file=BytesIO(b"solid x\nendsolid x\n"))
        for i in range(6)
    ]
    user = {"id": 424243, "username": "cancel_test", "membership_level": "member"}
    batch_id = "batch-test-0001"
    quote_batch.register_batch(batch_id, 424243)

    async def cancel_later():
        await asyncio.sleep(0.4)  # mid-batch: 4 in flight, 2 still queued
        return quote_batch.cancel_batch(batch_id, 424243)

    async def run():
        return await asyncio.gather(
            build_quote_payload(
                FakeRequest(), files, "PLA", None, 0.2, 20, 3, None, 1,
                "White", None, None, False, None, None, None, None, user,
            ),
            cancel_later(),
        )

    payload, cancelled = asyncio.run(run())
    assert cancelled is True

    statuses = {r["filename"]: r["status"] for r in payload["results"]}
    assert statuses["p0.stl"] == "success", "started files complete"
    assert statuses["p1.stl"] == "success"
    assert statuses["p4.stl"] == "cancelled", "queued files must be cancelled, not quoted"
    assert statuses["p5.stl"] == "cancelled"

    save_quote_history(user["id"], payload["results"])
    with get_db_session() as db:
        names = {
            r.filename
            for r in db.query(QuoteHistory).filter(QuoteHistory.user_id == user["id"]).all()
        }
    assert "p0.stl" in names
    assert "p4.stl" not in names and "p5.stl" not in names, \
        "cancelled files must never reach quote history"
