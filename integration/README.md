# Jev Choice MCP v1

Local experimental stdio MCP. Three tools: `jev_begin_subtask`, `jev_choice`, `jev_end_subtask`.
Keep the server-generated subtask ID and the same server instance throughout a bounded task. A selected result is advisory data; the caller applies model/effort under its current AGENTS instructions. Restarted, expired or closed IDs cannot resume their budget.

Run offline: `node --test integration/choice.test.mjs integration/process.test.mjs`.
Run the server on Windows: `powershell.exe -NoProfile -NonInteractive -File integration/launch.ps1`.
Run the explicitly synthetic live smoke: `node integration/live-smoke.mjs`.

The launcher imports the existing Windows DPAPI-encrypted PSCredential from `%LOCALAPPDATA%/JevLayerExperiment/typesafe-key.clixml`, using the current Windows account. It restores its previous environment on exit and never prints the key. The new server does not import or execute upstream code. Global MCP registration belongs to issue #3.

Inputs are strict and reject overrides. UTF-8 limits: arguments/POST each 12000 bytes; JSON-RPC frame 16384 bytes excluding LF delimiter; provider response 32768 bytes. Larger content is rejected rather than shortened. Known secret patterns and the loaded key block sending; this scanner cannot establish that arbitrary material is secret-free. Real task material requires the separate privacy/retention review in SPEC.md.

One budget owner holds up to 128 lifecycles with a one-hour monotonic TTL. Per ID: at most 30 started HTTP attempts, 30000 ms measured provider waiting, 5000 ms maximum per attempt, serialized requests, no automatic retries. Timers cover headers and body. Actual scheduler overrun is visible, never clamped. Future tools must reuse this owner. Caller cancellation is JSON-RPC `notifications/cancelled` with `requestId`.

Only two profiles exist: `luna_max` = `gpt-6-luna/max`, `sol_low` = `gpt-6.1-sol/low`. Initial routing gate is 0.8 on provider confidence if supplied, otherwise selected probability. This is experimental policy. No commands or subagents run inside MCP; no context, provider body, replay, or state files are written by the server.

Token fields `usage.input_tokens` and `usage.output_tokens` are supported by the [official TypeSafe SDK](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts) and [API reference](https://api.typesafe.ai/redoc), checked 2026-10-02. Only nonnegative safe integers are exposed; unavailable or invalid values are null. Cost and subagent runtime remain null. Usage is per call, budgets are cumulative. The smoke script explicitly saves only the allowlisted public result.

Design source: tasks/issue-2-contract.md and pinned audited upstream `eeb9f19d055f92b854bb21c9483fbb7fc74c963c`. The prior adapter stays separate and testable. This implementation does not establish Desktop dispatch, provider retention, filtering or scoring.
