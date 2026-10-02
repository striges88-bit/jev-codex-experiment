# Issue #2 validation

Verified locally on 2026-10-02; [issue #2](https://github.com/striges88-bit/jev-codex-experiment/issues/2) is closed with seven acceptance criteria checked.

## Reproducible checks

`npm test` runs 13 offline tests at the public MCP boundary with controlled transport and clock. Coverage includes exact profiles, strict schemas, secret fixtures, fixed HTTPS/no redirects, UTF-8 input/frame/response limits, complete accepted context, cumulative budgets, concurrency, cancellation, restart/expiry, safe failures and allowlisted usage. Two child-process tests check empty stderr and absence of raw persistence.

`node --check` passed for every JavaScript module. There is no TypeScript typecheck configured.

The unchanged prior adapter's six checks passed separately. Its audited upstream source hashes matched pinned commit `eeb9f19d055f92b854bb21c9483fbb7fc74c963c`. The prior adapter and its local audit workspace are not part of this repository; these six checks are historical evidence, not part of `npm test`.

[Source manifest](../tasks/issue-2-source-manifest.json) records SHA-256 values for the published integration sources. [Contract](../tasks/issue-2-contract.md) maps C01–C15 to A1–A7.

## Synthetic live evidence

The existing Windows DPAPI credential envelope was verified without printing the key or ciphertext. The first authenticated synthetic Choice returned `low_confidence`: one HTTP request, 672.3896 ms, 460 input / 36 output tokens.

Candidate descriptions were clarified; the 0.8 gate stayed unchanged. A second validation run selected `luna_max` (`gpt-6-luna/max`): one HTTP request, 639.3249 ms, 575 input / 36 output tokens, selected probability and confidence 0.99. These were two code-version validation runs, with no automatic retries and no real task material. Later metadata-secret protection did not alter the provider request body.

Cost and subagent runtime remain unknown (`null`). Provider usage is subjective routing evidence, not a benchmark of general routing quality.

## Review and limitations

Manual review of the new files against project requirements and the contract found no unresolved findings within issue #2. Review occurred before Git initialization against an empty-file baseline; no branch review is claimed.

The secret scanner cannot detect all arbitrary secrets. OS scheduling can overrun deadlines; actual waiting is reported rather than clipped. Lifecycle state is process-local and fails closed after restart. The caller must preserve the lifecycle ID and avoid creating replacement IDs to reset a task's budget.

Desktop loading and actual selected-profile dispatch, global installation, provider retention guarantees, filtering, Score/Noul and calibration are not established by these checks. Publication is a checkpoint of issue #2, not acceptance of later issues.
