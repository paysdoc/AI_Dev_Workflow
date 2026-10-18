# Feature: `adw_init` preserves `mobile:kotlincm` and writes its Kotlin, Gradle and device-source descriptors

## Metadata
issueNumber: `1044`
adwId: `g0m1dk-feat-adw-init-preser`
issueJson: `{"number":1044,"title":"feat: adw_init preserves mobile:kotlincm and writes its Kotlin, Gradle and device-source descriptors","body":"## Parent PRD\n\n`specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record: `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`)\n\n## What to build\n\n`adw_init` never detects `mobile:kotlincm`; it preserves the hand-set value and, when the preserved type is `mobile:kotlincm`, writes the descriptors the repository needs even when no manifest exists yet: `cucumber-jvm`, step directory `scenarios/src/test/kotlin`, run-by-tag and regression commands for a `:scenarios` Gradle module with a cucumber tag filter, Gradle `test` (JUnit path wired) and `build` commands, `N/A` for the dev server, the four device-source sections (`## Android System Image`, `## Android Device Profile`, `## iOS Device Type`, `## iOS Runtime`) with defaults when absent and preserved when present, and the JUnit attachment and `android/` / `ios/` proof-directory contract documented in `scenarios.md`. `generate_step_definitions.md` gains a descriptor-mode note naming `ADW_ANDROID_SERIAL`, `ADW_IOS_UDID`, `ADW_PROOF_DIR` and the platform-directory convention for screenshot hooks. See PRD \"Prompts\" and \"Reeve bootstrap sequence\".\n\n## Acceptance criteria\n\n- [ ] `adw_init.md` step 1 lists no detection signal for `mobile:kotlincm`; step 3 preserves it verbatim\n- [ ] For a preserved `mobile:kotlincm` with no manifest, `commands.md` gets Gradle test and build commands and `## Start Dev Server` stays `N/A`\n- [ ] `scenarios.md` gets `cucumber-jvm`, `scenarios/src/test/kotlin`, the Gradle run-by-tag and regression commands, and the JUnit attachment and proof-directory contract text\n- [ ] `project.md` gets the four device-source sections with defaults when absent; existing values are preserved on upgrade\n- [ ] `generate_step_definitions.md` descriptor mode names the three device variables and the proof-directory convention\n- [ ] Prompt tests in `adwInitPrompt.test.ts` and `generateStepDefinitionsPrompt.test.ts` pin the new text; editing `adw_init.md` bumps the framework hash as today\n\n## Blocked by\n#1043 <!-- adw:region-overlap -->\n\n- Blocked by #1043\n\n## Touched Files\n\n- .claude/commands/adw_init.md\n- .claude/commands/generate_step_definitions.md\n- adws/__tests__/adwInitPrompt.test.ts\n- adws/__tests__/generateStepDefinitionsPrompt.test.ts\n\n## User stories addressed\n\n- User stories 10, 23, 24, 25, 34, 40, 42, 43, 44, 46\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-18T15:00:08Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-10-18T19:38:44Z","body":"⏸️ **Deferred behind #1043 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #1043, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #1043 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `.claude/commands/adw_init.md`\n- `adws/__tests__/adwinitprompt.test.ts`\n\nThis issue will spawn automatically once #1043 merges and closes. To override, remove the `#1043 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description
#1043 (merged as #1058) made `mobile:kotlincm` a type the mapping knows: descriptor runner, per-issue images, platforms `android` and `ios`. It also changed the `adw_init.md` step-3 bullet so that the type is listed as hand-set only and is preserved. Apart from that bullet, `adw_init` still writes every descriptor from what it detects. A repository whose owner sets `mobile:kotlincm` by hand therefore still gets `N/A` commands and a `cucumber-js` scenario command. That is what Reeve's `.adw/` holds today (checked on GitHub, 2026-10-19). So the repository's bootstrap issue has nothing ADW can build, test or run.

This feature changes only prompts and their tests:

- **Step 1** of `adw_init.md` still detects only `cli` and `web` and never names `mobile:kotlincm`. A mobile app (one that runs on Android or iOS) is now undecided rather than `cli`, so detection never guesses a mobile repository into a type.
- **Step 2.** When the type step 3 writes is `mobile:kotlincm`, step 2 writes these to `.adw/commands.md`, whatever the manifests show and also when there are none:
  - a Gradle unit-test command that writes the JUnit report to `$ADW_UNIT_TEST_REPORT_PATH`;
  - a Gradle build command;
  - `N/A` for the dev server;
  - the `:scenarios` run-by-tag and regression commands.
- **Step 3.** It writes the four device-source sections to `.adw/project.md`. Each gets its default when absent and keeps the owner's value when set.
- **Step 8.** It writes `cucumber-jvm`, `scenarios/src/test/kotlin`, the Gradle scenario commands and a verbatim `## Scenario Run Contract` to `.adw/scenarios.md`. The contract documents:
  - the variables ADW passes the run;
  - the JUnit attachment lines and the identical-title rule;
  - the `android/` and `ios/` proof-directory convention.
- **`generate_step_definitions.md`** gets a descriptor-mode note for repositories that have that contract. It names `ADW_ANDROID_SERIAL`, `ADW_IOS_UDID` and `ADW_PROOF_DIR`, and the platform directories that screenshot hooks write to.

Prompt tests pin all of this and check it against ADW's own sources: the mapping, `Platform`, the stack-coherence check, the step-definition registry, the JUnit parser and the section parser.

The value is the PRD's Reeve bootstrap sequence. The owner writes the type. The upgrade's `adw_init` keeps it and writes the descriptors. Issue #1 then builds the app and the `:scenarios` module from a written contract, and ADW reads that module's output without owning any of it.

## User Story
As a repository owner of a Kotlin Compose Multiplatform repository, empty or not
I want `adw_init` to keep the `mobile:kotlincm` I set by hand and write the Gradle, cucumber-jvm, device-source and evidence descriptors for it
So that my bootstrap issue is not blocked by `N/A` commands, my `:scenarios` module knows exactly what ADW passes it and reads back, and an upgrade never resets the devices I chose

## Problem Statement
- Steps 2 and 8 write only what detection finds. With no manifest, a hand-set `mobile:kotlincm` gets `N/A` for `## Run Tests` and `## Run Build`, and the default-Cucumber branch's `cucumber-js --tags "@{tag}"`, `cucumber-js` and `features/step_definitions`. None of these can run a Kotlin repository.
- Step 2's rule "preserve `## Run Tests` verbatim" would keep, on every later upgrade, the `N/A` (and its `# JUnit emission is not configured…` comment line) that the manifest-less run wrote into Reeve. The Gradle command would never be written.
- Step 2's `## Start Dev Server` keys on "the application type decided in step 1", but `mobile:kotlincm` is never decided in step 1, only preserved in step 3. Steps 6 and 8 already key on the type step 3 writes.
- Nothing writes `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` or `## iOS Runtime`, which #1045 will require for a profile with platforms.
- Nothing tells a mobile repository what ADW reads back:
  - where the JUnit report goes, and that each screenshot needs a `[[ATTACHMENT|…]]` line relative to the report's directory;
  - that both platform runs of a scenario must report its exact title;
  - that the platform of an image is its first directory under `ADW_PROOF_DIR`.
- `generate_step_definitions.md` says nothing about the device variables or the platform directories, so the step agent cannot write hooks that screenshot the right device into the right place (story 10).
- Step 1 says `cli` means "no browser user interface". It can therefore classify an untyped mobile app as `cli` and silently give it the wrong evidence profile. ADR-0064 expects a new mobile repository to park until its owner writes the type, and the #1043 plan deferred this fix to this slice.

## Solution Statement
Edit two prompts, `adw_init.md` and `generate_step_definitions.md`, and pin the edits in tests. No ADW TypeScript changes.

1. **Step 1.** The `cli` bullet excludes mobile apps. The Undecided bullet adds mobile apps. Step 1 still names no type but `cli` and `web`.
2. **Step 2**
   - Type reference: `## Start Dev Server` keys on the type step 3 writes, and the `N/A` bullet names `mobile:kotlincm`.
   - `## Run Tests`: for `mobile:kotlincm`, a section that holds no command but `N/A` counts as absent. The type's Gradle command comes first in the authoring list.
   - `## Run Build` gets the type's Gradle command.
   - The note about the scenario commands names the `:scenarios` module.
3. **Step 3** writes the four device-source sections. Each keeps its value when one is set and otherwise gets its default. Any other type gets none of them. For `mobile:kotlincm`, `## Relevant Files` also lists `.adw/scenarios.md`, so that the bootstrap issue's planner reads the contract (story 46).
4. **Step 8** gets a `mobile:kotlincm` branch after the `web` branch and before the Cypress and Cucumber branches. It writes the `## Scenario Run Contract` as a verbatim fenced block.
5. **Step 11** reports the mobile outcomes.
6. **`generate_step_definitions.md`**
   - A device note under the `descriptor` bullet of `## Runner mode`.
   - A `**Scenario Run Contract**` entry in the polymorphism list.
   - A step-1 bullet for the new section.
   - The note names no framework.
7. **Tests**
   - The shared helpers of the `adw_init` prompt tests move to `adwInitPrompt.helpers.ts`.
   - `adwInitPrompt.test.ts` pins steps 1 and 3 and the hash input.
   - `adwInitPrompt.mobile.test.ts` pins the mobile descriptors and checks them against the mapping, the stack-coherence check, the step-definition registry, the JUnit parser and the section parser.
   - `generateStepDefinitionsPrompt.test.ts` pins the descriptor-mode note.
8. **README**: the `adw_init` paragraph and the test listing.

Decisions, each with its reason:

- **`## Run Tests`**:
  ```
  ./gradlew test -x :scenarios:test --continue; exit_code=$?; { echo '<testsuites>'; find . -path ./scenarios -prune -o -path '*/build/test-results/*' -name 'TEST-*.xml' -exec sed 's/<?xml[^?]*?>//' {} +; echo '</testsuites>'; } > "$ADW_UNIT_TEST_REPORT_PATH"; exit $exit_code
  ```
  - `-x :scenarios:test`: an unqualified `./gradlew test` would also run every scenario, untagged, with no devices booted.
  - The merge: ADW reads one file (`readJUnitReport(<logsDir>/junit-unit.xml)`), but Gradle writes one `TEST-*.xml` per class per module. The parser accepts a `<testsuites>` wrapper (`collectSuites`).
  - The `sed` substitution strips each XML declaration wherever it stands.
  - `./scenarios` is pruned so that results a scenario run left in the same worktree never enter the unit report.
  - `--continue` lets every module's tests run, so the report is complete.
  - The variable is `exit_code` because `status` is read-only in zsh, the shell the `/test` agent's Bash tool may use.
  - With no test results at all, the empty wrapper parses to `null`. The verdict is then `warn` (`unverified`), never a zero-case hard-fail.
- **`## Run Build`**: `./gradlew build -x test`. This is Gradle's `build` without any project's `test` task. Without `-x test`, a failing unit test would surface as a build failure, and `:scenarios:test` would run there too.
- **`## Run Scenarios by Tag`**: `./gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"`. **`## Run Regression Scenarios`**: the same command with `@regression`.
  - The command keeps the shape the #1043 stack-coherence tests already use.
  - `--rerun` (Gradle 7.6 and later) is needed because `runTag` deletes `junit-<tag>.xml` before every run, and each run gets new devices and a new `ADW_PROOF_DIR`, none of which Gradle tracks as inputs. An up-to-date skip would leave no report, which fails the tag.
- **The `N/A` carve-out applies only to `mobile:kotlincm`.** For other types, an `N/A` might be the owner's choice, and widening the rule would change every target repository on the next upgrade.
- **The contract is a verbatim block**, so every mobile repository gets the same text and a test can pin it. It holds no line starting with `## `, so `parseMarkdownSections` still reads `.adw/scenarios.md` correctly.
- **The step-definition note applies only when `.adw/scenarios.md` has `## Scenario Run Contract`.** The prompt receives only the runner mode, which is `descriptor` for `cli` too, and a section the agent can see is the established way this prompt branches. The note names no framework (ADR-0043: one polymorphic prompt).
- **Device-source defaults**:

  | Section | Default |
  |---|---|
  | `## Android System Image` | `system-images;android-36;google_apis;arm64-v8a` (arm64, because the pipeline host is a Mac mini) |
  | `## Android Device Profile` | `pixel_8` |
  | `## iOS Device Type` | `com.apple.CoreSimulator.SimDeviceType.iPhone-16` |
  | `## iOS Runtime` | `com.apple.CoreSimulator.SimRuntime.iOS-26-0` |

  Each value is one line, which is what #1045's parser will read. The owner edits a value when the host differs (#1040 installs whatever the sections name).

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview. Its `adw_init` paragraph (line ~259) and the `adws/__tests__/` listing (line ~507) are updated. The worktree starts with an unrelated uncommitted change that adds test files to the listing; leave it as found.
- `.adw/coding_guidelines.md` — must be followed: files under 300 lines, comments only for invariants and non-obvious reasons, no issue numbers in comments.
- `.claude/commands/adw_init.md` — the main edit, in steps 1, 2, 3, 8 and 11. It is a `hashInputs:` file, so editing it bumps the framework hash.
- `.claude/commands/generate_step_definitions.md` — the descriptor-mode device note, the polymorphism entry and the step-1 bullet.
- `adws/__tests__/adwInitPrompt.test.ts` — existing pins that must stay green:
  - the heredoc and the Comments entry;
  - the offered types and the preserve rule;
  - the Playwright steps;
  - the order of the step-8 branches (`` `web` ``, then `**Cypress**`, then `**Cucumber**`);
  - step numbering 1–11;
  - "names no `.adw/` file but those adw_init writes";
  - the step-2 dev-server tests.

  It gains the step-1, preserve and hash pins, and imports the helpers.
- `adws/__tests__/generateStepDefinitionsPrompt.test.ts` — existing pins. "names no runner mode ADW does not pass" matches `` `(adw_[a-z_]+|descriptor)` ``, so new text must not hold any backticked lowercase `adw_…` token such as `` `adw_init` ``. It gains the descriptor-mode pins.
- `adws/core/applicationType.ts` — `APPLICATION_TYPE_PROFILES` and `Platform`, the sources the tests compare the prompts with.
- `adws/core/stackCoherenceCheck.ts` — `stackCoherenceCheck` and `inferStackLanguages`. The `gradlew` token comes before `cucumber`, so all four mobile descriptors read as `jvm`.
- `adws/core/stepDefDetection.ts` — `isGherkinFramework` and `stepDefExtensionsFor('cucumber-jvm')`, which gives `['.kt', '.java']`. `hasStepDefinitions` recurses, so Kotlin package directories under `scenarios/src/test/kotlin` are found.
- `adws/core/projectConfig.ts`
  - `parseMarkdownSections` splits only on `^##\s+` lines.
  - `parseScenariosMd` and `parseCommandsMd` fill an empty or missing section with the Bun defaults, which is why the mobile branch writes every section.
  - The descriptor runner reads `commands.runScenariosByTag`.
- `adws/core/scenarioRunner.ts` and `adws/agents/bddScenarioRunner.ts` — the descriptor runner takes the command from `.adw/commands.md`, replaces `{tag}` with the tag (no `@`) and runs it through a shell from the worktree root.
- `adws/phases/scenarioProof.ts`
  - `ADW_JUNIT_REPORT_PATH` is `<proofDir>/junit-<tag>.xml`, deleted before each run.
  - `ADW_PROOF_DIR` is `<proofDir>/artifacts`, shared by both tags in descriptor mode.
  - The proof is skipped while no step definition exists (story 45).
- `adws/phases/unitTestPhase.ts`, `adws/agents/testRetry.ts`, `adws/core/testReportParser.ts`, `adws/core/testVerdict.ts`
  - `ADW_UNIT_TEST_REPORT_PATH` is one file.
  - The `<testsuites>` wrapper is supported.
  - The `[[ATTACHMENT|…]]` regex reads `<system-out>`.
  - No report means `warn`; zero cases means `hard-fail`.
- `.claude/commands/test.md` — runs `## Run Tests` "exactly as written" with a 5-minute timeout.
- `adws/proof/proofAssembler.ts`, `adws/proof/featureScenarioIndex.ts`, `adws/proof/proofArtifactHarvester.ts`
  - An attachment is resolved against the report's directory.
  - A case name without ` › ` is matched to the scenario title.
  - Outline rows are named by the playwright-bdd rules: a filled `<column>` template, else `Example #<n>`.
  - Images are `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` under `ADW_PROOF_DIR`.
- `adws/phases/baselinePhase.ts`, `adws/core/baselineGate.ts`, `adws/forge/parkComment.ts` — the baseline runs the base branch's own `.adw/commands.md`, and `## Continue` waives a `baseline_red` park. See Notes for the bootstrap consequence.
- `adws/phases/worktreeSetup.ts` — `REQUIRED_ADW_FILES`, which the test "names no `.adw/` file" checks against.
- `adws/core/__tests__/stackCoherenceCheck.test.ts` — prior art for the Gradle command shapes, such as `./gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}"`.
- `adws/__tests__/adwChore.helpers.ts` — precedent for a shared `*.helpers.ts` beside the tests in `adws/__tests__/`.
- `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` — the "Prompts" section, the "Reeve bootstrap sequence" and user stories 10, 23–25, 34, 40, 42–46.
- `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md` — the decision record: hand-set only, device sources with defaults, platform from the first directory, identical titles.
- `specs/adr/0043-multi-language-test-seam.md` — one polymorphic step-definition prompt that names no framework.
- `specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md` — the attachment-line source and title attribution, which still stand.
- `app_docs/feature-9gjajh-commands-and-skills.md` — conditional doc that owns `adw_init.md`, `generate_step_definitions.md` and `adwInitPrompt.test.ts`. It requires the step-definition prompt to stay descriptor-driven and name no framework.
- `app_docs/feature-gfv9kt-application-type-mapping.md` — conditional doc for "`adw_init` must detect, preserve or leave out the section". It is left to `/document`.

### New Files
- `adws/__tests__/adwInitPrompt.helpers.ts` — shared helpers of the `adw_init` prompt tests: `REPO_ROOT`, `ADW_INIT_PATH`, `readLines`, `stepLines`, `projectMdStep`, `hashInputs`, `fencedBlockAfter`, `SCENARIO_RUN_CONTRACT_SECTION`.
- `adws/__tests__/adwInitPrompt.mobile.test.ts` — pins the descriptors `adw_init.md` writes for a hand-set `mobile:kotlincm`. It is a separate file because adding these tests to `adwInitPrompt.test.ts` would take it past the 300-line guideline.

## Implementation Plan
### Phase 1: Foundation
Move the helpers of `adwInitPrompt.test.ts` into `adwInitPrompt.helpers.ts` without changing any test, and add `fencedBlockAfter` and `SCENARIO_RUN_CONTRACT_SECTION`. Then write the red tests: step 1 detects only `cli` and `web` and makes a mobile app undecided; the preserve rule names every type of the mapping; the prompt lists itself in `hashInputs`.

### Phase 2: Core Implementation
Write the mobile descriptor tests (red), then edit `adw_init.md`:
- step 1: mobile apps are undecided;
- step 2: the type reference, `## Run Tests` with the `N/A` carve-out and the Gradle command, `## Run Build`, `## Start Dev Server` and the scenario-command note;
- step 3: the device sources and the `## Relevant Files` pointer;
- step 8: the mobile branch and the verbatim contract;
- step 11: the report.

Then write the `generate_step_definitions.md` tests (red) and the descriptor-mode note, the polymorphism entry and the step-1 bullet.

### Phase 3: Integration
Check the mobile descriptors against the code that consumes them:
- the stack-coherence check reads them as one JVM stack;
- the step-definition registry finds `.kt` files;
- the JUnit parser reads the documented attachment syntax;
- the section parser reads the contract as one section;
- the step-definition prompt names the same contract heading `adw_init.md` writes.

Then update the README, make the `@adw-1044` scenarios pass, and run every validation command. Merging bumps the framework hash, so every target repository regenerates `.adw/` on its next workflow, which is how Reeve receives the descriptors.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Check the base and the worktree
- `git log --oneline -1` shows the merge of #1058, and `adws/core/applicationType.ts` has the `'mobile:kotlincm'` entry and `Platform`. If `dev` has moved on, merge `origin/dev` first.
- `README.md` already has an uncommitted change that adds test files to the `adws/__tests__/` listing. It is not part of this issue. Do not revert it.

### 2. Move the `adw_init` prompt-test helpers into `adws/__tests__/adwInitPrompt.helpers.ts` (refactor, green)
- Create `adws/__tests__/adwInitPrompt.helpers.ts` and move into it, unchanged and exported:
  - `REPO_ROOT` and `ADW_INIT_PATH` (computed from `fileURLToPath(import.meta.url)`, as today);
  - `readLines`, `projectMdStep`, `stepLines` and `hashInputs` (which assert with `expect` imported from `vitest`).
- Add `export const SCENARIO_RUN_CONTRACT_SECTION = '## Scenario Run Contract';`.
- Add `fencedBlockAfter(lines, marker)`:
  - It finds the first line that contains `marker`, then the next line whose trimmed text starts with a code fence, then the closing fence.
  - It returns the lines between the fences, with the opening fence's indentation removed.
  - It asserts that each of the three lines exists.
- `adwInitPrompt.test.ts` imports from `./adwInitPrompt.helpers`. Keep `CODING_GUIDELINES_PATH`, the heredoc and Comments constants and `findCommentsEntry` where they are.
- Keep the file's top comment: it explains why the tests compare a prompt with its sources. The helpers file needs only a one-line comment saying it is shared by the `adw_init` prompt tests, or none.
- Run `bunx vitest run adws/__tests__/adwInitPrompt.test.ts`. Every existing test still passes.

### 3. Pin step 1, the preserve rule and the hash input in `adwInitPrompt.test.ts` (red)
Add `describe('adw_init.md never detects mobile:kotlincm, and keeps it when the owner sets it', …)` with these tests:
- **"detects only cli and web in step 1, and names mobile:kotlincm nowhere in it"**
  - The detected types are the step-1 lines matching `/^\s+- `([^`]+)`:/`, sorted. They equal `['cli', 'web']`.
  - Every detected type is a key of `APPLICATION_TYPE_PROFILES`.
  - `stepLines(lines, 1).join('\n')` does not contain `mobile:kotlincm`.
- **"makes a mobile app undecided, so that detection never guesses it into cli"**: step 1 matches `/Undecided:[^\n]*runs on Android or iOS/` and `/`cli`:[^\n]*is not a mobile app/`. Red until step 4.
- **"preserves every type the mapping knows verbatim, mobile:kotlincm among them"**: the step-3 line that holds both `preserve it verbatim` and `` `## Application Type` `` contains `` `${type}` `` for every key of `APPLICATION_TYPE_PROFILES`.
- **"lists itself among the hashInputs, so that editing it bumps the framework hash"**: `hashInputs(readLines(ADW_INIT_PATH))` contains `.claude/commands/adw_init.md`.

### 4. Make a mobile app undecided in step 1 of `adw_init.md` (green)
- In the `cli` bullet (line 40), change `the application has no browser user interface.` to `the application has no browser user interface and is not a mobile app.` Leave the examples unchanged.
- Replace the Undecided bullet (line 42) with:
  ```md
       - Undecided: the signals conflict (for example a CLI and a separate browser UI, neither of them primary), there is nothing to go on (an empty repository whose issue describes no application), or the application is a mobile app, one that runs on Android or iOS: no signal decides the type of a mobile app, because only the repository's owner sets it. Do not guess, and never fall back to `cli`.
  ```
- Step 1 still names no type besides `cli` and `web`. Do not add a bullet for `mobile:kotlincm`.
- Run the tests from step 3. All green.

### 5. Write the mobile descriptor tests in `adws/__tests__/adwInitPrompt.mobile.test.ts` (red)
Add a top comment of one or two lines: the prompt writes the descriptors of a hand-set type that ADW never detects, and these tests compare them with the code that consumes them.

Define these constants (a template literal, or `String.raw`, holds the unit-test command as written):
```ts
const MOBILE = 'mobile:kotlincm';
const GRADLE_RUN_TESTS = `./gradlew test -x :scenarios:test --continue; exit_code=$?; { echo '<testsuites>'; find . -path ./scenarios -prune -o -path '*/build/test-results/*' -name 'TEST-*.xml' -exec sed 's/<?xml[^?]*?>//' {} +; echo '</testsuites>'; } > "$ADW_UNIT_TEST_REPORT_PATH"; exit $exit_code`;
const GRADLE_RUN_BUILD = './gradlew build -x test';
const GRADLE_RUN_BY_TAG = './gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"';
const GRADLE_RUN_REGRESSION = GRADLE_RUN_BY_TAG.replace('{tag}', 'regression');
const BDD_FRAMEWORK = 'cucumber-jvm';
const STEP_DEF_DIRECTORY = 'scenarios/src/test/kotlin';
const DEVICE_SOURCES = [
  ['## Android System Image', 'system-images;'],
  ['## Android Device Profile', ''],
  ['## iOS Device Type', 'com.apple.CoreSimulator.SimDeviceType.'],
  ['## iOS Runtime', 'com.apple.CoreSimulator.SimRuntime.'],
] as const;
```

Write these tests. A failure message should name the step and the section.

- **`describe('… .adw/commands.md of a mobile:kotlincm repository', …)`**
  - **The type is known.** `MOBILE` is a key of `APPLICATION_TYPE_PROFILES`, and its `platforms` are not empty. This ties the descriptors to the one type that boots devices.
  - **The unit-test command.**
    - Step 2 contains `GRADLE_RUN_TESTS`.
    - The step-2 line that holds it also holds `` `mobile:kotlincm` `` and `no manifest`.
    - `GRADLE_RUN_TESTS` itself contains `"$ADW_UNIT_TEST_REPORT_PATH"` and `-x :scenarios:test`.
  - **An earlier `N/A` is replaced.** Step 2 matches `/no command but `N\/A`/` and still contains `preserve it verbatim`.
  - **The build command.** The step-2 line that holds `GRADLE_RUN_BUILD` also holds `` `mobile:kotlincm` ``.
  - **The dev server.**
    - Step 2 contains `the application type step 3 writes`.
    - The step-2 line that holds `` → `N/A` `` and `` `cli` `` also holds `` `mobile:kotlincm` ``.
  - **The scenario commands.** The step-2 note about `## Run Scenarios by Tag` names `` `:scenarios` `` and `` `mobile:kotlincm` ``.
- **`describe('… .adw/scenarios.md of a mobile:kotlincm repository', …)`**
  - **The step-8 values.** Step 8 contains `` `cucumber-jvm` ``, `` `scenarios/src/test/kotlin` ``, `GRADLE_RUN_BY_TAG`, `GRADLE_RUN_REGRESSION` and `` `${SCENARIO_RUN_CONTRACT_SECTION}` ``.
  - **The branch order.** `` `web` `` comes before `` **`mobile:kotlincm`** ``, which comes before `**Cypress**`, which comes before `**Cucumber**`.
  - **The step-definition registry.**
    - `isGherkinFramework(BDD_FRAMEWORK)` is true.
    - `stepDefExtensionsFor(BDD_FRAMEWORK)` contains `.kt`.
  - **The stack-coherence check.**
    - `stackCoherenceCheck({ testFramework: '', bddFramework: BDD_FRAMEWORK, runTests: GRADLE_RUN_TESTS, runScenariosByTag: GRADLE_RUN_BY_TAG })` is `{ ok: true, warnings: [] }`.
    - `inferStackLanguages` of the same input is exactly `{'jvm'}`.
  - **The contract's content.** `fencedBlockAfter(stepLines(lines, 8), `${SCENARIO_RUN_CONTRACT_SECTION}` →`)` contains:
    - `` `ADW_JUNIT_REPORT_PATH` ``, `` `ADW_PROOF_DIR` ``, `` `ADW_ANDROID_SERIAL` ``, `` `ADW_IOS_UDID` ``;
    - `[[ATTACHMENT|<path>]]`, `relative to the directory that holds the report`, `identical title`, `` `cucumber.filter.tags` ``, `` `features/` ``, `` `scenarios/src/test/kotlin` ``;
    - `` `${platform}/` `` for every value of `Platform`.
  - **The attachment syntax.** Replace `<path>` in the contract's `[[ATTACHMENT|<path>]]` with `android/screen.png` and wrap it in `<testsuite><testcase name="t"><system-out>…</system-out></testcase></testsuite>`. `parseJUnitXml` then gives the case `attachments: ['android/screen.png']`.
  - **The contract parses as one section.** `Object.keys(parseMarkdownSections(`${SCENARIO_RUN_CONTRACT_SECTION}\n${contract}`))` equals `['scenario run contract']`.
- **`describe('… .adw/project.md of a mobile:kotlincm repository', …)`**
  - **`it.each(DEVICE_SOURCES)`: each section gets a default.** A step-3 line holds `` `${heading}` → `` followed by a backticked value that starts with the prefix. An empty prefix only requires a value.
  - **Owner values are kept; other types get no sections.**
    - Step 3 says to preserve a value the section already holds (`preserve the value verbatim`).
    - It says to leave the four sections out for any other type (`leave them out`).
  - **The planner is pointed at the contract.** Step 3 has a line under `## Relevant Files` that holds both `` `.adw/scenarios.md` `` and `` `${SCENARIO_RUN_CONTRACT_SECTION}` ``.
- **The report.** Step 11 names `` `mobile:kotlincm` ``, each of the four device-source headings, and both `default` and `preserved`.

Import `parseMarkdownSections` from `../core/projectConfig`, `parseJUnitXml` from `../core/testReportParser`, `stackCoherenceCheck` and `inferStackLanguages` from `../core/stackCoherenceCheck`, `isGherkinFramework` and `stepDefExtensionsFor` from `../core/stepDefDetection`, and `APPLICATION_TYPE_PROFILES` and `Platform` from `../core/applicationType`. Import the modules directly, not through the `../core` barrel. Keep the file under 300 lines. Run it: red.

### 6. Step 2 of `adw_init.md`: the Gradle commands and the dev server of a `mobile:kotlincm` repository
- **`## Run Tests`**
  - Under its first sub-bullet (the preserve rule), add a nested bullet:
    ```md
             - For `mobile:kotlincm`, a section that holds no command but `N/A` is not a custom command: an earlier run wrote it while the repository had no manifest. Treat the section as absent, and drop the comment line that may stand beside the `N/A`.
    ```
  - As the first item of the **If the section is absent** list, before **vitest**, add:
    ```md
           - **`mobile:kotlincm`**, whatever the detected language and also when there is no manifest yet → `./gradlew test -x :scenarios:test --continue; exit_code=$?; { echo '<testsuites>'; find . -path ./scenarios -prune -o -path '*/build/test-results/*' -name 'TEST-*.xml' -exec sed 's/<?xml[^?]*?>//' {} +; echo '</testsuites>'; } > "$ADW_UNIT_TEST_REPORT_PATH"; exit $exit_code`, alone in the section and exactly as written. It runs the `test` task of every module except `:scenarios`, whose scenarios the scenario phase runs on the devices ADW boots, and gathers the per-class JUnit reports Gradle writes under each module's `build/test-results/` into the one file ADW reads.
    ```
- **`## Run Build`**: add the sub-bullet:
  ```md
         - **`mobile:kotlincm`**, whatever the manifests show and also when there is none yet → `./gradlew build -x test`: Gradle's `build` without its `test` tasks, because the unit-test phase runs the unit tests and the scenario phase runs `:scenarios:test` on the devices ADW boots.
  ```
- **`## Start Dev Server`**
  - Replace `Determine the correct value from the application type decided in step 1:` with `Determine the correct value from the application type step 3 writes (the type it preserves, or the one step 1 detects):`.
  - Change the `N/A` bullet to `- **`cli`, `mobile:kotlincm`, or undecided** → `N/A``.
  - Leave the `web` bullet and the `{PORT}` note untouched. The existing tests need `` `web` ``, `{PORT}` and `whatever test runners the repository has`, and must not find `webServer` on the same line as `` `N/A` ``.
- **The scenario-command note** at the end of step 2: change its parenthesis to `(ADW's Playwright project for `web`; the `:scenarios` Gradle module for `mobile:kotlincm`; Cypress, Cucumber or default Cucumber otherwise)`.
- Do not change the other sections' rules. With no manifest they still yield `N/A` (package manager, install, linter, type check, prepare, additional type checks, library install, script execution), as Reeve's files show.

### 7. Step 3 of `adw_init.md`: the device sources and the pointer to the contract
- Under `## Relevant Files`, add the sub-bullet:
  ```md
       - For `mobile:kotlincm`, include `.adw/scenarios.md`: its `## Scenario Run Contract` says what the repository's `:scenarios` Gradle module must do for ADW.
  ```
- After the `## Application Type` bullet and its three sub-bullets, add:
  ```md
     - `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime` — the device sources: what ADW creates each workflow's Android emulator and iOS simulator from. Write these four sections only when the `## Application Type` this step writes is `mobile:kotlincm`; for any other type, or none, leave them out.
       - If the existing `.adw/project.md` has the section and it holds a value, preserve the value verbatim. The owner may have chosen other images or devices, and an upgrade must not reset them.
       - Otherwise write the default, alone on its line:
         - `## Android System Image` → `system-images;android-36;google_apis;arm64-v8a` (an `sdkmanager` package path)
         - `## Android Device Profile` → `pixel_8` (an `avdmanager` device id)
         - `## iOS Device Type` → `com.apple.CoreSimulator.SimDeviceType.iPhone-16` (a `simctl` device type identifier)
         - `## iOS Runtime` → `com.apple.CoreSimulator.SimRuntime.iOS-26-0` (a `simctl` runtime identifier)
  ```
- Leave the `## Application Type` bullet line exactly as #1043 left it. The test "offers exactly the application types the mapping knows" reads every backticked token on that one line.

### 8. Step 8 of `adw_init.md`: the `mobile:kotlincm` branch and the scenario run contract
Insert the branch directly after the `web` branch's last bullet (`` `## Step Def Directory` → `features/steps` ``) and before `- For any other application type, or an undecided one, take the first of these that matches:`. Write no bold `**Cypress**` or `**Cucumber**` in it, because the branch-order test looks for those markers. The text, with the contract as an indented ```` ```md ```` block (shown here inside a four-backtick fence):

````md
   - If the application type is **`mobile:kotlincm`**, whatever scenario tooling the repository has, and also when it has no manifest yet (the repository's own `:scenarios` Gradle module runs the scenarios with cucumber-jvm, on the devices ADW boots for each workflow):
     - `## Scenario Directory` → `features/`
     - `## Run Scenarios by Tag` → `./gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"`
     - `## Run Regression Scenarios` → `./gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@regression"`
     - `## BDD Framework` → `cucumber-jvm`
     - `## Step Def Directory` → `scenarios/src/test/kotlin`
     - `--rerun` keeps Gradle from skipping a run whose inputs did not change: every run has new devices and a new report path.
     - `## Scenario Run Contract` → the text below, verbatim. It is what ADW passes the run and what it reads back, so the repository's `:scenarios` module, its screenshot hook and its JUnit reporter keep to it:
       ```md
       ADW runs `## Run Scenarios by Tag` from the repository root, with `{tag}` replaced by the tag it runs, and gives the run these environment variables:

       - `ADW_JUNIT_REPORT_PATH`: the absolute path of the JUnit XML report the run writes.
       - `ADW_PROOF_DIR`: the absolute path of the directory the run writes its screenshots to.
       - `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`: the Android emulator and the iOS simulator ADW created and booted for this workflow, by the AVD's name, the emulator's `adb` serial and the simulator's UDID. The run drives these two devices and never creates, boots, shuts down or deletes one.

       The `:scenarios` Gradle module runs the `.feature` files under `features/` with cucumber-jvm and the Kotlin step definitions under `scenarios/src/test/kotlin`. Its `test` task hands the `cucumber.filter.tags` system property to cucumber-jvm, so that a run executes the scenarios of its tag and no others. It builds the application, installs it on both devices and starts the Appium server its step definitions talk to.

       The report at `ADW_JUNIT_REPORT_PATH`:

       - holds one `<testcase>` per scenario and platform. Its `name` is the scenario's title as the `.feature` file spells it, and the Android and the iOS run of a scenario report the identical title. A Scenario Outline row is titled with the outline's title, its `<column>` placeholders filled in from the row, or `Example #<n>` for the outline's n-th row when the title names no column.
       - names each screenshot of a case on a line of its own in that case's `<system-out>`: `[[ATTACHMENT|<path>]]`, the path relative to the directory that holds the report.

       Each screenshot is a `.png` or `.jpg` file under `ADW_PROOF_DIR`: in `android/` when it was taken on Android, in `ios/` when it was taken on iOS. ADW reads the platform of an image from its first directory under `ADW_PROOF_DIR`, and shows the reviewer only the screenshots of the issue's own scenarios (`@adw-<issue number>`) that lie in a platform directory. A scenario about something a user sees needs a screenshot on each platform.
       ```
````

- No line of the contract may start with `#`. `.adw/scenarios.md` is parsed on `## ` lines, and the step-5 test enforces this.
- The always-included `## Per-Issue Scenario Directory` and `## Regression Scenario Directory`, the vocabulary template copy and the observability-surfaces drafting apply to this branch as to every other.

### 9. Step 11 of `adw_init.md`: report what was written for `mobile:kotlincm`
- Change the `## BDD Framework` / `## Step Def Directory` note to `(`web`, `mobile:kotlincm` and Cucumber/Gherkin branches only)`.
- After it, add:
  ```md
     - For `mobile:kotlincm`: the `## Scenario Run Contract` written to `scenarios.md`; each of `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime` in `project.md` as `default` or `preserved`; and whether the Gradle `## Run Tests` was written, replaced an `N/A`, or a custom command was preserved.
  ```
- Run `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/adwInitPrompt.mobile.test.ts`. All green, including:
  - step numbering 1–11;
  - "names no `.adw/` file but those adw_init writes";
  - the step-8 branch order;
  - the step-2 dev-server tests.

### 10. Pin and write the descriptor-mode device note in `generate_step_definitions.md`
- **Tests first.** In `generateStepDefinitionsPrompt.test.ts`:
  - Import `Platform` from `../core/applicationType`, and `ADW_INIT_PATH`, `readLines`, `stepLines` and `SCENARIO_RUN_CONTRACT_SECTION` from `./adwInitPrompt.helpers`.
  - Add `describe('generate_step_definitions.md in descriptor mode tells the steps of a repository on devices which device to drive and where its screenshots go', …)` with `descriptorMode()`: the lines of `section('## Runner mode')` from the line starting with ``- `descriptor` `` up to the line starting with ``- `adw_playwright` ``.
  - The tests:
    - **`it.each(['ADW_ANDROID_SERIAL', 'ADW_IOS_UDID', 'ADW_PROOF_DIR'])`: names %s.** `descriptorMode()` contains `` `${variable}` ``.
    - **`it.each(Object.values(Platform))`: names the %s/ directory under ADW_PROOF_DIR.** `descriptorMode()` contains `` `${platform}/` ``.
    - **Applies where adw_init writes the contract.** `descriptorMode()` contains `` `${SCENARIO_RUN_CONTRACT_SECTION}` ``, and step 8 of `adw_init.md` contains the same backticked heading.
    - **Listed among the sections the prompt branches on.** `section('## Polymorphism on `.adw/scenarios.md`')` contains `SCENARIO_RUN_CONTRACT_SECTION`.
    - **Never touches a device's life cycle.** `descriptorMode()` matches `/never create, boot, shut down or delete/`.
    - **Names no framework.** `descriptorMode()` does not match `/appium|cucumber|kotlin|gradle|uiautomator|xcuitest/i`.
  - Run: red.
- **The prompt.** Change `.claude/commands/generate_step_definitions.md`:
  - Replace the `descriptor` bullet of `## Runner mode` with:
    ```md
    - `descriptor`, or empty: the runner `.adw/scenarios.md` names. The rest of this prompt applies exactly as written. When `.adw/scenarios.md` has a `## Scenario Run Contract` section, the scenarios drive the application on an Android emulator and an iOS simulator that ADW creates and boots for each run, and the step definitions and their hooks keep to that contract:
      - The run receives the devices in its environment: `ADW_ANDROID_SERIAL`, the emulator's `adb` serial, and `ADW_IOS_UDID`, the simulator's UDID (`ADW_ANDROID_AVD` names the emulator's AVD). Point each platform's session at its device through these variables. Never hard-code a device, and never create, boot, shut down or delete one: ADW does.
      - Write every screenshot under the directory in `ADW_PROOF_DIR`: in its `android/` directory for an image taken on Android, in its `ios/` directory for one taken on iOS, for example `$ADW_PROOF_DIR/android/<name>.png`. ADW reads the platform of an image from that first directory, and never shows the reviewer an image that lies anywhere else.
      - End every scenario about something a user sees with a screenshot on each platform, and name each image in the report the way the contract says.
    ```
  - In `## Polymorphism on `.adw/scenarios.md``, after the `**Vocabulary registry**` entry, add:
    ```md
    **Scenario Run Contract** (Runner mode, Step 6):
    - If `## Scenario Run Contract` is set → the scenarios run on the devices ADW boots: follow the contract and the device notes of `descriptor` under Runner mode.
    - If absent → the run receives no device, and screenshots need no platform directory.
    ```
  - In `### 1. Read configuration`, add `` - `## Scenario Run Contract` — present when the scenarios run on devices ADW boots; see Runner mode. ``
  - Keep the sentence `` `descriptor`, or empty: … applies exactly as written `` verbatim.
  - Write no backticked `adw_…` token: "names no runner mode ADW does not pass" would read it as a runner mode.
  - Leave `.claude/commands/scenario_writer.md` unchanged (story 8).
- Run `bunx vitest run adws/__tests__/generateStepDefinitionsPrompt.test.ts`: green.

### 11. Update the README
- After `A value set by hand survives regeneration.` in the `adw_init` paragraph (line ~259), add:
  ```md
  When the type is `mobile:kotlincm`, `adw_init` then writes the descriptors the repository's own `:scenarios` Gradle module needs, even before the repository has a manifest: a Gradle unit-test command (every module's `test` task except `:scenarios:test`, its JUnit reports gathered into `$ADW_UNIT_TEST_REPORT_PATH`) and `./gradlew build -x test`, `N/A` for the dev server, `cucumber-jvm` with Kotlin step definitions under `scenarios/src/test/kotlin`, run-by-tag and regression commands for `:scenarios` with a cucumber tag filter, the four device-source sections of `.adw/project.md` (`## Android System Image`, `## Android Device Profile`, `## iOS Device Type`, `## iOS Runtime`: defaults when absent, kept when set) and a `## Scenario Run Contract` in `.adw/scenarios.md` (the device variables, the JUnit attachment lines and the `android/` and `ios/` screenshot directories). For this type a `## Run Tests` that holds only `N/A` is replaced; any other existing command is kept.
  ```
- In the `adws/__tests__/` listing, add `adwInitPrompt.helpers.ts  # Shared helpers for the adw_init prompt tests` and `adwInitPrompt.mobile.test.ts`, in alphabetical order beside `adwInitPrompt.test.ts`.

### 12. Write the step definitions the `@adw-1044` scenarios need
- If `features/per-issue/feature-1044.feature` exists and `/generate_step_definitions` has not covered it, write the missing step definitions:
  - in `features/per-issue/step_definitions/feature-1044-*.ts`, each file under 300 lines;
  - after reading every existing step file under `features/`, so that no pattern is registered twice.
- Read the prompts' step and section boundaries the way the unit tests do (numbered `N. **` step headings and `## ` sections). Assert on what `adw_init.md` tells the agent to write, never on the result of an LLM run. Do not import vitest code into step definitions.
- Do not edit any `.feature` file.

### 13. Run the validation commands
Run every command in `Validation Commands`. Fix any failure before finishing.

## Testing Strategy
### Unit Tests
- `adws/__tests__/adwInitPrompt.test.ts`:
  - The existing tests are unchanged and green after the helper move.
  - New tests:
    - step 1 detects only `cli` and `web`, both keys of the mapping, and never names `mobile:kotlincm`;
    - step 1 makes a mobile app undecided;
    - the step-3 preserve rule names every key of `APPLICATION_TYPE_PROFILES`;
    - `hashInputs` lists `.claude/commands/adw_init.md` itself.
- `adws/__tests__/adwInitPrompt.mobile.test.ts`:
  - **`commands.md`**: the Gradle unit-test command with `$ADW_UNIT_TEST_REPORT_PATH` and `-x :scenarios:test`; the `N/A` carve-out; `./gradlew build -x test`; `N/A` for the dev server, keyed on the type step 3 writes; the scenario-command note.
  - **`scenarios.md`**: `cucumber-jvm`, `scenarios/src/test/kotlin`, both Gradle scenario commands; the branch order; the contract's variables, attachment line, identical-title rule and one directory per `Platform`.
  - **`project.md`**: a default for each device-source section, the preserve rule, nothing for other types, and the `## Relevant Files` pointer.
  - **Step 11**: the report.
  - **Checks against ADW's code**:
    - `stackCoherenceCheck` reads the mobile descriptors as `jvm` only, with no warning;
    - `isGherkinFramework` and `stepDefExtensionsFor` accept `cucumber-jvm` with `.kt`;
    - `parseJUnitXml` reads the contract's attachment syntax;
    - `parseMarkdownSections` reads the contract as one section.
- `adws/__tests__/generateStepDefinitionsPrompt.test.ts`:
  - The existing tests are unchanged and green, including "names no runner mode ADW does not pass" and "keeps every other mode … exactly as written".
  - New tests on the descriptor-mode note:
    - it names `ADW_ANDROID_SERIAL`, `ADW_IOS_UDID` and `ADW_PROOF_DIR`, and one directory per `Platform`;
    - it is tied to the `## Scenario Run Contract` heading that `adw_init.md` writes, and listed in the polymorphism section;
    - it never creates, boots, shuts down or deletes a device;
    - it names no framework.
- Unchanged, and still green: `adws/core/__tests__/stackCoherenceCheck.test.ts`, `stepDefDetection.test.ts`, `applicationType.test.ts` and `adws/__tests__/reviewPrompt.test.ts`.

### BDD Scenarios
The pipeline's scenario writer writes `features/per-issue/feature-1044.feature` (`@adw-1044`) separately. Step 12 covers its step definitions. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044"` must report no undefined or failing step, and `@regression` must stay green: no regression feature reads the edited prompt text. `@framework-hash` (feature-537) asserts only a well-formed, stable digest.

### Edge Cases
- **A hand-set `mobile:kotlincm` with no manifest (Reeve).** Step 2 writes the Gradle commands and step 8 the mobile descriptors and the contract. Step 3 writes the four device-source defaults, and `## Start Dev Server` is `N/A`.
- **An earlier manifest-less run left `# JUnit emission is not configured …` and `N/A` under `## Run Tests`.** For `mobile:kotlincm` the section is replaced, comment line included. A real custom command is preserved verbatim for every type, `mobile:kotlincm` included.
- **The owner changed `## iOS Runtime`.** The upgrade keeps the value. An empty or absent section gets the default.
- **`cli` and `web` repositories.** No device-source section and no contract. Their `.adw/` output is unchanged, apart from the dev-server rule now keying on the type step 3 writes, which a hand-set `web` that detection would miss also benefits from.
- **An untyped mobile app** (Kotlin Multiplatform, Flutter, React Native): undecided. `## Application Type` is left out, and the issue parks with `missing_application_type` instead of being guessed `cli`. A hand-set `cli` on such a repository is still preserved.
- **`{tag}` substitution.** `-Dcucumber.filter.tags="@adw-1044"` and `"@regression"`, run from the worktree root through a shell.
- **The same tag run twice with no source change** (a retry, a no-progress fix round): `--rerun` runs it anyway, so a fresh report exists.
- **No unit test at all.** The wrapper parses to `null` and the verdict is `unverified`, not a zero-case hard-fail. A module whose tests fail: `--continue` runs the rest, and the command exits with Gradle's code.
- **A scenario run earlier in the same worktree.** `./scenarios` is pruned, so its results never enter the unit report.
- **The contract text.** No line starts with `#`, so `.adw/scenarios.md` keeps its sections. The attachment syntax is the one `testReportParser` reads.
- **The step-definition prompt.** No backticked `adw_…` token, the `descriptor` sentence verbatim, no framework named.
- **`adw_init.md`.** No new numbered step. No `.adw/` file named but the five required ones and `coding_guidelines.md`. No bold `**Cypress**` or `**Cucumber**` before the Cypress branch.

## Acceptance Criteria
- Step 1 of `adw_init.md` lists detection signals only for `cli` and `web`, never names `mobile:kotlincm`, and treats a mobile app as undecided. Step 3 preserves `cli`, `web` or `mobile:kotlincm` verbatim.
- For a `mobile:kotlincm` that step 3 writes, with or without a manifest, step 2 writes to `.adw/commands.md`:
  - `## Run Tests`: the Gradle unit-test command that writes `$ADW_UNIT_TEST_REPORT_PATH` and excludes `:scenarios:test`, replacing an `N/A` and preserving a custom command;
  - `## Run Build`: `./gradlew build -x test`;
  - `## Start Dev Server`: `N/A`;
  - `## Run Scenarios by Tag` and `## Run Regression Scenarios`: the Gradle scenario commands.
- Step 8 writes to `.adw/scenarios.md` `## Scenario Directory` `features/`, `## BDD Framework` `cucumber-jvm`, `## Step Def Directory` `scenarios/src/test/kotlin`, `./gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"` and its `@regression` twin, and the verbatim `## Scenario Run Contract`. The contract documents:
  - `ADW_JUNIT_REPORT_PATH`, `ADW_PROOF_DIR`, `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`;
  - the identical-title rule;
  - `[[ATTACHMENT|<path>]]` relative to the report's directory;
  - the `android/` and `ios/` directories under `ADW_PROOF_DIR`.
- Step 3 writes `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime` to `.adw/project.md`, each with its default when absent or empty, preserving a value that is set, and only for `mobile:kotlincm`. It also lists `.adw/scenarios.md` under `## Relevant Files` for that type.
- In descriptor mode, `generate_step_definitions.md` names `ADW_ANDROID_SERIAL`, `ADW_IOS_UDID`, `ADW_PROOF_DIR` and the `android/` and `ios/` convention for screenshots. The note applies when `.adw/scenarios.md` has `## Scenario Run Contract`, and names no framework.
- `adwInitPrompt.test.ts`, `adwInitPrompt.mobile.test.ts` and `generateStepDefinitionsPrompt.test.ts` pin the new text and pass. `adw_init.md` stays in its own `hashInputs`, so the edit bumps the framework hash.
- `bun run lint`, both type checks, `bun run build`, `bun run test:unit`, `bun run lint:branch-names` and the `@adw-1044` and `@regression` scenario runs all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/adwInitPrompt.mobile.test.ts adws/__tests__/generateStepDefinitionsPrompt.test.ts` — the prompt pins.
- `bunx vitest run adws/core/__tests__/stackCoherenceCheck.test.ts adws/core/__tests__/stepDefDetection.test.ts adws/core/__tests__/applicationType.test.ts adws/core/__tests__/testReportParser.test.ts adws/__tests__/reviewPrompt.test.ts` — the sources the pins compare with are unchanged.
- `bun run lint` — linter.
- `bunx tsc --noEmit` — type check of every `**/*.ts`, including the new helpers and test files and `features/`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type check.
- `bun run build` — build.
- `bun run test:unit` — the full unit suite, zero regressions.
- `bun run lint:branch-names` — the edited prompts under `.claude/commands/` name no branch.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044"` — this issue's scenarios, none undefined.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite, zero regressions.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`):
  - every file under 300 lines (hence `adwInitPrompt.mobile.test.ts` and the helpers file);
  - immutable `as const` constants;
  - comments only for non-obvious reasons;
  - no issue numbers in comments or prompt text;
  - no restating comments.
- No new library. `.adw/commands.md` names `bun add <package>` should one ever be needed.
- **The framework hash.** `.claude/commands/adw_init.md` is a `hashInputs:` file, so merging bumps the framework hash. Every registered target repository, ADW included, then regenerates `.adw/` on its next workflow. For `cli` and `web` repositories the output is unchanged, apart from the dev-server rule now keying on the type step 3 writes, which steps 6 and 8 already did.
- **A consequence for the Reeve bootstrap that the PRD does not name.** The baseline phase runs the base branch's own `.adw/commands.md`.
  - Once this regen is on Reeve's default branch, the bootstrap issue's baseline runs `./gradlew build -x test` in a checkout with no Gradle wrapper. That fails (`./gradlew: No such file or directory`) and parks the issue as `baseline_red`.
  - `## Continue` on that park "waives the baseline, so that this run fixes the pre-existing failures too", which is exactly the bootstrap's situation.
  - The commands are deliberately not guarded on `gradlew` existing: such a guard would also pass a static check after a fix round that deletes the wrapper.
  - The PRD's Reeve sequence should gain the `## Continue` step, or a follow-up can teach the baseline about a base branch with no build yet.
- **This slice documents the contract ahead of its consumers:**
  - #1047 passes `ADW_ANDROID_AVD`, `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`;
  - #1045 parses and requires the four device-source sections, one value per section, alone on its line, as written here;
  - #1046 attributes images by their first directory and drops unattributed ones.

  Until those land, a mobile run receives no device variables, and the scenario proof stays skipped while no Kotlin step definition exists (story 45).
- **The device-source defaults** follow PRD story 24. The owner edits a section when the host differs: #1040 installs the system image and the simulator runtime the sections name. A host without `iOS-26-0` needs `## iOS Runtime` edited, or that runtime installed.
- **Gradle couplings:**
  - `--rerun` needs Gradle 7.6 or later.
  - `-x :scenarios:test` needs the `:scenarios` project to exist (Gradle rejects an unknown task path). The PRD has the bootstrap issue create it together with the application.
  - The `/test` agent's 5-minute `TEST_COMMAND_TIMEOUT` may be tight for a cold Gradle build. The build check runs `./gradlew build -x test` first and warms the daemon and caches.
- **Follow-ups outside this slice:**
  - The `## Run Tests` preserve rule also keeps a manifest-less `N/A` for `cli` and `web` repositories that later gain a test framework.
  - The observability-surfaces classification has no mobile class: a Gradle and Appium repository classifies as CLI-only.
- `scenario_writer.md` stays unchanged (story 8). The step-definition prompt stays one polymorphic prompt (ADR-0043): the note speaks of devices, variables and directories, never of Appium, cucumber-jvm or Kotlin.
- Leave `app_docs/feature-9gjajh-commands-and-skills.md`, `app_docs/feature-gfv9kt-application-type-mapping.md` and ADR-0064's `### Confirmation` to `/document`.
- Nothing here is live on the pipeline host until a release to the production branch and a host restart (ADR-0064).
