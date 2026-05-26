# Auto-Ramping Promotion Threshold

**ADW ID:** y8r69q-auto-ramping-thresho
**Date:** 2026-05-21
**Specification:** specs/issue-512-adw-y8r69q-auto-ramping-thresho-sdlc_planner-auto-ramping-promotion-threshold.md

## Overview

Replaces the hardcoded `N = 3` promotion threshold with a ratio-aware ramp that scales with a repo's 90-day promotion activity. Young repos get the bootstrap value of 3; mature repos that regularly promote scenarios to the regression suite see N rise up to 7. The threshold is framework-owned and not per-repo overridable.

## What Was Built

- **Ratio-aware `computeThreshold`** — piecewise-linear ramp from `BOOTSTRAP_THRESHOLD = 3` to `MAX_THRESHOLD = 7`, saturating at `RATIO_CAP = 0.5` (50% promotion rate)
- **New `promotionStatsLoader` module** — pure function that reads two rolling 90-day git log queries (numerator: `regression-promotion:` commits; denominator: `Scenario:` line additions in `features/per-issue/feature-*.feature`) and returns a `PromotionStats`
- **Orchestrator wiring** — `promotionCommenter` gains a required `loadStats` dep; `adwPromotionSweep.tsx` wires the default git-backed loader, respecting the repo's configured per-issue directory
- **11 unit tests** for `promotionThreshold` covering bootstrap, monotonicity, and bounds
- **8 unit tests** for `promotionStatsLoader` covering happy paths, error recovery, command-string assertions, and `+`/`-` diff line discrimination
- **Smoke scenario** (`features/regression/smoke/promotion_threshold_auto_ramp.feature`) with young-repo and mature-repo variants
- **Per-issue BDD scenarios** (`features/per-issue/feature-512.feature`) with 10 functional scenarios plus TypeScript type-check guard
- **12 manifest fixtures** seeding synthetic git histories for the smoke and per-issue scenarios

## Technical Implementation

### Files Modified

- `adws/promotion/promotionThreshold.ts`: Replaced hardcoded bootstrap return with piecewise-linear ramp; exported `MAX_THRESHOLD = 7` and `RATIO_CAP = 0.5`
- `adws/promotion/promotionCommenter.ts`: Added required `loadStats: () => PromotionStats` dep to `PromotionCommenterDeps`; replaced hardcoded zeros with `deps.loadStats()` call
- `adws/adwPromotionSweep.tsx`: Extended `buildCommenterDeps` to accept `config`, resolve per-issue glob, and wire `loadStats` via `loadPromotionStats`
- `adws/promotion/index.ts`: Barrel-exported `loadPromotionStats`, `PromotionStatsLoaderDeps`, `MAX_THRESHOLD`, `RATIO_CAP`
- `adws/promotion/__tests__/promotionThreshold.test.ts`: Replaced 4 stub cases with 11 cases covering full curve domain
- `adws/promotion/__tests__/promotionCommenter.test.ts`: Added `loadStats` to `makeDeps` defaults; added 2 new threshold-from-stats cases
- `test/mocks/manifestInterpreter.ts`: Extended to support `commits[]` seeding shape for pre-seeding synthetic git history in worktree fixtures

### New Files

- `adws/promotion/promotionStatsLoader.ts`: Pure function with two git-log helpers (`countPromotionCommits`, `countPerIssueScenarioAdditions`); all I/O behind injected deps; fails open (returns `{0,0}` on error)
- `adws/promotion/__tests__/promotionStatsLoader.test.ts`: 8 cases with `vi.fn()` mocks asserting both return values and exact command strings
- `features/regression/smoke/promotion_threshold_auto_ramp.feature`: Two `@regression @smoke` scenarios (young vs mature repo)
- `features/per-issue/feature-512.feature`: 10 functional scenarios + type-check guard
- `features/per-issue/step_definitions/feature-512.steps.ts`: Pending stubs for all new step phrases
- `test/fixtures/jsonl/manifests/promotion-threshold-*.json`: 12 manifest fixtures for smoke and per-issue scenarios

### Key Changes

- **Curve formula**: `BOOTSTRAP_THRESHOLD + Math.round(span * clamp(ratio, 0, RATIO_CAP) / RATIO_CAP)` — bounded, monotonic, no floating-point unbounded growth
- **Bootstrap guard**: `totalPerIssueCount90d === 0 → 3` fires before division, covering new repos and git errors equally
- **Stats loader fail-open**: both git queries wrap in `try/catch`; any failure logs a warn and returns 0 rather than throwing, so a brand-new repo cannot crash the orchestrator
- **Per-issue glob resolution**: `adwPromotionSweep` reads `config.scenarios.perIssueScenarioDirectory` so non-default repo layouts are counted correctly
- **`loadStats` is required (not optional)** on `PromotionCommenterDeps` — callers must consciously decide what stats to inject rather than silently getting bootstrap behaviour

## How to Use

The threshold auto-ramps transparently on every `promotion-sweep` invocation. No configuration is needed.

To observe the effect:

1. In a repo with many `regression-promotion:` commits in the last 90 days (relative to per-issue scenario additions), `computeThreshold` returns a higher N, so only scenarios scoring ≥ N receive a `@promotion-suggested-<date>` tag.
2. In a young repo with no promotion history, `computeThreshold` returns 3 (bootstrap), so scenarios scoring ≥ 3 are tagged.

To inspect the current threshold for a repo, call:
```ts
import { loadPromotionStats, computeThreshold } from './adws/promotion/index.ts';
const stats = loadPromotionStats({ runGit, now: () => new Date(), perIssueGlob: 'features/per-issue/feature-*.feature', cwd: process.cwd() });
console.log(computeThreshold(stats)); // → 3–7
```

## Configuration

No per-repo configuration. The curve constants are framework-owned in `adws/promotion/promotionThreshold.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `BOOTSTRAP_THRESHOLD` | 3 | N when no 90-day history exists |
| `MAX_THRESHOLD` | 7 | Upper bound (one above max realistic non-extra-phase score of 6) |
| `RATIO_CAP` | 0.5 | Ratio at which N saturates (50% promotion rate = mature curation) |

To tune, change these constants in a single-line framework PR. See inline comments for rationale.

## Testing

```sh
# Unit tests
bunx vitest run adws/promotion/__tests__/promotionThreshold.test.ts
bunx vitest run adws/promotion/__tests__/promotionStatsLoader.test.ts
bunx vitest run adws/promotion/__tests__/promotionCommenter.test.ts

# Type check
bunx tsc --noEmit -p adws/tsconfig.json

# Dry-run per-issue scenarios (all stubs registered)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-512" --dry-run

# Full regression suite (new smoke scenario stays pending behind ISSUE-3-CUTOVER)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- The smoke scenario (`promotion_threshold_auto_ramp.feature`) depends on the `commits[]` manifest seed mechanism added to `test/mocks/manifestInterpreter.ts`. Both smoke scenarios remain pending behind the ISSUE-3-CUTOVER stub in `whenSteps.ts`; the scenario shape is the documented contract for the next cutover.
- Acceptance criterion #6 ("no `.adw/scenarios.md` knob for overriding N") is verified by manual grep at Step 13 of the spec, not by a per-issue BDD scenario — asserting against framework source file contents from inside a scenario is the rot pattern the parent PRD was designed to stop.
- The denominator counts *scenario blocks added* (not files added), matching the numerator's semantic of one move-PR per scenario. If a future slice bundles multiple promoted scenarios per PR, the numerator query would need updating to count `regression-promotion:` *scenarios* rather than commits.
- Parent PRD: `specs/prd/scenario-rot-prevention-and-promotion.md`. Previous slices: slice #4 (issue #509, `feature-tdauam-promotion-commenter-deep-modules.md`) introduced the deep-module layout; slice #5 (issue #511, `feature-2wrg9y-promotion-mover-regression-pr.md`) produced the `regression-promotion:` commit history this slice's numerator query relies on.
