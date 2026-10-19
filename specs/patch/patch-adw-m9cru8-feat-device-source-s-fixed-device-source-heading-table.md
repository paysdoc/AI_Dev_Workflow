# Patch: Take the feature-1045 device-source expectations from a fixed heading table, not from `DEVICE_SOURCE_SECTION_TITLES`

## Metadata
adwId: `m9cru8-feat-device-source-s`
reviewChangeRequest: ``Issue #1: features/per-issue/step_definitions/feature-1045-config.steps.ts breaks Rule 3 (expectations come from the scenario). The steps `the project configuration names these device sources, and no other:` and `the device sources resolve to:` build their expected values with `valuesOf` from feature-1045-sections.ts. `valuesOf` relies on `keyOf`, which picks the field each section's value is expected in by looking the heading up in the implementation's own `DEVICE_SOURCE_SECTION_TITLES`, the same table `parseDeviceSourceSections` reads with. The expectation is therefore computed from the code under test. Suppose that table crossed two fields, for example `iosDeviceType: 'iOS Runtime'` and `iosRuntime: 'iOS Device Type'`. The parser would read the runtime into `iosDeviceType`, the step would expect it there, and both scenarios would pass. So would every other `@adw-1045` scenario: the resolver and phase scenarios only check which section is named. The scenario that promises the device sources 'resolve to the system image, device profile, device type and runtime it names' cannot fail when a device source lands in the wrong field. Resolution: Change the step definitions only. In features/per-issue/step_definitions/feature-1045-sections.ts, stop looking headings up in `DEVICE_SOURCE_SECTION_TITLES`, both in `keyOf` and in the known-heading check of `assertDeviceSourceSection` and `titleOf`. Use a fixed table written from the issue and the scenarios instead: `## Android System Image` → `androidSystemImage`, `## Android Device Profile` → `androidDeviceProfile`, `## iOS Device Type` → `iosDeviceType`, `## iOS Runtime` → `iosRuntime`. Build `valuesOf` from that table, so both Then steps compare `deviceSources` and `deviceSource` against an expectation that does not come from the implementation. Keep the deep-equality assertions as strict as they are now, and do not edit the `.feature` files.``

## Issue Summary
**Original Spec:** `specs/issue-1045-adw-m9cru8-feat-device-source-s-sdlc_planner-device-source-config-scenario-gate.md`

**Issue:** Two Then steps in `feature-1045-config.steps.ts` check values: `the project configuration names these device sources, and no other:` and `the device sources resolve to:`. Both build their expectation with `valuesOf` from `feature-1045-sections.ts`.
- `valuesOf` calls `keyOf`. `keyOf` picks the field for each `## <heading>` row by looking the title up in `DEVICE_SOURCE_SECTION_TITLES`, the same table `parseDeviceSourceSections` reads with.
- So the expectation comes from the code under test. That breaks Rule 3 of `.claude/commands/review.md` Step 5 ("Expectations come from the scenario").
- Confirmed while planning. `adws/core/deviceSourceConfig.ts` was changed temporarily to `iosDeviceType: 'iOS Runtime'` and `iosRuntime: 'iOS Device Type'`, then restored. Both value scenarios still reported `2 scenarios (2 passed)`:
  - "ADW reads each device source of ".adw/project.md" as it is written, …"
  - "… names all four resolve to the system image, device profile, device type and runtime it names"
- The other `@adw-1045` scenarios only check which section is named, so nothing catches a section read into the wrong field.

**Solution:** Change `feature-1045-sections.ts` only. Replace every lookup in `DEVICE_SOURCE_SECTION_TITLES` with a fixed table written from the issue and the scenarios:

| Heading | Field |
|---|---|
| `## Android System Image` | `androidSystemImage` |
| `## Android Device Profile` | `androidDeviceProfile` |
| `## iOS Device Type` | `iosDeviceType` |
| `## iOS Runtime` | `iosRuntime` |

- The lookups to replace are in `keyOf`, and in the known-heading check that `assertDeviceSourceSection` and `titleOf` share.
- `valuesOf` then builds both Then steps' expectation from that table.
- These stay unchanged: the `assert.deepStrictEqual` calls in `feature-1045-config.steps.ts`, the `.feature` files, the shared fixture and the implementation.
- Trial run of exactly this change during planning, reverted afterwards:
  - lint and `bunx tsc --noEmit` passed;
  - all 24 `@adw-1045` scenarios passed;
  - with the crossed table above, both value scenarios failed, at those two Then steps.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-1045-sections.ts`: the only file that changes.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Replace the implementation's table with a fixed heading → field table
- In `features/per-issue/step_definitions/feature-1045-sections.ts`, turn the value import into a type-only import:
  - before: `import { DEVICE_SOURCE_SECTION_TITLES, type DeviceSourceSections } from '../../../adws/core/deviceSourceConfig.ts';`
  - after: `import type { DeviceSourceSections } from '../../../adws/core/deviceSourceConfig.ts';`
  - No value from the code under test is imported any more. The type only names the fields of `ProjectConfig.deviceSources`, the public shape the steps observe. It also turns a misspelt field in the table into a compile error.
- Delete `export const DEVICE_SOURCE_KEYS = Object.keys(DEVICE_SOURCE_SECTION_TITLES) as Array<keyof DeviceSourceSections>;`. Only this file uses it. `feature-992-adw-files.ts` has its own private `DEVICE_SOURCE_KEYS`, which stays.
- Put the table in its place, with one comment that gives the reason for it:
  ```ts
  // Written from the issue, not looked up in the parser's `DEVICE_SOURCE_SECTION_TITLES`, so a section read into the
  // wrong field fails the scenario.
  const FIELD_OF_SECTION: ReadonlyMap<string, keyof DeviceSourceSections> = new Map([
    ['## Android System Image', 'androidSystemImage'],
    ['## Android Device Profile', 'androidDeviceProfile'],
    ['## iOS Device Type', 'iosDeviceType'],
    ['## iOS Runtime', 'iosRuntime'],
  ]);
  ```
- Keep `HEADING_MARK` and the file's doc comment as they are.

### Step 2: Check headings and pick fields from the fixed table
- `assertDeviceSourceSection`: build the known headings from the table, `const known = [...FIELD_OF_SECTION.keys()];`. Keep the `assert.ok(known.includes(section), …)` line and its message unchanged.
- `titleOf`: no change. It still calls `assertDeviceSourceSection(section)` and strips `## `, so the Given steps write each section under the title the scenario names.
- `keyOf`: replace `const title = titleOf(section);` and the `DEVICE_SOURCE_KEYS.find(…)` lookup with a lookup in the table:
  ```ts
  /** The field of the project configuration the section is read into. */
  export function keyOf(section: string): keyof DeviceSourceSections {
    assertDeviceSourceSection(section);
    const key = FIELD_OF_SECTION.get(section);
    assert.ok(key, `Expected "${section}" to be read into a field of the project configuration`);
    return key;
  }
  ```
- `valuesOf`: leave its body unchanged. Through `keyOf` it now maps every row with the fixed table. It still returns all four fields, with `null` for each section the scenario's table does not name.

### Step 3: Leave everything else as it is
- `feature-1045-config.steps.ts`: no edit. Both Then steps keep `assert.deepStrictEqual(…, valuesOf(table), …)`, so the comparison stays exactly as strict.
- `feature-1045-phase.steps.ts`: no edit. Its `titleOf` calls now check against the fixed table.
- Do not edit:
  - any `.feature` file;
  - `adws/core/deviceSourceConfig.ts`;
  - `features/regression/step_definitions/feature-992-adw-files.ts`. It uses the implementation's titles only to set up sections in Given steps. That is not an expectation, and it is outside this finding.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. **Only the helper changed, and it imports no value from the code under test.**
   - `git diff --name-only HEAD` lists only `features/per-issue/step_definitions/feature-1045-sections.ts`.
   - `grep -n "deviceSourceConfig" features/per-issue/step_definitions/feature-1045-sections.ts` prints exactly one line: `import type { DeviceSourceSections } from '../../../adws/core/deviceSourceConfig.ts';`.
2. **Lint and type checks.** `bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json` all pass. The root type check covers `features/`.
3. **This issue's scenarios.** `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1045"` reports `24 scenarios (24 passed)`, none undefined. That count includes the feature-1043 scenarios tagged `@adw-1045`.
4. **The expectation no longer follows the implementation (mutation check).** Cross the two iOS titles in the implementation, run the two value scenarios, and restore the file:
   ```sh
   if git diff --quiet -- adws/core/deviceSourceConfig.ts; then
     perl -pi -e "s/iosDeviceType: 'iOS Device Type'/iosDeviceType: 'iOS Runtime'/; s/iosRuntime: 'iOS Runtime'/iosRuntime: 'iOS Device Type'/" adws/core/deviceSourceConfig.ts
     NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1045" --name "as it is written, without the HTML comments" --name "names all four resolve to the system image"
     echo "cucumber exit: $? (must be non-zero)"
     git checkout -- adws/core/deviceSourceConfig.ts
   fi
   git diff --exit-code -- adws/core/deviceSourceConfig.ts && echo "deviceSourceConfig.ts restored"
   ```
   - **Expected after the patch:**
     - `2 scenarios (2 failed)`;
     - the failing steps are `the project configuration names these device sources, and no other:` and `the device sources resolve to:`;
     - each shows a diff in which `iosDeviceType` holds `com.apple.CoreSimulator.SimRuntime.iOS-18-2`;
     - then `deviceSourceConfig.ts restored`.
   - **Before the patch** the same check prints `2 scenarios (2 passed)`. That is the defect.
   - **If it still passes after the patch,** the expectation still comes from the implementation: fix the helper. Never leave the mutation in place.
   - **Narrow runs with `--tags`/`--name` only, never `file:line` arguments.** cucumber-js 12 appends CLI paths to the config's `paths`, so a `file:line` run executes the whole suite.
5. **Zero regressions.** Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1043"`, then `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`. Both pass. Every cucumber run loads all step definitions, this helper included.

## Patch Scope
**Lines of code to change:** about 16, in one file (about 11 added, 5 removed).
**Risk level:** low. It is a step-definition helper that only `feature-1045-config.steps.ts` and `feature-1045-phase.steps.ts` import. No production code, `.feature` file or shared fixture changes.
**Testing required:**
- lint and both type checks;
- the 24 `@adw-1045` scenarios;
- the mutation check, which shows the two value-checking Then steps now fail when the parser reads a section into the wrong field;
- `@adw-1043` and `@regression`, for zero regressions.

Vitest only includes `adws/**/__tests__` and `test/mocks/__tests__`, so `bun run test:unit` cannot be affected.
