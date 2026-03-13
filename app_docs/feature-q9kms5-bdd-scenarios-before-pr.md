# BDD Scenarios Before PR — Test Phase Refactor

**ADW ID:** q9kms5-refactor-test-phase
**Date:** 2026-03-13
**Specification:** specs/issue-167-adw-q9kms5-refactor-test-phase-sdlc_planner-refactor-test-phase-bdd-first.md

## Overview

This feature refactors the ADW test phase to run BDD scenarios _before_ PR creation, gating the PR on scenario success. The previous pipeline created PRs for untested code (`Build → PR → Tests → Review`); the new pipeline is `Build → [Unit Tests] → BDD Scenarios → PR → Review`. Unit tests become opt-in via a `## Unit Tests` indicator in `.adw/project.md` (disabled by default).

## What Was Built

- **`bddScenarioRunner.ts`** — New subprocess executor that runs the tag-filtered BDD scenario command (`@adw-{issueNumber}`) and returns a structured `BddScenarioResult`.
- **`runBddScenariosWithRetry`** — New retry wrapper in `testRetry.ts` that uses the existing resolve-agent loop to fix failures and re-run, mirroring E2E retry behaviour.
- **`parseUnitTestsEnabled`** — New helper in `projectConfig.ts` that reads `.adw/project.md` and returns `true` only when `## Unit Tests` is `enabled`.
- **`runBddScenarios` field in `CommandsConfig`** — New config field parsed from `## Run BDD Scenarios` in `.adw/commands.md`; defaults to `N/A` (skip).
- **`testPhase.ts` refactor** — Phase now runs optional unit tests then BDD scenarios; replaces `e2eTestsPassed` with `bddScenariosPassed` in results.
- **Six orchestrator updates** — `adwPlanBuild`, `adwPlanBuildTest`, `adwPlanBuildReview`, `adwPlanBuildDocument`, `adwPlanBuildTestReview`, `adwSdlc` all reflect the new phase order; `adwPlanBuild`, `adwPlanBuildReview`, and `adwPlanBuildDocument` gained a test phase they previously lacked.
- **`adwTest.tsx` refactor** — Standalone test orchestrator updated to match new BDD-first logic.

## Technical Implementation

### Files Modified

- `adws/agents/bddScenarioRunner.ts` *(new)* — Subprocess executor; replaces `{issueNumber}` in command template, spawns with `shell: true`, returns `{ allPassed, stdout, stderr, exitCode }`. Returns `allPassed: true` immediately when command is `N/A`.
- `adws/agents/testRetry.ts` — Added `BddScenarioRetryOptions` and `runBddScenariosWithRetry`; reuses `runResolveE2ETestAgent` for failure resolution.
- `adws/agents/index.ts` — Barrel exports updated to expose `runBddScenarios`, `BddScenarioResult`, `runBddScenariosWithRetry`, `BddScenarioRetryOptions`.
- `adws/core/projectConfig.ts` — Added `runBddScenarios` to `CommandsConfig`, `'run bdd scenarios'` to `HEADING_TO_KEY`, `'N/A'` default, and `parseUnitTestsEnabled` function.
- `adws/core/index.ts` — Exports `parseUnitTestsEnabled`.
- `adws/phases/testPhase.ts` — Replaced E2E gate with optional unit-test gate + mandatory BDD gate; return type changed (`e2eTestsPassed` → `bddScenariosPassed`).
- `adws/adwPlanBuild.tsx` — Added `executeTestPhase` between build and PR; updated JSDoc and `completeWorkflow` metadata.
- `adws/adwPlanBuildReview.tsx` — Same as above; workflow now `Plan → Build → Test → PR → Review`.
- `adws/adwPlanBuildDocument.tsx` — Same as above; workflow now `Plan → Build → Test → PR → Document`.
- `adws/adwPlanBuildTest.tsx` — Updated JSDoc and metadata (`bddScenariosPassed`).
- `adws/adwPlanBuildTestReview.tsx` — Updated JSDoc and metadata.
- `adws/adwSdlc.tsx` — Updated JSDoc and metadata.
- `adws/adwTest.tsx` — Refactored to BDD-first: reads `projectConfig`, checks unit test opt-in, runs BDD scenarios.
- `.adw/commands.md` — Added `## Run BDD Scenarios` section with value `N/A`.

### Key Changes

- **Pipeline reorder**: BDD scenarios now run _before_ PR creation in all six orchestrators. Three orchestrators (`adwPlanBuild`, `adwPlanBuildReview`, `adwPlanBuildDocument`) previously had no test phase and now do.
- **Unit test opt-in**: `parseUnitTestsEnabled` handles both `## Unit Tests: enabled` (colon-inline) and `## Unit Tests` + body `enabled` formats; defaults to `false` when absent.
- **Graceful skip**: When `runBddScenarios` is `N/A` (or empty), `bddScenarioRunner.ts` returns `allPassed: true` immediately — the PR proceeds without failing.
- **Retry reuse**: `runBddScenariosWithRetry` wraps the subprocess runner with `runResolveE2ETestAgent` — the same AI-driven fix-and-retry loop used for E2E tests.
- **Result shape change**: `executeTestPhase` now returns `bddScenariosPassed` instead of `e2eTestsPassed`; all orchestrators pass this into `completeWorkflow` metadata.

## How to Use

1. **Configure the BDD scenario command** in the target repo's `.adw/commands.md`:
   ```md
   ## Run BDD Scenarios
   npx cucumber-js --tags @adw-{issueNumber}
   ```
   The `{issueNumber}` placeholder is replaced at runtime with the actual issue number.

2. **Opt in to unit tests** (optional) in `.adw/project.md`:
   ```md
   ## Unit Tests: enabled
   ```
   Omit this section (or set `disabled`) to skip unit tests entirely.

3. **Run a workflow** — the test phase executes automatically between build and PR:
   ```sh
   bunx tsx adws/adwPlanBuild.tsx 123
   ```

4. **If scenarios fail**, the resolve-agent retries up to `MAX_TEST_RETRY_ATTEMPTS` times. If still failing, the workflow exits without creating a PR and posts an error comment on the issue.

## Configuration

| Location | Key | Default | Purpose |
|---|---|---|---|
| `.adw/commands.md` | `## Run BDD Scenarios` | `N/A` | Command template to run tag-filtered BDD scenarios |
| `.adw/project.md` | `## Unit Tests` | absent = `disabled` | Opt-in to running unit tests before BDD scenarios |

When `runBddScenarios` is `N/A` or absent, scenarios are skipped gracefully and the PR is created unconditionally (after any unit test gate, if enabled).

## Testing

- TypeScript compilation: `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`
- Lint: `bun run lint`
- Unit tests (ADW has them disabled): `bun run test`
- End-to-end: run a full workflow against an issue in a repo that has `## Run BDD Scenarios` configured; verify PR is only created after scenarios pass.

## Notes

- This feature depends on issue #164 (BDD scenario tagging conventions) and #165 (Scenario Planner Agent) for the scenario command format and tag convention (`@adw-{issueNumber}`).
- The existing Playwright/E2E infrastructure (`testDiscovery.ts`, `runE2ETestsWithRetry`) is no longer called by `testPhase.ts` but remains available for target repos that use Playwright directly.
- ADW's own `.adw/commands.md` sets `## Run BDD Scenarios: N/A` because ADW does not currently have Cucumber-style scenarios — the plumbing is for target repos.
