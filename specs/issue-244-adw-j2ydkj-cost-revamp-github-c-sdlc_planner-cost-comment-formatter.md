# Feature: Cost Comment Formatter with Divergence Warning and Env Var Toggle

## Metadata
issueNumber: `244`
adwId: `j2ydkj-cost-revamp-github-c`
issueJson: `{"number":244,"title":"Cost revamp: GitHub comment formatting, divergence warning, and env var toggle","body":"## Parent PRD\n\nSee `specs/prd-cost-module-revamp.md` on the `dev` branch.\n\n## What to build\n\nCreate the comment formatter that presents cost data in GitHub issue comments with divergence warnings and an env var toggle.\n\n- Create `adws/cost/reporting/commentFormatter.ts` — formats cost table using locally computed cost (source of truth), per-model token breakdown, multi-currency totals\n- Divergence warning: when locally computed cost diverges from CLI-reported cost by >5%, include a visible warning in the comment\n- Estimate-vs-actual: show the difference between estimated and actual token counts at phase completion (absolute numbers and percentage) in the comment\n- Single environment variable (e.g., `SHOW_COST_IN_COMMENTS`) toggles ALL cost-related content in GitHub comments on or off\n- Cost data is always written to CSV regardless of the env var setting\n- Update phase comment helpers and workflow comment formatters to use the new comment formatter\n\nRefer to the parent PRD's \"Divergence checking\", \"Environment variable\", and \"Estimate-vs-actual reporting\" sections.\n\n## Acceptance criteria\n\n- [ ] `adws/cost/reporting/commentFormatter.ts` formats cost breakdown as markdown table with per-model rows\n- [ ] Divergence warning appears in comment when computed vs reported cost differs by >5%\n- [ ] Estimate-vs-actual shown at phase completion in comments (numbers + percentage)\n- [ ] Env var toggles all cost content in comments on/off\n- [ ] Cost CSV output unaffected by the env var\n- [ ] Phase comment helpers updated to use new formatter\n- [ ] Unit tests cover: comment formatting output, divergence warning inclusion/exclusion at boundary, env var toggle behavior\n- [ ] All existing type checks still pass\n\n## Blocked by\n\n- Blocked by #243\n\n## User stories addressed\n\n- User story 4: divergence warning at 5% threshold\n- User story 5: warning visible in GitHub comment\n- User story 6: env var to toggle cost in comments\n- User story 2: estimate-vs-actual in comments","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-19T10:38:03Z","comments":[{"author":"paysdoc","createdAt":"2026-03-21T21:12:58Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Create a new cost comment formatter (`adws/cost/reporting/commentFormatter.ts`) that renders `PhaseCostRecord[]` data as rich markdown tables for GitHub issue and PR comments. The formatter produces per-model token breakdowns, multi-currency totals, divergence warnings when locally computed cost differs from CLI-reported cost by >5%, and estimate-vs-actual token comparison at phase completion. A single environment variable `SHOW_COST_IN_COMMENTS` toggles all cost-related content in comments on or off without affecting CSV output. The existing workflow comment formatters and phase comment helpers are updated to use the new formatter, replacing the legacy `formatCostBreakdownMarkdown()` usage.

## User Story
As a developer using ADW
I want to see detailed cost breakdowns with divergence warnings in GitHub comments, with the ability to toggle cost visibility via an environment variable
So that I can monitor token usage and cost accuracy in real-time while controlling comment verbosity

## Problem Statement
The current cost comment formatting uses the legacy `formatCostBreakdownMarkdown()` function which operates on the old `CostBreakdown` type. It lacks divergence warnings (computed vs reported cost), estimate-vs-actual token comparison, and there is no way to toggle cost content in comments on or off. The new `PhaseCostRecord` data model introduced in earlier cost revamp issues provides richer data (per-phase, per-model records with estimated/actual tokens, computed/reported costs) that needs a corresponding comment formatter.

## Solution Statement
Create `adws/cost/reporting/commentFormatter.ts` that:
1. Accepts `PhaseCostRecord[]` and formats a markdown table with per-model rows showing token breakdown and cost
2. Uses `checkDivergence()` from `adws/cost/computation.ts` to detect >5% divergence and renders a visible warning block
3. Compares `estimatedTokens` vs `actualTokens` fields to show estimate-vs-actual differences with absolute numbers and percentages
4. Reads `SHOW_COST_IN_COMMENTS` env var to conditionally return empty string when disabled
5. Integrates with `fetchExchangeRates()` for multi-currency totals
6. Is called from `workflowCommentsIssue.ts` and `workflowCommentsPR.ts` completion/error formatters, replacing legacy `formatCostBreakdownMarkdown()` calls
7. `workflowCompletion.ts` and `prReviewCompletion.ts` are updated to build cost sections using `PhaseCostRecord[]` data

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow strictly
- `specs/prd-cost-module-revamp.md` — Parent PRD with "Divergence checking", "Environment variable", and "Estimate-vs-actual reporting" sections
- `adws/cost/types.ts` — `PhaseCostRecord`, `DivergenceResult`, `TokenUsageMap`, `PhaseCostStatus` types
- `adws/cost/computation.ts` — `computeCost()` and `checkDivergence()` functions to reuse
- `adws/cost/exchangeRates.ts` — `fetchExchangeRates()`, `CURRENCY_SYMBOLS` for multi-currency totals
- `adws/cost/reporting/csvWriter.ts` — Existing CSV writer patterns, `collectAllTokenTypes()`, `FIXED_TOKEN_COLUMNS` for consistent token column ordering
- `adws/cost/reporting/index.ts` — Barrel exports to update
- `adws/cost/index.ts` — Top-level barrel exports to update
- `adws/core/config.ts` — Add `SHOW_COST_IN_COMMENTS` env var constant alongside existing env var pattern
- `adws/core/index.ts` — Core barrel exports (currently exports legacy `formatCostBreakdownMarkdown`)
- `adws/core/costReport.ts` — Legacy `formatCostBreakdownMarkdown()` to understand the output format being replaced
- `adws/core/workflowCommentParsing.ts` — `formatRunningTokenFooter()` pattern and `formatModelName()` utility
- `adws/github/workflowCommentsIssue.ts` — `formatCostSection()` and `formatCompletedComment()` / `formatErrorComment()` to update
- `adws/github/workflowCommentsPR.ts` — `pr_review_completed` and `pr_review_error` cases to update
- `adws/phases/workflowCompletion.ts` — `completeWorkflow()` where `costBreakdown` is built from `ModelUsageMap`
- `adws/phases/prReviewCompletion.ts` — `completePRReviewWorkflow()` where `costBreakdown` is built
- `adws/phases/phaseCommentHelpers.ts` — Phase comment posting helpers (may need cost-aware overloads)
- `adws/phases/phaseCostCommit.ts` — `commitPhaseCostData()` pattern for reference on how PhaseCostRecord flows
- `adws/types/costTypes.ts` — Legacy `CostBreakdown`, `ModelUsageMap`, `ModelUsage` types
- `.env.sample` — Add `SHOW_COST_IN_COMMENTS` documentation
- `app_docs/feature-ku956a-cost-revamp-core-com-cost-module-core-vitest.md` — Architecture doc for cost module core
- `app_docs/feature-h01a4p-cost-revamp-phasecos-phase-cost-record-csv.md` — Architecture doc for PhaseCostRecord CSV
- `app_docs/feature-tgs1li-cost-revamp-wire-ext-wire-extractor-agent-handler.md` — Architecture doc for extractor/estimate-vs-actual

### New Files
- `adws/cost/reporting/commentFormatter.ts` — New comment formatter module

## Implementation Plan

### Phase 1: Foundation
1. Add the `SHOW_COST_IN_COMMENTS` env var constant to `adws/core/config.ts` following the existing env var pattern (boolean, default `false`).
2. Add `SHOW_COST_IN_COMMENTS` to `.env.sample` with documentation.
3. Create `adws/cost/reporting/commentFormatter.ts` with the core formatting functions:
   - `formatCostCommentSection(records, currencies)` — main entry point that checks `SHOW_COST_IN_COMMENTS` and returns the full markdown section or empty string
   - `formatCostTable(records)` — renders the per-model markdown table with token columns and cost
   - `formatDivergenceWarning(records)` — checks each record for >5% divergence using `checkDivergence()` and renders a warning blockquote
   - `formatEstimateVsActual(records)` — compares `estimatedTokens` vs `actualTokens` per record, showing delta and percentage
   - `formatCurrencyTotals(totalUsd, rates)` — renders multi-currency total lines

### Phase 2: Core Implementation
1. Implement the formatting functions following the existing table format from `formatCostBreakdownMarkdown()` but working with `PhaseCostRecord[]`:
   - Each row shows: Phase, Model, per-token-type columns (input, output, cache_read, cache_write, etc.), Computed Cost (USD)
   - Totals row at the bottom
   - Multi-currency totals using `fetchExchangeRates()`
2. Implement the divergence warning:
   - Iterate records, call `checkDivergence(record.computedCostUsd, record.reportedCostUsd)` for each
   - If any divergence found, render a `> :warning: **Cost Divergence Detected**` blockquote listing the divergent phases/models with computed vs reported values and percentage diff
3. Implement estimate-vs-actual formatting:
   - For records where both `estimatedTokens` and `actualTokens` are populated, show a comparison section
   - Per token type: estimated, actual, delta (absolute), delta (percentage)
4. Wrap everything in `formatCostCommentSection()` which:
   - Returns empty string when `SHOW_COST_IN_COMMENTS` is falsy
   - Returns the cost table wrapped in a `<details>` block otherwise

### Phase 3: Integration
1. Update `WorkflowContext` in `workflowCommentsIssue.ts` to accept `PhaseCostRecord[]` alongside (or replacing) the legacy `costBreakdown` field.
2. Update `formatCostSection()` in `workflowCommentsIssue.ts` to call the new `formatCostCommentSection()` instead of `formatCostBreakdownMarkdown()`.
3. Update `workflowCommentsPR.ts` to use the new formatter for `pr_review_completed` and `pr_review_error` stages.
4. Update `workflowCompletion.ts` (`completeWorkflow()`) to pass accumulated `PhaseCostRecord[]` to the context instead of building the legacy `CostBreakdown`.
5. Update `prReviewCompletion.ts` (`completePRReviewWorkflow()`) similarly.
6. Update barrel exports in `adws/cost/reporting/index.ts` and `adws/cost/index.ts`.
7. Ensure CSV writing paths are completely unaffected by `SHOW_COST_IN_COMMENTS`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read foundational files
- Read `guidelines/coding_guidelines.md` for coding standards
- Read `specs/prd-cost-module-revamp.md` for the full PRD context, especially "Divergence checking", "Environment variable", and "Estimate-vs-actual reporting" sections
- Read `app_docs/feature-ku956a-cost-revamp-core-com-cost-module-core-vitest.md` for cost module architecture
- Read `app_docs/feature-h01a4p-cost-revamp-phasecos-phase-cost-record-csv.md` for PhaseCostRecord architecture
- Read `app_docs/feature-tgs1li-cost-revamp-wire-ext-wire-extractor-agent-handler.md` for extractor/estimate-vs-actual architecture

### Step 2: Add `SHOW_COST_IN_COMMENTS` env var
- Add `SHOW_COST_IN_COMMENTS` constant to `adws/core/config.ts` following the existing boolean env var pattern (like `RUNNING_TOKENS`):
  ```typescript
  /** Whether to include cost breakdowns in GitHub issue/PR comments. */
  export const SHOW_COST_IN_COMMENTS = Boolean(process.env.SHOW_COST_IN_COMMENTS);
  ```
- Add documentation entry to `.env.sample`:
  ```
  # Optional - show cost breakdowns in GitHub issue/PR comments (default: false)
  # SHOW_COST_IN_COMMENTS=true
  ```

### Step 3: Create `adws/cost/reporting/commentFormatter.ts`
- Create the new file with the following exports:
  - `formatCostCommentSection(records: readonly PhaseCostRecord[], currencies?: string[]): Promise<string>` — main entry point. Returns empty string when `SHOW_COST_IN_COMMENTS` is falsy. Otherwise fetches exchange rates, formats the table, divergence warnings, estimate-vs-actual, and currency totals, wrapped in a `<details>` block.
  - `formatCostTable(records: readonly PhaseCostRecord[]): string` — renders a markdown table with columns: Phase, Model, and dynamic token type columns (using `collectAllTokenTypes()`), plus Computed Cost (USD). Includes a totals row.
  - `formatDivergenceWarning(records: readonly PhaseCostRecord[]): string` — iterates records, calls `checkDivergence()` on each. If any are divergent (>5%), returns a blockquote warning with details. Returns empty string if no divergence.
  - `formatEstimateVsActual(records: readonly PhaseCostRecord[]): string` — for records with both `estimatedTokens` and `actualTokens`, renders a comparison table showing estimated, actual, absolute delta, and percentage delta per token type. Returns empty string if no estimate data available.
  - `formatCurrencyTotals(totalUsd: number, rates: Record<string, number>): string` — renders multi-currency total lines using `CURRENCY_SYMBOLS`.
- Import `SHOW_COST_IN_COMMENTS` from `../../core/config.ts`
- Import `checkDivergence` from `../computation.ts`
- Import `collectAllTokenTypes` from `./csvWriter.ts`
- Import `fetchExchangeRates`, `CURRENCY_SYMBOLS` from `../exchangeRates.ts`
- Import `COST_REPORT_CURRENCIES` from `../../core/config.ts`
- Follow the formatting style of `formatCostBreakdownMarkdown()` for markdown table output

### Step 4: Update barrel exports
- Add exports from `commentFormatter.ts` to `adws/cost/reporting/index.ts`
- Add re-exports to `adws/cost/index.ts`

### Step 5: Add `phaseCostRecords` to `WorkflowContext`
- In `adws/github/workflowCommentsIssue.ts`, add `phaseCostRecords?: PhaseCostRecord[]` to the `WorkflowContext` interface
- Import `PhaseCostRecord` from `../../cost/types.ts`

### Step 6: Update `formatCostSection()` in `workflowCommentsIssue.ts`
- Update `formatCostSection()` to use the new `formatCostCommentSection()`:
  - If `ctx.phaseCostRecords` is available and non-empty, call `formatCostCommentSection(ctx.phaseCostRecords)`
  - Fall back to legacy `formatCostBreakdownMarkdown(ctx.costBreakdown)` when only `costBreakdown` is available (backward compatibility during transition)
  - The new formatter already handles the `SHOW_COST_IN_COMMENTS` check internally
- Since `formatCostCommentSection` is async (fetches exchange rates), update `formatCostSection` to be async and update its callers (`formatCompletedComment`, `formatErrorComment`) accordingly
- Update `formatWorkflowComment()` to handle the async nature — make it async and update callers

### Step 7: Update `workflowCommentsPR.ts`
- Update the `pr_review_completed` and `pr_review_error` cases to use `formatCostCommentSection()` when `ctx.phaseCostRecords` is available
- Fall back to legacy formatting for backward compatibility
- Handle async nature similarly to step 6

### Step 8: Update `workflowCompletion.ts` to populate `phaseCostRecords`
- In `completeWorkflow()`, accept an optional `phaseCostRecords: PhaseCostRecord[]` parameter
- Set `ctx.phaseCostRecords = phaseCostRecords` before posting the completion comment
- Keep the legacy `costBreakdown` population for backward compatibility during transition

### Step 9: Update `prReviewCompletion.ts` to populate `phaseCostRecords`
- In `completePRReviewWorkflow()`, collect `PhaseCostRecord[]` from the review phase and pass them to the context
- Set `ctx.phaseCostRecords` before posting the completion comment

### Step 10: Update `phaseCommentHelpers.ts`
- Since `formatWorkflowComment` and `formatPRReviewWorkflowComment` become async (due to exchange rate fetching), update `postIssueStageComment` and `postPRStageComment` to handle async formatting
- Make these functions async and await the comment formatting

### Step 11: Update all callers of `postIssueStageComment` and `postPRStageComment`
- Search for all call sites across `adws/phases/` and update them to await the async helpers
- Key files: `workflowCompletion.ts`, `prReviewCompletion.ts`, plus any phase files that call these helpers
- Note: Only the `completed`, `error`, `pr_review_completed`, and `pr_review_error` stages actually need async formatting (they include cost sections). All other stages return synchronous content. Consider making only the cost-relevant paths async to minimize blast radius.

### Step 12: Update core barrel exports
- In `adws/core/index.ts`, export `SHOW_COST_IN_COMMENTS` from config

### Step 13: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no type errors in root config
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify no type errors in adws
- Run `bun run build` to verify no build errors

## Testing Strategy

### Edge Cases
- `SHOW_COST_IN_COMMENTS` is unset (default `false`) — cost sections should be empty strings
- `SHOW_COST_IN_COMMENTS=true` with empty `PhaseCostRecord[]` — should return empty or minimal section
- Divergence at exactly 5% boundary — should NOT trigger warning (>5% required, per `checkDivergence` implementation)
- Divergence at 5.01% — should trigger warning
- `reportedCostUsd` is `undefined` — divergence check returns `isDivergent: false`, no warning
- Both `computedCostUsd` and `reportedCostUsd` are 0 — no divergence
- `estimatedTokens` and/or `actualTokens` are `undefined` — skip estimate-vs-actual section
- Multiple models with different divergence states — warning should list only divergent ones
- Exchange rate fetch failure — should fall back to cached/fallback rates gracefully
- Very large token counts — should render with proper thousands separators

## Acceptance Criteria
- `adws/cost/reporting/commentFormatter.ts` formats cost breakdown as a markdown table with per-model rows, dynamic token type columns, and cost totals
- Divergence warning blockquote appears in comment when computed vs reported cost differs by >5% for any record
- Estimate-vs-actual section shown at phase completion when estimated and actual token data is available, with absolute and percentage deltas
- `SHOW_COST_IN_COMMENTS` env var toggles all cost-related content in GitHub issue/PR comments on or off
- Cost CSV output in `adws/cost/reporting/csvWriter.ts` and `adws/phases/phaseCostCommit.ts` is completely unaffected by the env var
- Phase comment helpers (`postIssueStageComment`, `postPRStageComment`) and workflow comment formatters (`formatWorkflowComment`, `formatPRReviewWorkflowComment`) use the new formatter for completion/error stages
- All existing type checks pass (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`)
- Lint passes (`bun run lint`)
- Build succeeds (`bun run build`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root TypeScript config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws TypeScript config
- `bun run build` — Build the application to verify no build errors

## Notes
- **Coding guidelines**: Strictly follow `guidelines/coding_guidelines.md` — pure functions, immutable data, no `any` types, strict mode, declarative style.
- **Async consideration**: The main `formatCostCommentSection` is async because it calls `fetchExchangeRates()`. To minimize the async blast radius, consider making only the completion/error comment formatters async rather than every stage formatter. Alternatively, accept pre-fetched rates as a parameter to keep the formatter pure and synchronous, fetching rates at the call site.
- **Backward compatibility**: During transition, keep the legacy `costBreakdown` field on `WorkflowContext` and fall back to `formatCostBreakdownMarkdown()` when `phaseCostRecords` is not populated. Orchestrators that haven't been updated to pass `PhaseCostRecord[]` will continue to work with the old format.
- **No new libraries needed**: All formatting uses standard markdown table syntax and existing utilities.
- **Files under 300 lines**: `commentFormatter.ts` should stay well under 300 lines. If the formatting functions grow large, consider splitting the divergence warning and estimate-vs-actual formatting into separate helper functions within the same file.
