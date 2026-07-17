#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

# Re-run this for every redeploy once 01-install-packages.sh and
# 02-setup-database.sh have been run once (one-time bootstrap). Pulls the
# latest $BRANCH (see config.sh), rebuilds backend + frontend, restarts
# services.

"$SCRIPT_DIR/03-deploy-backend.sh"
"$SCRIPT_DIR/04-deploy-frontend.sh"

echo "==> Deploy complete"
