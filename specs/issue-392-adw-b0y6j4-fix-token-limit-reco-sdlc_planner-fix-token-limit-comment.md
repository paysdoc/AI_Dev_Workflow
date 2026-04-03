# Bug: Token limit recovery comment shows total tokens instead of output tokens

## Metadata
issueNumber: `392`
adwId: `b0y6j4-fix-token-limit-reco`
issueJson: `{"number":392,"title":"Fix token limit recovery comment showing total tokens instead of output tokens","body":"## Bug\n\nThe token limit recovery comment on GitHub issues displays **total tokens** (input + output + cache creation) against the **output token limit**, making the numbers nonsensical.\n\n### Log line (correct)\n```\nBuild: Output token limit threshold reached (58984/63999 output tokens, 90%). Terminating agent.\n```\n\n### Issue comment (incorrect)\n```\nTokens used: 211 265 / 63 999 (90% threshold)\n```\n\n211,265 is the sum of all token types; 63,999 is the output-only limit. Apples vs oranges.\n\n## Root cause\n\n`agentProcessHandler.ts` builds a `TokenUsageSnapshot` where `totalTokens` is set to `computeTotalTokens().total` (input + output + cache creation). The comment formatter in `workflowCommentsIssue.ts` then displays `usage.totalTokens` against `usage.maxTokens` (which is the output-only limit).\n\n## Fix\n\n1. **`workflowCommentsIssue.ts:169`** — use `usage.totalOutputTokens` instead of `usage.totalTokens`\n2. **`agentTypes.ts:111`** — remove `totalTokens` field from `TokenUsageSnapshot` (dead weight after fix)\n3. **`agentProcessHandler.ts:213`** — remove the line that populates `totalTokens`\n\n## Files\n\n- `adws/github/workflowCommentsIssue.ts`\n- `adws/types/agentTypes.ts`\n- `adws/agents/agentProcessHandler.ts`","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T13:08:09Z","comments":[],"actionableComment":null}`

## Bug Description
The token limit recovery comment posted to GitHub issues when a build agent approaches its token limit displays incorrect token counts. The comment shows `usage.totalTokens` (the sum of input + output + cache creation tokens) compared against `usage.maxTokens` (the output-only token limit). This is an apples-to-oranges comparison — e.g., "Tokens used: 211,265 / 63,999" where 211,265 includes all token types but 63,999 is only the output limit.

**Expected behavior:** The comment should display output tokens against the output token limit, matching what the log line correctly reports (e.g., "58,984 / 63,999 output tokens").

**Actual behavior:** The comment displays total tokens (all types combined) against the output-only limit, producing nonsensical numbers where the "used" count greatly exceeds the "limit".

## Problem Statement
`formatTokenLimitRecoveryComment()` in `workflowCommentsIssue.ts` reads `usage.totalTokens` — a field populated with `computeTotalTokens().total` (input + output + cache creation) — and displays it against `usage.maxTokens` (the output-only limit `MAX_THINKING_TOKENS`). The `totalTokens` field on `TokenUsageSnapshot` is the sole source of the mismatch and has no other consumers.

## Solution Statement
1. Change the comment formatter to display `usage.totalOutputTokens` instead of `usage.totalTokens`.
2. Remove the now-dead `totalTokens` field from the `TokenUsageSnapshot` interface.
3. Remove the line that populates `totalTokens` in the snapshot construction in `agentProcessHandler.ts`.

This is a three-line surgical fix across three files with no behavioral side effects.

## Steps to Reproduce
1. Run an ADW build agent on an issue that generates enough output to trigger the token limit threshold (90% of `MAX_THINKING_TOKENS`).
2. Observe the log line: it correctly reports output tokens vs output limit.
3. Observe the GitHub issue comment: it incorrectly reports total tokens (input + output + cache) vs output limit, producing a number that exceeds the limit.

## Root Cause Analysis
In `agentProcessHandler.ts:208-216`, when a token limit is reached, a `TokenUsageSnapshot` is constructed. The `totalTokens` field is set to `tokenTotals.total`, which is the return value of `computeTotalTokens()` — this sums `inputTokens + outputTokens + cacheCreationInputTokens` across all models (see `costHelpers.ts:159-167`).

The comment formatter at `workflowCommentsIssue.ts:169` then displays `usage.totalTokens` alongside `usage.maxTokens`. But `maxTokens` is set to `MAX_THINKING_TOKENS`, which is the output-only token limit. The comparison is invalid: a sum of all token types vs. an output-only limit.

The `totalOutputTokens` field on the same snapshot already holds the correct value for this comparison.

## Relevant Files
Use these files to fix the bug:

- `adws/github/workflowCommentsIssue.ts` — Contains `formatTokenLimitRecoveryComment()` at line 165. Line 169 reads `usage.totalTokens` and must be changed to `usage.totalOutputTokens`.
- `adws/types/agentTypes.ts` — Defines `TokenUsageSnapshot` interface at line 107. Line 111 declares the `totalTokens` field which must be removed.
- `adws/agents/agentProcessHandler.ts` — Constructs the `TokenUsageSnapshot` at lines 209-216. Line 213 populates `totalTokens` and must be removed.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix the comment formatter to use output tokens
- In `adws/github/workflowCommentsIssue.ts`, line 169, change `usage.totalTokens` to `usage.totalOutputTokens`
- This makes the displayed token count match the output-only limit (`maxTokens`)

### 2. Remove the `totalTokens` field from `TokenUsageSnapshot`
- In `adws/types/agentTypes.ts`, remove line 111 (`readonly totalTokens: number;`) from the `TokenUsageSnapshot` interface
- This eliminates the misleading field that conflated total and output tokens

### 3. Remove `totalTokens` population from the snapshot builder
- In `adws/agents/agentProcessHandler.ts`, remove line 213 (`totalTokens: tokenTotals.total,`) from the snapshot object literal
- This ensures the code compiles after removing the field from the interface

### 4. Run validation commands
- Run the validation commands listed below to confirm the fix compiles, lints cleanly, and introduces no regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws subproject
- `bun run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` file must be followed. This fix aligns with the "Code hygiene — Remove unused variables, functions, and imports" guideline.
- No new libraries are required.
- This is a CLI-only change with no UI impact — no E2E test is needed.
- The `totalOutputTokens` field already exists on `TokenUsageSnapshot` (line 109) and is correctly populated from `tokenTotals.outputTokens` (line 211 in `agentProcessHandler.ts`), so no new fields or computations are needed.
