# GitContext Package — Repo-Context Authority, Per-Command Env Injection, Bootstrap Absorption & Token Veracity

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`) and an optional `pat` for PAT-requiring operations. Every operation — branch create/checkout/delete, commit/push (force-with-lease), fetch/reset, worktree create/ensure/remove/list/query, worktree/branch probe reads, git phase-level reads (`lsFiles`, `headShort`, `diff`, `log`, `logSince`), remote fetch/merge/abort/ls-remote (`fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`), all `gh`/GitHub-API operations (issue read/comment, PR read/create+label/merge/approve/changed-files, label lifecycle, Projects V2 board, secret set), and git-remote/authenticated-user identity reads — is a method on `GitContext`, running through the single private `#run()` chokepoint that injects per-command auth and git identity into the child process environment without ever mutating `process.env`.

As of #700, the package also owns the **bootstrap pre-context primitives** that must run *before* a `GitContext` can be constructed: GitHub App token minting (`appAuth.ts`), local remote-URL + git-identity resolution (`bootstrapIdentity.ts`), a single veracious token resolver (`tokenResolver.ts`), and target-repo workspace clone/fetch (`repoWorkspace.ts`). These are structurally exempt (the guard skips `adws/gitContext/` by directory), eliminating the bootstrap ALLOWLIST category entirely. The four former bootstrap adapter files (`launchGitContext.ts`, `gitContextFactory.ts`, `githubAppAuth.ts`, `targetRepoManager.ts`) are now thin delegators with zero raw `git`/`gh` strings. As of #701 (the capstone), `githubAppAuth.ts` is a pure re-export shim with no `process.env` writes — the Claude subprocess now receives its `GH_TOKEN` + git identity per-invocation from the launch-boundary `GitContext.commandEnv()` via the `subprocessEnv` overlay in the agent chokepoints (`claudeAgent.ts` / `commandAgent.ts`). This module implements PRD `specs/prd/git-context-repo-authority.md` and eliminates the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally.

## Responsibilities

- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including an omitted `selfHost` boolean discriminator)
- Resolve `basePath` once in the constructor: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — never consulting `process.cwd()`
- Produce a per-command child-process environment overlay via `commandEnv(base?)`: fresh object with `GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` — never mutates `process.env`
- Execute every operation through the single private `#run(command, opts?)` chokepoint: spawns with `cwd` (defaults to `basePath`), `env = commandEnv(process.env)`, optional stdin `input`, optional `usePat` flag, and a global `maxBuffer: 10 MB` ceiling (prevents `ENOBUFS` on large diffs/logs)
- Provide branch operations: `getCurrentBranch`, `mergeLatestFromDefaultBranch`, `fetchAndResetToRemote`, `deleteLocalBranch`, `deleteRemoteBranch`, `defaultBranch`
- Provide commit/push operations: `commitChanges`, `pushBranch` (force-with-lease + lease-rejection detection), `getHeadTreeHash`, `hasUncommittedChanges`
- Provide worktree reset: `resetWorktree` (abort in-progress merge/rebase via fs then fetch/reset --hard/clean -fdx)
- Provide full worktree management surface: `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `listWorktrees`, `findWorktreeForIssue`, `removeWorktree`, `removeWorktreesForIssue`, `copyEnvToWorktree`
- Provide gh read methods: `listOpenIssues({ fields, search?, limit? })`, `issueComments(issueNumber)`, `fetchMergedPRs(limit?)`
- Provide identity-read methods: `remoteUrl(cwd?: string)`, `authenticatedUser()`
- Provide worktree/branch probe reads: `resolveGitDir(worktreePath)`, `currentBranchSymbolic(worktreePath)`, `worktreeRegistration(worktreePath)`, `worktreeBranches(cwd?)`, `localBranches(cwd?)`, `mainRepoPath(cwd?)`
- Provide phase-level git read ops: `lsFiles(cwd, prefix?)`, `headShort(cwd?)`, `diff(range, cwd)`, `log(branchName, cwd?)`
- Provide a bounded `git log --since` read: `logSince(opts: LogSinceOptions, cwd?)`
- Provide `fetchPRChangedFiles(prNumber): string`
- Extend `createPR` with optional `labels?: readonly string[]`
- Provide label/board/secret write ops: `setSecret(name, value)`, `runGraphQLInput(body)`
- Provide remote fetch/merge/ls-remote ops: `fetchRemote(branch, cwd)`, `mergeBranch(ref, cwd, opts?)`, `abortMerge(cwd)`, `lsRemote(branch, cwd?)`
- Provide upgrade-claim distributed-lock ops: `addDetachedWorktree(worktreePath, ref, cwd)`, `commitAllowEmpty(message, cwd)`, `pushHeadToBranch(branch, cwd)`, `removeDetachedWorktree(worktreePath, cwd)`
- Provide diagnostic read methods: `remotes(cwd?)`, `gitConfigUser(cwd?)`
- Delegate VCS operation orchestration to package-private modules (`branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`, `worktreeCreateOps.ts`, `worktreeQueryOps.ts`, `worktreeRemoveOps.ts`, `worktreeProbeOps.ts`, `gitReadOps.ts`, `remoteOps.ts`, `claimOps.ts`, `processCleanup.ts`)
- Expose the full `gh` issue, PR, label, board, and secret operation surface as thin methods that delegate to pure command-builder + parser modules in `adws/gitContext/commands/`
- Accept an injectable `ExecFn` via `GitContextDeps` for hermetic testing
- Export only `GitContext` class and its public types plus the bootstrap-exception symbols via `adws/gitContext/index.ts`

### Bootstrap package modules (absorbed in #700, structurally exempt)

The four modules below live inside the structurally-exempt `adws/gitContext/` directory. They are the *only* legitimate permanent site for pre-context git/gh shell-outs. ADW adapters (`gitContextFactory.ts`, `launchGitContext.ts`, `githubAppAuth.ts`, `targetRepoManager.ts`) delegate to these and contain zero raw `git`/`gh` strings.

| Module | Exports |
|---|---|
| `appAuth.ts` | `isGitHubAppConfigured()`, `getInstallationToken(owner, repo)`, JWT creation, installation-ID and token caching, `REFRESH_BUFFER_MS`. Uses `curl`-based exchange (not git/gh). Token cache keyed by `owner/repo`. |
| `bootstrapIdentity.ts` | `readLocalRepoInfo(cwd?): RepoInfo` — runs `git remote get-url origin`, parses HTTPS + SSH GitHub URLs, throws on unparseable. `resolveBootstrapGitIdentity(deps?): GitIdentity` — resolution order: App-slug bot → `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env → `git config user.*` → `ADW Bot` default; never returns empty fields. `ghAuthToken(): string` — runs `gh auth token`, returns `''` on failure. All seams injectable for hermetic tests. |
| `tokenResolver.ts` | `resolveContextToken(input: ResolveContextTokenInput): string` — the single veracious resolver (see Token Veracity below). Never reads `process.env.GH_TOKEN`. |
| `repoWorkspace.ts` | `getTargetRepoWorkspacePath(owner, repo, targetReposDir)`, `isRepoCloned(workspacePath, fsDeps?)`, `convertToSshUrl(cloneUrl)`, `cloneRepo(cloneUrl, workspacePath, opts?)`, `ensureRepoWorkspace(owner, repo, cloneUrl, deps)`. `ensureRepoWorkspace` clones via SSH when absent; otherwise runs `git fetch origin` and calls the injected `getDefaultBranch` thunk under per-command veracious auth — fixing the ambient-auth `gh repo view` crash class. |

### Token Veracity (`tokenResolver.ts`)

`resolveContextToken({ owner, repo, pat?, isAppConfigured, mintInstallationToken, ghAuthToken })` resolution order (guard-clause, never falls to `process.env.GH_TOKEN`):

1. **App configured** → `return mintInstallationToken(owner, repo)`. Any throw (app not installed on `owner/repo` = foreign identity) propagates loudly — never catch-and-fallthrough.
2. **PAT set** → return PAT.
3. **`gh auth token` non-empty** → return it.
4. **Else** → throw `resolveContextToken: no veracious token for owner/repo`.

This replaces the two prior resolvers (`resolveToken` in `gitContextFactory.ts`, `resolveLaunchToken` in `launchGitContext.ts`) which both fell through to `process.env.GH_TOKEN` — the root cause of ~13 "wrong-repo" / GH_TOKEN-bleed incidents (vestmatic #143/#181/#187 and others in memory).

### Package-private operation modules

Each module is side-effect-free except at the injected runner/fs seam and stays under 300 lines:

| Module | Exports |
|---|---|
| `branchOps.ts` | Branch create/checkout/delete/merge/fetch/reset runners; `localBranches` |
| `commitOps.ts` | Commit/push/hash/dirty-check runners |
| `worktreeResetOps.ts` | Abort-in-progress-op + fetch/reset --hard/clean |
| `worktreeCreateOps.ts` | `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo` |
| `worktreeQueryOps.ts` | `listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`; `mainRepoPath`, `worktreeBranches`; exports `WorktreeForIssueResult` type |
| `worktreeRemoveOps.ts` | `removeWorktree`, `removeWorktreesForIssue`, `parseWorktreeBranches`; injects `killProcesses` fn |
| `worktreeProbeOps.ts` | `resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`; exports `WorktreeRegistration` union type; handles arbitrary worktree paths supplied by the caller |
| `gitReadOps.ts` | `lsFiles`, `headShort`, `diff`, `log`; `logSince` + exports `LogSinceOptions`; pure functions over an injected `Runner` seam; errors propagate — no internal swallow |
| `remoteOps.ts` | `fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`; remote-interaction + merge ops over an injected `Runner` seam; all propagate errors except `abortMerge` (swallows — aborting with no in-progress merge is benign) |
| `claimOps.ts` | `addDetachedWorktree`, `commitAllowEmpty`, `pushHeadToBranch`, `removeDetachedWorktree`; upgrade-claim distributed-lock verbs; all propagate errors except `removeDetachedWorktree` (swallows). `pushHeadToBranch` emits **no** `--force` flag by design — the non-fast-forward rejection IS the lock. |
| `processCleanup.ts` | `killProcessesInDirectory` (lsof + SIGTERM→SIGKILL, self-PID filter); re-exported from `vcs/worktreeCleanup.ts` for legacy callers |

### Pure command modules (`adws/gitContext/commands/`)

Each module is side-effect-free (no `exec`, no `process.env`) and stays under 300 lines:

| Module | Exports |
|---|---|
| `issueCommands.ts` | Command builders + parsers for `gh issue …` / `gh api issues` (fetch, comment, state, close, title, comments, labels, create, update, find-upgrade, delete-comment, `listOpenIssues` with `ListOpenIssuesOptions`, `issueComments`) |
| `prCommands.ts` | PR builders + parsers (find by branch, fetch details/reviews/comments, comment, merge, approve, approval state, list, create, `fetchMergedPRs`, `prChangedFilesCmd`, extended `createPRCmd` with optional `labels?`) |
| `labelCommands.ts` | Label create and apply command builders |
| `boardCommands.ts` | Projects V2 GraphQL query/mutation builders + parsers (`moveIssueToStatus`, `graphQLInputCmd` for stdin-JSON complex mutations) |
| `secretCommands.ts` | `setSecretCmd(owner, repo, name)` — returns `gh secret set <name> --repo <owner>/<repo> --body -`; zero side effects |

## Boundary Adapters (rewired to zero raw git/gh in #700; process.env writes deleted in #701)

The four former bootstrap files now contain zero raw `git`/`gh` strings — they are thin delegates to package primitives with stable public import paths.

### `adws/github/gitContextFactory.ts`

`gitContextFor({ owner, repo, selfHost })`, `gitContextForSync(...)`, and `gitContextForRepo(repoInfo)` construct a `GitContext` from ambient ADW identity:
- Token resolution: delegates to `resolveContextToken` (package `tokenResolver.ts`). App → bound mint (loud throw on foreign identity); else PAT (`GITHUB_PAT`); else `ghAuthToken()`; **never** reads `process.env.GH_TOKEN`.
- Git identity resolution: delegates to `resolveBootstrapGitIdentity` (package `bootstrapIdentity.ts`). Resolution order: App-slug bot → `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env → `git config user.*` → `ADW Bot`.
- `readLocalRepoInfo(cwd?)`: re-exported from package `bootstrapIdentity.ts` — the chicken-and-egg bootstrap read; all ~20 callers of `githubApi.getRepoInfo` are unaffected.
- `getSelfHostIdentity` uses `readLocalRepoInfo(REPO_ROOT)` (package) instead of a raw `git remote get-url` shell-out.
- `gitContextFor`/`gitContextForSync`/`gitContextForRepo` retained — inject `REPO_ROOT`/`TARGET_REPOS_DIR`/`GITHUB_PAT`, keeping the package ADW-global-free.

### `adws/core/launchGitContext.ts`

`buildLaunchGitContext(deps)` constructs the launch-boundary `GitContext` for cron, webhook, and workflowInit:
- `resolveLaunchToken(owner, repo)`: delegates to `resolveContextToken` — no `process.env.GH_TOKEN` fallback.
- `resolveLaunchGitIdentity()`: delegates to `resolveBootstrapGitIdentity`.
- Local remote read: uses package `readLocalRepoInfo`.
- `buildLaunchGitContext`, `LaunchGitContextDeps`, and exported names preserved for 3 callers.

### `adws/github/githubAppAuth.ts` (pure re-export shim as of #701)

- Re-exports `getInstallationToken`/`isGitHubAppConfigured` from package `appAuth.ts`; stable path for 7 consumers.
- **No `process.env` writes remain.** `activateGitHubAppAuth`, `refreshTokenIfNeeded`, and `configureGitIdentity` were deleted in #701. The subprocess auth they previously provided is now sourced per-invocation from the launch-boundary `GitContext.commandEnv()` via the `subprocessEnv` overlay in `claudeAgent.ts`/`commandAgent.ts`.
- Zero raw `git`/`gh` strings; zero `process.env` mutations.

### `adws/core/targetRepoManager.ts`

- Re-exports `getTargetRepoWorkspacePath`, `isRepoCloned`, `convertToSshUrl` from package `repoWorkspace.ts`.
- `ensureTargetRepoWorkspace(targetRepo)`: thin wrapper that constructs a `GitContext` via `gitContextForRepo` and delegates to `ensureRepoWorkspace` with `getDefaultBranch: () => ctx.defaultBranch()` — per-command veracious auth for the `gh repo view` call. Fixes the `fetchLatestRefs` crash class at its root.
- `fetchLatestRefs`/`pullLatestDefaultBranch` retained as deprecated aliases.
- Stable import paths for trigger_cron, trigger_webhook, workflowInit, prReviewPhase consumers.

## Agent Subprocess Auth Seam (added in #701)

The Claude subprocess (spawned by `claudeAgent.ts` via the Claude CLI) shells out to `git`/`gh` for `/implement`, `/commit`, `/pull_request`, `/resolve_conflict`, and related commands. Before #701 it inherited `GH_TOKEN` and `GIT_*` identity from process-global writes (`activateGitHubAppAuth`). After #701 it receives them per-invocation from the launch-boundary context:

- `runClaudeAgentWithCommand` (`adws/agents/claudeAgent.ts`) gains an optional trailing `subprocessEnv?: NodeJS.ProcessEnv` parameter. The spawn environment is `{ ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) }` — the overlay takes precedence, but the base is unchanged when no overlay is provided (self-host / no App configured).
- `runCommandAgent` (`adws/agents/commandAgent.ts`) gains `subprocessEnv?` in `CommandAgentOptions` and forwards it through `runClaudeAgentWithCommand` and the retry-loop respawn.
- Agent runner functions (`buildAgent.ts`, `gitAgent.ts`, `prAgent.ts`, `patchAgent.ts`, `refactorAgent.ts`, `documentAgent.ts`, `reviewAgent.ts`, `resolutionAgent.ts`, `installAgent.ts`) each accept an optional `subprocessEnv?` parameter and forward it to `runCommandAgent`.
- Phases that construct a `gitCtx` (`buildPhase.ts`, `prPhase.ts`, `documentPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `prReviewPhase.ts`, `reviewPatchHelpers.ts`) pass `gitCtx.commandEnv()` as `subprocessEnv` to their agent calls. The fallback is `config.gitContext?.commandEnv()` (the launch-boundary context from `workflowInit.ts`).
- When no App is configured, `commandEnv()` call paths remain — the overlay is empty and behavior is identical to before (subprocess inherits `gh auth login` credentials via `HOME`).

## Migrated Call Sites (cumulative through #701)

All files are fully migrated. The guard's `ALLOWLIST` has been deleted.

**#701 — Capstone: subprocess auth seam, process-global deletion, ALLOWLIST removal:**

| Change | Files |
|---|---|
| Subprocess env seam (foundation) | `adws/agents/claudeAgent.ts`, `adws/agents/commandAgent.ts`, `adws/agents/buildAgent.ts`, `adws/agents/gitAgent.ts`, `adws/agents/prAgent.ts`, `adws/agents/patchAgent.ts`, `adws/agents/refactorAgent.ts`, `adws/agents/documentAgent.ts`, `adws/agents/reviewAgent.ts`, `adws/agents/resolutionAgent.ts`, `adws/agents/installAgent.ts` |
| Phase threading (commandEnv to agents) | `adws/phases/buildPhase.ts`, `adws/phases/prPhase.ts`, `adws/phases/documentPhase.ts`, `adws/phases/reviewPhase.ts`, `adws/phases/scenarioFixPhase.ts`, `adws/phases/prReviewPhase.ts`, `adws/phases/reviewPatchHelpers.ts` |
| Process-global writes deleted | `adws/github/githubAppAuth.ts` (pure re-export shim), `adws/github/index.ts` (barrel), `adws/triggers/trigger_webhook.ts`, `adws/triggers/trigger_cron.ts`, `adws/phases/workflowInit.ts`, `adws/phases/prReviewPhase.ts`, `adws/triggers/pauseQueueScanner.ts`, `adws/adwUpgrade.tsx` (stopgap), `adws/agents/prAgent.ts` (refreshTokenIfNeeded call) |
| ALLOWLIST machinery deleted | `adws/checkGitGhGuard.ts` (ALLOWLIST const, allowed Set, per-file skip; `(0 allowlisted)` literal) |

**#700 — Bootstrap adapters rewired (four files, zero raw git/gh remaining):**

| File | Change |
|---|---|
| `adws/github/gitContextFactory.ts` | `resolveToken` → `resolveContextToken`; `deriveGitIdentity` → `resolveBootstrapGitIdentity`; `readLocalRepoInfo` re-exported from package; `getSelfHostIdentity` uses `readLocalRepoInfo(REPO_ROOT)` |
| `adws/core/launchGitContext.ts` | `resolveLaunchToken` → `resolveContextToken`; `resolveLaunchGitIdentity` → `resolveBootstrapGitIdentity`; `getRepoInfo` default uses package `readLocalRepoInfo` |
| `adws/github/githubAppAuth.ts` | Re-exports mint from `appAuth.ts`; process.env writes deferred (removed in #701) |
| `adws/core/targetRepoManager.ts` | Re-exports workspace helpers from `repoWorkspace.ts`; `ensureTargetRepoWorkspace` delegates with veracious `getDefaultBranch` |

Prior slice migrations (summarized — see git history for per-slice detail):
- **#691** — gh reads: `concurrencyGuard.ts`, `webhookGatekeeper.ts`, `docsSelfCheck.ts`, `takeoverHandler.ts`, `perIssueScenarioSweep.ts`
- **#692** — identity reads: `githubApi.ts`, `repoContext.ts`, `trigger_cron.ts`
- **#693** — VCS probe/branch: `worktreeProbe.ts`, `worktreeOperations.ts`, `branchOperations.ts`, `branchIdentityFallback.ts`, `orchestratorLib.ts`
- **#694** — phase git reads: `worktreeSetup.ts`, `workflowInit.ts`, `diffEvaluationPhase.ts`, `prCommentDetector.ts`, `checkLivingDocsIndex.ts`
- **#695** — label/board/secret writes: `labelManager.ts`, `githubBoardManager.ts`, `depauditSetup.ts`
- **#696** — remote/merge ops: `autoMergeHandler.ts`, `remoteReconcile.ts`
- **#697** — promotion-sweep PR/stats: `adwPromotionSweep.tsx`, `promotionStatsLoader.ts`
- **#698** — upgrade-claim locks: `upgradeClaim.ts`
- **#699** — diagnostics: `healthCheckChecks.ts`, `healthCheck.tsx`

## Consumer End State

| File | Status |
|---|---|
| `adws/vcs/worktreeCreation.ts` | Stub |
| `adws/vcs/worktreeQuery.ts` | Stub |
| `adws/vcs/worktreeCleanup.ts` | Re-exports `killProcessesInDirectory`; no I/O |
| `adws/vcs/worktreeOperations.ts` | Thin adapter — `getMainRepoPath` delegates to `gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd)` |
| `adws/vcs/worktreeReset.ts` | Stub (since #662) |
| `adws/vcs/worktreeProbe.ts` | Pure probe logic + injected `ProbeDeps` seam; `buildDefaultProbeDeps(ctx: GitContext)` requires a `GitContext` arg |
| `adws/vcs/branchOperations.ts` | Pure vocabulary (slug gen, branch naming, `PROTECTED_BRANCHES`) only; `getDefaultBranch` thin adapter |
| `adws/vcs/commitOperations.ts` | Pure utilities only |
| `adws/phases/branchIdentityFallback.ts` | `defaultListCandidateBranches` thin adapter via `gitContextForRepo` |
| `adws/core/orchestratorLib.ts` | `hasUncommittedChanges` thin adapter; `deriveOrchestratorScript`/`orchestratorNamesForScript` extracted to `orchestratorNames.ts` |
| `adws/github/labelManager.ts` | `LabelManagerDeps` = `{ gitContextForRepo }`; delegates to `ctx.createLabel`/`ctx.applyLabel` |
| `adws/providers/github/githubBoardManager.ts` | `updateStatusFieldOptions` uses `this.ctx.runGraphQLInput(body)` |
| `adws/phases/depauditSetup.ts` | `propagateSecret` uses `ctx.setSecret(envName, envValue)` |
| `adws/triggers/autoMergeHandler.ts` | All 9 raw `execSync('git …')` replaced with `ctx` methods |
| `adws/core/remoteReconcile.ts` | `defaultBranchExistsOnRemote` uses `gitContextForRepo(repoInfo).lsRemote(...)` |
| `adws/adwPromotionSweep.tsx` | All raw exec removed; `gitCtx` methods for PR/log ops |
| `adws/promotion/promotionStatsLoader.ts` | `runGit`+`cwd` replaced by `gitLogSince: (opts: LogSinceOptions) => string` |
| `adws/core/upgradeClaim.ts` | All five raw `execSync` git calls replaced with `ctx` methods |
| `adws/healthCheckChecks.ts` | All git/gh probes use `ctx` methods |
| `adws/healthCheck.tsx` | Constructs self-host context via factory |
| `adws/github/gitContextFactory.ts` | Thin ADW adapter — no raw git/gh; delegates to package primitives |
| `adws/core/launchGitContext.ts` | Thin ADW adapter — no raw git/gh; delegates to package primitives |
| `adws/github/githubAppAuth.ts` | Pure re-export shim — no raw git/gh, no `process.env` writes (#701) |
| `adws/core/targetRepoManager.ts` | Re-export shim; no raw git/gh; `ensureTargetRepoWorkspace` delegates with veracious auth |

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws `Error: GitContext: <field> must not be empty`
- Self-host identity resolves `basePath` to `frameworkRepoRoot`; target identity resolves to `join(targetReposDir, owner, repo)`
- `worktreePathFor` result is determined solely by `basePath` and branch name — `process.cwd()` has no effect
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
- `#run` always passes an explicit `cwd` and `env` — never inherits process working directory or ambient `process.env.GH_TOKEN`
- `defaultExec` sets `maxBuffer: 10 * 1024 * 1024` on all `execSync` calls
- When `usePat: true` and `#pat` is set, `GH_TOKEN` in the child env is the PAT; parent `process.env` is unchanged
- Two `GitContext` instances for two repos never share `cwd` or token — `GH_TOKEN` bleed is structurally impossible
- `activeRepo` and `ensureAppAuthForRepo` were deleted from `githubAppAuth.ts`; all `gh` ops authenticate via per-command child env
- `activateGitHubAppAuth`, `refreshTokenIfNeeded`, and `configureGitIdentity` no longer exist — no `process.env` mutation remains in the hot path
- The Claude subprocess receives per-command `GH_TOKEN` + `GIT_*` via the `subprocessEnv` overlay in `claudeAgent.ts`; the spawn env is `{ ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) }` — never mutates `process.env`
- `pushBranch` uses `--force-with-lease --force-if-includes`; lease rejection throws with manual-remedy instructions
- `resetWorktree` aborts any in-progress merge/rebase before fetching and hard-resetting
- Protected branches (`main`, `master`, `develop`) refused by `deleteLocalBranch` and `deleteRemoteBranch`
- Package imports nothing from `adws/core`, `adws/providers`, or any ADW global — all config injected at construction
- **Token veracity (resolveContextToken):** when App is configured, returns only a mint bound to `owner/repo` and propagates any throw loudly (foreign/uninstalled identity = hard error, never substitutes ambient token). Never reads `process.env.GH_TOKEN` as a token source.
- **Bootstrap exception (bootstrapIdentity.ts):** `readLocalRepoInfo` and `resolveBootstrapGitIdentity` are the only legitimate pre-context git/gh reads; they live inside the exempt package and are not on any ALLOWLIST
- `ensureRepoWorkspace` calls `getDefaultBranch()` (injected thunk) under per-command auth — the `gh repo view` for default-branch never runs under ambient auth
- `pushHeadToBranch` never uses `--force` — the non-fast-forward rejection IS the distributed lock
- `commitAllowEmpty` always produces exactly one new commit — never short-circuits on a clean tree
- `abortMerge` swallows all errors — aborting with no in-progress merge is benign
- `lsRemote` omits `--exit-code` — an absent ref yields empty stdout (exit 0) rather than a throw
- `resolveGitDir` absolutizes a relative `.git` against the worktree path; returns `null` on failure
- `currentBranchSymbolic` returns `null` on detached HEAD or failure
- `worktreeRegistration` returns `'healthy' | 'locked' | 'prunable' | 'missing'`; `'missing'` on failure
- `gitConfigUser(cwd?)` never throws — catches each per-field read internally, returns `null` for unset keys

## Configuration

All configuration is injected at construction via `GitContextOptions`:

| Field | Type | Description |
|---|---|---|
| `owner` | `string` | GitHub owner (org or user) |
| `repo` | `string` | Repository name |
| `selfHost` | `boolean` | `true` = ADW's own repo, `false` = target repo |
| `token` | `string` | Personal access or GitHub App installation token |
| `gitIdentity` | `GitIdentity` | Author + committer name/email for git operations |
| `frameworkRepoRoot` | `string` | Absolute path to ADW framework repo root (injected from `REPO_ROOT`) |
| `targetReposDir` | `string` | Absolute path to cloned target repos directory (injected from `TARGET_REPOS_DIR`) |
| `pat?` | `string` | Optional PAT for `usePat` ops (PR approve, Projects V2 board, `runGraphQLInput`) |

Optional injectable dependency bag via `GitContextDeps`:

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to thin `execSync` wrapper |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction
- **`process.env` is never mutated on the operation hot path** — `commandEnv(process.env)` overlays into a new object
- **`resolveContextToken` never reads `process.env.GH_TOKEN`** — the ambient-global fallthrough was the GH_TOKEN-bleed vector. Any token returned is provably bound to the given `owner/repo`. A foreign/uninstalled App identity throws loudly instead of silently adopting a wrong-repo token.
- **No `process.env` writes exist in the hot path (#701)** — `activateGitHubAppAuth`, `refreshTokenIfNeeded`, and `configureGitIdentity` are deleted. The subprocess env overlay (`subprocessEnv` in agent chokepoints) is the only auth path for the Claude CLI subprocess. When no App is configured (self-host without a configured App), the overlay is omitted and the subprocess uses `gh auth login` credentials — no regression.
- **Subprocess env overlay is built fresh per-invocation** — `{ ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) }` creates a new object each time; `process.env` is never written.
- **`ensureRepoWorkspace` `getDefaultBranch` thunk must use veracious auth** — callers inject `() => ctx.defaultBranch()` where `ctx` is a `GitContext` for the target repo. This is the structural fix for the `fetchLatestRefs` crash class where `gh repo view` ran under ambient/wrong-repo auth.
- **`#run` accepts optional `{ cwd?, input?, usePat? }`** — `cwd` overrides base path for ops on worktrees; `input` pipes data to stdin; `usePat: true` injects `GITHUB_PAT` as `GH_TOKEN` for that one command only
- **`maxBuffer` is global to `defaultExec`** — raised to 10 MB for all `execSync` calls
- **`readLocalRepoInfo` in `bootstrapIdentity.ts` is the only correct place for a bootstrap git-remote read** — any future need to derive identity before a `GitContext` exists must extend or call this function
- **`gitContextFactory.ts` lives in `adws/github/`** — not in the reusable package, to keep the package free of ADW globals (`REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`)
- **`getWorktreesDir`, `getWorktreePath`, `worktreeExists` no longer exist** — route through `ctx.ensureWorktree()`, `ctx.worktreePathFor()`, or `ctx.getWorktreeForBranch()`
- **`activeRepo`/`ensureAppAuthForRepo` are gone** — use `gitContextForRepo(repoInfo).<method>()` instead
- **`activateGitHubAppAuth`/`refreshTokenIfNeeded`/`configureGitIdentity` are gone (#701)** — there is no process-global token write. The subprocess receives auth via `subprocessEnv` from the launch-boundary context. Any import of these symbols causes a compile error.
- **Board and approve ops require `GITHUB_PAT`** — `usePat: true` falls back to the context token when `GITHUB_PAT` is unset (user-owned repos degrade gracefully)
- **`abortMerge` error-swallowing is load-bearing** — `checkMergeConflicts` calls `ctx.abortMerge` in both clean-path and catch-path; propagating would throw incorrectly on "no merge in progress"
- **`setSecret` uses the context primary token, not the PAT** — the value is piped via stdin, never on argv
- **`lsRemote` drops `--exit-code` deliberately** — routing through `#run` (throws on any non-zero exit) makes `--exit-code` actively harmful for the "branch absent = exit 2" case
- **`LabelManagerDeps` shape changed in #695** — from `{ exec }` to `{ gitContextForRepo }`. Tests must inject `gitContextForRepo: (repoInfo) => new GitContext(validOptions(), { exec: spyExec })`
- **`buildDefaultProbeDeps` now requires a `GitContext` arg** — the no-arg form is gone
- **`copyClaudeAssetsToWorktree` requires `GitContext` second arg** (changed in #694)
- **`getLastAdwCommitTimestamp` requires `GitContext` second arg** (changed in #694)
- **`pushHeadToBranch` must NEVER force** — a unit assertion in `claimOps.test.ts` pins this
- **`addDetachedWorktree` must not create a named local branch** — uses `--detach` to avoid "branch already exists" on the loser path
- **`commitAllowEmpty` must not be replaced with `commitChanges`** — `commitChanges` short-circuits on a clean tree; the claim requires an always-empty commit
- **`logSince` is a bounded method, not a free-string passthrough** — `LogSinceOptions` vocabulary (`since`, `grep?`, `oneline?`, `patch?`, `pathspec?`) prevents arbitrary git subcommands
- **The ALLOWLIST has been deleted (#701)** — the `ALLOWLIST` const, the `allowed` Set, and the per-file skip are removed from `checkGitGhGuard.ts`. The only file exemption is the structural `EXEMPT_PACKAGE_DIR = 'adws/gitContext'`. The guard still prints `(0 allowlisted)` as a literal to keep the `(\d+) allowlisted` capstone observable valid. Any new raw `git`/`gh` call outside the package immediately breaks CI.
- **`gitContextForSync` vs `gitContextFor` vs `gitContextForRepo`** — use `gitContextForSync` in synchronous initialization; `gitContextFor` when you can `await`; `gitContextForRepo(repoInfo)` in trigger/phase modules with only a `RepoInfo`
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global discipline; physical extraction deferred
- **`checkGitGhGuard.ts` `main()` guard** — exported as a module to support test imports; `main()` called only when `process.argv[1]` includes `checkGitGhGuard`
