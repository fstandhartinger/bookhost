#!/usr/bin/env python3
"""Compare the live Stripe webhook subscription with the events the code handles.

A missing event type is invisible: the handler exists, the tests pass, and the
event simply never arrives. On 2026-09-11 `customer.updated` and `invoice.paid`
were missing, so a customer who added a card during the trial would have stayed
recorded as having none and kept receiving the dunning notice.

Read-only. Needs STRIPE_SECRET_KEY in the environment. Exits 1 on a mismatch.
"""
import os, re, sys, json, urllib.request, pathlib

ENDPOINT_URL = "https://bookhost.co/api/stripe/webhook"
BILLING = pathlib.Path(__file__).resolve().parent.parent / "lib" / "billing.ts"


def handled_events(source):
    """Event names the code compares event.type against."""
    return set(re.findall(r'"((?:checkout|customer|invoice|payment_intent)\.[a-z_.]+)"', source))


def subscribed_events(key):
    request = urllib.request.Request(
        "https://api.stripe.com/v1/webhook_endpoints?limit=100",
        headers={"Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.load(response)
    for endpoint in data["data"]:
        if endpoint["url"] == ENDPOINT_URL:
            if endpoint["status"] != "enabled":
                sys.exit("FEHLER: Endpoint %s ist %s" % (ENDPOINT_URL, endpoint["status"]))
            return set(endpoint["enabled_events"])
    sys.exit("FEHLER: kein Webhook-Endpoint fuer " + ENDPOINT_URL)


def main():
    key = os.environ.get("STRIPE_SECRET_KEY")
    if not key:
        sys.exit("FEHLER: STRIPE_SECRET_KEY fehlt (source ../.env)")
    handled = handled_events(BILLING.read_text())
    subscribed = subscribed_events(key)
    missing = sorted(handled - subscribed - {"*"})
    unused = sorted(subscribed - handled - {"*"})
    print("behandelt im Code: %d | abonniert bei Stripe: %d" % (len(handled), len(subscribed)))
    for name in unused:
        print("  nur abonniert, im Code ignoriert: " + name)
    if missing:
        for name in missing:
            print("  FEHLT bei Stripe, wird aber behandelt: " + name)
        return 1
    print("OK: jedes behandelte Ereignis ist abonniert.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
