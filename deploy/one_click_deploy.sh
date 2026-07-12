#!/usr/bin/env bash
# one_click_deploy.sh — "One-click" deploy to Ubuntu server.
# Run this ON THE SERVER, or via SSH.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[1;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*"; }

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

log "🚀 Pricer3D One-Click Deploy"
log "Dir: $APP_DIR"

# ── 1. Pull latest code ──
log "📦 Pulling latest code from GitHub..."
git pull origin main

# ── 2. Ensure .env.prod exists ──
log "📝 Checking .env.prod..."
if [ ! -f .env.prod ]; then
  cp .env.prod.example .env.prod
  JWT_SECRET=$(openssl rand -hex 32)
  WEBHOOK_SECRET=$(openssl rand -hex 32)
  sed -i "s/JWT_SECRET_KEY=.*/JWT_SECRET_KEY=$JWT_SECRET/" .env.prod
  sed -i "s/PAYMENT_WEBHOOK_SECRET=.*/PAYMENT_WEBHOOK_SECRET=$WEBHOOK_SECRET/" .env.prod
  warn ".env.prod created with auto-generated secrets"
  warn "Visit: nano .env.prod  →  configure SMTP, RESEND_API_KEY if needed"
else
  ok ".env.prod exists"
fi

# ── 3. Build and restart ──
log "🐳 Building Docker image (this may take a few minutes)..."
docker compose -f docker-compose.prod.yml build

log "🔄 Restarting services..."
docker compose -f docker-compose.prod.yml up -d

# ── 4. Wait for readiness ──
log "⏳ Waiting for app to be ready..."
READY=false
for i in $(seq 1 12); do
  sleep 5
  if curl -sf http://127.0.0.1:5000/healthz > /dev/null 2>&1; then
    ok "Health check passed"
    READY=true
    break
  fi
  log "   Attempt $i/12..."
done
if [ "$READY" = false ]; then
  err "Health check failed after 60s"
  docker compose -f docker-compose.prod.yml logs --tail=30 app
  exit 1
fi

# ── 5. Verify PrusaSlicer ──
log "🔬 Verifying PrusaSlicer..."
PRUSA_DIAG=$(docker exec pricer3d-app /app/venv/bin/python -c "
import json
from parser.prusa_slicer import prusa_executable_diagnostics
d = prusa_executable_diagnostics()
print(json.dumps({'found': d['found'], 'path': d['path']}))
" 2>/dev/null || echo '{"found":false}')

if echo "$PRUSA_DIAG" | python3 -c "import sys,json; exit(0 if json.load(sys.stdin).get('found') else 1)" 2>/dev/null; then
  ok "PrusaSlicer: $PRUSA_DIAG"
else
  warn "PrusaSlicer not detected. Slicing will use formula fallback."
  warn "Check: docker exec pricer3d-app /usr/local/bin/prusa-slicer --help"
fi

echo ""
ok "============================================"
ok "  Deploy complete!"
ok "  Site:   https://www.pricer3d.top"
ok "  Health: http://127.0.0.1:5000/healthz"
ok "  Logs:   docker compose -f docker-compose.prod.yml logs -f app"
ok "============================================"
