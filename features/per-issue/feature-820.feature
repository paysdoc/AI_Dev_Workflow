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

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The cleared issue's title is read through the tracker rather than a legacy synchronous call
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And issue 42 in the recording tracker is titled "A stuck workflow"
    And issue 42 in the recording tracker has comments with ids "101"
    When the comment-clearing orchestrator clears issue 42 from that boundary
    Then the boundary's providers were asked for the title of issue 42
    And the comment-clearing orchestrator reported the issue title "A stuck workflow"

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: A local git remote naming another repository cannot redirect the comment clearing
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And issue 42 in the recording tracker has comments with ids "101"
    When the comment-clearing orchestrator clears issue 42 from that boundary
    Then every recorded provider call addressed the repository "adw-fixture/void-820"
    And the local git remote was never read

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

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The proof publish phase publishes to the boundary's repository, not the local remote's
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    And a scenario proof result reporting 2 passed and 0 failed with no artifacts
    When the proof publish phase runs for that configuration
    Then the boundary's code host recorded a comment on pull request 7
    And the local git remote was never read

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

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The dependency-audit setup names the repository its code host is bound to
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the local git remote answers "adw-fixture/elsewhere-820"
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    And no secrets are available to propagate
    When the dependency-audit setup runs for that configuration
    Then the reported skipped-secret warnings name the repository "adw-fixture/void-820"
    And the local git remote was never read

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: The upgrade claim resolves its existing pull request through the code host the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the branch "adw-upgrade-abc123" has a pull request numbered 9 in state "OPEN"
    And pull request 9 in the recording code host implements issue 51
    When the upgrade claim deps resolve the issue number for the branch "adw-upgrade-abc123" from that boundary
    Then the resolved upgrade claim issue number is 51
    And the boundary's code host was asked for the pull request on branch "adw-upgrade-abc123"

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

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: An issue carrying two conflicting adw labels still falls through to the language model
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And issue 42 in the recording tracker carries the labels "adw:chore" and "adw:feature"
    When the trigger classifier classifies issue 42 from that boundary
    Then the trigger classifier invoked the language model

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

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario Outline: A widened port method refuses by name on a forge that does not implement it
    When the "<method>" method is called on the "<provider>" provider
    Then it fails with a message naming "<provider>.<method>"

    Examples:
      | provider         | method                 |
      | JiraIssueTracker | getIssueTitle          |
      | GitLabCodeHost   | canApprovePullRequests |
      | GitLabCodeHost   | getAuthenticatedUser   |

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: Deciding to skip scenario authoring asks the forge for nothing
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And a workflow configuration bound to that boundary for issue 42 with no target repository
    And the configuration's issue carries the label "adw:none"
    When the scenario phase runs for that configuration
    Then the scenario phase reported that it skipped scenario authoring
    And the boundary's providers recorded no forge call

  @adw-820 @adw-wgg98x-migrate-orchestrator
  Scenario: Reading the wontfix escape hatch off a fetched pull request asks the forge for nothing further
    Given a launch boundary for the repository "adw-fixture/void-820" whose providers record every call
    And the claim branch for issue 51 has a pull request numbered 9 in state "MERGED" labelled "wontfix"
    When the upgrade claim deps read the retirement state of the claim pull request for issue 51 from that boundary
    Then the claim pull request is reported retired
    And the boundary's code host was asked for the pull request on branch "adw-upgrade-abc123" exactly once

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
