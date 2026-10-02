# Jev Choice MCP v1

Local experimental stdio MCP. Four tools: `jev_begin_subtask`, `jev_choice`, `jev_end_subtask`, `jev_shadow_filter`. The original three v1 payloads are unchanged.
Keep the server-generated subtask ID and the same server instance throughout a bounded task. A selected result is advisory data; the caller applies model/effort under its current AGENTS instructions. Restarted, expired or closed IDs cannot resume their budget.

Run offline: `npm test`.
Run the server on Windows: `powershell.exe -NoProfile -NonInteractive -File integration/launch.ps1`.
Run the explicitly synthetic live smoke: `node integration/live-smoke.mjs`.
Run synthetic shadow Noul separately: `node integration/shadow-live-smoke.mjs` (writes only sanitized results to a local ignored evidence file).

The launcher imports the existing Windows DPAPI-encrypted PSCredential from `%LOCALAPPDATA%/JevLayerExperiment/typesafe-key.clixml`, using the current Windows account. It restores its previous environment on exit and never prints the key. The new server does not import or execute upstream code. Global MCP registration belongs to issue #3.

Inputs are strict and reject overrides. UTF-8 limits: arguments/POST each 12000 bytes; JSON-RPC frame 16384 bytes excluding LF delimiter; provider response 32768 bytes. Larger content is rejected rather than shortened. Known secret patterns and the loaded key block sending; this scanner cannot establish that arbitrary material is secret-free. Real task material requires the separate privacy/retention review in SPEC.md.

One budget owner holds up to 128 lifecycles with a one-hour monotonic TTL. Per ID: at most 30 started HTTP attempts, 30000 ms measured provider waiting, 5000 ms maximum per attempt, serialized requests, no automatic retries. Timers cover headers and body. Actual scheduler overrun is visible, never clamped. Future tools must reuse this owner. Caller cancellation is JSON-RPC `notifications/cancelled` with `requestId`.

Only two profiles exist: `luna_max` = `gpt-6-luna/max`, `sol_low` = `gpt-6.1-sol/low`. Initial routing gate is 0.8 on provider confidence if supplied, otherwise selected probability. This is experimental policy. No commands or subagents run inside MCP; no context, provider body, replay, or state files are written by the server.

Token fields `usage.input_tokens` and `usage.output_tokens` are supported by the [official TypeSafe SDK](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts) and [API reference](https://api.typesafe.ai/redoc), checked 2026-10-02. Only nonnegative safe integers are exposed; unavailable or invalid values are null. Cost and subagent runtime remain null. Usage is per call, budgets are cumulative. The smoke script explicitly saves only the allowlisted public result.

Design source: tasks/issue-2-contract.md and pinned audited upstream `eeb9f19d055f92b854bb21c9483fbb7fc74c963c`. The prior adapter stays separate and testable. Provider retention, general filter reliability and scoring remain unestablished.

## Shadow filter v1

Call `jev_shadow_filter` with `{schema_version:1,subtask_id,task:{goal,scope,done_when},context:[{id,text,protected,kind}]}`. All fields are required; extra fields are rejected. The caller verifies inventory provenance. `kind` is `instruction`, `requirement`, `unfinished` or `reference`; the first three require `protected:true`. Protected references are also accepted. Task is always protected. Only unprotected references receive questions; every provider state contains the entire task and ordered context. This metadata check cannot recognize intentionally misclassified instructions.

Noul answers map directly to `p_unneeded`, independently of confidence. Results contain one ordered `{fragment_id,protected,p_unneeded,decision}` per fragment. Protected entries have null probability/`protected`; candidates are `keep` below 0.9 and `would_exclude` at or above 0.9. Threshold 0.9 is experimental and does not imply reliability. Every result is `mode:shadow`, `applied:false`, `context_action:preserve_full`. `shadow_complete` means all candidate responses validated; all-protected/empty input completes with no HTTP. On failure all candidates become null/`unknown`; prior packet recommendations are discarded. Invalid inventory reflects no IDs. No context text or provider diagnostics are returned.

Question packets contain at most eight questions and a serialized POST of at most 12000 UTF-8 bytes including full state and rubric overhead. Packets are planned before sending; an impossible single-question packet rejects with `input_limit`. The entire plan must fit the same remaining requests budget as Choice before the first HTTP. One shadow call holds the owner queue across all packets. Time, cancellation and owner availability are rechecked before every attempt. No automatic retry, caching, exactly-once or durable resume is provided; repeats spend the remaining budget. Invalid/missing/extra answers or out-of-range Noul return `invalid_noul`. Transport/lifecycle errors keep their existing codes with shadow fallback action `preserve_full_context`.

`shadow-context.mjs` returns a copy of the complete launch inventory for success, fallback and unavailable MCP. It never applies recommendations. `choiceContext` projects only the old `{id,text,protected}` metadata shape for Choice without changing text, order or protection. The caller retains source originals. Shared budget counters are cumulative; measurements cover only this call. Token totals require valid usage on every started packet, otherwise null; cost/runtime stay null.
