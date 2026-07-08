@adw-741 @adw-nmgykl-promotion-sweep-reco
Feature: The promotion-sweep reconciliation path resolves an in-flight candidate — a @promotion-suggested-* file is reconciled against its tracking issue/PR and DECLINED (closed-unmerged or adw:blocked), REDRIVEN (stranded but still high-scoring), or WITHDRAWN (stranded and now below threshold), closing the infinite-re-suggestion loop and the blocked-promotion stranding hole

  Issue #741 builds the RECONCILE half of the automated scenario-promotion sweep
  (parent PRD `specs/prd/automated-scenario-promotion-sweep.md`). It is the sibling
  of #740, which built the ORIGINATE half (fresh high-scorer ⇒ stamp
  `@promotion-suggested-<date>` + file a #734-shaped tracking issue). #740
  deliberately deferred the full in-flight lifecycle: its `promotionSweepDecider`
  emits only `originate | leave | done`, and every not-yet-handled reconciliation
  fact resolves to the conservative `leave`. THIS slice extends the SAME pure
  `decidePromotionAction` decider and the SAME `runPromotionSweep` shell to handle
  what happens to a file that is ALREADY tagged `@promotion-suggested-*` once its
  tracking issue/PR reaches a terminal or stranded state (parent PRD user stories
  16-20, Implementation Decision "promotionSweepDecider").

  WHAT THE RECONCILE PATH DOES. Each cron sweep reconciles the in-flight set (files
  tagged `@promotion-suggested-*`) against the injected `regression-promotion`
  issue list. For each such file the extended decider maps its reconciliation fact
  to exactly one NEW terminal/recovery action:

    • closed-unmerged  (the tracking PR/issue was closed WITHOUT merging — a human
                        rejection)                                   ⇒ DECLINE
    • blocked          (the tracking issue carries `adw:blocked` — the promotion
                        workflow exhausted its retries and escalated)⇒ DECLINE
    • no-issue while    (tagged in-flight but NO tracking issue exists — a crash
      already tagged     between tagging and PR-open stranded it) and STILL scores
      `suggested`        ≥ threshold                                  ⇒ REDRIVE
    • no-issue while    (…same stranded state) but now scores BELOW threshold
      already tagged     (its score drifted down since it was suggested)⇒ WITHDRAW
      `suggested`

    DECLINE writes the terminal `@promotion-declined` marker to the SOURCE file
    (which strips the `@promotion-suggested-*` tag in the same serialize) so the
    14-day per-issue TTL resumes and the candidate is NEVER re-suggested; for the
    `blocked` case the blocked tracking issue is LEFT INTACT as the normal
    human-escalation artifact (the sweep neither closes it nor strips its label).
    REDRIVE re-files exactly one #734-shaped tracking issue (identical label set
    and `Promotes: feature-{N}` back-link to originate) while the file stays
    in-flight (still exactly one `@promotion-suggested-*` token, not declined).
    WITHDRAW strips the `@promotion-suggested-*` tag back to the untagged `none`
    state (NOT `declined`) so the TTL resumes and the file may be re-considered
    later if its score recovers.

  The behavioural contract pinned below (the OBSERVABLE half of the acceptance
  criteria — the pure decider's per-cell action table is the implementer's Vitest,
  see Scope notes):

    1. CLOSED-UNMERGED ⇒ DECLINE, TERMINALLY (AC1, US16). A tagged candidate whose
       tracking PR/issue was closed unmerged has `@promotion-declined` written to
       its source file, its `@promotion-suggested-*` tag removed, and no promotion
       issue re-filed.
    2. DECLINE IS DURABLE — NEVER RE-SUGGESTED (AC1, US17). A file already carrying
       the terminal `@promotion-declined` marker is left untouched even when it
       still scores high and has no open tracking issue — no re-origination, no new
       issue, no commit — so rejecting a promotion is a once-and-done decision.
    3. adw:blocked ⇒ DECLINE AT SOURCE, BLOCKED ISSUE LEFT INTACT (AC2, US20). A
       tagged candidate whose tracking issue reached `adw:blocked` has
       `@promotion-declined` written to its source file (TTL resumes) while the
       blocked tracking issue is left exactly as-is — the sweep files no issue and
       makes no close/comment/label mutation against it.
    4. STRANDED & STILL HIGH ⇒ REDRIVE (AC3, US18). A candidate tagged in-flight
       whose tracking issue is missing (stranded by a crash) but which still scores
       ≥ threshold is re-driven: exactly one #734-shaped promotion issue is
       re-filed (same labels + `Promotes: feature-{N}` back-link) and the file
       stays in-flight (still exactly one `@promotion-suggested-*` token, not
       declined).
    5. STRANDED & SCORE-DROPPED ⇒ WITHDRAW (AC4, US19). A stranded candidate that
       now scores BELOW threshold is withdrawn instead of re-filed: its
       `@promotion-suggested-*` tag is stripped (and NO `@promotion-declined` is
       written — withdraw resumes the TTL rather than terminating), and no
       promotion issue is filed.
    6. THE RECONCILE PATH IS NON-FATAL (US24-adjacent). A transient git/gh error in
       either NEW I/O action — the decline marker commit or the redrive issue
       filing — is logged and swallowed, so the in-process sweep completes without
       raising. The new lifecycle branches must preserve the non-fatal contract
       #740 §7 pinned for originate (the same `tagAndCommit` / `fileIssue` seams,
       now reached from new call sites).
    7. TYPE-CHECK BACKSTOP (T22). The ADW codebase still type-checks with the
       extended `promotionSweepDecider` (now emitting `decline | redrive |
       withdraw`) and the reconcile-path wiring in `runPromotionSweep`.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the sweep PRODUCES — the promotion
    marker present on (or absent from) the seeded per-issue file AFTER the sweep
    (declined written? suggested stripped? still exactly one suggested token?),
    whether the sweep advanced HEAD at all (the no-commit assertions), the recorded
    arguments of the injected issue-filing call (title / body / labels for a
    redrive), whether any tracking-issue mutation was recorded against a blocked
    issue, or whether the in-process sweep raised. These are vocabulary registry
    surfaces #3 ("git artefacts: branches, commits, pushes, and worktree state
    produced by the system under test") and #2 ("recorded calls captured by a
    mock/injected seam"), plus the type-checker's verdict (T22).

    A subtlety carried over verbatim from #740 / #739, called out so it is not
    mistaken for a rot violation: the seeded `features/per-issue/feature-{N}.feature`
    is INPUT TEST-FIXTURE DATA committed into a throwaway temp git repo — a git
    artefact the sweep CONSUMES and MUTATES (it writes/strips the marker), the exact
    category the Rot-Detection Rubric permits. The sweep reading its input (the
    scenario's phrases, to re-score it) and the scenario asserting the sweep's
    OUTPUT (was the marker flipped to declined, was the tag stripped, was an issue
    re-filed) are two different things; only the latter is an assertion. NO step
    below reads `promotionSweepDecider.ts`, `promotionSweep.ts`,
    `promotionTagState.ts`, `promotionReconcileLink.ts`, or `promotionIssueBody.ts`
    as text, substring-matches its contents, or parses it as JSON/AST. The
    issue-body assertions (§4) match against the body the sweep PRODUCED and handed
    to the injected filer — a recorded call argument, not a source file.

  Scope notes:

    • THE PURE DECIDER'S ACTION TABLE IS THE IMPLEMENTER'S UNIT TESTS, NOT BDD (AC5).
      "The decider remains pure; the new lifecycle branches are unit-tested
      exhaustively (decline-closed, decline-blocked, redrive, withdraw)" is a
      property of the pure `decidePromotionAction` over its `{tag state} × {score ≥
      threshold?} × {reconciliation fact}` cross-product — not an observable system
      output — so it belongs in the implementer's Vitest, exactly as #740 left AC6
      and #739 left `promotionTagState`'s table-tests to the implementer. The BDD
      layer here drives the whole `runPromotionSweep` shell IN-PROCESS and pins ONLY
      its observable output (which marker ended up on the file, was an issue
      re-filed with what, did it raise); it deliberately does NOT call
      `decidePromotionAction` directly nor assert the decider's per-cell action.
    • THE RECONCILE QUERY MUST SURFACE CLOSED AND BLOCKED STATE — heads-up, not a
      pinned assertion. To DISTINGUISH `closed-unmerged` (decline) from a truly
      missing tracking issue (`no-issue` ⇒ stranded ⇒ redrive/withdraw), and
      `blocked` from a healthy `open`, the injected reconciliation list the shell
      feeds the decider must carry closed/merged issues AND per-issue `adw:blocked`
      label state — not the open-only `open | no-issue` subset #740's
      `reconcileFactFor` computed. HOW that enrichment is realized (a richer
      `PromotionIssueRef` with `state` / `merged` / `labels`, a `state:all` +
      `label` query, a separate reconcile fn) is a source-structure choice left to
      the implementer and NOT pinned here; the scenarios seed the reconciliation
      FACT (closed-unmerged / blocked / merged / none) and assert the resulting
      action's artefact.
    • ORIGINATE / LEAVE-WHILE-OPEN / DONE-ON-MERGED ARE #740'S AND ARE NOT RE-PINNED
      HERE. This slice pins only the four NEW branches (decline-closed,
      decline-blocked, redrive, withdraw) plus decline's durability, non-fatality of
      the new I/O actions, and the type-check backstop. feature-740.feature already
      pins originate, below-threshold ⇒ leave, in-flight-open ⇒ leave, and
      merged ⇒ done.
    • HOW "HIGH-SCORING" / "LOW-SCORING" AND THE MARKER WRITE/STRIP ARE REALIZED ARE
      SOURCE-STRUCTURE CHOICES, left unpinned exactly as #740 / #739 left theirs. The
      harness may seed candidate content that scores at/above (or below) the
      auto-ramped threshold against a seeded vocabulary registry, OR inject the
      score/threshold decision; whether the marker is flipped through
      `serializePromotionTagState('declined' | 'none' | 'suggested')` + a
      `GitContext` scoped commit or some other seam is not asserted. The scenarios
      pin the behaviour, not the mechanism.
    • THE COMMIT-SCOPING CONTRACT IS #740'S (§2) AND IS NOT RE-PINNED. The decline
      marker write and the withdraw tag strip both mutate the candidate file through
      the SAME `tagAndCommit` seam #740 already proved commits scoped-to-that-path
      (never `git add -A`); this slice does not re-assert scoping.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the executed
      regression suite is a deliberate human decision (the very PR a promotion issue
      originates) and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`, defined in the
    shared step defs — NOT redefined in feature-741.steps.ts):
      G18 `the ADW codebase is checked out`               → ensureCronOnEveryEventSteps.ts
      T22 `the ADW TypeScript type-check passes`          → feature-504.steps.ts

    Novel phrasing introduced here. As #740 / #739 / #735 did for the sibling
    sweeps, feature-741 introduces DISTINCT, self-contained phrasing (framed around
    "reconciliation" / "in-flight" / "re-filed" / "stranded") so that
    feature-741.steps.ts owns its step defs with ZERO `AmbiguousStepDefinition`
    clash against feature-740's originate phrases under the globally-loaded per-issue
    + regression step defs (the bespoke-per-feature convention; verified zero phrase
    collisions across the suite). The gap is surfaced to the maintainer here:
      • `a per-issue feature file for issue {int} carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch`
      • `a high-scoring per-issue feature file for issue {int} carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch`
      • `a low-scoring per-issue feature file for issue {int} carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch`
      • `a high-scoring per-issue feature file for issue {int} carrying a terminal "@promotion-declined" marker is tracked on the default branch`
      • `a closed-unmerged promotion issue exists linking back to issue {int}`
      • `a blocked promotion issue carrying the "adw:blocked" label exists linking back to issue {int}`
      • `no promotion issue exists linking back to issue {int}`
      • `the injected "{string}" reconciliation action fails transiently`
      • `the promotion reconciliation sweep runs over the repository`
      • `the per-issue feature file for issue {int} carries a "@promotion-declined" marker on the default branch`
      • `the per-issue feature file for issue {int} carries no "@promotion-declined" marker on the default branch`
      • `the per-issue feature file for issue {int} carries no "@promotion-suggested-" tag on the default branch`
      • `the per-issue feature file for issue {int} still carries exactly one "@promotion-suggested-" tag on the default branch`
      • `the per-issue feature file for issue {int} still carries the "@promotion-declined" marker on the default branch`
      • `the promotion reconciliation sweep files no promotion issue`
      • `the promotion reconciliation sweep files exactly one promotion issue for issue {int}`
      • `the promotion reconciliation sweep makes no commit on the default branch`
      • `the promotion reconciliation sweep completes without raising an error`
      • `the promotion reconciliation sweep leaves the blocked promotion issue for issue {int} untouched`
      • `the re-filed promotion issue carries the labels "adw:feature", "regression-promotion" and "hitl"`
      • `the re-filed promotion issue body carries a "Promotes: feature-{int}" marker`

    Step-definition note for the maintainer (feature-741.steps.ts — keep it
    SELF-CONTAINED with its own `@adw-741` After hook and module-private `ctx`; do
    NOT reach into feature-740 / feature-739 / feature-735 sweep step defs):
      • Build the harness exactly as feature-740.steps.ts does: a REAL temp git repo
        whose `origin` is a REAL bare remote (`git init --bare`), default branch
        checked out, with a FIXED run time (`now`). Seed each candidate's
        `features/per-issue/feature-{N}.feature` AND its
        `features/per-issue/step_definitions/feature-{N}.steps.ts` sibling (the
        issue-body builder references both paths) plus a
        `features/regression/vocabulary.md` (so the retained scorer has phrases to
        match). Commit and push so the remote carries the pre-sweep tree.
      • `carrying an in-flight "@promotion-suggested-" tag` seeds the feature-level
        `@promotion-suggested-<date>` marker (the same locus
        `serializePromotionTagState` writes) BEFORE committing the fixture, so the
        file starts in the `suggested` state. `carrying a terminal
        "@promotion-declined" marker` seeds `@promotion-declined` instead.
        `high-scoring` / `low-scoring` set the candidate's scenario content so the
        RETAINED `promotionScorer` + `computeThreshold` resolve at/above vs below the
        threshold (bootstrap threshold = 3 on an empty stats window), OR inject the
        score/threshold — implementer's choice.
      • `a closed-unmerged / blocked / (merged) promotion issue exists linking back
        to issue {int}` seeds an entry in the injected reconciliation list whose body
        carries `Promotes: feature-{N}` AND whose reconciled state is closed+unmerged
        / open-with-`adw:blocked` / merged — so the extended reconcile+decider see
        `closed-unmerged` / `blocked` / `merged`. `no promotion issue exists linking
        back to issue {int}` seeds an EMPTY (or non-matching) reconciliation list so
        the decider sees `no-issue` (the stranded fact for an already-`suggested`
        file). See the Scope note: the reconciliation seam must be able to represent
        closed/blocked state, not just #740's open subset.
      • `the injected "{string}" reconciliation action fails transiently` makes the
        named seam throw: `tag-commit` throws in `tagAndCommit` (the decline marker
        commit path); `issue-filing` throws in `fileIssue` (the redrive re-file
        path). Reuse #740's token values.
      • `the promotion reconciliation sweep runs over the repository` drives the
        production `runPromotionSweep` IN-PROCESS with the temp repo as its working
        directory and the FIXED `now`, wiring `listPerIssueFeatures` /
        `readFeatureContent` to the real `GitContext` over the temp repo, injecting
        the reconciliation list, injecting a CAPTURING issue filer that records
        `(title, body, labels)` and a CAPTURING tracking-issue-mutation recorder
        (for §3's "left intact" assertion — records any close/comment/label call
        against a tracking issue; the decline path must record ZERO), and wiring the
        marker-persist seam to the real `GitContext` scoped write+commit(+push).
        Record HEAD before the sweep for the no-commit assertions. Wrap the call so
        `completes without raising an error` can assert no exception propagated. Do
        NOT drive it through an orchestrator subprocess or the git-remote-mock (same
        rationale as feature-740).
      • The marker Thens read the committed feature file's content and parse its
        feature-level tag block: `carries a "@promotion-declined" marker` /
        `still carries the "@promotion-declined" marker` asserts the terminal token
        is present; `carries no "@promotion-suggested-" tag` asserts no
        `@promotion-suggested-*` token remains; `still carries exactly one
        "@promotion-suggested-" tag` asserts precisely one such token (redrive keeps
        the file in-flight, un-doubled); `carries no "@promotion-declined" marker`
        asserts the terminal token is absent (redrive/withdraw are not declines).
        `files no promotion issue` asserts the capturing filer recorded zero calls;
        `files exactly one promotion issue for issue {int}` asserts one call, whose
        recorded labels and `Promotes: feature-{N}` body the re-file Thens read.
        `makes no commit on the default branch` compares `git rev-parse HEAD` before
        and after. `leaves the blocked promotion issue for issue {int} untouched`
        asserts the tracking-issue-mutation recorder captured zero mutations against
        that issue number.

  Background:
    Given the ADW codebase is checked out

  # ── §1 closed-unmerged ⇒ DECLINE, terminally (AC1 / US16) ──────────────────────────────
  #
  # The headline of the reconcile path. A candidate tagged `@promotion-suggested-*`
  # whose tracking PR/issue was closed WITHOUT merging is a human rejection. The
  # sweep must write the terminal `@promotion-declined` marker to the SOURCE file
  # (which in the same serialize strips the `@promotion-suggested-*` tag, resuming
  # the 14-day TTL) and must NOT re-file a promotion issue. RED before the reconcile
  # path exists (#740's decider resolves `closed-unmerged` to the conservative
  # `leave`, so the file keeps its suggested tag and is re-suggested forever);
  # GREEN once decline is wired.

  @adw-741 @adw-nmgykl-promotion-sweep-reco
  Scenario: A tagged candidate whose promotion issue was closed unmerged is declined at the source
    Given a per-issue feature file for issue 668 carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch
    And a closed-unmerged promotion issue exists linking back to issue 668
    When the promotion reconciliation sweep runs over the repository
    Then the per-issue feature file for issue 668 carries a "@promotion-declined" marker on the default branch
    And the per-issue feature file for issue 668 carries no "@promotion-suggested-" tag on the default branch
    And the promotion reconciliation sweep files no promotion issue

  # ── §2 DECLINE is durable — never re-suggested (AC1 / US17) ────────────────────────────
  #
  # Rejecting a promotion is a once-and-done decision. A file already carrying the
  # terminal `@promotion-declined` marker must be left entirely untouched — even
  # when it still scores high and has no open tracking issue (the exact input shape
  # that would ORIGINATE an untagged file). No re-origination, no new promotion
  # issue, no commit; the declined marker persists and no `@promotion-suggested-*`
  # tag is written. Guards against a decider that keys re-origination on score
  # alone and re-suggests a file the maintainer already rejected.

  @adw-741 @adw-nmgykl-promotion-sweep-reco
  Scenario: A candidate already marked promotion-declined is never re-suggested even when it still scores high
    Given a high-scoring per-issue feature file for issue 668 carrying a terminal "@promotion-declined" marker is tracked on the default branch
    And no promotion issue exists linking back to issue 668
    When the promotion reconciliation sweep runs over the repository
    Then the promotion reconciliation sweep files no promotion issue
    And the promotion reconciliation sweep makes no commit on the default branch
    And the per-issue feature file for issue 668 still carries the "@promotion-declined" marker on the default branch
    And the per-issue feature file for issue 668 carries no "@promotion-suggested-" tag on the default branch

  # ── §3 adw:blocked ⇒ DECLINE at source, blocked issue left intact (AC2 / US20) ─────────
  #
  # When a promotion workflow exhausts its retries it escalates to `adw:blocked` —
  # an OPEN tracking issue awaiting a human. An un-promotable candidate must not sit
  # TTL-exempt and unpromoted forever, so the sweep declines the SOURCE file (writes
  # `@promotion-declined`, resumes TTL) — but it must LEAVE the blocked tracking
  # issue exactly as-is as the normal human-escalation artifact: it files no issue
  # and makes no close/comment/label mutation against it. Guards both against a
  # decider that leaves a blocked candidate in-flight forever AND against one that
  # "tidies up" the blocked issue.

  @adw-741 @adw-nmgykl-promotion-sweep-reco
  Scenario: A tagged candidate whose tracking issue reached adw:blocked is declined at the source while the blocked issue is left intact
    Given a per-issue feature file for issue 668 carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch
    And a blocked promotion issue carrying the "adw:blocked" label exists linking back to issue 668
    When the promotion reconciliation sweep runs over the repository
    Then the per-issue feature file for issue 668 carries a "@promotion-declined" marker on the default branch
    And the per-issue feature file for issue 668 carries no "@promotion-suggested-" tag on the default branch
    And the promotion reconciliation sweep files no promotion issue
    And the promotion reconciliation sweep leaves the blocked promotion issue for issue 668 untouched

  # ── §4 stranded & still high ⇒ REDRIVE (AC3 / US18) ────────────────────────────────────
  #
  # A crash between tagging and PR-open can strand a candidate: it is tagged
  # `@promotion-suggested-*` (TTL-exempt) but NO tracking issue exists, so it would
  # sit exempt and unpromoted forever. The sweep must re-drive it — re-file exactly
  # one #734-shaped promotion issue (same `adw:feature` + `regression-promotion` +
  # `hitl` label set and `Promotes: feature-668` back-link as originate) — provided
  # it STILL scores ≥ threshold. The file stays in-flight: still exactly one
  # `@promotion-suggested-*` token (never doubled), never declined. Distinguishes
  # redrive (tagged `suggested` + no-issue) from originate (untagged `none` +
  # no-issue) purely on the on-file tag state.

  @adw-741 @adw-nmgykl-promotion-sweep-reco
  Scenario: A stranded high-scoring candidate with no tracking issue is re-driven — one promotion issue is re-filed and the in-flight marker is preserved
    Given a high-scoring per-issue feature file for issue 668 carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch
    And no promotion issue exists linking back to issue 668
    When the promotion reconciliation sweep runs over the repository
    Then the promotion reconciliation sweep files exactly one promotion issue for issue 668
    And the re-filed promotion issue carries the labels "adw:feature", "regression-promotion" and "hitl"
    And the re-filed promotion issue body carries a "Promotes: feature-668" marker
    And the per-issue feature file for issue 668 still carries exactly one "@promotion-suggested-" tag on the default branch
    And the per-issue feature file for issue 668 carries no "@promotion-declined" marker on the default branch

  # ── §5 stranded & score-dropped ⇒ WITHDRAW (AC4 / US19) ────────────────────────────────
  #
  # The same stranded state (tagged in-flight, tracking issue missing) but the
  # candidate's score has drifted BELOW threshold since it was suggested. Rather than
  # re-file a promotion for a candidate that no longer qualifies, the sweep WITHDRAWS
  # it: strips the `@promotion-suggested-*` tag back to the untagged `none` state so
  # the 14-day TTL resumes — and crucially does NOT write `@promotion-declined`
  # (withdraw is a score-driven resume, not a human rejection). No promotion issue is
  # filed. Guards against a redrive that ignores the re-score gate and promotes a
  # stale, drifted-down candidate.

  @adw-741 @adw-nmgykl-promotion-sweep-reco
  Scenario: A stranded candidate that has dropped below threshold is withdrawn — the marker is stripped, the TTL resumes, and no issue is re-filed
    Given a low-scoring per-issue feature file for issue 668 carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch
    And no promotion issue exists linking back to issue 668
    When the promotion reconciliation sweep runs over the repository
    Then the per-issue feature file for issue 668 carries no "@promotion-suggested-" tag on the default branch
    And the per-issue feature file for issue 668 carries no "@promotion-declined" marker on the default branch
    And the promotion reconciliation sweep files no promotion issue

  # ── §6 The reconcile path is non-fatal — a transient git/gh error is swallowed (US24-adjacent) ─
  #
  # A promotion-sweep failure must never crash the cron loop it will later be wired
  # into. The two NEW I/O actions this slice adds — the decline marker commit and
  # the redrive issue re-file — must each log-and-swallow a transient error, exactly
  # as #740 §7 pinned for originate's `tag-commit` and `issue-filing` seams. Because
  # the new branches are new CALL SITES of those same seams, a naive implementation
  # can add decline/redrive without the swallow-wrapper; these RED-drive that the
  # wrapper is present on the reconcile path too.

  @adw-741 @adw-nmgykl-promotion-sweep-reco
  Scenario: A transient failure while writing the decline marker is logged and swallowed
    Given a per-issue feature file for issue 668 carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch
    And a closed-unmerged promotion issue exists linking back to issue 668
    And the injected "tag-commit" reconciliation action fails transiently
    When the promotion reconciliation sweep runs over the repository
    Then the promotion reconciliation sweep completes without raising an error

  @adw-741 @adw-nmgykl-promotion-sweep-reco
  Scenario: A transient failure while re-filing a stranded promotion is logged and swallowed
    Given a high-scoring per-issue feature file for issue 668 carrying an in-flight "@promotion-suggested-" tag is tracked on the default branch
    And no promotion issue exists linking back to issue 668
    And the injected "issue-filing" reconciliation action fails transiently
    When the promotion reconciliation sweep runs over the repository
    Then the promotion reconciliation sweep completes without raising an error

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The extended `promotionSweepDecider` (now emitting `decline | redrive |
  # withdraw`) and the reconcile-path wiring in `runPromotionSweep` keep the ADW
  # codebase type-clean. A backstop consistent with feature-740 §T.

  @adw-741 @adw-nmgykl-promotion-sweep-reco
  Scenario: The ADW TypeScript type-check passes with the promotion reconciliation path wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
