@adw-712 @adw-vednf3-upgradegate-compare
Feature: upgradeGate reads the authoritative .adw-version from the remote default branch before worktree setup — a stale reused worktree no longer spoofs a false mismatch (#197/#203 root cause)

  Issue #712 fixes the ROOT CAUSE behind the vestmatic #197/#203 deadlock. The
  upgrade gate used to read the target repo's stored `.adw-version` from the
  LOCAL feature worktree (`readAdwVersion(worktreePath)`), and it ran AFTER
  worktree setup. When a workflow reused a STALE worktree — one created before a
  prior upgrade merged — the gate read the old local value, saw a false hash
  mismatch against the current framework, and spawned/parked a spurious upgrade,
  even though the target's default branch was already up to date.

  The incident, exactly: an upgrade to hash `1e36648f` merged (`dev`'s
  `.adw-version = 1e36648f`); a blocked issue then became eligible and REUSED its
  stale worktree (`.adw-version = c1acb23`, several commits behind `dev`). The
  gate compared `current = 1e36648f` against the stale LOCAL `c1acb23`, declared
  a false mismatch, won a fresh claim, and created an orphan tracking issue that
  could never produce a PR (its regen ran off the already-current `dev`, so no
  diff) — deadlocking the original issue behind a no-op upgrade. The
  authoritative source, `origin/dev:.adw-version`, was `1e36648f` the whole time:
  reading IT would have produced a correct match and none of this would have
  happened.

  Two coupled changes pin the fix:

    1. SOURCE moves local → remote. `storedVersion` is now read from the target's
       REMOTE default branch (`git show origin/<defaultBranch>:.adw-version`) —
       the authoritative value a stale local worktree cannot spoof. The read is
       null-tolerant: an absent `.adw-version` on the remote reads as "no
       recorded version", which (as before) unifies first-bootstrap and
       out-of-date into the single upgrade path.
    2. ORDER moves after → before worktree setup. The comparison runs BEFORE any
       feature worktree is built. A genuine mismatch parks/spawns the upgrade
       before a throwaway worktree ever exists; a match proceeds into normal
       worktree setup + the workflow.

  The behavioural contract pinned below:

    1. STALE-LOCAL / CURRENT-REMOTE → PROCEED (AC1, core — the #197 reproduction).
       A workflow whose reused local worktree carries a stale `.adw-version` but
       whose remote default branch is already current proceeds normally: it
       classifies and runs, creates NO upgrade tracking issue, and spawns NO
       upgrade orchestrator. Under the old local read this case PARKED a spurious
       upgrade; under the remote read it correctly proceeds.
    2. GENUINE REMOTE MISMATCH, claim WON → park BEFORE worktree (AC2 + invariant).
       When the remote default branch's `.adw-version` genuinely differs from the
       framework hash and the claim is won, the gate creates the `#UPG` tracking
       issue, spawns `adwUpgrade.tsx`, registers the current issue's dependency,
       and returns it to Todo — all BEFORE a feature worktree is built, so the
       parked issue leaves no throwaway worktree behind. The claim branch is still
       pushed to the TARGET repository's remote namespace (the claim-needs-worktree
       invariant from `94059b5`, intact).
    3. GENUINE REMOTE MISMATCH, claim LOST → attach + park BEFORE worktree (AC2).
       A genuine remote mismatch that loses the claim attaches to the in-flight
       `#UPG`, registers the dependency, and returns to Todo — creating no second
       tracking issue, spawning no second upgrade, and leaving NO throwaway feature
       worktree.
    4. REMOTE READ CONTRACT (AC4, deep module). The authoritative read returns the
       hash committed at `origin/<default>:.adw-version`, and returns "no recorded
       version" when the remote default branch carries no `.adw-version` (handled
       down the same upgrade path as out-of-date).
    5. IMMUNE TO STALE LOCAL (AC4, deep module). When a stale local `.adw-version`
       diverges from the remote, the read returns the REMOTE value — never the
       stale local one. This is the unit-level core of contract §1.
    6. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       gate is re-sourced and reordered.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime —
    never the text of a source file:

      • the orchestrator subprocess exit code (`World.lastExitCode`);
      • calls recorded by the mock GitHub API — the `#UPG` tracking-issue creation
        and its `adw:upgrade` label, the dependency registration on the current
        issue, the project-board return to Todo, and the `starting` workflow
        comment (or its absence) — the recorded-request channel behind registered
        vocabulary T2/T12/T14 and the marker-comment-count phrase #544 introduced;
      • the harness-recorded `spawnDetached` invocation that launches (or does not
        launch) `adwUpgrade.tsx`, the recorded-spawn channel #542/#544 use;
      • the claude-cli-stub's recorded invocation log, which proves whether the LLM
        classifier ran — the behavioural manifestation of "the gate proceeded";
      • GIT ARTEFACTS produced by the run — whether a per-issue FEATURE worktree
        exists for the parked issue (registry surface #3, "worktree state produced
        by the system under test"), and which remote namespace received the claim
        branch push.

    The target repo's `.adw-version` — both the stale LOCAL copy and the
    authoritative copy committed at `origin/<default>` — is set up as fixture INPUT
    for the match/mismatch preconditions and is never asserted as a source file. It
    is the target repo's own data file committed to a real temp git remote — exactly
    the orchestrator-relevant artefact the vocabulary Rot-Detection Rubric permits
    (T1/#538/#628 read `.adw-version`/state/git artefacts written at runtime). No
    step reads `adws/phases/upgradeGate.ts`, `adws/core/adwVersion.ts`, or
    `adws/phases/workflowInit.ts` as text, substring-matches its contents, or parses
    it as JSON/AST. The behaviour is proven by what the orchestrator reads from the
    remote, creates, spawns, registers, moves, comments, the worktrees it does (not)
    build, and the code it exits with.

  Scope notes:

    • `"plan"` is the representative SDLC orchestrator exercising the shared
      `initializeWorkflow()` gate; it behaves identically for every orchestrator
      that calls it. Scenarios never pin a literal FRAMEWORK hash — they speak of a
      version "matching" or "differing from" the current framework — so they survive
      any framework content change. The synthetic tokens in §4–§6 (e.g.
      `"committed-remote-token"`) are arbitrary fixture values committed to and read
      back from a temp git remote to exercise the read mechanism; they are NOT the
      live framework hash.
    • RELATIONSHIP TO #544. Feature-544 pinned the gate's proceed/park DECISION
      (match → classify + proceed; mismatch → create-or-attach `#UPG`, depend, return
      to Todo, consume no slot). Those behavioural scenarios stay GREEN under #712 —
      the proceed/park OUTCOMES are unchanged. #712 revises only #544's read-SOURCE
      (local worktree → remote default branch) and its ORDERING (#544's AC1 prose
      assumed the read necessarily FOLLOWS worktree setup, because the worktree had
      to exist for the local read; #712 inverts that — the remote read needs no
      feature worktree, so the gate now runs BEFORE worktree setup). #712 is authored
      as #544's focused counterpart and deliberately does NOT re-tag or rewrite
      #544's scenarios — mirroring how #628 was authored as #627's counterpart rather
      than an in-place edit. The historically-superseded #544 AC1 ordering prose is
      surfaced to the maintainer in the agent Output as informational only.
    • SIBLING TO #628. #628 reconciled a stale reused worktree to the remote claim
      tip for the `adwUpgrade` orchestrator's OWN worktree; #712 is the
      `upgradeGate`/`workflowInit` counterpart for the normal feature-workflow gate
      path that bit #197. Both read authoritative state from the remote rather than
      trusting a stale local worktree. Whether the two converge on a shared
      "read-authoritative-version-from-remote" helper is a SOURCE-STRUCTURE choice,
      deliberately NOT asserted.
    • AC3 ("claim push still targets the target namespace; existing
      `upgradeClaim`/`upgradeGate` tests stay green") is primarily a regression
      criterion guarded by the existing #539/#544 coverage and the upgradeGate unit
      tests. §2 adds a targeted guard for the specific reorder — that even after the
      version read moves earlier and changes source, the WON claim branch still lands
      on the TARGET repository's remote namespace (not the framework checkout's).
    • The "before worktree setup" ordering (AC2) is proven behaviourally, not by
      source ordering: on every mismatch the parked issue leaves NO per-issue feature
      worktree, which is only possible if the park happens before worktree setup. The
      match baseline (§1) shows the normal flow proceeding (classifier runs) when the
      remote is current.
    • Driving a real concurrent claim against a LIVE GitHub remote is the
      implementer's non-deterministic integration test and is out of BDD scope. The
      deterministic harness here is a local bare `origin` carrying the default branch
      (§4–§6) plus the claude-cli-stub + mock GitHub API (§1–§3).
    • The vestmatic #203 cleanup (closing the orphan no-op upgrade issue, removing the
      stale #197 worktree) is a one-time human operational chore with nothing to
      observe or automate, and is out of scope.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      G4  (`an issue {int} exists in the mock issue tracker`),
      G11 (`the worktree for adwId {string} is initialised at branch {string}`),
      G1  (`the mock GitHub API is configured to accept issue comments`),
      G12 (`the mock GitHub API is configured to accept label applications`),
      W1  (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
      T5  (`the orchestrator subprocess exited {int}`),
      T2  (`the mock GitHub API recorded a comment on issue {int}`),
      T22 (`the ADW TypeScript type-check passes`).

    Reused from sibling per-issue file #544 (globally loaded, not yet registered):
      `the claude classifier was invoked for issue {int}`,
      `the claude classifier was not invoked for issue {int}`,
      `the target remote has no upgrade claim branch for the current framework version`,
      `an upgrade claim branch for the current framework version already exists on the target remote, tracked by issue {int}`,
      `the mock GitHub API recorded the creation of an upgrade tracking issue carrying the {string} label`,
      `the mock GitHub API recorded no creation of an upgrade tracking issue`,
      `ADW spawned the upgrade orchestrator for the tracking issue`,
      `ADW spawned no upgrade orchestrator for issue {int}`,
      `ADW registered a dependency of issue {int} on the upgrade tracking issue`,
      `ADW returned issue {int} to the Todo lane`,
      `the mock harness recorded zero ADW-workflow-marker comment posts on issue {int}`.

    Novel phrasing introduced here — the registry and #544 distinguish only "the
    worktree records a framework version", with no phrase that separates the STALE
    LOCAL copy from the AUTHORITATIVE REMOTE default-branch copy, no
    feature-worktree-absence phrase, no claim-namespace phrase, and no
    remote-default-branch read phrase. The gap is surfaced to the maintainer in the
    agent Output:
      • `the reused worktree for adwId {string} records a stale framework version behind the default branch`
      • `the target repository's remote default branch records a framework version matching the current framework`
      • `the target repository's remote default branch records a framework version that differs from the current framework`
      • `no feature worktree is created for issue {int}`
      • `the won upgrade claim branch is pushed to the target repository's remote namespace`
      • `a target repository whose remote default branch {string} records a framework version of {string}`
      • `a target repository whose remote default branch {string} records no framework version`
      • `the reused local checkout records a stale framework version of {string}`
      • `the stored framework version is read from the remote default branch {string}`
      • `the framework version read from the remote is {string}`
      • `the framework version read from the remote is no recorded version`

    Step-definition note for the maintainer: §1–§3 extend the #544 gate-subprocess
    harness (G4 + G11 + W1) so the target workspace has a real bare `origin` whose
    `<default>` branch commits `.adw-version`, INDEPENDENT of the local checkout's
    `.adw-version` — the literal #197 split (stale local vs current remote). The
    "no feature worktree" assertion inspects the target clone after the run for any
    per-issue `feature-issue-<n>-…` worktree the park path must NOT have created.
    §4–§6 drive `readRemoteAdwVersion` over a temp target repo whose bare `origin`
    carries (or omits) a committed `.adw-version` on its default branch — the same
    bare-origin git-fixture shape feature-628 uses.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Stale-local / current-remote → PROCEED (AC1, core — the #197 reproduction) ─
  #
  # THE fix, end to end. The reused local worktree carries a stale `.adw-version`
  # (it would have spoofed a false mismatch under the old local read), but the
  # target's remote default branch is already current. Reading the authoritative
  # remote value, the gate sees a MATCH: the workflow classifies and runs, creates
  # no upgrade tracking issue, and spawns no upgrade — exactly what #197 needed and
  # never got. (Contract §1.)

  @adw-712 @adw-vednf3-upgradegate-compare
  Scenario: A workflow reusing a stale worktree proceeds without an upgrade because the remote default branch is already current
    Given an issue 7121 exists in the mock issue tracker
    And the worktree for adwId "init-7121" is initialised at branch "init-7121"
    And the reused worktree for adwId "init-7121" records a stale framework version behind the default branch
    And the target repository's remote default branch records a framework version matching the current framework
    And the mock GitHub API is configured to accept issue comments
    When the "plan" orchestrator is invoked with adwId "init-7121" and issue 7121
    Then the orchestrator subprocess exited 0
    And the claude classifier was invoked for issue 7121
    And the mock GitHub API recorded a comment on issue 7121
    And the mock GitHub API recorded no creation of an upgrade tracking issue
    And ADW spawned no upgrade orchestrator for issue 7121

  # ── §2 Genuine remote mismatch, claim WON — park BEFORE worktree, claim on target ─
  #
  # The remote default branch's `.adw-version` genuinely differs from the framework
  # hash. The gate wins the claim, creates `#UPG`, spawns the upgrade, registers the
  # dependency, and returns the issue to Todo — all BEFORE a feature worktree is
  # built, so the parked issue leaves NO throwaway worktree. The won claim branch is
  # still pushed to the TARGET repository's remote namespace (the claim-needs-worktree
  # invariant, intact). (Contract §2; AC2 + AC3.)

  @adw-712 @adw-vednf3-upgradegate-compare
  Scenario: A genuine remote mismatch that wins the claim parks the issue before any feature worktree and pushes the claim to the target namespace
    Given an issue 7122 exists in the mock issue tracker
    And the worktree for adwId "init-7122" is initialised at branch "init-7122"
    And the target repository's remote default branch records a framework version that differs from the current framework
    And the target remote has no upgrade claim branch for the current framework version
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the "plan" orchestrator is invoked with adwId "init-7122" and issue 7122
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded the creation of an upgrade tracking issue carrying the "adw:upgrade" label
    And ADW spawned the upgrade orchestrator for the tracking issue
    And ADW registered a dependency of issue 7122 on the upgrade tracking issue
    And ADW returned issue 7122 to the Todo lane
    And no feature worktree is created for issue 7122
    And the won upgrade claim branch is pushed to the target repository's remote namespace
    And the mock harness recorded zero ADW-workflow-marker comment posts on issue 7122

  # ── §3 Genuine remote mismatch, claim LOST — attach + park, no throwaway worktree ─
  #
  # A genuine remote mismatch that loses the claim attaches to the in-flight `#UPG`:
  # it registers the dependency and returns to Todo, creating no second tracking
  # issue and spawning no second upgrade — and, because the park happens before
  # worktree setup, leaving NO throwaway feature worktree. (Contract §3; AC2.)

  @adw-712 @adw-vednf3-upgradegate-compare
  Scenario: A genuine remote mismatch that loses the claim attaches to the in-flight upgrade and returns to Todo without a throwaway worktree
    Given an issue 7123 exists in the mock issue tracker
    And the worktree for adwId "init-7123" is initialised at branch "init-7123"
    And the target repository's remote default branch records a framework version that differs from the current framework
    And an upgrade claim branch for the current framework version already exists on the target remote, tracked by issue 9712
    And the mock GitHub API is configured to accept issue comments
    When the "plan" orchestrator is invoked with adwId "init-7123" and issue 7123
    Then the orchestrator subprocess exited 0
    And ADW registered a dependency of issue 7123 on the upgrade tracking issue
    And ADW returned issue 7123 to the Todo lane
    And the mock GitHub API recorded no creation of an upgrade tracking issue
    And ADW spawned no upgrade orchestrator for issue 7123
    And no feature worktree is created for issue 7123
    And the mock harness recorded zero ADW-workflow-marker comment posts on issue 7123

  # ── §4 Remote read contract — reads the committed origin/<default>:.adw-version ───
  #
  # The authoritative read returns exactly the hash committed at
  # `origin/<default>:.adw-version` on the target's bare origin. A round-trip of a
  # synthetic fixture token (NOT the live framework hash). (Contract §4; AC4.)

  @adw-712 @adw-vednf3-upgradegate-compare
  Scenario: The stored framework version is read from the target's remote default branch
    Given a target repository whose remote default branch "main" records a framework version of "committed-remote-token"
    When the stored framework version is read from the remote default branch "main"
    Then the framework version read from the remote is "committed-remote-token"

  # ── §5 Remote read contract — absent .adw-version reads as no recorded version ────
  #
  # When the remote default branch carries no `.adw-version` at all (`git show`
  # exits non-zero), the read returns "no recorded version" — unifying first-ever
  # bootstrap with out-of-date down the single upgrade path, exactly as the local
  # reader did for an absent file. (Contract §4; AC4.)

  @adw-712 @adw-vednf3-upgradegate-compare
  Scenario: A remote default branch with no committed .adw-version reads as no recorded version
    Given a target repository whose remote default branch "main" records no framework version
    When the stored framework version is read from the remote default branch "main"
    Then the framework version read from the remote is no recorded version

  # ── §6 Immune to stale local — a divergent local copy never overrides the remote ──
  #
  # The unit-level core of §1: even when a stale local `.adw-version` diverges from
  # the remote, the authoritative read returns the REMOTE value, never the stale
  # local one. Under the old local read this returned the stale token and spoofed
  # the #197 mismatch; under the remote read it returns the remote token.
  # (Contract §5; AC4.)

  @adw-712 @adw-vednf3-upgradegate-compare
  Scenario: A stale local .adw-version does not override the framework version read from the remote default branch
    Given a target repository whose remote default branch "main" records a framework version of "remote-authoritative-token"
    And the reused local checkout records a stale framework version of "stale-local-token"
    When the stored framework version is read from the remote default branch "main"
    Then the framework version read from the remote is "remote-authoritative-token"

  # ── §7 Type-check ─────────────────────────────────────────────────────────────────

  @adw-712 @adw-vednf3-upgradegate-compare
  Scenario: TypeScript type-check passes after re-sourcing and reordering the upgrade gate
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
