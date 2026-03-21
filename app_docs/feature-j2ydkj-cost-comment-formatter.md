# Cost Comment Formatter

**ADW ID:** j2ydkj-cost-revamp-github-c
**Date:** 2026-03-22
**Specification:** specs/issue-244-adw-j2ydkj-cost-revamp-github-c-sdlc_planner-cost-comment-formatter.md

## Overview

Adds a new `adws/cost/reporting/commentFormatter.ts` module that renders `PhaseCostRecord[]` data as rich markdown tables in GitHub issue and PR comments. The formatter includes per-model token breakdowns, multi-currency cost totals, a divergence warning when computed cost diverges from CLI-reported cost by >5%, and an estimate-vs-actual token comparison table. A single env var (`SHOW_COST_IN_COMMENTS`) toggles all cost content in comments on or off without affecting CSV output.

## What Was Built

- `adws/cost/reporting/commentFormatter.ts` — new formatter module with five exported functions
- `SHOW_COST_IN_COMMENTS` env var constant added to `adws/core/config.ts` and documented in `.env.sample`
- `WorkflowContext` extended with `phaseCostRecords` and `costSection` fields for pre-computed cost sections
- `formatCostSection()` in `workflowCommentsIssue.ts` updated to prefer `ctx.costSection` over the legacy `costBreakdown` path
- `workflowCommentsPR.ts` refactored to use the shared `formatCostSection()` helper (removes duplicate inline cost-section logic)
- `workflowCompletion.ts` updated to accept `phaseCostRecords?: PhaseCostRecord[]` and pre-compute `ctx.costSection`
- `prReviewCompletion.ts` refactored into a `buildPRReviewCostSection()` helper that also pre-computes `ctx.costSection`
- Barrel exports updated in `adws/cost/reporting/index.ts` and `adws/cost/index.ts`
- `adws/core/index.ts` exports `SHOW_COST_IN_COMMENTS`
- BDD feature file and step definitions added for full coverage

## Technical Implementation

### Files Modified

- `adws/cost/reporting/commentFormatter.ts`: New file — `formatCostTable`, `formatDivergenceWarning`, `formatEstimateVsActual`, `formatCurrencyTotals`, `formatCostCommentSection` (async, fetches exchange rates)
- `adws/cost/reporting/index.ts`: Added exports for the new formatter functions
- `adws/cost/index.ts`: Re-exports from `reporting/` barrel
- `adws/core/config.ts`: Added `SHOW_COST_IN_COMMENTS` boolean constant
- `adws/core/index.ts`: Exports `SHOW_COST_IN_COMMENTS`; removed legacy `formatCostBreakdownMarkdown` export
- `adws/github/workflowCommentsIssue.ts`: Added `phaseCostRecords` and `costSection` to `WorkflowContext`; made `formatCostSection` exported; updated it to prefer `ctx.costSection`
- `adws/github/workflowCommentsPR.ts`: Replaced duplicated inline cost-section blocks with shared `formatCostSection()` call
- `adws/phases/workflowCompletion.ts`: Added `phaseCostRecords?` param; pre-computes `ctx.costSection` via new formatter
- `adws/phases/prReviewCompletion.ts`: Extracted `buildPRReviewCostSection()` helper; adds CSV writing and pre-computes `ctx.costSection`
- `.env.sample`: Documents the `SHOW_COST_IN_COMMENTS` variable
- `features/cost_comment_formatter.feature`: BDD scenarios for the formatter
- `features/step_definitions/costCommentFormatterSteps.ts`: Step definitions for the feature

### Key Changes

- **Pre-computation pattern**: `ctx.costSection` is set to the final string _before_ `formatWorkflowComment` is called. `formatCostSection()` returns it as-is (including empty string when the env var is off), eliminating any async propagation up the comment-building call chain.
- **Backward compatibility**: `formatCostSection()` falls back to legacy `formatCostBreakdownMarkdown(ctx.costBreakdown)` when `ctx.costSection` is `undefined`, keeping orchestrators that haven't been updated working as before.
- **Divergence warning**: uses `checkDivergence(record.computedCostUsd, record.reportedCostUsd)` from `adws/cost/computation.ts`; threshold is >5% (boundary at exactly 5% does NOT trigger the warning).
- **Token columns are dynamic**: `collectAllTokenTypes()` from `csvWriter.ts` determines the column set, matching CSV output.
- **Env var default is `false`**: cost sections are hidden unless `SHOW_COST_IN_COMMENTS=true` is set, so existing deployments see no change without opting in.

## How to Use

1. Set `SHOW_COST_IN_COMMENTS=true` in your `.env` file (or leave unset to hide cost sections).
2. Cost data continues to be written to CSV files regardless of the env var.
3. When a workflow completes, `completePRReviewWorkflow` / `completeWorkflow` will automatically build the cost section and attach it to the GitHub comment as a collapsible `<details>` block.
4. If you call `formatCostCommentSection` directly, pass a `PhaseCostRecord[]` array (and optionally a list of currency codes beyond USD):
   ```typescript
   import { formatCostCommentSection } from 'adws/cost/reporting/commentFormatter';
   const section = await formatCostCommentSection(phaseCostRecords, ['USD', 'EUR']);
   ```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `SHOW_COST_IN_COMMENTS` | `false` | Set to `true` to include cost breakdown tables in GitHub issue and PR comments |
| `COST_REPORT_CURRENCIES` | `['USD']` | Currencies rendered in the totals line (existing config constant) |

## Testing

Run the BDD scenarios:

```sh
bunx cucumber-js --tags @cost-comment-formatter
```

Key scenarios covered:
- Env var off → empty string returned
- Env var on, empty records → empty string
- Divergence at exactly 5% → no warning
- Divergence at 5.01% → warning block rendered
- `reportedCostUsd` undefined → no warning
- Estimate-vs-actual missing → section omitted
- Multiple models, mixed divergence → only divergent models listed

## Notes

- `formatCostCommentSection` is async because it calls `fetchExchangeRates()`. The async boundary is absorbed at the call site in `buildPRReviewCostSection` and `completeWorkflow`, so `formatWorkflowComment` and `formatPRReviewWorkflowComment` remain synchronous.
- The legacy `formatCostBreakdownMarkdown` path in `formatCostSection` will be removed once all orchestrators pass `PhaseCostRecord[]` through `completeWorkflow`.
- `commentFormatter.ts` is 150 lines — well within the 300-line guideline.
