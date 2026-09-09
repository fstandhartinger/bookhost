#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077
here=$(dirname "$(readlink -f "$0")")
exec bash -lc '
set +x
set -euo pipefail
set -a
source /home/flori/ventures2/.env
source /home/flori/ventures2/bookstack/work/.app.env
source /home/flori/ventures2/bookstack/work/.database-tls.env
set +a
exec python3 "$@"
' wissen-watchdog "$here/watchdog.py" "$@"
