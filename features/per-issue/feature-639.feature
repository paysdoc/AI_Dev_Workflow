@adw-639 @adw-11ormi-feat-bounded-resume
Feature: Bounded resume cap with human-gated escalation — resume attempts are counted, capped, and escalated to a human gate instead of burning money forever

  Issue #639 puts a hard ceiling on how many times a `resumable` workflow can be
  resumed before the automation steps back and asks a human. Parent PRD (per the
  issue): `specs/prd/stage-recovery-resume-in-place.md`.

  Background — the chain this slice closes:

    • #636 introduced the exhaustive `classifyStage` taxonomy, in which the
      `human_gated` StageClass already exists (its sole member today is
      `merge_blocked`).
    • #637 made `phase_timeout` (a `resumable` stage) actually recoverable —
      cron/takeover now pick a timed-out run back up instead of stranding it.

  Recovery without a bound is a money fire: a `resumable` workflow that fails the
  same way every tick will be resumed forever, each resume spending tokens. This
  slice adds the backstop — the same philosophy as `progressGate`'s checkpoint
  cap (#559), applied across resume attempts rather than build batches:

    1. A `resumeAttempts` counter lives in TOP-LEVEL workflow state (the same
       artefact `mergeRetryCount` lives in), so it is durable: it survives the
       process exit between cron ticks and accumulates across them rather than
       resetting to zero on each recovery.
    2. A pure `nextResumeAction(attempts, max)` returns `resume` while attempts
       are below the bound and `escalate` once attempts reach or exceed it — the
       direct analogue of `evaluateProgressGate`'s `continue` / `backstop`
       decision. Below the bound the workflow is resumed and the counter is
       incremented; at/above the bound it is escalated.
    3. The escalation target is a `human_gated` stage, mirroring `merge_blocked`:
       it posts an explanatory comment naming the resume-cap cause and the
       `## Retry` remedy, it is NOT auto-recovered, and the cron backlog sweep
       leaves it out (the money-fire backstop — recovery does not keep firing).
    4. `## Retry` is the human re-entry, mirroring the `merge_blocked` recovery
       (#527): it re-arms the counter (resume attempts back to zero) and lifts
       the gate so the standard resumable recovery can run again.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test,
    never a source file. No step reads `adws/core/stageClassifier.ts`, a resume
    policy module, `adws/types/workflowTypes.ts`, `adws/triggers/retryHandler.ts`,
    `adws/triggers/cronIssueFilter.ts`, or any source as text, substring-matches
    its contents, or parses it as JSON/AST.

      • §1 phase-imports the pure `nextResumeAction` and asserts its returned
        decision — a function-of-the-system return value, exactly the observable
        category feature-559 §1 asserts for `evaluateProgressGate` and #504 for
        the JSONL parser. The `"resume"` / `"escalate"` strings are the
        function's documented return contract (named verbatim in the issue), not
        a source property.
      • §2–§3 and §5 assert the TOP-LEVEL STATE FILE the system writes — the
        `resumeAttempts` counter and the `workflowStage`, both read exactly as
        vocabulary entry T1 reads `workflowStage` and as feature-527 reads the
        merge retry counter (the state file is an artefact, a permitted read).
        §3's escalation comment is asserted through the mock GitHub API the
        recorded-comment vocabulary already covers (T2/T3), the same surface
        feature-527 §2/§3 asserts the `merge_blocked` comment against.
      • §4 drives the cron backlog filter (`evaluateIssue`) over a constructed
        issue with an injected stage resolver and asserts the returned
        `FilterResult` — the #636/#637 cron surface.
      • §6 asserts the type-checker's verdict (registry T22).

    The stage strings in the steps (`human_gated`, `phase_timeout`,
    `build_completed`) are INPUT/OUTPUT test data — the value the system reads
    from or writes to a state file at runtime — exactly the artefact category the
    Rot-Detection Rubric permits. The acceptance criterion "`human_gated` is a
    workflow stage" is therefore proven BEHAVIOURALLY (the system writes it to
    the state-file artefact in §3 and the cron treats it as terminal-until-human
    in §4), never by parsing the `WorkflowStage` union out of source — the same
    technique feature-527 used to prove `merge_blocked`.

  Scope notes:

    • The pinned behaviour is the OBSERVABLE outcome — the resume/escalate
      decision, the persisted counter value, the written `workflowStage`, the
      escalation comment, and the cron eligibility — NOT the internal
      `StageClass` label, the name of the resume policy module, or the order in
      which the applier increments vs. decides. An implementer may classify the
      new stage in any class and structure the policy module freely as long as
      these outcomes hold (consistent with the #636/#637 "pin the decision, not
      the taxonomy" stance).
    • The resume BOUND is set explicitly per scenario (an injected input, like
      feature-559 sets the checkpoint backstop), so these scenarios do not depend
      on the production constant's value.
    • TAKEOVER's disposition of the `human_gated` class is OUT OF SCOPE and
      deliberately unchanged: feature-636 §10 already pins `human_gated`
      (`merge_blocked`) to takeover's defensive `spawn_fresh` fallthrough. The
      money-fire backstop this issue owns is the CRON exclusion (§4), the same
      level at which `merge_blocked` is gated (feature-527 §4, feature-636 §1).
    • feature-636 and feature-637 are NOT modified by this issue. Adding a
      `human_gated` WorkflowStage requires the implementer to give it a
      `classifyStage` case (else #636's `never`-exhaustiveness guard fails to
      build); that joins it to the existing `human_gated` class alongside
      `merge_blocked` and preserves every behaviour those features pin. §6 is the
      backstop for that compile-time guard.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G1  `the mock GitHub API is configured to accept issue comments`
      G4  `an issue {int} exists in the mock issue tracker`
      G6  `a state file exists for adwId {string} at stage {string}`
      G18 `the ADW codebase is checked out`
      T1  `the state file for adwId {string} records workflowStage {string}`
      T2  `the mock GitHub API recorded a comment on issue {int}`
      T3  `the mock GitHub API recorded a comment containing the text {string}`
      T22 `the ADW TypeScript type-check passes`

    Established phrases reused from sibling per-issue features (not yet in the
    registry):
      from feature-527 (merge_blocked recovery — the direct analogue):
        `issue {int} carries an ADW comment naming adwId {string}`
        `issue {int} has a comment whose body is "## Retry"`
        `the "## Retry" directive is processed for issue {int}`
      from feature-636 / feature-637 (cron backlog filter decision):
        `a backlog issue {int} idle past the cron grace period whose latest ADW run is recorded at stage {string}`
        `the cron backlog filter evaluates the issue`
        `the cron backlog filter excludes the issue from the sweep`

    Novel phrasing introduced here — the registry has no phrase for the resume
    policy, its counter, or its escalation. Surfaced to the maintainer in the
    agent Output:
      • `the resume policy is evaluated for {int} prior resume attempts against a resume bound of {int}`
      • `the resume policy decision is {string}`
      • `the resume bound is set to {int}`
      • `the state file for adwId {string} is seeded with a resume attempt count of {int}`
      • `the state file for adwId {string} records a resume attempt count of {int}`
      • `the resume policy is applied to the resumable workflow for adwId {string} on issue {int}`
      • `the human-gated escalation comment for issue {int} names the resume-cap cause`
      • `the state file for adwId {string} no longer records workflowStage {string}`

    Step-definition note for the maintainer:
      • §1 phase-imports `nextResumeAction(attempts, max)` and asserts the
        returned value equals the Examples `decision` — a pure call, no fixtures.
      • §2–§3 drive the resume policy module's stateful applier: seed a top-level
        state at a `resumable` stage carrying `resumeAttempts`, set the bound as
        an injected input, then apply the policy. Applying once below the bound
        persists `resumeAttempts + 1` and leaves the stage recoverable; applying
        at/above the bound writes `workflowStage: 'human_gated'` and posts the
        escalation comment through the injected commenter the mock GitHub API
        records (the feature-527 §3 pattern; cf. registry T-PY6's capturing
        commenter). "Applied twice" in §2 reads the persisted counter back on the
        second apply, proving cross-tick accumulation. The scenarios pin the
        observable end-state for each (seeded count, bound) pair, so the
        applier's internal increment-vs-decide order is free.
      • §4 reuses the feature-636/637 cron step verbatim: phase-import
        `evaluateIssue` with an injected `resolveStage` returning
        `{ stage: 'human_gated', adwId, lastActivityMs }`; assert the returned
        `FilterResult.eligible` is false (the implementer adds the `human_gated`
        exclusion branch alongside the existing `merge_blocked` one).
      • §5 reuses the feature-527 `## Retry` step: phase-import the retry-directive
        handler (extended to recognise `human_gated`, not only `merge_blocked`)
        and assert the persisted state records `resumeAttempts: 0` and no longer
        records `workflowStage: 'human_gated'`.

  Background:
    Given the ADW codebase is checked out

  # ── §1 The resume policy decision — pure function (AC2, AC4) ──────────────
  #
  # `nextResumeAction(attempts, max)` is the pure core of the cap, the analogue
  # of `evaluateProgressGate`. It returns `resume` strictly below the bound and
  # `escalate` once attempts reach or exceed it. The Examples table is the
  # boundary-case unit coverage the acceptance criteria call for: well below, one
  # below, exactly at, above, the minimum bound of 1, and the degenerate bound of
  # 0 where no resume is ever permitted.

  @adw-639 @adw-11ormi-feat-bounded-resume
  Scenario Outline: The resume policy resumes below the bound and escalates at or above it
    When the resume policy is evaluated for <attempts> prior resume attempts against a resume bound of <bound>
    Then the resume policy decision is "<decision>"

    Examples:
      | attempts | bound | decision |
      | 0        | 3     | resume   |
      | 2        | 3     | resume   |
      | 3        | 3     | escalate |
      | 4        | 3     | escalate |
      | 0        | 1     | resume   |
      | 1        | 1     | escalate |
      | 0        | 0     | escalate |
      | 5        | 0     | escalate |

  # ── §2 resumeAttempts is durable and accumulates across cron ticks (AC1) ──
  #
  # The counter lives in top-level state, so a resume performed on one cron tick
  # is visible to the next. Applying the policy twice from zero (two successive
  # ticks, both below a generous bound) lands at 2 — it would land at 1 if the
  # counter reset between ticks instead of persisting. This is the durability the
  # acceptance criterion demands.

  @adw-639 @adw-11ormi-feat-bounded-resume
  Scenario: The resume attempt counter accumulates across successive recovery ticks instead of resetting
    Given an issue 6390 exists in the mock issue tracker
    And a state file exists for adwId "resume-639-1" at stage "phase_timeout"
    And the state file for adwId "resume-639-1" is seeded with a resume attempt count of 0
    And the resume bound is set to 5
    When the resume policy is applied to the resumable workflow for adwId "resume-639-1" on issue 6390
    And the resume policy is applied to the resumable workflow for adwId "resume-639-1" on issue 6390
    Then the state file for adwId "resume-639-1" records a resume attempt count of 2

  # ── §3 Below the bound resumes & counts; at the bound escalates (AC1, AC2) ─
  #
  # The stateful half of §1. Below the bound the policy increments the durable
  # counter and leaves the workflow recoverable (no gate). At the bound it writes
  # the `human_gated` stage to the state file and posts the escalation comment
  # naming the cause and the `## Retry` remedy — mirroring feature-527 §2/§3's
  # merge_blocked escalation.

  @adw-639 @adw-11ormi-feat-bounded-resume
  Scenario: A resume below the bound increments the durable counter and keeps the workflow recoverable
    Given an issue 6391 exists in the mock issue tracker
    And a state file exists for adwId "resume-639-2" at stage "phase_timeout"
    And the state file for adwId "resume-639-2" is seeded with a resume attempt count of 0
    And the resume bound is set to 3
    When the resume policy is applied to the resumable workflow for adwId "resume-639-2" on issue 6391
    Then the state file for adwId "resume-639-2" records a resume attempt count of 1
    And the state file for adwId "resume-639-2" no longer records workflowStage "human_gated"

  @adw-639 @adw-11ormi-feat-bounded-resume
  Scenario: A resume at the bound escalates to human_gated with an explanatory comment naming the ## Retry remedy
    Given an issue 6392 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And a state file exists for adwId "resume-639-3" at stage "phase_timeout"
    And the state file for adwId "resume-639-3" is seeded with a resume attempt count of 3
    And the resume bound is set to 3
    When the resume policy is applied to the resumable workflow for adwId "resume-639-3" on issue 6392
    Then the state file for adwId "resume-639-3" records workflowStage "human_gated"
    And the mock GitHub API recorded a comment on issue 6392
    And the human-gated escalation comment for issue 6392 names the resume-cap cause
    And the mock GitHub API recorded a comment containing the text "## Retry"

  # ── §4 human_gated is the money-fire backstop — cron never re-fires it (AC2) ─
  #
  # Once a workflow has been escalated, the cron backlog sweep must leave it
  # alone — it is neither re-spawned nor re-resumed, no matter how long it has sat
  # idle. This is the spend-stopping point of the whole feature and the direct
  # mirror of feature-527 §4 (merge_blocked excluded) and feature-636 §1
  # (human_gated merge_blocked excluded).

  @adw-639 @adw-11ormi-feat-bounded-resume
  Scenario: The cron backlog filter leaves a human_gated workflow out of the sweep
    Given a backlog issue 6393 idle past the cron grace period whose latest ADW run is recorded at stage "human_gated"
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter excludes the issue from the sweep

  # ── §5 ## Retry re-arms the counter and lifts the gate (AC3) ───────────────
  #
  # The human re-entry. A `## Retry` on a human_gated issue resets the durable
  # resume counter to zero and lifts the gate, so the standard resumable recovery
  # can run again — mirroring feature-527 §5's merge_blocked → awaiting_merge
  # reset and counter clear.

  @adw-639 @adw-11ormi-feat-bounded-resume
  Scenario: ## Retry on a human_gated workflow re-arms the resume counter and lifts the gate
    Given an issue 6394 exists in the mock issue tracker
    And issue 6394 carries an ADW comment naming adwId "resume-639-4"
    And a state file exists for adwId "resume-639-4" at stage "human_gated"
    And the state file for adwId "resume-639-4" is seeded with a resume attempt count of 3
    And issue 6394 has a comment whose body is "## Retry"
    When the "## Retry" directive is processed for issue 6394
    Then the state file for adwId "resume-639-4" records a resume attempt count of 0
    And the state file for adwId "resume-639-4" no longer records workflowStage "human_gated"

  # ── §6 Type-check backstop ────────────────────────────────────────────────
  #
  # The new `human_gated` stage, the `resumeAttempts` state field, and the resume
  # policy module keep the ADW codebase type-clean — the #636 `never`
  # exhaustiveness guard still holds with the new stage classified. A backstop,
  # consistent with feature-527 §7, feature-636 §11, and feature-637 §6.

  @adw-639 @adw-11ormi-feat-bounded-resume
  Scenario: The ADW TypeScript type-check passes with the resume cap and human_gated stage wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
