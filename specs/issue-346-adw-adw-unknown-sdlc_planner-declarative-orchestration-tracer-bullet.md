# Feature: Declarative Orchestration Tracer Bullet — Structured State + Runner + adwPlanBuild Migration

## Metadata
issueNumber: `346`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
This is the tracer-bullet implementation for the declarative orchestration architecture described in `specs/prd/declarative-orchestration-architecture.md`. It delivers three tightly-coupled deliverables that must work end-to-end:

1. **Structured workflow state types** — Replace the flat `WorkflowContext` (~30 optional fields embedded in `WorkflowConfig`) with a namespaced `WorkflowState` type whose sections (`state.install.*`, `state.plan.*`, `state.build.*`, `state.test.*`, `state.pr.*`) group fields by the phase that produces them. Init-time data (issue, adwId, worktreePath, branchName, projectConfig, repoContext) stays on `WorkflowConfig` — `WorkflowState` is exclusively for inter-phase data flow.

2. **Declarative orchestrator runner** — `defineOrchestrator()` builds an immutable orchestrator definition; `runOrchestrator()` executes it. The runner owns CLI arg parsing, `initializeWorkflow()`, `CostTracker` lifecycle, sequential phase execution, try/catch, and `completeWorkflow()` / `handleWorkflowError()`. All boundaries have explicit TypeScript types — no `any`.

3. **Migrate `adwPlanBuild.tsx`** — Convert the simplest orchestrator to a ~15-line declarative definition. Its five phases (install, plan, build, test, PR) read/write namespaced structured state instead of the flat `WorkflowContext`.

## User Story
As a developer adding or reading an orchestrator
I want to declare a phase list with typed namespaced state in ~15 lines
So that new pipelines are trivial to create, understand, and test without copying boilerplate

## Problem Statement
All 14 orchestrator scripts repeat ~40–70 lines of identical arg parsing, workflow initialization, CostTracker setup, try/catch, and completion handling. `WorkflowContext` is a flat bag of ~30 optional fields with no indication of which phase produces or consumes which data. Inter-phase dependencies are invisible and untyped.

## Solution Statement
Introduce `WorkflowState` (namespaced, typed, JSON-serializable) and a `defineOrchestrator()` / `runOrchestrator()` runner that owns all lifecycle boilerplate. Migrate `adwPlanBuild.tsx` as the first proof that the new API works end-to-end.

## Relevant Files

- `adws/types/workflowTypes.ts` — add `WorkflowState` type and per-phase namespace interfaces
- `adws/core/orchestratorRunner.ts` *(new)* — `defineOrchestrator()` and `runOrchestrator()` implementation
- `adws/core/phaseRunner.ts` — existing `CostTracker` and `runPhase` consumed by the new runner; read to understand contract
- `adws/phases/workflowInit.ts` — `initializeWorkflow()` and `WorkflowConfig` referenced by runner
- `adws/phases/workflowCompletion.ts` — `completeWorkflow()` / `handleWorkflowError()` referenced by runner
- `adws/phases/installPhase.ts` — updated to read/write `state.install.*`
- `adws/phases/planPhase.ts` — updated to read/write `state.plan.*`
- `adws/phases/buildPhase.ts` — updated to read/write `state.build.*`
- `adws/phases/testPhase.ts` — updated to read/write `state.test.*`
- `adws/phases/prPhase.ts` — updated to read/write `state.pr.*`
- `adws/workflowPhases.ts` — re-exports that phases use; verify no breakage
- `adws/adwPlanBuild.tsx` — replaced with declarative definition (~15 lines)
- `adws/core/constants.ts` — `OrchestratorId` enum (referenced by runner)
- `adws/core/orchestratorCli.ts` — existing CLI parsing utilities consumed by runner
- `adws/types/index.ts` — add exports for new state types

### New Files
- `adws/core/orchestratorRunner.ts` — `OrchestratorDefinition`, `PhaseDefinition`, `defineOrchestrator()`, `runOrchestrator()`
- `adws/types/stateTypes.ts` — `WorkflowState`, `InstallState`, `PlanState`, `BuildState`, `TestState`, `PRState` interfaces

## Implementation Plan

### Phase 1: Foundation — Structured State Types
Define `WorkflowState` and all per-phase namespace interfaces. This is pure type work — no runtime changes yet. Establishes the contract that the runner and phases will implement against.

### Phase 2: Core Implementation — Orchestrator Runner
Implement `defineOrchestrator()` and `runOrchestrator()` in `adws/core/orchestratorRunner.ts`. The runner takes an `OrchestratorDefinition` and drives: CLI arg parsing, `initializeWorkflow()`, `CostTracker`, sequential phase execution, error handling, and workflow completion. Phase functions in this slice have signature `(config: WorkflowConfig, state: WorkflowState) => Promise<PhaseResult & { stateUpdate: Partial<WorkflowState> }>`.

### Phase 3: Integration — Phase Migration + adwPlanBuild
Update install, plan, build, test, and PR phase implementations to accept and return namespaced state. Replace `adwPlanBuild.tsx` with a ~15-line declarative definition that calls `runOrchestrator()`. Verify `bunx tsx adws/adwPlanBuild.tsx <issueNumber>` executes correctly with the new runner. Verify all other orchestrators continue to work.

## Step by Step Tasks

### Step 1: Define `WorkflowState` and per-phase namespace interfaces
- Create `adws/types/stateTypes.ts` with:
  - `InstallState` interface (e.g., `installContext?: string`, `installOutput?: string`)
  - `PlanState` interface (e.g., `planFilePath?: string`, `branchName?: string`, `issueType?: string`)
  - `BuildState` interface (e.g., `buildOutput?: string`)
  - `TestState` interface (e.g., `unitTestsPassed?: boolean`, `totalRetries?: number`)
  - `PRState` interface (e.g., `prUrl?: string`, `prNumber?: number`)
  - `WorkflowState` interface combining all namespace sections:
    ```ts
    export interface WorkflowState {
      install: InstallState;
      plan: PlanState;
      build: BuildState;
      test: TestState;
      pr: PRState;
    }
    ```
  - `createInitialWorkflowState(): WorkflowState` factory returning empty namespace objects
  - All interfaces must be JSON-serializable (no functions, no class instances)
- Export new types from `adws/types/index.ts`

### Step 2: Implement `orchestratorRunner.ts`
- Create `adws/core/orchestratorRunner.ts` with:
  - `PhaseDefinition<S extends WorkflowState>` interface:
    ```ts
    export interface PhaseDefinition {
      name: string;
      run: (config: WorkflowConfig, state: WorkflowState) => Promise<PhaseResult & { stateUpdate: Partial<WorkflowState> }>;
    }
    ```
  - `OrchestratorDefinition` interface:
    ```ts
    export interface OrchestratorDefinition {
      id: OrchestratorIdType;
      phases: ReadonlyArray<PhaseDefinition>;
    }
    ```
  - `defineOrchestrator(def: OrchestratorDefinition): OrchestratorDefinition` — identity function (validates shape, returns frozen def)
  - `runOrchestrator(def: OrchestratorDefinition): Promise<void>` — owns:
    1. CLI arg parsing via `parseTargetRepoArgs` / `parseOrchestratorArguments`
    2. `initializeWorkflow()` call
    3. `createInitialWorkflowState()` call
    4. `new CostTracker()` instantiation
    5. Sequential `runPhase()` calls for each `PhaseDefinition`, threading state through
    6. `completeWorkflow()` with accumulated cost and model usage
    7. `handleWorkflowError()` in the catch block
- No `any` types at any boundary
- Keep file under 200 lines (guideline: files under 300 lines)

### Step 3: Update phase functions to accept and return namespaced state
For each of the five phases (install, plan, build, test, PR), update the function signature to:
```ts
(config: WorkflowConfig, state: WorkflowState) => Promise<PhaseResult & { stateUpdate: Partial<WorkflowState> }>
```
- `installPhase.ts`: write output to `stateUpdate.install.*`; read any needed context from `config` (not `WorkflowContext` flat fields)
- `planPhase.ts`: write `stateUpdate.plan.planFilePath`, `stateUpdate.plan.issueType`, etc.
- `buildPhase.ts`: read `state.plan.*`; write `stateUpdate.build.*`
- `testPhase.ts`: read `state.build.*`; write `stateUpdate.test.unitTestsPassed`, `stateUpdate.test.totalRetries`
- `prPhase.ts`: read `state.plan.*`, `state.build.*`, `state.test.*`; write `stateUpdate.pr.prUrl`
- Maintain backward compatibility: keep the old `executeXxxPhase(config)` exports working by wrapping new signatures — existing orchestrators must not break

### Step 4: Replace `adwPlanBuild.tsx` with declarative definition
- Replace the full `main()` function boilerplate with a `defineOrchestrator` + `runOrchestrator` call
- Target ~15 lines:
  ```ts
  import { defineOrchestrator, runOrchestrator } from './core/orchestratorRunner';
  import { OrchestratorId } from './core';
  import { installPhaseDeclarative, planPhaseDeclarative, buildPhaseDeclarative, testPhaseDeclarative, prPhaseDeclarative } from './phases';

  runOrchestrator(defineOrchestrator({
    id: OrchestratorId.PlanBuild,
    phases: [
      installPhaseDeclarative,
      planPhaseDeclarative,
      buildPhaseDeclarative,
      testPhaseDeclarative,
      prPhaseDeclarative,
    ],
  }));
  ```
- Each `*Declarative` export is the new `PhaseDefinition` shape; the old `executeXxxPhase` wrappers continue to exist for other orchestrators

### Step 5: Verify existing orchestrators are unaffected
- Read `adwSdlc.tsx`, `adwPlanBuildTest.tsx`, and `adwPlanBuildReview.tsx` to confirm they still import `executeXxxPhase` wrappers
- Run type check to confirm no regressions in existing orchestrators

### Step 6: Run validation commands
- Execute all validation commands listed in the `Validation Commands` section

## Testing Strategy

### Edge Cases
- `runOrchestrator()` with a phase that throws: `handleWorkflowError` must be called, process must not hang
- Phase state updates are immutable: one phase's `stateUpdate` must not mutate another phase's already-written namespace
- `createInitialWorkflowState()` must produce a fully JSON-serializable object (no undefined prototype fields)
- Backward-compat wrappers: calling `executeInstallPhase(config)` (old signature) must still work for orchestrators not yet migrated

## Acceptance Criteria
- [ ] `adws/types/stateTypes.ts` defines `WorkflowState` with namespaced interfaces `InstallState`, `PlanState`, `BuildState`, `TestState`, `PRState`
- [ ] `createInitialWorkflowState()` returns a JSON-serializable value (roundtrip via `JSON.parse(JSON.stringify(...))` is lossless)
- [ ] `adws/core/orchestratorRunner.ts` exports `defineOrchestrator()` and `runOrchestrator()` with no `any` types
- [ ] Runner handles sequential phase execution, accumulates cost, calls `completeWorkflow` / `handleWorkflowError`
- [ ] `adwPlanBuild.tsx` is replaced with a declarative definition of ~15 lines
- [ ] `bunx tsx adws/adwPlanBuild.tsx <issueNumber>` works end-to-end on the new runner (dry-run via type check + lint; actual run against a test issue is out of scope for CI)
- [ ] Install, plan, build, test, PR phase files export `PhaseDefinition` objects that read/write namespaced state
- [ ] Backward-compat wrappers (`executeXxxPhase`) continue to exist and type-check for other orchestrators
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass with zero errors
- [ ] `bun run lint` passes with zero errors

## Validation Commands
```bash
# Type check root
bunx tsc --noEmit

# Type check adws sub-project
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# Confirm adwPlanBuild.tsx is parseable and imports resolve
bunx tsx --eval "import './adws/adwPlanBuild.tsx'"
```

## Notes
- **Unit tests disabled**: `.adw/project.md` contains `## Unit Tests: disabled` — no unit test files should be created or run.
- **Blocked by #344**: The declarative runner assumes all orchestrators use `CostTracker`/`runPhase`. This plan should be implemented after #344 lands.
- **Backward compatibility is required**: The flat `WorkflowContext` and the old `executeXxxPhase(config)` signatures must remain functional during this tracer-bullet migration. Only `adwPlanBuild.tsx` switches to the new API in this slice.
- **No `any`**: Strict TypeScript mode is enforced. Use generics or `unknown` where the type is not statically known.
- **File size**: Keep `orchestratorRunner.ts` under 200 lines. If it grows, split runner lifecycle logic into a helper.
- **Migration path**: After this tracer bullet, the remaining 13 orchestrators can be migrated incrementally in subsequent issues.
- **Conditional doc**: `app_docs/feature-ce43gr-fix-missing-d1-cost-writes.md` is relevant if CostTracker integration in the new runner diverges from the existing `phaseRunner.ts` patterns.
