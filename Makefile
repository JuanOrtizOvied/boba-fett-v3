.PHONY: install dev dev-web dev-backend dev-graph dev-api build lint

install:
	yarn install
	cd apps/backend && pip install -e ".[dev]"

dev:
	yarn dev

dev-web:
	yarn dev:web

dev-backend:
	yarn dev:backend

dev-graph:
	yarn dev:graph

dev-api:
	yarn dev:api

build:
	yarn build

lint:
	yarn lint
