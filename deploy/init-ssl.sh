#!/bin/bash
# init-ssl.sh - Run once to obtain initial SSL certificate from Let's Encrypt
# Handles the bootstrap problem: nginx can't start with SSL before certs exist.
#
# Usage: ./deploy/init-ssl.sh [email@example.com]
#
# Prerequisites:
#   1. DNS A/AAAA records for pricer3d.top and www.pricer3d.top pointing to this server
#   2. Port 80 and 443 open in firewall

set -e

EMAIL="${1:-admin@pricer3d.top}"
DOMAIN="pricer3d.top"
COMPOSE_FILE="docker-compose.prod.yml"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "==> [1/4] Creating temporary HTTP-only nginx config for ACME challenge..."
cat > /tmp/nginx_certbot_temp.conf <<'NGINX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name www.pricer3d.top pricer3d.top;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'SSL setup in progress...';
        add_header Content-Type text/plain;
    }
}
NGINX_EOF

# Bind-mount the temporary config
export COMPOSE_FILE
docker compose -f "$COMPOSE_FILE" stop nginx 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" run --rm \
  -v /tmp/nginx_certbot_temp.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx nginx -t

echo "==> [2/4] Starting nginx with HTTP-only config..."
docker compose -f "$COMPOSE_FILE" up -d nginx
# Override the config at runtime
docker cp /tmp/nginx_certbot_temp.conf pricer3d-nginx:/etc/nginx/conf.d/default.conf
docker exec pricer3d-nginx nginx -s reload

sleep 2

echo "==> [3/4] Requesting SSL certificate from Let's Encrypt..."
docker compose -f "$COMPOSE_FILE" run --rm certbot \
  certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  -d "${DOMAIN}" \
  -d "www.${DOMAIN}" \
  --non-interactive

echo "==> [4/4] Restoring full HTTPS nginx config and restarting..."
docker cp ./deploy/nginx_docker.conf pricer3d-nginx:/etc/nginx/conf.d/default.conf
docker exec pricer3d-nginx nginx -s reload

rm -f /tmp/nginx_certbot_temp.conf

echo ""
echo "============================================"
echo "  SSL certificate obtained successfully!"
echo "  HTTPS is now active for ${DOMAIN}"
echo "  Auto-renewal is handled by certbot service"
echo "============================================"
