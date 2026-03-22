# Feature: Cost revamp — orchestrator migration and old code cleanup

## Metadata
issueNumber: `245`
adwId: `sgdfol-cost-revamp-orchestr`
issueJson: `{"number":245,"title":"Cost revamp: orchestrator migration and old code cleanup","body":"## Parent PRD\n\nSee `specs/prd-cost-module-revamp.md` on the `dev` branch.\n\n## What to build\n\nFinal migration slice: update all orchestrators to the new cost flow, delete old cost code, and verify everything works end-to-end.\n\n- Update all orchestrators (`adwSdlc.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`, `adwPatch.tsx`, `adwPrReview.tsx`, `adwBuild.tsx`, `adwTest.tsx`, `adwDocument.tsx`, `adwInit.tsx`) to use the new cost types and flow from `adws/cost/`\n- Delete old files: `core/costPricing.ts`, `core/costReport.ts`, `core/costCsvWriter.ts`, `core/tokenManager.ts`, `types/costTypes.ts`\n- Retire `ClaudeCodeResultMessage` type from `types/agentTypes.ts` (cost fields no longer needed — extractor handles everything)\n- Strip token/cost extraction responsibility from `agents/jsonlParser.ts` (keep output parsing: text, tool calls, progress)\n- Update all imports across the entire codebase to point to `adws/cost/`\n- `core/costCommitQueue.ts` stays in `core/` (unchanged)\n- Verify all type checks, unit tests, and BDD scenarios pass\n\nRefer to the parent PRD's \"Code migration\" section.\n\n## Acceptance criteria\n\n- [ ] All orchestrators use new cost flow from `adws/cost/`\n- [ ] Old files deleted: `core/costPricing.ts`, `core/costReport.ts`, `core/costCsvWriter.ts`, `core/tokenManager.ts`, `types/costTypes.ts`\n- [ ] `ClaudeCodeResultMessage` no longer has cost-related fields\n- [ ] `jsonlParser.ts` no longer handles token/cost extraction\n- [ ] No imports reference deleted modules\n- [ ] `core/costCommitQueue.ts` unchanged and still functional\n- [ ] `bun run test` (type checks) passes\n- [ ] All Vitest unit tests pass\n- [ ] All BDD scenarios pass\n- [ ] A full workflow run (e.g., `adwPlanBuild.tsx`) completes with correct cost output in CSV and comments","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-19T10:38:22Z","comments":[{"author":"paysdoc","createdAt":"2026-03-21T22:52:58Z","body":"## Take action"},{"author":"paysdoc","createdAt":"2026-03-21T23:26:31Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Final migration slice of the cost module revamp. The new `adws/cost/` module (types, computation, providers, reporting) was built in issues #241–#244. This issue completes the migration by:

1. Moving all function calls in orchestrators and supporting files away from old cost modules (`core/costPricing.ts`, `core/costReport.ts`, `core/costCsvWriter.ts`, `core/tokenManager.ts`, `types/costTypes.ts`) to the new `adws/cost/` equivalents.
2. Stripping cost-related fields from `ClaudeCodeResultMessage` in `types/agentTypes.ts` (the `AnthropicTokenUsageExtractor` already handles extraction).
3. Removing token/cost extraction from `agents/jsonlParser.ts` (keep text, tool calls, and progress parsing).
4. Deleting the five old files entirely.
5. Cleaning up barrel re-exports in `core/index.ts`, `types/index.ts`, and `agents/claudeAgent.ts`.

## User Story
As a developer maintaining the ADW codebase
I want all cost tracking to flow through the single `adws/cost/` module
So that there is one authoritative cost system with no legacy code paths, making the codebase easier to understand, extend to new providers, and debug.

## Problem Statement
The codebase currently runs a dual-track cost system: the old modules (`costPricing`, `costReport`, `costCsvWriter`, `tokenManager`, `costTypes`) coexist alongside the new `adws/cost/` module. Functions like `mergeModelUsageMaps`, `persistTokenCounts`, `computeDisplayTokens`, `buildCostBreakdown`, and `formatCostBreakdownMarkdown` are still called from old locations. This duplication causes confusion, increases maintenance burden, and risks divergence between the two systems.

## Solution Statement
Replace every usage of old cost functions with their new-module equivalents, relocate shared helpers (like `mergeModelUsageMaps`, `persistTokenCounts`, `computeDisplayTokens`) into `adws/cost/`, strip legacy cost fields from types and parsers, delete the old files, and update all barrel re-exports. The migration is purely internal — no behavioral changes to cost tracking, CSV output, or comment formatting.

## Relevant Files
Use these files to implement the feature:

### Files to modify
- `adws/core/index.ts` — Remove re-exports of deleted modules; keep re-exports from `adws/cost/` and `costCommitQueue`
- `adws/types/index.ts` — Remove `export * from './costTypes'` line
- `adws/types/agentTypes.ts` — Strip `totalCostUsd` and `modelUsage` cost fields from `ClaudeCodeResultMessage`
- `adws/agents/jsonlParser.ts` — Remove token/cost extraction logic; keep text, tool call, and progress parsing
- `adws/agents/claudeAgent.ts` — Remove backward-compatible re-exports of `computeDisplayTokens` and `computeTotalTokens` from tokenManager
- `adws/agents/agentProcessHandler.ts` — Update imports to point to `adws/cost/` instead of `../core/tokenManager` or `../types/costTypes`
- `adws/core/retryOrchestrator.ts` — Update imports of `mergeModelUsageMaps`, `persistTokenCounts`, `ModelUsageMap`, `emptyModelUsageMap` to come from `adws/cost/`
- `adws/phases/workflowCompletion.ts` — Update imports of `buildCostBreakdown`, `COST_REPORT_CURRENCIES` to new module
- `adws/phases/buildPhase.ts` — Update import of `computeDisplayTokens`
- `adws/phases/phaseCostCommit.ts` — Verify imports already point to new module (they do)
- `adws/adwSdlc.tsx` — Update cost-related imports from `./core` to `./cost`
- `adws/adwPlanBuild.tsx` — Update cost-related imports
- `adws/adwPlanBuildTest.tsx` — Update cost-related imports
- `adws/adwPlanBuildReview.tsx` — Update cost-related imports
- `adws/adwPlanBuildTestReview.tsx` — Update cost-related imports
- `adws/adwPlanBuildDocument.tsx` — Update cost-related imports
- `adws/adwPatch.tsx` — Update cost-related imports
- `adws/adwPrReview.tsx` — Update cost-related imports
- `adws/adwBuild.tsx` — Update cost-related imports
- `adws/adwTest.tsx` — Update cost-related imports
- `adws/adwDocument.tsx` — Update cost-related imports (if any)
- `adws/adwInit.tsx` — Update cost-related imports
- `adws/index.ts` — Remove `ClaudeCodeResultMessage` from exports if cost fields were its only reason for being exported (verify first)
- `README.md` — Update project structure to remove deleted files from the tree

### Files to delete
- `adws/core/costPricing.ts` — Old pricing data, replaced by `adws/cost/providers/anthropic/pricing.ts`
- `adws/core/costReport.ts` — Old cost report utilities, replaced by `adws/cost/` computation + reporting + `costHelpers.ts`
- `adws/core/costCsvWriter.ts` — Old CSV writer, replaced by `adws/cost/reporting/csvWriter.ts`
- `adws/core/tokenManager.ts` — Old token computation, replaced by functions in `adws/cost/`
- `adws/types/costTypes.ts` — Old cost types, replaced by `adws/cost/types.ts`

### Files to keep unchanged
- `adws/core/costCommitQueue.ts` — Remains in `core/` (queue infrastructure, not cost-specific logic)

### New Files
- `adws/cost/costHelpers.ts` — New home for migrated utility functions (`mergeModelUsageMaps`, `persistTokenCounts`, `computeDisplayTokens`, `computeTotalTokens`, `computePrimaryModelTokens`, `isModelMatch`, `computeTotalCostUsd`, `buildCostBreakdown`, `formatCostBreakdownMarkdown`, `computeEurRate`) that are not yet in `adws/cost/` but are heavily used by orchestrators. These are pure functions that aggregate `ModelUsageMap` data and should live alongside the cost types they operate on.

### Reference documentation
- `app_docs/feature-h01a4p-cost-revamp-phasecos-phase-cost-record-csv.md` — PhaseCostRecord architecture
- `app_docs/feature-ku956a-cost-revamp-core-com-cost-module-core-vitest.md` — Core cost module design
- `app_docs/feature-tgs1li-cost-revamp-wire-ext-wire-extractor-agent-handler.md` — Extractor wiring
- `app_docs/feature-j2ydkj-cost-comment-formatter.md` — Comment formatter design
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

## Implementation Plan
### Phase 1: Foundation — Migrate shared cost utilities into `adws/cost/`
Before touching orchestrators, consolidate the utility functions that orchestrators depend on. Functions like `mergeModelUsageMaps`, `persistTokenCounts`, `computeDisplayTokens`, `computeTotalCostUsd`, `buildCostBreakdown`, and `formatCostBreakdownMarkdown` currently live in `core/costReport.ts` and `core/tokenManager.ts`. Move them into a new `adws/cost/costHelpers.ts` file, updating their imports to use `adws/cost/types.ts` types instead of `types/costTypes.ts`. Re-export from `adws/cost/index.ts`.

During this phase, `core/index.ts` barrel temporarily re-exports from the new location so nothing breaks. The old files still exist but are no longer the source of truth.

### Phase 2: Core Implementation — Update all consumers
With utilities consolidated in `adws/cost/`, update every consumer file:
- All 12 orchestrators: change cost-related imports from `./core` to `./cost` (or `./cost/costHelpers`)
- `core/retryOrchestrator.ts`: import from `../cost` instead of `./costReport` and `../types/costTypes`
- `phases/workflowCompletion.ts`: import from `../cost` instead of `../core`
- `phases/buildPhase.ts`: import `computeDisplayTokens` from `../cost`
- `agents/agentProcessHandler.ts`: import from `../cost` instead of `../core/tokenManager` and `../types/costTypes`
- `agents/jsonlParser.ts`: remove cost/token imports and extraction logic entirely
- `agents/claudeAgent.ts`: remove backward-compatible re-exports of token functions
- `types/agentTypes.ts`: strip `totalCostUsd` and `modelUsage` from `ClaudeCodeResultMessage`

### Phase 3: Integration — Delete old files and clean up
- Delete the five old files
- Remove their re-exports from `core/index.ts` and `types/index.ts`
- Update `README.md` project structure tree (remove deleted files from listing)
- Run full validation suite to confirm zero regressions

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `adws/cost/costHelpers.ts` with migrated utility functions
- Read `adws/core/costReport.ts` and `adws/core/tokenManager.ts` to extract the following functions
- Create `adws/cost/costHelpers.ts` containing:
  - `mergeModelUsageMaps(a, b)` — merges two `ModelUsageMap` values
  - `computeTotalCostUsd(modelUsage)` — sums `costUSD` across all models
  - `buildCostBreakdown(modelUsage, currencies)` — builds `CostBreakdown` object
  - `formatCostBreakdownMarkdown(breakdown)` — formats markdown table
  - `persistTokenCounts(statePath, totalCostUsd, modelUsage)` — writes cost to state file
  - `computeEurRate(currencies)` — computes EUR exchange rate
  - `computeTotalTokens(modelUsage)` — sums all token types
  - `computeDisplayTokens(modelUsage)` — display-only totals (input + output, no cache)
  - `computePrimaryModelTokens(modelUsage, primaryModel)` — tokens for one model
  - `isModelMatch(modelKey, tier)` — checks if model key matches tier
- These functions should import types from `./types` (the new cost types) rather than `../types/costTypes`
- Since `ModelUsageMap` in the new `cost/types.ts` is aliased differently (it uses `LegacyModelUsageMap`), these helpers should use the old `ModelUsage` / `ModelUsageMap` interfaces — bring those type definitions into `adws/cost/types.ts` alongside the new types (as they are still needed by the running system)
- Re-export all new functions from `adws/cost/index.ts`

### Step 2: Update `adws/cost/types.ts` to include legacy types
- Move `ModelUsage`, `ModelUsageMap`, `CurrencyAmount`, `CostBreakdown`, `emptyModelUsage()`, `emptyModelUsageMap()` from `adws/types/costTypes.ts` into `adws/cost/types.ts`
- Keep the existing `LegacyModelUsageMap` alias that already imports from `../types/costTypes` — change it to reference the locally-defined type
- Re-export from `adws/cost/index.ts`

### Step 3: Update `adws/cost/index.ts` barrel to export everything
- Add exports for all newly migrated types and functions from `costHelpers.ts`
- Add exports for `ModelUsage`, `ModelUsageMap`, `CurrencyAmount`, `CostBreakdown`, `emptyModelUsage`, `emptyModelUsageMap` from `types.ts`
- Verify no circular dependencies

### Step 4: Update `adws/core/index.ts` barrel re-exports
- Remove the old cost module re-export sections:
  - `Cost types` section (lines 80-81 re-exporting from `../types/costTypes`)
  - `Cost pricing` section (lines 84-85 re-exporting from `./costPricing`)
  - `Cost report` section (lines 88-97 re-exporting from `./costReport`)
  - `Cost CSV writer` section (lines 100-111 re-exporting from `./costCsvWriter`)
  - `Token Manager` section (lines 132-133 re-exporting from `./tokenManager`)
- Replace them with re-exports from `../cost` so that existing consumers importing from `./core` don't break until they're individually migrated
- Keep `costCommitQueue` exports unchanged

### Step 5: Update `adws/types/index.ts`
- Remove `export * from './costTypes'` (line 4)
- Keep all other exports

### Step 6: Update all 12 orchestrators to import from `./cost`
- For each orchestrator (`adwSdlc.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`, `adwPatch.tsx`, `adwPrReview.tsx`, `adwBuild.tsx`, `adwTest.tsx`, `adwDocument.tsx`, `adwInit.tsx`):
  - Change imports of `mergeModelUsageMaps`, `persistTokenCounts`, `computeDisplayTokens`, `emptyModelUsageMap`, `type ModelUsageMap` from `./core` to `./cost`
  - Keep non-cost imports from `./core` (e.g., `OrchestratorId`, `parseOrchestratorArguments`, `buildRepoIdentifier`, `log`, `RUNNING_TOKENS`, `SHOW_COST_IN_COMMENTS`, etc.)
  - Keep `commitPhasesCostData` import from `./phases/phaseCostCommit` unchanged

### Step 7: Update supporting modules
- `adws/core/retryOrchestrator.ts`: change `mergeModelUsageMaps`, `persistTokenCounts`, `ModelUsageMap`, `emptyModelUsageMap` imports from `./costReport` / `../types/costTypes` to `../cost`
- `adws/phases/workflowCompletion.ts`: change `buildCostBreakdown`, `COST_REPORT_CURRENCIES` imports from `./core` to `../cost` (note: `COST_REPORT_CURRENCIES` comes from `core/config.ts` — keep it from `../core`)
- `adws/phases/buildPhase.ts`: change `computeDisplayTokens` import from `../core` to `../cost`
- `adws/agents/agentProcessHandler.ts`: change `computeTotalTokens` and `ModelUsageMap` imports to `../cost`
- `adws/agents/claudeAgent.ts`: remove backward-compatible re-exports of `computeDisplayTokens`, `computeTotalTokens` from `../core/tokenManager`; update `ModelUsageMap` import to come from `../cost`

### Step 8: Strip cost fields from `ClaudeCodeResultMessage`
- In `adws/types/agentTypes.ts`, remove from `ClaudeCodeResultMessage`:
  - `totalCostUsd: number` field
  - `modelUsage?: Record<string, { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD }>` field
- Keep all other fields: `type`, `subtype`, `isError`, `durationMs`, `durationApiMs`, `numTurns`, `result`, `sessionId`

### Step 9: Strip cost extraction from `jsonlParser.ts`
- In `adws/agents/jsonlParser.ts`:
  - Remove imports of `computeTotalTokens`, `computePrimaryModelTokens` from cost modules
  - Remove imports of `ModelUsageMap` from cost types
  - Remove any logic that extracts `modelUsage`, `totalCostUsd`, or token counts from JSONL messages
  - Keep output parsing: text content, tool calls, progress info extraction

### Step 10: Delete old cost files
- Delete `adws/core/costPricing.ts`
- Delete `adws/core/costReport.ts`
- Delete `adws/core/costCsvWriter.ts`
- Delete `adws/core/tokenManager.ts`
- Delete `adws/types/costTypes.ts`

### Step 11: Final barrel cleanup
- Verify `adws/core/index.ts` no longer references any deleted file
- Verify `adws/types/index.ts` no longer references `costTypes`
- Verify `adws/agents/index.ts` doesn't re-export cost functions from deleted sources
- Verify `adws/index.ts` still compiles (check if `ClaudeCodeResultMessage` export is still needed — it may still be imported for non-cost fields)

### Step 12: Update `README.md` project structure
- Remove from `core/` section: `costCsvWriter.ts`, `costPricing.ts`, `costReport.ts`, `tokenManager.ts`
- Remove from `types/` section: `costTypes.ts`
- Add `costHelpers.ts` to the `cost/` section in the tree
- Update any descriptions in `adws/README.md` that reference deleted files

### Step 13: Run validation commands
- Run all validation commands listed below to confirm zero regressions
- Fix any type errors or test failures

## Testing Strategy
### Unit Tests
Unit tests are disabled per `.adw/project.md` (`## Unit Tests: disabled`).

### Edge Cases
- Orchestrators that don't import any cost functions (e.g., `adwDocument.tsx`) should compile without changes to cost imports
- `core/costCommitQueue.ts` must remain untouched and functional — verify its import/export chain is intact
- `createPhaseCostRecords()` in `adws/cost/types.ts` currently imports `ModelUsageMap as LegacyModelUsageMap` from `../types/costTypes` — this import path must be updated to use the locally-defined `ModelUsageMap` before `types/costTypes.ts` is deleted
- `adws/cost/exchangeRates.ts` is already standalone — no changes needed
- The `toOldModelUsageMap()` function in `agentProcessHandler.ts` converts new snake_case token maps back to old camelCase `ModelUsage` — ensure this function still works after `ModelUsage` moves to `adws/cost/types.ts`
- BDD step definitions in `features/step_definitions/` that import cost types must be checked for broken imports
- Vitest tests in `adws/cost/__tests__/` that import from `../../types/costTypes` must be updated

## Acceptance Criteria
- All orchestrators import cost utilities from `adws/cost/` (not from `core/costReport`, `core/tokenManager`, etc.)
- Old files deleted: `core/costPricing.ts`, `core/costReport.ts`, `core/costCsvWriter.ts`, `core/tokenManager.ts`, `types/costTypes.ts`
- `ClaudeCodeResultMessage` no longer has `totalCostUsd` or `modelUsage` fields
- `jsonlParser.ts` no longer imports or processes token/cost data
- No file in the codebase imports from any deleted module
- `core/costCommitQueue.ts` is unchanged
- `bunx tsc --noEmit` passes (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` passes (adws config)
- `bunx vitest run` passes (Vitest unit tests in `adws/cost/__tests__/`)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js` passes (BDD scenarios)
- `bun run lint` passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Type-check the entire project (root tsconfig)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module specifically
- `bun run lint` — Run linter for code quality
- `bunx vitest run` — Run Vitest unit tests (cost module tests in `adws/cost/__tests__/`)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js` — Run all BDD scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-245"` — Run issue-specific scenarios (if any exist)

## Notes
- **Guidelines**: The `guidelines/coding_guidelines.md` file must be followed — pure functions, immutability, strict TypeScript, no `any` types, files under 300 lines.
- **No behavioral changes**: This migration is purely structural. Cost computation, CSV output format, and comment formatting must remain identical.
- **`COST_REPORT_CURRENCIES`**: This constant lives in `core/config.ts` (not in the old cost files). It should stay there since it's configuration, not cost logic.
- **`RUNNING_TOKENS` and `SHOW_COST_IN_COMMENTS`**: These env var flags also live in `core/config.ts` and stay there.
- **Bridge pattern**: `createPhaseCostRecords()` in `cost/types.ts` currently takes a `LegacyModelUsageMap` parameter — after migration, `ModelUsageMap` lives in `cost/types.ts` directly, so the "Legacy" alias can be simplified.
- **`costCommitQueue.ts`**: Explicitly stays in `core/` per the issue spec. It's queue infrastructure (enqueue/flush), not cost logic.
- **Backward-compatible re-exports in `core/index.ts`**: After Step 4, `core/index.ts` re-exports from `../cost` as a bridge. In Step 10+ when old files are deleted, these re-exports remain valid since they point to the new module.
