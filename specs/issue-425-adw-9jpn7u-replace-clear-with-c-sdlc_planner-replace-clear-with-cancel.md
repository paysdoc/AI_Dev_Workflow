# Feature: Replace ## Clear with ## Cancel: full issue cleanup directive

## Metadata
issueNumber: `425`
adwId: `9jpn7u-replace-clear-with-c`
issueJson: `{"number":425,"title":"Replace ## Clear with ## Cancel: full issue cleanup directive","body":"## Summary\n\nReplace the `## Clear` comment directive with `## Cancel`. The new directive performs a full scorched-earth reset of all local state for an issue — not just clearing GitHub comments, but also killing agent processes, removing worktrees, and deleting state directories.\n\n## Motivation\n\nThe current `## Clear` directive only clears GitHub comments. When a user wants to fully reset and re-trigger an issue, orphaned agent processes, worktrees, and state directories remain, requiring manual cleanup.\n\n## Design\n\n### Rename\n\n- `CLEAR_COMMENT_PATTERN` → `CANCEL_COMMENT_PATTERN` (`/^## Cancel$/mi`)\n- `isClearComment` → `isCancelComment`\n- Update all re-exports and import sites: `workflowCommentParsing.ts`, `workflowComments.ts`, `github/index.ts`, `core/index.ts`, `trigger_cron.ts`, `trigger_webhook.ts`\n- No backwards compatibility for `## Clear`\n\n### New module: `adws/triggers/cancelHandler.ts`\n\n**Exports:**\n- `MutableProcessedSets` — `{ spawns: Set<number>; merges: Set<number> }`\n- `handleCancelDirective(issueNumber, comments, repoInfo, cwd?, processedSets?)` → `boolean`\n\n**Sequence:**\n1. Extract **all** adwIds from in-memory `comments` array\n2. For each adwId: read orchestrator PID from `agents/{adwId}/state.json`, kill with SIGTERM then SIGKILL\n3. `removeWorktreesForIssue(issueNumber, cwd)` — kills processes with open file handles in worktree dirs, removes worktrees + local branches\n4. For each adwId: `fs.rmSync(agents/{adwId}/, { recursive: true, force: true })`\n5. `clearIssueComments(issueNumber, repoInfo)`\n6. If `processedSets` provided: delete issue from `.spawns` and `.merges`\n\n### Cron integration (`trigger_cron.ts`)\n\n- Scan all fetched issues for `## Cancel` as latest comment **before** `filterEligibleIssues`\n- Call `handleCancelDirective` for each match, collect cancelled issue numbers\n- Add cancelled issues to `processedSpawns` so `filterEligibleIssues` skips them this cycle (re-spawn happens next cycle)\n- Resolve target repo path via `getTargetRepoWorkspacePath(owner, repo)` when `--target-repo` is set; `undefined` otherwise\n\n### Webhook integration (`trigger_webhook.ts`)\n\n- Replace `isClearComment` + `clearIssueComments` with `isCancelComment` + `handleCancelDirective`\n- Same full cancel sequence as cron\n- No processed sets (webhook handles one event at a time)\n- Resolve target repo cwd from webhook payload\n\n### Existing code reused\n\n- `removeWorktreesForIssue(issueNumber, cwd)` from `vcs/worktreeCleanup.ts`\n- `killProcessesInDirectory()` (called internally by worktree removal)\n- `clearIssueComments()` from `adwClearComments.tsx` (name unchanged — describes its action)\n- `extractAdwIdFromComment()` from `workflowCommentParsing.ts`\n- `getTargetRepoWorkspacePath()` from `targetRepoManager.ts`\n- `isProcessAlive()` from `stateHelpers.ts`\n\n### Decisions\n\n- `processedPRs` is **not** touched — PR review cycle is independent\n- `agents/{adwId}/` directories are fully deleted (no post-mortem preservation)\n- All adwIds in comments are cleaned up, not just the latest\n- Process killing: SIGTERM orchestrator PID + `killProcessesInDirectory` on worktrees covers detached children\n- `## Cancel` wait for next cycle to re-spawn (no same-cycle spawn)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-09T08:51:58Z","comments":[],"actionableComment":null}`

## Feature Description
Replace the `## Clear` comment directive with `## Cancel`. The current `## Clear` directive only clears GitHub issue comments. The new `## Cancel` directive performs a full scorched-earth reset of all local state for an issue: killing agent processes (orchestrator PIDs and worktree-bound children), removing git worktrees and local branches, deleting `agents/{adwId}/` state directories, clearing GitHub comments, and removing the issue from cron dedup sets so it re-spawns on the next cycle.

## User Story
As a developer using ADW
I want to post `## Cancel` on an issue to fully reset all local ADW state for that issue
So that I can cleanly re-trigger the workflow without manually killing processes, removing worktrees, or cleaning up state directories

## Problem Statement
The current `## Clear` directive only deletes GitHub comments. Orphaned agent processes, git worktrees, local branches, and `agents/{adwId}/` state directories remain after a clear, requiring manual cleanup before re-triggering. This friction slows down iteration and can cause resource leaks.

## Solution Statement
Rename `## Clear` to `## Cancel` and extend the handler into a new `cancelHandler.ts` module that performs a full cleanup sequence: extract all adwIds from comments → kill orchestrator PIDs → remove worktrees (which kills child processes via `lsof`) → delete state directories → clear GitHub comments → remove from dedup sets. Integrate this handler into both the cron and webhook triggers.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation
- `adws/core/workflowCommentParsing.ts` — Defines `CLEAR_COMMENT_PATTERN` and `isClearComment` (lines 107-113); also `extractAdwIdFromComment` (lines 138-142). Rename pattern/function here.
- `adws/github/workflowComments.ts` — Re-exports `CLEAR_COMMENT_PATTERN` and `isClearComment` from core (lines 15-16). Update re-exports.
- `adws/github/index.ts` — Re-exports from `workflowComments.ts` (lines 67-68). Update re-exports.
- `adws/core/index.ts` — Re-exports from core (lines 166-167). Update re-exports.
- `adws/triggers/trigger_cron.ts` — Imports `isClearComment` (line 12), uses it in `checkAndTrigger()` (lines 136-141). Replace with cancel handler integration.
- `adws/triggers/trigger_webhook.ts` — Imports `isClearComment` (line 13), uses it in issue_comment handler (lines 139-143). Replace with cancel handler integration.
- `adws/adwClearComments.tsx` — Exports `clearIssueComments()` (unchanged, still needed for comment deletion step).
- `adws/vcs/worktreeCleanup.ts` — Exports `removeWorktreesForIssue(issueNumber, cwd)` (lines 141-194). Reused for worktree removal.
- `adws/core/stateHelpers.ts` — Exports `isProcessAlive(pid)` (lines 24-31), `findOrchestratorStatePath(adwId)` (lines 94-117), `isAgentProcessRunning(adwId)` (lines 126-134). Reused for PID lookup and kill.
- `adws/core/targetRepoManager.ts` — Exports `getTargetRepoWorkspacePath(owner, repo)` (lines 20-22). Used to resolve cwd for target repos.
- `adws/core/config.ts` — Exports `AGENTS_STATE_DIR`. Used for state directory path construction.
- `adws/triggers/cronIssueFilter.ts` — Exports `ProcessedSets` interface (lines 46-49) and `filterEligibleIssues`. Referenced by cancel handler type.
- `adws/triggers/cronRepoResolver.ts` — Exports `resolveCronRepo`. Used in cron to determine target repo identity.

### New Files
- `adws/triggers/cancelHandler.ts` — New module implementing `handleCancelDirective` and exporting `MutableProcessedSets` type.
- `adws/triggers/__tests__/cancelHandler.test.ts` — Unit tests for the cancel handler.

## Implementation Plan
### Phase 1: Foundation — Rename Clear to Cancel
Rename the pattern and function in `workflowCommentParsing.ts` from `CLEAR_COMMENT_PATTERN`/`isClearComment` to `CANCEL_COMMENT_PATTERN`/`isCancelComment`. Update the regex to match `## Cancel` instead of `## Clear`. Update all re-export chains (`workflowComments.ts`, `github/index.ts`, `core/index.ts`) and import sites (`trigger_cron.ts`, `trigger_webhook.ts`).

### Phase 2: Core Implementation — Cancel Handler Module
Create `adws/triggers/cancelHandler.ts` with the `handleCancelDirective` function that performs the full cleanup sequence:
1. Extract adwIds from comments using `extractAdwIdFromComment`
2. Kill orchestrator processes (SIGTERM → wait → SIGKILL) using `findOrchestratorStatePath` and PID from state files
3. Remove worktrees via `removeWorktreesForIssue`
4. Delete `agents/{adwId}/` directories
5. Clear GitHub comments via `clearIssueComments`
6. Remove issue from processed dedup sets if provided

### Phase 3: Integration — Wire into Triggers
- **Cron:** Move cancel detection before `filterEligibleIssues`. Scan all fetched issues for `## Cancel` as latest comment. Call `handleCancelDirective`, then add cancelled issues to `processedSpawns` to skip them this cycle. Resolve target repo cwd from `--target-repo` args.
- **Webhook:** Replace `isClearComment` + `clearIssueComments` with `isCancelComment` + `handleCancelDirective`. Resolve cwd from webhook payload using existing `extractTargetRepoArgs` + `getTargetRepoWorkspacePath` pattern (same as `handleIssueClosedEvent`).

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Rename CLEAR_COMMENT_PATTERN → CANCEL_COMMENT_PATTERN in workflowCommentParsing.ts
- In `adws/core/workflowCommentParsing.ts` (lines 107-113):
  - Rename `CLEAR_COMMENT_PATTERN` to `CANCEL_COMMENT_PATTERN`
  - Change the regex from `/^## Clear$/mi` to `/^## Cancel$/mi`
  - Rename `isClearComment` to `isCancelComment`
  - Update the JSDoc comments accordingly

### Step 2: Update all re-export chains
- In `adws/github/workflowComments.ts` (lines 15-16): replace `CLEAR_COMMENT_PATTERN` → `CANCEL_COMMENT_PATTERN`, `isClearComment` → `isCancelComment`
- In `adws/github/index.ts` (lines 67-68): same replacement
- In `adws/core/index.ts` (lines 166-167): same replacement

### Step 3: Create adws/triggers/cancelHandler.ts
- Create the new module with the following exports:
  - `MutableProcessedSets` type: `{ spawns: Set<number>; merges: Set<number> }`
  - `handleCancelDirective(issueNumber: number, comments: readonly { body: string }[], repoInfo: RepoInfo, cwd?: string, processedSets?: MutableProcessedSets): boolean`
- Implementation sequence:
  1. Extract all adwIds from `comments` using `extractAdwIdFromComment`
  2. For each adwId: use `findOrchestratorStatePath` to locate orchestrator state dir, read `state.json` to get PID, send SIGTERM, wait briefly, then SIGKILL if still alive (using `isProcessAlive`)
  3. Call `removeWorktreesForIssue(issueNumber, cwd)` to kill worktree-bound processes and remove worktrees + branches
  4. For each adwId: `fs.rmSync(path.join(AGENTS_STATE_DIR, adwId), { recursive: true, force: true })`
  5. Call `clearIssueComments(issueNumber, repoInfo)`
  6. If `processedSets` provided: `processedSets.spawns.delete(issueNumber)` and `processedSets.merges.delete(issueNumber)`
  7. Log each step and return `true` on success
- Import dependencies:
  - `extractAdwIdFromComment` from `../core/workflowCommentParsing`
  - `findOrchestratorStatePath`, `isProcessAlive` from `../core/stateHelpers`
  - `AGENTS_STATE_DIR` from `../core/config`
  - `removeWorktreesForIssue` from `../vcs/worktreeCleanup`
  - `clearIssueComments` from `../adwClearComments`
  - `log` from `../core/logger`
  - `RepoInfo` type from `../core/config`

### Step 4: Create unit tests for cancelHandler
- Create `adws/triggers/__tests__/cancelHandler.test.ts`
- Test cases:
  - Returns `true` when cancel directive completes successfully
  - Extracts all adwIds from comments and attempts process kill for each
  - Calls `removeWorktreesForIssue` with correct issueNumber and cwd
  - Deletes `agents/{adwId}/` directories for all extracted adwIds
  - Calls `clearIssueComments` with correct issueNumber and repoInfo
  - Removes issue from processedSets.spawns and processedSets.merges when provided
  - Does not touch processedSets when not provided
  - Handles no adwIds found gracefully (still clears comments and worktrees)
  - Handles missing/unreadable state files gracefully (continues to next adwId)

### Step 5: Integrate cancel handler into trigger_cron.ts
- Replace import of `isClearComment` with `isCancelComment` from `'../github'`
- Add import of `handleCancelDirective` from `'./cancelHandler'`
- In `checkAndTrigger()`, **before** the `filterEligibleIssues` call (before line 86):
  - Resolve target repo cwd: if `targetRepo` is set, call `getTargetRepoWorkspacePath(cronRepoInfo.owner, cronRepoInfo.repo)`, otherwise `undefined`
  - Iterate over all fetched `issues`, check if latest comment is `isCancelComment`
  - For each match: call `handleCancelDirective(issue.number, issue.comments, repoInfo, cwd, { spawns: processedSpawns, merges: processedMerges })`
  - Add cancelled issue numbers to `processedSpawns` so `filterEligibleIssues` skips them this cycle
- Remove the old clear comment handling block (lines 136-141)

### Step 6: Integrate cancel handler into trigger_webhook.ts
- Replace import of `isClearComment` with `isCancelComment` from `'../github'`
- Remove import of `clearIssueComments` from `'../adwClearComments'`
- Add import of `handleCancelDirective` from `'./cancelHandler'`
- In the `issue_comment` handler (around line 139):
  - Replace `isClearComment(commentBody)` with `isCancelComment(commentBody)`
  - Resolve cwd from webhook payload using `extractTargetRepoArgs` + `getTargetRepoWorkspacePath` pattern (same as the `issues.closed` handler at lines 184-186)
  - Fetch full issue comments for the cancel handler (the webhook only has the triggering comment; use `fetchIssueCommentsRest` or pass the in-memory comments if available)
  - Call `handleCancelDirective(issueNumber, comments, webhookRepoInfo, cwd)` instead of `clearIssueComments`
  - Keep the early return with updated status: `{ status: 'cancelled', ... }`

### Step 7: Run validation commands
- Run `bun run lint` to check for linting errors
- Run `bunx tsc --noEmit` to check for TypeScript errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for ADW-specific type checking
- Run `bun run build` to verify build succeeds
- Run `bun run test` to verify no regressions in existing unit tests

## Testing Strategy
### Unit Tests
- `adws/triggers/__tests__/cancelHandler.test.ts`:
  - Mock all external dependencies (`findOrchestratorStatePath`, `isProcessAlive`, `removeWorktreesForIssue`, `clearIssueComments`, `fs.rmSync`, `process.kill`, `extractAdwIdFromComment`)
  - Test full sequence execution: adwId extraction → process kill → worktree removal → state dir deletion → comment clearing → dedup set cleanup
  - Test graceful handling of missing state files, dead processes, no adwIds
  - Test that processedSets are cleaned when provided and untouched when not

### Edge Cases
- No comments on the issue (no adwIds to extract) — should still call `removeWorktreesForIssue` and `clearIssueComments`
- adwId extracted but no `agents/{adwId}/` directory exists — `fs.rmSync` with `force: true` handles this gracefully
- Orchestrator PID already dead — `isProcessAlive` returns false, skip kill
- State file exists but has no PID field — skip kill, continue
- Multiple adwIds from multiple workflow runs on same issue — all should be cleaned up
- `cwd` is undefined (running against local repo, not target repo) — `removeWorktreesForIssue` uses default cwd
- `processedSets` not provided (webhook path) — skip dedup set cleanup
- SIGTERM succeeds but process lingers — SIGKILL fallback after brief wait

## Acceptance Criteria
- `## Clear` directive no longer recognized by the system
- `## Cancel` directive triggers the full cleanup sequence: process kill → worktree removal → state dir deletion → comment clearing
- Cron trigger scans for `## Cancel` before `filterEligibleIssues` and skips cancelled issues for the current cycle
- Cancelled issues re-spawn on the next cron cycle (not same-cycle)
- Webhook trigger performs the same full cancel sequence with early return
- All existing unit tests pass without modification (except where they test clear-specific behavior)
- TypeScript compiles without errors
- Lint passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run existing unit tests to verify zero regressions

## Notes
- The `clearIssueComments` function in `adwClearComments.tsx` is **not** renamed — it describes its action (clearing comments), not the directive. It continues to be called as one step within the broader cancel sequence.
- `processedPRs` is intentionally not touched by the cancel handler — the PR review cycle is an independent lifecycle.
- The cancel handler uses `findOrchestratorStatePath` (which scans subdirectories for `-orchestrator` agent name) rather than reading the top-level `state.json` directly, because the orchestrator PID is stored in the orchestrator agent's subdirectory state file, not the top-level state.
- Process killing follows a two-layer approach: SIGTERM the orchestrator PID (covers the Claude CLI process tree), then `killProcessesInDirectory` via `removeWorktreesForIssue` (covers any detached children with open file handles in worktree dirs).
- The `## Cancel` directive is detected case-insensitively (multiline + case-insensitive regex flags) matching the existing pattern style.
- Follow `guidelines/coding_guidelines.md`: pure functions where possible, explicit types, no mutation of function parameters (the `MutableProcessedSets` type makes mutability explicit at the call site).
