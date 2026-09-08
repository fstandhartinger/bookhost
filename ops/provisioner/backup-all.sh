#!/usr/bin/env bash
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
result=0
for tenant in /home/flori/ventures2/bookstack/tenants/*; do
  [[ -f "$tenant/.initialized" && -f "$tenant/docker-compose.yml" ]] || continue
  "$here/backup.sh" "$(basename "$tenant")" || result=1
done
exit "$result"
