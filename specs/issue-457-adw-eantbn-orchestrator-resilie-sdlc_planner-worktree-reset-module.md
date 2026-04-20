# Feature: worktreeReset deep module for deterministic worktree recovery

## Metadata
issueNumber: `457`
adwId: `eantbn-orchestrator-resilie`
issueJson: `{"number":457,"title":"orchestrator-resilience: worktreeReset module","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nBuild the `worktreeReset` deep module that deterministically returns a worktree to `origin/<branch>` state, discarding any unpushed local work. This is the first step of any takeover after a dead orchestrator. The module is standalone in this slice — integration into the `takeoverHandler` decision tree happens in slice #11. See \"New modules to build → worktreeReset\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] `adws/vcs/worktreeReset.ts` exports `resetWorktreeToRemote(worktreePath, branch)`\n- [ ] Aborts in-progress merge (`git merge --abort`, fallback: remove `.git/MERGE_HEAD`)\n- [ ] Aborts in-progress rebase (`git rebase --abort`, fallback: remove `.git/rebase-apply/`, `.git/rebase-merge/`)\n- [ ] Runs `git reset --hard origin/<branch>`\n- [ ] Runs `git clean -fdx`\n- [ ] Unit tests with shell-mocking harness cover: clean worktree (idempotent), dirty tracked files, in-progress merge, in-progress rebase, untracked files\n- [ ] Discarding unpushed commits is explicit in the module'\''s doc comment\n\n## Blocked by\n\nNone - can start immediately.\n\n## User stories addressed\n\n- User story 10\n- User story 22","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:04:16Z","comments":[],"actionableComment":null}`

## Feature Description

Introduce a new VCS deep module, `adws/vcs/worktreeReset.ts`, exposing a single public function `resetWorktreeToRemote(worktreePath, branch)` that deterministically returns an arbitrary worktree to the tip of `origin/<branch>`. The function aborts any in-progress merge or rebase (with filesystem fallbacks when the git plumbing commands fail), hard-resets the index and working tree to the remote ref, and removes every untracked file and directory. Any unpushed local commits, staged or unstaged edits, untracked files, and partial merge/rebase state are discarded — this is a takeover primitive, not a merge helper.

The module is standalone in this slice; it does not depend on `takeoverHandler`, `agentState`, or `remoteReconcile`. Integration into the takeover decision tree lands in PRD slice #11. The value delivered here is a fully-tested, injectable primitive that can be composed from the takeover handler without further surgery.

## User Story

As an ADW developer, I want a worktree-reset primitive that forcibly returns a worktree to `origin/<branch>` regardless of its current (possibly mid-merge, mid-rebase, dirty, or untracked-strewn) state, so that the takeover handler has a single deterministic call it can rely on before resuming work on an issue after a dead or wedged orchestrator.

## Problem Statement

When an orchestrator dies or wedges, its worktree can be left in a variety of inconsistent states:
- A merge started but not completed (`.git/MERGE_HEAD` present, `git merge --abort` unsafe without prior check).
- A rebase started but not completed (`.git/rebase-apply/` or `.git/rebase-merge/` present).
- Tracked files modified but not committed or stashed.
- Untracked files or directories left behind (test artifacts, logs, build output).
- Unpushed local commits ahead of the remote.

Today, there is no single call that recovers a worktree from any of these states to a known-clean baseline matching the remote. The closest existing function is `fetchAndResetToRemote` in `adws/vcs/branchOperations.ts`, but it assumes a clean worktree (no mid-merge, no mid-rebase, no untracked files) and does not run `git clean`, so it does not provide the guarantees required for takeover. Without this primitive, a successor orchestrator inherits whatever the dead one left behind, producing leaked phase output, half-completed rebases, or commits that silently diverge from the PR that represents the issue.

## Solution Statement

Implement a small, pure-side-effect module that composes four deterministic git operations in sequence, each with an explicit fallback where the primary command can fail on a partial state:

1. **Merge abort (conditional)**: if `MERGE_HEAD` exists in the worktree's resolved git dir, attempt `git merge --abort`. If that exits non-zero, remove the `MERGE_HEAD` file directly as the filesystem fallback.
2. **Rebase abort (conditional)**: if either `rebase-apply/` or `rebase-merge/` exists in the worktree's resolved git dir, attempt `git rebase --abort`. If that exits non-zero, remove both directories directly as the filesystem fallback.
3. **Hard reset**: `git fetch origin <branch>` followed by `git reset --hard origin/<branch>` — mandatory, throws on failure.
4. **Clean**: `git clean -fdx` — mandatory, throws on failure. Removes untracked files, untracked directories, and ignored files.

The module uses `execSync` from `child_process` for git invocations (matching the convention of `adws/vcs/branchOperations.ts`) and `fs` for existence checks and fallback removals. It takes an explicit `worktreePath` and `branch` — no hidden state, no global cwd — keeping it trivially testable with the vitest `execSync` mocking pattern already used across `adws/core/__tests__/execWithRetry.test.ts` and `adws/triggers/__tests__/`. A doc comment at the top of the file and on the exported function states explicitly that all unpushed local work is discarded.

Worktree-aware git-dir resolution is handled via `git rev-parse --git-dir` (run inside the worktree). A linked worktree's `.git` is a file that points to `<main>/.git/worktrees/<name>`, so `MERGE_HEAD` and `rebase-apply/` live in that resolved dir, not in `<worktreePath>/.git/`. The module uses the resolved path for its existence checks and filesystem fallbacks.

## Relevant Files

Use these files to implement the feature:

- `adws/vcs/branchOperations.ts` — Reference pattern for VCS functions: `execSync` with `{ stdio: 'pipe', cwd }`, try/catch with `log(...)` messaging, `throw new Error(...)` on hard failure. Specifically mirrors `fetchAndResetToRemote` (the closest existing function) and the doc-comment style.
- `adws/vcs/worktreeCleanup.ts` — Reference pattern for mixing `execSync` with `fs` filesystem operations (e.g., `fs.existsSync`, `fs.rmSync`) and for graceful fallback after a `git worktree remove` failure.
- `adws/vcs/index.ts` — Central re-export for the `vcs` module. The new `resetWorktreeToRemote` export must be added here so callers can import from `../vcs` or `../../vcs`.
- `adws/core/index.ts` — Exposes `log`. Import from `../core` matches the sibling modules' import style.
- `adws/core/__tests__/execWithRetry.test.ts` — Canonical example of `vi.mock('child_process', () => ({ execSync: vi.fn() }))`, `mockExecSync.mockReset()` in `beforeEach`, and sequential mock return/throw via `mockImplementationOnce`. Template for the new test file.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` — Example of mocking both `child_process` and `fs` simultaneously (`vi.mock('fs', () => ({ existsSync: vi.fn(), ... }))`), which the new tests will need for the MERGE_HEAD / rebase-apply existence checks.
- `adws/triggers/__tests__/spawnGate.test.ts` — Shows the `vi.clearAllMocks()` / `vi.mocked(...)` pattern for typed mock handles.
- `specs/prd/orchestrator-coordination-resilience.md` — Parent PRD. Section "New modules to build → worktreeReset" defines the public interface; section "Testing Decisions → Modules with full unit tests → worktreeReset" defines the required coverage matrix.
- `guidelines/coding_guidelines.md` — Strict mode TypeScript, no `any`, single-responsibility files under 300 lines, pure functions with side effects isolated at boundaries. The new module complies by taking all inputs as explicit arguments and keeping I/O (git invocations, filesystem checks) at the single public function's boundary.
- `.adw/project.md` — Declares unit tests enabled, `bun add <pkg>` as the install command, and the `adws/vcs/**` directory as relevant.
- `.adw/commands.md` — Validation commands: `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run build`.

### New Files

- `adws/vcs/worktreeReset.ts` — The new deep module. Exports `resetWorktreeToRemote(worktreePath: string, branch: string): void`. ~100 lines including JSDoc. No other exports.
- `adws/vcs/__tests__/worktreeReset.test.ts` — New vitest test file mirroring the shell-mocking pattern in `adws/core/__tests__/execWithRetry.test.ts`. Covers the five scenarios listed in the PRD: clean worktree (idempotent), dirty tracked files, in-progress merge, in-progress rebase, untracked files. Includes negative cases for each fallback branch (`git merge --abort` fails → `MERGE_HEAD` unlink; `git rebase --abort` fails → directory removal) and for mandatory failures (`git reset --hard` throws, `git clean -fdx` throws).

## Implementation Plan

### Phase 1: Foundation

Read the existing reference implementations — `adws/vcs/branchOperations.ts` (specifically `fetchAndResetToRemote`) and `adws/vcs/worktreeCleanup.ts` (specifically `removeWorktree` and its `fs.rmSync` fallback pattern) — and confirm that the conventions captured in the Relevant Files section (explicit `cwd`, `stdio: 'pipe'`, `log(..., 'info' | 'success' | 'error')` for messaging, `throw new Error(...)` for hard failures) are followed by the new module without deviation.

Identify the helper for git-dir resolution. `git rev-parse --git-dir` run with `cwd: worktreePath` returns a path that is either absolute or relative to `worktreePath`. The module resolves it to an absolute path via `path.resolve(worktreePath, gitDirOutput.trim())` and uses that as the base for all MERGE_HEAD / rebase marker existence checks and fallback unlinks.

### Phase 2: Core Implementation

Create `adws/vcs/worktreeReset.ts` with the following structure:

1. Module-level JSDoc stating the module's purpose and the explicit guarantee that **all unpushed local work in the target worktree is discarded** (staged, unstaged, untracked, unpushed commits, partial merge/rebase state).
2. Private helper `resolveGitDir(worktreePath)` returning an absolute path to the worktree's git dir via `git rev-parse --git-dir`.
3. Private helper `abortInProgressMerge(worktreePath, gitDir)` that:
   - Returns immediately if `<gitDir>/MERGE_HEAD` does not exist.
   - Attempts `git merge --abort` (execSync with `stdio: 'pipe', cwd: worktreePath`).
   - On any throw, removes `<gitDir>/MERGE_HEAD` with `fs.rmSync(..., { force: true })`.
4. Private helper `abortInProgressRebase(worktreePath, gitDir)` that:
   - Returns immediately if neither `<gitDir>/rebase-apply/` nor `<gitDir>/rebase-merge/` exists.
   - Attempts `git rebase --abort`.
   - On any throw, removes both directories with `fs.rmSync(..., { recursive: true, force: true })`.
5. Public exported function `resetWorktreeToRemote(worktreePath: string, branch: string): void` with a JSDoc comment that explicitly calls out the "unpushed commits are discarded" guarantee. It:
   - Resolves the git dir.
   - Calls `abortInProgressMerge`, then `abortInProgressRebase`.
   - Runs `git fetch origin "<branch>"` (execSync with `stdio: 'pipe', cwd: worktreePath`) — throws wrapped error on failure.
   - Runs `git reset --hard "origin/<branch>"` — throws wrapped error on failure.
   - Runs `git clean -fdx` — throws wrapped error on failure.
   - Logs a single success line on completion.
6. All branch / path interpolation uses double-quoted shell strings matching the existing convention in `branchOperations.ts` (e.g., `` `git reset --hard "origin/${branch}"` ``). Branch names in ADW are controlled by `generateBranchName()` and do not contain shell metacharacters, but the quoting defense matches the file's convention.

### Phase 3: Integration

Add the `resetWorktreeToRemote` export to `adws/vcs/index.ts` in a new `// Worktree reset` section after the existing `// Worktree cleanup` block. Do not modify any caller in this slice — integration into `takeoverHandler` is PRD slice #11 and is explicitly out of scope here.

No other modules are modified. The new export is dead code from the caller perspective until slice #11 lands; this is intentional and matches the PRD's slice plan.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Create the module skeleton

- Create `adws/vcs/worktreeReset.ts`.
- Add the module-level JSDoc declaring purpose and the "discards all unpushed local work" guarantee (so the acceptance-criteria point "Discarding unpushed commits is explicit in the module's doc comment" is met at the module and the function level).
- Add imports: `execSync` from `child_process`, `existsSync`, `rmSync` from `fs`, `path` from `path`, `log` from `../core`.
- Scaffold the private helpers `resolveGitDir`, `abortInProgressMerge`, `abortInProgressRebase` and the exported `resetWorktreeToRemote` as empty bodies returning `void` to let TypeScript compile.

### Task 2: Implement `resolveGitDir`

- Run `git rev-parse --git-dir` with `{ encoding: 'utf-8', cwd: worktreePath }`.
- Trim the output.
- Resolve it to an absolute path: if it is already absolute return as-is, else `path.resolve(worktreePath, trimmed)`.
- Wrap any thrown error with `throw new Error('Failed to resolve git dir for worktree ${worktreePath}: ${error}')`.

### Task 3: Implement `abortInProgressMerge`

- Compute `mergeHead = path.join(gitDir, 'MERGE_HEAD')`.
- Early-return if `!existsSync(mergeHead)`.
- Try `execSync('git merge --abort', { stdio: 'pipe', cwd: worktreePath })`. On success, `log('Aborted in-progress merge', 'info')` and return.
- On throw, log a warning, then `rmSync(mergeHead, { force: true })`. Also remove `MERGE_MSG` and `MERGE_MODE` if they exist (purely defensive — git plumbing cleans these up when the command succeeds; the fallback path should too).
- Log a success line noting the fallback was used.

### Task 4: Implement `abortInProgressRebase`

- Compute `rebaseApply = path.join(gitDir, 'rebase-apply')` and `rebaseMerge = path.join(gitDir, 'rebase-merge')`.
- Early-return if neither directory exists.
- Try `execSync('git rebase --abort', ...)`. On success, log and return.
- On throw, log a warning, then `rmSync(rebaseApply, { recursive: true, force: true })` and the same for `rebaseMerge`. Log a success line noting the fallback was used.

### Task 5: Implement `resetWorktreeToRemote`

- Add the JSDoc comment explicitly stating that **all unpushed local commits, staged changes, unstaged changes, untracked files, and partial merge/rebase state will be discarded**. This satisfies the "doc comment" acceptance-criteria bullet.
- `const gitDir = resolveGitDir(worktreePath)`.
- `abortInProgressMerge(worktreePath, gitDir)`.
- `abortInProgressRebase(worktreePath, gitDir)`.
- `execSync(`git fetch origin "${branch}"`, { stdio: 'pipe', cwd: worktreePath })` — on throw, `throw new Error('Failed to fetch origin/${branch} in ${worktreePath}: ${error}')`.
- `execSync(`git reset --hard "origin/${branch}"`, ...)` — on throw, similar wrapped error.
- `execSync('git clean -fdx', ...)` — on throw, similar wrapped error.
- Final `log('Reset ${worktreePath} to origin/${branch}', 'success')`.

### Task 6: Wire the new export

- Edit `adws/vcs/index.ts` to add a new block:
  ```ts
  // Worktree reset
  export {
    resetWorktreeToRemote,
  } from './worktreeReset';
  ```

### Task 7: Create the test file skeleton

- Create `adws/vcs/__tests__/worktreeReset.test.ts`.
- Follow the mocking pattern from `adws/core/__tests__/execWithRetry.test.ts`:
  ```ts
  vi.mock('child_process', () => ({ execSync: vi.fn() }));
  vi.mock('fs', () => ({
    existsSync: vi.fn(),
    rmSync: vi.fn(),
  }));
  vi.mock('../../core', () => ({ log: vi.fn() }));
  ```
- Import `resetWorktreeToRemote` *after* the mocks.
- Add a `beforeEach` that resets `mockExecSync`, `mockExistsSync`, `mockRmSync`.
- Add a helper `mockGitDir(gitDirPath)` that configures the first `execSync` call (for `git rev-parse --git-dir`) to return the given path so every later test can declare its git-dir state explicitly.

### Task 8: Test "clean worktree (idempotent)"

- `mockGitDir('/wt/.git')`.
- `mockExistsSync.mockReturnValue(false)` — no MERGE_HEAD, no rebase dirs.
- Remaining `execSync` calls return empty strings (fetch / reset / clean all succeed).
- Call `resetWorktreeToRemote('/wt', 'main')`.
- Assert: `mockExecSync` called in order with `git rev-parse --git-dir`, `git fetch origin "main"`, `git reset --hard "origin/main"`, `git clean -fdx`. No merge/rebase abort calls. No `fs.rmSync` calls.
- Call again and assert identical call sequence (idempotency).

### Task 9: Test "dirty tracked files"

- Same fixture as clean; assert the reset + clean sequence still runs and assert the test double for `execSync` was called with `git reset --hard "origin/main"` exactly once (the reset itself is what clears dirty tracked files from a mocking perspective; we verify the call is made, not the underlying git effect).

### Task 10: Test "in-progress merge, plumbing succeeds"

- `mockGitDir('/wt/.git')`.
- `mockExistsSync` returns `true` for `/wt/.git/MERGE_HEAD`, `false` for rebase dirs.
- `mockExecSync` returns success for `git merge --abort`.
- Assert call order: `rev-parse`, `merge --abort`, `fetch`, `reset`, `clean`. `fs.rmSync` not called.

### Task 11: Test "in-progress merge, plumbing fails → fallback"

- Same as Task 10 but `mockExecSync.mockImplementationOnce` throws when `git merge --abort` runs.
- Assert `fs.rmSync` called with `/wt/.git/MERGE_HEAD` and `{ force: true }`.
- Assert subsequent execSync calls (`fetch`, `reset`, `clean`) still run.

### Task 12: Test "in-progress rebase, plumbing succeeds"

- `mockExistsSync` returns `true` for `/wt/.git/rebase-apply`, `false` for MERGE_HEAD and `rebase-merge`.
- `mockExecSync` returns success for `git rebase --abort`.
- Assert call order: `rev-parse`, `rebase --abort`, `fetch`, `reset`, `clean`.

### Task 13: Test "in-progress rebase, plumbing fails → fallback"

- Same as Task 12 but `git rebase --abort` throws.
- Assert `fs.rmSync` called with the rebase-apply path and `{ recursive: true, force: true }`, and also with rebase-merge path (defensively, even if `existsSync` returned false).
- Assert subsequent execSync calls still run.

### Task 14: Test "untracked files"

- Clean-worktree fixture; assert `git clean -fdx` is the last `execSync` call and runs.

### Task 15: Test "both merge and rebase markers present"

- `mockExistsSync` returns `true` for MERGE_HEAD, rebase-apply.
- Assert abort order: merge first, then rebase (matching the module's call order).

### Task 16: Test "git-dir is absolute vs relative"

- One test with `git rev-parse --git-dir` returning `.git` (relative); assert existence checks use `/wt/.git/MERGE_HEAD`.
- One test with it returning `/abs/path/to/gitdir`; assert existence checks use `/abs/path/to/gitdir/MERGE_HEAD`. This covers the linked-worktree case where `.git` is a file pointing elsewhere.

### Task 17: Test "mandatory steps throw on failure"

- One test: `git fetch origin` throws → `resetWorktreeToRemote` throws a wrapped `Error` mentioning the branch; later `execSync` calls (`reset`, `clean`) do NOT run.
- One test: `git reset --hard` throws → wrapped error thrown; `clean` does NOT run.
- One test: `git clean -fdx` throws → wrapped error thrown.

### Task 18: Run validation commands

- Run the commands in the Validation Commands section. Resolve any lint, type, or test failures before marking the task done. No new entries in `bun run lint` output, `tsc --noEmit` exits zero, the new unit tests pass, and the existing test suite shows zero regressions.

## Testing Strategy

### Unit Tests

Unit tests are **enabled** per `.adw/project.md`. The shell-mocking harness uses vitest's `vi.mock('child_process', ...)` and `vi.mock('fs', ...)` as described in Task 7. Tests exercise the public function only, via injected mocks — no real git invocation, no real filesystem writes. The mock for `child_process.execSync` returns typed values per call (using `mockReturnValueOnce` for successes and `mockImplementationOnce(() => { throw ... })` for failures), letting each test declare the exact git state it is simulating (clean vs mid-merge vs mid-rebase vs dirty).

Test location: `adws/vcs/__tests__/worktreeReset.test.ts`, matching the `__tests__` sibling-folder convention used throughout `adws/`.

Test runner: `bun run test:unit` (declared in `.adw/commands.md`). The new file must be picked up by the existing vitest config with no config changes.

### Edge Cases

- **Linked worktree git-dir indirection**: the `.git` inside a linked worktree is a file (not a directory) whose first line is `gitdir: <path>`. `git rev-parse --git-dir` resolves this correctly, but the module must not assume `<worktreePath>/.git/MERGE_HEAD` is the right path. Covered by the "git-dir is absolute vs relative" test.
- **Clean worktree (idempotent)**: calling twice in a row produces the same observable behavior and no errors.
- **MERGE_HEAD exists but `git merge --abort` refuses** (e.g., because the merge state is corrupt): the filesystem fallback must still produce a post-condition equivalent to "no MERGE_HEAD". Covered by the fallback test.
- **Both rebase-apply/ and rebase-merge/ present** (unusual but possible if a previous abort partially succeeded): both are removed.
- **`git fetch origin <branch>` fails** (offline, bad remote, bad branch): propagates as a wrapped error with branch name in the message.
- **Branch names containing shell metacharacters**: ADW branch names are generated via `generateBranchName` and are `[a-z0-9/-]+`. The module uses double quotes around the interpolation defensively, matching existing convention. Not separately tested (would be a regression of `generateBranchName` contract, not of this module).
- **worktreePath does not exist**: `git rev-parse --git-dir` fails, propagated as a wrapped error.
- **Ignored files present (node_modules, build artifacts)**: `git clean -fdx` removes them. `-x` is the flag that includes ignored files; it is required by the acceptance criteria and must not be dropped.

## Acceptance Criteria

- [ ] `adws/vcs/worktreeReset.ts` exists and exports `resetWorktreeToRemote(worktreePath: string, branch: string): void`.
- [ ] The exported function aborts an in-progress merge via `git merge --abort` and falls back to removing `<gitDir>/MERGE_HEAD` if the plumbing call fails.
- [ ] The exported function aborts an in-progress rebase via `git rebase --abort` and falls back to removing `<gitDir>/rebase-apply/` and `<gitDir>/rebase-merge/` if the plumbing call fails.
- [ ] The exported function runs `git reset --hard origin/<branch>` (preceded by `git fetch origin <branch>`) as a mandatory step that throws on failure.
- [ ] The exported function runs `git clean -fdx` as a mandatory step that throws on failure.
- [ ] A JSDoc comment on the exported function explicitly states that unpushed local commits are discarded.
- [ ] `adws/vcs/__tests__/worktreeReset.test.ts` exists and provides at least one test each for: clean worktree idempotency, dirty tracked files, in-progress merge, in-progress rebase, untracked files.
- [ ] Tests additionally cover the merge-abort fallback, the rebase-abort fallback, mandatory-step failures, and the absolute-vs-relative git-dir resolution.
- [ ] `resetWorktreeToRemote` is re-exported from `adws/vcs/index.ts`.
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all exit zero with no new failures versus the `dev` branch baseline.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — Ensure dependencies are installed (no new deps expected; this is a no-op check).
- `bun run lint` — Run linter to verify no ESLint violations in the new module or test file.
- `bunx tsc --noEmit` — Root TypeScript type-check; verifies the new module type-checks against the project's strict config.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Stricter project-level TypeScript check for `adws/**` (per `.adw/commands.md → Additional Type Checks`).
- `bun run test:unit` — Run the full vitest unit test suite including the new `adws/vcs/__tests__/worktreeReset.test.ts`. All tests must pass with zero regressions.
- `bun run build` — Ensure the build completes with zero errors.

## Notes

- This slice is **standalone**. No caller of `resetWorktreeToRemote` lands in this slice; PRD slice #11 (`takeoverHandler`) is where the integration happens. Dead-code analysis will flag the new export as unused; that is expected and the integration ticket will consume it.
- No new library dependency is required. Everything needed — `child_process.execSync`, `fs`, `path` — is from Node built-ins, which are already used across `adws/vcs/**`. If a library were needed, the install command per `.adw/commands.md` would be `bun add <package>`; none is needed here.
- The module follows `guidelines/coding_guidelines.md`: strict TypeScript (no `any`), single-responsibility file well under the 300-line cap, pure function surface with side effects isolated at the boundary. No decorators, no cleverness.
- Branch-name assembly in code (PRD: Branch-name assembly) is **not** part of this slice and must not be touched here.
- The shell-mocking harness is implemented inline in the test file using vitest's `vi.mock` — no shared harness module is introduced. This matches the existing convention where each test module declares its own mocks (see `adws/core/__tests__/execWithRetry.test.ts`, `adws/triggers/__tests__/spawnGate.test.ts`).
- `fetchAndResetToRemote` in `adws/vcs/branchOperations.ts` remains untouched. It serves a different caller (worktree init with a clean-tree precondition) and extending it to handle mid-merge / mid-rebase state would overload its contract. The new module exists precisely because `fetchAndResetToRemote`'s contract is narrower.
