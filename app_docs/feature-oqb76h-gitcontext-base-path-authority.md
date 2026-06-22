# GitContext Package — Repo-Context Authority, Per-Command Env, and VCS Operation Surface

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`). Base-path resolution happens once in the constructor; every operation method spawns its underlying git/`gh` command through a single private chokepoint (`#run`) that supplies an explicit `cwd` and a fresh per-command child-process environment — never mutating `process.env`. This module implements PRD `specs/prd/git-context-repo-authority.md` and eliminates the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally across all branch, commit/push, fetch/reset, and worktree-reset operations.

## Responsibilities

- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including an omitted `selfHost` boolean discriminator)
- Resolve `basePath` once in the constructor: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — never consulting `process.cwd()`
- Produce a per-command child-process environment overlay via `commandEnv(base?)`: returns a fresh object with `GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` without mutating `process.env`
- Route all git/`gh` execution through the single private `#run(command, cwd?)` chokepoint: explicit `cwd` (defaults to `basePath`) and `env = commandEnv(process.env)` — the only spawn site in the package
- Provide branch operations: `getCurrentBranch`, `mergeLatestFromDefaultBranch`, `fetchAndResetToRemote`, `deleteLocalBranch`, `deleteRemoteBranch`, `defaultBranch`
- Provide commit/push operations: `commitChanges`, `pushBranch` (force-with-lease + lease-rejection detection), `getHeadTreeHash`, `hasUncommittedChanges`
- Provide worktree reset: `resetWorktree` (abort in-progress merge/rebase via fs then fetch/reset --hard/clean -fdx)
- Delegate operation orchestration to package-private modules (`branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`), each taking an injected runner — keeping the `GitContext` class thin and testable without a real context
- Accept an injectable `ExecFn` via `GitContextDeps` for hermetic testing (the ADW `Deps` idiom)
- Export only `GitContext` class and its public types (`GitIdentity`, `GitContextOptions`, `ExecFn`, `GitContextDeps`) via a barrel `index.ts` — no context-free git/`gh` free functions

## Boundary Factory (`adws/github/gitContextFactory.ts`)

`gitContextFor({ owner, repo, selfHost })` and `gitContextForSync(...)` construct a `GitContext` from ambient ADW identity:
- Token resolution order: GitHub App installation token → `GH_TOKEN` env var → `gh auth token` CLI
- Git identity resolution order: `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars → `GITHUB_APP_SLUG` bot identity → `git config user.*` → fallback defaults (`ADW Bot`)
- Injects `REPO_ROOT` / `TARGET_REPOS_DIR` from `adws/core/environment`
- Async export (`gitContextFor`) and sync export (`gitContextForSync`) — all resolution is `execSync` under the hood; async variant exists so callers can `await` at the scope boundary

## Migrated Call Sites (as of #662)

`workflowInit.ts`, `prPhase.ts`, `buildPhase.ts`, `documentPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `prReviewPhase.ts`, `takeoverHandler.ts`, and `webhookHandlers.ts` all construct a `GitContext` via the factory and delegate branch/commit/push/reset calls through context methods. Direct `execSync('git …')` / `execSync('gh …')` for these verbs no longer appear at those call sites.

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws `Error: GitContext: <field> must not be empty`
- Self-host identity (`selfHost: true`) always resolves `basePath` to `frameworkRepoRoot`
- Target identity (`selfHost: false`) always resolves `basePath` to `join(targetReposDir, owner, repo)`
- `worktreePathFor` result is determined solely by `basePath` and the branch name — `process.cwd()` has no effect
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
- `#run` always passes an explicit `cwd` and `env` to the exec function — never inherits process working directory or ambient `process.env.GH_TOKEN`
- Two `GitContext` instances for two repos in one process never share `cwd` or token — `GH_TOKEN` bleed is structurally impossible (no module-global `activeRepo` slot)
- `pushBranch` uses `--force-with-lease --force-if-includes`; a lease rejection throws a descriptive error with manual-remedy instructions (no silent overwrite)
- `resetWorktree` aborts any in-progress merge or rebase (via `git merge/rebase --abort` with fs fallback) before fetching and hard-resetting
- Protected branches (`main`, `master`, `develop`) are refused by `deleteLocalBranch` and `deleteRemoteBranch` (returns `false`)
- `mergeLatestFromDefaultBranch` warns-don't-throw on fetch/merge failures — merge conflicts are non-fatal
- The package imports nothing from `adws/core`, `adws/providers`, or any ADW global — all config is injected at construction

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

Optional injectable dependency bag via `GitContextDeps` (second constructor parameter):

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to a thin `execSync` wrapper |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction. This is intentional: omitting it was the historical detonation point where ADW silently operated on the wrong repo.
- **`process.env` is never mutated on the operation hot path** — `commandEnv(process.env)` overlays the context's token + identity into a new object. If a stale `GH_TOKEN` is already set in `process.env` by legacy `githubAppAuth.ts`, the context token wins for context-routed commands; the parent slot is untouched.
- **Legacy `githubAppAuth.ts` is not fully removed yet** — un-migrated `execSync('gh …')` call sites still read `process.env.GH_TOKEN`. `GitContext` operations don't participate in that global mutation; remaining call-site migration is later-slice work per the PRD.
- **VCS wrappers in `adws/vcs/` are stripped, not deleted** — `branchOperations.ts`, `commitOperations.ts`, and `worktreeReset.ts` now expose only pure vocabulary functions (`generateBranchName`, `validateSlug`, `inferIssueTypeFromBranch`, `PROTECTED_BRANCHES`, `getDefaultBranch`/`deleteLocalBranch` as internal helpers for `#661` scope). All I/O functions have migrated to `GitContext` methods.
- **Branch sanitization regex** — `worktreePathFor` sanitizes with `/[/\\:*?"<>\|`]/g → '-'`, matching the historical `worktreeOperations.ts` helper for path compatibility post-migration.
- **Injectable exec seam (`ExecFn` / `GitContextDeps`) is for tests, not config** — the seam exists so spy tests can assert per-call `{ cwd, env }` without spawning real processes and without `vi.mock('child_process')` fragility. The default is a real `execSync` wrapper — the only real spawn site in the package.
- **`gitContextForSync` vs `gitContextFor`** — use `gitContextForSync` when you're already in a synchronous initialization path (e.g. `workflowInit.ts` at startup); use `gitContextFor` when you can `await`. Both produce identical `GitContext` instances; the async variant is a thin wrapper.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global dependency discipline; physical workspace extraction to `packages/git-context/` is deferred.
