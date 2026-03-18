# Fix PR Review Issue Number Resolution and Serialised Cost CSVs

**ADW ID:** y000tl-fix-issue-number-res
**Date:** 2026-03-18
**Specification:** specs/issue-233-adw-y000tl-fix-issue-number-res-sdlc_planner-fix-pr-review-issue-number.md

## Overview

When the PR review workflow completed for PRs without an `Implements #N` link in the body, the issue number defaulted to `0`, causing GitHub API errors (`Could not resolve to an Issue with the number of 0`) and producing cost CSV files named `0-*.csv`. This fix adds a branch-name fallback for issue number extraction, makes the issue number nullable throughout the PR review config, guards downstream consumers, and introduces serialised cost CSV naming so multiple PR review runs for the same issue produce distinct files.

## What Was Built

- Branch-name fallback in `extractIssueNumberFromBranch()` matching the ADW branch format `{type}-{issueNumber}-{adwId}-{slug}`
- Branch-name fallback wired into `fetchPRDetails()` when the PR body has no `Implements #N` link
- `PRReviewWorkflowConfig.issueNumber` changed from `number` to `number | null`, removing the `|| 0` coercion
- Guards on `moveToStatus()` and cost CSV writing in `completePRReviewWorkflow()` that skip when `issueNumber` is `null`
- New `getNextSerialCsvPath()` function that appends a serial suffix (`-1`, `-2`, …) to PR review cost CSV filenames to prevent overwriting

## Technical Implementation

### Files Modified

- `adws/triggers/webhookHandlers.ts`: Updated `extractIssueNumberFromBranch()` to try the legacy `issue-(\d+)` pattern first, then fall back to the ADW format regex `/^(?:feat|feature|bug|bugfix|chore|fix|hotfix)-(\d+)-/`
- `adws/github/prApi.ts`: Imported `extractIssueNumberFromBranch` and used it as a fallback in `fetchPRDetails()` when the PR body regex yields no match
- `adws/phases/prReviewPhase.ts`: Changed `PRReviewWorkflowConfig.issueNumber` to `number | null`; removed `|| 0` from `initializePRReviewWorkflow()`
- `adws/phases/prReviewCompletion.ts`: Wrapped cost CSV write and `moveToStatus()` calls with `if (config.issueNumber)`; switched from `writeIssueCostCsv()` to serialised path via `getNextSerialCsvPath()` + `fs.writeFileSync()`
- `adws/core/costCsvWriter.ts`: Added `getNextSerialCsvPath()` function that scans the project directory for existing serial suffixes and returns the next available path
- `adws/core/index.ts`: Exported `getNextSerialCsvPath` and `formatIssueCostCsv` from the core barrel

### Key Changes

- `extractIssueNumberFromBranch()` now resolves issue numbers from ADW-format branch names (e.g., `bugfix-233-y000tl-fix-issue` → `233`), making it usable in both webhook handlers and `fetchPRDetails()`
- `PRReviewWorkflowConfig.issueNumber` is `number | null` throughout; the `|| 0` coercion that hid the null is gone
- `completePRReviewWorkflow()` skips project board updates and CSV writes when no issue number is available, preventing the `#0` API error
- `getNextSerialCsvPath()` returns `{baseName}-1.csv` on first run, incrementing for subsequent runs — `rebuildProjectCostCsv()` handles these naturally because it splits on the first `-` to extract the issue number prefix
- The fix is backward-compatible: the legacy `issue-(\d+)` branch pattern is still tried first

## How to Use

The fix is transparent — no configuration changes are required.

1. Create a PR whose branch name follows the ADW format `{type}-{issueNumber}-{adwId}-{slug}` (e.g., `bugfix-233-y000tl-fix-issue`).
2. Trigger the PR review workflow (via `adwPrReview.tsx` or the cron trigger).
3. The issue number is now resolved from the branch name automatically when the PR body has no `Implements #N` link.
4. On completion, the cost CSV is written as `projects/{repo}/{issueNumber}-{slug}-1.csv` (incrementing to `-2.csv`, `-3.csv` on subsequent runs).
5. If no issue number can be resolved at all, the workflow skips the project board move and cost CSV write instead of erroring.

## Configuration

No new configuration options. Existing `.adw/` project config is unchanged.

## Testing

Run the regression BDD suite:

```sh
bunx cucumber-js --tags "@regression"
```

The new feature file `features/fix_pr_review_issue_number.feature` covers:
- Issue number extraction from ADW-format branch names
- Null propagation when neither PR body nor branch name yields an issue number
- Serialised CSV naming (`-1`, `-2` suffixes)
- Guards that skip board moves and CSV writes for `null` issue numbers

## Notes

- The 13 `0-*.csv` files already present in `projects/AI_Dev_Workflow/` are artefacts of past failed runs; they should be manually removed or ignored.
- `rebuildProjectCostCsv()` already handles serialised filenames correctly because it splits on the first `-` to extract the issue number prefix — no changes were needed there.
- No circular dependency is introduced: `prApi.ts` is in `github/` and imports from `triggers/webhookHandlers.ts`; neither module imports from the other's package.
