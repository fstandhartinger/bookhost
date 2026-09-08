#!/usr/bin/env bash
set -euo pipefail
# No shell tracing: credentials are passed via stdin, never argv or stdout.
here=$(dirname "$(readlink -f "$0")")
if [[ -x "$here/.venv/bin/python" ]]; then
  exec "$here/.venv/bin/python" "$here/bookstack_api_token.py" "$@"
fi
exec python3 "$here/bookstack_api_token.py" "$@"
