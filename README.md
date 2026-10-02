# Jev Codex experiment

Experimental local MCP integration inspired by [typakon4/jev-layer](https://github.com/typakon4/jev-layer), audited at commit `eeb9f19d055f92b854bb21c9483fbb7fc74c963c`.

Implemented: safe Choice between `gpt-6-luna/max` and `gpt-6.1-sol/low`, plus shadow Noul context recommendations. Both share a server-owned budget of 30 HTTP attempts and 30 seconds of cumulative provider waiting per bounded subtask. Profiles and recommendations are advisory; the server does not launch agents or exclude context.

Requires Node.js 24 or newer. No package dependencies or installation step.

```sh
npm test
node integration/mcp.mjs
```

The direct server reads `TYPESAFE_API_KEY` from its environment. Never commit credentials. The Windows launcher supports an existing DPAPI-encrypted credential; see [runtime details](integration/README.md). Offline tests need no key. The optional live smoke sends synthetic data and consumes provider usage.

See [specification](SPEC.md), [domain context](CONTEXT.md), [Choice contract](tasks/issue-2-contract.md), and [validation report](docs/issue-2-validation.md).

[Issue tracker](https://github.com/striges88-bit/jev-codex-experiment/issues): issues #2 and #3 are accepted. Global MCP registration and actual Choice-selected Desktop subagent dispatch were verified; see the [Desktop validation report](docs/issue-3-validation.md). Shadow recommendations for #4 were verified through offline MCP controls and synthetic live Noul; see the [shadow validation report](docs/issue-4-validation.md). Full launch context is preserved; threshold 0.9 is experimental. Scoring and calibration remain separate work. Real-context transmission requires the planned provider privacy/retention review. Actual context filtering requires separate user confirmation after comparison.
