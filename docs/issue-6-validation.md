# Issue #6 comparative validation

Status: PARTIAL. Ten historical reports, three synthetic pairs and three current read-only shadow tasks. All observations retained; offline recalculation sends no HTTP.

Historical: 20 HTTP, 9394.7418 ms TypeSafe wait, 38255/1692 provider input/output. Nine estimates; one invalid_score unknown. Original launch context and quality/invariant truth unavailable.
Trials: 26 HTTP, 17275.6377 ms TypeSafe wait, 45963/1835 provider input/output. Nine native runs; all effective profiles verified from turn metadata; all owners closed; shadow applied=false.
Native cumulative per-child input/output: 504414/2259; cached input 441728; reasoning output 640 is part of output, not added again. Harness durations total 132513 ms; execution-only runtime and cost unknown. Native counters include harness instructions and repeated input; they are not simultaneous context occupancy or attributable filtering savings.

| Trial | Profile / basis | Local outcome | HTTP | Provider estimate |
| --- | --- | --- | ---: | --- |
| pair-arithmetic-full | luna_max / selected | PASS | 3 | estimated |
| pair-arithmetic-reduced | luna_max / frozen_pair_profile | PASS | 2 | estimated |
| pair-sequence-reduced | luna_max / selected | PASS | 3 | estimated |
| pair-sequence-full | luna_max / frozen_pair_profile | PASS | 2 | estimated |
| pair-usage-full | luna_max / AGENTS_fallback | PASS | 3 | estimated |
| pair-usage-reduced | luna_max / frozen_pair_profile | PASS | 2 | estimated |
| current-payload-review | sol_low / selected | PASS | 3 | estimated |
| current-accounting-review | sol_low / AGENTS_fallback | PASS | 4 | estimated |
| current-evidence-review | sol_low / selected | PASS | 4 | estimated |

| Pair | Full / reduced context bytes | Removed | Outcome | Limit |
| --- | ---: | --- | --- | --- |
| pair-arithmetic | 722 / 614 | weather | Both PASS | CONFUNDED_WRAPPER_VARIATION: executor briefing wording differed beyond removed reference; no causal attribution |
| pair-sequence | 778 / 660 | palette | Both PASS | Single-order trial, exact working packets differ only approved palette removal; wrapper trial ID differs |
| pair-usage | 809 / 700 | font | Both PASS | Single-order trial, exact working packets differ only approved font removal; wrapper trial ID differs |

Context bytes measure frozen serialized working entries, not model tokens. Three manual removals excluded only preapproved synthetic references; ordinary filtering stayed disabled. Two pairs have matched working packets; arithmetic has extra briefing variation and is confounded. Parent-created fresh sentinels were checked, but native cwd remained the shared project: distinct native working directories were not established. Synthetic children made no tool calls; current children only read their supplied packets. C06 workspace isolation is incomplete. All task facts matched frozen expectations; no post-hoc rubric grade or invariant Brier truth was invented. Provider Score differences are retained in the local summary and do not establish quality improvement.

| Frozen threshold | Selected distinct fragments | Needed | Unneeded | Unknown |
| ---: | ---: | ---: | ---: | ---: |
| 0.8 | 3 | 0 | 3 | 0 |
| 0.85 | 3 | 0 | 3 | 0 |
| 0.9 | 3 | 0 | 3 | 0 |
| 0.95 | 3 | 0 | 3 | 0 |
| 0.99 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 | 0 |

Threshold decision: ABSTAIN, A6 PARTIAL. Historical split6/4 was fixed before estimates, but both groups lack original reference ground truth. Current reference labels are unknown. Synthetic references are hand-designed and dependent within task; one observation per order cannot establish general safety. No numerical threshold or Score gate is recommended; no repeat was made to conceal fallback or confound.

Current reviews verified bounded findings: identity placeholders still retain the GitHub account name; historical report claims cannot establish current runtime or original artifact completeness. Accounting review recomputed all ten historical rows including unknown. Evidence review separated reported bounded tests from retention/calibration/native/runtime claims.

Privacy: user accepted disclosed public TypeSafe storage/telemetry terms for these exact cleaned packets and bounded answers. Account-specific terms and fixed deletion/backup deadlines remain unknown; no zero-retention claim. Four oversize historical candidates were preserved and replaced with approval; no truncation. Raw packets and detailed evidence remain local.

Audit corrections: one manually transcribed native ID was corrected from authoritative metadata without any rerun; the first arithmetic answer was transmitted as a faithful parent transcription with exact native answer retained. A reduced usage answer echoed requirement singular; supplied protected requirements remained in its launch context. Driver persisted all nine closed owners before terminal interruption of its lingering PTY handle.

Acceptance: privacy/material inventory and current shadow are verified within approved scope. A4 original-result quality/invariant calibration remains unknown; A5 has one confounded pair; A6 lacks empirical threshold evidence. Issue remains open. Global configuration, original runtime source, main model, hooks and memory/compaction behavior preserved; prior issues were not rerun. Publication and Git checkpoints are tracked separately in issue #6; this report grants no completion or further execution authority.
