# Running Token Totals in Issue/PR Comments

**ADW ID:** 1773328453611-p5xexp
**Date:** 2026-03-12
**Specification:** specs/issue-144-adw-1773328453611-p5xexp-sdlc_planner-add-running-token-totals.md

## Overview

When the `RUNNING_TOKENS` environment variable is set, ADW appends a running token total footer to every GitHub issue and PR comment it posts. This gives developers real-time visibility into token consumption as the workflow progresses through each phase, without waiting for the final cost breakdown.

## What Was Built

- `RUNNING_TOKENS` env var constant added to core config
- `runningTokenTotal` optional field added to `WorkflowContext` interface (inherited by `PRReviewWorkflowContext`)
- `formatRunningTokenFooter()` helper function in `workflowCommentsBase.ts`
- Running token footer injected into all issue comment formatters (20+ functions)
- Running token footer injected into all PR review comment formatters (all `switch` cases)
- All orchestrators updated to set `ctx.runningTokenTotal` after each phase's cost accumulation
- New unit test file for running token footer formatting
- New integration test file for orchestrator-level token threading

## Technical Implementation

### Files Modified

- `adws/core/config.ts`: Added `RUNNING_TOKENS = Boolean(process.env.RUNNING_TOKENS)` constant
- `adws/core/index.ts`: Re-exported `RUNNING_TOKENS` and `computeTotalTokens`
- `adws/github/workflowCommentsBase.ts`: Added `formatRunningTokenFooter()` helper
- `adws/github/workflowCommentsIssue.ts`: Added `runningTokenTotal` to `WorkflowContext`; inserted footer in all `format*Comment()` functions
- `adws/github/workflowCommentsPR.ts`: Inserted `tokenFooter` in all `formatPRReviewWorkflowComment()` cases
- `adws/adwSdlc.tsx`: Added `computeTotalTokens` + `RUNNING_TOKENS` imports; updates `ctx.runningTokenTotal` after each of 6 phases
- `adws/adwPrReview.tsx`: Same pattern, 3 phases
- `adws/adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`: Same pattern per orchestrator
- `.env.sample`: Added commented-out `RUNNING_TOKENS` entry

### New Files

- `adws/github/__tests__/workflowCommentsRunningTokens.test.ts`: Unit tests for footer formatting across issue and PR comments
- `adws/__tests__/runningTokensIntegration.test.ts`: Integration tests for orchestrator-level token threading

### Key Changes

- The `formatRunningTokenFooter()` function returns either an empty string (when `tokenTotal` is undefined) or a blockquote line: `> **Running Token Total:** X,XXX tokens`. This is inserted immediately before `ADW_SIGNATURE` in every comment.
- Orchestrators call `computeTotalTokens(totalModelUsage)` after each phase and assign it to `config.ctx.runningTokenTotal` when `RUNNING_TOKENS` is truthy. The total is cumulative across all completed phases.
- The `starting` comment is posted before any phase runs, so `runningTokenTotal` is always undefined at that point — no footer appears, which is correct behavior.
- `PRReviewWorkflowContext` inherits `runningTokenTotal` from `WorkflowContext` via TypeScript `extends` — no separate field was needed.

## How to Use

1. Set `RUNNING_TOKENS=true` in your `.env` file (or any truthy value as an environment variable).
2. Run any ADW workflow (e.g., `bunx tsx adws/adwSdlc.tsx <issueNumber>`).
3. Each comment posted to the GitHub issue or PR will include a footer line like:
   ```
   > **Running Token Total:** 45,231 tokens
   ```
4. The count grows with each phase — plan, build, test, PR, review, document — so you can watch token consumption in real time.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `RUNNING_TOKENS` | `false` | Set to any truthy value to enable running token totals in comments |

`.env.sample` entry:
```
# Optional - show running token totals in issue comments (default: false)
# RUNNING_TOKENS=true
```

## Testing

```bash
bun run test
```

The dedicated test files are:
- `adws/github/__tests__/workflowCommentsRunningTokens.test.ts` — unit tests for `formatRunningTokenFooter` and comment formatters
- `adws/__tests__/runningTokensIntegration.test.ts` — integration tests verifying token threading in orchestrators

## Notes

- When `RUNNING_TOKENS` is not set, no footer appears — zero performance or output impact.
- The footer uses blockquote (` > `) formatting to visually distinguish it from the main comment body.
- Token counts use locale formatting (e.g., `1,234,567 tokens`).
- Only tokens are shown; cost in USD is reserved for the existing final cost breakdown section.
- Error comments also include the running total when available, aiding debugging of runaway costs.
