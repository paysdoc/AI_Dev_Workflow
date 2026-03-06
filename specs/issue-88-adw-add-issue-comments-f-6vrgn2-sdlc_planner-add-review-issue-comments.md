# Feature: Add Issue Comments for the Review Process

## Metadata
issueNumber: `88`
adwId: `add-issue-comments-f-6vrgn2`
issueJson: `{"number":88,"title":"Add issue comments for the review process","body":"The /review and /patch commands communicate insufficiently. If a review issue is found, add a relevant comment to the issue. If a review is patched, also add a comment as to how it was patched.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-06T14:09:20Z","comments":[],"actionableComment":null}`

## Feature Description
The `/review` and `/patch` workflow stages currently post generic "ADW Workflow Update" comments to GitHub issues because the review-related workflow stages (`review_running`, `review_passed`, `review_failed`, `review_patching`) lack dedicated formatting functions in `workflowCommentsIssue.ts`. They fall through to the `default` case in `formatWorkflowComment()`, producing uninformative comments.

This feature adds rich, contextual issue comments for the review process so that stakeholders can see:
- When a review is running
- What blocker issues were found (with descriptions and severities)
- When patches are being applied and what they address
- Whether the review passed or failed, with a summary

## User Story
As a developer monitoring a GitHub issue
I want to see detailed review and patch comments posted on the issue
So that I can understand the review status, what issues were found, and how they were resolved without checking logs

## Problem Statement
The review workflow stages (`review_running`, `review_passed`, `review_failed`, `review_patching`) are posted via `postWorkflowComment()` but hit the `default` case in `formatWorkflowComment()`, producing generic comments like "## ADW Workflow Update\n\n**Stage:** review_running". This provides no useful context about review findings, blocker issues, or patch resolutions.

## Solution Statement
1. Add dedicated formatting functions for `review_running`, `review_passed`, `review_failed`, and `review_patching` stages in `workflowCommentsIssue.ts`
2. Extend `WorkflowContext` with optional review-specific fields (`reviewSummary`, `reviewIssues`, `patchingIssue`) to carry review data into comment formatting
3. Update `executeReviewPhase()` in `workflowLifecycle.ts` to populate the context with review results before posting comments
4. Update the `reviewRetry.ts` callback interface to pass review details back to the orchestrator
5. Add unit tests for the new formatting functions and updated workflow logic

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed
- `adws/github/workflowCommentsIssue.ts` — Contains `WorkflowContext` and `formatWorkflowComment()`. Needs new formatting functions for review stages and extended context interface.
- `adws/github/workflowComments.ts` — Re-exports from focused modules. May need to re-export new types.
- `adws/types/workflowTypes.ts` — Defines `WorkflowStage` including review stages. Reference only.
- `adws/phases/workflowLifecycle.ts` — Contains `executeReviewPhase()` that calls `postWorkflowComment()` with review stages. Needs to populate review context before posting.
- `adws/agents/reviewRetry.ts` — Contains `runReviewWithRetry()` and its options/result types. The `onReviewFailed` callback needs to pass review issue details to the caller.
- `adws/agents/reviewAgent.ts` — Contains `ReviewIssue`, `ReviewResult`, `ReviewAgentResult` types. Reference for review data structures.
- `adws/agents/patchAgent.ts` — Reference for understanding patch flow.
- `adws/github/workflowCommentsBase.ts` — Contains `ADW_SIGNATURE`, `truncateText` used by comment formatters.
- `adws/__tests__/workflowPhases.test.ts` — Existing tests for `executeReviewPhase`. Needs new test cases.

### New Files
- `adws/__tests__/workflowCommentsIssueReview.test.ts` — Unit tests for the new review comment formatting functions

## Implementation Plan
### Phase 1: Foundation
Extend the `WorkflowContext` interface with optional review-specific fields and update the `ReviewRetryOptions.onReviewFailed` callback signature to pass review issue details. These are shared changes that both the formatting and orchestration code depend on.

### Phase 2: Core Implementation
Add dedicated formatting functions for the four review stages in `workflowCommentsIssue.ts`. Wire them into the `formatWorkflowComment` switch statement. Each function renders a rich GitHub-flavored markdown comment showing relevant review details.

### Phase 3: Integration
Update `executeReviewPhase()` in `workflowLifecycle.ts` to populate the `WorkflowContext` with review results from `runReviewWithRetry()` before posting stage comments. Update the `onReviewFailed` callback to pass blocker issue details. Update `runReviewWithRetry()` to pass review data through the callback.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extend WorkflowContext with review fields
- In `adws/github/workflowCommentsIssue.ts`, add optional fields to `WorkflowContext`:
  - `reviewSummary?: string` — Summary from the review agent
  - `reviewIssues?: ReviewIssue[]` — Array of review issues found
  - `patchingIssue?: ReviewIssue` — The specific issue currently being patched
  - `reviewAttempt?: number` — Current review attempt number
  - `maxReviewAttempts?: number` — Maximum review attempts
- Import `ReviewIssue` type from `../agents/reviewAgent`

### Step 2: Add review comment formatting functions
- In `adws/github/workflowCommentsIssue.ts`, add four new functions:
  - `formatReviewRunningComment(ctx)` — Shows review is in progress with attempt info
  - `formatReviewPassedComment(ctx)` — Shows review passed with summary. If there are non-blocker issues, list them in a collapsible `<details>` section.
  - `formatReviewFailedComment(ctx)` — Shows review failed with remaining blocker issues listed
  - `formatReviewPatchingComment(ctx)` — Shows which blocker issue is being patched with its description and proposed resolution
- Add these four cases to the `formatWorkflowComment()` switch statement
- Follow the existing formatting patterns (emojis, ADW_SIGNATURE, truncateText, `<details>` blocks)

### Step 3: Update ReviewRetryOptions callback signature
- In `adws/agents/reviewRetry.ts`, update the `onReviewFailed` callback in `ReviewRetryOptions`:
  - Change `onReviewFailed?: (attempt: number, maxAttempts: number) => void` to `onReviewFailed?: (attempt: number, maxAttempts: number, blockerIssues: ReviewIssue[]) => void`
- Update the callback invocation in `runReviewWithRetry()` to pass `lastBlockerIssues` as the third argument
- Add a new optional callback `onPatchingIssue?: (issue: ReviewIssue) => void` to `ReviewRetryOptions`
- Call `onPatchingIssue` in the blocker patching loop before each patch
- Add `reviewSummary` to `ReviewRetryResult` (the last review's summary)
- Populate `reviewSummary` from `reviewResult.reviewResult?.reviewSummary`

### Step 4: Update executeReviewPhase to populate context
- In `adws/phases/workflowLifecycle.ts`, update `executeReviewPhase()`:
  - Populate `ctx.reviewAttempt` and `ctx.maxReviewAttempts` before posting `review_running`
  - In the `onReviewFailed` callback: populate `ctx.reviewIssues` with the blocker issues passed from the updated callback, then post `review_patching`
  - Add `onPatchingIssue` callback that sets `ctx.patchingIssue` and posts `review_patching`
  - After review passes: populate `ctx.reviewSummary` from `reviewResult.reviewSummary` before posting `review_passed`
  - After review fails: populate `ctx.reviewIssues` with remaining blockers before posting `review_failed`

### Step 5: Write unit tests for review comment formatting
- Create `adws/__tests__/workflowCommentsIssueReview.test.ts` with tests for:
  - `formatWorkflowComment('review_running', ctx)` — verify output contains attempt info and ADW ID
  - `formatWorkflowComment('review_passed', ctx)` — verify output contains review summary and non-blocker issues in details
  - `formatWorkflowComment('review_failed', ctx)` — verify output lists remaining blocker issues
  - `formatWorkflowComment('review_patching', ctx)` — verify output shows issue being patched with description and resolution
  - Edge cases: missing optional fields (no reviewIssues, no reviewSummary, no patchingIssue)

### Step 6: Update existing tests
- In `adws/__tests__/workflowPhases.test.ts`, update `executeReviewPhase` tests:
  - Verify `postWorkflowComment` is called with properly populated context for review stages
- In `adws/__tests__/reviewRetry.test.ts`, update tests:
  - Verify `onReviewFailed` callback receives blocker issues as third argument
  - Add test for `onPatchingIssue` callback
  - Verify `reviewSummary` is present in the result

### Step 7: Run validation commands
- Run linter, type checks, and tests to validate zero regressions

## Testing Strategy
### Unit Tests
- Test each review comment formatting function independently with various context states
- Test `formatWorkflowComment` switch statement routes to correct formatter for review stages
- Test updated `onReviewFailed` callback passes blocker issues
- Test `onPatchingIssue` callback is invoked for each blocker
- Test `reviewSummary` is propagated through `ReviewRetryResult`
- Test `executeReviewPhase` populates context before posting comments

### Edge Cases
- Review passes on first attempt (no patching comments posted)
- Review with no blocker issues but non-blocker issues (tech-debt, skippable)
- Review with multiple blocker issues in a single round
- Missing `reviewSummary` in review result (null/undefined)
- Empty `reviewIssues` array
- `patchingIssue` with no screenshot path

## Acceptance Criteria
- When `review_running` stage is posted, the issue comment shows it's a review with attempt info
- When blocker issues are found, each patching attempt posts a comment showing which issue is being patched
- When `review_passed` stage is posted, the comment includes the review summary and any non-blocker issues
- When `review_failed` stage is posted, the comment lists all remaining blocker issues
- All existing tests continue to pass
- New unit tests cover all four review comment formatters and edge cases
- No TypeScript compilation errors
- Linter passes cleanly

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws project
- `bun run test` - Run all tests to validate zero regressions

## Notes
- Follow the `guidelines/coding_guidelines.md` strictly: pure functions, explicit types, no `any`, functional patterns
- Follow existing comment formatting patterns in `workflowCommentsIssue.ts` (emoji headers, ADW_SIGNATURE footer, `<details>` blocks for long content, `truncateText` for output)
- The `ReviewIssue` type from `reviewAgent.ts` is already well-defined with `reviewIssueNumber`, `issueDescription`, `issueResolution`, `issueSeverity`, and `screenshotPath` — use these fields in the comment formatting
- Keep the `onReviewFailed` callback change backward-compatible by making the new parameter optional at the call site (existing callers that don't use the third param will continue to work)
- The `workflowComments.ts` barrel file re-exports from `workflowCommentsIssue.ts`, so new types exported from there will be automatically available through the barrel
