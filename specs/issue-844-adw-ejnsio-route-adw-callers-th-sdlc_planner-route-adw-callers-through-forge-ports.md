# Feature: Route ADW callers through the forge ports before the devplatform switchover

## Metadata
issueNumber: `844`
adwId: `ejnsio-route-adw-callers-th`
issueJson: `{"number":844,"title":"Route ADW callers through the forge ports before the devplatform switchover","body":"**Parent PRD:** `specs/prd/gitcontext-library-extraction.md`. Runbook: `specs/runbooks/gitcontext-extraction.md`. Unblocks the ADW switchover (issue 840, kept open on purpose), whose first build stopped because ADW still reaches around the forge ports into the GitHub adapter and into git-core internals. Everything below is ADW-side and needs nothing new from the library; the launch boundary itself is untouched here and moves to the library's forge-keyed credential factory in the switchover issue.\n\n## What to build\n\n1. **Route the three raw-GitHub call sites through the ports.**\n   - `adws/core/issueRecord.ts`: replace `createGhRepoApi(ctx).fetchIssue` + `parseGitHubIssue` with the `IssueTracker.fetchIssue` port. Callers receive the port through the launch boundary's `BoundProviders`; thread it rather than constructing anything.\n   - `adws/forge/hitlBoardNotifier.ts`: replace the bound repo API (`fetchIssue`, `fetchAllPRs`) and `selectPreferredPR` with `IssueTracker.fetchIssue` and `CodeHost.listPullRequests` / `findPullRequestByBranch`. If the preferred-PR choice (open over merged, newest first) is not expressible on the port's `PullRequestRecord`, add the missing field to the domain model in `adws/providers/types.ts` and both adapters, not a GitHub-only helper.\n   - `adws/healthCheckChecks.ts`: `authenticatedUser()` → `CodeHost.getAuthenticatedUser()`; `fetchIssue` → `IssueTracker.fetchIssue`.\n2. **Local repo identity without the GitHub adapter.** Replace every `readLocalRepoInfo` import (`orchestratorCli`, `healthCheck.tsx`, `pauseQueueScanner`, `trigger_cron`, `launchGitContext`'s default) with an ADW-owned `readLocalRepoIdentity(cwd?)` in `adws/core/` composed from `readOriginRemoteUrl` (git core) and `parseOwnerRepoFromUrl` (provider types, host-neutral). Same error message on failure.\n3. **SSH clone URL without the GitHub adapter.** `adws/core/targetRepoManager.ts`: replace `convertToSshUrl` with a host-neutral conversion (`https://<host>/<owner>/<repo>[.git]` → `git@<host>:<owner>/<repo>.git`, anything else passed through) owned by ADW. Keep the re-export name so existing callers compile, or update them.\n4. **Delete ADW tests of library internals.** `adws/vcs/__tests__/commitOperations.test.ts` and `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` test `commitOps`/`branchOps` that now live in `@paysdoc/devplatform`; delete them. `features/regression/step_definitions/feature-818.steps.ts` and `feature-820.steps.ts` instantiate `GitLabApiClient` directly; rewrite those steps against the `CodeHost` port or drop the scenario steps that exist only to prove the extracted module's shape, and update the matching `.feature` files. Regression tag counts must not regress for anything else.\n5. **Guard.** No new `git`/`gh` shell-out anywhere; `lint:git-guard` unchanged and green.\n\nAfter this issue, the only ADW imports that resolve into `adws/providers/github/**` or `adws/providers/gitlab/**` are test fixtures and `adws/core/launchGitContext.ts`, which the switchover issue replaces.\n\n## Acceptance criteria\n- [ ] `git grep -l \"providers/github\\|providers/gitlab\\|providers/jira\" -- adws features test ':!adws/providers' ':!**/__tests__/**'` lists only `adws/core/launchGitContext.ts` and `adws/core/githubAppAuth.ts`\n- [ ] No non-test import of `adws/gitContext/<module>`; only the barrel\n- [ ] Unit suite, typecheck, `lint:git-guard`, `lint:docs-index`, BDD regression green\n- [ ] Living docs for `issueRecord`, `hitlBoardNotifier`, `healthCheck`, `targetRepoManager` updated where they describe the removed helpers\n\n## Blocked by\nnone\n","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-09-10T15:00:02Z","comments":[],"actionableComment":null}`

## Feature Description

Issue 840 (the one-shot switchover of ADW onto the published `@paysdoc/devplatform` library) stopped at its
Step 1 gate because the published `1.0.0` barrels do not export the adapter internals ADW still reaches
for directly: `createGhRepoApi`, `parseGitHubIssue`, `selectPreferredPR`, `readLocalRepoInfo`,
`convertToSshUrl`, `GitLabApiClient`, `commitOps`, `isLeaseRejection` and `branchOps` (see the build
comment on issue 840). Every one of those reaches *around* the forge ports (`IssueTracker`, `CodeHost`)
into the GitHub adapter or into git-core modules. The launch boundary's own credential imports
(`createGitHubTokenProvider`, `resolveContextToken`, `ghAuthToken`, `resolveBootstrapGitIdentity`,
GitHub App auth) are a separate concern that devplatform issue 9's `createForgeCredentials` handles in
issue 840, which is why `adws/core/launchGitContext.ts` and `adws/core/githubAppAuth.ts` are exempt here.

This feature removes every other ADW-side reach-around so that, after it merges, production ADW code
sees the extractable packages only through: the `adws/gitContext` barrel, the ports and domain model in
`adws/providers/types.ts`, the host-neutral `parseOwnerRepoFromUrl` in `adws/providers/workspaceValidation.ts`,
and the assembly contract in `adws/providers/forgeProviders.ts`. Concretely:

1. The workflow's issue record, the HITL Slack notifier and the health-check probes read through the
   boundary's `IssueTracker`/`CodeHost` ports instead of `createGhRepoApi(ctx)`.
2. ADW owns its own local-repo identity reader (`readLocalRepoIdentity`) and its own host-neutral
   HTTPS-to-SSH clone URL conversion, composed from git-core and host-neutral helpers only.
3. ADW's unit tests of `commitOps`/`branchOps` (library internals) are deleted, and the two per-issue BDD
   step-definition files that construct `GitLabCodeHost`/`JiraIssueTracker` with a fake `GitLabApiClient`
   are rewritten against the ports or trimmed.
4. Living docs describing the removed helpers are updated, and the git/gh guard learns the new
   cwd-derived identity name so the wrong-repo firewall keeps covering it.

No library code (`adws/gitContext/**`, `adws/providers/**`) changes. The port's `PullRequestRecord` and
`Issue` shapes are sufficient once the ADW-side selection is expressed on them (see Solution Statement
for the two informational prompt fields that are dropped as a consequence).

## User Story

As a framework developer preparing the devplatform switchover
I want every ADW caller to reach forge and git functionality only through the published library's
public surface (ports, domain model, assembly function, git-core barrel)
So that issue 840 can rewrite imports to `@paysdoc/devplatform` mechanically, without ADW depending on
adapter internals the library deliberately does not export.

## Problem Statement

`git grep` over non-test ADW code shows these production imports resolving into adapter modules:

| File | Adapter import | Why it blocks 840 |
|---|---|---|
| `adws/core/issueRecord.ts` | `createGhRepoApi`, `parseGitHubIssue`, `GitHubIssue` | not exported by `@paysdoc/devplatform/providers` |
| `adws/forge/hitlBoardNotifier.ts` | `createGhRepoApi`, `selectPreferredPR` | same |
| `adws/healthCheckChecks.ts` | `createGhRepoApi` | same |
| `adws/core/orchestratorCli.ts`, `adws/healthCheck.tsx`, `adws/triggers/pauseQueueScanner.ts`, `adws/triggers/trigger_cron.ts`, `adws/core/launchGitContext.ts` | `readLocalRepoInfo` | same |
| `adws/core/targetRepoManager.ts` | `convertToSshUrl` | same |
| `adws/agents/{buildAgent,gitAgent,planAgent,scenarioAgent}.ts`, `adws/core/{adwLabels,issueClassifier,workflowCommentParsing}.ts`, `adws/phases/{branchNameResolution,prReviewPhase,workflowInit}.ts` | `GitHubIssue` / `GitHubLabel` / `GitHubComment` types from `providers/github/domain/issue` | a direct consequence of `fetchIssueRecord` returning the GitHub payload shape instead of the port's `Issue` |
| `adws/core/forgeWiring.ts` | `GitLabConfig`, `JiraAuth`, `JiraConfig` types from the GitLab/Jira adapters | expressible through `ForgeProviderDeps` on the assembly contract instead |

Besides these, `adws/healthCheck.tsx` and `adws/healthCheckChecks.ts` deep-import `./gitContext/gitContext`
instead of the barrel, `adws/promotion/promotionStatsLoader.ts` spells the barrel as `../gitContext/index.ts`,
two `adws/vcs/__tests__` files unit-test `adws/gitContext/commitOps` and `branchOps`, and the per-issue
step definitions `features/per-issue/step_definitions/feature-818.steps.ts` and `feature-820.steps.ts`
construct adapter classes with `{} as GitLabApiClient` / `{} as JiraApiClient` (note: the issue body
places these two files under `features/regression/`; they actually live under `features/per-issue/`,
and cucumber imports every per-issue step-definition file on every run, so a broken import there would
take the regression run down after the switchover).

## Solution Statement

Thread the boundary's ports; construct nothing; add nothing to the library.

- **Issue record on the port.** `fetchIssueRecord(issueTracker, issueNumber)` becomes a thin delegation
  to `IssueTracker.fetchIssue` and returns the port's `Issue`. `WorkflowConfig.issue` and every consumer
  are typed on `Issue` (string `author`, string `labels`, `IssueComment` comments with string `author`).
  The GitHub tracker already wraps failures as `Failed to fetch issue #N: …`, so the helper must not wrap
  again. Two informational fields the port does not carry, the issue's own `createdAt` and `url`, are
  dropped from the plan/scenario/build prompts (comment timestamps stay; `IssueComment.createdAt` exists).
  This is the conservative reading of "needs nothing new from the library"; the alternative (adding
  `createdAt`/`url` to `Issue` in `adws/providers/types.ts` plus both mappers) would require a devplatform
  release before issue 840 can compile and is recorded in Notes for the human reviewer.
- **Mint timing.** Reading the issue through the port is the first `boundary.providers` access in
  `initializeWorkflow`, and today that read happens *before* `ensureTargetRepoWorkspace`. The lazy mint
  reads `.adw/providers.md` from the workspace path, so on a first-clone target run it would silently
  default to GitHub and memoise that for the whole run. The workspace-ensure block therefore moves ahead
  of the issue fetch (it depends only on `targetRepo`, and its `getDefaultBranch` thunk still runs only
  on the already-cloned branch).
- **Notifier on the ports.** `buildNotifierDeps` takes a thunk resolving to `{ issueTracker, codeHost }`
  (a `Pick` of `BoundProviders`) plus the `RepoIdentifier`. `readIssue` awaits `IssueTracker.fetchIssue`
  and returns `{ title, labels: string[] }`; `listOpenPRs` filters `CodeHost.listPullRequests()` to
  `state === 'OPEN'`. The preferred-PR choice is expressible without a new field: the port contract
  already returns PRs newest first, and the legacy `selectPreferredPR` call ran over OPEN-only entries
  with empty `updatedAt` (a no-op sort), so "first OPEN entry whose body links the issue" is the same
  outcome. The thunk exists because `forgeWiring.ts` builds these deps *while* `forgeProviders` is
  assembling the very providers they read; it is only invoked at notification time.
- **Health check on the ports.** `checkGitHubCLI(codeHost)` and `checkIssueNumber(issueNumber, issueTracker)`
  take port `Pick`s; `checkIssueNumber` becomes async. `checkGitRepository(ctx)` keeps its `GitContext`
  (git reads are the core's job). `healthCheck.tsx` and the webhook `/health` endpoint pass the boundary's
  providers, degrading gracefully if the lazy mint throws.
- **ADW-owned identity and clone URL.** New `adws/core/localRepoIdentity.ts` composes
  `readOriginRemoteUrl` (gitContext barrel) with `parseOwnerRepoFromUrl` (host-neutral) and keeps the
  outer `Failed to get repo info: …` wrap. New `adws/core/sshCloneUrl.ts` converts
  `https://<host>/<owner>/<repo>[.git]` to `git@<host>:<owner>/<repo>.git` via `URL` parsing and passes
  everything else through. `readLocalRepoIdentity` joins the guard's `CWD_DERIVED_IDENTITY_FNS` so the
  cwd-derived-identity rule still fires on it.
- **Tests of library internals.** Delete the two `adws/vcs/__tests__` files. In the per-issue BDD files,
  drop the three feature-818 scenarios that exist only to prove adapter constructor arity, and rewrite
  feature-820's refusal-by-name outline to obtain its GitLab/Jira ports through `forgeProviders` (the
  sanctioned assembly) instead of `new GitLabCodeHost(...)`/`new JiraIssueTracker(...)`.

## Relevant Files

Use these files to implement the feature:

- `README.md` - project overview; line 17 and 22 narrate the `createGhRepoApi` route and forge helpers (optional one-line touch)
- `.adw/coding_guidelines.md` - guidelines to follow (guard clauses, max nesting 2, files under 300 lines, no `any`)
- `.adw/commands.md`, `.adw/scenarios.md`, `.adw/review_proof.md` - validation commands, BDD tag runner, review proof rules
- `specs/prd/gitcontext-library-extraction.md` - parent PRD (de-tangling wave, switchover contract)
- `specs/runbooks/gitcontext-extraction.md` - runbook; A1 (issue 840) description of what the switchover rewrites
- `adws/core/issueRecord.ts` - `fetchIssueRecord`; becomes the port delegation returning `Issue`
- `adws/core/__tests__/issueRecord.test.ts` - rewrite against a fake `IssueTracker`
- `adws/phases/workflowInit.ts` - `WorkflowConfig.issue` type, the issue fetch, the workspace-ensure ordering
- `adws/phases/__tests__/workflowInit.test.ts` - `fetchIssueRecord` mock, `fakeIssue` fixture
- `adws/agents/planAgent.ts`, `adws/agents/scenarioAgent.ts`, `adws/agents/buildAgent.ts`, `adws/agents/gitAgent.ts` - retype on `Issue`; drop `author.login`/`labels[].name`/`createdAt`/`url` reads
- `adws/agents/__tests__/gitAgent.test.ts` - `mockIssue` fixture
- `adws/core/adwLabels.ts`, `adws/core/__tests__/adwLabels.test.ts` - `readAdwLabels`, `scenarioAuthoringSkipReason`, `shouldSkipScenarioAuthoring` on string labels
- `adws/core/issueClassifier.ts`, `adws/core/__tests__/issueClassifier.test.ts` - `classifyGitHubIssue` on `ClassifiableIssue`
- `adws/core/workflowCommentParsing.ts` - `detectRecoveryState` on `IssueComment[]`
- `adws/phases/branchNameResolution.ts`, `adws/phases/__tests__/branchNameResolution.test.ts` - `issue: Issue`
- `adws/phases/prReviewPhase.ts` - `issueStub` on `Issue`
- `adws/phases/__tests__/reviewPhase.test.ts`, `adws/phases/__tests__/promotionRotAdvisory.test.ts`, `adws/phases/__tests__/scenarioTestPhase.test.ts` - `WorkflowConfig.issue` fixtures
- `adws/phases/scenarioPhase.ts`, `adws/phases/alignmentPhase.ts` - callers of `scenarioAuthoringSkipReason(issue.labels)` (compile-only change)
- `.claude/commands/scenario_writer.md` - documents the issue JSON keys (`createdAt` goes)
- `adws/forge/hitlBoardNotifier.ts`, `adws/forge/__tests__/hitlBoardNotifier.test.ts` - port-based readers, thunk-based `buildNotifierDeps`
- `adws/core/forgeWiring.ts`, `adws/core/__tests__/forgeWiring.test.ts` - `adwGitHubForgeDeps`/`buildAdwForgeDeps` take the provider thunk; config types via `ForgeProviderDeps`
- `adws/core/launchGitContext.ts`, `adws/core/__tests__/launchGitContext.test.ts` - `forgeDeps` seam signature, `() => boundary.providers`, default identity reader
- `adws/adwMerge.tsx`, `adws/adwPrReview.tsx`, `adws/phases/prReviewCompletion.ts`, `adws/phases/workflowCompletion.ts` - `buildNotifierDeps` call sites
- `adws/phases/__tests__/prReviewCompletion.test.ts`, `adws/__tests__/adwMerge.test.ts` - notifier expectations
- `adws/healthCheckChecks.ts`, `adws/healthCheck.tsx`, `adws/__tests__/healthCheckChecks.test.ts` - port-based probes
- `adws/triggers/trigger_webhook.ts` - `/health` endpoint passes the boundary's code host
- `adws/triggers/webhookRepoResolver.ts` - `selfHostBoundary()` (read only, to see its return type)
- `adws/core/orchestratorCli.ts`, `adws/triggers/pauseQueueScanner.ts`, `adws/triggers/trigger_cron.ts` - `readLocalRepoIdentity` callers
- `adws/triggers/__tests__/pauseQueueScanner.test.ts`, `adws/triggers/__tests__/trigger_cron.test.ts` - re-point the `githubIdentity` mocks
- `adws/triggers/cronRepoResolver.ts` - `resolveCronRepo(args, fallback)` contract (read only)
- `adws/core/targetRepoManager.ts` - drop the adapter import; re-export the ADW-owned `convertToSshUrl`
- `adws/core/index.ts` - export `readLocalRepoIdentity`
- `adws/core/workspaceBinding.ts` - precedent for importing `parseOwnerRepoFromUrl` from `../providers/workspaceValidation`
- `adws/providers/workspaceValidation.ts`, `adws/gitContext/bootstrapIdentity.ts`, `adws/gitContext/index.ts` - read only: `parseOwnerRepoFromUrl`, `readOriginRemoteUrl`, barrel exports
- `adws/providers/types.ts`, `adws/providers/forgeProviders.ts` - read only: `Issue`, `IssueComment`, `PullRequestRecord`, `BoundProviders`, `ForgeProviderDeps`
- `adws/providers/github/githubIdentity.ts`, `adws/providers/github/cloneUrl.ts`, `adws/providers/github/__tests__/cloneUrl.test.ts`, `adws/providers/github/__tests__/githubIdentity.test.ts` - read only: behaviour and test cases to mirror in the ADW-owned replacements (library files stay untouched)
- `adws/guard/identityRule.ts`, `adws/__tests__/checkGitGhGuard.test.ts` - add `readLocalRepoIdentity` to `CWD_DERIVED_IDENTITY_FNS`, rule tests, guarded-name row
- `adws/promotion/promotionStatsLoader.ts` - normalise `../gitContext/index.ts` to the barrel specifier
- `adws/vcs/__tests__/commitOperations.test.ts`, `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` - delete
- `features/per-issue/step_definitions/feature-818.steps.ts`, `features/per-issue/feature-818.feature` - drop the constructor-arity scenarios and their steps
- `features/per-issue/step_definitions/feature-820.steps.ts`, `features/per-issue/feature-820.feature` - port-based refusal outline; string labels in `buildWorkflowConfig`
- `features/per-issue/step_definitions/gitContextSharedWorld.ts` - precedent for constructing a fixture `GitContext` with an `exec` fake (read only)
- `cucumber.js` - confirms per-issue step definitions are imported on every run (read only)
- `.adw/conditional_docs.md` - `Owns:` lists and `Conditions:` for the touched modules
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` - describes `fetchIssueRecord` (GitHub shape), `readLocalRepoInfo` in the boundary, `adwGitHubForgeDeps(repoId, ctx)`, `CWD_DERIVED_IDENTITY_FNS`
- `app_docs/feature-9gjajh-github-api.md` - describes `buildNotifierDeps(ctx, repoId)` over `createGhRepoApi` and where `readLocalRepoInfo` lives
- `app_docs/feature-9gjajh-health-check.md` - describes the `createGhRepoApi` probes and unchanged signatures
- `app_docs/feature-9gjajh-dev-server-and-ports.md` - owns `targetRepoManager.ts`
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` - describes `fetchIssueRecord(boundary.gitContext, …)` and `buildNotifierDeps(gitContext, repoId)`
- `app_docs/feature-9gjajh-classifier-and-routing.md` - describes `classifyGitHubIssue`
- `app_docs/feature-9gjajh-worktree-and-vcs.md` - owns `adws/vcs/**`; mentions the vcs tests
- `app_docs/feature-9gjajh-claude-stream-parser.md` - owns `orchestratorCli.ts`

### New Files

- `adws/core/localRepoIdentity.ts` - `readLocalRepoIdentity(cwd?, deps?)`, ADW-owned, host-neutral parse, `Platform.GitHub` identity
- `adws/core/__tests__/localRepoIdentity.test.ts` - injected-reader contract tests plus the real-git dotted-name proof mirrored from `githubIdentity.test.ts`
- `adws/core/sshCloneUrl.ts` - `convertToSshUrl(cloneUrl)`, host-neutral, `URL`-based
- `adws/core/__tests__/sshCloneUrl.test.ts` - the `cloneUrl.test.ts` cases plus host-neutral and pass-through edge cases

## Implementation Plan

### Phase 1: Foundation

Build the two ADW-owned replacements first, because every later step points at them: `readLocalRepoIdentity`
(with its guard registration) and the host-neutral `convertToSshUrl`. Both are pure-ish modules with their
own unit tests and no dependency on the rest of the change. Capture the baseline numbers the acceptance
criteria compare against (regression scenario/tag counts, guard output, the two import greps).

### Phase 2: Core Implementation

Route the three raw-GitHub call sites through the ports. Order matters: the issue record first (it
retypes `WorkflowConfig.issue` and cascades into agents, labels, classifier, phases and their fixtures),
then the notifier (it changes `forgeWiring` and the launch-boundary `forgeDeps` seam), then the health
checks (self-contained). Re-point the `readLocalRepoInfo` callers and `targetRepoManager` onto the
Phase 1 modules, and express `forgeWiring`'s config types through `ForgeProviderDeps`.

### Phase 3: Integration

Delete the library-internal unit tests, trim/rewrite the two per-issue BDD step-definition files and
their feature files, normalise the remaining non-barrel `gitContext` specifiers, update the living docs
and the conditional-docs index (new files into `Owns:`), then run the full validation set and the two
acceptance greps.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1: Capture the baseline

- Run `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit`, `bun run lint:git-guard`, `bun run lint:docs-index` and confirm all green before touching anything.
- Record the regression baseline: `git grep -c "@regression" -- 'features/regression/**/*.feature'` summed (46 occurrences today) and `git grep -c "^\s*Scenario" -- 'features/regression/**/*.feature'` summed (53 scenarios today). These numbers must be identical at the end.
- Record `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` pass/fail/pending counts (the 840 review recorded pre-existing pending/undefined scenarios on `dev`; the goal is zero *new* failures).
- Record the current output of the precise import grep in the Acceptance Criteria section (it lists ~24 production files today).

### Step 2: Add `adws/core/localRepoIdentity.ts` and register it with the guard

- Create `adws/core/localRepoIdentity.ts` exporting `readLocalRepoIdentity(cwd?: string, deps: { readRemoteUrl?: (cwd?: string) => string } = {}): RepoIdentifier`.
  - Compose `deps.readRemoteUrl ?? readOriginRemoteUrl` (import from `'../gitContext'`, the barrel) with `parseOwnerRepoFromUrl` (import from `'../providers/workspaceValidation'`, as `workspaceBinding.ts` does) and `Platform` from `'../providers/types'`.
  - Return `{ owner, repo, platform: Platform.GitHub }`. Document in the JSDoc that the platform is ADW's launch-identity convention (the same hard-coded value `buildRepoIdentifier` and `resolveCronRepo` use) and that forge selection comes from `.adw/providers.md`, not from the remote host.
  - Error contract: one `try/catch` spanning both the read and the parse; on a null parse throw `Could not parse owner/repo from remote URL: ${remoteUrl}`; the outer wrap is verbatim `Failed to get repo info: ${error}` (the legacy message).
- Create `adws/core/__tests__/localRepoIdentity.test.ts`:
  - Injected-reader cases: HTTPS and SCP-style SSH remotes, dotted repo names (`paysdoc/paysdoc.nl`, with and without `.git`), a trailing slash, a credential-bearing HTTPS remote, a non-GitHub host (`https://gitlab.com/acme/webapp.git` → `{ acme, webapp, GitHub }`, a deliberate change from `readLocalRepoInfo`, which threw), a garbage remote → `/Failed to get repo info/` and the inner `Could not parse owner/repo` text, a throwing reader → `/Failed to get repo info/`.
  - One real-git end-to-end case mirrored from `githubIdentity.test.ts` (temp dir, `git init`, `git remote add origin git@github.com:paysdoc/paysdoc.nl.git`, `readLocalRepoIdentity(tempDir)`), so the #779 dotted-name proof survives the deletion of `adws/providers` in issue 840. The guard skips `__tests__`, so the fixture shell-out is permitted.
- `adws/guard/identityRule.ts`: add `'readLocalRepoIdentity'` to `CWD_DERIVED_IDENTITY_FNS`; update the header and the set's doc comment ("three names").
- `adws/__tests__/checkGitGhGuard.test.ts`: add rule tests mirroring the existing `readLocalRepoInfo` ones (`gitContextForRepo(readLocalRepoIdentity())` flagged, `forgeProviders({ identity: readLocalRepoIdentity() })` flagged, the local-variable form flagged, `readLocalRepoIdentity(REPO_ROOT)` permitted); add a row `{ name: 'readLocalRepoIdentity', file: 'adws/core/localRepoIdentity.ts', declPattern: /export function readLocalRepoIdentity\(/ }` to the "guarded factory names still exist" table. Keep the `readLocalRepoInfo` row: its declaration still exists in the adapter until issue 840.
- Export `readLocalRepoIdentity` from `adws/core/index.ts` (next to the launch-boundary exports).

### Step 3: Re-point every `readLocalRepoInfo` caller

- `adws/core/launchGitContext.ts`: default `deps.getRepoInfo ?? readLocalRepoIdentity` (import `./localRepoIdentity`); drop `readLocalRepoInfo` from the `githubIdentity` import line (keep `resolveBootstrapGitIdentity`, which issue 840 replaces); update the `LaunchGitContextDeps.getRepoInfo` JSDoc.
- `adws/core/orchestratorCli.ts`: `buildRepoIdentifier` reads `readLocalRepoIdentity()` from `./localRepoIdentity`.
- `adws/healthCheck.tsx`: `getRepoInfo: () => readLocalRepoIdentity(REPO_ROOT)` (import from `./core`); the explicit argument keeps the guard satisfied.
- `adws/triggers/pauseQueueScanner.ts` and `adws/triggers/trigger_cron.ts`: deep-import `readLocalRepoIdentity` from `'../core/localRepoIdentity'` (not the `../core` barrel, so the tests' full-replacement `vi.mock('../../core', …)` stays untouched); `resolveCronRepo(process.argv.slice(2), readLocalRepoIdentity)` passes the reference unchanged.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` and `adws/triggers/__tests__/trigger_cron.test.ts`: replace `vi.mock('../../providers/github/githubIdentity', …)` with `vi.mock('../../core/localRepoIdentity', () => ({ readLocalRepoIdentity: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo', platform: 'github' })) }))`.
- Verify with `git grep -n "readLocalRepoInfo" -- adws ':!adws/providers'` that only the guard's name set, its tests and the `githubIdentity` adapter remain.

### Step 4: Add `adws/core/sshCloneUrl.ts` and rewire `targetRepoManager`

- Create `adws/core/sshCloneUrl.ts` exporting `convertToSshUrl(cloneUrl: string): string`:
  - Parse with `new URL(cloneUrl)` inside a guard (`try`/`catch` → return the input unchanged: covers `''`, `git@host:owner/repo.git`, and any non-URL string).
  - Pass through unchanged unless `protocol === 'https:'`, `port === ''`, and `pathname.split('/').filter(Boolean)` has exactly two segments.
  - Strip only a trailing `.git` from the second segment (dotted names such as `paysdoc.nl` survive) and return `git@${hostname}:${owner}/${repo}.git`. `hostname` drops any userinfo (`https://x-access-token:…@github.com/…` converts to the credential-free SSH form, as the old GitHub-only helper did).
- Create `adws/core/__tests__/sshCloneUrl.test.ts` mirroring every case in `adws/providers/github/__tests__/cloneUrl.test.ts` (GitHub HTTPS with/without `.git`, already-SSH unchanged, `ssh://` unchanged, dotted names, hyphens and dots, empty string) and adding: a GitLab HTTPS URL now converts (`https://gitlab.com/acme/webapp.git` → `git@gitlab.com:acme/webapp.git`), a self-hosted host converts, a URL with an explicit port passes through, a three-segment path (GitLab subgroup) passes through, `http://` passes through, a credential-bearing GitHub HTTPS URL converts without the credential.
- `adws/core/targetRepoManager.ts`: import `convertToSshUrl` from `./sshCloneUrl` instead of `../providers/github/cloneUrl`; keep `export { isRepoCloned, convertToSshUrl }`; rewrite the header comment (the conversion is ADW-owned and host-neutral since #844; the core still clones exactly the URL it is handed).

### Step 5: Route the workflow issue record through `IssueTracker.fetchIssue`

- `adws/core/issueRecord.ts`: `fetchIssueRecord(issueTracker: Pick<IssueTracker, 'fetchIssue'>, issueNumber: number): Promise<Issue>` returning `issueTracker.fetchIssue(issueNumber)` with no additional wrap (the GitHub tracker already throws `Failed to fetch issue #N: …`; wrapping again would double the prefix). Remove the three adapter imports; rewrite the header to say the record is the port's `Issue`, read through the boundary's tracker, and that the GitHub-shaped record is gone as of #844.
- `adws/core/__tests__/issueRecord.test.ts`: rewrite against a fake tracker (no `GitContext`, no exec): delegates with the issue number, returns the tracker's `Issue` untouched, propagates the tracker's rejection message unchanged (assert it is not double-prefixed).
- `adws/phases/workflowInit.ts`:
  - `WorkflowConfig.issue: Issue` (import `Issue` from `'../providers/types'`; drop the `GitHubIssue` import).
  - Move the "Setup target repo workspace" block (the `ensureTargetRepoWorkspace` call and the `targetRepo.workspacePath` assignment) to immediately after the GITHUB_PAT startup validation and before the issue fetch, so the first `boundary.providers` access happens after the workspace and its `.adw/providers.md` exist on a first-clone target run. Keep `ensureLogsDirectory` where it is. Add a comment explaining the ordering constraint (lazy mint reads provider config from `gitContext.basePath`).
  - `const issue = await fetchIssueRecord(boundary.providers.issueTracker, issueNumber);` and update the log line ("Fetching issue…").
- `adws/phases/__tests__/workflowInit.test.ts`: reshape `fakeIssue` to the port `Issue` (`id`, `number`, `title`, `body`, `state`, `author: 'test'`, `labels: []`, `comments: []`); assert `fetchIssueRecord` is called with the fake boundary's `providers.issueTracker`; if any test asserts call order between the issue fetch and `ensureTargetRepoWorkspace`, update it to the new order.
- `adws/agents/planAgent.ts`: `formatIssueContextAsArgs(issue: Issue)` and `runPlanAgent(issue: Issue, …)`: `**Author:** ${issue.author}`, `**Labels:** ${issue.labels.join(', ') || 'none'}`, drop the `**Created:**` line, comments render `**${c.author}** (${c.createdAt})`; `issueJson` uses `author: issue.author`, `labels: issue.labels`, comment `author: c.author`, and no `createdAt` key.
- `adws/agents/scenarioAgent.ts`: same `issueJson` shape change; `issue: Issue`.
- `adws/agents/buildAgent.ts`: `issue: Issue`; drop the `Issue URL` log line and the `**URL:**` prompt line (the port carries no URL; `#number` and title remain).
- `adws/agents/gitAgent.ts`: `issue: Issue` in `formatBranchNameArgs` and `runGenerateBranchNameAgent` (`JSON.stringify(issue)` is unchanged).
- `adws/agents/__tests__/gitAgent.test.ts`: reshape `mockIssue` to the port `Issue`.
- `adws/core/adwLabels.ts`: `readAdwLabels(issue: Pick<Issue, 'labels'>)` → `readAdwLabelNames(issue.labels)`; `scenarioAuthoringSkipReason(labels: readonly string[])` and `shouldSkipScenarioAuthoring(labels: readonly string[])` build the name set directly; drop the `GitHubIssue`/`GitHubLabel` import. `adws/core/__tests__/adwLabels.test.ts`: `makeIssue` returns `{ labels: string[] }`; drop the `GitHubLabel` import and `makeLabel`.
- `adws/core/issueClassifier.ts`: `classifyGitHubIssue(issue: ClassifiableIssue)` (the existing `Pick<Issue, 'number'|'title'|'body'|'labels'|'comments'>` alias); `labelsText = issue.labels.join(', ') || 'none'`; drop the `GitHubIssue` import. `adws/core/__tests__/issueClassifier.test.ts`: `makeIssue` builds a `ClassifiableIssue`; drop the `GitHubIssue` import.
- `adws/core/workflowCommentParsing.ts`: `detectRecoveryState(comments: readonly IssueComment[])` (import from `'../providers/types'`); the body reads only `body` and `createdAt`, so no logic changes.
- `adws/phases/branchNameResolution.ts`: `issue: Issue` in both arg shapes. `adws/phases/__tests__/branchNameResolution.test.ts`: reshape `defaultArgs.issue`.
- `adws/phases/prReviewPhase.ts`: `issueStub: Issue = { id: String(prNumber), number: prNumber, title: pr.title, body: pr.body, state: 'open', author: '', labels: [], comments: [] }`; drop the `GitHubIssue` import.
- Reshape the remaining `WorkflowConfig.issue` fixtures: `adws/phases/__tests__/reviewPhase.test.ts`, `adws/phases/__tests__/promotionRotAdvisory.test.ts` (`makeIssue(labels: string[])`), `adws/phases/__tests__/scenarioTestPhase.test.ts`, and `adws/__tests__/healthCheckChecks.test.ts` (handled in Step 7).
- `.claude/commands/scenario_writer.md` line 12: remove `createdAt` from the documented issue JSON keys.
- Confirm `git grep -n "GitHubIssue\|GitHubLabel\|GitHubComment" -- adws ':!adws/providers'` returns only guard-test fixture strings (`checkGitGhGuard.test.ts`, `extractionRule.test.ts`).

### Step 6: Route the HITL board notifier through the ports

- `adws/forge/hitlBoardNotifier.ts`:
  - Export `type NotifierPorts = { issueTracker: Pick<IssueTracker, 'fetchIssue'>; codeHost: Pick<CodeHost, 'listPullRequests'> }` (both `BoundProviders` and `RepoContext` are assignable).
  - `HitlIssueInfo.labels: readonly string[]`; `HitlPREntry` shrinks to `{ number, url, body, state }`.
  - `NotifierDeps.readIssue: (issueNumber, repoInfo) => Promise<HitlIssueInfo | null>`; `listOpenPRs` unchanged in shape but returns the shrunk entries.
  - `buildNotifierDeps(resolvePorts: () => NotifierPorts, repoId: RepoIdentifier): NotifierDeps`: `readIssue` awaits `resolvePorts().issueTracker.fetchIssue(n)` and maps `{ title, labels }`, `null` on any throw; `listOpenPRs` maps `resolvePorts().codeHost.listPullRequests()` filtered to `state === 'OPEN'` into `{ number, url: https://github.com/${owner}/${repo}/pull/${number}, body, state }`, `null` on any throw. Document why it is a thunk (built inside `forgeWiring` while the providers are still being assembled; invoked only at notification time).
  - `readIssueTitleAndHitl` becomes async and uses `labels.includes('hitl')`; `findReviewPr` returns the URL of the first entry whose body links the issue (`bodyLinksIssue`), or `null`. Explain in a comment why "first OPEN entry, port order newest-first" is the legacy `selectPreferredPR` outcome. Remove both adapter imports.
- `adws/forge/__tests__/hitlBoardNotifier.test.ts`: `makeIssueReader` returns `async () => ({ title, labels })`; `makePRLister` returns the shrunk entries; the `buildNotifierDeps` block uses fake ports (a tracker whose `fetchIssue` resolves an `Issue` with `labels: ['hitl']`, a code host whose `listPullRequests` returns OPEN and CLOSED records) and a throwing pair for the `null` cases; add a case proving the thunk is not invoked until a reader runs.
- `adws/core/forgeWiring.ts`:
  - `adwGitHubForgeDeps(repoId: RepoIdentifier, resolvePorts: () => NotifierPorts)` builds `buildNotifierDeps(resolvePorts, repoId)`; `buildAdwForgeDeps(config, repoId, resolveProviders: () => BoundProviders)` (the `GitContext` parameter goes; it was only used for the notifier).
  - Replace the three adapter type imports with indexed-access aliases on the assembly contract: `type GitLabConfig = NonNullable<ForgeProviderDeps['gitlab']>`, `type JiraConfig = NonNullable<ForgeProviderDeps['jira']>`, `type JiraAuth = JiraConfig['auth']` (keep exporting the same helper signatures). Update the header comment.
- `adws/core/launchGitContext.ts`: `LaunchGitContextDeps.forgeDeps?: (config, repoId, resolveProviders: () => BoundProviders) => ForgeProviderDeps`; inside `buildLaunchBoundary` declare the boundary with `let`, build `assembleProviders` passing `() => boundary.providers`, then assign `boundary = freezeBoundary(...)`. Note in the JSDoc that the thunk re-enters the memoised getter only after minting completed (it is invoked on a status move, never during assembly).
- `adws/core/__tests__/forgeWiring.test.ts`: `buildAdwForgeDeps(GITHUB_CONFIG, repoId, () => providers)` where `providers` is the `forgeProviders` result (the closure is only read at notification time, and the notifier module is mocked there anyway). `adws/core/__tests__/launchGitContext.test.ts`: the seam signature change is source-compatible with `NO_ENV_FORGE_DEPS`/`() => sentinelDeps`; add one test that the third argument, when invoked after the mint, returns the boundary's own memoised providers.
- Call sites: `adws/adwMerge.tsx` → `buildNotifierDeps(() => providers, repoId)`; `adws/adwPrReview.tsx` → `buildNotifierDeps(() => boundary.providers, boundary.repoId)`; `adws/phases/prReviewCompletion.ts` and `adws/phases/workflowCompletion.ts` → `notifierDeps ?? buildNotifierDeps(() => repoContext, repoContext.repoId)` (a `RepoContext` satisfies `NotifierPorts`, so the "no GitContext on this workflow config" warn branch and the `gitContext` read disappear). Update `adws/phases/__tests__/prReviewCompletion.test.ts` (its "real buildNotifierDeps readers" case) and `adws/__tests__/adwMerge.test.ts` if their expectations mention the context.

### Step 7: Route the health-check probes through the ports

- `adws/healthCheckChecks.ts`: `checkGitHubCLI(codeHost: Pick<CodeHost, 'getAuthenticatedUser'>)` sets `authenticated = Boolean(codeHost.getAuthenticatedUser())` inside the existing try/catch (the GitLab stub throws by name); `checkIssueNumber(issueNumber, issueTracker: Pick<IssueTracker, 'fetchIssue'>): Promise<CheckResult>` awaits `fetchIssue`, maps a throw to `Issue #N not found or not accessible`, and fills `details.title/state/exists` from the `Issue` (the "Could not resolve" and JSON-parse branches go away: the port returns a typed record or throws). `checkGitRepository(ctx)` is unchanged; change its type import to `'./gitContext'` (barrel). Remove the `createGhRepoApi` import.
- `adws/healthCheck.tsx`: import `GitContext` type from `'./gitContext'`; build the boundary once (`buildLaunchBoundary(null, { getRepoInfo: () => readLocalRepoIdentity(REPO_ROOT) })`), keep the existing construction-failure check, then resolve `boundary.providers` inside its own try/catch (a lazy-mint failure becomes a `providers` check failure instead of a crash); pass `providers.codeHost` and `providers.issueTracker` to the two probes and `await checkIssueNumber(...)`.
- `adws/triggers/trigger_webhook.ts` `/health`: keep `selfHostBoundary()` for the `GitContext`, resolve `boundary.providers.codeHost` in a second try/catch, and call `checkGitHubCLI(codeHost)`; the `ctxFailure` fallback covers both.
- `adws/__tests__/healthCheckChecks.test.ts`: delete the `ghRepoApi` mock; `checkGitHubCLI` cases take `{ getAuthenticatedUser: () => 'alice' | null | throw }`; `checkIssueNumber` cases become async with a fake tracker (`fetchIssue` resolving `{ title: 'Test issue', state: 'OPEN', … }` or rejecting); drop the "Could not resolve" and invalid-JSON cases; import the `GitContext` type from `'../gitContext'`.
- `adws/promotion/promotionStatsLoader.ts`: change `'../gitContext/index.ts'` to `'../gitContext'`.
- Confirm `git grep -nE "from ['\"][^'\"]*gitContext/[A-Za-z]" -- adws ':!adws/gitContext' ':!adws/providers' ':!**/__tests__/**'` prints nothing.

### Step 8: Delete the unit tests of library internals

- Delete `adws/vcs/__tests__/commitOperations.test.ts` and `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` (stage the deletions with git so the diff records them).
- `app_docs/feature-9gjajh-worktree-and-vcs.md` and its `.adw/conditional_docs.md` conditions: remove or reword any sentence that points at those two files (the `adws/vcs/**` `Owns:` glob still matches the remaining vcs files, so no dead glob results).

### Step 9: Trim and rewrite the per-issue BDD step definitions

- `features/per-issue/feature-818.feature`: delete the three §7 scenarios "A GitLab code host built from a repository identifier and a client alone still refuses by name", "A Jira issue tracker built from a client and a project key alone still refuses by name" and the outline "The board manager factories still construct with no arguments and refuse by name", together with the TRAP 7 commentary that introduces them; keep the guard and type-check scenarios that close §7 and reword the section heading comment accordingly.
- `features/per-issue/step_definitions/feature-818.steps.ts`: remove the `GitLabCodeHost`, `GitLabApiClient`, `createGitLabBoardManager`, `JiraIssueTracker`, `JiraApiClient`, `createJiraBoardManager` and `BoardManager` imports, the `lastGitLabCodeHost`/`lastJiraTracker`/`lastBoardManager` state and their hook resets, the eight step definitions from "a GitLab code host is constructed with only …" through "asking it to find a board refuses naming …", and any helper (`expectThrows`, `expectRejects`, `REPO_ID_ACME_WIDGET_GITLAB`) left unused. The generated driver-script strings that name adapter paths stay: they are strings, not imports, and issue 840 owns their rewrite.
- `features/per-issue/step_definitions/feature-820.steps.ts`:
  - Replace `buildRefusalProvider` with a port-based builder: call `forgeProviders({ forge: { codeHost: 'gitlab', issueTracker: 'jira' }, identity: REFUSAL_REPO_ID, tokenProvider: { credentialEnv: () => ({}) }, gitContext, deps: { gitlab: { token: 'unused', instanceUrl: 'http://127.0.0.1:9' }, jira: { instanceUrl: 'http://127.0.0.1:9', projectKey: 'ADW', auth: { pat: 'unused' } } } })` once, where `gitContext` is a fixture `GitContext` bound to `acme/widget` with a no-op `exec` fake (follow `gitContextSharedWorld.ts`), and dispatch `JiraIssueTracker` → `providers.issueTracker`, `GitLabCodeHost` → `providers.codeHost`. The refusal messages are produced by the adapters, so the outline's expected `"<provider>.<method> is not implemented"` strings are unchanged. Import `forgeProviders` from `adws/providers/forgeProviders.ts`, `GitContext`/`TokenProvider` from the `adws/gitContext` barrel; remove the `JiraIssueTracker`, `JiraApiClient`, `GitLabCodeHost`, `GitLabApiClient` imports.
  - `buildWorkflowConfig(issueNumber, overrides: { prUrl?: string; labels?: string[] })` builds the `issue` as a port `Issue` (`id`, `number`, `title`, `body`, `state`, `author: 'tester'`, `labels`, `comments: []`); the "configuration's issue carries the label" step pushes the string label; drop the `GitHubLabel` import.
- `features/per-issue/feature-820.feature`: no scenario text needs to change; if the §9 commentary names the class constructors, reword it to say the ports are obtained through `forgeProviders`.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-818"` and `--tags "@adw-820"` (feature-820's header requires `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` set to any non-empty placeholder) and confirm the remaining scenarios pass and the step files import cleanly.

### Step 10: Update living docs and the conditional-docs index

- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`: `fetchIssueRecord` now reads the port's `Issue` through `boundary.providers.issueTracker` (the GitHub-shaped record and its `createdAt`/`url` rationale are gone); the boundary's default identity reader is `readLocalRepoIdentity` (`adws/core/localRepoIdentity.ts`); `adwGitHubForgeDeps(repoId, resolvePorts)`/`buildAdwForgeDeps(config, repoId, resolveProviders)` and the `forgeDeps` seam's thunk; `CWD_DERIVED_IDENTITY_FNS` is a three-name set.
- `app_docs/feature-9gjajh-github-api.md`: `buildNotifierDeps(resolvePorts, repoId)` reads `IssueTracker.fetchIssue` and `CodeHost.listPullRequests` (no `createGhRepoApi`); `readLocalRepoInfo` is library-internal and ADW uses `readLocalRepoIdentity`.
- `app_docs/feature-9gjajh-health-check.md`: the two forge probes take port `Pick`s, `checkIssueNumber` is async, `main()` resolves the boundary's providers with graceful degradation.
- `app_docs/feature-9gjajh-dev-server-and-ports.md`: `convertToSshUrl` is ADW-owned in `adws/core/sshCloneUrl.ts`, host-neutral, and re-exported by `targetRepoManager.ts`.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`: `fetchIssueRecord(boundary.providers.issueTracker, …)`, the workspace-ensure-before-fetch ordering and why, `buildNotifierDeps(() => repoContext, …)` in the discard/error handlers.
- `app_docs/feature-9gjajh-classifier-and-routing.md`: `classifyGitHubIssue` takes a `ClassifiableIssue`.
- `.adw/conditional_docs.md`: add `adws/core/localRepoIdentity.ts` and `adws/core/__tests__/localRepoIdentity.test.ts` to the `feature-oqb76h-gitcontext-base-path-authority.md` `Owns:` list; add `adws/core/sshCloneUrl.ts` and `adws/core/__tests__/sshCloneUrl.test.ts` to `feature-9gjajh-dev-server-and-ports.md`; rewrite the `Conditions:` bullets that describe `fetchIssueRecord`'s GitHub shape, `buildNotifierDeps(ctx, repoId)`, the health-check `(ctx: GitContext)` signatures, and "`readLocalRepoInfo` lives in `adws/providers/github/githubIdentity.ts`" (now: ADW reads identity through `readLocalRepoIdentity`). Keep the file canonical (run `bun run lint:docs-index`).
- `README.md` line 17: optional one-clause update noting that since #844 ADW callers reach issue/PR reads through the `IssueTracker`/`CodeHost` ports and only the adapters use `ghRepoApi`.

### Step 11: Run the validation commands

- Run every command in the Validation Commands section; fix anything red; re-run until all pass with zero regressions and the regression counts from Step 1 are unchanged.

## Testing Strategy

### Unit Tests

- `adws/core/__tests__/localRepoIdentity.test.ts` (new): parse matrix through the injected reader; both error paths keep the `Failed to get repo info:` prefix; the real-git dotted-name proof.
- `adws/core/__tests__/sshCloneUrl.test.ts` (new): the nine legacy `cloneUrl.test.ts` cases plus GitLab/self-hosted conversion, port, subgroup, `http://` and credential-bearing edge cases.
- `adws/core/__tests__/issueRecord.test.ts` (rewritten): delegation to a fake tracker, untouched result, no double-wrapped rejection.
- `adws/forge/__tests__/hitlBoardNotifier.test.ts` (updated): string labels, port-backed `buildNotifierDeps` (OPEN filter, URL building, `null` on throw, thunk laziness), first-linked-PR selection.
- `adws/core/__tests__/forgeWiring.test.ts`, `adws/core/__tests__/launchGitContext.test.ts` (updated): new seam signature; the resolver thunk returns the boundary's memoised providers after the mint.
- `adws/__tests__/healthCheckChecks.test.ts` (updated): port fakes for the two forge probes; async `checkIssueNumber`.
- `adws/__tests__/checkGitGhGuard.test.ts` (updated): `readLocalRepoIdentity` composites flagged for both constructor shapes, explicit argument permitted, guarded-name row present.
- `adws/phases/__tests__/workflowInit.test.ts` (updated): `fetchIssueRecord` receives `providers.issueTracker`; `fakeIssue` on the port shape; workspace ensured before the fetch on a target run.
- Fixture reshapes only (no behaviour change): `gitAgent.test.ts`, `adwLabels.test.ts`, `issueClassifier.test.ts`, `branchNameResolution.test.ts`, `reviewPhase.test.ts`, `promotionRotAdvisory.test.ts`, `scenarioTestPhase.test.ts`, `pauseQueueScanner.test.ts`, `trigger_cron.test.ts`, `prReviewCompletion.test.ts`.
- Deleted: `adws/vcs/__tests__/commitOperations.test.ts`, `adws/vcs/__tests__/fetchAndResetToRemote.test.ts`.

### Edge Cases

- First-clone target run: the issue fetch must not mint providers before `.adw/providers.md` exists; the reordered `initializeWorkflow` guarantees it. Self-host runs (`basePath = REPO_ROOT`) are unaffected.
- `IssueTracker.fetchIssue` failure: the GitHub tracker throws `Failed to fetch issue #N: …`; `fetchIssueRecord` must surface it once, not twice.
- Notifier: `listPullRequests()` throws → `listOpenPRs` returns `null` → no Slack message; issue without `hitl` → no message; several open PRs link the issue → the first (newest) wins, matching the legacy result; the thunk is never invoked during `forgeProviders` assembly.
- Health check: lazy mint throws (unrecognised forge name in `.adw/providers.md`) → a recorded check failure, the git checks still run; GitLab code host `getAuthenticatedUser` throws by name → `authenticated: false`, success stays `true` with the existing warning.
- `readLocalRepoIdentity`: HTTPS, SCP-style SSH, `ssh://`, credential-bearing, trailing slash, dotted repo names; a non-GitHub host now parses (platform stays `GitHub` by ADW convention) where the adapter helper used to throw; missing `origin` remote → `Failed to get repo info: …`.
- `convertToSshUrl`: explicit port, more or fewer than two path segments, `http://`, `ssh://`, SCP-style input, empty string → unchanged; userinfo dropped on conversion; trailing `.git` stripped exactly once.
- Guard: `readLocalRepoIdentity()` fed to `gitContextForRepo`/`forgeProviders` (inline or via a local) is flagged; `readLocalRepoIdentity(REPO_ROOT)` is not; `lint:git-guard` output otherwise byte-identical (same exempt set, same sanctioned sites, same scope count).
- BDD: every per-issue step-definition file still imports under cucumber; `@adw-818` and `@adw-820` remaining scenarios pass; `@regression` tag and scenario counts are exactly the Step 1 baseline.

## Acceptance Criteria

- Production imports into the adapters are exactly the two exempt files: `git grep -nE "^(import|export) .*from ['\"][^'\"]*providers/(github|gitlab|jira)" -- adws ':!adws/providers' ':!**/__tests__/**'` lists only `adws/core/launchGitContext.ts` and `adws/core/githubAppAuth.ts`. (The issue's broader grep over `features` and `test` additionally matches the per-issue `.feature` prose and the test-fixture step definitions for 796/797/810/819 and `gitContextSharedWorld.ts`, which the issue text explicitly exempts as test fixtures; the feature-818/820 step files no longer import adapter classes or clients.)
- No non-test import of a `gitContext` module: `git grep -nE "from ['\"][^'\"]*gitContext/[A-Za-z]" -- adws ':!adws/gitContext' ':!adws/providers' ':!**/__tests__/**'` prints nothing.
- `git grep -n "createGhRepoApi\|parseGitHubIssue\|selectPreferredPR\|readLocalRepoInfo\|convertToSshUrl\b" -- adws ':!adws/providers' ':!**/__tests__/**'` shows only ADW's own `convertToSshUrl` in `adws/core/sshCloneUrl.ts`/`targetRepoManager.ts` and the guard's name set.
- `adws/vcs/__tests__/commitOperations.test.ts` and `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` no longer exist; no test under `adws/` imports `adws/gitContext/commitOps` or `branchOps`.
- `features/per-issue/step_definitions/feature-818.steps.ts` and `feature-820.steps.ts` import no adapter class or API-client type; their feature files are updated; `@regression` tag occurrences (46) and scenario count (53) are unchanged.
- No new `git`/`gh` shell-out; `bun run lint:git-guard` passes with the same exempt packages, sanctioned sites and scope count as before.
- `adws/gitContext/**` and `adws/providers/**` have no diff.
- Unit suite, both typechecks, lint, `lint:docs-index`, BDD regression, `@adw-818`, `@adw-820` and `@review-proof` runs are green (no new failures against the Step 1 baseline).
- Living docs for `issueRecord`, `hitlBoardNotifier`, `healthCheck`, `targetRepoManager` (plus the launch boundary, lifecycle and classifier docs that describe the same helpers) no longer describe `createGhRepoApi`, `readLocalRepoInfo`, `selectPreferredPR` or the GitHub-shaped issue record as ADW behaviour; `.adw/conditional_docs.md` owns the two new modules and their tests.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` - root type check (covers `adws/`, `features/`, `test/`)
- `bunx tsc --noEmit -p adws/tsconfig.json` - auxiliary type check
- `bun run lint` - ESLint
- `bun run build` - `tsc` build entry point
- `bun run test:unit` - vitest suite, including the new `localRepoIdentity`, `sshCloneUrl` and rewritten `issueRecord`/`hitlBoardNotifier`/`healthCheckChecks`/guard tests
- `bun run lint:git-guard` - all four guard rules green; compare the summary lines (exempt packages, sanctioned sites, scope entries) with the Step 1 output
- `bun run lint:docs-index` - conditional-docs index health
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` - regression suite; no new failures versus the Step 1 baseline
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` - review-proof scenarios
- `CLOUDFLARE_ACCOUNT_ID=x R2_ACCESS_KEY_ID=x R2_SECRET_ACCESS_KEY=x NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-818 or @adw-820"` - the two rewritten per-issue files import cleanly and their remaining scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-844"` - the issue's own scenarios, if `features/per-issue/feature-844.feature` exists by build time
- `git grep -c "@regression" -- 'features/regression/**/*.feature' | awk -F: '{s+=$2} END {print s}'` - must print `46`
- `git grep -c "^\s*Scenario" -- 'features/regression/**/*.feature' | awk -F: '{s+=$2} END {print s}'` - must print `53`
- `git grep -nE "^(import|export) .*from ['\"][^'\"]*providers/(github|gitlab|jira)" -- adws ':!adws/providers' ':!**/__tests__/**'` - must list only `adws/core/launchGitContext.ts` and `adws/core/githubAppAuth.ts`
- `git grep -nE "from ['\"][^'\"]*gitContext/[A-Za-z]" -- adws ':!adws/gitContext' ':!adws/providers' ':!**/__tests__/**'` - must print nothing
- `git grep -n "GitLabApiClient\|JiraApiClient\|new GitLabCodeHost\|new JiraIssueTracker\|GitHubLabel" -- features` - must print nothing
- `git diff --stat -- adws/gitContext adws/providers` - must be empty
- `bunx tsx adws/healthCheck.tsx 844` - end-to-end smoke of the port-based probes on the host (needs the operator's GitHub credentials; expect the issue check to report the title of issue 844)

## Notes

- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.
- **Issue-body corrections found during research.** (1) `feature-818.steps.ts` and `feature-820.steps.ts` live under `features/per-issue/step_definitions/`, not `features/regression/`; neither carries `@regression`, so the "tag counts must not regress" clause is satisfied by leaving `features/regression/**` untouched. (2) The issue's acceptance grep over `adws features test` can never list only two files: `adws/checkGitGhGuard.ts` and `adws/guard/*.ts` name `adws/providers/github` as guard configuration strings, the per-issue `.feature` files quote the paths in prose, and the 796/797/810/819 step definitions plus `gitContextSharedWorld.ts` are the test fixtures the issue text exempts. The plan therefore verifies the intent with the import-only grep in Validation Commands. (3) The ten `GitHubIssue`/`GitHubLabel`/`GitHubComment` type imports and `forgeWiring.ts`'s three config-type imports are not named in the issue but match its grep; both are removed here (port `Issue`, `ForgeProviderDeps` indexed types) so the two-file result holds.
- **Design decision to surface at HITL review: no library change.** Typing the workflow on the port's `Issue` drops the issue-level `createdAt` and `url` from the plan/scenario/build prompts (comment timestamps stay). The alternative, adding `createdAt`/`url` to `Issue` in `adws/providers/types.ts` and both mappers, is permitted by the issue's "add the missing field to the domain model" rule but would make issue 840 depend on a devplatform release carrying those fields; if the reviewer prefers prompt fidelity, file that as a devplatform issue alongside `createForgeCredentials` (devplatform issue 9) and extend `fetchIssueRecord`'s consumers then. `PullRequestRecord` needs no new field: the legacy `selectPreferredPR` ran over OPEN-only entries with empty timestamps, so "first OPEN linked PR in the port's newest-first order" is the same choice.
- **Why the notifier takes a thunk.** `forgeWiring.buildAdwForgeDeps` runs *inside* `buildLaunchBoundary`'s lazy mint, before `forgeProviders` returns; the only way for the review-transition notifier to read through the ports it is being wired into is to resolve them at notification time. Re-entrancy is impossible in practice (assembly never moves an issue), but the JSDoc should say so.
- **`initializeWorkflow` ordering.** Moving `ensureTargetRepoWorkspace` before the issue fetch is required for correctness, not style: the lazy mint defaults to GitHub when `.adw/providers.md` is absent and memoises the result for the whole run. Keep `ensureTargetRepoWorkspace`'s existing `getDefaultBranch` thunk semantics (only invoked on the already-cloned branch).
- **What issue 840 still owns.** `adws/core/launchGitContext.ts`'s credential imports and `resolveBootstrapGitIdentity`, `adws/core/githubAppAuth.ts`'s `appAuth` import, the string paths inside feature-818's generated driver scripts, `features/regression/step_definitions/feature-729.steps.ts`'s `commitOps` import, and the `gitContextFixture` test helper. Do not touch them here.
- **Platform on `readLocalRepoIdentity`.** `RepoIdentifier.platform` is required and every existing local-identity consumer ignores or hard-codes `Platform.GitHub` (`buildLaunchBoundary`, `buildRepoIdentifier`, `resolveCronRepo`); inferring the platform from the remote host is a deliberate non-goal of this issue.
- No new libraries are required. If one were, install with `bun add <package>`.
- Keep every touched file under 300 lines; `hitlBoardNotifier.ts` and `healthCheckChecks.ts` shrink, `workflowInit.ts` only reorders a block.
