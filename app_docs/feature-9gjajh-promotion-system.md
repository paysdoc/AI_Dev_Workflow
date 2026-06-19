# Promotion System

## Overview

The promotion system evaluates per-issue BDD scenarios as candidates for promotion into the permanent regression suite. It scores scenarios against the regression vocabulary registry, tags high-scoring candidates with a dated `@promotion-suggested-<date>` marker, and — when a human approves a scenario with `@promotion` — automatically moves it into `features/regression/` via a dedicated PR.

## Responsibilities

- Parse `.feature` file content into typed `Scenario` objects (tags, steps, line positions) using the Cucumber Gherkin parser via `scenarioParser.ts`.
- Score each scenario against the `VocabularyRegistry` via `promotionScorer.ts`, producing a `ScoreResult` with a numeric total and a breakdown across three dimensions: `surfaceMatch`, `executionPattern`, and `phaseCount`.
- Detect `@promotion`-tagged scenarios in a feature file via `promotionApprovalDetector.ts`.
- Compute the dynamic promotion threshold via `promotionThreshold.ts` based on rolling 90-day stats: bootstraps at 3 when no history exists and ramps linearly up to 7 as the promoted-to-total ratio approaches 50%.
- Load promotion stats (90-day counts) via `promotionStatsLoader.ts`.
- Write, refresh, and withdraw `@promotion-suggested-<date>` tags via `promotionTagWriter.ts`.
- Post a PR comment summarising promotion candidates and apply the `hitl` label via `promotionCommenter.ts`.
- Move approved scenarios from per-issue files to the regression suite via `promotionMover.ts`, creating a dedicated PR.
- Parse the vocabulary registry markdown from `features/regression/vocabulary.md` via `vocabularyParser.ts`.

## Contracts & Invariants

- `promotionScorer.score` awards `surfaceMatch` (weight 3) only when every step matches a vocabulary phrase AND every matched assertion target appears in the `examplesBlock` — both conditions must hold simultaneously.
- `executionPattern` weight is 3 for `subprocess`, 2 for `phase-import`, and 0 for `mock-query`; only the highest-weight `When` pattern is counted.
- `phaseCount` is `(whenStepCount - 1) * 1` when there are two or more `When`/`And-after-When` steps, else 0.
- The maximum achievable score is 7 (3 surfaceMatch + 3 subprocess + 1 phaseCount for a two-phase scenario), which also equals `MAX_THRESHOLD` — the highest possible threshold.
- `computeThreshold` returns `BOOTSTRAP_THRESHOLD` (3) when `totalPerIssueCount90d` is 0.
- `detectApprovals` returns only scenarios whose tag list includes the literal string `@promotion`.
- Step phrase matching is case-sensitive but `{string}` and `{int}` wildcards are treated as regex wildcards (`.*` and `\d+`; longest phrase wins on overlap).

## Configuration

The promotion scorer reads the vocabulary registry from `features/regression/vocabulary.md`. The threshold computation reads rolling 90-day stats supplied by `promotionStatsLoader`. No static configuration file for score weights; they are module-level constants in `promotionScorer.ts`.

## Gotchas

- `promotionScorer` sorts phrases by descending length before matching so that more-specific phrases take priority over shorter overlapping ones.
- The `@promotion-suggested-<date>` tag uses today's date in `YYYY-MM-DD` format; the daily-cadence suppression logic in `promotionTagWriter` prevents re-tagging a scenario that was already tagged today.
- `promotionMover` creates a PR for approved scenarios; if the PR creation fails, the moved scenarios are left in an inconsistent state (moved in the worktree but no PR).
- `RATIO_CAP` is 0.5 — once more than half of per-issue scenarios from the last 90 days have been promoted, the threshold is pinned at `MAX_THRESHOLD` (7) regardless of further increases in the ratio.
