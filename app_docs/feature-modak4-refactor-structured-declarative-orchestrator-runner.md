# Declarative Orchestrator Runner + Structured Workflow State

**ADW ID:** modak4-refactor-structured
**Date:** 2026-03-30
**Specification:** specs/issue-346-adw-modak4-refactor-structured-sdlc_planner-declarative-orchestrator-runner.md

## Overview

Introduces a declarative orchestrator API (`defineOrchestrator()` / `runOrchestrator()`) that replaces per-orchestrator boilerplate with a typed phase list. Alongside it, typed namespaced workflow state interfaces (`WorkflowState`) capture each phase's semantic output in a JSON-serializable structure. As the tracer-bullet migration, `adwPlanBuild.tsx` is reduced from ~71 lines of imperative boilerplate to a ~29-line declarative definition.

## What Was Built

- `adws/types/workflowState.ts` — Structured per-phase state interfaces and `PhaseResultStore`
- `adws/core/orchestratorRunner.ts` — `defineOrchestrator()` and `runOrchestrator()` API
- `adwPlanBuild.tsx` migration — Declarative 5-phase definition replacing imperative boilerplate
- Barrel exports updated in `adws/core/index.ts` and `adws/types/index.ts`

## Technical Implementation

### Files Modified

- `adws/types/workflowState.ts` *(new)*: Defines `InstallPhaseState`, `PlanPhaseState`, `BuildPhaseState`, `TestPhaseState`, `PRPhaseState`, `WorkflowState` aggregate, and `PhaseResultStore` class.
- `adws/core/orchestratorRunner.ts` *(new)*: Implements `PhaseDefinition`, `OrchestratorDefinition`, `defineOrchestrator()`, and `runOrchestrator()`.
- `adws/adwPlanBuild.tsx`: Replaced with a 29-line declarative definition.
- `adws/core/index.ts`: Re-exports `defineOrchestrator`, `runOrchestrator`, `OrchestratorDefinition`, `PhaseDefinition`.
- `adws/types/index.ts`: Re-exports new state types and `PhaseResultStore`.

### Key Changes

- **`runOrchestrator()`** owns all cross-cutting concerns: CLI arg parsing via `parseTargetRepoArgs()` + `parseOrchestratorArguments()`, `initializeWorkflow()`, `CostTracker` lifecycle, sequential phase execution via `runPhase()`, `completeWorkflow()` on success, and `handleWorkflowError()` on failure.
- **`PhaseResultStore`** wraps `Map<string, PhaseResult>` with a bounded generic accessor `get<T extends PhaseResult>(name): T | undefined`, providing typed access to phase results without `any`.
- **`defineOrchestrator()`** is an identity function — it returns the definition unchanged, serving solely for TypeScript validation at the definition site.
- **Structured state types** are JSON-serializable and use `readonly` properties throughout, matching coding guidelines for immutability.
- **Backward compatible** — all existing orchestrators (`adwSdlc.tsx`, `adwPlanBuildTest.tsx`, etc.) continue using the imperative pattern unchanged.

## How to Use

### Defining a new orchestrator

```typescript
#!/usr/bin/env bunx tsx
import { OrchestratorId } from './core';
import { defineOrchestrator, runOrchestrator } from './core/orchestratorRunner';
import { executeInstallPhase, executePlanPhase, executeBuildPhase } from './workflowPhases';

runOrchestrator(defineOrchestrator({
  id: OrchestratorId.PlanBuild,
  scriptName: 'adwMyOrchestrator.tsx',
  usagePattern: '<github-issueNumber> [adw-id]',
  phases: [
    { name: 'install', execute: executeInstallPhase },
    { name: 'plan',    execute: executePlanPhase },
    { name: 'build',   execute: executeBuildPhase },
  ],
  completionMetadata: (results) => ({}),
}));
```

### Accessing phase results in `completionMetadata`

```typescript
type TestPhaseResult = Awaited<ReturnType<typeof executeTestPhase>>;

completionMetadata: (results) => {
  const test = results.get<TestPhaseResult>('test');
  return {
    unitTestsPassed: test?.unitTestsPassed ?? false,
    totalTestRetries: test?.totalRetries ?? 0,
  };
},
```

### Running

```bash
bunx tsx adws/adwPlanBuild.tsx <issueNumber> [adw-id] [--issue-type <type>]
bunx tsx adws/adwPlanBuild.tsx --help
```

## Configuration

No new environment variables. The runner uses existing `WorkflowConfig` infrastructure (`initializeWorkflow()`, `CostTracker`, etc.).

## Testing

```bash
bunx tsc --noEmit                          # Root type-check
bunx tsc --noEmit -p adws/tsconfig.json   # adws module type-check
bun run lint                               # Linter
bunx tsx adws/adwPlanBuild.tsx --help      # CLI help smoke test
```

## Notes

- **Sequential only** — this slice implements sequential phase execution. Parallel execution can be added as a future `PhaseDefinition` variant (e.g., a `parallel` wrapper).
- **`WorkflowContext` unchanged** — phase functions still mutate `config.ctx.*` for comment formatting. `WorkflowState` is an additive representation; future slices can migrate the comment system to read from structured state.
- **Unit tests omitted** — `.adw/project.md` has `## Unit Tests: disabled`. Enable it and add a follow-up task if runner unit tests are needed.
- **`PhaseResultStore.get<T>()`** uses an explicit bounded type assertion (`as T | undefined`). This is the standard TypeScript pattern for heterogeneous collections and satisfies the no-`any` requirement at orchestrator definition boundaries.
