#!/usr/bin/env python3
"""Report when the BookStack we pin has fallen behind the upstream release.

The landing page promises that we handle security updates. The image tag in
ops/provisioner/tenant.py is pinned and nothing ever bumps it, so until this
check existed nobody would have noticed a security release going by. This does
not upgrade anything — it only tells us, daily, that there is something to do.

Read-only, no credentials. Exits 1 when upstream is ahead of the pin.
"""
import json
import pathlib
import re
import sys
import urllib.request

TENANT = pathlib.Path(__file__).resolve().parent / "provisioner" / "tenant.py"
LATEST = "https://api.github.com/repos/BookStackApp/BookStack/releases/latest"


def pinned(source):
    """The BookStack version we run, without the linuxserver build suffix."""
    match = re.search(r"bookstack:(v[0-9][^'\"\s-]*)(-ls\d+)?", source)
    if not match:
        sys.exit("FEHLER: kein Image-Tag in tenant.py gefunden")
    return match.group(1), (match.group(2) or "").lstrip("-")


def upstream():
    request = urllib.request.Request(
        LATEST, headers={"Accept": "application/vnd.github+json", "User-Agent": "bookhost-version-check"}
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def parts(tag):
    return [int(n) for n in re.findall(r"\d+", tag)]


def main():
    version, build = pinned(TENANT.read_text())
    release = upstream()
    latest = release.get("tag_name") or ""
    print("gepinnt: %s (linuxserver-Build %s) | aktuell: %s vom %s"
          % (version, build or "?", latest, (release.get("published_at") or "")[:10]))
    if parts(latest) > parts(version):
        print("  ZURUECK: upstream ist weiter. Release: " + (release.get("html_url") or LATEST))
        return 1
    if parts(latest) < parts(version):
        print("  Hinweis: wir sind neuer als das letzte Release — Vorabversion?")
        return 0
    print("OK: wir fahren die aktuelle BookStack-Version.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
