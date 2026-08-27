"""Client-disconnect cancellation: abandoned work must not reach history."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import init_orm
init_orm()


def test_cancelled_results_are_not_persisted():
    from app.services.quote import save_quote_history
    from app.db import get_db_session
    from app.models_orm import QuoteHistory

    results = [
        {
            "filename": "done.stl", "status": "success", "cost_cny": 1.0,
            "weight_g": 2.0, "estimated_time_h": 0.1, "quantity": 1,
            "volume_cm3": 1.0, "dimensions": "10x10x10",
        },
        {
            "filename": "skipped.stl", "status": "cancelled",
            "error": "客户端已断开，报价已取消",
            "cost_cny": 0, "weight_g": 0, "estimated_time_h": 0,
        },
    ]
    save_quote_history(424242, results)

    with get_db_session() as db:
        names = {
            r.filename
            for r in db.query(QuoteHistory).filter(QuoteHistory.user_id == 424242).all()
        }

    assert "done.stl" in names
    assert "skipped.stl" not in names, "abandoned (cancelled) files must not reach quote history"


def test_batch_cancel_flag_is_owner_scoped():
    from app.quote_batch import cancel_batch, batch_cancelled, register_batch, release_batch

    register_batch("batch-abc-123", 7)
    assert batch_cancelled("batch-abc-123", 7) is False  # active
    assert batch_cancelled("batch-abc-123", 8) is True   # other user sees it as gone
    assert cancel_batch("batch-abc-123", 8) is False     # foreign cancel rejected
    assert cancel_batch("batch-abc-123", 7) is True
    assert batch_cancelled("batch-abc-123", 7) is True
    release_batch("batch-abc-123")
    assert batch_cancelled("batch-abc-123", 7) is True
