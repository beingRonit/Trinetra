.PHONY: help run worker lint-pipeline migrate

help:
	@echo "Usage: make <target>"
	@echo "  run          - Start API server"
	@echo "  worker      - Start Celery worker"
	@echo "  lint-pipeline - Run pipeline purity check"
	@echo "  migrate    - Run database migrations"

lint-pipeline:
	@bash scripts/lint_pipeline_purity.sh

run:
	@python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

worker:
	@python -m celery -A app.workers.tasks.celery_app worker --loglevel=info --concurrency=2

migrate:
	@psql $$DATABASE_URL -f migrations/001_init.sql
	@psql $$DATABASE_URL -f migrations/002_field_rename.sql