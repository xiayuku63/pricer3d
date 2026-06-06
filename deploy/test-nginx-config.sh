#!/bin/bash
# test-nginx-config.sh - Test nginx configuration syntax
# Usage: ./deploy/test-nginx-config.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "==> Testing nginx configuration syntax..."
docker compose -f docker-compose.prod.yml run --rm nginx nginx -t

echo "==> Nginx configuration is valid!"
