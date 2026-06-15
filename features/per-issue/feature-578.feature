@adw-578 @adw-u3l5q0-structured-report-ju
Feature: Structured-report (JUnit) rail — scenarioProof verdict off stdout, one parser, language-agnostic step-def detection

  Issue #578 is the structured-report slice of the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Implementation Decisions →
  Structured-report contract & Proof layer). It moves pass/fail off fragile
  stdout-regex parsing onto a machine-readable JUnit report, collapses the two
  parsers into one, and de-hardwires step-def detection from `.ts`.

  Four behaviours change in lockstep:

    • PARSE. A single `testReportParser` reads a JUnit XML report emitted by the
      runner to a known path and resolves a structured tally
      (`total` / `passed` / `failed` / `cases`). A report that discovered zero
      testcases resolves to `total 0` — the "zero tests ran" signal that kills the
      silent-green class on the report rail (PRD User story 10).
    • VERDICT. `scenarioProof` derives pass/fail from that parsed report, NOT from
      a regex over cucumber-js's human-readable stdout summary (PRD User story 9).
      The report's failure count is the single source of truth; the runner's exit
      code no longer decides the verdict on its own.
    • OVERRIDE (reconstructed). The legacy "noisy non-zero exit but clean tally"
      override — cucumber exits non-zero on post-suite noise (KPI/D1 writes,
      shutdown-hook rejections) though every scenario passed — is rebuilt in
      structured-report terms: a clean report (zero failures, at least one pass)
      overrides a non-zero runner exit to PASS. This is the cutover risk the issue
      flags HITL — it is ADW's own self-hosted `@regression` suite that relies on
      this override (PRD User story 11).
    • DETECT. Step-def presence is detected by the configured step-def directory +
      language extension, dropping the `.ts`-only gate, so a non-TypeScript BDD
      suite (pytest-bdd, godog, cucumber-ruby) is no longer skipped-as-passed
      (another silent green).

  The behavioural contract pinned below:

    1. PARSE — VALID TALLY (AC1). A JUnit report carrying passing and failing
       testcases resolves to a tally whose total/passed/failed equal the report's
       counts. This is the tally the verdict layer consumes.
    2. PARSE — ZERO TESTCASES DETECTABLE (AC1, US10). A JUnit report that
       discovered zero testcases resolves to total 0 — a discovery break is a
       detectable signal, never an empty-but-green run.
    3. VERDICT — FAILURES → FAIL (AC2). A parsed report carrying one or more
       failures resolves the scenario-proof verdict to fail.
    4. VERDICT — CLEAN REPORT OVERRIDES A NOISY EXIT → PASS (AC2, AC4). A clean
       report (zero failures, at least one pass) resolves to pass EVEN WHEN the
       runner exited non-zero: the post-suite-noise override reconstructed on the
       report rail. The report wins over the exit code.
    5. VERDICT — A REPORT FAILURE IS NOT MASKED BY A CLEAN EXIT → FAIL (AC2, AC3).
       The SAME authority, opposite direction: a parsed report carrying a failure
       resolves to fail EVEN WHEN the runner exited zero. A clean-looking process
       exit cannot mask a failing report — the silent-green kill, and the
       observable proof that the verdict derives from the parsed report, not from
       stdout/exit. §4 and §5 are one principle — the report is authoritative —
       shown in both directions.
    6. DETECT — NON-`.ts` DIRECTORY/EXTENSION (AC5). Step-def presence resolved
       over a fixture directory of `.py` step files, with the step-def directory and
       extension configured to match, resolves to present — a non-TypeScript suite
       is detected, not skipped.
    7. DETECT — EXTENSION-DRIVEN (AC5). The SAME `.py` fixture directory resolved
       with the extension configured to `.ts` resolves to absent: detection keys off
       the configured extension, not a hardcoded `.ts`. §6 and §7 are the same
       fixture with opposite extension configuration and opposite verdicts — the
       whole of AC5 in two lines.
    8. DETECT — BACKWARD-COMPATIBLE DEFAULT (US30). A `.ts` fixture directory
       resolved with today's default TypeScript configuration resolves to present,
       so an existing cucumber-js target does not regress.
    9. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       parser, verdict, and detection changes land.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime over input
    test data — never the text, shape, or existence of a source file of this repo:

      • §1–§2 assert the tally the report parser RESOLVES over a canned JUnit XML
        report. The XML is INPUT test data the step constructs (exactly as
        feature-577 §4–§7 feed a canned report summary, and as the registry rubric
        permits report counts as input) — not a source file. The resolved
        total/passed/failed is the produced value.
      • §3–§5 assert the verdict `scenarioProof` RESOLVES over a parsed report plus
        a runner exit code — both INPUT — mirroring feature-577 §4–§7's
        verdict-over-canned-report design. The produced verdict is the assertion
        target; no stdout text of any source file is read.
      • §6–§8 assert the present/absent verdict the step-def DETECTOR resolves over
        a fixture step-def directory the TEST creates and tears down (a temp
        artefact — the same category as the PRD's `proofArtifactHarvester` temp-dir
        fixtures, and as registry G11/G13 test-authored worktree fixtures). The
        fixture directory is INPUT test data, NOT a source file of this repo; the
        assertion is on the detector's VERDICT, never on whether any source file
        exists.
      • §9 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule):
    that `parseCucumberSummary` was deleted, that a `testReportParser` module file
    exists, that `scenarioProof.ts` stopped importing a stdout regex, that
    `ScenariosConfig`/`CommandsConfig` gained a `stepDefDirectory`/`bddFramework`
    field, or any substring/AST match against `scenarioProof.ts`, `projectConfig.ts`,
    or the parser module. Those source-structure facts are the implementer's unit
    tests (AC1). No step reads any source file of this repo as text, substring-matches
    its contents, or parses it as JSON/AST.

  Scope notes:

    • AC1 ("`testReportParser` handles valid/zero-testcase/malformed reports —
      unit-tested") is split as feature-577 split its AC6: the OBSERVABLE decisions
      that matter are pinned here (§1 valid tally; §2 the zero-testcase silent-green
      signal, US10), and the EXHAUSTIVE parser table — malformed/missing report,
      multiple-failure counts, per-field `cases[]` mechanics — belongs in the
      implementer's unit tests under `adws/core/__tests__/` (the "(unit-tested)"
      suffix in the AC). Malformed/missing is deliberately not a hermetic scenario:
      its only behavioural contract is "must not resolve to a passing verdict,"
      which the verdict rail (§3–§5) already enforces for any non-clean report.
    • AC3 ("`parseCucumberSummary` deleted; one parser only") is a source-structure
      fact and is therefore NOT asserted directly (see rot-prevention note). Its
      observable proxy is §3–§5: the verdict derives from the single parsed report,
      and §5 specifically guards against a re-introduced stdout/exit path masking a
      failing report.
    • AC4 ("ADW's own `@regression` suite green on the new rail") is, like
      feature-577's AC5 (real-suite execution), an INTEGRATION property: it is
      verified by the live `@regression` run actually staying green on the new rail
      (the existing `features/regression/surfaces/` suite — e.g. row-22
      adwTest-scenarioProof-happy, which advances the test orchestrator to
      `awaiting_merge` unchanged). The framework-green RISK that cutover introduces —
      the noisy-exit/clean-tally override — is pinned observably here as §4, so a
      regression in the override surfaces as a failing scenario rather than only as a
      red suite. The regression surfaces are human-owned (the `@regression` sweep is
      skipped — see below) and were not modified: row-22's observable contract is
      unchanged by the internal rail swap.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.
    • All nine sections are activatable now — pure-decision / type-check checks with
      no orchestrator subprocess — so none are PENDING on the ISSUE-3-CUTOVER W1
      driver (contrast feature-577 §8/§9, which need the orchestrator to observe the
      unverified channel). An end-to-end override through the `test` orchestrator is
      intentionally NOT added: the override fires inside `runScenarioProof` and is
      fully observable as the §4 pure decision, so an e2e variant would add fragility
      (a non-zero-exit-but-clean-report scenario subprocess is not reproducible under
      the claude-cli stub) without adding behavioural coverage.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    report-parse, scenario-proof-verdict, or step-def-detection phrase). The gap is
    surfaced to the maintainer in the agent Output:
      • `the test report is parsed from a JUnit report with {int} passing and {int} failing testcases`
      • `the test report is parsed from a JUnit report with zero testcases`
      • `the parsed report total is {int}`
      • `the parsed report passed count is {int}`
      • `the parsed report failed count is {int}`
      • `the scenario-proof verdict is resolved for a parsed report with {int} passing and {int} failing tests and a runner exit code of {int}`
      • `the resolved scenario-proof verdict is {string}`
      • `a step-def fixture directory at {string} containing {string} files`
      • `step-definition presence is resolved with configured step-def directory {string} and extension {string}`
      • `the resolved step-definition presence is {string}`

  Background:
    Given the ADW codebase is checked out

  # ── §1–§2 Parse — the JUnit tally and the zero-testcase signal ─────────────────
  #
  # The single testReportParser resolves a structured tally over a canned JUnit
  # report (INPUT test data). §2 is the silent-green kill on the report rail: a run
  # that discovered nothing is detectable as total 0, never an empty-but-green pass.

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: A valid JUnit report resolves to its passing and failing tally
    When the test report is parsed from a JUnit report with 5 passing and 1 failing testcases
    Then the parsed report total is 6
    And the parsed report passed count is 5
    And the parsed report failed count is 1

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: A JUnit report that discovered zero testcases is detectable as total zero
    When the test report is parsed from a JUnit report with zero testcases
    Then the parsed report total is 0

  # ── §3–§5 Verdict — derived from the report, the report is authoritative ────────
  #
  # scenarioProof resolves pass/fail from the parsed report, not a stdout regex. §4
  # rebuilds the noisy-exit/clean-tally override (clean report beats a non-zero
  # exit → pass — the framework-green risk this HITL issue flags). §5 is the same
  # authority in the opposite direction (a report failure beats a clean exit →
  # fail): the silent-green kill and the observable proof the verdict is not derived
  # from stdout/exit.

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: A parsed report carrying a failure resolves the scenario-proof verdict to fail
    When the scenario-proof verdict is resolved for a parsed report with 4 passing and 1 failing tests and a runner exit code of 1
    Then the resolved scenario-proof verdict is "fail"

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: A clean report overrides a noisy non-zero runner exit to pass
    When the scenario-proof verdict is resolved for a parsed report with 3 passing and 0 failing tests and a runner exit code of 1
    Then the resolved scenario-proof verdict is "pass"

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: A report failure is not masked by a clean runner exit
    When the scenario-proof verdict is resolved for a parsed report with 2 passing and 1 failing tests and a runner exit code of 0
    Then the resolved scenario-proof verdict is "fail"

  # ── §6–§8 Detect — step-def presence by configured directory + extension ────────
  #
  # The .ts-only gate is gone: detection keys off the configured step-def directory
  # and language extension. §6 finds a .py suite; §7 is the same .py fixture with
  # the extension configured to .ts → absent (extension-driven, not hardcoded);
  # §8 keeps today's default TypeScript suite detected so TS targets do not regress.

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: Step-def detection finds a non-TypeScript suite by configured directory and extension
    Given a step-def fixture directory at "features/steps" containing ".py" files
    When step-definition presence is resolved with configured step-def directory "features/steps" and extension ".py"
    Then the resolved step-definition presence is "present"

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: Step-def detection keys off the configured extension, not a hardcoded .ts
    Given a step-def fixture directory at "features/steps" containing ".py" files
    When step-definition presence is resolved with configured step-def directory "features/steps" and extension ".ts"
    Then the resolved step-definition presence is "absent"

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: Step-def detection still finds a default TypeScript suite
    Given a step-def fixture directory at "features/step_definitions" containing ".ts" files
    When step-definition presence is resolved with configured step-def directory "features/step_definitions" and extension ".ts"
    Then the resolved step-definition presence is "present"

  # ── §9 Type-check backstop ─────────────────────────────────────────────────────

  @adw-578 @adw-u3l5q0-structured-report-ju
  Scenario: TypeScript type-check passes after the structured-report rail lands
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
