# Feature: GitContext boundary constructor — cron + standalone orchestrators

## Metadata
issueNumber: `660`
adwId: `k2tkdn-gitcontext-boundary`
issueJson: `{"number":660,"title":"GitContext boundary constructor: cron + standalone orchestrators","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Boundary constructors**)\n\n## What to build\n\nEach cron / standalone-orchestrator entry point constructs **exactly one** `GitContext` at startup from its launch identity — parsed `--target-repo` arguments (via `core/orchestratorCli.ts` `parseTargetRepoArgs` / `triggers/cronRepoResolver.ts`), falling back to the local git remote for self-host — and threads it down through phases and agents. Nothing downstream reconstructs the context from ambient `cwd`.\n\nMigrate the merge orchestrator (`adwMerge.tsx`) and the cron repo resolution onto the context as the proof path: the takeover/cron process acts on an abandoned workflow using its own authoritative target identity, and the merge handoff resolves against the correct repository. This closes the wrong-base-repo class for the takeover path (the `spawnSync ENOENT` incident).\n\n## Acceptance criteria\n\n- [ ] cron and standalone orchestrators construct one context at startup from `--target-repo` args; absent args, self-host resolves to the framework repo root\n- [ ] The context is threaded from entry point downward; no downstream re-derivation from ambient cwd\n- [ ] `adwMerge` resolves and merges against the context's repository (story 11)\n- [ ] Takeover/cron path acts on an abandoned workflow using its own launch identity, never the framework cwd (stories 3, 10)\n- [ ] Test: a context built from `--target-repo` resolves to the target workspace; absent target args resolves to framework repo root\n\n## Blocked by\n\n- Blocked by #658\n\n## User stories addressed\n\n- User story 3\n- User story 9\n- User story 10\n- User story 11"}`

## Feature Description

This feature builds the **boundary constructor** layer of the GitContext PRD (`specs/prd/git-context-repo-authority.md`). The foundational deep module (`adws/gitContext/`) already shipped in #658: it owns base-path resolution (`selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`), `worktreePathFor(branch)`, and per-command env (`commandEnv`), with a mandatory, complete identity (no optional base path, no `cwd` fallback). What is missing is the **launch-boundary wiring**: nothing actually constructs a `GitContext` yet, and every entry point still resolves "which repo's filesystem" ad hoc from ambient `process.cwd()`.

This slice introduces a single thin adapter that constructs **exactly one** `GitContext` at each process's launch boundary from that boundary's already-authoritative launch identity (parsed `--target-repo` args, falling back to the local git remote for self-host), and threads that context downward. It then migrates two concrete paths onto the context as the proof:

1. **`adwMerge.tsx`** (the standalone merge orchestrator) — resolves and merges against the context's repository instead of `process.cwd()` (story 11).
2. **The cron → takeover path** (`trigger_cron.ts` + `takeoverHandler.ts`) — acts on an abandoned/timed-out workflow's worktree using the cron's own launch identity, instead of re-deriving the worktree base from ambient `cwd` (stories 3, 10).

The value: it closes the **wrong-base-repo class of bug** for the takeover path — the `spawnSync /bin/sh ENOENT` incident (vestmatic #187), where the cron's takeover computed an abandoned workflow's worktree under the *framework* repo's directory rather than the target's, stranding a real production issue in an unrecoverable loop. Per the PRD, the launch boundary (not persisted state, not ambient `cwd`) is the source of truth for repo scoping.

## User Story

As a takeover/cron process (story 10) and as a merge orchestrator (story 11),
I want to construct one authoritative `GitContext` from my own launch arguments at startup (story 9) and thread it down,
So that I always act on an abandoned or merge-pending workflow under the **correct** target repository's filesystem — never silently falling back to the framework repo's working directory (story 3) — making the wrong-base-repo class of failure structurally impossible on these paths.

## Problem Statement

Today, after #658 shipped the `GitContext` deep module, **nothing constructs it**. Repo-scoping decisions are still made ad hoc at each call site from ambient `process.cwd()`, with the framework repo as the silent default. Two concrete defects remain live:

- **`adwMerge.tsx:273`** — `const baseRepoPath = targetRepo ? ensureTargetRepoWorkspace(targetRepo) : process.cwd();`. For self-host runs the base repo path is whatever `process.cwd()` happens to be, not an authoritative root. This base path is threaded into `ensureWorktree(branchName, baseBranch, baseRepoPath)`, so a drifted `cwd` resolves (and creates) the merge worktree under the wrong repository.
- **`takeoverHandler.ts:136` and `:153`** — both recovery helpers call `d.getWorktreePath(state.branchName)` with **no base-path argument**. `getWorktreePath` then falls back to `getMainRepoPath()`, which shells `git worktree list` from the ambient `cwd` (the *framework* repo when the cron is dogfooding). For a *target* repo workflow this computes the abandoned worktree under the framework root → the worktree does not exist there → `spawnSync ENOENT` / unrecoverable retry loop. This is exactly the incident the PRD's takeover path was created to fix.

Because the framework dogfoods itself, the ambient `cwd` default is *correct* in the most-exercised self-host path and only detonates against target repos — so the bug ships and then fails in production. The PRD's prior centralization attempt (extracting branch-name assembly with an *optional* base-path parameter) did not hold precisely because the optional default remained reachable; #658 made the context's identity mandatory, and this slice makes that mandatory context the **only** thing the migrated paths consult.

## Solution Statement

Add a single **boundary-constructor adapter** — `adws/core/launchGitContext.ts` exporting `buildLaunchGitContext(targetRepo, deps?)` — that builds exactly one `GitContext` from a parsed `TargetRepoInfo | null` plus the framework's already-known config and auth:

- **Identity**: `targetRepo ? { owner, repo, selfHost: false } : { ...getRepoInfo(), selfHost: true }` — mirroring the existing `buildRepoIdentifier` discriminator (presence of `--target-repo` ⇒ target; absent ⇒ self-host from local git remote).
- **Base-path config injected** (not re-derived): `frameworkRepoRoot = REPO_ROOT`, `targetReposDir = TARGET_REPOS_DIR` from `core/environment.ts`. Resolution itself happens inside the `GitContext` constructor (#658), nowhere else.
- **Token + git identity** resolved by small, injectable helpers so the package's mandatory non-empty `token`/`gitIdentity` fields are always satisfied without breaking `gh`-CLI-only setups: token via App installation token → `GITHUB_PAT` → `gh auth token` → `GH_TOKEN`; identity via App bot identity → `git config user.{name,email}` → default. (Per-command auth *cutover* — replacing the process-global `GH_TOKEN` mutation — is story 7, a later slice; this slice only makes the context *carry* token + identity.)

The adapter lives in `adws/core/` (not in `adws/gitContext/`) so the `gitContext` package stays free of ADW globals — a first-class PRD reuse goal. It is dependency-injectable so the acceptance test can assert base-path resolution without shelling out.

Then migrate the two proof paths:

1. **`adwMerge.tsx`** — construct the context in `main()`, thread it into `executeMerge`, and source the merge worktree base from `gitContext.basePath` (replacing the `process.cwd()` fallback). Target repos still call `ensureTargetRepoWorkspace` for the clone/fetch side effect, but the authoritative base path comes from the context.
2. **`trigger_cron.ts` + `takeoverHandler.ts`** — construct one context at cron startup from `resolveCronRepo(...)`'s `targetRepo`, thread it into `evaluateCandidate`, and resolve the takeover worktree via the context (`worktreePathFor` / `basePath`) instead of the ambient-`cwd` default.

For the remaining standalone SDLC-family orchestrators (`adwSdlc.tsx` et al.), construct the one context inside their shared startup — `initializeWorkflow` — and store it on `WorkflowConfig.gitContext` so phases inherit the correct scoping (story 9), and use it to resolve the self-host worktree base path (replacing `workflowInit.ts:244`'s `process.cwd()`). Migrating *every* phase's individual git/`gh` call onto context methods is explicitly later-slice work (PRD stories 16/17/18); this slice establishes single-construction-at-the-boundary and proves the threading on the merge + takeover paths.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/git-context-repo-authority.md` — the parent PRD. Defines "Boundary constructors (thin adapters)", the launch-boundary-as-source-of-truth rule, and the testing decisions for boundary constructors. The contract this slice implements.
- `adws/gitContext/gitContext.ts` — the `GitContext` class (constructed here): `basePath`, `worktreePathFor(branch)`, `commandEnv(base?)`, `owner`/`repo`/`selfHost` accessors, and the mandatory-identity assertion. The boundary adapter feeds this constructor.
- `adws/gitContext/types.ts` — `GitContextOptions` / `GitIdentity`. Defines exactly which fields the adapter must supply (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`, `frameworkRepoRoot`, `targetReposDir`).
- `adws/gitContext/index.ts` — the package barrel. The adapter imports `GitContext` from here. Must NOT be expanded with ADW-global-dependent code.
- `adws/gitContext/__tests__/gitContext.test.ts` — mirror its no-I/O, identity-in/path-out assertion style for the new boundary-constructor tests.
- `adws/core/orchestratorCli.ts` — `parseTargetRepoArgs` (parses `--target-repo`/`--clone-url`) and `buildRepoIdentifier` (the existing target-vs-self-host discriminator). The new adapter is the GitContext analog of `buildRepoIdentifier` and reuses the same discriminator semantics.
- `adws/core/environment.ts` — exports `REPO_ROOT` (framework root, `import.meta.url`-derived, cwd-independent) and `TARGET_REPOS_DIR`. These are injected into the adapter as `frameworkRepoRoot` / `targetReposDir`.
- `adws/core/targetRepoManager.ts` — `getTargetRepoWorkspacePath(owner, repo)` (the path `GitContext` mirrors for targets) and `ensureTargetRepoWorkspace` (clone/fetch side effect retained in `adwMerge`).
- `adws/core/index.ts` — the core barrel. Register the new `buildLaunchGitContext` export near the existing `orchestratorCli` (line ~149) and `targetRepoManager` (line ~163) exports.
- `adws/github/githubApi.ts` — `getRepoInfo(cwd?)` (self-host fallback identity from the local git remote) and `RepoInfo`.
- `adws/github/githubAppAuth.ts` — `isGitHubAppConfigured`, `getInstallationToken(owner, repo)`, `ensureAppAuthForRepo`, and the App bot identity format (`${slug}[bot]` / `${id}+${slug}[bot]@users.noreply.github.com`) used by `configureGitIdentity`. The token/identity resolvers mirror these.
- `adws/adwMerge.tsx` — **proof path #1**. `main()` (line ~255) constructs the context; `executeMerge` (line ~85) + `MergeDeps` are threaded; the `process.cwd()` fallback (line 273) and `ensureWorktree(..., baseRepoPath)` (line 180) move onto `gitContext.basePath`.
- `adws/__tests__/adwMerge.test.ts` — existing `executeMerge` unit tests (injected `MergeDeps`, `baseRepoPath` arg). Update for the threaded context.
- `adws/triggers/trigger_cron.ts` — **proof path #2**. Constructs one cron context (after auth activation, under the entry-script guard) from `resolveCronRepo(...)`'s `targetRepo`; threads it into `evaluateCandidate`.
- `adws/triggers/takeoverHandler.ts` — **proof path #2**. `EvaluateCandidateInput` gains the context; `recoverViaResetFromRemote` (line ~136) and `recoverViaResumeInPlaceOrReset` (line ~153) resolve the worktree via the context, not the ambient-`cwd` `getWorktreePath` default.
- `adws/triggers/__tests__/takeoverHandler.test.ts` — extend with a fake context (known `basePath`) and assert the takeover worktree is computed under it, not ambient `cwd`.
- `adws/triggers/cronRepoResolver.ts` — `resolveCronRepo` already yields `{ repoInfo, targetRepo }`; `targetRepo` feeds the cron context.
- `adws/triggers/__tests__/cronRepoResolver.test.ts` — mirror its arg-parsing test style.
- `adws/vcs/worktreeOperations.ts` — `getWorktreePath(branch, baseRepoPath?)` (the optional-default "unsafe primitive") and `getWorktreesDir`/`getMainRepoPath`. The migrated paths stop relying on the optional default; this file is otherwise unchanged this slice.
- `adws/phases/workflowInit.ts` — `initializeWorkflow` + `WorkflowConfig`. Add `gitContext` to the config, construct it once here for SDLC-family orchestrators (story 9), and use `gitContext.basePath` for the self-host worktree base (line 244's `process.cwd()`).
- `adws/adwSdlc.tsx` — canonical standalone orchestrator; representative of the `parseTargetRepoArgs → buildRepoIdentifier → initializeWorkflow` boundary pattern shared by ~14 `adws/*.tsx` entry points.

### Conditional docs (matched on this task's files)

- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — the #658 foundation doc. Read for the construction contract, invariants, and the explicit note that **call-site migration off `getWorktreePath(branch, baseRepoPath?)` is a separate slice** (this one).
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — the wrong-repo class history; conditions cover `ensureWorktree`, `workflowInit.ts`, `targetRepoManager.ts`, and "adding git operations that must target an external target repository".
- `app_docs/feature-ie8l08-fix-pr-review-target-repo.md` — the canonical "`ensureWorktree` called without `baseRepoPath` → wrong repository" failure (bug class #23/#33/#52/#56/#62/#119/#217/#223); the exact shape this slice eliminates on the merge + takeover paths.
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — `trigger_cron.ts` auth identity and `activateGitHubAppAuth`/`ensureAppAuthForRepo` in the cron; relevant to where/when the cron context is constructed relative to auth.
- `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` — `adwMerge.tsx` and the `MergeDeps` extension pattern (how to thread a new dependency through `executeMerge`).
- `app_docs/feature-djtyv4-remote-reconcile-module.md` — `takeoverHandler`/`deriveStageFromRemote`/`getWorktreePath` wiring; the takeover decision tree this slice edits.
- `app_docs/feature-6wnymj-shared-orchestrator-lifecycle-wrapper.md` — `runWithRawOrchestratorLifecycle` in `adwMerge`; construction must sit correctly relative to the lifecycle wrapper.
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — **Owns `adws/phases/workflowInit.ts`**; consult before editing `initializeWorkflow` so the branch-name-resolution contract is preserved.

### New Files

- `adws/core/launchGitContext.ts` — the boundary-constructor thin adapter. Exports `buildLaunchGitContext(targetRepo: TargetRepoInfo | null, deps?: LaunchGitContextDeps): GitContext` plus the injectable `LaunchGitContextDeps` interface and the default token/git-identity resolvers (`resolveLaunchToken`, `resolveLaunchGitIdentity`). Imports `GitContext` from `../gitContext`, `REPO_ROOT`/`TARGET_REPOS_DIR` from `./environment`, and auth/identity helpers from `../github`. Kept under the 300-line guideline ceiling.
- `adws/core/__tests__/launchGitContext.test.ts` — unit tests for the adapter (acceptance-criterion test): target args resolve to the target workspace; absent args (self-host) resolve to the framework repo root; identity discriminator and incomplete-identity propagation.

## Implementation Plan

### Phase 1: Foundation

Build the single boundary-constructor adapter and its resolvers, fully unit-tested in isolation (no I/O). This is the centerpiece that every entry point will call. It must:

- Map `TargetRepoInfo | null` → complete `GitContextOptions` (identity + injected `frameworkRepoRoot`/`targetReposDir`), choosing `selfHost` by `--target-repo` presence (mirroring `buildRepoIdentifier`).
- Resolve a non-empty `token` and `gitIdentity` via injectable resolvers with robust fallbacks, so construction never throws in any working ADW auth setup (App, PAT, or bare `gh auth login`) yet still fails loudly when truly unconfigured (story 23).
- Be dependency-injectable (`LaunchGitContextDeps`) so tests assert base-path resolution deterministically.

### Phase 2: Core Implementation (the two proof paths)

Migrate `adwMerge.tsx` and the cron → takeover path onto the constructed context, removing their ambient-`cwd` derivations. These are the acceptance-criteria proof paths (stories 3, 10, 11). Update their existing unit tests to assert the worktree/base path now derives from the context.

### Phase 3: Integration (single-construction at every standalone boundary)

Construct the one context inside `initializeWorkflow` for the SDLC-family standalone orchestrators, expose it on `WorkflowConfig.gitContext` (story 9), and use it for the self-host worktree base path — so "standalone orchestrators construct one context at startup; absent args resolve to the framework repo root" holds for the whole family without rewriting every downstream phase (explicitly deferred to later slices). Run the full validation suite.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Create the boundary-constructor adapter (`adws/core/launchGitContext.ts`)

- Create `adws/core/launchGitContext.ts`.
- Define `interface LaunchGitContextDeps` with injectable seams (all optional, production defaults applied internally):
  - `getRepoInfo: (cwd?: string) => RepoInfo` (default: `getRepoInfo` from `../github`),
  - `resolveToken: (owner: string, repo: string) => string`,
  - `resolveGitIdentity: () => GitIdentity`,
  - `frameworkRepoRoot: string` (default `REPO_ROOT`),
  - `targetReposDir: string` (default `TARGET_REPOS_DIR`).
- Implement `resolveLaunchToken(owner, repo)`: in order — `isGitHubAppConfigured()` ⇒ `getInstallationToken(owner, repo)`; else `GITHUB_PAT`; else `gh auth token` via `execSync` (trimmed); else `process.env.GH_TOKEN`. If still empty, `throw new Error('launchGitContext: could not resolve a GitHub token for <owner>/<repo>')` (loud, story 23).
- Implement `resolveLaunchGitIdentity()`: if App configured, build `{ authorName: '<slug>[bot]', authorEmail: '<id>+<slug>[bot]@users.noreply.github.com', committerName: ..., committerEmail: ... }` (mirror `configureGitIdentity` in `githubAppAuth.ts`); else read `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env; else `git config user.name`/`user.email`; else a non-empty default ADW identity. Never returns an empty field.
- Implement `buildLaunchGitContext(targetRepo, deps?)`:
  - Resolve identity: `const { owner, repo } = targetRepo ?? deps.getRepoInfo();` and `const selfHost = targetRepo === null;`.
  - Ensure process-global auth is correct for the not-yet-migrated `gh` calls on this path: call `ensureAppAuthForRepo(owner, repo)` (idempotent; no-op when App not configured). (Per-command auth cutover remains out of scope.)
  - Build and return `new GitContext({ owner, repo, selfHost, token: deps.resolveToken(owner, repo), gitIdentity: deps.resolveGitIdentity(), frameworkRepoRoot: deps.frameworkRepoRoot, targetReposDir: deps.targetReposDir })`.
- Keep side effects (env reads, `execSync`, auth) behind the injectable seams so the pure path/identity mapping is testable. Adhere to guard-clause / ≤2-nesting guidelines; keep the file < 300 lines.

### Task 2 — Export the adapter from the core barrel

- In `adws/core/index.ts`, export `buildLaunchGitContext` and `type LaunchGitContextDeps` from `./launchGitContext` (place near the `orchestratorCli`/`targetRepoManager` exports).

### Task 3 — Unit-test the adapter (`adws/core/__tests__/launchGitContext.test.ts`)

- Mirror `gitContext.test.ts` style: inject `frameworkRepoRoot`/`targetReposDir` and fake `resolveToken`/`resolveGitIdentity`/`getRepoInfo`; assert no real I/O.
- Cases:
  - target args ⇒ `ctx.basePath === join(targetReposDir, owner, repo)`, `ctx.selfHost === false`, `ctx.owner/ctx.repo` from the target.
  - absent args (self-host) ⇒ `getRepoInfo` consulted, `ctx.basePath === frameworkRepoRoot`, `ctx.selfHost === true`.
  - `worktreePathFor(branch)` for a target resolves under the target workspace `.worktrees`.
  - identity/token plumbed onto the context (`commandEnv().GH_TOKEN`, `GIT_AUTHOR_NAME`).
  - incomplete identity (empty resolved token) propagates the `GitContext` construction error.

### Task 4 — Migrate `adwMerge.tsx` onto the context (proof path #1, story 11)

- In `main()`: after `parseTargetRepoArgs(args)` and arg parsing, `const gitContext = buildLaunchGitContext(targetRepo);`.
- Derive `const repoInfo: RepoInfo = { owner: gitContext.owner, repo: gitContext.repo };` (replaces the `buildRepoIdentifier` round-trip for repo identity; keep `Platform.GitHub` where `buildDefaultDeps(repoId.platform)` needs it).
- Replace `const baseRepoPath = targetRepo ? ensureTargetRepoWorkspace(targetRepo) : process.cwd();` with: for target repos, still call `ensureTargetRepoWorkspace(targetRepo)` (clone/fetch side effect) but use `gitContext.basePath` as the authoritative base; for self-host use `gitContext.basePath` (never `process.cwd()`).
- Thread the context (or its `basePath`) into `executeMerge` so `deps.ensureWorktree(branchName, baseBranch, <base>)` uses `gitContext.basePath`. Two acceptable shapes — pick the lower-churn one consistent with the existing `MergeDeps` test seams:
  - keep the `baseRepoPath: string` parameter on `executeMerge` and pass `gitContext.basePath`; or
  - pass `gitContext` and read `gitContext.basePath` inside.
- Preserve all existing `executeMerge` behavior and `MergeDeps` injection (the HITL gate, `mergeWithConflictResolution`, comment paths, exit codes) — only the base-path source changes.

### Task 5 — Update `adwMerge` unit tests

- In `adws/__tests__/adwMerge.test.ts`, update the `executeMerge(... , '/base/repo', deps)` call sites to the threaded shape, and add/adjust an assertion that `deps.ensureWorktree` is invoked with the context's base path (the open-PR merge case at the worktree step).

### Task 6 — Thread the context into the takeover decision (proof path #2, stories 3, 10)

- In `adws/triggers/takeoverHandler.ts`:
  - Add `readonly gitContext: GitContext` to `EvaluateCandidateInput` (import `GitContext` type from `../gitContext`).
  - In `recoverViaResetFromRemote` and `recoverViaResumeInPlaceOrReset`, compute the worktree path from the context — `const wtPath = input.gitContext.worktreePathFor(state.branchName!);` — instead of `d.getWorktreePath(state.branchName)`. (Equivalently, pass `input.gitContext.basePath` as the explicit `baseRepoPath` to the existing `getWorktreePath` dep; the requirement is that the path derives from the launch identity, never ambient `cwd`.)
  - Keep the `getWorktreePath` dep available for back-compat but ensure the takeover path no longer reaches its ambient-`cwd` default.
- This is the direct fix for the `spawnSync ENOENT` wrong-base-repo incident on the takeover path.

### Task 7 — Construct and thread the cron context (`trigger_cron.ts`)

- Construct exactly one cron context from `resolveCronRepo(...)`'s `targetRepo`. Construct it **after** `activateGitHubAppAuth(cronRepoInfo.owner, cronRepoInfo.repo)` and **under the entry-script guard** (`process.argv[1] … includes('trigger_cron')`) so importing the module in tests neither constructs nor throws. Use a module-scope `let cronGitContext: GitContext | null = null` assigned under the guard (or a lazily-memoized `getCronGitContext()`).
- Pass the context into `evaluateCandidate({ issueNumber: issue.number, repoInfo, gitContext: cronGitContext })` at its single call site (the standard-candidate gate).
- Do not change the spawn args for `adwMerge`/`adwSdlc`/`adwPrReview` — each spawned process builds its own context from the same `--target-repo` args (its own launch identity).

### Task 8 — Update takeover unit tests

- In `adws/triggers/__tests__/takeoverHandler.test.ts`, pass a fake `GitContext` (a stub exposing `worktreePathFor`/`basePath` with a known target base) in `EvaluateCandidateInput`, and assert the abandoned/`phase_timeout` recovery computes the worktree under that base (proving no ambient-`cwd` derivation). Keep all existing decision-tree assertions green.

### Task 9 — Single-construction at the standalone-orchestrator boundary (`workflowInit.ts`, story 9)

- In `adws/phases/workflowInit.ts`:
  - Add `gitContext?: GitContext` to `WorkflowConfig` (optional, to avoid breaking existing phase-test fixtures).
  - Construct the context once inside `initializeWorkflow` from the resolved launch identity (`options.targetRepo ?? null`) via `buildLaunchGitContext`, and include it on the returned config. (This is the shared startup all SDLC-family `adws/*.tsx` orchestrators already invoke, so it satisfies "standalone orchestrators construct one context at startup" without editing ~14 entry points.)
  - Use `gitContext.basePath` for the self-host worktree base — replace `ensureWorktree(branchName, defaultBranch, process.cwd())` at line ~244 with the context's base path. Leave the existing target-repo branch (`targetRepoWorkspacePath`) and the branch-name-resolution contract (owned by `feature-sh8m9r`) byte-for-byte intact otherwise.
- Do not migrate individual downstream phase git/`gh` calls onto context methods in this slice (stories 16/17/18, later slices) — only the construction + self-host base path.

### Task 10 — Type-check, lint, and full unit-test pass

- Run the validation commands below and fix any regressions until all pass with zero failures.

### Task 11 — Run the Validation Commands

- Execute every command in the `Validation Commands` section and confirm zero errors and zero test regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, and the PRD's Testing Decisions explicitly call for boundary-constructor unit tests. Tests assert **external, observable behaviour** (resolved base path, worktree path, env injection) — never internal call structure.

- **`launchGitContext.test.ts` (new, the acceptance-criterion test):**
  - target `--target-repo owner/repo` ⇒ `basePath === join(targetReposDir, owner, repo)`, `selfHost === false`.
  - absent target args ⇒ self-host, `basePath === frameworkRepoRoot`, `getRepoInfo` used for identity.
  - `worktreePathFor(branch)` resolves under the resolved base, independent of `process.cwd()`.
  - token/identity plumbed onto the context; empty resolved token surfaces the `GitContext` construction error (story 23).
  - all I/O behind injected seams (no network, no real `gh`/`git`).
- **`adwMerge.test.ts` (updated):** `executeMerge` invokes `ensureWorktree` with the context's base path; existing state/PR/HITL/merge-outcome assertions remain green.
- **`takeoverHandler.test.ts` (updated):** with an injected fake context (known target base), the abandoned and `phase_timeout` recovery branches compute the worktree under that base, not ambient `cwd`; all existing decision-tree branches stay green.
- **`gitContext.test.ts` (existing):** must remain green (no `gitContext/` source changes this slice).

### Edge Cases

- **Self-host with `--target-repo` pointing at the framework repo** — discriminator is `--target-repo` *presence*, so this is treated as a target context (`basePath` under `targetReposDir`), consistent with `buildRepoIdentifier`. Document this in the adapter's JSDoc.
- **No App configured, bare `gh auth login`** — `resolveLaunchToken` falls through to `gh auth token`; construction must still succeed with a non-empty token (no regression for the common dev/self-host setup).
- **No token resolvable at all** — loud throw, not a silent wrong-repo default.
- **`adwMerge` run standalone (not spawned by cron)** — `buildLaunchGitContext` calls `ensureAppAuthForRepo`, so the process-global `GH_TOKEN` is correct for the resolved repo even without an inherited cron token (incidental hardening; no behavior regression when spawned by cron).
- **Takeover of a `phase_timeout` workflow on a target repo** — the resume cap (#639) and reuse-gate (#638) logic is unchanged; only the worktree base path now comes from the cron's launch identity.
- **Cron module imported by a test** (BDD step defs import `runHungDetectorSweep`) — context construction stays under the entry-script guard, so import does not construct/throw.
- **Missing `branchName` in state during takeover** — existing guard (`if (!state.branchName) return takeOverWithDerivedStage(...)`) is preserved; the context is only consulted when a branch exists.

## Acceptance Criteria

- A `GitContext` is constructed exactly once at each migrated boundary (cron module-scope under the entry guard; `adwMerge.main()`; `initializeWorkflow` for SDLC-family orchestrators) from parsed `--target-repo` args, falling back to the local git remote (`getRepoInfo`) for self-host.
- A context built from `--target-repo owner/repo` resolves `basePath` to the target workspace (`join(TARGET_REPOS_DIR, owner, repo)`); absent target args, self-host resolves `basePath` to the framework repo root (`REPO_ROOT`). (Covered by `launchGitContext.test.ts`.)
- `adwMerge` resolves and merges against the context's repository — the merge worktree base path comes from `gitContext.basePath`, and the `process.cwd()` fallback at `adwMerge.tsx:273` is gone (story 11).
- The cron → takeover path computes an abandoned/timed-out workflow's worktree from the cron's own launch identity via the context — the ambient-`cwd` `getWorktreePath(state.branchName)` defaults at `takeoverHandler.ts:136`/`:153` are gone (stories 3, 10).
- No downstream code on the migrated paths reconstructs the repo base from ambient `cwd`.
- `WorkflowConfig` carries `gitContext`, constructed once at `initializeWorkflow`, so phases can inherit the correct scoping (story 9).
- All existing unit tests pass; `gitContext/` source is unchanged; lint, both type-checks, and build are clean.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Run from the repo root.

- `bun run lint` — ESLint clean (code hygiene: no unused imports/vars).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check passes (catches the threaded-context signature changes across `adwMerge`, `takeoverHandler`, `trigger_cron`, `workflowInit`).
- `bun run test:unit` — full unit suite passes with zero regressions, including the new `adws/core/__tests__/launchGitContext.test.ts` and the updated `adwMerge.test.ts` / `takeoverHandler.test.ts`.
- `bun run build` — build succeeds with no errors.
- Targeted runs while iterating (optional): `bunx vitest run adws/core/__tests__/launchGitContext.test.ts adws/__tests__/adwMerge.test.ts adws/triggers/__tests__/takeoverHandler.test.ts adws/gitContext/__tests__/gitContext.test.ts`.

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): isolate side effects at boundaries (token/identity/auth behind injectable seams so the adapter's core mapping is pure and testable); guard clauses and ≤2 nesting; keep `launchGitContext.ts` < 300 lines; no `any`; prefer type narrowing over `!`; document the public adapter with JSDoc.
- **Package purity** is a first-class PRD reuse goal: the boundary adapter lives in `adws/core/`, NOT in `adws/gitContext/`. The `gitContext` package must keep its zero-ADW-global dependency discipline (`index.ts` exports only `GitContext` + types). Do not add imports of `core`/`github`/`environment` into `adws/gitContext/`.
- **Scope boundaries (explicitly deferred to later PRD slices):**
  - *Per-command auth cutover* (story 7) — removing the process-global `GH_TOKEN` mutation in favor of `commandEnv` injection at every call site. This slice only makes the context *carry* the token/identity; `activateGitHubAppAuth`/`ensureAppAuthForRepo` remain the hot path for not-yet-migrated `gh` calls.
  - *Identity persistence + cross-check* (stories 13/14) — writing `owner/repo` into top-level state and detecting launch-vs-persisted divergence.
  - *CI/lint guard banning raw `git`/`gh`* (story 8) and *full worktree/branch/commit/issue/PR method surface on the context* (stories 16/17/18) — migrating every phase's git/`gh` call onto context methods.
  - *Webhook per-event context* (story 12).
- **`getWorktreePath(branch, baseRepoPath?)` optional default is intentionally left in place** this slice (still used by unmigrated callers, e.g. `workflowInit` reuse branches). Removing the unsafe primitive entirely is the cleanup at the end of the migration once all callers route through the context.
- **Library install command** (`.adw/commands.md`): `bun add <package>`. No new dependencies are required for this feature — it composes existing modules only.
- **Why `initializeWorkflow` (not 14 edited mains) for the SDLC family:** it is the single shared startup every SDLC-family orchestrator already invokes with its launch identity (`targetRepo`/`repoId`), so constructing there satisfies "construct exactly one context at startup" with minimal churn while remaining faithful to the launch-boundary-as-source-of-truth rule. The two explicit proof-path entry points (`adwMerge`, `trigger_cron`) construct in their own `main()`/module scope because they do not go through `initializeWorkflow`.
