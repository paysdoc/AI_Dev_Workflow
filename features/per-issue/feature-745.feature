@adw-745 @adw-tpdqb8-activate-promotion-s
Feature: The promotion sweep goes live in cron — runPromotionSweep is dispatched from the backlog sweeper on a generous PROMOTION_SWEEP_INTERVAL_CYCLES cadence (not every 20s tick), and a sweep failure is swallowed at the call site so it can never crash the cron loop

  Issue #745 is the GO-LIVE slice of the automated scenario-promotion sweep
  (parent PRD `specs/prd/automated-scenario-promotion-sweep.md`, user stories
  21-22, 24-25, Implementation Decision "Trigger wiring"). Its three siblings built
  and proved the sweep in isolation, invokable BY HAND but wired into NO trigger:
  #739 made the 14-day per-issue TTL sweep promotion-AWARE, #740 built the ORIGINATE
  half, and #741 built the RECONCILE half (decline / redrive / withdraw). The
  production `runPromotionSweep` shell (`adws/triggers/promotionSweep.ts`) is
  therefore ALREADY COMPLETE — dependency-injected, returning a
  `PromotionSweepReport`, and internally non-fatal (each I/O action is wrapped and
  swallowed, #740 §7 / #741 §6).

  THIS slice turns the sweep ON. Its ONLY production change is a wiring change to
  `adws/triggers/trigger_cron.ts`: `runPromotionSweep()` is dispatched from the
  cron backlog sweeper (`checkAndTrigger`) under a NEW interval gate
  `cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0`, ADJACENT to the existing
  per-issue TTL sweep (`PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`, trigger_cron.ts
  §"Delete stale per-issue scenario files"), and wrapped in a CALL-SITE try/catch
  that logs and swallows — exactly the belt-and-suspenders convention the adjacent
  `runUpgradeRedriveScan` dispatch already follows (trigger_cron.ts §"Independent
  redrive pass": "A scan failure must never abort the tick"). Once live, the first
  cadence-eligible run processes the existing `@promotion-suggested-*` backlog
  (#509 / #510 / #511 / #512 / #609) through that same, already-proven shell.

  The behavioural contract pinned below (the OBSERVABLE half of the acceptance
  criteria — the sweep's per-candidate lifecycle and its internal non-fatality are
  the SIBLINGS' contract, see Scope notes):

    1. DISPATCHED ON THE CADENCE (AC1, US25). On a cron cycle that lands on the
       promotion-sweep cadence, the backlog sweeper invokes `runPromotionSweep`
       exactly once. This is the go-live: before this slice nothing in cron ever
       calls the sweep (RED — never invoked); after it, the cadence-eligible tick
       dispatches it (GREEN).
    2. NOT DISPATCHED OFF-CADENCE — THE CADENCE IS GENEROUS (AC5, US25). On an
       intervening cron cycle (one that is NOT a multiple of the interval — the
       common case, since the poll ticks every 20 seconds), the sweeper does NOT
       invoke the sweep. The sweep's git/gh ACTIONS (commit-to-default, issue
       creation, reconciliation queries) therefore run on the generous cadence, not
       on every 20-second tick. Guards against a mis-wiring that dispatches the sweep
       unconditionally each tick.
    3. A SWEEP FAILURE IS SWALLOWED AT THE CALL SITE (AC2, US24). When a dispatched
       sweep raises, the cron sweeper LOGS AND SWALLOWS it and the tick completes
       without propagating the error — so a promotion-sweep failure can never crash
       the cron loop. This is the WIRING-level guard (a try/catch at the
       `checkAndTrigger` call site), distinct from and additional to the sweep's own
       INTERNAL non-fatality that #740 §7 / #741 §6 already pin: even a throw that
       somehow escaped the shell (a synchronous dep-construction error, a future
       regression) must not abort the tick.
    4. TYPE-CHECK BACKSTOP (T22). The ADW codebase still type-checks with
       `runPromotionSweep` and the `PROMOTION_SWEEP_INTERVAL_CYCLES` constant
       imported into `trigger_cron.ts` and the new dispatch call site wired in. A
       backstop consistent with feature-739 §T / feature-740 §T / feature-741 §T; it
       also pins that the call site matches the shell's exported signature (the one
       seam the injected-sweep scenarios below deliberately stub out).

  Observability / rot-prevention note:

    Every assertion below targets an artefact the WIRING produces — whether the
    injected promotion-sweep seam was invoked (once / not at all) for a given cron
    cycle, and whether the dispatch completed without propagating an injected error.
    These are vocabulary registry surface #2 ("recorded calls captured by a
    mock/injected seam") — the exact observability style #740 / #741 use for their
    injected capturing `fileIssue`. Plus the type-checker's verdict (T22).

    NO step below reads `trigger_cron.ts`, `promotionSweep.ts`, or any source file as
    text, substring-matches its contents, or parses it as JSON/AST. In particular
    this feature does NOT assert "runPromotionSweep is called at such-and-such line"
    or "the cadence gate is present in trigger_cron.ts" — those would be prohibited
    source-structure assertions (the shape the legacy `@adw-501`
    `webhook_ensure_cron` scenarios use is explicitly NOT emulated). The observable
    is the recorded INVOCATION of the injected sweep on the driven cron cycle and the
    dispatch's raise/no-raise outcome — behaviour, not source shape.

  Scope notes:

    • THE CADENCE-GATE + SWALLOW ARE DRIVEN THROUGH AN EXPORTED DISPATCH SEAM, NOT
      THROUGH A SPAWNED CRON. `checkAndTrigger` is not exported and does far too much
      I/O (auth gate, pause-queue, issue fetch) to drive whole in-process, and the
      generous interval makes a real multi-tick subprocess run impractical (you
      cannot tick thousands of 20-second cycles in a test). The established codebase
      pattern is to EXPORT the sweep-dispatch step so integration tests invoke it
      directly — exactly as `runHungDetectorSweep` is "exported so that integration
      tests can invoke the sweep logic directly without the cycle gate"
      (trigger_cron.ts), and as the entry-script argv guard keeps the module
      import-safe for step defs (trigger_cron.ts §"Only start the cron loop when
      running as the entry script"). HOW the seam is realized — a
      `runPromotionSweepTick(cycleCount, sweep = runPromotionSweep)` that encloses
      the `cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0` gate AND the try/catch
      swallow, or some other exported shape — is a SOURCE-STRUCTURE choice left to the
      implementer, exactly as #740 / #741 left their persist/reconcile seams unpinned.
      The scenarios pin the OBSERVABLE dispatch behaviour (invoked on cadence, not
      invoked off-cadence, swallow on throw), not the seam's name or shape.
    • THE INTERVAL VALUE IS UNPINNED (config). `PROMOTION_SWEEP_INTERVAL_CYCLES` is a
      tunable config constant (the sibling `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`
      defaults to 4320); its exact number is not asserted. The scenarios express
      "on the cadence" / "an intervening cycle" RELATIVE to the imported constant so
      they stay correct if the value is retuned — no literal cycle number appears in
      the Gherkin. "Generous" is pinned as the OBSERVABLE property (off-cadence ticks
      do not dispatch), not as a magic number.
    • THE SWEEP'S PER-CANDIDATE LIFECYCLE IS THE SIBLINGS' CONTRACT AND IS NOT
      RE-PINNED HERE (AC3). "The first live run re-scores the backlog and files
      promotion issues for those still >= threshold, withdrawing the rest" is
      `runPromotionSweep`'s SHELL behaviour: the backlog files are already tagged
      `@promotion-suggested-*` with no live tracking issue (crash-stranded), so the
      reconcile path REDRIVES the still-high scorers (files one #734-shaped issue) and
      WITHDRAWS the drifted-down ones (strips the tag, resumes TTL) — exactly
      feature-741 §4 (redrive) and §5 (withdraw), which drive the same production
      `runPromotionSweep` in-process over a seeded backlog. This slice's job is to
      INVOKE that proven shell on the cadence (§1); it deliberately does not
      re-exercise the per-file redrive/withdraw outcomes, honouring the sibling-slice
      discipline (#741 likewise refused to re-pin #740's originate). The one residual
      not covered by an injected stub — that the DEFAULT dispatch binds the real
      `runPromotionSweep` rather than a no-op — is pinned by the type-check backstop
      (§4, the call-site/signature match) and covered end-to-end by #740 / #741.
    • THE PIPELINE → awaiting_merge FLOW IS INHERITED, NOT NEW CODE (AC4, US22). "A
      filed promotion issue flows through the normal pipeline and reaches
      `awaiting_merge` behind the `hitl` gate" is EXISTING ADW machinery, not
      touched by this slice (the sole production file is `trigger_cron.ts`): the
      `adw:feature` label deterministically routes the issue, the scenario-authoring
      skip-gate and the stateless `(no hitl) OR (approved)` merge gate are the
      subject of other slices, and `hitl` defers the merge for human approval. Per
      US22 the promotion issue "inherits ADW's existing resilience … so that no
      promotion-specific recovery machinery is built." Re-driving a full SDLC run
      here would be testing pre-existing, separately-covered behaviour. This is also
      WHY the issue is itself `hitl`: the first live activation and its backlog
      behaviour are reviewed by a human at the PR gate ("merge only after human
      review of the activation and backlog behavior"), which is the correct locus for
      that end-to-end validation — not a hermetic BDD scenario.
    • THE INTERNAL NON-FATALITY OF THE SWEEP IS #740 §7 / #741 §6 AND IS NOT
      RE-PINNED. Those slices inject a throwing `tagAndCommit` / `fileIssue` INSIDE
      the sweep and assert the SWEEP swallows it. §3 here is a different layer: it
      injects a throwing SWEEP (the whole call rejects) and asserts the WIRING
      swallows it. Both matter; they guard different call frames.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the executed
      regression suite is a deliberate human decision (the very PR a promotion issue
      originates) and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`, defined in the
    shared step defs — NOT redefined in feature-745.steps.ts):
      G18 `the ADW codebase is checked out`               → ensureCronOnEveryEventSteps.ts
      T22 `the ADW TypeScript type-check passes`          → feature-504.steps.ts

    Novel phrasing introduced here. The registry's cron phrases — W10
    `the cron probe runs once` (a spawned empty-queue probe) and W14
    `the cron poll batch runs` (the issue-fetch / auth-reassert slice) — describe
    OTHER parts of the tick and are bound to their own step defs; neither expresses
    the promotion-sweep cadence dispatch. As #739 / #740 / #741 did for the sibling
    sweeps, feature-745 introduces DISTINCT, self-contained phrasing (framed around
    "the cron promotion-sweep dispatch" and the "cadence-eligible / intervening"
    cycle position) so that feature-745.steps.ts owns its step defs with ZERO
    `AmbiguousStepDefinition` clash under the globally-loaded per-issue + regression
    step defs (the bespoke-per-feature convention; verified zero phrase collisions
    across the suite — in particular "the cron promotion-sweep DISPATCH completes
    without raising an error" is deliberately distinct from #740's "the promotion
    ORIGINATION sweep …" and #741's "the promotion RECONCILIATION sweep …"). The gap
    is surfaced to the maintainer here:
      • `the injected promotion sweep is configured to throw a transient error`
      • `the cron promotion-sweep dispatch runs for a {string} cron cycle`
      • `the promotion sweep is dispatched exactly once`
      • `the promotion sweep is not dispatched`
      • `the cron promotion-sweep dispatch completes without raising an error`

    Step-definition note for the maintainer (feature-745.steps.ts — keep it
    SELF-CONTAINED with its own `@adw-745` After hook and module-private `ctx`; do
    NOT reach into feature-740 / feature-741 sweep step defs):
      • Import the EXPORTED cron dispatch seam and the `PROMOTION_SWEEP_INTERVAL_CYCLES`
        constant from the ADW codebase — the same import-a-function-from-trigger_cron
        pattern the codebase already sanctions for `runHungDetectorSweep` (the
        entry-script argv guard means importing `trigger_cron.ts` does NOT start the
        cron loop or `process.exit`). Do NOT spawn a real cron and do NOT read
        `trigger_cron.ts` as text.
      • `the cron promotion-sweep dispatch runs for a {string} cron cycle` drives that
        seam with a cycleCount COMPUTED from the imported constant (never a literal):
          - "cadence-eligible"  → `cycleCount = PROMOTION_SWEEP_INTERVAL_CYCLES`
                                   (a multiple of the interval ⇒ gate open)
          - "intervening"       → `PROMOTION_SWEEP_INTERVAL_CYCLES + 1` (not a multiple)
          - "pre-cadence"       → `PROMOTION_SWEEP_INTERVAL_CYCLES - 1` (not a multiple)
          - "startup"           → `1` (the first tick; not a multiple for any generous
                                   interval > 1)
        Inject a CAPTURING fake sweep in place of the real `runPromotionSweep` that
        increments an invocation counter and resolves (return an empty
        `PromotionSweepReport`-shaped value). Record whether the dispatch promise
        rejected (wrap the await in try/catch and store the outcome on `ctx`).
      • `the injected promotion sweep is configured to throw a transient error` swaps
        the capturing fake for one that throws (or returns a rejected promise) when
        invoked — so §3 exercises the CALL-SITE swallow, not the sweep's internal one.
      • `the promotion sweep is dispatched exactly once` asserts the injected fake's
        invocation counter is exactly 1; `the promotion sweep is not dispatched`
        asserts it is 0; `the cron promotion-sweep dispatch completes without raising
        an error` asserts the recorded dispatch outcome carries no propagated error
        (and that the throwing fake WAS invoked — the swallow happened around a real
        attempt, not because the gate was closed).
      • Reuse the registered `the ADW codebase is checked out` (G18) and
        `the ADW TypeScript type-check passes` (T22) shared step defs for the
        Background and §4 — do NOT redefine them here.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Dispatched on the cadence — the go-live (AC1 / US25) ─────────────────────────────
  #
  # The headline. On a cron cycle that lands on the promotion-sweep cadence (a
  # multiple of PROMOTION_SWEEP_INTERVAL_CYCLES), the backlog sweeper invokes
  # `runPromotionSweep` exactly once. Before this slice nothing in cron dispatches
  # the sweep at all (it is manual-CLI only), so the promotion pipeline never runs —
  # RED. Wiring the cadence-gated dispatch into `checkAndTrigger` turns it on —
  # GREEN. "Exactly once" guards against a double-wire (dispatching from two call
  # sites, or forgetting to return after the gate).

  @adw-745 @adw-tpdqb8-activate-promotion-s
  Scenario: On a cadence-eligible cron cycle the backlog sweeper dispatches the promotion sweep exactly once
    When the cron promotion-sweep dispatch runs for a "cadence-eligible" cron cycle
    Then the promotion sweep is dispatched exactly once

  # ── §2 Not dispatched off-cadence — the cadence is generous (AC5 / US25) ────────────────
  #
  # The other half of the cadence gate, and the whole point of interval-gating it:
  # the sweep's git/gh actions must run on a GENEROUS cadence, not on every
  # 20-second poll tick. On any intervening cron cycle — one that is not a multiple
  # of the interval, which is the overwhelming common case — the sweeper must NOT
  # invoke the sweep. Covers a cycle just past the cadence, one just before it, and
  # an early startup tick, so the gate is shown to reject non-multiples generally
  # rather than one hand-picked offset. Guards against an unconditional dispatch that
  # would fire git/gh work every tick.

  @adw-745 @adw-tpdqb8-activate-promotion-s
  Scenario Outline: On an intervening cron cycle the backlog sweeper does not dispatch the promotion sweep
    When the cron promotion-sweep dispatch runs for a "<cyclePosition>" cron cycle
    Then the promotion sweep is not dispatched

    Examples:
      | cyclePosition | note                                                         |
      | intervening   | one tick past the cadence — the common between-sweeps tick   |
      | pre-cadence   | one tick before the cadence — still gated closed             |
      | startup       | the first cron tick — no sweep until the cadence is reached  |

  # ── §3 A sweep failure is swallowed at the call site — the tick survives (AC2 / US24) ────
  #
  # A promotion-sweep failure must never crash the cron loop. When a dispatched sweep
  # raises, the sweeper logs and SWALLOWS it and the cron tick completes without
  # propagating the error — the belt-and-suspenders try/catch at the `checkAndTrigger`
  # call site, mirroring the adjacent `runUpgradeRedriveScan` dispatch ("A scan
  # failure must never abort the tick"). This is a DIFFERENT layer from the sweep's
  # own internal non-fatality (#740 §7 / #741 §6, which inject a throwing action
  # INSIDE the sweep): here the WHOLE injected sweep rejects, and the wiring must
  # still absorb it. RED if the dispatch lets the throw propagate out of the tick;
  # GREEN once the call site is wrapped.

  @adw-745 @adw-tpdqb8-activate-promotion-s
  Scenario: A throwing promotion sweep is logged and swallowed so the cron tick completes without raising
    Given the injected promotion sweep is configured to throw a transient error
    When the cron promotion-sweep dispatch runs for a "cadence-eligible" cron cycle
    Then the cron promotion-sweep dispatch completes without raising an error

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # `runPromotionSweep` and the `PROMOTION_SWEEP_INTERVAL_CYCLES` constant imported
  # into `trigger_cron.ts`, and the new dispatch call site, keep the ADW codebase
  # type-clean. Consistent with feature-739 §T / feature-740 §T / feature-741 §T.
  # This also pins the one seam the injected-sweep scenarios stub out: the dispatch
  # call site must match `runPromotionSweep`'s exported signature, so the default
  # (real) binding compiles.

  @adw-745 @adw-tpdqb8-activate-promotion-s
  Scenario: The ADW TypeScript type-check passes with the promotion sweep wired into the cron backlog sweeper
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
