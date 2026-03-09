# PR-Review: Update fallback rate with latest fetched rate

## PR-Review Description
The reviewer (`paysdoc`) commented on `adws/core/costReport.ts` (line 12) requesting that when a successful exchange rate fetch returns a valid rate, the fallback rate should be updated with the latest fetched rate. Currently, the `FALLBACK_EUR_RATE` is hardcoded to `0.92` and never updated at runtime. If a fetch succeeds and returns `EUR: 0.93`, a subsequent failed fetch would still fall back to the stale `0.92` value. The reviewer wants the fallback to always reflect the most recently known live rate, so that if the API becomes unreachable later, the fallback is as accurate as possible.

## Summary of Original Implementation Plan
The original plan (`specs/issue-99-adw-bug-in-currency-conv-kcbcrp-sdlc_planner-fix-currency-conversion.md`) added resilience to `fetchExchangeRates()`:
1. Retry with exponential backoff (up to 3 total attempts)
2. Fetch timeout via `AbortSignal.timeout(5000)`
3. Hardcoded fallback EUR rate (`0.92`) when all retries fail
4. Extracted `computeEurRate()` helper to prevent division-by-zero
5. Updated consumers in `workflowCompletion.ts` and `prReviewCompletion.ts`
6. Added comprehensive test coverage for retry, timeout, and fallback behavior

## Relevant Files
Use these files to resolve the review:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow (immutability principle, type safety, testing requirements).
- `adws/core/costReport.ts` — Primary file to modify. Contains `FALLBACK_EUR_RATE`, `FALLBACK_RATES`, and `fetchExchangeRates()`. The fallback rates need to be dynamically updated on successful fetch.
- `adws/core/__tests__/costReport.test.ts` — Tests for `fetchExchangeRates`. Must be updated to verify that a successful fetch updates the fallback rate used by subsequent failed fetches.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Introduce a mutable cached rates store in `adws/core/costReport.ts`

- Add a module-level mutable variable `let lastKnownRates: Record<string, number> = { ...FALLBACK_RATES };` below the `FALLBACK_RATES` constant.
- This variable will hold the most recently fetched live rates, initialized with the hardcoded defaults.
- The immutable `FALLBACK_RATES` constant remains unchanged as the initial seed value.

### 2. Update `fetchExchangeRates()` to persist successful rates into `lastKnownRates`

- After a successful fetch returns valid rates (inside the `for` loop on the success path), update `lastKnownRates` with each fetched rate:
  ```typescript
  for (const currency of targetCurrencies) {
    const rate = data.rates[currency];
    if (typeof rate === 'number') {
      rates[currency] = rate;
      lastKnownRates[currency] = rate; // Update fallback with latest rate
    }
  }
  ```
- This ensures the next time the function falls back, it uses the most recently known live rate instead of the hardcoded default.

### 3. Update the fallback path to use `lastKnownRates` instead of `FALLBACK_RATES`

- In the fallback section (after all retries are exhausted), change the lookup from `FALLBACK_RATES[currency]` to `lastKnownRates[currency]`:
  ```typescript
  for (const currency of targetCurrencies) {
    const fallback = lastKnownRates[currency];
    if (typeof fallback === 'number') {
      fallbackRates[currency] = fallback;
    }
  }
  ```
- This means the fallback will use the latest live rate if one was ever fetched during this process's lifetime, and the hardcoded default otherwise.

### 4. Export a test utility to reset cached rates (for test isolation)

- Export a function `resetLastKnownRates(): void` that resets `lastKnownRates` back to `{ ...FALLBACK_RATES }`.
- This function is only needed for test isolation so that tests don't leak state between test cases.
- Mark with a JSDoc comment: `/** @internal Resets cached rates — for testing only. */`

### 5. Update tests in `adws/core/__tests__/costReport.test.ts`

- Import `resetLastKnownRates` from `../costReport`.
- Call `resetLastKnownRates()` in the `beforeEach` of the `fetchExchangeRates` describe block to ensure test isolation.
- Add a new test case: "updates fallback rate with latest fetched rate for subsequent failures":
  1. Mock fetch to succeed once with `{ rates: { EUR: 0.95 } }`.
  2. Call `fetchExchangeRates(['EUR'])` — expect `{ EUR: 0.95 }`.
  3. Mock fetch to reject with a network error (all retries fail).
  4. Call `fetchExchangeRates(['EUR'])` again — expect `{ EUR: 0.95 }` (the updated fallback, not `0.92`).

### 6. Run validation commands

- Run all validation commands listed below to confirm the review is resolved with zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type-check the main project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the ADW scripts.
- `bun run test` — Run all tests to validate zero regressions.

## Notes
- Per `guidelines/coding_guidelines.md`, the immutable `FALLBACK_RATES` constant remains untouched. The mutable `lastKnownRates` is a separate runtime cache, keeping the initial defaults separate from the live cache.
- The `resetLastKnownRates()` function is intentionally exported for test isolation. An alternative is to use `vi.importActual` and module re-imports, but a simple reset function is clearer and easier to maintain.
- This change has no impact on other consumers (`workflowCompletion.ts`, `prReviewCompletion.ts`, `webhookHandlers.ts`) since they all call `fetchExchangeRates()` which now transparently caches rates.
