# Feature: Runner branch() Primitive + adwChore Migration

## Metadata
issueNumber: `349`
adwId: `tcff7s-refactor-runner-bran`
issueJson: `{"number":349,"title":"refactor: runner branch() primitive + adwChore migration","body":"## Parent PRD\n\n`specs/prd/declarative-orchestration-architecture.md`\n\n## What to build\n\nAdd the `branch()` composition primitive to the declarative orchestrator runner, then migrate `adwChore.tsx` to a declarative definition.\n\n**`branch()`** — takes a predicate function that reads structured state, plus two phase lists (true path and false path). The runner evaluates the predicate after the preceding phase completes and follows the matching branch.\n\n**`adwChore.tsx` migration** — replace the hand-written orchestrator. The chore pipeline runs: install → plan → build → test → PR → diff evaluation, then branches on `state.diffEval.verdict`:\n- `safe` → auto-merge only\n- `regression_possible` → escalation comment → review → document → auto-merge\n\nAdd structured state namespace for `diffEval` (verdict, output).\n\n## Acceptance criteria\n\n- [ ] `branch()` primitive implemented — predicate reads structured state, runner follows matching path\n- [ ] `branch()` is fully typed — predicate receives typed state, both branches are typed phase lists\n- [ ] `adwChore.tsx` replaced with declarative definition using branch on diff verdict\n- [ ] Diff evaluation phase writes to `state.diffEval.verdict`\n- [ ] Branch predicate reads `state.diffEval.verdict` to choose safe vs regression path\n- [ ] `bunx tsx adws/adwChore.tsx <issueNumber>` works end-to-end with correct branching\n- [ ] Runner unit tests for branch primitive (true path, false path)\n\n## Blocked by\n\n- Blocked by #346 (declarative runner foundation)\n\n## User stories addressed\n\n- User story 2 (control flow visible in declaration)\n- User story 7 (branch in declaration for conditional logic)\n\n/feature","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-30T08:31:46Z","comments":[],"actionableComment":null}`

## Feature Description
Add the `branch()` composition primitive to the declarative orchestrator runner (`adws/core/orchestratorRunner.ts`), then migrate `adwChore.tsx` from its imperative hand-written orchestrator to a declarative definition that uses `branch()` for the diff-verdict conditional path.

The `branch()` primitive takes a predicate function that reads the `PhaseResultStore`, plus two phase lists (true path and false path). After the preceding phase completes, the runner evaluates the predicate and executes the matching branch's phases sequentially.

The `adwChore.tsx` migration replaces ~50 lines of imperative boilerplate with a declarative definition: install → plan → build → test → PR → diff evaluation → `branch(verdict === 'safe', [autoMerge], [escalation, review, document, autoMerge])`.

A new `DiffEvalPhaseState` structured state interface captures the diff evaluation verdict, enabling the branch predicate to read `state.diffEval.verdict`.

## User Story
As a developer defining orchestrators
I want to use `branch()` in the declaration to express conditional logic
So that control flow is visible in the orchestrator definition, not hidden inside imperative code

## Problem Statement
The current `adwChore.tsx` uses imperative `if/else` branching on `diffResult.verdict` after calling `runPhase()` manually. This hides control flow inside procedural code, duplicates the CLI parsing / CostTracker / error handling boilerplate, and makes it harder to understand the pipeline at a glance. The declarative runner (`orchestratorRunner.ts`) supports only sequential phases — there is no way to express conditional branching in a declaration.

## Solution Statement
1. Add a `BranchPhaseDefinition` type to `orchestratorRunner.ts` representing a branch node in the phase list. It contains a predicate `(results: PhaseResultStore) => boolean`, a `trueBranch` phase list, and a `falseBranch` phase list.
2. Extend the `OrchestratorDefinition.phases` array to accept both `PhaseDefinition` and `BranchPhaseDefinition` via a discriminated union (`PhaseEntry`).
3. Update `runOrchestrator()` to detect branch entries (via a `type` discriminant or helper function) and execute the matching branch's phases.
4. Add a `DiffEvalPhaseState` interface to `workflowState.ts` and add `diffEval` to `WorkflowState`.
5. Migrate `adwChore.tsx` to use `defineOrchestrator()` + `runOrchestrator()` with a `branch()` call for the diff verdict split.
6. Provide a `branch()` helper function for ergonomic definition-site usage.

## Relevant Files
Use these files to implement the feature:

- `adws/core/orchestratorRunner.ts` — The declarative runner. Add `BranchPhaseDefinition`, `PhaseEntry` union, `branch()` helper, and branch execution logic in `runOrchestrator()`.
- `adws/types/workflowState.ts` — Structured state types. Add `DiffEvalPhaseState` interface and extend `WorkflowState`.
- `adws/adwChore.tsx` — The imperative chore orchestrator to replace with a declarative definition.
- `adws/core/phaseRunner.ts` — `PhaseResult`, `PhaseFn`, `runPhase()` — branch phases must produce/consume these types.
- `adws/core/constants.ts` — `OrchestratorId.Chore` constant used by the new declarative definition.
- `adws/workflowPhases.ts` — Re-exports phase functions (`executeDiffEvaluationPhase`, `executeAutoMergePhase`, etc.) consumed by the migration.
- `adws/phases/diffEvaluationPhase.ts` — `DiffEvaluationPhaseResult` type definition (has `verdict` field).
- `adws/phases/autoMergePhase.ts` — Auto-merge phase used in both branches.
- `adws/phases/workflowCompletion.ts` — `executeReviewPhase`, `completeWorkflow`, `handleWorkflowError`.
- `adws/phases/documentPhase.ts` — `executeDocumentPhase` used in the regression path.
- `adws/core/index.ts` — Barrel exports. Update to export new types (`BranchPhaseDefinition`, `PhaseEntry`, `branch`).
- `adws/types/index.ts` — Barrel exports for types. Update to export `DiffEvalPhaseState`.
- `adws/adwPlanBuild.tsx` — Reference declarative orchestrator pattern (already migrated).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-modak4-refactor-structured-declarative-orchestrator-runner.md` — Conditional doc: declarative runner architecture and patterns.

### New Files
None — all changes are modifications to existing files.

## Implementation Plan
### Phase 1: Foundation — Types and State
Add the `DiffEvalPhaseState` interface to structured state types, and define the `BranchPhaseDefinition` type plus the `PhaseEntry` discriminated union in the orchestrator runner.

### Phase 2: Core Implementation — branch() Primitive
Implement the `branch()` helper function and update `runOrchestrator()` to handle branch entries by evaluating the predicate against the `PhaseResultStore` and executing the matching branch's phases sequentially.

### Phase 3: Integration — adwChore Migration
Replace `adwChore.tsx` with a declarative definition using `defineOrchestrator()` + `runOrchestrator()`. The escalation comment logic is extracted into a lightweight phase function that conforms to `PhaseFn`. The branch predicate reads `diffEval` verdict from the `PhaseResultStore`.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add DiffEvalPhaseState to structured state types
- Open `adws/types/workflowState.ts`
- Add a `DiffEvalPhaseState` interface with:
  - `readonly verdict: 'safe' | 'regression_possible'` — the diff evaluation verdict
- Add `readonly diffEval?: DiffEvalPhaseState` to the `WorkflowState` aggregate interface
- Open `adws/types/index.ts` and export `DiffEvalPhaseState`

### Step 2: Add BranchPhaseDefinition and PhaseEntry union to orchestratorRunner.ts
- Open `adws/core/orchestratorRunner.ts`
- Define `BranchPhaseDefinition` interface:
  - `readonly type: 'branch'` — discriminant field
  - `readonly name: string` — display name for the branch decision point
  - `readonly predicate: (results: PhaseResultStore) => boolean` — evaluates to pick a branch
  - `readonly trueBranch: ReadonlyArray<PhaseDefinition>` — phases when predicate is true
  - `readonly falseBranch: ReadonlyArray<PhaseDefinition>` — phases when predicate is false
- Add `readonly type?: 'phase'` to the existing `PhaseDefinition` (optional for backward compatibility, defaults to `'phase'`)
- Define `PhaseEntry = PhaseDefinition | BranchPhaseDefinition` union type
- Update `OrchestratorDefinition.phases` from `ReadonlyArray<PhaseDefinition>` to `ReadonlyArray<PhaseEntry>`

### Step 3: Implement branch() helper function
- In `adws/core/orchestratorRunner.ts`, add a `branch()` function:
  ```typescript
  export function branch(
    name: string,
    predicate: (results: PhaseResultStore) => boolean,
    trueBranch: ReadonlyArray<PhaseDefinition>,
    falseBranch: ReadonlyArray<PhaseDefinition>,
  ): BranchPhaseDefinition
  ```
- Returns `{ type: 'branch', name, predicate, trueBranch, falseBranch }`

### Step 4: Update runOrchestrator() to handle branch entries
- In the phase execution loop inside `runOrchestrator()`, detect whether a `PhaseEntry` is a branch (check `entry.type === 'branch'` or use a type guard `isBranchPhase()`).
- For branch entries:
  1. Evaluate `entry.predicate(results)` to get a boolean
  2. Select `entry.trueBranch` or `entry.falseBranch` based on the predicate result
  3. Execute the selected branch's phases sequentially using the same `runPhase()` / results accumulation pattern
  4. Log which branch was taken (e.g., `Branch '${entry.name}': took ${predicate ? 'true' : 'false'} path`)
- For regular phase entries: existing behavior unchanged

### Step 5: Update barrel exports in core/index.ts
- Open `adws/core/index.ts`
- Add exports for `BranchPhaseDefinition`, `PhaseEntry`, and `branch` from `./orchestratorRunner`

### Step 6: Migrate adwChore.tsx to declarative definition
- Replace the entire contents of `adws/adwChore.tsx` with a declarative definition:
  - Import `OrchestratorId` from `./core`
  - Import `defineOrchestrator`, `runOrchestrator`, `branch` from `./core/orchestratorRunner`
  - Import phase functions from `./workflowPhases`
  - Create an `executeEscalationCommentPhase` function conforming to `PhaseFn`:
    - Moves the existing `postEscalationComment()` logic into a phase that returns `{ costUsd: 0, modelUsage: {}, phaseCostRecords: [] }`
    - Uses `emptyModelUsageMap()` for the model usage
  - Define the orchestrator with `defineOrchestrator()`:
    - `id: OrchestratorId.Chore`
    - `scriptName: 'adwChore.tsx'`
    - `usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]'`
    - Sequential phases: install, plan, build, test, pr, diffEvaluation
    - `branch('diff-verdict', predicate, trueBranch, falseBranch)`:
      - Predicate: reads `DiffEvaluationPhaseResult` from results store at key `'diffEvaluation'`, returns `result?.verdict === 'safe'`
      - True branch (safe): `[{ name: 'autoMerge', execute: executeAutoMergePhase }]`
      - False branch (regression_possible): `[{ name: 'escalation', execute: executeEscalationCommentPhase }, { name: 'review', execute: executeReviewPhase }, { name: 'document', execute: (cfg) => executeDocumentPhase(cfg) }, { name: 'autoMerge', execute: executeAutoMergePhase }]`
    - `completionMetadata` callback: extract test results and diff verdict from the `PhaseResultStore`, plus review results when on the regression path

### Step 7: Validate type checking and linting
- Run `bunx tsc --noEmit` to validate root type-checking
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to validate adws type-checking
- Run `bun run lint` to validate code style
- Run `bunx tsx adws/adwChore.tsx --help` to validate CLI smoke test

## Testing Strategy
### Edge Cases
- Branch predicate returns `true` — runner executes only the true branch phases
- Branch predicate returns `false` — runner executes only the false branch phases
- Branch with empty true or false branch (no phases) — runner should handle gracefully
- Multiple sequential branches in a single orchestrator definition
- Branch nested inside branch (not required by this issue, but the type system should not prevent it)
- Phase before branch writes result that the branch predicate reads — timing must be correct (predicate evaluates after preceding phase completes)
- Diff evaluation returns 'safe' — chore pipeline auto-merges without review
- Diff evaluation returns 'regression_possible' — chore pipeline escalates to review+document+autoMerge
- Diff evaluation fails (defaults to 'regression_possible') — chore pipeline escalates

## Acceptance Criteria
- `branch()` helper function exists in `adws/core/orchestratorRunner.ts` and returns a `BranchPhaseDefinition`
- `BranchPhaseDefinition` is fully typed: predicate receives `PhaseResultStore`, both branches are typed `ReadonlyArray<PhaseDefinition>`
- `runOrchestrator()` correctly evaluates branch predicates and executes the matching path
- `PhaseEntry` union type (`PhaseDefinition | BranchPhaseDefinition`) exported from barrel
- `DiffEvalPhaseState` with `verdict` field exists in `adws/types/workflowState.ts`
- `adwChore.tsx` is a declarative definition using `defineOrchestrator()` + `branch()`
- `adwChore.tsx` branch predicate reads diff verdict from `PhaseResultStore`
- `adwChore.tsx` safe path: autoMerge only
- `adwChore.tsx` regression path: escalation comment → review → document → autoMerge
- `bunx tsx adws/adwChore.tsx --help` prints usage without errors
- `bunx tsc --noEmit` passes
- `bunx tsc --noEmit -p adws/tsconfig.json` passes
- `bun run lint` passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type-check
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws module type-check
- `bunx tsx adws/adwChore.tsx --help` — CLI smoke test (prints usage, exits 0)
- `bunx tsx adws/adwPlanBuild.tsx --help` — Verify existing declarative orchestrator still works (no regression)

## Notes
- `.adw/project.md` has `## Unit Tests: disabled` — no unit test tasks included in this plan. Runner unit tests for branch primitive are listed in the issue's acceptance criteria but are out of scope given the project's testing policy (BDD scenarios are the validation mechanism).
- The `postEscalationComment` helper in the current `adwChore.tsx` is converted into a lightweight phase function (`executeEscalationCommentPhase`) that conforms to `PhaseFn` — returns `{ costUsd: 0, modelUsage, phaseCostRecords: [] }` with zero cost since it's just an API call.
- The `branch()` primitive is designed for simple boolean branching. Multi-way branching (switch-style) can be composed by nesting branches or added as a future `match()` primitive.
- Backward compatibility: adding optional `type?: 'phase'` to `PhaseDefinition` ensures existing orchestrators (like `adwPlanBuild.tsx`) work without modification — they don't set `type`, and the runner treats entries without `type: 'branch'` as regular phases.
- Follow `guidelines/coding_guidelines.md`: readonly properties, no `any`, explicit types at module boundaries, immutable data structures, declarative over imperative.
- Conditional doc `app_docs/feature-modak4-refactor-structured-declarative-orchestrator-runner.md` was consulted for the declarative runner patterns and conventions.
