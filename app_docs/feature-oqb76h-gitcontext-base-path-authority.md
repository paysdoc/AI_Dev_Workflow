# GitContext Package — Repo-Context Authority, Per-Command Env Injection, Bootstrap Absorption

## Overview

`adws/gitContext/` is the single deep module that answers "which repository's filesystem am I operating on?" and "which auth identity does every command run with?" A `GitContext` is constructed from a mandatory identity (`owner`, `repo`, `selfHost`, `tokenProvider`, `gitIdentity`) plus injected resolution config (`frameworkRepoRoot`, `targetReposDir`). Base-path resolution lives only in the constructor — no optional base path, no `process.cwd()` fallback. Incomplete identity is a hard construction error.

The package's public surface is exactly git operations, worktree management, workspace bootstrap, and the `exec()` primitive — zero forge vocabulary. Every git operation reaches a child process through `exec(command, options: ExecOptions)`, the package's single spawn site, single env merge, and single ENOENT-rewrap `catch`. `exec()` is deliberately forge-neutral: it takes `command` as a separate first positional parameter (never folded into `options`, so `adws/checkGitGhGuard.ts`'s `git-gh-shellout` rule keeps inspecting it) and an `options.cwd: ExecWorkingDirectory` — a working-directory CLASS the caller declares, never a bare path and never a `process.cwd()` fallback — plus a pre-assembled `options.env` credential overlay and optional `options.input` for stdin. It knows nothing about which forge it is talking to: no token selection, no PAT-versus-installation-token discrimination, no GitHub (or any forge) vocabulary anywhere in its signature. Forge adapters built on this package (`adws/providers/github/`) reach a process only through `exec()` — they hold no independent spawn capability.

A single private classifier, `#run(command, opts?)`, sits in front of `exec()`: the workspace-scoped classifier for git commands and workspace-scoped operations (branch/commit/worktree/remote/claim ops, all git phase-level reads, `remoteUrl`, `remotes`, `gitConfigUser`). It calls `exec()` with `{kind: 'workspace', path: opts.cwd}` — `basePath` when `opts.cwd` is omitted, or an explicit worktree path when supplied. A spawn failure caused by that resolved cwd not existing on this host — never cloned, or a worktree that vanished — is rewrapped (via `workingDirectoryGuard.ts`, inside `exec()`) into an error naming the path and repository identity while preserving `code: 'ENOENT'`; every other failure propagates verbatim (issue #777).

`#run` assembles its credential environment through `commandEnv()`, which resolves the credential through the **TokenProvider port** (`credentialEnv({owner, repo, purpose})`) on **every call** — never cached by the core. `#run` declares only a forge-neutral `CredentialPurpose` (`'default' | 'alternateIdentity'`); the provider alone decides which credential answers it. The core holds no token: construction probes the provider once (`assertCompleteIdentity`) to fail loudly on a bad credential source, then discards the answer — the first real command still resolves the provider's own fresh answer. `tokenProvider` is mandatory on `GitContextOptions`; there is no literal-credential (`token`/`pat`) construction path — every caller supplies a `TokenProvider`. `createGitHubTokenProvider` is the port's GitHub implementation and lives in the GitHub forge adapter (`adws/providers/github/githubTokenProvider.ts`), not in this package; `createLiteralTokenProvider` is the adapter-side fixed-credential implementation for tests and fixtures.

As of #700, the package also owns the **bootstrap pre-context primitives** that must run *before* a `GitContext` can be constructed: local remote-URL + git-identity resolution (`bootstrapIdentity.ts`) and target-repo workspace clone/fetch (`repoWorkspace.ts`). These are structurally exempt (the guard skips `adws/gitContext/` by directory), eliminating the historical bootstrap-ALLOWLIST category entirely. GitHub-specific concerns — App token minting, veracious token resolution, GitHub remote-URL parsing, App bot-identity derivation, `gh auth token`, and clone-URL rewriting — all live in the GitHub forge adapter (`adws/providers/github/`, see `app_docs/feature-e2er82-github-forge-adapter.md`); this package's bootstrap modules stay git-only, no forge vocabulary. `repoWorkspace.ts` clones exactly the URL it is handed — no rewriting; the HTTPS→SSH conversion is the adapter's `convertToSshUrl`, applied one call frame earlier by `adws/core/targetRepoManager.ts`.

Logging inside the package arrives through an injected `Logger` port (`(message: string, level?: LogLevel) => void`, declared in `types.ts`) rather than an import of the host application's logger — `consoleLogger.ts` is the console default, and production construction sites inject the real ADW `log` so output stays byte-identical. The package imports nothing from `adws/core`, `adws/github`, `adws/providers`, or any ADW global — all config is injected at construction, and forge adapters are built *on top of* this package, never imported *by* it.

This module implements PRD `specs/prd/git-context-repo-authority.md` and eliminates the historical "wrong-repo worktree" and `GH_TOKEN` bleed classes of bug structurally.

## Responsibilities

- Accept a complete, mandatory identity at construction time and throw a loud error for any missing or empty field (including an omitted `selfHost` boolean discriminator, or a missing `tokenProvider`)
- Validate credentials at construction: probe the `tokenProvider` once with a `'default'` request and discard the answer — the probe exists to fail loudly on a bad credential source, never to cache a result
- Resolve `basePath` once in the constructor: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`
- Expose read-only `basePath`, `owner`, `repo`, `selfHost` accessors
- Compute `worktreePathFor(branch)` as `join(basePath, '.worktrees', sanitize(branch))` — never consulting `process.cwd()`
- Produce a per-command child-process environment overlay via `commandEnv(base?, purpose?)`: fresh object with the TokenProvider port's per-call credential + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` — never mutates `process.env`, never memoises the credential
- Expose `exec(command, options: ExecOptions)` as a **public** method — the package's single spawn site, single env merge, and single ENOENT-rewrap `catch`: `command` is the first positional parameter (guard-preserving, see Overview); `options.cwd: ExecWorkingDirectory` is a working-directory CLASS the caller declares, never a bare path and never a `process.cwd()` fallback; `options.env` is a fully-assembled per-command credential overlay (the caller merges it, not `exec()`); `options.input` is optional stdin; the return value is stdout, trimmed; a global `maxBuffer: 10 MB` ceiling prevents `ENOBUFS` on large diffs/logs
- Choose the working-directory class and assemble the credential env via the private `#run(command, opts?)` classifier that delegates to `exec()`: `{kind: 'workspace', path?}`, defaulting to `basePath` or narrowed to `opts.cwd` for an explicit worktree
- Diagnose a spawn failure caused by a missing working directory at the moment it fails — never by a pre-spawn existence check — and rewrap it, inside `exec()`, into an error naming the resolved `cwd`, the `owner/repo`, and the `selfHost` discriminator, while every other failure (including a real git failure inside a `cwd` that does exist) propagates untouched (issue #777)
- Provide branch operations: `getCurrentBranch`, `mergeLatestFromDefaultBranch`, `fetchAndResetToRemote`, `deleteLocalBranch`, `deleteRemoteBranch`, `localBranches`
- Provide commit/push operations: `commitChanges`, `removeAndCommitPaths(paths, message, worktreePath)` (scoped `git rm --ignore-unmatch` + commit limited to exactly `paths`), `addAndCommitPaths`, `pushBranch` (force-with-lease + lease-rejection detection), `getHeadTreeHash`, `hasUncommittedChanges`
- Provide worktree reset: `resetWorktree` (abort in-progress merge/rebase via fs then fetch/reset --hard/clean -fdx)
- Provide full worktree management surface: `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `getWorktreeForBranch`, `listWorktrees`, `findWorktreeForIssue`, `removeWorktree`, `removeWorktreesForIssue`, `copyEnvToWorktree`
- Provide identity-read methods: `remoteUrl(cwd?)`, `remotes(cwd?)`, `gitConfigUser(cwd?)`
- Provide worktree/branch probe reads: `resolveGitDir(worktreePath)`, `currentBranchSymbolic(worktreePath)`, `worktreeRegistration(worktreePath)`, `worktreeBranches(cwd?)`, `mainRepoPath(cwd?)`
- Provide phase-level git read ops: `lsFiles(cwd, prefix?)`, `headShort(cwd?)`, `diff(range, cwd)`, `log(branchName, cwd?)`, and a bounded `git log --since` read: `logSince(opts: LogSinceOptions, cwd?)`
- Provide remote fetch/merge/ls-remote ops: `fetchRemote(branch, cwd)`, `mergeBranch(ref, cwd, opts?)`, `abortMerge(cwd)`, `lsRemote(branch, cwd?)`
- Provide upgrade-claim distributed-lock ops: `addDetachedWorktree(worktreePath, ref, cwd)`, `commitAllowEmpty(message, cwd)`, `pushHeadToBranch(branch, cwd)`, `removeDetachedWorktree(worktreePath, cwd)`
- Delegate VCS operation orchestration to package-private modules (`branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`, `worktreeCreateOps.ts`, `worktreeQueryOps.ts`, `worktreeRemoveOps.ts`, `worktreeProbeOps.ts`, `gitReadOps.ts`, `remoteOps.ts`, `claimOps.ts`, `processCleanup.ts`)
- Accept an injectable `ExecFn` via `GitContextDeps` for hermetic testing
- Accept an injectable `Logger` port via `GitContextDeps.logger`, defaulting to `consoleLogger` — the package's constructor resolves `#log = deps.logger ?? consoleLogger` and threads it through the worktree/workspace op call sites, so the package holds no import of the host application's logger
- Export only `GitContext` class and its public types — including `ExecWorkingDirectory`/`ExecOptions`, `TokenProvider`/`CredentialPurpose`/`CredentialRequest`, and `Logger`/`LogLevel` — plus the bootstrap-exception symbols via `adws/gitContext/index.ts`

### Bootstrap package modules (absorbed in #700, structurally exempt)

The two modules below live inside the structurally-exempt `adws/gitContext/` directory. They are the *only* legitimate permanent site for pre-context git reads (git remote/identity reads, workspace clone/fetch). ADW adapters (`gitContextFactory.ts`, `launchGitContext.ts`, `githubAppAuth.ts`, `targetRepoManager.ts`) delegate to these (and to the GitHub forge adapter, for token/identity/clone-URL concerns) and contain zero raw `git`/`gh` strings.

| Module | Exports |
|---|---|
| `bootstrapIdentity.ts` | Generic **git** reads only — no forge vocabulary. `readOriginRemoteUrl(cwd?): string` — `git remote get-url origin`, trimmed; throws with the raw git failure, leaving parsing to the adapter. `readEnvGitIdentity(env): GitIdentity \| null` — `GIT_AUTHOR_*`/`GIT_COMMITTER_*`; null when incomplete. `readGitConfigIdentity(deps?): GitIdentity \| null` — `git config user.name`/`user.email`; null on any git failure. `GitConfigIdentityDeps` (`exec?`, `env?`). No default identity of its own — the core supplies no forge fallback. |
| `repoWorkspace.ts` | `getTargetRepoWorkspacePath(owner, repo, targetReposDir)`, `isRepoCloned(workspacePath, fsDeps?)`, `cloneRepo(cloneUrl, workspacePath, opts?)`, `ensureRepoWorkspace(owner, repo, cloneUrl, deps)`. `ensureRepoWorkspace` clones the `cloneUrl` it is handed **verbatim** when absent (no rewriting, no `github.com` literal; the HTTPS→SSH rewrite is the adapter's `convertToSshUrl`, applied by `targetRepoManager.ts` before this module is called); otherwise runs `git fetch origin` and calls the injected `getDefaultBranch` thunk under per-command veracious auth — fixing the ambient-auth `gh repo view` crash class. `EnsureRepoWorkspaceDeps.log` and `cloneRepo`'s `opts.log` are typed `Logger` (the injected logger port), not a bespoke callback shape. |
| `consoleLogger.ts` | `consoleLogger: Logger` — the default logger port: every level to `console.log`, matching the host logger's single-stream behaviour. |

The GitHub-specific half of pre-context resolution — `parseGitHubRemoteUrl`, `readLocalRepoInfo`, App bot-identity derivation, `ghAuthToken`, and the HTTPS→SSH `convertToSshUrl` — lives in the GitHub forge adapter's `githubIdentity.ts`/`ghAuthToken.ts`/`cloneUrl.ts` — see `app_docs/feature-e2er82-github-forge-adapter.md`. The adapter composes the core's generic readers rather than shelling out itself.

### Token Veracity

Token minting and resolution (`appAuth.ts`, `tokenResolver.ts`, `githubTokenProvider.ts`) live in the GitHub forge adapter (`adws/providers/github/`), not in this package. See `app_docs/feature-e2er82-github-forge-adapter.md` for the resolution order and the `resolveContextToken`/`createGitHubTokenProvider` contracts. This package's `commandEnv()` reaches that resolution only through the injected `TokenProvider` port (`GitContextOptions.tokenProvider`) — it holds no token-resolution logic of its own.

### Package-private operation modules

Each module is side-effect-free except at the injected runner/fs seam and stays under 300 lines:

| Module | Exports |
|---|---|
| `branchOps.ts` | Branch create/checkout/delete/merge/fetch/reset runners; `localBranches` |
| `commitOps.ts` | Commit/push/hash/dirty-check runners; `removeAndCommitPaths` (`git rm -f --ignore-unmatch` scoped to given paths, commits only if that staged something, idempotent when paths are already absent) |
| `worktreeResetOps.ts` | Abort-in-progress-op + fetch/reset --hard/clean |
| `worktreeCreateOps.ts` | `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`, `copyEnvToWorktree`, `isBranchCheckedOutElsewhere`, `freeBranchFromMainRepo` — each takes `log: Logger` as a threaded parameter (no import of the host application's logger) |
| `worktreeQueryOps.ts` | `listWorktrees`, `findWorktreeForIssue`, `getWorktreeForBranch`; `mainRepoPath`, `worktreeBranches`; exports `WorktreeForIssueResult` type |
| `worktreeRemoveOps.ts` | `removeWorktree`, `removeWorktreesForIssue`, `parseWorktreeBranches`; injects `killProcesses` fn; `log: Logger` threaded parameter |
| `worktreeProbeOps.ts` | `resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`; exports `WorktreeRegistration` union type; handles arbitrary worktree paths supplied by the caller |
| `gitReadOps.ts` | `lsFiles`, `headShort`, `diff`, `log`; `logSince` + exports `LogSinceOptions`; pure functions over an injected `Runner` seam; errors propagate — no internal swallow |
| `remoteOps.ts` | `fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`; remote-interaction + merge ops over an injected `Runner` seam; all propagate errors except `abortMerge` (swallows — aborting with no in-progress merge is benign) |
| `claimOps.ts` | `addDetachedWorktree`, `commitAllowEmpty`, `pushHeadToBranch`, `removeDetachedWorktree`; upgrade-claim distributed-lock verbs; all propagate errors except `removeDetachedWorktree` (swallows). `pushHeadToBranch` emits **no** `--force` flag by design — the non-fast-forward rejection IS the lock. |
| `processCleanup.ts` | `killProcessesInDirectory` (lsof + SIGTERM→SIGKILL, self-PID filter); re-exported from `vcs/worktreeCleanup.ts` for legacy callers |
| `workingDirectoryGuard.ts` | `isSpawnEnoent`, `describeMissingWorkingDirectory`, `rewrapMissingWorkingDirectory` — turns a spawn-into-a-missing-cwd `ENOENT` into an error naming the path and repository identity; pure (no `fs`, no spawn — the existence probe is injected); used only by `#run`'s catch block (issue #777) |

The pure GitHub command-string builder modules (`issueCommands.ts`, `prCommands.ts`, `labelCommands.ts`, `boardCommands.ts`, `secretCommands.ts`) live in `adws/providers/github/commands/` — the GitHub forge adapter. `gitContext.ts` imports nothing from that directory; the core has zero GitHub-specific imports. See `app_docs/feature-e2er82-github-forge-adapter.md` for their contracts and for `ghIssueApi`/`ghPrApi`/`ghRepoApi`, the composed views that relocated GitContext's former semantic (`gh`) surface onto these builders.

## Contracts & Invariants

- Construction with any missing/empty identity field, non-boolean `selfHost`, or missing `tokenProvider` throws `Error: GitContext: <field> must not be empty` (or `GitContext: tokenProvider must be provided`)
- Self-host identity resolves `basePath` to `frameworkRepoRoot`; target identity resolves to `join(targetReposDir, owner, repo)`
- `worktreePathFor` result is determined solely by `basePath` and branch name — `process.cwd()` has no effect
- `commandEnv` never writes to `process.env`; each call returns a new object; calling it twice is idempotent
- `exec()` throws `Error: GitContext: exec command must not be empty` on a blank/whitespace-only `command`, and `Error: GitContext: exec working directory path must not be empty` on a `{kind: 'workspace', path: ''}` (blank-but-defined path is rejected; `path: undefined` is the valid "use basePath" form)
- `exec()`'s `options.env` is merged as `{...process.env, ...options.env}` inside the method — `process.env` itself is never mutated, and the caller-supplied overlay always wins on key collision
- `#run` always passes an explicit `{kind: 'workspace', ...}` cwd class and a pre-assembled `env` to `exec()` — never inherits process working directory or ambient `process.env.GH_TOKEN`
- `defaultExec` sets `maxBuffer: 10 * 1024 * 1024` on all `execSync` calls
- The credential in the child env is resolved through the TokenProvider port on every call — never cached by the core; parent `process.env` is unchanged either way
- Two `GitContext` instances for two repos never share `cwd` or a credential — a provider request always carries its own context's `owner`/`repo`, so `GH_TOKEN` bleed is structurally impossible
- `pushBranch` uses `--force-with-lease --force-if-includes`; lease rejection throws with manual-remedy instructions
- `removeAndCommitPaths` never touches paths outside the given list — no `git add -A`; unrelated dirty state in the worktree is left untouched. Returns `false` (no commit) when the given paths were already absent from the index
- `resetWorktree` aborts any in-progress merge/rebase before fetching and hard-resetting
- Protected branches (`main`, `master`, `develop`) refused by `deleteLocalBranch` and `deleteRemoteBranch`
- Package imports nothing from `adws/core`, `adws/providers`, or any ADW global — all config injected at construction. No upward import of any forge adapter's command builders — the core's git-only public surface is the whole point of the split
- **Bootstrap exception (bootstrapIdentity.ts):** `readOriginRemoteUrl`, `readEnvGitIdentity`, and `readGitConfigIdentity` are the only legitimate pre-context git reads in the core; they live inside the exempt package
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
| `owner` | `string` | Repository owner (organisation or user) |
| `repo` | `string` | Repository name |
| `selfHost` | `boolean` | `true` = ADW's own repo, `false` = target repo |
| `tokenProvider` | `TokenProvider` | Mandatory — a port asked once per command via `credentialEnv({owner, repo, purpose})`; the core holds no token of its own |
| `gitIdentity` | `GitIdentity` | Author + committer name/email for git operations |
| `frameworkRepoRoot` | `string` | Absolute path to ADW framework repo root (injected from `REPO_ROOT`) |
| `targetReposDir` | `string` | Absolute path to cloned target repos directory (injected from `TARGET_REPOS_DIR`) |

Optional injectable dependency bag via `GitContextDeps`:

| Field | Type | Description |
|---|---|---|
| `exec` | `ExecFn?` | Injectable command runner for tests; defaults to thin `execSync` wrapper |
| `fsDeps` | `FsDeps?` | Injectable fs for worktree management ops; defaults to real `fs` functions |
| `logger` | `Logger?` | Injectable logger port — `(message: string, level?: LogLevel) => void`; defaults to `consoleLogger`. Production construction sites inject the real ADW `log`. |

## Gotchas

- **`selfHost` is a boolean discriminator, not optional** — passing `undefined` or any non-boolean throws at construction
- **`process.env` is never mutated on the operation hot path** — `commandEnv(process.env)` overlays into a new object
- **`ensureRepoWorkspace` `getDefaultBranch` thunk must use veracious auth** — callers inject `() => ctx.defaultBranch()`-shaped thunks bound to a `GitContext` for the target repo. This is the structural fix for the crash class where a default-branch read ran under ambient/wrong-repo auth.
- **`exec()` is the public spawn site** — the `#run` classifier and every method that calls it funnel through `exec()`; the private `#execFn` field is the only thing at the injectable-runner seam — `GitContextDeps.exec` still works identically for hermetic tests
- **`ExecWorkingDirectory` is a discriminated union, not a plain `{ cwd?: string }`** — `{kind: 'workspace', path?}` vs `{kind: 'frameworkRoot'}` (no `path` field at all on the latter, used by forge adapters, never by this package's own methods). A caller cannot pass a `cwd` override to the framework-root class even by mistake — TypeScript rejects it
- **`exec()`'s `options.env` is not `commandEnv()`'s raw output** — the caller (`#run`) builds `env` from `commandEnv({}, purpose)` before passing it to `exec()`; `exec()` itself does not know about credentials, the TokenProvider port, or git identity, it only merges whatever `env` object it receives over `process.env`
- **`#run` accepts optional `{ cwd?, input? }`** — `cwd` overrides base path for ops on worktrees (translated to `{kind: 'workspace', path: cwd}` before reaching `exec()`); `input` pipes data to stdin
- **`workingDirectoryGuard.ts` detects on `code === 'ENOENT'`, never the message** (issue #777) — node reports a missing spawn cwd as `spawnSync /bin/sh ENOENT`, bun as `ENOENT: no such file or directory, posix_spawn '/bin/sh'`; only `code`/`syscall`/`path` are identical across runtimes. A pre-spawn `existsSync` guard is **not** viable: every GitContext test drives the context with imaginary paths and hardcodes `existsSync: () => false`, so a pre-spawn check would throw in nearly every existing test. The rewrap therefore fires only in `exec()`'s `catch` block, after a real `ENOENT`-coded spawn failure, and only when the resolved `cwd` is confirmed absent via the injected `fsDeps.existsSync` — never at construction, never cached. The rewrapped error **must keep `code: 'ENOENT'`** (plus the original as `cause`).
- **`frameworkRepoRoot` is retained internally as `#repoApiCwd`** — no core method reads it any more (the repo-API classifier that used it, `#runRepoApi`, was deleted along with the `gh` semantic surface), but the private field remains so the value is still available if a future core-side need arises without threading a new constructor parameter
- **`maxBuffer` is global to `defaultExec`** — raised to 10 MB for all `execSync` calls
- **`readOriginRemoteUrl` in `bootstrapIdentity.ts` is the only correct place for a bootstrap git-remote read** — any future need to derive identity before a `GitContext` exists must call this function (or compose it, as the adapter's `readLocalRepoInfo` does), not shell out separately
- **`parseGitHubRemoteUrl` and `readLocalRepoInfo` do not live in this package** — they live in the adapter's `githubIdentity.ts`. Any new GitHub-remote-URL parsing must route through `parseGitHubRemoteUrl` rather than hand-rolling a regex
- **The core keeps no default identity** — `readEnvGitIdentity`/`readGitConfigIdentity` return `null` when nothing is configured; the `ADW Bot <adw-bot@users.noreply.github.com>` fallback lives only in the adapter's `resolveBootstrapGitIdentity`
- **`gitContextFactory.ts` lives in `adws/github/`** — not in the reusable package, to keep the package free of ADW globals (`REPO_ROOT`, `TARGET_REPOS_DIR`)
- **`getWorktreesDir`, `getWorktreePath`, `worktreeExists` do not exist on `GitContext`** — route through `ctx.ensureWorktree()`, `ctx.worktreePathFor()`, or `ctx.getWorktreeForBranch()`
- **`abortMerge` error-swallowing is load-bearing** — callers that invoke `ctx.abortMerge` in both a clean-path and a catch-path rely on it never throwing incorrectly on "no merge in progress"
- **`lsRemote` drops `--exit-code` deliberately** — routing through `#run` (throws on any non-zero exit) makes `--exit-code` actively harmful for the "branch absent = exit 2" case
- **`pushHeadToBranch` must NEVER force** — a unit assertion in `claimOps.test.ts` pins this
- **`addDetachedWorktree` must not create a named local branch** — uses `--detach` to avoid "branch already exists" on the loser path
- **`commitAllowEmpty` must not be replaced with `commitChanges`** — `commitChanges` short-circuits on a clean tree; the claim requires an always-empty commit
- **`logSince` is a bounded method, not a free-string passthrough** — `LogSinceOptions` vocabulary (`since`, `grep?`, `oneline?`, `patch?`, `pathspec?`) prevents arbitrary git subcommands
- **No physical npm package** — the "importable package" guarantee is satisfied structurally by the zero-ADW-global discipline; physical extraction deferred
- **`checkGitGhGuard.ts` `main()` guard** — exported as a module to support test imports; `main()` called only when `process.argv[1]` includes `checkGitGhGuard`
- **`perIssueScenarioSweep.ts` is `removeAndCommitPaths`'s first caller** — it lists stale `features/per-issue/feature-{N}.feature` files (and their `step_definitions/feature-{N}.*` siblings) via `ctx.lsFiles` against the tracked index (not the working tree), so a removal left uncommitted by a prior failed sweep cycle is self-healing on the next run; the commit is only pushed when the checkout is on `defaultBranch()`
