# HTTPS Setup for pricer3d.top

This document explains how to set up HTTPS with Let's Encrypt for the pricer3d project.

## Prerequisites

1. DNS A/AAAA records for `pricer3d.top` and `www.pricer3d.top` pointing to your server IP
2. Ports 80 and 443 open in firewall
3. Docker and Docker Compose installed

## Quick Start

### 1. Initial SSL Certificate Setup (First Time Only)

```bash
# From the project root directory
./deploy/init-ssl.sh your-email@example.com
```

This script will:
- Create a temporary HTTP-only nginx config
- Request SSL certificates from Let's Encrypt
- Restore the full HTTPS nginx config
- Restart nginx with HTTPS enabled

### 2. Verify Configuration

```bash
# Test nginx config syntax
./deploy/test-nginx-config.sh

# Check if nginx is running
docker compose -f docker-compose.prod.yml ps

# Test HTTPS access
curl -I https://pricer3d.top
```

### 3. Auto-Renewal

The `certbot` service in `docker-compose.prod.yml` automatically renews certificates every 12 hours.

## Configuration Files

- `deploy/nginx_docker.conf` - Main nginx configuration with HTTPS
- `deploy/init-ssl.sh` - Initial SSL certificate setup script
- `deploy/test-nginx-config.sh` - Nginx config syntax test
- `docker-compose.prod.yml` - Production Docker Compose with certbot

## Manual Certificate Renewal

If you need to manually renew certificates:

```bash
docker compose -f docker-compose.prod.yml run --rm certbot certbot renew
docker compose -f docker-compose.prod.yml restart nginx
```

## Troubleshooting

### Certificate Not Found Error

If nginx fails to start with "certificate not found" error:
1. Run `./deploy/init-ssl.sh` to obtain initial certificates
2. Or check if certificates exist: `docker compose -f docker-compose.prod.yml exec nginx ls -la /etc/letsencrypt/live/`

### Port 80/443 Already in Use

If ports are already in use:
```bash
# Check what's using the ports
sudo netstat -tulpn | grep :80
sudo netstat -tulpn | grep :443

# Stop conflicting services
sudo systemctl stop apache2  # if Apache is running
sudo systemctl stop nginx    # if system nginx is running
```

### Certificate Renewal Failed

Check certbot logs:
```bash
docker compose -f docker-compose.prod.yml logs certbot
```

## Security Features

The nginx configuration includes:

- TLS 1.2+ only (no older protocols)
- Strong cipher suites
- OCSP stapling for faster SSL handshakes
- HSTS (HTTP Strict Transport Security) with 2-year max-age
- Security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection)
- Session ticket optimization
