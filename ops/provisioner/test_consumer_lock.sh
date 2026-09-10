#!/usr/bin/env bash
set -euo pipefail
src=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export PROVISIONER_STATE_DIR="$tmp/state"
mkdir -p "$PROVISIONER_STATE_DIR" "$tmp/bin"
export CALLS="$tmp/calls"
export PATH="$tmp/bin:$PATH"
cat > "$tmp/bin/python3" <<'STUB'
#!/bin/bash
echo "$*" >> "$CALLS"
exit 99
STUB
chmod +x "$tmp/bin/python3"
fixture() {
  mkdir -p "$tmp/repo/ops"
  cp -r "$src/ops/provisioner" "$tmp/repo/ops/"
  cp -r "$src/ops/watchdog" "$tmp/repo/ops/"
  repo="$tmp/repo"
}
repository() {
  fixture
  mkdir -p "$repo/ops/provisioner/.venv/bin"
  cat > "$repo/ops/provisioner/.venv/bin/python" <<'STUB'
#!/bin/bash
[[ ! -f "$(dirname "$0")/../../../.."/bad ]]
STUB
  chmod +x "$repo/ops/provisioner/.venv/bin/python"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm old
  old=$(git -C "$repo" rev-parse HEAD)
  echo new > "$repo/version"
  [[ "$1" != bad ]] || touch "$repo/bad"
  git -C "$repo" add .
  git -C "$repo" commit -qm new
  new=$(git -C "$repo" rev-parse HEAD)
  git -C "$repo" checkout -q "$old"
}
case "${1:?case}" in
maintenance)
  fixture
  touch "$PROVISIONER_STATE_DIR/.maintenance"
  for script in provisioner/backup-all.sh provisioner/purge-all.sh provisioner/offsite-sync.sh watchdog/run.sh provisioner/run-worker.sh; do
    output=$(bash "$repo/ops/$script")
    [[ "$output" == *'SKIP maintenance '* ]]
  done
  [[ ! -e "$CALLS" ]]
  ;;
shared_drain)
  repository good
  for n in 1 2; do
    bash -c '. "$1"; consumer_lock "test-$2" 2; date +%s%N > "$3/start-$2"; sleep 2; date +%s%N > "$3/end-$2"' _ "$repo/ops/provisioner/consumer-lock.sh" "$n" "$tmp" &
  done
  for i in {1..100}; do
    [[ ! -e "$tmp/start-1" || ! -e "$tmp/start-2" ]] || break
    sleep .02
  done
  [[ -f "$tmp/start-1" && -f "$tmp/start-2" ]]
  date +%s%N > "$tmp/release-start"
  bash "$repo/ops/provisioner/release.sh" "$new" > "$tmp/release.log" 2>&1 &
  release_pid=$!
  sleep .2
  [[ "$(git -C "$repo" rev-parse HEAD)" == "$old" ]]
  [[ -e "$PROVISIONER_STATE_DIR/.maintenance" ]]
  wait "$release_pid"
  date +%s%N > "$tmp/release-end"
  wait
  [[ "$(git -C "$repo" rev-parse HEAD)" == "$new" ]]
  [[ ! -e "$PROVISIONER_STATE_DIR/.maintenance" ]]
  for n in 1 2; do
    (( $(cat "$tmp/start-$n") < $(cat "$tmp/release-start") ))
    (( $(cat "$tmp/end-$n") < $(cat "$tmp/release-end") ))
    printf 'consumer-%s start=%s end=%s\n' "$n" "$(cat "$tmp/start-$n")" "$(cat "$tmp/end-$n")"
  done
  cat "$tmp/release.log"
  printf 'release start=%s end=%s\n' "$(cat "$tmp/release-start")" "$(cat "$tmp/release-end")"
  ;;
rollback)
  repository bad
  status=0
  bash "$repo/ops/provisioner/release.sh" "$new" || status=$?
  [[ "$status" == 1 ]]
  [[ "$(git -C "$repo" rev-parse HEAD)" == "$old" ]]
  [[ ! -e "$PROVISIONER_STATE_DIR/.maintenance" ]]
  ;;
nightly)
  fixture
  mkdir -p "$PROVISIONER_STATE_DIR/example"
  touch "$PROVISIONER_STATE_DIR/example/"{.initialized,docker-compose.yml}
  printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "$CALLS"\n' > "$repo/ops/provisioner/backup.sh"
  chmod +x "$repo/ops/provisioner/backup.sh"
  echo MAX_TENANTS=15 > "$repo/ops/provisioner/limits.env"
  bash "$repo/ops/provisioner/backup-all.sh"
  [[ "$(cat "$CALLS")" == example ]]
  : > "$CALLS"
  echo NIGHTLY_HOT=1 >> "$repo/ops/provisioner/limits.env"
  bash "$repo/ops/provisioner/backup-all.sh"
  [[ "$(cat "$CALLS")" == 'example --nightly' ]]
  ;;
*) exit 2;;
esac
