@adw-641 @adw-gvsub5-feat-deterministic-b
Feature: Deterministic branch-identity fallback when adwId recovery fails — reuse the existing {classifier}-issue-{N} branch instead of minting a fresh adwId that aliases it

  Issue #641 closes a second-PR / orphan-worktree hole in branch-name
  resolution. Today `resolveWorkflowBranchName`
  (`adws/phases/branchNameResolution.ts`) resolves in three steps —
  persisted state → recovery comment → LLM generation — and `workflowInit`
  mints the adwId up front as `adwId ?? recoveryState.adwId ??
  generateAdwId(issue.title)`. When the canonical adwId cannot be recovered
  (no ADW comment carries one, so `resolveAdwId` / the comment scan returns
  null), a FRESH random adwId is minted, the persisted-state and
  recovery-comment steps both miss, and resolution falls straight through to
  LLM generation. The LLM emits a fresh slug, a SECOND worktree/branch is
  created for an issue that already has one in flight, and a SECOND PR opens —
  the original in-progress worktree is orphaned.

  The fix inserts a deterministic branch-identity fallback BETWEEN
  recovery-comment reuse and LLM generation. Two pure primitives anchor it:

    • `deterministicBranchName(classifier, issueNumber)` assembles the stable,
      slug-free identity `{prefix}-issue-{N}` (e.g. `feature-issue-641`) from
      the canonical `branchPrefixMap` — never the LLM.
    • `branchMatchesIssue` decides whether an existing branch belongs to an
      issue under a classifier, IGNORING the slug — so a branch carrying any
      descriptive tail (`feature-issue-641-deterministic-branch-identity-fallback`)
      still matches issue 641 under `/feature`.

  When the canonical adwId cannot be recovered, the fallback derives the
  deterministic identity, finds the existing branch/worktree that matches the
  issue under the current classifier, and RECOVERS the adwId/state from that
  worktree — rather than minting a fresh adwId that would alias the existing
  worktree. A re-classification that changes the prefix (e.g. the issue is now
  classified `/bug`, so the deterministic identity becomes `bugfix-issue-641`)
  does NOT match the old `feature-issue-641` worktree: that is an ACCEPTED,
  intentional new branch.

  This is the downstream complement to #524 (`feature-524` — one branch per
  adwId when the adwId IS known) and #530: those guarantee branch stability
  while the adwId is recoverable; #641 covers the case where adwId recovery
  fails outright. The normal recovery path (#524/#530) is unchanged.

  The behavioural contract pinned below:

    1. DETERMINISTIC IDENTITY FORMAT (AC5, format). `deterministicBranchName`
       assembles `{prefix}-issue-{N}` for every classification, taking its
       prefix from `branchPrefixMap` and never appending a slug.
    2. SLUG-AGNOSTIC, ISSUE-EXACT, PREFIX-SENSITIVE MATCHING (AC5, predicate).
       `branchMatchesIssue` matches a branch to an issue under a classifier
       regardless of the slug tail, rejects a different issue number (including
       the `641` vs `6410` numeric-boundary trap), and rejects a different
       prefix — the prefix-sensitivity that makes re-classification a new
       branch (§5).
    3. FALLBACK REUSES THE EXISTING BRANCH (AC1, the second-PR fix). With the
       canonical adwId unrecoverable, resolution reuses the existing
       `{prefix}-issue-{N}-<slug>` branch instead of generating a new one —
       and does so BEFORE the LLM is consulted, even when the stubbed
       branch-name agent would return a different slug.
    4. FALLBACK RECOVERS THE EXISTING adwId (AC2). On the same fixture, the
       resolved identity carries the existing worktree's adwId — no fresh
       adwId is minted to alias the existing worktree.
    5. RE-CLASSIFICATION PRODUCES A NEW BRANCH (AC3, accepted). With the same
       existing `feature-issue-641` worktree present but the issue now
       classified `/bug`, the existing worktree is NOT matched; resolution
       yields a new `bugfix-issue-641-*` branch and leaves the existing
       worktree intact.
    6. NORMAL RECOVERY PATH UNCHANGED (AC4). When the canonical adwId IS
       recovered from comments, the recovery-comment branch is used and the
       deterministic fallback is never consulted — even when a divergent
       deterministic worktree exists on disk. Recovery-comment reuse still
       precedes the fallback.
    7. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after
       the fallback module and the new resolution step land.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES — the value a
    pure function returns (`deterministicBranchName`'s string,
    `branchMatchesIssue`'s boolean), the branch/adwId pair branch-identity
    resolution resolves over a git+state fixture, a git worktree artefact, or
    the type-checker's verdict (T22). None reads
    `adws/phases/branchNameResolution.ts`, `adws/vcs/worktreeQuery.ts`,
    `adws/types/issueRouting.ts`, or any other source file as text,
    substring-matches its contents, or parses it as JSON/AST.

      • §1–§2 assert the RETURN VALUE of the two pure primitives over literal
        inputs — the same assert-the-returned-value pattern feature-614 uses
        for the `verifyAdwRegen` verdict and feature-538 for `.adw-version`.
      • §3–§6 drive branch-identity resolution in-process over a REAL temp git
        repo whose `.worktrees/` carries the existing issue worktree and whose
        `agents/<adwId>/state.json` records its adwId, with the branch-name
        agent injected via the existing test seam (the
        `_resolveWorkflowBranchNameForTest` injection feature-524 already uses).
        They assert the resolved branch/adwId pair and git worktree artefacts —
        registry surfaces #1 (state files) and #3 (git artefacts).
      • §7 asserts the type-checker's verdict (registry T22).

    The temp git repositories, worktrees, and state files the steps construct
    are INPUT/artefact test data — the same category the Rot-Detection Rubric
    permits (worktree fixtures, state files written by an orchestrator) — NOT
    source files of this repo.

  Scope notes:

    • §1–§2 pin the OBSERVABLE contract of the two pure primitives named in the
      issue (`deterministicBranchName`, `branchMatchesIssue`). The literal
      Vitest unit tests AC5 also calls for are the implementer's, exactly as
      feature-455 split its `generateBranchName`/`validateSlug` unit tests from
      its end-to-end BDD scenario — the BDD layer pins behaviour, the unit
      layer pins internals.
    • WHERE the fallback seam lives — a new resolution step inside
      `resolveWorkflowBranchName`, a standalone `recoverBranchIdentity` the
      caller consults before minting an adwId, or a change to `workflowInit`'s
      adwId-resolution order — is a SOURCE-STRUCTURE choice, deliberately NOT
      asserted (rot-prevention), exactly as feature-628 left its reconcile
      wiring unpinned. Its observable proxies are §3–§6: the resolved
      branch/adwId pair holds under any of those wirings.
    • The end-to-end orchestrator consequence — no second PR opens for an issue
      that already has one — is the downstream effect of branch reuse. It is
      driven through the full orchestrator subprocess (W1), whose live driver
      is still PENDING the ISSUE-3-CUTOVER. §3 pins the CAUSE that the
      orchestrator effect depends on (the existing branch is reused, no new
      branch is generated) at the resolver level, so these scenarios run NOW
      rather than waiting on the subprocess driver — the same level feature-614
      and feature-628 §1–§2/§5 chose for the genuinely-new decision.
    • A real adwId/branch recovery against a LIVE GitHub repo with concurrent
      orchestrators is the implementer's non-deterministic integration check
      and is intentionally out of BDD scope — the deterministic harness here is
      a local temp git repo plus the injected branch-name agent.
    • The `@regression` maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never
      auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here — the registry is scoped to
    orchestrator/phase/mock-query behaviours and has NO phrase for the
    deterministic branch-identity primitives or the adwId-recovery fallback.
    Reusing feature-524's branch-name-agent phrases would cross-wire its
    orchestrator-bound `ctx` state under the globally-loaded step defs, so the
    fallback introduces its own. The gap is surfaced to the maintainer in the
    agent Output:
      • `the deterministic branch identity for issue {int} classified {string} is computed`
      • `the deterministic branch identity is {string}`
      • `the branch {string} is tested for an identity match against issue {int} classified {string}`
      • `the branch identity match verdict is {string}`
      • `a target repository with an existing worktree on branch {string} for issue {int}`
      • `the existing worktree on branch {string} records adwId {string}`
      • `the canonical adwId cannot be recovered from the issue comments`
      • `the canonical adwId is recovered from the issue comments as adwId {string} on branch {string}`
      • `the branch-name agent is stubbed to return the slug {string}`
      • `the workflow branch identity is resolved for issue {int} classified {string}`
      • `the resolved branch is {string}`
      • `the resolved branch is not {string}`
      • `the resolved branch carries the {string} prefix`
      • `the resolved adwId is {string}`
      • `the existing worktree on branch {string} is left intact`

    Step-definition note for the maintainer: §3–§6 build a temp target repo
    (`git init` + a `.worktrees/<branch>/` worktree on the existing branch) and
    write `agents/<adwId>/state.json` recording that branch, then drive
    branch-identity resolution in-process with the branch-name agent injected
    via the `_resolveWorkflowBranchNameForTest` seam — recovery success/failure
    is set by populating or nulling `recoveryState.adwId` / `branchName`. The
    classification `{string}` is the slash-command form (`/feature`, `/bug`,
    `/chore`, `/pr_review`, `/adw_init`) mapped through `branchPrefixMap`.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Deterministic identity format — {prefix}-issue-{N}, no slug (AC5) ──────
  #
  # The stable identity the whole fallback keys on. `deterministicBranchName`
  # takes its prefix from the canonical `branchPrefixMap` and assembles
  # `{prefix}-issue-{N}` for every classification — never an LLM slug. (Contract §1.)

  @adw-641 @adw-gvsub5-feat-deterministic-b
  Scenario Outline: The deterministic branch identity is {prefix}-issue-{N} for every classification
    When the deterministic branch identity for issue <issue> classified "<classification>" is computed
    Then the deterministic branch identity is "<identity>"

    Examples:
      | classification | issue | identity            |
      | /feature       | 641   | feature-issue-641   |
      | /bug           | 641   | bugfix-issue-641    |
      | /chore         | 641   | chore-issue-641     |
      | /pr_review     | 641   | review-issue-641    |
      | /adw_init      | 641   | adwinit-issue-641   |

  # ── §2 branchMatchesIssue — slug-agnostic, issue-exact, prefix-sensitive (AC5) ─
  #
  # The predicate that decides whether an existing branch belongs to an issue.
  # It IGNORES the slug tail (so any descriptive suffix matches), but is exact on
  # the issue number — `641` must not match `6410` — and sensitive to the prefix,
  # which is what makes a re-classified prefix an intentional new branch (§5).
  # (Contract §2.)

  @adw-641 @adw-gvsub5-feat-deterministic-b
  Scenario Outline: branchMatchesIssue ignores the slug, pins the issue number, and respects the prefix
    When the branch "<branch>" is tested for an identity match against issue <issue> classified "<classification>"
    Then the branch identity match verdict is "<verdict>"

    Examples:
      | branch                                                  | issue | classification | verdict | note                          |
      | feature-issue-641-deterministic-branch-identity-fallback | 641   | /feature       | true    | slug ignored                  |
      | feature-issue-641                                       | 641   | /feature       | true    | no slug at all                |
      | feature-issue-641-some-other-slug                       | 641   | /feature       | true    | any slug tail still matches   |
      | feature-issue-642-deterministic-branch-identity-fallback | 641   | /feature       | false   | different issue number        |
      | feature-issue-6410-deterministic-branch                 | 641   | /feature       | false   | 641 must not match 6410       |
      | bugfix-issue-641-deterministic-branch-identity-fallback  | 641   | /feature       | false   | different prefix (re-classed) |

  # ── §3 Fallback reuses the existing branch when adwId recovery fails (AC1) ─────
  #
  # THE second-PR fix. The canonical adwId cannot be recovered, so the up-front
  # mint would normally fall straight through to LLM generation and open a second
  # branch/PR. The deterministic fallback finds the existing
  # `feature-issue-641-deterministic-branch-identity-fallback` worktree and reuses
  # it — and does so BEFORE the LLM is consulted: even though the branch-name agent
  # is stubbed to return a DIFFERENT slug, the resolved branch is the existing one,
  # and no second worktree is created. This pins the fallback's insertion point
  # (between recovery-comment reuse and LLM generation) behaviourally. (Contract §3.)

  @adw-641 @adw-gvsub5-feat-deterministic-b
  Scenario: With adwId recovery failed, resolution reuses the existing issue branch instead of generating a second one
    Given a target repository with an existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" for issue 641
    And the existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" records adwId "k3xq91-prior-run"
    And the canonical adwId cannot be recovered from the issue comments
    And the branch-name agent is stubbed to return the slug "a-freshly-generated-slug"
    When the workflow branch identity is resolved for issue 641 classified "/feature"
    Then the resolved branch is "feature-issue-641-deterministic-branch-identity-fallback"
    And the resolved branch is not "feature-issue-641-a-freshly-generated-slug"
    And the existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" is left intact

  # ── §4 Fallback recovers the existing worktree's adwId, not a fresh one (AC2) ──
  #
  # Same fixture as §3. The resolved identity carries the existing worktree's
  # recorded adwId `k3xq91-prior-run` — proving the fallback recovers the adwId
  # from the matched worktree rather than minting a fresh random adwId that would
  # alias the existing worktree and strand its state. (Contract §4.)

  @adw-641 @adw-gvsub5-feat-deterministic-b
  Scenario: With adwId recovery failed, resolution recovers the existing worktree's adwId rather than minting a fresh one
    Given a target repository with an existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" for issue 641
    And the existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" records adwId "k3xq91-prior-run"
    And the canonical adwId cannot be recovered from the issue comments
    When the workflow branch identity is resolved for issue 641 classified "/feature"
    Then the resolved adwId is "k3xq91-prior-run"
    And the resolved branch is "feature-issue-641-deterministic-branch-identity-fallback"

  # ── §5 Re-classification with a different prefix is an accepted new branch (AC3)
  #
  # The same existing `feature-issue-641` worktree is present, but the issue is now
  # classified `/bug`, so the deterministic identity becomes `bugfix-issue-641`.
  # The existing `feature-` worktree does NOT match under the new classifier, the
  # fallback finds nothing to recover, and resolution proceeds to a NEW
  # `bugfix-issue-641-*` branch — the intended, accepted outcome. The existing
  # feature worktree is left intact (never adopted or clobbered). (Contract §5.)

  @adw-641 @adw-gvsub5-feat-deterministic-b
  Scenario: Re-classifying the issue to a different prefix yields a new branch and leaves the existing worktree intact
    Given a target repository with an existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" for issue 641
    And the existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" records adwId "k3xq91-prior-run"
    And the canonical adwId cannot be recovered from the issue comments
    And the branch-name agent is stubbed to return the slug "deterministic-branch-identity-fallback"
    When the workflow branch identity is resolved for issue 641 classified "/bug"
    Then the resolved branch carries the "bugfix" prefix
    And the resolved branch is not "feature-issue-641-deterministic-branch-identity-fallback"
    And the existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" is left intact

  # ── §6 Normal recovery path unchanged — recovery-comment precedes fallback (AC4)
  #
  # When the canonical adwId IS recovered from the issue comments, the
  # recovery-comment branch is used and the deterministic fallback is never
  # consulted — even though a DIVERGENT deterministic worktree
  # (`feature-issue-641-deterministic-branch-identity-fallback`) sits on disk. The
  # recovery-comment branch (`feature-issue-641-recovered-from-comment`) wins,
  # proving the fallback was inserted AFTER recovery-comment reuse and did not
  # perturb the existing recovery path (#524/#530). (Contract §6.)

  @adw-641 @adw-gvsub5-feat-deterministic-b
  Scenario: When the canonical adwId is recovered from comments, the recovery-comment branch wins and the fallback is not consulted
    Given a target repository with an existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" for issue 641
    And the existing worktree on branch "feature-issue-641-deterministic-branch-identity-fallback" records adwId "k3xq91-prior-run"
    And the canonical adwId is recovered from the issue comments as adwId "z8m4p2-recovered" on branch "feature-issue-641-recovered-from-comment"
    When the workflow branch identity is resolved for issue 641 classified "/feature"
    Then the resolved branch is "feature-issue-641-recovered-from-comment"
    And the resolved branch is not "feature-issue-641-deterministic-branch-identity-fallback"

  # ── §7 Type-check backstop (T22) ──────────────────────────────────────────────

  @adw-641 @adw-gvsub5-feat-deterministic-b
  Scenario: TypeScript type-check passes after the branch-identity fallback lands
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
