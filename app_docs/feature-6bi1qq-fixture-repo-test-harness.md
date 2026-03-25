# Fixture Target Repo + Test Harness + First Behavioral Review Scenario

**ADW ID:** 6bi1qq-fixture-target-repo
**Date:** 2026-03-25
**Specification:** specs/issue-279-adw-6bi1qq-fixture-target-repo-sdlc_planner-fixture-repo-test-harness.md

## Overview

This feature completes the behavioral testing layer for the review phase by adding a fixture target repository, extending the test harness with git-initialized fixture repo support, and writing end-to-end BDD scenarios that exercise the review phase against all mocked boundaries. Together with the mock infrastructure from issue #275, it enables deterministic, cost-free review testing using canned JSONL payloads instead of live services.

## What Was Built

- **Fixture target repo** at `test/fixtures/cli-tool/` — a minimal `.adw/`-configured CLI project with source files that agents can operate on during tests
- **`setupFixtureRepo()` / `teardownFixtureRepo()`** — new test harness functions that copy the fixture template to a temp directory and initialize it as a real git repo
- **`FixtureRepoContext` type** — a new interface in `test/mocks/types.ts` tracking the temp repo path and cleanup function
- **Structured review payload** at `test/fixtures/jsonl/payloads/review-agent-structured.json` — a `ReviewResult`-shaped JSONL fixture parseable by `extractJson()`
- **`features/fixture_repo_test_harness.feature`** — comprehensive BDD feature covering fixture repo creation, harness lifecycle, and review phase integration
- **`features/review_harness.feature`** — focused BDD feature with three progressively layered review scenarios (component, integration, end-to-end)
- **Step definitions** for both features (`fixtureRepoTestHarnessSteps.ts`, `reviewHarnessSteps.ts`) wiring all mock infrastructure together

## Technical Implementation

### Files Modified

- `test/mocks/test-harness.ts`: Added `setupFixtureRepo()` and `teardownFixtureRepo()` exports; imports `mkdtempSync`, `cpSync`, `tmpdir`
- `test/mocks/types.ts`: Added `FixtureRepoContext` interface

### Files Added

- `test/fixtures/cli-tool/.adw/commands.md`: Build/test/lint command mappings using `echo` for deterministic mock output
- `test/fixtures/cli-tool/.adw/project.md`: Project config — type: `cli`, unit tests: disabled
- `test/fixtures/cli-tool/.adw/scenarios.md`: BDD scenario configuration with echo-based runner
- `test/fixtures/cli-tool/.adw/review_proof.md`: Review proof tag configuration with `@review-proof` blocker
- `test/fixtures/cli-tool/.adw/providers.md`: Provider config — GitHub for both issue tracker and code host
- `test/fixtures/cli-tool/src/cli.ts`: Minimal CLI entry point (~15 lines, parses args and prints help)
- `test/fixtures/cli-tool/src/utils.ts`: Minimal utility module with `formatOutput()` function
- `test/fixtures/cli-tool/package.json`: Minimal package with `bin` entry
- `test/fixtures/cli-tool/tsconfig.json`: Strict-mode TypeScript config
- `test/fixtures/cli-tool/README.md`: One-line fixture description
- `test/fixtures/jsonl/payloads/review-agent-structured.json`: `ReviewResult` JSON embedded in a markdown code fence inside a `text` content block
- `features/fixture_repo_test_harness.feature`: Full BDD feature for harness lifecycle and review integration
- `features/review_harness.feature`: Three-scenario BDD feature tagged `@review-harness @regression`
- `features/step_definitions/fixtureRepoTestHarnessSteps.ts`: Step definitions for fixture harness scenarios
- `features/step_definitions/reviewHarnessSteps.ts`: Step definitions for review harness scenarios

### Key Changes

- **`setupFixtureRepo(fixtureName?)`** uses `mkdtempSync` to create an isolated temp directory per test run, copies the fixture template with `cpSync({ recursive: true })`, then runs `git init` / `git add .` / `git commit` using the real git binary resolved via `REAL_GIT_PATH` (set before PATH modification by the mock). This prevents cross-scenario contamination.
- **`teardownFixtureRepo(ctx)`** delegates to `ctx.cleanup()`, which does best-effort `rm -rf` on the temp base directory.
- **The structured JSONL payload** wraps a `ReviewResult` object in a markdown code fence inside a `text`-type content block — exactly how the real Claude CLI returns structured JSON, allowing `extractJson()` to parse it transparently.
- **Three-scenario layering** in `review_harness.feature`: (1) CLI stub output validation, (2) mock server comment recording, (3) full review flow — designed so failures are easy to diagnose by layer.
- **Fixture `.adw/commands.md`** uses `echo` commands (e.g. `echo "1 scenario (1 passed)"`) instead of real Cucumber to ensure deterministic BDD proof output without a full test environment inside the fixture.

## How to Use

### Running the Review Harness Scenarios

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-harness"
```

### Running the Fixture Repo Test Harness Scenarios

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-6bi1qq-fixture-target-repo"
```

### Running the Full Regression Suite

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

### Using the Harness in Custom Step Definitions

```typescript
import { setupFixtureRepo, teardownFixtureRepo } from '../../test/mocks/test-harness.ts';

// In a Before hook (after setupMockInfrastructure):
const fixtureCtx = setupFixtureRepo('cli-tool'); // returns { repoDir, cleanup }

// In an After hook:
teardownFixtureRepo(fixtureCtx);
```

The `fixtureCtx.repoDir` is the absolute path to the temporary git repo — pass it as `cwd` to any agent that needs a working directory.

## Configuration

No new environment variables are required. The fixture repo setup relies on:

- `REAL_GIT_PATH` — set automatically by `setupMockInfrastructure()` before the git remote mock intercepts PATH. If not set, `findRealGit()` resolves the real git binary.
- `MOCK_FIXTURE_PATH` — set in step definitions to point the CLI stub to `review-agent-structured.json`. Cleared in the `After` hook.

## Testing

```bash
# Verify new scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-harness"

# Verify existing mock infrastructure scenarios still pass
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"

# Full regression
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- The fixture repo is a static template — git initialization happens at runtime per scenario. This means each scenario gets a clean, isolated repo with no shared git state.
- The `review-agent-structured.json` payload returns a `ReviewResult` with one `tech-debt` severity issue and `success: true`, providing a realistic but deterministic baseline for assertions.
- No Docker is required — the full harness runs on the host with `bun` and the system `git` binary.
- The three review harness scenarios are intentionally layered: component (CLI stub output) → integration (mock server recording) → end-to-end (full flow). This makes it easier to isolate failures to a specific layer.
