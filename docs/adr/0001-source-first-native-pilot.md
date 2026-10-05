# ADR 0001: Source-first preparation at the current request

Date: 2026-10-06. Decision: approved; implementation verified offline. Native acceptance remains pending. Applies to [issue #19](https://github.com/striges88-bit/jev-codex-experiment/issues/19), under the unchanged [v1 requirements](../context-quality-v1.md).

## Problem

Capturing and freezing an entire Desktop request did not provide authority for a later changed request. Capture attempts stopped at the existing secret guard; their exact historical trigger is unknown. A dated native inventory also had no eligible interchangeable duplicate. Fixing capture alone would therefore not complete acceptance.

## Decision

Reuse the existing gateway and its connection-local original-history reconstruction. Freeze chosen source originals, sourced task state, task/thread/scope, code, expiry and attempt rules. A trusted local coordinator constructs and checks exact inventory binding against the actual complete request when handling it. Incoming content or metadata cannot install that coordinator or grant permission.

The additive pilot packet schema2 currently supports **state-only**. It reserves one initial attempt durably before inventory/readback, binds its spent path, and allows only verified continuation on the same connection under the active grant. State insertion stays at its initial position so unchanged selected prefixes can reuse native deltas. Explicit revoke restores a known original chain; an unknown filtered chain stops before write. Normal launch configuration does not enable this path.

Chosen source originals remain durable and independently readable. Complete original/selected history is compared in order inside gateway memory, with actual sink payload verification and correlated completion receipts. **The full conversation is not archived for later independent replay.** The user approved this LP01/LP03 evidence-method amendment; each future executable packet must declare it. It does not waive source readback, protection, actual-write, completion or revoke requirements.

## Small architecture changes

`main-context-contract.mjs` owns inventory, scope, binding and the model-visible state representation. Selectors, proof verification and the pilot use this shared contract; the existing exports from `main-context.mjs` and `context-quality.mjs` remain compatible. This removes their mutual import without changing grouping, hashes or protection rules.

At the WS sink, `verifyForwarded` already performs source/authority validation. Use it once when present; retain `validateOriginals` for other branches. The post-preparation check and final sink check both remain, including after backpressure. This removes an adjacent repeated check, not an authorization boundary. Performance improvement is unmeasured.

The shared contract is included in pilot code hashes. Old code-pinned packets become stale after these changes, and spent attempts remain spent. Packet field schemas, sourced-state format, occurrence permission, original store, tests/logs/Git producers and evaluator contracts retain their behavior.

## Consequences and limits

No whole-transcript capture dependency or new proxy/storage framework is introduced. Connection loss/restart does not recover old pilot authority or an unknown selected chain. State-only cannot prove duplicate removal: LP02 still needs a reviewable source, actual interchangeable occurrence provenance and permission. Controlled HTTP evidence does not prove Desktop/WS acceptance or a naturally occurring duplicate.

Closure of #19 requires the complete agreed narrow native matrix. Publication does not activate a pilot, prove efficiency, complete independent hold-out or promote production. [The ordered completion plan](../issue-19-completion-plan.md) records the remaining work; #20–#25 keep their existing requirements and dependencies.
