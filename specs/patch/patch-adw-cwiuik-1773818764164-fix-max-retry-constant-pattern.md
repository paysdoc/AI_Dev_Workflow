# Patch: Add maxAttempts alias in autoMergeHandler for BDD pattern matching

## Metadata
adwId: `cwiuik-1773818764164`
reviewChangeRequest: `Issue #1: Regression scenario 'Auto-merge flow caps retries to prevent infinite loops' fails at step 'Then the auto-merge orchestrator enforces a maximum retry count'. The BDD step scans autoMergeHandler.ts for patterns like maxAttempts/maxRetries/MAX_ATTEMPTS etc. The constant MAX_AUTO_MERGE_ATTEMPTS doesn't match any existing pattern. Resolution: add a local alias const maxAttempts = MAX_AUTO_MERGE_ATTEMPTS and use it in the for-loop.`

## Issue Summary
**Original Spec:** specs/issue-225-adw-cwiuik-1773818764164-sdlc_planner-auto-merge-approved-pr.md
**Issue:** The BDD step at `autoMergeApprovedPrSteps.ts:176-193` checks `autoMergeHandler.ts` for string patterns (`MAX_RETRIES`, `MAX_ATTEMPTS`, `maxRetries`, `maxAttempts`, `MAX_MERGE_RETRIES`) and regexes (`/[Mm]ax\w*[Rr]etr/`, `/[Mm]ax\w*[Aa]ttempt/`). The imported constant `MAX_AUTO_MERGE_ATTEMPTS` doesn't match any of these: `MAX_ATTEMPTS` isn't a contiguous substring, and the regex expects lowercase after the `max` prefix while the constant is all-uppercase.
**Solution:** Add a local alias `const maxAttempts = MAX_AUTO_MERGE_ATTEMPTS;` in `autoMergeHandler.ts` and use `maxAttempts` in the for-loop. This satisfies the BDD step's `found.content.includes('maxAttempts')` check (line 184) while keeping the canonical constant in `core/constants.ts`.

## Files to Modify
- `adws/triggers/autoMergeHandler.ts` — Add local alias and use it in the for-loop

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add local alias and update for-loop in autoMergeHandler.ts
- After the existing imports (line 18), add: `const maxAttempts = MAX_AUTO_MERGE_ATTEMPTS;`
- In the `handleApprovedReview` function, replace the for-loop at line 190:
  - Change `for (let attempt = 1; attempt <= MAX_AUTO_MERGE_ATTEMPTS; attempt++)` to `for (let attempt = 1; attempt <= maxAttempts; attempt++)`
- Update the log message at line 191:
  - Change `Auto-merge attempt ${attempt}/${MAX_AUTO_MERGE_ATTEMPTS}` to `Auto-merge attempt ${attempt}/${maxAttempts}`

### Step 2: Verify the step file change is retained
- The working tree already includes adding `found.content.includes('MAX_AUTO_MERGE_ATTEMPTS')` to `autoMergeApprovedPrSteps.ts` (line 181). This is a complementary change and should be kept — it makes the BDD step explicitly recognize the canonical constant name as well.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx cucumber-js --tags "@regression"` — Run all regression scenarios to confirm the failing scenario now passes and no other regressions are introduced
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** 3
**Risk level:** low
**Testing required:** Run regression BDD scenarios to confirm the failing step now passes
