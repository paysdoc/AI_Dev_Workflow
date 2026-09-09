@adw-820 @adw-wgg98x-migrate-orchestrator
Feature: The orchestrators, phases, core utilities and the proof publisher reach the forge through the boundary's providers alone — the legacy free functions stop being called, the wrong-repo fallbacks behind them die with them, and no workflow behaves differently

  Issue #820 is the third slice of the GitContext library extraction
  (`specs/prd/gitcontext-library-extraction.md`, Implementation Decisions → De-tangling wave, second
  bullet; user stories 3 and 8) and the first of two caller-migration waves. #816 landed the
  extraction-readiness guard, #817 moved the domain model into the provider package, #819 cut the
  GitHub adapter's own dependency on `adws/github/`. The adapter is clean. What is not clean is the
  set of callers still reaching PAST the adapter into the legacy free-function layer: orchestrators,
  phases, core utilities and the proof publisher. This slice walks them to the providers the launch
  boundary already hands them. #821 takes the trigger callers; the legacy modules stay in place
  until it lands.

  The PRD's bar is "no behavior change: same commands against the same repos" and the existing
  suites are the regression net. So every row below is written to fail for a REASON — a specific
  wrong thing a plausible, tsc-green, suite-green implementation does — rather than to restate the
  acceptance criteria in Gherkin.

  ── WHAT "FOR FORGE OPERATIONS" MEANS, AND WHY IT IS LOAD-BEARING ─────────────────────────────
  AC1 bans importing "a legacy free-function module or the `adws/github` barrel FOR FORGE
  OPERATIONS". That trailing qualifier is not decoration. The barrel (`adws/github/index.ts`)
  re-exports three different kinds of thing, and only one of them is in scope:

    (a) FORGE OPERATIONS — reach the network or the local git remote: `getRepoInfo`,
        `fetchGitHubIssue`, `fetchPRDetails`, `commentOnPR`, `approvePR`, `issueHasLabel`,
        `applyLabel`, `fetchIssueCommentsRest`, `deleteIssueComment`, `getIssueTitleSync`,
        `defaultFindPRByBranch`, `getUnaddressedComments`, `isGitHubAppConfigured`,
        `gitContextFor`/`gitContextForSync`. THESE MOVE.
    (b) PURE PREDICATES over data the caller already holds — `shouldSkipScenarioAuthoring`
        (`alignmentPhase`, `scenarioPhase`), `hasRegressionPromotionLabel` (`promotionRotAdvisory`),
        `hasWontFixLabelName` (`adwUpgrade`), `readAdwLabels` (`issueClassifier`), `bodyLinksIssue`.
        THESE ARE NOT FORGE OPERATIONS.
    (c) NAME CONSTANTS — `ADW_BLOCKED_LABEL` (`promotionReconcileLink`, `adwUpgrade`),
        `ADW_UPGRADE_LABEL` (`upgradeGate`), `ADW_UNVERIFIED_LABEL` (`unitTestPhase`,
        `stackCoherenceReporter`), `ADW_CLASSIFICATION_LABELS`/`ADW_REGRESSION_PROMOTION_LABEL`
        (`promotionIssueBody`), `ADW_NONE_LABEL` (`docsIndexReportBody`). THESE ARE NOT FORGE
        OPERATIONS EITHER.

  Reading AC1 as "no import at all" relocates (b) and (c) to a home nobody has designed, and breaks
  the trigger callers that import the same constants and are explicitly deferred to #821. Reading it
  too loosely leaves `fetchGitHubIssue` in `issueClassifier` because "the deps seam already allows
  injection". §10's rows pin the (b)/(c) behaviours so a migration cannot quietly take either wrong
  turn. `adwUpgrade.tsx`, `promotionIssueBody.ts`, `promotionReconcileLink.ts`, `upgradeGate.ts`,
  `alignmentPhase.ts`, `scenarioPhase.ts` and `promotionRotAdvisory.ts` import ONLY (b)/(c) — they
  already satisfy AC1 behaviourally: nothing they do reaches the forge. Their import PATH still
  moves — the (b)/(c) vocabulary leaves `labelManager.ts`/`prApi.ts` for `adws/core/adwLabels.ts`
  (the home #821 already assigns it), with both legacy modules re-exporting it so the trigger
  callers, the barrel and every existing test are untouched. §10's rows assert the behaviour, which
  must not change either way.

  ── FIVE FINDINGS THE TOUCHED-FILES LIST DOES NOT CARRY ───────────────────────────────────────

  FINDING 1 — TWO "CORE" FILES ARE BLOCKED BY #821, NOT MIGRATABLE HERE.
  `core/remoteReconcile.ts`'s legacy import feeds `buildLegacyReconcileDeps` (`:113`), which is
  reached ONLY through the `deps ?? ` default at `:85`. Its one production caller,
  `triggers/takeoverHandler.ts:115`, already passes `buildDefaultReconcileDeps(boundary)` when it
  holds a boundary and `undefined` when it does not — so the legacy wiring exists solely for the
  boundary-less trigger path, which is #821's remit. Identically, `core/issueClassifier.ts`'s
  `fetchGitHubIssue` is the `deps?.fetchIssue ?? ` default of `classifyIssueForTrigger` (`:119`),
  whose only production caller is `triggers/webhookGatekeeper.ts:134`. Deleting either default in
  this slice breaks a caller #820 is not allowed to touch. AC1 covers `adws/core/`, so the choice is
  settled: the legacy wiring is pushed DOWN into the trigger files now (`takeoverHandler.ts`,
  `webhookGatekeeper.ts`, and `cancelHandler.ts` for §1's tracker), leaving `core/` clean
  immediately, and #821 replaces those adapters from its own callers. The legacy MODULES themselves
  stay in place for the triggers, exactly as the issue requires. §4 and §5 therefore assert the
  behaviour over the BOUNDARY's wiring; the boundary-less trigger path keeps its cover in
  `remoteReconcile.test.ts` and `takeoverHandler`'s unit tests, which can drive it hermetically —
  a row here could not, because that path reads through the legacy free functions for real.

  FINDING 2 — `adwMerge.tsx`'s LEGACY IMPORT IS DEAD. `commentOnPR` is declared on `MergeDeps`
  (`:62`) and wired in `buildDefaultDeps` (`:244`) and NEVER CALLED — `deps.commentOnPR` appears
  nowhere in the file. Its migration is a three-line deletion with no behaviour to assert, so this
  file has no behavioural row; the type-check (§11) is its whole backstop. A plan that invents a
  merge-comment scenario is testing something that does not exist.

  FINDING 3 — THE TOUCHED-FILES LIST IS BOTH TOO LONG AND TOO SHORT. Too long:
  `phases/autoMergePhase.ts` and `phases/docsSelfCheck.ts` import nothing from `adws/github` at all
  (#796 finished them), and `proof/types.ts` only carries a type shape. Too short: AC1 binds "the
  root orchestrators", which adds `adwChore.tsx` (`issueHasLabel`, `approvePR` — both with
  `config.repoContext.repoId` already in hand at `:148`) and `adwPrReview.tsx`
  (`defaultFindPRByBranch`, `getRepoInfo`). `adwChore.tsx` exports nothing, so it cannot be driven
  in this harness; §11's backstops are its only cover, and its unit suite is the place to assert it.

  FINDING 4 — `adwPrReview.tsx` HAS AN ORDERING PROBLEM, NOT AN IMPORT PROBLEM.
  `resolvePrReviewInvocation` (`:57`) performs the branch→PR lookup at `main`'s line `:99`, THREE
  LINES BEFORE `buildLaunchBoundary` is called at `:102`. There is no boundary to migrate onto yet.
  The fix is to hoist the boundary above the invocation resolution — a reordering, and the one place
  in this slice where a "mechanical" import swap cannot work. §4's second row is written against
  that reordering.

  FINDING 5 — THE CONSTRUCTION GUARD'S RATCHET IS THIS SLICE'S SHARPEST EDGE, IN BOTH DIRECTIONS.
  `constructionRule.ts` lists TRANSITIONAL sanctioned sites, and `findStaleSanctionedEntries`
  fails the build when a listed file stops constructing. Nine of those entries are in this slice's
  scope: `core/remoteReconcile.ts`, `phases/buildPhase.ts`, `documentPhase.ts`, `prPhase.ts`,
  `prReviewPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `workflowInit.ts` and
  `core/orchestratorLib.ts`. Dropping `gitContextFor`/`gitContextForSync` from a phase without
  deleting its entry fails the guard as a stale entry. KEEPING the call is NOT an AC1 violation:
  AC1 names seven modules and the barrel, and `github/gitContextFactory.ts` is not among them, so
  the worktree-owning phases and `workflowInit` keep their construction — deep-imported instead of
  through the barrel — and their entries stay live. Retiring those calls is #822's explicitly
  enumerated scope. Exactly ONE entry stops constructing in this slice, `core/remoteReconcile.ts`,
  and it must be deleted or the ratchet fails. AC2 also forbids ADDING entries — a phase that needs
  a context it does not already build must take `config.gitContext` (already on
  `WorkflowConfig:56`), never mint a new site.
  NOTE: `core/orchestratorLib.ts:35` constructs for `hasUncommittedChanges` — a GIT operation, not a
  forge one — and is not in the Touched Files list. Leaving it alone keeps its entry live and the
  guard green; that is the correct outcome, not an oversight.

  ── HOW THESE ROWS RUN ────────────────────────────────────────────────────────────────────────
    • THE HARNESS IS feature-796's, EXTENDED. Every phrase already registered in
      `features/per-issue/step_definitions/feature-796.steps.ts` is REUSED, never redefined —
      redefining one is an AmbiguousStepDefinition. That covers the recording-provider boundary
      (`a launch boundary for the repository … whose providers record every call`), the watched
      context, `the local git remote answers …` / `… was never read`, and the tracker/code-host
      call-log assertions. `the ADW codebase is checked out` comes from
      `features/step_definitions/ensureCronOnEveryEventSteps.ts:8`; `the ADW TypeScript type-check
      passes` from `feature-504.steps.ts:1126`; `the git/gh guard is run across the repository` and
      `the git/gh guard reports no violations` from `feature-691.steps.ts:82,91` — and that pair
      shells the whole `checkGitGhGuard.ts` binary, so the stale-entry ratchet is inside what they
      assert.
    • THE FIXTURE REPOSITORY MUST NOT EXIST. A RED run reaches un-migrated free functions that shell
      out for real. Every row uses `adw-fixture/void-820`, which is not a repository, so the worst a
      RED run does is fail a `gh` call slowly. `adw-fixture/elsewhere-820` is the deliberately
      DIFFERENT answer given to the local git remote in the wrong-repo rows — the two names must
      never be swapped, or those rows stop discriminating.
    • DELIBERATE DISTANCE FROM NEIGHBOURING VOCABULARY: feature-796 owns
      `the boundary's issue tracker recorded …` for issue traffic, so this file says
      `the boundary's code host recorded …` for pull-request traffic; feature-794 owns
      `the boundary's issue tracker …` for MINTING, and nothing here re-enters that neighbourhood.

  Background:
    Given the ADW codebase is checked out

  # ── §1  THE COMMENT-CLEARING ORCHESTRATOR (AC1) ───────────────────────────────────────────
  #
  # `adwClearComments.tsx` is the densest legacy caller left: `clearIssueComments` (`:64`) performs
  # three forge operations in eight lines — list, read title, delete — against a `resolvedRepoInfo`
  # that falls back to `getRepoInfo()`. It is also fully exported and takes no config object, so it
  # is the cleanest thing in the slice to drive.
  #
  # The id round-trip is the trap. Legacy `deleteIssueComment(commentId: number, …)`
  # (`issueApi.ts:355`) takes a NUMBER; the port's `deleteComment(commentId: string)` takes a
  # STRING, and `IssueComment.id` is the REST id stringified (#819). A migration that passes the
  # port's string id to a still-numeric call site, or re-derives ids from a different listing,
  # deletes nothing and still reports success — the function counts its own loop iterations, not
  # the forge's acknowledgements.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: Clearing an issue's comments lists and deletes them through the issue tracker the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    And issue 42 in the recording tracker has comments with ids "101", "102" and "103"
    When the comment-clearing orchestrator clears issue 42 from that boundary
    Then the boundary's providers were asked for the comments on issue 42
    And the boundary's providers recorded comment deletions for the ids "101", "102" and "103"
    And the comment-clearing orchestrator reported 3 deleted and 0 failed
    And the watched git context was asked for no forge-semantic operation

  # The title read is a separate port gap, not a detail. `getIssueTitleSync` has no equivalent on
  # IssueTracker: `fetchIssue` is async and returns the whole issue, and `clearIssueComments` is
  # synchronous. Widening the port (AC1's second sentence) is the honest fix; quietly dropping the
  # title from the log line is the shortcut this row exists to catch.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The cleared issue's title is read through the tracker rather than a legacy synchronous call
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And issue 42 in the recording tracker is titled "A stuck workflow"
    And issue 42 in the recording tracker has comments with ids "101"
    When the comment-clearing orchestrator clears issue 42 from that boundary
    Then the boundary's providers were asked for the title of issue 42
    And the comment-clearing orchestrator reported the issue title "A stuck workflow"

  # `resolvedRepoInfo = repoInfo ?? getRepoInfo()` (`:65`) is the wrong-repo vector in its purest
  # form: run `adwClearComments 42` inside a worktree whose remote names another repository and the
  # deletions land there. This row is the reason the migration is worth doing at all.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: A local git remote naming another repository cannot redirect the comment clearing
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And issue 42 in the recording tracker has comments with ids "101"
    When the comment-clearing orchestrator clears issue 42 from that boundary
    Then every recorded provider call addressed the repository "adw-fixture/void-820"
    And the local git remote was never read

  # ── §2  THE PROOF PUBLISHER (AC1) ─────────────────────────────────────────────────────────
  #
  # `proof/prProofPublisher.ts` defaults its commenter to the legacy `commentOnPR` (`:146`), and
  # `proof/types.ts` encodes that in `CommenterFn = (prNumber, body, repoInfo) => void`. Migrating
  # to `codeHost.commentOnPullRequest(prNumber, body)` drops the third parameter — the "call-shape
  # update" AC3 permits.
  #
  # THE TRAP: `repoInfo` IS LOAD-BEARING TWICE. Besides the commenter, `publishPrProof` destructures
  # it for the R2 upload (`const { owner, repo } = repoInfo`, then `uploader({ owner, repo, key, …
  # })`). A migration that deletes `repoInfo` from `PublishDeps` because "the code host knows the
  # repo now" breaks the upload key namespace, and `publishPrProof` swallows every error it raises —
  # so proof screenshots silently stop being published and no test notices. The second row exists
  # only to make that failure loud.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The proof comment is posted by the code host the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And a scenario proof result reporting 3 passed and 0 failed with no artifacts
    When the proof publisher publishes for pull request 7 under adw id "wgg98x-void" from that boundary
    Then the boundary's code host recorded a comment on pull request 7
    And the recorded comment on pull request 7 contains "3 passed"

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The proof artifacts are still uploaded under the repository's own key namespace
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And object storage is configured with a recording uploader
    And a scenario proof result reporting 1 passed and 0 failed with one screenshot artifact
    When the proof publisher publishes for pull request 7 under adw id "wgg98x-void" from that boundary
    Then the recording uploader was asked to upload for the repository "adw-fixture/void-820"
    And the boundary's code host recorded a comment on pull request 7

  # `proofPublishPhase.ts:34` is the phase-level half: `repoContext?.repoId ?? getRepoInfo()`. The
  # phase wraps everything in a try/catch that logs at 'warn' and continues, so a wrong-repo read
  # here is invisible in every existing suite.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The proof publish phase publishes to the boundary's repository, not the local remote's
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    And a scenario proof result reporting 2 passed and 0 failed with no artifacts
    When the proof publish phase runs for that configuration
    Then the boundary's code host recorded a comment on pull request 7
    And the local git remote was never read

  # ── §3  THE REMAINING WRONG-REPO FALLBACKS (AC1) ──────────────────────────────────────────
  #
  # `phases/orchestratorLock.ts:25` resolves the lock namespace as `config.targetRepo ?? getRepoInfo()`
  # while `config.repoContext.repoId` — the boundary-bound identity — sits unused on the same object.
  #
  # THE LOCK KEY MUST NOT MOVE. `acquireIssueSpawnLock(repoInfo, issueNumber, pid)` derives its lock
  # artefact path from the repo identity. If the migration changes the derived key for runs that
  # behave identically today, every in-flight lock is orphaned and two orchestrators can spawn on the
  # same issue across the deploy. The first row pins the self-host key as unchanged; the second pins
  # the target-repo key to the boundary rather than the ambient remote.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: A self-host run's spawn lock keeps the key it uses today
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/void-820"
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    When the orchestrator lock is acquired and released for that configuration
    Then the spawn lock artefact was written under the repository "adw-fixture/void-820"
    And the spawn lock artefact was removed on release

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: A target-repo run's spawn lock is namespaced by the boundary, not the local remote
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    When the orchestrator lock is acquired and released for that configuration
    Then the spawn lock artefact was written under the repository "adw-fixture/void-820"
    And the local git remote was never read

  # `phases/depauditSetup.ts:71` already receives a `codeHost` and calls `codeHost.setSecret` on it
  # (`:43`), then reads the LOCAL REMOTE two lines earlier to name the repository in its warnings.
  # `codeHost.getRepoIdentifier()` is on the port and is the same object the secret writes go to.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The dependency-audit setup names the repository its code host is bound to
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    And no secrets are available to propagate
    When the dependency-audit setup runs for that configuration
    Then the reported skipped-secret warnings name the repository "adw-fixture/void-820"
    And the local git remote was never read

  # ── §4  THE BRANCH LOOKUPS IN core/ AND THE PR-REVIEW ORDERING (AC1, FINDINGS 1 & 4) ──────
  #
  # `core/upgradeClaim.ts:175-178` wires `defaultFindPRByBranch` and `fetchPRDetails` into
  # `UpgradeClaimDeps` from `buildDefaultUpgradeClaimDeps` — a builder whose only production caller
  # is `upgradeGate.ts:179`, which already holds `providers`. This one is unblocked, unlike §5's
  # sibling, and the migration is a straight swap onto `codeHost.findPullRequestByBranch` and
  # `codeHost.fetchPullRequest`.
  #
  # `resolveIssueNumberFromPR` reads `details.issueNumber` and returns null on ANY throw. The port's
  # `PullRequest` carries the same fact as `linkedIssueNumber` (optional). A migration that reads a
  # field that is never populated silently returns null forever, which makes every upgrade claim look
  # unlinked and re-opens issues that already exist — this row is that regression's only alarm.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The upgrade claim resolves its existing pull request through the code host the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the branch "adw-upgrade-abc123" has a pull request numbered 9 in state "OPEN"
    And pull request 9 in the recording code host implements issue 51
    When the upgrade claim deps resolve the issue number for the branch "adw-upgrade-abc123" from that boundary
    Then the resolved upgrade claim issue number is 51
    And the boundary's code host was asked for the pull request on branch "adw-upgrade-abc123"

  # FINDING 4 as an executable row. Today the lookup happens before any boundary exists, so this is
  # RED for an ordering reason rather than an import reason, and a plan that only rewrites the import
  # cannot make it pass.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The pr-review orchestrator resolves a resumed branch's pull request after the boundary exists
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And a state file for adw id "wgg98x-void" recording branch "feature-issue-42-void"
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "OPEN"
    When the pr-review orchestrator resolves its invocation for adw id "wgg98x-void" from that boundary
    Then the resolved pr-review pull request number is 7
    And the boundary's code host was asked for the pull request on branch "feature-issue-42-void"
    And the local git remote was never read

  # `core/remoteReconcile.ts` — FINDING 1. With `buildLegacyReconcileDeps` pushed down into
  # `takeoverHandler.ts`, `deriveStageFromRemote` takes its wiring from the caller, and the stage it
  # derives over the boundary's wiring must be the stage it derives today. This row is the
  # invariant, not the implementation; the boundary-less trigger path is covered by
  # `remoteReconcile.test.ts` and `takeoverHandler`'s unit tests, which can drive it hermetically.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario Outline: The remote reconcile derives today's stage from the boundary's wiring
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And a state file for adw id "wgg98x-void" recording branch "feature-issue-42-void"
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "<state>"
    When the remote reconcile derives the stage for adw id "wgg98x-void" with <wiring>
    Then the reconciled stage is "<stage>"

    Examples:
      | state  | wiring                | stage          |
      | OPEN   | the boundary's wiring | awaiting_merge |
      | MERGED | the boundary's wiring | completed      |

  # ── §5  THE LABEL-OVERRIDE CHOKEPOINT (AC1, FINDING 1) ────────────────────────────────────
  #
  # `core/issueClassifier.ts` is where a mechanical migration does the most damage, because the
  # damage type-checks. `fetchGitHubIssue` returns the raw `GitHubIssue`, whose `labels` are OBJECTS
  # (`{ name: string }`), and `readAdwLabels(issue)` (`:133`) reads them to enforce the adw:* label
  # override — the #618 chokepoint that ALL FOUR spawn paths share. The port's `fetchIssue` returns
  # the forge-neutral `Issue`, whose `labels` are STRINGS.
  #
  # Swap the fetcher without reconciling the label shape and `readAdwLabels` sees nothing it
  # recognises: `labelReading.classification` is undefined, the override never fires, and every
  # labelled issue silently falls through to the LLM classifier. That costs money on every trigger
  # and produces the wrong workflow on some of them, and no existing test catches it because the
  # unit suite injects `deps.fetchIssue` and never exercises the default.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario Outline: An adw label still overrides classification without reaching the language model
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And issue 42 in the recording tracker carries the label "<label>"
    When the trigger classifier classifies issue 42 from that boundary
    Then the classification is "<command>"
    And the trigger classifier did not invoke the language model

    Examples:
      | label       | command  |
      | adw:chore   | /chore   |
      | adw:bug     | /bug     |
      | adw:feature | /feature |

  # The conflict and no-label paths must keep falling THROUGH to the model — an over-eager migration
  # that maps any label to a classification breaks them in the opposite direction.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: An issue carrying two conflicting adw labels still falls through to the language model
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And issue 42 in the recording tracker carries the labels "adw:chore" and "adw:feature"
    When the trigger classifier classifies issue 42 from that boundary
    Then the trigger classifier invoked the language model

  # ── §6  THE APPROVAL CAPABILITY GATE (AC1 second sentence — port widening) ────────────────
  #
  # `phases/reviewPhase.ts:110` gates PR approval on `isGitHubAppConfigured() && GITHUB_PAT` — a
  # GitHub-specific capability probe standing in a forge-neutral phase. It cannot simply be deleted:
  # `GitLabCodeHost.approvePullRequest` is a refusal stub that THROWS, so an ungated call turns a
  # passing review into a thrown phase on any GitLab repo. It cannot simply be kept either, because
  # keeping it means `phases/` still imports `githubAppAuth` — exactly what AC1 forbids.
  #
  # The forge-neutral shape is a capability question on the port, answered by the adapter that knows:
  # GitHub answers from its own app/PAT configuration; a forge that cannot express approval refuses
  # by name (§9), as the issue's "named refusal stubs on GitLab/Jira, exactly as #796 did" requires.
  # Approval failure is documented non-fatal (`reviewPhase.ts:109`), and so is a refused capability
  # probe — a passing review stays passed on every forge. Both rows keep it that way.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: A passing review approves the pull request when the code host reports it can
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the recording code host reports that it can approve pull requests
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    When the review phase completes with no blocker issues for that configuration
    Then the boundary's code host recorded an approval of pull request 7

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: A passing review on a code host that cannot approve neither approves nor fails
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the recording code host reports that it cannot approve pull requests
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    When the review phase completes with no blocker issues for that configuration
    Then the boundary's code host recorded no approval
    And the review phase reported the review as passed

  # ── §7  THE LABEL-WRITE POLICY MUST NOT DRIFT (AC1) ───────────────────────────────────────
  #
  # `phases/unitTestPhase.ts:138` and `phases/stackCoherenceReporter.ts:29` both call the legacy
  # `applyLabel(issueNumber, ADW_UNVERIFIED_LABEL, repoInfo)` inside a try/catch whose comment
  # explains why (`:132` — "applyLabel can throw; swallow it").
  #
  # THE PORT OFFERS TWO METHODS AND ONLY ONE IS CORRECT. `applyLabel` lazy-creates a missing label
  # and RETHROWS anything else; `addLabel` swallows everything (fail-open). Reaching for `addLabel`
  # because it "matches the existing swallow" moves the swallow from the caller into the provider and
  # loses the lazy-create — on a repository that has never seen `adw:unverified`, the label is never
  # created and never applied, and the phase reports success either way. Both rows are green with
  # `applyLabel` and green-looking-but-wrong with `addLabel`, which is why the second one asserts the
  # creation rather than the application.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: A failing unit-test phase marks the issue unverified through the tracker the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    When the unit-test phase records an unverified verdict for that configuration
    Then the boundary's providers recorded the label "adw:unverified" applied to issue 42
    And the local git remote was never read

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: Marking an issue unverified on a repository that lacks the label creates it first
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the recording tracker has no "adw:unverified" label defined
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    When the unit-test phase records an unverified verdict for that configuration
    Then the boundary's providers recorded the label "adw:unverified" being created
    And the boundary's providers recorded the label "adw:unverified" applied to issue 42

  # ── §8  THE UNADDRESSED-COMMENT READ (AC1 second sentence — the deepest widening) ─────────
  #
  # `phases/prReviewPhase.ts:42,55` calls `fetchPRDetails` and `getUnaddressedComments`. The first is
  # a straight swap onto `codeHost.fetchPullRequest`. The second is not a port method at all: it is a
  # COMPOSITE (`prCommentDetector.ts:55`) that fetches PR details, fetches review comments, filters
  # out bot / self / ADW-signed authors using `getAuthenticatedUser()`, constructs its own context
  # via `gitContextForRepo`, reads the branch's last ADW commit timestamp, and keeps only comments
  # newer than it.
  #
  # THE PORT CANNOT EXPRESS THE FILTER TODAY. `ReviewComment` carries `author: string` — there is no
  # `isBot` and no authenticated-user identity — so decomposing into `fetchPullRequest` +
  # `fetchReviewComments` + framework-side filtering silently drops the bot and self-review
  # exclusions, and the pr-review workflow starts replying to its own comments in a loop. The settled
  # shape is decomposition, not a composite port method: `ReviewComment` grows `isBot` and `CodeHost`
  # grows `getAuthenticatedUser`, and the filter itself becomes `readUnaddressedComments` in
  # `adws/core/` over those two reads plus the branch's last ADW commit. Either way these two rows
  # must hold — they assert the filter's outcome, not where it lives.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The pr-review workflow sees only human comments posted after the last ADW commit
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And pull request 7 in the recording code host is on branch "feature-issue-42-void"
    And the branch "feature-issue-42-void" has its last ADW commit at "2026-09-01T00:00:00Z"
    And pull request 7 has a human review comment "please rename this" at "2026-09-02T00:00:00Z"
    And pull request 7 has a human review comment "looks good" at "2026-08-30T00:00:00Z"
    When the pr-review workflow reads the unaddressed comments for pull request 7 from that boundary
    Then the unaddressed comments are exactly "please rename this"

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario Outline: A comment the workflow itself or a bot authored is never unaddressed
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And pull request 7 in the recording code host is on branch "feature-issue-42-void"
    And the branch "feature-issue-42-void" has no ADW commit
    And pull request 7 has a review comment "<body>" from a "<kind>" author at "2026-09-02T00:00:00Z"
    When the pr-review workflow reads the unaddressed comments for pull request 7 from that boundary
    Then the unaddressed comments are empty

    Examples:
      | kind          | body                    |
      | bot           | dependabot bumped a dep |
      | self-reviewed | approving my own work   |
      | ADW-signed    | ADW review complete     |

  # ── §9  A FORGE THAT IS NOT GITHUB REFUSES BY NAME (AC1 second sentence) ──────────────────
  #
  # Every port method this slice grows gets a refusal stub on GitLab/Jira that names itself, exactly
  # as #796 did (`providers/__tests__/refusalStubs.test.ts`). Naming matters: a bare `throw` or a
  # silent `return undefined` turns a missing capability into a mystery at 3am, and a stub that
  # returns a plausible falsy value turns it into a wrong answer that never surfaces at all.
  #
  # The rows below are the three METHODS this slice adds: `getIssueTitle` (§1), the capability probe
  # (§6), and the authenticated-user read §8's filter needs. §8's composite is NOT a port method —
  # the port grows `getAuthenticatedUser` plus an `isBot` flag on `ReviewComment` and the filter is
  # composed framework-side — so there is no `fetchUnaddressedReviewComments` row. The two FIELD
  # widenings (`PullRequest.state`, `ReviewComment.isBot`) are data, not methods, and get no row
  # here. Each added method must fail with its own name.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario Outline: A widened port method refuses by name on a forge that does not implement it
    When the "<method>" method is called on the "<provider>" provider
    Then it fails with a message naming "<provider>.<method>"

    Examples:
      | provider         | method                 |
      | JiraIssueTracker | getIssueTitle          |
      | GitLabCodeHost   | canApprovePullRequests |
      | GitLabCodeHost   | getAuthenticatedUser   |

  # ── §10  WHAT DOES NOT MOVE (AC1's "for forge operations" qualifier) ──────────────────────
  #
  # The scope note's (b)/(c) categories, as behaviour rather than as an argument. These two rows are
  # GREEN TODAY and must stay green: they are the alarm for a migration that over-reaches and turns a
  # pure predicate or a label constant into a forge call. Moving the vocabulary itself to
  # `adws/core/adwLabels.ts` is expected (see the scope note) and invisible here, as long as
  # `labelManager.ts`/`prApi.ts` keep re-exporting it for the trigger callers #821 owns.
  #
  # `shouldSkipScenarioAuthoring` reads labels the phase already holds on `config.issue` — no forge
  # traffic at all, which is exactly why the assertion is "asked for nothing".

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: Deciding to skip scenario authoring asks the forge for nothing
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    And the configuration's issue carries the label "adw:none"
    When the scenario phase runs for that configuration
    Then the scenario phase reported that it skipped scenario authoring
    And the boundary's providers recorded no forge call

  # The upgrade orchestrator's `wontfix` escape hatch runs on `hasWontFixLabelName` over the labels
  # already on the `PullRequestSummary` the code host returned. feature-796 covers the escape hatch
  # itself; this row covers only the thing #820 could break — that reading it costs no forge call.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: Reading the wontfix escape hatch off a fetched pull request asks the forge for nothing further
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the claim branch for issue 51 has a pull request numbered 9 in state "MERGED" labelled "wontfix"
    When the upgrade claim deps read the retirement state of the claim pull request for issue 51 from that boundary
    Then the claim pull request is reported retired
    And the boundary's code host was asked for the pull request on branch "adw-upgrade-abc123" exactly once

  # ── §11  THE STRUCTURAL BACKSTOPS (AC1 residue, AC2, AC3) ─────────────────────────────────
  #
  # These three rows carry everything not behaviourally drivable in this harness: `adwMerge.tsx`'s
  # dead deps field (FINDING 2), `adwChore.tsx`'s unexported call sites (FINDING 3), the phases whose
  # only change is dropping a `gitContextFor` they no longer need, and — the one AC with real teeth —
  # the construction guard's stale-entry ratchet (FINDING 5).
  #
  # The guard row is not ceremony. `the git/gh guard is run across the repository` shells the whole
  # `checkGitGhGuard.ts` binary, whose `main()` calls `findStaleSanctionedEntries`. Migrate a phase
  # off `gitContextFor` and forget its transitional entry and this row fails; add a new transitional
  # entry to make a fresh construction site legal and it fails on the ratchet's other edge. It is the
  # only executable statement of AC2 in the file.

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The construction guard stays green with no stale transitional entries after the migration
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: No provider or context is constructed outside the launch boundary during a migrated run
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    When the unit-test phase records an unverified verdict for that configuration
    Then no GitHub provider was constructed during the phase

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The ADW TypeScript type-check passes with the callers on the boundary's providers
    Then the ADW TypeScript type-check passes
