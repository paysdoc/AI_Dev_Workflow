# Feature: GitContext — migrate VCS probe/branch leftovers

## Metadata
issueNumber: `693`
adwId: `dojemb-gitcontext-migrate-v`
issueJson: `{"number":693,"title":"GitContext: migrate VCS probe/branch leftovers","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\nAdd worktree/branch probe methods (`git rev-parse`, `symbolic-ref`, `worktree list`, `branch -D`, `status --porcelain`) and migrate the residual VCS sites, removing their ALLOWLIST entries.\n\n## Acceptance criteria\n- [ ] Probe/branch methods on GitContext\n- [ ] worktreeProbe, worktreeOperations, branchOperations, branchIdentityFallback, orchestratorLib route through GitContext\n- [ ] Those files removed from `ALLOWLIST`\n- [ ] `lint:git-guard` passes; tests green\n\n## Blocked by\n- Blocked by #692\n\n## Touched Files\n- adws/gitContext/gitContext.ts\n- adws/vcs/worktreeProbe.ts\n- adws/vcs/worktreeOperations.ts\n- adws/vcs/branchOperations.ts\n- adws/phases/branchIdentityFallback.ts\n- adws/core/orchestratorLib.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 16\n- User story 17","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-23T11:45:26Z","comments":[],"actionableComment":null}`

## Feature Description
This is a slice of the **GitContext repo-context authority** epic (`specs/prd/git-context-repo-authority.md`). The epic drives the `git`/`gh` CLI guard ALLOWLIST toward zero: every direct `git`/`gh` shell-out must route through the `GitContext` deep module so that each command carries its own per-command auth + git identity in the child environment (no process-global `GH_TOKEN` mutation) and an explicit `cwd` (no ambient-cwd fallback). This is the mechanism that forecloses the ~13-episode "wrong-base-repo / could not resolve to a Repository" defect class the PRD mined.

Earlier slices established the machinery this one consumes:
- **#658/#659** shipped the `GitContext` deep module: mandatory identity, the one-constructor base-path decision, the `commandEnv()` per-command env overlay, and the private `#run` spawn chokepoint (cwd = base path or an explicit override, child env carries token + git author/committer, parent global untouched).
- **#661/#662** migrated the worktree-management and branch/commit write ops onto `GitContext` methods (`createWorktree`, `ensureWorktree`, `listWorktrees`, `findWorktreeForIssue`, `deleteLocalBranch`, `commitChanges`, `pushBranch`, `hasUncommittedChanges`, …).
- **#691/#692** migrated the residual `gh`-read and identity-read consumers, added `listOpenIssues`, `remoteUrl(cwd?)`, and the `readLocalRepoInfo` bootstrap helper to `gitContextFactory.ts`, and proved the de-allowlisting pattern (remove a file from `ALLOWLIST`; the guard then scans it and finds it clean).

**This slice (#693)** migrates the last **VCS probe / branch-enumeration leftovers** — the local-git read shapes the worktree-reuse probe, the main-repo-path lookup, the default-branch read, the branch-identity fallback, and the orchestrator dirty-tree check still shell out to raw `git`/`gh`. It adds the missing probe/enumeration read methods to `GitContext`, routes the five residual files through them (directly or through thin factory-backed adapters), and removes those five files from the guard `ALLOWLIST`. Behaviour is unchanged; only token/cwd **application** (per-command vs ambient) and guard **coverage** change.

## User Story
As an ADW maintainer
I want the worktree-probe, main-repo-path, default-branch, branch-identity-fallback, and dirty-tree reads to route through `GitContext` instead of raw `git`/`gh` shell-outs
So that every git/gh read binds its auth + working directory to the command (no process-global bleed, no ambient-cwd fallback), and the CI guard re-arms over those five files so any future raw read in them is a build failure rather than a silent regression.

## Problem Statement
Five files still shell out to raw `git`/`gh` and therefore sit on the guard `ALLOWLIST` (in `adws/checkGitGhGuard.ts`):

| File | Raw call(s) | Used by |
| --- | --- | --- |
| `adws/vcs/worktreeProbe.ts` | `git rev-parse --git-dir`, `git symbolic-ref --short HEAD`, `git worktree list --porcelain` (in `buildDefaultProbeDeps`) | takeover worktree-reuse probe (`takeoverHandler.ts`) |
| `adws/vcs/worktreeOperations.ts` | `git worktree list --porcelain` (in `getMainRepoPath`) | agent subprocess env injection (`claudeAgent.ts`) |
| `adws/vcs/branchOperations.ts` | `gh repo view … defaultBranchRef` (`getDefaultBranch`), `git branch -D` (`deleteLocalBranch`) | `getDefaultBranch` → `upgradeClaim.ts`; `deleteLocalBranch` → **dead code** (not exported, no callers) |
| `adws/phases/branchIdentityFallback.ts` | `git worktree list --porcelain`, `git branch --list` (in `defaultListCandidateBranches`) | branch-name resolution + workflow init (`branchNameResolution.ts`, `workflowInit.ts`) |
| `adws/core/orchestratorLib.ts` | `git status --porcelain` (in `hasUncommittedChanges`) | PR phase + workflow init safety nets (`prPhase.ts`, `workflowInit.ts`) |

While any of these sits on the ALLOWLIST: (a) its read authenticates/resolves against whatever last wrote the process-global `GH_TOKEN` or inherited the ambient cwd, and (b) the guard cannot catch a NEW raw `git`/`gh` call sneaking in beside it. An identity/probe read is a bad place for either failure mode.

## Solution Statement
1. **Add the missing read methods to `GitContext`**, each a thin method delegating to a package-private op module through the existing `#run` chokepoint (the established thin-method + package-private-op pattern):
   - `resolveGitDir(worktreePath)` → `git rev-parse --git-dir` (absolutized; `null` on failure)
   - `currentBranchSymbolic(worktreePath)` → `git symbolic-ref --short HEAD` (`null` on detached HEAD / failure)
   - `worktreeRegistration(worktreePath)` → parse `git worktree list --porcelain` → `'healthy' | 'locked' | 'prunable' | 'missing'`
   - `worktreeBranches(cwd?)` → branch names from `git worktree list --porcelain` (`[]` on failure)
   - `localBranches(cwd?)` → `git branch --list` parsed (`[]` on failure)
   - `mainRepoPath(cwd?)` → first `git worktree list --porcelain` entry NOT under `.worktrees` (throws if none — preserves current behaviour)
   - **Reuse (no new method):** `git branch -D` is already `GitContext.deleteLocalBranch`, and `git status --porcelain` is already `GitContext.hasUncommittedChanges` — the AC's parenthetical just enumerates the command shapes; these two already exist.
2. **Route the five residual files through `GitContext`:**
   - `worktreeProbe.ts`: `buildDefaultProbeDeps(ctx: GitContext)` wires its three git deps to the new context methods; `takeoverHandler.ts` (the only caller) supplies a context (mirroring its existing `resetWorktree` lazy-construct-with-guard idiom).
   - `worktreeOperations.ts`: `getMainRepoPath(cwd)` becomes a thin adapter → `gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd)`.
   - `branchOperations.ts`: `getDefaultBranch(cwd?)` becomes a thin adapter → `gitContextForRepo(readLocalRepoInfo(cwd)).defaultBranch()`; delete the dead `deleteLocalBranch`.
   - `branchIdentityFallback.ts`: `defaultListCandidateBranches(cwd?)` routes through `gitContextForRepo(readLocalRepoInfo(cwd))` calling `worktreeBranches(cwd)` + `localBranches(cwd)`.
   - `orchestratorLib.ts`: `hasUncommittedChanges(cwd?)` becomes a thin adapter → `gitContextForRepo(readLocalRepoInfo(cwd)).hasUncommittedChanges(cwd)`.
3. **Remove the five files from `ALLOWLIST`** in `adws/checkGitGhGuard.ts`.
4. **Prove it** with the per-issue BDD feature (recording-runner `#run` proof for the new methods + guard-clean/whole-repo-guard assertions) and targeted unit tests, then run the validation suite including `lint:git-guard`.

The "thin factory-backed adapter" approach (used by `getMainRepoPath`, `getDefaultBranch`, `hasUncommittedChanges`, `defaultListCandidateBranches`) keeps the public function surface and all of their callers **unchanged**, minimising blast radius — exactly the precedent #692 set with `githubApi.getAuthenticatedUser` (`gitContextForRepo(getRepoInfo()).authenticatedUser()`). The exact threading of a context into each consumer is explicitly an implementer's choice per the sibling slices' "pin the decision, not the shape" stance.

## Relevant Files
Use these files to implement the feature:

- `adws/gitContext/gitContext.ts` — The `GitContext` class. Add the six new thin read methods here, each delegating to a package-private op via `(cmd, cwd) => this.#run(cmd, { cwd })` (same shape as the existing `getCurrentBranch`, `listWorktrees`, `hasUncommittedChanges` methods).
- `adws/gitContext/worktreeQueryOps.ts` — Package-private worktree-query orchestration (`listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`). Extend with `mainRepoPath` and `worktreeBranches` (worktree-enumeration concerns; same `Runner` seam, same try/catch → `[]`/throw idiom).
- `adws/gitContext/branchOps.ts` — Package-private branch orchestration (`getCurrentBranch`, `deleteLocalBranch`, …). Extend with `localBranches` (branch-enumeration concern).
- `adws/gitContext/types.ts` — `ExecFn`, `GitContextDeps`, `FsDeps`. No change expected, but reference for the injectable-runner seam used by tests.
- `adws/vcs/worktreeProbe.ts` — `ProbeInput`, `ProbeDeps`, `probeWorktree`, `clearOrphanedIndexLock`, `buildDefaultProbeDeps`. Change `buildDefaultProbeDeps` to take a `GitContext` and wire its three git deps to the new methods; remove the `child_process` import. The pure probe logic (`detectInterruptedOp`, `resolveOwnerLiveness`, `missingProbe`, the signal assembly) is unchanged.
- `adws/triggers/takeoverHandler.ts` — **Caller adaptation (necessary collateral, not a guard change).** `buildDefaultTakeoverDeps(repoInfo)` builds the `probeWorktree`/`clearOrphanedIndexLock` closures; update them to construct a `GitContext` from `repoInfo` and pass `buildDefaultProbeDeps(ctx)` into the probe calls, mirroring the existing `resetWorktree` closure (`gitContextForSync({ owner, repo, selfHost: false })` with a `repoInfo`-required guard). Has no raw `git`/`gh` and is not allowlisted, so this is pure rewiring.
- `adws/vcs/worktreeOperations.ts` — `getMainRepoPath(cwd)`. Replace its `execSync` body with a thin adapter through `gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd)`; remove the `child_process` import. Public export and `vcs/index.ts` re-export unchanged; `claudeAgent.ts` caller unchanged.
- `adws/vcs/branchOperations.ts` — Make `getDefaultBranch(cwd?)` a thin adapter through `gitContextForRepo(readLocalRepoInfo(cwd)).defaultBranch()`; delete the dead `deleteLocalBranch` (not exported by `vcs/index.ts`, no external callers); remove the `child_process` import. The pure vocabulary (`validateSlug`, `generateBranchName`, `inferIssueTypeFromBranch`, `PROTECTED_BRANCHES`) stays.
- `adws/phases/branchIdentityFallback.ts` — Route `defaultListCandidateBranches(cwd?)` through `gitContextForRepo(readLocalRepoInfo(cwd))` (`worktreeBranches(cwd)` + `localBranches(cwd)`); remove `parseWorktreeBranchNames` and the `child_process` import. Keep the `fs`-based `defaultListAdwIds` (filesystem, not git/gh) and all pure recovery logic (`findExistingBranchForIssue`, `recoverAdwIdForBranch`) unchanged; the `BranchIdentityFallbackDeps` injection seam is unchanged so unit tests keep injecting fakes.
- `adws/core/orchestratorLib.ts` — Make `hasUncommittedChanges(cwd?)` a thin adapter through `gitContextForRepo(readLocalRepoInfo(cwd)).hasUncommittedChanges(cwd)`; remove the `child_process` import. The pure functions (`shouldExecuteStage`, `getNextStage`, `deriveOrchestratorScript`, `orchestratorNamesForScript`) are untouched. Verify no import cycle is introduced (see Notes).
- `adws/github/gitContextFactory.ts` — Source of `gitContextForRepo`, `gitContextForSync`, and `readLocalRepoInfo` (the permanently-allowlisted bootstrap remote read). Read-only reference; the adapters import from here.
- `adws/checkGitGhGuard.ts` — Remove the five residual ALLOWLIST entries (`branchOperations.ts`, `worktreeProbe.ts`, `worktreeOperations.ts`, `orchestratorLib.ts`, `branchIdentityFallback.ts`). Leave the bootstrap, diagnostic, and other-slice residual entries in place.
- `adws/agents/claudeAgent.ts` — Caller of `getMainRepoPath`; reference only. Confirms the adapter must preserve the throw-on-failure contract (the call is wrapped in a non-fatal try/catch).
- `adws/core/upgradeClaim.ts` — Caller of `branchOperations.getDefaultBranch` (via the injectable `getDefaultBranchFn`). Reference only; the adapter keeps the same signature so this file is unchanged (it remains allowlisted as bootstrap).

### Reference docs (conditional)
Per `.adw/conditional_docs.md`, these app-docs match this feature's surface — read before implementing:
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — **primary.** Owns `adws/gitContext/**`, `gitContextFactory.ts`, `branchOperations.ts`, `worktreeOperations.ts`. Documents the thin-method + package-private-op pattern, `readLocalRepoInfo` bootstrap boundary, and the #691/#692 migration pattern ("add a new worktree/op method to GitContext"; "migrate a module off direct execSync onto GitContext methods").
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — **primary.** Owns `adws/checkGitGhGuard.ts` and the CI guard workflow. Documents the ALLOWLIST categories, the de-allowlisting flow ("migrating a residual allowlisted file to GitContext methods and removing it from the ALLOWLIST"), and the `bun run lint:git-guard` remedy.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — worktree-reuse gate (`decideWorktreeReuse`, `worktreeReuseGate.ts`), `probeWorktree`/`worktreeProbe.ts`, and the worktree health signals (index.lock orphaned/live-held, interrupted op, registration healthy/locked/prunable/missing).
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — launch-boundary context construction and the `EvaluateCandidateInput.gitContext` / `WorkflowConfig.gitContext` threading in `takeoverHandler.ts` / `workflowInit.ts` (relevant to the probe-context wiring).
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — owns `branchIdentityFallback.ts`; documents `findExistingBranchForIssue` / `recoverAdwIdForBranch` and the deterministic-branch fallback.

### New Files
- `adws/gitContext/worktreeProbeOps.ts` — **New.** Package-private op module for the worktree-probe reads (`resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`) operating on a supplied worktree `cwd`. Mirrors `worktreeQueryOps.ts`: a `Runner = (command, cwd) => string` seam, internal `path` use for git-dir absolutization, and try/catch → `null`/`'missing'` failure semantics. Exports a `worktreeProbeOps` object and a `WorktreeRegistration` union type. (Kept separate from `worktreeQueryOps.ts` for cohesion and to keep both files well under the 300-line guideline.)
- `features/per-issue/feature-693.feature` — **New.** BDD per-issue feature proving the contract (see Testing Strategy). Tagged `@adw-693` (+ the adwId tag).
- `features/per-issue/step_definitions/feature-693.steps.ts` — **New.** Step definitions adding only the worktree-probe-read dispatcher, reusing the shared `gitContextSharedWorld.ts` recording-runner world and the globally-registered guard / type-check steps (do NOT redefine those).

## Implementation Plan
### Phase 1: Foundation — GitContext read methods
Add the package-private op modules and the six new thin `GitContext` methods, all routed through `#run`. This is the shared substrate every migrated consumer depends on, so it lands first with its own unit coverage (recording-runner assertions on command string, cwd, and child env).

### Phase 2: Core Implementation — migrate the five residual files
With the methods in place, convert each residual file to route through `GitContext`: `worktreeProbe` via context-backed default deps (+ the `takeoverHandler` caller wiring), and `worktreeOperations`/`branchOperations`/`branchIdentityFallback`/`orchestratorLib` via thin factory-backed adapters. Delete the dead `branchOperations.deleteLocalBranch`. Each file ends with zero raw `git`/`gh` call expressions.

### Phase 3: Integration — re-arm the guard and prove it
Remove the five entries from the `ALLOWLIST`, add the BDD feature + steps, update the unit tests broken by signature changes, and run the full validation suite (lint, type-checks, `lint:git-guard`, unit tests, build, and the `@adw-693` scenarios). The whole-repo guard passing is the integration backstop that proves no consumer was de-allowlisted while a raw call still lived in it.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1 — Read the reference docs and confirm the seams
- Read the five conditional app-docs listed under **Relevant Files → Reference docs**, focusing on `feature-oqb76h` (thin-method + package-private-op pattern) and `feature-bq1f45` (ALLOWLIST + de-allowlisting flow).
- Re-read `adws/gitContext/gitContext.ts`, `worktreeQueryOps.ts`, and `branchOps.ts` to match the exact delegation idiom (`(cmd, cwd) => this.#run(cmd, { cwd })`) and the try/catch failure conventions.

### Step 2 — Add `worktreeProbeOps.ts` (new package-private op module)
- Create `adws/gitContext/worktreeProbeOps.ts` exporting a `worktreeProbeOps` object with:
  - `resolveGitDir(run, worktreePath): string | null` — `run('git rev-parse --git-dir', worktreePath)`; absolutize (`path.isAbsolute(raw) ? raw : path.resolve(worktreePath, raw)`); `null` on throw.
  - `currentBranchSymbolic(run, worktreePath): string | null` — `run('git symbolic-ref --short HEAD', worktreePath)`; `null` on throw (detached HEAD).
  - `worktreeRegistration(run, worktreePath): WorktreeRegistration` — `run('git worktree list --porcelain', worktreePath)`, parse to `'healthy' | 'locked' | 'prunable' | 'missing'` using the exact line-walk currently in `worktreeProbe.ts`'s `worktreeRegistration` dep; `'missing'` on throw or path-not-found.
- Export `type WorktreeRegistration = 'healthy' | 'locked' | 'prunable' | 'missing'`.
- Use the `Runner = (command: string, cwd: string) => string` seam (copy from `worktreeQueryOps.ts`); import `path` for absolutization.

### Step 3 — Extend `worktreeQueryOps.ts` with `mainRepoPath` and `worktreeBranches`
- `mainRepoPath(run, cwd): string` — `run('git worktree list --porcelain', cwd)`; return the first `worktree ` entry whose path does NOT include `.worktrees`; **throw** `Error('Could not find main repository in worktree list')` if none (preserves `getMainRepoPath`'s throw-on-failure contract).
- `worktreeBranches(run, cwd): string[]` — `run('git worktree list --porcelain', cwd)`; collect `branch ` lines, strip `refs/heads/`, trim, drop empties; `[]` on throw.
- Add both to the exported `worktreeQueryOps` object.

### Step 4 — Extend `branchOps.ts` with `localBranches`
- `localBranches(run, cwd): string[]` — `run('git branch --list', cwd)`; for each line strip the leading `*`/whitespace marker, trim, drop empties; `[]` on throw. Add to the exported `branchOps` object.

### Step 5 — Add the six thin methods to `GitContext`
- In `adws/gitContext/gitContext.ts`, import `worktreeProbeOps` (and the new `worktreeQueryOps`/`branchOps` members already imported). Add, in the relevant `// ──` sections:
  - `resolveGitDir(worktreePath: string): string | null`
  - `currentBranchSymbolic(worktreePath: string): string | null`
  - `worktreeRegistration(worktreePath: string): WorktreeRegistration`
  - `worktreeBranches(cwd?: string): string[]` (delegates with `cwd ?? this.#basePath`)
  - `localBranches(cwd?: string): string[]` (delegates with `cwd ?? this.#basePath`)
  - `mainRepoPath(cwd?: string): string` (delegates with `cwd ?? this.#basePath`)
- Each method delegates exactly like existing ones, e.g. `return worktreeProbeOps.resolveGitDir((cmd, cwd) => this.#run(cmd, { cwd }), worktreePath);`.

### Step 6 — Add GitContext unit tests for the new methods
- In `adws/gitContext/__tests__/gitContextOperations.test.ts` (where #692 added its method tests), add cases that construct a `GitContext` with a spy `exec` (the `GitContextDeps.exec` seam) and a no-op `fsDeps`, seed canned parseable output, invoke each new method, and assert:
  - the recorded command string matches (`git rev-parse --git-dir`, `git symbolic-ref --short HEAD`, `git worktree list --porcelain`, `git branch --list`),
  - the recorded `cwd` equals the supplied worktree path (or `basePath` when no arg),
  - the recorded child `env.GH_TOKEN` equals the context token and the git author/committer env is present (per-command auth),
  - failure semantics: a throwing spy yields `null` / `[]` / `'missing'` as specified, and `mainRepoPath` throws when no non-`.worktrees` entry is present.

### Step 7 — Migrate `worktreeProbe.ts` onto GitContext
- Change `buildDefaultProbeDeps()` to `buildDefaultProbeDeps(ctx: GitContext): ProbeDeps`. Wire:
  - `resolveGitDir: (wt) => ctx.resolveGitDir(wt)`
  - `currentBranch: (wt) => ctx.currentBranchSymbolic(wt)`
  - `worktreeRegistration: (wt) => ctx.worktreeRegistration(wt)`
  - keep `existsSync`, `isProcessLive`, `rmSync` as the real fns.
- Remove `import { execSync } from 'child_process'`; add `import type { GitContext } from '../gitContext'`.
- Make `deps` a required parameter on `probeWorktree(input, deps)` and `clearOrphanedIndexLock(worktreePath, deps)` (the default can no longer be built without a context; the only production caller and all unit tests pass explicit deps).

### Step 8 — Wire the context into `takeoverHandler.ts`
- In `buildDefaultTakeoverDeps(repoInfo)`, update the `probeWorktree` and `clearOrphanedIndexLock` closures to construct a context from `repoInfo` and pass `buildDefaultProbeDeps(ctx)` into the probe calls, mirroring the existing `resetWorktree` closure (lazy `gitContextForSync({ owner, repo, selfHost: false })` with a `repoInfo`-required guard; optionally hoist the ctx + probe-deps once if `repoInfo` is present). Import `buildDefaultProbeDeps`.
- Confirm `takeoverHandler.ts` still contains no raw `git`/`gh` call expressions (it delegates).

### Step 9 — Migrate `worktreeOperations.ts` (`getMainRepoPath`)
- Replace the `execSync` body of `getMainRepoPath(cwd)` with `return gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd);` (import both from `../github/gitContextFactory`). Remove the `child_process` import. Keep the function signature and the `vcs/index.ts` re-export; `claudeAgent.ts` stays unchanged (its non-fatal try/catch still catches a thrown error or a factory/token failure).

### Step 10 — Migrate `branchOperations.ts` (`getDefaultBranch`, delete dead code)
- Replace the `execSync` body of `getDefaultBranch(cwd?)` with `return gitContextForRepo(readLocalRepoInfo(cwd)).defaultBranch();` (import from `../github/gitContextFactory`).
- Delete the dead `deleteLocalBranch` function (not exported by `vcs/index.ts`; the only `git branch -D` caller is `GitContext.deleteLocalBranch`, which is unaffected). Remove the `child_process` import. Keep `PROTECTED_BRANCHES`, `validateSlug`, `generateBranchName`, `inferIssueTypeFromBranch`.

### Step 11 — Migrate `branchIdentityFallback.ts` (candidate-branch enumeration)
- Replace `defaultListCandidateBranches(cwd?)` so it builds `const ctx = gitContextForRepo(readLocalRepoInfo(cwd))` and returns `[...new Set([...ctx.worktreeBranches(cwd), ...ctx.localBranches(cwd)])]` (import from `../github/gitContextFactory`).
- Delete the now-unused `parseWorktreeBranchNames` and remove the `child_process` import. Keep `fs`/`AGENTS_STATE_DIR` usage in `defaultListAdwIds` and all pure recovery logic. The `BranchIdentityFallbackDeps` seam and `defaultDeps` shape are unchanged, so `findExistingBranchForIssue` / `recoverAdwIdForBranch` and their callers (`branchNameResolution.ts`, `workflowInit.ts`) need no change.

### Step 12 — Migrate `orchestratorLib.ts` (`hasUncommittedChanges`)
- Replace the `execSync` body of `hasUncommittedChanges(cwd?)` with `return gitContextForRepo(readLocalRepoInfo(cwd)).hasUncommittedChanges(cwd);` (import from `../github/gitContextFactory`). Remove the `child_process` import. Keep the function signature so the re-exports (`core/index.ts`, `adws/index.ts`) and callers (`prPhase.ts`, `workflowInit.ts`) are unchanged.
- Verify no import cycle: `gitContextFactory` imports `../core/environment` (a leaf module, not the `core` barrel), and `core/upgradeClaim.ts` already imports from `../github/*`, so `core → github/gitContextFactory` is precedented. Run the type-check after this step to confirm.

### Step 13 — Remove the five ALLOWLIST entries
- In `adws/checkGitGhGuard.ts`, delete these lines from the `residual` block of `ALLOWLIST`:
  - `'adws/vcs/branchOperations.ts'`
  - `'adws/vcs/worktreeProbe.ts'`
  - `'adws/vcs/worktreeOperations.ts'`
  - `'adws/core/orchestratorLib.ts'`
  - `'adws/phases/branchIdentityFallback.ts'`
- Leave all bootstrap, diagnostic, and other-slice residual entries intact.

### Step 14 — Update unit tests broken by signature changes
- `adws/vcs/__tests__/worktreeProbe.test.ts`: tests inject explicit `ProbeDeps`, so the probe-logic cases are unaffected. If any case calls `buildDefaultProbeDeps()` with no arg, update it to pass a stub `GitContext` (or a minimal object satisfying the wired methods).
- `adws/vcs/__tests__/branchOperations.test.ts`: covers only the pure vocabulary today (no `getDefaultBranch`/`deleteLocalBranch` cases), so deleting `deleteLocalBranch` and adapter-izing `getDefaultBranch` should not break it — confirm and remove any stale reference.
- `adws/phases/__tests__/branchIdentityFallback.test.ts`: tests inject `BranchIdentityFallbackDeps`, so recovery-logic cases are unaffected — confirm no case asserts on the raw default `listCandidateBranches`.
- `adws/phases/__tests__/workflowInit.test.ts`: confirm it mocks/stubs `hasUncommittedChanges` (or the module) rather than exercising the real adapter; adjust the mock target if needed.
- Run `bun run test:unit` and fix any fallout.

### Step 15 — Add the BDD per-issue feature and step definitions
- Create `features/per-issue/feature-693.feature` (tagged `@adw-693` and the adwId tag), with the four sections described in **Testing Strategy → BDD Scenarios**.
- Create `features/per-issue/step_definitions/feature-693.steps.ts` adding ONLY the `vcs-probe`-read `When` dispatchers — the base-path form `the {string} vcs-probe operation runs through the context` and the supplied-path variant `the {string} vcs-probe operation runs through the context for worktree path {string}` — plus the one new `Then the captured command ran with cwd equal to the supplied worktree path {string}` assertion (for §1a), reusing the shared `gitContextSharedWorld.ts` world (`W`, `makeFullOptions`, `makeSpyExec`, `makeNoOpFsDeps`) and the globally-registered assertion/guard/type-check steps from `feature-659.steps.ts`, `feature-691.steps.ts`, and `feature-504.steps.ts`. Do NOT redefine the guard or type-check steps (Cucumber raises a duplicate-definition error).
- Dry-run the steps: `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-693"`.

### Step 16 — Run the full validation suite
- Run every command in **Validation Commands** and ensure all pass with zero regressions. The headline gate is `bun run lint:git-guard` reporting zero violations with the five files now scanned, plus the `@adw-693` scenarios green.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so include unit tests:
- **`GitContext` new methods** (in `adws/gitContext/__tests__/gitContextOperations.test.ts`): for each of `resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`, `worktreeBranches`, `localBranches`, `mainRepoPath`, use a spy `exec` to assert the exact command string, the recorded `cwd` (supplied worktree path or `basePath`), and the child env carrying the context token + git identity (per-command auth, parent env unmutated). Cover the failure paths: throwing spy → `null` / `[]` / `'missing'`; `mainRepoPath` throws when no main entry; `worktreeRegistration` returns the right state for `locked`/`prunable`/`healthy`/`missing` porcelain blocks; `currentBranchSymbolic` returns `null` on a throwing (detached-HEAD) spy; `resolveGitDir` absolutizes a relative `.git` path.
- **`worktreeProbe.ts`**: confirm the existing injected-deps probe-signal cases still pass; add a case that `buildDefaultProbeDeps(ctx)` wires `resolveGitDir`/`currentBranch`/`worktreeRegistration` to the context (a spy `GitContext`-shaped object records the calls).
- **Signature-change confirmations**: `branchOperations.test.ts`, `branchIdentityFallback.test.ts`, `workflowInit.test.ts` continue to pass (deps-injected or module-mocked); update only what the signature/dead-code changes break.

### Edge Cases
- **Detached HEAD** in a probed worktree → `currentBranchSymbolic` returns `null` → `headOnExpectedBranch` is `false` (unchanged behaviour vs. the old `git symbolic-ref` throw).
- **Relative `--git-dir` output** (e.g. `.git`) → `resolveGitDir` resolves it against the worktree path to an absolute path.
- **Worktree path absent from `git worktree list`** → `worktreeRegistration` returns `'missing'`; `getWorktreeForBranch`/`mainRepoPath` behave as before.
- **`mainRepoPath` with only `.worktrees` entries / git failure** → throws; `claudeAgent.ts`'s try/catch skips env injection (non-fatal, unchanged).
- **`getDefaultBranch` against a target-repo worktree** → `readLocalRepoInfo(cwd)` parses the worktree's `origin` owner/repo, and `GitContext.defaultBranch()` queries `gh repo view <owner>/<repo>` explicitly (equivalent to, and arguably more correct than, the old cwd-relative `gh repo view`).
- **`takeoverHandler` with absent `repoInfo`** → the probe closures throw the same `repoInfo required` guard as the existing `resetWorktree` closure (probe is only reached with a candidate worktree, so `repoInfo` is present in practice).
- **No GitHub auth available** in a thin-adapter call → `gitContextForRepo` → `resolveToken` throws; for `getMainRepoPath` this is caught by `claudeAgent` (non-fatal); other adapters surface the error at the same boundary the old code would have failed at.
- **Guard false-negative regression** → the whole-repo guard run (§3) fails loudly if any of the five files is de-allowlisted while a raw `git`/`gh` call still lives in it.

## Acceptance Criteria
- [ ] `GitContext` exposes the new probe/enumeration read methods (`resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`, `worktreeBranches`, `localBranches`, `mainRepoPath`), each routed through `#run`; `git branch -D` and `git status --porcelain` continue to be served by the existing `deleteLocalBranch` / `hasUncommittedChanges` methods.
- [ ] `worktreeProbe.ts`, `worktreeOperations.ts`, `branchOperations.ts`, `branchIdentityFallback.ts`, and `orchestratorLib.ts` contain **no** direct `git`/`gh` shell-out and route their reads through `GitContext` (probe via context-backed deps; the others via thin factory-backed adapters).
- [ ] The dead `branchOperations.deleteLocalBranch` is removed.
- [ ] Those five files are removed from `ALLOWLIST` in `adws/checkGitGhGuard.ts`.
- [ ] `bun run lint:git-guard` reports zero violations, with the five files now counted as scanned.
- [ ] `@adw-693` BDD scenarios pass: each probe/branch read method routes through `#run` with per-command auth and the correct `cwd` (the context base path, or the supplied worktree path for a probe); each migrated file is scanned by the guard and is violation-free; the whole-repo guard passes; the ADW type-check passes.
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass with zero regressions.
- [ ] No behavioural change to the worktree-reuse probe, main-repo-path injection, default-branch read, branch-identity fallback, or dirty-tree check.

### BDD Scenarios (feature-693.feature)
Mirrors the #692 structure with the file list and method set swapped; all assertions target runtime outputs (recorded `(cwd, env)`, live `process.env`, the guard's `{ violations, scannedCount }`, the type-check verdict), never source text.
- **§1 — Probe/branch methods route through `#run`** (stories 16, 17): **§1a** (the headline new contract) asserts a worktree probe run against a *supplied* worktree path spawns with the context token + git author and `cwd` equal to **that exact supplied path** — never the base path, never the ambient process cwd. **§1b** is a `Scenario Outline` over the worktree/branch read shapes (`resolve-git-dir`, `current-branch`, `worktree-list`, `list-local-branches`, `delete-local-branch`, `uncommitted-status`) — each invoked with no explicit path so it defaults to the base-path `cwd` — asserting the captured child env carries the context token and the captured `cwd` equals the context base path (the migration signal; new and reused methods alike route through the chokepoint). **§1c** (story 5) is the anti-regression: running a probe read leaves `process.env` byte-for-byte unchanged.
- **§2 — Migrated consumers de-allowlisted and guard-clean** (stories 5, 17): a `Scenario Outline` over the five files asserts the guard now **scans** each (`scannedCount` counts it — the de-allowlisting discriminator) and **reports no violation** in it.
- **§3 — Whole-repo guard still passes** (story 5): the guard run across the repository reports zero violations (safe-de-allowlisting backstop).
- **§4 — Type-check backstop** (registry T22): the ADW TypeScript type-check passes with the migrated surface in place.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint, zero errors.
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (the §4 backstop's tool).
- `bun run lint:git-guard` — **headline gate.** `bunx tsx adws/checkGitGhGuard.ts` exits 0 with zero violations; the five migrated files are now scanned (not allowlisted).
- `bun run test:unit` — `vitest run`, all unit tests green (incl. the new `GitContext` method tests).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-693"` — the per-issue BDD scenarios pass.
- `bun run build` — `tsc` build succeeds with no errors.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep files under 300 lines (hence the separate `worktreeProbeOps.ts`), prefer pure functions with side effects isolated behind the injected `Runner`/`exec` seams, use guard clauses, and avoid `any`. The new methods follow the existing GitContext idiom exactly — no decorators, no cleverness.
- **Thin-adapter rationale**: `getMainRepoPath`, `getDefaultBranch`, `hasUncommittedChanges`, and `defaultListCandidateBranches` keep their signatures and become thin adapters over `gitContextForRepo(readLocalRepoInfo(cwd))`. This keeps every one of their callers unchanged (lowest blast radius), and is the precedent #692 set (`githubApi.getAuthenticatedUser` → `gitContextForRepo(getRepoInfo()).authenticatedUser()`). The exact threading is explicitly an implementer's choice per the epic's "pin the decision, not the shape" stance.
- **`worktreeProbe` is the one exception** to the thin-adapter approach: it operates on arbitrary worktree paths during takeover, and `takeoverHandler` already resolves a launch-boundary context, so threading that context into `buildDefaultProbeDeps(ctx)` is the principled (no-cwd-fallback) wiring. `takeoverHandler.ts` is necessary collateral but is not an ALLOWLIST file and gains no raw `git`/`gh` call.
- **Performance**: the thin adapters construct a `GitContext` (which resolves a token) per call. All four call sites are cold paths — agent spawn (minutes-long runs), the rare upgrade-claim default-branch read, once-per-workflow dirty-tree safety nets, and the workflow-init branch-identity fallback — so a single token resolution is negligible. No hot loop calls these.
- **Import-cycle watch**: `orchestratorLib.ts` (in `adws/core/`) importing `../github/gitContextFactory` introduces a `core → github` edge. This is already present (`core/upgradeClaim.ts` imports `../github/prApi` and `../github/githubApi`), and `gitContextFactory` imports the leaf `../core/environment` (not the `core` barrel), so no cycle is expected — but run the type-check immediately after Step 12 to confirm.
- **`branch -D` / `status --porcelain` already exist** on `GitContext` (`deleteLocalBranch`, `hasUncommittedChanges`); do NOT add duplicate methods. The AC's parenthetical enumerates command shapes found across the residual files, not six brand-new methods.
- **No library installs** are required. (`.adw/commands.md` library install command is `bun add <package>` if one were ever needed.)
- **Dependency**: this issue is "Blocked by #692", which is merged to `dev` (commit `69900d5`, PR #706). The helpers it relies on — `readLocalRepoInfo`, `gitContextForRepo`, `gitContextForSync`, `remoteUrl` — are present on this branch.
- **`@regression` sweep is skipped**: `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so promotion to the regression suite is a deliberate human decision; the per-issue feature stays under `features/per-issue/`.
