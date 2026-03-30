# Branch Primitive + adwChore Declarative Migration

**ADW ID:** tcff7s-refactor-runner-bran
**Date:** 2026-03-30
**Specification:** specs/issue-349-adw-tcff7s-refactor-runner-bran-sdlc_planner-branch-primitive-adwchore-migration.md

## Overview

Adds the `branch()` composition primitive to the declarative orchestrator runner, enabling conditional phase execution driven by typed predicates over accumulated phase results. `adwChore.tsx` is migrated from imperative `if/else` boilerplate to a declarative definition that uses `branch()` to route on the diff evaluation verdict.

## What Was Built

- `BranchPhaseDefinition` interface — typed branch node with a predicate, true branch, and false branch
- `PhaseEntry` discriminated union (`PhaseDefinition | BranchPhaseDefinition`) — unified type for the `phases` array
- `branch()` helper function — ergonomic factory for constructing `BranchPhaseDefinition` at the call site
- Updated `runOrchestrator()` — detects branch entries via `isBranchPhase()` type guard and executes the matching branch sequentially
- `DiffEvalPhaseState` interface — structured state for the diff evaluation verdict (`'safe' | 'regression_possible'`)
- `PhaseResultStore` class — typed runtime map for reading phase results with a bounded generic `get<T>()` accessor
- Declarative `adwChore.tsx` — replaces ~50 lines of imperative orchestrator with `defineOrchestrator()` + `branch()` on `diffEvaluation` verdict

## Technical Implementation

### Files Modified

- `adws/core/orchestratorRunner.ts` *(new)*: Adds `BranchPhaseDefinition`, `PhaseEntry`, `branch()`, `isBranchPhase()` type guard, `defineOrchestrator()`, and branch execution logic inside `runOrchestrator()`
- `adws/types/workflowState.ts` *(new)*: Defines per-phase state interfaces (`InstallPhaseState`, `PlanPhaseState`, `BuildPhaseState`, `TestPhaseState`, `PRPhaseState`, `DiffEvalPhaseState`), the `WorkflowState` aggregate, and the `PhaseResultStore` class
- `adws/adwChore.tsx` *(new)*: Declarative chore pipeline — install → plan → build → test → pr → diffEvaluation → `branch('diff-verdict', …)`
- `adws/core/index.ts`: Exports `BranchPhaseDefinition`, `PhaseEntry`, `OrchestratorDefinition`, `branch`, and `defineOrchestrator` from the barrel; also adds `PhaseResultStore` re-export path via `workflowState`

### Key Changes

- **Discriminated union dispatch** — `runOrchestrator()` loops over `PhaseEntry[]`; if `entry.type === 'branch'` it calls `entry.predicate(results)` and iterates the selected branch's phases, otherwise falls through to the existing `runPhase()` call
- **`PhaseResultStore`** — orchestrators accumulate phase return values in a `Map<string, PhaseResult>` wrapper; predicates and `completionMetadata` callbacks call `results.get<T>(phaseName)` for typed access without `any`
- **`DiffEvalPhaseState`** captures `verdict: 'safe' | 'regression_possible'` so branch predicates can read the diff outcome with full type safety
- **`executeEscalationCommentPhase`** — the previous inline `postEscalationComment()` call is converted into a zero-cost `PhaseFn` so it can live in the declarative phase list
- **Backward compatibility** — existing orchestrators (`adwPlanBuild.tsx`) work unchanged because `PhaseDefinition.type` is optional; entries without `type: 'branch'` are treated as regular sequential phases

## How to Use

### Defining a branch in an orchestrator

```typescript
import { defineOrchestrator, runOrchestrator, branch } from './core/orchestratorRunner';
import type { DiffEvaluationPhaseResult } from './workflowPhases';

runOrchestrator(defineOrchestrator({
  id: OrchestratorId.Chore,
  scriptName: 'adwChore.tsx',
  usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
  phases: [
    { name: 'diffEvaluation', execute: executeDiffEvaluationPhase },
    branch(
      'diff-verdict',
      (results) => results.get<DiffEvaluationPhaseResult>('diffEvaluation')?.verdict === 'safe',
      [{ name: 'autoMerge', execute: executeAutoMergePhase }],
      [
        { name: 'escalation', execute: executeEscalationCommentPhase },
        { name: 'review',     execute: executeReviewPhase },
        { name: 'autoMerge',  execute: executeAutoMergePhase },
      ],
    ),
  ],
}));
```

### Reading branch results in completionMetadata

```typescript
completionMetadata: (results) => {
  const diff = results.get<DiffEvaluationPhaseResult>('diffEvaluation');
  return { diffVerdict: diff?.verdict ?? 'regression_possible' };
},
```

### CLI smoke test

```bash
bunx tsx adws/adwChore.tsx --help
```

## Configuration

No new environment variables. The branch primitive is controlled entirely by the predicate passed to `branch()` — it reads from the `PhaseResultStore` populated at runtime.

## Testing

```bash
bunx tsc --noEmit                          # root type-check
bunx tsc --noEmit -p adws/tsconfig.json   # adws type-check
bun run lint                               # linter
bunx tsx adws/adwChore.tsx --help          # CLI smoke test
bunx tsx adws/adwPlanBuild.tsx --help      # regression check — existing declarative orchestrator
```

## Notes

- The `branch()` primitive supports only boolean (two-way) branching. Multi-way branching can be composed by nesting `branch()` calls or added as a future `match()` primitive.
- Branch phases are logged: `Branch 'diff-verdict': took true path` — useful for tracing which path was executed in run logs.
- `PhaseResultStore` stores the raw `PhaseResult` returned by each phase function. Phase functions may return additional typed fields beyond the base `{ costUsd, modelUsage, phaseCostRecords }` — those extra fields are accessible via the typed `get<T>()` accessor.
- The `DiffEvalPhaseState` interface in `workflowState.ts` mirrors the `verdict` field on `DiffEvaluationPhaseResult` in `phases/diffEvaluationPhase.ts`. The store holds the phase function return value directly; `DiffEvalPhaseState` exists as a semantic structured-state record for documentation purposes.
