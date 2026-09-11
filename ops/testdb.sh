#!/usr/bin/env bash
# Run the whole test suite, including the database integration tests.
#
# Until today those 44 tests only ever ran against the production database, so
# in practice they did not run at all: cycle 105 corrected an assertion it could
# not execute, and quota-truth-db had been failing on any second run since the
# host uniqueness constraint landed. This starts a throwaway Postgres instead,
# applies the migrations and runs everything. The container is removed on exit.
#
# Usage: ops/testdb.sh [additional vitest arguments]
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=bookhost-testdb
PORT="${TESTDB_PORT:-55439}"
URL="postgres://postgres:testpw@127.0.0.1:${PORT}/bookhost_test"

cleanup() { sudo docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

sudo docker run -d --rm --name "$NAME" \
  -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=bookhost_test \
  -p "127.0.0.1:${PORT}:5432" postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  sudo docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
sudo docker exec "$NAME" pg_isready -U postgres >/dev/null || { echo "Datenbank startet nicht"; exit 1; }

# The production TLS variables must not leak into a plain local connection.
export DATABASE_URL="$URL"
unset DATABASE_SSL_CA_BASE64 PGSSLROOTCERT DATABASE_URL_LOCAL || true
node scripts/migrate.mjs >/dev/null

INTAKE_DB_TEST=1 NOTIFICATIONS_DB_TEST=1 ACTIVATION_DB_TEST=1 QUOTA_DB_TEST=1 \
  npx vitest run --maxWorkers=1 "$@"
