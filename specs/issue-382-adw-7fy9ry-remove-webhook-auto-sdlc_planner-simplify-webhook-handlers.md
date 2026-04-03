# Feature: Simplify webhook handlers — remove auto-merge, thin out PR/issue close handlers

## Metadata
issueNumber: `382`
adwId: `7fy9ry-remove-webhook-auto`
issueJson: `{"number":382,"title":"Remove webhook auto-merge, simplify pull_request.closed and issues.closed","body":"...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T09:26:45Z","comments":[],"actionableComment":null}`

## Feature Description
Simplify the webhook to be a thin event relay by removing all orchestration work from webhook handlers. The `pull_request_review` (approved) handler should do nothing — merge is handled by the cron + `adwMerge.tsx`. The `pull_request.closed` handler should only handle abandoned PRs (closed without merge). The `issues.closed` handler absorbs worktree cleanup, remote branch deletion, and conditional dependency handling (abandoned vs normal closure) with a grace period guard to avoid cleaning up under a running orchestrator.

## User Story
As a workflow operator
I want the webhook to be a thin event relay that delegates orchestration to cron and dedicated orchestrators
So that the system has fewer race conditions, clearer ownership of cleanup responsibilities, and simpler webhook handler code

## Problem Statement
The webhook currently performs orchestration work that belongs elsewhere: auto-merging PRs on approval (now handled by cron + `adwMerge.tsx`), cleaning up worktrees and deleting branches in the `pull_request.closed` handler (should flow through `issues.closed`), and closing issues from the PR handler (duplicates GitHub auto-close). This creates race conditions and splits cleanup responsibility across multiple handlers.

## Solution Statement
1. Remove `handleApprovedReview()` from the webhook — `pull_request_review` (approved) becomes a no-op.
2. Simplify `pull_request.closed`: merged PRs do nothing (cleanup flows through `issues.closed` via GitHub auto-close); abandoned PRs write `abandoned` to state and close the linked issue.
3. Enhance `issues.closed`: absorb worktree cleanup and remote branch deletion from the old PR handler, add a grace period guard for ACTIVE workflows, and split dependency handling into abandoned (close dependents with error) vs normal (unblock dependents).

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_webhook.ts` — Main webhook server; contains the `pull_request_review`, `pull_request.closed`, and `issues.closed` handler dispatch code. All three handlers need modification.
- `adws/triggers/webhookHandlers.ts` — Contains `handlePullRequestEvent()` which currently does worktree cleanup, branch deletion, and issue closing for all PR closes. Needs rewrite.
- `adws/triggers/autoMergeHandler.ts` — Contains `handleApprovedReview()` (to be removed) and `mergeWithConflictResolution()` (to be preserved, used by `adwMerge.tsx`).
- `adws/triggers/webhookGatekeeper.ts` — Contains `handleIssueClosedDependencyUnblock()` — existing dependency unblocking logic to be preserved for normal closures.
- `adws/triggers/cronStageResolver.ts` — Contains `extractLatestAdwId()`, `isActiveStage()`, `getLastActivityFromState()` — reusable for issues.closed grace period check.
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState()` and `writeTopLevelState()` for reading/writing workflow state.
- `adws/core/stateHelpers.ts` — `findOrchestratorStatePath()` for locating orchestrator state to get branch name.
- `adws/core/config.ts` — `GRACE_PERIOD_MS` (300_000 = 5 minutes) — reuse for issues.closed grace period.
- `adws/core/workflowCommentParsing.ts` — `extractAdwIdFromComment()` for extracting adw-id from comments.
- `adws/github/issueApi.ts` — `closeIssue()`, `commentOnIssue()`, `fetchIssueCommentsRest()` for issue operations.
- `adws/github/githubApi.ts` — `RepoInfo` type, re-exports from `issueApi.ts`.
- `adws/vcs/worktreeCleanup.ts` — `removeWorktree()`, `removeWorktreesForIssue()` for worktree cleanup.
- `adws/vcs/branchOperations.ts` — `deleteRemoteBranch()` for remote branch deletion.
- `adws/types/issueTypes.ts` — `PullRequestWebhookPayload` type.
- `adws/types/agentTypes.ts` — `AgentState` type with `workflowStage` field.
- `adws/known_issues.md` — Known issues registry; `claude-cli-enoent` entry needs update.
- `adws/triggers/issueDependencies.ts` — `parseDependencies()` used by dependency unblocking.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

### Conditional Documentation
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — Merge orchestrator and cron handoff context (relevant for understanding how `awaiting_merge` flows work).
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — Top-level workflow state file context (relevant for `workflowStage` transitions).

### New Files
- `adws/triggers/__tests__/webhookHandlers.test.ts` — Unit tests for the rewritten `handlePullRequestEvent()` and new `handleIssueClosedEvent()`.

## Implementation Plan
### Phase 1: Foundation — Remove auto-merge from webhook
Remove `handleApprovedReview()` invocation from the webhook's `pull_request_review` handler. The function itself in `autoMergeHandler.ts` is retained because `mergeWithConflictResolution()` (exported from the same module) is still used by `adwMerge.tsx`. Only the webhook call path and the `handleApprovedReview()` function are removed.

### Phase 2: Core Implementation — Rewrite PR and issue close handlers
**`pull_request.closed` handler (`webhookHandlers.ts`):**
- If PR was merged: return early (do nothing — GitHub auto-close triggers `issues.closed`).
- If PR was closed without merge (abandoned):
  1. Extract issue number from branch name via `extractIssueNumberFromBranch()`.
  2. Fetch issue comments via `fetchIssueCommentsRest()`.
  3. Extract adw-id via `extractLatestAdwId()`.
  4. If adw-id found: write `abandoned` to state via `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'abandoned' })`.
  5. Close the linked issue via `closeIssue()` (cascades to `issues.closed` webhook).

**`issues.closed` handler (new `handleIssueClosedEvent()` in `webhookHandlers.ts`):**
1. Fetch issue comments via `fetchIssueCommentsRest()`.
2. Extract adw-id via `extractLatestAdwId()`.
3. If adw-id found, read state file via `AgentStateManager.readTopLevelState(adwId)`.
4. **Grace period guard**: if `isActiveStage(workflowStage)` and `getLastActivityFromState()` is within `GRACE_PERIOD_MS` of now, skip cleanup (orchestrator still running) — return early.
5. **Worktree cleanup**: call `removeWorktreesForIssue(issueNumber, cwd)`.
6. **Remote branch deletion**: read branch name from orchestrator state (`findOrchestratorStatePath()` → `readState()` → `branchName`), call `deleteRemoteBranch(branchName, cwd)`.
7. **Dependency handling**:
   - If `workflowStage === 'abandoned'`: find dependent issues, close each with an error comment explaining the parent was abandoned.
   - Otherwise: call existing `handleIssueClosedDependencyUnblock()` to unblock and spawn workflows for newly-eligible dependents.

### Phase 3: Integration — Wire up and update known issues
- Update `trigger_webhook.ts` to remove the `handleApprovedReview` import and the approved-review branch.
- Update the `pull_request.closed` dispatch to call the rewritten `handlePullRequestEvent()`.
- Update the `issues.closed` dispatch to call the new `handleIssueClosedEvent()`.
- Update `known_issues.md` `claude-cli-enoent` entry to distinguish CWD-gone (worktree deleted while process running) from binary-missing (Claude CLI not found).
- Remove `handleApprovedReview()` function from `autoMergeHandler.ts`.
- Clean up unused imports.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read conditional documentation
- Read `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` for merge orchestrator context.
- Read `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` for top-level state file context.
- Read `guidelines/coding_guidelines.md` for coding guidelines.

### Step 2: Remove `handleApprovedReview()` from webhook dispatch
- In `adws/triggers/trigger_webhook.ts`:
  - Remove the `import { handleApprovedReview } from './autoMergeHandler'` line.
  - In the `pull_request_review` handler (the `event === 'pull_request_review'` block): remove the `if (reviewState === 'approved')` branch that calls `handleApprovedReview()`. The approved review should now be treated the same as any other review — just ignored (return `{ status: 'ignored' }`) or dispatch to `adwPrReview.tsx` like non-approved reviews. Since the webhook does nothing on approval, simply return `{ status: 'ignored' }` for approved reviews.
  - Clean up the `PR_REVIEW_COOLDOWN_MS` and `recentPrReviewTriggers` cooldown map if no longer needed for the approved path (they are still needed for `pull_request_review_comment` and non-approved reviews).

### Step 3: Remove `handleApprovedReview()` function from `autoMergeHandler.ts`
- Delete the `handleApprovedReview()` function from `adws/triggers/autoMergeHandler.ts`.
- Keep `mergeWithConflictResolution()`, `checkMergeConflicts()`, `resolveConflictsViaAgent()`, `pushBranchChanges()`, and `isMergeConflictError()` — these are used by `adwMerge.tsx`.
- Remove imports that are only used by `handleApprovedReview()` (check each import).
- Update the `trigger_webhook.ts` re-exports if any reference `handleApprovedReview`.

### Step 4: Rewrite `handlePullRequestEvent()` in `webhookHandlers.ts`
- **If PR was merged** (`pull_request.merged === true`): return `{ status: 'ignored' }` immediately. Cleanup flows through `issues.closed` via GitHub auto-close.
- **If PR was closed without merge** (abandoned):
  1. Extract issue number from `pull_request.head.ref` via `extractIssueNumberFromBranch()`.
  2. If no issue number found: return `{ status: 'ignored' }`.
  3. Build `RepoInfo` from payload.
  4. Fetch issue comments via `fetchIssueCommentsRest(issueNumber, repoInfo)`.
  5. Extract adw-id via `extractLatestAdwId(comments)` (import from `cronStageResolver.ts`).
  6. If adw-id found: write `abandoned` to state via `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'abandoned' })`.
  7. Close the linked issue via `closeIssue(issueNumber, repoInfo, comment)` with a comment indicating the PR was abandoned.
  8. Return `{ status: 'abandoned', issue: issueNumber }`.
- Remove worktree cleanup and remote branch deletion from this handler (moved to `issues.closed`).
- Remove the `removeWorktree` and `deleteRemoteBranch` imports (no longer needed here).
- Add imports for `fetchIssueCommentsRest`, `extractLatestAdwId`, `AgentStateManager`.

### Step 5: Create `handleIssueClosedEvent()` in `webhookHandlers.ts`
- Create a new exported async function `handleIssueClosedEvent(issueNumber, repoInfo, cwd?)`.
- **Fetch comments**: call `fetchIssueCommentsRest(issueNumber, repoInfo)`.
- **Extract adw-id**: call `extractLatestAdwId(comments)`.
- **Read state**: if adw-id found, call `AgentStateManager.readTopLevelState(adwId)`.
- **Grace period guard**: if state exists and `isActiveStage(workflowStage)` and `(now - getLastActivityFromState(state)) < GRACE_PERIOD_MS`, log skip reason and return `{ status: 'skipped', reason: 'active_within_grace_period' }`.
- **Worktree cleanup**: call `removeWorktreesForIssue(issueNumber, cwd)`.
- **Remote branch deletion**:
  - If adw-id and state exist: get branch name from orchestrator state via `findOrchestratorStatePath(adwId)` → `AgentStateManager.readState(statePath)` → `branchName`.
  - If branch name found: call `deleteRemoteBranch(branchName, cwd)`.
- **Dependency handling**:
  - If `workflowStage === 'abandoned'`: call new helper `closeAbandonedDependents(issueNumber, repoInfo)`.
  - Else: call existing `handleIssueClosedDependencyUnblock(issueNumber, repoInfo, targetRepoArgs)`.
- Return cleanup results (worktrees removed count, branch deleted, dependencies handled).

### Step 6: Create `closeAbandonedDependents()` helper in `webhookGatekeeper.ts`
- New exported async function that finds open issues depending on the closed (abandoned) issue.
- Reuse the same pattern as `handleIssueClosedDependencyUnblock()`:
  1. Fetch open issues via `gh issue list`.
  2. Parse dependencies via `parseDependencies()`.
  3. For each dependent: post an error comment explaining the parent issue was abandoned and close the dependent issue.
  4. Error comment template: `"## Blocked Issue Abandoned\n\nThis issue depends on #${closedIssueNumber} which was abandoned (PR closed without merge). Closing this issue as it can no longer proceed.\n\nReopen this issue and its parent if you want to retry."`.

### Step 7: Wire up `handleIssueClosedEvent()` in `trigger_webhook.ts`
- In the `issues.closed` handler (the `action === 'closed'` block):
  - Replace the inline worktree cleanup logic with a call to `handleIssueClosedEvent()`.
  - Import `handleIssueClosedEvent` from `./webhookHandlers`.
  - Pass `issueNumber`, `closedRepoInfo`, and `cwd` to the new handler.
  - The handler returns results; log them.
  - Remove the inline `removeWorktreesForIssue()` call and the separate `handleIssueClosedDependencyUnblock()` call (both are now inside `handleIssueClosedEvent()`).
  - Pass `closedTargetRepoArgs` through for the non-abandoned dependency unblock path.

### Step 8: Update `known_issues.md` — `claude-cli-enoent`
- Update the `claude-cli-enoent` entry description to distinguish two failure modes:
  1. **CWD gone**: The worktree directory was deleted while the orchestrator process was still running (now mitigated by the grace period guard in `issues.closed`).
  2. **Binary missing**: Claude CLI binary not found due to auto-update replacing the symlink target (existing mitigation with retry + path re-resolution).
- Update the `description` and `solution` fields accordingly.

### Step 9: Write unit tests for webhook handlers
- Create `adws/triggers/__tests__/webhookHandlers.test.ts`.
- Use the dependency injection pattern from `adwMerge.test.ts` — inject dependencies to avoid real `gh` CLI calls.
- Refactor `handlePullRequestEvent()` and `handleIssueClosedEvent()` to accept injectable deps (similar to `MergeDeps` pattern in `adwMerge.tsx`).
- **Test cases for `handlePullRequestEvent()`**:
  - Merged PR: returns `ignored`, no side effects.
  - Abandoned PR with adw-id: writes `abandoned` to state, closes issue.
  - Abandoned PR without adw-id: closes issue without state write.
  - Abandoned PR with no issue number in branch: returns `ignored`.
- **Test cases for `handleIssueClosedEvent()`**:
  - Normal closure (completed workflow): cleans up worktree, deletes branch, unblocks dependents.
  - Abandoned closure: cleans up worktree, deletes branch, closes dependents with error.
  - Active stage within grace period: skips cleanup entirely.
  - Active stage outside grace period: proceeds with cleanup.
  - No adw-id found: cleans up worktree only (no state, no branch deletion from state, still unblocks dependents).
  - No state file: cleans up worktree, unblocks dependents (treats as normal closure).

### Step 10: Clean up imports and re-exports
- In `adws/triggers/trigger_webhook.ts`:
  - Update the re-export line to remove `handleApprovedReview` if previously exported.
  - Add `handleIssueClosedEvent` to re-exports if needed.
- In `adws/triggers/autoMergeHandler.ts`:
  - Remove imports only used by the deleted `handleApprovedReview()`.
- Verify no other files import `handleApprovedReview` (grep the codebase).

### Step 11: Run validation commands
- Run `bun run lint` to check for linting issues.
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` for type checking.
- Run `bun run build` to verify no build errors.
- Run `bun vitest run` to run unit tests.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to run BDD regression scenarios.

## Testing Strategy
### Unit Tests
- `adws/triggers/__tests__/webhookHandlers.test.ts` — Tests for `handlePullRequestEvent()` and `handleIssueClosedEvent()` with injectable dependencies covering:
  - Merged PR no-op, abandoned PR state write + issue close, missing adw-id, missing issue number.
  - Normal closure cleanup + dependency unblock, abandoned closure + dependent closing, grace period skip, no state file fallback.
- Existing tests in `adws/__tests__/adwMerge.test.ts` and `adws/triggers/__tests__/cronStageResolver.test.ts` should continue to pass unchanged.

### Edge Cases
- PR closed without merge but no `issue-N` pattern in branch name — handler should return `ignored`.
- Issue closed with no ADW comments (never processed by ADW) — should clean up worktrees by pattern only, unblock any dependents.
- Issue closed with ADW state file but no orchestrator state (missing branch name) — should clean up worktrees by pattern, skip remote branch deletion.
- Issue closed while orchestrator is actively running (ACTIVE stage, recent timestamp) — grace period guard prevents cleanup, orchestrator completes normally.
- Issue closed with `paused` workflow stage — not ACTIVE, so cleanup proceeds normally.
- Issue closed with `awaiting_merge` stage — not ACTIVE (checked by `isActiveStage()`), so cleanup proceeds.
- Multiple worktrees matching the same issue number — `removeWorktreesForIssue()` handles this already.
- `fetchIssueCommentsRest()` fails (network error) — should catch error and proceed with basic cleanup (no state-aware behavior).
- Dependent issue already closed — `closeIssue()` returns `false` gracefully.

## Acceptance Criteria
- [ ] `handleApprovedReview()` removed from webhook (`trigger_webhook.ts` no longer imports or calls it).
- [ ] `handleApprovedReview()` function deleted from `autoMergeHandler.ts`.
- [ ] `pull_request_review` (approved) handler returns `ignored` — does nothing.
- [ ] `pull_request.closed` (merged) handler does nothing (returns `ignored`).
- [ ] `pull_request.closed` (not merged) writes `abandoned` to state file and closes linked issue.
- [ ] `issues.closed` cleans up worktree and remote branch.
- [ ] `issues.closed` skips cleanup when stage is ACTIVE and within grace period.
- [ ] `issues.closed` closes dependents with error comment when stage is `abandoned`.
- [ ] `issues.closed` unblocks dependents on normal closure (existing behavior preserved).
- [ ] `mergeWithConflictResolution()` still works (used by `adwMerge.tsx`) — not deleted.
- [ ] Tests pass: abandoned flow, normal closure flow, active stage guard, dependency handling.
- [ ] `known_issues.md` `claude-cli-enoent` updated to distinguish CWD-gone from binary-missing.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type check root project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws subproject.
- `bun run build` — Build the application to verify no build errors.
- `bun vitest run` — Run all unit tests (including new webhook handler tests).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run BDD regression scenarios to validate no regressions.

## Notes
- `mergeWithConflictResolution()` and its supporting functions (`checkMergeConflicts`, `resolveConflictsViaAgent`, `pushBranchChanges`, `isMergeConflictError`) in `autoMergeHandler.ts` MUST be preserved — they are used by `adwMerge.tsx`. Only `handleApprovedReview()` is deleted.
- The `GRACE_PERIOD_MS` constant (300,000ms = 5 minutes) already exists in `adws/core/config.ts` and is used by the cron trigger. Reuse it for the `issues.closed` grace period guard.
- `extractLatestAdwId()` from `cronStageResolver.ts` scans comments newest-to-oldest — it works with the `IssueCommentSummary[]` type from `fetchIssueCommentsRest()` since both have a `body: string` property.
- The `isActiveStage()` function returns `true` for `starting`, `*_running`, and intermediate `*_completed` stages (but NOT terminal `completed`). This correctly identifies running orchestrators.
- When `pull_request.closed` (abandoned) closes the linked issue, GitHub fires `issues.closed` as a webhook event. This cascade is intentional — the `issues.closed` handler then performs cleanup. The `abandoned` stage is already written to state before the issue is closed, so `issues.closed` will see it and route to the abandoned dependency handling path.
- The dependency injection pattern (like `MergeDeps` in `adwMerge.tsx`) should be used for `handlePullRequestEvent()` and `handleIssueClosedEvent()` to enable unit testing without real `gh` CLI calls.
- Follow existing patterns in the codebase: pure functions with injected side effects, error logging with `log()`, and the `RepoInfo` type for repository context.
