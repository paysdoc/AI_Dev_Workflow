# GitContext Package — Repo-Context Authority, Per-Command Env Injection, VCS & gh Operation Surface

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`) and an optional `pat` for PAT-requiring operations. Every operation — branch create/checkout/delete, commit/push (force-with-lease), fetch/reset, worktree reset, and all `gh`/GitHub-API operations (issue read/comment, PR read/create/merge/approve, label lifecycle, Projects V2 board) — is a method on `GitContext`, running through the single private `#run()` chokepoint that injects per-command auth and git identity into the child process environment without ever mutating `process.env`. This module implements PRD `specs/prd/git-context-repo-authority.md` and eliminates the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally.

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
- Delegate VCS operation orchestration to package-private modules (`branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`), each taking an injected runner — keeping the `GitContext` class thin and testable
- Expose the full `gh` issue, PR, label, and board operation surface as thin methods that delegate to pure command-builder + parser modules in `adws/gitContext/commands/`
- Accept an injectable `ExecFn` via `GitContextDeps` for hermetic testing (the ADW `Deps` idiom)
- Export only `GitContext` class and its public types via `adws/gitContext/index.ts` — no context-free git/`gh` free functions

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

## Migrated Call Sites (as of #662)

`workflowInit.ts`, `prPhase.ts`, `buildPhase.ts`, `documentPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `prReviewPhase.ts`, `takeoverHandler.ts`, and `webhookHandlers.ts` all construct a `GitContext` via the factory and delegate branch/commit/push/reset calls through context methods. Direct `execSync('git …')` / `execSync('gh …')` for these verbs no longer appear at those call sites.

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
| `pat?` | `string` | Optional PAT for `usePat` ops (PR approve, Projects V2 board) |

Optional injectable dependency bag via `GitContextDeps` (second constructor parameter):

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to thin `execSync` wrapper |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction. This is intentional: omitting it was the historical detonation point where ADW silently operated on the wrong repo.
- **`process.env` is never mutated on the operation hot path** — `commandEnv(process.env)` overlays the context's token + identity into a new object. The context token wins for context-routed commands; the parent slot is untouched.
- **`#run` accepts optional `{ cwd?, input?, usePat? }`** — `cwd` overrides the base path for VCS ops on worktrees; `input` pipes data to stdin; `usePat: true` injects `GITHUB_PAT` as `GH_TOKEN` for that one command only (approve PR, Projects V2 GraphQL). Never mutates `process.env`.
- **VCS wrappers in `adws/vcs/` are stripped, not deleted** — `branchOperations.ts`, `commitOperations.ts`, and `worktreeReset.ts` now expose only pure vocabulary functions. All I/O functions have migrated to `GitContext` methods.
- **`activeRepo`/`ensureAppAuthForRepo` are gone** — any code still calling `ensureAppAuthForRepo` will fail to compile. Use `gitContextForRepo(repoInfo).<method>()` instead.
- **`refreshTokenIfNeeded` is now repo-explicit** — it requires optional `(owner, repo)` args; the no-arg form that fell back to `activeRepo` is removed.
- **`gitContextFactory.ts` lives in `adws/github/`** — not in the reusable package, to keep the package free of ADW globals (`REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`, `getInstallationToken`). The factory is the ADW-layer bridge; the package itself is config-injection pure.
- **Board and approve ops require `GITHUB_PAT`** — `usePat: true` falls back to the context token when `GITHUB_PAT` is unset (user-owned repos degrade gracefully, matching prior behaviour from `feature-9tknkw`).
- **Branch sanitization regex** — `worktreePathFor` sanitizes with `/[/\\:*?"<>|`]/g → '-'`, matching the historical `worktreeOperations.ts` helper for path compatibility post-migration.
- **Injectable exec seam (`ExecFn` / `GitContextDeps`) is for tests, not config** — the seam exists so spy tests can assert per-call `{ cwd, env, input }` without spawning real processes. The default is a real `execSync` wrapper — the only real spawn site in the package.
- **`gitContextForSync` vs `gitContextFor`** — use `gitContextForSync` when you're already in a synchronous initialization path; use `gitContextFor` when you can `await`. Both produce identical `GitContext` instances; the async variant is a thin wrapper.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global dependency discipline; physical workspace extraction to `packages/git-context/` is deferred.
