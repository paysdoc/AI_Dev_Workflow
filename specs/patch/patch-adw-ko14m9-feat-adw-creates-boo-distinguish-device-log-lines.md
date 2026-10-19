# Patch: Tell the emulator's and the simulator's execution-log lines apart by serial and UDID in feature-1047's log steps

## Metadata
adwId: `ko14m9-feat-adw-creates-boo`
reviewChangeRequest: `Issue #1: Step definitions in `features/per-issue/step_definitions/feature-1047-phase.steps.ts` break rule 2 (the assertion can fail). Three steps are affected: "the workflow's execution log has a line that gives the name of the AVD the scenario test phase created and the time the emulator took to boot", "the workflow's execution log has a line that gives the name of the simulator the scenario test phase created and the time it took to boot", and "the workflow's execution log says, after those lines, that the AVD and the simulator were removed, giving the name of each". Both devices are named `adw-<adwId>`, so `avdName()` and `simulatorName()` return the same string. That makes the AVD and simulator patterns identical (`"adw-<id>".*booted in …s` and `Removed .*"adw-<id>"`), and `lineIndex` and `removed` return the first matching line for both devices. On the stand-in host the iOS lines always come first; the proof's run log shows `The iOS simulator "adw-…" (…) booted in 0.0s` before `The Android emulator …`, and `Removed the iOS simulator` before `Removed the Android AVD`. So the simulator's boot line also satisfies the AVD's boot-time step, and the simulator's removal line also satisfies the AVD's removal check. `bootedAt = Math.max(…)` is therefore the index of one line, not the later of two. A phase that logged no emulator boot time and no AVD removal would still pass this scenario, so the issue's acceptance criterion "The orchestrator log carries the device names, boot durations and removal" is not checked for the emulator. Resolution: Rewrite these three step definitions without touching the `.feature` file. Tell each device's lines apart by something only that device has: for the AVD, its serial `emulator-<port>` taken from the recorded `emulator … -port` command; for the simulator, its UDID taken from the recorded `xcrun simctl boot` command. Require the emulator's boot line and the simulator's boot line to be two different lines, each giving a duration. Require two different `Removed` lines, one per device, each after the later of the two boot lines.`

## Issue Summary
**Original Spec:** `specs/issue-1047-adw-ko14m9-feat-adw-creates-boo-sdlc_planner-device-lifecycle-per-workflow.md`

**Issue:** The three execution-log steps of the scenario "The execution log of a "mobile:kotlincm" workflow's scenario test phase gives the names of the AVD and the simulator it created, the time each took to boot, and their removal" (`features/per-issue/feature-1047.feature:170-181`) match a device's lines only by its quoted name (`features/per-issue/step_definitions/feature-1047-phase.steps.ts:157-190`). The lifecycle names both devices `adw-<adwId>`, so the AVD's and the simulator's patterns are the same, and each search returns the first line that matches either device. A baseline run shows the order on the stand-in host:
- `The iOS simulator "adw-bdd929-…" (9B3D5F71-…) booted in 0.0s`
- `The Android emulator "adw-bdd929-…" (emulator-5600) booted in 0.0s`
- `Removed the iOS simulator "adw-bdd929-…" (9B3D5F71-…)`
- `Removed the Android AVD "adw-bdd929-…" (emulator-5600)`

So the iOS lines satisfy the AVD's checks. A mutation check confirmed the defect. With the Android boot line deleted (`adws/core/deviceLifecycle.ts:169`), or the Android removal report deleted (`adws/core/deviceLifecycle.ts:229`), the scenario still passed with 11 of 11 steps. The acceptance criterion "The orchestrator log carries the device names, boot durations and removal" is therefore not checked for the emulator, and the steps break rule 2 of the review's step-definition check (the assertion can fail).

**Solution:** Rewrite only the three step bodies and their local helpers. The step phrases and the `.feature` file stay as they are.
- **Tell the lines apart.** A device's line is one that gives its quoted name and something only that device has:
  - the AVD's serial, `emulator-<port>`, from the recorded `emulator … -port <port>` command;
  - the simulator's UDID, from the recorded `xcrun simctl boot <udid>` command.

  Both come from the file's existing `bootedDevices()` (`feature-1047-phase.steps.ts:34-41`), which reads them from the commands the stand-in device executor recorded. That executor is a mocked external boundary, so rule 1 allows it.
- **Boot lines.** Each must also give a duration (`booted in <n>s`). The removal step requires the two boot lines to be different lines.
- **Removal lines.** It then requires a `Removed` line for each device after the later of the two boot lines, and the two removal lines to be different lines.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-1047-phase.steps.ts`: only the execution-log block, from `lineIndex` through the third execution-log step (lines 157–190 today).

Not modified:
- `features/per-issue/feature-1047.feature`: the review forbids it.
- `adws/core/deviceLifecycle.ts`: its log lines already carry the serial and the UDID.
- `features/per-issue/step_definitions/feature-1047-commands.ts` and `features/regression/support/standInDevices.ts`.
- `features/regression/vocabulary.md`: these per-issue phrases are not registered there, and no phrase changes.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Make `lineIndex` search by predicate and add a `Removed` pattern
- Change `lineIndex` to take a predicate. This way no regular expression is built from a device name or a UDID, and nothing needs escaping. Keep its assertion message:
  ```ts
  function lineIndex(matches: (line: string, index: number) => boolean, description: string): number {
    const log = executionLog();
    const at = log.findIndex(matches);
    assert.ok(at !== -1, `Expected the execution log to have ${description}, but it holds:\n${log.join('\n')}`);
    return at;
  }
  ```
- Below `const BOOTED_IN = /booted in \d+(\.\d+)?s/;`, add `const REMOVED = /\bRemoved\b/;`.
- Keep `executionLog`, `BOOTED_IN`, `avdName`, `simulatorName` and `quoted` unchanged.

### Step 2: Add a per-device descriptor that identifies a device's lines by serial or UDID
Insert this right after `const quoted = …`. The doc comment says why the name alone is not enough; per the coding guidelines, it is the only comment:
```ts
/** Both devices are named after the ADW ID, so a line is the emulator's when it gives its serial, and the simulator's when it gives its UDID. */
interface LoggedDevice {
  readonly kind: 'AVD' | 'simulator';
  readonly name: string;
  readonly identity: string;
}

function loggedDevices(): { readonly emulator: LoggedDevice; readonly simulator: LoggedDevice } {
  const { serial, udid } = bootedDevices();
  return {
    emulator: { kind: 'AVD', name: avdName(), identity: serial },
    simulator: { kind: 'simulator', name: simulatorName(), identity: udid },
  };
}

const described = ({ kind, name, identity }: LoggedDevice): string => `the ${kind} "${name}" (${identity})`;

const names = (line: string, { name, identity }: LoggedDevice): boolean => line.includes(quoted(name)) && line.includes(identity);

function bootLineOf(device: LoggedDevice): number {
  return lineIndex(line => names(line, device) && BOOTED_IN.test(line), `a line that gives the name of ${described(device)} and the time it took to boot`);
}

function removalLineOf(device: LoggedDevice, bootedAt: number): number {
  return lineIndex((line, index) => index > bootedAt && names(line, device) && REMOVED.test(line), `a line, after the boot lines, that says ${described(device)} was removed`);
}
```
- **Names.** These still come from the create commands (`avdmanager create avd --name …` and `xcrun simctl create <name> …`), as the phrases say ("the name of the AVD/simulator the scenario test phase created").
- **Identities.** `bootedDevices()` gives the serial `emulator-<-port value>` from the recorded `emulator` command and the UDID from `xcrun simctl boot` `argv[3]`. It fails with the recorded commands listed if either command is missing.
- **Matching.** `names` requires both the quoted name and the identity. The simulator's lines never contain `emulator-<port>`, and the emulator's lines never contain the UDID, so one device's line cannot satisfy the other device's check.

### Step 3: Rewrite the three execution-log steps (phrases unchanged)
```ts
Then("the workflow's execution log has a line that gives the name of the AVD the scenario test phase created and the time the emulator took to boot", function () {
  bootLineOf(loggedDevices().emulator);
});

Then("the workflow's execution log has a line that gives the name of the simulator the scenario test phase created and the time it took to boot", function () {
  bootLineOf(loggedDevices().simulator);
});

Then("the workflow's execution log says, after those lines, that the AVD and the simulator were removed, giving the name of each", function () {
  const { emulator, simulator } = loggedDevices();
  const [emulatorBooted, simulatorBooted] = [bootLineOf(emulator), bootLineOf(simulator)];
  assert.notStrictEqual(emulatorBooted, simulatorBooted, 'Expected the emulator and the simulator to each have a boot line of their own, but one line gives both');
  const bootedAt = Math.max(emulatorBooted, simulatorBooted);
  assert.notStrictEqual(removalLineOf(emulator, bootedAt), removalLineOf(simulator, bootedAt), 'Expected the AVD and the simulator to each have a removal line of their own, but one line gives both');
});
```
- `bootedAt` is now the later of two separate boot lines, each with a duration. Each `Removed` line must come after it.
- The two `notStrictEqual` checks fail when a single line names both devices. They meet the review's "two different lines" requirement for the boot lines and for the removal lines.
- Leave the rest of the file unchanged, including `wordsOf` and "the workflow's execution log mentions no emulator, AVD or simulator". Add no new step pattern.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. **The scenario passes on the real lifecycle.** Expect `1 scenario (1 passed)` and `11 steps (11 passed)`:
   ```sh
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047" --name "The execution log of a"
   ```
2. **The assertions can fail (mutation check, rule 2).** The loop deletes one log line of the lifecycle at a time:
   - Android boot;
   - Android removal;
   - iOS boot;
   - iOS removal.

   It runs the scenario on each mutant and then restores the file with `git checkout --`. The patch never edits `deviceLifecycle.ts`, so the restore loses nothing.
   ```sh
   F=adws/core/deviceLifecycle.ts
   for line in 'The Android emulator "${name}" (${serial}) booted in' 'reportRemoval(session.request.record, `the Android AVD' 'The iOS simulator "${name}" (${udid}) booted in' 'reportRemoval(request.record, `the iOS simulator'; do
     grep -v -F "$line" "$F" > /tmp/adw-1047-mutant.ts && cp /tmp/adw-1047-mutant.ts "$F"
     NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047" --name "The execution log of a" 2>&1 | grep -E '^1 scenario|AssertionError'
     git checkout -- "$F"
   done
   git status --short "$F"
   ```
   - **Expected.** All four mutants print `1 scenario (1 failed)`, and the final `git status` prints nothing. The assertions name, in turn:
     - the AVD `… (emulator-<port>)` boot line;
     - the AVD's removal;
     - the simulator `… (<udid>)` boot line;
     - the simulator's removal.
   - **Before the patch.** Every mutant passes, which is the defect. This was verified while preparing this plan: the Android mutants passed with 11 of 11 steps on the current step definitions. On a prototype of this patch, which was then reverted, all four mutants failed as listed above.
3. **This issue's scenarios and the regression suite.**
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047"`: 27 scenarios pass and none is undefined. `cucumber.js` imports every step file on every run, so this also shows that the rewritten file loads beside all the others.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: zero regressions.
4. **Lint and type checks.** All clean:
   ```sh
   bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json
   ```
5. **File size and scope.**
   - `wc -l features/per-issue/step_definitions/feature-1047-phase.steps.ts` stays under 300; the prototype had 226 lines.
   - `git diff --stat` lists only that file.

## Patch Scope
**Lines of code to change:** about 45 in one file (the prototype was +37/−9 in `feature-1047-phase.steps.ts`)
**Risk level:** low
**Testing required:** Only the per-issue BDD step definitions change; no production code. Run the execution-log scenario and the four-mutant check to show each device's boot line and removal line is asserted on its own. Then run `@adw-1047` (27 scenarios), `@regression`, lint and both type checks.
