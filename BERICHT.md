# Domain-Freigabe: Abschlussbericht

## GELIEFERT

Frischer Klon `work/domain-release-clone`, Zweig `domain-release`.
Implementierungs-Commit: `aea763666699ce7f588e8accd1d5d9e1fe73783b`.
Dieser Bericht wird in einem anschließenden Dokumentations-Commit aufgenommen.

Zurückgezogene Domains werden gelöscht, wenn das Tenant-Verzeichnis bzw.
`.initialized` fehlt. Prüfung und Löschung erfolgen unter dem Lifecycle-flock
von tenant.py. Symlinks und Import-Quarantäne bleiben gesperrt.
Bei initialisierten Tenants wird weiterhin zuerst der Alias entzogen und erst
nach erfolgreicher Rückkehr die Datenbankzeile gelöscht. Fehler behalten die Reservierung.
Bei Versuch 20 wird für unerledigte Aufgaben eine deutliche Betreibermeldung
mit Team, Host und Entzugsstatus ausgegeben; keine Exception-Inhalte oder Secrets.
Erfolgreiche Löschung/Aktivierung erzeugt keine falsche Warnung.

## VERIFIZIERT WIE

Python: `/home/flori/ventures2/bookstack/work/prov-clone/ops/provisioner/.venv/bin/python`.
Nur als Interpreter verwendet; keine Änderungen an diesem Checkout.
Neue Tests verwenden Datenbank-/Alias-Attrappen und temporäre Verzeichnisse
innerhalb des frischen Klons. Keine Live-Tenants, Docker- oder Lifecycle-Aufrufe.

Vorher: **141 Tests**, nachher: **148 Tests**, jeweils gesamte Provisionierer-Suite.
Befehl jeweils in `ops/provisioner`: `python -m unittest discover`.
`git diff --check` ebenfalls erfolgreich.

### Ausgangssuite

```text
----------------------------------------------------------------------
Ran 141 tests in 3.387s

OK
```

### RED – neue Tests gegen unveränderten worker.py

Befehl im Klon: `python -m unittest discover -s ops/provisioner -p test_custom_domains.py -v`.
Vier erwartete Fehlschläge: zwei weiterhin belegte Domains und zwei fehlende
Betreibermeldungen. Reihenfolge und Reservierung bei Aliasfehler waren bereits grün.

```text
test_add_and_activate (test_custom_domains.CustomDomainsTests.test_add_and_activate) ... ok
test_certificate_pending_is_retryable (test_custom_domains.CustomDomainsTests.test_certificate_pending_is_retryable) ... ok
test_error_is_recorded_without_details (test_custom_domains.CustomDomainsTests.test_error_is_recorded_without_details) ... ok
test_withdrawal_removes_alias_before_release (test_custom_domains.CustomDomainsTests.test_withdrawal_removes_alias_before_release) ... ok
test_query_paces_retries_and_stops_after_twenty (test_custom_domains.DomainBackoffTest.test_query_paces_retries_and_stops_after_twenty) ... ok
test_existing_tenant_alias_failure_keeps_domain (test_custom_domains.DomainReleaseTests.test_existing_tenant_alias_failure_keeps_domain) ... ok
test_existing_tenant_withdraws_alias_before_delete (test_custom_domains.DomainReleaseTests.test_existing_tenant_withdraws_alias_before_delete) ... ok
test_last_failed_attempt_alerts_operator_and_keeps_domain (test_custom_domains.DomainReleaseTests.test_last_failed_attempt_alerts_operator_and_keeps_domain) ... FAIL
test_last_successful_attempt_does_not_alert (test_custom_domains.DomainReleaseTests.test_last_successful_attempt_does_not_alert) ... ok
test_missing_tenant_releases_withdrawn_domain (test_custom_domains.DomainReleaseTests.test_missing_tenant_releases_withdrawn_domain) ... FAIL
test_quarantine_keeps_domain_and_alerts_at_limit (test_custom_domains.DomainReleaseTests.test_quarantine_keeps_domain_and_alerts_at_limit) ... FAIL
test_uninitialized_tenant_releases_withdrawn_domain (test_custom_domains.DomainReleaseTests.test_uninitialized_tenant_releases_withdrawn_domain) ... FAIL
test_alias_uses_existing_path_and_never_rehost (test_custom_domains.DomainTransportTests.test_alias_uses_existing_path_and_never_rehost) ... ok
test_public_proxy_address_rejected_before_network (test_custom_domains.DomainTransportTests.test_public_proxy_address_rejected_before_network) ... ok
test_tls_uses_fixed_private_ip_with_customer_sni (test_custom_domains.DomainTransportTests.test_tls_uses_fixed_private_ip_with_customer_sni) ... ok
test_untrusted_certificate_stays_pending (test_custom_domains.DomainTransportTests.test_untrusted_certificate_stays_pending) ... ok

======================================================================
FAIL: test_last_failed_attempt_alerts_operator_and_keeps_domain (test_custom_domains.DomainReleaseTests.test_last_failed_attempt_alerts_operator_and_keeps_domain)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/home/flori/ventures2/bookstack/work/domain-release-clone/ops/provisioner/test_custom_domains.py", line 138, in test_last_failed_attempt_alerts_operator_and_keeps_domain
    self.assertIn('Domain retry limit reached', output)
AssertionError: 'Domain retry limit reached' not found in ''

======================================================================
FAIL: test_missing_tenant_releases_withdrawn_domain (test_custom_domains.DomainReleaseTests.test_missing_tenant_releases_withdrawn_domain)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/home/flori/ventures2/bookstack/work/domain-release-clone/ops/provisioner/test_custom_domains.py", line 115, in test_missing_tenant_releases_withdrawn_domain
    self.assertFalse(retained, 'Withdrawn domain remains in tenant_domains')
AssertionError: True is not false : Withdrawn domain remains in tenant_domains

======================================================================
FAIL: test_quarantine_keeps_domain_and_alerts_at_limit (test_custom_domains.DomainReleaseTests.test_quarantine_keeps_domain_and_alerts_at_limit)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/home/flori/ventures2/bookstack/work/domain-release-clone/ops/provisioner/test_custom_domains.py", line 151, in test_quarantine_keeps_domain_and_alerts_at_limit
    self.assertIn('operator action required', output)
AssertionError: 'operator action required' not found in ''

======================================================================
FAIL: test_uninitialized_tenant_releases_withdrawn_domain (test_custom_domains.DomainReleaseTests.test_uninitialized_tenant_releases_withdrawn_domain)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/home/flori/ventures2/bookstack/work/domain-release-clone/ops/provisioner/test_custom_domains.py", line 120, in test_uninitialized_tenant_releases_withdrawn_domain
    self.assertFalse(retained, 'Withdrawn domain remains in tenant_domains')
AssertionError: True is not false : Withdrawn domain remains in tenant_domains

----------------------------------------------------------------------
Ran 16 tests in 0.028s

FAILED (failures=4)
```

### GREEN – Domain-Tests und Testnamen

Gleicher Befehl nach der Implementierung:

```text
test_add_and_activate (test_custom_domains.CustomDomainsTests.test_add_and_activate) ... ok
test_certificate_pending_is_retryable (test_custom_domains.CustomDomainsTests.test_certificate_pending_is_retryable) ... ok
test_error_is_recorded_without_details (test_custom_domains.CustomDomainsTests.test_error_is_recorded_without_details) ... ok
test_withdrawal_removes_alias_before_release (test_custom_domains.CustomDomainsTests.test_withdrawal_removes_alias_before_release) ... ok
test_query_paces_retries_and_stops_after_twenty (test_custom_domains.DomainBackoffTest.test_query_paces_retries_and_stops_after_twenty) ... ok
test_existing_tenant_alias_failure_keeps_domain (test_custom_domains.DomainReleaseTests.test_existing_tenant_alias_failure_keeps_domain) ... ok
test_existing_tenant_withdraws_alias_before_delete (test_custom_domains.DomainReleaseTests.test_existing_tenant_withdraws_alias_before_delete) ... ok
test_last_failed_attempt_alerts_operator_and_keeps_domain (test_custom_domains.DomainReleaseTests.test_last_failed_attempt_alerts_operator_and_keeps_domain) ... ok
test_last_successful_attempt_does_not_alert (test_custom_domains.DomainReleaseTests.test_last_successful_attempt_does_not_alert) ... ok
test_missing_tenant_releases_withdrawn_domain (test_custom_domains.DomainReleaseTests.test_missing_tenant_releases_withdrawn_domain) ... ok
test_quarantine_keeps_domain_and_alerts_at_limit (test_custom_domains.DomainReleaseTests.test_quarantine_keeps_domain_and_alerts_at_limit) ... ok
test_uninitialized_tenant_releases_withdrawn_domain (test_custom_domains.DomainReleaseTests.test_uninitialized_tenant_releases_withdrawn_domain) ... ok
test_alias_uses_existing_path_and_never_rehost (test_custom_domains.DomainTransportTests.test_alias_uses_existing_path_and_never_rehost) ... ok
test_public_proxy_address_rejected_before_network (test_custom_domains.DomainTransportTests.test_public_proxy_address_rejected_before_network) ... ok
test_tls_uses_fixed_private_ip_with_customer_sni (test_custom_domains.DomainTransportTests.test_tls_uses_fixed_private_ip_with_customer_sni) ... ok
test_untrusted_certificate_stays_pending (test_custom_domains.DomainTransportTests.test_untrusted_certificate_stays_pending) ... ok

----------------------------------------------------------------------
Ran 16 tests in 0.030s

OK
```

### GREEN – gesamte Suite

```text
----------------------------------------------------------------------
Ran 148 tests in 3.317s

OK
```

## OFFEN

Keine ausstehenden Implementierungsschritte im beschriebenen Retry-Ablauf.
Die bestehende Auswahlgrenze `attempts < 20` bleibt bestehen:
Schon vor dieser Änderung ausgeschöpfte Datensätze werden nicht nachträglich
abgearbeitet; hierfür wäre eine gesonderte, autorisierte Datenbereinigung bzw.
ein Retry-Reset erforderlich. Es wurde keine produktive Datenbank angefasst.
Die Betreibermeldung entsteht beim Erreichen der Grenze, nicht rückwirkend.

Nicht gepusht, nicht ausgerollt.
