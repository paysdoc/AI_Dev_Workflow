# Feature: Return Issue to "Review" Status After PR Review Completion

## Metadata
issueNumber: `68`
adwId: `pr-review-adw-should-j6e9ay`
issueJson: `{"number":68,"title":"PR Review ADW should return issue to \"Review\"","body":"When the PrReview ADW is triggered (a pull request has received on or more review comments), the orchestrator correctly sets the issue status back to `In Progress`. \nHowever, when the PrReview process is done, the issue needs to be returned to `Review`, provided that status exists in the GH project.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-04T13:59:01Z","comments":[],"actionableComment":null}`

## Feature Description
When the PR Review ADW workflow completes successfully (after plan, build, test, commit, and push), the linked GitHub issue should be moved back to the "Review" status on the GitHub project board. Currently, the issue remains in "In Progress" after the PR review workflow finishes. The `moveIssueToStatus` function already handles gracefully skipping if the target status doesn't exist in the project, so this is safe to add unconditionally.

## User Story
As a developer using ADW
I want the issue to automatically return to "Review" status when a PR review workflow completes
So that the project board accurately reflects which issues are awaiting review vs actively being worked on

## Problem Statement
When the PR Review ADW is triggered by review comments on a pull request, the issue status is set to "In Progress" to indicate work is happening. However, when the PR review process completes successfully, the issue is never moved back to "Review" — leaving the project board in an inaccurate state.

## Solution Statement
Add a `moveIssueToStatus(issueNumber, 'Review', repoInfo)` call to the `completePRReviewWorkflow` function in `adws/phases/prReviewPhase.ts`, following the same pattern used by `executePRPhase` in `adws/phases/prPhase.ts`. The existing `moveIssueToStatus` function already handles edge cases (status not found, issue not in project, already in target status), so no additional error handling is needed.

## Relevant Files
Use these files to implement the feature:

- `adws/phases/prReviewPhase.ts` — Contains `completePRReviewWorkflow` where the status change needs to be added. This is the primary file to modify.
- `adws/phases/prPhase.ts` — Reference implementation showing how `moveIssueToStatus` is called after PR creation (line 69). Use as a pattern to follow.
- `adws/github/projectBoardApi.ts` — Contains the `moveIssueToStatus` function that handles moving issues across project board statuses. Already exported via `adws/github/index.ts`.
- `adws/github/index.ts` — Re-exports `moveIssueToStatus` from `projectBoardApi.ts`.
- `adws/__tests__/workflowPhases.test.ts` — Contains existing tests for `completePRReviewWorkflow`. Add a new test to verify the status change.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Implementation Plan
### Phase 1: Foundation
No foundational work needed. The `moveIssueToStatus` function already exists and is exported. The PR review phase module just needs to import and call it.

### Phase 2: Core Implementation
1. Import `moveIssueToStatus` from `../github` in `adws/phases/prReviewPhase.ts`
2. Add `await moveIssueToStatus(config.issueNumber, 'Review', config.repoInfo)` to `completePRReviewWorkflow`, after pushing the branch and posting completion comments but before writing the final execution state

### Phase 3: Integration
The change integrates naturally with the existing workflow. The `moveIssueToStatus` function:
- Uses fuzzy matching (e.g., "Review" matches "In Review")
- Gracefully skips if the status doesn't exist in the project
- Gracefully skips if the issue is not on a project board
- Gracefully skips if the issue is already in the target status
- Logs the outcome for debugging

## Step by Step Tasks

### Step 1: Add `moveIssueToStatus` import to `prReviewPhase.ts`
- Open `adws/phases/prReviewPhase.ts`
- Add `moveIssueToStatus` to the existing import from `../github` (line 8)

### Step 2: Call `moveIssueToStatus` in `completePRReviewWorkflow`
- In `completePRReviewWorkflow` function, add `await moveIssueToStatus(config.issueNumber, 'Review', config.repoInfo)` after the `pushBranch` and `postPRWorkflowComment` calls (after line 330) but before writing the final execution state
- This follows the same pattern as `executePRPhase` in `prPhase.ts` (line 69)

### Step 3: Add unit test for the new behavior
- In `adws/__tests__/workflowPhases.test.ts`, add a new test case in the `completePRReviewWorkflow` describe block
- Test that `moveIssueToStatus` is called with `(issueNumber, 'Review', repoInfo)` when the workflow completes
- Verify it's called with the correct arguments from the config

### Step 4: Run validation commands
- Run all validation commands to ensure zero regressions

## Testing Strategy
### Unit Tests
- Add a test in `workflowPhases.test.ts` → `completePRReviewWorkflow` describe block that verifies `moveIssueToStatus` is called with `(10, 'Review', undefined)` (using the mock config's issueNumber and repoInfo)
- Existing `moveIssueToStatus` unit tests in `projectBoardApi.test.ts` already cover the function's edge cases (status not found, already in status, no project, etc.)

### Edge Cases
- Issue number is 0 (no linked issue): `moveIssueToStatus` handles this gracefully
- "Review" status doesn't exist in the project: `moveIssueToStatus` logs and skips
- Issue is already in "Review" status: `moveIssueToStatus` logs and skips
- Issue is not on any project board: `moveIssueToStatus` logs and skips
- `repoInfo` is undefined (local repo): `moveIssueToStatus` falls back to default repo

## Acceptance Criteria
- When `adwPrReview.tsx` completes successfully, the linked issue is moved to "Review" status on the GitHub project board
- If the "Review" status doesn't exist in the project, the workflow completes without error
- All existing tests continue to pass
- A new unit test validates the status change behavior

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - TypeScript type check for main project
- `npx tsc --noEmit -p adws/tsconfig.json` - TypeScript type check for ADW scripts
- `npm test` - Run all tests to validate zero regressions

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- The `moveIssueToStatus` function uses fuzzy matching for status names, so "Review" will match both "Review" and "In Review" on the project board.
- This is a minimal, focused change — a single import addition and a single function call — following the established pattern in `prPhase.ts`.
