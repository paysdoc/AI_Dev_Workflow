# Feature: The `mobile:kotlincm` application type resolves end to end (mapping, cucumber-jvm registry, JVM stack, review guidance)

## Metadata
issueNumber: `1043`
adwId: `z3fh5r-feat-the-mobile-kotl`
issueJson: `{"number":1043,"title":"feat: the mobile:kotlincm application type resolves end to end (mapping, cucumber-jvm registry, JVM stack, review guidance)","body":"## Parent PRD\n\n`specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record: `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`)\n\n## What to build\n\nA repository that declares `mobile:kotlincm` under `## Application Type` goes through the gate, runs its scenarios on the descriptor runner with Kotlin step definitions, and its reviewer receives the mobile guidance section. One new entry in the application-type mapping with a new `platforms` field (`android`, `ios`; empty for `cli` and `web`), `cucumber-jvm` registered as a Gherkin runtime with `.kt` and `.java`, a JVM stack language with `cucumber-jvm`, `gradlew` and `gradle` tokens ahead of the generic `cucumber` token, the review prompt's `Mobile applications (Kotlin Compose Multiplatform)` section, and the `adw_init.md` step-3 bullet listing the type as hand-set only. The last two are pinned to the mapping by existing tests and must move in this slice. See PRD \"The mapping\", \"Gherkin runtime registry and stack check\", \"Prompts\" (review.md and the step-3 bullet only).\n\n## Acceptance criteria\n\n- [ ] `resolveApplicationType('mobile:kotlincm')` is known: descriptor runner, per-issue images, platforms `android` and `ios`, guidance section `Mobile applications (Kotlin Compose Multiplatform)`; `mobile` alone parks; `cli` and `web` unchanged with empty platforms\n- [ ] The gate's log line describes the profile from its fields and names the platforms\n- [ ] `stepDefExtensionsFor('cucumber-jvm')` is `['.kt', '.java']` and `isGherkinFramework('cucumber-jvm')` is true; a worktree with a `.kt` step file under the declared directory is not skipped as \"No step definition files found\"\n- [ ] The stack check infers one JVM language from `cucumber-jvm` plus `./gradlew …` commands and warns on nothing; `cucumber-js` plus `./gradlew test` still warns `language-mismatch`\n- [ ] `review.md` has the new `###` section with the rules of PRD stories 36–38 (what a mobile user sees; block a per-issue scenario shown on one platform only; never start an emulator, simulator, Appium or the app)\n- [ ] The three pinned tests (types in the mapping, `adw_init.md` offered types, `review.md` sections) pass with three types\n- [ ] Unit tests for the mapping, registry and stack check (PRD Testing Decisions 4)\n\n## Blocked by\n\nNone - can start immediately\n\n\n- #1051\n## Touched Files\n\n- adws/core/applicationType.ts\n- adws/core/__tests__/applicationType.test.ts\n- adws/core/stepDefDetection.ts\n- adws/core/__tests__/stepDefDetection.test.ts\n- adws/core/stackCoherenceCheck.ts\n- adws/core/__tests__/stackCoherenceCheck.test.ts\n- adws/phases/applicationTypeGate.ts\n- .claude/commands/review.md\n- adws/__tests__/reviewPrompt.test.ts\n- .claude/commands/adw_init.md\n- adws/__tests__/adwInitPrompt.test.ts\n\n## User stories addressed\n\n- User stories 1, 2, 3, 4, 5, 6, 7, 8, 9, 22, 35, 36, 37, 38, 39, 41\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-18T15:00:07Z","comments":[{"author":"paysdoc","createdAt":"2026-10-18T19:38:12Z","body":"## Retry"},{"author":"paysdoc","createdAt":"2026-10-18T19:48:51Z","body":"## Retry"}],"actionableComment":null}`

## Feature Description

ADW knows two application types, `cli` and `web`. A Kotlin Compose Multiplatform repository that targets Android and iPhone is neither, so its issues park on `missing_application_type` and nothing the owner can write under `## Application Type` in `.adw/project.md` gets them past the gate. Reeve, the first such repository, is parked today for that reason.

This slice is the first vertical slice of `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record ADR-0064). It makes a repository that declares `mobile:kotlincm` resolve end to end through the parts of ADW that already exist:

- **The mapping.** One new entry, `mobile:kotlincm`, in the framework-owned `APPLICATION_TYPE_PROFILES` (`adws/core/applicationType.ts`): the descriptor runner, per-issue images, and the guidance section `Mobile applications (Kotlin Compose Multiplatform)`. The profile gains one new dimension, `platforms`, a readonly list of a new `Platform` enum (`android`, `ios`). `cli` and `web` declare an empty list and are otherwise unchanged. A bare `mobile` is not a key and still parks. `describeApplicationProfile` names the platforms when there are any, so the gate's log line says what the type means without naming it.
- **The Gherkin runtime registry.** `cucumber-jvm` is registered in `adws/core/stepDefDetection.ts` with `.kt` and `.java` step-definition extensions. That makes it a Gherkin runtime (no `non-gherkin-bdd` warning), and the descriptor runner's scenario proof finds Kotlin step definitions instead of skipping with "No step definition files found".
- **The stack check.** `adws/core/stackCoherenceCheck.ts` gains a `jvm` stack language with the tokens `cucumber-jvm`, `gradlew` and `gradle`, placed ahead of the generic `cucumber` token, so a Kotlin repository is read as one JVM stack, and a real JavaScript-and-JVM mix still warns `language-mismatch`.
- **The review guidance.** `.claude/commands/review.md` gains the `### Mobile applications (Kotlin Compose Multiplatform)` section with the rules of PRD stories 36–38.
- **The `adw_init` step-3 bullet.** `.claude/commands/adw_init.md` offers `mobile:kotlincm` as a third value that an owner sets by hand and `adw_init` never detects. It also preserves the value on regeneration, so the upgrade that this edit triggers does not drop it.

The review guidance section and the `adw_init` bullet are pinned to the mapping by existing tests (`adws/__tests__/reviewPrompt.test.ts`, `adws/__tests__/adwInitPrompt.test.ts`), so they have to change together with the mapping.

One ripple the issue does not name: `StackLanguage` is the key type of the fix-round guard's framework suppression table (`adws/core/fixRoundGuardTable.ts`, `Readonly<Record<StackLanguage, …>>`). A new `jvm` language does not compile without a `jvm` entry. The existing pins also require that entry to hold at least one pattern and that `review.md` Step 3 name one of them (`fixRoundGuard.table.test.ts`, and `reviewPrompt.test.ts` "names a suppression of the %s language"). This slice therefore also gives `jvm` a small table of Kotlin/Java suppression patterns and names two of them in review Step 3. That is what a JVM stack language means in this codebase: a Kotlin repository's fix rounds get the same suppression guard as every other language ADW infers.

## User Story
As a repository owner of a Kotlin Compose Multiplatform application
I want to write `mobile:kotlincm` under `## Application Type` in `.adw/project.md`
So that ADW stops parking my issues on `missing_application_type`, runs my cucumber-jvm scenarios with Kotlin step definitions on the descriptor runner, and reviews my changes with mobile judgement

## Problem Statement

- The mapping holds exactly `cli` and `web`. Any other `## Application Type` value parks the issue, and Reeve's issue #1 is parked.
- `cucumber-jvm` is unknown to the Gherkin registry. `stepDefExtensionsFor('cucumber-jvm')` falls back to `['.ts']`, so `runScenarioProof` (`adws/phases/scenarioProof.ts:129`) finds no step definitions in a Kotlin `## Step Def Directory` and skips the whole scenario proof. The stack check also warns `non-gherkin-bdd` for it.
- The stack check reads `cucumber-jvm`, and a Gradle run-by-tag command such as `./gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}"`, as JavaScript through its generic `cucumber` token.
- The review prompt has no guidance for a mobile application. A profile without a matching `###` section fails `reviewPrompt.test.ts`, and the reviewer would apply no guidance.
- The `adw_init.md` step-3 bullet offers only `cli` and `web`, and the pinning test compares it with the mapping's keys. Its preserve rule keeps only `cli` or `web`, so the regeneration this change triggers could drop a hand-set `mobile:kotlincm`.
- The profile has no notion of a platform, which the later device-lifecycle and proof-attribution slices need.

## Solution Statement

Add the third type as data, following ADR-0061/ADR-0064: one table entry, a `platforms` field on every profile, and descriptions built from fields. Every consumer keeps reading the profile through `requireApplicationProfile`, so no phase learns the type's name. `buildReviewPromptContext` already hands `reviewGuidanceSection` to the reviewer, and `resolveScenarioRunner(RunnerMode.Descriptor, …)` already serves the repository's `.adw/scenarios.md`. The registry and stack-check changes are table rows plus their ordering. The prompts move to match the mapping, and the existing pinning tests prove they match without new prompt assertions (PRD Testing Decisions: prompt-pinning additions beyond the existing enumerating tests are not tested by decision).

Nothing in this slice boots a device, parks on a device failure, attributes an image to a platform, or writes Gradle descriptors in `adw_init`. Those are later slices of the PRD. `platforms` is declared here and read only by `describeApplicationProfile` for now.

Key design points:

1. **`Platform` enum in `applicationType.ts`**, beside `RunnerMode` and `EvidenceKind`: `Android = 'android'`, `Ios = 'ios'`. This follows the existing PascalCase convention for acronyms, as in `ProtectedPathCategory.AdwCommands`. It is exported through the core barrel like the other two enums.
2. **`ApplicationProfile.platforms: readonly Platform[]` is required**, not optional, so that the type checker catches a profile that declares none. `cli` and `web` declare `[]`.
3. **Sub-descriptor as part of the key.** The entry is the quoted key `'mobile:kotlincm'`. `resolveApplicationType` stays trimmed, lowercased and own-key only. A bare `mobile`, `mobile:` or `mobile: kotlincm` (inner space) is simply not a key and parks with the value as written. There is no prefix parsing (ADR-0064).
4. **The description line is unchanged when there are no platforms.** `describeApplicationProfile` appends `; platforms: android, ios` (the enum values joined with `, `) only for a non-empty list. The `cli` and `web` log lines stay byte-for-byte as before (story 22).
5. **JVM tokens go high in the token list**, directly after the specific `cucumber-*` runtimes and before every JavaScript token and the generic `cucumber`. The reason is that Gradle task and property names contain JavaScript tokens and `cucumber` as substrings: Kotlin/JS's `jsNodeTest` contains `node`, `kotlinNpmInstall` contains `npm`, `kotlinUpgradeYarnLock` contains `yarn`, and `-Dcucumber.filter.tags` contains `cucumber`. A one-line ordering comment records this, in the style of the existing `cargo`/`go test` comment.
6. **`jvm` suppression patterns.** These are Kotlin/Java patterns, each with an idiomatic example: `@Suppress(`, `@file:Suppress(`, `@SuppressWarnings(`, `@SuppressLint(`, `//noinspection`, `ktlint-disable`, `CHECKSTYLE:OFF`. `@file:Suppress(` is a separate entry because whitespace and case normalisation do not make `@suppress(` a substring of `@file:suppress(`.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview. Its "Application type decides the evidence" bullet and the `adw_init` paragraph in Setup step 4 name only `cli` and `web` and get a short update.
- `.adw/coding_guidelines.md` — coding guidelines to follow strictly: files under 300 lines, enums for named constant sets, immutability, guard clauses, and the **Comments** rule (no restating comments, no issue numbers, no name-echoing JSDoc).
- `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` — parent PRD. Use the sections "The mapping", "Gherkin runtime registry and stack check", "Prompts" (review.md and the step-3 bullet only), "Testing Decisions" item 4, and user stories 1–9, 22, 35–39 and 41.
- `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md` — decision record: one key per sub-descriptor, descriptor runner, per-issue images, `platforms`, the guidance title, and `cucumber-jvm` with `.kt`/`.java` and JVM tokens ahead of `cucumber`.
- `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md` — the mapping's original contract (consumers read the profile, never the type; no default).
- `specs/adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md` — the suppression table keyed by language, and the reviewer naming a pattern of every language.
- `adws/core/applicationType.ts` — the mapping. It gets the `Platform` enum, the `platforms` field, the `mobile:kotlincm` entry, `platforms: []` for `cli` and `web`, an updated table comment, and the platforms clause in `describeApplicationProfile`.
- `adws/core/__tests__/applicationType.test.ts` — mapping tests: three types, the new profile, a bare `mobile` parks, empty platforms for `cli`/`web`, and description lines.
- `adws/core/index.ts` — core barrel. Export `Platform` next to `RunnerMode` and `EvidenceKind` (line 84).
- `adws/phases/applicationTypeGate.ts` — the gate. Its `proceed` log line (`Application type ${…}: ${describeApplicationProfile(profile)}`) names the platforms once the description does. No source change is expected; touch it only if a test shows otherwise.
- `adws/phases/__tests__/applicationTypeGate.test.ts` — gate tests. Add mobile proceed and log-line cases and `declaredApplicationProfile` cases. Its `FAKE` profile literal gets `platforms: []`, because the root `tsconfig.json` includes every `**/*.ts`, tests included.
- `adws/phases/__tests__/applicationTypeGate.helpers.ts` — `configDeclaring`, `makeConfig` and `useApplicationTypeGateSandbox`, reused unchanged.
- `adws/phases/reviewPromptContext.ts` — hands `reviewGuidanceSection` to the reviewer as `guidanceSection`. No change; it is how the reviewer receives the mobile section.
- `adws/phases/__tests__/reviewPromptContext.test.ts` — its `DESKTOP` profile literal gets `platforms: []` to compile. Add a mobile guidance-section case.
- `adws/core/stepDefDetection.ts` — the Gherkin runtime registry (`FRAMEWORK_EXTENSION_MAP`). Add `'cucumber-jvm': ['.kt', '.java']`.
- `adws/core/__tests__/stepDefDetection.test.ts` — registry tests: extensions, Gherkin status, a nested `.kt`/`.java` step file found, and a `.kts` script not counted.
- `adws/core/scenarioRunner.ts` — `descriptorRunner` takes `stepDefExtensionsFor(scenarios.bddFramework)`. No change; this is how the registry reaches the scenario proof.
- `adws/core/__tests__/scenarioRunner.test.ts` — add one descriptor-mode case for a cucumber-jvm `.adw/scenarios.md`.
- `adws/phases/scenarioProof.ts` — `runScenarioProof` emits "No step definition files found in … — skipping BDD scenario proof" when `hasStepDefinitions(stepDefDirectory, stepDefExtensions, cwd)` is false (line 129). No change.
- `adws/core/stackCoherenceCheck.ts` — `StackLanguage` gains `'jvm'`, and `LANGUAGE_TOKENS` gains `cucumber-jvm`, `gradlew` and `gradle`.
- `adws/core/__tests__/stackCoherenceCheck.test.ts` — stack-check tests: a coherent JVM stack, a JS+JVM mismatch, and the token ordering.
- `adws/core/fixRoundGuardTable.ts` — `FRAMEWORK_SUPPRESSION_PATTERNS` is a `Record<StackLanguage, …>`. It gets a `jvm` entry, and its JSDoc gains "`jvm` covers Kotlin and Java".
- `adws/core/__tests__/fixRoundGuard.table.test.ts` — pins the table's languages (`['go', 'javascript', 'python', 'ruby', 'rust']`) and `NAMED_BY_THE_DECISION: Record<StackLanguage, …>`. Both get `jvm`. Its `describe.each(LANGUAGES)` then tests every `jvm` pattern automatically.
- `adws/core/fixRoundGuard.ts` and `adws/phases/staticCheckGate.ts` — consumers of `StackLanguage` and `inferStackLanguages`. No change; a Kotlin repository's fix rounds get the `jvm` patterns through them.
- `.claude/commands/review.md` — the review prompt. It gets the new `### Mobile applications (Kotlin Compose Multiplatform)` section under `## Guidance by application type`, and two JVM patterns in Step 3.
- `adws/__tests__/reviewPrompt.test.ts` — pins the `###` sections to the mapping and Step 3 to every language of the suppression table, and forbids runner and check-command text. No edit expected; it must pass unchanged.
- `.claude/commands/adw_init.md` — step-3 `## Application Type` bullet and its preserve sub-bullet. It is a `hashInputs:` file, so editing it bumps the framework hash.
- `adws/__tests__/adwInitPrompt.test.ts` — pins the step-3 bullet's backticked values to `Object.keys(APPLICATION_TYPE_PROFILES)` and requires `preserve it verbatim` and `leave the section out`. No edit expected; it must pass unchanged.
- `app_docs/feature-gfv9kt-application-type-mapping.md` — conditional doc for the mapping and gate (condition: "When adding a third application type"). Read for contracts. `/document` updates it later.
- `app_docs/feature-9gjajh-freeze-and-coherence.md` — conditional doc for `stackCoherenceCheck.ts` and `stepDefDetection.ts` (token ordering invariant). Read for contracts.
- `app_docs/feature-9gjajh-commands-and-skills.md` — conditional doc for `.claude/commands/adw_init.md`, `review.md` and `adwInitPrompt.test.ts`. Read for contracts.
- `app_docs/feature-9gjajh-review-and-diff-phases.md` — conditional doc for `reviewPromptContext.ts` (guidance section handed to the reviewer).

### New Files
None. Every change goes into an existing file.

## Implementation Plan
### Phase 1: Foundation
Extend the profile type and the mapping in `adws/core/applicationType.ts`. Add the `Platform` enum, the required `platforms` field, `platforms: []` on `cli` and `web`, the `mobile:kotlincm` entry, the platforms clause of `describeApplicationProfile`, and the barrel export. Then fix the three profile literals in tests (`FAKE` twice, `DESKTOP` once) so the type checks stay green. Write the mapping tests first (red), then the code (green).

### Phase 2: Core Implementation
Register `cucumber-jvm` in the Gherkin runtime registry. Add the `jvm` stack language and its tokens in the right order. Add the `jvm` suppression patterns that the new language requires. Each change is test-first in its co-located `__tests__/` file.

### Phase 3: Integration
Move the two pinned prompts. `review.md` gets the mobile guidance section and the JVM suppressions in Step 3. `adw_init.md` gets the step-3 bullet that lists `mobile:kotlincm` as hand-set only and preserves it. Prove the flow through the existing consumers: gate log line, review prompt context, descriptor scenario runner. Update the README bullets, then run every validation command.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Write the mapping tests for three types (red)
In `adws/core/__tests__/applicationType.test.ts`:
- Import `Platform` from `../applicationType`. Add `platforms: []` to `FAKE`.
- Rename `describe('resolveApplicationType — the two types ADW knows'` to the three types. Add `platforms: []` to the exact `cli` and `web` expected profiles.
- Add `maps mobile:kotlincm to the descriptor runner, per-issue images and the android and ios platforms`. It uses `toEqual` on `{ kind: 'known', profile: { runnerMode: RunnerMode.Descriptor, evidenceKinds: [EvidenceKind.PerIssueImages], platforms: [Platform.Android, Platform.Ios], reviewGuidanceSection: 'Mobile applications (Kotlin Compose Multiplatform)' } }`.
- Add `declares no platform for cli and web`: `APPLICATION_TYPE_PROFILES.cli.platforms` and `.web.platforms` equal `[]`.
- Extend the trimmed/case-insensitive `it.each` with `[' Mobile:KotlinCM ', 'mobile:kotlincm']` and `['mobile:kotlincm\n', 'mobile:kotlincm']`.
- Change `holds exactly the two types of the decision record` to expect `['cli', 'mobile:kotlincm', 'web']`, and say three types in the title.
- Rename `gives cli and web a review guidance section each, and no two the same` to cover every type. The body already iterates all profiles.
- In `what parks the issue`, extend the unknown-type `it.each` with `'mobile'`, `'Mobile'`, `'mobile:'`, `'mobile: kotlincm'`, `'kotlincm'`, `'mobile:flutter'` and `'mobile:kotlincm:android'`. Each parks with the value as written. Add a focused test `parks a bare mobile: a sub-descriptor is part of the key`.
- In `describeApplicationProfile`:
  - Add `names the runner of .adw/scenarios.md, per-issue scenario images and the android and ios platforms for mobile:kotlincm`. The description contains `.adw/scenarios.md`, `per-issue scenario images` and `platforms: android, ios`.
  - Add `names no type in the mobile:kotlincm description`. The lowercased description contains neither `mobile` nor `kotlin`.
  - Add `leaves the cli and web descriptions as they were, with no platforms`. Pin the exact strings: ``scenarios run with the scenario runner that `.adw/scenarios.md` describes; evidence: no images`` for `cli`, and ``scenarios run with ADW's Playwright project in `features/`; evidence: per-issue scenario images`` for `web`.
  - Add a fake profile with one platform (`platforms: [Platform.Android]`). Assert it is described from its fields alone: the description contains `platforms: android` and not `ios`.
- Keep `stays on one line`. It iterates all profiles, so it covers the new one.
- Keep the AST walk `every consumer reads the mapping, never the type` unchanged.
- Run `bunx vitest run adws/core/__tests__/applicationType.test.ts` and see the new cases fail.

### 2. Add `Platform`, `platforms` and the `mobile:kotlincm` entry (green)
In `adws/core/applicationType.ts`:
- Add `export enum Platform { Android = 'android', Ios = 'ios' }` after `EvidenceKind`.
- Add `readonly platforms: readonly Platform[];` to `ApplicationProfile`, between `evidenceKinds` and `reviewGuidanceSection`. A short JSDoc may say that an empty list means the type runs on no device. Do not echo the name.
- Add `platforms: []` to `cli` and `web`, and add the entry `'mobile:kotlincm': { runnerMode: RunnerMode.Descriptor, evidenceKinds: [EvidenceKind.PerIssueImages], platforms: [Platform.Android, Platform.Ios], reviewGuidanceSection: 'Mobile applications (Kotlin Compose Multiplatform)' }`. Keep `as const satisfies ApplicationProfiles`. `ApplicationType` then includes `'mobile:kotlincm'`.
- Replace the table comment. Its "a new type is one entry here plus detection in `adw_init`, and no phase changes" no longer holds (ADR-0064). Keep the invariant and add the key rule, for example: `// The only place a type name means anything: consumers receive the profile and never the type. A sub-descriptor is part of its key, so a bare \`mobile\` is a type the table does not hold.`
- In `describeApplicationProfile`, append the platforms clause only when the list is non-empty: `const platforms = profile.platforms.length === 0 ? '' : \`; platforms: ${profile.platforms.join(', ')}\`;` and return `` `scenarios run with ${runner}; evidence: ${evidence}${platforms}` ``.
- Leave `resolveApplicationType` and `parkFor` untouched. Own-key lookup already parks `mobile`.
- In `adws/core/index.ts`, export `Platform` on the line that exports `RunnerMode, EvidenceKind`.
- Run `bunx vitest run adws/core/__tests__/applicationType.test.ts`. It is green.

### 3. Keep every profile literal compiling
- `adws/phases/__tests__/applicationTypeGate.test.ts`: add `platforms: []` to `FAKE`.
- `adws/phases/__tests__/reviewPromptContext.test.ts`: add `platforms: []` to `DESKTOP`.
- Search for any other `ApplicationProfile` literal and fix it the same way: `grep -rn "reviewGuidanceSection:" adws features scripts`. Research found only these two and the one in `applicationType.test.ts`.

### 4. Prove the gate and the review context take the new profile (test first)
In `adws/phases/__tests__/applicationTypeGate.test.ts`:
- Add `['mobile:kotlincm', APPLICATION_TYPE_PROFILES['mobile:kotlincm']]` to `proceeds with the %s profile, without merging, reloading or parking`.
- Extend `records the %s profile on the console and in the execution log` to `mobile:kotlincm`. Replace the `'cli' | 'web'` cast with `ApplicationType` imported from `../../core/applicationType`.
- Add `names the android and ios platforms in the line it records for mobile:kotlincm`. The execution log and console contain `Application type mobile:kotlincm: ` followed by the description, and the line contains `platforms: android, ios`.
- Add `parks a bare mobile after merging and reading again`. With `loadProjectConfig` returning `configDeclaring('mobile')`, `park` is called with `{ reason: ParkReason.MissingApplicationType, found: 'mobile' }`.
- Add `['mobile:kotlincm', …]` to the `declaredApplicationProfile` `it.each`. Add `['a bare mobile', 'mobile']` to `returns null where the gate would park`.

In `adws/phases/__tests__/reviewPromptContext.test.ts`:
- Add `hands the reviewer the mobile guidance section for a mobile:kotlincm repository`. `buildReviewPromptContext(makeConfig({ profile: APPLICATION_TYPE_PROFILES['mobile:kotlincm'] })).guidanceSection` is `'Mobile applications (Kotlin Compose Multiplatform)'`.

Run both files. They are expected to be green with no change to `adws/phases/applicationTypeGate.ts` or `reviewPromptContext.ts`. Change the gate only if a test proves its line does not carry the description.

### 5. Register `cucumber-jvm` as a Gherkin runtime (test first)
In `adws/core/__tests__/stepDefDetection.test.ts`:
- `stepDefExtensionsFor('cucumber-jvm')` equals `['.kt', '.java']`, and `' Cucumber-JVM '` gives the same.
- `isGherkinFramework('cucumber-jvm')` and `isGherkinFramework(' Cucumber-JVM ')` are true.
- `hasStepDefinitions('scenarios/src/test/kotlin', stepDefExtensionsFor('cucumber-jvm'), cwd)` is true for a nested `scenarios/src/test/kotlin/com/example/steps/LoginSteps.kt`. It is also true for a `.java` step file.
- The same directory holding only a `build.gradle.kts` is false: a Kotlin script is not a step definition.
- A directory with a `.kt` step file searched with the default `['.ts']` is false. This shows what the registry fixes.

In `adws/core/stepDefDetection.ts`, add `'cucumber-jvm': ['.kt', '.java'],` to `FRAMEWORK_EXTENSION_MAP`.

In `adws/core/__tests__/scenarioRunner.test.ts`, add a descriptor-mode case for a cucumber-jvm configuration:
- runScenariosByTag `./gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}"`
- bddFramework `cucumber-jvm`
- stepDefDirectory `scenarios/src/test/kotlin`

Assert `stepDefExtensions` is `['.kt', '.java']`, `stepDefDirectory` is `scenarios/src/test/kotlin`, and `stackSignals` carries both values. This is the value `runScenarioProof` passes to `hasStepDefinitions`, so a Kotlin step file is no longer skipped as "No step definition files found".

### 6. Add the `jvm` stack language (test first)
In `adws/core/__tests__/stackCoherenceCheck.test.ts`:
- `coherent Kotlin/Gradle — cucumber-jvm with ./gradlew commands`. `stackCoherenceCheck({ testFramework: '', bddFramework: 'cucumber-jvm', runTests: './gradlew test', runScenariosByTag: './gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}"' })` gives `ok: true` and no warnings.
- `cucumber-jvm is a Gherkin runtime — no non-gherkin warning`.
- `incoherent: cucumber-js with ./gradlew test → language-mismatch`. Exactly one `language-mismatch` warning, whose message names `bddFramework 'cucumber-js'→javascript` and `runTests './gradlew test'→jvm`.
- In `inferStackLanguages`:
  - Add `['cucumber-jvm and ./gradlew test', { bddFramework: 'cucumber-jvm', runTests: './gradlew test' }, 'jvm']` and `['gradle test', { runTests: 'gradle test' }, 'jvm']` to the one-language `it.each`.
  - `reads cucumber-jvm as jvm, not through the generic cucumber token`: `{ ...none, bddFramework: 'cucumber-jvm' }` gives `['jvm']`.
  - `reads a Gradle command that names cucumber as jvm`: `runScenariosByTag: './gradlew :scenarios:test -Dcucumber.filter.tags="@{tag}"'` gives `['jvm']`.
  - `reads Gradle tasks whose names hold a JavaScript token as jvm`: `./gradlew jsNodeTest` and `./gradlew kotlinNpmInstall` each give `['jvm']`.
  - Keep the existing `bundle exec cucumber` → ruby and `cucumber-js` → javascript cases green.

In `adws/core/stackCoherenceCheck.ts`:
- `export type StackLanguage = 'javascript' | 'python' | 'go' | 'rust' | 'ruby' | 'jvm';`
- Insert `['cucumber-jvm', 'jvm']` after `['cucumber-js', 'javascript']`. Insert `['gradlew', 'jvm']` and `['gradle', 'jvm']` directly after `['cucumber-rs', 'rust']`, before `playwright-bdd` and every JavaScript token. Add a one-line ordering comment such as `// before the JavaScript tokens and 'cucumber': Gradle task and property names hold them ('jsNodeTest', 'kotlinNpmInstall', '-Dcucumber.filter.tags')`. Keep `['cucumber', 'javascript']` last.
- Do not change `stackCoherenceCheck`'s warnings or messages.

### 7. Give `jvm` its suppression patterns (test first)
In `adws/core/__tests__/fixRoundGuard.table.test.ts`:
- Change `has an entry for exactly the languages the stack inference knows` to expect `['go', 'javascript', 'jvm', 'python', 'ruby', 'rust']`.
- Add `jvm: ['@Suppress(', '@file:Suppress(', '@SuppressWarnings(', '@SuppressLint(', '//noinspection', 'ktlint-disable', 'CHECKSTYLE:OFF']` to `NAMED_BY_THE_DECISION`.
- The `describe.each(LANGUAGES)` block then checks that a round adding each `jvm` example is rejected with `language: 'jvm'`.

In `adws/core/fixRoundGuardTable.ts`:
- Add a `jvm` entry with an idiomatic example per pattern:
  - `entry('@Suppress(', '@Suppress("UNCHECKED_CAST")')`
  - `entry('@file:Suppress(', '@file:Suppress("unused")')`
  - `entry('@SuppressWarnings(', '@SuppressWarnings("unchecked")')`
  - `entry('@SuppressLint(', '@SuppressLint("NewApi")')`
  - `entry('//noinspection', '//noinspection SpellCheckingInspection')`
  - `entry('ktlint-disable', '// ktlint-disable max-line-length')`
  - `entry('CHECKSTYLE:OFF', '// CHECKSTYLE:OFF')`
- Extend the table JSDoc: `` `javascript` covers TypeScript and `jvm` covers Kotlin and Java. ``
- Optionally add a cross-language case to `adws/core/__tests__/fixRoundGuard.suppression.test.ts`, mirroring the existing javascript/python ones: a Kotlin `@Suppress(` line is accepted under a javascript-only configuration and rejected under `['jvm']`.

### 8. Add the mobile guidance section and the JVM suppressions to `review.md`
In `.claude/commands/review.md`:
- Step 3, first bullet: change the opening to "An annotation or comment the diff adds that suppresses a check is a `blocker`". The pinned phrase `comment the diff adds that suppresses a check is a \`blocker\`` stays contiguous. Add `` `@Suppress(` `` and `` `@SuppressWarnings(` `` to the list after `` `# rubocop:disable` ``. Step 3 then names a pattern of every language of `FRAMEWORK_SUPPRESSION_PATTERNS`, including `jvm`.
- Under `## Guidance by application type`, after `### Web applications` and before `## Issue Severity Reference`, add the section below. Keep the title exact. Name no runner or check command, no `.adw/` file and no `git` command; the existing tests forbid them.

  ```md
  ### Mobile applications (Kotlin Compose Multiplatform)

  - The per-issue images are the visual evidence, taken on Android and on iOS: an image under `android/` in the proof directory shows Android, one under `ios/` shows iOS. Open each one (Step 6) and look at it as a user looks at the app on that platform: is the change there, on the screen and in the state the issue describes.
  - What a mobile user sees is its screens and the navigation between them, the platform's own chrome (system bars, the back gesture or button, sheets, dialogs, the keyboard), the orientation, and the system permission prompts. A change to any of these that the issue does not ask for is out of scope (Step 2); a change it does ask for needs a per-issue scenario that shows it (Step 4). A change confined to shared logic, data or networking that alters no screen needs no image.
  - A per-issue scenario about something a user sees must show it on both platforms. A per-issue scenario whose images show one platform only is a `blocker` that names the scenario and the platform with no image. `issueResolution`: the scenario must end on the screen that shows the change on that platform as well, and take its screenshot there.
  - Do not start an emulator, a simulator, Appium or the app: the images are the view of the screen you judge.
  ```
- Do not edit `adws/__tests__/reviewPrompt.test.ts`. Run it: `has exactly one section for each guidance section of the mapping, and no other` and `names a suppression of the jvm language` pass, and so does every runner and command prohibition.

### 9. List `mobile:kotlincm` as hand-set only in the `adw_init.md` step-3 bullet
In `.claude/commands/adw_init.md`, step 3, replace the `## Application Type` bullet and its first two sub-bullets with:

```md
     - `## Application Type` — exactly one of `cli`, `web` or `mobile:kotlincm`, alone on its line. The last is never detected: only the repository's owner sets it, by hand.
       - If the existing `.adw/project.md` has `## Application Type` holding `cli`, `web` or `mobile:kotlincm`, preserve it verbatim. The owner may have set it by hand, and an upgrade must not drop it.
       - Otherwise write the type detected in step 1, `cli` or `web`.
```

Keep the third sub-bullet ("If step 1 could not decide, leave the section out entirely …") verbatim. Rules for the bullet line: it holds each of `cli`, `web` and `mobile:kotlincm` in backticks exactly once and no other backticked token besides `## Application Type`, because the test sorts the backticked tokens and compares them with the mapping's keys. Leave step 1's detection rules, step 2's dev-server rule, step 6 and step 8 unchanged; the PRD gives them to the `adw_init` slice. Keep the step numbering. Do not edit `adws/__tests__/adwInitPrompt.test.ts`. Run it: `offers exactly the application types the mapping knows`, `preserve it verbatim` and `leave the section out` pass.

### 10. Update the README
- `README.md`, "Application type decides the evidence" bullet: change `(`cli` or `web`)` to name `mobile:kotlincm` as the third value. `adw_init` preserves it but never detects it. Add that the mapping also gives each type its device platforms: `android` and `ios` for `mobile:kotlincm`, none for `cli` and `web`. Add that a `mobile:kotlincm` repository keeps the runner `.adw/scenarios.md` names (cucumber-jvm with Kotlin step definitions). Keep it to one or two sentences.
- Setup step 4 paragraph ("`adw_init` detects the application type …"): add that `mobile:kotlincm` is set by hand only and that `adw_init` preserves it.
- Do not describe device booting, device-source sections or platform attribution of images. They are not built in this slice.

### 11. Run the validation commands
Run every command in `Validation Commands` and fix any failure before finishing. Fix the cause, never by suppressing or weakening a check.

## Testing Strategy
### Unit Tests
Unit tests are enabled: `.github/adw.yml` leaves `unitTests` commented out. All are Vitest, co-located in `__tests__/`, and drive the public interfaces (PRD Testing Decisions 4):

- **Mapping** (`adws/core/__tests__/applicationType.test.ts`):
  - The `mobile:kotlincm` profile's four fields.
  - Exactly three keys.
  - Unique, non-empty guidance sections.
  - `cli` and `web` unchanged, with `platforms: []`.
  - Trimmed and case-insensitive lookup of the new key.
  - A bare `mobile` and other near-miss values park with the value as written.
  - The description names `platforms: android, ios` and no type name.
  - The `cli` and `web` descriptions are byte-identical to today's.
  - A fake profile's platforms are described from its fields.
- **Gate** (`adws/phases/__tests__/applicationTypeGate.test.ts`):
  - A mobile repository proceeds without merge, reload or park.
  - Its execution-log and console line carries the description with `platforms: android, ios`.
  - A bare `mobile` merges, reloads and parks with `found: 'mobile'`.
  - `declaredApplicationProfile` answers for the new type and returns null for `mobile`.
- **Review context** (`adws/phases/__tests__/reviewPromptContext.test.ts`): the guidance section handed to the reviewer for the mobile profile.
- **Registry** (`adws/core/__tests__/stepDefDetection.test.ts`, `adws/core/__tests__/scenarioRunner.test.ts`):
  - `cucumber-jvm` gives `['.kt', '.java']`, case- and whitespace-insensitive, and is a Gherkin runtime.
  - A nested `.kt` or `.java` step file is found, and a `.kts` script alone is not.
  - The descriptor runner hands `.kt`/`.java` to the scenario proof.
- **Stack check** (`adws/core/__tests__/stackCoherenceCheck.test.ts`):
  - A coherent JVM stack warns on nothing.
  - `cucumber-js` + `./gradlew test` warns `language-mismatch`.
  - `cucumber-jvm` and a Gradle command naming `cucumber` read as `jvm`, not as the generic token.
  - Gradle tasks holding JavaScript tokens read as `jvm`.
- **Suppression table** (`adws/core/__tests__/fixRoundGuard.table.test.ts`):
  - The language list includes `jvm`.
  - Every `jvm` pattern named and rejected through `evaluateFixRound`.
- **Prompt pins, unchanged tests** (`adws/__tests__/reviewPrompt.test.ts`, `adws/__tests__/adwInitPrompt.test.ts`): pass with three types and with the `jvm` suppression language.

### Edge Cases
- `mobile`, `Mobile`, `mobile:`, `mobile: kotlincm` (inner space), `kotlincm`, `mobile:flutter` and `mobile:kotlincm:android` all park with the value as written, never lowercased.
- `' Mobile:KotlinCM '` and `'mobile:kotlincm\n'` resolve to the mobile profile.
- Inherited keys (`constructor`, `__proto__`) still park under the three-type table.
- `cli` and `web` descriptions and gate log lines are byte-identical to before. No `platforms` text appears for an empty list.
- The mobile description stays on one line and names neither `mobile` nor `kotlin`.
- `cucumber-jvm` vs `cucumber-js`: neither token is a substring of the other, so each keeps its language.
- `-Dcucumber.filter.tags` inside a Gradle command does not pull in `javascript` through the generic `cucumber` token.
- Kotlin/JS Gradle tasks (`jsNodeTest`, `kotlinNpmInstall`) do not pull in `javascript` through `node`/`npm`.
- `build.gradle.kts` under the step-def directory does not count as a step definition, because `.kts` does not end with `.kt`.
- `@file:Suppress(` is caught by its own entry: whitespace and case normalisation do not make `@suppress(` a substring of `@file:suppress(`.
- The `jvm` patterns apply only when `jvm` is inferred. A JavaScript-only repository such as ADW itself is unaffected.
- `review.md`: exactly three `###` titles under `## Guidance by application type`. The mobile section contains no runner command, no `.adw/` path and no backticked `git` command.
- `adw_init.md` step-3 bullet: `mobile:kotlincm` is backticked exactly once on the bullet line, since a duplicate would break the sorted comparison.
- Until the proof slice adds platform grouping, a `mobile:kotlincm` proof with no selected image carries the existing `no scenario opened a page` line, because the profile expects per-issue images. Step 6 of the review already handles that line.

## Acceptance Criteria
- `resolveApplicationType('mobile:kotlincm')` returns `{ kind: 'known', profile }` where `profile` has `runnerMode: RunnerMode.Descriptor`, `evidenceKinds: [EvidenceKind.PerIssueImages]`, `platforms: [Platform.Android, Platform.Ios]` and `reviewGuidanceSection: 'Mobile applications (Kotlin Compose Multiplatform)'`.
- `resolveApplicationType('mobile')` parks with `{ reason: ParkReason.MissingApplicationType, found: 'mobile' }`. `cli` and `web` resolve as before, with `platforms: []`.
- The gate's info line for a mobile repository reads `Application type mobile:kotlincm: scenarios run with the scenario runner that \`.adw/scenarios.md\` describes; evidence: per-issue scenario images; platforms: android, ios`. That is the profile described from its fields, with the platforms named. The `cli` and `web` lines are unchanged.
- `stepDefExtensionsFor('cucumber-jvm')` is `['.kt', '.java']` and `isGherkinFramework('cucumber-jvm')` is true. A `.kt` step file under the declared `## Step Def Directory` is found by `hasStepDefinitions` with the descriptor runner's extensions, so the scenario proof is not skipped as "No step definition files found".
- `inferStackLanguages` returns exactly `{'jvm'}` for `cucumber-jvm` with `./gradlew …` commands, and `stackCoherenceCheck` warns on nothing. `cucumber-js` with `./gradlew test` still warns `language-mismatch`.
- `FRAMEWORK_SUPPRESSION_PATTERNS` has a `jvm` entry with the seven Kotlin/Java patterns, and the fix-round guard rejects a round that adds any of them in a `jvm` repository.
- `.claude/commands/review.md` has `### Mobile applications (Kotlin Compose Multiplatform)` with rules for what a mobile user sees, blocking a per-issue scenario shown on one platform only, and never starting an emulator, a simulator, Appium or the app. Its Step 3 names `@Suppress(` and `@SuppressWarnings(`.
- `.claude/commands/adw_init.md` step 3 offers `cli`, `web` and `mobile:kotlincm`, says the last is set by hand only and never detected, and preserves it verbatim.
- `adws/core/__tests__/applicationType.test.ts`, `adws/__tests__/adwInitPrompt.test.ts` and `adws/__tests__/reviewPrompt.test.ts` pass with three types. The latter two need no edits.
- Unit tests for the mapping, the registry and the stack check exist and pass. Lint, both type checks, the build, the full unit suite and the regression scenarios pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/applicationType.test.ts adws/phases/__tests__/applicationTypeGate.test.ts adws/phases/__tests__/applicationTypeGate.park.test.ts adws/phases/__tests__/reviewPromptContext.test.ts` — the mapping, the gate and the guidance section handed to the reviewer.
- `bunx vitest run adws/core/__tests__/stepDefDetection.test.ts adws/core/__tests__/scenarioRunner.test.ts adws/core/__tests__/stackCoherenceCheck.test.ts` — the registry and the stack check.
- `bunx vitest run adws/core/__tests__/fixRoundGuard.table.test.ts adws/core/__tests__/fixRoundGuard.suppression.test.ts adws/core/__tests__/fixRoundGuard.config.test.ts` — the `jvm` suppression patterns.
- `bunx vitest run adws/__tests__/reviewPrompt.test.ts adws/__tests__/adwInitPrompt.test.ts` — the prompt pins with three types.
- `bun run lint` — linter.
- `bunx tsc --noEmit` — type check of every `**/*.ts`, including tests and `features/`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type check.
- `bun run build` — build.
- `bun run test:unit` — the full unit suite, zero regressions.
- `bun run lint:branch-names` — the prompts under `.claude/commands/` still name no branch to act on.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1043"` — this issue's per-issue scenarios, once the scenario writer has written them.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite, zero regressions.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - Keep files under 300 lines.
  - Use enums for named constant sets (`Platform`).
  - Treat data as immutable (`readonly` fields, `as const` table).
  - Comment only invariants, ordering constraints and non-obvious reasons: no restating comments, no issue numbers, no JSDoc that echoes a name.
- No new library is needed. `.adw/commands.md` names `bun add <package>` if that ever changes.
- `.claude/commands/adw_init.md` is a `hashInputs:` file. Merging this change bumps the framework hash, so every registered target repository, ADW itself included, regenerates `.adw/` on its next workflow. That is intended: the PRD's Reeve sequence relies on the upgrade's `adw_init` preserving a hand-set `mobile:kotlincm`. This is why the preserve sub-bullet changes in this slice.
- **Consequence not named by ADR-0064:** the `jvm` entry in `FRAMEWORK_SUPPRESSION_PATTERNS` and the two JVM patterns in review Step 3. A new `StackLanguage` does not compile without the entry, and the existing pins (`fixRoundGuard.table.test.ts`, `reviewPrompt.test.ts`) require a non-empty entry that the reviewer names. `/document` (or a later ADR amendment) should record the `jvm` pattern set next to ADR-0059's table.
- **Follow-ups outside this slice:**
  - The fix-round guard's `PROTECTED_PATH_RULES` do not cover Gradle and Kotlin lint configuration (`build.gradle.kts`, `settings.gradle.kts`, `gradle.properties`, `detekt.yml`, `.editorconfig` for ktlint). The reviewer's Step 3 still blocks a weakening change there ("and the like").
  - `adw_init` step 1 may classify an un-typed mobile repository as `cli`, because it has no browser UI. The PRD's `adw_init` slice should make that undecided.
- **Name collision:** `@paysdoc/devplatform` exports a `Platform` enum (the forge: `github`, `gitlab`, …), and `UBIQUITOUS_LANGUAGE.md` defines **Platform** as a code hosting service. The new enum follows the PRD's name, lives only in `applicationType.ts` and is never imported beside the forge one in this slice. A later module that needs both should alias one on import, and `/document` should qualify the glossary entry (device platform vs. code-host platform).
- **Interim behaviour:** `platforms` is read only by `describeApplicationProfile` here. Nothing boots a device yet, so a mobile repository's run-by-tag command gets no `ADW_ANDROID_*`/`ADW_IOS_UDID` variables, and the proof reuses the `web` line `no scenario opened a page` until the platform-attribution slice adds `no scenario opened a screen`. Until a Kotlin step definition exists, the scenario proof is skipped, which is what lets an empty repository bootstrap (story 45).
- **Later slices of the PRD, not this one:**
  - device lifecycle, device-source sections, `device_boot_failed` park, device janitor
  - image platform attribution and proof lines
  - `adw_init`'s Gradle/cucumber-jvm descriptors, device-source defaults and `N/A` dev server
  - the `generate_step_definitions.md` environment-variable note
- `scenario_writer.md` stays unchanged (story 8). `generate_step_definitions.md` in descriptor mode is already polymorphic on `## BDD Framework`, so it writes Kotlin cucumber-jvm step definitions into `## Step Def Directory` with no change (story 9).
- Leave `app_docs/feature-gfv9kt-application-type-mapping.md` ("holds exactly `cli` … and `web`", "no phase changes") and `app_docs/feature-9gjajh-freeze-and-coherence.md` to `/document`. ADR-0064's `### Confirmation` stays "Not implemented" because the device lifecycle does not exist yet. Do not edit it here.
- Nothing here is live on the pipeline host until a release to the production branch and a host restart (ADR-0064).
