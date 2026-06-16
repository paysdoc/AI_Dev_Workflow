# Python Fixture Target + End-to-End @regression Test

**ADW ID:** x3qme8-python-fixture-targe
**Date:** 2026-06-16
**Specification:** specs/issue-583-adw-x3qme8-python-fixture-targe-sdlc_planner-python-fixture-e2e-regression.md

## Overview

Adds a Python fixture target repo (`test/fixtures/python-app/`) and a durable `@regression` end-to-end scenario that drives ADW's full non-TypeScript pipeline in-process — detect → generate → run → JUnit parse → image harvest → proof comment — against that fixture. The scenario is hermetic (no Python interpreter, no network, no R2, no GitHub) and runs green inside the existing Bun+Git Docker runner and in CI. This is the representative multi-language guard specified in the PRD (User Story 28, Testing Decisions): the seam that catches regressions in descriptor detection, JUnit parsing, screenshot harvest, and proof comment formatting before they reach live runs.

## What Was Built

- **Python fixture target repo** (`test/fixtures/python-app/`) — a minimal Python app with a complete `.adw/` descriptor detectable by ADW's existing loaders, a `pyproject.toml` manifest, a Gherkin `.feature`, `.py` pytest-bdd step definitions, and a committed screenshot asset
- **Hermetic run command** — a POSIX-shell snippet (no Python required) that emits a real JUnit XML report and copies a 1×1 PNG screenshot into `$ADW_PROOF_DIR/calculator/`, standing in for a real `pytest-bdd` run in the Bun+Git Docker runner
- **`@regression @python-e2e` end-to-end scenario** (`features/regression/multilang/python_fixture_e2e.feature`) — drives `loadProjectConfig` → `runScenarioProof` → `harvestProofArtifacts` → `formatPrProofComment` / `publishPrProof` in-process and asserts the observable output of each pipeline stage
- **Step definitions** (`features/regression/step_definitions/pythonFixtureE2ESteps.ts`) — bespoke in-process Given/When/Then steps with a `@python-e2e`-scoped After hook for fixture teardown
- **Vocabulary registration** (`features/regression/vocabulary.md`) — six new phrases (G-PY1, W-PY1, T-PY1–T-PY6) asserting observable outputs only (Rot-Detection Rubric compliant)
- **CI extension** — `.github/workflows/regression.yml` Docker steps now also run on the daily `schedule` (not only `workflow_dispatch`), exercising the fixture e2e inside `adw-bdd-runner` automatically

## Technical Implementation

### Files Modified

- `.github/workflows/regression.yml` — Docker build and `@regression` run steps now fire on `schedule` in addition to `workflow_dispatch`
- `features/regression/step_definitions/world.ts` — added optional fields `pythonFixture`, `scenarioProofResult`, `proofDir`, `capturedProofComment` to `RegressionWorld`
- `features/regression/vocabulary.md` — registered Python Fixture E2E vocabulary (G-PY1, W-PY1, T-PY1–T-PY6)
- `.claude/commands/adw_init.md`, `.claude/commands/generate_step_definitions.md`, `.claude/commands/scenario_writer.md` — minor updates
- `features/per-issue/feature-583.feature` + `features/per-issue/step_definitions/feature-583.steps.ts` — per-issue BDD scenario for issue 583

### New Files

- `features/regression/multilang/python_fixture_e2e.feature` — `@regression @python-e2e` scenario driving detect → run → parse → harvest → comment
- `features/regression/step_definitions/pythonFixtureE2ESteps.ts` — in-process step definitions (Phase import pattern)
- `test/fixtures/python-app/` — complete Python fixture target:
  - `.adw/commands.md` — `pytest` / `pip` / hermetic JUnit+screenshot run command
  - `.adw/scenarios.md` — `pytest-bdd` / `features/steps` / same run command
  - `.adw/project.md` — `web` app type, unit tests enabled
  - `.adw/review_proof.md` — `@regression` blocker tag
  - `.adw/providers.md` — github / github
  - `app.py` — minimal calculator module
  - `pyproject.toml` — manifest with `dev = ["pytest", "pytest-bdd"]`
  - `tests/test_app.py` — trivial pytest unit tests
  - `features/calculator.feature` — Gherkin scenario tagged `@regression`
  - `features/steps/test_calculator_steps.py` — pytest-bdd step definitions (`.py` presence activates step-def gate)
  - `features/steps/assets/proof.png` — committed 1×1 PNG screenshot asset
  - `README.md` — explains hermetic stand-in rationale

### Key Changes

- **Silent-green trap closed**: the `.py` step-def gate (`hasStepDefinitions('features/steps', ['.py'], repoDir)`) detects the committed step defs, so `runScenarioProof` does not skip the tag. The `is not skipped` assertion catches any regression in `stepDefExtensionsFor('pytest-bdd')` or `hasStepDefinitions`.
- **Non-TS JUnit shape exercised**: the hermetic run command emits a `<testsuite>` (not `<testsuites>`) JUnit shape, exercising the pytest branch of `testReportParser`. The `reports 2 passed and 0 failed` assertion (via `TagProofResult.counts`) catches a zero-testcase regression.
- **Harvest + inline embed wired**: `harvestProofArtifacts(result.artifactsDir)` finds the `calculator/calc.png` screenshot grouped under the `calculator` scenario directory. `formatPrProofComment(..., r2Configured: true)` produces a `<details>` block with an inline `[![...]]` embed; assertions confirm tally + embed.
- **Publish path wired**: `publishPrProof` is called with a capturing commenter (no R2, no GitHub); the captured body is asserted to contain the tally and `ADW_SIGNATURE`.
- **Execution pattern: Phase import (not subprocess)**: `whenSteps.ts` is still pending (ISSUE-3 cutover); the proof-comment path bypasses the mock server via `gh`/App auth; `isR2Configured()` reads module-load env. Driving real phase functions in-process is the only way to deterministically assert the full pipeline in the Bun+Git Docker runner.

## How to Use

### Running the scenario in isolation

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@python-e2e"
```

### Running the full regression suite (includes this scenario)

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

### Running inside the hermetic Docker runner

```sh
bun run test:docker:build
bash test/docker-run.sh --tags "@python-e2e"
bash test/docker-run.sh --tags "@regression"
```

### Inspecting the fixture manually

```sh
# From the repo root — simulate what the run command does:
cd test/fixtures/python-app
ADW_JUNIT_REPORT_PATH=/tmp/j.xml ADW_PROOF_DIR=/tmp/p sh -c \
  'mkdir -p "$ADW_PROOF_DIR/calculator" && cp features/steps/assets/proof.png "$ADW_PROOF_DIR/calculator/calc.png" && printf ... > "$ADW_JUNIT_REPORT_PATH" && echo "2 scenarios (2 passed)"'
```

## Configuration

No configuration is required. The scenario runs under the existing `@regression` `Before`/`After` hooks in `features/regression/support/hooks.ts`, which set `REAL_GIT_PATH` and wire up mock infrastructure. The `@python-e2e` After hook in `pythonFixtureE2ESteps.ts` tears down the isolated fixture copy and temporary proof directory.

**R2 behaviour**: `isR2Configured()` is false at module load in the hermetic runner (no `CLOUDFLARE_ACCOUNT_ID`/`R2_*` env vars). `publishPrProof` therefore produces a summary-only comment without inline embeds. The inline-embed assertion uses `formatPrProofComment(..., r2Configured: true)` directly, which bypasses the `isR2Configured()` gate.

## Testing

The scenario is the test. It asserts six observable pipeline outputs:

| Step | Assertion |
|---|---|
| T-PY1 | `tagResults[0].skipped === false` — step-def gate recognized `.py` files |
| T-PY2 | `counts: { total: 2, passed: 2, failed: 0 }` — JUnit parse correct |
| T-PY3 | `hasBlockerFailures === false` |
| T-PY4 | `harvestProofArtifacts(artifactsDir).length >= 1` |
| T-PY5 | `formatPrProofComment` output contains tally + `<details>` group + inline embed |
| T-PY6 | `publishPrProof` capturing commenter receives body with tally + `ADW_SIGNATURE` |

Existing unit suites that remain green:
- `bun run test:unit` — `testReportParser`, `stepDefDetection`, `projectConfig`, `proofArtifactHarvester`, `prProofPublisher`
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`

## Notes

- **Docker image has no Python.** The fixture's run command is a Python-free POSIX stand-in. The committed `proof.png` and the `printf`-emitted JUnit XML produce the same artefacts that a real `pytest-bdd` run would. Adding Python to `test/Dockerfile` is a future optimization out of scope here.
- **"Generate" scope**: the fixture ships pre-written `.py` step defs representing the *output* of `/generate_step_definitions`. The e2e verifies ADW correctly detects and consumes generated `.py` step defs; it does not re-invoke the LLM.
- **Other languages**: Go, Rust, and other non-TS targets rely on fix-forward per the PRD. Python is the one pre-built fixture that catches regressions in the descriptor/detection/parse/harvest/comment seam.
- **CI Docker cadence**: extending the Docker runtime to the daily schedule rebuilds the small `oven/bun`+`git` image per run (acceptable). Publishing `adw-bdd-runner` to GHCR to avoid per-run builds is noted as a future optimization in `app_docs/feature-78celh-docker-behavioral-test-isolation.md`.
- **No framework code change**: this feature adds a fixture + scenario + step glue + a CI tweak. It deliberately does not touch `projectConfig`, `scenarioProof`, `stepDefDetection`, or the proof layer — it verifies them.
