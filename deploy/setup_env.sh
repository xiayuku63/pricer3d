#!/usr/bin/env bash
# setup_env.sh — Generate secure .env.prod from template for a new server.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.prod ]; then
  echo ".env.prod already exists. Overwrite? (y/N): "
  read -r answer
  if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
    echo "Aborted."
    exit 1
  fi
fi

cp .env.prod.example .env.prod

JWT_SECRET=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)

if [[ "$(uname -s)" == "Darwin" ]]; then
  sed -i '' "s/JWT_SECRET_KEY=.*/JWT_SECRET_KEY=$JWT_SECRET/" .env.prod
  sed -i '' "s/PAYMENT_WEBHOOK_SECRET=.*/PAYMENT_WEBHOOK_SECRET=$WEBHOOK_SECRET/" .env.prod
else
  sed -i "s/JWT_SECRET_KEY=.*/JWT_SECRET_KEY=$JWT_SECRET/" .env.prod
  sed -i "s/PAYMENT_WEBHOOK_SECRET=.*/PAYMENT_WEBHOOK_SECRET=$WEBHOOK_SECRET/" .env.prod
fi

echo "============================================"
echo "  .env.prod created with secure secrets!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Edit .env.prod to configure SMTP / RESEND_API_KEY:"
echo "     nano .env.prod"
echo "  2. Run the one-click deploy:"
echo "     bash deploy/one_click_deploy.sh"
