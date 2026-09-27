# Northwind Studio showcase workspace

`showcase-northwind` is the permanent, operator-owned BookHost showcase used for product
walkthroughs, QA and marketing captures. It contains only fictional Northwind Studio content
and synthetic users (`@northwind.example`). It is marked with `teams.is_showcase=true`; this
keeps it out of customer trial reminders, billing expiry actions, provisioning-watchdog alerts
and customer funnel analytics while leaving product features available for captures.

Do not use customer data in this workspace. Do not modify `demo.bookhost.co`. Do not tear down
this tenant. It is the retained showcase environment, not a disposable test fixture.

## Initial setup

The operator bootstrap creates one marked team, two dashboard users, a non-Stripe internal
active subscription and the one pending tenant row. It refuses to reuse an existing slug or
email and writes both generated dashboard passwords only to the credential file. Run it with
the normal operator database and TLS environment loaded:

```sh
node ops/showcase/bootstrap-northwind.mjs
```

The exact SQL targets and credential-file path are printed before any rows are created. Keep
`/home/flori/ventures2/bookstack/work/showcase-northwind-users.env` private; the script creates
it with mode `0600`. The provisioner then handles `showcase-northwind` through its normal queue.
The account names are Mira Chen (owner) and Sam Patel (member). Sam's BookStack account is
created through the normal BookHost team invite/join flow after the tenant is running, so the
BookHost managed-login record stays consistent.

## Content and reset

The four canonical pages are tracked in `content/`: Studio handbook, First week at Northwind,
Client FAQ and Website release checklist. After a capture or editing session, restore these
pages without replacing the workspace or its account state:

```sh
python3 ops/showcase/publish.py
```

The command locks and targets only the exact `showcase-northwind` tenant, and upserts only the
four named canonical pages in their two Northwind books. It does not delete other workspace
content, users, agent history, intake drafts or the tenant. Reset temporary intake/agent material
from the dashboard by selecting the `showcase-northwind` workspace, then rejecting/removing only
the named showcase drafts and revoking the named showcase agent. Recreate demo drafts and the
agent in the product UI when preparing the next capture. Keep Live Edit enabled for the two-user
editing capture.

## Semantic Ask

Semantic Ask is optional. Enable it only when the production embedding feature is globally
enabled and the operator has confirmed the configured provider is available for this workspace.
The feature is tenant-gated; the workspace's opt-in is stored on the marked team. If that gate or
provider is unavailable, the normal lexical Ask experience remains available and no semantic
capability should be claimed in capture copy.
