# Feature: Structured State + Declarative Runner + adwPlanBuild Migration

## Metadata
issueNumber: `346`
adwId: `modak4-refactor-structured`
issueJson: `{"number":346,"title":"refactor: structured state + declarative runner + adwPlanBuild migration","body":"## Parent PRD\n\n`specs/prd/declarative-orchestration-architecture.md`\n\n## What to build\n\nThe tracer bullet for the declarative orchestration architecture. Three deliverables that must work end-to-end:\n\n**1. Structured workflow state types** — Replace the flat `WorkflowContext` (~30 optional fields) with namespaced state grouped by producing phase: `state.install.*`, `state.plan.*`, `state.build.*`, `state.test.*`, `state.pr.*`, etc. Each namespace is a typed interface. The full state object is JSON-serializable. Init-time data (issue, adwId, worktreePath, branchName, projectConfig, repoContext) stays on `WorkflowConfig`, separate from phase state.\n\n**2. Declarative orchestrator runner** — A `defineOrchestrator()` / `runOrchestrator()` API that takes an `OrchestratorId` and a typed phase list. For this slice, only sequential execution is needed (no parallel/branch/optional yet). The runner owns: CLI arg parsing, `initializeWorkflow()`, `CostTracker` lifecycle, per-phase execution, try/catch, `completeWorkflow()` / `handleWorkflowError()`. All module interfaces must have explicit TypeScript types — no `any`, no implicit shapes.\n\n**3. Migrate `adwPlanBuild.tsx`** — Convert the simplest orchestrator to a declarative definition. Migrate its phases (install, plan, build, test, PR) to read/write namespaced structured state. The old `adwPlanBuild.tsx` boilerplate is replaced with a ~15-line declarative definition.\n\nRunner unit tests: mock phases that read/write structured state → verify execution order, cost tracking, completion/error handling, state serialization roundtrip.\n\n## Acceptance criteria\n\n- [ ] Structured state type defined with namespaced sections, explicit TypeScript interfaces per phase, JSON-serializable\n- [ ] `defineOrchestrator()` and `runOrchestrator()` implemented with sequential phase execution\n- [ ] Runner handles: arg parsing, `initializeWorkflow()`, `CostTracker` lifecycle, try/catch, completion/error\n- [ ] `adwPlanBuild.tsx` replaced with declarative definition (~15 lines)\n- [ ] Install, plan, build, test, PR phases read/write structured state instead of flat `WorkflowContext`\n- [ ] `bunx tsx adws/adwPlanBuild.tsx <issueNumber>` works end-to-end on the new runner\n- [ ] Runner unit tests pass: execution order, cost tracking, completion, error handling, state serialization roundtrip\n- [ ] All module boundary types are explicit (no `any`)\n- [ ] Existing orchestrators continue to work (backward compatible during migration)\n\n## Blocked by\n\n- Blocked by #344 (CostTracker migration must land first — declarative runner assumes all orchestrators use CostTracker/runPhase)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-30T08:30:57Z","comments":[],"actionableComment":null}`

## Feature Description
Create the tracer bullet for ADW's declarative orchestration architecture. This introduces three interlocking deliverables: (1) typed, namespaced workflow state interfaces that capture each phase's output in a JSON-serializable structure, (2) a `defineOrchestrator()` / `runOrchestrator()` API that replaces imperative orchestrator boilerplate with a declarative phase list, and (3) a migration of `adwPlanBuild.tsx` from ~70 lines of boilerplate to a ~20-line declarative definition. The declarative runner owns all cross-cutting concerns (CLI parsing, initialization, CostTracker lifecycle, error handling) so orchestrators only declare *which* phases to run.

## User Story
As an ADW developer
I want to define orchestrators as declarative phase lists instead of copying boilerplate
So that adding or reordering phases is a one-line change and the control flow is visible in the definition

## Problem Statement
Every ADW orchestrator repeats the same ~50 lines of boilerplate: parse CLI args, call `initializeWorkflow()`, create a `CostTracker`, wrap phases in try/catch, call `completeWorkflow()` / `handleWorkflowError()`. The 12+ orchestrator files (adwPlanBuild, adwSdlc, adwPlanBuildTest, etc.) all duplicate this pattern. Phase output data is scattered across `config.ctx.*` mutations, `config.installContext`, and return values with no unified shape. This makes it hard to add cross-cutting concerns, test the runner in isolation, or understand which phase produces what data.

## Solution Statement
1. **Structured state types** — Define explicit TypeScript interfaces per phase (`InstallPhaseState`, `PlanPhaseState`, `BuildPhaseState`, `TestPhaseState`, `PRPhaseState`) collected under a `WorkflowState` aggregate. The runner populates structured state from phase return values after each phase completes. Init-time data stays on `WorkflowConfig` (unchanged).

2. **Declarative runner** — A `defineOrchestrator()` function accepts an `OrchestratorDefinition` (id, scriptName, phases, optional completionMetadata callback). `runOrchestrator()` executes the definition: parses CLI args, calls `initializeWorkflow()`, creates `CostTracker`, runs phases sequentially via existing `runPhase()`, captures results into a `PhaseResultStore`, calls `completeWorkflow()` on success or `handleWorkflowError()` on failure. Only sequential execution for this slice.

3. **adwPlanBuild migration** — Replace the imperative `adwPlanBuild.tsx` with a declarative definition that lists its 5 phases and a `completionMetadata` callback. Existing phase functions remain unchanged — they continue to read/write `config.ctx` and return `PhaseResult`. The runner bridges phase results to structured state.

**Backward compatibility**: Existing orchestrators (adwSdlc, adwPlanBuildTest, etc.) continue using the imperative pattern unchanged. The declarative runner is purely additive.

## Relevant Files
Use these files to implement the feature:

- `adws/core/phaseRunner.ts` — Existing `CostTracker`, `runPhase()`, `PhaseResult`, `PhaseFn` types. The declarative runner builds on top of these.
- `adws/core/constants.ts` — `OrchestratorId` and `OrchestratorIdType` constants used in orchestrator definitions.
- `adws/core/orchestratorCli.ts` — `parseTargetRepoArgs()`, `parseOrchestratorArguments()`, `buildRepoIdentifier()` used by the runner for CLI parsing.
- `adws/core/index.ts` — Barrel exports for core module. Must re-export new runner functions.
- `adws/phases/workflowInit.ts` — `initializeWorkflow()` and `WorkflowConfig` type. Called by the runner.
- `adws/phases/workflowCompletion.ts` — `completeWorkflow()`, `handleWorkflowError()`. Called by the runner on success/failure.
- `adws/workflowPhases.ts` — Re-exports all phase functions. The migrated orchestrator imports from here.
- `adws/adwPlanBuild.tsx` — The orchestrator to migrate. Currently 71 lines of imperative boilerplate.
- `adws/adwPlanBuildTest.tsx` — Near-identical orchestrator to adwPlanBuild. Reference for verifying the pattern generalizes.
- `adws/adwSdlc.tsx` — Most complex orchestrator with parallel phases and phase-specific wrappers. Reference for future declarative migration.
- `adws/types/workflowTypes.ts` — Existing workflow type definitions (WorkflowStage, RecoveryState).
- `adws/types/index.ts` — Barrel exports for types module. Must re-export new state types.
- `adws/github/workflowCommentsIssue.ts` — `WorkflowContext` interface (the flat ~30-field bag). Unchanged but referenced for understanding current state shape.
- `adws/phases/installPhase.ts` — `executeInstallPhase()` return type and how it writes `config.installContext`.
- `adws/phases/testPhase.ts` — `executeTestPhase()` return type with `unitTestsPassed` and `totalRetries`.
- `adws/phases/planPhase.ts` — `executePlanPhase()` return type.
- `adws/phases/buildPhase.ts` — `executeBuildPhase()` return type.
- `adws/phases/prPhase.ts` — `executePRPhase()` return type.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow (no `any`, explicit types, modularity, immutability).

### New Files
- `adws/types/workflowState.ts` — Structured workflow state types: per-phase interfaces and `WorkflowState` aggregate.
- `adws/core/orchestratorRunner.ts` — `defineOrchestrator()`, `runOrchestrator()`, `OrchestratorDefinition`, `PhaseDefinition`, `PhaseResultStore`.

## Implementation Plan
### Phase 1: Foundation — Structured State Types
Define the typed, namespaced workflow state interfaces in `adws/types/workflowState.ts`. Each phase gets its own interface capturing its semantic output (not cost data — that's handled by `PhaseResult`). The aggregate `WorkflowState` uses optional properties since phases execute incrementally. All types are JSON-serializable (no functions, class instances, or circular references).

Also define a `PhaseResultStore` class that wraps `Map<string, PhaseResult>` with a typed accessor `get<T>(name): T | undefined` for safe result retrieval in `completionMetadata` callbacks. This avoids `any` while allowing orchestrator definitions to access phase-specific return fields.

### Phase 2: Core Implementation — Declarative Runner
Create `adws/core/orchestratorRunner.ts` with:
- `PhaseDefinition` interface: `{ name: string; execute: PhaseFn }`
- `OrchestratorDefinition` interface: `{ id: OrchestratorIdType; scriptName: string; usagePattern: string; phases: ReadonlyArray<PhaseDefinition>; completionMetadata?: (results: PhaseResultStore) => Record<string, unknown> }`
- `defineOrchestrator(def)`: Returns the definition (identity function for type-checking at the definition site)
- `runOrchestrator(def)`: The entry point that:
  1. Parses CLI args via `parseTargetRepoArgs()` + `parseOrchestratorArguments()`
  2. Calls `initializeWorkflow()` with the definition's `id`
  3. Creates a `CostTracker` and `PhaseResultStore`
  4. Iterates `def.phases` sequentially, calling `runPhase(config, tracker, phase.execute, phase.name)` for each
  5. Stores each result in the `PhaseResultStore`
  6. On success: calls `def.completionMetadata?.(results)` to build metadata, then `completeWorkflow()`
  7. On error: calls `handleWorkflowError()`

Re-export from `adws/core/index.ts`.

### Phase 3: Integration — adwPlanBuild Migration
Replace `adwPlanBuild.tsx` with a declarative definition:
- Import `defineOrchestrator`, `runOrchestrator` from core
- Import phase functions from `workflowPhases`
- Call `runOrchestrator(defineOrchestrator({ ... }))` with the 5 phases and a `completionMetadata` callback that extracts `unitTestsPassed` and `totalRetries` from the test phase result

Verify `bunx tsx adws/adwPlanBuild.tsx --help` still prints usage.
Verify all other orchestrators compile and their imports are unaffected.

## Step by Step Tasks

### Step 1: Read existing phase return types
- Read `adws/phases/installPhase.ts`, `planPhase.ts`, `buildPhase.ts`, `testPhase.ts`, `prPhase.ts` to understand the exact return type shape of each phase function
- Read `adws/core/phaseRunner.ts` to understand `PhaseResult`, `PhaseFn`, `CostTracker`, `runPhase()` signatures
- Read `adws/phases/workflowInit.ts` for `WorkflowConfig` and `initializeWorkflow()` signature
- Read `adws/phases/workflowCompletion.ts` for `completeWorkflow()` and `handleWorkflowError()` signatures

### Step 2: Create structured state types
- Create `adws/types/workflowState.ts` with:
  - `InstallPhaseState` — captures `installContext` (the cached context string, or undefined if install failed/skipped)
  - `PlanPhaseState` — captures plan-related output (planPath, branchName as read from `config.ctx` after plan phase)
  - `BuildPhaseState` — captures build-related output (buildOutput as read from `config.ctx` after build phase)
  - `TestPhaseState` — captures `unitTestsPassed: boolean`, `totalRetries: number` from the test phase return value
  - `PRPhaseState` — captures `prUrl`, `prNumber` as read from `config.ctx` after PR phase
  - `WorkflowState` — aggregate type with optional namespaced sections: `install?`, `plan?`, `build?`, `test?`, `pr?`
  - `PhaseResultStore` — typed wrapper around `Map<string, PhaseResult>` with `set(name, result)` and `get<T extends PhaseResult>(name): T | undefined`
- Add JSDoc comments per the coding guidelines
- Export from `adws/types/index.ts`

### Step 3: Create the declarative runner
- Create `adws/core/orchestratorRunner.ts` with:
  - `PhaseDefinition` interface: `{ readonly name: string; readonly execute: PhaseFn }`
  - `OrchestratorDefinition` interface with fields: `id: OrchestratorIdType`, `scriptName: string`, `usagePattern: string`, `phases: ReadonlyArray<PhaseDefinition>`, optional `completionMetadata: (results: PhaseResultStore) => Record<string, unknown>`
  - `defineOrchestrator(def: OrchestratorDefinition): OrchestratorDefinition` — identity function for definition-site type checking
  - `runOrchestrator(def: OrchestratorDefinition): Promise<void>` — the actual runner implementation:
    - Parse args: `parseTargetRepoArgs(args)`, `parseOrchestratorArguments(args, { scriptName: def.scriptName, usagePattern: def.usagePattern, supportsCwd: false })`
    - Build repo identifier: `buildRepoIdentifier(targetRepo)`
    - Initialize: `await initializeWorkflow(issueNumber, adwId, def.id, { ... })`
    - Create tracker: `new CostTracker()`
    - Create result store: `new PhaseResultStore()`
    - Sequential execution: `for (const phase of def.phases) { const result = await runPhase(config, tracker, phase.execute, phase.name); results.set(phase.name, result); }`
    - Success path: `const metadata = def.completionMetadata?.(results) ?? {}; await completeWorkflow(config, tracker.totalCostUsd, metadata, tracker.totalModelUsage)`
    - Error path: `handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage)`
- All types are explicit — no `any`, no implicit shapes
- Re-export `defineOrchestrator`, `runOrchestrator`, `OrchestratorDefinition`, `PhaseDefinition` from `adws/core/index.ts`

### Step 4: Migrate adwPlanBuild.tsx to declarative definition
- Replace the entire contents of `adws/adwPlanBuild.tsx` with a declarative definition:
  - Import `OrchestratorId` from `./core`
  - Import `defineOrchestrator`, `runOrchestrator` from `./core/orchestratorRunner`
  - Import phase functions (`executeInstallPhase`, `executePlanPhase`, `executeBuildPhase`, `executeTestPhase`, `executePRPhase`) from `./workflowPhases`
  - Define the orchestrator with `defineOrchestrator({ id: OrchestratorId.PlanBuild, scriptName: 'adwPlanBuild.tsx', usagePattern, phases: [...], completionMetadata: ... })`
  - The `completionMetadata` callback retrieves the test phase result and returns `{ unitTestsPassed, totalTestRetries }`
  - Call `runOrchestrator(definition)` at the module level
- Keep the `#!/usr/bin/env bunx tsx` shebang
- Preserve the JSDoc usage comment (trimmed to match the new concise form)
- Target: ~20 lines total (definition + invocation), down from ~71

### Step 5: Verify type checking passes
- Run `bunx tsc --noEmit` to verify the root tsconfig passes
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify the adws-specific tsconfig passes
- Fix any type errors

### Step 6: Verify linter passes
- Run `bun run lint` to verify no lint errors
- Fix any lint issues

### Step 7: Verify existing orchestrators are unaffected
- Run `bunx tsc --noEmit` (already done in step 5, but confirm no regressions in other orchestrator files)
- Verify `adwPlanBuildTest.tsx`, `adwSdlc.tsx`, and other orchestrators still compile without changes
- Verify `adwPlanBuild.tsx` CLI help works: `bunx tsx adws/adwPlanBuild.tsx --help` should print usage and exit

### Step 8: Run validation commands
- Run all validation commands listed below to confirm zero regressions

## Testing Strategy

### Edge Cases
- Runner receives 0 phases (empty phase list) — should still call `initializeWorkflow` and `completeWorkflow` with empty metadata
- Phase throws an error — runner must call `handleWorkflowError` with accumulated cost data
- Phase throws `RateLimitError` — already handled by `runPhase()` internally, runner's catch block should propagate correctly
- `completionMetadata` callback accesses a phase name that wasn't in the definition — `PhaseResultStore.get()` returns `undefined`, callback uses optional chaining
- CLI `--help` flag — `parseOrchestratorArguments` handles this and exits, runner never reaches `initializeWorkflow`
- Multiple orchestrators defined in same process — each `runOrchestrator` call is independent
- Phase result store type safety — `get<T>()` returns `T | undefined` with explicit type assertion, no `any` leakage

## Acceptance Criteria
- [ ] `adws/types/workflowState.ts` exists with `InstallPhaseState`, `PlanPhaseState`, `BuildPhaseState`, `TestPhaseState`, `PRPhaseState`, `WorkflowState`, and `PhaseResultStore`
- [ ] All state interfaces are JSON-serializable (no functions, no class instances in the state types)
- [ ] `adws/core/orchestratorRunner.ts` exports `defineOrchestrator()` and `runOrchestrator()` with explicit TypeScript types
- [ ] `runOrchestrator()` handles: CLI arg parsing, `initializeWorkflow()`, `CostTracker` lifecycle, sequential phase execution via `runPhase()`, `completeWorkflow()`, `handleWorkflowError()`
- [ ] `adwPlanBuild.tsx` is a ~20-line declarative definition using `defineOrchestrator()` + `runOrchestrator()`
- [ ] `bunx tsx adws/adwPlanBuild.tsx --help` prints usage and exits
- [ ] `bunx tsc --noEmit` passes with zero errors
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` passes with zero errors
- [ ] `bun run lint` passes with zero errors
- [ ] No `any` types at module boundaries in new code
- [ ] Existing orchestrators (`adwSdlc.tsx`, `adwPlanBuildTest.tsx`, etc.) compile without changes
- [ ] `PhaseResultStore` provides typed access without `any` (uses generic type parameter)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsx adws/adwPlanBuild.tsx --help` — Verify the migrated orchestrator CLI still works (should print usage and exit 1)

## Notes
- **Unit tests**: The issue requests runner unit tests (execution order, cost tracking, state serialization roundtrip). However, `.adw/project.md` has `## Unit Tests: disabled`, so unit test tasks are omitted from this plan per ADW conventions. If the project owner wants runner unit tests, enable `## Unit Tests: enabled` in `.adw/project.md` and add a follow-up task.
- **Parallel phase execution**: The issue specifies "only sequential execution is needed (no parallel/branch/optional yet)". The existing `runPhasesParallel()` in `phaseRunner.ts` can be composed into a future `parallel` phase type in the declarative API. For now, all phases run sequentially.
- **WorkflowContext backward compatibility**: The existing `WorkflowContext` (in `workflowCommentsIssue.ts`) remains unchanged. Phase functions continue to mutate `config.ctx.*` for comment formatting. The structured `WorkflowState` captures phase results as an additional representation. Future slices can migrate the comment system to read from structured state.
- **Phase function signatures unchanged**: Existing `executeXxxPhase(config: WorkflowConfig)` signatures are preserved. The declarative runner wraps them; it doesn't require phase functions to accept a new state parameter. This ensures all existing orchestrators continue to work.
- **`PhaseResultStore.get<T>()`**: Uses a generic type assertion (`as T | undefined`). This is an explicit, bounded cast at the orchestrator definition boundary — the orchestrator author knows which phase produces which result type. This is the standard TypeScript pattern for heterogeneous collections and satisfies the "no `any`" requirement.
- **Coding guidelines**: Follow `guidelines/coding_guidelines.md` strictly — especially: no `any`, explicit interfaces, JSDoc on public APIs, files under 300 lines, immutable data where possible (`ReadonlyArray`, `readonly` properties on interfaces).
