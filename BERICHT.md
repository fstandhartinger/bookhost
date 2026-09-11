# Fehlerhistorie über Deploys hinweg

GELIEFERT: Frischer Klon `work/error-history-clone`, Zweig `error-history`.
Migration `032_error_reports.sql` enthält exakt die neun beauftragten Spalten
und den Index auf `(ts DESC)`. `reportError` bleibt synchron (`void`), behält
das bisherige JSON-Log bytegenau bei und schreibt ausschließlich den
bereinigten Datensatz über parametrisierte SQL-Werte. Ungültige bereinigte
Team-IDs werden NULL. Import-/Initialisierungsfehler, synchrone Query-Fehler
und Promise-Ablehnungen werden durch den abschließenden Catch abgefangen.

## RED vor Implementierung

Befehl: `npm test -- tests/error-diagnostics.test.ts -t 'writes only'`
Exit-Code: 1. Zum Zeitpunkt dieses Laufs war `lib/error-diagnostics.ts`
unverändert und die Migration noch nicht angelegt.

```text

> bookhost-control-plane@1.0.0 test
> vitest run tests/error-diagnostics.test.ts -t writes only


 RUN  v3.2.7 /home/flori/ventures2/bookstack/work/error-history-clone

 ❯ tests/error-diagnostics.test.ts (11 tests | 1 failed | 10 skipped) 1012ms
   × persistent error diagnostics > writes only the sanitized diagnostic fields with parameterized SQL 1010ms
     → expected "spy" to be called once, but got 0 times
   ↓ persistent error diagnostics > preserves console.error fields and their exact order
   ↓ persistent error diagnostics > stores invalid team_id invalid/team as NULL
   ↓ persistent error diagnostics > stores invalid team_id  as NULL
   ↓ persistent error diagnostics > stores invalid team_id undefined as NULL
   ↓ persistent error diagnostics > stores invalid team_id 123 as NULL
   ↓ persistent error diagnostics > stores invalid team_id 12345678-1234-1234-1234-123456789abz as NULL
   ↓ persistent error diagnostics > stores missing optional identifiers as NULL and keeps them out of the log
   ↓ persistent error diagnostics > swallows database failure (synchronous throw) without throwing or unhandled rejection
   ↓ persistent error diagnostics > swallows database failure (rejected promise) without throwing or unhandled rejection
   ↓ persistent error diagnostics > returns void before a pending database write finishes

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/error-diagnostics.test.ts > persistent error diagnostics > writes only the sanitized diagnostic fields with parameterized SQL
AssertionError: expected "spy" to be called once, but got 0 times
 ❯ tests/error-diagnostics.test.ts:26:42
     24|   it("writes only the sanitized diagnostic fields with parameterized S…
     25|     expect(reportError(diagnostic)).toBeUndefined();
     26|     await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
       |                                          ^
     27|     const [sql, values] = query.mock.calls[0];
     28|     expect(sql.replace(/\s+/g, " ").trim()).toBe(

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 10 skipped (11)
   Start at  00:06:07
   Duration  1.62s (transform 105ms, setup 0ms, collect 93ms, tests 1.01s, environment 0ms, prepare 285ms)

```

## GREEN nach Implementierung und Testnamen

Befehl: `npm test -- tests/error-diagnostics.test.ts --reporter=verbose`
Exit-Code: 0.

```text

> bookhost-control-plane@1.0.0 test
> vitest run tests/error-diagnostics.test.ts --reporter=verbose


 RUN  v3.2.7 /home/flori/ventures2/bookstack/work/error-history-clone

 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > writes only the sanitized diagnostic fields with parameterized SQL 55ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > preserves console.error fields and their exact order 2ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > stores invalid team_id invalid/team as NULL 51ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > stores invalid team_id  as NULL 51ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > stores invalid team_id undefined as NULL 51ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > stores invalid team_id 123 as NULL 51ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > stores invalid team_id 12345678-1234-1234-1234-123456789abz as NULL 52ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > stores missing optional identifiers as NULL and keeps them out of the log 51ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > swallows database failure (synchronous throw) without throwing or unhandled rejection 52ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > swallows database failure (rejected promise) without throwing or unhandled rejection 51ms
 ✓ tests/error-diagnostics.test.ts > persistent error diagnostics > returns void before a pending database write finishes 51ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  00:06:31
   Duration  1.07s (transform 92ms, setup 0ms, collect 78ms, tests 521ms, environment 0ms, prepare 239ms)

```

## Gesamtabnahme

`npm test`: Exit-Code 0.

```text
 Test Files  55 passed | 13 skipped (68)
      Tests  515 passed | 44 skipped (559)
   Start at  00:06:43
   Duration  6.60s (transform 6.87s, setup 0ms, collect 23.76s, tests 8.61s, environment 30ms, prepare 11.11s)

```

`npx tsc --noEmit`: Exit-Code 0, keinerlei Ausgabe.

Alle Tests liefen mit bereinigter Umgebung (`env -i`, nur PATH/HOME;
Gesamtsuite zusätzlich DATABASE_URL auf localhost:1). Keine Produktions-
Zugangsdaten geladen. Die neuen Tests mocken das Datenbankmodul; die 44
Integrationstests bleiben gemäß bestehender Konfiguration übersprungen.

`npx eslint --no-warn-ignored lib/error-diagnostics.ts tests/error-diagnostics.test.ts db/migrations/032_error_reports.sql BERICHT.md`:
Exit-Code 0, keinerlei Ausgabe. Separat vor dem Commit ausgeführt.
SQL und Markdown haben im bestehenden ESLint-Setup keinen Parser und werden
ignoriert; die TypeScript-Dateien wurden geprüft. `git diff --check` ebenfalls grün.

## OFFEN / Folgearbeit

- Aufbewahrungslogik ausdrücklich als Folgearbeit; hier nicht implementiert.
- Migration und Deploy sind nicht ausgeführt; keine Produktionszugriffe und
  kein Push. Produktiv wirksam wird die Änderung erst nach separater Migration
  und Auslieferung.
- Kein echter PostgreSQL-Integrationstest in diesem Auftrag ausgeführt.
  Nachgewiesen sind SQL-Aufruf und Fehlerisolation mit gemockter Datenbank.
- Hintergrundschreiben ist best effort: bei Datenbankausfall oder Prozessende
  vor Abschluss kann ein Ereignis fehlen. Bereits gespeicherte Zeilen bleiben
  unabhängig vom Container bestehen.

## Commit

Implementierungs-Commit: `32a56e94c9f533bce003fe7f6a3779e012f45e7d`.
Dieser Bericht wird in einem anschließenden Dokumentations-Commit festgehalten,
damit er den tatsächlichen Implementierungs-Hash enthalten kann.
