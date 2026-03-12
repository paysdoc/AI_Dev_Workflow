# Bug: Token counts do not make sense

## Metadata
issueNumber: `152`
adwId: `078fdz-token-counts-do-not`
issueJson: `{"number":152,"title":"Token counts do not make sense","body":"There are two distinct problems with the running token count.\n\n## 1. The running total for ```## :gear: Build Progress``` is not progressing\n\n- Each time a ```## :gear: Build Progress``` comment is issued, the token count is the same as before. \n\n## 2. The workflow complete comment for issue #120 shows a severe mismatch between running totken total and the cost breakdown. See the following:\n\n```\n## :tada: ADW Workflow Completed\n\nAutomated development workflow completed successfully!\n\n**Branch:** `chore-issue-120-extract-git-ops-to-vcs`\n**PR:** https://github.com/paysdoc/AI_Dev_Workflow/pull/147\n**ADW ID:** `cb1dn8-extract-git-operatio`\n\n<details>\n<summary>Cost Breakdown</summary>\n\n| Model | Input Tokens | Output Tokens | Cache Read | Cache Write | Cost (USD) |\n|-------|-------------|---------------|------------|-------------|------------|\n| claude-opus-4-6 | 4,620 | 75,372 | 8,394,568 | 336,948 | $8.2106 |\n| claude-haiku-4-5-20251001 | 166 | 47,910 | 1,230,803 | 282,700 | $0.7162 |\n| claude-sonnet-4-6 | 6 | 1,313 | 68,224 | 12,885 | $0.0885 |\n| **Total** | **4,792** | **124,595** | **9,693,595** | **632,533** | **$9.0153** |\n\n**Total Cost:** $9.0153 USD\n**Total Cost:** €7.7945 EUR\n\n</details>\n\n> **Running Token Total:** 761,920 tokens (opus: 416,940 · haiku: 330,776 · sonnet: 14,204)\n\n---\n_Posted by ADW (AI Developer Workflow) automation_ <!-- adw-bot -->\n```\n\nIt can be useful to ignore token counts (caches, perhaps?) that don't actually cost any money.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T20:03:56Z","comments":[],"actionableComment":null}`

## Bug Description

There are two distinct problems with the running token count displayed in GitHub issue comments:

1. **Build Progress comments show a stale running total:** Every `## :gear: Build Progress` comment posted during the build phase displays the exact same `Running Token Total` value. The total never increases between progress comments, even though the build agent is actively consuming tokens.

2. **Running Token Total vs Cost Breakdown mismatch:** The final workflow completion comment shows a `Running Token Total` of 761,920 tokens, but the Cost Breakdown table shows dramatically different numbers (e.g., 9,693,595 cache read tokens alone). The running total includes `cacheCreationInputTokens` in its calculation (input + output + cacheWrite = 761,920), which makes it confusing to compare against the cost breakdown table. The user expects the running total to reflect only tokens that meaningfully cost money (input + output), not an arbitrary subset of cache operations.

**Expected behavior:**
- Build progress comments should show an increasing running token total as the build agent executes.
- The running token total should clearly represent only the input and output tokens (excluding all cache tokens), making it easy to cross-reference with the cost breakdown table.

## Problem Statement

Two issues need fixing:
1. `ctx.runningTokenTotal` is only updated in the orchestrator AFTER each phase completes, so all `build_progress` comments posted during the build phase show a stale value from the previous phase.
2. `computeTotalTokens()` includes `cacheCreationInputTokens` in its total, creating a confusing mismatch with the cost breakdown table that shows all four token categories separately. The user wants a running total that excludes cache tokens entirely.

## Solution Statement

1. **Fix stale build progress tokens:** Pass the accumulated prior-phase model usage into `executeBuildPhase` via `WorkflowConfig`. After each token-limit continuation within the build phase, merge the prior usage with the local build usage and recompute `ctx.runningTokenTotal`. This ensures build_progress comments reflect at least the tokens from completed prior phases plus completed build continuations.

2. **Fix token total calculation for display:** Create a new `computeDisplayTokens()` function in `tokenManager.ts` that computes only `inputTokens + outputTokens` (excluding all cache tokens). Use this function exclusively for the running token total display (`ctx.runningTokenTotal`). Keep the existing `computeTotalTokens()` unchanged since it's used for internal token limit threshold checking in `agentProcessHandler.ts`. Update the footer label to clarify what's being counted.

## Steps to Reproduce

1. Set `RUNNING_TOKENS=true` in `.env`
2. Run any orchestrator (e.g., `bunx tsx adws/adwPlanBuild.tsx <issue>`)
3. Observe the GitHub issue comments during the build phase
4. **Bug 1:** Every `:gear: Build Progress` comment shows the same `Running Token Total` value
5. **Bug 2:** The final `:tada: ADW Workflow Completed` comment shows a `Running Token Total` that includes `cacheCreationInputTokens`, making it confusing when compared to the cost breakdown table

## Root Cause Analysis

### Bug 1: Stale build progress tokens

In the orchestrator files (e.g., `adwPlanBuild.tsx`), `ctx.runningTokenTotal` is updated only after each phase completes:

```typescript
const planResult = await executePlanPhase(config);
// ... merge usage ...
if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);

const buildResult = await executeBuildPhase(config);  // <-- during this call, ctx.runningTokenTotal is stale
// ... merge usage ...
if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);
```

Inside `executeBuildPhase` (`buildPhase.ts`), the progress callback posts `build_progress` comments every 60 seconds (line 91-96). However, `ctx.runningTokenTotal` is never updated within the build phase — it retains whatever value was set by the orchestrator before the phase started. Even within the token-limit continuation loop, after accumulating model usage from a completed continuation (line 104), `ctx.runningTokenTotal` is not recomputed.

### Bug 2: Misleading token total calculation

`computeTotalTokens()` in `tokenManager.ts` calculates: `inputTokens + outputTokens + cacheCreationInputTokens`. This excludes `cacheReadInputTokens` but includes `cacheCreationInputTokens`. For the issue #120 example:

- opus: 4,620 + 75,372 + 336,948 = 416,940
- haiku: 166 + 47,910 + 282,700 = 330,776
- sonnet: 6 + 1,313 + 12,885 = 14,204
- **Total: 761,920** (matches the displayed running total)

But the cost breakdown table shows all four token categories separately. The user sees 9.6M cache read tokens not reflected in the running total, and 632K cache write tokens that ARE included but not obviously labeled. The result is a number that doesn't clearly correspond to anything in the cost breakdown table.

If only input + output tokens were counted:
- opus: 4,620 + 75,372 = 79,992
- haiku: 166 + 47,910 = 48,076
- sonnet: 6 + 1,313 = 1,319
- **Total: 129,387** (easily verifiable from the cost breakdown Input + Output columns)

## Relevant Files

Use these files to fix the bug:

- `adws/core/tokenManager.ts` — Contains `computeTotalTokens()` which is the source of the misleading total calculation. A new `computeDisplayTokens()` function will be added here that excludes all cache tokens.
- `adws/core/index.ts` — Barrel export file; needs to export the new `computeDisplayTokens()` function.
- `adws/phases/buildPhase.ts` — Contains the build phase execution with the progress callback that posts stale running token totals. Needs to accept prior model usage and update `ctx.runningTokenTotal` after each continuation.
- `adws/phases/workflowInit.ts` — Defines `WorkflowConfig` interface; needs a new optional `totalModelUsage` field to pass accumulated usage into phases.
- `adws/core/workflowCommentParsing.ts` — Contains `formatRunningTokenFooter()` which formats the running total display. Update the label to say "Running Token Total (I/O)" to clarify what's counted.
- `adws/adwPlanBuild.tsx` — Orchestrator; needs to store `totalModelUsage` on config and use `computeDisplayTokens` instead of `computeTotalTokens` for the running total.
- `adws/adwSdlc.tsx` — Orchestrator; same changes as above.
- `adws/adwPlanBuildTest.tsx` — Orchestrator; same changes as above.
- `adws/adwPlanBuildDocument.tsx` — Orchestrator; same changes as above.
- `adws/adwPlanBuildReview.tsx` — Orchestrator; same changes as above.
- `adws/adwPlanBuildTestReview.tsx` — Orchestrator; same changes as above.
- `adws/adwPrReview.tsx` — Orchestrator; same changes as above.
- `adws/__tests__/runningTokensIntegration.test.ts` — Integration tests for running tokens; needs updating to verify `computeDisplayTokens` and in-phase token updates.
- `adws/core/__tests__/tokenManagerFiltered.test.ts` — Unit tests for token manager; needs new tests for `computeDisplayTokens`.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Step by Step Tasks

### Step 1: Add `computeDisplayTokens()` to `tokenManager.ts`

- Read `adws/core/tokenManager.ts`
- Add a new function `computeDisplayTokens(modelUsage: ModelUsageMap): TokenTotals` that computes only `inputTokens + outputTokens`, excluding all cache tokens (`cacheCreationInputTokens` and `cacheReadInputTokens`)
- The function should return a `TokenTotals` object with `cacheCreationTokens: 0` and `total: inputTokens + outputTokens`
- The `modelBreakdown` entries should also use `inputTokens + outputTokens` only (no cache)
- Do NOT modify the existing `computeTotalTokens()` function — it is used for internal token limit threshold checking in `agentProcessHandler.ts`

### Step 2: Export `computeDisplayTokens` from core barrel

- Read `adws/core/index.ts`
- Add `computeDisplayTokens` to the export list from `./tokenManager`

### Step 3: Add `totalModelUsage` field to `WorkflowConfig`

- Read `adws/phases/workflowInit.ts`
- Add an optional `totalModelUsage?: ModelUsageMap` field to the `WorkflowConfig` interface
- This field allows orchestrators to share accumulated model usage with phase functions so they can update the running token total mid-phase

### Step 4: Update `buildPhase.ts` to refresh running tokens mid-phase

- Read `adws/phases/buildPhase.ts`
- Import `computeDisplayTokens` from `../core/tokenManager` and `RUNNING_TOKENS` from `../core`
- After each token continuation's model usage is accumulated (after line 104), if `RUNNING_TOKENS` is enabled and `config.totalModelUsage` is available:
  - Merge `config.totalModelUsage` with the local `modelUsage` to produce a combined usage map
  - Set `ctx.runningTokenTotal = computeDisplayTokens(combinedUsage)`
- This ensures that after each continuation completes, the next `build_progress` comment will reflect updated token counts

### Step 5: Update all orchestrator files to use `computeDisplayTokens` and pass `totalModelUsage`

- Read and update each orchestrator file:
  - `adws/adwPlanBuild.tsx`
  - `adws/adwSdlc.tsx`
  - `adws/adwPlanBuildTest.tsx`
  - `adws/adwPlanBuildDocument.tsx`
  - `adws/adwPlanBuildReview.tsx`
  - `adws/adwPlanBuildTestReview.tsx`
  - `adws/adwPrReview.tsx`
- In each orchestrator:
  - Replace `computeTotalTokens` import with `computeDisplayTokens`
  - Change all `if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage)` to use `computeDisplayTokens(totalModelUsage)`
  - Before each phase call that has progress callbacks (build phase), set `config.totalModelUsage = totalModelUsage` so the phase can update the running total mid-execution
  - After each phase returns and merges usage, update `config.totalModelUsage = totalModelUsage` for subsequent phases

### Step 6: Update `formatRunningTokenFooter` label

- Read `adws/core/workflowCommentParsing.ts`
- Update the `formatRunningTokenFooter` function to change the label from `Running Token Total:` to `Running Token Total (I/O):` to make it clear that only input/output tokens are counted and cache tokens are excluded
- This helps users understand why the number differs from the cache-inclusive cost breakdown table

### Step 7: Update unit tests for `computeDisplayTokens`

- Read `adws/core/__tests__/tokenManagerFiltered.test.ts`
- Add a new `describe('computeDisplayTokens')` block with tests:
  - Verify it computes only `inputTokens + outputTokens` (no cache tokens)
  - Verify `cacheCreationTokens` is always 0 in the result
  - Verify `total` equals `inputTokens + outputTokens`
  - Verify `modelBreakdown` entries exclude cache tokens
  - Verify empty map returns zeros
  - Verify single model and multi-model scenarios

### Step 8: Update integration tests for running tokens

- Read `adws/__tests__/runningTokensIntegration.test.ts`
- Update existing tests to use `computeDisplayTokens` instead of `computeTotalTokens` for `ctx.runningTokenTotal` assignments
- Add a new test verifying that `computeDisplayTokens` excludes cache tokens from the running total (important: the existing tests currently expect `cacheCreationTokens` to be included in the total)
- Add a test verifying that `computeDisplayTokens` results differ from `computeTotalTokens` when cache tokens are present
- Update expected values: e.g., phase one total should be `1000 + 500 = 1500` (not 1700 which included cacheCreation=200)

### Step 9: Update `formatRunningTokenFooter` tests

- Find and read the test file for `workflowCommentParsing.ts` (search for `formatRunningTokenFooter` in test files)
- Update any test expectations that check the footer label to match the new `Running Token Total (I/O):` label

### Step 10: Run validation commands

- Run all validation commands to ensure zero regressions

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type-check the adws scripts
- `bun run test` - Run all tests to validate the bug is fixed with zero regressions
- `bun run build` - Build the application to verify no build errors

## Notes

- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`. Key practices: prefer pure functions, use declarative patterns (map/filter/reduce), keep files under 300 lines, avoid `any`, use meaningful names.
- The `computeTotalTokens()` function MUST NOT be modified — it is used by `agentProcessHandler.ts` and `jsonlParser.ts` for internal token limit threshold checking. Changing it would affect when agents get terminated.
- The `computePrimaryModelTokens()` function is also used for threshold checking and must not be changed.
- The `RUNNING_TOKENS` environment variable controls whether the running total is displayed. When falsy, `ctx.runningTokenTotal` remains `undefined` and the footer is empty.
- Within a single build agent run (no token continuations), the running total still won't update mid-execution because model usage is only available in the JSONL `result` message at the end of the agent run. The fix ensures updates happen between continuations and correctly reflects prior phase usage immediately. This is an acceptable tradeoff — the alternative (estimating mid-run usage) would require significant JSONL parser changes with low value.
- All 7 orchestrator files follow the same pattern and need identical changes. Consider making them all consistently in one pass.
