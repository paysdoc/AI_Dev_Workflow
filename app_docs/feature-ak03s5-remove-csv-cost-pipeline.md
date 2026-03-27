# Remove CSV Cost Pipeline

**ADW ID:** ak03s5-remove-csv-cost-pipe
**Date:** 2026-03-27
**Specification:** specs/issue-335-adw-ak03s5-remove-csv-cost-pipe-sdlc_planner-remove-csv-cost-pipeline.md

## Overview

Removes the entire CSV-based cost tracking pipeline from ADW now that Cloudflare D1 is the sole persistence layer for cost records. This cleanup eliminates ~175 CSV data files, the CSV writer/parser, the serialized commit queue, the `/commit_cost` slash command, and all call sites — leaving D1-only writes as the canonical cost persistence path.

## What Was Built

- Deleted `adws/cost/reporting/csvWriter.ts` — CSV write/parse/format functions
- Deleted `adws/cost/commitQueue.ts` and `adws/core/costCommitQueue.ts` — serialized git commit queue for CSV files
- Deleted `adws/phases/phaseCostCommit.ts` — dual-write wrapper (CSV + D1); D1 write inlined directly into `phaseRunner.ts`
- Deleted `.claude/commands/commit_cost.md` — `/commit_cost` slash command
- Deleted `workers/cost-api/migrate.ts` — one-time CSV-to-D1 migration script (migration complete)
- Deleted `projects/` directory — all CSV cost data files (~175 files across 3 projects)
- Deleted CSV-specific BDD feature files: `phase_cost_record_csv.feature`, `csv_migration_d1_upload.feature`, and their step definitions
- Relocated `collectAllTokenTypes()` and `FIXED_TOKEN_COLUMNS` from `csvWriter.ts` into `commentFormatter.ts` (required before deletion)
- Removed `commitAndPushCostFiles()`, `pullLatestCostBranch()`, and `CommitCostFilesOptions` from `adws/vcs/commitOperations.ts`
- Removed CSV cost-handling block from `webhookHandlers.ts` including `mergedPrIssues` coordination set
- Removed `handleIssueCostRevert()` from `trigger_webhook.ts`
- Removed `/commit_cost` from `SlashCommand` type and all four model/effort routing maps
- Updated barrel exports in `adws/cost/reporting/index.ts`, `adws/cost/index.ts`, and `adws/core/index.ts`

## Technical Implementation

### Files Modified

- `adws/cost/reporting/commentFormatter.ts`: Added `FIXED_TOKEN_COLUMNS` and `collectAllTokenTypes()` relocated from `csvWriter.ts`; removed `csvWriter.ts` import
- `adws/cost/reporting/index.ts`: Removed all `csvWriter.ts` re-exports; now only re-exports from `commentFormatter.ts`
- `adws/cost/index.ts`: Removed `ProjectTotalRow`, all CSV function exports, and `CostCommitQueue`/`costCommitQueue` exports
- `adws/core/index.ts`: Removed `costCommitQueue`/`CostCommitQueue` re-export and all CSV function re-exports
- `adws/core/phaseRunner.ts`: Replaced `commitPhasesCostData` (dual-write) with direct `postCostRecordsToD1` fire-and-forget call in `CostTracker.commit()`
- `adws/phases/prReviewCompletion.ts`: Removed `appendIssueCostCsv`, `rebuildProjectTotalCsv`, and `fetchExchangeRates` calls; added `postCostRecordsToD1` fire-and-forget
- `adws/triggers/webhookHandlers.ts`: Removed CSV commit queue block, `mergedPrIssues` set, `recordMergedPrIssue()`, and `wasMergedViaPR()` functions
- `adws/triggers/trigger_webhook.ts`: Removed `handleIssueCostRevert()` function and its call site; removed CSV-related imports
- `adws/types/issueTypes.ts`: Removed `'/commit_cost'` from `SlashCommand` union type
- `adws/core/modelRouting.ts`: Removed `/commit_cost` entries from all four routing maps
- `adws/vcs/commitOperations.ts`: Deleted `pullLatestCostBranch()`, `CommitCostFilesOptions`, and `commitAndPushCostFiles()`
- `adws/vcs/index.ts`: Removed the three deleted VCS exports
- `features/cost_orchestrator_migration_cleanup.feature`: Removed `costCommitQueue` scenarios and `rebuildProjectTotalCsv` assertion
- `features/step_definitions/costOrchestratorMigrationCleanupSteps.ts`: Removed `costCommitQueue` assertion steps
- `features/step_definitions/costCommentFormatterSteps.ts`: Removed `csvWriter.ts` import and stale source-code assertion step
- `features/fix_pr_review_issue_number.feature`: Removed scenarios referencing `csvWriter.ts`
- `features/step_definitions/fixPrReviewIssueNumberSteps.ts`: Removed steps referencing `csvWriter.ts` and `rebuildProjectTotalCsv`
- `features/remove_unnecessary_exports.feature`: Removed `recordMergedPrIssue`/`resetMergedPrIssues` scenario (functions deleted)
- `README.md`: Removed `commit_cost.md`, `projects/`, `phaseCostCommit.ts`, `costCommitQueue.ts`, and `commitQueue.ts` entries from project structure

### Key Changes

- **D1-only writes**: `CostTracker.commit()` in `phaseRunner.ts` now calls `postCostRecordsToD1` directly; errors are swallowed (fire-and-forget) preserving the invariant that cost failures never abort workflows
- **`mergedPrIssues` coordination removed**: This in-memory set existed solely to sequence CSV writes between PR close and issue close handlers; with CSV gone, the coordination layer is unnecessary
- **`collectAllTokenTypes` relocated**: This function (and `FIXED_TOKEN_COLUMNS`) was the only cross-file dependency blocking `csvWriter.ts` deletion; it now lives in `commentFormatter.ts` where it is consumed
- **`projects/` removed from git**: All historical CSV data was already migrated to D1 before this cleanup
- **BDD regression suite cleaned**: Stale scenarios asserting existence of deleted files/functions were removed to keep `@regression` green

## How to Use

No user-facing changes. Cost tracking continues automatically via D1:

1. ADW phases complete → `CostTracker.commit()` fires a D1 write via `postCostRecordsToD1`
2. PR review completion → `buildPRReviewCostSection()` fires a D1 write
3. GitHub cost comments still render correctly via `formatCostCommentSection()` (reads from `PhaseCostRecord`, not CSV)

## Configuration

No new configuration required. Existing env vars apply:

- `COST_API_URL` — endpoint for the `cost-api` Cloudflare Worker
- `COST_API_TOKEN` — bearer token for authenticating cost writes

If either var is missing, D1 writes are silently skipped (unchanged behavior from dual-write era).

## Testing

```bash
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run lint
bun run build
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- `commitAndPushKpiFile()` in `commitOperations.ts` is unrelated to CSV cost tracking and was intentionally preserved
- `formatCostCommentSection()` and the other comment formatters in `commentFormatter.ts` work with `PhaseCostRecord` (not CSV) and are preserved
- Historical documentation in `app_docs/` referencing CSV concepts (e.g., `feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md`) is kept as an artifact but is no longer operationally relevant
