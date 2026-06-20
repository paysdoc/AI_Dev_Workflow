# Cost Tracking

## Overview

The cost module tracks LLM token usage and dollar costs per workflow phase and model, produces multi-currency breakdowns, persists totals to agent state, and formats results as GitHub comment markdown tables. It supports both real-time streaming estimation and final CLI-reported cost, detecting divergence between the two.

## Responsibilities

- Define `TokenUsageMap`, `PricingMap`, `ModelUsageMap` (snake_case, extractor format) and `LegacyModelUsageMap` (camelCase, orchestrator format) types.
- Define `PhaseCostRecord` — the granular per-phase, per-model cost record written to the Cost API.
- Compute cost from token usage maps via `computeCost` (provider-agnostic multiplication of usage × pricing).
- Check divergence between locally computed cost and CLI-reported cost via `checkDivergence` (default 5% threshold).
- Merge multiple `LegacyModelUsageMap` objects by summing corresponding fields via `mergeModelUsageMaps`.
- Build a `CostBreakdown` (total USD + per-currency amounts) by fetching live exchange rates.
- Format cost breakdowns as markdown tables for GitHub issue comments via `formatCostBreakdownMarkdown`.
- Persist accumulated token counts to `state.json` metadata via `persistTokenCounts`.
- Compute token totals for budget checks via `computeTotalTokens`, `computeDisplayTokens` (input+output only, for comment running totals), and `computePrimaryModelTokens` (filters to the primary model, preventing subagent usage from triggering false-positive terminations).
- Define `TokenUsageExtractor` interface for streaming extraction; Anthropic implementation lives in `cost/providers/anthropic/`.
- Report phase costs via `cost/reporting/commentFormatter.ts`.

## Contracts & Invariants

- `computeCost` assigns zero contribution to any token type present in the usage map but absent from the pricing map; it does not throw on unknown keys.
- `checkDivergence` returns `isDivergent: false` when `reportedCostUsd` is `undefined` (not yet finalized) — divergence is only meaningful after the result message arrives.
- When both computed and reported costs are zero, `percentDiff` is 0 and `isDivergent` is false.
- `computeTotalTokens` excludes `cacheReadInputTokens` from the total (cached reads do not count against the thinking budget); `computeDisplayTokens` excludes all cache tokens.
- `createPhaseCostRecords` always sets `provider: 'anthropic'` regardless of the source model.
- `PhaseCostStatus` has three values: `success`, `partial`, `failed`.

## Configuration

Exchange rates are fetched at runtime (see `cost/exchangeRates.ts`). The currency list is passed by callers to `buildCostBreakdown`. No static configuration file; the Anthropic pricing table lives in `cost/providers/anthropic/pricing.ts`.

## Gotchas

- Two parallel type systems exist for token usage: the new snake_case `TokenUsageMap` / `ModelUsageMap` (used by extractors) and the legacy camelCase `LegacyModelUsage` / `LegacyModelUsageMap` (used by orchestrators). They are not interchangeable without conversion.
- `computePrimaryModelTokens` uses a case-insensitive `includes` check against the model tier string (e.g., `'opus'`), so it matches any versioned model ID that contains the tier name. This means a primary model of `'sonnet'` would incorrectly match `claude-sonnet-4-5` and `claude-sonnet-3-7`.
- `persistTokenCounts` reads the existing `state.json` first to preserve all other metadata fields before merging; callers must supply the correct `statePath`.
- The D1 dual-write path lives in `cost/d1Client.ts` and is separate from the legacy CSV pipeline.
