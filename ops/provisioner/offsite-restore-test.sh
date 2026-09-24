#!/usr/bin/env bash
set -euo pipefail
umask 077
here=$(dirname "$(readlink -f "$0")")
export PATH=/usr/local/bin:/usr/bin:/bin
if [[ ! -x "$here/.venv/bin/python" ]]; then
  echo "offsite: provisioner venv missing (expected $here/.venv/bin/python; see ops/provisioner/README.md)" >&2
  exit 1
fi
exec "$here/.venv/bin/python" "$here/offsite.py" restore "$@"
