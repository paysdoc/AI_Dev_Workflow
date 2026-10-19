# Feature: ADW creates, boots and destroys one emulator and one simulator per workflow around the scenario phase

## Metadata
issueNumber: `1047`
adwId: `ko14m9-feat-adw-creates-boo`
issueJson: `{"number":1047,"title":"feat: ADW creates, boots and destroys one emulator and one simulator per workflow around the scenario phase","body":"## Parent PRD\n\n`specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record: `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`)\n\n## What to build\n\nA device lifecycle module with one entry point: run a callback with devices for an ADW ID. It creates one AVD and one simulator named after the ADW ID from the device-source config, boots both (the emulator headless on a console port unique to the workflow), waits for each to be ready (`adb` device state and boot-completed property; `simctl` boot status), calls back with `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`, and on return shuts down and deletes both whatever happened, including a throwing callback. The executor and clock are injected. The scenario phase wraps the scenario proof run in it when the profile has platforms and merges the variables into the run command's environment beside `ADW_PROOF_DIR`, `ADW_JUNIT_REPORT_PATH` and `ADW_APPLICATION_URL`. The run log names the devices, the boot time of each, and their removal. This slice is the happy path; retries and the park are the next slice. See PRD \"Device lifecycle\" and \"Scenario phase and baseline re-run\".\n\n## Acceptance criteria\n\n- [ ] With a recording executor, a successful run issues create, boot, wait, callback, shutdown, delete for both devices in that order, and the callback receives the three variables\n- [ ] A callback that throws still gets both devices shut down and deleted, and the error propagates\n- [ ] The emulator console port differs between two ADW IDs\n- [ ] `executeScenarioTestPhase` on a profile with platforms passes the three variables to the run command; on `cli` and `web` nothing changes and no device command is issued\n- [ ] The orchestrator log carries the device names, boot durations and removal\n- [ ] Unit tests with a recording executor (PRD Testing Decisions 1), with the dev-server lifecycle tests as prior art\n\n## Blocked by\n#1045 <!-- adw:region-overlap -->\n\n- Blocked by #1045\n\n## Touched Files\n\n- adws/core/deviceLifecycle.ts\n- adws/core/__tests__/deviceLifecycle.test.ts\n- adws/phases/scenarioTestPhase.ts\n- adws/phases/__tests__/scenarioTestPhase.test.ts\n- adws/phases/__tests__/scenarioTestPhase.helpers.ts\n- adws/core/index.ts\n\n## User stories addressed\n\n- User stories 11, 12, 13, 14, 47\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-18T15:00:12Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-10-18T15:05:29Z","body":"⏸️ **Deferred behind #1045 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #1045, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #1045 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/phases/scenariotestphase.ts`\n- `adws/phases/__tests__/scenariotestphase.test.ts`\n\nThis issue will spawn automatically once #1045 merges and closes. To override, remove the `#1045 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description

This is a slice of `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record ADR-0064). Earlier slices added:

- #1043: the `mobile:kotlincm` type, whose profile has the platforms `android` and `ios`;
- #1045: the four device-source sections of `.adw/project.md` (`ProjectConfig.deviceSources`, `resolveDeviceSource`). The scenario phase already requires them for a profile with platforms, and does nothing else with them yet.

This slice gives such a profile its devices. A new module, `adws/core/deviceLifecycle.ts`, has one entry point, `withDevices(request, work, deps?)`: it runs `work` with devices for an ADW ID. For the ADW ID `<adwId>` it creates one AVD and one simulator, both named `adw-<adwId>`, from the resolved device source. It boots both and waits until each is ready. Then it calls `work` with the devices' identities, and afterwards it shuts down and deletes both, whatever happened.

| Step | Android | iOS |
|---|---|---|
| create | `avdmanager create avd --name adw-<adwId> --package <Android System Image> --device <Android Device Profile> --force` | `xcrun simctl create adw-<adwId> <iOS Device Type> <iOS Runtime>`, which prints the UDID |
| boot | `adb start-server`, then `emulator -avd adw-<adwId> -port <console port> -no-window -no-audio -no-boot-anim -no-snapshot`, started in the background with its output in `<logsDir>/android-emulator.log` | `xcrun simctl boot <udid>` |
| wait | poll `adb -s emulator-<console port> get-state` until it says `device`, then `adb -s emulator-<console port> shell getprop sys.boot_completed` until it says `1` | `xcrun simctl bootstatus <udid>` |
| hand over | `ADW_ANDROID_AVD=adw-<adwId>`, `ADW_ANDROID_SERIAL=emulator-<console port>` | `ADW_IOS_UDID=<udid>` |
| shut down | `adb -s emulator-<console port> emu kill`, then wait for the emulator process to exit | `xcrun simctl shutdown <udid>` |
| delete | `avdmanager delete avd --name adw-<adwId>` | `xcrun simctl delete <udid>` |

- **A console port per workflow.** The emulator runs headless on a console port of its own, and the adb port is the next one up. The ADW ID's hash picks a preferred port among the 64 even ports 5554–5680. If that port or the one after it is in use on the loopback address, the next candidate is tried, wrapping around. So two workflows start from different ports, and a port that is in use is never handed out.
- **Injected dependencies.** The executor (which runs the commands), the clock (which times each boot and paces the polling) and the port probe are injected. Tests use a recording executor and a fake clock, and no SDK is needed.
- **The run log.** It names both devices when they are created, the boot time of each, and the removal of each.
- **The scenario phase.** When the profile has platforms, `executeScenarioTestPhase` runs the scenario proof inside `withDevices`. It merges the three variables into the run command's environment, next to `ADW_APPLICATION_URL`; `runScenarioProof` adds `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH` as before. `cli` and `web` declare no platforms: their phase is unchanged and issues no device command.

This slice is the happy path. When a device cannot be created, booted or made ready, `withDevices` removes whatever it created and throws a `DeviceLifecycleError`. The workflow then fails through `handleWorkflowError`, the way a missing device-source section does today. Retrying the boot three times, the closed outcome type and the `device_boot_failed` park are #1048.

## User Story
As an ADW operator running parallel workflows for a Kotlin Compose Multiplatform repository on one host
I want ADW to create, boot and hand over one Android emulator and one iOS simulator per workflow, named after its ADW ID, and to remove both when the scenario phase is done whatever its outcome
So that parallel workflows never share a device, an `adb` port or a simulator identity, the repository's scenario command can install and run at once, and a finished workflow leaves nothing running on the host

## Problem Statement

- A `mobile:kotlincm` repository's scenarios need a booted emulator and a booted simulator. Nothing in ADW creates or boots them. The phase resolves the device source (#1045) and throws it away.
- Up to `MAX_CONCURRENT_PER_REPO` (5) workflows per repository run on one host, plus any number across repositories. If each repository booted its own devices, the workflows would collide on AVD names, `adb` ports and simulator identities. The PRD (user story 11) requires collisions to be designed out.
- The emulator's own port choice (the first free pair from 5554 up) races when two emulators start at the same time. A hash of the ADW ID alone is not enough either: with 64 ports and five workflows, two of them share a port about one time in seven.
- The repository's scenario command needs the devices' identities (AVD name, `adb` serial, simulator UDID) to point Appium at them (user story 13). It also needs both devices ready before it runs (user story 12).
- A device left running after the phase eats host memory and CPU (an emulator alone is several GB), and the next workflow pays for it (user story 14).
- An operator cannot see from the run log which devices a workflow used, how long each took to boot, or whether they were removed (user story 47).
- The lifecycle has to be testable without an Android SDK or Xcode. The PRD's Testing Decisions 1 asks for a recording executor, with the dev-server lifecycle tests as prior art.

## Solution Statement

- **An executor port at the process boundary, `adws/core/deviceExecutor.ts`.**
  - `run(command)` runs a command to completion. It never rejects: a command that cannot be spawned, or that is killed at its timeout, comes back with `exitCode: null` and its output.
  - `start(argv, outputPath)` starts a long-running process (the emulator) detached, with its output written to a file. It returns a handle with an `exited` promise and a `kill()`.
  - Commands run as argv arrays without a shell, so no ADW ID or device-source value can inject anything.
  - Every call is asynchronous. A boot takes minutes, and the orchestrator's heartbeat must keep ticking through it.
  - `systemDeviceExecutor` is the `child_process` implementation. It follows `runShellCommand` (`checkRunner.ts`) and `spawnServer` (`devServerLifecycle.ts`).
- **A deep lifecycle module, `adws/core/deviceLifecycle.ts`.**
  - `withDevices<T>(request, work, deps?)` mirrors `withHealthyDevServer(config, work, deps?)`.
  - The request carries the ADW ID, the resolved `DeviceSource`, the emulator's output path and a `record(message, level)` sink for the run log.
  - The deps (`executor`, `clock`, `isPortAvailable`) have production defaults. `clock` is the existing `WaitClock` (`now`, `sleep`) of `rateLimitWaitPolicy.ts`.
  - Two pure helpers are exported for the janitor of #1050: `deviceNameFor(adwId)` gives `adw-<adwId>`, and `emulatorConsolePortCandidates(adwId)` gives the 64 even console ports in hash order.
  - The Android and iOS bring-ups run at the same time, so that each boot time is measured on its own. Each bring-up never rejects and resolves to a closed result: `ready` (what it created, the device and its boot time) or `failed` (what it had created by then, and a `DeviceLifecycleError`).
  - Because both bring-ups always settle, teardown runs only after both have finished. It finds what to remove in either result, so nothing created is left behind.
  - Teardown sits in a `finally`. Per device it shuts down, then deletes; the two devices are torn down at the same time. Teardown never throws: a failed teardown command is recorded as a warning, and the callback's result or error passes through unchanged.
- **Readiness.**
  - Android: `adb` reports `device` for `emulator-<port>` and `sys.boot_completed` is `1`. The lifecycle polls on the injected clock until a boot deadline, and fails at once if the emulator process exits first.
  - iOS: `xcrun simctl bootstatus <udid>` returns 0, with the boot deadline as its timeout.
  - `adb start-server` runs before the emulator starts. An emulator registers itself with a running adb server, while a server started later finds emulators only on ports 5555–5585.
- **The scenario phase.**
  - `requireDeviceSource` returns the resolved `DeviceSource`, or `null` when the profile has no platforms.
  - `ScenarioTestPhaseDeps` gains `withDevices`, defaulting to the real one.
  - The phase's `runProof` takes the device environment and spreads it into `env` after `ADW_APPLICATION_URL`. For a profile with platforms, the run goes through `withDevices`, inside the declared dev server when there is one.
  - The request's `record` is the phase's `recordLine`, so every lifecycle line goes to the console and to the orchestrator's execution log.
  - `cli` and `web` never reach `withDevices`, and their `env` stays exactly `{ ADW_APPLICATION_URL }`.
- **Hermetic tests and scenarios.**
  - The phase's unit tests inject a stand-in `withDevices` from the shared helpers.
  - The existing BDD scenarios that run the real phase on a `mobile:kotlincm` worktree (`@adw-1043` 104308–104310 and 104313; `@adw-1045` 104501–104503; `@adw-1046` 104610–104612) inject a stand-in device host: the real lifecycle over an executor that answers like a healthy host. So no scenario touches a real SDK.
  - The scenario writer has tagged each of those scenarios `@adw-1047` and given it the step `And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot`, which installs that stand-in.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview. Holds the "Application type decides the evidence" bullet, which gains the devices sentence, and the `adws/core/` and `adws/phases/` trees, which gain the new modules and tests.
- `.adw/coding_guidelines.md` — the rules to follow:
  - files under 300 lines;
  - side effects isolated at the boundary (the executor);
  - pure helpers;
  - guard clauses and nesting depth of at most 2;
  - `readonly` types;
  - no `any`, no `!`;
  - comments only for what the code cannot say;
  - no issue numbers in code.
- `adws/README.md` — conventions for the `adws/` directory.
- `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` — the PRD:
  - "Device lifecycle";
  - "Scenario phase and baseline re-run";
  - Testing Decisions 1;
  - user stories 11–14 and 47;
  - Further Notes: the `ADW_PROOF_DIR` platform directories.
- `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md` — the decision record. ADW creates, boots and destroys one AVD and one simulator per workflow and exports the three variables; the emulator gets a console port of its own; teardown runs on every outcome.
- `specs/issue-1045-adw-m9cru8-feat-device-source-s-sdlc_planner-device-source-config-scenario-gate.md` — the previous slice's plan. It says that this slice makes `requireDeviceSource` return the `DeviceSource`, and that `scenarioTestPhase.helpers.ts` was left for this slice to edit.
- `app_docs/feature-9gjajh-dev-server-and-ports.md` — owner doc of `devServerLifecycle.ts` and `portAllocator.ts`, the prior art for spawn, probe and cleanup lifecycles and for port probing.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — owner doc of `scenarioTestPhase.ts`: its skip rules, the declared dev server and failed starts.
- `app_docs/feature-9gjajh-state-and-config.md` — owner doc of `deviceSourceConfig.ts` and `adws/core/index.ts`.
- `app_docs/feature-gfv9kt-application-type-mapping.md` — `ApplicationProfile.platforms`, `Platform`, and "consumers read the mapping, never the type".
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — owner doc of `features/regression/**`: the stand-in harness conventions, and "no hooks and no steps" helper modules.
- `adws/core/devServerLifecycle.ts` — prior art for `withDevices`:
  - `withHealthyDevServer(config, work, deps)`;
  - partial deps merged over defaults;
  - `try/finally` teardown;
  - `stopServer`'s wait-for-exit loop, which the emulator's shutdown mirrors;
  - `spawnServer` (detached, `unref`).
- `adws/core/__tests__/devServerLifecycle.healthy.test.ts` — prior-art test style: an injected harness pushes ordered `events`, `work` pushes `'work'`, and the test asserts the sequence.
- `adws/core/checkRunner.ts` — `runShellCommand`: one output buffer in arrival order, settled by the first of `error` and `close`. The device executor's `run` follows it, without a shell.
- `adws/core/processKill.ts` — `killProcessGroup(pid, graceMs)`, used by the emulator handle's `kill()`.
- `adws/core/portAllocator.ts` — `isPortAvailable(port, host)`. The lifecycle's default probe calls it with `127.0.0.1`.
- `adws/core/rateLimitWaitPolicy.ts` — the `WaitClock` interface (`now(): Date`, `sleep(ms)`). Reuse it; do not import `phaseRunner.ts`, which pulls in workflow types.
- `adws/core/deviceSourceConfig.ts` — read only. Provides:
  - `DeviceSource`, the four strings the devices are created from;
  - `resolveDeviceSource`;
  - `DeviceSourceConfigError`.
- `adws/core/applicationType.ts` — read only. Provides `Platform` (`android`, `ios`), which `DeviceLifecycleError` carries.
- `adws/core/logger.ts` — read only. `LogLevel`, imported as a type.
- `adws/core/index.ts` — gains the re-exports of the executor and the lifecycle, for #1049's baseline re-run and #1050's janitor.
- `adws/phases/scenarioTestPhase.ts` — `executeScenarioTestPhase`, `ScenarioTestPhaseDeps`, `requireDeviceSource`, `runProof`, `runUnderServer`, `recordLine`. Wraps the proof run in `withDevices` for a profile with platforms.
- `adws/phases/scenarioProof.ts` — read only. `runScenarioProof`'s `env` option: extra variables for every tag run, with `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR` always taking ADW's own values (`runTag`, lines 88–92).
- `adws/phases/__tests__/scenarioTestPhase.helpers.ts` — shared phase-test helpers (`makeConfig`, `fakeLifecycle`, `passingProof`). Gains a `deviceSources` override, `STAND_IN_DEVICES` and `fakeDevices`.
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — listed in the issue; left unchanged. It is 209 lines, and the device cases go into the sibling `scenarioTestPhase.devices.test.ts` (see Notes).
- `adws/phases/__tests__/scenarioTestPhase.deviceSource.test.ts` — its case "runs the proof as before when every section is set" runs a `mobile:kotlincm` phase with no injected device lifecycle. After this change that would run the real device tools, so it must inject `fakeDevices`.
- `adws/phases/__tests__/scenarioTestPhase.runner.test.ts` and `scenarioTestPhase.server.test.ts` — read only. They pin that a `cli` and `web` run's `env` is exactly `{ ADW_APPLICATION_URL }`, and they must stay green unchanged.
- `adws/phases/__tests__/scenarioProofRun.test.ts` — read only. It already proves that extra `env` variables reach the run command beside `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH`.
- `adws/core/__tests__/applicationType.test.ts` — read only. Its guard "every consumer reads the mapping, never the type" fails if a new source module uses the identifier `applicationType`.
- `features/regression/step_definitions/feature-992-phase.steps.ts` — `runScenarioTestPhase(workflow)` runs the real `executeScenarioTestPhase(workflow.config)`, which is reused by feature-1043's and feature-1045's `mobile:kotlincm` scenarios. It must pass the stand-in device host.
- `features/per-issue/step_definitions/feature-994-workflow.ts` — `runScenarioTests` runs the real phase for the review outline 104313 (`mobile:kotlincm`) and, through `runScenarioTestsThenReview`, for feature-1046's 104610–104612. It must pass the stand-in device host.
- `features/per-issue/step_definitions/feature-1045-phase.steps.ts` — read only. Its `When the workflow's scenario test phase is attempted` runs the phase through feature-992's `runScenarioTestPhase`, so the stand-in reaches the missing-section outline too.
- `features/regression/step_definitions/feature-992-standins.ts` and `feature-992-standin-source.ts`:
  - The stand-in scenario command records the `ADW_` variables and the time (`at`) of each run, which `@adw-1047` step definitions can read.
  - It always exits 0 today. It gains an exit code that a step can set, defaulting to 0 so that no existing scenario changes. The `@adw-1047` scenario whose stand-in "records each run, exits 1, and writes a JUnit report in which one scenario fails" needs it.
- `features/regression/step_definitions/feature-992-adw-files.ts` — `SAMPLE_DEVICE_SOURCE`, the four values that `setEveryDeviceSource` writes. It is exported so that the `@adw-1047` steps can compare the create commands against it.
- `features/per-issue/feature-1043.feature`, `features/per-issue/feature-1045.feature` and `features/per-issue/feature-1046.feature` — already updated by the scenario writer; the build does not edit them. Each scenario that runs the real phase on a `mobile:kotlincm` worktree now also carries `@adw-1047` and the step `And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot`:
  - feature-1043: 104308–104310 and the review outline (104313–104315);
  - feature-1045: the missing-section outline (104501–104503), which also asserts `And no device tool was run`;
  - feature-1046: 104610–104612, which run feature-994's `runScenarioTestsThenReview`.

  They must stay green.

### New Files
- `adws/core/deviceExecutor.ts` — the `DeviceExecutor` port (`DeviceCommand`, `DeviceCommandResult`, `DeviceProcess`) and `systemDeviceExecutor`, its `child_process` implementation.
- `adws/core/deviceLifecycle.ts` — `withDevices`, `deviceNameFor`, `emulatorConsolePortCandidates`, `DeviceEnvironment`, `DeviceRequest`, `DeviceLifecycleDeps`, `DeviceLifecycleError` and the lifecycle constants.
- `adws/core/__tests__/fixtures/recordingDeviceHost.ts` — the recording executor, fake clock and port probe the lifecycle tests drive. It does not import vitest, so #1048's and #1050's tests can reuse it.
- `adws/core/__tests__/deviceLifecycle.test.ts` — the lifecycle's unit tests (PRD Testing Decisions 1, this slice's part).
- `adws/core/__tests__/deviceExecutor.test.ts` — the real executor against `sh`: output, exit code, stdin, timeout, spawn error, a started process.
- `adws/phases/__tests__/scenarioTestPhase.devices.test.ts` — the phase's device cases: the variables reach the run command, the run happens inside the devices, and the log sink is the orchestrator log; `cli` and `web` make no device request.
- `features/regression/support/standInDevices.ts` — the BDD stand-in device host: the real `withDevices` over an executor that answers like a host whose device tools work, recording each command and the time it was issued. It has no hooks and no steps.
- `features/per-issue/step_definitions/feature-1047-host.steps.ts` — the two steps the tagged scenarios of features 1043, 1045 and 1046 share with this feature's: the step that installs the stand-in device host, and `no device tool was run`.

## Implementation Plan
### Phase 1: Foundation
Add the executor port and its `child_process` implementation in `adws/core/deviceExecutor.ts`, with a short test against `sh`. Then add the recording device host fixture that the lifecycle tests drive. It records each command as a line in an ordered `events` list, answers each command from a script that defaults to a healthy host, advances a fake clock when a boot "takes time", and probes ports from a set of taken ones.

### Phase 2: Core Implementation
Build `adws/core/deviceLifecycle.ts` test first:
- device naming;
- the console port candidates and their allocation;
- the Android bring-up (create, start the adb server, start the emulator, poll until ready) and the iOS bring-up (create, boot, boot status);
- the closed bring-up results;
- the concurrent bring-up, the callback and the `finally` teardown (shut down, wait for the emulator to exit, delete);
- the run-log lines through `request.record`;
- `DeviceLifecycleError` for a device that does not come up.

Re-export the public surface from `adws/core/index.ts`.

### Phase 3: Integration
- **Scenario phase.** `executeScenarioTestPhase` keeps the resolved device source. For a profile with platforms it runs the proof inside `withDevices` and merges the three variables into the run's `env`. The request's `record` writes to the orchestrator log, and the emulator log goes to `logsDir`. `cli` and `web` are untouched.
- **Phase tests.** The shared helpers gain a stand-in `withDevices`. A new `scenarioTestPhase.devices.test.ts` covers the acceptance criteria at phase level, and the existing device-source test injects the stand-in.
- **BDD harness.** The two real-phase BDD harnesses pass a stand-in device host, the one the scenario's device-tools step installed. So the existing `mobile:kotlincm` scenarios of features 1043, 1045 and 1046 stay hermetic and green.
- **Finish.** Write the `@adw-1047` step definitions and update the README.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add the device executor port and its `child_process` implementation (test first)
- Create `adws/core/__tests__/deviceExecutor.test.ts`. Use real processes through `sh`, in a temporary directory removed in `afterEach`:
  - `run({ argv: ['sh', '-c', 'echo out; echo err >&2; exit 3'], timeoutMs: 5000 })` resolves to `exitCode: 3`, with output holding both lines.
  - With `input: 'no\n'`, `run({ argv: ['sh', '-c', 'read answer; echo "got $answer"'], … })` outputs `got no`. This is the stdin that answers `avdmanager`'s hardware-profile question.
  - Without `input`, a command reading stdin sees end of file at once and does not hang.
  - A command that does not exist (`['adw-no-such-device-tool']`) resolves (never rejects) to `exitCode: null`, with `ENOENT` in its output.
  - A command that outlives its timeout (`['sleep', '5']` with `timeoutMs: 100`) resolves to `exitCode: null` well before 5 s.
  - `start(['sh', '-c', 'echo started; sleep 0.2'], outputPath)` creates the output file's directory and writes `started` to it. Its `exited` resolves to `0`.
  - `start` of a program that does not exist does not throw, and its `exited` resolves to `null`.
  - `kill()` on a started `sleep 30` makes `exited` settle soon after.
- Create `adws/core/deviceExecutor.ts`:
  - `export interface DeviceCommand`:
    - `readonly argv: readonly [string, ...string[]]` — a non-empty tuple, so the program is always present;
    - `readonly timeoutMs: number`;
    - `readonly input?: string`, with a doc comment: written to the command's standard input, which is otherwise closed.
  - `export interface DeviceCommandResult`:
    - `readonly exitCode: number | null`, with a doc comment: `null` when the command could not start or was killed at its timeout;
    - `readonly output: string`, with a doc comment: standard output and standard error in arrival order.
  - `export interface DeviceProcess`:
    - `readonly exited: Promise<number | null>`;
    - `kill(): void`.
  - `export interface DeviceExecutor` has `run(command): Promise<DeviceCommandResult>` and `start(argv, outputPath): DeviceProcess`. Its doc comment states the invariants:
    - `run` never rejects and `start` never throws;
    - nothing runs through a shell;
    - nothing blocks the event loop, because a boot takes minutes and the orchestrator's heartbeat must keep firing.
  - `run`:
    - `spawn(program, args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: process.env, timeout: timeoutMs, killSignal: 'SIGKILL' })`;
    - write and end `input` when given;
    - collect stdout and stderr into one buffer;
    - resolve on the first of `error` (with the error text appended) and `close`.
  - `start`:
    - `fs.mkdirSync(path.dirname(outputPath), { recursive: true })`;
    - open the file for writing;
    - `spawn(program, args, { detached: true, stdio: ['ignore', fd, fd], env: process.env })`;
    - close the fd in `finally`, then `unref()`;
    - `exited` resolves on `exit` (the code) or `error` (`null`);
    - `kill()` calls `killProcessGroup(pid, …)` when there is a pid, with a local grace constant.
  - `export const systemDeviceExecutor: DeviceExecutor = { run: runDeviceCommand, start: startDeviceProcess };`
  - Never use `execSync`, `spawnSync` or `Atomics.wait` here.
- Run `bunx vitest run adws/core/__tests__/deviceExecutor.test.ts`. It passes.

### 2. Add the recording device host fixture
Create `adws/core/__tests__/fixtures/recordingDeviceHost.ts`. It does not import vitest. Its exports:
- `export const TEST_UDID` — an uppercase UUID that the scripted `xcrun simctl create` prints.
- `export const TEST_DEVICE_SOURCE: DeviceSource`, with these values:
  - `system-images;android-35;google_apis;arm64-v8a`
  - `pixel_8`
  - `com.apple.CoreSimulator.SimDeviceType.iPhone-16`
  - `com.apple.CoreSimulator.SimRuntime.iOS-18-2`
- `export function recordingDeviceHost(script: Partial<DeviceHostScript> = {}): RecordingDeviceHost`, with:
  - `deps: DeviceLifecycleDeps` — `executor`, `clock` and `isPortAvailable`;
  - `events: string[]` — each command as `argv.join(' ')`, in the order issued; `start` is recorded the same way;
  - `lines: string[]` — each `record` call as `"<level> <message>"`;
  - `record: DeviceRequest['record']` — the sink to put on the request;
  - `mark(event: string): void` — for the callback to push `'callback'` into `events`.
- The executor answers like a healthy host by default:
  - `xcrun simctl create …` prints `TEST_UDID`;
  - `adb -s <serial> get-state` prints `device`;
  - `adb -s <serial> shell getprop sys.boot_completed` prints `1`;
  - every other command exits 0 with empty output;
  - `start(['emulator', …])` returns a process whose `exited` resolves when `adb -s <serial> emu kill` is run.
- `DeviceHostScript` lets a test change that host:
  - `androidBootMs` and `iosBootMs` — the fake clock advances by this much at the boot-completed answer and in `simctl bootstatus`, so boot times are exact;
  - `pollsUntilDevice` and `pollsUntilBootCompleted` — that many not-ready answers come first. For `get-state` that is `error: device 'emulator-…' not found` with exit 1. For `getprop sys.boot_completed` it is an empty output with exit 0, which is what a booting emulator answers and what the `@adw-1047` scenario scripts;
  - `failing` — commands, matched by prefix, that exit 1 with given output;
  - `takenPorts` — ports for which `isPortAvailable` answers `false`;
  - `emulatorIgnoresKill` — `exited` resolves only on `kill()`;
  - `emulatorExitsEarly` — `exited` resolves at once.
- The fake clock:
  - `now()` returns a `Date` held in the fixture;
  - `sleep(ms)` advances it by `ms` and resolves at once;
  - nothing uses real timers.

### 3. Write the device lifecycle tests (red)
Create `adws/core/__tests__/deviceLifecycle.test.ts`, in the style of `devServerLifecycle.healthy.test.ts`. Use one `request(adwId, host)` builder:
- `adwId`;
- `deviceSource: TEST_DEVICE_SOURCE`;
- `emulatorOutputPath: '/logs/android-emulator.log'`;
- `record: host.record`.

The callback calls `host.mark('callback')`. Assert the order with an `indexOf`-based helper that checks one sub-sequence of `events`.

**`deviceNameFor` and `emulatorConsolePortCandidates`:**
- `deviceNameFor('abc123-device-test')` is `adw-abc123-device-test`.
- The candidates of an ADW ID are 64 distinct even ports, all from 5554 to 5680, and the same on every call.
- Two chosen ADW IDs have different first candidates. Use the two ADW IDs of the `@adw-1047` scenarios as constants, `k7m2p9-login-screen` and `q4w8z1-settings-page`: with this hash their first candidates are 5556 and 5660.

**A successful run (acceptance criterion 1):**
- The Android sub-sequence comes in this order:
  - `avdmanager create avd --name adw-<id> --package system-images;android-35;google_apis;arm64-v8a --device pixel_8 --force`
  - `adb start-server`
  - `emulator -avd adw-<id> -port <p> -no-window -no-audio -no-boot-anim -no-snapshot`
  - `adb -s emulator-<p> get-state`
  - `adb -s emulator-<p> shell getprop sys.boot_completed`
  - `callback`
  - `adb -s emulator-<p> emu kill`
  - `avdmanager delete avd --name adw-<id>`
- The iOS sub-sequence comes in this order:
  - `xcrun simctl create adw-<id> com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-18-2`
  - `xcrun simctl boot <udid>`
  - `xcrun simctl bootstatus <udid>`
  - `callback`
  - `xcrun simctl shutdown <udid>`
  - `xcrun simctl delete <udid>`
- The callback comes after both devices are ready and before either is shut down.
- The callback receives exactly `{ ADW_ANDROID_AVD: 'adw-<id>', ADW_ANDROID_SERIAL: 'emulator-<p>', ADW_IOS_UDID: TEST_UDID }`, where `<p>` is the `-port` the emulator was started with. `withDevices` resolves with the callback's return value.
- The `avdmanager create avd` command is given the input `no\n`.

**A callback that throws (acceptance criterion 2):**
- `withDevices` rejects with the very error object the callback threw.
- The Android and iOS shut-down and delete commands all come after `callback`.

**The console port (acceptance criterion 3):**
- Run `withDevices` for the two chosen ADW IDs. The emulators' `-port` values differ, and each `ADW_ANDROID_SERIAL` is `emulator-<its port>`.
- With the first candidate in `takenPorts`, the emulator gets the second candidate. With only the first candidate's adb port (`+1`) taken, it also gets the second.

**Readiness:**
- With `pollsUntilDevice: 2` and `pollsUntilBootCompleted: 2` (two empty `getprop` answers), `get-state` is asked three times and `getprop` three times. The callback comes after the last `getprop`, and the fake clock's `sleep` paced the polls. No real time passes.

**The run log (acceptance criterion 5):**
- `lines` names `adw-<id>` for both devices when they are created, including the console port and the four device-source values.
- With `androidBootMs: 42_000` and `iosBootMs: 18_000`, the lines say `The Android emulator "adw-<id>" (emulator-<p>) booted in 42.0s` and `The iOS simulator "adw-<id>" (<udid>) booted in 18.0s`.
- After the callback they say `Removed the Android AVD "adw-<id>" (emulator-<p>)` and `Removed the iOS simulator "adw-<id>" (<udid>)`.
- These lines go only to `request.record`; nothing is logged elsewhere.

**Teardown on a device that does not come up (minimal; retries are #1048):**
- With `xcrun simctl boot` failing:
  - `withDevices` rejects with a `DeviceLifecycleError` whose `platform` is `ios` and whose `output` is the command's output;
  - the callback is never called;
  - the emulator is still shut down and the AVD deleted;
  - the simulator is still deleted.
- With `avdmanager create avd` failing, no `emulator` is started and no `avdmanager delete avd` is issued. The simulator is still removed.
- With `emulatorExitsEarly`, the run rejects naming `android` without waiting for the boot deadline: the fake clock advanced less than `DEVICE_BOOT_TIMEOUT_MS`.
- With `getprop` never answering `1`, the run rejects naming `android` once the fake clock passes `DEVICE_BOOT_TIMEOUT_MS`, and both devices are removed.

**Teardown that fails, and an emulator that ignores `emu kill`:**
- With `avdmanager delete avd` failing, the callback's result is still returned. A `warn` line names the AVD and the command, and the iOS simulator is still removed.
- With `emulatorIgnoresKill`, the emulator handle's `kill()` is called after `EMULATOR_EXIT_TIMEOUT_MS` on the fake clock, and `avdmanager delete avd` comes after it.

Run the file and see it fail, because the module does not exist yet.

### 4. Implement `adws/core/deviceLifecycle.ts` (green)
- Imports, all from specific modules and never from `./index`:
  - `createHash` from `node:crypto`;
  - `Platform` from `./applicationType`;
  - `type DeviceSource` from `./deviceSourceConfig`;
  - `type LogLevel` from `./logger`;
  - `type WaitClock` from `./rateLimitWaitPolicy`;
  - `isPortAvailable` from `./portAllocator`;
  - the executor types and `systemDeviceExecutor` from `./deviceExecutor`.
- Exported types:
  - `DeviceEnvironment` — `readonly ADW_ANDROID_AVD: string; readonly ADW_ANDROID_SERIAL: string; readonly ADW_IOS_UDID: string`. It spreads into a run's `env`.
  - `DeviceRequest` — `adwId`, `deviceSource`, `emulatorOutputPath`, and `record: (message: string, level: LogLevel) => void`.
  - `DeviceLifecycleDeps` — `executor`, `clock`, and `isPortAvailable: (port: number) => Promise<boolean>`.
- `export class DeviceLifecycleError extends Error` follows `DeviceSourceConfigError`:
  - `readonly name = 'DeviceLifecycleError'`;
  - the constructor `(readonly platform: Platform, message: string, readonly output: string)`.
- Constants, exported for the tests and for #1048:
  - `DEVICE_NAME_PREFIX = 'adw-'`;
  - `FIRST_CONSOLE_PORT = 5554`;
  - `CONSOLE_PORT_COUNT = 64`, with a comment: the emulator's documented range, 5554–5682, holds 64 devices; each console port's adb port is the next one;
  - `DEVICE_COMMAND_TIMEOUT_MS = 120_000`;
  - `DEVICE_BOOT_TIMEOUT_MS = 300_000`;
  - `BOOT_POLL_INTERVAL_MS = 2_000`;
  - `POLL_COMMAND_TIMEOUT_MS = 10_000`;
  - `EMULATOR_EXIT_TIMEOUT_MS = 30_000`.
- Pure helpers:
  - `deviceNameFor(adwId)` returns `` `${DEVICE_NAME_PREFIX}${adwId}` ``.
  - `emulatorConsolePortCandidates(adwId)`:
    - takes the start slot from `createHash('sha256').update(adwId).digest().readUInt32BE(0) % CONSOLE_PORT_COUNT`;
    - returns the 64 ports `FIRST_CONSOLE_PORT + 2 * ((slot + i) % CONSOLE_PORT_COUNT)`;
    - its comment says why: the hash spreads simultaneous boots over the range.
  - Private `lastLine(output)`.
  - Private `seconds(ms)`, which gives `(ms / 1000).toFixed(1)`.
- Private `allocateConsolePort(adwId, isPortAvailable)` returns the first candidate whose port and port + 1 are both free, or `null`. A comment says why the default probe uses `127.0.0.1`: the emulator listens on the loopback address, and on macOS a wildcard bind can succeed beside it.
- Default deps:
  - `executor: systemDeviceExecutor`;
  - `clock`: a local timer clock (`now: () => new Date()`, `sleep` by `setTimeout`);
  - `isPortAvailable: port => isPortAvailable(port, '127.0.0.1')`.
- Android bring-up (private; never rejects):
  1. Run `avdmanager create avd --name <name> --package <androidSystemImage> --device <androidDeviceProfile> --force` with input `no\n`. A failure gives `failed`, with nothing created.
  2. Run `adb start-server`. A comment says why it comes first: a running server is told about the emulator when it starts, while a server started later scans only 5555–5585.
  3. Note the boot start on the clock, then `start` the emulator with the table's arguments and `emulatorOutputPath`. Track its exit.
  4. Poll until ready, at most every `BOOT_POLL_INTERVAL_MS`, until `DEVICE_BOOT_TIMEOUT_MS` after the boot start:
     - fail at once if the emulator has exited;
     - otherwise `get-state`, then, once the last line is `device`, `getprop sys.boot_completed`, which is ready when its last line is `1`. An empty answer, which is what a booting emulator gives, is not ready.

     Extract one poll into a named function to keep nesting at depth 2.
  5. When ready, record `The Android emulator "<name>" (emulator-<port>) booted in <s>s` (`info`) and resolve `ready` with the AVD, the serial, the process and the boot time.
- iOS bring-up (private; never rejects):
  1. Run `xcrun simctl create <name> <iosDeviceType> <iosRuntime>`. Take the UDID from its output with a UUID pattern, because a warning may precede it. A failure, or no UDID, gives `failed` with nothing created.
  2. Note the boot start, then run `xcrun simctl boot <udid>`. A failure gives `failed`, with the simulator created.
  3. Run `xcrun simctl bootstatus <udid>` with `DEVICE_BOOT_TIMEOUT_MS`. A failure gives `failed`, with the simulator created and booting.
  4. Record `The iOS simulator "<name>" (<udid>) booted in <s>s` and resolve `ready`.
- Teardown (private; never rejects; one function per platform, so that per device the shut down comes before the delete):
  - **Android, shut down.** If the emulator was started and has not exited:
    - run `adb -s <serial> emu kill`;
    - wait for the exit, polling the tracked exit with `clock.sleep(BOOT_POLL_INTERVAL_MS)` until `EMULATOR_EXIT_TIMEOUT_MS` (as `stopServer` does);
    - if it is still running, call `kill()` and wait once more.

    A comment says why: `avdmanager` will not delete an AVD whose emulator is running.
  - **Android, delete.** If the AVD was created, run `avdmanager delete avd --name <name>`.
  - **iOS, shut down.** Run `xcrun simctl shutdown <udid>` if the boot was issued.
  - **iOS, delete.** Run `xcrun simctl delete <udid>` if the simulator was created.
  - **What is recorded.** After each device, record `Removed the Android AVD "<name>" (emulator-<port>)` or `Removed the iOS simulator "<name>" (<udid>)` (`info`) when every one of its commands succeeded. Otherwise record a `warn` line that names the device, the command, its exit code and the last line of its output.
- `export async function withDevices<T>(request, work: (devices: DeviceEnvironment) => Promise<T>, deps: Partial<DeviceLifecycleDeps> = {}): Promise<T>`:
  1. Merge `deps` over the defaults, and take `name = deviceNameFor(request.adwId)`.
  2. Allocate the console port. With none free, record and throw a `DeviceLifecycleError` for `android` before anything is created.
  3. Record the creation line: `Creating the devices of this workflow: the Android AVD "<name>" (<androidSystemImage>, <androidDeviceProfile>) on console port <port>, and the iOS simulator "<name>" (<iosDeviceType>, <iosRuntime>)`.
  4. `const [android, ios] = await Promise.all([bringUpAndroid(…), bringUpIos(…)])`. Both always resolve, so neither is left running unseen.
  5. In `try`, if either result is `failed`, record each error (`error`) and throw the first, Android before iOS. Otherwise `return await work({ ADW_ANDROID_AVD: name, ADW_ANDROID_SERIAL: serial, ADW_IOS_UDID: udid })`.
  6. In `finally`, `await Promise.all([tearDownAndroid(android), tearDownIos(ios)])`.
- Doc comment on `withDevices` (only what the signature cannot say):
  - teardown runs on every outcome, including a callback that throws and a device that did not come up;
  - a failed teardown is recorded, never thrown;
  - a device that does not come up is a `DeviceLifecycleError`, after everything created has been removed.
- Never use the identifier `applicationType` in this module, because of the guard in `applicationType.test.ts`.
- Keep the file under 300 lines. If it grows past that, move the command lines (pure argv builders, such as `createAvdCommand` and `emulatorCommand`) into a pure `adws/core/deviceCommands.ts`.
- Run `bunx vitest run adws/core/__tests__/deviceLifecycle.test.ts adws/core/__tests__/deviceExecutor.test.ts`. Both pass.

### 5. Re-export the lifecycle from `adws/core/index.ts`
- After the `portAllocator` export, add:
  - `export type { DeviceCommand, DeviceCommandResult, DeviceExecutor, DeviceProcess } from './deviceExecutor';`
  - `export { systemDeviceExecutor } from './deviceExecutor';`
  - `export type { DeviceEnvironment, DeviceLifecycleDeps, DeviceRequest } from './deviceLifecycle';`
  - `export { withDevices, deviceNameFor, emulatorConsolePortCandidates, DeviceLifecycleError, DEVICE_NAME_PREFIX } from './deviceLifecycle';`
- The phase keeps importing from `../core/deviceLifecycle` directly. The phase tests mock `../../core` with only `log`, `AgentStateManager` and `emptyModelUsageMap`.

### 6. Give the phase-test helpers a device stand-in
In `adws/phases/__tests__/scenarioTestPhase.helpers.ts`:
- `makeConfig`'s overrides gain `deviceSources?: DeviceSourceSections`. The `projectConfig` literal gets `deviceSources: overrides.deviceSources ?? parseDeviceSourceSections('')`, so that every field is `null` by default.
- `export const EVERY_DEVICE_SOURCE: DeviceSourceSections` holds the four sample values of `TEST_DEVICE_SOURCE`.
- `export const STAND_IN_DEVICES: DeviceEnvironment` holds `adw-test-id`, `emulator-5580` and a fixed UDID.
- `export function fakeDevices(events: string[] = []): { withDevices: ScenarioTestPhaseDeps['withDevices']; requests: DeviceRequest[] }`:
  - records each request;
  - pushes `'devices ready'`;
  - awaits `work(STAND_IN_DEVICES)` in a `try`, and pushes `'devices removed'` in `finally`;
  - is cast like `fakeLifecycle`'s function.

  Give it a one-line doc comment in `fakeLifecycle`'s style.
- Keep `fakeLifecycle`, `makeConfig`'s other defaults and the proofs as they are.

### 7. Write the phase's device tests (red)
Create `adws/phases/__tests__/scenarioTestPhase.devices.test.ts`, with the same `vi.mock` blocks as its siblings (`../scenarioProof`, `../../cost`, `../../core`). Let `MOBILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm']`, and use `makeConfig({ applicationProfile: MOBILE, deviceSources: EVERY_DEVICE_SOURCE })` with `{ readDeclaredDevServer: () => null, withDevices }`.

**For a profile with platforms:**
- The run command gets the three variables beside the application address: `runScenarioProof`'s `env` equals `{ ADW_APPLICATION_URL: 'http://localhost:4567', ...STAND_IN_DEVICES }` (acceptance criterion 4).
- The lifecycle is asked once for the devices of this workflow:
  - `requests[0].adwId` is `test-id`;
  - `requests[0].deviceSource` equals the four resolved values;
  - `requests[0].emulatorOutputPath` is `/logs/android-emulator.log`.
- The scenarios run while the devices exist: `events` is `['devices ready', 'scenarios ran', 'devices removed']`, where the `runScenarioProof` mock pushes `'scenarios ran'`.
- The result and the context are as before: the passing proof is returned, and `config.ctx.scenarioProof` is set.
- Every line the lifecycle records reaches the orchestrator log (acceptance criterion 5). After the run, calling `requests[0].record('The Android emulator "adw-test-id" (emulator-5580) booted in 41.0s', 'info')` makes `AgentStateManager.appendLog` receive `('/state.json', that line)`.
- An error thrown inside the devices comes out of the phase. If `runScenarioProof` rejects, the phase rejects with that error, and `events` ends with `'devices removed'`.
- With a declared dev server, the devices are created inside it: the order is `server started`, `devices ready`, `scenarios ran`, `devices removed`, `server stopped`. When the server does not start (`fakeLifecycle({ output })`), the lifecycle is never asked.
- No scenarios means no devices: with `scenariosMd: ''`, and with the run-by-tag command `N/A`, `requests` is empty and the proof does not run.

**For profiles without platforms (acceptance criterion 4):**
- `it.each` over `cli` and `web`, with and without every device source set:
  - `requests` is empty, so no device command was issued;
  - `runScenarioProof` ran once;
  - its `env` equals exactly `{ ADW_APPLICATION_URL: 'http://localhost:4567' }`.

Run the file and see the platform cases fail.

### 8. Run the scenario proof inside `withDevices` in `executeScenarioTestPhase` (green)
In `adws/phases/scenarioTestPhase.ts`:
- **Imports.** `withDevices`, `type DeviceEnvironment` and `type DeviceRequest` from `../core/deviceLifecycle`, and `type DeviceSource` from `../core/deviceSourceConfig`.
- **Constant.** `const EMULATOR_LOG_FILE = 'android-emulator.log';` beside `DEV_SERVER_LOG_FILE`.
- **Deps.** `ScenarioTestPhaseDeps` gains `readonly withDevices: typeof withDevices;`, and `DEFAULT_DEPS` gains `withDevices`.
- **`requireDeviceSource(run, platforms): DeviceSource | null`.**
  - `not_required` → `null`;
  - `resolved` → `resolution.deviceSource`;
  - `missing` records and throws as today.
- **`deviceRequest({ config }: PhaseRun, deviceSource: DeviceSource): DeviceRequest`** returns:
  - `adwId`;
  - `deviceSource`;
  - `emulatorOutputPath: path.join(config.logsDir, EMULATOR_LOG_FILE)`;
  - `record: (message, level) => recordLine(config.orchestratorStatePath, message, level)`.
- **In `executeScenarioTestPhase`:**
  - `const deviceSource = requireDeviceSource(run, applicationProfile.platforms);` stays in the same place, before the runner and the skip.
  - `runProof` becomes `(devices?: DeviceEnvironment) => runScenarioProof({ …, env: { ADW_APPLICATION_URL: applicationUrl, ...devices } })`. With no devices, `env` is exactly `{ ADW_APPLICATION_URL }`.
  - Add, after `runProof`:

    ```ts
    const runProofOnDevices = deviceSource === null
      ? () => runProof()
      : () => lifecycle.withDevices(deviceRequest(run, deviceSource), runProof);
    ```

  - Use `runProofOnDevices` in both places that run the proof: the no-server `settleProof(run, await runProofOnDevices(), NO_DEV_SERVER_START)` and `runUnderServer(run, server, runProofOnDevices, lifecycle)`. So the devices live inside the dev server, when there is one, and only while scenarios run.
- **Doc comments.** In the function's doc comment, add: for a profile with platforms, the proof runs on one emulator and one simulator that the device lifecycle creates for the workflow. The scenario command gets their identities as `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`, and they are removed afterwards. A device that does not come up rejects with `DeviceLifecycleError`. In the module's header comment, list the device lifecycle among what the module hides.
- **Naming guard.** Do not use the identifier `applicationType`.
- **Size.** The file stays under 300 lines (about 230).
- Run `bunx vitest run adws/phases/__tests__/scenarioTestPhase.devices.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/scenarioTestPhase.runner.test.ts adws/phases/__tests__/scenarioTestPhase.server.test.ts`. All pass.

### 9. Keep the device-source phase test off the host's device tools
In `adws/phases/__tests__/scenarioTestPhase.deviceSource.test.ts`:
- The case "runs the proof as before when every section is set" passes `{ ...NO_DECLARED_SERVER, withDevices: fakeDevices().withDevices }`. Import `fakeDevices` from the helpers.
- Name the case for what it now proves: the proof runs, on the devices the lifecycle creates, when every section is set.
- Leave every other case unchanged. The missing-section cases throw before any device is asked for, and the `cli` and `web` cases never ask.
- Run `bunx vitest run adws/phases/__tests__/scenarioTestPhase.deviceSource.test.ts`. It passes, and no device tool runs.

### 10. Keep the BDD scenarios that run the real phase on a `mobile:kotlincm` worktree hermetic
- **Why.** These scenarios run the real `executeScenarioTestPhase` on a `mobile:kotlincm` worktree that names device sources:
  - `@adw-1043`: 104308 and 104309, 104310, and the review outline row 104313;
  - `@adw-1045`: the missing-section outline 104501–104503. Its `When the workflow's scenario test phase is attempted` calls feature-992's `runScenarioTestPhase`;
  - `@adw-1046`: 104610, 104611 and 104612. Their `When the scenario test phase runs and the review phase judges its proof` calls feature-994's `runScenarioTests`.

  After Task 8, those that get past the device-source check would run the real `avdmanager`, `emulator`, `adb` and `xcrun`. On a CI host those fail; on a developer's Mac they create real devices.

  The scenario writer has tagged each of these scenarios `@adw-1047` and given it the step `And the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot`. The missing-section outline also asserts `And no device tool was run`.
- **Create `features/regression/support/standInDevices.ts`**, with a header comment in the style of `feature-992-standins.ts`: a stand-in for the host's device tools; no hooks and no steps. It exports:
  - `STAND_IN_UDID`.
  - `export interface StandInDeviceCommand { readonly argv: readonly string[]; readonly at: number }`. `at` is when the command was issued, in milliseconds since the epoch, as each stand-in run in `feature-992-standins.ts` records its own `at`. With it, a step can place the device commands before the scenario command's first run and after its last.
  - `export interface StandInDeviceHost { readonly withDevices: ScenarioTestPhaseDeps['withDevices']; readonly commands: readonly StandInDeviceCommand[] }`.
  - `export function standInDeviceHost(): StandInDeviceHost`. It builds the real `withDevices` over:
    - an executor that records each command (`start` included) and answers like a healthy host: `xcrun simctl create` prints `STAND_IN_UDID`, `get-state` prints `device`, `getprop sys.boot_completed` prints `1`, everything else exits 0, and the emulator exits on `emu kill`;
    - a clock whose `sleep` resolves at once;
    - `isPortAvailable: async () => true`.

    It keeps the new host as the most recent one. `lastStandInDeviceHost()` returns that host, or `undefined` when there is none, for steps that read the commands.
  - `export function resetStandInDeviceHost(): void`, which forgets the most recent host.
- **Pass the stand-in to the two real-phase harnesses.** Each harness passes the host the scenario installed, or a fresh one if the scenario installed none. So no harness run reaches the real device tools, whether or not the scenario has the step.
  - In `features/regression/step_definitions/feature-992-phase.steps.ts`, `runScenarioTestPhase` runs `executeScenarioTestPhase(workflow.config, { withDevices: (lastStandInDeviceHost() ?? standInDeviceHost()).withDevices })`.
  - In `features/per-issue/step_definitions/feature-994-workflow.ts`, `runScenarioTests` does the same.

  `cli` and `web` scenarios never reach it. Use the `.ts` import extension of the features code.
- **Define the two shared steps** in `features/per-issue/step_definitions/feature-1047-host.steps.ts`:
  - `Given the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot` calls `standInDeviceHost()`.
  - `Then no device tool was run` asserts that the scenario installed a stand-in device host and that the host recorded no command.
- **Run** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1043"`, `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1045"` and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1046"`. All three pass, and no real device tool runs.

### 11. Write the step definitions the `@adw-1047` scenarios need
The scenario writer has written `features/per-issue/feature-1047.feature`, tagged `@adw-1047`, and has also tagged the scenarios of features 1043, 1045 and 1046 listed in Task 10. These scenarios are the build's RED tests: write a scenario's steps, see it fail, then make it pass.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-1047"` to list the undefined steps.
- Reuse every phrase that already has a definition, and register no pattern twice. Steps likely to be reused:
  - feature-992's workflow, `.adw/`, stand-in scenario command and phase steps (`When the workflow's scenario test phase runs`);
  - feature-1045's device-source steps (`the worktree's {string} names every device source`);
  - the recorded stand-in calls, whose `env` carries the `ADW_` variables the scenario command received;
  - the device-tools stand-in step and `no device tool was run`, from Task 10.
- New phrases go in `features/per-issue/step_definitions/feature-1047-*.ts`, with a `feature-1047-world.ts` that registers the `@adw-1047` hooks in the style of `feature-1045-world.ts`.
  - Its `Before` hook also calls `resetStandInDeviceHost()`.
  - The scenarios of features 1043, 1045 and 1046 that carry `@adw-1047` also run their own feature's hooks, so every reset must be safe to run twice.
- Read the device commands from `lastStandInDeviceHost()`.
  - Order them against the scenario command's recorded runs by `at`. Every create, boot and wait command comes at or before the first run's `at`, and every shut-down and delete command at or after the last run's `at`.
  - The create commands carry the four values of `SAMPLE_DEVICE_SOURCE` in `feature-992-adw-files.ts`, which `the worktree's ".adw/project.md" names every device source` writes. Export that constant for the step.
- Read the run log from the workflow's execution log under its orchestrator state path. It holds the `booted in <s>s` line of each device and, after them, `Removed the Android AVD …` and `Removed the iOS simulator …`. A `cli` or `web` log has no line that mentions an emulator, an AVD or a simulator.
- The step `the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run, exits 1, and writes a JUnit report in which one scenario fails` marks the issue's tag as failing, and sets the new exit code of the stand-in scenario command to 1.
- For scenarios that drive the lifecycle directly, call `withDevices` with:
  - a recording executor built in the step file. Never call the real executor;
  - a clock whose `sleep` resolves at once;
  - a port probe that reports every port free, so that each emulator gets its ADW ID's first candidate.

  The executor answers a not-ready `getprop sys.boot_completed` with an empty output, and the UDID a step names when `xcrun simctl create` runs.
- The rows of `the device lifecycle took these steps for each of the emulator and the simulator, in this order:` are the rows of the table in the Feature Description:
  - `create`;
  - `boot`, which for Android is `adb start-server` and then `emulator`;
  - `wait until ready`;
  - `run the callback`, the hand-over;
  - `shut down`;
  - `delete`.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047"`. Every scenario passes and none is undefined.

### 12. Update the README
- **The "Application type decides the evidence" bullet.** After the device-source sentence, add: for a profile with platforms, the scenario phase runs the scenario proof on one Android emulator and one iOS simulator that ADW creates for the workflow from those sections. Then say:
  - both are named `adw-<adwId>`;
  - the emulator boots headless on a console port of its own;
  - ADW waits until each is ready;
  - the scenario command gets them as `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`, beside `ADW_PROOF_DIR`, `ADW_JUNIT_REPORT_PATH` and `ADW_APPLICATION_URL`;
  - both are shut down and deleted afterwards, whatever the outcome (`adws/core/deviceLifecycle.ts`);
  - the run log names the devices, each boot time and their removal;
  - `avdmanager`, `emulator`, `adb` and `xcrun simctl` must be on the host's `PATH`.
- **`adws/core/` tree**, in alphabetical order:
  - `deviceExecutor.ts  # The process boundary of the device lifecycle: runs avdmanager, emulator, adb and xcrun simctl as argv arrays without a shell (systemDeviceExecutor)`
  - `deviceLifecycle.ts  # withDevices: creates, boots and hands over one AVD and one simulator named adw-<adwId>, on a console port of the workflow's own, and removes both on every outcome`
  - `deviceExecutor.test.ts` and `deviceLifecycle.test.ts` under `adws/core/__tests__/`, and `fixtures/recordingDeviceHost.ts` if the tree lists the fixtures.
- **`adws/phases/` tree.**
  - Add `scenarioTestPhase.devices.test.ts` under `__tests__/`.
  - Extend `scenarioTestPhase.ts`'s entry: for a profile with platforms, it runs the scenarios on the workflow's own emulator and simulator.
- **What not to describe.** Leave out boot retries and the `device_boot_failed` park (#1048), the baseline re-run (#1049) and the janitor (#1050).

### 13. Run the validation commands
Run every command in `Validation Commands` and fix any failure before finishing. Fix the cause; never suppress or weaken a check.

## Testing Strategy
### Unit Tests
- **`adws/core/__tests__/deviceLifecycle.test.ts` (new) — PRD Testing Decisions 1, this slice's part.** It drives the lifecycle through `withDevices` with the recording device host (fake clock, recording executor, scripted answers) and covers:
  - device naming;
  - the console port candidates: 64 even ports in 5554–5680, deterministic, and different for two ADW IDs;
  - the create, boot, wait, callback, shut-down, delete sequence of each device;
  - the callback after both devices are ready and before either is shut down;
  - the environment the callback receives, and the result it returns;
  - the `no\n` answer to `avdmanager`;
  - teardown after a throwing callback, with the same error rethrown;
  - the console port differing between two ADW IDs, the serial following the port, and taken ports skipped;
  - readiness polling on the injected clock;
  - the run-log lines: names, boot times from the injected clock, removal;
  - teardown when a device does not come up: a failed boot, a failed create, an emulator that exits early, the boot deadline;
  - a failing teardown command recorded as a warning without masking the result;
  - an emulator killed after it ignores `emu kill`, with its AVD deleted after the exit.
- **`adws/core/__tests__/deviceExecutor.test.ts` (new)** covers the boundary against real `sh`:
  - one output buffer and the exit code;
  - stdin input, and stdin closed without it;
  - a missing program resolving with `exitCode: null`;
  - the timeout;
  - a started process writing to its output file and reporting its exit;
  - `kill()`.
- **`adws/phases/__tests__/scenarioTestPhase.devices.test.ts` (new).** For a profile with platforms:
  - the three variables beside `ADW_APPLICATION_URL` in the run's `env`;
  - one request with the ADW ID, the resolved device source and the emulator log under `logsDir`;
  - the run inside the devices;
  - the recorded lines reaching the orchestrator log;
  - an error propagating with the devices removed;
  - the devices inside a declared dev server, and no devices when it does not start;
  - no devices when no scenario is configured.

  For `cli` and `web`: no device request, and `env` exactly `{ ADW_APPLICATION_URL }`.
- **`adws/phases/__tests__/scenarioTestPhase.deviceSource.test.ts`.** The every-section case injects `fakeDevices`.
- **Existing tests that must stay green unchanged:**
  - `scenarioTestPhase.test.ts`, `scenarioTestPhase.runner.test.ts` and `scenarioTestPhase.server.test.ts`;
  - `scenarioProofRun.test.ts`;
  - `devServerLifecycle.test.ts` and `devServerLifecycle.healthy.test.ts`;
  - `applicationType.test.ts` (the naming guard);
  - `scenarioTestFixLoop*.test.ts` and `reviewRetryLoop*.test.ts`;
  - the orchestrator tests that mock `executeScenarioTestPhase`.

### Edge Cases
- **A callback that throws.** Both devices are shut down and deleted after it, and the same error object comes out of `withDevices` and out of the phase.
- **A device that does not come up** (create, boot or readiness fails). The other device, and whatever this one created, is still removed. The callback never runs, and a `DeviceLifecycleError` names the platform and carries the output. In this slice the workflow fails, without a park.
- **Both devices fail.** Each error is recorded, and the Android one is thrown.
- **The emulator exits before it is ready.** The lifecycle fails at once, not at the 5-minute deadline.
- **Readiness never comes.** The lifecycle fails at `DEVICE_BOOT_TIMEOUT_MS` on the injected clock and removes both devices. It never polls forever.
- **`adb` prints daemon start-up chatter.** Only the last line of the output is read (`device`, `1`).
- **`simctl create` prints a warning before the UDID.** The UDID is found by its pattern. Output without one is a failed create, and nothing is left to delete.
- **A simulator created but never booted** is deleted without a `shutdown`, so no spurious warning is recorded.
- **An AVD whose create failed** is not deleted, and no emulator is started for it.
- **An emulator that ignores `emu kill`** is killed with its process group after `EMULATOR_EXIT_TIMEOUT_MS`. Its AVD is deleted only once it has exited.
- **A teardown command that fails** is recorded as a warning naming the device and the command. The callback's result or error is unchanged, and the other device's teardown still runs.
- **A taken console port, or a taken adb port above it,** is skipped for the next candidate, wrapping around. With all 64 taken, the lifecycle fails before creating anything.
- **Two workflows booting at the same moment** start from different hash-chosen ports. If one still takes a port another has just chosen, the emulator does not start ("If any of the console or adb ports are already in use, the emulator won't start"), and the device fails to come up. #1048's retry is where a fresh allocation follows.
- **A re-run with the same ADW ID after a crash.** `--force` replaces a leftover AVD of that name. A leftover simulator is a different UDID and stays until #1050's janitor.
- **No scenarios** (`scenariosMd` empty or the run-by-tag command `N/A`): no device is created. A missing device-source section still throws first (#1045).
- **A declared dev server for a mobile repository.** The devices live inside the server. When the server does not start, no device is created.
- **`cli` and `web`.** No request reaches the lifecycle, `env` is unchanged, and the device-source sections are ignored.
- **A scenario that fails.** A failed scenario is a result, not an error. The proof records the blocker failure as before, and both devices are removed after the scenario command's last run.
- **The scenario fix loop and the review retries** re-run the phase. Each run creates and removes its own devices.
- **An ADW ID or a device-source value holding shell metacharacters** cannot inject anything, because commands run as argv arrays without a shell.

## Acceptance Criteria
- With the recording executor, a successful `withDevices` run issues, for each device in order:
  - Android: `avdmanager create avd`, `adb start-server` and `emulator -avd … -port … -no-window …`, the `adb` readiness polls, the callback, `adb … emu kill`, `avdmanager delete avd`;
  - iOS: `xcrun simctl create`, `simctl boot`, `simctl bootstatus`, the callback, `simctl shutdown`, `simctl delete`.

  The callback runs after both devices are ready and before either is shut down. It receives exactly `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` (`emulator-<console port>`) and `ADW_IOS_UDID`, and `withDevices` returns its result.
- A callback that throws still gets both devices shut down and deleted, and `withDevices` rejects with the same error.
- The emulator's console port differs between two ADW IDs. It is even, in 5554–5680, the serial follows it, and a port in use is never handed out.
- Both devices are named `adw-<adwId>`. The emulator runs headless (`-no-window`) with its output in `<logsDir>/android-emulator.log`.
- A device that cannot be created, booted or made ready makes `withDevices` reject with a `DeviceLifecycleError` naming the platform, after everything created has been removed.
- `executeScenarioTestPhase` on a profile with platforms runs the scenario proof inside `withDevices`, with the resolved device source and the workflow's ADW ID. Its run command's `env` holds the three variables beside `ADW_APPLICATION_URL`, and `runScenarioProof` adds `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH`. On `cli` and `web` the phase makes no device request, and `env` is exactly `{ ADW_APPLICATION_URL }`.
- The orchestrator log carries:
  - the creation line naming both devices;
  - `booted in <s>s` for each device, timed by the injected clock;
  - a removal line for each device.
- The executor and the clock are injected. No unit test or BDD scenario runs a real `avdmanager`, `emulator`, `adb` or `xcrun`.
- The `@adw-1047` scenarios pass, and the `@adw-1043`, `@adw-1045`, `@adw-1046` and `@regression` scenarios still pass.
- Every new or changed source and test file is under 300 lines, and only `core/projectConfig.ts` and `phases/applicationTypeGate.ts` use the identifier `applicationType`.
- Unit tests, lint, both type checks and the build pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/deviceLifecycle.test.ts adws/core/__tests__/deviceExecutor.test.ts` — the lifecycle and its executor.
- `bunx vitest run adws/phases/__tests__/scenarioTestPhase.devices.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/scenarioTestPhase.deviceSource.test.ts adws/phases/__tests__/scenarioTestPhase.runner.test.ts adws/phases/__tests__/scenarioTestPhase.server.test.ts adws/phases/__tests__/scenarioProofRun.test.ts` — the phase with and without platforms.
- `bunx vitest run adws/core/__tests__/applicationType.test.ts adws/core/__tests__/devServerLifecycle.test.ts adws/core/__tests__/devServerLifecycle.healthy.test.ts adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/reviewRetryLoop.test.ts` — the naming guard, the dev-server lifecycle, and the phase's callers.
- `bun run lint` — the linter.
- `bunx tsc --noEmit` — the type check of every `**/*.ts`, including tests and `features/`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional type check.
- `bun run build` — the build.
- `bun run test:unit` — the full unit suite, with zero regressions.
- `wc -l adws/core/deviceLifecycle.ts adws/core/deviceExecutor.ts adws/phases/scenarioTestPhase.ts adws/phases/__tests__/scenarioTestPhase.helpers.ts adws/phases/__tests__/scenarioTestPhase.devices.test.ts adws/core/__tests__/deviceLifecycle.test.ts adws/core/__tests__/fixtures/recordingDeviceHost.ts features/regression/support/standInDevices.ts` — each under 300 lines.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047"` — this issue's scenarios, none of them undefined.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1043"` — the `mobile:kotlincm` scenarios that run the real phase, now on the stand-in device host.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1045"` — the device-source scenarios, unchanged in outcome, and no device tool runs when a section is missing.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1046"` — the per-issue image scenarios of `mobile:kotlincm` workflows, now on the stand-in device host.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite, with zero regressions.

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - files under 300 lines, which is why the executor is its own module and the device phase tests have their own file;
  - side effects only in `deviceExecutor.ts`, with pure naming and port helpers;
  - closed result types for the bring-ups;
  - guard clauses, nesting depth of at most 2 (extract the readiness poll), and extracted inline callbacks over three lines;
  - `readonly` types, no `any`, no `!`;
  - comments only for invariants and non-obvious reasons: the `127.0.0.1` probe, `adb start-server` first, waiting for the emulator to exit before deleting its AVD, the hash-spread port, the non-blocking executor;
  - no issue numbers in code.
- **No new library.** `node:crypto`, `child_process` and `fs` suffice. If a library is ever needed, `.adw/commands.md` names `bun add <package>`.
- **Why `scenarioTestPhase.devices.test.ts` instead of `scenarioTestPhase.test.ts`.** The issue lists `scenarioTestPhase.test.ts`, which is already 209 lines. The device cases would push it past the 300-line limit. The phase's tests are already split by concern (`.runner`, `.server`, `.deviceSource`), so the device cases get a sibling of their own, and `scenarioTestPhase.test.ts` is left unchanged.
- **Why the slice throws on a device that does not come up.** The issue scopes retries and the park to #1048. A `DeviceLifecycleError` thrown from the phase fails the workflow through `runPhase` → the orchestrator's `catch` → `handleWorkflowError`: an error comment, no park. That is the path `DeviceSourceConfigError` takes (#1045). #1048 turns the bring-up results into the closed outcome (ready, boot failed with attempts and output, tool missing) and parks `device_boot_failed`. The bring-ups already resolve to closed results, so that change stays inside the lifecycle.
- **Why the console port is hashed and then probed.**
  - The emulator accepts 64 console ports.
  - A hash alone lets two of five parallel workflows share one about 15% of the time, against user story 11.
  - Probing alone from 5554 races between simultaneous boots.
  - The hash spreads the starting points, and the probe skips ports in use.
  - What remains is two boots choosing the same just-free port within seconds of each other. The emulator then refuses to start, and #1048's retry absorbs it.
- **Why the executor is asynchronous and shell-free.** Boots take minutes. A blocking call would stop the heartbeat ticker, and the hung-orchestrator detector reads that heartbeat. Argv arrays without a shell keep ADW IDs and `.adw/project.md` values from being interpreted.
- **Host prerequisites (not ADW's to install).** `avdmanager`, `emulator`, `adb` and `xcrun simctl` are found on the orchestrator's `PATH`, and the configured system image and simulator runtime must be installed (PRD "Host prerequisites"). In this slice, a missing tool shows as a failed command in the `DeviceLifecycleError` output; #1048 names the tool and does not retry.
- **Devices are created whenever the phase runs a profile with platforms.** That includes a run whose proof then skips for lack of Kotlin step definitions, as in a bootstrap issue. So the pipeline host needs its device tools before a mobile repository's first issue reaches the scenario phase.
- **The janitor's building blocks (#1050).** The fixed `adw-` prefix (`DEVICE_NAME_PREFIX`, `deviceNameFor`) lets a sweep find devices named for an ADW ID. `DeviceExecutor` and `systemDeviceExecutor` are "the lifecycle's executor" that its listing and deletion go through. Both are re-exported from `adws/core/index.ts`, as is `withDevices` for #1049's baseline re-run.
- **Out of scope for this slice:**
  - boot retries, the closed outcome type and the `device_boot_failed` park (#1048);
  - the baseline regression re-run on devices (#1049);
  - the device janitor (#1050);
  - `adw_init`'s device-source defaults and the step-definition prompt's device variables (#1044 and its siblings);
  - a host-wide cap on concurrent boots, deferred by the PRD; the lifecycle is its future home.
- **Documentation.** Leave `.adw/conditional_docs.md`, `app_docs/` and ADR-0064's `### Confirmation` to `/document`. The new `deviceExecutor.ts` and `deviceLifecycle.ts` likely belong to `app_docs/feature-9gjajh-dev-server-and-ports.md` (the lifecycle and port prior art). `features/regression/support/standInDevices.ts` falls under `app_docs/feature-9gjajh-bdd-regression-suite.md`'s `features/regression/**` glob.
- **Release.** Nothing here is live on the pipeline host until a release to `main` and a host restart (ADR-0064).
