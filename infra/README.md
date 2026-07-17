# infra

`docker-compose.yml` mirrors the intended `garden-test` deployment: Postgres, backend, and frontend as separate containers. Copy `.env.example` to `.env` and adjust before running `docker compose up`.

Intended Proxmox layout (per CLAUDE.md, not provisioned by anything in this repo):

- `garden-dev` — Debian 12 LXC running Postgres + backend/frontend dev servers directly (no containers), for day-to-day development.
- `garden-test` — Debian 12 LXC running this Docker Compose stack, mirroring the intended production deployment shape.
