# PR-Review: Add model type to running token totals

## PR-Review Description
The PR reviewer (`paysdoc`) requests that the running token total footer displayed on issue and PR comments also includes the model type(s) used during the workflow. The review comment is: **"Add the model type to the running total"**. This means each running token total should show which Claude model(s) were used and how many tokens each consumed, so the reader can see at a glance whether tokens were spent on opus, sonnet, haiku, etc.

## Summary of Original Implementation Plan
The original plan (`specs/issue-144-adw-1773328453611-p5xexp-sdlc_planner-add-running-token-totals.md`) implemented the `RUNNING_TOKENS` feature:
- Added `RUNNING_TOKENS` env var to `config.ts` and `.env.sample`
- Added `runningTokenTotal` field (`{ inputTokens, outputTokens, cacheCreationTokens, total }`) to `WorkflowContext`
- Added `formatRunningTokenFooter()` in `workflowCommentsBase.ts` to render a blockquote footer showing only an aggregate token total
- Updated all issue and PR comment formatters to include the footer
- Updated all 7 orchestrators to thread `computeTotalTokens(totalModelUsage)` into `ctx.runningTokenTotal` after each phase
- Added unit tests (`workflowCommentsRunningTokens.test.ts`) and integration tests (`runningTokensIntegration.test.ts`)

The original implementation did **not** include per-model breakdowns or model type display in the running total footer.

## Relevant Files
Use these files to resolve the review:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.
- `adws/core/tokenManager.ts` — Contains `computeTotalTokens()` and `TokenTotals` interface. The `modelBreakdown` field must be added to `TokenTotals` and computed by `computeTotalTokens()`.
- `adws/core/index.ts` — Re-exports from `tokenManager.ts`. Must export the new `ModelTokenEntry` type.
- `adws/github/workflowCommentsBase.ts` — Contains `formatRunningTokenFooter()`. Must be updated to accept and render per-model breakdown with shortened model names. A new `formatModelName()` helper is needed.
- `adws/github/workflowCommentsIssue.ts` — Contains `WorkflowContext` interface with `runningTokenTotal` field. Must extend the inline type to include `modelBreakdown`.
- `adws/github/__tests__/workflowCommentsRunningTokens.test.ts` — Unit tests for footer formatting. Must add tests for model type display, `formatModelName`, and model breakdown rendering.
- `adws/__tests__/runningTokensIntegration.test.ts` — Integration tests. Must add tests verifying `modelBreakdown` is populated correctly after merging multi-model usage maps.

**No changes needed in orchestrators:** Since `computeTotalTokens` already returns the full `TokenTotals` object, adding `modelBreakdown` to that return type flows through all 7 orchestrators automatically — they already call `ctx.runningTokenTotal = computeTotalTokens(totalModelUsage)`.

**No changes needed in PR comment formatters:** `workflowCommentsPR.ts` already calls `formatRunningTokenFooter(ctx.runningTokenTotal)` for every stage. Once `formatRunningTokenFooter` is updated, PR comments get model types automatically.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `ModelTokenEntry` interface and `modelBreakdown` to `TokenTotals` in `tokenManager.ts`
- Add a new exported interface `ModelTokenEntry` with `{ model: string; total: number }` to represent a single model's total token count.
- Add `modelBreakdown: ModelTokenEntry[]` to the existing `TokenTotals` interface.
- Update `computeTotalTokens()` to build and return `modelBreakdown`:
  - Map `Object.entries(modelUsage)` to `ModelTokenEntry[]` entries where `total = inputTokens + outputTokens + cacheCreationInputTokens` for each model.
  - Sort the array descending by `total` so the highest-usage model appears first.
- Export `ModelTokenEntry` from `adws/core/index.ts`.

### Step 2: Extend `runningTokenTotal` type on `WorkflowContext` in `workflowCommentsIssue.ts`
- Update the inline `runningTokenTotal` type to include `modelBreakdown`:
  ```typescript
  runningTokenTotal?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    total: number;
    modelBreakdown: Array<{ model: string; total: number }>;
  };
  ```
- `PRReviewWorkflowContext` inherits this automatically since it extends `WorkflowContext`.

### Step 3: Add `formatModelName` helper and update `formatRunningTokenFooter` in `workflowCommentsBase.ts`
- Add a new exported function `formatModelName(modelKey: string): string` that shortens full model IDs to readable tier names:
  - `'claude-opus-4-6'` → `'opus'`
  - `'claude-sonnet-4-6'` → `'sonnet'`
  - `'claude-haiku-4-5'` → `'haiku'`
  - Use case-insensitive `includes` checks for known tier names, with fallback to the raw key for unknown models.
- Update `formatRunningTokenFooter` signature to accept optional `modelBreakdown`:
  ```typescript
  export function formatRunningTokenFooter(tokenTotal?: { total: number; modelBreakdown?: Array<{ model: string; total: number }> }): string
  ```
- When `modelBreakdown` is present and non-empty, append a parenthetical per-model breakdown after the total using `formatModelName` for short names:
  ```
  > **Running Token Total:** 1,234,567 tokens (opus: 1,000,000 · haiku: 234,567)
  ```
- When `modelBreakdown` is absent or empty, keep existing behavior (total only, no parenthetical).
- Use `toLocaleString('en-US')` for per-model totals as well.
- Separate multiple model entries with ` · ` (middle dot).

### Step 4: Update unit tests in `workflowCommentsRunningTokens.test.ts`
- Add `describe('formatModelName')` block:
  - Test `claude-opus-4-6` → `opus`
  - Test `claude-sonnet-4-6` → `sonnet`
  - Test `claude-haiku-4-5` → `haiku`
  - Test unknown model returns full key
  - Test case-insensitivity
- Add `formatRunningTokenFooter` tests for model breakdown:
  - Test: footer includes model names and per-model totals when `modelBreakdown` is provided
  - Test: model names are shortened via `formatModelName`
  - Test: multiple models separated by ` · ` (middle dot)
  - Test: models appear in descending total order (as provided by `computeTotalTokens`)
  - Test: empty `modelBreakdown` array shows no parenthetical
  - Test: missing `modelBreakdown` shows no parenthetical
- Update `formatWorkflowComment` and `formatPRReviewWorkflowComment` test fixtures:
  - Update `runningTokenTotal` fixtures to include `modelBreakdown` data
  - Add assertions that rendered comments include model type info (e.g., `(opus: 1,000)`)

### Step 5: Update integration tests in `runningTokensIntegration.test.ts`
- Add test: `computeTotalTokens` output includes `modelBreakdown` with correct model keys and totals after single-phase usage.
- Add test: after merging multi-model phases (`claude-opus-4-6` + `claude-haiku-4-5`), breakdown contains both models with correct summed totals.
- Add test: `modelBreakdown` is sorted descending by total.
- Add test: `ctx.runningTokenTotal.modelBreakdown` is populated when threaded into context.

### Step 6: Run validation commands
- Execute all validation commands to ensure zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws directory
- `bun run test` - Run all tests to validate the review is complete with zero regressions
- `bun run build` - Build the application to verify no build errors

## Notes
- The `ModelUsageMap` keys are full model IDs like `claude-opus-4-6`. These must be shortened to readable tier names (`opus`, `sonnet`, `haiku`) in the footer display for conciseness.
- The `formatModelName` helper uses simple `includes` checks for known tier names with a fallback to the raw key for unknown models.
- The `modelBreakdown` array is sorted descending by total so the highest-consuming model appears first in the parenthetical.
- Per-model totals use `toLocaleString('en-US')` for consistent comma-separated formatting.
- Since `computeTotalTokens` already iterates `Object.entries(modelUsage)`, adding `modelBreakdown` is a minimal change — the per-model data is already available during the reduce.
- The preferred approach is to update `computeTotalTokens` itself (adding `modelBreakdown` to `TokenTotals`) rather than creating a separate function, to avoid changing all 7 orchestrators. This is backward compatible since the orchestrators already call `computeTotalTokens` and the new `modelBreakdown` field flows through automatically.
- No changes are needed in the orchestrator files (`adw*.tsx`) or the PR comment formatter (`workflowCommentsPR.ts`) since they already use `computeTotalTokens` and `formatRunningTokenFooter` respectively.
