# Feature: Migrate gh issue/PR/comment/label/board ops onto GitContext; remove process-global token

## Metadata
issueNumber: `663`
adwId: `d31wqy-migrate-gh-issue-pr`
issueJson: `{"number":663,"title":"Migrate gh issue/PR/comment/label/board ops; remove process-global token","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Operation surface** and **Auth model**)\n\n## What to build\n\nRoute all `gh`/GitHub-API operations through `GitContext` so the target repo is never ambiguous: issue read/comment, PR read/create/merge/review, label and project-board operations (`github/*`, `providers/github/*`). Existing modules become thin adapters over the context. With every call site migrated, **remove the process-global token mutation and the module-global `activeRepo` gate** from the hot path (`github/githubAppAuth.ts` `process.env.GH_TOKEN = ...`, `let activeRepo`), so concurrent contexts are mutually isolated by construction.\n\n## Acceptance criteria\n\n- [ ] issue read/comment, PR read/create/merge/review, label, and project-board ops are `GitContext` methods (story 18)\n- [ ] Each `gh` op authenticates via the context's per-command env, not a process-global token\n- [ ] `activeRepo` module-global and `process.env.GH_TOKEN` hot-path mutation are removed\n- [ ] Existing `github/__tests__/*` behaviour preserved; auth-acquisition (token minting/refresh) is unchanged — only application changes\n- [ ] No \"could not resolve to a repository\" cross-contamination path remains for interleaved multi-repo work (stories 2, 7)\n\n## Blocked by\n\n- Blocked by #659\n\n## User stories addressed\n\n- User story 2\n- User story 7\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-21T10:20:55Z","comments":[],"actionableComment":null}`

## Feature Description

This feature migrates every `gh`/GitHub-API operation in ADW — issue read/comment, PR read/create/merge/review/approve, label lifecycle, and Projects V2 board transitions — to run through the `GitContext` deep module, authenticating **per spawned command** via the context's injected environment instead of relying on a mutated process-global `GH_TOKEN`. The existing `adws/github/*` and `adws/providers/github/*` modules keep their public signatures (so existing tests and call sites are undisturbed) but become **thin adapters** that delegate to a `GitContext` built for the operation's `owner/repo`.

This is slice #663 of the **GitContext repo-context authority** epic (PRD: `specs/prd/git-context-repo-authority.md`). The base-path authority (#658) and the per-command env-injection chokepoint (#659, this issue's stated blocker) have shipped. This slice fills in the `gh` operation surface (story 18) and eliminates the auth-bleed class (stories 2 and 7): the long-lived webhook server today re-points the process-global `GH_TOKEN` mid-flight (gated by a module-global `activeRepo`), so interleaved multi-repo work authenticates `gh` calls against the wrong repository and fails with "could not resolve to a repository." Once each `gh` call carries its own token in its own child-process environment, two repos handled concurrently in one process can no longer clobber each other's auth.

**Value:** operators stop seeing intermittent "could not resolve to a repository" failures on interleaved multi-repo activity; maintainers get a single authority for "which repo and which auth" for `gh` operations; and the most-bled module-global (`activeRepo`) and the mid-flight token re-pointing are removed.

## User Story

As an ADW operator
I want concurrent multi-repo `gh` activity to always authenticate against the correct repository
So that `gh` calls stop intermittently failing with "could not resolve to a repository" when the webhook server interleaves events for different repos (stories 2, 7).

As an ADW maintainer
I want all issue/PR/comment/label/board operations to go through `GitContext`
So that the `gh` target repo and its token are never ambiguous and live in one authority instead of dozens of call sites (story 18).

## Problem Statement

Today every `gh` operation in `adws/github/*` and `adws/providers/github/*` shells out (`execWithRetry`/`execSync` of `gh ...`) and relies on **ambient `process.env.GH_TOKEN`** for auth. That global is set by `github/githubAppAuth.ts` via:

- `activateGitHubAppAuth(owner, repo, cwd?)` — `process.env.GH_TOKEN = token; activeRepo = "owner/repo"; configureGitIdentity()`.
- `ensureAppAuthForRepo(owner, repo)` — gated by the module-global `let activeRepo`; the webhook calls it per event to re-point the global before doing `gh` work.
- `refreshTokenIfNeeded(owner?, repo?)` — falls back to `activeRepo` when called with no args.

Two PAT-swap sites additionally mutate the global mid-operation and restore it in a `finally`:

- `prApi.approvePR` (GitHub forbids a bot approving its own PR → swap to `GITHUB_PAT`).
- `projectBoardApi.moveIssueToStatus` and `providers/github/githubBoardManager.withProjectBoardAuth` (Projects V2 GraphQL needs a classic PAT, not the app token).

Because the webhook server is a single long-lived process that handles events for multiple repos with interleaved async continuations, one event's `process.env.GH_TOKEN = ...` overwrites another's mid-flight, and `gh` resolves against the wrong repo (memory: GH_TOKEN bleed in webhook concurrency, vestmatic #181; cron variant in #143). The `activeRepo` gate is a single shared mutable that cannot represent two repos at once.

`GitContext` already proves the fix shape (`commandEnv()` + the `#run()` chokepoint inject token + git identity per child process and never mutate `process.env`; see `adws/gitContext/__tests__/gitContextOperations.test.ts`), but it currently exposes only one representative `gh` op (`defaultBranch()`) and is **not wired into any orchestrator, trigger, or phase** — it is constructed only in tests. The actual `gh` surface still bleeds.

## Solution Statement

1. **Extend `GitContext` with the full `gh` operation surface as methods.** Each method builds its `gh` command from the context's own `owner/repo` and runs it through the existing single spawn chokepoint, which injects the token (or, for PAT-requiring ops, the PAT) and git identity into **that child command's environment only**. The command-string builders and JSON/response parsers are extracted as pure, separately-tested helper modules so the class file stays within the coding-guideline size budget.

2. **Introduce an ADW-side per-repo `GitContext` factory** (`adws/github/gitContextFactory.ts`) that builds a context for a given `RepoInfo` using the **unchanged** auth-acquisition path (`getInstallationToken`, app-slug-derived identity, `REPO_ROOT`/`TARGET_REPOS_DIR`, `GITHUB_PAT`). The factory lives in `adws/github/` — not inside the reusable `adws/gitContext/` package — so the package stays free of ADW globals (PRD reuse goal). Contexts are cached per `owner/repo`. This is the bridge that lets the existing call sites become thin adapters **without** first threading a context through every phase (the boundary-constructor work is sibling slices #664/#665).

3. **Convert `adws/github/*` and `adws/providers/github/*` into thin adapters.** Public signatures are preserved (so `github/__tests__/*` behaviour is unchanged); internally each function obtains a context via the factory and delegates to the context method. PAT swaps become **per-command PAT injection** (the child env carries the PAT for that one command — no global mutation, no `finally` restore). `refreshTokenIfNeeded` calls in the per-command path are dropped (the factory's token acquisition already refreshes).

4. **Remove the `activeRepo` module-global and the mid-flight global re-pointing.** Delete `let activeRepo`, delete `ensureAppAuthForRepo` (the `activeRepo`-gated webhook re-assert), and make `refreshTokenIfNeeded` repo-explicit. `gh` ops no longer read or mutate `process.env.GH_TOKEN`.

5. **Transitional boundary provisioning (scoped, documented).** The literal `process.env.GH_TOKEN = ...` / `GIT_*` assignment in `activateGitHubAppAuth` is **retained only as one-time launch-boundary provisioning** for the *not-yet-migrated* consumers that still read the ambient env: the `vcs/*` git network ops (push/fetch/commit — sibling slice #662) and the Claude agent subprocess (`getSafeSubprocessEnv()` snapshots `process.env`). It is clearly commented as removable once #661 (worktree) and #662 (branch/commit/push) land and the subprocess env is sourced from the launch-boundary context. The **bleed class is fully closed by this slice** regardless: the `activeRepo` gate is gone, the per-event mid-flight re-pointing is gone, and no `gh` op consults the global — so interleaved multi-repo `gh` work is isolated by construction (stories 2, 7).

### Why the shim, and what is NOT in scope

`activateGitHubAppAuth`'s `process.env.GH_TOKEN`/`GIT_*` assignment is also depended on by code outside this slice's surface: `vcs/commitOperations.ts` / `vcs/branchOperations.ts` git push/fetch (bare `execSync` inheriting `process.env`), and the Claude agent subprocess that runs `/pull_request` and `/commit` (env built by `getSafeSubprocessEnv()` which snapshots `process.env.GH_TOKEN` and the four `GIT_*` vars). Those are migrated by sibling slices #661/#662. Deleting the assignment in this slice — while those siblings are unmerged — would break `git push`, bot-identity commits, and the PR/commit agents (a guaranteed regression that fails validation). The transitional shim keeps them working while this slice removes the part that actually bleeds (`activeRepo` + per-event re-pointing + all `gh`-op reliance on the global). **Discovered cross-slice dependency:** full physical deletion of the assignment should be done by, or coordinated with, #661 + #662 (and the agent-subprocess re-sourcing), even though this issue's body lists only #659 as a blocker. This is called out in Notes.

## Relevant Files

Use these files to implement the feature:

### GitContext package (extend — the operation surface)
- `adws/gitContext/gitContext.ts` — the deep module. Add the `gh` operation methods; extend the `#run()` chokepoint to accept stdin `input` and a per-command `usePat` override; the methods build commands from `this.#owner/#repo` and parse results. Keep within the ~300-line budget by delegating command-building and parsing to the pure modules below.
- `adws/gitContext/types.ts` — add an optional `pat?: string` to `GitContextOptions` (optional → existing construction unchanged) and the result/option types for the new ops (or import them from the command modules).
- `adws/gitContext/index.ts` — export any new public result types needed by adapters.
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — existing per-command-env/isolation test patterns to mirror for the new methods.

### GitContext package (new — pure helpers, keep each <300 lines)
See **New Files** below.

### ADW github adapters (convert to thin adapters over the context)
- `adws/github/githubAppAuth.ts` — remove `let activeRepo`; remove `ensureAppAuthForRepo`; make `refreshTokenIfNeeded` repo-explicit; extract the bot identity derivation (`botName`/`botEmail` from `GITHUB_APP_ID`/`GITHUB_APP_SLUG`) into a reusable pure helper for the factory; narrow `activateGitHubAppAuth` to documented transitional boundary provisioning. **Auth acquisition (`getInstallationToken`, JWT minting, token cache) is unchanged.**
- `adws/github/githubApi.ts` — `getAuthenticatedUser` (`gh api user`) becomes a context op; `getRepoInfo*` helpers (git-remote parsing) are unchanged.
- `adws/github/issueApi.ts` — `fetchGitHubIssue`, `commentOnIssue`, `getIssueState`, `closeIssue`, `getIssueTitleSync`, `fetchIssueCommentsRest`, `issueHasLabel`, `addIssueLabel`, `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`, `deleteIssueComment` → delegate to context methods (keep signatures).
- `adws/github/prApi.ts` — `defaultFindPRByBranch`, `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `mergePR`, `approvePR` (PAT swap → per-command `usePat`), `fetchPRApprovalState`, `fetchPRList` → delegate to context methods. Pure helpers (`selectPreferredPR`, `isApprovedFromReviewsList`, `hasWontFixLabel`) stay pure.
- `adws/github/labelManager.ts` — already uses a `LabelManagerDeps` DI seam; repoint the default `deps.exec` so `ensureAdwLabelsExist`/`applyLabel` route through the context (per-command auth). Injected-deps tests still work.
- `adws/github/projectBoardApi.ts` — `moveIssueToStatus` and its private GraphQL helpers → context board methods with per-command PAT; remove the `process.env.GH_TOKEN` swap and the `refreshTokenIfNeeded` call.
- `adws/github/linkedPrDetector.ts` — `fetchLinkedPRs` (`gh pr list --state all`) → context method.
- `adws/github/hitlBoardNotifier.ts` — `defaultReadIssue`/`defaultListOpenPRs` (the `NotifierDeps` defaults) → route through the context; injected-deps tests unchanged.
- `adws/github/prCommentDetector.ts` — delegates to `prApi` (`fetchPRDetails`/`fetchPRReviewComments`); follows automatically. `getLastAdwCommitTimestamp` is local `git log` (out of `gh` scope; unchanged).
- `adws/github/workflowCommentsIssue.ts` / `workflowCommentsPR.ts` / `workflowCommentsBase.ts` — `postWorkflowComment`→`commentOnIssue`, `postPRWorkflowComment`→`commentOnPR`, `isAdwRunningForIssue`→`fetchGitHubIssue` follow automatically once the adapters are converted. Pure formatters unchanged.
- `adws/github/index.ts` — drop the `ensureAppAuthForRepo` export; keep `isGitHubAppConfigured`, `activateGitHubAppAuth`, `refreshTokenIfNeeded`, `getInstallationToken`.

### ADW providers (thin adapters)
- `adws/providers/github/githubIssueTracker.ts` — already delegates to `issueApi`/`projectBoardApi`; follows automatically.
- `adws/providers/github/githubCodeHost.ts` — PR reads delegate to `prApi`; `createPullRequest` (`gh pr create`/`gh pr list` via `execWithRetry`, currently calls `refreshTokenIfNeeded`) → context `createPR` method; drop the `refreshTokenIfNeeded` call.
- `adws/providers/github/githubBoardManager.ts` — `findBoard`/`createBoard`/`ensureColumns` GraphQL via `withProjectBoardAuth` (PAT swap of `process.env.GH_TOKEN`) → context board methods with per-command PAT; remove `withProjectBoardAuth`'s global swap (every board GraphQL call must still route through one chokepoint — preserve that invariant, see conditional doc `feature-hjcays`).
- `adws/providers/repoContext.ts` — `RepoContext` factory; no interface change required for this slice, but the providers it wires now resolve auth per-command. (Threading a `GitContext` onto `RepoContext` is sibling work #664/#665.)

### Consumers of the removed/narrowed auth (must still work — verify, adjust call sites)
- `adws/triggers/trigger_webhook.ts` — uses `activateGitHubAppAuth` (line ~283) and `ensureAppAuthForRepo` (line ~112). Replace the `ensureAppAuthForRepo` per-event re-assert with reliance on per-command auth (the bleed fix); keep one-time `activateGitHubAppAuth` boundary provisioning for the subprocess/git paths.
- `adws/triggers/trigger_cron.ts` — `activateGitHubAppAuth` (~66), `ensureAppAuthForRepo` (~213), `refreshTokenIfNeeded` (~390). Make refresh repo-explicit; drop the `ensureAppAuthForRepo` re-assert.
- `adws/triggers/pauseQueueScanner.ts` — `activateGitHubAppAuth` (~117). Unchanged behaviourally (boundary provisioning) but verify it no longer relies on `activeRepo`.
- `adws/phases/phaseCommentHelpers.ts` — `refreshTokenIfNeeded()` called with no args (relies on `activeRepo`, lines ~26, ~45). Repoint to per-command auth via the comment's `repoInfo` (these post workflow comments), or make refresh repo-explicit.
- `adws/agents/prAgent.ts` — `refreshTokenIfNeeded()` no-arg (~99). Make repo-explicit or rely on boundary provisioning.
- `adws/phases/workflowInit.ts` (~133/136), `adws/phases/prReviewPhase.ts` (~44), `adws/phases/reviewPhase.ts` (~104) — `activateGitHubAppAuth`/`isGitHubAppConfigured` guards. Keep `isGitHubAppConfigured`; verify they don't depend on `ensureAppAuthForRepo`/`activeRepo`.
- `adws/core/environment.ts` — `getSafeSubprocessEnv()`/`SAFE_ENV_VARS` (GH_TOKEN + four GIT_* vars). Unchanged this slice (transitional shim feeds it); referenced in the Notes for the follow-up removal.
- `adws/core/utils.ts` — `execWithRetry` (no explicit `env`, inherits `process.env`). The non-retryable auth-error patterns (`GH_TOKEN`, `HTTP 401`, `Bad credentials`) must be preserved when the context's `#run` adopts retry semantics (see Edge Cases).

### Reference docs (read before implementing — matched from `.adw/conditional_docs.md`)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — GitContext base, `commandEnv`/`#run` chokepoint, `GitContextDeps` exec seam, two-context isolation, the wrong-repo/`GH_TOKEN`-bleed bug class this epic addresses.
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — `activateGitHubAppAuth`/`ensureAppAuthForRepo`, `GH_TOKEN` pinned to the wrong repo after a resume; the exact bleed this slice structurally removes.
- `app_docs/feature-wrzj5j-harden-project-board-status.md` — `moveIssueToStatus`/`moveToStatus`, GitHub App token refresh before Projects V2 GraphQL.
- `app_docs/feature-9tknkw-project-board-pat-fallback.md` — `moveIssueToStatus`/`findRepoProjectId` PAT fallback for user-owned boards.
- `app_docs/feature-hjcays-fix-board-pat-auth.md` — `GitHubBoardManager` `withProjectBoardAuth` wrapper; the invariant that every board GraphQL call routes through one auth chokepoint.
- `app_docs/feature-fvzdz7-auto-approve-merge-after-review.md` — `approvePR` and the `GH_TOKEN` identity (PAT) swap for bot-PR self-approval.
- `app_docs/feature-2umujr-fix-pr-auth-token-override.md` — `GH_TOKEN` vs `GITHUB_PAT` conflicts in subprocess environments.
- `app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md` — `RepoContext`/`createRepoContext` construction-from-identity (prior art for the factory).
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — `getRepoInfo` and the wrong-repo class for VCS context.

### New Files
- `adws/gitContext/commands/issueCommands.ts` — pure `gh issue …`/`gh api …issues…` command builders + response parsers (`GitHubIssue`, `IssueCommentSummary`, state, title, labels).
- `adws/gitContext/commands/prCommands.ts` — pure PR command builders + parsers (`RawPR`, `PRDetails`, reviews, review comments, approval state, list, create).
- `adws/gitContext/commands/labelCommands.ts` — pure `gh label create`/`gh issue edit --add-label` builders.
- `adws/gitContext/commands/boardCommands.ts` — pure Projects V2 GraphQL query/mutation builders + parsers (project id, issue item, status field options, status match, update).
- `adws/github/gitContextFactory.ts` — ADW-side per-repo `GitContext` factory + cache: `gitContextForRepo(repoInfo, opts?): GitContext`; assembles token (via unchanged `getInstallationToken`, falling back to `gh auth token`/`process.env.GH_TOKEN` when the app is not configured), derived git identity, `selfHost`, `REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`.
- `adws/gitContext/commands/__tests__/issueCommands.test.ts`, `prCommands.test.ts`, `labelCommands.test.ts`, `boardCommands.test.ts` — unit tests for the pure builders/parsers.
- `adws/gitContext/__tests__/gitContextGhOperations.test.ts` — unit tests for the new context methods (per-command env, `usePat`, stdin `input`, parsing, parent-env non-mutation, two-context isolation), mirroring the existing operations test.
- `adws/github/__tests__/gitContextFactory.test.ts` — unit tests for the factory (identity derivation, `selfHost` resolution, token fallback chain, per-repo caching, no `process.env` mutation).
- `features/per-issue/feature-663.feature` — per-issue BDD scenarios tagged `@adw-663` (authored by the scenario phase; see Testing Strategy).

## Implementation Plan

### Phase 1: Foundation — context operation primitives and the per-repo factory
Add the per-command execution primitives `GitContext` needs for the full `gh` surface, and the ADW bridge that constructs a context for any `RepoInfo` using the unchanged auth-acquisition path. Nothing is rewired yet; this phase is purely additive so it cannot regress existing behaviour.

### Phase 2: Core Implementation — the `gh` operation methods (as pure builders + thin methods)
Implement the issue, PR, label, and board command builders/parsers as pure modules, then add the corresponding thin methods on `GitContext` that run them through the chokepoint. Each method is fully unit-tested for command shape, per-command env (token/PAT), stdin input, parsing, and isolation.

### Phase 3: Integration — convert adapters and remove the global
Repoint `adws/github/*` and `adws/providers/github/*` to delegate to the factory-built context (keeping signatures), convert the PAT-swap sites to per-command PAT injection, remove `activeRepo`/`ensureAppAuthForRepo`/mid-flight re-pointing, narrow `activateGitHubAppAuth` to documented transitional boundary provisioning, and fix the affected trigger/phase/agent call sites. Validate end-to-end with zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1 — Read the references and confirm the contract
- Read the PRD `specs/prd/git-context-repo-authority.md` (Operation surface, Auth model) and the conditional docs listed in **Relevant Files → Reference docs**, especially `feature-tcewff` (bleed), `feature-hjcays` (board auth chokepoint), `feature-fvzdz7`/`feature-2umujr` (PAT swap), and `feature-oqb76h` (GitContext base).
- Read `adws/gitContext/gitContext.ts`, `adws/gitContext/types.ts`, and both files in `adws/gitContext/__tests__/` to internalise the existing `#run`/`commandEnv` chokepoint and the test idiom (spy `ExecFn`, parent-env non-mutation, two-context isolation).
- Read `adws/github/githubAppAuth.ts`, `adws/core/environment.ts` (`REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT`, `getSafeSubprocessEnv`, `SAFE_ENV_VARS`), and `adws/core/utils.ts` (`execWithRetry`, non-retryable patterns).

### Task 2 — Extend the GitContext execution chokepoint and options (Phase 1)
- In `adws/gitContext/types.ts`, add an optional `pat?: string` to `GitContextOptions` (optional; existing construction stays valid). Add it to the private field set on the class.
- In `adws/gitContext/gitContext.ts`, extend the private `#run` to accept an options bag: `#run(command, { input?: string; usePat?: boolean } = {})`. When `input` is provided, pass it as child stdin (mirroring `--body-file -` usage). When `usePat` is true and `this.#pat` is set, the child env's `GH_TOKEN` is the PAT for that one command only; otherwise it is the context token. Never mutate `process.env`. Preserve the existing `cwd = this.#basePath` and `commandEnv(process.env)` overlay.
- Add a unit test asserting `usePat` injects the PAT in the child env (and falls back to the token when no PAT), and that `input` is forwarded — extend `gitContextOperations.test.ts` or add to the new ops test.

### Task 3 — Pure command builders + parsers (Phase 2)
- Create `adws/gitContext/commands/issueCommands.ts`, `prCommands.ts`, `labelCommands.ts`, `boardCommands.ts`. Each exports pure functions: a builder that returns the exact `gh …` string for a given `owner/repo` + args (lifted verbatim from the current `issueApi.ts`/`prApi.ts`/`labelManager.ts`/`projectBoardApi.ts`/`githubBoardManager.ts` commands so behaviour is byte-identical), and a parser that turns stdout into the typed result. Re-use the existing result types (`GitHubIssue`, `IssueCommentSummary`, `RawPR`, `PRDetails`, `PRReviewComment`, `PRListItem`, board `StatusOption`/`ProjectItem`/`StatusFieldInfo`); import them rather than duplicating.
- Keep each module under 300 lines and free of side effects (no `exec`, no `process.env`).
- Write `adws/gitContext/commands/__tests__/*.test.ts` for every builder (exact command string, including owner/repo and flags) and parser (well-formed, empty, and malformed stdout), plus the board status fuzzy-matcher.

### Task 4 — Add the `gh` operation methods to GitContext (Phase 2)
- In `adws/gitContext/gitContext.ts`, add thin methods that compose `this.#run(builder(this.#owner, this.#repo, …), opts)` then `parser(stdout)`:
  - Issue: `fetchIssue`, `commentOnIssue` (input), `issueState`, `closeIssue`, `issueTitle`, `fetchIssueComments`, `issueHasLabel`, `addIssueLabel`, `createIssue` (input → number), `updateIssueBody` (input), `findOpenUpgradeIssue`, `deleteIssueComment`, and `authenticatedUser` (`gh api user`).
  - PR: `findPRByBranch`, `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR` (input), `mergePR`, `approvePR` (`usePat: true`), `prApprovalState`, `fetchPRList`, `createPR` (input/body-file).
  - Label: `createLabel`, `applyLabel` (create-if-missing then add).
  - Board: `findRepoProjectId`, `findIssueProjectItem`, `statusFieldOptions`, `updateProjectItemStatus`, `moveIssueToStatus`, and board-manager ops `findBoard`/`createBoard`/`ensureColumns` (all `usePat: true`).
- Keep method bodies to ~1–3 lines each (delegate to the pure helpers); move JSDoc onto the helper modules so `gitContext.ts` stays within the ~300-line budget. If the budget is still exceeded after delegation, hold the board-GraphQL surface in a small collaborator object owned by the context (documented, not a free function) — the public surface remains "operations are context methods."
- Export any new public result types from `adws/gitContext/index.ts`.
- Write `adws/gitContext/__tests__/gitContextGhOperations.test.ts`: for representative methods of each surface, assert the spawned command string, `cwd === basePath`, child `GH_TOKEN === context token` (and `=== PAT` for `usePat` ops), stdin `input` forwarding, correct parsing, `process.env` left byte-identical, and two-context isolation (two repos → two tokens/cwds, no cross-contamination).

### Task 5 — Per-repo GitContext factory (Phase 1→2 bridge)
- Extract a pure `deriveGitIdentity()` helper from `githubAppAuth.configureGitIdentity` (returns `{authorName, authorEmail, committerName, committerEmail}` from `GITHUB_APP_ID`/`GITHUB_APP_SLUG`; export it).
- Create `adws/github/gitContextFactory.ts` exporting `gitContextForRepo(repoInfo, opts?): GitContext` (and a `clearGitContextCache()` for tests). It:
  - resolves the token via the **unchanged** acquisition: app token from `getInstallationToken(owner, repo)` when `isGitHubAppConfigured()`, else `process.env.GH_TOKEN`, else `gh auth token` — so a concrete token is always injected per-command;
  - resolves `gitIdentity` via `deriveGitIdentity()` (app bot) with a fallback to local `git config user.name/user.email` when the app is not configured (gh ops don't depend on identity; this only satisfies the non-empty constructor contract and keeps commit attribution sane);
  - resolves `selfHost` (compare `owner/repo` to the framework repo's own remote, or accept an explicit `opts.selfHost`), `frameworkRepoRoot = REPO_ROOT`, `targetReposDir = TARGET_REPOS_DIR`, `pat = GITHUB_PAT`;
  - caches the constructed context per `owner/repo` (invalidate on token refresh need; the underlying token cache already handles minting).
- Write `adws/github/__tests__/gitContextFactory.test.ts`: identity derivation, token fallback chain, `selfHost` resolution, per-repo caching returns distinct contexts for distinct repos, and no `process.env` mutation.

### Task 6 — Convert `adws/github/*` to thin adapters (Phase 3)
- `issueApi.ts`, `prApi.ts`, `linkedPrDetector.ts`, `githubApi.ts` (`getAuthenticatedUser`): keep every public signature; replace the `execWithRetry('gh …')` body with `gitContextForRepo(repoInfo).<method>(…)`.
- `prApi.approvePR`: drop the `process.env.GH_TOKEN` swap + `finally` restore; call `ctx.approvePR(prNumber)` (which uses `usePat`). Keep the `isGitHubAppConfigured() && GITHUB_PAT` decision for whether PAT identity is needed.
- `labelManager.ts`: repoint `buildDefaultLabelManagerDeps()` so `deps.exec` routes through the context; keep the `LabelManagerDeps` seam intact so injected-deps tests pass.
- `hitlBoardNotifier.ts`: repoint `defaultReadIssue`/`defaultListOpenPRs` through the context; keep `NotifierDeps` intact.
- `projectBoardApi.ts`: replace `moveIssueToStatus` internals with `ctx.moveIssueToStatus(...)` (per-command PAT); remove the `refreshTokenIfNeeded` call and the `process.env.GH_TOKEN` swap.
- Confirm `prCommentDetector.ts`, `workflowCommentsIssue.ts`, `workflowCommentsPR.ts`, `workflowCommentsBase.ts` now work unchanged (they delegate to the converted functions).
- Run `adws/github/__tests__/*` — they must pass unchanged (preserved behaviour). Adjust only test-internal wiring if a test stubbed `execWithRetry` directly (re-point such stubs at the injected exec seam, not at the public contract).

### Task 7 — Convert `adws/providers/github/*` to thin adapters (Phase 3)
- `githubIssueTracker.ts`: verify it follows automatically (delegates to converted `issueApi`/`projectBoardApi`).
- `githubCodeHost.ts`: replace `createPullRequest`'s `execWithRetry('gh pr …')` with `ctx.createPR(...)`/`ctx.findPRByBranch(...)`; remove the `refreshTokenIfNeeded` call.
- `githubBoardManager.ts`: replace `findBoard`/`createBoard`/`ensureColumns` GraphQL with context board methods (per-command PAT); remove the `withProjectBoardAuth` global swap while preserving the invariant that every board GraphQL call routes through one auth chokepoint (now the context's `usePat` path). Keep `mergeStatusOptions` and the column-merge logic intact (`feature-elre2t`/`feature-hjcays`).
- Run `adws/providers/__tests__/boardManager.test.ts` and `repoContext.test.ts` — preserve behaviour.

### Task 8 — Remove `activeRepo` and the mid-flight global re-pointing (Phase 3)
- In `adws/github/githubAppAuth.ts`: delete `let activeRepo` and every read/write of it; delete `ensureAppAuthForRepo`; make `refreshTokenIfNeeded(owner, repo)` require explicit repo args (no `activeRepo` fallback). Keep `getInstallationToken`, the token cache, `isGitHubAppConfigured`, and `createAppJWT`/`resolveInstallationId`/`fetchInstallationToken` **unchanged** (acquisition is out of scope).
- Narrow `activateGitHubAppAuth` to one-time boundary provisioning of `process.env.GH_TOKEN` + `GIT_*` for the transitional consumers (vcs git ops #662, agent subprocess), with a clear comment block stating it is removable once #661/#662 land and `getSafeSubprocessEnv` is sourced from the launch-boundary context. Remove its `cwd` git-remote fallback only if no caller depends on it (verify call sites first).
- Remove the `ensureAppAuthForRepo` export from `adws/github/index.ts`.

### Task 9 — Fix the affected trigger / phase / agent call sites (Phase 3)
- `trigger_webhook.ts`: remove the per-event `ensureAppAuthForRepo` re-assert (the bleed source); keep one-time `activateGitHubAppAuth` boundary provisioning. Verify the per-command auth carries the per-event repo correctly.
- `trigger_cron.ts`: drop the `ensureAppAuthForRepo` re-assert; make the periodic `refreshTokenIfNeeded` repo-explicit (pass the cron's `cronRepoInfo`).
- `phaseCommentHelpers.ts` (no-arg `refreshTokenIfNeeded`), `prAgent.ts` (no-arg `refreshTokenIfNeeded`): make repo-explicit, or rely on boundary provisioning + per-command auth and delete the now-redundant refresh calls.
- `pauseQueueScanner.ts`, `workflowInit.ts`, `prReviewPhase.ts`, `reviewPhase.ts`: verify they compile and behave (keep `isGitHubAppConfigured` guards; no `activeRepo`/`ensureAppAuthForRepo` dependency remains).
- Grep the whole `adws/` tree for `activeRepo`, `ensureAppAuthForRepo`, and no-arg `refreshTokenIfNeeded(` to confirm none remain.

### Task 10 — Type-check, lint, and the full validation pass (zero regressions)
- Run the **Validation Commands** below in order. Fix any failure before proceeding. In particular confirm `adws/github/__tests__/*` and `adws/providers/__tests__/*` pass unchanged, the new unit suites pass, both `tsc` configs are clean, the build succeeds, and the `@regression` BDD suite is green.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (framework: vitest; `bun run test:unit`).

- **GitContext `gh` operation methods** (`adws/gitContext/__tests__/gitContextGhOperations.test.ts`): using the injectable spy `ExecFn` (no real spawns), assert for representative issue/PR/label/board methods: exact spawned command string (with explicit `owner/repo` + flags), `cwd === basePath`, child `GH_TOKEN === context token`, child `GH_TOKEN === pat` for `usePat` ops, stdin `input` forwarding for `--body-file -` ops, correct parsing of stdout into typed results, `process.env` left byte-identical after the op (including on thrown exec), and two-context isolation (two repos in one process never observe each other's token/cwd). Mirrors `gitContextOperations.test.ts`.
- **Pure command builders/parsers** (`adws/gitContext/commands/__tests__/*`): exact command strings for every builder; parsers against well-formed, empty, and malformed stdout; board status fuzzy-matcher cases.
- **Per-repo factory** (`adws/github/__tests__/gitContextFactory.test.ts`): identity derivation from app id/slug; token fallback chain (app → `process.env.GH_TOKEN` → `gh auth token`); `selfHost` resolution; per-repo caching (distinct contexts for distinct `owner/repo`); no `process.env` mutation.
- **Preserved adapter behaviour**: `adws/github/__tests__/*` (`labelManager.test.ts`, `prApi.test.ts`, `linkedPrDetector.test.ts`, `issueLinkMarker.test.ts`, `hitlBoardNotifier.test.ts`) and `adws/providers/__tests__/*` (`boardManager.test.ts`, `repoContext.test.ts`) must pass with no behavioural change; re-point only any test-internal exec stubs to the injected seam.
- **githubAppAuth**: a test confirming `activeRepo`/`ensureAppAuthForRepo` are gone and `refreshTokenIfNeeded` is repo-explicit; acquisition functions untouched.

### Edge Cases
- **App not configured** (no `GITHUB_APP_ID`): factory must still produce a context with a concrete token (`process.env.GH_TOKEN` or `gh auth token`) and a non-empty fallback git identity — gh ops succeed exactly as today.
- **PAT absent** for `usePat` ops (approve, board): fall back to the context token (today's behaviour when `GITHUB_PAT` is unset); board ops degrade gracefully on user-owned repos as before (`feature-9tknkw`).
- **Concurrent two-repo isolation**: two contexts exercised interleaved in one process produce no cross-contamination (the structural bleed fix; assert no shared mutable carries a foreign token).
- **Retry/auth-error semantics**: when the context method adopts retry, the non-retryable auth patterns (`GH_TOKEN`, `HTTP 401`, `Bad credentials`, `gh auth login`) from `execWithRetry` must still fail fast rather than retrying 3×.
- **stdin body ops**: comment/create/update with multi-line/special-character bodies via stdin produce identical payloads to the prior `--body-file -` path.
- **`getLastAdwCommitTimestamp`** (local `git log`, not `gh`): unchanged; confirm it is not accidentally migrated.
- **Self-host vs target base path**: a self-host context (`paysdoc/AI_Dev_Workflow`) and a target context resolve distinct base paths and tokens within one process.

## Acceptance Criteria
- Issue read/comment, PR read/create/merge/review/approve, label, and project-board operations are `GitContext` methods, and `adws/github/*` + `adws/providers/github/*` are thin adapters delegating to them (story 18).
- Every `gh` operation authenticates via the context's per-command child environment (token or, for approve/board, PAT) — no `gh` op reads or mutates `process.env.GH_TOKEN`.
- The `activeRepo` module-global is removed; `ensureAppAuthForRepo` and the per-event mid-flight global re-pointing are removed; `refreshTokenIfNeeded` is repo-explicit. (The residual one-time `process.env.GH_TOKEN`/`GIT_*` boundary provisioning in `activateGitHubAppAuth` is retained transitionally for the not-yet-migrated `vcs/*` git ops and the agent subprocess, clearly commented as removable by #661/#662 — see Notes.)
- Existing `adws/github/__tests__/*` and `adws/providers/__tests__/*` pass unchanged; auth acquisition (token minting/refresh, JWT, installation-id resolution, token cache) is byte-for-byte unchanged — only application changes.
- No interleaved-multi-repo path consults a shared mutable for `gh` auth, so the "could not resolve to a repository" cross-contamination class is closed for `gh` operations (stories 2, 7).
- All Validation Commands pass with zero regressions, including the `@regression` and `@adw-663` BDD suites.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — linter / code-quality.
- `bunx tsc --noEmit` — root type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW workspace type-check (additional type checks).
- `bun run test:unit` — full vitest unit suite (new GitContext op tests, command-builder/parser tests, factory test, and the preserved `github/__tests__/*` + `providers/__tests__/*`).
- `bun run build` — build to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-663"` — per-issue BDD scenarios for this feature.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression BDD suite (zero regressions).

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): keep every file under 300 lines (drives the pure-builders/parsers split out of `gitContext.ts`), prefer pure functions with side effects at the boundary (the `#run` chokepoint is the only spawn site; builders/parsers are pure), immutability (per-command env objects are fresh; never mutate `process.env` or the passed base env), strict typing (no `any`; reuse existing result types), and guard-clause/low-nesting style. No decorators.
- **No new libraries** — uses existing `child_process`/`gh` CLI and current types. Library install command (if ever needed): `bun add <package>`.
- **Reusable-package boundary**: the `adws/gitContext/` package must stay free of ADW globals (PRD reuse goal). All ADW wiring (token acquisition, `REPO_ROOT`/`TARGET_REPOS_DIR`, `GITHUB_PAT`, identity derivation) lives in `adws/github/gitContextFactory.ts`, not in the package. The package gains only generic `gh` methods driven by its injected identity.
- **Auth acquisition is untouched**: `getInstallationToken`, JWT creation, installation-id resolution, and the token cache in `githubAppAuth.ts` are not modified — only how the token is *applied* (per-command env vs process-global) changes, per the PRD Auth model.
- **PAT chokepoint invariant preserved**: Projects V2 GraphQL still routes through a single auth decision (now per-command `usePat`), honouring `feature-hjcays`/`feature-9tknkw`/`feature-wrzj5j`; `approvePR` still uses PAT identity for bot-PR self-approval (`feature-fvzdz7`/`feature-2umujr`).
- **Discovered cross-slice dependency (action required by maintainer):** this issue lists only `#659` as a blocker, but the *literal* deletion of `process.env.GH_TOKEN = ...` from `activateGitHubAppAuth` cannot be done safely until the worktree (#661) and branch/commit/push (#662) git ops are migrated off the ambient env **and** the Claude agent subprocess env (`adws/core/environment.ts` `getSafeSubprocessEnv`/`SAFE_ENV_VARS`) is sourced from the launch-boundary context. This slice therefore (a) fully removes the bleed mechanism (`activeRepo` + mid-flight re-pointing + all `gh`-op global reliance), satisfying stories 2/7/18, and (b) leaves a clearly-commented transitional boundary-provisioning shim for the unmigrated git/subprocess consumers. Recommend tracking the final shim deletion under #661/#662 (or a small follow-up), and consider adding #661 + #662 as explicit blockers if a single fully-global-free end state is required before merge.
- **Sibling slices**: #661 (worktree ops), #662 (branch + commit/push), #664 (webhook boundary constructor), #665 (identity persistence), #666 (CI/lint guard banning raw `git`/`gh` outside the package). The CI guard (#666) will later enforce that the thin adapters never re-introduce a direct `gh` shell-out; this slice should leave the adapters delegating cleanly so #666 can pass.
- **BDD scenarios**: the scenario phase authors `features/per-issue/feature-663.feature` tagged `@adw-663`, asserting observable behaviour — e.g. two interleaved repo contexts each issue `gh` with their own token; a `gh` op never depends on a process-global; preserved adapter outputs. Per the BDD harness observability limits (mock can't see real GitHub-App auth or the Projects-V2 board write), scenarios should drive the in-process resolvers and assert the callee-side per-command env contract / logged signal rather than recorded HTTP requests.
