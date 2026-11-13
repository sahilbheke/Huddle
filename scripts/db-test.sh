#!/usr/bin/env bash
# Runs the migration and rules tests against a throwaway local Postgres.
set -euo pipefail
DB=huddle_test
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB" postgres
psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase/tests/local_stub.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d $DB -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase/tests/grants_local.sql
psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase/tests/rules_test.sql
