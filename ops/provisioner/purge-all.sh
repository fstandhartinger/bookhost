#!/usr/bin/env bash
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
result=0
for tenant in /home/flori/ventures2/bookstack/tenants/*; do
  [[ "$(basename "$tenant")" != restore* ]] || continue
  [[ -f "$tenant/docker-compose.yml" ]] || continue
  python3 "$here/tenant.py" retention "$(basename "$tenant")" || result=1
  [[ -f "$tenant/.destroy_requested_at" ]] || continue
  "$here/purge.sh" "$(basename "$tenant")" || result=1
done
exit "$result"
