# GitContext Package — Base-Path Authority & Worktree Operations

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`), resolves `basePath` once in the constructor, and exposes the full worktree operation surface — create, remove, reset, list, find, and path-lookup — as methods whose `cwd` and subprocess env are always derived from `this.basePath`. The ADW-side boundary factory (`gitContextFor` / `gitContextForSync` in `adws/github/gitContextFactory.ts`) wires auth and identity at launch boundaries so callers never pass an optional base path or touch `process.cwd()`. Together they make the historical "wrong-repo worktree" class of bug (e.g. takeover computing a target-repo worktree under the framework cwd) structurally unrepresentable.

## Responsibilities

**Base-path resolution (`adws/gitContext/gitContext.ts`)**
- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including a non-boolean `selfHost`)
- Resolve `basePath` once in the constructor: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — no `process.cwd()` consulted
- Produce per-command subprocess env via `commandEnv(base?)`: fresh object with `GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, no mutation of `process.env`
- Store an optional injected `logger` (defaults to no-op) so the package depends on no ADW globals

**Worktree operation surface (`adws/gitContext/worktreeOps*.ts`)**
- `createWorktree(branch, baseBranch?)` — creates worktree for an existing branch; handles branch-checked-out-elsewhere by reusing or freeing it from the main repo
- `createWorktreeForNewBranch(branch, baseBranch?)` — creates worktree and new branch from `origin/<baseBranch>`
- `ensureWorktree(branch, baseBranch?)` — idempotently creates or reuses; always copies `.env` from `basePath` into the worktree
- `getWorktreeForBranch(branch)` — returns worktree path if it exists (checks expected path and porcelain list), or null
- `removeWorktree(branch)` — kills processes (lsof SIGTERM/SIGKILL), `git worktree remove --force`, deletes local branch; falls back to `fs.rmSync`
- `removeWorktreesForIssue(issueNumber)` — finds all worktrees matching `-issue-<N>-`, removes each, prunes; returns count
- `listWorktrees()` — `git worktree list --porcelain`; returns array of worktree paths
- `findWorktreeForIssue(issueType, issueNumber)` — searches by branch-prefix + issue number; uses internal `BRANCH_PREFIX_MAP` to avoid importing ADW globals
- `worktreeExists(branch)` — checks expected path or porcelain list
- `copyEnvToWorktree(wtPath)` — copies `.env` from `basePath` to the given worktree path
- `resetWorktree(branch)` — abort-merge / abort-rebase / fetch / `reset --hard` / `clean -fdx` sequence; handles linked-worktree git-dir indirection; throws on any mandatory-step failure
- All operations pass `{ cwd: basePath | worktreePath, env: this.commandEnv() }` to every `execSync` call; no ambient `cwd` used

**Boundary factory (`adws/github/gitContextFactory.ts`)**
- `gitContextFor({ owner, repo, selfHost })` — async factory; resolves token (App installation → `GH_TOKEN` env → `gh auth token` CLI) and git identity (env vars set by `configureGitIdentity()` → App bot identity → `git config` → defaults), injects `REPO_ROOT`/`TARGET_REPOS_DIR`, returns `GitContext`
- `gitContextForSync({ owner, repo, selfHost })` — synchronous variant for call sites that cannot await (trigger handlers, cancel, janitor); same token/identity priority chain
- Lives in `adws/github/` (not `adws/gitContext/`) to avoid a cycle: the factory needs `githubAppAuth`, and `gitContext/` must not import ADW globals

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws at construction time, not silently
- Self-host identity (`selfHost: true`) always resolves `basePath` to `frameworkRepoRoot`
- Target identity (`selfHost: false`) always resolves `basePath` to `join(targetReposDir, owner, repo)` — same layout as `core/targetRepoManager.ts`'s `getTargetRepoWorkspacePath`
- All worktree operations run under `basePath` (or a worktree path under it); `process.cwd()` has no effect on any path computation
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
- Two `GitContext` instances with the same `owner/repo` but different `selfHost` values resolve distinct `basePath` and distinct worktree paths for the same branch
- Worktree paths are computed as `join(basePath, '.worktrees', sanitize(branch))` — layout is identical to the deleted `vcs/worktreeOperations.ts` helper, so existing on-disk worktrees remain discoverable post-migration
- `ensureWorktree` always copies `.env` from `basePath` regardless of whether the worktree was newly created or reused
- `removeWorktree` falls back to `fs.rmSync` when `git worktree remove` fails but the directory still exists
- `resetWorktree` throws on any mandatory-step failure (fetch, reset, clean); abort-merge/rebase failures are tolerated before the mandatory sequence
- The `adws/gitContext/` package imports nothing from `adws/core`, `adws/providers`, or any ADW global; all config is injected at construction (logger included)
- The barrel `adws/gitContext/index.ts` exports no context-free git/`gh` free functions

## Configuration

**`GitContextOptions`** (all required unless marked optional):

| Field | Type | Description |
|---|---|---|
| `owner` | `string` | GitHub owner (org or user) |
| `repo` | `string` | Repository name |
| `selfHost` | `boolean` | `true` = ADW's own repo, `false` = target repo |
| `token` | `string` | Personal access or GitHub App installation token |
| `gitIdentity` | `GitIdentity` | Author + committer name/email for git operations |
| `frameworkRepoRoot` | `string` | Absolute path to the ADW framework repo root (`REPO_ROOT`) |
| `targetReposDir` | `string` | Absolute path to cloned target repos directory (`TARGET_REPOS_DIR`) |
| `logger` | `GitContextLogger` (optional) | Injected logger; defaults to no-op so the package needs no ADW import |

**`gitContextFor` / `gitContextForSync`** require only `{ owner, repo, selfHost }` — they source everything else automatically.

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — `undefined` or any non-boolean throws at construction. This is the historical detonation point where ADW silently operated on the wrong repo.
- **Factory token caveat** — `GitContext` mandates a non-empty token even though local worktree git (create/remove/reset/list) authenticates via SSH/stored credentials, not `GH_TOKEN`. The factory always supplies a real token; correctness of the base path does not depend on token validity.
- **`gitContextForSync` for trigger handlers** — `cancelHandler`, `devServerJanitor`, `webhookHandlers`, and `takeoverHandler` are fundamentally sync; they use `gitContextForSync`. The token is unused for pure worktree-local git ops, so the sync path is safe.
- **`findWorktreeForIssue` uses an internal `BRANCH_PREFIX_MAP`** — a private copy of the ADW branch-prefix table to avoid importing from `adws/types/issueRouting.ts` (which would break package purity). If the canonical map in `issueRouting.ts` gains new entries, this copy must be updated in sync.
- **Branch sanitization regex** — `sanitize(branch)` replaces `/\\ :*?"<>|\`` ` with `-`; layout is identical to the old `vcs/worktreeOperations.ts` helper, so existing worktrees are still found after migration.
- **Worktree process-kill** — `removeWorktree*` internally use an lsof-based process-kill (SIGTERM → 500ms → SIGKILL) reimplemented as a package-private helper so the package avoids importing `vcs/worktreeProcessKill`. The public `killProcessesInDirectory` in `adws/vcs/worktreeProcessKill.ts` is a separate utility retained for the dev-server janitor.
- **`getMainRepoPath` and `killProcessesInDirectory` survive in `adws/vcs/`** — `getMainRepoPath` is a worktree→main-repo reverse lookup with an explicit `cwd` (used by `claudeAgent.ts` for `ADW_MAIN_REPO_PATH`); it is not a base-path defaulter. Neither is in scope for deletion.
- **Branch/commit/issue/PR methods are later slices** — `GitContext` currently exposes only worktree operations (PRD story 16). Branch, commit/push (story 17), and issue/PR/board (story 18) methods are deferred. The factory and construction sites introduced here seed the threading work for those slices.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by zero-ADW-global dependency discipline; physical workspace extraction to `packages/git-context/` is deferred.
