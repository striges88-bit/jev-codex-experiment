# Issue #19: checkpoint and ordered completion plan

2026-10-06. [Issue #19](https://github.com/striges88-bit/jev-codex-experiment/issues/19) remains **PARTIAL / OPEN**: five original criteria are checked, the final criterion is unchecked. The user extended closure to a successful narrow Desktop/WS pilot. Keep that additional gate explicit; the original offline criterion is not rewritten as a completed live result.

## Published implementation checkpoint

- Sourced task state and exact occurrence-specific duplicate proof retain the original #19 contracts.
- The approved [source-first architecture](adr/0001-source-first-native-pilot.md) adds current-request state-only preparation, durable initial reservation, stable insertion, same-connection continuation and revoke handling. It grants no duplicate removal.
- Both approved architecture improvements are included: one shared inventory/scope/binding module with compatible old exports; one complete validation at the final WS sink, while retaining post-preparation and sink guards.
- Verification: `node --test integration/main-gateway.test.mjs integration/websocket-context.test.mjs integration/context-quality.test.mjs` **184/184 PASS**; `npm test` **271/271 PASS**, exit 0, no skips. Syntax, extracted-contract equivalence, import graph and diff checks are recorded in the publication checkpoint. These are offline/loopback results, including Windows fixture read-denial and actual local WS writes, not live Desktop/provider proof.
- The historical 231/231 and 266/266 results remain dated evidence. No performance benefit or production readiness follows from a test count.

## Required next order

| Step | Work and completion condition |
|---|---|
| 1. Reconcile and publish | Commit the reviewed code, ADR and this plan; synchronize #19 and parent #15. Leave the final marker unchecked and both issues open. This is a code/documentation checkpoint, not pilot activation. |
| 2. Prove duplicate feasibility locally | Identify an existing native interchangeable pair with full provenance, or prepare a **separately declared controlled Desktop/WS source and placement scope**. Verify actual whole-group equality, candidate eligibility outside recent eight/protected groups, canonical retention, sourced state, exact originals/readbacks and occurrence-specific permission. Equal text or a fabricated fixture is insufficient. The existing separate-client controlled HTTP grant does not cover controlled placement in Desktop. If a narrow coordinator extension is needed, implement and test it before presenting the executable packet. Do not start another capture to search blindly for a pair. |
| 3. Freeze the complete native protocol | After feasible offline proof, prepare a new packet against the committed code and current owned route. Include source type, allowed transformations, thread/scope/current-request binding rules, limits/spent reservation, all LP cases, safety stop, secret preflight, owned idle activation and verified return. Declare the in-memory history-comparison method and the lack of whole-transcript replay. Old packets are historical/stale; old attempts remain spent. |
| 4. Obtain exact execution approval | Present the complete executable packet and human steps. Exact launch/apply approval is separate from preparation/publication consent. Until granted, runtime stays unconfigured and ordinary #19 filter stays disabled. No expiry refresh, guard relaxation or additional trial is implicit. |
| 5. Execute at the owned idle boundary | Exit Desktop, run the reviewed transition, reopen the same chat and verify the actual gateway version/owner. Run sourced state, permitted removal, new identical occurrence retention, protected/recent-eight preservation and confirmed continuation. Then revoke under otherwise active authority and verify the next write/completion on the same connection restores the full known original chain. Unknown chains must stop safely. |
| 6. Return, audit and close conditionally | Verify revoked/closed pilot, ordinary apply disabled, owned normal gateway/autostart and preserved current settings. Audit every LP below. Fetch complete fresh issue/body/comments; only if every mandatory result is PASS, publish evidence, mark the exact final criterion and close #19 as completed, then read back. Any FAIL/UNKNOWN leaves it OPEN with the precise gap. Publish any additional implementation changes only after their applicable Git authorization and checks. |

## Native acceptance matrix

| ID | Required evidence | Current status for the new path |
|---|---|---|
| LP01 | Sourced state in actual own-chat sink payload; all original items preserved; exact source readbacks and correlated provider completion | NOT_PROVEN |
| LP02 | Permitted interchangeable candidate removed, canonical retained; new identical occurrence gets no inherited permission; declared provenance/source scope | NOT_PROVEN; state-only packet cannot cover it |
| LP03 | Exact ordered preservation of protected items/groups/recent eight and source originals | NOT_PROVEN natively; offline PASS |
| LP04 | Same-connection revoke, full known original reconstruction or safe unknown-chain stop, actual next write and completion | NOT_PROVEN natively; isolated offline revoke PASS |
| LP05 | End with revoked pilot/ordinary apply disabled, verified owner/return/autostart/current configuration | New-run return pending; earlier returns are dated evidence |
| LP06 | Full per-ID audit; no mandatory FAIL/UNKNOWN becomes PASS; fresh GitHub readback before closure | Gate retained; closure not authorized by current evidence |

LP01/LP03 use full ordered comparison in gateway memory and correlated receipts, plus durable chosen-source readback. **No full conversation archive or later independent transcript replay is provided.** The evidence method was approved explicitly; mandatory behavior and the remaining LP requirements are preserved.

## Position in the project

After #19 closes: **#20 full supersession → #21 frozen-contract evaluate → #22 independent offline hold-out → #23 shadow and measuring packet → #24 bounded measuring pilot/sample-plan freeze → #25 final hold-out and production decision**. This narrow #19 pilot checks functionality; it does not replace the statistical quality/efficiency or promotion gates. Parent #15 stays open until its own requirements pass. #23 must carry the declared evidence-method limit into its future packet.

Detailed originals, histories, configuration, grants, spent markers and raw logs remain local. Public evidence describes the declared scope and outcomes without exposing those artifacts.
