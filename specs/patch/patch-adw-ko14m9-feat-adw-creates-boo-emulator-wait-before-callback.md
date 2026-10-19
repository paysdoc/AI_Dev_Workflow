# Patch: Require the emulator's device-state and boot-completed reads to have been issued, and to end before the callback, in feature-1047's emulator-wait step

## Metadata
adwId: `ko14m9-feat-adw-creates-boo`
reviewChangeRequest: `Issue #2: A step definition in `features/per-issue/step_definitions/feature-1047-lifecycle.steps.ts` breaks rule 2 (the assertion can fail). The step is "the emulator was waited for with {string}, addressed by the serial of its console port, until its device state was {string} and its property {string} read {string}". Its check `commands.lastIndexOf('adb -s <serial> shell getprop sys.boot_completed') < callbackAt` is true when the property was never read, because `lastIndexOf` then returns -1. Its `get-state` check only asks that the command appear somewhere in the recorded commands, even after the callback. A lifecycle that never waited for `sys.boot_completed`, or asked for the device state only after handing the devices over, would pass this step. Resolution: Change the step definition only. Assert that `adb -s <serial> get-state` and `adb -s <serial> shell getprop sys.boot_completed` were each issued (index !== -1), and that the last of each comes before the callback marker. Do not loosen the assertion or edit the `.feature` file.`

## Issue Summary
**Original Spec:** `specs/issue-1047-adw-ko14m9-feat-adw-creates-boo-sdlc_planner-device-lifecycle-per-workflow.md`

**Issue:** The step "the emulator was waited for with {string}, addressed by the serial of its console port, until its device state was {string} and its property {string} read {string}" has two holes. It lives at `features/per-issue/step_definitions/feature-1047-lifecycle.steps.ts:157-167`, and only `features/per-issue/feature-1047.feature:73` uses it.
- **The property check.** `commands.lastIndexOf(`adb -s ${serial} shell getprop ${property}`) < callbackAt` (line 165) also holds when the property was never read, because `lastIndexOf` then returns -1.
- **The device-state check.** `commands.indexOf(`adb -s ${serial} get-state`) !== -1` (line 164) only asks that the command appear somewhere among the recorded commands, even after the callback.

A mutation check confirmed both holes. Each mutant changes only `adws/core/deviceLifecycle.ts`, and the scenario then runs over the real `withDevices`:
- **A.** The readiness wait polls `get-state` twice and never reads `sys.boot_completed`. The scenario passes, with 10 of 10 steps.
- **B.** The readiness wait reads only `sys.boot_completed`, and the teardown asks for `get-state` just before `emu kill`, after the callback. The scenario passes, with 10 of 10 steps.

A lifecycle that hands over a half-booted emulator therefore passes the scenario. The step breaks rule 2 of the review's step-definition check (the assertion can fail).

**Solution:** Change only the step's body. Take the last index of each of the two commands, then assert two things for each:
- it was issued (`!== -1`);
- its last index comes before the callback marker.

The `.feature` file, the step phrase and the rest of the file stay unchanged. Asserting "issued" before "before the callback" means -1 can no longer pass `< callbackAt`. Using the last index means a command asked again after the hand-over fails the step.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-1047-lifecycle.steps.ts`: only the two assertions at lines 164–165, inside the step "the emulator was waited for with …".

Not modified:
- `features/per-issue/feature-1047.feature`: the review forbids it.
- `adws/core/deviceLifecycle.ts`: `awaitAndroidBoot` (lines 141–150) already waits for `get-state`, then for `sys.boot_completed`, before the callback runs.
- `features/per-issue/step_definitions/feature-1047-commands.ts`, `feature-1047-world.ts` and `features/regression/support/standInDevices.ts`.
- The step "the device lifecycle read the emulator's property {string} {int} times, and ran the callback only after the last read". The review did not flag it, and its read count already rules out the -1 case.
- `features/per-issue/step_definitions/feature-1047-phase.steps.ts`: its uncommitted change is issue #1's patch (`specs/patch/patch-adw-ko14m9-feat-adw-creates-boo-distinguish-device-log-lines.md`). Leave it alone.
- `features/regression/vocabulary.md`: the phrase is not registered there, and no phrase changes.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Replace the two assertions of the emulator-wait step
- In `features/per-issue/step_definitions/feature-1047-lifecycle.steps.ts`, inside `Then('the emulator was waited for with {string}, addressed by the serial of its console port, …')`, keep these lines as they are:
  - the parameter guard `assert.deepStrictEqual([tool, state, property, value], ['adb', 'device', 'sys.boot_completed', '1'], …)`;
  - `serial`;
  - `commands`;
  - `callbackAt`.
- Replace these two lines (164–165):
  ```ts
      assert.ok(commands.indexOf(`adb -s ${serial} get-state`) !== -1, `Expected adb to have been asked for the device state of "${serial}"`);
      assert.ok(commands.lastIndexOf(`adb -s ${serial} shell getprop ${property}`) < callbackAt, `Expected adb to have been asked for "${property}" of "${serial}" before the callback ran`);
  ```
  with:
  ```ts
      const stateAt = commands.lastIndexOf(`adb -s ${serial} get-state`);
      const propertyAt = commands.lastIndexOf(`adb -s ${serial} shell getprop ${property}`);
      assert.notStrictEqual(stateAt, -1, `Expected adb to have been asked for the device state of "${serial}"`);
      assert.notStrictEqual(propertyAt, -1, `Expected adb to have been asked for "${property}" of "${serial}"`);
      assert.ok(stateAt < callbackAt, `Expected adb to have been asked for the device state of "${serial}" only before the callback ran, but the commands were:\n${commands.join('\n')}`);
      assert.ok(propertyAt < callbackAt, `Expected adb to have been asked for "${property}" of "${serial}" only before the callback ran, but the commands were:\n${commands.join('\n')}`);
  ```
- `lastIndexOf` returns -1 exactly when `indexOf` does, so one index per command serves both checks: that it was issued, and that the last one came before the callback.
- If the callback never ran, `callbackAt` is -1, so the two "before" checks fail too, and their messages list the recorded commands.
- Add no helper, import or comment. The step phrase and the rest of the file stay unchanged.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. **The scenario passes on the real lifecycle.** Expect `1 scenario (1 passed)` and `10 steps (10 passed)`:
   ```sh
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047" --name "The device lifecycle waits for the emulator"
   ```
2. **Each new assertion can fail (mutation check, rule 2).** Each mutant changes `adws/core/deviceLifecycle.ts` by literal replacement and runs the scenario; `git checkout --` then restores the file. The patch never edits that file, so the restore loses nothing.
   - **A.** Never reads `sys.boot_completed`.
   - **B.** Asks for the device state only after the callback.
   - **C.** Never asks for the device state.
   - **D.** Reads `sys.boot_completed` again after the callback.
   ```sh
   F=adws/core/deviceLifecycle.ts
   trap 'git checkout -- "$F"' EXIT
   KILL="const failures = await attempt(deps.executor, tools.killEmulator(serial));"
   mutate() { node -e 'const fs=require("fs");const [f,...p]=process.argv.slice(1);let t=fs.readFileSync(f,"utf8");for(let i=0;i<p.length;i+=2){if(!t.includes(p[i]))throw new Error("not found: "+p[i]);t=t.replace(p[i],()=>p[i+1]);}fs.writeFileSync(f,t)' "$F" "$@"; }
   run() { NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047" --name "The device lifecycle waits for the emulator" 2>&1 | grep -E '^1 scenario|AssertionError'; git checkout -- "$F"; }
   echo A; mutate "answers(['shell', 'getprop', 'sys.boot_completed'], '1')" "answers(['get-state'], 'device')"; run
   echo B; mutate "answers(['get-state'], 'device')" "answers(['shell', 'getprop', 'sys.boot_completed'], '1')" "$KILL" "await attempt(deps.executor, tools.pollEmulator(serial, 'get-state'));
     $KILL"; run
   echo C; mutate "answers(['get-state'], 'device')" "answers(['shell', 'getprop', 'sys.boot_completed'], '1')"; run
   echo D; mutate "$KILL" "await attempt(deps.executor, tools.pollEmulator(serial, 'shell', 'getprop', 'sys.boot_completed'));
     $KILL"; run
   git status --short "$F"
   ```
   - **Expected.** All four mutants print `1 scenario (1 failed)`, and the final `git status` prints nothing. The assertions read:
     - A: `Expected adb to have been asked for "sys.boot_completed" of "emulator-<port>"`;
     - B: `Expected adb to have been asked for the device state of "emulator-<port>" only before the callback ran, …`;
     - C: `Expected adb to have been asked for the device state of "emulator-<port>"`;
     - D: `Expected adb to have been asked for "sys.boot_completed" of "emulator-<port>" only before the callback ran, …`.
   - **Before the patch.** A and B print `1 scenario (1 passed)`, which is the defect; C and D already fail. This was verified while preparing this plan. On a prototype of this patch, which was then reverted, all four mutants failed with the messages above.
   - **If interrupted.** If the final `git status` lists the file, run `git checkout -- adws/core/deviceLifecycle.ts`.
3. **This issue's scenarios and the regression suite.**
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1047"`: expect `27 scenarios (27 passed)` and `273 steps (273 passed)`, none undefined. The prototype gave exactly this, with issue #1's uncommitted change present. `cucumber.js` imports every step file on every run, so this also shows that the changed file loads beside all the others.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: zero regressions.
4. **Lint and type checks.** All clean; the prototype passed `eslint` on the file and both type checks:
   ```sh
   bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json
   ```
5. **Size and scope.**
   - `git diff --stat -- features/per-issue/step_definitions/feature-1047-lifecycle.steps.ts` prints `1 file changed, 6 insertions(+), 2 deletions(-)`.
   - `wc -l` of that file gives 215, under 300.
   - `git status --short` lists no other new change. The modified `feature-1047-phase.steps.ts` and issue #1's patch plan predate this patch.

## Patch Scope
**Lines of code to change:** 8 (+6/−2) in one step definition file
**Risk level:** low
**Testing required:** Only one per-issue BDD step definition changes; no production code changes. Run the emulator-wait scenario on the real lifecycle, then the four-mutant check: each of the four new assertions must have a mutant that trips it. Then run `@adw-1047` (27 scenarios), `@regression`, lint and both type checks.
