#!/bin/bash
set -e

echo "[pricer3d] Starting pricer3d (PrusaSlicer only)..."
echo "[pricer3d] Data dir:  ${DB_PATH:-/app/data/app.db}"
echo "[pricer3d] Env:       ${APP_ENV:-development}"

exec /app/venv/bin/uvicorn main:app --host 0.0.0.0 --port 5000
