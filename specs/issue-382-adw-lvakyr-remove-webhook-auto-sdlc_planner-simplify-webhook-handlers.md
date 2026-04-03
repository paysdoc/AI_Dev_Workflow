# Feature: Simplify webhook handlers — remove auto-merge, thin event relay

## Metadata
issueNumber: `382`
adwId: `lvakyr-remove-webhook-auto`
issueJson: `{"number":382,"title":"Remove webhook auto-merge, simplify pull_request.closed and issues.closed","body":"## Parent PRD\n\nspecs/prd/orchestrator-lifecycle-redesign.md\n\n## What to build\n\nSimplify the webhook to be a thin event relay. Remove all orchestration work from webhook handlers.\n\n**pull_request_review (approved):**\n- Remove handleApprovedReview() entirely from autoMergeHandler.ts / trigger_webhook.ts\n- The webhook does nothing on PR approval — merge is handled by the cron + adwMerge.tsx\n\n**pull_request.closed:**\n- If PR was merged: do nothing (cleanup flows through issues.closed via GitHub auto-close)\n- If PR was closed without merge (abandoned): find adw-id from issue comment, write abandoned to state file, close the linked issue (cascades to issues.closed)\n\n**issues.closed:**\n- Read state file via adw-id extracted from issue comments\n- If workflowStage is ACTIVE and state timestamp is within grace period: skip cleanup (orchestrator still running)\n- Otherwise: clean up worktree, delete remote branch\n- If workflowStage === abandoned: close all dependent issues with an explanatory error comment\n- If workflowStage !== abandoned: unblock dependent issues, spawn workflows for newly-eligible ones (existing behavior preserved)\n\nThe existing worktree cleanup and dependency unblocking logic in issues.closed is preserved — only the trigger conditions change. The pull_request.closed handler worktree cleanup, branch deletion, and issue closure logic moves to issues.closed.\n\nSee PRD Webhook Changes section for full details.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T09:26:45Z","comments":[],"actionableComment":null}`

## Feature Description
Simplify the ADW webhook server (`trigger_webhook.ts`) to be a thin event relay. Currently the webhook performs orchestration work (auto-merging approved PRs, worktree cleanup on PR close, issue closure). This feature removes all orchestration from webhook handlers and centralises cleanup in the `issues.closed` handler, which is the terminal event in every lifecycle path.

The merge responsibility moves to the cron trigger + `adwMerge.tsx` (already built in #381). The `pull_request.closed` handler becomes a thin relay that only marks abandoned PRs. The `issues.closed` handler gains worktree cleanup, remote branch deletion, and state-aware dependency routing (abandoned vs normal closure).

## User Story
As an ADW operator
I want webhook handlers to be thin event relays with no orchestration logic
So that merge, cleanup, and dependency handling are centralised in deterministic paths (cron + issue-closed) and the webhook is simpler to reason about and test

## Problem Statement
The webhook currently has three independent code paths that perform overlapping orchestration: `pull_request_review` (approved) triggers auto-merge, `pull_request.closed` cleans up worktrees/branches and closes issues, and `issues.closed` unblocks dependents. This duplication creates race conditions (webhook auto-merge competes with cron merge), inconsistent cleanup (worktree deleted before issue-closed fires), and makes the lifecycle hard to reason about.

## Solution Statement
1. **Remove `handleApprovedReview()`** from the webhook — merge is now handled exclusively by the cron + `adwMerge.tsx`.
2. **Simplify `pull_request.closed`** — merged PRs do nothing (GitHub auto-close cascades to `issues.closed`); abandoned PRs write `abandoned` to the state file and close the linked issue.
3. **Enhance `issues.closed`** — becomes the single cleanup point: reads state file via adw-id, applies grace-period guard, cleans up worktree + remote branch, and routes dependency handling based on `workflowStage` (abandoned → close dependents with error; normal → unblock dependents).
4. **Update `known_issues.md`** — distinguish CWD-gone ENOENT from binary-missing ENOENT.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_webhook.ts` — Main webhook server. Contains `pull_request_review`, `pull_request.closed`, and `issues.closed` handler blocks that need modification.
- `adws/triggers/webhookHandlers.ts` — Contains `handlePullRequestEvent()` and `extractIssueNumberFromBranch()`. `handlePullRequestEvent()` must be simplified (remove worktree/branch cleanup, add abandoned state write).
- `adws/triggers/autoMergeHandler.ts` — Contains `handleApprovedReview()` (to be removed from webhook) and `mergeWithConflictResolution()` (kept, shared with `autoMergePhase.ts` and `adwMerge.tsx`).
- `adws/triggers/webhookGatekeeper.ts` — Contains `handleIssueClosedDependencyUnblock()`. Needs new `handleIssueClosedAbandonedDependents()` function for the abandoned path.
- `adws/core/workflowCommentParsing.ts` — Contains `extractAdwIdFromComment()` and `extractBranchNameFromComment()` used for state file lookup and branch identification.
- `adws/core/agentState.ts` — Contains `AgentStateManager.readTopLevelState()` and `writeTopLevelState()` for reading/writing workflow state.
- `adws/core/config.ts` — Contains `GRACE_PERIOD_MS` (300,000ms = 5 minutes) constant.
- `adws/triggers/cronStageResolver.ts` — Contains `isActiveStage()`, `getLastActivityFromState()`, `extractLatestAdwId()` for state-file-based stage resolution.
- `adws/github/issueApi.ts` — Contains `fetchIssueCommentsRest()`, `closeIssue()`, `commentOnIssue()`, `formatIssueClosureComment()`.
- `adws/vcs/worktreeCleanup.ts` — Contains `removeWorktreesForIssue()`, `removeWorktree()`.
- `adws/vcs/branchOperations.ts` — Contains `deleteRemoteBranch()`.
- `adws/types/agentTypes.ts` — Contains `AgentState` interface with `workflowStage` field.
- `adws/known_issues.md` — Known runtime issues registry. Update `claude-cli-enoent` entry.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

### New Files
- `adws/triggers/__tests__/webhookHandlers.test.ts` — Unit tests for `handlePullRequestEvent()` (abandoned/merged flows) and `handleIssueClosedEvent()` (grace period, cleanup, dependency routing).
- `adws/triggers/__tests__/webhookGatekeeper.abandoned.test.ts` — Unit tests for `handleIssueClosedAbandonedDependents()`.
- `features/simplify_webhook_handlers.feature` — BDD feature file for the simplified webhook handler flows.
- `features/step_definitions/simplify_webhook_handlers.steps.ts` — Step definitions for the BDD feature.

## Implementation Plan
### Phase 1: Foundation — Simplify PR review and PR closed handlers
Remove the `handleApprovedReview()` call from the webhook and simplify `handlePullRequestEvent()`. This is the deletion/simplification phase with minimal new logic.

Key changes:
- In `trigger_webhook.ts`: remove `handleApprovedReview` import, change `pull_request_review` (approved) to return `{ status: 'ignored' }`
- In `webhookHandlers.ts`: modify `handlePullRequestEvent()` so merged PRs return immediately; abandoned PRs extract adw-id from issue comments, write `abandoned` to state file, and close the linked issue
- Remove worktree cleanup and remote branch deletion from `handlePullRequestEvent()` (these move to `issues.closed`)

### Phase 2: Core Implementation — Enhance issues.closed handler
Build the new `handleIssueClosedEvent()` function and the abandoned-dependents handler. This is where the cleanup and dependency routing logic consolidates.

Key changes:
- Add `handleIssueClosedEvent()` to `webhookHandlers.ts`: fetches issue comments, extracts adw-id, reads state file, applies grace-period guard, cleans up worktree + deletes remote branch
- Add `handleIssueClosedAbandonedDependents()` to `webhookGatekeeper.ts`: closes dependent issues with an explanatory error comment
- Update `trigger_webhook.ts` `issues.closed` block to call the new handler and route dependency handling based on the returned workflow stage

### Phase 3: Integration — Tests, known issues update, validation
Write unit tests, BDD scenarios, and update the known issues registry.

Key changes:
- Unit tests for abandoned flow, normal closure flow, active stage guard, dependency handling
- BDD feature file covering the webhook simplification acceptance criteria
- Update `claude-cli-enoent` in `known_issues.md` to distinguish CWD-gone from binary-missing

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Remove `handleApprovedReview()` from webhook
- In `adws/triggers/trigger_webhook.ts`:
  - Remove the `import { handleApprovedReview } from './autoMergeHandler'` line
  - In the `pull_request_review` event handler block (lines ~117-130), remove the `if (reviewState === 'approved')` branch that calls `handleApprovedReview(body)`
  - Replace with: when `reviewState === 'approved'`, return `jsonResponse(res, 200, { status: 'ignored', reason: 'merge_via_cron' })`
  - Keep the non-approved review handling (spawning `adwPrReview.tsx`) unchanged
- Do NOT delete `handleApprovedReview()` from `autoMergeHandler.ts` — the function is unused by the webhook after this change, but `mergeWithConflictResolution()` in the same file is still shared with `autoMergePhase.ts` and `adwMerge.tsx`. Leave `handleApprovedReview()` in place for now; it can be removed in a future cleanup if confirmed dead.

### Step 2: Simplify `handlePullRequestEvent()` for merged PRs
- In `adws/triggers/webhookHandlers.ts`:
  - Modify `handlePullRequestEvent()` so that when `wasMerged === true`, the function logs and returns `{ status: 'merged_noop' }` immediately — no worktree cleanup, no branch deletion, no issue closure. Cleanup cascades through GitHub auto-close → `issues.closed`.
  - Remove the worktree cleanup block (lines ~54-71 in current code) and remote branch deletion block (lines ~66-71) from the function entirely — these move to the `issues.closed` handler.
  - Remove the issue closure block (lines ~73-100) for the merged case.

### Step 3: Add abandoned PR handling to `handlePullRequestEvent()`
- In `adws/triggers/webhookHandlers.ts`:
  - Add imports for `fetchIssueCommentsRest` from `../github/issueApi`, `extractAdwIdFromComment` from `../core/workflowCommentParsing`, and `AgentStateManager` from `../core/agentState`
  - When `wasMerged === false` (abandoned PR):
    1. Extract `issueNumber` from the branch name using `extractIssueNumberFromBranch(headBranch)`. If null, log and return `{ status: 'ignored' }`.
    2. Build `repoInfo` from the webhook payload.
    3. Fetch issue comments via `fetchIssueCommentsRest(issueNumber, repoInfo)`.
    4. Extract adw-id via `extractAdwIdFromComment()` from the most recent ADW comment (iterate newest-to-oldest).
    5. If adw-id found: call `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'abandoned' })`.
    6. Close the linked issue via `closeIssue(issueNumber, repoInfo, comment)` with a closure comment indicating the PR was abandoned.
  - Return `{ status: 'abandoned', issue: issueNumber }`.

### Step 4: Create `handleIssueClosedEvent()` in webhookHandlers.ts
- Add a new exported async function `handleIssueClosedEvent()` to `adws/triggers/webhookHandlers.ts`:
  ```typescript
  export interface IssueClosedResult {
    cleaned: boolean;
    workflowStage: string | null;
    adwId: string | null;
    branchName: string | null;
    skippedReason?: string;
  }

  export async function handleIssueClosedEvent(
    issueNumber: number,
    repoInfo: RepoInfo,
    cwd?: string,
  ): Promise<IssueClosedResult>
  ```
- Implementation:
  1. Fetch issue comments via `fetchIssueCommentsRest(issueNumber, repoInfo)`.
  2. Extract adw-id using `extractLatestAdwId(comments)` from `cronStageResolver.ts`.
  3. Extract branch name using `extractBranchNameFromComment()` from the comments (iterate newest-to-oldest, return first match).
  4. If no adw-id found: proceed with cleanup (legacy issue, no state file) — skip grace period check, clean worktrees, delete remote branch if branch name found, return `{ cleaned: true, workflowStage: null, adwId: null, branchName }`.
  5. If adw-id found: read state file via `AgentStateManager.readTopLevelState(adwId)`.
  6. If state has `workflowStage` that `isActiveStage()` returns true for AND `getLastActivityFromState(state)` is within `GRACE_PERIOD_MS` of `Date.now()`: return `{ cleaned: false, workflowStage, adwId, branchName, skippedReason: 'active_within_grace_period' }`.
  7. Otherwise: call `removeWorktreesForIssue(issueNumber, cwd)`, call `deleteRemoteBranch(branchName, cwd)` if branch name found, return `{ cleaned: true, workflowStage, adwId, branchName }`.

### Step 5: Create `handleIssueClosedAbandonedDependents()` in webhookGatekeeper.ts
- Add a new exported async function to `adws/triggers/webhookGatekeeper.ts`:
  ```typescript
  export async function handleIssueClosedAbandonedDependents(
    closedIssueNumber: number,
    repoInfo: RepoInfo,
  ): Promise<void>
  ```
- Implementation:
  1. Fetch open issues via `gh issue list --repo {owner}/{repo} --state open --json number,body --limit 100`.
  2. Filter issues whose body contains a dependency on `closedIssueNumber` using `parseDependencies()`.
  3. For each dependent issue: post an error comment explaining the parent issue was abandoned (PR closed without merging), then close the dependent issue via `closeIssue()`.
  4. Log the number of dependent issues closed.
- Import `closeIssue`, `commentOnIssue` from `../github`.

### Step 6: Update `issues.closed` handler in trigger_webhook.ts
- In `adws/triggers/trigger_webhook.ts`, modify the `issues.closed` block (lines ~188-198):
  - Import `handleIssueClosedEvent` from `./webhookHandlers` and `handleIssueClosedAbandonedDependents` from `./webhookGatekeeper`.
  - Replace the current inline worktree cleanup with a call to `handleIssueClosedEvent(issueNumber, closedRepoInfo, cwd)`.
  - After `handleIssueClosedEvent()` returns:
    - If `result.skippedReason`: log the skip reason and return `{ status: 'skipped', reason: result.skippedReason }`.
    - If `result.workflowStage === 'abandoned'`: call `handleIssueClosedAbandonedDependents(issueNumber, closedRepoInfo)` instead of `handleIssueClosedDependencyUnblock()`.
    - Otherwise: call the existing `handleIssueClosedDependencyUnblock(issueNumber, closedRepoInfo, closedTargetRepoArgs)` as before.
  - Remove the direct `removeWorktreesForIssue()` call from the webhook handler (now inside `handleIssueClosedEvent()`).

### Step 7: Write unit tests for `handlePullRequestEvent()`
- Create `adws/triggers/__tests__/webhookHandlers.test.ts`:
  - **Test: merged PR does nothing** — call with `merged: true`, verify no worktree cleanup, no branch deletion, no issue closure, returns `{ status: 'merged_noop' }`.
  - **Test: abandoned PR writes state and closes issue** — call with `merged: false`, mock `fetchIssueCommentsRest` to return comments with an ADW ID, verify `writeTopLevelState` is called with `{ workflowStage: 'abandoned' }`, verify `closeIssue` is called.
  - **Test: abandoned PR with no ADW comment** — call with `merged: false`, mock empty comments, verify `writeTopLevelState` is NOT called, verify issue is still closed.
  - **Test: abandoned PR with no issue number in branch** — branch name without `issue-N` pattern, verify returns `{ status: 'ignored' }`.

### Step 8: Write unit tests for `handleIssueClosedEvent()`
- Add tests to `adws/triggers/__tests__/webhookHandlers.test.ts`:
  - **Test: active stage within grace period skips cleanup** — mock state with `workflowStage: 'build_running'` and recent activity timestamp, verify `removeWorktreesForIssue` is NOT called, result has `skippedReason`.
  - **Test: active stage past grace period cleans up** — mock state with `workflowStage: 'build_running'` and old timestamp, verify cleanup runs.
  - **Test: completed stage cleans up** — mock state with `workflowStage: 'completed'`, verify cleanup runs (not active).
  - **Test: abandoned stage cleans up** — mock state with `workflowStage: 'abandoned'`, verify cleanup runs, returned `workflowStage` is `'abandoned'`.
  - **Test: no adw-id cleans up (legacy issue)** — no ADW comments, verify cleanup runs without state check.
  - **Test: remote branch deleted when branch name found** — verify `deleteRemoteBranch` is called with extracted branch name.

### Step 9: Write unit tests for `handleIssueClosedAbandonedDependents()`
- Create `adws/triggers/__tests__/webhookGatekeeper.abandoned.test.ts`:
  - **Test: closes dependent issues with error comment** — mock two dependent issues, verify both get an error comment and are closed.
  - **Test: no dependents does nothing** — mock no dependent issues, verify no API calls.
  - **Test: handles API errors gracefully** — mock `closeIssue` failure, verify error is logged but function does not throw.

### Step 10: Update `known_issues.md` for `claude-cli-enoent`
- In `adws/known_issues.md`, update the `claude-cli-enoent` entry:
  - Add a second cause: "CWD deleted (worktree removed while agent is running). When `issues.closed` fires and removes the worktree, any agent process with that worktree as its CWD gets ENOENT on the next spawn."
  - Update the description to mention both root causes.
  - Add guidance: "To distinguish: if the error path contains `.worktrees/`, the CWD was deleted. If it points to the Claude binary path, the binary is missing."

### Step 11: Run validation commands
- `bun run lint` — Check for code quality issues
- `bunx tsc --noEmit` — TypeScript type check (root)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check (adws)
- `bun run build` — Build the application
- `bun run test` — Run all tests (unit tests should pass, including new ones)

## Testing Strategy
### Unit Tests
- `adws/triggers/__tests__/webhookHandlers.test.ts`:
  - `handlePullRequestEvent()`: merged PR no-op, abandoned PR writes state + closes issue, no-ADW-comment abandoned, no issue number in branch
  - `handleIssueClosedEvent()`: active stage within grace period (skip), active stage past grace period (cleanup), completed stage (cleanup), abandoned stage (cleanup), no adw-id (legacy cleanup), remote branch deletion
- `adws/triggers/__tests__/webhookGatekeeper.abandoned.test.ts`:
  - `handleIssueClosedAbandonedDependents()`: closes dependents, no dependents, API error handling

### Edge Cases
- PR closed without merge but branch name has no `issue-N` pattern → return ignored, no state write
- Issue closed with no ADW comments at all → treat as legacy, clean up worktrees anyway
- Issue closed with ADW comment but adw-id state file doesn't exist → treat as legacy, clean up
- Issue closed while orchestrator is actively running (within grace period) → skip cleanup
- Issue closed with `workflowStage: 'paused'` → not active, proceed with cleanup
- Issue closed with `workflowStage: 'awaiting_merge'` → not active per `isActiveStage()`, proceed with cleanup
- Abandoned issue with no dependent issues → no-op for dependency handling
- Race condition: `pull_request.closed` (abandoned) writes state, then `issues.closed` fires before state is flushed → `writeTopLevelState` is synchronous (`writeFileSync`), so this is safe
- Branch name extraction from comments fails (no branch comment) → skip remote branch deletion, worktree cleanup still runs via issue number pattern

## Acceptance Criteria
- `handleApprovedReview()` is no longer called from the webhook (import removed, approved review returns ignored)
- `pull_request_review` (approved) handler returns `{ status: 'ignored' }`
- `pull_request.closed` (merged) handler does nothing — returns immediately
- `pull_request.closed` (not merged) writes `abandoned` to state file and closes linked issue
- `issues.closed` cleans up worktree and deletes remote branch
- `issues.closed` skips cleanup when `workflowStage` is ACTIVE and within `GRACE_PERIOD_MS`
- `issues.closed` closes dependent issues with error comment when stage is `abandoned`
- `issues.closed` unblocks dependents on normal closure (existing `handleIssueClosedDependencyUnblock` behavior preserved)
- All unit tests pass for abandoned flow, normal closure flow, active stage guard, dependency handling
- `known_issues.md` `claude-cli-enoent` entry updated to distinguish CWD-gone from binary-missing
- No regressions in existing tests (`bun run test`, `bun run lint`, `bunx tsc --noEmit`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — TypeScript type check (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check (adws config)
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run all unit tests to validate the feature works with zero regressions

## Notes
- `handleApprovedReview()` is left in `autoMergeHandler.ts` as dead code rather than deleted — `mergeWithConflictResolution()` in the same file is actively shared by `autoMergePhase.ts` and `adwMerge.tsx`. Removing `handleApprovedReview()` can be done in a follow-up cleanup if confirmed dead across all call sites.
- The `pull_request.closed` (merged) handler assumes GitHub auto-close is configured for the target repo (PR description contains `Closes #N` or similar). If auto-close is not configured, the issue will not be closed and worktrees will not be cleaned up until manual closure or cron intervention.
- `GRACE_PERIOD_MS` (5 minutes) is reused from the existing cron grace period constant — it represents the window during which an active orchestrator is assumed to still be running.
- The `extractBranchNameFromComment()` function in `workflowCommentParsing.ts` uses a regex pattern that matches ADW branch name formats. If the branch name is not found in comments, remote branch deletion is skipped but worktree cleanup still runs (via `removeWorktreesForIssue` which matches on issue number).
- Follow `guidelines/coding_guidelines.md`: strict TypeScript, pure functions where possible, immutable data, files under 300 lines.
