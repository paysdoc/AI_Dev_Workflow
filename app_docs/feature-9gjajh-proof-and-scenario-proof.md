# Proof and Scenario Proof

## Overview

This module runs the fixed BDD scenario tags, assembles the scenario proof, selects the per-issue scenario images as the visual evidence (attributing each to a platform where the application profile has platforms), and publishes them to the review comment and the pull request. A pure proof assembler in `adws/proof/` decides tag outcomes, image selection and the `scenario_proof.md` text; `runScenarioProof` is the I/O shell around it. The upload half is shared by the review phase (issue comment of each attempt) and the PR proof publisher.

## Responsibilities

- `runScenarioProof` (`adws/phases/scenarioProof.ts`): the I/O shell. Indexes the feature files under `featureDirectory`, runs `@regression` always and `@adw-{issueNumber}` only when a scenario carries it, reads each tag's JUnit report, harvests the artifacts directory, calls `assembleScenarioProof`, writes `scenario_proof.md` and returns a `ScenarioProofResult` (`tagResults`, `hasBlockerFailures`, `perIssueImages`, `resultsFilePath`, `artifactsDir`). Requires `applicationProfile` and `featureDirectory`.
- `shouldRunScenarioProof`: false when `.adw/scenarios.md` is empty, so callers can fall back to code-diff proof.
- `assembleScenarioProof` (`proofAssembler.ts`, pure): returns `{ tagResults, hasBlockerFailures, perIssueImages, document }`. Owns the fixed tags (`fixedScenarioTags`, `REGRESSION_SCENARIO_TAG`, `ScenarioTagRole`), `shouldRunTag`, tag outcomes and image selection. For a profile with platforms it also attributes each selected image to a platform after title attribution; unattributed images go to a left-out list instead of `perIssueImages`.
- `platformOfImage`, `scenarioPlatformCoverage` (`imagePlatform.ts`, pure): the platform of an image is the first directory segment of its harvest-root-relative POSIX path, matched whole and case-sensitively against the profile's platforms (`android`, `ios` for `mobile:kotlincm`); anything else, including root-level files, is `null` (unattributed). Coverage gives one `{ scenario, present, missing }` per scenario with an image, grouped by reported test-case name, in order of first image, with platforms in profile order.
- `indexFeatureScenarios`, `hasScenarioTagged`, `scenariosForTestCase` (`featureScenarioIndex.ts`, pure): parse feature files with `@cucumber/gherkin`, compute each scenario's effective tags (feature, rule, scenario, Examples) and the JUnit test-case name the ADW Playwright project gives it, including Scenario Outline rows.
- `readFeatureFiles` (`featureFileReader.ts`): lists every `.feature` file under a directory, skipping `node_modules` and dot-directories.
- `renderProofDocument` (`proofDocument.ts`, pure): renders `scenario_proof.md`, with the exported fixed lines `NO_PER_ISSUE_SCENARIOS`, `NO_SCENARIO_OPENED_A_PAGE`, `NO_SCENARIO_OPENED_A_SCREEN` and `PASSED_ON_EXIT_CODE_ONLY` (the warning for a pass backed by the exit code alone) and an `## Evidence` section listing the selected absolute image paths. For a profile with platforms (`ProofEvidence.platforms: PlatformEvidence | null`) the section also carries one ``On some platforms only: `<scenario>` (present: …; missing: …)`` line per scenario whose images cover a non-empty strict subset of the platforms, and a ``Left out as unattributed, because they are in no platform directory (`android/`, `ios/`): …`` line listing harvest-root paths.
- `harvestProofArtifacts`: recursively lists image files in `ADW_PROOF_DIR` as sorted `ProofArtifact` records. Pure of uploads and logging; supplies the assembler's artifact list.
- `uploadProofArtifacts` (`proofUploader.ts`): uploads a given `images` list sequentially to `proof/{adwId}/{relPath}` and returns the `UploadedArtifact[]` that succeeded. Uploader resolves as `deps.uploader ?? installedUploader ?? uploadToR2`. Exports `isR2Configured`, `isProofUploadConfigured` and the test-only `setProofUploaderForTesting(uploader | null)`.
- `formatPrProofComment` (`prProofPublisher.ts`) renders a tag with `reportMissing` as `no report` in the Scenarios column; when any non-skipped tag has it, the tally line is `**Counts unavailable: no JUnit report at ADW_JUNIT_REPORT_PATH**` instead of `N passed, M failed`, and each passing such tag gets a `⚠️ **Warning:** \`<tag>\` passed based on the exit code only; …` line after the table.
- `publishPrProof` / `formatPrProofComment`: uploads `scenarioProof.perIssueImages` when `isProofUploadConfigured()`, formats the comment (per-scenario `<details>` groups, labels HTML-escaped), appends `ADW_SIGNATURE` and posts to the PR.
- `executeProofPublishPhase`: calls `publishPrProof` with `ctx.scenarioProof` and the PR number; catches and logs all errors. Skips when `repoContext` is absent; binds `commenter` to `repoContext.codeHost.commentOnPullRequest`.
- The review phase's `uploadReviewedProofScreenshots` uploads the same selected list for each review attempt.
- `TagProofResult`, `ScenarioProofResult`, `PerIssueImage` (with optional `platform`, set only for a profile with platforms) and `ScenarioPlatformCoverage` live in `adws/proof/types.ts`; `scenarioProof.ts` re-exports the first two.

## Contracts & Invariants

- Tags are fixed, both blocking on failure: `@regression` and `@adw-{issueNumber}`. Only the per-issue tag is `optional`.
- Per-issue images are selected only from the per-issue run's report, only for test cases whose matched scenarios all carry `@adw-{issueNumber}`, and only when the attachment path (resolved against the report's directory) is an image in the artifacts list. Regression images, traces, videos and missing files are never selected. Result is deduplicated by `absPath`.
- Selection happens only when the application profile expects `EvidenceKind.PerIssueImages` (`web`, `mobile:kotlincm`); in a `cli` repository `perIssueImages` is always `[]` and nothing is uploaded.
- When no scenario in the feature files carries `@adw-{issueNumber}`, the per-issue tag is not run: its result is `{ passed: true, skipped: true }`, the proof says `no per-issue scenarios`, and it is never a gate failure. If such scenarios exist but the run reports zero cases, the tag fails with a warning.
- A `web` proof with no selected image says `no scenario opened a page`; this does not fail the run. A case whose name matches no scenario is left out of the images and named in the proof.
- For a profile with platforms, every entry of `perIssueImages` carries a `platform`; an image outside every platform directory is never selected, so it reaches neither the reviewer, the review upload nor the PR comment. Both platform runs of a scenario report the same case title and both images are selected. A profile with platforms with no selected image says `no scenario opened a screen` (also in notice proofs and when the per-issue tag did not run), never the page line. Nothing mechanical blocks on a missing platform: `hasBlockerFailures` depends on tag outcomes alone and the reviewer decides.
- `cli` and `web` proofs are unchanged: no platform attribution runs, `platforms` is `null`, and `web` image objects have no `platform` key.
- Regression outcome: report with cases → `failed === 0` decides; report with zero cases → failed; no report → exit code, and the result is marked `reportMissing: true` (no `counts` or `cases`); a passing one also carries `warning: PASSED_ON_EXIT_CODE_ONLY`, printed as a `**Warning:**` line in its `scenario_proof.md` section, while a failing one carries no warning. A clean report with a non-zero exit code passes with a warning.
- `runScenarioProof` with no step definitions writes a notice-only proof and returns `{ tagResults: [], hasBlockerFailures: false, perIssueImages: [] }`.
- `uploadProofArtifacts` never throws: per-image errors are logged and skipped. An injected or installed uploader counts as configured; only the default `uploadToR2` is gated on `isR2Configured()`.
- `harvestProofArtifacts` returns `[]` for a missing directory. The artifacts directory is wiped at the start of each `runScenarioProof`; stale per-tag JUnit reports are deleted before each run.
- `reportMissing` is distinct from an empty report: a report with zero cases is a report (`-`, failed, tally as before), never `no report`. The not-run skip (`-`, `⏭️ skipped`) never sets `reportMissing`. Runs with a report render exactly as without this field; the pass/fail decision and `hasBlockerFailures` do not depend on it.
- `formatPrProofComment` does not append `ADW_SIGNATURE`; `publishPrProof` does.

## Configuration

R2 upload requires `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Without them and without an installed uploader, `publishPrProof` skips the upload and the comment carries an "R2 is not configured" note. `runByTagCommand` (with `{tag}`), `stepDefDirectory`, `stepDefExtensions`, `applicationProfile` and `featureDirectory` (relative to `cwd`; from `ScenarioRunner.featureDirectory`) are caller-supplied.

## Gotchas

- `readJUnitReport` returns `null` for a missing and for an unparseable report, so `no report` covers both. The assembler's non-zero-exit warning for a clean report is not shown in the PR comment; only the exit-code-only warning is.
- Test-case names must match the pinned ADW Playwright project (`@playwright/test` 1.63.0, `playwright-bdd` 9.2.1): `Feature › [Rule ›] Scenario`, outline rows `… › Outline › <example title>`. A runner that reports the scenario title alone is matched on the last segment.
- Tags come from the feature files, because JUnit test-case names carry none; image paths come from `[[ATTACHMENT|...]]` lines in `<system-out>`.
- Uploads run sequentially so first uploads do not race bucket creation.
- The review phase uploads before the PR exists; `publishPrProof` re-uploads under identical keys, an idempotent overwrite.
- `hasScenarioTagged` treats an unparseable feature file containing the tag as a match, so the runner reports the parse error.
- Images at the artifacts root are grouped under the literal `'Screenshots'` in the PR comment.
- Platform attribution assumes the harvest root is the descriptor run's `ADW_PROOF_DIR` (`proofDirPerTag: false`), so the first segment is the platform directory. A profile with platforms on a per-tag runner would need attribution relative to the tag directory.
- A runner that de-duplicates repeated case names (e.g. appends a counter) breaks the match; the images then land in the no-scenario-has-their-name line.
- A scenario without any image gets no coverage line; the no-image line and the reviewer's reading of the diff cover it.
- `harvestProofArtifacts` and `readFeatureFiles` use iterative walks, not recursion.

## Decisions

- [ADR-0014](../docs/adr/0014-bdd-as-validation-contract-unit-tests-removed.md) — BDD scenarios as the validation contract, ADW unit tests removed
- [ADR-0022](../docs/adr/0022-review-proof-in-r2-behind-router-worker.md) — Proof images stored in R2 and served by a router Worker
- [ADR-0043](../docs/adr/0043-multi-language-test-seam.md) — Multi-language test seam: detected descriptor, Gherkin mandate, JUnit report rail
- [ADR-0058](../docs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md) — Static checks are deterministic gates in the test phase; the reviewer runs nothing and `review_proof.md` is gone
- [ADR-0061](../docs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md) — The application type decides the evidence; `web` repositories run their Gherkin on an ADW-owned Playwright project
- [ADR-0063](../docs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md) — Every per-issue scenario image in a `web` repository is visual evidence; the reviewer judges it before the pull request exists
