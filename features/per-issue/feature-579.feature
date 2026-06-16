@adw-579 @adw-bfdyaj-polymorphic-step-def
Feature: Polymorphic step-def generation on the descriptor — framework-name → step-def runtime, Gherkin scenario format invariant

  Issue #579 is the generation-polymorphism slice of the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Implementation Decisions →
  Architecture & Prompts modified). It makes BDD generation language-agnostic by
  branching the generation prompts on the descriptor (`## BDD Framework` /
  `## Step Def Directory` in `.adw/scenarios.md`) rather than on hardcoded
  cucumber-js/TypeScript assumptions, and removes `scenario_writer`'s
  cucumber-bootstrap-on-N/A behaviour.

  Relationship to the blocker (#578): #578 built the structured-report rail and
  de-hardwired step-def DETECTION so it keys off an EXPLICITLY-supplied directory +
  extension list (feature-578 §6–§8 inject `[".py"]` / `[".ts"]` directly). #579 is
  the layer above: the extension and directory are now RESOLVED FROM THE DESCRIPTOR's
  BDD-framework NAME, so the same generation/proof path serves any Gherkin runtime
  without a per-language branch. The observable contract #579 adds — and that #578
  did NOT pin — is the descriptor → framework-name → step-def-runtime resolution, end
  to end, keyed off the parsed descriptor (never off an injected extension).

  The behavioural contract pinned below:

    1. PARSE — DESCRIPTOR RESOLUTION (AC1). The scenarios descriptor resolves a
       `bddFramework` and a `stepDefDirectory`. A Python descriptor declaring
       `pytest-bdd` + `features/steps` resolves to exactly those; a descriptor with
       NEITHER section resolves to the backward-compatible defaults (empty framework,
       `features/step_definitions`) so today's cucumber-js target does not regress.
       This is the descriptor the polymorphic generation reads.
    2. POLYMORPHISM — FRAMEWORK NAME → STEP-DEF RUNTIME (AC2, AC4). The descriptor's
       BDD-framework NAME resolves to the step-def file extension(s) the generation
       targets: `pytest-bdd`/`behave` → `.py` (the AC2 "verified against
       Python/pytest-bdd" case), `godog` → `.go`, `cucumber-ruby` → `.rb`,
       `cucumber-rs` → `.rs`, `cucumber-js` → `.ts`. Several distinct Gherkin runtimes
       resolve through ONE descriptor-driven path — the observable face of
       "polymorphic on the descriptor."
    3. POLYMORPHISM — BACKWARD-COMPATIBLE / GRACEFUL DEFAULT (AC1, AC2). An empty
       framework (today's cucumber-js target) and any not-yet-mapped framework name
       both resolve to `.ts`, so existing TypeScript targets keep working and an
       unrecognised name degrades gracefully rather than failing detection.
    4. END-TO-END — DESCRIPTOR-DRIVEN DETECTION FOR A NON-TS SUITE (AC2, AC4). The
       WHOLE path threaded from the descriptor: a Python descriptor (`pytest-bdd` +
       `features/steps`) drives detection of a `.py` step-def suite in the CONFIGURED
       directory; the default descriptor drives detection of a `.ts` suite in
       `features/step_definitions`. The extension AND the directory are resolved from
       the parsed descriptor — not injected (the #578 → #579 delta) — proving the
       generation/proof path is descriptor-driven for a non-TypeScript language.
    5. INVARIANT — SCENARIOS STAY GHERKIN REGARDLESS OF LANGUAGE (AC6). The
       polymorphism is confined to the step-def RUNTIME; the scenario FORMAT is fixed
       Gherkin `.feature`. The promotion / per-issue-sweep / vocabulary subsystems
       parse Gherkin via `adws/promotion/scenarioParser.parse(content)`, which takes a
       feature document and NO `bddFramework` parameter — language-agnostic by
       construction. A Gherkin feature resolves its scenario + tags through that
       parser unchanged, so those subsystems stay unaffected by the target language.
    6. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       generation-polymorphism slice lands.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime over INPUT
    test data the step constructs — never the text, shape, or existence of a source
    file of this repo:

      • §1 asserts the `ScenariosConfig` that `parseScenariosMd` RESOLVES over a
        descriptor STRING the step supplies as a Gherkin docstring (INPUT test data,
        exactly as feature-578 §1 feeds canned JUnit XML and registry G6/G11 feed
        test-authored fixtures) — not a source file. The resolved framework/directory
        is the produced value.
      • §2–§3 assert the extension list `stepDefExtensionsFor` RESOLVES over a
        framework NAME, and the present/absent verdict the detector resolves over a
        step-def fixture directory the TEST creates and tears down (a temp artefact —
        the same category as feature-578 §6–§8's fixtures and registry G11/G13
        test-authored worktrees). The fixture is INPUT, NOT a source file of this repo.
      • §4 asserts the scenario list `scenarioParser.parse` RESOLVES over a Gherkin
        feature STRING the step supplies as a docstring (INPUT) — the produced
        scenario name + tags are the assertion target, never any source file's text.
      • §6 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule, or is
    a non-hermetic prompt/integration property — see Scope notes):
    that `scenario_writer.md` / `generate_step_definitions.md` contain (or no longer
    contain) any particular instruction, that `adw_init.md` emits any particular
    section, or any substring/AST match against a prompt file. No step reads any
    source file of this repo as text, substring-matches its contents, or parses it as
    JSON/AST.

  Scope notes:

    • AC3 ("cucumber-bootstrap-on-N/A removed from `scenario_writer`") is the ABSENCE
      of a runtime behaviour in a Claude-driven prompt. It is NOT a hermetic scenario:
      proving "the agent does not bootstrap Cucumber" requires running the
      non-deterministic scenario-writer agent. Its observable safeguard is §1/§3's
      backward-compatible default — the descriptor path no longer presumes cucumber-js,
      so an empty framework still resolves and detects without any bootstrap. The
      removal itself is owned by the prompt rewrite + the `pr_review` reviewer.
    • AC5 ("`adw_init` only ever emits a Gherkin-based `bddFramework`; falls back to a
      Gherkin runner; flags via the unverified channel") lives entirely in the
      `adw_init.md` PROMPT, which relies on Claude's knowledge of the named framework
      ("no enum, no code provider"). There is no code surface to assert against, so —
      like feature-578's AC4 (regression-suite-green), deferred to the live run — it is
      an integration/manual property, not pinned hermetically here.
    • AC4 ("adding a new language requires no framework code change") applies to the
      GENERATION prompts (descriptor-driven, prompt-owned, deferred above). The
      DETECTION helper `stepDefExtensionsFor` carries a convenience name→extension map
      with a `.ts` fallback (§3): a brand-new runtime detects via that fallback (or a
      one-line map entry) while generation itself stays code-change-free. §2 pins a
      representative multi-language subset; the EXHAUSTIVE name→extension table is the
      implementer's unit test (`adws/core/__tests__/stepDefDetection.test.ts`), exactly
      as feature-578 split its exhaustive parser table out to unit tests.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    descriptor-parse, framework→extension, or Gherkin-parse phrase). The gap is
    surfaced to the maintainer in the agent Output:
      • `the scenarios descriptor is parsed` (+ docstring)
      • `the resolved BDD framework is {string}`
      • `the resolved step-def directory is {string}`
      • `the step-def runtime extension is resolved for BDD framework {string}`
      • `the resolved step-def extensions include {string}`
      • `the scenarios descriptor is provided` (+ docstring)
      • `a step-def file {string} exists in the target worktree`
      • `step-def presence is resolved from the parsed descriptor over the worktree`
      • `the descriptor-driven step-def presence is {string}`
      • `the promotion scenario parser parses the Gherkin feature` (+ docstring)
      • `the promotion parser resolves {int} Gherkin scenario(s)`
      • `the resolved Gherkin scenario is named {string}`
      • `the resolved Gherkin scenario carries the tag {string}`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Parse — the descriptor resolves a framework + step-def directory ─────────
  #
  # parseScenariosMd resolves the bddFramework and stepDefDirectory the polymorphic
  # generation reads. The Python descriptor resolves both explicitly; a descriptor
  # with neither section resolves the backward-compatible defaults (cucumber-js
  # target unchanged).

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario: A Python descriptor resolves its BDD framework and step-def directory
    When the scenarios descriptor is parsed
      """
      ## BDD Framework
      pytest-bdd

      ## Step Def Directory
      features/steps
      """
    Then the resolved BDD framework is "pytest-bdd"
    And the resolved step-def directory is "features/steps"

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario: A descriptor with no framework sections falls back to the cucumber-js/TS defaults
    When the scenarios descriptor is parsed
      """
      ## Scenario Directory
      features/
      """
    Then the resolved BDD framework is ""
    And the resolved step-def directory is "features/step_definitions"

  # ── §2 Polymorphism — framework name → step-def runtime extension ───────────────
  #
  # The descriptor's framework NAME (not an injected extension — the #578 → #579
  # delta) resolves to the step-def runtime the generation targets. Several distinct
  # Gherkin runtimes resolve through one descriptor-driven path. Representative
  # subset; the exhaustive table lives in stepDefDetection.test.ts (see Scope notes).

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario Outline: The descriptor's BDD-framework name resolves to its step-def runtime extension
    When the step-def runtime extension is resolved for BDD framework "<framework>"
    Then the resolved step-def extensions include "<extension>"

    Examples:
      | framework     | extension |
      | pytest-bdd    | .py       |
      | behave        | .py       |
      | godog         | .go       |
      | cucumber-ruby | .rb       |
      | cucumber-rs   | .rs       |
      | cucumber-js   | .ts       |

  # ── §3 Polymorphism — backward-compatible / graceful default ────────────────────
  #
  # An empty framework (today's cucumber-js target) and any not-yet-mapped framework
  # both resolve to .ts: existing TypeScript targets keep working, and an unrecognised
  # name degrades gracefully rather than failing detection.

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario: An empty BDD framework resolves to the TypeScript step-def runtime (backward compatible)
    When the step-def runtime extension is resolved for BDD framework ""
    Then the resolved step-def extensions include ".ts"

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario: An unrecognised BDD framework degrades gracefully to the TypeScript runtime
    When the step-def runtime extension is resolved for BDD framework "some-future-framework"
    Then the resolved step-def extensions include ".ts"

  # ── §4 End-to-end — descriptor-driven detection for a non-TS suite ──────────────
  #
  # The whole path threaded from the descriptor: parse → derive extension from the
  # framework name → detect a suite in the CONFIGURED directory. The Python descriptor
  # detects a .py suite under features/steps; the default descriptor detects a .ts
  # suite under features/step_definitions. Both resolve extension AND directory from
  # the parsed descriptor — not injected.

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario: A Python descriptor drives detection of a .py step-def suite in its configured directory
    Given the scenarios descriptor is provided
      """
      ## BDD Framework
      pytest-bdd

      ## Step Def Directory
      features/steps
      """
    And a step-def file "features/steps/test_calculator.py" exists in the target worktree
    When step-def presence is resolved from the parsed descriptor over the worktree
    Then the descriptor-driven step-def presence is "present"

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario: The default descriptor drives detection of a .ts step-def suite (backward compatible)
    Given the scenarios descriptor is provided
      """
      ## Scenario Directory
      features/
      """
    And a step-def file "features/step_definitions/calculator.steps.ts" exists in the target worktree
    When step-def presence is resolved from the parsed descriptor over the worktree
    Then the descriptor-driven step-def presence is "present"

  # ── §5 Invariant — scenarios stay Gherkin regardless of target language ─────────
  #
  # The promotion / per-issue-sweep / vocabulary subsystems parse Gherkin via
  # scenarioParser.parse(content), which takes a feature document and NO bddFramework
  # parameter. A Gherkin feature resolves its scenario + tags through that parser
  # unchanged, so those subsystems are unaffected by the configured step-def runtime.

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario: The promotion scenario parser resolves a Gherkin feature with no framework input
    When the promotion scenario parser parses the Gherkin feature
      """
      Feature: Sample target-repo behaviour
        @example-579 @regression
        Scenario: A sample observable behaviour holds
          Given a precondition
          When an action occurs
          Then an observable outcome is asserted
      """
    Then the promotion parser resolves 1 Gherkin scenario
    And the resolved Gherkin scenario is named "A sample observable behaviour holds"
    And the resolved Gherkin scenario carries the tag "@example-579"

  # ── §6 Type-check backstop ──────────────────────────────────────────────────────

  @adw-579 @adw-bfdyaj-polymorphic-step-def
  Scenario: TypeScript type-check passes after the generation-polymorphism slice lands
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
