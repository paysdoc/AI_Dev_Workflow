@adw-623 @adw-19me6a-large-green-junit-re
Feature: A large all-green JUnit report parses — it is no longer falsely marked adw:unverified

  Issue #623: a fully-green unit-test suite (~1380 testcases, 0 failures) that DID
  write a valid JUnit report at `$ADW_UNIT_TEST_REPORT_PATH` was nonetheless marked
  `adw:unverified` with "no JUnit report emitted — marking unverified". On the same
  run two log lines contradicted each other: `unit tests passed!` immediately
  followed by `Unit tests unverified: no JUnit report emitted`. The verdict was
  wrong — the suite is green.

  Root cause (in `adws/core/testReportParser.ts`): on a large report `parser.parse()`
  THROWS `Entity expansion limit exceeded: <n> > 1000` — fast-xml-parser v5's
  billion-laughs guard (`maxTotalExpansions`, default 1000). Every predefined XML
  entity (`&gt;` `&amp;` `&apos;` `&lt;` `&quot;`, abundant in testcase names and
  embedded `<system-out>`) counts toward that limit, so any sufficiently large suite
  trips it. `readJUnitReport` swallows the throw to `null`, and a `null` is
  indistinguishable from "report file absent" — so a present, valid, all-green report
  is treated as if no report existed, and the verdict resolves to the `warn`
  ("unverified") outcome. These reports come from our own test runner, not untrusted
  input.

  Builds directly on feature-601, which keyed the unit verdict on JUnit-report
  presence: absent → `warn` (unverified), and present + count > 0 + no failures →
  `pass`. #601 §6 also fixed "malformed report → `warn`" on the principle that an
  unparseable report resolves through `readJUnitReport` to no report. #623 draws the
  line #601 left implicit: a VALID-BUT-LARGE report is NOT malformed — it must parse,
  so the present-green branch (→ `pass`) fires instead of being mis-routed to the
  absent/malformed branch (→ `warn`). The required outcome is that a large all-green
  report `readJUnitReport` returns NON-NULL with correct counts, so the verdict is
  `pass` and no `adw:unverified` is applied — while every existing parse behaviour is
  preserved.

  The behavioural contract pinned below:

    1. PARSE — LARGE GREEN REPORT (the acceptance guardrail). A large, all-green JUnit
       report whose entity-reference count exceeds the old 1000-expansion limit is read
       through `readJUnitReport` to a NON-NULL report with the correct
       total/passed/failed/skipped tally. A genuinely absent report still reads to no
       report — the legitimate null the fix must NOT erase.
    2. VERDICT — THE SYMPTOM FLIPS. With the large green report present, the unit-test
       verdict computed over it is `pass` and the suite is NOT marked unverified; a
       genuinely absent report still resolves to `warn` (unverified). The verdict is
       composed honestly from the real parse (`reportPresent` = the report read back is
       non-null), so it follows the real parse, not a shortcut. Against the finite-ceiling
       build the bug was reported on, the large report read to null → `warn` (RED), flipping
       to `pass` once it parses (GREEN). On the currently-installed fast-xml-parser the
       entity-expansion default is `Infinity`, so the parse already succeeds — the durable
       failing-first proof is the version-independent load-bearing contrast carried by the
       issue's required unit test, not a RED-on-current-baseline assertion here.
    3. PRESERVED PARSE BEHAVIOUR. Raising the entity-expansion ceiling changes nothing
       else: entity decoding still applies (a `&gt;` in a failure message still decodes
       to `>`), a bare `<failure/>` pending marker still classifies as skipped, both the
       `<testsuites>` wrapper and the bare `<testsuite>` shapes still parse, and
       genuinely malformed / truncated XML still returns no report — the fix did not
       weaken validation into a false green.
    4. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the parser
       change.

  Observability / rot-prevention note:

    Every assertion targets a value the system PRODUCES at runtime over INPUT test data
    the step constructs — never the text, shape, or existence of a source file of this
    repo:

      • §1/§2 build a JUnit report and write it into a temp report path, then assert the
        value `readJUnitReport` returns over it (a non-null report + its tally) and the
        verdict `computeTestVerdict` resolves from it. The report file is INPUT/artefact
        test data (the same category as feature-601 §2–§6's written reports and the
        registry rubric's "report counts as input"), NOT a source file; the produced
        report and verdict are the assertion targets. §2's verdict is composed over the
        ACTUAL parse — `reportPresent` is `readJUnitReport(...) !== null`, exactly as
        `testRetry` derives it — so the step cannot shortcut the parse: against a finite
        entity-expansion ceiling the large report reads to null → `warn` (RED); on the installed
        permissive default (`maxTotalExpansions: Infinity`) it parses, so the durable failing-first
        proof is the load-bearing contrast carried by the issue's required unit test.
      • §3 asserts the values `parseJUnitXml` RESOLVES over canned JUnit XML the step
        builds (the decoded message, the case status, the tally, and the null returned for
        malformed input) — produced values, not source text.
      • §4 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule AND the
    issue's "does NOT prescribe the fix mechanism"): that `testReportParser.ts` sets a
    `processEntities` option, that `maxTotalExpansions` / `maxEntityCount` is raised to
    `Infinity`, or any substring/AST match against `testReportParser.ts`, `testVerdict.ts`,
    or `testRetry.ts`. HOW the limit is lifted is the implementer's choice, pinned by the
    issue's required failing-first unit test in
    `adws/core/__tests__/testReportParser.test.ts`; these scenarios pin only the
    observable outcome.

  Scope notes:

    • The `adw:unverified` CHANNEL emission (the issue comment + label the `warn` verdict
      fires) is the orchestrator/phase's effect, observable only through a live run —
      deferred exactly as feature-601 §5 deferred its channel e2e. These hermetic
      scenarios pin the parse (§1, §3) and the pure verdict the channel keys off (§2);
      "no `adw:unverified`" is asserted as "the resolved verdict is `pass`, not the
      unverified outcome", its hermetic proxy.
    • The exhaustive parser table — the real ~1380-case shape, per-entity expansion
      arithmetic, `<system-out>` permutations — is the issue's required failing-first unit
      test under `adws/core/__tests__/`, mirroring how feature-601 split the observable
      decisions (pinned here) from the exhaustive table (unit-tested). §1 pins ONE
      representative large green report (500 cases, > 1000 entity refs) — enough to trip
      the old ceiling.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.
    • All sections are activatable now — pure parser/verdict decisions plus a type-check,
      no orchestrator subprocess — so none are PENDING on the regression W1 driver.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`): G18
    (`the ADW codebase is checked out`), T22 (`the ADW TypeScript type-check passes`).

    The registry has no phrase for the JUnit-parse domain (#623 is the first issue to
    pin the parser's entity-expansion behaviour). Novel phrasing is introduced and the
    gap is surfaced to the maintainer in the agent Output. The phrases are bound to this
    feature's own step context, kept distinct from feature-601's verdict phrases on
    purpose: #601's `the resolved JUnit-keyed unit verdict is {string}` is wired to
    #601's small-report ctx, so reusing it would cross-wire per-feature state under the
    globally-loaded step defs (the same caution #601 records against #577). Novel phrases:
      • `a large all-green JUnit report of {int} testcases carrying more than 1000 XML entity references is emitted to the unit-test report path`
      • `no report is emitted to the unit-test report path`
      • `the report at the unit-test report path is read`
      • `a non-null test report is returned`
      • `no test report is returned`
      • `the test report counts {int} total, {int} passed, {int} failed, and {int} skipped testcases`
      • `the unit-test verdict is computed from the report at the unit-test report path`
      • `the resolved unit verdict is {string}`
      • `the unit suite is not marked unverified`
      • `the unit suite is marked unverified`
      • `a JUnit report whose failing case carries the encoded failure message {string} is parsed`
      • `the parsed failing case decodes its failure message to {string}`
      • `a JUnit report whose only testcase carries a bare empty failure marker is parsed`
      • `that testcase is classified as skipped`
      • `a JUnit report in the {string} shape of {int} all-passing testcases is parsed`
      • `malformed JUnit XML that is {string} is parsed`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Parse — a large all-green report reads to a non-null green report ──────────
  #
  # The acceptance guardrail. A large, all-green report (> 1000 entity references —
  # enough to trip fast-xml-parser's old 1000-expansion ceiling) read through
  # readJUnitReport returns a NON-NULL report with the correct tally. The genuinely
  # absent report still reads to no report — the legitimate null the fix preserves.

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario: A large all-green JUnit report reads to a non-null report with the correct counts
    Given a large all-green JUnit report of 500 testcases carrying more than 1000 XML entity references is emitted to the unit-test report path
    When the report at the unit-test report path is read
    Then a non-null test report is returned
    And the test report counts 500 total, 500 passed, 0 failed, and 0 skipped testcases

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario: A genuinely absent report still reads to no report — the legitimate null is preserved
    Given no report is emitted to the unit-test report path
    When the report at the unit-test report path is read
    Then no test report is returned

  # ── §2 Verdict — the adw:unverified symptom flips to pass ─────────────────────────
  #
  # The observable symptom. The verdict is computed over the report ACTUALLY read back
  # (reportPresent = readJUnitReport(...) !== null, as testRetry derives it), so it is
  # RED against a finite entity-expansion ceiling (large report reads to null → warn) and GREEN
  # once it parses; on the installed Infinity default the parse already succeeds, so the durable
  # failing-first proof is the issue's required unit test (a version-independent contrast).
  # The absent report still resolves to warn (unverified), preserved from feature-601.

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario: A present large all-green report resolves the unit verdict to pass, not unverified
    Given a large all-green JUnit report of 500 testcases carrying more than 1000 XML entity references is emitted to the unit-test report path
    When the unit-test verdict is computed from the report at the unit-test report path
    Then the resolved unit verdict is "pass"
    And the unit suite is not marked unverified

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario: A genuinely absent report still resolves to unverified — the legitimate warn is preserved
    Given no report is emitted to the unit-test report path
    When the unit-test verdict is computed from the report at the unit-test report path
    Then the resolved unit verdict is "warn"
    And the unit suite is marked unverified

  # ── §3 Preserved parse behaviour — raising the ceiling changed nothing else ───────
  #
  # The issue's regression list. Entity decoding, the bare-<failure/> pending marker,
  # both report shapes, and rejection of genuinely malformed XML all survive the raised
  # entity-expansion ceiling — the fix did not weaken validation into a false green.

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario: Entity decoding still applies — a &gt; in a failure message decodes to >
    When a JUnit report whose failing case carries the encoded failure message "Expected 0 to be &gt; -1" is parsed
    Then a non-null test report is returned
    And the parsed failing case decodes its failure message to "Expected 0 to be > -1"

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario: A bare <failure/> pending marker still classifies as skipped, not failed
    When a JUnit report whose only testcase carries a bare empty failure marker is parsed
    Then a non-null test report is returned
    And that testcase is classified as skipped
    And the test report counts 1 total, 0 passed, 0 failed, and 1 skipped testcases

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario Outline: Both the <testsuites> wrapper and the bare <testsuite> shapes still parse
    When a JUnit report in the "<shape>" shape of 3 all-passing testcases is parsed
    Then a non-null test report is returned
    And the test report counts 3 total, 3 passed, 0 failed, and 0 skipped testcases

    Examples:
      | shape      |
      | testsuites |
      | testsuite  |

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario Outline: Genuinely malformed or truncated XML still returns no report
    When malformed JUnit XML that is "<kind>" is parsed
    Then no test report is returned

    Examples:
      | kind                  |
      | not XML at all        |
      | truncated mid-element |
      | an empty document     |

  # ── §4 Type-check backstop ───────────────────────────────────────────────────────

  @adw-623 @adw-19me6a-large-green-junit-re
  Scenario: TypeScript type-check passes after raising the JUnit entity-expansion ceiling
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
