# Feature: Declarative Orchestrator Runner + Structured State + adwPlanBuild Migration

## Metadata
issueNumber: `346`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
This is the tracer-bullet implementation of the declarative orchestration architecture defined in `specs/prd/declarative-orchestration-architecture.md`. It delivers three tightly coupled deliverables:

1. **Structured workflow state types** — Replace the flat `WorkflowContext` (~30 optional fields) with namespaced, typed state sections produced by each phase (`state.install.*`, `state.plan.*`, `state.build.*`, `state.test.*`, `state.pr.*`, etc.). The full state object must be JSON-serializable. Init-time data (issue, adwId, worktreePath, branchName, projectConfig, repoContext) stays on `WorkflowConfig` and is not mixed into phase state.

2. **Declarative orchestrator runner** — A `defineOrchestrator()` / `runOrchestrator()` API. The runner owns: CLI arg parsing, `initializeWorkflow()`, `CostTracker` lifecycle, sequential per-phase execution, try/catch, `completeWorkflow()` / `handleWorkflowError()`. All module interfaces must use explicit TypeScript types — no `any`, no implicit shapes.

3. **Migrate `adwPlanBuild.tsx`** — Replace its ~70 lines of boilerplate with a ~15-line declarative definition. Its five phases (install, plan, build, test, PR) are updated to read/write structured namespaced state.

## User Story
As a developer adding or modifying an ADW orchestrator,
I want to declare a phase list in ~15 lines using `defineOrchestrator()` / `runOrchestrator()` with typed namespaced state,
So that I never duplicate arg-parsing, CostTracker, try/catch, or completion boilerplate.

## Problem Statement
All 14 orchestrator scripts repeat ~40–70 lines of identical setup: arg parsing, `initializeWorkflow()`, `new CostTracker()`, phase loop, try/catch, `completeWorkflow()` / `handleWorkflowError()`. Simultaneously, `WorkflowContext` is a flat bag of ~30 optional fields with no structure indicating which phase produces or consumes which field, making inter-phase dependencies invisible.

## Solution Statement
Introduce `adws/core/orchestratorRunner.ts` with `defineOrchestrator()` and `runOrchestrator()` that own all shared boilerplate. Introduce `adws/types/workflowState.ts` with typed, namespaced phase state replacing the flat `WorkflowContext`. Migrate the five phases used by `adwPlanBuild.tsx` to read/write namespaced state. Replace `adwPlanBuild.tsx` with a declarative ~15-line definition using the new runner.

## Relevant Files

- **`adws/adwPlanBuild.tsx`** — The orchestrator to be migrated; its boilerplate is replaced by `runOrchestrator()`.
- **`adws/workflowPhases.ts`** — Re-exports all phase functions consumed by orchestrators; may need new exports.
- **`adws/types/workflowTypes.ts`** — Existing workflow type definitions; `WorkflowContext` lives in `adws/github/workflowComments.ts` — related type context.
- **`adws/phases/workflowInit.ts`** — Defines `WorkflowConfig` and `initializeWorkflow()`; the runner delegates to this.
- **`adws/phases/workflowCompletion.ts`** — Defines `completeWorkflow()`, `handleWorkflowError()`, `handleRateLimitPause()`; the runner delegates to these.
- **`adws/phases/installPhase.ts`** — Phase to migrate to structured state writes.
- **`adws/phases/planPhase.ts`** — Phase to migrate to structured state reads/writes.
- **`adws/phases/buildPhase.ts`** — Phase to migrate to structured state reads/writes.
- **`adws/phases/testPhase.ts`** — Phase to migrate to structured state reads/writes; returns `unitTestsPassed` / `totalRetries`.
- **`adws/phases/prPhase.ts`** — Phase to migrate to structured state reads/writes.
- **`adws/core/phaseRunner.ts`** — `CostTracker`, `runPhase`, `PhaseFn` types; the runner composes these.
- **`adws/core/orchestratorCli.ts`** — `parseOrchestratorArguments()`, `parseTargetRepoArgs()`, `buildRepoIdentifier()`; the runner calls these.
- **`adws/core/constants.ts`** — `OrchestratorId` constants; used in the declarative definition.
- **`adws/types/index.ts`** — Type barrel; may need to export new state types.

### New Files
- **`adws/core/orchestratorRunner.ts`** — `defineOrchestrator()`, `runOrchestrator()`, `OrchestratorDefinition` type, sequential phase execution. All types explicit, no `any`.
- **`adws/types/workflowState.ts`** — `WorkflowState` type with namespaced interfaces: `InstallState`, `PlanState`, `BuildState`, `TestState`, `PRState`, plus a top-level `WorkflowState` object. JSON-serializable.

## Implementation Plan

### Phase 1: Foundation — Structured State Types
Define `WorkflowState` and its namespaced section interfaces in `adws/types/workflowState.ts`. These are pure TypeScript interfaces — no logic. Ensure the full type is JSON-serializable (no `Date`, no `Map`, no class instances at state boundaries).

### Phase 2: Core Implementation — Declarative Runner
Implement `adws/core/orchestratorRunner.ts` with `OrchestratorDefinition`, `defineOrchestrator()`, and `runOrchestrator()`. The runner calls `parseTargetRepoArgs()`, `parseOrchestratorArguments()`, `buildRepoIdentifier()`, `initializeWorkflow()`, creates a `CostTracker`, iterates phases via `runPhase()`, calls `completeWorkflow()` on success and `handleWorkflowError()` on failure. Sequential execution only for this slice.

### Phase 3: Integration — Phase Migration + adwPlanBuild Declarative Definition
Update install, plan, build, test, and PR phases to accept a `WorkflowState` parameter alongside `WorkflowConfig` and to write their outputs into the appropriate namespaced section. Replace `adwPlanBuild.tsx` boilerplate with a ~15-line declarative `defineOrchestrator()` call and a `runOrchestrator()` invocation.

## Step by Step Tasks

### Step 1: Define structured state types
- Create `adws/types/workflowState.ts` with:
  - `InstallState` interface: `{ installContext?: string }`
  - `PlanState` interface: `{ planPath?: string; branchName?: string; issueType?: string }`
  - `BuildState` interface: `{ output?: string }`
  - `TestState` interface: `{ unitTestsPassed: boolean; totalRetries: number }`
  - `PRState` interface: `{ prUrl?: string }`
  - `WorkflowState` interface: top-level container with each namespace as an optional section (`install?: InstallState`, `plan?: PlanState`, etc.)
  - `createInitialWorkflowState(): WorkflowState` factory that returns an empty initialized state
- Add export for `WorkflowState` and all section interfaces to `adws/types/index.ts`

### Step 2: Define runner types and implement `orchestratorRunner.ts`
- Create `adws/core/orchestratorRunner.ts`:
  - Define `PhaseWithState` type: `(config: WorkflowConfig, state: WorkflowState) => Promise<PhaseResult & { stateUpdate?: Partial<WorkflowState> }>`
  - Define `OrchestratorDefinition` interface with: `id: OrchestratorIdType`, `scriptName: string`, `usagePattern: string`, `phases: ReadonlyArray<PhaseWithState>`
  - Implement `defineOrchestrator(def: OrchestratorDefinition): OrchestratorDefinition` — identity function returning the typed definition (enables type checking at definition site)
  - Implement `runOrchestrator(def: OrchestratorDefinition): Promise<void>`:
    - Parse args via `parseTargetRepoArgs()` and `parseOrchestratorArguments()`
    - Build repo identifier via `buildRepoIdentifier()`
    - Call `initializeWorkflow()` with parsed args
    - Create `new CostTracker()`
    - Create initial `WorkflowState` via `createInitialWorkflowState()`
    - Iterate phases sequentially via `runPhase()`, merging `stateUpdate` into state after each phase
    - On success: call `completeWorkflow()` with test results read from `state.test`
    - On error: call `handleWorkflowError()`
  - No `any` types anywhere; all imports explicitly typed

### Step 3: Update `installPhase.ts` to write structured state
- Read the current `executeInstallPhase(config: WorkflowConfig)` signature and return type
- Update the phase to also accept `state: WorkflowState` (or return a `stateUpdate` field alongside its `PhaseResult`)
  - Determine the cleanest approach: either a new overload that returns `stateUpdate: { install: InstallState }` in the result, or keeping backward compatibility by updating `config.installContext` AND returning state update
- Return `stateUpdate: { install: { installContext } }` in the phase result so the runner can merge it
- Ensure backward compat: continue writing `config.installContext` for phases that still read from `WorkflowConfig` (during migration period)

### Step 4: Update `planPhase.ts` to read/write structured state
- Read current `executePlanPhase(config: WorkflowConfig)` to identify `ctx.planPath`, `ctx.branchName` writes
- Update to return `stateUpdate: { plan: { planPath, branchName, issueType } }` in the phase result
- Maintain backward compat by also writing to `ctx` fields during migration

### Step 5: Update `buildPhase.ts` to read install context from state
- Read current `executeBuildPhase(config: WorkflowConfig)` to identify where `config.installContext` is consumed
- Update to also read from `state.install.installContext` when state is available (prefer state over config for forward-compatibility)
- Return minimal `stateUpdate: { build: {} }` (build phase has limited output in structured form)

### Step 6: Update `testPhase.ts` to write structured state
- Read current `executeTestPhase(config: WorkflowConfig)` return type — it returns `{ unitTestsPassed, totalRetries, ... }`
- Add `stateUpdate: { test: { unitTestsPassed, totalRetries } }` to the return value
- The runner reads `state.test.unitTestsPassed` and `state.test.totalRetries` to pass to `completeWorkflow()`

### Step 7: Update `prPhase.ts` to write structured state
- Read current `executePRPhase(config: WorkflowConfig)` and identify `ctx.prUrl` write
- Add `stateUpdate: { pr: { prUrl } }` to the return value
- Maintain backward compat by also writing to `ctx.prUrl` during migration

### Step 8: Replace `adwPlanBuild.tsx` with declarative definition
- Replace the current ~70-line `main()` body with a `defineOrchestrator()` + `runOrchestrator()` call:
  ```typescript
  import { defineOrchestrator, runOrchestrator } from './core/orchestratorRunner';
  import { OrchestratorId } from './core';
  import { executeInstallPhase, executePlanPhase, executeBuildPhase, executeTestPhase, executePRPhase } from './workflowPhases';

  const definition = defineOrchestrator({
    id: OrchestratorId.PlanBuild,
    scriptName: 'adwPlanBuild.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    phases: [executeInstallPhase, executePlanPhase, executeBuildPhase, executeTestPhase, executePRPhase],
  });

  runOrchestrator(definition);
  ```
- The file should be ~15 lines total (imports + definition + invocation)

### Step 9: Validate the implementation
- Run all validation commands listed below

## Testing Strategy

### Edge Cases
- Phase returns `stateUpdate: undefined` — runner merges nothing, state is unchanged
- Phase throws — runner calls `handleWorkflowError()` without calling subsequent phases
- `state.test` is undefined when `completeWorkflow()` is called — runner uses safe defaults (`unitTestsPassed: false, totalRetries: 0`)
- `WorkflowState` with all namespaces populated serializes to valid JSON without loss
- Runner receives empty phase list — `completeWorkflow()` is called with empty test state

## Acceptance Criteria
- `WorkflowState` type defined with `install`, `plan`, `build`, `test`, `pr` namespaces; each section is a typed interface; full type is JSON-serializable
- `defineOrchestrator()` and `runOrchestrator()` implemented in `adws/core/orchestratorRunner.ts` with sequential phase execution
- Runner handles: arg parsing, `initializeWorkflow()`, `CostTracker` lifecycle, try/catch, `completeWorkflow()` / `handleWorkflowError()`
- `adwPlanBuild.tsx` replaced with declarative definition of ~15 lines
- Install, plan, build, test, and PR phases return `stateUpdate` with their namespaced outputs
- `bunx tsx adws/adwPlanBuild.tsx <issueNumber>` works end-to-end on the new runner
- All module boundary types are explicit (no `any`)
- Existing orchestrators are not broken (backward compatible — phases still write to `ctx` fields during migration)
- TypeScript compilation succeeds with zero errors: `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`

## Validation Commands

```bash
# Type check root and adws TypeScript configs
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# Verify the new orchestrator definition compiles and has no import errors
bunx tsx --check adws/adwPlanBuild.tsx

# Smoke-test: verify the runner module loads without errors (no issue number needed for import check)
node -e "require('./adws/core/orchestratorRunner')" 2>&1 || bunx tsx -e "import './adws/core/orchestratorRunner'; console.log('runner module OK')"

# Verify other orchestrators still import cleanly (backward compat check)
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes
- **No unit tests** — `.adw/project.md` has `## Unit Tests: disabled`. Do not create or run unit tests.
- **Blocked by #344** — The CostTracker migration must land before this issue is implemented. The declarative runner assumes all orchestrators use `CostTracker`/`runPhase`.
- **Backward compat during migration** — Phases should continue to write to `ctx` fields as they do today, in addition to returning `stateUpdate`. This allows other orchestrators (e.g., `adwSdlc.tsx`) to keep working without migration. Only `adwPlanBuild.tsx` is migrated in this slice.
- **Sequential only** — This slice implements sequential execution only. The `parallel()`, `branch()`, and `optional()` primitives are out of scope.
- **`WorkflowContext` not removed** — The flat `WorkflowContext` type is kept intact. Structured state is additive. The flat context fields are removed in a later slice after all orchestrators migrate.
- **Files under 300 lines** — Per coding guidelines, keep `orchestratorRunner.ts` and `workflowState.ts` focused. The runner should be well under 200 lines for sequential-only execution.
- **No decorators** — Keep implementation simple: plain functions and interfaces only.
