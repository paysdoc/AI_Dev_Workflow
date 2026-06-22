# GitContext Boundary Constructor — Launch-Boundary Adapter and Wiring

## Overview

`adws/core/launchGitContext.ts` is the thin ADW adapter that constructs exactly one `GitContext` at each process launch boundary from that boundary's authoritative launch identity, and threads it downward through phases and agents. It eliminates the "wrong-base-repo" class of bug on the cron takeover and merge orchestrator paths — where ambient `process.cwd()` previously caused the cron to compute an abandoned workflow's worktree under the framework repo root instead of the target repo root (`spawnSync ENOENT` incident, vestmatic #187).

## Responsibilities

- Export `buildLaunchGitContext(targetRepo, deps?)` — the single call sites call at their launch boundary (cron module-scope guard, `adwMerge.main()`, `initializeWorkflow`)
- Discriminate target vs. self-host from `--target-repo` presence (mirroring `buildRepoIdentifier`): `targetRepo !== null` → target context (`basePath = join(TARGET_REPOS_DIR, owner, repo)`); `null` → self-host (`basePath = REPO_ROOT`, identity from `getRepoInfo()`)
- Resolve a non-empty `token` via `resolveLaunchToken`: App installation token → `GITHUB_PAT` → `gh auth token` → `GH_TOKEN`; throws loudly if none found
- Resolve a complete `gitIdentity` via `resolveLaunchGitIdentity`: App bot identity → `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars → `git config user.name/email` → built-in `ADW Bot` default (never returns empty fields)
- Ensure process-global auth via `ensureAppAuthForRepo` (idempotent; no-op when App not configured) to cover not-yet-migrated `gh` call sites
- Expose `LaunchGitContextDeps` for full dependency injection in tests (no real I/O in the injected path)
- Wire the constructed `GitContext` into `trigger_cron.ts` (module-scope, under entry-script guard), `takeoverHandler.ts` (`EvaluateCandidateInput.gitContext`), `workflowInit.ts` (`WorkflowConfig.gitContext`), and `adwMerge.tsx` (via `basePath`)

## Contracts & Invariants

- Constructed exactly once per process under the entry-script guard (cron) or `main()`/`initializeWorkflow` (others) — never reconstructed downstream
- `buildLaunchGitContext(null)` always resolves `basePath` to `REPO_ROOT` (self-host); `buildLaunchGitContext(targetRepo)` always resolves to `join(TARGET_REPOS_DIR, owner, repo)`
- If `--target-repo` is present and points to the framework repo itself, it is treated as a TARGET context (discriminator is presence, not identity) — consistent with `buildRepoIdentifier`
- Empty or unresolvable token throws `Error: launchGitContext: could not resolve a GitHub token for <owner>/<repo>` — never silently proceeds with an empty token
- The `gitContext` package (`adws/gitContext/`) imports nothing from `adws/core`, `adws/github`, or any ADW global; all ADW wiring is in this adapter in `adws/core/`
- Cron module-scope context construction is guarded by `process.argv[1]?.includes('trigger_cron')` so importing the module in BDD step definitions does not construct or throw
- `WorkflowConfig.gitContext` is optional to avoid breaking existing phase-test fixtures; always present for new orchestrators

## Configuration

All I/O seams are injectable via `LaunchGitContextDeps`:

| Dep | Default | Purpose |
|---|---|---|
| `getRepoInfo` | `getRepoInfo()` from `../github` | Self-host identity from local git remote |
| `resolveToken` | `resolveLaunchToken` | Non-empty GitHub token |
| `resolveGitIdentity` | `resolveLaunchGitIdentity` | Complete git author/committer |
| `frameworkRepoRoot` | `REPO_ROOT` from `core/environment.ts` | ADW framework root (self-host base) |
| `targetReposDir` | `TARGET_REPOS_DIR` from `core/environment.ts` | Parent dir for cloned target repos |

## Gotchas

- **Per-command auth cutover is out of scope** — this slice makes the context carry `token` and `gitIdentity`; removing the process-global `GH_TOKEN` mutation in favor of `commandEnv` injection at every call site is a later PRD slice (story 7). `activateGitHubAppAuth`/`ensureAppAuthForRepo` remain on the hot path for not-yet-migrated `gh` calls.
- **`takeoverHandler.resolveWorktreePath` falls back to `d.getWorktreePath`** for legacy callers without a context; this is intentional (backward compat) and the fallback is only reached when `EvaluateCandidateInput.gitContext` is absent.
- **`initializeWorkflow` construction is non-fatal** — if `buildLaunchGitContext` throws in a test fixture with a fake git remote, `gitContext` remains `undefined` and phases that require it must check; this is a deliberate guard against breaking existing phase-test fixtures.
- **`adwMerge.tsx`** still calls `ensureTargetRepoWorkspace(targetRepo)` for the clone/fetch side effect on target repos; the authoritative base path switches to `gitContext.basePath` but the side-effect call is preserved.
- **Full git/`gh` operation surface remains out of scope** — only `basePath`, `worktreePathFor`, and `commandEnv` from the `GitContext` are used in this slice; migrating every phase's individual git/`gh` call onto context methods is planned for later slices (stories 16/17/18).
- **`getWorktreePath(branch, baseRepoPath?)` optional-default is intentionally left in place** for unmigrated callers; removing it entirely is the cleanup after all callers route through the context.
