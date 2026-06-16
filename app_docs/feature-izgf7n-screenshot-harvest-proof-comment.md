# Screenshot Harvest to R2 + Inline Proof PR Comment

**ADW ID:** izgf7n-screenshot-harvest-t
**Date:** 2026-06-16
**Specification:** specs/issue-580-adw-izgf7n-screenshot-harvest-t-sdlc_planner-screenshot-harvest-proof-comment.md

## Overview

This feature wires ADW's dormant R2 upload module into production by introducing a cohesive proof layer (`adws/proof/`) that harvests BDD screenshots from a known directory, uploads them to Cloudflare R2, and posts a self-explanatory PR comment with both a JUnit pass/fail summary and inline screenshot embeds grouped by scenario. A reviewer opening a PR now sees visual proof and test results in one comment without leaving GitHub.

## What Was Built

- `proofArtifactHarvester` — pure recursive image globber that collects images written to `ADW_PROOF_DIR`
- `prProofPublisher` — pure `formatPrProofComment` formatter (summary table + collapsible per-scenario screenshot groups) and impure `publishPrProof` orchestrator (harvest → upload → format → post)
- `ProofArtifact`, `UploadedArtifact`, `ProofCommentInput`, `PublishDeps` type definitions in `adws/proof/types.ts`
- `executeProofPublishPhase` — non-fatal phase that reads `ctx.scenarioProof` and `ctx.prUrl` and calls `publishPrProof`
- `ADW_PROOF_DIR` convention — injected into each scenario subprocess env alongside the existing `ADW_JUNIT_REPORT_PATH`
- Artifacts directory cleared before each scenario run (stale images from prior retries never leak)
- `scenarioTestPhase` now sets `config.ctx.scenarioProof` so the publish phase can read the final proof
- Phase wired into `adwSdlc.tsx`, `adwPlanBuildTest.tsx`, and `adwPlanBuildTestReview.tsx`

## Technical Implementation

### Files Modified

- `adws/phases/scenarioProof.ts`: compute + clear + create `artifactsDir` under `proofDir/artifacts`; inject `ADW_PROOF_DIR` into per-tag subprocess env; add `artifactsDir` to `ScenarioProofResult`
- `adws/phases/scenarioTestPhase.ts`: set `config.ctx.scenarioProof = scenarioProof` before returning
- `adws/phases/index.ts`: export `executeProofPublishPhase`
- `adws/workflowPhases.ts`: add `executeProofPublishPhase` to the re-export list
- `adws/adwSdlc.tsx`: wire `executeProofPublishPhase` immediately after `executePRPhase`
- `adws/adwPlanBuildTest.tsx`: same wiring
- `adws/adwPlanBuildTestReview.tsx`: same wiring

### New Files

- `adws/proof/types.ts`: shared readonly interfaces for the proof layer
- `adws/proof/proofArtifactHarvester.ts`: pure iterative stack-walk harvester, returns `ProofArtifact[]` sorted by `relPath`
- `adws/proof/prProofPublisher.ts`: pure formatter + impure publisher with injectable `uploader`/`commenter` deps
- `adws/proof/index.ts`: barrel re-exporting the public surface
- `adws/phases/proofPublishPhase.ts`: non-fatal phase, zero-cost, logs failures and swallows them
- `adws/proof/__tests__/proofArtifactHarvester.test.ts`: temp-dir fixtures (empty, missing, nested, mixed extensions, case-insensitive, deterministic order)
- `adws/proof/__tests__/prProofPublisher.test.ts`: pure formatter coverage (inline embeds, grouping, fallbacks, summary table, pass/fail tally)

### Key Changes

- **R2 first production caller:** `uploadToR2` was previously built but never called in production; this feature is its first real call site. Key format: `proof/{adwId}/{relPath}`.
- **Inline embed pattern:** `[![fileName](url)](url)` with raw R2 URL on the next line as a link fallback, mirroring `workflowCommentsIssue.ts:formatScreenshotSection`.
- **Explicit pass/fail tally:** the comment surfaces `**N passed, M failed**` counts summed across non-skipped suites — both numbers always visible, not a ratio.
- **Scenario grouping:** the leading path segment of `relPath` is the group key; flat images fall into a single `Screenshots` group. Grouping lives in the pure formatter, not the harvester.
- **Non-fatal contract:** `executeProofPublishPhase` catches all errors, logs as `warn`, and returns zero cost — mirrors `executeKpiPhase`.

## How to Use

The phase runs automatically as part of any orchestrator that calls `executeScenarioTestPhase` followed by `executePRPhase`. No manual steps are required. To take advantage of screenshot embedding:

1. In step definitions or runner config, write screenshot files to the directory exposed as `ADW_PROOF_DIR` in the subprocess environment (absolute path, resolved before the run).
2. Supported extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`.
3. Place screenshots in scenario-named sub-directories (e.g. `ADW_PROOF_DIR/login-flow/step1.png`) to get one collapsible `<details>` block per scenario in the comment. Flat files are grouped under a single `Screenshots` section.
4. The PR comment appears automatically after the PR is created.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | No | Enables R2 uploads; screenshots skipped when absent |
| `R2_ACCESS_KEY_ID` | No | R2 credentials |
| `R2_SECRET_ACCESS_KEY` | No | R2 credentials |
| `ADW_PROOF_DIR` | Set by ADW | Injected into the scenario subprocess; step defs write screenshots here |

When R2 is not configured, the proof comment is still posted (JUnit summary only) with a one-line note that screenshots were skipped.

## Testing

Run the unit suite to verify the harvester and formatter in isolation:

```
bun run test:unit
```

Key test files:
- `adws/proof/__tests__/proofArtifactHarvester.test.ts` — uses `fs.mkdtempSync` temp dirs; covers empty, missing, nested, mixed-extension, case-insensitive, and sort-order cases.
- `adws/proof/__tests__/prProofPublisher.test.ts` — pure `formatPrProofComment` coverage; uses injected fake `uploader`/`commenter` for `publishPrProof` guard-clause tests.

For integration validation, run the `@regression` BDD suite (should produce a summary-only proof comment since ADW-self is a CLI repo with no browser):

```
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- **Screenshot production is out of scope.** This feature harvests whatever images land in `ADW_PROOF_DIR`. Teaching generated step definitions to write screenshots there is deferred to the polymorphic `generate_step_definitions.md` / `scenario_writer.md` work.
- **Why a comment, not the PR description.** The description is written by `prAgent` before proof exists. `executeProofPublishPhase` runs after `executePRPhase`, so proof is surfaced as a comment.
- **`ADW_PROOF_DIR` is absolute.** The scenario subprocess runs with `cwd: worktreePath`, but the proof dir is absolute — the writer (subprocess) and reader (harvester) always agree on one location.
- **Stale image cleanup.** `artifactsDir` is `rmSync`-ed and recreated before the tag loop so only the final scenario attempt's images are published.
- **Future consideration.** Once generation prompts write screenshots, consider wiring `executeProofPublishPhase` into `adwChore` and `adwPrReview` flows if they begin running UI BDD; the phase is already defensive enough to drop in safely.
