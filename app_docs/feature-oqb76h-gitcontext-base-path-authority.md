# GitContext Package — Repo-Context Authority, Per-Command Env Injection, Full VCS & Worktree Surface

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`) and an optional `pat` for PAT-requiring operations. Every operation — branch create/checkout/delete, commit/push (force-with-lease), fetch/reset, worktree create/ensure/remove/list/query, worktree/branch probe reads, git phase-level reads (`lsFiles`, `headShort`, `diff`, `log`), remote fetch/merge/abort/ls-remote (`fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`), all `gh`/GitHub-API operations (issue read/comment, PR read/create/merge/approve, label lifecycle, Projects V2 board, secret set), and git-remote/authenticated-user identity reads — is a method on `GitContext`, running through the single private `#run()` chokepoint that injects per-command auth and git identity into the child process environment without ever mutating `process.env`. This module implements PRD `specs/prd/git-context-repo-authority.md` and eliminates the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally.

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
- Provide full worktree management surface (slice #661): `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `listWorktrees`, `findWorktreeForIssue`, `removeWorktree`, `removeWorktreesForIssue`, `copyEnvToWorktree`
- Provide gh read methods (slice #691): `listOpenIssues({ fields, search?, limit? })`, `issueComments(issueNumber)`, `fetchMergedPRs(limit?)` — covering the residual direct-`gh` consumers migrated off the ALLOWLIST
- Provide identity-read methods (slice #692): `remoteUrl(cwd?: string)` — runs `git remote get-url origin` in the given `cwd`; `authenticatedUser()` — runs `gh api user` and returns the full JSON string
- Provide worktree/branch probe reads (slice #693): `resolveGitDir(worktreePath)`, `currentBranchSymbolic(worktreePath)`, `worktreeRegistration(worktreePath)`, `worktreeBranches(cwd?)`, `localBranches(cwd?)`, `mainRepoPath(cwd?)` — replacing raw-`git` call sites in `worktreeProbe.ts`, `worktreeOperations.ts`, `branchOperations.ts`, `branchIdentityFallback.ts`, and `orchestratorLib.ts`
- Provide phase-level git read ops (slice #694): `lsFiles(cwd, prefix?)`, `headShort(cwd?)`, `diff(range, cwd)`, `log(branchName, cwd?)` — replacing raw-`execSync` call sites in `worktreeSetup.ts`, `workflowInit.ts`, `diffEvaluationPhase.ts`, `prCommentDetector.ts`, and `checkLivingDocsIndex.ts`
- Provide label/board/secret write ops (slice #695): `setSecret(name, value)` — pipes value via stdin using context token; `runGraphQLInput(body)` — stdin-JSON GraphQL for complex/array variables, uses PAT with graceful fallback — enabling `labelManager.ts`, `githubBoardManager.ts`, and `depauditSetup.ts` to be removed from the `ALLOWLIST`
- Provide remote fetch/merge/ls-remote ops (slice #696): `fetchRemote(branch, cwd)`, `mergeBranch(ref, cwd, opts?)`, `abortMerge(cwd)`, `lsRemote(branch, cwd?)` — delegates to package-private `remoteOps.ts`; fixes the wrong-`cwd` `ls-remote` bug in `remoteReconcile.ts` and migrates `autoMergeHandler.ts`'s 9 raw `execSync` sites, removing both files from the `ALLOWLIST`
- Delegate VCS operation orchestration to package-private modules (`branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`, `worktreeCreateOps.ts`, `worktreeQueryOps.ts`, `worktreeRemoveOps.ts`, `worktreeProbeOps.ts`, `gitReadOps.ts`, `remoteOps.ts`, `processCleanup.ts`), each taking an injected runner — keeping the `GitContext` class thin and testable
- Expose the full `gh` issue, PR, label, board, and secret operation surface as thin methods that delegate to pure command-builder + parser modules in `adws/gitContext/commands/`
- Accept an injectable `ExecFn` via `GitContextDeps` for hermetic testing (the ADW `Deps` idiom)
- Export only `GitContext` class and its public types via `adws/gitContext/index.ts` — no context-free git/`gh` free functions

### Package-private operation modules

Each module is side-effect-free except at the injected runner/fs seam and stays under 300 lines:

| Module | Exports |
|---|---|
| `branchOps.ts` | Branch create/checkout/delete/merge/fetch/reset runners; `localBranches` (slice #693) |
| `commitOps.ts` | Commit/push/hash/dirty-check runners |
| `worktreeResetOps.ts` | Abort-in-progress-op + fetch/reset --hard/clean |
| `worktreeCreateOps.ts` | `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo` |
| `worktreeQueryOps.ts` | `listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`; `mainRepoPath`, `worktreeBranches` (slice #693); exports `WorktreeForIssueResult` type |
| `worktreeRemoveOps.ts` | `removeWorktree`, `removeWorktreesForIssue`, `parseWorktreeBranches`; injects `killProcesses` fn |
| `worktreeProbeOps.ts` | `resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration` (slice #693); exports `WorktreeRegistration` union type; handles arbitrary worktree paths supplied by the caller |
| `gitReadOps.ts` | `lsFiles`, `headShort`, `diff`, `log` (slice #694); pure functions over an injected `Runner` seam; errors propagate — no internal swallow |
| `remoteOps.ts` | `fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote` (slice #696); remote-interaction + merge ops over an injected `Runner` seam; all propagate errors except `abortMerge` (swallows — aborting with no in-progress merge is benign) |
| `processCleanup.ts` | `killProcessesInDirectory` (lsof + SIGTERM→SIGKILL, self-PID filter); re-exported from `vcs/worktreeCleanup.ts` for legacy callers |

### Pure command modules (`adws/gitContext/commands/`)

Each module is side-effect-free (no `exec`, no `process.env`) and stays under 300 lines:

| Module | Exports |
|---|---|
| `issueCommands.ts` | Command builders + parsers for `gh issue …` / `gh api issues` (fetch, comment, state, close, title, comments, labels, create, update, find-upgrade, delete-comment, **listOpenIssues** with `ListOpenIssuesOptions`, **issueComments**) |
| `prCommands.ts` | PR builders + parsers (find by branch, fetch details/reviews/comments, comment, merge, approve, approval state, list, create, **fetchMergedPRs**) |
| `labelCommands.ts` | Label create and apply (create-if-missing + add) command builders |
| `boardCommands.ts` | Projects V2 GraphQL query/mutation builders + parsers (project id, issue item, status field, status update, `moveIssueToStatus`, **graphQLInputCmd** for stdin-JSON complex mutations — slice #695) |
| `secretCommands.ts` | `setSecretCmd(owner, repo, name)` — returns `gh secret set <name> --repo <owner>/<repo> --body -`; zero side effects (slice #695) |

## Boundary Factory (`adws/github/gitContextFactory.ts`)

`gitContextFor({ owner, repo, selfHost })`, `gitContextForSync(...)`, and `gitContextForRepo(repoInfo)` construct a `GitContext` from ambient ADW identity:
- Token resolution order: GitHub App installation token → `GH_TOKEN` env var → `gh auth token` CLI
- Git identity resolution order: `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars → `GITHUB_APP_SLUG` bot identity → `git config user.*` → fallback defaults (`ADW Bot`)
- Injects `REPO_ROOT` / `TARGET_REPOS_DIR` from `adws/core/environment`
- Async export (`gitContextFor`) and sync export (`gitContextForSync`) — all resolution is `execSync` under the hood; async variant exists so callers can `await` at the scope boundary
- `gitContextForRepo(repoInfo)` is a sync convenience for consumers that only have a `RepoInfo` object (e.g. trigger-layer modules); auto-detects self-host so the base path always resolves to a directory that exists
- `readLocalRepoInfo(cwd?: string): RepoInfo` (added in #692) — a permanently-allowlisted bootstrap export that reads `git remote get-url origin` and parses both HTTPS and SSH GitHub remote URLs into `{ owner, repo }`. Lives here (not in `githubApi.ts`) because it produces the identity a `GitContext` is constructed *from* (chicken-and-egg: the caller cannot yet have a `GitContext` to route through). `githubApi.getRepoInfo` delegates directly to this function; all ~20 callers of `getRepoInfo` are unaffected. Throws `"Could not parse GitHub URL: …"` / `"Failed to get repo info: …"` on failure.

## Migrated Call Sites (as of #695)

`workflowInit.ts`, `prPhase.ts`, `buildPhase.ts`, `documentPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `prReviewPhase.ts`, `takeoverHandler.ts`, `webhookHandlers.ts`, `cancelHandler.ts`, `devServerJanitor.ts`, `adwMerge.tsx`, `adwUpgrade.tsx`, and `adwPromotionSweep.tsx` all construct a `GitContext` via the factory or receive one threaded from the launch boundary.

Trigger-layer and phase modules migrated in #691 (gh reads):

| Consumer | Previous | Now |
|---|---|---|
| `concurrencyGuard.ts` | `execSync('gh issue list …')` | `gitContextForRepo(repoInfo).listOpenIssues(...)` |
| `webhookGatekeeper.ts` (×2) | `execSync('gh issue list …')` | `ctx.listOpenIssues(...)` (prefers injected `gitContext`; falls back to factory) |
| `docsSelfCheck.ts` | `execWithRetry('gh issue list …')` | `gitContextForRepo(repoInfo).listOpenIssues(...)` |
| `takeoverHandler.ts` | `execSync('gh issue view … --jq .comments')` | `gitContextForRepo(repoInfo).issueComments(issueNumber)` |
| `perIssueScenarioSweep.ts` | `execSync('gh pr list …')` | `gitContextForRepo(repoInfo).fetchMergedPRs(200)` |

Identity-read consumers migrated in #692:

| Consumer | Previous | Now |
|---|---|---|
| `githubApi.ts` `getRepoInfo` | `execSync('git remote get-url origin', { cwd })` | `readLocalRepoInfo(cwd)` (delegates to factory bootstrap — chicken-and-egg) |
| `githubApi.ts` `getAuthenticatedUser` | `execWithRetry('gh api user --jq .login')` | `gitContextForRepo(getRepoInfo()).authenticatedUser()` then `JSON.parse(...).login` |
| `repoContext.ts` `validateGitRemote` | `execSync('git remote get-url origin', { cwd, … })` | `gitContextForRepo({ owner, repo }).remoteUrl(cwd)` |
| `trigger_cron.ts` `fetchOpenIssues` | `execSync('gh issue list --repo … --json …')` | `gitContextForRepo(cronRepoInfo).listOpenIssues({ fields: [...], limit: 100 })` |
| `trigger_cron.ts` `buildTargetRepoArgs` fallback | `execSync('git remote get-url origin')` | `gitContextForRepo(cronRepoInfo).remoteUrl()` |

VCS probe/branch consumers migrated in #693:

| Consumer | Previous | Now |
|---|---|---|
| `worktreeProbe.ts` `buildDefaultProbeDeps` | `execSync('git rev-parse --git-dir', { cwd: worktreePath })` | `ctx.resolveGitDir(worktreePath)` |
| `worktreeProbe.ts` `buildDefaultProbeDeps` | `execSync('git symbolic-ref --short HEAD', { cwd: worktreePath })` | `ctx.currentBranchSymbolic(worktreePath)` |
| `worktreeProbe.ts` `buildDefaultProbeDeps` | `execSync('git worktree list --porcelain', { cwd: worktreePath })` | `ctx.worktreeRegistration(worktreePath)` |
| `worktreeOperations.ts` `getMainRepoPath` | `execSync('git worktree list --porcelain', { cwd })` | `gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd)` |
| `branchOperations.ts` `getDefaultBranch` | `execSync(gh repo view … defaultBranchRef, { cwd })` | `gitContextForRepo(readLocalRepoInfo(cwd)).defaultBranch()` |
| `branchIdentityFallback.ts` `defaultListCandidateBranches` | `execSync('git worktree list --porcelain')` + `execSync('git branch --list')` | `ctx.worktreeBranches(cwd)` + `ctx.localBranches(cwd)` |
| `orchestratorLib.ts` `hasUncommittedChanges` | `execSync('git status --porcelain', { cwd })` | `gitContextForRepo(readLocalRepoInfo(cwd)).hasUncommittedChanges(cwd)` |

Phase-level git read consumers migrated in #694:

| Consumer | Previous | Now |
|---|---|---|
| `worktreeSetup.ts` `getTrackedBasenames` / `getTrackedTopDirs` | `execSync('git ls-files "<prefix>"', { cwd: worktreePath })` | `ctx.lsFiles(worktreePath, prefix)` |
| `workflowInit.ts` version log | `execSync('git rev-parse --short HEAD').trim()` | `gitCtx.headShort(frameworkRepoRoot)` |
| `diffEvaluationPhase.ts` `getGitDiff` | `execSync('git diff <range>', { cwd, maxBuffer: 10MB })` | `ctx.diff(range, worktreePath)` |
| `prCommentDetector.ts` `getLastAdwCommitTimestamp` | `execSync('git log "<branch>" --format="%aI %s" --no-merges', { cwd })` | `gitContext.log(branchName, cwd)` |
| `checkLivingDocsIndex.ts` `listTrackedFiles` | `execSync('git ls-files')` | `gitContextForRepo(readLocalRepoInfo(), { selfHost: true }).lsFiles(process.cwd())` |

Label/board/secret write consumers migrated in #695:

| Consumer | Previous | Now |
|---|---|---|
| `labelManager.ts` `ensureAdwLabelsExist` | `execWithRetry('gh label create … --force')` via injected `exec` | `ctx.createLabel(def.name, def.color, def.description)` via injected `gitContextForRepo` factory |
| `labelManager.ts` `applyLabel` | `execWithRetry('gh issue edit … --add-label …')` via injected `exec` | `ctx.applyLabel(issueNumber, label)` (lazy-create-and-retry preserved) |
| `githubBoardManager.ts` `updateStatusFieldOptions` | `execSync('gh api graphql --input -', { input: JSON.stringify(body) })` | `this.ctx.runGraphQLInput(body)` |
| `depauditSetup.ts` `propagateSecret` | `execWithRetry('gh secret set … --body -', { input, maxAttempts: 3 })` | `ctx.setSecret(envName, envValue)` |

All three files (`labelManager.ts`, `githubBoardManager.ts`, `depauditSetup.ts`) have been removed from the `ALLOWLIST` in `adws/checkGitGhGuard.ts`. `bun run lint:git-guard` now passes with all three files scanned (zero violations). The residual `ALLOWLIST` cohort after #695: `remoteReconcile.ts`, `adwPromotionSweep.tsx`, `autoMergeHandler.ts` (plus permanent bootstrap/diagnostic entries).

Remote fetch/merge/ls-remote consumers migrated in #696:

| Consumer | Previous | Now |
|---|---|---|
| `autoMergeHandler.ts` `checkMergeConflicts` (×2) | `execSync('git fetch origin "<base>"')`, `execSync('git merge --no-commit --no-ff "origin/<base>"')`, `execSync('git merge --abort')` ×2 | `ctx.fetchRemote`, `ctx.mergeBranch(..., { noCommit, noFf })`, `ctx.abortMerge` ×2 |
| `autoMergeHandler.ts` `resolveConflictsViaAgent` (×2) | `execSync('git fetch origin "<base>"')`, `execSync('git merge "origin/<base>" --no-edit')` | `ctx.fetchRemote`, `ctx.mergeBranch(..., { noEdit: true })` |
| `autoMergeHandler.ts` `pushBranchChanges` | `execSync('git push origin "<branch>"')` | `ctx.pushBranch(branchName, cwd)` (existing, force-with-lease) |
| `autoMergeHandler.ts` `syncWorktreeToOriginHead` (×2) | `execSync('git fetch origin "<head>"')` + `execSync('git reset --hard "origin/<head>"')` | `ctx.fetchAndResetToRemote(headBranch, cwd)` (existing; collapses two sites to one) |
| `remoteReconcile.ts` `defaultBranchExistsOnRemote` | `execWithRetry('git ls-remote --exit-code origin <branch>')` **with no `cwd`** (wrong-base-repo bug) | `gitContextForRepo(repoInfo).lsRemote(branchName).length > 0` |

`autoMergeHandler.ts` and `remoteReconcile.ts` have been removed from the `ALLOWLIST`. The residual `ALLOWLIST` cohort after #696: `adwPromotionSweep.tsx` (plus permanent bootstrap/diagnostic entries).

## Consumer End State (as of #696)

| File | Status |
|---|---|
| `adws/vcs/worktreeCreation.ts` | Stub — all ops on `GitContext` |
| `adws/vcs/worktreeQuery.ts` | Stub — all ops on `GitContext` |
| `adws/vcs/worktreeCleanup.ts` | Re-exports `killProcessesInDirectory` from `adws/gitContext/`; remove/query ops gone |
| `adws/vcs/worktreeOperations.ts` | Thin adapter — `getMainRepoPath(cwd)` delegates to `gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd)`; no raw `child_process` import |
| `adws/vcs/worktreeReset.ts` | Stub (since #662) |
| `adws/vcs/worktreeProbe.ts` | Pure probe logic + injected `ProbeDeps` seam unchanged; `buildDefaultProbeDeps(ctx: GitContext)` now requires a `GitContext` arg (no default); `probeWorktree`/`clearOrphanedIndexLock` require explicit `deps` |
| `adws/vcs/branchOperations.ts` | Pure vocabulary (slug gen, branch naming, `PROTECTED_BRANCHES`) only; `getDefaultBranch` is a thin adapter; dead `deleteLocalBranch` removed; no raw `child_process` import |
| `adws/vcs/commitOperations.ts` | Pure utilities only; commit/push I/O migrated to GitContext |
| `adws/phases/branchIdentityFallback.ts` | `defaultListCandidateBranches` thin adapter via `gitContextForRepo`; `parseWorktreeBranchNames` deleted; no raw `child_process` import |
| `adws/core/orchestratorLib.ts` | `hasUncommittedChanges` thin adapter via `gitContextForRepo`; `deriveOrchestratorScript`/`orchestratorNamesForScript` extracted to `orchestratorNames.ts`; no raw `child_process` import |
| `adws/phases/worktreeSetup.ts` | `copyClaudeAssetsToWorktree(worktreePath, gitContext)` now requires `GitContext` as second arg; `getTrackedBasenames`/`getTrackedTopDirs` take `GitContext` as first arg; no raw `child_process` import |
| `adws/phases/workflowInit.ts` | Version-log `git rev-parse --short HEAD` replaced by `gitCtx.headShort(frameworkRepoRoot)`; both `copyClaudeAssetsToWorktree` calls pass `gitCtx`; no raw `child_process` import |
| `adws/phases/diffEvaluationPhase.ts` | `getGitDiff` takes `GitContext \| undefined` as first arg; empty-diff fail-open preserved; no raw `child_process` import |
| `adws/github/prCommentDetector.ts` | `getLastAdwCommitTimestamp(branchName, gitContext, cwd?)` now takes `GitContext` as second arg; `getUnaddressedComments` constructs context via `gitContextForRepo(repoInfo)`; no raw `child_process` import |
| `adws/checkLivingDocsIndex.ts` | `listTrackedFiles` constructs self-host context via `gitContextForRepo(readLocalRepoInfo(), { selfHost: true })`; no raw `child_process` import |
| `adws/github/labelManager.ts` | `LabelManagerDeps` changed from `{ exec }` to `{ gitContextForRepo }`; `ensureAdwLabelsExist` / `applyLabel` delegate to `ctx.createLabel` / `ctx.applyLabel`; private `createLabel` / `addLabelToIssue` helpers deleted; no raw `gh` string literals; lazy-create-and-retry preserved; removed from ALLOWLIST |
| `adws/providers/github/githubBoardManager.ts` | `updateStatusFieldOptions` uses `this.ctx.runGraphQLInput(body)`; `child_process` import removed; all GraphQL calls now route through `GitContext` with PAT; removed from ALLOWLIST |
| `adws/phases/depauditSetup.ts` | `DepauditSetupDeps` gains optional `gitContextForRepo`; `propagateSecret` uses `ctx.setSecret(envName, envValue)`; `execWithRetry` retained for `depaudit setup` CLI invocation; prefers `config.gitContext` when present; removed from ALLOWLIST |
| `adws/triggers/autoMergeHandler.ts` | All 9 raw `execSync('git …')` sites replaced with `ctx` methods (`fetchRemote`, `mergeBranch`, `abortMerge`, `pushBranch`, `fetchAndResetToRemote`); new optional `gitContext?: GitContext` last param on `mergeWithConflictResolution` (defaults to `gitContextForRepo(repoInfo)`); `execSync` import removed; removed from ALLOWLIST |
| `adws/core/remoteReconcile.ts` | `defaultBranchExistsOnRemote` rewrites `execWithRetry('git ls-remote --exit-code …')` (no `cwd`) to `gitContextForRepo(repoInfo).lsRemote(branchName).length > 0`; wrong-`cwd` bug fixed (origin now resolves against the target repo, not `process.cwd()`); `execWithRetry` import removed; removed from ALLOWLIST |

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws `Error: GitContext: <field> must not be empty`
- Self-host identity (`selfHost: true`) always resolves `basePath` to `frameworkRepoRoot`
- Target identity (`selfHost: false`) always resolves `basePath` to `join(targetReposDir, owner, repo)`
- `worktreePathFor` result is determined solely by `basePath` and the branch name — `process.cwd()` has no effect
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
- `#run` always passes an explicit `cwd` and `env` to the exec function — never inherits process working directory or ambient `process.env.GH_TOKEN`
- `defaultExec` sets `maxBuffer: 10 * 1024 * 1024` on all `execSync` calls — both the `input`-branch and the default branch; prevents `ENOBUFS` on large diffs/logs without affecting callers that produce small output
- When `usePat: true` and `#pat` is set, `GH_TOKEN` in the child env is the PAT; otherwise it is the context's primary token. The parent `process.env` is unchanged in both cases.
- Two `GitContext` instances for two repos in one process never share `cwd` or token — `GH_TOKEN` bleed is structurally impossible (no module-global `activeRepo` slot)
- The `activeRepo` module-global and `ensureAppAuthForRepo` were deleted from `githubAppAuth.ts`; all `gh` ops authenticate via the context's per-command child env
- `pushBranch` uses `--force-with-lease --force-if-includes`; a lease rejection throws a descriptive error with manual-remedy instructions (no silent overwrite)
- `resetWorktree` aborts any in-progress merge or rebase (via `git merge/rebase --abort` with fs fallback) before fetching and hard-resetting
- Protected branches (`main`, `master`, `develop`) are refused by `deleteLocalBranch` and `deleteRemoteBranch` (returns `false`)
- `mergeLatestFromDefaultBranch` warns-don't-throw on fetch/merge failures — merge conflicts are non-fatal
- All worktree create/ensure/remove/list/query methods resolve paths under `#basePath` via `#worktreesDir()` and `worktreePathFor()` — no caller-supplied base path
- The package imports nothing from `adws/core`, `adws/providers`, or any ADW global — all config is injected at construction (`findWorktreeForIssue` takes a pre-resolved `prefixes` array so the package stays free of `branchPrefixMap`)
- `listOpenIssues`, `issueComments`, and `fetchMergedPRs` are thin delegators through `#run()` — they do not mutate `process.env` and they use the context's token for per-command auth
- `remoteUrl(cwd?)` and `authenticatedUser()` are thin delegators through `#run()` — same per-command auth and non-mutation guarantee as all other methods
- Probe reads (`resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`) operate on a caller-supplied worktree path; `worktreeBranches`, `localBranches`, `mainRepoPath` accept an optional `cwd` defaulting to `#basePath` — all route through `#run` with per-command auth
- `resolveGitDir` absolutizes a relative `.git` output against the worktree path (`path.resolve`); returns `null` on failure
- `currentBranchSymbolic` returns `null` on detached HEAD or failure (does not throw)
- `worktreeRegistration` returns `'healthy' | 'locked' | 'prunable' | 'missing'`; `'missing'` on failure or path-not-found
- `worktreeBranches` and `localBranches` return `[]` on failure (never throw)
- `mainRepoPath` throws `Error('Could not find main repository in worktree list')` when no non-`.worktrees` entry exists — preserving the throw-on-failure contract of the legacy `getMainRepoPath`
- `lsFiles(cwd, prefix?)` returns `string[]` (blank lines filtered); throws on exec failure — each call site wraps in its own `try/catch`
- `headShort(cwd?)` returns the trimmed short SHA; defaults `cwd` to `#basePath`; throws on exec failure
- `diff(range, cwd)` returns the raw diff string; throws on exec failure
- `log(branchName, cwd?)` returns the raw log string in `"%aI %s"` format; defaults `cwd` to `#basePath`; throws on exec failure
- `gitReadOps` functions propagate errors — they do **not** swallow exceptions; each call site retains its pre-existing `try/catch` (or loud crash for `checkLivingDocsIndex`)
- `fetchRemote(branch, cwd)` issues `git fetch origin "<branch>"` with the given `cwd`; propagates errors — the caller decides warn-vs-throw
- `mergeBranch(ref, cwd, opts?)` builds flag-specific command (`--no-commit`, `--no-ff`, `--no-edit`); propagates errors — a conflicting merge throws; the caller must abort or handle
- `abortMerge(cwd)` swallows errors — aborting with no in-progress merge is a benign no-op; callers should call it unconditionally in both clean-path and catch-path sites
- `lsRemote(branch, cwd?)` issues `git ls-remote origin "<branch>"` **without** `--exit-code`; an absent ref yields empty stdout (exit 0) rather than a throw; genuine failures (network/auth) throw and the caller catches them; defaults `cwd` to `#basePath`
- `setSecret(name, value)` pipes the value via stdin (`--body -`) using the context's primary token; the value never appears in the command string or `process.env`; single-attempt (no `execWithRetry`) — callers wrap in their own `try/catch`
- `runGraphQLInput(body)` serializes `body` as `JSON.stringify(body)` piped via stdin; uses `usePat: true` (Projects V2 writes) with graceful fallback to the context token when no PAT is set — matching the prior `execSync` board-auth behaviour and the `feature-9tknkw` PAT-fallback contract
- `readLocalRepoInfo` in the factory is a permanent bootstrap exception: it calls `execSync('git remote get-url origin')` directly because it *produces* the `RepoInfo` a `GitContext` is constructed from (the `gitContextForRepo` call would be circular). No other bootstrap need should create new raw shell-outs outside the factory.

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
| `pat?` | `string` | Optional PAT for `usePat` ops (PR approve, Projects V2 board, `runGraphQLInput`) |

Optional injectable dependency bag via `GitContextDeps` (second constructor parameter):

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to thin `execSync` wrapper |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction. This is intentional: omitting it was the historical detonation point where ADW silently operated on the wrong repo.
- **`process.env` is never mutated on the operation hot path** — `commandEnv(process.env)` overlays the context's token + identity into a new object. The context token wins for context-routed commands; the parent slot is untouched.
- **`#run` accepts optional `{ cwd?, input?, usePat? }`** — `cwd` overrides the base path for VCS ops on worktrees; `input` pipes data to stdin; `usePat: true` injects `GITHUB_PAT` as `GH_TOKEN` for that one command only (approve PR, Projects V2 GraphQL, `runGraphQLInput`, `setSecret` does NOT use `usePat` — it uses the context's primary token). Never mutates `process.env`.
- **`maxBuffer` is global to `defaultExec`** — raised to 10 MB in #694 for all `execSync` calls, not just `diff`. This is strictly more permissive: commands producing <1 MB output are unaffected; only the previously-failing >1 MB case now succeeds. Spy-`ExecFn` tests do not exercise `maxBuffer`.
- **Worktree ops receive explicit paths, not a base-path arg** — `worktreeCreateOps`, `worktreeQueryOps`, and `worktreeRemoveOps` take pre-computed `worktreesDir`, `worktreePath`, and `baseCwd` from the `GitContext`; they perform no base-path defaulting. The `#worktreePaths(branchName)` private helper binds these from `#basePath`.
- **`findWorktreeForIssue` takes a `prefixes` array** — callers resolve `branchPrefixMap[issueType]` + `branchPrefixAliases[issueType]` before calling; the package does not import ADW core.
- **VCS wrappers in `adws/vcs/` are stripped, not deleted** — `branchOperations.ts`, `commitOperations.ts`, and all worktree files now expose only pure vocabulary functions, thin adapters, or are stubs. All I/O functions have migrated to `GitContext` methods.
- **`getWorktreesDir`, `getWorktreePath`, `worktreeExists` no longer exist** — any code referencing these will fail to compile. Route through `ctx.ensureWorktree()`, `ctx.worktreePathFor()`, or `ctx.getWorktreeForBranch()`.
- **`getMainRepoPath(cwd)` now requires a `cwd` argument** — the no-arg cwd-defaulting form is gone. The only remaining consumer is `claudeAgent.ts`, which always supplies an explicit worktree `cwd`.
- **`activeRepo`/`ensureAppAuthForRepo` are gone** — any code still calling `ensureAppAuthForRepo` will fail to compile. Use `gitContextForRepo(repoInfo).<method>()` instead.
- **`refreshTokenIfNeeded` is now repo-explicit** — it requires optional `(owner, repo)` args; the no-arg form that fell back to `activeRepo` is removed.
- **`gitContextFactory.ts` lives in `adws/github/`** — not in the reusable package, to keep the package free of ADW globals (`REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`, `getInstallationToken`). The factory is the ADW-layer bridge; the package itself is config-injection pure.
- **Board and approve ops require `GITHUB_PAT`** — `usePat: true` falls back to the context token when `GITHUB_PAT` is unset (user-owned repos degrade gracefully, matching prior behaviour from `feature-9tknkw`).
- **`runGraphQLInput` corrects a latent board-auth bug** — `updateStatusFieldOptions` previously called `execSync('gh api graphql --input -')` which inherited the ambient app token. `runGraphQLInput` with `usePat: true` makes the column-update mutation use the PAT like every other board write, with graceful fallback to the context token.
- **`lsRemote` drops `--exit-code` deliberately** — the prior code special-cased git exit-2; routing through `#run` (which throws on any non-zero exit) makes `--exit-code` actively harmful (a normal "branch absent" yields exit 2 and throws). Omitting it gives empty-stdout-means-absent and reserves throws for real failures — simpler and strictly correct for the `length > 0` check.
- **`abortMerge` error-swallowing is load-bearing** — `checkMergeConflicts` always calls `ctx.abortMerge(cwd)` in both the clean-path (`return false`) and the catch-path (`return true`). If `abortMerge` propagated errors, a "no merge in progress" abort on the clean path would throw incorrectly.
- **`mergeWithConflictResolution` optional `gitContext` param** — the 9th argument is optional; omitting it falls back to `gitContextForRepo(repoInfo)`. `adwMerge.tsx` binds the launch-boundary `GitContext` via a lambda in `buildDefaultDeps`; `autoMergePhase.ts` passes `config.gitContext`. Non-threading callers get a correct per-repo context automatically.
- **`pushBranchChanges` alignment with hardened push policy** — replacing `git push origin "<branch>"` with `ctx.pushBranch(branchName, cwd)` means the auto-merge loop now uses force-with-lease. This is a deliberate, safe alignment with the codebase push standard; the `boolean` return contract is preserved by wrapping in try/catch.
- **`syncWorktreeToOriginHead` collapse to `fetchAndResetToRemote`** — the two-step fetch+reset-hard is folded into the existing `ctx.fetchAndResetToRemote(headBranch, cwd)` call; the error log message is unified to "Failed to sync worktree to origin/<head>"; the two underlying git commands still emit in fetch→reset order.
- **`remoteReconcile.ts` wrong-`cwd` bug (fixed in #696)** — the previous `execWithRetry('git ls-remote --exit-code origin <branch>')` ran with no `cwd`, resolving `origin` from `process.cwd()` (= ADW framework root in the cron process). `gitContextForRepo(repoInfo).lsRemote(branchName)` resolves `cwd` from the target repo's base path, so `origin` now points at the correct remote. The `ReconcileDeps.branchExistsOnRemote` injection seam is preserved; existing unit tests are unaffected.
- **`setSecret` uses the context primary token, not the PAT** — unlike board writes, `gh secret set` does not require a PAT for org/user-owned repos in typical ADW setups. The command uses `{ input: value }` (stdin pipe); the value is never on argv.
- **`setSecret` is single-attempt** — the previous `execWithRetry` with `maxAttempts: 3` is replaced by a single `ctx.setSecret` call. `propagateSecret` in `depauditSetup.ts` still catches failures and degrades to a warning (`success: true`, `skippedSecrets` populated), so the externally-observable skip-and-warn behavior is preserved.
- **`LabelManagerDeps` shape changed in #695** — from `{ exec, logger }` to `{ gitContextForRepo, logger }`. Tests must inject `gitContextForRepo: (repoInfo) => new GitContext(validOptions(), { exec: spyExec })`. The `@adw-540` BDD mock seam has been rewired accordingly; all recorded command strings are byte-identical (`createLabelCmd`/`applyLabelCmd` builders are reused).
- **`ensureAdwLabelsExist` constructs the context once** — not once per label — while still issuing one `createLabel` per definition. This reduces token-resolution overhead from N to 1.
- **`depauditSetup` context source precedence** — `config.gitContext` (launch-boundary, preferred) → `d.gitContextForRepo(repoInfo)` (factory fallback). Both resolve the same `setSecret` command shape. The `execWithRetry` dep is retained for the `depaudit setup` CLI call (not a `git`/`gh` command).
- **Branch sanitization regex** — `worktreePathFor` sanitizes with `/[/\\:*?"<>|`]/g → '-'`, matching the historical `worktreeOperations.ts` helper for path compatibility post-migration.
- **Injectable exec seam (`ExecFn` / `GitContextDeps`) is for tests, not config** — the seam exists so spy tests can assert per-call `{ cwd, env, input }` without spawning real processes. The default is a real `execSync` wrapper — the only real spawn site in the package.
- **`gitContextForSync` vs `gitContextFor` vs `gitContextForRepo`** — use `gitContextForSync` when you're already in a synchronous initialization path; use `gitContextFor` when you can `await`; use `gitContextForRepo(repoInfo)` in trigger/phase modules that only have a `RepoInfo` object (the most common case in `adws/triggers/` and `adws/phases/`). All produce identical `GitContext` instances.
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global dependency discipline; physical workspace extraction to `packages/git-context/` is deferred.
- **`freeBranchFromMainRepo` preserves non-force push** — the known non-force-push deadlock risk on rewritten branches is tracked separately (#648); the ported semantics are unchanged from the prior vcs implementation.
- **`listOpenIssues` shares command shape across three former allowlisted consumers** — `concurrencyGuard` projects `[number, comments]`, `webhookGatekeeper` projects `[number, body]`, and `docsSelfCheck` projects `[number, title]` with a `search` filter; the `ListOpenIssuesOptions` type captures all three variations.
- **`checkGitGhGuard.ts` `main()` guard** — the guard is now exported as a module to support test imports; `main()` is called only when `process.argv[1]` includes `checkGitGhGuard` (i.e. when run as a script). Tests can import `scanFiles`/`ALLOWLIST` without side-effects.
- **`getAuthenticatedUser` lost `execWithRetry`'s per-call retry** — the new path calls `gitContextForRepo(...).authenticatedUser()` which does not retry internally. The existing `catch` block already fails open to `null` (callers treat `null` as "no self-author filter"), matching the #691 retry-loss precedent for `docsSelfCheck`. This is acceptable.
- **`readLocalRepoInfo` is the only correct place for a bootstrap git-remote read** — any future need to derive identity before a `GitContext` exists must extend or call this function (not duplicate a raw `execSync('git remote get-url origin')` elsewhere). The `checkGitGhGuard.ts` ALLOWLIST treats `gitContextFactory.ts` as a permanent bootstrap entry for exactly this reason.
- **`remoteUrl(cwd)` in `validateGitRemote` now requires a resolvable token** — previously the read was token-free (just a local git invocation). `gitContextForRepo` resolves an auth token at construction; if token resolution throws, the existing `try/catch` in `validateGitRemote` surfaces the same "Failed to get git remote URL" error class. ADW's authenticated workflow paths always have a token available.
- **`buildDefaultProbeDeps` now requires a `GitContext` arg** — the no-arg form is gone; `probeWorktree` and `clearOrphanedIndexLock` require explicit `deps`. The only production caller (`takeoverHandler.ts` `buildDefaultTakeoverDeps`) now constructs a context from `repoInfo` and passes `buildDefaultProbeDeps(ctx)`. `repoInfo` is required for probe operations; the closures throw the same guard as the existing `resetWorktree` closure when `repoInfo` is absent.
- **`branchOperations.deleteLocalBranch` is gone** — it was dead code (not exported by `vcs/index.ts`, no external callers). `GitContext.deleteLocalBranch` is the only `git branch -D` entry point.
- **`orchestratorLib` no longer re-declares `deriveOrchestratorScript`/`orchestratorNamesForScript`** — those were extracted to `adws/core/orchestratorNames.ts` and re-exported from `orchestratorLib.ts` for backwards compatibility; callers of `orchestratorLib` are unaffected.
- **`worktreeProbeOps.ts` is distinct from `worktreeQueryOps.ts`** — `worktreeProbeOps` handles reads on an *arbitrary caller-supplied* worktree path (probe registration, git-dir, current-branch); `worktreeQueryOps` handles the context's own worktree tree (list, find, main-repo-path, worktree-branches). The split keeps both files under 300 lines.
- **Thin-adapter calls construct a `GitContext` per call** — `getMainRepoPath`, `getDefaultBranch`, `hasUncommittedChanges`, `defaultListCandidateBranches` all call `gitContextForRepo(readLocalRepoInfo(cwd))` on every invocation. These are all cold paths (agent spawn, rare upgrade-claim, once-per-workflow safety net, workflow-init fallback), so token resolution cost is negligible.
- **`copyClaudeAssetsToWorktree` signature changed in #694** — now requires `(worktreePath: string, gitContext: GitContext)`. The only production callers are in `workflowInit.ts` (two sites, both updated). Any other caller will fail to compile.
- **`getLastAdwCommitTimestamp` signature changed in #694** — now `(branchName: string, gitContext: GitContext, cwd?: string)`. The only production caller is `getUnaddressedComments` in `prCommentDetector.ts` (updated). Public signatures of `getUnaddressedComments`/`hasUnaddressedComments` are unchanged — `trigger_cron.ts` and `prReviewPhase.ts` are unaffected.
- **`headShort(frameworkRepoRoot)` is intentional for the ADW version log** — it logs the *framework* repo's HEAD commit, not the target repo's. Even when `gitCtx` is a target context, `cwd` is overridden to `frameworkRepoRoot` so the read is always framework-relative. `git rev-parse` requires no auth.
- **`git log`/diff base-path correction (latent-bug fix)** — `prCommentDetector`'s `git log` previously ran with an implicit `process.cwd()` (= framework `REPO_ROOT` for the cron). For self-host runs `basePath` equals that, so behavior is identical. For target repos, routing through `GitContext` makes `git log` run in the correct target-repo `basePath` instead of the framework root where the branch does not exist. This is a fix, not a regression.
- **`checkLivingDocsIndex` now requires auth context** — constructs a real `GitContext` via `gitContextForRepo(readLocalRepoInfo(), { selfHost: true })`, which resolves a token. The gate is a manually/CI-run one-off (not in `package.json` scripts), and CI/operators have `gh` auth available. Do not weaken `GitContext`'s mandatory-token contract for token-free local runs.
- **`gitReadOps` errors propagate by design** — distinct from `worktreeProbeOps`, whose callers expected swallow-to-null/`missing`. Each `gitReadOps` function lets exec errors bubble; each call site retains its own `try/catch` (or no-catch for `checkLivingDocsIndex`, which crashes loudly on failure — preserved behavior).
