# Feature: Core and trigger callers migrate to providers; GitContext sheds its forge-semantic surface

## Metadata
issueNumber: `797`
adwId: `qnr31u-migrate-core-trigger`
issueJson: `{"number":797,"title":"Migrate core/triggers callers and shed GitContext semantic surface","body":"## Parent PRD\n\nspecs/prd/gitcontext-forge-agnostic-refactor.md\n\n## What to build\n\nFinal wave: remaining direct callers in core utilities and triggers (cron filters, sweeps, upgrade redrive, comment handling) migrate to providers; then GitContext's forge-semantic methods and any remaining command-builder remnants are deleted from the core package. End state of phase A: a forge-agnostic core whose public API is git, worktree, workspace, executor, and its ports — verified by the full suite and both guard rules.\n\nSee PRD sections: Solution (end state), Implementation Decisions (Caller migration), user stories 1/20/24.\n\n## Acceptance criteria\n\n- [ ] No module anywhere calls a forge-semantic method on GitContext\n- [ ] Semantic methods and command-builder remnants deleted from the core package\n- [ ] Core package has zero GitHub-specific code and zero ADW-application imports\n- [ ] Full unit suite, typecheck, and both guard rules green\n- [ ] Operator-visible behavior unchanged (same comments, same repos, same commands)\n\n## Blocked by\n#791 <!-- adw:region-overlap -->\n#790 <!-- adw:region-overlap -->\n\n- Blocked by #795\n- Blocked by #796\n\n## Touched Files\n\n- adws/gitContext/gitContext.ts\n- adws/triggers/ (trigger_cron, promotionSweep, upgradeRedrive, cronIssueFilter)\n- adws/core/ (remoteReconcile, upgradeFailureCap consumers, workflowComment call sites)\n- adws/github/workflowComments*.ts\n\n## User stories addressed\n\n- User story 1\n- User story 20\n- User story 24","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-08-14T12:19:19Z","comments":[{"author":"paysdoc","createdAt":"2026-08-28T11:34:09Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

This is the last slice of Phase A of `specs/prd/gitcontext-forge-agnostic-refactor.md`. Six slices built the destination: #790 promoted the spawn chokepoint to the public, forge-neutral `GitContext.exec`; #791 replaced the construction-time credential with the `TokenProvider` port; #792 moved the gh command-string builders, App auth and token resolution into the GitHub forge adapter (`adws/providers/github/`); #793 split clone-URL/identity/logging out of the core; #794 made the launch boundary mint providers bound to the same identity as the `GitContext`; #795 made ad-hoc provider/context construction a CI failure; #796 walked the orchestrators and phases over to the boundary's providers.

What is left is the tail: `adws/gitContext/gitContext.ts` still carries 35 forge-semantic methods (`fetchIssue`, `commentOnIssue`, `listOpenIssues`, `createPR`, `approvePR`, `moveIssueToStatus`, `setSecret`, …) plus the private `#runRepoApi` classifier and an upward import of the adapter's command builders; the cron, both sweeps, the upgrade redrive, the pause-queue scanner, a handful of core utilities, the `adws/github/*` API layer, the adapter's own `GitHubCodeHost`, and twelve historical BDD step-definition files still call those methods; and the core still holds the transitional literal-credential path (`GitContextOptions.token`/`pat` → `{ GH_TOKEN }`) that every test-side construction site uses.

This slice finishes the job in three moves, in this order: (1) the GitHub adapter absorbs the vacated surface as executor-backed operations (`createGhRepoApi(ctx)`), so every gh command string in the codebase is issued from the one package the guard exempts for gh; (2) every remaining caller moves — callers that already hold a launch boundary consume its providers, the `adws/github/*` wrapper layer consumes the adapter's operations, and the few trigger helpers that hold only a `repoInfo` consume the wrapper layer like their siblings already do; (3) the core deletes the 35 methods, `#runRepoApi`, the command-builder imports and the literal-credential path, leaving a package whose public API is git, worktree, workspace, `exec()` and its ports, with no GitHub vocabulary and no ADW import. The existing unit suites, the merged per-issue BDD proofs and the three CI guard rules are the regression net; no operator-visible behaviour changes (same commands, same repos, same comments).

One housekeeping fact drives task ordering: `bun run lint:git-guard` is **already red on this branch** — #796 emptied three files of construction (`adws/phases/docsSelfCheck.ts`, `adws/adwUpgrade.tsx`, `adws/phases/upgradeGate.ts`) without removing their transitional entries from `SANCTIONED_CONSTRUCTION_SITES`, so the #795 stale-entry ratchet fails the build. Fixing that is the first task, on its own, so the branch is green before any real work starts.

## User Story

As a framework developer (and the future `@paysdoc/gitcontext` consumer)
I want every remaining forge operation to leave `GitContext` — trigger and core callers consuming boundary-minted providers, the GitHub API layer consuming the adapter's executor-backed operations — and the semantic methods, command-builder remnants and literal-credential path deleted from `adws/gitContext/`
So that the core's public API is exactly git, worktree, workspace, executor and its ports, contains zero GitHub-specific code and zero ADW imports, and can later be extracted as a file move rather than a breaking release.

## Problem Statement

**The core still owns 35 GitHub operations.** `adws/gitContext/gitContext.ts` (788 lines) implements `defaultBranch`, `fetchIssue`, `commentOnIssue`, `issueState`, `closeIssue`, `issueTitle`, `fetchIssueComments`, `issueHasLabel`, `addIssueLabel`, `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`, `deleteIssueComment`, `listOpenIssues`, `issueComments`, `fetchMergedPRs`, `authenticatedUser`, `findPRByBranch`, `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `mergePR`, `approvePR`, `prApprovalState`, `fetchPRList`, `fetchAllPRs`, `fetchPRChangedFiles`, `createPR`, `createLabel`, `applyLabel`, `setSecret`, `runGraphQL`, `runGraphQLInput` and `moveIssueToStatus` (≈lines 333–788), each as `#runRepoApi(builder(owner, repo, …), { input?, purpose? })`. The builders come from `../providers/github/commands/*` under an explicit `TRANSITIONAL` comment (≈lines 75–92) — the one upward dependency the core has on the adapter, and a literal `'gh api user'` / `gh repo view` string sits in the class body (≈lines 335, 566). PRD stories 1 and 20 forbid all of this in the end state.

**Callers are spread across four layers.** Non-test call sites of those methods today:

| Layer | Site | Calls |
|---|---|---|
| Cron & sweeps | `adws/triggers/trigger_cron.ts:97` | `gitContextForRepo(cronRepoInfo).listOpenIssues({…7 fields, limit: 100})` |
| | `adws/triggers/promotionSweepDefaults.ts:126,145,158` | `ctx.listOpenIssues(…state:'all'…)`, `ctx.defaultBranch()`, `ctx.createIssue(…)` |
| | `adws/triggers/perIssueScenarioSweep.ts:80` | `ctx.fetchMergedPRs(200)` |
| | `adws/triggers/perIssueSweepPersist.ts:55,74` | `ctx.defaultBranch()`, `ctx.createPR(…)` |
| Trigger helpers holding only a `repoInfo` | `adws/triggers/concurrencyGuard.ts:24` | `gitContextForRepo(repoInfo).listOpenIssues({fields:['number','comments'], limit:100})` |
| | `adws/triggers/webhookGatekeeper.ts:203` | `gitContextForRepo(repoInfo).listOpenIssues({fields:['number','body'], limit:100})` |
| | `adws/triggers/issueClosedUnblockRouter.ts:53` | `ctx.listOpenIssues({fields:['number','body'], limit:100})` |
| | `adws/triggers/takeoverHandler.ts:89` | `gitContextForRepo(repoInfo).issueComments(issueNumber)` |
| Core utilities | `adws/core/targetRepoManager.ts:73,95` | `ctx.defaultBranch()` (×2, one in a deprecated function with no callers) |
| | `adws/core/upgradeClaim.ts:142` | default thunk `() => ctx.defaultBranch()` |
| | `adws/vcs/branchOperations.ts:130` | `getDefaultBranch(cwd)` — a function with **zero callers** |
| | `adws/healthCheckChecks.ts:195,269` | `ctx.authenticatedUser()`, `ctx.fetchIssue(issueNumber)` |
| GitHub API layer (`adws/github/*`) | `issueApi.ts` (14 sites), `prApi.ts` (9), `projectBoardApi.ts:27`, `labelManager.ts:163,201,214,215`, `githubApi.ts:60`, `hitlBoardNotifier.ts:57,67`, `linkedPrDetector.ts:44` | every issue/PR/label/board/secret op, via `gitContextForRepo(repoInfo).<op>()` |
| The adapter itself | `adws/providers/github/githubCodeHost.ts:56,91,104,137` | `defaultBranch`, `findPRByBranch`, `createPR`, `setSecret` |

Everything the providers (`GitHubIssueTracker`/`GitHubCodeHost`) do today bottoms out in that `adws/github/*` layer, which bottoms out in `GitContext`. Delete the methods and the whole tree stops compiling — so the adapter needs a replacement substrate *before* anything is deleted.

**Five construction sites are #797's by name.** `adws/guard/constructionRule.ts:133-138` lists the transitional entries this issue owns: `adwUpgrade.tsx` (already clean since #796), `upgradeGate.ts` (already clean), `prReviewPhase.ts:113` and `workflowInit.ts:336` (`createRepoContext` from a hand-assembled identity), and `pauseQueueScanner.ts:124,160,214,271` (`createRepoContext` at four best-effort comment sites). The scanner's three `cwd: process.cwd()` sites are also a latent wrong-repo bug: `createRepoContext` → `validateGitRemote(cwd, repoId)` compares the cron host's *own* `origin` against the paused entry's repo, so for any `--target-repo` entry it throws, the `catch` swallows it, and the "worktree gone"/"claim diverged"/"probe failures" error comments are never posted to the target repo.

**The core still speaks GitHub in one more place.** `staticCredentialProvider` (≈gitContext.ts:168–176) returns `{ GH_TOKEN: … }` for the transitional `GitContextOptions.token`/`pat` path (`types.ts` ≈166–197, whose own JSDoc says "Removed alongside `token` in #792/#796" — it was not). AC3 ("zero GitHub-specific code") cannot be met while the env-var name lives in the core. That path has no production caller — `gitContextFactory.ts` and `launchGitContext.ts` both pass a `tokenProvider` — but ≈150 test/step-definition construction sites across ≈30 files still use it (`adws/gitContext/__tests__/gitContextOperations.test.ts` alone has 55; `features/per-issue/step_definitions/gitContextSharedWorld.ts:78-99`'s `makeFullOptions` feeds most of the BDD files).

**The type-checker reaches the historical proofs.** Root `tsconfig.json` includes `**/*.ts`, so `bun run test` (`bunx tsc --noEmit`) compiles `features/per-issue/step_definitions/*.ts`. Twelve merged step-definition files call the doomed methods on real `GitContext` instances (`feature-659`, `-691`, `-692`, `-695`, `-697`, `-699`, `-775`, `-777`, `-790`, `-791`, `-792` and, for `token:`, `-664`/`-700`/others): they must move with the methods or the build breaks.

**The guard is red today.** `bun run lint:git-guard` exits 1 with three stale transitional entries. CI (`.github/workflows/git-cli-guard.yml`, `on: pull_request, push`) fails for this branch before a single line is changed.

## Solution Statement

### 1. The adapter absorbs the vacated surface as executor-backed operations

New, deep-import-only modules in `adws/providers/github/`:

```ts
// adws/providers/github/ghRepoApi.ts
export interface GhRepoApi { /* the 35 operations below, raw stdout in/out */ }
export function createGhRepoApi(ctx: GitContext): GhRepoApi
```

`createGhRepoApi` composes three leaf factories — `ghIssueApi(run, owner, repo)` (`ghIssueApi.ts`: `fetchIssue`, `commentOnIssue`, `issueState`, `closeIssue`, `issueTitle`, `fetchIssueComments`, `issueLabels` (renamed from the misnamed `issueHasLabel(issueNumber, _labelName)`; same command), `addIssueLabel`, `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`, `deleteIssueComment`, `listOpenIssues`, `issueComments`), `ghPrApi(run, owner, repo)` (`ghPrApi.ts`: `findPRByBranch`, `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `mergePR`, `approvePR`, `prApprovalState`, `fetchPRList`, `fetchAllPRs`, `fetchPRChangedFiles`, `createPR`, `fetchMergedPRs`), and the repo/label/secret/board remainder in `ghRepoApi.ts` itself (`defaultBranch`, `authenticatedUser`, `createLabel`, `applyLabel`, `setSecret`, `runGraphQL`, `runGraphQLInput`, `moveIssueToStatus`) — where `run` is `createGhCommandRunner(ctx).run` and `owner`/`repo` are `ctx.owner`/`ctx.repo`.

Each operation is a one-to-one relocation of the deleted core method: the same builder from `commands/*`, the same `input` (stdin) for `commentOnIssue`/`createIssue`/`updateIssueBody`/`commentOnPR`/`createPR`/`setSecret`/`runGraphQLInput`, and the same `purpose: 'alternateIdentity'` for `approvePR`, `runGraphQL`, `runGraphQLInput` and all four `moveIssueToStatus` calls. `ghCommandRunner` already reproduces `#runRepoApi` verbatim (`{kind: 'frameworkRoot'}` + `ctx.commandEnv({}, purpose)`), so the spy-exec assertions from the core's semantic tests relocate near-verbatim: same command string, same `frameworkRepoRoot` cwd, same `GH_TOKEN` in the child env. `fetchPRChangedFiles`, `runGraphQL`, `runGraphQLInput` and `fetchAllPRs` have no production caller outside the core, but merged step definitions (`feature-775`, `-791`, `-792`) drive them — relocate all 35, prune nothing.

`createGhRepoApi` is a bound *view* over a context the caller already holds, exactly like `createGhCommandRunner` — it selects no identity. It is deliberately **not** added to the guard's `PROVIDER_CONSTRUCTORS`/`CONTEXT_CONSTRUCTORS`, and the guard test's near-miss case gains it.

### 2. Two forge-neutral port additions

`adws/providers/types.ts` grows exactly what the migrated callers need and nothing more:

```ts
export type IssueListField = 'number' | 'title' | 'body' | 'state' | 'labels' | 'comments' | 'createdAt' | 'updatedAt';
export interface IssueListQuery { readonly fields: readonly IssueListField[]; readonly limit?: number; readonly search?: string; readonly state?: 'open' | 'closed' | 'all'; }
export interface IssueListEntry { number: number; title?: string; body?: string; state?: string; labels?: readonly { name: string }[]; comments?: readonly { body: string }[]; createdAt?: string; updatedAt?: string; }
export interface MergedPullRequestRecord { body: string; mergedAt: string | null; }

// IssueTracker
/** Issues matching `query` (open unless `state` says otherwise). Throws on failure — callers own the swallow policy. */
listIssues(query: IssueListQuery): readonly IssueListEntry[];
// CodeHost
/** Merged PRs, newest first, at most `limit`. Throws on failure. */
listMergedPullRequests(limit: number): readonly MergedPullRequestRecord[];
```

`fields` is a forge-neutral projection; the GitHub adapter passes it straight through to `listOpenIssuesCmd`, so each caller keeps its exact `--json` list and the emitted command is byte-identical to today's (user story 24). Both methods **throw** — every caller already wraps its call in the try/catch that encodes its own policy (cron: log + `[]`; concurrency guard: log + `[]`; promotion sweep: `[]`; per-issue sweep: `null`; unblock router / abandoned-dependents: the enclosing catch). `GitHubIssueTracker.listIssues` delegates to a new thin wrapper `adws/github/issueListApi.ts` (so the wrapper is shared with the `repoInfo`-parameterised callers in §5); `GitHubCodeHost.listMergedPullRequests` is implemented directly on `createGhRepoApi(gitContextForRepo(this.repoInfo)).fetchMergedPRs(limit)` — there is no existing wrapper to preserve, and `prApi.ts` (374 lines) must not grow. `GitLabCodeHost` and `JiraIssueTracker` get named refusal stubs, as #796 did.

### 3. The boundary binds workspaces; `createRepoContext` leaves the phases

```ts
// adws/core/launchGitContext.ts
/** Binds the boundary's providers to a validated workspace directory. `repoId` (default: the boundary's) must name the boundary's repository. */
export function bindWorkspaceContext(boundary: LaunchBoundary, cwd: string, repoId: RepoIdentifier = boundary.repoId): RepoContext
```

It refuses a mismatched `repoId` (`sameRepoIdentity`) and otherwise calls `createRepoContext({ repoId, cwd, providers: boundary.providers })` — the same validation of cwd and `origin` as today, from the one file the guard sanctions. `workflowInit.ts:336` and `prReviewPhase.ts:113` call it instead of `createRepoContext`; `resolveWorkflowProviders` stays as the exported, tested identity authority in `workflowInit.ts`. `postIssueStageComment`'s first parameter narrows to `Pick<RepoContext, 'issueTracker'>` (structurally satisfied by every existing caller *and* by `BoundProviders`) so the pause-queue scanner can post through a boundary's providers without ever assembling a `RepoContext` for a directory it does not own.

### 4. Callers holding a boundary consume its providers

- **`trigger_cron.ts`** — `fetchOpenIssues()` becomes `cronBoundary.providers.issueTracker.listIssues({ fields: ['number','title','body','comments','createdAt','updatedAt','labels'], limit: 100 })`; `buildTargetRepoArgs()` reads `cronGitContext.remoteUrl()` (a git op on the context it already holds) instead of constructing a second context; `runUpgradeRedriveScan` receives deps built from `cronBoundary.providers.codeHost`; both sweep ticks pass `{ boundary: cronBoundary }`. `checkAndTrigger` gains one guard at its top — no boundary (only possible when the module is imported, where the tick never runs) logs and returns. After this the file constructs nothing: its `gitContextForRepo` import goes, and its transitional guard entry is deleted by the ratchet.
- **`promotionSweep.ts` / `promotionSweepDefaults.ts`** — `PromotionSweepDeps.gitContext` becomes `boundary: LaunchBoundary` (one object, one identity, both halves); `makeDefaultDeps(boundary)` reads git ops from `boundary.gitContext` and forge ops from `boundary.providers`: `listPromotionIssues` → `issueTracker.listIssues({ fields: ['number','body','state','labels'], state: 'all', search: \`label:"${ADW_REGRESSION_PROMOTION_LABEL}"\`, limit: 200 })`; `tagAndCommit` → `codeHost.getDefaultBranch()`; `fileIssue` → `issueTracker.createIssue(title, body)` (returns the number; the local `extractIssueNumber` goes) then `issueTracker.applyLabel(n, label)` (the same `labelManager.applyLabel` it calls today). The CLI entry builds `buildLaunchBoundary(targetRepo)`.
- **`perIssueScenarioSweep.ts` / `perIssueSweepPersist.ts`** — `PerIssueSweepDeps.gitContext` becomes `boundary`; `defaultGetMergedAt` → `codeHost.listMergedPullRequests(200)`; `prepareSweepBase(boundary)` → `codeHost.getDefaultBranch()`, `findOpenSweepPr` → `codeHost.findPullRequestByBranch(branch)` (same OPEN check on `.state`), `openPr` → `codeHost.createPullRequest({ title, body, sourceBranch, targetBranch }).number` (so `SweepBase.openPr` returns the PR number and `extractPrNumber` is no longer needed), `mergePr` → `codeHost.mergePullRequest(n)`. `SweepBase.repoInfo` becomes unused and is removed. `GitHubCodeHost.createPullRequest` first checks for an open PR on the branch — redundant with `findOpenSweepPr`, harmless, and the only extra command this slice introduces (documented in Notes).
- **`upgradeRedrive.ts`** — `buildDefaultUpgradeRedriveDeps(repoInfo, codeHost)`; `findClaimPr` → `codeHost.findPullRequestByBranch(branch)`; `UpgradeRedriveDeps.findClaimPr` narrows to `(issueBody) => { number: number } | null` (the scan only tests for `null`); `runUpgradeRedriveScan`'s `deps` parameter becomes required (its only production caller is the cron, which now builds it).
- **`pauseQueueScanner.ts`** — a private `postEntryStageComment(entry, stage, ctx)` builds `buildLaunchBoundary(parseTargetRepoArgs(entry.extraArgs ?? []))` *inside* the existing best-effort try/catch and posts via `postIssueStageComment(boundary.providers, …)`; all four `createRepoContext` sites collapse onto it. The spawn/lock flow (`resolveEntryRepoInfo`, `acquireIssueSpawnLock`, spawn, readiness) is untouched, so a boundary that cannot be built (no resolvable token) degrades exactly as a failed `createRepoContext` does today: a warning and no comment. The one observable difference is a fix: target-repo entries now receive the three error comments that `validateGitRemote(process.cwd(), …)` silently swallowed.
- **`workflowInit.ts` / `prReviewPhase.ts`** — `bindWorkspaceContext(boundary, worktreePath, repoId)` inside the existing try/catch; the `if (!boundary) throw` guard in `workflowInit.ts:248` hoists above the `ensureTargetRepoWorkspace` call at `:236` (it was already unreachable-in-production there; see #796's proof). `prReviewPhase` with no boundary (test fixtures only) skips the `RepoContext` and logs the same "falling back to direct API calls" line it logs on any construction failure today.
- **`upgradeGate.ts` → `upgradeClaim.ts`** — `buildDefaultUpgradeGateDeps(providers, worktreePath, gitCtx: GitContext)` takes the context instead of a `gitShow` thunk (it derives `gitShow` from `gitCtx.show`) and builds `buildDefaultUpgradeClaimDeps(worktreePath, gitCtx, () => providers.codeHost.getDefaultBranch())`. In `upgradeClaim.ts` the `ctx ?? gitContextForRepo(readLocalRepoInfo(baseRepoPath))` fallback and the `getDefaultBranchFn = () => ctx.defaultBranch()` default both go: `ctx` and `getDefaultBranch` are required, `claimUpgradeOrFindExisting`'s `deps` becomes required. The claim still pushes against `worktreePath`'s `origin` (the target remote) exactly as before — every git op on `ctx` already takes `baseRepoPath` explicitly.
- **`targetRepoManager.ts`** — `ensureTargetRepoWorkspace(targetRepo, getDefaultBranch: () => string)`; callers pass `() => boundary.providers.codeHost.getDefaultBranch()` (`adwMerge.tsx:271`, `adwUpgrade.tsx:524`, `workflowInit.ts:236`, `prReviewPhase.ts:90`). `ensureRepoWorkspace` only invokes the thunk on the already-cloned branch (`repoWorkspace.ts:119-122`), so the boundary's lazy provider mint never runs against a not-yet-cloned workspace. The deprecated, caller-less `fetchLatestRefs`/`pullLatestDefaultBranch` are deleted (code hygiene, guideline "remove unused functions").

### 5. Callers holding only a `repoInfo` consume the `adws/github` wrapper layer

`concurrencyGuard.ts`, `webhookGatekeeper.closeAbandonedDependents`, `issueClosedUnblockRouter.buildDefaultDependencyUnblockDeps` and `takeoverHandler.resolveAdwId` sit at the bottom of `repoInfo`-parameterised call chains (`checkIssueEligibility` → `isConcurrencyLimitReached`; `handleIssueClosedEvent` → `closeAbandonedDependents`/`handleIssueClosedDependencyUnblock`; `evaluateCandidate` → `resolveAdwId`) reached from both the cron and the webhook server, and no provider is in hand there. Threading a boundary through that graph is a signature change to six exported functions and their suites for zero AC movement — the same trade #796 §7 made for `adwChore`/`adwClearComments`/`unitTestPhase`. These four therefore switch to a new thin wrapper module, exactly as their siblings already use `fetchLinkedPRs(repoInfo)`, `closeIssue(…, repoInfo)` and `commentOnIssue(…, repoInfo)`:

```ts
// adws/github/issueListApi.ts  (new — issueApi.ts is 359 lines and must not grow)
/** Issues matching `query`; throws on failure. The one shared implementation behind IssueTracker.listIssues. */
export function listIssues(query: IssueListQuery, repoInfo: RepoInfo): IssueListEntry[]
/** `{ body }[]` of an issue's comments via `gh issue view --json comments` (the stage/adwId readers' exact command); throws on failure. */
export function fetchIssueCommentBodies(issueNumber: number, repoInfo: RepoInfo): { body: string }[]
```

`fetchIssueCommentBodies` keeps `takeoverHandler`'s current `gh issue view … --json comments --jq '.comments'` command rather than switching it to the REST `fetchIssueCommentsRest` (`gh api …/comments --paginate`) — user story 24 says same commands, and the takeover tests pin the shape. After this, `concurrencyGuard.ts`, `webhookGatekeeper.ts` and `issueClosedUnblockRouter.ts` construct no context at all (their guard entries are deleted by the ratchet); `takeoverHandler.ts` keeps `gitContextForSync` for its git ops only. `remoteReconcile.ts` is verified **already clean** — its only forge call is the `defaultFindPRByBranch` wrapper and its `gitContextForRepo(repoInfo).lsRemote()` is a git op — and is left untouched, as are the pure `cronIssueFilter.ts` and `upgradeFailureCap.ts` (the "upgradeFailureCap consumer" is `adwUpgrade.tsx`, migrated in #796).

### 6. The wrapper layer rides the adapter

Every `gitContextForRepo(repoInfo).<op>(…)` in `issueApi.ts`, `prApi.ts`, `projectBoardApi.ts`, `githubApi.ts`, `hitlBoardNotifier.ts` and `linkedPrDetector.ts` becomes `createGhRepoApi(gitContextForRepo(repoInfo)).<op>(…)` (one module-local `const gh = (repoInfo: RepoInfo) => createGhRepoApi(gitContextForRepo(repoInfo))` per file keeps call sites one token wide). `labelManager.ts` keeps its injected `LabelManagerDeps.gitContextForRepo` seam unchanged and wraps inside (`createGhRepoApi(deps.gitContextForRepo(repoInfo)).createLabel(…)`), so `labelManager.test.ts`'s spy-exec injection keeps passing without edits. `GitHubCodeHost.getDefaultBranch`/`createPullRequest`/`setSecret` do the same on their internally constructed contexts. The per-call `gitContextForRepo` construction in this layer is pre-existing, `#796`-owned debt that #794/#796 explicitly accepted as an adapter implementation detail; it is left exactly where it is, visible to the ratchet under its existing entries, and named in Notes as the follow-up (thread the boundary's context into minted providers).

### 7. Delete from the core; retire the literal credential

`gitContext.ts` loses the 35 methods, `#runRepoApi`, the `purpose` option on `#run` (no surviving git op passes one), and the five `../providers/github/commands/*` imports; `commandEnv(base, purpose)` stays public — it is the adapter runner's seam. The file's header comment is rewritten to describe `exec()` + the workspace classifier only (no "gh" anywhere), `types.ts:153` "GitHub owner" becomes "Repository owner (organisation or user)", and `repoWorkspace.ts:101`'s "`gh repo view`" wording becomes "the forge's default-branch read". Then the transitional credential goes: `GitContextOptions.token`/`pat`, `staticCredentialProvider`, and the two `token` branches in `assertCompleteIdentity` (the message becomes `GitContext: tokenProvider must be provided`). Its replacement lives in the adapter, which owns the env-var name:

```ts
// adws/providers/github/githubTokenProvider.ts
/** A TokenProvider that serves a fixed credential — `alternateIdentityPat` (when given) for 'alternateIdentity' requests, `token` otherwise. For tests and fixtures; production boundaries use createGitHubTokenProvider. */
export function createLiteralTokenProvider(token: string, alternateIdentityPat?: string): TokenProvider
```

`makeFullOptions` in `gitContextSharedWorld.ts` keeps its signature and returns `tokenProvider: createLiteralTokenProvider(token)`, which carries most BDD files unchanged; the remaining inline `token: 'x'`/`pat: 'y'` object-literal sites become `tokenProvider: createLiteralTokenProvider('x', 'y')`. The twelve historical step-definition files that call deleted methods on a real context switch to `createGhRepoApi(ctx).<op>(…)` — the scenarios' wording is about which command/cwd/env reached the spawn seam, and that is unchanged.

### 8. The guard closes the ratchet

Run `bun run lint:git-guard` after the migration and delete exactly the stale transitional entries it reports (expected: `docsSelfCheck.ts`, `adwUpgrade.tsx`, `upgradeGate.ts` — deleted in Task 2 — then `pauseQueueScanner.ts`, `targetRepoManager.ts`, `upgradeClaim.ts`, `concurrencyGuard.ts`, `webhookGatekeeper.ts`, `issueClosedUnblockRouter.ts`, `trigger_cron.ts`, `vcs/branchOperations.ts`). `workflowInit.ts` and `prReviewPhase.ts` keep entries (they still call `gitContextForSync`/`gitContextFor` for worktree work) with their `reason` rewritten to say so. Nothing is ever added to the transitional half.

### 9. What this slice deliberately does not do

- It does not thread providers through the `repoInfo`-parameterised trigger graph (§5) nor migrate the other `adws/github/*` wrapper consumers (`adwChore.tsx`, `adwClearComments.tsx`, `unitTestPhase.ts`, `stackCoherenceReporter.ts`, `regionOverlapSignals.ts`, `webhookHandlers.ts`, `issueDependencies.ts`, `remoteReconcile.ts`); none of them holds a `GitContext`, so none moves AC1, and the PRD's "no behaviour change" bar is easier to hold with a smaller diff.
- It does not thread the boundary's `GitContext` *into* the minted providers (`GitHubCodeHost`/`GitHubBoardManager`/`adws/github/*` still construct per call). #794 named that a later slice; it changes which credential/cwd class every provider call uses.
- It does not give `notifyBlockedTransition`'s platform branch in `adwMerge.tsx` a port. #796 deferred it here; it is a Slack notification concern, not a `GitContext` semantic, and deserves its own issue (a notification port or a `BoardManager` extension).
- It does not shrink `gitContext.ts` (≈480 lines after deletion), `trigger_cron.ts` (524), `issueApi.ts` (359) or `prApi.ts` (374) under the 300-line guideline — all pre-existing; this slice only removes lines from them and never adds a function to the last three.

## Relevant Files
Use these files to implement the feature:

### Core package (shrinks)
- `adws/gitContext/gitContext.ts` — the 35 semantic methods (≈333–788), `#runRepoApi` (≈318), `#run`'s `purpose` opt (≈297), the transitional builder imports (≈75–92), `staticCredentialProvider` (≈168–176), `assertCompleteIdentity`'s `token` branches (≈128–149), the header comment.
- `adws/gitContext/types.ts` — `GitContextOptions.token`/`pat` (≈166–197) and the "GitHub owner" JSDoc (`:153`); `CredentialPurpose`/`TokenProvider` stay.
- `adws/gitContext/index.ts` — header prose mentions the semantic methods living here transitionally; exports unchanged.
- `adws/gitContext/repoWorkspace.ts:101` — comment wording only.

### GitHub forge adapter (grows — the destination)
- `adws/providers/github/ghCommandRunner.ts` — the `#runRepoApi` replica every new operation runs through; unchanged.
- `adws/providers/github/commands/{issueCommands,prCommands,labelCommands,secretCommands,boardCommands}.ts` — the builders and board parsers the new operations consume; unchanged.
- `adws/providers/github/githubCodeHost.ts:56,87-104,137` — `defaultBranch`/`findPRByBranch`/`createPR`/`setSecret` move onto `createGhRepoApi`; gains `listMergedPullRequests`.
- `adws/providers/github/githubIssueTracker.ts` — gains `listIssues` (delegating to `issueListApi.listIssues`).
- `adws/providers/github/githubTokenProvider.ts` — gains `createLiteralTokenProvider`.
- `adws/providers/github/index.ts` — **unchanged**; `ghRepoApi`/`ghIssueApi`/`ghPrApi` are deep-import-only (the barrel closes an import cycle through `githubCodeHost.ts`, see `app_docs/feature-e2er82-github-forge-adapter.md`).
- `adws/providers/types.ts` (246 lines; keep JSDoc terse) — `IssueListField`, `IssueListQuery`, `IssueListEntry`, `MergedPullRequestRecord`, `IssueTracker.listIssues`, `CodeHost.listMergedPullRequests`.
- `adws/providers/gitlab/gitlabCodeHost.ts`, `adws/providers/jira/jiraIssueTracker.ts` — refusal stubs.

### Launch boundary
- `adws/core/launchGitContext.ts` (227 lines) — gains `bindWorkspaceContext`; deep-imports `createRepoContext` beside `mintBoundProviders`.
- `adws/core/index.ts:166-167` — re-export `bindWorkspaceContext`.
- `adws/phases/phaseCommentHelpers.ts:34-40` — `postIssueStageComment` parameter narrows to `Pick<RepoContext, 'issueTracker'>`.

### GitHub API layer (`adws/github/*`) — rides the adapter
- `adws/github/issueApi.ts` (14 sites), `adws/github/prApi.ts` (9), `adws/github/projectBoardApi.ts:26-27`, `adws/github/githubApi.ts:60`, `adws/github/hitlBoardNotifier.ts:57,67`, `adws/github/linkedPrDetector.ts:44` — `createGhRepoApi(gitContextForRepo(repoInfo)).<op>`.
- `adws/github/labelManager.ts:159-165,185,199-215` — wrap `deps.gitContextForRepo(repoInfo)` in `createGhRepoApi`; `LabelManagerDeps` unchanged.
- `adws/github/workflowCommentsIssue.ts:410-417`, `adws/github/workflowCommentsPR.ts:83-90`, `adws/github/workflowComments.ts:30-43`, `adws/github/index.ts:118-125`, `adws/index.ts:97,99` — delete the caller-less `postWorkflowComment`/`postPRWorkflowComment` (superseded by `phaseCommentHelpers`) and their re-exports; the formatters stay.

### Triggers
- `adws/triggers/trigger_cron.ts` — `fetchOpenIssues` (`:94-105`), `buildTargetRepoArgs` (`:108-114`), `boundPerIssueSweep`/`boundPromotionSweep` (`:148-157`), the redrive call (`:350-354`), `evaluateCandidate` input (`:407`), the `gitContextForRepo` import (`:42`).
- `adws/triggers/promotionSweep.ts:47-59,236-249,281-284`, `adws/triggers/promotionSweepDefaults.ts:63,123-163`.
- `adws/triggers/perIssueScenarioSweep.ts:50-59,74-89,150-158`, `adws/triggers/perIssueSweepPersist.ts:28-40,49-83,92-124`.
- `adws/triggers/upgradeRedrive.ts:96-102,141-151,158-170`.
- `adws/triggers/pauseQueueScanner.ts:16-18,55-61,124,160,214,271`.
- `adws/triggers/concurrencyGuard.ts:20-30`, `adws/triggers/webhookGatekeeper.ts:198-231` (+ import `:30`), `adws/triggers/issueClosedUnblockRouter.ts:50-58` (+ import `:19`), `adws/triggers/takeoverHandler.ts:86-94` (+ import `:33`).

### Core utilities and phases
- `adws/core/targetRepoManager.ts:67-105` — `ensureTargetRepoWorkspace(targetRepo, getDefaultBranch)`; delete `fetchLatestRefs`/`pullLatestDefaultBranch` (and any re-export of them in `adws/core/index.ts`).
- `adws/core/upgradeClaim.ts:137-189` — required `ctx` + `getDefaultBranch`; no fallback construction.
- `adws/phases/upgradeGate.ts:164-194` — `buildDefaultUpgradeGateDeps(providers, worktreePath, gitCtx)`.
- `adws/phases/workflowInit.ts:236,248-253,277,331-343` — hoisted guard, `ensureTargetRepoWorkspace` thunk, gate deps, `bindWorkspaceContext`.
- `adws/phases/prReviewPhase.ts:88-120` — `ensureTargetRepoWorkspace` thunk, `bindWorkspaceContext`; drop the `createRepoContext`/`Platform` imports.
- `adws/adwMerge.tsx:271`, `adws/adwUpgrade.tsx:524` — `ensureTargetRepoWorkspace` thunk from `boundary.providers`.
- `adws/vcs/branchOperations.ts:125-131` — delete the caller-less `getDefaultBranch(cwd)` and its now-unused imports.
- `adws/healthCheckChecks.ts:195,269` — `createGhRepoApi(ctx).authenticatedUser()` / `.fetchIssue(n)`; signatures unchanged (pinned by `app_docs/feature-9gjajh-health-check.md`).

### Guard
- `adws/guard/constructionRule.ts:26-35,84-138` — delete stale entries; rewrite the `workflowInit.ts`/`prReviewPhase.ts` reasons; update the header paragraph that assigns work to #796/#797.
- `adws/checkGitGhGuard.ts:190-203,244-258` — the "(#796/#797)" labels in the printed block and the stale-entry message.

### Tests (call-shape updates and relocations)
- `adws/gitContext/__tests__/gitContextOperations.test.ts` (63 semantic references), `adws/gitContext/__tests__/repoApiCwd.test.ts` (42) — the semantic describes relocate to the adapter suite; exec-level `frameworkRoot`/workspace-pinning tests stay.
- `adws/gitContext/__tests__/gitContext.test.ts:73,664-684,737-747`, `adws/gitContext/__tests__/workingDirectoryGuard.test.ts` (3 sample calls) — purpose routing restated on `commandEnv`/the adapter; the "transitional literal-token path unchanged" block is retired with the path.
- `adws/providers/github/__tests__/githubCodeHost.test.ts:15-17,91-95`, `adws/providers/github/__tests__/githubIssueTracker.test.ts`, `adws/providers/__tests__/refusalStubs.test.ts`, `adws/providers/github/__tests__/githubTokenProvider.test.ts`.
- `adws/github/__tests__/prApi.test.ts:4-5,100`, `adws/github/__tests__/projectBoardApi.test.ts:4-18` — mock `createGhRepoApi` instead of a fake context; `adws/github/__tests__/labelManager.test.ts` — no change expected.
- `adws/triggers/__tests__/{concurrencyGuard,webhookGatekeeper,issueClosedUnblockRouter,takeoverHandler}.test.ts` — mock `../../github/issueListApi`.
- `adws/triggers/__tests__/{perIssueScenarioSweep,perIssueSweepPersist,promotionSweepDefaults,pauseQueueScanner,upgradeRedrive}.test.ts` (+ `promotionSweep.test.ts` if present) — `boundary` fakes / provider doubles.
- `adws/core/__tests__/{launchGitContext,upgradeClaim,upgradeClaim.integration}.test.ts`, `adws/phases/__tests__/{workflowInit,upgradeGate}.test.ts`, `adws/__tests__/{healthCheckChecks,checkGitGhGuard}.test.ts`.
- `features/per-issue/step_definitions/gitContextSharedWorld.ts:78-99` and the step files listed in Task 15/16.

### BDD scenarios for this slice
- `features/per-issue/feature-797.feature` — authored by the scenario phase; the authority on wording. Implement against it; do not reword it.
- `features/per-issue/step_definitions/feature-797.steps.ts` — **new** (see New Files); reuse `gitContextSharedWorld.ts` and `feature-796.steps.ts`'s forge-semantic-member watcher.

### Merged proofs that must stay green
- `features/per-issue/feature-{790,791,792,793,794,796}.feature` — the executor/token/adapter/boundary/guard/provider contracts underneath this slice.
- `features/per-issue/feature-{659,691,692,695,697,699,775,777}.feature` — the older GitContext proofs whose step definitions change route (Task 15) but whose assertions do not.

### Conditional documentation (from `.adw/conditional_docs.md`)
- `app_docs/feature-e2er82-github-forge-adapter.md` — the deep-import-only rule; the "gitContext.ts still imports the five command-builder modules (TRANSITIONAL)" contract this slice retires.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — `buildLaunchBoundary`, deferred provider minting (why `ensureTargetRepoWorkspace`'s thunk is safe), the `getCronProviders()` handoff seam.
- `app_docs/feature-mk1wgc-orchestrator-phase-provider-migration.md` — `resolveWorkflowProviders`, the `addLabel`/`applyLabel` policy split, what #796 left for #797.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — `#run`/`#runRepoApi`, the `workingDirectoryGuard` ENOENT contract that must survive (`@adw-775` §10), the repo-API-vs-git classification rule.
- `app_docs/feature-9gjajh-providers.md`, `app_docs/feature-9gjajh-github-api.md` — port contracts and the wrapper layer's error policies.
- `app_docs/feature-9gjajh-cron-triggers.md`, `app_docs/feature-vpb048-promotion-sweep-originate.md`, `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — the cron tick, the sweeps' `gitContext`-required deps and their "identity from the launch context, never cwd" invariant.
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — `upgradeRedrive.ts`, `upgradeGate`/`upgradeClaim` deps.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — `takeoverHandler`, `pauseQueueScanner`.
- `app_docs/feature-9gjajh-health-check.md` — `checkGitHubCLI`/`checkIssueNumber` signature pin.
- `app_docs/feature-9gjajh-webhook-triggers.md` — the per-event `GitContext` threading that stays as-is.

### New Files
- `adws/providers/github/ghIssueApi.ts` — the 14 issue operations over a `GhCommandRunner`.
- `adws/providers/github/ghPrApi.ts` — the 13 PR operations.
- `adws/providers/github/ghRepoApi.ts` — repo/label/secret/board operations, the `GhRepoApi` interface and `createGhRepoApi(ctx)`.
- `adws/providers/github/__tests__/ghRepoApi.test.ts` — relocated semantic tests (command/env/input/purpose per operation).
- `adws/providers/github/__tests__/ghRepoApiCwd.test.ts` — relocated `repoApiCwd` tables (every operation at `frameworkRepoRoot`; every command names `owner/repo` except the repo-free ones).
- `adws/github/issueListApi.ts` — `listIssues`, `fetchIssueCommentBodies`.
- `adws/github/__tests__/issueListApi.test.ts`.
- `features/per-issue/step_definitions/feature-797.steps.ts`.

## Implementation Plan

### Phase 1: Foundation
Make the branch green (delete the three stale guard entries), then build the destination additively: the adapter's `createGhRepoApi` with its relocated tests, the two port methods with GitHub implementations and GitLab/Jira refusals, `createLiteralTokenProvider`, `bindWorkspaceContext`, and the `issueListApi` wrapper. The whole suite stays green after every step; nothing is deleted yet.

### Phase 2: Core Implementation
Walk the callers over, innermost first so each step compiles: the `adws/github/*` layer and `GitHubCodeHost` onto `createGhRepoApi`; the four `repoInfo`-only trigger helpers onto `issueListApi`; the cron, sweeps, redrive and pause-queue scanner onto boundary providers; the phases/core utilities (`workflowInit`, `prReviewPhase`, `upgradeGate`/`upgradeClaim`, `targetRepoManager`, health check) onto `bindWorkspaceContext` and provider thunks; delete the dead `postWorkflowComment`/`postPRWorkflowComment` and `vcs.getDefaultBranch`.

### Phase 3: Integration
Delete the semantic surface, `#runRepoApi` and the builder imports from the core; move the twelve historical step-definition files onto `createGhRepoApi`; retire the literal-credential path; close the guard ratchet; prove AC1–AC3 with repository-wide sweeps; write the RED-first `feature-797` step definitions; update the README; run every validation command.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Read the ground truth before editing

- Read `specs/prd/gitcontext-forge-agnostic-refactor.md` — Solution (end state), Implementation Decisions ("Disciplined executor", "Caller migration", "CI guard extension", "Wrong-repo invariants preserved throughout"), Testing Decisions, user stories 1, 20, 24.
- Read `.adw/coding_guidelines.md` and apply it throughout: single responsibility, files under 300 lines for every **new** file, immutability, no `any`, guard clauses over nesting, inline callbacks longer than ~3 lines extracted, unused code removed.
- Read in full: `adws/gitContext/gitContext.ts`, `adws/gitContext/types.ts`, `adws/providers/github/ghCommandRunner.ts`, `adws/providers/github/githubCodeHost.ts`, `adws/providers/github/githubIssueTracker.ts`, `adws/providers/types.ts`, `adws/core/launchGitContext.ts`, `adws/guard/constructionRule.ts`, `adws/triggers/trigger_cron.ts`, `adws/triggers/pauseQueueScanner.ts`, `adws/triggers/promotionSweepDefaults.ts`, `adws/triggers/perIssueSweepPersist.ts`.
- Read the conditional docs listed under **Relevant Files → Conditional documentation**.
- Read `features/per-issue/feature-797.feature` — the RED-first driver and the authority on scenario wording.
- Run `bun run lint:git-guard` and confirm it currently fails with exactly three stale entries; run `bun run test:unit` and confirm the baseline is green (152 files / 2796 tests at planning time).

### 2. Make the guard green before anything else

- In `adws/guard/constructionRule.ts` delete the transitional entries for `adws/phases/docsSelfCheck.ts`, `adws/adwUpgrade.tsx` and `adws/phases/upgradeGate.ts` (all emptied by #796).
- Run `bun run lint:git-guard` → `✔ PASS`. Run `bunx vitest run adws/__tests__/checkGitGhGuard.test.ts` → green (the suite samples `prReviewPhase.ts`, which stays).
- Commit this on its own so CI is green from the first commit of the branch.

### 3. Build `createGhRepoApi` in the adapter

- Create `adws/providers/github/ghIssueApi.ts`: `export function ghIssueApi(run: GhCommandRunner['run'], owner: string, repo: string)` returning the 14 issue operations (Solution §1 list) — each `run(<builder>(owner, repo, …), { input })` where the deleted core method passed `input`. Rename `issueHasLabel(issueNumber, _labelName)` to `issueLabels(issueNumber)` (same `issueHasLabelCmd`).
- Create `adws/providers/github/ghPrApi.ts`: `ghPrApi(run, owner, repo)` returning the 13 PR operations; `approvePR` passes `{ purpose: 'alternateIdentity' }`; `createPR(title, body, headBranch, baseBranch?, labels?)` keeps its exact parameter order and `input: body`; `fetchMergedPRs(limit = 200)`.
- Create `adws/providers/github/ghRepoApi.ts`: `defaultBranch` (`gh repo view ${owner}/${repo} --json defaultBranchRef --jq .defaultBranchRef.name`, byte-identical), `authenticatedUser` (`'gh api user'`), `createLabel`, `applyLabel`, `setSecret` (`input: value`, default purpose — never the PAT), `runGraphQL`/`runGraphQLInput` (`alternateIdentity`), and `moveIssueToStatus` relocated verbatim from the core (`projectQueryCmd` → `parseProjectId` → `itemQueryCmd` → `parseIssueItem` → `fieldQueryCmd` → `parseStatusField` → `moveStatusCmd`, every call `alternateIdentity`, every failure `return false`). Export `interface GhRepoApi` (the union of all three) and `createGhRepoApi(ctx: GitContext): GhRepoApi` = `{ ...ghIssueApi(run, ctx.owner, ctx.repo), ...ghPrApi(…), ...ghRepoOps(…) }` with `run = createGhCommandRunner(ctx).run`. Header comment: this module is the relocation target of `GitContext`'s former semantic surface (#797) and is deep-import-only.
- Do **not** add these to `adws/providers/github/index.ts`.
- Relocate tests: create `adws/providers/github/__tests__/ghRepoApi.test.ts` from the semantic describes in `adws/gitContext/__tests__/gitContextOperations.test.ts` (`defaultBranch`, `listOpenIssues`, `issueComments`, `fetchMergedPRs`, `createPR` head-branch/labels/stdin, `setSecret`, `runGraphQLInput`, `fetchPRChangedFiles`, the per-op "does not mutate process.env" cases, the two-contexts-two-tokens case) and `adws/providers/github/__tests__/ghRepoApiCwd.test.ts` from `adws/gitContext/__tests__/repoApiCwd.test.ts`'s method tables ("every repo-API method spawns at the injected framework repository root", "self-host invariance", "anti-drift guard: every repo-API command still names the target repository explicitly", "still honours the PAT for approvePR"). Drive each through `createGhRepoApi(new GitContext(opts, { exec: spy }))` and keep the assertions on the spy: command string, `cwd === FRAMEWORK_ROOT`, `env.GH_TOKEN`, `input`. Leave the originals in place for now (they are deleted with the methods in Task 14).
- Run `bunx vitest run adws/providers/github` → green.

### 4. Grow the two ports and their three implementations

- `adws/providers/types.ts`: add `IssueListField`, `IssueListQuery`, `IssueListEntry`, `MergedPullRequestRecord` (Solution §2), `IssueTracker.listIssues(query)`, `CodeHost.listMergedPullRequests(limit)`, one JSDoc line each.
- Create `adws/github/issueListApi.ts` with `listIssues(query, repoInfo)` (`JSON.parse(createGhRepoApi(gitContextForRepo(repoInfo)).listOpenIssues(query))`, cast to `IssueListEntry[]`, no swallow) and `fetchIssueCommentBodies(issueNumber, repoInfo)` (`JSON.parse(….issueComments(issueNumber))`, no swallow). Re-export both from `adws/github/index.ts`.
- `GitHubIssueTracker.listIssues(query)` → `listIssues(query, this.repoInfo)`. `GitHubCodeHost.listMergedPullRequests(limit)` → `JSON.parse(createGhRepoApi(gitContextForRepo(this.repoInfo)).fetchMergedPRs(limit)) as MergedPullRequestRecord[]`.
- `GitLabCodeHost.listMergedPullRequests` and `JiraIssueTracker.listIssues`: `throw new Error('<Class>.<method> is not implemented')`, matching the existing stubs.
- Tests: `adws/github/__tests__/issueListApi.test.ts` (command pass-through of `fields`/`search`/`limit`/`state` via a spy-exec `GitContext` injected through a mocked `gitContextForRepo`; throws propagate); add `listIssues`/`listMergedPullRequests` cases to `githubIssueTracker.test.ts`/`githubCodeHost.test.ts`; add both stubs to `adws/providers/__tests__/refusalStubs.test.ts`.
- `bunx tsc --noEmit -p adws/tsconfig.json` → clean; `bunx vitest run adws/providers adws/github` → green.

### 5. Add `createLiteralTokenProvider`

- In `adws/providers/github/githubTokenProvider.ts` add `createLiteralTokenProvider(token, alternateIdentityPat?)` returning `{ credentialEnv: ({ purpose }) => ({ GH_TOKEN: purpose === 'alternateIdentity' && alternateIdentityPat ? alternateIdentityPat : token }) }` — the byte-for-byte behaviour of the core's `staticCredentialProvider`.
- Test in `githubTokenProvider.test.ts`: default purpose → token; `alternateIdentity` with PAT → PAT; `alternateIdentity` without PAT → token.

### 6. Add `bindWorkspaceContext` at the boundary and narrow `postIssueStageComment`

- `adws/core/launchGitContext.ts`: deep-import `createRepoContext` from `../providers/repoContext` and `sameRepoIdentity` from `./repoIdentityCrossCheck`; add `bindWorkspaceContext(boundary, cwd, repoId = boundary.repoId)` per Solution §3 (throw `bindWorkspaceContext: ${repoId.owner}/${repoId.repo} does not match the launch boundary's ${…}` on mismatch). Re-export from `adws/core/index.ts`.
- `adws/phases/phaseCommentHelpers.ts`: `postIssueStageComment(target: Pick<RepoContext, 'issueTracker'>, …)`. No caller changes.
- Tests in `adws/core/__tests__/launchGitContext.test.ts`: passes `boundary.providers` and the given `cwd` to a mocked `createRepoContext`; defaults `repoId` to the boundary's; refuses a mismatched `repoId` without calling `createRepoContext`; accepts a case-variant match.
- Suite green.

### 7. Move the `adws/github/*` layer and `GitHubCodeHost` onto `createGhRepoApi`

- `issueApi.ts`, `prApi.ts`, `projectBoardApi.ts`, `githubApi.ts`, `hitlBoardNotifier.ts`, `linkedPrDetector.ts`: add one module-local `const gh = (repoInfo: RepoInfo) => createGhRepoApi(gitContextForRepo(repoInfo));` and replace each `gitContextForRepo(repoInfo).<op>(` with `gh(repoInfo).<op>(` (`issueHasLabel`/`fetchIssueLabels` call `issueLabels(issueNumber)`; `getAuthenticatedUser` keeps `readLocalRepoInfo(REPO_ROOT)`). Every parse, error policy and log line stays exactly as it is.
- `labelManager.ts`: `createGhRepoApi(deps.gitContextForRepo(repoInfo))` at the four sites; `LabelManagerDeps`/`buildDefaultLabelManagerDeps` unchanged.
- `githubCodeHost.ts`: `getDefaultBranch` → `createGhRepoApi(gitContextForSync({ …, selfHost: false })).defaultBranch()`; `createPullRequest` → `const gh = createGhRepoApi(gitContextForRepo(this.repoInfo))` then `gh.findPRByBranch`/`gh.createPR`; `setSecret` → `createGhRepoApi(gitContextForRepo(this.repoInfo)).setSecret(name, value)`.
- Tests: `prApi.test.ts`, `projectBoardApi.test.ts`, `githubCodeHost.test.ts` mock `createGhRepoApi` (from `../../providers/github/ghRepoApi` / `../ghRepoApi`) to return the same fake method bag they used to hand to a fake context; `labelManager.test.ts` unchanged and must pass as-is (the spy exec sees identical commands).
- Suite green. `grep -rn "gitContextForRepo(repoInfo)\.\|gitContextForRepo(.*)\.\(fetch\|comment\|issue\|create\|update\|find\|delete\|list\|merge\|approve\|pr\|apply\|set\|run\|move\|default\|authenticated\)" adws/github adws/providers` → no matches.

### 8. Move the four `repoInfo`-only trigger helpers onto `issueListApi`

- `concurrencyGuard.ts`: `listIssues({ fields: ['number', 'comments'], limit: 100 }, repoInfo)`; drop the `gitContextForRepo` import.
- `webhookGatekeeper.closeAbandonedDependents`: `listIssues({ fields: ['number', 'body'], limit: 100 }, repoInfo)`; drop the import.
- `issueClosedUnblockRouter.buildDefaultDependencyUnblockDeps(repoInfo, gitContext?)`: `listOpenIssues: () => listIssues({ fields: ['number','body'], limit: 100 }, repoInfo) as OpenIssue[]`; the `gitContext` parameter is still threaded to `spawn` and nothing else; drop the `gitContextForRepo` import and the `ctx` local.
- `takeoverHandler.buildDefaultTakeoverDeps.resolveAdwId`: `extractLatestAdwId(fetchIssueCommentBodies(issueNumber, repoInfo))` inside the existing try/catch → `null`; drop the `gitContextForRepo` import (keep `gitContextForSync`).
- Tests: in each of the four suites replace the `gitContextForRepo` mock with a mock of `../../github/issueListApi` (`listIssues`/`fetchIssueCommentBodies`), keeping every assertion on inputs/outputs (e.g. `takeoverHandler.test.ts:790-822` asserts `fetchIssueCommentBodies` was called with `(99, REPO)` and that a throw / unparseable payload yields `null`).
- Suite green.

### 9. Cron, sweeps and redrive consume boundary providers

- `upgradeRedrive.ts`: `UpgradeRedriveDeps.findClaimPr: (issueBody: string) => { number: number } | null`; `buildDefaultUpgradeRedriveDeps(repoInfo, codeHost: Pick<CodeHost, 'findPullRequestByBranch'>)`; `runUpgradeRedriveScan(issues, repoInfo, targetRepoArgs, deps)` with `deps` required.
- `promotionSweep.ts`: `PromotionSweepDeps.boundary: LaunchBoundary` replaces `gitContext`; `runPromotionSweep` passes `deps.boundary` to `makeDefaultDeps`; the CLI guard uses `buildLaunchBoundary(targetRepo)`. `promotionSweepDefaults.ts`: `makeDefaultDeps(boundary)` — `ctx = boundary.gitContext`, `providers = boundary.providers`; `listPromotionIssues`, `tagAndCommit`, `fileIssue` per Solution §4; delete `extractIssueNumber` and the `applyLabel`/`RepoInfo` imports. Update the module header ("closes over the single launch boundary").
- `perIssueScenarioSweep.ts`: `PerIssueSweepDeps.boundary: LaunchBoundary`; `defaultGetMergedAt(codeHost, issueNum)` → `codeHost.listMergedPullRequests(200)` with the same `bodyLinksIssue`/`mergedAt` filter and `null` on throw; `prepareSweepBase(deps.boundary)`. `perIssueSweepPersist.ts`: `prepareSweepBase(boundary)` per Solution §4; `SweepBase.openPr` returns `number`; remove `SweepBase.repoInfo`, the `mergePR`/`defaultFindPRByBranch`/`extractPrNumber` imports; `persistRemovalViaPr` uses `base.openPr(...)` directly (keep the `if (!prNumber)` guard).
- `trigger_cron.ts`: (a) `checkAndTrigger` starts with `const boundary = cronBoundary; if (!boundary) { log('checkAndTrigger: no launch boundary (module imported, not launched) — skipping tick', 'warn'); return; }` and uses `boundary.gitContext`/`boundary.providers` below; (b) `fetchOpenIssues(issueTracker)` → `issueTracker.listIssues({ fields: ['number','title','body','comments','createdAt','updatedAt','labels'], limit: 100 }) as RawIssue[]` inside the existing try/catch; (c) `buildTargetRepoArgs()` → `() => { try { return cronGitContext?.remoteUrl() ?? null; } catch { return null; } }`; (d) `runUpgradeRedriveScan(issues, repoInfo, targetRepoArgs, buildDefaultUpgradeRedriveDeps(repoInfo, boundary.providers.codeHost))`; (e) `boundPerIssueSweep`/`boundPromotionSweep` close over `cronBoundary` and pass `{ boundary }`; (f) `evaluateCandidate({ …, gitContext: boundary.gitContext })`; (g) delete the `gitContextForRepo` import. Do not add a function to this file (it is already over the line guideline).
- Tests: `upgradeRedrive.test.ts` (deps shape), `promotionSweepDefaults.test.ts` (`makeDefaultDeps({ gitContext: fakeCtx, repoId, providers: { issueTracker, codeHost } })`; assert `listIssues` query, `getDefaultBranch`, `createIssue` + `applyLabel` calls), `perIssueScenarioSweep.test.ts` (`boundary` fakes; the "default getMergedAt routes through the injected context" case becomes "…through `boundary.providers.codeHost.listMergedPullRequests` (never `gitContextForRepo`)"), `perIssueSweepPersist.test.ts` (`openPr` returns a number; `findOpenSweepPr`/`mergePr` via `codeHost` doubles), and the cron tick tests if any construct sweeps with `gitContext`.
- Suite green.

### 10. Pause-queue scanner posts through a per-entry boundary

- `pauseQueueScanner.ts`: add `function resolveEntryBoundary(entry: PausedWorkflow): LaunchBoundary { return buildLaunchBoundary(parseTargetRepoArgs([...(entry.extraArgs ?? [])])); }` and `function postEntryStageComment(entry, stage, ctx): void` that builds the boundary and calls `postIssueStageComment(boundary.providers, entry.issueNumber, stage, ctx)` inside a try/catch that logs at `warn` (the "resumed" site keeps its existing warn text). Replace the four `createRepoContext` blocks with calls to it; remove the `createRepoContext` and `Platform` imports. `resolveEntryRepoInfo` and the lock/spawn flow are untouched. Add a doc comment naming the fix (target-repo entries' error comments were silently dropped by the cwd remote check).
- `pauseQueueScanner.test.ts`: replace the `../../providers/repoContext`/`../../providers/types` mocks with `buildLaunchBoundary: vi.fn(() => fakeBoundary)` in the existing `../../core` mock factory; assert `postIssueStageComment` is called with `fakeBoundary.providers` for each of the four paths and that a throwing `buildLaunchBoundary` is swallowed. Add one test that a `--target-repo acme/webapp` entry builds its boundary with that target (the bug-fix proof).
- Suite green.

### 11. Phases: `bindWorkspaceContext`, hoisted guard, workspace thunks

- `workflowInit.ts`: move the `if (!boundary) throw` guard (`:248-250`) above the target-workspace setup (`:236`); `ensureTargetRepoWorkspace(targetRepo, () => boundary.providers.codeHost.getDefaultBranch())`; `buildDefaultUpgradeGateDeps(boundary.providers, targetRepoWorkspacePath, gitCtx)`; replace the `createRepoContext` call with `bindWorkspaceContext(boundary, worktreePath, resolved.repoId)`; drop the `createRepoContext` import.
- `prReviewPhase.ts`: inside `if (targetRepo)`, require the boundary (`if (!boundary) throw new Error('initializePRReviewWorkflow: launch boundary required for a target repo workspace')`) and pass the thunk; in the `RepoContext` block: `if (!boundary) log('No launch boundary — skipping RepoContext (falling back to direct API calls)', 'info'); else repoContext = bindWorkspaceContext(boundary, worktreePath, repoIdForContext);` inside the existing try/catch; drop the `createRepoContext`/`Platform`/`sameRepoIdentity` imports that become unused.
- `adwMerge.tsx:271` and `adwUpgrade.tsx:524`: pass `() => boundary.providers.codeHost.getDefaultBranch()` / `() => providers.codeHost.getDefaultBranch()`.
- Tests: `workflowInit.test.ts:318-348` — mock `bindWorkspaceContext` (in the same place `buildLaunchBoundary` is mocked) and assert it is called once with `(boundary, worktreePath, boundary.repoId)` on the no-caller-repoId path, and not at all when `resolveWorkflowProviders` throws; `upgradeGate.test.ts` — `buildDefaultUpgradeGateDeps` call shape.
- Suite green.

### 12. Core utilities: claim deps, workspace manager, dead code, health check

- `upgradeClaim.ts`: `defaultPushClaimBranch(branchName, hash, baseRepoPath, ctx, getDefaultBranch: () => string)` (required); `buildDefaultUpgradeClaimDeps(baseRepoPath, ctx, getDefaultBranch)` with no `gitContextForRepo` fallback; `claimUpgradeOrFindExisting(hash, repoInfo, deps)` with `deps` required; drop the `gitContextForRepo`/`readLocalRepoInfo` import. `upgradeGate.ts`: `buildDefaultUpgradeGateDeps(providers, worktreePath, gitCtx)` per Solution §4 (`gitShow` derived from `gitCtx.show`).
- `targetRepoManager.ts`: `ensureTargetRepoWorkspace(targetRepo, getDefaultBranch)`; delete `fetchLatestRefs`, `pullLatestDefaultBranch` and the `gitContextForRepo` import; remove any re-export of the two from `adws/core/index.ts`; update the header comment.
- `vcs/branchOperations.ts`: delete `getDefaultBranch(cwd)` (no callers) and its now-unused imports.
- `workflowCommentsIssue.ts` / `workflowCommentsPR.ts`: delete `postWorkflowComment` / `postPRWorkflowComment` and their `commentOnIssue`/`commentOnPR` imports; remove the re-exports from `workflowComments.ts`, `github/index.ts`, `adws/index.ts`.
- `healthCheckChecks.ts`: `createGhRepoApi(ctx).authenticatedUser()` / `createGhRepoApi(ctx).fetchIssue(issueNumber)`; signatures unchanged. `adws/__tests__/healthCheckChecks.test.ts`: the fake context exposes `exec`/`commandEnv`/`owner`/`repo` (or the test mocks `createGhRepoApi`) so the same `{"login":"alice"}` / issue JSON flows.
- Tests: `upgradeClaim.test.ts` / `upgradeClaim.integration.test.ts` (explicit `getDefaultBranch` thunk — the integration test already passes `() => defaultBranch`), `upgradeGate.test.ts`.
- Suite green; `bunx tsc --noEmit -p adws/tsconfig.json` clean.

### 13. Delete the semantic surface from the core

- `gitContext.ts`: delete the 35 methods, `#runRepoApi`, the `purpose` field on `#run`'s opts, the five `../providers/github/commands/*` imports, `defaultBranch`'s and `authenticatedUser`'s gh strings. Keep `remoteUrl`, `remotes`, `gitConfigUser`, `commandEnv`, `#repoApiCwd`/`#resolveWorkingDirectory` (the `frameworkRoot` class is the adapter's contract). Rewrite the header comment: `exec()` is the forge-neutral executor; `#run` is the workspace classifier; forge adapters (e.g. `adws/providers/github/ghCommandRunner.ts`) build their own framework-root classifier on `exec()` + `commandEnv()`; no "gh" in the prose.
- `types.ts:153`: "Repository owner (organisation or user)". `index.ts` header: drop the sentence about semantic methods. `repoWorkspace.ts:101`: "the forge's default-branch read".
- Tests: delete the relocated semantic describes from `gitContextOperations.test.ts` and `repoApiCwd.test.ts` (keep the git-op and `exec()`-level `frameworkRoot`/workspace-pinning cases; re-express any table that iterated method names over `ctx.exec('cmd', { cwd: { kind: 'frameworkRoot' }, … })`); rewrite `gitContext.test.ts:664-684` purpose-routing cases on `ctx.commandEnv({}, 'alternateIdentity')` and a git op; retarget `workingDirectoryGuard.test.ts`'s sample calls to a git op or `exec()` (the ENOENT rewrap contract must keep `code: 'ENOENT'`).
- `bunx tsc --noEmit -p adws/tsconfig.json` clean; `bun run test:unit` green. (`bunx tsc --noEmit` at the root fails until Task 15 — expected.)

### 14. Retire the transitional literal-credential path

- `gitContext.ts`: delete `staticCredentialProvider`; constructor `this.#credentials = options.tokenProvider`; `assertCompleteIdentity` requires `tokenProvider` (`GitContext: tokenProvider must be provided`) and keeps the validate-and-discard probe. `types.ts`: delete `token`/`pat` and their JSDoc; update `GitContextOptions`' doc ("`tokenProvider` is mandatory").
- Unit tests: `gitContext.test.ts` (`:73` "throws on empty token" → "throws when tokenProvider is absent"; retire the "transitional literal-token path unchanged" block — its purpose-routing assertion already lives in the port tests and the adapter suite), and every `token: 'x'` / `pat: 'y'` inside a `GitContextOptions` literal in `gitContextOperations.test.ts` (55), `gitReadOps.test.ts` (15), `repoApiCwd.test.ts` (4), `worktreeLogger.test.ts`, `workingDirectoryGuard.test.ts`, `webhookRepoResolver.test.ts` (13), `takeoverHandler.test.ts`, `autoMergeHandler.test.ts`, `worktreeSetup.test.ts`, `labelManager.test.ts`, `pushBranch.integration.test.ts`, `upgradeClaim.integration.test.ts` → `tokenProvider: createLiteralTokenProvider('x', 'y')`. Review each hit by hand — `token:` also appears in unrelated fixtures (`appAuth.test.ts` API responses) that must not change.
- `grep -rn "token:\|pat:" adws --include='*.test.ts' | grep -v "tokenProvider\|apiToken\|installation\|appAuth"` → only non-`GitContextOptions` hits remain.
- `bun run test:unit` green.

### 15. Move the historical step definitions with the methods

- `features/per-issue/step_definitions/gitContextSharedWorld.ts:78-99`: `makeFullOptions` returns `tokenProvider: createLiteralTokenProvider(token)` (import from `'../../../adws/providers/github/githubTokenProvider.ts'`); signature unchanged.
- In `feature-659`, `-691`, `-692`, `-695`, `-697`, `-699`, `-775`, `-777`, `-790`, `-791`, `-792` `.steps.ts`: import `createGhRepoApi` from `'../../../adws/providers/github/ghRepoApi.ts'` and replace each `ctx.<deletedOp>(` / `W.ctx.<deletedOp>(` with `createGhRepoApi(ctx).<op>(` (`issueHasLabel(28, 'adw:bug')` → `issueLabels(28)`). Every assertion stays on the spy's recorded command/cwd/env/input.
- Replace the remaining inline `token:`/`pat:` option fields in step files (`feature-628`, `-659`, `-664`, `-700`, `-775`, `-777`, `-779`, `-790`, `-791`, `-792`, `-793` and the single-hit files) with `tokenProvider: createLiteralTokenProvider(...)`; a `TokenProvider` a step already builds by hand stays as it is.
- `bunx tsc --noEmit` (root) clean. Run the merged proofs: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-659 or @adw-691 or @adw-692 or @adw-695 or @adw-697 or @adw-699 or @adw-775 or @adw-777 or @adw-790 or @adw-791 or @adw-792 or @adw-793 or @adw-794 or @adw-796"` → green.

### 16. Close the guard ratchet and update its prose

- Run `bun run lint:git-guard`; delete exactly the transitional entries it reports stale (expected: `pauseQueueScanner.ts`, `targetRepoManager.ts`, `upgradeClaim.ts`, `concurrencyGuard.ts`, `webhookGatekeeper.ts`, `issueClosedUnblockRouter.ts`, `trigger_cron.ts`, `vcs/branchOperations.ts`). Rewrite the `workflowInit.ts`/`prReviewPhase.ts` entries: `reason: 'non-boundary gitContextForSync/gitContextFor call site for worktree work (createRepoContext removed in #797)'`, `owner: '#796'`. Never add an entry.
- `constructionRule.ts:26-35` header and `checkGitGhGuard.ts:190-203,244-258`: the "#796/#797 own …" paragraphs become "transitional entries are the residual per-call `gitContextFor*` constructions inside the GitHub API layer and worktree-owning phases; #797 closed every provider/RepoContext construction site". Keep the printed block free of the substring "allowlisted".
- `adws/__tests__/checkGitGhGuard.test.ts`: add `createGhRepoApi(ctx)` to the "explicit names, never a create* pattern" near-miss case; keep the `prReviewPhase.ts` sample.
- `bun run lint:git-guard` → `✔ PASS`; guard suite green.

### 17. Prove AC1–AC3 with repository-wide sweeps

- AC1 — no forge-semantic member on any `GitContext`: `grep -rnE "\b(ctx|gitCtx|gitContext|context|healthCtx|effectiveCtx)\.(defaultBranch|fetchIssue|commentOnIssue|issueState|closeIssue|issueTitle|fetchIssueComments|issueHasLabel|issueLabels|addIssueLabel|createIssue|updateIssueBody|findOpenUpgradeIssue|deleteIssueComment|listOpenIssues|issueComments|fetchMergedPRs|authenticatedUser|findPRByBranch|fetchPRDetails|fetchPRReviews|fetchPRReviewComments|commentOnPR|mergePR|approvePR|prApprovalState|fetchPRList|fetchAllPRs|fetchPRChangedFiles|createPR|createLabel|applyLabel|setSecret|runGraphQL|runGraphQLInput|moveIssueToStatus)\(" adws features --include='*.ts' --include='*.tsx'` → zero matches (TypeScript already guarantees it for real contexts; the grep catches fakes in tests).
- AC2 — `grep -nE "runRepoApi|providers/github|Cmd\(" adws/gitContext/gitContext.ts` → zero.
- AC3 — `grep -rnE "^import .* from '\.\./" adws/gitContext --include='*.ts' | grep -v __tests__` → zero; `grep -rniE "GH_TOKEN|github|\bgh\b|--repo" adws/gitContext --include='*.ts' | grep -v __tests__ | grep -vE ":\s*(//|\*|/\*)"` → zero (comment lines excluded; the code must be silent).
- Ad-hoc construction: `grep -rn "createRepoContext(" adws --include='*.ts' --include='*.tsx' | grep -v __tests__` → only `adws/providers/repoContext.ts` and `adws/core/launchGitContext.ts`.

### 18. Write the RED-first BDD step definitions

- Create `features/per-issue/step_definitions/feature-797.steps.ts` for every step phrase in `features/per-issue/feature-797.feature`, reusing `gitContextSharedWorld.ts` (`makeSpyExec`, `makeFullOptions`, `makeNoOpFsDeps`, `FRAMEWORK_ROOT`) and, for "the context was asked for no forge-semantic operation" style steps, the Proxy watcher pattern from `feature-796.steps.ts:224-260`. Likely proofs: the adapter operation records the same command at `FRAMEWORK_ROOT` with the same `GH_TOKEN` the deleted method recorded; a watched context handed to `fetchOpenIssues`/`makeDefaultDeps`/`prepareSweepBase` sees only git members; a `--target-repo` paused entry's error comment reaches the target's tracker; the guard passes with no `#797` transitional entry; the core's import/vocabulary sweeps are empty.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-797"` → green; if a scenario cannot be satisfied without a wording change, leave it failing and say so in the PR — do not reword the feature file.

### 19. Update the README

- `README.md:17` — the core "owns every git interaction and the forge-neutral executor; gh commands are issued only by the GitHub forge adapter through `createGhRepoApi`/`ghCommandRunner`"; `:21` — providers now also cover `listIssues`/`listMergedPullRequests`; `:654`/`:657` — drop the TRANSITIONAL clause for `gitContext.ts`/`index.ts`; `:788-810` — add `ghRepoApi.ts`, `ghIssueApi.ts`, `ghPrApi.ts` lines; `:875-887` — the sweeps take a `LaunchBoundary`; `adws/core/launchGitContext.ts` line — mention `bindWorkspaceContext`; `adws/github/` — add `issueListApi.ts`; `adws/triggers/pauseQueueScanner.ts` — per-entry boundary. Leave `app_docs/` to the document phase, but note in the PR body which docs are stale (`feature-e2er82`, `feature-oqb76h`, `feature-vpb048`, `feature-9gjajh-issue-routing-and-eligibility`, `feature-9gjajh-cron-triggers`, `feature-k2tkdn`, `feature-t6m62c`).

### 20. Run the Validation Commands

- Run every command under **Validation Commands**; all must pass with zero regressions.

## Testing Strategy

### Unit Tests

- **Adapter (relocated, `ghRepoApi.test.ts` / `ghRepoApiCwd.test.ts`)** — for each of the 35 operations: the exact command string (including `--repo owner/repo` where the core did), `cwd === frameworkRepoRoot` for target *and* self-host contexts (never `basePath`), `env.GH_TOKEN` from the injected provider, `input` on stdin for the seven stdin operations, `purpose: 'alternateIdentity'` reaching the provider for `approvePR`/`runGraphQL`/`runGraphQLInput`/`moveIssueToStatus`, `setSecret` never using the PAT, `process.env` never mutated, two contexts in one process each carrying their own token; `moveIssueToStatus`'s four early-`false` paths and the `already_at_status` short-circuit.
- **Ports** — `GitHubIssueTracker.listIssues` passes `fields`/`search`/`limit`/`state` through unchanged and rethrows; `GitHubCodeHost.listMergedPullRequests` emits `fetchMergedPRsCmd(owner, repo, limit)` and rethrows; GitLab/Jira stubs throw by name; `createLiteralTokenProvider` purpose routing.
- **Boundary** — `bindWorkspaceContext` (Task 6 cases); `postIssueStageComment` accepts a bare `BoundProviders`.
- **Wrapper layer** — `issueListApi` pass-through and throw; existing `prApi`/`projectBoardApi`/`labelManager` suites green with call-shape-only edits (labelManager: none).
- **Triggers** — concurrency guard / gatekeeper / unblock router / takeover on mocked `issueListApi` with unchanged input/output assertions; cron `fetchOpenIssues` field list and `[]`-on-throw; `buildTargetRepoArgs` reads `remoteUrl` from the launch context and yields `null` on throw; redrive deps built from a `codeHost` double; promotion defaults (`listIssues` query, `getDefaultBranch`, `createIssue` then `applyLabel` per label, branch-guard no-op); per-issue sweep (`listMergedPullRequests(200)`, `null` on throw, stale/exempt decisions unchanged); persist (`openPr` returns the number, duplicate-PR skip, merge failure left open); pause-queue scanner (four comment paths post through `fakeBoundary.providers`; throwing boundary swallowed; target-repo entry builds a target boundary).
- **Phases/core** — `workflowInit` calls `bindWorkspaceContext` once with the boundary's identity and not at all on refusal; `upgradeGate` deps shape; `upgradeClaim` with explicit `getDefaultBranch`; health-check probes through the adapter.
- **Core (remaining)** — `exec()` classes, ENOENT rewrap with `code: 'ENOENT'`, per-command provider resolution, identity precedence, construction validation now requiring `tokenProvider`; every git op still pinned to `basePath`/explicit worktree.
- **Guard** — `createGhRepoApi` is a near-miss; stale-entry detection unchanged; no `#797`-owned transitional entry remains.

### Edge Cases

- `trigger_cron.ts` imported as a module (BDD): no boundary → `checkAndTrigger` returns early; `fetchOpenIssues` is never reached; sweep ticks still take the `sweep === null` skip.
- `listIssues`/`listMergedPullRequests` throwing: cron → `Failed to fetch issues` + `[]`; concurrency guard → `[]` (limit not reached); unblock router / abandoned dependents → enclosing catch logs; promotion → `[]`; per-issue sweep → `null` → not stale.
- Pause-queue entry for a `--target-repo`: boundary built for the target; error comments now reach the target (previously swallowed). Self-host entry: `buildLaunchBoundary(null)` → local remote, as `resolveEntryRepoInfo` does. Unresolvable token: warn + no comment, spawn flow unchanged.
- `ensureTargetRepoWorkspace` on a first clone: the `getDefaultBranch` thunk is not invoked (clone branch), so the boundary's lazy provider mint never reads `.adw/providers.md` from a directory that does not exist yet; on the fetch branch it runs after the clone.
- `bindWorkspaceContext` with a case-variant `repoId`: accepted (`sameRepoIdentity`); with a different repository: throws → `workflowInit`/`prReviewPhase` catch and log the existing fallback line; `prReviewPhase` without a boundary (tests only): no `RepoContext`, same log.
- Sweep PR creation when a sweep PR is already open: `findOpenSweepPr` skips before `createPullRequest`'s own reuse check ever runs.
- `moveIssueToStatus` with no project / no item / no matching option / already at status — unchanged `false`/`true` outcomes, now in the adapter.
- `createLiteralTokenProvider(token)` without a PAT: `alternateIdentity` degrades to the primary token, exactly as `staticCredentialProvider` did.
- Guard ratchet after all edits: only the listed files go stale; `workflowInit.ts`/`prReviewPhase.ts`/`takeoverHandler.ts`/the `adws/github/*` files still construct and keep their entries.

## Acceptance Criteria

- No module anywhere — production, tests, or step definitions — calls a forge-semantic method on a `GitContext` (Task 17 AC1 sweep is empty; `bunx tsc --noEmit` at the root is clean).
- `adws/gitContext/gitContext.ts` contains none of the 35 methods, no `#runRepoApi`, no `commands/*` import and no gh command string; `GitContextOptions` has no `token`/`pat`; `staticCredentialProvider` is gone.
- `adws/gitContext/**` (excluding `__tests__`) has zero imports that leave the package and zero code-level occurrences of `GH_TOKEN`, `github`, `gh` or `--repo` (Task 17 AC3 sweeps are empty).
- Every gh command string in the repository is issued from `adws/providers/github/**` (`createGhRepoApi`, `ghCommandRunner`, `githubBoardManager`, `ghAuthToken`, `appAuth`).
- `IssueTracker.listIssues` and `CodeHost.listMergedPullRequests` exist with GitHub implementations and GitLab/Jira refusal stubs; every migrated caller keeps its exact `--json` field list.
- `createRepoContext` is called only from `adws/providers/repoContext.ts` and `adws/core/launchGitContext.ts`; the five #797 transitional entries and every other entry the ratchet reports stale are deleted; no transitional entry was added.
- `bun run lint:git-guard` passes (all three rules, zero stale entries); `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `@adw-797`, `@regression` and the merged per-issue proofs listed in Task 15 all pass.
- Operator-visible behaviour is unchanged: identical gh commands per operation, same repositories, same comment bodies and log lines — with the single documented exception that target-repo paused entries now receive the error comments the old cwd-remote check silently dropped.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — dependencies in place.
- `bun run lint` — ESLint clean (`eslint .`).
- `bunx tsc --noEmit` — root typecheck (covers `features/**/step_definitions`).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW package typecheck.
- `bun run test:unit` — full vitest suite green (baseline: 152 files / 2796 tests; expect the count to grow with the adapter/port/boundary tests and shrink by the retired transitional block).
- `bun run lint:git-guard` — all three guard rules pass, zero stale transitional entries, no `#797` entry in the printed block.
- `bunx vitest run adws/__tests__/checkGitGhGuard.test.ts adws/providers adws/gitContext adws/core/__tests__/launchGitContext.test.ts` — the targeted suites for the moved surface.
- Task 17's four grep sweeps — each returns no matches (AC1, AC2, AC3, ad-hoc construction).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-797"` — this slice's scenarios green.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-659 or @adw-691 or @adw-692 or @adw-695 or @adw-697 or @adw-699 or @adw-775 or @adw-777 or @adw-790 or @adw-791 or @adw-792 or @adw-793 or @adw-794 or @adw-796"` — the merged proofs whose step definitions changed route stay green.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite green.
- `bunx tsx adws/checkGitGhGuard.ts | grep -c "allowlisted"` — prints `1` (the `(0 allowlisted)` capstone line only).

## Notes

- `.adw/coding_guidelines.md` applies throughout. Every **new** file in this slice is well under 300 lines (`ghIssueApi` ≈90, `ghPrApi` ≈80, `ghRepoApi` ≈130, `issueListApi` ≈40). Four touched files are already over the guideline (`gitContext.ts`, `trigger_cron.ts`, `issueApi.ts`, `prApi.ts`); this slice only removes lines from them and adds no function — new wrappers went into `issueListApi.ts` for that reason. Shrinking them further is a separate chore.
- No new library is needed (`.adw/commands.md`: `bun add <package>` would be the command if one were).
- **Order matters.** Tasks 3–6 are purely additive; the suite must be green after each. Task 13 (delete) must follow Tasks 7–12 (migrate) — deleting first turns the compiler into a to-do list of forty files at once. Task 14 (literal credential) is isolated on purpose so it can be reverted alone if the ≈150-site edit runs into trouble; its absence would leave only AC3's `GH_TOKEN` literal unmet.
- **The guard was red before this slice started.** Task 2 fixes #796's leftover; do it first and commit it separately so the branch's CI history is honest.
- **Why `createGhRepoApi` is not flagged by the construction rule:** it selects no identity — it is a view over a context the caller already holds, the same category as `createGhCommandRunner`. Flagging it would turn every `adws/github/*` wrapper into a violation without removing a single hand-typed identity. The hand-typed identities live in the `gitContextForRepo(repoInfo)` calls, which remain flagged and sanctioned under their existing `#796` entries.
- **The two extra commands this slice introduces**, both benign: `GitHubCodeHost.createPullRequest`'s reuse-existing-PR `gh pr list` before the sweep's PR creation (already preceded by the sweep's own duplicate check), and `issueApi.createIssue`'s success log line now appearing in the promotion sweep's `fileIssue`. Neither changes what lands on GitHub.
- **Follow-ups this slice deliberately leaves** (each a candidate issue): (1) thread the boundary's `GitContext` into minted providers so `GitHubCodeHost`/`GitHubBoardManager`/`adws/github/*` stop constructing per call — that empties the remaining `#796` transitional entries; (2) migrate the `repoInfo`-parameterised wrapper consumers (`adwChore`, `adwClearComments`, `unitTestPhase`, `stackCoherenceReporter`, `regionOverlapSignals`, `webhookHandlers`, `issueDependencies`, `remoteReconcile`, the four §5 trigger helpers) onto threaded providers; (3) a notification port for `notifyBlockedTransition`'s platform branch in `adwMerge.tsx`; (4) Phase B extraction, now unblocked on the core's side.
- **Deferred provider minting is what makes the `ensureTargetRepoWorkspace` thunk safe** — see `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md`; do not "simplify" the thunk into an eager `boundary.providers.codeHost` read before the workspace exists.
- The `@adw-775` §10 regression (`feature-775.steps.ts:334-337`) asserts `err.code === 'ENOENT'` on a real pre-clone spawn failure through a repo-API call; after Task 15 it goes through `createGhRepoApi(ctx)` → `ctx.exec` and the rewrap in `exec()` is unchanged — keep it that way.
