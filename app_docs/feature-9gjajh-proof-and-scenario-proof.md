# Proof and Scenario Proof

## Overview

This module runs the fixed BDD scenario tags, assembles the scenario proof, selects the per-issue scenario images as the visual evidence, and publishes them to the review comment and the pull request. A pure proof assembler in `adws/proof/` decides tag outcomes, image selection and the `scenario_proof.md` text; `runScenarioProof` is the I/O shell around it. The upload half is shared by the review phase (issue comment of each attempt) and the PR proof publisher.

## Responsibilities

- `runScenarioProof` (`adws/phases/scenarioProof.ts`): the I/O shell. Indexes the feature files under `featureDirectory`, runs `@regression` always and `@adw-{issueNumber}` only when a scenario carries it, reads each tag's JUnit report, harvests the artifacts directory, calls `assembleScenarioProof`, writes `scenario_proof.md` and returns a `ScenarioProofResult` (`tagResults`, `hasBlockerFailures`, `perIssueImages`, `resultsFilePath`, `artifactsDir`). Requires `applicationProfile` and `featureDirectory`.
- `shouldRunScenarioProof`: false when `.adw/scenarios.md` is empty, so callers can fall back to code-diff proof.
- `assembleScenarioProof` (`proofAssembler.ts`, pure): returns `{ tagResults, hasBlockerFailures, perIssueImages, document }`. Owns the fixed tags (`fixedScenarioTags`, `REGRESSION_SCENARIO_TAG`, `ScenarioTagRole`), `shouldRunTag`, tag outcomes and image selection.
- `indexFeatureScenarios`, `hasScenarioTagged`, `scenariosForTestCase` (`featureScenarioIndex.ts`, pure): parse feature files with `@cucumber/gherkin`, compute each scenario's effective tags (feature, rule, scenario, Examples) and the JUnit test-case name the ADW Playwright project gives it, including Scenario Outline rows.
- `readFeatureFiles` (`featureFileReader.ts`): lists every `.feature` file under a directory, skipping `node_modules` and dot-directories.
- `renderProofDocument` (`proofDocument.ts`, pure): renders `scenario_proof.md`, with the exported fixed lines `NO_PER_ISSUE_SCENARIOS` and `NO_SCENARIO_OPENED_A_PAGE` and an `## Evidence` section listing the selected absolute image paths.
- `harvestProofArtifacts`: recursively lists image files in `ADW_PROOF_DIR` as sorted `ProofArtifact` records. Pure of uploads and logging; supplies the assembler's artifact list.
- `uploadProofArtifacts` (`proofUploader.ts`): uploads a given `images` list sequentially to `proof/{adwId}/{relPath}` and returns the `UploadedArtifact[]` that succeeded. Uploader resolves as `deps.uploader ?? installedUploader ?? uploadToR2`. Exports `isR2Configured`, `isProofUploadConfigured` and the test-only `setProofUploaderForTesting(uploader | null)`.
- `publishPrProof` / `formatPrProofComment`: uploads `scenarioProof.perIssueImages` when `isProofUploadConfigured()`, formats the comment (per-scenario `<details>` groups, labels HTML-escaped), appends `ADW_SIGNATURE` and posts to the PR.
- `executeProofPublishPhase`: calls `publishPrProof` with `ctx.scenarioProof` and the PR number; catches and logs all errors. Skips when `repoContext` is absent; binds `commenter` to `repoContext.codeHost.commentOnPullRequest`.
- The review phase's `uploadReviewedProofScreenshots` uploads the same selected list for each review attempt.
- `TagProofResult`, `ScenarioProofResult`, `PerIssueImage` live in `adws/proof/types.ts`; `scenarioProof.ts` re-exports the first two.

## Contracts & Invariants

- Tags are fixed, both blocking on failure: `@regression` and `@adw-{issueNumber}`. Only the per-issue tag is `optional`.
- Per-issue images are selected only from the per-issue run's report, only for test cases whose matched scenarios all carry `@adw-{issueNumber}`, and only when the attachment path (resolved against the report's directory) is an image in the artifacts list. Regression images, traces, videos and missing files are never selected. Result is deduplicated by `absPath`.
- Selection happens only when the application profile expects `EvidenceKind.PerIssueImages` (`web`); in a `cli` repository `perIssueImages` is always `[]` and nothing is uploaded.
- When no scenario in the feature files carries `@adw-{issueNumber}`, the per-issue tag is not run: its result is `{ passed: true, skipped: true }`, the proof says `no per-issue scenarios`, and it is never a gate failure. If such scenarios exist but the run reports zero cases, the tag fails with a warning.
- A `web` proof with no selected image says `no scenario opened a page`; this does not fail the run. A case whose name matches no scenario is left out of the images and named in the proof.
- Regression outcome: report with cases → `failed === 0` decides; report with zero cases → failed; no report → exit code. A clean report with a non-zero exit code passes with a warning.
- `runScenarioProof` with no step definitions writes a notice-only proof and returns `{ tagResults: [], hasBlockerFailures: false, perIssueImages: [] }`.
- `uploadProofArtifacts` never throws: per-image errors are logged and skipped. An injected or installed uploader counts as configured; only the default `uploadToR2` is gated on `isR2Configured()`.
- `harvestProofArtifacts` returns `[]` for a missing directory. The artifacts directory is wiped at the start of each `runScenarioProof`; stale per-tag JUnit reports are deleted before each run.
- `formatPrProofComment` does not append `ADW_SIGNATURE`; `publishPrProof` does.

## Configuration

R2 upload requires `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Without them and without an installed uploader, `publishPrProof` skips the upload and the comment carries an "R2 is not configured" note. `runByTagCommand` (with `{tag}`), `stepDefDirectory`, `stepDefExtensions`, `applicationProfile` and `featureDirectory` (relative to `cwd`; from `ScenarioRunner.featureDirectory`) are caller-supplied.

## Gotchas

- Test-case names must match the pinned ADW Playwright project (`@playwright/test` 1.63.0, `playwright-bdd` 9.2.1): `Feature › [Rule ›] Scenario`, outline rows `… › Outline › <example title>`. A runner that reports the scenario title alone is matched on the last segment.
- Tags come from the feature files, because JUnit test-case names carry none; image paths come from `[[ATTACHMENT|...]]` lines in `<system-out>`.
- Uploads run sequentially so first uploads do not race bucket creation.
- The review phase uploads before the PR exists; `publishPrProof` re-uploads under identical keys, an idempotent overwrite.
- `hasScenarioTagged` treats an unparseable feature file containing the tag as a match, so the runner reports the parse error.
- Images at the artifacts root are grouped under the literal `'Screenshots'` in the PR comment.
- `harvestProofArtifacts` and `readFeatureFiles` use iterative walks, not recursion.

## Decisions

- [ADR-0014](../specs/adr/0014-bdd-as-validation-contract-unit-tests-removed.md) — BDD scenarios as the validation contract, ADW unit tests removed
- [ADR-0022](../specs/adr/0022-review-proof-in-r2-behind-router-worker.md) — Proof images stored in R2 and served by a router Worker
- [ADR-0043](../specs/adr/0043-multi-language-test-seam.md) — Multi-language test seam: detected descriptor, Gherkin mandate, JUnit report rail
- [ADR-0058](../specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md) — Static checks are deterministic gates in the test phase; the reviewer runs nothing and `review_proof.md` is gone
- [ADR-0061](../specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md) — The application type decides the evidence; `web` repositories run their Gherkin on an ADW-owned Playwright project
- [ADR-0063](../specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md) — Every per-issue scenario image in a `web` repository is visual evidence; the reviewer judges it before the pull request exists
