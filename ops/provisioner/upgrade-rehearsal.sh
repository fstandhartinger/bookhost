#!/usr/bin/env bash
# Rehearse a BookStack upgrade on one workspace's own data, in isolation.
#
# The landing page promises we handle security updates, and until today there
# was no procedure at all: the image tag is pinned in one line and host
# maintenance is explicitly forbidden from touching it. This restores the
# workspace's latest backup into a private, unrouted instance running the
# target image, lets BookStack run its own migrations there, compares the
# content against what the backup recorded and then removes everything.
#
# Nothing about the live workspace is touched. Without an argument it rehearses
# the image we already run, which exercises the procedure rather than a version
# change.
#
# Usage: upgrade-rehearsal.sh <slug> [lscr.io/linuxserver/bookstack:<tag>]
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
exec python3 "$here/tenant.py" upgrade-rehearsal "$@"
