# Customer-owned domains

Apply control-plane migration `030_custom_domain.sql` before deploying either
new dashboard code or worker code. No production rollout is included in this branch.

Owners/admins request up to three lowercase ASCII domains in **Your own domain**.
The panel shows CNAME `<customer-host>` to the persisted tenant hostname (normally
`<slug>.bookhost.co`), plus TXT `_bookhost-verify.<customer-host>` containing a
fresh 32-byte random hexadecimal token. For a DNS provider that cannot use CNAME,
set control-plane `CUSTOM_DOMAIN_IPV4` to the operator's actual ingress IPv4;
the panel then also offers that A record. `CUSTOM_DOMAIN_IPV6` optionally permits
verification against the ingress IPv6. These values are explicit operator config,
not derived from untrusted DNS. CNAME verification works without either setting.
Do not point these variables at the control-plane application if its ingress differs
from the tenant proxy.

Check now performs DNS only, with four seconds total and one resolver attempt.
A matching TXT value AND either the tenant CNAME or a configured ingress address
are required. DNS records should remain in place. Missing/wrong DNS leaves
`pending_dns` with instructions. Per-team writes/checks share 10 requests/minute,
stored in PostgreSQL. Cross-origin requests and members are rejected.

The worker selects only its `PROVISIONER_INSTANCE`, healthy running tenants and
verified domains (or previously verified failures). It handles at most three per
pass, oldest attempt first, with at least one minute between attempts. It calls
`tenant.py aliases <slug> --add <host>`, preserving APP_URL and existing aliases.
Compose `up` is idempotent when the desired labels are unchanged.

TLS verification connects only to `CUSTOM_DOMAIN_PROXY_IP` (default `127.0.0.1`),
which must be a private/loopback literal IP where the tenant Traefik listens on
443. Configure a reachable private proxy address when the worker runs elsewhere.
It sends customer-host SNI and Host, uses system CA/hostname verification, and
checks the `/login` response without following redirects. Missing certificates or
unreachable HTTPS retain `verified` and a retry notice. Routing failures become
`failed` with a sanitized, retryable message. No HTTP to customer-controlled DNS.

Removal is asynchronous: `removal_requested_at` keeps the global host reservation
until `tenant.py aliases ... --remove ...` succeeds. Teams count withdrawing rows
against their limit until completion. Shared team row locks serialize API writes,
quota checks, activation and withdrawal; worker uses SKIP LOCKED. Errors retain
the reservation. A destroyed/uninitialized tenant whose alias cannot be removed
needs operator reconciliation before releasing its reservation. Never manually
release a row while its proxy route can still serve the former tenant.

Ownership proof establishes DNS control at verification time; it does not assert
legal ownership or prevent subsequent domain expiration, transfer or compromised
DNS accounts. Global uniqueness prevents simultaneous claims and tokens are
unpredictable. Periodic ownership revalidation is not implemented in this slice.

APP_URL stays canonical. BookStack can redirect logins/links to that canonical
address, and cookies are per hostname. A later canonical migration needs an
explicit primary-domain choice, fresh DNS/TLS checks, `tenant.py rehost` keeping
the former host as alias, consistent `tenants.host`/`bookstack_url` updates,
BookStack URL/content handling, cookie/auth and OAuth callback tests, and rollback.
Inbound email addresses are unchanged; own-domain email reception is not included.
