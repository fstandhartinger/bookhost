#!/usr/bin/env bash
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
result=0
for tenant in /home/flori/ventures2/bookstack/tenants/*; do
  [[ "$(basename "$tenant")" != restore* ]] || continue
  [[ -f "$tenant/.initialized" && -f "$tenant/docker-compose.yml" ]] || continue
  "$here/backup.sh" "$(basename "$tenant")" --nightly 2>&1 | while IFS= read -r line; do
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$line"
  done || result=1
done
exit "$result"
