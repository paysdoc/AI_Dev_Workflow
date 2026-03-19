# Feature: Cost Module Core Computation, Anthropic Extractor, and Vitest Infrastructure

## Metadata
issueNumber: `241`
adwId: `ku956a-cost-revamp-core-com`
issueJson: `{"number":241,"title":"Cost revamp: core computation, Anthropic extractor, and Vitest infrastructure","body":"## Parent PRD\n\nSee `specs/prd-cost-module-revamp.md` on the `dev` branch.\n\n## What to build\n\nThe foundational slice of the cost module revamp. Create the new `adws/cost/` module with:\n\n- Core types: `TokenUsageExtractor` interface (pull model with `onChunk`, `getCurrentUsage`, `isFinalized`, `getReportedCostUsd`), `PhaseCostRecord`, extensible token usage maps (`Record<string, number>`)\n- Generic `computeCost(usage, pricing)` function that multiplies matching keys in any usage map against any pricing map — provider-agnostic\n- Divergence check: compare locally computed cost vs CLI-reported cost, flag when >5%\n- Anthropic provider: pricing tables for Opus 4.6, Sonnet 4.5, Haiku 4.5 with provider-specific token type keys (`input`, `output`, `cache_read`, `cache_write`), and a basic streaming extractor that correctly parses the `result` JSONL message (handling snake_case field names like `total_cost_usd`)\n- Introduce Vitest as a dev dependency with unit tests for computation and the basic extractor\n\nThis slice is a standalone, testable library — it does NOT yet wire into the workflow.\n\nRefer to the \"Implementation Decisions\" section of the parent PRD for the full module structure, interface definitions, and design rationale.\n\n## Acceptance criteria\n\n- [ ] `adws/cost/types.ts` defines `TokenUsageExtractor` interface, `PhaseCostRecord`, and extensible token/pricing types\n- [ ] `adws/cost/computation.ts` implements generic `computeCost()` and divergence check (5% threshold)\n- [ ] `adws/cost/providers/anthropic/pricing.ts` contains pricing tables for current Claude models\n- [ ] `adws/cost/providers/anthropic/extractor.ts` implements `TokenUsageExtractor` and correctly parses `result` JSONL messages with snake_case fields\n- [ ] Vitest is added as a dev dependency with a working test script\n- [ ] Unit tests in `adws/cost/__tests__/` cover: `computeCost()` with various usage/pricing maps, divergence check at boundary (4.9%, 5.1%), Anthropic extractor parsing of a real `result` message\n- [ ] All existing type checks (`bun run test`) still pass\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 3: locally computed cost as source of truth\n- User story 4: divergence check between computed and CLI cost\n- User story 16: provider-specific token type keys\n- User story 17: generic computeCost() function\n- User story 18: provider selected from model config\n- User story 21: Vitest unit tests\n- User story 22: fixes snake_case/camelCase mismatch","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-19T10:37:07Z","comments":[],"actionableComment":null}`

## Feature Description
Create the foundational `adws/cost/` module as the first slice of the cost module revamp. This standalone, testable library introduces:

1. **Core type definitions** — `TokenUsageExtractor` interface (pull model), `PhaseCostRecord` data model, and extensible token/pricing maps using `Record<string, number>` instead of fixed fields.
2. **Generic cost computation** — A provider-agnostic `computeCost(usage, pricing)` function that multiplies matching keys in any usage map against any pricing map, plus a divergence check comparing locally computed cost vs CLI-reported cost (>5% threshold).
3. **Anthropic provider** — Pricing tables for Opus 4.6, Sonnet 4.5, and Haiku 4.5 with provider-specific token type keys (`input`, `output`, `cache_read`, `cache_write`), and a basic streaming extractor that correctly parses the `result` JSONL message handling snake_case field names like `total_cost_usd`.
4. **Vitest infrastructure** — Vitest added as a dev dependency with unit tests covering computation, divergence checking, and extractor parsing.

This module does NOT wire into the existing workflow — it is a standalone library that will be integrated in a subsequent issue.

## User Story
As a developer extending ADW
I want a standalone, tested cost computation library with a provider-agnostic interface
So that I can compute costs locally from token counts, validate them against CLI-reported costs, and extend the system to support multiple LLM providers

## Problem Statement
The current cost module has several correctness issues:
- The `computeModelCost()` function in `costPricing.ts` is dead code (never called)
- The CLI emits `total_cost_usd` (snake_case) but the type expects `totalCostUsd` (camelCase), causing silent cost loss
- Token usage types use fixed fields (`inputTokens`, `outputTokens`, etc.) instead of extensible maps, making multi-provider support impossible
- There are zero unit tests covering cost computation
- No divergence check exists between locally computed and CLI-reported costs

## Solution Statement
Create a new `adws/cost/` module that:
- Defines extensible interfaces using `Record<string, number>` for token usage and pricing maps
- Implements a generic `computeCost()` that works with any provider's token types
- Includes a divergence check function that flags when local vs CLI cost differs by more than 5%
- Provides an Anthropic-specific extractor that correctly handles snake_case JSONL fields
- Is fully covered by Vitest unit tests validating computation, divergence boundaries, and extractor parsing

## Relevant Files
Use these files to implement the feature:

- `specs/prd-cost-module-revamp.md` — The parent PRD with full module structure, interface definitions, and design rationale. Read the "Implementation Decisions" section carefully.
- `adws/core/costPricing.ts` — Existing pricing tables and dead `computeModelCost()`. Reference for current model pricing values (Opus 4.6, Sonnet 4.5, Haiku 4.5). New code supersedes this.
- `adws/types/costTypes.ts` — Existing `ModelUsage`, `ModelUsageMap` types. Reference for what the new extensible types replace.
- `adws/agents/jsonlParser.ts` — Existing JSONL parser. Reference for understanding the `result` message format and `modelUsage` structure. The new extractor handles the same JSONL format.
- `adws/types/agentTypes.ts` — Contains `ClaudeCodeResultMessage` with `totalCostUsd` (camelCase) and `modelUsage` types. Reference for the snake_case/camelCase mismatch bug.
- `adws/tsconfig.json` — TypeScript config for the `adws/` directory. New code must be compatible.
- `package.json` — Needs Vitest added as dev dependency and new test script.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow (strict mode, immutability, functional style, no decorators).

### New Files
- `adws/cost/types.ts` — Core interfaces: `TokenUsageExtractor`, `PhaseCostRecord`, `TokenUsageMap`, `PricingMap`, `ModelUsageMap`
- `adws/cost/computation.ts` — Generic `computeCost()` and `checkDivergence()` functions
- `adws/cost/providers/anthropic/pricing.ts` — Anthropic model pricing tables using new extensible format
- `adws/cost/providers/anthropic/extractor.ts` — `AnthropicTokenUsageExtractor` implementing `TokenUsageExtractor`
- `adws/cost/providers/anthropic/index.ts` — Barrel export for Anthropic provider
- `adws/cost/index.ts` — Barrel export for the cost module
- `adws/cost/__tests__/computation.test.ts` — Vitest tests for `computeCost()` and `checkDivergence()`
- `adws/cost/__tests__/extractor.test.ts` — Vitest tests for `AnthropicTokenUsageExtractor`
- `vitest.config.ts` — Vitest configuration file

## Implementation Plan
### Phase 1: Foundation
Set up Vitest infrastructure and define core type interfaces. This establishes the type contracts that all subsequent code depends on.

1. Add `vitest` as a dev dependency via `bun add -d vitest`
2. Create `vitest.config.ts` at project root with minimal config targeting `adws/cost/__tests__/`
3. Add `"test:unit": "vitest run"` and `"test:unit:watch": "vitest"` scripts to `package.json`
4. Define all core types in `adws/cost/types.ts`: `TokenUsageMap` (`Record<string, number>`), `PricingMap` (`Record<string, number>`), `ModelUsageMap` (`Record<string, TokenUsageMap>`), `TokenUsageExtractor` interface, `PhaseCostRecord` interface, and `DivergenceResult`

### Phase 2: Core Implementation
Implement the generic computation engine and Anthropic provider.

1. Implement `computeCost(usage, pricing)` in `adws/cost/computation.ts` — iterates over usage map keys, multiplies by matching pricing entry (per-million), returns total USD
2. Implement `checkDivergence(computedCost, reportedCost, thresholdPercent)` in the same file — returns a `DivergenceResult` with `isDivergent`, `percentDiff`, and both cost values
3. Create Anthropic pricing tables in `adws/cost/providers/anthropic/pricing.ts` using the new `PricingMap` format with snake_case keys (`input`, `output`, `cache_read`, `cache_write`)
4. Implement `AnthropicTokenUsageExtractor` in `adws/cost/providers/anthropic/extractor.ts` — handles `result` JSONL message parsing with correct snake_case field names (`total_cost_usd`, `input_tokens`, etc.)

### Phase 3: Integration
Wire up barrel exports, write tests, and validate everything works.

1. Create barrel exports (`index.ts` files) for the cost module and Anthropic provider
2. Write unit tests for `computeCost()` covering: basic multiplication, multiple token types, missing pricing keys (cost zero), empty maps, large token counts
3. Write unit tests for `checkDivergence()` covering: exact match, 4.9% divergence (not flagged), 5.1% divergence (flagged), zero costs, negative scenarios
4. Write unit tests for `AnthropicTokenUsageExtractor` covering: parsing a real `result` JSONL message, snake_case field handling, `getCurrentUsage()` after result, `isFinalized()` state, `getReportedCostUsd()`
5. Validate all existing type checks still pass

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1: Add Vitest dependency and configuration
- Run `bun add -d vitest` to add Vitest as a dev dependency
- Create `vitest.config.ts` at the project root:
  ```typescript
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      include: ['adws/cost/__tests__/**/*.test.ts'],
    },
  });
  ```
- Add scripts to `package.json`:
  - `"test:unit": "vitest run"` — single run for CI
  - `"test:unit:watch": "vitest"` — watch mode for development
- Verify Vitest is installed: `bunx vitest --version`

### Task 2: Define core types in `adws/cost/types.ts`
- Create `adws/cost/types.ts` with:
  - `TokenUsageMap`: `Record<string, number>` — extensible token counts with provider-specific keys
  - `PricingMap`: `Record<string, number>` — per-million-token pricing with provider-specific keys
  - `ModelUsageMap`: `Record<string, TokenUsageMap>` — token usage keyed by model identifier
  - `TokenUsageExtractor` interface with four methods:
    - `onChunk(chunk: string): void` — feed raw stdout chunks
    - `getCurrentUsage(): ModelUsageMap` — poll current accumulated usage
    - `isFinalized(): boolean` — whether the `result` message has been received
    - `getReportedCostUsd(): number | undefined` — CLI-reported cost (available after finalization)
  - `DivergenceResult` interface:
    - `isDivergent: boolean`
    - `percentDiff: number`
    - `computedCostUsd: number`
    - `reportedCostUsd: number`
  - `PhaseCostRecord` interface with fields from the PRD:
    - `workflowId: string` (adwId)
    - `issueNumber: number`
    - `phase: string`
    - `model: string`
    - `provider: string`
    - `tokenUsage: TokenUsageMap`
    - `computedCostUsd: number`
    - `reportedCostUsd: number | undefined`
    - `status: 'success' | 'partial' | 'failed'`
    - `retryCount: number`
    - `continuationCount: number`
    - `durationMs: number`
    - `timestamp: string` (ISO 8601)
    - `estimatedTokens: TokenUsageMap | undefined`
    - `actualTokens: TokenUsageMap | undefined`
- All types should be `readonly` per coding guidelines (immutability)
- Export all types

### Task 3: Implement `computeCost()` and `checkDivergence()` in `adws/cost/computation.ts`
- Create `adws/cost/computation.ts` with:
  - `computeCost(usage: TokenUsageMap, pricing: PricingMap): number`
    - Iterate over keys in the `usage` map
    - For each key, look up the matching key in `pricing`
    - If found, multiply `usage[key] * pricing[key] / 1_000_000` and add to total
    - If not found (no pricing entry), that token type costs zero — skip it
    - Return the total as a number
  - `checkDivergence(computedCostUsd: number, reportedCostUsd: number, thresholdPercent?: number): DivergenceResult`
    - Default `thresholdPercent` to `5`
    - Calculate `percentDiff` as `Math.abs(computedCostUsd - reportedCostUsd) / reportedCostUsd * 100`
    - Handle edge case: if `reportedCostUsd` is 0, divergence is `computedCostUsd > 0`
    - Return `{ isDivergent: percentDiff > thresholdPercent, percentDiff, computedCostUsd, reportedCostUsd }`
- Import types from `./types`

### Task 4: Create Anthropic pricing tables in `adws/cost/providers/anthropic/pricing.ts`
- Create `adws/cost/providers/anthropic/pricing.ts` with:
  - Import `PricingMap` from `../../types`
  - Define pricing using snake_case keys matching the token type keys the extractor will produce:
    - `input` — input tokens (per million)
    - `output` — output tokens (per million)
    - `cache_read` — cache read tokens (per million)
    - `cache_write` — cache creation tokens (per million)
  - `ANTHROPIC_PRICING: Readonly<Record<string, PricingMap>>` mapping model identifiers to pricing:
    - `'claude-opus-4-6'`: `{ input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 6.25 }`
    - `'opus'`: same as above (alias)
    - `'claude-sonnet-4-5-20250929'`: `{ input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 3.75 }`
    - `'sonnet'`: same as above (alias)
    - `'claude-haiku-4-5-20251001'`: `{ input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 1.25 }`
    - `'haiku'`: same as above (alias)
  - `DEFAULT_ANTHROPIC_PRICING`: fallback to sonnet pricing
  - `getAnthropicPricing(model: string): PricingMap` — lookup with fallback

### Task 5: Implement `AnthropicTokenUsageExtractor` in `adws/cost/providers/anthropic/extractor.ts`
- Create `adws/cost/providers/anthropic/extractor.ts` with:
  - Import `TokenUsageExtractor`, `ModelUsageMap`, `TokenUsageMap` from `../../types`
  - Import `getAnthropicPricing` from `./pricing`
  - Implement `AnthropicTokenUsageExtractor` class implementing `TokenUsageExtractor`:
    - Constructor receives no required arguments (model resolution happens at usage time)
    - Internal state: `lineBuffer: string` for incomplete lines, `modelUsage: ModelUsageMap`, `finalized: boolean`, `reportedCostUsd: number | undefined`
    - `onChunk(chunk: string): void`:
      - Append chunk to `lineBuffer`
      - Split on `\n`, process complete lines, keep incomplete remainder
      - For each complete line: attempt `JSON.parse`, silently skip failures
      - If parsed message has `type === 'result'`: call `handleResultMessage()`
    - `handleResultMessage(msg: unknown): void` (private):
      - Extract `total_cost_usd` (snake_case) from the message — set `reportedCostUsd`
      - Extract `modelUsage` object from the message (this field uses camelCase keys internally per PRD: `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD`)
      - For each model in `modelUsage`, convert to `TokenUsageMap` with snake_case keys:
        - `inputTokens` -> `input`
        - `outputTokens` -> `output`
        - `cacheReadInputTokens` -> `cache_read`
        - `cacheCreationInputTokens` -> `cache_write`
      - Store in `this.modelUsage`
      - Set `finalized = true`
    - `getCurrentUsage(): ModelUsageMap` — return a copy of `modelUsage`
    - `isFinalized(): boolean` — return `finalized`
    - `getReportedCostUsd(): number | undefined` — return `reportedCostUsd`
- Note: The `result` message's `modelUsage` contains camelCase fields internally. The `total_cost_usd` top-level field is snake_case. The extractor must handle both conventions correctly per the PRD.

### Task 6: Create barrel exports
- Create `adws/cost/providers/anthropic/index.ts`:
  - Re-export `AnthropicTokenUsageExtractor` from `./extractor`
  - Re-export `ANTHROPIC_PRICING`, `getAnthropicPricing` from `./pricing`
- Create `adws/cost/index.ts`:
  - Re-export all types from `./types`
  - Re-export `computeCost`, `checkDivergence` from `./computation`
  - Re-export from `./providers/anthropic`

### Task 7: Write unit tests for `computeCost()` and `checkDivergence()`
- Create `adws/cost/__tests__/computation.test.ts` with tests:
  - `computeCost`:
    - Basic: single token type, known pricing -> correct USD
    - Multiple token types: `{ input: 1000, output: 500, cache_read: 200 }` with Anthropic pricing -> correct sum
    - Missing pricing key: usage has `reasoning` key, pricing has no `reasoning` -> costs zero, no error
    - Empty usage map -> returns 0
    - Empty pricing map -> returns 0
    - Large token counts (millions) -> correct computation without overflow
    - Pricing key with no matching usage key -> ignored (no effect)
  - `checkDivergence`:
    - Exact match: computed === reported -> `isDivergent: false`, `percentDiff: 0`
    - Below threshold: 4.9% difference -> `isDivergent: false`
    - Above threshold: 5.1% difference -> `isDivergent: true`
    - Exactly at threshold: 5.0% difference -> `isDivergent: false` (threshold is exclusive >5%)
    - Reported cost is 0, computed > 0 -> `isDivergent: true`
    - Both costs are 0 -> `isDivergent: false`
    - Custom threshold: 10% threshold with 7% difference -> `isDivergent: false`

### Task 8: Write unit tests for `AnthropicTokenUsageExtractor`
- Create `adws/cost/__tests__/extractor.test.ts` with tests:
  - Parse a `result` JSONL message with snake_case `total_cost_usd`:
    - Feed a complete `result` line via `onChunk()`
    - Verify `isFinalized()` returns `true`
    - Verify `getReportedCostUsd()` returns the correct value
    - Verify `getCurrentUsage()` returns correct token counts mapped to snake_case keys
  - Convert `modelUsage` camelCase fields to snake_case keys:
    - `inputTokens` -> `input`, `outputTokens` -> `output`, `cacheReadInputTokens` -> `cache_read`, `cacheCreationInputTokens` -> `cache_write`
  - Handle multi-model result:
    - Result with usage for both `claude-opus-4-6` and `claude-haiku-4-5-20251001`
    - Verify both models appear in `getCurrentUsage()`
  - Before any chunk: `isFinalized()` is `false`, `getCurrentUsage()` is empty, `getReportedCostUsd()` is `undefined`
  - Partial line buffering: feed chunk that splits a JSON line across two calls -> correctly parses when complete
  - Invalid JSON lines: silently skipped, no errors thrown
  - Non-result messages: feed `assistant` type messages -> not finalized, no reported cost

### Task 9: Run validation commands
- Run `bunx vitest run` to verify all unit tests pass
- Run `bunx tsc --noEmit` to verify root type checks pass
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws type checks pass
- Run `bun run lint` to verify no lint errors
- Run `bun run build` to verify build succeeds

## Testing Strategy
### Unit Tests
Note: While `.adw/project.md` has unit tests disabled for the general ADW workflow, this issue **specifically introduces Vitest infrastructure** as a core deliverable. The unit tests ARE the feature — they are listed in the acceptance criteria and are required for this issue to be complete.

Tests to create:
- `adws/cost/__tests__/computation.test.ts` — Tests for `computeCost()` and `checkDivergence()`
- `adws/cost/__tests__/extractor.test.ts` — Tests for `AnthropicTokenUsageExtractor`

### Edge Cases
- `computeCost()` with empty usage map returns 0
- `computeCost()` with empty pricing map returns 0
- `computeCost()` with usage keys not present in pricing -> those types cost zero
- `computeCost()` with pricing keys not present in usage -> ignored
- `checkDivergence()` when reported cost is 0 and computed is > 0 -> divergent
- `checkDivergence()` when both costs are 0 -> not divergent
- `checkDivergence()` at exact 5% boundary -> not divergent (threshold is exclusive)
- Extractor receiving partial JSON lines across chunk boundaries -> correctly buffers and parses
- Extractor receiving malformed JSON lines -> silently skips them
- Extractor receiving non-`result` message types -> ignores them for cost tracking
- Result message with missing `modelUsage` field -> handles gracefully
- Result message with missing `total_cost_usd` -> `getReportedCostUsd()` returns `undefined`

## Acceptance Criteria
1. `adws/cost/types.ts` defines `TokenUsageExtractor` interface with `onChunk`, `getCurrentUsage`, `isFinalized`, `getReportedCostUsd` methods
2. `adws/cost/types.ts` defines `PhaseCostRecord` with all fields from the PRD
3. `adws/cost/types.ts` defines extensible `TokenUsageMap` and `PricingMap` as `Record<string, number>`
4. `adws/cost/computation.ts` implements generic `computeCost(usage, pricing)` that multiplies matching keys
5. `adws/cost/computation.ts` implements `checkDivergence()` with 5% default threshold
6. `adws/cost/providers/anthropic/pricing.ts` contains pricing for Opus 4.6, Sonnet 4.5, Haiku 4.5 with snake_case keys
7. `adws/cost/providers/anthropic/extractor.ts` implements `TokenUsageExtractor` and correctly parses `result` JSONL messages with `total_cost_usd` (snake_case)
8. `adws/cost/providers/anthropic/extractor.ts` correctly converts `modelUsage` camelCase fields (`inputTokens`, etc.) to snake_case keys (`input`, etc.)
9. Vitest is added as a dev dependency with `test:unit` and `test:unit:watch` scripts
10. `adws/cost/__tests__/computation.test.ts` covers `computeCost()` with various usage/pricing maps
11. `adws/cost/__tests__/computation.test.ts` covers divergence check at boundary (4.9%, 5.1%)
12. `adws/cost/__tests__/extractor.test.ts` covers Anthropic extractor parsing of a real `result` message
13. All existing type checks (`bun run test`, `bunx tsc --noEmit -p adws/tsconfig.json`) still pass
14. `bun run lint` passes with no errors
15. `bunx vitest run` passes with all tests green

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run` — Run all Vitest unit tests, verify all pass
- `bunx tsc --noEmit` — Root TypeScript type check, verify no errors
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW module type check, verify no errors
- `bun run lint` — ESLint check, verify no lint errors
- `bun run build` — Build the project, verify no build errors
- `bun run test` — Run the existing test script (type check), verify no regressions

## Notes
- **New dependency**: `vitest` needs to be added via `bun add -d vitest`. This is the Vitest test runner for unit tests.
- **Standalone library**: This module does NOT wire into the existing workflow. No changes to `adws/agents/`, `adws/phases/`, `adws/core/`, or any existing files except `package.json` (for Vitest dep and scripts).
- **Snake_case convention**: The new `adws/cost/` module uses snake_case for token type keys (`input`, `output`, `cache_read`, `cache_write`) to match the Anthropic API convention and avoid the camelCase mismatch bug in the current code.
- **PRD reference**: The parent PRD at `specs/prd-cost-module-revamp.md` contains the complete module structure and design rationale. This issue implements only the foundational slice (types, computation, Anthropic provider, Vitest).
- **No existing code changes**: Old cost files (`costPricing.ts`, `costReport.ts`, etc.) are NOT modified or deleted in this slice. They continue to work as-is. Migration happens in a future issue.
- **Coding guidelines**: Follow `guidelines/coding_guidelines.md` strictly — strict TypeScript mode, immutability (readonly), functional style (map/filter/reduce over loops), no decorators, meaningful names.
- **Vitest vs project.md**: The `.adw/project.md` has `## Unit Tests: disabled` which applies to the general ADW workflow. This issue explicitly introduces Vitest as infrastructure — the tests ARE the deliverable.
