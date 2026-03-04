# Auto Commit and Revert Cost CSVs on PR Close

**ADW ID:** automatically-ccommi-wdlirj
**Date:** 2026-03-04
**Specification:** specs/issue-66-adw-automatically-ccommi-wdlirj-sdlc_planner-auto-commit-cost-on-pr.md

## Overview

This feature automates cost CSV file management when a pull request is closed or an issue is closed. When a PR is merged, `total-cost.csv` is rebuilt and cost files are committed. When a PR is closed without merging, or an issue is closed directly, the issue's cost CSV is deleted, totals are rebuilt, and changes are pushed — keeping cost data in sync with actual completed work.

## What Was Built

- `revertIssueCostFile()` function that deletes an issue's cost CSV by scanning for `<issueNumber>-*.csv` pattern
- Conditional PR close handling: merged PRs rebuild totals then commit; closed-without-merge PRs revert issue CSV, rebuild totals, then commit
- Issue `closed` event handler in `trigger_webhook.ts` that reverts cost CSV when an issue is closed directly
- Unit tests for `revertIssueCostFile()` covering deletion, no-op, and edge cases
- Updated `webhookHandlers.test.ts` to cover merged vs closed-without-merge paths and error isolation

## Technical Implementation

### Files Modified

- `adws/core/costCsvWriter.ts`: Added `revertIssueCostFile(repoRoot, repoName, issueNumber)` that scans `projects/<repoName>/` for `<issueNumber>-*.csv` files and deletes them
- `adws/core/index.ts`: Exported `revertIssueCostFile` from the barrel
- `adws/triggers/webhookHandlers.ts`: Updated `handlePullRequestEvent()` to branch on `wasMerged` — merged path calls `rebuildProjectCostCsv` then `commitAndPushCostFiles`; closed path calls `revertIssueCostFile`, `rebuildProjectCostCsv`, then `commitAndPushCostFiles` (project-only)
- `adws/triggers/trigger_webhook.ts`: Added cost revert logic to the issue `closed` event handler — calls `revertIssueCostFile`, fetches EUR rate, rebuilds total, and commits (fire-and-forget async)
- `adws/__tests__/revertIssueCostFile.test.ts`: New test file covering all `revertIssueCostFile` cases
- `adws/__tests__/webhookHandlers.test.ts`: Updated to mock `rebuildProjectCostCsv`, `revertIssueCostFile`, and `fetchExchangeRates`; added tests for both PR close paths

### Key Changes

- `revertIssueCostFile` scans by `issueNumber-` prefix rather than full filename because the issue title is not always available (e.g., in issue close events)
- `rebuildProjectCostCsv` is always called before `commitAndPushCostFiles` to ensure `total-cost.csv` reflects the current state of all remaining issue CSVs
- EUR rate is fetched via `fetchExchangeRates(['EUR'])` before each rebuild; a failed fetch defaults to `0`, which causes `total-cost.csv` to show `N/A` for EUR rather than erroring
- The issue close handler uses fire-and-forget (`.then()/.catch()`) to avoid blocking the HTTP response
- Double-fire safety: if both a PR close and an issue auto-close fire, the revert is idempotent — a second call to `revertIssueCostFile` when no file exists returns `false` and skips rebuild/commit

## How to Use

This feature is fully automatic. No manual steps are required.

1. **PR merged:** When a PR linked to an issue is merged, `total-cost.csv` is rebuilt and the issue's cost CSV plus the updated total are committed and pushed automatically.
2. **PR closed without merge:** When a PR is closed without merging, the issue's cost CSV is deleted, `total-cost.csv` is rebuilt, and changes are committed and pushed.
3. **Issue closed directly:** When an issue is closed without a PR (e.g., via the GitHub UI), the same revert-rebuild-commit flow runs.

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
- `adws/__tests__/revertIssueCostFile.test.ts` — unit tests for the new deletion function
- `adws/__tests__/webhookHandlers.test.ts` — merged/closed-without-merge paths, error isolation

## Notes

- The `rebuildProjectCostCsv` function is idempotent and safe to call at any time; it scans all remaining issue CSVs to produce an accurate total.
- If `commitAndPushCostFiles` fails (e.g., network error), the error is caught and logged but does not interrupt issue closure or worktree cleanup.
- When a PR is merged and the linked issue is auto-closed, both the PR close handler and the issue close handler may fire. The revert in the issue close handler is a no-op if the CSV was already committed (file still exists), so it will attempt a no-op revert and skip the rebuild/commit since `revertIssueCostFile` returns `false`.
