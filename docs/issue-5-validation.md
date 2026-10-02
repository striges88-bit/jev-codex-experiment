# Issue #5 validation

Completed-result evaluation adds `jev_evaluate` to the existing stdio MCP: three rubric-based Score dimensions, five positive Noul estimates, and a trusted local main-agent evidence/repair coordinator. The original four payloads and existing budget/transport are preserved.

Verified 2026-10-02 against the issue's eight acceptance criteria and the prepared contract, including its explicitly approved Score compatibility revision. Baseline: `2ba45cd6c8b298248bed812331089c23132cdc5b` on main. Offline `npm test`: 47/47 PASS. Syntax checks and `git diff --check`: PASS. Global settings, launcher, transport, budget, existing shadow behavior and unrelated originals preserved.

| Scenario | Evidence and accepted behavior |
| --- | --- |
| E01 | MCP discovery adds evaluation; all existing Choice/shadow/process regressions pass. |
| E02 | Three dimensions, fixed quality-v1 levels, raw0/2.5/4 → normalized0/.625/1; no quality gate. |
| E03 | Invalid type/range/legend/probabilities/confidence rejected. Approved discrepancy boundary0.055 accepted; +.000001 rejected; raw/distribution/diagnostic retained. |
| E04 | Five positive Noul keys, p0/.5/1 mapping; local pass remains independent, including p1/false and p0/true. |
| E05 | Eight questions fit one POST; larger synthetic full state splits only question groups, without truncation; plan beyond remaining budget sends no HTTP. |
| E06 | Missing/extra/bad answers and late packet errors invalidate all estimates. |
| E07 | Actual local source readbacks cover compliance, counterexample, partial log, unavailable source and hash drift. Missing commands in a partial log are unknown. |
| E08 | Main reviewer callback and exact snapshot/readback bindings; assertions from another role or stale/null evidence cannot grant pass. |
| E09 | Exact12000-byte POST/+1, UTF-8/escaping, argument/frame/response limits, secret patterns/loaded key/final POST, nested overrides and protection downgrade covered. Unchanged parser/transport bounds also covered by C06 regression. |
| E10 | One owner across Choice/shadow/evaluation; request29/30/31, split preflight, remaining5001/1/<1, timeout and actual overrun accounting. |
| E11 | Queue, in-flight/queued cancellation, close, TTL and restarted owner cannot accept late results or revive lifecycle. |
| E12 |401/429/500/redirect/network/JSON/oversize/missing-key cases; executable stdio evaluation exposes no raw material/key/provider body and writes no state files. |
| E13 | One actual callback for all confirmed violations; compliance stops; unknown/low quality never repairs; repeated violation/unknown/error returns to main. |
| E14 | Concurrent/repeated coordinator calls share terminal state; no second repair; authority, scope/context/ID and live remaining budget checked; unrelated bytes preserved. |
| E15 | Each attempt retains call measurements and cumulative budget; totals are separate. Missing/partial/overflow/unavailable usage remains null. Local callback time is an explicit upper bound; native runtime and cost remain null. |
| E16 | Synthetic encrypted-launcher stdio begin/evaluate/end; real Score/Noul mapped and locally reviewed; owner closed in finally. |
| E17 | Seeded JSON5 → local failing arithmetic command → one actual permitted correction to4 → successful command/re-evaluation; unchanged sentinel/full context. Executor is local main-agent callback; no new native launch is claimed. |

The accepted synthetic control used two HTTP requests, 1151.7554ms TypeSafe waiting, provider usage3196 input/294 output tokens. Repair callback elapsed45.1598ms is an upper bound for local execution, separate from TypeSafe waiting. Native subagent runtime and price are unknown/null. Final state: compliant, repair attempts1, owner closed with28 requests remaining. Local artifacts retain exact per-attempt results, safe checks and hashes.

An initial strict Score check rejected raw0.53 versus weighted0.51. The user explicitly approved weighted consistency tolerance0.055 with retained raw/distribution/diagnostic; probability sum tolerance remains1e-6 and all fact-pass rules remain unchanged. The tolerance is a local wire-compatibility policy for possible rounding, not proof of provider precision or accuracy. [Official API semantics](https://docs.typesafe.ai/api) distinguish probability-weighted Score and Noul yes probability.

A separate control had a valid initial estimate, completed exactly one actual correction, then rejected the re-evaluation as invalid_score and returned unknown to main, without a second repair. Such fallback is preserved as historical PARTIAL evidence; it is never converted into success. The accepted later independent control had valid estimates at both attempts. There are no automatic retries or budget/repair bypasses.

## Standards review

PASS; no unresolved findings. Changes reuse the existing module/factory, strict schemas, transport and owner queue, add no dependency or global configuration, preserve unrelated state. Local exceptions and evidence failures fail closed. Detailed plans/raw test output remain local and ignored.

## Spec review

PASS for A1–A8 under the approved compatibility revision. Review corrections ensure malformed budget cannot enable repair, unavailable client counters stay unknown, every numerical attempt is retained, and local callback elapsed time is not mislabeled as native subagent runtime. All have regression evidence. Final unresolved findings:0.

Limitations: synthetic controls prove the bounded interface and local correction workflow; they do not establish provider accuracy, durable recovery, privacy/retention, calibration, general routing improvement or permission to apply filtering. Truth/completeness of factual reviews remains the main agent's responsibility. Restart continuity without verified state never repairs. Real-material review and calibration remain separate #6/#7 stages. Parent #1 is not closed by this child.
