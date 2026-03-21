# Feature: Auto-approve and merge PRs after review passes in review orchestrators

## Metadata
issueNumber: `258`
adwId: `fvzdz7-auto-approve-and-mer`
issueJson: `{"number":258,"title":"Auto-approve and merge PRs after review passes in review orchestrators","body":"## Summary\n\nAll ADW orchestrators with review capabilities should auto-approve and merge pull requests after the internal review phase passes (no blockers), eliminating the need for manual human approval.\n\n## Affected Orchestrators\n\n- `adwPlanBuildReview.tsx`\n- `adwPlanBuildTestReview.tsx`\n- `adwSdlc.tsx`\n\n## Design Decisions\n\n### Approval Identity Logic\n- **GitHub App configured** (PR authored by bot): Temporarily unset `GH_TOKEN` so `gh pr review --approve` uses the personal `gh auth login` identity — a different user from the bot author.\n- **No GitHub App** (PR authored by personal account): Skip approval entirely, go straight to `gh pr merge`.\n\n### Merge Strategy\n- Reuse existing `mergePR()` which uses `gh pr merge --merge` (merge commit strategy).\n\n### Conflict Resolution\n- Extract the core retry loop from `autoMergeHandler.ts` into a shared function `mergeWithConflictResolution(prNumber, repoInfo, headBranch, baseBranch, worktreePath, adwId)`.\n- Refactor `handleApprovedReview` to call the extracted function.\n- Use `/resolve_conflict` skill for conflict resolution (same as existing auto-merge handler).\n\n### Phase Placement\n- New `executeAutoMergePhase` — always the **last phase** in all three orchestrators.\n- `adwSdlc` order: … → Review → Doc → PR → KPI → **AutoMerge**\n- `adwPlanBuildTestReview` order: … → Review → PR → **AutoMerge**\n- `adwPlanBuildReview` order: … → Review → PR → **AutoMerge**\n\n### Failure Behavior\n- If merge fails after exhausting retries: log warning, post PR comment, but **workflow completes successfully** (non-fatal).\n\n### Webhook Race Condition\n- No guard needed — if the orchestrator's approval triggers the webhook auto-merge path concurrently, the second attempt fails harmlessly (PR already merged).\n\n## Implementation Plan\n\n1. Extract `mergeWithConflictResolution()` from `autoMergeHandler.ts` into a shared function\n2. Refactor `handleApprovedReview` to call the extracted function\n3. Create `approvePR()` function in `prApi.ts` that handles the identity swap logic (`gh pr review --approve`)\n4. Create `phases/autoMergePhase.ts` with `executeAutoMergePhase`\n5. Wire into all 3 review orchestrators as the final phase\n6. Export from `workflowPhases.ts` barrel\n\n## Key Files\n\n- `adws/triggers/autoMergeHandler.ts` — extract shared merge logic\n- `adws/github/prApi.ts` — new `approvePR()` function\n- `adws/phases/autoMergePhase.ts` — new phase (to be created)\n- `adws/adwPlanBuildReview.tsx` — add auto-merge phase\n- `adws/adwPlanBuildTestReview.tsx` — add auto-merge phase\n- `adws/adwSdlc.tsx` — add auto-merge phase\n- `adws/workflowPhases.ts` — export new phase","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-21T21:25:03Z","comments":[],"actionableComment":null}`

## Feature Description
All ADW orchestrators with review capabilities (`adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwSdlc`) should auto-approve and merge pull requests after the internal review phase passes with no blockers, eliminating the need for manual human approval. This involves:

1. Extracting the core merge-with-conflict-resolution retry loop from the existing webhook-based `autoMergeHandler.ts` into a shared function that both the webhook handler and the new in-process phase can reuse.
2. Creating an `approvePR()` function that handles the GitHub App identity swap (temporarily unsetting `GH_TOKEN` so the personal `gh auth login` identity approves the bot-authored PR).
3. Building a new `executeAutoMergePhase` that orchestrates approval + merge as the final phase in each review-capable orchestrator.

## User Story
As an ADW operator
I want pull requests to be automatically approved and merged after the internal review phase passes
So that the full development lifecycle completes without manual intervention

## Problem Statement
Currently, after ADW's internal review phase passes and a PR is created, the PR sits waiting for a human to manually approve and merge it. This creates unnecessary delay in the automated pipeline and requires human attention for a routine step that the system has already validated.

## Solution Statement
Add a new `executeAutoMergePhase` that runs as the final phase in all three review-capable orchestrators. The phase approves the PR (when a GitHub App is configured, using the personal identity to avoid self-approval) and merges it using the existing `mergePR()` function with the conflict resolution retry loop extracted from the webhook auto-merge handler. Failures are non-fatal — a comment is posted on the PR but the workflow completes successfully.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/autoMergeHandler.ts` — contains the existing merge retry loop logic to extract into a shared `mergeWithConflictResolution()` function; `handleApprovedReview` must be refactored to call the extracted function
- `adws/github/prApi.ts` — add new `approvePR()` function with GitHub App identity swap logic
- `adws/github/githubApi.ts` — re-export `approvePR` from `prApi.ts`
- `adws/github/index.ts` — re-export `approvePR` and `isGitHubAppConfigured` for use by the phase
- `adws/github/githubAppAuth.ts` — contains `isGitHubAppConfigured()` used to determine approval strategy
- `adws/phases/index.ts` — export the new `executeAutoMergePhase` from the phases barrel
- `adws/workflowPhases.ts` — re-export `executeAutoMergePhase` in the top-level barrel
- `adws/adwPlanBuildReview.tsx` — wire `executeAutoMergePhase` as the last phase after PR creation
- `adws/adwPlanBuildTestReview.tsx` — wire `executeAutoMergePhase` as the last phase after PR creation
- `adws/adwSdlc.tsx` — wire `executeAutoMergePhase` as the last phase after KPI tracking
- `adws/agents/index.ts` — exports `getPlanFilePath` and `planFileExists` used by the phase
- `adws/core/index.ts` — exports `MAX_AUTO_MERGE_ATTEMPTS`, `log`, `emptyModelUsageMap`
- `adws/cost/index.ts` — exports `createPhaseCostRecords`, `PhaseCostStatus`, `PhaseCostRecord`
- `adws/phases/workflowInit.ts` — contains `WorkflowConfig` type used by the phase signature
- `app_docs/feature-cwiuik-1773818764164-auto-merge-approved-pr.md` — existing auto-merge feature docs for context
- `guidelines/coding_guidelines.md` — coding guidelines that must be followed

### New Files
- `adws/phases/autoMergePhase.ts` — new phase module implementing `executeAutoMergePhase`

## Implementation Plan
### Phase 1: Foundation — Extract shared merge logic and add approvePR
Extract the core merge-with-conflict-resolution retry loop from `autoMergeHandler.ts` into a shared, exported function `mergeWithConflictResolution(prNumber, repoInfo, headBranch, baseBranch, worktreePath, adwId, logsDir, specPath)`. This function encapsulates:
- Conflict detection via dry-run merge
- Conflict resolution via the `/resolve_conflict` agent
- Push and `gh pr merge` with retry up to `MAX_AUTO_MERGE_ATTEMPTS`
- Classification of conflict vs non-conflict errors

Refactor `handleApprovedReview` to call the extracted function instead of duplicating the logic.

Create `approvePR(prNumber, repoInfo)` in `prApi.ts` that:
- Temporarily unsets `GH_TOKEN` to force `gh` to use the personal `gh auth login` identity
- Calls `gh pr review --approve --repo owner/repo`
- Restores `GH_TOKEN` in a `finally` block regardless of outcome
- Returns `{ success: boolean; error?: string }`

### Phase 2: Core Implementation — Create autoMergePhase
Create `adws/phases/autoMergePhase.ts` with `executeAutoMergePhase(config: WorkflowConfig)`:
1. Extract PR number from `config.ctx.prUrl`
2. Derive `RepoInfo` from `config.repoContext`
3. Resolve the spec path for the `/resolve_conflict` agent (best-effort)
4. If `isGitHubAppConfigured()`: call `approvePR()` — log warning on failure but continue (non-fatal)
5. If no GitHub App: skip approval, merge directly
6. Call `mergeWithConflictResolution()` for the merge with retries
7. On merge failure: post a failure comment on the PR, log warning, but do not throw
8. Return cost records with `emptyModelUsageMap()` (no LLM tokens used in this phase beyond potential conflict resolution)

### Phase 3: Integration — Wire into orchestrators
1. Export `executeAutoMergePhase` from `adws/phases/index.ts`
2. Re-export from `adws/workflowPhases.ts`
3. Import and call `executeAutoMergePhase(config)` as the last phase before `completeWorkflow()` in:
   - `adwPlanBuildReview.tsx`: after PR phase
   - `adwPlanBuildTestReview.tsx`: after PR phase
   - `adwSdlc.tsx`: after KPI phase
4. Commit phase cost data after the auto-merge phase completes

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extract `mergeWithConflictResolution()` from `autoMergeHandler.ts`
- Read `adws/triggers/autoMergeHandler.ts`
- Extract the retry loop (conflict detection → agent resolution → push → merge → retry on conflict errors) into a new exported function: `mergeWithConflictResolution(prNumber, repoInfo, headBranch, baseBranch, worktreePath, adwId, logsDir, specPath)`
- The function returns `Promise<{ success: boolean; error?: string }>`
- Keep all existing helper functions (`checkMergeConflicts`, `resolveConflictsViaAgent`, `pushBranchChanges`, `isMergeConflictError`) as module-private
- Refactor `handleApprovedReview` to call `mergeWithConflictResolution()` instead of inlining the retry loop
- Ensure the function uses `MAX_AUTO_MERGE_ATTEMPTS` from `../core`

### Step 2: Create `approvePR()` function in `prApi.ts`
- Read `adws/github/prApi.ts`
- Add `approvePR(prNumber: number, repoInfo: RepoInfo): { success: boolean; error?: string }`
- Implementation:
  - Save `process.env.GH_TOKEN` to a local variable
  - `delete process.env.GH_TOKEN` to force `gh` to use the personal `gh auth login` identity
  - Call `gh pr review ${prNumber} --approve --repo ${owner}/${repo}`
  - Restore `GH_TOKEN` in a `finally` block (only if it was previously defined)
  - Return success/error result matching the `mergePR` pattern

### Step 3: Export `approvePR` from barrel files
- Add `approvePR` to the re-export list in `adws/github/githubApi.ts`
- Add `approvePR` to the export list in `adws/github/index.ts`
- Also ensure `isGitHubAppConfigured` is already exported from `adws/github/index.ts` (it should be from `githubAppAuth.ts`)

### Step 4: Create `adws/phases/autoMergePhase.ts`
- Create a new file `adws/phases/autoMergePhase.ts`
- Import from `../core`: `log`, `emptyModelUsageMap`, `ModelUsageMap`
- Import from `../cost`: `createPhaseCostRecords`, `PhaseCostStatus`, `PhaseCostRecord`
- Import from `../github`: `commentOnPR`, `approvePR`, `isGitHubAppConfigured`, `RepoInfo`
- Import from `../triggers/autoMergeHandler`: `mergeWithConflictResolution`
- Import from `../agents`: `getPlanFilePath`, `planFileExists`
- Import `WorkflowConfig` from `./workflowLifecycle`
- Implement `extractPrNumber(prUrl)`: parse PR number from GitHub PR URL (e.g. `https://github.com/owner/repo/pull/42`)
- Implement `executeAutoMergePhase(config: WorkflowConfig)`:
  1. Extract PR number from `config.ctx.prUrl` — return early if missing
  2. Derive `RepoInfo` from `config.repoContext.repoId` — return early if missing
  3. Determine head/base branch from config
  4. Resolve spec path via `getPlanFilePath`/`planFileExists` (best-effort)
  5. If `isGitHubAppConfigured()`: call `approvePR(prNumber, repoInfo)`, log warning on failure
  6. Else: log that approval is skipped (personal account authored PR)
  7. Call `mergeWithConflictResolution(prNumber, repoInfo, headBranch, baseBranch, worktreePath, adwId, logsDir, specPath)`
  8. On failure: build failure comment, post via `commentOnPR`, log warning
  9. On success: log success
  10. Create and return `PhaseCostRecord[]` with phase `'auto_merge'` and `PhaseCostStatus.Success`

### Step 5: Export from barrel files
- Add `export { executeAutoMergePhase } from './autoMergePhase';` to `adws/phases/index.ts`
- Add `executeAutoMergePhase` to the export list in `adws/workflowPhases.ts`

### Step 6: Wire into `adwPlanBuildReview.tsx`
- Read `adws/adwPlanBuildReview.tsx`
- Add `executeAutoMergePhase` to the import from `./workflowPhases`
- After the PR phase result handling and before `completeWorkflow()`:
  ```typescript
  const autoMergeResult = await executeAutoMergePhase(config);
  await commitPhasesCostData(config, autoMergeResult.phaseCostRecords);
  ```
- Update the JSDoc workflow list to include the AutoMerge phase

### Step 7: Wire into `adwPlanBuildTestReview.tsx`
- Read `adws/adwPlanBuildTestReview.tsx`
- Add `executeAutoMergePhase` to the import from `./workflowPhases`
- After the PR phase result handling and before `completeWorkflow()`:
  ```typescript
  const autoMergeResult = await executeAutoMergePhase(config);
  await commitPhasesCostData(config, autoMergeResult.phaseCostRecords);
  ```
- Update the JSDoc workflow list to include the AutoMerge phase

### Step 8: Wire into `adwSdlc.tsx`
- Read `adws/adwSdlc.tsx`
- Add `executeAutoMergePhase` to the import from `./workflowPhases`
- After the KPI phase result handling and before `completeWorkflow()`:
  ```typescript
  const autoMergeResult = await executeAutoMergePhase(config);
  await commitPhasesCostData(config, autoMergeResult.phaseCostRecords);
  ```
- Update the JSDoc workflow list to include the AutoMerge phase

### Step 9: Run validation commands
- Run all validation commands listed below to ensure no regressions

## Testing Strategy

### Edge Cases
- **No PR URL in context**: `executeAutoMergePhase` returns early with empty cost records when `ctx.prUrl` is absent (e.g. PR phase was skipped or failed)
- **No repo context**: Phase returns early if `repoContext` is missing owner/repo info
- **PR already merged**: If the webhook auto-merge handler merges the PR concurrently, the phase's `mergePR` call fails harmlessly — the PR is already merged. The `isMergeConflictError` check ensures the retry loop stops on non-conflict errors.
- **GitHub App not configured**: Approval is skipped, merge proceeds directly — handles personal-account-authored PRs correctly
- **Approval failure**: If `approvePR` fails (e.g. insufficient permissions), the phase logs a warning and proceeds to merge anyway, since the PR may still be mergeable without approval
- **Merge conflicts**: The `mergeWithConflictResolution` retry loop handles conflicts via the `/resolve_conflict` agent, up to `MAX_AUTO_MERGE_ATTEMPTS` retries
- **Non-conflict merge failure**: Retry loop stops immediately on branch protection violations or other non-conflict errors
- **All retries exhausted**: Failure comment is posted on the PR, workflow completes successfully

## Acceptance Criteria
- `approvePR()` in `prApi.ts` temporarily unsets `GH_TOKEN` and calls `gh pr review --approve`, then restores `GH_TOKEN` in a `finally` block
- `mergeWithConflictResolution()` is exported from `autoMergeHandler.ts` and used by both `handleApprovedReview` and `executeAutoMergePhase`
- `executeAutoMergePhase` exists in `adws/phases/autoMergePhase.ts` and is exported through barrel files
- `adwPlanBuildReview.tsx` calls `executeAutoMergePhase` as its last phase before `completeWorkflow`
- `adwPlanBuildTestReview.tsx` calls `executeAutoMergePhase` as its last phase before `completeWorkflow`
- `adwSdlc.tsx` calls `executeAutoMergePhase` after KPI phase and before `completeWorkflow`
- Merge failures are non-fatal: warning logged, PR comment posted, workflow completes
- `bun run lint` passes with no errors
- `bun run build` passes with no errors
- `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Run root TypeScript type checker
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run ADW-specific TypeScript type checker

## Notes
- The `guidelines/coding_guidelines.md` must be followed. Key points: clarity over cleverness, single responsibility, type safety, immutability, isolate side effects at boundaries.
- The auto-merge phase produces no LLM token cost itself (returns `emptyModelUsageMap()`), though the `/resolve_conflict` agent invoked during conflict resolution does — but that cost is not tracked by this phase since it runs inside the shared `mergeWithConflictResolution` function.
- No webhook race condition guard is needed: if the orchestrator's approval triggers the webhook auto-merge path concurrently, the second merge attempt fails harmlessly because the PR is already merged.
- The `incomingBranch` passed to `/resolve_conflict` is the **base** branch (e.g. `main`), not the head branch, because base branch changes are being merged *into* the PR branch.
