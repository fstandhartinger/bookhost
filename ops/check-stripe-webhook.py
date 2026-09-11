#!/usr/bin/env python3
"""Compare the live Stripe webhook subscription with the events the code handles.

A missing event type is invisible: the handler exists, the tests pass, and the
event simply never arrives. On 2026-09-11 `customer.updated` and `invoice.paid`
were missing, so a customer who added a card during the trial would have stayed
recorded as having none and kept receiving the dunning notice.

It also validates our own billing portal configuration and that live
subscriptions actually carry German VAT. Without STRIPE_PORTAL_CONFIG
Stripe falls back to the account-wide default, which every other venture can
change, so we must keep our own configuration (bpc_1UDXEdCozVR51OgarqW4Y669)
complete.

Read-only. Needs STRIPE_SECRET_KEY in the environment. Exits 1 on a mismatch.
"""
import os, re, sys, json, urllib.request, pathlib

ENDPOINT_URL = "https://bookhost.co/api/stripe/webhook"
PRICE = "price_1UDXEdCozVR51OgaQQhQdPmx"
PORTAL_CONFIG_URL = (
    "https://api.stripe.com/v1/billing_portal/configurations/"
    "bpc_1UDXEdCozVR51OgarqW4Y669"
)
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


def check_webhook(key):
    """Webhook check: every handled event must be subscribed live."""
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


def portal_problems(key):
    """Violations in our own portal configuration, one entry per violation."""
    request = urllib.request.Request(
        PORTAL_CONFIG_URL,
        headers={"Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        config = json.load(response)
    problems = []
    if config.get("active") is not True:
        problems.append("Portal-Konfiguration ist nicht aktiv")
    features = config.get("features") or {}
    payment_update = features.get("payment_method_update") or {}
    # without this a customer cannot attach a card at all
    if payment_update.get("enabled") is not True:
        problems.append("payment_method_update ist deaktiviert, Kunden koennen keine Karte hinterlegen")
    profile = config.get("business_profile") or {}
    if not profile.get("privacy_policy_url"):
        problems.append("business_profile.privacy_policy_url ist leer")
    if not profile.get("terms_of_service_url"):
        problems.append("business_profile.terms_of_service_url ist leer")
    return_url = config.get("default_return_url") or ""
    if not return_url.startswith("https://bookhost.co"):
        problems.append("default_return_url zeigt nicht auf https://bookhost.co: " + (return_url or "(leer)"))
    return problems


def check_portal(key):
    """Portal check: our own billing portal configuration must be complete."""
    problems = portal_problems(key)
    for problem in problems:
        print("  Portal: " + problem)
    if problems:
        return 1
    print("OK: eigene Portal-Konfiguration ist aktiv und vollstaendig.")
    vat = vat_problems(key)
    for problem in vat:
        print("  UMSATZSTEUER: " + problem)
    if vat:
        return 1
    print("OK: alle laufenden Abonnements tragen 19 % USt. auf einen Nettopreis.")
    return 0


def vat_problems(key):
    """Every live subscription must carry exactly one exclusive 19 % VAT rate.

    The rate is attached from STRIPE_TAX_RATE_DE, and the checkout silently
    omits it when that variable is missing. The customer would then pay 39 euro
    instead of the 46,41 the pricing page promises, we would owe the VAT out of
    that, and nothing would say so. This checks the outcome in Stripe rather
    than our own copy of the environment.
    """
    request = urllib.request.Request(
        "https://api.stripe.com/v1/subscriptions?limit=100&status=all",
        headers={"Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        subscriptions = json.load(response).get("data", [])
    problems = []
    for sub in subscriptions:
        if sub.get("status") not in ("trialing", "active", "past_due"):
            continue
        items = (sub.get("items") or {}).get("data") or [{}]
        price = items[0].get("price") or {}
        if price.get("id") != PRICE:
            continue
        rates = sub.get("default_tax_rates") or []
        if len(rates) != 1 or rates[0].get("percentage") != 19.0 or rates[0].get("inclusive"):
            problems.append("%s ohne korrekten 19-%%-Satz (%d Saetze)" % (sub.get("id"), len(rates)))
        if price.get("tax_behavior") != "exclusive":
            problems.append("%s: Preis ist nicht 'exclusive'" % sub.get("id"))
    return problems


def main():
    key = os.environ.get("STRIPE_SECRET_KEY")
    if not key:
        sys.exit("FEHLER: STRIPE_SECRET_KEY fehlt (source ../.env)")
    webhook = check_webhook(key)
    # run the portal check even if the webhook check already failed
    portal = check_portal(key)
    if webhook or portal:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
