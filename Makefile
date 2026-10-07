COMPOSE_BUILD = docker compose -f compose.yaml -f compose.build.yaml

.PHONY: help up down logs dev

help:
	@echo "make up        run the published image"
	@echo "make dev       build from source and run"
	@echo "make down      stop the stack"
	@echo "make logs      follow logs"

up:
	docker compose up -d

dev:
	$(COMPOSE_BUILD) up --build -d

down:
	docker compose down

logs:
	docker logs -f pxls
