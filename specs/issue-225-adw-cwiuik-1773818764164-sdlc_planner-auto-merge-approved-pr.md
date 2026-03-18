# Feature: Auto-merge PR on approved review

## Metadata
issueNumber: `225`
adwId: `cwiuik-1773818764164`
issueJson: `{"number":225,"title":"Auto-merge PR on approved review: resolve conflicts and merge with retry","body":"## Summary\n\nWhen a pull request review is submitted with **state `approved`**, the webhook trigger should initiate an auto-merge flow instead of the current PR Review process (`adwPrReview.tsx`).\n\n## Current Behavior\n\nIn `trigger_webhook.ts` (lines 119-128), both `pull_request_review` and `pull_request_review_comment` events with action `created` or `submitted` unconditionally spawn `adwPrReview.tsx`. The review state (`approved`, `changes_requested`, `commented`) is not inspected.\n\n## Desired Behavior\n\nWhen `event === 'pull_request_review'` and `body.review.state === 'approved'`:\n\n1. **Check for merge conflicts** with the target branch (e.g. `main`)\n2. **If conflicts exist**, resolve them by calling `runClaudeAgentWithCommand('/resolve_conflict', ...)` in the PR's worktree\n3. **Attempt to merge** the pull request (via GitHub API, e.g. `gh pr merge`)\n4. **Handle race conditions**: another process may merge a different PR between conflict resolution and the merge attempt, re-introducing conflicts. The flow must be resilient:\n   - After `/resolve_conflict` succeeds, attempt the merge\n   - If the merge fails due to new conflicts (race condition), loop back: pull latest target branch changes, re-run `/resolve_conflict`, and retry the merge\n   - Cap retries to prevent infinite loops (e.g. max 3 attempts)\n   - If all retries are exhausted, post a comment on the PR explaining that auto-merge failed and manual intervention is needed\n5. **Non-approved reviews** (`changes_requested`, `commented`) should continue to trigger `adwPrReview.tsx` as before\n\n## Technical Pointers\n\n- **Webhook entry point**: `adws/triggers/trigger_webhook.ts` — branch on `body.review.state`\n- **Conflict resolution command**: `.claude/commands/resolve_conflict.md` — accepts `adwId`, `specPath`, `incomingBranch`\n- **Agent runner**: `runClaudeAgentWithCommand('/resolve_conflict', ...)` in `adws/agents/claudeAgent.ts`\n- **PR merge**: use GitHub API or `gh pr merge --merge <prNumber>`\n- **Race condition resilience**: retry loop around (resolve → push → merge), capped at a maximum number of attempts\n\n## Acceptance Criteria\n\n- [ ] Approved reviews trigger the auto-merge flow (not `adwPrReview.tsx`)\n- [ ] Non-approved reviews continue to trigger `adwPrReview.tsx`\n- [ ] Merge conflicts are detected and resolved via `/resolve_conflict`\n- [ ] Race conditions (conflicts introduced between resolve and merge) are handled with retries\n- [ ] Retries are capped; exhaustion results in a PR comment explaining the failure\n- [ ] Existing PR review deduplication (`shouldTriggerPrReview`) still applies"}`

## Feature Description
When a GitHub pull request review is submitted with state `approved`, the webhook trigger should initiate an auto-merge flow instead of the current PR Review process (`adwPrReview.tsx`). The auto-merge flow checks for merge conflicts with the target branch, resolves them using the `/resolve_conflict` Claude agent command if needed, and attempts to merge the PR via `gh pr merge`. A retry loop handles race conditions where another PR merges between conflict resolution and the merge attempt, re-introducing conflicts. Retries are capped at 3 attempts; if exhausted, a comment is posted on the PR explaining that manual intervention is needed. Non-approved reviews (`changes_requested`, `commented`) and review comments continue to trigger `adwPrReview.tsx` as before.

## User Story
As an ADW operator
I want approved PR reviews to automatically merge the PR (resolving conflicts if needed)
So that approved PRs are merged without manual intervention, reducing cycle time and keeping the codebase up-to-date

## Problem Statement
Currently, `trigger_webhook.ts` handles all `pull_request_review` and `pull_request_review_comment` events identically: it spawns `adwPrReview.tsx` regardless of the review state (`approved`, `changes_requested`, `commented`). This means approved PRs still go through a full PR review cycle instead of being merged. The operator must manually merge approved PRs, creating unnecessary delay and toil.

## Solution Statement
Branch the webhook handler on the review state. When the event is `pull_request_review` and the review state is `approved`, invoke a new auto-merge handler instead of spawning `adwPrReview.tsx`. The handler:
1. Fetches PR details to determine head/base branches and the target repo
2. Ensures a worktree exists for the PR's head branch
3. Checks for merge conflicts by attempting `git merge --no-commit --no-ff origin/{baseBranch}` (then aborting)
4. If conflicts exist, calls `runClaudeAgentWithCommand('/resolve_conflict', ...)` to resolve them, then pushes
5. Attempts `gh pr merge --merge {prNumber}` via `execSync`
6. If the merge fails due to conflicts (race condition), loops back to step 3
7. Caps retries at `MAX_AUTO_MERGE_ATTEMPTS` (3); on exhaustion, posts a failure comment on the PR
8. Non-approved `pull_request_review` events and all `pull_request_review_comment` events continue to spawn `adwPrReview.tsx`

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_webhook.ts` — Main file to modify: branch the `pull_request_review` handler on `body.review.state`
- `adws/triggers/webhookHandlers.ts` — Add the new `handleApprovedReview` auto-merge handler here, alongside existing handlers
- `adws/triggers/webhookGatekeeper.ts` — Uses `spawnDetached` pattern; reference for spawning workflows
- `adws/github/prApi.ts` — Contains `fetchPRDetails`, `commentOnPR`; add a new `mergePR` function here
- `adws/vcs/branchOperations.ts` — Contains `mergeLatestFromDefaultBranch`, `getDefaultBranch`, `getCurrentBranch`; reference for git merge patterns
- `adws/vcs/index.ts` — Re-export barrel; add new exports if needed
- `adws/agents/claudeAgent.ts` — Contains `runClaudeAgentWithCommand` used to invoke `/resolve_conflict`
- `.claude/commands/resolve_conflict.md` — The slash command that resolves merge conflicts; accepts `adwId`, `specPath`, `incomingBranch`
- `adws/core/constants.ts` — Add `MAX_AUTO_MERGE_ATTEMPTS` constant
- `adws/github/index.ts` — Re-export barrel for GitHub module; export new `mergePR` function
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `adws/phases/prReviewPhase.ts` — Reference for how PR review workflow is initialized (ensureWorktree pattern)
- `adws/vcs/worktreeCreation.ts` — Contains `ensureWorktree`, `getWorktreeForBranch`
- `adws/core/index.ts` — Core barrel exports; check for `generateAdwId`, `log`, `ensureLogsDirectory`
- `adws/agents/index.ts` — Agent barrel exports; check for `getPlanFilePath`

### New Files
- `adws/triggers/autoMergeHandler.ts` — New module containing the auto-merge logic (conflict detection, resolve-via-agent, merge attempt, retry loop, failure comment)

## Implementation Plan
### Phase 1: Foundation
1. Add a `mergePR` function to `adws/github/prApi.ts` that calls `gh pr merge --merge {prNumber} --repo {owner}/{repo}` and returns a success/failure result with error output
2. Export `mergePR` from `adws/github/index.ts`
3. Add a `checkMergeConflicts` function that fetches the target branch, attempts a dry-run merge (`git merge --no-commit --no-ff`), aborts, and returns whether conflicts were detected
4. Add `MAX_AUTO_MERGE_ATTEMPTS = 3` constant to `adws/core/constants.ts`

### Phase 2: Core Implementation
5. Create `adws/triggers/autoMergeHandler.ts` with the main `handleApprovedReview` function:
   - Accepts the webhook body (PR number, head branch, base branch, repo info)
   - Ensures a worktree for the PR's head branch
   - Implements the retry loop: check conflicts → resolve via `/resolve_conflict` → push → merge → retry on failure
   - Posts a PR comment on success or exhaustion
6. The handler uses `runClaudeAgentWithCommand('/resolve_conflict', ...)` to resolve conflicts, passing the PR's spec file path, and the base branch as `incomingBranch`

### Phase 3: Integration
7. Modify `adws/triggers/trigger_webhook.ts` to branch the `pull_request_review` event handler:
   - If event is `pull_request_review` AND `body.review.state === 'approved'`: call `handleApprovedReview`
   - If event is `pull_request_review` AND state is NOT `approved`: spawn `adwPrReview.tsx` (existing behavior)
   - `pull_request_review_comment` events always spawn `adwPrReview.tsx` (existing behavior)
8. The existing `shouldTriggerPrReview` deduplication continues to apply to both code paths

## Step by Step Tasks

### Step 1: Add `mergePR` function to `adws/github/prApi.ts`
- Add a `mergePR(prNumber: number, repoInfo: RepoInfo): { success: boolean; error?: string }` function
- Use `execSync` to run `gh pr merge {prNumber} --merge --repo {owner}/{repo}`
- Capture stderr on failure and return `{ success: false, error: stderr }`
- On success return `{ success: true }`
- Export from `adws/github/index.ts`

### Step 2: Add `MAX_AUTO_MERGE_ATTEMPTS` constant
- Add `MAX_AUTO_MERGE_ATTEMPTS = 3` to `adws/core/constants.ts`
- Export it from `adws/core/index.ts` if not already re-exported via barrel

### Step 3: Create `adws/triggers/autoMergeHandler.ts`
- Import dependencies: `log` from core, `fetchPRDetails`, `commentOnPR`, `mergePR` from github, `ensureWorktree`, `getWorktreeForBranch` from vcs, `runClaudeAgentWithCommand` from agents, `getPlanFilePath` from agents, `MAX_AUTO_MERGE_ATTEMPTS` from core constants, `generateAdwId`, `ensureLogsDirectory`, `AgentStateManager` from core
- Import `getRepoInfoFromPayload`, `getRepoInfo`, `type RepoInfo` from github
- Define `checkMergeConflicts(baseBranch: string, cwd: string): boolean` function:
  - Run `git fetch origin {baseBranch}` in cwd
  - Attempt `git merge --no-commit --no-ff origin/{baseBranch}` in cwd
  - If it succeeds (no conflicts), run `git merge --abort` to undo and return `false`
  - If it fails (conflicts), run `git merge --abort` to clean up and return `true`
- Define `resolveConflictsViaAgent(adwId: string, specPath: string, baseBranch: string, logsDir: string, cwd: string): Promise<boolean>` function:
  - Start a merge: `git fetch origin {baseBranch}` then `git merge origin/{baseBranch} --no-edit` in cwd (this will leave conflict markers)
  - Call `runClaudeAgentWithCommand('/resolve_conflict', [adwId, specPath, baseBranch], 'conflict-resolver', outputFile, 'sonnet', undefined, undefined, undefined, cwd)`
  - Return `result.success`
- Define `pushBranchChanges(branchName: string, cwd: string): boolean` function:
  - Run `git push origin {branchName}` in cwd
  - Return success/failure
- Define the main `handleApprovedReview(body: Record<string, unknown>): Promise<void>` function:
  - Extract `prNumber` from `body.pull_request.number`
  - Extract repo info from `body.repository` (owner, repo, full_name, clone_url)
  - Build `RepoInfo` from the webhook payload
  - Fetch PR details to get `headBranch` and `baseBranch`
  - Generate an `adwId` and set up logs directory
  - Determine worktree path using `getWorktreeForBranch` or `ensureWorktree`
  - Find the spec file path using `getPlanFilePath` (or empty string if none)
  - Enter the retry loop (up to `MAX_AUTO_MERGE_ATTEMPTS`):
    1. Check for merge conflicts via `checkMergeConflicts`
    2. If conflicts exist, call `resolveConflictsViaAgent` → if it fails, log and continue to next attempt
    3. Push the branch
    4. Attempt `mergePR` → if success, log and return
    5. If merge fails with conflict-related error, log and continue to next attempt
    6. If merge fails with non-conflict error, break out of loop
  - If all attempts exhausted, call `commentOnPR` with a failure message explaining auto-merge failed and manual intervention is needed
  - Log the final outcome

### Step 4: Modify `adws/triggers/trigger_webhook.ts` to branch on review state
- Split the existing `pull_request_review` / `pull_request_review_comment` block (lines 119-128) into two separate handlers:
  - **`pull_request_review_comment`** events: keep existing behavior (spawn `adwPrReview.tsx` after dedup check)
  - **`pull_request_review`** events with `body.review.state === 'approved'`:
    - Apply `shouldTriggerPrReview` dedup check
    - Call `handleApprovedReview(body)` (async, fire-and-forget with `.catch` error logging)
    - Return `{ status: 'auto_merge_triggered', pr: prNumber }`
  - **`pull_request_review`** events with non-approved state:
    - Keep existing behavior (spawn `adwPrReview.tsx` after dedup check)
- Import `handleApprovedReview` from `./autoMergeHandler`

### Step 5: Validate
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no TypeScript errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific TypeScript compilation
- Run `bun run build` to verify no build errors

## Testing Strategy
### Edge Cases
- `pull_request_review` with `state === 'approved'` and no merge conflicts → merge immediately
- `pull_request_review` with `state === 'approved'` and merge conflicts → resolve then merge
- `pull_request_review` with `state === 'approved'` and persistent conflicts (race condition on every retry) → post failure comment after 3 attempts
- `pull_request_review` with `state === 'changes_requested'` → spawn `adwPrReview.tsx` (unchanged)
- `pull_request_review` with `state === 'commented'` → spawn `adwPrReview.tsx` (unchanged)
- `pull_request_review_comment` events → always spawn `adwPrReview.tsx` (unchanged)
- Dedup cooldown fires for same PR within 60s → ignored
- PR is already merged or closed when handler runs → handle gracefully (skip)
- No spec file found for the PR → pass empty string to `/resolve_conflict` (it will use git context)
- Target repo webhook (external repo) → `extractTargetRepoArgs` passed through correctly
- `/resolve_conflict` agent fails → count as failed attempt, move to next retry
- `git push` fails after conflict resolution → count as failed attempt, move to next retry

## Acceptance Criteria
- Approved reviews trigger the auto-merge flow (not `adwPrReview.tsx`)
- Non-approved reviews (`changes_requested`, `commented`) continue to trigger `adwPrReview.tsx`
- `pull_request_review_comment` events continue to trigger `adwPrReview.tsx`
- Merge conflicts are detected and resolved via `/resolve_conflict` agent
- Race conditions (conflicts introduced between resolve and merge) are handled with retries
- Retries are capped at 3; exhaustion results in a PR comment explaining auto-merge failed
- Existing PR review deduplication (`shouldTriggerPrReview`) still applies to both auto-merge and review paths
- The handler is resilient to PRs that are already closed/merged when it runs

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run build` — Build the application to verify no build errors

## Notes
- The `resolve_conflict.md` command accepts 3 positional args: `adwId`, `specPath`, `incomingBranch`. For auto-merge, `incomingBranch` should be the base/target branch (e.g., `main`) since we're merging the target branch into the PR branch to resolve conflicts.
- The `specPath` may be empty if the PR doesn't have an associated ADW spec file — the `/resolve_conflict` command handles this gracefully by using git context.
- The handler runs asynchronously (fire-and-forget from the webhook response) just like the existing `adwPrReview.tsx` spawn, so it won't block the webhook response.
- `guidelines/coding_guidelines.md` must be followed: strict TypeScript, pure functions where possible, meaningful error messages, files under 300 lines.
- The `autoMergeHandler.ts` module is placed in `adws/triggers/` alongside other webhook-related handlers to maintain the existing module structure.
