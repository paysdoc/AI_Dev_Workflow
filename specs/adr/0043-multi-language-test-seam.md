---
status: accepted
date: 2026-06-15
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/multi-language-test-and-bdd-support.md
  - kind: contemporaneous
    source: specs/ADW_PYTHON_SUPPORT_RECOMMENDATION.md
  - kind: contemporaneous
    source: specs/issue-576-adw-y6hjbr-durable-opt-out-unit-sdlc_planner-adw-yml-unit-test-gate.md
  - kind: contemporaneous
    source: specs/issue-577-adw-zyaojl-configurable-test-di-sdlc_planner-configurable-test-directory.md
  - kind: contemporaneous
    source: specs/issue-578-adw-u3l5q0-structured-report-ju-sdlc_planner-junit-report-rail-migration.md
  - kind: contemporaneous
    source: specs/issue-579-adw-bfdyaj-polymorphic-step-def-sdlc_planner-descriptor-driven-generation.md
  - kind: contemporaneous
    source: specs/issue-581-adw-l8a10n-stack-coherence-chec-sdlc_planner-stack-coherence-check.md
  - kind: contemporaneous
    source: specs/issue-582-adw-i64axx-hermeticity-resolve-sdlc_planner-resolve-app-code-goal-fidelity-guards.md
  - kind: contemporaneous
    source: specs/issue-583-adw-x3qme8-python-fixture-targe-sdlc_planner-python-fixture-e2e-regression.md
  - kind: contemporaneous
    source: specs/issue-601-adw-hrl5jd-unit-test-rail-onto-sdlc_planner-unit-test-junit-report-rail.md
supersedes: []
superseded-by: []
---

# Multi-language test seam: detected descriptor, Gherkin mandate, JUnit report rail

## Context and Problem Statement

ADW was hardcoded to Bun, TypeScript, cucumber-js and a `src/` layout. Pointed at a flat-layout Python project it did not run the tests and still reported success: the PRD says it "reports green on work it never verified". The `/test` prompt skipped the suite and marked it passed when no `src/` existed; scenario proof recognised only `.ts` step definitions; pass or fail was read from cucumber-js's stdout by regex; and the unit-test flag lived in `.adw/project.md`, which is regenerated on every framework upgrade.

## Decision Drivers

* No silent green: a suite that did not run must not count as passed.
* A new language must need no change to framework code.
* Existing TypeScript targets must not regress.
* The promotion, sweep and vocabulary subsystems parse Gherkin and must keep working.

## Considered Options

* A detected descriptor in typed config, one polymorphic prompt per generation step
* A `stack` enum that switches defaults and prompts (proposed in `specs/ADW_PYTHON_SUPPORT_RECOMMENDATION.md`)
* A per-language code provider (`BddProvider` registry)
* Per-language prompt files

## Decision Outcome

Chosen option: "detected descriptor and one polymorphic prompt", because "New languages work with zero framework code change". The generating agent relies on its own knowledge of the named framework, and "the run itself is the correctness guardrail". The provider registry and per-language prompts were "explicitly rejected in favor of one polymorphic prompt".

* **Descriptor.** `adw_init` was to detect the stack and write `## BDD Framework` and `## Step Def Directory` to `.adw/scenarios.md`, and `## Test Framework` and `## Test Directory` to `.adw/commands.md`. The config loader parses all four; absent fields fall back to the previous behaviour.
* **Gherkin mandate.** Every target uses a Gherkin runner. The scenario format is fixed to `.feature`; only the step-definition runtime varies. A non-Gherkin framework draws a loud warning but does not block.
* **Structured report.** Pass or fail comes from a JUnit XML report written to a known path, for scenarios (#578) and unit tests (#601). `parseCucumberSummary` was deleted and ADW's own suites moved to the same rail.
* **Unit-test verdict (#601, replacing the PRD's rule).** No report: warn and mark the run unverified. Report with failures: hard fail. Report with zero test cases: hard fail. The PRD's "framework detected" signal was dropped because it was "a static guess".
* **Durable gate.** The unit-test gate is `unitTests` in `.github/adw.yml`, default enabled, opt-out. The file is outside `.adw/`, so regeneration does not touch it.
* **Unverified signal.** Every warn outcome posts a comment and applies the `adw:unverified` label.
* **Proof.** Step definitions are found by directory and extension. Screenshots written to `ADW_PROOF_DIR` are harvested, uploaded and inlined in a proof comment on the PR.
* **Goal fidelity.** The resolve loop may edit application code to make the app hermetic, within the retry budget. The `.feature` file is frozen during resolve, scenarios are re-validated against the issue, and `@regression` must pass on every re-run.
* **Staged rollout.** Unit-test layer first, generation and proof second. Python is the only language with a fixture; others are validated by "fix-forward".

### Consequences

* Good, because a run with no evidence is marked unverified instead of passing.
* Good, because one parser serves every runner that can emit JUnit XML.
* Bad, because default-enabled gating reached existing target repos on their next upgrade.
* Bad, because a repo whose test command emits no JUnit report stays `unverified` until someone edits the command.
* Bad, because the Python fixture scenario needs "No Python interpreter": a shell command emits the artefacts a pytest-bdd run would produce. Real Python execution is proven only by live runs.

### Confirmation

Checked against the code on 2026-09-29:

* `adws/core/testReportParser.ts`, `testVerdict.ts`, `stackCoherenceCheck.ts`, `adwYmlConfig.ts`, `adws/proof/proofArtifactHarvester.ts`, `prProofPublisher.ts` and `adws/phases/gherkinFreeze.ts` exist, each with a Vitest file. `bunx vitest run` passed six of the seven files (77 tests); `adwYmlConfig.test.ts` could not be loaded because `@paysdoc/devplatform` is not installed in this checkout.
* `computeTestVerdict` implements the #601 table. `DEFAULT_CONFIG` in `adwYmlConfig.ts` has `unitTests: true`.
* `cucumber.js` adds a JUnit formatter when `ADW_JUNIT_REPORT_PATH` is set; `vitest.config.ts` does so for `ADW_UNIT_TEST_REPORT_PATH`.
* `grep src .claude/commands/test.md` returns nothing. `parseCucumberSummary` survives only in a comment.
* `features/regression/multilang/python_fixture_e2e.feature` was among the 10 scenarios that passed in the regression run of 2026-09-28. That workflow is not a required check; see [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md).

## More Information

* Unresolved: the generation prompts are not polymorphic. Commit d45d708e (#579, 2026-06-16 21:58) rewrote `generate_step_definitions.md` and `scenario_writer.md`. Commit ca72a4a7, the plan commit for #583 made 54 minutes later, restored the old text of both. Today `generate_step_definitions.md` says "Import `Given`, `When`, `Then` from `@cucumber/cucumber`" and verifies with `bunx tsc`, and `scenario_writer.md` still bootstraps Cucumber when `## Run E2E Tests` is absent. Neither reads `## BDD Framework`.
* Unresolved: `adw_init.md` lost part of the descriptor. Commit 1ab26649 (2026-06-16, a regeneration chore) removed from it the emission of `## Test Directory` and `## Test Framework` and the step that creates `.github/adw.yml`. `grep -i "test framework\|adw.yml" .claude/commands/adw_init.md` returns nothing today, and `writeAdwYmlTemplateIfAbsent` has no caller outside its test. The gate still works, because an absent file means enabled. `## BDD Framework`, `## Step Def Directory` and the JUnit-emitting `## Run Tests` command are still emitted.
* Unresolved: two switches with opposite defaults. The unit-test phase reads `.github/adw.yml` (absent means enabled). The `/feature` and `implement-tdd` prompts read `## Unit Tests` in `.adw/project.md` (absent means disabled), and `adw_init.md` does not write that section.
* Related: [ADR-0018](0018-unit-tests-restored-alongside-bdd.md) (unit tests), [ADR-0022](0022-review-proof-in-r2-behind-router-worker.md) (proof storage), [ADR-0042](0042-hash-versioned-self-upgrade.md) (the PRD's rule that a new parsed `.adw/` field and its `adw_init` emission ship in one PR).
