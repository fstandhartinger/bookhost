#!/usr/bin/env bash
set -euo pipefail
umask 077
# Parse the entire driver before checkout can replace this file.
release_main() {
  [[ $# == 1 ]] || { echo "Usage: $0 <git-ref>" >&2; return 1; }
  local here checkout target previous started release_fd
  here=$(dirname "$(readlink -f "$0")")
  checkout=$(git -C "$here" rev-parse --show-toplevel)
  export PROVISIONER_STATE_DIR=${PROVISIONER_STATE_DIR:-/home/flori/ventures2/bookstack/tenants}
  mkdir -p "$PROVISIONER_STATE_DIR"
  started=$(date +%s)
  # Never remove a marker owned by a different maintenance operator.
  if ! (set -o noclobber; : > "$PROVISIONER_STATE_DIR/.maintenance") 2>/dev/null; then
    echo 'Maintenance already active' >&2
    return 1
  fi
  trap 'rm -f "$PROVISIONER_STATE_DIR/.maintenance"' EXIT
  trap 'exit 1' HUP INT TERM
  exec {release_fd}>"$PROVISIONER_STATE_DIR/.provisioner.lock"
  if ! flock -x -w "${PROVISIONER_RELEASE_WAIT:-600}" "$release_fd"; then
    echo 'Release drain timed out' >&2
    return 1
  fi
  previous=$(git -C "$checkout" rev-parse HEAD)
  echo "Release before=$previous started=$started drained=$(date +%s%N)"
  [[ -z "$(git -C "$checkout" status --porcelain)" ]] || { echo 'Dirty checkout' >&2; return 1; }
  target=$(git -C "$checkout" rev-parse --verify --end-of-options "$1^{commit}") || return 1
  git -C "$checkout" merge-base --is-ancestor "$previous" "$target" || { echo 'Not a fast-forward' >&2; return 1; }
  # Roll back on errors and catchable signals after a checkout was attempted.
  trap 'git -C "$checkout" checkout --detach "$previous"; exit 1' HUP INT TERM
  if git -C "$checkout" checkout --detach "$target" && release_selftest "$checkout"; then
    echo "Release before=$previous after=$(git -C "$checkout" rev-parse HEAD) duration=$(( $(date +%s) - started ))s"
  else
    git -C "$checkout" checkout --detach "$previous"
    echo "Release FAILED before=$previous after=$(git -C "$checkout" rev-parse HEAD) duration=$(( $(date +%s) - started ))s" >&2
    return 1
  fi
}
release_selftest() {
  local checkout=$1 python="$1/ops/provisioner/.venv/bin/python"
  [[ -x "$python" ]] || return 1
  # compile() checks every module without writing bytecode to the checkout.
  "$python" -c 'import pathlib,sys; [compile(p.read_bytes(), str(p), "exec") for d in sys.argv[1:] for p in pathlib.Path(d).rglob("*.py") if ".venv" not in p.parts]' "$checkout/ops/provisioner" "$checkout/ops/watchdog" &&
  "$python" -m pip check &&
  (cd "$checkout" && "$python" -m unittest discover -s ops/provisioner -p 'test_*.py') &&
  (cd "$checkout" && "$python" -m unittest discover -s ops/watchdog -p 'test_*.py')
}
release_main "$@"
