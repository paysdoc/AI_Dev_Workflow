# Chore: Refactor worktree initialization to use fetch + reset --hard

## Metadata
issueNumber: `163`
adwId: `t5a58t-refactor-initialize`
issueJson: `{"number":163,"title":"refactor: initialize worktree from current root state then sync via fetch + reset --hard","body":"## Summary\n\nChange the order of git operations when initializing a new local workspace so that the worktree is created first from the root's current state, extra files are copied, and then the worktree is brought up to date with the remote — instead of pulling the main repo before worktree creation.\n\n## Current behaviour\n\nIn `workflowInit.ts` the new-worktree path (`else` branch, line 190) does:\n\n1. `checkoutDefaultBranch()` — runs `git checkout <defaultBranch> && git pull origin <defaultBranch>` on the **main repo** root.\n2. `ensureWorktree(branchName, defaultBranch)` — creates the worktree from the now-updated HEAD and copies `.env`.\n\nThis means the root working tree is modified (checkout + pull) before the worktree even exists, which can disrupt in-progress work on the main repo and relies on a network call succeeding before the worktree is created.\n\n## Desired behaviour\n\n1. **Create the worktree immediately** from the current state of the root (no pull, no checkout beforehand).\n2. **Copy all extra files** (`.env`, `.claude/commands`, etc.) into the new worktree — same as today.\n3. **`git fetch`** from within the worktree (or the shared git repo) to retrieve the latest remote refs.\n4. **`git reset --hard origin/<defaultBranch>`** inside the worktree to advance it to the latest remote default branch, overriding any local divergence.\n\n## Affected code\n\n| File | Location | What changes |\n|------|----------|--------------|\n| `adws/phases/workflowInit.ts` | line 190 | Replace `checkoutDefaultBranch()` + `ensureWorktree()` with the new sequence |\n| `adws/vcs/branchOperations.ts` | `checkoutDefaultBranch()` | May no longer be called from the new-worktree path; evaluate whether it is still needed elsewhere |\n| `adws/vcs/worktreeCreation.ts` | `createWorktree()` / `ensureWorktree()` | Possibly extend to accept a flag or post-create callback that performs the fetch + reset --hard |\n\n## Acceptance criteria\n\n- [ ] A new worktree is created from the root's current HEAD without first running `git pull` on the main repo.\n- [ ] `.env` and `.claude/commands` are copied to the worktree before the reset step.\n- [ ] `git fetch` is called (scoped to the default branch is sufficient) before the reset.\n- [ ] `git reset --hard origin/<defaultBranch>` is executed inside the worktree so it matches the remote tip exactly.\n- [ ] Existing tests pass; new unit tests cover the updated sequence.\n- [ ] The `checkoutDefaultBranch()` call in `workflowInit.ts:190` is removed from the new-worktree code path (keep only where genuinely needed for the main-repo freeing logic).","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-13T06:56:27Z","comments":[],"actionableComment":null}`

## Chore Description
The worktree initialization flow in `workflowInit.ts` currently runs `checkoutDefaultBranch()` on the **main repo** before creating a new worktree. This modifies the main repo's working tree (checkout + pull), which can disrupt in-progress work and depends on a network call succeeding before the worktree even exists.

The fix reorders operations so the worktree is created immediately from the root's current HEAD, extra files (`.env`, `.claude/commands`) are copied in, and then `git fetch` + `git reset --hard origin/<defaultBranch>` syncs the worktree to the remote tip — all without touching the main repo.

## Relevant Files
Use these files to resolve the chore:

- `adws/vcs/branchOperations.ts` — Contains `checkoutDefaultBranch()` (line 156) which will no longer be called from the new-worktree code path. Also where the new `fetchAndResetToRemote()` function will be added. Contains `mergeLatestFromDefaultBranch()` as a reference pattern for fetch operations.
- `adws/phases/workflowInit.ts` — Contains the `initializeWorkflow()` function. Lines 189-192 are the code path that needs to change: replace `checkoutDefaultBranch()` + `ensureWorktree()` with the new sequence (create worktree → copy files → fetch → reset).
- `adws/phases/worktreeSetup.ts` — Contains `copyClaudeCommandsToWorktree()` which is currently called only for the target-repo path (line 163) but needs to also be called in the new local-repo worktree path.
- `adws/vcs/worktreeCreation.ts` — Contains `ensureWorktree()` and `createWorktree()`. No changes needed to these functions; they already create worktrees from current HEAD when a `baseBranch` is passed.
- `adws/vcs/index.ts` — VCS barrel export. Will need to export the new `fetchAndResetToRemote` function.
- `adws/__tests__/workflowPhases.test.ts` — Integration tests for `initializeWorkflow()`. The test at line 277 asserts `checkoutDefaultBranch` is called; this must be updated to assert the new fetch+reset sequence instead.
- `adws/vcs/__tests__/gitOperations.test.ts` — Unit tests for branch operations. Will need new tests for `fetchAndResetToRemote()`.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow (modularity, purity, type safety, meaningful error messages).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `fetchAndResetToRemote()` to `adws/vcs/branchOperations.ts`

- Add a new exported function `fetchAndResetToRemote(defaultBranch: string, cwd: string): void` after the existing `mergeLatestFromDefaultBranch()` function (after line 204).
- The function should:
  1. Log: `Fetching origin/${defaultBranch}...`
  2. Run `git fetch origin "${defaultBranch}"` with `{ stdio: 'pipe', cwd }`.
  3. Log: `Resetting to origin/${defaultBranch}...`
  4. Run `git reset --hard "origin/${defaultBranch}"` with `{ stdio: 'pipe', cwd }`.
  5. Log success: `Synced worktree to origin/${defaultBranch}`
- On fetch failure: throw `Error(\`Failed to fetch origin/${defaultBranch}: ${error}\`)`.
- On reset failure: throw `Error(\`Failed to reset to origin/${defaultBranch}: ${error}\`)`.
- Follow the same error-handling pattern as `mergeLatestFromDefaultBranch()` but use throws instead of warnings since the reset is critical for correctness.

### Step 2: Export `fetchAndResetToRemote` from `adws/vcs/index.ts`

- Add `fetchAndResetToRemote` to the named exports from `'./branchOperations'` in the "Branch operations" export block (after line 17, alongside `mergeLatestFromDefaultBranch`).

### Step 3: Update `workflowInit.ts` lines 189-192 — new worktree code path

- **Remove** the `checkoutDefaultBranch` import from the `'../vcs'` import block (line 34).
- **Add** `fetchAndResetToRemote` to the `'../vcs'` import block.
- **Replace** lines 189-192:
  ```typescript
  // BEFORE (lines 189-192):
  } else {
    checkoutDefaultBranch();
    worktreePath = ensureWorktree(branchName, defaultBranch);
  }
  ```
  with:
  ```typescript
  } else {
    worktreePath = ensureWorktree(branchName, defaultBranch);
    copyClaudeCommandsToWorktree(worktreePath);
    fetchAndResetToRemote(defaultBranch, worktreePath);
  }
  ```
- This achieves: (1) worktree created from current HEAD without touching main repo, (2) `.env` copied by `ensureWorktree` internally + `.claude/commands` copied explicitly, (3) fetch + reset brings worktree to remote tip.

### Step 4: Add unit tests for `fetchAndResetToRemote` in `adws/vcs/__tests__/gitOperations.test.ts`

- Import `fetchAndResetToRemote` from `'../branchOperations'` (add to existing import at line 15).
- Add a new `describe('fetchAndResetToRemote', ...)` block after the existing `checkoutDefaultBranch` describe block.
- Test cases:
  1. **"fetches and resets to remote default branch"** — mock `execSync` to succeed for both calls. Assert `git fetch origin "main"` and `git reset --hard "origin/main"` were called with `{ stdio: 'pipe', cwd: '/mock/worktree' }`.
  2. **"works with non-main default branch"** — call with `'develop'` as `defaultBranch`. Assert commands use `develop`.
  3. **"throws on fetch failure"** — mock `execSync` to throw on the fetch call. Assert error message contains `'Failed to fetch origin/main'`.
  4. **"throws on reset failure"** — mock `execSync` to succeed for fetch but throw on reset. Assert error message contains `'Failed to reset to origin/main'`.

### Step 5: Update `workflowPhases.test.ts` for the new worktree init sequence

- **Update the VCS mock** (line 114-123): Remove `checkoutDefaultBranch` from the mock. Add `fetchAndResetToRemote: vi.fn()` to the mock.
- **Update imports** (around line 201): Replace `checkoutDefaultBranch` with `fetchAndResetToRemote` in the destructured import from the `'../vcs'` mock.
- **Update the test at line 277** ("uses branch name agent, checkoutDefaultBranch, and ensureWorktree with baseBranch when no cwd provided"):
  - Rename test description to: `'creates worktree, copies commands, and syncs to remote when no cwd provided'`
  - Remove assertion `expect(checkoutDefaultBranch).toHaveBeenCalled()`
  - Add assertions:
    - `expect(ensureWorktree).toHaveBeenCalledWith('feature/issue-1-test', 'main')`
    - `expect(copyClaudeCommandsToWorktree).toHaveBeenCalledWith('/mock/worktree')`
    - `expect(fetchAndResetToRemote).toHaveBeenCalledWith('main', '/mock/worktree')`
- **Update the test at line 296** (reuses existing worktree): Update assertion from `expect(checkoutDefaultBranch).not.toHaveBeenCalled()` to `expect(fetchAndResetToRemote).not.toHaveBeenCalled()`.
- **Update the test at line 423** (reuses worktree found by issue pattern): Update assertion from `expect(checkoutDefaultBranch).not.toHaveBeenCalled()` to `expect(fetchAndResetToRemote).not.toHaveBeenCalled()`.
- **Add mock for `copyClaudeCommandsToWorktree`** in the phases mock (or the worktreeSetup mock) — check if it's already mocked; if not, add `vi.mock('../phases/worktreeSetup', ...)` or add it to the existing mock structure. Since `copyClaudeCommandsToWorktree` is imported from `'./worktreeSetup'` in `workflowInit.ts`, it needs a mock at `'../phases/worktreeSetup'` or similar path. Check existing mocks and add accordingly.
- **Import `copyClaudeCommandsToWorktree`** from the mock if not already imported, to assert it's called.

### Step 6: Update any other test files referencing `checkoutDefaultBranch` from VCS mock

- In `adws/__tests__/tokenLimitRecovery.test.ts` (line 47): Update the VCS mock — replace `checkoutDefaultBranch: vi.fn()` with `fetchAndResetToRemote: vi.fn()`.

### Step 7: Run validation commands

- Execute all validation commands to ensure zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check adws project
- `bun run test` - Run all tests to validate zero regressions

## Notes
- IMPORTANT: Follow `guidelines/coding_guidelines.md` strictly — use meaningful error messages, keep functions focused on a single responsibility, use explicit types.
- `checkoutDefaultBranch()` remains exported from `adws/vcs/branchOperations.ts` and `adws/vcs/index.ts`. It is not deleted — just no longer called from the new-worktree code path. It is still used by `freeBranchFromMainRepo()` indirectly (that function uses `getDefaultBranch` + inline checkout/pull), and may be used by external consumers.
- The `ensureWorktree()` function already calls `copyEnvToWorktree()` internally (line 195-201 of `worktreeCreation.ts`), so `.env` copying is handled. The new code path adds `copyClaudeCommandsToWorktree()` which was previously missing for local-repo new worktrees (it was only called for target-repo worktrees at line 163).
- The `fetchAndResetToRemote()` function deliberately throws on failure (unlike `mergeLatestFromDefaultBranch()` which only warns) because the reset is critical — the worktree must match the remote tip for correct operation.
