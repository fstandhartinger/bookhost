#!/usr/bin/env bash
# Source before loading code/configuration or starting any consumer work.
consumer_lock() {
  local name=$1 wait=${PROVISIONER_LOCK_WAIT:-$2}
  export PROVISIONER_STATE_DIR=${PROVISIONER_STATE_DIR:-/home/flori/ventures2/bookstack/tenants}
  mkdir -p "$PROVISIONER_STATE_DIR"
  if [[ -e "$PROVISIONER_STATE_DIR/.maintenance" ]]; then
    echo "SKIP maintenance $name"
    exit 0
  fi
  exec {provisioner_lock_fd}>"$PROVISIONER_STATE_DIR/.provisioner.lock"
  if [[ "$name" == run-worker ]]; then
    flock -s -n "$provisioner_lock_fd" || { echo "SKIP maintenance $name"; exit 0; }
  else
    flock -s -w "$wait" "$provisioner_lock_fd" || { echo "SKIP maintenance $name"; exit 0; }
  fi
  # Close the admission race with a release that started while we waited.
  if [[ -e "$PROVISIONER_STATE_DIR/.maintenance" ]]; then
    echo "SKIP maintenance $name"
    exit 0
  fi
  # Descriptor is inherited by exec/children and held until the consumer exits.
}
