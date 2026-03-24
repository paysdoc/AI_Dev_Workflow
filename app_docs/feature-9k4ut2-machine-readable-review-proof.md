# Machine-Readable Review Proof Configuration

**ADW ID:** 9k4ut2-machine-readable-rev
**Date:** 2026-03-24
**Specification:** specs/issue-273-adw-s18k21-machine-readable-rev-sdlc_planner-machine-readable-review-proof.md

## Overview

Replaces the prose-based `.adw/review_proof.md` with a structured markdown format that defines which BDD tags run during review, their failure severity, and supplementary checks. The orchestration layer (`regressionScenarioProof.ts`, `reviewRetry.ts`, `workflowCompletion.ts`) now reads tag configuration dynamically from `ReviewProofConfig` instead of hardcoding `@regression` / `@adw-{issueNumber}`, enabling target repositories to customize review proof behavior without modifying ADW source code. A three-tier tag strategy is introduced: `@review-proof` (scoped review subset), `@adw-{issueNumber}` (issue-specific), and `@regression` (moved to periodic CI).

## What Was Built

- **`ReviewProofConfig` type** — structured type with `tags: ReviewTagEntry[]` and `supplementaryChecks: SupplementaryCheck[]`
- **`parseReviewProofMd()` function** — parses the new `## Tags` and `## Supplementary Checks` markdown table sections into `ReviewProofConfig`
- **`parseMarkdownTableRows()` helper** — generic markdown table parser shared by tags and supplementary checks parsing
- **Rewritten `.adw/review_proof.md`** — machine-readable format with `@review-proof` (blocker) and `@adw-{issueNumber}` (blocker, optional) tags, plus type-check and lint supplementary checks
- **Config-driven `runScenarioProof()`** — replaces `runRegressionScenarioProof()`, iterates `ReviewProofConfig.tags`, collects per-tag `TagProofResult` entries
- **`TagProofResult` type** — per-tag result with `tag`, `resolvedTag`, `severity`, `optional`, `passed`, `output`, `exitCode`, `skipped` fields
- **`ScenarioProofResult` type** — updated to use `tagResults: TagProofResult[]` and `hasBlockerFailures: boolean` instead of regression-specific fields
- **`{issueNumber}` substitution** — performed inside `runScenarioProof()` per tag pattern before calling the BDD runner
- **Optional tag skip logic** — tags marked `optional: true` that produce zero matching scenarios are recorded as `skipped: true` without causing failure
- **Dynamic proof markdown** — generated `scenario_proof.md` includes per-tag sections with severity in header (e.g., `## @review-proof Scenarios (severity: blocker)`)
- **Updated `ReviewRetryOptions`** — accepts `reviewProofConfig: ReviewProofConfig` and `runByTagCommand: string` instead of separate `runRegressionCommand`/`runByTagCommand` strings
- **Updated `workflowCompletion.ts`** — passes `reviewProofConfig` from `config.projectConfig` to the review retry loop
- **Updated `/review` slash command** — reads per-tag severity from proof file section headers; no hardcoded severity rules
- **Backward compatibility** — `getDefaultReviewProofConfig()` returns `@regression` (blocker) + `@adw-{issueNumber}` (blocker, optional), matching pre-existing behavior for repos without the new format
- **BDD feature + step definitions** — `features/machine_readable_review_proof.feature` with `features/step_definitions/machineReadableReviewProofSteps.ts`

## Technical Implementation

### Files Modified

- `adws/core/projectConfig.ts`: Added `ReviewTagEntry`, `SupplementaryCheck`, `ReviewProofConfig` interfaces; added `parseReviewProofMd()`, `parseMarkdownTableRows()`, `parseTagsTable()`, `parseSupplementaryChecksTable()` functions; added `reviewProofConfig` field to `ProjectConfig`; wired parser into `loadProjectConfig()`
- `adws/agents/regressionScenarioProof.ts`: Replaced hardcoded two-tag approach with config-driven `runScenarioProof()` loop; introduced `TagProofResult` and updated `ScenarioProofResult`; added optional-tag skip detection; updated `buildProofMarkdown()` to emit per-tag sections with severity headers
- `adws/agents/reviewRetry.ts`: Updated `ReviewRetryOptions` to use `reviewProofConfig: ReviewProofConfig` and `runByTagCommand`; updated `runReviewWithRetry()` to call `runScenarioProof()` with new signature; replaced `regressionPassed` check with `hasBlockerFailures`
- `adws/phases/workflowCompletion.ts`: Updated `executeReviewPhase()` to pass `reviewProofConfig` and `runByTagCommand` from project config
- `adws/agents/index.ts`: Added exports for `TagProofResult`, `runScenarioProof`; kept `ScenarioProofResult` and `shouldRunScenarioProof`
- `.adw/review_proof.md`: Rewritten from prose to structured markdown table format
- `.claude/commands/review.md`: Removed hardcoded severity classification rules; review agent now reads severity from proof file section headers

### Key Changes

- **Config-driven tag loop**: `runScenarioProof()` iterates any number of tags from `ReviewProofConfig.tags`, making tag selection fully configurable per target repository
- **Severity in proof output**: Each tag section header in `scenario_proof.md` embeds its severity (`## @review-proof Scenarios (severity: blocker)`), making the `/review` command self-sufficient without needing the original config
- **Three-tier strategy**: `@review-proof` replaces `@regression` as the review-time scoped suite; `@regression` is intentionally absent from the review config and reserved for periodic CI (GitHub Actions)
- **Graceful optional skip**: When `optional: true` tags find zero matching scenarios (empty output or `0 scenarios`), they are recorded as `skipped: true` — no failure, no noise
- **Backward compatibility via defaults**: `getDefaultReviewProofConfig()` preserves the prior behavior (`@regression` + `@adw-{issueNumber}`) for repos that haven't adopted the new format

## How to Use

### Configure which tags run during review

Edit `.adw/review_proof.md` in the target repository:

```markdown
# Review Proof Configuration

## Tags

| Tag | Severity | Optional |
|-----|----------|----------|
| @review-proof | blocker | no |
| @adw-{issueNumber} | blocker | yes |

## Supplementary Checks

| Name | Command | Severity |
|------|---------|----------|
| Type Check | bunx tsc --noEmit | blocker |
| Lint | bun run lint | blocker |
```

- **Tag**: BDD tag pattern; use `{issueNumber}` as a placeholder (substituted at runtime)
- **Severity**: `blocker` halts review on failure; `tech-debt` records the failure without blocking
- **Optional**: `yes` means gracefully skip when no matching scenarios exist; `no` means failure if no scenarios run

### Three-tier tag strategy

| Tier | Tag | When it runs | Failure effect |
|------|-----|-------------|----------------|
| Scoped review subset | `@review-proof` | Every review iteration | Blocker |
| Issue-specific | `@adw-{issueNumber}` | When scenarios exist for the issue | Blocker |
| Full regression | `@regression` | Periodic CI (GitHub Action) | N/A during review |

### Omitting `review_proof.md`

Repos without `.adw/review_proof.md` fall back to the default config: `@regression` (blocker) + `@adw-{issueNumber}` (blocker, optional) — identical to the pre-existing behavior.

## Configuration

No new environment variables required. Configuration is entirely driven by `.adw/review_proof.md`.

The `runByTagCommand` used to execute each tag comes from `.adw/commands.md` under `## Run Scenarios by Tag` (default: `cucumber-js --tags "@{tag}"`).

## Testing

BDD scenarios cover the feature end-to-end:

```bash
bunx cucumber-js --tags "@machine-readable-review-proof"
```

Key scenario categories in `features/machine_readable_review_proof.feature`:
- Parsing: valid table, empty file, missing `## Tags` section, malformed rows
- Tag execution: all pass, blocker failure, tech-debt failure, optional skip
- `{issueNumber}` substitution in tag patterns
- Backward compatibility with absent/empty config
- Proof markdown format with severity headers

## Notes

- `@regression` is intentionally **not** in ADW's own `review_proof.md` — it is reserved for a future periodic GitHub Action (out of scope for this issue)
- The `regressionScenarioProof.ts` filename was kept to minimize churn; the exported function was renamed from `runRegressionScenarioProof` to `runScenarioProof`
- The proof file's per-tag section headers (`## @tag Scenarios (severity: blocker)`) are the contract between the orchestrator output and the `/review` slash command — do not change this format without updating `review.md`
