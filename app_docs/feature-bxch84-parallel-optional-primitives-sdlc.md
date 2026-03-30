# parallel() + optional() Primitives + adwSdlc Declarative Migration

**ADW ID:** bxch84-refactor-runner-para
**Date:** 2026-03-30
**Specification:** specs/issue-348-adw-bxch84-refactor-runner-para-sdlc_planner-parallel-optional-primitives.md

## Overview

Extends the declarative orchestrator runner with two new phase execution primitives — `parallel()` and `optional()` — enabling concurrent phase groups and non-fatal phase wrapping to be declared directly in the orchestrator definition. `adwSdlc.tsx`, the most complex orchestrator, is migrated from ~110 lines of imperative boilerplate to a ~50-line declarative definition using all three primitives (sequential, parallel, optional).

## What Was Built

- `parallel(name, phases)` factory — runs a named group of phases concurrently via `Promise.all`, accumulates all phase costs
- `optional(phase)` factory — wraps any phase so errors are caught, logged, and the pipeline continues
- `ParallelPhaseDefinition` and `OptionalPhaseDefinition` interfaces with `kind` discriminant
- `PhaseEntry` discriminated union (`PhaseDefinition | ParallelPhaseDefinition | OptionalPhaseDefinition`)
- `DeclarativePhaseFn` type — extends phase signatures with a second `PhaseResultStore` argument for inter-phase data access without closure bindings
- `PhaseResultStore` class — typed runtime store for phase results accessible to downstream phases
- Full suite of `WorkflowState` namespaced interfaces: `ScenarioPhaseState`, `StepDefPhaseState`, `AlignmentPhaseState`, `ReviewPhaseState`, `DocumentPhaseState`, `KpiPhaseState`, `AutoMergePhaseState`
- `adwSdlc.tsx` migrated to declarative definition using `defineOrchestrator()` + `runOrchestrator()`

## Technical Implementation

### Files Modified

- `adws/core/orchestratorRunner.ts` (new): declarative runner with `parallel()`, `optional()`, `PhaseEntry`, `DeclarativePhaseFn`, `PhaseResultStore` dispatch logic
- `adws/types/workflowState.ts` (new): all per-phase state interfaces + `PhaseResultStore` class
- `adws/adwSdlc.tsx`: replaced imperative `main()` with `runOrchestrator(defineOrchestrator({...}))`
- `adws/core/index.ts`: exports for new runner types/functions, removed deprecated cost CSV helpers, added `execWithRetry`, `pauseQueue`, config constants

### Key Changes

- **Parallel dispatch**: `runOrchestrator()` maps sub-phases to `(cfg) => p.execute(cfg, results)` lambdas and delegates to the existing `runPhasesParallel()`, then stores each result by phase name
- **Optional dispatch**: wraps `runPhase()` in try/catch; on error logs `"Optional phase '${name}' failed (non-fatal)"` and stores a zero-cost empty result so the pipeline continues
- **PhaseResultStore passed to all phases**: every `execute` call now receives `(config, results)` — backward compatible since TypeScript allows functions with fewer parameters
- **KPI inter-phase data**: `kpi` phase wrapper reads `results.get<ReviewPhaseResult>('review')?.totalRetries` eliminating the previous closure binding on `reviewResult`
- **completionMetadata callback**: `adwSdlc` extracts `test` and `review` results from `PhaseResultStore` to build the `completeWorkflow()` metadata, with safe `?? false / ?? 0` defaults

## How to Use

### Declaring a parallel group

```ts
import { parallel } from './core/orchestratorRunner';

// In your defineOrchestrator() phases array:
parallel('plan+scenario', [
  { name: 'plan', execute: executePlanPhase },
  { name: 'scenario', execute: executeScenarioPhase },
]),
```

Both phases run concurrently. If either throws, the entire parallel group fails (use `optional()` on individual sub-phases if one is non-fatal).

### Declaring an optional (non-fatal) phase

```ts
import { optional } from './core/orchestratorRunner';

optional({ name: 'kpi', execute: executeKpiPhase }),
optional({ name: 'autoMerge', execute: executeAutoMergePhase }),
```

Errors are caught, logged at `warn` level, and an empty `{ costUsd: 0, modelUsage: {} }` result is stored. The pipeline continues.

### Accessing prior phase results

Phase functions receive `(config: WorkflowConfig, results: PhaseResultStore)` as arguments:

```ts
optional({ name: 'kpi', execute: (cfg, results) => {
  const review = results.get<ReviewPhaseResult>('review');
  return executeKpiPhase(cfg, review?.totalRetries);
} }),
```

### completionMetadata

Use the `completionMetadata` callback to extract structured data from `PhaseResultStore` for `completeWorkflow()`:

```ts
completionMetadata: (results) => {
  const test = results.get<TestPhaseResult>('test');
  const review = results.get<ReviewPhaseResult>('review');
  return {
    unitTestsPassed: test?.unitTestsPassed ?? false,
    totalTestRetries: test?.totalRetries ?? 0,
    reviewPassed: review?.reviewPassed ?? false,
    totalReviewRetries: review?.totalRetries ?? 0,
  };
},
```

## Configuration

No new environment variables. The primitives are pure TypeScript — no runtime configuration needed.

## Testing

```bash
bun run lint                          # no lint errors
bunx tsc --noEmit                     # root type check
bunx tsc --noEmit -p adws/tsconfig.json  # adws type check
bun run build                         # build passes
```

Backward compatibility: `adwPlanBuild.tsx` (existing declarative orchestrator without `kind` fields) compiles and runs unchanged — `undefined` kind defaults to sequential dispatch.

## Notes

- The `executeReviewPhase()` calls `process.exit(1)` on review failure — it is intentionally **not** wrapped with `optional()`. The declarative migration preserves this fatal behavior.
- `scenarioPhase.ts` and `kpiPhase.ts` already have internal try/catch; wrapping them with `optional()` adds a second safety net at the runner level.
- The step definition phase (`executeStepDefPhase`) was removed from `adwSdlc` in this migration as part of the alignment-phase consolidation.
- Unit tests are disabled for this project (`.adw/project.md`). Validation relies on TypeScript strict mode and lint.
