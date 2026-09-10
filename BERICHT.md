# Bericht: globale Host-Belegung im Betreiberpfad

GELIEFERT: Kollisionsprüfung vor dem Schreiben in `host_command`, für Alias-Hinzufügen,
Alias-Setzen und Rehost. Prüfung anderer Tenant-Verzeichnisse unter ROOT mit
`canonical_host`, `read_aliases` und `checked_hosts`. Fehlermeldung nennt Host und
belegenden Slug. Eigener Tenant und versteckte Verwaltungsverzeichnisse werden
übersprungen. `--remove` bleibt unverändert. Großbuchstaben und abschließende Punkte
werden wie bisher als ungültig abgelehnt; keine neue Normalisierung.

Branch: `host-unique` im frischen Klon `work/host-unique-clone`.
Implementierungs- und Test-Commit: `c99bea1137b64060277c64d0dae652eca2d564cc`.
Dieser Bericht wird anschließend separat committet, damit der referenzierte Hash stabil bleibt.

## RED vor Implementierung

Unveränderter Produktivcode, neuer Regressionstest; Exit-Code 1:

```text
ALIASES restart required: bookstack
F
======================================================================
FAIL: test_add_rejects_other_tenant_alias_without_writes (test_tenant_aliases.TenantHostOwnershipTests.test_add_rejects_other_tenant_alias_without_writes)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/home/flori/ventures2/bookstack/work/host-unique-clone/ops/provisioner/test_tenant_aliases.py", line 164, in test_add_rejects_other_tenant_alias_without_writes
    self.assert_collision('aliases', ['--add', 'wiki.example.com'])
  File "/home/flori/ventures2/bookstack/work/host-unique-clone/ops/provisioner/test_tenant_aliases.py", line 156, in assert_collision
    with self.assertRaisesRegex(ValueError, 'wiki.example.com.*owner-test'):
AssertionError: ValueError not raised

----------------------------------------------------------------------
Ran 1 test in 0.004s

FAILED (failures=1)
ALIASES updated old.example.org
```

## GREEN nach Implementierung

Identischer Regressionstest; Exit-Code 0:

```text
.
----------------------------------------------------------------------
Ran 1 test in 0.005s

OK
```

Befehl für beide Einzeltest-Läufe:

```sh
TMPDIR="$PWD/.test-tmp" PYTHONDONTWRITEBYTECODE=1 /home/flori/ventures2/bookstack/work/prov-clone/ops/provisioner/.venv/bin/python -m unittest discover -s ops/provisioner -p test_tenant_aliases.py -k test_add_rejects_other_tenant_alias_without_writes
```

## VERIFIZIERT WIE

Alle Läufe mit obigem Python, TMPDIR innerhalb des Klons und deaktivierten Bytecode-Schreibzugriffen.

| Suite / unittest discover | Vorher | Nachher |
| --- | ---: | ---: |
| `-s ops/provisioner -p 'test_*.py'` | 148, OK | 155, OK |
| `-s ops/watchdog -p 'test_*.py'` | 15, OK | 15, OK |
| `-s ops/provisioner -p test_tenant_aliases.py` | 10 bestehende Tests | 17, OK |

Neue Tests:

- `test_add_rejects_other_tenant_alias_without_writes`
- `test_add_rejects_other_tenant_canonical_without_writes`
- `test_add_rejects_other_tenant_default_canonical`
- `test_set_and_rehost_reject_other_tenant_hosts`
- `test_add_same_tenant_alias_and_canonical_is_idempotent`
- `test_remove_still_works_with_existing_collisions`
- `test_uppercase_and_trailing_dot_still_rejected`

Die Kollisionsfälle vergleichen Datei-Inhalte vor/nach der Ablehnung und prüfen,
dass weder Konfigurationsgenerierung noch Compose aufgerufen werden (Default-Host-Test:
Dateivergleich und kein Compose). Der rote Lauf belegt, dass zuvor die Ablehnung fehlte.
Die Tests verwenden temporäre Tenant-Verzeichnisse; externe Aufrufe sind gemockt.
Der bestehende Rollback-Test erhält ebenfalls ein gepatchtes ROOT, damit die neue
Prüfung ausschließlich Testdaten liest. `git diff --check` war sauber.

OFFEN: Keine offenen Abnahmekriterien. Nicht gepusht und nicht ausgerollt.
Keine laufenden Tenants oder Docker angesprochen; keine Änderungen am aktiven Checkout.
Die Prüfung ist eine Vorabprüfung; eine globale Serialisierung zeitgleicher
Host-Änderungen zwischen verschiedenen Tenants ist nicht Bestandteil dieser Änderung.
