# Declarative Orchestrator Runner — Structured State Refactor

**ADW ID:** 2mxfnj-refactor-structured
**Date:** 2026-03-30
**Specification:** specs/issue-346-adw-adw-unknown-sdlc_planner-declarative-orchestration-tracer-bullet.md

## Overview

This feature refines the declarative orchestrator runner (`orchestratorRunner.ts`) and introduces `WorkflowPhaseState` — a namespaced, JSON-serializable state container that replaces the flat `WorkflowContext` for orchestrators opting into the new API. It removes the `runPhaseWithContinuation` / `onTokenLimit` continuation pattern in favour of self-contained token-limit recovery inside `buildPhase.ts`, and hardens `defineOrchestrator()` with duplicate-name and empty-phase validation.

## What Was Built

- `WorkflowPhaseState` interface with namespaced sub-interfaces (`InstallPhaseState`, `PlanPhaseState`, `BuildPhaseState`, `TestPhaseState`, `PRPhaseState`) and a `createEmptyPhaseState()` factory
- `PhaseDescriptor` (renamed from `PhaseDefinition`) with an optional `completionMetadata` callback per phase replacing the top-level-only callback
- `defineOrchestrator()` now validates uniqueness and non-emptiness of phases and returns a frozen object
- `runOrchestrator()` initialises `config.phaseState` and accumulates per-phase `completionMetadata` into a merged map
- Self-contained token-limit recovery loop inside `executeBuildPhase()` (up to `MAX_CONTEXT_RESETS` iterations), removing external `buildPhaseOnTokenLimit` + `runPhaseWithContinuation` dependency
- `WorkflowState` marked `@deprecated` — new orchestrators should use `WorkflowPhaseState`
- `PhaseDefinition` kept as a `@deprecated` type alias for `PhaseDescriptor` for backward compatibility
- New BDD feature file `declarativeOrchestratorStructuredState.feature` with step definitions

## Technical Implementation

### Files Modified

- `adws/core/orchestratorRunner.ts`: Renamed `PhaseDefinition` → `PhaseDescriptor`; added per-phase `completionMetadata`; added validation in `defineOrchestrator()`; runner now seeds `config.phaseState` via `createEmptyPhaseState()`; removed `runPhaseWithContinuation` and `isBranchPhase` helper; `branch()` helper updated to use `PhaseDescriptor`
- `adws/types/workflowState.ts`: Added `WorkflowPhaseState`, `createEmptyPhaseState()`; relaxed readonly modifiers on per-phase state interfaces to optional mutability; added `buildProgress` field to `BuildPhaseState`; added `issueType` and `planOutput` to `PlanPhaseState`; deprecated `WorkflowState`
- `adws/phases/buildPhase.ts`: Removed external continuation pattern; added internal `contextResetCount` loop up to `MAX_CONTEXT_RESETS`; reads plan from file (no `config.continuationPrompt` fallback); return type no longer includes `PhaseResult` union
- `adws/adwPlanBuild.tsx`: Moved `completionMetadata` from orchestrator-level to per-phase `completionMetadata` on the `test` descriptor; removed `buildPhaseOnTokenLimit` import
- `adws/adwChore.tsx`, `adws/adwBuild.tsx`, `adws/adwSdlc.tsx`, `adws/adwPatch.tsx` and other orchestrators: Removed `buildPhaseOnTokenLimit` and `runPhaseWithContinuation` imports; use plain `runPhase` for the build phase
- `adws/core/index.ts`: Updated re-exports (`PhaseDescriptor`, `createEmptyPhaseState`)
- `adws/phases/installPhase.ts`, `planPhase.ts`, `testPhase.ts`, `prPhase.ts`: Minor additions populating `config.phaseState.*` namespaced fields
- `features/declarativeOrchestratorStructuredState.feature`: New BDD scenarios covering `WorkflowPhaseState` contract, `defineOrchestrator()` validation, runner behaviour, and phase state threading
- `features/step_definitions/declarativeOrchestratorStructuredStateSteps.ts`: Step definitions for the above feature
- `features/runner_token_limit_continuation.feature` + related spec/doc: Removed (superseded by self-contained build recovery)

### Key Changes

- **Token-limit recovery is now self-contained** in `buildPhase.ts`. The orchestrator runner no longer needs to know about continuation semantics — `buildPhaseOnTokenLimit` and `runPhaseWithContinuation` are gone.
- **`defineOrchestrator()` validates at definition time** — throws on empty phase list or duplicate phase names, and returns a frozen definition object.
- **`WorkflowPhaseState` is the forward path** — `config.phaseState` is populated by the runner before the first phase runs; individual phases can read/write it for inter-phase data flow.
- **Per-phase `completionMetadata`** lets each `PhaseDescriptor` declare its own contribution to the final completion record, removing the need for a monolithic top-level callback in most cases.
- **Backward compatibility preserved** — `PhaseDefinition` type alias, `executeXxxPhase` wrappers, and the legacy `WorkflowState` type remain functional for orchestrators not yet migrated.

## How to Use

### Defining a new declarative orchestrator

```ts
import { defineOrchestrator, runOrchestrator, OrchestratorId } from './core';
import { executeInstallPhase, executePlanPhase, executeBuildPhase, executeTestPhase, executePRPhase } from './workflowPhases';

runOrchestrator(defineOrchestrator({
  id: OrchestratorId.PlanBuild,
  scriptName: 'adwPlanBuild.tsx',
  usagePattern: '<issueNumber> [adw-id]',
  phases: [
    { name: 'install', execute: executeInstallPhase },
    { name: 'plan',    execute: executePlanPhase },
    { name: 'build',   execute: executeBuildPhase },
    {
      name: 'test',
      execute: executeTestPhase,
      completionMetadata: (r) => ({ unitTestsPassed: (r as any).unitTestsPassed }),
    },
    { name: 'pr', execute: executePRPhase },
  ],
}));
```

### Reading namespaced state inside a phase

```ts
export async function executePRPhase(config: WorkflowConfig): Promise<PhaseResult> {
  const planState = config.phaseState?.plan;
  const branchName = planState?.branchName ?? config.ctx.branchName;
  // ...
}
```

### Using the `branch()` helper

```ts
import { branch } from './core/orchestratorRunner';

phases: [
  { name: 'diffEvaluation', execute: executeDiffEvaluationPhase },
  branch(
    'safetyCheck',
    (results) => results.get('diffEvaluation')?.verdict === 'safe',
    [{ name: 'pr', execute: executePRPhase }],
    [{ name: 'review', execute: executeReviewPhase }],
  ),
]
```

## Configuration

No new environment variables. `config.phaseState` (type `WorkflowPhaseState`) is automatically initialised by `runOrchestrator()` before the first phase executes.

## Testing

```bash
# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# BDD scenarios
bun run test --feature declarativeOrchestratorStructuredState
```

## Notes

- `WorkflowState` and `PhaseDefinition` are deprecated but not removed — they remain for the 13 orchestrators not yet migrated to the declarative runner.
- The `runner_token_limit_continuation` feature file and its spec were deleted; the contract is now covered by `declarativeOrchestratorStructuredState.feature`.
- Future orchestrator migrations should use `WorkflowPhaseState` and per-phase `completionMetadata` rather than a top-level `completionMetadata` callback.
