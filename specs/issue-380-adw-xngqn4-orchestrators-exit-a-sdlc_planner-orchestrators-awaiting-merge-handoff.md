# Feature: Orchestrators exit after PR approval with `awaiting_merge` handoff

## Metadata
issueNumber: `380`
adwId: `xngqn4-orchestrators-exit-a`
issueJson: `{"number":380,"title":"Orchestrators exit after PR approval with `awaiting_merge` handoff","body":"## Parent PRD\n\n`specs/prd/orchestrator-lifecycle-redesign.md`\n\n## What to build\n\nRestructure all orchestrators so that nothing runs after PR creation that requires the worktree. After PR creation, the orchestrator approves the PR (API call) and writes `awaiting_merge` to the state file, then exits.\n\n**Changes per orchestrator:**\n\n- **`adwSdlc.tsx`**: Remove `executeAutoMergePhase`. Remove or move `executeKpiPhase` before PR. Document phase already runs before PR — no change needed. After `executePRPhase`: approve PR, write `awaiting_merge`, exit.\n\n- **`adwChore.tsx`**: Move `executeDiffEvaluationPhase` before `executePRPhase` (DiffEval uses `git diff` against default branch, not PR). Move `executeDocumentPhase` before PR in the regression path. Remove `executeAutoMergePhase` from both paths. After PR: approve, write `awaiting_merge`, exit.\n\n- **`adwPlanBuildReview.tsx`**: Remove `executeAutoMergePhase`. After PR: approve, write `awaiting_merge`, exit.\n\n- **`adwPlanBuildTestReview.tsx`**: Remove `executeAutoMergePhase`. After PR: approve, write `awaiting_merge`, exit.\n\nThe PR approval (`gh pr review --approve`) and state file write are API calls that do not require the worktree.\n\nSee PRD \"Orchestrator Lifecycle\" section for details.\n\n## Acceptance criteria\n\n- [ ] `executeAutoMergePhase` removed from all orchestrators\n- [ ] `adwChore.tsx`: DiffEval and Document moved before PR creation\n- [ ] KPI phase moved before PR or removed from `adwSdlc.tsx`\n- [ ] All orchestrators approve PR and write `awaiting_merge` to state file after PR creation\n- [ ] No phase runs after PR creation that requires the worktree\n- [ ] Existing BDD tests updated if they assert phase ordering\n- [ ] `executeAutoMergePhase` can be deleted or deprecated (used only by `adwMerge.tsx` going forward)\n\n## Blocked by\n\n- Blocked by #378\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 19\n- User story 20\n- User story 21\n- User story 22","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T09:26:09Z","comments":[],"actionableComment":null}`

## Feature Description
Restructure all four orchestrators (`adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`) so that no phase runs after PR creation that requires the worktree. After PR creation, each orchestrator approves the PR via the GitHub API and writes `awaiting_merge` to the top-level workflow state file, then exits cleanly. This decouples the orchestrator lifecycle from the merge step, enabling a future merge handler (`adwMerge.tsx`) to take over.

## User Story
As the ADW automation system
I want orchestrators to exit immediately after PR creation and approval
So that the worktree is released as early as possible and merge handling can be delegated to a separate process

## Problem Statement
Currently, all four orchestrators call `executeAutoMergePhase` after PR creation, which requires the worktree to remain alive for conflict resolution retries. Additionally, some orchestrators run worktree-dependent phases (KPI, DiffEval, Document) after PR creation. This ties up the worktree longer than necessary and couples orchestrator completion to merge success.

## Solution Statement
1. Move all worktree-dependent phases before PR creation
2. Remove `executeAutoMergePhase` from all four orchestrators
3. After `executePRPhase`, approve the PR using the existing `approvePR()` function and write `workflowStage: 'awaiting_merge'` to the top-level state file
4. Complete the workflow and exit

The PR approval and state file write are pure API calls — no worktree access needed.

## Relevant Files
Use these files to implement the feature:

### Orchestrators (primary changes)
- `adws/adwSdlc.tsx` — Move `executeKpiPhase` before `executePRPhase`, remove `executeAutoMergePhase`, add post-PR approval + state write
- `adws/adwChore.tsx` — Move `executeDiffEvaluationPhase` before `executePRPhase`, move `executeDocumentPhase` before PR in regression path, remove `executeAutoMergePhase` from both paths, add post-PR approval + state write
- `adws/adwPlanBuildReview.tsx` — Remove `executeAutoMergePhase`, add post-PR approval + state write
- `adws/adwPlanBuildTestReview.tsx` — Remove `executeAutoMergePhase`, add post-PR approval + state write

### Phase and state infrastructure
- `adws/phases/workflowCompletion.ts` — `completeWorkflow()` already writes `workflowStage: 'completed'`; now also needs a path for `awaiting_merge` completion
- `adws/core/agentState.ts` — `AgentStateManager.writeTopLevelState()` used to write new `awaiting_merge` stage
- `adws/github/prApi.ts` — `approvePR()` function already exists, will be imported directly into orchestrators or a new helper
- `adws/github/issueApi.ts` — `isGitHubAppConfigured()` check for conditional approval
- `adws/workflowPhases.ts` — Barrel re-exports; may need to remove `executeAutoMergePhase` import from orchestrators (keep in barrel for future `adwMerge.tsx`)

### Phase implementations (reference, not modified)
- `adws/phases/autoMergePhase.ts` — Remains in codebase for future `adwMerge.tsx`; not deleted
- `adws/phases/prPhase.ts` — Stores `ctx.prUrl` and `ctx.prNumber` after PR creation
- `adws/phases/kpiPhase.ts` — Uses worktree (commits+pushes KPI file); must run before PR
- `adws/phases/diffEvaluationPhase.ts` — Uses `git diff` in worktree; must run before PR
- `adws/phases/documentPhase.ts` — Uses worktree (commits+pushes docs); must run before PR

### BDD tests (update phase ordering assertions)
- `features/auto_approve_merge_after_review.feature` — Scenarios asserting `executeAutoMergePhase` in orchestrators need updating
- `features/build_agent_routing_pipeline.feature` — Phase ordering tables for adwSdlc need `kpi` moved before `pr`
- `features/hitl_label_gate_automerge.feature` — Tests `autoMergePhase.ts` directly; no changes needed (file remains)
- `features/step_definitions/autoApproveMergeAfterReviewSteps.ts` — Step definitions for updated scenarios
- `features/step_definitions/buildAgentRoutingPipelineSteps.ts` — Step definitions for phase ordering validation

### Documentation
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — Reference: documents workflowStage values and state patterns
- `guidelines/coding_guidelines.md` — Must follow: clarity, modularity, type safety, immutability

### New Files
- `features/orchestrators_awaiting_merge_handoff.feature` — New BDD feature file for this issue's acceptance criteria

## Implementation Plan
### Phase 1: Foundation — Post-PR approval helper
Create a reusable helper function that encapsulates the post-PR-creation logic: approve the PR (when GitHub App is configured), write `awaiting_merge` to the top-level state file. This function will be called by all four orchestrators after `executePRPhase`.

### Phase 2: Core Implementation — Orchestrator restructuring
Modify each orchestrator to:
1. Reorder phases so all worktree-dependent work precedes PR creation
2. Remove `executeAutoMergePhase` call
3. Call the post-PR approval helper after `executePRPhase`
4. Update `completeWorkflow()` call to pass `awaiting_merge`-appropriate metadata

### Phase 3: Integration — BDD test updates
Update existing BDD scenarios that assert phase ordering or `executeAutoMergePhase` presence in orchestrators. Write new BDD scenarios covering the `awaiting_merge` handoff behavior.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Create post-PR approval + awaiting_merge helper
- Create a new exported function `approvePRAndWriteAwaitingMerge(config: WorkflowConfig)` in `adws/phases/workflowCompletion.ts` (co-located with `completeWorkflow`)
- The function should:
  1. Extract PR number from `config.ctx.prUrl` (reuse the `extractPrNumber` pattern from `autoMergePhase.ts`)
  2. If `isGitHubAppConfigured()` is true, call `approvePR(prNumber, repoInfo)` (non-fatal on failure, log warning)
  3. Call `AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' })`
  4. Log the outcome
- Import `approvePR`, `isGitHubAppConfigured` from `../github`
- Export the function from `adws/phases/index.ts` and `adws/workflowPhases.ts` barrel

### Step 2: Restructure `adwPlanBuildReview.tsx`
- Remove `executeAutoMergePhase` from the import list
- Remove the `await runPhase(config, tracker, executeAutoMergePhase)` call (line 72)
- Import `approvePRAndWriteAwaitingMerge` from `./workflowPhases`
- After `executePRPhase`, call `await approvePRAndWriteAwaitingMerge(config)`
- Update the JSDoc header comment to reflect the new workflow (remove step 8 "AutoMerge Phase", add "Approve + awaiting_merge")
- **New phase ordering:** install → plan+scenarios → alignment → build → test → review → pr → approve+awaiting_merge → finalize

### Step 3: Restructure `adwPlanBuildTestReview.tsx`
- Identical changes as Step 2 (these two files are nearly identical, differing only in OrchestratorId)
- Remove `executeAutoMergePhase` import and call (line 76)
- Import and call `approvePRAndWriteAwaitingMerge(config)` after `executePRPhase`
- Update JSDoc header

### Step 4: Restructure `adwSdlc.tsx`
- Remove `executeAutoMergePhase` from the import list
- Remove the `await runPhase(config, tracker, executeAutoMergePhase)` call (line 99)
- Move the KPI phase block (lines 94-97) to execute **before** `executePRPhase` (after the document phase)
- Import `approvePRAndWriteAwaitingMerge` from `./workflowPhases`
- After `executePRPhase`, call `await approvePRAndWriteAwaitingMerge(config)`
- Update the JSDoc header comment to reflect the new workflow order
- **New phase ordering:** install → plan+scenarios → alignment → build → test → review → document → kpi → pr → approve+awaiting_merge → finalize

### Step 5: Restructure `adwChore.tsx`
- Remove `executeAutoMergePhase` from the import list
- Move `executeDiffEvaluationPhase` to run **before** `executePRPhase` (immediately after `executeTestPhase`)
- Import `approvePRAndWriteAwaitingMerge` from `./workflowPhases`
- Restructure both paths:
  - **Safe path:** `executePRPhase` → `approvePRAndWriteAwaitingMerge` → `completeWorkflow`
  - **Regression path:** `postEscalationComment` → `executeReviewPhase` → `executeDocumentPhase` → `executePRPhase` → `approvePRAndWriteAwaitingMerge` → `completeWorkflow`
- Update the escalation comment text: change "review → document → auto-merge" to "review → document → PR"
- Update the JSDoc header to reflect the new workflow
- **New phase ordering:**
  - install → plan → build → test → diffEval → [safe: pr → approve+awaiting_merge | regression: review → document → pr → approve+awaiting_merge] → finalize

### Step 6: Update `features/build_agent_routing_pipeline.feature` phase ordering
- Update the adwSdlc.tsx scenario (line 113) phase ordering table: move `kpi` before `pr`
  ```
  | install            |
  | plan + scenarios   |
  | alignment          |
  | build              |
  | test               |
  | review             |
  | document           |
  | kpi                |
  | pr                 |
  ```
- Verify adwPlanBuildReview and adwPlanBuildTestReview tables remain valid (they don't include autoMerge in the table already)

### Step 7: Update `features/auto_approve_merge_after_review.feature` orchestrator scenarios
- Update or replace the following scenarios that assert `executeAutoMergePhase` is called in orchestrators:
  - "adwPlanBuildReview.tsx calls executeAutoMergePhase after PR phase" → Replace with scenario asserting `executeAutoMergePhase` is NOT called, and `approvePRAndWriteAwaitingMerge` IS called after `executePRPhase`
  - "adwPlanBuildTestReview.tsx calls executeAutoMergePhase after PR phase" → Same replacement
  - "adwSdlc.tsx calls executeAutoMergePhase after KPI phase" → Replace with scenario asserting `executeAutoMergePhase` is NOT called, and `approvePRAndWriteAwaitingMerge` IS called after `executePRPhase`
  - Update the corresponding import scenarios to assert orchestrators do NOT import `executeAutoMergePhase`
- Keep all scenarios that test `autoMergePhase.ts` itself (the file remains for future `adwMerge.tsx`)

### Step 8: Write new BDD feature file `features/orchestrators_awaiting_merge_handoff.feature`
- Tag with `@adw-380` and `@regression`
- Scenarios to cover:
  1. `approvePRAndWriteAwaitingMerge` function exists and is exported from `workflowPhases.ts`
  2. The function calls `approvePR` when `isGitHubAppConfigured()` is true
  3. The function calls `writeTopLevelState` with `awaiting_merge`
  4. `adwSdlc.tsx` does not import or call `executeAutoMergePhase`
  5. `adwChore.tsx` does not import or call `executeAutoMergePhase`
  6. `adwPlanBuildReview.tsx` does not import or call `executeAutoMergePhase`
  7. `adwPlanBuildTestReview.tsx` does not import or call `executeAutoMergePhase`
  8. `adwSdlc.tsx`: `executeKpiPhase` is called before `executePRPhase`
  9. `adwChore.tsx`: `executeDiffEvaluationPhase` is called before `executePRPhase`
  10. `adwChore.tsx` regression path: `executeDocumentPhase` is called before `executePRPhase`
  11. All four orchestrators call `approvePRAndWriteAwaitingMerge` after `executePRPhase`
  12. TypeScript type-check passes

### Step 9: Write step definitions for new scenarios
- Create `features/step_definitions/orchestratorsAwaitingMergeHandoffSteps.ts`
- Implement step definitions using existing patterns from `autoApproveMergeAfterReviewSteps.ts` (file reading, function call ordering assertions, import checking)
- Reuse common steps from `commonSteps.ts` where applicable

### Step 10: Run validation commands
- Run `bun run lint` to check linter passes
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify TypeScript type-checks pass
- Run `bun run build` to verify build succeeds
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-380"` to verify new BDD scenarios pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify zero regressions

## Testing Strategy
### Unit Tests
Unit tests are enabled for this project. However, this feature is primarily a restructuring of orchestrator scripts (which are top-level composition scripts, not library code). The `approvePRAndWriteAwaitingMerge` helper function is testable, but the existing unit test patterns (in `adws/core/__tests__/`) focus on lower-level utilities. BDD scenarios are the primary validation mechanism for orchestrator phase ordering. Unit tests are not required for this change.

### Edge Cases
- PR creation fails (no `ctx.prUrl` set) — `approvePRAndWriteAwaitingMerge` should handle gracefully (log warning, still write `awaiting_merge`)
- `approvePR` fails (non-fatal) — approval failure should not prevent `awaiting_merge` state write or workflow completion
- GitHub App not configured — skip approval, proceed directly to state write
- `adwChore.tsx` regression path has review failure — review failure already calls `process.exit(1)` before reaching PR, so no change needed
- DiffEval produces empty diff — already handled by `executeDiffEvaluationPhase` (defaults to `regression_possible`)

## Acceptance Criteria
- `executeAutoMergePhase` is not imported or called in `adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`
- `adwChore.tsx`: `executeDiffEvaluationPhase` runs before `executePRPhase`; `executeDocumentPhase` runs before `executePRPhase` in the regression path
- `adwSdlc.tsx`: `executeKpiPhase` runs before `executePRPhase`
- All four orchestrators call `approvePRAndWriteAwaitingMerge` (or equivalent) after `executePRPhase`
- The `awaiting_merge` value is written to `workflowStage` in the top-level state file after PR creation
- PR approval uses `approvePR()` with `isGitHubAppConfigured()` guard (same identity logic as `autoMergePhase.ts`)
- No phase running after `executePRPhase` requires the worktree
- `executeAutoMergePhase` remains exported from `workflowPhases.ts` (for future `adwMerge.tsx`)
- All existing `@regression` BDD scenarios pass
- TypeScript type-check passes (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Run TypeScript type-check (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run TypeScript type-check (adws config)
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-380"` — Run new BDD scenarios for this feature
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to verify zero regressions

## Notes
- `executeAutoMergePhase` is **not deleted** from the codebase. It remains in `adws/phases/autoMergePhase.ts` and is exported from `adws/workflowPhases.ts` for use by a future `adwMerge.tsx` orchestrator.
- The `adwMerge.tsx` orchestrator does not exist yet — it is out of scope for this issue.
- The HITL label gate (`hitl_label_gate_automerge.feature`) tests `autoMergePhase.ts` directly and is not affected by this change.
- The diff evaluation phase comment in `diffEvaluationPhase.ts` (line 57-58) says "Auto-approving and merging" / "Escalating to review → document → auto-merge". These comments are internal audit trail messages. Updating them is optional and can be done as a follow-up.
- The escalation comment in `adwChore.tsx` (`postEscalationComment`) should be updated to reflect the new flow: "review → document → PR" instead of "review → document → auto-merge".
- Follow `guidelines/coding_guidelines.md`: clarity over cleverness, modularity, type safety, immutability.
