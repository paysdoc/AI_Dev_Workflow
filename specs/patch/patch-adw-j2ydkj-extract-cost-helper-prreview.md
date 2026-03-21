# Patch: Extract cost computation from completePRReviewWorkflow

## Metadata
adwId: `j2ydkj`
reviewChangeRequest: `specs/issue-244-adw-j2ydkj-cost-revamp-github-c-sdlc_planner-cost-comment-formatter.md`

## Issue Summary
**Original Spec:** specs/issue-244-adw-j2ydkj-cost-revamp-github-c-sdlc_planner-cost-comment-formatter.md
**Issue:** The regression scenario `completePRReviewWorkflow guards moveToStatus with issueNumber check` (features/fix_pr_review_issue_number.feature:51) fails because the new cost pre-computation code (lines 112-160 of prReviewCompletion.ts) expanded the function body, pushing the `moveToStatus` call beyond the step definition's 2000-character scanning window. The code is correct — `moveToStatus` is still guarded by `config.issueNumber` — but the BDD test cannot find it within its window.
**Solution:** Extract the cost section computation (lines 112-160) from `completePRReviewWorkflow` into a dedicated helper function. This keeps the main function body short enough for `moveToStatus` to remain within the first 2000 characters from the function start, and revert the step definition window workaround back to 2000.

## Files to Modify

- `adws/phases/prReviewCompletion.ts` — Extract cost computation block into a helper function
- `features/step_definitions/fixPrReviewIssueNumberSteps.ts` — Revert scanning window from 4000 back to 2000

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extract cost computation into a helper function in `adws/phases/prReviewCompletion.ts`
- Create a new private async function `buildPRReviewCostSection` in the same file, above `completePRReviewWorkflow`
- Move the entire cost computation block (current lines 112-160, the `if (modelUsage && Object.keys(modelUsage).length > 0)` block) into the helper
- The helper signature: `async function buildPRReviewCostSection(config: PRReviewWorkflowConfig, modelUsage: ModelUsageMap): Promise<void>`
- The helper accesses `config.ctx` to set `costBreakdown`, `phaseCostRecords`, and `costSection` — same as the current inline code
- In `completePRReviewWorkflow`, replace the extracted block with a single call:
  ```typescript
  if (modelUsage && Object.keys(modelUsage).length > 0) {
    await buildPRReviewCostSection(config, modelUsage);
  }
  ```
- This reduces ~48 lines of inline code to ~3 lines, keeping `moveToStatus` well within 2000 characters from the function start

### Step 2: Revert the step definition scanning window
- In `features/step_definitions/fixPrReviewIssueNumberSteps.ts` line 115, revert:
  ```typescript
  const funcBody = content.slice(funcStart, funcStart + 4000);
  ```
  back to:
  ```typescript
  const funcBody = content.slice(funcStart, funcStart + 2000);
  ```
- The production code restructure makes the original 2000-char window sufficient again

### Step 3: Run targeted regression test
- Run `bunx cucumber-js features/fix_pr_review_issue_number.feature:51` to verify the specific failing scenario now passes with the original 2000-char window

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx cucumber-js features/fix_pr_review_issue_number.feature:51` — Verify the specific regression scenario passes
- `bunx cucumber-js --tags @regression` — Run full regression suite to confirm no other regressions
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root TypeScript config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws TypeScript config
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~55 (move ~48 lines into helper, add 3-line call site, revert 1 line in step def)
**Risk level:** low
**Testing required:** Run specific regression scenario + full regression suite + type-check + lint + build
