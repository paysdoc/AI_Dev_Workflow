# Patch: Poll the cron's own janitor passes in feature-1050's cron-poll steps, over stand-in device tools that lead `PATH`

## Metadata
adwId: `o1fnc2-feat-a-device-janito`
reviewChangeRequest: `Issue #1: features/per-issue/step_definitions/feature-1050-cron.steps.ts: the When steps 'the cron polls once, on a poll that runs its dev-server janitor' and '… on a poll that does not run its dev-server janitor' (pollAtCycle, lines 25-43) call `cron.runJanitorTick(cycle, passes)` with passes the step builds itself: `devServers: () => runJanitorPass(DEV_SERVER_JANITOR_DEPS, …)` and `devices: () => runDeviceJanitorPass({ ...DEFAULT_DEPS, devices: { executor, clock }, … })`. Rule 3: this copies the cron's private `JANITOR_PASSES` into the step. So the behaviour the scenarios claim, that the cron's poll sweeps the host's devices on the dev-server janitor's cycle (issue acceptance criterion 4), is supplied by the step, not by trigger_cron.ts. The only cron code exercised is the modulo gate in `runJanitorTick`. Rule 2: the Then steps 'the cron's poll left no emulator, AVD or simulator of the ADW ID … on the host' and 'the cron ran no device tool on that poll' cannot fail when the cron's own wiring is broken. Both scenarios would still pass if `JANITOR_PASSES.devices` ran no device janitor, or if `checkAndTrigger` kept calling `runJanitorPass()` alone or ran the device janitor on every poll. Rule 4: the step weakens what 'the cron polls once' promises. As a result no scenario tests acceptance criterion 4. Resolution: Rewrite pollAtCycle so the janitor passes come from the cron module, not the step. Call `runJanitorTick(cycle)` with no passes, so the cron's own default passes decide what runs. The dev-server janitor is already safe in the suite, because cucumber.js points TARGET_REPOS_DIR at an empty temp directory and pins JANITOR_INTERVAL_CYCLES. Replace only the host's device tools, at the boundary the scenario names: put recording stand-in programs for `avdmanager`, `emulator`, `adb` and `xcrun` first on PATH for the duration of the poll. `systemDeviceExecutor` spawns these by name with process.env, and `withStandInsOnPath` in feature-992-standins.ts and launchRecorder.ts already use this pattern for other tools. Have the stand-ins answer from, and record into, the scenario's table of devices. Assert that they lead PATH before the poll, so the host's real tools are never reached, and restore PATH afterwards. Point the two Then steps at what those stand-ins recorded and still hold. Change only the step definitions and their support code, never the .feature file, and do not loosen the assertions.`

## Issue Summary
**Original Spec:** `specs/issue-1050-adw-o1fnc2-feat-a-device-janito-sdlc_planner-device-janitor-dead-workflows.md`

**Issue:** Two scenarios of `features/per-issue/feature-1050.feature` (lines 131–149) are the only proof of acceptance criterion 4, "The cron trigger runs the sweep where it runs the dev-server janitor". Their When steps share `pollAtCycle` (`features/per-issue/step_definitions/feature-1050-cron.steps.ts:25-35`). It calls `cron.runJanitorTick(cycle, passes)` with passes the step builds itself:
- `devServers: () => runJanitorPass(DEV_SERVER_JANITOR_DEPS, emptyTargetRepos)`;
- `devices: () => runDeviceJanitorPass({ ...DEFAULT_DEPS, devices: { executor, clock }, log })`, over the executor of the in-process stand-in host.

That breaks three rules of the review's step-definition check:
- **Rule 3.** The step copies the cron's private `JANITOR_PASSES` (`adws/triggers/trigger_cron.ts:244`). The only cron code the scenarios exercise is the cadence gate in `runJanitorTick` (`trigger_cron.ts:252-256`).
- **Rule 2.** The Then steps read the stand-in host the step itself handed to the janitor, so they cannot fail when the cron's own wiring is broken.
- **Rule 4.** "the cron polls once" promises more than the step does.

A mutation check on the current step files confirmed it. Each mutant changes only production code, and the two scenarios are run with `--name "On a poll that"`:
- **A.** The cron's device pass runs no device janitor (`devices: () => Promise.resolve()`): `2 scenarios (2 passed)`.
- **C.** The lifecycle's default executor never reaches a device tool, because it answers every command with exit 0 and no output: `2 scenarios (2 passed)`.

A third mutant, **B**, also runs the device janitor on a poll off the cadence, through `runJanitorTick`'s passes. It was already caught, because the step's own pass ran inside the same gate.

**Solution:** Change only step definitions and their support code.
- **The cron's own passes.** The When steps call `cron.runJanitorTick(cycle)` with no passes, so the cron's own `JANITOR_PASSES` decide what runs:
  - `runJanitorPass()`, over the suite's empty `TARGET_REPOS_DIR` (`cucumber.js:23-24`);
  - `runDeviceJanitorPass()` with its own defaults: the lifecycle's `systemDeviceExecutor` and timer clock, `AgentStateManager.readTopLevelState`, `isAgentProcessRunning`, and the real logger.
- **Only the host's device tools are replaced**, at the boundary the scenario names. Four stand-in programs, `avdmanager`, `emulator`, `adb` and `xcrun`, lead `PATH` for the duration of the poll. `systemDeviceExecutor` spawns these by name with `env: process.env` (`adws/core/deviceExecutor.ts:59-64`), so Node resolves them from the `PATH` of that moment.
- **How the stand-ins answer.** Each program is a `/bin/sh` script, as `launchRecorder.ts`'s `bunx` shadow is. It runs a small Node relay, which hands the program's argv over a loopback HTTP connection to an in-process stand-in host. The host is built from the scenario's table: `standInDeviceExecutor({ devices })` from `features/regression/support/standInDevices.ts:87`.
  - The host records the run and applies it to the table's devices with `standInLeftoverDevices.ts`'s existing answers.
  - The program prints the answer and exits with its code.
  - Nothing else can reach the host. So what it recorded and still holds is what the programs were run with and left, and the two Then steps read exactly that.
- **`PATH`.** Before the poll, the step asserts that each of the four names resolves on `PATH` to its stand-in, so the host's real tools are never reached. feature-992's `withStandInsOnPath` restores `PATH` and `NODE_OPTIONS` afterwards, and the step asserts that the stand-ins have left `PATH`.

**The prototype.** A prototype of exactly this patch was built while preparing this plan, then reverted. On it:
- `@adw-1050` gave 17 scenarios passed (109 steps), and `@adw-1047 or @adw-1048` gave 48 passed (513 steps);
- `@regression` gave 369 scenarios passed (2,619 steps);
- eslint and both type checks were clean;
- mutants A, B and C each failed their scenario;
- a broken `PATH` lead (mutant D) stopped both polls before any device tool ran.

**Where the scenarios enter the cron.** They enter at `runJanitorTick`, as the resolution prescribes. `checkAndTrigger`'s own one-line call of it (`trigger_cron.ts:405`) stays out of reach of an in-process poll:
- its cycle counter is module-private and starts at 0;
- the cadence is pinned to 1,000,000 (`cucumber.js:31`);
- the rest of its tick needs a launch boundary.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-1050-tools.ts` (**new**, 137 lines): the stand-in device tools. It holds the four programs, the loopback relay into the stand-in host of the scenario's table, and the `PATH` assertion. No hooks and no steps.
- `features/per-issue/step_definitions/feature-1050-cron.steps.ts`: `pollAtCycle`, the two Then steps and the header comment.
- `features/per-issue/step_definitions/feature-1050-host.steps.ts`: the Given "the host's device tools are stand-ins that record each run and answer as a host with these devices:" installs the stand-in device tools instead of calling `standInDeviceHost`. Only the two cron-poll scenarios use that phrase.
- `features/per-issue/step_definitions/feature-1050-world.ts`: a `deviceTools` field in `State1050`.
- `features/regression/step_definitions/feature-992-standins.ts`: `withStandInsOnPath` takes `Pick<StandIns, 'binDir'>`, which is all its body reads. This is a one-line, type-only change.

Not modified:
- `features/per-issue/feature-1050.feature`: the review forbids it.
- `adws/triggers/trigger_cron.ts`, `adws/triggers/deviceJanitor.ts`, `adws/core/deviceLifecycle.ts`, `adws/core/deviceExecutor.ts`: no production code changes.
- `features/regression/support/standInDevices.ts` and `standInLeftoverDevices.ts`: reused as they are.
- `cucumber.js`: it already points `TARGET_REPOS_DIR` at an empty directory and pins `JANITOR_INTERVAL_CYCLES`.
- `feature-1050-sweep.steps.ts` and `feature-1050-devices.ts`. The cron steps reuse `nameFor` and `assertNoneHeldUnderName` from the latter.
- `features/regression/vocabulary.md`: no phrase changes.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Let `withStandInsOnPath` put any bin directory at the head of `PATH`
- In `features/regression/step_definitions/feature-992-standins.ts`, change only the signature:
  ```ts
  export function withStandInsOnPath<T>(si: Pick<StandIns, 'binDir'>, run: () => Promise<T>): Promise<T> {
  ```
- Both existing callers pass a whole `StandIns` and still type-check.
- The body stays as it is. It reads only `si.binDir`, and it clears `NODE_OPTIONS` while `run` runs. The relay needs that clearing to start without the suite's `--import tsx`.

### Step 2: Create the stand-in device tools in `features/per-issue/step_definitions/feature-1050-tools.ts`
Write the file as follows. This is the prototype that passed eslint, both type checks and every run above.

```ts
/**
 * Stand-ins for the host's device tools, `avdmanager`, `emulator`, `adb` and `xcrun`, as programs that lead `PATH` while the cron
 * polls. The cron's own device janitor runs these tools by name through the lifecycle's executor, so it reaches the stand-ins and
 * never the host's real tools. Each program hands its argv over a loopback connection to a stand-in host that holds the devices of
 * the scenario's table; the host records the run, applies it to those devices and answers it, and the program prints the answer and
 * exits with its code. Only the programs reach the host, so what it recorded and still holds is what the programs were run with and
 * left. No hooks and no steps: any step file may import it.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { text } from 'stream/consumers';

import { withStandInsOnPath } from '../../regression/step_definitions/feature-992-standins.ts';
import { standInDeviceExecutor, type StandInDeviceCommand, type StandInDeviceExecutor, type StandInHeldDevices, type StandInLeftoverDevice } from '../../regression/support/standInDevices.ts';

const DEVICE_TOOL_PROGRAMS = ['avdmanager', 'emulator', 'adb', 'xcrun'];

export interface StandInDeviceTools {
  readonly rootDir: string;
  readonly binDir: string;
  /** Each run of a stand-in program, in the order run. */
  readonly runs: readonly StandInDeviceCommand[];
  /** The devices of the scenario's table, before any run. */
  readonly leftovers: StandInHeldDevices;
  held(): StandInHeldDevices;
  /** Runs `run` while the programs lead `PATH`; outside it no program is on `PATH` and none is answered. */
  onPath<T>(run: () => Promise<T>): Promise<T>;
}

interface Relay {
  readonly server: http.Server;
  readonly port: number;
}

// Plain `var` source, so that the relay runs under the Node the suite runs under with no loader.
const relaySource = (port: number): string => `'use strict';
var http = require('http');
var argv = process.argv.slice(2);
var request = http.request({ host: '127.0.0.1', port: ${port}, method: 'POST', agent: false }, function (response) {
  var chunks = [];
  response.on('data', function (chunk) { chunks.push(chunk); });
  response.on('end', function () {
    var answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    process.stdout.write(answer.output);
    process.exitCode = answer.exitCode === null ? 1 : answer.exitCode;
  });
});
request.on('error', function (error) {
  process.stderr.write('stand-in ' + argv[0] + ': the scenario did not answer: ' + error.message + '\\n');
  process.exitCode = 1;
});
request.end(JSON.stringify({ argv: argv }));
`;

// A shebang cannot carry a path with spaces, so each program is a shell script that hands its name and its arguments to the relay.
const programSource = (program: string, relay: string): string => `#!/bin/sh\nexec '${process.execPath}' '${relay}' '${program}' "$@"\n`;

const isArgv = (value: unknown): value is [string, ...string[]] =>
  Array.isArray(value) && value.length > 0 && value.every(word => typeof word === 'string');

async function answerRun(host: StandInDeviceExecutor, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const { argv } = JSON.parse(await text(request)) as { readonly argv?: unknown };
  if (!isArgv(argv)) {
    response.end(JSON.stringify({ exitCode: 1, output: 'stand-in: the program sent no argv\n' }));
    return;
  }
  // The executor that ran the program holds it to the command's timeout; the stand-in host answers at once.
  const { exitCode, output } = await host.executor.run({ argv, timeoutMs: 0 });
  response.end(JSON.stringify({ exitCode, output }));
}

async function startRelay(host: StandInDeviceExecutor): Promise<Relay> {
  const server = http.createServer((request, response) => {
    void answerRun(host, request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object', 'Expected the relay of the stand-in device tools to listen on a port');
  return { server, port: address.port };
}

function closeRelay({ server }: Relay): Promise<void> {
  server.closeAllConnections();
  return new Promise(resolve => server.close(() => resolve()));
}

function writePrograms(rootDir: string, binDir: string, port: number): void {
  const relay = path.join(rootDir, 'relay.cjs');
  fs.writeFileSync(relay, relaySource(port));
  DEVICE_TOOL_PROGRAMS.forEach(program => fs.writeFileSync(path.join(binDir, program), programSource(program, relay), { mode: 0o755 }));
}

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** What a spawn of the program by its name runs: the first executable of that name on `PATH`. */
function resolvedOnPath(program: string): string | undefined {
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, program)).find(isExecutableFile);
}

function assertLeadPath(binDir: string): void {
  DEVICE_TOOL_PROGRAMS.forEach((program) => {
    assert.strictEqual(resolvedOnPath(program), path.join(binDir, program), `Expected the stand-in "${program}" to lead PATH, so that the host's own is never run; PATH is ${process.env.PATH}`);
  });
}

export function standInDeviceTools(devices: readonly StandInLeftoverDevice[]): StandInDeviceTools {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-1050-device-tools-'));
  const binDir = path.join(rootDir, 'bin');
  fs.mkdirSync(binDir);
  const host = standInDeviceExecutor({ devices });

  async function onPath<T>(run: () => Promise<T>): Promise<T> {
    const relay = await startRelay(host);
    try {
      writePrograms(rootDir, binDir, relay.port);
      return await withStandInsOnPath({ binDir }, () => {
        assertLeadPath(binDir);
        return run();
      });
    } finally {
      await closeRelay(relay);
    }
  }

  return { rootDir, binDir, runs: host.commands, leftovers: host.leftovers, held: host.held, onPath };
}
```

What the file guarantees:
- **The host stays private.** Its executor is never returned; only the relay calls it. So `runs` and `held()` can change only through a run of a stand-in program.
- **The order inside `onPath`.** The relay listens on an ephemeral loopback port first. The programs are then written with that port baked in. `PATH` is led only inside `withStandInsOnPath`, and the lead is asserted before `run`. The relay is closed in `finally`, so nothing answers once the poll is over. The `@adw-1050` hook removes `rootDir`, through `s.directories`.
- **The relay.** `agent: false` gives each run its own connection, which ends with the answer. The relay sets `process.exitCode` instead of calling `process.exit`, so its output is flushed to the pipe before it exits. A relay that cannot reach the scenario exits 1 with a message, which the janitor logs as a failure; it never hangs.
- **Timing.** The janitor's exit wait for the emulator (`awaitEmulatorGone`) polls `adb devices` before it sleeps. The stand-in drops the serial on `emu kill`, so the timer clock never sleeps. The janitor poll took about 1 s on the prototype, against the suite's 60-s default step timeout (`features/regression/support/hooks.ts:12`).

### Step 3: Keep the tools in the feature-1050 world, and install them in the Given step
- In `features/per-issue/step_definitions/feature-1050-world.ts`:
  - Add the import `import type { StandInDeviceTools } from './feature-1050-tools.ts';`, after the `feature-1047-world.ts` import.
  - Add this field to `State1050`, after `directories`:
    ```ts
      /** The stand-in device tools the cron's poll runs over. */
      deviceTools: StandInDeviceTools | undefined;
    ```
  - Add `deviceTools: undefined` to the object `freshState()` returns.
- In `features/per-issue/step_definitions/feature-1050-host.steps.ts`:
  - Drop the import of `standInDeviceHost`. Its only use was this Given.
  - Import `standInDeviceTools` from `./feature-1050-tools.ts`, and `s` from `./feature-1050-world.ts`, added to the existing import list.
  - Replace the body of `Given("the host's device tools are stand-ins that record each run and answer as a host with these devices:", …)` with:
    ```ts
      s.deviceTools = standInDeviceTools(devicesOf(table));
      s.directories.push(s.deviceTools.rootDir);
    ```
  - The Given "no workflow state and no worktree are left for the ADW ID {string}" is unchanged. Its assertion, that `agents/<adwId>` does not exist, matters now: the cron's own `readTopLevelState` and `isAgentProcessRunning` read that real directory.

### Step 4: Rewrite the cron-poll steps in `features/per-issue/step_definitions/feature-1050-cron.steps.ts`
Replace the whole file with:

```ts
/**
 * One poll of the cron's janitors, as the feature-1050 scenarios run it: the exported `runJanitorTick` of the cron module, in this
 * process, with the cron's own janitor passes, at a cycle that is the janitors' cadence or the cycle after it. Only the host's device
 * tools are replaced, by stand-in programs that lead `PATH` for the poll, so the device janitor reaches them through the lifecycle's
 * own executor and never the host's real tools. Its own liveness and state checks find an ADW ID that left no state dead. The
 * dev-server janitor sweeps the suite's empty directory of target repositories. A real cron child is never used: it would run the
 * host's real device tools unless a cadence pin kept it from the janitors.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';

import { JANITOR_INTERVAL_CYCLES } from '../../../adws/core/config.ts';

import { lineOf } from './feature-1047-commands.ts';
import { assertNoneHeldUnderName, nameFor } from './feature-1050-devices.ts';
import type { StandInDeviceTools } from './feature-1050-tools.ts';
import { s } from './feature-1050-world.ts';

function requireDeviceTools(): StandInDeviceTools {
  assert.ok(s.deviceTools, "Expected the scenario to have replaced the host's device tools with stand-ins first");
  return s.deviceTools;
}

/** Imported here, not at load: importing the cron module resolves the checkout's own repository. */
async function pollAtCycle(cycle: number): Promise<void> {
  const cron = await import('../../../adws/triggers/trigger_cron.ts');
  const tools = requireDeviceTools();
  await tools.onPath(() => cron.runJanitorTick(cycle));
  assert.ok(!(process.env.PATH ?? '').split(path.delimiter).includes(tools.binDir), 'Expected the stand-in device tools to have left PATH once the poll was over');
}

When('the cron polls once, on a poll that runs its dev-server janitor', async function () {
  await pollAtCycle(JANITOR_INTERVAL_CYCLES);
});

When('the cron polls once, on a poll that does not run its dev-server janitor', async function () {
  await pollAtCycle(JANITOR_INTERVAL_CYCLES + 1);
});

Then("the cron's poll left no emulator, AVD or simulator of the ADW ID {string} on the host", function (adwId: string) {
  const { leftovers, held } = requireDeviceTools();
  const name = nameFor(adwId);
  assert.ok(leftovers.avds.includes(name) || leftovers.simulators.some(simulator => simulator.name === name), `Expected the host to have held a device of the ADW ID "${adwId}" before the poll`);
  assertNoneHeldUnderName(held(), name, `the ADW ID "${adwId}"`);
});

Then('the cron ran no device tool on that poll', function () {
  const { runs, leftovers, held } = requireDeviceTools();
  assert.deepStrictEqual(runs.map(lineOf), [], 'Expected the cron to have run no device tool on a poll that does not run its janitors');
  assert.deepStrictEqual(held(), leftovers, 'Expected the host to hold every device it held before the poll');
});
```

- The step no longer imports `devServerJanitor.ts`, `deviceJanitor.ts`, `fs`, `os` or `requireStandInHost`. It builds no passes, makes no directory of target repositories, and no longer fills `s.lines`: the cron's device janitor logs through the real logger.
- No assertion is loosened:
  - "left no …" still asserts that the host holds no AVD, emulator or simulator of the name. It also asserts that the host held one before the poll, so it cannot pass vacuously.
  - "ran no device tool" still asserts no run. It also asserts that the host still holds every device it held to begin with.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. **The two cron-poll scenarios pass over the cron's own passes.**
   ```sh
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1050" --name "On a poll that"
   ```
   - Expect `2 scenarios (2 passed)` and `10 steps (10 passed)`.
   - On the janitor poll, the cron's own device janitor logs through the real logger:
     - `Device janitor: scanning 2 device(s) named for 1 ADW ID(s)`;
     - `Device janitor: removing the Android AVD "adw-m3n8b2-cart-checkout" (emulator-5554), the iOS simulator "adw-m3n8b2-cart-checkout" (00000001-5D2E-4C7D-9E10-A3B2C4D5E6F7) of ADW ID m3n8b2-cart-checkout: its orchestrator is not running and no worktree is recorded for it`;
     - one `removed …` line for the AVD and one for the simulator.
   - The other poll logs nothing.
   - On the prototype, the stand-in programs of the janitor poll were run with these, in order. The two listings run side by side, so the first two may swap.
     1. `avdmanager list avd -c`
     2. `xcrun simctl list --json devices`
     3. `adb devices`
     4. `adb -s emulator-5554 emu avd name`
     5. `adb -s emulator-5554 emu kill`
     6. `adb devices`
     7. `avdmanager delete avd --name adw-m3n8b2-cart-checkout`
     8. `xcrun simctl shutdown 00000001-5D2E-4C7D-9E10-A3B2C4D5E6F7`
     9. `xcrun simctl delete 00000001-5D2E-4C7D-9E10-A3B2C4D5E6F7`
2. **The Then steps now fail when the cron's own wiring breaks (rules 2 and 3), and the `PATH` guard holds.**
   - Mutants A–C change production files by literal replacement, and `git checkout --` restores them. The patch never edits those files, so the restore loses nothing.
   - Mutant D changes the new support file and is restored from a copy, because the file may still be untracked.
   - Every poll runs behind the `PATH` assertion, so no mutant can reach the host's real device tools.
   ```sh
   CRON=adws/triggers/trigger_cron.ts; LIFE=adws/core/deviceLifecycle.ts; TOOLS=features/per-issue/step_definitions/feature-1050-tools.ts
   SAVED=$(mktemp); cp "$TOOLS" "$SAVED"
   trap 'git checkout -- "$CRON" "$LIFE"; cp "$SAVED" "$TOOLS"' EXIT
   mutate() { node -e 'const fs=require("fs");const [f,...p]=process.argv.slice(1);let t=fs.readFileSync(f,"utf8");for(let i=0;i<p.length;i+=2){if(!t.includes(p[i]))throw new Error("not found: "+p[i]);t=t.replace(p[i],()=>p[i+1]);}fs.writeFileSync(f,t)' "$@"; }
   run() { NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1050" --name "On a poll that" 2>&1 | grep -E '^[0-9]+ scenarios? |AssertionError|Device janitor: scanning' | cut -c1-200; git checkout -- "$CRON" "$LIFE"; cp "$SAVED" "$TOOLS"; }
   echo A; mutate "$CRON" "devices: () => runDeviceJanitorPass() }" "devices: () => Promise.resolve() }"; run
   echo B; mutate "$CRON" "if (cycleCount % JANITOR_INTERVAL_CYCLES !== 0) return;" "if (cycleCount % JANITOR_INTERVAL_CYCLES !== 0) { await passes.devices(); return; }"; run
   echo C; mutate "$LIFE" "{ executor: systemDeviceExecutor, clock: timerClock" "{ executor: { ...systemDeviceExecutor, run: async () => ({ exitCode: 0, output: '' }) }, clock: timerClock"; run
   echo D; mutate "$TOOLS" "withStandInsOnPath({ binDir }, " "withStandInsOnPath({ binDir: rootDir }, "; run
   git status --short "$CRON" "$LIFE"; cmp "$SAVED" "$TOOLS" && echo "tools restored"
   ```
   - **Expected:**
     - **A.** The cron's device pass runs no device janitor. Expect `2 scenarios (1 failed, 1 passed)`, with `Expected the host to hold no emulator, AVD or simulator of the ADW ID "m3n8b2-cart-checkout" any more`.
     - **B.** The device janitor also runs on a poll off the cadence. Expect `2 scenarios (1 failed, 1 passed)`, with `Expected the cron to have run no device tool on a poll that does not run its janitors`.
     - **C.** The lifecycle's default executor never reaches a device tool. Expect the same as A.
     - **D.** The stand-ins do not lead `PATH`. Expect `2 scenarios (2 failed)` and `10 steps (2 failed, 2 skipped, 6 passed)`.
       - Both When steps fail with `Expected the stand-in "avdmanager" to lead PATH, so that the host's own is never run; PATH is …`.
       - No `Device janitor: scanning` line appears, because the assertion stops each poll before any device tool runs.
       - The host this plan was prepared on has `/usr/bin/xcrun`. So the assertion, not luck, is what keeps a broken lead from reaching a real tool.
     - The final `git status` prints nothing, and `cmp` prints `tools restored`.
   - **Before the patch:** A and C printed `2 scenarios (2 passed)`, which is the defect. B was already caught. This was verified while preparing this plan.
   - **If interrupted:** run `git checkout -- adws/triggers/trigger_cron.ts adws/core/deviceLifecycle.ts`, and copy `$SAVED` back over the tools file.
3. **This issue's scenarios, the device lifecycle scenarios and the regression suite.**
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1050"`: expect `17 scenarios (17 passed)` and `109 steps (109 passed)`, none undefined. This covers feature-1050 and the four feature-1047 scenarios that carry the tag. The prototype gave exactly this.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047 or @adw-1048"`: expect `48 scenarios (48 passed)` and `513 steps (513 passed)`. The prototype gave exactly this.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: zero regressions. It runs feature-992's two callers of `withStandInsOnPath`. The prototype gave `369 scenarios (369 passed)` and `2619 steps (2619 passed)`.
4. **Lint, both type checks, the build and the unit suite.**
   ```sh
   bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json && bun run build && bun run test:unit
   ```
   - All must pass. On the prototype, eslint on the five files and both type checks were clean.
   - Vitest covers only `adws/**` and `test/mocks/**` (`vitest.config.ts`), so this patch cannot change the unit suite. It is still the spec's zero-regression gate.
5. **Size, scope and leftovers.**
   - `wc -l features/per-issue/step_definitions/feature-1050-*.ts features/regression/step_definitions/feature-992-standins.ts`: each file stays under 300 lines. The prototype gave 137 (tools), 53 (cron), 63 (host), 121 (world) and 183 (feature-992-standins).
   - `git status --short` lists only the five files of this patch and this plan.
   - `ls "${TMPDIR:-/tmp}" | grep adw-1050-device-tools` prints nothing, because the `@adw-1050` hook removes each scenario's tools directory.

## Patch Scope
**Lines of code to change:** about +166/−23. That is one new 137-line support file, plus four edits: cron steps +20/−18, host steps +4/−3, world +4/−1, feature-992-standins +1/−1.
**Risk level:** low
**Testing required:** Only BDD step definitions and their support change; no production code does. Run:
- the two cron-poll scenarios;
- the four-mutant check: A, B and C break the cron's own wiring, and D breaks the `PATH` lead;
- `@adw-1050` (17 scenarios), `@adw-1047 or @adw-1048` (48) and `@regression`;
- lint, both type checks, the build and the unit suite.
