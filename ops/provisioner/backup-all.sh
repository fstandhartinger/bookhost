#!/usr/bin/env bash
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
. "$here/consumer-lock.sh"
consumer_lock backup-all 300
NIGHTLY_HOT=0
. "$here/limits.env"
backup_args=()
[[ "$NIGHTLY_HOT" != 1 ]] || backup_args=(--nightly)
result=0
for tenant in "$PROVISIONER_STATE_DIR"/*; do
  [[ "$(basename "$tenant")" != restore* ]] || continue
  [[ -f "$tenant/.initialized" && -f "$tenant/docker-compose.yml" ]] || continue
  "$here/backup.sh" "$(basename "$tenant")" "${backup_args[@]}" 2>&1 | while IFS= read -r line; do
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$line"
  done || result=1
done
exit "$result"
