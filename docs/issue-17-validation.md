# Issue17: completed supported gateway logs

2026-10-04. Local implementation acceptance; one explicit offline profile.
Issue: https://github.com/striges88-bit/jev-codex-experiment/issues/17.
Baseline: `004962b2289455c47fc7c48a0bd9f84b78b3a18a` (#16).

The existing gateway schema2 HTTP models log now has a finite local producer:
one bodyless GET against a loopback fake upstream with policy disabled. Actual
receipt rows are written as JSONL; HTTP completion, terminal receipt and all
stdout write callbacks are awaited. Both listeners close before successful exit.
Writer failure is observable even though the gateway suppresses receipt callback
exceptions. This producer is separate from the test reporter and long-running
gateway daemon.

The closed-profile capture from #16 is shared, with private child/EOF/error/
cancel/timeout witnesses. Tests keep their fixed argv and prior result semantics.
`gateway-http-models-passthrough-v2` currently supports Node24.13.0 only. Fatal
UTF8, final newline, consistent LF/CRLF, exactly three ordered phases and exactly
22 unique fields are required. Lexical validation rejects escaped duplicate keys
and numeric rounding/overflow/underflow before JSON.parse; full semantic checks
reject inconsistent identity, timestamps/latency, status, body hashes and states.

All 22 fields of each row survive in common constants plus ordered event fields:
`{...common,...event}` reconstructs each entire semantic row. Null provider usage
and cost remain unknown. Models transport completion does not establish inference
success. Original serialization and both captured pipes remain exact in the
existing occurrence-specific version1 bundle. Atomic exclusive hardlink publish
and verified final readback precede compact. Required originals have no GC.

## Acceptance

| Criterion | Result | Direct evidence |
|---|---|---|
| A1: freeze grammar, completion and essential fields | PASS | Pre-edit57-file freeze plus real existing-writer golden: three phases/22 fields; complete lexical/semantic parser and fixed producer command |
| A2: provenance/readback and full essential extraction | PASS | Real producer, independently JSON-parsed semantic oracle, lossless common/events reconstruction, twice-read exact original and actual read CLI |
| A3: unsafe received verbatim | PASS | 80 rejected byte/record/field counterexamples; real stderr Unicode warning, unexpected stdout record and invalid UTF8; timeout/cancel/spawn failure; unwitnessed and cross-profile capture; parser/storage/readback faults |
| A4: reuse producer/artifact seams and offline E2E | PASS | Existing atomic store unchanged; fresh log adapter faults/concurrent collision proof; actual CLI consumed by existing responseContext; original and unsafe diagnostic preserved; #16 compatibility suite |
| A5: producer compaction without history pruning | PASS | Existing consumer forwards the entire source request/call/result unchanged, policy disabled; no production gateway/selector/history/native configuration changes |

Checks C01–C07 cover all five criteria. Focused producer/parser/store/consumer/
legacy checks:49/49. Final full
`npm test`:116/116, exit0 (eight added tests: seven log boundary tests and one
existing-consumer test); syntax, diff/source preservation and local Standards/
Spec review PASS. Test fixtures are finite development cases, not the independent
#22 hold-out. Parser rejection tests are separated from actual process faults;
no fabricated completion metadata substitutes for a real child witness.

Actual `exec_command` run returned compact for occurrence
`948fb5ee-f1aa-4b34-9a34-8c98759b621f`; original stdout1712B/stderr0B,
bundle2482B, SHA256 `550e7dac7ab647c6083ee74406eff674270e92a674926db5d2aad3acc9fbd824`.
The existing read CLI and full semantic reconstruction were checked against
that exact bundle. A separate real diagnostic run returned all received JSONL
plus `unknown warning` on stderr as verbatim, with a separate reason. All four
CLI arms (success/stderr/unknown record/invalid bytes) also pass unchanged through
the existing model consumer. Closed negative controls were frozen separately
before their source edits; the positive grammar and command remain unchanged.

## Limits and operational behavior

Windows sandbox denies atomic hardlinks (EPERM), so that run returns exact
received verbatim. The successful NTFS publication/tests use the ordinary
Windows account, with no global permission/config changes. This establishes
complete-file visibility, not power-loss durability. Missing/corrupt originals
are detected; required original retention remains the caller's responsibility.
No global cross-pipe ordering is claimed.

No automatic Desktop interception, history pruning, provider/inference run,
net token/cost/latency savings, pilot or promotion is established. Source grammar
does not include free text; Unicode warnings/unknown text remain unsafe, and
invalid bytes use lossless base64. Existing large Unicode original/readback
regressions run unchanged. No byte cap or arbitrary-command CLI is introduced.

Five local invariants PASS: scope, user state, blast radius, evidenced claims and
secrets. External Jev evaluate stays UNKNOWN under the carried restriction on
exporting internal packets; no new provider lifecycle/HTTP/retry. This review
status is distinct from the direct local implementation acceptance above.

Publication is a Git checkpoint, not activation. GitHub tracking status and final
commit SHA are verified separately after the authorized commit/push. Parent #15
and historical issues remain unchanged. Git profile #18 and all later work require
a separate instruction.

Detailed local evidence: `tasks/issue-17/contract-freeze.json`, `golden.jsonl`,
`npm-test-final.log`, `actual-tool-receipt.json`, `actual-readback-receipt.json`,
`unsafe-tool-receipt.json`, `verification.json`, `review.md`.
