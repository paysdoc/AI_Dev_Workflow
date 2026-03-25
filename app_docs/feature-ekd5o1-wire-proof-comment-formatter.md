# Proof Comment Formatter

**ADW ID:** `ekd5o1-wire-proof-data-into`
**Date:** 2026-03-24
**Specification:** `specs/issue-276-adw-ekd5o1-wire-proof-data-into-sdlc_planner-proof-comment-formatter.md`

## Overview

This feature closes a data drop in the review phase: scenario proof results (`@review-proof`, `@adw-{issueNumber}` pass/fail), non-blocker issues, and review summaries were collected by `reviewRetry.ts` but never surfaced in GitHub issue comments. A new pure-function `proofCommentFormatter.ts` module transforms structured proof data into rich markdown, and the data pipeline from `reviewRetry.ts` through `workflowCompletion.ts` into `workflowCommentsIssue.ts` is wired end-to-end so every `review_passed` / `review_failed` comment includes the full proof evidence.

## What Was Built

- **`adws/github/proofCommentFormatter.ts`** — New pure-function module with typed interfaces (`ProofCommentInput`, `VerificationResult`) and composable section formatters.
- **`nonBlockerIssues` field in `ReviewRetryResult` and `MergedReviewResult`** — Non-blocker issues are now surfaced alongside blocker issues in the review result.
- **Wiring in `workflowCompletion.ts`** — `executeReviewPhase()` now populates `WorkflowContext` with `scenarioProof`, `allSummaries`, `allScreenshots`, and `nonBlockerIssues` from the review result.
- **Extended `WorkflowContext`** — Four new optional fields carry proof data through the comment-generation layer.
- **Dual-path comment formatters** — `formatReviewPassedComment()` and `formatReviewFailedComment()` use the proof formatter when `scenarioProof` is present, falling back to the existing simple format for repos without `.adw/scenarios.md`.
- **`reviewProofConfig` replaces `runRegressionCommand`** in `ReviewRetryOptions` — passes the full parsed config to `runScenarioProof()`.
- **BDD scenarios** — `features/wire_proof_comment_formatter.feature` and `features/step_definitions/proofCommentFormatterSteps.ts` validate all formatter variants.

## Technical Implementation

### Files Modified

- `adws/github/proofCommentFormatter.ts` *(new)* — Pure formatting functions: `formatProofTable`, `formatVerificationSection`, `formatNonBlockerSection`, `formatBlockerSection`, `formatScenarioOutputSection`, and the top-level `formatReviewProofComment` composer.
- `adws/github/workflowCommentsIssue.ts` — Added `scenarioProof`, `nonBlockerIssues`, `allSummaries`, `allScreenshots` to `WorkflowContext`; rewritten `formatReviewPassedComment` and `formatReviewFailedComment` with proof-aware dual-path logic.
- `adws/phases/workflowCompletion.ts` — `executeReviewPhase()` populates all four new context fields after `runReviewWithRetry()` returns, for both passed and failed paths; `runRegressionCommand` replaced by `reviewProofConfig`.
- `adws/agents/reviewRetry.ts` — Added `nonBlockerIssues: ReviewIssue[]` to `MergedReviewResult` and `ReviewRetryResult`; computed in `mergeReviewResults()` and returned on all exit paths; replaced `runRegressionCommand` option with `reviewProofConfig`; updated `runRegressionScenarioProof` import to `runScenarioProof`.
- `adws/github/index.ts` — Re-exports `proofCommentFormatter.ts` public surface.
- `features/wire_proof_comment_formatter.feature` *(new)* — BDD scenarios tagged `@adw-276`.
- `features/step_definitions/proofCommentFormatterSteps.ts` *(new)* — Step definitions calling `formatReviewProofComment()` directly with test data.

### Key Changes

- **Pure formatter module** — `proofCommentFormatter.ts` imports only type definitions from sibling modules; zero side effects and no I/O, making it directly testable in BDD step definitions.
- **Backward compatibility** — Both comment formatters check for `ctx.scenarioProof` before using the proof formatter. When absent (repo has no `.adw/scenarios.md`), the existing simple comment format is preserved.
- **Non-blocker extraction** — `mergeReviewResults()` now filters `mergedIssues` into `blockerIssues` (`issueSeverity === 'blocker'`) and `nonBlockerIssues` (all other severities), and both are propagated through `ReviewRetryResult` to `WorkflowContext`.
- **Collapsible sections** — Non-blocker issues, blocker details, and full scenario output each render inside a `<details>` HTML block in the GitHub comment.
- **Footer preservation** — Both comment formatters append `ADW ID`, `formatRunningTokenFooter`, and `ADW_SIGNATURE` after the proof comment body.

## How to Use

The formatter activates automatically when the review phase runs in a repo with `.adw/scenarios.md`. No configuration is required.

1. Run a review workflow against a repo that has `.adw/scenarios.md` and `.adw/review_proof.md` configured.
2. After the review phase completes, open the GitHub issue — the `review_passed` or `review_failed` comment will contain:
   - A status header (`:white_check_mark: Review Passed` or `:x: Review Failed`)
   - The review summary text (if present)
   - A proof table showing each BDD tag suite, scenario pass/total counts, status emoji, and severity
   - A collapsible non-blocker issues section (when non-blockers exist)
   - A collapsible blocker issues section (on failure, when blockers exist)
   - A collapsible full scenario output section (on failure)
3. For repos without `.adw/scenarios.md`, the comment falls back to the previous simple format.

## Configuration

No additional configuration is required. The formatter is driven by existing `.adw/review_proof.md` and `.adw/scenarios.md` files.

**Placeholder fields** (not yet wired):
- `verificationResults` in `ProofCommentInput` — reserved for future supplementary check results (type-check, lint). Section is omitted when not provided.
- `screenshotUrls` in `ProofCommentInput` — reserved for a future issue that wires R2 screenshot URLs into comments.

## Testing

Run the BDD scenarios for this feature:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-276"
```

Run review proof regression scenarios to verify no regressions:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"
```

Type-check:

```sh
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- `verificationResults` (type-check, lint) is a defined but unwired field. `SupplementaryCheck[]` entries in `ReviewProofConfig` are not yet executed by `runScenarioProof()` — a future issue should run them and feed results into the formatter.
- Screenshot URLs (`screenshotUrls`) are similarly a placeholder per the issue description ("wired in a later issue").
- The formatter module has no imports from `../core` or any I/O module — this keeps it side-effect-free and directly callable from BDD step definitions without a test harness.
