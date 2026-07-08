@adw-740 @adw-vpb048-promotion-sweep-orig
Feature: The promotion-sweep originate path files an in-flight promotion — a fresh, high-scoring per-issue feature file is stamped @promotion-suggested-<date> on the default branch and turned into a #734-shaped adw:feature + regression-promotion + hitl promotion issue, idempotently and non-fatally

  Issue #740 builds the ORIGINATE half of the automated scenario-promotion sweep
  (parent PRD `specs/prd/automated-scenario-promotion-sweep.md`), invokable BY HAND
  (not yet wired into cron). It is the sibling of #739, which made the 14-day
  per-issue TTL sweep promotion-AWARE; this slice is the half that PRODUCES the
  `@promotion-suggested-<date>` marker and the tracking issue that #739's exemption
  then protects.

  WHAT THE SWEEP DOES (parent PRD "Solution" / "Imperative shell", user stories
  1-2, 5-8, 14-15, 25): a dependency-injected, non-fatal `runPromotionSweep` shell
  (mirroring `runPerIssueScenarioSweep`) lists tracked
  `features/per-issue/feature-{N}.feature` files on the default branch, scores each
  with the RETAINED deterministic scorer + auto-ramping threshold (no LLM), runs an
  injected reconciliation query (`gh issue list --label regression-promotion`), and
  asks the pure `promotionSweepDecider` for a single action. For this manual-CLI
  slice only the ORIGINATE / LEAVE / DONE subset of the lifecycle is exercised
  (decline / redrive / withdraw are a later slice). On `originate` it writes
  `@promotion-suggested-<runDate>` to the file on the default branch (a commit
  SCOPED to that one path — never `git add -A`) and files exactly one promotion
  issue whose body is a #734-shaped precise relocation instruction carrying a
  `Promotes: feature-{N}` back-link and the label set `adw:feature`,
  `regression-promotion`, `hitl`.

  The behavioural contract pinned below (the OBSERVABLE half of the acceptance
  criteria — the pure deciders are the implementer's Vitest, see Scope notes):

    1. ORIGINATE STAMPS THE DURABLE MARKER (AC1, US3). A fresh, high-scoring
       per-issue file with no open promotion issue is stamped
       `@promotion-suggested-<runDate>` on the default branch — a single tag token
       (never doubled), so the in-flight status survives across cron cycles and
       process restarts.
    2. THE ORIGINATION COMMIT IS SCOPED (AC1, "scoped commit only, never
       `git add -A`"). The commit that carries the new marker records ONLY the
       candidate's per-issue feature file — an unrelated uncommitted change in the
       worktree is NOT swept into it.
    3. ORIGINATE FILES ONE #734-SHAPED PROMOTION ISSUE (AC2, US5-US8). Exactly one
       issue is filed per qualifying file, labelled `adw:feature` +
       `regression-promotion` + `hitl`, its body carrying a `Promotes: feature-{N}`
       back-link and a #734-shaped relocation instruction (source feature +
       step-def paths, destination `features/regression/`, the vocabulary registry
       path, and an explicit "prove `@regression` green" acceptance).
    4. BELOW THRESHOLD ⇒ LEAVE (threshold gate, US1-US2). A fresh per-issue file
       that scores BELOW the auto-ramped threshold is left untouched — no marker
       written, no issue filed, no commit. "High-scoring" is a real precondition,
       not decoration.
    5. ALREADY IN-FLIGHT ⇒ LEAVE, IDEMPOTENTLY (AC3, US14). A file already tagged
       `@promotion-suggested-*` whose reconciliation finds an OPEN promotion issue
       (matched via its `Promotes: feature-{N}` marker) is left untouched — no
       duplicate issue, no re-commit, and still exactly one marker token.
    6. PROMOTED AWAY ⇒ DONE (AC4, US15). A candidate whose promotion PR has merged
       (its file has left `features/per-issue/`) is treated as done: the sweep does
       NOT resurrect it — no new issue, no commit — even though a merged promotion
       issue linking back to it still exists.
    7. THE SHELL IS NON-FATAL (AC5, US24-adjacent). A transient git/gh error during
       origination (issue filing OR the marker commit) is logged and swallowed — the
       sweep completes without raising, so a promotion-sweep failure can never crash
       the caller.
    8. TYPE-CHECK BACKSTOP (T22). The ADW codebase still type-checks with the new
       `promotionSweepDecider` / `promotionReconcileLink` / `promotionIssueBody` /
       `runPromotionSweep` modules and the `regression-promotion` `labelManager`
       constant wired in.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the sweep PRODUCES — the promotion
    marker present on (or absent from) the seeded per-issue file after the sweep,
    the name-status of the origination commit on the default branch, whether the
    sweep advanced HEAD at all, the recorded arguments of the injected
    issue-filing call (title / body / labels), whether the in-process sweep raised,
    or the type-checker's verdict (T22). These are vocabulary registry surfaces #3
    ("git artefacts: branches, commits, pushes, and worktree state produced by the
    system under test") and #2 ("recorded calls captured by a mock/injected seam").

    A subtlety carried over verbatim from #739, called out so it is not mistaken for
    a rot violation: the seeded `features/per-issue/feature-{N}.feature` is INPUT
    TEST-FIXTURE DATA committed into a throwaway temp git repo — a git artefact the
    sweep CONSUMES and MUTATES (it writes the marker), the exact category the
    Rot-Detection Rubric permits (as feature-739 / feature-735 seed per-issue
    fixtures and feature-648 seeds commits into a real temp repo) — NOT a source
    file of this framework. The sweep reading its input (the scenario's phrases, to
    score it) and the scenario asserting the sweep's OUTPUT (was the marker written,
    was the issue filed) are two different things; only the latter is an assertion.
    NO step below reads `promotionSweepDecider.ts`, `promotionReconcileLink.ts`,
    `promotionIssueBody.ts`, `runPromotionSweep`, `promotionScorer.ts`, or
    `labelManager.ts` as text, substring-matches its contents, or parses it as
    JSON/AST. The issue-body assertions (§3) match against the body the sweep
    PRODUCED and handed to the injected filer — a recorded call argument, not a
    source file.

  Scope notes:

    • THE PURE DECIDERS ARE THE IMPLEMENTER'S UNIT TESTS, NOT BDD. AC6
      (`promotionSweepDecider` and `promotionReconcileLink` are pure and unit-tested
      over their input cross-product) is a property of source functions, not an
      observable system output — it belongs in the implementer's Vitest coverage,
      exactly as feature-739 left `promotionTagState`'s parse/serialize table-tests
      and feature-735 left its no-op-when-nothing-stale unit to the implementer. The
      BDD layer here drives the whole `runPromotionSweep` shell IN-PROCESS and pins
      ONLY its observable output (marker written? issue filed with what? commit
      scoped? did it raise?); it deliberately does NOT call `promotionSweepDecider`,
      `promotionReconcileLink`, or `promotionIssueBody` directly, nor assert the
      decider's per-cell action, because that would test a source-code property.
      The PRD's Testing Decisions name exactly this split: `promotionIssueBody`,
      `shouldSkipScenarioAuthoring`, and the `runPromotionSweep` shell are
      "integration-covered", not unit-tested — this feature is that integration
      cover.
    • ONLY THE ORIGINATE / LEAVE / DONE SUBSET IS EXERCISED. This manual-CLI slice
      does not build or drive decline / redrive / withdraw (closed-unmerged and
      blocked reconciliation facts). Those actions — and the terminal
      `@promotion-declined` write path — are a later slice of the parent PRD and are
      not pinned here.
    • THE CRON INTERVAL GATE (US25) IS OUT OF SCOPE for this slice. #740 is
      invokable by hand and "not yet wired into cron", so the
      `cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0` cadence gate — a
      `trigger_cron` wiring change — has no observable surface in the manual path and
      is left for the cron-wiring slice. What IS pinned here (§7) is the non-fatal
      property that makes such wiring safe.
    • HOW "HIGH-SCORING" / "LOW-SCORING" AND THE MARKER-WRITE ARE REALIZED ARE
      SOURCE-STRUCTURE CHOICES, left unpinned exactly as feature-739 left its
      marker-READ seam and feature-735 left its persist seam unpinned. The harness
      may seed candidate content known to score at/above (or below) the auto-ramped
      threshold against a seeded vocabulary registry, OR inject the scorer/threshold
      decision; whether the marker is written through `serializePromotionTagState` +
      a `GitContext` scoped commit or some other seam is not asserted. The scenarios
      pin the behaviour (high ⇒ originate, low ⇒ leave; the marker is present and
      the commit is scoped), not the mechanism.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the executed
      regression suite is a deliberate human decision (the very PR this sweep
      originates) and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry's promotion phrases (G13-G17 /
    T15-T21) are bound to the OLD `adwPromotionSweep` mover/commenter step defs in
    `features/regression/step_definitions` (slated for deletion in the parent PRD's
    cleanup slice) and are keyed on `adwId {string}` worktrees, not on the new
    `runPromotionSweep` originate path. As #739 and #735 did for the sibling sweeps,
    feature-740 introduces DISTINCT, self-contained phrasing so that
    feature-740.steps.ts owns its step defs with no `AmbiguousStepDefinition` clash
    under the globally-loaded per-issue + regression step defs (the bespoke-per-
    feature convention; zero phrase collisions across the suite). The gap is surfaced
    to the maintainer here:
      • `a fresh, high-scoring per-issue feature file for issue {int} is tracked on the default branch`
      • `a fresh, low-scoring per-issue feature file for issue {int} is tracked on the default branch`
      • `a per-issue feature file for issue {int} already carrying a "@promotion-suggested-" tag is tracked on the default branch`
      • `an open promotion issue exists linking back to issue {int}`
      • `a merged promotion issue exists linking back to issue {int}`
      • `the per-issue feature file for issue {int} has been promoted away and is no longer tracked under features/per-issue`
      • `an unrelated uncommitted change is present in the worktree`
      • `the injected {string} action fails transiently`
      • `the promotion origination sweep runs over the repository`
      • `the per-issue feature file for issue {int} is tagged "@promotion-suggested-" with the sweep's run date on the default branch`
      • `the per-issue feature file for issue {int} carries exactly one "@promotion-suggested-" tag`
      • `the per-issue feature file for issue {int} carries no "@promotion-suggested-" tag`
      • `the origination commit records only issue {int}'s feature file`
      • `the promotion origination sweep files exactly one promotion issue for issue {int}`
      • `the promotion origination sweep files no promotion issue`
      • `the filed promotion issue carries the labels "adw:feature", "regression-promotion" and "hitl"`
      • `the filed promotion issue body carries a "Promotes: feature-{int}" marker`
      • `the filed promotion issue body carries a #734-shaped relocation instruction for issue {int}`
      • `the promotion origination sweep makes no commit on the default branch`
      • `the promotion origination sweep completes without raising an error`

    Step-definition note for the maintainer (feature-740.steps.ts — keep it
    SELF-CONTAINED with its own `@adw-740` After hook and module-private `ctx`; do
    NOT reach into feature-739 / feature-735 sweep step defs or the regression
    givenSteps/thenSteps promotion defs):
      • Build the harness exactly as feature-739.steps.ts does: a REAL temp git repo
        (`git init` / clone) whose `origin` is a REAL bare remote (`git init --bare`),
        default branch checked out, with a FIXED run time (`now`). Seed each
        candidate's `features/per-issue/feature-{N}.feature` AND its
        `features/per-issue/step_definitions/feature-{N}.steps.ts` sibling (the body
        builder references both paths), and — so the retained scorer has phrases to
        match — a `features/regression/vocabulary.md`. Commit and push so the remote
        carries the pre-sweep tree.
      • "high-scoring" / "low-scoring" set the candidate's scenario content so the
        RETAINED `promotionScorer` + `computeThreshold` resolve at/above vs below the
        threshold (bootstrap threshold = 3 on an empty stats window), OR inject the
        score/threshold — implementer's choice (see Scope notes). "already carrying a
        `@promotion-suggested-` tag" seeds the feature-level marker (the same locus
        `serializePromotionTagState` writes). "promoted away" seeds NO
        `features/per-issue/feature-{N}.feature` (the merged PR moved it) while still
        seeding the merged promotion issue in the injected issue list.
      • `an open/merged promotion issue exists linking back to issue {int}` seeds an
        entry in the injected reconciliation list (`gh issue list --label
        regression-promotion`) whose body carries `Promotes: feature-{N}` and whose
        state is open / merged — so `promotionReconcileLink` maps the tagged file to
        it and `promotionSweepDecider` sees `open` / `merged`.
      • `the promotion origination sweep runs over the repository` drives the
        production `runPromotionSweep` IN-PROCESS with the temp repo as its working
        directory and the FIXED `now`, wiring `listFeatures` / `readFeatureContent`
        to the real `GitContext` over the temp repo, injecting the reconciliation
        list, injecting a CAPTURING issue filer that records `(title, body, labels)`
        and returns a fake issue number, and wiring the marker-persist seam to the
        real `GitContext` scoped write+commit(+push) so the origination commit is a
        genuine git artefact. Record HEAD before the sweep for the no-commit /
        name-status assertions. Wrap the call so `completes without raising an error`
        can assert no exception propagated. Do NOT drive it through an orchestrator
        subprocess or the git-remote-mock (same rationale as feature-739 / feature-735).
      • The marker Thens read the committed feature file's content and parse its
        feature-level tag block (present with the fixed run-date; exactly one token;
        or absent). `the origination commit records only issue {int}'s feature file`
        reads `git show --name-status HEAD` (assert the single `feature-{N}.feature`
        path, and NOT the unrelated dirty file). The issue Thens read the captured
        filer arguments (label set; `Promotes: feature-{N}` in the body; the
        #734-shaped body carries the source feature + step-def paths, `features/
        regression/`, `features/regression/vocabulary.md`, and a "prove @regression
        green" acceptance). `makes no commit` compares `git rev-parse HEAD` before
        and after; `files no promotion issue` asserts the capturing filer recorded
        zero calls.

  Background:
    Given the ADW codebase is checked out

  # ── §1 ORIGINATE stamps the durable @promotion-suggested-<runDate> marker (AC1 / US3) ──
  #
  # The headline of the originate path. A fresh, high-scoring per-issue file with no
  # open promotion issue yet must be stamped `@promotion-suggested-<runDate>` on the
  # default branch — a single token (never doubled) so the durable in-flight marker
  # is well-formed and #739's exemption can key on it. RED before the sweep exists
  # (no marker is ever written); GREEN once originate writes it.

  @adw-740 @adw-vpb048-promotion-sweep-orig
  Scenario: A fresh high-scoring candidate is stamped with a single promotion-suggested marker dated the sweep's run date
    Given a fresh, high-scoring per-issue feature file for issue 665 is tracked on the default branch
    When the promotion origination sweep runs over the repository
    Then the per-issue feature file for issue 665 is tagged "@promotion-suggested-" with the sweep's run date on the default branch
    And the per-issue feature file for issue 665 carries exactly one "@promotion-suggested-" tag

  # ── §2 The origination commit is SCOPED — never git add -A (AC1) ───────────────────────
  #
  # The marker is committed with a commit scoped to exactly the candidate's feature
  # file. Mirrors the per-issue sweep's own "never `git add -A`" contract: an
  # unrelated uncommitted change sitting in the cron host's working tree must NOT be
  # swept into the origination commit. Guards against a `git add -A` / `git commit
  # -am` mis-implementation that would capture arbitrary host state onto the default
  # branch.

  @adw-740 @adw-vpb048-promotion-sweep-orig
  Scenario: The origination commit records only the candidate feature file and not unrelated worktree changes
    Given a fresh, high-scoring per-issue feature file for issue 665 is tracked on the default branch
    And an unrelated uncommitted change is present in the worktree
    When the promotion origination sweep runs over the repository
    Then the origination commit records only issue 665's feature file

  # ── §3 ORIGINATE files exactly one #734-shaped promotion issue (AC2 / US5-US8) ─────────
  #
  # The other half of originate: exactly one promotion issue is filed for the
  # qualifying file, labelled `adw:feature` (routing) + `regression-promotion`
  # (reconciliation key + authoring skip-flag) + `hitl` (merge gate), its body
  # carrying a `Promotes: feature-665` back-link (so the next sweep can re-link the
  # tagged file to its tracking issue) and a #734-shaped relocation instruction so
  # the normal build agent performs a correct move without wandering.

  @adw-740 @adw-vpb048-promotion-sweep-orig
  Scenario: Originating a promotion files one hitl-gated adw:feature issue carrying the Promotes marker and a #734-shaped instruction
    Given a fresh, high-scoring per-issue feature file for issue 665 is tracked on the default branch
    When the promotion origination sweep runs over the repository
    Then the promotion origination sweep files exactly one promotion issue for issue 665
    And the filed promotion issue carries the labels "adw:feature", "regression-promotion" and "hitl"
    And the filed promotion issue body carries a "Promotes: feature-665" marker
    And the filed promotion issue body carries a #734-shaped relocation instruction for issue 665

  # ── §4 Below threshold ⇒ LEAVE: no marker, no issue, no commit (threshold gate / US1-US2) ─
  #
  # "High-scoring" is a genuine gate, not decoration. A fresh candidate that scores
  # BELOW the auto-ramped threshold is left entirely untouched — no
  # `@promotion-suggested-` marker written, no promotion issue filed, and no commit
  # on the default branch. Guards against an implementation that originates every
  # per-issue file regardless of score.

  @adw-740 @adw-vpb048-promotion-sweep-orig
  Scenario: A fresh candidate scoring below threshold is left untouched
    Given a fresh, low-scoring per-issue feature file for issue 665 is tracked on the default branch
    When the promotion origination sweep runs over the repository
    Then the per-issue feature file for issue 665 carries no "@promotion-suggested-" tag
    And the promotion origination sweep files no promotion issue
    And the promotion origination sweep makes no commit on the default branch

  # ── §5 Already in-flight ⇒ LEAVE, idempotently (AC3 / US14) ────────────────────────────
  #
  # The reconciliation-driven idempotency guarantee. A file already tagged
  # `@promotion-suggested-*` whose reconciliation query finds an OPEN promotion issue
  # (matched by that issue's `Promotes: feature-665` body marker) is left untouched:
  # no duplicate issue is filed, no re-commit is made, and the file still carries
  # exactly one marker token — so re-running the sweep every eligible cron cycle is a
  # no-op on an in-flight candidate. Guards against re-originating on every pass.

  @adw-740 @adw-vpb048-promotion-sweep-orig
  Scenario: A tagged candidate with an open promotion issue is left untouched — no duplicate issue, no re-commit
    Given a per-issue feature file for issue 665 already carrying a "@promotion-suggested-" tag is tracked on the default branch
    And an open promotion issue exists linking back to issue 665
    When the promotion origination sweep runs over the repository
    Then the promotion origination sweep files no promotion issue
    And the promotion origination sweep makes no commit on the default branch
    And the per-issue feature file for issue 665 carries exactly one "@promotion-suggested-" tag

  # ── §6 Promoted away ⇒ DONE: the sweep does not resurrect a completed promotion (AC4 / US15) ─
  #
  # When a promotion PR has merged, the build agent has moved the candidate's file
  # out of `features/per-issue/` into `features/regression/`, so it no longer appears
  # in the tracked per-issue set. The sweep must treat this as done — it must NOT
  # re-originate: no new promotion issue, no commit — even though a merged promotion
  # issue linking back to the candidate still exists in the reconciliation set.
  # Guards against a mis-implementation that re-acts on merged tracking issues.

  @adw-740 @adw-vpb048-promotion-sweep-orig
  Scenario: A candidate whose promotion PR has merged is treated as done and not re-originated
    Given the per-issue feature file for issue 665 has been promoted away and is no longer tracked under features/per-issue
    And a merged promotion issue exists linking back to issue 665
    When the promotion origination sweep runs over the repository
    Then the promotion origination sweep files no promotion issue
    And the promotion origination sweep makes no commit on the default branch

  # ── §7 The shell is non-fatal — a transient git/gh error is swallowed (AC5) ────────────
  #
  # A promotion-sweep failure must never crash its caller (the cron loop it will
  # later be wired into). A transient error in either I/O action of originate — the
  # issue filing (gh) or the marker commit (git) — must be logged and SWALLOWED, so
  # the in-process sweep completes without raising. Mirrors the per-issue sweep's
  # `persistRemoval` non-fatal contract. RED if origination lets the throw propagate;
  # GREEN once it is wrapped.

  @adw-740 @adw-vpb048-promotion-sweep-orig
  Scenario Outline: A transient failure during origination is logged and swallowed rather than thrown
    Given a fresh, high-scoring per-issue feature file for issue 665 is tracked on the default branch
    And the injected "<failingAction>" action fails transiently
    When the promotion origination sweep runs over the repository
    Then the promotion origination sweep completes without raising an error

    Examples:
      | failingAction | note                                          |
      | issue-filing  | the gh issue-create call throws transiently   |
      | tag-commit    | the git marker commit/push throws transiently |

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The new originate modules (`promotionSweepDecider`, `promotionReconcileLink`,
  # `promotionIssueBody`, `runPromotionSweep`) and the `regression-promotion`
  # `labelManager` constant keep the ADW codebase type-clean. A backstop consistent
  # with feature-739 §T and feature-735 §6.

  @adw-740 @adw-vpb048-promotion-sweep-orig
  Scenario: The ADW TypeScript type-check passes with the promotion originate path wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
