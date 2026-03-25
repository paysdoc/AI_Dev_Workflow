# Feature: Wire proof data into structured issue comments

## Metadata
issueNumber: `276`
adwId: `ekd5o1-wire-proof-data-into`
issueJson: `{"number":276,"title":"Wire proof data into structured issue comments","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nFix the data drop where scenario proof results are generated but never surface in GitHub comments. Build a Proof Comment Formatter and wire it into the workflow completion layer.\n\n**Proof Comment Formatter** — New module that takes:\n- Scenario proof results (`@review-proof` pass/fail, `@adw-{issueNumber}` pass/fail, scenario counts)\n- Verification results (type-check, lint pass/fail)\n- Review summary text\n- Blocker and non-blocker issues\n- Optionally: screenshot URLs (for UI apps, wired in a later issue)\n\nAnd produces structured markdown for GitHub issue comments with:\n- Review status header (passed/failed)\n- Review summary\n- Scenario proof table (suite, status)\n- Verification section (type-check, lint)\n- Collapsible: non-blocker issues\n- Collapsible: blocker issues (on failure)\n- Collapsible: full scenario output\n\n**Wiring changes:**\n- `reviewRetry.ts`: pass `scenarioProof`, `allScreenshots`, `allSummaries` through to the completion layer (currently dropped)\n- `workflowCompletion.ts`: consume proof data from review result, build proof comment via formatter, post to issue\n- `workflowCommentsIssue.ts`: new `review_passed` / `review_failed` comment formats using the formatter output\n\nSee PRD sections: \"Proof Comment Formatter\", \"reviewRetry.ts Changes\", \"workflowCompletion.ts Changes\".\n\n## Acceptance criteria\n\n- [ ] Proof Comment Formatter module exists with a clean interface\n- [ ] Formatter produces correct markdown for passed review (summary, proof table, verification, non-blockers)\n- [ ] Formatter produces correct markdown for failed review (blockers, proof table, scenario output)\n- [ ] `reviewRetry.ts` passes proof data through to the completion layer\n- [ ] `workflowCompletion.ts` consumes proof data and posts structured comment to the issue\n- [ ] `workflowCommentsIssue.ts` uses new comment format for `review_passed` and `review_failed` stages\n- [ ] Scenario output is in a collapsible `<details>` section\n- [ ] Non-blocker issues are in a collapsible `<details>` section\n- [ ] Unit tests for Proof Comment Formatter (all variants: passed/failed, with/without non-blockers)\n\n## Blocked by\n\n- Blocked by #273 (machine-readable review_proof.md + tag-driven scenario execution)\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 3\n- User story 4","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:01:02Z","comments":[{"author":"paysdoc","createdAt":"2026-03-24T18:54:31Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
The review phase generates valuable scenario proof data — per-tag BDD results (`@review-proof`, `@adw-{issueNumber}`), verification results (type-check, lint), review summaries, and issue classifications — but this data is currently dropped at the boundary between `reviewRetry.ts` and `workflowCompletion.ts`. The `review_passed` and `review_failed` issue comments show only a basic summary and blocker list, with no proof table, verification status, or collapsible scenario output.

This feature creates a Proof Comment Formatter module that transforms structured proof data into rich markdown, then wires the data pipeline from `reviewRetry.ts` through `workflowCompletion.ts` into `workflowCommentsIssue.ts` so that every review comment includes the full proof evidence.

## User Story
As a developer reviewing ADW workflow results on a GitHub issue
I want to see structured proof data (scenario results, verification status, issue breakdown) in the review comment
So that I can quickly assess review quality without digging into log files or proof artifacts

## Problem Statement
The review retry loop (`reviewRetry.ts`) collects `scenarioProof`, `allScreenshots`, and `allSummaries` in its `ReviewRetryResult`, but `executeReviewPhase()` in `workflowCompletion.ts` only passes `reviewSummary` and `blockerIssues` to the `WorkflowContext`. The `review_passed` and `review_failed` comment formatters in `workflowCommentsIssue.ts` produce minimal comments with no proof table, no verification results, and no collapsible scenario output. This data drop means stakeholders must manually inspect proof artifacts to understand review outcomes.

## Solution Statement
1. Create a pure-function Proof Comment Formatter (`adws/github/proofCommentFormatter.ts`) that accepts `ScenarioProofResult`, `ReviewIssue[]`, review summary, and verification results and produces structured markdown sections.
2. Extend `WorkflowContext` with optional proof data fields (`scenarioProof`, `allSummaries`, `nonBlockerIssues`).
3. Update `executeReviewPhase()` in `workflowCompletion.ts` to pass proof data from `ReviewRetryResult` into the `WorkflowContext`.
4. Rewrite `formatReviewPassedComment()` and `formatReviewFailedComment()` in `workflowCommentsIssue.ts` to consume the formatter and render structured proof comments.

## Relevant Files
Use these files to implement the feature:

- `adws/github/workflowCommentsIssue.ts` — Contains `formatReviewPassedComment()` and `formatReviewFailedComment()` plus `WorkflowContext` interface. These formatters will be rewritten to use the proof comment formatter output.
- `adws/phases/workflowCompletion.ts` — Contains `executeReviewPhase()` which calls `runReviewWithRetry()` and posts `review_passed`/`review_failed` comments. Needs to pass proof data to `WorkflowContext`.
- `adws/agents/reviewRetry.ts` — Contains `ReviewRetryResult` with `scenarioProof`, `allScreenshots`, `allSummaries` fields. Data source — no changes needed here (data is already collected correctly).
- `adws/agents/regressionScenarioProof.ts` — Contains `ScenarioProofResult`, `TagProofResult` types. Read-only reference for the formatter interface.
- `adws/agents/reviewAgent.ts` — Contains `ReviewIssue` type. Read-only reference.
- `adws/core/projectConfig.ts` — Contains `ReviewProofConfig`, `SupplementaryCheck` types. Read-only reference for verification result interfaces.
- `adws/github/index.ts` — Module exports. Will need to export the new formatter.
- `adws/phases/phaseCommentHelpers.ts` — Posts stage comments via `postIssueStageComment()`. Read-only reference.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `.adw/review_proof.md` — Review proof configuration (reference for understanding the proof structure).
- `app_docs/feature-9k4ut2-machine-readable-review-proof.md` — Documentation for the machine-readable review proof (#273).

### New Files
- `adws/github/proofCommentFormatter.ts` — New Proof Comment Formatter module with pure formatting functions.
- `features/wire_proof_comment_formatter.feature` — BDD scenarios validating the proof comment output.
- `features/step_definitions/proofCommentFormatterSteps.ts` — Step definitions for the proof comment formatter BDD scenarios.

## Implementation Plan
### Phase 1: Foundation
Create the Proof Comment Formatter as a standalone, pure-function module with clear types. The formatter accepts structured data (scenario proof results, review issues, verification results, summary text) and returns markdown strings. No side effects, no I/O — just data transformation.

Define a `ProofCommentInput` interface that bundles all data the formatter needs, and a set of section-level formatting functions (`formatProofTable`, `formatVerificationSection`, `formatNonBlockerSection`, `formatBlockerSection`, `formatScenarioOutputSection`) that compose into full `formatReviewPassedComment` and `formatReviewFailedComment` outputs.

### Phase 2: Core Implementation
Wire proof data through the existing data pipeline:
1. Extend `WorkflowContext` in `workflowCommentsIssue.ts` with optional proof fields (`scenarioProof`, `allSummaries`, `nonBlockerIssues`).
2. Update `executeReviewPhase()` in `workflowCompletion.ts` to populate these fields from `ReviewRetryResult`.
3. Rewrite `formatReviewPassedComment()` and `formatReviewFailedComment()` in `workflowCommentsIssue.ts` to call the proof comment formatter when proof data is available, falling back to the current simple format when it is absent.

### Phase 3: Integration
Write BDD scenarios that validate the formatter output for all variants (passed/failed, with/without non-blockers, with/without scenario proof). Ensure backward compatibility — when no proof data is available (e.g., repos without `.adw/scenarios.md`), the existing comment format is preserved.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read all relevant files
- Read all files listed in the Relevant Files section to understand existing types, interfaces, and patterns.
- Pay special attention to `ScenarioProofResult`, `TagProofResult`, `ReviewIssue`, `WorkflowContext`, and `SupplementaryCheck` types.
- Read `app_docs/feature-9k4ut2-machine-readable-review-proof.md` for context on the proof system.

### Step 2: Create the Proof Comment Formatter module
- Create `adws/github/proofCommentFormatter.ts`.
- Define a `VerificationResult` interface with fields: `name: string`, `passed: boolean`, `command?: string`.
- Define a `ProofCommentInput` interface with fields:
  - `passed: boolean` — overall review outcome
  - `reviewSummary?: string` — summary text from review agents
  - `scenarioProof?: ScenarioProofResult` — scenario proof results (optional for backward compat)
  - `blockerIssues: ReviewIssue[]` — blocker issues
  - `nonBlockerIssues: ReviewIssue[]` — non-blocker issues (tech-debt, skippable)
  - `verificationResults?: VerificationResult[]` — type-check, lint results (optional, for future wiring)
  - `allSummaries?: string[]` — all review agent summaries
  - `screenshotUrls?: string[]` — optional screenshot URLs (placeholder for later issue)
- Implement `formatProofTable(tagResults: TagProofResult[]): string` — renders a markdown table with columns: Suite (resolved tag), Scenarios (count passed/total), Status (pass/fail/skipped emoji), Severity.
- Implement `formatVerificationSection(results: VerificationResult[]): string` — renders verification check status.
- Implement `formatNonBlockerSection(issues: ReviewIssue[]): string` — renders non-blockers in a collapsible `<details>` section.
- Implement `formatBlockerSection(issues: ReviewIssue[]): string` — renders blockers in a collapsible `<details>` section.
- Implement `formatScenarioOutputSection(tagResults: TagProofResult[]): string` — renders full scenario output per tag in a collapsible `<details>` section.
- Implement `formatReviewProofComment(input: ProofCommentInput): string` — composes all sections into a full review comment with:
  - Review status header (passed: `:white_check_mark: Review Passed`, failed: `:x: Review Failed`)
  - Review summary (if present)
  - Scenario proof table (if scenarioProof present)
  - Verification section (if verificationResults present)
  - Non-blocker issues collapsible (if any)
  - Blocker issues collapsible (if any, on failure)
  - Scenario output collapsible (if scenarioProof present)
- All functions must be pure — no side effects, no imports from `../core` or I/O modules.
- Export `ProofCommentInput`, `VerificationResult`, and `formatReviewProofComment`.

### Step 3: Export the formatter from the github module
- Update `adws/github/index.ts` to export from `proofCommentFormatter.ts`.

### Step 4: Extend WorkflowContext with proof data fields
- In `adws/github/workflowCommentsIssue.ts`, add optional fields to `WorkflowContext`:
  - `scenarioProof?: ScenarioProofResult` — import `ScenarioProofResult` from agents
  - `nonBlockerIssues?: ReviewIssue[]` — non-blocker issues for the proof formatter
  - `allSummaries?: string[]` — all review agent summaries
  - `allScreenshots?: string[]` — screenshot URLs from review iterations (passed through for future formatter use)

### Step 5: Update formatReviewPassedComment and formatReviewFailedComment
- In `adws/github/workflowCommentsIssue.ts`, rewrite `formatReviewPassedComment()`:
  - When `ctx.scenarioProof` is present, call `formatReviewProofComment()` with a `ProofCommentInput` built from context fields, then append the ADW ID and signature.
  - When `ctx.scenarioProof` is absent, keep the existing simple format for backward compatibility.
- Rewrite `formatReviewFailedComment()` with the same dual-path logic.
- Both formatters must preserve the `formatRunningTokenFooter` and `ADW_SIGNATURE` suffixes.

### Step 6: Wire proof data in executeReviewPhase
- In `adws/phases/workflowCompletion.ts`, after `runReviewWithRetry()` returns:
  - Set `ctx.scenarioProof = reviewResult.scenarioProof` (the `ScenarioProofResult` from the final iteration).
  - Set `ctx.allSummaries = reviewResult.allSummaries`.
  - Set `ctx.allScreenshots = reviewResult.allScreenshots` — pass screenshots through to the context for future formatter use (per issue wiring spec).
  - Compute `ctx.nonBlockerIssues` by filtering merged review issues for non-blocker severities. For passed reviews, this comes from `reviewResult.blockerIssues` (which is `[]`) plus any non-blocker issues. However, `ReviewRetryResult` only returns `blockerIssues` — non-blockers are not currently surfaced.
  - To surface non-blockers: the merged review results in `reviewRetry.ts` have `mergedIssues` which includes both blockers and non-blockers, but only `blockerIssues` are returned. Add `nonBlockerIssues` to `ReviewRetryResult`.
- Wire these fields in both the passed and failed code paths before calling `postIssueStageComment()`.

### Step 7: Add nonBlockerIssues to ReviewRetryResult
- In `adws/agents/reviewRetry.ts`, add `nonBlockerIssues: ReviewIssue[]` to the `ReviewRetryResult` interface.
- In `runReviewWithRetry()`, when the review passes, compute `nonBlockerIssues` from the merged results (filter `mergedIssues` for `issueSeverity !== 'blocker'`).
- In the early-exit path (blocker scenario proof failure) and the exhausted-retries path, also compute and return `nonBlockerIssues` (may be empty).
- Update the `MergedReviewResult` interface to include `nonBlockerIssues: ReviewIssue[]` and compute it in `mergeReviewResults()`.
- The BDD scenario for `ReviewRetryResult` must verify the `nonBlockerIssues` field is present alongside `scenarioProof`, `allScreenshots`, and `allSummaries`.

### Step 8: Write BDD scenarios for the Proof Comment Formatter
- Create `features/wire_proof_comment_formatter.feature` with scenarios tagged `@adw-276`:
  - Scenario: Passed review with scenario proof produces structured comment with proof table, summary, and non-blockers
  - Scenario: Failed review with blockers produces structured comment with blocker section and scenario output
  - Scenario: Review without scenario proof falls back to simple comment format
  - Scenario: Non-blocker issues appear in collapsible details section
  - Scenario: Scenario output appears in collapsible details section
  - Scenario: Skipped optional tags show skipped status in proof table
- Create `features/step_definitions/proofCommentFormatterSteps.ts` with step definitions that:
  - Import and call `formatReviewProofComment()` directly with test data
  - Assert the output contains expected markdown sections, tables, and `<details>` blocks
- Note: Module-level exports (Step 3) and existing formatting suffixes like `formatRunningTokenFooter`/`ADW_SIGNATURE` (Step 5) are implementation details that do not need dedicated BDD scenarios — they are validated by the TypeScript type-check and the existing integration test suite.

### Step 9: Run validation commands
- Run `bun run lint` to verify no lint errors.
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify no type errors.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-276"` to verify BDD scenarios pass.

## Testing Strategy
### Edge Cases
- Review with no scenario proof (repos without `.adw/scenarios.md`) — must fall back to existing simple comment format
- Review with all scenario tags skipped (all optional, no matching scenarios) — proof table should show skipped entries, no blocker failures
- Review with empty `allSummaries` — summary section should be omitted
- Review with zero non-blocker issues — non-blocker `<details>` section should be omitted
- Review with zero blocker issues on failure path (edge case: scenario proof blocker) — blocker section should still render the scenario proof failure
- Very long scenario output — should be handled gracefully (output is already truncated by `regressionScenarioProof.ts` at 10,000 chars)
- `verificationResults` not provided — verification section should be omitted (placeholder for future wiring)

## Acceptance Criteria
- Proof Comment Formatter module exists at `adws/github/proofCommentFormatter.ts` with a clean, typed interface
- Formatter produces correct markdown for passed review: status header, summary, proof table, verification (when present), collapsible non-blockers
- Formatter produces correct markdown for failed review: status header, blockers, proof table, collapsible scenario output, collapsible blocker details
- `reviewRetry.ts` returns `nonBlockerIssues` in `ReviewRetryResult`
- `workflowCompletion.ts` populates `WorkflowContext` with `scenarioProof`, `allSummaries`, and `nonBlockerIssues` from the review result
- `workflowCommentsIssue.ts` uses `formatReviewProofComment()` for `review_passed` and `review_failed` when proof data is available, falls back to simple format otherwise
- Scenario output is in a collapsible `<details>` section
- Non-blocker issues are in a collapsible `<details>` section
- Blocker issues are in a collapsible `<details>` section (on failure)
- BDD scenarios validate all formatter variants
- Zero type errors (`bunx tsc --noEmit`)
- Zero lint errors (`bun run lint`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws project
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-276"` — Run BDD scenarios for this issue
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` — Run review proof regression scenarios to verify no regressions

## Notes
- The `verificationResults` field in `ProofCommentInput` is a placeholder for future wiring. Supplementary checks (`SupplementaryCheck[]`) are defined in `ReviewProofConfig` but are not yet executed by `runScenarioProof()`. A future issue should run supplementary checks and feed results into the formatter.
- Screenshot URLs (`screenshotUrls`) in `ProofCommentInput` are also a placeholder, per the issue description ("wired in a later issue").
- The `.adw/project.md` has `## Unit Tests: disabled`, so this plan uses BDD scenarios instead of Vitest unit tests for validation. The issue's acceptance criterion for unit tests is addressed via BDD scenarios that directly test the pure formatter functions.
- The formatter module (`proofCommentFormatter.ts`) should have zero side effects and import only type definitions from other modules — this makes it easy to test directly in BDD step definitions.
- Follow `guidelines/coding_guidelines.md`: pure functions, no mutation, explicit types, files under 300 lines.
- `reviewRetry.ts` already collects all the needed data (`scenarioProof`, `allScreenshots`, `allSummaries`). The only new field needed is `nonBlockerIssues` — the rest is a wiring exercise.
