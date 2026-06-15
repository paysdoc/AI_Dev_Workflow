@adw-576 @adw-y6hjbr-durable-opt-out-unit
Feature: Durable opt-out unit-test gate in `.github/adw.yml` — default-enabled, created-if-absent by adw_init, read in the normal workflow-init path

  Issue #576 moves the unit-test gate off `.adw/project.md` (regenerated and
  therefore clobbered on every `/adw_init`) and onto the durable, never-regenerated
  `.github/adw.yml` descriptor, per the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Implementation Decisions →
  Config & descriptor). `.github/adw.yml` already drives the upgrade auto-merge
  policy (`hitl`, parsed by `adws/core/adwYmlConfig.ts`); this issue extends the
  same descriptor with a `unitTests` policy and flips the default.

  Two semantics change in lockstep:

    • SOURCE. The gate is read from `.github/adw.yml` (a file that lives OUTSIDE
      `.adw/`, so `/adw_init` regeneration cannot clobber it) instead of the
      `## Unit Tests` section of the regenerated `.adw/project.md`. Reading happens
      in the NORMAL workflow-init path — every workflow that runs the unit-test
      phase — not only on framework upgrade.
    • DEFAULT. The policy is OPT-OUT: absent file, absent key, or `unitTests: true`
      all resolve to ENABLED. Only an explicit `unitTests: false` disables it. This
      is the exact inverse of the retired `project.md` gate, which defaulted to
      DISABLED (`parseUnitTestsEnabled` returned `true` only for the literal
      `enabled`). A malformed value fails SAFE — toward enabled — so a typo never
      silently switches a project's unit tests off.

  `/adw_init` writes a self-documenting, commented `.github/adw.yml` template ONLY
  when none exists, and NEVER overwrites an existing one — so a project's opt-out (or
  any other hand-edited descriptor key, such as `hitl`) survives every regeneration.

  The behavioural contract pinned below:

    1. PARSER DEFAULT (AC1, AC4). The unit-test gate resolved from descriptor
       content is ENABLED for `unitTests: true`, for any content lacking a
       `unitTests` key, for empty content, and for a malformed value; it is DISABLED
       only for an explicit `unitTests: false`. An absent `.github/adw.yml` in a
       worktree resolves to ENABLED.
    2. CREATE-IF-ABSENT (AC2). When a worktree has no `.github/adw.yml`, the
       `/adw_init` adw.yml bootstrap produces one, and the gate read back from that
       produced descriptor is ENABLED (the opt-out default the template documents).
    3. NEVER-OVERWRITE (AC2). When a worktree already carries a `.github/adw.yml`,
       the bootstrap leaves it byte-for-byte untouched, so a pre-existing
       `unitTests: false` opt-out (alongside an unrelated `hitl: true`) still reads
       back as DISABLED after the bootstrap runs.
    4. NORMAL-PATH GATE — DISABLED (AC3, AC4). A workflow whose worktree descriptor
       sets `unitTests: false` SKIPS the unit-test phase: even with a stub scripted
       to FAIL unit tests, the orchestrator exits cleanly and advances to
       `awaiting_merge`, because the failing unit tests are never run. The worktree's
       `.adw/project.md` is seeded to ENABLE unit tests, so a clean exit can only
       mean the descriptor — not `project.md` — governed.
    5. NORMAL-PATH GATE — DEFAULT-ENABLED (AC3, AC4). A workflow whose worktree has
       NO `.github/adw.yml` RUNS the unit-test phase by default: with the same
       fail-scripted stub the orchestrator exits non-zero and posts a failure
       comment. The worktree's `.adw/project.md` is seeded to DISABLE unit tests, so
       a non-zero exit can only mean the absent-descriptor default (enabled) — not
       `project.md` — governed. §4 and §5 are the same fail-scripted manifest with
       opposite outcomes decided solely by the worktree descriptor.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime or an
    artefact it writes into a test worktree — never the text of a source file of
    this repo:

      • §1 asserts the unit-test gate the descriptor PARSER RESOLVES over canned
        descriptor content (a produced value, the same category as feature-584's
        classifier resolution and the existing `hitl` parser's resolved value). The
        canned content is INPUT test data, exactly as the rubric permits.
      • §2/§3 assert artefacts the `/adw_init` adw.yml bootstrap WRITES into a temp
        test worktree — the presence of a produced `.github/adw.yml`, the gate read
        back from it, and (for never-overwrite) byte-identity of the produced file
        to its pre-invocation contents. A descriptor written into a worktree by the
        operation under test is an OUTPUT artefact, the same category the registry
        reads at T1/T15–T19 and feature-572 pins for `.adw-version`; it is NOT a
        source file of this repo. The byte-identity check is the whole-file form of
        feature-509 §3's "byte-identical to the pre-invocation contents".
      • §4/§5 assert the orchestrator subprocess exit code (`World.lastExitCode`,
        registry T5), the `workflowStage` recorded in the state file the orchestrator
        writes (registry T1 — a produced artefact), and a comment recorded by the
        mock GitHub API (registry T2) — all runtime outputs of a spawned process.
      • §6 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule): that
    `AdwYmlConfig` gains a `unitTests` field, that `parseAdwYml`/`readAdwYmlConfig`
    were edited, that the unit-test phase swapped `parseUnitTestsEnabled` for the
    descriptor reader, or any substring/AST match against `adwYmlConfig.ts`,
    `unitTestPhase.ts`, `projectConfig.ts`, or the adw.yml template. Those
    source-structure facts are the implementer's unit tests (AC5 — parser + create
    /non-overwrite). No step reads any source file of this repo as text,
    substring-matches its contents, or parses it as JSON/AST.

  Scope notes:

    • AC5 ("unit tests for the parser + create-if-absent/non-overwrite behavior") is
      the implementer's responsibility under `adws/core/__tests__/` (the home of the
      existing `adwYmlConfig.test.ts`); these scenarios pin only the observable
      behaviour, mirroring feature-584's split between unit tests and BDD scenarios.
    • The `/adw_init` adw.yml bootstrap (§2/§3) is the DETERMINISTIC create-if-absent
      step the command performs over the worktree — the same category as its existing
      deterministic `cp` of `templates/vocabulary.md.template` (adw_init.md step 7).
      The LLM-driven portions of `/adw_init` are NOT exercised here: the claude-cli
      stub cannot write `.adw/` or `.github/` files (the established harness limit
      feature-572 documents), so only the deterministic file-bootstrap is
      harness-observable.
    • The `hitl` upgrade auto-merge policy parsed from the SAME descriptor is
      unchanged and additive-safe; its scenarios (feature-543/527/540) need no edit.
      §3 carries `hitl: true` in the pre-existing descriptor purely to prove the
      never-overwrite guard preserves the WHOLE file, not just the `unitTests` key.
    • The retired `project.md` `## Unit Tests` gate is seeded OPPOSITE to the
      expected outcome in §4/§5 precisely so each scenario proves the descriptor —
      not `project.md` — now governs. Removing `parseUnitTestsEnabled` itself is a
      source-structure change covered by the implementer's unit tests, not asserted.
    • The broader PR-1 unit-test layer (drop the hardcoded `src/` gate, configurable
      `testDirectory`, JUnit report rail, zero-testcase verdict) is out of scope for
      this issue's acceptance criteria and is pinned by its own slices.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      G11 (`the worktree for adwId {string} is initialised at branch {string}`),
      G3  (`the claude-cli-stub is loaded with manifest {string}`),
      G9  (`the claude-cli-stub is loaded with fixture {string}`),
      G4  (`an issue {int} exists in the mock issue tracker`),
      G1  (`the mock GitHub API is configured to accept issue comments`),
      W1  (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
      T5  (`the orchestrator subprocess exited {int}`),
      T1  (`the state file for adwId {string} records workflowStage {string}`),
      T2  (`the mock GitHub API recorded a comment on issue {int}`),
      T22 (`the ADW TypeScript type-check passes`).

    Reused from the sibling per-issue file feature-543 (established there for the
    `hitl` descriptor, not in the registry); this file reuses its worktree-descriptor
    idiom for the new `unitTests` key:
      `the worktree for adwId {string} has no {string} file`.
    The new descriptor-seeding phrases below deliberately MIRROR feature-543's
    `a {string} file in the worktree for adwId {string} sets hitl to {bool}` idiom so
    both keys of the same descriptor share one phrasing family.

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    descriptor-parser-resolution, adw.yml-bootstrap, or unit-test-gate phrase). The
    gap is surfaced to the maintainer in the agent Output:
      • `the unit-test gate is resolved from adw.yml content {string}`
      • `the resolved unit-test gate is enabled`
      • `the resolved unit-test gate is disabled`
      • `a {string} file in the worktree for adwId {string} sets unitTests to false`
      • `a {string} file in the worktree for adwId {string} sets unitTests to false and hitl to true`
      • `a {string} file in the worktree for adwId {string} enables unit tests`
      • `a {string} file in the worktree for adwId {string} disables unit tests`
      • `the adw_init adw.yml bootstrap runs in the worktree of adwId {string}`
      • `a ".github/adw.yml" artefact exists in the worktree for adwId {string}`
      • `the ".github/adw.yml" artefact in the worktree for adwId {string} is byte-identical to its pre-invocation contents`
      • `the unit-test gate read from the worktree for adwId {string} is enabled`
      • `the unit-test gate read from the worktree for adwId {string} is disabled`

    New fail-scripted manifest required (created alongside this feature; canned agent
    interactions, not a source file). It scripts plan/build success and a unit-test
    agent that FAILS on every retry, so the unit-test phase's verdict — run vs
    skipped — is the only variable §4/§5 change:
      • `test/fixtures/jsonl/manifests/adw-unit-test-fail.json`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Parser default — opt-out semantics, fails safe toward enabled ──────────
  #
  # The descriptor parser resolves the unit-test gate over canned content. ENABLED
  # is the default for true / absent-key / empty / malformed; DISABLED only for an
  # explicit false. This is the inverse default of the retired project.md gate.

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: An explicit unitTests:false in adw.yml resolves the gate to disabled
    When the unit-test gate is resolved from adw.yml content "unitTests: false"
    Then the resolved unit-test gate is disabled

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: An explicit unitTests:true in adw.yml resolves the gate to enabled
    When the unit-test gate is resolved from adw.yml content "unitTests: true"
    Then the resolved unit-test gate is enabled

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: adw.yml content with no unitTests key resolves the gate to enabled by default
    When the unit-test gate is resolved from adw.yml content "hitl: true"
    Then the resolved unit-test gate is enabled

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: Empty adw.yml content resolves the gate to enabled by default
    When the unit-test gate is resolved from adw.yml content ""
    Then the resolved unit-test gate is enabled

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: A malformed unitTests value resolves the gate to enabled (fails safe toward running tests)
    When the unit-test gate is resolved from adw.yml content "unitTests: maybe"
    Then the resolved unit-test gate is enabled

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: An absent .github/adw.yml in a worktree resolves the gate to enabled by default
    Given the worktree for adwId "yml-576-absent" is initialised at branch "chore-576-absent"
    And the worktree for adwId "yml-576-absent" has no ".github/adw.yml" file
    Then the unit-test gate read from the worktree for adwId "yml-576-absent" is enabled

  # ── §2 Create-if-absent — adw_init writes a default-enabled descriptor ─────────
  #
  # When no descriptor exists, the adw_init bootstrap produces one, and the gate
  # read back from the produced file is ENABLED — the opt-out default the commented
  # template documents. (The template's comment text is implementation detail and is
  # deliberately not asserted; the behaviour — gate enabled — is.)

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: adw_init creates a default-enabled adw.yml when none exists
    Given the worktree for adwId "init-576-create" is initialised at branch "chore-576-create"
    And the worktree for adwId "init-576-create" has no ".github/adw.yml" file
    When the adw_init adw.yml bootstrap runs in the worktree of adwId "init-576-create"
    Then a ".github/adw.yml" artefact exists in the worktree for adwId "init-576-create"
    And the unit-test gate read from the worktree for adwId "init-576-create" is enabled

  # ── §3 Never-overwrite — a pre-existing descriptor survives byte-for-byte ──────
  #
  # When a descriptor already exists, the bootstrap leaves it byte-identical. A
  # hand-set unitTests:false opt-out (alongside an unrelated hitl:true) still reads
  # back as DISABLED — proving regeneration cannot clobber a project's policy. Had
  # the bootstrap overwritten with the default-enabled template, both the byte-
  # identity check and the disabled read-back would fail.

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: adw_init never overwrites an existing adw.yml — a unit-test opt-out survives regeneration
    Given the worktree for adwId "init-576-keep" is initialised at branch "chore-576-keep"
    And a ".github/adw.yml" file in the worktree for adwId "init-576-keep" sets unitTests to false and hitl to true
    When the adw_init adw.yml bootstrap runs in the worktree of adwId "init-576-keep"
    Then the ".github/adw.yml" artefact in the worktree for adwId "init-576-keep" is byte-identical to its pre-invocation contents
    And the unit-test gate read from the worktree for adwId "init-576-keep" is disabled

  # ── §4 Normal-path gate, disabled — descriptor opt-out skips the failing tests ─
  #
  # The decisive crossing (half one): the worktree descriptor opts OUT, so the
  # unit-test phase is skipped and the fail-scripted unit tests never run — the
  # orchestrator exits 0 and reaches awaiting_merge. project.md is seeded to ENABLE
  # unit tests, so a clean exit can only mean the descriptor (not project.md)
  # governed. Same manifest as §5; only the worktree descriptor differs.

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: A workflow whose adw.yml opts out skips the unit-test phase even when unit tests would fail
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-unit-test-fail.json"
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And an issue 7576 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "test-7576" is initialised at branch "feature-7576"
    And a ".github/adw.yml" file in the worktree for adwId "test-7576" sets unitTests to false
    And a ".adw/project.md" file in the worktree for adwId "test-7576" enables unit tests
    When the "test" orchestrator is invoked with adwId "test-7576" and issue 7576
    Then the orchestrator subprocess exited 0
    And the state file for adwId "test-7576" records workflowStage "awaiting_merge"

  # ── §5 Normal-path gate, default-enabled — absent descriptor runs the tests ────
  #
  # The decisive crossing (other half): the worktree has NO descriptor, so the
  # opt-out default (enabled) runs the unit-test phase and the fail-scripted tests
  # block the workflow — the orchestrator exits non-zero and posts a failure
  # comment. project.md is seeded to DISABLE unit tests, so a non-zero exit can only
  # mean the absent-descriptor default (not project.md) governed.

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: A workflow with no adw.yml runs the unit-test phase by default and fails on failing tests
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-unit-test-fail.json"
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And an issue 7577 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "test-7577" is initialised at branch "feature-7577"
    And the worktree for adwId "test-7577" has no ".github/adw.yml" file
    And a ".adw/project.md" file in the worktree for adwId "test-7577" disables unit tests
    When the "test" orchestrator is invoked with adwId "test-7577" and issue 7577
    Then the orchestrator subprocess exited 1
    And the mock GitHub API recorded a comment on issue 7577

  # ── §6 Type-check backstop ────────────────────────────────────────────────────

  @adw-576 @adw-y6hjbr-durable-opt-out-unit
  Scenario: TypeScript type-check passes after extending the adw.yml descriptor with the unitTests policy
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
