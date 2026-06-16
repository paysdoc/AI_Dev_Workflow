@adw-582 @adw-i64axx-hermeticity-resolve
Feature: Hermeticity, resolve app-code editing & goal-fidelity guards — Gherkin freeze, capped hard-fail, @regression gate, post-resolve re-validation

  Issue #582 is the goal-fidelity / hermeticity slice of the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Implementation Decisions →
  Hermeticity, resolve, and goal fidelity). It governs the SCENARIO RESOLVE loop so
  that a non-hermetic UI app can be made testable in-loop WITHOUT letting the loop
  game the gate: the resolve agent may now edit app code (to reach the app-owned
  hermetic test mode), but the Gherkin contract is frozen, the loop is capped and
  hard-fails on exhaustion, and every re-run is gated by `@regression` plus a
  post-resolve re-validation of the scenarios against the issue body.

  Relationship to the blockers (#579, #580): #578 laid the structured-report rail and
  the orchestrator-level scenario→fix retry loop; #579 made step-def GENERATION
  polymorphic on the descriptor; #580 surfaced the PROOF (screenshot harvest + inline
  PR comment). #582 is the layer that GOVERNS the resolve loop those slices feed:
  WHAT it may edit (app code + step defs yes, `.feature` no), WHEN it must stop (the
  existing `MAX_TEST_RETRY_ATTEMPTS` budget → hard-fail on exhaustion), and WHAT it
  must re-check before declaring success (`@regression` on every re-run, plus issue
  re-validation post-resolve). The observable delta #582 adds — and that #578–#580 did
  NOT pin — is this resolve-loop governance, expressed as two pure decision surfaces.

  Two pure deep modules carry the behaviour, mirroring the existing `computeTestVerdict`
  (`adws/core/testVerdict.ts`) pure-decision precedent, and they are what these
  scenarios pin:

    • FREEZE GUARD. Given the set of files a single resolve attempt changed, the guard
      resolves a verdict over the resolve EDIT BOUNDARY: app-code and step-def edits are
      PERMITTED (the new app-code affordance that lets a non-hermetic app be fixed
      in-loop), while ANY Gherkin `.feature` edit REJECTS the whole attempt — the
      scenario contract is frozen during resolve. The guard names the frozen file it
      tripped on, and a single `.feature` edit taints an attempt even when bundled with
      otherwise-permitted edits, so the freeze cannot be circumvented by mixing.
    • RESOLVE VERDICT. Given a resolve re-run's signals — whether the target
      `@adw-{N}` scenarios pass, whether the `@regression` suite passes, whether the
      post-resolve re-validation finds the scenarios aligned with the issue — and the
      existing `MAX_TEST_RETRY_ATTEMPTS` budget state, the verdict resolves to
      `pass | retry | hard-fail`. It mirrors `computeTestVerdict`'s shape, swapping
      `warn` for `retry` because the resolve loop iterates rather than warns. The
      re-validation `aligned` signal is the existing `validationAgent`'s
      `ValidationResult.aligned` (`adws/agents/validationAgent.ts`), applied
      post-resolve against the ISSUE BODY rather than the plan; the gate consumes that
      boolean.

  The behavioural contract pinned below:

    1. FREEZE — GHERKIN `.feature` FROZEN DURING RESOLVE (AC2). A resolve attempt that
       changed a `.feature` file is rejected and the guard names the frozen file. The
       scenario contract cannot be edited by the resolve loop.
    2. PERMIT — APP CODE + STEP DEFS ARE EDITABLE (AC1, app-code affordance). A resolve
       attempt confined to app-code and step-def edits is permitted — the new
       affordance that lets the loop edit app code to reach the app-owned hermetic test
       mode, alongside the step defs it could always touch.
    3. TAINT — ANY `.feature` EDIT TAINTS AN OTHERWISE-PERMITTED ATTEMPT (AC2). An
       attempt that bundles a legitimate app-code fix with a `.feature` edit is still
       rejected, and the guard flags the `.feature` — the freeze cannot be circumvented
       by mixing a scenario edit into a permitted change set.
    4. CAP — CAPPED BY THE EXISTING BUDGET, HARD-FAIL ON EXHAUSTION (AC1, cap). A
       still-failing re-run RETRIES while the `MAX_TEST_RETRY_ATTEMPTS` budget has
       attempts left, and HARD-FAILS once the budget is exhausted. (Delta: today the
       loop exhausts and silently falls through to the review phase — `adwSdlc.tsx`
       lines 89–99 — never blocking; #582 makes exhaustion a hard fail.)
    5. REGRESSION GATE — `@regression` IS LOAD-BEARING ON EVERY RE-RUN (AC4). A re-run
       whose target scenarios pass but whose `@regression` suite fails is NOT a pass; it
       retries while the budget allows and hard-fails once exhausted — exactly as a
       still-failing target would. A fix that greens the target by breaking a regression
       cannot be banked.
    6. RE-VALIDATION — POST-RESOLVE ISSUE-ALIGNMENT GATES THE PASS (AC3). An otherwise-
       green re-run (target + `@regression` both pass) resolves to `pass` only when the
       post-resolve re-validation finds the scenarios aligned with the issue.
    7. GAMING GUARD — A GREEN-BUT-MISALIGNED RUN HARD-FAILS REGARDLESS OF BUDGET (AC3).
       A re-run that is target-green and regression-green but whose post-resolve
       re-validation finds the scenarios MISALIGNED with the issue hard-fails even with
       attempts remaining: the loop cannot bank a goal-drifted green, and — the
       `.feature` being frozen — there is nothing to retry, so misalignment escalates to
       the human (the issue's `hitl` label).
    8. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the freeze
       guard and resolve verdict land.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime over INPUT
    test data the step constructs — never the text, shape, or existence of a source
    file of this repo:

      • §1 asserts the verdict the freeze guard RESOLVES over a changed-path list the
        step supplies as INPUT path STRINGS (exactly as feature-580 §1–§3 feed the
        harvester a temp fixture set and feature-579 §1 feeds a descriptor docstring).
        The guard classifies the supplied path strings (a `.feature` path vs an
        app-code / step-def path) and the PRODUCED verdict (permitted/rejected + the
        flagged frozen file) is the assertion target — no source file of this repo is
        read, stat-ed, or matched. The paths are illustrative INPUT, not real files.
      • §2–§3 assert the verdict the resolve helper COMPUTES over canned re-run signals
        — the target/`@regression` pass-fail booleans, the post-resolve alignment
        boolean, and the budget state — all INPUT, exactly as `testVerdict.test.ts` is
        table-driven over `(enabled, hasFailures, testcaseCount, frameworkDetected)` and
        as feature-580 §4–§8 feed a canned summary tally. The produced verdict is the
        assertion target.
      • §4 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule, or is a
    non-hermetic prompt/integration property — see Scope notes): that
    `resolve_failed_scenario.md` contains (or no longer contains) any particular
    instruction; that `adwSdlc.tsx` calls the verdict or guard, or wires exhaustion to a
    hard fail; that the build/implement prompt's definition-of-done mentions the
    hermetic test mode; that a freeze-guard or resolve-verdict module file exists, is
    imported, or is named anything in particular; or any substring/AST match against a
    prompt or source file. No step reads any source file of this repo as text,
    substring-matches its contents, or parses it as JSON/AST.

  Scope notes:

    • AC5 ("build-agent definition-of-done includes the app's hermetic test mode") lives
      entirely in the BUILD/implement PROMPT's definition-of-done — there is no code
      surface to assert against, so, like feature-579's AC3 (cucumber-bootstrap removal)
      and AC5 (`adw_init` Gherkin-only emission), it is a prompt-owned property deferred
      to the prompt rewrite + the `pr_review` reviewer + the live run. Its observable
      safeguard is §1–§3: the resolve loop's edit boundary is pinned (app code permitted
      so a non-hermetic app CAN be fixed in-loop; `.feature` frozen so the fix cannot
      weaken the contract), so even though hermeticity is the app's responsibility, the
      loop's governance of it is pinned hermetically.
    • AC3's SEMANTIC judgement — does a now-green scenario still faithfully validate the
      issue's intent? — is the existing `validationAgent`'s Claude-driven verdict
      (`ValidationResult.aligned`). Like feature-579's AC5 and feature-580's AC2 (real
      R2), that non-deterministic judgement is an integration/manual property deferred to
      the agent + live run. What IS pinned here is the resolve GATE's CONSUMPTION of that
      verdict: an `aligned`-false-but-green re-run hard-fails (§3, gaming guard) — the
      decision over the boolean, not the judgement that produces it.
    • The app-code-editing AFFORDANCE itself (the resolve agent actually editing
      implementation code) lives in `resolve_failed_scenario.md` and the test-retry
      coordinator prompt; proving "the agent edits app code" requires running the
      non-deterministic resolve agent and is deferred. §1–§3 pin its observable boundary
      (the guard PERMITS app-code paths and REJECTS `.feature` paths) — the rail the
      affordance runs on.
    • The orchestrator wiring (`adwSdlc.tsx`: exhaustion → hard fail; the freeze applied
      around each `executeScenarioFixPhase` call) is pinned via the pure verdict (§2) and
      guard (§1) the orchestrator consumes, NOT via an orchestrator subprocess. An
      end-to-end subprocess scenario would need a full failing-then-exhausting resolve
      run under the claude-cli stub — heavier than the contract requires, and the
      `computeTestVerdict` precedent likewise pins the decision, not the orchestrator
      branch that consumes it. The exhaustive verdict / guard tables (every path
      classification, every input combination) are the implementer's unit tests under
      `adws/core/__tests__/`, exactly as feature-579 split its exhaustive
      name→extension table out to `stepDefDetection.test.ts`.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    resolve-edit-boundary or resolve-verdict phrase; its Given/When/Then rows are all
    orchestrator-subprocess / phase-import / mock-query shapes). The gap is surfaced to
    the maintainer in the agent Output:
      • `a resolve attempt changed the app-code file {string}`
      • `a resolve attempt changed the step-def file {string}`
      • `a resolve attempt changed the Gherkin feature file {string}`
      • `the resolve freeze guard evaluates the attempt`
      • `the resolve freeze guard permits the attempt`
      • `the resolve freeze guard rejects the attempt`
      • `the resolve freeze guard flags the frozen Gherkin file {string}`
      • `the resolve re-run's target scenarios {string}`
      • `the resolve re-run's @regression suite {string}`
      • `the post-resolve re-validation against the issue {string}`
      • `the resolve retry budget {string}`
      • `the resolve verdict is computed`
      • `the resolve verdict is {string}`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Freeze guard — the resolve edit boundary ────────────────────────────────
  #
  # The guard resolves a verdict over the files a single resolve attempt changed
  # (INPUT path strings the step supplies). App-code and step-def edits are permitted
  # — the new affordance that lets the loop fix a non-hermetic app in-loop (AC1) and
  # the step defs it could always touch — while any Gherkin `.feature` edit rejects
  # the attempt and names the frozen file (AC2). A `.feature` edit taints an attempt
  # even when bundled with permitted edits, so the freeze cannot be circumvented.

  @adw-582 @adw-i64axx-hermeticity-resolve
  Scenario: A resolve attempt confined to app code and step defs is permitted
    Given a resolve attempt changed the app-code file "src/checkout/payment.ts"
    And a resolve attempt changed the step-def file "features/step_definitions/checkout.steps.ts"
    When the resolve freeze guard evaluates the attempt
    Then the resolve freeze guard permits the attempt

  @adw-582 @adw-i64axx-hermeticity-resolve
  Scenario: A resolve attempt that edits a Gherkin .feature is rejected as a frozen-contract violation
    Given a resolve attempt changed the Gherkin feature file "features/per-issue/feature-582.feature"
    When the resolve freeze guard evaluates the attempt
    Then the resolve freeze guard rejects the attempt
    And the resolve freeze guard flags the frozen Gherkin file "features/per-issue/feature-582.feature"

  @adw-582 @adw-i64axx-hermeticity-resolve
  Scenario: A .feature edit bundled with a permitted app-code fix still taints the whole attempt
    Given a resolve attempt changed the app-code file "src/checkout/payment.ts"
    And a resolve attempt changed the Gherkin feature file "features/checkout.feature"
    When the resolve freeze guard evaluates the attempt
    Then the resolve freeze guard rejects the attempt
    And the resolve freeze guard flags the frozen Gherkin file "features/checkout.feature"

  # ── §2 Resolve verdict — cap on exhaustion + @regression as a per-re-run gate ───
  #
  # The verdict resolves over a re-run's signals plus the existing
  # MAX_TEST_RETRY_ATTEMPTS budget state (canned INPUT, exactly as testVerdict.test.ts
  # is table-driven). Rows 1–2 pin the CAP (AC1): a still-failing target retries while
  # the budget has attempts left and hard-fails once exhausted — the delta from today,
  # where exhaustion silently falls through to review. Rows 3–4 pin the @regression
  # GATE (AC4): a target-green re-run whose @regression suite fails is "not green" and
  # follows the same retry-then-hard-fail-by-budget path — a fix that breaks a
  # regression cannot be banked. (Post-resolve re-validation is consulted only on an
  # otherwise-green run — §3 — so it is not a variable here.)

  @adw-582 @adw-i64axx-hermeticity-resolve
  Scenario Outline: A not-green resolve re-run retries within budget and hard-fails once exhausted
    Given the resolve re-run's target scenarios "<target>"
    And the resolve re-run's @regression suite "<regression>"
    And the resolve retry budget "<budget>"
    When the resolve verdict is computed
    Then the resolve verdict is "<verdict>"

    Examples:
      | target | regression | budget    | verdict   |
      | fail   | pass       | remaining | retry     |
      | fail   | pass       | exhausted | hard-fail |
      | pass   | fail       | remaining | retry     |
      | pass   | fail       | exhausted | hard-fail |

  # ── §3 Resolve verdict — post-resolve re-validation against the issue ───────────
  #
  # Once a re-run is otherwise green (target + @regression both pass), the scenarios
  # are re-validated against the ISSUE BODY via the existing validationAgent, and the
  # gate consumes its `aligned` verdict. Aligned → pass (the only path to pass). A
  # green-but-MISALIGNED run hard-fails even with attempts remaining (the gaming guard,
  # AC3): the loop cannot bank a goal-drifted green and — the `.feature` being frozen —
  # there is nothing to retry, so it escalates to the human (the `hitl` label).

  @adw-582 @adw-i64axx-hermeticity-resolve
  Scenario: A green re-run that re-validates as aligned with the issue passes
    Given the resolve re-run's target scenarios "pass"
    And the resolve re-run's @regression suite "pass"
    And the post-resolve re-validation against the issue "aligned"
    And the resolve retry budget "remaining"
    When the resolve verdict is computed
    Then the resolve verdict is "pass"

  @adw-582 @adw-i64axx-hermeticity-resolve
  Scenario: A green re-run that re-validates as misaligned with the issue hard-fails despite remaining budget
    Given the resolve re-run's target scenarios "pass"
    And the resolve re-run's @regression suite "pass"
    And the post-resolve re-validation against the issue "misaligned"
    And the resolve retry budget "remaining"
    When the resolve verdict is computed
    Then the resolve verdict is "hard-fail"

  # ── §4 Type-check backstop ──────────────────────────────────────────────────────

  @adw-582 @adw-i64axx-hermeticity-resolve
  Scenario: TypeScript type-check passes after the freeze guard and resolve verdict land
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
