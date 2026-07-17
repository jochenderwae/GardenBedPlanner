#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
source "$SCRIPT_DIR/config.sh"

# One-time OS package bootstrap for garden-planner-dev (Debian 13/trixie, no Docker).
# Run as a sudo-capable user. Safe to re-run.

echo "==> apt update"
sudo apt update

echo "==> Installing git, nginx, curl, nodejs, npm"
sudo apt install -y git nginx curl ca-certificates nodejs npm

if ! command -v uv >/dev/null 2>&1; then
  echo "==> Installing uv (not packaged in Debian's apt repos; system python3 already satisfies pyproject's >=3.12)"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  echo "==> uv installs to ~/.local/bin - open a new shell (or 'source ~/.bashrc') before running 03-deploy-backend.sh"
else
  echo "==> uv already installed, skipping"
fi

echo "==> Creating $APP_DIR (owned by $(whoami))"
sudo install -d -o "$(whoami)" -g "$(whoami)" "$APP_DIR"

echo "==> Done. Next: 02-setup-database.sh"
