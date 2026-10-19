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
