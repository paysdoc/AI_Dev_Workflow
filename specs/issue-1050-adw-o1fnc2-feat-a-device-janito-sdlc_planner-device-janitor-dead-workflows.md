# Feature: A device janitor removes emulators and simulators left behind by dead workflows

## Metadata
issueNumber: `1050`
adwId: `o1fnc2-feat-a-device-janito`
issueJson: `{"number":1050,"title":"feat: a device janitor removes emulators and simulators left behind by dead workflows","body":"## Parent PRD\n\n`specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record: `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`)\n\n## What to build\n\nA sweep beside the dev-server janitor lists AVDs and simulators whose names carry an ADW ID and removes those whose ADW ID has no live orchestrator process and whose worktree is outside the grace period, through the lifecycle's executor. Devices of live workflows and of young worktrees are left alone. Each action is logged with the ADW ID and device names. See PRD \"Device janitor\".\n\n## Acceptance criteria\n\n- [ ] A device named for a dead ADW ID older than the grace period is shut down and deleted\n- [ ] Devices of a live ADW ID, or inside the grace period, are untouched\n- [ ] Devices not named for an ADW ID are never touched\n- [ ] The cron trigger runs the sweep where it runs the dev-server janitor\n- [ ] Unit tests (PRD Testing Decisions 5), with the dev-server janitor tests as prior art\n\n## Blocked by\n#1048 <!-- adw:region-overlap -->\n#1047 <!-- adw:region-overlap -->\n\n- Blocked by #1048\n\n## Touched Files\n\n- adws/triggers/deviceJanitor.ts\n- adws/triggers/__tests__/deviceJanitor.test.ts\n- adws/triggers/trigger_cron.ts\n- adws/core/deviceLifecycle.ts\n\n## User stories addressed\n\n- User stories 20, 21, 48\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-18T15:00:15Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-10-18T15:05:33Z","body":"⏸️ **Deferred behind #1047 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #1047, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #1047 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/core/devicelifecycle.ts`\n\nThis issue will spawn automatically once #1047 merges and closes. To override, remove the `#1047 <!-- adw:region-overlap -->` line from this issue body."},{"author":"paysdoc-adw","createdAt":"2026-10-19T00:45:03Z","body":"⏸️ **Deferred behind #1048 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #1048, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #1048 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/core/devicelifecycle.ts`\n\nThis issue will spawn automatically once #1048 merges and closes. To override, remove the `#1048 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description
`withDevices` (`adws/core/deviceLifecycle.ts`) gives each `mobile:kotlincm` workflow one Android AVD and one iOS simulator, both named `adw-<adwId>`, around the scenario proof run. It removes both on every outcome, but only while its own process is alive to run the `finally` block.

An orchestrator can die inside `withDevices`:
- SIGKILLed by the hung-orchestrator detector;
- killed by `## Cancel`, which also deletes `agents/<adwId>`;
- crashed;
- stopped when the host process exits.

The emulator is started detached and `unref`'d, so it keeps running when that happens. The AVD stays in `~/.android/avd`, the simulator stays booted, and nothing ever removes them. Each orphan holds memory, CPU and disk. An orphaned emulator also keeps one of the 64 console ports. A re-run with the same ADW ID gets a second simulator of the same name, because `simctl create` does not replace one.

This feature adds the **device janitor** that PRD "Device janitor" and ADR-0064 describe ("a janitor sweep removes devices of dead workflows under the dev-server janitor's grace rules"). It is a sweep that runs in the cron tick right after the dev-server janitor, on the same cadence (`JANITOR_INTERVAL_CYCLES`). Each pass:
1. **Lists the devices named for an ADW ID** through the lifecycle's executor:
   - AVDs, from `avdmanager list avd -c`, each with the serial of its running emulator, found through `adb devices` and `adb -s <serial> emu avd name`;
   - simulators, from `xcrun simctl list --json devices`, each with its UDID and whether it is booted.

   A name counts only when it is the `adw-` prefix followed by an ADW-ID-shaped token. Anything else is never touched.
2. **Groups them by ADW ID** and decides for each ADW ID, just before acting on it. The devices are left alone when:
   - its orchestrator is alive (`isAgentProcessRunning`, the dev-server janitor's PID-reuse-safe check); or
   - its worktree is inside the dev-server janitor's grace period (`JANITOR_GRACE_PERIOD_MS`, 30 minutes).

   The worktree is the one the ADW ID's top-level state records (`repoIdentity` and `branchName`). When no worktree is recorded, or the recorded one is gone, it counts as outside the grace period, which follows the dev-server janitor's "a worktree that cannot be read is very old".
3. **Shuts down and deletes each device of a dead, old ADW ID**:
   - for an AVD with a running emulator: `adb -s <serial> emu kill`, then wait until the serial leaves `adb devices`, then `avdmanager delete avd --name <name>`;
   - for a booted simulator: `xcrun simctl shutdown <udid>`, then `xcrun simctl delete <udid>`;
   - a device that is not running is only deleted.
4. **Logs every action with the ADW ID and the device names**: one line naming the devices and the reason, then one line per device saying it was removed, or a warning naming the command that failed.

The pass never rejects, so the cron tick always continues past it. A host that lacks the Android SDK or Xcode is skipped silently for that platform. A listing that fails is a warning, and the other platform is still swept.

## User Story
As an ADW operator running mobile workflows on a shared pipeline host
I want devices left behind by a crashed or killed orchestrator to be found and removed by the periodic janitor. Devices of live workflows and of worktrees inside the grace period must be left alone, and every removal must be logged with the ADW ID and the device names.
So that the host does not fill up with orphaned emulators and simulators, a slow boot is never reaped from under a running phase, and I can see what was reaped and why.

## Problem Statement
The device lifecycle's teardown lives in the orchestrator process that created the devices, so devices outlive that process when it dies. Four things go wrong:
- **Nothing finds them.** No process knows of an `adw-<adwId>` AVD or simulator except the orchestrator that made it.
  - The dev-server janitor (`adws/triggers/devServerJanitor.ts`) only kills processes that hold files inside target-repo worktrees. An emulator holds files under `~/.android/avd`, not in a worktree.
  - `## Cancel` removes the worktree and `agents/<adwId>`, so the ADW ID is left with no state at all.
- **They accumulate.** Five parallel mobile workflows already mean five emulator pairs on one mac mini (PRD "Further Notes"). Every orphan adds to that load until someone notices and deletes it by hand.
- **They collide with re-runs.**
  - A leftover running emulator keeps its console port.
  - `simctl create` on a re-run with the same ADW ID creates a second simulator of the same name.
  - The #1047 plan states that a leftover simulator "stays until #1050's janitor".
- **A naive sweep would be dangerous.** Two kinds of device must never be reaped:
  - a device of a live workflow, whose boot can take minutes (user story 21);
  - a device the operator named themselves, such as `Pixel_8_API_35` or `iPhone 16 Pro` (acceptance criterion 3).

## Solution Statement
The device janitor has the same layers as the dev-server janitor: pure tool knowledge, effectful mechanics over an injected boundary, and a decision layer with injected dependencies. Every effect on a device goes through the lifecycle's `DeviceExecutor`.

1. **Pure tool knowledge, in `adws/core/deviceCommands.ts`.** It gains:
   - **The listing commands:**
     - `listAvds` (`avdmanager list avd -c`);
     - `listAttachedDevices` (`adb devices`, with the poll timeout);
     - `queryEmulatorAvdName(serial)` (`adb -s <serial> emu avd name`);
     - `listSimulators` (`xcrun simctl list --json devices`).
   - **`adwIdOfDeviceName(name)`**, the inverse of `deviceNameFor`. It returns the ADW ID only when the name is `DEVICE_NAME_PREFIX` followed by an ADW-ID-shaped token: lowercase letters and digits in at least two hyphen-joined groups, which is what `generateAdwId` makes. Otherwise it returns `null`.
   - **Readers for each answer:**
     - `avdNamesIn` reads the compact list, line by line;
     - `emulatorSerialsIn` reads the `emulator-<port>` serials of `adb devices` and ignores the header, daemon start-up lines and USB serials;
     - `avdNameIn` reads the console's name line before `OK`;
     - `simulatorsIn` reads the outermost JSON object, so a warning printed around it is tolerated, and returns `null` when the output cannot be read;
     - `isShutDown` reads a simulator's state.
2. **Listing and removal mechanics, in a new `adws/core/deviceInventory.ts`.** It holds `listAdwDevices(deps)` and `removeAdwDevice(device, deps)`, over `DeviceInventoryDeps = Pick<DeviceLifecycleDeps, 'executor' | 'clock'>`. Neither rejects.
   - **The inventory** is a closed `DeviceListing` per platform (`Readonly<Record<Platform, DeviceListing>>`):
     - `listed`, with the `AdwDevice`s;
     - `tool_missing`, read with the existing `missingToolOf`, which covers `xcrun` without `simctl`;
     - `failed`, with a message naming the command, its exit code and its last line.

     The two listings run concurrently. `adb` is only asked about running emulators when at least one AVD is named for an ADW ID, so a host without ADW AVDs never has its adb server started by the janitor.
   - **The removal** mirrors the lifecycle's teardown order: shut down, then delete. The janitor holds no handle on the emulator process, so the emulator's exit is awaited by polling `adb devices` on the injected clock, every `BOOT_POLL_INTERVAL_MS` up to `EMULATOR_EXIT_TIMEOUT_MS`.
     - An emulator that ignores `adb emu kill` leaves its AVD in place for the next pass, with a failure that says so. avdmanager does not delete an AVD whose emulator still runs, and the lifecycle has the same invariant.
     - A simulator is removed by the UDID that was listed, so a simulator created after the listing is never touched.
   - **The result** is a `DeviceRemoval { device, failures }`, where no failures means the device was removed.
3. **One public entry point, `adws/core/deviceLifecycle.ts`**, which is what "through the lifecycle's executor" means here. It binds its own defaults (`systemDeviceExecutor` and the timer clock, its private `DEFAULT_DEPS`) into the exported `listAdwDevices(deps?)` and `removeAdwDevice(device, deps?)`. It re-exports their types and `adwIdOfDeviceName`, as it already re-exports the constants of `deviceCommands.ts` and `deviceBringUp.ts`.

   `deviceInventory.ts` imports lifecycle types with `import type` only, as `deviceBringUp.ts` does, so there is no runtime import cycle.
4. **The decision layer, in a new `adws/triggers/deviceJanitor.ts`**, modelled on `devServerJanitor.ts`. It has injected `DeviceJanitorDeps`:
   - `devices`, the lifecycle deps, empty for the lifecycle's own;
   - `readTopLevelState`;
   - `isAgentProcessRunning`;
   - `getWorktreeAgeMs`;
   - `log`.

   It holds three pure functions:
   - **`shouldReapDevices(orchestratorAlive, worktreeAgeMs, gracePeriodMs)`** returns `!alive && age > grace`. At exactly the grace period the devices are kept, as `shouldCleanWorktree` keeps a worktree.
   - **`worktreePathOf(state, targetReposDir)`** returns `<targetReposDir>/<owner>/<repo>/.worktrees/<branchName>` from the state's `repoIdentity` and `branchName`, or `null` when either is missing. It uses `getTargetRepoWorkspacePath` from `@paysdoc/devplatform/git`.
   - **`groupByAdwId(devices)`** groups the devices by ADW ID.

   `runDeviceJanitorPass(deps?, targetReposDir?)` lists, logs a failed listing as a warning, groups, and then sweeps one ADW ID at a time. For each it decides, and when the devices are to be reaped it logs the reason with the ADW ID and device names, removes each device and logs each result.
   - Each ADW ID is contained in its own `try`/`catch`, and so is the whole pass, like `runJanitorPass`'s per-worktree containment.
   - The defaults are the dev-server janitor's own: `JANITOR_GRACE_PERIOD_MS`, `isAgentProcessRunning`, `AgentStateManager.readTopLevelState`, and `DEFAULT_DEPS.getWorktreeAgeMs` (`Infinity` for a worktree that is gone). That is the PRD's "same grace period and liveness checks".
5. **The cron wiring, in `adws/triggers/trigger_cron.ts`.** A new exported `runJanitorTick(cycleCount, passes?)` takes injectable passes, following the file's injectable-tick idiom (`runPerIssueScenarioSweepTick`, `runPauseQueueScanTick`). On a multiple of `JANITOR_INTERVAL_CYCLES` it runs `runJanitorPass()` and then `runDeviceJanitorPass()`. `checkAndTrigger` calls it where it called `runJanitorPass` before.

   The BDD subprocess harness already pins `JANITOR_INTERVAL_CYCLES` to `1000000`, so no real cron child in a scenario reaches either janitor.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview. Line 13 describes the device lifecycle (`adw-<adwId>` names, teardown "whatever the outcome", host tools). Line 34 describes the dev-server janitor among the resilience primitives. Read for context; the document phase updates it.
- `.adw/coding_guidelines.md` — must be followed strictly:
  - files under 300 lines;
  - guard clauses and nesting depth of 2 at most;
  - declarative style;
  - no `any`;
  - enums for named constant sets;
  - side effects at the edges;
  - comments only for invariants and non-obvious reasons, never citing issue numbers.
- `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` — the "Device janitor" implementation decision, user stories 20, 21 and 48, and Testing Decisions 5 ("Reaps devices of dead ADW IDs outside the grace period; leaves live workflows and young worktrees alone; logs each action. Prior art: the dev-server janitor tests").
- `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md` — the decision: "A janitor sweep removes devices of dead workflows under the dev-server janitor's grace rules". Its compliance names the device janitor unit tests.
- `app_docs/feature-ko14m9-device-lifecycle.md` — the lifecycle's contracts:
  - teardown order (shut down before delete);
  - an AVD is deleted only once its emulator has exited;
  - the executor never rejects;
  - argv without a shell;
  - no runtime import cycle;
  - files under 300 lines.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — conditional doc for the dev-server janitor (it owns `adws/triggers/devServerJanitor.ts`).
- `app_docs/feature-9gjajh-cron-triggers.md` — conditional doc for `trigger_cron.ts` (`runGuardedTick`, the injectable-tick idiom, the cron loop).
- `adws/core/deviceLifecycle.ts` — `withDevices`, `DeviceLifecycleDeps`, the private `DEFAULT_DEPS` (`systemDeviceExecutor`, timer clock, loopback port probe), and the re-export blocks. It gains the bound `listAdwDevices` and `removeAdwDevice` and the re-exports of their types.
- `adws/core/deviceCommands.ts` — pure device knowledge: `DEVICE_NAME_PREFIX`, `deviceNameFor`, `standard`/`within`, `pollEmulator`, `killEmulator`, `deleteAvd`, `shutDownSimulator`, `deleteSimulator`, `lastLine`, `HostTool`, `missingToolOf`. It gains the listing commands, `adwIdOfDeviceName` and the readers.
- `adws/core/deviceBringUp.ts` — the lifecycle's teardown (`tearDownAndroid` and `tearDownIos`, `shutDownEmulator`, `awaitExit`, the failure line format in `because`), and `BOOT_POLL_INTERVAL_MS` and `EMULATOR_EXIT_TIMEOUT_MS`, which the inventory reuses. Not modified.
- `adws/core/deviceExecutor.ts` — the `DeviceExecutor` port (`run` never rejects; `programMissing` on `ENOENT`). Not modified.
- `adws/core/applicationType.ts` — the `Platform` enum (`android`, `ios`), the discriminant of `AdwDevice` and the key of `DeviceInventory`.
- `adws/core/rateLimitWaitPolicy.ts` — the `WaitClock` (`now`, `sleep`) the exit wait runs on.
- `adws/triggers/devServerJanitor.ts` — prior art and the source of the shared rules:
  - `JANITOR_GRACE_PERIOD_MS`;
  - `shouldCleanWorktree` (the `<=` boundary);
  - the frozen `DEFAULT_DEPS` (whose `getWorktreeAgeMs` the device janitor reuses);
  - `runJanitorPass`'s per-item `try`/`catch`;
  - the `Janitor:` log prefix.
- `adws/triggers/__tests__/devServerJanitor.test.ts` — prior art for the tests:
  - YOUNG and OLD ages around the grace period;
  - the truth table of the decision;
  - the exact-boundary and +1 ms cases;
  - the `makeDeps` builder;
  - "continues after an error on one";
  - one real-filesystem test.
- `adws/triggers/trigger_cron.ts` — `checkAndTrigger` runs `runJanitorPass()` when `cycleCount % JANITOR_INTERVAL_CYCLES === 0`. The injectable tick functions are the idiom to follow.
- `adws/triggers/__tests__/trigger_cron.test.ts` — mocks `../devServerJanitor` (and every other side-effecting module) before importing `trigger_cron`. It must also mock `../deviceJanitor`, and it gains the `runJanitorTick` tests.
- `adws/core/stateHelpers.ts` — `isAgentProcessRunning(adwId)`: the orchestrator's `pid` and `pidStartedAt`, through `isProcessLive`.
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState(adwId)`.
- `adws/types/agentTypes.ts` — `AgentState.repoIdentity` (`owner`, `repo`) and `AgentState.branchName`.
- `adws/phases/workflowInit.ts` — writes `repoIdentity` and `branchName` into the top-level state at init. The worktree is `gitCtx.ensureWorktree(branchName)`, which for a target repo is `<TARGET_REPOS_DIR>/<owner>/<repo>/.worktrees/<branch>` (devplatform's `GitContext.worktreePathFor`).
- `adws/triggers/cancelHandler.ts` — `## Cancel` deletes `agents/<adwId>`. This is why an ADW ID with no state must still be swept.
- `adws/core/config.ts` — `JANITOR_INTERVAL_CYCLES` (default 15 cycles of 20 s, so 5 minutes).
- `adws/core/__tests__/fixtures/recordingDeviceHost.ts` — the style of a device-host fixture: no vitest import, records `argv.join(' ')`, scripted failures and missing tools. It is 277 lines, so it is not extended; the janitor gets its own fixture.
- `adws/core/__tests__/deviceCommands.test.ts` and `adws/core/__tests__/deviceLifecycle.test.ts` — the test style for pure commands and for command sequences (`firstOutOfOrder`).
- `features/regression/support/subprocessDrivers.ts` — `CADENCE_PINS` pins `JANITOR_INTERVAL_CYCLES` for real cron children, so no change is needed.
- `features/regression/support/standInDevices.ts` — the BDD stand-in device host. It backs two scenario phrases:
  - "a recording executor that answers …", through `standInDeviceExecutor` and `feature-1047-world.ts`'s `requireExecutor`;
  - "the host's device tools are stand-ins …", through `standInDeviceHost`.

  It answers only the lifecycle's commands today. Step 13 extends it for the `@adw-1050` scenarios.
- `features/per-issue/feature-1050.feature` — this issue's thirteen scenarios:
  - ten run the device janitor over "a recording executor that answers as a host with these devices";
  - two run one cron poll over "the host's device tools are stand-ins that record each run and answer as a host with these devices", one poll on a janitor cycle and one off it;
  - one is the type check.
- `features/per-issue/feature-1047.feature` — four of its device lifecycle scenarios also carry `@adw-1050`. They guard that `withDevices`, the `adw-<adwId>` names and the stand-in's answers to the lifecycle's commands do not change.
- `features/per-issue/step_definitions/feature-1047-commands.ts` — reads recorded device commands as lifecycle steps (`stepsTaken`, `classify`). `classify` asserts that every command is one of the lifecycle's, and it reads any `avdmanager` command other than `create` as `delete`. A janitor's listing commands must therefore be set aside before it reads them.
- `features/regression/step_definitions/feature-959-cron.steps.ts` — prior art for importing `trigger_cron.ts` in-process (`await import(…)`) and calling an exported tick function.

### New Files
- `adws/core/deviceInventory.ts` — lists the devices on the host that are named for an ADW ID, and removes one, over an injected executor and clock. Pure decisions stay in `deviceCommands.ts`; no defaults (the lifecycle binds them).
- `adws/triggers/deviceJanitor.ts` — the sweep: `DeviceJanitorDeps`, `shouldReapDevices`, `worktreePathOf`, `groupByAdwId`, `describeDevice`, `runDeviceJanitorPass`, and a frozen `DEFAULT_DEPS`.
- `adws/core/__tests__/fixtures/leftoverDevicesHost.ts` — a host holding leftover devices, for the inventory and janitor tests:
  - a recording executor that answers the listing commands from a scripted holding and applies kills, shutdowns and deletions to it;
  - scripted missing tools, failures and an emulator that ignores `emu kill`;
  - a stepping clock.
  - No vitest import.
- `adws/core/__tests__/deviceInventory.test.ts` — listing and removal through `deviceLifecycle.ts`'s bound entry points over the leftover host.
- `adws/triggers/__tests__/fixtures/deviceJanitorDeps.ts` — builds `DeviceJanitorDeps` from a leftover host, a map of ADW ID to state, the set of live ADW IDs and worktree ages, and records the log lines.
- `adws/triggers/__tests__/deviceJanitor.test.ts` — the decisions and the pass for acceptance criteria 1 to 3 and the logging, with the dev-server janitor tests as prior art.
- `adws/triggers/__tests__/deviceJanitor.failures.test.ts` — missing tools, failed listings, failed removals, an emulator that ignores the kill, and containment. Splitting it out keeps each test file under 300 lines.

## Implementation Plan
### Phase 1: Foundation
Teach `deviceCommands.ts` what ADW asks the tools when it looks for devices, and how to read the answers. This is pure and fully unit-tested:
- the four listing commands;
- the inverse of `deviceNameFor` with the ADW-ID shape;
- the four readers and `isShutDown`.

Build the `leftoverDevicesHost` fixture that answers those commands like a real host holding a known set of AVDs, running emulators and simulators.

### Phase 2: Core Implementation
1. Write `deviceInventory.ts`:
   - the closed per-platform listing;
   - the ADW-only device model;
   - the removal that shuts down before it deletes, with the bounded exit wait.
2. Bind it in `deviceLifecycle.ts` to the lifecycle's own executor and clock.
3. Write `deviceJanitor.ts`:
   - the pure decision and worktree path;
   - grouping by ADW ID;
   - the per-ADW-ID sweep with logging and containment;
   - defaults taken from the dev-server janitor.
4. Test all of it through the public interfaces, asserting what an operator can observe: the commands the host received, in order, what the host still holds afterwards, and the log lines.

### Phase 3: Integration
Add `runJanitorTick` to `trigger_cron.ts` so that the device janitor runs in the dev-server janitor's cadence block, right after it. Mock `../deviceJanitor` in `trigger_cron.test.ts` and test the gate. Extend the BDD stand-in device host so that it holds leftover devices, and write the step definitions of the `@adw-1050` scenarios. Then run the full validation:
- lint;
- both type checks;
- the build;
- the unit suite;
- the line counts;
- this issue's BDD scenarios, the device lifecycle scenarios and the regression suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add the listing commands, the ADW-ID reader and the answer readers to `adws/core/deviceCommands.ts`
- Add the commands next to the existing ones, using the existing `standard`, `within` and `pollEmulator` helpers:
  - `export const listAvds: DeviceCommand = standard('avdmanager', 'list', 'avd', '-c');`
  - `export const listAttachedDevices: DeviceCommand = within(POLL_COMMAND_TIMEOUT_MS, ['adb', 'devices']);` It uses the poll timeout because the exit wait polls it.
  - `export const queryEmulatorAvdName = (serial: string): DeviceCommand => pollEmulator(serial, 'emu', 'avd', 'name');`
  - `export const listSimulators: DeviceCommand = standard('xcrun', 'simctl', 'list', '--json', 'devices');`
- Add `export function adwIdOfDeviceName(name: string): string | null`.
  - It returns `name.slice(DEVICE_NAME_PREFIX.length)` only when `name` starts with `DEVICE_NAME_PREFIX` and the rest matches a module-private `ADW_ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/`. Otherwise it returns `null`.
  - Give the pattern a one-line comment saying it is the shape `generateAdwId` makes, and that a device whose name is the prefix followed by anything else is not ADW's.
- Add the readers. Each is pure, takes the combined output, and treats lines as trimmed and non-empty, with a module-private `lines(output)` helper:
  - `avdNamesIn(output): readonly string[]` — every line. The caller keeps only the names `adwIdOfDeviceName` accepts, so an avdmanager warning line is dropped there.
  - `emulatorSerialsIn(output): readonly string[]` — the first column of each line matching `/^(emulator-\d+)\s/`. This skips `List of devices attached`, `* daemon …` lines and non-emulator serials. Use `flatMap`.
  - `avdNameIn(output): string | null` — the first line that is not `OK`. The console answers `avd name` with the name and then `OK`, with `\r\n` line ends.
  - `export interface ListedSimulator { readonly name: string; readonly udid: string; readonly state: string }` and `simulatorsIn(output): readonly ListedSimulator[] | null`.
    - It parses the slice from the first `{` to the last `}`; comment that `xcrun` may print a warning around the JSON.
    - It requires a `devices` object whose values are arrays.
    - It keeps the entries whose `name`, `udid` and `state` are strings, using a type guard over `unknown`. No `any`.
    - It flattens across runtimes.
    - It returns `null` when parsing fails or the shape is wrong.
  - `isShutDown = ({ state }: ListedSimulator): boolean => state === 'Shutdown'`.
- Keep the file under 300 lines (about 160 expected).

### 2. Unit-test the additions in `adws/core/__tests__/deviceCommands.test.ts`
- `adwIdOfDeviceName`:
  - `adwIdOfDeviceName(deviceNameFor(id)) === id` for `k7m2p9-login-screen`, `o1fnc2-feat-a-device-janito` and `abc123-1760000000000`;
  - `null` for `Pixel_8_API_35`, `iPhone 16 Pro`, `adw-`, `adw-test`, `adw-K7M2P9-login`, `adw-k7m2p9-login (2)`, `adw-k7m2p9-login-`, `adw--k7m2p9`, `xadw-k7m2p9-login` and `ADW-k7m2p9-login`.
- The four commands' argv and timeouts: `listAttachedDevices` and `queryEmulatorAvdName` use `POLL_COMMAND_TIMEOUT_MS`; the other two use `DEVICE_COMMAND_TIMEOUT_MS`.
- `avdNamesIn` on output with a leading `Warning: …` line and a trailing blank line.
- `emulatorSerialsIn`:
  - on output with the daemon start-up lines, a header, two emulators (`device` and `offline`) and a USB serial (`R5CT1234ABC\tdevice`), it gives exactly the two emulator serials;
  - on `''` it gives `[]`.
- `avdNameIn`:
  - `'adw-k7m2p9-login-screen\r\nOK\r\n'` gives the name;
  - `'OK\n'` and `''` give `null`.
- `simulatorsIn`:
  - a real-shaped `simctl` JSON with two runtimes, including an unavailable device with `isAvailable: false`, gives every device;
  - the same JSON preceded by an `xcrun: warning: …` line gives the same;
  - `'not json'`, `'{}'`, `{"devices": []}` and entries missing `udid` give `null`, `null`, `null` and the entry skipped respectively.
- `isShutDown`: `Shutdown` is true; `Booted` and `Booting` are false.

### 3. Create the leftover-devices host fixture `adws/core/__tests__/fixtures/leftoverDevicesHost.ts`
- Use the header and style of `recordingDeviceHost.ts`: a short doc comment, no vitest import, and plain data in and out.
- `export interface LeftoverDevicesScript`. Each field defaults to empty or false through a `HEALTHY` default spread, like `HEALTHY_HOST`:
  - `avds: readonly string[]` — the names `avdmanager` lists;
  - `emulators: Readonly<Record<string, string>>` — the serial of each running emulator, mapped to its AVD name;
  - `simulators: readonly ListedSimulator[]`;
  - `missingTools: readonly string[]` — programs not on the host;
  - `noSimctl: boolean` — `xcrun` answers exit 72 with `xcrun: error: unable to find utility "simctl", not a developer tool or in PATH`;
  - `failing: Readonly<Record<string, string>>` — the output of commands that exit 1, by leading words, as in `recordingDeviceHost`;
  - `emulatorIgnoresKill: boolean`.
- The executor's `run` records `argv.join(' ')` into `events` and answers from a mutable copy of the holding:
  - **`avdmanager list avd -c`** → the AVD names, one per line.
  - **`adb devices`** → `List of devices attached\n` followed by `<serial>\tdevice` for each running emulator.
  - **`adb -s <s> emu avd name`** → `<name>\r\nOK\r\n` for a running serial, otherwise exit 1 with `error: could not connect to TCP port …`.
  - **`adb -s <s> emu kill`** → removes the serial from the running emulators, unless `emulatorIgnoresKill`.
  - **`avdmanager delete avd --name <n>`** → removes the name, but exits 1 with `Error: An error occurred while deleting the AVD` while an emulator of that name still runs. This makes the fixture enforce the invariant the inventory relies on.
  - **`xcrun simctl list --json devices`** → `{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-2":[…]}}` with each simulator's `name`, `udid`, `state` and `isAvailable`.
  - **`xcrun simctl shutdown <u>`** → sets `Shutdown`.
  - **`xcrun simctl delete <u>`** → removes the simulator.
  - **A missing program** answers `{ exitCode: null, output: 'Error: spawn <p> ENOENT', programMissing: true }`.
  - `start` is never expected; it throws a plain `Error` if called.
- **The clock** is a stepping clock: `sleep(ms)` resolves at once and advances `now`. The fixture exposes `elapsedMs()`.
- **The returned object** is `{ deps: DeviceInventoryDeps, events, avds(), simulators(), runningEmulators(), elapsedMs() }`. The three getters return copies of what the host still holds.
- Export `TEST_SIMULATOR_RUNTIME` and two UDID constants for the tests.
- Keep the fixture under 300 lines.

### 4. Write `adws/core/deviceInventory.ts`
- **Header comment**, in two or three sentences:
  - It covers the devices on the host that are named for an ADW ID, and the removal of one of them, for a sweep of what workflows left behind.
  - Unlike the lifecycle's teardown it holds no process of the emulator, so it finds the emulator through adb and waits for it to leave.
  - Every effect goes through the injected executor, and nothing here rejects.
- **Imports:**
  - `Platform` from `./applicationType`;
  - `BOOT_POLL_INTERVAL_MS` and `EMULATOR_EXIT_TIMEOUT_MS` from `./deviceBringUp`;
  - `* as tools` from `./deviceCommands`;
  - `type { DeviceCommand, DeviceExecutor }` from `./deviceExecutor`;
  - `type { DeviceLifecycleDeps }` from `./deviceLifecycle`, type-only, as in `deviceBringUp.ts`, with no runtime cycle.
- **Types:**
  - `export type DeviceInventoryDeps = Pick<DeviceLifecycleDeps, 'executor' | 'clock'>;`
  - `export interface AdwAvd { readonly platform: Platform.Android; readonly adwId: string; readonly name: string; readonly serial: string | null }`. Doc `serial` only for what the name cannot say: the serial of its running emulator, `null` when none runs or adb cannot say.
  - `export interface AdwSimulator { readonly platform: Platform.Ios; readonly adwId: string; readonly name: string; readonly udid: string; readonly booted: boolean }`
  - `export type AdwDevice = AdwAvd | AdwSimulator;`
  - `export type DeviceListing = { readonly kind: 'listed'; readonly devices: readonly AdwDevice[] } | { readonly kind: 'tool_missing'; readonly tool: tools.HostTool } | { readonly kind: 'failed'; readonly message: string };` Comment that a missing tool is not a failure here, because a host without it holds no device of its kind.
  - `export type DeviceInventory = Readonly<Record<Platform, DeviceListing>>;`
  - `export interface DeviceRemoval { readonly device: AdwDevice; readonly failures: readonly string[] }`, where no failures means the device was removed.
- **Module-private helpers:**
  - `failureOf(executor, command): Promise<readonly string[]>` runs the command and returns `[]` when it exits 0. Otherwise it returns `['"<argv joined>" failed with exit code <n>: <lastLine>']`, or `with no exit code` when the code is `null`. This is the lifecycle's teardown wording without its summary.
  - `listingFailure(command, result): DeviceListing` returns `tool_missing` from `tools.missingToolOf` when that applies, otherwise `failed` with the same wording.
- **`listAndroid(executor)`:**
  - Runs `tools.listAvds` and returns `listingFailure` unless it exits 0.
  - Keeps the names `tools.adwIdOfDeviceName` accepts. With none, it returns `{ kind: 'listed', devices: [] }` without running adb.
  - Otherwise it calls `runningEmulators(executor)`, a `ReadonlyMap` of AVD name to serial, and maps each name to an `AdwAvd` with `serial: running.get(name) ?? null`.
- **`runningEmulators(executor)`:**
  - Runs `tools.listAttachedDevices`; a non-zero exit gives an empty map.
  - Otherwise, for each serial from `tools.emulatorSerialsIn`, concurrently with `Promise.all` over a named per-serial function, it runs `tools.queryEmulatorAvdName(serial)`.
  - It keeps `[avdNameIn(output), serial]` pairs where the command exited 0 and a name was read.
- **`listIos(executor)`:**
  - Runs `tools.listSimulators` and returns `listingFailure` unless it exits 0.
  - `tools.simulatorsIn(output)` returning `null` gives `failed` with `"xcrun simctl list --json devices" printed no device list that could be read`.
  - Otherwise it keeps the simulators whose name `adwIdOfDeviceName` accepts, as `AdwSimulator` with `booted: !tools.isShutDown(simulator)`.
- **`export async function listAdwDevices({ executor }: DeviceInventoryDeps): Promise<DeviceInventory>`** runs `Promise.all([listAndroid(executor), listIos(executor)])` and returns `{ [Platform.Android]: android, [Platform.Ios]: ios }`.
- **`awaitEmulatorGone(serial, { executor, clock }): Promise<boolean>`:**
  - Polls `tools.listAttachedDevices` until the serial is no longer in `emulatorSerialsIn`, sleeping `BOOT_POLL_INTERVAL_MS` between polls.
  - Its deadline is `clock.now() + EMULATOR_EXIT_TIMEOUT_MS`.
  - It returns whether the emulator left.
- **`removeAvd(avd, deps)`:**
  - When `serial !== null`, it runs `failureOf(killEmulator(serial))` and then `awaitEmulatorGone`.
  - If the emulator is still there, it returns the kill failures plus `The emulator <serial> was still running <30.0>s after "adb emu kill", so the AVD is left for the next pass`, and **does not** run the delete. Comment why: avdmanager does not delete an AVD whose emulator is running.
  - Otherwise it returns the kill failures plus `failureOf(deleteAvd(name))`.
- **`removeSimulator(simulator, executor)`** returns the `shutDownSimulator(udid)` failures when it is `booted`, followed by the `deleteSimulator(udid)` failures. It deletes after a failed shutdown too, as `tearDownIos` does.
- **`export async function removeAdwDevice(device: AdwDevice, deps: DeviceInventoryDeps): Promise<DeviceRemoval>`:**
  - Switches on `device.platform`.
  - Wraps the work in `try`/`catch`; an unexpected error becomes `failures: [String(error)]`, so it never rejects.
- Keep the file under 300 lines (about 150 expected), with nesting depth of 2 at most, and extract per-item callbacks longer than about 3 lines into named functions.

### 5. Bind the inventory to the lifecycle's executor in `adws/core/deviceLifecycle.ts`
- Extend the header comment with one sentence: it also lists the devices on the host named for an ADW ID and removes one, for the janitor, over the same executor.
- Add `import * as inventory from './deviceInventory';` plus the type imports, and `export type { AdwAvd, AdwDevice, AdwSimulator, DeviceInventory, DeviceInventoryDeps, DeviceListing, DeviceRemoval } from './deviceInventory';`.
- Add `adwIdOfDeviceName` to the existing `export { … } from './deviceCommands'` list.
- Add the two bound entry points after `DEFAULT_DEPS`:
  - `export function listAdwDevices(deps: Partial<DeviceInventoryDeps> = {}): Promise<DeviceInventory> { return inventory.listAdwDevices({ ...DEFAULT_DEPS, ...deps }); }`
  - `export function removeAdwDevice(device: AdwDevice, deps: Partial<DeviceInventoryDeps> = {}): Promise<DeviceRemoval> { return inventory.removeAdwDevice(device, { ...DEFAULT_DEPS, ...deps }); }`

  Write one doc line for the pair: listing and removal go through the lifecycle's own executor and clock unless told otherwise, and neither rejects.
- Leave `withDevices` and its behaviour unchanged. Keep the file under 300 lines (about 195 expected).
- Do not touch `adws/core/index.ts`. The janitor imports from `../core/deviceLifecycle`, as `scenarioTestPhase.ts` does.

### 6. Test the inventory in `adws/core/__tests__/deviceInventory.test.ts`
All calls go through `deviceLifecycle.ts`'s `listAdwDevices(host.deps)` and `removeAdwDevice(device, host.deps)`, over `leftoverDevicesHost`.
- **Listing both platforms:**
  - The holding has AVDs `adw-k7m2p9-login-screen` (running as `emulator-5556`), `adw-q4w8z1-settings-page` (not running) and `Pixel_8_API_35`. It has simulators `adw-k7m2p9-login-screen` (`Booted`), `adw-q4w8z1-settings-page` (`Shutdown`) and `iPhone 16 Pro`.
  - The result is `listed` on both platforms with exactly the four ADW devices, each with its ADW ID, serial or UDID and booted flag.
  - `Pixel_8_API_35` and `iPhone 16 Pro` are absent.
  - No command names them, apart from the listings themselves.
- **No ADW AVD:** when no AVD is named for an ADW ID, no `adb` command runs at all.
- **Missing tools:**
  - `avdmanager` missing gives `tool_missing` for `android` with `HostTool.AvdManager`;
  - `xcrun` missing, or `noSimctl`, gives `tool_missing` for `ios` with `HostTool.Simctl`;
  - in each case the other platform is still `listed`.
- **Failing listings:**
  - a failing `avdmanager list` gives `failed`, and the message names the command, the exit code and the last output line;
  - unreadable `simctl` output gives `failed`.
- **Running emulators that cannot be listed:** a failing `adb devices` lists the ADW AVDs with `serial: null`.
- **Removing an AVD whose emulator runs:**
  - The commands are in order (assert with a local `firstOutOfOrder`-style check, or import it from `recordingDeviceHost.ts`): `adb -s emulator-5556 emu kill`, then at least one `adb devices`, then `avdmanager delete avd --name adw-k7m2p9-login-screen`.
  - `failures` is `[]` and the host no longer holds the AVD or the emulator.
- **Removing an AVD that is not running:** only `avdmanager delete avd --name …` is issued.
- **An emulator that ignores the kill:**
  - no delete is issued;
  - there is one failure containing `still running` and `next pass`;
  - `elapsedMs()` is at least `EMULATOR_EXIT_TIMEOUT_MS` and less than `EMULATOR_EXIT_TIMEOUT_MS + BOOT_POLL_INTERVAL_MS + 1`;
  - the AVD is still held.
- **Removing a booted simulator:** `xcrun simctl shutdown <udid>` then `xcrun simctl delete <udid>`, and the host no longer holds it.
- **Removing a shut-down simulator:** delete only.
- **A failing delete:** `failing: { 'xcrun simctl delete': 'Unable to delete' }` gives a failure naming `"xcrun simctl delete <udid>" failed with exit code 1: Unable to delete`, and the promise resolves.
- **Never rejects:** an executor whose `run` throws synchronously gives a `DeviceRemoval` with one failure.

### 7. Write `adws/triggers/deviceJanitor.ts`
- **Header comment** in the style of `devServerJanitor.ts`, two or three sentences:
  - It removes the emulators and simulators that dead workflows left behind.
  - A device named for an ADW ID is removed when its orchestrator is not running and its worktree is outside the dev-server janitor's grace period.
  - A device of a live workflow, of a young worktree, or not named for an ADW ID is never touched.
- **Imports:**
  - `path`;
  - `getTargetRepoWorkspacePath` from `@paysdoc/devplatform/git`;
  - `log`, `TARGET_REPOS_DIR` and `type LogLevel` from `../core`;
  - `AgentStateManager` from `../core/agentState`;
  - `isAgentProcessRunning` from `../core/stateHelpers`;
  - `Platform` from `../core/applicationType`;
  - `listAdwDevices`, `removeAdwDevice` and the types from `../core/deviceLifecycle`;
  - `type AgentState`;
  - `DEFAULT_DEPS as DEV_SERVER_JANITOR_DEPS` and `JANITOR_GRACE_PERIOD_MS` from `./devServerJanitor`.
- **`export interface DeviceJanitorDeps`:**
  - `devices: Partial<DeviceInventoryDeps>`, documented as the lifecycle's executor and clock that listing and removal go through, empty for the lifecycle's own;
  - `readTopLevelState(adwId)`;
  - `isAgentProcessRunning(adwId)`;
  - `getWorktreeAgeMs(worktreePath)`;
  - `log(message, level?)`.
- **Pure exports:**
  - `shouldReapDevices(orchestratorAlive: boolean, worktreeAgeMs: number, gracePeriodMs: number): boolean` returns `!orchestratorAlive && worktreeAgeMs > gracePeriodMs`, with guard clauses. The `<=` boundary is conservative, as `shouldCleanWorktree`'s is.
  - `worktreePathOf(state: AgentState | null, targetReposDir: string): string | null` returns `null` unless `state?.repoIdentity` and `state.branchName` are both present. Otherwise it returns `path.join(getTargetRepoWorkspacePath(owner, repo, targetReposDir), '.worktrees', branchName)`. One comment line: this is `GitContext.worktreePathFor`'s layout, computed here because a GitContext would need the repository's credentials, which a sweep of local devices must not depend on.
  - `groupByAdwId(devices: readonly AdwDevice[]): ReadonlyMap<string, readonly AdwDevice[]>` is built declaratively with `reduce` into a new `Map` and keeps the listing order: Android first, then iOS, each in listed order.
  - `describeDevice(device: AdwDevice): string` gives:
    - `the Android AVD "<name>"`, plus ` (<serial>)` when an emulator runs;
    - `the iOS simulator "<name>" (<udid>)`.
- **Module-private functions:**
  - `devicesIn(listing, platform, log)` returns the listed devices. For `failed` it logs `Device janitor: could not list the <platform> devices: <message>` at `warn` and returns `[]`. For `tool_missing` it returns `[]` silently.
  - `reapReason(adwId, deps, targetReposDir): string | null`:
    - reads `orchestratorAlive = deps.isAgentProcessRunning(adwId)`;
    - reads `worktreePath = worktreePathOf(deps.readTopLevelState(adwId), targetReposDir)`;
    - computes `ageMs = worktreePath === null ? Infinity : deps.getWorktreeAgeMs(worktreePath)`;
    - returns `null` unless `shouldReapDevices(orchestratorAlive, ageMs, JANITOR_GRACE_PERIOD_MS)`;
    - otherwise returns `its orchestrator is not running and ` followed by one of:
      - `no worktree is recorded for it`;
      - `its worktree <path> is gone` (when `ageMs` is `Infinity`);
      - `its worktree <path> is <m> minutes old, past the <g>-minute grace period`.
  - `reportRemoval(adwId, removal, log)` logs either `Device janitor: removed <device> of ADW ID <adwId>` at `info`, or one `Device janitor: could not remove <device> of ADW ID <adwId>: <failure>` line per failure at `warn`.
  - `sweepAdwId(adwId, devices, deps, targetReposDir)`:
    - In a `try`, it computes the reason and returns when it is `null`. Nothing is logged for devices left alone.
    - Otherwise it logs `Device janitor: removing <devices joined with ", "> of ADW ID <adwId>: <reason>` at `info`, then removes each device sequentially with `removeAdwDevice(device, deps.devices)` and reports each result.
    - The `catch` logs `Device janitor: error sweeping the devices of ADW ID <adwId>: <err>` at `warn`.
- **`export async function runDeviceJanitorPass(deps: DeviceJanitorDeps = DEFAULT_DEPS, targetReposDir: string = TARGET_REPOS_DIR): Promise<void>`:**
  - In a `try`:
    - `const inventory = await listAdwDevices(deps.devices);`
    - `const devices = Object.values(Platform).flatMap(platform => devicesIn(inventory[platform], platform, deps.log));`
    - It returns when there are no devices.
    - It logs `Device janitor: scanning <n> device(s) named for <m> ADW ID(s)` at `info`.
    - It sweeps each group in turn with `for…of` and `await`, one ADW ID at a time, so each decision is made right before that ADW ID's removal.
  - The `catch` logs `Device janitor: pass failed: <err>` at `warn`.
  - The doc comment states that it never rejects.
- **Defaults:** `export const DEFAULT_DEPS: DeviceJanitorDeps = Object.freeze({ devices: {}, readTopLevelState: AgentStateManager.readTopLevelState, isAgentProcessRunning, getWorktreeAgeMs: DEV_SERVER_JANITOR_DEPS.getWorktreeAgeMs, log })`. Comment that these are the dev-server janitor's own liveness and age checks; it is frozen and exported for tests to spread, like the dev-server janitor's.
- Keep the file under 300 lines (about 140 expected) with nesting depth of 2 at most.

### 8. Create `adws/triggers/__tests__/fixtures/deviceJanitorDeps.ts`
- Export `janitorWorld(options)`. Its options are:
  - `script: Partial<LeftoverDevicesScript>`;
  - `states: Record<string, Partial<AgentState>>`;
  - `live: readonly string[]`;
  - `worktreeAges: Record<string, number>`, keyed by worktree path, defaulting to `Infinity` for an unknown path, which reads like a worktree that is gone.
- It returns `{ host, deps: DeviceJanitorDeps, lines: string[] }`:
  - `deps.devices` is `host.deps`;
  - `isAgentProcessRunning` is a `vi.fn`-free plain function, so the helper has no vitest import;
  - `lines` records each log call as `<level> <message>`.
- Export `stateFor(owner, repo, branchName)`, which returns `{ repoIdentity: { owner, repo }, branchName }`, and constants for the test root (`/repos`), `YOUNG = JANITOR_GRACE_PERIOD_MS / 2` and `OLD = JANITOR_GRACE_PERIOD_MS * 2`.

### 9. Test the janitor in `adws/triggers/__tests__/deviceJanitor.test.ts`
- **`shouldReapDevices` truth table**, mirroring the `shouldCleanWorktree` tests:
  - alive and OLD gives false; alive and YOUNG gives false; alive and `Infinity` gives false;
  - dead and YOUNG gives false; dead and OLD gives true; dead and `Infinity` gives true;
  - dead at exactly `JANITOR_GRACE_PERIOD_MS` gives false; one millisecond past gives true.
- **`worktreePathOf`:**
  - a full state gives `/repos/acme/app/.worktrees/feature-issue-7-login-screen`;
  - `null`, a missing `repoIdentity` or a missing `branchName` gives `null`.
- **`groupByAdwId` and `describeDevice`:** grouping keeps Android before iOS; the descriptions include the serial or UDID.
- **Acceptance criterion 1** (a dead ADW ID older than the grace period is shut down and deleted), through `runDeviceJanitorPass(deps, '/repos')`:
  - The state is recorded, the ADW ID is not live and the worktree is OLD.
  - The host received, in order per device, `adb -s emulator-5556 emu kill` then `avdmanager delete avd --name adw-k7m2p9-login-screen`, and `xcrun simctl shutdown <udid>` then `xcrun simctl delete <udid>`.
  - `host.avds()`, `host.simulators()` and `host.runningEmulators()` no longer hold them.
  - The `info` lines contain the ADW ID, both device names, the reason (`its orchestrator is not running`, with the worktree path and `grace period`), and one `removed …` line per device.
- **Acceptance criterion 1, variants:**
  - an ADW ID with no state, as after `## Cancel`, is reaped with the reason `no worktree is recorded for it`;
  - a recorded worktree that is gone (`Infinity`) is reaped with `is gone`;
  - two simulators with the same name, one booted and one shut down, are both deleted by UDID.
- **Acceptance criterion 2** (live or young devices are untouched):
  - **A live ADW ID with an OLD worktree:** the host receives no `emu kill`, `delete`, or `shutdown` command, and holds every device afterwards. There are no `removing` or `removed` lines.
  - **A dead ADW ID with a YOUNG worktree:** the same.
  - **At the boundary:** with the worktree aged exactly `JANITOR_GRACE_PERIOD_MS` the devices are untouched; aged one millisecond more, they are removed. This shows the grace period is the dev-server janitor's.
  - **A mixed host:** one live ADW ID and one dead, old ADW ID. Only the dead one's devices are removed, and the live one's emulator keeps running.
- **Acceptance criterion 3** (devices not named for an ADW ID are never touched):
  - The host holds `Pixel_8_API_35` (running as `emulator-5554`), `adw-test`, `iPhone 16 Pro` and `adw-K7M2P9-login`, and no state or liveness says anything about them.
  - No command other than the listings and `adb devices` / `emu avd name` names them.
  - `isAgentProcessRunning` is never asked about them; record its calls in the world.
  - The host still holds all of them.
- **Logging when nothing is named for an ADW ID:** no `scanning` line, and liveness is never consulted.
- **The real filesystem:**
  - Create a temp root holding `acme/app/.worktrees/feature-issue-7-login-screen`.
  - Use `{ ...DEFAULT_DEPS, devices: host.deps, readTopLevelState, isAgentProcessRunning: () => false, log }`, which keeps the real `getWorktreeAgeMs`.
  - A freshly created worktree protects the devices.
  - With no directory at the recorded path, the devices are removed.
  - Clean up the root in `finally`.
- Keep the file under 300 lines.

### 10. Test failures and containment in `adws/triggers/__tests__/deviceJanitor.failures.test.ts`
- **No tools:** `missingTools: ['avdmanager', 'xcrun']` gives no `warn` lines, no command beyond the two listings, and a resolved pass. `noSimctl` with ADW AVDs present still sweeps the AVDs.
- **A failing listing:**
  - `failing: { 'avdmanager list': 'Error: JAVA_HOME is not set' }` gives one `warn` line naming `android` and the error, while a dead, old ADW ID's simulator is still removed.
  - Unreadable `simctl` output gives a `warn` naming `ios`, while AVDs are still removed.
- **A failing removal:** `failing: { 'avdmanager delete': 'Error: An error occurred while deleting the AVD' }` gives:
  - a `warn` naming the ADW ID, the AVD and the command;
  - the simulator of the same ADW ID still removed;
  - the next ADW ID still swept.
- **An emulator that ignores the kill:** a `warn` naming the ADW ID, the AVD, `still running` and `next pass`; the AVD is still held; no `avdmanager delete` is issued.
- **Containment:**
  - `isAgentProcessRunning` throwing for one ADW ID gives a `warn` naming that ADW ID, and the other ADW ID is still swept;
  - `devices.executor.run` throwing for the listing gives `pass failed` at `warn`, and `runDeviceJanitorPass` resolves.
- Keep the file under 300 lines.

### 11. Run the device janitor beside the dev-server janitor in `adws/triggers/trigger_cron.ts`
- Import `runDeviceJanitorPass` from `./deviceJanitor`.
- Add an exported interface and a constant:
  - `export interface JanitorPasses { readonly devServers: () => Promise<void>; readonly devices: () => Promise<void> }`
  - `const JANITOR_PASSES: JanitorPasses = { devServers: () => runJanitorPass(), devices: () => runDeviceJanitorPass() };`
- Add `export async function runJanitorTick(cycleCount: number, passes: JanitorPasses = JANITOR_PASSES): Promise<void>`. It returns unless `cycleCount % JANITOR_INTERVAL_CYCLES === 0`, then awaits `passes.devServers()` and then `passes.devices()`. Give it a short doc comment in the file's tick-function style: both janitors run on the same cadence with the device janitor after the dev-server janitor, and it is exported with injectable passes so that tests can drive the gate.
- In `checkAndTrigger`, replace the `if (cycleCount % JANITOR_INTERVAL_CYCLES === 0) { await runJanitorPass(); }` block with `await runJanitorTick(cycleCount);`, in the same position.
- Change nothing else. The file is already over 300 lines (608), and splitting it is out of scope; this change adds about 15 lines.

### 12. Update `adws/triggers/__tests__/trigger_cron.test.ts`
- Beside the existing `vi.mock('../devServerJanitor', …)`, add `vi.mock('../deviceJanitor', () => ({ runDeviceJanitorPass: vi.fn(() => Promise.resolve()) }));`. Then no cron test can reach the real device tools.
- Import `runJanitorTick` and `JANITOR_INTERVAL_CYCLES` (from `../../core`, whose mock spreads the actual values).
- Add `describe('runJanitorTick', …)`:
  - on cycle `JANITOR_INTERVAL_CYCLES`, injected passes record `devServers` and then `devices`, in that order;
  - on cycle `JANITOR_INTERVAL_CYCLES + 1`, neither runs;
  - on cycle `JANITOR_INTERVAL_CYCLES * 2`, both run again;
  - with no passes injected on a janitor cycle, the mocked `runJanitorPass` and `runDeviceJanitorPass` are each called once.

### 13. Support the `@adw-1050` scenarios in BDD
The scenarios in `features/per-issue/feature-1050.feature` reuse the device steps' stand-ins. They need the stand-in to hold leftover devices, and steps that run the janitor, and the cron's janitor tick, over it.
- **Extend `features/regression/support/standInDevices.ts`** with a `devices` option on `StandInDeviceOptions`. It holds the scenario table's rows: an AVD or a simulator, its name, and whether it is booted. The executor then:
  - answers `avdmanager list avd -c`, `adb devices`, `adb -s <serial> emu avd name` and `xcrun simctl list --json devices` from that holding. Each booted AVD gets a running `emulator-<port>` serial and each simulator gets a UDID;
  - applies `adb -s <serial> emu kill`, `avdmanager delete avd --name <name>`, `xcrun simctl shutdown <udid>` and `xcrun simctl delete <udid>` to the holding, and exposes what the host still holds;
  - can fail one named command with what it prints, for "the recording executor fails the deletion of the AVD …, printing …";
  - keeps `missingPrograms`, for "… are not installed" and "no device tool is installed".

  More rules for the stand-in:
  - Its answers to the lifecycle's own commands stay as they are. The four `feature-1047.feature` scenarios that carry `@adw-1050` guard this.
  - `StandInDeviceHost` also exposes the executor and the stepping clock, so that the janitor can run over it.
  - Keep the file under 300 lines. If needed, move the holding into a support module of its own.
  - Keep the BDD host separate from `adws/core/__tests__/fixtures/leftoverDevicesHost.ts`, as `standInDevices.ts` is kept separate from `recordingDeviceHost.ts`.
- **Write the step definitions** in `features/per-issue/step_definitions/feature-1050-*.steps.ts`.
  - **"When the device janitor sweeps the host"** awaits `runDeviceJanitorPass` with these deps:
    - `devices`: the recording executor and a stepping clock;
    - `readTopLevelState`, `isAgentProcessRunning` and `getWorktreeAgeMs`: answers from the workflows the scenario described. A workflow is alive or dead, and its worktree is older than `JANITOR_GRACE_PERIOD_MS` or inside it, or it has no state and no worktree;
    - `log`: records each line with its level.

    The step also records whether the pass rejected, for "the device janitor's sweep completed without an error".
  - **"When the cron polls once, on a poll that runs its dev-server janitor"** and **"… on a poll that does not run its dev-server janitor"** import `trigger_cron.ts` in-process, as `feature-959-cron.steps.ts` does. They call `runJanitorTick` at cycle `JANITOR_INTERVAL_CYCLES` and at `JANITOR_INTERVAL_CYCLES + 1` respectively, with these passes:
    - the device pass is `runDeviceJanitorPass({ ...DEFAULT_DEPS, devices: <the stand-in's executor and clock> })`. No state exists for the scenario's ADW ID, so the janitor's own liveness and state checks find it dead;
    - the dev-server pass touches no real worktree or process, for example `runJanitorPass` over an empty temporary target-repos directory.

    Never use a real cron child for these scenarios. `CADENCE_PINS` keeps a real cron child from both janitors, and an unpinned one would run the host's real device tools.
  - **"the cron ran no device tool on that poll"** asserts that the stand-in recorded no command.
  - **"took these steps … in this order"** keeps only the kill, shutdown and delete commands of that ADW ID's devices, and then maps them to `shut down` and `delete`. It cannot reuse `classify` on the raw commands, because `classify` rejects the listing commands (see Relevant Files).
  - Any `@adw-1050` hook also runs for the four `feature-1047.feature` scenarios that carry the tag. So, like the existing device resets, each hook must be safe to run beside feature-1047's own.

### 14. Validate
- Run every command in `Validation Commands`, fix any failure, and re-run until all pass with zero regressions.

## Testing Strategy
### Unit Tests
- **`adws/core/__tests__/deviceCommands.test.ts`** (extended), the pure layer:
  - `adwIdOfDeviceName` round-trips with `deviceNameFor` for real ADW IDs and rejects every non-ADW name;
  - the four listing commands' argv and timeouts;
  - the four readers on realistic output, including warnings, daemon lines, USB serials, `\r\n`, JSON wrapped in a warning, and unreadable JSON;
  - `isShutDown`.
- **`adws/core/__tests__/deviceInventory.test.ts`** (new), through `deviceLifecycle.ts`'s bound `listAdwDevices` and `removeAdwDevice` over `leftoverDevicesHost`:
  - only ADW-named devices are listed, with serial, UDID and booted flag;
  - no adb call happens without an ADW AVD;
  - `tool_missing` and `failed` are reported per platform, and the other platform is still listed;
  - removal order (emulator kill, the exit awaited, then delete; simulator shutdown, then delete), checked by the commands and by what the host still holds;
  - the bounded wait for an emulator that ignores the kill, and the AVD left in place;
  - failures are reported, never thrown.
- **`adws/triggers/__tests__/deviceJanitor.test.ts`** (new; prior art `devServerJanitor.test.ts`):
  - the decision truth table and the grace boundary;
  - the worktree path from state;
  - grouping and descriptions;
  - acceptance criteria 1 to 3 through `runDeviceJanitorPass`, asserting the commands received, the host's remaining devices and the log lines naming the ADW ID, the device names and the reason;
  - one real-filesystem test of the worktree age.
- **`adws/triggers/__tests__/deviceJanitor.failures.test.ts`** (new):
  - hosts without tools stay silent;
  - a failed listing warns and the other platform is still swept;
  - a failed removal warns and the sweep continues;
  - an emulator that ignores the kill is reported;
  - errors are contained per ADW ID and per pass, and the pass never rejects.
- **`adws/triggers/__tests__/trigger_cron.test.ts`** (extended): `runJanitorTick` runs both passes, dev-server first, on janitor cycles only. The device janitor is mocked, so no cron test touches real devices.
- **Existing suites that must stay green:** the dev-server janitor tests and the device lifecycle tests (`deviceLifecycle.test.ts`, `.retries`, `.failures`, `deviceExecutor.test.ts`). `withDevices` is unchanged.

### BDD Scenarios
`features/per-issue/feature-1050.feature` (`@adw-1050`) runs over the stand-in device host of step 13:
- **Acceptance criterion 1:**
  - shut down, then delete;
  - the exact `adb`, `avdmanager` and `xcrun simctl` commands, by serial, name and UDID;
  - an ADW ID with no state and no worktree.
- **Acceptance criterion 2:** a live ADW ID with an old worktree, and a dead ADW ID with a young worktree, each beside a dead, old one that is removed.
- **Acceptance criterion 3:** booted and shut-down devices not named for an ADW ID, beside a dead, old one that is removed.
- **Logging:** one removal line per device, naming the device and the ADW ID.
- **Failures:** a failed AVD deletion is a warning holding what `avdmanager` printed, and the other ADW ID is still swept. A host without the Android tools, or without any device tool, completes its sweep.
- **Acceptance criterion 4:** one cron poll through `runJanitorTick`. A janitor cycle removes a state-less ADW ID's devices; any other cycle runs no device tool.
- **Lifecycle guard:** four device lifecycle scenarios of `feature-1047.feature` carry `@adw-1050`.

### Edge Cases
- **Hosts and tools:**
  - A host with no device named for an ADW ID, the common case: only the two listing commands run, adb is never started by the janitor, nothing is logged, and liveness is never read.
  - A host without the Android SDK, without Xcode (Linux or CI), or with the Command Line Tools only (`xcrun` exit 72): silent for that platform, and the other is still swept.
  - `avdmanager` failing (no Java, a broken SDK): one warning per pass naming `android` and the last output line, and iOS is still swept.
  - `simctl` output wrapped in a warning is read; output that cannot be read is a warning.
- **Android:**
  - `adb devices` failing or adb missing: ADW AVDs are listed with no serial. The delete of one whose emulator still runs fails and is logged, and the next pass retries.
  - An AVD whose emulator runs: killed, its exit awaited by polling `adb devices` for up to 30 s, then deleted.
  - An emulator that ignores the kill: the AVD is left for the next pass, with a warning that says so.
  - An AVD whose emulator does not run, for example after a host reboot: deleted only.
- **iOS:**
  - A booted or booting simulator: shut down, then deleted. A shut-down simulator: deleted only.
  - Two simulators of one ADW ID with the same name, after a crash and a re-run: both are deleted, by UDID.
- **State and worktree:**
  - An ADW ID with no state, as after `## Cancel` deletes `agents/<adwId>`: not live and no worktree recorded, so reaped.
  - A state without `repoIdentity` or `branchName`: no worktree, so reaped if the orchestrator is dead.
  - A recorded worktree that is gone, cleaned after completion: its age is `Infinity`, so reaped if the orchestrator is dead.
  - A worktree aged exactly the grace period: left alone. One millisecond older: reaped.
- **Liveness:**
  - A live orchestrator in any stage, terminal included: left alone. Unlike the dev-server janitor the stage is not read; see Notes.
  - Mixed live and dead ADW IDs on one host: only the dead, old ones are touched.
- **Names:** `Pixel_8_API_35`, `iPhone 16 Pro`, `adw-`, `adw-test`, `adw-K7M2P9-login`, `adw-k7m2p9-login (2)`, `xadw-…` and `ADW-…` are never touched, and their liveness is never asked.
- **Failures and containment:**
  - A removal command that fails: a warning naming the ADW ID, the device, the command, the exit code and the last line. The other devices and ADW IDs are still swept, and the next pass retries.
  - A dependency that throws for one ADW ID: contained and logged, and the others are still swept. The pass never rejects, so the cron tick continues.
- **Concurrency:**
  - Several crons on one host, one per target repo, sweeping the same orphan at about the same time: the second's commands fail harmlessly and are logged as warnings.
  - A resumed orchestrator of the same ADW ID writing its PID just after the janitor read liveness: the decision is made per ADW ID right before its removal, and simulators are removed by the UDIDs listed, so one created after the listing is never touched. The residual window is that one ADW ID's AVD removal.

## Acceptance Criteria
- A device named for a dead ADW ID whose worktree is older than the grace period is shut down and deleted:
  - **Android:** `adb -s <serial> emu kill`, the exit awaited, then `avdmanager delete avd --name adw-<adwId>`.
  - **iOS:** `xcrun simctl shutdown <udid>`, then `xcrun simctl delete <udid>`.
  - A device that is not running is only deleted.

  Proven by `deviceJanitor.test.ts` asserting the commands the host received and what it still holds.
- Devices of a live ADW ID, or of a worktree inside `JANITOR_GRACE_PERIOD_MS` (exactly at the boundary included), receive no shutdown, kill or delete command and are still held afterwards.
- A device whose name is not `adw-` followed by an ADW-ID-shaped token is never shut down, killed or deleted, and its liveness is never asked.
- Each removal is logged at `info`, naming the ADW ID, every device name (with serial or UDID) and the reason, followed by one `removed …` line per device. A failed removal is logged at `warn` with the ADW ID, the device and the failing command.
- Listing and deletion go through the lifecycle's executor: `deviceLifecycle.ts`'s `listAdwDevices` and `removeAdwDevice`, defaulting to `systemDeviceExecutor` and the timer clock.
- `checkAndTrigger` runs `runDeviceJanitorPass` right after `runJanitorPass`, in the same `JANITOR_INTERVAL_CYCLES` gate (through `runJanitorTick`). `trigger_cron.test.ts` proves the gate and the order. The two cron-poll scenarios of `feature-1050.feature` prove it over the stand-in host: a janitor poll removes a dead ADW ID's devices, and any other poll runs no device tool.
- `runDeviceJanitorPass` never rejects:
  - hosts without the device tools produce no warnings;
  - a failed listing or removal is a warning, and the sweep continues.
- `withDevices` and its tests are unchanged and green.
- Unit tests exist for the decision, the inventory and the cron gate, with the dev-server janitor tests as prior art (PRD Testing Decisions 5).
- Lint, both type checks, the build and the full unit suite pass. Every new or modified device and janitor file (source, fixture and test) stays under 300 lines; `trigger_cron.ts` is already over the limit.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/deviceCommands.test.ts adws/core/__tests__/deviceInventory.test.ts adws/triggers/__tests__/deviceJanitor.test.ts adws/triggers/__tests__/deviceJanitor.failures.test.ts` — the new commands, readers, inventory and janitor.
- `bunx vitest run adws/triggers/__tests__/trigger_cron.test.ts adws/triggers/__tests__/devServerJanitor.test.ts` — the cron gate and the dev-server janitor, unchanged.
- `bunx vitest run adws/core/__tests__/deviceLifecycle.test.ts adws/core/__tests__/deviceLifecycle.retries.test.ts adws/core/__tests__/deviceLifecycle.failures.test.ts adws/core/__tests__/deviceExecutor.test.ts` — the lifecycle, unchanged.
- `bun run lint` — the linter.
- `bunx tsc --noEmit` — the type check of every `**/*.ts`, including tests and `features/`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional type check.
- `bun run build` — the build.
- `bun run test:unit` — the full unit suite, with zero regressions.
- `wc -l adws/core/deviceCommands.ts adws/core/deviceInventory.ts adws/core/deviceLifecycle.ts adws/triggers/deviceJanitor.ts adws/core/__tests__/fixtures/leftoverDevicesHost.ts adws/core/__tests__/deviceCommands.test.ts adws/core/__tests__/deviceInventory.test.ts adws/triggers/__tests__/fixtures/deviceJanitorDeps.ts adws/triggers/__tests__/deviceJanitor.test.ts adws/triggers/__tests__/deviceJanitor.failures.test.ts features/regression/support/standInDevices.ts` — each under 300 lines. This includes any support module split out of `standInDevices.ts` and the `feature-1050-*` step files.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1050"` — this issue's scenarios in `feature-1050.feature`, plus the four device lifecycle scenarios of `feature-1047.feature` that also carry `@adw-1050`. None of them may be undefined.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047 or @adw-1048"` — the device lifecycle scenarios, unaffected.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite, with zero regressions.

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - files under 300 lines (split tests as planned);
  - guard clauses and nesting depth of 2 at most;
  - `map`, `filter`, `flatMap` and `reduce` over loops, except the deliberate sequential `for…of` with `await` that keeps one ADW ID's removal from overlapping the next decision;
  - inline callbacks over about 3 lines extracted to named functions;
  - no `any` (narrow the `simctl` JSON from `unknown` with a type guard);
  - readonly types and no mutation of inputs (the fixture's mutable holding is test-double state);
  - comments only for invariants and non-obvious reasons, with no issue numbers in code.
- **No new library.** Nothing to install.
- **Why the stage is not read.** The dev-server janitor also cleans a terminal-stage workflow whose orchestrator is still alive. A device is only ever held inside `withDevices`, by a running orchestrator, and it is removed there before the stage can become terminal. So for devices "live" means "orchestrator alive", which is what the issue says: "Devices of a live ADW ID … are untouched". Reading the stage could only reap a device from under a live process.
- **Why an ADW ID with no state is reaped.** `## Cancel` kills the orchestrator and deletes `agents/<adwId>`. Its devices then have no state at all, and requiring known state would leave them forever, against user story 20. The `adw-` prefix with an ADW-ID-shaped name is ADW's namespace on the pipeline host. An operator must not give their own devices such names.
- **Why the worktree path is computed from state.** The state already records `repoIdentity` and `branchName`. The alternatives cost more and are less precise:
  - listing worktrees through a launch boundary needs the repository's credentials and can fail per repository (#812's HTTP 404);
  - mapping worktrees back by issue number, as the dev-server janitor does, is ambiguous across repositories.

  ADW's branch names are slugs, so devplatform's `sanitizeBranchName` leaves them unchanged. A mismatch would only read as "no worktree", and the liveness check still protects a live workflow.
- **Several crons per host.** Each target repo's cron runs the janitor on its own cadence, so two passes may reap the same orphan at about the same time. The losing pass's commands fail and are logged as warnings; nothing is harmed. Scoping each cron to its own repository's ADW IDs would leave state-less ADW IDs unowned, so it is not done.
- **BDD scenarios.** The scenarios use the device steps' stand-ins (step 13):
  - ten run `runDeviceJanitorPass` with injected deps over "a recording executor that answers as a host with these devices";
  - two run one cron poll through `runJanitorTick`, in-process, over "the host's device tools are stand-ins … with these devices".

  Both need `features/regression/support/standInDevices.ts` to also answer `avdmanager list avd -c`, `adb devices`, `adb -s <serial> emu avd name` and `xcrun simctl list --json devices`. Today it answers only the lifecycle's commands. Real cron children in the subprocess harness never reach either janitor, because `CADENCE_PINS` pins `JANITOR_INTERVAL_CYCLES`. That is why the cron's janitor tick is proven in-process.
- **Documentation.** Leave these to `/document`:
  - `README.md` (the device paragraph, the resilience primitives line about the dev-server janitor, and the project tree);
  - `.adw/conditional_docs.md` (ownership of `deviceInventory.ts` and `deviceJanitor.ts`);
  - `app_docs/feature-ko14m9-device-lifecycle.md`;
  - ADR-0064's `### Confirmation`.
- **Out of scope:**
  - a host-wide cap on concurrent boots, deferred by the PRD;
  - running emulators whose AVD is no longer listed by `avdmanager` (not produced by the lifecycle, which deletes an AVD only after its emulator exits);
  - splitting `trigger_cron.ts` below 300 lines.
- **Release.** Nothing here is live on the pipeline host until a release to `main` and a host restart (ADR-0064).
