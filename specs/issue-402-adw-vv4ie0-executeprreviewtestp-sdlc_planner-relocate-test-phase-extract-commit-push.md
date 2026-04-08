# Feature: executePRReviewTestPhase relocation + commit+push extraction

## Metadata
issueNumber: `402`
adwId: `vv4ie0-executeprreviewtestp`
issueJson: `{"number":402,"title":"executePRReviewTestPhase relocation + commit+push extraction","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nTwo cleanups in one slice (both target `prReviewCompletion.ts`, both leave it with only terminal handlers):\n\n**Move `executePRReviewTestPhase`:**\n- From `adws/phases/prReviewCompletion.ts` to `adws/phases/prReviewPhase.ts`\n- Update imports across the codebase\n- Pure relocation; no behavior change\n\n**Extract commit+push from `completePRReviewWorkflow`:**\n- The current `completePRReviewWorkflow` runs the commit agent and pushes the branch (`prReviewCompletion.ts:183-185`)\n- Extract that into a small dedicated phase (added to `prReviewPhase.ts`, e.g., `executePRReviewCommitPushPhase`)\n- Update `adwPrReview.tsx` to call the new phase via `runPhase` between the test loop and the completion call\n- After extraction, `completePRReviewWorkflow` shrinks to: build cost section, write final orchestrator state, post `pr_review_completed`, log banner — a true terminal handler\n\nAfter this slice, both `prReviewCompletion.ts` and `workflowCompletion.ts` contain only terminal-state handlers. The prior session's anti-pattern is fully resolved.\n\n## Acceptance criteria\n\n- [ ] `executePRReviewTestPhase` moved from `prReviewCompletion.ts` to `prReviewPhase.ts`\n- [ ] All imports updated; no backward-compat re-exports left dangling\n- [ ] New `executePRReviewCommitPushPhase` (or equivalent name) function in `prReviewPhase.ts`\n- [ ] `adwPrReview.tsx` wires the new phase via `runPhase` after the test phase\n- [ ] `completePRReviewWorkflow` no longer calls `runCommitAgent` or `pushBranch`\n- [ ] `completePRReviewWorkflow` is now a true terminal handler (build cost section + write state + post comment + log banner only)\n- [ ] Existing tests still pass\n- [ ] Manual smoke test: run a PR review workflow, confirm commit+push happens at the new phase boundary and the workflow finishes cleanly\n\n## Blocked by\n\n- Blocked by #400\n\n## User stories addressed\n\n- User story 21\n- User story 22","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:05:36Z","comments":[],"actionableComment":null}`

## Feature Description
Two cleanups targeting `prReviewCompletion.ts` that leave it containing only terminal-state handlers:

1. **Move `executePRReviewTestPhase`** from `prReviewCompletion.ts` to `prReviewPhase.ts` — pure relocation, no behavior change. Update the entire import chain (`phases/index.ts`, `workflowPhases.ts`, `adws/index.ts`) and remove the backward-compat re-export from `prReviewPhase.ts`.

2. **Extract commit+push from `completePRReviewWorkflow`** into a new `executePRReviewCommitPushPhase` function in `prReviewPhase.ts`. Wire it via `runPhase` in `adwPrReview.tsx` between the scenario test loop and the completion call. After extraction, `completePRReviewWorkflow` shrinks to: build cost section, write final orchestrator state, post `pr_review_completed` + `pr_review_completed` comments, move board status, log banner — a true terminal handler.

After this slice, both `prReviewCompletion.ts` and `workflowCompletion.ts` contain only terminal-state handlers, fully resolving the anti-pattern identified in the parent PRD.

## User Story
As an ADW developer
I want completion files to contain only terminal-state handlers (state writes, comments, banners)
So that phase logic (test execution, commit+push) lives alongside related phases and the codebase is easier to navigate and maintain

## Problem Statement
`prReviewCompletion.ts` currently houses two categories of code that don't belong in a "completion" file:
- `executePRReviewTestPhase` — a full test execution phase that runs unit and E2E tests with retry
- Commit agent invocation + branch push inside `completePRReviewWorkflow` — active side-effects that should be a discrete, visible phase in the orchestrator's phase list

This makes the phase structure harder to understand and prevents `completePRReviewWorkflow` from being a clean terminal handler.

## Solution Statement
1. Physically move `executePRReviewTestPhase` from `prReviewCompletion.ts` to `prReviewPhase.ts` (where the other PR review phases live). Update all re-export chains so there are no dangling backward-compat re-exports.
2. Extract the commit+push block from `completePRReviewWorkflow` (lines 169-174: `runCommitAgent` + `pushBranch` + stage comments) into a new `executePRReviewCommitPushPhase` function in `prReviewPhase.ts` that returns `PhaseResult`. Wire it via `runPhase` in the orchestrator.
3. Clean up `completePRReviewWorkflow` to contain only: cost section build, final state write, completion comments, board status move, and log banner.

## Relevant Files
Use these files to implement the feature:

- `adws/phases/prReviewCompletion.ts` — Source of `executePRReviewTestPhase` (to be moved) and `completePRReviewWorkflow` (to be trimmed). Currently exports: `executePRReviewTestPhase`, `completePRReviewWorkflow`, `handlePRReviewWorkflowError`.
- `adws/phases/prReviewPhase.ts` — Destination for the moved function and new commit+push phase. Currently has a backward-compat re-export block (lines 319-324) that must be removed after the move. Contains `PRReviewWorkflowConfig`, `initializePRReviewWorkflow`, `executePRReviewPlanPhase`, `executePRReviewBuildPhase`.
- `adws/phases/index.ts` — Re-export hub for all phase functions. Currently imports `executePRReviewTestPhase` from `./prReviewCompletion` (line 30-33). Must be updated to import from `./prReviewPhase` and add the new `executePRReviewCommitPushPhase`.
- `adws/workflowPhases.ts` — Top-level re-export barrel. Currently re-exports `executePRReviewTestPhase` from `./phases`. Must add `executePRReviewCommitPushPhase`.
- `adws/index.ts` — Module root exports. Currently exports `executePRReviewTestPhase` (line 125). Must add `executePRReviewCommitPushPhase`.
- `adws/adwPrReview.tsx` — PR review orchestrator. Must import and wire the new `executePRReviewCommitPushPhase` via `runPhase` between the scenario loop and `completePRReviewWorkflow`.
- `adws/core/phaseRunner.ts` — `runPhase`, `CostTracker`, `PhaseResult` definitions. Reference only — no changes needed.
- `adws/vcs/index.ts` — Exports `pushBranch`, `inferIssueTypeFromBranch`. Reference for imports needed by new phase.
- `adws/agents/index.ts` — Exports `runCommitAgent`. Reference for imports needed by new phase.
- `guidelines/coding_guidelines.md` — Must follow these coding guidelines.
- `app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md` — Context on closure-wrapper pattern and `PRReviewWorkflowConfig.base` composition.
- `app_docs/feature-8zhro4-prreviewworkflowconfig-composition.md` — Context on `base: WorkflowConfig` field access patterns.

### New Files
- No new files needed. All changes are modifications to existing files.

## Implementation Plan
### Phase 1: Foundation — Move `executePRReviewTestPhase`
Move the `executePRReviewTestPhase` function definition from `prReviewCompletion.ts` to `prReviewPhase.ts`. This is a pure cut-and-paste with import adjustments:
- Move the function body and its imports (`runUnitTestsWithRetry`, `runE2ETestsWithRetry`, `MAX_TEST_RETRY_ATTEMPTS`, `postPRStageComment`, `postIssueStageComment`, cost-related imports) to `prReviewPhase.ts`.
- Remove the backward-compat re-export block at the bottom of `prReviewPhase.ts` (lines 319-324).
- Update `phases/index.ts` to export `executePRReviewTestPhase` from `./prReviewPhase` instead of `./prReviewCompletion`.
- Clean up now-unused imports in `prReviewCompletion.ts`.

### Phase 2: Core Implementation — Extract commit+push phase
Create `executePRReviewCommitPushPhase` in `prReviewPhase.ts`:
- Extract lines 168-174 from `completePRReviewWorkflow`: the `pr_review_committing` comment post, `inferIssueTypeFromBranch`, `runCommitAgent`, `pushBranch`, and `pr_review_pushed` comment post.
- The function signature follows the closure-wrapper pattern: takes `PRReviewWorkflowConfig`, returns `Promise<PhaseResult>` (with `costUsd: 0`, `modelUsage: emptyModelUsageMap()`, `phaseCostRecords: []` since commit+push has no LLM cost — or if `runCommitAgent` returns cost data, capture it).
- Actually, `runCommitAgent` is an agent call that returns `AgentResult` with `totalCostUsd` and `modelUsage`. The new phase must capture these and return them as a proper `PhaseResult` with `phaseCostRecords`.
- Remove the extracted lines from `completePRReviewWorkflow`. Keep the board status move (`moveToStatus(... BoardStatus.Review)`) in completion since it's a terminal action.

### Phase 3: Integration — Wire the new phase and update exports
- Add `executePRReviewCommitPushPhase` to the export chains: `phases/index.ts`, `workflowPhases.ts`, `adws/index.ts`.
- In `adwPrReview.tsx`, import and call the new phase via `runPhase` with a closure wrapper: `await runPhase(config.base, tracker, _ => executePRReviewCommitPushPhase(config), 'pr_review_commit_push')`.
- Place it after the scenario test loop and before `completePRReviewWorkflow`.

## Step by Step Tasks

### Step 1: Read conditional documentation
- Read `app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md` for the closure-wrapper pattern and phase wiring approach.
- Read `app_docs/feature-8zhro4-prreviewworkflowconfig-composition.md` for the `config.base` field access pattern.

### Step 2: Move `executePRReviewTestPhase` to `prReviewPhase.ts`
- Cut the `executePRReviewTestPhase` function from `adws/phases/prReviewCompletion.ts`.
- Paste it into `adws/phases/prReviewPhase.ts` (after the existing phase functions, before the re-export block).
- Add the required imports to `prReviewPhase.ts` that were only needed by `executePRReviewTestPhase`: `runUnitTestsWithRetry`, `runE2ETestsWithRetry` from `../agents`, `MAX_TEST_RETRY_ATTEMPTS` from `../core`, `postIssueStageComment` from `./phaseCommentHelpers`.
- Note: `postPRStageComment` is already imported in `prReviewPhase.ts`. `AgentStateManager`, `emptyModelUsageMap`, `mergeModelUsageMaps` are already imported. Check each import individually.
- Remove the backward-compat re-export block at the bottom of `prReviewPhase.ts` (lines 319-324: the `export { executePRReviewTestPhase, completePRReviewWorkflow, handlePRReviewWorkflowError } from './prReviewCompletion';`).
- Clean up now-unused imports in `prReviewCompletion.ts` (`runUnitTestsWithRetry`, `runE2ETestsWithRetry`, `MAX_TEST_RETRY_ATTEMPTS`, `postIssueStageComment`).

### Step 3: Update `phases/index.ts` export source
- Change the `executePRReviewTestPhase` export from `./prReviewCompletion` to `./prReviewPhase`.
- The `completePRReviewWorkflow` and `handlePRReviewWorkflowError` exports remain from `./prReviewCompletion`.

### Step 4: Create `executePRReviewCommitPushPhase` in `prReviewPhase.ts`
- Create a new exported async function `executePRReviewCommitPushPhase(config: PRReviewWorkflowConfig)` that returns `Promise<PhaseResult>`.
- Extract from `completePRReviewWorkflow`:
  - The `pr_review_committing` stage comment post
  - `inferIssueTypeFromBranch(prDetails.headBranch)`
  - `runCommitAgent(OrchestratorId.PrReview, issueType, JSON.stringify(prDetails), logsDir, undefined, worktreePath, prDetails.body)`
  - `pushBranch(prDetails.headBranch, worktreePath)`
  - The `pr_review_pushed` stage comment post
- Capture `runCommitAgent` result (it's an async agent call returning `AgentResult`). Build `PhaseCostRecord[]` from it and return as `PhaseResult`.
- Add necessary imports: `pushBranch`, `inferIssueTypeFromBranch` from `../vcs`, `runCommitAgent` from `../agents`, `OrchestratorId` from `../core`.
- Note: Check the `runCommitAgent` signature — it may not return cost data. If it returns void or the commit agent doesn't track cost, return `{ costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] }`.

### Step 5: Trim `completePRReviewWorkflow` to terminal-only
- Remove the extracted lines from `completePRReviewWorkflow` in `prReviewCompletion.ts`:
  - Remove the `pr_review_committing` comment post (line 169)
  - Remove `inferIssueTypeFromBranch` call (line 171)
  - Remove `runCommitAgent` call (line 172)
  - Remove `pushBranch` call (line 174)
  - Remove the `pr_review_pushed` comment post (line 175)
- Keep: `buildPRReviewCostSection`, `pr_review_completed` comment post, `moveToStatus`, state write, log banner.
- Clean up now-unused imports in `prReviewCompletion.ts`: `pushBranch`, `inferIssueTypeFromBranch` from `../vcs`, `runCommitAgent` from `../agents` (check if still needed by remaining code — `runUnitTestsWithRetry` and `runE2ETestsWithRetry` were already removed in step 2).

### Step 6: Add `executePRReviewCommitPushPhase` to export chains
- Add `executePRReviewCommitPushPhase` to `adws/phases/index.ts` — export it from `./prReviewPhase`.
- Add `executePRReviewCommitPushPhase` to `adws/workflowPhases.ts`.
- Add `executePRReviewCommitPushPhase` to `adws/index.ts`.

### Step 7: Wire the new phase in `adwPrReview.tsx`
- Import `executePRReviewCommitPushPhase` from `./workflowPhases`.
- Add a `runPhase` call after the scenario test loop and before `completePRReviewWorkflow`:
  ```typescript
  await runPhase(config.base, tracker, _ => executePRReviewCommitPushPhase(config), 'pr_review_commit_push');
  ```
- This follows the existing closure-wrapper pattern used for `executePRReviewPlanPhase` and `executePRReviewBuildPhase`.

### Step 8: Verify type correctness
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to ensure no type errors.
- Fix any issues (missing imports, unused imports, type mismatches).

### Step 9: Run validation commands
- Run `bun run lint` to check for code quality issues.
- Run `bun run build` to verify no build errors.
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` for type checking.

## Testing Strategy
### Unit Tests
Unit tests are enabled for this project. However, this is a pure structural refactor (move function + extract function) with no behavioral change. The existing unit tests in `adws/phases/__tests__/` do not directly test the moved functions. No new unit tests are needed since:
- `executePRReviewTestPhase` is unchanged in behavior — only its file location changes.
- `executePRReviewCommitPushPhase` is a direct extraction from `completePRReviewWorkflow` with no logic changes.
- The existing BDD scenarios that reference `prReviewCompletion.ts` file paths will need to be checked for breakage but are validation-only (code inspection steps).

### Edge Cases
- `runCommitAgent` in `prReviewCompletion.ts` is called with `await` but the result is not captured — verify whether it returns `AgentResult` or void. If void, the new phase returns zero-cost `PhaseResult`.
- The `inferIssueTypeFromBranch` import may need to come from `../vcs` in the new location — verify the import path.
- BDD step definitions in `features/step_definitions/wireStepdefPhaseIntoOrchestratorsSteps.ts` reference `executePRReviewTestPhase` by name in code inspection — these check `adwPrReview.tsx` content, which no longer calls that function. Verify these scenarios still pass or if they were already updated.
- BDD scenarios in `features/fix_pr_review_issue_number.feature` read `prReviewCompletion.ts` to inspect `completePRReviewWorkflow` — the function still lives there, so these should be fine. But verify `moveToStatus` is still inside `completePRReviewWorkflow` after the extraction.

## Acceptance Criteria
- `executePRReviewTestPhase` is defined in `adws/phases/prReviewPhase.ts` and no longer in `adws/phases/prReviewCompletion.ts`
- No backward-compat re-exports of `executePRReviewTestPhase` exist in `prReviewPhase.ts`
- `executePRReviewCommitPushPhase` exists in `adws/phases/prReviewPhase.ts` and returns `PhaseResult`
- `adwPrReview.tsx` calls `executePRReviewCommitPushPhase` via `runPhase` between the scenario test loop and `completePRReviewWorkflow`
- `completePRReviewWorkflow` in `prReviewCompletion.ts` contains no calls to `runCommitAgent` or `pushBranch`
- `completePRReviewWorkflow` is a terminal handler: build cost section + write state + post `pr_review_completed` comment + move board status + log banner only
- `prReviewCompletion.ts` exports only `completePRReviewWorkflow` and `handlePRReviewWorkflowError` — no phase-execution functions
- All export chains (`phases/index.ts`, `workflowPhases.ts`, `adws/index.ts`) are updated
- `bunx tsc --noEmit` passes with zero errors
- `bun run lint` passes
- `bun run build` passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check
- `bun run lint` — Lint check
- `bun run build` — Build verification

## Notes
- The `runCommitAgent` call is `await`-ed but its return value is discarded in the current code. Inspect the `runCommitAgent` function signature (in `adws/agents/gitAgent.ts`) to determine if it returns `AgentResult` with cost data. If so, the new phase should capture and return it as a proper `PhaseResult`. If not (returns void), return a zero-cost `PhaseResult`.
- The `pr_review_committing` and `pr_review_pushed` stage comments move to the new phase. The `pr_review_completed` comment stays in `completePRReviewWorkflow`.
- `moveToStatus(issueNumber, BoardStatus.Review)` stays in `completePRReviewWorkflow` — it's a terminal action (moving the issue back to Review status on the board after PR review completes).
- BDD features in `features/fix_pr_review_issue_number.feature` and `features/pr_review_phaserunner_migration.feature` contain code-inspection scenarios that read `prReviewCompletion.ts`. After this change, `completePRReviewWorkflow` still lives there but with fewer lines. The scenarios should still pass since they check for the presence of patterns that remain. However, the `wireStepdefPhaseIntoOrchestratorsSteps.ts` checks for `executePRReviewTestPhase` in `adwPrReview.tsx` — this function is not called in the orchestrator (it was already replaced by `executeUnitTestPhase` + scenario loop), so that BDD step may already be failing or testing a different condition. Verify before finalizing.
- Follow the coding guidelines in `guidelines/coding_guidelines.md`: keep files under 300 lines, use meaningful names, prefer pure functions.
