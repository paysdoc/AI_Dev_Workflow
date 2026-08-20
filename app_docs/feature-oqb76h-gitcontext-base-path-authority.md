# GitContext Package — Repo-Context Authority, Per-Command Env Injection, Bootstrap Absorption & Token Veracity

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`) and an optional `pat` for PAT-requiring operations. Every operation — branch create/checkout/delete, commit/push (force-with-lease), fetch/reset, worktree create/ensure/remove/list/query, worktree/branch probe reads, git phase-level reads (`lsFiles`, `headShort`, `diff`, `log`, `logSince`), remote fetch/merge/abort/ls-remote (`fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`), all `gh`/GitHub-API operations (issue read/comment, PR read/create+label/merge/approve/changed-files, label lifecycle, Projects V2 board, secret set), and the `git remote get-url origin` identity read — is a method on `GitContext`, running through `exec(command, options: ExecOptions)` (promoted to a **public** method in #790) — the package's single spawn site, single env merge, and single ENOENT-rewrap `catch`. `exec()` itself is deliberately forge-neutral: it takes `command` as a separate first positional parameter (never folded into `options`, so `adws/checkGitGhGuard.ts`'s `git-gh-shellout` rule keeps inspecting it) and an `options.cwd: ExecWorkingDirectory` — a working-directory CLASS the caller declares, never a bare path and never a `process.cwd()` fallback — plus a pre-assembled `options.env` credential overlay and optional `options.input` for stdin. It knows nothing about forge semantics: no token selection, no PAT-versus-installation-token discrimination, no GitHub vocabulary anywhere in its signature. `exec()` is the public primitive a forge adapter built on this package (#792) uses instead of reimplementing spawn discipline.

Two private classifiers sit in front of `exec()`, choosing the working-directory CLASS and assembling the credential env from `commandEnv()`, then delegating:

- **`#run(command, opts?)`** — the workspace-scoped classifier: git commands and workspace-scoped operations (branch/commit/worktree/remote/claim ops, all git phase-level reads, `remoteUrl`, `remotes`, `gitConfigUser`). Calls `exec()` with `{kind: 'workspace', path: opts.cwd}` — `basePath` when `opts.cwd` is omitted, or an explicit worktree path when supplied. A spawn failure caused by that resolved cwd not existing on this host — never cloned, or a worktree that vanished — is rewrapped (via `workingDirectoryGuard.ts`, inside `exec()`) into an error naming the path and repository identity while preserving `code: 'ENOENT'`; every other failure propagates verbatim (issue #777).
- **`#runRepoApi(command, opts?)`** (added in #775) — the framework-root classifier for the ~38 repo-API `gh` operations (issue/PR/label/board/secret ops, `defaultBranch`, `authenticatedUser`). Calls `exec()` with `{kind: 'frameworkRoot'}` — always the injected `frameworkRepoRoot` regardless of whether the target workspace has ever been cloned, and structurally unable to accept a `cwd` override (the type has no `path` field on this variant). These commands carry their repository identity in the command string (`--repo owner/repo`, `gh api repos/owner/repo/…`, or GraphQL variables), not in the cwd, so they need no target workspace at all. This is what lets a Cancel/Retry directive be processed on a host that has never cloned the target repo (issue #775 — previously `#basePath` for a target repo is lifecycle state that only exists post-clone, so a pre-clone `gh` call spawned into a nonexistent directory and failed as `spawnSync /bin/sh ENOENT`).

Both classifiers pass their `env` to `exec()` from the same `commandEnv()` overlay, so auth/env behaviour (credential, git identity, no `process.env` mutation) is identical either way — only the `ExecWorkingDirectory` CLASS differs, chosen by the caller, never inferred by probing whether a directory happens to exist or by reading what the command string means. As of #791, `commandEnv()` resolves its credential through the **TokenProvider port** (`credentialEnv({owner, repo, purpose})`) on every call — never cached by the core — and the two classifiers declare only a forge-neutral `CredentialPurpose` (`'default' | 'alternateIdentity'`); the provider alone decides which credential answers it. The core holds no token: construction probes the provider once to fail loudly on a bad credential source, then discards the answer. `createGitHubTokenProvider` is the port's GitHub implementation; as of #792 it lives in the GitHub forge adapter (`adws/providers/github/githubTokenProvider.ts`), not in this package. `token`/`pat` remain on `GitContextOptions` only as the transitional literal-credential path for the ~350 existing construction sites not yet migrated to a provider.

**TRANSITIONAL upward dependency (#792):** `gitContext.ts` still imports the five GitHub command-string builder modules (`issueCommands`, `prCommands`, `labelCommands`, `secretCommands`, `boardCommands`) from `../providers/github/commands/...` for the semantic methods it still owns (`fetchIssue`, `commentOnIssue`, `createPR`, `setSecret`, etc.). This is a deliberate, called-out exception to the package's forge-neutrality: the core temporarily depends upward on the adapter that now owns the builders. It is deleted once those semantic methods migrate out to their callers in future issues #796/#797, at which point the core has no GitHub-specific import left at all.

As of #700, the package also owns the **bootstrap pre-context primitives** that must run *before* a `GitContext` can be constructed: local remote-URL + git-identity resolution (`bootstrapIdentity.ts`) and target-repo workspace clone/fetch (`repoWorkspace.ts`). These are structurally exempt (the guard skips `adws/gitContext/` by directory), eliminating the bootstrap ALLOWLIST category entirely. As of #792, GitHub App token minting (`appAuth.ts`) and the veracious token resolver (`tokenResolver.ts`) moved out of this package into the GitHub forge adapter (`adws/providers/github/`) — see `app_docs/feature-e2er82-github-forge-adapter.md`. As of #793, `bootstrapIdentity.ts` itself split along the git/GitHub line: the core keeps only generic git reads (`readOriginRemoteUrl`, `readEnvGitIdentity`, `readGitConfigIdentity`); GitHub remote-URL parsing, App bot-identity derivation, and `gh auth token` moved to the adapter's `githubIdentity.ts`/`ghAuthToken.ts` (see `app_docs/feature-e2er82-github-forge-adapter.md`). `repoWorkspace.ts` no longer rewrites the clone URL it is handed — the HTTPS→SSH conversion (`convertToSshUrl`) moved to the adapter's `cloneUrl.ts` and is applied one call frame earlier, by `adws/core/targetRepoManager.ts`, before `ensureRepoWorkspace`/`cloneRepo` ever see the URL. The four former bootstrap adapter files (`launchGitContext.ts`, `gitContextFactory.ts`, `githubAppAuth.ts`, `targetRepoManager.ts`) remain thin delegators with zero raw `git`/`gh` strings — they now delegate the token- and identity-related primitives to the forge adapter instead of to this package. As of #701, `adws/github/githubAppAuth.ts` is no longer a pure re-export shim: as of #792 it is the sole environment-binding site — the only place in the codebase that reads `GITHUB_APP_ID`/`GITHUB_APP_SLUG`/`GITHUB_APP_PRIVATE_KEY_PATH` from `process.env`, read fresh on every call, and passed as a `GitHubAppConfig` value into the adapter's `isGitHubAppConfigured`/`getInstallationToken`. The Claude subprocess still receives its `GH_TOKEN` + git identity per-invocation from the launch-boundary `GitContext.commandEnv()` via the `subprocessEnv` overlay in the agent chokepoints (`claudeAgent.ts` / `commandAgent.ts`). As of #793, logging inside the package arrives through an injected `Logger` port (`(message: string, level?: LogLevel) => void`, declared in `types.ts`) rather than an import of the host application's logger — `consoleLogger.ts` is the console default, and the three production construction sites (`gitContextFactory.ts` ×2, `launchGitContext.ts` ×1) inject the real ADW `log` so output stays byte-identical. This closed the package's last two imports of ADW application code: `worktreeCreateOps.ts` and `worktreeRemoveOps.ts` previously imported `log` from `../core/utils`; they now take `log: Logger` as a threaded parameter instead. This module implements PRD `specs/prd/git-context-repo-authority.md` and eliminates the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally.

## Responsibilities

- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including an omitted `selfHost` boolean discriminator)
- Validate credentials at construction as exactly-one-of `tokenProvider` or `token` (transitional); when a `tokenProvider` is supplied, probe it once with a `'default'` request and discard the answer — the probe exists to fail loudly on a bad credential source, never to cache a result (#791)
- Resolve `basePath` once in the constructor: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — never consulting `process.cwd()`
- Produce a per-command child-process environment overlay via `commandEnv(base?, purpose?)`: fresh object with the TokenProvider port's per-call credential + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` — never mutates `process.env`, never memoises the credential (#791)
- Expose `exec(command, options: ExecOptions)` as a **public** method (issue #790) — the package's single spawn site, single env merge, and single ENOENT-rewrap `catch`: `command` is the first positional parameter (guard-preserving, see Overview); `options.cwd: ExecWorkingDirectory` is a working-directory CLASS the caller declares, never a bare path and never a `process.cwd()` fallback; `options.env` is a fully-assembled per-command credential overlay (the caller merges it, not `exec()`); `options.input` is optional stdin; the return value is stdout, trimmed; a global `maxBuffer: 10 MB` ceiling prevents `ENOBUFS` on large diffs/logs
- Choose the working-directory class and assemble the credential env via two private classifiers that delegate to `exec()`: `#run(command, opts?)` for git commands and workspace-scoped operations (`{kind: 'workspace', path?}`, defaulting to `basePath` or narrowed to `opts.cwd` for an explicit worktree; optional forge-neutral `purpose: CredentialPurpose`, private and temporary) and `#runRepoApi(command, opts?)` for the ~38 repo-API `gh` operations (`{kind: 'frameworkRoot'}`, added in #775 — never `basePath`, never an override — the variant carries no `path` field, so an override is unrepresentable, not merely unpassed — so these commands run from a directory that always exists regardless of target-workspace clone state)
- Diagnose a spawn failure caused by a missing working directory at the moment it fails — never by a pre-spawn existence check — and rewrap it, inside `exec()`, into an error naming the resolved `cwd`, the `owner/repo`, and the `selfHost` discriminator, while every other failure (including a real git failure inside a `cwd` that does exist) propagates untouched (issue #777)
- Provide branch operations: `getCurrentBranch`, `mergeLatestFromDefaultBranch`, `fetchAndResetToRemote`, `deleteLocalBranch`, `deleteRemoteBranch`, `defaultBranch`
- Provide commit/push operations: `commitChanges`, `removeAndCommitPaths(paths, message, worktreePath)` (scoped `git rm --ignore-unmatch` + commit limited to exactly `paths`), `pushBranch` (force-with-lease + lease-rejection detection), `getHeadTreeHash`, `hasUncommittedChanges`
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
- Expose the full `gh` issue, PR, label, board, and secret operation surface as thin methods that delegate to pure command-builder + parser modules; as of #792 these builder modules live in `adws/providers/github/commands/` (the GitHub forge adapter), imported TRANSITIONALLY (see Overview)
- Accept an injectable `ExecFn` via `GitContextDeps` for hermetic testing
- Accept an injectable `Logger` port via `GitContextDeps.logger`, defaulting to `consoleLogger` (#793) — the package's last two imports of ADW application code (`worktreeCreateOps.ts`/`worktreeRemoveOps.ts` importing `log` from `../core/utils`) are gone; the constructor resolves `#log = deps.logger ?? consoleLogger` and threads it through the six worktree/workspace op call sites
- Export only `GitContext` class and its public types — including `ExecWorkingDirectory` and `ExecOptions` as of #790, and `Logger`/`LogLevel` as of #793 — plus the bootstrap-exception symbols (now generic-git-only, #793) via `adws/gitContext/index.ts`

### Bootstrap package modules (absorbed in #700, structurally exempt)

The two modules below live inside the structurally-exempt `adws/gitContext/` directory. They are the *only* legitimate permanent site for pre-context git reads (git remote/identity reads, workspace clone/fetch). GitHub App token minting and token resolution moved out of this package to the GitHub forge adapter in #792; as of #793, GitHub remote-URL parsing, App bot-identity derivation, `gh auth token`, and clone-URL rewriting moved out too — see `app_docs/feature-e2er82-github-forge-adapter.md`. ADW adapters (`gitContextFactory.ts`, `launchGitContext.ts`, `githubAppAuth.ts`, `targetRepoManager.ts`) delegate to these (and to the forge adapter, for token/identity/clone-URL concerns) and contain zero raw `git`/`gh` strings.

| Module | Exports |
|---|---|
| `bootstrapIdentity.ts` | Generic **git** reads only (#793) — no forge vocabulary. `readOriginRemoteUrl(cwd?): string` — `git remote get-url origin`, trimmed; throws with the raw git failure, leaving parsing to the adapter. `readEnvGitIdentity(env): GitIdentity \| null` — `GIT_AUTHOR_*`/`GIT_COMMITTER_*`; null when incomplete. `readGitConfigIdentity(deps?): GitIdentity \| null` — `git config user.name`/`user.email`; null on any git failure. `GitConfigIdentityDeps` (`exec?`, `env?`). No default identity of its own — the core supplies no forge fallback. |
| `repoWorkspace.ts` | `getTargetRepoWorkspacePath(owner, repo, targetReposDir)`, `isRepoCloned(workspacePath, fsDeps?)`, `cloneRepo(cloneUrl, workspacePath, opts?)`, `ensureRepoWorkspace(owner, repo, cloneUrl, deps)`. `ensureRepoWorkspace` clones the `cloneUrl` it is handed **verbatim** when absent (#793 — no rewriting, no `github.com` literal; the HTTPS→SSH rewrite is the adapter's `convertToSshUrl`, applied by `targetRepoManager.ts` before this module is called); otherwise runs `git fetch origin` and calls the injected `getDefaultBranch` thunk under per-command veracious auth — fixing the ambient-auth `gh repo view` crash class. `EnsureRepoWorkspaceDeps.log` and `cloneRepo`'s `opts.log` are typed `Logger` (the injected logger port), not a bespoke callback shape. |
| `consoleLogger.ts` | `consoleLogger: Logger` — the default logger port (#793): every level to `console.log`, matching the host logger's single-stream behaviour. |

The GitHub-specific half of the old combined `bootstrapIdentity.ts` (`parseGitHubRemoteUrl`, `readLocalRepoInfo`, App bot-identity derivation, `ghAuthToken`, and the HTTPS→SSH `convertToSshUrl`) now lives in the GitHub forge adapter's `githubIdentity.ts`/`ghAuthToken.ts`/`cloneUrl.ts` — see `app_docs/feature-e2er82-github-forge-adapter.md`. The adapter composes the core's generic readers rather than shelling out itself.

### Token Veracity

Token minting and resolution (`appAuth.ts`, `tokenResolver.ts`, `githubTokenProvider.ts`) no longer live in this package as of #792 — they moved to the GitHub forge adapter (`adws/providers/github/`). See `app_docs/feature-e2er82-github-forge-adapter.md` for the resolution order, the `resolveContextToken`/`createGitHubTokenProvider` contracts, and the GH_TOKEN-bleed history. This package's `commandEnv()` reaches that resolution only through the injected `TokenProvider` port (`GitContextOptions.tokenProvider`) — it holds no token-resolution logic of its own.

### Package-private operation modules

Each module is side-effect-free except at the injected runner/fs seam and stays under 300 lines:

| Module | Exports |
|---|---|
| `branchOps.ts` | Branch create/checkout/delete/merge/fetch/reset runners; `localBranches` |
| `commitOps.ts` | Commit/push/hash/dirty-check runners; `removeAndCommitPaths` (`git rm -f --ignore-unmatch` scoped to given paths, commits only if that staged something, idempotent when paths are already absent) |
| `worktreeResetOps.ts` | Abort-in-progress-op + fetch/reset --hard/clean |
| `worktreeCreateOps.ts` | `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo` — each takes `log: Logger` as a threaded parameter (#793: no import of the host application's logger) |
| `worktreeQueryOps.ts` | `listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`; `mainRepoPath`, `worktreeBranches`; exports `WorktreeForIssueResult` type |
| `worktreeRemoveOps.ts` | `removeWorktree`, `removeWorktreesForIssue`, `parseWorktreeBranches`; injects `killProcesses` fn; `log: Logger` threaded parameter (#793) |
| `worktreeProbeOps.ts` | `resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`; exports `WorktreeRegistration` union type; handles arbitrary worktree paths supplied by the caller |
| `gitReadOps.ts` | `lsFiles`, `headShort`, `diff`, `log`; `logSince` + exports `LogSinceOptions`; pure functions over an injected `Runner` seam; errors propagate — no internal swallow |
| `remoteOps.ts` | `fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`; remote-interaction + merge ops over an injected `Runner` seam; all propagate errors except `abortMerge` (swallows — aborting with no in-progress merge is benign) |
| `claimOps.ts` | `addDetachedWorktree`, `commitAllowEmpty`, `pushHeadToBranch`, `removeDetachedWorktree`; upgrade-claim distributed-lock verbs; all propagate errors except `removeDetachedWorktree` (swallows). `pushHeadToBranch` emits **no** `--force` flag by design — the non-fast-forward rejection IS the lock. |
| `processCleanup.ts` | `killProcessesInDirectory` (lsof + SIGTERM→SIGKILL, self-PID filter); re-exported from `vcs/worktreeCleanup.ts` for legacy callers |
| `workingDirectoryGuard.ts` | `isSpawnEnoent`, `describeMissingWorkingDirectory`, `rewrapMissingWorkingDirectory` — turns a spawn-into-a-missing-cwd `ENOENT` into an error naming the path and repository identity; pure (no `fs`, no spawn — the existence probe is injected); used only by `#run`'s catch block (issue #777) |

As of #792, the pure GitHub command-string builder modules (`issueCommands.ts`, `prCommands.ts`, `labelCommands.ts`, `boardCommands.ts`, `secretCommands.ts`) no longer live in `adws/gitContext/commands/` — that directory is gone. They moved, byte-for-byte, to `adws/providers/github/commands/`. `gitContext.ts` still imports them (see the TRANSITIONAL upward dependency noted in the Overview) for its surviving semantic methods; see `app_docs/feature-e2er82-github-forge-adapter.md` for their contracts.

## Boundary Adapters (rewired to zero raw git/gh in #700; process.env writes deleted in #701)

The four former bootstrap files now contain zero raw `git`/`gh` strings — they are thin delegates to package primitives with stable public import paths.

### `adws/github/gitContextFactory.ts`

`gitContextFor({ owner, repo, selfHost })`, `gitContextForSync(...)`, and `gitContextForRepo(repoInfo)` construct a `GitContext` from ambient ADW identity:
- Token resolution: delegates to `resolveContextToken` (as of #792, the GitHub forge adapter's `adws/providers/github/tokenResolver.ts`, not this package). App → bound mint (loud throw on foreign identity); else PAT (`GITHUB_PAT`); else `ghAuthToken()`; **never** reads `process.env.GH_TOKEN`.
- Git identity resolution: delegates to `resolveBootstrapGitIdentity` (as of #793, the GitHub forge adapter's `adws/providers/github/githubIdentity.ts`, not this package). Resolution order: App-slug bot → `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env → `git config user.*` → `ADW Bot`.
- `readLocalRepoInfo(cwd?)`: as of #793, imported from the adapter's `adws/providers/github/githubIdentity.ts` and re-exported at this file's stable path (`:87`) — the chicken-and-egg bootstrap read; all ~20 callers of `githubApi.getRepoInfo` and the ~9 downstream importers of this re-export are unaffected.
- `getSelfHostIdentity` uses `readLocalRepoInfo(REPO_ROOT)` (adapter) instead of a raw `git remote get-url` shell-out.
- `gitContextFor`/`gitContextForSync`/`gitContextForRepo` retained — inject `REPO_ROOT`/`TARGET_REPOS_DIR`/`GITHUB_PAT`, keeping the package ADW-global-free.

### `adws/core/launchGitContext.ts`

`buildLaunchGitContext(deps)` constructs the launch-boundary `GitContext` for cron, webhook, and workflowInit:
- `resolveLaunchToken(owner, repo)`: delegates to `resolveContextToken` (as of #792, imported from the GitHub forge adapter's `adws/providers/github/tokenResolver.ts`, not from this package) — no `process.env.GH_TOKEN` fallback.
- `resolveLaunchGitIdentity()`: delegates to `resolveBootstrapGitIdentity` (as of #793, imported from the adapter's `adws/providers/github/githubIdentity.ts`).
- Local remote read: uses the adapter's `readLocalRepoInfo` (as of #793).
- `buildLaunchGitContext`, `LaunchGitContextDeps`, and exported names preserved for 3 callers.

### `adws/github/githubAppAuth.ts` (sole environment-binding site as of #792)

- As of #701 this was a pure re-export shim from the package's `appAuth.ts`. As of #792, `appAuth.ts` moved to the GitHub forge adapter (`adws/providers/github/appAuth.ts`) and now takes an injected `GitHubAppConfig` instead of reading `process.env` itself — so `adws/github/githubAppAuth.ts` is no longer a bare re-export. It is now the **sole environment-binding site**: the only place in the codebase that reads `GITHUB_APP_ID`/`GITHUB_APP_SLUG`/`GITHUB_APP_PRIVATE_KEY_PATH` from `process.env` — read fresh on every call via `readAppConfig()`, not captured once at module load, so a process that exports these variables after module load is still seen. `isGitHubAppConfigured()`/`getInstallationToken(owner, repo)` build a `GitHubAppConfig` from the freshly-read env and pass it into the adapter's same-named functions, preserving the stable zero-argument-App-config public signature for all existing consumers.
- **No `process.env` writes remain.** `activateGitHubAppAuth`, `refreshTokenIfNeeded`, and `configureGitIdentity` were deleted in #701. The subprocess auth they previously provided is now sourced per-invocation from the launch-boundary `GitContext.commandEnv()` via the `subprocessEnv` overlay in `claudeAgent.ts`/`commandAgent.ts`.
- Zero raw `git`/`gh` strings; zero `process.env` mutations (only reads).

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
| `adws/github/gitContextFactory.ts` | `resolveToken` → `resolveContextToken`; `deriveGitIdentity` → `resolveBootstrapGitIdentity`; `readLocalRepoInfo` re-exported (as of #793, sourced from the adapter's `githubIdentity.ts`); `getSelfHostIdentity` uses `readLocalRepoInfo(REPO_ROOT)` |
| `adws/core/launchGitContext.ts` | `resolveLaunchToken` → `resolveContextToken`; `resolveLaunchGitIdentity` → `resolveBootstrapGitIdentity`; `getRepoInfo` default uses adapter `readLocalRepoInfo` (as of #793) |
| `adws/github/githubAppAuth.ts` | Re-exports mint from `appAuth.ts`; process.env writes deferred (removed in #701); as of #792 `appAuth.ts` itself moved to the GitHub forge adapter and this file became the sole environment-binding site, not a bare re-export — see Boundary Adapters below |
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
| `adws/github/githubAppAuth.ts` | Sole environment-binding site as of #792 (no raw git/gh, no `process.env` writes — only reads, per-call); delegates the mint itself to the forge adapter's `appAuth.ts` via an injected `GitHubAppConfig` |
| `adws/core/targetRepoManager.ts` | Re-export shim; no raw git/gh; `ensureTargetRepoWorkspace` delegates with veracious auth |

## Contracts & Invariants

- Construction with any missing/empty identity field or non-boolean `selfHost` throws `Error: GitContext: <field> must not be empty`
- Self-host identity resolves `basePath` to `frameworkRepoRoot`; target identity resolves to `join(targetReposDir, owner, repo)`
- `worktreePathFor` result is determined solely by `basePath` and branch name — `process.cwd()` has no effect
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
- `exec()` throws `Error: GitContext: exec command must not be empty` on a blank/whitespace-only `command`, and `Error: GitContext: exec working directory path must not be empty` on a `{kind: 'workspace', path: ''}` (blank-but-defined path is rejected; `path: undefined` is the valid "use basePath" form)
- `exec()`'s `options.env` is merged as `{...process.env, ...options.env}` inside the method — `process.env` itself is never mutated, and the caller-supplied overlay always wins on key collision
- `#run` always passes an explicit `{kind: 'workspace', ...}` cwd class and a pre-assembled `env` to `exec()` — never inherits process working directory or ambient `process.env.GH_TOKEN`
- `#runRepoApi` always passes `{kind: 'frameworkRoot'}` to `exec()` — never `basePath`, never the ambient process cwd, and never falls back to `basePath` when `frameworkRepoRoot` happens to be missing on disk (that would resurrect the cwd-varies-with-lifecycle-state bug #775 fixes); identity for these commands comes from the command string, not the cwd
- `defaultExec` sets `maxBuffer: 10 * 1024 * 1024` on all `execSync` calls
- The credential in the child env is resolved through the TokenProvider port on every call (#791) — never cached by the core; on the transitional literal-credential path, `purpose: 'alternateIdentity'` with `pat` set yields the PAT, else the primary `token`; parent `process.env` is unchanged either way
- Two `GitContext` instances for two repos never share `cwd` or a credential — a provider request always carries its own context's `owner`/`repo`, so `GH_TOKEN` bleed is structurally impossible
- `activeRepo` and `ensureAppAuthForRepo` were deleted from `githubAppAuth.ts`; all `gh` ops authenticate via per-command child env
- `activateGitHubAppAuth`, `refreshTokenIfNeeded`, and `configureGitIdentity` no longer exist — no `process.env` mutation remains in the hot path
- The Claude subprocess receives per-command `GH_TOKEN` + `GIT_*` via the `subprocessEnv` overlay in `claudeAgent.ts`; the spawn env is `{ ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) }` — never mutates `process.env`
- `pushBranch` uses `--force-with-lease --force-if-includes`; lease rejection throws with manual-remedy instructions
- `removeAndCommitPaths` never touches paths outside the given list — no `git add -A`; unrelated dirty state in the worktree is left untouched. Returns `false` (no commit) when the given paths were already absent from the index
- `resetWorktree` aborts any in-progress merge/rebase before fetching and hard-resetting
- Protected branches (`main`, `master`, `develop`) refused by `deleteLocalBranch` and `deleteRemoteBranch`
- Package imports nothing from `adws/core` or any ADW global — all config injected at construction. As a TRANSITIONAL exception (#792), `gitContext.ts` does import the GitHub command-string builders from `adws/providers/github/commands/` for its surviving semantic methods (see Overview); this is a deliberate, called-out upward dependency, not the general package boundary reopening
- **Token veracity (resolveContextToken):** when App is configured, returns only a mint bound to `owner/repo` and propagates any throw loudly (foreign/uninstalled identity = hard error, never substitutes ambient token). Never reads `process.env.GH_TOKEN` as a token source.
- **Bootstrap exception (bootstrapIdentity.ts):** `readOriginRemoteUrl`, `readEnvGitIdentity`, and `readGitConfigIdentity` are the only legitimate pre-context git reads left in the core (#793 narrowed this from the pre-split `readLocalRepoInfo`/`resolveBootstrapGitIdentity`, now in the adapter); they live inside the exempt package and are not on any ALLOWLIST
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
| `tokenProvider?` | `TokenProvider` | The supported credential path (#791) — a port asked once per command via `credentialEnv({owner, repo, purpose})`; the core holds no token of its own. Exactly one of `tokenProvider`/`token` is required. |
| `token?` | `string` | TRANSITIONAL literal-credential path — a resolved string, captured once at construction. Kept so existing construction sites stay untouched; production passes `tokenProvider` instead. Removed in #792/#796. |
| `gitIdentity` | `GitIdentity` | Author + committer name/email for git operations |
| `frameworkRepoRoot` | `string` | Absolute path to ADW framework repo root (injected from `REPO_ROOT`) |
| `targetReposDir` | `string` | Absolute path to cloned target repos directory (injected from `TARGET_REPOS_DIR`) |
| `pat?` | `string` | TRANSITIONAL — paired with `token`; the credential the internal `staticCredentialProvider` serves to `'alternateIdentity'` requests (PR approve, Projects V2 board, `runGraphQLInput`) when `tokenProvider` is not supplied |

Optional injectable dependency bag via `GitContextDeps`:

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to thin `execSync` wrapper |
| `logger` | `Logger?` | Injectable logger port (#793) — `(message: string, level?: LogLevel) => void`; defaults to `consoleLogger`. Production construction sites inject the real ADW `log`. |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction
- **`process.env` is never mutated on the operation hot path** — `commandEnv(process.env)` overlays into a new object
- **`resolveContextToken` never reads `process.env.GH_TOKEN`** — the ambient-global fallthrough was the GH_TOKEN-bleed vector. Any token returned is provably bound to the given `owner/repo`. A foreign/uninstalled App identity throws loudly instead of silently adopting a wrong-repo token.
- **No `process.env` writes exist in the hot path (#701)** — `activateGitHubAppAuth`, `refreshTokenIfNeeded`, and `configureGitIdentity` are deleted. The subprocess env overlay (`subprocessEnv` in agent chokepoints) is the only auth path for the Claude CLI subprocess. When no App is configured (self-host without a configured App), the overlay is omitted and the subprocess uses `gh auth login` credentials — no regression.
- **Subprocess env overlay is built fresh per-invocation** — `{ ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) }` creates a new object each time; `process.env` is never written.
- **`ensureRepoWorkspace` `getDefaultBranch` thunk must use veracious auth** — callers inject `() => ctx.defaultBranch()` where `ctx` is a `GitContext` for the target repo. This is the structural fix for the `fetchLatestRefs` crash class where `gh repo view` ran under ambient/wrong-repo auth.
- **`exec()` is the promoted public spawn site (issue #790)** — the two classifiers (`#run`, `#runRepoApi`) and every method that used to call them still funnel through `exec()`; the private `#execFn` field (renamed from `#exec` to make room for the public `exec()` method name) is the only thing that changed at the injectable-runner seam — `GitContextDeps.exec` still works identically for hermetic tests
- **`ExecWorkingDirectory` is a discriminated union, not a plain `{ cwd?: string }`** — `{kind: 'workspace', path?}` vs `{kind: 'frameworkRoot'}` (no `path` field at all on the latter). A caller cannot pass a `cwd` override to the framework-root class even by mistake — TypeScript rejects it. Any refactor that collapses these into one shape with an optional `path` reopens the #775 override-the-fixed-cwd bug class
- **`exec()`'s `options.env` is not `commandEnv()`'s raw output** — callers (the two classifiers) build `env` from `commandEnv({}, purpose)` before passing it to `exec()`; `exec()` itself does not know about credentials, the TokenProvider port, or git identity, it only merges whatever `env` object it receives over `process.env`
- **`#run` accepts optional `{ cwd?, input?, purpose? }`** — `cwd` overrides base path for ops on worktrees (translated to `{kind: 'workspace', path: cwd}` before reaching `exec()`); `input` pipes data to stdin; `purpose: 'alternateIdentity'` asks the TokenProvider port for the elevated credential class for that one command only (#791). `purpose` is forge-neutral and lives only on this private opts shape — it never reaches `exec()`'s public `ExecOptions`
- **`workingDirectoryGuard.ts` detects on `code === 'ENOENT'`, never the message** (issue #777) — node reports a missing spawn cwd as `spawnSync /bin/sh ENOENT`, bun as `ENOENT: no such file or directory, posix_spawn '/bin/sh'`; only `code`/`syscall`/`path` are identical across runtimes. A pre-spawn `existsSync` guard is **not** viable: every GitContext test drives the context with imaginary paths (`FRAMEWORK_ROOT`/`TARGET_REPOS_ROOT` sentinels) and `gitContextSharedWorld.ts`'s `makeNoOpFsDeps()` hardcodes `existsSync: () => false`, so a pre-spawn check would throw in nearly every existing test. The rewrap therefore fires only in `exec()`'s `catch` block, after a real `ENOENT`-coded spawn failure, and only when the resolved `cwd` is confirmed absent via the injected `fsDeps.existsSync` — never at construction, never cached. The rewrapped error **must keep `code: 'ENOENT'`** (plus the original as `cause`) or the merged `@adw-775` §10 regression scenario (`feature-775.steps.ts:334-337`, which asserts `err.code === 'ENOENT'` on a real pre-clone spawn failure) goes RED.
- **`#runRepoApi` (issue #775) accepts no `cwd` override** — `{ input?, usePat? }` only; a fixed cwd is the whole point. It calls `exec()` with `cwd: {kind: 'frameworkRoot'}` hardcoded. Adding a `path` field to the `frameworkRoot` variant, or a `cwd` param to `#runRepoApi`, would silently reopen the class of bug it exists to close.
- **`frameworkRepoRoot` is retained as `#repoApiCwd`** — before #775 the constructor fed `frameworkRepoRoot` to `resolveBasePath` and discarded it (no field kept it). A future refactor that stops passing `frameworkRepoRoot` through to the constructor breaks every repo-API `gh` call pre-clone, not just self-host base-path resolution.
- **Routing a new `gh` method through `#runRepoApi` vs `#run` is a one-time classification decision** — pure GitHub API calls (identity in the command string, or none at all) go through `#runRepoApi`; anything that touches the actual git working tree (branches, commits, worktrees, `git remote`/`git config`) stays on `#run`. Getting this wrong for a *git* command would silently answer from the framework checkout instead of the target repo — see the `repoApiCwd.test.ts` anti-drift guard and the `@adw-775` §10 regression scenario for the tests that catch a misclassification.
- **`maxBuffer` is global to `defaultExec`** — raised to 10 MB for all `execSync` calls
- **`readOriginRemoteUrl` in `bootstrapIdentity.ts` is the only correct place for a bootstrap git-remote read** — any future need to derive identity before a `GitContext` exists must call this function (or compose it, as the adapter's `readLocalRepoInfo` does), not shell out separately
- **`parseGitHubRemoteUrl` and `readLocalRepoInfo` no longer live in this package (#793)** — they moved to the adapter's `githubIdentity.ts`. `parseGitHubRemoteUrl` end-anchors the optional `.git` suffix and uses a lazy repo group (`([^/]+?)(?:\.git)?\/?$`) — an earlier `[^/.]+` repo group truncated any repo name containing a dot (e.g. `paysdoc.nl` parsed as `paysdoc`) because it stopped at the first `.` instead of only stripping a trailing `.git` (#779). Any new GitHub-remote-URL parsing must route through this function rather than hand-rolling a regex. `readLocalRepoInfo`'s try/catch must still span both the core's `readOriginRemoteUrl` read and the parse, so a non-GitHub remote's `Could not parse GitHub URL: …` stays wrapped in `Failed to get repo info: …` — a merged `@adw-779` scenario asserts on that text.
- **The core keeps no default identity** — `readEnvGitIdentity`/`readGitConfigIdentity` return `null` when nothing is configured; the `ADW Bot <adw-bot@users.noreply.github.com>` fallback lives only in the adapter's `resolveBootstrapGitIdentity` (#793)
- **`gitContextFactory.ts` lives in `adws/github/`** — not in the reusable package, to keep the package free of ADW globals (`REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`)
- **`getWorktreesDir`, `getWorktreePath`, `worktreeExists` no longer exist** — route through `ctx.ensureWorktree()`, `ctx.worktreePathFor()`, or `ctx.getWorktreeForBranch()`
- **`activeRepo`/`ensureAppAuthForRepo` are gone** — use `gitContextForRepo(repoInfo).<method>()` instead
- **`activateGitHubAppAuth`/`refreshTokenIfNeeded`/`configureGitIdentity` are gone (#701)** — there is no process-global token write. The subprocess receives auth via `subprocessEnv` from the launch-boundary context. Any import of these symbols causes a compile error.
- **Board and approve ops ask the port for `purpose: 'alternateIdentity'`** — `createGitHubTokenProvider` falls back to the resolved token when no PAT is configured (user-owned repos degrade gracefully); `GITHUB_PAT` unset is not an error (#791)
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
- **The ALLOWLIST has been deleted (#701)** — the `ALLOWLIST` const, the `allowed` Set, and the per-file skip are removed from `checkGitGhGuard.ts`. As of #792 the structural exemption is a closed, named, two-entry `EXEMPT_PACKAGES` array (`adws/gitContext` for git commands, `adws/providers/github` for gh commands) rather than a single `EXEMPT_PACKAGE_DIR` string — see `app_docs/feature-bq1f45-git-gh-cli-guard.md` for the full shape and the `isExemptPackage` predicate. The guard still prints `(0 allowlisted)` as a literal to keep the `(\d+) allowlisted` capstone observable valid. Any new raw `git` call outside `adws/gitContext/`, or raw `gh` call outside `adws/providers/github/`, immediately breaks CI.
- **`gitContextForSync` vs `gitContextFor` vs `gitContextForRepo`** — use `gitContextForSync` in synchronous initialization; `gitContextFor` when you can `await`; `gitContextForRepo(repoInfo)` in trigger/phase modules with only a `RepoInfo`
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global discipline; physical extraction deferred
- **`checkGitGhGuard.ts` `main()` guard** — exported as a module to support test imports; `main()` called only when `process.argv[1]` includes `checkGitGhGuard`
- **`perIssueScenarioSweep.ts` (#735) is `removeAndCommitPaths`'s first caller** — it lists stale `features/per-issue/feature-{N}.feature` files (and their `step_definitions/feature-{N}.*` siblings) via `ctx.lsFiles` against the tracked index (not the working tree), so a removal left uncommitted by a prior failed sweep cycle is self-healing on the next run; the commit is only pushed when the checkout is on `defaultBranch()`
