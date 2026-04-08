# Feature: Wire scenarios into remaining orchestrators

## Metadata
issueNumber: `400`
adwId: `o1w8wg-wire-scenarios-into`
issueJson: `{"number":400,"title":"wire scenarios into remaining orchestrators","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nMigrate the four remaining orchestrators that have a test phase to use the new scenarioTestPhase + scenarioFixPhase from #399:\n- `adwPlanBuildTest.tsx`\n- `adwPlanBuildTestReview.tsx`\n- `adwChore.tsx`\n- `adwPrReview.tsx`\n\nEach orchestrator gets the same wiring as `adwSdlc.tsx` from #399: replace the old test phase with `unitTestPhase` + `scenarioTestPhase` + orchestrator-level retry loop calling `scenarioFixPhase` on failure.\n\nFor `adwPrReview.tsx`: this is also where PR review's test phase gets the same shape as the main workflow (US 17 from PRD). Uses `phaseRunner` from #398.\n\nAfter this slice, all orchestrators that use scenarios run them in the test phase, not in review. Review still calls `runReviewWithRetry` (with empty `scenariosMd`) — that's removed in the review rewrite slice.\n\n## Acceptance criteria\n\n- [ ] `adwPlanBuildTest.tsx` wires unitTestPhase + scenarioTestPhase + retry loop\n- [ ] `adwPlanBuildTestReview.tsx` same wiring\n- [ ] `adwChore.tsx` same wiring (with diff evaluator gate still applied)\n- [ ] `adwPrReview.tsx` same wiring (uses `phaseRunner` from #398)\n- [ ] All five orchestrators (including the SDLC one from #399) follow the same pattern\n- [ ] Existing tests still pass\n- [ ] Manual smoke test for at least one of: adwPlanBuildTest, adwChore, adwPrReview\n\n## Blocked by\n\n- Blocked by #398\n- Blocked by #399\n\n## User stories addressed\n\n- User story 6 (broader rollout to all orchestrators)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:04:52Z","comments":[],"actionableComment":null}`

## Feature Description
Migrate the four remaining orchestrators (`adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`, `adwChore.tsx`, `adwPrReview.tsx`) to use the new `scenarioTestPhase` + `scenarioFixPhase` wiring introduced in #399 for `adwSdlc.tsx`. After this change, all orchestrators that have a test phase will follow the same pattern: `unitTestPhase` -> `scenarioTestPhase` -> orchestrator-level retry loop calling `scenarioFixPhase` on failure. Review phases that previously ran scenarios themselves will receive empty `scenariosMd` and read the pre-written `scenario_proof.md` instead.

## User Story
As an ADW operator
I want all orchestrators with a test phase to use the unified scenario test/fix pattern
So that BDD scenario validation is consistent across all workflow types and failures are caught before review begins

## Problem Statement
After #399, only `adwSdlc.tsx` uses the new `scenarioTestPhase` + `scenarioFixPhase` pattern. The four remaining orchestrators (`adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`, `adwPrReview`) still use only `executeUnitTestPhase` without scenario testing, creating inconsistent validation across workflow types. `adwPlanBuildTestReview` still passes scenarios to review, making review responsible for both quality gating and scenario execution.

## Solution Statement
Apply the same wiring pattern from `adwSdlc.tsx` to each remaining orchestrator:
1. After `executeUnitTestPhase`, add the `scenarioTestPhase` -> `scenarioFixPhase` retry loop bounded by `MAX_TEST_RETRY_ATTEMPTS`.
2. For orchestrators with review (`adwPlanBuildTestReview`), patch `scenariosMd` to empty before calling review so review reads `scenario_proof.md` instead of running scenarios.
3. For `adwChore`, the diff evaluator gate remains — scenario testing runs before the diff evaluation, not conditionally inside the escalation branch.
4. For `adwPrReview`, replace the current `executePRReviewTestPhase` (which runs unit + E2E tests) with `executeUnitTestPhase` + `scenarioTestPhase` + retry loop, using the `config.base` pattern from #398.
5. Track `scenarioRetries` in orchestrator state metadata for all affected orchestrators.

## Relevant Files
Use these files to implement the feature:

- `adws/adwSdlc.tsx` — Reference implementation: the scenario test/fix retry loop pattern to replicate
- `adws/adwPlanBuildTest.tsx` — Target orchestrator: add scenario test/fix after unit tests, before PR
- `adws/adwPlanBuildTestReview.tsx` — Target orchestrator: add scenario test/fix after unit tests, patch scenariosMd before review
- `adws/adwChore.tsx` — Target orchestrator: add scenario test/fix after unit tests, before diff evaluation gate
- `adws/adwPrReview.tsx` — Target orchestrator: replace `executePRReviewTestPhase` with unit + scenario pattern
- `adws/phases/scenarioTestPhase.ts` — The `executeScenarioTestPhase` function to wire in
- `adws/phases/scenarioFixPhase.ts` — The `executeScenarioFixPhase` function to wire in
- `adws/phases/unitTestPhase.ts` — The `executeUnitTestPhase` already used by all orchestrators
- `adws/phases/prReviewPhase.ts` — PR review phase initialization and `PRReviewWorkflowConfig`
- `adws/phases/prReviewCompletion.ts` — Contains `executePRReviewTestPhase` (to be replaced)
- `adws/workflowPhases.ts` — Re-exports for workflow phases
- `adws/core/phaseRunner.ts` — `CostTracker`, `runPhase`, `PhaseResult` types
- `adws/core/constants.ts` — `OrchestratorId` constants
- `adws/core/config.ts` — `MAX_TEST_RETRY_ATTEMPTS`
- `adws/phases/index.ts` — Phase export barrel
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `app_docs/feature-1bg58c-scenario-test-fix-phases.md` — Documentation for scenario test/fix phases
- `app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md` — Documentation for PR review phaseRunner migration

## Implementation Plan
### Phase 1: Foundation
No new shared infrastructure is needed — `scenarioTestPhase`, `scenarioFixPhase`, and the `PhaseResult`-compatible `runPhase` infrastructure already exist from #398 and #399. The work is purely wiring: adding imports and composing existing phases in each orchestrator's `main()` function.

### Phase 2: Core Implementation
Wire the scenario test/fix retry loop into each of the four orchestrators, following the exact pattern established in `adwSdlc.tsx`:

1. **`adwPlanBuildTest.tsx`** — Simplest case: add scenario test/fix loop after `executeUnitTestPhase`, before `executePRPhase`. Add `scenarioRetries` to state metadata. Add `ScenarioProofResult` import and `executeScenarioTestPhase`/`executeScenarioFixPhase` imports.

2. **`adwPlanBuildTestReview.tsx`** — Same as above, plus patch `scenariosMd` to empty before calling `executeReviewPhase` (identical to the SDLC pattern). Add `scenarioRetries` to state metadata.

3. **`adwChore.tsx`** — Add scenario test/fix loop after `executeUnitTestPhase`, before `executeDiffEvaluationPhase`. The diff evaluator gate and conditional review/document escalation remain unchanged. Add `scenarioRetries` to state metadata.

4. **`adwPrReview.tsx`** — Replace the current `executePRReviewTestPhase` call with: `executeUnitTestPhase` (via `config.base`) + `scenarioTestPhase` (via `config.base`) + retry loop. This uses the closure-wrapper pattern from #398 since `runPhase` expects `WorkflowConfig`.

### Phase 3: Integration
- Update `adwPrReview.tsx` imports to no longer import `executePRReviewTestPhase` (dead code for this orchestrator — the function remains in `prReviewCompletion.ts` for backward compatibility but is no longer called by the orchestrator).
- Verify all five orchestrators follow the same test pattern visually.
- Run existing tests to confirm zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Wire scenario test/fix into `adwPlanBuildTest.tsx`
- Add imports: `executeScenarioTestPhase`, `executeScenarioFixPhase`, `MAX_TEST_RETRY_ATTEMPTS` from `./core`, `type ScenarioProofResult` from `./agents/regressionScenarioProof`, `type WorkflowConfig` from `./phases`
- Add `runPhasesParallel` import if needed for future scenario phase parallel execution (not needed here — `adwPlanBuildTest` has no scenario generation phase)
- After the existing `executeUnitTestPhase` call and before `executePRPhase`, add the scenario test/fix retry loop:
  ```ts
  let scenarioRetries = 0;
  for (let attempt = 0; attempt < MAX_TEST_RETRY_ATTEMPTS; attempt++) {
    const scenarioResult = await runPhase(config, tracker, executeScenarioTestPhase);
    if (!scenarioResult.scenarioProof?.hasBlockerFailures) break;
    scenarioRetries++;
    if (attempt < MAX_TEST_RETRY_ATTEMPTS - 1) {
      const fixWrapper = (cfg: WorkflowConfig) =>
        executeScenarioFixPhase(cfg, scenarioResult.scenarioProof!);
      await runPhase(config, tracker, fixWrapper);
    }
  }
  ```
- Update `completeWorkflow` metadata to include `scenarioRetries`
- Update the JSDoc workflow comment at top of file to reflect the new phase sequence

### Step 2: Wire scenario test/fix into `adwPlanBuildTestReview.tsx`
- Add imports: `executeScenarioTestPhase`, `executeScenarioFixPhase`, `MAX_TEST_RETRY_ATTEMPTS` (already imported from `./core`), `type ScenarioProofResult` from `./agents/regressionScenarioProof`, `type WorkflowConfig` from `./phases`
- After the existing `executeUnitTestPhase` call, add the same scenario test/fix retry loop
- Before the `executeReviewPhase` call, patch `scenariosMd` to empty (same pattern as `adwSdlc.tsx`):
  ```ts
  const executeReviewWithoutScenarios = (cfg: WorkflowConfig) => {
    const patchedConfig = { ...cfg, projectConfig: { ...cfg.projectConfig, scenariosMd: '' } };
    return executeReviewPhase(patchedConfig);
  };
  const reviewResult = await runPhase(config, tracker, executeReviewWithoutScenarios);
  ```
- Add `scenarioRetries` to the state metadata written after the workflow completes
- Update the JSDoc workflow comment at top of file

### Step 3: Wire scenario test/fix into `adwChore.tsx`
- Add imports: `executeScenarioTestPhase`, `executeScenarioFixPhase`, `MAX_TEST_RETRY_ATTEMPTS` (already in `./core`), `type ScenarioProofResult` from `./agents/regressionScenarioProof`, `type WorkflowConfig` from `./phases`
- After the existing `executeUnitTestPhase` call and before `executeDiffEvaluationPhase`, add the scenario test/fix retry loop
- The diff evaluator gate and conditional review/document escalation remain exactly as they are
- Add `scenarioRetries` to state metadata
- Update the JSDoc workflow comment at top of file

### Step 4: Wire scenario test/fix into `adwPrReview.tsx`
- Add imports: `executeUnitTestPhase`, `executeScenarioTestPhase`, `executeScenarioFixPhase`, `MAX_TEST_RETRY_ATTEMPTS` from `./core`, `type WorkflowConfig` from `./phases`, `type ScenarioProofResult` from `./agents/regressionScenarioProof`
- Remove the `executePRReviewTestPhase` import (no longer needed in the orchestrator)
- Replace the current `executePRReviewTestPhase` call with:
  ```ts
  // Unit tests
  await runPhase(config.base, tracker, executeUnitTestPhase);

  // Scenario test/fix retry loop
  let scenarioRetries = 0;
  for (let attempt = 0; attempt < MAX_TEST_RETRY_ATTEMPTS; attempt++) {
    const scenarioResult = await runPhase(config.base, tracker, executeScenarioTestPhase);
    if (!scenarioResult.scenarioProof?.hasBlockerFailures) break;
    scenarioRetries++;
    if (attempt < MAX_TEST_RETRY_ATTEMPTS - 1) {
      const fixWrapper = (cfg: WorkflowConfig) =>
        executeScenarioFixPhase(cfg, scenarioResult.scenarioProof!);
      await runPhase(config.base, tracker, fixWrapper);
    }
  }
  ```
- Keep the `executeStepDefPhase` call before the scenario test phase (already in correct position)
- Update the JSDoc workflow comment at top of file

### Step 5: Verify pattern consistency across all five orchestrators
- Visually compare the scenario test/fix retry loop in all five orchestrators (`adwSdlc`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`, `adwPrReview`) to confirm they use the identical loop structure
- Confirm all orchestrators import `MAX_TEST_RETRY_ATTEMPTS` from `./core`

### Step 6: Run validation commands
- Run `bun run lint` to check for linting issues
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type safety
- Run `bun run build` to verify no build errors
- Run `bun run test` to verify existing unit tests pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify BDD regression scenarios pass

## Testing Strategy
### Unit Tests
No new unit tests are needed. The `scenarioTestPhase` and `scenarioFixPhase` already have unit test coverage from #399 (`adws/phases/__tests__/scenarioTestPhase.test.ts`). The changes in this issue are pure orchestrator wiring — composing existing tested phases. The existing `phaseRunner.test.ts` covers `CostTracker` accumulation and `runPhase` behavior.

### Edge Cases
- Orchestrators with no scenarios configured (empty `scenariosMd` or `runScenariosByTag: 'N/A'`): the `scenarioTestPhase` returns immediately with a passing result — no retry loop iterations needed
- `adwPrReview` accessing `config.base` fields: ensure the `WorkflowConfig` embedded in `PRReviewWorkflowConfig.base` has all required fields (`projectConfig`, `worktreePath`, `applicationUrl`, etc.)
- `adwChore` ordering: scenario test/fix must run before `executeDiffEvaluationPhase` since the diff evaluator needs to see any scenario-fix commits in its diff
- `adwPlanBuildTest` has no review phase: no `scenariosMd` patching needed
- Scenario fix phase commits and pushes: the retry loop re-runs `scenarioTestPhase` after fixes are committed, which picks up the new code

## Acceptance Criteria
- `adwPlanBuildTest.tsx` wires `executeUnitTestPhase` + `executeScenarioTestPhase` + retry loop with `executeScenarioFixPhase`
- `adwPlanBuildTestReview.tsx` same wiring, plus patches `scenariosMd` to empty before review
- `adwChore.tsx` same wiring, with diff evaluator gate still applied after scenario testing
- `adwPrReview.tsx` replaces `executePRReviewTestPhase` with `executeUnitTestPhase` + scenario test/fix pattern using `config.base`
- All five orchestrators (including `adwSdlc.tsx` from #399) follow the same scenario test/fix retry loop pattern
- `bun run lint` passes
- `bunx tsc --noEmit` passes
- `bun run build` passes
- Existing unit tests pass (`bun run test`)
- BDD regression scenarios pass (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root TypeScript configuration
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check ADW-specific TypeScript configuration
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run unit tests to validate zero regressions
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run BDD regression scenarios

## Notes
- `executePRReviewTestPhase` in `prReviewCompletion.ts` is NOT deleted — it remains as an exported function. It is simply no longer called by `adwPrReview.tsx`. If it becomes dead code after all consumers are migrated, it can be removed in a future cleanup.
- The `scenarioTestPhase` gracefully skips when no scenarios are configured, so orchestrators running against repos without BDD scenarios will see zero overhead.
- The retry loop does NOT hard-fail on exhaustion — if all `MAX_TEST_RETRY_ATTEMPTS` are used, the workflow continues to the next phase (review, PR, etc.), matching the `adwSdlc.tsx` behavior.
- `adwPlanBuildTest` does NOT have a scenario generation phase (no `executeScenarioPhase` in parallel with plan). It relies on scenarios already existing in the repo. This matches the current behavior — `adwPlanBuildTest` is a lightweight orchestrator.
- Follow `guidelines/coding_guidelines.md` strictly — immutable config patching (shallow clone), functional composition, explicit types.
