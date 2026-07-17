# =============================================================================
# Wizer Signage — Infrastructure Makefile
# =============================================================================
# Convenience wrapper around docker compose. Run targets from the repo root:
#
#     make -C infra up
#     make -C infra dev-up
#
# Windows note: GNU Make is not installed by default. Either use Git Bash/WSL
# with `make`, or run the underlying `docker compose ...` commands directly
# (each target below echoes/uses the same command).
# =============================================================================

# Resolve paths relative to this Makefile so targets work from any CWD.
INFRA_DIR    := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
ROOT_DIR     := $(INFRA_DIR)..
COMPOSE_FILE := $(INFRA_DIR)docker/docker-compose.yml
DEV_FILE     := $(INFRA_DIR)docker/docker-compose.dev.yml

# --env-file is REQUIRED: Compose v2 resolves ${VAR} interpolation from the
# PROJECT directory (infra/docker/), not the CWD, so a repo-root .env would
# otherwise be ignored for interpolation (e.g. nginx APP_DOMAIN).
ENV_FILE     := $(ROOT_DIR)/.env
COMPOSE      := docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE)
COMPOSE_DEV  := docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) -f $(DEV_FILE)

# Health check target used by the `health` helper.
HEALTH_URL   ?= http://localhost/api/health

.DEFAULT_GOAL := help

.PHONY: help up down dev-up dev-down build rebuild restart ps logs health backup restore

## help: Show this help.
help:
	@echo "Wizer Signage infra targets:"
	@echo "  up        Start the production stack (detached)."
	@echo "  down      Stop and remove the production stack."
	@echo "  dev-up    Start the stack with the dev override (local postgres)."
	@echo "  dev-down  Stop the dev stack."
	@echo "  build     Build all service images."
	@echo "  rebuild   Build images without cache."
	@echo "  restart   Restart all services."
	@echo "  ps        List running services."
	@echo "  logs      Tail logs for all services."
	@echo "  health    Curl the API health endpoint."
	@echo "  backup    Run scripts/backup-db.sh (pg_dump the database)."
	@echo "  restore   Run scripts/restore-db.sh (requires DUMP=path)."

## up: Start the production stack (detached).
up:
	$(COMPOSE) up -d

## down: Stop and remove the production stack.
down:
	$(COMPOSE) down

## dev-up: Start the stack with the dev override (adds local postgres).
dev-up:
	$(COMPOSE_DEV) up -d

## dev-down: Stop and remove the dev stack.
dev-down:
	$(COMPOSE_DEV) down

## build: Build all service images.
build:
	$(COMPOSE) build

## rebuild: Build all service images without using the cache.
rebuild:
	$(COMPOSE) build --no-cache

## restart: Restart all services.
restart:
	$(COMPOSE) restart

## ps: List running services.
ps:
	$(COMPOSE) ps

## logs: Tail logs for all services.
logs:
	$(COMPOSE) logs -f

## health: Curl the API health endpoint.
health:
	@echo "GET $(HEALTH_URL)"
	@curl -fsS $(HEALTH_URL) && echo "" || (echo "Health check FAILED"; exit 1)

## backup: Run the database backup script.
backup:
	bash $(ROOT_DIR)/scripts/backup-db.sh

## restore: Restore a dump. Usage: make -C infra restore DUMP=backups/dump.sql.gz
restore:
	bash $(ROOT_DIR)/scripts/restore-db.sh $(DUMP)
