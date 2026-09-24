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
   are rewritten against the ports or trimmed. Note the issue's premise here is one step ahead of the
   repository: `@paysdoc/devplatform` is *not* a dependency yet (absent from `package.json` and
   `node_modules`) and `commitOps`/`branchOps` still live at `adws/gitContext/{commitOps,branchOps}.ts`;
   they move in issue 840. Deleting the two `adws/vcs/__tests__` files is still what the issue asks for,
   and is safe because `features/per-issue/feature-844.feature` §6 re-states the force-with-lease,
   lease-rejection and fetch-then-reset contracts as executable BDD rows over a recording git runner.
4. Living docs describing the removed helpers are updated, and the git/gh guard learns the new
   cwd-derived identity name so the wrong-repo firewall keeps covering it.

`adws/gitContext/**` does not change. `adws/providers/**` changes only where the issue explicitly
sanctions it: "add the missing field to the domain model in `adws/providers/types.ts` and both adapters,
not a GitHub-only helper". Both port records are short of what their ADW callers read today —
`Issue` carries no `createdAt`/`url` and `PullRequestRecord` carries no `updatedAt`/`url` — so this
feature widens those two interfaces and the mappers/projections behind them in both adapters. The
parent PRD lists "Behavior changes of any workflow" as out of scope ("the extraction is intended to be
operationally invisible"), which is why the fields are added rather than dropped from the agent prompts.

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

Thread the boundary's ports; construct nothing; add no new *operation* to the library — only the four
domain-model fields the issue's own rule sanctions when a port record cannot express what its caller
reads (`Issue.createdAt`, `Issue.url`, `PullRequestRecord.updatedAt`, `PullRequestRecord.url`).

- **Issue record on the port.** `fetchIssueRecord(issueTracker, issueNumber)` becomes a thin delegation
  to `IssueTracker.fetchIssue` and returns the port's `Issue`. `WorkflowConfig.issue` and every consumer
  are typed on `Issue` (string `author`, string `labels`, `IssueComment` comments with string `author`).
  The GitHub tracker already wraps failures as `Failed to fetch issue #N: …`, so the helper must not wrap
  again. **`Issue` gains `createdAt: string` and `url: string`.** The port does not carry them today, and
  `buildAgent.ts:111,116` reads `issue.url` while `planAgent.ts:40,268` and `scenarioAgent.ts:49` read
  `issue.createdAt` — both `JSON.stringify` the whole record into an agent prompt. Dropping them would
  change every byte four agents see, which the parent PRD puts out of scope. The issue's own rule for a
  port record that cannot express what its caller needs settles the fix: add the field to the domain model
  in `adws/providers/types.ts` and to **both** adapters' issue mappers (GitHub and Jira), never a
  GitHub-only helper. This is not "something new from the library": `@paysdoc/devplatform` is not a
  dependency yet, `adws/providers/**` is still local source, and issue 840 carries the widened interface
  into the library when it extracts it.
- **Mint timing.** Reading the issue through the port is the first `boundary.providers` access in
  `initializeWorkflow`, and today that read happens *before* `ensureTargetRepoWorkspace`. The lazy mint
  reads `.adw/providers.md` from the workspace path, so on a first-clone target run it would silently
  default to GitHub and memoise that for the whole run. The workspace-ensure block therefore moves ahead
  of the issue fetch (it depends only on `targetRepo`, and its `getDefaultBranch` thunk still runs only
  on the already-cloned branch).
- **Notifier on the ports.** `buildNotifierDeps` takes a thunk resolving to `{ issueTracker, codeHost }`
  (a `Pick` of `BoundProviders`) plus the `RepoIdentifier`. `readIssue` awaits `IssueTracker.fetchIssue`
  and returns `{ title, labels: string[] }`; `listOpenPRs` filters `CodeHost.listPullRequests()` to
  `state === 'OPEN'` — the OPEN filter stays, so an issue whose only linked PR is merged still produces
  silence rather than paging a human at a PR that merged last week.
  **`PullRequestRecord` gains `updatedAt: string` and `url: string`.** The issue's preferred-PR choice is
  "open over merged, newest first", and `selectPreferredPR` implements "newest" as an `updatedAt` sort;
  `PullRequestRecord` is `{number, body, state, mergedAt}`, so the choice is *not* expressible on it and
  the issue's conditional fires: add the missing field to `adws/providers/types.ts` and both adapters.
  Widening the type alone is half a fix — `githubCodeHost.listPullRequests()` is a bare
  `JSON.parse(this.gh.fetchAllPRs()) as PullRequestRecord[]` over `fetchAllPRsCmd`'s
  `--json number,body,state,mergedAt`, so `fetchAllPRsCmd` must gain `updatedAt,url` too or every
  `updatedAt` is `undefined`, `new Date(undefined).getTime()` is `NaN`, the comparator returns `NaN` for
  every pair and `sort` silently leaves the forge's order untouched. `url` comes from the forge for the
  same reason the rest of this file is being de-GitHub-ified: today `buildNotifierDeps` synthesises
  `https://github.com/${owner}/${repo}/pull/${number}`, a GitHub-only path shape (GitLab's is
  `/-/merge_requests/`) assembled inside the caller the issue is making host-neutral. On GitHub the
  forge-published URL is byte-identical to the synthesised one, so nothing an operator sees moves.
  The thunk exists because `forgeWiring.ts` builds these deps *while* `forgeProviders` is
  assembling the very providers they read; it is only invoked at notification time.
- **Health check on the ports.** `checkGitHubCLI(codeHost)` and `checkIssueNumber(issueNumber, issueTracker)`
  take port `Pick`s; `checkIssueNumber` becomes async. `checkGitRepository(ctx)` keeps its `GitContext`
  (git reads are the core's job). `healthCheck.tsx` and the webhook `/health` endpoint pass the boundary's
  providers, degrading gracefully if the lazy mint throws.
- **ADW-owned identity and clone URL.** New `adws/core/localRepoIdentity.ts` composes
  `readOriginRemoteUrl` (gitContext barrel) with `parseOwnerRepoFromUrl` (host-neutral) and keeps the
  outer `Failed to get repo info: …` wrap. **`parseOwnerRepoFromUrl` is not a superset of the helper it
  replaces.** `parseGitHubRemoteUrl`'s HTTPS pattern is unanchored (`/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/`)
  and its own doc comment says it "Also matches … `ssh://git@github.com/…` forms"; the neutral parser's
  HTTPS branch requires `https?://` and its SSH branch requires a colon after the host, so
  `ssh://git@github.com/owner/repo[.git]` returns `null` under a plain composition — verified by running
  both patterns over the same remotes. The issue asks for the same error message on failure; it does not
  sanction shrinking the set of remotes that resolve, and every one of the five callers feeds the result
  into a launch boundary or a token pin, so a shape that stops resolving is a process that cannot start.
  `readLocalRepoIdentity` therefore normalises an `ssh://[user@]host/owner/repo` remote to the SCP form
  before parsing (or matches it directly) so all of today's shapes keep resolving. New `adws/core/sshCloneUrl.ts` converts
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
- `adws/providers/types.ts` - **modified**: `Issue` gains `createdAt`/`url`; `PullRequestRecord` gains `updatedAt`/`url`. Read only for `IssueComment`, `BoundProviders`
- `adws/providers/forgeProviders.ts` - read only: `BoundProviders`, `ForgeProviderDeps`
- `adws/providers/github/commands/prCommands.ts` - **modified**: `fetchAllPRsCmd`'s `--json` list gains `updatedAt,url`
- `adws/providers/github/githubCodeHost.ts` - **modified**: `listPullRequests()`'s bare cast must carry the two new fields
- `adws/providers/github/mappers.ts` - **modified**: `mapGitHubIssueToIssue` fills `createdAt`/`url`. Note `ISSUE_FIELDS` in `commands/issueCommands.ts` *already* projects `createdAt,url` and `GitHubIssue` already carries both — the mapper is the only place they are dropped, so no `gh` command changes for the issue side
- `adws/providers/github/domain/issue.ts` - read only: `GitHubIssue.createdAt`/`.url` already exist
- `adws/providers/jira/jiraIssueTracker.ts` - **modified**: `toIssue` fills `createdAt`/`url` from the Jira payload
- `adws/providers/gitlab/gitlabCodeHost.ts` - read only: `listPullRequests()` is a refuse-by-name stub, so the widened `PullRequestRecord` costs it nothing but a type-check
- `adws/providers/github/ghPrParsers.ts` - read only: `selectPreferredPR`'s open-then-newest rule, which the ADW-side selection reproduces on the port record
- `adws/providers/github/githubIdentity.ts`, `adws/providers/github/cloneUrl.ts`, `adws/providers/github/__tests__/cloneUrl.test.ts`, `adws/providers/github/__tests__/githubIdentity.test.ts` - read only: behaviour and test cases to mirror in the ADW-owned replacements (library files stay untouched)
- `adws/guard/identityRule.ts`, `adws/__tests__/checkGitGhGuard.test.ts` - add `readLocalRepoIdentity` to `CWD_DERIVED_IDENTITY_FNS`, rule tests, guarded-name row
- `adws/promotion/promotionStatsLoader.ts` - normalise `../gitContext/index.ts` to the barrel specifier
- `adws/vcs/__tests__/commitOperations.test.ts`, `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` - delete
- `features/per-issue/step_definitions/feature-818.steps.ts`, `features/per-issue/feature-818.feature` - drop the constructor-arity scenarios and their steps
- `features/per-issue/step_definitions/feature-820.steps.ts`, `features/per-issue/feature-820.feature` - port-based refusal outline; string labels in `buildWorkflowConfig`
- `features/per-issue/step_definitions/gitContextSharedWorld.ts` - precedent for constructing a fixture `GitContext` with an `exec` fake (read only)
- `features/per-issue/feature-844.feature` - this slice's own scenarios; the build's RED tests
- `features/per-issue/step_definitions/feature-796.steps.ts` - read only: hosts the recording-boundary phrases §1-§3 reuse (`:580`, `:593`, `:599`, `:615`, `:1009`, `:1017`)
- `features/per-issue/step_definitions/feature-820.steps.ts` - read only for `:629`/`:884`, the two phrases §1-§3 reuse; also rewritten in Step 9
- `features/per-issue/step_definitions/feature-816.steps.ts`, `feature-817.steps.ts`, `feature-810.steps.ts` - read only: the guard-fixture and docs-index phrases §4/§7 reuse
- `features/regression/vocabulary.md` - the phrase registry the three new §7 step definitions must respect
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
- `features/per-issue/step_definitions/feature-844.steps.ts` - this slice's step definitions, including the three §7 phrases that have no surviving registration anywhere

## Implementation Plan

### Phase 1: Foundation

Build the two ADW-owned replacements first, because every later step points at them: `readLocalRepoIdentity`
(with its guard registration) and the host-neutral `convertToSshUrl`. Both are pure-ish modules with their
own unit tests and no dependency on the rest of the change. Capture the baseline numbers the acceptance
criteria compare against (regression scenario/tag counts, guard output, the two import greps).

### Phase 2: Core Implementation

Route the three raw-GitHub call sites through the ports. Each of the first two opens with the domain-model
widening it depends on, under the issue's own rule ("add the missing field to the domain model in
`adws/providers/types.ts` and both adapters, not a GitHub-only helper"): `Issue` gains `createdAt`/`url`
before the issue record moves, and `PullRequestRecord` gains `updatedAt`/`url` — in the interface *and* in
`fetchAllPRsCmd`'s `--json` projection — before the notifier moves. Order matters: the issue record first
(it retypes `WorkflowConfig.issue` and cascades into agents, labels, classifier, phases and their
fixtures), then the notifier (it changes `forgeWiring` and the launch-boundary `forgeDeps` seam), then the
health checks (self-contained). Re-point the `readLocalRepoInfo` callers and `targetRepoManager` onto the
Phase 1 modules, and express `forgeWiring`'s config types through `ForgeProviderDeps`.

### Phase 3: Integration

Trim/rewrite the two per-issue BDD step-definition files and their feature files, then write this slice's
own `feature-844.steps.ts` — including the three §7 phrases (`the ADW TypeScript type-check passes`, the
git/gh guard pair) that six other per-issue files reference but no surviving file registers. Only once
`@adw-844` §6 is green over the recording git runner may the two library-internal `adws/vcs/__tests__`
files be deleted: today they are the sole cover for `pushBranch`, `isLeaseRejection` and
`fetchAndResetToRemote`, and `@paysdoc/devplatform` is not a dependency yet, so nothing else would carry
those contracts. Normalise the remaining non-barrel `gitContext` specifiers, update the living docs and the
conditional-docs index (new files into `Owns:`), then run the full validation set and the two acceptance
greps.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1: Capture the baseline

- Run `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit`, `bun run lint:git-guard`, `bun run lint:docs-index` and confirm all green before touching anything.
- Record the regression baseline: `git grep -c "@regression" -- 'features/regression/**/*.feature'` summed (46 occurrences today) and `git grep -c "^\s*Scenario" -- 'features/regression/**/*.feature'` summed (53 scenarios today). These numbers must be identical at the end.
- Record `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` pass/fail/pending counts (the 840 review recorded pre-existing pending/undefined scenarios on `dev`; the goal is zero *new* failures).
- Record the current output of the precise import grep in the Acceptance Criteria section. For reference, the issue's own `git grep -l` form matches **44** paths across `adws features test` today and **27** under `adws/` alone — not the two it predicts. See the Notes for why that criterion is verified through the import-only grep instead.

### Step 2: Add `adws/core/localRepoIdentity.ts` and register it with the guard

- Create `adws/core/localRepoIdentity.ts` exporting `readLocalRepoIdentity(cwd?: string, deps: { readRemoteUrl?: (cwd?: string) => string } = {}): RepoIdentifier`.
  - Compose `deps.readRemoteUrl ?? readOriginRemoteUrl` (import from `'../gitContext'`, the barrel) with `parseOwnerRepoFromUrl` (import from `'../providers/workspaceValidation'`, as `workspaceBinding.ts` does) and `Platform` from `'../providers/types'`.
  - **Normalise `ssh://` remotes before parsing.** `parseOwnerRepoFromUrl` returns `null` for `ssh://git@github.com/owner/repo[.git]` (its HTTPS branch needs `https?://`, its SSH branch needs a colon after the host), whereas the `readLocalRepoInfo` it replaces resolves them — `parseGitHubRemoteUrl`'s HTTPS pattern is unanchored and its doc comment names the `ssh://` form explicitly. Rewrite an `ssh://[user@]host/owner/repo` remote to `user@host:owner/repo` (or match it with a small local pattern) before handing it to the neutral parser, so every remote that resolves today still resolves. This is the one divergence that would otherwise stop a process from starting.
  - Return `{ owner, repo, platform: Platform.GitHub }`. Document in the JSDoc that the platform is ADW's launch-identity convention (the same hard-coded value `buildRepoIdentifier` and `resolveCronRepo` use) and that forge selection comes from `.adw/providers.md`, not from the remote host.
  - Error contract: one `try/catch` spanning both the read and the parse; on a null parse throw `Could not parse owner/repo from remote URL: ${remoteUrl}`; the outer wrap is verbatim `Failed to get repo info: ${error}` (the legacy message).
- Create `adws/core/__tests__/localRepoIdentity.test.ts`:
  - Injected-reader cases: HTTPS and SCP-style SSH remotes, **`ssh://git@github.com/acme/webapp` and `ssh://git@github.com/acme/webapp.git`** (both must resolve), dotted repo names (`paysdoc/paysdoc.nl`, with and without `.git`), a trailing slash, a credential-bearing HTTPS remote, a non-GitHub host (`https://gitlab.com/acme/webapp.git` → `{ acme, webapp, GitHub }`, a deliberate change from `readLocalRepoInfo`, which threw), a garbage remote → `/Failed to get repo info/` and the inner `Could not parse owner/repo` text, a throwing reader → `/Failed to get repo info/`.
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

- **First, widen the domain model (the issue's sanctioned remedy).** `adws/providers/types.ts`: add `createdAt: string` and `url: string` to `Issue`. `adws/providers/github/mappers.ts`: `mapGitHubIssueToIssue` fills `createdAt: issue.createdAt, url: issue.url` — `ISSUE_FIELDS` already projects both and `GitHubIssue` already carries both, so nothing else on the GitHub side moves. `adws/providers/jira/jiraIssueTracker.ts`: `toIssue` fills the same two fields from the Jira payload (`fields.created` and the browse URL). Update `adws/providers/__tests__` fixtures that build an `Issue` literal.
- `adws/core/issueRecord.ts`: `fetchIssueRecord(issueTracker: Pick<IssueTracker, 'fetchIssue'>, issueNumber: number): Promise<Issue>` returning `issueTracker.fetchIssue(issueNumber)` with no additional wrap (the GitHub tracker already throws `Failed to fetch issue #N: …`; wrapping again would double the prefix). Remove the three adapter imports; rewrite the header to say the record is the port's `Issue`, read through the boundary's tracker, and that the GitHub-shaped record is gone as of #844.
- `adws/core/__tests__/issueRecord.test.ts`: rewrite against a fake tracker (no `GitContext`, no exec): delegates with the issue number, returns the tracker's `Issue` untouched, propagates the tracker's rejection message unchanged (assert it is not double-prefixed).
- `adws/phases/workflowInit.ts`:
  - `WorkflowConfig.issue: Issue` (import `Issue` from `'../providers/types'`; drop the `GitHubIssue` import).
  - Move the "Setup target repo workspace" block (the `ensureTargetRepoWorkspace` call and the `targetRepo.workspacePath` assignment) to immediately after the GITHUB_PAT startup validation and before the issue fetch, so the first `boundary.providers` access happens after the workspace and its `.adw/providers.md` exist on a first-clone target run. Keep `ensureLogsDirectory` where it is. Add a comment explaining the ordering constraint (lazy mint reads provider config from `gitContext.basePath`).
  - `const issue = await fetchIssueRecord(boundary.providers.issueTracker, issueNumber);` and update the log line ("Fetching issue…").
- `adws/phases/__tests__/workflowInit.test.ts`: reshape `fakeIssue` to the port `Issue` (`id`, `number`, `title`, `body`, `state`, `author: 'test'`, `labels: []`, `comments: []`, `createdAt`, `url`); assert `fetchIssueRecord` is called with the fake boundary's `providers.issueTracker`; if any test asserts call order between the issue fetch and `ensureTargetRepoWorkspace`, update it to the new order.
- `adws/agents/planAgent.ts`: `formatIssueContextAsArgs(issue: Issue)` and `runPlanAgent(issue: Issue, …)`: `**Author:** ${issue.author}` (the port's `author` is already the login string — leaving `issue.author.login` in place renders `**Author:** undefined`), `**Labels:** ${issue.labels.join(', ') || 'none'}` (already `string[]` — leaving `issue.labels.map(l => l.name)` renders `undefined, undefined` and makes `readAdwLabelNames` classify nothing), **keep the `**Created:**` line reading `issue.createdAt`**, comments render `**${c.author}** (${c.createdAt})`; `issueJson` uses `author: issue.author`, `labels: issue.labels`, comment `author: c.author`, and **keeps its `createdAt` key**.
- `adws/agents/scenarioAgent.ts`: same `issueJson` shape change, `createdAt` retained; `issue: Issue`.
- `adws/agents/buildAgent.ts`: `issue: Issue`; **keep** the `Issue URL` log line and the `**URL:**` prompt line — `Issue.url` now exists, so `:111`/`:116` need no change beyond the type.
- `adws/agents/gitAgent.ts`: `issue: Issue` in `formatBranchNameArgs` and `runGenerateBranchNameAgent` (`JSON.stringify(issue)` is unchanged).
- `adws/agents/__tests__/gitAgent.test.ts`: reshape `mockIssue` to the port `Issue`.
- `adws/core/adwLabels.ts`: `readAdwLabels(issue: Pick<Issue, 'labels'>)` → `readAdwLabelNames(issue.labels)`; `scenarioAuthoringSkipReason(labels: readonly string[])` and `shouldSkipScenarioAuthoring(labels: readonly string[])` build the name set directly; drop the `GitHubIssue`/`GitHubLabel` import. `adws/core/__tests__/adwLabels.test.ts`: `makeIssue` returns `{ labels: string[] }`; drop the `GitHubLabel` import and `makeLabel`.
- `adws/core/issueClassifier.ts`: `classifyGitHubIssue(issue: ClassifiableIssue)` (the existing `Pick<Issue, 'number'|'title'|'body'|'labels'|'comments'>` alias); `labelsText = issue.labels.join(', ') || 'none'`; drop the `GitHubIssue` import. `adws/core/__tests__/issueClassifier.test.ts`: `makeIssue` builds a `ClassifiableIssue`; drop the `GitHubIssue` import.
- `adws/core/workflowCommentParsing.ts`: `detectRecoveryState(comments: readonly IssueComment[])` (import from `'../providers/types'`); the body reads only `body` and `createdAt`, so no logic changes.
- `adws/phases/branchNameResolution.ts`: `issue: Issue` in both arg shapes. `adws/phases/__tests__/branchNameResolution.test.ts`: reshape `defaultArgs.issue`.
- `adws/phases/prReviewPhase.ts`: `issueStub: Issue = { id: String(prNumber), number: prNumber, title: pr.title, body: pr.body, state: 'open', author: '', labels: [], comments: [], createdAt: '', url: pr.url ?? '' }`; drop the `GitHubIssue` import.
- Reshape the remaining `WorkflowConfig.issue` fixtures: `adws/phases/__tests__/reviewPhase.test.ts`, `adws/phases/__tests__/promotionRotAdvisory.test.ts` (`makeIssue(labels: string[])`), `adws/phases/__tests__/scenarioTestPhase.test.ts`, and `adws/__tests__/healthCheckChecks.test.ts` (handled in Step 7).
- `.claude/commands/scenario_writer.md` line 12: the documented issue JSON keys are unchanged (`createdAt` survives the port crossing).
- Confirm `git grep -n "GitHubIssue\|GitHubLabel\|GitHubComment" -- adws ':!adws/providers'` returns only guard-test fixture strings (`checkGitGhGuard.test.ts`, `extractionRule.test.ts`).

### Step 6: Route the HITL board notifier through the ports

- **First, widen the domain model and the `gh` projection (the issue's sanctioned remedy).**
  - `adws/providers/types.ts`: `PullRequestRecord` gains `updatedAt: string` and `url: string`.
  - `adws/providers/github/commands/prCommands.ts`: `fetchAllPRsCmd`'s `--json` list becomes `number,body,state,mergedAt,updatedAt,url`. This half is not optional: `githubCodeHost.listPullRequests()` is a bare `JSON.parse(this.gh.fetchAllPRs()) as PullRequestRecord[]` with no mapper, so a widened type over an unwidened projection leaves every `updatedAt` `undefined`, makes `new Date(undefined).getTime()` `NaN`, makes the comparator return `NaN` for every pair, and leaves `sort` a no-op — type-check green, unit suite green, wrong PR announced.
  - `adws/providers/gitlab/gitlabCodeHost.ts` needs no change: `listPullRequests()` refuses by name.
  - Update the `ghPrApi`/`githubCodeHost` tests whose `fetchAllPRs` fixtures or expected command strings name the `--json` list.
- `adws/forge/hitlBoardNotifier.ts`:
  - Export `type NotifierPorts = { issueTracker: Pick<IssueTracker, 'fetchIssue'>; codeHost: Pick<CodeHost, 'listPullRequests'> }` (both `BoundProviders` and `RepoContext` are assignable).
  - `HitlIssueInfo.labels: readonly string[]`; `HitlPREntry` becomes `{ number, url, body, state, updatedAt }`.
  - `NotifierDeps.readIssue: (issueNumber, repoInfo) => Promise<HitlIssueInfo | null>`; `listOpenPRs` unchanged in shape but returns the shrunk entries.
  - `buildNotifierDeps(resolvePorts: () => NotifierPorts, repoId: RepoIdentifier): NotifierDeps`: `readIssue` awaits `resolvePorts().issueTracker.fetchIssue(n)` and maps `{ title, labels }`, `null` on any throw; `listOpenPRs` maps `resolvePorts().codeHost.listPullRequests()` filtered to `state === 'OPEN'` into `{ number, url: pr.url, body, state, updatedAt }`, `null` on any throw. **Take `url` from the record, do not synthesise it**: the legacy `https://github.com/${owner}/${repo}/pull/${number}` is a GitHub-only path shape (GitLab's is `/-/merge_requests/`) inside the caller this issue is making host-neutral, and the issue's rule is "not a GitHub-only helper". On GitHub the forge-published URL is byte-identical, so no operator-visible bytes move. `repoId` stays in the signature for `readIssue`'s `repoInfo` argument. Document why it is a thunk (built inside `forgeWiring` while the providers are still being assembled; invoked only at notification time).
  - Keep the OPEN filter *before* the choice. `selectPreferredPR` prefers open and falls back to newest-overall, but today that fallback is unreachable because `listOpenPRs` already filtered to OPEN — so an issue whose only linked PR is merged produces silence. `CodeHost.listPullRequests()` returns state=all; handing it through without the filter would wake the fallback and page a human to "Approve to merge" a PR that merged last week.
  - `readIssueTitleAndHitl` becomes async and uses `labels.includes('hitl')`; `findReviewPr` filters the OPEN entries to those whose body links the issue (`bodyLinksIssue`) and returns the URL of the one with the newest `updatedAt`, or `null`. This is the issue's "open over merged, newest first" expressed on the port record — do not substitute "first entry in the port's listing order": the port's newest-first contract is by forge listing order, not by `updatedAt`, and `@adw-844`'s two-open-PRs row is written to fail on exactly that substitution. Remove both adapter imports.
- `adws/forge/__tests__/hitlBoardNotifier.test.ts`: `makeIssueReader` returns `async () => ({ title, labels })`; `makePRLister` returns the reshaped entries; the `buildNotifierDeps` block uses fake ports (a tracker whose `fetchIssue` resolves an `Issue` with `labels: ['hitl']`, a code host whose `listPullRequests` returns OPEN, MERGED and CLOSED records carrying distinct `updatedAt`/`url`) and a throwing pair for the `null` cases; add cases proving the thunk is not invoked until a reader runs, that a merged-only pool yields no announcement, that two OPEN linked PRs resolve to the newest `updatedAt` regardless of listing order, and that the announced URL is the record's own `url`.
- `adws/core/forgeWiring.ts`:
  - `adwGitHubForgeDeps(repoId: RepoIdentifier, resolvePorts: () => NotifierPorts)` builds `buildNotifierDeps(resolvePorts, repoId)`; `buildAdwForgeDeps(config, repoId, resolveProviders: () => BoundProviders)` (the `GitContext` parameter goes; it was only used for the notifier).
  - Replace the three adapter type imports with indexed-access aliases on the assembly contract: `type GitLabConfig = NonNullable<ForgeProviderDeps['gitlab']>`, `type JiraConfig = NonNullable<ForgeProviderDeps['jira']>`, `type JiraAuth = JiraConfig['auth']` (keep exporting the same helper signatures). Update the header comment.
- `adws/core/launchGitContext.ts`: `LaunchGitContextDeps.forgeDeps?: (config, repoId, resolveProviders: () => BoundProviders) => ForgeProviderDeps`; inside `buildLaunchBoundary` declare the boundary with `let`, build `assembleProviders` passing `() => boundary.providers`, then assign `boundary = freezeBoundary(...)`. Note in the JSDoc that the thunk re-enters the memoised getter only after minting completed (it is invoked on a status move, never during assembly).
- `adws/core/__tests__/forgeWiring.test.ts`: `buildAdwForgeDeps(GITHUB_CONFIG, repoId, () => providers)` where `providers` is the `forgeProviders` result (the closure is only read at notification time, and the notifier module is mocked there anyway). `adws/core/__tests__/launchGitContext.test.ts`: the seam signature change is source-compatible with `NO_ENV_FORGE_DEPS`/`() => sentinelDeps`; add one test that the third argument, when invoked after the mint, returns the boundary's own memoised providers.
- Call sites: `adws/adwMerge.tsx` → `buildNotifierDeps(() => providers, repoId)`; `adws/adwPrReview.tsx` → `buildNotifierDeps(() => boundary.providers, boundary.repoId)`; `adws/phases/prReviewCompletion.ts` and `adws/phases/workflowCompletion.ts` → `notifierDeps ?? buildNotifierDeps(() => repoContext, repoContext.repoId)` (a `RepoContext` satisfies `NotifierPorts`, so the "no GitContext on this workflow config" warn branch and the `gitContext` read disappear). Update `adws/phases/__tests__/prReviewCompletion.test.ts` (its "real buildNotifierDeps readers" case) and `adws/__tests__/adwMerge.test.ts` if their expectations mention the context.

### Step 7: Route the health-check probes through the ports

- `adws/healthCheckChecks.ts`: `checkGitHubCLI(codeHost: Pick<CodeHost, 'getAuthenticatedUser'>)` sets `authenticated = Boolean(codeHost.getAuthenticatedUser())` inside the existing try/catch (the GitLab stub throws by name); `checkIssueNumber(issueNumber, issueTracker: Pick<IssueTracker, 'fetchIssue'>): Promise<CheckResult>` awaits `fetchIssue`, maps a throw to `Issue #N not found or not accessible`, and fills `details.title/state/exists` from the `Issue` (the "Could not resolve" and JSON-parse branches go away: the port returns a typed record or throws). **Keep the `Invalid issue number: ${issueNumber}` guard (`:263`) and keep it ahead of the `fetchIssue` call** — `@adw-844` asserts that `0` and `-1` are rejected with that exact message *and* that the boundary's providers record no forge call. `checkGitRepository(ctx)` is unchanged; change its type import to `'./gitContext'` (barrel). Remove the `createGhRepoApi` import.
- `adws/healthCheck.tsx`: import `GitContext` type from `'./gitContext'`; build the boundary once (`buildLaunchBoundary(null, { getRepoInfo: () => readLocalRepoIdentity(REPO_ROOT) })`), keep the existing construction-failure check, then resolve `boundary.providers` inside its own try/catch (a lazy-mint failure becomes a `providers` check failure instead of a crash); pass `providers.codeHost` and `providers.issueTracker` to the two probes and `await checkIssueNumber(...)`.
- `adws/triggers/trigger_webhook.ts` `/health`: keep `selfHostBoundary()` for the `GitContext`, resolve `boundary.providers.codeHost` in a second try/catch, and call `checkGitHubCLI(codeHost)`; the `ctxFailure` fallback covers both.
- `adws/__tests__/healthCheckChecks.test.ts`: delete the `ghRepoApi` mock; `checkGitHubCLI` cases take `{ getAuthenticatedUser: () => 'alice' | null | throw }`; `checkIssueNumber` cases become async with a fake tracker (`fetchIssue` resolving `{ title: 'Test issue', state: 'OPEN', … }` or rejecting); drop the "Could not resolve" and invalid-JSON cases; keep the invalid-issue-number cases and assert the tracker was never called; import the `GitContext` type from `'../gitContext'`.
- `adws/promotion/promotionStatsLoader.ts`: change `'../gitContext/index.ts'` to `'../gitContext'`.
- Confirm `git grep -nE "from ['\"][^'\"]*gitContext/[A-Za-z]" -- adws ':!adws/gitContext' ':!adws/providers' ':!**/__tests__/**'` prints nothing.

### Step 8: Delete the unit tests of library internals

- **Ordering exception to "top to bottom": do Step 10 first, then come back here.** The deletion is only safe once `@adw-844` §6 is registered and green.
- Delete `adws/vcs/__tests__/commitOperations.test.ts` and `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` (stage the deletions with git so the diff records them).
- **Why the ordering: `@adw-844` §6 re-states what these files cover.** The issue's premise ("now live in `@paysdoc/devplatform`") is one step ahead of the repository: devplatform is not a dependency and `commitOps`/`branchOps` are still at `adws/gitContext/`. `adws/gitContext/__tests__/commitOps.test.ts` covers `commitChanges`/`removeAndCommitPaths`/`addAndCommitPaths` and nothing else, there is no `branchOps.test.ts`, so these two files are today the *only* cover for `getHeadTreeHash`, `hasUncommittedChanges`, `pushBranch`, `isLeaseRejection` and `branchOps.fetchAndResetToRemote`. Step 10's §6 step definitions (recording git runner: fetch-then-force-with-lease, fetch tolerated on a first push, lease-rejection wording discriminated from unrelated failures, fetch-then-hard-reset ordering) are what replaces them; confirm `@adw-844` §6 is green both before and after the deletion.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` and its `.adw/conditional_docs.md` conditions: remove or reword any sentence that points at those two files (the `adws/vcs/**` `Owns:` glob still matches the remaining vcs files, so no dead glob results).

### Step 9: Trim and rewrite the per-issue BDD step definitions

- `features/per-issue/feature-818.feature`: delete the three §7 scenarios "A GitLab code host built from a repository identifier and a client alone still refuses by name", "A Jira issue tracker built from a client and a project key alone still refuses by name" and the outline "The board manager factories still construct with no arguments and refuse by name", together with the TRAP 7 commentary that introduces them; keep the guard and type-check scenarios that close §7 and reword the section heading comment accordingly.
- `features/per-issue/step_definitions/feature-818.steps.ts`: remove the `GitLabCodeHost`, `GitLabApiClient`, `createGitLabBoardManager`, `JiraIssueTracker`, `JiraApiClient`, `createJiraBoardManager` and `BoardManager` imports, the `lastGitLabCodeHost`/`lastJiraTracker`/`lastBoardManager` state and their hook resets, the eight step definitions from "a GitLab code host is constructed with only …" through "asking it to find a board refuses naming …", and any helper (`expectThrows`, `expectRejects`, `REPO_ID_ACME_WIDGET_GITLAB`) left unused. The generated driver-script strings that name adapter paths stay: they are strings, not imports, and issue 840 owns their rewrite.
- `features/per-issue/step_definitions/feature-820.steps.ts`:
  - Replace `buildRefusalProvider` with a port-based builder: call `forgeProviders({ forge: { codeHost: 'gitlab', issueTracker: 'jira' }, identity: REFUSAL_REPO_ID, tokenProvider: { credentialEnv: () => ({}) }, gitContext, deps: { gitlab: { token: 'unused', instanceUrl: 'http://127.0.0.1:9' }, jira: { instanceUrl: 'http://127.0.0.1:9', projectKey: 'ADW', auth: { pat: 'unused' } } } })` once, where `gitContext` is a fixture `GitContext` bound to `acme/widget` with a no-op `exec` fake (follow `gitContextSharedWorld.ts`), and dispatch `JiraIssueTracker` → `providers.issueTracker`, `GitLabCodeHost` → `providers.codeHost`. The refusal messages are produced by the adapters, so the outline's expected `"<provider>.<method> is not implemented"` strings are unchanged. Import `forgeProviders` from `adws/providers/forgeProviders.ts`, `GitContext`/`TokenProvider` from the `adws/gitContext` barrel; remove the `JiraIssueTracker`, `JiraApiClient`, `GitLabCodeHost`, `GitLabApiClient` imports.
  - `buildWorkflowConfig(issueNumber, overrides: { prUrl?: string; labels?: string[] })` builds the `issue` as a port `Issue` (`id`, `number`, `title`, `body`, `state`, `author: 'tester'`, `labels`, `comments: []`, `createdAt`, `url`); the "configuration's issue carries the label" step pushes the string label; drop the `GitHubLabel` import.
  - **Do not remove or rename two step definitions this file owns**: `issue {int} in the recording tracker carries the labels {string} and {string}` (`:629`) and `the boundary's providers recorded no forge call` (`:884`). `features/per-issue/feature-844.feature` reuses both, and cucumber imports every per-issue step-definition file on every run, so deleting either turns `@adw-844` rows undefined. Re-run `--tags "@adw-844" --dry-run` after this step.
- `features/per-issue/feature-820.feature`: no scenario text needs to change; if the §9 commentary names the class constructors, reword it to say the ports are obtained through `forgeProviders`.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-818"` and `--tags "@adw-820"` (feature-820's header requires `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` set to any non-empty placeholder) and confirm the remaining scenarios pass and the step files import cleanly.

### Step 10: Write the `@adw-844` step definitions

- `features/per-issue/feature-844.feature` already exists and is this slice's RED suite; nothing in it may be reworded to fit the implementation. Create `features/per-issue/step_definitions/feature-844.steps.ts`.
- **Reuse, never redefine** — a redefinition is an `AmbiguousStepDefinition` that takes the whole per-issue run down. Verify with `--tags @adw-844 --dry-run` before writing. Already registered elsewhere: `the ADW codebase is checked out` (`features/step_definitions/ensureCronOnEveryEventSteps.ts:8`); `a launch boundary for the repository … whose providers record every call` (`feature-796.steps.ts:580`), `the local git remote answers …` (`:593`), `the boundary's git context is watched for forge-semantic calls` (`:599`), `the watched git context was asked for no forge-semantic operation` (`:615`), `every recorded provider call addressed the repository …` (`:1009`), `the local git remote was never read` (`:1017`); `issue {int} in the recording tracker carries the labels {string} and {string}` (`feature-820.steps.ts:629`), `the boundary's providers recorded no forge call` (`:884`); the guard-fixture phrases in `feature-816.steps.ts:65,78,106,113` and `feature-817.steps.ts:173`; the docs-index phrases in `feature-810.steps.ts:368,396`.
- **Three §7 phrases have no surviving registration anywhere and this slice owns them**: `the ADW TypeScript type-check passes`, `the git/gh guard is run across the repository` and `the git/gh guard reports no violations`. Six per-issue files (#796, #797, #810, #812, #816, #821) still attribute them to `feature-504.steps.ts` / `feature-691.steps.ts`, both of which have been deleted — verified: `grep -rn "^\(Given\|When\|Then\)(" features/ ` finds no registration for any of the three. Register them here. The guard pair must shell the whole `checkGitGhGuard.ts` binary so the construction rule's stale-entry ratchet stays inside what §7 asserts.
- Fixture discipline the feature file depends on: `adw-fixture/void-844` must not be a real repository, and `adw-fixture/elsewhere-844` is the deliberately *different* answer given to the local git remote in the wrong-repo rows — never swap the two or those rows stop discriminating.
- §4, §5 and §6 rows are pure-function / recording-runner rows: call the module under test in-process and assert its return value, its thrown message, or the git command strings a recording runner captured. No forge credential, no network.
- Consult `features/regression/vocabulary.md` before minting any new phrase.

### Step 11: Update living docs and the conditional-docs index

- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`: `fetchIssueRecord` now reads the port's `Issue` through `boundary.providers.issueTracker` (the GitHub-shaped record is gone; `createdAt`/`url` survive because `Issue` gained them); the boundary's default identity reader is `readLocalRepoIdentity` (`adws/core/localRepoIdentity.ts`); `adwGitHubForgeDeps(repoId, resolvePorts)`/`buildAdwForgeDeps(config, repoId, resolveProviders)` and the `forgeDeps` seam's thunk; `CWD_DERIVED_IDENTITY_FNS` is a three-name set.
- `app_docs/feature-9gjajh-github-api.md`: `buildNotifierDeps(resolvePorts, repoId)` reads `IssueTracker.fetchIssue` and `CodeHost.listPullRequests` (no `createGhRepoApi`); the announced PR link comes from `PullRequestRecord.url` rather than a synthesised `https://github.com/…/pull/N`; `Issue` carries `createdAt`/`url` and `PullRequestRecord` carries `updatedAt`/`url`; `fetchAllPRsCmd`'s `--json` list grew accordingly; `readLocalRepoInfo` is library-internal and ADW uses `readLocalRepoIdentity`.
- `app_docs/feature-9gjajh-health-check.md`: the two forge probes take port `Pick`s, `checkIssueNumber` is async, `main()` resolves the boundary's providers with graceful degradation.
- `app_docs/feature-9gjajh-dev-server-and-ports.md`: `convertToSshUrl` is ADW-owned in `adws/core/sshCloneUrl.ts`, host-neutral, and re-exported by `targetRepoManager.ts`.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`: `fetchIssueRecord(boundary.providers.issueTracker, …)`, the workspace-ensure-before-fetch ordering and why, `buildNotifierDeps(() => repoContext, …)` in the discard/error handlers.
- `app_docs/feature-9gjajh-classifier-and-routing.md`: `classifyGitHubIssue` takes a `ClassifiableIssue`.
- `.adw/conditional_docs.md`: add `adws/core/localRepoIdentity.ts` and `adws/core/__tests__/localRepoIdentity.test.ts` to the `feature-oqb76h-gitcontext-base-path-authority.md` `Owns:` list; add `adws/core/sshCloneUrl.ts` and `adws/core/__tests__/sshCloneUrl.test.ts` to `feature-9gjajh-dev-server-and-ports.md`; rewrite the `Conditions:` bullets that describe `fetchIssueRecord`'s GitHub shape, `buildNotifierDeps(ctx, repoId)`, the health-check `(ctx: GitContext)` signatures, and "`readLocalRepoInfo` lives in `adws/providers/github/githubIdentity.ts`" (now: ADW reads identity through `readLocalRepoIdentity`). Keep the file canonical (run `bun run lint:docs-index`).
- `README.md` line 17: optional one-clause update noting that since #844 ADW callers reach issue/PR reads through the `IssueTracker`/`CodeHost` ports and only the adapters use `ghRepoApi`.

### Step 12: Run the validation commands

- Run every command in the Validation Commands section; fix anything red; re-run until all pass with zero regressions and the regression counts from Step 1 are unchanged.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-844"` must be green with no undefined or pending steps.

## Testing Strategy

### Unit Tests

- `adws/core/__tests__/localRepoIdentity.test.ts` (new): parse matrix through the injected reader, including the two `ssh://` shapes a plain `parseOwnerRepoFromUrl` composition drops; both error paths keep the `Failed to get repo info:` prefix; the real-git dotted-name proof.
- `adws/core/__tests__/sshCloneUrl.test.ts` (new): the nine legacy `cloneUrl.test.ts` cases plus GitLab/self-hosted conversion, port, subgroup, `http://` and credential-bearing edge cases.
- `adws/core/__tests__/issueRecord.test.ts` (rewritten): delegation to a fake tracker, untouched result, no double-wrapped rejection.
- `adws/forge/__tests__/hitlBoardNotifier.test.ts` (updated): string labels, port-backed `buildNotifierDeps` (OPEN filter, forge-published URL passed through, `null` on throw, thunk laziness), newest-`updatedAt` linked-PR selection, merged-only silence.
- `adws/providers/__tests__` (updated): the `Issue` and `PullRequestRecord` fixtures gain the new fields; `fetchAllPRsCmd`'s expected command string gains `updatedAt,url`; `mapGitHubIssueToIssue` and Jira's `toIssue` are asserted to carry `createdAt`/`url` through.
- `adws/core/__tests__/forgeWiring.test.ts`, `adws/core/__tests__/launchGitContext.test.ts` (updated): new seam signature; the resolver thunk returns the boundary's memoised providers after the mint.
- `adws/__tests__/healthCheckChecks.test.ts` (updated): port fakes for the two forge probes; async `checkIssueNumber`.
- `adws/__tests__/checkGitGhGuard.test.ts` (updated): `readLocalRepoIdentity` composites flagged for both constructor shapes, explicit argument permitted, guarded-name row present.
- `adws/phases/__tests__/workflowInit.test.ts` (updated): `fetchIssueRecord` receives `providers.issueTracker`; `fakeIssue` on the port shape; workspace ensured before the fetch on a target run.
- Fixture reshapes only (no behaviour change): `gitAgent.test.ts`, `adwLabels.test.ts`, `issueClassifier.test.ts`, `branchNameResolution.test.ts`, `reviewPhase.test.ts`, `promotionRotAdvisory.test.ts`, `scenarioTestPhase.test.ts`, `pauseQueueScanner.test.ts`, `trigger_cron.test.ts`, `prReviewCompletion.test.ts`.
- Deleted: `adws/vcs/__tests__/commitOperations.test.ts`, `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` — their contracts move to `@adw-844` §6 (Step 10), which must be green before the deletion lands.
- BDD (new): `features/per-issue/step_definitions/feature-844.steps.ts`, including the three §7 phrases (`the ADW TypeScript type-check passes`, `the git/gh guard is run across the repository`, `the git/gh guard reports no violations`) that six other per-issue files reference but no file registers.

### Edge Cases

- First-clone target run: the issue fetch must not mint providers before `.adw/providers.md` exists; the reordered `initializeWorkflow` guarantees it. Self-host runs (`basePath = REPO_ROOT`) are unaffected.
- `IssueTracker.fetchIssue` failure: the GitHub tracker throws `Failed to fetch issue #N: …`; `fetchIssueRecord` must surface it once, not twice.
- Notifier: `listPullRequests()` throws → `listOpenPRs` returns `null` → no Slack message, and raising must not throw; issue without `hitl` → no message *and no PR listing at all* (the hitl gate runs before the listing today, and `listPullRequests` is a 200-item `gh pr list --state all` per notification); only linked PR merged → silence, not an "Approve to merge" ping; several open PRs link the issue → the newest `updatedAt` wins regardless of the forge's listing order; the announced link is the record's `url`; the thunk is never invoked during `forgeProviders` assembly.
- Health check: lazy mint throws (unrecognised forge name in `.adw/providers.md`) → a recorded check failure, the git checks still run; `getAuthenticatedUser()` returns `null` → `authenticated: false` without raising; GitLab code host `getAuthenticatedUser` *throws by name* → `authenticated: false`, success stays `true` with the existing warning (the refusal contract is why the `try/catch` must survive the port swap — dropping it because "the port already returns null" turns the whole health check into a stack trace); issue number `0` or `-1` → `Invalid issue number: N` with no forge call.
- `readLocalRepoIdentity`: HTTPS, SCP-style SSH, **`ssh://` (the shape a plain neutral-parser composition drops — it must keep resolving)**, credential-bearing, trailing slash, dotted repo names; a non-GitHub host now parses (platform stays `GitHub` by ADW convention) where the adapter helper used to throw; the resolved identity still carries `platform` (a composition that forgets to stamp it hands `providerConfig` an `undefined` to branch on); missing `origin` remote → `Failed to get repo info: …`.
- `convertToSshUrl`: explicit port, more or fewer than two path segments, `http://`, `ssh://`, SCP-style input, empty string → unchanged; userinfo dropped on conversion; trailing `.git` stripped exactly once.
- Guard: `readLocalRepoIdentity()` fed to `gitContextForRepo`/`forgeProviders` (inline or via a local) is flagged; `readLocalRepoIdentity(REPO_ROOT)` is not; `lint:git-guard` output otherwise byte-identical (same exempt set, same sanctioned sites, same scope count).
- BDD: every per-issue step-definition file still imports under cucumber; `@adw-818` and `@adw-820` remaining scenarios pass; `@regression` tag and scenario counts are exactly the Step 1 baseline.

## Acceptance Criteria

- Production imports into the adapters are exactly the two exempt files: `git grep -nE "^(import|export) .*from ['\"][^'\"]*providers/(github|gitlab|jira)" -- adws ':!adws/providers' ':!**/__tests__/**'` lists only `adws/core/launchGitContext.ts` and `adws/core/githubAppAuth.ts`. (The issue's broader grep over `features` and `test` additionally matches the per-issue `.feature` prose and the test-fixture step definitions for 796/797/810/819 and `gitContextSharedWorld.ts`, which the issue text explicitly exempts as test fixtures; the feature-818/820 step files no longer import adapter classes or clients.)
- No non-test import of a `gitContext` module: `git grep -nE "from ['\"][^'\"]*gitContext/[A-Za-z]" -- adws ':!adws/gitContext' ':!adws/providers' ':!**/__tests__/**'` prints nothing.
- `git grep -n "createGhRepoApi\|parseGitHubIssue\|selectPreferredPR\|readLocalRepoInfo\|convertToSshUrl\b" -- adws ':!adws/providers' ':!**/__tests__/**'` shows only ADW's own `convertToSshUrl` in `adws/core/sshCloneUrl.ts`/`targetRepoManager.ts` and the guard's name set.
- `adws/vcs/__tests__/commitOperations.test.ts` and `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` no longer exist; no test under `adws/` imports `adws/gitContext/commitOps` or `branchOps`; and `@adw-844` §6 carries the force-with-lease, lease-rejection and fetch-then-reset contracts those files were the only cover for.
- The agent prompts are byte-stable across the port crossing: `planAgent`/`scenarioAgent`'s `issueJson` still carries `createdAt`, `buildAgent` still prints the issue URL, and the rendered author/labels are the login string and the label names (never `undefined`).
- The HITL notifier announces the newest-`updatedAt` OPEN linked PR, stays silent when the only linked PR is merged, and links the URL the forge published.
- Every origin-remote shape `readLocalRepoInfo` resolves today — including `ssh://git@github.com/owner/repo[.git]` — still resolves through `readLocalRepoIdentity`.
- `features/per-issue/step_definitions/feature-844.steps.ts` exists and `--tags "@adw-844"` runs with no undefined or pending steps.
- `features/per-issue/step_definitions/feature-818.steps.ts` and `feature-820.steps.ts` import no adapter class or API-client type; their feature files are updated; `@regression` tag occurrences (46) and scenario count (53) are unchanged.
- No new `git`/`gh` shell-out; `bun run lint:git-guard` passes with the same exempt packages, sanctioned sites and scope count as before.
- `adws/gitContext/**` has no diff. `adws/providers/**` diffs *only* where the issue sanctions it ("add the missing field to the domain model in `adws/providers/types.ts` and both adapters"): `types.ts` (`Issue.createdAt`, `Issue.url`, `PullRequestRecord.updatedAt`, `PullRequestRecord.url`), `github/mappers.ts`, `github/commands/prCommands.ts`, `jira/jiraIssueTracker.ts` and their tests. No adapter gains a new operation, and no GitHub-only helper is added anywhere.
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
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-844"` - the issue's own scenarios; the file exists, so this must be green with no undefined or pending steps
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-844" --dry-run` - proves no step is ambiguous or unregistered before the suite is run for real
- `git grep -c "@regression" -- 'features/regression/**/*.feature' | awk -F: '{s+=$2} END {print s}'` - must print `46`
- `git grep -c "^\s*Scenario" -- 'features/regression/**/*.feature' | awk -F: '{s+=$2} END {print s}'` - must print `53`
- `git grep -nE "^(import|export) .*from ['\"][^'\"]*providers/(github|gitlab|jira)" -- adws ':!adws/providers' ':!**/__tests__/**'` - must list only `adws/core/launchGitContext.ts` and `adws/core/githubAppAuth.ts`
- `git grep -nE "from ['\"][^'\"]*gitContext/[A-Za-z]" -- adws ':!adws/gitContext' ':!adws/providers' ':!**/__tests__/**'` - must print nothing
- `git grep -n "GitLabApiClient\|JiraApiClient\|new GitLabCodeHost\|new JiraIssueTracker\|GitHubLabel" -- features` - must print nothing
- `git diff --stat -- adws/gitContext` - must be empty
- `git diff --stat -- adws/providers` - must touch only `types.ts`, `github/mappers.ts`, `github/commands/prCommands.ts`, `jira/jiraIssueTracker.ts` and their tests
- `bunx tsx adws/healthCheck.tsx 844` - end-to-end smoke of the port-based probes on the host (needs the operator's GitHub credentials; expect the issue check to report the title of issue 844)

## Notes

- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.
- **Issue-body corrections found during research.** (0) The issue's premise that `commitOps`/`branchOps` "now live in `@paysdoc/devplatform`" is one step ahead of the repository — the package is not a dependency and both modules are still at `adws/gitContext/`. The deletion the issue asks for still happens, guarded by Step 10's §6 rows. (1) `feature-818.steps.ts` and `feature-820.steps.ts` live under `features/per-issue/step_definitions/`, not `features/regression/`; neither carries `@regression`, so the "tag counts must not regress" clause is satisfied by leaving `features/regression/**` untouched. Neither file *instantiates* a `GitLabApiClient` either: each has a type-only import used for one `{} as GitLabApiClient` cast whose purpose is to prove an unimplemented adapter method refuses by name — a behaviour the health-check rows in `@adw-844` §3 depend on, so it must survive whichever of the issue's two options ("rewrite against the `CodeHost` port" or "drop the steps") is taken. (2) The issue's acceptance grep over `adws features test` can never list only two files: `adws/checkGitGhGuard.ts` and `adws/guard/*.ts` name `adws/providers/github` as guard configuration strings, the per-issue `.feature` files quote the paths in prose, and the 796/797/810/819 step definitions plus `gitContextSharedWorld.ts` are the test fixtures the issue text exempts. The plan therefore verifies the intent with the import-only grep in Validation Commands. (3) The ten `GitHubIssue`/`GitHubLabel`/`GitHubComment` type imports and `forgeWiring.ts`'s three config-type imports are not named in the issue but match its grep; both are removed here (port `Issue`, `ForgeProviderDeps` indexed types) so the two-file result holds. (4) The issue calls `parseOwnerRepoFromUrl` a "provider types" export; it lives in `adws/providers/workspaceValidation.ts`. (5) The issue's grep counts are worth stating precisely: 44 paths match across `adws features test` today, 27 under `adws/` alone.
- **The domain model is widened, not the prompts narrowed** (this supersedes an earlier draft of this plan that dropped `createdAt`/`url`). Four fields are short on the two port records and every one of them is read by production ADW code: `Issue.createdAt` (`planAgent.ts:40,268`, `scenarioAgent.ts:49`), `Issue.url` (`buildAgent.ts:111,116`), `PullRequestRecord.updatedAt` (the `selectPreferredPR` sort the issue calls "newest first") and `PullRequestRecord.url` (the link a human clicks). The issue's own rule settles all four: "add the missing field to the domain model in `adws/providers/types.ts` and both adapters, not a GitHub-only helper." Three facts make this cheap and non-blocking, all verified in the worktree: (1) `@paysdoc/devplatform` is not a dependency — absent from `package.json` and `node_modules` — so `adws/providers/**` is still local source and issue 840 carries the widened interfaces into the library when it extracts them, rather than depending on a release that predates them; (2) `ISSUE_FIELDS` in `github/commands/issueCommands.ts` already projects `createdAt,url` and `GitHubIssue` already declares both, so only `mapGitHubIssueToIssue` needs a line; (3) `GitLabCodeHost.listPullRequests` refuses by name, so the widened `PullRequestRecord` costs the GitLab adapter nothing. The parent PRD lists "Behavior changes of any workflow" as out of scope — "the extraction is intended to be operationally invisible" — and dropping `createdAt`/`url` would change every byte four agents see.
- **`updatedAt` is only fixed if the `gh` projection is fixed too.** `githubCodeHost.listPullRequests()` is `JSON.parse(this.gh.fetchAllPRs()) as PullRequestRecord[]` — a bare cast, no mapper — over `fetchAllPRsCmd`'s `--json number,body,state,mergedAt`. Widen `PullRequestRecord` without widening that list and every `updatedAt` is `undefined` at runtime, `new Date(undefined).getTime()` is `NaN`, the comparator returns `NaN` for every pair, and `Array.prototype.sort` leaves the forge's own order untouched: type-check green, unit suite green, wrong PR announced. Note this `NaN` is already the status quo — `buildNotifierDeps` currently casts `fetchAllPRs()` to `{number, body, state}` and stamps `updatedAt: ''` — so `@adw-844`'s two-open-PRs row is the one deliberate behaviour *change* in the notifier, and it goes green only when the type, the `--json` list and the selection are all fixed together.
- **Why the notifier takes a thunk.** `forgeWiring.buildAdwForgeDeps` runs *inside* `buildLaunchBoundary`'s lazy mint, before `forgeProviders` returns; the only way for the review-transition notifier to read through the ports it is being wired into is to resolve them at notification time. Re-entrancy is impossible in practice (assembly never moves an issue), but the JSDoc should say so.
- **`initializeWorkflow` ordering.** Moving `ensureTargetRepoWorkspace` before the issue fetch is required for correctness, not style: the lazy mint defaults to GitHub when `.adw/providers.md` is absent and memoises the result for the whole run. Keep `ensureTargetRepoWorkspace`'s existing `getDefaultBranch` thunk semantics (only invoked on the already-cloned branch).
- **What issue 840 still owns.** `adws/core/launchGitContext.ts`'s credential imports and `resolveBootstrapGitIdentity`, `adws/core/githubAppAuth.ts`'s `appAuth` import, the string paths inside feature-818's generated driver scripts, `features/regression/step_definitions/feature-729.steps.ts`'s `commitOps` import, and the `gitContextFixture` test helper. Do not touch them here.
- **Platform on `readLocalRepoIdentity`.** `RepoIdentifier.platform` is required and every existing local-identity consumer ignores or hard-codes `Platform.GitHub` (`buildLaunchBoundary`, `buildRepoIdentifier`, `resolveCronRepo`); inferring the platform from the remote host is a deliberate non-goal of this issue.
- No new libraries are required. If one were, install with `bun add <package>`.
- Keep every touched file under 300 lines; `hitlBoardNotifier.ts` and `healthCheckChecks.ts` shrink, `workflowInit.ts` only reorders a block.
