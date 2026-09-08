#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH=/usr/local/bin:/usr/bin:/bin
python3 "$(dirname "$(readlink -f "$0")")/offsite.py" sync 2>&1 | tee -a /home/flori/ventures2/bookstack/tenants/offsite.log
