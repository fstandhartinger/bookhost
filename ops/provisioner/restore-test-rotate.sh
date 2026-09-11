#!/usr/bin/env bash
# Restore-test one tenant per run, oldest first.
#
# restore-test.sh has existed for a while but nothing ever scheduled it, so the
# only restores we could point at were the ones someone ran by hand. A backup
# nobody restores is a guess. This picks the tenant whose last restore test is
# oldest — or that was never tested — and tests that one, so every tenant comes
# round in turn without ever running more than one restore at a time.
#
# Log: tenants/restore-test.log, next to backup.log, one line per run:
#   <ISO time> <slug> OK|FAIL
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
. "$here/consumer-lock.sh"
consumer_lock restore-test-rotate 1800
. "$here/limits.env"

log="$PROVISIONER_STATE_DIR/restore-test.log"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Oldest tested first; a tenant with no line at all sorts ahead of every date.
oldest=""
oldest_seen=""
for tenant in "$PROVISIONER_STATE_DIR"/*; do
  slug=$(basename "$tenant")
  [[ "$slug" != restore* ]] || continue
  [[ -f "$tenant/.initialized" && -f "$tenant/docker-compose.yml" ]] || continue
  seen=""
  [[ ! -f "$log" ]] || seen=$(awk -v s="$slug" '$2==s {t=$1} END {print t}' "$log")
  if [[ -z "$oldest" || -z "$seen" || ( -n "$oldest_seen" && "$seen" < "$oldest_seen" ) ]]; then
    # A never-tested tenant wins outright; do not let a later one displace it.
    [[ -n "$oldest" && -z "$oldest_seen" ]] && continue
    oldest="$slug"
    oldest_seen="$seen"
  fi
done

if [[ -z "$oldest" ]]; then
  printf '%s keine Kandidaten\n' "$(stamp)"
  exit 0
fi

printf '%s restore-test %s (zuletzt: %s)\n' "$(stamp)" "$oldest" "${oldest_seen:-nie}"
if "$here/restore-test.sh" "$oldest" 2>&1 | while IFS= read -r line; do printf '%s %s\n' "$(stamp)" "$line"; done; then
  printf '%s %s OK\n' "$(stamp)" "$oldest" >> "$log"
else
  status=$?
  printf '%s %s FAIL\n' "$(stamp)" "$oldest" >> "$log"
  exit "$status"
fi
