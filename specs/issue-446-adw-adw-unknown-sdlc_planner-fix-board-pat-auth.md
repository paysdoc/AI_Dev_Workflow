# Bug: ensureColumns fails under app token — project board columns never created

## Metadata
issueNumber: `446`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
`GitHubBoardManager.ensureColumns` throws `gh: Resource not accessible by integration` when it calls `getStatusFieldOptions` under the GitHub App installation token on user-owned repositories. The board ends up missing ADW-required columns (`Blocked`, `In Review`, etc.).

**Observed:** `ensureColumns` logs `Failed to get status field options: ...Resource not accessible by integration...`, returns `false`, the board never gets the missing columns.

**Expected:** All columns declared in `BOARD_COLUMNS` are present on the board after `ensureColumns` completes.

## Problem Statement
`adws/providers/github/githubBoardManager.ts` has partial PAT-fallback coverage. `findBoard` has a lazy retry that switches to `GITHUB_PAT` if the app token returns null — but it **restores the original app token in its `finally` block**, so by the time `ensureColumns` runs, `GH_TOKEN` is back to the app token. `createBoard` and `ensureColumns` (including `getStatusFieldOptions` and `updateStatusFieldOptions`) have no PAT handling at all.

## Solution Statement
Add a private `withProjectBoardAuth<T>(fn: () => Promise<T>): Promise<T>` method to `GitHubBoardManager` that applies the reference pattern from `projectBoardApi.ts::moveIssueToStatus`: call `refreshTokenIfNeeded`, swap `GH_TOKEN` to `GITHUB_PAT` upfront when applicable, restore in `finally`. Route all three public methods (`findBoard`, `createBoard`, `ensureColumns`) through this wrapper and delete the stale lazy-retry block in `findBoard`.

## Steps to Reproduce
1. Configure an ADW target repo that is user-owned (not org-owned).
2. Ensure the repo has a linked Projects V2 board.
3. Trigger an ADW workflow that runs `setupProjectBoard` (calls `findBoard` → `ensureColumns`).
4. Observe: `ensureColumns` logs `Failed to get status field options: ...Resource not accessible by integration...` and returns `false`.

## Root Cause Analysis
`findBoard` calls `refreshTokenIfNeeded`, then attempts a lazy PAT swap only when `queryProjectId` returns null. Its `finally` block restores the original app token. When `ensureColumns` is called next, `GH_TOKEN` has been restored to the app token. `getStatusFieldOptions` and `updateStatusFieldOptions` issue `gh api graphql` with no PAT swap, hitting the GitHub API under the app token, which lacks Projects V2 access for user-owned repos.

The correct pattern (from `b449834`, in `projectBoardApi.ts::moveIssueToStatus`) is: swap to PAT *upfront* before any GraphQL call, so the entire operation runs under PAT, then restore in `finally`.

## Relevant Files

- `adws/providers/github/githubBoardManager.ts` — primary fix target; all three public methods and private helpers need to use `withProjectBoardAuth`
- `adws/github/projectBoardApi.ts` — reference implementation of correct PAT-upfront pattern (`moveIssueToStatus`, lines 224–296); **no changes needed**
- `adws/providers/__tests__/boardManager.test.ts` — existing unit tests for `mergeStatusOptions` and stubs; add a unit test for `withProjectBoardAuth` token-swap logic
- `features/project_board_pat_fallback.feature` — existing BDD scenario file; add new scenarios for `githubBoardManager.ts` PAT coverage
- `adws/core/environment.ts` — exports `GITHUB_PAT` (no changes needed, just context)
- `adws/github/githubAppAuth.ts` — exports `refreshTokenIfNeeded`, `isGitHubAppConfigured` (no changes needed, just context)

## Step by Step Tasks

### 1. Add `withProjectBoardAuth` wrapper to `GitHubBoardManager`

In `adws/providers/github/githubBoardManager.ts`:

- Add a private `async withProjectBoardAuth<T>(fn: () => Promise<T>): Promise<T>` method to `GitHubBoardManager`
- Implementation mirrors `moveIssueToStatus` in `projectBoardApi.ts`:
  - Call `refreshTokenIfNeeded(owner, repo)` at the start
  - If `isGitHubAppConfigured() && GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN`, save `process.env.GH_TOKEN`, set `process.env.GH_TOKEN = GITHUB_PAT`, log the fallback message
  - In `finally`, restore `process.env.GH_TOKEN` if PAT was swapped
- The wrapper calls `fn()` inside the try block after the optional token swap

### 2. Route `findBoard` through `withProjectBoardAuth`

In `adws/providers/github/githubBoardManager.ts`:

- Refactor `findBoard` to call `this.withProjectBoardAuth(async () => { ... })` wrapping the call to `this.queryProjectId(owner, repo)`
- Delete the stale lazy-retry block (lines 84–94) — the upfront PAT swap makes it redundant
- Remove the `const { owner, repo } = this.repoInfo;` and `refreshTokenIfNeeded` call from the body of `findBoard` (they move into `withProjectBoardAuth`)

### 3. Route `createBoard` through `withProjectBoardAuth`

In `adws/providers/github/githubBoardManager.ts`:

- Wrap the body of `createBoard` in `this.withProjectBoardAuth(async () => { ... })`
- The `const { owner, repo } = this.repoInfo;` line remains inside the wrapper callback

### 4. Route `ensureColumns` through `withProjectBoardAuth`

In `adws/providers/github/githubBoardManager.ts`:

- Wrap the body of `ensureColumns` in `this.withProjectBoardAuth(async () => { ... })`
- The calls to `this.getStatusFieldOptions(boardId)` and `this.updateStatusFieldOptions(...)` are now inside the wrapper and will run under PAT

### 5. Make private helpers synchronous-compatible (no change required)

- `getStatusFieldOptions` and `updateStatusFieldOptions` are synchronous (`execSync`) — they are already correctly scoped under the caller's `GH_TOKEN`. No changes needed.
- `withProjectBoardAuth` must set `process.env.GH_TOKEN` before calling the sync helpers, so the sync `execSync` calls pick up the correct token. This is guaranteed by wrapping the body (step 4).

### 6. Add unit tests for `withProjectBoardAuth` token-swap behaviour

In `adws/providers/__tests__/boardManager.test.ts`:

- Add a `describe('GitHubBoardManager PAT auth wrapper')` block
- Test: when `GITHUB_PAT` differs from `GH_TOKEN` and the GitHub App is configured, `GH_TOKEN` is set to `GITHUB_PAT` during execution and restored afterward
- Test: when `GITHUB_PAT` is not set, `GH_TOKEN` is unchanged
- Use stubs/mocks for `isGitHubAppConfigured`, `refreshTokenIfNeeded`, and `execSync` to avoid real network calls
- Export `GitHubBoardManager` (or its `withProjectBoardAuth` method) for testing, or test it through a thin test double

### 7. Extend `features/project_board_pat_fallback.feature` with `githubBoardManager.ts` scenarios

In `features/project_board_pat_fallback.feature`:

- Add a new tagged block `@adw-446-board-manager-pat-auth @regression`
- Scenario: `githubBoardManager.ts` imports `GITHUB_PAT` from config — file contains `GITHUB_PAT` and `from '../../core/config'` (or `environment`)
- Scenario: `GitHubBoardManager` contains `withProjectBoardAuth` method — file contains `withProjectBoardAuth`
- Scenario: `findBoard` does not contain the stale lazy-retry block — file does NOT contain `retrying with GITHUB_PAT` (the old log string from the deleted block)
- Scenario: `ensureColumns` is routed through `withProjectBoardAuth` — file contains `withProjectBoardAuth` inside `ensureColumns` body
- Scenario: `createBoard` is routed through `withProjectBoardAuth` — file contains `withProjectBoardAuth` inside `createBoard` body

### 8. Run validation commands

Execute the validation commands listed below to confirm zero regressions.

## Validation Commands

```bash
# Type check
bunx tsc --noEmit -p adws/tsconfig.json

# Unit tests
bun run test:unit

# Lint
bun run lint

# BDD regression scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# New scenarios for this issue
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-446-board-manager-pat-auth"
```

## Notes
- Reference implementation for the correct PAT-upfront pattern: `adws/github/projectBoardApi.ts::moveIssueToStatus` (lines 224–296).
- The existing `features/project_board_pat_fallback.feature` only checks string presence in `adws/github/projectBoardApi.ts` — the new scenarios must check `githubBoardManager.ts`.
- `## Unit Tests: enabled` in `.adw/project.md` — unit tests are required.
- Do NOT touch `adws/github/projectBoardApi.ts` (already correct) or `adws/providers/github/githubIssueTracker.ts` (delegates to the legacy function).
- Conditional docs applicable to this issue: `app_docs/feature-qm6gwx-board-manager-provider.md`, `app_docs/feature-wrzj5j-harden-project-board-status.md`, `app_docs/feature-9tknkw-project-board-pat-fallback.md`, `app_docs/feature-w12d7t-fix-board-update-mutation.md`, `app_docs/feature-fygx90-hitl-label-gate-automerge.md`.
