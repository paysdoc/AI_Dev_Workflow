# Bug: Currency conversion fails when exchange rate API is unreachable

## Metadata
issueNumber: `99`
adwId: `bug-in-currency-conv-kcbcrp`
issueJson: `{"number":99,"title":"Bug in currency conversion","body":"📋 [2026-03-09T10:33:25.414Z] Ignored comment on issue #97: missing \"## Take action\" directive\n❌ [2026-03-09T10:33:34.584Z] [refactor-the-code-fuyzg6] Failed to fetch exchange rates: TypeError: fetch failed\n✅ [2026-03-09T10:33:34.585Z] [refactor-the-code-fuyzg6] Issue cost CSV written: projects/AI_Dev_Workflow/97-refactor-the-code.csv\n✅ [2026-03-09T10:33:34.590Z] [refactor-the-code-fuyzg6] Project cost CSV rebuilt: projects/AI_Dev_Workflow/total-cost.csv\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-09T11:29:16Z","comments":[{"author":"paysdoc","createdAt":"2026-03-09T11:32:10Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
When the exchange rate API (`https://open.er-api.com/v6/latest/USD`) is unreachable, the `fetchExchangeRates()` function fails with `TypeError: fetch failed`. This causes:
- **Actual behavior**: EUR conversion is silently lost — issue cost CSVs and total-cost CSV show `Total Cost (EUR):,N/A`. The error is logged but no retry is attempted.
- **Expected behavior**: The system should retry transient failures before giving up, apply a timeout to prevent hanging, use a fallback rate when the API is completely unavailable, and guard against division-by-zero when computing the EUR rate.

## Problem Statement
The `fetchExchangeRates()` function in `adws/core/costReport.ts` makes a single HTTP request with no retry logic, no timeout, and no fallback mechanism. When the request fails, every downstream consumer (workflow completion, PR review completion, webhook handlers) silently produces `N/A` for EUR values in cost CSVs. Additionally, the EUR rate calculation in `completeWorkflow` and `completePRReviewWorkflow` divides by `totalCostUsd`, which risks `NaN`/`Infinity` when the cost is zero.

## Solution Statement
1. **Add retry with exponential backoff** to `fetchExchangeRates()` — retry up to 2 additional times (3 total attempts) with exponential backoff on transient failures.
2. **Add a fetch timeout** — abort requests that take longer than 5 seconds using `AbortSignal.timeout()`.
3. **Add a fallback EUR rate** — when all retries are exhausted, fall back to a hardcoded approximate EUR rate so cost reports always include EUR conversion.
4. **Fix division-by-zero** — guard `eurEntry.amount / costBreakdown.totalCostUsd` against zero `totalCostUsd` in both `completeWorkflow` and `completePRReviewWorkflow`.

## Steps to Reproduce
1. Run any ADW workflow (e.g., `bunx tsx adws/adwPlanBuild.tsx 97`) when the network is unavailable or the exchange rate API is down.
2. Observe the error log: `❌ Failed to fetch exchange rates: TypeError: fetch failed`
3. Check the generated CSV files — `Total Cost (EUR):,N/A` appears instead of a converted value.

## Root Cause Analysis
The root cause is the lack of resilience in `fetchExchangeRates()`:
- **No retry**: A single transient network failure (DNS timeout, TCP reset, API blip) causes the function to return `{}` immediately.
- **No timeout**: The fetch has no explicit timeout, so it could potentially hang on slow connections before eventually failing.
- **No fallback**: When the API is unreachable, there is no fallback rate. The empty map propagates through `buildCostBreakdown()` which filters out currencies with no rate, resulting in `currencies: []`.
- **Division-by-zero**: In `workflowCompletion.ts:44` and `prReviewCompletion.ts:107`, the EUR rate is computed as `eurEntry.amount / costBreakdown.totalCostUsd`. If `totalCostUsd` is `0`, this produces `NaN` or `Infinity`, which corrupts the total-cost CSV.

## Relevant Files
Use these files to fix the bug:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow strictly during implementation.
- `adws/core/costReport.ts` — Contains `fetchExchangeRates()` (the root cause), `buildCostBreakdown()`, and currency symbols. This is the primary file to modify.
- `adws/core/__tests__/costReport.test.ts` — Existing tests for `fetchExchangeRates` and `buildCostBreakdown`. Must be updated with new test cases for retry, timeout, fallback, and the new helper.
- `adws/phases/workflowCompletion.ts` — Contains `completeWorkflow()` with the EUR rate division-by-zero on line 44.
- `adws/phases/prReviewCompletion.ts` — Contains `completePRReviewWorkflow()` with the same EUR rate division-by-zero on line 107.
- `adws/triggers/webhookHandlers.ts` — Uses `fetchExchangeRates` directly; benefits from the retry/fallback fix automatically.
- `adws/core/costCsvWriter.ts` — Reference file for understanding CSV format; no changes needed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add retry, timeout, and fallback to `fetchExchangeRates` in `adws/core/costReport.ts`

- Add a `FALLBACK_EUR_RATE` constant near the top of the file (approximate EUR/USD rate, e.g., `0.92`). Add a clear comment explaining this is a last-resort fallback when the API is unreachable.
- Add a `MAX_EXCHANGE_RATE_RETRIES` constant set to `2` (for 3 total attempts).
- Add a `EXCHANGE_RATE_TIMEOUT_MS` constant set to `5000` (5 seconds).
- Modify `fetchExchangeRates()` to:
  - Use `AbortSignal.timeout(EXCHANGE_RATE_TIMEOUT_MS)` on the fetch call for a 5-second timeout.
  - Wrap the fetch in a retry loop that attempts up to `MAX_EXCHANGE_RATE_RETRIES + 1` total attempts.
  - On failure, wait with exponential backoff (`500ms * 2^attempt`) before retrying.
  - Log each retry attempt (e.g., `Retrying exchange rate fetch (attempt 2/3)...`).
  - After all retries are exhausted, return fallback rates for any requested currencies that have a known fallback (EUR).

### 2. Extract EUR rate calculation helper to avoid division-by-zero

- Add a new exported function `computeEurRate(costBreakdown: CostBreakdown): number` in `adws/core/costReport.ts` that:
  - Finds the EUR entry in `costBreakdown.currencies`.
  - If `eurEntry` is found and `costBreakdown.totalCostUsd > 0`, returns `eurEntry.amount / costBreakdown.totalCostUsd`.
  - Otherwise returns `0`.
- Export this function from `adws/core/index.ts`.

### 3. Fix EUR rate calculation in `adws/phases/workflowCompletion.ts`

- Import `computeEurRate` from `../core`.
- Replace lines 43-44 (the inline `eurEntry` lookup and division) with a call to `computeEurRate(costBreakdown)`.

### 4. Fix EUR rate calculation in `adws/phases/prReviewCompletion.ts`

- Import `computeEurRate` from `../core`.
- Replace lines 106-107 (the inline `eurEntry` lookup and division) with a call to `computeEurRate(costBreakdown)`.

### 5. Update tests in `adws/core/__tests__/costReport.test.ts`

- Add tests for `fetchExchangeRates` retry behavior:
  - Test that a transient failure followed by success returns correct rates (mock fetch to fail once then succeed).
  - Test that after all retries are exhausted, fallback EUR rate is returned.
  - Test that the timeout signal is passed to fetch.
- Add tests for `computeEurRate`:
  - Test with valid EUR entry and non-zero totalCostUsd — returns correct rate.
  - Test with zero totalCostUsd — returns `0`.
  - Test with no EUR entry in currencies — returns `0`.

### 6. Run validation commands

- Run all validation commands listed below to confirm the fix works with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type-check the main project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the ADW scripts.
- `bun run test` — Run all tests to validate the bug is fixed with zero regressions.

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: use strict types (no `any`), prefer pure functions, meaningful error messages, and immutable data.
- The `FALLBACK_EUR_RATE` is an approximate value meant as a last resort. It will be overwritten by live rates whenever the API is reachable. Add a comment explaining this.
- The retry delay uses a simple `await new Promise(resolve => setTimeout(resolve, delay))` pattern — no external retry library needed.
- `AbortSignal.timeout()` is available in Node.js 17.3+ and Bun, which this project uses.
- The webhook handler in `webhookHandlers.ts` calls `fetchExchangeRates` directly and will automatically benefit from the retry and fallback improvements without any code changes.
