# Feature: PhaseCostRecord, CSV Output, and Per-Phase Commits

## Metadata
issueNumber: `243`
adwId: `h01a4p-cost-revamp-phasecos`
issueJson: `{"number":243,"title":"Cost revamp: PhaseCostRecord, CSV output, and per-phase commits","body":"## Parent PRD\n\nSee `specs/prd-cost-module-revamp.md` on the `dev` branch.\n\n## What to build\n\nIntroduce the `PhaseCostRecord` data model, rewrite CSV output to the new format, and commit cost data after each phase.\n\n- Implement `PhaseCostRecord` with fields: workflowId, issueNumber, phase, model, provider, tokenUsage (Record<string, number>), computedCostUsd, reportedCostUsd, status, retryCount, continuationCount, durationMs, timestamp, estimatedTokens, actualTokens\n- Update all phase files to produce PhaseCostRecord instances (one per model per phase)\n- Create `adws/cost/reporting/csvWriter.ts` with the new format: fixed superset columns (input, output, cache_read, cache_write, reasoning) plus unknown token types auto-appended as extra columns\n- Move exchange rate logic from `core/costReport.ts` to `adws/cost/exchangeRates.ts`\n- Per-issue CSV: one row per model per phase with all PhaseCostRecord fields\n- Project total CSV: one row per issue per phase, no markup column\n- CSV committed after each phase completion (not just workflow end), using existing `costCommitQueue` in `core/`\n\nRefer to the parent PRD's \"PhaseCostRecord data model\", \"CSV format changes\", and \"Implementation Decisions\" sections.\n\n## Acceptance criteria\n\n- [ ] `PhaseCostRecord` type defined with all specified fields\n- [ ] All phase files (planPhase, buildPhase, testPhase, prPhase, reviewPhase, documentPhase, scenarioPhase, kpiPhase) produce PhaseCostRecord instances\n- [ ] Per-issue CSV written in new format with one row per model per phase\n- [ ] Project total CSV written with one row per issue per phase, no markup\n- [ ] CSV columns include fixed superset (input, output, cache_read, cache_write, reasoning) with unknown types auto-appended\n- [ ] Exchange rates moved to `adws/cost/exchangeRates.ts`\n- [ ] CSV committed after each phase (not only at workflow end)\n- [ ] Unit tests cover: CSV serialization with various token types, dynamic column generation for unknown token types, project total aggregation\n- [ ] All existing type checks still pass\n\n## Blocked by\n\n- Blocked by #242\n\n## User stories addressed\n\n- User story 8: one record per model per phase\n- User story 9: retryCount, continuationCount, status on records\n- User story 10: CSV updated after each phase\n- User story 11: per-issue CSV in new format\n- User story 12: project total CSV as one row per issue per phase\n- User story 13: markup removed\n- User story 14: dynamic token type columns","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-19T10:37:45Z","comments":[],"actionableComment":null}`

## Feature Description
Introduce the `PhaseCostRecord` data model as the foundational cost tracking unit, rewrite CSV output to use the new per-model-per-phase format, move exchange rate logic to the new `adws/cost/` module, and commit cost CSVs after each phase completion instead of only at workflow end. This replaces the current `CostBreakdown`-based CSV output with a richer, more granular record that captures retry counts, continuation counts, status, duration, and extensible token type columns.

## User Story
As a workflow operator
I want cost data recorded per model per phase with dynamic token type columns and per-phase CSV commits
So that I have granular, crash-resilient cost visibility into which models and phases drive cost

## Problem Statement
The current cost tracking system writes CSV files only at workflow completion (`completeWorkflow()`), meaning cost data for completed phases is lost if a workflow crashes mid-execution. The CSV format uses a flat `CostBreakdown` with fixed token columns and includes a markup column that belongs in the invoicing layer. There is no per-phase metadata (status, retries, continuations, duration) and the format cannot accommodate new token types from future providers.

## Solution Statement
1. Define a `PhaseCostRecord` type in `adws/cost/types.ts` with all specified fields (workflowId, issueNumber, phase, model, provider, tokenUsage as `Record<string, number>`, computedCostUsd, reportedCostUsd, status, retryCount, continuationCount, durationMs, timestamp, estimatedTokens, actualTokens).
2. Create `adws/cost/reporting/csvWriter.ts` that serializes `PhaseCostRecord[]` to CSV with a fixed superset of token columns (input, output, cache_read, cache_write, reasoning) plus any unknown token types auto-appended as additional columns.
3. Move exchange rate logic from `adws/core/costReport.ts` to `adws/cost/exchangeRates.ts`.
4. Update all phase files to return `PhaseCostRecord[]` alongside the existing `{ costUsd, modelUsage }` return.
5. Update orchestrators to write CSV and commit cost data after each phase using the existing `costCommitQueue`.
6. Rewrite the project total CSV to use one row per issue per phase with no markup column.

## Relevant Files
Use these files to implement the feature:

- `adws/types/costTypes.ts` — Current cost type definitions (`ModelUsage`, `ModelUsageMap`, `CostBreakdown`). The `PhaseCostRecord` type will be defined in the new `adws/cost/types.ts` but these existing types remain in use for backward compatibility during migration.
- `adws/core/costCsvWriter.ts` — Current CSV writer with `writeIssueCostCsv()`, `rebuildProjectCostCsv()`, `formatIssueCostCsv()`, `formatProjectCostCsv()`. These will be replaced by the new CSV writer but kept until all callers migrate.
- `adws/core/costReport.ts` — Contains `fetchExchangeRates()`, `buildCostBreakdown()`, `mergeModelUsageMaps()`, `computeEurRate()`, `formatCostBreakdownMarkdown()`, `persistTokenCounts()`. Exchange rate logic moves to new module; other functions remain.
- `adws/core/costPricing.ts` — Model pricing definitions. Stays in place for now.
- `adws/core/costCommitQueue.ts` — Async operation queue for serializing cost git operations. Used as-is.
- `adws/core/index.ts` — Barrel exports. Needs new exports added.
- `adws/phases/planPhase.ts` — Plan phase: returns `{ costUsd, modelUsage }`. Must also produce `PhaseCostRecord[]`.
- `adws/phases/buildPhase.ts` — Build phase with token continuations. Must produce `PhaseCostRecord[]` with continuationCount.
- `adws/phases/testPhase.ts` — Test phase with retries. Must produce `PhaseCostRecord[]` with retryCount.
- `adws/phases/prPhase.ts` — PR phase. Must produce `PhaseCostRecord[]`.
- `adws/phases/workflowCompletion.ts` — Contains `completeWorkflow()` which currently writes CSV at workflow end and `executeReviewPhase()` with retries.
- `adws/phases/documentPhase.ts` — Document phase. Must produce `PhaseCostRecord[]`.
- `adws/phases/scenarioPhase.ts` — Scenario phase. Must produce `PhaseCostRecord[]`.
- `adws/phases/kpiPhase.ts` — KPI phase. Must produce `PhaseCostRecord[]`.
- `adws/adwSdlc.tsx` — Full SDLC orchestrator, primary orchestrator to update for per-phase CSV commits.
- `adws/adwPlanBuild.tsx` — Plan+Build orchestrator.
- `adws/adwPlanBuildTest.tsx` — Plan+Build+Test orchestrator.
- `adws/adwPlanBuildReview.tsx` — Plan+Build+Review orchestrator.
- `adws/adwPlanBuildTestReview.tsx` — Plan+Build+Test+Review orchestrator.
- `adws/adwPlanBuildDocument.tsx` — Plan+Build+Document orchestrator.
- `adws/adwPrReview.tsx` — PR review orchestrator.
- `adws/vcs/commitOperations.ts` — Contains `commitAndPushCostFiles()` used for git commit/push of cost CSVs.
- `adws/triggers/webhookHandlers.ts` — Uses `rebuildProjectCostCsv()` on PR close. Must use new CSV writer.
- `adws/triggers/trigger_webhook.ts` — Uses `rebuildProjectCostCsv()` on issue close. Must use new CSV writer.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md` — Context on cost CSV commit/push flow.
- `app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md` — Context on auto-commit cost on PR close.

### New Files
- `adws/cost/types.ts` — `PhaseCostRecord` interface and `PhaseCostStatus` enum, plus helper factory function.
- `adws/cost/exchangeRates.ts` — Exchange rate fetching logic (moved from `core/costReport.ts`).
- `adws/cost/reporting/csvWriter.ts` — New CSV writer: `formatIssueCostCsv()`, `writeIssueCostCsv()`, `formatProjectTotalCsv()`, `rebuildProjectTotalCsv()`, with dynamic token type columns.
- `adws/cost/index.ts` — Barrel exports for the new cost module.
- `adws/cost/reporting/index.ts` — Barrel exports for reporting sub-module.

## Implementation Plan
### Phase 1: Foundation
Create the new `adws/cost/` module structure with the `PhaseCostRecord` type, exchange rate utilities, and CSV writer. This is pure additive work — no existing code changes, no risk of breaking anything.

### Phase 2: Core Implementation
Update all 8 phase files to produce `PhaseCostRecord[]` alongside existing return values. Add a helper function to convert from the existing `{ costUsd, modelUsage }` phase return into `PhaseCostRecord[]`. Update `completeWorkflow()` to use the new CSV writer.

### Phase 3: Integration
Wire orchestrators to write CSV and commit cost data after each phase completion using `costCommitQueue`. Update webhook handlers to use new CSV writer. Update barrel exports. Ensure all type checks pass.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `adws/cost/types.ts` — PhaseCostRecord type
- Define `PhaseCostStatus` enum with values: `success`, `partial`, `failed`
- Define `PhaseCostRecord` interface with all specified fields:
  - `workflowId: string` (adwId)
  - `issueNumber: number`
  - `phase: string` (e.g., 'plan', 'build', 'test', 'pr', 'review', 'document', 'scenario', 'kpi')
  - `model: string`
  - `provider: string` (e.g., 'anthropic')
  - `tokenUsage: Record<string, number>` — extensible token type map
  - `computedCostUsd: number`
  - `reportedCostUsd: number`
  - `status: PhaseCostStatus`
  - `retryCount: number`
  - `continuationCount: number`
  - `durationMs: number`
  - `timestamp: string` (ISO 8601)
  - `estimatedTokens: number`
  - `actualTokens: number`
- Create `createPhaseCostRecords()` helper that converts existing `{ costUsd, modelUsage: ModelUsageMap }` phase return into `PhaseCostRecord[]` (one record per model). This function takes additional metadata (workflowId, issueNumber, phase, status, retryCount, continuationCount, durationMs) and maps each model's `ModelUsage` to a `PhaseCostRecord` with `tokenUsage` as `{ input: usage.inputTokens, output: usage.outputTokens, cache_read: usage.cacheReadInputTokens, cache_write: usage.cacheCreationInputTokens }`.
- Set `provider` to `'anthropic'` as default (only provider currently supported).
- Set `reportedCostUsd` to the model's `costUSD` field from `ModelUsage`.
- Set `computedCostUsd` to the same value for now (divergence checking is a separate issue).
- Set `estimatedTokens` and `actualTokens` to `0` for now (streaming estimation is a separate issue).

### Step 2: Create `adws/cost/exchangeRates.ts` — Move exchange rate logic
- Move `fetchExchangeRates()`, `FALLBACK_EUR_RATE`, `MAX_EXCHANGE_RATE_RETRIES`, `EXCHANGE_RATE_TIMEOUT_MS`, `CURRENCY_SYMBOLS`, `FALLBACK_RATES`, `lastKnownRates` from `adws/core/costReport.ts` to `adws/cost/exchangeRates.ts`.
- Update `adws/core/costReport.ts` to import from `adws/cost/exchangeRates.ts` and re-export for backward compatibility.
- Verify all existing callers of `fetchExchangeRates` and `CURRENCY_SYMBOLS` still compile.

### Step 3: Create `adws/cost/reporting/csvWriter.ts` — New CSV writer
- Define `FIXED_TOKEN_COLUMNS` constant: `['input', 'output', 'cache_read', 'cache_write', 'reasoning']`
- Implement `collectAllTokenTypes(records: PhaseCostRecord[]): string[]` — scans all records' `tokenUsage` keys, returns fixed columns + any unknown types appended alphabetically.
- Implement `formatIssueCostCsv(records: PhaseCostRecord[]): string` — generates CSV with columns: `workflow_id, issue_number, phase, model, provider, computed_cost_usd, reported_cost_usd, status, retry_count, continuation_count, duration_ms, timestamp, estimated_tokens, actual_tokens, [token columns...]`. Token columns use the dynamic list from `collectAllTokenTypes()`.
- Implement `writeIssueCostCsv(repoRoot: string, repoName: string, issueNumber: number, issueTitle: string, records: PhaseCostRecord[]): void` — writes the formatted CSV to `projects/<repoName>/<issueNumber>-<slug>.csv`, creating directories as needed.
- Implement `appendIssueCostCsv(repoRoot: string, repoName: string, issueNumber: number, issueTitle: string, newRecords: PhaseCostRecord[]): void` — reads existing CSV (if any), parses into `PhaseCostRecord[]`, merges with new records, and rewrites. This supports per-phase incremental writes.
- Implement `parseIssueCostCsv(csvContent: string): PhaseCostRecord[]` — parses the new CSV format back into records.
- Define `ProjectTotalRow` interface: `{ issueNumber, issueDescription, phase, model, costUsd }` (no markup).
- Implement `formatProjectTotalCsv(rows: ProjectTotalRow[], eurRate: number): string` — columns: `Issue number, Issue description, Phase, Model, Cost (USD)` with totals at bottom.
- Implement `rebuildProjectTotalCsv(repoRoot: string, repoName: string, eurRate: number): void` — scans all issue CSVs in `projects/<repoName>/`, parses each with `parseIssueCostCsv()`, builds `ProjectTotalRow[]`, writes `total-cost.csv`.
- Implement `parseIssueCostTotal(csvContent: string): number` — extracts total USD cost from a new-format issue CSV (sums `computed_cost_usd` column).

### Step 4: Create barrel exports
- Create `adws/cost/reporting/index.ts` re-exporting everything from `csvWriter.ts`.
- Create `adws/cost/index.ts` re-exporting from `types.ts`, `exchangeRates.ts`, and `reporting/`.
- Update `adws/core/index.ts` to add exports from `adws/cost/` for the new types and functions.

### Step 5: Update phase files to produce PhaseCostRecord[]
- Each phase file (`planPhase.ts`, `buildPhase.ts`, `testPhase.ts`, `prPhase.ts`, `documentPhase.ts`, `scenarioPhase.ts`, `kpiPhase.ts`) and `executeReviewPhase` in `workflowCompletion.ts`:
  - Add `phaseStartTime = Date.now()` at phase entry.
  - Update return type to include `phaseCostRecords: PhaseCostRecord[]`.
  - After the phase completes, call `createPhaseCostRecords()` with the accumulated `modelUsage`, `costUsd`, and metadata (workflowId from `config.adwId`, issueNumber, phase name, status, retryCount/continuationCount where applicable, `Date.now() - phaseStartTime` for durationMs).
  - For `buildPhase.ts`: pass `continuationCount` = number of continuations that occurred.
  - For `testPhase.ts`: pass `retryCount` = `totalRetries`.
  - For `executeReviewPhase`: pass `retryCount` = `totalRetries`.
  - For other phases: pass `retryCount: 0`, `continuationCount: 0`.
  - Return the `phaseCostRecords` alongside existing return values.

### Step 6: Update orchestrators for per-phase CSV commit
- In each orchestrator (`adwSdlc.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`):
  - Import `appendIssueCostCsv` and `rebuildProjectTotalCsv` from `adws/cost/reporting/csvWriter.ts`.
  - Import `costCommitQueue` from `adws/core/costCommitQueue.ts`.
  - Import `commitAndPushCostFiles` from `adws/vcs`.
  - Import `fetchExchangeRates` from `adws/cost/exchangeRates.ts`.
  - After each phase completes and returns `phaseCostRecords`:
    1. Accumulate records into a `allPhaseCostRecords: PhaseCostRecord[]` array.
    2. Call `appendIssueCostCsv()` to write/update the per-issue CSV with the new records.
    3. Fetch EUR rate and call `rebuildProjectTotalCsv()`.
    4. Enqueue a cost commit via `costCommitQueue.enqueue(() => commitAndPushCostFiles({ repoName }))`.
  - Extract this into a shared helper function `commitPhasesCostData(config, records, repoName)` in a new file or in the orchestrator utilities to avoid code duplication across all 6+ orchestrators.
- Update `completeWorkflow()` in `workflowCompletion.ts`:
  - Remove the existing CSV write logic (it now happens per-phase).
  - Keep the cost breakdown for GitHub comments.

### Step 7: Update `adwPrReview.tsx` orchestrator
- PR review orchestrator uses `PRReviewWorkflowConfig` (different from `WorkflowConfig`).
- Apply the same per-phase CSV commit pattern using the phase cost records from the review phase.
- The PR review completion in `prReviewCompletion.ts` currently writes CSV — update it to use the new format.

### Step 8: Update webhook handlers
- `adws/triggers/webhookHandlers.ts`: Update `handlePullRequestEvent()` to call `rebuildProjectTotalCsv()` (new) instead of `rebuildProjectCostCsv()` (old).
- `adws/triggers/trigger_webhook.ts`: Update issue close handler to call `rebuildProjectTotalCsv()` (new) instead of `rebuildProjectCostCsv()` (old).
- Both handlers should import from the new `adws/cost/reporting/csvWriter.ts`.

### Step 9: Run validation commands
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify all types compile.
- Run `bun run lint` to check for code quality issues.
- Run `bun run build` to verify no build errors.

## Testing Strategy
### Edge Cases
- Token usage with unknown token types (e.g., `reasoning` from OpenAI) — should auto-append as CSV columns.
- Empty `PhaseCostRecord[]` — CSV should produce header-only output.
- Phase with zero cost (e.g., skipped phase) — should still produce a record with zeroed values.
- Multiple models in a single phase (e.g., haiku subagent) — should produce one record per model.
- Concurrent orchestrator runs writing to the same project total CSV — `costCommitQueue` serializes.
- CSV with mixed token type sets across phases (phase A has `cache_read`, phase B has `reasoning`) — all columns present in all rows, missing values default to `0`.
- Existing per-issue CSV from old format — `appendIssueCostCsv` should detect old format and overwrite (not merge) since the formats are incompatible.

## Acceptance Criteria
- [ ] `PhaseCostRecord` type defined in `adws/cost/types.ts` with all 15 specified fields
- [ ] `createPhaseCostRecords()` factory function converts `{ costUsd, modelUsage }` to `PhaseCostRecord[]`
- [ ] Exchange rates moved to `adws/cost/exchangeRates.ts` with backward-compatible re-export from `core/costReport.ts`
- [ ] New CSV writer at `adws/cost/reporting/csvWriter.ts` with dynamic token type columns
- [ ] Per-issue CSV format: one row per model per phase with all `PhaseCostRecord` fields
- [ ] Project total CSV format: one row per issue per phase, no markup column
- [ ] All 8 phase files produce `PhaseCostRecord[]` in their return values
- [ ] All orchestrators write CSV and enqueue cost commit after each phase completion
- [ ] Webhook handlers use new `rebuildProjectTotalCsv()` function
- [ ] `completeWorkflow()` no longer writes CSV (moved to per-phase)
- [ ] `bunx tsc --noEmit` passes
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` passes
- [ ] `bun run lint` passes
- [ ] `bun run build` passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW scripts type check
- `bun run lint` — ESLint code quality check
- `bun run build` — Build verification

## Notes
- **No unit tests**: `.adw/project.md` has `## Unit Tests: disabled`, so no unit test tasks are included in this plan. The acceptance criteria item for unit tests from the issue is noted but deferred to a follow-up where unit test infrastructure (Vitest) is introduced.
- **Backward compatibility**: The old CSV functions in `adws/core/costCsvWriter.ts` are kept but their callers are updated to use the new writer. The old module can be removed in a follow-up cleanup issue.
- **Exchange rate re-export**: `adws/core/costReport.ts` will re-export `fetchExchangeRates` and `CURRENCY_SYMBOLS` from the new location so that existing callers don't need to change their imports immediately.
- **`costCommitQueue` stays in `core/`**: As noted in the PRD, the commit queue is git infrastructure, not cost logic, and is not moved.
- **`estimatedTokens` and `actualTokens`**: Set to `0` in this issue. Streaming token estimation (user stories 1, 2) is a separate issue (#242 or later).
- **`computedCostUsd` vs `reportedCostUsd`**: Both set to the CLI-reported cost for now. Local computation from pricing tables is a separate issue.
- **`provider` field**: Hardcoded to `'anthropic'` since it is the only supported provider. Multi-provider support is a separate issue.
- Follow `guidelines/coding_guidelines.md`: immutability (readonly fields on PhaseCostRecord), modularity (files under 300 lines), type safety (strict types), functional style (map/filter over loops).
