#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
source "$SCRIPT_DIR/config.sh"

# Builds the frontend and (re)installs the nginx site. Safe to re-run for
# redeploys - this is also what deploy.sh calls. Assumes
# 03-deploy-backend.sh already cloned/updated $APP_DIR.

cd "$APP_DIR/frontend"

echo "==> npm ci"
npm ci

echo "==> npm run build"
npm run build

echo "==> Installing nginx site (port $FRONTEND_PORT)"
sed \
  -e "s#__APP_DIR__#$APP_DIR#g" \
  -e "s#__FRONTEND_PORT__#$FRONTEND_PORT#g" \
  -e "s#__BACKEND_HOST__#$BACKEND_HOST#g" \
  -e "s#__BACKEND_PORT__#$BACKEND_PORT#g" \
  "$SCRIPT_DIR/nginx-garden.conf.template" | sudo tee /etc/nginx/sites-available/garden >/dev/null

sudo ln -sf /etc/nginx/sites-available/garden /etc/nginx/sites-enabled/garden
sudo nginx -t
sudo systemctl reload nginx

echo "==> Waiting for frontend to come up"
sleep 1
if curl -fsS "http://127.0.0.1:$FRONTEND_PORT/" >/dev/null; then
  echo "==> Frontend OK on port $FRONTEND_PORT"
else
  echo "Frontend check failed - check: sudo journalctl -u nginx -n 50" >&2
  exit 1
fi
