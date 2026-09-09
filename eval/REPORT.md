# Draft quality: measured comparison

Measured on 2026-09-09 using fictional fixtures and the real production draft function. Scores include generation failures as zero. Times are wall-clock seconds, tokens are provider total tokens; — means unavailable.

| Model | Baseline mean score | Final mean score | Baseline mean seconds | Final mean seconds | Final valid drafts | Final detected fidelity failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| google/gemma-4-31B-turbo-TEE | 41.7 | 100.0 | 16.1 | 20.0 | 6/6 | 0 |
| deepseek-ai/DeepSeek-V3.2-TEE | 76.7 | 66.7 | 65.6 | 69.7 | 4/6 | 0 |

## Baseline and final by document

| Document | Model | Baseline score | Seconds | Tokens | Final score | Seconds | Tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| onboarding | Gemma | 70 | 10.4 | 1132 | 100 | 17.9 | 1546 |
| onboarding | DeepSeek | 100 | 40.7 | 1258 | 100 | 46.0 | 1523 |
| meeting | Gemma | 0 | 12.6 | 1109 | 100 | 16.1 | 1563 |
| meeting | DeepSeek | 100 | 58.0 | 1273 | 100 | 73.3 | 1498 |
| process | Gemma | 80 | 14.4 | 1457 | 100 | 16.7 | 1906 |
| process | DeepSeek | 0 | 90.0 | — | 0 | 90.0 | — |
| customer-thread | Gemma | 100 | 13.1 | 1217 | 100 | 16.8 | 1680 |
| customer-thread | DeepSeek | 100 | 48.3 | 1346 | 100 | 48.7 | 1576 |
| runbook | Gemma | 0 | 29.1 | 1267 | 100 | 22.2 | 1696 |
| runbook | DeepSeek | 100 | 79.7 | 1332 | 100 | 70.0 | 1580 |
| policy | Gemma | 0 | 17.1 | 1513 | 100 | 30.4 | 1950 |
| policy | DeepSeek | 60 | 76.8 | 1887 | 0 | 90.0 | — |

## Decision and evidence

Keep Gemma as the first default model, with DeepSeek as the existing availability fallback. The measured comparison does not justify replacing Gemma. The prompt now preserves source order, exact numbers, decisions and uncertainty, table cells, and concrete reviewer questions. Confident English/German language detection supplies only the appropriate headings, and the parser rejects mismatched headings. Titles are limited to 80 characters. Sanitization preserves table structure and removes empty sections, including emphasized empty headings.

Gemma improves from 41.7 to 100.0 points with mean latency increasing from 16.1 to 20.0 seconds. DeepSeek falls from 76.7 to 66.7 because both German cases time out in the final run; its four returned drafts pass all rules. The final `npm run eval:intake` therefore correctly exits nonzero for two generation failures. DeepSeek remains only an availability fallback, not the quality or latency recommendation.

No two-stage generation was added: the first improved Gemma run already scored 100 on all six documents, so doubling calls lacked a measured benefit. This is an aggregate improvement across the set, not a claim that every already-perfect baseline sample increased.

The baseline and first improved runs overlapped in time on a shared inference endpoint; their latency is descriptive, not a controlled speed benchmark. The final run started after those runs and the failed language-clarification experiment ended. Single samples at temperature 0.2 do not establish statistical significance. Timeouts are retained, not silently retried.

The checker was corrected to ignore ordinary capitalization at HTML block boundaries and formatted field labels, and to include tag numbers. Every saved draft was rescored with the same final checker and unchanged expectations; original assessments remain in JSON. Lexical failures may include date-format changes or candidate-name false positives, not only invented facts. Zero detected violations is not proof of no hallucinations; the checker does not understand every relation, omitted statement or proper name.

Manual review compares section order, uncertainty and reviewer questions against each fixture. The source constraints to preserve include stock-count uncertainty, rejected automatic publication, equipment quarantine, an unconfirmed migration window, staging-only recovery commands, and proposed retention periods with unchanged table assignments.

## Artifacts and intermediate runs

- [baseline](results/2026-09-09T04-39-25-944Z.json): 12 completed responses. Mean score 59.2.
- [improved](results/2026-09-09T04-41-27-420Z.json): 12 completed responses. Mean score 69.2.
- [language-clarification-aborted](results/2026-09-09T04-51-04-104Z.json): 4 completed responses. Mean score 70.0.
- [final](results/2026-09-09T04-54-36-996Z.json): 12 completed responses. Mean score 83.3.

The aborted language-clarification run retained four completed responses and was stopped before the remaining cases completed. English-to-German translation persisted despite a stronger instruction; that prompted source-specific heading selection. No run attempted more than twelve inference calls. Earlier prompt variants are in `prompts.json`; final rows include their actual system prompt.

## Verification

`npm test`: 221 passed, 17 opt-in database integration tests skipped. `npm run lint` and `npm run build`: passed. Added tests cover lexical fidelity, changed dates/quantities/names, tags, field-label false positives, swapped table rows, table sanitization, empty sections, language routing/rejection, single-model evaluation, usage reporting and the twelve-call cap. No customer data or secrets were added.

GELIEFERT: Eval-Set, Runner, messbar verbesserter Prompt, Sprachprüfung, Nachbearbeitung, Tests und Modellvergleich.
VERIFIZIERT WIE: Live-Auswertung beider Modelle; npm test, npm run lint und npm run build erfolgreich.
OFFEN: DeepSeek hat zwei Timeouts im finalen Lauf; Gemma besteht alle sechs Fälle. Menschliche Freigabe bleibt erforderlich; Faktentreue-Prüfung und Spracherkennung sind Heuristiken. Die 17 opt-in Datenbanktests wurden nicht ausgeführt.
