# Feature: parallel() + optional() primitives + adwSdlc migration

## Metadata
issueNumber: `348`
adwId: `bxch84-refactor-runner-para`
issueJson: `{"number":348,"title":"refactor: runner parallel() + optional() primitives + adwSdlc migration","body":"## Parent PRD\n\n`specs/prd/declarative-orchestration-architecture.md`\n\n## What to build\n\nAdd `parallel()` and `optional()` composition primitives to the declarative orchestrator runner, then migrate `adwSdlc.tsx` (the most complex orchestrator) to a declarative definition.\n\n**`parallel()`** — runs multiple phases concurrently, waits for all to complete, accumulates costs from all. Used in SDLC for plan + scenario phases.\n\n**`optional()`** — wraps a phase so that errors are caught and logged without halting the pipeline. Used for non-fatal phases like scenario writer and step definition generation.\n\n**`adwSdlc.tsx` migration** — replace the hand-written orchestrator with a declarative definition using all three primitives (sequential, parallel, optional). Migrate all SDLC phases to read/write structured state. This includes wiring `reviewRetry.ts` to read/write `state.review.*` (screenshotUrls, retries, summaries, nonBlockerIssues) so downstream phases (document, KPI) can access review results from structured state instead of closure bindings.\n\nAdd structured state namespaces for: scenario, stepDef, alignment, review, document, kpi, autoMerge.\n\n## Acceptance criteria\n\n- [ ] `parallel()` primitive implemented — runs phases concurrently, accumulates costs\n- [ ] `optional()` primitive implemented — catches phase errors, logs, continues pipeline\n- [ ] `adwSdlc.tsx` replaced with declarative definition using sequential + parallel + optional\n- [ ] All SDLC phases read/write namespaced structured state\n- [ ] `reviewRetry.ts` writes to `state.review.*` (screenshotUrls, retries, summaries, nonBlockerIssues, allScreenshots)\n- [ ] Document phase reads `state.review.screenshotUrls` from structured state (no closure binding)\n- [ ] KPI phase reads `state.review.retries` from structured state (no closure binding)\n- [ ] `bunx tsx adws/adwSdlc.tsx <issueNumber>` works end-to-end on the new runner\n- [ ] Runner unit tests for parallel execution and optional error handling\n\n## Blocked by\n\n- Blocked by #346 (declarative runner foundation)\n\n## User stories addressed\n\n- User story 2 (control flow visible in declaration)\n- User story 6 (optional phases don't halt pipeline)\n- User story 8 (parallel phases declared, not hand-coded)\n- User story 21 (reviewRetry reads/writes structured state)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-30T08:31:33Z","comments":[],"actionableComment":null}`

## Feature Description
Add `parallel()` and `optional()` composition primitives to the declarative orchestrator runner (`orchestratorRunner.ts`), then migrate `adwSdlc.tsx` — the most complex orchestrator — from imperative boilerplate to a declarative definition using all three primitives (sequential, parallel, optional).

`parallel()` runs multiple phases concurrently via `Promise.all`, waits for all to complete, and accumulates costs from all phases into the tracker in one shot. The existing `runPhasesParallel()` in `phaseRunner.ts` already handles the cost accumulation logic — the new primitive leverages it within the declarative runner.

`optional()` wraps a phase so that errors are caught and logged without halting the pipeline. Non-fatal phases like scenario writer, step definition generation, KPI tracking, and auto-merge use this wrapper.

The `adwSdlc.tsx` migration replaces ~110 lines of imperative orchestration with a ~50-line declarative definition. Review results (screenshotUrls, retries, summaries, nonBlockerIssues) are written to `PhaseResultStore` so downstream phases (document, KPI) can access them via `results.get()` instead of closure bindings.

## User Story
As a developer maintaining ADW orchestrators
I want to declare parallel and optional phases in the orchestrator definition
So that control flow is visible in the declaration and non-fatal phases don't halt the pipeline

## Problem Statement
The current `adwSdlc.tsx` is an imperative script that manually handles parallel execution (plan + scenario), optional error swallowing (KPI, auto-merge), and inter-phase data passing via closure bindings (review screenshots → document, review retries → KPI). This makes the control flow hard to read and forces each orchestrator to re-implement the same patterns.

## Solution Statement
Extend the declarative orchestrator runner with two new phase definition variants — `ParallelPhaseDefinition` and `OptionalPhaseDefinition` — so that `runOrchestrator()` can execute parallel groups and catch errors for optional phases automatically. Migrate `adwSdlc.tsx` to use `defineOrchestrator()` with these primitives. Inter-phase data flows through `PhaseResultStore` accessed in the `completionMetadata` callback and in phase wrappers that read prior results.

## Relevant Files
Use these files to implement the feature:

- `adws/core/orchestratorRunner.ts` — The declarative runner to extend with `parallel()` and `optional()` phase definition variants. Core file being modified.
- `adws/core/phaseRunner.ts` — Contains `runPhase()`, `runPhasesParallel()`, `CostTracker`. The runner delegates to these. Must understand the existing parallel cost accumulation pattern.
- `adws/core/index.ts` — Barrel exports for core module. Must add new type/function exports.
- `adws/adwSdlc.tsx` — The imperative SDLC orchestrator to replace with a declarative definition.
- `adws/adwPlanBuild.tsx` — Reference: existing declarative orchestrator (tracer-bullet migration from #346).
- `adws/types/workflowState.ts` — Structured state types and `PhaseResultStore`. Add new state interfaces for scenario, stepDef, alignment, review, document, kpi, autoMerge.
- `adws/types/index.ts` — Barrel exports for types. Must add new state type exports.
- `adws/phases/workflowCompletion.ts` — Contains `executeReviewPhase()` which returns `reviewPassed`, `totalRetries`. Review result shape is important for downstream phases.
- `adws/phases/documentPhase.ts` — Currently takes `screenshotsDir` as an arg via closure binding. Must be adapted to accept review screenshots from `PhaseResultStore` or via the existing wrapper pattern in the declarative definition.
- `adws/phases/kpiPhase.ts` — Currently takes `reviewRetries` as an arg via closure binding. Same adaptation needed.
- `adws/phases/scenarioPhase.ts` — Non-fatal scenario phase, will be wrapped with `optional()`.
- `adws/phases/stepDefPhase.ts` — Non-fatal step-def phase, will be wrapped with `optional()`.
- `adws/phases/autoMergePhase.ts` — Non-fatal auto-merge phase, will be wrapped with `optional()`.
- `adws/workflowPhases.ts` — Re-exports all phase functions. No changes needed.
- `adws/core/constants.ts` — Contains `OrchestratorId`. No changes needed.
- `guidelines/coding_guidelines.md` — Must follow coding guidelines (immutability, type safety, no `any`).
- `app_docs/feature-modak4-refactor-structured-declarative-orchestrator-runner.md` — Documentation of the existing declarative runner pattern from #346.

### New Files
- None. All changes are modifications to existing files.

## Implementation Plan
### Phase 1: Foundation — Extend the Declarative Runner
Add `ParallelPhaseDefinition` and `OptionalPhaseDefinition` interfaces to `orchestratorRunner.ts`. Introduce a `PhaseEntry` discriminated union that the runner iterates over. Add helper factory functions `parallel()` and `optional()` for ergonomic declaration. Update `runOrchestrator()` to handle each variant: sequential phases use `runPhase()`, parallel groups use `runPhasesParallel()`, optional phases wrap `runPhase()` in a try/catch that logs and continues.

### Phase 2: Core Implementation — Structured State + adwSdlc Migration
Add new state interfaces to `workflowState.ts` for the remaining SDLC phases: `ScenarioPhaseState`, `StepDefPhaseState`, `AlignmentPhaseState`, `ReviewPhaseState`, `DocumentPhaseState`, `KpiPhaseState`, `AutoMergePhaseState`. Extend the `WorkflowState` aggregate interface. Replace the imperative `adwSdlc.tsx` with a declarative definition using `defineOrchestrator()`, composing phases with `parallel()` (plan + scenario), `optional()` (scenario, stepDef, KPI, autoMerge), and sequential (everything else). Use the `completionMetadata` callback to extract review/test results from `PhaseResultStore`.

### Phase 3: Integration — Inter-Phase Data Flow via PhaseResultStore
Wire the document phase wrapper to derive `screenshotsDir` from `config.adwId` (same as the current `getReviewScreenshotsDir()` helper). Wire the KPI phase wrapper to read `reviewResult.totalRetries` from `PhaseResultStore`. Both wrappers are defined inline in the declarative definition, keeping the phase functions themselves unchanged.

## Step by Step Tasks

### Step 1: Add parallel and optional phase definition types to orchestratorRunner.ts
- Add `ParallelPhaseDefinition` interface with `readonly kind: 'parallel'` discriminant, `readonly name: string`, and `readonly phases: ReadonlyArray<PhaseDefinition>`.
- Add `OptionalPhaseDefinition` interface with `readonly kind: 'optional'` discriminant and the same fields as `PhaseDefinition` (`name`, `execute`).
- Update `PhaseDefinition` to add `readonly kind?: 'sequential'` (optional for backward compatibility).
- Create `PhaseEntry = PhaseDefinition | ParallelPhaseDefinition | OptionalPhaseDefinition` union type.
- Update `OrchestratorDefinition.phases` from `ReadonlyArray<PhaseDefinition>` to `ReadonlyArray<PhaseEntry>`.
- Add factory functions:
  - `parallel(name: string, phases: ReadonlyArray<PhaseDefinition>): ParallelPhaseDefinition`
  - `optional(phase: PhaseDefinition): OptionalPhaseDefinition`

### Step 2: Update runOrchestrator() to handle parallel and optional variants
- In the `for` loop over `def.phases`, use a discriminant check (`'kind' in phase`) to dispatch:
  - No `kind` or `kind === 'sequential'`: existing `runPhase()` path (backward compatible).
  - `kind === 'parallel'`: call `runPhasesParallel()` with the sub-phases' execute functions. Store each sub-phase result in `PhaseResultStore` using its name.
  - `kind === 'optional'`: wrap `runPhase()` in try/catch. On error, log the phase name and error message, store an empty result in `PhaseResultStore`, and continue.
- For parallel phases, accumulate results into `PhaseResultStore` keyed by each sub-phase's name.
- Update barrel exports in `adws/core/index.ts` to export the new types and factory functions.

### Step 3: Add new structured state interfaces to workflowState.ts
- Add `ScenarioPhaseState` (readonly fields for scenario output).
- Add `AlignmentPhaseState` (readonly fields for alignment output).
- Add `ReviewPhaseState` with: `readonly reviewPassed: boolean`, `readonly totalRetries: number`, `readonly screenshotUrls: readonly string[]`, `readonly allScreenshots: readonly string[]`, `readonly allSummaries: readonly string[]`, `readonly nonBlockerIssues: readonly unknown[]`.
- Add `DocumentPhaseState` (readonly fields for document output).
- Add `KpiPhaseState` (readonly fields for KPI output).
- Add `AutoMergePhaseState` (readonly fields for auto-merge output).
- Extend `WorkflowState` with the new optional namespaced keys.
- Update barrel exports in `adws/types/index.ts`.

### Step 4: Migrate adwSdlc.tsx to declarative definition
- Replace the imperative `main()` function with a `defineOrchestrator()` + `runOrchestrator()` call.
- Phase list:
  1. `{ name: 'install', execute: executeInstallPhase }` — sequential
  2. `parallel('plan+scenario', [{ name: 'plan', execute: executePlanPhase }, { name: 'scenario', execute: executeScenarioPhase }])` — parallel
  3. `{ name: 'alignment', execute: executeAlignmentPhase }` — sequential
  4. `{ name: 'build', execute: executeBuildPhase }` — sequential
  5. `{ name: 'test', execute: executeTestPhase }` — sequential
  6. `{ name: 'review', execute: executeReviewPhase }` — sequential
  7. `{ name: 'document', execute: (cfg) => executeDocumentPhase(cfg, getReviewScreenshotsDir(cfg.adwId)) }` — sequential (wraps screenshotsDir)
  8. `{ name: 'pr', execute: executePRPhase }` — sequential
  9. `optional({ name: 'kpi', execute: (cfg) => executeKpiPhase(cfg, results.get<ReviewResult>('review')?.totalRetries) })` — optional. NOTE: since `optional()` is a static definition, the KPI phase wrapper must access results from `PhaseResultStore`. The `runOrchestrator()` function needs to pass the `PhaseResultStore` to phase functions, OR the wrapper closes over a mutable ref. The simpler approach: use the existing pattern where the wrapper captures `results` from the closure in the `completionMetadata` callback. However, since phases run before `completionMetadata`, the wrapper needs a different approach. **Resolution**: Pass `PhaseResultStore` as a second argument to phase `execute` functions. Update `PhaseFn` type or use a different mechanism. The cleanest approach: the orchestrator definition can reference a shared `results` variable since `runOrchestrator()` creates it. But the definition is created before `runOrchestrator()` runs. **Final approach**: extend `execute` signature in `PhaseDefinition` to `(config: WorkflowConfig, results: PhaseResultStore) => Promise<PhaseResult>`. The runner passes `results` to every phase. Phases that don't need it ignore the second argument (TypeScript allows fewer params). This is backward-compatible since existing `PhaseFn` signatures with one param are assignable to a two-param type.
  10. `optional({ name: 'autoMerge', execute: executeAutoMergePhase })` — optional
- `completionMetadata` callback: extract test and review results from `PhaseResultStore` to build the metadata object passed to `completeWorkflow()`.
- Remove the `getReviewScreenshotsDir()` helper (move it into the inline wrapper or keep it as a local function).

### Step 5: Update execute signature to pass PhaseResultStore
- In `orchestratorRunner.ts`, update the `execute` field type in `PhaseDefinition` to accept an optional second argument `results: PhaseResultStore`.
- Update `runOrchestrator()` to pass `results` as the second argument when calling `phase.execute(config, results)`.
- Update the `PhaseFn` type in `phaseRunner.ts` to accept an optional second argument, OR define a separate `DeclarativePhaseFn` type in `orchestratorRunner.ts` for phases that need access to prior results.
- **Preferred**: Define `DeclarativePhaseFn = (config: WorkflowConfig, results: PhaseResultStore) => Promise<PhaseResult>` in `orchestratorRunner.ts`. Use this type in `PhaseDefinition.execute`. The `runPhase()` function in `phaseRunner.ts` stays unchanged — the runner wraps the call to pass results.

### Step 6: Wire document and KPI phases in the declarative definition
- Document phase wrapper: `(cfg, results) => executeDocumentPhase(cfg, getReviewScreenshotsDir(cfg.adwId))`. The screenshots directory is derived from `cfg.adwId`, same as the current imperative code. No need to read `PhaseResultStore` for this.
- KPI phase wrapper: `(cfg, results) => { const review = results.get<ReviewResult>('review'); return executeKpiPhase(cfg, review?.totalRetries); }`. This replaces the closure binding `reviewResult.totalRetries`.
- Both wrappers are inline in the phase list, keeping phase functions unchanged.

### Step 7: Update barrel exports
- `adws/core/index.ts`: export `parallel`, `optional`, `ParallelPhaseDefinition`, `OptionalPhaseDefinition`, `PhaseEntry`, `DeclarativePhaseFn`.
- `adws/types/index.ts`: export new state interfaces.

### Step 8: Validate
- Run `bun run lint` — no lint errors.
- Run `bunx tsc --noEmit` — no type errors.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — no type errors.
- Run `bun run build` — successful build.
- Verify `adwPlanBuild.tsx` still works (backward compatibility — no `kind` field, still compiles and runs).

## Testing Strategy
### Edge Cases
- **Parallel phase where one phase throws**: `runPhasesParallel()` uses `Promise.all` which rejects on the first error. The runner should let this propagate (parallel phases are not optional by default). If the user wants optional parallel phases, they combine `parallel()` with `optional()` on individual sub-phases.
- **Optional phase that throws**: Error is caught, logged, and an empty PhaseResult is stored. The pipeline continues.
- **Empty parallel group**: `runPhasesParallel()` with an empty array should return immediately with no cost. Edge case but should be handled gracefully.
- **Backward compatibility**: Existing `PhaseDefinition` objects without a `kind` field must still work. The discriminant check defaults to sequential.
- **PhaseResultStore access for phases that haven't run yet**: `results.get()` returns `undefined`, which callers handle with `?.` and `??`.

## Acceptance Criteria
- [ ] `parallel()` factory function returns a `ParallelPhaseDefinition` with `kind: 'parallel'`.
- [ ] `optional()` factory function returns an `OptionalPhaseDefinition` with `kind: 'optional'`.
- [ ] `runOrchestrator()` dispatches parallel phases to `runPhasesParallel()`.
- [ ] `runOrchestrator()` wraps optional phases in try/catch, logs errors, and continues.
- [ ] `adwSdlc.tsx` is a declarative definition using `defineOrchestrator()` + `runOrchestrator()`.
- [ ] `adwSdlc.tsx` uses `parallel()` for plan + scenario.
- [ ] `adwSdlc.tsx` uses `optional()` for KPI and autoMerge.
- [ ] Document phase reads `screenshotsDir` from `config.adwId` (same derivation as before).
- [ ] KPI phase reads `reviewRetries` from `PhaseResultStore` via wrapper.
- [ ] `completionMetadata` extracts `unitTestsPassed`, `totalTestRetries`, `reviewPassed`, `totalReviewRetries` from `PhaseResultStore`.
- [ ] Existing `adwPlanBuild.tsx` still compiles and works (backward compatibility).
- [ ] All TypeScript strict checks pass (`bunx tsc --noEmit`).
- [ ] Linter passes (`bun run lint`).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws module
- `bun run build` — Build the application to verify no build errors

## Notes
- Unit tests are disabled for this project (`.adw/project.md` has `## Unit Tests: disabled`). No unit test tasks are included.
- The `scenarioPhase.ts` and `kpiPhase.ts` already have internal try/catch that swallow errors. Wrapping them with `optional()` provides a second safety net at the runner level, which is intentional — if the phase function itself changes in the future and removes its internal try/catch, the runner-level optional wrapper still protects the pipeline.
- The `executeReviewPhase()` function calls `process.exit(1)` when the review fails. This means the review phase is inherently fatal and should NOT be wrapped with `optional()`. The declarative migration preserves this behavior.
- Follow `guidelines/coding_guidelines.md`: use `readonly` on all interface properties, avoid `any`, prefer immutability, keep files under 300 lines.
- The `runPhasesParallel()` function in `phaseRunner.ts` does its own cost accumulation and persistence, so the runner does not need to call `tracker.accumulate()` separately for parallel phases. The runner just needs to call `runPhasesParallel(config, tracker, fns)` and store the individual results.
