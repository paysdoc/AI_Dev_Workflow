# Feature: Move issue to Review only after review and document steps complete

## Metadata
issueNumber: `91`
adwId: `an-issue-should-only-le1hqx`
issueJson: `{"number":91,"title":"An issue should only be moved to Review once the review and document step are done","body":"","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-06T14:35:09Z","comments":[],"actionableComment":null}`

## Feature Description
Currently, `executePRPhase` in `adws/phases/prPhase.ts` calls `moveIssueToStatus(issueNumber, 'Review', repoInfo)` immediately after creating the pull request. In orchestrators like `adwSdlc.tsx`, this means the issue is moved to "Review" on the project board before the review and document phases have even started. The issue should only be moved to "Review" once the entire workflow completes successfully, meaning all phases (including review and document) are done.

## User Story
As a project manager
I want issues to only appear in "Review" on the project board after the review and document steps complete
So that the board accurately reflects the true state of work

## Problem Statement
The `moveIssueToStatus(issueNumber, 'Review')` call is placed in `executePRPhase` (prPhase.ts:69), which runs before the review and document phases in multi-phase orchestrators. This causes the issue to be moved to "Review" prematurely on the GitHub project board, before the automated review and documentation steps have finished.

## Solution Statement
Remove the `moveIssueToStatus` call from `executePRPhase` and move it into `completeWorkflow` in `workflowLifecycle.ts`. This ensures the issue is only moved to "Review" after all workflow phases (including review and document) have completed successfully. This approach works correctly for all orchestrators since `completeWorkflow` is always called at the end of every workflow, regardless of which phases are included.

## Relevant Files
Use these files to implement the feature:

- `adws/phases/prPhase.ts` — Contains the premature `moveIssueToStatus(issueNumber, 'Review', repoInfo)` call on line 69 that needs to be removed. Also remove the `moveIssueToStatus` import since it will no longer be used here.
- `adws/phases/workflowLifecycle.ts` — Contains the `completeWorkflow` function where the `moveIssueToStatus` call should be added. Already imports from `../github` but needs `moveIssueToStatus` added to that import.
- `adws/__tests__/workflowPhases.test.ts` — Contains tests for `executePRPhase` and `completeWorkflow` that need updating. The existing mock for `moveIssueToStatus` is already set up on line 118.
- `adws/github/projectBoardApi.ts` — Contains the `moveIssueToStatus` function (read-only reference, no changes needed).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Implementation Plan
### Phase 1: Foundation
No foundational work needed. The `moveIssueToStatus` function already exists and is exported. This is purely a relocation of an existing call.

### Phase 2: Core Implementation
1. Remove `moveIssueToStatus` from `prPhase.ts` — delete the call on line 69 and remove it from the import on line 15.
2. Add `moveIssueToStatus` to `completeWorkflow` in `workflowLifecycle.ts` — import the function and call it at the end of `completeWorkflow`, after posting the completion comment.

### Phase 3: Integration
Update existing tests in `workflowPhases.test.ts`:
- Remove the assertion that `moveIssueToStatus` is called during `executePRPhase`.
- Add an assertion that `moveIssueToStatus` is called with `'Review'` during `completeWorkflow`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove moveIssueToStatus from prPhase.ts
- Remove `moveIssueToStatus` from the import statement on line 15 (from `'../github'`). Since `postWorkflowComment` is the only remaining import from `'../github'`, simplify the import accordingly.
- Delete the `await moveIssueToStatus(issueNumber, 'Review', repoInfo);` call on line 69.

### Step 2: Add moveIssueToStatus to completeWorkflow in workflowLifecycle.ts
- Add `moveIssueToStatus` to the existing import from `'../github'` on line 9 (which already imports `fetchGitHubIssue`, `postWorkflowComment`, etc.).
- In the `completeWorkflow` function, add `await moveIssueToStatus(issueNumber, 'Review', repoInfo);` after the `postWorkflowComment(issueNumber, 'completed', ctx, repoInfo)` call (after line 388) but before the final log banner.

### Step 3: Update tests in workflowPhases.test.ts
- In the `executePRPhase` describe block, verify that `moveIssueToStatus` is NOT called. Add an assertion: `expect(moveIssueToStatus).not.toHaveBeenCalled()` to the "creates PR when stage should execute" test (around line 646).
- In the `completeWorkflow` describe block (find it by searching for `describe('completeWorkflow'`), add a new test that verifies `moveIssueToStatus` is called with `(1, 'Review', undefined)` when `completeWorkflow` is called.

### Step 4: Run validation commands
- Run all validation commands to ensure zero regressions.

## Testing Strategy
### Unit Tests
- Verify `executePRPhase` no longer calls `moveIssueToStatus`.
- Verify `completeWorkflow` calls `moveIssueToStatus(issueNumber, 'Review', repoInfo)`.
- Verify existing `completePRReviewWorkflow` tests still pass (it has its own independent `moveIssueToStatus` call that should not be affected).

### Edge Cases
- Orchestrators without review/document phases (e.g., `adwPlanBuild.tsx`) still call `completeWorkflow`, so they will correctly move to "Review" after all their phases complete.
- The `moveIssueToStatus` function already handles edge cases gracefully (no project, issue not in project, already in status, etc.), so no additional error handling is needed.
- The `completePRReviewWorkflow` in `prReviewPhase.ts` has its own `moveIssueToStatus` call (line 332) which is independent and correct — it should not be changed.

## Acceptance Criteria
- `executePRPhase` does NOT call `moveIssueToStatus`.
- `completeWorkflow` calls `moveIssueToStatus(issueNumber, 'Review', repoInfo)` after posting the completion comment.
- All existing tests pass with zero regressions.
- The `completePRReviewWorkflow` `moveIssueToStatus` call remains unchanged.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws project
- `bun run test` - Run all tests to validate the feature works with zero regressions

## Notes
- This is a minimal change: one line removed from `prPhase.ts`, one line + one import addition in `workflowLifecycle.ts`, and test updates.
- The `completePRReviewWorkflow` in `prReviewPhase.ts` (line 332) has its own `moveIssueToStatus` call that is independent of this change and should remain as-is. That workflow handles PR review comments (a different flow than the main SDLC orchestrators).
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
