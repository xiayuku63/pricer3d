"""Async quote jobs (P2-15): create -> poll -> history; cancel -> nothing lands."""

import json
import os
import sys
import time
from io import BytesIO

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import init_orm
init_orm()


def _upload(name):
    from fastapi import UploadFile
    return UploadFile(filename=name, file=BytesIO(b"solid x\nendsolid x\n"))


def _create_job(monkeypatch, result_status="success", delay=0.0, n=3, user_id=434343):
    from app.services import quote_jobs

    def fake_sync(file, *args, **kwargs):
        if delay:
            time.sleep(delay)
        return {
            "filename": file.filename, "status": result_status, "cost_cny": 1.5,
            "weight_g": 1.0, "estimated_time_h": 0.1, "quantity": 1,
            "volume_cm3": 1.0, "surface_area_cm2": 2.0, "dimensions": "d",
            "cost_breakdown": {},
        }

    monkeypatch.setattr(quote_jobs, "_process_single_file_sync", fake_sync)
    user = {"id": user_id, "username": "job_test", "membership_level": "member"}
    job_id = quote_jobs.create_quote_job(
        files=[_upload(f"j{i}.stl") for i in range(n)],
        material="PLA", brand=None, layer_height=0.2, infill=20, wall_count=3,
        slicer_preset_id=None, quantity=1, color="White", use_prusaslicer=False,
        printer_model=None, auto_orient=False, entity_colors_json=None,
        current_user=user,
    )
    return quote_jobs, job_id, user


def _await_terminal(get_fn, job_id, timeout=15.0):
    deadline = time.time() + timeout
    state = None
    while time.time() < deadline:
        state = get_fn(job_id)
        if state["status"] not in ("pending", "running"):
            return state
        time.sleep(0.05)
    raise AssertionError(f"job did not finish: {state}")


def test_job_runs_to_completion_and_saves_history(tmp_path, monkeypatch):
    from app.db import get_db_session
    from app.models_orm import QuoteHistory

    quote_jobs, job_id, user = _create_job(monkeypatch)
    state = _await_terminal(lambda jid: quote_jobs.get_quote_job(jid, user["id"]), job_id)

    assert state["status"] == "success"
    assert all(i["status"] == "success" for i in state["items"])
    assert len(state["items"]) == 3
    results = [i["result"] for i in state["items"]]
    assert all(r and r["cost_cny"] == 1.5 for r in results)

    with get_db_session() as db:
        names = {
            r.filename for r in
            db.query(QuoteHistory).filter(QuoteHistory.user_id == user["id"]).all()
        }
    assert names == {f"j{i}.stl" for i in range(3)}, names


def test_cancelled_job_discards_results_and_history(tmp_path, monkeypatch):
    from app.db import get_db_session
    from app.models_orm import QuoteHistory

    quote_jobs, job_id, user = _create_job(monkeypatch, delay=0.3, n=2, user_id=434344)
    # cancel while items are in flight
    time.sleep(0.05)
    assert quote_jobs.cancel_quote_job(job_id, user["id"]) is True
    state = _await_terminal(lambda jid: quote_jobs.get_quote_job(jid, user["id"]), job_id)

    assert state["status"] == "cancelled"
    assert all(i["status"] in ("cancelled", "running") for i in state["items"])
    time.sleep(0.5)  # let in-flight items land their cancelled state
    state = quote_jobs.get_quote_job(job_id, user["id"])
    assert all(i["status"] == "cancelled" for i in state["items"])
    assert all(i["result"] is None for i in state["items"])

    with get_db_session() as db:
        rows = db.query(QuoteHistory).filter(QuoteHistory.user_id == user["id"]).all()
    assert rows == [], "cancelled job must not reach quote history"


def test_job_ownership_enforced(tmp_path, monkeypatch):
    from fastapi import HTTPException

    quote_jobs, job_id, user = _create_job(monkeypatch, n=1, user_id=434345)
    _await_terminal(lambda jid: quote_jobs.get_quote_job(jid, user["id"]), job_id)
    try:
        quote_jobs.get_quote_job(job_id, user["id"] + 1)
        raise AssertionError("expected 404")
    except HTTPException as exc:
        assert exc.status_code == 404
