# GitContext Package — Repo-Context Authority, Per-Command Env Injection & gh Operation Surface

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`) and an optional `pat` for PAT-requiring operations. Every `gh`/GitHub-API operation — issue read/comment, PR read/create/merge/approve, label lifecycle, and Projects V2 board transitions — is now a method on `GitContext`, running through the single private `#run()` chokepoint that injects per-command auth and git identity into the child process's environment without ever mutating `process.env`. The ADW bridge (`adws/github/gitContextFactory.ts`) constructs a context for any `RepoInfo` using the unchanged auth-acquisition path. This module forms the structural fix for the `GH_TOKEN`-bleed / wrong-repo-auth class of bugs across interleaved multi-repo activity.

## Responsibilities

- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including an omitted `selfHost` boolean discriminator)
- Resolve `basePath` once, in the constructor: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — never consulting `process.cwd()`
- Produce a per-command child-process environment overlay via `commandEnv(base?)`: fresh object with `GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` — never mutates `process.env` or the passed `base` object
- Execute every operation through the single private `#run(command, opts?)` chokepoint: spawns with `cwd = basePath`, `env = commandEnv(process.env)`, optional stdin `input`, and optional `usePat` flag (injects PAT as `GH_TOKEN` for that one command when `usePat: true` and `#pat` is set)
- Expose the full `gh` issue, PR, label, and board operation surface as thin methods that delegate to pure command-builder + parser modules in `adws/gitContext/commands/`
- Accept an injectable `ExecFn` via the optional `GitContextDeps` constructor parameter for hermetic testing
- Export all public types via `adws/gitContext/index.ts`

### Pure command modules (`adws/gitContext/commands/`)

Each module is side-effect-free (no `exec`, no `process.env`) and stays under 300 lines:

| Module | Exports |
|---|---|
| `issueCommands.ts` | Command builders + parsers for `gh issue …` / `gh api issues` (fetch, comment, state, close, title, comments, labels, create, update, find-upgrade, delete-comment) |
| `prCommands.ts` | PR builders + parsers (find by branch, fetch details/reviews/comments, comment, merge, approve, approval state, list, create) |
| `labelCommands.ts` | Label create and apply (create-if-missing + add) command builders |
| `boardCommands.ts` | Projects V2 GraphQL query/mutation builders + parsers (project id, issue item, status field, status update, `moveIssueToStatus`) |

### ADW bridge: `adws/github/gitContextFactory.ts`

- `gitContextForRepo(repoInfo, opts?)` — builds a `GitContext` for any `RepoInfo`; resolves token via: `getInstallationToken` (app configured) → `process.env.GH_TOKEN` → `gh auth token`. No caching (the underlying token cache handles freshness).
- `deriveGitIdentity()` — pure helper: derives `{authorName, authorEmail, committerName, committerEmail}` from `GITHUB_APP_ID`/`GITHUB_APP_SLUG`; falls back to local `git config user.name/email` or a hard-coded `ADW Bot` default.
- `clearSelfHostCache()` — test helper to reset the self-host identity cache between test runs.
- Lives in `adws/github/` (not inside the reusable package) so the package stays free of ADW globals.

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws `Error: GitContext: <field> must not be empty`
- Self-host identity (`selfHost: true`) → `basePath = frameworkRepoRoot`
- Target identity (`selfHost: false`) → `basePath = join(targetReposDir, owner, repo)`
- `commandEnv` never writes to `process.env`; each call returns a new object
- `#run` always passes an explicit `cwd` and an explicit `env` to the exec function — it never inherits the process working directory or relies on ambient `process.env.GH_TOKEN`
- When `usePat: true` and `#pat` is set, `GH_TOKEN` in the child env is the PAT; otherwise it is the context's primary token. The parent `process.env` is unchanged in both cases.
- Two contexts for two repos in one process never observe each other's `cwd` or token — the `GH_TOKEN` bleed is structurally impossible (no module-global `activeRepo` slot)
- The `activeRepo` module-global and `ensureAppAuthForRepo` were deleted from `githubAppAuth.ts` in this slice; all `gh` ops authenticate via the context's per-command child env
- The module imports nothing from `adws/core`, `adws/providers`, or any ADW global — all config is injected at construction

## Configuration

All configuration is injected at construction via `GitContextOptions`:

| Field | Type | Description |
|---|---|---|
| `owner` | `string` | GitHub owner (org or user) |
| `repo` | `string` | Repository name |
| `selfHost` | `boolean` | `true` = ADW's own repo, `false` = target repo |
| `token` | `string` | Primary token (app installation or PAT) |
| `gitIdentity` | `GitIdentity` | Author + committer name/email |
| `frameworkRepoRoot` | `string` | Absolute path to ADW framework repo root (`REPO_ROOT`) |
| `targetReposDir` | `string` | Absolute path to cloned target repos dir (`TARGET_REPOS_DIR`) |
| `pat?` | `string` | Optional PAT for `usePat` ops (PR approve, Projects V2 board) |

Optional injectable dependency bag via `GitContextDeps` (second constructor parameter):

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to thin `execSync` wrapper |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction. This was the historical detonation point where ADW silently operated on the wrong repo.
- **`#run` accepts optional `{ input?, usePat? }`** — `input` pipes data to stdin (used for `--body-file -` style ops); `usePat: true` injects `GITHUB_PAT` as `GH_TOKEN` for that one command only (approve PR, Projects V2 GraphQL). Never mutates `process.env`.
- **Transitional boundary provisioning shim** — `activateGitHubAppAuth`'s `process.env.GH_TOKEN`/`GIT_*` assignment is retained for the not-yet-migrated consumers (`vcs/*` git push/fetch ops, Claude agent subprocess `getSafeSubprocessEnv`). All `gh` ops now route through the context and are fully isolated; the shim is removable once sibling slices #661/#662 land.
- **`activeRepo`/`ensureAppAuthForRepo` are gone** — any code still calling `ensureAppAuthForRepo` will fail to compile. Use `gitContextForRepo(repoInfo).<method>()` instead.
- **`refreshTokenIfNeeded` is now repo-explicit** — it requires `(owner, repo)` args; the no-arg form that fell back to `activeRepo` is removed.
- **`gitContextFactory.ts` lives in `adws/github/`** — not in the reusable package, to keep the package free of ADW globals (`REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`, `getInstallationToken`). The factory is the ADW-layer bridge; the package itself is config-injection pure.
- **Board and approve ops require `GITHUB_PAT`** — `usePat: true` falls back to the context token when `GITHUB_PAT` is unset (user-owned repos degrade gracefully, matching prior behaviour from `feature-9tknkw`).
- **Injectable exec seam (`ExecFn`/`GitContextDeps`) is for tests** — the seam lets spy tests assert per-call `{ cwd, env, input }` without spawning real processes. The default is a real `execSync` wrapper — the single real spawn site in the package.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global dependency discipline; physical workspace extraction is deferred.
