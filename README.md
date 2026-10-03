# Peer2Peer

CS+SG project for [Peer2Peer](https://www.instagram.com/uncpeer2peer/), UNC's anonymous student peer-support line: a public website plus a responder portal.

| Layer    | Stack                                                    |
| -------- | -------------------------------------------------------- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Vitest |
| Backend  | Python 3.14, FastAPI, SQLAlchemy 2.1, Alembic, uv        |
| Database | PostgreSQL 18                                            |
| Dev env  | VS Code Dev Container (Docker)                           |

## Contributors

| Name        | Role            |
| ----------- | --------------- |
| Caleb Han   | Tech Lead       |
| Mason Mines | Project Manager |
| Yewon Song  | Developer       |
| Siyu Liu    | Developer       |
| Sechan Park | Developer       |

## Getting Started

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and the VS Code [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension.
2. Clone the repo and open it in VS Code.
3. Run **Dev Containers: Reopen in Container** from the command palette. The first build takes a few minutes. `post_create.sh` then:
   - creates `backend/.env` and `frontend/.env.local` from their `.env.example` files
   - installs dependencies (`uv sync`, `npm ci`)
   - runs database migrations
   - installs the pre-commit hooks
4. Start the app with the **Full Stack** launch config (Run and Debug panel), or in two terminals:

   ```bash
   make dev-backend    # http://localhost:8000/docs
   make dev-frontend   # http://localhost:3000
   ```

Run `make help` for every command.

### What's in the container

- **Terminal:** zsh with a Starship prompt, autosuggestions, syntax highlighting, and fzf history search (`Ctrl-R`)
- **CLI tools:** `git`, `gh`, `uv`, `node`/`npm`, `psql` 18, `doctl` (DigitalOcean), `claude`, `codex`, `rg`, `fd`, `bat`, `jq`, `make`
- **Shortcuts:** `be` / `fe` cd into backend/frontend, and `db` opens `psql` on the dev database

### Persistent state

These live in Docker volumes, so they survive **Rebuild Container**:

| Volume                    | What it keeps                                 |
| ------------------------- | --------------------------------------------- |
| `peer2peer_claude-config` | Claude Code login, settings, and chat history |
| `peer2peer_codex-config`  | Codex login, config, and chat history         |
| `peer2peer_gh-config`     | `gh auth login` credentials                   |
| `peer2peer_shell-history` | zsh history                                   |
| `peer2peer_postgres-data` | Dev database                                  |

To wipe the database, stop the container and run `docker volume rm peer2peer_postgres-data`.

### Database

Inside the container, Postgres is at `db:5432` (user `postgres`, password `postgres`). There are two databases:

- `peer2peer`: development
- `peer2peer_test`: used by the backend tests

Port 5432 is also forwarded, so host tools can reach Postgres at `localhost:5432`. In VS Code, open the PostgreSQL extension and add a connection with server `db`, user `postgres`, password `postgres`, and database `peer2peer`.

After changing models in `backend/app/models/`, generate and apply a migration:

```bash
make migration m="add responders table"
make migrate
```

## Code Quality

**Pre-commit hooks** run on every `git commit`, and only against the files you staged: Ruff for Python, Prettier and ESLint for the frontend, plus basic file hygiene. Most issues get fixed automatically; re-stage the fixed files and commit again.

**CI** (`.github/workflows/ci.yml`) runs on every PR and every push to `main`. It has three parallel jobs:

- **Lint & Format:** the same pre-commit hooks, run against all files
- **Backend:** mypy, a check that migrations apply cleanly and match the models, and pytest with coverage against Postgres 18
- **Frontend:** `tsc`, Vitest, and `next build`

To run everything CI runs before you push, use `make check`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch and PR workflow.
