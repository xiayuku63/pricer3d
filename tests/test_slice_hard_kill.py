"""Hard-kill of in-flight slicing processes when a batch is cancelled.

The stop button / a replacing recalc calls POST /api/quote/cancel;
cancel_batch now terminates still-running PrusaSlicer processes registered
under that batch id instead of letting abandoned slices burn CPU for minutes.
"""

import os
import subprocess
import sys

import parser.prusa_slicer as ps
from app.quote_batch import cancel_batch, register_batch


def _spawn_sleeper():
    kwargs = {}
    if os.name != "nt":
        kwargs["start_new_session"] = True
    return subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **kwargs,
    )


def _register(batch_id, proc):
    ps._register_active_slice(proc.pid, {
        "pid": proc.pid,
        "proc": proc,
        "cmd": [sys.executable],
        "output": f"{batch_id}.gcode",
        "batch_id": batch_id,
    })


def test_kill_slices_for_batch_kills_registered_process():
    proc = _spawn_sleeper()
    _register("b1", proc)
    try:
        assert ps.kill_slices_for_batch("b1") == 1
        assert proc.wait(timeout=10) != 0
    finally:
        ps._unregister_active_slice(proc.pid)
        if proc.poll() is None:
            proc.kill()


def test_kill_slices_for_batch_ignores_other_batches_and_dead_procs():
    proc = _spawn_sleeper()
    _register("b2", proc)
    try:
        assert proc.poll() is None
        assert ps.kill_slices_for_batch("other-batch") == 0
        assert proc.poll() is None
        proc.kill()
        proc.wait(timeout=10)
        assert ps.kill_slices_for_batch("b2") == 0
    finally:
        ps._unregister_active_slice(proc.pid)


def test_cancel_batch_hard_kills_inflight_slice():
    proc = _spawn_sleeper()
    _register("b3", proc)
    register_batch("b3", 7)
    try:
        # Wrong owner must not cancel or kill.
        assert cancel_batch("b3", 99) is False
        assert proc.poll() is None
        assert cancel_batch("b3", 7) is True
        assert proc.wait(timeout=10) != 0
        # Killing again is a no-op (idempotent) once the process is dead.
        assert ps.kill_slices_for_batch("b3") == 0
    finally:
        ps._unregister_active_slice(proc.pid)


def test_set_slice_batch_stamps_context():
    token = ps.set_slice_batch("b9")
    try:
        assert ps._current_slice_batch.get() == "b9"
        ps.set_slice_batch(None)
        assert ps._current_slice_batch.get() is None
    finally:
        ps._current_slice_batch.reset(token)
