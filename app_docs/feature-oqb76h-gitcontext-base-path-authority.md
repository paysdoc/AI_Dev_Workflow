# GitContext Package — Repo-Context Authority, Per-Command Env Injection, Full VCS & Worktree Surface

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`) and an optional `pat` for PAT-requiring operations. Every operation — branch create/checkout/delete, commit/push (force-with-lease), fetch/reset, worktree create/ensure/remove/list/query, worktree/branch probe reads (`resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`, `worktreeBranches`, `localBranches`, `mainRepoPath`), all `gh`/GitHub-API operations (issue read/comment, PR read/create/merge/approve, label lifecycle, Projects V2 board), and git-remote/authenticated-user identity reads (`remoteUrl`, `authenticatedUser`) — is a method on `GitContext`, running through the single private `#run()` chokepoint that injects per-command auth and git identity into the child process environment without ever mutating `process.env`. This module implements PRD `specs/prd/git-context-repo-authority.md` and eliminates the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally.

## Responsibilities

- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including an omitted `selfHost` boolean discriminator)
- Resolve `basePath` once in the constructor: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — never consulting `process.cwd()`
- Produce a per-command child-process environment overlay via `commandEnv(base?)`: fresh object with `GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` — never mutates `process.env`
- Execute every operation through the single private `#run(command, opts?)` chokepoint: spawns with `cwd` (defaults to `basePath`), `env = commandEnv(process.env)`, optional stdin `input`, and optional `usePat` flag (injects PAT as `GH_TOKEN` for that one command when `usePat: true` and `#pat` is set)
- Provide branch operations: `getCurrentBranch`, `mergeLatestFromDefaultBranch`, `fetchAndResetToRemote`, `deleteLocalBranch`, `deleteRemoteBranch`, `defaultBranch`
- Provide commit/push operations: `commitChanges`, `pushBranch` (force-with-lease + lease-rejection detection), `getHeadTreeHash`, `hasUncommittedChanges`
- Provide worktree reset: `resetWorktree` (abort in-progress merge/rebase via fs then fetch/reset --hard/clean -fdx)
- Provide full worktree management surface (slice #661): `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `listWorktrees`, `findWorktreeForIssue`, `removeWorktree`, `removeWorktreesForIssue`, `copyEnvToWorktree`
- Provide gh read methods (slice #691): `listOpenIssues({ fields, search?, limit? })`, `issueComments(issueNumber)`, `fetchMergedPRs(limit?)` — covering the residual direct-`gh` consumers migrated off the ALLOWLIST
- Provide identity-read methods (slice #692): `remoteUrl(cwd?: string)` — runs `git remote get-url origin` in the given `cwd`; `authenticatedUser()` — runs `gh api user` and returns the full JSON string
- Provide worktree/branch probe reads (slice #693): `resolveGitDir(worktreePath)`, `currentBranchSymbolic(worktreePath)`, `worktreeRegistration(worktreePath)`, `worktreeBranches(cwd?)`, `localBranches(cwd?)`, `mainRepoPath(cwd?)` — replacing the last five raw-`git` call sites in `worktreeProbe.ts`, `worktreeOperations.ts`, `branchOperations.ts`, `branchIdentityFallback.ts`, and `orchestratorLib.ts`; all five files removed from the guard ALLOWLIST
- Delegate VCS operation orchestration to package-private modules (`branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`, `worktreeCreateOps.ts`, `worktreeQueryOps.ts`, `worktreeRemoveOps.ts`, `worktreeProbeOps.ts`, `processCleanup.ts`), each taking an injected runner — keeping the `GitContext` class thin and testable
- Expose the full `gh` issue, PR, label, and board operation surface as thin methods that delegate to pure command-builder + parser modules in `adws/gitContext/commands/`
- Accept an injectable `ExecFn` via `GitContextDeps` for hermetic testing (the ADW `Deps` idiom)
- Export only `GitContext` class and its public types via `adws/gitContext/index.ts` — no context-free git/`gh` free functions

### Package-private operation modules

Each module is side-effect-free except at the injected runner/fs seam and stays under 300 lines:

| Module | Exports |
|---|---|
| `branchOps.ts` | Branch create/checkout/delete/merge/fetch/reset runners; `localBranches` (slice #693) |
| `commitOps.ts` | Commit/push/hash/dirty-check runners |
| `worktreeResetOps.ts` | Abort-in-progress-op + fetch/reset --hard/clean |
| `worktreeCreateOps.ts` | `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo` |
| `worktreeQueryOps.ts` | `listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`; `mainRepoPath`, `worktreeBranches` (slice #693); exports `WorktreeForIssueResult` type |
| `worktreeRemoveOps.ts` | `removeWorktree`, `removeWorktreesForIssue`, `parseWorktreeBranches`; injects `killProcesses` fn |
| `worktreeProbeOps.ts` | `resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration` (slice #693); exports `WorktreeRegistration` union type; handles arbitrary worktree paths supplied by the caller |
| `processCleanup.ts` | `killProcessesInDirectory` (lsof + SIGTERM→SIGKILL, self-PID filter); re-exported from `vcs/worktreeCleanup.ts` for legacy callers |

### Pure command modules (`adws/gitContext/commands/`)

Each module is side-effect-free (no `exec`, no `process.env`) and stays under 300 lines:

| Module | Exports |
|---|---|
| `issueCommands.ts` | Command builders + parsers for `gh issue …` / `gh api issues` (fetch, comment, state, close, title, comments, labels, create, update, find-upgrade, delete-comment, **listOpenIssues** with `ListOpenIssuesOptions`, **issueComments**) |
| `prCommands.ts` | PR builders + parsers (find by branch, fetch details/reviews/comments, comment, merge, approve, approval state, list, create, **fetchMergedPRs**) |
| `labelCommands.ts` | Label create and apply (create-if-missing + add) command builders |
| `boardCommands.ts` | Projects V2 GraphQL query/mutation builders + parsers (project id, issue item, status field, status update, `moveIssueToStatus`) |

## Boundary Factory (`adws/github/gitContextFactory.ts`)

`gitContextFor({ owner, repo, selfHost })`, `gitContextForSync(...)`, and `gitContextForRepo(repoInfo)` construct a `GitContext` from ambient ADW identity:
- Token resolution order: GitHub App installation token → `GH_TOKEN` env var → `gh auth token` CLI
- Git identity resolution order: `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars → `GITHUB_APP_SLUG` bot identity → `git config user.*` → fallback defaults (`ADW Bot`)
- Injects `REPO_ROOT` / `TARGET_REPOS_DIR` from `adws/core/environment`
- Async export (`gitContextFor`) and sync export (`gitContextForSync`) — all resolution is `execSync` under the hood; async variant exists so callers can `await` at the scope boundary
- `gitContextForRepo(repoInfo)` is a sync convenience for consumers that only have a `RepoInfo` object (e.g. trigger-layer modules); auto-detects self-host so the base path always resolves to a directory that exists
- `readLocalRepoInfo(cwd?: string): RepoInfo` (added in #692) — a permanently-allowlisted bootstrap export that reads `git remote get-url origin` and parses both HTTPS and SSH GitHub remote URLs into `{ owner, repo }`. Lives here (not in `githubApi.ts`) because it produces the identity a `GitContext` is constructed *from* (chicken-and-egg: the caller cannot yet have a `GitContext` to route through). `githubApi.getRepoInfo` delegates directly to this function; all ~20 callers of `getRepoInfo` are unaffected. Throws `"Could not parse GitHub URL: …"` / `"Failed to get repo info: …"` on failure.

## Migrated Call Sites (as of #693)

`workflowInit.ts`, `prPhase.ts`, `buildPhase.ts`, `documentPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `prReviewPhase.ts`, `takeoverHandler.ts`, `webhookHandlers.ts`, `cancelHandler.ts`, `devServerJanitor.ts`, `adwMerge.tsx`, `adwUpgrade.tsx`, and `adwPromotionSweep.tsx` all construct a `GitContext` via the factory or receive one threaded from the launch boundary.

Trigger-layer and phase modules migrated in #691 (gh reads):

| Consumer | Previous | Now |
|---|---|---|
| `concurrencyGuard.ts` | `execSync('gh issue list …')` | `gitContextForRepo(repoInfo).listOpenIssues(...)` |
| `webhookGatekeeper.ts` (×2) | `execSync('gh issue list …')` | `ctx.listOpenIssues(...)` (prefers injected `gitContext`; falls back to factory) |
| `docsSelfCheck.ts` | `execWithRetry('gh issue list …')` | `gitContextForRepo(repoInfo).listOpenIssues(...)` |
| `takeoverHandler.ts` | `execSync('gh issue view … --jq .comments')` | `gitContextForRepo(repoInfo).issueComments(issueNumber)` |
| `perIssueScenarioSweep.ts` | `execSync('gh pr list …')` | `gitContextForRepo(repoInfo).fetchMergedPRs(200)` |

Identity-read consumers migrated in #692:

| Consumer | Previous | Now |
|---|---|---|
| `githubApi.ts` `getRepoInfo` | `execSync('git remote get-url origin', { cwd })` | `readLocalRepoInfo(cwd)` (delegates to factory bootstrap — chicken-and-egg) |
| `githubApi.ts` `getAuthenticatedUser` | `execWithRetry('gh api user --jq .login')` | `gitContextForRepo(getRepoInfo()).authenticatedUser()` then `JSON.parse(...).login` |
| `repoContext.ts` `validateGitRemote` | `execSync('git remote get-url origin', { cwd, … })` | `gitContextForRepo({ owner, repo }).remoteUrl(cwd)` |
| `trigger_cron.ts` `fetchOpenIssues` | `execSync('gh issue list --repo … --json …')` | `gitContextForRepo(cronRepoInfo).listOpenIssues({ fields: [...], limit: 100 })` |
| `trigger_cron.ts` `buildTargetRepoArgs` fallback | `execSync('git remote get-url origin')` | `gitContextForRepo(cronRepoInfo).remoteUrl()` |

VCS probe/branch consumers migrated in #693:

| Consumer | Previous | Now |
|---|---|---|
| `worktreeProbe.ts` `buildDefaultProbeDeps` | `execSync('git rev-parse --git-dir', { cwd: worktreePath })` | `ctx.resolveGitDir(worktreePath)` |
| `worktreeProbe.ts` `buildDefaultProbeDeps` | `execSync('git symbolic-ref --short HEAD', { cwd: worktreePath })` | `ctx.currentBranchSymbolic(worktreePath)` |
| `worktreeProbe.ts` `buildDefaultProbeDeps` | `execSync('git worktree list --porcelain', { cwd: worktreePath })` | `ctx.worktreeRegistration(worktreePath)` |
| `worktreeOperations.ts` `getMainRepoPath` | `execSync('git worktree list --porcelain', { cwd })` | `gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd)` |
| `branchOperations.ts` `getDefaultBranch` | `execSync(gh repo view … defaultBranchRef, { cwd })` | `gitContextForRepo(readLocalRepoInfo(cwd)).defaultBranch()` |
| `branchIdentityFallback.ts` `defaultListCandidateBranches` | `execSync('git worktree list --porcelain')` + `execSync('git branch --list')` | `ctx.worktreeBranches(cwd)` + `ctx.localBranches(cwd)` |
| `orchestratorLib.ts` `hasUncommittedChanges` | `execSync('git status --porcelain', { cwd })` | `gitContextForRepo(readLocalRepoInfo(cwd)).hasUncommittedChanges(cwd)` |

All five files from #693 have been removed from the `ALLOWLIST` in `adws/checkGitGhGuard.ts` (`worktreeProbe.ts`, `worktreeOperations.ts`, `branchOperations.ts`, `branchIdentityFallback.ts`, `orchestratorLib.ts`). The three non-bootstrap files from #692 (`githubApi.ts`, `repoContext.ts`, `trigger_cron.ts`) were removed in that slice. `bun run lint:git-guard` now passes with all these files scanned.

## VCS Module End State (as of #693)

| File | Status |
|---|---|
| `adws/vcs/worktreeCreation.ts` | Stub — all ops on `GitContext` |
| `adws/vcs/worktreeQuery.ts` | Stub — all ops on `GitContext` |
| `adws/vcs/worktreeCleanup.ts` | Re-exports `killProcessesInDirectory` from `adws/gitContext/`; remove/query ops gone |
| `adws/vcs/worktreeOperations.ts` | Thin adapter — `getMainRepoPath(cwd)` delegates to `gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd)`; no raw `child_process` import |
| `adws/vcs/worktreeReset.ts` | Stub (since #662) |
| `adws/vcs/worktreeProbe.ts` | Pure probe logic + injected `ProbeDeps` seam unchanged; `buildDefaultProbeDeps(ctx: GitContext)` now requires a `GitContext` arg (no default); `probeWorktree`/`clearOrphanedIndexLock` require explicit `deps` |
| `adws/vcs/branchOperations.ts` | Pure vocabulary (slug gen, branch naming, `PROTECTED_BRANCHES`) only; `getDefaultBranch` is a thin adapter; dead `deleteLocalBranch` removed; no raw `child_process` import |
| `adws/vcs/commitOperations.ts` | Pure utilities only; commit/push I/O migrated to GitContext |
| `adws/phases/branchIdentityFallback.ts` | `defaultListCandidateBranches` thin adapter via `gitContextForRepo`; `parseWorktreeBranchNames` deleted; no raw `child_process` import |
| `adws/core/orchestratorLib.ts` | `hasUncommittedChanges` thin adapter via `gitContextForRepo`; `deriveOrchestratorScript`/`orchestratorNamesForScript` extracted to `orchestratorNames.ts`; no raw `child_process` import |

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws `Error: GitContext: <field> must not be empty`
- Self-host identity (`selfHost: true`) always resolves `basePath` to `frameworkRepoRoot`
- Target identity (`selfHost: false`) always resolves `basePath` to `join(targetReposDir, owner, repo)`
- `worktreePathFor` result is determined solely by `basePath` and the branch name — `process.cwd()` has no effect
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
- `#run` always passes an explicit `cwd` and `env` to the exec function — never inherits process working directory or ambient `process.env.GH_TOKEN`
- When `usePat: true` and `#pat` is set, `GH_TOKEN` in the child env is the PAT; otherwise it is the context's primary token. The parent `process.env` is unchanged in both cases.
- Two `GitContext` instances for two repos in one process never share `cwd` or token — `GH_TOKEN` bleed is structurally impossible (no module-global `activeRepo` slot)
- The `activeRepo` module-global and `ensureAppAuthForRepo` were deleted from `githubAppAuth.ts`; all `gh` ops authenticate via the context's per-command child env
- `pushBranch` uses `--force-with-lease --force-if-includes`; a lease rejection throws a descriptive error with manual-remedy instructions (no silent overwrite)
- `resetWorktree` aborts any in-progress merge or rebase (via `git merge/rebase --abort` with fs fallback) before fetching and hard-resetting
- Protected branches (`main`, `master`, `develop`) are refused by `deleteLocalBranch` and `deleteRemoteBranch` (returns `false`)
- `mergeLatestFromDefaultBranch` warns-don't-throw on fetch/merge failures — merge conflicts are non-fatal
- All worktree create/ensure/remove/list/query methods resolve paths under `#basePath` via `#worktreesDir()` and `worktreePathFor()` — no caller-supplied base path
- The package imports nothing from `adws/core`, `adws/providers`, or any ADW global — all config is injected at construction (`findWorktreeForIssue` takes a pre-resolved `prefixes` array so the package stays free of `branchPrefixMap`)
- `listOpenIssues`, `issueComments`, and `fetchMergedPRs` are thin delegators through `#run()` — they do not mutate `process.env` and they use the context's token for per-command auth
- `remoteUrl(cwd?)` and `authenticatedUser()` are thin delegators through `#run()` — same per-command auth and non-mutation guarantee as all other methods
- Probe reads (`resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`) operate on a caller-supplied worktree path; `worktreeBranches`, `localBranches`, `mainRepoPath` accept an optional `cwd` defaulting to `#basePath` — all route through `#run` with per-command auth
- `resolveGitDir` absolutizes a relative `.git` output against the worktree path (`path.resolve`); returns `null` on failure
- `currentBranchSymbolic` returns `null` on detached HEAD or failure (does not throw)
- `worktreeRegistration` returns `'healthy' | 'locked' | 'prunable' | 'missing'`; `'missing'` on failure or path-not-found
- `worktreeBranches` and `localBranches` return `[]` on failure (never throw)
- `mainRepoPath` throws `Error('Could not find main repository in worktree list')` when no non-`.worktrees` entry exists — preserving the throw-on-failure contract of the legacy `getMainRepoPath`
- `readLocalRepoInfo` in the factory is a permanent bootstrap exception: it calls `execSync('git remote get-url origin')` directly because it *produces* the `RepoInfo` a `GitContext` is constructed from (the `gitContextForRepo` call would be circular). No other bootstrap need should create new raw shell-outs outside the factory.

## Configuration

All configuration is injected at construction via `GitContextOptions`:

| Field | Type | Description |
|---|---|---|
| `owner` | `string` | GitHub owner (org or user) |
| `repo` | `string` | Repository name |
| `selfHost` | `boolean` | `true` = ADW's own repo, `false` = target repo |
| `token` | `string` | Personal access or GitHub App installation token |
| `gitIdentity` | `GitIdentity` | Author + committer name/email for git operations |
| `frameworkRepoRoot` | `string` | Absolute path to the ADW framework repo root (injected from `REPO_ROOT`) |
| `targetReposDir` | `string` | Absolute path to cloned target repos directory (injected from `TARGET_REPOS_DIR`) |
| `pat?` | `string` | Optional PAT for `usePat` ops (PR approve, Projects V2 board) |

Optional injectable dependency bag via `GitContextDeps` (second constructor parameter):

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to thin `execSync` wrapper |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction. This is intentional: omitting it was the historical detonation point where ADW silently operated on the wrong repo.
- **`process.env` is never mutated on the operation hot path** — `commandEnv(process.env)` overlays the context's token + identity into a new object. The context token wins for context-routed commands; the parent slot is untouched.
- **`#run` accepts optional `{ cwd?, input?, usePat? }`** — `cwd` overrides the base path for VCS ops on worktrees; `input` pipes data to stdin; `usePat: true` injects `GITHUB_PAT` as `GH_TOKEN` for that one command only (approve PR, Projects V2 GraphQL). Never mutates `process.env`.
- **Worktree ops receive explicit paths, not a base-path arg** — `worktreeCreateOps`, `worktreeQueryOps`, and `worktreeRemoveOps` take pre-computed `worktreesDir`, `worktreePath`, and `baseCwd` from the `GitContext`; they perform no base-path defaulting. The `#worktreePaths(branchName)` private helper binds these from `#basePath`.
- **`findWorktreeForIssue` takes a `prefixes` array** — callers resolve `branchPrefixMap[issueType]` + `branchPrefixAliases[issueType]` before calling; the package does not import ADW core.
- **VCS wrappers in `adws/vcs/` are stripped, not deleted** — `branchOperations.ts`, `commitOperations.ts`, and all worktree files now expose only pure vocabulary functions, thin adapters, or are stubs. All I/O functions have migrated to `GitContext` methods.
- **`getWorktreesDir`, `getWorktreePath`, `worktreeExists` no longer exist** — any code referencing these will fail to compile. Route through `ctx.ensureWorktree()`, `ctx.worktreePathFor()`, or `ctx.getWorktreeForBranch()`.
- **`getMainRepoPath(cwd)` now requires a `cwd` argument** — the no-arg cwd-defaulting form is gone. The only remaining consumer is `claudeAgent.ts`, which always supplies an explicit worktree `cwd`.
- **`activeRepo`/`ensureAppAuthForRepo` are gone** — any code still calling `ensureAppAuthForRepo` will fail to compile. Use `gitContextForRepo(repoInfo).<method>()` instead.
- **`refreshTokenIfNeeded` is now repo-explicit** — it requires optional `(owner, repo)` args; the no-arg form that fell back to `activeRepo` is removed.
- **`gitContextFactory.ts` lives in `adws/github/`** — not in the reusable package, to keep the package free of ADW globals (`REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`, `getInstallationToken`). The factory is the ADW-layer bridge; the package itself is config-injection pure.
- **Board and approve ops require `GITHUB_PAT`** — `usePat: true` falls back to the context token when `GITHUB_PAT` is unset (user-owned repos degrade gracefully, matching prior behaviour from `feature-9tknkw`).
- **Branch sanitization regex** — `worktreePathFor` sanitizes with `/[/\\:*?"<>|`]/g → '-'`, matching the historical `worktreeOperations.ts` helper for path compatibility post-migration.
- **Injectable exec seam (`ExecFn` / `GitContextDeps`) is for tests, not config** — the seam exists so spy tests can assert per-call `{ cwd, env, input }` without spawning real processes. The default is a real `execSync` wrapper — the only real spawn site in the package.
- **`gitContextForSync` vs `gitContextFor` vs `gitContextForRepo`** — use `gitContextForSync` when you're already in a synchronous initialization path; use `gitContextFor` when you can `await`; use `gitContextForRepo(repoInfo)` in trigger/phase modules that only have a `RepoInfo` object (the most common case in `adws/triggers/` and `adws/phases/`). All produce identical `GitContext` instances.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global dependency discipline; physical workspace extraction to `packages/git-context/` is deferred.
- **`freeBranchFromMainRepo` preserves non-force push** — the known non-force-push deadlock risk on rewritten branches is tracked separately (#648); the ported semantics are unchanged from the prior vcs implementation.
- **`listOpenIssues` shares command shape across three former allowlisted consumers** — `concurrencyGuard` projects `[number, comments]`, `webhookGatekeeper` projects `[number, body]`, and `docsSelfCheck` projects `[number, title]` with a `search` filter; the `ListOpenIssuesOptions` type captures all three variations.
- **`checkGitGhGuard.ts` `main()` guard** — the guard is now exported as a module to support test imports; `main()` is called only when `process.argv[1]` includes `checkGitGhGuard` (i.e. when run as a script). Tests can import `scanFiles`/`ALLOWLIST` without side-effects.
- **`getAuthenticatedUser` lost `execWithRetry`'s per-call retry** — the new path calls `gitContextForRepo(...).authenticatedUser()` which does not retry internally. The existing `catch` block already fails open to `null` (callers treat `null` as "no self-author filter"), matching the #691 retry-loss precedent for `docsSelfCheck`. This is acceptable.
- **`readLocalRepoInfo` is the only correct place for a bootstrap git-remote read** — any future need to derive identity before a `GitContext` exists must extend or call this function (not duplicate a raw `execSync('git remote get-url origin')` elsewhere). The `checkGitGhGuard.ts` ALLOWLIST treats `gitContextFactory.ts` as a permanent bootstrap entry for exactly this reason.
- **`remoteUrl(cwd)` in `validateGitRemote` now requires a resolvable token** — previously the read was token-free (just a local git invocation). `gitContextForRepo` resolves an auth token at construction; if token resolution throws, the existing `try/catch` in `validateGitRemote` surfaces the same "Failed to get git remote URL" error class. ADW's authenticated workflow paths always have a token available.
- **`buildDefaultProbeDeps` now requires a `GitContext` arg** — the no-arg form is gone; `probeWorktree` and `clearOrphanedIndexLock` require explicit `deps`. The only production caller (`takeoverHandler.ts` `buildDefaultTakeoverDeps`) now constructs a context from `repoInfo` and passes `buildDefaultProbeDeps(ctx)`. `repoInfo` is required for probe operations; the closures throw the same guard as the existing `resetWorktree` closure when `repoInfo` is absent.
- **`branchOperations.deleteLocalBranch` is gone** — it was dead code (not exported by `vcs/index.ts`, no external callers). `GitContext.deleteLocalBranch` is the only `git branch -D` entry point.
- **`orchestratorLib` no longer re-declares `deriveOrchestratorScript`/`orchestratorNamesForScript`** — those were extracted to `adws/core/orchestratorNames.ts` and re-exported from `orchestratorLib.ts` for backwards compatibility; callers of `orchestratorLib` are unaffected.
- **`worktreeProbeOps.ts` is distinct from `worktreeQueryOps.ts`** — `worktreeProbeOps` handles reads on an *arbitrary caller-supplied* worktree path (probe registration, git-dir, current-branch); `worktreeQueryOps` handles the context's own worktree tree (list, find, main-repo-path, worktree-branches). The split keeps both files under 300 lines.
- **Thin-adapter calls construct a `GitContext` per call** — `getMainRepoPath`, `getDefaultBranch`, `hasUncommittedChanges`, `defaultListCandidateBranches` all call `gitContextForRepo(readLocalRepoInfo(cwd))` on every invocation. These are all cold paths (agent spawn, rare upgrade-claim, once-per-workflow safety net, workflow-init fallback), so token resolution cost is negligible.
