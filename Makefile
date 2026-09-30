.DEFAULT_GOAL := help
.PHONY: help install dev-backend dev-frontend lint format typecheck test test-backend test-frontend build migrate migration check

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install backend and frontend dependencies
	cd backend && uv sync
	cd frontend && npm ci

dev-backend: ## Run the API on :8000 with reload
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend: ## Run the Next.js dev server on :3000
	cd frontend && npm run dev

lint: ## Run every pre-commit hook on all files
	uv run --project backend pre-commit run --all-files

format: ## Auto-format backend and frontend
	cd backend && uv run ruff check --fix . && uv run ruff format .
	cd frontend && npm run format

typecheck: ## Type-check backend (mypy) and frontend (tsc)
	cd backend && uv run mypy .
	cd frontend && npm run typecheck

test-backend: ## Run backend tests with coverage
	cd backend && uv run pytest --cov

test-frontend: ## Run frontend tests
	cd frontend && npm test

test: test-backend test-frontend ## Run all tests

build: ## Production build of the frontend
	cd frontend && npm run build

migrate: ## Apply database migrations
	cd backend && uv run alembic upgrade head

migration: ## Create a migration from model changes: make migration m="add responders"
	cd backend && uv run alembic revision --autogenerate -m "$(m)"

check: lint typecheck test build ## Everything CI runs, locally
