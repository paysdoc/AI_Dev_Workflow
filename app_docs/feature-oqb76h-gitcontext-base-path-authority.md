# GitContext Package — Base-Path Authority

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`), and resolves a `basePath` in exactly one place — the constructor — with no optional base-path parameter and no `cwd` fallback. The module is the foundational slice of the GitContext PRD (`specs/prd/git-context-repo-authority.md`) and exists to make the historical "wrong-repo worktree" class of bug structurally unrepresentable.

## Responsibilities

- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including an omitted `selfHost` boolean discriminator)
- Resolve `basePath` once, in the constructor's single private `resolveBasePath` helper: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — never consulting `process.cwd()`
- Produce a per-command child-process environment overlay via `commandEnv(base?)`: returns a fresh object with `GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` without mutating `process.env` or the passed `base` object
- Export only `GitContext` class and its public types (`GitIdentity`, `GitContextOptions`) via a barrel `index.ts` — no context-free git/`gh` free functions

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws `Error: GitContext: <field> must not be empty` (or variant)
- Self-host identity (`selfHost: true`) always resolves `basePath` to the injected `frameworkRepoRoot`
- Target identity (`selfHost: false`) always resolves `basePath` to `join(targetReposDir, owner, repo)` — mirroring `core/targetRepoManager.ts`'s `getTargetRepoWorkspacePath`
- `worktreePathFor` result is determined solely by `basePath` and the branch name — changing `process.cwd()` has no effect
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
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

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction, not silently defaults. This is intentional: omitting it was the historical detonation point where ADW silently operated on the wrong repo.
- **Full git/`gh` operation surface is out of scope for this slice** — `worktreePathFor` and `commandEnv` are the only resolution methods. Actual worktree creation/removal/reset/list, branch, commit/push, issue/PR operations are planned for later slices.
- **Existing call sites are not yet migrated** — `vcs/worktreeOperations.ts`'s `getWorktreePath(branch, baseRepoPath?)` optional-default path still exists and is used by current callers. Migration is a separate slice.
- **Branch sanitization regex** — `worktreePathFor` sanitizes with `/[/\\:*?"<>|`]/g → '-'`, identical to `worktreeOperations.ts`'s private helper, so worktree paths remain compatible post-migration.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global dependency discipline; physical workspace extraction to `packages/git-context/` is deferred.
