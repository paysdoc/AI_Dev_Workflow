@adw-583 @adw-x3qme8-python-fixture-targe
Feature: Python fixture target driven end-to-end — detect → generate → run → JUnit parse → image harvest → proof comment over a non-TypeScript target

  Issue #583 is the integration-guard slice of the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Testing Decisions →
  "Integration test: Python fixture target ... with a `@regression` scenario
  driving ADW end-to-end (detect → generate → run → JUnit parse → image harvest →
  proof comment) in the Docker runner"; User story 28). It is the representative
  guard the PRD names: every other language relies on fix-forward, but the Python
  path is verified in CI against a real fixture target, not only by live runs.

  Relationship to the blockers (#578 / #579 / #580): those three built and
  unit-pinned the deep modules of the non-TS rail over CANNED input —
  `testReportParser` over canned JUnit XML (#578 §1), the descriptor →
  step-def-runtime resolution over a descriptor docstring (#579), the
  `proofArtifactHarvester` over a temp proof dir and the `prProofPublisher` over a
  canned summary (#580). Each of them DECLINED an end-to-end orchestrator variant,
  because the full proof flow could not be reproduced through the harness at the
  time (feature-578 §-scope "an end-to-end override … is not reproducible under the
  claude-cli stub"; feature-580 scope "a PENDING e2e here would pend on
  infrastructure that is not planned"). #583 is exactly where that deferred
  end-to-end coverage lands: it threads the ALREADY-BUILT modules together over a
  REAL Python fixture target — the delta is real-fixture-run output flowing through
  the whole chain, not canned input feeding one module.

  How the end-to-end stays hermetic (and what drives it):

    • DRIVER. The chain is driven by composing the real ADW pipeline modules
      (`loadProjectConfig` → `runScenarioProof` → `readJUnitReport` →
      `harvestProofArtifacts` → `publishPrProof`) over a fixture target prepared by
      the harness's `setupFixtureRepo` (`test/mocks/test-harness.ts`), which copies
      `test/fixtures/python-app/` into a fresh temp git repo. It is NOT driven by an
      orchestrator subprocess: the `the {string} orchestrator is invoked …` driver
      (W1) is a pending stub behind the ISSUE-3-CUTOVER marker in `whenSteps.ts`, so
      an orchestrator-subprocess e2e would be permanently PENDING and prove nothing.
      Module composition over the fixture is the live, hermetic driver.
    • NO PYTHON REQUIRED IN THE IMAGE. `runScenariosByTag` runs the fixture's
      configured `## Run Scenarios by Tag` command via `shell:true` with
      `ADW_JUNIT_REPORT_PATH` / `ADW_PROOF_DIR` exported. The fixture's run command
      EMITS the JUnit report and a screenshot artefact the pipeline then consumes —
      whether via real `pytest-bdd` (the build adding Python to `test/Dockerfile`)
      or a portable POSIX-shell stand-in that writes the same artefacts (the
      established `python-flat` precedent, whose scenario command is `echo …`). The
      run-command implementation and the Docker image are owned by the fixture +
      runner wiring (AC1 / AC3); the scenarios below assert the PRODUCED artefacts
      and hold under either choice. What is exercised for real is ADW's non-TS
      detection / parse / harvest / publish path around the runner.
    • NO R2 REQUIRED. `publishPrProof` degrades gracefully when the R2 environment
      is absent (no upload, the comment still composes with the JUnit summary) and
      accepts an injectable `commenter`, so the publish stage is hermetic. Real R2
      upload + inline-embed-of-public-URL is the INTEGRATION property #580 owns over
      real Cloudflare (#580 §5/§7, AC2); it is intentionally not re-asserted here.

  The behavioural contract pinned below:

    1. DETECT (AC1, AC2). `loadProjectConfig` resolves a Python descriptor over the
       `python-app` fixture TARGET: test framework `pytest`, test directory `tests`,
       BDD framework `pytest-bdd`, step-def directory `features/steps`. This is the
       observable proof that AC1's `.adw/`-detectable manifest exists and is
       well-formed — detection RESOLVES the non-TS descriptor that drives the rest
       of the chain. (It is the real `loadProjectConfig(targetRepoPath)` detection
       entrypoint over a fixture target, the e2e complement to feature-579 §1, which
       parsed a descriptor docstring.)
    2. GENERATE — PROXY (AC2). The "generate" stage is generating the step-def
       suite in the target language's BDD runtime (the #579 polymorphic prompt). The
       LIVE generation is Claude-driven and non-hermetic (PRD Testing Decisions:
       "Not unit-tested … the polymorphic prompts"; feature-579 AC3/AC5), so the
       fixture SHIPS a `pytest-bdd` `.py` step-def suite and its observable proxy is
       descriptor-driven detection resolving that suite as PRESENT over the prepared
       fixture — the #579 path applied to a real target. This is the run's
       precondition: a present suite is what makes the run executable rather than
       skipped-as-passed.
    3. END-TO-END — RUN → PARSE → HARVEST → COMMENT (AC2, AC3). Driving ADW's
       non-TypeScript scenario-proof and proof-publish pipeline against the prepared
       fixture, in one pass:
         • RUN → PARSE: the configured BDD run command emits a JUnit report that the
           pipeline resolves to a passing tally (2 passed, 0 failed) — the report
           rail (#578) consuming a real fixture run, not canned XML.
         • HARVEST: the run wrote a screenshot into the proof directory, and the
           harvester resolves a non-empty image set including it — the harvest rail
           (#580) over a real fixture run, not a test-planted file.
         • COMMENT: the proof publisher composes and records a proof comment carrying
           the JUnit pass/fail summary — the publish rail (#580) over the real run's
           parsed report and harvested screenshot, with the GitHub sink injected.
       This single scenario is the AC's "@regression scenario exercises
       detect→generate→run→parse→harvest→comment end-to-end."
    4. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime over INPUT
    test data — never the text, shape, or existence of a source file of the system
    under test (the ADW framework code under `adws/`):

      • The `python-app` fixture under `test/fixtures/` — its `.adw/` manifest, its
        minimal app, its shipped step-def suite, its run command — is INPUT TEST
        DATA: a stand-in TARGET repository, the SAME category as the `cli-tool` and
        `python-flat` fixtures, as the `setupFixtureRepo` worktrees, as registry
        G11/G13 test-authored worktrees, and as feature-578 §6's step-def fixture
        directory. It is NOT a source file of the framework under test. The rot rule
        prohibits asserting on the framework's own source; asserting against a
        fixture TARGET's resolved/produced behaviour is explicitly permitted.
      • §1 asserts the typed `ProjectConfig` that `loadProjectConfig` RESOLVES over
        the fixture target — the produced descriptor, never "does
        `python-app/.adw/commands.md` exist" or "does it contain the substring
        pytest." The resolved framework/directory fields are the assertion target.
      • §2 asserts the present/absent VERDICT the descriptor-driven step-def detector
        RESOLVES over the prepared fixture (registry-style detector verdict, exactly
        feature-578 §6 / feature-579 §4) — never a file-existence check.
      • §3 asserts (a) the JUnit tally the pipeline RESOLVES over the report the
        fixture's run PRODUCED, (b) the image set the harvester RESOLVES over the
        proof directory the run PRODUCED, and (c) the proof-comment body the
        publisher PRODUCES — all produced artefacts (the registry permits state
        files, recorded calls, and run artefacts; a composed/recorded comment body
        is the registry T3 category). No source file of the framework is read,
        substring-matched, or parsed.
      • §4 asserts the type-checker's verdict (registry T22).

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule, or
    is a non-hermetic integration/infra property — see Scope notes): that any
    `test/fixtures/python-app/...` file or any `adws/...` module file exists or
    contains any particular text; that `setupFixtureRepo`, `proofArtifactHarvester`,
    `prProofPublisher`, or any module is imported or called in any particular way;
    that real R2 upload produced a public URL or that the comment inlines an R2
    embed (the #580 integration property); any substring/AST match against any
    source file. No step reads a framework source file as text, substring-matches
    its contents, or parses it as JSON/AST.

  Scope notes:

    • AC1 ("Python fixture target repo with its own `.adw/`-detectable manifest +
      a minimal app") is a fixture-authoring task owned by the build; its observable
      contract is §1 (the manifest detects to a Python descriptor) and §2 (the
      shipped step-def suite is detected). A bare "the fixture files exist" check is
      a prohibited file-existence assertion and is therefore not written.
    • AC3 ("Test green in the Docker runner") is satisfied by these scenarios
      PASSING under the hermetic Docker runner — a property of the run, not a
      separate assertion. The Docker image gaining whatever the fixture's run
      command needs (Python, or nothing beyond sh) is build/runner wiring; the
      scenarios assert the produced artefacts and are agnostic to it.
    • AC4 ("CI runs the fixture e2e") is a CI-configuration property (a workflow
      step invoking the runner for this tag) — infra, not behaviour, so it is owned
      by the build and not pinned hermetically here, exactly as feature-578 AC4
      (suite-green) and feature-580 AC2 (real R2) were left to integration/infra.
    • The "generate" stage's LIVE behaviour (the polymorphic generation prompt) is
      non-hermetic (PRD: not unit-tested; verified by fix-forward); §2 pins its
      observable proxy (the shipped suite detected via the descriptor) rather than
      running the non-deterministic generation agent — the feature-579 precedent.
    • An orchestrator-SUBPROCESS variant of §3 is intentionally NOT added: the W1
      `the {string} orchestrator is invoked …` driver returns `'pending'` behind the
      ISSUE-3-CUTOVER marker, so a subprocess e2e would pend permanently and add no
      coverage. The module-composition driver exercises the same detect→…→comment
      chain over the same fixture, hermetically and now (the feature-578/580
      precedent for declining a non-reproducible orchestrator e2e in favour of the
      observable pipeline).
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes. Although the issue title and
      AC2 name a "@regression" scenario, this file is written to the per-issue
      directory and is NOT tagged `@regression`; it is the candidate a maintainer
      promotes into `features/regression/` to satisfy the AC. The promotion gap is
      surfaced to the maintainer in the agent Output.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Reused from sibling per-issue features for cross-feature consistency (already
    have step definitions, not yet in the registry):
      • `the resolved test framework is {string}` (feature-577)
      • `the resolved test directory is {string}` (feature-577)
      • `the resolved BDD framework is {string}` (feature-579)
      • `the resolved step-def directory is {string}` (feature-579)
      • `the descriptor-driven step-def presence is {string}` (feature-579)

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    fixture-target detection or end-to-end-pipeline phrase). The gap is surfaced to
    the maintainer in the agent Output:
      • `the project configuration is resolved over the Python fixture target {string}`
      • `the Python fixture target {string} is prepared`
      • `step-def presence is resolved from the prepared fixture's descriptor`
      • `the non-TypeScript scenario-proof and proof-publish pipeline runs against the prepared fixture`
      • `the scenario-proof run resolves a JUnit tally of {int} passed and {int} failed`
      • `the proof run harvests {int} screenshot`
      • `the harvested screenshots include {string}`
      • `the recorded proof comment includes a pass/fail summary of {int} passed and {int} failed`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Detect — the Python descriptor resolves over the fixture target ──────────
  #
  # loadProjectConfig RESOLVES the typed descriptor that drives the non-TS chain
  # over the python-app fixture TARGET (INPUT test data). The resolved framework /
  # directory fields are the produced value — AC1's observable proxy (a detectable
  # manifest) and the chain's "detect" stage. Never a file-existence or substring
  # check on the fixture's source.

  @adw-583 @adw-x3qme8-python-fixture-targe
  Scenario: The Python fixture target's manifest detects to a pytest / pytest-bdd descriptor
    When the project configuration is resolved over the Python fixture target "python-app"
    Then the resolved test framework is "pytest"
    And the resolved test directory is "tests"
    And the resolved BDD framework is "pytest-bdd"
    And the resolved step-def directory is "features/steps"

  # ── §2 Generate (proxy) — the shipped pytest-bdd suite is detected ──────────────
  #
  # Live generation is Claude-driven / non-hermetic (PRD: not unit-tested), so the
  # fixture ships a pytest-bdd .py step-def suite; its observable proxy is the
  # descriptor-driven detector RESOLVING that suite as present over the prepared
  # fixture — the #579 path applied to a real target, and the run's precondition.

  @adw-583 @adw-x3qme8-python-fixture-targe
  Scenario: The fixture's shipped pytest-bdd step-def suite is detected via the descriptor
    Given the Python fixture target "python-app" is prepared
    When step-def presence is resolved from the prepared fixture's descriptor
    Then the descriptor-driven step-def presence is "present"

  # ── §3 End-to-end — run → parse → harvest → comment over the fixture ────────────
  #
  # The headline integration guard (AC2). ADW's non-TypeScript scenario-proof and
  # proof-publish pipeline runs against the prepared fixture in one pass: the
  # configured BDD command emits a JUnit report (RUN) the pipeline resolves to a
  # passing tally (PARSE), the run's screenshot is resolved from the proof dir
  # (HARVEST), and the publisher records a proof comment carrying the pass/fail
  # summary (COMMENT). Every Then is a produced artefact of a REAL fixture run —
  # the delta over #578/#580's canned-input module pins. R2 upload / inline embed
  # is integration-owned (#580) and not asserted hermetically.

  @adw-583 @adw-x3qme8-python-fixture-targe
  Scenario: ADW drives the Python fixture end-to-end from detection through the proof comment
    Given the Python fixture target "python-app" is prepared
    When the non-TypeScript scenario-proof and proof-publish pipeline runs against the prepared fixture
    Then the scenario-proof run resolves a JUnit tally of 2 passed and 0 failed
    And the proof run harvests 1 screenshot
    And the harvested screenshots include "calc.png"
    And the recorded proof comment includes a pass/fail summary of 2 passed and 0 failed

  # ── §4 Type-check backstop ──────────────────────────────────────────────────────

  @adw-583 @adw-x3qme8-python-fixture-targe
  Scenario: TypeScript type-check passes after the Python fixture e2e lands
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
