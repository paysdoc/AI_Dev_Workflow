# Feature: Orchestrators and phases speak to the forge through boundary-minted providers

## Metadata
issueNumber: `796`
adwId: `mk1wgc-migrate-orchestrator`
issueJson: `{"number":796,"title":"Migrate orchestrators and phases from GitContext semantics to providers","body":"## Parent PRD\n\nspecs/prd/gitcontext-forge-agnostic-refactor.md\n\n## What to build\n\nFirst migration wave: orchestrator scripts and phase modules that call forge-semantic methods directly on GitContext (commentOnIssue, listOpenIssues, fetchIssue, createIssue, label and PR operations, …) switch to the launch-boundary-minted providers. No behavior change — same commands against the same repos; existing suites are the regression net. GitContext's semantic methods remain in place until wave 2 removes them.\n\nSee PRD sections: Implementation Decisions (Caller migration), user stories 3/4/18/19.\n\n## Acceptance criteria\n\n- [ ] No orchestrator or phase module calls a forge-semantic method on GitContext\n- [ ] All provider instances arrive from the launch boundary (no ad-hoc construction)\n- [ ] Full unit suite green with no test-expectation changes beyond call-shape updates\n- [ ] Guard green\n\n## Blocked by\n\n- Blocked by #794\n\n## Touched Files\n\n- adws/adwMerge.tsx\n- adws/adwUpgrade.tsx\n- adws/phases/ (workflowInit, workflowCompletion, reviewPhase, prPhase, autoMergePhase)\n- adws/adwBuildHelpers.ts\n\n## User stories addressed\n\n- User story 3\n- User story 4\n- User story 18\n- User story 19","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-08-14T12:19:09Z","comments":[],"actionableComment":null}`

## Feature Description

`buildLaunchBoundary` (`adws/core/launchGitContext.ts:180`) now hands every ADW process a `GitContext` **and** a provider triple bound to the same `{owner, repo}` (#794). The orchestrators and phases that actually perform forge work, however, still bypass that triple: `adwUpgrade.tsx:503` mints its own `CodeHost`, `adwUpgrade.tsx:508-528` reaches for six forge-semantic methods straight off a `GitContext`, `upgradeGate.ts:194` and `prReviewPhase.ts:110` each build a second `RepoContext` from a hand-assembled identity, and `autoMergePhase.ts`/`reviewPhase.ts`/`adwMerge.tsx` route labels, approvals and comments through `adws/github/*` functions that take a `repoInfo` argument at every call site.

This slice makes the boundary triple the *only* way an orchestrator or phase touches the forge. The provider ports grow the operations those callers need — labels, issue creation/body edit, open-issue lookup, PR-by-branch, approval read/write, merge, and repo secret — each implemented in the GitHub adapter by delegating to the **existing** `adws/github/*` function that performs it today. Delegation, not reimplementation, is what makes "no behavior change" a structural property rather than a hope: the emitted `gh` command strings, the error policy (throw vs. swallow vs. log-and-continue), and the log lines are literally the same code, reached by a different route.

The result closes the *consumption* half of the hexagon that #794 opened on the *construction* side. After this slice, an orchestrator holds providers it was handed and a `GitContext` it uses only for git; #795 can then make that structural with a CI rule, and #797 can delete GitContext's semantic surface knowing the orchestrator/phase layer no longer references it.

This is slice 5 of `specs/prd/gitcontext-forge-agnostic-refactor.md` (user stories 3, 4, 18, 19). #790 promoted the spawn chokepoint to a public executor, #791 introduced the `TokenProvider` port, #792 consolidated the GitHub forge adapter, #794 made the boundary mint bound providers.

## User Story

As an ADW orchestrator
I want every issue, PR, label, board and secret operation to go through a provider handed to me by the launch boundary
So that swapping GitHub for another forge on a target repo requires no orchestrator change, and no call site can address a repository other than the one my process was launched for

## Problem Statement

**Six forge-semantic methods are called directly on a `GitContext` inside `adwUpgrade`'s default deps** (`adws/adwUpgrade.tsx:508-528`):

```ts
getDefaultBranch:     () => gitCtx.defaultBranch(),
fetchIssueLabels:     (n) => parseLabelNames(gitCtx.issueHasLabel(n, TERMINAL_LABEL)),
fetchIssueComments:   (n) => parseIssueComments(gitCtx.fetchIssueComments(n)),
ensureLabel:  (nm, c, d) => gitCtx.createLabel(nm, c, d),
applyLabel:      (n, lbl) => gitCtx.applyLabel(n, lbl),
moveToStatus:  (n, status) => gitCtx.moveIssueToStatus(n, status),
```

with a `CodeHost` constructed ad hoc one line earlier (`:503 const codeHost = createGitHubCodeHost(repoId);`) from a `repoId` that `main()` derives *independently* of any boundary (`:548 buildRepoIdentifier(targetRepo)`, `:552 gitContextFor({...})`). Three separate derivations of one fact — precisely the shape #794 removed from `adwMerge`.

**Four more direct GitContext semantic calls live in phase modules:**

| Site | Call | Provider equivalent today |
|---|---|---|
| `adws/phases/workflowInit.ts:221` | `gitCtx.defaultBranch()` | `codeHost.getDefaultBranch()` — exists |
| `adws/phases/prPhase.ts:58` | `gitCtx?.defaultBranch()` | `codeHost.getDefaultBranch()` — exists |
| `adws/phases/depauditSetup.ts:43` | `ctx.setSecret(envName, envValue)` | **none** |
| `adws/phases/docsSelfCheck.ts:44` | `gitContextForRepo(repoInfo).listOpenIssues({...})` | **none** |

**Providers are still minted at consumption sites.** `createRepoContext` runs at `adws/phases/upgradeGate.ts:194` (inside a per-call `moveToStatus` closure — a fresh context *per board move*) and at `adws/phases/prReviewPhase.ts:110`, both from a `RepoIdentifier` rebuilt inline. `adwPrReview.tsx:93` derives that identity with `buildRepoIdentifier(targetRepo)` and never builds a boundary at all.

**The `repoInfo` argument is a wrong-repo hazard that providers exist to delete.** `adwMerge`'s `MergeDeps` threads `repoInfo` through `findPRByBranch`, `issueHasLabel`, `fetchPRApprovalState` and `commentOnIssue` (`adws/adwMerge.tsx:53-61`); `autoMergePhase.ts:57-65` rebuilds a `RepoInfo` from `repoContext?.repoId` and passes it to five `adws/github/*` calls. Every one of those parameters is an opportunity to pass the wrong repository. A bound provider has no such parameter.

**Constraints that make this non-trivial:**

1. **The ports do not cover the operations.** `IssueTracker` (`adws/providers/types.ts:112-120`) offers `fetchIssue`, `commentOnIssue`, `deleteComment`, `closeIssue`, `getIssueState`, `fetchComments`, `moveToStatus`. `CodeHost` (`:170-178`) offers `getDefaultBranch`, `createPullRequest`, `fetchPullRequest`, `commentOnPullRequest`, `fetchReviewComments`, `listOpenPullRequests`, `getRepoIdentifier`. Labels, issue creation, body edit, open-issue search, PR-by-branch, approval, merge and secrets have no port at all.
2. **Two implementations already satisfy those interfaces.** `GitLabCodeHost implements CodeHost` (`adws/providers/gitlab/gitlabCodeHost.ts:27`) and `JiraIssueTracker implements IssueTracker` (`adws/providers/jira/jiraIssueTracker.ts:37`). Any required addition breaks both, and the PRD puts *new* GitLab/Jira capabilities out of scope.
3. **Identical concepts have deliberately different error policies.** `issueApi.addIssueLabel` logs and swallows (fail-open, so auto-merge proceeds); `labelManager.applyLabel` lazy-creates a missing label and rethrows anything else; `gitContext.applyLabel` throws on everything. `issueApi.fetchIssueCommentsRest` **throws** where `adwUpgrade`'s current `parseIssueComments` returns `[]`. Collapsing these onto one port method without care silently changes failure behaviour in the exact paths (failure-cap escalation, auto-merge gating) that exist to stop runaway loops.
4. **`workflowInit`'s boundary is wrapped in a `try/catch`** (`:138-141`, #794's graceful-fallback contract), so `boundary` is typed `LaunchBoundary | undefined` at every downstream use.

## Solution Statement

### 1. Grow the ports to cover exactly the migrated operations

`adws/providers/types.ts` gains three small types and thirteen methods. Every signature is forge-neutral and drops the `repoInfo` parameter — the provider is already bound.

```ts
/** Minimal open-issue projection returned by tracker lookups. */
export interface IssueSummary { number: number; title: string; }

/** Branch-level PR projection: what merge/idempotency decisions need, nothing more. */
export interface PullRequestSummary {
  number: number;
  state: string;
  sourceBranch: string;
  targetBranch: string;
  labels: readonly string[];
}

/** Outcome of a forge mutation that is reported, not thrown. */
export interface ForgeActionResult { success: boolean; error?: string; }
```

`IssueTracker` adds:

| Method | Replaces | GitHub adapter delegates to |
|---|---|---|
| `fetchLabels(issueNumber): readonly string[]` | `gitCtx.issueHasLabel` + `parseLabelNames`; `issueApi.issueHasLabel` | new `issueApi.fetchIssueLabels` |
| `addLabel(issueNumber, labelName): void` | `issueApi.addIssueLabel` (fail-open) | `issueApi.addIssueLabel` |
| `applyLabel(issueNumber, labelName): void` | `labelManager.applyLabel` (lazy-create) | `labelManager.applyLabel` |
| `ensureLabel(name, color, description): void` | `gitCtx.createLabel` | new `labelManager.ensureLabelExists` |
| `createIssue(title, body): number` | `issueApi.createIssue` | `issueApi.createIssue` |
| `updateIssueBody(issueNumber, body): void` | `issueApi.updateIssueBody` | `issueApi.updateIssueBody` |
| `searchOpenIssues(search, limit): readonly IssueSummary[]` | `gitContextForRepo(...).listOpenIssues` | new `issueApi.searchOpenIssues` |
| `findOpenUpgradeIssue(): number \| null` | `issueApi.findOpenUpgradeIssue` | `issueApi.findOpenUpgradeIssue` |

`CodeHost` adds:

| Method | Replaces | GitHub adapter delegates to |
|---|---|---|
| `findPullRequestByBranch(branchName): PullRequestSummary \| null` | `defaultFindPRByBranch` | `defaultFindPRByBranch` + a pure map |
| `isPullRequestApproved(prNumber): boolean` | `fetchPRApprovalState` | `fetchPRApprovalState` |
| `approvePullRequest(prNumber): ForgeActionResult` | `approvePR` | `approvePR` |
| `mergePullRequest(prNumber): ForgeActionResult` | `mergePR` | `mergePR` |
| `setSecret(name, value): void` | `gitCtx.setSecret` | `gitContextForRepo(this.repoInfo).setSecret` (the pattern `createPullRequest` already uses at `githubCodeHost.ts:75`) |

`addLabel` and `applyLabel` are **two methods on purpose** — they are the two error policies from constraint 3, and a caller picks the one whose failure behaviour it already relies on. `findOpenUpgradeIssue` keeps its ADW-domain name: the ports are forge-neutral, not domain-neutral (`moveToStatus(BoardStatus)` already encodes ADW's board vocabulary, `types.ts:64-99`), and re-expressing it as a generic label query would change the emitted command string for zero benefit.

### 2. Three thin GitHub wrappers, so the adapter keeps delegating rather than reimplementing

`githubIssueTracker` already delegates every method to `adws/github/*`. Three operations have no wrapper yet; add them beside their siblings, in the same shape (bound `repoInfo` last, existing error policy):

```ts
// adws/github/issueApi.ts
/** Returns the issue's label names; [] on any error (fail-open, as issueHasLabel). */
export function fetchIssueLabels(issueNumber: number, repoInfo: RepoInfo): string[];

/** Open issues matching a forge search string. Best-effort: [] on any error. */
export function searchOpenIssues(search: string, limit: number, repoInfo: RepoInfo): IssueSummaryRecord[];

// adws/github/labelManager.ts
/** Idempotently creates/updates a label definition (gh label create --force). */
export function ensureLabelExists(name: string, color: string, description: string, repoInfo: RepoInfo): void;
```

`searchOpenIssues` calls `gitContextForRepo(repoInfo).listOpenIssues({ fields: ['number', 'title'], search, limit })` — byte-identical to `docsSelfCheck.ts:44-48` today. `fetchIssueLabels` parses the same `{labels: [{name}]}` payload `issueHasLabel` parses. `ensureLabelExists` calls `gitContextForRepo(repoInfo).createLabel(...)`. These three functions are the only new code in `adws/github/`; they are #797's next deletion targets, not new architecture.

### 3. GitLab and Jira get refusal stubs, not new capabilities

Each new method is added to `GitLabCodeHost` / `JiraIssueTracker` as a one-line refusal:

```ts
approvePullRequest(): ForgeActionResult {
  throw new Error('GitLabCodeHost.approvePullRequest is not implemented');
}
```

This is interface completeness, not capability: the PRD's "no new GitLab/Jira operations" stays honoured, and the refusal is *by name* — the same discipline `mintBoundProviders` uses for unsupported platforms (`repoContext.ts:266-288`). Note `resolveIssueTracker` (`repoContext.ts:196-204`) accepts GitHub only, so `JiraIssueTracker` is unreachable from a boundary today regardless.

### 4. Orchestrators take their providers from the boundary

**`adwUpgrade.tsx`** — `main()` replaces `buildRepoIdentifier` + `gitContextFor` with one `buildLaunchBoundary(targetRepo)` call (the `adwMerge` shape from #794), and `buildDefaultUpgradeDeps(providers, gitCtx)` sources every forge dep from the triple:

```ts
const { gitContext, repoId, providers } = buildLaunchBoundary(targetRepo);
// …
getDefaultBranch:  () => providers.codeHost.getDefaultBranch(),
findPRByBranch:    (branch) => providers.codeHost.findPullRequestByBranch(branch),
createPullRequest: (options) => providers.codeHost.createPullRequest(options),
mergePR:           (prNumber) => providers.codeHost.mergePullRequest(prNumber),
commentOnIssue:    (n, body) => providers.issueTracker.commentOnIssue(n, body),
fetchIssueLabels:  (n) => providers.issueTracker.fetchLabels(n),
fetchIssueComments:(n) => { try { return providers.issueTracker.fetchComments(n); } catch { return []; } },
ensureLabel:  (nm, c, d) => providers.issueTracker.ensureLabel(nm, c, d),
applyLabel:      (n, lbl) => providers.issueTracker.applyLabel(n, lbl),
moveToStatus:  (n, status) => providers.issueTracker.moveToStatus(n, status),
```

Three behaviour-preservation details, each load-bearing:

- **`fetchIssueComments` must not start throwing.** `parseIssueComments` returns `[]` on malformed JSON today; `IssueTracker.fetchComments` → `fetchIssueCommentsRest` **throws** (`issueApi.ts:235`). The `try/catch` above keeps the failure-cap gate counting `0` instead of crashing `executeUpgrade`. `IssueComment` is structurally assignable to `IssueCommentRecord` (`{body, author}`, `upgradeFailureCap.ts:10-13`), so no mapper is needed.
- **`applyLabel` gains a lazy-create branch it cannot reach.** `deps.ensureLabel(TERMINAL_LABEL, …)` runs on the line before `deps.applyLabel` (`adwUpgrade.tsx:296-297`), so the label always exists; the added branch is unreachable and the observable behaviour is identical.
- **`moveToStatus` becomes async.** `IssueTracker.moveToStatus` returns `Promise<boolean>`; the dep type changes to `Promise<boolean>` and the call site awaits it. It already sits in an `async` function and its result is already ignored, so ordering relative to the following `postSlack` is unchanged.
- **`hasWontFixLabel`** now receives `PullRequestSummary.labels` (a `readonly string[]`). Add a sibling pure predicate `hasWontFixLabelName(labels: readonly string[]): boolean` in `prApi.ts` holding the existing lenient normalisation, and have `hasWontFixLabel(pr: RawPR)` delegate to it — one normalisation, two shapes, no behaviour change for the existing caller.

**`adwMerge.tsx`** — `buildDefaultDeps(platform, gitCtx)` becomes `buildDefaultDeps(boundary)`; the four forge deps drop their `repoInfo` parameter and read from `boundary.providers`. `MergeDeps` signatures change accordingly (`findPRByBranch(branchName)`, `issueHasLabel(issueNumber, labelName)`, `fetchPRApprovalState(prNumber)`, `commentOnIssue(issueNumber, body)`), and `issueHasLabel` is implemented as `providers.issueTracker.fetchLabels(n).includes(labelName)` — identical to `issueApi.issueHasLabel`'s `some(l => l.name === labelName)` over the same fail-open `[]`. `mergeWithConflictResolution` and `notifyBlockedTransition` keep their `repoInfo` arguments: both live in `adws/triggers/` and `adws/github/`, which are #797's wave.

**`adwPrReview.tsx`** — builds the boundary and passes it to `initializePRReviewWorkflow` as a new trailing optional parameter, exactly as `adwMerge` consumes it.

### 5. Phases take their providers from `config.repoContext`

`WorkflowConfig.repoContext` is already the boundary triple: `workflowInit.ts:311-317` passes `providers: boundary.providers` into `createRepoContext` when the identities match (#794). So no new plumbing is needed for phases — they use what they already hold.

- **`autoMergePhase.ts`** — the early `if (!owner || !repo) return` guard becomes `if (!repoContext) return` (same condition, since `owner`/`repo` are read from `repoContext?.repoId`), the `RepoInfo` local disappears, and the five calls become `repoContext.issueTracker.fetchLabels(...).includes('hitl')`, `codeHost.isPullRequestApproved(...)`, `issueTracker.addLabel(...)`, `issueTracker.commentOnIssue(...)`, `codeHost.commentOnPullRequest(...)`. `addLabel` (not `applyLabel`) preserves the fail-open policy this gate depends on.
- **`reviewPhase.ts`** — `approvePR(prNumber, repoInfo)` → `repoContext.codeHost.approvePullRequest(prNumber)`; the `repoInfo` local at `:113` goes away. `executeReviewPatchCycle`'s `gitContextFor` at `:187` stays: it is used only for `commandEnv()` and `pushBranch()`, which are git operations, not forge semantics.
- **`prPhase.ts`** — `gitCtx?.defaultBranch()` → `repoContext.codeHost.getDefaultBranch()`. `gitCtx` itself stays for `pushBranch`/`commandEnv`, so the existing `if (repoContext && gitCtx)` gate and its no-context diagnostic branch are untouched. `GitHubCodeHost.getDefaultBranch()` builds `gitContextForSync({owner, repo, selfHost: false})` internally (`githubCodeHost.ts:44`) — the same construction `prPhase` performs today at `:56`, so the emitted `gh repo view` is unchanged.
- **`depauditSetup.ts`** — the `gitContextForRepo` dep is replaced by a `codeHost?: CodeHost` seam defaulting to `config.repoContext?.codeHost`; `propagateSecret` calls `codeHost.setSecret(name, value)`. When no `repoContext` exists the secrets are recorded as skipped with a warning, which is the same observable outcome as today's failure path (`{propagated: false, warning}` → `skippedSecrets`).
- **`docsSelfCheck.ts`** — `DocsSelfCheckDeps.createIssue`/`findExistingRefactorIssue` drop `repoInfo` and are built from an injected `IssueTracker`: `buildDefaultDocsSelfCheckDeps(issueTracker)`. `findExistingRefactorIssueDefault` becomes `tracker.searchOpenIssues(\`docs-bloat: ${docPath}\`, 5)` with the same `find(r => r.title.includes(docPath))` filter and the same swallow-to-`null`.
- **`prReviewPhase.ts`** — `createRepoContext` receives `providers: boundary.providers` gated by `sameRepoIdentity(repoIdForContext, boundary.repoId)`, mirroring `workflowInit.ts:311-317` line for line. The `gitContextFor` at `:93` stays (worktree creation — a git operation).

### 6. `workflowInit` and the upgrade gate

`workflowInit.ts:221` becomes `const defaultBranch = boundary.providers.codeHost.getDefaultBranch();`, guarded immediately above by

```ts
if (!boundary) {
  throw new Error('initializeWorkflow: launch boundary unavailable — providers cannot be resolved for this run');
}
```

**Why the guard is safe.** `boundary === undefined` is unreachable in production at this line. `gitContextForSync` (`:132`) and `buildLaunchBoundary` (`:140`) construct a `GitContext` from the same owner/repo, the same `resolveBootstrapGitIdentity()`, and the same `createGitHubTokenProvider({pat: GITHUB_PAT, isAppConfigured, mintInstallationToken, ghAuthToken})` composition (`gitContextFactory.ts:46-53, 98-112` vs `launchGitContext.ts:95-103`), and both run the identical validate-and-discard credential probe in `assertCompleteIdentity` (`gitContext.ts:126-149`). The boundary's only extra input is `getRepoInfo()` on the self-host path — already proven to succeed at `:131`. So if line 132 succeeded, line 140 cannot fail; the only way to reach line 221 with no boundary is a test that mocks `gitContextForSync` but not `buildLaunchBoundary`, which is exactly what `workflowInit.test.ts` does today.

**The provider-sourcing decision becomes a named function.** `workflowInit.ts:307-317` currently derives `repoIdForContext` from `options?.repoId ?? (repoInfo ?? getRepoInfo())` — a *second* read of the local git remote in the one function whose job is to establish which repository this run is about — and then decides whether to reuse the boundary's providers. Extract that decision:

```ts
/** Resolves the provider set a workflow's RepoContext must use. The boundary is the only source. */
export function resolveWorkflowProviders(
  boundary: LaunchBoundary,
  callerRepoId?: RepoIdentifier,
): { repoId: RepoIdentifier; providers: BoundProviders } {
  const repoId = callerRepoId ?? boundary.repoId;
  // …identity agreement decided here; see the ADW-WARNING below…
}
```

With no caller-supplied identity the context's `repoId` is now `boundary.repoId` rather than a fresh `getRepoInfo()` read, and the providers are the boundary's instances. This is the same value by construction (`buildLaunchBoundary` derives owner/repo from `targetRepo ?? getRepoInfo()`, `launchGitContext.ts:194-195`, exactly as `buildRepoIdentifier` does at `orchestratorCli.ts:139-145`), so no existing expectation moves — but the *read* is gone, which is what feature-796 §5's first row asserts and what the PRD's wrong-repo invariant is for. Because the `if (!boundary) throw` guard above runs at `:221`, `boundary` is non-optional by the time this function is reached.

<!-- ADW-WARNING: UNRESOLVED — feature-796.feature §5's second row ("A caller-supplied identity that contradicts the boundary is refused rather than served a second provider set" → "resolving workflow init's providers failed naming both repositories") demands the mismatch branch THROW. The merged #794 unit test `workflowInit.test.ts:330-344` ("does not pass boundary providers when a caller-supplied repoId names a different repository") asserts the opposite: createRepoContext is still called, with `providers: undefined`, and mints a second set. The issue arbitrates both ways and cannot settle it — AC2 ("All provider instances arrive from the launch boundary (no ad-hoc construction)") supports the refusal, while AC3 ("Full unit suite green with no test-expectation changes beyond call-shape updates") forbids reversing that merged assertion, which is a behavioural expectation and not a call shape. Neither file was changed for this conflict. DECIDE BEFORE IMPLEMENTING §5's second row: either (a) refuse on mismatch and rewrite the #794 test, declaring the expectation change and its justification in the PR body, or (b) keep the current fallback, drop §5's second scenario from feature-796.feature, and name `workflowInit.test.ts:330-344` as its standing replacement. Do not leave the scenario as a pending stub. -->

`upgradeGate.ts` — `buildDefaultUpgradeGateDeps(providers, worktreePath, gitShow)` replaces the `repoId` parameter with the boundary triple; `createIssue`, `applyLabel`, `updateIssueBody`, `findOpenUpgradeIssue` and `moveToStatus` all read from it, and the per-call `createRepoContext` at `:194` is deleted. `UpgradeGateDeps` signatures drop `repoInfo` (it survives in `UpgradeGateParams` for `claimUpgrade`, which is `adws/core/upgradeClaim.ts` — #797's wave). `moveToStatus` keeps its `Promise<void>` + best-effort `try/catch` contract.

### 7. What this slice deliberately does not do

- **It does not touch `adws/github/**` call sites outside the migrated modules.** Modules that reach the forge only through those wrappers (`adwChore.tsx`, `adwClearComments.tsx`, `unitTestPhase.ts`, `stackCoherenceReporter.ts`, `prReviewPhase.ts`'s `fetchPRDetails`/`getUnaddressedComments`) already satisfy AC1 — they hold no `GitContext`. Migrating them now would roughly double the port surface for zero AC movement; #797 owns them alongside the wrapper deletion.
- **It does not migrate `healthCheck.tsx`.** Its `ctx.authenticatedUser()` and `ctx.fetchIssue()` probes exist to verify the GitContext credential/command path itself (#699). Routing them through a provider would test the provider, not the thing the diagnostic exists to check. `healthCheck.tsx` is a diagnostic CLI, not an orchestrator or phase.
- **It does not delete anything from `GitContext`.** Every semantic method stays until #797.
- **It does not add the guard rule** forbidding ad-hoc construction — that is #795, which lands independently.
- **It does not fold `notifyBlockedTransition`'s platform branch into a provider.** `adwMerge.tsx:249` reads `platform === Platform.GitHub ? notifyBlockedTransition : async () => undefined` — an orchestrator branching on which forge it is talking to, which is the shape user story 4 exists to delete. feature-796.feature's fourth scope note flags it and asks that it be settled here or deferred explicitly; **it is deferred to #797**. The reason is scope, not oversight: it is a Slack board-notification concern reached through `adws/github/hitlBoardNotifier`, none of the issue's named operations (`commentOnIssue`, `listOpenIssues`, `fetchIssue`, `createIssue`, label and PR operations) cover it, and giving it a home means either widening `BoardManager` or adding a notification port — a design decision with its own blast radius, in the same wave that deletes the `adws/github/*` wrappers it calls. No scenario asserts it.
- **It changes neither `workflowCompletion.ts` nor `adwBuildHelpers.ts`.** Both are named in the issue's Touched Files; both were read in full and neither performs any forge-semantic work. `workflowCompletion.ts` is already 100% provider-routed (`postIssueStageComment`, `issueTracker.moveToStatus`); its only remaining forge reference is `notifyBlockedTransition`, an `adws/github/` Slack notifier in #797's wave. `adwBuildHelpers.ts` contains `extractPrNumber`, `parseArguments` and `printBuildSummary` — no forge calls at all.

## Relevant Files
Use these files to implement the feature:

### Ports and adapters (changed)
- `adws/providers/types.ts` — `IssueTracker` (`:112`) and `CodeHost` (`:170`) gain the thirteen methods; `IssueSummary`, `PullRequestSummary`, `ForgeActionResult` are added here beside the existing projections.
- `adws/providers/github/githubIssueTracker.ts` — implements the eight new tracker methods by delegating to `adws/github/*`, exactly as its seven existing methods do.
- `adws/providers/github/githubCodeHost.ts` — implements the five new code-host methods; already imports `gitContextForRepo` (`:9`) for `createPullRequest`, so `setSecret` follows that pattern.
- `adws/providers/gitlab/gitlabCodeHost.ts` — refusal stubs for the five new `CodeHost` methods.
- `adws/providers/jira/jiraIssueTracker.ts` — refusal stubs for the eight new `IssueTracker` methods.
- `adws/github/issueApi.ts` — new `fetchIssueLabels`, `searchOpenIssues` (thin wrappers in the file's existing shape).
- `adws/github/labelManager.ts` — new `ensureLabelExists`.
- `adws/github/prApi.ts` — new pure `hasWontFixLabelName(labels)`; `hasWontFixLabel(pr)` delegates to it.
- `adws/github/index.ts` — re-export the three new wrappers beside their siblings.

### Orchestrators (changed)
- `adws/adwMerge.tsx` — `buildDefaultDeps` is **exported** and sources forge deps from `boundary.providers`; `MergeDeps` forge signatures drop `repoInfo`. The export is load-bearing: feature-796 drives the real composition, not hand-built deps.
- `adws/adwUpgrade.tsx` — `main()` adopts `buildLaunchBoundary`; `buildDefaultUpgradeDeps` is **exported** and sources every forge dep from the triple; `createGitHubCodeHost` import and the six direct `gitCtx.<forge>` calls (`:508`, `:524-528`) are removed.
- `adws/adwPrReview.tsx` — builds the boundary and hands it to `initializePRReviewWorkflow`.

### Phases (changed)
- `adws/phases/workflowInit.ts` — `defaultBranch` from the boundary code host; hands `boundary.providers` to `buildDefaultUpgradeGateDeps`; new exported `resolveWorkflowProviders` replaces the inline identity derivation + reuse ternary at `:307-317` (Solution §6, and the ADW-WARNING there).
- `adws/phases/upgradeGate.ts` — deps built from `BoundProviders`; the per-call `createRepoContext` at `:194` deleted.
- `adws/phases/autoMergePhase.ts` — five `adws/github` calls become provider calls.
- `adws/phases/reviewPhase.ts` — `approvePR` becomes `codeHost.approvePullRequest`.
- `adws/phases/prPhase.ts` — `gitCtx?.defaultBranch()` becomes `codeHost.getDefaultBranch()`.
- `adws/phases/docsSelfCheck.ts` — deps built from an injected `IssueTracker`.
- `adws/phases/depauditSetup.ts` — `setSecret` through the code host.
- `adws/phases/prReviewPhase.ts` — `createRepoContext` reuses boundary providers.

### Read but deliberately unchanged (context for the reviewer)
- `adws/core/launchGitContext.ts` — the boundary this slice consumes; `buildLaunchBoundary` (`:180`), `LaunchBoundary` (`:124`).
- `adws/providers/repoContext.ts` — `mintBoundProviders` / `createRepoContext`; **exactly 300 lines**, at the guideline ceiling — do not add to it.
- `adws/phases/workflowCompletion.ts`, `adws/adwBuildHelpers.ts` — verified free of forge-semantic work (§7).
- `adws/healthCheck.tsx`, `adws/healthCheckChecks.ts` — diagnostic prober, out of scope (§7).
- `adws/gitContext/gitContext.ts:492-756` — the semantic surface being vacated; unchanged here, deleted in #797.
- `adws/checkGitGhGuard.ts` — the guard that must stay green; `EXEMPT_PACKAGES` and the `cwd-derived-identity` rule.

### Tests
- `adws/__tests__/adwMerge.test.ts` — `makeDeps` and the `toHaveBeenCalledWith(..., REPO_INFO)` assertions (call-shape updates).
- `adws/__tests__/adwUpgrade.test.ts` — `makeDeps` (`moveToStatus` becomes async).
- `adws/__tests__/depauditSetup.test.ts` — the `gitContextForRepo` seam becomes a `codeHost` seam.
- `adws/phases/__tests__/docsSelfCheck.test.ts` — mocks `gitContextForRepo`; becomes an `IssueTracker` double.
- `adws/phases/__tests__/upgradeGate.test.ts` — `buildDefaultUpgradeGateDeps` signature.
- `adws/phases/__tests__/workflowInit.test.ts` — `makeFakeBoundary` (`:302`) grows a `codeHost.getDefaultBranch`; the default `mockBuildLaunchBoundary` return is set in setup.
- `adws/phases/__tests__/reviewPhase.test.ts` — `mockGitContextFor` (`:32`).
- `adws/providers/__tests__/repoContext.test.ts` — untouched (`mintBoundProviders` behaviour is unchanged).

### BDD scenarios for this slice
- `features/per-issue/feature-796.feature` — authored by the scenario phase; the authority on wording. Implement against it; do not reword it.
- `features/per-issue/step_definitions/feature-796.steps.ts` — **new** (see New Files).
- `features/per-issue/step_definitions/gitContextSharedWorld.ts` — the shared world used by `feature-790/791/792/794` step defs; reuse it.

### Merged proofs that must stay green
- `features/per-issue/feature-794.feature` + `feature-794.steps.ts` — the boundary contract this slice consumes.
- `features/per-issue/feature-792.feature`, `feature-791.feature`, `feature-790.feature` — the adapter/executor/token contracts underneath.

### Conditional documentation (from `.adw/conditional_docs.md`)
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — owns `launchGitContext.ts`; read before consuming `buildLaunchBoundary`, `LaunchBoundary`, or `freezeBoundary`'s deferred minting.
- `app_docs/feature-e2er82-github-forge-adapter.md` — owns `adws/providers/github/**`; the deep-import rule (never the `adws/providers` barrel from `launchGitContext.ts`/`gitContextFactory.ts`) and the "`gitContext.ts` imports command builders TRANSITIONALLY … pending migration to callers in #796/#797" note.
- `app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md` — `RepoContext`, `createRepoContext`, and "adding support for new provider platforms (IssueTracker or CodeHost)".
- `app_docs/feature-wrzj5j-harden-project-board-status.md` — condition: "When modifying `IssueTracker.moveToStatus` in `adws/providers/types.ts` or provider implementations".
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — owns `adws/adwUpgrade.tsx`; `UpgradeDeps`, the failure-cap escalation, and the `adw:blocked` terminal label.
- `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` — the `hitl` gate in `adwMerge.tsx`/`autoMergePhase.ts`; condition: "When extending `MergeDeps` with new injectable dependencies".
- `app_docs/feature-cudwfe-passive-judge-review-phase.md` — owns `reviewPhase.ts` / `executeReviewPatchCycle`.
- `app_docs/feature-1773341233172-9jw507-gitlab-codehost-provider.md` — "When adding or modifying provider implementations in `adws/providers/`".
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — the guard that must stay green.
- `app_docs/feature-6zw7n2-hitl-opt-in-adw-yml.md` — `adwUpgrade`'s gated merge step.

### New Files
- `features/per-issue/step_definitions/feature-796.steps.ts` — step definitions for `feature-796.feature`.

## Implementation Plan

### Phase 1: Foundation
Grow the two ports and their three implementations so a migrated caller has somewhere to land. Add the three thin `adws/github/*` wrappers the GitHub adapter delegates to, and the pure `hasWontFixLabelName` predicate. Add refusal stubs to GitLab/Jira so the interfaces stay total. Nothing else changes yet, and the whole suite must still be green after this phase — it is purely additive.

### Phase 2: Core Implementation
Migrate the two orchestrators that hold a `GitContext` and call forge semantics on it (`adwUpgrade`, `adwMerge`), then the phases (`workflowInit`, `upgradeGate`, `autoMergePhase`, `reviewPhase`, `prPhase`, `docsSelfCheck`, `depauditSetup`). Each migration is: delete the `repoInfo` parameter, source the operation from the boundary triple, and leave the git-only `GitContext` uses alone.

### Phase 3: Integration
Close the ad-hoc-construction sites (`adwPrReview` + `prReviewPhase`), update the affected unit suites with call-shape-only edits, prove AC1 with a repository-wide sweep, write the BDD step definitions, update the README, and run the full validation set.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Read the ground truth before editing

- Read `specs/prd/gitcontext-forge-agnostic-refactor.md` — Solution, Implementation Decisions ("Caller migration", "Launch boundary", "Wrong-repo invariants preserved throughout"), Testing Decisions ("Caller migration: no new tests"), and user stories 3, 4, 18, 19, 24.
- Read `.adw/coding_guidelines.md` and apply it throughout: single responsibility, files under 300 lines, immutability, explicit types over `any`, guard clauses over nesting, side effects at the edges, no inline callbacks longer than ~3 lines.
- Read in full: `adws/providers/types.ts`, `adws/providers/github/githubIssueTracker.ts`, `adws/providers/github/githubCodeHost.ts`, `adws/core/launchGitContext.ts`, `adws/adwUpgrade.tsx`, `adws/adwMerge.tsx`, `adws/phases/upgradeGate.ts`, `adws/phases/autoMergePhase.ts`.
- Read the conditional docs listed under **Relevant Files → Conditional documentation**.
- Read `features/per-issue/feature-796.feature` — it is the RED-first driver and the authority on scenario wording.

### 2. Add the port types and method signatures

- In `adws/providers/types.ts`, add `IssueSummary`, `PullRequestSummary` and `ForgeActionResult` per Solution §1, each with a one-line JSDoc.
- Add the eight methods to `IssueTracker` and the five to `CodeHost`, one JSDoc line each. Keep JSDoc terse: the file is 199 lines and must stay under the 300-line guideline.
- Run `bunx tsc --noEmit -p adws/tsconfig.json`. Expect exactly three implementation errors — `GitHubIssueTracker`, `GitHubCodeHost`, `GitLabCodeHost`, `JiraIssueTracker` no longer satisfy their interfaces. That error list is the checklist for steps 3–5.

### 3. Add the three GitHub wrappers and the pure label predicate

- `adws/github/issueApi.ts`: add `fetchIssueLabels(issueNumber, repoInfo): string[]` (parses `{labels:[{name}]}` from `gitContextForRepo(repoInfo).issueHasLabel(...)`, returns `[]` on error with the same warn log as `issueHasLabel`) and `searchOpenIssues(search, limit, repoInfo)` (calls `listOpenIssues({fields:['number','title'], search, limit})`, returns `[]` on error).
- `adws/github/labelManager.ts`: add `ensureLabelExists(name, color, description, repoInfo): void` delegating to `gitContextForRepo(repoInfo).createLabel(...)`.
- `adws/github/prApi.ts`: extract the lenient normalisation from `hasWontFixLabel` into `hasWontFixLabelName(labels: readonly string[]): boolean` and have `hasWontFixLabel(pr: RawPR)` call it. Behaviour must be identical for the existing `RawPR` caller.
- Re-export all three from `adws/github/index.ts` beside their siblings.
- Do **not** change any existing function's signature or error policy in this step.

### 4. Implement the new methods in the GitHub adapter

- `githubIssueTracker.ts`: add the eight methods, each a one-line delegation to the wrapper named in Solution §1's table, mapping `IssueSummary` straight through. Keep the class's existing style (bound `this.repoInfo` passed last).
- `githubCodeHost.ts`: add the five methods. `findPullRequestByBranch` calls `defaultFindPRByBranch(branchName, this.repoInfo)` and maps `RawPR` → `PullRequestSummary` via a small pure mapper in `adws/providers/github/mappers.ts` (`mapRawPRToSummary`), flattening `labels?: {name}[]` to `string[]` with `?? []`. `setSecret` uses `gitContextForRepo(this.repoInfo).setSecret(name, value)`, matching `createPullRequest`'s existing pattern at `:75`.
- Confirm both files stay well under 300 lines.

### 5. Add refusal stubs to GitLab and Jira

- `gitlabCodeHost.ts`: five methods, each `throw new Error('GitLabCodeHost.<name> is not implemented')`.
- `jiraIssueTracker.ts`: eight methods, same shape with the `JiraIssueTracker.` prefix.
- Do not implement any of them. These exist so the interfaces stay total, per Solution §3.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — clean.
- Run `bun run test:unit` — green. Phase 1 is purely additive; any red here means an existing behaviour was disturbed and must be fixed, not re-expected.

### 6. Unit-test the new adapter surface

- Extend `adws/providers/github/__tests__/` (or add `githubIssueTracker.test.ts` / `githubCodeHost.test.ts` if absent) with tests that mock the `adws/github/*` wrapper modules and assert **delegation**: each new method calls its wrapper exactly once, with the bound `repoInfo` and the caller's arguments, and returns/propagates the wrapper's value unchanged.
- Assert the two label policies stay distinct: `addLabel` swallows a throwing wrapper, `applyLabel` propagates one.
- Assert `mapRawPRToSummary` flattens labels and defaults a missing `labels` field to `[]`.
- Assert one GitLab and one Jira stub throw naming the method.
- Run `bunx vitest run adws/providers/__tests__ adws/providers/github/__tests__` — green.

### 7. Migrate `adwUpgrade.tsx`

- `main()`: replace `buildRepoIdentifier(targetRepo)` + `await gitContextFor({...})` with `const { gitContext, repoId, providers } = buildLaunchBoundary(targetRepo);`. Keep `repoInfo` derived from `repoId` and leave `baseRepoPath` (`:550`) as it is — it is an unused parameter of `executeUpgrade` and cleaning it up is not this slice's job.
- **Export** `buildDefaultUpgradeDeps` and change `buildDefaultUpgradeDeps(repoId, gitCtx)` to `buildDefaultUpgradeDeps(providers, gitCtx)`, rewiring every forge dep per Solution §4, including the `fetchIssueComments` `try/catch`, the awaited `moveToStatus`, and `BoardStatus.Blocked` in place of the `'Blocked'` string.
- Change `UpgradeDeps.findPRByBranch` to `(branch: string) => PullRequestSummary | null`, `mergePR` to `(prNumber: number) => ForgeActionResult`, `commentOnIssue` to `(issueNumber: number, body: string) => void`, and `moveToStatus` to `(issueNumber: number, status: BoardStatus) => Promise<boolean>`; update `executeUpgrade`'s call sites (drop `repoInfo` arguments, `await` the board move).
- Replace `hasWontFixLabel(existingClaimPr)` with `hasWontFixLabelName(existingClaimPr.labels)`.
- Delete the `createGitHubCodeHost` import, the `gitContextFor` import if now unused, and `parseLabelNames`/`parseIssueComments` if they no longer have callers.
- Update `adws/__tests__/adwUpgrade.test.ts`'s `makeDeps` for the new signatures (`moveToStatus: vi.fn().mockResolvedValue(true)`), and any `toHaveBeenCalledWith(..., REPO_INFO)` assertion. Change nothing else: every existing scenario expectation must survive.
- Run `bunx vitest run adws/__tests__/adwUpgrade.test.ts` — green.

### 8. Migrate `adwMerge.tsx`

- **Export** `buildDefaultDeps` and change `buildDefaultDeps(platform, gitCtx)` to `buildDefaultDeps(boundary: LaunchBoundary)`, reading `platform` from `boundary.repoId.platform` and `gitCtx` from `boundary.gitContext`.
- Drop `repoInfo` from `MergeDeps.findPRByBranch`, `issueHasLabel`, `fetchPRApprovalState` and `commentOnIssue`; implement each from `boundary.providers` per Solution §4, with `issueHasLabel` as `fetchLabels(n).includes(labelName)`.
- Update `executeMerge`'s call sites to match. Leave `mergeWithConflictResolution` and `notifyBlockedTransition` (and therefore `executeMerge`'s `repoInfo` parameter) exactly as they are.
- Update `adws/__tests__/adwMerge.test.ts`: `makeDeps` types and the `REPO_INFO` arguments in `toHaveBeenCalledWith`. No expectation about *what* is commented, labelled or merged may change.
- Run `bunx vitest run adws/__tests__/adwMerge.test.ts` — green.

### 9. Migrate `workflowInit.ts` and hand providers to the upgrade gate

- Add the `if (!boundary) throw …` guard clause immediately before the default-branch resolution, with a comment recording the argument from Solution §6 (same constructor, same probe, so line 132 already proved it).
- Replace `const defaultBranch = gitCtx.defaultBranch();` with `boundary.providers.codeHost.getDefaultBranch()`.
- Change the `runUpgradeGate` call to pass `buildDefaultUpgradeGateDeps(boundary.providers, targetRepoWorkspacePath, gitShow)` and delete the now-unused `gateRepoId` block.
- Extract `resolveWorkflowProviders(boundary, callerRepoId?)` per Solution §6 and replace the `repoIdForContext` derivation + `sameRepoIdentity(...) ? boundary.providers : undefined` ternary (`:307-317`) with a call to it. With no caller-supplied `repoId` the context identity is `boundary.repoId` — the `repoInfo ?? getRepoInfo()` fallback on this path goes away. Export it: feature-796 §5's first row drives it directly (`initializeWorkflow` itself is not reachable in the cucumber harness — see the feature file's testing notes).
- **Read the ADW-WARNING in Solution §6 before touching the mismatch branch.** Leave that branch exactly as #794 left it unless the warning's option (a) has been chosen; the matching-identity path and the surrounding `try/catch` + "falling back to direct API calls" log are unchanged either way.
- Leave every other `gitCtx` use (`headShort`, `mergeLatestFromDefaultBranch`, `ensureWorktree`, `copyEnvToWorktree`, `findWorktreeForIssue`, `getWorktreeForBranch`, `fetchAndResetToRemote`, `show`) untouched — those are git operations.
- In `adws/phases/__tests__/workflowInit.test.ts`: move `makeFakeBoundary` above the first `describe`, give its `providers.codeHost` a `getDefaultBranch: vi.fn().mockReturnValue('main')`, and set `mockBuildLaunchBoundary.mockReturnValue(makeFakeBoundary('test-owner', 'test-repo'))` in the shared setup so all ten `initializeWorkflow` calls take the boundary path. The two `mockReturnValueOnce` tests from #794 keep precedence and stay unedited.
- Run `bunx vitest run adws/phases/__tests__/workflowInit.test.ts` — green.

### 10. Migrate `upgradeGate.ts`

- Change `buildDefaultUpgradeGateDeps(repoId, worktreePath, gitShow)` to `buildDefaultUpgradeGateDeps(providers: BoundProviders, worktreePath, gitShow)`.
- Source `createIssue`, `applyLabel`, `updateIssueBody`, `findOpenUpgradeIssue` and `moveToStatus` from `providers.issueTracker`; delete the `createRepoContext` call at `:194` and the `../providers/repoContext` import. Keep `moveToStatus`'s best-effort `try/catch` + warn log verbatim.
- Drop `repoInfo` from those five `UpgradeGateDeps` signatures and from `runUpgradeGate`'s call sites. `UpgradeGateParams.repoInfo` stays — `claimUpgrade` still needs it.
- Update `adws/phases/__tests__/upgradeGate.test.ts` for the new dep signatures only.
- Run `bunx vitest run adws/phases/__tests__/upgradeGate.test.ts` — green.

### 11. Migrate `autoMergePhase.ts`

- Replace the `owner`/`repo`/`repoInfo` block with a single `if (!repoContext) { … return }` guard preserving the existing log message and `skip_reason.txt` write.
- Replace the five `adws/github` calls with `repoContext.issueTracker.fetchLabels(issueNumber).includes('hitl')`, `repoContext.codeHost.isPullRequestApproved(prNumber)`, `repoContext.issueTracker.addLabel(issueNumber, 'hitl')`, `repoContext.issueTracker.commentOnIssue(...)` and `repoContext.codeHost.commentOnPullRequest(...)`.
- `mergeWithConflictResolution` keeps its `repoInfo` argument — build it from `repoContext.repoId` at the call site only.
- Remove the now-unused `../github` import.

### 12. Migrate `reviewPhase.ts` and `prPhase.ts`

- `reviewPhase.ts`: replace `approvePR(prNumber, repoInfo)` with `repoContext.codeHost.approvePullRequest(prNumber)`, delete the `repoInfo` local and the `approvePR` import. Keep the `isGitHubAppConfigured() && GITHUB_PAT && ctx.prUrl` gate and the non-fatal warn path exactly as they are. Leave `executeReviewPatchCycle`'s `gitContextFor` alone.
- `prPhase.ts`: replace `gitCtx?.defaultBranch() ?? config.defaultBranch` with `repoContext ? repoContext.codeHost.getDefaultBranch() : config.defaultBranch`. Keep `gitCtx` for `pushBranch`/`commandEnv` and keep the `if (repoContext && gitCtx)` gate unchanged.
- Update `adws/phases/__tests__/reviewPhase.test.ts` only where the call shape changed.

### 13. Migrate `docsSelfCheck.ts` and `depauditSetup.ts`

- `docsSelfCheck.ts`: change `buildDefaultDocsSelfCheckDeps()` to take an `IssueTracker`; drop `repoInfo` from `DocsSelfCheckDeps.createIssue` and `findExistingRefactorIssue`; implement the lookup as `tracker.searchOpenIssues(\`docs-bloat: ${docPath}\`, 5)` keeping the `find(r => r.title.includes(docPath))` filter and the swallow-to-`null`. `DocsSelfCheckParams.repoInfo` may stay for callers, but nothing in this module may construct a context. Delete the `gitContextForRepo` and `createIssue` imports.
- `depauditSetup.ts`: replace the `gitContextForRepo` dep with `codeHost?: CodeHost` defaulting to `config.repoContext?.codeHost`; `propagateSecret` takes the code host and calls `setSecret`. With no code host, return `{propagated: false, warning: '<NAME> could not be propagated — no repo context for this run'}` so the secret lands in `skippedSecrets` exactly as an unset env var does. Delete the `GitContext` and `gitContextForRepo` imports.
- Update `adws/phases/__tests__/docsSelfCheck.test.ts` (the `vi.mock('../../github/gitContextFactory')` block becomes an `IssueTracker` double) and `adws/__tests__/depauditSetup.test.ts` (the `gitContextForRepo` seam becomes a `codeHost` seam). Keep every assertion about *what* was filed, logged or skipped.
- Run `bunx vitest run adws/phases/__tests__/docsSelfCheck.test.ts adws/__tests__/depauditSetup.test.ts` — green.

### 14. Close the remaining ad-hoc construction site (`adwPrReview` + `prReviewPhase`)

- `adwPrReview.tsx`: build `const boundary = buildLaunchBoundary(targetRepo);`, take `repoId` from `boundary.repoId` instead of `buildRepoIdentifier(targetRepo)`, and pass `boundary` to `initializePRReviewWorkflow` as a new trailing optional parameter.
- `prReviewPhase.ts`: accept `boundary?: LaunchBoundary`; pass `providers: boundary.providers` into `createRepoContext` when `boundary && sameRepoIdentity(repoIdForContext, boundary.repoId)`, mirroring `workflowInit.ts:311-317`. Keep the surrounding `try/catch` and its "falling back to direct API calls" log. Leave the `gitContextFor` at `:93` and the `fetchPRDetails`/`getUnaddressedComments` calls alone (#797).

### 15. Prove AC1 and AC2 with a repository-wide sweep

- Run the sweep from **Validation Commands** and confirm it prints nothing: no `adws/*.tsx` or `adws/phases/*.ts` file calls a forge-semantic `GitContext` method, and none constructs a provider or `RepoContext`.
- The only expected `gitContextForRepo` / `gitContextFor` / `gitContextForSync` survivors in those files are the git-only uses named in §7 and steps 12/14 — list them in the PR description so the reviewer can confirm each is a git operation, not a forge one.
- Run `bun run lint:git-guard` — green (AC4).

### 16. Write the RED-first BDD step definitions

- `features/per-issue/feature-796.feature` (tags `@adw-796 @adw-mk1wgc-migrate-orchestrator`) is authored by the scenario phase and is the authority on wording — implement against it, do not reword it.
- Write `features/per-issue/step_definitions/feature-796.steps.ts` covering the sections summarised in **Testing Strategy → BDD Scenarios**, reusing `features/per-issue/step_definitions/gitContextSharedWorld.ts` as `feature-794.steps.ts` does.
- The seams the feature file's testing notes name all exist on `LaunchGitContextDeps` (`launchGitContext.ts:42-66`) and need no production change: `mintProviders` (recording stand-ins for the triple), `getRepoInfo` (§7's "the local git remote was never read"), `tokenProvider`/`resolveToken` (§8's counting credential source), and `frameworkRepoRoot`/`targetReposDir` (the `mkdtempSync` throwaways). What the steps *do* need from production is the two exported deps builders from steps 7 and 8 — the composition under test is the orchestrator's own wiring, not hand-built `MergeDeps`.
- Honour the file's two hard constraints: the fixture repository is `adw-fixture/void-796` and must stay a non-repository (a RED run reaches the un-migrated free functions and shells out for real), and the four reused phrases (`the ADW codebase is checked out`, `the ADW TypeScript type-check passes`, `the git/gh guard is run across the repository`, `the git/gh guard reports no violations`) must not be redefined — that is an `AmbiguousStepDefinition`.
- `boundary.gitContext` has no injection seam, so §1/§3/§4's "the watched git context was asked for no forge-semantic operation" is driven by wrapping it in a `Proxy` whose `get` trap logs the forge-semantic member names (`gitContext.ts:492-742`) and forwards everything else.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-796"` — all scenarios pass, zero undefined steps.

### 17. Update the README

- Update the `adws/providers/**` and orchestrator/phase entries in `README.md` to describe the widened `IssueTracker`/`CodeHost` ports and the rule that orchestrators and phases receive providers from the launch boundary.
- Run `bunx tsx adws/checkLivingDocsIndex.ts` — green.

### 18. Run the Validation Commands

- Execute every command in **Validation Commands**, in order, and fix anything that is not green before declaring the slice done.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, and the PRD's Testing Decisions say the caller migration adds **no new caller tests** — the existing consumer suites are the regression net. So the unit work splits in two:

**New tests — the widened adapter only** (`adws/providers/github/__tests__/`):
- Delegation: each of the thirteen new methods calls exactly one `adws/github/*` wrapper, once, with the bound `repoInfo` and the caller's arguments, and returns its value unchanged.
- Policy separation: `addLabel` swallows a wrapper throw; `applyLabel` propagates it.
- `mapRawPRToSummary`: flattens `labels: [{name}]` to `string[]`, defaults a missing `labels` to `[]`, and carries `number`/`state`/`headRefName`/`baseRefName` across.
- Refusal: one `GitLabCodeHost` stub and one `JiraIssueTracker` stub each throw an error naming the method.

**Existing tests — call-shape updates only.** `adwMerge`, `adwUpgrade`, `upgradeGate`, `docsSelfCheck`, `depauditSetup`, `workflowInit` and `reviewPhase` suites change in exactly three ways: dep-double signatures lose their `repoInfo` parameter, `moveToStatus` doubles become async, and `workflowInit`'s `makeFakeBoundary` grows a `codeHost.getDefaultBranch`. **No assertion about behaviour may change.** If a suite goes red for any other reason, the migration changed behaviour and the code is wrong — do not update the expectation.

### BDD Scenarios

`features/per-issue/feature-796.feature` is already written and is the authority on wording — it holds 20 scenario blocks (21 rows, one being a two-example `Scenario Outline`) across nine sections. It proves, in the harness, what the unit suites cannot: that the *production* composition routes forge work through boundary-minted providers. Its stand-ins record `{operation, arguments}` rather than command strings, so what it pins is **which object performed the operation and on which identity**, not the `gh` argv — the argv is held constant structurally, by the delegation rule in **Notes**, and by the unchanged existing unit suites.

| § | Rows | What it pins | Where the plan satisfies it |
|---|---|---|---|
| §1 Merge orchestrator forge traffic | 4 | Completion and escalation comments come from the boundary's issue tracker; the `hitl` gate's label read and approval read go through providers; an approved PR still proceeds. Each row also asserts the watched `GitContext` saw **no** forge-semantic call. | Step 8 (`buildDefaultDeps(boundary)`; `issueHasLabel` → `fetchLabels(n).includes(...)`) |
| §2 Branch lookup sees non-open PRs | 2 (outline) + 1 | `MERGED` → `completed/already_merged` and `CLOSED` → `abandoned/pr_closed` still resolve, so `listOpenPullRequests` may not be substituted for the branch lookup; and a `wontfix` claim PR still releases the upgrade, so the projection must carry `labels`. | Solution §1's `PullRequestSummary` (`state` + `labels`), `findPullRequestByBranch` delegating to `defaultFindPRByBranch` (steps 3–4) |
| §3 Upgrade orchestrator stops minting | 3 | The claim PR is opened by the boundary's code host with no code host constructed outside the boundary; escalation reads comments, applies `adw:upgrade-escalated` and moves the board to `Blocked` through providers; a re-entered escalation applies no label and posts no comment. | Step 7 (`createGitHubCodeHost` deleted; every forge dep from the triple; `BoardStatus.Blocked`) |
| §4 Auto-merge phase gates | 2 | The `hitl` skip reads labels through the phase's own providers and writes nothing; the unapproved path reads the approval, applies `hitl` and comments "Awaiting human approval" — both with no forge-semantic `GitContext` call. | Step 11 (`repoContext.issueTracker` / `codeHost`; `addLabel`'s fail-open policy) |
| §5 Workflow init provider sourcing | 2 | Row 1: the providers handed back are the boundary's own instances and no repository identity is read. Row 2 is **unresolved** — see the ADW-WARNING in Solution §6. | Step 9 (`resolveWorkflowProviders`) for row 1; row 2 blocked on the warning's decision |
| §6 Non-GitHub tracker | 2 | A phase and an orchestrator handed a recording tracker that is not the GitHub adapter do all their forge work on *that* tracker, with no GitHub provider constructed. This is user story 4's payoff row and cannot be faked by renaming call sites. | Steps 8 and 11 — the migrated call sites name no `adws/github` function |
| §7 Wrong-repo invariant | 2 | A local git remote answering another repository cannot redirect traffic (and is never read); every recorded provider call about a PR names the PR the phase was configured with. | Bound providers carry no repo parameter (Solution §1); step 9 removes the identity re-read |
| §8 No credential at wiring time | 1 | *Building* the orchestrator's dependencies asks the credential source nothing — only running a command may. Protects #791's per-command resolution against a migration that resolves one token while it is wiring. | Steps 7–8: the deps builders close over providers only; no token is touched |
| §9 Structural backstops | 2 | The git/gh guard stays green (AC4 verbatim) and the ADW type-check passes. | Steps 15 and 18 |

Three things the feature file deliberately does **not** assert, and the plan must not add scenarios for them: that no `GitContext` is constructed during a migrated run (the adapter still constructs one internally — #797's wave); that a GitLab/Jira stub refuses by name (Solution §3's stubs are covered by unit tests in step 6, not BDD); and that `adwBuildHelpers.ts` is deleted or deduplicated (§7's second row pins only that the same PR is acted on, which is why leaving the helper alone is compatible with Solution §7).

### Edge Cases

- **No `repoContext` on a phase.** `autoMergePhase` skips with its existing log + `skip_reason.txt`; `prPhase` falls back to `config.defaultBranch` and takes its existing no-context diagnostic branch; `reviewPhase` skips approval; `depauditSetup` records both secrets as skipped with a warning and still returns `success: true`.
- **No boundary in `workflowInit`.** Unreachable in production (Solution §6); the guard clause throws with an actionable message rather than silently addressing a repository nobody chose.
- **Malformed comment payload in `adwUpgrade`.** `fetchComments` throws; the `try/catch` yields `[]`; the failure count is 0 and the run proceeds — identical to today's `parseIssueComments` behaviour.
- **Label missing when `applyLabel` runs.** `labelManager.applyLabel` lazy-creates and retries; in `adwUpgrade` this branch is unreachable because `ensureLabel` runs first.
- **PR lookup returns a PR with no labels.** `mapRawPRToSummary` yields `labels: []` and `hasWontFixLabelName([])` is `false` — the idempotency guard behaves as it does today.
- **Multiple PRs on one branch.** `defaultFindPRByBranch`'s `selectPreferredPR` (most-recently-updated OPEN, else most-recently-updated) is untouched — the provider returns the same choice.
- **Board move fails (no project).** `moveToStatus` resolves `false`; `adwUpgrade` ignores it and `upgradeGate` swallows it with its existing warn — no path treats it as fatal.
- **Non-GitHub platform selected.** `mintBoundProviders` still refuses an unimplemented platform by name at the first provider access; a GitLab code host reaching a stubbed operation throws naming it rather than no-oping.

## Acceptance Criteria

1. No file under `adws/*.tsx` or `adws/phases/*.ts` calls a forge-semantic method on a `GitContext` instance (`defaultBranch`, `fetchIssue`, `commentOnIssue`, `issueState`, `closeIssue`, `issueTitle`, `fetchIssueComments`, `issueHasLabel`, `addIssueLabel`, `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`, `deleteIssueComment`, `listOpenIssues`, `issueComments`, `fetchMergedPRs`, `authenticatedUser`, `findPRByBranch`, `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `mergePR`, `approvePR`, `prApprovalState`, `fetchPRList`, `fetchAllPRs`, `fetchPRChangedFiles`, `createPR`, `createLabel`, `applyLabel`, `setSecret`, `runGraphQL`, `runGraphQLInput`, `moveIssueToStatus`) — proven by the sweep in **Validation Commands**. `adws/healthCheck.tsx` is excluded by the argued scope decision in Solution §7.
2. No orchestrator or phase constructs a provider or a `RepoContext`: `createGitHubIssueTracker`, `createGitHubCodeHost`, `createGitHubBoardManager`, `mintBoundProviders` and `createRepoContext` appear in `adws/*.tsx` / `adws/phases/*.ts` only where a boundary-minted triple is passed in (`workflowInit.ts`, `prReviewPhase.ts`). On the `workflowInit` path with no caller-supplied `repoId`, both the identity and the provider instances come from the boundary and no local git remote is read. The one remaining branch where a second set can still be minted — a caller-supplied `repoId` contradicting the boundary — is governed by the ADW-WARNING in Solution §6 and must be resolved, one way or the other, before this criterion is claimed.
3. Every migrated operation reaches the forge through a provider that was minted by `buildLaunchBoundary` for this process, and no migrated call site passes a repository argument.
4. `bun run test:unit` is green, and the diff to existing test files contains only dep-signature/fixture updates — no changed assertion about behaviour.
5. `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint` and `bun run build` are green.
6. `bun run lint:git-guard` is green.
7. `@adw-796` passes with zero undefined steps, and `@regression` is green. All 20 scenario blocks run against the real composition: `buildDefaultDeps`, `buildDefaultUpgradeDeps` and `resolveWorkflowProviders` are exported, and no scenario is left pending.
8. `GitContext`'s semantic methods are unchanged and undeleted (that is #797), and `adws/providers/repoContext.ts` is unmodified.
9. `adws/providers/types.ts`, `githubIssueTracker.ts`, `githubCodeHost.ts` and every migrated phase file remain under the 300-line guideline.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

```bash
# Type safety (both projects)
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint + build
bun run lint
bun run build

# Full unit suite — the migration's regression net
bun run test:unit

# Guard: no raw git/gh outside the two exempt packages; no cwd-derived identity
bun run lint:git-guard

# AC1 sweep — must print NOTHING
grep -rnE '\.(defaultBranch|fetchIssue|commentOnIssue|issueState|closeIssue|issueTitle|fetchIssueComments|issueHasLabel|addIssueLabel|createIssue|updateIssueBody|findOpenUpgradeIssue|deleteIssueComment|listOpenIssues|issueComments|fetchMergedPRs|authenticatedUser|findPRByBranch|fetchPRDetails|fetchPRReviews|fetchPRReviewComments|commentOnPR|mergePR|approvePR|prApprovalState|fetchPRList|fetchAllPRs|fetchPRChangedFiles|createPR|createLabel|applyLabel|setSecret|runGraphQL|runGraphQLInput|moveIssueToStatus)\(' adws/phases/*.ts $(ls adws/*.tsx | grep -v healthCheck) | grep -E 'gitCtx|gitContext|ctx\.|Context\)' 

# AC2 sweep — provider construction only where a boundary triple is threaded in
grep -rnE 'createGitHub(IssueTracker|CodeHost|BoardManager)|mintBoundProviders|createRepoContext' adws/*.tsx adws/phases/*.ts

# BDD: this slice's proof, then the merged regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-796"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Living-docs index stays consistent after the README update
bunx tsx adws/checkLivingDocsIndex.ts
```

## Notes

- `.adw/coding_guidelines.md` applies throughout: single responsibility, files under 300 lines, immutability, explicit types over `any`, guard clauses over nesting, side effects at the edges. `adws/providers/repoContext.ts` is **exactly 300 lines** — it needs no change in this slice and must not grow.
- **No new libraries.** Everything needed exists; the install command, if it were ever needed, is `bun add <package>` per `.adw/commands.md`.
- **Deep-import rule (#792).** Import provider types and factories from `../providers/types` and `../providers/repoContext`, never the `../providers` barrel, from anything reachable by `adws/core` — the barrel re-exports the GitHub adapter and closes an import cycle. Orchestrators and phases already import the barrel-free paths; keep it that way.
- **Delegation is the behaviour contract.** Every new GitHub adapter method must delegate to the `adws/github/*` function that performs the operation today. Reimplementing a command string, a parse, or an error policy inside the adapter would break "same commands against the same repos" in a way no unit test would catch.
- **Two label methods are intentional.** `addLabel` (fail-open) and `applyLabel` (lazy-create, rethrow) are different failure contracts that live gates depend on. Collapsing them is a behaviour change, not a simplification.
- **Follow-on work, deliberately not here:** #795 adds the CI rule forbidding ad-hoc provider construction; #797 migrates `adws/core/**`, `adws/triggers/**` and the `adws/github/*` wrappers, then deletes `GitContext`'s semantic surface — at which point `workflowInit`'s boundary guard and the three wrappers added in step 3 become deletion targets.
- **Watch for the recurring worktree-birth reversion class.** This worktree was verified clean at plan time (`git diff origin/dev` empty, `HEAD == origin/dev`). Before committing, re-check `git diff origin/dev` for out-of-scope reverts of merged `.claude/` command files or README content and discard any on sight.
