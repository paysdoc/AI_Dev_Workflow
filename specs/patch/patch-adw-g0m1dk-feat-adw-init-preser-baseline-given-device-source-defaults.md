# Patch: The baseline Given commits the device sources `adw_init` writes, through the shared `adwFilesWrittenFor`

## Metadata
adwId: `g0m1dk-feat-adw-init-preser`
reviewChangeRequest: ``Issue #2: Step definition independence, features/per-issue/step_definitions/feature-1044-baseline.steps.ts. The Given 'a target repository whose default branch {string} holds the {string} that {string} writes for the application type {string}, and no manifest and no Gradle wrapper yet' breaks rule 4 the same way. The `.adw/project.md` it commits to the base branch comes from `adwFilesWrittenFor` and holds none of the four device-source sections adw_init writes for `mobile:kotlincm`. So the baseline scenario 'The bootstrap issue of a mobile:kotlincm repository is not parked by the baseline…' does not run on the `.adw/` its step names. After the merge with origin/dev, `renderAdwFiles` also reads the `project` map that `adwFilesWrittenFor` leaves out. Resolution: Apply the same fix as for feature-1044-proof.steps.ts. Once `adwFilesWrittenFor` in feature-1044-prompt.ts fills `project` with the device-source values from step 3 of adw_init.md, this Given commits the `.adw/` its phrase names. Change step definitions only, never the .feature file.``

## Issue Summary
**Original Spec:** `specs/issue-1044-adw-g0m1dk-feat-adw-init-preser-sdlc_planner-mobile-kotlincm-init-descriptors.md`

**Issue:** The Given `a target repository whose default branch {string} holds the {string} that {string} writes for the application type {string}, and no manifest and no Gradle wrapper yet` is at `feature-1044-baseline.steps.ts:22-31`.
- It commits `renderAdwFiles(adwFilesWrittenFor(applicationType))` to `dev` (line 29). The files go through `s.repositoryFiles`, which `buildTarget` writes just before its commit (`feature-990-target.ts:121-126` and `158-159`).
- If `adwFilesWrittenFor` returns no `project` map, that `.adw/project.md` holds only `## Project Overview`, `## Application Type` and `## Framework Notes`. None of the four device-source sections that step 3 of `adw_init.md` writes for `mobile:kotlincm` is there, so the Given holds less than its phrase promises (rule 4).

The scenario's Thens cannot see the gap: they stop at the baseline, the plan phase and the park comments. A control run of the baseline scenario confirmed this.
- **How it was run:** a throwaway `AfterStep` hook, kept outside the repository, stripped the four sections from what the Given commits.
- **What happened:**
  - The scenario still passed (`1 scenario (1 passed)`).
  - The `adwSdlc` run behind it got through the baseline, the plan, the build and the unit tests.
  - It then failed at the scenario test phase's device-source gate (`adws/phases/scenarioTestPhase.ts:142-147` and `171`). The log says `Scenario test phase failed before running anything: The device-source section "## Android System Image" is missing or empty in .adw/project.md…`, then `sdlc-orchestrator workflow failed: DeviceSourceConfigError…`.

**Solution:** The fix for Issue #1 also fixes this Given.
- `adwFilesWrittenFor` (`feature-1044-prompt.ts`) now returns `project: deviceSourceDefaults()`: each section of `DEVICE_SOURCE_SECTION_TITLES`, with the default its step-3 bullet writes when the owner has set none. Both feature-1044 Givens build their `.adw/` from that function, and nothing else calls it.
- The change is already in the working tree, uncommitted, from Step 3 of `specs/patch/patch-adw-g0m1dk-feat-adw-init-preser-merge-dev-device-source-defaults.md`.
- With it, the base branch's `.adw/project.md` ends with the four sections, and the same run gets past the gate: `Scenario test phase PASSED`, then review and document.

The baseline Given therefore needs no change of its own. This patch confirms the shared change is there, and applies it if it is not. It leaves the baseline file, the `.feature` file and every other file as they are, then validates.

Two alternatives were rejected:
- Calling feature-992's `setEveryDeviceSource` in the baseline Given writes that fixture's sample values (`android-35`, `iOS-18-2`), not the defaults `adw_init.md` writes (`android-36`, `iOS-26-0`). The Given would still not hold the `.adw/` its phrase names.
- Hard-coding the defaults in the step copies the prompt instead of reading it.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-1044-prompt.ts`: the one file the fix needs. It already holds the change from Issue #1's patch: 17 insertions and 1 deletion against `HEAD`. This patch adds nothing to it. It only confirms the change is there, and applies it if it is not.

Do not change any of these:
- `features/per-issue/step_definitions/feature-1044-baseline.steps.ts`;
- `features/per-issue/feature-1044.feature`;
- `features/per-issue/step_definitions/feature-1044-proof.steps.ts`;
- `features/per-issue/step_definitions/feature-990-target.ts`;
- `features/regression/step_definitions/feature-992-adw-files.ts`;
- `.claude/commands/adw_init.md`;
- any `adws/` source file.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm that `adwFilesWrittenFor` fills `project` with the defaults step 3 writes, and apply Issue #1's change if it does not
- `git diff HEAD --stat` lists one file, `feature-1044-prompt.ts`, with `1 file changed, 17 insertions(+), 1 deletion(-)`. That file's diff holds exactly these four changes:
  - the import `import { DEVICE_SOURCE_SECTION_TITLES } from '../../../adws/core/deviceSourceConfig.ts';` (line 12);
  - the functions `deviceSourceDefault(step3, heading)` and `deviceSourceDefaults()`, directly after `required` (lines 102-114);
  - the docblock `/** The files of ".adw/" the prompt has the agent write for a repository whose owner set the type by hand, and none of its device sources, and that has no manifest. */` (line 116);
  - `project: deviceSourceDefaults(),` directly after `applicationType,` in the returned object (line 124).
- If any of the four is missing, apply Step 3 of `specs/patch/patch-adw-g0m1dk-feat-adw-init-preser-merge-dev-device-source-defaults.md` verbatim.
  - Do not write a second reader of step 3.
  - Do not hard-code the defaults anywhere. Both Givens read them from `adw_init.md`.
- Leave the change uncommitted: the review-patch commit commits it.

### Step 2: Keep the baseline Given as it is, and check what it commits
- Make no edit to `feature-1044-baseline.steps.ts`. Its Given already commits what `adwFilesWrittenFor(applicationType)` renders (line 29).
- With Step 1 in place, the `.adw/project.md` it commits to `dev` ends with these four sections, after `## Framework Notes`:

  | Section | Value |
  |---|---|
  | `## Android System Image` | `system-images;android-36;google_apis;arm64-v8a` |
  | `## Android Device Profile` | `pixel_8` |
  | `## iOS Device Type` | `com.apple.CoreSimulator.SimDeviceType.iPhone-16` |
  | `## iOS Runtime` | `com.apple.CoreSimulator.SimRuntime.iOS-26-0` |
- Check it with item 2 of `Validation`. That command renders the file the Given commits and reads it with ADW's own `parseDeviceSourceSections` and `resolveDeviceSource`.
- Do not add any of these to the baseline file: a step, a hook, a `setEveryDeviceSource` call or a `freshAdwFiles` call. Do not change any Then.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. Check the scope:
   - `git diff HEAD --stat` lists only `feature-1044-prompt.ts`, with `1 file changed, 17 insertions(+), 1 deletion(-)`.
   - `git diff HEAD -- features/per-issue/feature-1044.feature features/per-issue/step_definitions/feature-1044-baseline.steps.ts features/per-issue/step_definitions/feature-1044-proof.steps.ts` prints nothing.
2. Check that the `.adw/project.md` the baseline Given commits holds the four device sources. Run this from the worktree's root:
   ```sh
   bun -e "
   import { parseDeviceSourceSections, resolveDeviceSource } from './adws/core/deviceSourceConfig.ts';
   import { renderAdwFiles } from './features/regression/step_definitions/feature-992-adw-files.ts';
   import { adwFilesWrittenFor } from './features/per-issue/step_definitions/feature-1044-prompt.ts';
   const projectMd = renderAdwFiles(adwFilesWrittenFor('mobile:kotlincm'))['.adw/project.md'];
   console.log(JSON.stringify(resolveDeviceSource(parseDeviceSourceSections(projectMd), ['android', 'ios'])));
   "
   ```
   It prints `{"kind":"resolved","deviceSource":{"androidSystemImage":"system-images;android-36;google_apis;arm64-v8a","androidDeviceProfile":"pixel_8","iosDeviceType":"com.apple.CoreSimulator.SimDeviceType.iPhone-16","iosRuntime":"com.apple.CoreSimulator.SimRuntime.iOS-26-0"}}`.
3. Run the static checks. `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build` and `bun run lint:branch-names` all pass.
4. Run the unit tests: `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/adwInitPrompt.mobile.test.ts adws/__tests__/generateStepDefinitionsPrompt.test.ts`, then `bun run test:unit`. Everything is green.
5. Run the scenarios:
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044"` reports `7 scenarios (7 passed)`, with no undefined or ambiguous step.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` reports zero failures.

## Patch Scope
**Lines of code to change:** none beyond Issue #1's patch. The fix is the 17 inserted lines and 1 changed line in `feature-1044-prompt.ts` that Issue #1's patch made, and both Givens share them. `feature-1044-baseline.steps.ts` stays at 58 lines.
**Risk level:** low. This patch changes nothing new. Only the two feature-1044 step files import the shared helper.
**Testing required:** the commands above. They were run on this working tree: merge `562c7eaf` plus Issue #1's uncommitted change.
- Item 1 holds, and item 2 printed `"kind":"resolved"` with the four step-3 defaults.
- Item 3: both type checks, lint, build and `lint:branch-names` passed.
- Item 4: the full unit suite passed, 292 files and 5006 tests.
- Item 5, `@adw-1044`: 7 scenarios and 54 steps passed.
  - In the baseline scenario, a throwaway `After` hook kept outside the repository ran `git show dev:.adw/project.md` in the target repository. The file holds the four sections.
  - That run's execution log shows `Scenario test phase PASSED`, then review and document.
- Item 5, `@regression`: 369 scenarios and 2619 steps passed.
- The control run (Issue Summary) proves the gate really runs. Without the four sections, the same scenario passed, but its workflow failed with `DeviceSourceConfigError`.
