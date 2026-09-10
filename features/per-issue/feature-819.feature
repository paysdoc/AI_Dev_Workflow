@adw-819 @adw-3lvhoo-github-forge-adapter
Feature: The GitHub forge adapter reaches only the executor, the ports and its own domain model — the legacy free functions stop being an import, their parsing and their error policies move into the adapter, and the port factories take the context the caller already holds

  Issue #819 is the fourth slice of the GitContext library extraction (`specs/prd/gitcontext-library-extraction.md`,
  Solution → de-tangling wave, second bullet; Implementation Decisions → De-tangling wave; Testing
  Decisions → *GitHub adapter absorption*; user stories 8 and 10), landing on the guard #816 built and
  #817/#818 widened. After it, every import in `adws/providers/github/**` resolves to the executor
  (`adws/gitContext`), the ports (`adws/providers/types.ts`) or the adapter's own domain model (#817).

  Nine lines of source are the entire remaining entanglement, and #817's feature file already named
  them as the reason the enclosing package could not be put in scope on day one:

    • `adws/providers/github/githubIssueTracker.ts:22` → `from '../../github/issueApi'`
    • `adws/providers/github/githubIssueTracker.ts:23` → `from '../../github/issueListApi'`
    • `adws/providers/github/githubIssueTracker.ts:24` → `from '../../github/labelManager'`
    • `adws/providers/github/githubIssueTracker.ts:25` → `from '../../github/projectBoardApi'`
    • `adws/providers/github/githubCodeHost.ts:6`      → `import { log } from '../../core'`
    • `adws/providers/github/githubCodeHost.ts:16`     → `from '../../github/prApi'`
    • `adws/providers/github/githubCodeHost.ts:17`     → `from '../../github/gitContextFactory'`
    • `adws/providers/github/githubBoardManager.ts:7`  → `import { log } from '../../core'`
    • `adws/providers/github/githubBoardManager.ts:10` → `from '../../github/gitContextFactory'`

  After this slice the three port implementations call `createGhRepoApi(ctx)` on a `GitContext` handed
  to their factory (`createGitHubIssueTracker(ctx, repoId)`), `mintBoundProviders` threads the launch
  boundary's context through, and `githubCodeHost.ts`/`githubBoardManager.ts` log through the `Logger`
  port `adws/gitContext/types.ts` already declares. `adws/github/githubAppAuth.ts` stays in ADW as
  wiring. The legacy layer and its ~60 framework callers are untouched (#820/#821) and keep working,
  because those free functions already delegate down to `createGhRepoApi`.

  The issue reads like a re-plumbing with no behaviour change. It is not. What follows are the six
  places where a plausible, tsc-green, unit-suite-green implementation silently changes what an
  operator sees.

  TRAP 1 — THE FREE FUNCTIONS ARE NOT PASS-THROUGHS; THEY ARE THE PARSING AND THE ERROR POLICY. Every
  `GhRepoApi` operation returns a RAW STRING. `issueApi`/`prApi`/`issueListApi` are what turn that
  string into a domain object and what decide whether a failure throws, returns a fallback, or is
  swallowed after a log line. Deleting the import and calling `createGhRepoApi(ctx).fetchIssue(42)`
  in its place returns unparsed JSON to a caller typed for an `Issue`, and — worse — is green on
  `tsc` the moment a `JSON.parse(...) as ...` cast is added, while every default the transform
  applied is gone. The defaults are load-bearing:

    • `transformIssueResponse` (issueApi.ts:61) supplies `author.login = 'unknown'`, `body = ''`,
      `assignees/labels/comments = []`, `milestone = null`, `isBot = false`. A raw payload with no
      `author` reaches `mapGitHubIssueToIssue`, which reads `issue.author.login` unguarded and throws
      a TypeError on a field GitHub genuinely omits for a deleted account.
    • `fetchIssueCommentsRest` (issueApi.ts:227) maps the REST shape — `user.login`, `created_at` —
      not the GraphQL shape `mapIssueCommentSummaryToIssueComment` consumes.
    • `fetchPRDetails` (prApi.ts:122) extracts the linked issue number from `Implements #N` in the
      body and falls back to the branch name. Drop it and `linkedIssueNumber` is silently `undefined`
      on every PR — the field auto-merge and the PR-review lane route on.
    • `fetchPRReviewComments` (prApi.ts:184) is TWO calls concatenated: line comments plus
      `fetchPRReviews`, the latter filtering out `PENDING` and empty-bodied reviews and substituting
      `[Review submitted: CHANGES_REQUESTED]`. An implementation that maps only
      `fetchPRReviewComments` loses every review-body comment, and the PR-review lane sees a clean PR.
    • `fetchPRApprovalState` (prApi.ts:330) is `reviewDecision` first, then per-reviewer-latest
      aggregation when it is null or `""`. The fallback is the whole feature on repos without branch
      protection.
    • `defaultFindPRByBranch` (prApi.ts:64) prefers the most-recently-updated OPEN PR (#508), not
      `prs[0]`.

  §2 drives each of these through the port and asserts the mapped value, so a re-plumb that forgets
  one is red.

  TRAP 2 — THE ERROR POLICIES ARE THREE DIFFERENT POLICIES, AND ONE OF THEM IS ALREADY PINNED. The
  adapter's `addLabel` swallows (`issueApi.addIssueLabel` logs and returns), its `applyLabel` rethrows
  anything that is not a "not found" (`labelManager.applyLabel`), and on a "not found" it LAZY-CREATES
  the label from `ADW_LABEL_DEFINITIONS` and retries once. `adws/providers/github/__tests__/
  githubIssueTrackerLabelPolicy.test.ts` exists for exactly this separation and is one of the
  relocated tests AC5 names. The lazy-create half is the trap inside the trap: the canonical colours
  live in `adws/github/labelManager.ts`, which the adapter may no longer import, and the port
  signature `applyLabel(issueNumber, labelName)` carries no colour. Inlining
  `{ color: 'ededed', description: 'ADW label' }` for every label is tsc-green, suite-green, and
  turns `adw:blocked` from red (`b60205`) to grey the first time it is lazy-created on a fresh target
  repo. The definitions have to arrive as injected data or the retry has to stay framework-side.
  Alongside it: `listIssues` THROWS on failure while `searchOpenIssues`, `findOpenUpgradeIssue` and
  `fetchLabels` are fail-open ([], null, []) and `closeIssue` returns `false` rather than throwing.
  §2 pins each direction.

  TRAP 3 — THE ELEVATED IDENTITY IS INVISIBLE AT THE PORT AND FATAL WHEN LOST. `approvePR` and every
  Projects V2 call run with `purpose: 'alternateIdentity'` (`ghPrApi.ts:53`, `ghRepoApi.ts:107-110`,
  `githubBoardManager.ts`'s five `this.gh.run(..., { purpose: 'alternateIdentity' })` sites). Today
  the adapter reaches them through `gitContextForRepo`, which builds its token provider with
  `alternateIdentityPat = GITHUB_PAT` (`gitContextFactory.ts:126`); `createLaunchTokenProvider`
  (`launchGitContext.ts:104`) sets NO `alternateIdentityPat`, so `createGitHubTokenProvider` falls
  through to ordinary resolution — the App installation token. Thread the boundary's context without
  closing that gap and PR approval starts running as the bot GitHub forbids from self-approving, and
  every board write loses the PAT, both failing silently into `{ success: false }` and `false`.
  `adws/core/launchGitContext.ts` being in this issue's file list is the signal that the boundary's
  provider is where the fix lands. §3 pins the purpose surviving the port hop in the direction a test
  can see it: whatever context is threaded, an elevated port operation must present the elevated
  credential that context serves and an ordinary one must not.

  ⚠️ ADW-WARNING — the other half of TRAP 3 is not observable from a scenario. Whether
  `createLaunchTokenProvider()` gains `alternateIdentityPat: GITHUB_PAT` cannot be distinguished from
  the outside without an App-mint HTTP seam (the machinery `feature-792.steps.ts` stands up), because
  with the App unconfigured both branches resolve to the same PAT. §3 therefore proves the purpose is
  threaded, NOT that the boundary serves a PAT for it. A reviewer must check the boundary's provider
  by hand before this ships frozen at 1.0.0.

  TRAP 4 — `moveToStatus` IS NOT A BOARD MOVE; IT IS A BOARD MOVE PLUS A SLACK POST.
  `adws/github/projectBoardApi.ts:31-35` awaits `notifyReviewTransition` whenever the move succeeded
  AND the target status is `Review` — the HITL notification, and the awaited-not-void-dispatched form
  #647 fixed so the orchestrator cannot exit before the POST settles. `moveToStatus` is called from
  ten phases; `prPhase.ts:99` and `prReviewPhase.ts:348` are the two that pass `BoardStatus.Review`.
  Re-pointing the adapter at `createGhRepoApi(ctx).moveIssueToStatus(...)` deletes the notification
  for every HITL issue, and nothing anywhere reports an error — the operator simply stops being told
  a PR is waiting for them. The notifier lives in the framework and the adapter may not import it, so
  the decoration has to survive on the framework side of the mint. §4 pins the observable half.

  TRAP 5 — THE SCOPE WIDENS BY DIRECTORY, AND `repoContext.ts` MUST STAY OUT. AC4 asks for
  `adws/providers/**` minus `repoContext.ts` (gitlab/ and jira/ arrived with #818). A one-line widen
  to `adws/providers` turns the build red on merge day: `repoContext.ts` imports
  `../github/gitContextFactory`, `../core/environment`, `../core/logger` and `../core/projectConfig`
  by design and is where this wave deliberately parks ADW's wiring until #823. Equally, a widen that
  names only the three files this issue rewrites leaves `ghRepoApi.ts`, `ghIssueApi.ts`,
  `ghPrApi.ts`, `commands/`, `appAuth.ts`, `tokenResolver.ts`, `githubIdentity.ts`,
  `workspaceValidation.ts` and the two barrels unguarded — every one of them clean today, so the
  first re-entanglement lands silently. §6 pins both edges.

  TRAP 6 — THE FACTORY NAMES ARE GUARD DATA. `createGitHubIssueTracker`, `createGitHubCodeHost` and
  `createGitHubBoardManager` are `PROVIDER_CONSTRUCTORS` entries in `adws/guard/constructionRule.ts`.
  Renaming one while changing its arity makes `checkGitGhGuard.test.ts` fail with a message pointing
  at the guard rather than at this issue, and quietly unguards every construction site. The context
  parameter has to arrive on the existing names.

  What each acceptance criterion turns into here:

    §1  THE PORT FACTORIES TAKE THE CALLER'S CONTEXT AND SELECT NONE OF THEIR OWN (AC2). Every
        operation's command must arrive at the recording executor of the context that was handed in;
        an adapter that still mints its own context reaches a real `gh` instead and records nothing.

    §2  THE ABSORBED PARSING AND THE ABSORBED ERROR POLICIES ARE UNCHANGED (AC1, AC5).

    §3  THE ELEVATED IDENTITY SURVIVES THE PORT HOP (AC5).

    §4  THE REVIEW-TRANSITION NOTIFICATION SURVIVES THE RE-PLUMBING (AC5).

    §5  THE ADAPTER LOGS ONLY THROUGH THE `Logger` PORT (AC3).

    §6  THE WIDENED GUARD SCOPE ENFORCES THE WHOLE ADAPTER PACKAGE AND NOTHING MORE (AC1, AC4).

    §7  THE RATCHET: WHOLE-REPO GUARD GREEN, TYPE-CHECK GREEN (AC4, AC5).

  HOW THESE SCENARIOS OBSERVE THE SYSTEM. §1-§5 assert against the commands, working directories and
  child environments recorded by an injected `ExecFn` on a real `GitContext` (observability surface 2,
  as `feature-659`/`feature-699`/`feature-792` established), against the values the port operations
  return, against the errors they raise, and against the `(message, level)` pairs a capturing `Logger`
  receives. §6-§7 observe the exit status and stdout of the real guard runner and of `tsc`
  (surfaces 4 and 5). No scenario reads a source file and asserts against its contents; no scenario
  asserts that a module, an export or a parameter exists.

  A NOTE FOR THE STEP DEFINITIONS, because four of these are easy to get wrong in a way that makes a
  scenario pass vacuously:

    • THE RECORDING SEAM IS A REAL `GitContext`, NOT A FAKE ADAPTER. `new GitContext(options, { exec,
      fsDeps })` with `makeSpyExec` from `gitContextSharedWorld.ts`, `createLiteralTokenProvider(
      ordinary, elevated)` as the token provider, and imaginary roots (`/srv/adw/framework`,
      `/srv/adw/repos`). The spy records `{ command, cwd, env, input }` and answers by first matching
      pattern. This is the whole point of §1: if the adapter constructs its own context, its commands
      reach the DEFAULT executor and spawn a real `gh` — the spy records nothing, and
      "every command the driven operation issued reached the recording seam" is red.
    • ANSWER BY PATTERN, NOT BY CALL ORDER. Several port operations issue more than one command
      (`closeIssue` reads state then closes; `fetchReviewComments` makes two calls; a board move makes
      up to four). Keying the response map on a command substring keeps the scenarios readable and
      keeps a changed call ORDER from silently passing.
    • THE PORT IS PARTLY ASYNCHRONOUS. `fetchIssue`, `closeIssue` and `moveToStatus` return promises;
      `commentOnIssue`, `applyLabel` and `fetchComments` do not. The When step must await the result
      when there is one, or the Then assertions run before the commands are recorded.
    • REUSED, NOT REDEFINED: `the ADW codebase is checked out` lives in
      `features/step_definitions/ensureCronOnEveryEventSteps.ts`; `the ADW TypeScript type-check
      passes` in `feature-504.steps.ts`; `the git/gh guard runs across the whole ADW repository` and
      `the guard run reports no violations` in `feature-769.steps.ts`; the whole guard fixture-tree
      family (`a guard fixture tree holding the file {string}:`, `the guard runner executes over the
      guard fixture tree` and its Then forms) in `feature-816.steps.ts`, with `resetGuardFixtureTree`
      exported there for exactly this reuse. This file's scenarios carry `@adw-819`, so that file's
      `@adw-816`-scoped hooks do not run for them and fixture-tree isolation must be forced from this
      file's own hooks, as `feature-817.steps.ts` and `feature-818.steps.ts` do.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE PORT FACTORIES TAKE THE CALLER'S CONTEXT (AC2; story 8) ─────────────────────
  #
  # The headline, and the direction that proves the new signature does something rather than merely
  # accepting an argument it ignores. Today `githubBoardManager.ts:83` and `githubCodeHost.ts:55,86,
  # 136,141` mint a context per call from ambient ADW identity; after this slice the context arrives
  # and the adapter selects nothing. The recording executor belongs to the context that was handed
  # in, so "reached the recording seam" is only true of an adapter that used it.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: An issue-tracker read runs on the context the factory was given
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh issue view 42 --repo acme/widget --json number" with:
      """
      {"number":42,"title":"Ship it","body":"the body","state":"OPEN","author":{"login":"octocat"},"assignees":[],"labels":[{"name":"hitl"}],"milestone":null,"comments":[],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","closedAt":null,"url":"https://github.com/acme/widget/issues/42"}
      """
    When the issue tracker operation "fetch-issue" is driven over the recording gh seam
    Then every command the driven operation issued reached the recording gh seam
    And the driven operation issued a command matching "gh issue view 42 --repo acme/widget"
    And the driven operation's command ran from the recording context's framework root

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: Every code-host operation runs on the context the factory was given
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "<match>" with "<answer>"
    When the code host operation "<operation>" is driven over the recording gh seam
    Then every command the driven operation issued reached the recording gh seam
    And the driven operation issued a command matching "<match>"

    Examples:
      | operation              | match                                             | answer         |
      | default-branch         | gh repo view acme/widget --json defaultBranchRef  | main           |
      | comment-on-pull-request| gh pr comment 7 --repo acme/widget                |                |
      | list-open-requests     | gh pr list --repo acme/widget --state open        | []             |
      | merge-pull-request     | gh pr merge 7                                     |                |
      | set-secret             | gh secret set                                     |                |
      | list-merged-requests   | gh pr list --repo acme/widget --state merged      | []             |

  # `getDefaultBranch` is the odd one out today: it is the only operation built on
  # `gitContextForSync({ selfHost: false })` rather than `gitContextForRepo`, so the two paths carry
  # different token providers and different self-host resolution. After this slice there is one
  # context, and the asymmetry is gone — which is a behaviour change the issue wants and this row
  # makes visible rather than incidental.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: The board manager runs its project lookup on the context the factory was given
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "projectsV2" with:
      """
      {"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_board1"}]}}}}
      """
    When the board manager operation "find-board" is driven over the recording gh seam
    Then every command the driven operation issued reached the recording gh seam
    And the driven operation returned "PVT_board1"

  # AC2's second half. `mintBoundProviders` is documented as performing no filesystem, git or network
  # work — it must THREAD the context it is given, never build one, or the boundary's guarantee that
  # one identity is resolved exactly once (#794) is quietly broken and the mint gains an I/O failure
  # mode before a workspace exists.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: The mint hands the caller's context to all three providers it returns
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the GitHub providers are minted over the recording gh seam
    And the recording gh seam answers commands matching "gh issue view 42 --repo acme/widget --json state" with:
      """
      {"state":"OPEN"}
      """
    And the recording gh seam answers commands matching "gh pr list --repo acme/widget --state open" with "[]"
    And the recording gh seam answers commands matching "projectsV2" with:
      """
      {"data":{"repository":{"projectsV2":{"nodes":[]}}}}
      """
    When the minted issue tracker, code host and board manager are each driven once
    Then every command the minted providers issued reached the recording gh seam
    And the minted providers issued no command outside the repository "acme/widget"

  # ── §2 THE ABSORBED PARSING AND ERROR POLICIES (AC1, AC5; story 8) ─────────────────────
  #
  # TRAP 1 and TRAP 2. Each scenario below is a mapping or a policy that lives in a free function the
  # adapter stops importing. All of them are green on `tsc` if dropped, and all of them are visible
  # to an operator when they are.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A fetched issue arrives as a mapped port Issue, not as the raw gh payload
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh issue view 42 --repo acme/widget --json number" with:
      """
      {"number":42,"title":"Ship it","body":"the body","state":"OPEN","author":{"login":"octocat"},"assignees":[],"labels":[{"name":"hitl"},{"name":"adw:feature"}],"milestone":null,"comments":[{"id":"c1","author":{"login":"reviewer"},"body":"looks good","createdAt":"2026-01-03T00:00:00Z"}],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","closedAt":null,"url":"https://github.com/acme/widget/issues/42"}
      """
    When the issue tracker operation "fetch-issue" is driven over the recording gh seam
    Then the driven operation returned the field "number" as "42"
    And the driven operation returned the field "author" as "octocat"
    And the driven operation returned the field "labels" as "hitl,adw:feature"
    And the driven operation returned the field "comments.0.author" as "reviewer"

  # The defaulting half of `transformIssueResponse`. GitHub omits `author` for a deleted account and
  # omits `body` for an empty one; `mapGitHubIssueToIssue` reads `issue.author.login` unguarded, so
  # a re-plumb that parses straight into the mapper throws a TypeError on a payload GitHub really
  # sends.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: An issue payload missing its optional fields is defaulted, not fatal
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh issue view 42 --repo acme/widget --json number" with:
      """
      {"number":42,"title":"Orphaned","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","url":"https://github.com/acme/widget/issues/42"}
      """
    When the issue tracker operation "fetch-issue" is driven over the recording gh seam
    Then the driven operation returned the field "author" as "unknown"
    And the driven operation returned the field "body" as ""
    And the driven operation returned the field "labels" as ""
    And the driven operation returned the field "comments" as ""

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A failed issue fetch fails naming the issue number
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "gh issue view 42 --repo acme/widget --json number" with the message "gh: not found"
    When the issue tracker operation "fetch-issue" is driven over the recording gh seam
    Then the driven operation failed with an error naming "#42"

  # The REST shape, not the GraphQL shape. `fetchIssueCommentsRest` reads `user.login` and
  # `created_at`; the GraphQL comment mapper reads `author.login` and `createdAt`. Feeding one to the
  # other yields `undefined` authors and `undefined` timestamps with no error anywhere.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: Issue comments come back through the REST mapping, with their numeric ids stringified
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh api repos/acme/widget/issues/42/comments" with:
      """
      [{"id":90210,"body":"first","user":{"login":"octocat"},"created_at":"2026-01-04T00:00:00Z"}]
      """
    When the issue tracker operation "fetch-comments" is driven over the recording gh seam
    Then the driven operation returned the field "0.id" as "90210"
    And the driven operation returned the field "0.author" as "octocat"
    And the driven operation returned the field "0.createdAt" as "2026-01-04T00:00:00Z"

  # `closeIssue` is a read-then-write with an early return, not a single command. The already-closed
  # short-circuit is what keeps a re-run of a completed workflow from re-closing and re-commenting.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: Closing an already-closed issue issues no close command and reports no close
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh issue view 42 --repo acme/widget --json state" with:
      """
      {"state":"CLOSED"}
      """
    When the issue tracker operation "close-issue-with-comment" is driven over the recording gh seam
    Then the driven operation returned "false"
    And the driven operation issued no command matching "gh issue close"
    And the driven operation issued no command matching "gh issue comment"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: Closing an open issue posts the comment before the close and reports the close
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh issue view 42 --repo acme/widget --json state" with:
      """
      {"state":"OPEN"}
      """
    When the issue tracker operation "close-issue-with-comment" is driven over the recording gh seam
    Then the driven operation returned "true"
    And the driven operation issued a command matching "gh issue comment 42" before a command matching "gh issue close 42"

  # TRAP 2, both directions, in the shape the existing relocated suite already asserts.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A rejected add-label is swallowed
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "gh issue edit 42 --repo acme/widget --add-label" with the message "gh api error: 500"
    When the issue tracker operation "add-label" is driven over the recording gh seam
    Then the driven operation completed without throwing

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A rejected apply-label that is not a missing label is rethrown
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "gh issue edit 42 --repo acme/widget --add-label" with the message "gh api error: 500"
    When the issue tracker operation "apply-label" is driven over the recording gh seam
    Then the driven operation failed with an error naming "gh api error: 500"

  # The lazy-create retry, and the colour that must survive it. `adw:blocked` is `b60205` in
  # `ADW_LABEL_DEFINITIONS`; a generic `ededed` fallback for every label is the tsc-green wrong answer
  # TRAP 2 describes, and only the created label's colour makes it visible. AC1 forbids the adapter
  # importing `adws/github/labelManager`, so the canonical colour cannot come from inside the package
  # — it has to arrive as injected data from ADW's wiring. That is why this scenario drives the
  # MINTED tracker rather than a bare factory: a bare adapter is entitled to its grey default, and
  # asserting `b60205` against it would be asserting a rule AC1 makes unimplementable.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: An apply-label onto a repository missing the label creates it with its canonical colour and retries once
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the GitHub providers are minted over the recording gh seam
    And the recording gh seam refuses the first command matching "gh issue edit 42 --repo acme/widget --add-label" with the message "label not found"
    When the minted issue tracker applies the label "adw:blocked" to issue 42
    Then the driven operation completed without throwing
    And the driven operation issued a command matching "gh label create"
    And the driven operation issued a command matching "b60205"
    And the driven operation issued 3 commands

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: The fail-open reads answer with their documented fallback rather than throwing
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "<match>" with the message "gh api error: 500"
    When the issue tracker operation "<operation>" is driven over the recording gh seam
    Then the driven operation completed without throwing
    And the driven operation returned "<fallback>"

    Examples:
      | operation                 | match                                              | fallback |
      | fetch-labels              | gh issue view 42 --repo acme/widget --json labels  |          |
      | search-open-issues        | gh issue list --repo acme/widget --state open      |          |
      | find-open-upgrade-issue   | --label 'adw:upgrade'                              | null     |

  # The one read that deliberately does NOT swallow — `issueListApi.listIssues` throws so its callers
  # own the swallow policy. Folding it into the fail-open group is a one-word change and it turns an
  # empty cron poll into an indistinguishable "no eligible issues".

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A failed issue listing throws rather than answering with an empty list
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "gh issue list --repo acme/widget" with the message "gh api error: 500"
    When the issue tracker operation "list-issues" is driven over the recording gh seam
    Then the driven operation failed with an error naming "gh api error: 500"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A created issue reports the number parsed out of the gh output
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh issue create --repo acme/widget" with "https://github.com/acme/widget/issues/451"
    When the issue tracker operation "create-issue" is driven over the recording gh seam
    Then the driven operation returned "451"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A created issue whose gh output carries no issue url fails rather than reporting a number
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh issue create --repo acme/widget" with "created something"
    When the issue tracker operation "create-issue" is driven over the recording gh seam
    Then the driven operation failed with an error naming "created something"

  # TRAP 1, the PR half. `linkedIssueNumber` is the field the auto-merge and PR-review lanes route on;
  # it exists only because `fetchPRDetails` reads `Implements #N` out of the body.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A fetched pull request carries the issue number its body implements
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh pr view 7 --repo acme/widget --json number" with:
      """
      {"number":7,"title":"Ship it","body":"Implements #42\n\nDetails follow.","state":"OPEN","headRefName":"feature-issue-42-abc-ship","baseRefName":"main","url":"https://github.com/acme/widget/pull/7"}
      """
    When the code host operation "fetch-pull-request" is driven over the recording gh seam
    Then the driven operation returned the field "linkedIssueNumber" as "42"
    And the driven operation returned the field "sourceBranch" as "feature-issue-42-abc-ship"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A fetched pull request with no marker in its body falls back to the issue number in its branch
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh pr view 7 --repo acme/widget --json number" with:
      """
      {"number":7,"title":"Ship it","body":"no marker here","state":"OPEN","headRefName":"feature-issue-42-abc-ship","baseRefName":"main","url":"https://github.com/acme/widget/pull/7"}
      """
    When the code host operation "fetch-pull-request" is driven over the recording gh seam
    Then the driven operation returned the field "linkedIssueNumber" as "42"

  # Two calls concatenated, and the filter between them. A review with an empty body and state
  # CHANGES_REQUESTED must survive as `[Review submitted: CHANGES_REQUESTED]`; a PENDING one must not
  # survive at all.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: Review comments merge the line comments with the review bodies, filtering the pending ones
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "pulls/7/comments" with:
      """
      [{"id":1,"body":"nit","path":"src/a.ts","line":12,"created_at":"2026-01-05T00:00:00Z","updated_at":"2026-01-05T00:00:00Z","user":{"login":"reviewer"}}]
      """
    And the recording gh seam answers commands matching "pulls/7/reviews" with:
      """
      [{"id":2,"state":"CHANGES_REQUESTED","body":"","submitted_at":"2026-01-06T00:00:00Z","user":{"login":"maintainer"}},{"id":3,"state":"PENDING","body":"draft","submitted_at":"2026-01-07T00:00:00Z","user":{"login":"maintainer"}}]
      """
    When the code host operation "fetch-review-comments" is driven over the recording gh seam
    Then the driven operation returned 2 items
    And the driven operation returned the field "0.path" as "src/a.ts"
    And the driven operation returned the field "1.body" as "[Review submitted: CHANGES_REQUESTED]"

  # The Examples columns are a shorthand the step definition expands into the `gh pr view --json
  # reviewDecision,reviews` payload: `(none)` is a JSON null decision, `(empty)` the empty string the
  # gh CLI returns on a repository without branch protection, and each review is
  # `<login>:<state>@<day>`. Spelling the payload out in the table would put double quotes inside a
  # `{string}` parameter, where Gherkin's capture stops at the first one.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: The approval state falls back to per-reviewer aggregation when the forge reports no decision
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the pull request 7 reports the review decision "<decision>" with the reviews "<reviews>"
    When the code host operation "is-pull-request-approved" is driven over the recording gh seam
    Then the driven operation returned "<approved>"

    Examples:
      | decision          | reviews                            | approved |
      | APPROVED          |                                    | true     |
      | CHANGES_REQUESTED |                                    | false    |
      | (none)            | a:APPROVED@1                       | true     |
      | (empty)           | a:APPROVED@1                       | true     |
      | (none)            | a:APPROVED@1,a:CHANGES_REQUESTED@2 | false    |
      | (none)            | a:APPROVED@1,b:APPROVED@2          | true     |
      | (none)            |                                    | false    |

  # #508. `prs[0]` is the wrong answer whenever a branch has both a stale closed PR and a live open
  # one, and the wrong answer is the one auto-merge acts on.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A branch carrying a closed and an open pull request resolves to the open one
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh pr list --repo acme/widget --head" with:
      """
      [{"number":5,"state":"CLOSED","headRefName":"feature-x","baseRefName":"main","updatedAt":"2026-02-01T00:00:00Z","labels":[]},{"number":9,"state":"OPEN","headRefName":"feature-x","baseRefName":"main","updatedAt":"2026-01-01T00:00:00Z","labels":[{"name":"hitl"}]}]
      """
    When the code host operation "find-pull-request-by-branch" is driven over the recording gh seam
    Then the driven operation returned the field "number" as "9"
    And the driven operation returned the field "labels" as "hitl"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A branch with no pull request at all resolves to nothing rather than throwing
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "gh pr list --repo acme/widget --head" with the message "gh api error: 500"
    When the code host operation "find-pull-request-by-branch" is driven over the recording gh seam
    Then the driven operation completed without throwing
    And the driven operation returned "null"

  # The pre-flight reuse check in `createPullRequest` — the only place the adapter already calls
  # `createGhRepoApi` directly today, and the one whose swallow-on-failure fall-through must survive
  # the re-plumbing or every re-run of the PR phase opens a duplicate PR.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: Creating a pull request on a branch that already has an open one reuses it instead of opening a second
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh pr list --repo acme/widget --head" with:
      """
      [{"number":9,"state":"OPEN","headRefName":"feature-x","baseRefName":"main","updatedAt":"2026-01-01T00:00:00Z"}]
      """
    When the code host operation "create-pull-request" is driven over the recording gh seam
    Then the driven operation returned the field "number" as "9"
    And the driven operation issued no command matching "gh pr create"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A merge failure is reported as an unsuccessful result carrying the forge's message
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "gh pr merge 7" with the message "Pull request is not mergeable"
    When the code host operation "merge-pull-request" is driven over the recording gh seam
    Then the driven operation completed without throwing
    And the driven operation returned the field "success" as "false"
    And the driven operation returned the field "error" as "Pull request is not mergeable"

  # ── §3 THE ELEVATED IDENTITY SURVIVES THE PORT HOP (AC5; TRAP 3) ───────────────────────
  #
  # `purpose: 'alternateIdentity'` is set inside `ghPrApi`/`ghRepoOps`/`githubBoardManager`, and its
  # only observable trace is the credential the executed command carried. See the ADW-WARNING above
  # for the half of this trap that lives at the boundary and is NOT covered here.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: Approving a pull request presents the elevated credential the context serves
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    When the code host operation "approve-pull-request" is driven over the recording gh seam
    Then the command matching "gh pr review 7 --approve" carried the credential "credential-elevated"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: Commenting on an issue presents the ordinary credential, not the elevated one
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    When the issue tracker operation "comment-on-issue" is driven over the recording gh seam
    Then the command matching "gh issue comment 42" carried the credential "credential-ordinary"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: Every board write presents the elevated credential the context serves
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "projectsV2" with:
      """
      {"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_board1"}]},"owner":{"id":"O_1"},"id":"R_1"}}}
      """
    And the recording gh seam answers commands matching "createProjectV2" with:
      """
      {"data":{"createProjectV2":{"projectV2":{"id":"PVT_new"}}}}
      """
    And the recording gh seam answers commands matching "field(name:" with:
      """
      {"data":{"node":{"field":{"id":"F_1","options":[]}}}}
      """
    When the board manager operation "<operation>" is driven over the recording gh seam
    Then every command the driven operation issued carried the credential "credential-elevated"

    Examples:
      | operation      |
      | find-board     |
      | create-board   |
      | ensure-columns |

  # ── §4 THE REVIEW-TRANSITION NOTIFICATION SURVIVES (AC5; TRAP 4) ───────────────────────
  #
  # The single most likely silent regression in this slice: `projectBoardApi.moveIssueToStatus` is a
  # board move PLUS an awaited HITL Slack post on a successful `Review` transition (#647), and
  # `createGhRepoApi(ctx).moveIssueToStatus(...)` is only the board move. Where the decoration lives
  # after this slice is the implementer's call — the adapter may not import the notifier — but it must
  # run on the caller's context, so its reads are visible on the same recording seam as the move.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A successful move to Review still performs the review-transition notification lookup
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the GitHub providers are minted over the recording gh seam
    And the recording gh seam is configured for a successful board move of issue 42 to "Review"
    When the minted issue tracker moves issue 42 to the board status "Review"
    Then the driven operation returned "true"
    And the driven operation issued a command matching "gh issue view 42 --repo acme/widget --json"
    And the driven operation issued a command matching "gh pr list --repo acme/widget"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A successful move to a status other than Review performs no notification lookup
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the GitHub providers are minted over the recording gh seam
    And the recording gh seam is configured for a successful board move of issue 42 to "In Progress"
    When the minted issue tracker moves issue 42 to the board status "In Progress"
    Then the driven operation returned "true"
    And the driven operation issued no command matching "gh pr list --repo acme/widget"

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A board move that finds no project reports false rather than throwing
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the GitHub providers are minted over the recording gh seam
    And the recording gh seam refuses commands matching "projectsV2" with the message "gh api error: 500"
    When the minted issue tracker moves issue 42 to the board status "Review"
    Then the driven operation completed without throwing
    And the driven operation returned "false"

  # ── §5 THE ADAPTER LOGS ONLY THROUGH THE Logger PORT (AC3; story 10) ───────────────────
  #
  # `githubBoardManager.ts` logs at six sites and `githubCodeHost.ts` at one, all through
  # `adws/core`'s `log`. The port (`adws/gitContext/types.ts`) is the same `(message, level?)` shape,
  # so swapping the import is a one-line change — and a one-line change that is invisible unless the
  # injected logger is asserted to RECEIVE the message and ADW's decorated line is asserted NOT to
  # appear. `consoleLogger` prints the bare message; `adws/core`'s `log` prints a timestamped,
  # emoji-prefixed one, which is what makes the two distinguishable on the same stream.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A failed board lookup reports through the injected logger
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "projectsV2" with the message "gh api error: 500"
    And the GitHub board manager is built with a capturing logger
    When the board manager operation "find-board" is driven over the recording gh seam
    Then the capturing logger recorded a message naming "acme/widget"
    And the capturing logger recorded that message at level "warn"
    And no ADW-decorated log line was written to standard output

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A reused pull request reports through the injected logger
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam answers commands matching "gh pr list --repo acme/widget --head" with:
      """
      [{"number":9,"state":"OPEN","headRefName":"feature-x","baseRefName":"main","updatedAt":"2026-01-01T00:00:00Z"}]
      """
    And the GitHub code host is built with a capturing logger
    When the code host operation "create-pull-request" is driven over the recording gh seam
    Then the capturing logger recorded a message naming "#9"
    And no ADW-decorated log line was written to standard output

  # The control. `Logger` is an optional injection with `consoleLogger` as the port's documented
  # default (#818 established the same pair for GitLab and Jira); an adapter that made the logger
  # mandatory would break every existing construction site, and one that kept `adws/core`'s `log` as
  # its fallback would still be importing the framework.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: With no logger injected the board manager falls back to the port's console default
    Given a recording gh seam for the repository "acme/widget" serving the ordinary credential "credential-ordinary" and the elevated credential "credential-elevated"
    And the recording gh seam refuses commands matching "projectsV2" with the message "gh api error: 500"
    And the GitHub board manager is built with no logger
    When the board manager operation "find-board" is driven over the recording gh seam
    Then an undecorated log line naming "acme/widget" was written to standard output

  # ── §6 THE WIDENED GUARD SCOPE (AC1, AC4; TRAP 5) ──────────────────────────────────────
  #
  # The machine-checkable half of the slice, and the part that keeps it from being undone. Each row
  # in the first outline is a file that reaches the framework at a line that exists today; after this
  # issue every one of them must fail the build. Until the scope widens they all pass, which is why
  # this outline is the pivot: an implementation that removes the imports but forgets the scope entry
  # leaves AC1 unenforced and this scenario red.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: A framework import from a named adapter module fails the guard by name
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                                        | specifier                    |
      | adws/providers/github/githubIssueTracker.ts | ../../github/issueApi        |
      | adws/providers/github/githubIssueTracker.ts | ../../github/labelManager    |
      | adws/providers/github/githubIssueTracker.ts | ../../github/projectBoardApi |
      | adws/providers/github/githubCodeHost.ts     | ../../github/prApi           |
      | adws/providers/github/githubCodeHost.ts     | ../../core                   |
      | adws/providers/github/githubBoardManager.ts | ../../github/gitContextFactory |
      | adws/providers/github/githubBoardManager.ts | ../../core                   |

  # TRAP 5, too-narrow edge. None of these appear in the issue's file list, because none of them is
  # entangled today — which is precisely why the scope entry has to be the DIRECTORY. Three file
  # entries pass the outline above only by leaving these unguarded, and the first re-entanglement
  # lands silently.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: A framework import from an unnamed sibling in the adapter package fails the guard too
    Given a guard fixture tree holding the file "<path>":
      """
      import type { Borrowed } from '<specifier>';

      export type Alias = Borrowed;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree names the import specifier "<specifier>"

    Examples:
      | path                                            | specifier                 |
      | adws/providers/github/ghRepoApi.ts              | ../../core                |
      | adws/providers/github/ghIssueApi.ts             | ../../types/issueTypes    |
      | adws/providers/github/ghPrApi.ts                | ../../github/prApi        |
      | adws/providers/github/index.ts                  | ../../github/issueApi     |
      | adws/providers/github/githubIdentity.ts         | ../../core/environment    |
      | adws/providers/github/appAuth.ts                | ../../github/githubAppAuth |
      | adws/providers/github/commands/issueCommands.ts | ../../../core             |

  # The adapter is not the only file the widening reaches. AC4's scope is `adws/providers/**` minus
  # `repoContext.ts`, so the two files that sit beside it must come in with it.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: A framework import from the providers files outside the adapter directories fails the guard too
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                                  | specifier         |
      | adws/providers/workspaceValidation.ts | ../core           |
      | adws/providers/index.ts               | ../github/prApi   |

  # TRAP 5, too-wide edge. This section used to pin `repoContext.ts` — the file this whole wave parked
  # ADW's wiring in — as "still not checked" while it carried a framework import by design. #823
  # retired that row: it replaced `repoContext.ts` with `forgeProviders()` and widened
  # EXTRACTION_SCOPE to the whole `adws/providers` directory, so the identical fixture now FAILS the
  # guard instead of passing it — see #823's "The last unchecked provider file is now in scope and
  # fails on a framework import" outline, this row's exact inversion.

  # The other direction, and the exact shape the de-tangled adapter takes: the executor and the
  # `Logger` port from `adws/gitContext/`, the ports from `adws/providers/types.ts`, the raw shapes
  # from its own `domain/` sibling. All of them resolve inside the extractable set — the two
  # directories move together — so an implementation that satisfied the guard by inlining a private
  # logger type instead of importing the port would be passing a test it did not need to pass, while
  # a rule that flagged any specifier leaving the file's own directory would fail the build on the
  # very files this issue rewrites.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: The de-tangled adapter reaching the executor, the logger port, the provider ports and its own siblings passes the guard
    Given a guard fixture tree holding the file "adws/providers/github/githubIssueTracker.ts":
      """
      import type { GitContext } from '../../gitContext';
      import type { Logger } from '../../gitContext/types';
      import type { IssueTracker, RepoIdentifier } from '../types';
      import type { GitHubIssue } from './domain/issue';
      import { createGhRepoApi } from './ghRepoApi';
      import { mapGitHubIssueToIssue } from './mappers';

      export function createGitHubIssueTracker(ctx: GitContext, repoId: RepoIdentifier, deps: { logger?: Logger } = {}): IssueTracker {
        void repoId; void deps;
        const gh = createGhRepoApi(ctx);
        void ((raw: GitHubIssue) => mapGitHubIssueToIssue(raw));
        void gh;
        return {} as IssueTracker;
      }
      """
    And a guard fixture tree holding the file "adws/providers/github/githubBoardManager.ts":
      """
      import { consoleLogger } from '../../gitContext';
      import type { Logger } from '../../gitContext/types';
      import { BOARD_COLUMNS } from '../types';

      export function announce(logger: Logger = consoleLogger): void {
        logger(String(BOARD_COLUMNS.length), 'info');
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # TRAP 6's neighbour. AC5 puts the relocated tests inside the directory this section just put in
  # scope, and they will import `vitest` and — for the delegation assertions — very likely framework
  # paths on purpose. `isScannable` already excludes both shapes; this pins the exclusion where it now
  # matters, rather than discovering it as a red build on the tests AC5 requires.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: The adapter's own test files are excluded from the widened scope
    Given a guard fixture tree holding the file "<path>":
      """
      import { describe } from 'vitest';
      import { log } from '../../../core';

      describe('logging', () => { void log; });
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | path                                                          |
      | adws/providers/github/__tests__/githubIssueTracker.test.ts    |
      | adws/providers/github/__tests__/githubCodeHost.test.ts        |
      | adws/providers/github/commands/__tests__/issueCommands.test.ts |

  # The ratchet. WIDEN ONLY, NEVER NARROW is a property of a list, and the only way a test can see it
  # is by re-running what the earlier slices pinned. Every entry #816, #817 and #818 added must still
  # fire after #819's widening — including the two #817 entries the directory widening subsumes,
  # which must keep failing whether or not their list rows survive.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario Outline: The scope entries the earlier slices seeded still fail on a framework import
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                                        | specifier                 |
      | adws/gitContext/branchOps.ts                | ../core                   |
      | adws/providers/types.ts                     | ../core                   |
      | adws/providers/github/mappers.ts            | ../../types/issueTypes    |
      | adws/providers/github/domain/issueShapes.ts | ../../../types/issueTypes |
      | adws/providers/gitlab/gitlabApiClient.ts    | ../../core                |
      | adws/providers/jira/jiraApiClient.ts        | ../../core                |

  # The anti-relabel row #816 introduced and every slice since has re-run, re-run again because #819
  # is the fourth slice to change EXTRACTION_SCOPE and the first to bring a whole EXEMPT_PACKAGE into
  # it: a widening applied to collection rather than to the extraction rule alone relabels or swallows
  # this, and a widening that stopped pruning `adws/providers/github` from the WHOLE-REPO walk would
  # start flagging the adapter's sanctioned `gh` command strings under the shell-out rule instead.

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A framework shell-out still fails under the shell-out rule, not the extraction rule
    Given a guard fixture tree holding the file "adws/core/branchHelper.ts":
      """
      import { execSync } from 'child_process';

      export function currentBranch(): string {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' });
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/core/branchHelper.ts"
    And the guard failure over the guard fixture tree cites no extraction-readiness rule

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: A gh command string in the forge adapter still passes the guard with the package fully in scope
    Given a guard fixture tree holding the file "adws/providers/github/commands/prCommands.ts":
      """
      export function approvePRCmd(owner: string, repo: string, prNumber: number): string {
        return `gh pr review ${prNumber} --approve --repo ${owner}/${repo}`;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # ── §7 THE RATCHET (AC4, AC5) ──────────────────────────────────────────────────────────

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: The guard passes across the whole repository with the adapter package fully in scope
    When the git/gh guard runs across the whole ADW repository
    Then the guard run reports no violations

  @adw-819 @adw-3lvhoo-github-forge-adapter
  Scenario: TypeScript type-check passes with the adapter dropped off the legacy layer
    Then the ADW TypeScript type-check passes
