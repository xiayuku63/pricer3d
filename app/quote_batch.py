"""Active quote-batch registry for cooperative cancellation.

A batch is registered when its first request arrives and removed when the
batch finishes. The stop button marks the batch cancelled via
POST /api/quote/cancel; workers check the flag before starting each file.
This works on every platform — unlike request.is_disconnected(), which
never fires on Windows/uvicorn (proactor) and is kept only as a secondary
signal.
"""

import threading
from typing import Dict

_lock = threading.Lock()
# batch_id -> user_id (ownership, so only the owner can cancel a batch)
_active: Dict[str, int] = {}


def register_batch(batch_id: str, user_id: int) -> None:
    with _lock:
        _active[batch_id] = int(user_id)


def release_batch(batch_id: str) -> None:
    with _lock:
        _active.pop(batch_id, None)


def batch_cancelled(batch_id: str, user_id: int) -> bool:
    with _lock:
        return _active.get(batch_id) != int(user_id)


def cancel_batch(batch_id: str, user_id: int) -> bool:
    """Mark a batch cancelled. Returns True when a batch owned by this user
    was actually cancelled."""
    with _lock:
        if _active.get(batch_id) == int(user_id):
            _active.pop(batch_id, None)
            return True
        return False
