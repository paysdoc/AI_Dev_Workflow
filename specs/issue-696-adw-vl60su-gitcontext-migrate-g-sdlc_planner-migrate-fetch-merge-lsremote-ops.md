# Feature: GitContext — migrate git fetch/merge + ls-remote

## Metadata
issueNumber: `696`
adwId: `vl60su-gitcontext-migrate-g`
issueJson: `{"number":696,"title":"GitContext: migrate git fetch/merge + ls-remote","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\nAdd `fetchRemote`/`mergeBranch`/`lsRemote` methods and migrate autoMergeHandler (9 sites) and remoteReconcile, removing their ALLOWLIST entries.\n\n## Acceptance criteria\n- [ ] fetch/merge/ls-remote methods on GitContext\n- [ ] autoMergeHandler, remoteReconcile route through GitContext\n- [ ] Those files removed from `ALLOWLIST`\n- [ ] `lint:git-guard` passes; tests green\n\n## Blocked by\n- Blocked by #695\n\n## Touched Files\n- adws/gitContext/gitContext.ts\n- adws/triggers/autoMergeHandler.ts\n- adws/core/remoteReconcile.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 17","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-23T11:45:29Z","comments":[],"actionableComment":null}`

## Feature Description

This is one slice of the **GitContext repo-context authority** epic (parent PRD: `specs/prd/git-context-repo-authority.md`). The PRD makes a single `GitContext` deep module the sole authority for "which repo's filesystem/remote" a git/`gh` command targets, injecting per-command auth and an explicit `cwd` so a call site can never silently shell out against the wrong repository (the recurring "wrong-base-repo" bug class that has caused ~13 incidents).

This slice migrates the last two consumers of **remote git operations** — `fetch`, `merge`, and `ls-remote` — off raw `execSync`/`execWithRetry` shell-outs and onto `GitContext`:

1. **`adws/triggers/autoMergeHandler.ts`** — the auto-merge conflict-resolution retry loop (`mergeWithConflictResolution`) currently issues **9** direct `git` shell-outs (`git fetch`, `git merge --no-commit --no-ff`, `git merge --abort` ×2, `git merge --no-edit`, `git push`, `git fetch` + `git reset --hard`) against an explicit `cwd`.
2. **`adws/core/remoteReconcile.ts`** — `defaultBranchExistsOnRemote` runs `git ls-remote --exit-code origin <branch>` via `execWithRetry` **with no `cwd`**, so it resolves `origin` from `process.cwd()` rather than the target repo (a live instance of the wrong-base-repo bug).

To do this we add a small, package-private remote-op module and four thin `GitContext` methods (`fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`), route the two files through them (reusing the already-migrated `pushBranch` and `fetchAndResetToRemote` for the push and reset sites), and remove both files from the `checkGitGhGuard.ts` `ALLOWLIST` so the CI guard structurally forbids any regression.

The value: the auto-merge and stage-reconciliation paths gain correct per-command auth + `cwd`, the `ls-remote` wrong-`cwd` bug is fixed, and the guard's allowlist shrinks by two — making it harder for a future change to reintroduce the wrong-repo class.

## User Story

As an ADW maintainer (PRD user stories 5 and 17)
I want all `fetch`/`merge`/`ls-remote` operations in `autoMergeHandler` and `remoteReconcile` to go through `GitContext`, and those files removed from the git-guard allowlist
So that git identity and `cwd` are always correct for these remote operations, and it becomes impossible to reintroduce the wrong-repo class of bug from these call sites.

## Problem Statement

Two files still bypass `GitContext` and remain on the `checkGitGhGuard.ts` `ALLOWLIST`:

- `adws/triggers/autoMergeHandler.ts` issues 9 raw `execSync('git …')` calls. They pass a `cwd` explicitly, but they bypass `GitContext`'s per-command auth/identity injection and they keep the file on the allowlist, leaving the door open for an un-scoped git call to be added later without tripping the guard.
- `adws/core/remoteReconcile.ts`'s `defaultBranchExistsOnRemote` runs `git ls-remote --exit-code origin <branch>` via `execWithRetry` **without any `cwd`**. In the long-lived cron process whose `process.cwd()` is the ADW framework repo, `origin` resolves to the *framework* repo's remote, not the target repo's — so branch-existence (and therefore the reconciled `WorkflowStage`) can be derived against the wrong remote. This is exactly the wrong-base-repo bug the PRD exists to eliminate.

Until both files route through `GitContext` and leave the allowlist, the guard cannot enforce repo-context authority over remote git operations.

## Solution Statement

Mirror the established migration pattern from the immediately-preceding slice #695 (label/board/secret ops):

1. **Extend the `GitContext` surface.** Add a new package-private op module `adws/gitContext/remoteOps.ts` with four pure, runner-injected functions — `fetchRemote`, `mergeBranch` (flag-configurable), `abortMerge`, `lsRemote` — following the exact shape of the existing `branchOps`/`gitReadOps`/`commitOps` modules (git command strings are inlined inside the `gitContext/` package, which is structurally exempt from the guard). Wire four thin delegating methods onto the `GitContext` class through the private `#run()` chokepoint.

2. **Route `autoMergeHandler` through the context.** Thread a `GitContext` into `mergeWithConflictResolution` (new optional `gitContext?: GitContext` last parameter, defaulting to `gitContextForRepo(repoInfo)` so non-threading callers still work). Replace the 9 git shell-outs: the 2 base-branch fetches → `ctx.fetchRemote`, the 2 merges → `ctx.mergeBranch`, the 2 `merge --abort`s → `ctx.abortMerge`, the head-branch fetch+reset pair → the existing `ctx.fetchAndResetToRemote`, and the push → the existing `ctx.pushBranch`. Bind the launch-boundary `GitContext` at the two call sites (`adwMerge.tsx` deps boundary and `autoMergePhase.ts`).

3. **Route `remoteReconcile` through the context.** Rewrite `defaultBranchExistsOnRemote` to `gitContextForRepo(repoInfo).lsRemote(branchName)` and test emptiness — fixing the wrong-`cwd` bug because the factory resolves the correct base path from `repoInfo`. The injectable `ReconcileDeps.branchExistsOnRemote` seam is preserved, so existing unit tests stay green.

4. **Tighten the guard.** Remove `adws/triggers/autoMergeHandler.ts` and `adws/core/remoteReconcile.ts` from the `ALLOWLIST` in `adws/checkGitGhGuard.ts`. Leave `adws/adwPromotionSweep.tsx` (a separate, later slice) in place.

Reusing `pushBranch` and `fetchAndResetToRemote` keeps the public surface to exactly the methods named in the issue plus the small `abortMerge` companion, and aligns the auto-merge push with ADW's hardened force-with-lease push policy.

## Relevant Files

Use these files to implement the feature:

### Files to modify
- `adws/gitContext/gitContext.ts` — the `GitContext` deep module. Add four delegating methods (`fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`) that route through the private `#run()` chokepoint, mirroring how `getCurrentBranch`/`mergeLatestFromDefaultBranch`/`lsFiles` already delegate to their op modules. Import the new `remoteOps`.
- `adws/triggers/autoMergeHandler.ts` — `mergeWithConflictResolution` and its four helpers (`checkMergeConflicts`, `resolveConflictsViaAgent`, `pushBranchChanges`, `syncWorktreeToOriginHead`). Thread a `GitContext` and replace all 9 `execSync('git …')` calls. Remove the now-unused `execSync` import.
- `adws/core/remoteReconcile.ts` — rewrite `defaultBranchExistsOnRemote` to use `gitContextForRepo(repoInfo).lsRemote(...)`; drop the now-unused `execWithRetry` import (keep `log`); add the `gitContextForRepo` import.
- `adws/checkGitGhGuard.ts` — remove the two `ALLOWLIST` entries (`adws/triggers/autoMergeHandler.ts`, `adws/core/remoteReconcile.ts`).
- `adws/adwMerge.tsx` — `buildDefaultDeps(platform, gitCtx)` already holds a `GitContext`. Bind it into the `mergeWithConflictResolution` dep (wrap so the existing 8-arg call site at line ~192 is unchanged). The dep type `typeof mergeWithConflictResolution` (line ~59) auto-absorbs the new optional parameter.
- `adws/phases/autoMergePhase.ts` — `executeAutoMergePhase` already has `config: WorkflowConfig` (which carries the optional `gitContext`). Reference `config.gitContext` (add it to the destructure, which currently pulls `ctx`/`repoContext` but not `gitContext`) and pass it as the new last argument to `mergeWithConflictResolution`. Note: the existing destructured `ctx` is a `WorkflowContext` (PR URL / branch holder), **not** the `GitContext` — do not conflate them.

### Files to read for pattern (do not necessarily modify)
- `adws/gitContext/branchOps.ts` — canonical op-module shape (`Runner` type, inlined git strings, exported `branchOps` object). Note it already contains `mergeLatestFromDefaultBranch` and `fetchAndResetToRemote` — the latter is reused by this slice for the head-branch fetch+reset sync.
- `adws/gitContext/gitReadOps.ts` — read-op module shape; closest sibling to the new `remoteOps`.
- `adws/gitContext/commitOps.ts` — `pushBranch(run, branch, cwd)` (force-with-lease, fetch-first) reused for the auto-merge push site.
- `adws/gitContext/commands/secretCommands.ts` — the minimal #695 builder added in the prior slice (for reference on how thin a new addition is).
- `adws/github/gitContextFactory.ts` — `gitContextForRepo(repoInfo, opts?)` (line ~135) and `gitContextForSync` (line ~119); the per-repo factory used as the default-fallback context.
- `adws/core/launchGitContext.ts` — `buildLaunchGitContext(targetRepo, deps?)`; how the single launch-boundary context is built and threaded.
- `adws/phases/workflowInit.ts` — `WorkflowConfig.gitContext?: GitContext` (the optional launch-boundary context threaded into phases).
- `adws/github/githubApi.ts` — `RepoInfo` interface (line 7).
- `specs/prd/git-context-repo-authority.md` — parent PRD (user stories 5, 17; the `#run` chokepoint / no-cwd-fallback design contract).
- `specs/issue-695-adw-0p8lxe-gitcontext-migrate-l-sdlc_planner-migrate-label-board-secret-ops.md` — the immediately-preceding slice; mirror its three-phase structure and ALLOWLIST-removal step.

### Conditional docs (matched against `.adw/conditional_docs.md`)
- `app_docs/feature-djtyv4-remote-reconcile-module.md` — `deriveStageFromRemote`, `mapArtifactsToStage`, `ReconcileDeps` in `remoteReconcile.ts` (directly modified here).
- `app_docs/feature-cwiuik-1773818764164-auto-merge-approved-pr.md` — auto-merge logic and `MAX_AUTO_MERGE_ATTEMPTS` retry loop in `autoMergeHandler.ts`.
- `app_docs/feature-fvzdz7-auto-approve-merge-after-review.md` — `mergeWithConflictResolution()` and `executeAutoMergePhase`.
- `app_docs/feature-hx6dg4-robustness-hardening-retry-logic-resilience.md` — auto-merge early-exit paths in `autoMergeHandler.ts`/`autoMergePhase.ts`.
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — VCS/`autoMergeHandler` target-repo context (the wrong-repo bug family this slice closes).

### New Files
- `adws/gitContext/remoteOps.ts` — package-private op module exporting `remoteOps = { fetchRemote, mergeBranch, abortMerge, lsRemote }`. Each function takes an injected `(command, cwd) => string` runner. Inlines the four git command strings. Sits inside the guard-exempt `adws/gitContext/` package.
- `adws/gitContext/__tests__/remoteOps.test.ts` — pure unit tests for the four op functions against a fake runner (mirrors `adws/gitContext/__tests__/gitReadOps.test.ts`).

## Implementation Plan

### Phase 1: Foundation — extend the GitContext surface

Create the new `remoteOps` op module and wire four delegating methods onto `GitContext`. This is additive and breaks nothing; it can land and be unit-tested before any call site changes.

- `remoteOps.fetchRemote(run, branch, cwd)` → `git fetch origin "<branch>"` (propagates errors; caller decides warn-vs-throw).
- `remoteOps.mergeBranch(run, ref, cwd, opts?)` → `git merge [--no-commit] [--no-ff] [--no-edit] "<ref>"` (propagates errors; a conflict throws).
- `remoteOps.abortMerge(run, cwd)` → `git merge --abort`, swallowing errors (aborting with no merge in progress is a benign no-op).
- `remoteOps.lsRemote(run, branch, cwd)` → `git ls-remote origin "<branch>"`, returning the (already-trimmed) stdout — **deliberately without `--exit-code`** so an absent ref yields empty stdout (exit 0) instead of throwing on exit-2, leaving genuine failures (network/auth) as the only throw path.

`GitContext` methods delegate via the same `(cmd, c) => this.#run(cmd, { cwd: c })` adapter the existing methods use, so per-command auth + git identity injection is inherited for free:
- `fetchRemote(branch: string, cwd: string): void`
- `mergeBranch(ref: string, cwd: string, opts?: { noCommit?: boolean; noFf?: boolean; noEdit?: boolean }): void`
- `abortMerge(cwd: string): void`
- `lsRemote(branch: string, cwd?: string): string` (defaults `cwd` to the context base path)

### Phase 2: Core Implementation — route the two consumers through GitContext

**autoMergeHandler.ts** — thread a `GitContext` and replace all 9 sites:

| # | Current site | Replacement |
|---|---|---|
| 1 | `checkMergeConflicts`: `git fetch origin "<base>"` | `ctx.fetchRemote(baseBranch, cwd)` |
| 2 | `checkMergeConflicts`: `git merge --no-commit --no-ff "origin/<base>"` | `ctx.mergeBranch(`origin/${baseBranch}`, cwd, { noCommit: true, noFf: true })` |
| 3 | `checkMergeConflicts` (clean path): `git merge --abort` | `ctx.abortMerge(cwd)` |
| 4 | `checkMergeConflicts` (catch path): `git merge --abort` | `ctx.abortMerge(cwd)` |
| 5 | `resolveConflictsViaAgent`: `git fetch origin "<base>"` | `ctx.fetchRemote(baseBranch, cwd)` |
| 6 | `resolveConflictsViaAgent`: `git merge "origin/<base>" --no-edit` | `ctx.mergeBranch(`origin/${baseBranch}`, cwd, { noEdit: true })` |
| 7 | `pushBranchChanges`: `git push origin "<branch>"` | `ctx.pushBranch(branchName, cwd)` (existing; wrap try/catch → boolean) |
| 8 | `syncWorktreeToOriginHead`: `git fetch origin "<head>"` | folded into `ctx.fetchAndResetToRemote(headBranch, cwd)` (existing) |
| 9 | `syncWorktreeToOriginHead`: `git reset --hard "origin/<head>"` | folded into `ctx.fetchAndResetToRemote(headBranch, cwd)` (existing) |

- Add a new last parameter `gitContext?: GitContext` to `mergeWithConflictResolution`; inside, resolve `const ctx = gitContext ?? gitContextForRepo(repoInfo);` (mirrors #695's `config.gitContext ?? d.gitContextForRepo(repoInfo)`).
- Pass `ctx` into each of the four helpers (`checkMergeConflicts`, `resolveConflictsViaAgent`, `pushBranchChanges`, `syncWorktreeToOriginHead`).
- `pushBranchChanges` keeps its `boolean` return contract: `try { ctx.pushBranch(branchName, cwd); return true; } catch (error) { log(...'error'); return false; }`.
- `syncWorktreeToOriginHead` keeps its warn-don't-throw contract: wrap `ctx.fetchAndResetToRemote(headBranch, cwd)` in a single `try/catch` that logs a warning (collapses the original two sites; the two underlying git commands are still emitted in the same order).
- Remove the now-unused `import { execSync } from 'child_process'` and add `import { gitContextForRepo } from '../github/gitContextFactory'` and a type import `import type { GitContext } from '../gitContext'`.

**Call-site threading:**
- `adws/adwMerge.tsx` — in `buildDefaultDeps(platform, gitCtx)`, change the `mergeWithConflictResolution` dep from the bare function reference to a binding lambda that appends `gitCtx`:
  `mergeWithConflictResolution: (pr, repoInfo, head, base, wt, id, logs, spec) => mergeWithConflictResolution(pr, repoInfo, head, base, wt, id, logs, spec, gitCtx)`.
  The 8-arg call site (line ~192) and the `typeof` dep type (line ~59) are unchanged.
- `adws/phases/autoMergePhase.ts` — append `config.gitContext` as the 9th argument to the `mergeWithConflictResolution` call.

**remoteReconcile.ts** — rewrite the default branch-existence probe:
```ts
function defaultBranchExistsOnRemote(branchName: string, repoInfo: RepoInfo): boolean {
  try {
    return gitContextForRepo(repoInfo).lsRemote(branchName).length > 0;
  } catch (err) {
    log(`remoteReconcile: git ls-remote failed for branch '${branchName}': ${err}`, 'warn');
    return false;
  }
}
```
- Add `import { gitContextForRepo } from '../github/gitContextFactory'`.
- Drop `execWithRetry` from the `./utils` import (keep `log`).
- The `ReconcileDeps.branchExistsOnRemote` injection seam and `buildDefaultReconcileDeps` wiring are unchanged, so all existing `remoteReconcile.test.ts` tests (which inject `branchExistsOnRemote`) stay green.

### Phase 3: Integration — enforce via the guard and validate

- Remove `'adws/triggers/autoMergeHandler.ts'` and `'adws/core/remoteReconcile.ts'` from the `ALLOWLIST` in `adws/checkGitGhGuard.ts` (leave `'adws/adwPromotionSweep.tsx'`).
- Run `bun run lint:git-guard` — with both files no longer allowlisted and zero raw git/gh strings remaining in them, the guard must PASS. (`mergePR(...)` in `autoMergeHandler` is a function call, not a `gh `/`git ` string literal, so it is not a guard violation and stays as-is — it is out of scope for this slice.)
- Run the full validation suite (typecheck, eslint, unit tests, build).

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Create the `remoteOps` op module
- Create `adws/gitContext/remoteOps.ts` following the `adws/gitContext/gitReadOps.ts` shape: a `type Runner = (command: string, cwd: string) => string;`, four functions, and an exported `export const remoteOps = { fetchRemote, mergeBranch, abortMerge, lsRemote };`.
- `fetchRemote(run, branch, cwd)`: `return run(`git fetch origin "${branch}"`, cwd);`
- `mergeBranch(run, ref, cwd, opts = {})`: build `const flags = [opts.noCommit && '--no-commit', opts.noFf && '--no-ff', opts.noEdit && '--no-edit'].filter(Boolean).join(' ');` then `run(flags ? `git merge ${flags} "${ref}"` : `git merge "${ref}"`, cwd);`
- `abortMerge(run, cwd)`: `try { run('git merge --abort', cwd); } catch { /* no merge in progress — ignore */ }`
- `lsRemote(run, branch, cwd)`: `return run(`git ls-remote origin "${branch}"`, cwd);`
- Add a file header comment describing the module as the package-private remote-interaction + merge op module (fetch from origin, ls-remote queries, merge a ref, abort an in-progress merge), matching the documentation style of the sibling modules.

### 2. Add the four delegating methods to GitContext
- In `adws/gitContext/gitContext.ts`, add `import { remoteOps } from './remoteOps';` alongside the other op-module imports.
- Add a `// ── Remote fetch / merge / ls-remote ops ──` section (near the branch ops) with the four methods delegating through `(cmd, c) => this.#run(cmd, { cwd: c })`:
  - `fetchRemote(branch, cwd): void`
  - `mergeBranch(ref, cwd, opts?): void`
  - `abortMerge(cwd): void`
  - `lsRemote(branch, cwd?): string` — pass `cwd ?? this.#basePath`.

### 3. Unit-test the new op module and GitContext methods
- Create `adws/gitContext/__tests__/remoteOps.test.ts` mirroring `gitReadOps.test.ts`: a fake `Runner` that records `(command, cwd)` and returns a canned string. Assert:
  - `fetchRemote` issues `git fetch origin "<branch>"` with the given cwd.
  - `mergeBranch` with `{ noCommit, noFf }` issues `git merge --no-commit --no-ff "<ref>"`; with `{ noEdit }` issues `git merge --no-edit "<ref>"`; with no opts issues `git merge "<ref>"`.
  - `abortMerge` issues `git merge --abort` and swallows a thrown runner error (does not propagate).
  - `lsRemote` issues `git ls-remote origin "<branch>"` and returns the runner output.
- In `adws/gitContext/__tests__/gitContextOperations.test.ts`, add `describe` blocks for the four methods using the existing `makeSpyExec()` + `validOptions()` helpers, asserting the spied `command`, `cwd` (equals the passed cwd / base path), and injected env (`GH_TOKEN`, `GIT_AUTHOR_*`).

### 4. Migrate `autoMergeHandler.ts` to route through GitContext
- Add `import type { GitContext } from '../gitContext';` and `import { gitContextForRepo } from '../github/gitContextFactory';`; remove `import { execSync } from 'child_process';`.
- Add the `gitContext?: GitContext` parameter to `mergeWithConflictResolution` and resolve `const ctx = gitContext ?? gitContextForRepo(repoInfo);`.
- Update the four helpers to accept and use `ctx` per the Phase 2 mapping table. Preserve every existing behavior contract: `pushBranchChanges` returns `boolean`, `syncWorktreeToOriginHead` warns-and-continues, `checkMergeConflicts` returns `true` on conflict / `false` on clean (and always aborts the dry-run merge).

### 5. Thread the GitContext at both call sites
- `adws/adwMerge.tsx`: replace the bare `mergeWithConflictResolution,` dep in `buildDefaultDeps` with the `gitCtx`-binding lambda (Phase 2).
- `adws/phases/autoMergePhase.ts`: pass `config.gitContext` as the final argument to the `mergeWithConflictResolution` call.

### 6. Rework the autoMergeHandler unit tests
- In `adws/triggers/__tests__/autoMergeHandler.test.ts`, remove `vi.mock('child_process')` and the `execSync` import. Add a local `makeSpyExec()` (mirroring `gitContextOperations.test.ts`) and construct a real `GitContext` with the spy `exec`; pass it as the 9th argument to every `mergeWithConflictResolution` call.
- Replace `makeConflictingExecSync` with a spy `ExecFn` that throws (`{ status: 1 }`) when the command contains `git merge` together with `--no-commit` or `--no-edit`, and returns `''` otherwise.
- Keep the `mergePR` and `runClaudeAgentWithCommand` mocks (those modules are out of scope). The order assertion (`calls[0]` = `git fetch origin "<head>"`, `calls[1]` = `git reset --hard "origin/<head>"`, first `git merge` index > 1) still holds because `fetchAndResetToRemote` emits those two commands first via the spy.

### 7. Migrate `remoteReconcile.ts` to GitContext.lsRemote
- Rewrite `defaultBranchExistsOnRemote` per Phase 2 (use `gitContextForRepo(repoInfo).lsRemote(branchName).length > 0`).
- Update imports: add `gitContextForRepo`; remove `execWithRetry` (keep `log`).

### 8. Confirm remoteReconcile tests remain green
- Run `adws/core/__tests__/remoteReconcile.test.ts`; all tests inject `branchExistsOnRemote` via `ReconcileDeps`, so they must pass unchanged. (The `lsRemote(...).length > 0` mapping is covered by the GitContext `lsRemote` method tests from step 3.)

### 9. Remove the two ALLOWLIST entries
- In `adws/checkGitGhGuard.ts`, delete the `'adws/triggers/autoMergeHandler.ts'` and `'adws/core/remoteReconcile.ts'` lines from `ALLOWLIST` (and their trailing `// …` comments). Leave `'adws/adwPromotionSweep.tsx'`.

### 10. Add/align a BDD regression scenario for the guard
- Following the repo's BDD-first convention (and the #695 precedent), add or align a scenario tagged `@adw-696` asserting the observable outcome: the git/gh guard reports `autoMergeHandler.ts` and `remoteReconcile.ts` as no longer allowlisted and passes with zero violations (i.e. those files route remote git through `GitContext`). Place it under the configured per-issue scenario directory (see `.adw/scenarios.md`); the scenario test/fix phases drive it. Keep the assertion behavioral (guard exit status / report), not structural source-grep, per the scenario rot-prevention rule.

### 11. Run all Validation Commands
- Execute every command in the `Validation Commands` section below and confirm each exits cleanly with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`adws/gitContext/__tests__/remoteOps.test.ts` (new)** — pure tests for `fetchRemote`, `mergeBranch` (all three flag combinations + bare), `abortMerge` (including error-swallowing), and `lsRemote`, driven by a fake recording `Runner`. Mirrors `gitReadOps.test.ts`.
- **`adws/gitContext/__tests__/gitContextOperations.test.ts` (extend)** — for each of the four new methods, assert via `makeSpyExec()` that the correct git command string is issued, with `cwd` equal to the passed worktree path (and base path for `lsRemote`'s default), and that the child env carries `GH_TOKEN` and the git identity. This proves the methods inherit the `#run` auth/cwd chokepoint.
- **`adws/triggers/__tests__/autoMergeHandler.test.ts` (rework)** — switch from `execSync` mocking to a spy-`exec`-backed real `GitContext` injected as the 9th argument. Preserve the existing behavioral assertions: agent invoked on conflict, retry loop does not break on "not mergeable", failure returned after agent exhausts attempts, and the fetch→reset-before-merge ordering.
- **`adws/core/__tests__/remoteReconcile.test.ts` (verify unchanged)** — must stay green; the `ReconcileDeps.branchExistsOnRemote` seam means no real GitContext is exercised. No new test required here beyond confirming green; the `lsRemote` integration is covered by the GitContext method tests.

### Edge Cases
- **`ls-remote` for an absent branch** — without `--exit-code`, the command exits 0 with empty stdout → `lsRemote(...).length > 0` is `false` (branch absent) without throwing. A genuine failure (network/auth) throws → caught → warn → `false` (preserves prior fall-back-to-state-file behavior).
- **`abortMerge` when no merge is in progress** — `git merge --abort` exits non-zero; `abortMerge` swallows it so the clean-path / catch-path callers are unaffected.
- **`mergeBranch` conflict** — a conflicting merge throws; `checkMergeConflicts` catches it, calls `abortMerge`, and returns `true`.
- **Push failure / lease rejection** — `ctx.pushBranch` may throw (incl. the force-with-lease "remote moved underneath" error); `pushBranchChanges` catches → returns `false` → the loop logs and retries, capped by `MAX_AUTO_MERGE_ATTEMPTS` (same end behavior as before, with a clearer error message).
- **No threaded context** — a caller that omits `gitContext` falls back to `gitContextForRepo(repoInfo)`, which resolves the correct base path from `repoInfo` (token/identity per-command), so behavior is correct even without explicit threading.
- **Cron `process.cwd()` ≠ target repo** — the previous `ls-remote` bug; now `gitContextForRepo(repoInfo)` runs `ls-remote` with `cwd` = the target repo base path, so `origin` resolves correctly.

## Acceptance Criteria
- [ ] `GitContext` exposes `fetchRemote`, `mergeBranch`, and `lsRemote` methods (plus the `abortMerge` merge-family companion), each routed through the `#run()` per-command-auth chokepoint.
- [ ] `adws/triggers/autoMergeHandler.ts` issues zero direct `git`/`gh` shell-outs; all 9 former sites route through `GitContext` (`fetchRemote`/`mergeBranch`/`abortMerge` + reused `pushBranch`/`fetchAndResetToRemote`).
- [ ] `adws/core/remoteReconcile.ts` derives branch existence via `gitContextForRepo(repoInfo).lsRemote(...)` (no raw `execWithRetry('git …')`), fixing the wrong-`cwd` resolution.
- [ ] `adws/triggers/autoMergeHandler.ts` and `adws/core/remoteReconcile.ts` are removed from the `ALLOWLIST` in `adws/checkGitGhGuard.ts`.
- [ ] `bun run lint:git-guard` passes (zero violations) with the two files un-allowlisted.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit`, and `bun run build` all succeed with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint:git-guard` — git/gh CLI guard; MUST pass with `autoMergeHandler.ts` and `remoteReconcile.ts` no longer allowlisted (primary acceptance gate).
- `bunx tsc --noEmit -p adws/tsconfig.json` — type-check the `adws/` project (catches the signature/import changes and any accidental import cycle).
- `bun run lint` — ESLint across the repo (code-hygiene; flags the removed `execSync`/`execWithRetry` imports if any remain).
- `bun run test:unit` — run the full vitest suite (new `remoteOps` tests, extended `gitContextOperations` tests, reworked `autoMergeHandler` tests, unchanged `remoteReconcile` tests).
- `bun run build` — `tsc` build to verify no build errors.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep `remoteOps.ts` a single-responsibility module of pure runner-injected functions (immutability, side effects isolated at the `#run` boundary, guard clauses over nesting). Each `GitContext` method stays a one-line delegation, matching the existing surface.
- **Library install command** (`.adw/commands.md`): `bun add <package>` if ever needed — but this slice adds **no** new dependencies.
- **Why a new `remoteOps.ts` rather than extending `branchOps`/`gitReadOps`** — the four functions form a cohesive "operate against `origin` (fetch, ls-remote) and the merge that follows (merge, abort)" unit; a dedicated module keeps each op file small and single-purpose per the modularity guideline. `branchOps` already owns local branch lifecycle and the `fetchAndResetToRemote`/`mergeLatestFromDefaultBranch` sync helpers we reuse.
- **Push-semantics alignment (intentional)** — reusing `ctx.pushBranch` swaps the auto-merge loop's plain `git push origin <branch>` for ADW's hardened `git push --force-with-lease --force-if-includes -u` (with a fetch-first). This is consistent with the codebase's standardized push policy and the documented non-force-push deadlock fix; it is a deliberate, safe alignment, not scope creep. The retry/boolean behavior is preserved by wrapping the call.
- **`lsRemote` drops `--exit-code` deliberately** — the prior code special-cased git exit-2; routing through `GitContext`/`#run` (which throws on any non-zero exit) makes `--exit-code` actively harmful (a normal "branch absent" would throw). Omitting it yields empty-stdout-means-absent and reserves throws for real failures — simpler and strictly more correct for the `length > 0` check.
- **Import-cycle check** — `remoteReconcile.ts` (in `adws/core/`) importing `gitContextForRepo` from `adws/github/gitContextFactory` does not create a cycle (`gitContextFactory` depends on `adws/gitContext`, `adws/core/environment`, and `adws/github/githubAppAuth`; none import `remoteReconcile`). `tsc` will surface any regression.
- **`mergePR` is out of scope** — `autoMergeHandler` keeps calling `mergePR(prNumber, repoInfo)` from `adws/github`; it is a function call (not a literal `gh ` string), so it does not violate the guard. Migrating the `gh pr merge` wrapper belongs to a different slice.
- **Blocked by #695** — this slice builds directly on the #695 surface additions (`setSecret`/`runGraphQLInput` command-builder + method pattern) and its ALLOWLIST-shrinking precedent; #695 is merged to `dev` (commit `dd4d1be`).
