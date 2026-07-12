#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[1;34m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*"; }

cd "$(dirname "$0")/.."
log "3D Printing Quoting System — Docker Deploy"

# ── Pre-flight checks ──
if [ ! -f .env.prod ]; then
  err ".env.prod not found! Run: cp .env.prod.example .env.prod"
  err "Then edit .env.prod with your secrets before deploying."
  exit 1
fi

# ── Pull latest code ──
log "Pulling latest code..."
git pull origin main

# ── Build & start ──
log "Building Docker image..."
docker compose -f docker-compose.prod.yml build

log "Starting services..."
docker compose -f docker-compose.prod.yml up -d

# ── Wait for readiness ──
log "Waiting for app to be ready..."
for i in $(seq 1 6); do
  sleep 5
  if curl -sf http://127.0.0.1:5000/healthz > /dev/null 2>&1; then
    ok "Health check passed"
    break
  fi
  if [ "$i" -eq 6 ]; then
    warn "Health check timed out after 30s"
  fi
done

# ── Verify PrusaSlicer ──
log "Verifying PrusaSlicer..."
PRUSA_DIAG=$(docker exec pricer3d-app /app/venv/bin/python -c "
import json
from parser.prusa_slicer import prusa_executable_diagnostics
d = prusa_executable_diagnostics()
print(json.dumps({'found': d['found'], 'path': d['path']}))
" 2>/dev/null || echo '{"found":false}')

if echo "$PRUSA_DIAG" | python3 -c "import sys,json; exit(0 if json.load(sys.stdin).get('found') else 1)" 2>/dev/null; then
  ok "PrusaSlicer available: $PRUSA_DIAG"
else
  warn "PrusaSlicer not detected. Slicing will use formula fallback."
fi

echo ""
ok "Deploy successful!"
echo "  Site:   https://www.pricer3d.top"
echo "  Check:  curl http://127.0.0.1/healthz"
echo "  Logs:   docker compose -f docker-compose.prod.yml logs -f app"
