# Test and Scenario Phases

## Overview

The test and scenario phases validate the implementation against the project's test suite and BDD scenarios. The unit test phase runs the configured test command; the scenario phase generates BDD feature files; the scenario test phase executes tagged scenarios; the scenario test fix loop ties them together with retry and fidelity governance.

## Responsibilities

- `scenarioPhase.ts` — runs `runScenarioAgent` in the worktree to generate or update BDD feature files; non-fatal — errors are caught and returned as zero-cost results
- `scenarioPhase.ts` — skips when `shouldExecuteStage('plan_validating', recoveryState)` returns false, indicating the phase already completed in a prior run
- `unitTestPhase.ts` — reads `.github/adw.yml` `unitTests` field (default: enabled); runs `runUnitTestsWithRetry` with the project-configured command (`config.projectConfig.commands.runTests`); evaluates the JUnit report for `hard-fail` vs `warn` vs pass; applies `ADW_UNVERIFIED_LABEL` on warn
- `unitTestPhase.ts` — calls `reportStackCoherence` before running tests; posts stage comments via `postIssueStageComment`; terminates the process with `exit(1)` on hard-fail
- `scenarioTestPhase.ts` — reads the project-configured `runScenariosByTag` command and skips when it is `'N/A'` or `scenariosMd` is empty; optionally wraps scenario execution in `withDevServer` when `startDevServer` is configured; calls `runScenarioProof` and returns a `ScenarioProofResult`
- `scenarioTestFixLoop.ts` — drives the outer retry loop (bounded by `MAX_TEST_RETRY_ATTEMPTS`); on first green after resolve, runs a post-resolve fidelity check via `runScenarioFidelityAgent`; throws `ScenarioHermeticityError` when blocker scenarios still fail at budget exhaustion; throws `GoalFidelityError` when scenarios pass but are misaligned with the issue after resolution

## Contracts & Invariants

- `unitTestPhase.ts` hard-fails by calling `process.exit(1)`, not by throwing; the process terminates when verdict is `hard-fail`
- `unitTestPhase.ts` always returns `unitTestsPassed: true` at the function level; callers that need the distinction must inspect `phaseCostRecords` status or intercept `process.exit`
- `scenarioTestPhase.ts` returns `scenarioProof: undefined` when scenarios are not configured; callers must null-check before reading `scenarioProof.resultsFilePath`
- `scenarioTestFixLoop.ts` `budgetRemaining` is `attempt < maxAttempts - 1`; when budget is exhausted, `computeResolveVerdict` returns `'hard-fail'`
- A `'regression_possible'` result from the `@regression` tag run causes `computeResolveVerdict` to treat the run as not-green even when the issue-tagged scenarios pass
- Post-resolve fidelity check only runs when `findScenarioFiles(issueNumber, worktreePath).length > 0`; if no scenario files exist the fidelity result is treated as undefined (aligned)
- `OutputValidationError` from `runScenarioFidelityAgent` degrades to `postResolveAligned = undefined` (warn-only), not a hard fail

## Configuration

- `.github/adw.yml` `unitTests: false` — disables unit tests (opt-out; absent key means enabled)
- `config.projectConfig.commands.runTests` — unit test command (default `bun run test:unit`)
- `config.projectConfig.commands.runScenariosByTag` — BDD tag runner template
- `config.projectConfig.commands.startDevServer` — dev server start command (optional)
- `config.projectConfig.commands.healthCheckPath` — dev server health check path
- `MAX_TEST_RETRY_ATTEMPTS` — upper bound for the scenario test/fix loop (default: 5)

## Gotchas

- `unitTestPhase.ts` sets `process.env.ADW_UNIT_TEST_REPORT_PATH` before running tests and cleans up the existing file with `fs.rmSync`; downstream test tooling must honour this env variable to produce the JUnit report at the expected path
- `scenarioTestPhase.ts` injects the port extracted from `config.applicationUrl` into `withDevServer`; if `applicationUrl` is not a parseable URL, the port defaults to 3000
- `scenarioTestFixLoop.ts` runs `executeScenarioFixPhase` before incrementing `scenarioRetries`; the fix phase runs before the retry count is visible to state observers
- `applyLabel` for `ADW_UNVERIFIED_LABEL` in `unitTestPhase.ts` is wrapped in a try/catch because GitHub App auth lacks label-write permission; failure is silently swallowed
