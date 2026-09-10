@adw-844 @adw-ejnsio-route-adw-callers-th
Feature: The last three raw-GitHub call sites answer through the forge ports, local repo identity and the SSH clone rewrite become host-neutral and ADW-owned, and nothing an operator sees changes on the way

  Issue #844 is the caller-side clearing that unblocks the ADW switchover (issue 840, kept open on
  purpose). #840's first build stopped because ADW still reaches AROUND the forge ports into the
  GitHub adapter (`createGhRepoApi`, `parseGitHubIssue`, `selectPreferredPR`, `readLocalRepoInfo`,
  `convertToSshUrl`) and into git-core internals. Everything here is ADW-side; nothing new is needed
  from the library. The launch boundary itself is untouched and moves to the library's forge-keyed
  credential factory in #840.

  The bar every row is written against is the PRD's: no behaviour change — same commands, same
  repositories, same operator-visible bytes. So each row is written to fail for a REASON: a specific
  wrong thing a plausible, tsc-green, unit-suite-green implementation does. None of them restates an
  acceptance criterion in Gherkin.

  ── WHY AC1 AND AC2 GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────────
  AC1 is a `git grep -l` over source files and AC2 is an import-graph property. Both are source-code
  assertions, which this suite does not make (see `features/regression/vocabulary.md`, Rot-Detection
  Rubric). §7's guard run and type-check are their nearest executable backstops. But both ACs also
  carry a factual problem the build must see before it starts, so they are recorded here.

  AC1 CANNOT PASS AS WRITTEN. Run it today and 27 files under `adws/` match, not the two it predicts.
  The five "What to build" items account for only six of them:

    (a) TEN FILES IMPORT AN ADAPTER-OWNED DOMAIN TYPE, not a forge operation.
        `providers/github/domain/issue` supplies `GitHubIssue` to `agents/buildAgent.ts`,
        `agents/gitAgent.ts`, `agents/planAgent.ts`, `agents/scenarioAgent.ts`,
        `core/issueClassifier.ts`, `phases/branchNameResolution.ts`, `phases/prReviewPhase.ts`,
        `phases/workflowInit.ts`; `GitHubLabel` to `core/adwLabels.ts`; `GitHubComment` to
        `core/workflowCommentParsing.ts`. #817 deliberately put those shapes there. Re-homing ten
        type imports is a design decision (where does the framework's issue record live?) that this
        issue neither states nor scopes, and §1's rows show why it is not free.
    (b) `core/forgeWiring.ts` imports `GitLabConfig`/`JiraAuth`/`JiraConfig` — configuration types
        for ADW's own environment wiring, which is exactly where #818 put them.
    (c) FIVE FILES MATCH ON A COMMENT OR A STRING, not an import: `checkGitGhGuard.ts` (its remedy
        text and its structural-exemption directory), `gitContext/bootstrapIdentity.ts`,
        `gitContext/index.ts`, `gitContext/repoWorkspace.ts` (doc comments) and
        `guard/constructionRule.ts` / `guard/extractionRule.ts` (`EXTRACTION_SCOPE` path literals —
        deleting those *disables the extraction guard #816/#817/#818/#819 built*).

    The honest narrowing is `git grep -l "from '.*providers/\(github\|gitlab\|jira\)/"` restricted to
    value imports, which the five items above do reduce to `launchGitContext.ts` and
    `githubAppAuth.ts`. Widening this issue to (a) and (b) instead would make it a second domain-model
    slice; deleting (c) would silently gut three guards. The build should narrow the criterion, not
    the guards.

  AC2 IS ALREADY TRUE EXCEPT WHERE THE FIVE ITEMS DO NOT REACH. The only non-test deep
  `adws/gitContext/<module>` imports outside the library packages are `healthCheck.tsx:18` and
  `healthCheckChecks.ts:12`, both `import type { GitContext } from './gitContext/gitContext'` — the
  barrel already exports it. Item 1's health-check work touches both files, so the two-line fix
  belongs here. The remaining deep imports are library-internal
  (`providers/github/githubIdentity.ts`, `githubTokenProvider.ts`, `gitlabApiClient.ts`,
  `jiraApiClient.ts`, `jiraIssueTracker.ts`) — routing a package's cross-package imports through
  the barrel is #840's concern, and doing it here risks the `../../core` import cycle #792 closed.

  ── SIX FINDINGS THE ISSUE BODY DOES NOT CARRY ───────────────────────────────────────────────

  FINDING 1 — THE PORT'S `Issue` CANNOT CARRY WHAT `issueRecord` RETURNS. `issueRecord.ts`'s own
  doc comment says so, and it is right. `WorkflowConfig.issue` is a `GitHubIssue`; the port's `Issue`
  is `{id, number, title, body, state, author: string, labels: string[], comments}`. Four things are
  lost or reshaped at the crossing, and every one is printed into an agent prompt:
    • `issue.url`        — `buildAgent.ts:111,116`. ABSENT from `Issue`.
    • `issue.createdAt`  — `planAgent.ts:40,268`, `scenarioAgent.ts:49`. ABSENT from `Issue`.
    • `issue.author.login` → `Issue.author` is already the login string (`planAgent.ts:38,266`).
    • `issue.labels.map(l => l.name)` → `Issue.labels` is already `string[]`
      (`planAgent.ts:39,267`, `scenarioAgent.ts:48`, `adwLabels.ts:96`, `issueClassifier.ts:188`).
  `planAgent.ts:262-268` and `scenarioAgent.ts:43-49` then `JSON.stringify` the result whole into the
  prompt. Dropping `url`/`createdAt` changes every byte the plan and scenario agents see, silently,
  with a green type-check if the record type is widened to optionals. The issue's own instruction for
  the PR case settles the shape of the fix: add the missing fields to the domain model in
  `adws/providers/types.ts` and BOTH adapters, never a GitHub-only helper. §1 asserts the four
  behaviours; it does not prescribe the type.

  FINDING 2 — `PullRequestRecord` IS MISSING `updatedAt` AND SO IS THE `gh` PROJECTION.
  `selectPreferredPR` sorts on `updatedAt`. `PullRequestRecord` is `{number, body, state, mergedAt}`.
  Adding `updatedAt` to the interface is half the fix: `githubCodeHost.listPullRequests()` is
  `JSON.parse(this.gh.fetchAllPRs()) as PullRequestRecord[]` — a BARE CAST, no mapper — over
  `fetchAllPRsCmd`'s `--json number,body,state,mergedAt`. Widen the type without widening the `gh`
  projection and every `updatedAt` is `undefined` at runtime, `new Date(undefined).getTime()` is
  `NaN`, the comparator returns `NaN` for every pair, and `Array.prototype.sort` leaves the forge's
  own order untouched. Type-check green, unit suite green, wrong pull request announced. §2's
  two-open-PRs row is the only thing in the repository that fails on it.

  FINDING 3 — THE NOTIFIER FILTERS TO OPEN *BEFORE* PREFERRING OPEN. `buildNotifierDeps.listOpenPRs`
  reads `fetchAllPRs` and keeps `state === 'OPEN'`; `selectPreferredPR` then prefers open and falls
  back to newest-overall. Today that fallback is unreachable — the pool is already open-only, so an
  issue whose only linked pull request is merged gets NO Slack ping. `CodeHost.listPullRequests()`
  returns state=all. Hand it straight to `selectPreferredPR` and the fallback wakes up: a merged pull
  request is announced as ":eyes: … Approve to merge", pointing a human at a pull request that was
  merged last week. §2 pins both halves.

  FINDING 4 — `parseOwnerRepoFromUrl` IS NOT A SUPERSET OF `parseGitHubRemoteUrl`. Item 2 composes
  `readLocalRepoIdentity` from `readOriginRemoteUrl` + `parseOwnerRepoFromUrl`. Three divergences:
    • `ssh://git@github.com/owner/repo[.git]` RESOLVES today (`parseGitHubRemoteUrl`'s HTTPS pattern
      is unanchored and matches the `github.com/…` tail) and returns NULL under
      `parseOwnerRepoFromUrl` (its HTTPS branch needs `https?://`; its SSH branch needs a colon after
      the host). A clone made with the `ssh://` scheme stops resolving its own identity.
    • `https://gitlab.com/acme/widget.git` THROWS today and RESOLVES under the neutral parser. The
      issue asks for the same error message on failure; it does not say the set of failures shrinks.
    • `parseOwnerRepoFromUrl` returns `{owner, repo}` with NO `platform`, and `RepoIdentifier`
      requires one. Stamping `Platform.GitHub` unconditionally is what every current caller expects
      (`buildRepoIdentifier`, `resolveEntryRepoInfo` and `buildLaunchBoundary`'s default all already
      hard-code it) — but combined with the second divergence it means a GitLab checkout now yields a
      GitHub-platform identity instead of a loud failure. §4 pins the shapes that must keep working,
      the message that must not change, and the platform that must still be carried.

  FINDING 5 — RENAMING THE IDENTITY READER CAN SILENTLY KILL A GUARD.
  `guard/identityRule.ts:35` is `CWD_DERIVED_IDENTITY_FNS = new Set(['getRepoInfo',
  'readLocalRepoInfo'])` — a NAME-based AST match, which its own doc comment explains is why retired
  names stay in the set. Introduce `readLocalRepoIdentity` and retire `readLocalRepoInfo` without
  adding the new name and the `cwd-derived-identity` rule stops matching the composite it exists to
  catch. Nothing fails: the guard goes quietly dead rather than red. §4's last row is the only thing
  that notices.

  FINDING 6 — ITEM 4'S PREMISE AND ITS FILE PATHS ARE BOTH WRONG.
    • `@paysdoc/devplatform` IS NOT A DEPENDENCY of this repository and is absent from
      `node_modules`. `commitOps` and `branchOps` still live at `adws/gitContext/commitOps.ts` and
      `adws/gitContext/branchOps.ts`. They move in #840, not here.
    • THE TWO TEST FILES DO NOT OVERLAP WITH WHAT SURVIVES.
      `adws/gitContext/__tests__/commitOps.test.ts` covers `commitChanges`, `removeAndCommitPaths`
      and `addAndCommitPaths` — and nothing else. `adws/vcs/__tests__/commitOperations.test.ts`
      covers `getHeadTreeHash`, `hasUncommittedChanges`, `pushBranch` and `isLeaseRejection`. The
      intersection is EMPTY. There is no `branchOps.test.ts` at all, so
      `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` is the sole cover for
      `branchOps.fetchAndResetToRemote`. Deleting both files deletes the only executable statement of
      the force-with-lease contract and the fetch-then-reset ordering, months before the modules move.
    • THE STEP-DEFINITION FILES ARE NOT WHERE THE ISSUE SAYS AND DO NOT DO WHAT IT SAYS.
      There is no `features/regression/step_definitions/feature-818.steps.ts` or `feature-820.steps.ts`;
      both live under `features/per-issue/step_definitions/` and are tagged `@adw-818` / `@adw-820`,
      not `@regression`. Neither instantiates `GitLabApiClient`: each has a TYPE-ONLY import used for
      one cast, `new GitLabCodeHost(REPO_ID, {} as GitLabApiClient)`, whose whole purpose is to prove
      an unimplemented adapter method REFUSES BY NAME. That is a behaviour, it is the behaviour §3's
      health-check row depends on, and rewriting it "against the CodeHost port" would delete the only
      cover for the refusal contract. §6 keeps the contracts and lets the file inventory follow.

  ── HOW THESE ROWS RUN ────────────────────────────────────────────────────────────────────────
    • REUSED, NEVER REDEFINED — verified against a `--tags @adw-844 --dry-run` resolution, because
      several of the attributions neighbouring feature files carry in their comments are now stale.
      Redefining a live phrase is an AmbiguousStepDefinition. What resolves TODAY:
        - `features/step_definitions/ensureCronOnEveryEventSteps.ts:8` — `the ADW codebase is
          checked out` (G18).
        - `feature-796.steps.ts` — `a launch boundary for the repository … whose providers record
          every call` (`:580`), `the local git remote answers …` (`:593`), `the boundary's git
          context is watched for forge-semantic calls` (`:599`), `the watched git context was asked
          for no forge-semantic operation` (`:615`), `every recorded provider call addressed the
          repository …` (`:1009`), `the local git remote was never read` (`:1017`).
        - `feature-820.steps.ts` — `issue {int} in the recording tracker carries the labels {string}
          and {string}` (`:628`), `the boundary's providers recorded no forge call` (`:884`).
        - `feature-816.steps.ts` — `a guard fixture tree holding the file {string}:` (`:65`), `the
          guard runner executes over the guard fixture tree` (`:78`), `the guard run over the guard
          fixture tree passes` (`:106`), `… fails naming {string}` (`:113`).
        - `feature-817.steps.ts` — `the guard failure over the guard fixture tree cites the {string}
          rule` (`:173`).
        - `feature-810.steps.ts` — `the docs-index gate is run over the ADW checkout` (`:368`), `the
          docs-index gate exits 0` (`:396`).
    • THREE §7 PHRASES HAVE NO SURVIVING DEFINITION AND THIS SLICE MUST SUPPLY THEM.
      `the ADW TypeScript type-check passes` (vocabulary T22) and the pair `the git/gh guard is run
      across the repository` / `the git/gh guard reports no violations` are used by #796, #797, #810,
      #812, #816 and #821 and are attributed in those files' header comments to
      `feature-504.steps.ts` and `feature-691.steps.ts` — both of which have since been deleted. No
      registration for any of the three exists anywhere under `features/` today. They are not
      reuse; they are new step definitions this slice owns. The guard pair must shell the whole
      `checkGitGhGuard.ts` binary, so the construction rule's stale-entry ratchet stays inside what
      §7 asserts.
    • THE FIXTURE REPOSITORY MUST NOT EXIST. A RED run reaches un-migrated code that shells out for
      real. Every row uses `adw-fixture/void-844`, which is not a repository, so the worst a RED run
      does is fail a `gh` call slowly. `adw-fixture/elsewhere-844` is the deliberately DIFFERENT
      answer given to the local git remote in the wrong-repo rows — never swap the two, or those rows
      stop discriminating.
    • §4, §5 and §6 are PURE-FUNCTION and RECORDING-RUNNER rows: they call the module under test
      in-process and assert its return value, its thrown message, or the git command strings a
      recording runner captured. No forge credential, no network.

  Background:
    Given the ADW codebase is checked out

  # ── §1  THE ISSUE RECORD THROUGH THE TRACKER PORT (item 1, `adws/core/issueRecord.ts`) ─────
  #
  # `fetchIssueRecord(ctx, n)` is `parseGitHubIssue(createGhRepoApi(ctx).fetchIssue(n))` wrapped in
  # one error message. Its single production caller is `workflowInit.ts:167`, which assigns the
  # result to `WorkflowConfig.issue` and hands it to four agents. The port takes its place; the
  # AGENTS' INPUT MUST NOT MOVE. FINDING 1 lists the four fields at risk; these are the four rows.
  #
  # The tracker arrives through the launch boundary's `BoundProviders` — `workflowInit` already
  # holds `boundary.providers`. Nothing here may construct a provider.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A fetched issue record still carries the pull-request url the build agent prints
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker has the url "https://github.com/adw-fixture/void-844/issues/42"
    When the issue record for issue 42 is read from that boundary
    Then the issue record's url is "https://github.com/adw-fixture/void-844/issues/42"

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A fetched issue record still carries the creation timestamp the plan agent prints
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker was created at "2026-09-01T09:15:00Z"
    When the issue record for issue 42 is read from that boundary
    Then the issue record's creation timestamp is "2026-09-01T09:15:00Z"

  # `planAgent.ts:266` is `author: issue.author.login` and `:38` prints `${issue.author.login}`. The
  # port hands back a login STRING. A migration that leaves both call sites alone renders
  # "**Author:** undefined" into the plan prompt and type-checks clean if the record type widened to
  # `string | GitHubUser`. The observable is the rendered value, not the shape it travelled in.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The author the plan agent renders is the login, not an undefined property read
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker was opened by "octocat"
    When the plan agent's issue section is rendered for issue 42 from that boundary
    Then the rendered issue section names the author "octocat"
    And the rendered issue section contains no "undefined"

  # Same trap one field over: `issue.labels.map(l => l.name)` against a `string[]` yields
  # `[undefined, undefined]`, which joins to "undefined, undefined" in the prompt and makes
  # `readAdwLabelNames` (`adwLabels.ts:96`) classify nothing.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The labels the plan agent renders and the classifier reads survive the port crossing
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker carries the labels "adw:feature" and "hitl"
    When the plan agent's issue section is rendered for issue 42 from that boundary
    Then the rendered issue section names the labels "adw:feature, hitl"
    And the adw classification read from that issue record is "adw:feature"

  # The error contract is load-bearing: `workflowInit` has no handler of its own, so this string is
  # what an operator sees on a bad issue number. The port throws its own adapter-shaped message
  # inside; the wrap must survive it.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A failed issue read still fails with the message the caller's error contract names
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the recording tracker refuses to read issue 42
    When the issue record for issue 42 is read from that boundary
    Then reading the issue record failed with a message beginning "Failed to fetch issue #42:"

  # The point of the whole item. `createGhRepoApi(ctx)` is a bound view over the context — it issues
  # `gh` itself. Once the tracker answers, the context must be asked for no forge operation at all,
  # and a local remote naming another repository must not be able to redirect the read.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The issue record is read through the boundary's tracker and not over its git context
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    When the issue record for issue 42 is read from that boundary
    Then the boundary's providers were asked to fetch issue 42
    And the watched git context was asked for no forge-semantic operation

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A local git remote naming another repository cannot redirect the issue record read
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-844"
    When the issue record for issue 42 is read from that boundary
    Then every recorded provider call addressed the repository "adw-fixture/void-844"
    And the local git remote was never read

  # ── §2  THE HITL BOARD NOTIFIER THROUGH THE PORTS (item 1, `adws/forge/hitlBoardNotifier.ts`) ──
  #
  # `buildNotifierDeps` is the last bound-repo-API reader set. `readIssue` → `IssueTracker.fetchIssue`
  # is uneventful once §1's fields exist. `listOpenPRs` → `CodeHost.listPullRequests()` is not:
  # FINDING 2 (the missing `updatedAt`, in the type AND in the `gh --json` projection) and FINDING 3
  # (state=all wakes a fallback that is unreachable today) both land here, and both are invisible to
  # every existing suite because `notifyReviewTransition` swallows everything it throws.
  #
  # `findPullRequestByBranch` is offered by the issue and cannot serve: it returns
  # `PullRequestSummary`, which carries no `body`, and `bodyLinksIssue(pr.body, issueNumber)` is the
  # entire matching rule. `listPullRequests` is the only usable port method.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The announced pull request is the open one, not the merged one updated more recently
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "A stuck workflow" and carries the label "hitl"
    And the recording code host has pull request 7 open, linking issue 42, updated at "2026-09-01T10:00:00Z"
    And the recording code host has pull request 9 merged, linking issue 42, updated at "2026-09-08T10:00:00Z"
    When the review-transition notification is raised for issue 42 from that boundary
    Then the review-transition notification announces pull request 7

  # FINDING 3, stated as the behaviour that must NOT change. Today the merged-only issue produces
  # silence because `listOpenPRs` filtered before `selectPreferredPR` could prefer. Hand state=all
  # straight through and a human is paged to approve a pull request that merged last week.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: An issue whose only linked pull request is merged raises no review-transition notification
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "Already landed" and carries the label "hitl"
    And the recording code host has pull request 9 merged, linking issue 42, updated at "2026-09-08T10:00:00Z"
    When the review-transition notification is raised for issue 42 from that boundary
    Then no review-transition notification was announced

  # FINDING 2's discriminating row. Both candidates are OPEN, so the open-preference cannot decide
  # and the `updatedAt` sort is the only thing left. A `PullRequestRecord` widened in the type but not
  # in `fetchAllPRsCmd`'s `--json` list yields `NaN` comparisons, a no-op sort, and whichever pull
  # request the forge happened to list first.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: Two open linked pull requests resolve to the one the forge updated most recently
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "Two attempts" and carries the label "hitl"
    And the recording code host has pull request 7 open, linking issue 42, updated at "2026-09-02T10:00:00Z"
    And the recording code host has pull request 8 open, linking issue 42, updated at "2026-09-09T10:00:00Z"
    And the recording code host lists pull request 7 before pull request 8
    When the review-transition notification is raised for issue 42 from that boundary
    Then the review-transition notification announces pull request 8

  # `buildNotifierDeps` synthesises `https://github.com/${owner}/${repo}/pull/${number}` — a
  # GitHub-only path shape assembled inside what is becoming a host-neutral caller. GitLab's is
  # `/-/merge_requests/`. The link is what the human clicks, so it must come from the forge.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The announced link is the url the forge published, not one assembled from owner and repo
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "A stuck workflow" and carries the label "hitl"
    And the recording code host has pull request 7 open, linking issue 42, updated at "2026-09-02T10:00:00Z"
    And pull request 7 in the recording code host has the url "https://forge.example/adw-fixture/void-844/-/merge_requests/7"
    When the review-transition notification is raised for issue 42 from that boundary
    Then the announced notification link is "https://forge.example/adw-fixture/void-844/-/merge_requests/7"

  # The hitl gate runs BEFORE the pull-request listing today, so a non-hitl issue costs one issue read
  # and nothing else. `listPullRequests` is a 200-item `gh pr list --state all` per notification; a
  # migration that hoists it above the gate multiplies that across every board move.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: An issue without the hitl label is not announced and costs no pull-request listing
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "Ordinary work" and carries no labels
    When the review-transition notification is raised for issue 42 from that boundary
    Then no review-transition notification was announced
    And the boundary's providers were asked for no pull-request listing

  # `listPullRequests` "Throws on failure — callers own the swallow policy" (`types.ts`). The legacy
  # `listOpenPRs` returned null on any parse or command failure and the notifier treated null as
  # "nothing to announce". The no-throw-at-boundary contract in this module's own header must hold
  # through the port, or a forge hiccup during a board move takes the workflow down with it.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A code host that throws while listing pull requests leaves the notifier silent, not raising
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "A stuck workflow" and carries the label "hitl"
    And the recording code host refuses to list pull requests
    When the review-transition notification is raised for issue 42 from that boundary
    Then no review-transition notification was announced
    And raising the review-transition notification did not fail

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The blocked-transition notification reads its issue through the tracker the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    And issue 42 in the recording tracker is titled "A stuck workflow" and carries the label "hitl"
    When the blocked-transition notification is raised for issue 42 from that boundary for a discarded workflow
    Then the boundary's providers were asked to fetch issue 42
    And the blocked-transition notification announces issue 42 as discarded
    And the watched git context was asked for no forge-semantic operation

  # ── §3  THE HEALTH CHECK THROUGH THE PORTS (item 1, `adws/healthCheckChecks.ts`) ────────────
  #
  # Two checks, both taking a `GitContext` today and both about to take a provider instead.
  #
  # `checkGitHubCLI:196` wraps `authenticatedUser()` in try/catch and reads a throw as unauthenticated.
  # `CodeHost.getAuthenticatedUser()` returns NULL for the same condition and warns once — so the
  # natural reading ("the port already handles it, drop the catch") is exactly wrong: `GitLabCodeHost`
  # REFUSES BY NAME rather than returning null, and an uncaught refusal turns the whole health check
  # into a stack trace. The refusal contract those `{} as GitLabApiClient` step definitions prove
  # (FINDING 6) is what these rows lean on.
  #
  # `checkIssueNumber:270` is SYNCHRONOUS and `healthCheck.tsx:144` calls it without `await`.
  # `IssueTracker.fetchIssue` is async. The check and its call site both become async, or the check
  # returns a pending promise and `details.title` is `undefined` in every health report.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: An authenticated code host is reported as authenticated by the forge health check
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the recording code host reports the authenticated user "adw-bot"
    When the forge authentication health check runs from that boundary
    Then the forge authentication health check reports authenticated

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A code host that cannot name its user is reported unauthenticated rather than failing the check
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the recording code host cannot determine its authenticated user
    When the forge authentication health check runs from that boundary
    Then the forge authentication health check reports not authenticated
    And the forge authentication health check reported a result rather than raising

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A code host that refuses the operation by name still yields a health verdict
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the recording code host refuses to name its authenticated user by name
    When the forge authentication health check runs from that boundary
    Then the forge authentication health check reports not authenticated
    And the forge authentication health check reported a result rather than raising

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: An accessible issue is reported with the title and state the health report prints
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "A stuck workflow" and is in state "OPEN"
    When the issue-accessibility health check runs for issue 42 from that boundary
    Then the issue-accessibility health check succeeds
    And the issue-accessibility health check reports the title "A stuck workflow"
    And the issue-accessibility health check reports the state "OPEN"

  # The legacy check had three failure branches over a raw JSON string: the command threw, the string
  # contained "Could not resolve", or the string failed to parse. Through the port the last two are
  # unreachable — `fetchIssue` returns a parsed `Issue` or throws. The operator-visible message for
  # an unreachable issue must not change as those branches collapse into one.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: An unreachable issue reports the same accessibility error it reports today
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the recording tracker refuses to read issue 42
    When the issue-accessibility health check runs for issue 42 from that boundary
    Then the issue-accessibility health check fails with the error "Issue #42 not found or not accessible"

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario Outline: A malformed issue number is rejected before the forge is asked anything
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    When the issue-accessibility health check runs for issue <number> from that boundary
    Then the issue-accessibility health check fails with the error "Invalid issue number: <number>"
    And the boundary's providers recorded no forge call

    Examples:
      | number |
      | 0      |
      | -1     |

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The health check reaches the forge only through the boundary's providers
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    And issue 42 in the recording tracker is titled "A stuck workflow" and is in state "OPEN"
    And the recording code host reports the authenticated user "adw-bot"
    When the forge authentication health check runs from that boundary
    And the issue-accessibility health check runs for issue 42 from that boundary
    Then the watched git context was asked for no forge-semantic operation

  # ── §4  LOCAL REPO IDENTITY WITHOUT THE GITHUB ADAPTER (item 2) ────────────────────────────
  #
  # `readLocalRepoIdentity(cwd?)` replaces five `readLocalRepoInfo` imports: `orchestratorCli:143`,
  # `healthCheck.tsx:112`, `pauseQueueScanner:57`, `trigger_cron:61` and `launchGitContext:195`'s
  # `deps.getRepoInfo ?? ` default. Every one of those five feeds a `RepoIdentifier` into a launch
  # boundary or a token pin, so a shape that stops resolving is not a cosmetic loss — it is a process
  # that cannot start.
  #
  # FINDING 4 has the whole argument. The outline is the compatibility surface: each row is a remote
  # `readLocalRepoInfo` resolves TODAY and must still resolve. The `ssh://` rows are the ones a
  # straight `readOriginRemoteUrl` + `parseOwnerRepoFromUrl` composition drops.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario Outline: Every origin remote shape that resolves today still resolves to the same identity
    Given a checkout whose origin remote is "<remote>"
    When the local repo identity is read from that checkout
    Then the local repo identity is owner "<owner>" and repo "<repo>"

    Examples:
      | remote                                                     | owner   | repo        |
      | https://github.com/acme/webapp                             | acme    | webapp      |
      | https://github.com/acme/webapp.git                         | acme    | webapp      |
      | https://github.com/acme/webapp/                            | acme    | webapp      |
      | git@github.com:acme/webapp.git                             | acme    | webapp      |
      | git@github.com:acme/webapp                                 | acme    | webapp      |
      | https://x-access-token:TOKEN@github.com/acme/webapp.git    | acme    | webapp      |
      | ssh://git@github.com/acme/webapp                           | acme    | webapp      |
      | ssh://git@github.com/acme/webapp.git                       | acme    | webapp      |
      | https://github.com/paysdoc/paysdoc.nl                      | paysdoc | paysdoc.nl  |
      | https://github.com/paysdoc/paysdoc.nl.git                  | paysdoc | paysdoc.nl  |

  # `buildRepoIdentifier`, `resolveEntryRepoInfo` and `buildLaunchBoundary` all stamp
  # `Platform.GitHub` on the identities they build; `providerConfig` then branches on it to pick an
  # adapter. A host-neutral parser that returns `{owner, repo}` and a composition that forgets to
  # stamp anything produces an identity whose `platform` is `undefined` and an adapter choice made by
  # a falsy default.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The resolved identity still carries the platform the provider selection branches on
    Given a checkout whose origin remote is "https://github.com/acme/webapp.git"
    When the local repo identity is read from that checkout
    Then the local repo identity declares the platform "github"

  # "Same error message on failure" — the exact string, because `@adw-779` already asserts on it and
  # `healthCheck.tsx:112` renders it into the health report's `gitContext` failure.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A remote that cannot be parsed fails with the message it fails with today
    Given a checkout whose origin remote is "not-a-url"
    When the local repo identity is read from that checkout
    Then reading the local repo identity failed with a message beginning "Failed to get repo info:"

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A checkout with no origin remote fails with the same message rather than a raw git error
    Given a checkout with no origin remote
    When the local repo identity is read from that checkout
    Then reading the local repo identity failed with a message beginning "Failed to get repo info:"

  # The reader is a `git remote get-url origin` and a regex. It must never reach a forge — this is
  # the pre-context read that runs before any credential exists, and #812 showed what an eager forge
  # call does on a host with no App installation.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: Reading the local repo identity issues no forge request
    Given a checkout whose origin remote is "https://github.com/acme/webapp.git"
    When the local repo identity is read from that checkout
    Then reading the local repo identity issued no forge request

  # FINDING 5. The guard is name-based and this issue introduces a name. A fixture carrying the
  # composite the rule exists to catch must still fail under `cwd-derived-identity` — if it passes,
  # the rule has gone dead and nothing else in the repository says so.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A context constructed from a zero-argument identity read is still flagged after the rename
    Given a guard fixture tree holding the file "adws/core/probeOps.ts":
      """
      import { readLocalRepoIdentity } from './readLocalRepoIdentity';
      import { gitContextForRepo } from '../providers/github/gitContextFactory';

      export function probe(): unknown {
        const info = readLocalRepoIdentity();
        return gitContextForRepo(info);
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/core/probeOps.ts"
    And the guard failure over the guard fixture tree cites the "cwd-derived-identity" rule

  # The other edge of the same rule: `healthCheck.tsx:112` passes REPO_ROOT explicitly, and that is
  # what makes it legal. A rename that made the rule match on arity alone would turn the repository's
  # own self-host boundary red.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: An identity read given an explicit root is not flagged as cwd-derived
    Given a guard fixture tree holding the file "adws/core/probeOps.ts":
      """
      import { readLocalRepoIdentity } from './readLocalRepoIdentity';
      import { gitContextForRepo } from '../providers/github/gitContextFactory';

      export function probe(root: string): unknown {
        return gitContextForRepo(readLocalRepoIdentity(root));
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # ── §5  THE SSH CLONE REWRITE WITHOUT THE GITHUB ADAPTER (item 3) ──────────────────────────
  #
  # `targetRepoManager.ts` applies `convertToSshUrl` at two sites (`:48` clone, `:72` ensure) before
  # handing the core a URL — since #793 the core clones exactly what it is given. The host-neutral
  # rule the issue states is `https://<host>/<owner>/<repo>[.git]` → `git@<host>:<owner>/<repo>.git`,
  # anything else passed through.
  #
  # THAT RULE CHANGES BEHAVIOUR ON PURPOSE, IN ONE ROW. `cloneUrl.test.ts` currently asserts
  # `https://gitlab.com/acme/webapp.git` is returned UNCHANGED, because the old guard was
  # `startsWith('https://github.com/')`. Host-neutral means it converts, and a GitLab target repo is
  # cloned over SSH — which needs a key on the box that HTTPS did not. That is the issue's stated
  # intent, so the outline states it as intent; the existing unit expectation is the thing that
  # changes, and it should change deliberately rather than be discovered.
  #
  # The `ssh://` row is the compatibility half: it is not `https://`, so it passes through, exactly as
  # `cloneUrl.test.ts` already requires — a naive "any scheme" rewrite double-converts it.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario Outline: The clone-url rewrite is host-neutral and passes everything else through
    When the clone url "<input>" is prepared for cloning
    Then the prepared clone url is "<output>"

    Examples:
      | input                                        | output                                   |
      | https://github.com/acme/webapp               | git@github.com:acme/webapp.git           |
      | https://github.com/acme/webapp.git           | git@github.com:acme/webapp.git           |
      | https://github.com/paysdoc/paysdoc.nl.git    | git@github.com:paysdoc/paysdoc.nl.git    |
      | https://github.com/acme-corp/web-app.config  | git@github.com:acme-corp/web-app.config.git |
      | https://gitlab.com/acme/webapp.git           | git@gitlab.com:acme/webapp.git           |
      | https://forge.example/acme/webapp            | git@forge.example:acme/webapp.git        |
      | git@github.com:acme/webapp.git               | git@github.com:acme/webapp.git           |
      | ssh://git@github.com/acme/webapp.git         | ssh://git@github.com/acme/webapp.git     |
      | not-a-url                                    | not-a-url                                |
      |                                              |                                          |

  # The rewrite is only worth anything if it is still applied where it was applied. `cloneRepo` is
  # handed the converted URL, not the published one.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A target repository is cloned from the rewritten ssh url, not the published https one
    Given a target repository "acme/webapp" published at "https://github.com/acme/webapp.git" that has never been cloned
    When the target repository workspace is ensured
    Then the recorded clone was issued for "git@github.com:acme/webapp.git"

  # ── §6  THE CONTRACTS THE DELETED TESTS CARRIED (item 4) ───────────────────────────────────
  #
  # FINDING 6 is the argument; these are the four behaviours that must not lose their only cover.
  # `commitOps.pushBranch` and `branchOps.fetchAndResetToRemote` are driven in-process with a
  # recording runner — the git command strings it captures are the assertion target, so no repository
  # and no remote is needed. Whether the two `adws/vcs/__tests__/` files survive is then a file-
  # inventory question these rows make safe to answer either way.
  #
  # The lease contract is not a detail: `pushBranch` force-pushes with `--force-with-lease`, and
  # `isLeaseRejection` is what tells an orchestrator "someone else moved this branch" apart from
  # "the push failed". Collapsing the two makes a concurrent-worktree collision look like a network
  # error and the workflow retries into a clobber.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A branch push fetches before force-pushing with a lease
    Given a recording git runner
    When the branch "adw-844-probe" is pushed from the worktree "/wt"
    Then the recorded git commands are a fetch of "adw-844-probe" followed by a force-with-lease push
    And every recorded git command ran in "/wt"

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A first push to a branch with no remote ref tolerates the failing fetch and still pushes
    Given a recording git runner whose fetch fails
    When the branch "adw-844-probe" is pushed from the worktree "/wt"
    Then a force-with-lease push was recorded
    And pushing the branch did not fail

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario Outline: A push rejected because the remote moved is reported as a lease rejection
    Given a recording git runner whose push is rejected with "<stderr>"
    When the branch "adw-844-probe" is pushed from the worktree "/wt"
    Then pushing the branch failed as a lease rejection

    Examples:
      | stderr                                         |
      | stale info                                     |
      | remote ref updated since checkout              |

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A push rejected for an unrelated reason is not reported as a lease rejection
    Given a recording git runner whose push is rejected with "could not resolve host github.com"
    When the branch "adw-844-probe" is pushed from the worktree "/wt"
    Then pushing the branch failed without lease wording

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: Resetting a branch to its remote fetches before resetting, in that order
    Given a recording git runner
    When the branch "adw-844-probe" is reset to its remote in the worktree "/wt"
    Then the recorded git commands are a fetch of "adw-844-probe" followed by a hard reset
    And every recorded git command ran in "/wt"

  # "Regression tag counts must not regress for anything else", asserted as the runner's own tally
  # rather than as a file inventory. 53 is what `--tags @regression --dry-run` selects today. The
  # `@adw-818` and `@adw-820` scenarios FINDING 6 corrects the issue about are per-issue and are not
  # in this count, so nothing this slice does to them may move it.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The regression suite still selects every scenario it selects today
    When the regression suite is enumerated by tag
    Then the regression suite enumerates 53 scenarios

  # ── §7  THE BACKSTOPS (item 5, AC1, AC2, AC3, AC4) ────────────────────────────────────────
  #
  # The guard run shells the whole `checkGitGhGuard.ts` binary, so item 5's "no new git/gh shell-out"
  # and the construction rule's stale-entry ratchet are both inside what it asserts. A host-neutral
  # `convertToSshUrl` re-homed into `adws/core/` is the sharp edge: `adws/providers/github/` is
  # structurally exempt from the shell-out rule and `adws/core/` is not, so a rewrite that reaches for
  # a git command instead of a regex fails here rather than in review.
  #
  # The type-check is the executable form of AC1's and AC2's import-graph half — a relocated helper
  # whose callers were not repointed cannot compile, and neither can a `WorkflowConfig.issue` whose
  # record type lost a field four agents read.
  #
  # `lint:docs-index` is AC4's gate: the living docs for `issueRecord`, `hitlBoardNotifier`,
  # `healthCheck` and `targetRepoManager` all describe helpers this slice removes, and the index must
  # still own every file they point at afterwards.

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The git/gh guard stays green with the identity reader and clone rewrite re-homed into ADW
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The living-docs index gate stays green after the removed helpers are documented away
    When the docs-index gate is run over the ADW checkout
    Then the docs-index gate exits 0

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The ADW TypeScript type-check passes with the callers on the forge ports
    Then the ADW TypeScript type-check passes
