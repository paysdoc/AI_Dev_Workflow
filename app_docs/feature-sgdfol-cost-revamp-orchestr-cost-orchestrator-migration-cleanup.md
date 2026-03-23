# Cost Orchestrator Migration Cleanup

**ADW ID:** sgdfol-cost-revamp-orchestr
**Date:** 2026-03-22
**Specification:** specs/issue-245-adw-sgdfol-cost-revamp-orchestr-sdlc_planner-cost-orchestrator-migration-cleanup.md

## Overview

This is the final migration slice of the cost module revamp (issues #241–#245). All orchestrators and supporting modules were updated to import cost utilities from the new `adws/cost/` module, the five legacy cost files were deleted, and backward-compatible re-exports were added to `core/index.ts` to avoid breaking existing consumers. The migration is purely structural — cost computation, CSV output, and comment formatting behaviour is unchanged.

## What Was Built

- New `adws/cost/costHelpers.ts` — consolidated utility functions migrated from the deleted core files
- Updated `adws/cost/types.ts` — legacy types (`ModelUsage`, `ModelUsageMap`, `CurrencyAmount`, `CostBreakdown`) moved here from `types/costTypes.ts`
- Updated `adws/cost/index.ts` barrel — exports all new types and helpers
- All 12 orchestrators migrated to import from `./cost` instead of `./core`
- Supporting modules (`retryOrchestrator`, `workflowCompletion`, `buildPhase`, `agentProcessHandler`, `claudeAgent`, `jsonlParser`) updated
- `ClaudeCodeResultMessage` stripped of `totalCostUsd` and `modelUsage` cost fields
- `jsonlParser.ts` stripped of token/cost extraction logic
- `core/index.ts` updated with backward-compatible re-exports pointing to `../cost`
- Five legacy files deleted: `core/costPricing.ts`, `core/costReport.ts`, `core/costCsvWriter.ts`, `core/tokenManager.ts`, `types/costTypes.ts`
- `README.md` and `adws/README.md` updated to reflect new structure

## Technical Implementation

### Files Modified

- `adws/cost/costHelpers.ts` *(new)* — `mergeModelUsageMaps`, `computeTotalCostUsd`, `buildCostBreakdown`, `formatCostBreakdownMarkdown`, `persistTokenCounts`, `computeEurRate`, `computeTotalTokens`, `computeDisplayTokens`, `computePrimaryModelTokens`, `isModelMatch`
- `adws/cost/types.ts` — added `ModelUsage`, `ModelUsageMap`, `CurrencyAmount`, `CostBreakdown`, `emptyModelUsage`, `emptyModelUsageMap`; simplified `LegacyModelUsageMap` alias to reference locally-defined type
- `adws/cost/index.ts` — re-exports all new types and helpers
- `adws/core/index.ts` — removed old cost module re-export sections; replaced with backward-compatible re-exports from `../cost`; added `SHOW_COST_IN_COMMENTS` export
- `adws/types/agentTypes.ts` — removed `totalCostUsd` and `modelUsage` from `ClaudeCodeResultMessage`
- `adws/agents/jsonlParser.ts` — removed cost/token extraction imports and logic
- `adws/agents/claudeAgent.ts` — removed backward-compatible re-exports of token functions from `tokenManager`
- `adws/agents/agentProcessHandler.ts` — updated `computeTotalTokens`, `ModelUsageMap` imports to `../cost`
- `adws/core/retryOrchestrator.ts` — updated `mergeModelUsageMaps`, `persistTokenCounts`, `ModelUsageMap`, `emptyModelUsageMap` imports to `../cost`
- `adws/phases/workflowCompletion.ts` — updated `buildCostBreakdown` import to `../cost`
- `adws/phases/buildPhase.ts` — updated `computeDisplayTokens` import to `../cost`
- `adws/adwSdlc.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`, `adwPatch.tsx`, `adwPrReview.tsx`, `adwBuild.tsx`, `adwTest.tsx`, `adwInit.tsx` — changed cost imports from `./core` to `./cost`

### Key Changes

- **`costHelpers.ts` is the new home** for all cost utility functions previously spread across `core/costReport.ts` and `core/tokenManager.ts`
- **`adws/cost/types.ts` is now authoritative** for all cost and token types — `types/costTypes.ts` is deleted
- **`core/index.ts` bridges old consumers** by re-exporting from `../cost` — any file still importing cost symbols from `./core` continues to work
- **`ClaudeCodeResultMessage` is slimmed down** — cost fields were extracted at the `AnthropicTokenUsageExtractor` level and no longer need to propagate through the result message type
- **`jsonlParser.ts` is now cost-agnostic** — it only parses text content, tool calls, and progress information

## How to Use

The `adws/cost/` module is now the single authoritative source for all cost-related symbols. Import from it directly:

```typescript
import {
  mergeModelUsageMaps,
  computeTotalCostUsd,
  buildCostBreakdown,
  persistTokenCounts,
  computeDisplayTokens,
  type ModelUsageMap,
} from './cost';
```

Non-cost imports (config, orchestrator utilities, queue) continue to come from `./core` as before.

## Configuration

No new configuration required. The existing env vars remain in `core/config.ts`:
- `RUNNING_TOKENS` — enables running token totals display
- `SHOW_COST_IN_COMMENTS` — toggles cost section in GitHub comments
- `COST_REPORT_CURRENCIES` — currencies to include in cost breakdown

## Testing

```bash
# Type-check the entire project
bunx tsc --noEmit

# Type-check adws module specifically
bunx tsc --noEmit -p adws/tsconfig.json

# Run linter
bun run lint

# Run Vitest unit tests
bunx vitest run

# Run all BDD scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js

# Run issue-specific scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-245"
```

## Notes

- `core/costCommitQueue.ts` was intentionally left in `core/` — it is queue infrastructure, not cost logic.
- `COST_REPORT_CURRENCIES` stays in `core/config.ts` — it is configuration, not cost logic.
- The `toOldModelUsageMap()` function in `agentProcessHandler.ts` converts new snake_case token maps back to camelCase `ModelUsage` — it continues to work since `ModelUsage` now lives in `adws/cost/types.ts`.
- Vitest tests in `adws/cost/__tests__/` that previously imported from `../../types/costTypes` were updated to import from `../types` (within the cost module).
- BDD step definitions in `features/step_definitions/costOrchestratorMigrationCleanupSteps.ts` cover the full acceptance criteria for this migration.
