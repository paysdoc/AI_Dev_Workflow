# Fix: PR Review Workflow Targets Correct Repository

**ADW ID:** ie8l08-wrong-repository-bei
**Date:** 2026-03-17
**Specification:** specs/issue-223-adw-ie8l08-wrong-repository-bei-sdlc_planner-fix-pr-review-target-repo.md

## Overview

When `adwPrReview.tsx` processed a PR from a target repository (e.g., `paysdoc/vestmatic`), all git operations (branch lookup, worktree creation) were incorrectly executed against the ADW repository instead of the target repository. This fix threads the `targetRepo` parameter through `adwPrReview.tsx` into `initializePRReviewWorkflow`, which now resolves the target repo workspace path and passes it as `baseRepoPath` to `ensureWorktree`.

## What Was Built

- `targetRepo?: TargetRepoInfo` parameter added to `initializePRReviewWorkflow` signature
- Target repo workspace resolution inside `initializePRReviewWorkflow` using `ensureTargetRepoWorkspace`
- `baseRepoPath` forwarded to `ensureWorktree` so git commands run against the correct repo
- `adwPrReview.tsx` updated to pass the full `targetRepo` object to `initializePRReviewWorkflow`
- BDD regression scenarios (`@adw-223`) added to `features/wrong_repository_target.feature`
- Step definitions added in `features/step_definitions/wrongRepositoryTargetSteps.ts`

## Technical Implementation

### Files Modified

- `adws/phases/prReviewPhase.ts`: Added `targetRepo?: TargetRepoInfo` parameter, imported `ensureTargetRepoWorkspace` and `TargetRepoInfo` from `../core`, added workspace resolution block before `ensureWorktree`, passed `targetRepoWorkspacePath` as third argument to `ensureWorktree`
- `adws/adwPrReview.tsx`: Updated `initializePRReviewWorkflow` call to pass `targetRepo ?? undefined` as the fifth argument

### Files Added

- `features/wrong_repository_target.feature`: New BDD feature file with `@adw-223 @regression` scenarios covering `initializePRReviewWorkflow`, `ensureWorktree`, and the `adwPrReview.tsx` entry-point
- `features/step_definitions/wrongRepositoryTargetSteps.ts`: Step definitions that verify source-level presence of `ensureTargetRepoWorkspace` import/call, `baseRepoPath` argument, and `targetRepo` pass-through

### Key Changes

- `initializePRReviewWorkflow` now accepts an optional fifth parameter `targetRepo?: TargetRepoInfo`
- When `targetRepo` is provided, `ensureTargetRepoWorkspace(targetRepo)` is called to clone/pull and return the workspace path
- `ensureWorktree(prDetails.headBranch, undefined, targetRepoWorkspacePath)` — `baseRepoPath` is now populated for target-repo PRs
- Pattern mirrors the existing fix in `workflowInit.ts` (lines 140–168)
- This closes the 7th recurrence of the "wrong repository" bug class (issues #23, #33, #52, #56, #62, #119, #217)

## How to Use

This fix is transparent — no configuration changes are required. When the cron trigger calls `adwPrReview.tsx` with `--target-repo owner/repo --clone-url <url>`, the resolved workspace is now automatically forwarded into the PR review workflow.

1. Ensure `--target-repo` and `--clone-url` flags are present in the `adwPrReview.tsx` invocation (already set by the cron trigger)
2. `adwPrReview.tsx` parses these into a `TargetRepoInfo` object and passes it to `initializePRReviewWorkflow`
3. `initializePRReviewWorkspace` resolves the workspace, then creates the worktree inside the target repo

## Configuration

No new environment variables or configuration files required. The existing `--target-repo` and `--clone-url` CLI arguments are sufficient.

## Testing

```bash
# Run regression scenarios specific to this fix
bunx cucumber-js --tags "@adw-223"

# Verify no regressions in existing PR review worktree scenarios
bunx cucumber-js --tags "@adw-217"

# Full regression suite
bunx cucumber-js --tags "@regression"

# TypeScript type checks
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Linter
bun run lint
```

## Notes

- Surgical fix: only 2 source files changed (`prReviewPhase.ts`, `adwPrReview.tsx`)
- The `ensureWorktree` and `ensureTargetRepoWorkspace` functions already supported this use-case — no changes needed there
- BDD regression scenarios are static source-inspection tests (no runtime side-effects) and will prevent this specific execution path from regressing
