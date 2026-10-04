# Issue #18: one completed read-only Git status profile

Verified 2026-10-05 against baseline `9e2be389f95ea10fa4063caf0817dd06312f539a`.
Scope: explicit local completed producer → strict extraction → atomic original
and exact readback → existing model-input consumer fixture.

## Acceptance

| ID | Result | Direct evidence |
|---|---|---|
| A1 | PASS | Pre-edit command/version/env/root/grammar/XY/fields/private-witness freeze; one fixed Git2.56.0.windows.1 porcelain-v1 -z status argv, Node24.13.0. Real version and root probes; inherited Git overrides cannot redirect command. |
| A2 | PASS | Literal ordered clean/dirty oracle, all23 supported XY codes, destination/source rename boundaries, Unicode/spaces/leading dash; synthetic POSIX controls/quotes/backslash/arrows/BOM and exact readback. All records retained, no sorting/dedup/top-N. |
| A3 | PASS | Actual Git close/exit0/both EOFs/private buffers; closed atomic publication before compact. Actual exec_command dirty result, exact generic read CLI twice, unchanged request/history/call IDs through existing responseContext. Empty clean requires witnessed actual producer and reliable original. |
| A4 | PASS | All7 conflict codes and26 byte/status adversaries rejected; real conflict and exit0 mixed stdout/stderr warning, nonrepository/missing cwd/cancel/timeout,11 forged views and edited actual capture. Parser/select injection blocked. Storage/readback/collision/concurrency/mutating adapter faults preserve received and no false original/clean. |
| A5 | PASS | Offline filesystem-only Git fixtures, read-only Git commands/index verification; existing #16/#17/legacy tests and historical originals preserved. No product Git writes/global config/history/policy/pilot change. |

## Verification

- Changed-path producer/parser/store/consumer and #16/#17 regressions:59/59,
  exit0 before final added synthetic-control readback case. Final full
  `npm test`:127/127, exit0 (11 new tests beyond #17's116).
- Five changed/new JavaScript files pass `node --check`; working and final
  new-file whitespace checks pass; the final staged diff check is mandatory
  before publication. Unrelated baseline
  sources and main `.git/index`, HEAD, config and main ref preserved before
  the separately authorized publication checkpoint.
- Local Standards and Spec review against the pinned baseline:PASS, no
  outstanding findings. Review includes added files, not only tracked diff.
- Literal parser matrix23 positives;26 rejected byte/status cases includes7
  unmerged, copy/ignored/lowercase/clean-invalid/unknown codes, malformed
  prefixes/NUL/rename source/suffix/header/warning and invalid UTF8.
- 4000 complete synthetic records and250 real nonignored untracked files;
  four actual CLI consumer arms:clean/dirty/conflict/nonrepository. Real staged,
  unstaged, deletion and rename; type-change/control filenames synthetic.
- Filesystem fixture writer constructs finite known blobs/tree/commit/index;
  no Git init/add/commit/reset/config/update-index/fetch/push in product or tests.
  Optional JEVX index extension with correct checksum yields a real Git warning
  alongside valid stdout at exit0. Both streams remain verbatim.
- Published original from actual dirty tool occurrence:
  `1472a62a-91f7-4a73-a871-4d62c33d00ac`,123 stdout bytes/0 stderr bytes,
  bundle2169 bytes/SHA256
  `66ba99e23b4cc24f68c1c32f5fc8bd969f785b56a4dd39f27e65daed9612cdfe`.
  Both exact readbacks preserve all five records and provenance. Prior #16/#17
  required originals remain readable with their original hashes.

## Limits

Finite development checks apply only to this fixed profile/version and these
cases; they are not independent hold-out #22. POSIX-only filenames and invalid
UTF8 are synthetic byte evidence; Windows runtime names follow NTFS limits.
Other versions remain unsupported. Actual executable replacement, pipe failure
and host truncation are not induced against the installed host: their gates are
reviewed and forged views rejected; no broad fault-coverage claim is made.

Sandbox realpath/hardlink restrictions return full fallback; ordinary-user NTFS
verification uses the same code. Atomic complete-file visibility does not prove
power-loss durability or prevent later artifact removal. Concurrent Git writers
can change state during traversal; clean is an observed run, not a snapshot.

Structured JSON/provenance can exceed a small raw porcelain stream or bundle.
No net token/cost/latency saving is established; readback frequency and primary
inference attribution remain unmeasured. Fallback retains diagnostics
deliberately. No live provider/pilot, automatic interception, general apply or
native history reduction was performed. Host history integration remains blocked.
External main evaluate is UNKNOWN under the carried internal-packet export
restriction; no new provider HTTP, lifecycle or retry. Five critical invariants
are verified locally; external UNKNOWN is separate from local A1–A5 PASS.

Publication is a reviewed user-authorized commit/push checkpoint, distinct from
read-only product behavior. Parent #15 and historical issues remain unchanged.
Completion stops at #18; subsequent tickets and promotion require their own gates.
