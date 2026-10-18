# Feature: Per-issue images carry a platform and the proof states each scenario's platform coverage

## Metadata
issueNumber: `1046`
adwId: `lrbgfw-feat-per-issue-image`
issueJson: `{"number":1046,"title":"feat: per-issue images carry a platform and the proof states each scenario's platform coverage","body":"## Parent PRD\n\n`specs/prd/mobile-application-type-kotlin-compose-multiplatform.md` (decision record: `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`)\n\n## What to build\n\nFor a profile with platforms, every selected per-issue image gets a platform from the first directory segment of its path under the harvest root (`android/…`, `ios/…`); anything else is unattributed and never selected. The proof assembler computes per-scenario platform coverage and the proof document gains one line per per-issue scenario whose images cover a non-empty strict subset of the profile's platforms (platforms present and missing), and a \"no scenario opened a screen\" line when no image was selected at all. Nothing mechanical blocks; the reviewer decides. Title attribution of JUnit cases is unchanged. See PRD \"Image platform attribution and proof\".\n\n## Acceptance criteria\n\n- [ ] A pure attribution function: `android/login.png` → android, `ios/a/b.png` → ios, `login.png` and `linux/x.png` → unattributed, given platforms `android` and `ios`\n- [ ] Two cases with the identical scenario title from the two platform runs both attribute to the scenario and both images are selected\n- [ ] A scenario with images for android only produces a proof line naming android present and ios missing; one with both or none produces no such line\n- [ ] A profile-with-platforms proof with no selected image carries the \"no scenario opened a screen\" line; a `web` proof keeps its existing line\n- [ ] Unattributed images are listed as such and are not in `perIssueImages`, so they reach neither the reviewer nor the comments\n- [ ] `cli` and `web` proofs are byte-identical to before\n- [ ] Unit tests (PRD Testing Decisions 3), with the proof-assembler tests and helpers as prior art\n\n## Blocked by\n\n- Blocked by #1043\n\n## Touched Files\n\n- adws/proof/imagePlatform.ts\n- adws/proof/__tests__/imagePlatform.test.ts\n- adws/proof/proofAssembler.ts\n- adws/proof/__tests__/proofAssembler.test.ts\n- adws/proof/__tests__/proofAssembler.images.test.ts\n- adws/proof/__tests__/proofAssembler.helpers.ts\n- adws/proof/proofDocument.ts\n- adws/proof/types.ts\n\n## User stories addressed\n\n- User stories 27, 28, 29, 30, 31, 32, 33\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-18T15:00:11Z","comments":[],"actionableComment":null}`

## Feature Description

A `mobile:kotlincm` repository runs every scenario twice, once on Android and once on iOS. Its screenshot hook writes the images under `$ADW_PROOF_DIR/android/…` and `$ADW_PROOF_DIR/ios/…`, and both platform runs report the same scenario title in the JUnit report. Today the proof assembler has no notion of a platform. It selects the images of the per-issue cases by title, but it cannot say which platform an image shows, whether a scenario was shown on one platform only, or that an image lies outside any platform directory. When no image is selected, it writes the `web` line `no scenario opened a page`, which is the wrong word for an app.

This slice gives the proof that notion. It is driven by the `platforms` list that #1043 added to the application profile (`android` and `ios` for `mobile:kotlincm`, empty for `cli` and `web`):

- A pure function reads an image's platform from the first directory segment of its path under the harvest root. Any other path is unattributed.
- For a profile with platforms, every selected per-issue image carries its platform. An unattributed image is never selected. The proof lists it as left out, so it reaches neither the reviewer nor the issue and PR comments.
- The assembler computes, per per-issue scenario, the platforms its images show. The proof document gains one line for each scenario whose images cover some of the profile's platforms but not all, naming the platforms present and missing.
- A proof with no selected image says `no scenario opened a screen`, the mobile counterpart of the `web` line.
- Nothing blocks mechanically. The reviewer reads the lines and decides, under the mobile guidance section #1043 added to `review.md`.

`cli` and `web` proofs stay byte-identical. Their profiles have no platforms, so none of the new code runs for them.

## User Story
As a reviewer agent judging a change to a Kotlin Compose Multiplatform app
I want the scenario proof to say which platforms each per-issue scenario's images show, which scenario misses a platform, which stray images were left out, and that no scenario opened a screen when none did
So that I can judge the change on both Android and iOS, and block when a platform was not exercised, without anything mechanical deciding for me

## Problem Statement

- `PerIssueImage` has no platform, so the reviewer, the comments and the proof cannot tell an Android image from an iOS one, except by guessing from the path.
- No line tells the reviewer that a per-issue scenario produced images on one platform only. ADR-0064 and the merged mobile guidance in `review.md` make that a blocker the reviewer must find, but the proof gives it nothing to find it by.
- An image the repository's hook wrote outside `android/` and `ios/`, for example at the proof directory's root or under `linux/`, is selected as evidence today when a per-issue case attaches it. A stray file can pass for a screenshot of the change.
- A `mobile:kotlincm` proof with no selected image says `no scenario opened a page`. That is the `web` line, and an app has screens, not pages.

## Solution Statement

Three pure modules change and one is added. Selection, the tag outcomes and the shell (`runScenarioProof`) stay as they are.

1. **`adws/proof/imagePlatform.ts` (new, pure).**
   - `platformOfImage(relPath, platforms)` returns the profile platform named by the first segment of a harvest-root-relative POSIX path, or `null` (unattributed).
   - `scenarioPlatformCoverage(images, platforms)` returns one `ScenarioPlatformCoverage` per scenario that has an image: `{ scenario, present, missing }`, both lists in the profile's order.
2. **`adws/proof/types.ts`.** `PerIssueImage` gains an optional `platform?: Platform`, which is set only for a profile with platforms. `ScenarioPlatformCoverage` is added.
3. **`adws/proof/proofAssembler.ts`.**
   - Title attribution and `selectEvidence` are unchanged.
   - When the profile has platforms, a new step locates every selected image. Those with a platform become `perIssueImages`, each with its `platform`. Those without are moved to a list of left-out paths. Coverage is computed from the attributed images.
   - When the profile has no platforms, the evidence is passed on as today, with `platforms: null`.
4. **`adws/proof/proofDocument.ts`.**
   - Exports a third fixed line, `NO_SCENARIO_OPENED_A_SCREEN = 'no scenario opened a screen'`.
   - `ProofEvidence` gains `platforms: PlatformEvidence | null`, where `PlatformEvidence = { expected, coverage, outside }`.
   - The Evidence section picks its no-image line by whether the profile has platforms.
   - For a profile with platforms, the section adds one `On some platforms only: …` line per partial scenario, and a `Left out, because they are in no platform directory (…)` line. With `platforms: null` it renders exactly the old lines.

### Decisions this plan makes inside ADR-0064 (none changes it)

- **The directory match is exact.** Only the first segment of `relPath` counts, compared whole and case-sensitively with the profile's platform values. So `android/x.png` and `ios/a/b.png` are attributed, and the following are unattributed: `x.png` at the root, `linux/x.png`, `Android/x.png`, `androidx/x.png`, `android.png` and `screens/android/x.png`. The PRD calls the convention "exactly `$ADW_PROOF_DIR/android/…` and `$ADW_PROOF_DIR/ios/…`".
- **Platform attribution runs after title attribution, on the per-issue images only.**
  - An image whose case matches no scenario stays in the existing `Left out, because no scenario in the feature files has their name` line, and is never listed twice.
  - Images of regression cases and images no case attached are neither selected nor listed, as today.
- **Unattributed images are listed by their harvest-root path, never by their absolute path.** They are not in `perIssueImages`, and so not in the reviewer's `perIssueImages` argument, the review upload or the PR comment.
- **Coverage is grouped by the reported test-case name**, which is `PerIssueImage.scenario`. The order is that of each scenario's first image in the report.
  - A line is written only for a non-empty strict subset of the profile's platforms.
  - A per-issue scenario without an image has no line. The no-image line and the reviewer's reading of the diff cover it.
- **The no-image line follows the profile, not the run.**
  - A profile with platforms says `no scenario opened a screen` whenever no image was selected. That includes a notice proof (no step definitions), a per-issue tag that was not run, and a per-issue run that left no report, mirroring what `web` does with its line.
  - `web` keeps `no scenario opened a page`.
  - `cli` has no Evidence section.
- **The image lines keep their format** (`` - `<scenario>`: <absPath> ``). The `android/` or `ios/` in the path shows the platform. The merged mobile section of `review.md` already tells the reviewer to read it there.
- **The proof's outer shapes are unchanged.** `AssembledProof`, `ScenarioProofResult` and `UploadedArtifact` keep their shape. Coverage lives in the document only. `perIssueImages` entries carry `platform` only for a profile with platforms, and a `web` image object has no `platform` key at all.

## Relevant Files
Use these files to implement the feature:

- `README.md`: project overview. Its `adws/proof/` tree gets a line for the new module.
- `.adw/coding_guidelines.md`: guidelines to follow strictly (pure functions, guard clauses, `readonly`, files under 300 lines, comments only for invariants and non-obvious reasons, no issue numbers in comments).
- `app_docs/feature-9gjajh-proof-and-scenario-proof.md`: conditional doc for `adws/proof/**`. It states the assembler's contracts (selection only from the per-issue run, `no scenario opened a page`, the left-out line). Read it. `/document` updates it.
- `app_docs/feature-gfv9kt-application-type-mapping.md`: conditional doc for `ApplicationProfile.platforms` and `Platform`.
- `specs/prd/mobile-application-type-kotlin-compose-multiplatform.md`: "Image platform attribution and proof", "Testing Decisions" item 3, user stories 27 to 33, and the Further Notes on the harvest root.
- `specs/adr/0064-mobile-kotlincm-type-descriptor-runner-adw-booted-devices.md`: the platform of an image is the first directory segment under `ADW_PROOF_DIR`, and the reviewer, not the assembler, blocks on a missing platform.
- `specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md`: what stands. Title attribution, attachment lines as the source, zero images allowed, the reviewer as judge.
- `adws/core/applicationType.ts`: read only. `Platform` (`android`, `ios`), `ApplicationProfile.platforms`, and `APPLICATION_TYPE_PROFILES['mobile:kotlincm']` with `platforms: [Platform.Android, Platform.Ios]`.
- `adws/proof/types.ts`: `PerIssueImage` gains `platform?`, and `ScenarioPlatformCoverage` is added.
- `adws/proof/proofAssembler.ts`: platform attribution after `selectEvidence`, and coverage, for a profile with platforms. Currently 217 lines.
- `adws/proof/proofDocument.ts`: `NO_SCENARIO_OPENED_A_SCREEN`, `PlatformEvidence`, `ProofEvidence.platforms`, the coverage lines and the left-out-images line. Currently 70 lines.
- `adws/proof/proofArtifactHarvester.ts`: read only. `relPath` is relative to the harvest root and POSIX-normalised.
- `adws/phases/scenarioProof.ts` and `adws/core/scenarioRunner.ts`: read only. The descriptor runner has `proofDirPerTag: false`, so its `ADW_PROOF_DIR` is the artifacts directory, which is the harvest root. A `mobile:kotlincm` image's `relPath` therefore starts with `android/` or `ios/`.
- `adws/proof/featureScenarioIndex.ts`: read only. `scenariosForTestCase` matches a bare case name, as a non-Playwright runner reports it, against the last title segment.
- `adws/core/testReportParser.ts`: read only. `TestCaseResult.attachments` holds the `[[ATTACHMENT|…]]` paths, relative to the report's directory.
- `adws/proof/__tests__/proofAssembler.helpers.ts`: test fixtures. It gains a profile-with-platforms fixture and a mobile feature.
- `adws/proof/__tests__/proofAssembler.test.ts`: the fixed-lines tests. 278 lines, so it gets only the screen-line test and one extra assertion.
- `adws/proof/__tests__/proofAssembler.images.test.ts`: the selection tests. They gain selection with platforms.
- `adws/proof/__tests__/proofAssembler.scenarios.test.ts`: read only, prior art for title attribution (bare names, outline rows).
- `adws/phases/reviewPromptContext.ts`, `adws/phases/reviewPhase.ts`, `adws/proof/prProofPublisher.ts`, `adws/proof/proofUploader.ts`: read only. They consume `perIssueImages`, so excluding an image from it keeps it from the reviewer, the review upload and the PR comment. The R2 key is `proof/{adwId}/{relPath}`, so `android/x.png` and `ios/x.png` never collide.
- `.claude/commands/review.md` and `adws/__tests__/reviewPrompt.test.ts`: read only. Step 6 quotes `no scenario opened a page`. The `Mobile applications (Kotlin Compose Multiplatform)` section tells the reviewer to block a one-platform scenario. Both stay unchanged in this slice (see Notes).
- `features/per-issue/step_definitions/feature-994-assembler.steps.ts`, `feature-994-then.steps.ts`, `feature-994-world.ts`, `feature-994-names.ts`, `feature-994-runner.ts`: prior art and reusable phrases for the `@adw-1046` step definitions.

### New Files
- `adws/proof/imagePlatform.ts`: the pure platform attribution and per-scenario coverage.
- `adws/proof/__tests__/imagePlatform.test.ts`: unit tests of both functions.
- `adws/proof/__tests__/proofAssembler.platforms.test.ts`: the proof lines of a profile with platforms, plus the byte-identity pins of `cli` and `web` proofs. It is a separate file because `proofAssembler.test.ts` is already at 278 lines.

## Implementation Plan
### Phase 1: Foundation
Pin what must not change before touching anything. Write exact-text tests of a `cli` proof and of a `web` proof, with and without an image, and see them pass on the unchanged code. Make the existing `web` selection test strict, so that a `platform` key on a `web` image would fail it. Add the profile-with-platforms fixtures to the test helpers. Add `platform?` and `ScenarioPlatformCoverage` to `types.ts`. Write and test the pure `imagePlatform.ts`.

### Phase 2: Core Implementation
Make the assembler attribute platforms when the profile has them. Attributed images become `perIssueImages` with their `platform`, and unattributed ones go to the left-out list. Then compute coverage. Extend `ProofEvidence` with `platforms: PlatformEvidence | null`, and render the screen line, the per-scenario coverage lines and the left-out-images line. Every step is test first, in the co-located `__tests__/`.

### Phase 3: Integration
Nothing downstream changes. `runScenarioProof`, the review prompt context, the review upload and the PR comment all read `perIssueImages`, which now holds only attributed images for a profile with platforms. Give the `@adw-1046` scenarios their step definitions, using the descriptor runner's proof layout. Add the module to the README tree, then run every validation command.

## Step by Step Tasks
Execute every step in order, top to bottom.

The branch is at `dev` `3665bd1f`, after #1043 merged, so `Platform`, `ApplicationProfile.platforms` and the `mobile:kotlincm` profile already exist. No merge is needed before the first step.

### 1. Pin the `cli` and `web` proofs as they are (green before any change)
- Create `adws/proof/__tests__/proofAssembler.platforms.test.ts` with a `describe('assembleScenarioProof — cli and web proofs are as they were', …)`. Its expected values are literal text. Never compute them with `renderProofDocument` or other production code.
- **`writes a web proof with an image and a left-out case exactly as before`.** Assemble with:
  - `runs: [runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens'))), runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')]), testCase('Cart › Named by another runner', [attachment('adw-42/other/a.png')])))]`
  - `scenarioIndex: indexOf(REGRESSION_FEATURE, PER_ISSUE_FEATURE)`
  - `artifacts: [artifact('adw-42/total/a.png'), artifact('adw-42/other/a.png')]`
  - the default `web` profile

  Then assert `proof.document` `toBe` this text:
  ````ts
  [
    '# Scenario Proof',
    '',
    `Generated at: ${GENERATED_AT}`,
    '',
    '## @regression Scenarios (severity: blocker)',
    '',
    '**Status:** ✅ PASSED',
    '**Exit Code:** 0',
    '**Report:** 1 passed, 0 failed of 1',
    '',
    '### Output',
    '',
    '```',
    'ok',
    '```',
    '',
    '## @adw-42 Scenarios (severity: blocker)',
    '',
    '**Status:** ✅ PASSED',
    '**Exit Code:** 0',
    '**Report:** 2 passed, 0 failed of 2',
    '',
    '### Output',
    '',
    '```',
    'ok',
    '```',
    '',
    '## Evidence',
    '',
    'Per-issue scenario images (1):',
    '',
    `- \`Cart › The cart shows the total\`: ${PROOF_DIR}/artifacts/adw-42/total/a.png`,
    '',
    'Left out, because no scenario in the feature files has their name: `Cart › Named by another runner`',
    '',
  ].join('\n')
  ````
- **`ends a web proof without an image with the page line, exactly as before`.** Use the same runs without attachments. Assert that the text from `## Evidence` on is `'## Evidence\n\nPer-issue scenario images (0):\n\nno scenario opened a page\n'`.
- **`writes a cli proof exactly as before, with no Evidence section, though the issue's case attached an image`.** Use the `cli` profile, a passing regression run, and a per-issue run whose one case attaches `adw-42/total/a.png`, which is listed in `artifacts`. Assert the full literal document: the two tag sections as above, with `**Report:** 1 passed, 0 failed of 1` for both, and no Evidence section. A small local function in the test may build the literal lines of a passed tag section.
- In `adws/proof/__tests__/proofAssembler.images.test.ts`, change the first test's `expect(proof.perIssueImages).toEqual([...])` to `toStrictEqual`. A `web` image must have no `platform` key, not even an undefined one.
- Run `bunx vitest run adws/proof`. Everything is green on the unchanged code. If a pin fails, correct the literal to what the current code renders, since that output is what "before" means, and say so in the commit.

### 2. Test helpers for a profile with platforms
In `adws/proof/__tests__/proofAssembler.helpers.ts`:
- Add `export const MOBILE_PROFILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm'];`.
- Add a per-issue feature whose cases a descriptor runner reports by scenario name alone:
  ```ts
  export const SIGN_IN_FEATURE = `@adw-42
  Feature: Sign-in

    Scenario: The user signs in
      Given the sign-in screen

    Scenario: The user signs out
      Given the home screen
  `;
  ```
- `artifact()` and `attachment()` already produce the descriptor layout. For example, `artifact('android/sign-in.png')` lies at `${PROOF_DIR}/artifacts/android/sign-in.png` with `relPath` `android/sign-in.png`. Add no new path helper.
- In the mobile tests, name the cases by the bare scenario name (`testCase('The user signs in', …)`), as a runner such as cucumber-jvm reports it. The existing last-segment rule of `scenariosForTestCase` matches such names. The two platform runs of a scenario are two cases with that identical name.

### 3. The image platform attribution (test first, then `types.ts` and `imagePlatform.ts`)
- Create `adws/proof/__tests__/imagePlatform.test.ts`. Import `Platform` from `../../core/applicationType` and set `const BOTH = [Platform.Android, Platform.Ios]`.
  - `describe('platformOfImage', …)`:
    - `it.each` with `['android/login.png', Platform.Android]`, `['ios/a/b.png', Platform.Ios]` and `['android/sign-in/deep/x.png', Platform.Android]` reads each path as that platform, given `BOTH`.
    - `it.each` over `'login.png'`, `'linux/x.png'`, `'Android/login.png'`, `'IOS/login.png'`, `'androidx/login.png'`, `'android.png'` and `'screens/android/login.png'` reads each as unattributed (`null`), given `BOTH`.
    - `knows only the platforms it is given`: `platformOfImage('ios/login.png', [Platform.Android])` is `null`, and `platformOfImage('android/login.png', [])` is `null`.
  - `describe('scenarioPlatformCoverage', …)` builds `PerIssueImage`s with a small local `image(scenario, relPath, platform)`:
    - `names both platforms present and none missing for a scenario with an image on each`.
    - `names android present and ios missing for a scenario with android images only, however many it has`. Use two android images and expect one entry.
    - `lists the platforms in the order of the profile, not of the images`. With an ios image first, `present` is still `[android, ios]`.
    - `gives one entry per scenario, in the order of its first image`. Two scenarios are interleaved.
    - `gives no entry when there is no image`: the result is `[]`.
  - Run the file and see it fail (the module is missing).
- In `adws/proof/types.ts`:
  - `import type { Platform } from '../core/applicationType';`.
  - Add `readonly platform?: Platform;` to `PerIssueImage`, with a short doc saying it is set only where the application profile has platforms.
  - Add:
    ```ts
    /** The platforms a per-issue scenario's images show and those they do not, each in the order of the profile. */
    export interface ScenarioPlatformCoverage {
      /** The test-case name, as on its images. */
      readonly scenario: string;
      readonly present: readonly Platform[];
      readonly missing: readonly Platform[];
    }
    ```
- Create `adws/proof/imagePlatform.ts`. Keep it pure, with no I/O. Its header comment states the invariant: the harvest root of a descriptor run is its `ADW_PROOF_DIR`, so the first segment is the directory the repository's screenshot hook chose. Do not cite issue numbers. Sketch:
  ```ts
  import type { Platform } from '../core/applicationType';
  import type { PerIssueImage, ScenarioPlatformCoverage } from './types';

  /** Null: the image is unattributed, at the root or under a directory that names no platform of the profile. */
  export function platformOfImage(relPath: string, platforms: readonly Platform[]): Platform | null {
    const [directory, ...rest] = relPath.split('/');
    if (rest.length === 0) return null;
    return platforms.find(platform => platform === directory) ?? null;
  }

  function coverageOf(scenario: string, images: readonly PerIssueImage[], platforms: readonly Platform[]): ScenarioPlatformCoverage {
    const shown = new Set(images.filter(image => image.scenario === scenario).map(image => image.platform));
    return { scenario, present: platforms.filter(p => shown.has(p)), missing: platforms.filter(p => !shown.has(p)) };
  }

  /** One entry per scenario that has an image, in the order of its first image. */
  export function scenarioPlatformCoverage(images: readonly PerIssueImage[], platforms: readonly Platform[]): ScenarioPlatformCoverage[] {
    return [...new Set(images.map(image => image.scenario))].map(scenario => coverageOf(scenario, images, platforms));
  }
  ```
- Run `bunx vitest run adws/proof/__tests__/imagePlatform.test.ts`. It is green.

### 4. Selection with platforms in the assembler (test first)
- In `adws/proof/__tests__/proofAssembler.images.test.ts`, add `describe('assembleScenarioProof — the platform of each image, for a profile with platforms', …)`, using `MOBILE_PROFILE`, `SIGN_IN_FEATURE`, `NOT_RUN(REGRESSION)` and a per-issue run:
  - **`selects the images of both platform runs of one scenario, which report the same title, each with its platform`.**
    - Cases: `testCase('The user signs in', [attachment('android/sign-in.png')])` and `testCase('The user signs in', [attachment('ios/sign-in.png')])`.
    - Artifacts: both images.
    - `perIssueImages` `toStrictEqual`, in report order: `{ absPath: `${PROOF_DIR}/artifacts/android/sign-in.png`, relPath: 'android/sign-in.png', scenario: 'The user signs in', platform: Platform.Android }`, then the same for `ios` with `Platform.Ios`.
  - **`never selects an image of the issue's scenarios that lies in no platform directory`.**
    - One case attaches `sign-in.png` at the root, `linux/sign-in.png` and `android/sign-in.png`, and all three are artifacts.
    - Only `android/sign-in.png` is in `perIssueImages`.
    - `proof.document` contains neither `${PROOF_DIR}/artifacts/sign-in.png` nor `${PROOF_DIR}/artifacts/linux/sign-in.png`. No absolute path of a left-out image reaches the document either.
  - **`keeps the images of a failed scenario, with their platform`.** A `'failed'` case's `android/…` image is selected with `platform: Platform.Android`.
  - **`leaves out the directory of a platform the profile does not have`.** Use `applicationProfile: { ...MOBILE_PROFILE, platforms: [Platform.Android] }` and `android/` and `ios/` images of one scenario. Only the android image is selected.
  - **`never gives a platform to an image of a web repository, whatever its directory`.** Use the `web` profile, `PER_ISSUE_FEATURE`, and a case `Cart › The cart shows the total` attaching `android/a.png`. The image is selected and `toStrictEqual` to `{ absPath, relPath: 'android/a.png', scenario: 'Cart › The cart shows the total' }`, with no `platform` key.
  - Run the file and see the new cases fail.
- In `adws/proof/proofDocument.ts`, extend the evidence types only (rendering comes in step 5):
  ```ts
  /** What a profile with platforms adds to the Evidence section. */
  export interface PlatformEvidence {
    /** The profile's platforms, in its order. */
    readonly expected: readonly Platform[];
    /** One entry per per-issue scenario with a selected image. */
    readonly coverage: readonly ScenarioPlatformCoverage[];
    /** Paths, relative to the harvest root, of the issue's images that lie in no platform directory. */
    readonly outside: readonly string[];
  }
  ```
  Then add `readonly platforms: PlatformEvidence | null;` to `ProofEvidence`. Its doc says it is null where the application profile has no platforms.
- In `adws/proof/proofAssembler.ts`:
  - Import `type Platform` beside `EvidenceKind, type ApplicationProfile`, and `platformOfImage, scenarioPlatformCoverage` from `./imagePlatform`.
  - Add `type SelectedImages = Omit<ProofEvidence, 'platforms'>;`. Retype `NO_EVIDENCE` and the return of `selectEvidence` to it. The body of `selectEvidence` is unchanged.
  - Add the platform step as small named functions, max two levels of nesting, with no inline callback over about three lines. For example:
    ```ts
    interface LocatedImage {
      readonly image: PerIssueImage;
      readonly platform: Platform | null;
    }

    function locate(image: PerIssueImage, platforms: readonly Platform[]): LocatedImage {
      return { image, platform: platformOfImage(image.relPath, platforms) };
    }

    // An image in no platform directory is never evidence: a stray file must not pass for a screenshot of the change.
    function withPlatforms({ images, unattributed }: SelectedImages, platforms: readonly Platform[]): ProofEvidence {
      const located = images.map(image => locate(image, platforms));
      const attributed = located.flatMap(({ image, platform }) => (platform === null ? [] : [{ ...image, platform }]));
      const outside = located.filter(({ platform }) => platform === null).map(({ image }) => image.relPath);
      return { images: attributed, unattributed, platforms: { expected: platforms, coverage: scenarioPlatformCoverage(attributed, platforms), outside } };
    }

    function evidenceFor(selected: SelectedImages, profile: ApplicationProfile): ProofEvidence {
      if (profile.platforms.length === 0) return { ...selected, platforms: null };
      return withPlatforms(selected, profile.platforms);
    }
    ```
  - In `assembleScenarioProof`, compute `evidence` as `expectsImages(applicationProfile) ? evidenceFor(selectEvidence(perIssueRecord, scenarioIndex, artifacts), applicationProfile) : null`. Extract `const perIssueRecord = runs.find(record => record.tag.role === ScenarioTagRole.PerIssue)` so the line stays readable.
  - Keep `perIssueImages: evidence?.images ?? []`. For a profile with platforms it now holds only attributed images.
  - Extend the header comment by one clause: for a profile with platforms, the assembler also decides which platform each image shows. Keep the file under 300 lines; it is about 245 after the change.
- Run `bunx vitest run adws/proof`. The selection tests are green. Step 1's pins are still green, because `platforms: null` renders as before.

### 5. The proof lines (test first, then `proofDocument.ts`)
- In `adws/proof/__tests__/proofAssembler.test.ts`:
  - Import `NO_SCENARIO_OPENED_A_SCREEN`, and `MOBILE_PROFILE` and `SIGN_IN_FEATURE` from the helpers.
  - Rename `describe('assembleScenarioProof — the two fixed lines', …)` to `… — the fixed lines`.
  - In its first test (the `web` page line), add `expect(proof.document).not.toContain(NO_SCENARIO_OPENED_A_SCREEN)`.
  - Add `says that no scenario opened a screen, and not that no scenario opened a page, when a proof of a profile with platforms holds no image, and the run does not fail for it`. Use the mobile profile, a per-issue run whose case attaches nothing, and `hasBlockerFailures` false.
  - Keep the file under 300 lines. Put every other new test in the new file.
- In `adws/proof/__tests__/proofAssembler.platforms.test.ts`, add `describe('assembleScenarioProof — the platforms each per-issue scenario shows', …)`:
  - **`names android present and ios missing for a scenario with images on android only`.** The document contains `` On some platforms only: `The user signs in` (present: android; missing: ios) ``.
  - **`names ios present and android missing, in the order of the profile, when only ios shows a scenario`.**
  - **`writes no such line for a scenario with images on both platforms`.** The document does not contain `On some platforms only`.
  - **`writes one line for a scenario that misses a platform, however many images it has, and none for a per-issue scenario without an image`.**
    - `The user signs in` has two android images, and `The user signs out` attaches nothing.
    - Exactly one `On some platforms only` line appears, and `The user signs out` is not mentioned on any such line.
    - `NO_SCENARIO_OPENED_A_SCREEN` is absent, because an image was selected.
  - **`lists the issue's images that lie in no platform directory as left out`.**
    - A case attaches `sign-in.png` and `linux/sign-in.png`, both artifacts.
    - The document contains `` Left out, because they are in no platform directory (`android/`, `ios/`): `sign-in.png`, `linux/sign-in.png` ``.
    - Because nothing was selected, the document also contains `NO_SCENARIO_OPENED_A_SCREEN`, and `perIssueImages` is `[]`.
  - **`writes the Evidence section of a profile with platforms in this order: images, platforms, left-out cases, left-out images`.**
    - Cases, in this order:
      - `The user signs in`: `android/sign-in.png`
      - `The user signs in`: `ios/sign-in.png`
      - `The user signs out`: `android/sign-out.png` and `sign-out.png`
      - `Named by another runner`: `android/other.png`
    - All five images are artifacts.
    - Assert that the text from `## Evidence` on is exactly:
      ```ts
      [
        '## Evidence',
        '',
        'Per-issue scenario images (3):',
        '',
        `- \`The user signs in\`: ${PROOF_DIR}/artifacts/android/sign-in.png`,
        `- \`The user signs in\`: ${PROOF_DIR}/artifacts/ios/sign-in.png`,
        `- \`The user signs out\`: ${PROOF_DIR}/artifacts/android/sign-out.png`,
        '',
        'On some platforms only: `The user signs out` (present: android; missing: ios)',
        '',
        'Left out, because no scenario in the feature files has their name: `Named by another runner`',
        '',
        'Left out, because they are in no platform directory (`android/`, `ios/`): `sign-out.png`',
        '',
      ].join('\n')
      ```
  - **`writes no platform line for a profile with one platform`.** Use `{ ...MOBILE_PROFILE, platforms: [Platform.Android] }` and an `android/` and an `ios/` image of one scenario.
    - No `On some platforms only` line appears.
    - The left-out line reads `` Left out, because they are in no platform directory (`android/`): `ios/…` ``.
  - **`says "no per-issue scenarios" and "no scenario opened a screen" together when the issue has no scenarios of its own, and fails for neither`.** Use `NOT_RUN(PER_ISSUE)`.
  - **`says that no scenario opened a screen in a notice proof of a profile with platforms`.** Use a `notice` with `runs: []`.
  - **`never blocks on a missing platform`.** Both tags pass and the images are on android only, so `hasBlockerFailures` is `false`.
  - Run the files and see the new cases fail.
- In `adws/proof/proofDocument.ts`:
  - Add `export const NO_SCENARIO_OPENED_A_SCREEN = 'no scenario opened a screen';` beside the other two. Change the header's "the two fixed lines are exported" to "the fixed lines are exported".
  - `import type { Platform } from '../core/applicationType';` and `ScenarioPlatformCoverage` from `./types`.
  - Keep a module constant for the line prefix, `const SOME_PLATFORMS_ONLY = 'On some platforms only';`. Do not export it. Tests and scenarios spell the full line out.
  - Replace the inline `shown` expression of `evidenceSection` with named functions. Keep the existing `leftOutLines` unchanged:
    ```ts
    function noImageLine(platforms: PlatformEvidence | null): string {
      return platforms ? NO_SCENARIO_OPENED_A_SCREEN : NO_SCENARIO_OPENED_A_PAGE;
    }

    function imageLines(images: readonly PerIssueImage[], platforms: PlatformEvidence | null): string[] {
      if (images.length === 0) return [noImageLine(platforms)];
      return images.map(image => `- \`${image.scenario}\`: ${image.absPath}`);
    }

    function partialCoverageLine({ scenario, present, missing }: ScenarioPlatformCoverage): string {
      return `${SOME_PLATFORMS_ONLY}: \`${scenario}\` (present: ${present.join(', ')}; missing: ${missing.join(', ')})`;
    }

    // A scenario with no image is not listed: the no-image line and the reviewer's reading of the diff cover it.
    function partialCoverageLines(platforms: PlatformEvidence | null): string[] {
      const partial = platforms?.coverage.filter(({ present, missing }) => present.length > 0 && missing.length > 0) ?? [];
      return partial.length === 0 ? [] : ['', ...partial.map(partialCoverageLine)];
    }

    function outsideLines(platforms: PlatformEvidence | null): string[] {
      if (!platforms || platforms.outside.length === 0) return [];
      const directories = platforms.expected.map(platform => `\`${platform}/\``).join(', ');
      const paths = platforms.outside.map(relPath => `\`${relPath}\``).join(', ');
      return ['', `Left out, because they are in no platform directory (${directories}): ${paths}`];
    }

    function evidenceSection({ images, unattributed, platforms }: ProofEvidence): string[] {
      return [
        '## Evidence',
        '',
        `Per-issue scenario images (${images.length}):`,
        '',
        ...imageLines(images, platforms),
        ...partialCoverageLines(platforms),
        ...leftOutLines(unattributed),
        ...outsideLines(platforms),
        '',
      ];
    }
    ```
- Run `bunx vitest run adws/proof`. Everything is green, including step 1's `cli` and `web` pins, unchanged.

### 6. Step definitions for the `@adw-1046` scenarios
- The scenario writer writes `features/per-issue/feature-1046.feature` alongside this plan, and the alignment phase reconciles the two. If tagged scenarios exist, they are the build's RED tests: write one scenario's step definitions, see it fail, make it pass, then move on. Register no pattern twice, and reuse every phrase that already has a definition. New phrases go in `features/per-issue/step_definitions/feature-1046-*.ts`.
- Drive the public interfaces only:
  - `platformOfImage`.
  - `assembleScenarioProof`, with inputs from `readJUnitReport`, `indexFeatureScenarios(readFeatureFiles(...))` and `harvestProofArtifacts`.
  - For workflow-level scenarios, `runScenarioProof` or `executeScenarioTestPhase` with the stand-in runner.

  Expected values come from the scenario text, never from calling `platformOfImage` or the renderer.
- Reusable phrases include:
  - `a scenario run for issue {int} in a {string} repository`. Its `assertRepositoryType` already accepts `mobile:kotlincm`.
  - `the scenario run's worktree holds the feature file {string}:`
  - `the proof assembler assembles the proof of the scenario run`
  - `the proof assembler selects exactly these images:`
  - `the scenario proof states {string}` and `the scenario proof does not state {string}`. Both read `s.assembled.document`, else the written proof.
- **Layout trap.** feature-994's assembler steps write each tag's images to `artifacts/<tag>/…`, which is the `web` (ADW Playwright) layout. A descriptor run, which is what `mobile:kotlincm` is, has the artifacts directory itself as its `ADW_PROOF_DIR`. A `mobile:kotlincm` stand-in must therefore write `artifacts/android/…` and `artifacts/ios/…`, or every image reads as unattributed. Give the 1046 steps their own writer for that layout, or branch on `runsOnAdwPlaywright(type)` (`feature-994-names.ts`), never on the type name. Do not change the layout the `web` scenarios of feature-994 rely on. The workflow-level harness (`executeScenarioTestPhase`) already gets the right layout from `runScenarioProof`.
- The stand-in report names the cases as a descriptor runner does: the bare scenario name, as feature-994's `nameOf` already does for a non-Playwright type. It gives the two platform runs of a scenario the identical name. Attachment lines are relative to the report's directory.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1046"`. Every scenario passes and none is undefined.

### 7. README
- In `README.md`'s `adws/proof/` tree, add `│   ├── imagePlatform.ts        # Reads a per-issue image's platform from its first directory (android/, ios/) and each scenario's platform coverage` between `featureScenarioIndex.ts` and `index.ts`.
- Describe nothing else. Device booting and the `adw_init` descriptor belong to other slices.

### 8. Run the validation commands
- Run every command under `## Validation Commands` and fix anything that fails, with zero regressions.

## Testing Strategy
### Unit Tests
Vitest, co-located in `adws/proof/__tests__/`, driving the public interfaces (`platformOfImage`, `scenarioPlatformCoverage`, `assembleScenarioProof`), with the existing helpers as prior art (PRD Testing Decisions 3):

- `imagePlatform.test.ts`:
  - **Attribution:** `android/…`, `ios/…` and nested paths are attributed; root-level, `linux/…`, wrong-case, prefix-only, dotted-file and non-first-segment paths are unattributed.
  - **The given platforms decide:** a single-platform list or an empty list attributes nothing else.
  - **Coverage:** with both, one and no platform; one entry per scenario; profile order for `present` and `missing`; order of first image for the entries.
- `proofAssembler.images.test.ts`:
  - **Selection:** both platform runs of one title are selected, each with its platform; images in no platform directory are never selected; a failed scenario's images keep their platform; a profile's missing platform directory is left out.
  - **`web`:** images never get a `platform` key, and the existing first test is now `toStrictEqual`.
- `proofAssembler.test.ts`: the screen line for a profile with platforms (not the page line, and no blocker failure). The `web` page line test now also asserts the absence of the screen line.
- `proofAssembler.platforms.test.ts`:
  - **The coverage line:** android only, ios only, both platforms, several images on one platform, a scenario without an image, and a single-platform profile.
  - **The left-out-images line**, and the exact Evidence section of a profile with platforms.
  - **The screen line:** with "no per-issue scenarios", in a notice proof, and when every image is unattributed.
  - **No blocker** on a missing platform.
  - **Pins:** the exact-text documents of a `web` proof (with an image and a left-out case, and without an image) and a `cli` proof, written in step 1 and green before any production change.

### Edge Cases
- `android/login.png` is android and `ios/a/b.png` is ios. The following are unattributed: `login.png`, `linux/x.png`, `Android/x.png`, `IOS/x.png`, `androidx/x.png`, `android.png` and `screens/android/x.png`.
- A profile with one platform: an `ios/` image is unattributed, and no scenario can be partial, so no coverage line appears.
- An empty `platforms` list (`cli`, `web`): attribution never runs. A `web` image under `android/` is selected unchanged and has no `platform` key.
- The two platform runs of a scenario report the identical title. Both images are selected and no coverage line appears.
- Both platform runs attach the same file, for example a hook that wrote `android/x.png` twice. It is deduplicated by path to one image, so a coverage line names the missing platform.
- A scenario with several android images and no ios image gets exactly one line.
- A scenario's iOS image lies in no platform directory: its coverage line says ios is missing, and the left-out line names the stray path. The reviewer sees both facts.
- An ios image first in the report: `present` and `missing` are still in profile order (`android`, then `ios`).
- A per-issue scenario without an image, beside others with images: no line for it, and no screen line.
- Every image of the issue is unattributed: the screen line, the left-out line, and an empty `perIssueImages`.
- A notice proof (no step definitions), a per-issue tag that was not run, or a per-issue run without a report, for a profile with platforms: the screen line, and never the page line.
- A case whose name matches no scenario attaches an image in `android/`: it is listed in the existing name line only, never in the platform line.
- Images of regression cases in `android/` or `ios/`, which share the descriptor runner's artifacts directory, are never selected or listed.
- A failed per-issue scenario's images are selected with their platform.
- A missing platform never sets `hasBlockerFailures`.
- `cli` and `web` documents are byte-identical, and the `web` image objects have no `platform` key.

## Acceptance Criteria
- `platformOfImage('android/login.png', [android, ios])` is `android` and `platformOfImage('ios/a/b.png', …)` is `ios`. `login.png` and `linux/x.png` are unattributed (`null`). The function is pure and lives in `adws/proof/imagePlatform.ts`.
- Two per-issue cases with the identical scenario title, one attaching `android/…` and one `ios/…`, both attribute to the scenario. Both images are in `perIssueImages`, each with its `platform`.
- A per-issue scenario with images for android only produces `` On some platforms only: `<scenario>` (present: android; missing: ios) ``. A scenario with images on both platforms, or with none, produces no such line.
- A proof of a profile with platforms with no selected image carries `no scenario opened a screen` (exported as `NO_SCENARIO_OPENED_A_SCREEN`) and not `no scenario opened a page`. A `web` proof keeps `no scenario opened a page`.
- Images of the issue's scenarios outside every platform directory are listed in `Left out, because they are in no platform directory (…)` by their harvest-root path. They are not in `perIssueImages`, so they reach neither the reviewer's image list nor the review upload nor the PR comment.
- `cli` and `web` proofs are byte-identical to before, which the exact-text pins written before the change prove. `web` images carry no `platform` key.
- Nothing mechanical blocks on a missing platform: `hasBlockerFailures` depends on the tag outcomes alone.
- Title attribution of JUnit cases is unchanged, and all existing `adws/proof` tests pass.
- Every validation command passes, and the `@adw-1046` scenarios pass with none undefined.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/proof`: the module's own tests, including the new attribution, selection, proof-line and byte-identity tests.
- `bunx vitest run adws/phases/__tests__/scenarioProofRun.test.ts adws/phases/__tests__/scenarioProofRun.evidence.test.ts adws/phases/__tests__/reviewPromptContext.test.ts adws/phases/__tests__/reviewPhaseEvidence.test.ts adws/phases/__tests__/reviewPhaseScreenshots.test.ts adws/__tests__/reviewPrompt.test.ts`: the closest consumers of the proof and of `perIssueImages`, unchanged.
- `bun run lint`: linter.
- `bunx tsc --noEmit`: root type check of every `**/*.ts`, including tests, `features/` and every hand-built `PerIssueImage` and `ScenarioProofResult`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type check.
- `bun run build`: build.
- `bun run test:unit`: the full Vitest suite, zero regressions.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1046"`: this issue's scenarios, none undefined.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-994"`: the `web` and `cli` proof scenarios, unchanged.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1043"`: the `mobile:kotlincm` scenario-test-phase scenarios still pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the regression suite, zero regressions.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - `imagePlatform.ts`, `proofAssembler.ts` and `proofDocument.ts` stay pure.
  - Use guard clauses and named per-item functions, with at most two levels of nesting.
  - Keep `readonly` inputs and outputs, and use `Omit` for the pre-platform evidence.
  - No decorators, and every file under 300 lines.
  - Comment only invariants and non-obvious reasons: the harvest root, why a stray image is never evidence, why a scenario without an image is not listed. Cite no issue numbers.
- No new library is needed. If one ever were, `.adw/commands.md` names `bun add <package>`.
- **Beyond the issue's Touched Files:**
  - `adws/proof/__tests__/proofAssembler.platforms.test.ts` is new, because `proofAssembler.test.ts` is at 278 lines. It cannot overlap another slice: no sibling slice (#1044, #1045, #1047 to #1050) touches `adws/proof/`.
  - The `README.md` tree line.
  - The `@adw-1046` step definitions under `features/per-issue/step_definitions/`.
  - `adws/proof/index.ts` stays untouched, because nothing imports the barrel.
- **Follow-up, not in this slice: `review.md` Step 6.**
  - Step 6 quotes `no scenario opened a page` only, and `reviewPrompt.test.ts` pins exactly the two fixed lines. Neither the issue's Touched Files nor the PRD's "Prompts" section changes `review.md` for the screen line. Changing it here would also widen the slice beyond the files the cron router uses to serialize overlapping issues.
  - The merged mobile guidance section already makes a one-platform scenario a blocker, and it reads the platform from `android/` and `ios/` in the image paths.
  - For user story 30 to be explicit, a follow-up should do three things. Make Step 6 also quote `no scenario opened a screen`, with the same per-issue condition as the page line. Optionally name the `On some platforms only` line in the mobile section. Add `NO_SCENARIO_OPENED_A_SCREEN` to the `it.each` of `reviewPrompt.test.ts`. `review.md` is not a `hashInputs` file, so the change bumps no framework hash.
- **Harvest-root coupling.** Attribution reads the first segment under the harvest root. That is the platform directory only because the descriptor runner sets `proofDirPerTag: false`, which makes `ADW_PROOF_DIR` the artifacts directory. A future profile with platforms on an ADW-owned per-tag runner would see `<tag>/android/…`, and would have to attribute relative to the tag directory.
- **Title contract (the repository's to honour, documented by #1044's descriptor).**
  - Both platform runs must report the identical case name, either the full ` › ` title or the bare scenario name, which is matched against the last segment.
  - A reporter that de-duplicates a repeated name, for example by appending a counter, breaks the match. The images then land in the "no scenario has their name" line instead of the evidence.
  - Coverage groups by the reported name. Two per-issue scenarios of different features that share a bare name would be grouped together, the existing ambiguity of bare-name reports.
- **Comments.**
  - The PR comment's per-scenario `<details>` group shows both platforms' images under the scenario. The file names may be equal, but the URLs differ because the R2 key carries `android/` or `ios/`.
  - Labelling the platform in the comments is a possible follow-up, and `PerIssueImage.platform` is there for it.
- **Interim.** Until #1047 boots devices and #1044 writes the descriptor, no real run produces `android/` and `ios/` images. The behaviour is proven by the unit tests and the `@adw-1046` scenarios.
- **Living docs.** `/document` updates `app_docs/feature-9gjajh-proof-and-scenario-proof.md` with the screen line, platform attribution, the coverage and left-out lines, and `imagePlatform.ts`. `adws/proof/**` is already in its `Owns:` globs, so `.adw/conditional_docs.md` needs no new entry. ADR-0064's `### Confirmation` stays "Not implemented", because the device lifecycle does not exist yet. Do not edit it here.
- Nothing here is live on the pipeline host until a release to the production branch and a host restart (ADR-0064).
