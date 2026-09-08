#!/usr/bin/env bash
set -euo pipefail
umask 077
here=$(dirname "$(readlink -f "$0")")
mkdir -p /home/flori/ventures2/bookstack/tenants
exec flock -n /home/flori/ventures2/bookstack/tenants/.worker.lock "$here/.venv/bin/python" "$here/worker.py" "${@---cron}"
