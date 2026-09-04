# GitContext Boundary Constructor — Launch-Boundary Adapter and Provider Minting

## Overview

`adws/core/launchGitContext.ts` is the single sanctioned construction site for both a process's `GitContext` and its bound provider instances (`IssueTracker` / `CodeHost` / `BoardManager`). `buildLaunchBoundary(targetRepo, deps)` resolves `{owner, repo}` exactly once and hands that one identity to both artefacts in the same call, so no downstream code path can address a different repository than the one the process was launched for. It eliminates the "wrong-base-repo" class of bug on the cron takeover and merge orchestrator paths (`spawnSync ENOENT` incident, vestmatic #187) and closes the "identity derived twice" variant of the same class (#794).

## Responsibilities

- Export `buildLaunchBoundary(targetRepo, deps?)` — returns a frozen `LaunchBoundary { gitContext, repoId, providers }`; the boundary call sites (cron module-scope guard, `adwMerge.main()`, `initializeWorkflow`) construct exactly one of these per process
- Export `buildLaunchGitContext(targetRepo, deps?)` — the context-only view, now defined as `buildLaunchBoundary(targetRepo, deps).gitContext`; unchanged behaviour and signature for its six existing call sites (`trigger_webhook.ts`, `promotionSweep.ts`, etc.)
- Discriminate target vs. self-host from `--target-repo` presence (mirroring `buildRepoIdentifier`): `targetRepo !== null` → target context (`basePath = join(TARGET_REPOS_DIR, owner, repo)`); `null` → self-host (`basePath = REPO_ROOT`, identity from `getRepoInfo()`, consulted at most once)
- Resolve a non-empty `token` via `resolveLaunchToken` and a complete `gitIdentity` via `resolveLaunchGitIdentity`, exactly as before
- Mint `providers: BoundProviders` bound to the boundary's `repoId`, deferred to first access and memoised (`freezeBoundary`'s getter) — building a context alone performs no provider-config read and gains no new failure mode
- Read provider selection from `.adw/providers.md` at `gitContext.basePath` (identity-derived, never `process.cwd()` or a caller-supplied `cwd`) via `loadProviderConfig`, then mint through `mintBoundProviders` (`adws/providers/repoContext.ts`) — both imported via deep module paths, never the `../providers` barrel (would close an import cycle)
- Expose `LaunchGitContextDeps` for full dependency injection in tests, extended with `platform?`, `loadProviderConfig?`, and `mintProviders?` seams (all optional, production defaults applied)
- Re-export `buildLaunchBoundary` and `type LaunchBoundary` from `adws/core/index.ts` alongside `buildLaunchGitContext`
- Wire the boundary into `trigger_cron.ts` (module-scope `cronBoundary`, under the entry-script guard; `getCronProviders()` exposes the minted triple for future semantic-caller migration), `adwMerge.tsx` (single boundary call replaces the former `buildLaunchGitContext` + `buildRepoIdentifier` double-derivation), and `workflowInit.ts` (`boundary?.gitContext`, and `providers: boundary.providers` passed into `createRepoContext` when the resolved `repoId` matches the boundary via `sameRepoIdentity`)
- Export `bindWorkspaceContext(boundary, cwd, repoId?)` — binds the boundary's already-minted providers to a validated workspace directory: `createRepoContext({ repoId, cwd, providers: boundary.providers })`, the same cwd/`origin` validation `createRepoContext` always performs. `repoId` defaults to the boundary's own identity; a caller-supplied `repoId` that does not match the boundary (via `sameRepoIdentity`) is refused with a thrown error rather than silently handed providers bound to the wrong repository. `workflowInit.ts` and `prReviewPhase.ts` call this instead of calling `createRepoContext` directly for their worktree-scoped work, so those two files' remaining `gitContextForSync`/`gitContextFor` construction sites are for git-context-only concerns, not provider/RepoContext construction

## Contracts & Invariants

- One boundary call yields a `GitContext` and providers bound to identical `{owner, repo}` — `repoId.owner/repo` always equal `gitContext.owner/repo`, and `providers.codeHost.getRepoIdentifier()` always deep-equals `repoId`; there is no second call to the identity source reachable from the provider path
- `LaunchBoundary` is frozen (`Object.freeze` in `freezeBoundary`) — callers cannot re-point it at another repository after construction
- `boundary.providers` is a memoised getter: the first access mints and caches; every subsequent access returns the identical triple (no double-minted board manager, no duplicated per-instance state)
- Provider *selection* is unchanged and still config-driven: explicit platforms → `providersConfig` → `loadProviderConfig(dir)`, defaulting to GitHub when `.adw/providers.md` is absent. A platform with no implementation is refused **by name** (never substituted with GitHub); under deferred minting the refusal surfaces on the first provider request, not at boundary-construction time
- Constructed exactly once per process under the entry-script guard (cron) or `main()`/`initializeWorkflow` (others) — never reconstructed downstream
- `buildLaunchGitContext(null)` always resolves `basePath` to `REPO_ROOT` (self-host); `buildLaunchGitContext(targetRepo)` always resolves to `join(TARGET_REPOS_DIR, owner, repo)`
- If `--target-repo` is present and points to the framework repo itself, it is treated as a TARGET context (discriminator is presence, not identity) — consistent with `buildRepoIdentifier`
- `bindWorkspaceContext` throws `Error: bindWorkspaceContext: <owner>/<repo> does not match the launch boundary's <owner>/<repo>` when the supplied `repoId` disagrees with `boundary.repoId` (case-insensitive comparison via `sameRepoIdentity`) — it never mints a fresh provider triple for the mismatched identity, it only refuses
- Empty or unresolvable token throws `Error: launchGitContext: could not resolve a GitHub token for <owner>/<repo>` — never silently proceeds with an empty token
- The `gitContext` package (`adws/gitContext/`) imports nothing from `adws/core`, `adws/github`, or any ADW global; all ADW wiring is in this adapter in `adws/core/`
- Cron module-scope boundary construction is guarded by `process.argv[1]?.includes('trigger_cron')` so importing the module in BDD step definitions does not construct or throw
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
| `platform` | `Platform.GitHub` | Declared identity platform on the boundary's `RepoIdentifier` |
| `loadProviderConfig` | `loadProviderConfig` from `../providers/repoContext` | Reads `.adw/providers.md` at `gitContext.basePath` |
| `mintProviders` | `mintBoundProviders` from `../providers/repoContext` | Mints the frozen `BoundProviders` triple bound to `repoId` |

## Gotchas

- **Deferred minting is deliberate, not incidental.** Eager minting would read `.adw/providers.md` before `ensureTargetRepoWorkspace` has cloned the target workspace — risking a silent GitHub-default selection for a not-yet-cloned GitLab repo — and would turn a malformed config into a cron that fails to start at module load. The memo getter defers both the config read and the mint call to first `boundary.providers` access; identity is still fixed at the call because the closure captures the boundary's `repoId`.
- **`buildLaunchGitContext` is total.** It must succeed even when an injected `loadProviderConfig`/`mintProviders` seam throws, because it never touches `boundary.providers` — this is what keeps the cron/webhook/`promotionSweep` startup path free of a new failure mode.
- **`createRepoContext` (`adws/providers/repoContext.ts`) reuses boundary providers, it doesn't re-derive them** — `bindWorkspaceContext` passes `providers: boundary.providers` straight through, so `mintBoundProviders` is skipped entirely; `createRepoContext` still runs `validateRepoIdentifier`/`validateWorkingDirectory`/`validateGitRemote` regardless of whether providers were supplied or freshly minted.
- **A caller-supplied `repoId` that disagrees with the boundary is never handed boundary providers** — `bindWorkspaceContext` throws instead of silently falling back; a caller that legitimately needs a different repository's context (e.g. `initializeWorkflow(options.repoId)` on the upgrade path) must not route that identity through `bindWorkspaceContext` at all.
- **Per-command auth cutover is out of scope** — this module makes the context carry `token` and `gitIdentity`; removing the process-global `GH_TOKEN` mutation in favor of `commandEnv` injection at every call site is a later PRD slice (story 7). `activateGitHubAppAuth`/`ensureAppAuthForRepo` remain on the hot path for not-yet-migrated `gh` calls.
- **`takeoverHandler.resolveWorktreePath` falls back to `d.getWorktreePath`** for legacy callers without a context; this is intentional (backward compat) and the fallback is only reached when `EvaluateCandidateInput.gitContext` is absent.
- **`initializeWorkflow` construction is non-fatal** — if `buildLaunchBoundary` throws in a test fixture with a fake git remote, `gitContext` remains `undefined` and phases that require it must check; this is a deliberate guard against breaking existing phase-test fixtures.
- **`adwMerge.tsx`** derives both `gitContext` and `repoId` from one `buildLaunchBoundary` call and no longer calls `buildRepoIdentifier`; that function remains exported for its four other callers (`adwSdlc`, `adwBuild`, `adwPlanBuildTest`, `adwPlanBuildReview`, `adwUpgrade`). It still calls `ensureTargetRepoWorkspace(targetRepo)` for the clone/fetch side effect on target repos.
- **`getCronProviders()` is a deliberate handoff seam, not a migration** — cron has no provider-shaped call site yet (its `listOpenIssues`/`remoteUrl` calls are `GitContext` semantics migrated separately); the accessor exists so a later slice can consume `cronBoundary`'s minted triple without re-deriving identity.
- **Provider factories still construct their own internal `GitContext`** (`githubBoardManager.ts`, `githubCodeHost.ts`) — threading the boundary's context *into* minted providers is out of scope here; it changes which credential and cwd class every provider call uses and belongs to a later migration slice.
- **Full git/`gh` operation surface remains out of scope** — only `basePath`, `worktreePathFor`, and `commandEnv` from the `GitContext` are used at this layer; migrating every phase's individual git/`gh` call onto context methods is planned for later slices.
- **`getWorktreePath(branch, baseRepoPath?)` optional-default is intentionally left in place** for unmigrated callers; removing it entirely is the cleanup after all callers route through the context.
