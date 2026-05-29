#!/bin/bash
set -e

echo "[pricer3d] Starting pricer3d (PrusaSlicer only)..."
echo "[pricer3d] Data dir:  ${DB_PATH:-/app/data/app.db}"
echo "[pricer3d] Env:       ${APP_ENV:-development}"

# Background cleanup loop — runs daily
(
  while true; do
    sleep 86400
    echo "[pricer3d] Running daily cleanup..."
    /app/venv/bin/python3 -m app.cleanup 2>&1
  done
) &
CLEANUP_PID=$!
echo "[pricer3d] Cleanup daemon started (pid=$CLEANUP_PID)"

exec /app/venv/bin/uvicorn main:app --host 0.0.0.0 --port 5000
