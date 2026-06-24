# Feature: GitContext — migrate git-remote / gh-api-user identity reads

## Metadata
issueNumber: `692`
adwId: `kzs5rm-gitcontext-migrate-g`
issueJson: `{"number":692,"title":"GitContext: migrate git-remote / gh-api-user identity reads","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\nAdd identity-read methods (`git remote get-url origin`, `gh api user` — `authenticatedUser` already exists) to GitContext and migrate the remaining identity-read consumers, removing their ALLOWLIST entries.\n\n## Acceptance criteria\n- [ ] Remote-URL read method on GitContext\n- [ ] githubApi, repoContext, trigger_cron route through GitContext for these reads\n- [ ] Those files removed from `ALLOWLIST`\n- [ ] `lint:git-guard` passes; tests green\n\n## Blocked by\n- Blocked by #691\n\n## Touched Files\n- adws/gitContext/gitContext.ts\n- adws/github/githubApi.ts\n- adws/providers/repoContext.ts\n- adws/triggers/trigger_cron.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 8","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-23T11:45:25Z","comments":[{"author":"paysdoc","createdAt":"2026-06-24T08:55:54Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

The `GitContext` deep module (`adws/gitContext/`) is ADW's single authority for every `git` and `gh` interaction: it bakes in the repo identity, resolves the filesystem base path in one constructor, and injects per-command auth (token/PAT + git identity) through a single private `#run()` chokepoint that never mutates `process.env`. A CI/lint guard (`adws/checkGitGhGuard.ts`, run via `bun run lint:git-guard`) fails the build on any direct `git`/`gh` shell-out outside the package, but ships as a **ratchet**: it carries an `ALLOWLIST` of files still permitted to shell out directly. The PRD's Enforcement section is only complete when that allowlist is driven to zero (excluding the permanent bootstrap/diagnostic entries that genuinely cannot use a context before one exists).

The prior slice (#691) migrated the residual **gh-read** consumers (issue/PR list/view) and removed five files from the allowlist, explicitly deferring the **identity-read** sites to a follow-up. This feature is that follow-up. It migrates the three remaining **identity-read** consumers off raw `git`/`gh` and removes each from the `ALLOWLIST`:

- `adws/github/githubApi.ts` — `git remote get-url origin` (in `getRepoInfo`) and `gh api user --jq .login` (in `getAuthenticatedUser`)
- `adws/providers/repoContext.ts` — `git remote get-url origin` (in `validateGitRemote`)
- `adws/triggers/trigger_cron.ts` — `gh issue list … --json …` (in `fetchOpenIssues`) and `git remote get-url origin` (the self-host clone-URL fallback in `buildTargetRepoArgs`)

To support these, it adds a single new **remote-URL read method** (`remoteUrl(cwd?)`) to `GitContext` (the `gh api user` read is already covered by the existing `authenticatedUser()` method, and `gh issue list` by the existing `listOpenIssues()` method added in #691). Behavior is unchanged end-to-end; the value is the structural guarantee: per-command auth (killing the `GH_TOKEN`-bleed class), correct base-path/repo scoping (killing the wrong-repo class), and a mechanically-enforced invariant rather than a convention-plus-allowlist.

## User Story

As an **ADW maintainer** (PRD user stories 5 and 8)
I want every residual git-remote / authenticated-user **identity read** to go through `GitContext` and be removed from the guard allowlist
So that auth is applied per command rather than via a process-global, the `gh`/`git` target repo is never ambiguous, and a new call site cannot reintroduce the wrong-repo / token-bleed class of bug because direct identity reads become unrepresentable outside the package (story 8: the build fails when someone shells out to `git`/`gh` directly).

## Problem Statement

Three files still shell out directly for identity reads, tolerated only because they sit on the guard's `ALLOWLIST`:

- `githubApi.ts` reads `git remote get-url origin` from the ambient `cwd` (`getRepoInfo`) and `gh api user` with the ambient `process.env` token (`getAuthenticatedUser`).
- `repoContext.ts` reads `git remote get-url origin` from a worktree `cwd` (`validateGitRemote`) to confirm a worktree's remote matches its declared identity.
- `trigger_cron.ts` reads `gh issue list … --repo o/r` and `git remote get-url origin` from the ambient `process.env`/`cwd`.

Each is an ad-hoc derivation of "which repo am I operating on / authenticated against," run from `process.cwd()` with whatever `GH_TOKEN` the (possibly long-lived) process last set — exactly the surface the GitContext PRD was written to eliminate. Until these are migrated and de-allowlisted, the PRD's Enforcement invariant (story 8) is not actually in force; it is a ratchet with three open exceptions.

There is one genuine subtlety unique to this slice (absent from #691's pure gh-read sites): `getRepoInfo` is the **bootstrap self-host identity derivation** — it reads the local git remote precisely to discover the `owner/repo` a `GitContext` is constructed *from*. It therefore cannot route through a per-repo `GitContext` instance (that instance requires the very identity this read produces). The PRD's boundary-constructor section calls this out directly ("falling back to the local git remote for self-host"), and the equivalent read already lives in the permanently-allowlisted boundary factory (`gitContextFactory.getSelfHostIdentity`). The clean resolution is to relocate this raw read into that factory and have `getRepoInfo` delegate, rather than force a circular construction.

## Solution Statement

Add one thin remote-URL **read** method to `GitContext`, routed through the existing `#run()` chokepoint (per-command auth, explicit `cwd`, no `process.env` mutation), mirroring the established `defaultBranch()` / `authenticatedUser()` inline pattern (a fixed command string with no `owner`/`repo` interpolation, so no separate command-builder is warranted):

- `remoteUrl(cwd?: string): string` — runs `git remote get-url origin` in the given `cwd` (defaulting to the context base path via `#run`).

Then migrate the three consumers:

1. **`githubApi.ts`**
   - `getAuthenticatedUser()` routes `gh api user` through `gitContextForRepo(getRepoInfo()).authenticatedUser()` (the existing method returns full `gh api user` JSON; parse `.login` client-side). The lifetime cache and graceful `null`-on-failure are preserved.
   - `getRepoInfo(cwd?)` delegates its `git remote get-url origin` read to a new **`readLocalRepoInfo(cwd?)`** exported from `gitContextFactory.ts` (the boundary factory, already permanently allowlisted as bootstrap). The function keeps its exact signature, dual HTTPS/SSH regex parse, and throw-on-failure contract, so all ~20 callers are unchanged. This removes the only two raw `git`/`gh` strings from `githubApi.ts`.

2. **`repoContext.ts`** — `validateGitRemote(cwd, repoId)` routes its read through `gitContextForRepo({ owner: repoId.owner, repo: repoId.repo }).remoteUrl(cwd)`. The declared identity is already in hand (`repoId`), so the context constructs cleanly; the explicit `cwd` (the worktree being validated, which exists) is read directly. The `parseOwnerRepoFromUrl` parse and case-insensitive owner/repo comparison are unchanged.

3. **`trigger_cron.ts`** — `fetchOpenIssues()` routes `gh issue list` through `gitContextForRepo(cronRepoInfo).listOpenIssues({ fields: [...], limit: 100 })` (the #691 method, producing the identical command); the `buildTargetRepoArgs()` self-host clone-URL fallback routes through `gitContextForRepo(cronRepoInfo).remoteUrl()`. `cronRepoInfo` is resolved at module scope, so both have identity in hand.

Each migrated site preserves its existing signature, `try/catch`, default return, and JSON-parse shape, so behavior is unchanged. Every consumer constructs its context via **`gitContextForRepo(repoInfo)`** — the established factory used throughout `adws/github/`, which auto-detects self-host so the base path always resolves to a directory that exists, and which is imported directly from `'../github/gitContextFactory'` (it is intentionally *not* re-exported from `adws/github/index.ts`).

Finally, remove exactly the three files from the `ALLOWLIST` in `checkGitGhGuard.ts` and clean up the now-unused `execSync` / `execWithRetry` imports, so `bun run lint:git-guard`, `lint`, the type-checks, unit tests, and build all pass.

## Relevant Files

Use these files to implement the feature:

### Core module — new read method + relocated bootstrap read land here
- `adws/gitContext/gitContext.ts` — the `GitContext` class. Add the `remoteUrl(cwd?)` read method routed through `#run()`, placed alongside `defaultBranch()` / `authenticatedUser()` (inline, no command-builder — fixed string, no `owner`/`repo` interpolation). `authenticatedUser()` already exists and is reused unchanged.
- `adws/github/gitContextFactory.ts` — the boundary factory (permanently allowlisted as bootstrap; already performs `git remote get-url origin` in `getSelfHostIdentity`). Add an exported `readLocalRepoInfo(cwd?: string): RepoInfo` holding `getRepoInfo`'s current implementation (dual HTTPS/SSH regex, throw-on-failure). Already exports `gitContextForRepo`.

### Consumers to migrate (remove raw `git`/`gh`)
- `adws/github/githubApi.ts` — `getRepoInfo(cwd?)` → `return readLocalRepoInfo(cwd);`. `getAuthenticatedUser()` → `gitContextForRepo(getRepoInfo()).authenticatedUser()` then `JSON.parse(...).login`, inside the existing cache + `try/catch`. Add `import { gitContextForRepo, readLocalRepoInfo } from './gitContextFactory';`; remove `import { execSync } from 'child_process';` and `import { execWithRetry } from '../core';` (both become unused — `execWithRetry`'s only use is line 75). Leave the pure parsers `getRepoInfoFromUrl` / `getRepoInfoFromPayload` and all re-exports untouched.
- `adws/providers/repoContext.ts` — `validateGitRemote(cwd, repoId)` → `remoteUrl = gitContextForRepo({ owner: repoId.owner, repo: repoId.repo }).remoteUrl(cwd);` inside the existing `try/catch` that throws the "Failed to get git remote URL" error. Add `import { gitContextForRepo } from '../github/gitContextFactory';`; remove `import { execSync } from 'child_process';` (its only use is line 160). Keep `parseOwnerRepoFromUrl` and the owner/repo comparison unchanged.
- `adws/triggers/trigger_cron.ts` — `fetchOpenIssues()` → `gitContextForRepo(cronRepoInfo).listOpenIssues({ fields: ['number','title','body','comments','createdAt','updatedAt','labels'], limit: 100 })`. The `buildTargetRepoArgs()` callback `() => execSync('git remote get-url origin'…)` → `() => { try { return gitContextForRepo(cronRepoInfo).remoteUrl(); } catch { return null; } }`. Add `import { gitContextForRepo } from '../github/gitContextFactory';`. **Keep** `import { execSync, spawn } from 'child_process';` — `execSync` is still used at line ~136 for `claude auth status` (not a git/gh string, so not a guard violation), and `spawn` for orchestrator spawning.

### Enforcement
- `adws/checkGitGhGuard.ts` — remove exactly these three `ALLOWLIST` entries (and only these): `'adws/github/githubApi.ts'`, `'adws/providers/repoContext.ts'`, `'adws/triggers/trigger_cron.ts'`. Leave every bootstrap/diagnostic/other-residual entry untouched (notably `'adws/github/gitContextFactory.ts'`, `'adws/github/prCommentDetector.ts'` (its `git log` is out of scope), `'adws/vcs/branchOperations.ts'`, `'adws/triggers/autoMergeHandler.ts'`, etc.).

### Supporting context (read, do not necessarily modify)
- `adws/github/gitContextFactory.ts` — `gitContextForRepo(repoInfo)` (auto self-host detection + per-repo token) and `getSelfHostIdentity()` (the existing bootstrap remote read that proves `readLocalRepoInfo` belongs here). Import `gitContextForRepo`/`readLocalRepoInfo` directly from `'../github/gitContextFactory'`.
- `adws/core/launchGitContext.ts` — `buildLaunchGitContext`; its `deps.getRepoInfo` default is `getRepoInfo` from `githubApi`. After delegation, `getRepoInfo` still returns the identical `RepoInfo`, so the launch boundary is unaffected.
- `adws/triggers/cronRepoResolver.ts` — `resolveCronRepo` / `buildCronTargetRepoArgs`; `cronRepoInfo` is the identity threaded into the migrated cron reads; `buildCronTargetRepoArgs` already takes the clone-URL fallback as an injected callback (the testable seam).
- `adws/github/prCommentDetector.ts` — the sole consumer of `getAuthenticatedUser()`; its signature (`string | null`) is preserved, so no change is required here (it stays allowlisted for its unrelated `git log`).
- `adws/gitContext/commands/prCommands.ts` / `commands/issueCommands.ts` — pure command builders; **no change** (the `gh issue list` builder `listOpenIssuesCmd` and the `gh api user` path already exist; `remoteUrl` needs no builder).
- `specs/prd/git-context-repo-authority.md` — the parent PRD (Solution, Implementation Decisions → Boundary constructors, Enforcement; stories 5, 8).
- `specs/issue-691-adw-96qtfe-gitcontext-migrate-g-sdlc_planner-migrate-gh-read-consumers.md` — the immediately-prior slice; mirror its method-thinness, `gitContextForRepo` consumption, and guard-edit discipline.

### Conditional docs (matched conditions — read before editing the relevant files)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — **owns `adws/gitContext/**` and `adws/github/gitContextFactory.ts`**. Conditions: "When adding a new `gh` operation method or worktree method to `GitContext` (follow the thin-method + package-private-op pattern)"; "When implementing or troubleshooting `gitContextForRepo`, `deriveGitIdentity`, or `clearSelfHostCache`"; "When migrating a trigger or phase module off direct `execSync`/`execWithRetry` … onto `GitContext` methods (the #691 migration pattern)".
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — **owns `adws/checkGitGhGuard.ts`** and `.github/workflows/git-cli-guard.yml`. Conditions: "When migrating a residual allowlisted file to GitContext methods and removing it from the ALLOWLIST"; "When the `bun run lint:git-guard` script exits 1".
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — owns `adws/core/launchGitContext.ts`. Conditions: "When constructing a `GitContext` at a process launch boundary (cron entry-script guard…)"; "When troubleshooting the cron's module-scope `cronGitContext`".
- `app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md` — Condition: "When working with `RepoContext`, `createRepoContext`, or `adws/providers/repoContext.ts`"; "When troubleshooting git remote validation … errors".
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — Condition: "When working with VCS functions (`copyEnvToWorktree`, `ensureWorktree`, `getRepoInfo`)" and "the 'wrong repository' class of bugs".
- `app_docs/feature-9gjajh-cron-triggers.md` — owns `adws/triggers/trigger_cron.ts`.
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — Condition: "When modifying or debugging `adws/triggers/trigger_cron.ts` `checkAndTrigger()` auth identity"; directly relevant to routing cron reads through per-command auth.

### Existing test files to extend
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — the `makeSpyExec` pattern (asserts command string, `cwd`, injected `GH_TOKEN`/`GIT_*`, no `process.env` mutation, trimmed return). Add `remoteUrl()` cases.
- `adws/providers/__tests__/repoContext.test.ts` — currently covers only the pure `parseOwnerRepoFromUrl` (unaffected). Optionally add a `validateGitRemote` routing test that mocks `gitContextForRepo`.
- `adws/github/__tests__/` — no `githubApi.test.ts` exists today. Optionally add coverage for `getAuthenticatedUser` routing (mock the factory) and `readLocalRepoInfo` parsing.

## Implementation Plan

### Phase 1: Foundation — add the remote-URL read method to the GitContext package
Add `remoteUrl(cwd?)` to `GitContext` (purely additive; no consumer or guard change yet, so the codebase stays green) and unit-test it in isolation via `makeSpyExec`. Relocate `getRepoInfo`'s raw read into `gitContextFactory.readLocalRepoInfo` (still inside the allowlisted bootstrap factory, so the guard is unaffected at this point). After this phase the new method exists and the bootstrap read has its permanent home.

### Phase 2: Core Implementation — migrate the three consumers
Replace each raw `execSync`/`execWithRetry` identity read with the corresponding `gitContextForRepo(repoInfo).<method>(...)` call, preserving every signature, `try/catch`, default return, and JSON shape. Clean up now-unused `child_process` / `core` imports (keeping `execSync`/`spawn` in `trigger_cron.ts`, which still need them).

### Phase 3: Integration — flip the enforcement and validate
Remove the three entries from the guard `ALLOWLIST`, then run the full validation suite (`lint:git-guard`, `lint`, type-checks, unit tests, build) to confirm the invariant now holds with zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1 — Read context
- Read `specs/prd/git-context-repo-authority.md` (Solution, Implementation Decisions → Boundary constructors, Enforcement), `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, and `app_docs/feature-bq1f45-git-gh-cli-guard.md`.
- Re-read `adws/gitContext/gitContext.ts` (`defaultBranch`/`authenticatedUser`/`#run` patterns), `adws/github/gitContextFactory.ts` (`gitContextForRepo`, `getSelfHostIdentity`), and the prior slice `specs/issue-691-…-migrate-gh-read-consumers.md` to lock in the thin-method + `gitContextForRepo` conventions.

### Step 2 — Add the `remoteUrl` method to GitContext
- In `adws/gitContext/gitContext.ts`, add a method next to `authenticatedUser()`:
  `remoteUrl(cwd?: string): string { return this.#run('git remote get-url origin', { cwd }); }`
  (`#run` defaults `cwd` to the context base path when `cwd` is `undefined`, and already `.trim()`s the output.)
- No command-builder is needed (fixed string, no `owner`/`repo` interpolation — same rationale as `defaultBranch()` / `authenticatedUser()`).

### Step 3 — Unit-test `remoteUrl`
- In `adws/gitContext/__tests__/gitContextOperations.test.ts`, using `makeSpyExec`, add a `describe('remoteUrl() command and env', …)` asserting: exact command string `git remote get-url origin`; `cwd === ctx.basePath` when no arg; `cwd === '<explicit>'` when a cwd is passed; injected `GH_TOKEN` + four `GIT_*` env vars; no `process.env` mutation; trimmed return value (mirror the existing `defaultBranch()` cases).
- Run the gitContext suite (`bun run test:unit`) — expect green (additive only).

### Step 4 — Relocate the bootstrap remote read into the factory
- In `adws/github/gitContextFactory.ts`, add an exported `readLocalRepoInfo(cwd?: string): RepoInfo` containing the body **copied verbatim** from `githubApi.getRepoInfo` (`execSync('git remote get-url origin', { encoding: 'utf-8', cwd }).trim()`, then `.match(/github\.com\/([^/]+)\/([^/.]+)/)` for HTTPS and `.match(/git@github\.com:([^/]+)\/([^/.]+)/)` for SSH, throwing `Could not parse GitHub URL: …` / `Failed to get repo info: …` on miss). `RepoInfo` is already imported here as a type; this is a bootstrap module, so the raw `git` read stays allowlisted.

### Step 5 — Migrate `githubApi.ts`
- Replace `getRepoInfo`'s body with `return readLocalRepoInfo(cwd);` (keep the JSDoc and the `(cwd?: string): RepoInfo` signature).
- Replace `getAuthenticatedUser`'s `execWithRetry('gh api user --jq .login')` with:
  `const json = gitContextForRepo(getRepoInfo()).authenticatedUser();`
  `const login = (JSON.parse(json) as { login?: string }).login;`
  `cachedAuthenticatedUser = login || null;`
  inside the existing cache check + `try/catch` (catch still `console.warn`s and sets `cachedAuthenticatedUser = null`).
- Add `import { gitContextForRepo, readLocalRepoInfo } from './gitContextFactory';`. Remove `import { execSync } from 'child_process';` and `import { execWithRetry } from '../core';` (now unused). Keep `getRepoInfoFromUrl`, `getRepoInfoFromPayload`, and all re-exports.

### Step 6 — Migrate `repoContext.ts`
- In `validateGitRemote`, replace the `execSync('git remote get-url origin', { cwd, … })` read with `remoteUrl = gitContextForRepo({ owner: repoId.owner, repo: repoId.repo }).remoteUrl(cwd);`, keeping the surrounding `try { … } catch { throw new Error('Failed to get git remote URL in …') }` and the subsequent `parseOwnerRepoFromUrl` + owner/repo comparison unchanged.
- Add `import { gitContextForRepo } from '../github/gitContextFactory';`. Remove `import { execSync } from 'child_process';` (now unused).

### Step 7 — Migrate `trigger_cron.ts`
- In `fetchOpenIssues`, replace the `execSync('gh issue list --repo … --json number,title,body,comments,createdAt,updatedAt,labels --limit 100')` with `const json = gitContextForRepo(cronRepoInfo).listOpenIssues({ fields: ['number','title','body','comments','createdAt','updatedAt','labels'], limit: 100 });`, keeping the `JSON.parse(json)` and the `try/catch` returning `[]`.
- In `buildTargetRepoArgs`, replace the fallback callback `() => { try { return execSync('git remote get-url origin', { encoding: 'utf-8' }).trim(); } catch { return null; } }` with `() => { try { return gitContextForRepo(cronRepoInfo).remoteUrl(); } catch { return null; } }`.
- Add `import { gitContextForRepo } from '../github/gitContextFactory';`. **Keep** `import { execSync, spawn } from 'child_process';` (both still used elsewhere: `claude auth status` and orchestrator `spawn`).

### Step 8 — Add/extend consumer unit tests (where a seam exists)
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — `remoteUrl` cases added in Step 3.
- Optionally, in a new `adws/github/__tests__/githubApi.test.ts`: `vi.mock('../gitContextFactory')` so `gitContextForRepo` returns a fake ctx whose `authenticatedUser()` returns `'{"login":"octocat"}'`; assert `getAuthenticatedUser()` returns `'octocat'`, caches, and returns `null` on throw. Add `readLocalRepoInfo` HTTPS/SSH parse cases if a real-git or injected-exec seam is acceptable.
- Optionally, in `adws/providers/__tests__/repoContext.test.ts`: mock `gitContextForRepo` and assert `validateGitRemote` throws on owner/repo mismatch and passes on match. (Existing `parseOwnerRepoFromUrl` tests stay green untouched.)
- `trigger_cron.ts` has no direct test seam (module side-effects); its clone-URL fallback flows through `buildCronTargetRepoArgs` (in `cronRepoResolver.ts`), which already takes the fallback as an injected callback — no new cron-module test is required.

### Step 9 — Remove the three ALLOWLIST entries
- In `adws/checkGitGhGuard.ts`, delete exactly the `'adws/github/githubApi.ts'`, `'adws/providers/repoContext.ts'`, and `'adws/triggers/trigger_cron.ts'` lines from `ALLOWLIST`. Do not remove or reword any other entry.

### Step 10 — Validate (zero regressions)
- Run every command in **Validation Commands**. All must exit 0. In particular `bun run lint:git-guard` must PASS with the three files now scanned (proving no residual raw `git`/`gh` remains in them), and `bun run test:unit` must be green.
- Per the recurring "worktree born with dependency reversion" hazard, run `git diff origin/dev -- .claude/ '*.md'` (and the full `.claude/` tree) and revert any out-of-scope command-file or doc reversion that appears in the working tree before finishing.

## Testing Strategy

### Unit Tests
Unit tests are enabled (`.adw/project.md` → `## Unit Tests: enabled`).

- **GitContext `remoteUrl` method** (`adws/gitContext/__tests__/gitContextOperations.test.ts`, highest value — mirrors the existing `defaultBranch()` cases via `makeSpyExec`):
  - Builds exactly `git remote get-url origin`.
  - Runs with `cwd === ctx.basePath` when called with no argument; runs with `cwd === '<explicit>'` when a `cwd` is supplied.
  - Injects the context `GH_TOKEN` and all four `GIT_*` identity vars into the child env; does not mutate `process.env`.
  - Returns the trimmed stdout.
- **Consumer routing** (mock `gitContextForRepo` per the `adws/github/__tests__/prApi.test.ts` precedent, where applicable):
  - `githubApi.getAuthenticatedUser`: routes through `authenticatedUser()`, parses `.login` from the JSON, caches for the process lifetime, and returns `null` on parse/throw.
  - `githubApi.getRepoInfo` / `readLocalRepoInfo`: parses both HTTPS and SSH remotes to `{ owner, repo }` and throws on an unparseable URL (parity with the pre-migration behavior).
  - `repoContext.validateGitRemote`: reads via `remoteUrl(cwd)`, passes on a matching remote, throws the owner/repo-mismatch error on a divergent remote.

### Edge Cases
- **Bootstrap chicken-and-egg (`getRepoInfo`)**: `getRepoInfo` derives the self-host identity a context is built from, so it cannot route through a per-repo `GitContext` instance. It delegates to `readLocalRepoInfo` in the boundary factory (already allowlisted as bootstrap, already home to the equivalent `getSelfHostIdentity` read). Behavior and signature are identical; only the raw-string location moves.
- **`gh api user` extraction change**: the old read used `--jq .login` (server-side projection); the new path parses `.login` from the full-JSON `authenticatedUser()` output client-side. Result is identical (`login` string or `null`). It loses `execWithRetry`'s per-call retry — acceptable because the existing `catch` already fails open to `null` (callers treat `null` as "no self-author filter"), matching the #691 retry-loss precedent for `docsSelfCheck`.
- **Base-path / `cwd` existence**: `remoteUrl(cwd)` in `validateGitRemote` reads the *explicit* worktree `cwd` (which exists — it is the directory being validated), so there is no base-path `ENOENT` risk. For `trigger_cron`/`getAuthenticatedUser`, `gitContextForRepo` auto-detects self-host → base path `REPO_ROOT` (exists). `--repo owner/repo` keeps the `gh` target explicit regardless.
- **Token resolution at construction**: `gitContextForRepo` resolves an auth token when constructing the context, so `validateGitRemote` (previously a token-free local read) now requires a resolvable token. In ADW's runtime a token is always available (App install / `gh auth` / `GH_TOKEN`), and `createRepoContext` is only called from authenticated workflow paths; if construction throws, the existing `try/catch` surfaces the same "failed to get git remote URL" class of error. Consistent with #691 routing reads through the factory.
- **Empty / nonexistent remote**: a missing `origin` makes the underlying `git` command exit non-zero → `#run` throws → the existing `catch` returns the prior safe default (`null` clone-URL in cron; the "Ensure the repository has an 'origin' remote configured" error in `validateGitRemote`).
- **Command-string parity for `gh issue list`**: `listOpenIssues({ fields: [...7 fields...], limit: 100 })` must reproduce `gh issue list --repo o/r --state open --json number,title,body,comments,createdAt,updatedAt,labels --limit 100` exactly (no `--search`), so `fetchOpenIssues` returns the same JSON shape.
- **Guard exactness**: only the three entries are removed; `gitContextFactory.ts`, `prCommentDetector.ts`, and every other bootstrap/diagnostic/residual entry remain allowlisted (verified by `lint:git-guard` still passing).
- **Import-cycle safety**: `githubApi.ts` importing values from `gitContextFactory.ts` is safe — `gitContextFactory` imports `RepoInfo` from `githubApi` only as `import type` (erased at runtime), and none of its runtime imports (`../gitContext`, `./githubAppAuth`, `../core/environment`) form a runtime back-edge to `githubApi`. Keep the factory's `RepoInfo` import type-only.

## Acceptance Criteria
- `GitContext` exposes a `remoteUrl(cwd?)` read method that builds `git remote get-url origin`, routed through the `#run()` chokepoint (per-command auth, explicit cwd, no `process.env` mutation). (`authenticatedUser()` and `listOpenIssues()` already exist and are reused.)
- `githubApi.ts` (`getRepoInfo` + `getAuthenticatedUser`), `repoContext.ts` (`validateGitRemote`), and `trigger_cron.ts` (`fetchOpenIssues` + `buildTargetRepoArgs` fallback) contain **no** direct `git`/`gh` shell-outs; every identity read goes through a `GitContext` method (the bootstrap remote read relocated to the allowlisted `gitContextFactory.readLocalRepoInfo`).
- The three files are removed from `ALLOWLIST` in `adws/checkGitGhGuard.ts`; no other entry is changed.
- Now-unused `execSync` / `execWithRetry` imports are removed from `githubApi.ts` and `repoContext.ts`; `trigger_cron.ts` retains `execSync` (for `claude auth status`) and `spawn`.
- Behavior is unchanged: every migrated function keeps its signature, `try/catch`, default return, and parsed shape; all ~20 `getRepoInfo` callers and the sole `getAuthenticatedUser` caller (`prCommentDetector`) are unaffected.
- `bun run lint:git-guard` passes with the three files scanned; `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all succeed.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint:git-guard` — Git/GH CLI guard (`bunx tsx adws/checkGitGhGuard.ts`); must PRINT `✔ PASS  No direct git/gh shell-outs outside GitContext` with the three de-allowlisted files now scanned. This is the primary acceptance gate.
- `bun run test:unit` — Vitest (`vitest run`); all unit tests green, including the new `remoteUrl` method cases and any consumer-routing tests.
- `bun run lint` — ESLint (`eslint .`); zero errors, including no unused-import warnings from the removed `execSync` / `execWithRetry`.
- `bunx tsc --noEmit` — root type-check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW project type-check (the additional type-check from `.adw/commands.md`); zero errors.
- `bun run build` — `tsc` build; no build errors.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep the new method pure/thin (clarity over cleverness, single responsibility, immutability — build the command string, return raw stdout, let callers parse). Use guard clauses, avoid `any` (type the parsed `gh api user` JSON as `{ login?: string }`), and remove unused imports (code hygiene). No new libraries are required — this is internal refactoring over the existing `child_process`/`gh` plumbing inside the package.
- **Library install command** (`.adw/commands.md`): `bun add <package>` — not needed here (no new dependencies).
- **Import path for the factory**: `gitContextForRepo` (and the new `readLocalRepoInfo`) are imported directly from `'../github/gitContextFactory'` (its established convention across `adws/github/`); only `gitContextFor` / `gitContextForSync` are re-exported from `adws/github/index.ts`, so **no `index.ts` change is in scope**.
- **Why relocate `getRepoInfo`'s read instead of routing it through a context**: `getRepoInfo` *produces* the identity a `GitContext` requires, so routing it through `gitContextForRepo` would be circular. The PRD explicitly designates "falling back to the local git remote for self-host" as a boundary-constructor (bootstrap) concern, and the equivalent read already lives in `gitContextFactory` (`getSelfHostIdentity`). Consolidating the raw read there — rather than duplicating it in the GitHub API layer — both satisfies "off the allowlist" and matches the PRD's "one place decides which repo" principle. `readLocalRepoInfo` preserves `getRepoInfo`'s exact dual-regex parse and throw-on-failure contract.
- **Scope discipline**: do not modify `prCommentDetector.ts`, `launchGitContext.ts`, `orchestratorCli.ts`, `webhookGatekeeper.ts`, `adws/github/index.ts`, or any `getRepoInfo` caller — all consumer signatures are preserved so no out-of-scope caller edits are required. `prCommentDetector.ts` stays on the allowlist (its `git log` read is a separate slice). Per the recurring "worktree born with dependency reversion" hazard, diff the full `.claude/` / doc tree against `origin/dev` before finalizing and revert any out-of-scope command-file or doc changes that appear in the working tree (use `git diff HEAD --numstat -- <files>` to isolate a working-tree-only revert from branch staleness).
- **Future work (not this issue)**: the remaining `ALLOWLIST` residual entries that perform writes or git operations (e.g. `autoMergeHandler.ts`, `branchOperations.ts`, `worktreeProbe.ts`, `remoteReconcile.ts`, `prCommentDetector.ts`'s `git log`) are separate migration slices toward the PRD's zero-allowlist goal.
