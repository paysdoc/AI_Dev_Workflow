# Codebase Architecture Improvements

**ADW ID:** btrko8-architectural-improv
**Date:** 2026-03-22
**Specification:** specs/issue-265-adw-btrko8-architectural-improv-sdlc_planner-improve-codebase-architecture.md

## Overview

Deep architectural refactoring of the ADW codebase to eliminate pervasive duplication and establish consistent composition patterns. The refactoring addresses five friction areas: orchestrator boilerplate duplication (~1000 lines across 6 orchestrators), god modules (`config.ts`, `utils.ts`), misplaced utilities, and shallow agent wrappers. All changes preserve existing public API surfaces — only internal structure changed.

## What Was Built

- **`PhaseRunner` utility** (`adws/core/phaseRunner.ts`) — declarative phase composition engine with `CostTracker` class, eliminating repeated cost-tracking boilerplate across composite orchestrators
- **`environment.ts`** — extracted from `config.ts`: dotenv loading, `CLAUDE_CODE_PATH` resolution, path/directory constants
- **`modelRouting.ts`** — extracted from `config.ts`: `SLASH_COMMAND_MODEL_MAP`, effort maps, `isFastMode()`, `getModelForCommand()`, `getEffortForCommand()`
- **`adwId.ts`** — extracted from `utils.ts`: `generateAdwId()`, `slugify()`
- **`logger.ts`** — extracted from `utils.ts`: `log()`, `LogLevel`, `LOG_PREFIXES`, log state helpers
- **`claudeStreamParser.ts`** — moved from `agents/jsonlParser.ts` to `core/` (correct location for a core streaming utility)
- **`issueRouting.ts`** — routing maps extracted from `issueTypes.ts`: `adwCommandToIssueTypeMap`, `issueTypeToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`, etc.
- **`commandAgent.ts`** — shared `runCommandAgent<T>()` helper; thin wrapper agents now use configuration objects rather than 50-100 lines of boilerplate each
- **`cost/commitQueue.ts`** — moved from `core/costCommitQueue.ts` to its correct domain module
- **`cost/reporting/commentFormatter.ts`** — cost GitHub comment section formatter (co-landed with architecture work)
- Composite orchestrators (`adwSdlc`, `adwPlanBuild`, `adwPlanBuildReview`, `adwPlanBuildDocument`, `adwPlanBuildTest`, `adwPlanBuildTestReview`) refactored to use `PhaseRunner`

## Technical Implementation

### Files Modified

- `adws/core/config.ts`: Trimmed to retry constants, token budgets, comment flags, provider secrets only
- `adws/core/utils.ts`: Emptied — all exports moved to focused files; file deleted
- `adws/core/index.ts`: Updated barrel to re-export from all new focused modules
- `adws/agents/jsonlParser.ts`: Reduced to thin re-export pointing at `core/claudeStreamParser.ts`
- `adws/types/issueTypes.ts`: Routing maps extracted; file now contains only type definitions
- `adws/agents/claudeAgent.ts`: `agentProcessHandler.ts` logic merged in; bidirectional coupling eliminated
- `adws/agents/index.ts`: Updated barrel with `commandAgent` export
- `adws/phases/workflowLifecycle.ts`: Removed redundant re-export barrel
- `adws/phases/prReviewCompletion.ts`: Updated cost imports to new module locations
- `adws/phases/autoMergePhase.ts`: Added new auto-merge phase (co-landed)
- `adws/adwSdlc.tsx`: Reduced from 178 lines of imperative boilerplate to declarative phase list
- `adws/adwPlanBuild.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildDocument.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`: All refactored to `PhaseRunner`
- `adws/triggers/autoMergeHandler.ts`: Updated imports after module relocations
- `adws/cost/types.ts`, `adws/cost/index.ts`: Updated with new cost types

### Key Changes

- **PhaseRunner + CostTracker**: Orchestrators now pass a phase function list to `runPhasesSequential()` or `runPhasesParallel()` instead of repeating 9-line cost-accumulation blocks per phase. The `CostTracker` class owns `totalCostUsd`, `totalModelUsage`, `persistTokenCounts()`, and `commitPhasesCostData()`.
- **`config.ts` split**: The 364-line god module is now three files each under 200 lines. Callers importing model routing or environment settings no longer load unrelated provider secrets.
- **`utils.ts` eliminated**: `adwId.ts` and `logger.ts` are purpose-named; all duplicate functions (those already on `AgentStateManager`) were deleted rather than moved.
- **`commandAgent.ts`**: Thin agent wrappers (`installAgent`, `documentAgent`, `kpiAgent`, `scenarioAgent`, `stepDefAgent`, `buildAgent`, `patchAgent`, `prAgent`, `dependencyExtractionAgent`) reduced from 50-100 lines to 10-20 lines each using `runCommandAgent<T>()`.
- **Module relocations**: `jsonlParser.ts` → `core/claudeStreamParser.ts`; `costCommitQueue.ts` → `cost/commitQueue.ts`; routing maps → `types/issueRouting.ts` — each module now lives in the domain it belongs to.

## How to Use

This is a pure internal refactoring — no public API changes.

1. **Orchestrator authors**: Use `PhaseRunner` and `CostTracker` from `adws/core` instead of manual cost loops. Call `runPhasesSequential(phases, config, tracker)` or `runPhasesParallel(phases, config, tracker)`.
2. **Agent authors**: Use `runCommandAgent<T>(config, options)` from `adws/agents/commandAgent.ts` for new thin-wrapper agents instead of calling `runClaudeAgentWithCommand()` directly.
3. **Import paths**: Model routing utilities (`getModelForCommand`, `isFastMode`) are now in `adws/core/modelRouting`. Environment constants are in `adws/core/environment`. Logging is in `adws/core/logger`. ADW ID utilities are in `adws/core/adwId`. All are re-exported from `adws/core/index.ts`.
4. **Cost module**: Cost commit queue is at `adws/cost/commitQueue.ts`. Issue routing maps are at `adws/types/issueRouting.ts`.

## Configuration

No new configuration. Existing environment variables and `.adw/` project config are unchanged.

## Testing

Run the full validation suite:

```bash
bun run lint
bun run build
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
NODE_OPTIONS="--import tsx" bunx cucumber-js
```

BDD scenarios for this feature are in `features/codebase_architecture_improvements.feature` with step definitions in `features/step_definitions/codembaseArchitectureImprovementsSteps.ts`.

## Notes

- `adwBuild.tsx` and `adwPatch.tsx` were left imperative — they have unique recovery/continuation logic that does not fit the PhaseRunner pattern cleanly.
- Heavier agents (`planAgent`, `gitAgent`, `testRetry`, `reviewRetry`, `validationAgent`, `resolutionAgent`) were left unchanged; only thin wrappers were migrated to `commandAgent`.
- The `agentProcessHandler.ts` file now re-exports from `claudeAgent.ts` to maintain backward compatibility for any direct importers.
