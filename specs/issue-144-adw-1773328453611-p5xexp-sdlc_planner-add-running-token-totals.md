# Feature: Add Running Total of Tokens Used to Each Issue Comment

## Metadata
issueNumber: `144`
adwId: `1773328453611-p5xexp`
issueJson: `{"number":144,"title":"Add a running total of tokens used to each issue comment","body":"If env var RUNNING_TOKENS is available - which equates to boolean TRUE - add the running total of tokens used for the issue to each issue comment. \nThis includes all comments added by any agent, including the PrReview agent.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T15:14:00Z","comments":[],"actionableComment":null}`

## Feature Description
When the environment variable `RUNNING_TOKENS` is set (any truthy value), every GitHub issue and PR comment posted by ADW should include a running total of tokens consumed so far for that issue. This applies to all workflow comments posted by any agent — including the standard issue workflow comments and the PR Review workflow comments. The running total accumulates across all phases (plan, build, test, PR, review, document) and is displayed as a compact footer line on each comment.

## User Story
As a developer/team lead monitoring ADW workflows
I want to see a running total of tokens used in each issue comment
So that I can track token consumption in real time as the workflow progresses without waiting for the final cost breakdown

## Problem Statement
Currently, token usage is only visible in the final "completed" or "error" comments via the cost breakdown section. There is no way to see how many tokens have been consumed at intermediate stages. This makes it difficult to monitor costs in real time or detect runaway token usage mid-workflow.

## Solution Statement
Add a `RUNNING_TOKENS` environment variable check. When enabled, pass the accumulated token totals into the `WorkflowContext` and `PRReviewWorkflowContext` objects. The comment formatting functions will then append a compact running token total footer line to every comment. The orchestrators already accumulate `totalModelUsage` after each phase; the key change is threading that data into the context before posting each stage comment.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.
- `adws/core/config.ts` — Add `RUNNING_TOKENS` env var constant.
- `adws/core/index.ts` — Re-export the new constant.
- `adws/core/tokenManager.ts` — Contains `computeTotalTokens()` used to derive the running total from `ModelUsageMap`.
- `adws/core/costReport.ts` — Contains `computeTotalCostUsd()` and `mergeModelUsageMaps()` used by orchestrators.
- `adws/types/costTypes.ts` — `ModelUsageMap` type definition.
- `adws/github/workflowCommentsIssue.ts` — `WorkflowContext` interface and all `format*Comment()` functions for issue comments. Add `runningTokenTotal` field to `WorkflowContext` and append footer to all comments.
- `adws/github/workflowCommentsPR.ts` — `PRReviewWorkflowContext` interface and all `format*Comment()` functions for PR comments. Inherits from `WorkflowContext`, so the same `runningTokenTotal` field applies.
- `adws/github/workflowCommentsBase.ts` — Contains `ADW_SIGNATURE` constant. Add a helper that formats the running token footer line.
- `adws/phases/buildPhase.ts` — Posts comments during build; needs to thread running totals into `ctx`.
- `adws/phases/workflowCompletion.ts` — Posts completion/error/review comments; needs to thread running totals into `ctx`.
- `adws/phases/workflowInit.ts` — `WorkflowConfig` interface; add `runningTokensEnabled` flag.
- `adws/phases/planPhase.ts` — Posts comments during plan; needs to thread running totals into `ctx`.
- `adws/phases/prPhase.ts` — Posts comments during PR creation; needs to thread running totals into `ctx`.
- `adws/phases/testPhase.ts` — Posts comments during test; needs to thread running totals into `ctx`.
- `adws/phases/documentPhase.ts` — Posts comments during document; needs to thread running totals into `ctx`.
- `adws/phases/prReviewPhase.ts` — PR review initialization and phases; needs to thread running totals.
- `adws/phases/prReviewCompletion.ts` — PR review completion; needs to thread running totals.
- `adws/adwSdlc.tsx` — Full SDLC orchestrator; update ctx with running totals after each phase.
- `adws/adwPrReview.tsx` — PR Review orchestrator; update ctx with running totals after each phase.
- `adws/adwPlanBuild.tsx` — PlanBuild orchestrator; update ctx with running totals after each phase.
- `adws/adwPlanBuildTest.tsx` — PlanBuildTest orchestrator; update ctx with running totals after each phase.
- `adws/adwPlanBuildReview.tsx` — PlanBuildReview orchestrator; update ctx with running totals after each phase.
- `adws/adwPlanBuildTestReview.tsx` — PlanBuildTestReview orchestrator; update ctx with running totals after each phase.
- `adws/adwPlanBuildDocument.tsx` — PlanBuildDocument orchestrator; update ctx with running totals after each phase.
- `.env.sample` — Add `RUNNING_TOKENS` env var documentation.
- `adws/github/__tests__/workflowCommentsIssueReview.test.ts` — Existing test; extend or create sibling for running token tests.
- `adws/github/__tests__/workflowCommentsPR.test.ts` — Existing test; extend for running token footer.
- `adws/phases/__tests__/phaseCommentHelpers.test.ts` — Existing test for comment helpers.
- `adws/core/__tests__/tokenManager.test.ts` — Existing test for token computation.

### New Files
- `adws/github/__tests__/workflowCommentsRunningTokens.test.ts` — Dedicated tests for running token footer formatting across issue and PR comments.
- `adws/__tests__/runningTokensIntegration.test.ts` — Integration test verifying orchestrator-level token threading into context.

## Implementation Plan
### Phase 1: Foundation
1. Add `RUNNING_TOKENS` env var to `adws/core/config.ts` and re-export from `adws/core/index.ts`.
2. Add a `runningTokenTotal` optional field to `WorkflowContext` in `adws/github/workflowCommentsIssue.ts`. Since `PRReviewWorkflowContext extends WorkflowContext`, it automatically inherits.
3. Add a helper function `formatRunningTokenFooter()` in `adws/github/workflowCommentsBase.ts` that returns a formatted footer string (or empty string when the field is not set).

### Phase 2: Core Implementation
4. Update every `format*Comment()` function in `adws/github/workflowCommentsIssue.ts` to insert the running token footer before `ADW_SIGNATURE`.
5. Update every `format*Comment()` function in `adws/github/workflowCommentsPR.ts` to insert the running token footer before `ADW_SIGNATURE`.
6. Add a helper function in the orchestrators (or a shared utility) that updates `ctx.runningTokenTotal` from the accumulated `ModelUsageMap`.

### Phase 3: Integration
7. Update all orchestrator scripts (`adwSdlc.tsx`, `adwPrReview.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`) to update `ctx.runningTokenTotal` after each phase's cost accumulation, before the next phase posts comments.
8. Update `WorkflowConfig` in `workflowInit.ts` to carry `runningTokensEnabled` so phases can check it.
9. Update `.env.sample` with the new env var.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add RUNNING_TOKENS env var to config
- In `adws/core/config.ts`, add:
  ```typescript
  /** Whether to include running token totals in issue/PR comments. */
  export const RUNNING_TOKENS = Boolean(process.env.RUNNING_TOKENS);
  ```
- In `adws/core/index.ts`, add `RUNNING_TOKENS` to the config export line.
- In `.env.sample`, add a commented-out entry:
  ```
  # Optional - show running token totals in issue comments (default: false)
  # RUNNING_TOKENS=true
  ```

### Step 2: Add runningTokenTotal field to WorkflowContext
- In `adws/github/workflowCommentsIssue.ts`, add to the `WorkflowContext` interface:
  ```typescript
  /** Running total of tokens consumed so far (set when RUNNING_TOKENS is enabled). */
  runningTokenTotal?: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; total: number };
  ```
  Note: This uses the same shape as `TokenTotals` from `tokenManager.ts` to keep things consistent, but we use an inline type to avoid an import dependency. `PRReviewWorkflowContext` extends `WorkflowContext` and will inherit this field automatically.

### Step 3: Add formatRunningTokenFooter helper
- In `adws/github/workflowCommentsBase.ts`, add a function:
  ```typescript
  export function formatRunningTokenFooter(tokenTotal?: { total: number }): string {
    if (!tokenTotal) return '';
    return `\n\n> **Running Token Total:** ${tokenTotal.total.toLocaleString('en-US')} tokens`;
  }
  ```
  This returns either an empty string or a blockquote line that will appear before `ADW_SIGNATURE`.

### Step 4: Update issue comment formatters to include running token footer
- In `adws/github/workflowCommentsIssue.ts`, import `formatRunningTokenFooter` from `workflowCommentsBase`.
- Update **every** `format*Comment()` function to insert `formatRunningTokenFooter(ctx.runningTokenTotal)` before `ADW_SIGNATURE` in the return string.
- For example, `formatStartingComment` changes from:
  ```typescript
  return `...${ADW_SIGNATURE}`;
  ```
  to:
  ```typescript
  return `...${formatRunningTokenFooter(ctx.runningTokenTotal)}${ADW_SIGNATURE}`;
  ```
- Apply this pattern to all format functions: `formatStartingComment`, `formatClassifiedComment`, `formatBranchCreatedComment`, `formatPlanBuildingComment`, `formatPlanCreatedComment`, `formatPlanFileCreatedComment`, `formatPlanCommittingComment`, `formatImplementingComment`, `formatBuildProgressComment`, `formatImplementedComment`, `formatImplementationCommittingComment`, `formatPrCreatingComment`, `formatPrCreatedComment`, `formatCompletedComment`, `formatErrorComment`, `formatTokenLimitRecoveryComment`, `formatReviewRunningComment`, `formatReviewPassedComment`, `formatReviewFailedComment`, `formatReviewPatchingComment`, `formatResumingComment`.

### Step 5: Update PR comment formatters to include running token footer
- In `adws/github/workflowCommentsPR.ts`, import `formatRunningTokenFooter` from `workflowCommentsBase`.
- Update **every** `case` in `formatPRReviewWorkflowComment` to insert `formatRunningTokenFooter(ctx.runningTokenTotal)` before `ADW_SIGNATURE`.
- Apply to all cases: `pr_review_starting`, `pr_review_planning`, `pr_review_planned`, `pr_review_implementing`, `pr_review_implemented`, `pr_review_testing`, `pr_review_test_failed`, `pr_review_test_passed`, `pr_review_test_max_attempts`, `pr_review_committing`, `pr_review_pushed`, `pr_review_completed`, `pr_review_error`, and the `default` case.

### Step 6: Add helper to update context with running token totals
- In `adws/core/costReport.ts`, add a utility function:
  ```typescript
  import { computeTotalTokens, type TokenTotals } from './tokenManager';

  export function computeRunningTokenTotal(modelUsage: ModelUsageMap): TokenTotals {
    return computeTotalTokens(modelUsage);
  }
  ```
- Re-export `computeRunningTokenTotal` from `adws/core/index.ts`.
- Alternatively, if this is just a simple wrapper, consider inlining `computeTotalTokens` usage directly in the orchestrators.

  **Decision:** Since `computeTotalTokens` already does exactly what we need, we'll call it directly in the orchestrators rather than adding a trivial wrapper. Import `computeTotalTokens` and `RUNNING_TOKENS` where needed.

### Step 7: Update all orchestrators to thread running token totals into ctx
- For each orchestrator that accumulates `totalModelUsage` after each phase, add a helper call to update `ctx.runningTokenTotal` right after updating `totalModelUsage`.
- Pattern for each orchestrator:
  ```typescript
  import { computeTotalTokens, RUNNING_TOKENS } from './core';

  // After each phase's cost accumulation:
  if (RUNNING_TOKENS) {
    config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);
  }
  ```
- Apply this pattern to:
  - `adws/adwSdlc.tsx` — after each of the 6 phases
  - `adws/adwPrReview.tsx` — after each of the 3 phases
  - `adws/adwPlanBuild.tsx` — after each phase
  - `adws/adwPlanBuildTest.tsx` — after each phase
  - `adws/adwPlanBuildReview.tsx` — after each phase
  - `adws/adwPlanBuildTestReview.tsx` — after each phase
  - `adws/adwPlanBuildDocument.tsx` — after each phase
- Note: The `starting` comment is posted before any phase runs, so it will have no running total (which is correct — no tokens consumed yet).

### Step 8: Write unit tests for running token footer
- Create `adws/github/__tests__/workflowCommentsRunningTokens.test.ts`:
  - Test `formatRunningTokenFooter` returns empty string when undefined.
  - Test `formatRunningTokenFooter` returns correct formatted string with token count.
  - Test `formatWorkflowComment` includes running token footer when `ctx.runningTokenTotal` is set.
  - Test `formatWorkflowComment` does NOT include running token footer when `ctx.runningTokenTotal` is undefined.
  - Test `formatPRReviewWorkflowComment` includes running token footer when `ctx.runningTokenTotal` is set.
  - Test token totals are formatted with locale separators (e.g., "1,234,567 tokens").

### Step 9: Write integration test for orchestrator token threading
- Create `adws/__tests__/runningTokensIntegration.test.ts`:
  - Test that when `RUNNING_TOKENS` is truthy, `computeTotalTokens` output is correctly assigned to `ctx.runningTokenTotal`.
  - Test that when `RUNNING_TOKENS` is falsy, `ctx.runningTokenTotal` remains undefined.
  - Verify the token total is cumulative (sums across multiple model usage maps).

### Step 10: Update .env.sample
- Add the `RUNNING_TOKENS` env var documentation (done in Step 1).

### Step 11: Run Validation Commands
- Execute all validation commands to ensure zero regressions.

## Testing Strategy
### Unit Tests
- `formatRunningTokenFooter()` — returns empty string for undefined, returns formatted string for valid input.
- `formatWorkflowComment()` — each stage includes/excludes footer based on `ctx.runningTokenTotal`.
- `formatPRReviewWorkflowComment()` — each stage includes/excludes footer based on `ctx.runningTokenTotal`.
- Verify footer is placed before `ADW_SIGNATURE` in the output.

### Edge Cases
- `RUNNING_TOKENS` not set (default): no footer on any comment.
- `RUNNING_TOKENS` set to empty string: should be falsy, no footer.
- `runningTokenTotal.total` is 0: footer should show "0 tokens".
- Very large token counts: verify locale formatting (e.g., commas).
- The `starting` comment before any phase runs: `runningTokenTotal` is undefined, no footer.
- Error comments: should still include running total if available.

## Acceptance Criteria
- When `RUNNING_TOKENS` env var is set, every issue comment posted by ADW includes a running token total line.
- When `RUNNING_TOKENS` env var is set, every PR comment posted by ADW includes a running token total line.
- When `RUNNING_TOKENS` is not set, no running token total appears in any comment.
- The running total accurately reflects accumulated tokens across all completed phases.
- The running total uses locale-formatted numbers (e.g., "1,234,567").
- All existing tests continue to pass with zero regressions.
- New unit tests cover the footer formatting and context threading.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws directory
- `bun run test` - Run all tests to validate the feature works with zero regressions
- `bun run build` - Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` coding guidelines must be strictly followed, particularly: clarity over cleverness, modularity, immutability, type safety, and functional programming practices.
- The running token footer uses a blockquote (`>`) format to visually distinguish it from the main comment content while remaining unobtrusive.
- The `PRReviewWorkflowContext` inherits `runningTokenTotal` from `WorkflowContext` via extension — no separate field needed.
- For the initial comment (`starting`), the running total will be absent since no tokens have been consumed yet. This is expected behavior.
- Future enhancement: could include cost in USD alongside token count, but keeping it simple for now (tokens only).
