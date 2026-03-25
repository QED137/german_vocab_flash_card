SHELL := /bin/bash

.PHONY: up down rebuild logs ps

up:
	@echo "Starting containers (build enabled)..."
	@docker compose up --build -d
	@echo ""
	@echo "Frontend is running at: http://localhost:5173"
	@echo "Backend API is running at: http://localhost:8000"
	@echo "Backend API docs: http://localhost:8000/docs"

down:
	@echo "Stopping and removing containers..."
	@docker compose down
	@echo ""
	@echo "Stopped services: frontend (5173), backend (8000)"

rebuild:
	@echo "Rebuilding images and recreating containers..."
	@docker compose up --build --force-recreate -d
	@echo ""
	@echo "Rebuilt and running with latest code."
	@echo "Frontend is running at: http://localhost:5173"
	@echo "Backend API is running at: http://localhost:8000"
	@echo "Backend API docs: http://localhost:8000/docs"

logs:
	@docker compose logs -f

ps:
	@docker compose ps
