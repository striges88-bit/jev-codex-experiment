# Issue #16: completed test outputs and exact readback

2026-10-04. [Issue](https://github.com/striges88-bit/jev-codex-experiment/issues/16).
Baseline `83092f1`. This is a bounded local implementation, not production
promotion, automatic command interception, or a live measuring pilot.

An explicit `test-output.mjs run` command now captures a real Node test producer,
verifies the complete `node-spec-flat-v1` grammar and publishes a verified
original before returning schema2 compact. It consumes no pre-existing log.
The parser checks every flat success row and the ordered full summary; Node
v24.13.0, terminal exit zero, EOF of both pipes and safe complete capture are
required. Totals/exit zero supplied by a caller are insufficient. Captures retain
private producer witnesses; public-view or storage-adapter edits cannot change
the original used by the gate. Unsafe/unknown outcomes retain received streams
exactly, with an independent reason and completion/command metadata.

The additive `createOriginalStore` publishes a single version1 binary bundle
containing both pipes and provenance. Exclusive staging is closed before atomic
hardlink publication; whole-file and per-stream hashes/lengths are checked by
readback. Occurrence IDs refuse overwrites and distinguish identical captures.
Published originals have no automatic deletion; only staging cleanup is allowed.
Unicode and invalid UTF-8 are preserved as exact bytes. This proves atomic
complete-file visibility on the tested NTFS path, not power-loss durability.
Windows sandbox `EPERM` returns full received data; successful storage checks
used an ordinary-user process, without globally disabling the sandbox.

| Acceptance | Direct evidence |
|---|---|
| A1 | Pre-edit local contract freeze, existing Node spec witness; strict full grammar, envelope and fields |
| A2 | Unicode/large binary readback, stable repeated IDs, complete-file observer, collisions/concurrent publication |
| A3 | Real completed successful producer plus full extraction; counts-only, forged completion and inconsistent records rejected |
| A4 | Real failures/diagnostics/unknown stdout/invalid bytes/skip/todo/nesting, cancellation/timeout/spawn failure; storage/readback faults preserve received data |
| A5 | Same producer CLI called through actual `exec_command`; existing `responseContext` fixture consumes its stdout as a function-call result, preserving settings/history/correlation; exact CLI readback |
| A6 | Existing helper/schema1 CLI unchanged, explicit partial view and `reported_passed` retained; offline regression checks |

Verification: `node --check` for the four changed/new JS modules; focused tests;
`npm test` **108/108**, exit0; `git diff --check`; unchanged baseline source hashes
outside the declared implementation/docs/test allowlist. Nine new test cases
contain parser counterexamples, real producer outcomes, persistence faults and
legacy CLI coverage; one additional consumer test uses compact and verbatim arms.
These development cases are finite evidence, not the independent #22 hold-out.

Local code review covers both Standards and Spec. No remaining findings within
the declared scope. Detailed freeze, logs, actual tool receipt/readback,
preservation checks and acceptance report remain in ignored `tasks/issue-16/`.
They contain local command paths and are not included in public publication.

Limitations: the first profile rejects additional Node versions/dialects, nested
suites and unknown diagnostics. Both pipes are exact separately; cross-pipe
interleaving is unavailable. Host call correlation and automatic Desktop
interception are unavailable. The local producer result and offline consumer
fixture are separate from live gateway attribution. No token/latency/savings
claim, global config change, provider call, automatic apply or pilot occurred.
Main external evaluation remains UNKNOWN under the carried packet restriction;
local acceptance facts and all five invariants are verified independently.
