# Feature: Wire stepDefPhase into orchestrators

## Metadata
issueNumber: `397`
adwId: `zqb2k1-wire-stepdefphase-in`
issueJson: `{"number":397,"title":"wire stepDefPhase into orchestrators","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nThe existing `adws/phases/stepDefPhase.ts` is dead code — exported but never called by any orchestrator. Wire it into the orchestrators that use scenarios so step definitions are generated against built code (rather than against a phantom interface) and exist before scenarios run.\n\nUpdate these orchestrators to insert `executeStepDefPhase` between the build phase and the test phase:\n- `adwSdlc.tsx`\n- `adwPlanBuildTest.tsx`\n- `adwPlanBuildTestReview.tsx`\n- `adwChore.tsx`\n- `adwPrReview.tsx`\n\nEach orchestrator gets a single new line: `await runPhase(config, tracker, executeStepDefPhase);`\n\nPre-requisite for slice 6 (scenario test phase), which needs step defs ready before scenarios execute.\n\n## Acceptance criteria\n\n- [ ] `executeStepDefPhase` called from `adwSdlc.tsx` between build and test phases\n- [ ] Same wiring in `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`, `adwChore.tsx`, `adwPrReview.tsx`\n- [ ] Phase appears in workflow state ledger (top-level state file)\n- [ ] Existing tests still pass\n- [ ] Manual smoke test: run an SDLC workflow against a feature issue with `@adw-{N}` scenarios, confirm step definitions are written before the test phase runs\n\n## User stories addressed\n\n- User story 29\n- User story 30","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:03:44Z","comments":[],"actionableComment":null}`

## Feature Description
The `executeStepDefPhase` in `adws/phases/stepDefPhase.ts` is fully implemented and exported through `adws/phases/index.ts` and `adws/workflowPhases.ts`, but no orchestrator calls it. This feature wires it into the five orchestrators that run build+test workflows so that BDD step definitions are generated after code is built (against real code, not phantom interfaces) and before any test or review phase consumes them.

## User Story
As an ADW workflow operator
I want step definitions to be auto-generated between the build and test phases
So that BDD scenarios have matching step definition files before they execute

## Problem Statement
`executeStepDefPhase` is dead code. Orchestrators that run BDD scenarios currently lack step definition generation, meaning scenarios either fail at execution time or require manually pre-written step definitions. This blocks slice 6 (scenario test phase) from working end-to-end.

## Solution Statement
Insert a single `await runPhase(config, tracker, executeStepDefPhase, 'step-def')` call between the build phase and the test phase in each of the five target orchestrators. Pass the `'step-def'` phase name so `runPhase` records the phase in the top-level state ledger (enabling skip-on-resume and status tracking). For `adwPrReview.tsx`, which uses a different config type (`PRReviewWorkflowConfig`) and manual cost management instead of `CostTracker`, call `executeStepDefPhase` inline with manual cost accumulation — matching the existing pattern used for the install phase in that orchestrator.

## Relevant Files
Use these files to implement the feature:

- `adws/phases/stepDefPhase.ts` — the phase implementation to be wired in; already exports `executeStepDefPhase`
- `adws/phases/index.ts` — re-exports `executeStepDefPhase` (already wired)
- `adws/workflowPhases.ts` — re-exports `executeStepDefPhase` from phases (already wired)
- `adws/core/phaseRunner.ts` — `runPhase`, `CostTracker`, phase name tracking; no changes needed
- `adws/adwSdlc.tsx` — SDLC orchestrator; add step-def phase between build and test
- `adws/adwPlanBuildTest.tsx` — Plan+Build+Test orchestrator; add step-def phase between build and test
- `adws/adwPlanBuildTestReview.tsx` — Plan+Build+Test+Review orchestrator; add step-def phase between build and test
- `adws/adwChore.tsx` — Chore orchestrator; add step-def phase between build and test
- `adws/adwPrReview.tsx` — PR Review orchestrator; add step-def phase between build and test (inline pattern due to different config type)
- `adws/agents/stepDefAgent.ts` — underlying agent called by `executeStepDefPhase`; read-only reference
- `guidelines/coding_guidelines.md` — coding guidelines to follow

## Implementation Plan
### Phase 1: Foundation
No foundation work required. `executeStepDefPhase` is already fully implemented, exported through `adws/phases/index.ts`, and re-exported through `adws/workflowPhases.ts`. The `runPhase` infrastructure already supports the optional `phaseName` parameter for state ledger tracking.

### Phase 2: Core Implementation
Wire `executeStepDefPhase` into each orchestrator:
1. **Four `CostTracker`-based orchestrators** (`adwSdlc`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`): Add `executeStepDefPhase` to the import list from `./workflowPhases`, then insert `await runPhase(config, tracker, executeStepDefPhase, 'step-def');` on the line after `executeBuildPhase` and before `executeTestPhase`.
2. **`adwPrReview.tsx`**: This orchestrator uses `PRReviewWorkflowConfig` (not `WorkflowConfig`) and manual cost management. Call `executeStepDefPhase` inline between the build and test phases using manual cost accumulation — matching the install-phase inline pattern already in this file. The `PRReviewWorkflowConfig` shares enough fields (`orchestratorStatePath`, `adwId`, `worktreePath`, `logsDir`, `installContext`) that a lightweight adapter object satisfying `WorkflowConfig` can be constructed. Alternatively, `runStepDefAgent` can be called directly if adapting configs proves fragile.

### Phase 3: Integration
- Pass `'step-def'` as the fourth argument to `runPhase` so the phase appears in the top-level state file's `phases` map, satisfying the state-ledger acceptance criterion.
- The phase is non-fatal by design (`stepDefPhase.ts` catches all errors and returns `{ costUsd: 0, ... }`), so wiring it in carries no regression risk to existing orchestrator flows.

## Step by Step Tasks

### Step 1: Wire `executeStepDefPhase` into `adwSdlc.tsx`
- Add `executeStepDefPhase` to the import from `'./workflowPhases'`
- Insert `await runPhase(config, tracker, executeStepDefPhase, 'step-def');` on the line after `await runPhase(config, tracker, executeBuildPhase);` (line 83) and before `const testResult = await runPhase(config, tracker, executeTestPhase);` (line 84)

### Step 2: Wire `executeStepDefPhase` into `adwPlanBuildTest.tsx`
- Add `executeStepDefPhase` to the import from `'./workflowPhases'`
- Insert `await runPhase(config, tracker, executeStepDefPhase, 'step-def');` on the line after `await runPhase(config, tracker, executeBuildPhase);` (line 62) and before `const testResult = await runPhase(config, tracker, executeTestPhase);` (line 63)

### Step 3: Wire `executeStepDefPhase` into `adwPlanBuildTestReview.tsx`
- Add `executeStepDefPhase` to the import from `'./workflowPhases'`
- Insert `await runPhase(config, tracker, executeStepDefPhase, 'step-def');` on the line after `await runPhase(config, tracker, executeBuildPhase);` (line 73) and before `const testResult = await runPhase(config, tracker, executeTestPhase);` (line 74)

### Step 4: Wire `executeStepDefPhase` into `adwChore.tsx`
- Add `executeStepDefPhase` to the import from `'./workflowPhases'`
- Insert `await runPhase(config, tracker, executeStepDefPhase, 'step-def');` on the line after `await runPhase(config, tracker, executeBuildPhase);` (line 91) and before `const testResult = await runPhase(config, tracker, executeTestPhase);` (line 92)

### Step 5: Wire `executeStepDefPhase` into `adwPrReview.tsx`
- Import `executeStepDefPhase` from `'./workflowPhases'` and `emptyModelUsageMap` from `'./core'`
- Between `executePRReviewBuildPhase` and `executePRReviewTestPhase` (after the build cost accumulation block around line 91, before the test phase call around line 93), add an inline step-def call:
  - Construct a minimal `WorkflowConfig`-compatible object from the `PRReviewWorkflowConfig` fields. The `executeStepDefPhase` uses: `orchestratorStatePath`, `adwId`, `issueNumber`, `issue.body`, `worktreePath`, `logsDir`, `installContext`. Map `config.prDetails.body` to `issue.body` and `config.issueNumber ?? config.prNumber` to `issueNumber`.
  - Call `executeStepDefPhase` with this adapter, accumulate `costUsd` and `modelUsage` into the running totals, and persist token counts — identical to the existing install-phase inline pattern.
  - Wrap in try/catch to keep it non-fatal (matching the phase's own error handling)

### Step 6: Run validation commands
- Run `bun run lint` to check for linting issues
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type-checking passes
- Run `bun run test` to verify existing tests still pass

## Testing Strategy
### Unit Tests
The existing `adws/core/__tests__/phaseRunner.test.ts` already tests the `runPhase` mechanics (skip-on-resume, state recording, cost accumulation). No new unit tests are needed — the change is pure wiring (adding a single function call per orchestrator). The `executeStepDefPhase` function itself already handles errors internally and is tested via its own error paths.

### Edge Cases
- **Phase already completed on resume**: `runPhase` with `phaseName: 'step-def'` will skip the phase if the top-level state already records it as `completed` — no special handling needed.
- **Step-def agent failure**: `executeStepDefPhase` catches all errors internally and returns `{ costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] }` — the orchestrator continues unaffected.
- **No BDD scenarios in target repo**: The step-def agent will find no `.feature` files and return early (non-fatal).
- **`adwPrReview` null issueNumber**: `PRReviewWorkflowConfig.issueNumber` is `number | null`. The adapter should fall back to `prNumber` as a numeric identifier for cost tracking.

## Acceptance Criteria
- `executeStepDefPhase` is called in `adwSdlc.tsx` between `executeBuildPhase` and `executeTestPhase`
- `executeStepDefPhase` is called in `adwPlanBuildTest.tsx` between `executeBuildPhase` and `executeTestPhase`
- `executeStepDefPhase` is called in `adwPlanBuildTestReview.tsx` between `executeBuildPhase` and `executeTestPhase`
- `executeStepDefPhase` is called in `adwChore.tsx` between `executeBuildPhase` and `executeTestPhase`
- `executeStepDefPhase` is called in `adwPrReview.tsx` between `executePRReviewBuildPhase` and `executePRReviewTestPhase`
- Phase is tracked in the top-level state file via `phaseName: 'step-def'` (recorded by `runPhase` as `step-def_running` / `step-def_completed`)
- `bun run lint` passes with no new errors
- `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass
- `bun run test` passes with no regressions

## Validation Commands
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws subproject
- `bun run test` — Run existing Vitest tests to verify zero regressions

## Notes
- The `adwPrReview.tsx` wiring is the only non-trivial change due to the `PRReviewWorkflowConfig` vs `WorkflowConfig` type mismatch. The adapter pattern keeps the change minimal. If the adapter feels fragile during implementation, fall back to calling `runStepDefAgent` directly (same pattern as the inline install phase).
- The four `CostTracker`-based orchestrators currently do not pass `phaseName` strings to their existing `runPhase` calls. This issue only adds `'step-def'` to the new call. Adding phase names to existing calls is out of scope.
- This is a pre-requisite for slice 6 (scenario test phase). Once wired, step definitions will exist in the worktree before any scenario execution phase runs.
- Follow `guidelines/coding_guidelines.md` strictly — in particular, keep changes minimal and focused.
