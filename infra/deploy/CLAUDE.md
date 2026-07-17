# CLAUDE.md — infra/deploy

Bare-metal (no Docker) install/deploy scripts for **garden-planner-dev** — the development machine (Debian 13/trixie LXC, `192.168.0.26`, SSH host alias `garden-planner-dev`, user `deploy`). There is no separate test box yet; this pipeline runs against the dev machine as a stand-in until one exists. Postgres 17 is already installed and running directly on that box — these scripts don't install or manage it beyond creating a role/database.

**Claude has SSH access to garden-planner-dev as `deploy` (key-based, no interactive password).** Verified via `sudo -n -l`: `deploy` has full sudo rights (`(ALL : ALL) ALL`), password-gated by default. `garden-deploy.sudoers` (in this directory) is a scoped NOPASSWD drop-in covering exactly what `02-setup-database.sh`, `03-deploy-backend.sh`, and `04-deploy-frontend.sh` run — see the file itself for the exact rules and install instructions. **`01-install-packages.sh` (apt/apt-get, and the `install -d` that creates `$APP_DIR`) is deliberately excluded** — OS package installation stays human-only, password-gated, per explicit instruction.

Whether Claude can currently run 02/03/04 unattended depends on whether `garden-deploy.sudoers` has actually been installed on the box yet (`ls /etc/sudoers.d/garden-deploy` — if absent, only `sudo systemctl restart garden-backend` is passwordless, confirmed via `sudo -n apt-get update` → `sudo: a password is required` vs. `sudo -n systemctl restart garden-backend` succeeding). Don't assume the wider grant is live without checking; if it isn't installed, `01-install-packages.sh` and any first-time `02`/`03`/`04` run still need the user to run them interactively.

**Verified environment facts** (checked live over SSH, not assumed): Debian 13 (trixie), `x86_64`. System `python3` is 3.13.5 — already satisfies `pyproject.toml`'s `>=3.12`, no special Python provisioning needed. `nodejs` (20.19.2) and `npm` (9.2.0) are both available directly from Debian's own apt repo — no NodeSource repo needed (that was a bookworm-only workaround from an earlier, incorrect Debian-12 assumption; trixie's default is already new enough for `vite@8`, which needs Node 20+). `uv` is *not* in Debian's apt repos on trixie either, so it's still installed via the official installer script. PostgreSQL 17 is already installed and its `main` cluster is online on port 5432.

## Files

- `config.sh` — single source of truth for every setting (`APP_DIR`, `REPO_URL`, `BRANCH`, ports, DB credentials, hostnames). Sourced by every numbered script. Edit values here, not in the scripts themselves.
- `garden-deploy.sudoers` — sudoers drop-in granting `deploy` passwordless sudo for exactly what 02/03/04 need. Not installed automatically; see the file for install steps. `01-install-packages.sh` is intentionally out of scope.
- `01-install-packages.sh` — one-time: apt packages (git, nginx, curl, nodejs, npm — all available directly from Debian 13's repos), installs `uv` (not packaged for Debian), creates `$APP_DIR`.
- `02-setup-database.sh` — one-time: creates the Postgres role + database on garden-planner-dev's existing Postgres. Idempotent.
- `03-deploy-backend.sh` — clone/pull, `uv sync`, `alembic upgrade head`, installs/restarts the `garden-backend` systemd unit.
- `04-deploy-frontend.sh` — `npm ci && npm run build`, installs the nginx site.
- `deploy.sh` — re-runs 03+04 for redeploys (assumes 01+02 already ran once).
- `garden-backend.service.template`, `nginx-garden.conf.template` — filled in via `sed` (see below), not run directly.

## Template placeholder convention

`.template` files use `__UPPER_SNAKE__` tokens. Each is substituted by a `sed -e "s#__TOKEN__#$VALUE#g"` line in whichever numbered script installs that template (03 for the systemd unit, 04 for the nginx site). **If you add a placeholder to a template, add the matching `sed` line too** — nothing checks this for you, and a leftover `__TOKEN__` in the installed file fails silently until someone reads the config.

## LAN-reachability gotcha (don't re-merge these)

`config.sh` deliberately has two separate backend host vars — collapsing them back into one was the original bug:
- `BACKEND_HOST` (`127.0.0.1`) — what nginx's `proxy_pass` and the scripts' own health-check `curl`s *connect to*. Must stay loopback; these run co-located with the backend on the same host.
- `BACKEND_BIND_HOST` (`0.0.0.0`) — what uvicorn's `--host` flag *binds to*. Needs to be `0.0.0.0` for the API (and `/docs`) to be reachable from other LAN devices on `BACKEND_PORT` directly, not just through nginx on `FRONTEND_PORT`.

`0.0.0.0` is a bind-only address — never use `BACKEND_BIND_HOST` as a connect target (`curl`, `proxy_pass`, etc.), only as the `--host` argument.

## Other things worth knowing

- Scripts must stay LF-only (enforced by the root `.gitattributes` — `*.sh` / `*.template` → `eol=lf`) and executable (`100755` in git). This repo is developed on Windows; if you add a new `.sh` file here, run `git update-index --chmod=+x <path>` after staging it, since the Windows working copy can't carry the exec bit itself.
- The Alembic migration run in step 03 was, as of the first deploy, unverified against any real Postgres (see the note in the root `CLAUDE.md`) — flag output from that step to the user rather than assuming success.
- `../docker-compose.yml` and `../.env.example` are a containerized-deployment *reference only*, sketched for a possible future dedicated test box — nothing currently runs them.
- **Watch for root vs. `deploy` confusion.** Everything here (`SERVICE_USER=$(whoami)`, `garden-deploy.sudoers`, ownership of `$APP_DIR`) assumes the numbered scripts run as `deploy`. If someone runs them as `root` instead (e.g. via `sudo -i`), `uv`/anything installed by `01` ends up in `/root/.local/bin` instead of `deploy`'s home, `$APP_DIR` ends up root-owned, and the systemd unit ends up running the backend `User=root`. This has actually happened once already — check `whoami` and `ls -ld $APP_DIR` before assuming which identity a given deploy ran under, rather than assuming it was `deploy`.
- `03-deploy-backend.sh` exports `PATH="$HOME/.local/bin:$PATH"` itself before calling `uv`, specifically because `01-install-packages.sh` only updates `.profile`/`.bashrc`, which a shell picks up on next login — not the same session it just installed in. If you see `uv: command not found` from `03`/`deploy.sh` despite `01` having been run, that's almost always this (or step 1 having run as a different user than the one now running step 3, per the point above).
