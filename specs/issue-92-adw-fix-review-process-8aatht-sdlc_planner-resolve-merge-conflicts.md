# Feature: Resolve merge conflicts for PR #92 (fix review process)

## Metadata
issueNumber: `92`
adwId: `fix-review-process-8aatht`
issueJson: `{"number":92,"title":"feat: #90 - Fix review process","body":"## Summary\n\nOverhauls the ADW review process to address two key shortcomings identified in issue #90:\n\n1. **Externalized proof requirements**: Instead of hardcoding screenshot-based proof in `.claude/commands/review.md`, each target application now defines its own proof requirements in `.adw/review_proof.md`. The `/review` command reads this file at runtime and follows its instructions.\n2. **Multi-agent parallel review**: 3 independent review agents run in parallel per review iteration. Results are collected, deduplicated, and collated. If blockers are found, a single patch agent fixes them and a new round of 3 review agents runs. This continues until no blockers remain or max retries are exhausted.\n\nCloses #90\n\nADW tracking ID: fix-review-process-8aatht","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-06T14:37:32Z","comments":[{"author":"paysdoc","createdAt":"2026-03-09T07:40:33Z","body":"Resolve conflicts"},{"author":"paysdoc","createdAt":"2026-03-09T07:40:55Z","body":"## Take action\r\nresolve conflicts"}],"actionableComment":"resolve conflicts"}`

## Feature Description
PR #92 (`feature-issue-90-fix-review-process` branch) has merge conflicts with `main`. Since the PR was opened, several PRs have been merged into `main` (issues #88 review comments, #91 move-to-review-after-steps, plus cost data commits). These introduced changes to `reviewRetry.ts` and `workflowPhases.test.ts` that conflict with the multi-agent review refactor on the feature branch.

The conflicts center on the `ReviewRetryResult` interface and its consumers — main added `reviewSummary`, `onPatchingIssue`, `ctx.reviewIssues`, and `moveIssueToStatus` support, while the feature branch replaced the single-agent model with multi-agent review using `allScreenshots`/`allSummaries` and removed those callbacks/fields.

## User Story
As a maintainer
I want to resolve the merge conflicts on PR #92
So that the multi-agent review feature can be merged into main

## Problem Statement
PR #92 (`feature-issue-90-fix-review-process`) is in a CONFLICTING merge state with `main`. Two files have content conflicts:
1. `adws/agents/reviewRetry.ts` — conflicting `ReviewRetryResult` interface fields (`allScreenshots`/`allSummaries` vs `reviewSummary`)
2. `adws/__tests__/workflowPhases.test.ts` — conflicting mock return values for `runReviewWithRetry`

Additionally, the auto-merged `adws/phases/workflowLifecycle.ts` requires verification because the feature branch removed `onPatchingIssue`, `ctx.reviewSummary`, `ctx.reviewIssues`, and `moveIssueToStatus` that main added — the auto-merge may not produce correct results.

## Solution Statement
Merge `main` into `feature-issue-90-fix-review-process`, resolving conflicts by:

1. **Keeping multi-agent architecture** from the feature branch (3 parallel agents, `mergeReviewResults`, `REVIEW_AGENT_COUNT`)
2. **Integrating `reviewSummary`** from main into the multi-agent result — derive it by joining `allSummaries` or picking the first non-empty summary
3. **Integrating `onPatchingIssue` callback** from main into the multi-agent retry loop so review patching comments still work
4. **Restoring `ctx.reviewSummary` and `ctx.reviewIssues`** in `workflowLifecycle.ts` so workflow comments include review details
5. **Keeping `moveIssueToStatus`** removal (issue #91 moved this to `completeWorkflow` instead)
6. **Updating all tests** to match the merged interface

## Relevant Files
Use these files to implement the feature:

- `adws/agents/reviewRetry.ts` — **CONFLICTED**: Multi-agent review retry loop. Must merge `ReviewRetryResult` to include both `allScreenshots`/`allSummaries` AND `reviewSummary`. Must restore `onPatchingIssue` callback in `ReviewRetryOptions`.
- `adws/__tests__/workflowPhases.test.ts` — **CONFLICTED**: Tests for workflow phases. Mock `runReviewWithRetry` returns must include all fields from the merged `ReviewRetryResult`.
- `adws/phases/workflowLifecycle.ts` — **AUTO-MERGED, NEEDS VERIFICATION**: The `executeReviewPhase` function must pass `onPatchingIssue` to `runReviewWithRetry` and set `ctx.reviewSummary`/`ctx.reviewIssues` from the result.
- `adws/__tests__/reviewRetry.test.ts` — Tests for multi-agent review retry. May need updates if `onPatchingIssue` is restored.
- `adws/github/workflowCommentsIssue.ts` — Defines `WorkflowContext` with `reviewSummary` field. Reference only.

### New Files
None — this is a conflict resolution task.

## Implementation Plan
### Phase 1: Merge main and resolve conflicts
Checkout the feature branch, merge main, and resolve the two file conflicts.

### Phase 2: Reconcile interfaces
Update `ReviewRetryResult` to include both the multi-agent fields (`allScreenshots`, `allSummaries`) and the review-comment fields (`reviewSummary`). Add `onPatchingIssue` back to `ReviewRetryOptions`. Derive `reviewSummary` from `allSummaries`.

### Phase 3: Fix consumers and tests
Update `workflowLifecycle.ts` to pass `onPatchingIssue` and read `reviewSummary` from the result. Update all test mocks to include the full merged interface fields.

## Step by Step Tasks

### Step 1: Checkout feature branch and merge main
- Run `git checkout feature-issue-90-fix-review-process`
- Run `git merge origin/main` — this will produce conflicts in `adws/agents/reviewRetry.ts` and `adws/__tests__/workflowPhases.test.ts`

### Step 2: Resolve `adws/agents/reviewRetry.ts` conflicts
- In the `ReviewRetryResult` interface, keep ALL fields from both sides:
  ```typescript
  export interface ReviewRetryResult {
    passed: boolean;
    costUsd: number;
    totalRetries: number;
    blockerIssues: ReviewIssue[];
    modelUsage: ModelUsageMap;
    reviewSummary?: string;      // from main — used by workflow comments
    allScreenshots: string[];    // from feature — multi-agent screenshots
    allSummaries: string[];      // from feature — multi-agent summaries
  }
  ```
- In `ReviewRetryOptions`, restore `onPatchingIssue` callback from main:
  ```typescript
  onReviewFailed?: (attempt: number, maxAttempts: number, blockerIssues: ReviewIssue[]) => void;
  onPatchingIssue?: (issue: ReviewIssue) => void;
  ```
- In the `runReviewWithRetry` function body:
  - Keep the multi-agent parallel review logic (feature branch)
  - Keep `allScreenshots` and `allSummaries` collection logic (feature branch)
  - Add `onPatchingIssue` destructuring and calls during the patching loop (from main)
  - Derive `reviewSummary` from `allSummaries`: e.g., `allSummaries.join('\n\n')` or the first non-empty summary
  - In the return statements, include both `allScreenshots`, `allSummaries`, AND `reviewSummary`
  - In the `onReviewFailed` call, pass `blockerIssues` as the third argument (from main's signature)

### Step 3: Resolve `adws/__tests__/workflowPhases.test.ts` conflicts
- For every mock `runReviewWithRetry` return value, include ALL fields:
  ```typescript
  {
    passed: true/false,
    costUsd: ...,
    totalRetries: ...,
    blockerIssues: [...],
    modelUsage: {},
    reviewSummary: 'All good',    // from main
    allScreenshots: [],            // from feature
    allSummaries: [],              // from feature
  }
  ```
- Keep the more detailed test assertions from main that verify `reviewSummary` is passed through (e.g., the `review_passed` comment including `reviewSummary: 'All good'`)
- Also keep the feature branch tests that removed `moveIssueToStatus` assertions (since issue #91 moved that logic)

### Step 4: Verify and fix `adws/phases/workflowLifecycle.ts`
- Read the auto-merged file and verify `executeReviewPhase`:
  - Must import `moveIssueToStatus` — wait, issue #91 removed it from here. Check if the feature branch's removal is correct. If `completeWorkflow` now calls it, then removing it from `executeReviewPhase` is correct.
  - Must pass `onPatchingIssue` callback to `runReviewWithRetry`:
    ```typescript
    onPatchingIssue: (issue) => {
      ctx.patchingIssue = issue;
      postWorkflowComment(issueNumber, 'review_patching', ctx, repoInfo);
    },
    ```
  - Must set `ctx.reviewSummary = reviewResult.reviewSummary;` after review passes
  - Must set `ctx.reviewIssues = reviewResult.blockerIssues;` for both pass and fail paths
  - Must set `ctx.reviewAttempt` and `ctx.maxReviewAttempts` before posting `review_running`
  - Must pass `blockerIssues` in `onReviewFailed` callback

### Step 5: Update `adws/__tests__/reviewRetry.test.ts` if needed
- If `onPatchingIssue` was restored in `ReviewRetryOptions`, verify the tests don't break
- Tests should verify `onPatchingIssue` is called during patching
- Verify `reviewSummary` is included in test result assertions

### Step 6: Run validation commands
- Run all validation commands to ensure zero regressions

## Testing Strategy
### Unit Tests
- `adws/__tests__/reviewRetry.test.ts` — verify multi-agent review produces results with both `allScreenshots`/`allSummaries` AND `reviewSummary`
- `adws/__tests__/workflowPhases.test.ts` — verify `executeReviewPhase` passes `onPatchingIssue` and sets `ctx.reviewSummary`
- All existing tests must pass with no regressions

### Edge Cases
- `reviewSummary` derivation when `allSummaries` is empty (should be `undefined`)
- `onPatchingIssue` called for each blocker in multi-agent merged results
- Deduplication still works correctly after merge

## Acceptance Criteria
- PR #92 is no longer in CONFLICTING state — `git merge origin/main` succeeds cleanly
- `ReviewRetryResult` includes `reviewSummary`, `allScreenshots`, and `allSummaries`
- `ReviewRetryOptions` includes `onPatchingIssue` callback
- `workflowLifecycle.ts` passes `onPatchingIssue` and sets `ctx.reviewSummary`/`ctx.reviewIssues`
- All tests pass: `bun run test`
- Linter passes: `bun run lint`
- Build passes: `bun run build`
- Type check passes: `bunx tsc --noEmit -p adws/tsconfig.json`

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws scripts
- `bun run test` — Run all tests to validate zero regressions

## Notes
- The feature branch removed `moveIssueToStatus` from `completeWorkflow` — this is correct because issue #91 already moved that call. Verify `completeWorkflow` on `main` still has it via the #91 merge.
- The feature branch simplified `onReviewFailed` to 2 args `(attempt, maxAttempts)`. Main uses 3 args `(attempt, maxAttempts, blockerIssues)`. The merged version should use 3 args so that `workflowLifecycle.ts` can update `ctx.reviewIssues`.
- The feature branch removed `ctx.reviewAttempt` and `ctx.maxReviewAttempts` assignments. These should be restored so the `review_running` comment shows attempt information.
- Read `app_docs/feature-add-issue-comments-f-6vrgn2-review-issue-comments.md` for context on the review comment system added by issue #88.
