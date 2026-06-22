# GitContext Package — Repo-Context Authority & Per-Command Env Injection

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`). Base-path resolution happens once in the constructor; every operation method spawns its underlying git/`gh` command through a single private chokepoint that supplies an explicit `cwd` and a fresh per-command child-process environment — never mutating `process.env`. This is the foundational slice of the GitContext PRD (`specs/prd/git-context-repo-authority.md`) and exists to make the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally unrepresentable.

## Responsibilities

- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including an omitted `selfHost` boolean discriminator)
- Resolve `basePath` once, in the constructor's single private `resolveBasePath` helper: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — never consulting `process.cwd()`
- Produce a per-command child-process environment overlay via `commandEnv(base?)`: returns a fresh object with `GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` without mutating `process.env` or the passed `base` object
- Execute every operation through the single private `#run(command)` chokepoint: spawns with `cwd = basePath` and `env = commandEnv(process.env)` — the only spawn site in the package
- Expose `defaultBranch()` as the first representative operation proving the spawn-with-env path end to end (identity-driven `gh repo view <owner>/<repo>`, explicit cwd + per-command env)
- Accept an injectable `ExecFn` via the optional `GitContextDeps` constructor parameter for hermetic testing (the ADW `Deps` idiom)
- Export only `GitContext` class and its public types (`GitIdentity`, `GitContextOptions`, `ExecFn`, `GitContextDeps`) via a barrel `index.ts` — no context-free git/`gh` free functions

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws `Error: GitContext: <field> must not be empty` (or variant)
- Self-host identity (`selfHost: true`) always resolves `basePath` to the injected `frameworkRepoRoot`
- Target identity (`selfHost: false`) always resolves `basePath` to `join(targetReposDir, owner, repo)` — mirroring `core/targetRepoManager.ts`'s `getTargetRepoWorkspacePath`
- `worktreePathFor` result is determined solely by `basePath` and the branch name — changing `process.cwd()` has no effect
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
- `#run` always passes an explicit `cwd` and an explicit `env` to the exec function — it never inherits the process working directory or relies on ambient `process.env.GH_TOKEN`
- Parent `process.env` is unchanged after any operation method runs — `GH_TOKEN` and all `GIT_*` vars are injected only into the child process's environment
- Two contexts for two repos in one process never observe each other's `cwd` or token — the `GH_TOKEN` bleed is structurally impossible (no module-global `activeRepo` slot)
- Two `GitContext` instances with the same `owner/repo` but different `selfHost` values resolve distinct `basePath` values
- The module imports nothing from `adws/core`, `adws/providers`, or any ADW global — all config is injected at construction

## Configuration

All configuration is injected at construction via `GitContextOptions`:

| Field | Type | Description |
|---|---|---|
| `owner` | `string` | GitHub owner (org or user) |
| `repo` | `string` | Repository name |
| `selfHost` | `boolean` | `true` = ADW's own repo, `false` = target repo |
| `token` | `string` | Personal access or GitHub App installation token |
| `gitIdentity` | `GitIdentity` | Author + committer name/email for git operations |
| `frameworkRepoRoot` | `string` | Absolute path to the ADW framework repo root (caller injects `environment.ts`'s `REPO_ROOT`) |
| `targetReposDir` | `string` | Absolute path to cloned target repos directory (caller injects `environment.ts`'s `TARGET_REPOS_DIR`) |

Optional injectable dependency bag via `GitContextDeps` (second constructor parameter, defaults to `{}`):

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to a thin `execSync` wrapper |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction, not silently defaults. This is intentional: omitting it was the historical detonation point where ADW silently operated on the wrong repo.
- **`process.env` is never mutated on the operation hot path** — `commandEnv(process.env)` reads the parent env and overlays the context's token + identity into a new object. If a stale `GH_TOKEN` is already set in `process.env` by the legacy `githubAppAuth.ts` path, the context token wins for context-routed commands, and the parent slot is untouched.
- **Legacy `githubAppAuth.ts` is not replaced yet** — many existing `execSync('gh …')` call sites still read `process.env.GH_TOKEN`. `GitContext` operations don't participate in that global mutation; wholesale migration of call sites is later-slice work per the PRD's staged operation surface.
- **Full git/`gh` operation surface is out of scope for these slices** — `worktreePathFor`, `commandEnv`, and `defaultBranch` are the current methods. Actual worktree create/remove/reset/list, branch, commit/push, issue/PR operations are planned for later slices.
- **Existing call sites are not yet migrated** — `vcs/worktreeOperations.ts`'s `getWorktreePath(branch, baseRepoPath?)` optional-default path still exists and is used by current callers. Migration is a separate slice.
- **Branch sanitization regex** — `worktreePathFor` sanitizes with `/[/\\:*?"<>|`]/g → '-'`, identical to `worktreeOperations.ts`'s private helper, so worktree paths remain compatible post-migration.
- **Injectable exec seam (`ExecFn` / `GitContextDeps`) is for tests, not config** — the seam exists so spy tests can assert per-call `{ cwd, env }` without spawning real processes and without `vi.mock('child_process')` fragility (the same `Deps` idiom used by `JanitorDeps`, `MergeDeps`, `ReconcileDeps`). The default is a real `execSync` wrapper — the single real spawn site in the package.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global dependency discipline; physical workspace extraction to `packages/git-context/` is deferred.
