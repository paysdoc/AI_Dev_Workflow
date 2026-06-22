# Feature: Migrate worktree operations onto GitContext; remove the defaulting helper

## Metadata
issueNumber: `661`
adwId: `ycu7a3-migrate-worktree-ope`
issueJson: `{"number":661,"title":"Migrate worktree operations onto GitContext; remove defaulting helper","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Operation surface** and **Removal of the unsafe primitives**)\n\n## What to build\n\nMove all worktree operations — create, remove, reset, list, and worktree-path lookup — onto `GitContext` methods so worktree resolution is consistent everywhere and always under the context's base path. Once every worktree call site routes through the context, **delete the optional defaulting base-path helper** (`vcs/worktreeOperations.ts` `getWorktreesDir(baseRepoPath?)` / `getWorktreePath` and the `createWorktree*` / `getWorktreeForBranch` optional-`baseRepoPath` chain) and any cwd-defaulting worktree-path computation, so the previously-reachable wrong path no longer exists.\n\n## Acceptance criteria\n\n- [ ] Worktree create/remove/reset/list + path-lookup are `GitContext` methods (story 16)\n- [ ] All worktree call sites route through the context (no remaining optional-base-path callers)\n- [ ] The optional, defaulting base-path helper and cwd-defaulting worktree-path computation are removed\n- [ ] Worktrees for target repos resolve under the target workspace, not the framework cwd (story 1)\n- [ ] Existing worktree behaviour tests (mirroring `vcs/__tests__/worktreeReset.test.ts`) pass against the context methods\n\n## Blocked by\n\n- Blocked by #658\n\n## User stories addressed\n\n- User story 1\n- User story 16","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-21T10:20:28Z","comments":[],"actionableComment":null}`

## Feature Description

This is the second slice of the GitContext PRD (`specs/prd/git-context-repo-authority.md`). The foundational slice (#658, merged via PR #677) shipped the `GitContext` deep module — a mandatory-identity class that resolves a single `basePath` (self-host → framework repo root; target → `join(TARGET_REPOS_DIR, owner, repo)`), exposes `worktreePathFor(branch)` and `commandEnv(base?)`, and imports **nothing** from ADW globals. Critically, that slice shipped the *class only*: `GitContext` is currently constructed **nowhere** in the codebase (verified — no `new GitContext` outside its own tests). The full git/`gh` operation surface and all call-site migration were explicitly deferred to later slices.

This slice (#661) delivers the **worktree operation surface** and the **first real construction sites**:

1. Add the worktree operations — `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `removeWorktree`, `removeWorktreesForIssue`, `listWorktrees`, `findWorktreeForIssue`, `worktreeExists`, `copyEnvToWorktree`, and `resetWorktree` — as **methods on `GitContext`**, each computing its `cwd` from `this.basePath` (or the worktree path under it) and its child-process environment from `this.commandEnv()`. The implementation uses only Node built-ins (`child_process`/`fs`/`path`) plus an **optional injected logger**, so the package stays ADW-global-free and importable (PRD stories 19/20).
2. Introduce a thin **ADW-side boundary factory** (`gitContextFor`) that assembles a complete `GitContext` identity from the `owner`/`repo`/`selfHost` already known at each launch boundary, sourcing the auth token and git identity from the existing auth machinery and injecting `REPO_ROOT` / `TARGET_REPOS_DIR`. This is the one place that builds a context; it routes through `GitContext`'s single constructor, never ambient `cwd`.
3. **Route every worktree call site** through a context obtained from that factory (passing `selfHost` explicitly).
4. **Delete** the optional, defaulting base-path helpers (`getWorktreesDir(baseRepoPath?)`, `getWorktreePath(branchName, baseRepoPath?)`, the `createWorktree*`/`getWorktreeForBranch` optional-`baseRepoPath` chain, and the free worktree functions superseded by context methods) and every cwd-defaulting worktree-path computation, so the previously-reachable wrong path no longer exists.

The value: it makes the PRD's headline failure — "the cron's takeover path computed the worktree under the wrong base, stranding a real production issue" — structurally **unrepresentable** for worktrees. After this slice, you cannot compute a worktree path without an explicit repo identity.

## User Story

As an **ADW operator and maintainer**
I want **every worktree operation (create, remove, reset, list, path lookup) to go through a `GitContext` whose base path is resolved once from an explicit repo identity**
So that **worktrees for target repos always resolve under the target workspace — never silently under the framework cwd — and a new call site cannot reintroduce the wrong-repo worktree class of bug** (PRD stories 1 and 16).

## Problem Statement

Worktree resolution is still derived ad hoc at each call site through `vcs/worktreeOperations.ts`'s `getWorktreePath(branchName, baseRepoPath?)` / `getWorktreesDir(baseRepoPath?)`, where `baseRepoPath` is **optional** and silently defaults — via `getMainRepoPath()` — to the ambient repo discovered from the current process. Because ADW dogfoods itself, that default is *correct* in the most-exercised self-host path and only detonates against target repos, so the bug ships and fails in production. Two reachable wrong paths exist right now:

- `adws/triggers/takeoverHandler.ts:136,153` calls the injected `getWorktreePath(state.branchName)` with **no base path** — the cron/takeover process resolves the target repo's worktree under the framework cwd. This is the exact defect the PRD cites as live confirmation of the model.
- `adws/phases/workflowInit.ts:237,244` calls `getWorktreeForBranch(branchName)` (no base) and `ensureWorktree(branchName, defaultBranch, process.cwd())` (explicit cwd default) in the self-host branch.

#658 shipped a `GitContext` that resolves the base path correctly in exactly one constructor, but nothing constructs it yet and no worktree operation is a method on it, so the unsafe helpers remain the only way to do worktree work. The optional-defaulting parameter must become *unreachable*, not merely discouraged.

## Solution Statement

Make the worktree operations methods on `GitContext` and route all callers through a context built at their boundary from explicit identity:

- **Package layer (`adws/gitContext/`)** — `GitContext` gains the worktree-operation methods. Their bodies live in a new internal module `adws/gitContext/worktreeOps.ts` (pure functions over `(basePath, env, log)` using only Node built-ins), keeping `gitContext.ts` under the 300-line guideline and the package free of ADW globals. A new optional `logger` field on `GitContextOptions` lets ADW callers inject `log` without the package depending on `adws/core`.
- **Boundary factory (`adws/github/gitContextFactory.ts`)** — `gitContextFor({ owner, repo, selfHost })` sources the token (GitHub-App installation token via `getInstallationToken(owner, repo)` when configured, else `process.env.GH_TOKEN`, else `gh auth token`) and git identity (from the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars `configureGitIdentity()` already sets, else the App bot identity, else `git config`, else safe defaults), injects `REPO_ROOT` and `TARGET_REPOS_DIR`, and returns a `GitContext`. It lives in `adws/github/` (not `adws/core/`) because it needs `githubAppAuth` and `core/environment`, and `core` cannot import `github` without a cycle.
- **Call-site migration** — each site passes the `owner`/`repo`/`selfHost` it already holds (`selfHost = !targetRepo`) to `gitContextFor`, then calls `ctx.<method>()`. `initializeWorkflow` builds the context once and also stores it on `WorkflowConfig` for reuse by later phases (and by the future branch/commit slice).
- **Deletion** — once every caller routes through the context, delete `getWorktreesDir`, `getWorktreePath`, the optional-`baseRepoPath` free worktree functions, `worktreeExists`/`copyEnvToWorktree`/`isBranchCheckedOutElsewhere`/`freeBranchFromMainRepo` (now context-internal), and `worktreeReset.ts`/`worktreeCreation.ts`/`worktreeCleanup.ts`/`worktreeQuery.ts`'s public surface, and the `process.cwd()` / no-base worktree-path computations. `getMainRepoPath` (explicit-cwd reverse lookup used by `claudeAgent.ts`) and `killProcessesInDirectory` (the dev-server janitor's process-kill dependency) survive — neither is a base-path defaulter.

The design decision that keeps this slice independently shippable on top of only #658: contexts are constructed at the **nearest boundary that already holds an explicit identity**, never re-derived from ambient `cwd`. Base-path resolution still lives only in `GitContext`'s constructor (story 6). The PRD's ideal of "construct exactly once per process and thread everywhere" (stories 9/10/12) remains a later slice; this slice introduces the factory and the first construction sites that those slices will consolidate.

## Relevant Files

Use these files to implement the feature:

### Package — extend (the operation surface lands here)
- `adws/gitContext/gitContext.ts` — Add worktree methods that delegate to `worktreeOps.ts`, passing `this.basePath`, `this.commandEnv()`, and the injected logger. Keep the file thin and under 300 lines.
- `adws/gitContext/types.ts` — Add a `GitContextLogger` type and an optional `logger` field on `GitContextOptions`. Add `WorktreeForIssueResult` (relocated from `vcs/worktreeQuery.ts`).
- `adws/gitContext/index.ts` — Barrel; export the new public type(s). Must still export **no** context-free git/`gh` free functions.
- `adws/gitContext/__tests__/gitContext.test.ts` — Existing #658 tests; extend or add a sibling test file for the new methods.

### Package — new files
- `adws/gitContext/worktreeOps.ts` — Internal (non-exported-from-barrel) worktree git logic as pure functions over `(basePath | worktreePath, env, log)`: create/createForNewBranch/ensure/getForBranch/remove/removeForIssue/list/findForIssue/exists/copyEnv/reset, plus the private helpers (`isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`, the lsof process-kill step, and the small `getDefaultBranch`/`deleteLocalBranch` git calls these need). **Node built-ins only** — no `import` from `adws/*`.
- `adws/gitContext/__tests__/gitContextWorktree.test.ts` — Behaviour tests mirroring `vcs/__tests__/worktreeReset.test.ts` (mock `child_process`/`fs`, assert command sequence + `cwd`/base correctness) for the worktree methods, including `resetWorktree`.

### ADW glue — new file
- `adws/github/gitContextFactory.ts` — `gitContextFor({ owner, repo, selfHost })`. Sources token + git identity (reusing `githubAppAuth`), injects `REPO_ROOT`/`TARGET_REPOS_DIR`, returns a `GitContext`.

### Reference (read for identity/auth/base-path conventions; mostly unmodified)
- `specs/prd/git-context-repo-authority.md` — Parent PRD; **Operation surface** and **Removal of the unsafe primitives** sections are the contract.
- `specs/issue-658-adw-oqb76h-gitcontext-package-m-sdlc_planner-gitcontext-base-path-authority.md` — The blocker's plan; documents what shipped, the package-purity constraint, and what was explicitly deferred to this slice.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — #658's feature doc: invariants, gotchas, and the explicit "Existing call sites are not yet migrated … Migration is a separate slice" note.
- `adws/core/environment.ts` — `REPO_ROOT`, `TARGET_REPOS_DIR` (factory injects these); `SAFE_ENV_VARS` / `getSafeSubprocessEnv()` show the env var names `commandEnv()` already overlays.
- `adws/github/githubAppAuth.ts` — `getInstallationToken`, `isGitHubAppConfigured`, `activateGitHubAppAuth`, `configureGitIdentity` (the env-var names + bot-identity model the factory sources from).
- `adws/core/targetRepoManager.ts` — `getTargetRepoWorkspacePath(owner, repo) = join(TARGET_REPOS_DIR, owner, repo)`; identical to `GitContext`'s target base, so replacing `cwd = getTargetRepoWorkspacePath(...)` with `ctx.basePath` is behaviour-preserving.

### Worktree implementation to relocate then delete
- `adws/vcs/worktreeOperations.ts` — Delete `getWorktreesDir`, `getWorktreePath`, `worktreeExists`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`, `BranchCheckoutStatus`. **Keep** `getMainRepoPath` (explicit-cwd reverse lookup, still used by `claudeAgent.ts`).
- `adws/vcs/worktreeCreation.ts` — Logic moves into the package; delete the module.
- `adws/vcs/worktreeCleanup.ts` — `removeWorktree`/`removeWorktreesForIssue` move into the package; **keep `killProcessesInDirectory`** (relocate to a small standalone util, e.g. `vcs/worktreeProcessKill.ts`, for the janitor dep) — it is not a base-path computation.
- `adws/vcs/worktreeQuery.ts` — `listWorktrees`/`findWorktreeForIssue` move into the package; delete the module (relocate `WorktreeForIssueResult` to the package types).
- `adws/vcs/worktreeReset.ts` — `resetWorktreeToRemote` logic moves into `worktreeOps.ts` as `ctx.resetWorktree(branch)`; delete the module.
- `adws/vcs/index.ts` — Update barrel: drop deleted exports; keep `getMainRepoPath`, `killProcessesInDirectory`, branch/commit exports.

### Call sites to migrate (route through the context)
- `adws/phases/workflowInit.ts` — Build the context once (`selfHost = !targetRepo`; owner/repo from `repoInfo`/`getRepoInfo()`); replace `ensureWorktree(..., targetRepoWorkspacePath)`, `ensureWorktree(..., process.cwd())`, `getWorktreeForBranch(branchName)`, `findWorktreeForIssue(...)`, `copyEnvToWorktree(...)` with `ctx.*`; add `gitContext` to `WorkflowConfig`.
- `adws/triggers/takeoverHandler.ts` — Replace the `getWorktreePath` + `resetWorktree` deps with context-backed equivalents built from `input.repoInfo` (+ self-host detection). **Fixes the wrong-base bug** at `recoverViaResetFromRemote` / `recoverViaResumeInPlaceOrReset`. Preserve the `TakeoverDeps` injection seam for unit tests.
- `adws/adwMerge.tsx` — `MergeDeps.ensureWorktree` becomes context-backed (`selfHost = !targetRepo`; `baseRepoPath` derivation at `adwMerge.tsx:273` removed).
- `adws/adwUpgrade.tsx` — `UpgradeDeps.ensureWorktree` becomes context-backed (`baseRepoPath` at `adwUpgrade.tsx:422` removed).
- `adws/phases/prReviewPhase.ts` — `ensureWorktree(headBranch, undefined, targetRepoWorkspacePath)` → `ctx.ensureWorktree(headBranch)`; removes the `process.cwd()` self-host default at `prReviewPhase.ts:93`.
- `adws/adwPromotionSweep.tsx` + `adws/promotion/promotionMover.ts` — `createWorktreeForNewBranch(branchName, baseBranch, baseRepoPath)` → `ctx.createWorktreeForNewBranch(branchName, baseBranch)` via the injected dep.
- `adws/triggers/webhookHandlers.ts` — `removeWorktreesForIssue(issueNumber, cwd)` → context-backed (per-event context from `repoInfo`).
- `adws/triggers/cancelHandler.ts` — `removeWorktreesForIssue(issueNumber, cwd)` → context-backed.
- `adws/triggers/devServerJanitor.ts` — `listWorktrees(repoPath)` → `ctx.listWorktrees()` per `{owner, repo}` discovered from the `TARGET_REPOS_DIR` walk; keep injecting `killProcessesInDirectory`.
- `adws/agents/claudeAgent.ts` — **No functional change**; it keeps `getMainRepoPath(cwd)` for `ADW_MAIN_REPO_PATH`. Listed so the implementer confirms the surviving import still resolves after the barrel edit.

### Conditional docs (matched conditions in `.adw/conditional_docs.md`)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — "migrating existing call sites away from `getWorktreePath(branch, baseRepoPath?)` optional-default to `GitContext`"; "`worktreePathFor`, `commandEnv` … of `GitContext`"; the wrong-repo class (#23/#33/#52/#56/#62/#119/#217/#223/#187).
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — **Owns `adws/vcs/**`** and `worktreeSetup.ts`; conditions cover `ensureWorktree`/`createWorktree`/`createWorktreeForNewBranch`, `removeWorktree`/`removeWorktreesForIssue`/`killProcessesInDirectory`, and command-sequence tests in `adws/vcs/__tests__/`.
- `app_docs/feature-eantbn-orchestrator-resilie-worktree-reset-module.md` — `worktreeReset.ts` / `resetWorktreeToRemote`, takeover reset, linked-worktree git-dir indirection, and the `worktreeReset.test.ts` mocking pattern to follow.
- `app_docs/feature-i4m1uk-orchestrator-resilie-takeover-handler-integration.md` — `evaluateCandidate`/`CandidateDecision`/`TakeoverDeps`/`buildDefaultTakeoverDeps`; the `take_over_adwId` + `worktreeReset → remoteReconcile` sequence.
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — **Owns `adws/phases/workflowInit.ts`** and `adws/vcs/index.ts`; branch-name resolution call sites I touch.
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — `copyEnvToWorktree`/`ensureWorktree` in target-repo workflows; `targetRepoManager.ts`.
- `app_docs/feature-ie8l08-fix-pr-review-target-repo.md` — `ensureWorktree` called without `baseRepoPath` in the PR-review path; `initializePRReviewWorkflow`.
- `app_docs/feature-f704s2-dev-server-janitor-cron.md` — `devServerJanitor.ts`, `listWorktrees`, `JanitorDeps`, `shouldCleanWorktree`.
- `app_docs/feature-qr9z6g-fix-worktree-path-rewriting.md` — `claudeAgent.ts` spawn env / `ADW_MAIN_REPO_PATH` / `getSafeSubprocessEnv` (confirms `getMainRepoPath` must survive).
- `app_docs/feature-hk12ct-kpi-commits-land-on-default-branch.md` — command-sequence correctness test pattern in `adws/vcs/__tests__/`.

## Implementation Plan

### Phase 1: Foundation — operation surface + boundary factory
Add the worktree operations to `GitContext` (bodies in `worktreeOps.ts`, Node built-ins only, optional injected logger) and build the `gitContextFor` factory so a correctly-scoped context can be obtained at any boundary. No call sites change yet; the package and factory are independently unit-tested. The optional-defaulting helpers still exist (callers not yet migrated), so the build stays green throughout.

### Phase 2: Core Implementation — migrate every call site
Route each worktree caller through a context obtained from `gitContextFor` (passing explicit `owner`/`repo`/`selfHost`), preserving each module's dependency-injection seam (`TakeoverDeps`, `MergeDeps`, `UpgradeDeps`, `JanitorDeps`, `IssueClosedDeps`, promotion deps) so existing unit tests keep their mocking points. Update each module's tests to assert the context method is invoked with the correct base. Special attention to the two wrong-path sites (`takeoverHandler`, `workflowInit`) — they must resolve under the target workspace.

### Phase 3: Integration — delete the unsafe primitives
With every caller migrated, delete `getWorktreesDir`, `getWorktreePath`, the free `createWorktree*`/`getWorktreeForBranch`/`ensureWorktree`/`removeWorktree*`/`listWorktrees`/`findWorktreeForIssue`/`worktreeExists`/`copyEnvToWorktree`/`isBranchCheckedOutElsewhere`/`freeBranchFromMainRepo` functions and the modules that held only them, relocate the two survivors (`getMainRepoPath`, `killProcessesInDirectory`), update the `vcs/index.ts` barrel, and confirm `grep` finds no remaining optional-base-path caller and no `process.cwd()`-defaulting worktree-path computation. Run the full validation suite for zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Extend the GitContext public types (`adws/gitContext/types.ts`)
- Add `export type GitContextLogger = (message: string, level?: 'info' | 'success' | 'warn' | 'error') => void;` and an optional `logger?: GitContextLogger` field on `GitContextOptions` (JSDoc: injected so the package depends on no ADW globals; defaults to a no-op).
- Relocate `export interface WorktreeForIssueResult { worktreePath: string; branchName: string }` from `vcs/worktreeQuery.ts` into this file.
- Do **not** add any I/O types; keep the surface minimal (it was HITL-reviewed in #658 — additions only, no breaking changes to existing fields/signatures).

### 2. Implement the internal worktree logic (`adws/gitContext/worktreeOps.ts`)
- New file. Import **only** Node built-ins (`child_process`, `fs`, `path`). No `adws/*` imports.
- Port the bodies of `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `removeWorktree`, `removeWorktreesForIssue`, `listWorktrees`, `findWorktreeForIssue`, `worktreeExists`, `copyEnvToWorktree`, and `resetWorktreeToRemote` from the `vcs/worktree*` modules, rewritten as pure functions that take an explicit `basePath` (and/or precomputed `worktreePath`), a `NodeJS.ProcessEnv` (the context's `commandEnv()`), and a `GitContextLogger`. Every `execSync` passes `{ cwd: basePath | worktreePath, env }`.
- Port the private helpers they depend on: `sanitizeBranchName` (already in the package — reuse it), `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`, the lsof-based process-kill step (for `removeWorktree*`), and the minimal `getDefaultBranch` / `deleteLocalBranch` git calls (temporary private copies; the public branch-operation methods are PRD story 17 / a later slice). Apply guard clauses and keep functions single-purpose per the coding guidelines; extract loop bodies (e.g. per-worktree removal in `removeWorktreesForIssue`) into named helpers.
- Compute worktree paths as `path.join(basePath, '.worktrees', sanitizeBranchName(branch))` — identical layout to today, so existing on-disk worktrees remain discoverable.

### 3. Add the worktree methods to `GitContext` (`adws/gitContext/gitContext.ts`)
- Store the optional logger as a private field `#log: GitContextLogger` (default `() => {}`).
- Add public methods that delegate to `worktreeOps.ts`, supplying `this.basePath`, `this.commandEnv()`, and `this.#log`:
  - `createWorktree(branch, baseBranch?)`, `createWorktreeForNewBranch(branch, baseBranch?)`, `ensureWorktree(branch, baseBranch?)`, `getWorktreeForBranch(branch)`, `removeWorktree(branch)`, `removeWorktreesForIssue(issueNumber)`, `listWorktrees()`, `findWorktreeForIssue(issueType, issueNumber)`, `worktreeExists(branch)`, `copyEnvToWorktree(worktreePath)`, `resetWorktree(branch)`.
  - `resetWorktree(branch)` resolves `this.worktreePathFor(branch)` and runs the abort-merge / abort-rebase / fetch / `reset --hard` / `clean -fdx` sequence (preserving linked-worktree git-dir indirection), behaviourally identical to `resetWorktreeToRemote`.
- If `gitContext.ts` approaches 300 lines, keep only the thin delegations here (logic stays in `worktreeOps.ts`).
- Note in the class JSDoc that branch/commit/issue/PR methods remain later slices.

### 4. Write package behaviour tests (`adws/gitContext/__tests__/gitContextWorktree.test.ts`)
- Mirror `vcs/__tests__/worktreeReset.test.ts`: `vi.mock('child_process')`, `vi.mock('fs')`, deterministic command-sequence assertions, and explicit `toThrow(/.../)` cases for mandatory-step failures.
- Construct a `GitContext` with a known target identity (so `basePath = join(TARGET_REPOS_DIR, owner, repo)`), then assert each method runs git with `cwd` under that base and the expected command order:
  - `resetWorktree`: clean/idempotent, dirty tracked, in-progress merge (plumbing + fallback), in-progress rebase (plumbing + fallback), both markers (merge before rebase), relative vs absolute git-dir, mandatory-step throws — the full set the original test covered, but driven through `ctx.resetWorktree('main')`.
  - `ensureWorktree` / `createWorktree`: reuse-existing path, orphaned-dir reuse, branch-checked-out-in-main (free first), branch-checked-out-in-other-worktree (reuse), new-branch-from-`origin/<base>`.
  - `removeWorktreesForIssue`: matches by `-issue-{N}-`, prunes, returns count.
  - **Base correctness:** a self-host context and a target context resolve distinct worktree paths for the same branch (the property the wrong-base bug violated).

### 5. Build the boundary factory (`adws/github/gitContextFactory.ts`)
- New file. `export function gitContextFor(identity: { owner: string; repo: string; selfHost: boolean }): GitContext`.
- Source the token: `isGitHubAppConfigured()` → `getInstallationToken(owner, repo)`; else `process.env.GH_TOKEN`; else best-effort `gh auth token` (trim); the result must be non-empty (GitContext requires it). For pure-local worktree ops the token is unused by git, but the constructor mandates one — document this.
- Source `gitIdentity`: prefer `process.env.GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL` (set by `configureGitIdentity()`); else derive the App bot identity from `GITHUB_APP_ID`/`GITHUB_APP_SLUG`; else `git config user.name`/`user.email`; else a safe ADW default. All four fields must be non-empty.
- Inject `frameworkRepoRoot: REPO_ROOT`, `targetReposDir: TARGET_REPOS_DIR`, and `logger: log`.
- Return `new GitContext({ owner, repo, selfHost, token, gitIdentity, frameworkRepoRoot, targetReposDir, logger })`.
- Add focused unit tests (`adws/github/__tests__/gitContextFactory.test.ts`): given an identity, the returned context resolves the expected base path; missing-token/identity sourcing falls back as specified.

### 6. Migrate `workflowInit.ts`
- In the worktree-setup block, build `const gitContext = gitContextFor({ owner, repo, selfHost: !targetRepo })` (owner/repo from `repoInfo ?? getRepoInfo()`).
- Replace: `ensureWorktree(branchName, defaultBranch, targetRepoWorkspacePath)` and `ensureWorktree(branchName, defaultBranch, process.cwd())` → `gitContext.ensureWorktree(branchName, defaultBranch)`; `getWorktreeForBranch(branchName)` → `gitContext.getWorktreeForBranch(branchName)`; `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)` → `gitContext.findWorktreeForIssue(issueType, issueNumber)`; both `copyEnvToWorktree(..., targetRepoWorkspacePath)` → `gitContext.copyEnvToWorktree(...)`.
- Add `gitContext: GitContext` to `WorkflowConfig` and return it (forward-looking reuse; no other phase is required to consume it this slice).
- Remove the now-unused `ensureWorktree`/`getWorktreeForBranch`/`findWorktreeForIssue`/`copyEnvToWorktree` imports from `../vcs`.

### 7. Migrate `takeoverHandler.ts` (fixes the wrong-base bug)
- Replace the `getWorktreePath` and `resetWorktree` deps with context-backed resolution built from `input.repoInfo`. Recommended: add a `gitContextFor: (repoInfo: RepoInfo) => GitContext` dep (default impl builds a context with `selfHost` derived by comparing `repoInfo` to the framework repo, e.g. `getRepoInfo()`), and in `recoverViaResetFromRemote` / `recoverViaResumeInPlaceOrReset` compute `wtPath = ctx.worktreePathFor(state.branchName)` and call `ctx.resetWorktree(state.branchName)`.
- Keep `probeWorktree`/`clearOrphanedIndexLock` deps as-is (they already take an explicit path; now a correct one).
- Preserve the `TakeoverDeps` seam so the existing decision-tree unit tests still inject fakes; update tests so the worktree path asserts under the target base, not the framework cwd.

### 8. Migrate the remaining orchestrators and phases
- `adwMerge.tsx`: build the context (`selfHost = !targetRepo`) and make `MergeDeps.ensureWorktree` call `ctx.ensureWorktree(branchName, baseBranch)`; delete the `baseRepoPath` derivation at line 273.
- `adwUpgrade.tsx`: same pattern; `UpgradeDeps.ensureWorktree` → `ctx.ensureWorktree(branch, defaultBranch)`; delete the `baseRepoPath` at line 422.
- `prReviewPhase.ts`: build the context (`selfHost = !targetRepo`); `ensureWorktree(headBranch, undefined, targetRepoWorkspacePath)` → `ctx.ensureWorktree(headBranch)`; remove the `process.cwd()` self-host default at line 93.
- `adwPromotionSweep.tsx` + `promotionMover.ts`: build the context from `repoInfo` (`selfHost = !targetRepo`); the injected `createWorktree` dep calls `ctx.createWorktreeForNewBranch(branchName, baseBranch)`.

### 9. Migrate the trigger handlers
- `webhookHandlers.ts`: in `handleIssueClosedEvent`/`IssueClosedDeps`, build a per-event context from `repoInfo` and replace `removeWorktreesForIssue(issueNumber, cwd)` with `ctx.removeWorktreesForIssue(issueNumber)`; the `cwd` parameter for worktree removal is superseded by the context base.
- `cancelHandler.ts`: build the context from `repoInfo` and call `ctx.removeWorktreesForIssue(issueNumber)`.
- `devServerJanitor.ts`: for each `{owner, repo}` discovered in the `TARGET_REPOS_DIR` walk, build a target context (`selfHost: false`) and call `ctx.listWorktrees()`; keep `killProcessesInDirectory` as an injected dep (now imported from its relocated util).

### 10. Relocate the two survivors and slim the vcs worktree modules
- Move `killProcessesInDirectory` into a small standalone util (e.g. `adws/vcs/worktreeProcessKill.ts`) and update `devServerJanitor.ts` + `vcs/index.ts` imports.
- Keep `getMainRepoPath` in `adws/vcs/worktreeOperations.ts` (or move to a small util) for `claudeAgent.ts`; delete everything else from `worktreeOperations.ts`.

### 11. Delete the unsafe primitives and update the barrel
- Delete `getWorktreesDir`, `getWorktreePath`, `worktreeExists`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo`, `BranchCheckoutStatus` from `worktreeOperations.ts`.
- Delete `adws/vcs/worktreeCreation.ts`, `adws/vcs/worktreeQuery.ts`, and `adws/vcs/worktreeReset.ts`; delete the migrated functions from `worktreeCleanup.ts` (leaving only the relocated process-kill, if you keep it there instead of a new file).
- Update `adws/vcs/index.ts`: remove the deleted worktree exports; keep branch/commit exports, `getMainRepoPath`, `killProcessesInDirectory`, and `deleteLocalBranch`/`deleteRemoteBranch`.
- `grep` the tree to prove no remaining caller references the deleted symbols and that no `getWorktreePath`/`getWorktreesDir`/`process.cwd()`-based worktree-path computation survives.

### 12. Update and add tests for migrated modules
- Update `adws/triggers/__tests__/takeoverHandler.test.ts` and `takeoverHandler.integration.test.ts`, `adws/__tests__/adwMerge.test.ts`, `adws/triggers/__tests__/webhookHandlers.test.ts`, `cancelHandler.test.ts`, `devServerJanitor.test.ts`, `adwUpgrade.test.ts`, and the `workflowInit`/`prReview` suites to the new context-backed seams (inject a fake `GitContext` or `gitContextFor`), asserting the correct base path is used.
- Move/retire `adws/vcs/__tests__/worktreeReset.test.ts` (its coverage now lives in `gitContextWorktree.test.ts`); if any other `vcs/__tests__` worktree tests reference deleted functions, migrate their assertions to the context methods.

### 13. Run the validation commands
- Execute every command in `## Validation Commands`; confirm all pass with zero regressions (lint clean, both tsconfigs type-check, full `vitest run` green, build succeeds).

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, and the issue's AC5 requires "Existing worktree behaviour tests (mirroring `vcs/__tests__/worktreeReset.test.ts`) pass against the context methods." Tests live under `adws/**/__tests__/**/*.test.ts` (auto-discovered by `vitest.config.ts`) and assert **external, observable behaviour** per the PRD's Testing Decisions — the `cwd`/base a context runs commands under and the command sequence — not internal call structure.

- **`adws/gitContext/__tests__/gitContextWorktree.test.ts`** (new) — `child_process`/`fs` mocked; command-sequence + base-correctness assertions for `resetWorktree` (full merge/rebase/clean matrix from the original `worktreeReset.test.ts`), `ensureWorktree`/`createWorktree`/`createWorktreeForNewBranch`, `getWorktreeForBranch`, `removeWorktree`/`removeWorktreesForIssue`, `listWorktrees`, `findWorktreeForIssue`, `worktreeExists`, `copyEnvToWorktree`. Includes the headline property: self-host vs target contexts resolve distinct worktree paths for the same branch.
- **`adws/github/__tests__/gitContextFactory.test.ts`** (new) — identity → expected base path; token/identity sourcing fallbacks (App configured vs not).
- **Updated module suites** — takeover (both decision-tree and integration), merge, webhook issue-closed, cancel, janitor, upgrade, workflowInit, prReview: inject a fake context/factory and assert the correct base is used and the right context method is invoked. The takeover test must assert the reset target resolves under the target workspace (regression lock for the wrong-base bug).

### Edge Cases
- Target identity resolves worktrees under `join(TARGET_REPOS_DIR, owner, repo)/.worktrees`; self-host under `REPO_ROOT/.worktrees` — same branch, two different paths.
- Takeover for a target-repo issue resolves and resets the worktree under the **target** workspace, never the framework cwd (the stranded-issue regression).
- `workflowInit` self-host path no longer calls `process.cwd()`; target path no longer threads `targetRepoWorkspacePath`.
- Branch names containing `/ \ : * ? " < > | `` ` ` sanitized to `-` (unchanged layout, on-disk worktrees still found).
- `resetWorktree`: in-progress merge and rebase (plumbing succeeds; plumbing fails → fallback file/dir removal); both markers (merge aborted before rebase); relative vs absolute linked-worktree git-dir; mandatory fetch/reset/clean failures throw and short-circuit.
- `ensureWorktree`: orphaned worktree directory reuse; branch checked out in the main repo (free it first) vs in another worktree (reuse that path).
- `removeWorktreesForIssue`: zero matches (returns 0, no prune error); multiple matches; orphaned-dir fallback removal; `git worktree prune` afterward.
- Factory: GitHub App not configured → token sourced from `process.env.GH_TOKEN`/`gh auth token`, git identity from `git config`/defaults; the context still constructs (non-empty token + identity) and worktree ops (local git) succeed regardless of token validity.
- Incomplete identity passed to the factory/constructor still throws loudly (inherited from #658) — guards against a future caller dropping a field.

## Acceptance Criteria
- Worktree create / remove / reset / list / path-lookup (and ensure / get-for-branch / find-for-issue / exists / copy-env) are methods on `GitContext`, each resolving `cwd` from `this.basePath` (story 16).
- Every worktree call site obtains a context from `gitContextFor` (or a threaded `GitContext`) and calls a context method; **no** caller passes an optional base-path parameter and none computes a worktree path from `process.cwd()` or a no-base default.
- `getWorktreesDir(baseRepoPath?)`, `getWorktreePath(branchName, baseRepoPath?)`, the optional-`baseRepoPath` `createWorktree*`/`getWorktreeForBranch` chain, and the superseded free worktree functions are deleted; `getMainRepoPath` and `killProcessesInDirectory` survive only as non-defaulting utilities.
- Worktrees for target repos resolve under `join(TARGET_REPOS_DIR, owner, repo)/.worktrees`, not the framework cwd — verified for the takeover and `workflowInit` paths (story 1).
- The `adws/gitContext/` package still imports nothing from `adws/core`/`adws/providers`/ADW globals (logger injected); the barrel exports no context-free git/`gh` free function.
- Worktree behaviour tests mirroring `vcs/__tests__/worktreeReset.test.ts` pass against the context methods (AC5).
- All validation commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands sourced from `.adw/commands.md`.

- `bun run lint` — ESLint clean across the new/changed modules (no unused vars after deletions, `prefer-const`, etc.).
- `bunx tsc --noEmit` — Root type-check passes (root `tsconfig.json` includes `**/*.ts`).
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes.
- `bunx vitest run adws/gitContext` — New package worktree + base-path suites pass (fast feedback).
- `bunx vitest run adws/triggers adws/phases adws/github` — Migrated takeover/webhook/cancel/janitor/workflowInit/prReview/factory suites pass.
- `bun run test:unit` — Full `vitest run` is green, including the new and migrated suites and confirming no deleted-symbol references remain.
- `bun run build` — `tsc` build succeeds with no errors.
- `grep -rn "getWorktreePath\|getWorktreesDir" adws --include="*.ts" --include="*.tsx"` — Returns **no** matches outside historical comments (proves the unsafe helpers are gone).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep `gitContext.ts` and `worktreeOps.ts` single-responsibility and under ~300 lines (split delegations vs logic); guard clauses / early throws over nested conditionals; extract per-item loop bodies in `removeWorktreesForIssue`; `readonly` fields and no mutation of `process.env` or passed objects (the package's purity from #658 is preserved); isolate side effects (all git I/O is in `worktreeOps.ts`, invoked by thin methods).
- **No new libraries required.** Only Node built-ins (`child_process`, `fs`, `path`) and existing modules. If one ever becomes necessary, the install command per `.adw/commands.md` is `bun add <package>`.
- **Package purity is the load-bearing constraint.** `adws/gitContext/` must not import `adws/core`/`adws/providers`/any ADW global (stories 19/20). That is why logging is an injected `logger` option, the small `getDefaultBranch`/`deleteLocalBranch` git calls are temporary private copies inside `worktreeOps.ts` (their public forms are PRD story 17 / a later slice), and the ADW-glue factory lives in `adws/github/`, not in the package.
- **Why a factory rather than full threading.** #661 is blocked only by #658 and addresses stories 1 and 16. The PRD's "construct exactly once at the launch boundary and thread everywhere" (stories 9/10/12) is a later slice. `gitContextFor` lets each call site build a correctly-scoped context from the explicit identity it already holds (`owner`/`repo`/`selfHost`) — never ambient `cwd` — so base-path resolution stays in `GitContext`'s single constructor (story 6) and this slice ships independently. `initializeWorkflow` already builds one context and stores it on `WorkflowConfig`, seeding the later threading work.
- **Survivors are intentional.** `getMainRepoPath(cwd)` is a worktree→main-repo reverse lookup with an *explicit* cwd (used by `claudeAgent.ts` to set `ADW_MAIN_REPO_PATH`) — not a base-path defaulter, so it is out of the deletion scope. `killProcessesInDirectory` is the dev-server janitor's process-kill dependency — a generic util with no base-path concern; it is relocated, not deleted. The package re-implements the small lsof-kill step privately for its own `removeWorktree*` methods to avoid importing from `vcs`.
- **Token caveat.** `GitContext` mandates a non-empty token even though local worktree git (create/remove/reset/list) authenticates via SSH/stored credentials, not `GH_TOKEN`. The factory always supplies a real token (App installation token preferred — which also avoids the process-global token bleed the PRD warns about), but correctness of the base path (story 1) does not depend on token validity, which de-risks the migration.
- **DI seams preserved.** Each migrated module keeps its existing dependency-injection point (`TakeoverDeps`, `MergeDeps`, `UpgradeDeps`, `JanitorDeps`, `IssueClosedDeps`, promotion deps); the default implementation now routes through the context. This keeps the large existing unit-test suites valid with minimal churn.
- **Out of scope (later slices):** branch and commit/push operations as context methods (PRD story 17), issue/PR/comment/board operations (story 18), the CI guard banning raw `git`/`gh` (story 8), identity persistence into workflow state + resume cross-check (stories 13/14), and full single-construction boundary threading (stories 9/10/12).
```