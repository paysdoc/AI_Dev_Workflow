# Feature: Thin merge orchestrator and cron `awaiting_merge` handoff

## Metadata
issueNumber: `381`
adwId: `dcy9qz-create-thin-merge-or`
issueJson: `{"number":381,"title":"Create thin merge orchestrator and cron handoff for awaiting_merge","body":"...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T09:26:25Z","comments":[],"actionableComment":null}`

## Feature Description
Create `adwMerge.tsx`, a thin merge orchestrator spawned by the cron when it detects `workflowStage === 'awaiting_merge'` in a state file. This orchestrator reads the existing state, checks the PR status, resolves merge conflicts if needed, merges the PR, and writes `completed` to state. Additionally, modify the cron trigger to detect `awaiting_merge` as a handoff stage that bypasses the grace period and spawns `adwMerge.tsx` with the same adw-id and issue number.

## User Story
As the ADW automation system
I want the cron to detect PRs in `awaiting_merge` state and spawn a merge orchestrator
So that approved PRs are merged automatically within 20 seconds without blocking the original orchestrator's worktree

## Problem Statement
After the orchestrator lifecycle redesign (#378, #379, #380), orchestrators write `awaiting_merge` to state and exit. The webhook auto-merge handler was removed from orchestrators. Currently, nothing picks up the `awaiting_merge` state to actually merge the PR. The cron's `evaluateIssue` function treats `awaiting_merge` as an unknown stage and excludes it. A dedicated merge orchestrator is needed to close this gap.

## Solution Statement
1. **`adwMerge.tsx`**: A new thin orchestrator that receives an adw-id and issue number, reads the existing state file, extracts PR details, checks merge status, and calls `mergeWithConflictResolution()` from `autoMergeHandler.ts`. On success, writes `completed` to state and posts a completion comment.
2. **Cron `awaiting_merge` detection**: Add explicit handling for `awaiting_merge` in the cron's `evaluateIssue()` function. This stage bypasses the grace period (no race condition possible since webhooks no longer merge) and triggers spawning of `adwMerge.tsx` instead of the normal classify-and-spawn flow.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_cron.ts` — Cron backlog sweeper; needs `awaiting_merge` detection and `adwMerge.tsx` spawning logic
- `adws/triggers/cronStageResolver.ts` — Stage classification functions (`isActiveStage`, `isRetriableStage`); may need an `isHandoffStage` function or `awaiting_merge` handling
- `adws/triggers/__tests__/cronStageResolver.test.ts` — Unit tests for stage resolver; needs tests for `awaiting_merge` handling
- `adws/triggers/autoMergeHandler.ts` — Contains `mergeWithConflictResolution()` reused by the new orchestrator
- `adws/phases/autoMergePhase.ts` — Contains `executeAutoMergePhase()` (retained for reference); the new orchestrator uses a similar but simpler pattern
- `adws/core/constants.ts` — `OrchestratorId` registry; needs new `Merge` entry
- `adws/core/orchestratorCli.ts` — Shared CLI parsing; `adwMerge.tsx` reuses `parseOrchestratorArguments`
- `adws/core/orchestratorLib.ts` — `deriveOrchestratorScript()` name map; needs `merge-orchestrator` entry
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState()` / `writeTopLevelState()` for reading/writing state
- `adws/core/stateHelpers.ts` — `isAgentProcessRunning()` for checking if original orchestrator is still alive
- `adws/adwBuildHelpers.ts` — `extractPrNumber()` helper reused by merge orchestrator
- `adws/github/prApi.ts` — PR status check functions (`fetchPRDetails` or similar)
- `adws/github/issueApi.ts` — `commentOnIssue()` for posting completion comment
- `adws/phases/workflowCompletion.ts` — Reference for `completeWorkflow` pattern (merge orchestrator writes `completed` directly)
- `adws/adwChore.tsx` — Reference for thin orchestrator pattern (CLI parsing, state writes, approve+handoff)
- `adws/adwSdlc.tsx` — Reference for the approve + `awaiting_merge` write pattern
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed
- `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md` — Conditional doc: awaiting_merge handoff pattern
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — Conditional doc: top-level workflow state
- `app_docs/feature-cwiuik-1773818764164-auto-merge-approved-pr.md` — Conditional doc: auto-merge webhook handler

### New Files
- `adws/adwMerge.tsx` — New thin merge orchestrator
- `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` — Unit tests for cron `awaiting_merge` detection and spawn logic

## Implementation Plan
### Phase 1: Foundation
Add the `Merge` orchestrator identifier to the `OrchestratorId` registry and the `deriveOrchestratorScript` name map. These are trivial additions that unblock the rest of the work.

### Phase 2: Core Implementation
1. **`adwMerge.tsx`**: Create the thin merge orchestrator. It:
   - Parses CLI args (issue number, adw-id) via `parseOrchestratorArguments`
   - Reads the top-level state file via `AgentStateManager.readTopLevelState(adwId)`
   - Extracts PR URL, branch name, worktree path, and default branch from state
   - Checks if the PR is already merged (via `gh pr view --json state`)
   - If already merged: writes `completed` to state, posts completion comment, exits
   - If PR is open and approved: calls `mergeWithConflictResolution()` to merge
   - On merge success: writes `completed` to state, posts completion comment, exits
   - On merge failure: posts failure comment, writes `abandoned` to state, exits
   - Does NOT use `initializeWorkflow()` (no worktree setup needed for API-only merge)

2. **Cron `awaiting_merge` handling**: Modify `evaluateIssue()` in `trigger_cron.ts` to:
   - Detect `awaiting_merge` as a known stage that bypasses grace period
   - Return a new result type that carries the adw-id for spawning
   - Add a new spawn path in `checkAndTrigger()` that spawns `adwMerge.tsx` with the existing adw-id instead of calling `classifyAndSpawnWorkflow()`

### Phase 3: Integration
- Wire the `awaiting_merge` detection into the main cron polling loop
- Ensure the cron adds merge-spawned issues to `processedIssues` to prevent duplicate spawning
- Add the merge orchestrator to `deriveOrchestratorScript()` so process state queries resolve correctly

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Register merge orchestrator identifier
- Add `Merge: 'merge-orchestrator'` to the `OrchestratorId` object in `adws/core/constants.ts`
- Add `'merge-orchestrator': 'adws/adwMerge.tsx'` to the `nameMap` in `deriveOrchestratorScript()` in `adws/core/orchestratorLib.ts`

### Step 2: Create `adwMerge.tsx` thin merge orchestrator
- Create `adws/adwMerge.tsx` following the patterns in `adwChore.tsx` and `adwSdlc.tsx`
- Parse CLI args: `<issueNumber> <adw-id> [--target-repo owner/repo] [--clone-url <url>]`
- Read `AgentStateManager.readTopLevelState(adwId)` to get PR URL, branch name, worktree path, default branch
- Extract PR number via `extractPrNumber(state.prUrl)`
- If PR number is 0 or state has no PR URL: log error, write `abandoned`, exit
- Resolve repo context from `--target-repo` args or local git remote
- Check PR merge status via `gh pr view <prNumber> --repo owner/repo --json state`
- If PR already merged: write `completed` to state, post completion comment on issue, exit 0
- If PR is closed (not merged): write `abandoned` to state, log, exit 0
- If PR is open: call `mergeWithConflictResolution()` with the branch/worktree info from state
- On merge success: write `completed` to state, post completion comment on issue, exit 0
- On merge failure: post failure comment on PR, write `abandoned` to state, exit 1
- Keep the orchestrator minimal — no `CostTracker`, no `PhaseRunner`, no `initializeWorkflow()` — just direct state reads and API calls

### Step 3: Refactor cron `evaluateIssue` for `awaiting_merge` detection
- Modify `evaluateIssue()` in `adws/triggers/trigger_cron.ts` to return the `adwId` in the `FilterResult` type (add optional `adwId` and `action` fields)
- Add an explicit check for `stage === 'awaiting_merge'` BEFORE the grace period check — `awaiting_merge` bypasses grace period entirely
- Return `{ eligible: true, adwId: resolution.adwId, action: 'merge' }` for `awaiting_merge` issues
- The existing `stage === null` and `isRetriableStage()` paths continue to use `action: 'spawn'` (default)

### Step 4: Modify cron `checkAndTrigger` to spawn `adwMerge.tsx`
- Update `filterEligibleIssues()` to propagate the `adwId` and `action` from `evaluateIssue()` into the eligible list (add these fields to the eligible entry or use a richer type)
- In the `checkAndTrigger()` loop, check the `action` field on each candidate:
  - If `action === 'merge'`: spawn `adwMerge.tsx` with `[String(issue.number), adwId, ...targetRepoArgs]` using `spawn('bunx', ['tsx', 'adws/adwMerge.tsx', ...], { detached: true, stdio: 'ignore' })` and `child.unref()`
  - Otherwise: proceed with existing `classifyAndSpawnWorkflow()` path
- Add the issue to `processedIssues` for both paths to prevent duplicate spawning

### Step 5: Write unit tests for cron `awaiting_merge` detection
- Create `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`
- Test `evaluateIssue()` with `awaiting_merge` stage: verify it returns eligible with `action: 'merge'` and the correct `adwId`
- Test that `awaiting_merge` bypasses grace period (issue with recent activity should still be eligible)
- Test that non-`awaiting_merge` stages still respect grace period
- Test `filterEligibleIssues()` includes `awaiting_merge` issues in the eligible list with adwId preserved

### Step 6: Write unit tests for `adwMerge.tsx` logic
- Since `adwMerge.tsx` is an entry-point script with side effects (process.exit, spawn), extract the core merge logic into a testable function within the file or a helper module
- Test the already-merged PR handling: state read returns PR URL, `gh pr view` returns `MERGED` state → writes `completed`
- Test the closed-not-merged PR handling: `gh pr view` returns `CLOSED` → writes `abandoned`
- Test the merge success path: calls `mergeWithConflictResolution` → success → writes `completed`
- Test the merge failure path: calls `mergeWithConflictResolution` → failure → writes `abandoned`
- Test missing state or missing PR URL → writes `abandoned`

### Step 7: Update existing cronStageResolver tests
- Add tests in `adws/triggers/__tests__/cronStageResolver.test.ts` to verify that `awaiting_merge` is NOT classified as active (`isActiveStage('awaiting_merge')` returns false)
- Verify that `awaiting_merge` is NOT classified as retriable (`isRetriableStage('awaiting_merge')` returns false)
- This confirms `awaiting_merge` falls through to the cron's explicit handling, not the generic active/retriable paths

### Step 8: Run validation commands
- Run all validation commands to ensure zero regressions

## Testing Strategy
### Unit Tests
- **cronStageResolver tests**: Verify `isActiveStage('awaiting_merge')` → false and `isRetriableStage('awaiting_merge')` → false
- **triggerCronAwaitingMerge tests**: Test `evaluateIssue()` with `awaiting_merge` stage; test grace period bypass; test `filterEligibleIssues` propagation of adwId/action
- **adwMerge logic tests**: Test each branch — already merged, closed, merge success, merge failure, missing state

### Edge Cases
- State file exists but has no PR URL → orchestrator writes `abandoned` and exits gracefully
- State file exists but PR is already merged → orchestrator writes `completed` (idempotent)
- State file exists but PR is closed without merge → orchestrator writes `abandoned`
- Concurrent cron cycles detecting same `awaiting_merge` issue → `processedIssues` Set prevents duplicate spawning
- Original orchestrator process still alive when cron detects `awaiting_merge` → should not happen (orchestrator exits after writing `awaiting_merge`), but if it does, merge orchestrator proceeds (no conflict since original released worktree)
- Merge conflict during merge → `mergeWithConflictResolution` retries with `/resolve_conflict` agent
- `--target-repo` args passed from cron to `adwMerge.tsx` → repo context resolves correctly for cross-repo operation

## Acceptance Criteria
- [ ] `adwMerge.tsx` exists and can be spawned with adw-id and issue number
- [ ] Merge orchestrator reads state file, resolves conflicts if needed, merges PR
- [ ] Merge orchestrator handles already-merged PR gracefully (writes `completed`)
- [ ] Merge orchestrator writes `completed` to state file and posts completion comment
- [ ] Cron detects `awaiting_merge` in state file and spawns `adwMerge.tsx`
- [ ] `awaiting_merge` bypasses grace period in cron filtering
- [ ] `OrchestratorId.Merge` registered in constants
- [ ] `deriveOrchestratorScript` maps `merge-orchestrator` to `adws/adwMerge.tsx`
- [ ] Unit tests cover merge flow, conflict resolution, already-merged handling, cron detection
- [ ] All existing tests pass with zero regressions

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — TypeScript type checking (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type checking (adws config)
- `bun vitest run` — Run all Vitest unit tests including new merge orchestrator and cron tests
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios

## Notes
- The merge orchestrator does NOT use `initializeWorkflow()` — it reads state directly without creating a worktree, since the merge is an API-only operation.
- The merge orchestrator reuses `mergeWithConflictResolution()` from `autoMergeHandler.ts`, which handles conflict detection and resolution via the `/resolve_conflict` agent.
- If `mergeWithConflictResolution` needs a worktree for conflict resolution, the merge orchestrator should ensure a worktree exists from the state file's `worktreePath`. If the worktree was cleaned up, it can re-create one using `ensureWorktree()`.
- The `executeAutoMergePhase` in `phases/autoMergePhase.ts` is retained for potential webhook use but is not used by orchestrators. The merge orchestrator is the primary merge path.
- `awaiting_merge` is intentionally NOT added to `ACTIVE_STAGES` or `RETRIABLE_STAGES` — it's a distinct handoff stage with its own spawning logic.
- Follow `guidelines/coding_guidelines.md`: strict TypeScript, no `any`, immutability, pure functions where possible, files under 300 lines.
