# Patch: Merge origin/dev and give the feature-1044 Givens the device sources `adw_init` writes

## Metadata
adwId: `g0m1dk-feat-adw-init-preser`
reviewChangeRequest: ``Issue #1: Step definition independence, features/per-issue/step_definitions/feature-1044-proof.steps.ts. The Given 'a workflow for issue {int} whose worktree holds the {string} that {string} writes for the application type {string}' breaks rule 4: it weakens what the step phrase promises. It fills the worktree's `.adw/` from `adwFilesWrittenFor` (feature-1044-prompt.ts), whose `.adw/project.md` holds only `## Application Type`. It leaves out `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime`, which step 3 of adw_init.md (this issue's own change) writes for `mobile:kotlincm`. On the branch's base nothing reads those sections, so the three scenario-proof scenarios pass without them: '…looks for step definitions under scenarios/src/test/kotlin…', '…runs the per-issue and the regression scenarios through the Gradle wrapper's :scenarios:test task…' and '…gives the per-issue scenario both screenshots as its images'. But origin/dev now holds #1045, merged as #1060 while this branch ran. Its scenario test phase throws `DeviceSourceConfigError` before running anything when one of these sections is missing. Its `AdwFiles` (feature-992-adw-files.ts) also gained a required `project` map that `adwFilesWrittenFor` does not fill. Once the branch takes dev, these steps no longer hold the `.adw/` that adw_init writes, and all three scenarios fail. Resolution: Merge origin/dev into the branch. Then change feature-1044-prompt.ts so that `adwFilesWrittenFor` also returns the `project` map, read from step 3 of adw_init.md the same way it already reads steps 2 and 8: each `## <device-source heading>` → `<value>` bullet gives that section the default adw_init writes when the owner has set none. The Given then holds the `.adw/` its phrase names. Change step definitions only, never the .feature file. The merge also needs two other changes. adws/__tests__/adwInitPrompt.mobile.test.ts must import `parseMarkdownSections` from `../core/markdownSections`, because dev no longer exports it from `../core/projectConfig`. The README test listing must be reconciled with dev's.``

## Issue Summary
**Original Spec:** `specs/issue-1044-adw-g0m1dk-feat-adw-init-preser-sdlc_planner-mobile-kotlincm-init-descriptors.md`

**Issue:** `adwFilesWrittenFor` (`features/per-issue/step_definitions/feature-1044-prompt.ts`) reads steps 2 and 8 of `adw_init.md` but not step 3. So the `.adw/project.md` behind the Given `a workflow for issue {int} whose worktree holds the {string} that {string} writes for the application type {string}` (`feature-1044-proof.steps.ts`) holds `## Application Type` but none of the four device-source sections that step 3 writes for `mobile:kotlincm`. The Given holds less than its phrase promises. `origin/dev` (now `d9c0b640`, the merge of #1060) makes the gap fatal:
- `executeScenarioTestPhase` calls `requireDeviceSource` before anything else. For a profile with platforms, it throws `DeviceSourceConfigError` when a section is missing or empty (`adws/phases/scenarioTestPhase.ts`, `adws/core/deviceSourceConfig.ts`).
- `AdwFiles` (`features/regression/step_definitions/feature-992-adw-files.ts`) now requires `project: Map<string, string>`, and `renderProjectMd` writes its sections after the description.

A dry run of the merge, in a throwaway clone, confirmed:
- There is exactly one conflict: `README.md`, two lines of the `adws/` tree listing.
- After the merge, `bunx tsc --noEmit` reports two errors:
  - TS2741: `project` is missing in `feature-1044-prompt.ts`.
  - TS2459: `parseMarkdownSections` is no longer exported from `../core/projectConfig` (`adwInitPrompt.mobile.test.ts:7`).

  The mobile prompt test fails with `parseMarkdownSections is not a function`.
- With an empty `project`, the scenarios of issues 104402, 104403 and 104404 fail at `When the workflow's scenario test phase runs` with `DeviceSourceConfigError: The device-source section "## Android System Image" is missing or empty in .adw/project.md…`.

**Solution:**
1. Merge `origin/dev`, reconcile the README listing with dev's lines, import `parseMarkdownSections` from `../core/markdownSections`, and conclude the merge.
2. Then make `adwFilesWrittenFor` also return `project`. It holds every section ADW reads the device sources from (`DEVICE_SOURCE_SECTION_TITLES`). Each one gets the value of its step-3 bullet `` - `## <heading>` → `<value>` ``, which is the default `adw_init` writes when the owner has set none. The file already reads steps 2 and 8 this way: `findBullet`, then the code span after the arrow.

The Given then holds the `.adw/` its phrase names. The scenario test phase's device-source gate passes because the prompt's defaults satisfy it, not because the step goes around it. The baseline Given (`feature-1044-baseline.steps.ts`) renders the same function, so its base branch's `.adw/project.md` gets the sections too. Only step definitions change: no `.feature` file, prompt or ADW source.

## Files to Modify
Use these files to implement the patch:

- `README.md`: conflict resolution only. Two lines of the `adws/` tree listing take dev's text.
- `adws/__tests__/adwInitPrompt.mobile.test.ts`: line 7, the module that `parseMarkdownSections` is imported from.
- `features/per-issue/step_definitions/feature-1044-prompt.ts`: `adwFilesWrittenFor` also returns `project`.

Accept the rest of the merge from `origin/dev` as is: 47 files, among them `adws/core/deviceSourceConfig.ts`, `adws/core/markdownSections.ts`, `adws/phases/scenarioTestPhase.ts` and `features/regression/step_definitions/feature-992-adw-files.ts`.

Do not change any of these:
- `features/per-issue/feature-1044.feature`;
- `feature-1044-proof.steps.ts`;
- `feature-1044-baseline.steps.ts`;
- `.claude/commands/adw_init.md`;
- any `adws/` source file.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Merge `origin/dev` and reconcile the README listing with dev's
- Run `git fetch origin`, then `git merge --no-edit origin/dev`.
  - At the time of writing, `origin/dev` is `d9c0b640`. If it has moved on, expect more incoming files and re-check the conflicts.
- Expect exactly one conflict: `README.md`, in two hunks of the `adws/` tree listing. In each hunk, HEAD's line has a trailing comment and dev's does not. Keep dev's line:
  - under `phases/__tests__/`: `│   │   ├── scenarioProofRun.helpers.ts` (drop `  # Shared helpers for the scenario-proof-run tests`);
  - under `proof/__tests__/`: `│   │   ├── proofAssembler.helpers.ts` (drop `  # Shared helpers for the proof-assembler tests`).
- Resolve one hunk at a time. Never run `git checkout --theirs README.md`: it would drop this issue's own README additions, which merge cleanly.
- `git diff origin/dev -- README.md` then shows only this issue's additions, 4 lines in all:
  - the paragraph that starts ``When the type is `mobile:kotlincm`, `adw_init` then writes…``, with its blank line, after `A value set by hand survives regeneration.`;
  - the listing lines `adwInitPrompt.helpers.ts  # Shared helpers for the adw_init prompt tests` and `adwInitPrompt.mobile.test.ts`.

### Step 2: Import `parseMarkdownSections` from its new module, and conclude the merge
- In `adws/__tests__/adwInitPrompt.mobile.test.ts`, change line 7 from `import { parseMarkdownSections } from '../core/projectConfig';` to `import { parseMarkdownSections } from '../core/markdownSections';`.
  - Dev moved the function to `adws/core/markdownSections.ts`. `projectConfig.ts` still imports it but no longer exports it.
  - Import the module directly, not through the `../core` barrel, as the file does for every other import.
  - The imports stay alphabetical, and the file stays at 293 lines.
- Run `git add README.md adws/__tests__/adwInitPrompt.mobile.test.ts`, then `git commit --no-edit`.
  - This concludes the merge with git's default message, `Merge remote-tracking branch 'origin/dev' into feature-issue-1044-mobile-kotlincm-init-descriptors`, as earlier dev merges of ADW branches did.
  - Leave Step 3's change uncommitted: the review-patch commit commits it.

### Step 3: Make `adwFilesWrittenFor` return the `project` map that step 3 of `adw_init.md` writes
In `features/per-issue/step_definitions/feature-1044-prompt.ts`:
- Below `import { REPO_ROOT } from '../../../adws/core/config.ts';`, add:
  ```ts
  import { DEVICE_SOURCE_SECTION_TITLES } from '../../../adws/core/deviceSourceConfig.ts';
  ```
- Directly after `function required(…) { … }`, add:
  ```ts
  /** The default step 3 writes for a device-source section the owner has not set: the code span after the arrow of the section's bullet. */
  function deviceSourceDefault(step3: readonly string[], heading: string): string {
    const [bullet] = findBullet(step3, `- \`## ${heading}\` →`, 'step 3');
    const value = ARROW_VALUE.exec(bullet)?.[1];
    assert.ok(value !== undefined, `Expected step 3 of adw_init.md to give "## ${heading}" a default`);
    return value;
  }

  /** Every device-source section ADW reads, with the default step 3 writes for it. */
  function deviceSourceDefaults(): Map<string, string> {
    const step3 = stepOf(3);
    return new Map(Object.values(DEVICE_SOURCE_SECTION_TITLES).map((heading): [string, string] => [heading, deviceSourceDefault(step3, heading)]));
  }
  ```
  - The search text ends in ` →`. It therefore finds the default bullet, `` - `## Android System Image` → `system-images;…` ``, and not the bullet above it that lists all four headings (`` - `## Android System Image`, `## Android Device Profile`, … ``).
  - The headings come from ADW's own table. If the prompt gives a section no default, the Given fails with a message that names the section; the section is never silently left out.
  - The map's keys are bare titles such as `Android System Image`, the form dev's `setEveryDeviceSource` uses. `renderProjectMd` adds the `## `.
- Change the docblock of `adwFilesWrittenFor` to `/** The files of ".adw/" the prompt has the agent write for a repository whose owner set the type by hand, and none of its device sources, and that has no manifest. */`.
- In the object it returns, add `project: deviceSourceDefaults(),` directly after `applicationType,`.
- Result: the rendered `.adw/project.md` ends with these four sections, and `resolveDeviceSource` reads them as `resolved`:

  | Section | Value |
  |---|---|
  | `## Android System Image` | `system-images;android-36;google_apis;arm64-v8a` |
  | `## Android Device Profile` | `pixel_8` |
  | `## iOS Device Type` | `com.apple.CoreSimulator.SimDeviceType.iPhone-16` |
  | `## iOS Runtime` | `com.apple.CoreSimulator.SimRuntime.iOS-26-0` |
- The file grows from 125 to 141 lines. Nothing else in it changes, and no other step file changes.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. Check the merge:
   - `git merge-base --is-ancestor origin/dev HEAD && echo INTEGRATED` prints `INTEGRATED`.
   - `git diff origin/dev --stat -- README.md` reports `1 file changed, 4 insertions(+)`.
   - `grep -n '^<<<<<<<\|^=======$\|^>>>>>>>' README.md` prints nothing.
2. Run the static checks:
   - `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` report no errors; TS2741 and TS2459 are gone.
   - `bun run lint`, `bun run build` and `bun run lint:branch-names` pass.
3. Run `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/adwInitPrompt.mobile.test.ts adws/__tests__/generateStepDefinitionsPrompt.test.ts adws/core/__tests__/deviceSourceConfig.test.ts adws/core/__tests__/projectConfigDeviceSource.test.ts adws/phases/__tests__/scenarioTestPhase.deviceSource.test.ts`, then `bun run test:unit`. Everything is green.
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044"` reports `7 scenarios (7 passed)`, with no undefined or ambiguous step.
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression or @adw-1045 or @adw-1046"` reports zero failures.

## Patch Scope
**Lines of code to change:** about 19 by hand: 16 in `feature-1044-prompt.ts`, 1 in `adwInitPrompt.mobile.test.ts` and 2 README lines in the conflict resolution. The merge brings dev's 47 files unchanged.
**Risk level:** low. The merge has one mechanical conflict, and the code change is in a step-definition helper that only feature-1044's steps import.
**Testing required:** the commands above. A dry run of exactly these changes, in a throwaway clone, passed these checks:
- both type checks, lint, build and `lint:branch-names`;
- the full unit suite: 292 files, 5006 tests;
- `@adw-1044`: 7 scenarios, all passing. With `project` left empty, the three scenario-proof scenarios failed on `DeviceSourceConfigError`, so the gate really runs;
- `@regression`: 369 scenarios, all passing; the `@adw-1045` and `@adw-1046` scenarios passed too.
