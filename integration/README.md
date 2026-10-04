# Jev Choice MCP v1

Local experimental stdio MCP. Six tools: `jev_begin_subtask`, `jev_choice`, `jev_end_subtask`, `jev_shadow_filter`, `jev_evaluate`, `jev_filter_context`. The five pre-filter v1 payloads are unchanged.
Keep the server-generated subtask ID and the same server instance throughout a bounded task. A selected result is advisory data; the caller applies model/effort under its current AGENTS instructions. Restarted, expired or closed IDs cannot resume their budget.

Run offline: `npm test`.
Run the server on Windows: `powershell.exe -NoProfile -NonInteractive -File integration/launch.ps1`.
Run the explicitly synthetic live smoke: `node integration/live-smoke.mjs`.
Run synthetic shadow Noul separately: `node integration/shadow-live-smoke.mjs` (writes only sanitized results to a local ignored evidence file).

The launcher imports the existing Windows DPAPI-encrypted PSCredential from `%LOCALAPPDATA%/JevLayerExperiment/typesafe-key.clixml`, using the current Windows account. It restores its previous environment on exit and never prints the key. The new server does not import or execute upstream code. Global MCP registration belongs to issue #3.

Inputs are strict and reject overrides. Arguments, task text, POST bodies and incoming JSON-RPC frames have no local byte cap. Complete state is sent without truncation; provider HTTP errors, timeouts or invalid responses return the existing fallback, without automatic retry. Evaluate then returns to the main agent with unknown estimates. This does not establish unlimited provider capacity: larger inputs use more local memory and may cost more to process. Provider responses retain the 32768-byte guard. Known secret patterns and the loaded key block sending; this scanner cannot establish that arbitrary material is secret-free. Real task material follows current authorization and privacy/retention rules; dated SPEC.md pilot restrictions retain their original scope.

One budget owner holds up to 128 lifecycles with a one-hour monotonic TTL. Per ID: at most 30 started HTTP attempts, 30000 ms measured provider waiting, 5000 ms maximum per attempt, serialized requests, no automatic retries. Timers cover headers and body. Actual scheduler overrun is visible, never clamped. Future tools must reuse this owner. Caller cancellation is JSON-RPC `notifications/cancelled` with `requestId`.

Only two profiles exist: `luna_max` = `gpt-6-luna/max`, `sol_low` = `gpt-6.1-sol/low`. Initial routing gate is 0.8 on provider confidence if supplied, otherwise selected probability. This is experimental policy. No commands or subagents run inside MCP; no context, provider body, replay, or state files are written by the server.

Token fields `usage.input_tokens` and `usage.output_tokens` are supported by the [official TypeSafe SDK](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts) and [API reference](https://api.typesafe.ai/redoc), checked 2026-10-02. Only nonnegative safe integers are exposed; unavailable or invalid values are null. Cost and subagent runtime remain null. Usage is per call, budgets are cumulative. The smoke script explicitly saves only the allowlisted public result.

Design source: tasks/issue-2-contract.md and pinned audited upstream `eeb9f19d055f92b854bb21c9483fbb7fc74c963c`. The prior adapter stays separate and testable. Provider retention, general filter reliability and scoring calibration remain unestablished.

## Shadow filter v1

Call `jev_shadow_filter` with `{schema_version:1,subtask_id,task:{goal,scope,done_when},context:[{id,text,protected,kind}]}`. All fields are required; extra fields are rejected. The caller verifies inventory provenance. `kind` is `instruction`, `requirement`, `unfinished` or `reference`; the first three require `protected:true`. Protected references are also accepted. Task is always protected. Only unprotected references receive questions; every provider state contains the entire task and ordered context. This metadata check cannot recognize intentionally misclassified instructions.

Noul answers map directly to `p_unneeded`, independently of confidence. Results contain one ordered `{fragment_id,protected,p_unneeded,decision}` per fragment. Protected entries have null probability/`protected`; candidates are `keep` below 0.9 and `would_exclude` at or above 0.9. Threshold 0.9 is experimental and does not imply reliability. Every result is `mode:shadow`, `applied:false`, `context_action:preserve_full`. `shadow_complete` means all candidate responses validated; all-protected/empty input completes with no HTTP. On failure all candidates become null/`unknown`; prior packet recommendations are discarded. Invalid inventory reflects no IDs. No context text or provider diagnostics are returned.

Question packets contain at most eight questions and the full state, without a local POST byte cap. Packets are split only by question count. The entire plan must fit the same remaining requests budget as Choice before the first HTTP. One shadow call holds the owner queue across all packets. Time, cancellation and owner availability are rechecked before every attempt. No automatic retry, caching, exactly-once or durable resume is provided; repeats spend the remaining budget. Invalid/missing/extra answers or out-of-range Noul return `invalid_noul`. Transport/lifecycle errors keep their existing codes with shadow fallback action `preserve_full_context`.

`shadow-context.mjs` returns a copy of the complete launch inventory for success, fallback and unavailable MCP. It never applies recommendations. `choiceContext` projects only the old `{id,text,protected}` metadata shape for Choice without changing text, order or protection. The caller retains source originals. Shared budget counters are cumulative; measurements cover only this call. Token totals require valid usage on every started packet, otherwise null; cost/runtime stay null.

## Completed result evaluation v1

`jev_evaluate` accepts the shadow task/context inventory plus required `material:{answer,baseline,diff,checks}`. Answer is a nonempty string; other fields are nonempty snapshots or null for unavailable evidence. The caller collects the full available context and snapshots, checks provenance and preserves originals. Local evidence paths are not automatically sent. Server reads no files, executes no commands and launches no agents.

## Scoped opt-in context filter v1

`jev_filter_context` adds required `policy:{approval_id,revision,manifest_sha256,binding_sha256,threshold,allowed_fragment_ids}` to the shadow inventory. Threshold is exactly 0.80. Approval ID is a safe identifier, revision a positive safe integer, hashes lowercase SHA256; allowed IDs must be unique unprotected references in this inventory. Unknown fields or versions, invalid policy, binding mismatch or suspected secrets reject before HTTP without reflecting IDs. Binding is UTF-8 SHA256 of fixed-key JSON `{task:{goal,scope,done_when},context:[{id,text,protected,kind}]}` in original order without text normalization; `context-binding.mjs` is shared by caller/server.

The tool reuses the unchanged full-state Noul planner, transport, owner queue and per-owner budgets. It scores all unprotected references, but recommends exclusion only for allowed IDs at `p_unneeded >= 0.80`. Complete output is `filter_complete/mode:opt_in/context_action:select_allowed/applied:false`; errors discard every estimate and preserve full context. The tool validates policy consistency, not human authority, and never launches an agent. Legacy shadow stays 0.9/applied:false/full.

`createContextAuthorization` accepts exact human-reviewed manifest bytes, starts disabled, and only a trusted local coordinator may authorize after material/privacy/provenance approval. State is process-local; restart starts disabled. The manifest binds six exact task/context inventories and their allowed references. Task/provider data cannot enable it. `prepareContextDispatch` checks the scoped policy, complete ordered recommendations, selected valid Choice profile and owner. Its single-use `dispatch(callback)` rechecks revision/enabled/binding/owner immediately before invoking the native adapter callback; it exposes no reusable filtered dispatch copy. Revoke or unknown state passes original context to that callback. The adapter must launch synchronously at that boundary, preserve the supplied copy, retain full originals, and verify actual profile/context/workdir after launch. The consumer receipt records hashes/IDs/probabilities and selection, with unknown actual profile/runtime/cost until independently verified.

Applicability is the approved six frozen synthetic families from #6 only. The scoped #7 proof is limited to two native launches, three total HTTP and 30 seconds total provider wait; the trusted coordinator must enforce those aggregate caps in addition to the server's per-owner limits. No real-context rollout or activation is implied by installing the tool. Native proof, exact material approval and final acceptance remain separate gates.

### Local authorization manifest v2

The historical schema_version1 manifest above is still accepted with its six families and unchanged semantics. New local schema_version2 uses exact `{schema_version:2,scenario:"scoped_real_pilot",threshold:0.80,tasks:[...]}`; one or two tasks, at most65536 UTF-8 bytes. Each task has only `{id,task_sha256,binding_sha256,fragments,allowed_fragment_ids}`. Each ordered fragment has only `{id,kind,protected,text_sha256}`. IDs and hashes use the existing safe-ID/SHA256 formats. Task IDs/task hashes/bindings and fragment IDs must be unique; each task has3..64 fragments, including protected instruction/requirement/unfinished entries. Allowed IDs are unique unprotected references in that task. Malformed/unknown/oversized v2 fails with `invalid_manifest` before creating authorization. No migration of v1 or change to the MCP schema_version1 wire is needed. Human approval and current-byte matching still precede selection; loading either version starts off. V2 availability does not authorize any live material or global activation.

`native-usage.mjs` adds a pure exact-session telemetry seam, following the historical collector's session_meta/turn_context/token_count/task_complete fields. The caller supplies one full explicitly identified fresh-child session and expected session/parent/agent/turn/profile bindings; no directory scan. It uses the final complete cumulative counters once, checks monotonicity and terminal completeness, and treats cached input as a subset of input. Missing/partial/reset/mismatched evidence yields UNKNOWN. `usageDelta` subtracts complete counters only in one explicit scope. Primary attribution requires separately captured arm boundaries; aggregate counters alone cannot establish it. Harness duration includes overhead and is distinct from coordinator monotonic arm-to-reviewed-result time. These counters do not measure context-window occupancy or dollars.

Three Score dimensions (correctness/completeness/verification) use fixed five-level `quality-v1` rubrics, raw0..4 and normalized raw/4, without a quality gate. Five positive Noul questions return `p_compliant`, independently of confidence or local `pass`. Each tool invariant starts with `pass:null,status:unknown,evidence:[]`. Complete estimates have `status:estimated`; failure produces all-unknown estimates and `return_to_main_agent`. A late bad packet discards all earlier estimates.

Score validates the exact local legend/distribution keys, finite bounds and required confidence. Probability sum tolerance is1e-6. User-approved wire compatibility permits absolute raw-versus-weighted discrepancy up to0.055 (+1e-12 numerical epsilon); raw score, allowlisted probabilities and explicit consistency diagnostic are retained. This local policy accommodates possible rounding; it does not prove provider precision or accuracy and does not affect fact acceptance. See [TypeSafe API](https://docs.typesafe.ai/api) and [validation](../docs/issue-5-validation.md).

All eight questions share one POST when it fits. Under pressure only questions split; every packet preserves identical full task/context/material. Existing bounds, fixed model/endpoint, deadlines, cancellation and same Choice/shadow budget apply. Final serialized POST receives another secret preflight. Call measurements, cumulative owner counters and local coordinator aggregation remain separate; unknown usage/cost/runtime is null.

`createAssessmentCoordinator` in `assessment.mjs` is a trusted local main-agent workflow. It accepts `client.call`, actual `review`, `authorizeRepair`, `remainingBudget` and bounded `repair` callbacks. `review` reads and checks local sources, returns a snapshot-bound main-agent review, observed/expected facts, coverage and hash-matched evidence. Helper validates shape/binding, not the truth of human claims. Assertions inside tool args or a subagent's result cannot bypass this callback. Incomplete positive coverage stays unknown; a verified counterexample suffices for violation. Missing commands in an incomplete log do not prove failure.

Only confirmed violation with authority and a rechecked remaining budget can call repair. One callback handles all violations; full task/context and ID must be preserved. Changed material receives a new evaluation/review. Repeated violation, unknown, callback failure, unavailable provider/budget or changed scope hands back to main. Low Score cannot trigger repair. The process-local registry retains one terminal outcome per subtask ID across coordinator creations/concurrent calls, capped at4096 entries with fail-closed capacity. It does not provide durable/exactly-once recovery. `run(args,{continuity:'fresh'})` is authorized only immediately after a verified fresh begin; unverified restart continuity cannot repair. A new begin is never a budget/repair bypass.

`remainingBudget` is a trusted current-owner getter (`createChoice().remainingBudget` for local embedding). For an exclusively owned serial stdio workflow, the caller may retain the latest actual owner snapshot, as the synthetic smoke does; it must not treat a stale snapshot with competing calls as current. Re-evaluation rechecks the server budget again and rejects oversized revised packets. Subagent runtime stays unknown/null when unavailable. Generic `repair_runtime` measures callback elapsed time, labeled an upper bound and separate from TypeSafe wait; a local callback is not reported as native subagent runtime. No inferred price is reported.

Run explicitly synthetic live Score/Noul and actual local repair: `node integration/evaluate-live-smoke.mjs`. It seeds incorrect JSON5, records a failing arithmetic check, makes one bounded actual correction to4, checks the unrelated sentinel, re-evaluates and closes owner in finally. It writes ignored sanitized evidence. This proves a local repair executor; it does not claim a new native subagent launch or privacy/calibration acceptance.
# Main Desktop request gateway

`main-gateway.mjs` is a separate local request adapter, with no Choice/model
selection. It forwards only reviewed Codex subscription routes to
`https://chatgpt.com`. It binds on `127.0.0.1`; a random capability in the base URL,
local Host and absence of browser Origin restrict access. Credentials arrive
from the native client and remain in transport memory. No auth files are read;
auth headers, account/thread identifiers and raw history are absent from receipts.

The initial mode is **passthrough**. HTTP/SSE, errors and cancellation are forwarded
without retries. zstd requests retain original compressed bytes when unchanged.
WebSocket text messages are parsed at complete RFC6455 message boundaries;
TCP fragmentation, masking and backpressure are preserved. WS compression is
negotiated off so both legs expose plaintext; HTTP zstd handling is unchanged.
Unsupported wire formats preserve exact bytes before selection. After selection,
an unsafe continuation closes the connection before forwarding rather than
silently keeping a server prefix whose omitted data cannot be restored.
A dead gateway is a connection failure; restore direct routing with rollback.

`main-context.mjs` protects everything by default. Its trusted local policy uses
`schema_version:1`, standing `approval_id`, `enabled`, `mode` (`shadow`/`filter`),
positive `revision` and `bindings`. Each binding has `scope_sha256` (native account,
thread, model, reasoning, instructions and tools), exact initial `input_sha256`,
and `optional_groups` with exact group `sha256`, `completed:true` and
`reason:"superseded_reference"`. These hashes are generated with `mainScope` and
`mainInventory`; the coordinator must actually review a group's applicability.
HTTP data and model output cannot create this policy. Recent eight logical
groups, user/system/developer items, explicit protection, opaque reasoning,
compaction, additional tools, agent messages and evidence signals remain full.
Call/result intervals close over parallel calls. Structured native custom tool
outputs retain their text, images, audio and encrypted parts unchanged.
Internal classification metadata protects items by default. A coordinator can
set `metadata_reviewed:true` for one reviewed optional assistant group only when
its metadata contains valid neutral `turn_id`/`create_time` fields and one
`"unknown"` classification per text part; all stronger protections still apply.
Other classifications and metadata fields cannot be overridden.

An optional binding `item_hashes` records the reviewed original prefix and
`allow_protected_appends:true` allows subsequent protected tool feedback to stay
full. Original indices plus hashes bind exclusions to concrete occurrences;
identical later occurrences remain. A changed prefix, new user instruction,
scope/revision drift or unknown policy preserves full input. Selector caches
retain only hashes/decisions.

`response-context.mjs` retains original input and one completed output in memory
for each connection. It reconstructs incremental `previous_response_id` chains
before checking policy. Nonempty complete `response.output` is authoritative; otherwise
native `response.output_item.done` events supply output, with indexed sets
required to be unique and contiguous. Empty completion placeholders cannot
discard already received done items. An unchanged selected prefix reuses the
native incremental bytes. Revocation restores the complete original prefix with
`previous_response_id:null`; missing or uncertain chain data after selection
closes before forwarding. Disconnect clears this transient state. No raw history
is persisted by this adapter.
This deterministic local Jev adapter sends no history to TypeSafe; the existing
bounded probabilistic subagent filter and main answer evaluate remain separate.

Schema-2 receipts emit `received`, `connected` and one `terminal` event with the
same `request_id`, a timestamp, gateway process ID and hashed thread ID when
provided by the client. `connected` means HTTP response headers or a WS upgrade
were received; it makes a live tunnel visible before close. Count distinct IDs,
not receipt lines. Legacy schema-1 rows represent terminal events only.
HTTP receipts and WS `message_forwarded` observations bind actual written body
hashes/bytes, selected/protected group hashes and policy revision.
WS `response_completed` pairs the message sequence with provider completion and
output count. This is distinct from the terminal transport event: an open WS
still has `completed:false`. `context_selected` can remain true while `applied`
is false when unchanged incremental bytes reuse a previously selected prefix.
Provider completion does not establish factual correctness.
Token usage/cost are currently unknown;
body bytes do not measure Desktop occupancy or economic benefit. Fixtures/CLI
tests are not evidence of an actual Desktop request.

`configure-main-gateway.mjs plan-openai CONFIG PLAN SETTINGS [LEGACY_PLAN]`
creates an exact reversible proposal for the built-in `openai_base_url` setting.
Supply the previous owned custom-provider plan to migrate it without overwriting
later user changes. `apply CONFIG PLAN` refuses baseline drift or conflicting
provider/profile/endpoint settings. `rollback CONFIG PLAN` disables gateway
routing by removing unchanged owned blocks, preserving unrelated newer edits;
it does not reinstall the legacy custom provider. Config writes use a staged,
flushed file and same-directory replacement with a final baseline check. This
prevents partial writes, but does not lock out another concurrent config writer.
Model/effort and native OpenAI auth stay unchanged; the built-in provider retains
its transport choice, including WS. Legacy `plan` remains for existing v1 plans.
User-level configuration and a Desktop restart are required. Start the gateway first with
`start-main-gateway.ps1 -SettingsPath SETTINGS`. Optional Windows logon startup:
`autostart-main-gateway.ps1 -Mode Install -SettingsPath SETTINGS`. This installs
the owned `JEV-LAYER-MainGateway` scheduled task for the current interactive user
with limited privileges, hidden PowerShell/Node execution and one instance.
It runs independently of Desktop, without a password, service or application hook.
The scheduler restarts a failed **process** up to three times, one minute apart;
the gateway still never retries provider requests. `-Mode Status` verifies task
ownership; `-Mode Remove` unregisters only an unchanged owned action/principal,
leaving an existing listener available until Desktop routing is restored.
Logon ordering against other startup applications is not guaranteed. After actual
Desktop passthrough evidence, independently review tool follow-ups and only then
enable a scoped policy. Main filtering must not be claimed live before that gate.

The 2026-10-04 Desktop check confirmed the existing chat through built-in
`openai_base_url`, actual WS selection of one reviewed completed assistant group,
provider completion/tool continuations, and restoration after revocation.
Following native compaction, the old binding no longer matches and full input is
preserved. Policy activation therefore proves one scoped selection, not automatic
permission to reduce every future history. Compression and incremental reuse
have no measured token, cost or latency benefit yet. Sanitized local evidence:
`tasks/gateway-review/ws-live-selected.json`, `ws-live-revoked.json` and report.

For explicit compact tool feedback, `compactToolOutput` stores full UTF8/JSON,
verifies artifact readback and returns selected evidence/path/SHA256/byte count.
On selection/storage failure it returns full output. Test failures/unknown counts
keep full diagnostics; success returns counts. Example after preserving stdout:
`node integration/compact-output.mjs tasks/<task>/tests.log tasks/<task>/outputs EXIT_CODE`.
Pass the actual captured command exit code; output counts alone are only
`reported_passed` and do not prove command success.
The caller supplies a trusted task artifact directory; no automatic command
rewriting, mutation wrapper or PostToolUse replacement is installed.

Design provenance/caveats: `tasks/main-context-research/report.md`; current local
acceptance and Desktop gate: `tasks/main-context-gateway/contract.md`.
