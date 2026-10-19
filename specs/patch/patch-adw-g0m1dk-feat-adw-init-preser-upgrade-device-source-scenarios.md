# Patch: The upgrade scenarios check the four device-source sections the `/adw_init` agent writes as `adw_init.md` tells it

## Metadata
adwId: `g0m1dk-feat-adw-init-preser`
reviewChangeRequest: ``Issue #3: The scenario 'The framework upgrade of a repository whose owner set mobile:kotlincm and its device sources by hand in .adw/project.md runs the /adw_init agent in a worktree that holds them…' would still pass with the change reverted. No other @adw-1044 scenario tests acceptance criterion 4 (PRD stories 24–25): `.adw/project.md` gets the four device-source sections, with defaults when absent, and keeps existing values on upgrade. The scenario's Then steps check only four things: the stubbed agent's worktree held the default branch's project.md; the upgrade commits; ADW reads back the `mobile:kotlincm` that the stub itself wrote; and no Playwright project is installed. All of that worked before this branch. The stub never reads adw_init.md, and its regen commit holds none of the owner's device sources, yet the scenario passes. Resolution: Add @adw-1044 scenarios, or rewrite this scenario's Then steps, so that they check the device-source sections in the `.adw/project.md` that adw_init writes for a hand-set `mobile:kotlincm`, in the issue's terms. With no device source set, each of `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime` holds its default. With the owner's values (as in this scenario's docstring), each keeps the owner's value. Each scenario must fail with the adw_init.md change reverted.``

## Issue Summary
**Original Spec:** `specs/issue-1044-adw-g0m1dk-feat-adw-init-preser-sdlc_planner-mobile-kotlincm-init-descriptors.md`

**Issue:** The upgrade scenario, the second scenario of `features/per-issue/feature-1044.feature`, cannot see acceptance criterion 4, and no other `@adw-1044` scenario tests it.
- Its stub Given is G-WP6, `the {string} agent writes a complete ADW configuration whose {string} declares the application type {string}` (`feature-991-upgrade.steps.ts`). It hands feature-931's stub a fixed `.adw/project.md`: `projectMd(applicationType)` from `feature-991-project-md.ts`, which holds an overview, `## Application Type` and framework notes.
- The stub (`runAdwInitStub` in `feature-931.steps.ts`) writes that text whatever its worktree holds. It never reads `adw_init.md` and never looks at the owner's `.adw/project.md`. So the regen commit holds none of the four device-source sections, and no Then looks for them.
- A run in a throwaway clone of this working tree confirmed it. With `.claude/commands/adw_init.md` replaced by `origin/dev`'s, the scenario still passed: `1 scenario (1 passed)`, `11 steps (11 passed)`.

**Solution:** Make the stubbed agent follow step 3 of `adw_init.md`, and check what it writes against values written in the scenarios.
- **The stub.** A new Given configures the stub to write the `.adw/project.md` that step 3 tells the agent to write over the `.adw/project.md` it finds in its worktree:
  - Step 3 must have the bullet that names all four device-source sections.
  - A section keeps the owner's value only when that bullet says `preserve the value verbatim`.
  - Otherwise the section gets the default from the bullet's `` `## <heading>` → `<value>` `` line.
- **The Then.** A new Then reads the regen commit's `.adw/project.md` with `parseDeviceSourceSections`, the parser `loadProjectConfig` uses to fill `ProjectConfig.deviceSources`. It compares all four sections with the scenario's table.
- **The scenarios.**
  - The existing upgrade scenario takes the new Given, and a Then with the owner's four values from its docstring.
  - A new scenario, whose owner set the type and no device source, checks the four defaults.
  - The expected values are written in the scenarios. No step reads them from the prompt.
- **The harness.** Today feature-931's stub takes only a fixed string, decided before the upgrade runs. Its `projectMd` may now also be a function of the `.adw/` files the agent found. `recordInitRun` already reads those files at the start of each run, before the stub writes anything; it now returns them.

What the throwaway clone showed, with every step below applied:
- Both upgrade scenarios pass.
- With `adw_init.md` replaced by `origin/dev`'s, both fail at the When: `Expected step 3 of adw_init.md to have a bullet that names every device-source section: Android System Image, Android Device Profile, iOS Device Type, iOS Runtime`.
- With only the `preserve the value verbatim` line removed, the owner's-values scenario fails at the new Then, which reads the four defaults instead of the owner's values. The defaults scenario passes.
- With only the four default lines removed, the defaults scenario fails and the owner's-values scenario passes.

Rejected alternatives:
- **Keep the G-WP6 stub and change only the Thens.** Nothing in its regen commit comes from `adw_init.md`, so no Then can observe the prompt.
- **Keep the old scenario as it is and only add new ones.** The old one would still pass with the change reverted.
- **Build the stub's file in the Given, from the default branch's `.adw/project.md`.** The agent would then not read its own worktree, and the step would do less than its phrase promises (review rule 4).
- **Keep the owner's values whatever the prompt says, and read only the defaults from it.** The owner's-values scenario never needs a default, so it would still pass with the change reverted.
- **Read the expected defaults from `adw_init.md` in the Then.** The expectation would then come from the code under test (review rule 3).

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/feature-1044.feature`: the upgrade scenario's title, its stub Given and a new Then, plus a new defaults scenario directly after it. The other six scenarios stay as they are.
- `features/per-issue/step_definitions/feature-1044-framework.steps.ts`: the new Given and Then, their imports, and the header comment.
- `features/per-issue/step_definitions/feature-1044-prompt.ts`: reads step 3's device-source rules and exports `projectMdWrittenOver`.
  - The working tree already holds an uncommitted change to this file from Issue #1's patch: `deviceSourceDefault`, `deviceSourceDefaults` and `project: deviceSourceDefaults()`.
  - This patch replaces the two functions and keeps the rest of that change.
- `features/regression/step_definitions/feature-931.steps.ts`: the stub's `projectMd` may be a function of the files the agent found. The file stays at 299 lines.
- `features/regression/step_definitions/feature-931-init-runs.ts`: `recordInitRun` returns what it recorded.
- `features/regression/step_definitions/feature-992-adw-files.ts`: `renderProjectMd` takes only the type and the sections it renders.

Do not change any of these:
- `.claude/commands/adw_init.md`, or any file under `adws/`;
- `features/regression/vocabulary.md`: no regression phrase is added or changed;
- `feature-991-*.ts`, `feature-1044-baseline.steps.ts`, `feature-1044-proof.steps.ts` or `feature-1044-world.ts`;
- any other `.feature` file.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Let feature-931's stub write a `.adw/project.md` made from what it found in its worktree
- **`features/regression/step_definitions/feature-931-init-runs.ts`**
  - Make the signature `export function recordInitRun(worktreePath: string): AdwFilesFound`, and add `return found;` after `runsByWorktree.set(…)`.
  - Add the docblock `/** Records what the agent found in its worktree, and returns it. */`.
- **`features/regression/step_definitions/feature-931.steps.ts`**
  - Import `{ recordInitRun, type AdwFilesFound }` from `./feature-931-init-runs.ts`.
  - In `AdwInitAgent`, write the field as `projectMd: string | ((found: AdwFilesFound) => string) | null;`, with the docblock `/** What the stub writes as ".adw/project.md", or makes of the ".adw/" files it found in its worktree; null leaves it the text every regenerated file gets. */`.
  - Make the signature `regeneratedContent(file: string, found: AdwFilesFound)`. Keep its first line a single guarded return, so that the file stays at 299 lines (`.adw/coding_guidelines.md`: files under 300 lines):
    ```ts
    if (file === 'project.md' && w.agent?.projectMd) return typeof w.agent.projectMd === 'function' ? w.agent.projectMd(found) : w.agent.projectMd;
    ```
  - `runAdwInitStub` starts with `const found = recordInitRun(params.worktreePath);` and writes `regeneratedContent(file, found)`. `found` is read before the stub writes anything, so it holds the owner's file.
  - Change `configureAdwInitAgent`'s docblock and signature to these lines, and keep its body:
    ```ts
    /** Configures the stubbed "/adw_init" agent, which writes `projectMd` as the repository's ".adw/project.md" (or what `projectMd` makes of the ".adw/" files it found), and `extraFiles` besides. */
    export function configureAdwInitAgent(command: string, projectMd: string | ((found: AdwFilesFound) => string), extraFiles: Readonly<Record<string, string>> = {}): void {
    ```
  - Every existing caller passes a string, so G-WP6, G-WP7, G-WP8 and G-WP21 behave as before.
- **`features/regression/step_definitions/feature-992-adw-files.ts`**
  - Make the signature `export function renderProjectMd(files: Pick<AdwFiles, 'applicationType' | 'project'>): string`.
  - The function reads only those two fields. Its callers pass a full `AdwFiles`, which still fits.

### Step 2: Read step 3's device-source rules in `feature-1044-prompt.ts`
- Imports:
  - After the `deviceSourceConfig.ts` import, add `import { parseMarkdownSections, sectionValue } from '../../../adws/core/markdownSections.ts';`.
  - Change `import type { AdwFiles } from '../../regression/step_definitions/feature-992-adw-files.ts';` to `import { renderProjectMd, type AdwFiles } from '../../regression/step_definitions/feature-992-adw-files.ts';`.
- After `SECTION_BULLET`, add:
  ```ts
  const DEVICE_SOURCE_HEADINGS = Object.values(DEVICE_SOURCE_SECTION_TITLES);
  const PRESERVE_VALUE = 'preserve the value verbatim';
  ```
- Replace `deviceSourceDefault(step3, heading)` and `deviceSourceDefaults()` with:
  ```ts
  /** Step 3's bullet on the device sources, with the lines nested under it: the one that names every section ADW reads them from. */
  function deviceSourceBullet(): string[] {
    const step3 = stepOf(3);
    const index = step3.findIndex(line => DEVICE_SOURCE_HEADINGS.every(heading => line.includes(`\`## ${heading}\``)));
    assert.ok(index >= 0, `Expected step 3 of adw_init.md to have a bullet that names every device-source section: ${DEVICE_SOURCE_HEADINGS.join(', ')}`);
    return bulletAt(step3, index);
  }

  /** The default the bullet gives a device-source section the owner has not set: the code span after the arrow of the section's line. */
  function deviceSourceDefault(bullet: readonly string[], heading: string): string {
    const [line] = findBullet(bullet, `- \`## ${heading}\` →`, 'step 3');
    const value = ARROW_VALUE.exec(line)?.[1];
    assert.ok(value !== undefined, `Expected step 3 of adw_init.md to give "## ${heading}" a default`);
    return value;
  }

  /** Every device-source section ADW reads, as step 3 has the agent write it over the ".adw/project.md" it found: the value the owner set, where the bullet says to preserve it, or else the default. */
  function deviceSourcesWrittenOver(found: string): Map<string, string> {
    const bullet = deviceSourceBullet();
    const preserves = bullet.some(line => line.includes(PRESERVE_VALUE));
    const owner = parseMarkdownSections(found);
    return new Map(DEVICE_SOURCE_HEADINGS.map((heading): [string, string] => [heading, (preserves ? sectionValue(owner, heading) : null) ?? deviceSourceDefault(bullet, heading)]));
  }

  /** The ".adw/project.md" the prompt has the agent write, over the one it found in its worktree, for a repository whose owner set the type by hand. */
  export function projectMdWrittenOver(applicationType: string, found: string): string {
    assert.strictEqual(applicationType, MOBILE, `The prompt's descriptors are read for "${MOBILE}" only`);
    return renderProjectMd({ applicationType, project: deviceSourcesWrittenOver(found) });
  }
  ```
- In `adwFilesWrittenFor`, change `project: deviceSourceDefaults(),` to `project: deviceSourcesWrittenOver(''),`. The proof and baseline Givens still get the four defaults, because their owner set no device source. Keep the docblock of `adwFilesWrittenFor` as it is.
- Why the code reads the prompt this way:
  - The bullet is the one line of step 3 that names all four headings. A default line names only one, so it is never taken for the bullet.
  - The preserve rule is looked for inside that bullet only. The `## Application Type` rule says `preserve it verbatim`, not `the value`.
  - `sectionValue` reads the owner's value as ADW does: trimmed, with comments stripped, and `null` when the section is empty.
  - In `origin/dev`'s `adw_init.md`, step 3 has no such bullet, so `deviceSourceBullet` fails with a message that names the four sections.

### Step 3: Add the Given and the Then to `feature-1044-framework.steps.ts`
- Imports:
  - Change the `@cucumber/cucumber` import to `{ Given, Then, When, type DataTable }`.
  - Add `import { DEVICE_SOURCE_SECTION_TITLES, parseDeviceSourceSections } from '../../../adws/core/deviceSourceConfig.ts';` before the feature-931 imports.
  - Change the feature-931 import to `{ configureAdwInitAgent, git, regenCommitFile, upgradeWorld }`.
  - Add `import { assertProjectMdFile } from '../../regression/step_definitions/feature-991-project-md.ts';`.
  - After a blank line, add `import { projectMdWrittenOver } from './feature-1044-prompt.ts';`.
- Replace the header comment with:
  ```ts
  /**
   * Framework scenarios of feature-1044: a command of the fixture framework (copied from the framework under test by
   * feature-992, hashed by feature-537's steps) that a scenario edits; the worktree the upgrade runs the "/adw_init" agent in; the
   * ".adw/project.md" that agent writes, as its command tells it to, over the one it found there; and the device sources ADW reads
   * from the regen commit (the upgrade and its stubbed agent are feature-931's).
   */
  ```
- At the end of the file, add:
  ```ts
  Given(
    'the {string} agent writes a complete ADW configuration whose {string} declares the application type {string} and has the device-source sections the {string} command tells it to write',
    function (command: string, file: string, applicationType: string, prompt: string) {
      assertProjectMdFile(file);
      assert.strictEqual(prompt, command, `The "${command}" agent runs its own command`);
      configureAdwInitAgent(command, found => projectMdWrittenOver(applicationType, found[file] ?? ''));
    },
  );

  Then("ADW reads these device sources from the regen commit's {string}:", function (file: string, table: DataTable) {
    assertProjectMdFile(file);
    const read = parseDeviceSourceSections(regenCommitFile(file));
    const sections = Object.entries(DEVICE_SOURCE_SECTION_TITLES) as [keyof typeof read, string][];
    const actual = sections.map(([key, title]) => ({ section: `## ${title}`, value: read[key] }));
    assert.deepStrictEqual(actual, table.hashes(), `Expected ADW to read each device-source section from the regen commit's "${file}" as the table has it`);
  });
  ```
- How the two steps work:
  - The Given is longer than G-WP6 and G-WP21, and Cucumber expressions match a whole step, so no step text matches two definitions.
  - The stub's project.md declares the type through `projectMd(applicationType)`, as G-WP6's does. It adds only the four sections that `projectMdWrittenOver` derives.
  - The Then compares all four sections ADW reads, in ADW's order. A table that leaves a section out, or a section that is missing or empty in the commit (`null`), fails the step.

### Step 4: Rewrite the upgrade scenario and add the defaults scenario in `feature-1044.feature`
- In the upgrade scenario (the second scenario):
  - Replace the title with: `The framework upgrade of a repository whose owner set "mobile:kotlincm" and its device sources by hand in ".adw/project.md" runs the "/adw_init" agent in a worktree that holds them, commits an ".adw/project.md" in which each of the four device-source sections keeps the value the owner set, installs no Playwright project, and ADW reads "mobile:kotlincm" from the regen commit`.
  - Replace the Given `And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "mobile:kotlincm"` with `And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "mobile:kotlincm" and has the device-source sections the "/adw_init" command tells it to write`.
  - Directly after `And ADW reads the application type "mobile:kotlincm" from the regen commit's ".adw/project.md"`, add:
    ```gherkin
        And ADW reads these device sources from the regen commit's ".adw/project.md":
          | section                   | value                                           |
          | ## Android System Image   | system-images;android-34;google_apis;arm64-v8a  |
          | ## Android Device Profile | pixel_7                                         |
          | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-15 |
          | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-17-5     |
    ```
  - Leave the docstring and every other step as they are.
- Directly after that scenario, before the baseline scenario's tags, add:
  ```gherkin
    @adw-1044 @adw-g0m1dk-feat-adw-init-preser
    Scenario: The framework upgrade of a repository whose owner set "mobile:kotlincm" by hand in ".adw/project.md", and none of its device sources, commits an ".adw/project.md" in which each of the four device-source sections holds its default
      Given a target repository initialised by an older framework version
      And the target repository's default branch has this ".adw/project.md":
        """
        # Project

        ## Application Type
        mobile:kotlincm
        """
      And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "mobile:kotlincm" and has the device-source sections the "/adw_init" command tells it to write
      When the framework upgrade regenerates the target repository's ADW configuration
      Then the upgrade commits the regenerated configuration
      And ADW reads these device sources from the regen commit's ".adw/project.md":
        | section                   | value                                           |
        | ## Android System Image   | system-images;android-36;google_apis;arm64-v8a  |
        | ## Android Device Profile | pixel_8                                         |
        | ## iOS Device Type        | com.apple.CoreSimulator.SimDeviceType.iPhone-16 |
        | ## iOS Runtime            | com.apple.CoreSimulator.SimRuntime.iOS-26-0     |
  ```
- The defaults are the ones the spec's "Device-source defaults" table gives (PRD story 24).
- Feature-931's `Before` and `After` hooks already include `@adw-1044`, so the new scenario gets a fresh upgrade world.
- Leave all changes uncommitted: the review-patch commit commits them, together with Issue #1's change to `feature-1044-prompt.ts`.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. Check the scope:
   - `git diff HEAD --stat` lists exactly the six files under `Files to Modify`.
   - `git diff --quiet HEAD -- .claude/commands/adw_init.md adws && echo untouched` prints `untouched`.
   - `wc -l features/regression/step_definitions/feature-931.steps.ts` prints 299, and every changed file is under 300 lines.
2. Run the static checks. `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build` and `bun run lint:branch-names` all pass.
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044"` reports `8 scenarios (8 passed)` and `62 steps (62 passed)`, with no undefined or ambiguous step.
4. Check that both upgrade scenarios fail with the `adw_init.md` change reverted. Run this from the worktree's root, while no other Cucumber run is using the worktree:
   ```sh
   git show origin/dev:.claude/commands/adw_init.md > .claude/commands/adw_init.md
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044" --name "The framework upgrade of a repository"
   git checkout HEAD -- .claude/commands/adw_init.md
   git diff --quiet HEAD -- .claude/commands/adw_init.md && echo restored
   ```
   - The Cucumber run reports `2 scenarios (2 failed)`.
   - Each scenario fails at `When the framework upgrade regenerates the target repository's ADW configuration` with `Expected step 3 of adw_init.md to have a bullet that names every device-source section`.
   - The last line prints `restored`.
5. Check the other callers of the changed stub, and the rest of the suite. Each of these reports zero failures:
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: feature-992's upgrade scenarios (G-WP6, G-WP8 and G-WP21 under `@web-playwright-project`), and everything else;
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-991"`: feature-991's upgrade scenarios, which stub the agent with G-WP6 and G-WP7;
   - `bun run test:unit`.

## Patch Scope
**Lines of code to change:** about 96 added and 27 removed, in six files:

| File | Added | Removed |
|---|---|---|
| `feature-1044.feature` | 28 | 2 |
| `feature-1044-framework.steps.ts` | 26 | 4 |
| `feature-1044-prompt.ts` (against the working tree) | 29 | 10 |
| `feature-931.steps.ts` | 9 | 9 |
| `feature-931-init-runs.ts` | 3 | 1 |
| `feature-992-adw-files.ts` | 1 | 1 |

**Risk level:** low.
- Only BDD step definitions and one per-issue `.feature` file change.
- The feature-931 change accepts every existing caller as it is, and the runs of Validation item 5 cover all of them.

**Testing required:** the commands above. They were run in a throwaway clone of this working tree: merge `562c7eaf`, plus Issue #1's uncommitted change, plus Steps 1–4.
- Item 1: the six files changed, `adw_init.md` and `adws/` were untouched, and `feature-931.steps.ts` had 299 lines.
- Item 2: both type checks, lint, build and `lint:branch-names` passed.
- Item 3: `8 scenarios (8 passed)`, `62 steps (62 passed)`.
- Item 4: `2 scenarios (2 failed)`, both at the When with the message above. The partial reverts gave the results listed under Issue Summary.
- Item 5:
  - `@regression`: `369 scenarios (369 passed)`, `2619 steps (2619 passed)`.
    - The cron scenarios of feature-932 and feature-959 read `owner/repo` from the checkout's `origin` URL.
    - So the clone's `origin` had to be set to the GitHub URL first. The worktree already has that URL.
  - `@adw-991`: `22 scenarios (22 passed)`, `123 steps (123 passed)`.
  - `bun run test:unit`: 292 files and 5006 tests passed.
