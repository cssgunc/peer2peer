#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="/workspace"

section() {
  echo ""
  echo "=============== $1 ==============="
}

section "Fixing volume ownership"
# Volumes created by an older image (or by root) would otherwise be unwritable.
sudo chown -R "$(id -u):$(id -g)" \
  "$HOME/.claude" "$HOME/.codex" "$HOME/.config/gh" /commandhistory

section "Creating env files"
for pair in "backend/.env.example:backend/.env" "frontend/.env.example:frontend/.env.local"; do
  src="$WORKSPACE_DIR/${pair%%:*}"
  dest="$WORKSPACE_DIR/${pair##*:}"
  if [ ! -f "$dest" ]; then
    cp "$src" "$dest"
    echo "Created ${pair##*:} from example"
  else
    echo "${pair##*:} already exists, leaving it alone"
  fi
done

section "Installing frontend dependencies"
cd "$WORKSPACE_DIR/frontend"
npm ci

section "Installing backend dependencies"
cd "$WORKSPACE_DIR/backend"
uv sync --locked

section "Running database migrations"
uv run alembic upgrade head

section "Installing pre-commit hooks"
cd "$WORKSPACE_DIR"
uv run --project backend pre-commit install --install-hooks

echo ""
echo "Setup complete. Run 'make help' to see common commands."
