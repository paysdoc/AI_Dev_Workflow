# Promotion Scoring Module

## Overview

`adws/promotion/` is a pure scoring library: it parses `.feature` files and the regression vocabulary registry, and scores per-issue scenarios against that registry with a deterministic, auto-ramping threshold. It has no I/O of its own and no orchestration logic — it is consumed by `adws/triggers/promotionSweep.ts` (see `app_docs/feature-vpb048-promotion-sweep-originate.md`) to decide which scenarios are promotion candidates.

## Responsibilities

- Parse `.feature` file content into typed `Scenario` objects (tags, steps, line positions) using the Cucumber Gherkin parser via `scenarioParser.ts`.
- Parse the vocabulary registry markdown from `features/regression/vocabulary.md` via `vocabularyParser.ts`.
- Score each scenario against the `VocabularyRegistry` via `promotionScorer.ts`, producing a `ScoreResult` with a numeric total and a breakdown across three dimensions: `surfaceMatch`, `executionPattern`, and `phaseCount`.
- Compute the dynamic promotion threshold via `promotionThreshold.ts` based on rolling 90-day stats: bootstraps at 3 when no history exists and ramps linearly up to 7 as the promoted-to-total ratio approaches 50%.
- Load promotion stats (90-day promoted count and per-issue scenario count) via `promotionStatsLoader.ts`, derived from `git log` queries (`regression-promotion:` commit-message grep for the numerator, `+ Scenario:` diff lines under the per-issue glob for the denominator).
- Re-export the scoring/threshold/parsing surface through `index.ts` for consumers like `promotionSweep.ts`.

## Contracts & Invariants

- `promotionScorer.score` awards `surfaceMatch` (weight 3) only when every step matches a vocabulary phrase AND every matched assertion target appears in the `examplesBlock` — both conditions must hold simultaneously.
- `executionPattern` weight is 3 for `subprocess`, 2 for `phase-import`, and 0 for `mock-query`; only the highest-weight `When` pattern is counted.
- `phaseCount` is `(whenStepCount - 1) * 1` when there are two or more `When`/`And-after-When` steps, else 0.
- The maximum achievable score is 7 (3 surfaceMatch + 3 subprocess + 1 phaseCount for a two-phase scenario), which also equals `MAX_THRESHOLD` — the highest possible threshold.
- `computeThreshold` returns `BOOTSTRAP_THRESHOLD` (3) when `totalPerIssueCount90d` is 0.
- Step phrase matching is case-sensitive but `{string}` and `{int}` wildcards are treated as regex wildcards (`.*` and `\d+`; longest phrase wins on overlap).
- `loadPromotionStats` fails safe: a failed `git log` query (numerator or denominator) is logged and treated as 0, never thrown.

## Configuration

The scorer reads the vocabulary registry from `features/regression/vocabulary.md`. The threshold computation reads rolling 90-day stats supplied by `promotionStatsLoader` (injected `gitLogSince`, `now`, and `perIssueGlob` deps). No static configuration file for score weights; they are module-level constants in `promotionScorer.ts`.

## Gotchas

- `promotionScorer` sorts phrases by descending length before matching so that more-specific phrases take priority over shorter overlapping ones.
- `RATIO_CAP` is 0.5 — once more than half of per-issue scenarios from the last 90 days have been promoted, the threshold is pinned at `MAX_THRESHOLD` (7) regardless of further increases in the ratio.
- This module only scores and parses; it does not tag files, file issues, or move scenarios. Tagging lives in `adws/core/promotionTagState.ts`, sweep/decision/issue-filing logic lives in `adws/triggers/promotionSweep.ts` + `adws/core/promotionSweepDecider.ts`/`promotionReconcileLink.ts`/`promotionIssueBody.ts` (see `app_docs/feature-vpb048-promotion-sweep-originate.md`).
