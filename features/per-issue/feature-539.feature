@adw-539 @adw-m45h0x-upgradeclaim-deep-mo
Feature: upgradeClaim primitive — atomic branch-namespace claim with PR-linkage loser resolution

  Issue #539 builds the atomic claim primitive that lets concurrent
  orchestrators agree on a single upgrade run. It is the
  `claimUpgradeOrFindExisting(hash, repoInfo)` deep module described in the
  "Upgrade claim primitive" section of the parent PRD
  (`specs/prd/adw-init-hash-and-label-classification.md`).

  The primitive uses GitHub's branch namespace as the only thing that gives
  create-if-not-exists semantics across distributed orchestrators:

    1. It creates an empty commit (`git commit --allow-empty`) on a new branch
       named `adw-upgrade-<hash>` and runs `git push origin adw-upgrade-<hash>`.
    2. Push success ⇒ this orchestrator is the WINNER. The primitive returns
       `{ won: true }`.
    3. Push failure (the branch already exists) ⇒ this orchestrator is the
       LOSER. It queries for the open issue carrying the `adw:upgrade` label
       whose pull request is linked to the existing `adw-upgrade-<hash>`
       branch, and returns
       `{ won: false, existingIssueNumber, existingBranch }`.

  Because the push is the serialisation point, two orchestrators racing on the
  same hash always resolve to exactly one winner; every other claimant takes
  the loser path and is handed the winner's branch and tracking issue. Creating
  the `adw:upgrade` tracking issue, registering the dependency, and returning
  the issue to the Todo lane are the CALLER's responsibilities
  (`initializeWorkflow`) and are out of scope for this primitive — this file
  pins only what the claim primitive itself observably does.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime,
    never the text of a source file:

      • the value object the primitive RETURNS (`won`, and on the loser path
        `existingIssueNumber` / `existingBranch`) — a produced output, like a
        recorded call;
      • the git artefacts captured by the git-mock — the empty claim commit and
        the push on `adw-upgrade-<hash>` (the same recorded-invocation channel
        behind vocabulary entries T4 / T11);
      • the single accepted push that proves the branch-namespace race admitted
        exactly one winner.

    No step reads `claimUpgradeOrFindExisting`'s source module, or any other
    source file, as text, parses it as JSON/AST, or substring-matches its
    contents. The primitive is proven behaviourally — by what it returns and the
    git/GitHub artefacts it produces — exactly as the framework Rot-Prevention
    rule and `features/regression/vocabulary.md` Rot-Detection Rubric require.

  Scope notes:

    • The deterministic harness here is the git-mock + mock GitHub API (the
      same harness behind the vocabulary patterns), which models GitHub's
      branch-namespace contract: a push to a brand-new branch succeeds, a push
      to an already-existing branch is rejected. The PRD's "integration tests
      against a sandbox target repo" (AC bullet 5) — a true atomic-race against a
      live GitHub remote — is the implementer's non-deterministic integration
      test and is intentionally out of BDD scope, because a live remote cannot
      be asserted deterministically.
    • Creating the `adw:upgrade` tracking issue, dependency registration, and the
      return-to-Todo handoff belong to `initializeWorkflow` and are covered by
      that integration work, not by this primitive's scenarios.
    • The race window where the branch has been claimed but the winner has not
      yet opened its tracking PR/issue (so the loser can resolve `existingBranch`
      but no `existingIssueNumber` is linkable yet) is NOT pinned by this issue —
      its resolution policy is unspecified in the acceptance criteria and is
      surfaced to the maintainer rather than invented here.

  Vocabulary note:

    The registered phrases `an issue {int} exists in the mock issue tracker`
    (G4), `the git-mock recorded a commit on branch {string}` (T4), and
    `the git-mock recorded a push to branch {string}` (T11) are reused. The
    claim primitive's return-shape assertions (`won`, `existingIssueNumber`,
    `existingBranch`), the PR-on-branch ↔ tracking-issue linkage setup, and the
    "exactly one accepted push" race assertion have no registered phrase — the
    registry is scoped to orchestrator/phase/mock-query behaviours. Per the
    vocabulary-preference rule, novel Gherkin phrasing is introduced here and the
    gap is surfaced to the maintainer in the agent Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Winner path — the upgrade branch is absent ──────────────────────────

  @adw-539 @adw-m45h0x-upgradeclaim-deep-mo
  Scenario: A claim against an absent upgrade branch wins and pushes the claim commit
    Given a target repo whose remote has no "adw-upgrade-a1b2c3d4" branch
    When the upgrade claim runs for hash "a1b2c3d4" against the target repo
    Then the claim result reports won as true
    And the claim result reports no existing tracking issue
    And the git-mock recorded a commit on branch "adw-upgrade-a1b2c3d4"
    And the git-mock recorded a push to branch "adw-upgrade-a1b2c3d4"

  # ── §2 Loser path — the upgrade branch already exists ──────────────────────

  @adw-539 @adw-m45h0x-upgradeclaim-deep-mo
  Scenario: A claim against an already-claimed upgrade branch loses and returns the existing claim
    Given a target repo whose remote already has the branch "adw-upgrade-a1b2c3d4"
    And an open issue 9701 labeled "adw:upgrade" is linked by its pull request to branch "adw-upgrade-a1b2c3d4"
    When the upgrade claim runs for hash "a1b2c3d4" against the target repo
    Then the claim result reports won as false
    And the claim result reports existingBranch "adw-upgrade-a1b2c3d4"
    And the claim result reports existingIssueNumber 9701

  @adw-539 @adw-m45h0x-upgradeclaim-deep-mo
  Scenario: The loser resolves the tracking issue by following the pull request on the contested branch
    Given a target repo whose remote already has the branch "adw-upgrade-a1b2c3d4"
    And an open issue 9701 labeled "adw:upgrade" is linked by its pull request to branch "adw-upgrade-a1b2c3d4"
    And an unrelated open issue 9702 labeled "adw:upgrade" is linked by its pull request to branch "adw-upgrade-99887766"
    When the upgrade claim runs for hash "a1b2c3d4" against the target repo
    Then the claim result reports existingIssueNumber 9701
    And the claim result reports existingBranch "adw-upgrade-a1b2c3d4"

  # ── §3 Concurrency — exactly one winner under a same-hash race ─────────────

  @adw-539 @adw-m45h0x-upgradeclaim-deep-mo
  Scenario: Two concurrent claims for the same hash produce exactly one winner
    Given a target repo whose remote has no "adw-upgrade-a1b2c3d4" branch
    When two orchestrators concurrently run the upgrade claim for hash "a1b2c3d4" against the shared remote
    Then exactly one claim result reports won as true
    And exactly one claim result reports won as false
    And the losing claim result reports existingBranch "adw-upgrade-a1b2c3d4"
    And the git-mock recorded exactly one accepted push to branch "adw-upgrade-a1b2c3d4"

  # ── §4 Type-check ──────────────────────────────────────────────────────────

  @adw-539 @adw-m45h0x-upgradeclaim-deep-mo
  Scenario: TypeScript type-check passes after adding the upgrade-claim primitive
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
