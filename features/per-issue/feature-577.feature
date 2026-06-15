@adw-577 @adw-zyaojl-configurable-test-di
Feature: Configurable test directory + the unit-test verdict that kills the src/ silent-green

  Issue #577 is the second slice of the unit-test layer in the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Implementation Decisions →
  Unit-test layer). #576 moved the unit-test GATE onto the durable `.github/adw.yml`
  descriptor; this issue makes the unit-test RUN itself language-agnostic and removes
  the silent-green hole that let a flat-layout (no `src/`) repo report passed on a
  suite it never executed.

  Three behaviours change in lockstep:

    • CONFIG. `.adw/commands.md` gains `testDirectory` and `testFramework`, parsed in
      the project-config loader alongside the existing command fields. Absent fields
      fall back to today's Bun behaviour, so an existing TypeScript target does not
      regress (PRD User story 30): an undeclared `testDirectory` resolves to `src`
      (the directory today's `test.md` appends via `--run src`). A flat-layout repo
      sets `testDirectory` to its own root or test folder and that value is honoured.
    • RUN. `test.md` drops the `--run src` / skip-as-passed trap and runs the
      `commands.md` test command against the configured `testDirectory`. A missing
      `src/` no longer means "skip and pass" — there is no directory-shaped escape
      hatch left.
    • VERDICT. The pass/fail decision becomes an explicit, table-driven resolution
      over `(report, frameworkDetected, enabled)` → `pass | hard-fail | warn`:
        – tests pass                       → pass
        – any failures                     → hard-fail (today's gate, preserved)
        – ZERO testcases + framework detected in deps → hard-fail
        – ZERO testcases + NO framework detected      → warn
      The two zero-testcase rows are the kill of the silent-green class: a run that
      discovers nothing can never resolve to `pass`. The warn outcome is not silent —
      it emits the unverified channel below.
    • UNVERIFIED CHANNEL. A warn / unverified outcome posts an `adw:unverified`
      PR/issue comment AND applies the `adw:unverified` label, so a frameworkless repo
      gets a loud fix-forward signal (PRD User story 21) instead of a buried log line.
      A hard-fail does NOT post the unverified channel — it blocks the workflow the
      ordinary way.

  The behavioural contract pinned below:

    1. CONFIG PARSE — EXPLICIT (AC1, AC6). A `commands.md` that declares a test
       directory and test framework resolves those exact values. This is the
       configurable seam a flat-layout (e.g. Python) target uses.
    2. CONFIG PARSE — FLAT LAYOUT HONOURED (AC2). A declared non-`src` test directory
       (a repo root `.` or a `tests/` folder) resolves to that value, so the suite
       runs where the code actually lives.
    3. CONFIG PARSE — BACKWARD-COMPATIBLE DEFAULT (AC1, US30). A `commands.md` that
       declares no test directory resolves to `src` — today's Bun behaviour — so an
       existing TypeScript target is unchanged.
    4. VERDICT — PASS. An enabled run whose report has at least one passing test and
       no failures resolves to `pass`, independent of whether a framework was
       detected.
    5. VERDICT — HARD-FAIL ON FAILURES. An enabled run whose report carries one or
       more failures resolves to `hard-fail` — the existing gate, unchanged.
    6. VERDICT — ZERO TESTCASES, FRAMEWORK DETECTED → HARD-FAIL (AC3). An enabled run
       that discovered zero testcases resolves to `hard-fail` WHEN a test framework is
       detected in dependencies: a discovery break on a repo that clearly has tests is
       a real failure, not an empty repo.
    7. VERDICT — ZERO TESTCASES, NO FRAMEWORK → WARN (AC3). The SAME zero-testcase
       report resolves to `warn` WHEN no framework is detected: a genuinely test-less
       early repo is flagged, not blocked. §6 and §7 are the same report with opposite
       framework signals and opposite verdicts — the whole of AC3 in two lines.
    8. WARN PATH EMITS THE UNVERIFIED CHANNEL (AC4). End-to-end, a default-enabled
       workflow whose worktree declares NO detected framework and whose unit run
       discovers zero testcases does NOT hard-fail (the orchestrator exits cleanly and
       advances to `awaiting_merge`) but records an `adw:unverified` comment AND an
       `adw:unverified` label on the issue.
    9. HARD-FAIL PATH STAYS SILENT ON THE CHANNEL (AC3, AC4 inverse). The SAME
       zero-testcase run on a worktree that DOES declare a detected framework hard-fails
       (non-zero exit, failure comment) and records ZERO `adw:unverified` label
       applications — the loud channel is reserved for the warn case, not every empty
       run. §8 and §9 share one manifest and differ only by the worktree's framework
       declaration.
   10. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       config-parser extension and the new verdict module land.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime or an
    artefact it writes into a test worktree — never the text of a source file of this
    repo:

      • §1–§3 assert the test directory / framework the config PARSER RESOLVES over
        canned `commands.md` content. A resolved value over canned INPUT test data is a
        produced value — the same category as feature-576's resolved unit-test gate,
        feature-584's classifier resolution, and the existing command-parser unit
        tests. The canned content is input data, not a source file of this repo.
      • §4–§7 assert the verdict the `testVerdict` decision RESOLVES over a canned
        report summary plus the framework/enabled signals — again a produced value
        over input data. The report counts are INPUT, exactly as the rubric permits.
      • §8/§9 assert the orchestrator subprocess exit code (`World.lastExitCode`,
        registry T5), the `workflowStage` recorded in the state file the orchestrator
        writes (registry T1 — a produced artefact), comments recorded by the mock
        GitHub API (registry T2/T3), and label applications recorded by the mock GitHub
        API (registry T12/T13) — all runtime outputs of a spawned process.
      • §10 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule): that
    `CommandsConfig` gains `testDirectory`/`testFramework` fields, that `parseCommandsMd`
    or `HEADING_TO_KEY` were edited, that a `testVerdict` / `testReportParser` module
    file exists, that `test.md` dropped the `--run src` line, or any substring/AST match
    against `projectConfig.ts`, `unitTestPhase.ts`, or `test.md`. Those source-structure
    facts are the implementer's unit tests (AC6). No step reads any source file of this
    repo as text, substring-matches its contents, or parses it as JSON/AST.

  Scope notes:

    • AC6 ("unit tests for the verdict logic — all branches — and config parsing") is
      the implementer's responsibility under `adws/core/__tests__/` and the verdict
      module's own `__tests__` (the home of the existing project-config parser tests).
      The exhaustive table — malformed / missing report, multiple-failure counts, the
      disabled-gate row (owned by feature-576) — plus the parser's per-field mechanics
      belong there. These scenarios pin only the observable decisions, mirroring
      feature-576's split between BDD behaviour and implementer unit tests.
    • AC5 ("running ADW's unit phase against a flat Python-style fixture actually
      executes the suite") is the PRD's Docker-runner INTEGRATION test (PRD Testing
      Decisions → Integration test; User story 28): a real pytest suite under a Python
      fixture target, driven end-to-end in the hermetic Docker runner. It is owned by
      the implementer and is out of scope for these hermetic cucumber scenarios — the
      claude-cli stub fakes the unit-test agent's result, so a stubbed orchestrator run
      cannot prove a REAL suite executed. The silent-green KILL that #577 is named for
      is pinned here where it is genuinely observable: the verdict logic (§4–§7), where
      a zero-testcase report can never resolve to `pass`, and the channel wiring
      (§8/§9).
    • §8/§9 (the unverified channel) are end-to-end through the `test` orchestrator and
      therefore PENDING until the ISSUE-3-CUTOVER lands the W1 subprocess driver
      (`features/regression/step_definitions/whenSteps.ts` currently returns
      `'pending'`), exactly as feature-576 §4/§5. They are written now as the spec; they
      activate when the harness can drive a real orchestrator.
    • The `frameworkDetected` signal is "presence of a test framework in dependencies",
      emitted by `adw_init` into the worktree config (PRD Config & descriptor). §8/§9
      drive it through the worktree's framework declaration so the same scripted
      zero-testcase manifest yields opposite outcomes — the faithful, configurable
      seam, mirroring feature-576 §4/§5's same-manifest/opposite-descriptor design.
    • The adw.yml unit-test gate from #576 is unchanged; §8/§9 carry no `.github/adw.yml`
      so the opt-out default (enabled) runs the phase. Removing the `--run src` line and
      the no-`src` skip from `test.md` is a prompt change covered by the fixture e2e and
      live fix-forward, not asserted here (the stub bypasses the prompt).

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      G3  (`the claude-cli-stub is loaded with manifest {string}`),
      G9  (`the claude-cli-stub is loaded with fixture {string}`),
      G4  (`an issue {int} exists in the mock issue tracker`),
      G1  (`the mock GitHub API is configured to accept issue comments`),
      G12 (`the mock GitHub API is configured to accept label applications`),
      G11 (`the worktree for adwId {string} is initialised at branch {string}`),
      W1  (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
      T5  (`the orchestrator subprocess exited {int}`),
      T1  (`the state file for adwId {string} records workflowStage {string}`),
      T2  (`the mock GitHub API recorded a comment on issue {int}`),
      T3  (`the mock GitHub API recorded a comment containing the text {string}`),
      T12 (`the mock GitHub API recorded an application of the {string} label on issue {int}`),
      T13 (`the mock harness recorded zero applications of the {string} label on issue {int}`),
      T22 (`the ADW TypeScript type-check passes`).

    Reused from the sibling per-issue file feature-576 / feature-543 (established there,
    not in the registry):
      `the worktree for adwId {string} has no {string} file`.

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    test-config-parse, verdict-resolution, or detected-framework phrase). The gap is
    surfaced to the maintainer in the agent Output:
      • `the test configuration is resolved from a commands.md declaring test directory {string} and test framework {string}`
      • `the test configuration is resolved from a commands.md that declares no test directory`
      • `the resolved test directory is {string}`
      • `the resolved test framework is {string}`
      • `the unit-test verdict is resolved for a report with {int} passing and {int} failing tests with the test framework signal {string}`
      • `the resolved unit-test verdict is {string}`
      • `the worktree for adwId {string} declares a detected test framework`
      • `the worktree for adwId {string} declares no detected test framework`

    New scripted manifest required (created alongside this feature; canned agent
    interactions, not a source file). It scripts plan/build success and a unit-test
    agent run that reports ZERO discovered testcases, so the verdict — warn vs
    hard-fail — is the only variable §8/§9 change:
      • `test/fixtures/jsonl/manifests/adw-unit-test-zero-testcases.json`

  Background:
    Given the ADW codebase is checked out

  # ── §1–§3 Config parse — testDirectory / testFramework with backward-compat ────
  #
  # The project-config loader resolves the new fields over canned commands.md content.
  # Explicit values pass through; a flat-layout directory is honoured; an undeclared
  # test directory falls back to today's Bun default (src) so TS targets do not
  # regress. Resolved values over canned input — produced values, not source text.

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: Explicit testDirectory and testFramework are parsed from commands.md
    When the test configuration is resolved from a commands.md declaring test directory "tests" and test framework "pytest"
    Then the resolved test directory is "tests"
    And the resolved test framework is "pytest"

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: A flat-layout repo's non-src test directory is honoured
    When the test configuration is resolved from a commands.md declaring test directory "." and test framework "pytest"
    Then the resolved test directory is "."

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: An undeclared test directory falls back to the backward-compatible Bun default
    When the test configuration is resolved from a commands.md that declares no test directory
    Then the resolved test directory is "src"

  # ── §4–§7 Verdict logic — pass / hard-fail / warn over (report, framework) ─────
  #
  # The table-driven testVerdict resolution for an ENABLED run. The two zero-testcase
  # rows (§6/§7) are the kill of the src/ silent-green: a run that discovered nothing
  # can never resolve to pass. §6 and §7 are the same 0/0 report with opposite
  # framework signals — the whole of AC3.

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: A passing report resolves the verdict to pass
    When the unit-test verdict is resolved for a report with 5 passing and 0 failing tests with the test framework signal "detected"
    Then the resolved unit-test verdict is "pass"

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: A report with failures resolves the verdict to hard-fail
    When the unit-test verdict is resolved for a report with 3 passing and 1 failing tests with the test framework signal "absent"
    Then the resolved unit-test verdict is "hard-fail"

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: Zero testcases with a detected framework resolves the verdict to hard-fail
    When the unit-test verdict is resolved for a report with 0 passing and 0 failing tests with the test framework signal "detected"
    Then the resolved unit-test verdict is "hard-fail"

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: Zero testcases with no detected framework resolves the verdict to warn
    When the unit-test verdict is resolved for a report with 0 passing and 0 failing tests with the test framework signal "absent"
    Then the resolved unit-test verdict is "warn"

  # ── §8 Warn path — the unverified channel fires, the workflow continues ────────
  #
  # End-to-end (PENDING until ISSUE-3-CUTOVER). A default-enabled workflow whose
  # worktree declares no detected framework and whose unit run discovers zero
  # testcases warns: it does NOT hard-fail (exit 0, advances to awaiting_merge) but
  # records an adw:unverified comment AND label — a loud fix-forward signal.

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: A frameworkless repo with zero discovered testcases warns and posts the adw:unverified channel
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-unit-test-zero-testcases.json"
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And an issue 5771 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And the worktree for adwId "test-5771" is initialised at branch "feature-5771"
    And the worktree for adwId "test-5771" has no ".github/adw.yml" file
    And the worktree for adwId "test-5771" declares no detected test framework
    When the "test" orchestrator is invoked with adwId "test-5771" and issue 5771
    Then the orchestrator subprocess exited 0
    And the state file for adwId "test-5771" records workflowStage "awaiting_merge"
    And the mock GitHub API recorded a comment containing the text "unverified"
    And the mock GitHub API recorded an application of the "adw:unverified" label on issue 5771

  # ── §9 Hard-fail path — same zero-testcase run, framework detected, no channel ─
  #
  # End-to-end (PENDING until ISSUE-3-CUTOVER). The SAME scripted zero-testcase
  # manifest, but the worktree declares a detected framework: the run hard-fails
  # (exit 1, failure comment) and posts ZERO adw:unverified labels. The loud channel
  # is reserved for warn, not every empty run. Opposite framework declaration to §8,
  # opposite outcome.

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: A repo with a detected framework but zero discovered testcases hard-fails without the unverified channel
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-unit-test-zero-testcases.json"
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And an issue 5772 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And the worktree for adwId "test-5772" is initialised at branch "feature-5772"
    And the worktree for adwId "test-5772" has no ".github/adw.yml" file
    And the worktree for adwId "test-5772" declares a detected test framework
    When the "test" orchestrator is invoked with adwId "test-5772" and issue 5772
    Then the orchestrator subprocess exited 1
    And the mock GitHub API recorded a comment on issue 5772
    And the mock harness recorded zero applications of the "adw:unverified" label on issue 5772

  # ── §10 Type-check backstop ────────────────────────────────────────────────────

  @adw-577 @adw-zyaojl-configurable-test-di
  Scenario: TypeScript type-check passes after adding the test-config fields and verdict module
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
