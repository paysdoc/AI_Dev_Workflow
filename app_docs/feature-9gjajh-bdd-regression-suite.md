# BDD Regression Suite

## Overview

`features/regression/` is the permanent, executed BDD test suite for ADW. It contains feature files covering the full SDLC surface matrix (orchestrators, phases, edge cases, smoke paths), a typed Cucumber World, shared step definitions, and the vocabulary registry that governs which per-issue scenario patterns are eligible for promotion into this suite. Two supporting layers make the suite hermetic: `test/mocks/` (the mocked GitHub API, git remote, and Claude CLI that step definitions run against, wired together by a composition-root test harness) and the Docker-based runner (`test/Dockerfile` + `test/docker-run.sh`) that re-executes the suite inside a read-only container as a second, isolated leg of CI.

## Responsibilities

- Maintain `vocabulary.md`: the canonical registry of regression step phrases with their semantics, execution pattern (`subprocess`, `phase-import`, `mock-query`), and assertion targets. Defines the rot-detection rubric (phrases must assert observable system behavior, not source-code properties).
- Define five observable assertion surfaces: state files, recorded HTTP requests (mock server), git artefacts, exit codes, and log streams.
- Define three execution patterns: subprocess (spawns orchestrator binary), phase-import (imports a phase function directly), and mock-query (inspects recorded calls only without running a subprocess).
- Maintain `features/regression/smoke/` — high-level end-to-end smoke scenarios (`adw_sdlc_happy_path`, `cron_trigger_spawn`, `pause_resume_rate_limit`, `cancel_directive`, `promotion_commenter`, `promotion_mover`, `promotion_threshold_auto_ramp`, `adw_chore_diff_verdicts`).
- Maintain `features/regression/surfaces/` — the SDLC surface matrix: 35 row-numbered `.feature` files covering each orchestrator × phase × happy/edge-case combination from `adwPlan` workflow init through `adwDocument` and `adwSdlc` cron scenarios.
- Maintain `features/regression/multilang/` — Python fixture e2e regression.
- Maintain `features/regression/upgrade/` — promoted single-scenario-file features for the `adwUpgrade` lane (e.g. `feature-729.feature`), each paired with its own scenario-specific step-def file directly under `features/regression/step_definitions/` (not folded into the shared given/when/then registries).
- Maintain `features/regression/hashing/` — promoted single-scenario-file features for the framework content-hash lane (e.g. `feature-537.feature`, the `computeFrameworkHash` deep-module contract), following the same subject-named-subdirectory-plus-flat-step-def shape as `upgrade/`.
- Provide `RegressionWorld` (extends Cucumber `World`): typed container for `MockContext`, `lastExitCode`, `worktreePaths`, `prsByBranch`, `targetBranch`, `harnessEnv`, Python fixture state, and scenario proof results.
- Provide shared step definitions: `givenSteps.ts` (G1–G26 setup vocabulary), `whenSteps.ts` (W1–W15 invocation vocabulary), `thenSteps.ts` (T1–T33 assertion vocabulary), `pythonFixtureE2ESteps.ts` (G-PY1, W-PY1, T-PY1 through T-PY6).
- Provide scenario-specific step-def files for promoted single-scenario features (e.g. `feature-729.steps.ts`) that keep their own module-scoped state and tag-scoped `Before`/`After` hooks (e.g. `{ tags: '@adw-729' }`) rather than sharing the generic registries.
- Provide `support/hooks.ts` for test lifecycle setup/teardown; it initializes the mock infrastructure before each scenario and tears it down after.
- Provide the mock infrastructure (`test/mocks/`) that every step definition runs against: `test-harness.ts` is the composition root, exposing `setupMockInfrastructure(config?)` / `teardownMockInfrastructure()` for `Before`/`After` hooks, `resetMock()` to clear mock-server state between scenarios without restarting it, `setupFixtureRepo(fixtureName)` / `teardownFixtureRepo(ctx)` to materialize a real `git init`-ed working directory from a `test/fixtures/{fixtureName}/` template, and `createGitMockDir` / `cleanupGitMockDir` to stand up the temp directory holding the `git` wrapper that delegates to `git-remote-mock.ts`. The mocked services are the GitHub API server (`github-api-server.ts`), the Claude CLI stub (`claude-cli-stub.ts`), and the git remote mock.
- Provide the Docker-based hermetic runner: `test/Dockerfile` (a generic `oven/bun:latest` image with Git installed, no ADW source baked in — the repo is supplied via volume mount at run time) and `test/docker-run.sh` (builds the image, cached unless `--build` is passed, then runs it, mounting the repo read-only at `/workspace` with an anonymous volume over `/workspace/node_modules`). The `regression` job in `.github/workflows/regression.yml` runs the host-leg suite first, then `bun run test:docker:build` and `test/docker-run.sh --tags "@regression"` for the Docker leg.

## Contracts & Invariants

- Every step phrase used in a regression scenario must appear in `vocabulary.md`; phrases that reference source file content (not artefacts) violate the rot-detection rubric and must not be added.
- `RegressionWorld.harnessEnv` is the canonical env overlay for subprocess invocations; steps must not mutate `process.env` directly.
- Scenarios tagged `@regression` are part of the regression suite; `@smoke` additionally marks the subset run in fast CI; `@python-e2e` tags the multilang fixture test.
- The surface matrix numbering is load-bearing for test organization; gaps in the sequence (e.g., no row-28) reflect deliberately removed scenarios.
- `W1` (subprocess invocation) populates `World.lastExitCode`; assertion step `T5` reads this field; they must be used together.
- All scratch state — on the host and inside the Docker leg — must live under `os.tmpdir()` (or the Dockerfile's dedicated `/tmp/bdd` directory) and never under `process.cwd()`: `createGitMockDir` and `setupFixtureRepo` both use `mkdtempSync(join(tmpdir(), '<prefix>-'))`, and the Docker leg separately mounts the repo read-only at `/workspace` (`-v "${REPO_ROOT}:/workspace:ro"`) by design — `/tmp`/`os.tmpdir()` is the location both the harness-side and container-side halves of this contract agree is always writable.
- `node_modules` is the only writable path under `/workspace` in the Docker leg — it's overlaid with an anonymous Docker volume so `bun install --frozen-lockfile` (run at container start, per the Dockerfile `CMD`) can install fresh every run without polluting the host checkout.
- The Docker image pre-configures `git config --system --add safe.directory /workspace` at build time, because the mounted repo is owned by the host/CI-runner UID, which differs from the container user — git ≥2.35.2 otherwise refuses to operate on it ("dubious ownership"). System-level config covers every container user and survives env-sanitized subprocess spawns.
- The `regression` job is time-bounded: `timeout-minutes: 15` is set at the job level (covering both the host and Docker legs), so a hang in either leg costs minutes of runner time, not GitHub's 360-minute default.
- `TEST_RUNTIME=docker` is set as an image `ENV` so code under test (and the mock harness) can detect the container runtime if it ever needs runtime-specific behavior, though current code intentionally avoids branching on it in favor of the runtime-agnostic `os.tmpdir()` scratch location.
- `teardownMockInfrastructure()` is unconditional and idempotent: it has no `isSetUp` guard — every step it performs (`stopMockServer()`, `cleanupGitMockDir()`, env restore) is individually guarded on the resource it releases (`activeServer`, `gitMockTempDir`, `savedEnv`), so calling it before, during, or after a successful setup is always safe and never double-closes or throws.
- `setupMockInfrastructure()` is crash-safe: everything after `savedEnv` is captured runs inside a `try/catch`; any failure (e.g. the git-mock temp dir can't be created) triggers `await teardownMockInfrastructure()` before the error is rethrown, so a mock server that started listening is always stopped even if a later setup step throws.
- Environment mutation by `setupMockInfrastructure` is fully reversible: `savedEnv` snapshots every variable it is about to overwrite; teardown restores each one (or deletes it, if it was previously unset) rather than assuming a fixed baseline.

## Configuration

The regression suite runs via Cucumber.js. Configuration (paths, require globs, tags) is in the project's `cucumber.js` or equivalent config file.

- `MOCK_FIXTURE_PATH`, `MOCK_STREAM_DELAY_MS` — control the Claude CLI stub's canned JSONL output and streaming delay; `MOCK_STREAM_DELAY_MS` is forwarded into the Docker container if set on the host.
- `GH_HOST`, `GH_TOKEN`, `MOCK_GITHUB_API_URL`, `MOCK_SERVER_PORT` — set by `setupMockInfrastructure` to route `gh`/HTTP calls to the mock server; restored by teardown.
- `CLAUDE_CODE_PATH` — overridden to point at `claude-cli-stub.ts` for the duration of the mock session.
- `REAL_GIT_PATH` — the real `git` binary path, resolved before `PATH` is modified, so `setupFixtureRepo` and other real-git callers can bypass the mock wrapper.
- `BDD_TAGS` (default `@regression`) — the Cucumber tag filter used by the Docker leg, overridable via `--tags` on `docker-run.sh` or `-e BDD_TAGS=...` directly.
- `--build` (flag on `docker-run.sh`) — forces an image rebuild even if `adw-bdd-runner:latest` is already cached.
- `--shell` (flag on `docker-run.sh`) — opens an interactive shell inside the container (entrypoint override) for debugging mount/permission issues.

## Gotchas

- The mock GitHub API server records real HTTP calls but cannot see GitHub App auth flows or `gh` GraphQL calls; scenarios that assert auth behavior must use `phase-import` pattern and call auth functions in-process.
- `RegressionWorld.worktreePaths` maps adwId to temp directories created per-scenario; these are isolated temp git repos, not the production worktrees directory.
- The Python e2e test (`@python-e2e`) depends on a fixture repo under `test/fixtures/` and requires the scenario proof pipeline to be functional; it is not a pure mock-query test.
- Step definitions for `W1` spawn real subprocesses; test isolation depends entirely on the `harnessEnv` overlay pointing processes at mock infrastructure rather than live GitHub.
- The built-in `adws/promotion/` automated flow has never successfully promoted a `features/per-issue/` scenario into this suite (no step-def relocation, no vocabulary registration, no `@regression` tag). Real promotions are done by hand: `git mv` the `.feature` and `.steps.ts` files, prepend `@regression` to the feature-level tag line, and register the scenario's novel phrases in `vocabulary.md` — as done for `feature-729.feature` into `features/regression/upgrade/` and `feature-537.feature` into `features/regression/hashing/`.
- A promoted scenario keeps its pre-promotion tags (e.g. `@adw-537`) alongside the added `@regression` tag; scenario-specific `Before`/`After` hooks keyed on those tags (e.g. `{ tags: '@adw-537' }`) continue to scope cleanup to that one feature after the move.
- The `@regression` mock infrastructure (`setupMockInfrastructure`) is transparent to promoted scenarios that only use local git subcommands (`init`, `add`, `commit`, `rev-parse`, `show`, `check-ignore`, etc.) — `test/mocks/git-remote-mock.ts` only intercepts network subcommands (`push`, `fetch`, `clone`, `pull`, `ls-remote`) and delegates everything else to real git.
- A setup failure that orphans a listening mock HTTP server used to hang the whole process (Bun's event loop stays alive on an open socket) — inside the Docker leg this silently turned a CI failure into a 6-hour job timeout before `setupMockInfrastructure`'s crash-safety and `teardownMockInfrastructure`'s unconditional-teardown invariants were added; the job-level `timeout-minutes: 15` is now the backstop if a hang recurs.
- A hang inside the Docker container does not surface as a normal test failure — `docker run` simply never returns; without the job-level `timeout-minutes` backstop, GitHub's default 360-minute timeout would be the only thing that stops it.
- Every scenario failure inside the container should be checked against the read-only `/workspace` mount before assuming it's a logic bug — an `EROFS` error at a path under `/workspace` almost always means some helper tried to write into the mounted repo tree instead of `os.tmpdir()`/`/tmp/bdd`.
- The Docker image has no ADW source baked in, so a stale cached image (`docker image inspect` hit, no `--build` passed) can mask source changes that aren't otherwise re-triggering `bun install` — pass `--build` when in doubt.
- `createGitMockDir`'s temp dir is prefixed `adw-git-mock-` and is unique per call (via `mkdtempSync`), so there is no fixed-name collision risk between concurrent setups.
- `test/mocks/__tests__/test-harness.test.ts` exercises the mock-infrastructure invariants directly (writable-location assertion via `os.tmpdir()`, teardown-always-closes-server by calling `startMockServer` directly before teardown, and setup-crash-safety by pointing `TMPDIR` at a non-existent path) — it's the fastest way to reproduce either bug deterministically without Docker.
