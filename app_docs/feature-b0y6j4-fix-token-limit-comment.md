# Fix: Token Limit Recovery Comment Shows Output Tokens

**ADW ID:** b0y6j4-fix-token-limit-reco
**Date:** 2026-04-03
**Specification:** specs/issue-392-adw-b0y6j4-fix-token-limit-reco-sdlc_planner-fix-token-limit-comment.md

## Overview

The token limit recovery comment posted to GitHub issues was showing total tokens (input + output + cache creation) compared against the output-only token limit (`MAX_THINKING_TOKENS`), producing nonsensical numbers like "211,265 / 63,999". This three-file surgical fix changes the comment formatter to display `totalOutputTokens` instead, aligning the GitHub comment with what the log line correctly reports.

## What Was Built

- Fixed `formatTokenLimitRecoveryComment()` to display output tokens against the output-only limit
- Removed the now-dead `totalTokens` field from the `TokenUsageSnapshot` interface
- Removed the line that populated `totalTokens` in the snapshot builder
- Added a Gherkin feature file covering the fix with regression scenarios

## Technical Implementation

### Files Modified

- `adws/github/workflowCommentsIssue.ts`: Line 169 changed from `usage.totalTokens` to `usage.totalOutputTokens` in `formatTokenLimitRecoveryComment()`
- `adws/types/agentTypes.ts`: Removed `readonly totalTokens: number` field from `TokenUsageSnapshot` interface
- `adws/agents/agentProcessHandler.ts`: Removed `totalTokens: tokenTotals.total` line from the snapshot object literal

### Key Changes

- The comment now reads: `58,984 / 63,999 (90% threshold)` instead of `211,265 / 63,999 (90% threshold)`
- `totalOutputTokens` was already correctly populated on `TokenUsageSnapshot` — no new fields or computations were needed
- `totalTokens` had no other consumers, making its removal safe with zero behavioral side effects
- The `TokenUsageSnapshot` interface now reflects only meaningful fields: `totalInputTokens`, `totalOutputTokens`, `totalCacheCreationTokens`, `maxTokens`, `thresholdPercent`

## How to Use

The fix is transparent — no action required. When a build agent approaches its token limit:

1. The agent logs: `Output token limit threshold reached (X/Y output tokens, Z%). Terminating agent.`
2. The GitHub issue receives a recovery comment: `**Tokens used:** X / Y (Z% threshold)` — both numbers are now output-token counts

## Configuration

No configuration changes. The fix uses the existing `MAX_THINKING_TOKENS` constant and `totalOutputTokens` field.

## Testing

Validation commands used to confirm the fix:

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
```

The BDD feature file at `features/fix_token_limit_comment_output_tokens.feature` covers four regression scenarios including type-check validation.

## Notes

- This is a CLI-only change with no UI impact — no E2E test was needed.
- The fix aligns with the coding guideline: "Remove unused variables, functions, and imports."
- `agentTypes.ts` also received unrelated additions in this diff (`PhaseExecutionState` interface and new `AgentState` fields); these belong to a separate feature merged into the same branch.
