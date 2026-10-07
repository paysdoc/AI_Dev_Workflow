# Feature: The proof assembler selects the per-issue scenario images for the reviewer, the issue comment and the PR

## Metadata
issueNumber: `994`
adwId: `eflw7o-feat-per-issue-scena`
issueJson: `{"number":994,"title":"feat: per-issue scenario images are the visual evidence; the proof assembler selects them for the reviewer, the issue comment and the PR","body":"Source: `specs/prd/review-proof-redesign.md` and the ADR named below, in `specs/adr/`. The PRD section **Implementation Decisions** describes the module; the ADR holds the decision and its reasons. Read both before planning; they are the specification. Do not change the decisions.\n\n## Decision record\n\nADR-0063; ADR-0058 for the fixed tags. PRD module: **Proof assembler**, the image-upload wiring under **Removals and wiring**.\n\n## What to build\n\n- A **proof assembler** (pure): takes the JUnit report, the feature files, the artifacts directory and the type mapping; returns the proof document and the list of per-issue image paths. Tags come from the feature file (JUnit test-case names carry none); image paths from the `[[ATTACHMENT|...]]` lines. Only `@adw-{issueNumber}` scenario images are selected; `@regression` images are discarded. Replaces the current `scenario_proof.md` writer and the configurable-tag outcome logic. Tags are fixed: `@regression` and `@adw-{issueNumber}`, both blocking on failure.\n- In a `web` repository with no selected image, the proof states \"no scenario opened a page\".\n- Zero `@adw-{issueNumber}` scenarios is never a gate failure. The proof states \"no per-issue scenarios\"; the reviewer decides whether the issue needed them (decision of 2026-10-04; this is what keeps promotion issues and chores, which have none, passing — see ADR-0049).\n- The review phase'\''s image upload (`uploadReviewedProofScreenshots`) and the PR proof comment use the assembler'\''s selected list instead of everything in the artifacts directory. In a `cli` repository nothing is uploaded.\n- The reviewer receives the selected image paths with the proof (the reviewer prompt change is in the reviewer issue; this issue delivers the data).\n\n## Acceptance criteria\n\n- [ ] Given a JUnit report with attachments and the feature files, the assembler returns exactly the per-issue images, with regression images and other files excluded.\n- [ ] The proof carries the \"no scenario opened a page\" line when a web issue produced no image, and the \"no per-issue scenarios\" line when the tag matched nothing; neither fails the run.\n- [ ] The issue comment of each review attempt and the PR comment show exactly the selected images.\n- [ ] Unit tests: tag and path extraction, exclusion, both lines, Scenario Outline rows (prior art: `scenarioProof` and `proofArtifactHarvester` tests).\n- [ ] The `### Confirmation` section of ADR-0063 names the implemented check.\n\n## Blocked by\n\n#992\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-03T23:13:17Z","comments":[],"actionableComment":null}`

## Feature Description

ADR-0063 makes every `@adw-{issueNumber}` scenario's end-state image in a `web` repository the visual evidence of a change: exactly those images go to the reviewer, into the issue comment of each review attempt, and onto the pull request; regression images and anything else in the output directory are never published. ADR-0058 fixes the scenario tags in framework code: `@regression` and `@adw-{issueNumber}`, both blocking.

This issue builds the PRD's **Proof assembler**, a pure module that takes the JUnit report of each tag run, the feature files, the artifacts directory (as the list of images it holds) and the application profile, and returns the proof document (`scenario_proof.md`), the tag outcomes and the list of per-issue images. It replaces the current `scenario_proof.md` writer (`buildProofMarkdown`) and the configurable-tag outcome logic (`reviewProofConfig.tags` iteration and `deriveTagOutcome`) in `adws/phases/scenarioProof.ts`.

- **Tags come from the feature files.** Playwright's JUnit test-case names carry no tags, so the assembler parses every `.feature` file with `@cucumber/gherkin`, works out each scenario's effective tags (feature, rule, scenario, and for an outline row its Examples table), and computes the name the ADW Playwright project's JUnit report gives that scenario or row. A test case is attributed to the scenario whose name it carries.
- **Image paths come from `[[ATTACHMENT|...]]` lines.** The JUnit parser learns to read them from `<system-out>`; each path is relative to the report's directory.
- **Only per-issue images are selected**, and only where the profile expects them (`EvidenceKind.PerIssueImages`, i.e. `web`). In a `cli` repository the list is always empty, so nothing is uploaded.
- **Two fixed lines.** In a `web` repository with no selected image the proof says `no scenario opened a page`. When no scenario in the feature files carries `@adw-{issueNumber}`, the per-issue tag is not run and the proof says `no per-issue scenarios`; that is never a gate failure (ADR-0049's promotion issues and chores keep passing).
- **Wiring.** `uploadReviewedProofScreenshots` (review phase, issue comment of each attempt) and `publishPrProof` (PR comment) upload the assembler's list instead of harvesting the whole artifacts directory. The reviewer receives the selected absolute image paths in the proof document's `## Evidence` section, and `ScenarioProofResult.perIssueImages` carries them for the reviewer issue (#995) to pass on.

## User Story
As an ADW operator
I want the reviewer, the review comment of every attempt and the pull request comment to show exactly the end-state images of this issue's own scenarios
So that the change is judged, and I can see it, with the visual evidence in front of us, and regression images or runner noise never pass for evidence

## Problem Statement

Checked at `3b8e2ce8` (`dev` after #992):

- `uploadReviewedProofScreenshots` in `adws/phases/reviewPhase.ts` and `publishPrProof` in `adws/proof/prProofPublisher.ts` both call `uploadProofArtifacts`, which runs `harvestProofArtifacts(artifactsDir)` and uploads every image under the artifacts directory. In a `web` repository that directory holds `regression/` and `adw-{N}/` per-tag output, so regression screenshots are published as evidence for the issue. ADR-0063's Confirmation names exactly this.
- The reviewer receives only the path of `scenario_proof.md`, which names no image.
- `parseJUnitXml` (`adws/core/testReportParser.ts`) drops `<system-out>`, so Playwright's `[[ATTACHMENT|path]]` link from a test case to its image is never read.
- `runScenarioProof` iterates `reviewProofConfig.tags`, a configuration ADR-0058 removes. The per-issue tag's "no scenarios" case is inferred from the runner: `optional` plus a zero-case report, or `0 scenarios` on stdout when no report exists. Playwright says `No tests found` and exits 1, so a `web` issue with no per-issue scenarios and no report would fail the gate, which the 2026-10-04 decision forbids.
- Nothing ties an image to the tags of the scenario that produced it, because JUnit test-case names carry no tags.

## Solution Statement

Four small modules in `adws/proof/`, three of them pure, plus wiring:

1. **`adws/core/testReportParser.ts`**: `TestCaseResult.attachments` holds the raw paths of the case's `[[ATTACHMENT|...]]` lines in `<system-out>`.
2. **`adws/proof/featureFileReader.ts`** (I/O, like the harvester): reads every `.feature` file under a directory, skipping `node_modules` and dot-directories (`.features-gen`).
3. **`adws/proof/featureScenarioIndex.ts`** (pure): parses the files with `@cucumber/gherkin` (prior art: `adws/promotion/scenarioParser.ts`). For each scenario, and for each row of a Scenario Outline, it records the effective tags and the test-case name ADW's Playwright project gives it. It answers two questions: does any scenario carry a tag (`hasScenarioTagged`), and which scenarios a JUnit test-case name belongs to (`scenariosForTestCase`).
4. **`adws/proof/proofAssembler.ts`** (pure): the fixed tags, whether a tag runs, the tag outcomes, and the image selection. `assembleScenarioProof` returns `{ tagResults, hasBlockerFailures, perIssueImages, document }`.
5. **`adws/proof/proofDocument.ts`** (pure): renders `scenario_proof.md`, including the two fixed lines, exported as `NO_PER_ISSUE_SCENARIOS` and `NO_SCENARIO_OPENED_A_PAGE` for the reviewer issue to quote.
6. **`adws/phases/scenarioProof.ts`** becomes the I/O shell around the assembler. It indexes the feature files, runs `@regression`, runs `@adw-{N}` only when a scenario carries it, reads the reports, harvests the artifacts directory, assembles, writes `scenario_proof.md`, and returns `ScenarioProofResult` with the new `perIssueImages`.
7. **Upload wiring**: `uploadProofArtifacts` uploads a given list of images and no longer reads a directory. The review phase and `publishPrProof` pass `scenarioProof.perIssueImages`. `publishPrProof` treats an uploader installed with `setProofUploaderForTesting` as configured, as the review phase's upload already does, so the scenarios' recording screenshot store also reaches the PR comment.

### Decisions this plan makes inside the ADRs (none changes them)

- **Fixed tags**: `fixedScenarioTags(issueNumber)` returns `@regression` (role `Regression`) then `@adw-{issueNumber}` (role `PerIssue`), both `severity: 'blocker'`, in today's default order. `TagProofResult` keeps its shape (`tag` holds the pattern, `@adw-{issueNumber}` or `@regression`; `optional` is `true` only for the per-issue tag). Consumers such as the fix loop, the fix phase, the pre-existing-regression gate and both comment formatters need no change.
- **"No per-issue scenarios" is decided from the feature files, not from the runner.** When no scenario in the feature files carries `@adw-{N}`, the per-issue tag is not run. Its result is `{ passed: true, skipped: true, exitCode: null, output: '' }` and the proof says `no per-issue scenarios`. This saves a Playwright start-up and removes the `No tests found`/exit-1 failure. When the feature files hold per-issue scenarios but the run reports zero test cases, the tag **fails** with a warning: the scenarios exist and did not run (ADR-0058: "No silent green").
- **Regression outcome is unchanged**: report with cases → `failed === 0` decides; report with zero cases → failed (required tag, as today); no report → exit code. The clean-report/non-zero-exit warning is kept for both tags.
- **Images are taken from the per-issue run's report only**, and only for test cases whose matched scenarios **all** carry `@adw-{N}` in the feature files. A scenario that carries both tags is run by both runs; its image is taken once, from the per-issue run. Regression-run images are never selected. A case whose name matches no scenario is left out and named in the proof, so evidence never disappears silently.
- **"The artifacts directory" enters the pure assembler as the list of images it holds** (`harvestProofArtifacts(artifactsDir)`). An attachment is selected only when its path, resolved against the report's directory, is one of those images. That one check excludes non-image attachments (`trace.zip`, `video.webm`, `error-context.md`), files outside the artifacts directory and missing files, and supplies the `relPath` used for the R2 key.
- **Test-case names follow ADW's pinned Playwright project** (`@playwright/test` 1.63.0, `playwright-bdd` 9.2.1, `templates/playwright/package.json.template`). Both were verified in `node_modules` of the #992 real-application run. Playwright's JUnit reporter names a case `titlePath().slice(3).join(' › ')`. playwright-bdd 9.2.1 nests describes `Feature › [Rule ›] Scenario`, and gives an outline `Feature › [Rule ›] Outline › <example title>`. The example title comes from the first of these that applies: a `# title-format:` comment directly above the Examples (or above its first tag); the Examples name when it contains a `<column>` of the table; the outline name when it contains a `<column>`; otherwise `Example #<n>` in English, or `<Examples keyword>: #<n>` in other languages. `<n>` counts rows across all of the outline's Examples tables in document order. A case name without ` › ` (a runner that reports the scenario title alone) is matched against the last segment only.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview.
- `.adw/coding_guidelines.md` — pure functions, guard clauses, max nesting ~2, files under 300 lines, immutability, comment discipline (no issue numbers in comments, ADR-0054).
- `specs/prd/review-proof-redesign.md` — **Proof assembler** and **Removals and wiring** sections, Testing Decisions (assembler unit tests).
- `specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md` — the decision; its `### Confirmation` section must be rewritten to name the implemented check.
- `specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md` — fixed tags, both blocking.
- `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md` — the profile mapping; its Confirmation lists "The proof assembler's evidence selection" as still open.
- `specs/adr/0049-promotion-sweep-files-human-gated-issue.md` — promotion issues have no `@adw-{N}` scenarios and must keep passing.
- `adws/phases/scenarioProof.ts` — the current writer and tag-outcome logic; becomes the I/O shell around the assembler.
- `adws/phases/scenarioTestPhase.ts` — calls `runScenarioProof`; passes `reviewProofConfig` today; must pass the profile and the feature directory.
- `adws/phases/reviewPhase.ts` — `uploadReviewedProofScreenshots` uploads the whole artifacts directory today.
- `adws/phases/proofPublishPhase.ts` — passes `artifactsDir` to `publishPrProof`.
- `adws/phases/scenarioTestFixLoop.ts`, `adws/phases/preExistingRegressionGate.ts` — consume `tagResults`; each holds its own `'@regression'` literal, which moves to the fixed-tag constant.
- `adws/phases/scenarioFixPhase.ts` — consumes failed `tagResults`; unchanged, check behaviour with a not-run per-issue tag (`skipped`).
- `adws/phases/index.ts` — barrel re-exporting `runScenarioProof`, `TagProofResult`, `ScenarioProofResult`.
- `adws/proof/types.ts` — `ProofArtifact`, `UploadedArtifact`, `UploadProofDeps`, `PublishDeps`; imports the result types from `phases/` today (the dependency is inverted by this plan).
- `adws/proof/proofUploader.ts` — harvests and uploads; becomes "uploads the given images".
- `adws/proof/prProofPublisher.ts` — `publishPrProof` and the pure `formatPrProofComment` (per-scenario `<details>` groups).
- `adws/proof/proofArtifactHarvester.ts` — lists the images of a directory; becomes the shell's source of the assembler's artifact list.
- `adws/proof/index.ts` — module barrel.
- `adws/core/testReportParser.ts` — `parseJUnitXml`/`readJUnitReport`; gains attachments.
- `adws/core/scenarioRunner.ts` — `ScenarioRunner`; gains `featureDirectory`.
- `adws/core/applicationType.ts` — `ApplicationProfile`, `EvidenceKind.PerIssueImages`; consumers read the profile, never the type.
- `adws/core/adwPlaywrightProject.ts` — `ADW_PLAYWRIGHT_PROJECT_DIR` (`features`), `ADW_PLAYWRIGHT_RUN_BY_TAG`.
- `templates/playwright/playwright.config.ts.template`, `templates/playwright/package.json.template` — `features: '**/*.feature'` relative to `features/`, JUnit to `ADW_JUNIT_REPORT_PATH`, `outputDir` `ADW_PROOF_DIR`, `screenshot: 'on'`; pinned versions the name rules depend on.
- `adws/promotion/scenarioParser.ts` — prior art for `@cucumber/gherkin` (`Parser`, `AstBuilder`, `GherkinClassicTokenMatcher`, `IdGenerator`).
- `adws/agents/bddScenarioRunner.ts` — `runScenariosByTag` and `BddScenarioResult`.
- `adws/agents/reviewAgent.ts` — the reviewer receives the proof path as `$3`; unchanged here.
- `adws/forge/workflowCommentsIssue.ts`, `adws/forge/proofCommentFormatter.ts` — render `ctx.screenshotUrls` in the review comments; only the `screenshotUrls` field comment changes.
- `adws/phases/applicationTypeGate.ts` — `requireApplicationProfile`.
- Tests that are prior art or must change: `adws/phases/__tests__/scenarioProofRun.test.ts`, `adws/proof/__tests__/proofArtifactHarvester.test.ts`, `adws/proof/__tests__/proofUploader.test.ts`, `adws/proof/__tests__/prProofPublisher.test.ts`, `adws/phases/__tests__/reviewPhaseScreenshots.test.ts`, `adws/core/__tests__/testReportParser.test.ts`, `adws/core/__tests__/scenarioRunner.test.ts`, `adws/core/__tests__/applicationType.test.ts` (only `core/projectConfig.ts` and `phases/applicationTypeGate.ts` may name the identifier `applicationType`), `adws/phases/__tests__/scenarioTestPhase.runner.test.ts`, `adws/phases/__tests__/scenarioTestPhase.helpers.ts`, `adws/phases/__tests__/preExistingRegressionGate.test.ts`, `adws/phases/__tests__/scenarioTestFixLoop.test.ts`, `adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts`, `adws/forge/__tests__/workflowCommentsIssue.test.ts`.
- Regression suite pieces affected by fixed tags and the new shapes (the root `tsconfig.json` type-checks `features/**`):
  - `features/regression/surfaces/row-21-adwTest-scenarioTestPhase-happy.feature` and `features/regression/surfaces/row-22-adwTest-scenarioProof-happy.feature` assert the configurable `@review-proof` tag of the `cli-tool` fixture.
  - `features/regression/step_definitions/pythonFixtureE2ESteps.ts` calls `runScenarioProof` with `reviewProofConfig` and `publishPrProof` with `artifactsDir`.
  - `features/regression/step_definitions/feature-820.steps.ts` builds a `ScenarioProofResult` and calls `publishPrProof` with `artifactsDir`.
  - `features/regression/support/phaseConfig.ts` builds the hand-made failed proof for the fix-phase row.
  - `features/regression/step_definitions/surfaceSteps.ts` holds T-S11/T-S12, which are unchanged.
- `features/per-issue/step_definitions/feature-933-phases.ts` — hand-built `ScenarioProofResult`.
- `features/per-issue/step_definitions/feature-992-junit.ts`, `feature-992-standin-source.ts` — prior art for reading `[[ATTACHMENT|...]]` and for a stand-in runner that writes attachments.
- `features/per-issue/feature-994.feature` — this issue's scenarios (step 16).
- `features/per-issue/step_definitions/feature-937-*.ts` — prior art for the recording issue tracker, the recording screenshot store installed with `setProofUploaderForTesting`, the stand-in review agent (`test/mocks/claude-cli-stub.ts`) and running the scenario test phase, then the review phase.
- `test/fixtures/cli-tool/.adw/*`, `test/fixtures/python-app/.adw/*`, `test/fixtures/python-app/features/calculator.feature` — fixtures the regression rows run against (no `.feature` in `cli-tool`; `python-app` is `web` with `@regression` scenarios only).
- Conditional docs that apply: `app_docs/feature-9gjajh-proof-and-scenario-proof.md` (owns `adws/proof/**`, `scenarioProof.ts`, `proofPublishPhase.ts`), `app_docs/feature-9gjajh-review-and-diff-phases.md` (`reviewPhase.ts`), `app_docs/feature-9gjajh-test-report-and-verdict.md` (`testReportParser.ts`, scenario proof pass/fail resolution), `app_docs/feature-gfv9kt-application-type-mapping.md` (a consumer of the evidence profile), `app_docs/feature-2u517h-adw-playwright-project.md` (the Playwright project and run-by-tag), `app_docs/feature-9gjajh-bdd-regression-suite.md` (surface harness, T-S11/T-S12, `World.scenarioProofResult`, rows 21–22).

### New Files
- `adws/proof/featureFileReader.ts` — `readFeatureFiles(rootDir)`: every `.feature` under a directory, sorted, skipping `node_modules` and dot-directories; `[]` when the directory is absent.
- `adws/proof/featureScenarioIndex.ts` — `indexFeatureScenarios`, `hasScenarioTagged`, `scenariosForTestCase`, types `FeatureFileSource`, `IndexedScenario`, `FeatureScenarioIndex`, `EMPTY_FEATURE_SCENARIO_INDEX`.
- `adws/proof/proofAssembler.ts` — `ScenarioTagRole`, `FixedScenarioTag`, `REGRESSION_SCENARIO_TAG`, `fixedScenarioTags`, `shouldRunTag`, `TagRun`, `TagRunRecord`, `ProofAssemblyInput`, `AssembledProof`, `assembleScenarioProof`.
- `adws/proof/proofDocument.ts` — `NO_PER_ISSUE_SCENARIOS`, `NO_SCENARIO_OPENED_A_PAGE`, `renderProofDocument`.
- `adws/proof/__tests__/featureFileReader.test.ts`
- `adws/proof/__tests__/featureScenarioIndex.test.ts`
- `adws/proof/__tests__/proofAssembler.test.ts`
- `adws/proof/__tests__/prProofPublisher.publish.test.ts` — `publishPrProof` uploads exactly the proof's selected images.

## Implementation Plan
### Phase 1: Foundation
Give the JUnit parser the attachment lines. Move `TagProofResult` and `ScenarioProofResult` into `adws/proof/types.ts`, so the proof module no longer imports from `phases/`; add `PerIssueImage` and the `perIssueImages` field. Add the feature-file reader and the pure feature index that turns Gherkin into effective tags and Playwright test-case names, including Rules and Scenario Outline rows. Give `ScenarioRunner` a `featureDirectory`.

### Phase 2: Core Implementation
Write the pure proof assembler: the fixed tags, `shouldRunTag`, the tag outcomes, the per-issue image selection gated on the profile's evidence kinds, and the proof document with its two fixed lines and the `## Evidence` section. Rewrite `runScenarioProof` as the I/O shell around it, including the no-step-definitions notice. Cover all of it with unit tests that feed inputs and assert the returned outcome, image list and document.

### Phase 3: Integration
Pass the profile and feature directory from the scenario test phase. Make the uploader take the selected list. Wire the review phase (issue comment of each attempt) and `publishPrProof`/`executeProofPublishPhase` (PR comment) to `scenarioProof.perIssueImages`. Move the `'@regression'` literals to the fixed-tag constant. Update every hand-built `ScenarioProofResult`/`TestCaseResult`, the regression harness, surface rows 21–22 and the python E2E steps for the fixed tags. Implement the step definitions for the `@adw-994` scenarios. Rewrite ADR-0063's Confirmation. Run the validation commands.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. JUnit attachments (`adws/core/testReportParser.ts`)
- Add `attachments: string[]` to `TestCaseResult`: the raw paths of the case's `[[ATTACHMENT|<path>]]` lines, in report order, empty when none. They are relative to the report's directory, as Playwright writes them.
- In `buildCase`, read the `system-out` child. fast-xml-parser yields a string (CDATA merged into text), an array of strings when the element repeats, or an object with `#text`. Handle all three in a small helper and extract with `/\[\[ATTACHMENT\|([^\]]+)\]\]/g` (the regex `features/per-issue/step_definitions/feature-992-junit.ts` already uses). Keep nesting flat: one helper for the text, one for the matches.
- Extend `adws/core/__tests__/testReportParser.test.ts`: a Playwright-shaped report (`<testsuites><testsuite name="per-issue/feature-1.feature.spec.js"><testcase name="Checkout › Pay" classname="per-issue/feature-1.feature.spec.js"><system-out><![CDATA[\n[[ATTACHMENT|artifacts/adw-1/pay-chromium/test-finished-1.png]]\n\n[[ATTACHMENT|artifacts/adw-1/pay-chromium/trace.zip]]\n]]></system-out></testcase>…`). Assert both paths in order, the decoded `›` name, `attachments: []` for a case without `system-out` and for a vitest-shaped `system-out` with no attachment line, and a failed case keeping both its status and its attachments.
- Fix the hand-built `TestCaseResult`s that the type check flags, e.g. the `testCase()` helper in `adws/phases/__tests__/preExistingRegressionGate.test.ts`, by adding `attachments: []`.

### 2. Result types move to the proof module (`adws/proof/types.ts`)
- Move `TagProofResult` and `ScenarioProofResult` from `adws/phases/scenarioProof.ts` into `adws/proof/types.ts`, keeping every existing field and its comment. Update the `tag` comment: it is the fixed tag's pattern, e.g. `@adw-{issueNumber}`. `adws/proof/types.ts` stops importing from `../phases/scenarioProof`.
- Add `export interface PerIssueImage extends ProofArtifact { readonly scenario: string }`, where `scenario` is the JUnit test-case name of the scenario that took the image.
- Add `perIssueImages: readonly PerIssueImage[]` to `ScenarioProofResult`. Its comment: the images the reviewer, the issue comment and the PR comment show; per-issue scenario images only; always empty where the application profile expects no images.
- In `adws/phases/scenarioProof.ts`, `export type { TagProofResult, ScenarioProofResult } from '../proof/types';` so `phases/index.ts`, `forge/*`, the fix loop, the gates and the step definitions keep importing from where they do.
- `UploadProofDeps`: replace `artifactsDir` with `readonly images: readonly PerIssueImage[]` (the images to upload, in order).
- `PublishDeps`: remove `artifactsDir`; the images come from `scenarioProof.perIssueImages`.
- `UploadedArtifact.scenario` comment: the test-case name of the scenario the image shows.
- Export `PerIssueImage` from `adws/proof/index.ts`.

### 3. Feature-file reader (`adws/proof/featureFileReader.ts`)
- `export function readFeatureFiles(rootDir: string): FeatureFileSource[]`: an iterative walk like `harvestProofArtifacts`, collecting `{ path, content }` for each file ending in `.feature`. It skips directories named `node_modules` and any directory whose name starts with `.` (`.features-gen`, `.git`), sorts by path, and returns `[]` when `rootDir` does not exist. An unreadable entry is skipped (`try`/`continue`, as the harvester does).
- `adws/proof/__tests__/featureFileReader.test.ts`: nested files found and sorted; `.ts` and `.feature.spec.js` ignored; `node_modules/x.feature` and `.features-gen/x.feature` ignored; missing directory gives `[]`.

### 4. Feature scenario index (`adws/proof/featureScenarioIndex.ts`, pure)
- Types:
  - `FeatureFileSource { readonly path: string; readonly content: string }`.
  - `IndexedScenario { readonly featurePath: string; readonly title: string; readonly name: string; readonly tags: readonly string[] }`. `title` is the test-case name the ADW Playwright project's JUnit report gives the scenario, or for an outline the row; `name` is its last segment; `tags` are the effective tags.
  - `FeatureScenarioIndex { readonly scenarios: readonly IndexedScenario[]; readonly unparsed: readonly FeatureFileSource[] }`.
  - `EMPTY_FEATURE_SCENARIO_INDEX`.
- `indexFeatureScenarios(files)`: parse each file with a parser built as in `adws/promotion/scenarioParser.ts`. A file that throws goes into `unparsed`. Walk `feature.children`:
  - A `rule` child contributes its name as a title segment and its tags.
  - A `background` contributes nothing.
  - A plain `scenario` gives one entry: title `[feature.name, rule?.name, scenario.name].join(' › ')` (rule omitted when absent), tags `feature ∪ rule ∪ scenario`, deduplicated.
  - A Scenario Outline (a scenario with `examples`) gives one entry per row of every Examples table: title `[feature, rule?, outline.name, exampleTitle].join(' › ')`, tags `feature ∪ rule ∪ outline ∪ examples`. An outline with no rows gives nothing, as playwright-bdd renders no test for it.
- Example titles replicate playwright-bdd 9.2.1 (`dist/generate/examplesTitleBuilder.js`). Keep a per-outline counter `n` (1-based, across all of the outline's Examples tables in document order). The template is the first of:
  - the text after `# title-format:` of a document comment on the line directly above the Examples keyword, or directly above its first tag (`gherkinDocument.comments`, `location.line`);
  - the Examples name when it contains a `<column>` of that table's header;
  - the outline name when it contains a `<column>` of the header;
  - `Example #<_index_>` when the document language is English (`feature.language === 'en'`), else `` `${examples.keyword}: #<_index_>` ``.
  
  Fill `<key>` from `{ _index_: n, ...header→cell }` and leave an unknown key as written (`GherkinTemplate.fill`). Put the rule chain in named helpers (`exampleTitleTemplate`, `fillTemplate`) and cite playwright-bdd 9.2.1 in one comment, because the names must match what the pinned project emits.
- `hasScenarioTagged(index, tag)`: true when an indexed scenario's tags include `tag` exactly (so `@adw-99` never matches `@adw-992`), or when an unparsed file's raw text holds the tag as a whole token (`(^|\s)<escaped tag>(?=\s|$)`, multiline). An unreadable file that may hold per-issue scenarios lets the run go ahead, and the runner reports its parse error.
- `scenariosForTestCase(index, caseName)`: the scenarios whose `title` equals `caseName`. When none match and `caseName` contains no ` › `, return the scenarios whose `name` equals it.
- Keep the file under 300 lines.

### 5. Proof document (`adws/proof/proofDocument.ts`, pure)
- `export const NO_PER_ISSUE_SCENARIOS = 'no per-issue scenarios';` and `export const NO_SCENARIO_OPENED_A_PAGE = 'no scenario opened a page';`.
- `renderProofDocument({ generatedAt, notice?, tagResults, evidence })`, where `evidence` is `{ images: readonly PerIssueImage[]; unattributed: readonly string[] } | null` and `null` means the profile expects no images. The layout keeps today's shape:

~~~markdown
# Scenario Proof

Generated at: <generatedAt>

⚠️ <notice>                                   ← only when a notice is given

## <resolvedTag> Scenarios (severity: blocker)

**Status:** ✅ PASSED | ❌ FAILED | ⏭️ no per-issue scenarios
**Exit Code:** <exitCode>                     ← omitted for a tag that was not run
**Warning:** <warning>                        ← when present
**Report:** <p> passed, <f> failed of <t>     ← when counts exist

### Output                                    ← omitted for a tag that was not run

```
<output or "(no output)">
```

## Evidence                                   ← only when evidence is not null

Per-issue scenario images (<n>):

- `<scenario>`: <absPath>

no scenario opened a page                     ← instead of the list when n is 0

Left out, because no scenario in the feature files has their name: `<case>`, `<case>`   ← only when unattributed is non-empty
~~~

- The not-run per-issue tag's status reads exactly `⏭️ no per-issue scenarios`. Both fixed lines are the exported constants, never retyped strings.

### 6. Proof assembler (`adws/proof/proofAssembler.ts`, pure)
- Fixed tags:
  - `export enum ScenarioTagRole { Regression = 'regression', PerIssue = 'per_issue' }`.
  - `export interface FixedScenarioTag { readonly role: ScenarioTagRole; readonly pattern: string; readonly tag: string }`.
  - `export const REGRESSION_SCENARIO_TAG = '@regression';`.
  - `export function fixedScenarioTags(issueNumber: number): readonly FixedScenarioTag[]` returns `[{ Regression, '@regression', '@regression' }, { PerIssue, '@adw-{issueNumber}', '@adw-<N>' }]`.
- `shouldRunTag(tag, index)`: the regression tag always runs; the per-issue tag runs only when `hasScenarioTagged(index, tag.tag)`.
- Inputs and output:
  - `TagRun { readonly exitCode: number | null; readonly stdout: string; readonly report: TestReport | null; readonly reportPath: string }`, where `reportPath` is absolute.
  - `TagRunRecord { readonly tag: FixedScenarioTag; readonly run: TagRun | null }`, where `null` means not run.
  - `ProofAssemblyInput { runs, scenarioIndex, artifacts: readonly ProofArtifact[], applicationProfile: ApplicationProfile, generatedAt: string, notice?: string }`.
  - `AssembledProof { tagResults: TagProofResult[]; hasBlockerFailures: boolean; perIssueImages: readonly PerIssueImage[]; document: string }`.
- Tag outcome, one function per case, guard clauses first:
  - not run → `{ passed: true, skipped: true, exitCode: null, output: '' }`;
  - report with cases → `passed = report.failed === 0`, counts, cases, and today's warning text when the exit code is non-zero but the report is clean;
  - report with zero cases → failed. For the per-issue tag it also gets the warning `<k> scenario(s) in the feature files carry <tag>, but the run reported none`, where `<k>` counts indexed scenarios with the tag;
  - no report → `passed = exitCode === 0`.
  
  `severity: 'blocker'` for both tags, `optional` true only for the per-issue tag. `output` is the stdout truncated at 10,000 characters (move `truncate` and `MAX_OUTPUT_LENGTH` here). `hasBlockerFailures` = some `blocker && !passed && !skipped`.
- Image selection runs only when `applicationProfile.evidenceKinds.includes(EvidenceKind.PerIssueImages)`; otherwise `perIssueImages` is `[]` and the document gets no `## Evidence` section. Never name the identifier `applicationType` (see `applicationType.test.ts`).
  - Take the per-issue record. When it was not run or has no report, there are no images.
  - Otherwise, for each case of its report, get `scenariosForTestCase(index, case.name)`:
    - when there are none and the case has an image attachment, record the case name as unattributed;
    - when any matched scenario lacks the per-issue tag, discard the case: that covers regression and other scenarios, including a runner that ignored the tag filter;
    - otherwise resolve each attachment with `path.resolve(path.dirname(run.reportPath), raw)` and keep it when it equals the `absPath` (normalised with `path.resolve`) of one of `artifacts`. The kept image is `{ ...artifact, scenario: case.name }`.
  - Deduplicate by `absPath`, keeping report order. Extract the per-case logic into a named function so the loop reads as `cases.flatMap(selectCaseImages)`.
- `assembleScenarioProof(input)` maps the runs to tag results, selects the images, renders the document with `renderProofDocument` and returns the four values.
- Export the new public names from `adws/proof/index.ts`.

### 7. The runner names its feature directory (`adws/core/scenarioRunner.ts`)
- Add `readonly featureDirectory: string` to `ScenarioRunner`: the directory, relative to the worktree, whose `.feature` files the runner reads. `descriptorRunner` uses `scenarios.scenarioDirectory`; `adwPlaywrightRunner` uses `ADW_PLAYWRIGHT_PROJECT_DIR`, so the Playwright runner still ignores the descriptors.
- `adws/core/__tests__/scenarioRunner.test.ts`: descriptor returns the configured scenario directory; Playwright returns `features` whatever the descriptors say. The existing "two configs give the same runner" test keeps passing.

### 8. `runScenarioProof` becomes the shell (`adws/phases/scenarioProof.ts`)
- Options:
  - remove `reviewProofConfig`;
  - add required `applicationProfile: ApplicationProfile` and `featureDirectory: string` (relative to `cwd`);
  - keep `scenariosMd`, `runByTagCommand`, `issueNumber`, `proofDir`, `cwd`, `stepDefDirectory`, `stepDefExtensions`, `env`, `proofDirPerTag` and their defaults.
- The proof directory and artifacts directory are reset as today.
- When there are no step definitions, call `assembleScenarioProof({ runs: [], scenarioIndex: EMPTY_FEATURE_SCENARIO_INDEX, artifacts: [], applicationProfile, generatedAt, notice: <today's warning text> })`. Write its document to `scenario_proof.md` and return `{ tagResults: [], hasBlockerFailures: false, perIssueImages: [], resultsFilePath, artifactsDir }`. A `web` repository's notice proof therefore also says `no scenario opened a page`, and the old inline writer goes away.
- Otherwise:
  - `index = indexFeatureScenarios(readFeatureFiles(path.resolve(effectiveCwd, featureDirectory)))`.
  - For each `fixedScenarioTags(issueNumber)` in order, when `shouldRunTag` is true, run as today: stale report removed, per-tag `ADW_PROOF_DIR` when `proofDirPerTag`, `env` overridden by ADW's two variables, `readJUnitReport`. Record `{ tag, run: { exitCode, stdout, report, reportPath } }`.
  - When it is false, log at `info` that no scenario carries the tag and the per-issue tag is not run, and record `{ tag, run: null }`. The rest of `scenarioProof.ts` logs through `console`/`log`; use `log` from core.
- Then call `assembleScenarioProof({ runs, scenarioIndex: index, artifacts: harvestProofArtifacts(artifactsDir), applicationProfile, generatedAt: new Date().toISOString() })`, write `document` to `scenario_proof.md`, and return `{ tagResults, hasBlockerFailures, perIssueImages, resultsFilePath, artifactsDir }`.
- Delete `deriveTagOutcome`, `buildProofMarkdown`, `isNoScenariosOutput`, `truncate` and `MAX_OUTPUT_LENGTH` from this file (truncation moved to the assembler). Keep `sanitizeTagName` and `shouldRunScenarioProof`. The file should end well under 300 lines.
- `adws/phases/__tests__/scenarioProofRun.test.ts` (integration, real subprocesses):
  - The sandbox gains `features/per-issue/feature-9921.feature` with an `@adw-9921` scenario, and `run()` passes `featureDirectory: 'features'` and `applicationProfile: APPLICATION_TYPE_PROFILES.cli`. All existing tests keep their meaning.
  - New: "does not run the per-issue tag when no scenario carries it". Use a sandbox without the feature file: no record for `adw-9921`; its result `skipped` and `passed`; `hasBlockerFailures` false while the regression command exits 0; `scenario_proof.md` contains `NO_PER_ISSUE_SCENARIOS`.
  - New: "a web run returns exactly the per-issue images". The command writes a Playwright-shaped report to `$ADW_JUNIT_REPORT_PATH` and PNGs under `$ADW_PROOF_DIR`. For `adw-9921` it writes one case named `<Feature> › <per-issue scenario>` with a PNG and a `trace.zip` attachment, and one case named after a `@regression`-only scenario with a PNG. For `regression` it writes a case with a PNG. With the `web` profile and `proofDirPerTag: true`, `perIssueImages` is exactly the per-issue PNG (absolute path, `scenario` = case name), and `scenario_proof.md` lists that absolute path.
  - New: "a cli run selects no image even when the runner attached one".
  - New: "the no-step-definitions proof of a web repository says no scenario opened a page".

### 9. Scenario test phase passes the profile and the feature directory (`adws/phases/scenarioTestPhase.ts`)
- Compute `const applicationProfile = requireApplicationProfile(config)` once. Use its `runnerMode` for `resolveScenarioRunner`, and pass `applicationProfile` and `featureDirectory: runner.featureDirectory` to `runScenarioProof`. Remove `reviewProofConfig` from the destructuring.
- Optionally add the number of per-issue images to the existing `Scenario test phase … Proof: …` state-log line.
- `adws/phases/__tests__/scenarioTestPhase.runner.test.ts`: the `cli` run gets the `cli` profile and the configured scenario directory; the `web` run gets the `web` profile and `features`. In `scenarioTestPhase.helpers.ts`, give `passingProof`/`failingProof` `perIssueImages: []`.

### 10. The uploader uploads the given images (`adws/proof/proofUploader.ts`)
- `uploadProofArtifacts(deps)` iterates `deps.images` in order: key `proof/${adwId}/${image.relPath}`, body `fs.readFileSync(image.absPath)` inside the existing `try`, content type by extension, result `{ scenario: image.scenario, url, fileName: path.basename(image.relPath) }`. It never throws, uploads one at a time, and resolves the uploader as before.
- Remove the harvest from the uploader: the `harvestOrNothing` and `leadingSegment` helpers and the `harvestProofArtifacts` import. Update the file's header comment: the shared upload half of the review phase and `publishPrProof`.
- Add `export function isProofUploadConfigured(): boolean`: true when `isR2Configured()` is true or an uploader is installed with `setProofUploaderForTesting`, which the seam's comment already says "counts as configured". `publishPrProof` uses it as its gate (step 12). Export it from `adws/proof/index.ts`.
- `adws/proof/__tests__/proofUploader.test.ts`, rewritten around a given list:
  - uploads exactly the given images, in the given order, under `proof/{adwId}/{relPath}` with the right content types and bytes;
  - returns `scenario` from the image and `fileName` from `relPath`;
  - an empty list uploads nothing;
  - an image whose upload throws, or whose file cannot be read, is left out with a `warn` and the rest upload;
  - without R2 credentials (the existing `loadWithoutR2Credentials` helper), `isProofUploadConfigured()` is `false` with no installed uploader and `true` with one;
  - the sequential-upload and configured/installed-uploader tests stay.
  
  Drop the harvesting tests: missing directory, harvest throws, non-image skipped. Harvesting is still covered by `proofArtifactHarvester.test.ts`.

### 11. Review phase uploads the selected images (`adws/phases/reviewPhase.ts`)
- `uploadReviewedProofScreenshots` reads `config.ctx.scenarioProof?.perIssueImages ?? []`, returns `[]` when there is no `repoContext` or the list is empty, and otherwise calls `uploadProofArtifacts({ images, repoInfo: config.repoContext.repoId, adwId: config.adwId })`. `ctx.screenshotUrls` is still assigned on every attempt, so a later attempt never shows an earlier run's images.
- Update the `WorkflowContext.screenshotUrls` comment in `adws/forge/workflowCommentsIssue.ts`: public R2 URLs of the per-issue images the scenario proof selected.
- `adws/phases/__tests__/reviewPhaseScreenshots.test.ts`:
  - the fixture proof carries two `perIssueImages`;
  - the upload is called with `{ images: <those two>, repoInfo, adwId }`;
  - the Review Passed and Review Failed comments carry exactly the returned URLs;
  - new: a proof with an empty selection (what a `cli` repository always has) uploads nothing and sets `[]`;
  - the "no proof", "no repo context", "replaces the earlier attempt's URLs" and "agent throws" tests stay.

### 12. PR proof comment uses the selected images (`adws/proof/prProofPublisher.ts`, `adws/phases/proofPublishPhase.ts`)
- `publishPrProof`:
  - skips with an `info` log when `scenarioProof` is absent (and, as before, when `prNumber <= 0`);
  - uploads `scenarioProof.perIssueImages` when `isProofUploadConfigured()` is true, and passes that value to `formatPrProofComment` as `r2Configured`. Today's gate is `isR2Configured()`, which reads environment constants fixed at import. In a BDD run without R2 credentials it would leave unused the recording screenshot store that the `@adw-994` steps install with `setProofUploaderForTesting`, and the PR comment would show no image. An uploader injected through `deps.uploader` without credentials is still skipped, as today. When there are no credentials and no installed uploader, the comment keeps the "R2 is not configured" note. Update the gate's code comment to match;
  - formats and posts as before.
- `formatPrProofComment`: group labels are now scenario names written by people, so HTML-escape `&`, `<` and `>` in the `<summary>` text of `formatScenarioGroup`.
- `executeProofPublishPhase`: drop the `artifactsDir` argument.
- `adws/proof/__tests__/prProofPublisher.publish.test.ts` (mock `../../core/environment` with R2 credentials and `../../core/logger`, as `proofUploader.test.ts` does; inject a recording uploader):
  - uploads exactly the proof's `perIssueImages` and posts one comment whose body embeds exactly their URLs, grouped by scenario, ending with `ADW_SIGNATURE`;
  - a proof with no selected image uploads nothing and posts the tally;
  - no proof posts nothing;
  - without R2 credentials (a `vi.doMock` of `../../core/environment`, as `proofUploader.test.ts`'s `loadWithoutR2Credentials` does), an uploader installed with `setProofUploaderForTesting` receives exactly the selected images and the comment embeds them. With no uploader installed, nothing is uploaded and the comment carries the "R2 is not configured" note.
- `adws/proof/__tests__/prProofPublisher.test.ts`: add a case for an escaped group label.

### 13. One home for the regression tag
- `adws/phases/preExistingRegressionGate.ts`: replace its local `REGRESSION_TAG` with `REGRESSION_SCENARIO_TAG` from `../proof/proofAssembler`.
- `adws/phases/scenarioTestFixLoop.ts`: replace both `'@regression'` literals with `REGRESSION_SCENARIO_TAG`. Nothing else changes: a per-issue tag that was not run is `skipped` and is neither a failure nor sent to the fix agent.

### 14. Hand-built results and configs
- Add `perIssueImages: []` to every hand-built `ScenarioProofResult` that `bunx tsc --noEmit` flags. Known ones:
  - `adws/forge/__tests__/workflowCommentsIssue.test.ts`
  - `adws/phases/__tests__/preExistingRegressionGate.test.ts`
  - `adws/phases/__tests__/reviewPhaseScreenshots.test.ts` (step 11)
  - `adws/phases/__tests__/scenarioTestFixLoop.test.ts`
  - `adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts`
  - `adws/phases/__tests__/scenarioTestPhase.helpers.ts` (step 9)
  - `features/per-issue/step_definitions/feature-933-phases.ts`
  - `features/regression/support/phaseConfig.ts`
  - `features/regression/step_definitions/feature-820.steps.ts`
- Leave `reviewProofConfig` in the hand-built `ProjectConfig`s: it is still a field of `ProjectConfig` until the reviewer issue deletes it.

### 15. Regression suite under fixed tags
- Surface rows. The `cli-tool` fixture has no `.feature` file, so the per-issue tag is not run, and the fenced scenario command makes the fixed `@regression` tag exit 127 and fail as a blocker. Update both rows' descriptions, scenario titles and the Then argument from `"@review-proof"` to `"@regression"`. The T-S12 phrase is unchanged, so `features/regression/vocabulary.md` needs no new entry.
  - `features/regression/surfaces/row-21-adwTest-scenarioTestPhase-happy.feature`: new description says the phase runs the fixture's scenario command for the fixed regression tag; no feature file carries the issue's tag, so the per-issue tag is not run; the fenced command exits 127, so the regression tag fails, which the loop acts on. New title: "…resolves with the regression tag failed, and posts no comment". New step: `And the scenario proof records a blocker failure for the tag "@regression"`.
  - `features/regression/surfaces/row-22-adwTest-scenarioProof-happy.feature`: new description says the proof runs the fixture's scenario command for the fixed regression tag (no per-issue scenario exists, so the per-issue tag is not run) and records the regression tag as a blocker failure for the fix loop. New title: "…the proof records the regression tag as a blocker failure". New step: `Then the scenario proof records a blocker failure for the tag "@regression"`.
- `features/regression/support/phaseConfig.ts`: `failedReviewProof` builds the `@regression` tag (`tag`/`resolvedTag` `@regression`) with `perIssueImages: []`, and its comment says the regression tag fails. The fix-phase row's feature text does not name the tag, so it is unchanged.
- `features/regression/step_definitions/pythonFixtureE2ESteps.ts`:
  - The `runScenarioProof` call drops `reviewProofConfig` and passes `featureDirectory: cfg.scenarios.scenarioDirectory` and the fixture's profile. Resolve it with `resolveApplicationType(cfg.applicationType)` and assert it is `known`. The fixture is `web`.
  - `publishPrProof` drops `artifactsDir`.
  - Expected result: the fixture's `calculator.feature` carries only `@regression`, so `@adw-583` is not run. `tagResults[0]` is the regression tag with 2 passed, the tally stays `**2 passed, 0 failed**`, and `harvestProofArtifacts(artifactsDir)` still finds `calculator/calc.png`. The `@python-e2e` scenario passes unchanged.
- `features/regression/step_definitions/feature-820.steps.ts`: `buildScenarioProof` takes the image list. The "one screenshot artifact" Given puts its `MyScenario/screenshot.png` in `perIssueImages` (`{ absPath, relPath: 'MyScenario/screenshot.png', scenario: 'MyScenario' }`); the other variant passes `[]`. `publishPrProof` drops `artifactsDir`. No feature file uses these steps today, but they must type-check and keep their meaning.

### 16. Step definitions for this issue's scenarios
- `features/per-issue/feature-994.feature` (`@adw-994`) holds twelve scenarios, three of them outlines:
  - three drive the pure assembler ("the proof assembler assembles the proof of the scenario run"): exact selection; tags taken per scenario from the feature file, with Feature tags included and same-named scenarios of different features told apart; and outline rows selected by their Examples tags;
  - four run the scenario test phase, then the review phase: `web`, `cli`, a re-test after a failed review, and a `web` run with no image. Two of them, the `web` and the `cli` one, then publish the proof on a pull request;
  - four run the scenario test phase alone: a blocker failure for either fixed tag in either repository type; `.adw/review_proof.md` ignored; "no per-issue scenarios"; and a per-issue run that ends without a report;
  - the last is the type check.
- Implement their step definitions under `features/per-issue/step_definitions/` against the public interfaces built here: `assembleScenarioProof` (its inputs from `readJUnitReport`, `indexFeatureScenarios(readFeatureFiles(...))` and `harvestProofArtifacts`), `runScenarioProof`, `executeScenarioTestPhase`, `executeReviewPhase` with `setProofUploaderForTesting`, `publishPrProof` or `executeProofPublishPhase`, `formatReviewProofComment`. Prior art for the recording issue tracker and screenshot store, the stand-in review agent and "scenario tests, then review": `features/per-issue/step_definitions/feature-937-*.ts`.
- Reuse the existing phrases instead of redefining them: `the ADW codebase is checked out` (G18), `the ADW TypeScript type-check passes` (T22), `the scenario proof records a blocker failure for the tag {string}` (T-S12, which matches on `resolvedTag`) and `the scenario proof records no blocker failures` (T-PY3). The last two read `World.scenarioProofResult`, so every When step that runs the scenario test phase sets it from `ctx.scenarioProof`.
- Any stand-in runner a step writes must emit the report the ADW Playwright project emits:
  - Test-case names are `<Feature> › [<Rule> ›] <Scenario>`. An outline row is `<Feature> › [<Rule> ›] <Outline> › <example title>`, with the example title from step 4. The products outline's name holds `<product>`, so its rows are `Product pages › The <product> page shows its price › The lamp page shows its price`, and so on.
  - Build the names from the feature text the step wrote, not with `featureScenarioIndex.ts`, so the scenarios do not check the index against itself. The full name matters: the two "The page shows the saved products" scenarios differ only in their Feature segment, and a bare name would match both and be discarded. `feature-992-standin-source.ts` writes bare names, so its report writer cannot be reused unchanged.
  - Names are XML-escaped (`<product>`).
  - `[[ATTACHMENT|<path relative to the report's directory>]]` lines go in `<system-out>`, and the images under `$ADW_PROOF_DIR`.
  - Each test case goes in the report of every fixed tag its scenario carries, as the runner's tag filter does.
  
  Prior art: `features/per-issue/step_definitions/feature-992-standin-source.ts`, `feature-992-junit.ts`.
- In the `cli` workflows, the scenario directory in `.adw/scenarios.md` must hold the feature files the table names (for example `features/`). It is the descriptor runner's `featureDirectory`, and the per-issue tag runs only when a scenario there carries it.
- "The review agent received, with the proof, …" reads the `scenario_proof.md` whose path the review phase gave the review agent (`$3`, the proof's `resultsFilePath`). Capture it when the review runs, because the next scenario run resets the proof directory. The image paths it received are the ones its `## Evidence` section lists.
- The review phase and `publishPrProof` each upload the selected list. In the `web` scenario that publishes on a pull request, the store therefore receives each image twice under the same key. "received exactly these images, and nothing else" compares the distinct images received. "each embedded from a URL the screenshot store returned for it" accepts any URL the store returned for that image.
- Register no new phrase in `features/regression/vocabulary.md`; per-issue steps do not need it.

### 17. Records
- `specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md`: rewrite `### Confirmation` in the style of ADR-0061's. Start with "Implemented. Checked on <date> in the working tree on top of <sha>:" and add bullets that name:
  - `adws/proof/proofAssembler.ts` (`assembleScenarioProof`, `fixedScenarioTags`, `shouldRunTag`) and `adws/proof/featureScenarioIndex.ts` (tags from the feature file, playwright-bdd 9.2.1 test-case names), plus `adws/proof/proofDocument.ts` with the two lines;
  - `TestCaseResult.attachments` in `adws/core/testReportParser.ts`;
  - `runScenarioProof` in `adws/phases/scenarioProof.ts`, which does not run the per-issue tag when no scenario carries it;
  - `uploadProofArtifacts` uploading only the given images, `uploadReviewedProofScreenshots` and `publishPrProof` passing `scenarioProof.perIssueImages`, and nothing uploaded in a `cli` repository;
  - the reviewer receiving the absolute image paths in `scenario_proof.md`'s `## Evidence` section;
  - the unit tests `adws/proof/__tests__/proofAssembler.test.ts`, `featureScenarioIndex.test.ts`, `prProofPublisher.publish.test.ts`, `proofUploader.test.ts`, `adws/phases/__tests__/scenarioProofRun.test.ts`, `reviewPhaseScreenshots.test.ts`, `adws/core/__tests__/testReportParser.test.ts`;
  - the scenarios `features/per-issue/feature-994.feature`;
  - one mechanical check, e.g. `grep -n "harvestProofArtifacts" adws/proof/proofUploader.ts adws/phases/reviewPhase.ts adws/proof/prProofPublisher.ts` returns nothing.
  
  Keep the decision text unchanged. Note what remains for the reviewer issue: the prompt opening the images.
- `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md`: in Confirmation's "Still open", replace "The proof assembler's evidence selection." with a pointer to ADR-0063's Confirmation. Change nothing else.

### 18. Run the validation commands
- Run every command in `Validation Commands` and fix any failure before finishing.

## Testing Strategy
### Unit Tests
The tests feed each module its inputs and assert the decision, list or document it returns, following the PRD's Testing Decisions. No test asserts which internal function ran. Prior art: `scenarioProofRun.test.ts` (temp sandbox, real subprocess, recorded variables) and `proofArtifactHarvester.test.ts` (temp dir, `touch`, sorted relPaths).

- **`adws/core/__tests__/testReportParser.test.ts`** — attachment extraction from Playwright-shaped CDATA `system-out`; order; none → `[]`; vitest-shaped `system-out` → `[]`; failed case keeps attachments.
- **`adws/proof/__tests__/featureFileReader.test.ts`** — recursion, sorting, `.feature` only, `node_modules` and dot-directories skipped, missing dir → `[]`.
- **`adws/proof/__tests__/featureScenarioIndex.test.ts`** (Gherkin strings in, index out):
  - Tags: feature tags reach every scenario; a Rule's tags reach its scenarios only; a scenario's own tags; an Examples table's tags reach its rows only.
  - Titles: `Feature › Scenario`; `Feature › Rule › Scenario`; outline rows `Feature › Outline › Example #1..#3`, numbered across two Examples tables (`#1`, `#2` in the first, `#3` in the second); title from `<column>` in the outline name; from the Examples name; from a `# title-format:` comment above the Examples and above its first tag; unknown `<key>` left as written; non-English document (`# language: nl`) → `Voorbeelden: #1`; an outline with no rows → no entry; Background ignored.
  - `hasScenarioTagged`: exact tag token (`@adw-99` is not `@adw-992`); tag inherited from the Feature; tag only on an Examples table; unparseable file whose raw text holds the tag counts, one that does not hold it does not.
  - `scenariosForTestCase`: exact full name; duplicate names across features with the same feature name return both; a bare name without ` › ` matches by the last segment; no match → `[]`.
- **`adws/proof/__tests__/proofAssembler.test.ts`** (pure inputs: parsed `TestReport`s with attachments, a feature index from Gherkin strings, `ProofArtifact[]`, the `cli`/`web` profiles from `APPLICATION_TYPE_PROFILES`, a fixed `generatedAt`):
  - **Exact selection**: the per-issue run's report holds a per-issue case (PNG + `trace.zip` + `video.webm` attachments) and a `@regression`-only case (PNG); the regression run's report holds a regression case (PNG). Result: exactly the per-issue PNG, with `relPath` from the artifact and `scenario` = case name.
  - **Exclusions**: an attachment outside the artifacts directory (`../elsewhere/x.png`), one not in the artifact list (missing), and a non-image are each excluded. An attachment path resolves against the report's directory, not `process.cwd()`.
  - **Scenario Outline rows**: a per-issue outline with three rows → three images in report order. An outline whose first Examples table carries `@adw-N` and whose second carries `@regression` → only the first table's rows' images, even when the per-issue report also lists a second-table row.
  - **Both tags** on one scenario → its image once, from the per-issue run.
  - **Duplicate titles** with differing tags → not selected; with agreeing tags → selected.
  - **Unattributed**: a case with a PNG whose name matches no scenario → not selected, its name in the document's "Left out" line.
  - **cli profile**: images attached and matched → `perIssueImages` `[]`, no `## Evidence` section.
  - **Both lines**: web + zero images → document contains `NO_SCENARIO_OPENED_A_PAGE`. Per-issue tag not run → its section's status is `⏭️ no per-issue scenarios` (contains `NO_PER_ISSUE_SCENARIOS`), `passed`/`skipped` true, `hasBlockerFailures` false. In a web repository both lines appear together, and neither fails the run.
  - **`shouldRunTag`**: regression always; per-issue only when indexed (including an Examples-only tag and an unparsed file holding the tag).
  - **Outcomes**: cases with a failure → failed blocker; clean report with exit 1 → passed with the warning; zero-case report → failed for regression, and failed with the "carry … but the run reported none" warning for per-issue; no report → exit code decides; a failed per-issue tag sets `hasBlockerFailures` (both tags block); `severity` is `blocker` for both; output truncated at 10,000 characters with the truncation note.
  - **Notice**: `runs: []` plus a notice → empty `tagResults`, the notice in the document, and under `web` the `no scenario opened a page` line.
- **`adws/phases/__tests__/scenarioProofRun.test.ts`** — the shell end to end with real commands: per-issue tag not run without a tagged feature file; a web run returns exactly the per-issue image and writes its absolute path into `scenario_proof.md`; cli selects nothing; the no-step-definitions proof; the existing environment and proof-directory tests.
- **`adws/core/__tests__/scenarioRunner.test.ts`** — `featureDirectory` per runner mode.
- **`adws/phases/__tests__/scenarioTestPhase.runner.test.ts`** — the phase hands `runScenarioProof` the profile and the runner's feature directory in both modes.
- **`adws/proof/__tests__/proofUploader.test.ts`** — uploads exactly the given list; failures and unreadable files left out; sequential; `isProofUploadConfigured()` is true with an installed uploader and no R2 credentials, false with neither.
- **`adws/proof/__tests__/prProofPublisher.publish.test.ts`** and **`prProofPublisher.test.ts`** — the PR comment embeds exactly the selected images, also through an installed uploader without R2 credentials; escaped group label.
- **`adws/phases/__tests__/reviewPhaseScreenshots.test.ts`** — the issue comment of every attempt carries exactly the URLs of the proof's selected images; empty selection uploads nothing.
- **`adws/core/__tests__/applicationType.test.ts`** — unchanged; it must still pass, proving the new modules read the profile and never name `applicationType`.

### Edge Cases
- A promotion issue or chore with no `@adw-{N}` scenario (ADR-0049): the per-issue tag is not run, the proof says `no per-issue scenarios`, and the gate passes. In a `web` repository the proof also says `no scenario opened a page`.
- Feature files hold `@adw-{N}` scenarios but the run reports zero test cases (filtered out, generator crashed after writing an empty report): the tag fails with a warning instead of reading as "no per-issue scenarios".
- Playwright's `No tests found` / exit 1 can no longer turn a zero-scenario issue red, because the per-issue tag is not run.
- `@adw-99` versus `@adw-992`: tags compare as exact tokens, in the index and in the raw-text fallback.
- A tag on the Feature, on a Rule, or only on one Examples table; an outline whose Examples tables carry different tags.
- A scenario tagged both `@regression` and `@adw-{N}`: one image, from the per-issue run.
- Outline row titles: default `Example #n` counted across Examples tables; a `<column>` in the Examples name or the outline name; a `# title-format:` comment; a non-English document; an outline with no rows.
- Two scenarios with the same name in one feature: selected only when both carry the tag.
- A test case whose name matches no scenario (an unexpected runner name): its image is left out and named in the proof.
- Attachments that are not images (`trace.zip`, `video.webm`, `error-context.md`), that point outside the artifacts directory, or whose file is missing: excluded.
- Titles with `&`, `<`, `>`, quotes or `›` (XML entities decoded by the parser), and very long titles (401 characters were run in #992): exact matching still holds, and the PR comment's `<summary>` is escaped.
- A `cli` repository whose runner happens to attach images: none is selected or uploaded, and the proof has no Evidence section.
- A `web` repository without step definitions: notice proof with `no scenario opened a page`, nothing run, nothing uploaded.
- An unparseable feature file: the raw-text tag check decides whether the per-issue tag runs; the runner then reports the parse error.
- The feature directory is missing: empty index; regression still runs; the per-issue tag is not run.
- A review re-attempt after a re-test: `ctx.screenshotUrls` is replaced, so the comment shows only the latest run's selected images (existing behaviour, kept).
- R2 not configured and no uploader installed: nothing uploaded; the PR comment carries the existing note. An uploader installed with `setProofUploaderForTesting` counts as configured for the PR comment, as it already does for the review phase. A failing upload is left out, and the comment and verdict stand.
- Self-host (no `repoContext`): nothing uploaded, as today.

## Acceptance Criteria
- Given a JUnit report with `[[ATTACHMENT|...]]` lines and the feature files, `assembleScenarioProof` returns exactly the per-issue images: those of test cases whose scenarios carry `@adw-{issueNumber}` in the feature files, resolved from the report's directory to images the artifacts directory holds. Regression-scenario images, non-image attachments and files outside the artifacts directory are excluded.
- The scenario tags are fixed in framework code (`fixedScenarioTags`): `@regression` and `@adw-{issueNumber}`, both `blocker`. `runScenarioProof` no longer takes or reads `reviewProofConfig`.
- When no scenario in the feature files carries `@adw-{issueNumber}`, the per-issue tag is not run, its result is passed and skipped, and `scenario_proof.md` carries the line `no per-issue scenarios`. This never fails the run.
- In a `web` repository with no selected image, `scenario_proof.md` carries the line `no scenario opened a page`, and this never fails the run. With images, its `## Evidence` section lists each selected image's absolute path with its scenario name, which is how the reviewer receives them.
- `ScenarioProofResult.perIssueImages` holds the selected list. It is always empty in a `cli` repository, so nothing is uploaded there.
- `uploadReviewedProofScreenshots` uploads exactly `ctx.scenarioProof.perIssueImages`, so the issue comment of each review attempt embeds exactly those images. `publishPrProof` uploads exactly the same list for the PR comment. Neither reads the artifacts directory.
- Unit tests cover tag and path extraction, exclusion, both lines and Scenario Outline rows (`testReportParser`, `featureScenarioIndex`, `proofAssembler`, `scenarioProofRun`, `proofUploader`, `prProofPublisher`, `reviewPhaseScreenshots`), and `applicationType.test.ts`'s naming rule still passes.
- Regression surface rows 21 and 22 assert the fixed `@regression` tag and pass. The `@python-e2e` scenario passes with the new `runScenarioProof`/`publishPrProof` signatures.
- The `### Confirmation` section of ADR-0063 names the implemented modules, tests and a mechanical check.
- `bun run lint`, both type checks, the build, the full Vitest suite and the `@adw-994` and `@regression` scenario runs are green.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint`: lint, including the new modules and tests.
- `bunx tsc --noEmit`: root type check. It covers `features/**/*.ts`, so it also checks the regression harness, step definitions and every hand-built `ScenarioProofResult`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type check of `adws/`.
- `bun run build`: build.
- `bun run test:unit`: the whole Vitest suite, including `applicationType.test.ts`'s rule that only the config parser and the gate name `applicationType`.
- `bunx vitest run adws/proof adws/core/__tests__/testReportParser.test.ts adws/core/__tests__/scenarioRunner.test.ts adws/phases/__tests__/scenarioProofRun.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/scenarioTestPhase.runner.test.ts adws/phases/__tests__/reviewPhaseScreenshots.test.ts adws/phases/__tests__/preExistingRegressionGate.test.ts adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts adws/forge/__tests__/workflowCommentsIssue.test.ts`: this feature's own tests and the closest consumers, in isolation.
- `bun run lint:git-guard`: no raw `git`/`gh` strings in the new code.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-994"`: this issue's scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the regression suite, including surface rows 21–23 under the fixed tags and the `@python-e2e` proof pipeline.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-992"`: the `web` scenario test phase with the stand-in Playwright runner and the per-tag proof directories still behaves. As in #992, the fresh-repository scenario installs from the npm registry and downloads Chromium, so it needs network access.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - the three new logic modules are pure (I/O stays in `featureFileReader.ts`, `proofArtifactHarvester.ts` and the `runScenarioProof` shell);
  - guard clauses and named per-item functions instead of nested loops;
  - `readonly` inputs and outputs, no decorators, every file under 300 lines;
  - comments only for what the code cannot say (the playwright-bdd 9.2.1 naming dependency, why the per-issue tag is not run, why images come only from the per-issue run), and no issue numbers in comments (ADR-0054).
- No new library. `@cucumber/gherkin` and `@cucumber/messages` are already dependencies (`adws/promotion/scenarioParser.ts`); `fast-xml-parser` already parses the JUnit report. If one were ever needed, `.adw/commands.md` says `bun add <package>`.
- **Boundary with #995 (the reviewer issue).** This issue stops reading the `## Tags` configuration but does not delete it. `ReviewProofConfig`, `parseReviewProofMd`, `supplementaryChecks`, `ProjectConfig.reviewProofConfig`/`reviewProofMd`, `.adw/review_proof.md` and the fixtures' `review_proof.md` stay for #995 to remove; after this issue nothing on the scenario path reads them. `.claude/commands/review.md` is unchanged. The reviewer already reads `scenario_proof.md`, which now lists the selected absolute image paths, and `ctx.scenarioProof.perIssueImages` is there for #995 to pass to the prompt. #995 can quote `NO_PER_ISSUE_SCENARIOS` and `NO_SCENARIO_OPENED_A_PAGE` from `adws/proof/proofDocument.ts` rather than retyping them.
- **Boundary with #993** (dev-server start failure): untouched; `withDevServer` wiring in the scenario test phase is unchanged.
- **ADR-0049**: the rule that a promotion issue passes without `@adw-{N}` scenarios no longer depends on `review_proof.md`. It is now in code (`shouldRunTag` plus the not-run outcome). The document agent may record this; the ADR's decision is unchanged.
- **Naming dependency.** Test-case names come from Playwright 1.63.0's JUnit reporter (`titlePath().slice(3).join(' › ')`, attachment paths relative to the report file's directory, only existing files listed) and from playwright-bdd 9.2.1 (`dist/generate/file.js`, `dist/generate/examplesTitleBuilder.js`). Both were verified read-only in the `node_modules` left by the #992 real-application run. Both versions are pinned in `templates/playwright/package.json.template`. A version bump, or an `examplesTitleFormat` added to the ADW Playwright configuration, must be matched in `featureScenarioIndex.ts`; unmatched cases show up in the proof's "Left out" line rather than vanishing.
- The regression tag's zero-scenario semantics (a zero-case report fails) are unchanged on purpose and out of scope.
- `harvestProofArtifacts` stays in production use as the shell's source of the assembler's artifact list; its tests stay as they are.
- Per-issue scenarios of earlier issues that describe whole-directory uploads (for example `features/per-issue/feature-937.feature`) are not among this run's gates (only `@adw-994` and `@regression` run). They must still type-check, and the per-issue sweep retires them.
- The living docs (`app_docs/feature-9gjajh-proof-and-scenario-proof.md`, `feature-9gjajh-review-and-diff-phases.md`, `feature-9gjajh-test-report-and-verdict.md`, `feature-9gjajh-bdd-regression-suite.md`) are updated by the document phase. They should say that the uploader no longer harvests a directory, that the proof's tags are fixed, and describe the new `adws/proof/` modules and the two lines.
