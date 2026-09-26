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
#
# The image must ship the pgvector extension: migration 035 creates the
# `vector` type for wiki retrieval, so a plain postgres image aborts the
# migration chain and the whole suite never runs.
set -euo pipefail
cd "$(dirname "$0")/.."

JOB_PREFIX=bookhost-live-edit-20260926-testdb
NAME="${TESTDB_NAME:-${JOB_PREFIX}-${BASHPID}}"
VOLUME="${NAME}-data"
PORT="${TESTDB_PORT:-$((55439 + BASHPID % 1000))}"
URL="postgres://postgres:testpw@127.0.0.1:${PORT}/bookhost_test"

container_created=0
volume_created=0

confirm_qa_targets() {
  printf 'Exact Docker QA targets: container=%s volume=%s\n' "$NAME" "$VOLUME"
  case "$NAME" in
    "${JOB_PREFIX}-"*) ;;
    *) echo "Refusing Docker cleanup: container name is outside this job's unique QA prefix" >&2; return 1 ;;
  esac
  [ "$VOLUME" = "${NAME}-data" ] || {
    echo "Refusing Docker cleanup: volume name does not belong to the exact QA container" >&2
    return 1
  }
  echo "Confirmed: the target list contains only this run's uniquely named QA resources."
}

cleanup() {
  [ "$container_created" = 1 ] || [ "$volume_created" = 1 ] || return 0
  confirm_qa_targets || return 1
  if [ "$container_created" = 1 ] && sudo docker inspect "$NAME" >/dev/null 2>&1; then
    sudo docker rm -f "$NAME" >/dev/null
  fi
  if [ "$volume_created" = 1 ] && sudo docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    sudo docker volume rm "$VOLUME" >/dev/null
  fi
}
trap cleanup EXIT

case "$NAME" in
  "${JOB_PREFIX}-"*) ;;
  *) echo "TESTDB_NAME must use the unique prefix ${JOB_PREFIX}-" >&2; exit 1 ;;
esac
if sudo docker inspect "$NAME" >/dev/null 2>&1 || sudo docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  echo "Refusing to reuse an existing QA container or volume name: $NAME" >&2
  exit 1
fi
confirm_qa_targets

volume_created=1
container_created=1
sudo docker run -d --name "$NAME" \
  -v "$VOLUME:/var/lib/postgresql/data" \
  -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=bookhost_test \
  -p "127.0.0.1:${PORT}:5432" pgvector/pgvector:pg16 >/dev/null

# pg_isready inside the container reports ready while initdb is still running
# its temporary server, which then restarts and drops the connection. Wait for a
# real client connection from here instead.
ready=0
for _ in $(seq 1 45); do
  if PGPASSWORD=testpw psql -q -h 127.0.0.1 -p "$PORT" -U postgres -d bookhost_test -c 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "Datenbank nimmt keine Verbindungen an"; exit 1; }

# The production TLS variables must not leak into a plain local connection.
export DATABASE_URL="$URL"
unset DATABASE_SSL_CA_BASE64 PGSSLROOTCERT DATABASE_URL_LOCAL || true
node scripts/migrate.mjs >/dev/null

INTAKE_DB_TEST=1 NOTIFICATIONS_DB_TEST=1 ACTIVATION_DB_TEST=1 QUOTA_DB_TEST=1 \
  npx vitest run --maxWorkers=1 "$@"
