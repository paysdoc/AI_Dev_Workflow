# Bug: KPI commits land on current branch instead of repo default branch

## Metadata
issueNumber: `486`
adwId: `hk12ct-kpi-commits-land-on`
issueJson: `{"number":486,"title":"KPI commits land on current branch instead of repo default branch","body":"## Problem\n\n`commitAndPushKpiFile()` in `adws/vcs/commitOperations.ts:51` commits `app_docs/agentic_kpis.md` and pushes to whatever branch ADW itself happens to be checked out on (resolved via `getCurrentBranch()`). When ADW is running from a feature branch (e.g. `dev`), KPI updates leak into that branch's history and any open PR from it, rather than landing cleanly on the repo's default branch where cross-run KPI tracking belongs.\n\nScope: this concerns ADW's own KPI file (`app_docs/agentic_kpis.md` in this repo). Target-repo commits are unaffected.\n\n## Desired behaviour\n\nKPI commits should always land on the **repo's default branch as resolved via `gh`** (today that is `dev`; whatever `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` returns at runtime), regardless of which branch ADW itself is currently checked out on.\n\n## Constraints\n\n- ADW is actively running mid-workflow when `commitAndPushKpiFile()` fires. Mutating the current working tree's index or `HEAD` (e.g. `git checkout`, `git read-tree`, `git update-index`) is unsafe — it can collide with other in-flight phases.\n- KPI phase is non-fatal today; that contract must be preserved (failures log a warning, never throw).\n- Must work when the default branch is already checked out somewhere as a worktree (don't rely on `git worktree add <path> <default-branch>` succeeding unconditionally).\n\n## Suggested approach\n\nUse a temporary **detached** worktree on `origin/<default-branch>`:\n\n1. Resolve default branch via `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.\n2. `git fetch origin <default-branch>`.\n3. `git worktree add --detach <tmpdir> origin/<default-branch>`.\n4. Copy `app_docs/agentic_kpis.md` from the current working tree into `<tmpdir>`.\n5. In `<tmpdir>`: `git add`, `git commit -m \"kpis: update agentic_kpis\"`, `git push origin HEAD:<default-branch>`.\n6. `git worktree remove --force <tmpdir>` in a `finally` so cleanup always runs.\n\nThis leaves the active ADW working tree and index untouched.\n\n## Files\n\n- `adws/vcs/commitOperations.ts` — update `commitAndPushKpiFile()` signature/body.\n- `adws/vcs/__tests__/` — add unit test covering default-branch resolution and temp-worktree lifecycle (mock `execSync` + `gh`).\n- `adws/phases/kpiPhase.ts` — caller; likely no change beyond possibly passing a resolved default-branch value if we want dependency injection for testing.\n\n## Acceptance criteria\n\n- Running any ADW orchestrator from a non-default branch produces a KPI commit whose `git log` shows it landing on the default branch, not the feature branch.\n- ADW's active worktree state (index, HEAD, staged files from other phases) is unchanged after the KPI phase runs.\n- If push to default branch fails (e.g. non-fast-forward race), the failure is logged and the workflow continues.\n- Temp worktree is removed even on error paths.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-21T13:44:02Z","comments":[],"actionableComment":null}`

## Bug Description

`commitAndPushKpiFile()` in `adws/vcs/commitOperations.ts:51` stages, commits, fetches, rebases, and pushes `app_docs/agentic_kpis.md` against whatever branch ADW itself is currently checked out on (resolved via `getCurrentBranch(cwd)`). Because the ADW repo is commonly running from a feature branch such as the integration/`dev` branch during active development, every ADW run produces a KPI commit that lands on that feature branch rather than the repo's default branch.

**Symptoms:**

- KPI commits leak into the history of whichever feature branch ADW happens to be checked out on (e.g. the `dev` integration branch or any bugfix/feature branch used to run ADW).
- Any open PR from that branch receives the KPI commit as part of its diff, even though KPI data is an orthogonal cross-run artifact.
- Cross-run KPI tracking becomes fragmented across many non-default branches instead of accumulating on the canonical default branch.

**Expected vs. actual:**

- **Expected:** KPI commits always land on the repo's default branch as resolved by `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, regardless of which branch ADW itself is checked out on.
- **Actual:** KPI commits land on `getCurrentBranch(cwd)`, i.e. whichever branch ADW is running from.

Scope: this concerns **ADW's own** KPI file (`app_docs/agentic_kpis.md` in the ADW repo). Target-repo commits are unaffected.

## Problem Statement

`commitAndPushKpiFile()` must land `app_docs/agentic_kpis.md` commits on the repo's default branch (resolved at runtime via `gh`) without mutating the active ADW working tree's index or `HEAD`, while preserving the existing non-fatal contract (failures log a warning and return `false`; nothing throws).

Three constraints make a naïve `git checkout <default>; git commit; git push; git checkout <original>` unsafe:

1. **Concurrent phase writes** — ADW is mid-workflow when KPI fires. Mutating `HEAD` or the index in the active working tree can collide with other in-flight phases (e.g. staged files from document/commit phases).
2. **Non-fatal contract** — Today `commitAndPushKpiFile()` returns `false` on any failure without throwing; the KPI phase's outer try/catch also swallows unexpected throws. The new implementation must not regress this (e.g. an un-awaited throw inside a `finally` that masks the original error, or a throw that escapes to the orchestrator).
3. **Default-branch-already-checked-out** — If the default branch is already checked out in another worktree (common: the main ADW repo root tracks `dev` while a linked worktree tracks the feature branch), `git worktree add <path> <default-branch>` refuses to create a second worktree on the same branch. A **detached** worktree on `origin/<default-branch>` avoids this.

## Solution Statement

Rewrite `commitAndPushKpiFile(cwd?)` to use a **temporary detached worktree** on `origin/<default-branch>`:

1. Early-exit if `app_docs/agentic_kpis.md` has no changes in the source worktree (`cwd`) — preserves the existing "nothing to commit" path and avoids any temp-worktree work.
2. Resolve the default branch via `getDefaultBranch(cwd)` (already exported from `adws/vcs/branchOperations.ts`, which calls `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).
3. `git fetch origin <defaultBranch>` in `cwd` so `origin/<defaultBranch>` is up-to-date.
4. `fs.mkdtempSync(path.join(os.tmpdir(), 'adw-kpi-'))` to create a unique temp dir (avoids collisions across concurrent ADW runs on the same machine).
5. `git worktree add --detach <tmpdir> origin/<defaultBranch>` from `cwd` — produces a detached `HEAD` at the current remote tip, with no branch ref attached, so step 3 cannot fail on "already checked out".
6. Copy `app_docs/agentic_kpis.md` from `cwd` into `<tmpdir>/app_docs/agentic_kpis.md` using `fs.mkdirSync(..., { recursive: true })` + `fs.copyFileSync` (preserves content exactly; no git staging in the source tree).
7. In `<tmpdir>`: `git add app_docs/agentic_kpis.md` → `git commit -m "kpis: update agentic_kpis"` → `git push origin HEAD:<defaultBranch>` (push-by-refspec, not `git push -u`, so the detached `HEAD` needs no upstream configuration).
8. Wrap steps 2–7 in try/catch that logs a warning and returns `false` on any failure (preserves non-fatal contract). Wrap step 5 onward in `try { … } finally { cleanup(tmpdir) }` so the worktree removal always runs.
9. Cleanup: `git worktree remove --force <tmpdir>` from `cwd`, then `fs.rmSync(tmpdir, { recursive: true, force: true })` as a belt-and-braces guard (the `--force` removal usually purges the directory, but if `git` leaves a stray file behind the fs removal finishes the job). Errors in cleanup are logged but do not propagate — the KPI path has already succeeded or failed by this point.

**Why not mutate the source tree:**

The "checkout default → commit → push → restore" pattern is rejected because it mutates `HEAD` and the index of the active worktree, which the bug report explicitly calls unsafe (concurrent phase writes can race with the transient index state). A detached worktree is an isolated index and `HEAD` that cannot collide.

**Why detached, not branch-backed:**

`git worktree add <path> <defaultBranch>` fails with "already checked out" if the default branch is checked out anywhere else (main repo root, another worktree). The acceptance criteria explicitly require tolerating that case. `--detach` sidesteps the branch-ownership check entirely.

**Why push refspec `HEAD:<defaultBranch>`:**

A detached `HEAD` has no upstream tracking branch, so `git push` without a refspec errors with "HEAD is detached". `git push origin HEAD:<defaultBranch>` explicitly targets the remote default branch, matching the "land on the default branch" acceptance criterion.

**Non-fast-forward push handling:**

The push may fail under concurrent-ADW-run races (two orchestrators push KPI commits near-simultaneously). The bug report allows this failure to be non-fatal: log the warning and let the next ADW run re-push the up-to-date KPI file. No retry loop is needed — the next workflow will pick up origin's newer state on its own `git fetch`.

**Caller unchanged:**

`adws/phases/kpiPhase.ts:93` still calls `commitAndPushKpiFile()` with no arguments (uses ADW-repo root as `cwd`). No dependency injection is introduced — the function is synchronous, all I/O is already mockable via the existing `child_process`/`fs` mock pattern used in `adws/vcs/__tests__/worktreeReset.test.ts`.

## Steps to Reproduce

1. Check out any non-default branch of the ADW repo (e.g. a feature branch like `bugfix-issue-486-kpi-commits-default-branch`) in the ADW repo root: `git checkout bugfix-issue-486-kpi-commits-default-branch`.
2. Run any SDLC-class orchestrator that includes the KPI phase, e.g. `bunx tsx adws/adwSdlc.tsx <issueNumber>`.
3. Let the workflow reach `executeKpiPhase` (runs after document phase, before workflow completion — see `adws/phases/kpiPhase.ts:93`).
4. Observe `git log --oneline -5 <feature-branch>` — a `kpis: update agentic_kpis` commit is present on the feature branch.
5. Observe `git log --oneline -5 origin/<default-branch>` — the commit is **absent** from the default branch (it was pushed to `origin/<feature-branch>`, not `origin/<default-branch>`).
6. Observe the open PR for the feature branch — the KPI commit now appears in its diff, polluting the PR review.

**Alternative fast-path repro (unit test):** call `commitAndPushKpiFile()` with a mocked `execSync` that records the invoked commands. The current implementation calls `git branch --show-current` (via `getCurrentBranch`) and `git push origin "<feature-branch>"`. After the fix, it must call `gh repo view --json defaultBranchRef …` and `git push origin HEAD:<defaultBranch>` — see Step 4 below for the full expected call sequence.

## Root Cause Analysis

`commitAndPushKpiFile()` was introduced by issue #196 (`specs/issue-196-adw-jm6pnw-push-adw-kpis-sdlc_planner-push-kpi-file.md`) as a direct clone of the cost-file push pattern, which itself targeted the current branch because cost commits historically tracked the workflow branch. The KPI use case is different: KPIs are a cross-run metrics artifact whose canonical home is the default branch, not whichever branch ADW happens to have checked out.

The specific defect is at `adws/vcs/commitOperations.ts:66–74`:

```ts
const branch = getCurrentBranch(cwd);                              // ← wrong target
if (!branch) { throw new Error('… detached HEAD'); }
execSync(`git fetch origin "${branch}"`, { stdio: 'pipe', cwd });
execSync(`git rebase --autostash "origin/${branch}"`, { stdio: 'pipe', cwd });  // ← rebases active tree
execSync(`git push origin "${branch}"`, { stdio: 'pipe', cwd });   // ← pushes to current branch
```

Three compounding issues:

1. **Wrong target branch** — `getCurrentBranch(cwd)` returns the feature branch, not the default branch. The push lands wherever ADW is checked out.
2. **Active-tree mutation** — `git rebase --autostash` mutates the active working tree's index and `HEAD`. During a mid-workflow KPI run, this races with any phase that stages files concurrently.
3. **Commit also lands on active tree** — `git add "app_docs/agentic_kpis.md"` and `git commit` in step 3–4 of the current implementation pollute the active branch's history even if the push is later corrected, because the commit is already on that branch's local tip.

The fix must therefore (a) resolve the correct target (default branch via `gh`), (b) perform the commit on an isolated tree (detached worktree), and (c) push via refspec to the remote default branch without ever touching the active worktree's refs.

## Relevant Files

Use these files to fix the bug:

- `adws/vcs/commitOperations.ts` — **primary fix site.** Rewrite `commitAndPushKpiFile()` (lines 47–82) to use a temp detached worktree. Signature stays `(cwd?: string): boolean` so the caller in `kpiPhase.ts` is untouched. Imports `getCurrentBranch` today; after the fix it imports `getDefaultBranch` from `./branchOperations` instead (and drops the `getCurrentBranch` import from this function's path).
- `adws/vcs/branchOperations.ts` — **source of `getDefaultBranch(cwd?)`** (lines 146–162). Already exported and already used elsewhere; wraps `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`. No changes needed here.
- `adws/vcs/__tests__/commitOperations.test.ts` — **new unit-test file.** Model after `adws/vcs/__tests__/worktreeReset.test.ts` (same `vi.mock('child_process', …)` + `vi.mock('fs', …)` + `vi.mock('../../core', …)` pattern). Cover: no-op when no changes, happy path (correct command sequence, default-branch target, detached-worktree lifecycle), push-failure non-fatal path, cleanup-runs-even-on-failure path.
- `adws/vcs/__tests__/worktreeReset.test.ts` — **reference pattern only.** Demonstrates how to mock `execSync` to return values for ordered calls and assert on the call sequence. No changes needed here.
- `adws/vcs/index.ts` — **barrel export, no change.** Re-exports `commitAndPushKpiFile` (line 27) — the exported symbol and its signature are preserved, so the barrel needs no edit.
- `adws/phases/kpiPhase.ts` — **caller, no change.** Still calls `commitAndPushKpiFile()` with no arguments at line 93. The outer try/catch preserves non-fatal behaviour; the inner function continues to return `boolean` and swallow its own errors.
- `features/push_adw_kpis.feature` — **existing BDD coverage.** Background scenarios still hold (commit present, push present, non-fatal). Add a new `@adw-hk12ct-kpi-commits-land-on @regression` scenario block asserting (a) `adws/vcs/commitOperations.ts` imports `getDefaultBranch`, (b) the file references `worktree add --detach`, (c) the file references `HEAD:` push-refspec syntax, (d) the file has cleanup via `worktree remove --force` in a `finally`-style construct.
- `features/step_definitions/pushAdwKpisSteps.ts` — **existing step definitions.** Most new assertions reuse source-reading patterns already present (the file already reads `KPI_PHASE` and asserts on its content). Extend with TWO NEW steps: one that reads `adws/vcs/commitOperations.ts` and stashes its content in the World, and one generic `the commitOperations source references {string}` step for substring assertions against that stashed content.
- `specs/issue-196-adw-jm6pnw-push-adw-kpis-sdlc_planner-push-kpi-file.md` — **historical context, no change.** Original plan that introduced the current-branch push defect; useful for understanding why the code took its present shape.
- `app_docs/feature-eantbn-orchestrator-resilie-worktree-reset-module.md` — **testing-pattern reference, no change.** Documents the `execSync` + `fs` mock approach used in `worktreeReset.test.ts`; the new `commitOperations.test.ts` follows the same convention.
- `app_docs/feature-8ar0fo-user-story-integrate-kpi-tracking.md` — **context, no change.** Describes the KPI phase design; confirms the non-fatal contract (line 44) the fix must preserve.
- `.adw/commands.md` — **reference, no change.** Confirms `bun run test:unit` is the vitest invocation and the BDD regression invocation is `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`.
- `guidelines/coding_guidelines.md` — **adherence required.** Clarity over cleverness; modularity (helpers for temp-worktree setup/teardown); error handling at system boundaries (one outer try/catch around the whole temp-worktree flow, not a forest of try/catches per exec).

### New Files

- `adws/vcs/__tests__/commitOperations.test.ts` — unit tests for the rewritten `commitAndPushKpiFile()`, using the mock pattern from `worktreeReset.test.ts`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add Node stdlib imports to `adws/vcs/commitOperations.ts`

- At the top of `adws/vcs/commitOperations.ts`, alongside the existing `import { execSync } from 'child_process';`, add:
  ```ts
  import * as fs from 'fs';
  import * as os from 'os';
  import * as path from 'path';
  ```
- Update the existing import `import { getCurrentBranch, PROTECTED_BRANCHES } from './branchOperations';` to **also** import `getDefaultBranch`:
  ```ts
  import { getCurrentBranch, getDefaultBranch, PROTECTED_BRANCHES } from './branchOperations';
  ```
- Do NOT remove `getCurrentBranch` — it is used by the re-exported `commitChanges`/`pushBranch` helpers that other callers rely on. The only function being rewritten is `commitAndPushKpiFile`.
- The re-export `export { PROTECTED_BRANCHES };` stays unchanged.

### 2. Rewrite `commitAndPushKpiFile()` in `adws/vcs/commitOperations.ts`

Replace the current function body (lines 51–82) with the detached-worktree implementation. The JSDoc and signature stay identical (`(cwd?: string): boolean`) so the caller is unaffected. Structure the new body as three concerns isolated by helper functions kept file-local (do not export them):

- **Helper `hasKpiFileChanges(cwd?: string): boolean`** — wraps `git status --porcelain -- "app_docs/agentic_kpis.md"` and returns `true` if the trimmed output is non-empty. Used only by `commitAndPushKpiFile` to preserve the "no changes" early-exit.
- **Helper `createKpiTempWorktree(cwd: string | undefined, defaultBranch: string): string`** — creates the temp dir via `fs.mkdtempSync(path.join(os.tmpdir(), 'adw-kpi-'))`, then runs `git worktree add --detach "<tmpdir>" "origin/<defaultBranch>"` in `cwd`. Returns the absolute tmpdir path. Throws on any failure (the outer caller converts the throw to a `false` return + warning log).
- **Helper `cleanupKpiTempWorktree(cwd: string | undefined, tmpdir: string): void`** — runs `git worktree remove --force "<tmpdir>"` in `cwd`, then `fs.rmSync(tmpdir, { recursive: true, force: true })` as a belt-and-braces. Both operations are wrapped in their own try/catch that logs a warning and swallows the error so cleanup never throws out of a `finally`.

The new `commitAndPushKpiFile` body:

```ts
export function commitAndPushKpiFile(cwd?: string): boolean {
  try {
    if (!hasKpiFileChanges(cwd)) {
      log(`No KPI file changes to commit`, 'info');
      return false;
    }

    const defaultBranch = getDefaultBranch(cwd);
    execSync(`git fetch origin "${defaultBranch}"`, { stdio: 'pipe', cwd });

    const tmpdir = createKpiTempWorktree(cwd, defaultBranch);

    try {
      const srcRoot = cwd ?? process.cwd();
      const srcFile = path.join(srcRoot, 'app_docs/agentic_kpis.md');
      const dstFile = path.join(tmpdir, 'app_docs/agentic_kpis.md');
      fs.mkdirSync(path.dirname(dstFile), { recursive: true });
      fs.copyFileSync(srcFile, dstFile);

      execSync('git add "app_docs/agentic_kpis.md"', { stdio: 'pipe', cwd: tmpdir });
      execSync('git commit -m "kpis: update agentic_kpis"', { stdio: 'pipe', cwd: tmpdir });
      execSync(`git push origin HEAD:"${defaultBranch}"`, { stdio: 'pipe', cwd: tmpdir });

      log(`Committed and pushed agentic_kpis.md to ${defaultBranch}`, 'success');
      return true;
    } finally {
      cleanupKpiTempWorktree(cwd, tmpdir);
    }
  } catch (error) {
    log(`Failed to commit KPI file: ${error}`, 'error');
    return false;
  }
}
```

Specific semantics to preserve:

- **No-changes path**: identical log message and early `return false`, so the BDD scenario `No commit is created when KPI agent produces no changes` still passes.
- **Non-fatal on any failure**: the outer try/catch returns `false` for *every* failure mode (default-branch resolution, fetch, worktree add, copy, commit, push). Matches today's behaviour.
- **Cleanup always runs**: the `try { … } finally { cleanupKpiTempWorktree(…) }` guarantees the temp dir is removed even when copy/commit/push throws. The outer catch means any throw from `cleanupKpiTempWorktree` that somehow escapes still results in a logged warning + `false` return rather than propagation.
- **No active-tree mutation**: there are zero `execSync(..., { cwd })` calls that write to the index or `HEAD` of the source worktree after the initial `git fetch` (which only updates `origin/<defaultBranch>` and does not touch the working tree).
- **Detached-only**: the `--detach` flag on `git worktree add` ensures the default branch can remain checked out elsewhere without conflict.

### 3. Update the module-level JSDoc for `commitAndPushKpiFile`

- The JSDoc at line 47–50 currently reads:
  ```
  /**
   * Stages, commits, and pushes the agentic KPI file.
   * Returns true if changes were committed, false if no changes or on failure.
   */
  ```
- Replace with a version that records the new invariants (keep it to ≤6 lines per coding guidelines — no multi-paragraph docstrings):
  ```ts
  /**
   * Commits `app_docs/agentic_kpis.md` to the repo's default branch via a
   * temporary detached worktree, leaving the active worktree's index and
   * HEAD untouched. Non-fatal: returns false and logs on any failure.
   *
   * @param cwd - Working directory for the source worktree (the ADW repo root)
   */
  ```

### 4. Create `adws/vcs/__tests__/commitOperations.test.ts`

Model the structure exactly on `adws/vcs/__tests__/worktreeReset.test.ts`:

- Top-of-file mocks:
  ```ts
  vi.mock('child_process', () => ({ execSync: vi.fn() }));
  vi.mock('fs', () => ({
    mkdtempSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    rmSync: vi.fn(),
  }));
  vi.mock('os', () => ({ tmpdir: vi.fn(() => '/tmp') }));
  vi.mock('../../core', () => ({ log: vi.fn() }));
  ```
- Import `commitAndPushKpiFile` from `../commitOperations`.
- `beforeEach` resets all four mocks.
- A small helper `mockHappyPath(tmpdir = '/tmp/adw-kpi-abc')`:
  ```ts
  vi.mocked(mkdtempSync).mockReturnValue(tmpdir);
  vi.mocked(execSync)
    .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n')  // status --porcelain
    .mockReturnValueOnce('dev\n')                           // gh repo view (from getDefaultBranch)
    .mockReturnValueOnce('')                                // git fetch origin "dev"
    .mockReturnValueOnce('')                                // git worktree add --detach
    .mockReturnValueOnce('')                                // git add
    .mockReturnValueOnce('')                                // git commit
    .mockReturnValueOnce('')                                // git push origin HEAD:"dev"
    .mockReturnValueOnce('');                               // git worktree remove --force
  ```

Cover the following scenarios (descriptions mirror `worktreeReset.test.ts` style):

**Group: no-op when no changes**
- `returns false when status --porcelain output is empty` — mock the first `execSync` call to return `''`; assert the return is `false`, the function logged `'No KPI file changes to commit'`, and neither `gh repo view` nor `git fetch` nor `git worktree add` was called.

**Group: happy path — correct command sequence**
- `runs status, gh repo view, fetch, worktree add --detach, copy, add, commit, push, remove in order` — assert the exact ordered sequence of `execSync` calls, with the default branch (`'dev'`) interpolated into fetch/push, and `origin/dev` into the worktree-add target. Assert `fs.copyFileSync` was called with the source `app_docs/agentic_kpis.md` path inside `cwd` and the destination inside the `mkdtempSync` return value. Assert `git push origin HEAD:"dev"` is literally present.
- `uses --detach flag on worktree add` — grep the matched call for `--detach`.
- `pushes via HEAD:<defaultBranch> refspec, not -u` — assert the push command does NOT contain `-u` and contains `HEAD:"dev"`.

**Group: cleanup runs on success and failure**
- `calls git worktree remove --force with the temp path on the happy path` — assert the call exists.
- `calls git worktree remove --force even when git commit throws` — mock the commit call to throw; assert the worktree-remove call is still made afterwards.
- `calls git worktree remove --force even when git push throws` — mock the push call to throw; assert the worktree-remove call is still made.
- `swallows errors from git worktree remove --force` — mock the remove call to throw; assert the function still returns `false` (on the prior push failure) without re-throwing.
- `calls fs.rmSync on the temp path as a belt-and-braces cleanup` — assert `rmSync` was called with the `mkdtempSync` return value and `{ recursive: true, force: true }`.

**Group: non-fatal on failure**
- `returns false and logs error when getDefaultBranch throws (gh CLI absent)` — mock the `gh repo view` call to throw; assert `false` return and an `'error'` log.
- `returns false and logs error when git fetch fails` — mock the fetch call to throw; assert `false` return, no worktree created (i.e. `mkdtempSync` not called), no cleanup attempted.
- `returns false and logs error when git worktree add fails` — mock worktree-add to throw; assert `false` return. Note: cleanup is still attempted because the `tmpdir` from `mkdtempSync` is already allocated; assert that `rmSync` was called on that path.
- `returns false and logs error when git push fails` — mock push to throw; assert `false` return AND that the worktree-remove call was made afterwards.

**Group: target-branch correctness (the regression gate)**
- `pushes to the default branch returned by getDefaultBranch, not the current branch` — mock `gh repo view` to return `'main'`; assert `git push origin HEAD:"main"` was called, and `git push origin "feature-issue-486-…"` (or any current-branch push) was NOT called.
- `never calls git branch --show-current` — assert no `execSync` invocation matches `/git branch --show-current/`. This is the explicit regression-prevention assertion: the old implementation used `getCurrentBranch`, which runs that exact command.

Keep the test file under ~300 lines per coding guidelines.

### 5. Extend `features/push_adw_kpis.feature` with a regression scenario block

- Directly below the existing `@adw-jm6pnw-push-adw-kpis` scenarios, append a new scenario block tagged `@adw-hk12ct-kpi-commits-land-on @regression`:

  ```gherkin
  @adw-hk12ct-kpi-commits-land-on @regression
  Scenario: KPI commits target the default branch via a detached temporary worktree
    Given the ADW workflow is running from a non-default branch
    When the KPI phase commits "app_docs/agentic_kpis.md"
    Then the commitOperations source imports "getDefaultBranch"
    And the commitOperations source references "worktree add --detach"
    And the commitOperations source references "HEAD:"
    And the commitOperations source references "worktree remove --force"
    And the commitOperations source does not reference "getCurrentBranch" inside "commitAndPushKpiFile"
  ```

- The final `does not reference … inside` assertion narrows the scope to the `commitAndPushKpiFile` function body, since `getCurrentBranch` is a valid import used by the other exports (`commitChanges`, `pushBranch`) in the same file. Implement it by slicing the source between `export function commitAndPushKpiFile` and the next `\nexport ` or EOF.

### 6. Extend `features/step_definitions/pushAdwKpisSteps.ts` with new step definitions

- Add a constant near the top alongside `const KPI_PHASE = 'adws/phases/kpiPhase.ts';`:
  ```ts
  const COMMIT_OPS = 'adws/vcs/commitOperations.ts';
  ```

- Add a new `Given` that loads the commitOperations source into the World (mirrors the `KPI_PHASE` loading pattern already present):
  ```ts
  Given('the ADW workflow is running from a non-default branch', function (this: Record<string, string>) {
    assert.ok(existsSync(join(ROOT, COMMIT_OPS)), `Expected ${COMMIT_OPS} to exist`);
    this.commitOpsSource = readFileSync(join(ROOT, COMMIT_OPS), 'utf-8');
  });
  ```

- Add a passthrough `When`:
  ```ts
  When('the KPI phase commits {string}', function (_file: string) {
    // Context only — source already loaded in the Given
  });
  ```

- Add generic import and substring assertions:
  ```ts
  Then('the commitOperations source imports {string}', function (this: Record<string, string>, symbol: string) {
    assert.ok(
      new RegExp(`import\\s+\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s+from`).test(this.commitOpsSource),
      `Expected ${COMMIT_OPS} to import ${symbol}`,
    );
  });

  Then('the commitOperations source references {string}', function (this: Record<string, string>, needle: string) {
    assert.ok(
      this.commitOpsSource.includes(needle),
      `Expected ${COMMIT_OPS} to reference "${needle}"`,
    );
  });
  ```

- Add the narrow "does not reference inside function" step:
  ```ts
  Then('the commitOperations source does not reference {string} inside {string}', function (
    this: Record<string, string>,
    needle: string,
    fnName: string,
  ) {
    const src = this.commitOpsSource;
    const startRe = new RegExp(`export\\s+function\\s+${fnName}\\b`);
    const startIdx = src.search(startRe);
    assert.ok(startIdx >= 0, `Expected to find exported function ${fnName}`);
    const rest = src.slice(startIdx);
    const nextExportIdx = rest.search(/\n(export |\/\*\*)/);
    const body = nextExportIdx > 0 ? rest.slice(0, nextExportIdx) : rest;
    assert.ok(
      !body.includes(needle),
      `Expected ${fnName} body NOT to reference "${needle}" but it did`,
    );
  });
  ```

### 7. Run the validation commands

Execute the full validation pipeline per the `Validation Commands` section below and fix any linter/type/test failure before declaring the bug resolved.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — confirm no ESLint errors introduced by the new imports, helpers, or test file.
- `bunx tsc --noEmit` — confirm no type errors at the workspace level.
- `bunx tsc --noEmit -p adws/tsconfig.json` — confirm no type errors inside the `adws/` sub-project (catches regressions that the top-level tsconfig might miss).
- `bun run test:unit` — runs the full vitest suite, including the new `adws/vcs/__tests__/commitOperations.test.ts` and the unchanged `adws/vcs/__tests__/worktreeReset.test.ts` and `adws/vcs/__tests__/branchOperations.test.ts`. All must pass.
- `bun run test:unit adws/vcs/__tests__/commitOperations.test.ts` — targeted run of the new test file; useful for iterative debugging.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-hk12ct-kpi-commits-land-on"` — runs only the new regression scenario block; all scenarios must be green.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full BDD regression run; the new scenarios must pass and the existing `@adw-jm6pnw-push-adw-kpis @regression` scenarios must remain green.

**Manual reproduction gate (optional but recommended before merge):**

1. Check out any non-default branch of the ADW repo.
2. Make a trivial edit to `app_docs/agentic_kpis.md` so `git status --porcelain` shows the file modified.
3. Run a small Node script that invokes the rewritten function directly:
   ```bash
   bunx tsx -e "import { commitAndPushKpiFile } from './adws/vcs/commitOperations.ts'; console.log(commitAndPushKpiFile());"
   ```
4. Inspect `git log --oneline -3` on the feature branch — the `kpis: update agentic_kpis` commit must be **absent**.
5. Inspect `git log --oneline -3 origin/<default-branch>` — the commit must be **present**.
6. Inspect `git status` on the feature branch — no modifications to `app_docs/agentic_kpis.md` should linger (copy is to a temp worktree; original file is untouched).
7. Inspect `git worktree list` — no `adw-kpi-*` temp worktrees should remain (cleanup ran).

## Notes

- **Coding guidelines adherence (`guidelines/coding_guidelines.md`):**
  - *Clarity over cleverness*: three file-local helpers (`hasKpiFileChanges`, `createKpiTempWorktree`, `cleanupKpiTempWorktree`) break the flow into single-responsibility units instead of one 40-line function.
  - *Modularity*: `commitOperations.ts` remains under 300 lines after the rewrite.
  - *Error handling at system boundaries*: one outer try/catch converts every failure mode to a `false` return + warning log. No per-line silent-catch spaghetti inside the happy path.
  - *Type safety*: all helpers are fully typed; no `any`, no `!` non-null assertions, no `@ts-ignore`.
  - *Isolate side effects*: the `execSync` and `fs` calls are confined to helpers; the public function body reads declaratively.
- **Testing-policy note:** `guidelines/coding_guidelines.md` observes that ADW does not blanket-require unit tests because agent-written tests can be fake-pass noise. However, `adws/vcs/` already has vitest coverage (`branchOperations.test.ts`, `worktreeReset.test.ts`) because VCS logic is infrastructure-critical: a mocked-`execSync` test detects command-sequence regressions that BDD source-scanning cannot catch cheaply. The new `commitOperations.test.ts` follows the same rationale and mock pattern. BDD coverage is added in parallel for the source-shape regression gate.
- **Library install command:** none. The fix uses only Node stdlib (`fs`, `os`, `path`, `child_process`) — all already imported elsewhere in `adws/vcs/**`. No `bun add <package>` invocation is needed.
- **Concurrent-run race:** if two ADW orchestrators push KPI commits simultaneously, one push can fail with "non-fast-forward". The bug report explicitly accepts this as a non-fatal case; the fix's outer catch logs the warning and the next ADW run picks up the newer `origin/<default-branch>` on its next fetch. No retry loop is introduced — the KPI phase is cheap and will self-heal on the next workflow.
- **Security note:** `defaultBranch` is interpolated into shell commands via `execSync`. `getDefaultBranch()` reads from `gh repo view` which returns repository-controlled data. A malicious default-branch name could in theory inject shell metacharacters, but the value is double-quoted in every interpolation and `gh` constrains the return to a valid git ref name. No additional shell-escape wrapper is added — the existing double-quoting matches the convention across `branchOperations.ts` and `worktreeReset.ts`.
- **Why no dependency injection:** the bug report floats the idea of "passing a resolved default-branch value if we want DI for testing". The `worktreeReset.test.ts` mocking pattern demonstrates that `execSync` mocks already give full testability without DI. Adding a `defaultBranch?` parameter would widen the public API surface for a test-only benefit; skipped per minimal-fix principle.
- **Out of scope:** `commitChanges`, `pushBranch`, and the cost-file commit flow in `adws/vcs/commitOperations.ts` all still use `getCurrentBranch`. That is correct for their use case (target-repo feature-branch workflows) and is not part of this bug. Do not touch them.
