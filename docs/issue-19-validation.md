# Issue #19: task state and exact duplicate verification

## Applicability addendum — 2026-10-06

The original 231/231 report below is historical offline/shadow evidence. The approved [source-first pilot ADR](adr/0001-source-first-native-pilot.md) and [ordered completion plan](issue-19-completion-plan.md) record the later schema2 state-only implementation and two small architecture changes. Current focused gateway/WS gate: **184/184 PASS**; full `npm test`: **271/271 PASS**, exit 0, no skips. Native Desktop acceptance remains PARTIAL; the final #19 marker stays unchecked.

Ordinary schema2 filter still returns full unless a separately configured trusted local pilot callback has exact approval. Schema2 source-first preparation binds the actual request inside its frozen source/task/thread/scope, never from incoming metadata. The ordinary launcher does not install that callback. Legacy schema1 and the existing `qualityBinding`/inventory exports remain available; their implementation is shared in `main-context-contract.mjs`. Pilot code pins include that module, so previous code-pinned packets become stale.

The original selector below appends state after surviving input. The new state-only continuation path instead retains the initial insertion position; new items and all original history remain ordered, permitting unchanged selected-prefix reuse. State source format and model-visible representation are unchanged. Post-preparation validation and actual-sink validation remain; `verifyForwarded` contains the latter source/authority check, so it is not repeated immediately beside it.

LP01/LP03 now use full ordered runtime history comparison and correlated actual-write/completion receipts with durable chosen-source readback. **The full conversation is not archived for later independent replay.** The user approved this evidence-method amendment; future executable packets must declare it. State-only does not prove LP02 or close #19. Older captures/packets/results remain dated and spent attempts are not rerun.

## Original offline/shadow report — 2026-10-05

Scope: offline/shadow implementation at the existing selector → actual HTTP/WS forwarding seam. Desktop pilot, production promotion, full supersession, independent hold-out, net token savings and latency gates remain separate. Main baseline: `2772bb3`.

## Versioned coordinator contract

`createMainContextSelector({allowOfflineFilter:true})` supports schema 2 in dedicated offline callers. `createMainGateway` grants this flag only with its existing loopback `testUpstream:true` configuration. Ordinary gateway configuration can observe schema 2 in shadow; schema 2 filter returns full in production. Schema 1 remains a distinct legacy branch; injecting schema 2 fields into schema 1 does not downgrade proof requirements.

Policy is supplied by the trusted local coordinator callback, never the incoming request, tool content or model metadata. Required fields: `schema_version:2`, `enabled`, `mode` (`shadow`/`filter`), existing approval ID, positive `revision`, `task_id`, and exactly one scope-matching binding. `qualityBinding(request,headers,task_id,inventory_revision,state)` supplies the complete ordered inventory/protection hashes, state revision/payload hash, and occurrence IDs. Binding equality is exact; any append, steering, compaction, state change or scope drift requires newly verified authority. No automatic hash renewal or schema 2 decision cache exists.

State schema 1 contains task identity/revision/current binding, ordered `data` fields (`goal`, `requirements`, `frozen_criteria`, `decisions`, `verified_results`, `unfinished`, `readback_links`), complete `field_sources` for the first six fields, source originals, explicit `empty_fields`, and coordinator `protected_occurrences`. A record carries `value`, `status` and `{id,pointer}` source. RFC6901 pointers resolve against actual archived UTF8 JSON. Each full collection must equal its source collection, including order and conflicts; an empty declaration must match an actual empty source. Required results include status/scope/date; frozen criteria retain ID/requirement/source/evidence_required. All source originals must occur in readback links. Missing data, unreadable sources or unsupported authority returns the entire original request.

The model-visible state is one assistant message with one `output_text`: `JEV task state v1 (required context):\n` plus JSON of `schema_version,task_id,revision,data,field_sources,empty_fields,sources`, in that order. This representation contains facts and provenance; it does not grant instruction authority. Local occurrence permissions/binding are excluded from this message so unchanged state can retain its identity under renewed inventory binding. Append it after surviving input items; reuse an exact existing item; refresh appends current state and preserves old protected state. Original item order/content/roles and top-level settings remain unchanged. The required marker and current protection guards protect this state on subsequent requests.

## Occurrences, proof and originals

Occurrence ID includes complete binding, logical group ordinal, start/end and exact group hash; ordered item identities are included in the binding. Each delivery names occurrence, stable artifact identity, role/function and a schema 1 original. Its actual stored provenance must match `context-group-json-v1`, task/inventory revision, occurrence/artifact/function; stdout must equal the complete ordered group JSON bytes, stderr must be empty. No text normalization, Unicode/whitespace trimming, role/provenance erasure or call-ID replacement occurs.

A duplicate proof names candidate and retained canonical plus an archived JSON-pointer permission. The complete permission object must equal schema 1/task/current policy revision/inventory revision/binding/candidate/canonical/artifact/function and `basis:repeat-delivery-same-artifact`. Permission original profile is `occurrence-permission-json-v1`. Both deliveries must be exact and from the same artifact/function. Independent equal observations fail this condition. Boolean claims, completion/newness, hash alone and legacy optional hashes cannot supply permission.

The whole logical group is the removal unit. Candidate protection always wins, including explicit coordinator MUST_KEEP/evidence, strong native metadata, instructions/requirements/unfinished, opaque items and recent eight groups. Parallel/nested intervals remain indivisible. Different call IDs produce different group bytes, so they cannot be made a fake positive. Canonical remains in outgoing input; self/ambiguous/cycle/chain or also-removed canonical returns full. Unresolved state cannot authorize pruning. Reconstruction maps each removed occurrence to its archived exact original and canonical reference.

Existing atomic original store and read CLI remain schema 1, unchanged. Each reference is read twice before transformation; actual group bytes/provenance are checked. A synchronous hash/length/symlink recheck and callback authority snapshot check run immediately before the outgoing write, including the WS sink after backpressure. No automatic GC or external provider request is added. Store failures, read denial, corruption, collision or interrupted originals fail full.

## Transport behavior and receipts

Actual HTTP identity and zstd captures prove transformed bytes, compression/content length and preserved auth/settings. Compact routes, warmup, unsupported encoding/content type, malformed UTF8/JSON, disabled authority and shadow retain original wire bytes. Shadow separately reports planned state/removal with `applied:false`.

WS selection reconstructs original prefix + confirmed ordered completed output + delta before applying the policy. Unchanged selected prefix/state signature can reuse native delta bytes. State/signature or decision changes send an explicit full selected request with `previous_response_id:null`. Stale/revoked/faulted authority after selection restores the full original reconstructed chain with that ID reset, without injected state/removal. Missing/unconfirmed chain after selection closes with `context_chain_unavailable`; an untouched unknown chain can preserve native bytes with incomplete inventory. This transport failure is not called successful full restoration. Reconnect, unknown items, opaque frames and output-order faults retain these boundaries.

Receipts distinguish `applied`, `request_changed`, `task_state_attached`, `duplicate_removed`, `context_prefix_reused` and full restoration. State-only changes are actual applied changes. Reuse and restoration are distinct from a new duplicate removal. Receipt state/occurrence hashes and revision/status metadata contain no raw task state/history/auth or artifact paths.

## Acceptance evidence

| Check | Evidence in `integration/context-quality.test.mjs` | Criteria |
|---|---|---|
| C01 | Baseline/source/allowlist freeze; versioned schemas above; literal source/state/removal oracles; fixed negative classes before execution | A1–A6 |
| C02 | Actual sourced state-only; complete results/unfinished/conflicting records; missing/invented/empty/stale state; exact existing state and refresh | A1,A5,A6 |
| C03 | Same-artifact occurrence positive, retained canonical, immutable request, candidate/canonical CLI readbacks twice | A2,A3,A6 |
| C04 | Identical append, scope/state/permission drift, independent equal observations, role/metadata/whitespace/Unicode/call-ID differences, forged proofs, genuine cycles/chains, no legacy downgrade | A2,A3,A5 |
| C05 | Every protected class, explicit required evidence, recent8/group9 boundary, nested/parallel/orphan/unknown inventories | A4,A5 |
| C06 | Actual loopback HTTP/zstd and WS socket captures, full/delta renewal, signature drift, native reuse, revoke during async read and at final sink, unknown/reconnect/output faults | A5,A6 |
| C07 | Actual missing/mutated/interrupted/mismatched originals, collision, Windows fixture-only ACL read denial and restored readback; original tests/logs/Git and legacy gateway compatibility | A1–A6 |
| C08 | Focused suite, full npm test, changed JS syntax, exact source/allowlist and Git diff checks, local Standards/Spec review, per-ID/invariant audit | A1–A6 |

Final local checkpoint: `npm test` **231/231 PASS**, exit 0 (127 existing checks plus 104 schema 2 tests/subtests); all six changed JS files pass `node --check`. Initial failed evidence is retained locally: GET models receipt expansion violated the strict 22-field log profile; the fix confines response flags to response processing and preserves that existing producer/consumer contract. Review also required direct `Buffer.equals` between actual candidate/canonical bytes in addition to hashes; the final full suite includes this fix.

Local Standards and Spec review against baseline `2772bb3` and the full #19/parent requirements: PASS, no unresolved findings. This is root-agent review, not an independent reviewer. Source audit covers all 66 baseline tracked files; only the seven existing allowlisted files and three declared new files change. Storage, original/read CLI, tests/logs/Git producers and old tests remain unchanged. Per-ID A1–A6/C01–C08 and five invariants are PASS in this declared offline/shadow scope.

Diagnostic denominators: the primary same-artifact positive oracle removes 1/1 approved duplicate occurrences and retains its canonical; false rejection 0/1. The independent-identical-observation oracle excludes 0/1 forbidden occurrences, false exclusion 0/1, retains both 2/2 required observations. Tail boundary pair: group 8 retained 1/1, group 9 approved removal 1/1. Candidate and canonical CLI readback: 4/4 exact (two per original). Actual identity/zstd requests: 2/2 exact expected transformed bytes. Three actual WS captures prove initial transform, renewed state/signature full delta and revoked full reconstruction. These are finite named diagnostics, not statistical workloads; 231 includes parent tests/subtests, not 231 independent cases. No universal safety or hold-out claim follows.

State enhancement can increase bytes; compression ratio/net primary tokens/current occupancy/cost and p95 are UNKNOWN. Independent hold-out, active Desktop integration/pilot, general category promotion and full supersession remain separate gates. Main external evaluation remains UNKNOWN under the carried internal packet export restriction, with zero provider HTTP/retries; available local facts remain usable.
