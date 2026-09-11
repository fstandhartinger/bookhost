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
TAGS = ("https://hub.docker.com/v2/repositories/linuxserver/bookstack/tags"
        "?page_size=100&ordering=last_updated")


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


def newest_build(version):
    """Highest linuxserver build number published for this BookStack version.

    linuxserver rebuilds the image when its base picks up security fixes, and
    those rebuilds keep the BookStack version and raise the -lsN suffix. A check
    that only compares the upstream release would call us current while we sit
    on a base image with known holes.
    """
    request = urllib.request.Request(TAGS, headers={"User-Agent": "bookhost-version-check"})
    with urllib.request.urlopen(request, timeout=20) as response:
        tags = json.load(response).get("results", [])
    builds = []
    for tag in tags:
        match = re.fullmatch(re.escape(version) + r"-ls(\d+)", tag.get("name", ""))
        if match:
            builds.append(int(match.group(1)))
    return max(builds) if builds else None


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
    published = newest_build(version)
    if published is None:
        print("  Hinweis: kein linuxserver-Build fuer diese Version gefunden — Build ungeprueft.")
    elif build.isdigit() and published > int(build):
        print("  ZURUECK: linuxserver-Build ls%d ist neuer als unser ls%s "
              "(Basisabbild-Flicken)." % (published, build))
        return 1
    print("OK: wir fahren die aktuelle BookStack-Version und den aktuellen Build.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
