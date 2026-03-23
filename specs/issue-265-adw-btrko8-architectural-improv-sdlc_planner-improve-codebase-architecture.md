# Feature: Improve Codebase Architecture

## Metadata
issueNumber: `265`
adwId: `btrko8-architectural-improv`
issueJson: `{"number":265,"title":"architectural improvement opportunities","body":"/improve-codebase-architecture","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-22T19:15:41Z","comments":[],"actionableComment":null}`

## Feature Description
Deep architectural refactoring of the ADW codebase to eliminate pervasive duplication, deepen shallow modules, and establish consistent composition patterns. The codebase has grown organically through 250+ issues and now exhibits significant architectural friction: orchestrators duplicate ~1000 lines of boilerplate, 15+ agent wrappers follow identical patterns without shared abstraction, config.ts is a god module with 7 distinct concerns, and utils.ts is a junk drawer. This refactoring consolidates tightly-coupled modules, introduces a declarative phase composition engine, and splits god modules into focused, single-responsibility files.

## User Story
As a developer maintaining or extending ADW
I want the codebase to have deep modules with small interfaces, consistent composition patterns, and single-responsibility files
So that adding new orchestrators, agents, or phases requires minimal boilerplate and the codebase is easier to navigate and modify

## Problem Statement
The ADW codebase has accumulated significant architectural debt across five areas:

1. **Orchestrator duplication (CRITICAL)**: All composite orchestrators (adwPlanBuild through adwSdlc) repeat the same 9-line cost-tracking boilerplate per phase, totaling 30+ repetitions. `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` are functionally identical files. Adding a new orchestrator requires copy-pasting ~100+ lines.

2. **God module: config.ts (HIGH)**: 364 lines with 7 distinct concerns — environment loading, multi-provider secrets, directory paths, retry constants, token budgeting, comment flags, and model routing maps. Changes to model routing (frequent) require navigating past unrelated Jira/GitLab credentials.

3. **Junk drawer: utils.ts (HIGH)**: 193 lines with 6 distinct concerns — ADW ID generation, logging with emoji prefixes, directory creation (duplicated from agentState.ts), path helpers (also duplicated), argument parsing, and the LogLevel type.

4. **Shallow agent wrappers (MEDIUM)**: 15+ agent files (installAgent, documentAgent, dependencyExtractionAgent, etc.) each implement the same pattern: format args → call `runClaudeAgentWithCommand()` → extract output → return result. No shared abstraction exists; each file is 50-100 lines of boilerplate.

5. **Scattered cross-cutting concerns (MEDIUM)**: Every phase independently handles comment posting, state management, and cost tracking. The agentState/stateHelpers split creates confusion. workflowComments is fragmented across 4 files.

## Solution Statement
Address the friction in three phases:

**Phase 1 — Declarative orchestrator composition**: Introduce a `PhaseRunner` that encapsulates the repeated cost-tracking, token-persistence, and running-token-update loop. Orchestrators become declarative phase lists instead of imperative scripts, cutting ~1000 lines of duplication.

**Phase 2 — Split god modules**: Break `config.ts` into `environment.ts`, `modelRouting.ts`, and a focused `config.ts`. Break `utils.ts` into `adwId.ts` and `logger.ts`, deleting duplicate functions. Move `jsonlParser.ts` from agents/ to core/. Move `costCommitQueue.ts` to cost/. Move routing logic out of `issueTypes.ts`.

**Phase 3 — Deepen agent module**: Extract a shared `runCommandAgent()` helper that handles the common format-args → run-command → extract-output pattern, turning thin wrapper agents into configuration objects rather than separate files.

## Relevant Files
Use these files to implement the feature:

### Orchestrator Composition (Phase 1)
- `adws/adwPlanBuild.tsx` — baseline composite orchestrator showing the repeated cost-tracking pattern
- `adws/adwPlanBuildTest.tsx` — functionally identical to adwPlanBuild, demonstrates duplication
- `adws/adwPlanBuildDocument.tsx` — adds Document phase, otherwise same pattern
- `adws/adwPlanBuildReview.tsx` — adds Scenario/ValPlan/StepDef/Review/AutoMerge phases
- `adws/adwPlanBuildTestReview.tsx` — functionally identical to adwPlanBuildReview
- `adws/adwSdlc.tsx` — full lifecycle, 178 lines of phase composition boilerplate
- `adws/adwPlan.tsx` — simple orchestrator, shows minimal composition
- `adws/adwBuild.tsx` — divergent orchestrator with recovery logic and custom init
- `adws/adwTest.tsx` — standalone test orchestrator
- `adws/adwDocument.tsx` — standalone document orchestrator
- `adws/adwPatch.tsx` — standalone patch orchestrator
- `adws/adwPrReview.tsx` — standalone PR review orchestrator
- `adws/adwInit.tsx` — init orchestrator
- `adws/adwClearComments.tsx` — utility orchestrator
- `adws/workflowPhases.ts` — re-export barrel for phases
- `adws/index.ts` — main barrel export
- `adws/phases/index.ts` — phase barrel export
- `adws/phases/workflowInit.ts` — workflow initialization
- `adws/phases/workflowCompletion.ts` — workflow completion
- `adws/phases/workflowLifecycle.ts` — re-export barrel
- `adws/phases/phaseCommentHelpers.ts` — comment posting helpers
- `adws/phases/phaseCostCommit.ts` — cost commit helpers
- `adws/core/orchestratorLib.ts` — stage execution utilities
- `adws/core/orchestratorCli.ts` — CLI argument parsing
- `adws/core/constants.ts` — orchestrator ID constants
- `adws/cost/computation.ts` — cost computation
- `adws/cost/types.ts` — cost types (ModelUsageMap, PhaseCostRecord)
- `adws/cost/reporting/csvWriter.ts` — CSV writing

### God Module Split (Phase 2)
- `adws/core/config.ts` — 364-line god module to split
- `adws/core/utils.ts` — 193-line junk drawer to split
- `adws/core/agentState.ts` — class wrapper (has duplicates from utils.ts)
- `adws/core/stateHelpers.ts` — functional state helpers
- `adws/core/costCommitQueue.ts` — should move to cost/
- `adws/core/workflowCommentParsing.ts` — stage definitions and recovery detection
- `adws/core/workflowMapping.ts` — issue type to workflow routing
- `adws/core/index.ts` — core barrel export
- `adws/agents/jsonlParser.ts` — utility misplaced in agents/, should be in core/
- `adws/types/issueTypes.ts` — mixes types with routing logic (291 lines)
- `adws/types/dataTypes.ts` — redundant re-export aggregator
- `adws/types/index.ts` — type barrel export

### Agent Module Deepening (Phase 3)
- `adws/agents/claudeAgent.ts` — core runner, exports runClaudeAgentWithCommand
- `adws/agents/agentProcessHandler.ts` — process I/O handler (bidirectional coupling with claudeAgent)
- `adws/agents/installAgent.ts` — thin wrapper (51 lines)
- `adws/agents/documentAgent.ts` — thin wrapper (75 lines)
- `adws/agents/dependencyExtractionAgent.ts` — thin wrapper (66 lines)
- `adws/agents/kpiAgent.ts` — thin wrapper (79 lines)
- `adws/agents/scenarioAgent.ts` — thin wrapper (87 lines)
- `adws/agents/stepDefAgent.ts` — thin wrapper (80 lines)
- `adws/agents/buildAgent.ts` — thin wrapper (104 lines)
- `adws/agents/patchAgent.ts` — thin wrapper (68 lines)
- `adws/agents/prAgent.ts` — thin wrapper (95 lines)
- `adws/agents/planAgent.ts` — heavier agent with file ops (274 lines)
- `adws/agents/gitAgent.ts` — heavier agent with validation (212 lines)
- `adws/agents/reviewAgent.ts` — thin wrapper used by reviewRetry (120 lines)
- `adws/agents/validationAgent.ts` — agent with file scanning (130 lines)
- `adws/agents/resolutionAgent.ts` — agent (84 lines)
- `adws/agents/testAgent.ts` — agent (168 lines)
- `adws/agents/testRetry.ts` — retry orchestrator (275 lines)
- `adws/agents/reviewRetry.ts` — retry orchestrator (261 lines)
- `adws/agents/index.ts` — agent barrel export

### Guidelines
- `guidelines/coding_guidelines.md` — coding guidelines to follow strictly

### New Files
- `adws/core/phaseRunner.ts` — declarative phase composition engine (Phase 1)
- `adws/core/environment.ts` — environment loading, path resolution (Phase 2)
- `adws/core/modelRouting.ts` — slash command model/effort maps (Phase 2)
- `adws/core/adwId.ts` — ADW ID generation and slugify (Phase 2)
- `adws/core/logger.ts` — logging utilities with emoji prefixes (Phase 2)
- `adws/core/claudeStreamParser.ts` — moved from agents/jsonlParser.ts (Phase 2)
- `adws/types/issueRouting.ts` — routing maps extracted from issueTypes.ts (Phase 2)
- `adws/agents/commandAgent.ts` — shared command agent runner (Phase 3)

## Implementation Plan
### Phase 1: Foundation — Declarative Orchestrator Composition
Introduce a `PhaseRunner` utility that encapsulates the repeated per-phase boilerplate (cost accumulation, model usage merging, token persistence, running token updates, and phase cost commits). This transforms orchestrators from imperative scripts with 30+ duplicated blocks into declarative phase lists. The runner supports both sequential and parallel phase execution, preserving existing behavior exactly.

### Phase 2: Core Module Restructuring
Split the `config.ts` god module into focused files: `environment.ts` (dotenv, path resolution), `modelRouting.ts` (slash command model/effort maps), and a trimmed `config.ts` (retry constants, token budgets, directories). Split `utils.ts` into `adwId.ts` and `logger.ts`, deleting duplicated functions. Move `jsonlParser.ts` to `core/claudeStreamParser.ts`. Move `costCommitQueue.ts` to `cost/`. Extract routing maps from `issueTypes.ts` to `issueRouting.ts`. Remove redundant `dataTypes.ts` re-export barrel.

### Phase 3: Integration — Agent Module Deepening
Create a shared `commandAgent.ts` that provides `runCommandAgent<T>()` — a generic function that handles the common pattern: format args → run `runClaudeAgentWithCommand()` → extract structured output → return typed result. Convert thin wrapper agents (installAgent, documentAgent, kpiAgent, etc.) to use this shared function, reducing each from 50-100 lines to 10-20 lines of configuration. Leave heavier agents (planAgent, gitAgent, testRetry, reviewRetry) as-is since they have substantial unique logic.

## Step by Step Tasks

### Step 1: Create PhaseRunner utility
- Read all composite orchestrators (adwPlanBuild through adwSdlc) to identify the exact repeated pattern
- Create `adws/core/phaseRunner.ts` with:
  - `PhaseResult` interface matching existing phase return types: `{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }`
  - `PhaseFn` type: `(config: WorkflowConfig) => Promise<PhaseResult>`
  - `runPhase(phase: PhaseFn, config: WorkflowConfig, tracker: CostTracker): Promise<PhaseResult>` — executes one phase and accumulates costs
  - `runPhasesSequential(phases: PhaseFn[], config: WorkflowConfig, tracker: CostTracker): Promise<void>` — runs phases in order
  - `runPhasesParallel(phases: PhaseFn[], config: WorkflowConfig, tracker: CostTracker): Promise<void>` — runs phases concurrently (like plan + scenario)
  - `CostTracker` class that encapsulates `totalCostUsd`, `totalModelUsage`, `persistTokenCounts()`, running token updates, and `commitPhasesCostData()`
- Export from `adws/core/index.ts`

### Step 2: Migrate composite orchestrators to PhaseRunner
- Rewrite `adwSdlc.tsx` to use PhaseRunner — this is the most complex orchestrator and validates the design handles all cases (sequential phases, parallel phases, non-fatal phases, phases with extra return data like reviewResult.totalRetries)
- Rewrite `adwPlanBuild.tsx` and delete `adwPlanBuildTest.tsx` — they are functionally identical; make adwPlanBuildTest re-export from adwPlanBuild with a different OrchestratorId
- Rewrite `adwPlanBuildReview.tsx` and delete `adwPlanBuildTestReview.tsx` — same approach
- Rewrite `adwPlanBuildDocument.tsx`
- Verify `adwPlan.tsx` and standalone orchestrators work with PhaseRunner (or leave them if they have unique init patterns)
- Update `adws/core/constants.ts` if OrchestratorId values need adjustment
- Update barrel exports in `adws/workflowPhases.ts` and `adws/index.ts`

### Step 3: Split config.ts god module
- Create `adws/core/environment.ts` — move dotenv loading, `CLAUDE_CODE_PATH` resolution with caching, and all path/directory constants
- Create `adws/core/modelRouting.ts` — move `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`, `isFastMode()`, `getModelForCommand()`, `getEffortForCommand()`
- Trim `adws/core/config.ts` to only: retry constants (`MAX_*_RETRY_ATTEMPTS`), token budget constants (`MAX_THINKING_TOKENS`, `TOKEN_LIMIT_THRESHOLD`), comment flags (`RUNNING_TOKENS`, `SHOW_COST_IN_COMMENTS`), and provider secret accessors
- Update all imports across the codebase that reference moved exports
- Verify re-exports from `adws/core/index.ts` are updated

### Step 4: Split utils.ts junk drawer
- Create `adws/core/adwId.ts` — move `generateAdwId()` and `slugify()`
- Create `adws/core/logger.ts` — move `log()`, `setLogAdwId()`, `getLogAdwId()`, `resetLogAdwId()`, `LogLevel` type, and `LOG_PREFIXES`
- Delete `ensureAgentStateDirectory()` and `getAgentStatePath()` from utils.ts — these duplicate `AgentStateManager` methods
- Move `parseTargetRepoArgs()` to `adws/core/targetRepoManager.ts` (logically belongs there)
- Delete `adws/core/utils.ts` once all exports are moved
- Update all imports across the codebase

### Step 5: Relocate misplaced modules
- Move `adws/agents/jsonlParser.ts` → `adws/core/claudeStreamParser.ts` (it's a utility for Claude Code's streaming protocol, not an agent)
- Move `adws/core/costCommitQueue.ts` → `adws/cost/commitQueue.ts` (it's cost-specific serialization)
- Extract routing maps from `adws/types/issueTypes.ts` → `adws/types/issueRouting.ts` (`adwCommandToIssueTypeMap`, `issueTypeToOrchestratorMap`, `adwCommandToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases`)
- Remove `adws/types/dataTypes.ts` redundant aggregator — its re-exports are already in `adws/types/index.ts`
- Update all imports across the codebase

### Step 6: Create shared commandAgent helper
- Create `adws/agents/commandAgent.ts` with:
  - `CommandAgentConfig<T>` interface: `{ command: SlashCommand; agentName: string; formatArgs: (...) => string | string[]; extractOutput?: (output: string) => T }`
  - `runCommandAgent<T>(config: CommandAgentConfig<T>, ...): Promise<AgentResult & { parsed?: T }>` — handles the shared pattern of log file setup, `runClaudeAgentWithCommand()` call, and output extraction
- Refactor thin wrapper agents to use `runCommandAgent`:
  - `installAgent.ts` — reduce to config + single export
  - `documentAgent.ts` — reduce to config + single export
  - `dependencyExtractionAgent.ts` — reduce to config + single export
  - `kpiAgent.ts` — reduce to config + single export
  - `scenarioAgent.ts` — reduce to config + single export
  - `stepDefAgent.ts` — reduce to config + single export
  - `buildAgent.ts` — reduce to config + single export
  - `patchAgent.ts` — reduce to config + single export
  - `prAgent.ts` — reduce to config + single export
- Leave heavier agents unchanged: `planAgent.ts`, `gitAgent.ts`, `reviewAgent.ts`, `testAgent.ts`, `testRetry.ts`, `reviewRetry.ts`, `validationAgent.ts`, `resolutionAgent.ts`
- Update barrel exports in `adws/agents/index.ts`

### Step 7: Merge agentProcessHandler into claudeAgent
- Merge `adws/agents/agentProcessHandler.ts` into `adws/agents/claudeAgent.ts` — the two files have bidirectional coupling and form a single logical unit (combined ~447 lines, well under the 300-line guideline since the handler doesn't need its own file)
- Or: if the combined size exceeds guidelines, keep them separate but eliminate the bidirectional dependency by moving `AgentResult` type to a shared types location
- Update all imports

### Step 8: Clean up re-export barrels
- Remove `adws/phases/workflowLifecycle.ts` — it's a backward-compat barrel that re-exports from workflowInit, workflowCompletion, and worktreeSetup. Update any importers to use direct imports
- Simplify `adws/workflowPhases.ts` — ensure it only re-exports what orchestrators actually need
- Verify `adws/index.ts` exports are consistent and minimal
- Verify `adws/core/index.ts` exports reflect new file structure

### Step 9: Run validation commands
- Run all validation commands listed below to verify zero regressions

## Testing Strategy

### Edge Cases
- Orchestrators that have unique initialization patterns (adwBuild with recovery, adwPrReview with separate init) must continue to work after PhaseRunner introduction
- Parallel phase execution (plan + scenario) must preserve Promise.all semantics
- Non-fatal phases (scenario, stepDef, install, KPI) must still swallow errors gracefully
- Fast mode model routing must continue to work after config.ts split
- Import paths must be updated correctly everywhere — no dangling imports
- Re-export barrels must maintain backward compatibility during transition

## Acceptance Criteria
- All composite orchestrators (adwPlanBuild through adwSdlc) use PhaseRunner instead of manual cost-tracking loops
- `adwPlanBuildTest.tsx` is eliminated or reduced to a thin re-export of `adwPlanBuild.tsx` with a different OrchestratorId
- `adwPlanBuildTestReview.tsx` is eliminated or reduced to a thin re-export of `adwPlanBuildReview.tsx` with a different OrchestratorId
- `config.ts` is split into `environment.ts`, `modelRouting.ts`, and a trimmed `config.ts` — no single file exceeds 200 lines
- `utils.ts` is deleted; its exports live in focused files (`adwId.ts`, `logger.ts`)
- `jsonlParser.ts` is moved from agents/ to core/claudeStreamParser.ts
- `costCommitQueue.ts` is moved from core/ to cost/commitQueue.ts
- Routing maps are extracted from `issueTypes.ts` to `issueRouting.ts`
- Thin agent wrappers use shared `runCommandAgent()` helper
- `agentProcessHandler.ts` is merged into `claudeAgent.ts` (or bidirectional coupling is eliminated)
- `workflowLifecycle.ts` re-export barrel is removed
- `bun run lint` passes with zero errors
- `bun run build` succeeds with zero errors
- `bunx tsc --noEmit` passes with zero type errors
- `bunx tsc --noEmit -p adws/tsconfig.json` passes with zero type errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project
- `NODE_OPTIONS="--import tsx" bunx cucumber-js` — Run BDD scenarios to validate zero regressions

## Notes
- **Coding guidelines**: Strictly follow `guidelines/coding_guidelines.md` — especially the 300-line file limit, single responsibility, and immutability principles.
- **No new libraries needed**: This refactoring uses only existing dependencies.
- **Backward compatibility**: All public API surfaces (orchestrator script names, CLI arguments, phase function signatures) must remain unchanged. Only internal structure changes.
- **Incremental approach**: Each phase can be validated independently. Phase 1 (PhaseRunner) is the highest-impact change. Phase 2 (splits) is straightforward but touches many files. Phase 3 (agent deepening) is lower risk since each agent can be migrated individually.
- **adwBuild.tsx special case**: This orchestrator has unique recovery/continuation logic and custom initialization. It may not fit the PhaseRunner pattern cleanly — preserve its imperative structure if needed, or extend PhaseRunner to support recovery mode.
- **adwPatch.tsx special case**: Uses hybrid state management. May need to stay imperative.
- **Import update strategy**: After each module split/move, use search-and-replace across the codebase to update all import paths. Verify with `bunx tsc --noEmit` after each step.
