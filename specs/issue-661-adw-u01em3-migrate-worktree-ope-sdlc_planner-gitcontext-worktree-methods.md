# Feature: Migrate worktree operations onto GitContext; remove the defaulting base-path helper

## Metadata
issueNumber: `661`
adwId: `u01em3-migrate-worktree-ope`
issueJson: `{"number":661,"title":"Migrate worktree operations onto GitContext; remove defaulting helper","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Operation surface** and **Removal of the unsafe primitives**)\n\n## What to build\n\nMove all worktree operations — create, remove, reset, list, and worktree-path lookup — onto `GitContext` methods so worktree resolution is consistent everywhere and always under the context's base path. Once every worktree call site routes through the context, **delete the optional defaulting base-path helper** (`vcs/worktreeOperations.ts` `getWorktreesDir(baseRepoPath?)` / `getWorktreePath` and the `createWorktree*` / `getWorktreeForBranch` optional-`baseRepoPath` chain) and any cwd-defaulting worktree-path computation, so the previously-reachable wrong path no longer exists.\n\n## Acceptance criteria\n\n- [ ] Worktree create/remove/reset/list + path-lookup are `GitContext` methods (story 16)\n- [ ] All worktree call sites route through the context (no remaining optional-base-path callers)\n- [ ] The optional, defaulting base-path helper and cwd-defaulting worktree-path computation are removed\n- [ ] Worktrees for target repos resolve under the target workspace, not the framework cwd (story 1)\n- [ ] Existing worktree behaviour tests (mirroring `vcs/__tests__/worktreeReset.test.ts`) pass against the context methods\n\n## Blocked by\n\n- Blocked by #658\n\n## User stories addressed\n\n- User story 1\n- User story 16","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-21T10:20:28Z","comments":[{"author":"paysdoc","createdAt":"2026-06-23T07:28:34Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

This is the **worktree slice (#661)** of the GitContext epic (PRD: `specs/prd/git-context-repo-authority.md`). Earlier slices already migrated branch I/O, commit/push I/O, and worktree-**reset** I/O onto the `GitContext` deep module (#662), and the `gh` operation surface onto context methods (#663). The branch/commit/reset I/O functions in `adws/vcs/` are now stubs, and `GitContext.resetWorktree` / `GitContext.worktreePathFor` already exist.

This slice finishes the worktree surface. It moves the remaining worktree operations — **create** (`createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`), **remove** (`removeWorktree`, `removeWorktreesForIssue`), **list/query** (`listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`), and the **env-copy** helper (`copyEnvToWorktree`) — onto `GitContext` methods that resolve every path under the context's authoritative `basePath`. It then **deletes** the optional, silently-defaulting base-path helper (`getWorktreesDir(baseRepoPath?)`, `getWorktreePath`, `worktreeExists`) and strips the optional-`baseRepoPath` parameter from the create/ensure/getForBranch chain, so the wrong-repo worktree path is no longer *representable*.

The value: this kills the single most-exercised entry point of the ~13-episode "wrong-base-repo" bug class. Today `getWorktreesDir(baseRepoPath?)` silently defaults its base path to `getMainRepoPath()` → `process.cwd()`. Because ADW dogfoods itself, that default is *correct* against the framework repo and only detonates against target repos — so the defect ships and then fails in production (e.g. takeover computing a worktree under the framework root instead of the target workspace). After this slice, the base path can only come from a `GitContext` constructed at the launch boundary from authoritative identity.

## User Story

As an **ADW maintainer/operator**
I want **all worktree create/remove/reset/list/path-lookup operations to go through a `GitContext` whose base path is resolved once from authoritative identity**
So that **worktrees for target repos always resolve under the target workspace (not the framework cwd), the wrong-repo worktree-path bug becomes unrepresentable, and there is a single place that decides "which repo's filesystem" (PRD stories 1 and 16).**

## Problem Statement

Worktree base-path resolution is currently derived ad hoc at each call site through an **optional, silently-defaulting** helper:

- `getWorktreesDir(baseRepoPath?)` defaults to `getMainRepoPath()`, which parses `git worktree list --porcelain` against **`process.cwd()`** when no `cwd` is passed. Any caller that forgets the base path resolves `.worktrees/` under the *wrong* repo.
- `getWorktreePath(branchName, baseRepoPath?)`, `createWorktree(..., baseRepoPath?)`, `createWorktreeForNewBranch(..., baseRepoPath?)`, and `getWorktreeForBranch(branchName, baseRepoPath?)` all carry the same optional, defaulting parameter.
- The wrong default is *correct* on the dogfooded self-host path and only fails against target repos, so the defect is invisible in the most-exercised tests and only surfaces in production (the exact shape that stranded vestmatic #187 on the takeover path).

Meanwhile, `GitContext` already exists and already resolves the one "which base path" decision in its constructor (`selfHost` → framework root; target → `join(targetReposDir, owner, repo)`), already exposes `worktreePathFor(branch)` and `resetWorktree(...)`, and is already constructed at every launch boundary (`buildLaunchGitContext`) and reachable on demand via `gitContextForSync({owner, repo, selfHost})`. The worktree create/remove/list operations are simply not yet routed through it, and the defaulting helper is still reachable.

## Solution Statement

Follow the **exact** pattern established by the #662 branch/commit/reset migration:

1. **Add package-private worktree operation modules** under `adws/gitContext/` (mirroring `branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`): each function takes an injected runner `(cmd, cwd) => string` plus injected `fs` deps and **explicit, pre-computed paths**, so it never computes a base path itself and is testable without a real context (mirroring `vcs/__tests__/worktreeReset.test.ts`).

2. **Add thin `GitContext` methods** that delegate to those modules, computing the worktrees dir as `join(this.#basePath, '.worktrees')` and the per-branch path via the existing `worktreePathFor(branch)`. New methods: `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `listWorktrees`, `findWorktreeForIssue`, `removeWorktree`, `removeWorktreesForIssue`, `copyEnvToWorktree`. (`worktreePathFor` and `resetWorktree` already exist.)

3. **Reroute every call site** to obtain a `GitContext` (already threaded as `gitCtx`/`gitContext`/deps in the orchestrators and triggers, or constructed on demand via `gitContextForSync`) and call the new methods — dropping every `baseRepoPath`/`cwd` argument and, critically, the `process.cwd()` fallback in `workflowInit.ts` (this is what delivers story 1).

4. **Delete the unsafe primitives**: `getWorktreesDir`, `getWorktreePath`, `worktreeExists`, and the optional-`baseRepoPath` chain on the create/ensure/getForBranch functions; fold `isBranchCheckedOutElsewhere` / `freeBranchFromMainRepo` / `copyEnvToWorktree` into the package. `killProcessesInDirectory` (operates on an explicit absolute path, runs no `git`/`gh`, and is not a base-path-defaulting helper) moves into the package as a free util and is re-exported; `getMainRepoPath` is retained but tightened to a **required** `cwd` argument (the only remaining consumer, `claudeAgent.ts`, always passes an explicit worktree cwd) so its cwd-defaulting form ceases to exist.

The result mirrors `worktreeReset.ts`'s current end state: the vcs worktree-creation/query/cleanup modules become stubs (or slim retained utilities), and the base-path decision lives only in the `GitContext` constructor.

## Relevant Files

Use these files to implement the feature:

### Core module — GitContext package (the migration target)
- `adws/gitContext/gitContext.ts` — The `GitContext` class. Add the new worktree methods here as thin delegators (mirror the existing `resetWorktree`/`getCurrentBranch`/`commitChanges` methods at lines 155–202). Already has `worktreePathFor(branch)` (line 114) and `#basePath`.
- `adws/gitContext/worktreeResetOps.ts` — **The template to copy.** Package-private op module with injected runner + `FsDeps`; shows the exact injection idiom the new modules must follow.
- `adws/gitContext/branchOps.ts`, `adws/gitContext/commitOps.ts` — Additional templates for the injected-runner `Runner = (command, cwd) => string` idiom and the `export const xOps = { ... }` shape.
- `adws/gitContext/index.ts` — Public surface; export any new free util (e.g. `killProcessesInDirectory`) and shared types here if needed.
- `adws/gitContext/types.ts` — `ExecFn`, `GitContextDeps`, `GitIdentity`. Add a shared `FsDeps`-style type or worktree result types if appropriate.
- `adws/github/gitContextFactory.ts` — `gitContextForSync` / `gitContextFor` / `gitContextForRepo`: the on-demand construction path used by call sites that don't already hold a threaded context (takeover, webhook, cancel, janitor, pr-review).
- `adws/core/launchGitContext.ts` — `buildLaunchGitContext`: launch-boundary constructor (context for cron/orchestrators/webhook). No change expected; read for the threading contract.

### vcs worktree functions being migrated/deleted
- `adws/vcs/worktreeOperations.ts` — **Delete** `getWorktreesDir`, `getWorktreePath`, `worktreeExists`; **fold into package** `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`, `copyEnvToWorktree`; **retain (slim)** `getMainRepoPath` with a *required* `cwd` arg. `BranchCheckoutStatus` type moves with the create ops.
- `adws/vcs/worktreeCreation.ts` — `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch` all migrate into the package; file becomes a stub (mirror `worktreeReset.ts`).
- `adws/vcs/worktreeQuery.ts` — `listWorktrees`, `findWorktreeForIssue`, `WorktreeForIssueResult` migrate into the package; file becomes a stub.
- `adws/vcs/worktreeCleanup.ts` — `removeWorktree`, `removeWorktreesForIssue` migrate into the package; `killProcessesInDirectory` moves into the package as a free util (re-exported for the janitor).
- `adws/vcs/index.ts` — Update the worktree re-export block (lines 19–51) to drop deleted names and re-point retained ones.
- `adws/vcs/worktreeReset.ts` — Reference for the "stub file retained for module path" end state (#662 precedent).
- `adws/vcs/__tests__/worktreeReset.test.ts` — **The test template** the new package tests must mirror (injected runner + fs spy; assert command sequence, cwd, and absence of base-path defaulting).

### Call sites to reroute onto the context
- `adws/phases/workflowInit.ts` — Lines 234, 240, 245, 249, 253, 256 (`ensureWorktree`, `findWorktreeForIssue`, `getWorktreeForBranch`, `copyEnvToWorktree`). `gitCtx` (from `gitContextForSync`) is always in scope (line 139); route all six through it. **Line 256's `process.cwd()` fallback must disappear** — this delivers story 1.
- `adws/triggers/takeoverHandler.ts` — Lines 116 + 138–140: drop `getWorktreePath` from `TakeoverDeps`; `resolveWorktreePath` should use `input.gitContext ?? gitContextForSync(repoInfo).worktreePathFor(branch)` (mirrors the existing `resetWorktree` dep at line 110–112). Closest precedent for the path-lookup migration.
- `adws/adwMerge.tsx` — `MergeDeps.ensureWorktree` (line 58) + wiring (line 243); thread the `gitContext` built at line 271 into `buildDefaultDeps` and delegate to `gitContext.ensureWorktree(branchName, baseBranch)`; drop the `baseRepo` dep param.
- `adws/adwUpgrade.tsx` — `UpgradeDeps.ensureWorktree` (line 80) + wiring (line 386); `gitCtx` already injected into `buildDefaultUpgradeDeps` (line 382/434) — delegate to `gitCtx.ensureWorktree(branch, baseBranch)`; drop the `baseRepoPath` dep param.
- `adws/adwPromotionSweep.tsx` + `adws/promotion/promotionMover.ts` — `MoverDeps.createWorktree` (line 12) + wiring (lines 93–94); `gitCtx` already injected (line 83) — delegate to `gitCtx.createWorktreeForNewBranch(branchName, baseBranch)`; drop the now-unused `baseRepoPath` param.
- `adws/phases/prReviewPhase.ts` — Line 95 `ensureWorktree(prDetails.headBranch, undefined, targetRepoWorkspacePath)`; already imports `gitContextFor` (line 8) and has `resolvedRepoInfo` (line 41) — build a context and call `ctx.ensureWorktree(prDetails.headBranch)`, removing the `process.cwd()` base juggling (lines 87–95).
- `adws/triggers/cancelHandler.ts` — Line 65 `removeWorktreesForIssue(issueNumber, cwd)`; `repoInfo: RepoInfo` is a parameter — construct `gitContextForSync({owner, repo, selfHost: !cwd})` and call `ctx.removeWorktreesForIssue(issueNumber)`.
- `adws/triggers/webhookHandlers.ts` — Line 190 `d.removeWorktreesForIssue(issueNumber, cwd)`; per-event `gitContext` is available (param, line ~158) — wire the dep to `gitContext.removeWorktreesForIssue(issueNumber)`, falling back to `gitContextForSync(repoInfo)` when the per-event context is absent (legacy path).
- `adws/triggers/devServerJanitor.ts` — Line 170 `deps.listWorktrees(repoPath)`; the discovery loop (lines 157–177) already has `owner` and `repo` — change the default `listWorktrees` dep to `gitContextForSync({owner, repo, selfHost: false}).listWorktrees()`. Line 301 `killProcessesInDirectory(worktreePath)` stays (absolute-path util, re-exported from the package).
- `adws/agents/claudeAgent.ts` — Line 122 `getMainRepoPath(cwd)`; keep, but `getMainRepoPath` becomes required-`cwd` (no defaulting form). No GitContext is in scope at the agent-spawn boundary; this explicit-cwd resolver (returns the *main* repo path for `ADW_MAIN_REPO_PATH`, wrapped in try/catch, non-fatal) is deliberately retained.

### Tests to update (existing suites that mock/inject these functions)
- `adws/phases/__tests__/workflowInit.test.ts`
- `adws/triggers/__tests__/takeoverHandler.test.ts`, `adws/triggers/__tests__/takeoverHandler.integration.test.ts`
- `adws/__tests__/adwMerge.test.ts`, `adws/__tests__/adwUpgrade.test.ts`
- `adws/promotion/__tests__/promotionMover.test.ts`
- `adws/triggers/__tests__/cancelHandler.test.ts`, `adws/triggers/__tests__/webhookHandlers.test.ts`, `adws/triggers/__tests__/devServerJanitor.test.ts`

### New Files
- `adws/gitContext/worktreeCreateOps.ts` — Package-private create ops: `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, plus internal `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`, `copyEnvToWorktree`. Injected runner + `FsDeps`; receives the pre-computed worktrees dir, per-branch worktree path, and base path.
- `adws/gitContext/worktreeQueryOps.ts` — Package-private query ops: `listWorktrees`, `findWorktreeForIssue` (accepts a resolved `prefixes: readonly string[]` so the package stays free of ADW core's `branchPrefixMap`), `getWorktreeForBranch`. Injected runner + `FsDeps`.
- `adws/gitContext/worktreeRemoveOps.ts` — Package-private remove ops: `removeWorktree`, `removeWorktreesForIssue`, plus internal `parseWorktreeBranches`. Injected runner + `FsDeps` + a `killProcesses` function.
- `adws/gitContext/processCleanup.ts` — Self-contained `killProcessesInDirectory(dir)` (lsof + SIGTERM→SIGKILL escalation), so the package owns its process-kill and stays standalone. Exported from `adws/gitContext/index.ts` and re-exported from `adws/vcs/index.ts` for the janitor.
- `adws/gitContext/__tests__/worktreeCreateOps.test.ts` — Mirror `worktreeReset.test.ts`: injected runner + fs spy; assert command sequence, cwd, branch-exists/checked-out-elsewhere branches, and no base-path defaulting.
- `adws/gitContext/__tests__/worktreeQueryOps.test.ts` — Porcelain parsing, prefix matching for `findWorktreeForIssue`, `getWorktreeForBranch` reuse/orphan paths.
- `adws/gitContext/__tests__/worktreeRemoveOps.test.ts` — Remove success/fallback paths, `removeWorktreesForIssue` matching + branch deletion, `git worktree prune`.

### Conditional documentation (from `.adw/conditional_docs.md` — matched by this task)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — **Primary.** Owns `adws/gitContext/**` and `gitContextFactory.ts`; conditions explicitly cover "migrating call sites away from `getWorktreePath(branch, baseRepoPath?)` optional-default to `GitContext`", adding GitContext methods (thin-method + pure-op pattern), and the wrong-repo bug class.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — Owns `adws/vcs/**` and `worktreeSetup.ts`; conditions cover `ensureWorktree`/`createWorktree`/`createWorktreeForNewBranch`, `removeWorktree`/`removeWorktreesForIssue`/`killProcessesInDirectory`, and command-sequence tests in `adws/vcs/__tests__/`.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — Owns `launchGitContext.ts`; conditions cover wiring `gitContext.basePath` into worktree creation / `ensureWorktree` as the self-host base-path replacement for `process.cwd()`, and `EvaluateCandidateInput.gitContext` / `WorkflowConfig.gitContext`.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — Owns `takeoverHandler.ts`.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — Owns `cancelHandler.ts` and `devServerJanitor.ts`.
- `app_docs/feature-9gjajh-webhook-triggers.md` — Owns `webhookHandlers.ts`; per-event `GitContext` threading and multi-repo auth isolation.
- `app_docs/feature-k817bh-persist-repo-identity-cross-check.md` — `workflowInit.ts` repo-identity context (do not disturb the cross-check wiring).
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — `workflowInit.ts` branch-name resolution around the worktree calls.
- `app_docs/feature-ie8l08-fix-pr-review-target-repo.md` — The `ensureWorktree`-without-`baseRepoPath` wrong-repo class in the PR-review path (prReviewPhase).
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — `copyEnvToWorktree` / `ensureWorktree` target-repo context.
- `app_docs/feature-v7dih7-adwupgrade-worktree-reconcile.md` — `adwUpgrade` worktree setup.
- `app_docs/feature-f704s2-dev-server-janitor-cron.md` — `devServerJanitor` worktree listing.
- `app_docs/feature-hx6dg4-robustness-hardening-retry-logic-resilience.md` — `createWorktree`/`createWorktreeForNewBranch` base-ref logic.

## Implementation Plan

### Phase 1: Foundation — package-private worktree ops modules + GitContext methods

Build the new capability inside the `GitContext` package first, fully unit-tested against injected seams, before touching any call site. This mirrors how #662 landed `worktreeResetOps.ts` + `GitContext.resetWorktree` before re-homing the vcs reset logic.

1. Create `worktreeQueryOps.ts`, `worktreeCreateOps.ts`, `worktreeRemoveOps.ts`, and `processCleanup.ts` in `adws/gitContext/`, each using the injected-runner + `FsDeps` idiom from `worktreeResetOps.ts`. No base-path computation lives in these modules — they receive the worktrees dir, per-branch worktree path, and base path as explicit arguments.
2. Add the thin `GitContext` methods that compute paths from `#basePath` and delegate to the ops modules.
3. Write the package unit tests mirroring `worktreeReset.test.ts`.

### Phase 2: Core Implementation — reroute every call site through the context

With the methods in place, switch each consumer from the standalone vcs functions to the threaded/constructed `GitContext`, dropping every `baseRepoPath`/`cwd` argument and the `process.cwd()` fallback. Update the affected deps interfaces and their test mocks as each site is converted, so the suite stays green incrementally.

### Phase 3: Integration — delete the unsafe primitives and finalize

Once no caller passes an optional base path, delete `getWorktreesDir` / `getWorktreePath` / `worktreeExists` and the optional-`baseRepoPath` chain; reduce the migrated vcs modules to stubs (mirroring `worktreeReset.ts`); retain `getMainRepoPath` with a required `cwd`; update `vcs/index.ts`; grep-sweep for stragglers; run the full validation suite.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Add `processCleanup.ts` to the GitContext package
- Create `adws/gitContext/processCleanup.ts` exporting `killProcessesInDirectory(directoryPath: string): void`, ported verbatim from `worktreeCleanup.ts` (lsof discovery, SIGTERM, 500 ms wait, SIGKILL survivors, self-PID filter). It runs `lsof`/`sleep` and `process.kill` — no `git`/`gh` — so it remains a free function.
- Export it from `adws/gitContext/index.ts`.
- Keep it dependency-light (no ADW core imports) to preserve the package's standalone goal.

### 2. Add `worktreeQueryOps.ts` (list / find / getForBranch)
- Create `adws/gitContext/worktreeQueryOps.ts` with a `Runner = (command: string, cwd: string) => string` type and an `FsDeps` interface (`existsSync`) matching `worktreeResetOps.ts`.
- Port `listWorktrees` → `listWorktrees(run, baseCwd)`: runs `git worktree list --porcelain` in `baseCwd`, returns the `.worktrees/` paths.
- Port `findWorktreeForIssue` → `findWorktreeForIssue(run, baseCwd, prefixes, issueNumber)`: accepts a pre-resolved `prefixes: readonly string[]` (so the package never imports ADW's `branchPrefixMap`), builds the `^(prefix|...)-issue-{n}-` regex, parses porcelain output, returns `{ worktreePath, branchName }` or `null`. Move the `WorktreeForIssueResult` type into this module.
- Port `getWorktreeForBranch` → `getWorktreeForBranch(run, fs, baseCwd, expectedWorktreePath, branchName)`: porcelain match by expected path, fallback match by branch under `.worktrees`, fallback `fs.existsSync(expectedWorktreePath)` orphan reuse.
- Export `export const worktreeQueryOps = { listWorktrees, findWorktreeForIssue, getWorktreeForBranch }`.

### 3. Add `worktreeCreateOps.ts` (create / createForNewBranch / ensure)
- Create `adws/gitContext/worktreeCreateOps.ts` with the same injected runner + `FsDeps` (`existsSync`, `mkdirSync`, `copyFileSync`).
- Port the internal helpers as module-private functions driven by the injected runner against an explicit `baseCwd`: `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo` (preserve its existing non-force `git push -u` behaviour — see Notes), and `copyEnvToWorktree` (source `.env`/`.env.local` from the passed `baseCwd`, not `getMainRepoPath()`).
- Port `createWorktree(run, fs, { worktreesDir, worktreePath, baseCwd }, branchName, baseBranch?)`, `createWorktreeForNewBranch(...)`, and `ensureWorktree(run, fs, paths, branchName, baseBranch?)` (ensure = `getWorktreeForBranch` reuse + `copyEnvToWorktree`, else `createWorktree` + `copyEnvToWorktree`).
- Move the `BranchCheckoutStatus` type here. Keep `log` calls (framework logger is an acceptable boundary side effect; `worktreeResetOps` stays silent, but the create path's progress logging is behaviour worth preserving).
- Export `export const worktreeCreateOps = { createWorktree, createWorktreeForNewBranch, ensureWorktree, copyEnvToWorktree }`.

### 4. Add `worktreeRemoveOps.ts` (remove / removeForIssue)
- Create `adws/gitContext/worktreeRemoveOps.ts` with injected runner + `FsDeps` (`existsSync`, `rmSync`) + a `killProcesses: (dir: string) => void` parameter (defaulted/wired to `processCleanup.killProcessesInDirectory`).
- Port `parseWorktreeBranches` (porcelain → path→branch map), `removeWorktree(run, fs, killProcesses, worktreePath, branchName, deleteLocalBranch)`, and `removeWorktreesForIssue(run, fs, killProcesses, baseCwd, issueNumber, deleteLocalBranch)`. Branch deletion currently uses `deleteLocalBranch` from `branchOperations`; route it through the context's existing `deleteLocalBranch` capability (inject the bound runner-backed deleter) so no raw vcs branch I/O remains.
- Export `export const worktreeRemoveOps = { removeWorktree, removeWorktreesForIssue }`.

### 5. Add the new `GitContext` methods
- In `adws/gitContext/gitContext.ts`, add a private `#worktreesDir(): string { return path.join(this.#basePath, '.worktrees'); }` helper and the public methods, each a thin delegator binding `(cmd, cwd) => this.#run(cmd, { cwd })` and `{ existsSync, mkdirSync, copyFileSync, rmSync }`:
  - `createWorktree(branchName, baseBranch?): string`
  - `createWorktreeForNewBranch(branchName, baseBranch?): string`
  - `ensureWorktree(branchName, baseBranch?): string`
  - `getWorktreeForBranch(branchName): string | null`
  - `listWorktrees(): string[]`
  - `findWorktreeForIssue(prefixes: readonly string[], issueNumber): WorktreeForIssueResult | null`
  - `removeWorktree(branchName): boolean`
  - `removeWorktreesForIssue(issueNumber): number`
  - `copyEnvToWorktree(worktreePath): void`
- Each computes the worktrees dir via `#worktreesDir()` and the per-branch path via the existing `worktreePathFor(branchName)`; `baseCwd` is `this.#basePath`. None accepts a base-path argument.
- Wire branch deletion inside `removeWorktree*` to the existing `deleteLocalBranch` path.

### 6. Unit tests for the new ops modules
- Create `adws/gitContext/__tests__/worktreeCreateOps.test.ts`, `worktreeQueryOps.test.ts`, `worktreeRemoveOps.test.ts`, mirroring `vcs/__tests__/worktreeReset.test.ts`: a `makeRunner` recording `{command, cwd}`, a `makeFsSpy` recording `existsSync`/`mkdirSync`/`rmSync`/`copyFileSync`, and assertions on exact command strings, command ordering, the cwd each command ran under, and the branches (branch-exists vs new-branch-from-base; checked-out-elsewhere reuse; orphan-directory reuse; remove success vs prune-fallback; issue-prefix matching).
- Add (or extend `gitContext.test.ts`) a test proving the new methods compute paths under `basePath` for both a self-host and a target identity, and never under `process.cwd()` (chdir-resistance, like the existing `explicit cwd` block).
- Run `bunx tsc --noEmit -p adws/tsconfig.json` and `bun run test:unit` for the new files; keep iterating until green.

### 7. Reroute `workflowInit.ts` (delivers story 1)
- Replace the six call sites with `gitCtx` method calls: `gitCtx.ensureWorktree(branchName, defaultBranch)` (lines 234 and 256), `gitCtx.findWorktreeForIssue(prefixesFor(issueType), issueNumber)` (line 240), `gitCtx.copyEnvToWorktree(worktreePath)` (lines 245 and 253), `gitCtx.getWorktreeForBranch(branchName)` (line 249). Resolve `prefixesFor(issueType)` from `branchPrefixMap[issueType]` + `branchPrefixAliases[issueType]` at the call site.
- **Delete the `gitContext?.basePath ?? process.cwd()` argument at line 256** — `gitCtx` (from `gitContextForSync`, always present) carries the correct base path. Confirm `gitCtx.basePath` equals `targetRepoWorkspacePath` for target runs and `REPO_ROOT` for self-host runs (it does, by construction).
- Drop the now-unused vcs imports.
- Update `adws/phases/__tests__/workflowInit.test.ts` mocks to the context methods.

### 8. Reroute `takeoverHandler.ts` (path-lookup)
- Remove `getWorktreePath` from the `TakeoverDeps` interface and from `buildDefaultTakeoverDeps`.
- Change `resolveWorktreePath` to use `input.gitContext ?? gitContextForSync({owner, repo, selfHost: false})` (built from `input.repoInfo`, mirroring the existing `resetWorktree` dep) and call `.worktreePathFor(branchName)`. Keep the existing "prefer launch-boundary context" comment intent.
- Update `takeoverHandler.test.ts` and `takeoverHandler.integration.test.ts` (drop the `getWorktreePath` dep stub; assert `worktreePathFor` is used).

### 9. Reroute the orchestrator deps (`adwMerge`, `adwUpgrade`, `adwPromotionSweep`/`promotionMover`)
- `adwMerge.tsx`: thread the `gitContext` (built at line 271) into `buildDefaultDeps`; change `MergeDeps.ensureWorktree` to `(branchName, baseBranch) => string` and wire it to `gitContext.ensureWorktree(branchName, baseBranch)`; remove the `baseRepo` param and the raw `ensureWorktree` import.
- `adwUpgrade.tsx`: change `UpgradeDeps.ensureWorktree` to `(branch, baseBranch) => string`; wire `buildDefaultUpgradeDeps` (which already receives `gitCtx`) to `gitCtx.ensureWorktree(branch, baseBranch)`; remove the raw import.
- `adwPromotionSweep.tsx`: wire `createWorktree` to `gitCtx.createWorktreeForNewBranch(branchName, baseBranch)`; remove the now-unused `baseRepoPath` param and the `createWorktreeForNewBranch` import. `promotionMover.ts`'s `MoverDeps.createWorktree` signature is unchanged.
- Update `adwMerge.test.ts`, `adwUpgrade.test.ts`, `promotionMover.test.ts` deps mocks.

### 10. Reroute `prReviewPhase.ts`
- Build a context from `resolvedRepoInfo` (e.g. `gitContextForSync({owner, repo, selfHost: !targetRepo})`) and replace line 95 with `ctx.ensureWorktree(prDetails.headBranch)`; simplify the `targetRepoWorkspacePath`/`process.cwd()` base juggling (lines 87–95) now that the context owns the base path. Preserve any other use of `targetRepoWorkspacePath`.

### 11. Reroute the trigger handlers (`cancelHandler`, `webhookHandlers`, `devServerJanitor`)
- `cancelHandler.ts`: replace `removeWorktreesForIssue(issueNumber, cwd)` with `gitContextForSync({owner: repoInfo.owner, repo: repoInfo.repo, selfHost: !cwd}).removeWorktreesForIssue(issueNumber)`.
- `webhookHandlers.ts`: wire the `removeWorktreesForIssue` dep to the per-event `gitContext.removeWorktreesForIssue(issueNumber)`, falling back to `gitContextForSync(repoInfo)` when the per-event context is undefined.
- `devServerJanitor.ts`: change the default `listWorktrees` dep so `discoverTargetRepoWorktrees` calls `gitContextForSync({owner, repo, selfHost: false}).listWorktrees()` using the `owner`/`repo` already in the loop; re-point `killProcessesInDirectory` to the package export.
- Update `cancelHandler.test.ts`, `webhookHandlers.test.ts`, `devServerJanitor.test.ts`.

### 12. Tighten `getMainRepoPath` and update `claudeAgent.ts`
- Change `getMainRepoPath(cwd?: string)` to `getMainRepoPath(cwd: string)` (required) in its retained location; the only caller (`claudeAgent.ts:122`) already passes an explicit worktree `cwd`. This removes the cwd-defaulting form without threading a context into the agent-spawn boundary.

### 13. Delete the unsafe primitives and slim the vcs modules
- Delete `getWorktreesDir`, `getWorktreePath`, and `worktreeExists` from `worktreeOperations.ts`. Remove `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`, `copyEnvToWorktree` (now in the package). Reduce `worktreeOperations.ts` to `getMainRepoPath(cwd)` (+ any still-needed type), mirroring the `worktreeReset.ts` slim/stub precedent.
- Reduce `worktreeCreation.ts` and `worktreeQuery.ts` to stubs (header comment noting migration to `GitContext` (#661), no exports), mirroring `worktreeReset.ts`.
- Reduce `worktreeCleanup.ts`: remove `removeWorktree`/`removeWorktreesForIssue`; re-export `killProcessesInDirectory` from the package (or delete and update importers to the package path).
- Update `adws/vcs/index.ts` (lines 19–51): drop `getWorktreePath`, `worktreeExists`, `getWorktreesDir`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`, `BranchCheckoutStatus`, `listWorktrees`, `findWorktreeForIssue`, `WorktreeForIssueResult`, `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `removeWorktree`, `removeWorktreesForIssue`; keep `getMainRepoPath` and `killProcessesInDirectory` (re-exported).

### 14. Grep-sweep for stragglers
- Run `grep -rn` across `adws/` (excluding `__tests__` first, then including) for every migrated/deleted name: `getWorktreesDir`, `getWorktreePath`, `worktreeExists`, `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `listWorktrees`, `findWorktreeForIssue`, `removeWorktree`, `removeWorktreesForIssue`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`. Resolve any remaining importer of a deleted symbol (route through the context or the retained util). Confirm no production code outside the package computes a `.worktrees` path or calls `getMainRepoPath()` with no argument.

### 15. Run the full validation suite
- Execute every command in the **Validation Commands** section and fix any lint/type/test/build failure until all pass with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **New package op tests** (`adws/gitContext/__tests__/worktreeCreateOps.test.ts`, `worktreeQueryOps.test.ts`, `worktreeRemoveOps.test.ts`) mirror `vcs/__tests__/worktreeReset.test.ts`: drive each op with a recording runner and an fs spy; assert exact `git` command strings, command ordering, the `cwd` each command ran under (always the supplied `baseCwd`/worktree path, never `process.cwd()`), and the branch logic (branch-exists vs new-from-base; checked-out-elsewhere reuse; orphan-directory reuse; remove success vs prune-fallback; issue-prefix regex matching). This satisfies the "existing worktree behaviour tests, mirroring `worktreeReset.test.ts`, pass against the context methods" criterion.
- **GitContext path-correctness tests** (extend `adws/gitContext/__tests__/gitContext.test.ts`): a target identity resolves worktree paths under `join(targetReposDir, owner, repo)/.worktrees`; a self-host identity under `frameworkRepoRoot/.worktrees`; both remain correct after `process.chdir('/tmp')` (chdir-resistance). This pins story 1 at the unit level.
- **Updated call-site tests**: adjust the deps mocks in the nine existing suites (workflowInit, takeoverHandler ×2, adwMerge, adwUpgrade, promotionMover, cancelHandler, webhookHandlers, devServerJanitor) so they inject/assert the context methods instead of the deleted vcs functions, keeping zero regression.

### Edge Cases
- **Target vs self-host base path**: target worktrees must land under the target workspace; self-host under the framework root. (workflowInit line 256 previously fell back to `process.cwd()` — verify the fallback is gone and the path is correct in both modes.)
- **Branch checked out in the main repo** vs **in another worktree** vs **does not exist** in `createWorktree` (free-from-main / reuse-existing / create-from-base).
- **Orphan worktree directory** present on disk but untracked by git (`getWorktreeForBranch` `fs.existsSync` reuse).
- **`removeWorktree` fallback** when `git worktree remove` fails but the directory exists (prune + `rmSync`).
- **`removeWorktreesForIssue`** matching multiple worktrees by `-issue-{n}-` and deleting their local branches; no-match returns 0.
- **`findWorktreeForIssue` prefix aliases** (e.g. `/feature` prefix + aliases) resolve to the same matches as before.
- **Missing/undefined launch context** on takeover (cron module imported by tests → `cronGitContext` undefined): `resolveWorktreePath` must still resolve via `gitContextForSync(repoInfo)`.
- **`killProcessesInDirectory`** on an absolute worktree path with no running processes (silent no-op) — unchanged behaviour after the move to the package.

## Acceptance Criteria
- [ ] Worktree **create** (`createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`), **remove** (`removeWorktree`, `removeWorktreesForIssue`), **reset** (already present), **list/query** (`listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`), and **path-lookup** (`worktreePathFor`, already present) are `GitContext` methods (story 16).
- [ ] Every worktree call site routes through a `GitContext` (threaded `gitCtx`/`gitContext`/deps, or `gitContextForSync`); no caller passes an optional base-path/`cwd` to a worktree function.
- [ ] `getWorktreesDir(baseRepoPath?)`, `getWorktreePath`, `worktreeExists`, and the `createWorktree*` / `getWorktreeForBranch` optional-`baseRepoPath` chain are deleted; `getMainRepoPath` no longer has a cwd-defaulting form; no cwd-defaulting worktree-path computation remains reachable.
- [ ] Worktrees for target repos resolve under the target workspace, not the framework cwd — the `process.cwd()` fallback in `workflowInit.ts` is removed (story 1).
- [ ] New worktree behaviour tests mirroring `vcs/__tests__/worktreeReset.test.ts` pass against the context methods; all nine updated call-site suites pass.
- [ ] `adws/vcs/worktreeCreation.ts` and `worktreeQuery.ts` are stubs; `worktreeCleanup.ts`/`worktreeOperations.ts` retain only the non-defaulting utilities; `vcs/index.ts` exports are updated.
- [ ] Lint, type-check (root + `adws/tsconfig.json`), unit tests, and build all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — Lint the codebase for quality/style issues.
- `bunx tsc --noEmit` — Root type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW workspace type-check (catches deleted-export and signature-change breakage across `adws/`).
- `bun run test:unit` — Run the unit suite (new `adws/gitContext/__tests__/worktree*Ops.test.ts` + all updated call-site suites) with zero regressions.
- `bun run build` — Verify the project builds with no errors.
- `grep -rn "getWorktreesDir\|getWorktreePath\|worktreeExists" adws --include=*.ts --include=*.tsx | grep -v "__tests__"` — Must return **no** production hits (the defaulting helpers are gone).
- `grep -rn "ensureWorktree\|createWorktree\|removeWorktreesForIssue\|listWorktrees\|findWorktreeForIssue\|getWorktreeForBranch\|copyEnvToWorktree" adws --include=*.ts --include=*.tsx | grep -v "__tests__" | grep -v "gitContext/"` — Every remaining hit must be a `GitContext` method call (`.ensureWorktree(`, `ctx.createWorktree(`, etc.), not a standalone vcs-function call with a base-path argument.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep each new ops file a single responsibility and under 300 lines; prefer guard clauses / early returns over nesting (the ported create/remove logic has try/catch fallbacks worth flattening); treat data as immutable; isolate side effects (the injected runner + `fs` deps + `log`) at the module boundary, exactly as `worktreeResetOps.ts` does. Avoid `any`; reuse the established `Runner`/`FsDeps` types.
- **No new libraries** are required; this is a pure internal refactor. (Library install command, if ever needed: `bun add <package>` per `.adw/commands.md`.)
- **Mirror #662 precisely.** `branchOps.ts`, `commitOps.ts`, and especially `worktreeResetOps.ts` + `worktreeReset.test.ts` are the canonical templates for the injected-runner + fs-spy idiom and the "vcs module becomes a stub" end state. Do not invent a new pattern.
- **Package standalone-ness** (PRD reuse goal): the new ops modules and `processCleanup.ts` must not import ADW core globals. `findWorktreeForIssue` therefore takes a resolved `prefixes` array rather than importing `branchPrefixMap`; the one caller (`workflowInit`) resolves the prefixes from `issueType`.
- **`killProcessesInDirectory`** runs `lsof`/`process.kill` (not `git`/`gh`) and operates on an explicit absolute path, so it is not part of the base-path-defaulting bug class and is not subject to the PRD's raw-`git`/`gh` CI ban. It moves into the package only to keep the remove op self-contained; the janitor consumes it unchanged via re-export.
- **`getMainRepoPath` retention**: deliberately kept (with a *required* `cwd`) for `claudeAgent.ts`'s `ADW_MAIN_REPO_PATH` env injection, where no `GitContext` is in scope at the agent-spawn boundary. It computes the *main* repo path from an explicit worktree cwd and is wrapped in a non-fatal try/catch — it is not a worktree-path computation and no longer defaults to `process.cwd()`.
- **Pre-existing behaviour to preserve, not fix here**: `freeBranchFromMainRepo` uses a non-force `git push -u origin` (the known non-force-push deadlock risk on rewritten branches is tracked separately and is out of scope for this slice). Routing it through the context's per-command env is a strict improvement (token is now explicit) but must not change the push semantics.
- **Two contexts in `workflowInit`**: the function holds both `gitCtx` (from `gitContextForSync`, always present, already driving `defaultBranch`/`mergeLatestFromDefaultBranch`/`fetchAndResetToRemote`) and the optional `gitContext` (from `buildLaunchGitContext`, used for the repo-identity cross-check). Use `gitCtx` for the worktree methods for consistency with the adjacent git ops; do not refactor away the dual-context here (out of scope; both resolve to the same base path).
- **Cross-check wiring**: do not disturb the `repoIdentity` cross-check (`feature-k817bh`) or branch-name persistence (`feature-sh8m9r`) logic in `workflowInit.ts`; this slice only swaps the worktree-function calls.
