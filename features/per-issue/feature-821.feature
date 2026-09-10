@adw-821 @adw-ciwxf3-migrate-trigger-call
Feature: The triggers reach the forge through the boundary's providers alone — the legacy free-function layer is deleted, what survives of adws/github is ADW application code that no longer lives in a directory named after a forge, and no operator sees a difference

  Issue #821 is the fourth slice of the GitContext library extraction
  (`specs/prd/gitcontext-library-extraction.md`, Implementation Decisions → De-tangling wave, second
  bullet; user stories 3 and 8) and the second of two caller-migration waves. #816 landed the
  extraction-readiness guard, #817 moved the domain model into the provider package, #819 cut the
  GitHub adapter's own dependency on `adws/github/`, #820 walked the orchestrators, phases, core
  utilities and the proof publisher onto the boundary. What is left is the triggers — and then the
  legacy layer itself, which nothing else still holds open.

  This slice is different from #820 in one way that shapes every row below. #820 migrated callers
  that already held a boundary. Several callers here DO NOT, and the issue's phrase "the boundary
  providers threaded through `LaunchBoundary` (cron, webhook per-event boundary, sweeps, redrive,
  handlers)" reads as though they all do. Two of those five do not exist as stated. The rows are
  written against what the code actually is.

  The PRD's bar is "no behavior change: same commands against the same repos" and the existing
  suites are the regression net. So every row is written to fail for a REASON — a specific wrong
  thing a plausible, tsc-green, suite-green implementation does — rather than to restate the
  acceptance criteria in Gherkin.

  ── WHY AC2/AC3/AC4 GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────────
  AC2 (five modules deleted), AC3 (`adws/github/` contains only two files) and AC4 (allowlist
  entries removed) are statements about the shape of the source tree. A scenario asserting them
  directly would have to read the tree — a file-existence check, which is the exact shape the
  framework's rot rule prohibits, and which would fail on any later rename that changed nothing.
  They are covered here the way #820 covered its own structural ACs: by the RUNTIME ARTEFACTS that
  cannot be green unless the deletions happened correctly — the guard binary's exit code (§11),
  which contains the stale-entry ratchet, and the type-check. §11's rows are the executable form of
  AC2–AC4; the prose findings below are what a builder needs so those rows pass for the right
  reason rather than by deleting the check.

  ── SEVEN FINDINGS THE ISSUE BODY DOES NOT CARRY ──────────────────────────────────────────────

  FINDING 1 — THE WEBHOOK HAS NO BOUNDARY. IT HAS A CONTEXT.
  The issue says the triggers "use the boundary providers threaded through `LaunchBoundary`
  (… webhook per-event boundary …)". `trigger_webhook.ts:160` calls `buildLaunchGitContext(
  resolution.targetRepo)` — the CONTEXT-ONLY view of the boundary (`launchGitContext.ts:229`) — and
  keeps the result in `eventGitContext`. There are no per-event providers to thread. Creating them
  is this slice's work, not a given. Worse, that construction sits in a try/catch that logs at
  'warn' and CONTINUES with `eventGitContext` left `undefined` (`:161-165`), after which
  `ensureCronProcess` and the whole event dispatch run anyway. That is survivable today only
  because every forge call on the event path goes through a legacy free function that re-derives
  identity from `repoInfo`. Delete those and an event whose boundary failed to build has no way to
  reach the forge at all. §1's second row pins the choice: an event that cannot mint providers must
  not proceed as though it had them.

  FINDING 2 — THE CRON BOUNDARY IS NULL UNDER MODULE IMPORT, AND THAT IS A CONTRACT.
  `trigger_cron.ts:66` builds `cronBoundary` only when `process.argv[1]` names `trigger_cron`; it is
  `null` when the module is imported. `checkAndTrigger` (`:313`) already treats that as
  skip-the-tick-with-a-warning, and every sweep binder (`:124`, `:130`, `:136`) returns `null` the
  same way rather than falling back to a cwd-derived identity. The trigger helpers migrating in this
  slice take `repoInfo` today and therefore work under module import. After migration they cannot.
  The skip contract must survive: a boundary-less tick logs and skips, it does not throw and it does
  not quietly reach a cwd-derived identity instead. §2's second row is that contract.

  FINDING 3 — THREE FUNCTIONS DIE WITH `githubApi.ts` AND ONE OF THEM RUNS BEFORE ANY BOUNDARY.
  AC2 deletes `githubApi.ts`. Besides its re-export block it declares three things of its own:
  `getRepoInfoFromUrl` (delegates to `parseGitHubRemoteUrl`), `getAuthenticatedUser` (FINDING 4),
  and `getRepoInfoFromPayload` — a `"owner/repo".split('/')` with a validity check
  (`githubApi.ts:37-43`). Its one caller is `webhookRepoResolver.ts:33`, whose docblock reads
  "Pure: no I/O, no env access, no side effects" and whose job is to decide WHICH REPOSITORY the
  per-event boundary will be built for. It runs BEFORE the boundary exists and determines its
  identity. It therefore cannot be migrated onto a provider — a provider is what it is upstream of.
  This is #820's FINDING 4 (an ordering problem wearing an import problem's clothes) in a new place.
  `providers/github/githubIdentity.ts` already owns `parseGitHubRemoteUrl` and `readLocalRepoInfo`
  and is the only home that does not re-create the layer being deleted. §8 asserts the behaviour so
  that wherever it lands, resolution is unchanged and still touches nothing.

  FINDING 4 — `getAuthenticatedUser` CHANGES WHICH IDENTITY IT MEANS WHEN IT MOVES.
  Legacy (`githubApi.ts:53-68`): a MODULE-LEVEL cache, resolved against `readLocalRepoInfo(REPO_ROOT)`
  with the explicit comment "a process-level property, resolved against the framework repo's
  installation, never cwd". Port (`githubCodeHost.ts:230-240`): a PER-INSTANCE memo resolved through
  `this.gh`, bound to whatever repository the code host was minted for — the TARGET repo. These are
  not the same login when ADW runs against a target repo under a GitHub App installation.
  `prCommentDetector.ts:38` feeds the answer into `readUnaddressedComments`, which uses it to decide
  which PR review comments are the workflow's OWN. Get it wrong in one direction and the bot's
  comments read as unaddressed human comments, so pr-review re-triggers forever; wrong in the other
  and a human's review comments are read as the bot's and silently ignored. `prCommentDetector`
  SURVIVES and relocates, so this is a live decision in this slice, not one deleted along with the
  file. §9 pins both directions.

  FINDING 5 — THE STALE-ENTRY RATCHET FIRES ON RELOCATION, WHICH AC4 DOES NOT SAY.
  AC4 says remove the allowlist entries "for the deleted files". `findStaleSanctionedEntries`
  (`constructionRule.ts:196-201`) fails the build for any listed file that stops constructing — and
  a RELOCATED file stops constructing at its OLD path. Three survivors construct via
  `gitContextForRepo` and are all moving: `linkedPrDetector.ts` (`:16`), `prCommentDetector.ts`
  (`:11`) and `hitlBoardNotifier.ts` (`:15`). Each fails TWICE if treated as a plain move — stale
  entry at `adws/github/…`, unsanctioned construction site at `adws/forge/…`. So the allowlist edit
  is five deletions AND three renames, not five deletions. The alternative — building them on the
  providers so they stop constructing at all, which is what "adws/forge/ for … helpers built on the
  providers" actually asks for — means five deletions and three deletions. Either is green; doing
  neither is not. Note the trigger entries (`autoMergeHandler`, `cancelHandler`, `devServerJanitor`,
  `takeoverHandler`, `trigger_webhook`, `webhookHandlers`) are a DIFFERENT case: they construct for
  GIT work via `gitContextForSync`/`gitContextForRepo`, `gitContextFactory.ts` is explicitly not in
  AC2's deletion list, and AC3 keeps it. Their entries stay live and the guard stays green — that is
  the correct outcome, not an oversight. Retiring them is #823.

  FINDING 6 — SIX `vi.mock` CALLS AND ONE GUARD-INTEGRITY CASE NAME MODULES THIS SLICE DELETES.
  `vi.mock('../../github/issueListApi', …)` in `takeoverHandler.test.ts:789`,
  `webhookGatekeeper.test.ts:22`, `issueClosedUnblockRouter.test.ts:13` and
  `concurrencyGuard.test.ts:3`; `vi.mock('../../github/issueApi', …)` in
  `webhookGatekeeper.test.ts:24`; `vi.mock('../github/issueApi', …)` in
  `adws/__tests__/issueDependencies.test.ts:6`. Vitest resolves a `vi.mock` path eagerly, so each is
  a hard failure the moment the module is gone — AC2's "their tests relocated or deleted with them"
  reaches further than the `adws/github/__tests__/` directory. Separately,
  `checkGitGhGuard.test.ts:602` READS THE REAL FILE off disk —
  `{ name: 'getRepoInfo', file: 'adws/github/githubApi.ts', declPattern: /export function getRepoInfo\(/ }` —
  so deletion turns it into an ENOENT. Removing that case is correct: `getRepoInfo` genuinely ceases
  to exist. What must NOT follow is dropping `'getRepoInfo'` from `CWD_DERIVED_IDENTITY_FNS`
  (`identityRule.ts:21`) to "clean up" — that set guards the NAME, not the file, and is what stops
  the cwd-derived identity fallback being reintroduced later. PRD story 24. §11's guard row is the
  backstop for exactly this.

  FINDING 7 — MOST OF THE "SWEEPS AND REDRIVE" MIGRATION IS AN IMPORT PATH, NOT A CALL.
  `promotionSweepDefaults.ts:22` and `upgradeRedrive.ts:28` import ONLY label-name constants
  (`ADW_REGRESSION_PROMOTION_LABEL`, `ADW_UPGRADE_LABEL`, `ADW_BLOCKED_LABEL`); both already run
  every forge operation off `boundary.providers` or an injected `codeHost`
  (`promotionSweepDefaults.ts:59-61`, `upgradeRedrive.ts:157-161`), and `perIssueScenarioSweep`
  already takes `deps.boundary` (`:50`). Same for `cronLabelEligibility.ts` and
  `issueOpenedRouter.ts` (`readAdwLabelNames`, `AdwLabelReading`) and `perIssueScenarioSweep`
  (`bodyLinksIssue`). These are #820's category (c) and (b) — name constants and pure predicates —
  and the home is already built: `adws/core/adwLabels.ts`, which `labelManager.ts:19` re-exports
  from today. Their migration is a repoint. §10's rows assert the behaviour is untouched, so a
  builder who "migrates" a label constant into a forge round-trip is caught.

  ── WHAT IS ALREADY DEFUSED (DO NOT WRITE ROWS FOR THESE) ─────────────────────────────────────
    • `projectBoardApi.ts` looks dangerous and is not. Its `moveIssueToStatus` awaits
      `notifyReviewTransition` on a move to Review — the #647 fix, where a void-dispatched Slack
      POST was torn down on process exit. That composition was ALREADY re-homed by #819 to
      `adwGitHubIssueTrackerDeps` (`repoContext.ts:141-152`), which awaits it identically, and
      `githubIssueTracker.moveToStatus` (`:142-153`) awaits the `onStatusMoved` hook. The module's
      only remaining export has no production caller outside the barrel. Deleting it is inert.
    • `hitlBoardNotifier` relocating to `adws/forge/` does NOT trip the extraction-readiness guard
      even though `providers/repoContext.ts` imports it: `repoContext.ts` is deliberately excluded
      from `EXTRACTION_SCOPE` ("everything under adws/providers/** except repoContext.ts, which
      stays framework wiring until #823", `extractionRule.ts:43-53`). Framework-to-framework.
    • `prApi.ts:66` imports `extractIssueNumberFromBranch` from `../triggers/webhookHandlers` — a
      backwards edge from the legacy layer into the triggers. Deleting `prApi.ts` removes it for
      free. There is nothing to migrate and nothing to assert.

  ── HOW THESE ROWS RUN ────────────────────────────────────────────────────────────────────────
    • THE HARNESS IS feature-796's, EXTENDED — the same one #820 used. Every phrase already
      registered is REUSED, never redefined; redefining one is an AmbiguousStepDefinition. That
      covers the recording-provider boundary (`a launch boundary for the repository … whose
      providers record every call`), the watched context, `the local git remote answers …` /
      `… was never read`, `every recorded provider call addressed the repository …`, and the
      tracker/code-host call-log assertions, all from
      `features/per-issue/step_definitions/feature-796.steps.ts` and `feature-820.steps.ts`.
      `the ADW codebase is checked out` comes from
      `features/step_definitions/ensureCronOnEveryEventSteps.ts:8`; `the ADW TypeScript type-check
      passes` from `feature-504.steps.ts:1127`; `the git/gh guard is run across the repository` and
      `the git/gh guard reports no violations` from `feature-691.steps.ts:82,91` — and that pair
      shells the whole `checkGitGhGuard.ts` binary, so the stale-entry ratchet of FINDING 5 and the
      identity-rule set of FINDING 6 are both inside what they assert.
    • THE FIXTURE REPOSITORY MUST NOT EXIST. A RED run reaches un-migrated free functions that shell
      out for real. Every row uses `adw-fixture/void-821`, which is not a repository, so the worst a
      RED run does is fail a `gh` call slowly. `adw-fixture/elsewhere-821` is the deliberately
      DIFFERENT answer given to the local git remote in the wrong-repo rows — the two names must
      never be swapped, or those rows stop discriminating. Both differ from #820's `-820` fixtures
      so a cross-file leak is visible rather than silently passing.
    • ONE NOUN PER ASSERTION. Every provider-call assertion here says `the boundary's providers …`,
      including on the cron and webhook paths, even though those boundaries are per-process and
      per-event respectively. Naming them `the cron tick's providers …` / `the webhook event's
      providers …` would read better in isolation and would be a mistake: it mints synonyms for an
      assertion feature-796 already has one phrase for, and the registry's rot rubric counts that as
      vocabulary drift. Which boundary is in play is already fixed by the `When` step. The two
      genuinely new nouns — `the cron tick was skipped …`, `the webhook event was not reported as
      triggered` — are new because the BEHAVIOUR is new, not because the subject renamed.
    • §6's no-comment assertion uses `the boundary's issue tracker recorded no comment`
      (`feature-796.steps.ts:900`), NOT the regression registry's T14
      `the mock harness recorded zero comment posts on issue {int}`. Two reasons, and the second is
      the one that matters. First, T14 is currently orphaned: `thenSteps.ts:322` points at
      `feature-509.steps.ts`, which commit `b221fac7` deleted, so nothing registers that phrase any
      more — adopting it here would either land undefined or mint a duplicate of an assertion this
      world already has. Second, and decisively, T14 asserts against RECORDED HTTP REQUESTS on the
      regression mock server. These rows have no mock server; they have a recording tracker. Bound
      to a mock server with zero traffic, T14 passes no matter what the region-overlap code does to
      the tracker — a row that cannot fail is worse than no row. `assertNoCommentRecorded` reads the
      same `activeCallLog` the rest of §6 asserts on, so it discriminates.

  Background:
    Given the ADW codebase is checked out

  # ── §1  THE WEBHOOK'S PER-EVENT BOUNDARY (AC1, FINDING 1) ─────────────────────────────────
  #
  # `dispatchWebhookEvent` resolves the repo from the payload, then builds a per-event context, then
  # dispatches. Every forge call it makes downstream — `fetchIssueCommentsRest` for the cancel and
  # retry directives, `fetchPRDetails` in `webhookHandlers`, `isAdwRunningForIssue` — currently
  # re-derives identity from the `repoInfo` it carries alongside. The first row asserts the
  # replacement: one set of providers, minted once per event, bound to the payload's repository, and
  # a local git remote naming something else cannot redirect any of it.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A webhook event's forge calls all address the repository the payload named
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-821"
    And the boundary's git context is watched for forge-semantic calls
    And issue 42 in the recording tracker has comments with ids "101"
    When the webhook dispatches an "issue_comment" event for issue 42 from that boundary
    Then every recorded provider call addressed the repository "adw-fixture/void-821"
    And the local git remote was never read
    And the watched git context was asked for no forge-semantic operation

  # The swallow at `:161-165` is the row that matters. Today a failed context build leaves
  # `eventGitContext` undefined and the event proceeds, because the legacy free functions do not
  # need it. After the migration there is nothing behind them. An implementation that keeps the
  # warn-and-continue shape ships a webhook that answers 200 and does nothing — the single hardest
  # failure to notice in production, because the forge shows no trace of it at all.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A webhook event whose providers cannot be minted is reported, not silently accepted
    Given a launch boundary for the repository "adw-fixture/void-821" that fails to mint providers
    When the webhook dispatches an "issue_comment" event for issue 42 from that boundary
    Then the webhook event was not reported as triggered
    And the webhook event failure names the repository "adw-fixture/void-821"
    And no workflow was spawned for issue 42

  # ── §2  THE CRON TICK (AC1, FINDING 2) ────────────────────────────────────────────────────
  #
  # `trigger_cron.ts:18,47` is the single densest legacy import line in the slice: `getRepoInfo`,
  # `fetchPRList`, `hasUnaddressedComments`, `fetchLinkedPRs`, `readAdwLabelNames` plus the three
  # comment predicates. `checkAndTrigger` already reads issues off `boundary.providers.issueTracker`
  # (`:354`) and already passes `boundary.providers.codeHost` to the redrive (`:406`), so the shape
  # is half-built: this is finishing it, not inventing it.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A cron tick reads issues and pull requests through the providers its own boundary minted
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-821"
    And issue 42 in the recording tracker is titled "A queued feature"
    When the cron tick runs once from that boundary
    Then the boundary's providers were asked for the open issues of "adw-fixture/void-821"
    And every recorded provider call addressed the repository "adw-fixture/void-821"
    And the local git remote was never read

  # FINDING 2's contract. `checkAndTrigger:313-315` already logs and returns when the boundary is
  # null; the sweeps do the same. A migration that makes providers mandatory by dereferencing them
  # unconditionally turns "imported by a test" into a TypeError, and — far worse — a migration that
  # "fixes" that by falling back to `getRepoInfo()` reintroduces the exact cwd-derived identity the
  # whole PRD exists to delete, in the one code path where nothing would ever catch it.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A cron tick with no boundary skips without reaching for a cwd-derived identity
    Given the cron module is imported rather than launched
    And the local git remote answers "adw-fixture/elsewhere-821"
    When the cron tick runs once with no boundary
    Then the cron tick was skipped for want of a launch boundary
    And the local git remote was never read
    And no workflow was spawned for issue 42

  # ── §3  THE TAKEOVER HANDLER'S BOUNDARY-LESS ADAPTERS (AC1, FINDING 5 handoff) ────────────
  #
  # #820's FINDING 1 pushed two legacy wirings DOWN into this file rather than leaving them in
  # `core/`: `buildBoundarylessReconcileDeps` (`takeoverHandler.ts:93-106`, using
  # `defaultFindPRByBranch` from the doomed `prApi.ts`) and the `fetchIssueCommentBodies` arm of
  # `resolveAdwId` (`:118-120`). Both sit behind a `boundary ? … : …` ternary whose false arm is
  # this slice's entire remit. The docblock at `:90-91` says so in as many words: "#821 replaces
  # this with the boundary's own wiring once triggers hold one."
  #
  # The ternary must COLLAPSE, not merely stop being reached. A false arm left in place compiles,
  # passes every test that supplies a boundary, and keeps `prApi.ts` alive — which makes AC2
  # unsatisfiable while looking finished.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A takeover resolves the running adw id through the tracker the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And issue 42 in the recording tracker has an adw workflow comment naming adw id "ciwxf3-prior"
    When the takeover handler evaluates issue 42 from that boundary
    Then the boundary's providers were asked for the comments on issue 42
    And the resolved takeover adw id is "ciwxf3-prior"

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario Outline: A takeover derives the remote stage from the boundary's code host
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And the branch "<branch>" has a pull request numbered 7 in state "<state>"
    When the takeover handler derives the stage for issue 42 under adw id "ciwxf3-prior" from that boundary
    Then the reconciled stage is "<stage>"
    And the boundary's code host was asked for the pull request on branch "<branch>"

    Examples:
      | branch                       | state  | stage          |
      | feature-issue-42-ciwxf3-prior | OPEN   | awaiting_merge |
      | feature-issue-42-ciwxf3-prior | MERGED | completed      |

  # ── §4  THE CANCEL DIRECTIVE (AC1) ────────────────────────────────────────────────────────
  #
  # `cancelHandler.ts:18` imports the same three-operation issue cluster #820 migrated in
  # `adwClearComments`: `fetchIssueCommentsRest`, `getIssueTitleSync`, `deleteIssueComment`. The id
  # round-trip trap is identical and worth restating because it is invisible: legacy
  # `deleteIssueComment(commentId: number, …)` takes a NUMBER, the port's
  # `deleteComment(commentId: string)` takes a STRING, and `IssueComment.id` is the REST id
  # stringified (#819). A migration that re-derives ids from a different listing deletes nothing and
  # still reports success, because the cancel sequence counts its own loop iterations rather than
  # the forge's acknowledgements.
  #
  # The cancel sequence is also the one place where a wrong repository is destructive rather than
  # merely wrong: steps 2–4 kill processes, remove worktrees and delete state directories.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A cancel directive clears the issue's comments through the boundary's tracker
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And issue 42 in the recording tracker has comments with ids "101", "102" and "103"
    When the cancel directive runs for issue 42 from that boundary
    Then the boundary's providers recorded comment deletions for the ids "101", "102" and "103"

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A local git remote naming another repository cannot redirect a cancel
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-821"
    And issue 42 in the recording tracker has comments with ids "101"
    When the cancel directive runs for issue 42 from that boundary
    Then every recorded provider call addressed the repository "adw-fixture/void-821"
    And the local git remote was never read

  # ── §5  THE GATEKEEPER'S CLASSIFY-AND-LABEL PATH (AC1) ────────────────────────────────────
  #
  # `webhookGatekeeper.ts:134` carries the `fetchGitHubIssue` adapter #820 pushed down out of
  # `core/issueClassifier.ts`, wrapped in `mapGitHubIssueToIssue` — and `:16` imports `applyLabel`
  # and `issueTypeToAdwLabel` for the persist-inferred-label step at `:150-158`. The two rows split
  # the seam the way the code does: classification reads, label persistence writes.
  #
  # The label write is guarded by `if (labelRouting?.persistInferredLabel && classification.success)`
  # and its failure is caught and logged at 'warn' (`:154-156`). So a migration that breaks it
  # breaks nothing loudly: issues simply stop acquiring their `adw:*` label, and the next cron cycle
  # re-classifies them from scratch through the language model, forever.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: The gatekeeper classifies a fresh issue by reading it through the boundary's tracker
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And issue 42 in the recording tracker carries the label "adw:chore"
    When the gatekeeper resolves the spawn for issue 42 from that boundary
    Then the boundary's providers were asked for issue 42
    And the classification is "/chore"

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: An inferred classification is persisted as a label through the boundary's tracker
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And issue 42 carries no labels
    And the trigger classifier will classify issue 42 as "/bug"
    When the gatekeeper resolves the spawn for issue 42 from that boundary with label persistence enabled
    Then the boundary's providers recorded the label "adw:bug" being applied to issue 42

  # ── §6  THE REGION-OVERLAP REGISTRATION (AC1) ─────────────────────────────────────────────
  #
  # `regionOverlapSignals.ts:13` imports `updateIssueBody` and `commentOnIssue`. This is the
  # mechanism that deferred THIS ISSUE behind #817 and #820 — both `adw:region-overlap` comments on
  # #821 were written by this code path.
  #
  # THE ORDER IS THE INVARIANT, and the docblock at `:78-81` explains why: `updateIssueBody`
  # RETHROWS, so it runs first and a failure aborts before the comment; the comment is posted only
  # on first successful registration, which is what makes it one-time. Swap them, or swallow the
  # body write, and the issue gets an explanatory comment every cron cycle while never actually
  # acquiring the `## Blocked by` line — so it keeps spawning in parallel on a stale base, which is
  # precisely the forced-rebase deadlock the mechanism exists to prevent.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: Registering a region overlap writes the blocked-by reference before the explanatory comment
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And issue 42 in the recording tracker has a body that does not reference issue 41
    When a region overlap deferring issue 42 behind issue 41 is registered from that boundary
    Then the boundary's providers recorded the body of issue 42 being updated before any comment
    And the updated body of issue 42 contains "#41 <!-- adw:region-overlap -->"
    And the boundary's issue tracker recorded a comment on issue 42

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A failed blocked-by write posts no explanatory comment
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And updating the body of issue 42 fails on the recording tracker
    When a region overlap deferring issue 42 behind issue 41 is registered from that boundary
    Then the region overlap was not reported as registered
    And the boundary's issue tracker recorded no comment

  # ── §7  THE LISTING CALLERS (AC1) ─────────────────────────────────────────────────────────
  #
  # `issueListApi.ts` has exactly two exports and four trigger callers: `concurrencyGuard.ts:11`,
  # `issueClosedUnblockRouter.ts:18`, `webhookGatekeeper.ts:30` and `takeoverHandler.ts:35`. All four
  # go through `IssueTracker.listIssues` / `fetchComments`.
  #
  # `concurrencyGuard` is the one with teeth. `fetchOpenIssuesWithComments` (`:17-24`) SWALLOWS every
  # error and returns `[]`, which makes the in-progress count 0, which means the
  # `MAX_CONCURRENT_PER_REPO` cap silently lifts and the cron spawns without limit. That degrade path
  # is deliberate and must survive the migration unchanged — but it also means a migration that
  # simply breaks the listing shows up as "ADW spawned nine workflows at once", not as a test
  # failure. The first row pins the cap holding; the second pins the degrade being unchanged.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A repository at its concurrency cap blocks a further spawn, counted through the boundary's tracker
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And the recording tracker lists 3 issues carrying adw workflow comments and no linked merged pull request
    And the per-repository concurrency cap is 3
    When the concurrency guard is consulted for that boundary
    Then the concurrency guard reported the repository at capacity
    And the boundary's providers were asked for the open issues of "adw-fixture/void-821"

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A failed issue listing degrades to permitting the spawn exactly as it does today
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And listing issues fails on the recording tracker
    And the per-repository concurrency cap is 3
    When the concurrency guard is consulted for that boundary
    Then the concurrency guard reported the repository below capacity

  # `issueDependencies.ts:16` uses `getIssueState` to decide whether a `## Blocked by` reference is
  # still blocking. A dependency wrongly read as open leaves the issue queued forever; wrongly read
  # as closed spawns it onto an unmerged base — the same deadlock §6 guards from the other side.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario Outline: A blocked-by dependency's open state is read through the boundary's tracker
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And issue 41 in the recording tracker is in state "<state>"
    When the open dependencies of an issue blocked by issue 41 are resolved from that boundary
    Then the resolved open dependencies are "<blocking>"
    And the boundary's providers were asked for issue 41

    Examples:
      | state  | blocking |
      | OPEN   | 41       |
      | CLOSED |          |

  # ── §8  THE BOOTSTRAP THAT PRECEDES THE BOUNDARY (AC2, FINDING 3) ─────────────────────────
  #
  # `resolveWebhookRepo` is upstream of every provider in the process — it is what decides which
  # repository the per-event boundary binds to. Wherever `getRepoInfoFromPayload` lands when
  # `githubApi.ts` is deleted, the resolution must stay pure and stay identical, including its
  # rejection of a malformed full name (`githubApi.ts:39-41`), because a silently-wrong parse here
  # binds the entire event — auth, providers, spawn args — to the wrong repository.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario Outline: A webhook payload's repository is resolved without touching the forge or the local remote
    Given the local git remote answers "adw-fixture/elsewhere-821"
    When a webhook payload naming the repository "<fullName>" is resolved
    Then the resolved webhook repository is "<resolved>"
    And the local git remote was never read

    Examples:
      | fullName             | resolved             |
      | adw-fixture/void-821 | adw-fixture/void-821 |
      | owner/repo           | owner/repo           |

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A webhook payload carrying a malformed repository name is rejected rather than half-parsed
    When a webhook payload naming the repository "not-a-full-name" is resolved
    Then resolving the webhook repository failed naming "not-a-full-name"

  # ── §9  WHOSE LOGIN COUNTS AS "SELF" (AC1, FINDING 4) ─────────────────────────────────────
  #
  # `prCommentDetector` survives, relocates, and loses its `getAuthenticatedUser` import when
  # `githubApi.ts` goes. The two rows pin the two failure directions named in FINDING 4. They are
  # written against the unaddressed-comment reader because that is where the answer is consumed —
  # asserting the login itself would assert an implementation detail rather than the behaviour that
  # depends on it.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A review comment written by the workflow's own login is never unaddressed
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And the recording code host reports its authenticated login is "adw-bot"
    And pull request 7 in the recording code host is on branch "feature-issue-42-ciwxf3-prior"
    And the branch "feature-issue-42-ciwxf3-prior" has no ADW commit
    And pull request 7 has a human review comment "please rename this" at "2026-09-09T10:00:00Z"
    And pull request 7 has a review comment by "adw-bot" at "2026-09-09T11:00:00Z"
    When the unaddressed comments of pull request 7 are read from that boundary
    Then the unaddressed comments are exactly "please rename this"

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: A human review comment is unaddressed even when the authenticated login cannot be resolved
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And the recording code host cannot resolve its authenticated login
    And pull request 7 in the recording code host is on branch "feature-issue-42-ciwxf3-prior"
    And the branch "feature-issue-42-ciwxf3-prior" has no ADW commit
    And pull request 7 has a human review comment "please rename this" at "2026-09-09T10:00:00Z"
    When the unaddressed comments of pull request 7 are read from that boundary
    Then the unaddressed comments are exactly "please rename this"

  # ── §10  WHAT DOES NOT MOVE (AC1's "for forge operations" qualifier, FINDING 7) ───────────
  #
  # #820 established the taxonomy: (a) forge operations move, (b) pure predicates over data the
  # caller already holds do not, (c) label-name constants do not. The triggers are the largest
  # remaining holder of (b) and (c), and #820 explicitly deferred them here. These rows assert the
  # behaviour so that the import repoint to `adws/core/adwLabels.ts` is provably a repoint — a
  # builder who turns a label constant into a `fetchLabels` round-trip, or routes `bodyLinksIssue`
  # through a provider, fails here rather than shipping a cron tick that makes N extra API calls per
  # issue per 20-second poll.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: Reading adw label names off labels the caller already holds asks the forge for nothing
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    When cron label eligibility is evaluated for an issue carrying the labels "adw:feature" and "enhancement"
    Then the evaluated adw label name is "adw:feature"
    And the boundary's providers recorded no forge call
    And the watched git context was asked for no forge-semantic operation

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: Deciding a pull request body links an issue asks the forge for nothing
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    When the per-issue scenario sweep tests whether the body "Closes #42" links issue 42
    Then the link decision is true
    And the boundary's providers recorded no forge call

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario Outline: The upgrade redrive reads its terminal and upgrade labels without a forge round-trip
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    When the upgrade redrive classifies an issue carrying the label "<label>"
    Then the upgrade redrive reported "<verdict>"
    And the boundary's providers recorded no forge call

    Examples:
      | label       | verdict          |
      | adw:upgrade | upgrade          |
      | adw:blocked | terminal         |

  # ── §11  THE STRUCTURAL BACKSTOPS (AC2, AC3, AC4, AC6) ────────────────────────────────────
  #
  # These rows carry every acceptance criterion that is a statement about the source tree, in the
  # only form the rot rule permits: runtime artefacts. They are not ceremony.
  #
  # `the git/gh guard is run across the repository` shells the whole `checkGitGhGuard.ts` binary,
  # whose `main()` calls `findStaleSanctionedEntries`. It fails if a deleted module's allowlist entry
  # survives (AC4), if a relocated survivor's entry goes stale at its old path or its new path
  # constructs unsanctioned (FINDING 5), and it is what keeps `CWD_DERIVED_IDENTITY_FNS` honest
  # after `getRepoInfo` is deleted (FINDING 6, PRD story 24). It is the executable form of AC4.
  #
  # The type-check is the executable form of AC2 and AC3: a deleted module with a surviving importer
  # cannot type-check, and a relocated module whose callers were not repointed cannot either. It is
  # also the only thing that catches the six `vi.mock` paths of FINDING 6 before the unit suite does.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: The guard stays green with no stale transitional entries after the legacy layer is deleted
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # The row asserts PROVIDERS only, not contexts: `gitContextFactory.ts` is explicitly excluded from
  # AC2's deletion list and kept by AC3, so `cancelHandler`'s `gitContextForSync` construction is
  # still legal here — retiring it is #822/#823, not this slice.

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: No GitHub provider is constructed outside the launch boundary during a migrated trigger run
    Given a launch boundary for the repository "adw-fixture/void-821" whose providers record every call
    And issue 42 in the recording tracker has comments with ids "101"
    When the cancel directive runs for issue 42 from that boundary
    Then no GitHub provider was constructed during the run

  @adw-821 @adw-ciwxf3-migrate-trigger-call
  Scenario: The ADW TypeScript type-check passes with the triggers on the boundary's providers
    Then the ADW TypeScript type-check passes
