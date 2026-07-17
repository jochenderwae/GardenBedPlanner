#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
source "$SCRIPT_DIR/config.sh"

# Creates the app's Postgres role + database on the already-installed local
# Postgres instance. Idempotent - safe to re-run.
#
# Override PG_APP_USER / PG_APP_PASSWORD / PG_APP_DB in config.sh (or as env
# vars) before running this if you don't want the "garden/garden" defaults
# that also match infra/.env.example (the docker-compose path).

if [ "$PG_APP_PASSWORD" = "garden" ]; then
  echo "WARNING: using the default password 'garden' - fine for a throwaway test box," >&2
  echo "         but set PG_APP_PASSWORD before running this script for anything more exposed." >&2
fi

echo "==> Ensuring role '$PG_APP_USER' exists"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$PG_APP_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE \"$PG_APP_USER\" LOGIN PASSWORD '$PG_APP_PASSWORD';"

echo "==> Ensuring database '$PG_APP_DB' exists"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_APP_DB'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE \"$PG_APP_DB\" OWNER \"$PG_APP_USER\";"

echo "==> Done. DATABASE_URL should be:"
echo "    postgresql+psycopg://$PG_APP_USER:$PG_APP_PASSWORD@localhost:5432/$PG_APP_DB"
echo "==> Next: 03-deploy-backend.sh"
