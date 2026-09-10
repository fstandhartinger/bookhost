#!/usr/bin/env bash
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
. "$here/consumer-lock.sh"
consumer_lock purge-all 300
result=0
for tenant in "$PROVISIONER_STATE_DIR"/*; do
  [[ "$(basename "$tenant")" != restore* ]] || continue
  [[ -f "$tenant/docker-compose.yml" ]] || continue
  python3 "$here/tenant.py" retention "$(basename "$tenant")" || result=1
  [[ -f "$tenant/.destroy_requested_at" ]] || continue
  "$here/purge.sh" "$(basename "$tenant")" || result=1
done
exit "$result"
