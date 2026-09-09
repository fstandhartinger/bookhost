#!/usr/bin/env bash
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
exec python3 "$here/tenant.py" migrate-network "$@"
