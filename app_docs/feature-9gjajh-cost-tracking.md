# Cost Tracking

## Overview

The cost module tracks LLM token usage and dollar costs per workflow phase and model, produces multi-currency breakdowns, persists totals to agent state, and formats results as GitHub comment markdown tables. Each record holds the locally computed cost (source of truth), the CLI-reported cost from the result message, and per-model estimated and actual token counts, so divergence and estimate-vs-actual can both be reported.

## Responsibilities

- Define `TokenUsageMap`, `PricingMap`, `ModelUsageMap` (snake_case, extractor format) and `LegacyModelUsageMap` (camelCase, orchestrator format) types.
- Define `PhaseCostRecord` — the granular per-phase, per-model cost record written to the Cost API.
- Compute cost from token usage maps via `computeCost` (provider-agnostic multiplication of usage × pricing).
- Check divergence between locally computed cost and CLI-reported cost via `checkDivergence` (default 5% threshold).
- Merge multiple `LegacyModelUsageMap` objects by summing corresponding fields via `mergeModelUsageMaps`; optional figures (`reportedCostUSD`, `estimatedTokens`, `actualTokens`) are summed only when both entries have them and are dropped otherwise.
- Convert an extractor's final state into a `LegacyModelUsageMap` via `toLegacyModelUsageMap` (`cost/providers/anthropic/legacyModelUsage.ts`): `costUSD` is computed locally, `reportedCostUSD` is the CLI's per-model figure, `estimatedTokens` the streaming estimate, `actualTokens` the result-message counts (only when finalized).
- Build a `CostBreakdown` (total USD + per-currency amounts) by fetching live exchange rates.
- Format cost breakdowns as markdown tables for GitHub issue comments via `formatCostBreakdownMarkdown`.
- Persist accumulated token counts to `state.json` metadata via `persistTokenCounts`.
- Compute token totals for budget checks via `computeTotalTokens`, `computeDisplayTokens` (input+output only, for comment running totals), and `computePrimaryModelTokens` (filters to the primary model, preventing subagent usage from triggering false-positive terminations).
- Define `TokenUsageExtractor` interface for streaming extraction (including `getReportedCostUsdByModel()`, the per-model `costUSD` from the result message); Anthropic implementation lives in `cost/providers/anthropic/`.
- Report phase costs via `cost/reporting/commentFormatter.ts`.

## Contracts & Invariants

- `computeCost` assigns zero contribution to any token type present in the usage map but absent from the pricing map; it does not throw on unknown keys.
- `checkDivergence` returns `isDivergent: false` when `reportedCostUsd` is `undefined` (not yet finalized) — divergence is only meaningful after the result message arrives.
- When both computed and reported costs are zero, `percentDiff` is 0 and `isDivergent` is false.
- `computeTotalTokens` excludes `cacheReadInputTokens` from the total (cached reads do not count against the thinking budget); `computeDisplayTokens` excludes all cache tokens.
- `createPhaseCostRecords` maps `costUSD` to `computedCostUsd`, `reportedCostUSD` to `reportedCostUsd`, and copies `estimatedTokens`/`actualTokens`; absent optional fields stay `undefined`, so a run that ended before the result message yields no divergence and no estimate-vs-actual row.
- `createPhaseCostRecords` always sets `provider: 'anthropic'` regardless of the source model.
- `PhaseCostStatus` has three values: `success`, `partial`, `failed`.

- The cost API totals `computed_cost_usd`, never the CLI's figure; `reported_cost_usd` is stored beside it for the divergence check.

## Configuration

Exchange rates are fetched at runtime (see `cost/exchangeRates.ts`). The currency list is passed by callers to `buildCostBreakdown`. No static configuration file; the Anthropic pricing table lives in `cost/providers/anthropic/pricing.ts`.

## Gotchas

- Two parallel type systems exist for token usage: the new snake_case `TokenUsageMap` / `ModelUsageMap` (used by extractors) and the legacy camelCase `LegacyModelUsage` / `LegacyModelUsageMap` (used by orchestrators). They are not interchangeable without conversion.
- `computePrimaryModelTokens` uses a case-insensitive `includes` check against the model tier string (e.g., `'opus'`), so it matches any versioned model ID that contains the tier name. This means a primary model of `'sonnet'` would incorrectly match `claude-sonnet-4-5` and `claude-sonnet-3-7`.
- `persistTokenCounts` reads the existing `state.json` first to preserve all other metadata fields before merging; callers must supply the correct `statePath`.
- `LegacyModelUsage.costUSD` is the local computation, not the CLI's figure. Models missing from the pricing table fall back to Sonnet pricing and will show divergence warnings; that is the check working as intended.
- `estimatedTokens`/`actualTokens` stay on the record and are not sent to D1 (no columns for them).
- The D1 dual-write path lives in `cost/d1Client.ts` and is separate from the legacy CSV pipeline.

## Decisions

- [ADR-0026](../specs/adr/0026-cost-computed-locally-persisted-in-d1.md) — Cost computed locally and persisted in a D1 database
