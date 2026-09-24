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
  AND THAT NaN IS ALREADY THE STATUS QUO — verified. `buildNotifierDeps` (`hitlBoardNotifier.ts:73`)
  casts `fetchAllPRs()` to `{number, body, state}` with NO `updatedAt` at all, so `selectPreferredPR`
  already sorts on `undefined` today: feed it the same two open PRs in either order and it returns
  whichever came first. So the two-open-PRs row does NOT preserve today's behaviour — it asserts the
  FIX the issue asks for ("add the missing field to the domain model … and both adapters"). It is the
  one deliberate behaviour change in §2, and it only lands if BOTH the type and the `--json`
  projection are widened. Half the fix leaves the row failing exactly as it fails now.

  FINDING 3 — THE NOTIFIER FILTERS TO OPEN *BEFORE* PREFERRING OPEN. `buildNotifierDeps.listOpenPRs`
  reads `fetchAllPRs` and keeps `state === 'OPEN'`; `selectPreferredPR` then prefers open and falls
  back to newest-overall. Today that fallback is unreachable — the pool is already open-only, so an
  issue whose only linked pull request is merged gets NO Slack ping. `CodeHost.listPullRequests()`
  returns state=all. Hand it straight to `selectPreferredPR` and the fallback wakes up: a merged pull
  request is announced as ":eyes: … Approve to merge", pointing a human at a pull request that was
  merged last week. §2 pins both halves.

  FINDING 4 — `parseOwnerRepoFromUrl` IS NOT A SUPERSET OF `parseGitHubRemoteUrl`. Item 2 composes
  `readLocalRepoIdentity` from `readOriginRemoteUrl` + `parseOwnerRepoFromUrl`. First, a location
  correction the build needs: the issue calls `parseOwnerRepoFromUrl` a "provider types" export, but
  it lives in `adws/providers/workspaceValidation.ts`, NOT `adws/providers/types.ts`. Import it from
  where it is. Four divergences, all four verified by running both parsers over the same remotes:
    • `ssh://git@github.com/owner/repo[.git]` RESOLVES today (`parseGitHubRemoteUrl`'s HTTPS pattern
      is unanchored and matches the `github.com/…` tail) and returns NULL under
      `parseOwnerRepoFromUrl` (its HTTPS branch needs `https?://`; its SSH branch needs a colon after
      the host). A clone made with the `ssh://` scheme stops resolving its own identity.
    • `https://gitlab.com/acme/widget.git` THROWS today and RESOLVES under the neutral parser. The
      issue asks for the same error message on failure; it does not say the set of failures shrinks.
    • `git@gitlab.com:acme/widget.git` THROWS today and RESOLVES under the neutral parser too — the
      SCP-style half of the same widening, which the issue body does not mention at all.
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

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The author the plan agent renders is the login, not an undefined property read
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker was opened by "octocat"
    When the plan agent's issue section is rendered for issue 42 from that boundary
    Then the rendered issue section names the author "octocat"
    And the rendered issue section contains no "undefined"

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The labels the plan agent renders and the classifier reads survive the port crossing
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker carries the labels "adw:feature" and "hitl"
    When the plan agent's issue section is rendered for issue 42 from that boundary
    Then the rendered issue section names the labels "adw:feature, hitl"
    And the adw classification read from that issue record is "adw:feature"

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A failed issue read still fails with the message the caller's error contract names
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And the recording tracker refuses to read issue 42
    When the issue record for issue 42 is read from that boundary
    Then reading the issue record failed with a message beginning "Failed to fetch issue #42:"

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

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The announced pull request is the open one, not the merged one updated more recently
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "A stuck workflow" and carries the label "hitl"
    And the recording code host has pull request 7 open, linking issue 42, updated at "2026-09-01T10:00:00Z"
    And the recording code host has pull request 9 merged, linking issue 42, updated at "2026-09-08T10:00:00Z"
    When the review-transition notification is raised for issue 42 from that boundary
    Then the review-transition notification announces pull request 7

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: An issue whose only linked pull request is merged raises no review-transition notification
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "Already landed" and carries the label "hitl"
    And the recording code host has pull request 9 merged, linking issue 42, updated at "2026-09-08T10:00:00Z"
    When the review-transition notification is raised for issue 42 from that boundary
    Then no review-transition notification was announced

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: Two open linked pull requests resolve to the one the forge updated most recently
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "Two attempts" and carries the label "hitl"
    And the recording code host has pull request 7 open, linking issue 42, updated at "2026-09-02T10:00:00Z"
    And the recording code host has pull request 8 open, linking issue 42, updated at "2026-09-09T10:00:00Z"
    And the recording code host lists pull request 7 before pull request 8
    When the review-transition notification is raised for issue 42 from that boundary
    Then the review-transition notification announces pull request 8

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The announced link is the url the forge published, not one assembled from owner and repo
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "A stuck workflow" and carries the label "hitl"
    And the recording code host has pull request 7 open, linking issue 42, updated at "2026-09-02T10:00:00Z"
    And pull request 7 in the recording code host has the url "https://forge.example/adw-fixture/void-844/-/merge_requests/7"
    When the review-transition notification is raised for issue 42 from that boundary
    Then the announced notification link is "https://forge.example/adw-fixture/void-844/-/merge_requests/7"

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: An issue without the hitl label is not announced and costs no pull-request listing
    Given a launch boundary for the repository "adw-fixture/void-844" whose providers record every call
    And issue 42 in the recording tracker is titled "Ordinary work" and carries no labels
    When the review-transition notification is raised for issue 42 from that boundary
    Then no review-transition notification was announced
    And the boundary's providers were asked for no pull-request listing

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

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The resolved identity still carries the platform the provider selection branches on
    Given a checkout whose origin remote is "https://github.com/acme/webapp.git"
    When the local repo identity is read from that checkout
    Then the local repo identity declares the platform "github"

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

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: Reading the local repo identity issues no forge request
    Given a checkout whose origin remote is "https://github.com/acme/webapp.git"
    When the local repo identity is read from that checkout
    Then reading the local repo identity issued no forge request

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

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: A target repository is cloned from the rewritten ssh url, not the published https one
    Given a target repository "acme/webapp" published at "https://github.com/acme/webapp.git" that has never been cloned
    When the target repository workspace is ensured
    Then the recorded clone was issued for "git@github.com:acme/webapp.git"

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

  @adw-844 @adw-ejnsio-route-adw-callers-th
  Scenario: The regression suite still selects every scenario it selects today
    When the regression suite is enumerated by tag
    Then the regression suite enumerates 53 scenarios

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
