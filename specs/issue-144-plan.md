# PR-Review: Add model type to running token totals

## PR-Review Description
The PR reviewer requests that the running token total footer displayed on issue and PR comments also includes the model type(s) used. Currently the footer only shows the aggregate total token count (e.g., `> **Running Token Total:** 1,234,567 tokens`). The review asks to add per-model breakdowns so the reader can see which Claude models consumed tokens and how many each used (e.g., `> **Running Token Total:** 1,234,567 tokens (opus: 1,000,000 · haiku: 234,567)`).

## Summary of Original Implementation Plan
The original plan (`specs/issue-144-adw-1773328453611-p5xexp-sdlc_planner-add-running-token-totals.md`) implemented the `RUNNING_TOKENS` feature:
- Added `RUNNING_TOKENS` env var to `config.ts` and `.env.sample`
- Added `runningTokenTotal` field (`{ inputTokens, outputTokens, cacheCreationTokens, total }`) to `WorkflowContext`
- Added `formatRunningTokenFooter()` in `workflowCommentsBase.ts` to render a blockquote footer
- Updated all issue and PR comment formatters to include the footer
- Updated all 7 orchestrators to thread `computeTotalTokens(totalModelUsage)` into `ctx.runningTokenTotal` after each phase
- Added unit tests (`workflowCommentsRunningTokens.test.ts`) and integration tests (`runningTokensIntegration.test.ts`)

## Relevant Files
Use these files to resolve the review:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.
- `adws/core/tokenManager.ts` — Contains `computeTotalTokens()` and `TokenTotals` interface. Needs a new helper to extract per-model breakdown from `ModelUsageMap`.
- `adws/types/costTypes.ts` — Contains `ModelUsageMap` (`Record<string, ModelUsage>`) type definition. Reference for model key format (e.g., `'claude-opus-4-6'`).
- `adws/github/workflowCommentsBase.ts` — Contains `formatRunningTokenFooter()`. Must be updated to accept and render per-model breakdown.
- `adws/github/workflowCommentsIssue.ts` — Contains `WorkflowContext` interface with `runningTokenTotal` field. Must extend the type to include model breakdown data.
- `adws/adwPlanBuild.tsx` — Representative orchestrator. Must pass model breakdown when assigning `ctx.runningTokenTotal`.
- `adws/adwPlanBuildTest.tsx` — Orchestrator; same update pattern.
- `adws/adwPlanBuildReview.tsx` — Orchestrator; same update pattern.
- `adws/adwPlanBuildTestReview.tsx` — Orchestrator; same update pattern.
- `adws/adwPlanBuildDocument.tsx` — Orchestrator; same update pattern.
- `adws/adwSdlc.tsx` — Full SDLC orchestrator; same update pattern.
- `adws/adwPrReview.tsx` — PR Review orchestrator; same update pattern.
- `adws/github/__tests__/workflowCommentsRunningTokens.test.ts` — Unit tests for footer formatting. Must be updated for model type display.
- `adws/__tests__/runningTokensIntegration.test.ts` — Integration tests. Must be updated to verify model breakdown threading.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `computeTotalTokensWithModels` helper to `tokenManager.ts`
- Add a new interface `ModelTokenEntry` with `{ model: string; total: number }` to represent a single model's token total.
- Extend the existing `TokenTotals` interface to include `modelBreakdown: ModelTokenEntry[]` — an array of per-model totals sorted descending by total tokens.
- Add a new function `computeTotalTokensWithModels(modelUsage: ModelUsageMap): TokenTotals` that:
  - Computes the same aggregate totals as `computeTotalTokens`
  - Also builds a `modelBreakdown` array from `Object.entries(modelUsage)`, mapping each model key to its summed total (`inputTokens + outputTokens + cacheCreationInputTokens`)
  - Sorts the array descending by total so the highest-usage model appears first
- Update `computeTotalTokens` to also include `modelBreakdown` in its return value (calling `computeTotalTokensWithModels` internally or inlining the logic) so the return type stays consistent. This keeps backward compatibility — callers that don't use `modelBreakdown` simply ignore it.
- Export `ModelTokenEntry` from `adws/core/index.ts`.

### Step 2: Update `runningTokenTotal` type on `WorkflowContext`
- In `adws/github/workflowCommentsIssue.ts`, extend the inline `runningTokenTotal` type to include the model breakdown:
  ```typescript
  runningTokenTotal?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    total: number;
    modelBreakdown: Array<{ model: string; total: number }>;
  };
  ```
- `PRReviewWorkflowContext` inherits this automatically.

### Step 3: Update `formatRunningTokenFooter` in `workflowCommentsBase.ts`
- Update the function signature to accept the extended type with optional `modelBreakdown`:
  ```typescript
  export function formatRunningTokenFooter(tokenTotal?: { total: number; modelBreakdown?: Array<{ model: string; total: number }> }): string
  ```
- Add a helper (inline or module-level) `formatModelName(modelKey: string): string` that extracts a readable short name from model IDs:
  - `'claude-opus-4-6'` → `'opus'`
  - `'claude-sonnet-4-6'` → `'sonnet'`
  - `'claude-haiku-4-5'` → `'haiku'`
  - Pattern: extract the tier segment between the first and second hyphens. If the key contains `opus`, return `opus`; if `sonnet`, return `sonnet`; if `haiku`, return `haiku`; otherwise return the full key as fallback.
- When `modelBreakdown` is present and non-empty, append a parenthetical model breakdown after the total:
  ```
  > **Running Token Total:** 1,234,567 tokens (opus: 1,000,000 · haiku: 234,567)
  ```
- When `modelBreakdown` is absent or empty, keep existing behavior (total only).
- Use `toLocaleString('en-US')` for per-model totals as well.

### Step 4: Update all 7 orchestrators
- The existing pattern in each orchestrator is:
  ```typescript
  if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);
  ```
- No change needed if Step 1 updated `computeTotalTokens` to include `modelBreakdown` in its return. The `TokenTotals` type now includes `modelBreakdown`, which will flow through automatically.
- If instead a new `computeTotalTokensWithModels` was created, update all orchestrator lines to call the new function:
  ```typescript
  if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokensWithModels(totalModelUsage);
  ```
- Apply to all 7 orchestrators:
  - `adws/adwPlanBuild.tsx`
  - `adws/adwPlanBuildTest.tsx`
  - `adws/adwPlanBuildReview.tsx`
  - `adws/adwPlanBuildTestReview.tsx`
  - `adws/adwPlanBuildDocument.tsx`
  - `adws/adwSdlc.tsx`
  - `adws/adwPrReview.tsx`

### Step 5: Update unit tests in `workflowCommentsRunningTokens.test.ts`
- Update `formatRunningTokenFooter` tests:
  - Add test: when `modelBreakdown` is provided, footer includes model names and per-model totals.
  - Add test: model names are shortened (e.g., `claude-opus-4-6` → `opus`).
  - Add test: multiple models are separated by ` · ` (middle dot).
  - Add test: models are sorted by total descending.
  - Add test: when `modelBreakdown` is empty array, no parenthetical is shown.
  - Update existing tests to include `modelBreakdown: []` where needed, or verify they still pass without it (backward compat).
- Update `formatWorkflowComment` tests:
  - Update `runningTokenTotal` test fixtures to include `modelBreakdown` data.
  - Add assertion that the rendered comment includes model type info.
- Update `formatPRReviewWorkflowComment` tests:
  - Same as above for PR context.

### Step 6: Update integration tests in `runningTokensIntegration.test.ts`
- Update the test that assigns `computeTotalTokens(totalModelUsage)` to `ctx.runningTokenTotal` to verify `modelBreakdown` is populated with the correct model keys and totals.
- Verify that after merging two phases with different models (e.g., `claude-opus-4-6` and `claude-haiku-4-5`), the breakdown contains both models with correct summed totals.
- Verify the breakdown is sorted descending by total.

### Step 7: Run validation commands
- Execute all validation commands to ensure zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws directory
- `bun run test` - Run all tests to validate the review is complete with zero regressions
- `bun run build` - Build the application to verify no build errors

## Notes
- The `ModelUsageMap` keys are full model IDs like `claude-opus-4-6`. These should be shortened to readable tier names (`opus`, `sonnet`, `haiku`) in the footer display for conciseness.
- The `formatModelName` helper should use a simple `includes` check for known tier names (`opus`, `sonnet`, `haiku`) with a fallback to the raw key for unknown models.
- The `modelBreakdown` array should be sorted descending by total so the highest-consuming model appears first in the parenthetical.
- Per-model totals should also use `toLocaleString('en-US')` for consistent formatting.
- Since `computeTotalTokens` already iterates `Object.entries(modelUsage)`, adding model breakdown is a minimal change — the per-model data is already available during the reduce.
- The preferred approach is to update `computeTotalTokens` itself (adding `modelBreakdown` to `TokenTotals`) rather than creating a separate function, to avoid changing all 7 orchestrators. This is backward compatible since existing callers can ignore the new field.
