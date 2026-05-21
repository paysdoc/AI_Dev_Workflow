# Promotion Commenter Deep Modules

**ADW ID:** tdauam-promotion-commenter
**Date:** 2026-05-21
**Specification:** specs/issue-509-adw-tdauam-promotion-commenter-sdlc_planner-promotion-commenter-deep-modules.md

## Overview

This is slice #4 of the scenario rot-prevention and promotion PRD. It ships five pure deep modules under `adws/promotion/` (vocabulary parsing, scenario parsing, scoring, threshold, and tag writing) plus a thin coordination layer (`promotionCommenter`) and a CLI orchestrator (`adwPromotionSweep.tsx`). Together they form the first end-to-end vertical: a per-issue PR is evaluated → high-scoring scenarios receive a `@promotion-suggested-<date>` tag inserted inline → a comment is posted on the PR.

## What Was Built

- `adws/promotion/vocabularyParser.ts` — parses `features/regression/vocabulary.md` into a `Map<phrase, VocabularyEntry>` and an ordered `surfaceExamples` list
- `adws/promotion/scenarioParser.ts` — thin wrapper around `@cucumber/gherkin`; returns structured `Scenario[]` with tags, steps, and line positions
- `adws/promotion/promotionScorer.ts` — pure scoring function returning `{ total, breakdown }` using named weight constants (surface match 3, subprocess 3, phase-import 2, extra phase 1, mock-query 0)
- `adws/promotion/promotionThreshold.ts` — returns hardcoded bootstrap constant `3` (auto-ramp formula deferred to slice #7)
- `adws/promotion/promotionTagWriter.ts` — pure string transform; inserts `@promotion-suggested-<today>` tag above scenario header with byte-exact preservation
- `adws/promotion/promotionCommenter.ts` — thin coordination function with injected deps; composes the five deep modules and owns all GitHub API surface
- `adws/adwPromotionSweep.tsx` — CLI orchestrator entry point; resolves PR from issue number, wires default deps, invokes `runPromotionCommenter`
- Six unit test files under `adws/promotion/__tests__/` covering every branch of every module
- `features/regression/smoke/promotion_commenter.feature` — regression smoke scenario (pending pattern)
- `features/per-issue/feature-509.feature` — per-issue BDD acceptance scenarios
- Five mock manifest fixtures under `test/fixtures/jsonl/manifests/`

## Technical Implementation

### Files Modified

- `adws/adwPromotionSweep.tsx`: new CLI orchestrator; no lifecycle wrapper (deferred to slice #5)
- `adws/promotion/index.ts`: barrel export for all six public surfaces + types
- `adws/promotion/types.ts`: shared interfaces (`Scenario`, `VocabularyRegistry`, `ScoreResult`, `PromotionStats`, `TagState`, etc.)
- `adws/promotion/vocabularyParser.ts`: parses Given/When/Then Markdown tables + `## Observability Surfaces (Examples)` section
- `adws/promotion/scenarioParser.ts`: wraps `@cucumber/gherkin` `Parser` + `AstBuilder` + `GherkinClassicTokenMatcher`
- `adws/promotion/promotionScorer.ts`: three-axis scorer (surfaceMatch, executionPattern, phaseCount) with longest-match phrase resolution
- `adws/promotion/promotionThreshold.ts`: hardcoded `BOOTSTRAP_THRESHOLD = 3`
- `adws/promotion/promotionTagWriter.ts`: walks backward from scenario header to find tag block; appends or inserts new tag line
- `adws/promotion/promotionCommenter.ts`: filters `features/per-issue/feature-*.feature` changed files, scores each scenario, writes tag, posts consolidated comment
- `features/regression/step_definitions/whenSteps.ts`: added `'promotion-sweep': 'adwPromotionSweep.tsx'` to `ORCHESTRATOR_FILES`
- `package.json` + `bun.lock`: added `@cucumber/gherkin` and `@cucumber/messages` as runtime deps

### Key Changes

- **Scoring weights are named constants** in `promotionScorer.ts` (`SURFACE_MATCH_WEIGHT`, `SUBPROCESS_WEIGHT`, etc.) so slice #7 can tune them without searching for magic numbers.
- **Dep-injection pattern** on `promotionCommenter` (`deps?: PromotionCommenterDeps`) mirrors `perIssueScenarioSweep.ts` — all file I/O and HTTP calls are injected, making the coordination layer fully unit-testable without module mocks.
- **Byte-exact tag insertion**: `promotionTagWriter` splits on `\n`, locates the header line (1-based → 0-based), walks backward for a contiguous tag block, and appends or splices — the `join('\n')` round-trip is lossless.
- **Content threading** in `promotionCommenter`: after each tag write within a single file, the updated content is threaded to subsequent scenarios so line positions remain valid for multi-scenario files.
- **No `runWithOrchestratorLifecycle` wrapper**: the orchestrator is intentionally lightweight (event-driven, short-lived); spawn lock + heartbeat are deferred to slice #5.

## How to Use

1. Ensure `.adw/scenarios.md` contains `## Vocabulary Registry: features/regression/vocabulary.md` (set by `adwInit` in slice #2).
2. Invoke the orchestrator against an open per-issue PR:
   ```
   bunx tsx adws/adwPromotionSweep.tsx <issueNumber> [adwId]
   ```
3. The orchestrator resolves the PR for `feature-<issueNumber>`, fetches changed files, scores every scenario in `features/per-issue/feature-<N>.feature` files, inserts `@promotion-suggested-<today>` tags on scenarios scoring ≥ 3, and posts a single PR comment listing all suggestions.
4. To invoke programmatically, import and call `runPromotionCommenter(prNumber, deps)` from `adws/promotion/index.ts` with injected deps.

## Configuration

| Setting | Source | Default |
|---|---|---|
| Vocabulary path | `.adw/scenarios.md` `## Vocabulary Registry` | `features/regression/vocabulary.md` |
| Promotion threshold | `promotionThreshold.computeThreshold()` | `3` (hardcoded until slice #7) |
| Per-issue file glob | `PER_ISSUE_RE` in `promotionCommenter.ts` | `features/per-issue/feature-\d+\.feature` |

No environment variables are required beyond the standard `GH_TOKEN` / `GITHUB_PAT` used by the rest of ADW.

## Testing

```sh
# Unit tests (six new test files)
bun run test:unit

# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Regression smoke (pending pattern — documents contract)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"

# CLI smoke
bunx tsx adws/adwPromotionSweep.tsx --help 2>&1 | head -20
```

## Notes

- **Deferred to slice #5**: `hitl` label application, duplicate-suppression (no re-comment same day), `promotionTagWriter` date-refresh and tag-removal operations, `@promotion` (no date) approval detection, `promotionMover` orchestrator.
- **Deferred to slice #6**: webhook wiring (`pull_request.opened` / `pull_request.synchronize` → spawn `adwPromotionSweep.tsx`).
- **Deferred to slice #7**: auto-ramp formula in `promotionThreshold` driven by the 90-day promotion-activity ratio.
- **Known limitation**: if a scenario already carries a `@promotion-suggested-<other-date>` tag, this slice appends a second tag literal rather than refreshing the date. Slice #5 resolves this with the date-refresh operation.
- **Idempotency**: `applyTagState` with `'add-suggestion'` is byte-stable for a fixed `(content, scenarioHeaderLine, today)` triple — running twice in one day produces an identical file write (no-op against the filesystem). Duplicate PR comments are not suppressed until slice #5.
