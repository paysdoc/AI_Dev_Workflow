# Feature: Top-Level Workflow State File

## Metadata
issueNumber: `378`
adwId: `z16ycm-add-top-level-workfl`
issueJson: `{"number":378,"title":"Add top-level workflow state file with workflowStage and phases map","body":"...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T09:25:39Z","comments":[],"actionableComment":null}`

## Feature Description
Introduce a top-level workflow state file at `agents/<adwId>/state.json` that serves as the canonical workflow state, distinct from per-orchestrator state files at `agents/<adwId>/<orchestratorId>/state.json`. This file tracks the overall `workflowStage` (granular lifecycle stage) and a `phases` map containing per-phase execution state (status, timestamps, optional output). The `runPhase()` function writes phase status transitions to this top-level file, and phase skip-on-resume checks the `phases` map instead of the `completedPhases` string array, with backward compatibility fallback for in-flight workflows.

## User Story
As a workflow operator
I want a canonical top-level state file that tracks workflow stage and per-phase execution state
So that I can query any workflow's current status, completed phases, and timing from a single file without scanning orchestrator subdirectories.

## Problem Statement
Currently, workflow state (completed phases, stage) is scattered across orchestrator-level `state.json` files under `agents/<adwId>/<orchestratorId>/state.json`. The `completedPhases` list is stored as a flat string array inside `metadata`, providing no timing, status granularity, or output capture. There is no single canonical file representing the workflow's overall state, making it hard to query, monitor, or build dashboards over workflows.

## Solution Statement
Add a top-level state file at `agents/<adwId>/state.json` with fields: `adwId`, `issueNumber`, `workflowStage`, `orchestratorScript`, and `phases` (a `Record<string, PhaseExecutionState>`). Extend `AgentState` with optional `workflowStage` and `phases` fields. Modify `runPhase()` to write phase status (`running`/`completed`/`failed`) to the top-level state file. Modify skip-on-resume logic to check `phases.<name>.status === 'completed'` with fallback to `completedPhases.includes(name)` for backward compatibility.

## Relevant Files
Use these files to implement the feature:

- `adws/types/agentTypes.ts` — `AgentState` interface to extend with `workflowStage` and `phases`; `PhaseExecutionState` type to define here
- `adws/core/agentState.ts` — `AgentStateManager` class; add methods for top-level state read/write
- `adws/core/phaseRunner.ts` — `runPhase()` function to update phase status in top-level state; `recordCompletedPhase()` to update; skip-on-resume logic to change
- `adws/core/stateHelpers.ts` — Helper functions for state operations; may need top-level state path helper
- `adws/core/config.ts` — Re-exports `AGENTS_STATE_DIR`
- `adws/core/environment.ts` — Defines `AGENTS_STATE_DIR = path.join(process.cwd(), 'agents')`
- `adws/phases/workflowInit.ts` — `initializeWorkflow()` to create top-level state file at workflow start; `WorkflowConfig` to carry `topLevelStatePath`; `completedPhases` recovery to read from top-level `phases` map
- `adws/phases/workflowCompletion.ts` — `handleRateLimitPause()` and `completeWorkflow()` to update top-level `workflowStage`
- `adws/types/workflowTypes.ts` — `WorkflowStage` type used for `workflowStage` field
- `adws/core/constants.ts` — `OrchestratorId` constants
- `adws/core/__tests__/phaseRunner.test.ts` — Existing tests to extend with phase map tracking
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `app_docs/feature-2sqt1r-fix-rate-limit-plan-phase.md` — Conditional doc: relevant because we're modifying `runPhase()` and rate-limit pause handling

### New Files
- `adws/core/__tests__/topLevelState.test.ts` — Unit tests for top-level state file operations (read/write, merge semantics, phase tracking)

## Implementation Plan

### Phase 1: Foundation — Types and State Manager
Define the `PhaseExecutionState` type and extend `AgentState` with optional `workflowStage` and `phases` fields. Add top-level state path resolution and read/write methods to `AgentStateManager`.

### Phase 2: Core Implementation — runPhase Integration
Modify `runPhase()` to write phase status transitions (`running` on start, `completed` on success, `failed` on error) to the top-level state file. Update skip-on-resume logic to check `phases.<name>.status === 'completed'` with fallback to `completedPhases.includes(name)`. Update `recordCompletedPhase()` to write to both locations for backward compat.

### Phase 3: Integration — Orchestrator Lifecycle
Update `initializeWorkflow()` to create the top-level state file at workflow start with `adwId`, `issueNumber`, `workflowStage: 'starting'`, and `orchestratorScript`. Add `topLevelStatePath` to `WorkflowConfig`. Update `completeWorkflow()` and `handleRateLimitPause()` to write `workflowStage` transitions. Update `completedPhases` recovery to read from the top-level `phases` map with string-array fallback.

## Step by Step Tasks

### Step 1: Define `PhaseExecutionState` type and extend `AgentState`

- In `adws/types/agentTypes.ts`:
  - Add a `PhaseExecutionState` interface with: `status: 'pending' | 'running' | 'completed' | 'failed'`, `startedAt: string` (ISO 8601), optional `completedAt: string`, optional `output: string`
  - Add optional `workflowStage?: string` to `AgentState`
  - Add optional `phases?: Record<string, PhaseExecutionState>` to `AgentState`
  - Export `PhaseExecutionState`

### Step 2: Add top-level state methods to `AgentStateManager`

- In `adws/core/agentState.ts`:
  - Add `static getTopLevelStatePath(adwId: string): string` — returns `path.join(AGENTS_STATE_DIR, adwId, 'state.json')` (the file path directly, not a directory)
  - Add `static writeTopLevelState(adwId: string, state: Partial<AgentState>): void` — reads existing top-level state, merges (with deep merge for `phases`), writes back. The `phases` field must be deep-merged (existing phases preserved, individual phase entries updated) rather than shallow-replaced.
  - Add `static readTopLevelState(adwId: string): AgentState | null` — reads top-level state.json
  - Ensure `initializeState()` still creates `agents/<adwId>/<agentIdentifier>/` directories without conflicting with the top-level `state.json` in `agents/<adwId>/`

### Step 3: Add `topLevelStatePath` to `WorkflowConfig` and initialize top-level state

- In `adws/phases/workflowInit.ts`:
  - Add `topLevelStatePath: string` to the `WorkflowConfig` interface
  - In `initializeWorkflow()`, after resolving `resolvedAdwId`, compute `topLevelStatePath` via `AgentStateManager.getTopLevelStatePath(resolvedAdwId)`
  - Write the initial top-level state using `AgentStateManager.writeTopLevelState(resolvedAdwId, { adwId, issueNumber, workflowStage: 'starting', orchestratorScript: deriveOrchestratorScript(orchestratorName) })`
    - Note: `deriveOrchestratorScript` currently lives in `workflowCompletion.ts`; extract it to a shared location (e.g. `adws/core/orchestratorLib.ts` or keep importing from `workflowCompletion.ts`) so `workflowInit.ts` can use it
  - Update `completedPhases` recovery: after reading from orchestrator state metadata, also try reading from top-level state's `phases` map — if `phases` exists with entries whose `status === 'completed'`, derive `completedPhases` from those. Prefer top-level `phases` over metadata string array.
  - Include `topLevelStatePath` in the returned `WorkflowConfig`

### Step 4: Update `runPhase()` to write phase status to top-level state

- In `adws/core/phaseRunner.ts`:
  - Import `AgentStateManager` (already imported) and `PhaseExecutionState` from types
  - Before calling `fn(config)`, if `phaseName` is provided, write `phases.<phaseName>: { status: 'running', startedAt: new Date().toISOString() }` to top-level state via `AgentStateManager.writeTopLevelState(config.adwId, { phases: { [phaseName]: { status: 'running', startedAt: ... } } })`
  - On success (after `fn(config)` returns), write `phases.<phaseName>: { status: 'completed', startedAt: <keep existing>, completedAt: new Date().toISOString() }` to top-level state
  - On error (in catch block), write `phases.<phaseName>: { status: 'failed', startedAt: <keep existing>, completedAt: new Date().toISOString() }` to top-level state
  - Update skip-on-resume check: read `phases` from top-level state if `phaseName` is provided — if `phases.<phaseName>.status === 'completed'`, skip. Fallback to `config.completedPhases?.includes(phaseName)` for backward compat with in-flight workflows.
  - Keep `recordCompletedPhase()` writing to orchestrator metadata for backward compat during transition

### Step 5: Update `workflowStage` transitions in completion/pause handlers

- In `adws/phases/workflowCompletion.ts`:
  - In `completeWorkflow()`, write `workflowStage: 'completed'` to top-level state via `AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'completed' })`
  - In `handleRateLimitPause()`, write `workflowStage: 'paused'` to top-level state
  - In `handleWorkflowError()`, write `workflowStage: 'error'` to top-level state
  - In `executeReviewPhase()`, no changes needed — `runPhase()` handles phase tracking

### Step 6: Update `workflowStage` at phase transitions (comment posts)

- In `adws/core/phaseRunner.ts`:
  - After writing phase `running` status, also write `workflowStage` to top-level state using the `phaseName` (e.g. `workflowStage: '<phaseName>_running'` or keep it simple: use the phaseName directly as a stage marker)
  - Decision: use the existing `WorkflowStage` type values where they map naturally (e.g. `build_running`, `review_running`). For phases without a matching `WorkflowStage`, use `<phaseName>_running` / `<phaseName>_completed` patterns. Since `workflowStage` is typed as `string` in the top-level state (not the strict union), this is flexible.

### Step 7: Write unit tests for top-level state operations

- Create `adws/core/__tests__/topLevelState.test.ts`:
  - Test `AgentStateManager.getTopLevelStatePath()` returns correct path
  - Test `AgentStateManager.writeTopLevelState()` creates file with correct content
  - Test `writeTopLevelState()` merges with existing state (shallow fields overwrite, `phases` deep-merges)
  - Test `readTopLevelState()` returns null for non-existent file
  - Test `readTopLevelState()` returns parsed state for existing file
  - Test phase status tracking: write `running` then `completed`, verify both entries exist and timestamps correct
  - Test merge semantics: writing phase B doesn't clobber phase A

### Step 8: Extend existing `phaseRunner.test.ts` tests

- In `adws/core/__tests__/phaseRunner.test.ts`:
  - Update mock for `AgentStateManager` to include `writeTopLevelState`, `readTopLevelState`, `getTopLevelStatePath`
  - Add test: `runPhase` writes `running` status to top-level state before executing phase
  - Add test: `runPhase` writes `completed` status to top-level state after successful phase
  - Add test: `runPhase` writes `failed` status to top-level state when phase throws
  - Add test: `runPhase` skips phase when top-level `phases.<name>.status === 'completed'`
  - Add test: `runPhase` falls back to `config.completedPhases` when top-level state has no phases map (backward compat)

### Step 9: Validate

- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to type-check the main project
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to type-check the adws subproject
- Run `bun run test` to run all unit tests and validate zero regressions

## Testing Strategy

### Unit Tests
- **Top-level state read/write**: verify `writeTopLevelState` creates and merges state correctly
- **Deep merge for phases**: verify writing a new phase entry preserves existing phases
- **Phase status tracking in runPhase**: verify `running`/`completed`/`failed` transitions write to top-level state
- **Skip-on-resume via phases map**: verify `runPhase` skips when `phases.<name>.status === 'completed'`
- **Backward compat fallback**: verify `runPhase` still skips via `config.completedPhases` when no top-level phases map exists
- **Workflow stage transitions**: verify `completeWorkflow`, `handleRateLimitPause`, and `handleWorkflowError` write correct `workflowStage`

### Edge Cases
- Top-level `state.json` does not exist yet (first write creates it)
- Top-level `state.json` has corrupted JSON (handle gracefully, start fresh)
- `phases` map has some completed and some failed entries (merge correctly)
- `phaseName` is `undefined` in `runPhase` — no top-level state writes should occur
- In-flight workflow resumes with old-format state (no `phases` map) — fallback to `completedPhases` string array works
- Concurrent phase writes in `runPhasesParallel` — each phase writes its own entry; deep merge prevents clobbering
- `writeTopLevelState` called when `agents/<adwId>/` directory doesn't exist yet (should create directory)

## Acceptance Criteria
- [ ] Top-level state file created at `agents/<adwId>/state.json` by orchestrators at workflow start
- [ ] `workflowStage` written at each phase transition
- [ ] `phases` map updated by `runPhase()` with status, timestamps, and optional output
- [ ] Phase skip-on-resume works using `phases` map
- [ ] `completedPhases` string array still read as fallback (backward compat for in-flight workflows)
- [ ] `AgentState` interface extended with optional `workflowStage` and `phases` fields
- [ ] Tests: state file read/write, phase tracking, skip-on-resume, merge semantics
- [ ] Existing `phaseRunner.test.ts` tests updated or extended
- [ ] All linting, type-checking, and unit tests pass with zero regressions

## Validation Commands

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws subproject
- `bun run test` — Run all unit tests to validate the feature works with zero regressions

## Notes
- The `workflowStage` field in the top-level state uses `string` type (not the strict `WorkflowStage` union) to allow flexible stage naming without requiring type changes for every new phase.
- `deriveOrchestratorScript()` in `workflowCompletion.ts` is needed by `workflowInit.ts` — import it directly rather than duplicating. If circular dependency is an issue, extract to `orchestratorLib.ts`.
- `runPhasesParallel` does not call `runPhase` per-phase — it runs functions directly. Consider whether parallel phases should also write to the top-level state. Since parallel phases are uncommon and the deep-merge approach handles concurrent writes to different phase keys, this should work, but add the phase tracking to the parallel path as well.
- `recordCompletedPhase()` continues writing to orchestrator metadata for backward compatibility during the transition period. This can be removed in a future cleanup once all in-flight workflows have completed.
- Follow coding guidelines: strict TypeScript, pure functions where possible, immutable data patterns, meaningful names.
