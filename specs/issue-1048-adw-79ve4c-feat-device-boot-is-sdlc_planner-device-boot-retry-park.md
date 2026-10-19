# Feature: Device boot is retried three times, then the workflow parks as `device_boot_failed`

## Metadata
issueNumber: `1048`
adwId: `79ve4c-feat-device-boot-is`
issueJson: `{"number":1048,"title":"feat: device boot is retried three times, then the workflow parks as device_boot_failed","body":"## Parent PRD\n\n`specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record: `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`)\n\n## What to build\n\nThe lifecycle's outcome becomes a closed type: ready, boot failed (platform, attempt count, combined output), host tool missing (tool name). Boot is attempted three times per device; a missing `avdmanager`, `emulator`, `adb` or `xcrun simctl` is not retried. A failed outcome parks the workflow `human_gated` through the existing park path with a new reason `device_boot_failed`, whose comment quotes the output under the existing fence rules and documents `## Retry` as re-running the scenario phase; `## Continue` waives nothing. See PRD \"Device lifecycle\" and \"Park reason\".\n\n## Acceptance criteria\n\n- [ ] A device whose boot fails twice and succeeds the third time is ready; one that fails three times yields boot-failed with attempt count 3 and the combined output, after teardown of whatever was created\n- [ ] A missing tool yields tool-missing naming the tool, with no retry\n- [ ] `executeScenarioTestPhase` parks with `device_boot_failed` on either outcome; the comment names the platform, quotes the output and states what `## Retry` does\n- [ ] `## Retry` on that park resumes at the scenario phase\n- [ ] Lifecycle unit tests extended for the retry and tool-missing paths\n\n## Blocked by\n#1047 <!-- adw:region-overlap -->\n#1045 <!-- adw:region-overlap -->\n\n- Blocked by #1047\n\n## Touched Files\n\n- adws/core/deviceLifecycle.ts\n- adws/core/__tests__/deviceLifecycle.test.ts\n- adws/forge/parkComment.ts\n- adws/forge/__tests__/parkComment.test.ts\n- adws/phases/scenarioTestPhase.ts\n- adws/phases/__tests__/scenarioTestPhase.test.ts\n\n## User stories addressed\n\n- User stories 16, 17, 18, 19\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-18T15:00:13Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-10-18T15:05:31Z","body":"⏸️ **Deferred behind #1045 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #1045, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #1045 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/phases/scenariotestphase.ts`\n- `adws/phases/__tests__/scenariotestphase.test.ts`\n\nThis issue will spawn automatically once #1045 merges and closes. To override, remove the `#1045 <!-- adw:region-overlap -->` line from this issue body."},{"author":"paysdoc-adw","createdAt":"2026-10-18T22:06:57Z","body":"⏸️ **Deferred behind #1047 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #1047, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #1047 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/core/devicelifecycle.ts`\n- `adws/core/__tests__/devicelifecycle.test.ts`\n- `adws/phases/scenariotestphase.ts`\n- `adws/phases/__tests__/scenariotestphase.test.ts`\n\nThis issue will spawn automatically once #1047 merges and closes. To override, remove the `#1047 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description
Since #1047, `withDevices` (`adws/core/deviceLifecycle.ts`) gives a `mobile:kotlincm` workflow its own Android emulator and iOS simulator, both named `adw-<adwId>`, around the scenario proof run. When a device does not come up, it removes what it created and rejects with a `DeviceLifecycleError`. The workflow then fails through `handleWorkflowError`: an error comment, no retry and no park. So one emulator hiccup fails the whole issue. Examples are a cold boot that misses the deadline once, two workflows racing for the same console port, or a simulator that refuses one boot. A host without `avdmanager` looks the same as any other failure.

This feature completes the lifecycle's failure handling, as the PRD's "Device lifecycle" and "Park reason" sections describe:

- **A closed outcome.** `withDevices` no longer throws for a device that does not come up. It returns one of:
  - `ready`, with the callback's result;
  - `boot_failed`, with the platform, the attempt count and the combined output of the attempts;
  - `tool_missing`, with the platform, the host tool and its output.

  A callback that throws still rejects with its own error, after teardown.
- **Three boot attempts per device** (`MAX_BOOT_ATTEMPTS = 3`, the dev server's start attempts). Before the next attempt starts, and before any outcome is read, ADW removes what the failed attempt created. Each Android attempt probes for a free console port again, so a port another workflow took since the last probe is skipped.
- **A missing host tool is not retried.** ADW reads it from the executor's answer: `avdmanager`, `emulator`, `adb` or `xcrun` not on the `PATH`, or `xcrun` unable to find `simctl`. The attempt stops at once and the outcome names the tool.
- **The park.** `executeScenarioTestPhase` turns either failed outcome into a `human_gated` park through the existing `parkWorkflow`, with the new reason `device_boot_failed`. The park comment:
  - names the platform;
  - says how many attempts failed, or which tool is missing;
  - quotes the output under the existing fence rules (indented, cut at `MAX_PARK_OUTPUT_CHARS`);
  - says that `## Retry` re-runs the scenario phase and that `## Continue` waives nothing.

  `## Retry` needs no new code: it re-arms the park to `phase_timeout`, and the resumed run skips the completed phases and runs the scenario phase again.

The value to operators:
- a transient emulator failure no longer stops an issue (user story 16);
- a host that cannot boot devices shows up as a host problem with the boot output, not as scenario failures sent to the fix agent (17);
- a missing tool is named so that it can be installed (18);
- fixing the host and posting `## Retry` is enough (19).

## User Story
As an ADW operator running mobile workflows on a shared pipeline host
I want a device that fails to boot to be retried, and a device that still fails, or a host tool that is missing, to park the workflow with a comment that names the platform and quotes the output
So that a transient emulator hiccup does not stop an issue, a host problem is never treated as a code problem, and fixing the host and posting `## Retry` is enough to continue

## Problem Statement
The device lifecycle from #1047 has one failure path. Whatever stops a device from coming up, a `DeviceLifecycleError` is thrown after teardown, and the workflow fails like any other error. This has four consequences:
- **No resilience.** Booting an emulator is flaky, and two workflows can still race for one just-free console port, as #1047's plan anticipated. One failed boot ends the issue, and the operator must restart it by hand.
- **Wrong category.** The PRD and ADR-0064 decide that a device that does not boot is the host's problem, not the diff's. Today it surfaces as a workflow error, not as a stop that waits for a person.
- **No diagnosis of missing tools.** A host without `avdmanager`, `emulator`, `adb` or `xcrun simctl` fails with whatever the spawn error says, and a retry would be pointless. Without a closed outcome, nothing can tell a missing tool from a boot failure.
- **No recovery path.** No park reason exists for it. `## Retry` has no `human_gated` state to re-arm, and the park comment cannot say what `## Retry` or `## Continue` would do.

## Solution Statement
1. **The executor says when a program is missing.** `DeviceCommandResult` gains an optional `programMissing: true`, set when the spawn fails with `ENOENT`. A started `DeviceProcess` gains `programMissing()`, true once a process that never started has settled. This is the process boundary's answer, read from `error.code` rather than from text.
2. **Pure tool knowledge in `deviceCommands.ts`.** It gains:
   - `MAX_BOOT_ATTEMPTS = 3`;
   - a `HostTool` enum (`avdmanager`, `emulator`, `adb`, `xcrun simctl`);
   - `missingToolOf(command, result)`, which reads a missing program, or `xcrun`'s `unable to find utility "simctl"` answer, as the tool that is missing.
3. **Each device is booted in attempts.** A generic attempts loop in `deviceLifecycle.ts` runs one bring-up attempt at a time:
   - on `ready`, it keeps the device;
   - on a failure, it records the failure in the run log (`warn` while another attempt follows, `error` for the last), tears down what the attempt created, and tries again;
   - on a missing tool, it stops at once.

   After `MAX_BOOT_ATTEMPTS` failures it answers `boot_failed` with the combined output. Each attempt's block is `Attempt <n> of 3: <message>` followed by that attempt's output.
4. **A smaller lifecycle module.** One attempt to bring up each device, and each device's teardown, move into a new module, `adws/core/deviceBringUp.ts`. They are moved unchanged, apart from the per-attempt port and the missing-tool reading. `deviceLifecycle.ts` keeps `withDevices`, its public types, the attempts loop and the outcome, so both files stay under 300 lines.
5. **Outcome and teardown.** `withDevices` returns `DeviceOutcome<T>` once both devices' attempts have settled and every device created has been removed. When both fail, the outcome is a `tool_missing` first, then Android's failure, then iOS's.
6. **A new park reason.** `ParkReason.DeviceBootFailed = 'device_boot_failed'`, with evidence `{ reason, failure: DeviceFailure }`. Its title, its directives and its description follow the existing builder's patterns: `inlineCode` for the platform and the tool, `quote` for the output, and no base-branch note.
7. **The scenario phase parks.** `executeScenarioTestPhase` gets the device outcome:
   - without a dev server, directly;
   - with a declared dev server, through it, so that the server has stopped first.

   On `ready` it settles the proof as before. On a failure it records the summary and the combined output in the execution log, then calls the injected `park` (default `parkWorkflow`) with `device_boot_failed`.
8. **`## Retry` and `## Continue`.** `parkWorkflow` writes `human_gated` with `parkReason: 'device_boot_failed'`. `## Retry` re-arms that to `phase_timeout`, and the takeover resumes the same ADW ID in place: completed named phases and recovery stages are skipped, and the scenario phase runs again with fresh devices. `continueHandler`'s waivable set stays the three base-branch parks, so `## Continue` waives nothing. A test pins that.

## Relevant Files
Use these files to implement the feature:

- `README.md` — Two places describe the device lifecycle and must state the retries and the park: the "Application type decides the evidence" bullet, and the `adws/core/` and `adws/phases/` trees.
- `.adw/coding_guidelines.md` — Rules this feature must follow:
  - files under 300 lines, which is why the bring-up moves out;
  - guard clauses and a nesting depth of at most 2;
  - enums for named constant sets (`HostTool`), and closed union types;
  - comments only for invariants and non-obvious reasons, and no issue numbers.
- `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` — The source of the requirements: the "Device lifecycle" section (closed outcome, three attempts, a missing tool not retried), the "Park reason" section, "Scenario phase and baseline re-run", user stories 16–19, and Testing Decisions 1.
- `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md` — The decision: "Boot is retried three times, then the workflow parks `human_gated` with a new reason, `device_boot_failed` … `## Retry` re-runs the scenario phase". It rejected treating a boot failure as a failed review.
- `app_docs/feature-ko14m9-device-lifecycle.md` — Conditional doc for the lifecycle. Its contracts must survive: teardown on every outcome, bring-ups that never reject, the port probe on `127.0.0.1`, `adb start-server` before the emulator, and an AVD deleted only after its emulator has exited. It still says "there are no boot retries and no park yet".
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — Conditional doc for `parkWorkflow`, the park comment builder (`buildParkComment`, `parkDirectives`, `ParkReason`) and the scenario test phase.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — Conditional doc for `## Retry`: `human_gated → phase_timeout` with `resumeAttempts: 0`, and the resume in place that skips completed phases.
- `adws/core/deviceLifecycle.ts` — `withDevices`. It becomes outcome-returning, gains the attempts loop and keeps the public types.
- `adws/core/deviceCommands.ts` — Pure device commands and readers. It gains `MAX_BOOT_ATTEMPTS`, `HostTool` and `missingToolOf`.
- `adws/core/deviceExecutor.ts` — The process boundary. It reports a program that is not on the `PATH`, for both `run` and `start`.
- `adws/core/applicationType.ts` — The `Platform` enum used by the lifecycle. It imports `forge/parkComment.ts` at runtime, so `parkComment.ts` may only import lifecycle types with `import type`.
- `adws/core/devServerLifecycle.ts` — Prior art: `MAX_START_ATTEMPTS = 3` and the closed `HealthyDevServerOutcome<T>`.
- `adws/core/index.ts` — Re-exports the lifecycle. `DeviceLifecycleError` leaves the public surface, and the outcome types, `HostTool` and `MAX_BOOT_ATTEMPTS` join it.
- `adws/core/phaseRunner.ts`, `adws/phases/workflowInit.ts` — Why `## Retry` resumes at the scenario phase:
  - named completed phases are skipped;
  - the unnamed scenario test loop always runs;
  - `parkReason` is cleared when a run starts.
- `adws/core/__tests__/deviceLifecycle.test.ts`, `adws/core/__tests__/deviceLifecycle.failures.test.ts` — The existing lifecycle tests, which move from thrown errors to outcomes.
- `adws/core/__tests__/deviceExecutor.test.ts` — The executor tests, extended for `programMissing`.
- `adws/core/__tests__/fixtures/recordingDeviceHost.ts` — The recording device host, extended to script failures that clear after some attempts, and missing tools.
- `adws/forge/parkComment.ts` — `ParkReason`, `ParkEvidence`, `TITLES`, `parkDirectives`, `describeFailure`, `quote` and `inlineCode`. The new reason goes here.
- `adws/forge/__tests__/parkComment.helpers.ts`, `parkComment.structure.test.ts`, `parkComment.content.test.ts`, `parkComment.quoting.test.ts` — The park comment tests. The issue's `parkComment.test.ts` is split into these files, and `SAMPLE` is a `Record<ParkReason, ParkEvidence>`, so the new reason must be added there.
- `adws/phases/scenarioTestPhase.ts` — `executeScenarioTestPhase`. It gains the `park` dependency and parks on a failed outcome.
- `adws/phases/__tests__/scenarioTestPhase.helpers.ts`, `scenarioTestPhase.devices.test.ts` — The phase's device stand-ins and tests. `fakeDevices` must return an outcome.
- `adws/phases/workflowPark.ts` — `parkWorkflow(config, evidence): never`. It writes `human_gated` and `parkReason` before posting the comment, then exits 0. Unchanged.
- `adws/phases/applicationTypeGate.ts` and `adws/phases/__tests__/applicationTypeGate.test.ts` — Prior art for an injected `park` dependency, faked in tests by a `Parked` sentinel throw.
- `adws/phases/scenarioTestFixLoop.ts`, `adws/phases/reviewRetryLoop.ts` — The callers of `executeScenarioTestPhase`. Unchanged: a park exits the process from inside them.
- `adws/triggers/retryHandler.ts` — `## Retry` on `human_gated` re-arms `phase_timeout`. Unchanged.
- `adws/triggers/continueHandler.ts` and `adws/triggers/__tests__/continueHandler.test.ts` — `WAIVABLE_PARK_REASONS` stays the three base-branch parks. The test's `NOT_WAIVABLE` gains the new reason.
- `features/regression/support/standInDevices.ts` — The BDD stand-in device executor. Its started process must implement `programMissing()`, and it may gain failure options for the `@adw-1048` steps.
- `features/per-issue/step_definitions/feature-1047-lifecycle.steps.ts` — Calls `withDevices` directly and expects the callback's result. It must unwrap the `ready` outcome.
- `features/per-issue/step_definitions/feature-989-park.steps.ts` — The park comment steps (`evidenceFor`), which the `@adw-1048` scenarios may reuse.

### New Files
- `adws/core/deviceBringUp.ts` — One attempt to create, boot and await each device, and each device's teardown, moved out of `deviceLifecycle.ts`. The attempt now allocates its own console port and reads a missing tool from the answer.
- `adws/core/__tests__/deviceLifecycle.retries.test.ts` — The lifecycle's retry and missing-tool paths, driven through `withDevices` on the recording device host.
- `adws/phases/__tests__/scenarioTestPhase.deviceBoot.test.ts` — The scenario phase parking with `device_boot_failed` on either failed outcome.
- `features/per-issue/step_definitions/feature-1048-*.ts` — The step definitions the `@adw-1048` scenarios need, as many files as they need.

## Implementation Plan
### Phase 1: Foundation
- Let the executor report a program that is not on the host's `PATH`, for both `run` and `start`.
- Add the pure tool knowledge to `deviceCommands.ts`: `MAX_BOOT_ATTEMPTS`, `HostTool` and `missingToolOf`.
- Extend the recording device host so that a test can script:
  - a command that fails a number of times before it succeeds;
  - an emulator that exits early a number of times;
  - a program that is missing.
- Move one bring-up attempt and each device's teardown into `deviceBringUp.ts`. This is a pure move, and the existing lifecycle tests stay green.

### Phase 2: Core Implementation
- Write the retry and missing-tool tests, and move the existing lifecycle tests to the outcome (red).
- Make `withDevices` return the closed `DeviceOutcome<T>`, attempt each device up to three times with teardown between attempts, allocate a console port per Android attempt, and stop at once on a missing tool (green).
- Add `ParkReason.DeviceBootFailed` with its evidence, title, directives and description (tests first).

### Phase 3: Integration
- Make the scenario test phase park through an injected `park` (default `parkWorkflow`) on a failed outcome, after the devices and any dev server have been removed (tests first).
- Pin that `## Continue` waives nothing for the new park.
- Keep the BDD support (`standInDevices.ts`) and the `@adw-1047` lifecycle steps in step with the outcome type.
- Write the `@adw-1048` step definitions.
- Update the README.
- Run the validation commands.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Let the executor say that a program is not on the host (test first)
- In `adws/core/__tests__/deviceExecutor.test.ts`:
  - The test "resolves, and never rejects, for a program that does not exist" also asserts `result.programMissing` is `true`.
  - Add: a program that runs and fails (`sh -c 'exit 3'`) carries no `programMissing`.
  - Add: `start` of a program that does not exist answers `programMissing()` `true` once `exited` has settled, and a program that ran (`true`) answers `false`.
- In `adws/core/deviceExecutor.ts`:
  - `DeviceCommandResult` gains `readonly programMissing?: true`. It is set only when the program is not on the host's `PATH`, so the command never ran. Every other answer stays exactly `{ exitCode, output }`, so the existing `toEqual` assertions on real results still hold.
  - `DeviceProcess` gains `programMissing(): boolean`, known once `exited` has settled.
  - `runDeviceCommand`'s `'error'` handler sets `programMissing: true` when `(error as NodeJS.ErrnoException).code === 'ENOENT'`. The synchronous `catch` never sets it.
  - `launch` notes an `ENOENT` in its `'error'` handler before it resolves `exited`. `NEVER_STARTED` answers `false`: an output file that cannot be opened is not a missing tool.

### 2. Name the host tools and read a missing one from an answer
In `adws/core/deviceCommands.ts`, which stays pure:
- `export const MAX_BOOT_ATTEMPTS = 3;`
- `export enum HostTool { AvdManager = 'avdmanager', Emulator = 'emulator', Adb = 'adb', Simctl = 'xcrun simctl' }`
- `hostToolOf(argv): HostTool | null` maps a command's program to its tool: `xcrun` is only ever asked for `simctl`, so it maps to `HostTool.Simctl`. Use an own-key lookup table, not a chain of `if`s.
- `missingToolOf(command, result): HostTool | null` returns:
  - `hostToolOf(command.argv)` when `result.programMissing`;
  - `HostTool.Simctl` when an `xcrun` command answered `unable to find utility "simctl"`, which is how a host with the Command Line Tools but no Xcode answers (exit code 72);
  - `null` otherwise. A tool that ran and failed is a boot failure, not a missing tool.

### 3. Script retries and missing tools in the recording device host
In `adws/core/__tests__/fixtures/recordingDeviceHost.ts`, which stays under 300 lines:
- `DeviceHostScript` gains these fields:
  - `failingTimes: Readonly<Record<string, number>>` — how many issues of a command in `failing` exit 1 before it answers as a healthy host, keyed by the same leading words. A command in `failing` with no count fails every time, as today.
  - `missingTools: readonly string[]` — programs that are not on the host. A command of one answers like the real executor: `{ exitCode: null, output: 'Error: spawn <program> ENOENT', programMissing: true }`. A started one has already exited with no exit code, and its `programMissing()` is `true`.
  - `emulatorEarlyExits: number` replaces `emulatorExitsEarly: boolean`. It is how many started emulators exit before they are ready: 0 by default, `Infinity` for every one. Update the one existing test that sets `emulatorExitsEarly: true`.
- The started emulator implements `programMissing()`.
- The `failing` and `failingTimes` count is kept per leading words, separately from the per-line poll counters.

### 4. Move one attempt and each device's teardown into `adws/core/deviceBringUp.ts` (refactor, still green)
`deviceLifecycle.ts` is 288 lines, and the outcome and the attempts loop would push it past the 300-line limit.
- Move into `deviceBringUp.ts`, unchanged:
  - `Session`, `Ran` and `execute`;
  - the teardown-command helper, renamed from `attempt` so that it is not confused with a boot attempt;
  - `because` and `requireSuccess`;
  - `TrackedProcess` and `track`;
  - `AndroidDevice`, `IosSimulator` and `BringUp`;
  - `DeviceLifecycleError` and `lifecycleError`;
  - `BootWait`, `waitFor` and `awaitAndroidBoot`;
  - `bringUpAndroid` and `bringUpIos`;
  - `awaitExit`, `shutDownEmulator`, `reportRemoval`, `tearDownAndroid` and `tearDownIos`;
  - `allocateConsolePort`, `seconds`, `BOOT_POLL_INTERVAL_MS` and `EMULATOR_EXIT_TIMEOUT_MS`.
- `deviceLifecycle.ts` keeps:
  - `DeviceEnvironment`, `DeviceRequest` and `DeviceLifecycleDeps`;
  - the defaults: `timerClock`, `probeLoopback` and `DEFAULT_DEPS`;
  - `quietly` and `withDevices`;
  - its re-exports. Re-export `BOOT_POLL_INTERVAL_MS` and `EMULATOR_EXIT_TIMEOUT_MS` too, since the tests import them from `../deviceLifecycle`.
- No runtime import cycle between the two modules. Either `deviceBringUp.ts` imports `DeviceRequest` and `DeviceLifecycleDeps` with `import type`, or they are defined there and re-exported from `deviceLifecycle.ts`.
- Keep the module header comments accurate, and give `deviceBringUp.ts` a short header in the style of `deviceCommands.ts`.
- Run `bunx vitest run adws/core/__tests__/deviceLifecycle.test.ts adws/core/__tests__/deviceLifecycle.failures.test.ts`. They pass unchanged.

### 5. Write the lifecycle's retry and missing-tool tests, and move the existing tests to the outcome (red)
- **New `adws/core/__tests__/deviceLifecycle.retries.test.ts`.** It drives `withDevices` on the recording host and reads only what a caller or an operator sees: the outcome, `host.events`, `host.started` and `host.lines`.
  - **Retries:**
    - **iOS succeeds on the third attempt.** `xcrun simctl boot` fails twice (`failingTimes`), then succeeds. The outcome is `{ kind: 'ready', result }` with the callback's result. `xcrun simctl create` was issued 3 times, each failed attempt's simulator was deleted before the next `create`, and the callback ran once.
    - **Android succeeds on the third attempt.** The emulator exits early twice (`emulatorEarlyExits: 2`), then boots. The outcome is `ready`, and 3 emulators were started. After each failed attempt, `avdmanager delete avd` came before the next `avdmanager create avd`. The serial handed over is the console port of the emulator that booted.
    - **iOS fails three times.** `xcrun simctl boot` fails every time. The outcome is `{ kind: 'boot_failed', platform: Platform.Ios, attempts: 3 }`. Its `output` holds `Attempt 1 of 3`, `Attempt 2 of 3` and `Attempt 3 of 3`, and the scripted output three times. The callback never ran. Every simulator created was deleted, and the emulator and its AVD were removed, before the outcome came back (as many deletes as creates).
    - **Android never boots.** The emulator never reports that it has booted (`pollsUntilBootCompleted: Infinity`). The outcome is `boot_failed` for `Platform.Android` with 3 attempts, and the fake clock has passed at least `3 * DEVICE_BOOT_TIMEOUT_MS`. Each emulator was asked to quit, and its AVD deleted, before the next attempt's `avdmanager create avd`.
    - **`MAX_BOOT_ATTEMPTS` is 3.**
    - **A fresh console port per attempt.** A test-local `isPortAvailable` reports the first candidate taken once an emulator has started. The second emulator then starts on the next candidate, and `ADW_ANDROID_SERIAL` follows it.
    - **Every console port is in use.** The outcome is `boot_failed` for Android with 3 attempts and the no-free-port message. No AVD was created, no emulator was started, and the simulator was removed.
    - **The run log.**
      - Each attempt that will be retried leaves a `warn` line naming the attempt (`attempt 1 of 3`) and its failure. The last attempt leaves an `error` line.
      - Each attempt leaves a creation line naming the attempt; Android's also names its console port.
  - **Missing tools** (none of them is retried):
    - **`missingTools: ['avdmanager']`.** The outcome is `{ kind: 'tool_missing', platform: Platform.Android, tool: HostTool.AvdManager }`, and its output contains `ENOENT`. `avdmanager create avd` was issued exactly once, no emulator was started, and the simulator was still removed.
    - **`missingTools: ['adb']`.** The outcome names `HostTool.Adb`, `adb start-server` was issued once, and the AVD was deleted.
    - **`missingTools: ['emulator']`.** The outcome names `HostTool.Emulator`, one emulator start was issued, the AVD was deleted, and less than `DEVICE_BOOT_TIMEOUT_MS` passed.
    - **`missingTools: ['xcrun']`.** The outcome names `HostTool.Simctl` and `Platform.Ios`, `xcrun simctl create` was issued once, and the emulator and its AVD were removed.
    - **A host with no Xcode.** `failing: { 'xcrun simctl create': 'xcrun: error: unable to find utility "simctl", not a developer tool or in PATH\n' }` gives `tool_missing` `HostTool.Simctl`, with `create` issued once.
    - **A missing tool and a boot failure.** A tool missing on one device and a boot failure on the other give the `tool_missing` outcome.
    - **Its run log.** The `error` line of a missing tool names the tool and says the boot is not tried again.
- **`adws/core/__tests__/deviceLifecycle.test.ts`.**
  - `runWith` unwraps a `ready` outcome and fails the test on any other.
  - "returns what the callback returns" expects `{ kind: 'ready', result: 'what the callback returned' }`.
  - "reads only the last line…" reads `outcome.result`.
  - The creation-line test asserts the two per-device, per-attempt lines: Android with its console port and `attempt 1 of 3`, and iOS with its device type and runtime.
- **`adws/core/__tests__/deviceLifecycle.failures.test.ts`.**
  - `failureOf` returns the non-`ready` outcome, and fails the test when the outcome is `ready`.
  - Each test asserts `kind`, `platform`, and `output` with `toContain`, since the output is now combined.
  - "records the error of each device that failed, and throws the Android one" becomes "…and returns the Android one". It still has one `error` line per device.
  - The every-port-in-use test moves to the retries file.
  - The throwing-executor test expects `boot_failed` for iOS, with an output that holds `executor exploded`.
  - Both files stay under 300 lines.
- Run the three files: the new paths fail.

### 6. Make the outcome closed and attempt each boot three times (green)
In `adws/core/deviceLifecycle.ts` and `adws/core/deviceBringUp.ts`:
- **The public types.**
  - `export type DeviceFailure = | { readonly kind: 'boot_failed'; readonly platform: Platform; readonly attempts: number; readonly output: string } | { readonly kind: 'tool_missing'; readonly platform: Platform; readonly tool: HostTool; readonly output: string };`
  - `export type DeviceOutcome<T> = { readonly kind: 'ready'; readonly result: T } | DeviceFailure;`
  - Re-export `HostTool` and `MAX_BOOT_ATTEMPTS` beside the other device constants.
- **The attempt error.** The error that ends one attempt (today's `DeviceLifecycleError`, now internal to `deviceBringUp.ts`) gains `missingTool: HostTool | null`.
  - `requireSuccess` fills it from `missingToolOf(command, ran)`.
  - An emulator that exited before it was ready, and whose `handle.programMissing()` is true, fails its attempt with `HostTool.Emulator`.
  - `lifecycleError` (an executor that threw) has no missing tool.
- **The Android attempt allocates its own console port** with the existing `127.0.0.1` probe, and records its creation line naming the AVD, the device source, the port and the attempt.
  - When no port is free, the attempt fails without creating anything. The message is the existing "No console port is free…" text.
  - The iOS attempt records its own creation line too.
  - These per-device lines replace the single up-front "Creating the devices of this workflow…" line.
- **The attempts loop.** One generic, never-rejecting function per device, taking that device's single-attempt bring-up and teardown. While fewer than `MAX_BOOT_ATTEMPTS` attempts have failed, it:
  - runs an attempt, and keeps the device if it is `ready`;
  - otherwise records the failure: `warn` with `attempt <n> of 3` when another attempt follows, `error` for the last attempt or a missing tool;
  - tears down what the attempt created, before the next attempt reuses the names and the port, and before the outcome is read;
  - stops at once on a missing tool, with `tool_missing`.

  After the last attempt it answers `boot_failed` with `attempts` and the combined output. Keep the nesting depth at 2: extract the per-attempt failure handling into a named function.
- **The combined output.** One block per failed attempt, `Attempt <n> of <MAX_BOOT_ATTEMPTS>: <message>` followed by the attempt's output (end-trimmed, left out when empty). Blocks are separated by a blank line. A pure function builds it, and `tool_missing` uses the same blocks.
- **`withDevices<T>(request, work, deps?): Promise<DeviceOutcome<T>>`.**
  - Run both devices' attempts loops with `Promise.all`. Neither rejects, so both have settled, and left nothing running unseen, before either is read.
  - In `try`/`finally`, tear down only the devices that are `ready`; the attempts loop has already removed failed attempts.
  - When either device failed, return the failure reported: a `tool_missing` first, otherwise Android's, then iOS's. Each failure was recorded by its loop.
  - Otherwise return `{ kind: 'ready', result: await work(environment) }`.
  - A callback that throws still rejects with its own error, after teardown, and teardown still never throws.
  - Rewrite the JSDoc of `withDevices` to say this.
- Run `bunx vitest run adws/core/__tests__/deviceLifecycle.retries.test.ts adws/core/__tests__/deviceLifecycle.test.ts adws/core/__tests__/deviceLifecycle.failures.test.ts adws/core/__tests__/deviceExecutor.test.ts`. All pass. Check `wc -l adws/core/deviceLifecycle.ts adws/core/deviceBringUp.ts`: each is under 300.

### 7. Re-export the outcome from `adws/core/index.ts`
- Replace `DeviceLifecycleError` in the `./deviceLifecycle` export with `type DeviceFailure`, `type DeviceOutcome`, `HostTool` and `MAX_BOOT_ATTEMPTS`.
- Nothing outside `adws/core/` imports `DeviceLifecycleError`.

### 8. Add the park reason `device_boot_failed` (tests first)
- **Tests:**
  - `parkComment.helpers.ts`:
    - `SAMPLE[ParkReason.DeviceBootFailed]` is a `boot_failed` evidence for `Platform.Ios` with 3 attempts, and an output of three `Attempt n of 3: …` blocks over `Unable to boot device`.
    - Export a `toolMissing(overrides?)` builder for an `avdmanager` evidence on `Platform.Android`, whose output is `Error: spawn avdmanager ENOENT`.
  - `parkComment.structure.test.ts`:
    - the per-reason `describe.each(REASONS)` covers the new reason by itself;
    - add `ParkReason.DeviceBootFailed` to the "carries no base-branch note" cases;
    - "gives each reason directives of its own" expects 5;
    - add a test that pins this park's directives. `## Retry` is exactly `re-runs the scenario phase, which creates and boots the devices again, and parks the issue again if a device still does not boot`. `## Continue` contains `waives nothing` and `` `## Retry` ``.
  - `parkComment.content.test.ts`:
    - **boot failed.** The comment names the platform (`` `ios` ``) and the 3 attempts, says that what each attempt created was removed and that no scenario ran, and says it is a problem of the host, not of the change. It quotes the output as an indented block (`\n    Unable to boot device`).
    - **tool missing.** The comment names the tool (`` `avdmanager` ``) and the platform (`` `android` ``), says it was not retried and that the tool must be installed on the host's `PATH`, and quotes the output (`\n    Error: spawn avdmanager ENOENT`).
  - `parkComment.quoting.test.ts`:
    - add a `device_boot_failed` evidence whose output is `HOSTILE` to `hostileEvidence`;
    - add a test that a device output longer than `MAX_PARK_OUTPUT_CHARS` is cut and marked.
- **Implementation** (`adws/forge/parkComment.ts`):
  - `ParkReason.DeviceBootFailed = 'device_boot_failed'`.
  - `ParkEvidence` gains `| { readonly reason: ParkReason.DeviceBootFailed; readonly failure: DeviceFailure }`, with `import type { DeviceFailure } from '../core/deviceLifecycle'`. The import must be type-only: `core/applicationType.ts` imports this module at runtime, and `deviceLifecycle.ts` imports `applicationType.ts`.
  - `TITLES[ParkReason.DeviceBootFailed] = 'A Device Did Not Boot'`.
  - A `parkDirectives` case:
    - `retry`: `re-runs the scenario phase, which creates and boots the devices again, and parks the issue again if a device still does not boot`;
    - `continue`: `waives nothing, because no scenario can run without the devices: fix the host, then use \`## Retry\``.
  - A `describeFailure` case delegating to `describeDeviceFailure(failure)`. It switches on `failure.kind` with a `never` guard, and both kinds end with `quote(failure.output)`.
    - **`boot_failed`:** the `` `<platform>` `` device did not boot in `<attempts>` attempts; ADW removed what each attempt had created, and no scenario ran; the problem is the host's, not this issue's change, so it does not go to the fix agent; then the output of the attempts.
    - **`tool_missing`:** the host tool `` `<tool>` `` is not on the host's `PATH`, so the `` `<platform>` `` device could not be created and ADW did not retry; install it on the host that runs ADW; then its output.
  - Render the platform and the tool with `inlineCode`, from their string values. Do not import `Platform` or `HostTool` at runtime.
  - No line may begin with a directive, and the text must not contain "base branch". `baseBranchNote` needs no change: its `default` returns `null`.
- Run the three park-comment test files: all pass.

### 9. Pin that `## Continue` waives nothing for the new park
- In `adws/triggers/__tests__/continueHandler.test.ts`, add `ParkReason.DeviceBootFailed` to `NOT_WAIVABLE`.
- `continueHandler.ts` is unchanged: `WAIVABLE_PARK_REASONS` stays the three base-branch parks.

### 10. Park from the scenario phase on a failed outcome (tests first)
- **Helpers** (`adws/phases/__tests__/scenarioTestPhase.helpers.ts`, under 300 lines):
  - `fakeDevices` returns `{ kind: 'ready', result: await work(STAND_IN_DEVICES) }`.
  - `failingDevices(failure, events?)` returns a `withDevices` that records the request, pushes `'devices failed'` and returns the failure without calling the work.
  - `recordingPark()` returns `{ park, parked }`. Its `park` records the evidence and throws an exported `Parked` sentinel, since the real park never returns.
  - Add sample `BOOT_FAILED` (Android, 3 attempts) and `TOOL_MISSING` (`xcrun simctl`, iOS) failures.
- **New `adws/phases/__tests__/scenarioTestPhase.deviceBoot.test.ts`.** It mocks `../scenarioProof`, `../../cost` and `../../core` as the device tests do. Its cases:
  - **A boot failure parks.** `park` is called once with `{ reason: ParkReason.DeviceBootFailed, failure: BOOT_FAILED }`, the phase rejects with `Parked` and does not return, and `runScenarioProof` is never called.
  - **A missing tool parks too,** with evidence that carries the tool.
  - **The comment.** `buildParkComment('test-id', parked[0])` names the platform, quotes the output as an indented block, and contains `` `## Retry` — `` followed by `parkDirectives(parked[0]).retry`, which says it re-runs the scenario phase.
  - **The execution log.** Before the park, it gets a line naming the platform and saying no scenario ran, and the combined output (`mockAppendLog` with `/state.json`).
  - **With a declared dev server, the park comes after the server has stopped.** The events are `server started`, `devices failed`, `server stopped`, and the park comes after `server stopped`.
  - **A later run starts afresh.** After a parked run, a run of the phase with devices that boot asks for devices again and runs the scenarios. The phase keeps nothing from the parked run, which is what `## Retry` resumes.
  - **A `ready` outcome never parks.**
  - **`cli` and `web` profiles never reach the device lifecycle or the park.**
- **`scenarioTestPhase.devices.test.ts`.** Rename "fails with the error of the device lifecycle when a device does not come up, and runs no scenario" to "fails with the error the device lifecycle throws, and runs no scenario". A thrown error, such as the callback's, still propagates.
- **Implementation** (`adws/phases/scenarioTestPhase.ts`, under 300 lines):
  - `ScenarioTestPhaseDeps` gains `readonly park: typeof parkWorkflow`, and `DEFAULT_DEPS` adds `park: parkWorkflow`.
  - `runProofOnDevices` returns `Promise<DeviceOutcome<ScenarioProofResult>>`. With no device source it returns `{ kind: 'ready', result: await runProof() }`. Otherwise it returns `lifecycle.withDevices(deviceRequest(run, deviceSource), runProof)`.
  - `runUnderServer` takes that function. After `withHealthyDevServer` has returned, and the server has stopped, a started server settles `outcome.result` with `{ status: DevServerStartStatus.Started }`. A failed start goes to `failedStart` as before.
  - `settleOnDevices(run, outcome, devServer, park)`: `ready` goes to `settleProof`, and anything else to `parkOnDeviceFailure`.
  - `parkOnDeviceFailure(run, failure, park): never` records, with `recordLine` at `error`, a summary line, then `failure.output`. Then it returns `park(run.config, { reason: ParkReason.DeviceBootFailed, failure })`.
    - For `boot_failed` the summary is "Scenario test phase: the `<platform>` device did not boot in `<n>` attempts; no scenario ran. The output of the attempts:".
    - For `tool_missing` it is "Scenario test phase: `<tool>` is not on the host's PATH, so the `<platform>` device could not be created; no scenario ran. Its output:".
  - Update the JSDoc of `executeScenarioTestPhase`. A device that does not boot in its attempts, or a missing host tool, parks the workflow as `human_gated` with `device_boot_failed`, after the devices and any dev server have been removed, and the phase does not return. The device-source error is unchanged: it still throws and does not park.
- Run the phase test files: all pass.

### 11. Keep the BDD support and the `@adw-1047` steps in step with the outcome
- `features/regression/support/standInDevices.ts`: the started process implements `programMissing: () => false`. `standInDeviceHost().withDevices` passes the outcome through unchanged.
- `features/per-issue/step_definitions/feature-1047-lifecycle.steps.ts`, `runLifecycle`: record a `ready` outcome's `result` as `returned`, and any other outcome as the `failure`. Then "the device lifecycle came back with what the callback returned" and "failed with the error the callback threw" keep their meaning.
- No change to the feature-992 and feature-994 callers. They pass the stand-in `withDevices` to the phase, and the stand-in devices always boot, so they never reach the real `parkWorkflow`. Its `process.exit(0)` would end the cucumber run.

### 12. Write the step definitions the `@adw-1048` scenarios need
The scenario writer writes `features/per-issue/feature-1048.feature`, tagged `@adw-1048`. Its scenarios are the build's RED tests: write a scenario's steps, see it fail, then make it pass.
- **Undefined steps.** Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-1048"` to list them.
- **Reuse every phrase that already has a definition,** and register no pattern twice:
  - feature-1047's lifecycle and stand-in device steps;
  - feature-992's workflow and phase steps;
  - feature-989's park comment steps. Extend `evidenceFor` with a `device_boot_failed` case if the scenarios use them;
  - the promoted retry-directive vocabulary (`features/regression/retry-directive/`) for `## Retry` on a `human_gated` park.
- **New phrases** go in `features/per-issue/step_definitions/feature-1048-*.ts`. Register the `@adw-1048` hooks in a world file in the style of `feature-1047-world.ts`: call `resetStandInDeviceHost()`, and make every reset safe to run twice.
- **Scenarios that drive the lifecycle directly** call the real `withDevices` over a recording executor, never the real one.
  - Extend `standInDeviceExecutor`'s options as needed, for example a command that fails a number of times, or a program that is missing. A missing program answers like the real executor: `exitCode: null`, `Error: spawn <program> ENOENT`, `programMissing: true`, and a started one has exited at once.
  - Use a clock whose `sleep` resolves at once, and a port probe that reports every port free.
- **Scenarios that run the scenario test phase** pass that host's `withDevices` and a recording `park` that throws a sentinel. Never use the real `parkWorkflow`. Read the comment with `buildParkComment(adwId, evidence)`.
- **Scenarios about `## Retry`** go through `handleRetryDirective` with recording deps, as the retry-directive steps do: a `human_gated` state with `parkReason: 'device_boot_failed'` is re-armed to `phase_timeout` with `resumeAttempts: 0`. The phase run again on devices that boot runs the scenarios.
- **Run** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1048"`. Every scenario passes, and none is undefined.

### 13. Update the README
- **The "Application type decides the evidence" bullet.** After "`avdmanager`, `emulator`, `adb` and `xcrun simctl` must be on the host's `PATH`.", add:
  - each device's boot is tried up to three times;
  - what a failed attempt created is removed before the next, and the emulator gets a free console port on each attempt;
  - a missing host tool is not retried;
  - a device that still does not boot, or a missing tool, parks the workflow as `human_gated` with the `device_boot_failed` park comment, which names the platform (and the tool) and quotes the output;
  - `## Retry` re-runs the scenario phase, and `## Continue` waives nothing.
- **`adws/core/` tree.**
  - Add `deviceBringUp.ts  # One attempt to create, boot and await each device (on a console port it probes for), and each device's teardown; it reads a missing host tool from the executor's answer`, in alphabetical order.
  - Update the `deviceLifecycle.ts` entry: `withDevices` tries each boot three times and returns ready, boot failed or tool missing, after removing everything it created.
  - Mention `HostTool`, `MAX_BOOT_ATTEMPTS` and the missing-tool reader in the `deviceCommands.ts` entry.
  - Add `deviceLifecycle.retries.test.ts` under `__tests__/`.
- **`adws/phases/` tree.**
  - Add `scenarioTestPhase.deviceBoot.test.ts` under `__tests__/`.
  - Extend the `scenarioTestPhase.ts` entry: it parks `device_boot_failed` when a device does not boot in three attempts or a host tool is missing.
- **What not to describe:** the baseline re-run on devices (#1049) and the device janitor (#1050).

### 14. Run the validation commands
Run every command in `Validation Commands` and fix any failure before finishing. Fix the cause; never suppress or weaken a check.

## Testing Strategy
### Unit Tests
- **`adws/core/__tests__/deviceLifecycle.retries.test.ts` (new).** PRD Testing Decisions 1: "the retry count and that a missing tool is not retried", and "teardown after a boot that fails on every attempt". It covers:
  - success on the third attempt, for iOS and for Android;
  - `boot_failed` after three attempts, with `attempts: 3` and the combined output, for both platforms;
  - teardown between attempts, and of everything before the outcome;
  - a fresh console port per attempt;
  - every console port in use;
  - `tool_missing` for `avdmanager`, `adb`, `emulator`, `xcrun`, and `xcrun` without `simctl`, each with no retry and the other device removed;
  - `tool_missing` reported ahead of a boot failure;
  - the `warn` and `error` lines of the attempts.
- **`adws/core/__tests__/deviceLifecycle.test.ts` and `deviceLifecycle.failures.test.ts`.** Moved to the outcome:
  - the success sequence is unchanged;
  - `ready` carries the callback's result;
  - a throwing callback still rejects with its own error after teardown;
  - each existing failure is a `boot_failed` outcome with the right platform and output, after teardown;
  - the creation lines are per device and per attempt.
- **`adws/core/__tests__/deviceExecutor.test.ts`.** `programMissing` from `run` and from `start` for a program that does not exist, and absent or `false` for programs that ran.
- **`adws/forge/__tests__/parkComment.*.test.ts`.**
  - The new reason passes every per-reason structure test: heading, ADW ID line, `human_gated`, both directives, no stage, no directive line.
  - Its directives are pinned and distinct.
  - The content tests cover both kinds: platform, attempts or tool, output quoted and indented, the host-not-change sentence, and no base-branch note.
  - Hostile and over-long outputs are quoted safely.
- **`adws/triggers/__tests__/continueHandler.test.ts`.** `device_boot_failed` is not waivable.
- **`adws/phases/__tests__/scenarioTestPhase.deviceBoot.test.ts` (new).**
  - It parks with `device_boot_failed` on both kinds, without running a scenario.
  - The comment from its evidence names the platform, quotes the output and states the `## Retry` meaning.
  - It logs the output before the park.
  - It parks after a declared dev server has stopped.
  - A later run starts afresh.
  - A `ready` outcome never parks.
- **Existing tests that must stay green:**
  - `scenarioTestPhase.devices.test.ts`, with one test renamed;
  - `scenarioTestPhase.test.ts`, `.deviceSource`, `.runner` and `.server`;
  - `workflowPark.test.ts` and `retryHandler.test.ts`;
  - `scenarioTestFixLoop*.test.ts` and `reviewRetryLoop*.test.ts`;
  - `applicationType.test.ts`, the naming guard.

### Edge Cases
- **A boot fails twice, then succeeds.** The device is `ready`. The two failed attempts' devices were removed, the callback ran once, and the run log shows two `warn` lines.
- **Both devices fail.** Each loop records its own failures. The outcome is Android's `boot_failed`, or the `tool_missing` of either device when there is one. Everything created on both sides is removed before the outcome is returned.
- **One device is `ready` and the other fails.** The callback never runs, and the `ready` device is torn down in `finally`.
- **An emulator still running after a timed-out attempt.** It is asked to quit and, if it ignores `adb emu kill`, killed with its process group before its AVD is deleted and the next attempt starts. The console port is then free for the retry.
- **Two workflows race for one console port.** The losing emulator does not start. The retry probes again and skips the port, now in use.
- **Every console port is in use.** No AVD is created and no emulator is started in any attempt. The outcome is `boot_failed` for Android with the no-free-port message, and the simulator is removed.
- **A host with the Command Line Tools but no Xcode.** `xcrun` exists, but `simctl` does not (exit 72, `unable to find utility "simctl"`). The outcome is `tool_missing` `xcrun simctl`, with no retry.
- **The `emulator` binary is missing.** The started process exits at once, and `programMissing()` turns the attempt into `tool_missing`, not a boot failure after the deadline.
- **A teardown command whose tool is missing,** such as `adb emu kill` with no `adb`. It stays a `warn` line, as today, and never changes the outcome.
- **An executor that throws.** It is a failed attempt with no missing tool, so it is retried. After three attempts it is `boot_failed` with the thrown message in the output.
- **A failing callback with a failing removal.** The callback's error still comes out unchanged.
- **A declared dev server on a mobile repository.** The devices fail inside the server. The phase parks only after `withHealthyDevServer` has stopped it, so `process.exit` leaves no server running.
- **A combined output longer than 2,000 characters.** The park comment cuts and marks it, and the full output is in the execution log, which the phase writes before the park.
- **Directive-looking text in the output** (`## Retry`). It is indented in the comment, so ADW never reads it as a directive.
- **`## Continue` on the park** waives nothing: `decideContinueAction` answers `not_a_baseline_park`.
- **`## Retry` on the park.**
  - `human_gated` is re-armed to `phase_timeout`. The resumed run clears `parkReason`, skips completed phases, re-runs the unnamed unit-test phase, and runs the scenario phase with new devices.
  - A host that is still broken parks again.
- **The scenario fix loop or the review retries hit a failed boot mid-run.** The phase parks from inside the loop, and `## Retry` resumes at the scenario phase with fresh loop counters.
- **`cli` and `web`.** No device request, no park, `env` unchanged.

## Acceptance Criteria
- With the recording device host, a device whose boot fails twice and succeeds on the third attempt is `ready`. `withDevices` returns `{ kind: 'ready', result }` with the callback's result, and the two failed attempts' devices have been removed.
- A device whose boot fails three times gives `{ kind: 'boot_failed', platform, attempts: 3, output }`. `output` holds every attempt's message and output, and the outcome is returned only after everything created, on both platforms, has been removed. The callback never runs.
- A missing `avdmanager`, `emulator`, `adb` or `xcrun simctl` gives `{ kind: 'tool_missing', platform, tool, output }`, naming the tool, after one attempt with no retry. Whatever was created, including the other device, is removed.
- Each Android attempt probes for its own console port, so a port taken since the last attempt is skipped.
- A callback that throws still makes `withDevices` reject with the same error after teardown. A teardown command that fails is still only a `warn`.
- `ParkReason.DeviceBootFailed` is `'device_boot_failed'`. Its comment:
  - names the platform;
  - states the attempts, or names the missing tool;
  - quotes the output indented and cut at `MAX_PARK_OUTPUT_CHARS`;
  - says `## Retry` re-runs the scenario phase, which creates and boots the devices again;
  - says `## Continue` waives nothing.

  It passes every existing per-reason structure test.
- `executeScenarioTestPhase`, on either failed outcome:
  - runs no scenario;
  - writes the summary and the output to the execution log;
  - parks through `parkWorkflow` (injectable as `park`) with `{ reason: 'device_boot_failed', failure }`, after the devices and any declared dev server have been removed.

  The real park writes `workflowStage: 'human_gated'` and `parkReason: 'device_boot_failed'`.
- `## Retry` on that park re-arms `phase_timeout`, and the resumed run reaches the scenario phase again, which creates and boots new devices. `## Continue` records no waiver.
- `cli` and `web` workflows are unchanged.
- No unit test or BDD scenario runs a real `avdmanager`, `emulator`, `adb` or `xcrun`, or calls the real `parkWorkflow` from a cucumber process.
- The `@adw-1048` scenarios pass, and the `@adw-1043`, `@adw-1045`, `@adw-1046`, `@adw-1047`, `@adw-989` and `@regression` scenarios still pass.
- Every new or changed source and test file is under 300 lines. Unit tests, lint, both type checks and the build pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/deviceLifecycle.retries.test.ts adws/core/__tests__/deviceLifecycle.test.ts adws/core/__tests__/deviceLifecycle.failures.test.ts adws/core/__tests__/deviceExecutor.test.ts` — the lifecycle, its attempts and outcome, and the executor.
- `bunx vitest run adws/forge/__tests__/parkComment.structure.test.ts adws/forge/__tests__/parkComment.content.test.ts adws/forge/__tests__/parkComment.quoting.test.ts adws/phases/__tests__/workflowPark.test.ts adws/triggers/__tests__/continueHandler.test.ts adws/triggers/__tests__/retryHandler.test.ts` — the park reason, the park path and the two directives.
- `bunx vitest run adws/phases/__tests__/scenarioTestPhase.deviceBoot.test.ts adws/phases/__tests__/scenarioTestPhase.devices.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/scenarioTestPhase.deviceSource.test.ts adws/phases/__tests__/scenarioTestPhase.runner.test.ts adws/phases/__tests__/scenarioTestPhase.server.test.ts` — the phase with and without devices.
- `bunx vitest run adws/core/__tests__/applicationType.test.ts adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts adws/phases/__tests__/reviewRetryLoop.test.ts adws/phases/__tests__/reviewRetryLoop.counter.test.ts adws/phases/__tests__/reviewRetryLoop.blocker.test.ts` — the naming guard and the phase's callers.
- `bun run lint` — the linter.
- `bunx tsc --noEmit` — the type check of every `**/*.ts`, including tests and `features/`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional type check.
- `bun run build` — the build.
- `bun run test:unit` — the full unit suite, with zero regressions.
- `wc -l adws/core/deviceLifecycle.ts adws/core/deviceBringUp.ts adws/core/deviceCommands.ts adws/core/deviceExecutor.ts adws/forge/parkComment.ts adws/phases/scenarioTestPhase.ts adws/core/__tests__/deviceLifecycle.retries.test.ts adws/core/__tests__/deviceLifecycle.test.ts adws/core/__tests__/deviceLifecycle.failures.test.ts adws/core/__tests__/fixtures/recordingDeviceHost.ts adws/phases/__tests__/scenarioTestPhase.helpers.ts adws/phases/__tests__/scenarioTestPhase.deviceBoot.test.ts adws/forge/__tests__/parkComment.content.test.ts features/regression/support/standInDevices.ts` — each under 300 lines.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1048"` — this issue's scenarios, none of them undefined.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047"` — the device lifecycle scenarios, with the outcome unwrapped.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1043 or @adw-1045 or @adw-1046"` — the `mobile:kotlincm` scenarios that run the real phase on the stand-in device host.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-989"` — the park comment scenarios of the existing reasons.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite, with zero regressions.

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - files under 300 lines, which is why the bring-up moves to `deviceBringUp.ts` and the new tests get their own files;
  - closed unions with string-literal `kind`s, as `BringUp`, `HealthyDevServerOutcome` and `ApplicationTypeResolution` have, and an enum for `HostTool`;
  - guard clauses, and a nesting depth of at most 2, with the per-attempt failure handling extracted;
  - `readonly` types, no `any`, no `!`;
  - comments only for invariants and non-obvious reasons: why the teardown precedes the next attempt, why the port is probed per attempt, why a missing tool is not retried, why `parkComment.ts` imports types only;
  - no issue numbers in code.
- **No new library.** If one is ever needed, `.adw/commands.md` names `bun add <package>`.
- **Why the issue's file names differ.** The issue lists `adws/forge/__tests__/parkComment.test.ts` and `adws/phases/__tests__/scenarioTestPhase.test.ts`. The park-comment tests are already split into `.helpers`, `.structure`, `.content` and `.quoting`, and the phase's device tests live in `.devices`. The new cases follow those splits, and `scenarioTestPhase.test.ts` stays unchanged. `deviceLifecycle.failures.test.ts` and `deviceExecutor.test.ts` change too, because the outcome type and the executor answer change.
- **Why a fresh console port per attempt.** #1047's plan left a race: two boots choosing the same just-free port within seconds. The losing emulator refuses to start, and "#1048's retry absorbs it". A retry on the same port would lose the race again. Probing per attempt is what lets the retry recover. The single up-front "Creating the devices of this workflow" line becomes per-device, per-attempt lines, because the port is now known only inside the Android attempt.
- **Why the executor reports a missing program, rather than ADW reading text.** `error.code === 'ENOENT'` is exact. The `emulator` is started, not run, and its spawn error never reached its output file, so `DeviceProcess` needs the flag anyway. `xcrun`'s `unable to find utility "simctl"` is the one missing tool that only text can show, because `xcrun` itself ran.
- **Why the park comment names the platform by its value** (`` `android` ``, `` `ios` ``). That is how the proof document names platforms. The device names ("The Android emulator…", "The iOS simulator…") appear in the quoted output anyway. It also keeps `parkComment.ts` free of a runtime import of `Platform`, which would close a runtime cycle (`applicationType.ts` imports `parkComment.ts` at runtime).
- **Why `## Retry` needs no new code.** `parkWorkflow` writes `human_gated`, `## Retry` re-arms it to `phase_timeout` with `resumeAttempts: 0`, and the takeover resumes the ADW ID in place. On resume:
  - `isPhaseAlreadyCompleted` skips the named completed phases (`baseline`, `stepDef`), and the recovery stage skips plan, scenarios, alignment and build;
  - the unnamed install and unit-test phases run again, as they do after `review_failed`;
  - `runScenarioTestFixLoop` calls `executeScenarioTestPhase` again, which creates and boots new devices.

  The directive text says "re-runs the scenario phase", as `pre_existing_regression`'s says "re-runs the scenario on the base branch".
- **Why the phase parks only after the dev server has stopped.** `parkWorkflow` calls `process.exit(0)`, which skips every pending `finally`. The device outcome is a value, not a throw, so it comes back out of `withHealthyDevServer` after the server has been stopped. The devices are already removed when `withDevices` returns. Mobile repositories declare no dev server (`N/A`), but the order must hold whenever one is declared.
- **Worst-case time.** Three attempts that each reach the boot deadline take about 15 minutes per device, plus teardown. The two devices boot concurrently. The heartbeat keeps ticking, because every wait is asynchronous.
- **Documentation.** Leave `app_docs/` and `.adw/conditional_docs.md` to `/document`. `app_docs/feature-ko14m9-device-lifecycle.md` still says "there are no boot retries and no park yet" and lists `DeviceLifecycleError` as public, and its `Owns` list should gain `adws/core/deviceBringUp.ts`. The park-comment doc should gain `device_boot_failed`. The README is this build's to update (Task 13).
- **Out of scope:**
  - the baseline gate's regression re-run on devices, and its own park (#1049);
  - the device janitor (#1050);
  - a host-wide cap on concurrent boots, deferred by the PRD, with the lifecycle as its future home;
  - a delay between attempts. The dev-server lifecycle has none, and a failed boot attempt already takes its time.
- **Release.** Nothing here is live on the pipeline host until a release to `main` and a host restart (ADR-0064).
