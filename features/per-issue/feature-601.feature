@adw-601 @adw-hrl5jd-unit-test-rail-onto
Feature: Unit-test rail onto the JUnit report — verdict keyed on report presence, discovery-break hard-fail restored

  Issue #601 is PR 1 of the unit-test-layer convergence in the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Implementation Decisions →
  Structured-report contract, unit-test layer). It moves the unit-test verdict off
  the agent-eyeballed `/test` `app_tests` result — which filtered to `src/`, never
  ran the configured suite, and emitted no `testcase_count` — onto the same
  machine-readable JUnit report contract #578 built for the scenario rail. The
  verdict now keys on the JUnit report `unitTestPhase` reads via the existing
  `readJUnitReport`, not on the static `frameworkDetected` signal #577 introduced.

  Relationship to the predecessors (#577, #578): #577 made the unit verdict an
  explicit table-driven resolution over `(report, frameworkDetected, enabled)`, where
  a zero-testcase run resolved to `hard-fail` only WHEN a framework was detected in
  deps, and to `warn` otherwise. #578 then built the structured-report (JUnit) rail
  for the SCENARIO side — a single `testReportParser`, a report-derived verdict. #601
  is the unit-side convergence: it drops the `frameworkDetected` axis entirely and
  re-keys the unit verdict on JUnit-report PRESENCE + contents, exactly as the
  scenario rail does — with one deliberate divergence (report absent → unverified, no
  exit-code fallback; see §5). This SUPERSEDES the `frameworkDetected`-keyed verdict
  model feature-577 pinned in its §4–§9 (see Scope notes → Supersession).

  Restores the discovery-break hard-fail: commit `8184877` on `dev` temporarily
  demoted the zero-testcase discovery break from `hard-fail` to `warn` (a deadlock
  breaker so this very issue could ship through the self-hosted pipeline — ADW's own
  `adws/**/__tests__` suite lives outside `src/`, so the old `/test` step structurally
  reported zero and hard-failed every self-hosted run, issues #579/#580). #601
  restores it as `hard-fail`, now correctly keyed on "report present + zero testcases"
  (§3) rather than the static framework signal.

  Verdict values: the resolved verdict is one of `pass` / `hard-fail` / `warn` — the
  `TestVerdictOutcome` the resolver returns. `warn` IS the "unverified" outcome of the
  issue's table: the phase emits the unverified channel for it (an `adw:unverified`
  issue comment + the `ADW_UNVERIFIED` label). The channel emission is the phase's
  effect, observable only through the orchestrator (deferred — see Scope notes); these
  hermetic scenarios pin the pure verdict the channel keys off.

  The behavioural contract pinned below:

    1. PARSE — FAILURE-MESSAGE EXTRACTION (AC7). A JUnit report whose failing
       testcase carries a `<failure message="…">` resolves a parsed failed case that
       carries BOTH its name AND that message — the pair the retry/resolution loop
       feeds the resolver. A passing case carries no failure message, and the
       pass/fail tally is unchanged: the message field is purely ADDITIVE, so the
       scenario rail that consumes the same parser is unaffected.
    2. VERDICT — REPORT PRESENT, FAILURES → HARD-FAIL (AC1, AC5). An enabled run
       whose JUnit report carries one or more failures resolves to `hard-fail` — the
       existing gate, now derived from the report rather than the eyeballed result.
    3. VERDICT — REPORT PRESENT, ZERO TESTCASES → HARD-FAIL (AC1, AC5). An enabled
       run whose JUnit report discovered zero testcases resolves to `hard-fail` — the
       real discovery break, RESTORED here from the `warn` that commit `8184877`
       temporarily demoted, and now keyed on report-present-with-zero rather than the
       `frameworkDetected` signal. A run that discovered nothing can never resolve to
       `pass`.
    4. VERDICT — REPORT PRESENT, COUNT > 0, NO FAILURES → PASS (AC1, AC5). An enabled
       run whose JUnit report has at least one passing testcase and no failures
       resolves to `pass` — independent of any framework signal.
    5. VERDICT — REPORT ABSENT → UNVERIFIED (AC1, AC5). When NO JUnit report is found,
       the verdict resolves to `warn` (the unverified channel), regardless of the
       `/test` agent's eyeballed result. This is the unit rail's DELIBERATE divergence
       from the scenario rail: the scenario rail falls back to the runner exit code
       when no report is found; the unit rail goes to `unverified`, because the
       `/test` agent's exit signal is LLM-mediated and not trusted for gating. Honest
       verdict over fallback complexity.
    6. VERDICT — MALFORMED REPORT → UNVERIFIED (AC1, AC5, AC9). A malformed/unparseable
       report is indistinguishable from an absent one through `readJUnitReport` (it
       resolves to no report), so it resolves to `warn` — never a false `pass` and
       never a false `hard-fail`. The malformed-report case can never mask a result.
    7. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       verdict re-key, the `frameworkDetected` removal, and the `TestCaseResult`
       failure-message extension land.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime over INPUT
    test data the step constructs — never the text, shape, or existence of a source
    file of this repo:

      • §1 asserts the parsed case fields (`status`, `name`, the new failure message)
        and the tally the parser RESOLVES over a canned JUnit XML report the step
        builds — INPUT test data, exactly as feature-578 §1 feeds canned JUnit XML and
        the registry rubric permits report counts as input. The resolved case +
        message + tally is the produced value, not a source file.
      • §2–§6 assert the verdict resolved over a JUnit report the step constructs and
        reads back through `readJUnitReport` — present (with counts), present-but-zero,
        absent (a path with no file), and malformed (a file of non-XML bytes). The
        report file the step writes into a temp dir is INPUT/artefact test data (the
        same category as feature-578 §6–§8's fixtures and the rubric's "report counts
        as input"), NOT a source file of this repo; the produced verdict is the
        assertion target. No stdout/exit-code text of any source file is read.
      • §7 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule):
    that `computeTestVerdict` dropped its `frameworkDetected` field, that
    `unitTestPhase` now calls `readJUnitReport`, that `TestCaseResult` gained a
    `message` field, that `ADW_UNIT_TEST_REPORT_PATH` is added to `environment.ts`,
    that `/test` no longer appends `--run src`, that `adw_init` emits a `## Run Tests`
    section, or any substring/AST match against `unitTestPhase.ts`, `testVerdict.ts`,
    `testReportParser.ts`, `environment.ts`, `test.md`, or `adw_init.md`. Those
    source-structure facts are the implementer's unit tests (AC9). No step reads any
    source file of this repo as text, substring-matches its contents, or parses it as
    JSON/AST.

  Scope notes:

    • SUPERSESSION of feature-577's verdict model. feature-577 §4–§9 pinned the
      verdict over `(report, frameworkDetected, enabled)` — including the two
      zero-testcase rows that resolve `hard-fail` vs `warn` BY THE FRAMEWORK SIGNAL.
      #601 removes that axis: the discovery-break hard-fail is re-keyed on
      report-present-with-zero (§3) and the absent case goes to unverified (§5), so
      feature-577's framework-signal verdict scenarios encode a model #601 retires. The
      authoritative unit-verdict spec is now THIS file. feature-577's §4–§9 scenarios
      and their step definitions are reconciled by the implementer when the verdict
      signature converges (the root tsconfig type-checks `features/**/*.ts`, so the
      `frameworkDetected` removal forces that reconciliation); a supersession note is
      added to feature-577's docstring. feature-577 §1–§3 (testDirectory/testFramework
      config parse) are unaffected by #601 and stay.
    • AC2 ("`/test` no longer appends `--run src`; the unit step runs the full command
      declared in `commands.md`") is a PROMPT change in `.claude/commands/test.md`. Like
      feature-577's own note that removing the `--run src` line "is a prompt change
      covered by the fixture e2e and live fix-forward, not asserted here (the stub
      bypasses the prompt)," it is not hermetically pinnable — the claude-cli stub fakes
      the `/test` agent, so a stubbed run cannot prove the prompt dropped a flag. Owned
      by the prompt rewrite + the `pr_review` reviewer + the live run.
    • AC3 ("runner emits JUnit to `ADW_UNIT_TEST_REPORT_PATH`; var in the
      `environment.ts` allowlist") is plumbing + integration: the env-var allowlist is a
      source-structure fact (not assertable per rot-prevention), and "the runner emits
      JUnit" needs the real `/test` runner against a real suite. The env-var wiring lives
      in the step def, exactly as feature-578/580 kept `ADW_JUNIT_REPORT_PATH` /
      `ADW_PROOF_DIR` wiring out of their parse scenarios. Its OBSERVABLE proxy is §2–§6:
      the verdict is resolved over a report read from a known path, so a present report
      drives §2–§4 and an absent one drives §5.
    • AC4 ("`adw_init` writes JUnit-emitting `## Run Tests` flags from known conventions
      only when the section is absent; a pre-existing custom command is left untouched —
      and that repo's runs resolve to `unverified` when it emits no report") lives in the
      `adw_init.md` PROMPT (no code provider — Claude's knowledge of per-language
      conventions). Like feature-579's AC5 (`adw_init` only ever emits a Gherkin
      framework), the prompt-owned seeding is an integration/manual property, not pinned
      hermetically. Its OBSERVABLE proxy is §5: a repo whose untouched custom command
      emits no report resolves to `unverified` — the exact "no report → unverified"
      contract the AC names.
    • AC6 ("`lint`/`tsc`/`build` remain agent-gated, independent of the unit verdict")
      is an INVARIANT, not a swung decision: the unit verdict is resolved purely over the
      JUnit report (§2–§6), so `lint`/`tsc`/`build` are not inputs to it and remain the
      `/test` agent's responsibility, unchanged by this rail swap. There is no
      report-keyed surface to vary for them; §7 (the real `tsc` backstop) is the only
      one of the three with an observable, hermetic run.
    • AC8 ("ADW's own vitest suite under `adws/**/__tests__` runs in the unit phase and
      reports a real testcase count > 0") is the self-hosting INTEGRATION payoff,
      verified by the live unit phase on this issue's own pipeline run (where the report
      now carries the real count instead of structural zero) — like feature-577 AC5 (real
      pytest in the Docker runner) and feature-578 AC4 (the live `@regression` suite). The
      claude-cli stub fakes the `/test` agent and cannot emit a real vitest JUnit report,
      so it is not hermetically pinnable. Its OBSERVABLE proxy is §4: once the report
      exists with count > 0 and no failures, the verdict is `pass`.
    • AC9's exhaustive parser/verdict table — multiple-failure counts, the disabled-gate
      row (owned by #576), per-field `cases[]` mechanics — belongs in the implementer's
      unit tests under `adws/core/__tests__/`, mirroring how feature-577/578 split the
      observable decisions (pinned here) from the exhaustive table (unit-tested). The
      five named cases (present/absent/zero/malformed/failure-message) are each pinned
      observably: present (§2, §4), absent (§5), zero (§3), malformed (§6),
      failure-message (§1).
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.
    • All seven sections are activatable now — pure parser/verdict decisions and a
      type-check, with no orchestrator subprocess — so none are PENDING on the
      ISSUE-3-CUTOVER W1 driver. The unverified-channel emission (label + comment) is the
      orchestrator's effect and is deferred to the live run, exactly as feature-577 §8/§9
      deferred its channel e2e; the verdict the channel keys off is pinned here as §5.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Distinct from the predecessor unit-verdict file feature-577 ON PURPOSE: #601's
    verdict keys on the JUnit REPORT, not on feature-577's "test framework signal", so
    a new, non-colliding phrase set is introduced (feature-577's
    `the resolved unit-test verdict is {string}` is bound to feature-577's own
    framework-signal `ctx`; reusing it would cross-wire per-feature state under the
    globally-loaded step defs). Novel phrasing introduced here — the gap is surfaced to
    the maintainer in the agent Output:
      • `a JUnit report with a passing testcase {string} and a failing testcase {string} reporting failure message {string} is parsed`
      • `the parsed report's failed case {string} reports the failure message {string}`
      • `the parsed report's passed case {string} reports no failure message`
      • `the parsed report counts {int} passed and {int} failed`
      • `the unit-test verdict is resolved from a JUnit report with {int} passing and {int} failing testcases`
      • `the unit-test verdict is resolved from a JUnit report that discovered zero testcases`
      • `the unit-test verdict is resolved from an absent JUnit report`
      • `the unit-test verdict is resolved from a malformed JUnit report`
      • `the resolved JUnit-keyed unit verdict is {string}`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Parse — the failure-message extension (additive; scenario rail unaffected) ─
  #
  # The retry/resolution loop feeds the resolver each failing case's name + message
  # from report.cases, so the parser must carry the message on the failed case. The
  # field is purely additive: a passing case carries no message and the pass/fail
  # tally is unchanged, so the scenario rail that shares this parser is unaffected.
  # Assertions are over the values the parser RESOLVES from a canned JUnit XML report
  # the step builds (INPUT), exactly as feature-578 §1.

  @adw-601 @adw-hrl5jd-unit-test-rail-onto
  Scenario: A failing testcase carries its name and failure message for the resolver
    When a JUnit report with a passing testcase "adds two numbers" and a failing testcase "rejects a negative balance" reporting failure message "Expected 0 to be greater than -1" is parsed
    Then the parsed report's failed case "rejects a negative balance" reports the failure message "Expected 0 to be greater than -1"

  @adw-601 @adw-hrl5jd-unit-test-rail-onto
  Scenario: The failure-message field is additive — a passing case carries none and the tally is unchanged
    When a JUnit report with a passing testcase "adds two numbers" and a failing testcase "rejects a negative balance" reporting failure message "Expected 0 to be greater than -1" is parsed
    Then the parsed report's passed case "adds two numbers" reports no failure message
    And the parsed report counts 1 passed and 1 failed

  # ── §2–§4 Verdict — report PRESENT, keyed on the report's contents ───────────────
  #
  # The verdict unitTestPhase derives from the JUnit report it reads via
  # readJUnitReport. §2 the failures gate; §3 the RESTORED discovery break (report
  # present but zero testcases → hard-fail, no longer keyed on frameworkDetected — the
  # restoration of what commit 8184877 demoted to warn); §4 a clean count > 0 report
  # passes. The verdict is resolved over a report the step writes and reads back
  # (INPUT/artefact), never a source file.

  @adw-601 @adw-hrl5jd-unit-test-rail-onto
  Scenario: A report carrying failures resolves the unit verdict to hard-fail
    When the unit-test verdict is resolved from a JUnit report with 4 passing and 1 failing testcases
    Then the resolved JUnit-keyed unit verdict is "hard-fail"

  @adw-601 @adw-hrl5jd-unit-test-rail-onto
  Scenario: A report that discovered zero testcases resolves to hard-fail — the discovery break, restored
    When the unit-test verdict is resolved from a JUnit report that discovered zero testcases
    Then the resolved JUnit-keyed unit verdict is "hard-fail"

  @adw-601 @adw-hrl5jd-unit-test-rail-onto
  Scenario: A clean report with passing testcases and no failures resolves to pass
    When the unit-test verdict is resolved from a JUnit report with 6 passing and 0 failing testcases
    Then the resolved JUnit-keyed unit verdict is "pass"

  # ── §5 Verdict — report ABSENT → unverified (the divergence from the scenario rail) ─
  #
  # The unit rail intentionally diverges here: where the scenario rail falls back to
  # the runner exit code when no report is found, the unit rail goes to unverified
  # (warn) — the /test agent's exit signal is LLM-mediated and not trusted for gating.
  # This is also the observable proxy for AC3 (no report at the known path) and AC4 (a
  # repo whose untouched custom command emits no report resolves to unverified). warn
  # is the outcome that fires the adw:unverified channel (label + comment) in the phase.

  @adw-601 @adw-hrl5jd-unit-test-rail-onto
  Scenario: An absent report resolves to unverified, not to a pass off the agent's eyeballed result
    When the unit-test verdict is resolved from an absent JUnit report
    Then the resolved JUnit-keyed unit verdict is "warn"

  # ── §6 Verdict — malformed report → unverified (never a false pass or fail) ──────
  #
  # A malformed/unparseable report resolves through readJUnitReport to no report, so it
  # is treated exactly as absent: warn. A garbled report can never mask a result as a
  # pass nor manufacture a hard-fail.

  @adw-601 @adw-hrl5jd-unit-test-rail-onto
  Scenario: A malformed report resolves to unverified rather than masking a result
    When the unit-test verdict is resolved from a malformed JUnit report
    Then the resolved JUnit-keyed unit verdict is "warn"

  # ── §7 Type-check backstop ───────────────────────────────────────────────────────

  @adw-601 @adw-hrl5jd-unit-test-rail-onto
  Scenario: TypeScript type-check passes after the unit-rail re-key and the failure-message extension land
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
