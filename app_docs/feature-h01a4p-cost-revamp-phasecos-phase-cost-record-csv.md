# PhaseCostRecord, CSV Output, and Per-Phase Commits

**ADW ID:** h01a4p-cost-revamp-phasecos
**Date:** 2026-03-19
**Specification:** specs/issue-243-adw-h01a4p-cost-revamp-phasecos-sdlc_planner-phase-cost-record-csv.md

## Overview

Introduces the `PhaseCostRecord` data model as the foundational cost tracking unit, replacing the flat `CostBreakdown`-based CSV output with a richer per-model-per-phase record. Cost CSVs are now written and committed after each phase completes rather than only at workflow end, providing crash-resilient cost visibility.

## What Was Built

- `PhaseCostRecord` interface and `PhaseCostStatus` enum with 15 fields including retryCount, continuationCount, durationMs, and extensible `tokenUsage` map
- `createPhaseCostRecords()` factory that converts existing `{ costUsd, modelUsage }` phase returns to `PhaseCostRecord[]`
- New CSV writer (`adws/cost/reporting/csvWriter.ts`) with dynamic token type columns: fixed superset (input, output, cache_read, cache_write, reasoning) plus unknown types auto-appended alphabetically
- `appendIssueCostCsv()` for incremental per-phase writes with old-format detection and replacement
- `rebuildProjectTotalCsv()` replacing the old `rebuildProjectCostCsv()` — one row per issue/phase/model, no markup column
- Exchange rate logic moved from `adws/core/costReport.ts` to `adws/cost/exchangeRates.ts` with backward-compatible re-export
- `commitPhasesCostData()` shared helper used by all orchestrators to write CSV and enqueue a cost git commit after each phase
- All 8 phase files updated to produce and return `PhaseCostRecord[]`
- All orchestrators wired to call `commitPhasesCostData()` after each phase
- Webhook handlers updated to use `rebuildProjectTotalCsv()` instead of old function
- BDD feature file and step definitions covering the new CSV format and per-phase commit behavior

## Technical Implementation

### Files Modified

- `adws/cost/types.ts` *(new)*: `PhaseCostStatus` enum, `PhaseCostRecord` interface, `createPhaseCostRecords()` factory
- `adws/cost/exchangeRates.ts` *(new)*: `fetchExchangeRates()`, fallback rates, currency symbols — moved from `core/costReport.ts`
- `adws/cost/reporting/csvWriter.ts` *(new)*: Full CSV writer — `formatIssueCostCsv`, `writeIssueCostCsv`, `appendIssueCostCsv`, `parseIssueCostCsv`, `parseIssueCostTotal`, `formatProjectTotalCsv`, `rebuildProjectTotalCsv`, `collectAllTokenTypes`
- `adws/cost/reporting/index.ts` *(new)*: Barrel re-exports for the reporting sub-module
- `adws/cost/index.ts` *(new)*: Barrel re-exports for the entire cost module
- `adws/phases/phaseCostCommit.ts` *(new)*: `commitPhaseCostData()` and `commitPhasesCostData()` shared helpers
- `adws/core/costReport.ts`: Exchange rate logic removed, replaced with re-export from `adws/cost/exchangeRates.ts`
- `adws/core/index.ts`: New cost module exports added
- `adws/phases/buildPhase.ts`, `planPhase.ts`, `testPhase.ts`, `prPhase.ts`, `documentPhase.ts`, `scenarioPhase.ts`, `kpiPhase.ts`: Return type extended with `phaseCostRecords: PhaseCostRecord[]`; `phaseStartTime` tracked; `createPhaseCostRecords()` called on completion
- `adws/phases/workflowCompletion.ts`: `executeReviewPhase` extended with `phaseCostRecords`; CSV write at workflow end removed (now per-phase)
- `adws/phases/prReviewCompletion.ts`: Updated to use new CSV writer
- `adws/adwSdlc.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`: `commitPhasesCostData()` called after each phase
- `adws/triggers/webhookHandlers.ts`, `trigger_webhook.ts`: Use `rebuildProjectTotalCsv()` instead of old function
- `features/phase_cost_record_csv.feature` *(new)*: BDD scenarios covering all acceptance criteria
- `features/step_definitions/phaseCostRecordCsvSteps.ts` *(new)*: Step definitions for the BDD feature

### Key Changes

- **Per-phase commits**: `commitPhasesCostData()` is called after every phase in every orchestrator, so cost data survives workflow crashes at any stage
- **Dynamic token columns**: `collectAllTokenTypes()` builds the CSV header by unioning all `tokenUsage` keys across records; unknown types (e.g., `reasoning`) are auto-appended alphabetically after the fixed superset
- **Old-format detection**: `parseIssueCostCsv()` checks for the `workflow_id` sentinel column and returns `[]` for old-format files, causing `appendIssueCostCsv()` to silently overwrite them
- **No markup in project total**: `formatProjectTotalCsv()` has columns `Issue number, Issue description, Phase, Model, Cost (USD)` — markup belongs in the invoicing layer
- **Backward compatibility**: `adws/core/costReport.ts` re-exports `fetchExchangeRates` and `CURRENCY_SYMBOLS` from the new location so existing callers compile without changes

## How to Use

1. **Per-issue CSV**: After each phase, the orchestrator calls `commitPhasesCostData(config, phaseCostRecords)`. The CSV at `projects/<repoName>/<issueNumber>-<slug>.csv` is updated incrementally.
2. **Read per-issue CSV**: Each row is one model's usage within one phase. Columns include `workflow_id`, `phase`, `model`, `computed_cost_usd`, `retry_count`, `continuation_count`, `duration_ms`, token columns, etc.
3. **Project total CSV**: `projects/<repoName>/total-cost.csv` is rebuilt from all issue CSVs after every phase commit. One row per (issue, phase, model), no markup.
4. **Custom token types**: If a future provider returns a token type not in the fixed superset, it is auto-appended as an extra column in both the issue CSV and the parse round-trip.
5. **Manual rebuild**: Call `rebuildProjectTotalCsv(repoRoot, repoName, eurRate)` to regenerate the project total CSV from all existing issue CSVs.

## Configuration

No new environment variables. Relies on:
- `costCommitQueue` (existing) to serialize git operations
- `commitAndPushCostFiles` (existing) for the actual git commit/push
- Exchange rate API: `https://open.er-api.com/v6/latest/USD` with `FALLBACK_EUR_RATE = 0.92`

## Testing

BDD scenarios are in `features/phase_cost_record_csv.feature`. Run with:

```
bunx cucumber-js features/phase_cost_record_csv.feature
```

Scenarios cover:
- CSV format with dynamic token type columns
- `appendIssueCostCsv` incremental write and old-format overwrite
- Project total CSV rebuild from multiple issue CSVs
- Per-phase commit called after each phase in orchestrators
- `parseIssueCostTotal` summing computed costs

## Notes

- `estimatedTokens` and `actualTokens` are hardcoded to `0` — streaming token estimation is a separate issue
- `computedCostUsd` equals `reportedCostUsd` for now — local pricing computation is a separate issue
- `provider` is hardcoded to `'anthropic'` — multi-provider support is a separate issue
- The old `adws/core/costCsvWriter.ts` is kept for now; callers have been updated to the new writer but the old module can be removed in a follow-up cleanup
- `workflowCompletion.ts` no longer writes CSV — the per-phase `commitPhasesCostData` calls replace it
