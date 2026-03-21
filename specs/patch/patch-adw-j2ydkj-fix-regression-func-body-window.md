# Patch: Increase completePRReviewWorkflow function body scan window

## Metadata
adwId: `j2ydkj-cost-revamp-github-c`
reviewChangeRequest: `specs/issue-244-adw-j2ydkj-cost-revamp-github-c-sdlc_planner-cost-comment-formatter.md`

## Issue Summary
**Original Spec:** specs/issue-244-adw-j2ydkj-cost-revamp-github-c-sdlc_planner-cost-comment-formatter.md
**Issue:** The regression scenario `completePRReviewWorkflow guards moveToStatus with issueNumber check` (fix_pr_review_issue_number.feature:51) fails because the new cost pre-computation code added by issue #244 in `prReviewCompletion.ts` expanded the `completePRReviewWorkflow` function body. The step definition at `fixPrReviewIssueNumberSteps.ts:115` uses `content.slice(funcStart, funcStart + 2000)` to scan for `moveToStatus`, but the call now sits beyond the 2000-character window.
**Solution:** Increase the character window from 2000 to 4000 in `fixPrReviewIssueNumberSteps.ts` so the scan reaches the `moveToStatus` call in the expanded function body.

## Files to Modify

- `features/step_definitions/fixPrReviewIssueNumberSteps.ts` — line 115: change slice window from 2000 to 4000

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Increase the function body scan window
- In `features/step_definitions/fixPrReviewIssueNumberSteps.ts`, line 115, change:
  ```typescript
  const funcBody = content.slice(funcStart, funcStart + 2000);
  ```
  to:
  ```typescript
  const funcBody = content.slice(funcStart, funcStart + 4000);
  ```
- This single change ensures the `moveToStatus` call is within the scanned window even after the cost pre-computation code was added to `completePRReviewWorkflow`.

### Step 2: Run regression scenario to confirm fix
- Run `bunx cucumber-js features/fix_pr_review_issue_number.feature:51` to verify the previously failing scenario now passes.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx cucumber-js features/fix_pr_review_issue_number.feature:51` — Verify the specific failing scenario passes
- `bunx cucumber-js --tags @regression` — Run full regression suite to confirm no other regressions
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root TypeScript config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws TypeScript config
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** 1
**Risk level:** low
**Testing required:** Run the specific regression scenario and full regression suite
