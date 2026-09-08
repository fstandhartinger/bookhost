#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH=/usr/local/bin:/usr/bin:/bin
exec python3 "$(dirname "$(readlink -f "$0")")/offsite.py" restore "$@"
