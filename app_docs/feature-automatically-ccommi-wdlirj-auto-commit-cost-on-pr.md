# Auto Commit and Revert Cost CSVs on PR Close

**ADW ID:** automatically-ccommi-wdlirj
**Date:** 2026-03-04
**Specification:** specs/issue-66-adw-automatically-ccommi-wdlirj-sdlc_planner-auto-commit-cost-on-pr.md

## Overview

This feature automates cost CSV file management when a pull request is closed or an issue is closed. When a PR is merged, `total-cost.csv` is rebuilt and cost files are committed. When a PR is closed without merging, or an issue is closed directly, the issue's cost CSV is deleted, totals are rebuilt, and changes are pushed — keeping cost data in sync with actual completed work.

## What Was Built

- Conditional PR close handling: both merged and closed-without-merge PRs rebuild `total-cost.csv` then commit
- Issue `closed` event handler in `trigger_webhook.ts` that rebuilds and commits cost CSV when an issue is closed directly
- Updated `webhookHandlers.test.ts` to cover merged vs closed-without-merge paths and error isolation

> **Note (issue #111):** `revertIssueCostFile()` was removed. The function previously deleted individual issue CSV files on PR close/issue close, but this behavior was incorrect. Instead, `rebuildProjectCostCsv` is called unconditionally, which is idempotent and produces accurate totals from remaining issue CSVs.

## Technical Implementation

### Files Modified

- `adws/core/costCsvWriter.ts`: Contains `rebuildProjectCostCsv` which scans all remaining issue CSVs to produce an accurate `total-cost.csv`
- `adws/core/index.ts`: Exports `rebuildProjectCostCsv` from the barrel
- `adws/triggers/webhookHandlers.ts`: `handlePullRequestEvent()` branches on `wasMerged` — both paths call `rebuildProjectCostCsv` then `commitAndPushCostFiles`; merged path additionally records the issue via `recordMergedPrIssue`
- `adws/triggers/trigger_webhook.ts`: Issue `closed` event handler fetches EUR rate, rebuilds total, and commits (fire-and-forget async); skipped if already handled by merged PR
- `adws/__tests__/webhookHandlers.test.ts`: Tests for both PR close paths and error isolation

### Key Changes

- `rebuildProjectCostCsv` is always called before `commitAndPushCostFiles` to ensure `total-cost.csv` reflects the current state of all remaining issue CSVs
- EUR rate is fetched via `fetchExchangeRates(['EUR'])` before each rebuild; a failed fetch defaults to `0`, which causes `total-cost.csv` to show `N/A` for EUR rather than erroring
- The issue close handler uses fire-and-forget (`.then()/.catch()`) to avoid blocking the HTTP response
- Double-fire safety: if both a PR close and an issue auto-close fire, the `wasMergedViaPR` guard prevents the issue close handler from running a redundant rebuild+commit

## How to Use

This feature is fully automatic. No manual steps are required.

1. **PR merged:** When a PR linked to an issue is merged, `total-cost.csv` is rebuilt and committed/pushed automatically.
2. **PR closed without merge:** When a PR is closed without merging, `total-cost.csv` is rebuilt and committed/pushed.
3. **Issue closed directly:** When an issue is closed without a PR (e.g., via the GitHub UI), the same rebuild-commit flow runs (unless already handled by a merged PR).

## Configuration

No additional configuration required. The feature uses existing ADW infrastructure:

- `projects/<repoName>/` — directory where cost CSVs are stored
- `COST_REPORT_CURRENCIES` — controls which currencies appear in `total-cost.csv`
- `fetchExchangeRates` — fetches live EUR rate; gracefully falls back to `0` on failure

## Testing

```bash
npm test                              # Run all tests
npx tsc --noEmit -p adws/tsconfig.json  # Type-check adws scripts
```

Key test files:
- `adws/triggers/__tests__/webhookHandlers.test.ts` — merged/closed-without-merge paths, error isolation
- `adws/triggers/__tests__/triggerWebhookIssueClosed.test.ts` — issue close cost rebuild tests

## Notes

- The `rebuildProjectCostCsv` function is idempotent and safe to call at any time; it scans all remaining issue CSVs to produce an accurate total.
- If `commitAndPushCostFiles` fails (e.g., network error), the error is caught and logged but does not interrupt issue closure or worktree cleanup.
- When a PR is merged and the linked issue is auto-closed, both the PR close handler and the issue close handler may fire. The `wasMergedViaPR` guard in the issue close handler prevents a redundant rebuild+commit.
