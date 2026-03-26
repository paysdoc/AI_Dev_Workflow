# Patch: Filter undefined elements from merged review arrays

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #9: reviewRetry.ts mergeReviewResults() filters null results but does not filter undefined elements within reviewIssues and screenshots arrays, leaving TypeError risk.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** In `mergeReviewResults()`, the `flatMap` over `reviewIssues` and `screenshots` can produce arrays containing `undefined` or `null` elements (when agents return sparse/malformed JSON). The subsequent `.filter()` on line 86 accesses `issue.issueDescription` without a null guard, causing `TypeError: Cannot read properties of undefined (reading 'issueDescription')`. Similarly, `seenPaths.has(screenshot)` on line 97 can receive `undefined`.
**Solution:** Add a type-narrowing `.filter()` immediately after each `.flatMap()` to strip `null`/`undefined` elements before the deduplication logic runs.

## Files to Modify
- `adws/agents/reviewRetry.ts` — `mergeReviewResults()` function (lines 83-100)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add null/undefined filter after reviewIssues flatMap
- In `mergeReviewResults()` (line 84), chain a `.filter((issue): issue is ReviewIssue => issue != null)` between the `.flatMap(r => r.reviewResult!.reviewIssues)` and the existing `.filter(issue => { ... })` deduplication block.
- The `!= null` check covers both `null` and `undefined` in one guard.

### Step 2: Add null/undefined filter after screenshots flatMap
- On line 95, chain a `.filter((s): s is string => s != null)` between `.flatMap(r => r.reviewResult!.screenshots)` and the existing `.filter(screenshot => { ... })` deduplication block.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check passes (type predicate narrows correctly)
2. `bunx tsc --noEmit` — Full project type check passes
3. `bun run lint` — No lint violations introduced
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js` — E2E tests pass with zero regressions

## Patch Scope
**Lines of code to change:** ~2 lines added (one filter per array)
**Risk level:** low
**Testing required:** TypeScript type check confirms type predicates narrow correctly; E2E regression suite confirms no behavioral change
