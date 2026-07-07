# BDD Regression Suite

## Overview

`features/regression/` is the permanent, executed BDD test suite for ADW. It contains feature files covering the full SDLC surface matrix (orchestrators, phases, edge cases, smoke paths), a typed Cucumber World, shared step definitions, and the vocabulary registry that governs which per-issue scenario patterns are eligible for promotion into this suite.

## Responsibilities

- Maintain `vocabulary.md`: the canonical registry of regression step phrases with their semantics, execution pattern (`subprocess`, `phase-import`, `mock-query`), and assertion targets. Defines the rot-detection rubric (phrases must assert observable system behavior, not source-code properties).
- Define five observable assertion surfaces: state files, recorded HTTP requests (mock server), git artefacts, exit codes, and log streams.
- Define three execution patterns: subprocess (spawns orchestrator binary), phase-import (imports a phase function directly), and mock-query (inspects recorded calls only without running a subprocess).
- Maintain `features/regression/smoke/` — high-level end-to-end smoke scenarios (`adw_sdlc_happy_path`, `cron_trigger_spawn`, `pause_resume_rate_limit`, `cancel_directive`, `promotion_commenter`, `promotion_mover`, `promotion_threshold_auto_ramp`, `adw_chore_diff_verdicts`).
- Maintain `features/regression/surfaces/` — the SDLC surface matrix: 35 row-numbered `.feature` files covering each orchestrator × phase × happy/edge-case combination from `adwPlan` workflow init through `adwDocument` and `adwSdlc` cron scenarios.
- Maintain `features/regression/multilang/` — Python fixture e2e regression.
- Maintain `features/regression/upgrade/` — promoted single-scenario-file features for the `adwUpgrade` lane (e.g. `feature-729.feature`), each paired with its own scenario-specific step-def file directly under `features/regression/step_definitions/` (not folded into the shared given/when/then registries).
- Provide `RegressionWorld` (extends Cucumber `World`): typed container for `MockContext`, `lastExitCode`, `worktreePaths`, `prsByBranch`, `targetBranch`, `harnessEnv`, Python fixture state, and scenario proof results.
- Provide shared step definitions: `givenSteps.ts` (G1–G26 setup vocabulary), `whenSteps.ts` (W1–W15 invocation vocabulary), `thenSteps.ts` (T1–T33 assertion vocabulary), `pythonFixtureE2ESteps.ts` (G-PY1, W-PY1, T-PY1 through T-PY6).
- Provide scenario-specific step-def files for promoted single-scenario features (e.g. `feature-729.steps.ts`) that keep their own module-scoped state and tag-scoped `Before`/`After` hooks (e.g. `{ tags: '@adw-729' }`) rather than sharing the generic registries.
- Provide `support/hooks.ts` for test lifecycle setup/teardown.

## Contracts & Invariants

- Every step phrase used in a regression scenario must appear in `vocabulary.md`; phrases that reference source file content (not artefacts) violate the rot-detection rubric and must not be added.
- `RegressionWorld.harnessEnv` is the canonical env overlay for subprocess invocations; steps must not mutate `process.env` directly.
- Scenarios tagged `@regression` are part of the regression suite; `@smoke` additionally marks the subset run in fast CI; `@python-e2e` tags the multilang fixture test.
- The surface matrix numbering is load-bearing for test organization; gaps in the sequence (e.g., no row-28) reflect deliberately removed scenarios.
- `W1` (subprocess invocation) populates `World.lastExitCode`; assertion step `T5` reads this field; they must be used together.

## Configuration

The regression suite runs via Cucumber.js. Configuration (paths, require globs, tags) is in the project's `cucumber.js` or equivalent config file. The mock infrastructure (`setupMockInfrastructure`) is initialized in `support/hooks.ts` before each scenario and torn down after.

## Gotchas

- The mock GitHub API server records real HTTP calls but cannot see GitHub App auth flows or `gh` GraphQL calls; scenarios that assert auth behavior must use `phase-import` pattern and call auth functions in-process.
- `RegressionWorld.worktreePaths` maps adwId to temp directories created per-scenario; these are isolated temp git repos, not the production worktrees directory.
- The Python e2e test (`@python-e2e`) depends on a fixture repo under `test/fixtures/` and requires the scenario proof pipeline to be functional; it is not a pure mock-query test.
- Step definitions for `W1` spawn real subprocesses; test isolation depends entirely on the `harnessEnv` overlay pointing processes at mock infrastructure rather than live GitHub.
- The built-in `adws/promotion/` automated flow has never successfully promoted a `features/per-issue/` scenario into this suite (no step-def relocation, no vocabulary registration, no `@regression` tag). Real promotions are done by hand: `git mv` the `.feature` and `.steps.ts` files, prepend `@regression` to the feature-level tag line, and register the scenario's novel phrases in `vocabulary.md` — as done for `feature-729.feature` into `features/regression/upgrade/`.
- The `@regression` mock infrastructure (`setupMockInfrastructure`) is transparent to promoted scenarios that only use local git subcommands (`init`, `add`, `commit`, `rev-parse`, `show`, `check-ignore`, etc.) — `test/mocks/git-remote-mock.ts` only intercepts network subcommands (`push`, `fetch`, `clone`, `pull`, `ls-remote`) and delegates everything else to real git.
