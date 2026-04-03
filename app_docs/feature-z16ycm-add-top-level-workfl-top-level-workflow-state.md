# Top-Level Workflow State File

**ADW ID:** z16ycm-add-top-level-workfl
**Date:** 2026-04-03
**Specification:** specs/issue-378-adw-z16ycm-add-top-level-workfl-sdlc_planner-top-level-workflow-state.md

## Overview

Introduces a canonical top-level state file at `agents/<adwId>/state.json` that tracks the overall workflow lifecycle stage and per-phase execution state (status, timestamps). Previously, phase completion was scattered across per-orchestrator state files as a flat string array with no timing or status granularity. This file now serves as the single source of truth for monitoring any workflow's current status without scanning orchestrator subdirectories.

## What Was Built

- `PhaseExecutionState` interface — typed model for per-phase status (`pending`/`running`/`completed`/`failed`), timestamps, and optional output
- `AgentState` extensions — optional `workflowStage`, `phases`, and `orchestratorScript` fields on the existing state interface
- `AgentStateManager` static methods — `getTopLevelStatePath()`, `readTopLevelState()`, `writeTopLevelState()` with deep-merge semantics for the `phases` map
- `runPhase()` integration — writes `running`/`completed`/`failed` phase status transitions to top-level state; also updates `workflowStage`
- Phase skip-on-resume via phases map — `runPhase()` checks `phases.<name>.status === 'completed'` with fallback to the legacy `completedPhases` string array
- Workflow lifecycle stage writes — `completeWorkflow()` writes `completed`, `handleRateLimitPause()` writes `paused`, `handleWorkflowError()` writes `abandoned`
- `initializeWorkflow()` creates the top-level state file at workflow start with `workflowStage: 'starting'`
- `deriveOrchestratorScript()` extracted from `workflowCompletion.ts` to shared `orchestratorLib.ts`
- `topLevelStatePath` added to `WorkflowConfig` for downstream use
- Resume recovery reads from top-level `phases` map first (preferred), falls back to legacy metadata array
- Unit tests: `adws/core/__tests__/topLevelState.test.ts` (new) and extended `phaseRunner.test.ts`
- BDD feature: `features/top_level_workflow_state_file.feature` with step definitions

## Technical Implementation

### Files Modified

- `adws/types/agentTypes.ts`: Added `PhaseExecutionState` interface and extended `AgentState` with `workflowStage?`, `phases?`, `orchestratorScript?`
- `adws/core/agentState.ts`: Added `getTopLevelStatePath()`, `readTopLevelState()`, `writeTopLevelState()` static methods with deep-merge logic for `phases`
- `adws/core/phaseRunner.ts`: Updated skip-on-resume logic; added phase status writes (`running`/`completed`/`failed`) and `workflowStage` writes around phase execution
- `adws/phases/workflowInit.ts`: Creates top-level state file at workflow start; reads `completedPhases` from phases map on resume (with legacy fallback); added `topLevelStatePath` to `WorkflowConfig`
- `adws/phases/workflowCompletion.ts`: Removed `deriveOrchestratorScript()` (now in `orchestratorLib.ts`); added `workflowStage` writes in `completeWorkflow()`, `handleRateLimitPause()`, `handleWorkflowError()`
- `adws/core/orchestratorLib.ts`: Added `deriveOrchestratorScript()` (extracted from `workflowCompletion.ts`); added `feature-orchestrator` mapping
- `adws/core/__tests__/topLevelState.test.ts`: New unit tests for state read/write, merge semantics, phase tracking
- `adws/core/__tests__/phaseRunner.test.ts`: Extended with top-level state mock and phase tracking assertions

### Key Changes

- **Deep merge for `phases`**: `writeTopLevelState()` shallow-merges top-level fields but deep-merges the `phases` map — writing a new phase entry preserves all existing phase entries, enabling safe concurrent writes from `runPhasesParallel()`
- **Authoritative skip logic**: When a `phases` map entry exists for a phase, it is used exclusively for skip decisions (`completed` skips, `running`/`failed` do not). Only when no entry exists does `runPhase()` fall back to the legacy `completedPhases` string array, ensuring backward compatibility with in-flight workflows
- **`workflowStage` naming**: Uses `<phaseName>_running` / `<phaseName>_completed` patterns (typed as `string` for flexibility) plus fixed values `starting`, `completed`, `paused`, `abandoned`
- **Graceful file errors**: `readTopLevelState()` returns `null` on missing or corrupted JSON; `writeTopLevelState()` starts from empty state on parse failure — no crashes from corrupt files
- **`deriveOrchestratorScript()` moved to `orchestratorLib.ts`**: Both `workflowInit.ts` and `workflowCompletion.ts` now import from the shared location, avoiding circular dependencies

## How to Use

The top-level state file is written and managed automatically by the workflow infrastructure — no manual intervention is required.

1. **Read current workflow state** for a given ADW run:
   ```bash
   cat agents/<adwId>/state.json
   ```
   The file contains `workflowStage`, `phases` (with per-phase status/timestamps), `adwId`, `issueNumber`, and `orchestratorScript`.

2. **Query all completed phases** for a run:
   ```bash
   jq '[.phases | to_entries[] | select(.value.status == "completed") | .key]' agents/<adwId>/state.json
   ```

3. **Check current workflow stage**:
   ```bash
   jq '.workflowStage' agents/<adwId>/state.json
   ```
   Possible values: `starting`, `<phaseName>_running`, `<phaseName>_completed`, `completed`, `paused`, `abandoned`

4. **Monitor phase timing**:
   ```bash
   jq '.phases | to_entries[] | {phase: .key, status: .value.status, started: .value.startedAt, completed: .value.completedAt}' agents/<adwId>/state.json
   ```

## Configuration

No new configuration required. The file location is fixed at `agents/<adwId>/state.json` relative to the project root (`AGENTS_STATE_DIR`).

## Testing

```bash
# Unit tests for state read/write and phase tracking
bun run test adws/core/__tests__/topLevelState.test.ts

# Extended phaseRunner tests
bun run test adws/core/__tests__/phaseRunner.test.ts

# Full suite
bun run test

# BDD scenarios
bunx cucumber-js features/top_level_workflow_state_file.feature
```

## Notes

- `recordCompletedPhase()` continues writing to orchestrator metadata's `completedPhases` string array for backward compatibility. This dual-write can be removed once all in-flight workflows using the old format have completed.
- The `phases` deep-merge strategy makes concurrent writes from `runPhasesParallel()` safe: each phase writes only its own key without clobbering sibling phases.
- `workflowStage` is typed as `string` (not the strict `WorkflowStage` union) to allow flexible naming for phase-level stages without requiring union type changes.
- The top-level `state.json` sits at `agents/<adwId>/state.json` — distinct from per-orchestrator files at `agents/<adwId>/<orchestratorId>/state.json`. The directory structure is shared but the files don't conflict.
