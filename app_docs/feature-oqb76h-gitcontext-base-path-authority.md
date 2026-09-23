# Launch Boundary, Forge Wiring, Identity Cross-Check & the Git/GH CLI Guard

## Overview

The git core (`GitContext`) and the forge provider layer (`IssueTracker`/`CodeHost`/`BoardManager` ports, the GitHub/GitLab/Jira adapters, `forgeProviders()`) live in the external `@paysdoc/devplatform` npm package, consumed via three entry points: the package root (forge ports + domain model), `@paysdoc/devplatform/providers` (`forgeProviders()` and the adapters), and `@paysdoc/devplatform/git` (the `GitContext` class and git core). This module documents ADW's own wiring on top of that library: `adws/core/launchGitContext.ts` is the single sanctioned site that constructs one `GitContext` and mints the bound provider triple per process; `adws/core/forgeWiring.ts`, `adws/core/providerConfig.ts`, `adws/core/localRepoIdentity.ts`, `adws/core/githubAppAuth.ts`, and `adws/core/workspaceBinding.ts` are the ADW-owned seams around it; `adws/core/repoIdentityCrossCheck.ts` detects wrong-repo divergence on resume; `adws/checkGitGhGuard.ts` (+ `adws/guard/`) is the CI-enforced guard that makes every other construction path structurally unrepresentable. Together these are what eliminated the historical "wrong-repo worktree" and `GH_TOKEN`-bleed bug classes structurally rather than by convention.

## Responsibilities

### `adws/core/launchGitContext.ts` — the launch boundary

- Export `buildLaunchBoundary(targetRepo, deps?)` — returns a `LaunchBoundary { readonly gitContext, readonly repoId, readonly providers }`; resolves `{owner, repo}` exactly once and hands that identity to both the `GitContext` (imported from `@paysdoc/devplatform/git`) and the minted provider triple. Boundary call sites (cron module-scope guard, `adwMerge.main()`, `initializeWorkflow`) construct exactly one of these per process
- Export `buildLaunchGitContext(targetRepo, deps?)` — the context-only view, `buildLaunchBoundary(...).gitContext`
- Discriminate target vs. self-host from `--target-repo` presence: non-null → target context (`basePath = join(TARGET_REPOS_DIR, owner, repo)`); null → self-host (`basePath = REPO_ROOT`, identity from the default `getRepoInfo`, `readLocalRepoIdentity`)
- Assemble `providers: BoundProviders` bound to the boundary's `repoId`, deferred to first access and memoised — building a context alone performs no provider-config read. Provider forge selection reads `.adw/providers.md` at `gitContext.basePath` (never `process.cwd()`) via `loadProviderConfig` (`adws/core/providerConfig.ts`), then assembles through the library's `forgeProviders()` (`@paysdoc/devplatform/providers`), fed ADW's own wiring via `deps.forgeDeps` (default `buildAdwForgeDeps`, `adws/core/forgeWiring.ts`) and `deps.forgeCredentials` (default `createForgeCredentials`, also from the library)
- `LaunchGitContextDeps` exposes every seam as an optional injection point: `getRepoInfo`, `resolveToken`, `tokenProvider`, `resolveGitIdentity`, `frameworkRepoRoot`, `targetReposDir`, `platform`, `loadProviderConfig`, `forgeProviders`, `forgeDeps`, `forgeCredentials`
- Wire the boundary into `trigger_cron.ts` (module-scope `cronBoundary` under the entry-script guard; `getCronProviders()` exposes the minted triple), `adwMerge.tsx`, and `workflowInit.ts`

### `adws/core/localRepoIdentity.ts` — host-neutral identity read

- Export `readLocalRepoIdentity(cwd?, deps?): RepoIdentifier` — reads the origin remote via `readOriginRemoteUrl` (`@paysdoc/devplatform/git`), normalizes an `ssh://[user@]host/owner/repo` URL to SCP form before parsing, resolves `owner`/`repo` via `parseOwnerRepoFromUrl` (`@paysdoc/devplatform/providers`), and always stamps `platform: Platform.GitHub` by ADW's launch-identity convention. This is `launchGitContext.ts`'s default `getRepoInfo`

### `adws/core/githubAppAuth.ts` — the App-auth env wrapper

- The one place ADW reads `GITHUB_APP_ID`/`GITHUB_APP_SLUG`/`GITHUB_APP_PRIVATE_KEY_PATH` from `process.env` (read fresh on every call — the library itself must never read the host's environment)
- Export `readGitHubAppConfig(): GitHubAppConfig`, `isGitHubAppConfigured(): boolean`, `getInstallationToken(owner, repo): string` — thin wrappers over the library's `@paysdoc/devplatform/providers` App-auth adapter, fed the env-read config

### `adws/core/providerConfig.ts` — `.adw/providers.md` reader

- Export `loadProviderConfig(cwd): ProviderConfig` — reads `.adw/providers.md` at the given path, defaulting to `{codeHost: 'github', issueTracker: 'github'}` when the file or a section is absent
- Export `parseCodeHostForge(value, section)` / `parseIssueTrackerForge(value, section)` — validate a forge name against the library's `CODE_HOST_FORGES`/`ISSUE_TRACKER_FORGES` sets (`@paysdoc/devplatform/providers`), refusing by name (not throwing a generic parse error) when the value doesn't match

### `adws/core/issueRecord.ts`

- Export `fetchIssueRecord(issueTracker: Pick<IssueTracker, 'fetchIssue'>, issueNumber): Promise<Issue>` — a thin delegation to the boundary's `IssueTracker.fetchIssue`; no additional error wrap (the forge adapters already throw a descriptive error)

### `adws/core/forgeWiring.ts` — ADW's forge wiring

- Export `gitLabConfigFromEnv(env?)` / `jiraAuthFromEnv(env?)` — environment→config reads the GitLab/Jira adapters need, over an injectable `ForgeEnv` (bound to `adws/core/environment.ts`'s constants by default); `jiraConfigFrom(config, env?)` assembles a full `JiraConfig` from `.adw/providers.md`'s `## Issue Tracker URL`/`## Issue Tracker Project Key` plus `jiraAuthFromEnv()`, refusing by name when a section is missing
- Export `adwGitHubForgeDeps(repoId, resolvePorts)` — the HITL Slack ping on a move to `BoardStatus.Review` (over `buildNotifierDeps(resolvePorts, repoId)`), the `adw:*` lazy-create label catalogue (`resolveAdwLabelDefinition`), and the PR-approval capability predicate (`isGitHubAppConfigured() && Boolean(GITHUB_PAT)`) — the three ADW-shaped seams `forgeProviders` never learns about on its own. `resolvePorts: () => NotifierPorts` is a THUNK, not the ports themselves: this function runs inside the launch boundary's lazy provider mint, before `forgeProviders` has returned, so the notifier resolves the ports later, at notification time
- Export `buildAdwForgeDeps(config, repoId, resolveProviders)` — the full `ForgeProviderDeps` (`@paysdoc/devplatform/providers`) a launch boundary needs: `{ logger: log, github: adwGitHubForgeDeps(repoId, resolveProviders), gitlab: config.codeHost === 'gitlab' ? gitLabConfigFromEnv() : undefined, jira: config.issueTracker === 'jira' ? jiraConfigFrom(config) : undefined }` — the environment is read only for a forge actually selected
- Deep-imports `@paysdoc/devplatform/providers` types directly (never through `adws/core`'s own barrel) to avoid an import cycle back through the module that consumes this one

### `adws/core/workspaceBinding.ts` — workspace binding over the caller's own context

- Export `validateGitRemote(ctx: Pick<GitContext, 'remoteUrl'>, cwd, repoId)` — reads the workspace's `origin` remote through the GIVEN context (never a second, differently-credentialed one constructed for the check), parses it with `parseOwnerRepoFromUrl` (`@paysdoc/devplatform/providers`), and cross-checks it against the declared identity (case-insensitive owner/repo comparison)
- Export `bindWorkspaceContext(boundary, cwd, repoId?)` — binds the boundary's already-minted providers to a validated workspace directory: the `sameRepoIdentity` refusal first (a caller-supplied `repoId` that disagrees with the boundary is refused before `boundary.providers` is ever touched), then `validateRepoIdentifier`/`validateWorkingDirectory` (`@paysdoc/devplatform`/`@paysdoc/devplatform/providers`)/`validateGitRemote`, then a frozen `{ ...boundary.providers, cwd, repoId }` — reusing the boundary's own provider instances, never re-deriving them

### `adws/core/repoIdentityCrossCheck.ts` — resume-time identity persistence

- Export `RepoIdentityMismatchError` — a typed, catchable error naming both the launch and persisted identities, thrown at startup before any worktree or `gh` mutation
- Export `crossCheckRepoIdentity(launch, persisted?)` — no-op when `persisted` is `undefined` (old state) or when identities match case-insensitively; throws on genuine divergence
- Export `sameRepoIdentity(a, b)` — case-insensitive equality over `owner` + `repo`
- Define `RepoIdentity` (`{owner, repo}`) as an optional field on `AgentState`, keeping old state files valid without backfill
- Wire persistence + cross-check into `initializeWorkflow` (`adws/phases/workflowInit.ts`): read prior top-level state → cross-check → unconditionally write the launch identity into `AgentState.repoIdentity`

### `adws/checkGitGhGuard.ts` + `adws/guard/` — the CI guard

- Walk all `.ts`/`.tsx` source files (excluding `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`, and `*.test.ts`/`__tests__/**`), parsing each with the TypeScript compiler API (AST-based — comment text is never a false positive). `EXEMPT_PACKAGES` is deliberately an **empty array** — the git core and the GitHub forge adapter now live outside this repo entirely, so no in-repo package may shell out to `git`/`gh` at all, and nothing may ever be added back to this set
- **`git-gh-shellout`** (in `checkGitGhGuard.ts`): flags a call expression whose first argument is a string/template literal matching `/^(git|gh)(\s|$)/` — catches `execSync`, `execWithRetry`, `execFileSync`, injected callback forms, regardless of callee name
- **`cwd-derived-identity`** (`adws/guard/identityRule.ts`): two-pass per file — collects local variables initialised from a zero-argument call to one of `CWD_DERIVED_IDENTITY_FNS` (`getRepoInfo`, `readLocalRepoInfo`, `readLocalRepoIdentity`), then flags any `gitContextForRepo(…)`/`forgeProviders({identity: …})` call (`CONTEXT_CONSTRUCTOR_NAMES`) whose identity argument is either an inline zero-arg read of one of those or a collected identifier. A guarded fallback (`x ?? getRepoInfo()`) is a `BinaryExpression` initializer and is never collected. `isIdentityReadComposite(node)` is the sole adjudicator of a construction fed a direct identity-read call (`gitContextForRepo(readLocalRepoIdentity(root))`): a zero-arg read fails, an explicit-root read passes; `constructionRule.ts` defers to that verdict instead of flagging the composite itself
- **`unsanctioned-construction`** (`adws/guard/constructionRule.ts`): a file-scoped allowlist (`SANCTIONED_CONSTRUCTION_SITES`) short-circuits sanctioned files to zero violations; everywhere else flags a bare-identifier `new GitContext(…)` or a bare-identifier call to any name in `PROVIDER_CONSTRUCTORS` (`createGitHubIssueTracker`, `createGitHubCodeHost`, `createGitHubBoardManager`, `createGitLabCodeHost`, `createGitLabBoardManager`, `createJiraIssueTracker`, `createJiraBoardManager`) or `CONTEXT_CONSTRUCTORS` (`createRepoContext`, `mintBoundProviders`, `gitContextFor`, `gitContextForSync`, `gitContextForRepo`, `forgeProviders`) — every one of these names is now imported from `@paysdoc/devplatform/providers` or `@paysdoc/devplatform/git`, matched by identifier text rather than by declaration. Property-access callees (`deps.gitContextForRepo(…)`, `deps.forgeProviders(…)`) are an injected seam and are deliberately unflagged; function declarations are never flagged. A construction whose identity argument is a direct identity-read call defers to `identityRule.ts`'s `isIdentityReadComposite` rather than being flagged by callee name alone
- Run the self-cleaning ratchet: re-parse every scanned file through `hasGuardedConstruction` (ignores the allowlist) to find files that still construct something, then `findStaleSanctionedEntries(seenFiles)` — the one PERMANENT entry that fails the build if it ever stops constructing anything
- Exit `0` when no violations of any rule exist and no allowlist entry is stale; exit `1` otherwise with a `path:line [rule] command` listing and a per-rule remedy. Run as `bun run lint:git-guard` and as the sole step in `.github/workflows/git-cli-guard.yml` (`on: [pull_request, push]`)

## Contracts & Invariants

- `commandEnv`/`exec()` (inside the library's `GitContext`) never write to `process.env`; the credential is resolved through the `TokenProvider` port on every call, never cached — two `GitContext` instances for two repos never share a credential, so `GH_TOKEN` bleed is structurally impossible
- One `buildLaunchBoundary` call yields a `GitContext` and providers bound to identical `{owner, repo}` — `repoId.owner/repo` always equal `gitContext.owner/repo`; `LaunchBoundary` is frozen; `boundary.providers` is a memoised getter (first access mints and caches)
- `crossCheckRepoIdentity`: absent persisted identity is a no-op (first-ever write stamps identity going forward); case-only differences (`Acme/WebApp` vs `acme/webapp`) are equal and never throw; a genuine mismatch throws `RepoIdentityMismatchError` and is never caught in `initializeWorkflow` — fail-closed is correct
- The guard's `EXEMPT_PACKAGES` set is permanently empty — every `.ts`/`.tsx` file in the repo (outside tests) is scanned by all three rules; there is no structural exemption left to reintroduce
- The guard's stdout `(0 allowlisted)` capstone line and the sanctioned-construction-sites block are load-bearing observables for the BDD suite
- `SANCTIONED_CONSTRUCTION_SITES` has exactly one PERMANENT entry (`adws/core/launchGitContext.ts`) and no TRANSITIONAL half; nothing may ever be added to it — a new construction site must call `buildLaunchBoundary` instead

## Configuration

`LaunchGitContextDeps` (all optional, production defaults applied): `getRepoInfo`, `resolveToken`/`tokenProvider`, `resolveGitIdentity`, `frameworkRepoRoot`, `targetReposDir`, `platform` (default `Platform.GitHub`), `loadProviderConfig`, `forgeProviders` (default: the library's `forgeProviders`), `forgeDeps` (default: `buildAdwForgeDeps`), `forgeCredentials` (default: the library's `createForgeCredentials`).

Guard configuration lives in `adws/checkGitGhGuard.ts` (`EXEMPT_DIR_NAMES`, `EXEMPT_PACKAGES`) and `adws/guard/constructionRule.ts` (`SANCTIONED_CONSTRUCTION_SITES`); wired via `package.json`'s `lint:git-guard` script and `.github/workflows/git-cli-guard.yml`.

`@paysdoc/devplatform` is pinned to an exact version (no caret range) in `package.json`'s `dependencies`; version bumps are proposed by Dependabot and merged by hand.

## Gotchas

- **`process.env` is never mutated** by ADW's wiring layer on the operation hot path; `adws/core/githubAppAuth.ts` is the one place that reads `GITHUB_APP_*` from it, and it does so fresh on every call rather than caching.
- **`GitContext`, its executor/port types, worktree/workspace/claim ops, and `consoleLogger` all come from `@paysdoc/devplatform/git`** — none of it lives in this repo. Treat questions about base-path resolution, per-command credential injection, or the git core's internal module layout as belonging to the `paysdoc/devplatform` repo, not this one.
- **Deferred provider minting is deliberate** — eager minting would read `.adw/providers.md` before `ensureTargetRepoWorkspace` has cloned the target workspace, risking a silent GitHub-default selection for a not-yet-cloned GitLab repo, and would turn a malformed config into a cron that fails to start at module load.
- **`bindWorkspaceContext` (`adws/core/workspaceBinding.ts`) reuses boundary providers, it doesn't re-derive them** — it runs its own `validateRepoIdentifier`/`validateWorkingDirectory`/`validateGitRemote` regardless, with `validateGitRemote` reading the workspace's `origin` remote through the caller's OWN `GitContext` (never a second one built for the check).
- **The forge provider factories construct no `GitContext` of their own** — `forgeProviders`/`buildLaunchBoundary` thread the boundary's own context into all three (`ForgeProvidersOptions.gitContext` is required), so every `gh`/GitLab/Jira call a minted provider issues runs over the launch identity, one construction per process.
- **`gitContext` may be `undefined` in test fixtures** — `initializeWorkflow` wraps `buildLaunchGitContext` in a try/catch; when it throws, the launch identity falls back to `resolvedRepoForAuth`, and persistence/cross-check still function.
- **`SANCTIONED_CONSTRUCTION_SITES` has no TRANSITIONAL half left and never will again** — the allowlist is exactly one PERMANENT entry, file-scoped and exact-path-match only. A directory prefix is never sanctioned; a new construction site must call `buildLaunchBoundary`, not join the allowlist.
- **`CWD_DERIVED_IDENTITY_FNS` (`identityRule.ts`) is a name-based match, not a file reference** — `getRepoInfo`, `readLocalRepoInfo`, and `readLocalRepoIdentity` are all matched by identifier text regardless of where (or whether) they're declared in this repo; retaining a retired name is exactly what stops a cwd-derived-identity fallback of that name from being reintroduced later. This set carries no stale-entry ratchet — nothing here fails CI because a guarded name currently has no in-repo declaration.
- **`scanFiles`/`scanSource` are pure, AST-only, and their signature never changes** (`scanFiles.length === 2`) — no regex on raw source text, so `git …`/factory-name mentions in comments or docblocks are never flagged.
- **A context constructor fed a direct identity read is adjudicated once, not twice** — `gitContextForRepo(readLocalRepoIdentity(root))` and `forgeProviders({identity: getRepoInfo()})` shaped calls are `cwd-derived-identity`'s composite alone (`isIdentityReadComposite`, `identityRule.ts`); `unsanctioned-construction` imports that predicate and returns early on it rather than flagging the callee name itself. Every other construction — including one fed an already-resolved identity variable, `gitContextForRepo(threadedIdentity)` — is still flagged by `unsanctioned-construction` exactly as before.
- **The known evasion is unchanged and deliberately out of scope**: both name-based rules (`cwd-derived-identity`, `unsanctioned-construction`) match bare identifier text, so an aliased import (`import { GitContext as GC }`) would evade both. This predates the library switchover and stays out of scope.
- **When a `@paysdoc/devplatform` symbol is missing or misbehaving** — the git core and the forge adapters live in `paysdoc/devplatform`; ADW pins an exact version and Dependabot proposes bumps; there is no in-repo fallback or re-implementation to fall back on.
