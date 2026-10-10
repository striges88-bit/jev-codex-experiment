# JEV-LAYER retirement notice

Status is RETIRED. Development and new experiments are discontinued.
Retirement is administrative. It does not complete functional acceptance.
Historical PASS, PARTIAL, FAIL, and UNKNOWN results remain unchanged.
No new execution, provider transmission, pilot, or production promotion is authorized by retirement.
Historical export and pilot approvals are expired. They grant no new authority.
This includes the standing TypeSafe consent described in the historical README.

The accepted Codex health result is 6 PASS, 1 PARTIAL, and 4 UNKNOWN, with five deferred exceptions.
The historical result was 6 PASS, 1 FAIL, and 4 UNKNOWN.
Issue #19 native Desktop acceptance remains unproven. Its five checked criteria and final unchecked criterion retain their historical meaning.
Existing acceptance checkboxes remain unchanged. Unfinished issues may close as not planned only under separate approval.
Existing completed child issues remain completed within their accepted scope.
Provider data retention remains unresolved. Retirement does not assert provider data deletion.

The dated source below is preserved as a historical reference.
Its continuation steps, activation instructions, consent statements, and development priorities are inactive.
The historical text grants no authority to run its examples or revive spent packets.

---

# Jev Codex experiment

Experimental local MCP integration inspired by [typakon4/jev-layer](https://github.com/typakon4/jev-layer), audited at commit `eeb9f19d055f92b854bb21c9483fbb7fc74c963c`.

Implemented: advisory Choice between `gpt-6-luna/max` and `gpt-6.1-sol/low`, shadow and scoped opt-in context filtering, Score/Noul evaluation with local evidence review, and a Desktop HTTP/WebSocket gateway with explicit authorization, original reconstruction and full restoration. MCP operations share a server-owned budget of 30 HTTP attempts and 30 seconds of cumulative provider waiting per lifecycle. The gateway uses local authorization and does not call TypeSafe to select history. The server does not launch agents.

The [project checkpoint and full feature matrix](docs/project-status.md) distinguish implemented behavior, bounded historical verification and unresolved defects. General context savings and production readiness are not established. Development follows [context/tool-output/evaluate v1](docs/context-quality-v1.md) and its [measurement protocol](docs/measurement-design.md). The current [#19 completion plan](docs/issue-19-completion-plan.md) records verified offline code, the approved architecture amendment and the remaining native Desktop gate; the full production pipeline is unfinished.

Requires Node.js 24 or newer. No package dependencies or installation step.

```sh
npm test
node integration/mcp.mjs
```

The direct server reads `TYPESAFE_API_KEY` from its environment. Never commit credentials. The Windows launcher supports an existing DPAPI-encrypted credential; see [runtime details](integration/README.md). Offline tests need no key. The optional live smoke sends synthetic data and consumes provider usage.

See [specification](SPEC.md), [domain context](CONTEXT.md), [Choice contract](tasks/issue-2-contract.md), and [validation report](docs/issue-2-validation.md).

[Issue tracker](https://github.com/striges88-bit/jev-codex-experiment/issues): issues #2–#7 have bounded historical acceptance; [Desktop dispatch](docs/issue-3-validation.md), [shadow](docs/issue-4-validation.md), [evaluation](docs/issue-5-validation.md), [calibration](docs/issue-6-validation.md), and [opt-in filtering](docs/issue-7-validation.md) reports retain their original scope. Thresholds 0.9 (shadow) and 0.80 (scoped opt-in) are different contracts, not universal safety guarantees. Ordinary current-task TypeSafe materials have standing user consent; secrets and specific export restrictions remain protected. Provider retention is not independently established. Live activation of the new v1 policy still requires its quality/measurement gates and a scoped human decision.

Only reviewed source and public documentation are versioned. Credentials, machine-specific configuration, history, raw receipts and detailed private task artifacts remain local. Cloning this repository does not recreate an authorized Desktop binding, a credential or a scheduled task. `SPEC.md` and validation reports are historical; the dated checkpoint and v1 specification describe the current development direction.
