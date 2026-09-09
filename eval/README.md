# Draft quality & eval

Run `CHUTES_API_KEY=… npm run eval:intake` with the key supplied by your environment (do not paste it into shell history). `INTAKE_MODELS` selects a comma-separated list; the default compares `google/gemma-4-31B-turbo-TEE` with `deepseek-ai/DeepSeek-V3.2-TEE`. `EVAL_LABEL` labels a run. The catalog was checked through the authenticated Chutes models endpoint before measuring.

The runner imports the **real** `generateDraft` TypeScript function through a small TypeScript loader. It pins each request to one model, disables fallback for that request, and sends the same production prompt, temperature, token budget and timeout. Six documents × two models = twelve requests maximum; larger runs are rejected before inference. Requests are sequential within a run, with no retry. HTTP 429 stops the run. Results are checkpointed after every response, including failures. A generation failure has score 0; missing token usage is `null`, never an estimate. Exit status is nonzero for generation failures or rate limiting.

Only the six fictional fixtures are submitted. Results include their generated drafts, source hashes, pipeline hash, scores, milliseconds and the provider's total token usage. The runner neither publishes a page nor touches the database. Never replace committed fixtures/results with customer material or credentials. `results/<timestamp>.json` is intentionally versioned.

## Evaluation rules

Each document in `expectations.json` has heading bounds, required terms, forbidden invented facts, a table requirement, at least three specific manual reviewer checks, a source language, known proper names and an 80-character title limit. The documents contain 348–400 whitespace-delimited words each, including headings. They cover onboarding, meeting decisions, a German process, an email thread, a staging runbook, and a German policy table.

The score is out of 100: title 10, heading bounds 10, required terms 20, lexical fact fidelity 30, table preservation 10, reviewer list of at least three items 10, and localized opening/closing headings 10. Table comparison checks complete ordered cells within each row, so swapped assignments fail. Source section order, full language consistency and the relevance of the reviewer checklist also require human review against `reviewerShouldCheck`; the score does not pretend to judge these semantically.

The fact checker matches numbers, ISO dates, times, signs, percentages and decimals exactly against source tokens, including numbers in titles and tags. It checks forbidden phrases and candidate names/acronyms. It tolerates ordinary capitalization changes and HTML block boundaries. Candidate-name detection is heuristic, especially for German: ordinary capitalized nouns are not entities. It cannot prove that every name was found, or detect all altered relationships, changed units, negations, spelled-out numbers, omissions, or promises expressed in different words. Zero detected violations is **not** proof of no hallucinations; human approval remains mandatory. Exact-date formatting changes are fidelity violations even when they denote the same calendar date.

`node eval/rescore.mjs` applies the current checker to saved drafts without inference, verifies the source hashes, preserves original assessments, and stamps checker/expectation hashes. This was used to apply the same capitalization/HTML-boundary fixes and tag check to both measured runs. It does not change generated text or latency.

## Interpretation

See [Measured comparison](REPORT.md) for baseline and final tables, model choice and limitations. Single samples at temperature 0.2 are diagnostic, not statistically significant benchmarks. Availability, shared endpoint load and request timeouts influence latency and aggregate scores. A second generation stage was not added: it doubles calls and needs evidence of a quality benefit first.

## Source language regression

The first expanded prompt listed both English and German heading examples. DeepSeek translated English fixtures into German despite the language instruction; a stronger instruction alone did not fix that, so the partial `language-clarification-aborted` run is retained. The final pipeline uses high-confidence English/German stopword counts (at least eight matches and a greater-than-two-to-one margin) to put only the matching headings into the prompt. The parser rejects mismatched headings for those confidently identified sources. Short or mixed sources are left unspecified; language detection is not a general multilingual classifier. Final results save the actual per-document system prompt, and `prompts.json` preserves earlier prompt variants.
