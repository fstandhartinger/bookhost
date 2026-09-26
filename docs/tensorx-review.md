# TensorX — Anbieter-/DPA-Review als Aktivierungsvoraussetzung

- **Zweck**: Prüfung der veröffentlichten TensorX-Dokumente (DPA, Privacy Policy, Terms of Service, Unterauftragsverarbeiter-Seite) gegen die aktuellen BookHost-Texte (`content/legal/avv.md`, Anlage 3, Zeilen 130–154; `content/legal/datenschutz.md`, Abschnitte 8–9, Zeilen 88–106) und Ableitung der Aktivierungsentscheidung für die Nutzung der KI-Funktionen (Upload-Beta, Wiki-Antworten-Beta, semantische Wiki-Indexierung) mit personenbezogenen Kundeninhalten.
- **Datum**: 2026-09-26
- **Run**: `bookhost-r6-b27ebfb3` (Portfolio-Runde BookHost)
- **Hinweis**: Dies ist eine Beschreibung der Anbieterangaben und eine Betriebsentscheidung, keine Rechtsberatung / keine rechtliche Bewertung.

## 1. Quellen

Die Seiten wurden vom Supervisor im geteilten Chrome (echter Browser, Readback) geladen; die erfassten Volltexte liegen unter `controller/state/runs/bookhost-r6-b27ebfb3/evidence/`:

| Dokument | URL | fetched_utc | HTTP |
| --- | --- | --- | --- |
| Terms of Service | https://tensorx.ai/terms-of-service/ | 2026-09-26T14:51:09+00:00 | 200 |
| Privacy Policy | https://tensorx.ai/privacy-policy/ | 2026-09-26T14:51:16+00:00 | 200 |
| Data Processing Agreement | https://tensorx.ai/dpa/ | 2026-09-26T14:51:20+00:00 | 200 |
| Sub-processors | https://tensorx.ai/sub-processors/ | 2026-09-26T14:51:26+00:00 | 200 |

Anmerkung: Der Readback von `https://tensorx.ai/sub-processors/` lieferte denselben Titel und dieselbe Textlänge wie die DPA („Data Processing Agreement – TensorX", 26386 Zeichen). Die Unterauftragsverarbeiterliste wurde daher aus Anlage 1(f) der DPA ausgewertet (`tensorx-dpa.txt:195-211`).

## 2. Befunde

| Claim | Beobachtete Quelle (Evidenz:Zeile) | Beobachteter Text (Kurzzitat) | Status ggü. BookHost-Text |
| --- | --- | --- | --- |
| Rechtsträger / Sitz | `tensorx-dpa.txt:247-251`; `tensorx-terms.txt:323-327`; `tensorx-privacy.txt:44-50` | „TensorX Ltd. … Unit 25, Classon House, Dundrum Business Park, Dublin 14, Ireland"; Company No. 796387 (`tensorx-dpa.txt:281`) | **MATCH** (`avv.md:142,146`) |
| Null-Retention der Inferenzdaten | `tensorx-dpa.txt:70` (§ 2.2.3); `tensorx-dpa.txt:183` (Anlage 1); `tensorx-dpa.txt:260`; `tensorx-privacy.txt:72` | § 2.2.3: „does not store, log, or otherwise retain Customer API Data … transiently in ephemeral memory … not persisted to any storage system"; Anlage 1: „ephemeral enclaves"; Footer: „Zero data retention. EU-sovereign."; Privacy: „zero data retention architecture … never stored, logged, or persisted" | **MISMATCH** in der Abschnittsnummer, **MATCH** in der Substanz: BookHost zitiert „§ 3.2 der Vendor-DPA" (`avv.md:130,142,146,152`; `datenschutz.md:94,98`; Wortlauttest `tests/public-wording.test.ts:62`). Die beobachtete § 3.2 ist aber die Unterstützungsklausel bei Datenschutzverletzungen (`tensorx-dpa.txt:76`: „provide sufficient information and assistance … in relation to notification of Personal Data breaches"). Die Null-Retention steht in § 2.2.3. |
| Verarbeitungsstandorte | `tensorx-dpa.txt:32`; Tabelle `tensorx-dpa.txt:200-208` | „operated exclusively on EU-sovereign infrastructure physically located in Dublin and Helsinki"; Digital Realty „Dublin, Ireland, EU"; Verda „Finland, EU"; Cloudflare, G-Core, AWS EMEA SARL, Scaleway, Google Workspace, Stripe, DeusXPay „EU (European data centres)" | **MATCH** („Dublin (Irland) und Helsinki (Finnland)", `avv.md:142,146`; `datenschutz.md:94,98,104`) |
| Unterauftragsverarbeiterliste | `tensorx-dpa.txt:199-211` | 12 Einträge (Liste unten); drei davon außerhalb der EU mit „SCCs in place" bzw. US/UK-Angabe (`tensorx-dpa.txt:209-211`) | **GAP**: Resend (USA), Intercom (EU/USA), Attio (EU/UK/USA) verarbeiten außerhalb der EU für die eigenen Abläufe von TensorX; die BookHost-Texte nennen diese Nuance nicht (`avv.md:142` verweist nur auf tensorx.ai/sub-processors) |
| Transfergrundlage | `tensorx-dpa.txt:88` (§ 5.1); `tensorx-dpa.txt:233-234`; `tensorx-dpa.txt:238-242`; `tensorx-privacy.txt:98`; `tensorx-dpa.txt:237` | „Standard Contractual Clauses"; Clause 17 Option 1 und Clause 18: Irland; UK International Data Transfer Addendum B.1.0; Privacy: „EU Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914) or … adequacy decisions"; zuständige Behörde: „Irish Data Protection Commission" | **MATCH** (`datenschutz.md:104`: Angemessenheitsbeschluss oder EU-Standardvertragsklauseln nach Art. 44 ff. DSGVO) |
| Kein Training auf Inferenzdaten | `tensorx-privacy.txt:72`; `tensorx-dpa.txt:71` (§ 2.2.4); `tensorx-terms.txt:215` (Ziff. 9.4) | „We do not use your inference data to train or improve any models."; § 2.2.4: „not … to train, fine-tune, or otherwise improve any artificial intelligence model" | **MATCH** (`avv.md:130`: „Eine Nutzung für Modelltraining … wird nicht aktiviert") |
| Retention von Nicht-Inferenzdaten | `tensorx-privacy.txt:104-109` | „Usage metadata … up to 12 months"; „Security logs … up to 12 months"; „Financial records: … 6 years"; „Account data: … duration of the account relationship, plus a reasonable period afterwards" | **MATCH**: die BookHost-Texte beziehen die Null-Retention ausdrücklich nur auf „Prompts und Completionen" (`avv.md:130,142,146`), kein Widerspruch; die vendorseitige Konten-/Abrechnungsverarbeitung läuft als eigener Verantwortlicher unter der Privacy Policy von TensorX (`tensorx-terms.txt:217`, Ziff. 9.5) |
| Einbeziehung der DPA | `tensorx-dpa.txt:30`; `tensorx-privacy.txt:145`; `tensorx-terms.txt:55,211` | „automatically incorporated into and forms part of the TensorX Terms of Service"; Privacy: „The DPA is automatically incorporated into our Terms of Service." | **MATCH** („über die Vendor-Nutzungsbedingungen automatisch einbezogen", `avv.md:142,146`; `datenschutz.md:94,98`) |

Unterauftragsverarbeiter laut `tensorx-dpa.txt:199-211` (Anbieter, Zweck, Standort): 1. Cloudflare, Inc. (Turnstile-Service, EU) · 2. G-Core Labs S.A. (CDN/Netzwerksicherheit/DDoS/WAF, EU) · 3. Amazon Web Services / AWS EMEA SARL (Cloud-Infrastruktur, EU) · 4. Scaleway SAS (Netzwerksicherheit/Cloud-Infrastruktur, EU) · 5. Verda (Rechenzentrum/Colocation, Finnland, EU) · 6. Digital Realty Trust, Inc. (Rechenzentrum/Colocation, Dublin, Irland, EU) · 7. Google LLC / Workspace (E-Mail, interne Kommunikation, EU) · 8. Stripe, Inc. (Kartenzahlungen, EU) · 9. DeusXPay (Krypto-Zahlungen, EU) · 10. Resend (Plus Five Five, Inc.; Transaktions-/Marketing-E-Mail, USA, SCCs) · 11. Intercom R&D Unlimited Company (Support-Chat/Messaging, EU/USA, SCCs) · 12. Attio Limited (CRM, EU/UK/USA).

## 3. Konsistenzprüfung

Die Zitation „§ 3.2" ist in diesen BookHost-Stellen fehlerhaft (beobachtete § 3.2 der DPA ist die Verletzungshilfsklausel, `tensorx-dpa.txt:76`; Null-Retention steht in § 2.2.3, `tensorx-dpa.txt:70`):

- `content/legal/avv.md:130` — „nach § 3.2 der Vendor-DPA"
- `content/legal/avv.md:142` — „Null-Retention … nach § 3.2 der Vendor-DPA"
- `content/legal/avv.md:146` — „§ 3.2 der DPA sieht vor, …"
- `content/legal/avv.md:152` — „(Vendor-DPA einschließlich § 3.2, …)"
- `content/legal/datenschutz.md:94` — „Nach § 3.2 der Vendor-DPA"
- `content/legal/datenschutz.md:98` — „§ 3.2 sieht vor, …"
- `tests/public-wording.test.ts:62` — der Wortlauttest verlangt den datenschutz.md-Absatz einschließlich „§ 3.2 sieht vor" wörtlich
- zusätzlich identifiziert: `docs/avv-explainer/claims.md:23,26` — die Belegspalten zitieren „§ 3.2"

Korrektur in dieser Runde: Alle Stellen werden auf „§ 2.2.3 (Anlage 1: „Zero data retention“)" umgestellt (`content/legal/avv.md`, `content/legal/datenschutz.md`, Wortlauttest). Zusätzlich wird die Unterauftragsverarbeiter-Nuance ergänzt: Resend (USA), Intercom (EU/USA) und Attio (EU/UK/USA) verarbeiten außerhalb der EU auf Grundlage von SCCs für die eigenen Abläufe von TensorX (E-Mail-Versand, Support, CRM) — nicht für den Inferenzpfad.

## 4. Aktivierungsentscheidung

Regel (aus der unabhängigen PRD-Prüfung): Eine **freigegebene** Entscheidung erfordert **null offene MISMATCH/GAP-Zeilen**; eine MISMATCH/GAP-Zeile darf nur bleiben, wenn die Entscheidung **aus genau diesem Grund weiter blockiert** ist.

Lage: Die Abschnittsnummern-MISMATCH-Zeile wird in dieser Runde korrigiert (Abschnitt 3), und die Unterauftragsverarbeiter-GAP-Zeile wird durch die ergänzte Offenlegung geschlossen. Damit ist die Regel erfüllt.

**Entscheidung:**
- Die Aktivierungsvoraussetzung ist auf der dokumentierten Anbieterbasis **erfüllt**; die Unterlagenprüfung ist damit abgeschlossen.
- Die **formelle Aufhebung der öffentlichen Beta-Beschränkung** („nur nicht personenbezogene Beispieldokumente") und jede **Vermarktung** erfolgen als eigener, getrennt geprüfter Schritt; bis dahin bleiben die öffentlichen Produkttexte unverändert (Steering-Nachtrag C2: „Erst nach Datenschutz-/Verarbeitungsprüfung an Kundendaten vermarkten"; PRD T-5).
- Dies ist eine Beschreibung der Anbieterangaben und eine Betriebsentscheidung, keine Rechtsberatung / keine rechtliche Bewertung.

**Restliche Unsicherheiten (dokumentiert, nicht blockierend):**
1. Zusätzliche Sub-Prozessoren außerhalb der EU: Resend (USA), Intercom (EU/USA), Attio (EU/UK/USA) — SCCs laut Anbieterangabe (`tensorx-dpa.txt:209-211`); sie betreffen die eigenen Abläufe von TensorX, nicht den Inferenzpfad.
2. Metadaten-Retention: Nutzungs- und Sicherheitsmetadaten bis zu 12 Monate, Finanzunterlagen 6 Jahre (`tensorx-privacy.txt:104-109`) — betrifft nicht die Inferenzdaten.
3. Der Anbieter kann Bedingungen ändern; für Unterauftragsverarbeiter-Änderungen sieht Clause 4.2 der DPA 14 Kalendertage Vorlauf vor (`tensorx-dpa.txt:82`); die Liste unter tensorx.ai/sub-processors sollte periodisch erneut gelesen werden.

## 5. Prüfung verbotener Begriffe

Forbidden-term check: Diese Datei wurde gegen die im Arbeitsauftrag definierte Ausschlussliste geprüft. Ergebnis: keiner der ausgeschlossenen Ausdrücke kommt in dieser Datei vor; der geforderte Ausdruck „keine Rechtsberatung" ist im Kopf und in Abschnitt 4 enthalten. Nach den in Abschnitt 3 umgesetzten Korrekturen sind keine Befundezeilen offen (0 × MISMATCH, 0 × GAP).