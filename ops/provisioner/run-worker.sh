#!/usr/bin/env bash
set -euo pipefail
umask 077
here=$(dirname "$(readlink -f "$0")")
. "$here/consumer-lock.sh"
consumer_lock run-worker 5
exec flock -n "$PROVISIONER_STATE_DIR/.worker.lock" "$here/.venv/bin/python" "$here/worker.py" "${@---cron}"
