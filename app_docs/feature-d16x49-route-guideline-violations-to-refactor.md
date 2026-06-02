# Route Guideline Violations to /refactor via remediationStrategy

**ADW ID:** d16x49-review-route-guideli
**Date:** 2026-06-02
**Specification:** specs/issue-533-adw-d16x49-review-route-guideli-sdlc_planner-route-guideline-violations-to-refactor.md

## Overview

This feature routes coding-guideline violations found in changed files to the `/refactor` skill instead of logging them as non-blocking `tech-debt`. A new `remediationStrategy` field on `ReviewIssue` lets the reviewer emit a consolidated blocker that `executeReviewPatchCycle` dispatches to a thin `refactorAgent` wrapper, ensuring ADW enforces `.adw/coding_guidelines.md` automatically before a PR is approved.

## What Was Built

- `remediationStrategy?: 'refactor' | 'patch'` field on `ReviewIssue` type and `reviewResultSchema`
- New `adws/agents/refactorAgent.ts` — thin slash-command wrapper that invokes `/refactor` with the consolidated blocker's `issueDescription`
- New `adws/phases/reviewPatchHelpers.ts` — extracted `applyPatchBlocker` and `applyRefactorBlockers` helpers (depth-1 loop bodies in `executeReviewPatchCycle`)
- Updated `executeReviewPatchCycle` in `adws/phases/reviewPhase.ts` to split blockers by `remediationStrategy` and run patch blockers first, then refactor blockers, then a single commit+push
- `/refactor` registered in the `SlashCommand` union and all four routing maps (`sonnet`/`high`)
- Updated `.claude/commands/review.md` Step 3 to scope guideline checks to `git diff` changed files only and emit one consolidated `blocker` with `remediationStrategy: "refactor"`
- Updated `.claude/commands/pr_review.md` with a planning directive to add a `/refactor` plan step for changed-file guideline violations
- Unit tests: `adws/agents/__tests__/refactorAgent.test.ts` and `adws/phases/__tests__/reviewPhase.test.ts`
- BDD acceptance scenarios: `features/per-issue/feature-533.feature` with full step definitions

## Technical Implementation

### Files Modified

- `adws/agents/reviewAgent.ts`: Added `remediationStrategy?: 'refactor' | 'patch'` to `ReviewIssue` and `reviewResultSchema`
- `adws/types/issueTypes.ts`: Added `'/refactor'` to `SlashCommand` union
- `adws/core/modelRouting.ts`: Added `/refactor` entries to all four routing maps (`sonnet`/`high` in both normal and fast variants)
- `adws/phases/reviewPhase.ts`: Refactored `executeReviewPatchCycle` to split blockers and delegate to helpers from `reviewPatchHelpers.ts`; removed inline `runPatchAgent`/`runBuildAgent` imports
- `.claude/commands/review.md`: Step 3 now scopes to changed files and emits a single consolidated refactor blocker instead of per-violation `tech-debt` items
- `.claude/commands/pr_review.md`: Added planning directive to include `/refactor` step for guideline violations in changed files

### New Files

- `adws/agents/refactorAgent.ts`: `runRefactorAgent(adwId, refactorBlocker, logsDir, statePath?, cwd?, issueBody?)` — forwards `refactorBlocker.issueDescription` verbatim to `/refactor` so the skill has a clean file list with rule context
- `adws/phases/reviewPatchHelpers.ts`: `applyPatchBlocker(blocker, ctx)` and `applyRefactorBlockers(blockers, ctx)` — extracted from `executeReviewPatchCycle` to satisfy max-depth-2 nesting guideline
- `adws/agents/__tests__/refactorAgent.test.ts`: Verifies command, args, output file, model, and effort
- `adws/phases/__tests__/reviewPhase.test.ts`: Four cases (patch-only, refactor-only, mixed, absent-strategy defaults to patch)

### Key Changes

- **Blocker routing**: `executeReviewPatchCycle` now computes `patchBlockers` (default) and `refactorBlockers` before the remediation loop; patch blockers run first, refactor blockers run after, single commit+push at the end — function signature unchanged so all four orchestrators pick this up transparently
- **Consolidated blocker contract**: The reviewer emits exactly one refactor blocker whose `issueDescription` lists affected files and violated rules; `applyRefactorBlockers` handles >1 defensively by sequencing them with a warning log
- **Scoped guideline check**: `review.md` Step 3 now runs `git diff origin/<default> --name-only` first and only inspects those files — pre-existing violations in untouched files no longer become blockers
- **Helper extraction**: `reviewPatchHelpers.ts` keeps `executeReviewPatchCycle` at depth 1 per the nesting guideline; both helpers expose `PatchCtx` / `RefactorCtx` interfaces for type-safe dependency injection in tests
- **Refactor always triggers build**: Unlike patch (build only on patch success), `applyRefactorBlockers` always follows the refactor with a `runBuildAgent` call to verify the refactored code compiles

## How to Use

The feature is fully automatic within the SDLC and PR review pipelines:

1. When a review cycle runs and the changed files have guideline violations, `review.md` Step 3 emits a single `blocker` with `remediationStrategy: "refactor"`.
2. `executeReviewPatchCycle` detects the blocker's strategy and calls `applyRefactorBlockers` instead of `applyPatchBlocker`.
3. `runRefactorAgent` invokes `/refactor <adwId> <issueDescription>` — the description contains the file list and violated rules.
4. The `/refactor` skill applies the guidelines; `runBuildAgent` verifies the result compiles.
5. `runCommitAgent` + `pushBranch` commit all changes in one commit, same as the patch path.
6. The orchestrator's `MAX_REVIEW_RETRY_ATTEMPTS` cap prevents infinite loops if violations persist.

No operator intervention or configuration is required. The only prerequisite is that `.adw/coding_guidelines.md` exists in the target repository.

## Configuration

No new configuration is required. The feature uses existing infrastructure:

- `.adw/coding_guidelines.md` — must be present for Step 3 to emit any blocker; if absent, the step is skipped silently
- `MAX_REVIEW_RETRY_ATTEMPTS` — existing cap in each orchestrator controls the retry limit for persistent violations
- Model/effort: `/refactor` is routed to `sonnet`/`high` (both normal and fast/cheap modes)

## Testing

**Unit tests** (vitest):
```
bun run test:unit
```
Key test files:
- `adws/agents/__tests__/refactorAgent.test.ts` — arg formatting, output file path, model/effort lookup
- `adws/phases/__tests__/reviewPhase.test.ts` — blocker splitting, execution order, single commit, cost aggregation

**BDD acceptance scenarios** (Cucumber):
```
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-533"
```

**Regression suite**:
```
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- `prReviewPhase.ts` is not directly modified. `adwPrReview.tsx` already calls `executeReviewPatchCycle` from `reviewPhase.ts`, so the routing change is picked up automatically by every orchestrator (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwPrReview`).
- The `/refactor` skill was recently updated (commits `c2a9200`, `4da4628`) to require an explicit file list and exit silently when no files are passed. `runRefactorAgent` forwards `issueDescription` verbatim to preserve both the file list and the rule context.
- Infinite-loop protection relies entirely on the existing `MAX_REVIEW_RETRY_ATTEMPTS` cap — no additional guard is added per spec.
- Future consideration (out of scope): tightening the reviewer prompt to prevent multiple non-consolidated refactor blockers arriving; `applyRefactorBlockers` already handles this defensively.
