# Device Lifecycle

## Overview

The device lifecycle gives a workflow its own Android emulator and iOS simulator for as long as a piece of work needs them, and removes both whatever happened. `withDevices(request, work, deps?)` creates one AVD and one simulator named `adw-<adwId>` from the resolved device source, boots and awaits both, calls `work` with their identities, and then shuts down and deletes both. The scenario phase wraps the scenario proof run in it when the application profile has platforms, so parallel workflows never share a device, an `adb` port or a simulator identity.

## Responsibilities

- `deviceLifecycle.ts` (`adws/core/`) — `withDevices<T>(request, work, deps?)`, mirroring `withHealthyDevServer`. `request` carries `adwId`, the resolved `DeviceSource`, `emulatorOutputPath` and a `record(message, level)` run-log sink. `work` receives `DeviceEnvironment`: `ADW_ANDROID_AVD` (`adw-<adwId>`), `ADW_ANDROID_SERIAL` (`emulator-<console port>`) and `ADW_IOS_UDID`
- `deviceLifecycle.ts` — brings the Android and iOS devices up concurrently so each boot time is measured on its own. Android: `avdmanager create avd` (input `no\n`), `adb start-server`, `emulator -avd … -port <p> -no-window -no-audio -no-boot-anim -no-snapshot` started detached with output in the emulator log, then polling `adb get-state` (`device`) and `getprop sys.boot_completed` (`1`) on the injected clock. iOS: `xcrun simctl create`, `boot`, `bootstatus`
- `deviceLifecycle.ts` — teardown in a `finally`, after both bring-ups have settled: per device shut down then delete (`adb emu kill`, wait for the emulator process to exit, `kill()` if it ignores that, then `avdmanager delete avd`; `simctl shutdown` then `delete`). The two devices are torn down concurrently
- `deviceLifecycle.ts` — allocates the emulator console port: the first candidate whose port and port + 1 are both free on `127.0.0.1`
- `deviceLifecycle.ts` — records the run log: both devices on creation (names, device-source values, console port), `booted in <s>s` per device, and `Removed …` per device (or a `warn` line naming the command, exit code and last output line)
- `deviceCommands.ts` (`adws/core/`) — pure: device names, port candidates, every device command as a `DeviceCommand`/argv, and the readers `lastLine` and `lastUdid`. Exports `deviceNameFor(adwId)` and `emulatorConsolePortCandidates(adwId)` for the later janitor
- `deviceExecutor.ts` (`adws/core/`) — the `DeviceExecutor` port: `run(command)` runs a command to completion, `start(argv, outputPath)` starts a detached long-running process with output written to a file. `systemDeviceExecutor` is the `child_process` implementation; no shell, no blocking call
- `scenarioTestPhase.ts` (`adws/phases/`) — `requireDeviceSource` returns the resolved `DeviceSource` (or `null` for a profile without platforms); the proof run goes through `ScenarioTestPhaseDeps.withDevices` (inside the declared dev server when there is one) and the three variables are spread into the run command's `env` beside `ADW_APPLICATION_URL`. `runScenarioProof` still adds `ADW_PROOF_DIR` and `ADW_JUNIT_REPORT_PATH`. The request's `record` writes to the orchestrator log and the emulator log is `<logsDir>/android-emulator.log`
- Test support: `adws/core/__tests__/fixtures/recordingDeviceHost.ts` (recording executor, fake clock, port probe; no vitest import) for unit tests; `features/regression/support/standInDevices.ts` (the real lifecycle over an executor that answers like a healthy host; no hooks, no steps) and `features/per-issue/step_definitions/feature-1047-host.steps.ts` keep BDD scenarios that run the real phase on a `mobile:kotlincm` worktree hermetic

## Contracts & Invariants

- Teardown runs on every outcome: a callback that throws (its error propagates unchanged), a device that does not come up, a failed sibling bring-up. Nothing created is left behind
- Teardown never throws: a failed teardown command is recorded as a `warn` and the callback's result or error passes through
- Both bring-ups never reject and always settle before either failure is read, so a half-created device is always torn down; per device the shut down comes before the delete, and an AVD is deleted only after its emulator process has exited
- A device that cannot be created, booted or made ready fails the run with `DeviceLifecycleError` (`platform`, `message`, `output`), thrown after everything created has been removed. The workflow fails through `handleWorkflowError`; there are no boot retries and no park yet
- The console port is one of 64 even ports 5554–5680, chosen from the ADW ID's SHA-256 hash order; ports in use (the console port or the adb port above it) are skipped, wrapping around. With none free the run throws a `DeviceLifecycleError` for `android` before creating anything
- The executor never rejects (`exitCode: null` for a command that could not start or hit its timeout) and `start` never throws; commands are argv arrays, so no ADW ID or device-source value can inject anything
- Only a profile with platforms (`mobile:kotlincm`) asks for devices; for `cli` and `web` no device command is issued and the run `env` stays exactly `{ ADW_APPLICATION_URL }`. No scenarios or a `N/A` run-by-tag command means no devices
- The module never uses the identifier `applicationType` (the mapping-reader guard); it receives only the resolved `DeviceSource` and the platforms come from the profile

## Configuration

- Device-source values come from `.adw/project.md` (`## Android System Image`, `## Android Device Profile`, `## iOS Device Type`, `## iOS Runtime`), resolved by `resolveDeviceSource`
- Constants in `deviceCommands.ts`/`deviceLifecycle.ts`: `DEVICE_COMMAND_TIMEOUT_MS` (120 s), `DEVICE_BOOT_TIMEOUT_MS` (300 s), `POLL_COMMAND_TIMEOUT_MS` (10 s), `BOOT_POLL_INTERVAL_MS` (2 s), `EMULATOR_EXIT_TIMEOUT_MS` (30 s)
- `deps` (`executor`, `clock` as the `WaitClock` of `rateLimitWaitPolicy.ts`, `isPortAvailable`) are partial and default to the real implementations

## Gotchas

- `adb start-server` runs before the emulator: a running server is told about an emulator when it starts, while a server started later scans only ports 5555–5585
- An empty `getprop sys.boot_completed` answer is a booting emulator, not an error; only the last output line is compared, because a daemon start-up message may precede it
- The `simctl create` UDID is read with a UUID pattern from the last match, since a warning may precede it
- The hash alone does not prevent a collision (64 ports, up to five workflows per repository): the port probe is what guarantees uniqueness, and it probes `127.0.0.1` because on macOS a wildcard bind can succeed beside the emulator
- Every call is asynchronous: a boot takes minutes and the orchestrator heartbeat must keep ticking
- Existing BDD scenarios that run the real phase on a `mobile:kotlincm` worktree must install the stand-in device host (the step "the host's device tools are stand-ins…"), or they would run the real SDK tools

## Decisions

- [ADR-0064](../specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md) — A `mobile:kotlincm` application type: the repository's cucumber-jvm runner on devices ADW boots per workflow, images judged per platform
