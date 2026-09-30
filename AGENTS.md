# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Copilot) working in this repository.

## Project Overview

Anonymous peer-support platform for UNC's Peer2Peer (CS+SG project): a public, mobile-first site plus a responder portal for live conversations. **Anonymity is the core requirement**: never log, expose, or store texter-identifying data (phone numbers, IPs, names) outside the explicitly protected escalation path, and never put message content in analytics.

## Tech Stack

- **Backend** (`backend/`): Python 3.14, FastAPI, SQLAlchemy 2.1, Alembic, psycopg 3, PostgreSQL 18, managed with `uv`
- **Frontend** (`frontend/`): Node.js 24 LTS, Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, Vitest
- **Dev environment**: VS Code Dev Container (`.devcontainer/`) with a Postgres service at host `db`

## Common Commands

Run `make help` from the repo root. The most used:

```bash
make dev-backend     # FastAPI on :8000 (docs at /docs)
make dev-frontend    # Next.js on :3000
make test            # backend + frontend tests
make lint            # all pre-commit hooks on all files
make typecheck       # mypy + tsc
make check           # everything CI runs
make migration m="describe change"   # autogenerate an Alembic migration
make migrate         # apply migrations
```

Single tests: `cd backend && uv run pytest tests/test_health.py::test_name`, `cd frontend && npx vitest run src/app/page.test.tsx`.

## Conventions

- Backend: routers in `app/routers/`, models in `app/models/` (inherit `app.database.Base`), Pydantic schemas in `app/schemas/`. DB sessions come from `Depends(get_db)`. Every model change needs an Alembic migration; CI runs `alembic check`.
- Backend tests run against the `peer2peer_test` database; each test is wrapped in a rolled-back transaction (`tests/conftest.py`).
- Frontend: pages in `src/app/`, shared components in `src/components/`, import alias `@/` → `src/`. Tests are colocated as `*.test.tsx`.
- Formatting is enforced by Ruff (Python) and Prettier (frontend); don't hand-format.
- Add dependencies with `uv add` / `npm install` so lockfiles stay in sync.

## Workflow

- Branch off `main` as `<issue#>/<short-description>`; `main` only changes through PRs (see `CONTRIBUTING.md`).
- PRs follow `.github/pull_request_template.md` and link an issue with `Closes #XX`.
