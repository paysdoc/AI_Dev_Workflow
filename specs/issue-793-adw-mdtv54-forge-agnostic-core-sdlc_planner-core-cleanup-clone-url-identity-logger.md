# Feature: The gitContext core loses its last GitHub conventions — ready clone URL, split identity, injected logger

## Metadata
issueNumber: `793`
adwId: `mdtv54-forge-agnostic-core`
issueJson: `{"number":793,"title":"Forge-agnostic core cleanup: clone URL, identity split, logger port","body":"## Parent PRD\n\nspecs/prd/gitcontext-forge-agnostic-refactor.md\n\n## What to build\n\nRemove the remaining GitHub conventions from the gitContext core: the workspace manager receives a ready-made clone URL (the github.com URL rewriting moves to the adapter); bootstrap identity splits into generic git-config reads (stay in core) and GitHub derivation — noreply bot emails, SCP-style remote parsing — which moves to the adapter; the two worktree operations importing the application logger switch to an injected logger port with a console default.\n\nSee PRD sections: Implementation Decisions (Core cleanup), user stories 14/15/17.\n\n## Acceptance criteria\n\n- [ ] Core takes a ready clone URL and ready GitIdentity at construction; no URL rewriting or identity derivation inside the core\n- [ ] No `github.com` literals remain in core modules (adapter excluded)\n- [ ] Core has zero imports from ADW application code (logger injected)\n- [ ] Workspace clone/fetch and worktree create/remove behavior unchanged; full suite green\n\n## Blocked by\n#791 <!-- adw:region-overlap -->\n#790 <!-- adw:region-overlap -->\n\n- Blocked by #792\n\n## Touched Files\n\n- adws/gitContext/repoWorkspace.ts\n- adws/gitContext/bootstrapIdentity.ts\n- adws/gitContext/worktreeCreateOps.ts\n- adws/gitContext/worktreeRemoveOps.ts\n- adws/gitContext/types.ts\n- adws/github/gitContextFactory.ts\n- adws/gitContext/__tests__/repoWorkspace.test.ts\n- adws/gitContext/__tests__/bootstrapIdentity.test.ts\n\n## User stories addressed\n\n- User story 14\n- User story 15\n- User story 17\n- User story 20","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-08-14T12:18:49Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-08-14T13:11:16Z","body":"⏸️ **Deferred behind #790 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #790, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #790 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/gitcontext/types.ts`\n\nThis issue will spawn automatically once #790 merges and closes. To override, remove the `#790 <!-- adw:region-overlap -->` line from this issue body."},{"author":"paysdoc-adw","createdAt":"2026-08-14T13:16:31Z","body":"⏸️ **Deferred behind #791 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #791, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #791 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/gitcontext/types.ts`\n\nThis issue will spawn automatically once #791 merges and closes. To override, remove the `#791 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description

Three GitHub-shaped seams survive inside `adws/gitContext/` after #790 (public executor), #791 (TokenProvider port) and #792 (forge adapter). This slice removes all three, in the shape the PRD's **Core cleanup** decision names:

1. **Clone-URL rewriting.** `repoWorkspace.ts` receives an HTTPS clone URL and silently rewrites it to `git@github.com:owner/repo.git` before cloning (`:62-67`, `:87-90`). Two `github.com` literals live there. After this slice the core clones **exactly the URL it is handed**; the HTTPS→SSH rewrite moves to the GitHub adapter and is applied by the ADW wiring shim before the core is called.
2. **Identity derivation.** `bootstrapIdentity.ts` mixes two unrelated jobs: generic git reads (`git remote get-url origin`, `git config user.name/user.email`, `GIT_AUTHOR_*`/`GIT_COMMITTER_*`) and GitHub conventions (two `github.com` remote-URL regexes, the `${appSlug}[bot]` / `${appId}+${appSlug}[bot]@users.noreply.github.com` App-bot derivation, the `adw-bot@users.noreply.github.com` fallback, and `execSync('gh auth token')`). The generic half stays; the GitHub half moves to the adapter. `GitContext` already takes a **ready** `GitIdentity` at construction — after the split, nothing derives one inside the package.
3. **The application logger.** `worktreeCreateOps.ts:6` and `worktreeRemoveOps.ts:7` `import { log } from '../core/utils'`. These are the **only two** imports of ADW application code anywhere in the package (verified: nothing else in `adws/gitContext/*.ts` imports from `../core`, `../agents`, `../phases`, `../github`, `../triggers` or `../vcs`). They become an injected `Logger` port with a console default, wired to the real ADW logger at the three production construction sites.

This is slice 4 of the GitContext forge-agnostic refactor (`specs/prd/gitcontext-forge-agnostic-refactor.md`, user stories 14, 15, 17, 20). It is the slice that makes PRD story 20 — "the core's public API consists only of git, worktree, workspace and executor operations plus the ports it consumes" — true of everything except the semantic methods that #796/#797 own.

The change is behaviour-neutral by construction: the same `git clone` string reaches the same shell, the same identity fields reach the same commits, and the same log lines reach the same stream.

## User Story

As a framework developer
I want the gitContext core to clone the URL it is given, receive a ready-made git identity, and log through an injected port
So that no GitHub convention and no host-application dependency remains in the package that is scheduled for extraction as a forge-neutral library

## Problem Statement

- **The core rewrites URLs it was handed.** `ensureRepoWorkspace(owner, repo, cloneUrl, deps)` accepts a clone URL and then calls `convertToSshUrl` inside `cloneRepo` (`repoWorkspace.ts:87`), which hard-codes `https://github.com/` (`:63`) and reassembles `git@github.com:${owner}/${repo}.git` (`:66`). A caller cloning a GitLab or self-hosted remote gets the URL through untouched only by accident of the `startsWith` guard. PRD story 14 wants the core to "receive a ready-made clone URL … so that I never derive either from forge-specific conventions."
- **The core derives GitHub identities.** `resolveBootstrapGitIdentity` (`bootstrapIdentity.ts:118-158`) reads `GITHUB_APP_ID`/`GITHUB_APP_SLUG`/`GITHUB_APP_PRIVATE_KEY_PATH`, builds a GitHub App bot name and a `users.noreply.github.com` e-mail, and falls back to another `users.noreply.github.com` address. `parseGitHubRemoteUrl` (`:54`) owns two `github.com` regexes. PRD story 15 wants "GitHub bot-identity derivation and remote-URL parsing" to live in the adapter "so that GitHub naming conventions never appear in the core."
- **A `gh` shell-out is still in the git core, and #792 left the decision open on purpose.** `ghAuthToken()` (`:91-100`) is `execSync('gh auth token')`. `features/per-issue/feature-792.feature` flags it verbatim: *"A DIRECT `gh` SPAWN REMAINS IN THE CORE AFTER THIS SLICE, AND AC3 DOES NOT REACH IT … Left unpinned deliberately, and flagged: whichever way the reviewer decides, it should be a decision rather than an oversight."* #792's plan added: *"It sits in `bootstrapIdentity.ts`, which #793 splits."* This slice is where that decision gets made.
- **The core imports the host application.** `worktreeCreateOps.ts` and `worktreeRemoveOps.ts` reach `adws/core/utils` → `adws/core/logger` for `log()`. A package advertised by its own `index.ts` header as a "standalone, importable public surface" cannot be imported by another project without dragging ADW's logger — and its module-scope `_logAdwId` state — along. PRD story 17: "I want logging to arrive through an injected logger, so that I carry no dependency on the host application's utilities."

## Solution Statement

### 1. The clone URL arrives ready

A new pure adapter module owns the rewrite:

```ts
// adws/providers/github/cloneUrl.ts
import { parseGitHubRemoteUrl } from './githubIdentity';

/** Converts an HTTPS GitHub clone URL to SSH form. Non-GitHub / already-SSH URLs pass through. */
export function convertToSshUrl(cloneUrl: string): string {
  if (!cloneUrl.startsWith('https://github.com/')) return cloneUrl;
  const info = parseGitHubRemoteUrl(cloneUrl);
  if (!info) return cloneUrl;
  return `git@github.com:${info.owner}/${info.repo}.git`;
}
```

`repoWorkspace.ts` drops its `parseGitHubRemoteUrl` import (`:17`) and `convertToSshUrl` (`:62-67`); `cloneRepo` logs and clones `cloneUrl` verbatim. `adws/core/targetRepoManager.ts` — already the ADW wiring shim that binds `TARGET_REPOS_DIR` and the veracious `getDefaultBranch` thunk — becomes the site that converts:

```ts
export function ensureTargetRepoWorkspace(targetRepo: TargetRepoInfo): string {
  const { owner, repo, cloneUrl } = targetRepo;
  const ctx = gitContextForRepo({ owner, repo });
  return ensureRepoWorkspace(owner, repo, convertToSshUrl(cloneUrl), { … });
}
```

`cloneTargetRepo` converts the same way, and the shim keeps re-exporting `convertToSshUrl` at its stable path (`targetRepoManager.ts:37`) so no downstream importer moves. **The emitted command string is byte-identical** — the conversion simply happens one call frame earlier.

### 2. Bootstrap identity splits along the git/GitHub line

**Core keeps the generic git reads** (`adws/gitContext/bootstrapIdentity.ts`, same path — it stays the package's pre-context primitive module):

```ts
export interface GitConfigIdentityDeps {
  exec?: (cmd: string, opts: { encoding: 'utf-8'; cwd?: string; stdio?: unknown }) => string;
  env?: NodeJS.ProcessEnv;
}

/** `git remote get-url origin`, trimmed. Throws with the raw git failure. */
export function readOriginRemoteUrl(cwd?: string): string;

/** GIT_AUTHOR_* / GIT_COMMITTER_* — a complete identity or null. Pure. */
export function readEnvGitIdentity(env: NodeJS.ProcessEnv): GitIdentity | null;

/** `git config user.name` / `user.email` — a complete identity or null; null on any git failure. */
export function readGitConfigIdentity(deps?: GitConfigIdentityDeps): GitIdentity | null;
```

**The adapter takes the GitHub conventions** (`adws/providers/github/githubIdentity.ts`, NEW):

- `RepoInfo`, `HTTPS_REMOTE_RE`, `SSH_REMOTE_RE` and `parseGitHubRemoteUrl` — moved verbatim, including the #779 contract (lazy repo group, end-anchored optional `.git`) that keeps `paysdoc.nl` from being truncated.
- `readLocalRepoInfo(cwd?)` — composes the core's `readOriginRemoteUrl` with `parseGitHubRemoteUrl`, **preserving both error messages exactly**: the inner `Could not parse GitHub URL: ${remoteUrl}` and the outer `Failed to get repo info: ${error}` wrapper (a merged `@adw-779` scenario asserts `/Failed to get repo info/`, so the try must still span the read *and* the parse).
- `APP_BOT_IDENTITY` derivation and the `ADW_BOT_FALLBACK_IDENTITY` constant (`ADW Bot` / `adw-bot@users.noreply.github.com`).
- `resolveBootstrapGitIdentity(deps: BootstrapIdentityDeps = {})` — the same four-step order (App bot → `GIT_*` env → git config → ADW Bot default), now composing the core's two readers. Same exported name, same `BootstrapIdentityDeps` shape (`exec`, `env`, `isAppConfigured`), same defaults, so every call site and every existing assertion survives unchanged.

**`ghAuthToken` moves to the adapter** (`adws/providers/github/ghAuthToken.ts`, NEW) — moved verbatim, still a direct `execSync('gh auth token')`. This resolves #792's flagged open question. Reasoning, recorded because the scenario asked for a decision:

- **Role fit.** The guard's contract since #792 is "only the git core may run git; only the GitHub adapter may issue gh." `gh auth token` is a `gh` command; the adapter is its only correct home. Leaving it in `adws/gitContext/` keeps a `gh` shell-out in a package that is being prepared for publication as forge-neutral.
- **The boundary is not an option.** Putting it in `adws/github/` (the "it's boundary configuration" reading) would fail `bun run lint:git-guard` — `adws/github/` is unprivileged, `adws/providers/repoContext.ts` and `adws/github/issueApi.ts` are explicit negative rows in `feature-792.feature` §17, and the ALLOWLIST is gone (`(0 allowlisted)` is regex-pinned by `@adw-700` §4b).
- **It cannot route through `ghCommandRunner`.** It is the pre-context read that *produces* the credential the runner needs; a credentialed executor would recurse through the credential assembly it is being asked for. It therefore stays a direct spawn inside the guard-exempt adapter — the `gh`-side mirror of the core's `readOriginRemoteUrl` pre-context `git` read.
- **No merged scenario breaks.** `feature-792.feature`'s AC3 scenarios (§11–§14) assert that *forge operations* reach a process only through the seam, over injected fakes; the `child_process` mentions at `:704` are synthetic guard fixtures, not a scan of the real adapter tree. #792's plan-level `grep -rn "child_process" adws/providers/github/` expectation is superseded by this decision and must not be re-asserted.

### 3. The logger becomes a port

```ts
// adws/gitContext/types.ts
export type LogLevel = 'info' | 'error' | 'success' | 'warn';

/**
 * The logger port. Structurally compatible with the host application's
 * `log(message, level?)`, so the ADW logger is injectable with no adapter.
 */
export type Logger = (message: string, level?: LogLevel) => void;

export interface GitContextDeps {
  exec?: ExecFn;
  fsDeps?: FsDeps;
  /** Injectable logger port — defaults to `consoleLogger`. */
  logger?: Logger;
}
```

```ts
// adws/gitContext/consoleLogger.ts  (NEW)
/** Default logger port: every level to stdout, matching the host logger's single-stream behaviour. */
export const consoleLogger: Logger = (message) => { console.log(message); };
```

- `worktreeCreateOps.ts` and `worktreeRemoveOps.ts` drop the `../core/utils` import and take `log: Logger` as their **third positional parameter**, after the existing `run` and `fs` seams — injected seams first, data after, matching the modules' current shape. Every `log(...)` call inside them is otherwise untouched, message and level identical.
- `GitContext` resolves `#log = deps.logger ?? consoleLogger` in the constructor and passes it at the six op call sites (`gitContext.ts:406`, `:416`, `:426`, `:462`, `:473`, `:483`).
- `EnsureRepoWorkspaceDeps.log` (`repoWorkspace.ts:36`) is retyped from `(msg: string, level?: string) => void` to `Logger`, which deletes the `level as 'info' | 'error' | 'success' | 'warn'` cast in `targetRepoManager.ts:69` — the guidelines' "type narrowing over assertions" rule, and the reason the two seams should not have diverged in the first place.
- **Production output is unchanged** because all three real construction sites inject the real logger: `gitContextFactory.ts:111` and `:120`, and `launchGitContext.ts:133`, each becoming `new GitContext(options, { logger: log })` with `log` imported from `../core/utils` / `./utils`. These are the only `new GitContext(` sites outside tests in `adws/`, `workers/` and `scripts/`.

### 4. Public surface and importer repointing

`adws/gitContext/index.ts` stops exporting `parseGitHubRemoteUrl`, `readLocalRepoInfo`, `ghAuthToken`, `resolveBootstrapGitIdentity`, `convertToSshUrl`, `BootstrapRepoInfo` and `BootstrapIdentityDeps`; it gains `readOriginRemoteUrl`, `readEnvGitIdentity`, `readGitConfigIdentity`, `GitConfigIdentityDeps`, `Logger` and `LogLevel`. The header paragraph describing the bootstrap `gh` exception is rewritten to state that the remaining bootstrap primitives are generic **git** reads only.

Importers repoint to **deep adapter paths, never the `providers/github` barrel** — the cycle rule #792 established (`adws/providers/index.ts` does `export * from './github'`, and `githubCodeHost.ts` imports `../../github/gitContextFactory`):

| Importer | Change |
|---|---|
| `adws/github/gitContextFactory.ts:11-15` | `readLocalRepoInfo` + `resolveBootstrapGitIdentity` from `../providers/github/githubIdentity`; `ghAuthToken` from `../providers/github/ghAuthToken`. Its own `export { readLocalRepoInfo }` (`:87`) stays, so its ~9 downstream importers are untouched. |
| `adws/core/launchGitContext.ts:22` | same two deep paths |
| `adws/github/githubApi.ts:6` | `parseGitHubRemoteUrl` from `../providers/github/githubIdentity` |
| `adws/core/targetRepoManager.ts:18-24` | `convertToSshUrl` from `../providers/github/cloneUrl`; the rest still from `../gitContext` |
| `features/per-issue/step_definitions/feature-779.steps.ts:21` | `readLocalRepoInfo` and `type RepoInfo` from the adapter module |

No new module is added to `adws/providers/github/index.ts`: the barrel stays a provider surface, and `RepoInfo` in particular must not be star-exported into `adws/providers/index.ts` where it would collide.

## Relevant Files

Use these files to implement the feature:

**Core modules being cleaned**
- `adws/gitContext/repoWorkspace.ts` — `convertToSshUrl` (`:62-67`) and its two `github.com` literals leave; `cloneRepo`/`ensureRepoWorkspace` clone verbatim; `EnsureRepoWorkspaceDeps.log` retyped to the port.
- `adws/gitContext/bootstrapIdentity.ts` — splits: keeps `readOriginRemoteUrl`, `readEnvGitIdentity`, `readGitConfigIdentity`; loses the two regexes, `parseGitHubRemoteUrl`, `readLocalRepoInfo`, `ghAuthToken` and `resolveBootstrapGitIdentity`.
- `adws/gitContext/worktreeCreateOps.ts` — drops `import { log } from '../core/utils'` (`:6`); takes `log: Logger` third.
- `adws/gitContext/worktreeRemoveOps.ts` — same (`:7`); note `removeWorktree`/`removeWorktreesForIssue` keep their trailing optional `killProcs` parameter.
- `adws/gitContext/types.ts` — adds `LogLevel`, `Logger`, and `GitContextDeps.logger`.
- `adws/gitContext/gitContext.ts` — constructor resolves the logger default; six op call sites thread it (`:406`, `:416`, `:426`, `:462`, `:473`, `:483`).
- `adws/gitContext/index.ts` — public-surface edit and header rewrite.

**Adapter modules receiving the GitHub material**
- `adws/providers/github/githubTokenProvider.ts`, `tokenResolver.ts`, `ghCommandRunner.ts` — the shape and header conventions the new adapter modules must match.
- `adws/providers/github/index.ts` — read to confirm the new modules are **not** added to the barrel.

**ADW wiring layer**
- `adws/core/targetRepoManager.ts` — applies `convertToSshUrl` before delegating; the log cast at `:69` disappears.
- `adws/github/gitContextFactory.ts` — repointed imports plus `{ logger: log }` at `:111` and `:120`.
- `adws/core/launchGitContext.ts` — repointed imports plus `{ logger: log }` at `:133`.
- `adws/github/githubApi.ts` — `parseGitHubRemoteUrl` repoint (`:6`, used at `:28`).
- `adws/core/logger.ts` — the `log(message, level = 'info')` signature the port must stay assignable from (`:62`).

**Guard and tests**
- `adws/checkGitGhGuard.ts` — read-only for this slice. `CWD_DERIVED_IDENTITY_FNS` (`:75`) matches `readLocalRepoInfo` **by name**, so relocating it changes nothing; `EXEMPT_PACKAGES` (`:55-64`) already covers both destinations.
- `adws/gitContext/__tests__/bootstrapIdentity.test.ts` — splits with the module.
- `adws/gitContext/__tests__/repoWorkspace.test.ts` — loses the `convertToSshUrl` block, gains a pass-through assertion.
- `adws/gitContext/__tests__/{gitContext,gitContextOperations,repoApiCwd,gitReadOps,workingDirectoryGuard,remoteOps,claimOps,commitOps}.test.ts` — the untouched regression net.
- `features/per-issue/step_definitions/feature-779.steps.ts` — import repoint only.
- `features/per-issue/step_definitions/feature-777.steps.ts` — drives the real `ensureRepoWorkspace` with an HTTPS URL (`:230-232`); its assertions (`:342-349`) check only `startsWith('git clone')` and the workspace path, so they stay green and now additionally witness pass-through.

**Documentation (conditional docs that own these paths)**
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/gitContext/**`, `adws/github/gitContextFactory.ts`, `adws/core/launchGitContext.ts`, `adws/core/targetRepoManager.ts`; its conditions name `parseGitHubRemoteUrl`/`convertToSshUrl`, `readLocalRepoInfo`, `ghAuthToken`, `ensureRepoWorkspace` and the worktree ops directly.
- `app_docs/feature-e2er82-github-forge-adapter.md` — owns `adws/providers/github/**`; the deep-import-never-the-barrel rule lives here.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — the `EXEMPT_PACKAGES` / `(0 allowlisted)` / cwd-derived-identity contract.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — owns `adws/core/launchGitContext.ts`.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — conditions covering `ensureWorktree`/`createWorktree`/`removeWorktree`/`removeWorktreesForIssue`.
- `app_docs/feature-9gjajh-providers.md`, `app_docs/feature-9gjajh-github-api.md` — glob owners of `adws/providers/**` and `adws/github/**`.
- `specs/prd/gitcontext-forge-agnostic-refactor.md` — parent PRD (Implementation Decisions → Core cleanup; stories 14, 15, 17, 20).
- `specs/issue-792-adw-e2er82-consolidate-github-f-sdlc_planner-github-forge-adapter.md` — the prior slice's plan; its Notes hand this slice `bootstrapIdentity.ts`, `convertToSshUrl` and the `ghAuthToken` decision.
- `README.md` — the `gitContext/` subtree (`:635-677`) and `providers/github/` subtree (`:795-807`).
- `.adw/coding_guidelines.md`, `.adw/project.md`, `.adw/commands.md`, `.adw/scenarios.md`.

### New Files

- `adws/providers/github/githubIdentity.ts` — `RepoInfo`, `parseGitHubRemoteUrl`, `readLocalRepoInfo`, App-bot derivation, the ADW Bot fallback constant, `resolveBootstrapGitIdentity`, `BootstrapIdentityDeps`.
- `adws/providers/github/cloneUrl.ts` — `convertToSshUrl`.
- `adws/providers/github/ghAuthToken.ts` — `ghAuthToken`.
- `adws/gitContext/consoleLogger.ts` — the `consoleLogger` default for the logger port.
- `adws/providers/github/__tests__/githubIdentity.test.ts` — relocated identity/parse/readLocalRepoInfo cases.
- `adws/providers/github/__tests__/cloneUrl.test.ts` — relocated + extended clone-URL construction cases (the PRD's "new tests only for clone-URL construction moving in").
- `adws/gitContext/__tests__/worktreeLogger.test.ts` — the logger port's own suite.
- `features/per-issue/feature-793.feature` — this slice's BDD proof (`@adw-793`), written by the scenario phase against the coverage map below.
- `features/per-issue/step_definitions/feature-793.steps.ts` — its step definitions.

## Implementation Plan

### Phase 1: Foundation

Add the logger port to `types.ts` and the `consoleLogger` default, then thread `Logger` through the two worktree op modules and `GitContext`. Wire the real ADW logger at the three production construction sites so no observable output changes. This phase is self-contained and removes the core's only two application imports.

### Phase 2: Core Implementation

Split `bootstrapIdentity.ts` along the git/GitHub line, creating `githubIdentity.ts`, `ghAuthToken.ts` and `cloneUrl.ts` in the adapter, and strip the rewrite out of `repoWorkspace.ts`. Move the affected test cases with their modules, keeping every assertion intact. Trim `adws/gitContext/index.ts` to the forge-neutral surface.

### Phase 3: Integration

Repoint the five importers (plus the one step-definition file), move the SSH conversion up into `targetRepoManager.ts`, and prove the whole thing with the unit suites, the `@adw-793` scenarios, the merged proofs that cover the moved code (`@adw-700`, `@adw-777`, `@adw-779`, `@adw-790`, `@adw-791`, `@adw-792`), the worktree behaviour proofs (`@adw-628`, `@adw-661`, `@adw-758`) and the guard.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Declare the logger port

- In `adws/gitContext/types.ts`, add `LogLevel` (`'info' | 'error' | 'success' | 'warn'`) and `Logger` (`(message: string, level?: LogLevel) => void`), each with a doc comment stating that the port exists so the package carries no host-application dependency (PRD story 17), and that the shape deliberately matches `adws/core/logger.ts`'s `log` so the ADW logger is injectable with no adapter.
- Add `logger?: Logger` to `GitContextDeps` with a comment naming `consoleLogger` as the default.
- Create `adws/gitContext/consoleLogger.ts` exporting `consoleLogger: Logger`, writing every level to `console.log` — a comment must record *why* every level goes to stdout (the host logger does the same, so piped-output ordering is preserved).

### 2. Convert the two worktree op modules to the port

- `adws/gitContext/worktreeCreateOps.ts`: delete `import { log } from '../core/utils'` (`:6`); import `type { Logger }` from `./types`; add `log: Logger` as the third parameter of `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree` and `copyEnvToWorktree`, and thread it into the private helpers `freeBranchFromMainRepo`, `copyEnvToWorktree` and `resolveBranchExists`.
- `adws/gitContext/worktreeRemoveOps.ts`: the same for `removeWorktree` and `removeWorktreesForIssue` and their helpers `pruneAndRmWorktreeDir`, `rmOrphanedWorktreeDir` and `removeOneWorktree`. Keep `killProcs` as the trailing optional parameter with its `killProcessesInDirectory` default.
- Change no message text and no level on any `log(...)` call. Confirm with `grep -c "log(" ` before and after that the call count is identical in each file.

### 3. Resolve the logger inside GitContext and thread it

- `adws/gitContext/gitContext.ts`: add `readonly #log: Logger`, assign `deps.logger ?? consoleLogger` in the constructor next to `#fsDeps`, and pass `this.#log` at the six call sites (`:406`, `:416`, `:426`, `:462`, `:473`, `:483`) in the new third position.
- Add one sentence to the module header recording that logging arrives through an injected port with a console default (PRD story 17).

### 4. Inject the real logger at the three production construction sites

- `adws/github/gitContextFactory.ts`: import `log` from `../core/utils` and construct with `new GitContext(options, { logger: log })` at `:111` and `new GitContext({…}, { logger: log })` at `:120`.
- `adws/core/launchGitContext.ts`: import `log` from `./utils` and construct with `{ logger: log }` at `:133`.
- Verify these are the only non-test construction sites: `grep -rn "new GitContext(" adws workers scripts --include='*.ts' --include='*.tsx' | grep -v __tests__` must list exactly these three.

### 5. Add the logger port's unit suite

- Create `adws/gitContext/__tests__/worktreeLogger.test.ts`, driving a real `GitContext` with an injected `exec` spy and `fsDeps` fake (the established pattern in `repoApiCwd.test.ts` / `gitContext.test.ts`).
- Assert: `createWorktree`, `ensureWorktree` and `removeWorktree` route their messages to an injected `logger` spy with the expected level; a context constructed with **no** `logger` still completes without throwing (console default exercised); and `adws/gitContext/worktreeCreateOps.ts` / `worktreeRemoveOps.ts` no longer import the application logger — assert on the source text so the AC is pinned, not just the behaviour.

### 6. Split `bootstrapIdentity.ts` — the core half

- Replace `readLocalRepoInfo` with `readOriginRemoteUrl(cwd?): string` — `execSync('git remote get-url origin', { encoding: 'utf-8', cwd }).trim()`, letting the git failure propagate (the wrapper message moves to the adapter with the parse).
- Extract `readEnvGitIdentity(env)` (the `GIT_AUTHOR_*` / `GIT_COMMITTER_*` block at `:135-142`, unchanged semantics including `committerName = env.GIT_COMMITTER_NAME || authorName`) and `readGitConfigIdentity(deps?)` (the `git config` block at `:144-150`, returning `null` on any failure).
- Rename `BootstrapIdentityDeps` to `GitConfigIdentityDeps` **in the core only** (`exec`, `env`; `isAppConfigured` goes with the adapter).
- Delete `parseGitHubRemoteUrl`, `HTTPS_REMOTE_RE`, `SSH_REMOTE_RE`, `RepoInfo`, `ghAuthToken` and `resolveBootstrapGitIdentity` from this file, and rewrite the header to describe generic pre-context **git** reads with no forge vocabulary.

### 7. Create the adapter's identity module

- Create `adws/providers/github/githubIdentity.ts` with `RepoInfo`, the two regexes, `parseGitHubRemoteUrl` (moved character-for-character — the #779 lazy/end-anchored comment travels with it), `readLocalRepoInfo(cwd?)`, `deriveAppBotIdentity`, `ADW_BOT_FALLBACK_IDENTITY`, `BootstrapIdentityDeps` and `resolveBootstrapGitIdentity`.
- `readLocalRepoInfo` must keep the `try { … } catch { throw new Error(\`Failed to get repo info: ${error}\`) }` shape spanning **both** the core read and the parse, so the inner `Could not parse GitHub URL: …` message is still wrapped exactly as today.
- `resolveBootstrapGitIdentity` keeps its four-step order and its defaults (`env ?? process.env`, `exec ?? execSync`, `isAppConfigured ?? (() => Boolean(GITHUB_APP_ID && GITHUB_APP_SLUG && GITHUB_APP_PRIVATE_KEY_PATH))`), delegating steps 2 and 3 to the core's `readEnvGitIdentity` / `readGitConfigIdentity`.
- Header must state that this module owns GitHub naming conventions on behalf of the core (PRD story 15) and that it imports the core's generic readers rather than shelling out itself.

### 8. Move `ghAuthToken` to the adapter

- Create `adws/providers/github/ghAuthToken.ts` with the function moved verbatim.
- The header must record the decision from Solution §2: why it belongs to the `gh` package, why it cannot route through `ghCommandRunner` (circular — it produces the credential the runner needs), and why the ADW boundary is not an option (the guard has no allowlist and `(0 allowlisted)` is pinned by `@adw-700`). Cite `feature-792.feature`'s flagged note so the decision is traceable.

### 9. Move clone-URL construction to the adapter

- Create `adws/providers/github/cloneUrl.ts` with `convertToSshUrl` moved verbatim, importing `parseGitHubRemoteUrl` from `./githubIdentity`.
- `adws/gitContext/repoWorkspace.ts`: delete the `parseGitHubRemoteUrl` import (`:17`) and `convertToSshUrl` (`:58-67`); in `cloneRepo`, replace `const sshUrl = convertToSshUrl(cloneUrl)` with direct use of `cloneUrl` in both log lines and the `git clone` string; update the `cloneRepo` and `ensureRepoWorkspace` doc comments to state that the caller supplies a ready clone URL (PRD story 14).
- Retype `EnsureRepoWorkspaceDeps.log` (`:36`) and `cloneRepo`'s `opts.log` to `Logger`, importing the type from `./types`.

### 10. Move the SSH conversion up into the ADW wiring shim

- `adws/core/targetRepoManager.ts`: import `convertToSshUrl` from `../providers/github/cloneUrl` (deep path) instead of `../gitContext`; apply it in `cloneTargetRepo` (`:43-47`) and `ensureTargetRepoWorkspace` (`:66`); keep the `export { isRepoCloned, convertToSshUrl }` line at `:37` so downstream import paths are unchanged.
- Replace the `log: (msg, level) => log(msg, (level as …) ?? 'info')` cast at `:69` with the direct `log` reference now that the seam is typed `Logger`.
- Update the module header: the shim is the site that hands the core a ready clone URL.

### 11. Trim the core's public surface

- `adws/gitContext/index.ts`: remove `readLocalRepoInfo`, `ghAuthToken`, `resolveBootstrapGitIdentity`, `parseGitHubRemoteUrl`, `BootstrapRepoInfo`, `BootstrapIdentityDeps` and `convertToSshUrl`; add `readOriginRemoteUrl`, `readEnvGitIdentity`, `readGitConfigIdentity`, `type GitConfigIdentityDeps`, and `type Logger` / `type LogLevel` from `./types`.
- Rewrite the "Bootstrap exceptions" header paragraph: the remaining pre-context primitives are generic **git** reads; GitHub remote parsing, bot-identity derivation, clone-URL construction and `gh auth token` live in `adws/providers/github/`.

### 12. Repoint every importer

- `adws/github/gitContextFactory.ts:11-15` — `readLocalRepoInfo` and `resolveBootstrapGitIdentity` from `../providers/github/githubIdentity`, `ghAuthToken` from `../providers/github/ghAuthToken`. Leave the `export { readLocalRepoInfo }` re-export at `:87` in place.
- `adws/core/launchGitContext.ts:22` — the same two deep paths.
- `adws/github/githubApi.ts:6` — `parseGitHubRemoteUrl` from `../providers/github/githubIdentity`.
- `features/per-issue/step_definitions/feature-779.steps.ts:21` — `readLocalRepoInfo` and `type RepoInfo` from `../../../adws/providers/github/githubIdentity.ts`. Change no `Given`/`When`/`Then` phrase and no assertion.
- Confirm nothing is left behind: `grep -rn "gitContext/bootstrapIdentity\|parseGitHubRemoteUrl\|convertToSshUrl\|ghAuthToken\|resolveBootstrapGitIdentity" adws features test --include='*.ts' --include='*.tsx'` must show only adapter paths, the `targetRepoManager` re-export and the token-provider seam fields.
- Do **not** add any of the three new modules to `adws/providers/github/index.ts`.

### 13. Split and relocate the identity tests

- Create `adws/providers/github/__tests__/githubIdentity.test.ts` and move into it, unchanged, the `parseGitHubRemoteUrl` block (`bootstrapIdentity.test.ts:11-81`), the `readLocalRepoInfo` real-git block (`:83-118`, including the `getRepoInfo` cross-check whose `../../github/githubApi` import becomes `../../../github/githubApi`) and the `resolveBootstrapGitIdentity` block (`:120-194`).
- Leave `adws/gitContext/__tests__/bootstrapIdentity.test.ts` holding the generic half, and add cases for the newly named core functions: `readOriginRemoteUrl` returns the trimmed remote of a throwaway repo and propagates the git failure otherwise; `readEnvGitIdentity` returns `null` on an incomplete env and a complete identity otherwise; `readGitConfigIdentity` returns `null` when `git config` throws.
- Add one AC-pinning case to the core suite: the core module's source contains no `github.com` literal and no `gh ` command string.

### 14. Split the workspace tests and add the clone-URL suite

- Create `adws/providers/github/__tests__/cloneUrl.test.ts` and move the whole `convertToSshUrl` describe block (`repoWorkspace.test.ts:31-68`), including both #779 dotted-name regressions, with assertions unchanged.
- Extend it with the cases the PRD asks for as new: a `ssh://git@github.com/owner/repo.git` input, an owner or repo containing a hyphen/dot, and an empty string — each must return the input unchanged rather than producing a malformed SSH URL.
- In `adws/gitContext/__tests__/repoWorkspace.test.ts`, delete the moved block and add a pass-through assertion to the clone branch: an HTTPS URL handed to `ensureRepoWorkspace` produces a `git clone "https://…"` command **verbatim** — the core rewrites nothing.

### 15. Update the README

- `gitContext/` subtree (`:635-677`): annotate `bootstrapIdentity.ts` as generic pre-context git reads only; annotate `repoWorkspace.ts` as taking a ready clone URL; add `consoleLogger.ts`; add `__tests__/worktreeLogger.test.ts`; update the `types.ts` line with `Logger`/`LogLevel`; update the `index.ts` line to say GitHub identity, clone-URL construction and `gh auth token` now live in the adapter.
- `providers/github/` subtree (`:795-807`): add `cloneUrl.ts`, `ghAuthToken.ts`, `githubIdentity.ts` and the two new `__tests__` entries, each with a one-line description matching the surrounding style.
- Before committing, verify no line documenting a still-existing file was dropped: for each removed line, confirm the file no longer exists at that path. (Per the recurring README-drift lesson, a `-` line is only legitimate if the file is gone or documented elsewhere.)

### 16. Run the validation commands

- Execute every command in `## Validation Commands` and confirm each exits clean. Investigate and fix any failure rather than re-running or weakening an assertion.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`.

**Relocated, assertions unchanged:**
- `adws/providers/github/__tests__/githubIdentity.test.ts` — the `parseGitHubRemoteUrl` table (HTTPS, SCP-style SSH, credential-bearing, `ssh://`, dotted names, the `repo.git.git` edge, the non-GitHub `null`), the real-git `readLocalRepoInfo` end-to-end block including the `Failed to get repo info` throw, and the four-step `resolveBootstrapGitIdentity` order including the exact bot-email format `12345+my-app[bot]@users.noreply.github.com`.
- `adws/providers/github/__tests__/cloneUrl.test.ts` — the five existing `convertToSshUrl` cases.

**New:**
- `adws/providers/github/__tests__/cloneUrl.test.ts` (extension) — `ssh://` form, punctuated owner/repo, empty input; each returns the input unchanged.
- `adws/gitContext/__tests__/bootstrapIdentity.test.ts` (rewritten around the generic half) — `readOriginRemoteUrl`, `readEnvGitIdentity`, `readGitConfigIdentity`, plus the source-level assertion that the module carries no `github.com` literal and no `gh ` command.
- `adws/gitContext/__tests__/worktreeLogger.test.ts` — injected-logger routing for create/ensure/remove, the console default path, and the source-level assertion that neither worktree op module imports `../core/utils`.
- `adws/gitContext/__tests__/repoWorkspace.test.ts` (extension) — HTTPS clone URL reaches `git clone` verbatim.

**Regression net, must pass unedited:** `adws/gitContext/__tests__/{gitContext,gitContextOperations,repoApiCwd,gitReadOps,workingDirectoryGuard,remoteOps,claimOps,commitOps}.test.ts`, `adws/providers/github/__tests__/{appAuth,ghCommandRunner,githubTokenProvider,tokenResolver}.test.ts`, `adws/__tests__/checkGitGhGuard.test.ts`, `adws/core/__tests__/launchGitContext.test.ts`. If any of them needs changing, the split stopped being behaviour-neutral and the cause must be found rather than the expectation updated.

### BDD Scenarios

`features/per-issue/feature-793.feature` (`@adw-793`) is this slice's behavioural proof and the build's RED-first driver. The file has now been written, and the map below is the **delivered** coverage — it replaces the suggested map this plan carried before alignment. Every `§n` refers to a banner comment in that file.

- **AC1 (ready clone URL, ready identity)** → **§1** every clone-URL form handed to the workspace manager reaches the `git clone` command verbatim (seven rows: GitHub HTTPS with and without `.git`, the dotted-name `paysdoc.nl` row, GitHub SSH, GitLab, a self-hosted forge, a `file://` mirror), plus a whole-command row proving the destination directory is the only thing the core adds. RED today on every GitHub HTTPS row. **§2** the fetch path never consults the clone URL: an already-cloned workspace handed `not-a-url` records exactly `git fetch origin` and consults the injected default-branch thunk. **§5** the core's identity resolution ignores `GITHUB_APP_*` and answers with what git itself was told — RED today, the App branch wins. **§8**'s third scenario: the core's origin-remote read hands back a non-GitHub URL exactly as git reported it — RED today, the core's only pre-context remote read insists on a GitHub URL and throws.
- **AC2 (no `github.com` in core)** → **§6**, stated as behaviour rather than as a source scan: with nothing configured at all, no field of whatever the core produces carries a forge host. The file's step note makes that pin accept *either* a neutral identity *or* the core declining to answer, so it holds whichever way the default is split; this plan takes the second (see Edge Cases). RED today either way — the answer is `ADW Bot <adw-bot@users.noreply.github.com>`. The literal source-level assertions deliberately live outside the feature file: the core-suite case added in step 13 (`bootstrapIdentity.ts` carries no `github.com` literal and no `gh ` command string) and the `grep -rn "github\.com" adws/gitContext` validation command.
- **AC3 (zero ADW application imports)** → **§9** create and remove both deliver their messages, *with their levels*, to an injected logger, and with one injected nothing from the operation reaches the console; **§10** a context built with no logger still reports, to the console. The source-level half — neither worktree op module imports `../core/utils` — is the `worktreeLogger.test.ts` case in step 5, paired with the `from '\.\./core…` validation grep. Nothing in the feature file pins `gitContext.ts`'s five TRANSITIONAL `../providers/github/commands/*` builder imports: the file's own risk note reads AC3 as the ADW application families only, exactly as this plan's Notes do.
- **AC4 (behaviour unchanged)** → **§3** ADW still clones the SSH form of a repository's published clone URL (five rows: HTTPS with and without suffix, the dotted name, already-SSH, and a non-GitHub pass-through) — the counterweight that separates a relocation from a deletion, and the reason step 10 exists. **§4** absent workspace → clone and return the workspace path; present workspace → fetch and never re-clone. **§7** the GitHub boundary still derives the App bot identity, still answers App → `GIT_AUTHOR_*` → `git config` → `ADW Bot <adw-bot@users.noreply.github.com>` in that order, and that identity still reaches a git command's child environment. **§8** every remote form still resolves to the same owner/repo at the boundary, dotted names included, and a remote on another forge is still refused there. **§11** a worktree created through a production-built context still prints the ADW-formatted line — emoji prefix, ISO timestamp, `[adwId]`. **§12** the create and remove flows issue exactly the git commands they issue today. **§T** is the type check, which is where a dangling import from the move surfaces. The "full suite green" half is carried by the unit suites and the merged proof tags, deliberately not by a scenario that shells out to the whole suite (the precedent set by #790 and #792 for the identical criterion).

Four consequences for the implementation:

1. **The logger must be reachable through `GitContextDeps` alone**, with no ambient state, and the level must travel with the message — §9 asserts `success` on the create line and `info` on `copyEnvToWorktree`'s `skipping copy` line, so a port carrying only the string fails.
2. **§11 is the decision-forcing scenario the file flags**, and this plan answers it the way the file demands rather than striking it: all three production construction sites inject the ADW `log` (step 4), so operator output stays byte-identical.
3. **§5 and §6 bind to the core's identity resolution, which this plan splits into two readers.** The file's step note names four binding helpers, one per moving function; helper (2) becomes a composition — `readEnvGitIdentity(env) ?? readGitConfigIdentity({ env, exec })` — because no composite resolver survives in the core. One helper changes; no scenario does. The identity steps inject `env` and `exec` only, never `isAppConfigured`, which is what makes §5 RED today and is why the core half must not accept that dep at all.
4. **A re-export shim is not a way out.** These scenarios are behavioural rather than source scans, but a shim in `adws/gitContext/` re-exporting the adapter's `resolveBootstrapGitIdentity` would make §5 and §6 answer with the bot identity and the `users.noreply.github.com` default, and leaving `convertToSshUrl` in the clone path fails every GitHub HTTPS row of §1. The split has to be real.

### Edge Cases

- **Non-GitHub clone URL** — a GitLab or self-hosted HTTPS URL must pass through both the adapter (`startsWith` guard) and the core (which no longer inspects it) untouched.
- **Dotted repo names (#779)** — `paysdoc/paysdoc.nl` must survive `convertToSshUrl` and `readLocalRepoInfo` identically after the move; the lazy, end-anchored regex must not be "tidied" during relocation.
- **Error-message wrapping** — `readLocalRepoInfo` must keep throwing `Failed to get repo info: …` for *both* an unparseable remote and a git failure; `@adw-779` asserts on that text.
- **The core keeps no default identity** — after the split, `readEnvGitIdentity` and `readGitConfigIdentity` both return `null` when nothing is configured and the core supplies no fallback of its own. That is what satisfies §6 ("the core answered with no forge address", which accepts a decline), and it is why the `ADW Bot <adw-bot@users.noreply.github.com>` default must reappear *in the adapter* — §7's fourth row asserts it. Neutralising the address inside the core instead would pass §6 and fail §7.
- **Identity resolution order** — the App-bot branch must still win over `GIT_AUTHOR_NAME`, and the git-config branch must still be skipped when the env pair is complete. A reordering here silently changes commit authorship on every ADW commit.
- **Late-bound `GITHUB_APP_*`** — `resolveBootstrapGitIdentity` reads `deps.env ?? process.env` per call today; several merged proofs assign those variables after module load, so the relocated function must not capture the environment at import time.
- **Logger threading omission** — a missed call site silently falls back to `consoleLogger`, losing the timestamp/adwId prefix in production. The three-construction-site check in step 4 and §11 — the one scenario that builds a context the way ADW builds one and asserts the ADW-formatted line — are what catch it.
- **Log level fidelity** — `worktreeRemoveOps` logs at `'error'` on cleanup failure and `'success'` on removal; the port's optional `level` parameter must not collapse them to a default.
- **Import cycles** — `githubIdentity.ts` may import the core's `bootstrapIdentity` (the core's `commands/` imports are leaves, so no cycle closes), but no wiring module may import the `adws/providers/github` barrel. Deep paths only.
- **Guard by name, not by path** — `CWD_DERIVED_IDENTITY_FNS` matches `readLocalRepoInfo` textually; keeping the exported name is what preserves `@adw-769`'s cwd-derived-identity rule across the move.
- **`git mv` history** — use `git mv` where a file moves wholesale, so `git log --follow` still reaches #700/#779 on the relocated material.

## Acceptance Criteria

- [ ] `adws/gitContext/repoWorkspace.ts` contains no `convertToSshUrl` and no `github.com` literal; `cloneRepo` and `ensureRepoWorkspace` clone the URL they are given, verbatim, and their doc comments say so.
- [ ] `adws/gitContext/bootstrapIdentity.ts` exports only generic git primitives (`readOriginRemoteUrl`, `readEnvGitIdentity`, `readGitConfigIdentity`) and contains no `github.com` literal, no GitHub App bot derivation, no remote-URL regex and no `gh` command.
- [ ] `grep -rn "github\.com" adws/gitContext --include='*.ts' | grep -v __tests__` returns nothing.
- [ ] `parseGitHubRemoteUrl`, `readLocalRepoInfo`, `resolveBootstrapGitIdentity`, `ghAuthToken` and `convertToSshUrl` live under `adws/providers/github/`, keep their exported names, and are reached by every importer through deep module paths (never the barrel).
- [ ] `grep -rn "from '\.\./core\|from '\.\./agents\|from '\.\./phases\|from '\.\./github\|from '\.\./triggers\|from '\.\./vcs" adws/gitContext --include='*.ts'` returns nothing; the only remaining upward import in the package is `gitContext.ts`'s five TRANSITIONAL `../providers/github/commands/*` builder imports, still marked as owned by #796/#797.
- [ ] `GitContextDeps.logger` exists, `consoleLogger` is the default, and `gitContextFactory.ts` (×2) and `launchGitContext.ts` (×1) each inject the ADW `log` — so production output is byte-identical to today.
- [ ] Workspace clone/fetch and worktree create/ensure/remove behaviour is unchanged: the same command strings, the same working directories, the same return values, the same log messages and levels.
- [ ] `bun run test:unit` is green with no test skipped or removed; `bunx tsc --noEmit` is clean at the repository root and under `adws/tsconfig.json`; `bun run lint` is clean.
- [ ] `bun run lint:git-guard` exits 0 across the whole repository and still prints `(0 allowlisted)`.
- [ ] Every `@adw-793` scenario is green with none pending, including every row that is RED before the change: §1's GitHub HTTPS clone-URL forms, §5's two core-identity scenarios, §6's no-forge-address scenario, §8's core origin-remote read of a non-GitHub URL, and §9's four injected-logger scenarios.
- [ ] The `@regression` suite and the tags `@adw-628`, `@adw-661`, `@adw-700`, `@adw-758`, `@adw-777`, `@adw-779`, `@adw-790`, `@adw-791`, `@adw-792` are green.
- [ ] `README.md` documents the moved and new files, and no line documenting a still-existing file was removed.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint across the repository.
- `bunx tsc --noEmit` — root type check (also what `bun run test` runs).
- `bunx tsc --noEmit -p adws/tsconfig.json` — the `adws/` project type check (`.adw/commands.md` → `## Additional Type Checks`).
- `bun run build` — `tsc` build.
- `bun run test:unit` — full vitest suite; must be green with no skips.
- `bun run lint:git-guard` — whole-repo git/gh guard; must exit 0 and print `(0 allowlisted)`.
- `bunx vitest run adws/gitContext adws/providers/github adws/core/__tests__/launchGitContext.test.ts adws/__tests__/checkGitGhGuard.test.ts` — focused run over the split suites, the adapter and the boundary.
- `grep -rn "github\.com" adws/gitContext --include='*.ts' | grep -v __tests__` — must return no matches (AC2).
- `grep -rn "from '\.\./core\|from '\.\./agents\|from '\.\./phases\|from '\.\./github\|from '\.\./triggers\|from '\.\./vcs" adws/gitContext --include='*.ts'` — must return no matches (AC3).
- `grep -rn "convertToSshUrl\|parseGitHubRemoteUrl\|resolveBootstrapGitIdentity\|ghAuthToken" adws/gitContext --include='*.ts'` — must return no matches.
- `grep -rn "new GitContext(" adws workers scripts --include='*.ts' --include='*.tsx' | grep -v __tests__` — exactly three sites, each passing `{ logger: log }`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-793"` — this slice's own scenarios; all must pass, none pending.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression scenario suite.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-700 or @adw-777 or @adw-779 or @adw-790 or @adw-791 or @adw-792"` — the merged proofs covering the moved modules.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-628 or @adw-661 or @adw-758"` — the worktree create/ensure/remove behaviour proofs that run against real git repositories, which is where a mis-threaded logger parameter would surface.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies. This slice is guideline-driven work: it isolates side effects at the boundary (the logger port), replaces a type assertion with a properly typed seam (`targetRepoManager.ts:69`), keeps the relocated functions pure, and leaves every touched file well under the 300-line ceiling. `consoleLogger.ts` is a ~5-line module justified by named intent and single definition, exactly as the extraction rule describes.
- **No new libraries.** Nothing here needs a dependency. (`.adw/commands.md` → `## Library Install Command` is `bun add <package>` if that changes.)
- **The `ghAuthToken` decision is the one judgment call to review.** `feature-792.feature` explicitly asked for a decision rather than an oversight, and `feature-793.feature`'s risk note re-raises it — *"`ghAuthToken` IS NOT COVERED BY ANY ACCEPTANCE CRITERION, AND IT SHOULD BE RAISED, NOT SILENTLY MOVED … This file does NOT pin it — that is the planner's call"* — so no `@adw-793` scenario constrains the outcome and this plan owns it. Solution §2 records the reasoning: the adapter is the only home consistent with the guard's stated roles, the ADW boundary is guard-blocked because the ALLOWLIST is gone, and routing it through `ghCommandRunner` is circular. The consequence is that `adws/providers/github/` now contains exactly one direct `execSync` — the pre-context credential read — and #792's plan-level `grep child_process adws/providers/github/` expectation is superseded. No merged scenario asserts that grep; #792's AC3 scenarios (§11–§14) are behavioural, over injected fakes.
- **What this slice deliberately does NOT do.** It does not touch `GitContext`'s semantic methods, their five transitional builder imports, `GitContextOptions.token`/`.pat`, or the `gh` command strings inside `gitContext.ts` (`defaultBranch()` at `:316` and the issue/PR/label/board/secret methods). Those are #796/#797. AC3's "zero imports from ADW application code" is therefore read — as its own parenthetical "(logger injected)" indicates — as the `adws/core`, `adws/github`, `adws/phases`, `adws/agents`, `adws/triggers`, `adws/vcs` families, not as the adapter dependency #792 documented and scheduled for deletion.
- **Also out of scope, with their owning slices:** minting bound providers at the launch boundary (**#794**); the guard's new provider-construction rule (**#795**); migrating the ~20 semantic callers (**#796**, **#797**); extraction to a separate repository (PRD Phase B).
- **Injected `GitHubAppConfig` for identity is a deliberate non-goal here.** #792 made `appAuth.ts` read zero environment variables, with `adws/github/githubAppAuth.ts` as the sole binding site. The relocated `resolveBootstrapGitIdentity` keeps reading `deps.env ?? process.env` for `GITHUB_APP_ID`/`GITHUB_APP_SLUG`, because (a) no acceptance criterion asks for it, (b) it is now in the adapter, where GitHub vocabulary belongs, and (c) changing it would alter four call-site signatures and six unit tests for no behavioural gain. Worth revisiting when the launch boundary is reshaped in #794.
- **Documentation index rot spotted while planning (non-blocking, not fixed here).** `.adw/conditional_docs.md` still lists `adws/gitContext/commands/issueCommands.ts` as an owned path of `app_docs/feature-vpb048-promotion-sweep-originate.md`; that directory moved to `adws/providers/github/commands/` in #792. `adws/core/logger.ts` has no live owner — the only two conditions naming it belong to `app_docs` files that no longer exist. Neither breaks `bunx tsx adws/checkLivingDocsIndex.ts` (it checks bijection and glob overlap, not path existence), so both are left for a dedicated chore.
- **Worktree-birth reversion check.** Per the recurring pattern, before committing run `git diff origin/dev --stat` and confirm nothing outside this slice's scope — in particular `.claude/commands/**` and unrelated `README.md` lines — has been reverted. Disambiguate with `git diff $(git merge-base HEAD origin/dev)` before treating any extra file as a revert.
