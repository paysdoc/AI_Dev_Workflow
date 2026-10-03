# Feature: Static checks run as deterministic gates in the unit-test phase; /test stops running them

## Metadata
issueNumber: `988`
adwId: `84aif7-feat-static-checks-r`
issueJson: `{"number":988,"title":"feat: static checks run as deterministic gates in the unit-test phase; /test stops running them","body":"Source: `specs/prd/review-proof-redesign.md` and the ADR named below, in `specs/adr/`. The PRD section **Implementation Decisions** describes the module; the ADR holds the decision and its reasons. Read both before planning; they are the specification. Do not change the decisions.\n\n## Decision record\n\nADR-0058 (static checks). PRD modules: **Check runner**, part of **Prompts** (`test.md`).\n\n## What to build\n\n- A **check runner** module: takes the parsed `.adw/commands.md` and a working directory; runs type check, additional type checks, lint and build, in that order; returns one verdict per check with the exit code and the captured output. `N/A` commands are skipped and reported as skipped. No agent is involved. This is the only place a static check is executed.\n- The unit-test phase calls the check runner before the test run. A red check fails the phase with the check's output in the log. (The fix loop that follows is a separate issue; until it lands, a red check ends the run the way an exhausted test loop does today.)\n- `unitTests: false` in `.github/adw.yml` skips only the test run. The static checks run regardless.\n- `.claude/commands/test.md` stops running lint, type check and build.\n\n## Acceptance criteria\n\n- [ ] Each configured check runs through the check runner; its verdict is its exit code; no agent decides a verdict.\n- [ ] With `unitTests: false` the checks still run and the test run is skipped.\n- [ ] `test.md` contains no lint, type-check or build command.\n- [ ] Unit tests for the check runner: verdict per exit code, `N/A` skipped, output captured, fixed order (fake process runner).\n- [ ] The `### Confirmation` section of ADR-0058 names the implemented check for the parts this issue delivers.\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-03T23:13:09Z","comments":[],"actionableComment":null}`

## Feature Description
ADW's unit-test phase today runs the `/test` agent, and `.claude/commands/test.md` tells that agent to run lint, type check, additional type checks and build before the unit tests. The phase's verdict is read from the JUnit report only, so the results of those four checks are thrown away: a red lint or a failing build never stops a run. The `runLinter`, `typeCheck`, `additionalTypeChecks` and `runBuild` values that `adws/core/projectConfig.ts` parses from `.adw/commands.md` have no TypeScript consumer at all. And when a repository sets `unitTests: false` in `.github/adw.yml`, the whole phase is skipped, static checks included.

This feature implements the static-check part of ADR-0058 (PRD `specs/prd/review-proof-redesign.md`, modules **Check runner** and the `test.md` part of **Prompts**):

1. A new **check runner** deep module (`adws/core/checkRunner.ts`) takes the parsed `.adw/commands.md` and a working directory, runs type check, additional type checks, lint and build in that fixed order, and returns one verdict per check carrying its exit code and captured output. An `N/A` command is skipped and reported as skipped. It knows nothing about agents, phases or GitHub, and it is the only place in ADW that executes a static check.
2. The unit-test phase calls the check runner **before** the test run, whatever `unitTests` says. A red check ends the run the same way an exhausted unit-test loop does today (error log, `## :x: ADW Workflow Error` comment, failed execution state, `process.exit(1)`), with every failing check's real output in the run log.
3. `unitTests: false` skips only the test run.
4. `/test` runs only the unit-test command; it no longer runs lint, type check or build.

The value: a green unit-test phase now means the configured static checks really passed, decided by exit codes rather than by whether an agent chose to run a command and read it.

## User Story
As an ADW operator
I want type check, additional type checks, lint and build to run as deterministic gates in the unit-test phase, with each check's exit code as its verdict, even when unit tests are turned off for a repository
So that a green run means those checks actually passed, and a red check stops the run with its real output in the log instead of being silently discarded

## Problem Statement
- The `/test` agent runs lint, type check and build, but `executeUnitTestPhase` derives its verdict from the JUnit report only (`runUnitTestsWithRetry` → `computeTestVerdict`), so a failed static check never fails a run. Whether a check ran at all depends on the agent.
- `runLinter`, `typeCheck`, `additionalTypeChecks` and `runBuild` in `CommandsConfig` are parsed but never executed by TypeScript.
- `unitTests: false` turns the whole phase off, so opting out of unit tests also opts out of lint, type check and build (ADR-0058: "No silent green").
- ADR-0058's decision ("TypeScript runs each command named in `.adw/commands.md`; the exit code is the verdict… They always run") is not implemented, and its `### Confirmation` says so.

## Solution Statement
- **Check runner (`adws/core/checkRunner.ts`).** A pure-orchestration module with one injectable seam, a `ProcessRunner` (`(command, cwd) => Promise<{ exitCode, output }>`). `runStaticChecks(commands, cwd, runProcess = runShellCommand)` walks a fixed `STATIC_CHECKS` table (type check → additional type checks → lint → build), sequentially. For each check it either reports `skipped` (command is `N/A`, case-insensitive, or blank, so no blank command can ever pass silently) or runs the command and turns the exit code into the verdict: `0` → `passed`, anything else (including `null`, i.e. killed by a signal or failed to spawn) → `failed`. Every check runs even after an earlier one fails, so the verdict list always has exactly four entries in fixed order. A runner that throws yields a `failed` verdict carrying the error text. The default runner `runShellCommand` spawns the command with `shell: true`, `stdin` ignored, and captures stdout and stderr interleaved into one `output` string, following the `bddScenarioRunner.ts` spawn pattern.
- **Unit-test phase (`adws/phases/unitTestPhase.ts`).** After the existing board move and `reportStackCoherence`, the phase runs a static-check gate: it calls `runStaticChecks(config.projectConfig.commands, config.worktreePath, runProcess)`, logs every verdict to the console logger and the orchestrator execution log (full output for a failed check), and if any check failed ends the run through the same helper the unit-test hard-fail path uses (extracted as `endRunOnFailedGate`). Only then, and only when `adwYmlConfig.unitTests` is true, does the existing test run start. An optional `deps` parameter (`runProcess`, `runUnitTestsWithRetry`) is added to `executeUnitTestPhase`, following the `executeDepauditSetup(config, deps?)` precedent, so a phase test can inject fakes. `runPhase` calls phases with `fn(config)` only, so every orchestrator keeps passing the function unchanged.
- **`/test` prompt.** `.claude/commands/test.md` keeps its JSON output contract (`app_tests`, which `testAgent.ts` reads) and its `## Test Execution Sequence` heading (which `patch.md` refers to), and drops the lint, type check, additional type check and build steps.
- **Fixture.** `test/fixtures/cli-tool/.adw/commands.md`, which the in-process surface rows and the `@subprocess` smoke runs use, gets plain (unfenced) static-check commands under the right headings, so the real check runner is green there. The fenced scenario commands that rows 21/22 rely on stay as they are.
- **Records.** ADR-0058's `### Confirmation` names the implemented checks; README and the `AdwYmlConfig` doc comment describe the new `unitTests` meaning.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/review-proof-redesign.md` — The specification: **Check runner** and **Prompts** under *Implementation Decisions*, and the *Testing Decisions* for the check runner (fake process runner; verdict per exit code; `N/A` skipped; output captured; fixed order). Read-only.
- `specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md` — The decision. Its `### Confirmation` section must be rewritten to name the implemented checks (acceptance criterion).
- `specs/adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md` — Context only. The future static-check fix loop compares the check runner's combined output between rounds, which is why `output` is one combined string. Do not implement the loop here.
- `README.md` — Project overview. Line 11 ("Per-repo unit-test gate via `adw.yml`") becomes inaccurate. The `adws/core/` and `adws/phases/` directory-tree entries (`adwYmlConfig.ts` line ~631, `authGate.ts`/`claudeStreamParser.ts` around line ~633, `unitTestPhase.ts` line ~856, and the `__tests__` listings around lines ~564 and ~811) need the new files. NOTE: the worktree already has an unrelated uncommitted README edit (a "Model-literal guard" bullet near line 22). Preserve it.
- `.adw/coding_guidelines.md` — Must be followed: guard clauses, max nesting ~2, extract named functions, enums for named constant sets, `readonly`/immutability, no `any`, comments only for invariants/ordering/non-obvious reasons (no issue numbers, no banners), files under 300 lines.
- `.adw/commands.md` — ADW's own commands. The check runner will run its `## Type Check`, `## Additional Type Checks`, `## Run Linter` and `## Run Build` on self-host runs. Also the source of the validation commands below. Read-only.
- `adws/core/projectConfig.ts` — `CommandsConfig` (`typeCheck`, `additionalTypeChecks`, `runLinter`, `runBuild`), `parseCommandsMd` (section text is trimmed, absent sections fall back to `getDefaultCommandsConfig()`, code fences are NOT stripped), `getDefaultProjectConfig()` for test configs. Not modified.
- `adws/core/index.ts` — Core barrel. Add the check runner's exports next to `computeTestVerdict` (lines ~84-85).
- `adws/core/adwYmlConfig.ts` — `AdwYmlConfig.unitTests`. Update the doc comment to the new meaning (test run only). Leave `ADW_YML_TEMPLATE` byte-identical (see Notes).
- `adws/core/testVerdict.ts` — `computeTestVerdict`. The `hard-fail` branch defines what "ends the run the way an exhausted test loop does today" means. Not modified.
- `adws/phases/unitTestPhase.ts` — The integration point: add the static-check gate before the test run, make it independent of `unitTests`, extract the shared fail-the-run helper, add the `deps` seam.
- `adws/agents/testRetry.ts` — `runUnitTestsWithRetry` / `TestRetryResult`. Its type is the injected test-run dependency of the phase. Not modified.
- `adws/agents/testAgent.ts` — Parses `/test` output (`TestResult[]`, reads the `app_tests` entry). The `test.md` JSON contract must stay compatible. Not modified.
- `adws/agents/bddScenarioRunner.ts` — Prior art for `spawn(command, [], { shell: true, stdio: ['ignore','pipe','pipe'] })` and the `N/A` skip convention.
- `adws/core/devServerLifecycle.ts` — Prior art for a core module that spawns processes.
- `adws/phases/depauditSetup.ts` — Prior art for a phase with an optional injected `deps` parameter.
- `adws/phases/phaseCommentHelpers.ts` — `postIssueStageComment(repoContext, issueNumber, 'error', ctx)` used by the fail-the-run path.
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — Prior art for a phase test config builder (`as unknown as WorkflowConfig`).
- `adws/core/__tests__/projectConfigCommands.test.ts` — Prior art for `CommandsConfig` test fixtures.
- `.claude/commands/test.md` — The `/test` prompt. Remove every lint, type-check, additional-type-check and build step. Keep the JSON contract and the `## Test Execution Sequence` heading.
- `.claude/commands/patch.md` — Line 29 points at `.claude/commands/test.md: ## Test Execution Sequence` as a validation fallback. Keep that heading name so the reference still resolves. Not modified.
- `test/fixtures/cli-tool/.adw/commands.md` — The fixture every regression surface row and `@subprocess` smoke run works in. Today its `## Lint` heading is not recognised (falls back to `bun run lint`), its `## Type Check`/`## Run Build` commands are wrapped in `sh` code fences (a shell exits 127 on them), and it has no `## Additional Type Checks` (falls back to `bunx tsc --noEmit -p adws/tsconfig.json`). Must be made green for the real check runner.
- `features/regression/support/phaseConfig.ts`, `features/regression/support/phaseRun.ts`, `features/regression/support/fixtureWorktree.ts`, `features/regression/support/fixtureTargetRepo.ts` — The in-process surface harness runs the real `executeUnitTestPhase` against the `cli-tool` fixture (`loadProjectConfig(worktreePath)`) and traps `process.exit`. The subprocess harness copies the same fixture. Read-only; explains why the fixture must change.
- `features/regression/surfaces/row-06-adwBuild-unitTestPhase-happy.feature`, `features/regression/surfaces/row-20-adwTest-unitTestPhase-happy.feature` — Regression rows that run the real unit-test phase and expect it to succeed. They break if the fixture's checks are red.
- `features/regression/surfaces/row-21-adwTest-scenarioTestPhase-happy.feature`, `features/regression/surfaces/row-22-adwTest-scenarioProof-happy.feature` — Rely on the fixture's fenced `## Run Scenarios by Tag` command exiting 127. Those sections must NOT be touched.
- `features/regression/smoke/adw_sdlc_happy_path.feature`, `features/regression/smoke/adw_chore_diff_verdicts.feature` — Real orchestrator subprocess runs that pass through the unit-test phase over the same fixture and assert no error.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — Conditional doc owning `unitTestPhase.ts` (its contracts: hard-fail via `process.exit(1)`, `unitTests` read, etc.).
- `app_docs/feature-9gjajh-state-and-config.md` — Conditional doc owning `projectConfig.ts` and `adwYmlConfig.ts`.
- `app_docs/feature-9gjajh-commands-and-skills.md` — Conditional doc owning `.claude/commands/test.md`.
- `app_docs/feature-9gjajh-scenario-and-stepdef-agents.md` — Conditional doc owning `testAgent.ts` and `testRetry.ts`.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — Conditional doc owning `features/regression/**` and the surface/subprocess harness that runs the fixture.

### New Files
- `adws/core/checkRunner.ts` — The check runner deep module (types, `STATIC_CHECKS` table, `runStaticChecks`, default `runShellCommand`).
- `adws/core/__tests__/checkRunner.test.ts` — Unit tests for `runStaticChecks` with a fake process runner.
- `adws/core/__tests__/checkRunner.integration.test.ts` — Real-process tests for the default `runShellCommand` (exit code, stdout+stderr capture, spawn failure). Follows the `*.integration.test.ts` naming of `upgradeClaim.integration.test.ts`/`guardrailsProbe.integration.test.ts`.
- `adws/phases/__tests__/unitTestPhase.test.ts` — Phase tests with injected fakes: checks run with `unitTests: false` and the test run is skipped; checks run before the test run; a red check ends the run before the test run with its output in the execution log.

## Implementation Plan
### Phase 1: Foundation
Build the check runner as a standalone module in `adws/core/`, test-first, with no dependency on agents, phases, forge or state:
- Types: `StaticCheckName` (string enum: `type check`, `additional type checks`, `lint`, `build`), `CheckStatus` (string enum: `passed`, `failed`, `skipped`), `StaticCheckCommands = Pick<CommandsConfig, 'typeCheck' | 'additionalTypeChecks' | 'runLinter' | 'runBuild'>`, `ProcessOutcome { readonly exitCode: number | null; readonly output: string }`, `ProcessRunner = (command: string, cwd: string) => Promise<ProcessOutcome>`, `CheckVerdict { readonly check; readonly command; readonly status; readonly exitCode: number | null; readonly output }`.
- `STATIC_CHECKS`: the fixed, ordered table mapping each `StaticCheckName` to its `CommandsConfig` key.
- `runStaticChecks` (sequential, all four always reported) and `runShellCommand` (default spawner).
- Export from the core barrel.

### Phase 2: Core Implementation
Wire the gate into `executeUnitTestPhase`:
- Add the `deps` seam (`runProcess`, `runUnitTestsWithRetry`) with defaults resolved inside the function.
- Extract the existing hard-fail block into `endRunOnFailedGate(config, errorMsg, costUsd): never` so the red-check path and the unit-test hard-fail path end the run identically.
- Add `runStaticCheckGate(config, runProcess)`: run the checks, log each verdict (full output for failures) via `log` and `AgentStateManager.appendLog`, and call `endRunOnFailedGate` naming every failed check and its exit code.
- Run the gate unconditionally, before the test run. Run the test run only when `adwYmlConfig.unitTests` is true. Extract the existing test-run block and the unverified-marking branch into named functions to keep nesting at most 2 and the file under 300 lines.

### Phase 3: Integration
- Make the `cli-tool` fixture's static checks green so the regression surface rows and smoke runs (which execute the real phase) keep passing.
- Strip lint, type check, additional type checks and build from `.claude/commands/test.md`.
- Rewrite ADR-0058's `### Confirmation` to name the implemented checks and keep the list of what is still unimplemented.
- Update README and the `AdwYmlConfig` doc comment.
- Run the full validation suite, including the `@adw-988` scenarios and the `@regression` suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Write the check runner unit tests first (RED)
- Create `adws/core/__tests__/checkRunner.test.ts` (Vitest). Import only from `../checkRunner`.
- Build a fake `ProcessRunner` that records every `{ command, cwd }` call in order and returns a scripted `ProcessOutcome` per command (default `{ exitCode: 0, output: '' }`). Optionally it can throw for a scripted command.
- Use a commands object such as `{ typeCheck: 'tc', additionalTypeChecks: 'atc', runLinter: 'lint', runBuild: 'build' }`.
- Cases (assert on the returned verdicts and the recorded calls, never on internals):
  - Runs type check, additional type checks, lint and build **in that order**, each in the given `cwd` (recorded calls equal `['tc','atc','lint','build']`). Returns exactly four verdicts whose `check` values are `StaticCheckName.TypeCheck`, `AdditionalTypeChecks`, `Lint`, `Build`, in that order.
  - Exit code `0` → `status: CheckStatus.Passed`, `exitCode: 0`.
  - Non-zero exit codes (e.g. `1`, `2`, `127`) → `status: CheckStatus.Failed`, `exitCode` carried through unchanged.
  - `exitCode: null` (signal / no code) → `CheckStatus.Failed`, `exitCode: null`.
  - `N/A` command → `CheckStatus.Skipped`, `exitCode: null`, `output: ''`, `command: 'N/A'`, and the fake runner is **never called** for it. Also cover `'  n/a  '` and an empty/whitespace command (skipped, not run, so a blank command can never pass silently).
  - Output is captured per check: each verdict's `output` equals the scripted output of its own command (distinct strings per command).
  - A failing check does not stop later checks: with lint failing, build still runs and four verdicts come back.
  - All four `N/A` → four skipped verdicts in fixed order, zero runner calls.
  - A runner that throws for one command → that verdict is `Failed` with `exitCode: null` and `output` containing the thrown error's message. The remaining checks still run.
  - The verdict's `command` is the command that was run.

### 2. Implement `adws/core/checkRunner.ts` (GREEN)
- Create the module with the types listed in *Phase 1*. Use `export enum` for `StaticCheckName` and `CheckStatus` (string values), matching `RateLimitType` in `rateLimitWaitPolicy.ts`.
- `export const STATIC_CHECKS: readonly { readonly check: StaticCheckName; readonly commandKey: keyof StaticCheckCommands }[]` in the order type check (`typeCheck`), additional type checks (`additionalTypeChecks`), lint (`runLinter`), build (`runBuild`).
- `isCheckConfigured(command: string): boolean` returns `false` when the trimmed command is empty or equals `n/a` case-insensitively.
- `runShellCommand(command, cwd): Promise<ProcessOutcome>`: `spawn(command, [], { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })`. Append stdout and stderr chunks to one array in arrival order. Resolve on `close` with `{ exitCode, output }`. Resolve on `error` (e.g. `spawn /bin/sh ENOENT` for a missing cwd) with `exitCode: null` and the captured output plus the error message. The promise settles once, so the first event wins.
- `runStaticChecks(commands: StaticCheckCommands, cwd: string, runProcess: ProcessRunner = runShellCommand): Promise<readonly CheckVerdict[]>`: iterate `STATIC_CHECKS` **sequentially**, with a one-line comment that the checks must not overlap and their order is part of the contract. Delegate each to a small `runCheck(spec, command, cwd, runProcess)`:
  - guard clause: not configured → skipped verdict;
  - `try { outcome = await runProcess(command, cwd) } catch (error) { outcome = { exitCode: null, output: String(error) } }` (the process runner is a system boundary);
  - `status = outcome.exitCode === 0 ? CheckStatus.Passed : CheckStatus.Failed`.
- No agent, phase, forge, logger or state imports. Only `child_process` and `type CommandsConfig` from `./projectConfig`. Keep nesting at most 2 and follow the comment discipline (no JSDoc that restates names).
- Run `bunx vitest run adws/core/__tests__/checkRunner.test.ts` until green.

### 3. Add real-process tests for the default runner
- Create `adws/core/__tests__/checkRunner.integration.test.ts`. Use `os.tmpdir()` (or an `mkdtemp` dir removed in `afterEach`) as cwd:
  - `printf 'to stdout\n'; printf 'to stderr\n' >&2; exit 3` → `exitCode: 3`, `output` contains both lines.
  - `true` → `exitCode: 0`.
  - A cwd that does not exist → `exitCode` is not `0` and `output` matches `/ENOENT/`.
  - `runStaticChecks` with the default runner over `{ typeCheck: 'exit 0', additionalTypeChecks: 'N/A', runLinter: 'echo lint-out; exit 1', runBuild: 'echo build-out' }` → passed / skipped / failed (exit 1, output contains `lint-out`) / passed (output contains `build-out`).

### 4. Export the check runner from the core barrel
- In `adws/core/index.ts`, next to the `testVerdict` exports, add:
  - `export type { CheckVerdict, ProcessOutcome, ProcessRunner, StaticCheckCommands } from './checkRunner';`
  - `export { runStaticChecks, runShellCommand, isCheckConfigured, STATIC_CHECKS, StaticCheckName, CheckStatus } from './checkRunner';`

### 5. Write the unit-test phase tests first (RED)
- Create `adws/phases/__tests__/unitTestPhase.test.ts`. Inject fakes through the new `deps` parameter. Do not `vi.mock` the agents or the check runner.
- Config builder: start from `getDefaultProjectConfig()` and override `commands` with distinct fake commands (`tc`, `atc`, `lint`, `build`). Set `adwYmlConfig: { hitl: false, unitTests }`, `repoContext: undefined` (no forge calls), `orchestratorStatePath` and `logsDir` as `fs.mkdtempSync` temp dirs (`AgentStateManager.appendLog`/`writeState` need an existing dir), minimal `issue`/`ctx`, cast `as unknown as WorkflowConfig` like `scenarioTestPhase.test.ts`.
- Fakes: a recording `runProcess` that pushes `check:<command>` onto a shared `events` array, and a fake `runUnitTestsWithRetry` that pushes `tests` and returns a passing `TestRetryResult` (`passed: true, reportPresent: true, hasFailures: false, testcaseCount: 2, costUsd: 0, totalRetries: 0, failedTests: [], modelUsage: {}, contextResetCount: 0`).
- `process.exit`: `vi.spyOn(process, 'exit').mockImplementation(...)` that throws a sentinel error. Restore it and `process.env.ADW_UNIT_TEST_REPORT_PATH` in `afterEach`. Remove the temp dirs.
- Cases:
  - `unitTests: false` → `events` equals `['check:tc','check:atc','check:lint','check:build']` (no `tests`). The phase resolves with `unitTestsPassed: true`.
  - `unitTests: true`, all checks green → `events` equals the four checks followed by `tests` (checks run before the test run).
  - A red check (e.g. `lint` → `{ exitCode: 1, output: 'lint error in src/a.ts' }`) → the phase rejects with the exit sentinel, `process.exit` was called with `1`, `tests` never appears in `events`, `<orchestratorStatePath>/execution.log` contains `lint error in src/a.ts`, and `config.ctx.errorMessage` names `lint` and `exit 1`. Run this with both `unitTests: true` and `unitTests: false`.
  - All four commands `N/A` with `unitTests: false` → no `check:` events, no `tests`, resolves.
  - Regression guard for the extracted helper: green checks plus a fake test run returning `reportPresent: true, hasFailures: true` → `process.exit(1)` is still called and `ctx.errorMessage` starts with `Unit tests hard-failed`.

### 6. Wire the check runner into `adws/phases/unitTestPhase.ts` (GREEN)
- Import `runStaticChecks`, `runShellCommand`, `CheckStatus` and the `CheckVerdict`/`ProcessRunner` types **directly from `'../core/checkRunner'`**, not through the `'../core'` barrel, as `scenarioTestPhase.ts` does for `devServerLifecycle`. Several tests mock `../core` wholesale. Resolve default deps **inside** `executeUnitTestPhase`, not in a module-level object, so a test that mocks `../agents` without `runUnitTestsWithRetry` never touches it at import time.
- Add and export:
  ```ts
  export interface UnitTestPhaseDeps {
    readonly runProcess: ProcessRunner;
    readonly runUnitTestsWithRetry: typeof runUnitTestsWithRetry;
  }
  export async function executeUnitTestPhase(config: WorkflowConfig, deps: Partial<UnitTestPhaseDeps> = {}) { … }
  ```
- Extract `endRunOnFailedGate(config: WorkflowConfig, errorMsg: string, costUsd: number): never` from the existing `hard-fail` block, unchanged in behaviour: `log(errorMsg,'error')`, `AgentStateManager.appendLog`, `ctx.errorMessage = errorMsg`, `postIssueStageComment(repoContext, issueNumber, 'error', ctx)` when `repoContext` is set, `AgentStateManager.writeState(... completeExecution(createExecutionState('running'), false, errorMsg), metadata: { totalCostUsd: costUsd, unitTestsPassed: false })`, `process.exit(1)`. Use it for the unit-test `hard-fail` branch (message unchanged: `Unit tests hard-failed: ${reason}. No PR was created.`).
- Add `logCheckVerdict(statePath, verdict)`: skipped → info line `Static check skipped (N/A): <check>`; passed → success line `Static check passed: <check> — <command>`; failed → error line `Static check failed: <check> (exit <code|none>) — <command>` followed by the full `output` (or `(no output)`). Write each line to both `log()` and `AgentStateManager.appendLog`.
- Add `runStaticCheckGate(config, runProcess): Promise<void>`: `log('Phase: Static Checks')` + `appendLog('Starting test phase: Static Checks')`; `const verdicts = await runStaticChecks(config.projectConfig.commands, config.worktreePath, runProcess)`; `verdicts.forEach(...)` to log; guard `if (failed.length === 0) return;`; otherwise `endRunOnFailedGate(config, \`Static checks failed: ${failed.map(describeFailedCheck).join(', ')}. No PR was created.\`, 0)` where `describeFailedCheck` renders `lint (exit 1)`. The GitHub error comment names the checks and exit codes only. The output stays in the run log (see Notes).
- Extract the existing test-run block into `runUnitTestSuite(config, runTests)` returning `{ costUsd, modelUsage, totalRetries, contextResetCount }` (sets `ADW_UNIT_TEST_REPORT_PATH`, removes the stale report, calls `runTests({...})` with the existing options, applies `computeTestVerdict`: `hard-fail` → `endRunOnFailedGate`, `warn` → `markUnitTestsUnverified(config, reason)` (the existing non-fatal try/catch label + comment branch, moved verbatim), pass → success log).
- New `executeUnitTestPhase` body, in this order: board move to In Progress (unchanged) → `reportStackCoherence(config)` → `await runStaticCheckGate(config, runProcess)` → `adwYmlConfig.unitTests ? await runUnitTestSuite(config, runTests) : skipUnitTestRun(config)` (logs `Unit tests disabled — skipping the test run` to `log` and `appendLog`, returns a zero outcome) → `createPhaseCostRecords(...)` → return the same result shape as today (`unitTestsPassed: true`, etc.).
- Replace the stale header comment ("BDD scenarios are now run in the Review phase…") with a short one stating the invariant: static checks always run first and a red check ends the run, while `unitTests: false` in `.github/adw.yml` skips only the test run.
- Keep the file under 300 lines and every function at nesting depth ≤ 2.
- Run `bunx vitest run adws/phases/__tests__/unitTestPhase.test.ts` until green. Then run `bunx vitest run adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts` to confirm the injectable-phase orchestrator tests still compile and pass with the new optional parameter.

### 7. Make the `cli-tool` fixture's static checks green
- Edit `test/fixtures/cli-tool/.adw/commands.md`:
  - Replace the `## Lint` section (fenced) with `## Run Linter` whose body is the plain line `echo "lint ok"`.
  - Replace the fenced `## Type Check` body with the plain line `echo "type check ok"`.
  - Add `## Additional Type Checks` with body `N/A` (exercises the skipped path in the harness).
  - Replace the fenced `## Run Build` body with the plain line `echo "build ok"`.
  - Do **not** change `## Run Scenarios by Tag` or `## Run Regression Scenarios`. Surface rows 21 and 22 rely on their `sh` fence exiting 127. Leave `## Package Manager`, `## Install`, `## Run Tests` (`N/A`), `## Start Dev Server` and `## Health Check Path` as they are.
- Why: surface rows 06 and 20 and the `@subprocess` smoke runs (`adw_sdlc_happy_path`, `adw_chore_diff_verdicts`, `pause_resume_rate_limit`) execute the real unit-test phase over this fixture. Without this edit, the parser defaults (`bun run lint`, `bunx tsc --noEmit -p adws/tsconfig.json`) and the fenced commands would turn the checks red and end those runs with `process.exit(1)`.
- Check `test/fixtures/python-app` and `test/fixtures/python-flat`: both already declare all four static checks `N/A`, so they need no change.

### 8. Strip lint, type check and build from `.claude/commands/test.md`
- Keep the frontmatter (`target: false`).
- Retitle it as running the application's unit tests, and rewrite the intro and `## Purpose` to say ADW derives the verdict from the JUnit report and runs every other check of the code itself, before this command. Remove the bullets about detecting type mismatches and verifying build processes.
- `## Instructions`: read `## Run Tests` from `.adw/commands.md` (default `bun run test:unit`). Run **only** the test in `## Test Execution Sequence`, and no other command that checks the code. Keep: JSON-only output (`JSON.parse()` runs on it), omit `error` on pass and include it on failure, a non-zero exit means failed, timeout after `TEST_COMMAND_TIMEOUT`, log start/end/result, paths relative to the root. Drop the multi-test wording ("Execute all tests even if some fail", "Test execution order is important…").
- `## Test Execution Sequence`: keep this exact heading (`patch.md` refers to it). Delete `### Linting & Type Checks` (Linting, TypeScript Type Check, ADW TypeScript Check) and `### Build` (Build). Keep `### Application Tests` with its single step, renumbered to 1, content unchanged (`## Run Tests`, `test_name: "app_tests"`, the `$ADW_UNIT_TEST_REPORT_PATH` note, run unconditionally, `testcase_count` informational).
- `## Report` / `### Output Structure`: keep the JSON array contract (`test_name`, `passed`, `execution_command`, `test_purpose`, optional `error`). Replace `### Example Output` with a single failing `app_tests` entry (`"execution_command": "bun run test:unit"`, a vitest-style failure in `error`).
- When done, `.claude/commands/test.md` must not contain `Run Linter`, `Type Check`, `Additional Type Checks`, `Run Build`, `bun run lint`, `tsc --noEmit`, `bun run build`, `linting`, `typescript_check` or `app_build`. Also avoid naming a branch (the `lint:branch-names` guard scans `.claude/commands/`).

### 9. Update the `AdwYmlConfig` doc comment
- In `adws/core/adwYmlConfig.ts`, change the `AdwYmlConfig` interface comment (`unitTests: false` "opts out of the unit-test phase gate") and the header rule line for `unitTests: false` to say it skips only the unit-test run. The static checks still run. Do **not** change `ADW_YML_TEMPLATE` (see Notes).

### 10. Rewrite ADR-0058's `### Confirmation`
- In `specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md`, replace the opening "Not yet implemented." with "Partly implemented." Then add, as bullets dated with the day of the check and the short commit hash checked:
  - `adws/core/checkRunner.ts` (`runStaticChecks`) runs `## Type Check`, `## Additional Type Checks`, `## Run Linter` and `## Run Build` from the parsed `.adw/commands.md`, in that order, and returns one verdict per check with its exit code and captured output. The exit code is the verdict, and `N/A` is reported as skipped. Unit tests: `adws/core/__tests__/checkRunner.test.ts` (fake process runner: verdict per exit code, `N/A` skipped, output captured, fixed order) and `adws/core/__tests__/checkRunner.integration.test.ts` (the default shell runner).
  - `adws/phases/unitTestPhase.ts` (`executeUnitTestPhase`) runs the check runner before the test run whatever `unitTests` says. A red check ends the run as a hard-failed unit-test run does, with the check's output in the execution log, until the fix loop of ADR-0059 lands. `unitTests: false` skips only the test run. Unit tests: `adws/phases/__tests__/unitTestPhase.test.ts`.
  - `.claude/commands/test.md` runs only `## Run Tests`: `grep -nE "Run Linter|Type Check|Run Build|bun run lint|tsc --noEmit|bun run build" .claude/commands/test.md` returns nothing.
  - Outside `adws/core/projectConfig.ts`, the only TypeScript reader of `runLinter`, `typeCheck`, `additionalTypeChecks` and `runBuild` is `checkRunner.ts`.
- Keep the existing not-yet-implemented list (`review.md` Strategy A and B; `adw_init.md` step 6 writes `review_proof.md`; `projectConfig.ts` parses `## Tags`/`## Supplementary Checks`; `adwPlanBuildReview.tsx` runs `executeScenarioTestPhase` outside the fix loop) under a sentence saying the PRD and its issues still carry that work. Update its "checked on" reference if re-checked. Keep `### Confirmation` as an h3 in its current position. Do not edit the decision, the drivers or the front matter.

### 11. Update the README
- Line 11: rewrite the "Per-repo unit-test gate via `adw.yml`" bullet so it says the unit-test phase first runs type check, additional type checks, lint and build from `.adw/commands.md` through `adws/core/checkRunner.ts`, each check's exit code is its verdict, `N/A` is skipped, and a red check ends the run with the check's output in the log. `unitTests: false` in `.github/adw.yml` skips only the test run, and `/test` runs only the unit-test command. Keep the trailing `hitl` sentence.
- Directory tree: add `checkRunner.ts  # Static-check runner: runs type check, additional type checks, lint and build from .adw/commands.md in fixed order; exit code is the verdict, N/A skipped (runStaticChecks, runShellCommand)` between `authGate.ts` and `claudeStreamParser.ts` under `adws/core/`. Add `checkRunner.integration.test.ts` and `checkRunner.test.ts` between `authGate.test.ts` and `claudeStreamParser.test.ts` in the core `__tests__` listing. Change the `adwYmlConfig.ts` description to "unit-test run switch". Change the `unitTestPhase.ts` description to "Unit test phase: static-check gate (always) then the unit-test run (unless `unitTests: false`)". Add `unitTestPhase.test.ts` between `startupFailureLog.test.ts` and `upgradeGate.test.ts` in the phases `__tests__` listing.
- Do not revert the pre-existing uncommitted "Model-literal guard" bullet already in the worktree.

### 12. Run the validation commands
- Run every command in `Validation Commands` below. Fix any failure before finishing. The `@regression` run is the proof that the fixture edit kept surface rows 06/20/21/22 and the smoke runs green.

## Testing Strategy
### Unit Tests
- `adws/core/__tests__/checkRunner.test.ts` (fake process runner, the PRD's required tests):
  - verdict per exit code: `0` → passed; `1`/`2`/`127` → failed with the code; `null` → failed;
  - `N/A` (any case, padded) and blank commands → skipped, never executed, `exitCode: null`, empty output;
  - output captured per check, unchanged;
  - fixed order type check → additional type checks → lint → build, in the given cwd, always four verdicts;
  - a failure does not short-circuit later checks;
  - a throwing runner → failed verdict carrying the error text.
- `adws/core/__tests__/checkRunner.integration.test.ts` (real `sh`): exit code passthrough, stdout+stderr capture, spawn failure on a missing cwd → non-zero/`null` exit with `ENOENT` in the output, end-to-end `runStaticChecks` with the default runner.
- `adws/phases/__tests__/unitTestPhase.test.ts` (injected `runProcess` and `runUnitTestsWithRetry`, stubbed `process.exit`):
  - `unitTests: false` → all configured checks run, the test run does not;
  - `unitTests: true` → checks run before the test run;
  - a red check → `process.exit(1)`, no test run, output in `execution.log`, `ctx.errorMessage` names the check and exit code (with `unitTests` true and false);
  - all `N/A` → nothing spawned;
  - unit-test hard-fail still ends the run through the extracted helper.
- Existing orchestrator tests (`adwChore.test.ts`, `adwPlanBuildReview.test.ts`, `adwPlanBuildTestReview.test.ts`) must keep passing unchanged.

### Edge Cases
- All four checks `N/A` (e.g. a Python CLI repo): four skipped verdicts, no process spawned, the gate passes.
- `n/a`, ` N/A `, or an empty section body: skipped and reported, never run as an empty shell command that would exit 0.
- A check killed by a signal (`exitCode: null`) or one that cannot be spawned (missing worktree → `ENOENT`): failed, with the error text in the output.
- Several checks fail: all four still run, and the error names every failed check with its exit code (`Static checks failed: lint (exit 1), build (exit 2). No PR was created.`).
- Large output (thousands of lint lines): captured in full in the execution log. The GitHub error comment carries only names and exit codes.
- A command written inside a markdown code fence, or with an HTML comment in its section: run verbatim, so the shell fails (e.g. exit 127) and the check is red. This is visible, never a silent green. The `cli-tool` fixture is corrected for this reason.
- A `.adw/commands.md` that lacks a section: `parseCommandsMd` supplies ADW's own default (e.g. `bunx tsc --noEmit -p adws/tsconfig.json` for `## Additional Type Checks`), which runs and may be red. See Notes.
- `unitTests: false` with a red check: the run still ends. Opting out of tests never opts out of static checks.
- A resumed workflow whose `test` phase already completed: `runPhase` skips the whole phase as before, so the checks are not re-run.
- Self-host ADW run: the four commands from ADW's own `.adw/commands.md` (`bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build`) run in the worktree. `tsc` writes only the gitignored `*.tsbuildinfo`.
- In-process regression harness: `process.exit` is trapped. A red check would surface as `exitCode: 1` on the phase outcome, which is why the fixture must be green.

## Acceptance Criteria
- `adws/core/checkRunner.ts` exists and `runStaticChecks(commands, cwd, runProcess?)` runs type check, additional type checks, lint and build in that order, returning exactly one `CheckVerdict` per check with `status`, `exitCode` and captured `output`. `N/A`/blank commands are reported as `skipped` and never executed. The verdict is decided by the exit code alone (0 → passed, otherwise failed). No agent is involved, and no other TypeScript module executes `runLinter`/`typeCheck`/`additionalTypeChecks`/`runBuild`.
- `executeUnitTestPhase` calls the check runner before any test run. A red check ends the run the way a hard-failed unit-test run does (error log and execution log with the check output, error comment naming the check(s) and exit code(s), failed execution state, `process.exit(1)`), and the test run never starts.
- With `unitTests: false` in `.github/adw.yml`, the static checks still run and only the test run is skipped.
- `.claude/commands/test.md` contains no lint, type-check, additional-type-check or build command or step. It still emits the `app_tests` JSON entry and keeps the `## Test Execution Sequence` heading.
- `adws/core/__tests__/checkRunner.test.ts` covers verdict per exit code, `N/A` skipped, output captured and fixed order with a fake process runner, and passes.
- `adws/phases/__tests__/unitTestPhase.test.ts` proves the `unitTests: false` behaviour, the checks-before-tests order and the red-check stop, and passes.
- ADR-0058's `### Confirmation` names the implemented checks (module, unit tests, phase wiring, `test.md` grep) and still lists the parts not yet implemented.
- `test/fixtures/cli-tool/.adw/commands.md` declares green static checks, and the `@regression` suite passes (surface rows 06/20/21/22 and the smoke runs included).
- Lint, both type checks, the unit suite and the build pass. The git/gh guard and branch-name guard pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/checkRunner.test.ts adws/core/__tests__/checkRunner.integration.test.ts adws/phases/__tests__/unitTestPhase.test.ts` — the new check runner and phase tests pass
- `bunx vitest run adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts` — injectable-phase orchestrator tests still pass with the new optional `deps` parameter
- `! grep -nE "Run Linter|Type Check|Additional Type Checks|Run Build|bun run lint|tsc --noEmit|bun run build|typescript_check|app_build" .claude/commands/test.md` — `test.md` contains no lint, type-check or build command (succeeds only when nothing matches)
- `bun run lint` — Run Linter
- `bunx tsc --noEmit` — Type Check
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional Type Checks
- `bun run test:unit` — full unit suite, zero regressions
- `bun run build` — Run Build
- `bun run lint:git-guard` — the new `spawn` site introduces no git/gh shell-out
- `bun run lint:branch-names` — the edited `test.md` and new `adws/` code name no branch
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-988"` — the issue's BDD scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite passes (surface rows 06/20 run the real phase with the real check runner over the fixed `cli-tool` fixture; rows 21/22 still see the fenced scenario command exit 127; smoke runs end `awaiting_merge` with no error)

## Notes
- Strictly follow `.adw/coding_guidelines.md`: guard clauses and nesting ≤ 2 (hence the extracted `runStaticCheckGate`, `runUnitTestSuite`, `markUnitTestsUnverified`, `skipUnitTestRun`, `endRunOnFailedGate`), string enums for the check names and statuses, `readonly` result types, no `any`, side effects (spawning, logging, state, comments) at the edges, comments only for invariants/ordering/non-obvious reasons (the sequential-order comment in `runStaticChecks` is one), no issue numbers in code comments, files under 300 lines.
- No new library is needed (`child_process` is built in). If one were, `.adw/commands.md` says to add it with `bun add <package>`.
- Scope: the static-check **fix loop** (ADR-0059: fix agent, suppression guard, no-progress stop, `human_gated` park), the **baseline gate** (ADR-0060), the `review.md` Strategy A/B removal, the `review_proof.md` deletion, and `adwPlanBuildReview` adopting `runScenarioTestFixLoop` are separate issues from the same PRD. Until the fix loop lands, a red check ends the run, as the issue states. The `ProcessRunner` seam and the single combined `output` string are what the fix loop's "identical output = no progress" signal and the baseline gate will reuse.
- The GitHub error comment carries only the failing check names and exit codes. The full output goes to the console log and the orchestrator `execution.log` (PRD user story 4: "in the run log and the fix prompt"). Build and lint output can contain absolute paths or environment details that should not be posted to an issue.
- The check runner runs each parsed command verbatim. It does not strip code fences or HTML comments: a malformed command fails visibly (ADR-0058 "no silent green"). That is why the `cli-tool` fixture's fenced static-check commands are rewritten. The fenced `## Run Scenarios by Tag`/`## Run Regression Scenarios` stay, because rows 21/22 depend on them.
- `parseCommandsMd` falls back to `getDefaultCommandsConfig()` for an absent section, and those defaults are ADW's own (`bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`). A target repository whose `commands.md` predates a section will now run that default and may go red. `adw_init` writes all four sections (`N/A` where not applicable), so re-running it, or adding `N/A`, fixes such a repository. Changing the parser defaults is outside this issue and the ADR. Consider a follow-up if real target repos hit it.
- No timeout is applied to a check, matching `runScenariosByTag`. The old prompt-level 5-minute limit went with the agent. A hung check holds the phase, and `## Cancel` is the escape hatch. Add a timeout only if a later decision asks for one.
- `ADW_YML_TEMPLATE` (`adwYmlConfig.ts`), the heredoc in `.claude/commands/adw_init.md` and ADW's own `.github/adw.yml` are kept byte-identical (guarded by `adws/__tests__/adwInitPrompt.test.ts`). Their wording ("When enabled, the unit-test phase runs your test command and fails the workflow on unit-test failure") is still true, and `adw_init.md` belongs to the PRD's `adw_init` issue, so they are deliberately left unchanged. Only the TypeScript doc comment is updated.
- `.claude/commands/patch.md` falls back to `test.md`'s `## Test Execution Sequence` when a patch has no spec validation steps. After this change that fallback validates only the test run. `patch.md` is not changed here.
- The module docs that own the touched files (`app_docs/feature-9gjajh-test-and-scenario-phases.md`, `…-state-and-config.md`, `…-commands-and-skills.md`, `…-scenario-and-stepdef-agents.md`, `…-bdd-regression-suite.md`) are left to the `/document` phase. If ADR-0058 is added to a doc's `## Decisions`, the matching `Decisions:` block in `.adw/conditional_docs.md` must gain `0058` in the same change, or `bun run lint:docs-index` fails.
- `specs/adr/README.md` says records 0058–0063 "are not yet implemented". After this issue, 0058 is partly implemented and its own `### Confirmation` says so. The index sentence may be refreshed when the PRD's work completes.
- `.claude/commands/test.md` is not a `hashInputs` file of `adw_init.md`, so editing it does not change the framework hash or trigger target-repo upgrades.
