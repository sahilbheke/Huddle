# Huddle — local development shortcuts.
# Run `make` or `make help` to list the targets.
#
# Services:
#   app       Expo dev server (Metro) for the React Native app
#   supabase  Local Supabase stack (Postgres, Auth, Realtime, Storage, Studio) via Docker
#   functions Edge functions (notify, send-reminders) served by the Supabase CLI

SHELL := /bin/bash

# Use a globally installed Supabase CLI if there is one, otherwise run it through npx.
SUPABASE ?= $(shell command -v supabase >/dev/null 2>&1 && echo supabase || echo npx --yes supabase)
EXPO     ?= npx expo

# Address the phone uses to reach local Supabase. 127.0.0.1 only works for simulators
# and web, so default to this machine's LAN IP. Override with `make env-local HOST=...`.
HOST ?= $(shell ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $$1}' || echo 127.0.0.1)

.DEFAULT_GOAL := help
.PHONY: help install env env-local \
        dev dev-local app android ios web \
        supabase-start supabase-stop supabase-status studio functions \
        db-reset db-push db-test \
        lint typecheck check stop clean

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## ---- Setup -----------------------------------------------------------------

install: ## Install npm dependencies
	npm install

env: ## Create .env from .env.example (hosted Supabase); does not overwrite
	@if [ -f .env ]; then echo ".env already exists, leaving it alone"; \
	else cp .env.example .env && echo "Created .env, now fill in your Supabase URL and publishable key"; fi

env-local: ## Write .env.local pointing the app at the local Supabase stack
	@out="$$($(SUPABASE) status -o env 2>/dev/null)"; \
	url=$$(echo "$$out" | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$$/\1/p'); \
	key=$$(echo "$$out" | sed -n 's/^PUBLISHABLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$$/\1/p'); \
	[ -n "$$key" ] || key=$$(echo "$$out" | sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$$/\1/p'); \
	[ -n "$$url" ] && [ -n "$$key" ] || { echo "Local Supabase is not running. Run: make supabase-start"; exit 1; }; \
	url=$$(echo "$$url" | sed -e 's/127\.0\.0\.1/$(HOST)/' -e 's/localhost/$(HOST)/'); \
	printf 'EXPO_PUBLIC_SUPABASE_URL=%s\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\n' "$$url" "$$key" > .env.local; \
	echo "Wrote .env.local ($$url). It overrides .env; delete it to go back to hosted Supabase."

## ---- Run -------------------------------------------------------------------

dev: app ## Start the app against the Supabase project in .env (hosted)

dev-local: supabase-start env-local ## Start local Supabase, point the app at it, start the app
	$(EXPO) start

app: ## Start the Expo dev server
	$(EXPO) start

android: ## Start the Expo dev server and open Android
	$(EXPO) start --android

ios: ## Start the Expo dev server and open the iOS simulator
	$(EXPO) start --ios

web: ## Start the Expo dev server for web
	$(EXPO) start --web

supabase-start: ## Start the local Supabase stack (needs Docker); applies migrations on first start
	$(SUPABASE) start

supabase-stop: ## Stop the local Supabase stack (keeps data)
	$(SUPABASE) stop

supabase-status: ## Show local Supabase URLs and keys
	$(SUPABASE) status

studio: ## Open local Supabase Studio
	@open http://127.0.0.1:54323 2>/dev/null || xdg-open http://127.0.0.1:54323 2>/dev/null || echo "Studio: http://127.0.0.1:54323"

functions: ## Serve the edge functions locally (notify, send-reminders)
	$(SUPABASE) functions serve

## ---- Database --------------------------------------------------------------

db-reset: ## Recreate the local database and re-run every migration
	$(SUPABASE) db reset

db-push: ## Apply new migrations to the linked hosted project (run `supabase link` first)
	$(SUPABASE) db push

db-test: ## Run schema + rules engine tests on a throwaway local Postgres (needs psql)
	npm run db:test

## ---- Checks ----------------------------------------------------------------

lint: ## Lint
	npx eslint .

typecheck: ## TypeScript type check
	npm run typecheck

check: typecheck lint ## Typecheck and lint

## ---- Stop / clean ----------------------------------------------------------

stop: supabase-stop ## Stop local services

clean: ## Stop local Supabase, delete its data, and remove Expo caches and .env.local
	-$(SUPABASE) stop --no-backup
	rm -rf .expo dist web-build node_modules/.cache .env.local
