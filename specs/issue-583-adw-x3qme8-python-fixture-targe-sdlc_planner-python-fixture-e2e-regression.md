# Feature: Python Fixture Target + End-to-End @regression Test

## Metadata
issueNumber: `583`
adwId: `x3qme8-python-fixture-targe`
issueJson: `{"number":583,"title":"Python fixture target + end-to-end @regression test","body":"## Parent PRD\n\n`specs/prd/multi-language-test-and-bdd-support.md`\n\n## What to build\n\nVerify the non-TS path in CI (not only via live runs). Add `test/fixtures/python-app/` and a `@regression` scenario driving ADW end-to-end against it — detect → generate → run → JUnit parse → image harvest → proof comment — in the hermetic Docker runner. Other languages rely on fix-forward; this fixture is the representative guard. See PRD Testing Decisions & Out of Scope.\n\n## Acceptance criteria\n\n- [ ] Python fixture target repo with its own `.adw/`-detectable manifest + a minimal app\n- [ ] `@regression` scenario exercises detect→generate→run→parse→harvest→comment end-to-end\n- [ ] Test green in the Docker runner\n- [ ] CI runs the fixture e2e\n\n## Blocked by\n\n- Blocked by #579\n- Blocked by #580\n\n## User stories addressed\n\n- User story 28","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-15T11:51:44Z","comments":[],"actionableComment":null}`

## Feature Description

The multi-language PRD (`specs/prd/multi-language-test-and-bdd-support.md`) generalized ADW off its hardcoded Bun/TypeScript/cucumber-js/`src/` stack onto a detected-descriptor + structured-report rail. That work shipped across three now-merged blockers:

- **#578** — JUnit report rail: `testReportParser` (single JUnit XML parser), `stepDefDetection` (`stepDefExtensionsFor` / `hasStepDefinitions`, multi-language step-def gate), and `scenarioProof` consuming the structured report instead of stdout regex.
- **#579** — Polymorphic generation on the `## BDD Framework` / `## Step Def Directory` descriptor in `.adw/scenarios.md`. `adw_init` emits the descriptor; `scenarioProof` already detects step defs by the configured extension (e.g. `.py` for `pytest-bdd`).
- **#580** — Screenshot harvest + proof comment: `adws/proof/proofArtifactHarvester.ts` (`harvestProofArtifacts`), `adws/proof/prProofPublisher.ts` (`formatPrProofComment` + `publishPrProof`), and `executeProofPublishPhase`. Screenshots written to `ADW_PROOF_DIR` are harvested, uploaded to R2, and surfaced as an inline PR proof comment.

Every one of these capabilities is currently validated only by ADW's own TypeScript/cucumber-js suite and by per-issue seam unit tests against temp-dir fixtures. The **non-TypeScript path has never been exercised end-to-end** — there is no test proving that a Python-configured target flows correctly through *detect → generate → run → JUnit parse → image harvest → proof comment* as one pipeline.

This feature adds that proof. It introduces a **Python fixture target repo** (`test/fixtures/python-app/`) with its own `.adw/`-detectable descriptor (`pytest-bdd` / `pytest`, flat-ish Python layout) plus a minimal app, Gherkin `.feature`, `.py` step definitions, and a hermetic run command that emits a real JUnit XML report and a screenshot. It then adds a durable **`@regression` end-to-end scenario** that drives ADW's *real* framework modules in-process against that fixture and asserts the observable outputs of every pipeline stage. The scenario is hermetic (no Python interpreter, no network, no R2, no GitHub) so it runs green inside the existing Bun+Git Docker runner and in CI.

This fixture is, per the PRD, the **representative guard** for the whole multi-language path. Other languages (Go, Rust, …) rely on fix-forward; Python is the one pre-built fixture that catches regressions in the descriptor/detection/parse/harvest/comment seam before they reach live runs.

## User Story

As an **ADW maintainer**
I want **a Python fixture target exercised end-to-end in CI through the hermetic Docker runner**
So that **the non-TypeScript test/BDD path (detect → generate → run → JUnit parse → image harvest → proof comment) is verified by a deterministic regression test rather than discovered broken on a live run.**

(PRD User Story 28; PRD "Testing Decisions" → integration test bullet.)

## Problem Statement

The multi-language seam is unguarded for any non-TypeScript target:

- **Detection** of a Python descriptor (`bddFramework: pytest-bdd`, `stepDefDirectory: features/steps`, `testFramework: pytest`, `testDirectory: tests`) and the `.py` step-def gate (`hasStepDefinitions` + `stepDefExtensionsFor`) is only covered by a per-issue seam unit test (`feature-579.feature`, swept after merge) — not by a durable executed regression scenario.
- **Run → JUnit parse** (`runScenarioProof` → `runScenariosByTag` → `testReportParser`) has never been driven against a non-cucumber-js runner emitting a non-cucumber JUnit shape (`<testsuite>`/`<testsuites>` from pytest).
- **Image harvest → proof comment** (`harvestProofArtifacts` → `formatPrProofComment`) has never been exercised against screenshots produced by a non-TS BDD run.
- The PRD explicitly calls the silent-green class of bug (a non-`.ts` suite skipped with no blocker failure, or "zero testcases" reported green) the motivating failure. Nothing currently *fails* if that regresses for Python.

Because the Docker runner ships **only Bun + Git** (no Python), and because the proof-comment post path goes through `gh`/GitHub-App auth (which bypasses the mock GitHub server) and R2 (which is `isR2Configured()`-gated on module-load env), a naive "spawn the orchestrator and assert recorded GitHub calls" approach cannot observe the pipeline. A purpose-built, in-process, hermetic scenario is required.

## Solution Statement

Add a **Python fixture target repo** and a **self-contained `@regression` end-to-end scenario** that drives ADW's real pipeline modules in-process (the vocabulary registry's sanctioned **"Phase import"** execution pattern) and asserts the observable *output* of each stage. No Python interpreter, no network, no R2, and no GitHub are required — keeping the test green in the Bun+Git Docker runner.

**Fixture (`test/fixtures/python-app/`)** — a minimal Python target with:
- A real manifest (`pyproject.toml`) declaring `pytest` + `pytest-bdd` dev deps and a minimal app (`app.py`).
- `.adw/` descriptor that ADW's loaders detect: `commands.md` (`testFramework: pytest`, `testDirectory: tests`, `pip`), `scenarios.md` (`## BDD Framework: pytest-bdd`, `## Step Def Directory: features/steps`), `project.md` (`## Unit Tests: enabled`), `review_proof.md` (one blocker proof tag), `providers.md` (github/github).
- A Gherkin `.feature` and `.py` `pytest-bdd` step definitions under `features/steps/` (so the `.py` step-def gate detects them — representing the *generated* output of `/generate_step_definitions`).
- A **hermetic run command** (in `commands.md`/`scenarios.md` "Run Scenarios by Tag") — a portable POSIX shell snippet (`mkdir`/`cp`/`printf`) that writes a real JUnit XML report to `$ADW_JUNIT_REPORT_PATH` (2 testcases, 0 failures) and copies a committed 1×1 PNG into `$ADW_PROOF_DIR/<scenario>/`, standing in for a passing `pytest-bdd` run that captured a screenshot. (The Docker image has no Python; the run command is the hermetic stand-in. `runScenariosByTag` runs it with `shell: true`, so `$ADW_JUNIT_REPORT_PATH`/`$ADW_PROOF_DIR` expand.)

**Scenario (`features/regression/multilang/python_fixture_e2e.feature`, tagged `@regression @python-e2e`)** drives, in-process, against an isolated copy of the fixture (`setupFixtureRepo('python-app')`):
1. **detect / generate** — `loadProjectConfig(repoDir)` parses the Python descriptor; `stepDefExtensionsFor(bddFramework)` → `['.py']`; the proof run is **not skipped** (the `.py` step-def gate recognized the generated step defs — silent-green trap closed).
2. **run → parse** — `runScenarioProof(...)` executes the fixture's JUnit-emitting run command (`cwd = repoDir`) and `testReportParser` parses it; assert the structured tally `{ total: 2, passed: 2, failed: 0 }`, `passed: true`, `hasBlockerFailures: false`.
3. **harvest** — `harvestProofArtifacts(result.artifactsDir)` returns the screenshot (asserts ≥1 artifact grouped under the scenario directory).
4. **comment** — `formatPrProofComment({ tagResults, uploaded, r2Configured: true })` (with `uploaded` derived from the harvested artifacts via a fake-upload mapping) produces a comment containing the **pass tally** and an **inline screenshot embed**; additionally `publishPrProof(...)` with a **capturing commenter** verifies the harvest→format→post wiring posts a body with the tally + `ADW_SIGNATURE`.

**CI** — the scenario is tagged `@regression`, so the existing daily `regression.yml` host job runs it automatically. To satisfy "verified in the hermetic Docker runner," extend `regression.yml` so the Docker runtime also runs on the daily `schedule` (today it is `workflow_dispatch`-only), exercising the fixture e2e inside `adw-bdd-runner` in CI.

**Why in-process (Phase import), not a spawned orchestrator (Subprocess):** the `When` steps in `features/regression/step_definitions/whenSteps.ts` are currently `return 'pending'` stubs (the ISSUE-3 cutover is incomplete), so `W1`/`W10` cannot be reused; the proof-comment post bypasses the mock server (`gh`/App auth); and R2 is gated on module-load env so the inline-embed branch of `publishPrProof` is not reachable from a spawned subprocess in the hermetic runner. Driving the real phase functions in-process is the vocabulary registry's sanctioned Phase-import pattern, is deterministic, and asserts the genuine framework code (`projectConfig`, `stepDefDetection`, `scenarioProof`/`testReportParser`, `proofArtifactHarvester`, `prProofPublisher`).

## Relevant Files

Use these files to implement the feature:

### Framework modules the scenario drives (read to wire correctly — do not modify)
- `adws/core/projectConfig.ts` — `loadProjectConfig(targetRepoPath)`, `parseScenariosMd`, `parseCommandsMd`, `parseReviewProofMd`; `ScenariosConfig` (`bddFramework`, `stepDefDirectory`), `CommandsConfig` (`testFramework`, `testDirectory`, `runScenariosByTag`), `ReviewProofConfig`. The detection surface the fixture must satisfy.
- `adws/core/stepDefDetection.ts` — `stepDefExtensionsFor(bddFramework)` (`pytest-bdd → ['.py']`) and `hasStepDefinitions(dir, ext, cwd)`. The `.py` step-def gate.
- `adws/phases/scenarioProof.ts` — `runScenarioProof(options)`: runs the configured run command with `ADW_JUNIT_REPORT_PATH` + `ADW_PROOF_DIR` injected, parses JUnit via `readJUnitReport`, returns `ScenarioProofResult { tagResults, hasBlockerFailures, resultsFilePath, artifactsDir }`. `TagProofResult.counts` is the structured tally to assert.
- `adws/core/testReportParser.ts` — `parseJUnitXml` / `readJUnitReport`; handles bare `<testsuite>` (cucumber) and `<testsuites>` (pytest) shapes. The fixture's JUnit XML must parse here.
- `adws/agents/bddScenarioRunner.ts` — `runScenariosByTag(tagCommand, tag, cwd, env)`: `shell: true`, `{tag}` substitution, merges `env` (the `ADW_*` vars) into the subprocess. Confirms the fixture run command can expand the proof env vars.
- `adws/proof/proofArtifactHarvester.ts` — `harvestProofArtifacts(artifactsDir)` → `ProofArtifact[]` (recursive image glob, sorted by `relPath`).
- `adws/proof/prProofPublisher.ts` — `formatPrProofComment(input)` (pure: tally + `<details>` per-scenario inline embeds) and `publishPrProof(deps)` (harvest → upload → format → post; injectable `uploader`/`commenter`; R2 gated by module-load `isR2Configured()`).
- `adws/proof/types.ts` — `ProofArtifact`, `UploadedArtifact`, `ProofCommentInput`, `PublishDeps`, `UploaderFn`, `CommenterFn`. Shapes for the fake-upload mapping and capturing commenter.
- `adws/proof/index.ts` — barrel exports (`harvestProofArtifacts`, `formatPrProofComment`, `publishPrProof`, types).
- `adws/r2/types.ts` — `UploadOptions` / `UploadResult` (`{ url, bucket, key }`) for the fake `UploaderFn` signature.

### Test harness & existing prior art (read to follow the pattern)
- `test/mocks/test-harness.ts` — `setupFixtureRepo(fixtureName)` / `teardownFixtureRepo(ctx)` (copies `test/fixtures/<name>` to an isolated temp dir, git-inits via `REAL_GIT_PATH`); `setupMockInfrastructure()` / `teardownMockInfrastructure()` (the `@regression` `Before`/`After` hook also sets `REAL_GIT_PATH`).
- `test/mocks/types.ts` — `FixtureRepoContext` (`{ repoDir, cleanup }`), `MockContext`.
- `features/regression/support/hooks.ts` — the `@regression` `Before`/`After` hooks (set up `mockContext`, set `REAL_GIT_PATH`). The new scenario runs under these.
- `features/regression/step_definitions/world.ts` — `RegressionWorld`; will gain optional fields for the e2e (fixture repoDir, proof result, captured comment).
- `features/regression/vocabulary.md` — the Regression Vocabulary Registry + Rot-Detection Rubric. New phrases must be registered here and must assert observable **outputs/artefacts**, never file shape/extension.
- `test/fixtures/python-flat/` — existing flat-layout Python fixture (unit-test-phase only; `echo` stub run commands). Mirror its `.adw/` shape; the new fixture differs by adding a real BDD descriptor (`bddFramework`/`stepDefDirectory`), `.py` step defs, a `.feature`, and a JUnit+screenshot-emitting run command.
- `test/fixtures/cli-tool/` — existing TS fixture target + `setupFixtureRepo('cli-tool')` consumer pattern (`.adw/review_proof.md` tag table, `providers.md`).
- `features/review_harness.feature` + `features/step_definitions/reviewHarnessSteps.ts` — prior art for a layered `@regression` scenario with bespoke, in-process step definitions driving a phase against a fixture repo.
- `cucumber.js` — feature glob `features/regression/**/*.feature`; step glob `features/regression/step_definitions/**/*.ts`. Dictates where the new files live.

### CI & Docker
- `.github/workflows/regression.yml` — daily host `@regression` job + opt-in Docker steps (`workflow_dispatch` `runtime == 'docker'`). To be extended so Docker also runs on `schedule`.
- `test/Dockerfile`, `test/docker-run.sh`, `test/.dockerignore` — the generic Bun+Git runner; `bun run test:docker` / `bash test/docker-run.sh --tags "@regression"`. No change needed (the scenario is hermetic; verify the fixture is not excluded by `.dockerignore`).

### Conditional documentation (matched by `.adw/conditional_docs.md` conditions for this task)
- `app_docs/feature-u3l5q0-junit-report-rail-migration.md` — JUnit rail, `testReportParser`/`scenarioProof`/`stepDefDetection`, "non-`.ts` BDD suite not recognized by the step-def gate," zero-testcase blocker-fail.
- `app_docs/feature-bfdyaj-polymorphic-step-def.md` — `## BDD Framework` / `## Step Def Directory` descriptor; `pytest-bdd` + `features/steps` → `.py` detection.
- `app_docs/feature-izgf7n-screenshot-harvest-proof-comment.md` — `ADW_PROOF_DIR`, `harvestProofArtifacts`, `formatPrProofComment`/`publishPrProof`, R2 gating.
- `app_docs/feature-zyaojl-configurable-test-directory.md` — flat-layout (non-`src/`) / non-Bun test framework, `testDirectory`/`testFramework`.
- `app_docs/feature-2evbnk-bdd-smoke-surface-scenarios.md` — `features/regression/` layout + `@regression` Cucumber lifecycle hooks.
- `app_docs/feature-6bi1qq-fixture-repo-test-harness.md` — `setupFixtureRepo`/`teardownFixtureRepo` and fixture-target conventions.
- `app_docs/feature-78celh-docker-behavioral-test-isolation.md` — the Docker runner (`TEST_RUNTIME=docker`, `test/docker-run.sh`, `regression.yml` Docker steps).

### New Files

**Python fixture target — `test/fixtures/python-app/`:**
- `test/fixtures/python-app/pyproject.toml` — manifest: project metadata + `[project.optional-dependencies] dev = ["pytest", "pytest-bdd"]` (the detectable "test framework present" signal).
- `test/fixtures/python-app/app.py` — minimal app (a tiny calculator/Flask-style module; pure-Python, not executed by the e2e).
- `test/fixtures/python-app/README.md` — one-paragraph description: hermetic e2e fixture; the run command stands in for a real `pytest-bdd` run because the Docker image ships Bun+Git, not Python.
- `test/fixtures/python-app/tests/test_app.py` — a minimal `pytest` unit test (gives `testDirectory: tests` real content).
- `test/fixtures/python-app/features/calculator.feature` — a Gherkin scenario tagged with the fixture's blocker proof tag.
- `test/fixtures/python-app/features/steps/test_calculator_steps.py` — `pytest-bdd` step definitions (`.py`), so `hasStepDefinitions('features/steps', ['.py'], repoDir)` is true.
- `test/fixtures/python-app/features/steps/assets/proof.png` — a committed tiny (1×1) valid PNG; the run command copies it into `$ADW_PROOF_DIR/<scenario>/` as the harvested screenshot.
- `test/fixtures/python-app/.adw/project.md` — `## Application Type` (web) + `## Unit Tests` enabled.
- `test/fixtures/python-app/.adw/commands.md` — `pip`; `testFramework: pytest`; `testDirectory: tests`; `## Run Scenarios by Tag` and `## Run Regression Scenarios` set to the JUnit+screenshot emit command.
- `test/fixtures/python-app/.adw/scenarios.md` — `## Scenario Directory: features/`; `## BDD Framework: pytest-bdd`; `## Step Def Directory: features/steps`; `## Run Scenarios by Tag` / `## Run Regression Scenarios` = emit command.
- `test/fixtures/python-app/.adw/review_proof.md` — `## Tags` table with one blocker tag (e.g. `@regression`, not optional) that `runScenarioProof` runs.
- `test/fixtures/python-app/.adw/providers.md` — github / github.

**Regression scenario & steps:**
- `features/regression/multilang/python_fixture_e2e.feature` — the `@regression @python-e2e` end-to-end scenario.
- `features/regression/step_definitions/pythonFixtureE2ESteps.ts` — the bespoke in-process Given/When/Then steps + a `@python-e2e`-tagged `After` hook calling `teardownFixtureRepo`.

## Implementation Plan

### Phase 1: Foundation — the Python fixture target repo
Build `test/fixtures/python-app/` so ADW's existing loaders detect a coherent Python/`pytest-bdd` target and the hermetic run command produces a real JUnit report + screenshot. This phase introduces no framework code change — it composes the descriptor that #578/#579/#580 already consume. Validate the fixture's `.adw/` parses correctly via a throwaway `loadProjectConfig` check before wiring the scenario.

### Phase 2: Core Implementation — the in-process end-to-end scenario
Register new observable-output vocabulary phrases, extend `RegressionWorld` with optional e2e fields, author the `.feature`, and implement the step definitions that drive `loadProjectConfig` → `runScenarioProof` → `harvestProofArtifacts` → `formatPrProofComment`/`publishPrProof` against an isolated copy of the fixture, asserting the output of each stage. The scenario reuses the `@regression` `Before`/`After` mock-infra hooks (for `REAL_GIT_PATH`) and tears down its fixture copy in a tag-scoped `After`.

### Phase 3: Integration — CI in the hermetic Docker runner
Confirm the scenario is collected by `cucumber.js`, passes on the host as part of `@regression`, and passes inside `adw-bdd-runner` via `test/docker-run.sh`. Extend `.github/workflows/regression.yml` so the Docker runtime runs on the daily `schedule` (not only `workflow_dispatch`), so CI exercises the fixture e2e in the hermetic Docker runner. Verify the fixture is included in the Docker build context (`test/.dockerignore` does not exclude `test/fixtures/`).

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Create the Python fixture app + manifest + tests
- Create `test/fixtures/python-app/pyproject.toml` with project metadata and `dev = ["pytest", "pytest-bdd"]` under optional dependencies (representative manifest + detectable test-framework signal).
- Create `test/fixtures/python-app/app.py` — a minimal pure-Python module (e.g. an `add(a, b)` function and a small `create_app()`-style factory). Keep it < ~25 lines; it is never executed by the e2e.
- Create `test/fixtures/python-app/tests/test_app.py` — one or two trivial `pytest` tests over `app.py`.
- Create `test/fixtures/python-app/README.md` — explain it is a hermetic ADW e2e fixture and that the run command is a Python-free stand-in for a real `pytest-bdd` run (Docker ships Bun+Git, not Python).

### 2. Create the Gherkin scenario + .py step defs + screenshot asset
- Create `test/fixtures/python-app/features/calculator.feature` — a single coherent scenario (e.g. "Add two numbers") tagged with the blocker proof tag chosen for `review_proof.md`.
- Create `test/fixtures/python-app/features/steps/test_calculator_steps.py` — idiomatic `pytest-bdd` step definitions (`@scenario`, `@given`/`@when`/`@then`) wiring the `.feature`. This file's mere presence (a `.py` under `features/steps/`) is what the step-def gate detects; it need not be runnable in the hermetic e2e.
- Add `test/fixtures/python-app/features/steps/assets/proof.png` — a committed minimal valid PNG (1×1). (Generate with a one-off `printf`/base64 decode locally and commit the bytes; do not rely on `base64 -d` at run time — portability differs across macOS/Linux.)

### 3. Author the fixture `.adw/` descriptor
- `test/fixtures/python-app/.adw/providers.md` — `## Issue Tracker: github`, `## Code Host: github` (mirror `cli-tool`).
- `test/fixtures/python-app/.adw/project.md` — `## Application Type` = `web`; `## Unit Tests` = `enabled` (mirror `python-flat`).
- `test/fixtures/python-app/.adw/commands.md` — `## Package Manager: pip`; `## Run Tests: pytest`; `## Test Directory: tests`; `## Test Framework: pytest`; lint/typecheck/build = `N/A`; and `## Run Scenarios by Tag` + `## Run Regression Scenarios` set to the hermetic emit command (see step 4).
- `test/fixtures/python-app/.adw/scenarios.md` — `## Scenario Directory: features/`; `## BDD Framework: pytest-bdd`; `## Step Def Directory: features/steps`; `## Run Scenarios by Tag` + `## Run Regression Scenarios` = the same emit command.
- `test/fixtures/python-app/.adw/review_proof.md` — `## Tags` table with one row: a blocker tag (e.g. `@regression`), `Required: blocker`, `Optional: no`. This is the tag `runScenarioProof` iterates.

### 4. Define the hermetic JUnit + screenshot emit command
- Set the run command (in both `commands.md` and `scenarios.md`, fenced ```sh) to a portable POSIX snippet that:
  - `mkdir -p "$ADW_PROOF_DIR/calculator"` and `cp features/steps/assets/proof.png "$ADW_PROOF_DIR/calculator/calc.png"` (screenshot into the scenario-named subdir so it groups in the proof comment);
  - writes a valid JUnit report to `$ADW_JUNIT_REPORT_PATH` via `printf` — a `<testsuite name="pytest-bdd" tests="2" failures="0" skipped="0">` with two `<testcase>` children (parser-compatible per `testReportParser`);
  - `echo "2 scenarios (2 passed)"` for human-readable stdout.
- Keep it a single `&&`-chained line (or a small `sh -c` block) since `runScenariosByTag` runs it with `shell: true` and `cwd = repoDir`. Reference only `$ADW_JUNIT_REPORT_PATH` / `$ADW_PROOF_DIR` (absolute, injected by `scenarioProof`) and the repo-relative `features/steps/assets/proof.png`.
- Sanity check locally: from `test/fixtures/python-app/`, run the command with `ADW_JUNIT_REPORT_PATH=/tmp/j.xml ADW_PROOF_DIR=/tmp/p sh -c '<cmd>'` and confirm `/tmp/j.xml` parses and `/tmp/p/calculator/calc.png` exists.

### 5. Validate fixture detection in isolation
- With a throwaway script (`bunx tsx -e ...`), call `loadProjectConfig('test/fixtures/python-app')` and assert: `scenarios.bddFramework === 'pytest-bdd'`, `scenarios.stepDefDirectory === 'features/steps'`, `commands.testFramework === 'pytest'`, `commands.testDirectory === 'tests'`, `reviewProofConfig.tags` contains the blocker tag, and `stepDefExtensionsFor(scenarios.bddFramework)` → `['.py']`, and `hasStepDefinitions('features/steps', ['.py'], 'test/fixtures/python-app')` is `true`. Fix the descriptor until all hold. (This is a dev-time check, not committed.)

### 6. Extend RegressionWorld with optional e2e fields
- In `features/regression/step_definitions/world.ts`, add optional fields used only by the e2e steps (Cucumber instantiates a fresh `World` per scenario, so these are auto-isolated):
  - `pythonFixture?: FixtureRepoContext` (the isolated fixture copy),
  - `scenarioProofResult?: ScenarioProofResult`,
  - `proofProofDir?: string` (the temp `proofDir`),
  - `capturedProofComment?: string`.
- Import the needed types (`FixtureRepoContext`, `ScenarioProofResult`). Keep changes additive; do not alter existing fields or the `@regression` reset semantics (the `After` hook already clears core fields — add resets for the new fields if needed or rely on per-scenario World instantiation).

### 7. Register new vocabulary phrases (observable-output only)
- In `features/regression/vocabulary.md`, add a new subsection (e.g. "Given/When/Then — Python Fixture E2E") registering the new phrases. Each must assert an observable **output/artefact** per the Rot-Detection Rubric — phrase them around pipeline *outputs*, never "a `.py` file exists". Suggested set:
  - Given: `the Python fixture target "python-app" is initialised as an ADW target repo`.
  - When: `ADW runs the scenario proof pipeline against the Python fixture for issue {int}`.
  - Then (one per stage, asserting outputs):
    - `the scenario proof for the Python fixture is not skipped` (detect/gate: `.py` step defs recognized → not silent-green),
    - `the scenario proof reports {int} passed and {int} failed` (run → JUnit parse: `TagProofResult.counts`),
    - `the scenario proof records no blocker failures` (`hasBlockerFailures === false`),
    - `the proof run harvests at least {int} screenshot artifact` (`harvestProofArtifacts` output),
    - `the composed proof comment shows the pass tally and an inline screenshot` (`formatPrProofComment` output contains tally + inline embed),
    - `publishing the proof posts a PR comment carrying the pass tally` (`publishPrProof` → capturing commenter output).
- Keep phrasing consistent with existing G/W/T style; document the assertion target column as state/artefact outputs.

### 8. Author the feature file
- Create `features/regression/multilang/python_fixture_e2e.feature` tagged `@regression @python-e2e` with a single Scenario that uses exactly the phrases registered in step 7, in pipeline order (detect → run/parse → harvest → comment). Pass `583` as the issue number argument. Keep it readable as a top-to-bottom narrative of the multi-language pipeline.

### 9. Implement the step definitions
- Create `features/regression/step_definitions/pythonFixtureE2ESteps.ts`:
  - **Given** — `this.pythonFixture = setupFixtureRepo('python-app')` (relies on `REAL_GIT_PATH` set by the `@regression` `Before` hook). Optionally assert `loadProjectConfig(repoDir)` detects the Python descriptor and store nothing source-shaped (assert via the not-skipped Then, not here).
  - **When** — create a temp `proofDir` (`mkdtempSync`); load config via `loadProjectConfig(this.pythonFixture.repoDir)`; call `runScenarioProof({ scenariosMd: cfg.scenariosMd, reviewProofConfig: cfg.reviewProofConfig, runByTagCommand: cfg.commands.runScenariosByTag, issueNumber, proofDir, cwd: this.pythonFixture.repoDir, stepDefDirectory: cfg.scenarios.stepDefDirectory, stepDefExtensions: stepDefExtensionsFor(cfg.scenarios.bddFramework) })`; store the `ScenarioProofResult` and `proofDir` on the World.
  - **Then (not skipped / counts / no blocker)** — assert `tagResults[0].skipped === false`, `tagResults[0].counts` equals the expected `{ total, passed, failed }`, `result.hasBlockerFailures === false`.
  - **Then (harvest)** — `const artifacts = harvestProofArtifacts(result.artifactsDir)`; assert `artifacts.length >= 1` and that one `relPath` is under the `calculator/` group.
  - **Then (comment formatting)** — build `uploaded: UploadedArtifact[]` by mapping each harvested artifact through a deterministic fake upload (`{ scenario: <leading segment of relPath>, url: 'https://screenshots.paysdoc.nl/proof/' + adwId + '/' + relPath, fileName: <basename relPath> }`); call `formatPrProofComment({ tagResults: result.tagResults, uploaded, r2Configured: true })`; assert the markdown contains the tally (`**2 passed, 0 failed**`), a `<details>` group for `calculator`, and an inline `[![calc.png](https://screenshots.paysdoc.nl/...)]` embed.
  - **Then (publish wiring)** — call `await publishPrProof({ artifactsDir: result.artifactsDir, scenarioProof: result, prNumber: 583, repoInfo: { owner: 'paysdoc', repo: 'python-app' }, adwId: 'x3qme8-python-fixture-targe', commenter: (n, body) => { this.capturedProofComment = body } })`; assert `this.capturedProofComment` contains `**2 passed, 0 failed**` and the `ADW_SIGNATURE`. (Do not rely on the R2/inline branch here — `isR2Configured()` reads module-load env and stays false in the hermetic run; the inline-embed assertion is covered by the formatter Then above.)
  - **After (`{ tags: '@python-e2e' }`)** — `if (this.pythonFixture) teardownFixtureRepo(this.pythonFixture)`; remove the temp `proofDir`.
- Keep helpers small and named per the coding guidelines (guard clauses, max ~2 nesting levels, no inline callbacks > 3 lines). Reads of the proof result / harvested artifacts / composed comment are **artefact/output** reads (permitted by the rubric), not source-file reads.

### 10. Confirm collection and run on the host
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@python-e2e"` and confirm the scenario executes (not pending/undefined) and passes.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` and confirm the full suite, including the new scenario, is green with no regressions.

### 11. Verify in the hermetic Docker runner
- `bun run test:docker:build` then `bash test/docker-run.sh --tags "@python-e2e"` and `bash test/docker-run.sh --tags "@regression"`; confirm green inside `adw-bdd-runner`.
- Confirm `test/.dockerignore` does not exclude `test/fixtures/` (the fixture must be present in the mounted workspace). If it does, narrow the ignore so `test/fixtures/python-app/` is included.

### 12. Wire CI to run the fixture e2e in Docker
- Edit `.github/workflows/regression.yml`: change the two Docker steps' `if:` condition from `github.event.inputs.runtime == 'docker'` to also fire on the daily schedule — `${{ github.event.inputs.runtime == 'docker' || github.event_name == 'schedule' }}` — so the daily run builds `adw-bdd-runner` and runs `@regression` (including the fixture e2e) in the hermetic Docker runner. Leave the host job unchanged. (Note in the PR that the image is rebuilt per run; GHCR publishing remains a future optimization.)

### 13. Run the full Validation Commands
- Execute every command in **Validation Commands** below and confirm zero errors / zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so this subsection is included. However, per the PRD "Testing Decisions," the Python fixture is the **integration test** for the multi-language path, and the proof/generation layer is explicitly *"not unit-tested … verified via the fixture e2e."* This feature introduces **no new pure framework module** — it composes modules that already have their own Vitest unit suites:

- `adws/core/__tests__/testReportParser.test.ts` — JUnit parse (incl. `<testsuites>`/pytest shape, zero-testcase).
- `adws/core/__tests__/stepDefDetection.test.ts` — `stepDefExtensionsFor` (`pytest-bdd → ['.py']`) + `hasStepDefinitions`.
- `adws/core/__tests__/projectConfig.test.ts` — `bddFramework`/`stepDefDirectory`/`testFramework`/`testDirectory` parsing + defaults.
- `adws/proof/__tests__/proofArtifactHarvester.test.ts` and `adws/proof/__tests__/prProofPublisher.test.ts` — harvest + formatter (inline embeds, grouping, tally).

These suites **must remain green** (run via `bun run test:unit`); the new fixture e2e is what proves they compose correctly for a non-TS target. Do **not** add agent-written unit tests for the step-definition glue (it is test scaffolding, validated by the scenario executing green). The one conditional case: if implementation extracts a reusable pure helper beyond the fixture (e.g. a shared JUnit-XML fixture builder under `adws/` or `test/`), add a focused Vitest test for that helper following the existing `__tests__/` pattern.

### Edge Cases
- **Silent-green / not-skipped:** if the `.py` step defs were absent or the gate regressed, `runScenarioProof` would skip the tag (`skipped: true`) — the `is not skipped` assertion catches this. (The fixture deliberately ships `.py` step defs so the happy path is detected.)
- **Zero-testcase trap:** the run command emits `tests="2"`; the `reports 2 passed and 0 failed` assertion (via `counts`) catches a regression that produced a zero-testcase report (which `scenarioProof` would treat as a blocker fail).
- **JUnit shape variance:** the fixture's `<testsuite>` (pytest-bdd) shape must parse in `testReportParser` (which also handles the `<testsuites>` wrapper). Keep the emitted XML minimal and valid.
- **Screenshot grouping:** the screenshot is written under `$ADW_PROOF_DIR/calculator/` so it groups under a `calculator` `<details>` block — the harvest + inline-embed assertions confirm grouping by leading path segment.
- **R2 not configured (hermetic):** `isR2Configured()` is false at module load, so `publishPrProof` produces a summary-only comment; the publish-wiring Then asserts only the tally + signature, while the inline-embed assertion uses `formatPrProofComment(..., r2Configured: true)` directly. Do not attempt to flip R2 env in a step (constants are evaluated at import).
- **Worktree/PATH isolation:** the `@regression` `Before` hook modifies `PATH` (git wrapper) and sets `CLAUDE_CODE_PATH`; the emit command uses only `mkdir`/`cp`/`printf`/`echo` (unshadowed) and `setupFixtureRepo` uses `REAL_GIT_PATH`, so there is no interference. The fixture copy is torn down in the `@python-e2e` `After`.
- **Docker context:** verify `test/.dockerignore` includes `test/fixtures/python-app/` so the fixture exists in the mounted read-only workspace.

## Acceptance Criteria
- A Python fixture target repo exists at `test/fixtures/python-app/` with an `.adw/`-detectable descriptor (`pytest-bdd` / `pytest`, `features/steps`, `tests`) parsed correctly by `loadProjectConfig`, plus a minimal app (`app.py`), a `pyproject.toml` manifest, a Gherkin `.feature`, `.py` `pytest-bdd` step defs, and a committed screenshot asset.
- A `@regression`-tagged end-to-end scenario (`features/regression/multilang/python_fixture_e2e.feature`) drives detect → generate → run → JUnit parse → image harvest → proof comment in-process against the fixture and asserts the observable output of each stage (not skipped; `{ total: 2, passed: 2, failed: 0 }`; no blocker failures; ≥1 harvested screenshot; proof comment with pass tally + inline screenshot embed; publish posts a body with the tally + signature).
- New step phrases are registered in `features/regression/vocabulary.md` and assert observable outputs/artefacts only (Rot-Detection Rubric compliant).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` is green on the host, including the new scenario, with zero regressions.
- The scenario is green inside the hermetic Docker runner (`bash test/docker-run.sh --tags "@regression"`).
- CI runs the fixture e2e: it is collected by the existing daily host `@regression` job, and `regression.yml` is extended so the Docker runtime also runs on the daily schedule.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint clean (includes the new `.ts` step definitions).
- `bunx tsc --noEmit` — root TypeScript type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type-check passes.
- `bun run test:unit` — Vitest unit suites pass (`testReportParser`, `stepDefDetection`, `projectConfig`, `proofArtifactHarvester`, `prProofPublisher`, …) — confirms the composed modules remain green.
- `bun run build` — `tsc` build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@python-e2e"` — the new scenario executes (not pending/undefined) and passes in isolation.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression suite green on the host, including the new scenario, zero regressions.
- `bun run test:docker:build` — builds the `adw-bdd-runner` image.
- `bash test/docker-run.sh --tags "@python-e2e"` — the fixture e2e is green inside the hermetic Docker runner.
- `bash test/docker-run.sh --tags "@regression"` — full `@regression` suite green inside Docker (host/Docker parity).

## Notes
- **Strictly adhere to `.adw/coding_guidelines.md`.** Keep the new step-definition file modular (single responsibility, < 300 lines), use guard clauses and named helpers (max ~2 nesting levels), avoid `any` (use the proof-layer types), prefer `async`/`await`, and isolate side effects (fs/temp-dir/teardown) at the edges. Reads of proof results / harvested artifacts / composed comments are artefact/output reads — permitted by the Rot-Detection Rubric; do not write phrases that assert source-file shape, extension, or substring.
- **No new library required.** Everything uses existing deps (`@cucumber/cucumber`, `tsx`, Vitest, the ADW modules). Per `.adw/commands.md`, the library install command (if ever needed) is `bun add <package>` — none is needed here.
- **No framework code change.** This issue adds a fixture + a scenario + step glue + a CI tweak. It deliberately does **not** touch `projectConfig`, `scenarioProof`, `stepDefDetection`, or the proof layer — it verifies them. If the e2e surfaces a real framework defect, fix it in a clearly separated commit (fix-forward), as the PRD intends.
- **In-process, not subprocess — rationale (do not "fix" by spawning an orchestrator):** the `When` steps in `whenSteps.ts` are still `return 'pending'` (ISSUE-3 cutover incomplete); the proof-comment post path (`gh pr comment` / GitHub-App auth) bypasses the mock GitHub server; and `publishPrProof`'s R2 branch is gated on module-load env (`isR2Configured()` reads `CLOUDFLARE_ACCOUNT_ID`/`R2_*` constants), unreachable from a hermetic subprocess. Driving the real phase functions in-process is the vocabulary registry's sanctioned **Phase import** pattern and is the only way to deterministically assert the full pipeline in the Bun+Git runner. (See the project memory on BDD harness observability limits: drive real resolvers in-process and assert verdicts/artefacts rather than `getRecordedRequests()`.)
- **"Generate" scope in the e2e:** the fixture ships pre-written `.py` step defs representing the output of `/generate_step_definitions`. The e2e verifies the framework correctly *detects and consumes* generated `.py` step defs; it does not re-invoke the LLM (the polymorphic prompts are "not unit-tested, verified via fix-forward" per the PRD). This is the intended interpretation of "generate" for the hermetic guard.
- **Docker image has no Python.** The fixture's run command is a Python-free POSIX stand-in for a real `pytest-bdd` run, emitting the same artefacts ADW consumes (JUnit XML + screenshots). This keeps the test hermetic and fast and matches how `cli-tool`/`python-flat` use deterministic stub commands. If a future issue wants to actually execute `pytest-bdd` in CI, that requires adding Python to `test/Dockerfile` and is out of scope here.
- **Hash propagation:** this feature edits no `hashInputs:` file (`adw_init.md` + the vocabulary template are untouched), so it takes effect immediately on merge without triggering `adwUpgrade` regeneration across registered target repos — correct, since it is framework-resident test infrastructure, not target `.adw/` config.
- **CI cadence note:** extending the Docker runtime to the daily schedule rebuilds the small `oven/bun`+`git` image per run (acceptable). Publishing `adw-bdd-runner` to GHCR to avoid per-run builds is a noted future optimization (out of scope), already flagged in `app_docs/feature-78celh-docker-behavioral-test-isolation.md`.
