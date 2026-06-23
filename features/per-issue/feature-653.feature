@adw-653 @adw-nj6fsh-fix-cron-processedsp
Feature: cron in-memory spawn-dedup no longer strands an abandoned run — an issue the live cron already spawned this lifetime is still recovered once it ends abandoned, without a cron restart

  Issue #653 fixes a defeat of the "abandoned is retriable" recovery design. The cron
  backlog filter (`evaluateIssue`, adws/triggers/cronIssueFilter.ts) consults an
  in-memory spawn-dedup set — `processedSpawns`, declared at module scope in
  trigger_cron.ts, never cleared and with no TTL — and short-circuits ANY issue
  already in that set to `eligible:false, reason:'processed'`. Critically, that
  short-circuit sits BEFORE the stage-classification branches that make a recoverable
  run eligible (the `abandoned`→retriable branch, and the `phase_timeout` recovery
  branch wired in by #637). The `awaiting_merge` path was already deliberately moved
  ABOVE the dedup short-circuit for exactly this reason; the recoverable stages were
  not.

  Consequence: once the live cron has spawned an issue, if that run later writes
  `abandoned` (a crash, a watchdog kill, or the push-deadlock of #648), the SAME cron
  process can never re-spawn it — the retriable recovery path is unreachable. Only a
  cron restart (which clears the in-memory set) or a separate process (the webhook)
  could recover it. The design that makes `abandoned` retriable is defeated for
  precisely the issues that need it: the ones that ran and crashed. Live incident:
  issue #638 sat `abandoned` for ~2 days with a clean, pushable branch while the cron
  — alive since before #638 ran — kept filtering it as `processed`; it recovered only
  when the cron was manually restarted.

  The fix keeps `processedSpawns` doing its ONE legitimate job — preventing a
  concurrent DOUBLE spawn within a single cron lifetime, in the window after the cron
  spawns a fresh workflow but before that workflow has written any state — while no
  longer permanently excluding a recoverable run from the recovery path. The on-disk
  spawn gate (adws/triggers/spawnGate.ts) remains the authoritative cross-cycle /
  cross-process dedup once a run has written state; the in-memory set is only the
  before-first-state-write guard. Whichever option is taken (skip/relocate the
  short-circuit for the recoverable stages, evict the issue on observing a recoverable
  resolved stage, or lean entirely on the on-disk gate), the observable contract is
  the same and is pinned below.

  Observability / rot-prevention note:

    Every assertion targets a runtime OUTPUT of the system under test, never a source
    file. No scenario reads cronIssueFilter.ts, trigger_cron.ts, spawnGate.ts, or
    stageClassifier.ts as text, substring-matches their contents, or parses them as
    JSON/AST.

      • §1–§3 phase-import the cron backlog filter (`evaluateIssue`) over a constructed
        issue with an injected stage resolver, and assert the returned `FilterResult`
        — its `eligible` flag, `action`, and carried `adwId`. This is the exact
        phase-import / return-value surface feature-636 §4 and feature-637 §2 already
        assert against; this issue extends it by driving the filter with a NON-EMPTY
        in-memory spawn-dedup set (the dimension every prior cron-filter scenario left
        empty, so none could observe this bug).
      • §4 phase-imports the production batch entry point (`filterEligibleIssues`, the
        function trigger_cron's poll loop actually calls) and asserts the returned
        partition: the issue appears in the `eligible` list rather than in the
        `filteredAnnotations` as `#N(processed)` — the precise symptom the issue
        reports, observed at the real call site.
      • §5 asserts the type-checker's verdict (registry T22).

    The `abandoned` / `phase_timeout` / `build_running` stage strings in the steps are
    INPUT test data — the stage a run records in its state file at runtime — exactly
    the artefact category the Rot-Detection Rubric permits, NOT a read of this repo's
    source files. "Already spawned this lifetime" is modelled as membership in the
    `processedSpawns` set passed to the filter (the function's own parameter), not by
    inspecting any source.

  Scope notes:

    • Behaviour pinned here is the per-issue OBSERVABLE filter verdict (eligible to
      re-spawn the recorded run / excluded), independent of HOW the implementer keeps
      the dedup set from over-excluding — relocate the short-circuit, evict on a
      recoverable resolved stage, or rely on the on-disk gate are all acceptable and
      none is pinned. Only the verdict and the carried run id are.
    • §1 pairs `abandoned` (the stage the acceptance criteria name) with
      `phase_timeout` in one Scenario Outline. They are the two recoverable stages the
      cron marks eligible-to-spawn, and the module-scope short-circuit sits before BOTH
      their branches, so it defeats them identically; the repo already treats them as
      one recoverable family (feature-638 §4/§5). `abandoned` is the AC-mandated row;
      `phase_timeout` is the same-root-cause sibling — a fix that recovers one in-set
      run but not the other would simply re-strand the family on the other stage.
    • §2 and §3 are the non-regression guards that pin the protection the dedup set was
      added for, so a fix cannot over-reach into "everything in the set is now
      eligible". §2 is the issue's explicit caveat — the BEFORE-FIRST-STATE-WRITE
      double-spawn guard: a fresh run the cron spawned this lifetime that has not yet
      recorded any state stays excluded, so it is not spawned a second time. §3 is
      acceptance criterion 2 — an issue still in progress (an active running-family
      stage) the cron already spawned stays excluded, the on-disk gate remaining
      authoritative. Both assert ONLY the `eligible:false` verdict, reason-agnostic, so
      the implementer may relabel the exclusion reason freely.
    • The empty-set control — an `abandoned` run NOT yet in the dedup set is eligible —
      is already pinned by feature-636 §4 and is not duplicated here; this file owns
      only the non-empty-set (already-spawned-this-lifetime) dimension #653 introduces.
    • The cron grace-period and cancellation gates, the region-overlap pass, and the
      takeover handler's own recovery decisions are pre-existing and orthogonal to this
      change; every scenario places the issue past the grace period so the dedup-set
      disposition — the thing this slice changes — is the observed signal.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here (surfaced to the maintainer in the agent Output) —
    the registry and every existing cron-filter step drive the filter with an EMPTY
    spawn-dedup set, so there is no registered phrase for the already-spawned-this-
    lifetime dimension this issue turns on:
      • `a backlog issue {int} the live cron already spawned earlier this lifetime, now idle past the grace period with its latest ADW run recorded at stage {string}`
      • `a backlog issue {int} the live cron already spawned earlier this lifetime whose spawned run has not yet recorded any state, now idle past the grace period`
      • `the cron backlog filter re-evaluates the issue against its in-memory spawn-dedup set`
      • `the cron runs its backlog sweep against its in-memory spawn-dedup set`
      • `the cron backlog filter marks the issue eligible to re-spawn its recorded ADW run`
      • `the cron backlog filter still excludes the issue from the sweep`
      • `the cron sweep makes the issue eligible to re-spawn rather than filtering it as already-processed`

    Step-definition note for the maintainer: keep feature-653's step file SELF-
    CONTAINED — do not reach into feature-636's module-private `cronCtx`. Mirror the
    feature-636 cron harness, but pass a NON-EMPTY dedup set:
      • Both "already spawned earlier this lifetime" Givens record the issue number,
        the recorded stage (or `null` for the no-state-yet variant), and a fixed
        recorded adwId, and mark the issue as a member of the spawn-dedup set.
      • The "re-evaluates … against its in-memory spawn-dedup set" When phase-imports
        `evaluateIssue` and calls it with `processed = { spawns: new Set([issueNumber]) }`,
        an injected `resolveStage` returning `{ stage, adwId, lastActivityMs }` with
        `lastActivityMs` ~200s before `now` (past the 60s grace), and `now = Date.now()`.
        For the no-state-yet variant, `resolveStage` returns `{ stage: null, adwId: null,
        lastActivityMs: <past grace> }` and NO label-recovery evaluator is injected, so
        the dedup set is the only thing that can exclude it.
      • The "runs its backlog sweep …" When phase-imports `filterEligibleIssues` with the
        same non-empty `{ spawns }` set and the single constructed issue.
      • `marks the issue eligible to re-spawn its recorded ADW run` asserts
        `eligible === true`, `action === 'spawn'`, and `adwId === <the recorded adwId>`
        (a carried run id, proving a take-over of the recorded run rather than a fresh
        spawn). `still excludes the issue from the sweep` asserts `eligible === false`
        only, reason-agnostic. `makes the issue eligible to re-spawn rather than
        filtering it as already-processed` asserts the returned `eligible` list contains
        the issue with `action 'spawn'` AND that `filteredAnnotations` carries no
        `#<n>(processed)` entry for it.

  Background:
    Given the ADW codebase is checked out

  # ── §1 The headline flip: a recoverable run already spawned this lifetime is still eligible ──
  #
  # The bug, and acceptance criteria 1 + 3. The live cron spawned issue N earlier in
  # its current lifetime, so N is in the never-cleared in-memory dedup set; N's run has
  # since ended at a RECOVERABLE stage. The filter must mark it eligible to re-spawn
  # its recorded run (carrying the run id, so the spawned orchestrator takes over that
  # run rather than starting clean) — NOT short-circuit it as `processed`. RED before
  # the fix, which returns `eligible:false, reason:'processed'` for any in-set issue.
  #
  # `abandoned` is the AC-named stage; `phase_timeout` is the same-root-cause sibling
  # in the recoverable family — the module-scope short-circuit precedes both their
  # eligibility branches, so both are stranded identically once in the dedup set.

  @adw-653 @adw-nj6fsh-fix-cron-processedsp
  Scenario Outline: A recoverable run the live cron already spawned this lifetime is still eligible to re-spawn
    Given a backlog issue 6531 the live cron already spawned earlier this lifetime, now idle past the grace period with its latest ADW run recorded at stage "<stage>"
    When the cron backlog filter re-evaluates the issue against its in-memory spawn-dedup set
    Then the cron backlog filter marks the issue eligible to re-spawn its recorded ADW run

    Examples:
      | stage         |
      | abandoned     |
      | phase_timeout |

  # ── §2 Non-regression: the before-first-state-write double-spawn guard is preserved ──
  #
  # The issue's explicit caveat — "must not regress the duplicate-spawn protection the
  # set was added for (dedup before the first spawn writes state)". The cron spawned a
  # FRESH workflow for issue N this lifetime; on this next tick that workflow has not
  # yet recorded any state, so the stage resolves to null. Without the in-memory set
  # the filter would mark it eligible and spawn it a SECOND time. It must stay excluded.
  # GREEN before and after the fix — this is the protection the fix must keep, not the
  # behaviour it changes.

  @adw-653 @adw-nj6fsh-fix-cron-processedsp
  Scenario: A fresh run already spawned this lifetime that has not yet recorded state stays excluded
    Given a backlog issue 6532 the live cron already spawned earlier this lifetime whose spawned run has not yet recorded any state, now idle past the grace period
    When the cron backlog filter re-evaluates the issue against its in-memory spawn-dedup set
    Then the cron backlog filter still excludes the issue from the sweep

  # ── §3 Non-regression: an in-progress run already spawned this lifetime stays excluded ──
  #
  # Acceptance criterion 2 — no duplicate concurrent spawn for an issue still in
  # progress. The cron spawned issue N this lifetime and N's run is actively mid-flight
  # (an active running-family stage). It must stay excluded so the cron never spawns a
  # second concurrent orchestrator over a live run; the on-disk spawn gate remains
  # authoritative. The verdict is reason-agnostic — after the fix the exclusion may be
  # attributed to the active stage rather than to the dedup set, but it stays excluded.
  # GREEN before and after the fix; guards against an over-reach that makes everything
  # in the set eligible.

  @adw-653 @adw-nj6fsh-fix-cron-processedsp
  Scenario: An in-progress run already spawned this lifetime is not spawned a second time
    Given a backlog issue 6533 the live cron already spawned earlier this lifetime, now idle past the grace period with its latest ADW run recorded at stage "build_running"
    When the cron backlog filter re-evaluates the issue against its in-memory spawn-dedup set
    Then the cron backlog filter still excludes the issue from the sweep

  # ── §4 The reported symptom, at the production batch call site ────────────────
  #
  # Acceptance criterion 1, observed end-to-end through `filterEligibleIssues` — the
  # function trigger_cron's poll loop actually calls each tick. On a SUBSEQUENT poll
  # (the in-memory set still holds N because it is never cleared — the very bug), an
  # `abandoned` run the cron previously spawned must surface in the eligible sweep for
  # re-spawn, not be filtered out and annotated `#N(processed)`. This pins the exact
  # symptom the issue reports — `eligible:false, reason:'processed'` and the
  # `#N(processed)` annotation — at the real call site, and is RED before the fix.

  @adw-653 @adw-nj6fsh-fix-cron-processedsp
  Scenario: A subsequent poll re-includes an abandoned run the cron already spawned, instead of filtering it as processed
    Given a backlog issue 6534 the live cron already spawned earlier this lifetime, now idle past the grace period with its latest ADW run recorded at stage "abandoned"
    When the cron runs its backlog sweep against its in-memory spawn-dedup set
    Then the cron sweep makes the issue eligible to re-spawn rather than filtering it as already-processed

  # ── §5 Type-check backstop ────────────────────────────────────────────────────
  #
  # The change to how the dedup set gates the recoverable stages keeps the ADW codebase
  # type-clean (the feature-636 `never`-exhaustiveness guard over the stage taxonomy
  # still holds). A backstop, consistent with feature-636 §11, feature-637 §6, and
  # feature-638 §8.

  @adw-653 @adw-nj6fsh-fix-cron-processedsp
  Scenario: The ADW TypeScript type-check passes with the spawn-dedup recovery fix in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
