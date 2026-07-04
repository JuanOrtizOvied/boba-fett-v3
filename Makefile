.PHONY: install dev dev-web dev-backend build lint

install:
	yarn install

dev:
	yarn dev

dev-web:
	yarn dev:web

dev-backend:
	yarn dev:backend

build:
	yarn build

lint:
	yarn lint
