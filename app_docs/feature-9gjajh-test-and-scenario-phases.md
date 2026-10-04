# Test and Scenario Phases

## Overview

The test and scenario phases validate the implementation against the project's static checks, test suite and BDD scenarios. The unit test phase first runs the static checks (type check, additional type checks, lint, build) through the check runner as deterministic exit-code gates, then the configured test command; the scenario phase generates BDD feature files; the scenario test phase executes tagged scenarios; the scenario test fix loop ties them together with retry and fidelity governance.

## Responsibilities

- `scenarioPhase.ts` — runs `runScenarioAgent` in the worktree to generate or update BDD feature files; non-fatal — errors are caught and returned as zero-cost results
- `scenarioPhase.ts` — skips scenario authoring entirely, before `/scenario_writer` is invoked, for issues carrying either `regression-promotion` or `adw:none`, via the pure `scenarioAuthoringSkipReason` reader and its `shouldSkipScenarioAuthoring` boolean face (`adws/core/adwLabels.ts`, #820 — `adws/github/labelManager.ts` was deleted outright in #821, no re-export); promotion issues relocate an already-existing per-issue scenario into the regression suite and must never author a fresh, spurious `features/per-issue/feature-<N>.feature`, and an `adw:none` issue opted out of ADW automation so it is never handed an authoring agent. The reader is a pure read of labels the phase already holds on `config.issue` — no forge call. `alignmentPhase.ts` (`app_docs/feature-9gjajh-build-and-plan-phases.md`) carries an independent, defense-in-depth copy of the same gate, logging the deciding label.
- `scenarioPhase.ts` — skips when `shouldExecuteStage('plan_validating', recoveryState)` returns false, indicating the phase already completed in a prior run
- `checkRunner.ts` (`adws/core/`) — `runStaticChecks(commands, cwd, runProcess?)` runs `typeCheck`, `additionalTypeChecks`, `runLinter`, `runBuild` from the parsed `.adw/commands.md` in that fixed order and returns exactly four `CheckVerdict`s (`check`, `command`, `status`, `exitCode`, `output`). It is the only place a static check is executed; it knows nothing of agents, phases or GitHub
- `checkRunner.ts` — verdict is the exit code alone: `0` is `passed`, anything else (including `null` from a signal or spawn failure) is `failed`; an `N/A` or blank command is `skipped` (never run, `exitCode: null`, empty output); a runner that throws yields a `failed` verdict carrying the error text. The default `runShellCommand` spawns with `shell: true`, stdin ignored, and captures stdout and stderr interleaved into one `output` string
- `unitTestPhase.ts` — after the board move and `reportStackCoherence`, runs the static-check gate (`runStaticCheckGate`) whatever `unitTests` says; logs every verdict to the console and `execution.log` (full output for a failed check); on any red check ends the run through `endRunOnFailedGate` naming every failed check and exit code
- `unitTestPhase.ts` — only then, and only when `.github/adw.yml` `unitTests` is enabled (default), runs `runUnitTestsWithRetry` with `config.projectConfig.commands.runTests`; evaluates the JUnit report for `hard-fail` vs `warn` vs pass; applies `ADW_UNVERIFIED_LABEL` on warn
- `unitTestPhase.ts` — posts stage comments via `postIssueStageComment`; terminates the process with `exit(1)` on a red check or a unit-test hard-fail; accepts an optional `deps` (`runProcess`, `runUnitTestsWithRetry`) so tests can inject fakes
- `.claude/commands/test.md` — the `/test` agent runs only `## Run Tests` and emits the `app_tests` JSON entry; it runs no lint, type check or build
- `scenarioTestPhase.ts` — reads the project-configured `runScenariosByTag` command and skips when it is `'N/A'` or `scenariosMd` is empty; optionally wraps scenario execution in `withDevServer` when `startDevServer` is configured; calls `runScenarioProof` and returns a `ScenarioProofResult`
- `scenarioTestFixLoop.ts` — drives the outer retry loop (bounded by `MAX_TEST_RETRY_ATTEMPTS`); on first green after resolve, runs a post-resolve fidelity check via `runScenarioFidelityAgent`; throws `ScenarioHermeticityError` when blocker scenarios still fail at budget exhaustion; throws `GoalFidelityError` when scenarios pass but are misaligned with the issue after resolution

## Contracts & Invariants

- `unitTestPhase.ts` hard-fails by calling `process.exit(1)`, not by throwing; the process terminates when a static check is red or the unit-test verdict is `hard-fail`, both through `endRunOnFailedGate`
- Static checks always run before the test run; `unitTests: false` skips only the test run, never the checks
- `runStaticChecks` always reports all four checks in fixed order; a failing check does not stop the ones after it
- The GitHub error comment names failed checks and exit codes only; the full output stays in the console log and `execution.log`
- Outside `projectConfig.ts`, `checkRunner.ts` is the only TypeScript reader of `runLinter`, `typeCheck`, `additionalTypeChecks`, `runBuild`
- `unitTestPhase.ts` always returns `unitTestsPassed: true` at the function level; callers that need the distinction must inspect `phaseCostRecords` status or intercept `process.exit`
- `scenarioTestPhase.ts` returns `scenarioProof: undefined` when scenarios are not configured; callers must null-check before reading `scenarioProof.resultsFilePath`
- `scenarioTestFixLoop.ts` `budgetRemaining` is `attempt < maxAttempts - 1`; when budget is exhausted, `computeResolveVerdict` returns `'hard-fail'`
- A `'regression_possible'` result from the `@regression` tag run causes `computeResolveVerdict` to treat the run as not-green even when the issue-tagged scenarios pass
- Post-resolve fidelity check only runs when `findScenarioFiles(issueNumber, worktreePath).length > 0`; if no scenario files exist the fidelity result is treated as undefined (aligned)
- `OutputValidationError` from `runScenarioFidelityAgent` degrades to `postResolveAligned = undefined` (warn-only), not a hard fail
- The promotion-issue skip gate in `scenarioPhase.ts` returns the same zero-cost shape (`{ costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] }`) as its own resume-skip guard, so cost/token/state accounting is identical whether the phase was skipped for "already ran" or "promotion issue" reasons. The label check is match-exact, not substring, and fires identically on fresh and resumed runs.
- Because a promotion issue authors zero scenario files, `findScenarioFiles(issueNumber, worktreePath).length === 0` downstream — the same "no scenario files" handling already covered above (`scenarioTestPhase.ts` returning `scenarioProof: undefined`, the fidelity check treating it as aligned) applies unchanged; no separate gate was needed in the test/fix phases themselves.

## Configuration

- `.github/adw.yml` `unitTests: false` — skips the unit-test run only (opt-out; absent key means enabled); static checks still run
- `config.projectConfig.commands.typeCheck`, `additionalTypeChecks`, `runLinter`, `runBuild` — static-check commands; `N/A` skips a check
- `config.projectConfig.commands.runTests` — unit test command (default `bun run test:unit`)
- `config.projectConfig.commands.runScenariosByTag` — BDD tag runner template
- `config.projectConfig.commands.startDevServer` — dev server start command (optional)
- `config.projectConfig.commands.healthCheckPath` — dev server health check path
- `MAX_TEST_RETRY_ATTEMPTS` — upper bound for the scenario test/fix loop (default: 5)

## Gotchas

- Commands run verbatim: a command wrapped in a markdown code fence or carrying an HTML comment fails in the shell (e.g. exit 127) and the check is red, never a silent green
- An absent `.adw/commands.md` section falls back to ADW's own defaults (`bun run lint`, `bunx tsc --noEmit`, …), which run in the target repo and may be red; `N/A` opts a check out
- No timeout is applied to a check; a hung check holds the phase
- The `cli-tool` regression fixture declares plain green static-check commands so the real gate passes in surface rows and smoke runs; its fenced scenario commands must stay as they are
- `unitTestPhase.ts` sets `process.env.ADW_UNIT_TEST_REPORT_PATH` before running tests and cleans up the existing file with `fs.rmSync`; downstream test tooling must honour this env variable to produce the JUnit report at the expected path
- `scenarioTestPhase.ts` injects the port extracted from `config.applicationUrl` into `withDevServer`; if `applicationUrl` is not a parseable URL, the port defaults to 3000
- `scenarioTestFixLoop.ts` runs `executeScenarioFixPhase` before incrementing `scenarioRetries`; the fix phase runs before the retry count is visible to state observers
- `applyLabel` for `ADW_UNVERIFIED_LABEL` in `unitTestPhase.ts` is wrapped in a try/catch because GitHub App auth lacks label-write permission; failure is silently swallowed
- A promotion issue's own `@adw-<issueNumber>` review-proof tag has no matching scenarios once scenario authoring is skipped; with `optional: true` on a zero-match tag, its tag outcome is `{ passed: true, skipped: true }` and never counts toward `hasBlockerFailures` — the run stays green on that tag while the relocated scenario's own `@regression` tag pass still proves the promotion for real. Do not make that tag non-optional without exempting promotion issues, or every promotion run reddens once scenario authoring stops producing a matching scenario.

## Decisions

- [ADR-0014](../specs/adr/0014-bdd-as-validation-contract-unit-tests-removed.md) — BDD scenarios as the validation contract, ADW unit tests removed
- [ADR-0018](../specs/adr/0018-unit-tests-restored-alongside-bdd.md) — Unit tests restored alongside BDD scenarios
- [ADR-0031](../specs/adr/0031-active-test-phase-passive-review-judge.md) — Active test phase, passive review judge
- [ADR-0043](../specs/adr/0043-multi-language-test-seam.md) — Multi-language test seam: detected descriptor, Gherkin mandate, JUnit report rail
- [ADR-0049](../specs/adr/0049-promotion-sweep-files-human-gated-issue.md) — Promotion sweep files a human-gated issue for the normal pipeline
- [ADR-0058](../specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md) — Static checks are deterministic gates in the test phase; the reviewer runs nothing and `review_proof.md` is gone
