# Patch: An `@adw-1044` scenario checks the device note in the command the step-definition phase starts the generator with

## Metadata
adwId: `g0m1dk-feat-adw-init-preser`
reviewChangeRequest: ``Issue #5: No @adw-1044 scenario exercises the descriptor-mode note of generate_step_definitions.md (acceptance criterion 5). The note applies to a repository whose `.adw/scenarios.md` has a `## Scenario Run Contract`, and names `ADW_ANDROID_SERIAL`, `ADW_IOS_UDID`, `ADW_PROOF_DIR` and the `android/` and `ios/` screenshot directories. No step reads or drives the step-definition prompt, so every scenario passes with that edit reverted. Resolution: Add an @adw-1044 scenario for a `mobile:kotlincm` repository whose `.adw/` is what adw_init writes. Its step-definition phase starts the generator in descriptor mode. Assert that the command the generator is started with tells the step definitions three things: drive the devices named by `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`; never create, boot, shut down or delete a device; and write each screenshot under `android/` or `ios/` in `ADW_PROOF_DIR`.``

## Issue Summary
**Original Spec:** `specs/issue-1044-adw-g0m1dk-feat-adw-init-preser-sdlc_planner-mobile-kotlincm-init-descriptors.md`

**Issue:** No scenario proves acceptance criterion 5.
- The descriptor-mode note is the `descriptor` bullet of `## Runner mode` in `.claude/commands/generate_step_definitions.md:18-21`.
  - It applies "When `.adw/scenarios.md` has a `## Scenario Run Contract` section".
  - Its three nested lines name `ADW_ANDROID_SERIAL`, `ADW_IOS_UDID`, `ADW_PROOF_DIR`, `android/` and `ios/`.
- No step definition under `features/` reads `generate_step_definitions.md`.
  - The nine `@adw-1044` scenarios read `adw_init.md` (through `feature-1044-prompt.ts`) and run ADW's phases. None of their steps looks at the step-definition generator or the command it is started with.
  - Feature-1043's scenario for issue 104311 runs the step-definition phase. But its `.adw/` comes from `freshAdwFiles`, which writes no contract, and it checks only the mode argument.
- So every scenario passes with `generate_step_definitions.md` as `origin/dev` has it. Only `generateStepDefinitionsPrompt.test.ts` pins the note, and unit tests never stand in for scenario proof (`.adw/coding_guidelines.md`, "Testing").

**Solution:** Add one scenario with three new Thens in a new step file, and export three existing helpers.
- **The workflow.** The Given is the existing `a workflow for issue {int} whose worktree holds the {string} that {string} writes for the application type {string}`.
  - Through `adwFilesWrittenFor`, the worktree's `.adw/scenarios.md` gets the `## Scenario Run Contract` that step 8 of `adw_init.md` writes for `mobile:kotlincm`.
  - Its `.adw/project.md` gets the device-source defaults of step 3.
- **The phase.** The When is feature-992's W-WP4, `the workflow's step-definition phase runs`. It does four things:
  - writes that `.adw/` into the worktree and loads it;
  - sets the `mobile:kotlincm` profile;
  - points `CLAUDE_CODE_PATH` at feature-929's throwaway CLI;
  - runs the real `executeStepDefPhase`.

  The phase starts the generator with `/generate_step_definitions '<issue>' '<adwId>' '<runner mode>'` (`adws/agents/stepDefAgent.ts:69`, `adws/agents/claudeAgent.ts:89-96`). The throwaway CLI records that prompt.
- **The existing Thens.** T-WP16 and T-WP18 check that the generator was started once, for the issue, in `descriptor` mode.
- **The command the generator is started with.**
  - The generator runs in the worktree and loads its slash command from the worktree's `.claude/commands/`.
  - For a target repository, `initializeWorkflow` copies the framework's command files there. It calls `copyClaudeAssetsToWorktree(worktreePath, gitCtx)` at `adws/phases/workflowInit.ts:287` and `:309`, and `frameworkRepoRoot` defaults to `REPO_ROOT` (`adws/phases/worktreeSetup.ts:223-227`).
  - So the new steps read `<REPO_ROOT>/.claude/commands/<command>.md` for the recorded slash command. Within it they take the `## Runner mode` bullet of the recorded mode, and its nested lines.
- **The note applies to this worktree.** Before it checks anything else, every new Then asserts two things:
  - the mode's bullet names `` `## Scenario Run Contract` ``;
  - the worktree's `.adw/scenarios.md` has that section, and it is not empty.
- **The three new Thens.** Each looks for one line nested under the mode's bullet:
  - **The devices to drive.** A line that names `` `ADW_ANDROID_SERIAL` `` and `` `ADW_IOS_UDID` `` and says `device`.
  - **The device life cycle.** A line that says `never create, boot, shut down or delete`.
  - **Where screenshots go.** A line that names `` `ADW_PROOF_DIR` ``, `` `android/` `` and `` `ios/` `` and says `screenshot`. The step first checks that `android/` and `ios/` are the directories of the workflow profile's platforms. Those are the directories `platformOfImage` (`adws/proof/imagePlatform.ts`) attributes an image by.

The dry run ran in a throwaway clone of this working tree: merge `562c7eaf`, the uncommitted changes of Issues #1–#4, then Steps 1–3 below.
- The new scenario passes. `@adw-1044` reports `10 scenarios (10 passed)` and `76 steps (76 passed)`.
- Each change to `generate_step_definitions.md` below makes the new scenario fail at the step shown. The given, the when and the existing Thens still pass.

  | Change to the prompt | Fails at | With |
  |---|---|---|
  | the file as `origin/dev` has it (no note) | `… tells the step definitions to drive the devices named by "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"` | ``Expected the mode "descriptor" of /generate_step_definitions to say what it asks of a repository whose ".adw/scenarios.md" has a `## Scenario Run Contract`, but it says: - `descriptor`, or empty: the runner `.adw/scenarios.md` names. The rest of this prompt applies exactly as written.`` |
  | ``, and `ADW_IOS_UDID`, the simulator's UDID`` removed | the same step | `Expected the command the step-definition generator was started with to tell the step definitions to drive the devices named by "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID", but it tells them: …` |
  | `, and never create, boot, shut down or delete one: ADW does` removed | `… tells the step definitions never to create, boot, shut down or delete a device` | `Expected the command … to tell the step definitions never to create, boot, shut down or delete a device, but it tells them: …` |
  | ``in its `ios/` directory`` changed to ``in its `iphone/` directory`` | `… tells the step definitions to write each screenshot under "android/" or "ios/" in "ADW_PROOF_DIR"` | `Expected the command … to tell the step definitions to write each screenshot under "android/" or "ios/" in "ADW_PROOF_DIR", but it tells them: …` |
  | the condition keyed on `` `## Device Run Contract` `` instead | `… tells the step definitions to drive the devices named by …` | ``Expected the mode "descriptor" of /generate_step_definitions to say what it asks of a repository whose ".adw/scenarios.md" has a `## Scenario Run Contract`, but it says: …`` |

Rejected alternatives:
- **Copy the framework's command files into the worktree in a new Given, and read the generator's file from there.**
  - The copy needs a `GitContext` for `copyClaudeAssetsToWorktree`, and the scenario would need another Given.
  - The throwaway CLI records no working directory to read from.
  - Proving the copy is the job of feature-928 and feature-930. Reading the framework's file reads exactly what the copy puts in the worktree.
- **Read the generator's run again in the new step file.** That would repeat `startedWith` and `onlyGeneratorRun` from `feature-992-phase.steps.ts`. Exporting them is a two-word change, and the new Thens then read the same run as T-WP16 and T-WP18.
- **Pin the note's wording in the steps.** `generateStepDefinitionsPrompt.test.ts` already does that. The steps check what their phrases promise: the variables, the life-cycle rule, the platform directories, and that the note applies to this worktree.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-1044-generator.steps.ts` (new): the three Thens.
- `features/per-issue/step_definitions/feature-1044-prompt.ts`: export `bulletAt`.
- `features/regression/step_definitions/feature-992-phase.steps.ts`: export `startedWith` and `onlyGeneratorRun`.
- `features/per-issue/feature-1044.feature`: the new scenario, directly after the baseline scenario.

The working tree already holds the uncommitted changes of Issues #1–#4: nine modified files and the untracked `feature-1044-unit-tests.steps.ts`. Leave them as they are. The review-patch commit commits everything.

Do not change any of these:
- `.claude/commands/generate_step_definitions.md`, `.claude/commands/adw_init.md`, or any file under `adws/`. The note is right; only its proof is missing.
- The other nine scenarios of `feature-1044.feature`.
- Any other step file.
- `features/regression/vocabulary.md`. W-WP4, T-WP16 and T-WP18 are registered already. No `@adw-1044` phrase is registered, the existing ones included.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Export the helpers the new steps share
- **`features/regression/step_definitions/feature-992-phase.steps.ts`**
  - Line 252: `function startedWith(run: RunRecord): string[] {` becomes `export function startedWith(run: RunRecord): string[] {`.
  - Line 256: `function onlyGeneratorRun(): RunRecord {` becomes `export function onlyGeneratorRun(): RunRecord {`.
  - Nothing else in the file changes. It already exports `requireAdwFiles` and `runScenarioTestPhase`. A module is loaded only once, so importing it registers no step twice (`feature-1044-framework.steps.ts` already imports `feature-931.steps.ts` the same way).
- **`features/per-issue/step_definitions/feature-1044-prompt.ts`**
  - Line 53: `function bulletAt(lines: readonly string[], index: number): string[] {` becomes `export function bulletAt(lines: readonly string[], index: number): string[] {`.
  - Nothing else changes. The file's header already says any step file may import it.

### Step 2: Write the Thens (`feature-1044-generator.steps.ts`, new)
Create `features/per-issue/step_definitions/feature-1044-generator.steps.ts` with exactly this content (91 lines):

```ts
/**
 * Step-definition scenarios of feature-1044: what the command the step-definition phase started the generator with tells the
 * step definitions of a repository whose ".adw/" is what "adw_init" writes. The generator finds its command in the worktree it
 * runs in, where worktree setup copies the framework's own command files, so these steps read the framework's file, in the
 * runner mode the generator was started in. The workflow is the scenario-proof scenarios' step; the phase and the record of the
 * generator's run are feature-992's.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { REPO_ROOT } from '../../../adws/core/config.ts';
import { parseMarkdownSections, sectionValue } from '../../../adws/core/markdownSections.ts';
import { requireApplicationProfile } from '../../../adws/phases/applicationTypeGate.ts';

import { SCENARIOS_MD } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { onlyGeneratorRun, startedWith } from '../../regression/step_definitions/feature-992-phase.steps.ts';
import { requireWorkflow } from '../../regression/step_definitions/feature-992-world.ts';

import { SCENARIO_RUN_CONTRACT, bulletAt } from './feature-1044-prompt.ts';

const COMMANDS_DIRECTORY = '.claude/commands';
const RUNNER_MODE = '## Runner mode';
const DEVICE_LIFE_CYCLE = 'never create, boot, shut down or delete';

const codeSpan = (text: string): string => `\`${text}\``;
const CONTRACT_HEADING = codeSpan(`## ${SCENARIO_RUN_CONTRACT}`);

/** The lines of a `## ` section of the command file, below its heading and up to the next one. */
function sectionOf(lines: readonly string[], heading: string, command: string): string[] {
  const start = lines.findIndex(line => line.trim() === heading);
  assert.ok(start >= 0, `Expected ${command} to have a "${heading}" section`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/**
 * The lines nested under the bullet of the runner mode the generator was started in: what that mode tells the step definitions
 * of a repository whose ".adw/scenarios.md" has the contract the bullet names. The worktree's must have it, or the note would
 * not apply to its step definitions.
 */
function deviceNote(): string[] {
  const run = onlyGeneratorRun();
  const [, , mode] = startedWith(run);
  const command = fs.readFileSync(path.join(REPO_ROOT, COMMANDS_DIRECTORY, `${run.command.slice(1)}.md`), 'utf-8').split('\n');
  const modes = sectionOf(command, RUNNER_MODE, run.command);
  const index = modes.findIndex(line => line.startsWith(`- ${codeSpan(mode)}`));
  assert.ok(index >= 0, `Expected the "${RUNNER_MODE}" of ${run.command} to say what the mode "${mode}" it was started in means`);
  const [modeLine, ...note] = bulletAt(modes, index);
  assert.ok(
    modeLine.includes(CONTRACT_HEADING),
    `Expected the mode "${mode}" of ${run.command} to say what it asks of a repository whose "${SCENARIOS_MD}" has a ${CONTRACT_HEADING}, but it says: ${modeLine}`,
  );
  const scenariosMd = fs.readFileSync(path.join(requireWorkflow().worktreePath, SCENARIOS_MD), 'utf-8');
  assert.ok(sectionValue(parseMarkdownSections(scenariosMd), SCENARIO_RUN_CONTRACT), `Expected the worktree's "${SCENARIOS_MD}" to have the ${CONTRACT_HEADING} that "adw_init" writes`);
  return note;
}

function assertNoteSays(says: (line: string) => boolean, what: string): void {
  const note = deviceNote();
  assert.ok(note.some(says), `Expected the command the step-definition generator was started with to tell the step definitions ${what}, but it tells them:\n${note.join('\n')}`);
}

Then(
  'the command the step-definition generator was started with tells the step definitions to drive the devices named by {string} and {string}',
  function (android: string, ios: string) {
    assertNoteSays(line => line.includes(codeSpan(android)) && line.includes(codeSpan(ios)) && line.includes('device'), `to drive the devices named by "${android}" and "${ios}"`);
  },
);

Then('the command the step-definition generator was started with tells the step definitions never to create, boot, shut down or delete a device', function () {
  assertNoteSays(line => line.toLowerCase().includes(DEVICE_LIFE_CYCLE), 'never to create, boot, shut down or delete a device');
});

Then(
  'the command the step-definition generator was started with tells the step definitions to write each screenshot under {string} or {string} in {string}',
  function (first: string, second: string, variable: string) {
    const platformDirectories = requireApplicationProfile(requireWorkflow().config).platforms.map(platform => `${platform}/`);
    assert.deepStrictEqual(
      [first, second].sort(),
      [...platformDirectories].sort(),
      `ADW reads the platform of an image from its first directory under "${variable}", which names a platform of the profile`,
    );
    assertNoteSays(
      line => /screenshot/i.test(line) && [variable, first, second].every(name => line.includes(codeSpan(name))),
      `to write each screenshot under "${first}" or "${second}" in "${variable}"`,
    );
  },
);
```

How the steps work:
- **The run.** `onlyGeneratorRun()` asserts that exactly one `/generate_step_definitions` run was recorded. `startedWith(run)` gives its quoted arguments; the third is the mode the phase passed as `$2`.
- **The mode's bullet.**
  - `sectionOf` takes the lines between `## Runner mode` and the next `## ` heading.
  - The bullet is the one that starts with `` - `<mode>` ``.
  - `bulletAt` gives the bullet and the lines nested under it. Those lines end at the next line indented no deeper than the bullet, here `` - `adw_playwright` ``.
  - So a phase that started the generator in another mode would get another bullet, and that bullet names no contract.
- **The profile.** `requireApplicationProfile(requireWorkflow().config)` is the profile W-WP4 set from the worktree's `.adw/project.md`. For `mobile:kotlincm` its platforms are `android` and `ios`.
- **Ambiguity.** No new phrase matches an existing step. A dry run of every feature reports no undefined or ambiguous step.

### Step 3: Add the scenario to `feature-1044.feature`
Insert the block below directly after the baseline scenario, whose last step is `And no park comment was posted on issue 104401`. It goes before the `## Run Tests` scenario of issue 104405, followed by one blank line. In ADW's order the step-definition phase runs after the baseline and before the unit tests (`adws/adwSdlc.tsx:60-66`).

```gherkin
  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" is what "adw_init" writes, the step-definition phase starts the generator in the mode for the scenario runner that ".adw/scenarios.md" describes, and, because that ".adw/scenarios.md" has a "## Scenario Run Contract", the command the generator is started with tells the step definitions which devices to drive, never to create, boot, shut down or delete one, and where each platform's screenshots go
    Given a workflow for issue 104406 whose worktree holds the ".adw/" that "adw_init" writes for the application type "mobile:kotlincm"
    When the workflow's step-definition phase runs
    Then the step-definition generator was started once, for issue 104406
    And the step-definition generator was started in the mode for the scenario runner that ".adw/scenarios.md" describes
    And the command the step-definition generator was started with tells the step definitions to drive the devices named by "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"
    And the command the step-definition generator was started with tells the step definitions never to create, boot, shut down or delete a device
    And the command the step-definition generator was started with tells the step definitions to write each screenshot under "android/" or "ios/" in "ADW_PROOF_DIR"
```

- The scenario itself names the variables, the life-cycle rule and the directories. No step reads them from a prompt and then compares the prompt with itself.
- Issue 104406 is used by no other scenario.
- Feature-1044's `Before` and `After` hooks already run for every `@adw-1044` scenario.
  - `beginScenario()` gives the scenario a fresh feature-988 world, so `cli` is null until W-WP4 installs the throwaway CLI.
  - `endScenario()` puts `CLAUDE_CODE_PATH` back and removes the CLI's directory, the worktree, the logs and `agents/<adwId>`.
  - The scenario starts no orchestrator, so the hooks start no subprocess harness.
- Leave every change uncommitted: the review-patch commit commits them.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. Check the scope:
   - `git status --short` lists these, and nothing else:
     - the nine files that Issues #1–#4 changed;
     - `M` for `features/regression/step_definitions/feature-992-phase.steps.ts`;
     - `??` for `feature-1044-unit-tests.steps.ts`, `feature-1044-generator.steps.ts` and the patch plans under `specs/patch/`.

     `feature-1044.feature` and `feature-1044-prompt.ts` are among the nine.
   - `git diff --quiet HEAD -- .claude/commands adws && echo untouched` prints `untouched`.
   - `wc -l features/per-issue/feature-1044.feature features/per-issue/step_definitions/feature-1044-*.ts` shows every file under 300 lines. The feature file has 153 lines, `generator.steps` 91 and `prompt` 160.
2. Run the static checks. Each of these exits 0: `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build` and `bun run lint:branch-names`.
3. Run the scenarios:
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044"` reports `10 scenarios (10 passed)` and `76 steps (76 passed)`.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run` reports no undefined or ambiguous step.
4. Check that the new scenario fails without the note it proves. Run this from the worktree's root, while no other Cucumber run is using the worktree:
   ```sh
   git show origin/dev:.claude/commands/generate_step_definitions.md > .claude/commands/generate_step_definitions.md
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044" --name "step-definition phase starts the generator"
   git checkout HEAD -- .claude/commands/generate_step_definitions.md
   git diff --quiet HEAD -- .claude/commands/generate_step_definitions.md && echo restored
   ```
   - The Cucumber run reports `1 scenario (1 failed)` and `8 steps (1 failed, 2 skipped, 5 passed)`.
   - It fails at `And the command the step-definition generator was started with tells the step definitions to drive the devices named by "ADW_ANDROID_SERIAL" and "ADW_IOS_UDID"`. The message is ``Expected the mode "descriptor" of /generate_step_definitions to say what it asks of a repository whose ".adw/scenarios.md" has a `## Scenario Run Contract` …``.
   - The last line prints `restored`.
5. Check the rest of the suite. Each of these reports zero failures:
   - `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/adwInitPrompt.mobile.test.ts adws/__tests__/generateStepDefinitionsPrompt.test.ts`;
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`, which runs W-WP4, T-WP16 and T-WP18 of the exported file;
   - `bun run test:unit`.

## Patch Scope
**Lines of code to change:** about 101 added and 3 changed, in four files:

| File | Added | Changed |
|---|---|---|
| `features/per-issue/feature-1044.feature` | 10 | 0 |
| `features/per-issue/step_definitions/feature-1044-generator.steps.ts` (new) | 91 | 0 |
| `features/per-issue/step_definitions/feature-1044-prompt.ts` | 0 | 1 (`export`) |
| `features/regression/step_definitions/feature-992-phase.steps.ts` | 0 | 2 (`export`) |

**Risk level:** low.
- No prompt and no ADW source changes.
- Outside `features/per-issue/`, only the `export` keyword is added to two functions of a regression step file. Their bodies, and the steps that call them, are unchanged.

**Testing required:** the commands above. They were run in a throwaway clone of this working tree: merge `562c7eaf`, the uncommitted changes of Issues #1–#4, then Steps 1–3.
- Item 1: four files changed as listed, `.claude/commands` and `adws/` were untouched, and every file is under 300 lines.
- Item 2: both type checks, lint, build and `lint:branch-names` exited 0.
- Item 3: `10 scenarios (10 passed)`, `76 steps (76 passed)`. The dry run of every feature reported `585 scenarios (585 skipped)` and `4226 steps (4226 skipped)`, none undefined or ambiguous.
- Item 4: the run failed as described. The table under Issue Summary lists four more changes to the prompt, each of which failed as shown there.
- Item 5:
  - The three prompt test files passed `87` tests.
  - `@regression` reported `369 scenarios (369 passed)` and `2619 steps (2619 passed)`.
  - `bun run test:unit` passed `292` files and `5006` tests.
- A clone used for this dry run needs the real `origin` URL (`git remote set-url origin <the worktree's origin URL>`). A clone of a local path has that path as its `origin`. The label-routing and takeover scenarios (`feature-932`, `feature-959`) then fail in `getRepoInfo` with `Could not parse owner/repo from remote URL`. This working tree has the real URL, so the commands above need no such step.
