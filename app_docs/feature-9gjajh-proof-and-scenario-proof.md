# Proof and Scenario Proof

## Overview

This module collects BDD scenario results and screenshot artifacts, formats them into a structured proof comment, and posts that comment to the pull request. It provides both the orchestration phase (`proofPublishPhase`) and the underlying machinery: a scenario runner (`scenarioProof`), a pure artifact harvester (`proofArtifactHarvester`), and a pure formatter plus impure publisher (`prProofPublisher`).

## Responsibilities

- `executeProofPublishPhase`: calls `publishPrProof` with the scenario proof result and PR number from `ctx`; catches and logs all errors so the workflow continues regardless.
- `runScenarioProof`: iterates over `ReviewProofConfig.tags`, substitutes `{issueNumber}` in tag patterns, runs each tag via `runScenariosByTag`, reads the JUnit XML report, derives pass/fail/skip from the report (with a JUnit-overrides-exit-code reconciliation for post-suite noise), writes `scenario_proof.md`, and returns a `ScenarioProofResult`.
- `shouldRunScenarioProof`: returns false when `.adw/scenarios.md` is empty, allowing callers to fall back to code-diff proof.
- `harvestProofArtifacts`: recursively walks the `ADW_PROOF_DIR` directory and returns a sorted list of image files as `ProofArtifact` records. Pure — no uploads, no logging.
- `formatPrProofComment`: composes a Markdown PR comment from tag results and uploaded screenshot URLs. Pure — no I/O, no ADW footer.
- `publishPrProof`: harvests artifacts, uploads them to R2 (when Cloudflare credentials are configured), calls `formatPrProofComment`, appends `ADW_SIGNATURE`, and posts the comment to the PR. All errors are caught and logged.

## Contracts & Invariants

- `executeProofPublishPhase` always returns with zero cost — it is non-fatal by design. It skips silently when `ctx.scenarioProof` or `ctx.prUrl` are absent.
- `runScenarioProof` pre-flight checks for step definition files; when none are found it writes a warning-only `scenario_proof.md` and returns `{ tagResults: [], hasBlockerFailures: false }`.
- JUnit report takes precedence over subprocess exit code when `report.total > 0`. A clean JUnit with a non-zero exit code results in PASS with a warning string attached.
- A JUnit report with `total === 0` for an optional tag is treated as SKIP; for a required tag it is treated as FAIL.
- `harvestProofArtifacts` returns `[]` when the directory does not exist; callers need not guard the directory's existence.
- `publishPrProof` skips uploading when R2 credentials are absent and renders a note in the comment instead.
- The artifacts directory (`ADW_PROOF_DIR`) is wiped and recreated at the start of each `runScenarioProof` call to avoid stale screenshots from a prior run bleeding into the proof.
- Stale per-tag JUnit reports are deleted before each tag run so a missing report is distinguishable from an empty one.

## Configuration

R2 upload requires `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` to be set. When any are absent, `publishPrProof` skips the upload step. The `runByTagCommand` template (with `{tag}` placeholder), `stepDefDirectory`, and `stepDefExtensions` are caller-supplied, read from `.adw/` project config.

## Gotchas

- The JUnit reconciliation warning exists because Cucumber (and some other BDD runners) exit non-zero for pending/undefined steps even when all defined scenarios pass, and also emit errors from shutdown hooks (e.g. D1 write failures) that are unrelated to test results.
- `leadingSegment(relPath)` groups uploaded screenshots by the first path segment of their relative path (e.g. the scenario folder name). When an image lives at the root of the artifacts directory, it is grouped under the literal string `'Screenshots'`.
- `harvestProofArtifacts` uses an iterative DFS stack rather than recursion to avoid stack overflow on deep artifact trees.
- `formatPrProofComment` does not append `ADW_SIGNATURE`; the caller (`publishPrProof`) must append it. This keeps the formatter pure and testable without the signature string.
