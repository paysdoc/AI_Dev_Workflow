# Feature: Orchestrators exit after PR approval with `awaiting_merge` handoff

## Metadata
issueNumber: `380`
adwId: `bpn4sv-orchestrators-exit-a`
issueJson: `{"number":380,"title":"Orchestrators exit after PR approval with `awaiting_merge` handoff","body":"## Parent PRD\n\n`specs/prd/orchestrator-lifecycle-redesign.md`\n\n## What to build\n\nRestructure all orchestrators so that nothing runs after PR creation that requires the worktree. After PR creation, the orchestrator approves the PR (API call) and writes `awaiting_merge` to the state file, then exits.\n\n**Changes per orchestrator:**\n\n- **`adwSdlc.tsx`**: Remove `executeAutoMergePhase`. Remove or move `executeKpiPhase` before PR. Document phase already runs before PR — no change needed. After `executePRPhase`: approve PR, write `awaiting_merge`, exit.\n\n- **`adwChore.tsx`**: Move `executeDiffEvaluationPhase` before `executePRPhase` (DiffEval uses `git diff` against default branch, not PR). Move `executeDocumentPhase` before PR in the regression path. Remove `executeAutoMergePhase` from both paths. After PR: approve, write `awaiting_merge`, exit.\n\n- **`adwPlanBuildReview.tsx`**: Remove `executeAutoMergePhase`. After PR: approve, write `awaiting_merge`, exit.\n\n- **`adwPlanBuildTestReview.tsx`**: Remove `executeAutoMergePhase`. After PR: approve, write `awaiting_merge`, exit.\n\nThe PR approval (`gh pr review --approve`) and state file write are API calls that do not require the worktree.\n\nSee PRD \"Orchestrator Lifecycle\" section for details.\n\n## Acceptance criteria\n\n- [ ] `executeAutoMergePhase` removed from all orchestrators\n- [ ] `adwChore.tsx`: DiffEval and Document moved before PR creation\n- [ ] KPI phase moved before PR or removed from `adwSdlc.tsx`\n- [ ] All orchestrators approve PR and write `awaiting_merge` to state file after PR creation\n- [ ] No phase runs after PR creation that requires the worktree\n- [ ] Existing BDD tests updated if they assert phase ordering\n- [ ] `executeAutoMergePhase` can be deleted or deprecated (used only by `adwMerge.tsx` going forward)\n\n## Blocked by\n\n- Blocked by #378\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 19\n- User story 20\n- User story 21\n- User story 22","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T09:26:09Z","comments":[],"actionableComment":null}`

## Feature Description
Restructure all four orchestrators (`adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`) so that nothing runs after PR creation that requires the worktree. After PR creation, each orchestrator approves the PR via `approvePR()` (an API call), writes `awaiting_merge` to the top-level state file via `AgentStateManager.writeTopLevelState()`, then proceeds to `completeWorkflow`. The `executeAutoMergePhase` is removed from all four orchestrators — merge responsibility shifts to the webhook-triggered auto-merge handler.

This decouples the orchestrator lifecycle from the worktree, enabling earlier worktree cleanup and a cleaner separation between "build" and "merge" responsibilities.

## User Story
As an ADW operator
I want orchestrators to exit cleanly after PR approval without requiring the worktree for post-PR phases
So that worktrees can be reclaimed sooner and the merge responsibility is handled by the webhook-triggered auto-merge handler

## Problem Statement
Currently, all four review-capable orchestrators run `executeAutoMergePhase` after PR creation, which calls `mergeWithConflictResolution` — a function that requires the worktree for conflict resolution via the `/resolve_conflict` agent. Additionally, `adwSdlc.tsx` runs `executeKpiPhase` after PR (which does `git commit` + `git push` in the worktree), and `adwChore.tsx` runs `executeDiffEvaluationPhase` and `executeDocumentPhase` after PR. This means the worktree cannot be cleaned up until the entire orchestrator exits, even though the core implementation work is complete.

## Solution Statement
1. Remove `executeAutoMergePhase` from all four orchestrators.
2. Move worktree-dependent phases before PR creation:
   - `adwSdlc.tsx`: Move `executeKpiPhase` before `executePRPhase` (it does `git commit/push` which needs the worktree).
   - `adwChore.tsx`: Move `executeDiffEvaluationPhase` before `executePRPhase` (uses `git diff` against default branch). Move `executeDocumentPhase` before `executePRPhase` in the `regression_possible` path (it runs a Claude agent in the worktree and does `git commit/push`).
3. After `executePRPhase`, each orchestrator:
   - Extracts the PR number from `ctx.prUrl`
   - Checks the `hitl` label gate (preserving existing behavior)
   - Calls `approvePR()` (when GitHub App is configured)
   - Writes `workflowStage: 'awaiting_merge'` via `AgentStateManager.writeTopLevelState()`
   - Calls `completeWorkflow()` to finalize

## Relevant Files
Use these files to implement the feature:

- `adws/adwSdlc.tsx` — SDLC orchestrator. Remove `executeAutoMergePhase`, move `executeKpiPhase` before `executePRPhase`, add approve + `awaiting_merge` write after PR.
- `adws/adwChore.tsx` — Chore orchestrator. Remove `executeAutoMergePhase` from both paths, move `executeDiffEvaluationPhase` before `executePRPhase`, move `executeDocumentPhase` before PR in regression path, add approve + `awaiting_merge` write after PR.
- `adws/adwPlanBuildReview.tsx` — PlanBuildReview orchestrator. Remove `executeAutoMergePhase`, add approve + `awaiting_merge` write after PR.
- `adws/adwPlanBuildTestReview.tsx` — PlanBuildTestReview orchestrator. Remove `executeAutoMergePhase`, add approve + `awaiting_merge` write after PR.
- `adws/phases/autoMergePhase.ts` — Source of the `approvePR` call pattern, `hitl` label gate logic, and PR number extraction. Used as reference for the inline approve+handoff logic.
- `adws/github/prApi.ts` — Contains `approvePR()` function used for PR approval.
- `adws/github/index.ts` — Barrel export for `approvePR`, `isGitHubAppConfigured`, `issueHasLabel`, `commentOnIssue`.
- `adws/core/agentState.ts` — `AgentStateManager.writeTopLevelState()` for writing `awaiting_merge` to state file.
- `adws/workflowPhases.ts` — Barrel re-export file; `executeAutoMergePhase` export may need to remain for `adwMerge.tsx` use.
- `adws/phases/index.ts` — Phase barrel export file; `executeAutoMergePhase` export must remain (still used by webhook auto-merge path).
- `adws/phases/workflowCompletion.ts` — `completeWorkflow()` reference for state writes.
- `adws/phases/kpiPhase.ts` — KPI phase that uses `commitAndPushKpiFile()` (worktree-dependent).
- `adws/phases/diffEvaluationPhase.ts` — Diff eval phase that uses `git diff` (worktree-dependent).
- `adws/phases/documentPhase.ts` — Document phase that runs Claude agent + `git commit/push` (worktree-dependent).
- `features/orchestrator_awaiting_merge_handoff.feature` — Pre-written BDD scenarios for this issue (tagged `@adw-bpn4sv-orchestrators-exit-a`).
- `features/auto_approve_merge_after_review.feature` — Existing BDD scenarios asserting phase ordering that will need updating (tagged `@adw-fvzdz7-auto-approve-and-mer`).
- `features/step_definitions/autoApproveMergeAfterReviewSteps.ts` — Existing step definitions for phase ordering assertions.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — Conditional doc: top-level state file system (relevant for `writeTopLevelState` usage).
- `app_docs/feature-fygx90-hitl-label-gate-automerge.md` — Conditional doc: HITL label gate behavior (relevant for preserving hitl gate in new inline approve logic).

### New Files
- `features/step_definitions/orchestratorAwaitingMergeHandoffSteps.ts` — Step definitions for the new BDD scenarios in `orchestrator_awaiting_merge_handoff.feature`.

## Implementation Plan
### Phase 1: Foundation — Shared approve-and-handoff pattern
Extract the common post-PR logic that all four orchestrators will share: extract PR number from `ctx.prUrl`, check `hitl` label, call `approvePR()` when GitHub App is configured, write `awaiting_merge` to top-level state. This can be implemented as an inline pattern in each orchestrator (following the existing pattern where each orchestrator composes phases directly) or as a small shared helper function. Given that the logic is ~15 lines and identical across all four orchestrators, a shared helper is warranted.

### Phase 2: Core Implementation — Orchestrator restructuring
Apply changes to each orchestrator:
1. **`adwPlanBuildReview.tsx`** (simplest): Remove `executeAutoMergePhase` import and call. Add approve + `awaiting_merge` write after `executePRPhase`, before `completeWorkflow`.
2. **`adwPlanBuildTestReview.tsx`** (identical to above): Same changes.
3. **`adwSdlc.tsx`**: Remove `executeAutoMergePhase` import and call. Move `executeKpiPhase` before `executePRPhase`. Add approve + `awaiting_merge` write after `executePRPhase`.
4. **`adwChore.tsx`**: Remove `executeAutoMergePhase` from both safe and regression paths. Move `executeDiffEvaluationPhase` before `executePRPhase`. Move `executeDocumentPhase` before `executePRPhase` in regression path. Add approve + `awaiting_merge` write after `executePRPhase` in both paths.

### Phase 3: Integration — BDD scenarios and existing test updates
1. Write step definitions for the new BDD feature file `orchestrator_awaiting_merge_handoff.feature`.
2. Update existing BDD scenarios in `auto_approve_merge_after_review.feature` that assert `executeAutoMergePhase` ordering — these scenarios will fail since the phase is removed from orchestrators.
3. Validate all regression scenarios pass.

## Step by Step Tasks

### Step 1: Read conditional documentation
- Read `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` for top-level state patterns.
- Read `app_docs/feature-fygx90-hitl-label-gate-automerge.md` for HITL label gate behavior.
- Read `guidelines/coding_guidelines.md` for coding conventions.

### Step 2: Create shared approve-and-handoff helper
- Create a helper function (e.g., `approveAndHandoff`) that encapsulates the post-PR logic shared by all four orchestrators.
- The function should:
  1. Extract PR number from `ctx.prUrl` (reuse pattern from `autoMergePhase.ts` `extractPrNumber`)
  2. Build `repoInfo` from `repoContext`
  3. Check `hitl` label via `issueHasLabel(issueNumber, 'hitl', repoInfo)` — if present, skip approval, post comment, still write `awaiting_merge`
  4. Call `approvePR(prNumber, repoInfo)` when `isGitHubAppConfigured()` returns true
  5. Write `workflowStage: 'awaiting_merge'` via `AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' })`
- Place this helper in `adws/phases/workflowCompletion.ts` or a new small utility, depending on locality. Since it imports from `github/` (not a phase), placing it in `adws/adwBuildHelpers.ts` (which already exists as an orchestrator-level helper) is appropriate.
- Import `approvePR`, `isGitHubAppConfigured`, `issueHasLabel`, `commentOnIssue` from `adws/github`.
- Import `AgentStateManager` from `adws/core`.

### Step 3: Restructure `adwPlanBuildReview.tsx`
- Remove `executeAutoMergePhase` from the import statement.
- Remove `await runPhase(config, tracker, executeAutoMergePhase);` call.
- Add imports for the shared approve-and-handoff helper.
- After `await runPhase(config, tracker, executePRPhase);`, call the approve-and-handoff helper.
- Verify `completeWorkflow` is called after the handoff.

### Step 4: Restructure `adwPlanBuildTestReview.tsx`
- Same changes as Step 3 — identical structure.

### Step 5: Restructure `adwSdlc.tsx`
- Remove `executeAutoMergePhase` from the import statement.
- Remove `await runPhase(config, tracker, executeAutoMergePhase);` call.
- Move `executeKpiPhase` (with its `executeKpiWithRetries` wrapper) to run **before** `executePRPhase` (after `executeDocumentWithScreenshots`).
- Add imports for the shared approve-and-handoff helper.
- After `await runPhase(config, tracker, executePRPhase);`, call the approve-and-handoff helper.
- Verify `completeWorkflow` is called after the handoff.

### Step 6: Restructure `adwChore.tsx`
- Remove `executeAutoMergePhase` from the import statement.
- Move `executeDiffEvaluationPhase` to run **before** `executePRPhase` (after test phase).
- In the `regression_possible` branch: move `executeDocumentPhase` before `executePRPhase`.
- Both `safe` and `regression_possible` paths should converge on a single `executePRPhase` call followed by approve-and-handoff + `completeWorkflow`. Restructure the branching so that:
  - After test: run diff evaluation
  - If `regression_possible`: post escalation, run review, run document
  - Then in both paths: run PR phase, approve, write `awaiting_merge`, complete workflow
- Add imports for the shared approve-and-handoff helper.

### Step 7: Write step definitions for new BDD scenarios
- Create `features/step_definitions/orchestratorAwaitingMergeHandoffSteps.ts`.
- Implement step definitions for all steps in `features/orchestrator_awaiting_merge_handoff.feature` that are not already covered by existing step definitions.
- Key new steps to implement:
  - `the file does not import {string}` — assert import is absent
  - `the file does not contain a call to {string}` — assert function call is absent
  - `{string} is called before {string} in the regression_possible branch` — branch-aware ordering
  - `the orchestrator writes workflowStage {string} after PR approval` — verify state write ordering
  - `the awaiting_merge write uses {string}` — verify specific API usage
  - `no phase that requires the worktree is called after {string}` — verify no worktree phases after PR
  - `only API calls and state writes occur between {string} and {string}` — verify clean exit
  - `{string} is the last executeXxxPhase call before {string}` — verify phase is final
  - `the orchestrator checks for the hitl label before calling approvePR` — hitl gate preserved
  - `the orchestrator skips approvePR when hitl label is present` — hitl skip behavior
- Reuse existing step definitions from `autoApproveMergeAfterReviewSteps.ts` where applicable (e.g., `{string} is called after {string}`, `{string} is called before {string}`, `the file imports {string} from {string}`).

### Step 8: Update existing BDD scenarios in `auto_approve_merge_after_review.feature`
- Scenarios that assert `executeAutoMergePhase` is imported/called in orchestrators will fail. These need updating:
  - "adwPlanBuildReview.tsx imports executeAutoMergePhase" — remove or update
  - "adwPlanBuildReview.tsx calls executeAutoMergePhase after PR phase" — remove or update
  - "adwPlanBuildTestReview.tsx imports executeAutoMergePhase" — remove or update
  - "adwPlanBuildTestReview.tsx calls executeAutoMergePhase after PR phase" — remove or update
  - "adwSdlc.tsx imports executeAutoMergePhase" — remove or update
  - "adwSdlc.tsx calls executeAutoMergePhase after KPI phase" — remove or update
- The `autoMergePhase.ts` scenarios and `approvePR` scenarios should remain unchanged (the phase file still exists for webhook use).
- Update or remove the orchestrator-wiring section scenarios that reference `executeAutoMergePhase` in these four orchestrators.

### Step 9: Run TypeScript type-check
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify zero type errors.

### Step 10: Run unit tests
- Run `bun run test` to verify existing unit tests still pass.

### Step 11: Run BDD regression scenarios
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-bpn4sv-orchestrators-exit-a"` to validate the new feature scenarios.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to validate zero regressions across all scenarios.

### Step 12: Run full validation
- Run all validation commands to confirm zero regressions.

## Testing Strategy
### Unit Tests
The existing unit tests in `adws/core/__tests__/topLevelState.test.ts` and `adws/core/__tests__/phaseRunner.test.ts` should continue to pass since we're not changing the phase runner or state management APIs — only the orchestrator-level composition of phases.

### Edge Cases
- **HITL label gate**: When `hitl` label is present, `approvePR` must be skipped but `awaiting_merge` should still be written (the webhook auto-merge handler will not fire since the PR is not approved).
- **No repoContext**: When `repoContext` is absent (rare edge case), the approve call should be skipped gracefully — only the state write should happen.
- **No PR URL**: If `executePRPhase` fails to produce a PR URL (e.g., no repoContext), the approve step should be skipped but `awaiting_merge` should still be written.
- **GitHub App not configured**: When no GitHub App is configured, `approvePR` should be skipped (merge directly on webhook approval), but `awaiting_merge` is still written.
- **adwChore safe path**: DiffEval runs before PR; if verdict is `safe`, no review/document phases run, but PR + approve + `awaiting_merge` still execute.
- **adwChore regression path**: DiffEval → escalation comment → review → document → PR → approve → `awaiting_merge`.
- **KPI phase failure in adwSdlc**: KPI phase is non-fatal; if it fails before PR, the PR phase should still execute.

## Acceptance Criteria
- `executeAutoMergePhase` is not imported or called in `adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, or `adwPlanBuildTestReview.tsx`.
- `adwChore.tsx`: `executeDiffEvaluationPhase` is called before `executePRPhase`. `executeDocumentPhase` is called before `executePRPhase` in the regression path.
- `adwSdlc.tsx`: `executeKpiPhase` is called before `executePRPhase`.
- All four orchestrators call `approvePR` after `executePRPhase` (when GitHub App is configured).
- All four orchestrators write `workflowStage: 'awaiting_merge'` to the top-level state file after PR approval.
- No worktree-dependent phase runs after `executePRPhase` in any orchestrator.
- `executeAutoMergePhase` remains exported from `phases/index.ts` and `workflowPhases.ts` (still used by webhook auto-merge handler).
- All BDD scenarios tagged `@adw-bpn4sv-orchestrators-exit-a` pass.
- All `@regression` BDD scenarios pass (including updated `@adw-fvzdz7-auto-approve-and-mer` scenarios).
- TypeScript type-check passes with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type-check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type-check
- `bun run test` — Run unit tests to validate no regressions
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-bpn4sv-orchestrators-exit-a"` — Run the new feature BDD scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to validate zero regressions

## Notes
- `executeAutoMergePhase` and `autoMergePhase.ts` must NOT be deleted. They are still used by the webhook-triggered auto-merge path (`adws/triggers/autoMergeHandler.ts` calls `mergeWithConflictResolution`). The phase file is also imported by other potential orchestrators (e.g., a future `adwMerge.tsx`).
- The `approvePR` function temporarily unsets `GH_TOKEN` to use the personal `gh auth login` identity (needed when GitHub App authored the PR). This behavior must be preserved in the inline approve logic.
- The `commitAndPushKpiFile()` function in `adws/vcs/commitOperations.ts` does `git add`, `git commit`, `git fetch`, `git rebase`, and `git push` — all worktree-dependent operations. This is why KPI phase must move before PR in `adwSdlc.tsx`.
- The `executeDiffEvaluationPhase` uses `git diff ${defaultBranch}...HEAD` which runs against the worktree. This is why it must move before PR in `adwChore.tsx`.
- The `executeDocumentPhase` runs `runDocumentAgent` (Claude agent in worktree), `runCommitAgent` (git commit), and `pushBranch` (git push) — all worktree-dependent. Must move before PR.
- Follow `guidelines/coding_guidelines.md` — especially: clarity over cleverness, modularity, type safety, and functional programming style.
