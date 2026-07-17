# infra

`deploy/` is the active bare-metal deployment path, run against **garden-planner-dev** (the development machine) — there is no dedicated test box provisioned yet, so this pipeline runs on the dev machine as a stand-in for now. `docker-compose.yml` is kept as a reference for what a containerized deployment on a future test box might look like.

Proxmox layout (per CLAUDE.md):

- `garden-planner-dev` — Debian 13 (trixie) LXC, `192.168.0.26`, bare-metal (git + systemd + nginx), Postgres 17 already installed and running. Used for day-to-day development *and* currently hosts the `deploy/` pipeline below in lieu of a test box. See `deploy/`.
- No test box exists yet. `docker-compose.yml` documents the shape a future one could take.

## `deploy/` — bare-metal deploy scripts (no Docker)

Run these **on `garden-planner-dev` itself**, under your own account (they use `sudo` where needed). Copy `infra/deploy/` to the server (e.g. `scp -r infra/deploy garden-planner-dev:~/gardenbedplanner-deploy`, or just `git clone` the repo there and `cd infra/deploy`), then:

1. `./01-install-packages.sh` — one-time: apt packages (git, nginx, curl, nodejs, npm — all available directly from Debian 13's repos, no extra repos needed), installs `uv` (not packaged for Debian; system `python3` is already 3.13, satisfying the backend's `>=3.12` requirement), creates `$APP_DIR` (default `/opt/gardenbedplanner`).
2. `./02-setup-database.sh` — one-time: creates the `garden` Postgres role + database on the box's existing Postgres. Override `PG_APP_PASSWORD` (see `config.sh`) before running if you don't want the `garden/garden` default.
3. `./03-deploy-backend.sh` — clones/pulls the repo into `$APP_DIR`, `uv sync`, runs Alembic migrations (**first real run against a live Postgres — watch it closely**, see the note in `CLAUDE.md`), installs/restarts the `garden-backend` systemd unit (uvicorn bound to `0.0.0.0:8000` — reachable directly from the LAN, including `/docs`).
4. `./04-deploy-frontend.sh` — `npm ci && npm run build`, installs an nginx site (bound to all interfaces) serving `frontend/dist` on port `8080` and reverse-proxying `/api/` to the backend over loopback.

`config.sh` holds all the shared settings (`APP_DIR`, `REPO_URL`, `BRANCH`, ports, DB credentials) — edit it once rather than the numbered scripts. `BRANCH` defaults to `dev`. `deploy.sh` re-runs steps 3+4 for subsequent redeploys (pull latest, rebuild, restart) once 1+2 have been done once.

**Claude and sudo:** by default Claude's SSH session can only run one privileged command passwordlessly (`sudo systemctl restart garden-backend`); everything else in steps 1-4 needs the human at the keyboard. `deploy/garden-deploy.sudoers` is an optional drop-in that widens this to cover everything steps 2-4 need (Postgres role/db setup, installing the systemd unit and nginx site, reloading both services) while deliberately leaving step 1 (apt/`install -d`) password-gated — see that file for install instructions and the exact rules, and `deploy/CLAUDE.md` for how Claude checks whether it's installed before assuming the wider access is live.

**LAN access:** both the app (`http://192.168.0.26:8080`, via nginx) and the raw API/`/docs` (`http://192.168.0.26:8000`, direct to uvicorn) are reachable from other machines on the local network — nothing here binds to loopback-only except the internal nginx→backend hop, which intentionally stays on `127.0.0.1` (see `BACKEND_HOST` vs `BACKEND_BIND_HOST` in `config.sh`). Set `BACKEND_BIND_HOST=127.0.0.1` if you'd rather the API were only reachable through nginx. If it's still unreachable from another device after deploying, check `sudo ss -tlnp` on the box for the listening addresses and check for a Proxmox/host-level firewall — neither of those is something these scripts control (querying `ufw`/`nft` also needs a password Claude doesn't have).

All scripts are idempotent / safe to re-run.

## `docker-compose.yml` — containerized reference

Sketches what a containerized deployment on a future dedicated test box could look like: Postgres, backend, and frontend as separate containers. Not currently run anywhere. Copy `.env.example` to `.env` and adjust before running `docker compose up`.
