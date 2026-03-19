# Wire Extractor into Agent Process Handler

**ADW ID:** tgs1li-cost-revamp-wire-ext
**Date:** 2026-03-19
**Specification:** specs/issue-242-adw-tgs1li-cost-revamp-wire-ext-sdlc_planner-wire-extractor-agent-handler.md

## Overview

This feature extends the `AnthropicTokenUsageExtractor` (from #241) from a result-only parser into a real-time streaming token tracker, then wires it into `agentProcessHandler.ts` to replace inline JSONL cost parsing. Progress comments now show live token estimates during agent execution, and failed agent runs no longer lose accumulated cost data.

## What Was Built

- **Real-time streaming extractor**: `AnthropicTokenUsageExtractor` now parses per-turn `assistant` JSONL messages, accumulates input/cache tokens, and estimates output tokens from content block character length (~4 chars/token)
- **Message-ID deduplication**: Multiple content blocks sharing the same `message.id` do not double-count usage tokens
- **Pre-finalization snapshot**: `getEstimatedUsage()` returns the accumulated estimate snapshot taken just before the `result` message replaces it with actuals
- **Wired into `agentProcessHandler.ts`**: Every stdout chunk is fed to the extractor; all exit paths (success, failure, token limit) populate `totalCostUsd` and `modelUsage` from extractor data
- **Failed-run cost recovery**: Non-zero exit or missing `result` message still yields accumulated per-turn cost via the extractor
- **Real-time progress comments**: `buildPhase.ts` reads `tokenEstimate` from the progress callback and sets `ctx.runningTokenTotal` with `isEstimated: true` so comments show "~X tokens (estimated)"
- **Estimate-vs-actual logging**: At build phase completion, the delta between pre-finalization estimates and actuals is logged per model and token type (absolute + percentage)
- **Updated token footer format**: `formatRunningTokenFooter` accepts an `isEstimated` flag and renders `~X tokens (estimated)` vs `X tokens` accordingly
- **`AgentResult` extended**: New fields `estimatedUsage`, `actualUsage`, and `costSource` carry extractor provenance through to callers
- **Vitest tests**: `adws/cost/__tests__/extractor.test.ts` extended with streaming/deduplication/estimation/finalization scenarios

## Technical Implementation

### Files Modified

- `adws/cost/providers/anthropic/extractor.ts`: New file (200 lines) — full `AnthropicTokenUsageExtractor` implementation with per-turn `assistant` message parsing, `message.id` deduplication, output token estimation, and `getEstimatedUsage()` snapshot
- `adws/cost/types.ts`: Added `getEstimatedUsage(): ModelUsageMap` to the `TokenUsageExtractor` interface
- `adws/agents/agentProcessHandler.ts`: Imports and instantiates `AnthropicTokenUsageExtractor`; feeds every chunk to it; wraps `onProgress` to inject `tokenEstimate`; builds all `AgentResult` cost fields from extractor; adds `computeEstimatedCostUsd()` and `toOldModelUsageMap()` helpers for format conversion
- `adws/agents/claudeAgent.ts`: `AgentResult` interface extended with `estimatedUsage`, `actualUsage`, `costSource` fields; removed `runPrimedClaudeAgentWithCommand` (dead code cleanup)
- `adws/agents/jsonlParser.ts`: `ProgressInfo` type extended with optional `tokenEstimate` field
- `adws/phases/buildPhase.ts`: Progress callback reads `info.tokenEstimate` and updates `ctx.runningTokenTotal` with `isEstimated: true`; post-completion estimate-vs-actual logging added
- `adws/core/workflowCommentParsing.ts`: `formatRunningTokenFooter` accepts `isEstimated?: boolean` and renders tilde prefix + "(estimated)" suffix when set
- `adws/cost/__tests__/extractor.test.ts`: Extended with streaming deduplication, output estimation, incomplete stream, and finalization test cases

### Key Changes

- **Backward-compatible format conversion**: The new cost module uses `Record<string, number>` with snake_case keys (`input`, `output`, `cache_read`, `cache_write`); `toOldModelUsageMap()` converts to the existing `ModelUsageMap` camelCase format for all downstream consumers
- **Dual-path cost resolution**: `resolvedModelUsage` prefers `state.modelUsage` from `parseJsonlOutput` when finalized (carries per-model `costUSD`), and falls back to the extractor's estimated map for partial/failed runs
- **Token limit path updated**: The token-limit termination path in `agentProcessHandler.ts` now uses `resolvedModelUsage` (extractor-backed) instead of `state.modelUsage` (which may be undefined for pre-result termination)
- **Model identification**: `AnthropicTokenUsageExtractor` accepts an optional `modelHint` constructor parameter; `agentProcessHandler.ts` passes the `model` argument so per-turn messages without a `model` field are still attributed correctly
- **`parseJsonlOutput` responsibilities unchanged**: Text extraction, tool use tracking, turn counting, and token limit state remain in the JSONL parser; only cost extraction moves to the extractor

## How to Use

Real-time token tracking happens automatically for any agent run through `handleAgentProcess`. No configuration is required.

1. **Observe real-time estimates in GitHub comments**: While a build agent runs, progress comments posted every 60 seconds will show `~X tokens (estimated)` in the running token footer.
2. **Check estimate-vs-actual in logs**: After each build phase, the console logs a line per model such as:
   ```
   Estimate vs actual [claude-sonnet-4-5]: input: 45,000 estimated → 47,200 actual (+4.9%), output: 3,200 estimated → 3,050 actual (-4.7%)
   ```
3. **Inspect `AgentResult` fields**: Callers of `runBuildAgent` / `handleAgentProcess` now receive:
   - `costSource`: `'extractor_finalized'` (result message received) or `'extractor_estimated'` (no result)
   - `estimatedUsage`: per-model token map before finalization
   - `actualUsage`: per-model token map from the result message (only when finalized)

## Configuration

No new configuration is required. The extractor is constructed internally in `handleAgentProcess` using the `model` parameter already passed to that function.

The `RUNNING_TOKENS` feature flag (checked in `buildPhase.ts`) must be enabled for real-time token estimates to appear in progress comments — this is the same flag that controls the existing running token footer.

## Testing

Run the Vitest unit tests for the cost module:

```bash
bun run test:unit
```

Key test scenarios in `adws/cost/__tests__/extractor.test.ts`:
- Multi-turn streaming with `message.id` deduplication
- Per-turn input/cache token accumulation across distinct message IDs
- Output token estimation from text content block character length
- Finalization replacing estimates with actuals from the `result` message
- Incomplete stream (no `result` message) — `isFinalized()` remains false, `getCurrentUsage()` returns accumulated estimates
- Mixed content blocks (only `text` blocks contribute to output estimation; `tool_use` blocks are ignored)
- Empty or missing `message.usage` — graceful no-op

Type checks:
```bash
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- **Output token estimation accuracy**: The ~4 chars/token ratio is an approximation. The estimate-vs-actual log at phase completion provides a calibration signal over time.
- **Per-turn `output_tokens` ignored**: The `output_tokens` field in per-turn `message.usage` reflects the token count at message start (not completion), so it is intentionally ignored in favour of the character-length estimate.
- **`parseJsonlOutput` coexistence**: Token limit decisions continue to use `state.totalTokens` from `parseJsonlOutput` → `computePrimaryModelTokens()`. The extractor does not duplicate this logic.
- **Old `ModelUsageMap` format**: The camelCase `ModelUsageMap` type in `adws/types/costTypes.ts` remains in use by downstream cost reporting. `toOldModelUsageMap()` in `agentProcessHandler.ts` bridges the formats until a future migration replaces the old type everywhere.
- **`runPrimedClaudeAgentWithCommand` removed**: This function was dead code (no callers) and was removed as part of this change.
