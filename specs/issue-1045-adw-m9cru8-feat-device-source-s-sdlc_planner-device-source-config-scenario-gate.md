# Feature: Device-source sections in `.adw/project.md`, required by the scenario phase for a profile with platforms

## Metadata
issueNumber: `1045`
adwId: `m9cru8-feat-device-source-s`
issueJson: `{"number":1045,"title":"feat: device-source sections in .adw/project.md, required by the scenario phase for a profile with platforms","body":"## Parent PRD\n\n`specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record: `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`)\n\n## What to build\n\nA pure parser turns the four device-source sections of `.adw/project.md` into a device-source value on the project config. For a profile with platforms, the scenario phase requires it before running anything and fails with a message naming the missing or empty section; the issue does not park. For a profile without platforms the sections are ignored. See PRD \"Device source config\".\n\n## Acceptance criteria\n\n- [ ] `parseProjectConfig` exposes the four sections (comments stripped, trimmed); absent or empty is `null` per section\n- [ ] A pure function resolves them into a device-source value or an error naming the first missing section\n- [ ] In a worktree whose profile has platforms and a missing section, `executeScenarioTestPhase` fails the phase with that message and runs no scenario command\n- [ ] A `cli` or `web` worktree with none of the sections is unaffected\n- [ ] Unit tests for the parser (PRD Testing Decisions 2), with the project-config tests as prior art\n\n## Blocked by\n\n- Blocked by #1043\n\n## Touched Files\n\n- adws/core/projectConfig.ts\n- adws/core/__tests__/projectConfig.test.ts\n- adws/core/deviceSourceConfig.ts\n- adws/core/__tests__/deviceSourceConfig.test.ts\n- adws/phases/scenarioTestPhase.ts\n- adws/phases/__tests__/scenarioTestPhase.test.ts\n\n## User stories addressed\n\n- User stories 23, 26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-18T15:00:09Z","comments":[],"actionableComment":null}`

## Feature Description

This is a slice of `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record ADR-0064). #1043 added the `mobile:kotlincm` type and its `platforms` (`android`, `ios`). In a later slice (#1047), ADW will create one Android emulator and one iOS simulator per workflow for such a profile. To do that it needs four inputs, and the PRD puts them in four new optional sections of `.adw/project.md`:

| Section | What it holds |
|---|---|
| `## Android System Image` | an SDK package path, such as `system-images;android-35;google_apis;arm64-v8a` |
| `## Android Device Profile` | an `avdmanager` device id, such as `pixel_8` |
| `## iOS Device Type` | a `simctl` device type identifier |
| `## iOS Runtime` | a `simctl` runtime identifier |

This slice reads the sections, resolves them and enforces them. It does not boot devices (#1047) and does not write default values (#1044, `adw_init`).

- **Read.** A pure parser, `parseDeviceSourceSections`, in the new `adws/core/deviceSourceConfig.ts` turns the four sections into `DeviceSourceSections`. Each value is taken as written, with HTML comments stripped and whitespace trimmed. A section that is absent or empty is `null`. `loadProjectConfig` exposes the result as `ProjectConfig.deviceSources`. The default config has all four set to `null`.
- **Resolve.** A pure `resolveDeviceSource(sections, platforms)` has three outcomes:
  - `not_required` for a profile without platforms. The sections are ignored.
  - `resolved` with the device-source value (four strings) when every section is set.
  - `missing` with the heading of the first missing or empty section (in the order of the table above) and a message that names it.
- **Enforce.** For a profile with platforms, `executeScenarioTestPhase` resolves the device source before it does anything else. A missing section:
  - writes the message to the run log;
  - throws `DeviceSourceConfigError` before the runner, the skip checks, the dev server or any scenario command run;
  - is turned by the orchestrator's `handleWorkflowError` into an error comment on the issue that carries the message. The workflow fails and the issue is **not** parked.

  `cli` and `web` declare no platforms, so the phase behaves exactly as before for them.

The owner of a mobile repository chooses the images and devices the scenarios run on. A missing value shows up as one clear message naming the section, instead of a cryptic `avdmanager` or `simctl` error later in device creation.

## User Story
As a repository owner of a `mobile:kotlincm` repository
I want to name the Android system image, the Android device profile, the iOS device type and the iOS runtime in `.adw/project.md`, and have the scenario phase stop with the section named when one is missing or empty
So that I decide which images and devices my scenarios run on, and never debug a cryptic `avdmanager` or `simctl` error

## Problem Statement

- `.adw/project.md` has no place for device sources. `loadProjectConfig` reads only `## Application Type` from it (`parseApplicationType`).
- The device lifecycle of #1047 will create an AVD and a simulator from these four values. If nothing checks them first:
  - a missing value surfaces deep inside device creation as a tool error;
  - after #1048, it would even park the issue as `device_boot_failed`, which blames the host.
- The PRD and ADR-0064 decide the behaviour:
  - For a profile with platforms, a missing or empty section fails the scenario phase with the section named, and the issue does not park.
  - For a profile without platforms, the sections are ignored.
- `adws/core/projectConfig.ts` is already 280 lines. Adding the parser there would push it to the 300-line limit of the coding guidelines. No other `adws/core` module is over 300 lines.

## Solution Statement

- **One pure module for the device-source config.** `adws/core/deviceSourceConfig.ts` holds:
  - the section headings (`DEVICE_SOURCE_SECTION_TITLES`, in report order);
  - the two value types: `DeviceSourceSections`, with each section nullable, and `DeviceSource`, the resolved value;
  - the parser, `parseDeviceSourceSections`;
  - the resolver, `resolveDeviceSource`;
  - the error a phase throws, `DeviceSourceConfigError`.

  The resolver follows the `ApplicationTypeResolution` pattern: a closed, discriminated result and no throwing.
- **Markdown helpers in a module of their own.** `parseMarkdownSections` and `stripHtmlComments` move from `projectConfig.ts` into a new pure `adws/core/markdownSections.ts`, together with a new `sectionValue(sections, heading)`. `sectionValue` returns the value as written, comments stripped and trimmed, or `null`.
  - `projectConfig.ts` (`parseApplicationType`, `parseScenariosMd`, the commands and providers parsers), `baselineGate.ts` and `deviceSourceConfig.ts` all import from it.
  - The dependency graph stays acyclic: `projectConfig` → `deviceSourceConfig` → `markdownSections`. `deviceSourceConfig` imports `Platform` from `applicationType` as a type only.
  - `projectConfig.ts` drops to about 255 lines.
- **The project config exposes the sections.** `ProjectConfig.deviceSources: DeviceSourceSections` is filled by `parseDeviceSourceSections(projectMd)` in `loadProjectConfig` and by `parseDeviceSourceSections('')` in `getDefaultProjectConfig`, the way `conditionalDocs` is filled by `parseConditionalDocs('')`. Consumers read it only through `resolveDeviceSource`.
- **The scenario phase requires the device source first.**
  - Right after `requireApplicationProfile(config)`, a small `requireDeviceSource` resolves the sections against `applicationProfile.platforms`. On `missing` it records the message and throws `DeviceSourceConfigError`.
  - A thrown error is how a phase fails in this codebase. `runPhase` rethrows it, and every orchestrator's `catch` calls `handleWorkflowError`: an error comment with `String(error)`, board status Blocked, stage `abandoned`, and no park.
  - A result status would be wrong. The fix loop would read it as a failing scenario and send it to the fix agent. The review loop would read it as a failed dev-server start and spend a review attempt.
- **No consumer learns the type's name.** The resolver takes `platforms`, and the message names the platforms (`android, ios`), never `mobile:kotlincm`. This keeps the guard test that allows only `core/projectConfig.ts` and `phases/applicationTypeGate.ts` to name `applicationType`.
- **Scenario fixtures stay true to what `adw_init` writes.** The shared fixture `freshAdwFiles` writes the four sections, with sample values, for a type whose profile has platforms. Steps can set, empty or remove each section, for any type.
  - The scenario writer has already edited the merged `@adw-1043` scenarios that run the real scenario phase on a `mobile:kotlincm` worktree.
  - They now also carry `@adw-1045`, and each names its device sources with an explicit step. This build defines those steps (Task 7).

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview. Holds the "Application type decides the evidence" bullet and the `adws/core/` tree that must list the new modules. In this worktree it already carries uncommitted tree additions: keep them.
- `.adw/coding_guidelines.md` — the rules to follow:
  - files under 300 lines;
  - pure functions;
  - guard clauses;
  - `readonly` data;
  - comments only for what the code cannot say.
- `adws/README.md` — conventions for the `adws/` directory.
- `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` — the PRD: "Device source config", user stories 23 and 26, Testing Decisions 2.
- `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md` — the decision record: device sources come from four `.adw/project.md` sections, and a missing one fails the scenario phase naming the section.
- `app_docs/feature-9gjajh-state-and-config.md` — owner doc of `projectConfig.ts`. Covers the `parseMarkdownSections` behaviour (only `##` headings) and the comment stripping of `.adw/` values.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — owner doc of `scenarioTestPhase.ts`: the skip rules, the declared dev server and failed starts.
- `app_docs/feature-gfv9kt-application-type-mapping.md` — owner doc of the mapping:
  - `ApplicationProfile.platforms`;
  - `Platform`;
  - "consumers read the mapping, never the type".
- `adws/core/projectConfig.ts` — `ProjectConfig`, `getDefaultProjectConfig`, `loadProjectConfig` and `parseApplicationType`. Gains `deviceSources`. Gives up `parseMarkdownSections` and `stripHtmlComments` to `markdownSections.ts`.
- `adws/core/baselineGate.ts` — imports `parseMarkdownSections` from `./projectConfig` (line 11). Point the import at `./markdownSections`.
- `adws/core/index.ts` — re-exports `parseMarkdownSections` from `./projectConfig` (line 82). Re-export it from `./markdownSections` instead.
- `adws/core/applicationType.ts` — read only. Provides:
  - `Platform`;
  - `ApplicationProfile` (whose `platforms` is empty for `cli` and `web`, and `[android, ios]` for `mobile:kotlincm`);
  - `APPLICATION_TYPE_PROFILES`.
- `adws/core/__tests__/projectConfig.test.ts` — prior art for parser tests: per-section HTML-comment placements and `parseApplicationType`'s null cases. It gains the tests for `deviceSources` on the project config.
- `adws/core/__tests__/projectConfigLoad.test.ts` — read only. Prior art for `loadProjectConfig` tests on a temporary `.adw/` directory (`repoWithProjectMd`). Must stay green.
- `adws/core/__tests__/projectConfigCommands.test.ts` — read only. Must stay green after the helper move.
- `adws/core/__tests__/applicationType.test.ts` — read only. Its guard test "every consumer reads the mapping, never the type" fails if any new or changed module other than `core/projectConfig.ts` or `phases/applicationTypeGate.ts` uses the identifier `applicationType`.
- `adws/phases/scenarioTestPhase.ts` — `executeScenarioTestPhase`. Gains the device-source requirement right after `requireApplicationProfile`.
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — the phase's unit tests. Gains the device-source cases. Prior art:
  - the `declaring(...)` dev-server helper;
  - the mocks of `../scenarioProof`, `../../cost` and `../../core`.
- `adws/phases/__tests__/scenarioTestPhase.helpers.ts` — read only, do not edit (#1047 edits it). Provides `makeConfig({ applicationProfile })`, `fakeLifecycle` and `passingProof`. Its `projectConfig` literal is cast and has no `deviceSources`.
- `adws/phases/applicationTypeGate.ts` — read only. `requireApplicationProfile` (used by the phase) and `declaredApplicationProfile` (used by the fixtures).
- `features/regression/step_definitions/feature-992-adw-files.ts` — the shared fixture: `freshAdwFiles`, `renderAdwFiles` and `writeAdwFiles` write a worktree's `.adw/` "as `adw_init` would". It gains the device-source sections for a type whose profile has platforms.
- `features/regression/step_definitions/feature-991-project-md.ts` — read only. `projectMd(applicationType)`, the `.adw/project.md` body that `renderAdwFiles` writes.
- `features/regression/step_definitions/feature-992-phase.steps.ts` — shared steps that #1045's scenarios reuse:
  - `a workflow for issue {int} whose worktree's {string} declares the application type {string}`;
  - the BDD-framework step and the stand-in run-by-tag steps;
  - the steps that put a feature and its steps in the worktree, and the web steps (`{string} is a stand-in that records each run and writes a JUnit report in which every scenario passes`, `{string} ran in {string} before {string} ran there for the tag {string}`);
  - `When the workflow's scenario test phase runs`, which rethrows a phase error;
  - `the scenario command {string} configures ran in the worktree's root for the tag {string}` and `the scenario proof records the tag {string} as passed`;
  - the recorded stand-in calls.

  Its `prepareWorkflow` is private. Export it for the new "attempted" step (Task 7).
- `features/per-issue/step_definitions/feature-994-workflow.ts` — read only. Its `prepareWorkflow` also writes `.adw/` through `freshAdwFiles` and `writeAdwFiles` (the `@adw-1043` review outline 104313–104315). Then it writes the files of feature-994's `s.adwFiles` (`feature-994-world.ts`) over them. The review outline's new step `the workflow's {string} names …` puts its `.adw/project.md` there (Task 7).
- `features/per-issue/feature-1043.feature` — the scenario writer has already edited it for this issue. Keep those edits and make no others. Its scenarios that run the real scenario test phase on a `mobile:kotlincm` worktree now also carry `@adw-1045`: 104308 and 104309, 104310, and the review outline 104313–104315. Each names its device sources:
  - `And the worktree's ".adw/project.md" names every device source` (104308, 104309, 104310);
  - `And the workflow's ".adw/project.md" names <device sources>`: `every device source` for `mobile:kotlincm` (104313), and `no device source` for `cli` (104314) and `web` (104315).

  Task 7 defines both steps. Tasks 6 and 7 keep these scenarios green.
- `features/per-issue/feature-1045.feature` — the `@adw-1045` scenarios, written by the scenario writer. They cover:
  - **The parser, read through the project configuration.** Values are as written, with comments stripped and whitespace trimmed. A missing, empty or comment-only section reads as none. No default is filled in, also for a repository with no `.adw/` directory.
  - **The resolver.** All four sections resolve. Each missing section is named, and of several missing sections, the first.
  - **A `mobile:kotlincm` worktree with a missing or empty section (104501–104503).** The scenario test phase fails naming the section, runs no scenario command and does not park.
  - **`cli` and `web` worktrees.** The phase runs as before for a `cli` worktree with none or some of the sections (104504, 104505), and for a `web` worktree with none (104506).
  - **The type check.**
- `features/per-issue/step_definitions/feature-991-mapping.steps.ts` and `feature-991-world.ts` — read only, except for exports.
  - The parser and resolver scenarios reuse two of its steps: `a repository that has no {string} directory` and `ADW reads the repository's project configuration`.
  - The second runs `loadProjectConfig` over a throwaway repository and keeps the result in feature-991's `s.projectConfig`.
  - Export `makeRepository` and `requireProjectConfig` rather than copying them.
  - The world's hooks run only for `@adw-991`.
- `features/per-issue/step_definitions/feature-1043-world.ts` — read only. Prior art for the `@adw-1045` hooks. It brings up the worlds of features 988, 991, 992 and 994, and every reset in it is safe to run twice.
- `features/per-issue/step_definitions/feature-1043-proof.steps.ts` — read only. Defines `the worktree holds a feature tagged {string} in the scenario directory {string} names, and steps for it in the file {string}`, which 104501–104503 reuse.
- `features/per-issue/step_definitions/feature-991-workflow.steps.ts` and `feature-989-phase.steps.ts` — read only. Define `the workflow for issue {int} is not parked` and `no park comment was posted on issue {int}`. Both read feature-988's shared workflow, which feature-992's workflow step sets.

### New Files
- `adws/core/markdownSections.ts` — pure. Holds:
  - `parseMarkdownSections` and `stripHtmlComments`, moved verbatim from `projectConfig.ts`;
  - the new `sectionValue`.
- `adws/core/deviceSourceConfig.ts` — pure. Holds:
  - `DeviceSourceSections`, `DeviceSource` and `DEVICE_SOURCE_SECTION_TITLES`;
  - `parseDeviceSourceSections`;
  - `DeviceSourceResolution` and `resolveDeviceSource`;
  - `DeviceSourceConfigError`.
- `adws/core/__tests__/deviceSourceConfig.test.ts` — unit tests for the parser and the resolver (PRD Testing Decisions 2).
- `features/per-issue/step_definitions/feature-1045-*.ts` — the step definitions that the `@adw-1045` scenarios need, and a `feature-1045-world.ts` with the `@adw-1045` hooks (Task 7).

## Implementation Plan
### Phase 1: Foundation
Move the generic `## Heading` helpers (`parseMarkdownSections`, `stripHtmlComments`) out of `projectConfig.ts` into `adws/core/markdownSections.ts`, and add `sectionValue`, the reader for "value as written, comments stripped, trimmed, `null` when absent or empty". `parseApplicationType` becomes a call to `sectionValue`. Behaviour does not change; the existing project-config and baseline-gate tests prove it. This makes room in `projectConfig.ts` and gives the device-source parser a dependency that does not point back at `projectConfig.ts`.

### Phase 2: Core Implementation
Create `adws/core/deviceSourceConfig.ts`, driven by its unit tests:
- the four headings in report order;
- the nullable sections type and the resolved value type;
- the pure parser;
- the pure resolver: `not_required`, `resolved`, or `missing` naming the first missing heading;
- the error class.

Then expose `ProjectConfig.deviceSources` from `loadProjectConfig` and `getDefaultProjectConfig`.

### Phase 3: Integration
- **Scenario phase.** `executeScenarioTestPhase` requires the device source right after the profile is known. A `missing` resolution:
  - writes a run-log line;
  - throws `DeviceSourceConfigError`, so the orchestrator fails the workflow with the message and does not park it;
  - runs no scenario command and starts no dev server.

  `cli` and `web` are untouched.
- **Fixtures.** The shared `.adw/` fixture writes the four sections for a profile with platforms. Its setters let a step name, for any type, every section, none, all but one, or all with one left empty. The `@adw-1045` scenarios and the edited `@adw-1043` scenarios name their device sources through those setters.
- **Step definitions and README.** Write the step definitions for `@adw-1045`, then update the README.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Move the markdown section helpers into `adws/core/markdownSections.ts`
- Create `adws/core/markdownSections.ts` with these exports:
  - `parseMarkdownSections(content)` — moved verbatim from `projectConfig.ts`, doc comment included.
  - `stripHtmlComments(value)` — moved verbatim; now exported.
  - `sectionValue(sections: Readonly<Record<string, string>>, heading: string): string | null` — strips the comments and trims the value of `sections[heading.toLowerCase()]`. Returns `null` when the result is `''`. Give it the doc comment that `parseApplicationType` carries today ("The section's value as written, comments stripped and trimmed; `null` when the section is absent or empty").
- In `adws/core/projectConfig.ts`:
  - Delete the two moved functions and import them, plus `sectionValue`, from `./markdownSections`.
  - `parseApplicationType(projectMd)` becomes `return sectionValue(parseMarkdownSections(projectMd), 'application type');` and keeps a one-line doc comment saying absent or empty is `null`.
  - `parseScenariosMd`, `parseCommandsMd` and `parseProvidersMd` keep their logic unchanged.
- In `adws/core/baselineGate.ts`, import `parseMarkdownSections` from `./markdownSections`. `type CommandsConfig` stays imported from `./projectConfig`.
- In `adws/core/index.ts`, remove `parseMarkdownSections` from the `./projectConfig` export list and add `export { parseMarkdownSections } from './markdownSections';`. No re-export shim stays in `projectConfig.ts`.
- Run `bunx vitest run adws/core/__tests__/projectConfig.test.ts adws/core/__tests__/projectConfigLoad.test.ts adws/core/__tests__/projectConfigCommands.test.ts adws/core/__tests__/baselineGate.test.ts adws/core/__tests__/baselineGate.record.test.ts`. All pass unchanged.

### 2. Write the device-source tests (red)
Create `adws/core/__tests__/deviceSourceConfig.test.ts` in the style of `projectConfig.test.ts`: one `describe` per function, `it.each` over the four sections, and the comment placements of the `parseScenariosMd — HTML comments` block. Use a local `projectMdWith(sections)` builder. Take profiles from `APPLICATION_TYPE_PROFILES` and pass `.platforms`.

**`DEVICE_SOURCE_SECTION_TITLES`:** holds exactly `Android System Image`, `Android Device Profile`, `iOS Device Type` and `iOS Runtime`, in that order. These are the headings the owner writes.

**`parseDeviceSourceSections` — each section as written, and nothing assumed:**
- Reads all four values as written from a `project.md` that has them, keeping `;`, `.`, `-`, `_` and case (`system-images;android-35;google_apis;arm64-v8a`, `pixel_8`, `com.apple.CoreSimulator.SimDeviceType.iPhone-16`, `com.apple.CoreSimulator.SimRuntime.iOS-18-2`).
- An empty `project.md` gives `null` for every section.
- `it.each` over the four: a project without that section gives `null` for it, and the other three are still read.
- A heading with an empty body, followed by another heading, is `null`.
- A body of blank lines only is `null`.
- A body that holds only an HTML comment is `null`.
- A comment above the value, after it on the same line, below it, or across several lines above it, is stripped. Only the value is left.
- Spaces and blank lines around the value are trimmed.
- The heading is found whatever its case (`## IOS RUNTIME`, `## android system image`).
- The other sections of a real `project.md` (`## Application Type`, `## Project Overview`) do not leak into any value.

**`resolveDeviceSource` — a profile with platforms needs every section:**
- `it.each` over the `cli` and `web` profiles: the result is `{ kind: 'not_required' }` both with all four sections `null` and with all four set. The sections are ignored.
- For the `mobile:kotlincm` profile with all four set, the result is `resolved`, and its `deviceSource` carries each value in its field.
- `it.each` over the four sections: when that one is `null`, the result is `missing` and its `section` is `## <its title>`.
- When several sections are missing, the first in the table's order is named. For example, with `iosDeviceType` and `androidDeviceProfile` missing, the result names `## Android Device Profile`.
- When all four are missing, the result names `## Android System Image`.
- The message for a missing iOS runtime is exactly `The device-source section "## iOS Runtime" is missing or empty in .adw/project.md; ADW creates the devices the scenarios run on (android, ios) from it`. This pins the wording and that the message names the platforms.

Run the file and see it fail, because the module does not exist yet.

### 3. Implement `adws/core/deviceSourceConfig.ts` (green)
- Imports:
  - `import type { Platform } from './applicationType';` — a type-only import;
  - `import { parseMarkdownSections, sectionValue } from './markdownSections';`

  Never import `./projectConfig`, which imports this module.
- `export interface DeviceSourceSections` has `readonly androidSystemImage`, `androidDeviceProfile`, `iosDeviceType` and `iosRuntime`, each `string | null`.
- `export interface DeviceSource` has the same four fields, each `readonly` and a `string`. A short comment on each field says the format it holds, because the name cannot: an SDK package path such as a `system-images;…` id, an `avdmanager` device id, a `simctl` device type identifier, a `simctl` runtime identifier.
- `export const DEVICE_SOURCE_SECTION_TITLES: Readonly<Record<keyof DeviceSourceSections, string>>` lists `Android System Image`, `Android Device Profile`, `iOS Device Type` and `iOS Runtime`. Add one comment: its order is the order in which a missing section is reported.
- `export type DeviceSourceResolution`:
  - `{ readonly kind: 'not_required' }`
  - `{ readonly kind: 'resolved'; readonly deviceSource: DeviceSource }`
  - `{ readonly kind: 'missing'; readonly section: string; readonly message: string }`
- `export function parseDeviceSourceSections(projectMd: string): DeviceSourceSections`:
  - parse the sections once;
  - read each key with `sectionValue(sections, DEVICE_SOURCE_SECTION_TITLES[key])`;
  - return an explicit object literal of the four keys.
- `export function resolveDeviceSource(sections: DeviceSourceSections, platforms: readonly Platform[]): DeviceSourceResolution`:
  - Return `not_required` first when `platforms` is empty. Do not touch `sections` before that check: the phase-test fixture's cast config has no `deviceSources`.
  - Then destructure the four values. Use one guard clause per key, in the table's order, each returning `missingSection(key, platforms)`.
  - Finally return `resolved` with the four narrowed strings.
- A private `missingSection(key, platforms)`:
  - builds `section = \`## ${DEVICE_SOURCE_SECTION_TITLES[key]}\``;
  - builds the message ``` `The device-source section "${section}" is missing or empty in .adw/project.md; ADW creates the devices the scenarios run on (${platforms.join(', ')}) from it` ```.
- `export class DeviceSourceConfigError extends Error`:
  - has `readonly name = 'DeviceSourceConfigError'`;
  - has the constructor `(readonly section: string, message: string)`, which calls `super(message)`;
  - follows `ScenarioHermeticityError` in `scenarioTestFixLoop.ts`.
- Never use the identifier `applicationType` in this module, because of the guard in `applicationType.test.ts`.
- Run `deviceSourceConfig.test.ts`. It passes.

### 4. Expose the sections on the project config (test first)
- In `adws/core/__tests__/projectConfig.test.ts`, add:
  - `describe('getDefaultProjectConfig — no device source')`: every field of `getDefaultProjectConfig().deviceSources` is `null`. A repository without ADW configuration is never taken to have devices.
  - `describe('loadProjectConfig — device-source sections')`, using a temporary repository (`mkdtempSync`, cleaned up in `afterEach`, as in `projectConfigLoad.test.ts`):
    - A `.adw/project.md` with `## Application Type` and all four sections, one of them followed by `<!-- default written by adw_init -->`, exposes the four values as written, with no comment left in them.
    - A `.adw/project.md` with none of the sections exposes four `null`s.
    - A `.adw/` directory without `project.md` exposes four `null`s.
  - ADW's own `.adw/project.md` (`loadProjectConfig(resolve(__dirname, '..', '..', '..'))`) exposes four `null`s. This is a `cli` repository with none of the sections.
- In `adws/core/projectConfig.ts`:
  - `import { parseDeviceSourceSections, type DeviceSourceSections } from './deviceSourceConfig';`
  - Add `deviceSources: DeviceSourceSections;` to `ProjectConfig`, with a one-line doc comment in the style of `applicationType`'s: each absent or empty section is `null`, and only `resolveDeviceSource` says whether a profile needs them.
  - In `getDefaultProjectConfig()`, add `deviceSources: parseDeviceSourceSections('')`.
  - In `loadProjectConfig()`, add `deviceSources: parseDeviceSourceSections(projectMd)`.
- Every fixture that spreads `getDefaultProjectConfig()` keeps compiling.
- Leave `scenarioTestPhase.helpers.ts` as it is. The phase never reads the sections of a profile without platforms, and that is the helper's default.
- Run `projectConfig.test.ts` and `projectConfigLoad.test.ts`. Both pass.

### 5. Require the device source in the scenario test phase (test first)
- In `adws/phases/__tests__/scenarioTestPhase.test.ts`, add `describe('executeScenarioTestPhase — the device source of a profile with platforms')`. Add local helpers to the test file, not to the shared helpers:
  - `const MOBILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm'];`
  - an `EVERY_SECTION: DeviceSourceSections` sample constant;
  - `withDeviceSources(config, deviceSources)`, which returns `{ ...config, projectConfig: { ...config.projectConfig, deviceSources } }`.
- Cases:
  - `it.each` over the four sections: with the `mobile:kotlincm` profile, that section `null`, and a declared dev server (`declaring('bun run dev')`):
    - the call rejects with a `DeviceSourceConfigError` whose message contains `"## <title>"`;
    - `runScenarioProof` is not called;
    - `lifecycle.configs` is empty.
  - With several sections missing, the error names the first in the table's order.
  - `AgentStateManager.appendLog` (mocked) is called with a line that contains the error's message.
  - With every section set, `runScenarioProof` is called once and the result is the passing proof, as before.
  - With `scenariosMd: ''` and a missing section, the call still rejects. The device source is required before anything else, the skip included.
  - `it.each` over the `cli` and `web` profiles, with all four sections `null`: `runScenarioProof` is called once and nothing throws.
- In `adws/phases/scenarioTestPhase.ts`:
  - Import `DeviceSourceConfigError` and `resolveDeviceSource` from `../core/deviceSourceConfig`, and `type Platform` from `../core/applicationType`.
  - Add:
    ```ts
    function requireDeviceSource(run: PhaseRun, platforms: readonly Platform[]): void {
      const resolution = resolveDeviceSource(run.config.projectConfig.deviceSources, platforms);
      if (resolution.kind !== 'missing') return;
      recordLine(run.config.orchestratorStatePath, `Scenario test phase failed before running anything: ${resolution.message}`, 'error');
      throw new DeviceSourceConfigError(resolution.section, resolution.message);
    }
    ```
  - In `executeScenarioTestPhase`, call `requireDeviceSource(run, applicationProfile.platforms)` on the line after `requireApplicationProfile(config)`. That is before `resolveScenarioRunner`, the skip check, the dev server and `runScenarioProof`.
  - Extend the function's doc comment: for a profile with platforms, a missing or empty device-source section throws `DeviceSourceConfigError` before anything runs. The orchestrator fails the workflow with that message and does not park it.
- The resolved device source is not used yet: #1047 hands it to the device lifecycle. Leave no unused local behind.
- The new module must not use the identifier `applicationType` (guard test).
- Run `bunx vitest run adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/scenarioTestPhase.runner.test.ts adws/phases/__tests__/scenarioTestPhase.server.test.ts adws/core/__tests__/applicationType.test.ts`. All pass.

### 6. Keep the shared `.adw/` fixture faithful to a repository with platforms
- **Why.**
  - The merged `@adw-1043` scenarios 104308, 104309, 104310 and 104313 run the real scenario test phase on a `mobile:kotlincm` worktree.
  - The worktree is written by `freshAdwFiles`, `renderAdwFiles` and `writeAdwFiles`, through feature-992's `prepareWorkflow` and feature-994's `prepareWorkflow`.
  - Today its `.adw/project.md` has no device-source sections, so after Task 5 the phase would throw.
  - The scenario writer has made those scenarios name their device sources (`… names every device source`).
  - The `@adw-1045` scenarios name every section, none, all but one, or all with one left empty, also for a `cli` worktree (104505).
  - So the fixture needs a model of those sections that steps can change.
  - Its default for a type whose profile has platforms stays what a real `mobile:kotlincm` repository holds, because `adw_init` writes these sections (#1044).
- **Changes to `features/regression/step_definitions/feature-992-adw-files.ts`:**
  - `AdwFiles` gains `readonly project: Map<string, string>`: the sections of `.adw/project.md` beside the application type, by heading.
  - `freshAdwFiles(applicationType)` fills `project` with the four device-source sections, using headings from `DEVICE_SOURCE_SECTION_TITLES` and sample values, when the type's profile has platforms: `(declaredApplicationProfile({ applicationType })?.platforms.length ?? 0) > 0`. Otherwise `project` stays empty.
  - `renderAdwFiles` appends each `project` section to `projectMd(files.applicationType)` as `## <heading>\n<body>`. For `cli`, `web` and an unknown type, the rendered `.adw/project.md` is byte-for-byte what it is today, unless a step names device sources.
  - Export small setters for the device-source steps. They work for any type, whatever the default:
    - `setProjectSection(files, heading, body)` and `removeProjectSection(files, heading)`;
    - helpers for "every device source" (all four sample values) and "no device source" (none of the four).

    An empty body gives an empty section (104503). A body that holds only a comment works the same way.
- **Sample values.** These are fixture values only; `adw_init`'s defaults belong to #1044:
  - `system-images;android-35;google_apis;arm64-v8a`
  - `pixel_8`
  - `com.apple.CoreSimulator.SimDeviceType.iPhone-16`
  - `com.apple.CoreSimulator.SimRuntime.iOS-18-2`
- The `@adw-1043` run moves to the end of Task 7. Six of its scenario rows (104308–104310 and 104313–104315) use the device-source steps that Task 7 defines, so until then they are undefined.

### 7. Write the step definitions the `@adw-1045` scenarios need
The scenario writer has written `features/per-issue/feature-1045.feature`. It has also tagged three scenarios of `features/per-issue/feature-1043.feature` with `@adw-1045` (see Relevant Files). These scenarios are the build's RED tests: write a scenario's steps, see it fail, then make it pass.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-1045"` to list the undefined steps.
- Reuse every phrase that already has a definition, and register no pattern twice. New phrases go in `features/per-issue/step_definitions/feature-1045-*.ts`.

Building blocks:
- **Hooks.** `feature-1045-world.ts` registers `Before` and `After` on `@adw-1045`, following `feature-1043-world.ts`. They call:
  - feature-988's `beginScenario` and `endScenario`, which also remove the throwaway repositories;
  - the `resetState` of features 991 and 992, and `disposeToolchain`;
  - `setUpWorld994` and `tearDownWorld994`.

  The three feature-1043 scenarios carry both tags and run both features' hooks, so every reset must be safe to run twice.
- **A repository's project configuration.** Reuse feature-991's `a repository that has no {string} directory` and `ADW reads the repository's project configuration`. The second runs the real `loadProjectConfig` over a throwaway repository and keeps the result in feature-991's `s.projectConfig`. New steps write that repository's `.adw/project.md`, through feature-991's `makeRepository` (exported):
  - `a repository whose {string} holds:` writes the doc string as it is.
  - Three steps write `projectMd(type)` (feature-991) followed by the named sections:
    - `a repository whose {string} declares the application type {string} and names these device sources:`;
    - `… and names no device source`;
    - `… and names every device source but {string}`.
- **What the configuration names.**
  - `the project configuration names these device sources, and no other:` maps each `## <title>` row to its `deviceSources` field through `DEVICE_SOURCE_SECTION_TITLES`. It checks each named field's value and that every other field is `null`.
  - `the project configuration names no device source`: all four fields are `null`.
- **Resolving.**
  - `the device sources are resolved from that project configuration` calls `resolveDeviceSource(projectConfig.deviceSources, platforms)` and keeps the resolution in the world. `platforms` comes from `declaredApplicationProfile(projectConfig)`.
  - `the device sources resolve to:` expects `resolved` and checks each field.
  - `resolving the device sources fails with an error that names {string}` expects `missing`: its `section` is the heading, and its `message` contains it. This `missing` resolution is the issue's "error naming the first missing section". The resolver itself never throws.
  - `that error does not name {string}`: the message does not contain the heading.
- **The worktree.** Reuse these steps:
  - feature-992's `a workflow for issue {int} whose worktree's {string} declares the application type {string}`;
  - its BDD-framework step and its stand-in run-by-tag step ("…a stand-in that records each run and writes a JUnit report in which every scenario passes");
  - its `the worktree holds a feature tagged {string} and steps for it in the step definition directory {string} names`, and its web steps;
  - feature-1043's `the worktree holds a feature tagged {string} in the scenario directory {string} names, and steps for it in the file {string}`.

  New steps name the device sources with Task 6's setters on feature-992's `s.adwFiles`, before `prepareWorkflow` writes them. They work for any type:
  - `the worktree's {string} names every device source`;
  - `… names no device source`;
  - `… names every device source but {string}`;
  - `… names every device source, but its {string} section is empty`.
- **Feature-994's review workflow.** Two new steps: `the workflow's {string} names every device source` and `… names no device source`.
  - Each renders the worktree's `.adw/project.md` with Task 6's fixture: `freshAdwFiles` of the workflow's type, with the four sections set or removed.
  - It puts that file in feature-994's `s.adwFiles`, which feature-994's `prepareWorkflow` writes over `adw_init`'s files. `feature-994-workflow.ts` stays unchanged.
- **A phase that fails.** The shared `When the workflow's scenario test phase runs` lets a thrown error fail the step. Leave it unchanged.
  - Add `When the workflow's scenario test phase is attempted`. It runs `executeScenarioTestPhase` the same way, with the same `prepareWorkflow` and the same stand-ins, and keeps the error in the world. Export what you need from `feature-992-phase.steps.ts` rather than copying it.
  - `the scenario test phase failed with an error that names {string}` checks that the error is a `DeviceSourceConfigError` and that its message names the heading.
- **No scenario command.** `the scenario command {string} configures was not run` reads feature-992's recorded stand-in calls and expects no run of the stand-in scenario command, as the existing `'{string} was not run'` and `the scenario proof ran no tag` steps do.
- **Not parked.** Reuse `the workflow for issue {int} is not parked` (feature-991) and `no park comment was posted on issue {int}` (feature-989). Both read feature-988's shared workflow, which feature-992's workflow step sets.
- **`cli` and `web` unaffected.** The existing steps already run the phase and assert that the scenario command ran and that the proof passed.

Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1045"`. Every scenario passes and none is undefined, in `feature-1045.feature` and in the three scenarios tagged in `feature-1043.feature`. Then run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1043"` (moved here from Task 6). Every scenario passes.

### 8. Update the README
- **"Application type decides the evidence" bullet.** Add one sentence: a profile with platforms also reads four device-source sections from `.adw/project.md` (`## Android System Image`, `## Android Device Profile`, `## iOS Device Type`, `## iOS Runtime`; `adws/core/deviceSourceConfig.ts`). The scenario phase fails, naming the first one that is missing or empty, before it runs anything, and the issue is not parked. `cli` and `web` ignore the sections.
- **`adws/core/` tree.** Add, in alphabetical order:
  - `deviceSourceConfig.ts  # Pure: the four device-source sections of .adw/project.md (parseDeviceSourceSections) and the device source a profile with platforms needs (resolveDeviceSource, DeviceSourceConfigError)`
  - `markdownSections.ts  # Pure: the ## sections of an .adw/ file (parseMarkdownSections, sectionValue, stripHtmlComments)`
  - `deviceSourceConfig.test.ts` under `adws/core/__tests__/`
- **Existing tree entries.**
  - `projectConfig.ts`: mention that `deviceSources` is `null` per absent or empty section.
  - `scenarioTestPhase.ts`: add that it fails before running anything when a profile with platforms lacks a device-source section.
- **What not to describe.** Leave out device creation and booting (#1047) and `adw_init` defaults (#1044).
- **Existing edits.** Keep the uncommitted tree additions that `README.md` already carries.

### 9. Run the validation commands
Run every command in `Validation Commands` and fix any failure before finishing. Fix the cause, never by suppressing or weakening a check.

## Testing Strategy
### Unit Tests
- **`adws/core/__tests__/deviceSourceConfig.test.ts` (new) — PRD Testing Decisions 2.**
  - The headings.
  - The parser: present, absent, empty and commented sections; trimming; heading case; value case and characters.
  - The resolver:
    - ignored for profiles without platforms;
    - resolved for a profile with platforms;
    - the error names the section, for each of the four;
    - the first missing section is named when several are missing;
    - the exact message.
- **`adws/core/__tests__/projectConfig.test.ts`.**
  - The default config has no device source.
  - `loadProjectConfig` exposes the four sections with comments stripped, or `null` for each when they are absent, or when the `.adw/` directory has no `project.md`.
  - ADW's own `cli` configuration has none of them.
- **`adws/phases/__tests__/scenarioTestPhase.test.ts`.** For a profile with platforms:
  - a missing section rejects with `DeviceSourceConfigError` naming it;
  - no proof runs and no dev server starts;
  - the run log carries the message;
  - several missing sections name the first;
  - the device source is required even when no scenario is configured;
  - every section set runs the proof as before.

  For `cli` and `web` with no sections, the proof runs as before.
- **Existing tests that must stay green unchanged:**
  - `projectConfigLoad.test.ts`
  - `projectConfigCommands.test.ts`
  - `baselineGate.test.ts` and `baselineGate.record.test.ts` (the helper move)
  - `applicationType.test.ts` (the naming guard)
  - `scenarioTestPhase.runner.test.ts` and `scenarioTestPhase.server.test.ts`
  - `scenarioTestFixLoop*.test.ts` and `reviewRetryLoop*.test.ts`

### BDD Scenarios
`@adw-1045` selects `features/per-issue/feature-1045.feature` and three scenarios of `feature-1043.feature`. It covers:
- **The project configuration** (`loadProjectConfig` over a throwaway repository):
  - values as written, with comments stripped and whitespace trimmed;
  - missing, empty and comment-only sections as none, beside a section that is read;
  - no default device source, for a `mobile:kotlincm` repository with no sections and for one with no `.adw/` directory.
- **The resolver:**
  - all four sections resolve;
  - each missing section is named, and all four missing names `## Android System Image`;
  - with `## Android Device Profile` and `## iOS Runtime` missing, only the first is named.
- **The scenario test phase:**
  - `mobile:kotlincm` with no section, without `## iOS Runtime`, or with an empty `## Android Device Profile` fails naming the section, runs no scenario command and does not park (104501–104503);
  - `cli` with none or three of the sections runs the scenario command and passes (104504, 104505);
  - `web` with none runs on ADW's Playwright project and passes (104506).
- **Feature-1043's scenarios** that run the phase on `mobile:kotlincm`, and its review outline, with their device sources named.
- **The type check.**

The exact message, the run-log line, the dev server not starting and the order before the skip checks are pinned by the unit tests only.

### Edge Cases
- **Comments.** A section whose value carries an HTML comment above it, after it on the same line, below it, or across several lines gives the value only. A section that holds only a comment is `null`.
- **Empty bodies.** A heading followed directly by another heading, or a body of blank lines only, is `null`.
- **Heading case.** `## IOS RUNTIME` and `## android system image` are found.
- **Values.** The value's case (`iPhone-16`) and its `;`, `.`, `-`, `_` are preserved.
- **Several missing.** The first in the order Android System Image, Android Device Profile, iOS Device Type, iOS Runtime is named. With all four missing, `## Android System Image` is named.
- **Profiles without platforms.** A `cli` or `web` profile with some or all sections set ignores them: no error, and the phase behaves exactly as before.
- **Cast fixture.** A `cli` phase-test config whose cast `projectConfig` has no `deviceSources` at all still runs, because the resolver returns before it reads the sections.
- **No scenarios configured.** A `mobile:kotlincm` profile with no scenarios configured (`scenariosMd` empty or run-by-tag `N/A`) and a missing section still fails: the device source is required before anything else.
- **Declared dev server.** A `mobile:kotlincm` profile with a declared dev server and a missing section never starts the server.
- **H3 headings.** `### iOS Runtime` is not a section, because `parseMarkdownSections` reads only `##`. The runtime is reported missing, by name.
- **Duplicate headings.** The last one wins, as for every other `.adw/` section.
- **Retry.** The phase fails the workflow without a park. The owner adds the section on the default branch and posts `## Retry`.

## Acceptance Criteria
- `loadProjectConfig(repo).deviceSources` exposes `androidSystemImage`, `androidDeviceProfile`, `iosDeviceType` and `iosRuntime` from `.adw/project.md`'s `## Android System Image`, `## Android Device Profile`, `## iOS Device Type` and `## iOS Runtime`. Comments are stripped and values trimmed; each absent or empty section is `null`. `getDefaultProjectConfig().deviceSources` is all `null`.
- `parseDeviceSourceSections(projectMd)` is a pure function of the text.
- `resolveDeviceSource(sections, platforms)` is pure:
  - it returns `not_required` for empty `platforms`;
  - it returns `resolved` with the four values when all are set;
  - otherwise it returns `missing` with the first missing heading (`## …`) and a message naming that heading, `.adw/project.md` and the profile's platforms.
- For a profile with platforms and a missing or empty section, `executeScenarioTestPhase`:
  - rejects with `DeviceSourceConfigError` carrying that message;
  - calls no `runScenarioProof`, so no scenario command runs;
  - starts no dev server;
  - logs the message to the run log;
  - does not park the issue.
- For `cli` and `web` worktrees with none of the sections, `executeScenarioTestPhase` behaves as before.
- `adws/core/projectConfig.ts`, `adws/core/deviceSourceConfig.ts`, `adws/core/markdownSections.ts` and `adws/phases/scenarioTestPhase.ts` are each under 300 lines.
- Only `core/projectConfig.ts` and `phases/applicationTypeGate.ts` use the identifier `applicationType`, so the guard test passes.
- The `@adw-1045` scenarios pass, including the three feature-1043 scenarios tagged `@adw-1045`. The `@adw-1043` scenarios still pass, with the scenario writer's edits to `feature-1043.feature` kept, and the `@regression` suite passes.
- Unit tests, lint, both type checks and the build pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/deviceSourceConfig.test.ts adws/core/__tests__/projectConfig.test.ts adws/core/__tests__/projectConfigLoad.test.ts adws/core/__tests__/projectConfigCommands.test.ts` — the parser, the resolver and the project config.
- `bunx vitest run adws/core/__tests__/baselineGate.test.ts adws/core/__tests__/baselineGate.record.test.ts adws/core/__tests__/applicationType.test.ts` — the helper move and the "never name the type" guard.
- `bunx vitest run adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/scenarioTestPhase.runner.test.ts adws/phases/__tests__/scenarioTestPhase.server.test.ts adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/reviewRetryLoop.test.ts` — the phase's requirement, and its callers unchanged.
- `bun run lint` — the linter.
- `bunx tsc --noEmit` — the type check of every `**/*.ts`, including tests and `features/`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional type check.
- `bun run build` — the build.
- `bun run test:unit` — the full unit suite, with zero regressions.
- `wc -l adws/core/projectConfig.ts adws/core/deviceSourceConfig.ts adws/core/markdownSections.ts adws/phases/scenarioTestPhase.ts` — each under 300 lines.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1045"` — this issue's scenarios, including the three feature-1043 scenarios tagged `@adw-1045`, none of them undefined.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1043"` — the `mobile:kotlincm` scenarios that run the real scenario phase still pass, with the device sources they now name.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite, with zero regressions.

## Notes
- **Coding guidelines.** Strictly follow `.adw/coding_guidelines.md`:
  - files under 300 lines, which is the reason for `markdownSections.ts`;
  - pure functions with side effects only in the phase;
  - guard clauses in `resolveDeviceSource`;
  - `readonly` types;
  - no `any`, and no `!` non-null assertions (the guard clauses narrow);
  - comments only for invariants and non-obvious reasons: no restating comments and no issue numbers.
- **Libraries.** No new library is needed. If one ever is, `.adw/commands.md` names `bun add <package>`.
- **`parseProjectConfig`.** The issue's acceptance criterion names `parseProjectConfig`, but no function by that name exists. The project config is built by `loadProjectConfig` from the per-file parsers. `ProjectConfig.deviceSources`, filled by `parseDeviceSourceSections`, satisfies the criterion. Do not add a `parseProjectConfig`.
- **Why the phase throws.**
  - A thrown error is how a phase fails here: `runPhase` → orchestrator `catch` → `handleWorkflowError`. That gives an error comment with `DeviceSourceConfigError: The device-source section …`, board status Blocked, stage `abandoned`, and no park, which matches "the issue does not park".
  - A new result status would be misread. `runScenarioTestFixLoop` would treat it as a failing scenario and call the fix agent. `runReviewRetryLoop` would treat it as a failed dev-server start and spend a review attempt.
  - The owner adds the section and posts `## Retry`.
- **Why before the skip checks.**
  - The issue says "requires it before running anything".
  - A profile with platforms always needs its device source: `adw_init` writes these sections together with the scenario descriptors (#1044).
  - The PRD's bootstrap sequence already requires them before the step-definition skip inside `runScenarioProof`.
  - A unit test pins this order.
- **Every section, for any profile with platforms.** Every profile with platforms needs all four sections (PRD: "For a profile with platforms, a missing or empty section is an error naming the section"). A future single-platform profile (Android only) would need only its own platform's sections. That is a contained change inside `resolveDeviceSource` and `DeviceSource`, and it is not built now.
- **Values are not checked beyond presence.** There is no format check of `system-images;…` or of `simctl` identifiers. `avdmanager` and `simctl` judge the values in #1047 and #1048.
- **The type's name stays out of consumers.** The message names the platforms, never the type, so that `deviceSourceConfig.ts` and `scenarioTestPhase.ts` stay off the `applicationType` guard's list. `projectConfig.ts` remains one of the two modules allowed to name it.
- **Fixture sample values are not ADW defaults.** The defaults `adw_init` writes belong to #1044.
- **Overlap with #1047.** `scenarioTestPhase.helpers.ts` is left untouched because #1047 edits it. #1047 also changes `requireDeviceSource` to return the resolved `DeviceSource` and hands it to the device lifecycle around `runScenarioProof`.
- **Later slices of the PRD, not this one:**
  - `adw_init` writing the four sections with defaults (#1044);
  - the device lifecycle and the `ADW_ANDROID_*` and `ADW_IOS_UDID` variables (#1047);
  - boot retries and the `device_boot_failed` park (#1048);
  - the baseline regression re-run on devices (#1049), which should require the device source the same way;
  - the device janitor (#1050).
- **Documentation.**
  - Leave `.adw/conditional_docs.md` and `app_docs/` to `/document`. The new `deviceSourceConfig.ts` and `markdownSections.ts` need an owning entry, likely `feature-9gjajh-state-and-config.md`, whose note on `parseMarkdownSections` moves with it. The docs-index gate flags orphan docs, not unowned source files, so CI does not need them registered in this build.
  - ADR-0064's `### Confirmation` stays "Not implemented" until the device lifecycle exists.
- **Release.** Nothing here is live on the pipeline host until a release to `main` and a host restart (ADR-0064).
