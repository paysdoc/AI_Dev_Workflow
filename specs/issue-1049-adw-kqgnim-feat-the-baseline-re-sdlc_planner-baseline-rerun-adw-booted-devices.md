# Feature: The baseline gate's regression re-run on the base branch runs on ADW-booted devices

## Metadata
issueNumber: `1049`
adwId: `kqgnim-feat-the-baseline-re`
issueJson: `{"number":1049,"title":"feat: the baseline regression re-run on the base branch runs on ADW-booted devices","body":"## Parent PRD\n\n`specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record: `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`)\n\n## What to build\n\nThe baseline gate's regression re-run on the base branch gets booted devices too, through the same lifecycle, so a pre-existing failure is judged under the same conditions as the change. A failed boot there parks with `device_boot_failed` like the scenario phase. See PRD \"Scenario phase and baseline re-run\".\n\n## Acceptance criteria\n\n- [ ] The base-branch regression re-run of a profile with platforms receives the three device variables, from devices created for that run and removed after it\n- [ ] A `cli` or `web` re-run is unchanged\n- [ ] A boot failure during the re-run parks with `device_boot_failed`\n- [ ] Phase tests with a stand-in lifecycle\n\n## Blocked by\n\n- Blocked by #1048\n\n## Touched Files\n\n- adws/phases/preExistingRegressionGate.ts\n- adws/phases/__tests__/preExistingRegressionGate.test.ts\n\n## User stories addressed\n\n- User story 15\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-18T15:00:14Z","comments":[],"actionableComment":null}`

## Feature Description
A `@regression` scenario that fails on the change goes to the pre-existing regression gate (`createPreExistingRegressionGate`, `adws/phases/preExistingRegressionGate.ts`). The gate re-runs the scenario alone on the base branch (`buildBaseScenarioRerun`, `adws/phases/baseScenarioRerun.ts`):
- a scenario that fails there too is pre-existing, and the issue parks as `pre_existing_regression`;
- a scenario that passes there, or cannot be run there, was introduced by the change and goes to the scenario fix agent.

Since #1047 and #1048, the scenario phase of a profile with platforms (`mobile:kotlincm`) runs on its own devices:
- the device lifecycle (`withDevices`, `adws/core/deviceLifecycle.ts`) creates one Android emulator and one iOS simulator for the workflow;
- the run command gets them as `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`;
- a device that does not boot in three attempts, or a missing host tool, parks the workflow as `device_boot_failed`.

The base-branch re-run has no devices. It runs the base branch's command with only `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`. For a mobile repository its verdict therefore says nothing about the scenario:
- a scenario that fails there because it has no device reads as pre-existing, and parks the issue for a failure the base branch may not have;
- a run that stops before it writes a report reads as introduced, and sends a pre-existing failure to the fix agent.

This feature gives the re-run devices through the same lifecycle. For a profile with platforms, the gate:
- creates an emulator and a simulator for the triage of the failing scenarios, from the device-source sections the scenario phase used;
- hands their three variables to each re-run, which merges them into the run command's environment beside `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`;
- removes them after the triage, whatever happened;
- parks the workflow as `human_gated` with `device_boot_failed` when a device does not boot or a host tool is missing, as the scenario phase does.

`cli` and `web` re-runs do not change. They get no device and issue no device command, and their environment stays as it is.

Value: the gate judges a pre-existing failure under the same conditions as the change (user story 15). A mobile issue then parks only for a failure the base branch really has, and the fix agent gets only what the change broke.

## User Story
As an ADW operator
I want the baseline gate's regression re-run on the base branch to get booted devices too
So that a pre-existing failure is judged under the same conditions as the change

## Problem Statement
`buildBaseScenarioRerun` runs the base branch's run-by-tag command with `{ ADW_JUNIT_REPORT_PATH, ADW_PROOF_DIR }` and nothing else (`runTagged`, `adws/phases/baseScenarioRerun.ts`). `createPreExistingRegressionGate` builds that re-run and hands it to `triageRegressionFailures` (`adws/core/regressionTriage.ts`), and nothing in that path knows about devices.

The scenario phase's devices cannot be reused for the re-run. `withDevices` removes them before `executeScenarioTestPhase` returns, and the gate runs only after that, inside `runScenarioTestFixLoop`.

So, for a profile with platforms, the re-run of a failing regression scenario has no emulator and no simulator. Its Passed, Failed or NotRun is decided by the missing devices, not by the base branch. The PRD ("Scenario phase and baseline re-run") and ADR-0064 require the re-run to do what the scenario phase does:
- wrap the run in the device lifecycle;
- merge the device environment into the run command's environment;
- park a boot-failed or tool-missing outcome as `device_boot_failed` through the existing park path.

## Solution Statement
The gate owns the devices of the re-run, as the scenario phase owns its own. The re-run gets them per call.

1. **The base re-run takes the devices per call.** `adws/phases/baseScenarioRerun.ts` exports `BaseScenarioRerun = (scenario: FailingScenario, devices?: DeviceEnvironment) => Promise<BaseScenarioOutcome>`, and `buildBaseScenarioRerun` returns it.
   - The devices are threaded down to `runTagged`, which spreads them into the run command's `env` beside `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`. This is the spread the scenario phase uses (`{ ADW_APPLICATION_URL, ...devices }`).
   - Without devices the `env` is exactly what it is today.
   - Its install memo and its outcome memo stay as they are. The re-run is built once per gate and spans the attempts, while the devices are created per triage, so the devices are an argument and not a dependency.
2. **The gate re-runs on devices for a profile with platforms.** `PreExistingRegressionGateDeps` gains `withDevices: typeof withDevices`, the stand-in point for tests and BDD scenarios, and its `rerunOnBase` becomes a `BaseScenarioRerun`.
   - The device source is resolved only when a triage is about to re-run something: `resolveDeviceSource(config.projectConfig.deviceSources, requireApplicationProfile(config).platforms)`.
   - For a profile with platforms, the triage runs inside `withDevices`, and each re-run gets the `DeviceEnvironment` the lifecycle hands over.
   - The `DeviceRequest` carries:
     - the workflow's `adwId`;
     - the change's device source, the one the scenario phase used;
     - an emulator log of its own, `<logsDir>/base-rerun-android-emulator.log`, so that the phase's `android-emulator.log` is not truncated;
     - a `record` that writes each device line to the orchestrator's execution log.
   - The devices are removed when `withDevices` returns, before the gate returns or parks.
3. **A device that does not come up parks the workflow `device_boot_failed`.** On a `boot_failed` or `tool_missing` outcome, the gate:
   - writes a summary line and then the whole combined output to the execution log;
   - calls `parkWorkflow(config, { reason: ParkReason.DeviceBootFailed, failure })`.

   This is the scenario phase's path, with the same evidence and so the same park comment. The gate does not return, and no failing scenario reaches the fix agent.
4. **Every park comes after the devices are removed.** `parkWorkflow` calls `process.exit(0)`, which skips every pending `finally`, and the lifecycle's teardown is one. So the triage's result comes out of `withDevices` as a value, and only then does the gate log the outcomes and park for `pre_existing_regression`. A device failure is already a value returned after teardown.
5. **No re-run, no device.** The gate creates no device when:
   - nothing failed, or the failing scenarios cannot be identified (it returns before the triage, as today);
   - the baseline is waived (the triage re-runs nothing);
   - every failing scenario's base outcome was learned in an earlier attempt of this fix loop.

   For the last case, the gate keeps what it has learned: a map from each scenario re-run on the base branch to its outcome, held in the gate's closure, which spans the attempts. A learned scenario is answered from that map and not re-run, as the re-run's own memo already does today. This lets the gate know, before booting anything, whether a triage will re-run anything at all. Without it, every later attempt with the same failing regression scenario would boot a pair of devices for nothing, and could park on a boot failure when no device was needed.
6. **Unchanged:**
   - `regressionTriage.ts` (`ScenarioRerun` and the triage stay device-agnostic);
   - `parkComment.ts` (the `device_boot_failed` evidence, comment and directives already fit, see Notes);
   - `scenarioTestFixLoop.ts` (one gate per call, same `PreExistingRegressionGate` type);
   - `continueHandler.ts` and the retry path;
   - the scenario phase.

## Relevant Files
Use these files to implement the feature:

- `README.md` — The project overview. Its "Baseline gate on the base branch" and "Application type decides the evidence" bullets and its `adws/phases/` tree must describe the re-run on devices (Task 8). It already carries an uncommitted, unrelated change (two proof test files added to the tree): leave it as is.
- `.adw/coding_guidelines.md` — Must be followed strictly. The rules that matter here:
  - files under 300 lines, which is why the gate's device tests get their own file;
  - guard clauses and a nesting depth of at most 2;
  - inline callbacks of more than about 3 lines extracted;
  - `readonly` types, no `any`, no `!`;
  - comments only for invariants and non-obvious reasons, and no issue numbers in code.
- `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` — The source of the requirement: user story 15, "Scenario phase and baseline re-run" ("The baseline gate's regression re-run on the base branch does the same"; "A boot-failed or tool-missing outcome parks the workflow with the new reason, through the existing park path"), and "Park reason".
- `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md` — The decision: ADW creates, boots and destroys the devices "around the scenario phase and around the baseline gate's regression re-run", and a boot failure parks `device_boot_failed`.
- `specs/issue-1048-adw-79ve4c-feat-device-boot-is-sdlc_planner-device-boot-retry-park.md` — The previous slice's plan: the closed `DeviceOutcome`, the park path, why the park comes after every teardown, and why `## Retry` needs no new code.
- `app_docs/feature-ko14m9-device-lifecycle.md` — Conditional doc (device lifecycle, the device variables, the `device_boot_failed` park, the stand-in device host). Its Contracts and Gotchas apply as they are:
  - teardown on every outcome;
  - the park after every teardown;
  - BDD scenarios on a `mobile:kotlincm` worktree must use the stand-in device host and trap `process.exit`.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — Conditional doc (`regressionTriage.ts`, `baseScenarioRerun.ts`, `preExistingRegressionGate.ts`, the `pre_existing_regression` park, `## Continue` waivers).
- `adws/phases/preExistingRegressionGate.ts` — **Changed.** The gate. It gains the `withDevices` dependency, the device session around the triage, the device-failure park, and the outcomes it has learned.
- `adws/phases/baseScenarioRerun.ts` — **Changed.** The re-run takes the devices per call and merges them into the run command's environment (`runTagged`). Exports `BaseScenarioRerun`.
- `adws/phases/scenarioTestPhase.ts` — Prior art to mirror: `requireDeviceSource`, `deviceRequest`, `describeDeviceFailure`, `parkOnDeviceFailure` and `settleOnDevices`, and the rule that the park comes out of every callback.
- `adws/core/deviceLifecycle.ts` — `withDevices`, `DeviceEnvironment`, `DeviceRequest`, `DeviceOutcome` and `DeviceFailure`. Unchanged.
- `adws/core/deviceSourceConfig.ts` — `resolveDeviceSource` (`not_required` / `resolved` / `missing`) and `DeviceSourceConfigError`. Unchanged.
- `adws/core/applicationType.ts` — The profile's `platforms` (`android` and `ios` for `mobile:kotlincm`, empty for `cli` and `web`). Unchanged.
- `adws/phases/applicationTypeGate.ts` — `requireApplicationProfile(config)`, the one way a phase reads the profile. Unchanged.
- `adws/core/regressionTriage.ts` — `triageRegressionFailures`, `ScenarioRerun`, `RegressionTriage`, `FailingScenario` and `BaseScenarioOutcome`. Unchanged.
- `adws/forge/parkComment.ts` — `ParkReason.DeviceBootFailed`, its evidence `{ reason, failure }`, its comment and its directives. Unchanged.
- `adws/phases/workflowPark.ts` — `parkWorkflow` writes `human_gated` and `parkReason`, posts the comment and calls `process.exit(0)`. Unchanged.
- `adws/phases/scenarioTestFixLoop.ts` — The gate's only caller (`createPreExistingRegressionGate(config)` once per loop, so that what it learns spans the attempts). Unchanged. Its tests inject a gate.
- `adws/phases/__tests__/preExistingRegressionGate.test.ts` — **Changed.** The existing gate tests. Their fixtures move to the new helpers file, and every test stays as it is.
- `adws/phases/__tests__/scenarioTestPhase.helpers.ts` — Reused, unchanged: the stand-in lifecycle (`fakeDevices`, `failingDevices`), `STAND_IN_DEVICES`, `BOOT_FAILED`, `TOOL_MISSING` and `EVERY_DEVICE_SOURCE`.
- `adws/phases/__tests__/scenarioTestPhase.devices.test.ts` and `adws/phases/__tests__/scenarioTestPhase.deviceBoot.test.ts` — Prior art for phase tests with a stand-in lifecycle (event order, requests, park evidence, the summary and output in the log, the `cli`/`web` `describe.each`).
- `adws/phases/__tests__/baseScenarioRerun.test.ts`, `adws/phases/__tests__/baseScenarioRerun.server.test.ts` and `adws/phases/__tests__/baseScenarioRerun.helpers.ts` — **Changed** (the first two). The re-run's tests, where the environment with and without devices is pinned. `fakeScenarioRunner` already records each run's `env`.
- `adws/core/__tests__/regressionTriage.test.ts` — The triage's tests. Unchanged, run as a regression check.
- `features/regression/support/standInDevices.ts` — The stand-in device host whose `withDevices` a BDD scenario injects. Unchanged.
- `features/per-issue/feature-1049.feature` — This issue's BDD scenarios: 13 scenarios, 16 with the outline examples. They run the real gate and the real base re-run on a workflow whose worktree declares `mobile:kotlincm`, `cli` or `web`, with the stand-in device host (Task 7).
- Step definitions those scenarios reuse, unchanged:
  - `features/regression/step_definitions/feature-992-phase.steps.ts` — the workflow whose worktree declares an application type, and its dev server;
  - `features/regression/step_definitions/feature-992-standins.ts` — the stand-in `npm`, `npx` and scenario command, which record the `ADW_` variables of each run;
  - `features/per-issue/step_definitions/feature-1045-phase.steps.ts` — every device source in the worktree's `.adw/project.md`;
  - `features/per-issue/step_definitions/feature-990.steps.ts`, `feature-990-scripts.ts` and `feature-990-scenarios.steps.ts` — the target repository's scenario outcomes, its stand-in scenario runner, and the runs on the base branch read from that runner's run log;
  - `features/per-issue/step_definitions/feature-1047-host.steps.ts` and `feature-1048-host.steps.ts` — the stand-in device hosts and `no device tool was run`;
  - `features/per-issue/step_definitions/feature-989-phase.steps.ts`, `feature-990-park.steps.ts`, `feature-991-workflow.steps.ts`, `feature-1047-phase.steps.ts` and `feature-1048-phase.steps.ts` — the park state, the park comments and the execution log.

### New Files
- `adws/phases/__tests__/preExistingRegressionGate.helpers.ts` — Shared fixtures of the gate tests, moved out of `preExistingRegressionGate.test.ts`. `makeConfig` is extended with the application profile, the device-source sections and `logsDir`, and `scriptedRerun` records the devices and an event per re-run.
- `adws/phases/__tests__/preExistingRegressionGate.devices.test.ts` — The gate's phase tests with a stand-in lifecycle:
  - re-runs on devices for a profile with platforms;
  - the `device_boot_failed` park;
  - no device when nothing is re-run;
  - `cli` and `web` unchanged.
- `features/per-issue/step_definitions/feature-1049-*.ts` — The step definitions `features/per-issue/feature-1049.feature` still lacks, written scenario by scenario in Task 7, each file under 300 lines.

## Implementation Plan
### Phase 1: Foundation
Teach the base re-run to take devices, tests first. It must merge them into the run command's environment and leave the environment exactly as today without them. Then move the gate tests' fixtures into a helpers file, so that a second gate test file can share them. Extend `makeConfig` with the profile, the device-source sections and the logs directory, with `cli` as the default. Nothing in the gate changes yet, so every existing test stays green.

### Phase 2: Core Implementation
Write the gate's device tests against the stand-in lifecycle of the scenario-phase helpers, and see them fail. Then implement:
- the `withDevices` dependency;
- the lazily resolved device source;
- the device request;
- the triage inside the device session;
- the device-failure park;
- the learned outcomes;
- the `pre_existing_regression` park after the session.

### Phase 3: Integration
Confirm that the fix loop, the gate's only caller, needs no change. Write the step definitions this issue's scenarios still lack, make every scenario pass, and run the existing base re-run and device scenarios. Update the README, and run every validation command.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Pin the re-run's environment, with and without devices (tests first)
- In `adws/phases/__tests__/baseScenarioRerun.test.ts`, import `STAND_IN_DEVICES` from `./scenarioTestPhase.helpers` and add a `describe('the base scenario re-run — devices', …)` with these tests:
  - `it('hands the run command the devices it is given, beside its report and proof paths')`. Run `await buildRerun(runner)(CANCEL_RESETS, STAND_IN_DEVICES)` and expect `runner.calls[0]?.env` to equal `{ ADW_JUNIT_REPORT_PATH: expect.any(String), ADW_PROOF_DIR: expect.any(String), ...STAND_IN_DEVICES }`.
  - `it('hands the run command only its report and proof paths when it is given no devices')`. Expect `Object.keys(runner.calls[0]?.env ?? {}).sort()` to equal `['ADW_JUNIT_REPORT_PATH', 'ADW_PROOF_DIR']`. This pins the `cli`/`web` re-run.
- In `adws/phases/__tests__/baseScenarioRerun.server.test.ts`, add `it('hands the devices to the run inside the base branch’s dev server')`. Use the declared-server fixture of that file, call the re-run with `STAND_IN_DEVICES`, and expect the one run's `env` to contain each device variable (`expect.objectContaining(STAND_IN_DEVICES)`).
- Run `bunx vitest run adws/phases/__tests__/baseScenarioRerun.test.ts adws/phases/__tests__/baseScenarioRerun.server.test.ts`. The two device tests fail, because the `env` has no device variable, and the rest pass.

### 2. Let the base re-run take the devices per call
In `adws/phases/baseScenarioRerun.ts`:
- `import type { DeviceEnvironment } from '../core/deviceLifecycle';`
- Export the type, next to `BASE_RERUN_TAG`:
  ```ts
  /** `devices` are the emulator and simulator created for the re-run; a profile without platforms has none. */
  export type BaseScenarioRerun = (scenario: FailingScenario, devices?: DeviceEnvironment) => Promise<BaseScenarioOutcome>;
  ```
  and make `buildBaseScenarioRerun(…)` return `BaseScenarioRerun`.
- Thread `devices?: DeviceEnvironment` through `rerunOnce(scenario, devices)`, `runLocated(base, located, devices)`, `runUnderServer(base, devices)` and `runTagged(base, devices)`. `runTagged` passes `{ ADW_JUNIT_REPORT_PATH: reportPath, ADW_PROOF_DIR: proofDir, ...devices }` to `runByTag`.
- The returned function becomes `(scenario, devices) => …`, with the memo key unchanged: the scenario's feature and name. The outcome is the scenario's on the base branch, and the gate always brings equivalent devices.
- Drop the `ScenarioRerun` import if nothing uses it any more.
- Run the two test files of Task 1. All pass. The file stays under 300 lines (about 215).

### 3. Move the gate tests' fixtures into `preExistingRegressionGate.helpers.ts` (refactor, still green)
- Create `adws/phases/__tests__/preExistingRegressionGate.helpers.ts`, without a `vitest` hook of its own, and move into it from `preExistingRegressionGate.test.ts`:
  - `ExitSignal`, `ADW_ID`, `BASE_BRANCH`, `FEATURE`, `PASSED_BASELINE` and `WAIVED_BASELINE`;
  - `testCase`, `tagResult`, `proofOf`, `failingRegression`, `makeConfig`, `scriptedRerun` and `executionLog`;
  - the temp-dir list;
  - the bodies of `beforeEach` and `afterEach`, as `stubProcessExit()` (the `process.exit` spy that throws `ExitSignal`, and the `console.log` spy) and `cleanUpGateFixtures()` (`vi.restoreAllMocks()`, removing `AGENTS_STATE_DIR/<ADW_ID>` and the temp dirs).

  Export each one.
- Extend `makeConfig(commentOnIssue = vi.fn(), options: { applicationProfile?: ApplicationProfile; deviceSources?: DeviceSourceSections } = {})`. Besides what it sets today, it also sets:
  - `logsDir: path.join(orchestratorStatePath, 'logs')`;
  - `applicationProfile: options.applicationProfile ?? APPLICATION_TYPE_PROFILES.cli`;
  - `projectConfig: { deviceSources: options.deviceSources ?? parseDeviceSourceSections('') }`.

  The existing positional `commentOnIssue` stays, so no existing call changes. The `__tests__` directory is outside the mapping-reader guard, and `makeConfig` needs no `applicationType` anyway.
- Make `scriptedRerun(outcomes, events: string[] = [])` a `vi.fn<BaseScenarioRerun>(async (scenario) => { events.push(`re-ran ${scenario.name}`); return outcomes[scenario.name] ?? BaseScenarioOutcome.NotRun; })` and return it as both `rerunOnBase` and `rerun`, typed `Mock<BaseScenarioRerun>`. The second argument then shows in `rerun.mock.calls`.
- In `preExistingRegressionGate.test.ts`, import everything from the helpers, and call `beforeEach(stubProcessExit)` and `afterEach(cleanUpGateFixtures)`. Change no `it`.
- Run `bunx vitest run adws/phases/__tests__/preExistingRegressionGate.test.ts`. Every test passes. Each test file loads the helpers in a module of its own, so each gets its own `ADW_ID`.

### 4. Write the gate's device tests with a stand-in lifecycle (red)
Create `adws/phases/__tests__/preExistingRegressionGate.devices.test.ts`, with `beforeEach(stubProcessExit)` and `afterEach(cleanUpGateFixtures)`.
- It imports from `./scenarioTestPhase.helpers`: `fakeDevices`, `failingDevices`, `STAND_IN_DEVICES`, `BOOT_FAILED`, `TOOL_MISSING` and `EVERY_DEVICE_SOURCE`.
- Define `const MOBILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm']`, and `mobileConfig(commentOnIssue = vi.fn(), deviceSources = EVERY_DEVICE_SOURCE)` over `makeConfig`.
- Every gate under test gets `readBaseline: () => PASSED_BASELINE` unless a test says otherwise, and every mobile gate gets an injected `withDevices`.

**`describe('the pre-existing regression gate — a profile with platforms re-runs on devices of its own')`:**
- `it('hands each re-run on the base branch the three device variables')`. Two failing scenarios A and B, both `Passed` on the base branch. Expect `rerun.mock.calls.map(([, devices]) => devices)` to equal `[STAND_IN_DEVICES, STAND_IN_DEVICES]`.
- `it('asks once for the devices of all the failing scenarios: for this workflow, from the device source the sections name, with an emulator log of the re-run’s own')`. Expect:
  - `requests` to have length 1;
  - `requests[0]` to match `{ adwId: ADW_ID, deviceSource: EVERY_DEVICE_SOURCE, emulatorOutputPath: path.join(config.logsDir, 'base-rerun-android-emulator.log') }`.
- `it('re-runs the scenarios while the devices exist, and has removed them when it returns')`. Pass one `events` array to `fakeDevices` and to `scriptedRerun`. Expect `['devices ready', 're-ran A', 're-ran B', 'devices removed']`.
- `it('parks for a pre-existing regression only once the devices are removed')`. A is `Failed` on the base branch, and the `commentOnIssue` stub pushes `'parked'`. Expect:
  - the gate to reject with `ExitSignal`;
  - `events` to equal `['devices ready', 're-ran A', 'devices removed', 'parked']`;
  - the top-level state to match `{ workflowStage: 'human_gated', parkReason: 'pre_existing_regression' }`.

  A park inside the callback would put `'parked'` before `'devices removed'`; in production, `process.exit` would skip the teardown.
- `it('gives the execution log every line the device lifecycle records, after a line that says the devices are for the re-run on the base branch')`. After the gate ran, call `requests[0].record('The Android emulator "adw-x" (emulator-5580) booted in 41.0s', 'info')`. Expect `executionLog(config)` to contain:
  - that line;
  - before it, a line matching `/Base re-run: creating an emulator and a simulator/`.

**`describe('the pre-existing regression gate — a device that does not come up parks the workflow')`:**
- `it.each([['a device that did not boot', BOOT_FAILED], ['a missing host tool', TOOL_MISSING]])('parks for device_boot_failed with the failure, and re-runs nothing on the base branch, for %s', …)`. With `failingDevices(failure)`, expect:
  - the gate to reject with `ExitSignal`;
  - `process.exit` to have been called with `0`;
  - the top-level state to match `{ workflowStage: 'human_gated', parkReason: 'device_boot_failed' }`;
  - `commentOnIssue` to have been called once, with `(990, buildParkComment(ADW_ID, { reason: ParkReason.DeviceBootFailed, failure }))`;
  - `rerun` not to have been called.
- `it.each(…)('writes the summary and then the whole output to the execution log before it parks, for %s', …)`. Read `executionLog(config)` and expect, in this order:
  - the summary;
  - `failure.output`;
  - `Workflow parked as human_gated: device_boot_failed`.

  Compare indices of the full text. The summaries are:
  - `BOOT_FAILED`: `Base re-run: the android device did not boot in 3 attempts; no scenario was re-run on the base branch. The output of the attempts:`
  - `TOOL_MISSING`: `Base re-run: xcrun simctl is not on the host's PATH, so the ios device could not be created; no scenario was re-run on the base branch. Its output:`

**`describe('the pre-existing regression gate — no re-run means no device')`:**
- `it('asks for no device when the baseline was waived, and leaves every failure to the fix agent')`. With `readBaseline: () => WAIVED_BASELINE`, expect:
  - the gate to resolve;
  - `requests` and `rerun.mock.calls` to be empty;
  - the execution log to match `/baseline was waived/`.
- `it('asks for no device when no regression scenario failed, or when the failing ones cannot be identified')`. Use `proofOf(tagResult('@regression'))` and `proofOf(tagResult('@regression', { passed: false, exitCode: 1 }))`. Expect `requests` to be empty.
- `it('asks for no device for a later proof whose failing scenarios it has re-run before, and answers them from what it learned')`. Call one gate twice with A failing, A `Passed` on the base branch. Expect:
  - `requests` to have length 1;
  - `rerun` to have been called once;
  - the second call to resolve.
- `it('asks for devices again for a later proof with a failing scenario it has not re-run yet, and re-runs only that one')`. The first proof fails A, the second fails A and B, both `Passed`. Expect:
  - `requests` to have length 2;
  - `rerun.mock.calls.map(([scenario]) => scenario.name)` to equal `['A', 'B']`;
  - both calls to have been given `STAND_IN_DEVICES`.
- `it('throws DeviceSourceConfigError naming the section, and asks for no device and re-runs nothing, when a device-source section is missing')`. Use `mobileConfig(vi.fn(), parseDeviceSourceSections(''))`. Expect:
  - the gate to reject with a `DeviceSourceConfigError` whose `section` is `'## Android System Image'`;
  - `requests` and `rerun.mock.calls` to be empty.

**`describe.each([['cli', APPLICATION_TYPE_PROFILES.cli], ['web', APPLICATION_TYPE_PROFILES.web]])('the pre-existing regression gate — a %s re-run is unchanged', …)`:**
- `it.each([['names no device source', undefined], ['names every device source', EVERY_DEVICE_SOURCE]])('asks for no device and re-runs without devices, even on a host whose devices would not boot, when it %s', …)`. Use `failingDevices(BOOT_FAILED)`, with A `Passed` on the base branch. Expect:
  - the gate to resolve;
  - `requests` to be empty;
  - `rerun.mock.calls.map(([, devices]) => devices)` to equal `[undefined]`;
  - `commentOnIssue` not to have been called.

Run `bunx vitest run adws/phases/__tests__/preExistingRegressionGate.devices.test.ts`. The mobile and device-failure tests fail, because the gate never asks for devices. The `cli`/`web`, waived and nothing-to-triage tests already pass.

### 5. Re-run on devices in the gate, and park on a failed boot (green)
**Dependencies and imports.** In `adws/phases/preExistingRegressionGate.ts`:
- `PreExistingRegressionGateDeps` becomes `{ rerunOnBase: BaseScenarioRerun; readBaseline: () => BaselineRecord | undefined; withDevices: typeof withDevices }`. A test's one-parameter `ScenarioRerun` still fits `rerunOnBase`.
- Import:
  - `path`;
  - `withDevices` and the types `DeviceEnvironment`, `DeviceFailure`, `DeviceOutcome` and `DeviceRequest` from `../core/deviceLifecycle`;
  - `resolveDeviceSource`, `DeviceSourceConfigError` and the type `DeviceSource` from `../core/deviceSourceConfig`;
  - the type `RegressionTriage` from `../core/regressionTriage`;
  - `requireApplicationProfile` from `./applicationTypeGate`;
  - the type `BaseScenarioRerun` from `./baseScenarioRerun`.
- Never name `applicationType`: the mapping-reader guard in `adws/core/__tests__/applicationType.test.ts` fails on any module but the config parser and the type gate that does.

**Module-level helpers**, each small and pure apart from its logging:
- `const EMULATOR_LOG_FILE = 'base-rerun-android-emulator.log';`
- `const rerunKey = ({ name, feature }: FailingScenario): string => `${feature ?? ''}\u0000${name}`;`
- `deviceSourceForRerun(config): DeviceSource | null`. It resolves `resolveDeviceSource(config.projectConfig.deviceSources, requireApplicationProfile(config).platforms)` and returns:
  - `null` for `not_required`;
  - the device source for `resolved`;
  - for `missing`, it throws `new DeviceSourceConfigError(resolution.section, resolution.message)`.

  One short comment: the scenario phase has already failed a profile that lacks a section, so in a real run the throw cannot be reached.
- `deviceRequest(config, deviceSource): DeviceRequest` is `{ adwId, deviceSource, emulatorOutputPath: path.join(config.logsDir, EMULATOR_LOG_FILE), record: (message, level) => recordLine(config.orchestratorStatePath, message, level) }`.
- `describeDeviceFailure(failure)` returns the two summaries of Task 4, by `failure.kind`.
- `parkOnDeviceFailure(config, failure): never` records the summary and then `failure.output` at `'error'`, then returns `parkWorkflow(config, { reason: ParkReason.DeviceBootFailed, failure })`. Keep the comment the scenario phase has: the whole output goes to the execution log, and the park comment cuts it.
- `settleTriage(config, triage: RegressionTriage): void` holds today's tail of the gate unchanged:
  - the `waived` line;
  - `logTriaged`;
  - the `pre_existing_regression` park.

**Inside `createPreExistingRegressionGate`:**
- The default `rerunOnBase` stays built on first need, and passes the devices through: `(scenario, devices) => { realRerun ??= buildBaseScenarioRerun(config); return realRerun(scenario, devices); }`.
- `const runOnDevices = deps.withDevices ?? withDevices;`
- `const learned = new Map<string, BaseScenarioOutcome>();` gets one comment: the gate keeps what it has learned about the base branch itself, not only in the re-run, so that it knows before booting devices whether a triage will re-run anything.
- `async function rerunAndLearn(scenario, devices?)` returns the learned outcome, if there is one. Otherwise it awaits `rerunOnBase(scenario, devices)`, stores the outcome under `rerunKey(scenario)` and returns it.
- `async function triageOnBase(failing, waived): Promise<DeviceOutcome<RegressionTriage>>`:
  - `const triage = (devices?: DeviceEnvironment) => triageRegressionFailures({ failing, waived, rerunOnBase: scenario => rerunAndLearn(scenario, devices) });`
  - `const rerunsSomething = !waived && failing.some(scenario => !learned.has(rerunKey(scenario)));`
  - `const deviceSource = rerunsSomething ? deviceSourceForRerun(config) : null;`
  - `if (deviceSource === null) return { kind: 'ready', result: await triage() };`
  - record `Base re-run: creating an emulator and a simulator to re-run the failing regression scenarios on the base branch` at `'info'`;
  - `return runOnDevices(deviceRequest(config, deviceSource), triage);`

  Comment the two cases that need no device: a waived baseline re-runs nothing, and a learned scenario is answered from memory.

**The returned gate:**
- It keeps its two guards: no per-case results → warn and return; nothing failing → return.
- Then: `const outcome = await triageOnBase(failing, isBaselineWaived(readBaseline()));`
- `if (outcome.kind !== 'ready') return parkOnDeviceFailure(config, outcome);`
- `settleTriage(config, outcome.result);`
- One comment above the call: every park comes after `withDevices` has returned, because `process.exit` would skip the devices' teardown.

**Finishing:**
- Extend the gate's doc comment. For a profile with platforms, the scenarios are re-run on an emulator and a simulator created for the triage and removed after it. A device that does not boot parks the workflow for `device_boot_failed`. The gate returns only when no failing regression scenario also fails on the base branch.
- Keep the nesting at 2 or less, and keep each inline callback at about 3 lines. The file stays under 300 lines (about 180).
- Run `bunx vitest run adws/phases/__tests__/preExistingRegressionGate.devices.test.ts adws/phases/__tests__/preExistingRegressionGate.test.ts`. Everything passes.

### 6. Confirm the gate's caller needs no change
- `adws/phases/scenarioTestFixLoop.ts` still calls `createPreExistingRegressionGate(config)` once per loop, with the defaults, and `PreExistingRegressionGate` is unchanged. Change nothing there.
- Run `bunx vitest run adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts adws/core/__tests__/regressionTriage.test.ts adws/core/__tests__/applicationType.test.ts`. They pass, the mapping-reader guard included.

### 7. Make this issue's scenarios pass
`features/per-issue/feature-1049.feature` holds 13 scenarios, 16 with the outline examples. A dry run (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1049" --dry-run`) lists the steps that already exist (see Relevant Files). Reuse them, and never define a step twice. Write the rest in `features/per-issue/step_definitions/feature-1049-*.ts`, one scenario at a time: see it fail, then make it pass.
- **The `When` step** (`the regression scenarios that fail on the issue's branch are judged against the base branch`) runs the real gate once, `createPreExistingRegressionGate(config, { withDevices })`. Its proof fails the `@regression` scenarios that the table marks as failing on the issue's branch. The step:
  - injects the stand-in device host's `withDevices` (`lastStandInDeviceHost()`, `features/regression/support/standInDevices.ts`) through the gate's `withDevices` dependency, never the real SDK tools;
  - keeps the default `rerunOnBase`, so the real base re-run runs the base branch's own command on a worktree of `dev`;
  - lists the failing scenarios in the table's order. The triage stops at the first scenario that fails on the base branch, and the scenario with two failing scenarios expects both to be re-run;
  - traps `process.exit`, since a park exits the process. The `@adw-1047`/`@adw-1048` step definitions do both.
- **The stand-in scenario command.** These scenarios need one that:
  - answers with each scenario's outcome on the branch it runs on;
  - logs each run where `feature-990-scenarios.steps.ts` reads the runs on the base branch;
  - records the variables each run was given: the three device variables, `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`;
  - when a scenario asks for it, fails every scenario that runs without one of the three device variables.

  The `feature-990` runner (`feature-990-scripts.ts`) does the first two and records no environment. The `feature-992` stand-ins (`feature-992-standins.ts`) record the `ADW_` variables of each run, `npx` included, which the `web` scenario needs. Extend one of them with options whose defaults keep their own features' scenarios as they are, or write a runner for this feature.
- **What the scenarios pin**, each a behaviour of this plan:
  - the three variables reach the base branch's run, beside `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`, from devices created, booted and waited for before it and removed after it (Tasks 2 and 5);
  - one AVD and one simulator, named after the ADW ID, from the worktree's device-source sections (the request of Task 5);
  - a scenario that passes on the base branch only on devices is introduced by the change, not pre-existing;
  - two failing scenarios are both re-run on the devices of the one triage, and the `pre_existing_regression` park comes after the devices are removed (Solution Statement, point 4);
  - a device that does not boot in 3 attempts, or a missing host tool, parks `device_boot_failed`, with no scenario re-run and no device left behind (Solution Statement, point 3);
  - an emulator that boots on its third attempt lets the re-run go ahead, and the scenario that fails there parks `pre_existing_regression`;
  - no device and no re-run when no regression scenario failed or the baseline was waived (Solution Statement, point 5);
  - `cli` and `web` are unchanged, even with every device-source section set.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1049"`. Every scenario passes, and none is undefined.

### 8. Update the README
- **"Baseline gate on the base branch" bullet.** After "is re-run alone on the base branch (`adws/phases/baseScenarioRerun.ts`)", add ", on devices of its own when the application profile has platforms".
- **"Application type decides the evidence" bullet.** After "`## Retry` re-runs the scenario phase, and `## Continue` waives nothing.", add a sentence:
  - the baseline gate's re-run of a failing `@regression` scenario on the base branch gets devices the same way (`adws/phases/preExistingRegressionGate.ts`);
  - an emulator and a simulator are created for the re-run from the same sections and removed after it;
  - the run gets the same three variables beside `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH`;
  - a device that does not boot there parks the same way, as `device_boot_failed`;
  - a scenario already re-run in an earlier attempt is answered from memory and needs no device.
- **`adws/phases/__tests__/` tree.** In alphabetical order, before `preExistingRegressionGate.test.ts`, add:
  - `preExistingRegressionGate.devices.test.ts`;
  - `preExistingRegressionGate.helpers.ts  # Shared helpers for the pre-existing regression gate tests`.
- **`adws/phases/` tree.**
  - Extend the `baseScenarioRerun.ts` entry: "…; the devices the gate hands it go into the run command's environment".
  - Extend the `preExistingRegressionGate.ts` entry: "…; for a profile with platforms it re-runs them on an emulator and a simulator created for the re-run and removed after it, and parks `device_boot_failed` when a device does not boot".
- **Leave alone:**
  - the README's existing uncommitted change;
  - the device janitor (#1050), which is not to be described.

### 9. Run the validation commands
Run every command in `Validation Commands` and fix any failure before finishing. Fix the cause; never suppress or weaken a check.

## Testing Strategy
### Unit Tests
- **`adws/phases/__tests__/baseScenarioRerun.test.ts` (extended).**
  - The devices given to a re-run are in the run command's `env`, beside `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`.
  - Without devices, the `env` holds exactly those two keys: the `cli`/`web` re-run, unchanged.
- **`adws/phases/__tests__/baseScenarioRerun.server.test.ts` (extended).** The devices reach the run inside the base branch's dev server, through `runUnderServer`.
- **`adws/phases/__tests__/preExistingRegressionGate.devices.test.ts` (new).** The phase tests with a stand-in lifecycle that the issue asks for, against `fakeDevices`/`failingDevices`:
  - the three variables reach every re-run;
  - one device request per triage, carrying the ADW ID, the resolved device source and `<logsDir>/base-rerun-android-emulator.log`;
  - the re-runs happen while the devices exist, and the devices are removed before the gate returns;
  - a `pre_existing_regression` park only after removal;
  - the lifecycle's lines go to the execution log;
  - `device_boot_failed` for `boot_failed` and `tool_missing`, with the evidence, the comment, no re-run, and the summary and output in the log before the park line;
  - no device for a waived baseline, for nothing failing, for unidentifiable failures, and for scenarios learned in an earlier attempt;
  - a second device request only for a scenario not yet re-run;
  - `DeviceSourceConfigError` for a missing section;
  - `cli`/`web` with and without device sources, on a host whose devices would not boot: no request, no device argument, no park.
- **`adws/phases/__tests__/preExistingRegressionGate.test.ts` (fixtures moved, tests unchanged).** Every existing case, now on the `cli` profile `makeConfig` defaults to:
  - `failingRegressionScenarios`;
  - the pre-existing park and its comment;
  - the introduced paths;
  - the waiver;
  - nothing to triage;
  - the default baseline reader.

  Together with the `cli`/`web` `describe.each`, this is the proof that a re-run without platforms is unchanged.
- **Unchanged and run as regression checks:**
  - `adws/core/__tests__/regressionTriage.test.ts`;
  - `adws/phases/__tests__/scenarioTestFixLoop*.test.ts`;
  - `adws/phases/__tests__/scenarioTestPhase.devices.test.ts` and `adws/phases/__tests__/scenarioTestPhase.deviceBoot.test.ts`, whose helpers are now shared;
  - `adws/core/__tests__/applicationType.test.ts`, which holds the mapping-reader guard.

### BDD Scenarios
`features/per-issue/feature-1049.feature` (`@adw-1049`) runs the real gate and the real base re-run, with the stand-in device host and a stand-in scenario command (Task 7). It covers:
- for `mobile:kotlincm`:
  - the three variables, beside the report and proof paths, from devices created before the base branch's run and removed after it;
  - one AVD and one simulator named after the ADW ID, from the worktree's device-source sections;
  - a scenario that passes on the base branch only on devices, which is not parked;
  - the `pre_existing_regression` park, for one failing scenario and for two, with no device left behind;
- `device_boot_failed` for a boot that fails 3 times on either device, and for `avdmanager` or `xcrun simctl` missing, with its park comment;
- an emulator that boots on its third attempt;
- no device and no re-run when nothing fails, when only the issue's own scenario fails, or when the baseline was waived;
- `cli` and `web` with every device-source section set: no device tool, none of the three variables, and the `pre_existing_regression` park as before;
- the type check.

The learned outcomes, the missing-section error, the emulator log's path and the execution log's lines are pinned by the unit tests above only.

### Edge Cases
- **Several failing regression scenarios.** One device session holds all their re-runs. The devices are not booted once per scenario.
- **The same scenario reported twice**, as both platform runs report the same title. It is re-run once: the gate's learned outcome, and the re-run's memo, answer the duplicate.
- **A later attempt.**
  - When its failing scenarios were all re-run before, it boots no device and answers from memory.
  - When it has a new failing scenario, it boots devices and re-runs only that one.
- **`## Retry` after a park.** It resumes in a new process with a new gate and nothing learned, so the scenario phase and then the gate boot devices again.
- **A pre-existing scenario.** It parks only after the devices have been removed. A park inside the callback would leave an emulator and a simulator running.
- **A device that does not boot, or a missing tool.** The lifecycle has already removed what it created. The gate:
  - re-runs nothing;
  - writes the summary and the full output to the execution log;
  - parks `device_boot_failed`, with the scenario phase's evidence and comment;
  - never returns, so nothing reaches the fix agent.
- **When both devices fail**, the lifecycle reports one failure (a missing tool first, then Android, then iOS). The gate parks with it as it is.
- **A device that boots on its second or third attempt.** The lifecycle retries as it does for the scenario phase, and the gate sees only a `ready` outcome. The re-run goes ahead on the devices booted, so a scenario that fails there too parks `pre_existing_regression`, not `device_boot_failed`.
- **A waived baseline on a mobile repository.** No device, nothing re-run, every failure to the fix agent, as today.
- **A device-source section that is missing.** It throws `DeviceSourceConfigError` before any device or re-run and does not park. The scenario phase throws first in a real run.
- **Something the base branch cannot run**, such as a scenario only the change has, an install of the base checkout that fails, or a port that stays busy, comes out `NotRun`. On the first triage the devices were booted for nothing and are removed again; the outcome is learned, so no later attempt boots for it.
- **A base branch that declares a dev server.** The re-run starts it per scenario inside the device session, and both are gone before any park. Mobile repositories declare `N/A`.
- **`cli` and `web`, even with every device-source section set and on a host whose devices would not boot.** No device request, no device command, an unchanged `env`, no `device_boot_failed`.
- **The emulator log of the re-run** is its own file, `base-rerun-android-emulator.log`. The phase's `android-emulator.log`, which `fs.openSync(…, 'w')` would truncate, survives for diagnosis.

## Acceptance Criteria
- For a profile with platforms (`mobile:kotlincm`), every re-run of a failing `@regression` scenario on the base branch gets `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID` in its run command's environment, beside `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`.
- Those variables come from devices created for that triage through `withDevices`. The request carries:
  - the workflow's ADW ID;
  - the device source of the change's `.adw/project.md`;
  - `<logsDir>/base-rerun-android-emulator.log`.

  The devices exist while the scenarios are re-run, and are removed before the gate returns or parks.
- A `pre_existing_regression` park happens only after the devices have been removed.
- A `cli` or `web` re-run is unchanged:
  - no device request, even with every device-source section set;
  - the re-run gets no device argument, and its `env` holds exactly `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR`;
  - every existing gate and re-run test passes with its assertions untouched.
- A device that does not boot in its attempts, or a missing host tool, during the re-run:
  - writes a summary and the whole output to the execution log;
  - parks the workflow as `human_gated` with `parkReason: 'device_boot_failed'`;
  - posts `buildParkComment(adwId, { reason: ParkReason.DeviceBootFailed, failure })`;
  - re-runs nothing on the base branch, and the gate does not return.

  `## Retry` re-runs the scenario phase and with it the gate, and `## Continue` waives nothing, both unchanged.
- No device is created when:
  - no regression scenario failed;
  - the failing ones cannot be identified;
  - the baseline is waived;
  - every failing scenario's base outcome was learned in an earlier attempt of the same fix loop. Such a scenario is not re-run.
- For a profile with platforms, a missing device-source section throws `DeviceSourceConfigError` naming the section, before any device or re-run.
- Phase tests with a stand-in lifecycle cover all of the above in `adws/phases/__tests__/preExistingRegressionGate.devices.test.ts`.
- Every changed or new file is under 300 lines, no module but the config parser and the type gate names `applicationType`, and every validation command passes.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/phases/__tests__/preExistingRegressionGate.devices.test.ts adws/phases/__tests__/preExistingRegressionGate.test.ts`: the gate on devices, its park, and its unchanged paths.
- `bunx vitest run adws/phases/__tests__/baseScenarioRerun.test.ts adws/phases/__tests__/baseScenarioRerun.server.test.ts adws/core/__tests__/regressionTriage.test.ts`: the re-run's environment with and without devices, and the triage.
- `bunx vitest run adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts adws/phases/__tests__/scenarioTestPhase.devices.test.ts adws/phases/__tests__/scenarioTestPhase.deviceBoot.test.ts adws/core/__tests__/applicationType.test.ts`: the gate's caller, the phase whose helpers are shared, and the mapping-reader guard.
- `bun run lint`: the linter.
- `bunx tsc --noEmit`: the type check of every `**/*.ts`, tests and `features/` included.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check.
- `bun run build`: the build.
- `bun run test:unit`: the full unit suite, with zero regressions.
- `wc -l adws/phases/preExistingRegressionGate.ts adws/phases/baseScenarioRerun.ts adws/phases/__tests__/preExistingRegressionGate.test.ts adws/phases/__tests__/preExistingRegressionGate.devices.test.ts adws/phases/__tests__/preExistingRegressionGate.helpers.ts adws/phases/__tests__/baseScenarioRerun.test.ts adws/phases/__tests__/baseScenarioRerun.server.test.ts`: each under 300 lines.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1049"`: this issue's scenarios, none of them undefined.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-990"`: the baseline and pre-existing regression scenarios, which run the gate and the re-run on a `cli` fixture, unchanged.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047 or @adw-1048"`: the device lifecycle and `device_boot_failed` scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the regression suite, with zero regressions.

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - files under 300 lines, which is why the device tests get their own file and the fixtures a helpers file, as `scenarioTestPhase.*` and `baseScenarioRerun.*` already do;
  - closed unions read by `kind`;
  - guard clauses and a nesting depth of at most 2, with the triage tail extracted into `settleTriage`;
  - no inline callback of more than about 3 lines;
  - `readonly` types, no `any`, no `!`;
  - comments only for invariants and non-obvious reasons: why every park follows `withDevices`, why the gate learns outcomes itself, why the missing-section throw cannot be reached, and why the output goes to the execution log in full;
  - no issue numbers in code.
- **No new library.** If one is ever needed, `.adw/commands.md` names `bun add <package>`.
- **Why the issue's file list grows.**
  - The issue names only the gate and its test. The variables can reach the run command only through the re-run, which builds its `env`, so `baseScenarioRerun.ts` and its two test files change too.
  - The gate test file already has 270 lines. Its fixtures move to `preExistingRegressionGate.helpers.ts`, and the new cases go to `preExistingRegressionGate.devices.test.ts`, following the existing `*.devices.test.ts` and `*.helpers.ts` splits.
  - The step definitions of this issue's scenarios are new files under `features/per-issue/step_definitions/`.
- **Why the gate owns the devices, and not the re-run.**
  - The park must come from outside every callback, and the re-run's outcome (`Passed`/`Failed`/`NotRun`) has no room for a device failure. It would need a new variant, or a thrown error that `rerunOnce`'s catch-all would have to let through, the base dev server's lifecycle would have to carry, and the core triage would have to stop on.
  - The gate already holds the config and the park.
  - One session per triage also boots the devices once for all the failing scenarios, not once per scenario.
- **Why the devices are an argument of the re-run, not a dependency.** The real re-run is built once per gate. It memoizes the base checkout's install and each scenario's outcome across the attempts, while the devices live only as long as one triage.
- **Why the gate learns outcomes although the re-run memoizes them.** The gate must know before booting whether a triage will re-run anything. The re-run's memo is internal, and the gate does not rely on it to stay correct. Without the gate's own map, every later attempt whose failing regression scenario was already re-run would:
  - boot an emulator and a simulator for nothing, about a minute or two each, on a host shared by up to five workflows;
  - risk a `device_boot_failed` park when no device was needed.
- **Why the change's device source.** The device source is `config.projectConfig.deviceSources`, the one the scenario phase used, not the base checkout's `.adw/project.md`. Running on the same devices is what makes the conditions the same. The run command is still the base branch's own, as today.
- **What stays wasteful, by decision.** On the first triage, the devices are booted before the re-run has prepared the base checkout and located the scenario. So they idle during the base install, and are booted for nothing when the base branch does not have the scenario or cannot install. Booting them only once a scenario is located would need the re-run to return a device failure (see above). If it hurts, that is the follow-up.
- **The park comment is reused unchanged**, and the PRD leaves its text untested by decision.
  - Its `## Retry` text ("re-runs the scenario phase, which creates and boots the devices again, and parks the issue again if a device still does not boot") holds for a park from the gate. `runScenarioTestFixLoop` calls `executeScenarioTestPhase` without a phase name, so a resumed run always runs the scenario phase again and then the gate.
  - `## Continue` waives nothing: `device_boot_failed` is not one of `WAIVABLE_PARK_REASONS`.
  - The execution log's "Base re-run: …" summary is what tells an operator the boot failed on the base branch.
- **Device names.** The re-run's devices are named `adw-<adwId>`, as the scenario phase's are. That is safe: the phase's devices are removed before `executeScenarioTestPhase` returns, AVD creation passes `--force`, and the gate's "Base re-run: creating an emulator and a simulator…" line separates the two sets of device lines in the run log.
- **Documentation.** Leave `app_docs/` and `.adw/conditional_docs.md` to `/document`:
  - `app_docs/feature-ko14m9-device-lifecycle.md` should say that the base re-run runs on devices too;
  - the test-and-scenario-phases doc's `Owns:` entry `adws/phases/__tests__/preExistingRegressionGate.test.ts` should widen to `preExistingRegressionGate*.test.ts`. The docs-index check does not flag unowned files, so nothing fails meanwhile.

  The README is this build's to update (Task 8).
- **Out of scope:**
  - the device janitor (#1050);
  - a host-wide cap on concurrent boots, deferred by the PRD;
  - passing `ADW_APPLICATION_URL` to the base re-run, which it has never had;
  - booting only once a scenario is located on the base branch.
- **Release.** Nothing here is live on the pipeline host until a release to `main` and a host restart (ADR-0064).
