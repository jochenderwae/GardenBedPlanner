# Shared configuration for the GardenBedPlanner bare-metal deploy scripts.
# Sourced by every numbered script - edit the values below (or override via
# environment variables of the same name) for your environment.

APP_DIR="${APP_DIR:-/opt/gardenbedplanner}"
REPO_URL="${REPO_URL:-https://github.com/jochenderwae/GardenBedPlanner.git}"
# garden-planner-dev tracks dev for now, not main - switch this once dev merges to main.
BRANCH="${BRANCH:-dev}"

# BACKEND_HOST is what nginx and the local health-check curls *connect to*
# (must stay loopback - 0.0.0.0 isn't a valid connect target). BACKEND_BIND_HOST
# is what uvicorn itself *binds to*: 0.0.0.0 makes the API (and /docs) reachable
# directly from the LAN on BACKEND_PORT, not just via nginx. Set it back to
# 127.0.0.1 if you only want the app reachable through nginx on FRONTEND_PORT.
BACKEND_HOST="127.0.0.1"
BACKEND_BIND_HOST="0.0.0.0"
BACKEND_PORT="8000"
FRONTEND_PORT="8080"

SERVICE_NAME="garden-backend"
SERVICE_USER="${SERVICE_USER:-$(whoami)}"

# Must match what 02-setup-database.sh creates in Postgres.
PG_APP_USER="${PG_APP_USER:-garden}"
PG_APP_PASSWORD="${PG_APP_PASSWORD:-garden}"
PG_APP_DB="${PG_APP_DB:-garden}"
