#!/usr/bin/env bash
set -uo pipefail
here=$(dirname "$(readlink -f "$0")")
setsid --wait timeout --kill-after=20s 1100s python3 "$here/tenant.py" provision "$@"
result=$?
if (( result != 0 )); then
  python3 "$here/tenant.py" deprovision "$1" >/dev/null 2>&1 || true
fi
exit "$result"
