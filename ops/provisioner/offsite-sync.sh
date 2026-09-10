#!/usr/bin/env bash
set -euo pipefail
umask 077
here=$(dirname "$(readlink -f "$0")")
. "$here/consumer-lock.sh"
consumer_lock offsite-sync 300
export PATH=/usr/local/bin:/usr/bin:/bin
python3 "$(dirname "$(readlink -f "$0")")/offsite.py" sync 2>&1 | tee -a "$PROVISIONER_STATE_DIR/offsite.log"
