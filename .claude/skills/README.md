# Skills

Project-level Claude Code skills for GardenBedPlanner. Each skill lives at `.claude/skills/<name>/SKILL.md`, with its underlying PowerShell script(s) (where it has one) alongside it at `.claude/skills/<name>/scripts/*.ps1` - the script does the actual work, the `SKILL.md` documents when/how to use it. Skills are how Claude should run these common tasks now, in preference to typing raw commands.

Each skill is invokable either explicitly (`/name`) or automatically, when a request semantically matches its `description` frontmatter field.

**Windows PowerShell only** - the `Bash` tool has no POSIX shell available in this environment ("No suitable shell found"); every script here is `.ps1`. **Always call a script by its absolute path**, never a relative path, and never with a `cd`/`Set-Location` first - each script resolves the repo root itself via `$PSScriptRoot` (now `..\..\..\..\<area>` from `.claude/skills/<name>/scripts/`, since scripts live 4 directories below the repo root), so the caller's cwd is irrelevant. A `cd`-prefixed compound command has a different literal signature every time depending on the directory it's chained from, so it can never be pre-approved - calling by fixed absolute path is what makes pre-approval possible at all.

## Build / lint

| Skill | Script(s) | Notes |
|---|---|---|
| `/build-frontend` | `frontend_lint.ps1`, `frontend_build.ps1` | oxlint + tsc typecheck + vite build |
| `/build-backend` | `backend_lint.ps1`, `backend_check_imports.ps1` | ruff + app-construction smoke check |
| `/build-data` | `data_lint.ps1` | ruff over `data/etl/` |

## Test

| Skill | Script(s) | Notes |
|---|---|---|
| `/test-backend` | `backend_test.ps1` | pytest - real, working |
| `/test-frontend` | (none yet) | stub - no frontend test framework configured yet |
| `/test-data` | `data_verify_garden.ps1` | fixture validation is real; unit tests are a stub |

See `../../docs/testing-plan.md` for the phased plan to close the frontend/data stubs and expand backend coverage - each of the three `test-*` skills above is meant to be updated directly from that plan as each phase lands.

## Deploy (garden-planner-dev - explicit-ask only, touches the real dev server)

| Skill | Script(s) | Notes |
|---|---|---|
| `/deploy-backend` | `dev_ssh_deploy_backend.ps1` | git pull, uv sync, alembic upgrade head, restart service |
| `/deploy-frontend` | `dev_ssh_deploy_frontend.ps1` | git pull + `04-deploy-frontend.sh` directly (04 doesn't pull on its own) |
| `/deploy-data` | `dev_ssh_import_data.ps1` | runs the real importers against the real Postgres |

## Local dev / iteration

| Skill | Script(s) | Notes |
|---|---|---|
| `/dev-server` | `backend_dev_start.ps1`, `backend_dev_stop.ps1`, `frontend_dev_start.ps1`, `frontend_dev_stop.ps1` | start/stop local dev servers |
| `/migrate-backend` | `backend_migrate.ps1` | apply migrations without a full deploy - e.g. against `garden_test` |
| `/generate-api` | `frontend_generate_api.ps1` | regenerate the typed frontend client from the backend's live OpenAPI schema |
| `/run-etl-module` | `data_run_module.ps1`, `data_run_script.ps1` | generic `etl.*` module invocation |
| `/render-schema` | `render_schema_er.ps1` | re-renders `docs/schema-er.png` from `docs/schema.md`'s mermaid diagram - `mmdc` settings locked into the script so nobody re-derives them |

## garden-planner-dev inspection

| Skill | Script(s) | Notes |
|---|---|---|
| `/health-check` | `dev_ssh_health.ps1` | read-only, safe anytime |
| `/db-query` | `dev_psql_test.ps1` (garden_test, direct), `dev_psql.ps1` (garden, SSH) | `garden_test` is disposable, connect and mutate freely; `garden` is real data, wrap anything destructive in `BEGIN`/`ROLLBACK` |

## Git / release

| Skill | Script(s) | Notes |
|---|---|---|
| `/git` | (raw `git`) | add/commit/push conventions; not branch/history rewriting |
| `/open-pr` | (raw `gh`) | opens a PR for the current branch against `main` |
| `/release` | `dev_ssh_deploy_all.ps1` (deploy step only) | build → test → commit/push → (explicit-ask) deploy, all three areas; chains the other skills above for everything except the combined backend+frontend deploy, which uses its own script directly |

## Backlog

| Skill | Script(s) | Notes |
|---|---|---|
| `/backlog` | (none - Read/Edit conventions on `product-owner/BACKLOG.md`) | pick a task, change status, re-assign, flag a dependency, split a multi-responsible item, list a role's tasks - see `.claude/agents/product-owner.md`'s "Tracking fields" section for the schema itself. `status: ready-to-start` and `status: verified` are both user-only, no exceptions - agents may never act on a `status: new` item. |

## Why each script lives inside its skill's folder

A script isn't shared across skills' folders - each one has exactly one owning skill, physically colocated (`.claude/skills/<name>/scripts/`), so a skill is self-contained: read its `SKILL.md`, its scripts are right there. When a skill's instructions need a *different* skill's capability (e.g. `/deploy-backend` confirming with a health check, or `/build-data` pointing at fixture validation), it references that other skill by `/name` rather than reaching into its scripts folder directly - keeps the logic in exactly one place and the reference to it a stable, renameable pointer.

When you need a new common task covered: add a script under the relevant skill's `scripts/` folder (or a new skill folder if it doesn't fit an existing one), reference it from that skill's `SKILL.md` by absolute path, and add its row to the table above in the same change.
