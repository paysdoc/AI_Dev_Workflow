# Cost Module Core, Anthropic Extractor, and Vitest Infrastructure

**ADW ID:** ku956a-cost-revamp-core-com
**Date:** 2026-03-19
**Specification:** specs/issue-241-adw-ku956a-cost-revamp-core-com-sdlc_planner-cost-module-core-vitest.md

## Overview

Introduces the foundational `adws/cost/` module as the first slice of the cost module revamp. This standalone, testable library provides provider-agnostic cost computation, an Anthropic-specific streaming token extractor, and Vitest unit test infrastructure — without wiring into the existing workflow.

## What Was Built

- **Core type definitions** — `TokenUsageMap`, `PricingMap`, `ModelUsageMap` as `Record<string, number>`; `TokenUsageExtractor` pull-model interface; `DivergenceResult`; `PhaseCostRecord`
- **Generic cost computation** — `computeCost(usage, pricing)` multiplies matching keys across any provider's token/pricing maps; `checkDivergence()` flags >5% divergence between local and CLI-reported costs
- **Anthropic provider** — Pricing tables for Opus 4.6, Sonnet 4.5, Haiku 4.5 with snake_case keys; `AnthropicTokenUsageExtractor` that correctly parses `result` JSONL messages handling mixed `total_cost_usd` (snake_case) and `inputTokens`/`outputTokens` (camelCase) field conventions
- **Vitest infrastructure** — `vitest.config.ts`, `test:unit` and `test:unit:watch` scripts, unit tests covering computation, divergence boundary conditions, and extractor parsing

## Technical Implementation

### Files Modified

- `package.json`: Added `vitest` dev dependency, `test:unit` and `test:unit:watch` scripts
- `features/step_definitions/agentCommandsSteps.ts`: Minor step definition update

### New Files

- `vitest.config.ts`: Vitest configuration targeting `adws/cost/__tests__/**/*.test.ts`
- `adws/cost/types.ts`: Core interfaces — `TokenUsageExtractor`, `PhaseCostRecord`, `TokenUsageMap`, `PricingMap`, `ModelUsageMap`, `DivergenceResult`
- `adws/cost/computation.ts`: `computeCost()` and `checkDivergence()` functions
- `adws/cost/providers/anthropic/pricing.ts`: Pricing tables for Opus 4.6, Sonnet 4.5, Haiku 4.5 with snake_case keys and `getAnthropicPricing()` lookup helper
- `adws/cost/providers/anthropic/extractor.ts`: `AnthropicTokenUsageExtractor` implementing `TokenUsageExtractor`
- `adws/cost/providers/anthropic/index.ts`: Barrel export for Anthropic provider
- `adws/cost/index.ts`: Barrel export for the cost module
- `adws/cost/__tests__/computation.test.ts`: 9 tests for `computeCost()` and `checkDivergence()`
- `adws/cost/__tests__/extractor.test.ts`: Tests for `AnthropicTokenUsageExtractor` covering parsing, buffering, and edge cases

### Key Changes

- **Bug fix encoded in design**: The old code expected `totalCostUsd` (camelCase) but the CLI emits `total_cost_usd` (snake_case), causing silent cost loss. The new extractor explicitly handles `total_cost_usd` at the top level while correctly mapping `inputTokens`/`cacheCreationInputTokens`/etc. from `modelUsage` entries.
- **Extensible maps replace fixed fields**: `TokenUsageMap = Record<string, number>` replaces fixed `inputTokens`/`outputTokens` fields, enabling multi-provider support without interface changes.
- **Provider-agnostic computation**: `computeCost()` works with any usage/pricing map pair via key matching — no provider-specific logic in the core.
- **Divergence check at 5% boundary**: `checkDivergence()` uses exclusive `>5%` threshold and handles the edge cases of zero costs, undefined reported cost, and infinite divergence (computed > 0, reported = 0).
- **Standalone library**: No changes to existing `adws/agents/`, `adws/phases/`, or `adws/core/` files. Old cost files are preserved unchanged.

## How to Use

1. Import from the cost module barrel:
   ```typescript
   import { computeCost, checkDivergence, AnthropicTokenUsageExtractor } from './cost';
   ```

2. Extract token usage from Claude CLI output:
   ```typescript
   const extractor = new AnthropicTokenUsageExtractor();
   // feed raw CLI stdout chunks
   extractor.onChunk(chunk);
   // after result message arrives
   const usage = extractor.getCurrentUsage(); // { 'claude-sonnet-4-5': { input: 1000, output: 500, ... } }
   const reportedCost = extractor.getReportedCostUsd(); // e.g. 0.01234
   ```

3. Compute local cost and check for divergence:
   ```typescript
   import { getAnthropicPricing } from './cost/providers/anthropic';
   const pricing = getAnthropicPricing('claude-sonnet-4-5-20250929');
   const modelUsage = extractor.getCurrentUsage()['claude-sonnet-4-5-20250929'] ?? {};
   const computed = computeCost(modelUsage, pricing);
   const divergence = checkDivergence(computed, extractor.getReportedCostUsd());
   if (divergence.isDivergent) {
     console.warn(`Cost divergence: ${divergence.percentDiff.toFixed(1)}%`);
   }
   ```

## Configuration

No environment variables required for the cost module itself. Pricing constants are hardcoded in `adws/cost/providers/anthropic/pricing.ts` and should be updated when Anthropic changes model pricing.

## Testing

```bash
# Run unit tests (single pass)
bun run test:unit

# Run in watch mode during development
bun run test:unit:watch
```

Tests cover:
- `computeCost()`: basic multiplication, multiple token types, missing keys, empty maps, large counts
- `checkDivergence()`: exact match, 4.9%/5.0%/5.1% boundary, zero costs, custom threshold
- `AnthropicTokenUsageExtractor`: full `result` message parsing, camelCase-to-snake_case key mapping, multi-model results, partial line buffering, invalid JSON handling, pre-finalization state

## Notes

- **Not yet wired into workflow**: This module is a standalone library. Integration into `adws/phases/` and `adws/agents/` is planned for a subsequent issue.
- **Old cost files unchanged**: `adws/core/costPricing.ts`, `adws/core/costReport.ts`, and related files remain in place. Migration happens in a future issue.
- **Vitest vs project.md**: `.adw/project.md` has `## Unit Tests: disabled` for the general ADW workflow. This issue explicitly introduces Vitest — the tests are the deliverable, not a workflow step.
- **Snake_case convention**: All token type keys in the new module use snake_case (`input`, `output`, `cache_read`, `cache_write`) matching the Anthropic API convention and avoiding the camelCase mismatch bug in the existing code.
