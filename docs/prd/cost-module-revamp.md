# PRD: Cost Module Revamp

## Problem Statement

The current cost module has several correctness and usability issues that undermine trust in cost reporting:

1. **Stale cost values in GitHub comments** — During long-running phases like build, progress comments are posted every 60 seconds but always show the same frozen cost values from before the agent started. The JSONL parser tracks tokens in real-time for token-limit checks but never feeds them back to the comment context.

2. **Silent cost loss from field name mismatch** — The Claude Code CLI emits `total_cost_usd` (snake_case) in JSONL output, but the `ClaudeCodeResultMessage` type expects `totalCostUsd` (camelCase). Since `JSON.parse()` does no case conversion, `state.lastResult.totalCostUsd` is always `undefined`. Every per-phase cost accumulation line (`costUsd += buildResult.totalCostUsd || 0`) silently adds zero. The final total happens to be correct because it's derived from `modelUsage.costUSD`, which is camelCase in the JSONL.

3. **Dual cost sources with no validation** — The system carries both `totalCostUsd` (from the CLI result) and `sum(modelUsage[*].costUSD)` (per-model costs) with no check that they agree. The locally computed `computeModelCost()` function exists but is dead code — never called.

4. **Lost cost from failed agent runs** — When an agent exits with a non-zero code or produces no `result` message, `totalCostUsd` is not set on the `AgentResult`. Those tokens were consumed and billed but silently dropped from cost tracking.

5. **No multi-provider support** — The cost system is tightly coupled to Anthropic's Claude Code CLI output format. There is no abstraction for extracting costs from other LLM providers.

6. **No unit test coverage** — The cost module has zero unit tests. Bugs in cost computation directly impact invoicing accuracy.

## Solution

Replace the existing cost code scattered across `core/` and `types/` with a dedicated `adws/cost/` module that:

- Computes costs locally from token counts and pricing tables (source of truth), with the CLI-reported cost as a divergence check
- Provides a streaming `TokenUsageExtractor` interface with provider-specific implementations (Anthropic first, extensible to OpenAI and others)
- Uses extensible token type maps (`Record<string, number>`) instead of fixed fields, allowing each provider to define its own token categories
- Tracks costs per model per phase with metadata (status, retries, continuations, duration)
- Shows real-time estimated token counts during phases for token-limit awareness
- Reports estimate-vs-actual accuracy at phase completion
- Writes cost data to CSV after each phase (not just at workflow end)
- Introduces Vitest for unit testing the cost computation and extraction logic

## User Stories

1. As a workflow operator, I want cost values in GitHub progress comments to update in real-time during a phase, so that I can monitor whether a phase is approaching the model token limit.

2. As a workflow operator, I want to see the difference between estimated and actual token counts at phase completion (in both absolute numbers and percentage), so that I can judge the quality of the real-time estimates over time.

3. As a workflow operator, I want costs to be computed locally from token counts and pricing tables, so that I have full control and auditability over cost calculations rather than depending on an opaque CLI-reported number.

4. As a workflow operator, I want to see a warning when the locally computed cost diverges from the CLI-reported cost by more than 5%, so that I get an early signal when pricing tables need updating.

5. As a workflow operator, I want the divergence warning to appear in the GitHub issue comment, so that it is visible to anyone reviewing the workflow output.

6. As a workflow operator, I want a single environment variable to toggle all cost-related content in GitHub comments on or off, so that I can disable comment clutter once I trust the cost system.

7. As a workflow operator, I want failed or crashed agent runs to contribute their accumulated cost to the workflow total, so that no billed tokens are silently lost.

8. As a workflow operator, I want cost data recorded at the granularity of one record per model per phase, so that I can see exactly which models and phases are driving cost.

9. As a workflow operator, I want each phase cost record to include retry count, continuation count, and status, so that I can identify phases with unusually high retry waste without needing per-agent-run granularity.

10. As a workflow operator, I want cost CSVs to be updated after each phase completes (not just at workflow end), so that if a workflow crashes mid-execution I still have the cost data for completed phases.

11. As a workflow operator, I want the per-issue CSV to use the new phase cost record format with one row per model per phase, so that I have detailed cost breakdowns.

12. As a workflow operator, I want the project total CSV to show one row per issue per phase, so that I can see which phases are expensive across the project.

13. As a workflow operator, I want markup removed from the cost data layer, so that raw cost data stays clean and markup is handled in the invoicing layer.

14. As a workflow operator, I want CSV columns to include a superset of known token types (input, output, cache_read, cache_write, reasoning) with unknown types appended automatically, so that new token types from future providers appear without manual schema changes.

15. As a developer extending ADW, I want a `TokenUsageExtractor` interface that any LLM provider can implement, so that I can add cost tracking for OpenAI or other providers without modifying the core cost engine.

16. As a developer extending ADW, I want each provider to define its own token type keys and pricing tables, so that provider-specific concepts (like Anthropic's cache tokens or OpenAI's reasoning tokens) are modeled naturally.

17. As a developer extending ADW, I want a single generic `computeCost()` function that multiplies any `Record<string, number>` usage map against any `Record<string, number>` pricing map, so that cost computation works identically for all providers.

18. As a developer extending ADW, I want the cost provider to be selected automatically from the agent's model config, so that no extra configuration is needed.

19. As a developer extending ADW, I want the Anthropic streaming extractor to parse per-turn `message.usage` fields from `assistant` JSONL messages (deduplicated by message ID), so that real-time token tracking is available during a phase.

20. As a developer extending ADW, I want output tokens estimated from content block character length (~4 chars/token) during streaming, since the per-turn `output_tokens` field in the JSONL is unreliable (reflects message start, not completion).

21. As a developer, I want unit tests (Vitest) covering cost computation, divergence checking, the Anthropic extractor, CSV writing, and estimate-vs-actual calculations, so that cost correctness is validated automatically.

22. As a workflow operator, I want the snake_case/camelCase JSONL field name mismatch fixed so that per-phase cost accumulation is no longer silently zero.

## Implementation Decisions

### New module: `adws/cost/`

The cost module follows an interface/provider pattern mirroring the existing `adws/providers/` structure:

```
adws/cost/
  types.ts                         — Core interfaces
  computation.ts                   — Generic cost computation, divergence check
  exchangeRates.ts                 — Currency conversion (moved from core/)
  reporting/
    csvWriter.ts                   — PhaseCostRecord CSV output
    commentFormatter.ts            — GitHub comment formatting
  providers/
    anthropic/
      extractor.ts                 — Streaming JSONL token extractor
      pricing.ts                   — Model pricing tables
      index.ts
    openai/                        — Future placeholder
  __tests__/                       — Vitest unit tests
  index.ts
```

### `TokenUsageExtractor` interface (pull model)

```typescript
interface TokenUsageExtractor {
  onChunk(chunk: string): void;
  getCurrentUsage(): ModelUsageMap;  // Record<string, Record<string, number>>
  isFinalized(): boolean;
  getReportedCostUsd(): number | undefined;
}
```

- Streaming: receives raw stdout chunks, handles its own line buffering and JSON parsing
- Pull model: callers poll `getCurrentUsage()` when needed (e.g., every 60s for progress comments)
- Provider selected automatically from the agent's model config (passed as constructor parameter)

### Extensible token type maps

Token usage and pricing both use `Record<string, number>` with provider-specific keys:

- Anthropic: `input`, `output`, `cache_read`, `cache_write`
- OpenAI (future): `input`, `output`, `reasoning`

The generic `computeCost(usage, pricing)` function multiplies matching keys. Unknown keys (no pricing entry) cost zero. Cross-provider aggregation happens at the dollar level, not the token level.

### Anthropic extractor specifics

- Parses `assistant` JSONL messages with `message.usage` containing per-turn token counts (snake_case fields: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`)
- Deduplicates by `message.id` — multiple content blocks from the same API call share identical usage
- Input and cache tokens are accurate from per-turn data
- Output tokens are estimated from content block character length (~4 chars/token) because per-turn `output_tokens` reflects message start, not completion
- When the `result` message arrives, all values are replaced with authoritative numbers
- Handles the `system` init message (ignored for cost, model comes from constructor)

### `PhaseCostRecord` data model

One row per model per phase:

- `workflowId` (adwId), `issueNumber`, `phase`, `model`, `provider`
- `tokenUsage`: `Record<string, number>` — provider-specific token types
- `computedCostUsd`: locally calculated (source of truth)
- `reportedCostUsd`: CLI-reported (for divergence check)
- `status`: success / partial / failed
- `retryCount`, `continuationCount`
- `durationMs`, `timestamp` (ISO 8601)
- `estimatedTokens`, `actualTokens`: for estimate tracking

### Divergence checking

- Compare locally computed cost vs CLI-reported cost
- If divergence exceeds 5%, include a warning in the GitHub issue comment
- Warning always shown when cost comments are enabled — not independently toggleable

### Environment variable

- Single env var (e.g., `SHOW_COST_IN_COMMENTS`) to toggle all cost-related content in GitHub comments on or off
- Cost data is always written to CSV regardless of this setting

### CSV format changes

- Per-issue CSV: one row per model per phase with `PhaseCostRecord` fields
- Project total CSV: one row per issue per phase (no markup column)
- Fixed superset of token type columns: `input`, `output`, `cache_read`, `cache_write`, `reasoning`
- Unknown token types appended as extra columns automatically
- CSV committed after each phase completion (not just workflow end)

### Code migration

- Clean break: all cost code moves to `adws/cost/`, all imports updated, old files deleted
- Old files removed: `core/costPricing.ts`, `core/costReport.ts`, `core/costCsvWriter.ts`, `core/tokenManager.ts`, `types/costTypes.ts`
- `core/costCommitQueue.ts` stays in `core/` (git infrastructure, not cost logic)
- `ClaudeCodeResultMessage` type retired — replaced by extractor's normalized output
- `agents/jsonlParser.ts` loses token/cost extraction responsibility (keeps output parsing: text, tool calls, progress)
- `agents/agentProcessHandler.ts` updated to use `TokenUsageExtractor` instead of inline JSONL cost parsing

### Estimate-vs-actual reporting

- At phase completion, log the difference between estimated and actual token counts in both absolute numbers and percentage
- Shown in console logs and GitHub comments (controlled by the same env var toggle)
- Recorded in `PhaseCostRecord` as `estimatedTokens` and `actualTokens` fields

## Testing Decisions

### What makes a good test

Tests should verify external behavior through the public interface, not implementation details. For the cost module this means:

- Test `computeCost()` with various usage/pricing maps and verify the dollar output
- Test the Anthropic extractor by feeding it real JSONL chunks and verifying `getCurrentUsage()` returns correct token counts
- Test CSV writer by verifying the output string matches expected format
- Do not test internal state, private functions, or call order

### Modules to test with Vitest unit tests

- `computation.ts` — cost calculation, divergence check threshold, estimate-vs-actual math
- `providers/anthropic/extractor.ts` — JSONL parsing, message ID deduplication, output token estimation, finalization from result message, handling of incomplete/failed streams
- `reporting/csvWriter.ts` — PhaseCostRecord serialization, dynamic column generation for unknown token types, project total aggregation

### Test infrastructure

- Vitest introduced as a dev dependency
- Tests colocated in `adws/cost/__tests__/`
- BDD scenarios generated per-issue by the ADW scenario agent when implementation issues are created

## Out of Scope

- **PostgreSQL database** — Phase 2 work. The data model is designed for it, but Phase 1 outputs to CSV only.
- **Cloudflare frontend / invoicing** — Future work on paysdoc.nl to display and invoice clients with token costs.
- **OpenAI provider implementation** — The interface and module structure supports it, but only Anthropic is implemented in this PRD.
- **Push-model events on the extractor** — Pull model only for now. Push (callback on usage update) can be added later if needed.
- **Markup / billing logic** — Removed from cost data layer. Belongs in the invoicing frontend.
- **Changes to `costCommitQueue.ts`** — Git commit queue stays in `core/` and is not modified.

## Further Notes

- The snake_case/camelCase JSONL field mismatch (`total_cost_usd` vs `totalCostUsd`) is a pre-existing bug that silently zeroes out per-phase cost accumulation. This is fixed as part of the extractor rewrite, not as a separate patch.
- The `computeModelCost()` function in the current `costPricing.ts` is dead code (never called). Its logic is superseded by the new generic `computeCost()`.
- Real JSONL output files from past agent runs are available in `agents/{adwId}/*/output.jsonl` and can be used as test fixtures for the Anthropic extractor.
- The `system` init message and `result` message both use snake_case for top-level fields. The `modelUsage` object within `result` uses camelCase. The new extractor must handle both conventions correctly.
