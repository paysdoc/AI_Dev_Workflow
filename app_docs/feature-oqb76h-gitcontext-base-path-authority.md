# GitContext Package — Repo-Context Authority, Per-Command Env Injection, Full VCS & Worktree Surface

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`) and an optional `pat` for PAT-requiring operations. Every operation — branch create/checkout/delete, commit/push (force-with-lease), fetch/reset, worktree create/ensure/remove/list/query, and all `gh`/GitHub-API operations (issue read/comment, PR read/create/merge/approve, label lifecycle, Projects V2 board) — is a method on `GitContext`, running through the single private `#run()` chokepoint that injects per-command auth and git identity into the child process environment without ever mutating `process.env`. This module implements PRD `specs/prd/git-context-repo-authority.md` and eliminates the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally.

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
- Delegate VCS operation orchestration to package-private modules (`branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`, `worktreeCreateOps.ts`, `worktreeQueryOps.ts`, `worktreeRemoveOps.ts`, `processCleanup.ts`), each taking an injected runner — keeping the `GitContext` class thin and testable
- Expose the full `gh` issue, PR, label, and board operation surface as thin methods that delegate to pure command-builder + parser modules in `adws/gitContext/commands/`
- Accept an injectable `ExecFn` via `GitContextDeps` for hermetic testing (the ADW `Deps` idiom)
- Export only `GitContext` class and its public types via `adws/gitContext/index.ts` — no context-free git/`gh` free functions

### Package-private operation modules

Each module is side-effect-free except at the injected runner/fs seam and stays under 300 lines:

| Module | Exports |
|---|---|
| `branchOps.ts` | Branch create/checkout/delete/merge/fetch/reset runners |
| `commitOps.ts` | Commit/push/hash/dirty-check runners |
| `worktreeResetOps.ts` | Abort-in-progress-op + fetch/reset --hard/clean |
| `worktreeCreateOps.ts` | `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo` |
| `worktreeQueryOps.ts` | `listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`; exports `WorktreeForIssueResult` type |
| `worktreeRemoveOps.ts` | `removeWorktree`, `removeWorktreesForIssue`, `parseWorktreeBranches`; injects `killProcesses` fn |
| `processCleanup.ts` | `killProcessesInDirectory` (lsof + SIGTERM→SIGKILL, self-PID filter); re-exported from `vcs/worktreeCleanup.ts` for legacy callers |

### Pure command modules (`adws/gitContext/commands/`)

Each module is side-effect-free (no `exec`, no `process.env`) and stays under 300 lines:

| Module | Exports |
|---|---|
| `issueCommands.ts` | Command builders + parsers for `gh issue …` / `gh api issues` (fetch, comment, state, close, title, comments, labels, create, update, find-upgrade, delete-comment) |
| `prCommands.ts` | PR builders + parsers (find by branch, fetch details/reviews/comments, comment, merge, approve, approval state, list, create) |
| `labelCommands.ts` | Label create and apply (create-if-missing + add) command builders |
| `boardCommands.ts` | Projects V2 GraphQL query/mutation builders + parsers (project id, issue item, status field, status update, `moveIssueToStatus`) |

## Boundary Factory (`adws/github/gitContextFactory.ts`)

`gitContextFor({ owner, repo, selfHost })` and `gitContextForSync(...)` construct a `GitContext` from ambient ADW identity:
- Token resolution order: GitHub App installation token → `GH_TOKEN` env var → `gh auth token` CLI
- Git identity resolution order: `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars → `GITHUB_APP_SLUG` bot identity → `git config user.*` → fallback defaults (`ADW Bot`)
- Injects `REPO_ROOT` / `TARGET_REPOS_DIR` from `adws/core/environment`
- Async export (`gitContextFor`) and sync export (`gitContextForSync`) — all resolution is `execSync` under the hood; async variant exists so callers can `await` at the scope boundary

## Migrated Call Sites (as of #661)

`workflowInit.ts`, `prPhase.ts`, `buildPhase.ts`, `documentPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `prReviewPhase.ts`, `takeoverHandler.ts`, `webhookHandlers.ts`, `cancelHandler.ts`, `devServerJanitor.ts`, `adwMerge.tsx`, `adwUpgrade.tsx`, and `adwPromotionSweep.tsx` all construct a `GitContext` via the factory or receive one threaded from the launch boundary, and delegate all git/gh/worktree calls through context methods. No call site passes an optional base-path/`cwd` to a worktree function; `getWorktreesDir`, `getWorktreePath`, and `worktreeExists` no longer exist.

## VCS Module End State (as of #661)

| File | Status |
|---|---|
| `adws/vcs/worktreeCreation.ts` | Stub — all ops on `GitContext` |
| `adws/vcs/worktreeQuery.ts` | Stub — all ops on `GitContext` |
| `adws/vcs/worktreeCleanup.ts` | Re-exports `killProcessesInDirectory` from `adws/gitContext/`; remove/query ops gone |
| `adws/vcs/worktreeOperations.ts` | Retains `getMainRepoPath(cwd: string)` only (required cwd — no defaulting form); unsafe `getWorktreesDir`/`getWorktreePath`/`worktreeExists` deleted |
| `adws/vcs/worktreeReset.ts` | Stub (since #662) |
| `adws/vcs/branchOperations.ts` | Pure vocabulary (slug gen, branch naming) only; I/O functions migrated to GitContext |
| `adws/vcs/commitOperations.ts` | Pure utilities only; commit/push I/O migrated to GitContext |

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
- **VCS wrappers in `adws/vcs/` are stripped, not deleted** — `branchOperations.ts`, `commitOperations.ts`, and all worktree files now expose only pure vocabulary functions or are stubs. All I/O functions have migrated to `GitContext` methods.
- **`getWorktreesDir`, `getWorktreePath`, `worktreeExists` no longer exist** — any code referencing these will fail to compile. Route through `ctx.ensureWorktree()`, `ctx.worktreePathFor()`, or `ctx.getWorktreeForBranch()`.
- **`getMainRepoPath(cwd)` now requires a `cwd` argument** — the no-arg cwd-defaulting form is gone. The only remaining consumer is `claudeAgent.ts`, which always supplies an explicit worktree `cwd`.
- **`activeRepo`/`ensureAppAuthForRepo` are gone** — any code still calling `ensureAppAuthForRepo` will fail to compile. Use `gitContextForRepo(repoInfo).<method>()` instead.
- **`refreshTokenIfNeeded` is now repo-explicit** — it requires optional `(owner, repo)` args; the no-arg form that fell back to `activeRepo` is removed.
- **`gitContextFactory.ts` lives in `adws/github/`** — not in the reusable package, to keep the package free of ADW globals (`REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`, `getInstallationToken`). The factory is the ADW-layer bridge; the package itself is config-injection pure.
- **Board and approve ops require `GITHUB_PAT`** — `usePat: true` falls back to the context token when `GITHUB_PAT` is unset (user-owned repos degrade gracefully, matching prior behaviour from `feature-9tknkw`).
- **Branch sanitization regex** — `worktreePathFor` sanitizes with `/[/\\:*?"<>|`]/g → '-'`, matching the historical `worktreeOperations.ts` helper for path compatibility post-migration.
- **Injectable exec seam (`ExecFn` / `GitContextDeps`) is for tests, not config** — the seam exists so spy tests can assert per-call `{ cwd, env, input }` without spawning real processes. The default is a real `execSync` wrapper — the only real spawn site in the package.
- **`gitContextForSync` vs `gitContextFor`** — use `gitContextForSync` when you're already in a synchronous initialization path; use `gitContextFor` when you can `await`. Both produce identical `GitContext` instances; the async variant is a thin wrapper.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global dependency discipline; physical workspace extraction to `packages/git-context/` is deferred.
- **`freeBranchFromMainRepo` preserves non-force push** — the known non-force-push deadlock risk on rewritten branches is tracked separately (#648); the ported semantics are unchanged from the prior vcs implementation.
