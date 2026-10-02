# Issue #4: shadow context recommendations

Verified 2026-10-02 against [issue #4](https://github.com/striges88-bit/jev-codex-experiment/issues/4). Additive `jev_shadow_filter` v1 exposes ordered sanitized recommendations without applying them. The original begin/Choice/end payloads remain compatible; the same process-local budget and transport are reused. No global settings or launcher changes.

Noul's `noul` field maps directly to `p_unneeded` using an explicit question about unneededness, independently of confidence. Wire shape checked against the [official API reference](https://docs.typesafe.ai/api). The 0.9 threshold is experimental: `would_exclude` is only an observation, `applied=false` in every branch.

| Criterion | Evidence | Result |
| --- | --- | --- |
| A1: Noul semantics and synthetic live | S01/S05 external mapping/type/range controls; S15 live stdio | PASS |
| A2: experimental threshold; exclusion disabled | S02 0.899999/0.9/1 and rejected overrides; S14 full consumer payload | PASS |
| A3: protected instructions, requirements, unfinished state; originals/full context | S03/S04/S10/S11/S13/S14/S15; all three kinds protected, complete state in every POST, consumer context hashes preserved | PASS |
| A4: bounded batching and shared remaining budget; explicit fallback | S06–S12; size/requests/time/queue/lifecycle/partial-response controls | PASS |
| A5: verifiable fragment IDs and sanitized MCP output without raw persistence | S01/S03/S05/S09/S11/S12/S13/S15; real executable process isolation | PASS |

Offline: `npm test` — 27/27 PASS, no skips. Includes existing Choice regression controls plus thirteen shadow controls and executable process validation. `node --check` on changed/new JavaScript and `git diff --check` PASS. Test injection remains inaccessible through production MCP arguments.

Coverage: S01 discovery/valid mapping; S02 exact threshold; S03 protected metadata/zero HTTP/downgrade rejection; S04 Unicode/escaping/duplicates/ordered full state; S05 invalid/missing/extra answers and nonfinite numbers; S06 8-question packing, 64 candidates, exact POST/args/response limits and frame regression; S07 mixed Choice/shadow and request preflight; S08 deadlines/fractional remaining time/actual overrun; S09 later-packet failure/close/TTL/restart; S10 mixed queue/cancellation; S11 secrets and fixed transport/errors; S12 trustworthy usage aggregation; S13 isolated executable sanitization/no files; S14 preserved consumer inventory and old Choice projection; S15 synthetic live.

Synthetic live: `node integration/shadow-live-smoke.mjs` through the unchanged Windows encrypted launcher and stdio MCP. One actual HTTP, 743.6066 ms of monotonic headers+body wait; 672 input/38 output tokens. Cost and subagent runtime unknown. Three protected kinds received null probability/`protected`; eligible `arithmetic` and `unrelated` mapped to 0.93 and 0.97. Both observations were `would_exclude`; complete launch inventory was still retained. Context SHA256 before/after: `1d77a89daaea4727cd87e168d9e3208b5ac655b1785640c98bcdaf900a706c63`. Task hash preserved; lifecycle closed after one request. Only sanitized envelope/hash evidence was explicitly saved locally; no raw provider response or context persistence was introduced in MCP.

Initial restricted execution terminated before initialize and had no provider result; permitted ordinary-account execution PASS. The boundary failure did not justify modifying the launcher or credentials. Existing budget, transport, encrypted launcher, original live Choice smoke and process client hashes match accepted #2. Changed schema/discovery/Choice entry wiring and tests were regression checked. Accepted #3 dispatch evidence is reused for unchanged paths; its live subagent run and publication were not repeated. Settings hashes match the current preparation baseline.

Review: Standards — PASS, no actionable finding; Spec — PASS across A1–A5/S01–S15. Local diff reviewed against main baseline `c9f0f30095e29057193ba94f27fe6d086e62bf26`, including new files. No added dependency, actual filtering, scoring, automatic retry, alternate provider or global policy changes.

Limits: callers verify provenance; metadata validation cannot detect intentionally misclassified instructions. This proves integration and declared shadow behavior, not calibrated reliability, general quality improvement or provider retention. Real task materials await privacy/retention review. Actual exclusion, Score/invariants and experimental calibration remain later issues. Desktop discovery of the fourth tool is additional optional evidence; mandatory #4 acceptance used real stdio, live Noul and a local consumer, with no new chat or subagent.
