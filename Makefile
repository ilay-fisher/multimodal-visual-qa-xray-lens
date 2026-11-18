.PHONY: setup samples test lint dev-backend dev-frontend up down bench

PY ?= python3
VENV ?= backend/.venv
BIN := $(VENV)/bin

setup:
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -r backend/requirements-dev.txt
	@if [ -f frontend/package.json ]; then cd frontend && npm ci; fi

samples:
	cd backend && ../$(BIN)/python scripts/generate_samples.py

test:
	cd backend && ../$(BIN)/python -m pytest -q
	@if [ -f frontend/package.json ]; then cd frontend && npm test; fi

lint:
	cd backend && ../$(BIN)/ruff check . && ../$(BIN)/ruff format --check . && ../$(BIN)/mypy app
	@if [ -f frontend/package.json ]; then cd frontend && npm run lint && npm run typecheck; fi

dev-backend:
	cd backend && ../$(BIN)/uvicorn app.main:app --reload --port 8080

dev-frontend:
	cd frontend && npm run dev

up:
	docker compose up --build

down:
	docker compose down

bench:
	cd backend && ../$(BIN)/python -m app.benchmark
